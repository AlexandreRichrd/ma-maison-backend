import { Injectable } from '@nestjs/common';
import { differenceInCalendarISOWeeks } from 'date-fns';

import { parseIsoWeek } from './iso-week.util';

/** Reference week zero for the rotation. Arbitrary but fixed — never change. */
export const ROTATION_EPOCH = '2024-W01';

export type RotationUser = { id: string };

export type WeeklyGroup = 'A' | 'B';
export type BiweeklyGroup = 'C' | 'D';

export type UserAssignment = {
  userId: string;
  weeklyGroup: WeeklyGroup;
  biweeklyGroup: BiweeklyGroup;
};

export type Assignment = [UserAssignment, UserAssignment];

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * Pure, deterministic chore-group rotation. Same isoWeek + users in, same
 * result out — no database access. Only decides which user gets which
 * rotation group this week; joining that against real chore rows is the
 * caller's job.
 */
@Injectable()
export class RotationService {
  getWeekAssignment(
    isoWeek: string,
    users: [RotationUser, RotationUser],
  ): Assignment {
    const weeksSinceEpoch = differenceInCalendarISOWeeks(
      parseIsoWeek(isoWeek),
      parseIsoWeek(ROTATION_EPOCH),
    );

    const weeklyParity = mod(weeksSinceEpoch, 2);
    const biweeklyParity = mod(Math.floor(weeksSinceEpoch / 2), 2);

    const [first, second] = users;
    const firstWeekly: WeeklyGroup = weeklyParity === 0 ? 'A' : 'B';
    const firstBiweekly: BiweeklyGroup = biweeklyParity === 0 ? 'C' : 'D';

    return [
      {
        userId: first.id,
        weeklyGroup: firstWeekly,
        biweeklyGroup: firstBiweekly,
      },
      {
        userId: second.id,
        weeklyGroup: firstWeekly === 'A' ? 'B' : 'A',
        biweeklyGroup: firstBiweekly === 'C' ? 'D' : 'C',
      },
    ];
  }
}
