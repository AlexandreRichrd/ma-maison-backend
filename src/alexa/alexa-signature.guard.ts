import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';

import { ApiError } from '../common/api-error';
import { verifyAlexaSignature } from './alexa-verifier.util';
import type { RequestEnvelope } from './types/alexa.types';

/**
 * Guards the inbound Alexa endpoint. Not a bearer token like DeviceAuthGuard
 * on /climate/measures — Amazon signs each request instead, so this
 * verifies that signature (cert-chain fetch/validate + RSA-SHA256 +
 * 150s timestamp tolerance, all via alexa-verifier — see CLAUDE.md's Alexa
 * section for why that package over hand-rolled crypto or the full
 * ask-sdk) against the *raw* request bytes, plus checks the request is
 * addressed to this specific skill (ALEXA_SKILL_ID) as defense-in-depth on
 * top of Amazon's own signature.
 */
@Injectable()
export class AlexaSignatureGuard implements CanActivate {
  private readonly logger = new Logger(AlexaSignatureGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skillId = process.env.ALEXA_SKILL_ID;
    if (!skillId) {
      throw new ApiError(500, 'server', 'alexa_skill_id_not_configured');
    }

    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<Request>>();
    const certChainUrl = request.headers['signaturecertchainurl'];
    const signature = request.headers['signature'];
    const rawBody = request.rawBody;

    if (
      typeof certChainUrl !== 'string' ||
      typeof signature !== 'string' ||
      !rawBody
    ) {
      throw new ApiError(401, 'authorization', 'invalid_alexa_signature');
    }

    try {
      await verifyAlexaSignature(
        certChainUrl,
        signature,
        rawBody.toString('utf8'),
      );
    } catch (error) {
      this.logger.warn(`alexa signature rejected: ${String(error)}`);
      throw new ApiError(401, 'authorization', 'invalid_alexa_signature');
    }

    const body = request.body as Partial<RequestEnvelope> | undefined;
    const applicationId = body?.context?.System?.application?.applicationId;
    if (applicationId !== skillId) {
      this.logger.warn(
        `alexa request for unexpected applicationId: ${String(applicationId)}`,
      );
      throw new ApiError(401, 'authorization', 'invalid_alexa_signature');
    }

    return true;
  }
}
