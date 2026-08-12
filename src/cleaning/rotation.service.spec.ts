import { RotationService, ROTATION_EPOCH } from './rotation.service';

const users: [{ id: string }, { id: string }] = [{ id: 'mia' }, { id: 'sam' }];

describe('RotationService', () => {
  let service: RotationService;

  beforeEach(() => {
    service = new RotationService();
  });

  it('assigns the epoch week deterministically', () => {
    const assignment = service.getWeekAssignment(ROTATION_EPOCH, users);
    expect(assignment).toEqual([
      { userId: 'mia', weeklyGroup: 'A', biweeklyGroup: 'C' },
      { userId: 'sam', weeklyGroup: 'B', biweeklyGroup: 'D' },
    ]);
  });

  it('is pure and deterministic — same input, same output', () => {
    const a = service.getWeekAssignment('2026-W03', users);
    const b = service.getWeekAssignment('2026-W03', users);
    expect(a).toEqual(b);
  });

  it('alternates the weekly group every week', () => {
    const week1 = service.getWeekAssignment('2024-W01', users);
    const week2 = service.getWeekAssignment('2024-W02', users);
    const week3 = service.getWeekAssignment('2024-W03', users);
    expect(week1[0].weeklyGroup).toBe('A');
    expect(week2[0].weeklyGroup).toBe('B');
    expect(week3[0].weeklyGroup).toBe('A');
  });

  it('alternates the biweekly group every two weeks', () => {
    const week1 = service.getWeekAssignment('2024-W01', users);
    const week2 = service.getWeekAssignment('2024-W02', users);
    const week3 = service.getWeekAssignment('2024-W03', users);
    const week4 = service.getWeekAssignment('2024-W04', users);
    const week5 = service.getWeekAssignment('2024-W05', users);
    expect(week1[0].biweeklyGroup).toBe('C');
    expect(week2[0].biweeklyGroup).toBe('C');
    expect(week3[0].biweeklyGroup).toBe('D');
    expect(week4[0].biweeklyGroup).toBe('D');
    expect(week5[0].biweeklyGroup).toBe('C');
  });

  it('always gives the two users opposite weekly groups', () => {
    for (let i = 0; i < 10; i++) {
      const [a, b] = service.getWeekAssignment(
        `2024-W${String(i + 1).padStart(2, '0')}`,
        users,
      );
      expect(a.weeklyGroup).not.toBe(b.weeklyGroup);
    }
  });

  it('always gives the two users opposite biweekly groups', () => {
    for (let i = 0; i < 10; i++) {
      const [a, b] = service.getWeekAssignment(
        `2024-W${String(i + 1).padStart(2, '0')}`,
        users,
      );
      expect(a.biweeklyGroup).not.toBe(b.biweeklyGroup);
    }
  });

  it('handles a week before the epoch (past)', () => {
    const assignment = service.getWeekAssignment('2023-W52', users);
    expect(assignment[0].weeklyGroup).toBe('B');
  });

  it('handles a week well into the future', () => {
    const assignment = service.getWeekAssignment('2030-W20', users);
    expect(
      assignment[0].weeklyGroup === 'A' || assignment[0].weeklyGroup === 'B',
    ).toBe(true);
    expect(assignment[1].weeklyGroup).not.toBe(assignment[0].weeklyGroup);
  });

  it("is stable across a year boundary (ISO weeks don't align with calendar years)", () => {
    // 2026-W53 is the last ISO week of 2026; 2027-W01 immediately follows it.
    const last = service.getWeekAssignment('2026-W53', users);
    const first = service.getWeekAssignment('2027-W01', users);
    expect(last[0].weeklyGroup).not.toBe(first[0].weeklyGroup);
  });

  it('respects user order for stable rotation regardless of id values', () => {
    const reordered: [{ id: string }, { id: string }] = [
      { id: 'sam' },
      { id: 'mia' },
    ];
    const assignment = service.getWeekAssignment(ROTATION_EPOCH, reordered);
    expect(assignment[0].userId).toBe('sam');
    expect(assignment[0].weeklyGroup).toBe('A');
    expect(assignment[1].userId).toBe('mia');
    expect(assignment[1].weeklyGroup).toBe('B');
  });
});
