import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { ApiError } from '../common/api-error';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { JwtPayload } from './jwt.strategy';

/** Registered as APP_GUARD — every route requires a valid Bearer token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  // Passport's default failure is a bare UnauthorizedException — replace it
  // so a missing/invalid/expired token gets the same {field, code} shape as
  // every other rejection, instead of falling through the exception
  // filter's generic fallback.
  handleRequest<TUser = JwtPayload>(err: unknown, user: TUser | false): TUser {
    if (err || !user) {
      throw new ApiError(401, 'authorization', 'unauthenticated');
    }
    return user;
  }
}
