import { Module } from '@nestjs/common';

import { ClimateModule } from '../climate/climate.module';
import { AlexaController } from './alexa.controller';
import { AlexaService } from './alexa.service';
import { AlexaSignatureGuard } from './alexa-signature.guard';

// Owns: POST /alexa, the single inbound endpoint the Alexa skill (see
// CLAUDE.md's Alexa section, issue #13) calls for LaunchRequest and the
// current-conditions intent. Imports ClimateModule for ClimateService's
// getCurrent() — the same reading the dashboard widget uses, read fresh on
// every request, never cached here.
@Module({
  imports: [ClimateModule],
  controllers: [AlexaController],
  providers: [AlexaService, AlexaSignatureGuard],
})
export class AlexaModule {}
