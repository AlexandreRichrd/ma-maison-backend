import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

type LoginBody = { accessToken: string };

// Isolated from auth.e2e-spec.ts on purpose — see auth-throttle.e2e-spec.ts's
// comment: every /auth/login call counts against the shared login-ip
// throttle counter for the app instance it runs against.
describe('Auth token source (e2e)', () => {
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

  it('accepts a token carried only in the access_token cookie', async () => {
    const { user } = await seedHouseholdWithVerifiedUser(
      'cookie-auth@example.com',
      'cookie-pass',
    );
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'cookie-auth@example.com', password: 'cookie-pass' })
      .expect(200);
    const { accessToken } = loginRes.body as LoginBody;

    await request(app.getHttpServer())
      .post('/invites')
      .set('Cookie', [`access_token=${accessToken}`])
      .send({ email: 'via-cookie@example.com' })
      .expect(201, { ok: true });

    const invite = await prisma.invite.findFirstOrThrow({
      where: { email: 'via-cookie@example.com' },
    });
    expect(invite.invitedByUserId).toBe(user.id);
  });

  it('prefers the Authorization header over a mismatched cookie', async () => {
    const { user: headerUser } = await seedHouseholdWithVerifiedUser(
      'header-user@example.com',
      'header-pass',
    );
    const { user: cookieUser } = await seedHouseholdWithVerifiedUser(
      'cookie-user@example.com',
      'cookie-pass',
    );
    const headerLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'header-user@example.com', password: 'header-pass' })
      .expect(200);
    const cookieLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'cookie-user@example.com', password: 'cookie-pass' })
      .expect(200);
    const { accessToken: headerToken } = headerLogin.body as LoginBody;
    const { accessToken: cookieToken } = cookieLogin.body as LoginBody;

    await request(app.getHttpServer())
      .post('/invites')
      .set('Authorization', `Bearer ${headerToken}`)
      .set('Cookie', [`access_token=${cookieToken}`])
      .send({ email: 'precedence-check@example.com' })
      .expect(201);

    const invite = await prisma.invite.findFirstOrThrow({
      where: { email: 'precedence-check@example.com' },
    });
    expect(invite.invitedByUserId).toBe(headerUser.id);
    expect(invite.invitedByUserId).not.toBe(cookieUser.id);
  });
});
