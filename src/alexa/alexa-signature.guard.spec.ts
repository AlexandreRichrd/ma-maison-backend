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
      signature: 'c2lnbmF0dXJl',
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
});
