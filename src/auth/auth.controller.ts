import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';

import { AuthService } from './auth.service';
import { ActivateDto } from './dto/activate.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Public } from './public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  // Only the login-scoped throttlers apply here — every other named
  // throttler would otherwise also run (and increment) on every login
  // request.
  @SkipThrottle({
    'invite-ip': true,
    'invite-user': true,
    'forgot-password-ip': true,
    'forgot-password-identifier': true,
  })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @HttpCode(200)
  @Post('activate')
  activate(@Body() dto: ActivateDto) {
    return this.auth.activate(dto.token);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  // Only the forgot-password-scoped throttlers apply here — see login's
  // comment above.
  @SkipThrottle({
    'login-ip': true,
    'login-identifier': true,
    'invite-ip': true,
    'invite-user': true,
  })
  @HttpCode(200)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  // No throttle guard, same as activate — the token is a 32-byte-hex
  // unguessable value, not a brute-forceable identifier, so there's
  // nothing a request-volume limit here would protect against.
  @Public()
  @HttpCode(200)
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }
}
