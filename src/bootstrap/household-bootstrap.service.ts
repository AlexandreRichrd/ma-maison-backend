import { Injectable } from '@nestjs/common';

import { InvitesService } from '../auth/invites.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HouseholdBootstrapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invites: InvitesService,
    private readonly mail: MailService,
  ) {}

  /**
   * Creates the household row and issues its first invite. Refuses to run
   * against a database that already has one — this seeds an empty
   * database, it doesn't reset an existing one.
   */
  async bootstrap(email: string): Promise<{ link: string }> {
    const existing = await this.prisma.household.findFirst();
    if (existing) {
      throw new Error(
        'A household already exists — bootstrap only runs once, against an empty database.',
      );
    }

    const household = await this.prisma.household.create({ data: {} });
    const invite = await this.invites.createBootstrap(household.id, email);

    return { link: this.mail.registerLink(invite.token) };
  }
}
