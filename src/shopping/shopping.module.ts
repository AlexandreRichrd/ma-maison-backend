import { Module } from '@nestjs/common';

import { RecipesModule } from '../recipes/recipes.module';
import { ShoppingController } from './shopping.controller';
import { ShoppingService } from './shopping.service';

// Owns: shopping_lists, shopping_items. Imports RecipesModule for
// IngredientsService (name normalisation), reused by
// addIngredientsToList() rather than duplicated.
@Module({
  imports: [RecipesModule],
  controllers: [ShoppingController],
  providers: [ShoppingService],
})
export class ShoppingModule {}
