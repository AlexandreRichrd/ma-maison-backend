// Matching capteur-salon.yaml / capteur-exterieur.yaml's device names — see
// CLAUDE.md's Climate section. Shared by ClimateAlertTriggerService (the
// window-alert trigger) and AlexaService (the current-conditions readback,
// issue #13) — both need to pick the same two sensors out of `measures`.
export const INDOOR_DEVICE = 'capteur-salon';
export const OUTDOOR_DEVICE = 'capteur-exterieur';
