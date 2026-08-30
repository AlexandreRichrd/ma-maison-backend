import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, IsNotEmpty, Min } from 'class-validator';

// Exactly one of listId / newListName must be present — checked in
// ShoppingService (a cross-field rule, not a single-field constraint).
export class AddIngredientsDto {
  @IsUUID()
  recipeId!: string;

  @IsOptional()
  @IsUUID()
  listId?: string;

  @IsOptional()
  @IsNotEmpty()
  newListName?: string;

  // The servings the caller is currently viewing the recipe scaled to — if
  // given and different from the recipe's own `servings`, quantities are
  // scaled (see quantity-scaling.ts) before being merged/inserted. Omitted
  // means "use the recipe's stored quantities as-is", unchanged from before
  // this field existed.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  servings?: number;
}
