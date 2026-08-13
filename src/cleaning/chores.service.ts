import { Injectable } from '@nestjs/common';
import type { Chore } from '@prisma/client';

import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChoreDto } from './dto/create-chore.dto';
import { UpdateChoreDto } from './dto/update-chore.dto';
import { HouseholdMembersService } from './household-members.service';

@Injectable()
export class ChoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly householdMembers: HouseholdMembersService,
  ) {}

  async list(): Promise<Chore[]> {
    return this.prisma.chore.findMany({ orderBy: { createdAt: 'asc' } });
  }

  /** anchorUserId can't be validated in the DTO — it needs the caller's household. */
  private async assertHouseholdMember(
    userId: string,
    anchorUserId: string,
  ): Promise<void> {
    const members = await this.householdMembers.getOrderedMembers(userId);
    if (!members.some((member) => member.id === anchorUserId)) {
      throw new ApiError(400, 'anchorUserId', 'invalid_id');
    }
  }

  async create(userId: string, dto: CreateChoreDto): Promise<Chore> {
    await this.assertHouseholdMember(userId, dto.anchorUserId);

    return this.prisma.chore.create({
      data: {
        name: dto.name,
        frequencyWeeks: dto.frequencyWeeks,
        assignmentMode: dto.assignmentMode,
        anchorIsoWeek: dto.anchorIsoWeek,
        anchorUserId: dto.anchorUserId,
      },
    });
  }

  async update(
    userId: string,
    choreId: string,
    dto: UpdateChoreDto,
  ): Promise<Chore> {
    const existing = await this.prisma.chore.findUnique({
      where: { id: choreId },
    });
    if (!existing) {
      throw new ApiError(404, 'choreId', 'not_found');
    }
    if (dto.anchorUserId) {
      await this.assertHouseholdMember(userId, dto.anchorUserId);
    }

    return this.prisma.chore.update({
      where: { id: choreId },
      data: {
        name: dto.name,
        frequencyWeeks: dto.frequencyWeeks,
        assignmentMode: dto.assignmentMode,
        anchorIsoWeek: dto.anchorIsoWeek,
        anchorUserId: dto.anchorUserId,
      },
    });
  }

  /** Cascades to ChoreCompletion (see schema.prisma) — completion history goes with it. */
  async remove(choreId: string): Promise<void> {
    const existing = await this.prisma.chore.findUnique({
      where: { id: choreId },
    });
    if (!existing) {
      throw new ApiError(404, 'choreId', 'not_found');
    }
    await this.prisma.chore.delete({ where: { id: choreId } });
  }
}
