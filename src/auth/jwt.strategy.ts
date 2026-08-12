import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { ACCESS_TOKEN_COOKIE_NAME } from './access-token-cookie';

export type JwtPayload = { sub: string };

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set');
}

function cookieExtractor(req: Request): string | null {
  const cookies = req.cookies as Record<string, string> | undefined;
  return cookies?.[ACCESS_TOKEN_COOKIE_NAME] ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      // Header takes precedence over the cookie — a future mobile client
      // sends a header, the web app relies on the cookie.
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        cookieExtractor,
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET as string,
    });
  }

  // Return value becomes req.user. Payload only ever carries `sub` — no
  // roles/permissions, this app has no authorization system beyond
  // "signed in" (see CLAUDE.md).
  validate(payload: JwtPayload): JwtPayload {
    return payload;
  }
}
