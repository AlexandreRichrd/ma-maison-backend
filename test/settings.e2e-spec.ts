import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

type ErrorBody = { errors: { field: string; code: string }[] };
type LoginBody = { accessToken: string };
type SettingsBody = {
  climateAlertEnabled: boolean;
  climateAlertMarginC: number;
  climateAlertIndoorThresholdC: number;
  climateAlertCooldownMinutes: number;
  climateSummaryRetentionDays: number;
  indoorSensorLabel: string | null;
  outdoorSensorLabel: string | null;
};

describe('Settings (e2e)', () => {
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
    const household = await prisma.household.create({
      data: { memberOrder: [] },
    });
    const passwordHash = await argon2.hash('whatever123', {
      type: argon2.argon2id,
    });
    const user = await prisma.user.create({
      data: {
        householdId: household.id,
        email: 'settings-user@example.com',
        passwordHash,
        name: 'Settings User',
        avatarKey: 'su',
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.household.update({
      where: { id: household.id },
      data: { memberOrder: [user.id] },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'settings-user@example.com', password: 'whatever123' })
      .expect(200);
    accessToken = (loginRes.body as LoginBody).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE household_settings RESTART IDENTITY CASCADE`;
  });

  function authed() {
    return { Authorization: `Bearer ${accessToken}` };
  }

  describe('GET /settings', () => {
    it('rejects unauthenticated requests', async () => {
      await request(app.getHttpServer()).get('/settings').expect(401);
    });

    it('returns hardcoded defaults before any settings are saved', async () => {
      const res = await request(app.getHttpServer())
        .get('/settings')
        .set(authed())
        .expect(200);

      expect(res.body as SettingsBody).toEqual({
        climateAlertEnabled: true,
        climateAlertMarginC: 0.5,
        climateAlertIndoorThresholdC: 24,
        climateAlertCooldownMinutes: 120,
        climateSummaryRetentionDays: 7,
        indoorSensorLabel: null,
        outdoorSensorLabel: null,
      });
    });
  });

  describe('PATCH /settings', () => {
    it('rejects unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .patch('/settings')
        .send({ climateSummaryRetentionDays: 3 })
        .expect(401);
    });

    it('persists a partial update, leaving other fields at their defaults', async () => {
      await request(app.getHttpServer())
        .patch('/settings')
        .set(authed())
        .send({ climateAlertEnabled: false, climateAlertMarginC: 1.5 })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/settings')
        .set(authed())
        .expect(200);
      expect(res.body as SettingsBody).toEqual({
        climateAlertEnabled: false,
        climateAlertMarginC: 1.5,
        climateAlertIndoorThresholdC: 24,
        climateAlertCooldownMinutes: 120,
        climateSummaryRetentionDays: 7,
        indoorSensorLabel: null,
        outdoorSensorLabel: null,
      });
    });

    it('sets and clears a sensor label', async () => {
      await request(app.getHttpServer())
        .patch('/settings')
        .set(authed())
        .send({ indoorSensorLabel: 'Salon' })
        .expect(200);

      let res = await request(app.getHttpServer())
        .get('/settings')
        .set(authed())
        .expect(200);
      expect((res.body as SettingsBody).indoorSensorLabel).toBe('Salon');

      await request(app.getHttpServer())
        .patch('/settings')
        .set(authed())
        .send({ indoorSensorLabel: '' })
        .expect(200);

      res = await request(app.getHttpServer())
        .get('/settings')
        .set(authed())
        .expect(200);
      expect((res.body as SettingsBody).indoorSensorLabel).toBeNull();
    });

    it('rejects a non-positive numeric field', async () => {
      const res = await request(app.getHttpServer())
        .patch('/settings')
        .set(authed())
        .send({ climateSummaryRetentionDays: 0 })
        .expect(400);
      expect((res.body as ErrorBody).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'climateSummaryRetentionDays' }),
        ]),
      );
    });

    it('rejects a non-boolean climateAlertEnabled', async () => {
      const res = await request(app.getHttpServer())
        .patch('/settings')
        .set(authed())
        .send({ climateAlertEnabled: 'yes' })
        .expect(400);
      expect((res.body as ErrorBody).errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'climateAlertEnabled' }),
        ]),
      );
    });
  });
});
