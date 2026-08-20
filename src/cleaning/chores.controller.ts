import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { ChoreSubtasksService } from './chore-subtasks.service';
import { ChoresService } from './chores.service';
import { CreateChoreSubtaskDto } from './dto/create-chore-subtask.dto';
import { CreateChoreDto } from './dto/create-chore.dto';
import { ReorderChoreSubtasksDto } from './dto/reorder-chore-subtasks.dto';
import { UpdateChoreSubtaskDto } from './dto/update-chore-subtask.dto';
import { UpdateChoreDto } from './dto/update-chore.dto';

@Controller('cleaning/chores')
export class ChoresController {
  constructor(
    private readonly chores: ChoresService,
    private readonly subtasks: ChoreSubtasksService,
  ) {}

  @Get()
  list() {
    return this.chores.list();
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateChoreDto) {
    return this.chores.create(user.sub, dto);
  }

  @Patch(':choreId')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('choreId', ParseUUIDPipe) choreId: string,
    @Body() dto: UpdateChoreDto,
  ) {
    return this.chores.update(user.sub, choreId, dto);
  }

  @HttpCode(204)
  @Delete(':choreId')
  remove(@Param('choreId', ParseUUIDPipe) choreId: string) {
    return this.chores.remove(choreId);
  }

  @Post(':choreId/subtasks')
  addSubtask(
    @Param('choreId', ParseUUIDPipe) choreId: string,
    @Body() dto: CreateChoreSubtaskDto,
  ) {
    return this.subtasks.add(choreId, dto);
  }

  // Declared before the :subtaskId route below — Nest/Express match routes
  // in registration order, so 'reorder' would otherwise be swallowed by
  // :subtaskId (matching the literal string "reorder" as an id). Covered
  // by an e2e test asserting a reorder request isn't rejected as an
  // invalid-UUID subtaskId.
  @Patch(':choreId/subtasks/reorder')
  reorderSubtasks(
    @Param('choreId', ParseUUIDPipe) choreId: string,
    @Body() dto: ReorderChoreSubtasksDto,
  ) {
    return this.subtasks.reorder(choreId, dto);
  }

  @Patch(':choreId/subtasks/:subtaskId')
  updateSubtask(
    @Param('choreId', ParseUUIDPipe) choreId: string,
    @Param('subtaskId', ParseUUIDPipe) subtaskId: string,
    @Body() dto: UpdateChoreSubtaskDto,
  ) {
    return this.subtasks.update(choreId, subtaskId, dto);
  }

  @HttpCode(204)
  @Delete(':choreId/subtasks/:subtaskId')
  removeSubtask(
    @Param('choreId', ParseUUIDPipe) choreId: string,
    @Param('subtaskId', ParseUUIDPipe) subtaskId: string,
  ) {
    return this.subtasks.remove(choreId, subtaskId);
  }
}
