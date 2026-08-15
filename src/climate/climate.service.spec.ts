import { PrismaService } from '../prisma/prisma.service';
import { ClimateService } from './climate.service';

describe('ClimateService', () => {
  let prisma: PrismaService;
  let climate: ClimateService;

  beforeAll(() => {
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE measures RESTART IDENTITY CASCADE`;
    climate = new ClimateService(prisma);
  });

  describe('ingest', () => {
    it('inserts one row per measure, including two metrics from the same device', async () => {
      const result = await climate.ingest([
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
      ]);

      expect(result).toEqual({ inserted: 2 });
      const rows = await prisma.measure.findMany({
        orderBy: { type: 'asc' },
      });
      expect(rows.map((r) => [r.deviceName, r.type, r.value])).toEqual([
        ['capteur-salon', 'humidite', '47.2'],
        ['capteur-salon', 'temperature', '21.3'],
      ]);
    });

    it('accepts a type outside any fixed set, since type is not a DB enum', async () => {
      const result = await climate.ingest([
        {
          deviceName: 'capteur-bureau',
          type: 'co2',
          value: '612',
          recordedAt: '2026-08-15T10:00:00.000Z',
        },
      ]);

      expect(result).toEqual({ inserted: 1 });
    });
  });
});
