import { IsIsoDate } from './is-iso-date.decorator';

export class ToggleChoreSubtaskDto {
  @IsIsoDate()
  occurrenceDate!: string;
}
