import { RotationService, type ChoreConfig } from './rotation.service';

const users: [{ id: string }, { id: string }] = [{ id: 'mia' }, { id: 'sam' }];

function chore(overrides: Partial<ChoreConfig> = {}): ChoreConfig {
  return {
    id: 'chore-1',
    frequencyUnit: 'WEEK',
    frequencyValue: 1,
    assignmentMode: 'ROTATING',
    anchorDate: new Date('2024-01-01'), // Monday, ISO week 2024-W01
    anchorUserId: 'mia',
    ...overrides,
  };
}

const d = (isoDate: string) => new Date(isoDate);

describe('RotationService', () => {
  let service: RotationService;

  beforeEach(() => {
    service = new RotationService();
  });

  describe('getChoreAssignment', () => {
    it('assigns the anchor date to the anchor user', () => {
      const c = chore();
      expect(service.getChoreAssignment(d('2024-01-01'), c, users)).toEqual({
        userId: 'mia',
      });
    });

    it('weekly rotating alternates every occurrence', () => {
      const c = chore({ frequencyUnit: 'WEEK', frequencyValue: 1 });
      expect(service.getChoreAssignment(d('2024-01-01'), c, users)).toEqual({
        userId: 'mia',
      });
      expect(service.getChoreAssignment(d('2024-01-08'), c, users)).toEqual({
        userId: 'sam',
      });
      expect(service.getChoreAssignment(d('2024-01-15'), c, users)).toEqual({
        userId: 'mia',
      });
      expect(service.getChoreAssignment(d('2024-01-22'), c, users)).toEqual({
        userId: 'sam',
      });
      // Any other day within the week is not an occurrence at all.
      expect(service.getChoreAssignment(d('2024-01-02'), c, users)).toBeNull();
    });

    it('biweekly rotating occurs only every other week and alternates across occurrences', () => {
      const c = chore({ frequencyUnit: 'WEEK', frequencyValue: 2 });
      expect(service.getChoreAssignment(d('2024-01-01'), c, users)).toEqual({
        userId: 'mia',
      });
      expect(service.getChoreAssignment(d('2024-01-08'), c, users)).toBeNull();
      expect(service.getChoreAssignment(d('2024-01-15'), c, users)).toEqual({
        userId: 'sam',
      });
      expect(service.getChoreAssignment(d('2024-01-22'), c, users)).toBeNull();
      expect(service.getChoreAssignment(d('2024-01-29'), c, users)).toEqual({
        userId: 'mia',
      });
    });

    it('daily rotating occurs every day and alternates every occurrence', () => {
      const c = chore({
        frequencyUnit: 'DAY',
        frequencyValue: 1,
        anchorDate: d('2024-01-01'),
      });
      expect(service.getChoreAssignment(d('2024-01-01'), c, users)).toEqual({
        userId: 'mia',
      });
      expect(service.getChoreAssignment(d('2024-01-02'), c, users)).toEqual({
        userId: 'sam',
      });
      expect(service.getChoreAssignment(d('2024-01-03'), c, users)).toEqual({
        userId: 'mia',
      });
    });

    it('every-N-days rotating occurs only every N days, off-days null', () => {
      const c = chore({
        frequencyUnit: 'DAY',
        frequencyValue: 3,
        anchorDate: d('2024-01-01'),
      });
      expect(service.getChoreAssignment(d('2024-01-01'), c, users)).toEqual({
        userId: 'mia',
      });
      expect(service.getChoreAssignment(d('2024-01-02'), c, users)).toBeNull();
      expect(service.getChoreAssignment(d('2024-01-03'), c, users)).toBeNull();
      expect(service.getChoreAssignment(d('2024-01-04'), c, users)).toEqual({
        userId: 'sam',
      });
    });

    it('returns null for any date before the anchor', () => {
      const c = chore({ anchorDate: d('2024-03-04') });
      expect(service.getChoreAssignment(d('2024-03-03'), c, users)).toBeNull();
      expect(service.getChoreAssignment(d('2023-12-25'), c, users)).toBeNull();
    });

    it('pinned chore always resolves to the anchor user on every occurring day', () => {
      const c = chore({ assignmentMode: 'PINNED', frequencyValue: 1 });
      expect(service.getChoreAssignment(d('2024-01-01'), c, users)).toEqual({
        userId: 'mia',
      });
      expect(service.getChoreAssignment(d('2024-01-08'), c, users)).toEqual({
        userId: 'mia',
      });
      expect(service.getChoreAssignment(d('2024-03-04'), c, users)).toEqual({
        userId: 'mia',
      });
    });

    it('pinned still respects the off-week schedule for frequencyValue > 1 — only the assignee is fixed', () => {
      const c = chore({
        assignmentMode: 'PINNED',
        frequencyUnit: 'WEEK',
        frequencyValue: 2,
        anchorUserId: 'sam',
      });
      expect(service.getChoreAssignment(d('2024-01-01'), c, users)).toEqual({
        userId: 'sam',
      });
      expect(service.getChoreAssignment(d('2024-01-08'), c, users)).toBeNull();
      expect(service.getChoreAssignment(d('2024-01-15'), c, users)).toEqual({
        userId: 'sam',
      });
    });

    it('two independent rotating chores with different anchors can land on the same user the same day', () => {
      const a = chore({
        id: 'a',
        anchorDate: d('2024-01-01'),
        anchorUserId: 'mia',
      });
      const b = chore({
        id: 'b',
        anchorDate: d('2024-01-08'),
        anchorUserId: 'mia',
      });
      // 2024-01-08: chore a is on its 2nd occurrence (sam), chore b is on
      // its 1st occurrence (mia) — no cross-chore opposite-person constraint.
      const date = d('2024-01-08');
      expect(service.getChoreAssignment(date, a, users)).toEqual({
        userId: 'sam',
      });
      expect(service.getChoreAssignment(date, b, users)).toEqual({
        userId: 'mia',
      });
    });

    it('is pure and deterministic — same input, same output', () => {
      const c = chore();
      const date = d('2026-01-19');
      const first = service.getChoreAssignment(date, c, users);
      const second = service.getChoreAssignment(date, c, users);
      expect(first).toEqual(second);
    });

    it('assignment is keyed to user id, not tuple position', () => {
      const c = chore({ anchorUserId: 'sam' });
      const reordered: [{ id: string }, { id: string }] = [
        { id: 'sam' },
        { id: 'mia' },
      ];
      expect(service.getChoreAssignment(d('2024-01-01'), c, users)).toEqual({
        userId: 'sam',
      });
      expect(service.getChoreAssignment(d('2024-01-01'), c, reordered)).toEqual(
        { userId: 'sam' },
      );
    });

    it('is stable across a year boundary, for both weekly and biweekly chores', () => {
      // 2026-W53 (Monday 2026-12-28) is the last ISO week of 2026 (ISO
      // weeks don't align with calendar years); 2027-W01 (2027-01-04)
      // immediately follows it.
      const weekly = chore({
        frequencyUnit: 'WEEK',
        frequencyValue: 1,
        anchorDate: d('2026-12-28'),
      });
      expect(
        service.getChoreAssignment(d('2026-12-28'), weekly, users),
      ).toEqual({
        userId: 'mia',
      });
      expect(
        service.getChoreAssignment(d('2027-01-04'), weekly, users),
      ).toEqual({
        userId: 'sam',
      });

      const biweekly = chore({
        frequencyUnit: 'WEEK',
        frequencyValue: 2,
        anchorDate: d('2026-12-28'),
      });
      expect(
        service.getChoreAssignment(d('2026-12-28'), biweekly, users),
      ).toEqual({ userId: 'mia' });
      expect(
        service.getChoreAssignment(d('2027-01-04'), biweekly, users),
      ).toBeNull();
      expect(
        service.getChoreAssignment(d('2027-01-11'), biweekly, users),
      ).toEqual({ userId: 'sam' });
    });

    it('supports large N (e.g. yearly) without occurring at the halfway point', () => {
      const c = chore({ frequencyUnit: 'WEEK', frequencyValue: 52 });
      expect(service.getChoreAssignment(d('2024-01-01'), c, users)).toEqual({
        userId: 'mia',
      });
      expect(service.getChoreAssignment(d('2024-07-01'), c, users)).toBeNull();
      expect(service.getChoreAssignment(d('2024-12-30'), c, users)).toEqual({
        userId: 'sam',
      });
    });

    it('throws if anchorUserId matches neither household user', () => {
      const c = chore({ anchorUserId: 'someone-else' });
      expect(() =>
        service.getChoreAssignment(d('2024-01-01'), c, users),
      ).toThrow();
    });

    it('throws if frequencyValue is zero or negative', () => {
      expect(() =>
        service.getChoreAssignment(
          d('2024-01-01'),
          chore({ frequencyValue: 0 }),
          users,
        ),
      ).toThrow();
      expect(() =>
        service.getChoreAssignment(
          d('2024-01-01'),
          chore({ frequencyValue: -1 }),
          users,
        ),
      ).toThrow();
    });
  });

  describe('getOccurrences', () => {
    it('filters a mixed list down to only the chores occurring within the range', () => {
      const weekly = chore({
        id: 'weekly',
        frequencyUnit: 'WEEK',
        frequencyValue: 1,
      });
      const biweeklyOff = chore({
        id: 'biweekly-off',
        frequencyUnit: 'WEEK',
        frequencyValue: 2,
        anchorDate: d('2024-01-08'),
      });
      const notStarted = chore({
        id: 'not-started',
        anchorDate: d('2030-01-01'),
      });

      const result = service.getOccurrences(
        d('2024-01-01'),
        d('2024-01-07'),
        [weekly, biweeklyOff, notStarted],
        users,
      );

      expect(result).toEqual([
        { choreId: 'weekly', userId: 'mia', occurrenceDate: d('2024-01-01') },
      ]);
    });

    it('returns [] for an empty chore list or when nothing occurs in the range', () => {
      expect(
        service.getOccurrences(d('2024-01-01'), d('2024-01-07'), [], users),
      ).toEqual([]);
      const notStarted = chore({ anchorDate: d('2030-01-01') });
      expect(
        service.getOccurrences(
          d('2024-01-01'),
          d('2024-01-07'),
          [notStarted],
          users,
        ),
      ).toEqual([]);
    });

    it('preserves choreId identity and can assign multiple chores to the same user', () => {
      const a = chore({ id: 'a', anchorUserId: 'mia' });
      const b = chore({ id: 'b', anchorUserId: 'mia' });
      const result = service.getOccurrences(
        d('2024-01-01'),
        d('2024-01-01'),
        [a, b],
        users,
      );
      expect(result).toEqual([
        { choreId: 'a', userId: 'mia', occurrenceDate: d('2024-01-01') },
        { choreId: 'b', userId: 'mia', occurrenceDate: d('2024-01-01') },
      ]);
    });

    it('a daily chore contributes one occurrence per day across a multi-day range', () => {
      const daily = chore({
        id: 'daily',
        frequencyUnit: 'DAY',
        frequencyValue: 1,
        anchorDate: d('2024-01-01'),
      });
      const result = service.getOccurrences(
        d('2024-01-01'),
        d('2024-01-03'),
        [daily],
        users,
      );
      expect(result).toEqual([
        { choreId: 'daily', userId: 'mia', occurrenceDate: d('2024-01-01') },
        { choreId: 'daily', userId: 'sam', occurrenceDate: d('2024-01-02') },
        { choreId: 'daily', userId: 'mia', occurrenceDate: d('2024-01-03') },
      ]);
    });
  });
});
