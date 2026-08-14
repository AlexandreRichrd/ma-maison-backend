import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

type LoginBody = { accessToken: string };
type HouseholdMeBody = {
  users: { id: string; name: string; passwordHash?: string }[];
  memberOrder: string[];
};

describe('Households (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let accessToken: string;
  let firstId: string;
  let secondId: string;

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
  });
});
