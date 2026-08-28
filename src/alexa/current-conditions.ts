import { INDOOR_DEVICE, OUTDOOR_DEVICE } from '../climate/device-names';
import type { CurrentReading } from '../climate/climate.service';

// French text is a deliberate exception here — see CLAUDE.md's Alexa
// section: Alexa speaks this directly, no frontend intermediary, unlike
// every other route in this API (see CLAUDE.md's API surface rule).

/**
 * Builds the French current-conditions sentence read back by the Alexa
 * skill, from the same CurrentReading[] shape ClimateService.getCurrent()
 * already returns for the dashboard. Pure and total — never throws, since
 * this runs on Alexa's ~8s request timeout and a missing reading (e.g.
 * right after a fresh deploy) must still get a spoken answer, not a 500.
 */
export function buildCurrentConditionsSpeech(
  readings: CurrentReading[],
): string {
  const indoorTemp = findValue(readings, INDOOR_DEVICE, 'temperature');
  const indoorHumidity = findValue(readings, INDOOR_DEVICE, 'humidite');
  const outdoorTemp = findValue(readings, OUTDOOR_DEVICE, 'temperature');

  if (indoorTemp === undefined || outdoorTemp === undefined) {
    return "Je n'ai pas encore de relevé disponible pour le moment.";
  }

  const humidityClause =
    indoorHumidity !== undefined
      ? ` avec ${formatFr(indoorHumidity)}% d'humidité`
      : '';
  const delta = Math.abs(indoorTemp - outdoorTemp);

  return (
    `À l'intérieur, il fait ${formatFr(indoorTemp)} degrés${humidityClause}, ` +
    `et à l'extérieur, il fait ${formatFr(outdoorTemp)} degrés. ` +
    `La différence est de ${formatFr(delta)} degrés.`
  );
}

function findValue(
  readings: CurrentReading[],
  deviceName: string,
  type: string,
): number | undefined {
  const reading = readings.find(
    (r) => r.deviceName === deviceName && r.type === type,
  );
  if (!reading) return undefined;
  const value = Number(reading.value);
  return Number.isFinite(value) ? value : undefined;
}

function formatFr(value: number): string {
  return value.toFixed(1).replace('.', ',');
}
