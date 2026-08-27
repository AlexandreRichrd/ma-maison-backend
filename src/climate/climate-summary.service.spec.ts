import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ClimateSummaryService } from './climate-summary.service';

describe('ClimateSummaryService', () => {
  let prisma: PrismaService;
  let service: ClimateSummaryService;

  beforeAll(() => {
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE measures RESTART IDENTITY CASCADE`;
    await prisma.$executeRaw`TRUNCATE daily_summaries RESTART IDENTITY CASCADE`;
    service = new ClimateSummaryService(prisma, new SettingsService(prisma));
  });

  async function seedMeasures(
    rows: {
      deviceName: string;
      type: string;
      value: string;
      recordedAt: string;
    }[],
  ) {
    await prisma.measure.createMany({
      data: rows.map((r) => ({ ...r, recordedAt: new Date(r.recordedAt) })),
    });
  }

  describe('summarizeDay', () => {
    it('computes min/max/avg/count per device+type for a Paris calendar day', async () => {
      // 2026-08-15 in Paris (CEST, UTC+2) spans 2026-08-14T22:00Z..2026-08-15T22:00Z.
      await seedMeasures([
        {
          deviceName: 'capteur-salon',
          type: 'temperature',
          value: '20.0',
          recordedAt: '2026-08-14T23:00:00.000Z',
        },
        {
          deviceName: 'capteur-salon',
          type: 'temperature',
          value: '22.0',
          recordedAt: '2026-08-15T10:00:00.000Z',
        },
        {
          deviceName: 'capteur-salon',
          type: 'temperature',
          value: '24.0',
          recordedAt: '2026-08-15T21:59:00.000Z',
        },
      ]);

      const { written } = await service.summarizeDay('2026-08-15');
      expect(written).toBe(1);

      const rows = await prisma.dailySummary.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        deviceName: 'capteur-salon',
        type: 'temperature',
        sampleCount: 3,
      });
      expect(rows[0].min.toString()).toBe('20');
      expect(rows[0].max.toString()).toBe('24');
      expect(rows[0].avg.toString()).toBe('22');
      expect(rows[0].date.toISOString()).toBe('2026-08-15T00:00:00.000Z');
    });

    it('excludes readings just outside the Paris day boundary, and non-climate types', async () => {
      await seedMeasures([
        // One second before the Paris-day start (2026-08-14T22:00:00Z).
        {
          deviceName: 'capteur-salon',
          type: 'temperature',
          value: '99',
          recordedAt: '2026-08-14T21:59:59.000Z',
        },
        // Exactly at the Paris-day end (2026-08-15T22:00:00Z) — exclusive.
        {
          deviceName: 'capteur-salon',
          type: 'temperature',
          value: '99',
          recordedAt: '2026-08-15T22:00:00.000Z',
        },
        {
          deviceName: 'capteur-salon',
          type: 'temperature',
          value: '21.0',
          recordedAt: '2026-08-15T10:00:00.000Z',
        },
        {
          deviceName: 'capteur-salon',
          type: 'rssi',
          value: '-52',
          recordedAt: '2026-08-15T10:00:00.000Z',
        },
      ]);

      await service.summarizeDay('2026-08-15');

      const rows = await prisma.dailySummary.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0].sampleCount).toBe(1);
      expect(rows[0].min.toString()).toBe('21');
    });

    it('writes no row for a device+type with zero readings that day (sensor offline)', async () => {
      const { written } = await service.summarizeDay('2026-08-15');
      expect(written).toBe(0);
      expect(await prisma.dailySummary.findMany()).toHaveLength(0);
    });

    it('is idempotent: re-running for the same day upserts instead of duplicating', async () => {
      await seedMeasures([
        {
          deviceName: 'capteur-salon',
          type: 'temperature',
          value: '20.0',
          recordedAt: '2026-08-15T10:00:00.000Z',
        },
      ]);
      await service.summarizeDay('2026-08-15');

      await seedMeasures([
        {
          deviceName: 'capteur-salon',
          type: 'temperature',
          value: '30.0',
          recordedAt: '2026-08-15T11:00:00.000Z',
        },
      ]);
      await service.summarizeDay('2026-08-15');

      const rows = await prisma.dailySummary.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0].sampleCount).toBe(2);
      expect(rows[0].max.toString()).toBe('30');
    });
  });

  describe('purgeOlderThan', () => {
    it('deletes only measures recorded before the retention cutoff', async () => {
      await seedMeasures([
        {
          deviceName: 'capteur-salon',
          type: 'temperature',
          value: '10',
          recordedAt: '2026-08-01T00:00:00.000Z',
        },
        {
          deviceName: 'capteur-salon',
          type: 'temperature',
          value: '20',
          recordedAt: '2026-08-20T00:00:00.000Z',
        },
      ]);

      const { deleted } = await service.purgeOlderThan(
        7,
        new Date('2026-08-22T12:00:00.000Z'),
      );
      expect(deleted).toBe(1);

      const remaining = await prisma.measure.findMany();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].value).toBe('20');
    });
  });

  describe('getSummaries', () => {
    it('returns rows for the device within the date range, ordered by date then type', async () => {
      await seedMeasures([
        {
          deviceName: 'capteur-salon',
          type: 'temperature',
          value: '20.0',
          recordedAt: '2026-08-14T10:00:00.000Z',
        },
        {
          deviceName: 'capteur-salon',
          type: 'humidite',
          value: '50.0',
          recordedAt: '2026-08-15T10:00:00.000Z',
        },
        {
          deviceName: 'capteur-salon',
          type: 'temperature',
          value: '21.0',
          recordedAt: '2026-08-15T10:00:00.000Z',
        },
        {
          deviceName: 'capteur-exterieur',
          type: 'temperature',
          value: '5.0',
          recordedAt: '2026-08-15T10:00:00.000Z',
        },
      ]);
      await service.summarizeDay('2026-08-14');
      await service.summarizeDay('2026-08-15');

      const rows = await service.getSummaries(
        'capteur-salon',
        '2026-08-14',
        '2026-08-15',
      );

      expect(
        rows.map((r) => [r.date.toISOString().slice(0, 10), r.type]),
      ).toEqual([
        ['2026-08-14', 'temperature'],
        ['2026-08-15', 'humidite'],
        ['2026-08-15', 'temperature'],
      ]);
    });
  });
});
