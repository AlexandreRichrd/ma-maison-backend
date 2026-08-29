import { Injectable } from '@nestjs/common';

import { ClimateService } from '../climate/climate.service';
import { buildEmptyResponse, buildSpeechResponse } from './alexa-response.util';
import { buildCurrentConditionsSpeech } from './current-conditions';
import type {
  AlexaRequest,
  RequestEnvelope,
  ResponseEnvelope,
  SkillEventRequest,
} from './types/alexa.types';

const HELP_TEXT =
  'Vous pouvez demander les conditions actuelles, par exemple en disant : quelles sont les conditions.';
const NOT_UNDERSTOOD_TEXT =
  "Je n'ai pas compris. Vous pouvez demander les conditions actuelles.";
const GOODBYE_TEXT = 'À bientôt.';

@Injectable()
export class AlexaService {
  constructor(private readonly climate: ClimateService) {}

  async handleRequest(envelope: RequestEnvelope): Promise<ResponseEnvelope> {
    const { request } = envelope;

    if (isSkillEventRequest(request)) {
      // Machine-to-machine (SkillEnabled, ProactiveSubscriptionChanged,
      // etc.) — these started arriving once #14's manifest declared
      // events.endpoint. Never gets a spoken response, same as
      // SessionEndedRequest: responding with French speech to a request
      // nothing is listening to would be wrong, not just unhelpful. No
      // subscription state read or stored — see CLAUDE.md's Alexa section.
      return buildEmptyResponse();
    }

    switch (request.type) {
      case 'LaunchRequest':
        return this.currentConditionsResponse();

      case 'IntentRequest':
        return this.handleIntent(request.intent.name);

      case 'SessionEndedRequest':
        // Never gets a spoken response, per the Alexa spec.
        return buildEmptyResponse();
    }
  }

  private async handleIntent(intentName: string): Promise<ResponseEnvelope> {
    switch (intentName) {
      case 'GetCurrentConditionsIntent':
        return this.currentConditionsResponse();

      case 'AMAZON.StopIntent':
      case 'AMAZON.CancelIntent':
        return buildSpeechResponse(GOODBYE_TEXT, { endSession: true });

      case 'AMAZON.HelpIntent':
        return buildSpeechResponse(HELP_TEXT, {
          endSession: false,
          repromptText: HELP_TEXT,
        });

      case 'AMAZON.FallbackIntent':
      default:
        return buildSpeechResponse(NOT_UNDERSTOOD_TEXT, {
          endSession: false,
          repromptText: NOT_UNDERSTOOD_TEXT,
        });
    }
  }

  private async currentConditionsResponse(): Promise<ResponseEnvelope> {
    const readings = await this.climate.getCurrent();
    const speech = buildCurrentConditionsSpeech(readings);
    return buildSpeechResponse(speech, { endSession: true });
  }
}

function isSkillEventRequest(
  request: AlexaRequest,
): request is SkillEventRequest {
  return request.type.startsWith('AlexaSkillEvent.');
}
