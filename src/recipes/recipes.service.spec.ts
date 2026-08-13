import { PrismaService } from '../prisma/prisma.service';
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
    await prisma.$executeRaw`TRUNCATE recipes, recipe_ingredients RESTART IDENTITY CASCADE`;
    recipes = new RecipesService(prisma);
  });

  describe('list', () => {
    it('returns recipes ordered by creation with an ingredient count aggregate', async () => {
      const soup = await prisma.recipe.create({
        data: { name: 'Soup', servings: 4, instructions: '...' },
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const salad = await prisma.recipe.create({
        data: { name: 'Salad', servings: 2, instructions: '...' },
      });
      await prisma.recipeIngredient.createMany({
        data: [
          {
            recipeId: soup.id,
            position: 0,
            name: 'Carrot',
            quantity: '2',
            unit: '',
          },
          {
            recipeId: soup.id,
            position: 1,
            name: 'Onion',
            quantity: '1',
            unit: '',
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

    it('returns the recipe with its ingredients ordered by position', async () => {
      const recipe = await prisma.recipe.create({
        data: { name: 'Soup', servings: 4, instructions: '...' },
      });
      await prisma.recipeIngredient.createMany({
        data: [
          {
            recipeId: recipe.id,
            position: 1,
            name: 'Onion',
            quantity: '1',
            unit: '',
          },
          {
            recipeId: recipe.id,
            position: 0,
            name: 'Carrot',
            quantity: '2',
            unit: '',
          },
        ],
      });

      const result = await recipes.detail(recipe.id);

      expect(result?.recipe.id).toBe(recipe.id);
      expect(result?.ingredients.map((i) => i.name)).toEqual([
        'Carrot',
        'Onion',
      ]);
    });
  });
});
