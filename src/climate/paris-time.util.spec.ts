import {
  parisDayBoundsUtc,
  purgeCutoffUtc,
  yesterdayParisDate,
} from './paris-time.util';

describe('parisDayBoundsUtc', () => {
  it('bounds a winter day (CET, UTC+1) at 23:00/23:00 UTC', () => {
    const { start, end } = parisDayBoundsUtc('2026-01-15');
    expect(start.toISOString()).toBe('2026-01-14T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-01-15T23:00:00.000Z');
  });

  it('bounds a summer day (CEST, UTC+2) at 22:00/22:00 UTC', () => {
    const { start, end } = parisDayBoundsUtc('2026-07-15');
    expect(start.toISOString()).toBe('2026-07-14T22:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-15T22:00:00.000Z');
  });

  it('bounds the spring-forward day (2026-03-29, 02:00 -> 03:00 CEST) at a 23h span', () => {
    const { start, end } = parisDayBoundsUtc('2026-03-29');
    expect(start.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it('bounds the fall-back day (2026-10-25, 03:00 -> 02:00 CET) at a 25h span', () => {
    const { start, end } = parisDayBoundsUtc('2026-10-25');
    expect(start.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  it('throws on an invalid date string', () => {
    expect(() => parisDayBoundsUtc('not-a-date')).toThrow();
  });
});

describe('yesterdayParisDate', () => {
  it('returns the Paris calendar date before a UTC instant still on the same Paris day', () => {
    // 2026-08-15T22:00:00Z is 2026-08-16T00:00:00+02:00 in Paris (CEST) —
    // just past Paris midnight, so "yesterday" is 08-15.
    expect(yesterdayParisDate(new Date('2026-08-15T22:00:00.000Z'))).toBe(
      '2026-08-15',
    );
  });

  it('rolls back correctly right before Paris midnight', () => {
    // 2026-08-15T21:59:00Z is still 2026-08-15T23:59:00+02:00 in Paris.
    expect(yesterdayParisDate(new Date('2026-08-15T21:59:00.000Z'))).toBe(
      '2026-08-14',
    );
  });
});

describe('purgeCutoffUtc', () => {
  it('subtracts whole Paris calendar days from the start of today, not raw milliseconds', () => {
    // "now" is mid-day 2026-08-22 UTC (CEST); start of today in Paris is
    // 2026-08-21T22:00:00Z. 7 days back is 2026-08-14T22:00:00Z.
    const cutoff = purgeCutoffUtc(7, new Date('2026-08-22T12:00:00.000Z'));
    expect(cutoff.toISOString()).toBe('2026-08-14T22:00:00.000Z');
  });

  it('stays exactly N Paris calendar days back across a DST transition', () => {
    // "now" is 2026-11-01 UTC (CET, UTC+1); 7 days back crosses the
    // 2026-10-25 fall-back. A flat 7*24h-in-ms subtraction would land an
    // hour off; calendar subtraction must not.
    const cutoff = purgeCutoffUtc(7, new Date('2026-11-01T12:00:00.000Z'));
    expect(cutoff.toISOString()).toBe('2026-10-24T22:00:00.000Z');
  });
});
