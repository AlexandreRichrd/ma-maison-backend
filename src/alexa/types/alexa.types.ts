// Hand-rolled, minimal types for the slice of the Alexa Skills Kit JSON
// envelope this endpoint actually reads/writes — not the full `ask-sdk-model`
// package, which this codebase doesn't depend on (see CLAUDE.md's Alexa
// section for why: one small endpoint, not the full SDK/response-builder
// framework).

export type AlexaRequest = LaunchRequest | IntentRequest | SessionEndedRequest;

export type LaunchRequest = {
  type: 'LaunchRequest';
  requestId: string;
  timestamp: string;
  locale: string;
};

export type IntentRequest = {
  type: 'IntentRequest';
  requestId: string;
  timestamp: string;
  locale: string;
  intent: {
    name: string;
    confirmationStatus?: string;
    slots?: Record<string, unknown>;
  };
};

export type SessionEndedRequest = {
  type: 'SessionEndedRequest';
  requestId: string;
  timestamp: string;
  locale: string;
  reason: string;
};

export type RequestEnvelope = {
  version: string;
  context: {
    System: {
      application: { applicationId: string };
    };
  };
  request: AlexaRequest;
};

export type OutputSpeech = {
  type: 'PlainText';
  text: string;
};

export type ResponseEnvelope = {
  version: '1.0';
  response: {
    outputSpeech?: OutputSpeech;
    reprompt?: { outputSpeech: OutputSpeech };
    shouldEndSession: boolean;
  };
};
