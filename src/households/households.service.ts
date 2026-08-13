import { Injectable } from '@nestjs/common';

import { toPublicUser, type PublicUser } from '../auth/auth.service';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';

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
}
