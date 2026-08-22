import 'dotenv/config';

import { NestFactory } from '@nestjs/core';

import { ClimateBackfillModule } from './climate-backfill.module';
import { ClimateSummaryService } from './climate-summary.service';

// One-off command to populate daily_summaries for past dates — needed
// before the retention purge first runs for real, so existing raw history
// isn't lost unaggregated. Deliberately calls summarizeDay() only, never
// purgeOlderThan(): a manual backfill run should never delete anything.
// Safe to re-run for the same date (summarizeDay() upserts).
async function run() {
  const dates = process.argv.slice(2);
  if (dates.length === 0) {
    console.error(
      'Usage: node dist/climate/backfill-daily-summary.js <YYYY-MM-DD> [<YYYY-MM-DD> ...]',
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(
    ClimateBackfillModule,
    {
      logger: ['warn', 'error'],
    },
  );
  try {
    const service = app.get(ClimateSummaryService);
    for (const date of dates) {
      const { written } = await service.summarizeDay(date);
      console.log(`${date}: wrote ${written} summary row(s)`);
    }
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
