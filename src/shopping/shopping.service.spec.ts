import { Unit } from '@prisma/client';

import { IngredientsService } from '../recipes/ingredients.service';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';
import { ShoppingService } from './shopping.service';

describe('ShoppingService', () => {
  let prisma: PrismaService;
  let shopping: ShoppingService;

  beforeAll(() => {
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE shopping_lists, shopping_items, recipes, recipe_ingredients RESTART IDENTITY CASCADE`;
    shopping = new ShoppingService(prisma, new IngredientsService());
  });

  describe('list', () => {
    it('returns lists ordered by creation with unchecked item counts', async () => {
      const listA = await prisma.shoppingList.create({ data: { name: 'A' } });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const listB = await prisma.shoppingList.create({ data: { name: 'B' } });

      await prisma.shoppingItem.createMany({
        data: [
          {
            listId: listA.id,
            name: 'x',
            quantity: '1',
            unit: 'UNITE',
            checked: false,
          },
          {
            listId: listA.id,
            name: 'y',
            quantity: '1',
            unit: 'UNITE',
            checked: true,
          },
          {
            listId: listB.id,
            name: 'z',
            quantity: '1',
            unit: 'UNITE',
            checked: false,
          },
        ],
      });

      const result = await shopping.list();

      expect(result.map((l) => l.id)).toEqual([listA.id, listB.id]);
      expect(result.find((l) => l.id === listA.id)?.openCount).toBe(1);
      expect(result.find((l) => l.id === listB.id)?.openCount).toBe(1);
    });
  });

  describe('detail', () => {
    it('returns null for a missing list', async () => {
      expect(
        await shopping.detail('00000000-0000-0000-0000-000000000000'),
      ).toBeNull();
    });

    it('returns the list with its items ordered by creation', async () => {
      const list = await prisma.shoppingList.create({
        data: { name: 'Groceries' },
      });
      const item = await prisma.shoppingItem.create({
        data: {
          listId: list.id,
          name: 'Milk',
          quantity: '1',
          unit: 'L',
          checked: false,
        },
      });

      const result = await shopping.detail(list.id);

      expect(result?.list.id).toBe(list.id);
      expect(result?.items).toHaveLength(1);
      expect(result?.items[0].id).toBe(item.id);
    });
  });

  describe('addItem', () => {
    it('creates an unchecked item on the list', async () => {
      const list = await prisma.shoppingList.create({
        data: { name: 'Groceries' },
      });

      const item = await shopping.addItem(list.id, {
        name: 'Eggs',
        quantity: '12',
        unit: 'UNITE',
      });

      expect(item.checked).toBe(false);
      expect(item.name).toBe('Eggs');
    });

    it('rejects an item for a list that does not exist', async () => {
      await expect(
        shopping.addItem('00000000-0000-0000-0000-000000000000', {
          name: 'Eggs',
          quantity: '12',
          unit: 'UNITE',
        }),
      ).rejects.toThrow(ApiError);
    });
  });

  describe('toggleItem', () => {
    it('flips checked on and off', async () => {
      const list = await prisma.shoppingList.create({
        data: { name: 'Groceries' },
      });
      const item = await prisma.shoppingItem.create({
        data: {
          listId: list.id,
          name: 'Milk',
          quantity: '1',
          unit: 'L',
          checked: false,
        },
      });

      const toggled = await shopping.toggleItem(item.id);
      expect(toggled.checked).toBe(true);

      const toggledBack = await shopping.toggleItem(item.id);
      expect(toggledBack.checked).toBe(false);
    });

    it('rejects an unknown item id', async () => {
      await expect(
        shopping.toggleItem('00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(ApiError);
    });
  });

  describe('addIngredientsToList', () => {
    async function seedRecipe(
      ingredients: { name: string; quantity: string; unit: Unit }[],
    ) {
      const recipe = await prisma.recipe.create({
        data: { name: 'Soup', servings: 4 },
      });
      await prisma.recipeIngredient.createMany({
        data: ingredients.map((ingredient, position) => ({
          recipeId: recipe.id,
          position,
          ...ingredient,
        })),
      });
      return recipe;
    }

    it('rejects when neither listId nor newListName is given', async () => {
      const recipe = await seedRecipe([
        { name: 'Carrot', quantity: '2', unit: 'UNITE' },
      ]);
      await expect(
        shopping.addIngredientsToList({ recipeId: recipe.id }),
      ).rejects.toThrow(ApiError);
    });

    it('rejects when both listId and newListName are given', async () => {
      const recipe = await seedRecipe([
        { name: 'Carrot', quantity: '2', unit: 'UNITE' },
      ]);
      const list = await prisma.shoppingList.create({
        data: { name: 'Existing' },
      });
      await expect(
        shopping.addIngredientsToList({
          recipeId: recipe.id,
          listId: list.id,
          newListName: 'New',
        }),
      ).rejects.toThrow(ApiError);
    });

    it('creates a new list and adds every ingredient to it (new-list path)', async () => {
      const recipe = await seedRecipe([
        { name: 'Carrot', quantity: '2', unit: 'UNITE' },
        { name: 'Onion', quantity: '1', unit: 'UNITE' },
      ]);

      const result = await shopping.addIngredientsToList({
        recipeId: recipe.id,
        newListName: 'Soup night',
      });

      expect(result.added).toBe(2);
      expect(result.merged).toBe(0);

      const list = await prisma.shoppingList.findUniqueOrThrow({
        where: { id: result.listId },
      });
      expect(list.name).toBe('Soup night');

      const items = await prisma.shoppingItem.findMany({
        where: { listId: result.listId },
      });
      expect(items).toHaveLength(2);
      expect(items.every((item) => item.sourceRecipeId === recipe.id)).toBe(
        true,
      );
    });

    it('merges into an existing unchecked row with the same normalised name and unit', async () => {
      const recipe = await seedRecipe([
        { name: '  Carrot  ', quantity: '2', unit: 'KG' },
      ]);
      const list = await prisma.shoppingList.create({
        data: { name: 'Existing' },
      });
      const existing = await prisma.shoppingItem.create({
        data: {
          listId: list.id,
          name: 'carrot',
          quantity: '1',
          unit: 'KG',
          checked: false,
        },
      });

      const result = await shopping.addIngredientsToList({
        recipeId: recipe.id,
        listId: list.id,
      });

      expect(result.added).toBe(0);
      expect(result.merged).toBe(1);

      const updated = await prisma.shoppingItem.findUniqueOrThrow({
        where: { id: existing.id },
      });
      expect(updated.quantity.toString()).toBe('3');

      const allItems = await prisma.shoppingItem.findMany({
        where: { listId: list.id },
      });
      expect(allItems).toHaveLength(1);
    });

    it('does not merge into a checked row — creates a new row instead', async () => {
      const recipe = await seedRecipe([
        { name: 'Carrot', quantity: '2', unit: 'KG' },
      ]);
      const list = await prisma.shoppingList.create({
        data: { name: 'Existing' },
      });
      await prisma.shoppingItem.create({
        data: {
          listId: list.id,
          name: 'Carrot',
          quantity: '1',
          unit: 'KG',
          checked: true,
        },
      });

      const result = await shopping.addIngredientsToList({
        recipeId: recipe.id,
        listId: list.id,
      });

      expect(result.added).toBe(1);
      expect(result.merged).toBe(0);

      const allItems = await prisma.shoppingItem.findMany({
        where: { listId: list.id },
      });
      expect(allItems).toHaveLength(2);
    });

    it('does not merge across a unit mismatch — creates a new row instead', async () => {
      const recipe = await seedRecipe([
        { name: 'Carrot', quantity: '2', unit: 'KG' },
      ]);
      const list = await prisma.shoppingList.create({
        data: { name: 'Existing' },
      });
      await prisma.shoppingItem.create({
        data: {
          listId: list.id,
          name: 'Carrot',
          quantity: '1',
          unit: 'G',
          checked: false,
        },
      });

      const result = await shopping.addIngredientsToList({
        recipeId: recipe.id,
        listId: list.id,
      });

      expect(result.added).toBe(1);
      expect(result.merged).toBe(0);

      const allItems = await prisma.shoppingItem.findMany({
        where: { listId: list.id },
      });
      expect(allItems).toHaveLength(2);
    });

    it('rejects an unknown listId', async () => {
      const recipe = await seedRecipe([
        { name: 'Carrot', quantity: '2', unit: 'UNITE' },
      ]);
      await expect(
        shopping.addIngredientsToList({
          recipeId: recipe.id,
          listId: '00000000-0000-0000-0000-000000000000',
        }),
      ).rejects.toThrow(ApiError);
    });
  });
});
