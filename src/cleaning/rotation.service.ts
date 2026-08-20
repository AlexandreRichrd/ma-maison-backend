import { Injectable } from '@nestjs/common';

export type ChoreAssignmentMode = 'ROTATING' | 'PINNED';
export type ChoreFrequencyUnit = 'DAY' | 'WEEK';

export type RotationUser = { id: string };

/**
 * Everything rotation needs to know about one chore. A Prisma `Chore` row
 * satisfies this structurally, so callers can pass rows straight through
 * with no mapping step.
 */
export type ChoreConfig = {
  id: string;
  frequencyUnit: ChoreFrequencyUnit;
  frequencyValue: number;
  assignmentMode: ChoreAssignmentMode;
  // The calendar date this chore first occurred — every later occurrence
  // is derived from this, never a separately stored schedule.
  anchorDate: Date;
  // Dual meaning by assignmentMode: for PINNED, the permanent assignee;
  // for ROTATING, who was assigned on anchorDate (occurrence 0) — later
  // occurrences alternate from there.
  anchorUserId: string;
};

export type ChoreAssignment = { userId: string };
export type ChoreOccurrence = {
  choreId: string;
  userId: string;
  occurrenceDate: Date;
};

function resolveUsers(
  chore: ChoreConfig,
  users: [RotationUser, RotationUser],
): { anchorUser: RotationUser; otherUser: RotationUser } {
  const [first, second] = users;
  if (chore.anchorUserId === first.id) {
    return { anchorUser: first, otherUser: second };
  }
  if (chore.anchorUserId === second.id) {
    return { anchorUser: second, otherUser: first };
  }
  throw new Error(
    `Chore ${chore.id}'s anchorUserId does not match either household user — this is an invariant ChoresService must enforce on create/update, not a normal input to guard against here.`,
  );
}

/** DAY -> every frequencyValue days, WEEK -> every frequencyValue*7 days.
 * The only place frequencyUnit is branched on — everything downstream of
 * this is a single, unit-agnostic days-based formula. */
function periodDaysFor(chore: ChoreConfig): number {
  return chore.frequencyUnit === 'WEEK'
    ? chore.frequencyValue * 7
    : chore.frequencyValue;
}

const MS_PER_DAY = 86_400_000;

// UTC-explicit day arithmetic, deliberately not date-fns's
// differenceInCalendarDays/eachDayOfInterval — those normalize to the
// *local* timezone's midnight, which silently shifts the returned
// occurrenceDate by the host's UTC offset (verified: on a UTC+1 host,
// eachDayOfInterval({start: 2024-01-01T00:00Z}) starts one hour before —
// 2023-12-31T23:00Z). anchorDate/occurrenceDate are calendar dates, not
// instants, so they're always handled via their UTC Y/M/D components,
// regardless of what timezone the process happens to run in.
function utcDayNumber(date: Date): number {
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) /
      MS_PER_DAY,
  );
}

function utcDateFromDayNumber(dayNumber: number): Date {
  return new Date(dayNumber * MS_PER_DAY);
}

/**
 * Pure, deterministic per-chore rotation. Same date + chore config + users
 * in, same result out — no database access. Deciding *whether* and *to
 * whom* a chore is assigned on a given date is all this does; joining that
 * against completions is the caller's job.
 */
@Injectable()
export class RotationService {
  /** null = the chore does not occur on `date` under its current config. */
  getChoreAssignment(
    date: Date,
    chore: ChoreConfig,
    users: [RotationUser, RotationUser],
  ): ChoreAssignment | null {
    if (!Number.isInteger(chore.frequencyValue) || chore.frequencyValue < 1) {
      throw new Error(
        `Chore ${chore.id} has a non-positive frequencyValue (${chore.frequencyValue}) — this is an invariant ChoresService must enforce on create/update.`,
      );
    }

    const { anchorUser, otherUser } = resolveUsers(chore, users);

    const periodDays = periodDaysFor(chore);
    const daysSinceAnchor = utcDayNumber(date) - utcDayNumber(chore.anchorDate);
    if (daysSinceAnchor < 0 || daysSinceAnchor % periodDays !== 0) {
      return null;
    }

    if (chore.assignmentMode === 'PINNED') {
      return { userId: anchorUser.id };
    }

    const occurrenceIndex = daysSinceAnchor / periodDays;
    return {
      userId: occurrenceIndex % 2 === 0 ? anchorUser.id : otherUser.id,
    };
  }

  /** Pure filter/map over getChoreAssignment across an inclusive date
   * range — only the chores that occur on some day within it. The weekly
   * block and the day navigator are both just callers with a different
   * `from`/`to`, not separate rotation logic. */
  getOccurrences(
    from: Date,
    to: Date,
    chores: ChoreConfig[],
    users: [RotationUser, RotationUser],
  ): ChoreOccurrence[] {
    const fromDay = utcDayNumber(from);
    const toDay = utcDayNumber(to);
    const days: Date[] = [];
    for (let day = fromDay; day <= toDay; day++) {
      days.push(utcDateFromDayNumber(day));
    }

    return chores.flatMap((chore) =>
      days.flatMap((date) => {
        const assignment = this.getChoreAssignment(date, chore, users);
        return assignment
          ? [
              {
                choreId: chore.id,
                userId: assignment.userId,
                occurrenceDate: date,
              },
            ]
          : [];
      }),
    );
  }
}
