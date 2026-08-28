import type { OutputSpeech, ResponseEnvelope } from './types/alexa.types';

/**
 * Pure builder for the Alexa response envelope — same "pure, unit-tested"
 * pattern as climate-alert-trigger.ts/rotation.service.ts. `reprompt` is
 * only meaningful (and only sent) when the session stays open: Alexa uses
 * it if the user doesn't say anything for a few seconds.
 */
export function buildSpeechResponse(
  text: string,
  options: { endSession: boolean; repromptText?: string } = {
    endSession: true,
  },
): ResponseEnvelope {
  const outputSpeech: OutputSpeech = { type: 'PlainText', text };

  return {
    version: '1.0',
    response: {
      outputSpeech,
      shouldEndSession: options.endSession,
      ...(!options.endSession && options.repromptText
        ? {
            reprompt: {
              outputSpeech: { type: 'PlainText', text: options.repromptText },
            },
          }
        : {}),
    },
  };
}

/** SessionEndedRequest never gets a spoken response — just an empty ack. */
export function buildEmptyResponse(): ResponseEnvelope {
  return {
    version: '1.0',
    response: { shouldEndSession: true },
  };
}
