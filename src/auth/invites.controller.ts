import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';

import { CurrentUser } from './current-user.decorator';
import { CreateInviteDto } from './dto/create-invite.dto';
import { InvitesService } from './invites.service';
import type { JwtPayload } from './jwt.strategy';

@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  // No @Public() — the global JwtAuthGuard requires a signed-in user.
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ 'login-ip': true, 'login-identifier': true })
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateInviteDto) {
    return this.invites.create(user.sub, dto.email);
  }
}
