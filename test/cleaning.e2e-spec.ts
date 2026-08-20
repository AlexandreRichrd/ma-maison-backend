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
type SubtaskBody = { id: string; label: string; done: boolean };
type ChoreBody = {
  id: string;
  name: string;
  occurrenceDate: string;
  done: boolean;
  subtasks: SubtaskBody[];
};
type EntryBody = {
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

    // Seeded and logged in once — the login-identifier throttle (5 per 15
    // minutes, see throttler.config.ts) would trip if every test logged in
    // fresh in a per-test beforeEach (see reminders.e2e-spec.ts for the
    // same fix).
    await prisma.$executeRaw`TRUNCATE households, users, chores, chore_completions, chore_subtasks RESTART IDENTITY CASCADE`;

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
    secondUserId = second.id;

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
    await prisma.$executeRaw`TRUNCATE chores, chore_completions, chore_subtasks RESTART IDENTITY CASCADE`;
  });

  function authed() {
    return { Authorization: `Bearer ${accessToken}` };
  }

  describe('GET /cleaning/week', () => {
    it('rejects unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .get('/cleaning/week?week=2026-W32')
        .expect(401);
    });

    it('rejects a malformed week', async () => {
      const res = await request(app.getHttpServer())
        .get('/cleaning/week?week=not-a-week')
        .set(authed())
        .expect(400);
      expect((res.body as ErrorBody).errors).toContainEqual({
        field: 'week',
        code: 'invalid_iso_week',
      });
    });

    it('splits this week’s occurring WEEK-unit chores by assignment, both users always present', async () => {
      await prisma.chore.create({
        data: {
          name: 'Cuisine',
          frequencyUnit: 'WEEK',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: firstUserId,
        },
      });
      await prisma.chore.create({
        data: {
          name: 'Salle de bain',
          frequencyUnit: 'WEEK',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: secondUserId,
        },
      });
      await prisma.chore.create({
        data: {
          name: 'Draps',
          frequencyUnit: 'WEEK',
          frequencyValue: 2,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: firstUserId,
        },
      });
      // A future-anchored chore doesn't occur this week — must not appear.
      await prisma.chore.create({
        data: {
          name: 'Couloir',
          frequencyUnit: 'WEEK',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2029-12-31'),
          anchorUserId: secondUserId,
        },
      });
      // A DAY-unit chore must never appear in the weekly block, even
      // though it occurs on 2024-01-01 (the Monday of 2024-W01).
      await prisma.chore.create({
        data: {
          name: 'Vaisselle',
          frequencyUnit: 'DAY',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: firstUserId,
        },
      });

      const res = await request(app.getHttpServer())
        .get('/cleaning/week?week=2024-W01')
        .set(authed())
        .expect(200);

      const body = res.body as EntryBody[];
      expect(body).toHaveLength(2);
      expect(body.map((entry) => entry.user.id).sort()).toEqual(
        [firstUserId, secondUserId].sort(),
      );
      const allChoreNames = body.flatMap((entry) =>
        entry.chores.map((c) => c.name),
      );
      expect(allChoreNames.sort()).toEqual(
        ['Cuisine', 'Draps', 'Salle de bain'].sort(),
      );
    });

    it('a biweekly chore disappears entirely on its off-week', async () => {
      const sheets = await prisma.chore.create({
        data: {
          name: 'Draps',
          frequencyUnit: 'WEEK',
          frequencyValue: 2,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: firstUserId,
        },
      });

      const onWeek = await request(app.getHttpServer())
        .get('/cleaning/week?week=2024-W01')
        .set(authed())
        .expect(200);
      const offWeek = await request(app.getHttpServer())
        .get('/cleaning/week?week=2024-W02')
        .set(authed())
        .expect(200);

      const idsOn = (onWeek.body as EntryBody[]).flatMap((e) =>
        e.chores.map((c) => c.id),
      );
      const idsOff = (offWeek.body as EntryBody[]).flatMap((e) =>
        e.chores.map((c) => c.id),
      );
      expect(idsOn).toContain(sheets.id);
      expect(idsOff).not.toContain(sheets.id);
    });
  });

  describe('GET /cleaning/day', () => {
    it('rejects unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .get('/cleaning/day?date=2026-08-20')
        .expect(401);
    });

    it('rejects a malformed date', async () => {
      const res = await request(app.getHttpServer())
        .get('/cleaning/day?date=not-a-date')
        .set(authed())
        .expect(400);
      expect((res.body as ErrorBody).errors).toContainEqual({
        field: 'date',
        code: 'invalid_iso_date',
      });
    });

    it('splits the day’s occurring DAY-unit chores by assignment, WEEK-unit chores excluded', async () => {
      await prisma.chore.create({
        data: {
          name: 'Vaisselle',
          frequencyUnit: 'DAY',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: firstUserId,
        },
      });
      await prisma.chore.create({
        data: {
          name: 'Cuisine',
          frequencyUnit: 'WEEK',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: firstUserId,
        },
      });

      const res = await request(app.getHttpServer())
        .get('/cleaning/day?date=2024-01-01')
        .set(authed())
        .expect(200);

      const body = res.body as EntryBody[];
      const allChoreNames = body.flatMap((entry) =>
        entry.chores.map((c) => c.name),
      );
      expect(allChoreNames).toEqual(['Vaisselle']);
    });

    it('both entries are empty (not absent) for a day before every chore’s anchor', async () => {
      await prisma.chore.create({
        data: {
          name: 'Vaisselle',
          frequencyUnit: 'DAY',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-06-01'),
          anchorUserId: firstUserId,
        },
      });

      const res = await request(app.getHttpServer())
        .get('/cleaning/day?date=2024-01-01')
        .set(authed())
        .expect(200);

      const body = res.body as EntryBody[];
      expect(body).toHaveLength(2);
      expect(body.map((e) => e.chores)).toEqual([[], []]);
    });
  });

  describe('PATCH /cleaning/chores/:choreId/toggle', () => {
    it('rejects toggling a chore that is not scheduled that day', async () => {
      const sheets = await prisma.chore.create({
        data: {
          name: 'Draps',
          frequencyUnit: 'WEEK',
          frequencyValue: 2,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: firstUserId,
        },
      });

      const res = await request(app.getHttpServer())
        .patch(`/cleaning/chores/${sheets.id}/toggle`)
        .set(authed())
        .send({ occurrenceDate: '2024-01-02' })
        .expect(409);
      expect((res.body as ErrorBody).errors).toEqual([
        { field: 'form', code: 'chore_not_scheduled' },
      ]);
    });

    it('toggles a completion on and off, assigned to whoever the current rotation assigns', async () => {
      const kitchen = await prisma.chore.create({
        data: {
          name: 'Cuisine',
          frequencyUnit: 'WEEK',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: firstUserId,
        },
      });

      await request(app.getHttpServer())
        .patch(`/cleaning/chores/${kitchen.id}/toggle`)
        .set(authed())
        .send({ occurrenceDate: '2024-01-01' })
        .expect(204);

      const completion = await prisma.choreCompletion.findFirstOrThrow({
        where: { choreId: kitchen.id, occurrenceDate: new Date('2024-01-01') },
      });
      expect([firstUserId, secondUserId]).toContain(completion.userId);

      const afterFirstToggle = await request(app.getHttpServer())
        .get('/cleaning/week?week=2024-W01')
        .set(authed())
        .expect(200);
      const kitchenChore = (afterFirstToggle.body as EntryBody[])
        .flatMap((entry) => entry.chores)
        .find((c) => c.id === kitchen.id);
      expect(kitchenChore?.done).toBe(true);

      await request(app.getHttpServer())
        .patch(`/cleaning/chores/${kitchen.id}/toggle`)
        .set(authed())
        .send({ occurrenceDate: '2024-01-01' })
        .expect(204);

      const afterUntoggle = await prisma.choreCompletion.findFirst({
        where: { choreId: kitchen.id, occurrenceDate: new Date('2024-01-01') },
      });
      expect(afterUntoggle).toBeNull();
    });

    it('toggling a chore with subtasks completes every subtask', async () => {
      const kitchen = await prisma.chore.create({
        data: {
          name: 'Cuisine',
          frequencyUnit: 'DAY',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: firstUserId,
        },
      });
      const sweep = await prisma.choreSubtask.create({
        data: { choreId: kitchen.id, label: 'Balayer', position: 0 },
      });
      const wipe = await prisma.choreSubtask.create({
        data: { choreId: kitchen.id, label: 'Essuyer', position: 1 },
      });

      await request(app.getHttpServer())
        .patch(`/cleaning/chores/${kitchen.id}/toggle`)
        .set(authed())
        .send({ occurrenceDate: '2024-01-01' })
        .expect(204);

      const res = await request(app.getHttpServer())
        .get('/cleaning/day?date=2024-01-01')
        .set(authed())
        .expect(200);
      const chore = (res.body as EntryBody[])
        .flatMap((e) => e.chores)
        .find((c) => c.id === kitchen.id);
      expect(chore?.done).toBe(true);
      expect(chore?.subtasks.map((s) => ({ id: s.id, done: s.done }))).toEqual([
        { id: sweep.id, done: true },
        { id: wipe.id, done: true },
      ]);
    });

    it('404s toggling an unknown chore', async () => {
      const res = await request(app.getHttpServer())
        .patch('/cleaning/chores/00000000-0000-0000-0000-000000000000/toggle')
        .set(authed())
        .send({ occurrenceDate: '2024-01-01' })
        .expect(404);
      expect((res.body as ErrorBody).errors).toEqual([
        { field: 'choreId', code: 'not_found' },
      ]);
    });
  });

  describe('PATCH /cleaning/chores/:choreId/subtasks/:subtaskId/toggle', () => {
    it('toggles one subtask independent of the others, updating the parent’s derived done state', async () => {
      const kitchen = await prisma.chore.create({
        data: {
          name: 'Cuisine',
          frequencyUnit: 'DAY',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: firstUserId,
        },
      });
      const sweep = await prisma.choreSubtask.create({
        data: { choreId: kitchen.id, label: 'Balayer', position: 0 },
      });
      const wipe = await prisma.choreSubtask.create({
        data: { choreId: kitchen.id, label: 'Essuyer', position: 1 },
      });

      await request(app.getHttpServer())
        .patch(`/cleaning/chores/${kitchen.id}/subtasks/${sweep.id}/toggle`)
        .set(authed())
        .send({ occurrenceDate: '2024-01-01' })
        .expect(204);

      const partial = await request(app.getHttpServer())
        .get('/cleaning/day?date=2024-01-01')
        .set(authed())
        .expect(200);
      const partialChore = (partial.body as EntryBody[])
        .flatMap((e) => e.chores)
        .find((c) => c.id === kitchen.id);
      expect(partialChore?.done).toBe(false);
      expect(partialChore?.subtasks.find((s) => s.id === sweep.id)?.done).toBe(
        true,
      );

      await request(app.getHttpServer())
        .patch(`/cleaning/chores/${kitchen.id}/subtasks/${wipe.id}/toggle`)
        .set(authed())
        .send({ occurrenceDate: '2024-01-01' })
        .expect(204);

      const full = await request(app.getHttpServer())
        .get('/cleaning/day?date=2024-01-01')
        .set(authed())
        .expect(200);
      const fullChore = (full.body as EntryBody[])
        .flatMap((e) => e.chores)
        .find((c) => c.id === kitchen.id);
      expect(fullChore?.done).toBe(true);

      // Unticking any one subtask unticks the parent.
      await request(app.getHttpServer())
        .patch(`/cleaning/chores/${kitchen.id}/subtasks/${sweep.id}/toggle`)
        .set(authed())
        .send({ occurrenceDate: '2024-01-01' })
        .expect(204);

      const afterUntick = await request(app.getHttpServer())
        .get('/cleaning/day?date=2024-01-01')
        .set(authed())
        .expect(200);
      const afterUntickChore = (afterUntick.body as EntryBody[])
        .flatMap((e) => e.chores)
        .find((c) => c.id === kitchen.id);
      expect(afterUntickChore?.done).toBe(false);
    });

    it('404s for a subtask that belongs to a different chore', async () => {
      const kitchen = await prisma.chore.create({
        data: {
          name: 'Cuisine',
          frequencyUnit: 'DAY',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: firstUserId,
        },
      });
      const otherChore = await prisma.chore.create({
        data: {
          name: 'Salle de bain',
          frequencyUnit: 'DAY',
          frequencyValue: 1,
          assignmentMode: 'ROTATING',
          anchorDate: new Date('2024-01-01'),
          anchorUserId: firstUserId,
        },
      });
      const foreignSubtask = await prisma.choreSubtask.create({
        data: { choreId: otherChore.id, label: 'x', position: 0 },
      });

      const res = await request(app.getHttpServer())
        .patch(
          `/cleaning/chores/${kitchen.id}/subtasks/${foreignSubtask.id}/toggle`,
        )
        .set(authed())
        .send({ occurrenceDate: '2024-01-01' })
        .expect(404);
      expect((res.body as ErrorBody).errors).toEqual([
        { field: 'subtaskId', code: 'not_found' },
      ]);
    });
  });
});
