import { IsIsoWeek } from './is-iso-week.decorator';

export class GetCleaningWeekQueryDto {
  @IsIsoWeek()
  week!: string;
}
