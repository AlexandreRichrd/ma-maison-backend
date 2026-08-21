import { selectBroadcast } from './broadcast-selection';

function measure(type: string, value: string, recordedAt: string) {
  return { deviceName: 'capteur-salon', type, value, recordedAt };
}

describe('selectBroadcast', () => {
  it('broadcasts a single known measure when nothing was broadcast yet', () => {
    const result = selectBroadcast(
      [measure('temperature', '21.3', '2026-08-15T10:00:00.000Z')],
      null,
    );

    expect(result).toEqual({
      measures: [measure('temperature', '21.3', '2026-08-15T10:00:00.000Z')],
      lastBroadcastAt: new Date('2026-08-15T10:00:00.000Z'),
    });
  });

  it('broadcasts every known measure sharing the batch max recordedAt, not just one', () => {
    const result = selectBroadcast(
      [
        measure('temperature', '21.3', '2026-08-15T10:00:00.000Z'),
        measure('humidite', '47.2', '2026-08-15T10:00:00.000Z'),
      ],
      null,
    );

    expect(result?.measures).toHaveLength(2);
    expect(result?.lastBroadcastAt).toEqual(
      new Date('2026-08-15T10:00:00.000Z'),
    );
  });

  it('broadcasts both measures in a batch even when their recordedAt differs, as real MQTT-sourced readings do', () => {
    // Regression test: temperature and humidite are separate MQTT messages,
    // not one — the Pi's real payloads carry recordedAt values ~80ms apart
    // (temperature first, humidite second), never an identical timestamp.
    // A prior version of selectBroadcast only kept measures tied with the
    // batch's exact max recordedAt, which silently dropped temperature on
    // every batch since it never matched humidite's later timestamp.
    const result = selectBroadcast(
      [
        measure('temperature', '21.3', '2026-08-15T10:00:00.000Z'),
        measure('humidite', '47.2', '2026-08-15T10:00:00.080Z'),
      ],
      null,
    );

    expect(result?.measures).toEqual(
      expect.arrayContaining([
        measure('temperature', '21.3', '2026-08-15T10:00:00.000Z'),
        measure('humidite', '47.2', '2026-08-15T10:00:00.080Z'),
      ]),
    );
    expect(result?.measures).toHaveLength(2);
    expect(result?.lastBroadcastAt).toEqual(
      new Date('2026-08-15T10:00:00.080Z'),
    );
  });

  it('ignores non-climate types entirely', () => {
    const result = selectBroadcast(
      [
        measure('rssi', '-52', '2026-08-15T10:00:00.000Z'),
        measure('statut', 'en_ligne', '2026-08-15T10:00:00.000Z'),
        measure('debug', '[19:59:58][D]...', '2026-08-15T10:00:00.000Z'),
      ],
      null,
    );

    expect(result).toBeNull();
  });

  it('returns null when the batch max is not strictly newer than the last broadcast', () => {
    const lastBroadcastAt = new Date('2026-08-15T10:00:00.000Z');

    expect(
      selectBroadcast(
        [measure('temperature', '21.3', '2026-08-15T10:00:00.000Z')],
        lastBroadcastAt,
      ),
    ).toBeNull();
    expect(
      selectBroadcast(
        [measure('temperature', '20.9', '2026-08-15T09:00:00.000Z')],
        lastBroadcastAt,
      ),
    ).toBeNull();
  });

  it('replays: a Pi replaying its SQLite buffer after an outage produces only-older timestamps, which broadcast nothing', () => {
    const lastBroadcastAt = new Date('2026-08-15T12:00:00.000Z');

    const result = selectBroadcast(
      [
        measure('temperature', '19.1', '2026-08-15T11:00:00.000Z'),
        measure('humidite', '50.0', '2026-08-15T11:00:00.000Z'),
        measure('temperature', '19.4', '2026-08-15T11:30:00.000Z'),
      ],
      lastBroadcastAt,
    );

    expect(result).toBeNull();
  });

  it('a batch mixing a stale replay with one genuinely new reading only broadcasts the new one', () => {
    const lastBroadcastAt = new Date('2026-08-15T10:00:00.000Z');

    const result = selectBroadcast(
      [
        measure('temperature', '19.1', '2026-08-15T09:00:00.000Z'),
        measure('temperature', '21.5', '2026-08-15T10:05:00.000Z'),
      ],
      lastBroadcastAt,
    );

    expect(result).toEqual({
      measures: [measure('temperature', '21.5', '2026-08-15T10:05:00.000Z')],
      lastBroadcastAt: new Date('2026-08-15T10:05:00.000Z'),
    });
  });
});
