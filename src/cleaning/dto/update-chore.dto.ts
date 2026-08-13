import { AssignmentMode } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

import { IsIsoWeek } from './is-iso-week.decorator';

// Hand-written rather than PartialType(CreateChoreDto) — avoids a new
// dependency (@nestjs/mapped-types) for 5 optional fields.
export class UpdateChoreDto {
  @IsOptional()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  frequencyWeeks?: number;

  @IsOptional()
  @IsEnum(AssignmentMode)
  assignmentMode?: AssignmentMode;

  @IsOptional()
  @IsIsoWeek()
  anchorIsoWeek?: string;

  @IsOptional()
  @IsUUID()
  anchorUserId?: string;
}
