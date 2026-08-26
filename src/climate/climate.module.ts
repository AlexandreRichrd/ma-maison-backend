import { Module } from '@nestjs/common';

import { MailModule } from '../mail/mail.module';
import { ClimateAlertMailListener } from './climate-alert-mail.listener';
import { ClimateAlertTriggerService } from './climate-alert-trigger.service';
import { ClimateController } from './climate.controller';
import { ClimateGateway } from './climate.gateway';
import { ClimateSummaryService } from './climate-summary.service';
import { ClimateService } from './climate.service';

// Owns: measures (sensor readings ingested from the household's Pi bridge,
// see intranet's pi/), GET /climate/current for the dashboard widget,
// ClimateGateway (the /climate websocket namespace pushing live readings
// to that same widget — see WsAuthAdapter for handshake auth),
// ClimateSummaryService (nightly daily_summaries aggregation + measures
// retention purge, GET /climate/summaries), and ClimateAlertTriggerService
// + ClimateAlertMailListener (cool-down/close-up window alerts — see
// CLAUDE.md's Climate section). Device registration is still unbuilt — see
// CLAUDE.md's Not in scope yet.
@Module({
  imports: [MailModule],
  controllers: [ClimateController],
  providers: [
    ClimateService,
    ClimateGateway,
    ClimateSummaryService,
    ClimateAlertTriggerService,
    ClimateAlertMailListener,
  ],
})
export class ClimateModule {}
