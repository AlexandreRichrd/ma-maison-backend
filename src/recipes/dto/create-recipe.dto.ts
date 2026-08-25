import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  Min,
  ValidateNested,
} from 'class-validator';

import { RecipeIngredientInputDto } from './recipe-ingredient-input.dto';
import { RecipeStepInputDto } from './recipe-step-input.dto';

export class CreateRecipeDto {
  @IsNotEmpty()
  name!: string;

  @IsInt()
  @Min(1)
  servings!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientInputDto)
  ingredients!: RecipeIngredientInputDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecipeStepInputDto)
  steps!: RecipeStepInputDto[];
}
