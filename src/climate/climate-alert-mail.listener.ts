import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ClimateAlertEvent } from './events/climate-alert.event';

/**
 * The only channel wired up today for 'climate.alert.triggered' (see
 * ClimateAlertTriggerService and CLAUDE.md's Climate alerts section) — only
 * users with receiveClimateAlerts set (default true, per issue #11) get the
 * email.
 */
@Injectable()
export class ClimateAlertMailListener {
  private readonly logger = new Logger(ClimateAlertMailListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  @OnEvent('climate.alert.triggered')
  async handleClimateAlert(event: ClimateAlertEvent): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { receiveClimateAlerts: true },
      select: { email: true },
    });
    await Promise.all(
      users.map((user) =>
        this.mail.sendClimateAlertEmail(user.email, event).catch((error) => {
          this.logger.error(
            `failed to send climate alert email to ${user.email}`,
            error,
          );
        }),
      ),
    );
  }
}
