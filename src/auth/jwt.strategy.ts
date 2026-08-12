import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export type JwtPayload = { sub: string };

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set');
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
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
