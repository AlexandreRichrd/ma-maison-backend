import { Injectable } from '@nestjs/common';
import type { Chore, ChoreCompletion, ChoreSubtask } from '@prisma/client';

import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import {
  HouseholdMembersService,
  type HouseholdMemberDto,
} from './household-members.service';
import { formatIsoDateUtc, parseIsoDate } from './iso-date.util';
import { parseIsoWeek } from './iso-week.util';
import { RotationService } from './rotation.service';

export type ChoreSubtaskDto = {
  id: string;
  label: string;
  done: boolean;
};

export type ChoreDto = {
  id: string;
  name: string;
  frequencyUnit: 'DAY' | 'WEEK';
  frequencyValue: number;
  // Echoed back so the frontend never has to recompute or assume it —
  // for a WEEK-unit chore this is always the Monday of the requested
  // week; for a DAY-unit chore, the requested day itself.
  occurrenceDate: string;
  done: boolean;
  subtasks: ChoreSubtaskDto[];
};

export type UserChoresDto = {
  user: HouseholdMemberDto;
  chores: ChoreDto[];
};

type ChoreWithSubtasks = Chore & { subtasks: ChoreSubtask[] };
type MemberPair = [HouseholdMemberDto, HouseholdMemberDto];

/** A chore is complete when it has no subtasks and is itself completed,
 * or when every one of its subtasks is completed — never a stored
 * parent-level flag once subtasks exist (see schema.prisma's
 * ChoreCompletion.subtaskId comment). Adding/removing a subtask changes
 * this for every past occurrence too — see CLAUDE.md's Chore rotation
 * section. */
function isChoreDone(
  chore: ChoreWithSubtasks,
  completionsForOccurrence: ChoreCompletion[],
): boolean {
  if (chore.subtasks.length === 0) {
    return completionsForOccurrence.some((c) => c.subtaskId === null);
  }
  const completedSubtaskIds = new Set(
    completionsForOccurrence.map((c) => c.subtaskId),
  );
  return chore.subtasks.every((subtask) => completedSubtaskIds.has(subtask.id));
}

@Injectable()
export class CleaningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rotation: RotationService,
    private readonly householdMembers: HouseholdMembersService,
  ) {}

  private async getMemberPair(userId: string): Promise<MemberPair | null> {
    const members = await this.householdMembers.getOrderedMembers(userId);
    if (members.length < 2) return null;
    return members as MemberPair;
  }

  /** Shared by getWeek/getDay — both are just a caller with a different
   * (frequencyUnit filter, from, to); the occurrence/completion-joining
   * logic itself doesn't branch on which one it is. */
  private async getChoresForRange(
    memberPair: MemberPair,
    frequencyUnit: 'DAY' | 'WEEK',
    from: Date,
    to: Date,
  ): Promise<UserChoresDto[]> {
    const [first, second] = memberPair;

    const chores = await this.prisma.chore.findMany({
      where: { frequencyUnit },
      orderBy: { createdAt: 'asc' },
      include: { subtasks: { orderBy: { position: 'asc' } } },
    });
    const choreById = new Map(chores.map((chore) => [chore.id, chore]));

    const occurrences = this.rotation.getOccurrences(from, to, chores, [
      { id: first.id },
      { id: second.id },
    ]);

    const choresByUser = new Map<string, ChoreDto[]>([
      [first.id, []],
      [second.id, []],
    ]);
    if (occurrences.length === 0) {
      return [
        { user: first, chores: [] },
        { user: second, chores: [] },
      ];
    }

    const completions = await this.prisma.choreCompletion.findMany({
      where: {
        choreId: { in: [...new Set(occurrences.map((o) => o.choreId))] },
        occurrenceDate: { gte: from, lte: to },
      },
    });
    const completionsByChoreAndDate = new Map<string, ChoreCompletion[]>();
    for (const completion of completions) {
      const key = `${completion.choreId}:${formatIsoDateUtc(completion.occurrenceDate)}`;
      const existing = completionsByChoreAndDate.get(key) ?? [];
      existing.push(completion);
      completionsByChoreAndDate.set(key, existing);
    }

    for (const occurrence of occurrences) {
      const chore = choreById.get(occurrence.choreId);
      if (!chore) continue;
      const occurrenceDateStr = formatIsoDateUtc(occurrence.occurrenceDate);
      const completionsForOccurrence =
        completionsByChoreAndDate.get(`${chore.id}:${occurrenceDateStr}`) ?? [];

      choresByUser.get(occurrence.userId)?.push({
        id: chore.id,
        name: chore.name,
        frequencyUnit: chore.frequencyUnit,
        frequencyValue: chore.frequencyValue,
        occurrenceDate: occurrenceDateStr,
        done: isChoreDone(chore, completionsForOccurrence),
        subtasks: chore.subtasks.map((subtask) => ({
          id: subtask.id,
          label: subtask.label,
          done: completionsForOccurrence.some(
            (c) => c.subtaskId === subtask.id,
          ),
        })),
      });
    }

    return [
      { user: first, chores: choresByUser.get(first.id) ?? [] },
      { user: second, chores: choresByUser.get(second.id) ?? [] },
    ];
  }

  async getWeek(userId: string, isoWeek: string): Promise<UserChoresDto[]> {
    const memberPair = await this.getMemberPair(userId);
    if (!memberPair) return [];
    // The Monday of isoWeek — every WEEK-unit chore's occurrenceDate, when
    // it occurs at all, lands exactly here (see rotation.service.ts).
    const weekStart = parseIsoWeek(isoWeek);
    return this.getChoresForRange(memberPair, 'WEEK', weekStart, weekStart);
  }

  async getDay(userId: string, isoDate: string): Promise<UserChoresDto[]> {
    const memberPair = await this.getMemberPair(userId);
    if (!memberPair) return [];
    const date = parseIsoDate(isoDate);
    return this.getChoresForRange(memberPair, 'DAY', date, date);
  }

  async toggleCompletion(
    userId: string,
    choreId: string,
    occurrenceDateStr: string,
  ): Promise<void> {
    const chore = await this.prisma.chore.findUnique({
      where: { id: choreId },
      include: { subtasks: { orderBy: { position: 'asc' } } },
    });
    if (!chore) {
      throw new ApiError(404, 'choreId', 'not_found');
    }
    const occurrenceDate = parseIsoDate(occurrenceDateStr);

    if (chore.subtasks.length === 0) {
      await this.togglePlainCompletion(userId, chore, occurrenceDate);
      return;
    }
    await this.toggleAllSubtaskCompletions(userId, chore, occurrenceDate);
  }

  private async togglePlainCompletion(
    userId: string,
    chore: Chore,
    occurrenceDate: Date,
  ): Promise<void> {
    const existing = await this.prisma.choreCompletion.findFirst({
      where: { choreId: chore.id, occurrenceDate, subtaskId: null },
    });
    if (existing) {
      await this.prisma.choreCompletion.delete({ where: { id: existing.id } });
      return;
    }

    const assignment = await this.assertScheduledAndResolveAssignee(
      userId,
      chore,
      occurrenceDate,
    );
    await this.prisma.choreCompletion.create({
      data: {
        choreId: chore.id,
        userId: assignment.userId,
        occurrenceDate,
        subtaskId: null,
      },
    });
  }

  /** Ticking the parent ticks every subtask; unticking any subtask
   * unticks the parent is handled for free by isChoreDone() being
   * derived, not stored — but toggling the *parent* itself when it's
   * already fully done must untick every subtask together, and vice
   * versa. Both directions bypass the schedule check when only removing
   * completions, mirroring togglePlainCompletion's stale-completion
   * allowance below. */
  private async toggleAllSubtaskCompletions(
    userId: string,
    chore: ChoreWithSubtasks,
    occurrenceDate: Date,
  ): Promise<void> {
    const existing = await this.prisma.choreCompletion.findMany({
      where: { choreId: chore.id, occurrenceDate, subtaskId: { not: null } },
    });
    const completedSubtaskIds = new Set(existing.map((c) => c.subtaskId));
    const allDone = chore.subtasks.every((subtask) =>
      completedSubtaskIds.has(subtask.id),
    );

    if (allDone) {
      await this.prisma.choreCompletion.deleteMany({
        where: { choreId: chore.id, occurrenceDate, subtaskId: { not: null } },
      });
      return;
    }

    const assignment = await this.assertScheduledAndResolveAssignee(
      userId,
      chore,
      occurrenceDate,
    );
    const toCreate = chore.subtasks.filter(
      (subtask) => !completedSubtaskIds.has(subtask.id),
    );
    await this.prisma.$transaction(
      toCreate.map((subtask) =>
        this.prisma.choreCompletion.create({
          data: {
            choreId: chore.id,
            userId: assignment.userId,
            occurrenceDate,
            subtaskId: subtask.id,
          },
        }),
      ),
    );
  }

  async toggleSubtaskCompletion(
    userId: string,
    choreId: string,
    subtaskId: string,
    occurrenceDateStr: string,
  ): Promise<void> {
    const chore = await this.prisma.chore.findUnique({
      where: { id: choreId },
    });
    if (!chore) {
      throw new ApiError(404, 'choreId', 'not_found');
    }
    const subtask = await this.prisma.choreSubtask.findUnique({
      where: { id: subtaskId },
    });
    if (!subtask || subtask.choreId !== choreId) {
      throw new ApiError(404, 'subtaskId', 'not_found');
    }
    const occurrenceDate = parseIsoDate(occurrenceDateStr);

    const existing = await this.prisma.choreCompletion.findFirst({
      where: { choreId, subtaskId, occurrenceDate },
    });
    if (existing) {
      await this.prisma.choreCompletion.delete({ where: { id: existing.id } });
      return;
    }

    const assignment = await this.assertScheduledAndResolveAssignee(
      userId,
      chore,
      occurrenceDate,
    );
    await this.prisma.choreCompletion.create({
      data: { choreId, userId: assignment.userId, occurrenceDate, subtaskId },
    });
  }

  private async assertScheduledAndResolveAssignee(
    userId: string,
    chore: Chore,
    occurrenceDate: Date,
  ): Promise<{ userId: string }> {
    const memberPair = await this.getMemberPair(userId);
    if (!memberPair) {
      throw new ApiError(409, 'form', 'household_incomplete');
    }
    const [first, second] = memberPair;
    const assignment = this.rotation.getChoreAssignment(occurrenceDate, chore, [
      { id: first.id },
      { id: second.id },
    ]);
    if (!assignment) {
      throw new ApiError(409, 'form', 'chore_not_scheduled');
    }
    return assignment;
  }
}
