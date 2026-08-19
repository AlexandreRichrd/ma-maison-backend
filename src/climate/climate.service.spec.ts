import { EventEmitter2 } from '@nestjs/event-emitter';

import { PrismaService } from '../prisma/prisma.service';
import { ClimateService } from './climate.service';

describe('ClimateService', () => {
  let prisma: PrismaService;
  let events: EventEmitter2;
  let climate: ClimateService;

  beforeAll(() => {
    prisma = new PrismaService();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE measures RESTART IDENTITY CASCADE`;
    events = new EventEmitter2();
    climate = new ClimateService(prisma, events);
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

    it('emits climate.measures.ingested with the batch after it is persisted', async () => {
      const listener = jest.fn();
      events.on('climate.measures.ingested', listener);

      const measures = [
        {
          deviceName: 'capteur-salon',
          type: 'temperature',
          value: '21.3',
          recordedAt: '2026-08-15T10:00:00.000Z',
        },
      ];
      await climate.ingest(measures);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ measures }),
      );
    });
  });

  describe('getCurrent', () => {
    it('returns only the latest reading per device and type', async () => {
      await climate.ingest([
        {
          deviceName: 'capteur-salon',
          type: 'temperature',
          value: '20.5',
          recordedAt: '2026-08-15T09:00:00.000Z',
        },
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

      const rows = await climate.getCurrent();

      expect(rows).toEqual([
        {
          deviceName: 'capteur-salon',
          type: 'humidite',
          value: '47.2',
          recordedAt: new Date('2026-08-15T10:00:00.000Z'),
        },
        {
          deviceName: 'capteur-salon',
          type: 'temperature',
          value: '21.3',
          recordedAt: new Date('2026-08-15T10:00:00.000Z'),
        },
      ]);
    });

    it('filters out non-climate types like rssi, statut, and the ESPHome debug leak', async () => {
      await climate.ingest([
        {
          deviceName: 'capteur-salon',
          type: 'temperature',
          value: '21.3',
          recordedAt: '2026-08-15T10:00:00.000Z',
        },
        {
          deviceName: 'capteur-salon',
          type: 'rssi',
          value: '-52',
          recordedAt: '2026-08-15T10:00:00.000Z',
        },
        {
          deviceName: 'capteur-salon',
          type: 'statut',
          value: 'en_ligne',
          recordedAt: '2026-08-15T10:00:00.000Z',
        },
        {
          deviceName: 'capteur-salon',
          type: 'debug',
          value: '[19:59:58][D][sensor:...',
          recordedAt: '2026-08-15T10:00:00.000Z',
        },
      ]);

      const rows = await climate.getCurrent();

      expect(rows.map((r) => r.type)).toEqual(['temperature']);
    });
  });
});
