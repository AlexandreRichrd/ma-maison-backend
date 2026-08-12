import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { StringValue } from 'ms';

import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtStrategy } from './jwt.strategy';

// Owns: households, users, invites, email_verifications. CLAUDE.md's module
// tree splits a households/ module (GET /households/me) and a mail/ module
// out of this one — mail is its own module already; households stays
// folded in here until that controller lands.
@Module({
  imports: [
    MailModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: (process.env.JWT_EXPIRES_IN ?? '30d') as StringValue,
      },
    }),
  ],
  controllers: [AuthController, InvitesController],
  providers: [
    AuthService,
    InvitesService,
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AuthModule {}
