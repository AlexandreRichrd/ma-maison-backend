import { Module } from '@nestjs/common';

import { ClimateModule } from '../climate/climate.module';
import { AlexaController } from './alexa.controller';
import { AlexaLwaTokenService } from './alexa-lwa-token.service';
import { AlexaProactiveEventListener } from './alexa-proactive-event.listener';
import { AlexaService } from './alexa.service';
import { AlexaSignatureGuard } from './alexa-signature.guard';

// Owns both halves of the Alexa integration (issue #13/#14), same feature
// area: POST /alexa, the inbound endpoint the skill calls for LaunchRequest
// and the current-conditions intent; and AlexaProactiveEventListener, the
// outbound channel that pushes a silent proactive event on
// 'climate.alert.triggered' — see CLAUDE.md's Alexa section. Imports
// ClimateModule for ClimateService's getCurrent(), used by the inbound
// side only; the outbound listener never sends readings, only the signal.
@Module({
  imports: [ClimateModule],
  controllers: [AlexaController],
  providers: [
    AlexaService,
    AlexaSignatureGuard,
    AlexaLwaTokenService,
    AlexaProactiveEventListener,
  ],
})
export class AlexaModule {}
