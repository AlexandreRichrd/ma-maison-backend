import { IsIsoDate } from './is-iso-date.decorator';

export class GetCleaningDayQueryDto {
  @IsIsoDate()
  date!: string;
}
