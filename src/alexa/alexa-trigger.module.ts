import { Module } from '@nestjs/common';

import { AlexaLwaTokenService } from './alexa-lwa-token.service';
import { AlexaProactiveEventListener } from './alexa-proactive-event.listener';

// For trigger-proactive-event.ts only. Deliberately doesn't import
// ClimateModule/PrismaModule — AlexaProactiveEventListener needs neither
// (this channel never reads live readings, only the trigger's direction +
// firing time), same "only import what the script needs" reasoning as
// ClimateBackfillModule skipping ClimateModule's websocket gateway.
@Module({
  providers: [AlexaLwaTokenService, AlexaProactiveEventListener],
})
export class AlexaTriggerModule {}
