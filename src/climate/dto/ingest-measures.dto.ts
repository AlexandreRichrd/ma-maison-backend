import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsNotEmpty,
  ValidateNested,
} from 'class-validator';

// One MQTT reading. type is unvalidated against a fixed list on purpose —
// see the Measure model's schema comment: a new sensor kind is a new
// string value, not a migration, and that includes this DTO not gatekeeping
// which strings are allowed.
export class MeasureDto {
  @IsNotEmpty()
  deviceName!: string;

  @IsNotEmpty()
  type!: string;

  @IsNotEmpty()
  value!: string;

  // When the Pi read the value off MQTT, not when this request was sent —
  // see the Measure model's recordedAt comment.
  @IsISO8601()
  recordedAt!: string;
}

export class IngestMeasuresDto {
  // Capped well above what one forwarding cycle produces (a handful of
  // devices x a handful of metrics) — a bound exists so a misbehaving or
  // compromised sender can't push an unbounded batch in one request, not
  // because larger batches are expected.
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => MeasureDto)
  measures!: MeasureDto[];
}
