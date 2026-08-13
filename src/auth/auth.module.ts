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
import { getJwtPrivateKey, getJwtPublicKey } from './jwt-keys';
import { JwtStrategy } from './jwt.strategy';

// Owns: users, invites, email_verifications, and household *growth*
// (invites, register append to member_order). Reading the household
// roster is households/households.module.ts's GET /households/me instead.
@Module({
  imports: [
    MailModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      privateKey: getJwtPrivateKey(),
      publicKey: getJwtPublicKey(),
      signOptions: {
        algorithm: 'RS256',
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
