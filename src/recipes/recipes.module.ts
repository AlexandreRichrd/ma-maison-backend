import { Module } from '@nestjs/common';

import { IngredientsService } from './ingredients.service';
import { RecipesController } from './recipes.controller';
import { RecipesService } from './recipes.service';

@Module({
  controllers: [RecipesController],
  providers: [IngredientsService, RecipesService],
  exports: [IngredientsService],
})
export class RecipesModule {}
