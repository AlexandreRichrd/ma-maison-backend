import type { ClimateAlertDirection } from '../climate-alert-trigger';

/**
 * Emitted by ClimateAlertTriggerService when the cool-down or close-up
 * trigger crosses (see CLAUDE.md's Climate alerts section). Deliberately
 * channel-agnostic: ClimateAlertMailListener and AlexaProactiveEventListener
 * are today's listeners, but another channel later is just another
 * @OnEvent('climate.alert.triggered') listener, no change needed to the
 * trigger logic itself.
 */
export class ClimateAlertEvent {
  constructor(
    public readonly direction: ClimateAlertDirection,
    public readonly indoorTemp: number,
    public readonly outdoorTemp: number,
    // The trigger service's own `now` for this firing — not when a
    // listener happens to process the event. AlexaProactiveEventListener
    // derives its idempotency referenceId from this, which only works if
    // it's stable across retries of the same emitted event rather than
    // wall-clock time observed by the listener.
    public readonly firedAt: Date,
  ) {}
}
