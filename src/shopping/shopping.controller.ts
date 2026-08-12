import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';

import { ApiError } from '../common/api-error';
import { AddIngredientsDto } from './dto/add-ingredients.dto';
import { AddShoppingItemDto } from './dto/add-shopping-item.dto';
import { CreateShoppingListDto } from './dto/create-shopping-list.dto';
import { ShoppingService } from './shopping.service';

@Controller()
export class ShoppingController {
  constructor(private readonly shopping: ShoppingService) {}

  @Get('shopping-lists')
  list() {
    return this.shopping.list();
  }

  @Post('shopping-lists')
  create(@Body() dto: CreateShoppingListDto) {
    return this.shopping.create(dto.name);
  }

  // Before the :id route below so it isn't ever shadowed by it — same
  // HTTP method, both single-segment paths under /shopping-lists.
  @Post('shopping-lists/add-ingredients')
  addIngredientsToList(@Body() dto: AddIngredientsDto) {
    return this.shopping.addIngredientsToList(dto);
  }

  @Get('shopping-lists/:id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const detail = await this.shopping.detail(id);
    if (!detail) {
      throw new ApiError(404, 'id', 'not_found');
    }
    return detail;
  }

  @Post('shopping-lists/:listId/items')
  addItem(
    @Param('listId', ParseUUIDPipe) listId: string,
    @Body() dto: AddShoppingItemDto,
  ) {
    return this.shopping.addItem(listId, dto);
  }

  @HttpCode(200)
  @Patch('shopping-items/:id/toggle')
  toggleItem(@Param('id', ParseUUIDPipe) id: string) {
    return this.shopping.toggleItem(id);
  }
}
