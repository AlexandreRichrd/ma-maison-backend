import { ClimateService } from '../climate/climate.service';
import { AlexaService } from './alexa.service';
import type { RequestEnvelope } from './types/alexa.types';

const APPLICATION_ID = 'amzn1.ask.skill.test';

function envelope(request: RequestEnvelope['request']): RequestEnvelope {
  return {
    version: '1.0',
    context: { System: { application: { applicationId: APPLICATION_ID } } },
    request,
  };
}

describe('AlexaService', () => {
  // getCurrent kept as its own local, not read back off `climate`, so
  // assertions never touch a ClimateService-typed method property (which
  // trips @typescript-eslint/unbound-method even when the runtime value is
  // a mock) — same pattern as climate.gateway.spec.ts's fakeSocket().
  let getCurrent: jest.Mock;
  let service: AlexaService;

  beforeEach(() => {
    getCurrent = jest.fn();
    const climate = { getCurrent } as unknown as ClimateService;
    service = new AlexaService(climate);
  });

  // Regression coverage: before this fix, an unrecognized top-level
  // request.type fell out of handleRequest()'s switch entirely — not a
  // French fallback, just an implicit `undefined` return that Nest would
  // have serialized as an empty body. Skill events (AlexaSkillEvent.*)
  // started arriving for real once #14's manifest declared
  // events.endpoint, so this is no longer a hypothetical.
  describe('skill events (AlexaSkillEvent.*)', () => {
    it('answers ProactiveSubscriptionChanged with an empty response, no speech', async () => {
      const result = await service.handleRequest(
        envelope({
          type: 'AlexaSkillEvent.ProactiveSubscriptionChanged',
          requestId: 'req-1',
          timestamp: '2026-08-29T10:00:00Z',
        }),
      );

      expect(result).toEqual({
        version: '1.0',
        response: { shouldEndSession: true },
      });
      expect(getCurrent).not.toHaveBeenCalled();
    });

    it('answers any AlexaSkillEvent.* type the same way, not just one hardcoded name', async () => {
      const result = await service.handleRequest(
        envelope({
          type: 'AlexaSkillEvent.SkillEnabled',
          requestId: 'req-2',
          timestamp: '2026-08-29T10:00:00Z',
        }),
      );

      expect(result).toEqual({
        version: '1.0',
        response: { shouldEndSession: true },
      });
    });
  });

  it('still answers LaunchRequest with live conditions, unaffected by the skill-event branch', async () => {
    getCurrent.mockResolvedValue([]);

    const result = await service.handleRequest(
      envelope({
        type: 'LaunchRequest',
        requestId: 'req-3',
        timestamp: '2026-08-29T10:00:00Z',
        locale: 'fr-FR',
      }),
    );

    expect(result.response.outputSpeech).toBeDefined();
    expect(getCurrent).toHaveBeenCalledTimes(1);
  });
});
