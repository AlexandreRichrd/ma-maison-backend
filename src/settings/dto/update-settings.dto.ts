import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
} from 'class-validator';

// Hand-written, not PartialType(...) — same reasoning as UpdateChoreDto:
// not worth the @nestjs/mapped-types dependency for five optional fields.
// Every field is optional so a PATCH only touches what it names — see
// SettingsService.update() for how the rest of the row is preserved.
export class UpdateSettingsDto {
  @IsOptional()
  @IsBoolean()
  climateAlertEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  climateAlertMarginC?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  climateAlertIndoorThresholdC?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  climateAlertCooldownMinutes?: number;

  @IsOptional()
  @IsInt()
  @IsPositive()
  climateSummaryRetentionDays?: number;
}
