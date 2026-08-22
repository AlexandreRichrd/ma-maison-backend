import { IsOptional } from 'class-validator';

import { IsIsoDate } from '../../cleaning/dto/is-iso-date.decorator';

// from/to are both optional (plain GET /reminders keeps returning the full
// unbounded list, for the flat list view) but must be given together — the
// week/month calendar views pass both, mirroring the
// GET /climate/summaries?from=&to= pattern.
export class GetRemindersQueryDto {
  @IsOptional()
  @IsIsoDate()
  from?: string;

  @IsOptional()
  @IsIsoDate()
  to?: string;
}
