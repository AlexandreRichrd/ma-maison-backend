import { Injectable } from '@nestjs/common';

import { toPublicUser, type PublicUser } from '../auth/auth.service';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';

export type HouseholdMeResult = {
  users: PublicUser[];
  memberOrder: string[];
};

@Injectable()
export class HouseholdsService {
  constructor(private readonly prisma: PrismaService) {}

  async getForUser(userId: string): Promise<HouseholdMeResult> {
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { householdId: true },
    });
    if (!currentUser) {
      // The token decoded fine, but the user it names is gone.
      throw new ApiError(401, 'authorization', 'unauthenticated');
    }

    const household = await this.prisma.household.findUniqueOrThrow({
      where: { id: currentUser.householdId },
    });
    const users = await this.prisma.user.findMany({
      where: { householdId: household.id },
    });

    return {
      users: users.map(toPublicUser),
      memberOrder: household.memberOrder,
    };
  }

  // targetUserId can't be validated in the DTO — it needs the caller's
  // household, same reasoning as ChoresService.assertHouseholdMember.
  async updateNotificationPreferences(
    callerUserId: string,
    targetUserId: string,
    dto: UpdateNotificationPreferencesDto,
  ): Promise<PublicUser> {
    const caller = await this.prisma.user.findUnique({
      where: { id: callerUserId },
      select: { householdId: true },
    });
    if (!caller) {
      throw new ApiError(401, 'authorization', 'unauthenticated');
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });
    if (!target || target.householdId !== caller.householdId) {
      throw new ApiError(400, 'userId', 'invalid_id');
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { receiveClimateAlerts: dto.receiveClimateAlerts },
    });
    return toPublicUser(updated);
  }
}
