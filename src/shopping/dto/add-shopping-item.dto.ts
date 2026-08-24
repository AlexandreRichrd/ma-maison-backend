import { Unit } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, Matches } from 'class-validator';

export class AddShoppingItemDto {
  @IsNotEmpty()
  name!: string;

  @Matches(/^\d+(\.\d+)?$/)
  quantity!: string;

  // Defaults to UNITE (bare count, no real unit) when omitted — same
  // closed set recipe_ingredients.unit uses, so a hand-added item can
  // still merge against a recipe-sourced one in
  // ShoppingService.addIngredientsToList (see CLAUDE.md's Database
  // section).
  @IsOptional()
  @IsEnum(Unit)
  unit?: Unit;
}
