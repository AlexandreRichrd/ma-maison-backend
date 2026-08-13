import { Injectable } from '@nestjs/common';

import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { RotationService, type UserAssignment } from './rotation.service';

/**
 * The only shape household-roster data is exposed as from this service — no
 * passwordHash, no email. See my-home-backend/CLAUDE.md's Database section:
 * a bare `select()` on `users` let password_hash ride along into SSR
 * payloads before, so this is always an explicit column list.
 */
export type HouseholdMemberDto = {
  id: string;
  name: string;
  avatarKey: string;
  role: string;
};

export type ChoreDto = {
  id: string;
  name: string;
  frequency: 'weekly' | 'biweekly';
  done: boolean;
};

export type UserWeekChoresDto = {
  user: HouseholdMemberDto;
  chores: ChoreDto[];
};

type ResolvedAssignment = {
  users: [HouseholdMemberDto, HouseholdMemberDto];
  assignment: [UserAssignment, UserAssignment];
};

@Injectable()
export class CleaningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rotation: RotationService,
  ) {}

  /** Users in `households.member_order` order — stable, so rotation never scrambles. */
  private async getOrderedHouseholdMembers(
    userId: string,
  ): Promise<HouseholdMemberDto[]> {
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { householdId: true },
    });
    if (!currentUser) return [];

    const household = await this.prisma.household.findUnique({
      where: { id: currentUser.householdId },
    });
    if (!household) return [];

    const members = await this.prisma.user.findMany({
      where: { householdId: household.id },
      select: { id: true, name: true, avatarKey: true, role: true },
    });
    const byId = new Map(members.map((member) => [member.id, member]));

    return household.memberOrder
      .map((id) => byId.get(id))
      .filter((member): member is HouseholdMemberDto => member != null);
  }

  private async resolveAssignment(
    userId: string,
    isoWeek: string,
  ): Promise<ResolvedAssignment | null> {
    const members = await this.getOrderedHouseholdMembers(userId);
    if (members.length < 2) return null;
    const [first, second] = members as [HouseholdMemberDto, HouseholdMemberDto];

    const assignment = this.rotation.getWeekAssignment(isoWeek, [
      { id: first.id },
      { id: second.id },
    ]);
    return { users: [first, second], assignment };
  }

  async getWeek(userId: string, isoWeek: string): Promise<UserWeekChoresDto[]> {
    const resolved = await this.resolveAssignment(userId, isoWeek);
    if (!resolved) return [];
    const { users, assignment } = resolved;

    const [allChores, completions] = await Promise.all([
      this.prisma.chore.findMany(),
      this.prisma.choreCompletion.findMany({ where: { isoWeek } }),
    ]);
    const completedChoreIds = new Set(completions.map((c) => c.choreId));

    const byGroup = (group: string) =>
      allChores.filter((chore) => chore.rotationGroup === group);

    const buildForUser = (
      userAssignment: UserAssignment,
      user: HouseholdMemberDto,
    ): UserWeekChoresDto => ({
      user,
      chores: [
        ...byGroup(userAssignment.weeklyGroup).map((chore) => ({
          id: chore.id,
          name: chore.name,
          frequency: 'weekly' as const,
          done: completedChoreIds.has(chore.id),
        })),
        ...byGroup(userAssignment.biweeklyGroup).map((chore) => ({
          id: chore.id,
          name: chore.name,
          frequency: 'biweekly' as const,
          done: completedChoreIds.has(chore.id),
        })),
      ],
    });

    return [
      buildForUser(assignment[0], users[0]),
      buildForUser(assignment[1], users[1]),
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

    const resolved = await this.resolveAssignment(userId, isoWeek);
    if (!resolved) {
      throw new ApiError(409, 'form', 'household_incomplete');
    }
    const assignee = resolved.assignment.find(
      (a) =>
        a.weeklyGroup === chore.rotationGroup ||
        a.biweeklyGroup === chore.rotationGroup,
    );
    if (!assignee) {
      throw new ApiError(409, 'form', 'assignment_not_found');
    }

    await this.prisma.choreCompletion.create({
      data: { choreId, userId: assignee.userId, isoWeek },
    });
  }
}
