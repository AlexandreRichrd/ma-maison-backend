import { AssignmentMode, FrequencyUnit } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

import { IsIsoDate } from './is-iso-date.decorator';

// Hand-written rather than PartialType(CreateChoreDto) — avoids a new
// dependency (@nestjs/mapped-types) for 6 optional fields.
export class UpdateChoreDto {
  @IsOptional()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsEnum(FrequencyUnit)
  frequencyUnit?: FrequencyUnit;

  @IsOptional()
  @IsInt()
  @Min(1)
  frequencyValue?: number;

  @IsOptional()
  @IsEnum(AssignmentMode)
  assignmentMode?: AssignmentMode;

  @IsOptional()
  @IsIsoDate()
  anchorDate?: string;

  @IsOptional()
  @IsUUID()
  anchorUserId?: string;
}
