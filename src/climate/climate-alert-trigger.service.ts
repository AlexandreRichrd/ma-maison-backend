import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';

import { PrismaService } from '../prisma/prisma.service';
import {
  type ClimateAlertConfig,
  type ClimateAlertState,
  INITIAL_CLIMATE_ALERT_STATE,
  evaluateClimateAlert,
} from './climate-alert-trigger';
import { ClimateAlertEvent } from './events/climate-alert.event';
import type { MeasuresIngestedEvent } from './events/measures-ingested.event';

// Matching capteur-salon.yaml / capteur-exterieur.yaml's device names — see
// CLAUDE.md's Climate section.
const INDOOR_DEVICE = 'capteur-salon';
const OUTDOOR_DEVICE = 'capteur-exterieur';

// The outdoor sensor isn't mounted in a Stevenson screen yet, so a reading
// in direct sun can spike several degrees within minutes (see CLAUDE.md's
// Climate alerts section). Averaging the last few readings instead of
// trusting the newest one alone keeps one sunlit sample from causing a
// false close-up alert or masking a real cool-down window. ~5 minutes given
// the Pi's roughly-1/minute forwarding cadence.
const OUTDOOR_SMOOTHING_SAMPLES = 5;

const DEFAULT_MARGIN_C = 0.5;
const DEFAULT_HYSTERESIS_C = 0.3;
const DEFAULT_INDOOR_THRESHOLD_C = 24;
const DEFAULT_COOLDOWN_MINUTES = 120;

/**
 * Evaluates the cool-down/close-up window-alert trigger (issue #9) every
 * time a batch touching indoor or outdoor temperature is ingested — driven
 * by ClimateService.ingest()'s existing 'climate.measures.ingested' event,
 * not a second polling read path. Emits 'climate.alert.triggered' for
 * ClimateAlertMailListener (or any future channel) to act on; the trigger
 * logic itself lives in climate-alert-trigger.ts, kept pure and unit-tested
 * in isolation.
 */
@Injectable()
export class ClimateAlertTriggerService {
  private readonly logger = new Logger(ClimateAlertTriggerService.name);

  // Single process, no horizontal scaling (see CLAUDE.md's "no scale
  // problem to solve yet") — same in-memory-state reasoning as
  // ClimateGateway's lastBroadcastAt. Resets on restart: a crossing already
  // in progress before a restart is treated as fresh and can fire again
  // immediately, which is an acceptable edge case at this scale.
  private state: ClimateAlertState = INITIAL_CLIMATE_ALERT_STATE;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  @OnEvent('climate.measures.ingested')
  async handleMeasuresIngested(event: MeasuresIngestedEvent): Promise<void> {
    const touchesRelevantTemp = event.measures.some(
      (measure) =>
        measure.type === 'temperature' &&
        (measure.deviceName === INDOOR_DEVICE ||
          measure.deviceName === OUTDOOR_DEVICE),
    );
    if (!touchesRelevantTemp) return;

    const [indoor, outdoorSamples] = await Promise.all([
      this.prisma.measure.findFirst({
        where: { deviceName: INDOOR_DEVICE, type: 'temperature' },
        orderBy: { recordedAt: 'desc' },
      }),
      this.prisma.measure.findMany({
        where: { deviceName: OUTDOOR_DEVICE, type: 'temperature' },
        orderBy: { recordedAt: 'desc' },
        take: OUTDOOR_SMOOTHING_SAMPLES,
      }),
    ]);
    // No history yet for one side (e.g. right after a fresh deploy) — skip
    // rather than evaluate against a made-up 0°C default.
    if (!indoor || outdoorSamples.length === 0) return;

    const indoorTemp = Number(indoor.value);
    const outdoorTemp =
      outdoorSamples.reduce((sum, sample) => sum + Number(sample.value), 0) /
      outdoorSamples.length;

    const result = evaluateClimateAlert(
      this.state,
      { indoorTemp, outdoorTemp, now: new Date() },
      climateAlertConfig(),
    );
    this.state = result.state;

    if (result.fire) {
      this.logger.log(
        `climate alert: ${result.fire} (indoor=${indoorTemp.toFixed(1)}°C outdoor=${outdoorTemp.toFixed(1)}°C)`,
      );
      this.events.emit(
        'climate.alert.triggered',
        new ClimateAlertEvent(result.fire, indoorTemp, outdoorTemp),
      );
    }
  }
}

// Same validate-and-default-per-var pattern as climate-summary.service.ts's
// retentionDays() — see CLAUDE.md's Climate alerts section for the env vars.
function climateAlertConfig(): ClimateAlertConfig {
  return {
    marginC: positiveNumberEnv('CLIMATE_ALERT_MARGIN_C', DEFAULT_MARGIN_C),
    hysteresisC: positiveNumberEnv(
      'CLIMATE_ALERT_HYSTERESIS_C',
      DEFAULT_HYSTERESIS_C,
    ),
    indoorThresholdC: positiveNumberEnv(
      'CLIMATE_ALERT_INDOOR_THRESHOLD_C',
      DEFAULT_INDOOR_THRESHOLD_C,
    ),
    cooldownMs:
      positiveNumberEnv(
        'CLIMATE_ALERT_COOLDOWN_MINUTES',
        DEFAULT_COOLDOWN_MINUTES,
      ) * 60_000,
  };
}

function positiveNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number, got '${raw}'`);
  }
  return parsed;
}
