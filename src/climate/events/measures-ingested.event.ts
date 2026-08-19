import { MeasureDto } from '../dto/ingest-measures.dto';

/**
 * Emitted by ClimateService after one POST /climate/measures batch is
 * persisted. Carries the raw batch exactly as ingested — including
 * non-climate types (rssi, statut, the ESPHome debug leak, see
 * known-measure-types.ts) — so this event stays a plain "here's what was
 * just saved" fact with no websocket-specific filtering baked in.
 * Listeners (ClimateGateway) decide what's broadcast-worthy.
 */
export class MeasuresIngestedEvent {
  constructor(public readonly measures: MeasureDto[]) {}
}
