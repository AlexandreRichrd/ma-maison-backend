import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { parseCookie } from 'cookie';
import jwt from 'jsonwebtoken';
import type { Server, ServerOptions, Socket } from 'socket.io';

import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_TOKEN_COOKIE_NAME } from './access-token-cookie';
import { getJwtPublicKey } from './jwt-keys';
import type { JwtPayload } from './jwt.strategy';

/** Shape of `socket.data` for any socket that made it past this middleware. */
export type ClimateSocketData = { tokenExp: number };

/**
 * Authenticates the climate namespace's socket.io handshake with the same
 * RS256 JWT REST verifies (see JwtStrategy), read from the same
 * `access_token` cookie `web` now sets alongside its own `__session`
 * cookie — sent automatically since the socket connects same-origin (see
 * `web`'s vite.config.ts proxy in dev, Caddy's /api/* route in prod).
 *
 * This runs as socket.io namespace middleware (`namespace.use`), not a
 * Nest `@UseGuards` guard: a gateway's guards only run in front of
 * `@SubscribeMessage` handlers, by which point the connection has already
 * been accepted and `connect` has already fired on the client. Rejecting
 * here means an unauthenticated client never sees `connect` at all — it
 * gets `connect_error` instead.
 *
 * Also joins the socket to its household's room (`household:<id>`) here,
 * while the JWT `sub` is already at hand — one extra Prisma lookup per
 * connection (not per message), and the only way to resolve a household
 * from a payload that deliberately carries `sub` only (see JwtStrategy).
 */
export class WsAuthAdapter extends IoAdapter {
  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    const prisma = this.app.get(PrismaService);

    server.of('/climate').use((socket: Socket, next: (err?: Error) => void) => {
      void (async () => {
        const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
        const token = cookies[ACCESS_TOKEN_COOKIE_NAME];
        if (!token) {
          next(new Error('unauthenticated'));
          return;
        }

        let payload: JwtPayload & { exp: number };
        try {
          payload = jwt.verify(token, getJwtPublicKey(), {
            algorithms: ['RS256'],
          }) as JwtPayload & { exp: number };
        } catch {
          next(new Error('unauthenticated'));
          return;
        }

        const user = await prisma.user.findUnique({
          where: { id: payload.sub },
          select: { householdId: true },
        });
        if (!user) {
          next(new Error('unauthenticated'));
          return;
        }

        (socket.data as ClimateSocketData).tokenExp = payload.exp;
        void socket.join(`household:${user.householdId}`);
        next();
      })();
    });

    return server;
  }
}
