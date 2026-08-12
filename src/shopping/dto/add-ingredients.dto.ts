import { IsOptional, IsUUID, IsNotEmpty } from 'class-validator';

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
}
