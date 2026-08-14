import { randomUUID } from 'node:crypto';

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
type ReminderBody = {
  id: string;
  title: string;
  doneAt: string | null;
  assigneeIds: string[];
};

describe('Reminders (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let accessToken: string;
  let userId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = moduleFixture.get(PrismaService);

    // Seeded and logged in once — the login-identifier throttle (5 per 15
    // minutes, see throttler.config.ts) would trip if every test logged in
    // fresh in a per-test beforeEach.
    const household = await prisma.household.create({
      data: { memberOrder: [] },
    });
    const passwordHash = await argon2.hash('whatever123', {
      type: argon2.argon2id,
    });
    const user = await prisma.user.create({
      data: {
        householdId: household.id,
        email: 'reminder-user@example.com',
        passwordHash,
        name: 'Reminder User',
        avatarKey: 'ru',
        emailVerifiedAt: new Date(),
      },
    });
    userId = user.id;
    await prisma.household.update({
      where: { id: household.id },
      data: { memberOrder: [user.id] },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'reminder-user@example.com', password: 'whatever123' })
      .expect(200);
    accessToken = (loginRes.body as LoginBody).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE reminders RESTART IDENTITY CASCADE`;
  });

  function authed() {
    return { Authorization: `Bearer ${accessToken}` };
  }

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer()).get('/reminders').expect(401);
  });

  it('completes the create -> list -> toggle -> undo flow', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/reminders')
      .set(authed())
      .send({
        title: 'Take out trash',
        dueAt: new Date().toISOString(),
        assigneeIds: [userId],
      })
      .expect(201);
    const { id } = createRes.body as ReminderBody;
    expect(id).toEqual(expect.any(String));

    const listRes = await request(app.getHttpServer())
      .get('/reminders')
      .set(authed())
      .expect(200);
    expect(listRes.body).toEqual([
      expect.objectContaining({ id, title: 'Take out trash', doneAt: null }),
    ]);

    await request(app.getHttpServer())
      .patch(`/reminders/${id}/toggle`)
      .set(authed())
      .expect(204);

    const afterToggle = await prisma.reminder.findUniqueOrThrow({
      where: { id },
    });
    expect(afterToggle.doneAt).not.toBeNull();

    await request(app.getHttpServer())
      .patch(`/reminders/${id}/toggle`)
      .set(authed())
      .expect(204);

    const afterUndo = await prisma.reminder.findUniqueOrThrow({
      where: { id },
    });
    expect(afterUndo.doneAt).toBeNull();
  });

  it('only returns due-today reminders that are not done', async () => {
    await request(app.getHttpServer())
      .post('/reminders')
      .set(authed())
      .send({
        title: 'Due today',
        dueAt: new Date().toISOString(),
        assigneeIds: [],
      })
      .expect(201);
    const futureRes = await request(app.getHttpServer())
      .post('/reminders')
      .set(authed())
      .send({
        title: 'Next week',
        dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        assigneeIds: [],
      })
      .expect(201);
    expect((futureRes.body as ReminderBody).title).toBe('Next week');

    const dueTodayRes = await request(app.getHttpServer())
      .get('/reminders/due-today')
      .set(authed())
      .expect(200);
    expect((dueTodayRes.body as ReminderBody[]).map((r) => r.title)).toEqual([
      'Due today',
    ]);
  });

  it('rejects an assigneeId that is not a real user', async () => {
    const res = await request(app.getHttpServer())
      .post('/reminders')
      .set(authed())
      .send({
        title: 'Bad assignee',
        dueAt: new Date().toISOString(),
        assigneeIds: ['00000000-0000-0000-0000-000000000000'],
      })
      .expect(400);
    expect((res.body as ErrorBody).errors).toEqual([
      { field: 'assigneeIds', code: 'invalid_id' },
    ]);
  });

  it('rejects more than two assignees', async () => {
    const res = await request(app.getHttpServer())
      .post('/reminders')
      .set(authed())
      .send({
        title: 'Too many people',
        dueAt: new Date().toISOString(),
        assigneeIds: [randomUUID(), randomUUID(), randomUUID()],
      })
      .expect(400);
    expect((res.body as ErrorBody).errors).toContainEqual({
      field: 'assigneeIds',
      code: 'invalid_type',
    });
  });

  it('404s toggling an unknown reminder', async () => {
    const res = await request(app.getHttpServer())
      .patch('/reminders/00000000-0000-0000-0000-000000000000/toggle')
      .set(authed())
      .expect(404);
    expect((res.body as ErrorBody).errors).toEqual([
      { field: 'id', code: 'not_found' },
    ]);
  });
});
