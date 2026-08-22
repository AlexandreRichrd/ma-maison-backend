import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { parseIsoDate } from '../cleaning/iso-date.util';
import { PrismaService } from '../prisma/prisma.service';
import { KNOWN_MEASURE_TYPES } from './known-measure-types';
import {
  PARIS_TIME_ZONE,
  parisDayBoundsUtc,
  purgeCutoffUtc,
  yesterdayParisDate,
} from './paris-time.util';

const DEFAULT_RETENTION_DAYS = 7;

type RawSummaryRow = {
  deviceName: string;
  type: string;
  min: string;
  max: string;
  avg: string;
  sampleCount: number;
};

export type DailySummaryReading = {
  type: string;
  date: Date;
  min: Prisma.Decimal;
  max: Prisma.Decimal;
  avg: Prisma.Decimal;
  sampleCount: number;
};

// Owns daily_summaries: nightly aggregation of measures into per-day
// min/max/avg/count, retention purge of the raw rows, and the read side for
// GET /climate/summaries. Kept separate from ClimateService (raw ingestion
// + "latest reading") — different table, different lifecycle (measures are
// pruned, daily_summaries is kept forever).
@Injectable()
export class ClimateSummaryService {
  private readonly logger = new Logger(ClimateSummaryService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Runs just after Paris midnight, with a 10-minute buffer for any
  // still-in-flight reading from the day that just ended. Order matters:
  // purging is only reached if summarizing succeeded, since aggregating
  // after purging would lose data permanently (see CLAUDE.md's Climate
  // section). A missed or duplicate run (restart, redeploy) is harmless —
  // both steps are idempotent.
  @Cron('10 0 * * *', {
    name: 'climate-nightly-summary',
    timeZone: PARIS_TIME_ZONE,
  })
  async runNightlySummaryAndPurge(): Promise<void> {
    const date = yesterdayParisDate();
    try {
      await this.summarizeDay(date);
    } catch (err) {
      this.logger.error(
        `failed to summarize ${date}, skipping purge`,
        err instanceof Error ? err.stack : String(err),
      );
      return;
    }
    await this.purgeOlderThan(retentionDays());
  }

  // Aggregates one Europe/Paris calendar day's raw measures into
  // daily_summaries, upserting per (deviceName, type) keyed on `date` — safe
  // to re-run for the same date (after a restart, or a manual backfill),
  // never duplicates or leaves a stale value behind. A device+type with no
  // readings that day gets no row: GROUP BY only emits groups with at least
  // one matching measure, so there is nothing to special-case.
  async summarizeDay(
    isoDate: string,
  ): Promise<{ date: string; written: number }> {
    const { start, end } = parisDayBoundsUtc(isoDate);
    const date = parseIsoDate(isoDate);

    const rows = await this.prisma.$queryRaw<RawSummaryRow[]>(Prisma.sql`
      SELECT
        device_name AS "deviceName",
        type AS "type",
        MIN(value::double precision)::text AS "min",
        MAX(value::double precision)::text AS "max",
        AVG(value::double precision)::text AS "avg",
        COUNT(*)::int AS "sampleCount"
      FROM measures
      WHERE recorded_at >= ${start}
        AND recorded_at < ${end}
        AND type IN (${Prisma.join(KNOWN_MEASURE_TYPES)})
      GROUP BY device_name, type
    `);

    for (const row of rows) {
      await this.prisma.dailySummary.upsert({
        where: {
          deviceName_type_date: {
            deviceName: row.deviceName,
            type: row.type,
            date,
          },
        },
        create: {
          deviceName: row.deviceName,
          type: row.type,
          date,
          min: row.min,
          max: row.max,
          avg: row.avg,
          sampleCount: row.sampleCount,
        },
        update: {
          min: row.min,
          max: row.max,
          avg: row.avg,
          sampleCount: row.sampleCount,
        },
      });
    }

    this.logger.log(
      `summarized ${isoDate}: ${rows.length} device/type group(s)`,
    );
    return { date: isoDate, written: rows.length };
  }

  // Deletes raw measures older than retentionDays, measured back from the
  // current Paris day — independent of which day summarizeDay() just
  // processed, so a missed night doesn't shrink the retention window.
  async purgeOlderThan(
    retentionDaysValue: number,
    now: Date = new Date(),
  ): Promise<{ deleted: number }> {
    const cutoff = purgeCutoffUtc(retentionDaysValue, now);

    const result = await this.prisma.measure.deleteMany({
      where: { recordedAt: { lt: cutoff } },
    });
    this.logger.log(
      `purged ${result.count} measure(s) recorded before ${cutoff.toISOString()}`,
    );
    return { deleted: result.count };
  }

  async getSummaries(
    deviceName: string,
    from: string,
    to: string,
  ): Promise<DailySummaryReading[]> {
    return this.prisma.dailySummary.findMany({
      where: {
        deviceName,
        date: { gte: parseIsoDate(from), lte: parseIsoDate(to) },
      },
      orderBy: [{ date: 'asc' }, { type: 'asc' }],
      select: {
        type: true,
        date: true,
        min: true,
        max: true,
        avg: true,
        sampleCount: true,
      },
    });
  }
}

function retentionDays(): number {
  const raw = process.env.CLIMATE_SUMMARY_RETENTION_DAYS;
  if (!raw) {
    return DEFAULT_RETENTION_DAYS;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `CLIMATE_SUMMARY_RETENTION_DAYS must be a positive integer, got '${raw}'`,
    );
  }
  return parsed;
}
