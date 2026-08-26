import {
  type ClimateAlertConfig,
  type ClimateAlertState,
  INITIAL_CLIMATE_ALERT_STATE,
  evaluateClimateAlert,
} from './climate-alert-trigger';

const CONFIG: ClimateAlertConfig = {
  marginC: 0.5,
  hysteresisC: 0.3,
  indoorThresholdC: 24,
  cooldownMs: 2 * 60 * 60 * 1000, // 2h
};

const T0 = new Date('2026-08-15T05:00:00.000Z');
const minutesAfter = (minutes: number) =>
  new Date(T0.getTime() + minutes * 60_000);

function evaluate(
  state: ClimateAlertState,
  indoorTemp: number,
  outdoorTemp: number,
  now: Date,
  config: ClimateAlertConfig = CONFIG,
) {
  return evaluateClimateAlert(state, { indoorTemp, outdoorTemp, now }, config);
}

describe('evaluateClimateAlert', () => {
  it('does not fire when outdoor is cooler but indoor is not uncomfortable', () => {
    // 23°C indoor is below the 24°C comfort threshold, even with a big delta.
    const result = evaluate(INITIAL_CLIMATE_ALERT_STATE, 23, 15, T0);

    expect(result.fire).toBeNull();
  });

  it('does not fire when indoor is uncomfortable but outdoor is not meaningfully cooler', () => {
    const result = evaluate(INITIAL_CLIMATE_ALERT_STATE, 25, 24.9, T0);

    expect(result.fire).toBeNull();
  });

  it('fires cool_down on a fresh crossing of both gates', () => {
    // delta = 25 - 20 = 5 > margin+hysteresis (0.8); indoor 25 > 24.3
    const result = evaluate(INITIAL_CLIMATE_ALERT_STATE, 25, 20, T0);

    expect(result.fire).toBe('cool_down');
    expect(result.state.coolDown.active).toBe(true);
  });

  it('does not re-fire on the next reading while still in the same crossing, within cooldown', () => {
    const first = evaluate(INITIAL_CLIMATE_ALERT_STATE, 25, 20, T0);

    const second = evaluate(first.state, 25.1, 20.1, minutesAfter(1));

    expect(second.fire).toBeNull();
  });

  it('re-fires after the cooldown elapses, while the crossing is still continuously active', () => {
    const first = evaluate(INITIAL_CLIMATE_ALERT_STATE, 25, 20, T0);

    const stillWithinCooldown = evaluate(
      first.state,
      25,
      20,
      minutesAfter(119),
    );
    expect(stillWithinCooldown.fire).toBeNull();

    const afterCooldown = evaluate(
      stillWithinCooldown.state,
      25,
      20,
      minutesAfter(121),
    );
    expect(afterCooldown.fire).toBe('cool_down');
  });

  it('does not flap when hovering right at the margin boundary (hysteresis)', () => {
    // First reading firmly crosses into 'cool' + 'uncomfortable'.
    const fired = evaluate(INITIAL_CLIMATE_ALERT_STATE, 25, 24, T0);
    expect(fired.fire).toBe('cool_down');

    // delta now 0.6 (25 - 24.4): above margin (0.5) but inside the
    // hysteresis band around it, so thermalZone should stay 'cool', not
    // reset to neutral — a naive single-threshold comparison would flap
    // here.
    const wobble = evaluate(fired.state, 25, 24.4, minutesAfter(1));
    expect(wobble.state.thermalZone).toBe('cool');
    expect(wobble.fire).toBeNull();
  });

  it('resets suppression once the crossing flips back, firing again immediately even within cooldown', () => {
    const fired = evaluate(INITIAL_CLIMATE_ALERT_STATE, 25, 20, T0);
    expect(fired.fire).toBe('cool_down');

    // Outdoor warms back up past the exit threshold (margin - hysteresis =
    // 0.2) — thermalZone drops to neutral, deactivating the crossing.
    const exited = evaluate(fired.state, 25, 24.9, minutesAfter(1));
    expect(exited.state.coolDown.active).toBe(false);
    expect(exited.fire).toBeNull();

    // Re-crosses well within the 2h cooldown window — should still fire
    // immediately since it's a new crossing, not a repeat of the old one.
    const recrossed = evaluate(exited.state, 25, 20, minutesAfter(2));
    expect(recrossed.fire).toBe('cool_down');
  });

  it('fires close_up when outdoor rises back above indoor by the margin', () => {
    // delta = 20 - 21 = -1, below -(margin+hysteresis) = -0.8
    const result = evaluate(INITIAL_CLIMATE_ALERT_STATE, 20, 21, T0);

    expect(result.fire).toBe('close_up');
    expect(result.state.closeUp.active).toBe(true);
  });

  it('close_up does not require the indoor comfort gate', () => {
    // Indoor well under the comfort threshold — close_up should still fire,
    // unlike cool_down.
    const result = evaluate(INITIAL_CLIMATE_ALERT_STATE, 18, 19.5, T0);

    expect(result.fire).toBe('close_up');
  });
});
