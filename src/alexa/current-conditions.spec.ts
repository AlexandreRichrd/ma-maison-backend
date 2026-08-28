import type { CurrentReading } from '../climate/climate.service';
import { buildCurrentConditionsSpeech } from './current-conditions';

const reading = (
  deviceName: string,
  type: string,
  value: string,
): CurrentReading => ({
  deviceName,
  type,
  value,
  recordedAt: new Date('2026-08-15T10:00:00.000Z'),
});

describe('buildCurrentConditionsSpeech', () => {
  it('reads indoor temp+humidity, outdoor temp, and the delta', () => {
    const speech = buildCurrentConditionsSpeech([
      reading('capteur-salon', 'temperature', '21.3'),
      reading('capteur-salon', 'humidite', '47.2'),
      reading('capteur-exterieur', 'temperature', '15.6'),
    ]);

    expect(speech).toBe(
      "À l'intérieur, il fait 21,3 degrés avec 47,2% d'humidité, " +
        "et à l'extérieur, il fait 15,6 degrés. " +
        'La différence est de 5,7 degrés.',
    );
  });

  it('omits the humidity clause when indoor humidity is missing', () => {
    const speech = buildCurrentConditionsSpeech([
      reading('capteur-salon', 'temperature', '21.3'),
      reading('capteur-exterieur', 'temperature', '15.6'),
    ]);

    expect(speech).toBe(
      "À l'intérieur, il fait 21,3 degrés, " +
        "et à l'extérieur, il fait 15,6 degrés. " +
        'La différence est de 5,7 degrés.',
    );
  });

  it('falls back gracefully when indoor temperature is missing', () => {
    const speech = buildCurrentConditionsSpeech([
      reading('capteur-exterieur', 'temperature', '15.6'),
    ]);

    expect(speech).toBe(
      "Je n'ai pas encore de relevé disponible pour le moment.",
    );
  });

  it('falls back gracefully when outdoor temperature is missing', () => {
    const speech = buildCurrentConditionsSpeech([
      reading('capteur-salon', 'temperature', '21.3'),
    ]);

    expect(speech).toBe(
      "Je n'ai pas encore de relevé disponible pour le moment.",
    );
  });

  it('falls back gracefully with no readings at all', () => {
    expect(buildCurrentConditionsSpeech([])).toBe(
      "Je n'ai pas encore de relevé disponible pour le moment.",
    );
  });
});
