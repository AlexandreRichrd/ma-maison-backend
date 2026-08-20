import { AssignmentMode, FrequencyUnit } from '@prisma/client';
import { IsEnum, IsInt, IsNotEmpty, IsUUID, Min } from 'class-validator';

import { IsIsoDate } from './is-iso-date.decorator';

export class CreateChoreDto {
  @IsNotEmpty()
  name!: string;

  @IsEnum(FrequencyUnit)
  frequencyUnit!: FrequencyUnit;

  @IsInt()
  @Min(1)
  frequencyValue!: number;

  @IsEnum(AssignmentMode)
  assignmentMode!: AssignmentMode;

  // Must be a Monday when frequencyUnit is WEEK — checked in
  // ChoresService, not here, same reason anchorUserId's household
  // membership is checked there: it depends on another field's value.
  @IsIsoDate()
  anchorDate!: string;

  @IsUUID()
  anchorUserId!: string;
}
