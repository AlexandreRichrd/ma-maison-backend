import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { MeasureDto } from './dto/ingest-measures.dto';

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
}
