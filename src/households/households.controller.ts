import { Controller, Get } from '@nestjs/common';

import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import { HouseholdsService } from './households.service';

@Controller('households')
export class HouseholdsController {
  constructor(private readonly households: HouseholdsService) {}

  @Get('me')
  getMe(@CurrentUser() user: JwtPayload) {
    return this.households.getForUser(user.sub);
  }
}
