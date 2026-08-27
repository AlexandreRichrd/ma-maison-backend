import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

// Hand-written, not PartialType(...) — same reasoning as UpdateChoreDto:
// not worth the @nestjs/mapped-types dependency for seven optional fields.
// Every field is optional so a PATCH only touches what it names — see
// SettingsService.update() for how the rest of the row is preserved
// (and how an empty-string label clears an override back to default).
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

  // Empty string is valid input here — it means "clear back to default",
  // handled in SettingsService.update(), not rejected by validation.
  @IsOptional()
  @IsString()
  @MaxLength(50)
  indoorSensorLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  outdoorSensorLabel?: string;
}
