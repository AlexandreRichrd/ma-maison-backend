// The Pi's capteurs/# MQTT subscription also picks up non-climate topics
// (rssi, uptime, statut, and an ESPHome debug/log message that leaks
// through) — see capteurs/README.md's Sujets MQTT and pi/main.py's
// parse_topic(). Those land in the same `measures` table as everything
// else ingested (type is intentionally not a DB enum, see the Measure
// model), so both the read side and the websocket broadcast filter down
// to the three metrics the ESPHome configs actually publish as sensor
// state (capteur-salon.yaml's `temperature`/`humidite` state_topics,
// capteur-exterieur.yaml's `temperature`/`batterie`) rather than trusting
// whatever `type` shows up.
export const KNOWN_MEASURE_TYPES = ['temperature', 'humidite', 'batterie'] as const;

export type KnownMeasureType = (typeof KNOWN_MEASURE_TYPES)[number];

export function isKnownMeasureType(type: string): type is KnownMeasureType {
  return (KNOWN_MEASURE_TYPES as readonly string[]).includes(type);
}
