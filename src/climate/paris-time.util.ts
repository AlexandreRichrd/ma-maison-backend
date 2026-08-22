import { DateTime } from 'luxon';

// Measures are stored in UTC (recorded_at), but "a day" for the household
// means a Europe/Paris calendar day, not a UTC one — a summary computed on
// UTC boundaries would have its min/max shifted by up to two hours in
// summer (CEST, UTC+2) versus winter (CET, UTC+1). luxon (already a
// transitive dependency via @nestjs/schedule -> cron) carries the IANA
// timezone database, so this handles the DST transition correctly without
// hand-rolled offset math.
export const PARIS_TIME_ZONE = 'Europe/Paris';

/**
 * The [start, end) UTC instants bounding a Europe/Paris calendar day, for
 * querying `measures.recorded_at` (a UTC timestamptz). `isoDate` is
 * 'YYYY-MM-DD', interpreted as a Paris-local date.
 */
export function parisDayBoundsUtc(isoDate: string): { start: Date; end: Date } {
  const start = DateTime.fromISO(isoDate, { zone: PARIS_TIME_ZONE }).startOf(
    'day',
  );
  if (!start.isValid) {
    throw new Error(`invalid date '${isoDate}': ${start.invalidReason}`);
  }
  return {
    start: start.toUTC().toJSDate(),
    end: start.plus({ days: 1 }).toUTC().toJSDate(),
  };
}

/**
 * The Europe/Paris calendar date, as of `now`, that ended most recently —
 * the day the nightly job should summarize when it fires just after Paris
 * midnight. 'YYYY-MM-DD'.
 */
export function yesterdayParisDate(now: Date = new Date()): string {
  const isoDate = DateTime.fromJSDate(now, { zone: PARIS_TIME_ZONE })
    .minus({ days: 1 })
    .toISODate();
  if (!isoDate) {
    throw new Error(
      `could not compute yesterday's Paris date from ${now.toISOString()}`,
    );
  }
  return isoDate;
}

/**
 * The UTC instant `retentionDays` Europe/Paris calendar days before the
 * start of today — the retention-purge cutoff. Calendar-based subtraction
 * (via luxon), not a flat `retentionDays * 24h` in milliseconds: the latter
 * would land an hour off whenever the window crosses a DST transition.
 */
export function purgeCutoffUtc(
  retentionDays: number,
  now: Date = new Date(),
): Date {
  return DateTime.fromJSDate(now, { zone: PARIS_TIME_ZONE })
    .startOf('day')
    .minus({ days: retentionDays })
    .toUTC()
    .toJSDate();
}
