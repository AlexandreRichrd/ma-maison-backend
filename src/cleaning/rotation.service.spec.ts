import { RotationService, type ChoreConfig } from './rotation.service';

const users: [{ id: string }, { id: string }] = [{ id: 'mia' }, { id: 'sam' }];

function chore(overrides: Partial<ChoreConfig> = {}): ChoreConfig {
  return {
    id: 'chore-1',
    frequencyWeeks: 1,
    assignmentMode: 'ROTATING',
    anchorIsoWeek: '2024-W01',
    anchorUserId: 'mia',
    ...overrides,
  };
}

describe('RotationService', () => {
  let service: RotationService;

  beforeEach(() => {
    service = new RotationService();
  });

  describe('getChoreAssignment', () => {
    it('assigns the anchor week to the anchor user', () => {
      const c = chore();
      expect(service.getChoreAssignment('2024-W01', c, users)).toEqual({
        userId: 'mia',
      });
    });

    it('weekly rotating alternates every occurrence', () => {
      const c = chore({ frequencyWeeks: 1 });
      expect(service.getChoreAssignment('2024-W01', c, users)).toEqual({
        userId: 'mia',
      });
      expect(service.getChoreAssignment('2024-W02', c, users)).toEqual({
        userId: 'sam',
      });
      expect(service.getChoreAssignment('2024-W03', c, users)).toEqual({
        userId: 'mia',
      });
      expect(service.getChoreAssignment('2024-W04', c, users)).toEqual({
        userId: 'sam',
      });
    });

    it('biweekly rotating occurs only every other week and alternates across occurrences', () => {
      const c = chore({ frequencyWeeks: 2 });
      expect(service.getChoreAssignment('2024-W01', c, users)).toEqual({
        userId: 'mia',
      });
      expect(service.getChoreAssignment('2024-W02', c, users)).toBeNull();
      expect(service.getChoreAssignment('2024-W03', c, users)).toEqual({
        userId: 'sam',
      });
      expect(service.getChoreAssignment('2024-W04', c, users)).toBeNull();
      expect(service.getChoreAssignment('2024-W05', c, users)).toEqual({
        userId: 'mia',
      });
    });

    it('returns null for any week before the anchor', () => {
      const c = chore({ anchorIsoWeek: '2024-W10' });
      expect(service.getChoreAssignment('2024-W09', c, users)).toBeNull();
      expect(service.getChoreAssignment('2023-W52', c, users)).toBeNull();
    });

    it('pinned chore always resolves to the anchor user on every occurring week', () => {
      const c = chore({ assignmentMode: 'PINNED', frequencyWeeks: 1 });
      expect(service.getChoreAssignment('2024-W01', c, users)).toEqual({
        userId: 'mia',
      });
      expect(service.getChoreAssignment('2024-W02', c, users)).toEqual({
        userId: 'mia',
      });
      expect(service.getChoreAssignment('2024-W10', c, users)).toEqual({
        userId: 'mia',
      });
    });

    it('pinned still respects the off-week schedule for frequencyWeeks > 1 — only the assignee is fixed', () => {
      const c = chore({
        assignmentMode: 'PINNED',
        frequencyWeeks: 2,
        anchorUserId: 'sam',
      });
      expect(service.getChoreAssignment('2024-W01', c, users)).toEqual({
        userId: 'sam',
      });
      expect(service.getChoreAssignment('2024-W02', c, users)).toBeNull();
      expect(service.getChoreAssignment('2024-W03', c, users)).toEqual({
        userId: 'sam',
      });
    });

    it('two independent rotating chores with different anchors can land on the same user the same week', () => {
      const a = chore({
        id: 'a',
        anchorIsoWeek: '2024-W01',
        anchorUserId: 'mia',
      });
      const b = chore({
        id: 'b',
        anchorIsoWeek: '2024-W02',
        anchorUserId: 'mia',
      });
      // Week 2: chore a is on its 2nd occurrence (sam), chore b is on its
      // 1st occurrence (mia) — no cross-chore opposite-person constraint.
      const week = '2024-W02';
      expect(service.getChoreAssignment(week, a, users)).toEqual({
        userId: 'sam',
      });
      expect(service.getChoreAssignment(week, b, users)).toEqual({
        userId: 'mia',
      });
    });

    it('is pure and deterministic — same input, same output', () => {
      const c = chore();
      const first = service.getChoreAssignment('2026-W03', c, users);
      const second = service.getChoreAssignment('2026-W03', c, users);
      expect(first).toEqual(second);
    });

    it('assignment is keyed to user id, not tuple position', () => {
      const c = chore({ anchorUserId: 'sam' });
      const reordered: [{ id: string }, { id: string }] = [
        { id: 'sam' },
        { id: 'mia' },
      ];
      expect(service.getChoreAssignment('2024-W01', c, users)).toEqual({
        userId: 'sam',
      });
      expect(service.getChoreAssignment('2024-W01', c, reordered)).toEqual({
        userId: 'sam',
      });
    });

    it('is stable across a year boundary, for both weekly and biweekly chores', () => {
      // 2026-W53 is the last ISO week of 2026 (ISO weeks don't align with
      // calendar years); 2027-W01 immediately follows it.
      const weekly = chore({ frequencyWeeks: 1, anchorIsoWeek: '2026-W53' });
      expect(service.getChoreAssignment('2026-W53', weekly, users)).toEqual({
        userId: 'mia',
      });
      expect(service.getChoreAssignment('2027-W01', weekly, users)).toEqual({
        userId: 'sam',
      });

      const biweekly = chore({ frequencyWeeks: 2, anchorIsoWeek: '2026-W53' });
      expect(service.getChoreAssignment('2026-W53', biweekly, users)).toEqual({
        userId: 'mia',
      });
      expect(
        service.getChoreAssignment('2027-W01', biweekly, users),
      ).toBeNull();
      expect(service.getChoreAssignment('2027-W02', biweekly, users)).toEqual({
        userId: 'sam',
      });
    });

    it('supports large N (e.g. yearly) without occurring at the halfway point', () => {
      const c = chore({ frequencyWeeks: 52 });
      expect(service.getChoreAssignment('2024-W01', c, users)).toEqual({
        userId: 'mia',
      });
      expect(service.getChoreAssignment('2024-W26', c, users)).toBeNull();
      expect(service.getChoreAssignment('2025-W01', c, users)).toEqual({
        userId: 'sam',
      });
    });

    it('throws if anchorUserId matches neither household user', () => {
      const c = chore({ anchorUserId: 'someone-else' });
      expect(() => service.getChoreAssignment('2024-W01', c, users)).toThrow();
    });

    it('throws if frequencyWeeks is zero or negative', () => {
      expect(() =>
        service.getChoreAssignment(
          '2024-W01',
          chore({ frequencyWeeks: 0 }),
          users,
        ),
      ).toThrow();
      expect(() =>
        service.getChoreAssignment(
          '2024-W01',
          chore({ frequencyWeeks: -1 }),
          users,
        ),
      ).toThrow();
    });
  });

  describe('getWeekOccurrences', () => {
    it('filters a mixed list down to only the chores occurring that week', () => {
      const weekly = chore({ id: 'weekly', frequencyWeeks: 1 });
      const biweeklyOff = chore({
        id: 'biweekly-off',
        frequencyWeeks: 2,
        anchorIsoWeek: '2024-W02',
      });
      const notStarted = chore({
        id: 'not-started',
        anchorIsoWeek: '2030-W01',
      });

      const result = service.getWeekOccurrences(
        '2024-W01',
        [weekly, biweeklyOff, notStarted],
        users,
      );

      expect(result).toEqual([{ choreId: 'weekly', userId: 'mia' }]);
    });

    it('returns [] for an empty chore list or when nothing occurs that week', () => {
      expect(service.getWeekOccurrences('2024-W01', [], users)).toEqual([]);
      const notStarted = chore({ anchorIsoWeek: '2030-W01' });
      expect(
        service.getWeekOccurrences('2024-W01', [notStarted], users),
      ).toEqual([]);
    });

    it('preserves choreId identity and can assign multiple chores to the same user', () => {
      const a = chore({ id: 'a', anchorUserId: 'mia' });
      const b = chore({ id: 'b', anchorUserId: 'mia' });
      const result = service.getWeekOccurrences('2024-W01', [a, b], users);
      expect(result).toEqual([
        { choreId: 'a', userId: 'mia' },
        { choreId: 'b', userId: 'mia' },
      ]);
    });
  });
});
