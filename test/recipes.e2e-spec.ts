import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

type ErrorBody = {
  statusCode: number;
  errors: { field: string; code: string }[];
};
type LoginBody = { accessToken: string };
type RecipePreviewBody = { id: string; name: string; ingredientCount: number };
type RecipeDetailBody = {
  recipe: { id: string; name: string; servings: number };
  ingredients: { id: string; name: string; quantity: string }[];
};

describe('Recipes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let accessToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = moduleFixture.get(PrismaService);

    const household = await prisma.household.create({
      data: { memberOrder: [] },
    });
    const passwordHash = await argon2.hash('whatever123', {
      type: argon2.argon2id,
    });
    await prisma.user.create({
      data: {
        householdId: household.id,
        email: 'cook@example.com',
        passwordHash,
        name: 'Cook',
        avatarKey: 'cook',
        emailVerifiedAt: new Date(),
      },
    });
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'cook@example.com', password: 'whatever123' })
      .expect(200);
    accessToken = (loginRes.body as LoginBody).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE recipes, recipe_ingredients, recipe_steps, shopping_lists, shopping_items RESTART IDENTITY CASCADE`;
  });

  function authed() {
    return { Authorization: `Bearer ${accessToken}` };
  }

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer()).get('/recipes').expect(401);
  });

  it('lists recipes with an ingredient count', async () => {
    const recipe = await prisma.recipe.create({
      data: { name: 'Soup', servings: 4 },
    });
    await prisma.recipeIngredient.createMany({
      data: [
        {
          recipeId: recipe.id,
          position: 0,
          name: 'Carrot',
          quantity: '2',
          unit: 'UNITE',
        },
      ],
    });

    const res = await request(app.getHttpServer())
      .get('/recipes')
      .set(authed())
      .expect(200);

    expect(res.body as RecipePreviewBody[]).toEqual([
      expect.objectContaining({
        id: recipe.id,
        name: 'Soup',
        ingredientCount: 1,
      }),
    ]);
  });

  it('returns recipe detail with ordered ingredients', async () => {
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

    const res = await request(app.getHttpServer())
      .get(`/recipes/${recipe.id}`)
      .set(authed())
      .expect(200);

    const body = res.body as RecipeDetailBody;
    expect(body.recipe.id).toBe(recipe.id);
    expect(body.ingredients.map((i) => i.name)).toEqual(['Carrot', 'Onion']);
  });

  it('scales ingredient quantities via ?servings= without touching the stored recipe', async () => {
    const recipe = await prisma.recipe.create({
      data: { name: 'Soup', servings: 4 },
    });
    await prisma.recipeIngredient.create({
      data: {
        recipeId: recipe.id,
        position: 0,
        name: 'Broth',
        quantity: '250',
        unit: 'ML',
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/recipes/${recipe.id}`)
      .query({ servings: 3 })
      .set(authed())
      .expect(200);

    const body = res.body as RecipeDetailBody;
    expect(body.recipe.servings).toBe(4);
    expect(body.ingredients[0]?.quantity).toBe('187.5');

    const stored = await prisma.recipeIngredient.findUniqueOrThrow({
      where: { id: body.ingredients[0]!.id },
    });
    expect(stored.quantity.toString()).toBe('250');
  });

  it('rejects an invalid ?servings= value', async () => {
    const recipe = await prisma.recipe.create({
      data: { name: 'Soup', servings: 4 },
    });

    await request(app.getHttpServer())
      .get(`/recipes/${recipe.id}`)
      .query({ servings: 0 })
      .set(authed())
      .expect(400);

    await request(app.getHttpServer())
      .get(`/recipes/${recipe.id}`)
      .query({ servings: 'abc' })
      .set(authed())
      .expect(400);
  });

  it('404s a detail request for an unknown recipe', async () => {
    const res = await request(app.getHttpServer())
      .get('/recipes/00000000-0000-0000-0000-000000000000')
      .set(authed())
      .expect(404);
    expect((res.body as ErrorBody).errors).toEqual([
      { field: 'id', code: 'not_found' },
    ]);
  });

  function validRecipeBody() {
    return {
      name: 'Soup',
      servings: 4,
      ingredients: [{ name: 'Carrot', quantity: '2', unit: 'UNITE' }],
      steps: [{ text: 'Chop' }, { text: 'Simmer' }],
    };
  }

  describe('POST /recipes', () => {
    it('creates a recipe with its ingredients and steps', async () => {
      const res = await request(app.getHttpServer())
        .post('/recipes')
        .set(authed())
        .send(validRecipeBody())
        .expect(201);

      const body = res.body as RecipeDetailBody & {
        steps: { text: string }[];
      };
      expect(body.recipe.name).toBe('Soup');
      expect(body.ingredients.map((i) => i.name)).toEqual(['Carrot']);
      expect(body.steps.map((s) => s.text)).toEqual(['Chop', 'Simmer']);
    });

    it('rejects a recipe with no ingredients', async () => {
      const res = await request(app.getHttpServer())
        .post('/recipes')
        .set(authed())
        .send({ ...validRecipeBody(), ingredients: [] })
        .expect(400);
      expect((res.body as ErrorBody).errors).toEqual(
        expect.arrayContaining([
          { field: 'ingredients', code: 'at_least_one_required' },
        ]),
      );
    });

    it('rejects an invalid unit', async () => {
      const res = await request(app.getHttpServer())
        .post('/recipes')
        .set(authed())
        .send({
          ...validRecipeBody(),
          ingredients: [{ name: 'Carrot', quantity: '2', unit: 'grammes' }],
        })
        .expect(400);
      expect((res.body as ErrorBody).errors).toEqual(
        expect.arrayContaining([{ field: 'unit', code: 'invalid_type' }]),
      );
    });
  });

  describe('PATCH /recipes/:id', () => {
    it('404s for an unknown recipe', async () => {
      const res = await request(app.getHttpServer())
        .patch('/recipes/00000000-0000-0000-0000-000000000000')
        .set(authed())
        .send({ servings: 6 })
        .expect(404);
      expect((res.body as ErrorBody).errors).toEqual([
        { field: 'id', code: 'not_found' },
      ]);
    });

    it('replaces ingredients and steps when given', async () => {
      const created = await request(app.getHttpServer())
        .post('/recipes')
        .set(authed())
        .send(validRecipeBody())
        .expect(201);
      const recipeId = (created.body as { recipe: { id: string } }).recipe.id;

      const res = await request(app.getHttpServer())
        .patch(`/recipes/${recipeId}`)
        .set(authed())
        .send({
          ingredients: [{ name: 'Leek', quantity: '1', unit: 'UNITE' }],
          steps: [{ text: 'Boil' }],
        })
        .expect(200);

      const body = res.body as RecipeDetailBody & {
        steps: { text: string }[];
      };
      expect(body.ingredients.map((i) => i.name)).toEqual(['Leek']);
      expect(body.steps.map((s) => s.text)).toEqual(['Boil']);
    });
  });

  describe('DELETE /recipes/:id', () => {
    it('404s for an unknown recipe', async () => {
      const res = await request(app.getHttpServer())
        .delete('/recipes/00000000-0000-0000-0000-000000000000')
        .set(authed())
        .expect(404);
      expect((res.body as ErrorBody).errors).toEqual([
        { field: 'id', code: 'not_found' },
      ]);
    });

    it('deletes the recipe', async () => {
      const created = await request(app.getHttpServer())
        .post('/recipes')
        .set(authed())
        .send(validRecipeBody())
        .expect(201);
      const recipeId = (created.body as { recipe: { id: string } }).recipe.id;

      await request(app.getHttpServer())
        .delete(`/recipes/${recipeId}`)
        .set(authed())
        .expect(204);

      await request(app.getHttpServer())
        .get(`/recipes/${recipeId}`)
        .set(authed())
        .expect(404);
    });

    it('leaves shopping items already sourced from it in place, unattributed', async () => {
      const created = await request(app.getHttpServer())
        .post('/recipes')
        .set(authed())
        .send(validRecipeBody())
        .expect(201);
      const recipeId = (created.body as { recipe: { id: string } }).recipe.id;

      const listRes = await request(app.getHttpServer())
        .post('/shopping-lists/add-ingredients')
        .set(authed())
        .send({ recipeId, newListName: 'Soup night' })
        .expect(201);
      const listId = (listRes.body as { listId: string }).listId;

      await request(app.getHttpServer())
        .delete(`/recipes/${recipeId}`)
        .set(authed())
        .expect(204);

      const items = await prisma.shoppingItem.findMany({ where: { listId } });
      expect(items).toHaveLength(1);
      expect(items[0].sourceRecipeId).toBeNull();
    });
  });
});
