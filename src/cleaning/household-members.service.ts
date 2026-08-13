import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

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

@Injectable()
export class HouseholdMembersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Users in `households.member_order` order — stable, so rotation never scrambles. */
  async getOrderedMembers(userId: string): Promise<HouseholdMemberDto[]> {
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
}
