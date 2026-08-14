import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

type LoginBody = { accessToken: string };

// A fresh app per test (not beforeAll) on purpose: the throttler's
// in-memory storage lives for the lifetime of one Nest app instance, and
// every request to /auth/login or /invites — pass or fail — counts
// against the IP-scoped counter. Sharing one app instance across these two
// tests would make the second test's counts depend on the first.
describe('Auth throttling (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = moduleFixture.get(PrismaService);
    await prisma.$executeRaw`TRUNCATE households, users, invites, email_verifications RESTART IDENTITY CASCADE`;
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows 5 failed login attempts for one identifier, then blocks the 6th', async () => {
    const email = 'throttle-login@example.com';
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'wrong' })
        .expect(401);
    }
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'wrong' })
      .expect(429);
  });

  it('allows 5 invite requests for one authenticated user, then blocks the 6th', async () => {
    const household = await prisma.household.create({
      data: { memberOrder: [] },
    });
    const passwordHash = await argon2.hash('inviter-pass', {
      type: argon2.argon2id,
    });
    const inviter = await prisma.user.create({
      data: {
        householdId: household.id,
        email: 'invite-throttle@example.com',
        passwordHash,
        name: 'Inviter',
        avatarKey: 'inviter',
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.household.update({
      where: { id: household.id },
      data: { memberOrder: [inviter.id] },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'invite-throttle@example.com', password: 'inviter-pass' })
      .expect(200);
    const { accessToken } = loginRes.body as LoginBody;

    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/invites')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ email: `invitee-${i}@example.com` })
        .expect(201);
    }
    await request(app.getHttpServer())
      .post('/invites')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email: 'invitee-6@example.com' })
      .expect(429);
  });
});
