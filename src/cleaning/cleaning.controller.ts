import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { CleaningService } from './cleaning.service';
import { GetCleaningDayQueryDto } from './dto/get-cleaning-day-query.dto';
import { GetCleaningWeekQueryDto } from './dto/get-cleaning-query.dto';
import { ToggleChoreSubtaskDto } from './dto/toggle-chore-subtask.dto';
import { ToggleChoreDto } from './dto/toggle-chore.dto';

@Controller('cleaning')
export class CleaningController {
  constructor(private readonly cleaning: CleaningService) {}

  // WEEK-unit chores only, grouped by person — the persistent weekly
  // block. DAY-unit chores never appear here, see GET /cleaning/day.
  @Get('week')
  getWeek(
    @CurrentUser() user: JwtPayload,
    @Query() query: GetCleaningWeekQueryDto,
  ) {
    return this.cleaning.getWeek(user.sub, query.week);
  }

  // DAY-unit chores only, grouped by person, for a single day — the day
  // navigator. WEEK-unit chores never appear here, see GET /cleaning/week.
  @Get('day')
  getDay(
    @CurrentUser() user: JwtPayload,
    @Query() query: GetCleaningDayQueryDto,
  ) {
    return this.cleaning.getDay(user.sub, query.date);
  }

  @HttpCode(204)
  @Patch('chores/:choreId/toggle')
  toggle(
    @CurrentUser() user: JwtPayload,
    @Param('choreId', ParseUUIDPipe) choreId: string,
    @Body() dto: ToggleChoreDto,
  ) {
    return this.cleaning.toggleCompletion(
      user.sub,
      choreId,
      dto.occurrenceDate,
    );
  }

  @HttpCode(204)
  @Patch('chores/:choreId/subtasks/:subtaskId/toggle')
  toggleSubtask(
    @CurrentUser() user: JwtPayload,
    @Param('choreId', ParseUUIDPipe) choreId: string,
    @Param('subtaskId', ParseUUIDPipe) subtaskId: string,
    @Body() dto: ToggleChoreSubtaskDto,
  ) {
    return this.cleaning.toggleSubtaskCompletion(
      user.sub,
      choreId,
      subtaskId,
      dto.occurrenceDate,
    );
  }
}
