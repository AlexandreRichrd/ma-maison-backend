import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { Public } from '../auth/public.decorator';
import { ClimateService } from './climate.service';
import { DeviceAuthGuard } from './device-auth.guard';
import { IngestMeasuresDto } from './dto/ingest-measures.dto';

@Controller('climate')
export class ClimateController {
  constructor(private readonly climate: ClimateService) {}

  // @Public() only opts this route out of the global JwtAuthGuard (which
  // expects a user's JWT) — DeviceAuthGuard still runs and requires the
  // household Pi bridge's own static bearer token.
  @Public()
  @UseGuards(DeviceAuthGuard)
  @Post('measures')
  ingest(@Body() dto: IngestMeasuresDto) {
    return this.climate.ingest(dto.measures);
  }
}
