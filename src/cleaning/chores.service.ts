import { Injectable } from '@nestjs/common';
import type { Chore } from '@prisma/client';

import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChoreDto } from './dto/create-chore.dto';
import { UpdateChoreDto } from './dto/update-chore.dto';
import { HouseholdMembersService } from './household-members.service';
import { isoDayOfWeekUtc, parseIsoDate } from './iso-date.util';

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

  /**
   * anchorDate must be a Monday whenever the *effective* frequencyUnit is
   * WEEK, otherwise the weekly persistent block drifts out of alignment
   * with the chore's actual occurrences. Checked here rather than in the
   * DTO because on an update either field can be omitted — the value this
   * needs to validate against depends on what's already on the row.
   */
  private assertAnchorAligned(
    frequencyUnit: 'DAY' | 'WEEK',
    anchorDate: Date,
  ): void {
    if (frequencyUnit === 'WEEK' && isoDayOfWeekUtc(anchorDate) !== 1) {
      throw new ApiError(400, 'anchorDate', 'anchor_date_not_monday');
    }
  }

  async create(userId: string, dto: CreateChoreDto): Promise<Chore> {
    await this.assertHouseholdMember(userId, dto.anchorUserId);
    const anchorDate = parseIsoDate(dto.anchorDate);
    this.assertAnchorAligned(dto.frequencyUnit, anchorDate);

    return this.prisma.chore.create({
      data: {
        name: dto.name,
        frequencyUnit: dto.frequencyUnit,
        frequencyValue: dto.frequencyValue,
        assignmentMode: dto.assignmentMode,
        anchorDate,
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

    const effectiveFrequencyUnit = dto.frequencyUnit ?? existing.frequencyUnit;
    const anchorDate = dto.anchorDate
      ? parseIsoDate(dto.anchorDate)
      : existing.anchorDate;
    this.assertAnchorAligned(effectiveFrequencyUnit, anchorDate);

    return this.prisma.chore.update({
      where: { id: choreId },
      data: {
        name: dto.name,
        frequencyUnit: dto.frequencyUnit,
        frequencyValue: dto.frequencyValue,
        assignmentMode: dto.assignmentMode,
        anchorDate: dto.anchorDate ? anchorDate : undefined,
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
