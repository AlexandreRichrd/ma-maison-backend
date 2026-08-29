import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { ApiError } from '../common/api-error';
import { AlexaSignatureGuard } from './alexa-signature.guard';
import { verifyAlexaSignature } from './alexa-verifier.util';

jest.mock('./alexa-verifier.util');

const mockVerify = verifyAlexaSignature as jest.MockedFunction<
  typeof verifyAlexaSignature
>;

function contextFor(
  request: Partial<Request> & { rawBody?: Buffer },
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

const VALID_BODY = {
  context: {
    System: { application: { applicationId: 'amzn1.ask.skill.expected' } },
  },
};

function requestWith(overrides: Partial<Request> & { rawBody?: Buffer } = {}) {
  return {
    headers: {
      signaturecertchainurl: 'https://s3.amazonaws.com/echo.api/cert.pem',
      // Amazon's current spec (see CLAUDE.md's Alexa section): Signature-256
      // is the SHA-256-signed value alexa-verifier's RSA-SHA256 check
      // expects. The legacy Signature header (SHA-1) is a real, previously
      // shipped bug here — see the dedicated regression test below.
      'signature-256': 'c2lnbmF0dXJl',
    },
    rawBody: Buffer.from(JSON.stringify(VALID_BODY)),
    body: VALID_BODY,
    ...overrides,
  };
}

describe('AlexaSignatureGuard', () => {
  const OLD_ENV = process.env;
  let guard: AlexaSignatureGuard;

  beforeEach(() => {
    process.env = { ...OLD_ENV, ALEXA_SKILL_ID: 'amzn1.ask.skill.expected' };
    guard = new AlexaSignatureGuard();
    mockVerify.mockReset();
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('throws a 500 ApiError when ALEXA_SKILL_ID is not configured', async () => {
    delete process.env.ALEXA_SKILL_ID;
    const promise = guard.canActivate(contextFor(requestWith()));
    await expect(promise).rejects.toThrow(ApiError);
    await expect(promise).rejects.toMatchObject({
      response: { code: 'alexa_skill_id_not_configured' },
    });
  });

  it('rejects a request missing the signature headers', async () => {
    await expect(
      guard.canActivate(contextFor(requestWith({ headers: {} }))),
    ).rejects.toThrow(ApiError);
  });

  // Regression test: a real deployed build read the legacy SHA-1
  // `Signature` header and fed it to alexa-verifier's RSA-SHA256 check —
  // every genuine Amazon-signed request failed identically ("invalid
  // signature"), since that pairing can never verify cryptographically
  // regardless of a mocked verifier. A mock can't reproduce the crypto
  // failure itself, but it CAN pin the header-name contract: this fails if
  // the guard ever reads back `signature` instead of `signature-256`.
  it('never reads the legacy Signature header, only Signature-256', async () => {
    mockVerify.mockResolvedValue(undefined);
    const legacyOnly = contextFor(
      requestWith({
        headers: {
          signaturecertchainurl: 'https://s3.amazonaws.com/echo.api/cert.pem',
          signature: 'legacy-sha1-value',
        } as unknown as Request['headers'],
      }),
    );

    await expect(guard.canActivate(legacyOnly)).rejects.toThrow(ApiError);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('rejects a request with no raw body', async () => {
    await expect(
      guard.canActivate(contextFor(requestWith({ rawBody: undefined }))),
    ).rejects.toThrow(ApiError);
  });

  it('rejects when signature verification fails', async () => {
    mockVerify.mockRejectedValue(new Error('invalid signature'));
    await expect(guard.canActivate(contextFor(requestWith()))).rejects.toThrow(
      ApiError,
    );
  });

  it('rejects when the applicationId does not match ALEXA_SKILL_ID', async () => {
    mockVerify.mockResolvedValue(undefined);
    const mismatched = {
      context: {
        System: { application: { applicationId: 'amzn1.ask.skill.other' } },
      },
    };
    await expect(
      guard.canActivate(contextFor(requestWith({ body: mismatched }))),
    ).rejects.toThrow(ApiError);
  });

  it('passes when the signature and applicationId are both valid', async () => {
    mockVerify.mockResolvedValue(undefined);
    await expect(guard.canActivate(contextFor(requestWith()))).resolves.toBe(
      true,
    );
    expect(mockVerify).toHaveBeenCalledWith(
      'https://s3.amazonaws.com/echo.api/cert.pem',
      'c2lnbmF0dXJl',
      JSON.stringify(VALID_BODY),
    );
  });

  // #14's manifest now declares events.endpoint (see CLAUDE.md's Alexa
  // section), so skill events (AlexaSkillEvent.*) arrive at this same
  // endpoint with a different `request` shape than LaunchRequest/
  // IntentRequest — checked here rather than assumed: applicationId lives
  // at the same context.System.application.applicationId path regardless
  // of what `request` contains, so this guard needed no change. If that
  // ever stopped being true, every skill event would 401 with nobody
  // talking to the Echo to notice.
  it('accepts a skill-event envelope the same way as any other request shape', async () => {
    mockVerify.mockResolvedValue(undefined);
    const skillEventBody = {
      context: {
        System: { application: { applicationId: 'amzn1.ask.skill.expected' } },
      },
      request: {
        type: 'AlexaSkillEvent.ProactiveSubscriptionChanged',
        requestId: 'req-1',
        timestamp: '2026-08-29T10:00:00Z',
      },
    };

    await expect(
      guard.canActivate(
        contextFor(
          requestWith({
            rawBody: Buffer.from(JSON.stringify(skillEventBody)),
            body: skillEventBody,
          }),
        ),
      ),
    ).resolves.toBe(true);
  });
});
