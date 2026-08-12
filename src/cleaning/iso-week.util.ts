import { setISOWeek, setISOWeekYear, startOfISOWeek } from 'date-fns';

const ISO_WEEK_PATTERN = /^(\d{4})-W(\d{2})$/;

export function isValidIsoWeek(value: string): boolean {
  const match = ISO_WEEK_PATTERN.exec(value);
  if (!match) return false;
  const week = Number(match[2]);
  return week >= 1 && week <= 53;
}

export function parseIsoWeek(isoWeek: string): Date {
  const match = ISO_WEEK_PATTERN.exec(isoWeek);
  if (!match) {
    throw new Error(`Invalid ISO week string: ${isoWeek}`);
  }
  const [, year, week] = match;
  const withYear = setISOWeekYear(new Date(), Number(year));
  return startOfISOWeek(setISOWeek(withYear, Number(week)));
}
