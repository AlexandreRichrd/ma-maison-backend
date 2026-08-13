import { IsIsoWeek } from './is-iso-week.decorator';

export class ToggleChoreDto {
  @IsIsoWeek()
  isoWeek!: string;
}
