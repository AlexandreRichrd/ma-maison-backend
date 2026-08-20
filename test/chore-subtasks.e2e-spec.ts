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
type SubtaskBody = { id: string; label: string; position: number };
type ChoreBody = { id: string; name: string; subtasks: SubtaskBody[] };

describe('Chore subtasks admin CRUD (e2e)', () => {
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

    await prisma.$executeRaw`TRUNCATE households, users, chores, chore_subtasks RESTART IDENTITY CASCADE`;

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

  let choreId: string;

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE chores, chore_subtasks RESTART IDENTITY CASCADE`;
    const chore = await prisma.chore.create({
      data: {
        name: 'Cuisine',
        frequencyUnit: 'WEEK',
        frequencyValue: 1,
        assignmentMode: 'ROTATING',
        anchorDate: new Date('2024-01-01'),
        anchorUserId: firstUserId,
      },
    });
    choreId = chore.id;
  });

  function authed() {
    return { Authorization: `Bearer ${accessToken}` };
  }

  describe('POST /cleaning/chores/:choreId/subtasks', () => {
    it('appends a subtask at the next position', async () => {
      const res1 = await request(app.getHttpServer())
        .post(`/cleaning/chores/${choreId}/subtasks`)
        .set(authed())
        .send({ label: 'Vider le lave-vaisselle' })
        .expect(201);
      expect((res1.body as SubtaskBody).position).toBe(0);

      const res2 = await request(app.getHttpServer())
        .post(`/cleaning/chores/${choreId}/subtasks`)
        .set(authed())
        .send({ label: 'Essuyer les surfaces' })
        .expect(201);
      expect((res2.body as SubtaskBody).position).toBe(1);
    });

    it('rejects an empty label', async () => {
      const res = await request(app.getHttpServer())
        .post(`/cleaning/chores/${choreId}/subtasks`)
        .set(authed())
        .send({ label: '' })
        .expect(400);
      expect((res.body as ErrorBody).errors).toContainEqual({
        field: 'label',
        code: 'required',
      });
    });

    it('404s for an unknown chore', async () => {
      await request(app.getHttpServer())
        .post('/cleaning/chores/00000000-0000-0000-0000-000000000000/subtasks')
        .set(authed())
        .send({ label: 'x' })
        .expect(404);
    });
  });

  describe('GET /cleaning/chores', () => {
    it('includes each chore’s subtasks, in position order', async () => {
      await request(app.getHttpServer())
        .post(`/cleaning/chores/${choreId}/subtasks`)
        .set(authed())
        .send({ label: 'First' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/cleaning/chores/${choreId}/subtasks`)
        .set(authed())
        .send({ label: 'Second' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/cleaning/chores')
        .set(authed())
        .expect(200);

      const chore = (res.body as ChoreBody[]).find((c) => c.id === choreId);
      expect(chore?.subtasks.map((s) => s.label)).toEqual(['First', 'Second']);
    });
  });

  describe('PATCH /cleaning/chores/:choreId/subtasks/:subtaskId', () => {
    it('updates the label', async () => {
      const created = await request(app.getHttpServer())
        .post(`/cleaning/chores/${choreId}/subtasks`)
        .set(authed())
        .send({ label: 'Original' })
        .expect(201);
      const subtaskId = (created.body as SubtaskBody).id;

      const res = await request(app.getHttpServer())
        .patch(`/cleaning/chores/${choreId}/subtasks/${subtaskId}`)
        .set(authed())
        .send({ label: 'Renamed' })
        .expect(200);
      expect((res.body as SubtaskBody).label).toBe('Renamed');
    });

    it('404s for an unknown subtask', async () => {
      await request(app.getHttpServer())
        .patch(
          `/cleaning/chores/${choreId}/subtasks/00000000-0000-0000-0000-000000000000`,
        )
        .set(authed())
        .send({ label: 'x' })
        .expect(404);
    });
  });

  describe('DELETE /cleaning/chores/:choreId/subtasks/:subtaskId', () => {
    it('deletes the subtask', async () => {
      const created = await request(app.getHttpServer())
        .post(`/cleaning/chores/${choreId}/subtasks`)
        .set(authed())
        .send({ label: 'Original' })
        .expect(201);
      const subtaskId = (created.body as SubtaskBody).id;

      await request(app.getHttpServer())
        .delete(`/cleaning/chores/${choreId}/subtasks/${subtaskId}`)
        .set(authed())
        .expect(204);

      expect(
        await prisma.choreSubtask.findUnique({ where: { id: subtaskId } }),
      ).toBeNull();
    });
  });

  describe('PATCH /cleaning/chores/:choreId/subtasks/reorder', () => {
    it('reorders subtasks by the given id list', async () => {
      const a = (
        await request(app.getHttpServer())
          .post(`/cleaning/chores/${choreId}/subtasks`)
          .set(authed())
          .send({ label: 'A' })
      ).body as SubtaskBody;
      const b = (
        await request(app.getHttpServer())
          .post(`/cleaning/chores/${choreId}/subtasks`)
          .set(authed())
          .send({ label: 'B' })
      ).body as SubtaskBody;

      const res = await request(app.getHttpServer())
        .patch(`/cleaning/chores/${choreId}/subtasks/reorder`)
        .set(authed())
        .send({ subtaskIds: [b.id, a.id] })
        .expect(200);

      expect((res.body as SubtaskBody[]).map((s) => s.id)).toEqual([
        b.id,
        a.id,
      ]);
    });

    it('rejects a set that omits an existing subtask', async () => {
      const a = (
        await request(app.getHttpServer())
          .post(`/cleaning/chores/${choreId}/subtasks`)
          .set(authed())
          .send({ label: 'A' })
      ).body as SubtaskBody;
      await request(app.getHttpServer())
        .post(`/cleaning/chores/${choreId}/subtasks`)
        .set(authed())
        .send({ label: 'B' });

      const res = await request(app.getHttpServer())
        .patch(`/cleaning/chores/${choreId}/subtasks/reorder`)
        .set(authed())
        .send({ subtaskIds: [a.id] })
        .expect(400);
      expect((res.body as ErrorBody).errors).toEqual([
        { field: 'subtaskIds', code: 'invalid_subtask_set' },
      ]);
    });

    // Regression test for the route collision this endpoint's path shape
    // creates against PATCH :choreId/subtasks/:subtaskId — 'reorder' must
    // be handled by reorderSubtasks(), not parsed as a subtaskId. If the
    // routes were declared in the wrong order, this would 400 with
    // 'invalid_id' (ParseUUIDPipe rejecting "reorder" as a UUID) instead
    // of running the reorder logic.
    it('is not routed as subtaskId="reorder"', async () => {
      const a = (
        await request(app.getHttpServer())
          .post(`/cleaning/chores/${choreId}/subtasks`)
          .set(authed())
          .send({ label: 'A' })
      ).body as SubtaskBody;

      const res = await request(app.getHttpServer())
        .patch(`/cleaning/chores/${choreId}/subtasks/reorder`)
        .set(authed())
        .send({ subtaskIds: [a.id] })
        .expect(200);

      expect((res.body as SubtaskBody[]).map((s) => s.id)).toEqual([a.id]);
    });
  });
});
