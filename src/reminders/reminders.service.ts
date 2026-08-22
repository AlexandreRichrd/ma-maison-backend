import { Injectable } from '@nestjs/common';
import { addDays, endOfDay } from 'date-fns';
import type { Reminder } from '@prisma/client';

import { ApiError } from '../common/api-error';
import { parseIsoDate } from '../cleaning/iso-date.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReminderDto } from './dto/create-reminder.dto';

@Injectable()
export class RemindersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Unfiltered (from/to both omitted) for the flat list — bounded to
   * [from, to] inclusive, by calendar day, for the week/month calendar
   * views. Both-or-neither: a lone from or to is almost certainly a caller
   * bug, not a valid request. */
  async list(from?: string, to?: string): Promise<Reminder[]> {
    if ((from && !to) || (to && !from)) {
      throw new ApiError(400, 'from', 'range_incomplete');
    }

    return this.prisma.reminder.findMany({
      where:
        from && to
          ? {
              dueAt: {
                gte: parseIsoDate(from),
                lt: addDays(parseIsoDate(to), 1),
              },
            }
          : undefined,
      orderBy: { dueAt: 'asc' },
    });
  }

  /** Undone reminders due by end of today, for the dashboard widget. */
  async dueToday(): Promise<Reminder[]> {
    return this.prisma.reminder.findMany({
      where: { doneAt: null, dueAt: { lte: endOfDay(new Date()) } },
      orderBy: { dueAt: 'asc' },
    });
  }

  async create(dto: CreateReminderDto): Promise<Reminder> {
    if (dto.assigneeIds.length > 0) {
      // assignee_ids has no FK (see schema comment) — the API is the only
      // thing that can catch a bogus id before it's stored.
      const existing = await this.prisma.user.findMany({
        where: { id: { in: dto.assigneeIds } },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((user) => user.id));
      if (!dto.assigneeIds.every((id) => existingIds.has(id))) {
        throw new ApiError(400, 'assigneeIds', 'invalid_id');
      }
    }

    return this.prisma.reminder.create({
      data: {
        title: dto.title,
        dueAt: new Date(dto.dueAt),
        assigneeIds: dto.assigneeIds,
      },
    });
  }

  /** doneAt is nullable, not a boolean — undo sets it back to null. */
  async toggle(id: string): Promise<Reminder> {
    const reminder = await this.prisma.reminder.findUnique({ where: { id } });
    if (!reminder) {
      throw new ApiError(404, 'id', 'not_found');
    }

    return this.prisma.reminder.update({
      where: { id },
      data: { doneAt: reminder.doneAt ? null : new Date() },
    });
  }
}
