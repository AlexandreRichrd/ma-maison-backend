import { Module } from '@nestjs/common';

import { InvitesService } from '../auth/invites.service';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';
import { HouseholdBootstrapService } from './household-bootstrap.service';

// Deliberately doesn't import AuthModule: that would pull in JwtModule,
// PassportModule, and the global JwtAuthGuard, none of which the bootstrap
// script needs and JwtModule requires JWT_PRIVATE_KEY/JWT_PUBLIC_KEY to
// even construct. InvitesService only depends on Prisma + Mail, so it's
// declared here directly instead.
@Module({
  imports: [PrismaModule, MailModule],
  providers: [InvitesService, HouseholdBootstrapService],
})
export class BootstrapModule {}
