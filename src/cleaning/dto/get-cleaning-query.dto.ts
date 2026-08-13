import { IsIsoWeek } from './is-iso-week.decorator';

export class GetCleaningQueryDto {
  @IsIsoWeek()
  week!: string;
}
