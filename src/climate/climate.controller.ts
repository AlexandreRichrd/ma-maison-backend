import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';

import { Public } from '../auth/public.decorator';
import { ClimateSummaryService } from './climate-summary.service';
import { ClimateService } from './climate.service';
import { DeviceAuthGuard } from './device-auth.guard';
import { GetClimateSummariesQueryDto } from './dto/get-climate-summaries-query.dto';
import { IngestMeasuresDto } from './dto/ingest-measures.dto';

@Controller('climate')
export class ClimateController {
  constructor(
    private readonly climate: ClimateService,
    private readonly climateSummary: ClimateSummaryService,
  ) {}

  // @Public() only opts this route out of the global JwtAuthGuard (which
  // expects a user's JWT) — DeviceAuthGuard still runs and requires the
  // household Pi bridge's own static bearer token.
  @Public()
  @UseGuards(DeviceAuthGuard)
  @Post('measures')
  ingest(@Body() dto: IngestMeasuresDto) {
    return this.climate.ingest(dto.measures);
  }

  // No @Public() — this is for the signed-in dashboard, covered by the
  // global JwtAuthGuard like every other read endpoint.
  @Get('current')
  getCurrent() {
    return this.climate.getCurrent();
  }

  // Daily min/max/avg history for a device, for the dashboard's per-sensor
  // detail view — see CLAUDE.md's Climate section. No @Public(): behind the
  // global JwtAuthGuard like every other read endpoint.
  @Get('summaries')
  getSummaries(@Query() query: GetClimateSummariesQueryDto) {
    return this.climateSummary.getSummaries(
      query.deviceName,
      query.from,
      query.to,
    );
  }
}
