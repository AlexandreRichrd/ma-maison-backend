import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { PrismaService } from '../prisma/prisma.service';
import { MeasureDto } from './dto/ingest-measures.dto';
import { MeasuresIngestedEvent } from './events/measures-ingested.event';
import { KNOWN_MEASURE_TYPES } from './known-measure-types';

export type CurrentReading = {
  deviceName: string;
  type: string;
  value: string;
  recordedAt: Date;
};

@Injectable()
export class ClimateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async ingest(measures: MeasureDto[]): Promise<{ inserted: number }> {
    const result = await this.prisma.measure.createMany({
      data: measures.map((measure) => ({
        deviceName: measure.deviceName,
        type: measure.type,
        value: measure.value,
        recordedAt: new Date(measure.recordedAt),
      })),
    });

    // Fired after the batch is durably persisted, not before — a listener
    // (ClimateGateway) reacting to this should never be able to broadcast
    // a measurement this service failed to save. No direct dependency on
    // the gateway/websockets module: this service doesn't know or care
    // whether anything is listening.
    this.events.emit(
      'climate.measures.ingested',
      new MeasuresIngestedEvent(measures),
    );

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
