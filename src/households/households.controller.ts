import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { HouseholdsService } from './households.service';

@Controller('households')
export class HouseholdsController {
  constructor(private readonly households: HouseholdsService) {}

  @Get('me')
  getMe(@CurrentUser() user: JwtPayload) {
    return this.households.getForUser(user.sub);
  }

  // Any signed-in household member can toggle any member's own flag,
  // including their own — this app has no per-user authorization
  // boundary anywhere else either (two-person household, no roles).
  @Patch('me/members/:userId/notification-preferences')
  updateNotificationPreferences(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.households.updateNotificationPreferences(user.sub, userId, dto);
  }
}
