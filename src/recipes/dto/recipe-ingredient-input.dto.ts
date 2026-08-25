import { Unit } from '@prisma/client';
import { IsEnum, IsNotEmpty, Matches } from 'class-validator';

export class RecipeIngredientInputDto {
  @IsNotEmpty()
  name!: string;

  @Matches(/^\d+(\.\d+)?$/)
  quantity!: string;

  @IsEnum(Unit)
  unit!: Unit;
}
