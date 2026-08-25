import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';

import { ApiError } from '../common/api-error';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { UpdateRecipeDto } from './dto/update-recipe.dto';
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

  @Post('recipes')
  create(@Body() dto: CreateRecipeDto) {
    return this.recipes.create(dto);
  }

  @Patch('recipes/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRecipeDto) {
    return this.recipes.update(id, dto);
  }

  @HttpCode(204)
  @Delete('recipes/:id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.recipes.remove(id);
  }
}
