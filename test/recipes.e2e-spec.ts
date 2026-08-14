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
  recipe: { id: string; name: string };
  ingredients: { id: string; name: string }[];
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
    await prisma.$executeRaw`TRUNCATE recipes, recipe_ingredients RESTART IDENTITY CASCADE`;
  });

  function authed() {
    return { Authorization: `Bearer ${accessToken}` };
  }

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer()).get('/recipes').expect(401);
  });

  it('lists recipes with an ingredient count', async () => {
    const recipe = await prisma.recipe.create({
      data: { name: 'Soup', servings: 4, instructions: '...' },
    });
    await prisma.recipeIngredient.createMany({
      data: [
        {
          recipeId: recipe.id,
          position: 0,
          name: 'Carrot',
          quantity: '2',
          unit: '',
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

    const res = await request(app.getHttpServer())
      .get(`/recipes/${recipe.id}`)
      .set(authed())
      .expect(200);

    const body = res.body as RecipeDetailBody;
    expect(body.recipe.id).toBe(recipe.id);
    expect(body.ingredients.map((i) => i.name)).toEqual(['Carrot', 'Onion']);
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
});
