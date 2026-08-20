import { isValid, parseISO } from 'date-fns';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: string): boolean {
  // parseISO is only used for the validity check here (NaN-ness is
  // timezone-independent) — parseIsoDate below deliberately does NOT use
  // parseISO's actual return value, see its comment.
  return ISO_DATE_PATTERN.test(value) && isValid(parseISO(value));
}

/**
 * Returns a Date at UTC midnight for the given calendar date — NOT via
 * date-fns's parseISO, which parses a bare 'YYYY-MM-DD' string as *local*
 * midnight (unlike the native Date constructor, which treats it as UTC).
 * The pg driver adapter (@prisma/adapter-pg) writes/reads @db.Date columns
 * using UTC components, and rotation.service.ts's day arithmetic is UTC
 * throughout — parseISO's local-midnight result silently disagreed with
 * both on any host not running in UTC (verified: it shifted anchorDate by
 * a full day here). Every Date this app treats as a calendar date is UTC
 * midnight, always.
 */
export function parseIsoDate(isoDate: string): Date {
  if (!isValidIsoDate(isoDate)) {
    throw new Error(`Invalid ISO date string: ${isoDate}`);
  }
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** ISO day of week (1=Monday..7=Sunday) from a UTC-midnight calendar
 * date — via getUTCDay(), not date-fns's getISODay(), which is local-time
 * based and would misread a UTC-midnight Date on a host west of UTC. */
export function isoDayOfWeekUtc(date: Date): number {
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}
