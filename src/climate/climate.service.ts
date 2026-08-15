import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { MeasureDto } from './dto/ingest-measures.dto';

// The Pi's capteurs/# MQTT subscription also picks up non-climate topics
// (rssi, uptime, statut, and an ESPHome debug/log message that leaks
// through) — see capteurs/README.md's Sujets MQTT and pi/main.py's
// parse_topic(). Those land in the same `measures` table as everything
// else ingested (type is intentionally not a DB enum, see the Measure
// model), so the read side filters to the two metrics the ESPHome config
// actually publishes as sensor state (capteur-salon.yaml's `temperature`/
// `humidite` state_topics) rather than trusting whatever `type` shows up.
const KNOWN_MEASURE_TYPES = ['temperature', 'humidite'] as const;

export type CurrentReading = {
  deviceName: string;
  type: string;
  value: string;
  recordedAt: Date;
};

@Injectable()
export class ClimateService {
  constructor(private readonly prisma: PrismaService) {}

  async ingest(measures: MeasureDto[]): Promise<{ inserted: number }> {
    const result = await this.prisma.measure.createMany({
      data: measures.map((measure) => ({
        deviceName: measure.deviceName,
        type: measure.type,
        value: measure.value,
        recordedAt: new Date(measure.recordedAt),
      })),
    });
    return { inserted: result.count };
  }

  // Latest reading per (deviceName, type) — Postgres DISTINCT ON via
  // Prisma's `distinct`, which requires `orderBy` to lead with the same
  // fields so "latest" is well-defined per group.
  async getCurrent(): Promise<CurrentReading[]> {
    return this.prisma.measure.findMany({
      where: { type: { in: [...KNOWN_MEASURE_TYPES] } },
      orderBy: [{ deviceName: 'asc' }, { type: 'asc' }, { recordedAt: 'desc' }],
      distinct: ['deviceName', 'type'],
      select: { deviceName: true, type: true, value: true, recordedAt: true },
    });
  }
}
