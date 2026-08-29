import 'dotenv/config';

import { NestFactory } from '@nestjs/core';

import type { ClimateAlertDirection } from '../climate/climate-alert-trigger';
import { ClimateAlertEvent } from '../climate/events/climate-alert.event';
import { AlexaTriggerModule } from './alexa-trigger.module';
import { AlexaProactiveEventListener } from './alexa-proactive-event.listener';

const VALID_DIRECTIONS: ClimateAlertDirection[] = ['cool_down', 'close_up'];

// Manual, on-demand way to send a real Alexa proactive event without
// waiting for real climate conditions to satisfy the trigger — see
// CLAUDE.md's Alexa section. Deliberately not an HTTP route: this API
// already has one public unauthenticated endpoint for Alexa
// (AlexaController), and a second trigger surface that exists purely for
// testing convenience isn't worth the risk. Goes through
// AlexaProactiveEventListener.handleClimateAlert() directly — the exact
// method the real 'climate.alert.triggered' event calls — so this proves
// the real code path (LWA token fetch, the real HTTP POST, the real
// referenceId/expiryTime construction), not a reimplementation of it.
// indoorTemp/outdoorTemp are unused by this listener (it never sends the
// reading, only the signal — see AlexaProactiveEventListener's own
// comment) but ClimateAlertEvent requires them since ClimateAlertMailListener
// does use them; the values here are illustrative only.
async function run() {
  const direction = process.argv[2];
  if (!isValidDirection(direction)) {
    console.error(
      `Usage: node dist/alexa/trigger-proactive-event.js <${VALID_DIRECTIONS.join('|')}>`,
    );
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AlexaTriggerModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const listener = app.get(AlexaProactiveEventListener);
    const event = new ClimateAlertEvent(direction, 25, 15, new Date());
    await listener.handleClimateAlert(event);
    console.log(
      'Dispatched — check the AlexaProactiveEventListener log line above ' +
        'for whether the send actually succeeded (failures are caught and ' +
        'logged there, never thrown, same as a real climate-triggered send).',
    );
  } finally {
    await app.close();
  }
}

function isValidDirection(
  value: string | undefined,
): value is ClimateAlertDirection {
  return VALID_DIRECTIONS.includes(value as ClimateAlertDirection);
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
