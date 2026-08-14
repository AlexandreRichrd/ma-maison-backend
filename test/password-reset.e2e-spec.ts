import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

type LoginBody = { accessToken: string };
type ErrorBody = {
  statusCode: number;
  errors: { field: string; code: string }[];
};

// Isolated from auth.e2e-spec.ts — see auth-throttle.e2e-spec.ts's comment:
// every request to a throttled route counts against the shared counter for
// the app instance it runs against. This file stays well under any of the
// 5-per-window limits, so a shared beforeAll app is fine here.
describe('Password reset (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

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
    await prisma.$executeRaw`TRUNCATE households, users, invites, email_verifications, password_resets RESTART IDENTITY CASCADE`;
  });

  async function seedHouseholdWithUser(
    email: string,
    password: string,
    opts?: { verified?: boolean },
  ) {
    const household = await prisma.household.create({
      data: { memberOrder: [] },
    });
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: {
        householdId: household.id,
        email,
        passwordHash,
        name: 'Mia',
        avatarKey: 'mia',
        emailVerifiedAt: opts?.verified === false ? null : new Date(),
      },
    });
    await prisma.household.update({
      where: { id: household.id },
      data: { memberOrder: [user.id] },
    });
    return { household, user };
  }

  it('completes the full forgot -> reset -> login flow, invalidating the old password', async () => {
    const { user } = await seedHouseholdWithUser(
      'reset-flow@example.com',
      'old-password',
    );

    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'reset-flow@example.com' })
      .expect(200, { ok: true });

    const reset = await prisma.passwordReset.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(reset.consumedAt).toBeNull();

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({
        token: reset.token,
        password: 'brand-new-password',
        confirmPassword: 'brand-new-password',
      })
      .expect(200, { ok: true });

    const consumedReset = await prisma.passwordReset.findUniqueOrThrow({
      where: { id: reset.id },
    });
    expect(consumedReset.consumedAt).not.toBeNull();

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'reset-flow@example.com', password: 'old-password' })
      .expect(401);

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'reset-flow@example.com', password: 'brand-new-password' })
      .expect(200);
    expect((loginRes.body as LoginBody).accessToken).toEqual(
      expect.any(String),
    );
  });

  it('returns the exact same response for an email with no account, and creates no token', async () => {
    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'nobody@example.com' })
      .expect(200, { ok: true });

    expect(await prisma.passwordReset.count()).toBe(0);
  });

  it('verifies a previously-unverified account on successful reset, and lets it log in', async () => {
    const { user } = await seedHouseholdWithUser(
      'unverified-reset@example.com',
      'old-password',
      { verified: false },
    );

    await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: 'unverified-reset@example.com' })
      .expect(200, { ok: true });
    const reset = await prisma.passwordReset.findFirstOrThrow({
      where: { userId: user.id },
    });

    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({
        token: reset.token,
        password: 'brand-new-password',
        confirmPassword: 'brand-new-password',
      })
      .expect(200, { ok: true });

    const updatedUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(updatedUser.emailVerifiedAt).not.toBeNull();

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'unverified-reset@example.com',
        password: 'brand-new-password',
      })
      .expect(200);
  });

  it('rejects a missing, expired, or already-consumed reset token with reset_invalid', async () => {
    const { user } = await seedHouseholdWithUser(
      'reset-invalid@example.com',
      'old-password',
    );

    const missing = await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({
        token: 'does-not-exist',
        password: 'brand-new-password',
        confirmPassword: 'brand-new-password',
      })
      .expect(400);
    expect((missing.body as ErrorBody).errors).toEqual([
      { field: 'token', code: 'reset_invalid' },
    ]);

    const expiredToken = 'expired-token';
    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        token: expiredToken,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({
        token: expiredToken,
        password: 'brand-new-password',
        confirmPassword: 'brand-new-password',
      })
      .expect(400);

    const consumedToken = 'consumed-token';
    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        token: consumedToken,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        consumedAt: new Date(),
      },
    });
    await request(app.getHttpServer())
      .post('/auth/reset-password')
      .send({
        token: consumedToken,
        password: 'brand-new-password',
        confirmPassword: 'brand-new-password',
      })
      .expect(400);
  });

  describe('validation', () => {
    it('rejects an invalid email on forgot-password', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: 'not-an-email' })
        .expect(400);
      expect((res.body as ErrorBody).errors).toContainEqual({
        field: 'email',
        code: 'invalid_email',
      });
    });

    it('rejects missing fields on reset-password', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({})
        .expect(400);
      expect((res.body as ErrorBody).errors.length).toBeGreaterThan(0);
    });

    it('rejects a confirmPassword that does not match', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({
          token: 'whatever',
          password: 'brand-new-password',
          confirmPassword: 'does-not-match',
        })
        .expect(400);
      expect((res.body as ErrorBody).errors).toContainEqual({
        field: 'confirmPassword',
        code: 'password_mismatch',
      });
    });
  });
});
