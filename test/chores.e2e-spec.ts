import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AssignmentMode, FrequencyUnit } from '@prisma/client';
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
type ChoreBody = {
  id: string;
  name: string;
  frequencyUnit: string;
  frequencyValue: number;
  assignmentMode: string;
  anchorDate: string;
  anchorUserId: string;
};

describe('Chores admin CRUD (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let accessToken: string;
  let firstUserId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = moduleFixture.get(PrismaService);

    // Seeded and logged in once — see cleaning.e2e-spec.ts's note on the
    // login-identifier throttle (5 per 15 minutes).
    await prisma.$executeRaw`TRUNCATE households, users, chores, chore_completions RESTART IDENTITY CASCADE`;

    const household = await prisma.household.create({
      data: { memberOrder: [] },
    });
    const passwordHash = await argon2.hash('whatever123', {
      type: argon2.argon2id,
    });
    const first = await prisma.user.create({
      data: {
        householdId: household.id,
        email: 'mia@example.com',
        passwordHash,
        name: 'Mia',
        avatarKey: 'mia',
        emailVerifiedAt: new Date(),
      },
    });
    const second = await prisma.user.create({
      data: {
        householdId: household.id,
        email: 'sam@example.com',
        passwordHash,
        name: 'Sam',
        avatarKey: 'sam',
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.household.update({
      where: { id: household.id },
      data: { memberOrder: [first.id, second.id] },
    });
    firstUserId = first.id;

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'mia@example.com', password: 'whatever123' })
      .expect(200);
    accessToken = (loginRes.body as LoginBody).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE chores, chore_completions RESTART IDENTITY CASCADE`;
  });

  function authed() {
    return { Authorization: `Bearer ${accessToken}` };
  }

  // The shape a valid chore row actually has. Kept separate from the HTTP
  // fixture below so a direct `prisma.chore.create` write — which can only
  // ever hold a real `AssignmentMode`, unlike a request body — gets that
  // literal type instead of the widened `string` an inline object literal
  // would infer.
  function validChoreRow(): {
    name: string;
    frequencyUnit: FrequencyUnit;
    frequencyValue: number;
    assignmentMode: AssignmentMode;
    anchorDate: Date;
    anchorUserId: string;
  } {
    return {
      name: 'Cuisine',
      frequencyUnit: FrequencyUnit.WEEK,
      frequencyValue: 1,
      assignmentMode: AssignmentMode.ROTATING,
      anchorDate: new Date('2024-01-01'),
      anchorUserId: firstUserId,
    };
  }

  // Request bodies, which may deliberately carry invalid values (see the
  // rejects-an-invalid-% cases below) — overrides stay untyped on purpose.
  // anchorDate is a plain 'YYYY-MM-DD' string over HTTP, unlike
  // validChoreRow()'s Date (what Prisma's `anchorDate: DateTime @db.Date`
  // column expects for a direct write).
  function validChore(overrides: Record<string, unknown> = {}) {
    return { ...validChoreRow(), anchorDate: '2024-01-01', ...overrides };
  }

  describe('GET /cleaning/chores', () => {
    it('rejects unauthenticated requests', async () => {
      await request(app.getHttpServer()).get('/cleaning/chores').expect(401);
    });

    it('lists every chore', async () => {
      await prisma.chore.create({ data: validChoreRow() });

      const res = await request(app.getHttpServer())
        .get('/cleaning/chores')
        .set(authed())
        .expect(200);

      expect(res.body as ChoreBody[]).toHaveLength(1);
    });
  });

  describe('POST /cleaning/chores', () => {
    it('creates a chore', async () => {
      const res = await request(app.getHttpServer())
        .post('/cleaning/chores')
        .set(authed())
        .send(
          validChore({
            name: 'Draps',
            frequencyUnit: 'WEEK',
            frequencyValue: 2,
            assignmentMode: 'PINNED',
          }),
        )
        .expect(201);

      const body = res.body as ChoreBody;
      expect(body).toMatchObject({
        name: 'Draps',
        frequencyUnit: 'WEEK',
        frequencyValue: 2,
        assignmentMode: 'PINNED',
        anchorUserId: firstUserId,
      });
      expect(body.anchorDate.slice(0, 10)).toBe('2024-01-01');
    });

    it.each([
      ['name', { name: '' }, 'required'],
      ['frequencyUnit', { frequencyUnit: 'MONTH' }, 'invalid_type'],
      ['frequencyValue', { frequencyValue: 0 }, 'too_small'],
      ['assignmentMode', { assignmentMode: 'SOMETHING_ELSE' }, 'invalid_type'],
      ['anchorDate', { anchorDate: 'not-a-date' }, 'invalid_iso_date'],
      ['anchorUserId', { anchorUserId: 'not-a-uuid' }, 'invalid_id'],
    ])('rejects an invalid %s (%o)', async (field, override, code) => {
      const res = await request(app.getHttpServer())
        .post('/cleaning/chores')
        .set(authed())
        .send(validChore(override))
        .expect(400);
      expect((res.body as ErrorBody).errors).toContainEqual({ field, code });
    });

    it('rejects a non-numeric frequencyValue', async () => {
      const res = await request(app.getHttpServer())
        .post('/cleaning/chores')
        .set(authed())
        .send(validChore({ frequencyValue: 'not-a-number' }))
        .expect(400);
      expect(
        (res.body as ErrorBody).errors.some(
          (e) => e.field === 'frequencyValue',
        ),
      ).toBe(true);
    });

    it('creates a daily chore with a non-Monday anchorDate', async () => {
      const res = await request(app.getHttpServer())
        .post('/cleaning/chores')
        .set(authed())
        .send(
          validChore({
            name: 'Vaisselle',
            frequencyUnit: 'DAY',
            frequencyValue: 1,
            // A Wednesday — fine for a daily chore.
            anchorDate: '2024-01-03',
          }),
        )
        .expect(201);

      expect((res.body as ChoreBody).frequencyUnit).toBe('DAY');
    });

    it('rejects a non-Monday anchorDate for a weekly chore', async () => {
      const res = await request(app.getHttpServer())
        .post('/cleaning/chores')
        .set(authed())
        // 2024-01-02 is a Tuesday.
        .send(validChore({ anchorDate: '2024-01-02' }))
        .expect(400);
      expect((res.body as ErrorBody).errors).toEqual([
        { field: 'anchorDate', code: 'anchor_date_not_monday' },
      ]);
    });

    it('rejects a real but non-household anchorUserId', async () => {
      const otherHousehold = await prisma.household.create({
        data: { memberOrder: [] },
      });
      const outsider = await prisma.user.create({
        data: {
          householdId: otherHousehold.id,
          email: 'outsider@example.com',
          passwordHash: 'x',
          name: 'Outsider',
          avatarKey: 'outsider',
          emailVerifiedAt: new Date(),
        },
      });

      const res = await request(app.getHttpServer())
        .post('/cleaning/chores')
        .set(authed())
        .send(validChore({ anchorUserId: outsider.id }))
        .expect(400);
      expect((res.body as ErrorBody).errors).toEqual([
        { field: 'anchorUserId', code: 'invalid_id' },
      ]);
    });
  });

  describe('PATCH /cleaning/chores/:choreId', () => {
    it('patches a chore', async () => {
      const chore = await prisma.chore.create({ data: validChoreRow() });

      const res = await request(app.getHttpServer())
        .patch(`/cleaning/chores/${chore.id}`)
        .set(authed())
        .send({ name: 'Cuisine et vaisselle' })
        .expect(200);

      expect((res.body as ChoreBody).name).toBe('Cuisine et vaisselle');
    });

    it('404s for an unknown chore', async () => {
      await request(app.getHttpServer())
        .patch('/cleaning/chores/00000000-0000-0000-0000-000000000000')
        .set(authed())
        .send({ name: 'x' })
        .expect(404);
    });

    it('rejects a real but non-household anchorUserId', async () => {
      const chore = await prisma.chore.create({ data: validChoreRow() });
      const otherHousehold = await prisma.household.create({
        data: { memberOrder: [] },
      });
      const outsider = await prisma.user.create({
        data: {
          householdId: otherHousehold.id,
          email: 'outsider2@example.com',
          passwordHash: 'x',
          name: 'Outsider',
          avatarKey: 'outsider',
          emailVerifiedAt: new Date(),
        },
      });

      await request(app.getHttpServer())
        .patch(`/cleaning/chores/${chore.id}`)
        .set(authed())
        .send({ anchorUserId: outsider.id })
        .expect(400);
    });

    it('rejects patching anchorDate to a non-Monday on a weekly chore', async () => {
      const chore = await prisma.chore.create({ data: validChoreRow() });

      const res = await request(app.getHttpServer())
        .patch(`/cleaning/chores/${chore.id}`)
        .set(authed())
        // 2024-01-02 is a Tuesday.
        .send({ anchorDate: '2024-01-02' })
        .expect(400);
      expect((res.body as ErrorBody).errors).toEqual([
        { field: 'anchorDate', code: 'anchor_date_not_monday' },
      ]);
    });
  });

  describe('DELETE /cleaning/chores/:choreId', () => {
    it('deletes a chore and cascades its completions', async () => {
      const chore = await prisma.chore.create({ data: validChoreRow() });
      await prisma.choreCompletion.create({
        data: {
          choreId: chore.id,
          userId: firstUserId,
          occurrenceDate: new Date('2024-01-01'),
        },
      });

      await request(app.getHttpServer())
        .delete(`/cleaning/chores/${chore.id}`)
        .set(authed())
        .expect(204);

      expect(
        await prisma.chore.findUnique({ where: { id: chore.id } }),
      ).toBeNull();
      expect(
        await prisma.choreCompletion.findMany({ where: { choreId: chore.id } }),
      ).toEqual([]);
    });

    it('404s for an unknown chore', async () => {
      await request(app.getHttpServer())
        .delete('/cleaning/chores/00000000-0000-0000-0000-000000000000')
        .set(authed())
        .expect(404);
    });
  });
});
