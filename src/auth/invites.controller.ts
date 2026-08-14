import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';

import { ApiError } from '../common/api-error';
import { CurrentUser } from './current-user.decorator';
import { CreateInviteDto } from './dto/create-invite.dto';
import { InvitesService } from './invites.service';
import type { JwtPayload } from './jwt.strategy';
import { Public } from './public.decorator';

@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  // No @Public() — the global JwtAuthGuard requires a signed-in user.
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({
    'login-ip': true,
    'login-identifier': true,
    'forgot-password-ip': true,
    'forgot-password-identifier': true,
  })
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateInviteDto) {
    return this.invites.create(user.sub, dto.email);
  }

  // Public — the register page reads this before anyone is signed in.
  @Public()
  @Get(':token')
  async getByToken(@Param('token') token: string) {
    const invite = await this.invites.findUsableByToken(token);
    if (!invite) {
      throw new ApiError(404, 'token', 'not_found');
    }
    return invite;
  }
}
