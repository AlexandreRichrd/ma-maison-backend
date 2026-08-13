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
type ChoreBody = { id: string; name: string; frequency: string; done: boolean };
type WeekEntryBody = {
  user: { id: string; name: string };
  chores: ChoreBody[];
};

describe('Cleaning (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let accessToken: string;
  let firstUserId: string;
  let secondUserId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = moduleFixture.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
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
        role: 'Parent',
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
        role: 'Parent',
        avatarKey: 'sam',
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.household.update({
      where: { id: household.id },
      data: { memberOrder: [first.id, second.id] },
    });
    firstUserId = first.id;
    secondUserId = second.id;

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'mia@example.com', password: 'whatever123' })
      .expect(200);
    accessToken = (loginRes.body as LoginBody).accessToken;
  });

  function authed() {
    return { Authorization: `Bearer ${accessToken}` };
  }

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer())
      .get('/cleaning?week=2026-W32')
      .expect(401);
  });

  it('rejects a malformed week', async () => {
    const res = await request(app.getHttpServer())
      .get('/cleaning?week=not-a-week')
      .set(authed())
      .expect(400);
    expect((res.body as ErrorBody).errors).toContainEqual({
      field: 'week',
      code: 'invalid_iso_week',
    });
  });

  it('splits this week’s chores by rotation group, both users always present', async () => {
    await prisma.chore.create({
      data: { name: 'Cuisine', rotationGroup: 'A' },
    });
    await prisma.chore.create({
      data: { name: 'Salle de bain', rotationGroup: 'B' },
    });
    await prisma.chore.create({ data: { name: 'Draps', rotationGroup: 'C' } });
    await prisma.chore.create({
      data: { name: 'Couloir', rotationGroup: 'D' },
    });

    const res = await request(app.getHttpServer())
      .get('/cleaning?week=2024-W01')
      .set(authed())
      .expect(200);

    const body = res.body as WeekEntryBody[];
    expect(body).toHaveLength(2);
    expect(body.map((entry) => entry.user.id).sort()).toEqual(
      [firstUserId, secondUserId].sort(),
    );
    // Every chore is assigned to exactly one of the two users each week.
    const allChoreNames = body.flatMap((entry) =>
      entry.chores.map((c) => c.name),
    );
    expect(allChoreNames.sort()).toEqual(
      ['Couloir', 'Cuisine', 'Draps', 'Salle de bain'].sort(),
    );
  });

  it('toggles a completion on and off, assigned to whichever user holds that rotation group', async () => {
    const kitchen = await prisma.chore.create({
      data: { name: 'Cuisine', rotationGroup: 'A' },
    });

    await request(app.getHttpServer())
      .patch(`/cleaning/chores/${kitchen.id}/toggle`)
      .set(authed())
      .send({ isoWeek: '2024-W01' })
      .expect(204);

    const completion = await prisma.choreCompletion.findUniqueOrThrow({
      where: { choreId_isoWeek: { choreId: kitchen.id, isoWeek: '2024-W01' } },
    });
    expect([firstUserId, secondUserId]).toContain(completion.userId);

    const afterFirstToggle = await request(app.getHttpServer())
      .get('/cleaning?week=2024-W01')
      .set(authed())
      .expect(200);
    const kitchenChore = (afterFirstToggle.body as WeekEntryBody[])
      .flatMap((entry) => entry.chores)
      .find((c) => c.id === kitchen.id);
    expect(kitchenChore?.done).toBe(true);

    await request(app.getHttpServer())
      .patch(`/cleaning/chores/${kitchen.id}/toggle`)
      .set(authed())
      .send({ isoWeek: '2024-W01' })
      .expect(204);

    const afterUntoggle = await prisma.choreCompletion.findUnique({
      where: { choreId_isoWeek: { choreId: kitchen.id, isoWeek: '2024-W01' } },
    });
    expect(afterUntoggle).toBeNull();
  });

  it('404s toggling an unknown chore', async () => {
    const res = await request(app.getHttpServer())
      .patch('/cleaning/chores/00000000-0000-0000-0000-000000000000/toggle')
      .set(authed())
      .send({ isoWeek: '2024-W01' })
      .expect(404);
    expect((res.body as ErrorBody).errors).toEqual([
      { field: 'choreId', code: 'not_found' },
    ]);
  });
});
