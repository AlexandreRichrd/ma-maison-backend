import { AssignmentMode } from '@prisma/client';
import { IsEnum, IsInt, IsNotEmpty, IsUUID, Min } from 'class-validator';

import { IsIsoWeek } from './is-iso-week.decorator';

export class CreateChoreDto {
  @IsNotEmpty()
  name!: string;

  @IsInt()
  @Min(1)
  frequencyWeeks!: number;

  @IsEnum(AssignmentMode)
  assignmentMode!: AssignmentMode;

  @IsIsoWeek()
  anchorIsoWeek!: string;

  @IsUUID()
  anchorUserId!: string;
}
