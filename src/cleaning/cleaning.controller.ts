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
import { GetCleaningQueryDto } from './dto/get-cleaning-query.dto';
import { ToggleChoreDto } from './dto/toggle-chore.dto';

@Controller()
export class CleaningController {
  constructor(private readonly cleaning: CleaningService) {}

  @Get('cleaning')
  getWeek(
    @CurrentUser() user: JwtPayload,
    @Query() query: GetCleaningQueryDto,
  ) {
    return this.cleaning.getWeek(user.sub, query.week);
  }

  @HttpCode(204)
  @Patch('cleaning/chores/:choreId/toggle')
  toggle(
    @CurrentUser() user: JwtPayload,
    @Param('choreId', ParseUUIDPipe) choreId: string,
    @Body() dto: ToggleChoreDto,
  ) {
    return this.cleaning.toggleCompletion(user.sub, choreId, dto.isoWeek);
  }
}
