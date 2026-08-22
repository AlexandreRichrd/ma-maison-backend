import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module';
import { ClimateSummaryService } from './climate-summary.service';

// Deliberately doesn't import ClimateModule (which pulls in the websocket
// gateway and its WsAuthAdapter dependency) — the backfill script only
// needs ClimateSummaryService, same reasoning as BootstrapModule skipping
// AuthModule.
@Module({
  imports: [PrismaModule],
  providers: [ClimateSummaryService],
})
export class ClimateBackfillModule {}
