import { Injectable } from '@nestjs/common';

import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import {
  HouseholdMembersService,
  type HouseholdMemberDto,
} from './household-members.service';
import { parseIsoWeek } from './iso-week.util';
import { RotationService } from './rotation.service';

export type ChoreDto = {
  id: string;
  name: string;
  frequencyUnit: 'DAY' | 'WEEK';
  frequencyValue: number;
  done: boolean;
};

export type UserWeekChoresDto = {
  user: HouseholdMemberDto;
  chores: ChoreDto[];
};

@Injectable()
export class CleaningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rotation: RotationService,
    private readonly householdMembers: HouseholdMembersService,
  ) {}

  private async getMemberPair(
    userId: string,
  ): Promise<[HouseholdMemberDto, HouseholdMemberDto] | null> {
    const members = await this.householdMembers.getOrderedMembers(userId);
    if (members.length < 2) return null;
    return members as [HouseholdMemberDto, HouseholdMemberDto];
  }

  async getWeek(userId: string, isoWeek: string): Promise<UserWeekChoresDto[]> {
    const memberPair = await this.getMemberPair(userId);
    if (!memberPair) return [];
    const [first, second] = memberPair;

    // The Monday of isoWeek — every WEEK-unit chore's occurrenceDate, when
    // it occurs at all, lands exactly here (see rotation.service.ts).
    const weekStart = parseIsoWeek(isoWeek);

    const [chores, completions] = await Promise.all([
      this.prisma.chore.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.choreCompletion.findMany({ where: { isoWeek } }),
    ]);
    const completedChoreIds = new Set(completions.map((c) => c.choreId));
    const choreById = new Map(chores.map((chore) => [chore.id, chore]));

    const occurrences = this.rotation.getOccurrences(
      weekStart,
      weekStart,
      chores,
      [{ id: first.id }, { id: second.id }],
    );

    const choresByUser = new Map<string, ChoreDto[]>([
      [first.id, []],
      [second.id, []],
    ]);
    for (const occurrence of occurrences) {
      const chore = choreById.get(occurrence.choreId);
      if (!chore) continue;
      choresByUser.get(occurrence.userId)?.push({
        id: chore.id,
        name: chore.name,
        frequencyUnit: chore.frequencyUnit,
        frequencyValue: chore.frequencyValue,
        done: completedChoreIds.has(chore.id),
      });
    }

    return [
      { user: first, chores: choresByUser.get(first.id) ?? [] },
      { user: second, chores: choresByUser.get(second.id) ?? [] },
    ];
  }

  async toggleCompletion(
    userId: string,
    choreId: string,
    isoWeek: string,
  ): Promise<void> {
    const chore = await this.prisma.chore.findUnique({
      where: { id: choreId },
    });
    if (!chore) {
      throw new ApiError(404, 'choreId', 'not_found');
    }

    const existing = await this.prisma.choreCompletion.findUnique({
      where: { choreId_isoWeek: { choreId, isoWeek } },
    });

    if (existing) {
      await this.prisma.choreCompletion.delete({ where: { id: existing.id } });
      return;
    }

    const memberPair = await this.getMemberPair(userId);
    if (!memberPair) {
      throw new ApiError(409, 'form', 'household_incomplete');
    }
    const [first, second] = memberPair;

    const assignment = this.rotation.getChoreAssignment(
      parseIsoWeek(isoWeek),
      chore,
      [{ id: first.id }, { id: second.id }],
    );
    if (!assignment) {
      throw new ApiError(409, 'form', 'chore_not_scheduled');
    }

    await this.prisma.choreCompletion.create({
      data: { choreId, userId: assignment.userId, isoWeek },
    });
  }
}
