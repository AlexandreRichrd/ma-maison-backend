import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

type ErrorBody = {
  statusCode: number;
  errors: { field: string; code: string }[];
};

describe('Climate ingestion (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  // Set by test/setup-env.ts loading .env.test — a real value, not a
  // hardcoded test token, so this exercises the exact env var the Pi
  // bridge and DeviceAuthGuard actually agree on.
  const token = process.env.CLIMATE_INGEST_TOKEN as string;

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
    await prisma.$executeRaw`TRUNCATE measures RESTART IDENTITY CASCADE`;
  });

  it('rejects a request with no Authorization header', async () => {
    const res = await request(app.getHttpServer())
      .post('/climate/measures')
      .send({
        measures: [
          {
            deviceName: 'capteur-salon',
            type: 'temperature',
            value: '21.3',
            recordedAt: '2026-08-15T10:00:00.000Z',
          },
        ],
      })
      .expect(401);
    expect((res.body as ErrorBody).errors).toEqual([
      { field: 'authorization', code: 'unauthenticated' },
    ]);
  });

  it('rejects a request with the wrong token', async () => {
    await request(app.getHttpServer())
      .post('/climate/measures')
      .set('Authorization', 'Bearer wrong-token')
      .send({
        measures: [
          {
            deviceName: 'capteur-salon',
            type: 'temperature',
            value: '21.3',
            recordedAt: '2026-08-15T10:00:00.000Z',
          },
        ],
      })
      .expect(401);
  });

  it('rejects an empty measures array', async () => {
    const res = await request(app.getHttpServer())
      .post('/climate/measures')
      .set('Authorization', `Bearer ${token}`)
      .send({ measures: [] })
      .expect(400);
    expect((res.body as ErrorBody).errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'measures' })]),
    );
  });

  it('rejects a measure missing a required field', async () => {
    const res = await request(app.getHttpServer())
      .post('/climate/measures')
      .set('Authorization', `Bearer ${token}`)
      .send({
        measures: [{ deviceName: 'capteur-salon', type: 'temperature' }],
      })
      .expect(400);
    expect((res.body as ErrorBody).statusCode).toBe(400);
  });

  it('accepts a valid batch, including two metrics from the same device', async () => {
    await request(app.getHttpServer())
      .post('/climate/measures')
      .set('Authorization', `Bearer ${token}`)
      .send({
        measures: [
          {
            deviceName: 'capteur-salon',
            type: 'temperature',
            value: '21.3',
            recordedAt: '2026-08-15T10:00:00.000Z',
          },
          {
            deviceName: 'capteur-salon',
            type: 'humidite',
            value: '47.2',
            recordedAt: '2026-08-15T10:00:00.000Z',
          },
        ],
      })
      .expect(201, { inserted: 2 });

    const rows = await prisma.measure.findMany();
    expect(rows).toHaveLength(2);
  });
});
