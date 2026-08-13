import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';

import { ApiError } from '../common/api-error';
import { RecipesService } from './recipes.service';

@Controller()
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  @Get('recipes')
  list() {
    return this.recipes.list();
  }

  @Get('recipes/:id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const detail = await this.recipes.detail(id);
    if (!detail) {
      throw new ApiError(404, 'id', 'not_found');
    }
    return detail;
  }
}
