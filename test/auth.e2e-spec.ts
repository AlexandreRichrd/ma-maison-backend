import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

type LoginBody = { accessToken: string; user: Record<string, unknown> };
type ErrorBody = {
  statusCode: number;
  errors: { field: string; code: string }[];
};

describe('Auth (e2e)', () => {
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
    await prisma.$executeRaw`TRUNCATE households, users, invites, email_verifications RESTART IDENTITY CASCADE`;
  });

  async function seedHouseholdWithVerifiedUser(
    email: string,
    password: string,
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
        name: 'Inviter',
        role: 'Parent',
        avatarKey: 'inviter',
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.household.update({
      where: { id: household.id },
      data: { memberOrder: [user.id] },
    });
    return { household, user };
  }

  it('completes the full invite -> register -> activate -> login flow', async () => {
    await seedHouseholdWithVerifiedUser('inviter@example.com', 'inviter-pass');

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'inviter@example.com', password: 'inviter-pass' })
      .expect(200);
    const { accessToken } = loginRes.body as LoginBody;
    expect(accessToken).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .post('/invites')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email: 'newperson@example.com' })
      .expect(201, { ok: true });

    const invite = await prisma.invite.findFirstOrThrow({
      where: { email: 'newperson@example.com' },
    });

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        token: invite.token,
        name: 'New Person',
        role: 'Partenaire',
        password: 'new-person-pass',
        confirmPassword: 'new-person-pass',
      })
      .expect(201, { ok: true, email: 'newperson@example.com' });

    const newUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'newperson@example.com' },
    });
    expect(newUser.emailVerifiedAt).toBeNull();

    // Login is refused until activation, with a distinct code — checked
    // after password verification (the password is correct here).
    const preActivationLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'newperson@example.com', password: 'new-person-pass' })
      .expect(401);
    expect((preActivationLogin.body as ErrorBody).errors).toEqual([
      { field: 'form', code: 'email_not_verified' },
    ]);

    const verification = await prisma.emailVerification.findFirstOrThrow({
      where: { userId: newUser.id },
    });

    await request(app.getHttpServer())
      .post('/auth/activate')
      .send({ token: verification.token })
      .expect(200, { ok: true });

    const postActivationLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'newperson@example.com', password: 'new-person-pass' })
      .expect(200);
    const { user: loggedInUser } = postActivationLogin.body as LoginBody;
    expect(loggedInUser.id).toBe(newUser.id);
    expect(loggedInUser).not.toHaveProperty('passwordHash');
  });

  describe('validation', () => {
    it('rejects an invalid email on login', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'not-an-email', password: 'x' })
        .expect(400);
      expect((res.body as ErrorBody).errors).toContainEqual({
        field: 'email',
        code: 'invalid_email',
      });
    });

    it('rejects missing fields on register', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ token: 'x' })
        .expect(400);
      expect((res.body as ErrorBody).errors.length).toBeGreaterThan(0);
    });

    it('rejects a missing token on activate', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/activate')
        .send({})
        .expect(400);
      expect((res.body as ErrorBody).errors).toContainEqual({
        field: 'token',
        code: 'required',
      });
    });

    it('rejects an unauthenticated invite request before validating its body', async () => {
      const res = await request(app.getHttpServer())
        .post('/invites')
        .send({ email: 'nope' })
        .expect(401);
      expect((res.body as ErrorBody).errors).toEqual([
        { field: 'authorization', code: 'unauthenticated' },
      ]);
    });
  });
});
