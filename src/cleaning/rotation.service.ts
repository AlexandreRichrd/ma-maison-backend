import { Injectable } from '@nestjs/common';
import { differenceInCalendarISOWeeks } from 'date-fns';

import { parseIsoWeek } from './iso-week.util';

export type ChoreAssignmentMode = 'ROTATING' | 'PINNED';

export type RotationUser = { id: string };

/**
 * Everything rotation needs to know about one chore. A Prisma `Chore` row
 * satisfies this structurally, so callers can pass rows straight through
 * with no mapping step.
 */
export type ChoreConfig = {
  id: string;
  frequencyWeeks: number;
  assignmentMode: ChoreAssignmentMode;
  // The ISO week (YYYY-Www) this chore first occurred — every later
  // occurrence is derived from this, never a separately stored schedule.
  anchorIsoWeek: string;
  // Dual meaning by assignmentMode: for PINNED, the permanent assignee;
  // for ROTATING, who was assigned on anchorIsoWeek (occurrence 0) — later
  // occurrences alternate from there.
  anchorUserId: string;
};

export type ChoreAssignment = { userId: string };

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

/**
 * Pure, deterministic per-chore rotation. Same isoWeek + chore config +
 * users in, same result out — no database access. Deciding *whether* and
 * *to whom* a chore is assigned this week is all this does; joining that
 * against completions is the caller's job.
 */
@Injectable()
export class RotationService {
  /** null = the chore does not occur on isoWeek under its current config. */
  getChoreAssignment(
    isoWeek: string,
    chore: ChoreConfig,
    users: [RotationUser, RotationUser],
  ): ChoreAssignment | null {
    if (!Number.isInteger(chore.frequencyWeeks) || chore.frequencyWeeks < 1) {
      throw new Error(
        `Chore ${chore.id} has a non-positive frequencyWeeks (${chore.frequencyWeeks}) — this is an invariant ChoresService must enforce on create/update.`,
      );
    }

    const { anchorUser, otherUser } = resolveUsers(chore, users);

    const weeksSinceAnchor = differenceInCalendarISOWeeks(
      parseIsoWeek(isoWeek),
      parseIsoWeek(chore.anchorIsoWeek),
    );
    if (weeksSinceAnchor < 0 || weeksSinceAnchor % chore.frequencyWeeks !== 0) {
      return null;
    }

    if (chore.assignmentMode === 'PINNED') {
      return { userId: anchorUser.id };
    }

    const occurrenceIndex = weeksSinceAnchor / chore.frequencyWeeks;
    return {
      userId: occurrenceIndex % 2 === 0 ? anchorUser.id : otherUser.id,
    };
  }

  /** Pure filter/map over getChoreAssignment — only the occurring chores. */
  getWeekOccurrences(
    isoWeek: string,
    chores: ChoreConfig[],
    users: [RotationUser, RotationUser],
  ): { choreId: string; userId: string }[] {
    return chores.flatMap((chore) => {
      const assignment = this.getChoreAssignment(isoWeek, chore, users);
      return assignment
        ? [{ choreId: chore.id, userId: assignment.userId }]
        : [];
    });
  }
}
