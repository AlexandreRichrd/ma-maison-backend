import { timingSafeEqual } from 'node:crypto';

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { ApiError } from '../common/api-error';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on mismatched lengths rather than returning
  // false, so unequal-length tokens must be rejected before the call.
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Guards device-facing ingestion routes with a single static bearer token
 * (CLIMATE_INGEST_TOKEN), not user JWT auth — the caller is the household's
 * Pi bridge (see intranet's pi/), not a signed-in person. Applied per-route
 * via @UseGuards alongside @Public() (which only opts out of the global
 * JwtAuthGuard, not this one).
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.CLIMATE_INGEST_TOKEN;
    if (!expected) {
      throw new ApiError(500, 'server', 'ingest_token_not_configured');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!token || !safeEqual(token, expected)) {
      throw new ApiError(401, 'authorization', 'unauthenticated');
    }

    return true;
  }
}
