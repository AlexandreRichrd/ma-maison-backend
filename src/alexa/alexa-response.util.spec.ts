import { buildEmptyResponse, buildSpeechResponse } from './alexa-response.util';

describe('buildSpeechResponse', () => {
  it('builds a plain-text response with the session ended', () => {
    expect(buildSpeechResponse('bonjour', { endSession: true })).toEqual({
      version: '1.0',
      response: {
        outputSpeech: { type: 'PlainText', text: 'bonjour' },
        shouldEndSession: true,
      },
    });
  });

  it('includes a reprompt when the session stays open', () => {
    expect(
      buildSpeechResponse('bonjour', {
        endSession: false,
        repromptText: 'toujours là ?',
      }),
    ).toEqual({
      version: '1.0',
      response: {
        outputSpeech: { type: 'PlainText', text: 'bonjour' },
        shouldEndSession: false,
        reprompt: {
          outputSpeech: { type: 'PlainText', text: 'toujours là ?' },
        },
      },
    });
  });

  it('omits reprompt when the session stays open but no reprompt text is given', () => {
    const result = buildSpeechResponse('bonjour', { endSession: false });
    expect(result.response.reprompt).toBeUndefined();
  });
});

describe('buildEmptyResponse', () => {
  it('has no outputSpeech and ends the session', () => {
    expect(buildEmptyResponse()).toEqual({
      version: '1.0',
      response: { shouldEndSession: true },
    });
  });
});
