import { Injectable } from '@nestjs/common';
import type { ChoreSubtask } from '@prisma/client';

import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChoreSubtaskDto } from './dto/create-chore-subtask.dto';
import { ReorderChoreSubtasksDto } from './dto/reorder-chore-subtasks.dto';
import { UpdateChoreSubtaskDto } from './dto/update-chore-subtask.dto';

@Injectable()
export class ChoreSubtasksService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertChoreExists(choreId: string): Promise<void> {
    const chore = await this.prisma.chore.findUnique({
      where: { id: choreId },
    });
    if (!chore) {
      throw new ApiError(404, 'choreId', 'not_found');
    }
  }

  private async findOwnedSubtask(
    choreId: string,
    subtaskId: string,
  ): Promise<ChoreSubtask> {
    const subtask = await this.prisma.choreSubtask.findUnique({
      where: { id: subtaskId },
    });
    if (!subtask || subtask.choreId !== choreId) {
      throw new ApiError(404, 'subtaskId', 'not_found');
    }
    return subtask;
  }

  /** Always appends at the end — reordering is a separate endpoint. */
  async add(
    choreId: string,
    dto: CreateChoreSubtaskDto,
  ): Promise<ChoreSubtask> {
    await this.assertChoreExists(choreId);
    const position = await this.prisma.choreSubtask.count({
      where: { choreId },
    });
    return this.prisma.choreSubtask.create({
      data: { choreId, label: dto.label, position },
    });
  }

  /** Label only — position is never touched here, see reorder(). */
  async update(
    choreId: string,
    subtaskId: string,
    dto: UpdateChoreSubtaskDto,
  ): Promise<ChoreSubtask> {
    await this.findOwnedSubtask(choreId, subtaskId);
    return this.prisma.choreSubtask.update({
      where: { id: subtaskId },
      data: { label: dto.label },
    });
  }

  /** Cascades to ChoreCompletion rows keyed to this subtask. */
  async remove(choreId: string, subtaskId: string): Promise<void> {
    await this.findOwnedSubtask(choreId, subtaskId);
    await this.prisma.choreSubtask.delete({ where: { id: subtaskId } });
  }

  /**
   * subtaskIds is the full ordered list — position is derived from array
   * index. Rejects a set that doesn't exactly match the chore's current
   * subtasks (not partial, not from another chore), since a partial
   * reorder would leave the omitted subtasks' positions undefined.
   */
  async reorder(
    choreId: string,
    dto: ReorderChoreSubtasksDto,
  ): Promise<ChoreSubtask[]> {
    await this.assertChoreExists(choreId);
    const existing = await this.prisma.choreSubtask.findMany({
      where: { choreId },
    });
    const existingIds = new Set(existing.map((subtask) => subtask.id));
    const givenIds = new Set(dto.subtaskIds);
    const sameSet =
      existingIds.size === givenIds.size &&
      dto.subtaskIds.length === existing.length &&
      [...existingIds].every((id) => givenIds.has(id));
    if (!sameSet) {
      throw new ApiError(400, 'subtaskIds', 'invalid_subtask_set');
    }

    await this.prisma.$transaction(
      dto.subtaskIds.map((id, index) =>
        this.prisma.choreSubtask.update({
          where: { id },
          data: { position: index },
        }),
      ),
    );
    return this.prisma.choreSubtask.findMany({
      where: { choreId },
      orderBy: { position: 'asc' },
    });
  }
}
