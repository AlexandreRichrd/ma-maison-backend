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
import { ChoresService } from './chores.service';
import { CreateChoreDto } from './dto/create-chore.dto';
import { UpdateChoreDto } from './dto/update-chore.dto';

@Controller('cleaning/chores')
export class ChoresController {
  constructor(private readonly chores: ChoresService) {}

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
}
