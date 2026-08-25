import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';

import { RecipeIngredientInputDto } from './recipe-ingredient-input.dto';
import { RecipeStepInputDto } from './recipe-step-input.dto';

// Hand-written rather than PartialType(CreateRecipeDto) — same reasoning
// as UpdateChoreDto: avoids a new dependency for 4 optional fields.
// ingredients/steps, when present, replace the recipe's full current set
// (see RecipesService.update) — not a per-row patch.
export class UpdateRecipeDto {
  @IsOptional()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  servings?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecipeIngredientInputDto)
  ingredients?: RecipeIngredientInputDto[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RecipeStepInputDto)
  steps?: RecipeStepInputDto[];
}
