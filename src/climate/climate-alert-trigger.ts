export type ClimateAlertDirection = 'cool_down' | 'close_up';

export type ThermalZone = 'cool' | 'neutral' | 'warm';
export type ComfortZone = 'comfortable' | 'uncomfortable';

type Crossing = {
  active: boolean;
  lastFiredAt: Date | null;
};

export type ClimateAlertState = {
  thermalZone: ThermalZone;
  comfortZone: ComfortZone;
  coolDown: Crossing;
  closeUp: Crossing;
};

export const INITIAL_CLIMATE_ALERT_STATE: ClimateAlertState = {
  thermalZone: 'neutral',
  comfortZone: 'comfortable',
  coolDown: { active: false, lastFiredAt: null },
  closeUp: { active: false, lastFiredAt: null },
};

export type ClimateAlertConfig = {
  marginC: number;
  hysteresisC: number;
  indoorThresholdC: number;
  cooldownMs: number;
};

export type ClimateAlertReading = {
  indoorTemp: number;
  outdoorTemp: number;
  now: Date;
};

export type ClimateAlertResult = {
  state: ClimateAlertState;
  fire: ClimateAlertDirection | null;
};

/**
 * Cool-down/close-up trigger from GitHub issue #9. Two independent Schmitt
 * triggers (thermalZone on indoor-outdoor delta, comfortZone on indoor
 * temperature alone) avoid flapping on sensor noise right at a boundary —
 * entering a zone and leaving it cross at different thresholds, `hysteresisC`
 * apart. `thermalZone` can never be both 'cool' and 'warm' at once, so
 * coolDown and closeUp can never both fire from the same reading.
 *
 * Firing itself is a separate "crossing" concept from the zone: a direction
 * fires on the reading where it first becomes active (a fresh crossing), then
 * suppresses further fires while it stays continuously active until either
 * `cooldownMs` elapses (a repeat reminder) or it goes inactive and becomes
 * active again (a new crossing) — see CLAUDE.md's Climate alerts section.
 *
 * Pure and deterministic — no Prisma/event-emitter access — so it's tested
 * in isolation, same reasoning as broadcast-selection.ts.
 */
export function evaluateClimateAlert(
  state: ClimateAlertState,
  reading: ClimateAlertReading,
  config: ClimateAlertConfig,
): ClimateAlertResult {
  const { marginC, hysteresisC, indoorThresholdC, cooldownMs } = config;
  const { indoorTemp, outdoorTemp, now } = reading;
  const delta = indoorTemp - outdoorTemp; // positive => outdoor cooler than indoor

  let thermalZone = state.thermalZone;
  if (thermalZone !== 'cool' && delta > marginC + hysteresisC) {
    thermalZone = 'cool';
  } else if (thermalZone !== 'warm' && delta < -marginC - hysteresisC) {
    thermalZone = 'warm';
  } else if (thermalZone === 'cool' && delta < marginC - hysteresisC) {
    thermalZone = 'neutral';
  } else if (thermalZone === 'warm' && delta > -marginC + hysteresisC) {
    thermalZone = 'neutral';
  }

  let comfortZone = state.comfortZone;
  if (
    comfortZone === 'comfortable' &&
    indoorTemp > indoorThresholdC + hysteresisC
  ) {
    comfortZone = 'uncomfortable';
  } else if (
    comfortZone === 'uncomfortable' &&
    indoorTemp < indoorThresholdC - hysteresisC
  ) {
    comfortZone = 'comfortable';
  }

  const coolDownActive =
    thermalZone === 'cool' && comfortZone === 'uncomfortable';
  const closeUpActive = thermalZone === 'warm';

  const [coolDown, coolDownFire] = nextCrossing(
    state.coolDown,
    coolDownActive,
    now,
    cooldownMs,
    'cool_down',
  );
  const [closeUp, closeUpFire] = nextCrossing(
    state.closeUp,
    closeUpActive,
    now,
    cooldownMs,
    'close_up',
  );

  return {
    state: { thermalZone, comfortZone, coolDown, closeUp },
    fire: coolDownFire ?? closeUpFire,
  };
}

function nextCrossing(
  crossing: Crossing,
  isActive: boolean,
  now: Date,
  cooldownMs: number,
  direction: ClimateAlertDirection,
): [Crossing, ClimateAlertDirection | null] {
  if (!isActive) {
    return [{ active: false, lastFiredAt: crossing.lastFiredAt }, null];
  }

  const freshCrossing = !crossing.active;
  const cooldownElapsed =
    crossing.lastFiredAt === null ||
    now.getTime() - crossing.lastFiredAt.getTime() >= cooldownMs;

  if (freshCrossing || cooldownElapsed) {
    return [{ active: true, lastFiredAt: now }, direction];
  }
  return [{ active: true, lastFiredAt: crossing.lastFiredAt }, null];
}
