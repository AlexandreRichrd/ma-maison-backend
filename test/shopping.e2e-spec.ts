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
type ShoppingListBody = { id: string; name: string; openCount?: number };
type ShoppingItemBody = { id: string; checked: boolean };
type ShoppingDetailBody = { list: ShoppingListBody; items: ShoppingItemBody[] };
type AddIngredientsBody = { listId: string; added: number; merged: number };

describe('Shopping (e2e)', () => {
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
        email: 'shopper@example.com',
        passwordHash,
        name: 'Shopper',
        avatarKey: 'shopper',
        emailVerifiedAt: new Date(),
      },
    });
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'shopper@example.com', password: 'whatever123' })
      .expect(200);
    accessToken = (loginRes.body as LoginBody).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE shopping_lists, shopping_items, recipes, recipe_ingredients, recipe_steps RESTART IDENTITY CASCADE`;
  });

  function authed() {
    return { Authorization: `Bearer ${accessToken}` };
  }

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer()).get('/shopping-lists').expect(401);
  });

  it('completes the create -> add item -> toggle -> detail flow', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/shopping-lists')
      .set(authed())
      .send({ name: 'Weekly groceries' })
      .expect(201);
    const { id: listId } = createRes.body as ShoppingListBody;
    expect(listId).toEqual(expect.any(String));

    const overview = await request(app.getHttpServer())
      .get('/shopping-lists')
      .set(authed())
      .expect(200);
    expect(overview.body).toEqual([
      expect.objectContaining({
        id: listId,
        name: 'Weekly groceries',
        openCount: 0,
      }),
    ]);

    const addRes = await request(app.getHttpServer())
      .post(`/shopping-lists/${listId}/items`)
      .set(authed())
      .send({ name: 'Milk', quantity: '2', unit: 'L' })
      .expect(201);
    const { id: itemId, checked: addedChecked } =
      addRes.body as ShoppingItemBody;
    expect(addedChecked).toBe(false);

    const detailRes = await request(app.getHttpServer())
      .get(`/shopping-lists/${listId}`)
      .set(authed())
      .expect(200);
    const detail = detailRes.body as ShoppingDetailBody;
    expect(detail.list.id).toBe(listId);
    expect(detail.items).toHaveLength(1);

    const toggleRes = await request(app.getHttpServer())
      .patch(`/shopping-items/${itemId}/toggle`)
      .set(authed())
      .expect(200);
    expect((toggleRes.body as ShoppingItemBody).checked).toBe(true);

    const overviewAfterToggle = await request(app.getHttpServer())
      .get('/shopping-lists')
      .set(authed())
      .expect(200);
    const [firstList] = overviewAfterToggle.body as ShoppingListBody[];
    expect(firstList.openCount).toBe(0);
  });

  it('404s a detail request for an unknown list', async () => {
    const res = await request(app.getHttpServer())
      .get('/shopping-lists/00000000-0000-0000-0000-000000000000')
      .set(authed())
      .expect(404);
    expect((res.body as ErrorBody).errors).toEqual([
      { field: 'id', code: 'not_found' },
    ]);
  });

  it('rejects a non-numeric quantity when adding an item', async () => {
    const list = await prisma.shoppingList.create({
      data: { name: 'Groceries' },
    });
    const res = await request(app.getHttpServer())
      .post(`/shopping-lists/${list.id}/items`)
      .set(authed())
      .send({ name: 'Milk', quantity: 'two', unit: 'L' })
      .expect(400);
    expect((res.body as ErrorBody).errors).toContainEqual({
      field: 'quantity',
      code: 'matches',
    });
  });

  it('adds recipe ingredients to a new list atomically', async () => {
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
        {
          recipeId: recipe.id,
          position: 1,
          name: 'Onion',
          quantity: '1',
          unit: 'UNITE',
        },
      ],
    });

    const res = await request(app.getHttpServer())
      .post('/shopping-lists/add-ingredients')
      .set(authed())
      .send({ recipeId: recipe.id, newListName: 'Soup night' })
      .expect(201);

    const body = res.body as AddIngredientsBody;
    expect(body.listId).toEqual(expect.any(String));
    expect(body.added).toBe(2);
    expect(body.merged).toBe(0);
  });
});
