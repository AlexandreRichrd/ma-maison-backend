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

describe('Climate summaries (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let accessToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = moduleFixture.get(PrismaService);

    // Seeded and logged in once — same reasoning as reminders.e2e-spec.ts:
    // the login-identifier throttle would trip if every test logged in
    // fresh in a per-test beforeEach.
    const household = await prisma.household.create({ data: { memberOrder: [] } });
    const passwordHash = await argon2.hash('whatever123', { type: argon2.argon2id });
    const user = await prisma.user.create({
      data: {
        householdId: household.id,
        email: 'climate-summary-user@example.com',
        passwordHash,
        name: 'Climate Summary User',
        avatarKey: 'cs',
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.household.update({
      where: { id: household.id },
      data: { memberOrder: [user.id] },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'climate-summary-user@example.com', password: 'whatever123' })
      .expect(200);
    accessToken = (loginRes.body as LoginBody).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE daily_summaries RESTART IDENTITY CASCADE`;
  });

  function authed() {
    return { Authorization: `Bearer ${accessToken}` };
  }

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer())
      .get('/climate/summaries')
      .query({ deviceName: 'capteur-salon', from: '2026-08-01', to: '2026-08-15' })
      .expect(401);
  });

  it('rejects a missing deviceName', async () => {
    const res = await request(app.getHttpServer())
      .get('/climate/summaries')
      .set(authed())
      .query({ from: '2026-08-01', to: '2026-08-15' })
      .expect(400);
    expect((res.body as ErrorBody).errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'deviceName' })]),
    );
  });

  it('rejects a malformed date', async () => {
    const res = await request(app.getHttpServer())
      .get('/climate/summaries')
      .set(authed())
      .query({ deviceName: 'capteur-salon', from: 'not-a-date', to: '2026-08-15' })
      .expect(400);
    expect((res.body as ErrorBody).errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'from', code: 'invalid_iso_date' })]),
    );
  });

  it('returns only the requested device, within range, ordered by date then type', async () => {
    await prisma.dailySummary.createMany({
      data: [
        {
          deviceName: 'capteur-salon',
          type: 'temperature',
          date: new Date('2026-08-14'),
          min: '19.5',
          max: '22.1',
          avg: '20.8',
          sampleCount: 1440,
        },
        {
          deviceName: 'capteur-salon',
          type: 'humidite',
          date: new Date('2026-08-14'),
          min: '40',
          max: '55',
          avg: '47.5',
          sampleCount: 1440,
        },
        // Out of range — must not be returned.
        {
          deviceName: 'capteur-salon',
          type: 'temperature',
          date: new Date('2026-08-01'),
          min: '15',
          max: '18',
          avg: '16.5',
          sampleCount: 1440,
        },
        // Different device — must not be returned.
        {
          deviceName: 'capteur-exterieur',
          type: 'temperature',
          date: new Date('2026-08-14'),
          min: '5',
          max: '12',
          avg: '8.5',
          sampleCount: 700,
        },
      ],
    });

    const res = await request(app.getHttpServer())
      .get('/climate/summaries')
      .set(authed())
      .query({ deviceName: 'capteur-salon', from: '2026-08-10', to: '2026-08-20' })
      .expect(200);

    expect(res.body).toEqual([
      expect.objectContaining({ type: 'humidite', min: '40', max: '55', avg: '47.5', sampleCount: 1440 }),
      expect.objectContaining({ type: 'temperature', min: '19.5', max: '22.1', avg: '20.8', sampleCount: 1440 }),
    ]);
  });
});
