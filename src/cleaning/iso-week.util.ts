const ISO_WEEK_PATTERN = /^(\d{4})-W(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function isValidIsoWeek(value: string): boolean {
  const match = ISO_WEEK_PATTERN.exec(value);
  if (!match) return false;
  const week = Number(match[2]);
  return week >= 1 && week <= 53;
}

/**
 * Returns the Monday of the given ISO week, as a UTC-midnight Date — via a
 * hand-rolled UTC calculation, not date-fns's setISOWeek/startOfISOWeek
 * (local-time based, see iso-date.util.ts's parseIsoDate comment for why
 * that's unsafe here). Standard ISO 8601 rule: January 4th always falls in
 * week 1, so week 1's Monday is found by walking back from Jan 4th to the
 * most recent Monday, then every later week is 7 days beyond that.
 */
export function parseIsoWeek(isoWeek: string): Date {
  const match = ISO_WEEK_PATTERN.exec(isoWeek);
  if (!match) {
    throw new Error(`Invalid ISO week string: ${isoWeek}`);
  }
  const [, yearStr, weekStr] = match;
  const year = Number(yearStr);
  const week = Number(weekStr);

  const jan4 = Date.UTC(year, 0, 4);
  const jan4IsoDay = new Date(jan4).getUTCDay() || 7; // 1=Monday..7=Sunday
  const mondayOfWeek1 = jan4 - (jan4IsoDay - 1) * MS_PER_DAY;

  return new Date(mondayOfWeek1 + (week - 1) * 7 * MS_PER_DAY);
}
