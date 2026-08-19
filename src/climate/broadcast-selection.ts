import { MeasureDto } from './dto/ingest-measures.dto';
import { isKnownMeasureType } from './known-measure-types';

export type BroadcastSelection = {
  measures: MeasureDto[];
  lastBroadcastAt: Date;
};

/**
 * Picks what ClimateGateway should broadcast from one ingested batch: every
 * known-type measure sharing the batch's latest recordedAt, but only if
 * that timestamp is strictly newer than the last one already broadcast.
 *
 * temperature and humidite are normally reported together with the same
 * recordedAt (same ESPHome publish cycle) — comparing each type
 * independently against the last broadcast would silently drop whichever
 * one lost the tie, so the comparison happens once, against the batch's
 * max, and same-timestamp siblings go out together in the one broadcast.
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
      new Date(measure.recordedAt).getTime() === maxRecordedAt.getTime(),
  );

  return { measures: toBroadcast, lastBroadcastAt: maxRecordedAt };
}
