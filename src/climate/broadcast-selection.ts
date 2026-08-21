import { MeasureDto } from './dto/ingest-measures.dto';
import { isKnownMeasureType } from './known-measure-types';

export type BroadcastSelection = {
  measures: MeasureDto[];
  lastBroadcastAt: Date;
};

/**
 * Picks what ClimateGateway should broadcast from one ingested batch: every
 * known-type measure strictly newer than the last one already broadcast,
 * with the watermark advanced to the batch's max recordedAt.
 *
 * temperature and humidite are two separate MQTT messages, not one — real
 * batches carry ~80ms apart recordedAt values between them, not a shared
 * timestamp. An earlier version of this compared only the batch's max
 * recordedAt against the watermark and broadcast just the measures tied
 * with that max, which silently dropped whichever type wasn't last in the
 * batch on every single ingest (always temperature, since the Pi sends it
 * first) — comparing each measure independently against the watermark
 * instead means same-timestamp siblings still go out together (both are
 * newer than the watermark), but so do near-simultaneous siblings that
 * merely share a batch.
 *
 * Pure and deterministic — no socket/event-emitter access — so it's
 * tested in isolation, same reasoning as rotation.service.ts.
 */
export function selectBroadcast(
  measures: MeasureDto[],
  lastBroadcastAt: Date | null,
): BroadcastSelection | null {
  const known = measures.filter((measure) => isKnownMeasureType(measure.type));
  if (known.length === 0) return null;

  const maxRecordedAt = known.reduce<Date | null>((max, measure) => {
    const recordedAt = new Date(measure.recordedAt);
    return max === null || recordedAt > max ? recordedAt : max;
  }, null)!;

  if (lastBroadcastAt !== null && maxRecordedAt <= lastBroadcastAt) {
    return null;
  }

  const toBroadcast = known.filter(
    (measure) =>
      lastBroadcastAt === null ||
      new Date(measure.recordedAt) > lastBroadcastAt,
  );

  return { measures: toBroadcast, lastBroadcastAt: maxRecordedAt };
}
