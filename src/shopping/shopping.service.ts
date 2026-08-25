import { Injectable } from '@nestjs/common';

import { IngredientsService } from '../recipes/ingredients.service';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { Unit } from '@prisma/client';
import type { ShoppingItem, ShoppingList } from '@prisma/client';
import { AddIngredientsDto } from './dto/add-ingredients.dto';
import { AddShoppingItemDto } from './dto/add-shopping-item.dto';

export type ShoppingListPreview = ShoppingList & { openCount: number };

export type AddIngredientsResult = {
  listId: string;
  added: number;
  merged: number;
};

@Injectable()
export class ShoppingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingredients: IngredientsService,
  ) {}

  async list(): Promise<ShoppingListPreview[]> {
    const lists = await this.prisma.shoppingList.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { items: { where: { checked: false } } } } },
    });
    return lists.map(({ _count, ...list }) => ({
      ...list,
      openCount: _count.items,
    }));
  }

  async create(name: string): Promise<ShoppingList> {
    return this.prisma.shoppingList.create({ data: { name } });
  }

  async detail(
    listId: string,
  ): Promise<{ list: ShoppingList; items: ShoppingItem[] } | null> {
    const list = await this.prisma.shoppingList.findUnique({
      where: { id: listId },
    });
    if (!list) return null;

    const items = await this.prisma.shoppingItem.findMany({
      where: { listId },
      orderBy: { createdAt: 'asc' },
    });

    return { list, items };
  }

  async addItem(
    listId: string,
    dto: AddShoppingItemDto,
  ): Promise<ShoppingItem> {
    const list = await this.prisma.shoppingList.findUnique({
      where: { id: listId },
    });
    if (!list) {
      throw new ApiError(404, 'listId', 'not_found');
    }

    return this.prisma.shoppingItem.create({
      data: {
        listId,
        name: dto.name,
        quantity: dto.quantity,
        unit: dto.unit ?? Unit.UNITE,
        checked: false,
      },
    });
  }

  async toggleItem(itemId: string): Promise<ShoppingItem> {
    const item = await this.prisma.shoppingItem.findUnique({
      where: { id: itemId },
    });
    if (!item) {
      throw new ApiError(404, 'itemId', 'not_found');
    }

    return this.prisma.shoppingItem.update({
      where: { id: itemId },
      data: { checked: !item.checked, updatedAt: new Date() },
    });
  }

  /**
   * Pushes every ingredient of a recipe into a shopping list, in one
   * transaction (either the whole thing lands or none of it does). Merges
   * into an existing *unchecked* row with the same normalised name + unit
   * by summing quantities atomically (Prisma's Decimal `increment`, no JS
   * float math); a checked row is left alone and a new row is created
   * instead. Every inserted row is tagged with `sourceRecipeId`.
   */
  async addIngredientsToList(
    dto: AddIngredientsDto,
  ): Promise<AddIngredientsResult> {
    if (Boolean(dto.listId) === Boolean(dto.newListName)) {
      throw new ApiError(400, 'form', 'invalid_target');
    }

    if (dto.listId) {
      const existing = await this.prisma.shoppingList.findUnique({
        where: { id: dto.listId },
      });
      if (!existing) {
        throw new ApiError(404, 'listId', 'not_found');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const listId = dto.listId
        ? dto.listId
        : (
            await tx.shoppingList.create({
              data: { name: dto.newListName as string },
            })
          ).id;

      const recipeIngredients = await tx.recipeIngredient.findMany({
        where: { recipeId: dto.recipeId },
        orderBy: { position: 'asc' },
      });

      const unchecked = await tx.shoppingItem.findMany({
        where: { listId, checked: false },
      });

      let added = 0;
      let merged = 0;

      for (const ingredient of recipeIngredients) {
        const normalisedName = this.ingredients.normaliseIngredientName(
          ingredient.name,
        );
        const match = unchecked.find(
          (item) =>
            this.ingredients.normaliseIngredientName(item.name) ===
              normalisedName && item.unit === ingredient.unit,
        );

        if (match) {
          await tx.shoppingItem.update({
            where: { id: match.id },
            data: {
              quantity: { increment: ingredient.quantity },
              updatedAt: new Date(),
            },
          });
          merged += 1;
        } else {
          const inserted = await tx.shoppingItem.create({
            data: {
              listId,
              name: ingredient.name,
              quantity: ingredient.quantity,
              unit: ingredient.unit,
              sourceRecipeId: dto.recipeId,
            },
          });
          unchecked.push(inserted);
          added += 1;
        }
      }

      return { listId, added, merged };
    });
  }
}
