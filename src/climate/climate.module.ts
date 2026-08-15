import { Module } from '@nestjs/common';

import { ClimateController } from './climate.controller';
import { ClimateService } from './climate.service';

// Owns: measures (sensor readings ingested from the household's Pi bridge,
// see intranet's pi/), plus GET /climate/current for the dashboard widget.
// Device registration is still unbuilt — see CLAUDE.md's Not in scope yet.
@Module({
  controllers: [ClimateController],
  providers: [ClimateService],
})
export class ClimateModule {}
