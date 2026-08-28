import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

type LoginBody = { accessToken: string };
type HouseholdMeBody = {
  users: {
    id: string;
    name: string;
    passwordHash?: string;
    receiveClimateAlerts: boolean;
  }[];
  memberOrder: string[];
};
type ErrorBody = { errors: { field: string; code: string }[] };

describe('Households (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let accessToken: string;
  let firstId: string;
  let secondId: string;
  let outsiderId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = moduleFixture.get(PrismaService);

    await prisma.$executeRaw`TRUNCATE households, users RESTART IDENTITY CASCADE`;

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
    firstId = first.id;
    secondId = second.id;
    await prisma.household.update({
      where: { id: household.id },
      data: { memberOrder: [second.id, first.id] },
    });

    const otherHousehold = await prisma.household.create({
      data: { memberOrder: [] },
    });
    const outsider = await prisma.user.create({
      data: {
        householdId: otherHousehold.id,
        email: 'outsider@example.com',
        passwordHash,
        name: 'Outsider',
        avatarKey: 'outsider',
        emailVerifiedAt: new Date(),
      },
    });
    outsiderId = outsider.id;

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'mia@example.com', password: 'whatever123' })
      .expect(200);
    accessToken = (loginRes.body as LoginBody).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer()).get('/households/me').expect(401);
  });

  it('returns household members with member_order, never a passwordHash', async () => {
    const res = await request(app.getHttpServer())
      .get('/households/me')
      .set({ Authorization: `Bearer ${accessToken}` })
      .expect(200);

    const body = res.body as HouseholdMeBody;
    expect(body.memberOrder).toEqual([secondId, firstId]);
    expect(body.users.map((u) => u.id).sort()).toEqual(
      [firstId, secondId].sort(),
    );
    expect(body.users.every((u) => u.passwordHash === undefined)).toBe(true);
    expect(body.users.every((u) => u.receiveClimateAlerts === true)).toBe(true);
  });

  describe('PATCH /households/me/members/:userId/notification-preferences', () => {
    it('rejects unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .patch(`/households/me/members/${secondId}/notification-preferences`)
        .send({ receiveClimateAlerts: false })
        .expect(401);
    });

    it("updates another household member's flag", async () => {
      await request(app.getHttpServer())
        .patch(`/households/me/members/${secondId}/notification-preferences`)
        .set({ Authorization: `Bearer ${accessToken}` })
        .send({ receiveClimateAlerts: false })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/households/me')
        .set({ Authorization: `Bearer ${accessToken}` })
        .expect(200);
      const body = res.body as HouseholdMeBody;
      expect(
        body.users.find((u) => u.id === secondId)?.receiveClimateAlerts,
      ).toBe(false);

      // Restore, so this test doesn't affect the others.
      await request(app.getHttpServer())
        .patch(`/households/me/members/${secondId}/notification-preferences`)
        .set({ Authorization: `Bearer ${accessToken}` })
        .send({ receiveClimateAlerts: true })
        .expect(200);
    });

    it('rejects a userId outside the caller household', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/households/me/members/${outsiderId}/notification-preferences`)
        .set({ Authorization: `Bearer ${accessToken}` })
        .send({ receiveClimateAlerts: false })
        .expect(400);
      expect((res.body as ErrorBody).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'userId', code: 'invalid_id' }),
        ]),
      );
    });

    it('rejects a non-boolean receiveClimateAlerts', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/households/me/members/${secondId}/notification-preferences`)
        .set({ Authorization: `Bearer ${accessToken}` })
        .send({ receiveClimateAlerts: 'nope' })
        .expect(400);
      expect((res.body as ErrorBody).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'receiveClimateAlerts' }),
        ]),
      );
    });
  });

  describe('PATCH /households/me/member-order', () => {
    it('rejects unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .patch('/households/me/member-order')
        .send({ memberOrder: [firstId, secondId] })
        .expect(401);
    });

    it('persists a valid reordering', async () => {
      await request(app.getHttpServer())
        .patch('/households/me/member-order')
        .set({ Authorization: `Bearer ${accessToken}` })
        .send({ memberOrder: [firstId, secondId] })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/households/me')
        .set({ Authorization: `Bearer ${accessToken}` })
        .expect(200);
      expect((res.body as HouseholdMeBody).memberOrder).toEqual([
        firstId,
        secondId,
      ]);

      // Restore, so this test doesn't affect the others.
      await request(app.getHttpServer())
        .patch('/households/me/member-order')
        .set({ Authorization: `Bearer ${accessToken}` })
        .send({ memberOrder: [secondId, firstId] })
        .expect(200);
    });

    it('rejects a reordering missing a current member', async () => {
      const res = await request(app.getHttpServer())
        .patch('/households/me/member-order')
        .set({ Authorization: `Bearer ${accessToken}` })
        .send({ memberOrder: [firstId] })
        .expect(400);
      expect((res.body as ErrorBody).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'memberOrder',
            code: 'invalid_member_order',
          }),
        ]),
      );
    });

    it('rejects a reordering with an id from another household', async () => {
      const res = await request(app.getHttpServer())
        .patch('/households/me/member-order')
        .set({ Authorization: `Bearer ${accessToken}` })
        .send({ memberOrder: [firstId, outsiderId] })
        .expect(400);
      expect((res.body as ErrorBody).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'memberOrder',
            code: 'invalid_member_order',
          }),
        ]),
      );
    });

    it('rejects a non-UUID entry', async () => {
      const res = await request(app.getHttpServer())
        .patch('/households/me/member-order')
        .set({ Authorization: `Bearer ${accessToken}` })
        .send({ memberOrder: ['not-a-uuid'] })
        .expect(400);
      expect((res.body as ErrorBody).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'memberOrder' }),
        ]),
      );
    });
  });
});
