import { PrismaService } from '../prisma/prisma.service';
import { ApiError } from '../common/api-error';
import { RecipesService } from './recipes.service';

describe('RecipesService', () => {
  let prisma: PrismaService;
  let recipes: RecipesService;

  beforeAll(() => {
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE recipes, recipe_ingredients, recipe_steps RESTART IDENTITY CASCADE`;
    recipes = new RecipesService(prisma);
  });

  describe('list', () => {
    it('returns recipes ordered by creation with an ingredient count aggregate', async () => {
      const soup = await prisma.recipe.create({
        data: { name: 'Soup', servings: 4 },
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const salad = await prisma.recipe.create({
        data: { name: 'Salad', servings: 2 },
      });
      await prisma.recipeIngredient.createMany({
        data: [
          {
            recipeId: soup.id,
            position: 0,
            name: 'Carrot',
            quantity: '2',
            unit: 'UNITE',
          },
          {
            recipeId: soup.id,
            position: 1,
            name: 'Onion',
            quantity: '1',
            unit: 'UNITE',
          },
        ],
      });

      const result = await recipes.list();

      expect(result.map((r) => r.id)).toEqual([soup.id, salad.id]);
      expect(result.find((r) => r.id === soup.id)?.ingredientCount).toBe(2);
      expect(result.find((r) => r.id === salad.id)?.ingredientCount).toBe(0);
    });
  });

  describe('detail', () => {
    it('returns null for a missing recipe', async () => {
      expect(
        await recipes.detail('00000000-0000-0000-0000-000000000000'),
      ).toBeNull();
    });

    it('returns the recipe with its ingredients and steps ordered by position', async () => {
      const recipe = await prisma.recipe.create({
        data: { name: 'Soup', servings: 4 },
      });
      await prisma.recipeIngredient.createMany({
        data: [
          {
            recipeId: recipe.id,
            position: 1,
            name: 'Onion',
            quantity: '1',
            unit: 'UNITE',
          },
          {
            recipeId: recipe.id,
            position: 0,
            name: 'Carrot',
            quantity: '2',
            unit: 'UNITE',
          },
        ],
      });
      await prisma.recipeStep.createMany({
        data: [
          { recipeId: recipe.id, position: 1, text: 'Simmer' },
          { recipeId: recipe.id, position: 0, text: 'Chop' },
        ],
      });

      const result = await recipes.detail(recipe.id);

      expect(result?.recipe.id).toBe(recipe.id);
      expect(result?.ingredients.map((i) => i.name)).toEqual([
        'Carrot',
        'Onion',
      ]);
      expect(result?.steps.map((s) => s.text)).toEqual(['Chop', 'Simmer']);
    });
  });

  describe('create', () => {
    it('creates a recipe with ordered ingredients and steps', async () => {
      const result = await recipes.create({
        name: 'Soup',
        servings: 4,
        ingredients: [
          { name: 'Carrot', quantity: '2', unit: 'UNITE' },
          { name: 'Salt', quantity: '1', unit: 'PINCEE' },
        ],
        steps: [{ text: 'Chop' }, { text: 'Simmer' }],
      });

      expect(result.recipe.name).toBe('Soup');
      expect(result.ingredients.map((i) => i.name)).toEqual([
        'Carrot',
        'Salt',
      ]);
      expect(result.ingredients.map((i) => i.position)).toEqual([0, 1]);
      expect(result.steps.map((s) => s.text)).toEqual(['Chop', 'Simmer']);
      expect(result.steps.map((s) => s.position)).toEqual([0, 1]);
    });
  });

  describe('update', () => {
    it('rejects an unknown recipe', async () => {
      await expect(
        recipes.update('00000000-0000-0000-0000-000000000000', {
          name: 'New name',
        }),
      ).rejects.toThrow(ApiError);
    });

    it('updates scalar fields without touching ingredients/steps when omitted', async () => {
      const created = await recipes.create({
        name: 'Soup',
        servings: 4,
        ingredients: [{ name: 'Carrot', quantity: '2', unit: 'UNITE' }],
        steps: [{ text: 'Chop' }],
      });

      const result = await recipes.update(created.recipe.id, {
        servings: 6,
      });

      expect(result.recipe.servings).toBe(6);
      expect(result.ingredients.map((i) => i.name)).toEqual(['Carrot']);
      expect(result.steps.map((s) => s.text)).toEqual(['Chop']);
    });

    it('replaces the full ingredient and step lists when given', async () => {
      const created = await recipes.create({
        name: 'Soup',
        servings: 4,
        ingredients: [{ name: 'Carrot', quantity: '2', unit: 'UNITE' }],
        steps: [{ text: 'Chop' }],
      });

      const result = await recipes.update(created.recipe.id, {
        ingredients: [
          { name: 'Leek', quantity: '1', unit: 'UNITE' },
          { name: 'Salt', quantity: '1', unit: 'PINCEE' },
        ],
        steps: [{ text: 'Boil' }, { text: 'Blend' }, { text: 'Serve' }],
      });

      expect(result.ingredients.map((i) => i.name)).toEqual([
        'Leek',
        'Salt',
      ]);
      expect(result.steps.map((s) => s.text)).toEqual([
        'Boil',
        'Blend',
        'Serve',
      ]);
    });
  });

  describe('remove', () => {
    it('rejects an unknown recipe', async () => {
      await expect(
        recipes.remove('00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(ApiError);
    });

    it('deletes the recipe and cascades its ingredients and steps', async () => {
      const created = await recipes.create({
        name: 'Soup',
        servings: 4,
        ingredients: [{ name: 'Carrot', quantity: '2', unit: 'UNITE' }],
        steps: [{ text: 'Chop' }],
      });

      await recipes.remove(created.recipe.id);

      expect(await recipes.detail(created.recipe.id)).toBeNull();
      expect(
        await prisma.recipeIngredient.count({
          where: { recipeId: created.recipe.id },
        }),
      ).toBe(0);
      expect(
        await prisma.recipeStep.count({
          where: { recipeId: created.recipe.id },
        }),
      ).toBe(0);
    });
  });
});
