import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class AddShoppingItemDto {
  @IsNotEmpty()
  name!: string;

  @Matches(/^\d+(\.\d+)?$/)
  quantity!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  unit?: string;
}
