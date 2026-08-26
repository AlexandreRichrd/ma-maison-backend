import type { ClimateAlertDirection } from '../climate-alert-trigger';

/**
 * Emitted by ClimateAlertTriggerService when the cool-down or close-up
 * trigger crosses (see CLAUDE.md's Climate alerts section). Deliberately
 * channel-agnostic: ClimateAlertMailListener is the only listener today, but
 * a push/SMS channel later is just another @OnEvent('climate.alert.triggered')
 * listener, no change needed to the trigger logic itself.
 */
export class ClimateAlertEvent {
  constructor(
    public readonly direction: ClimateAlertDirection,
    public readonly indoorTemp: number,
    public readonly outdoorTemp: number,
  ) {}
}
