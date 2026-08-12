import { Module } from '@nestjs/common';

import { IngredientsService } from './ingredients.service';

@Module({
  providers: [IngredientsService],
  exports: [IngredientsService],
})
export class RecipesModule {}
