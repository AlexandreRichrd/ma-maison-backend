// Hand-rolled, minimal types for the slice of the Alexa Skills Kit JSON
// envelope this endpoint actually reads/writes — not the full `ask-sdk-model`
// package, which this codebase doesn't depend on (see CLAUDE.md's Alexa
// section for why: one small endpoint, not the full SDK/response-builder
// framework).

export type AlexaRequest =
  LaunchRequest | IntentRequest | SessionEndedRequest | SkillEventRequest;

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

// Machine-to-machine skill events (SkillEnabled, SkillPermissionAccepted,
// ProactiveSubscriptionChanged, etc. — see CLAUDE.md's Alexa section) all
// share the `AlexaSkillEvent.<Name>` type prefix and have no `locale`, no
// `intent`, and no session concept the way user-initiated requests do.
// These started arriving once #14's manifest declared `events.endpoint`.
// Only the discriminant is modeled — the event-specific `body` (e.g.
// ProactiveSubscriptionChanged's subscriptions array) is never read, since
// #13 already decided not to track subscription state.
export type SkillEventRequest = {
  type: `AlexaSkillEvent.${string}`;
  requestId: string;
  timestamp: string;
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
