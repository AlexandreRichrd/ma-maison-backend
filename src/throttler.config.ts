import type { ThrottlerOptions } from '@nestjs/throttler';

import { normalizeEmail } from './auth/normalize-email.util';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Four independent named throttlers, each with its own tracker — not one
 * combined "ip+identifier" key. The old rate-limit.server.ts blocked on
 * *either* an IP counter or an identifier counter tripping; a combined key
 * would let an attacker rotating IPs against one email (or spraying emails
 * from one IP) slip through. Each pair is applied together via
 * @UseGuards(ThrottlerGuard) + @SkipThrottle() on its own route in
 * auth.controller.ts / invites.controller.ts.
 */
export const throttlerConfig: ThrottlerOptions[] = [
  {
    name: 'login-ip',
    ttl: FIFTEEN_MINUTES_MS,
    limit: 5,
    // default tracker (req.ip)
  },
  {
    name: 'login-identifier',
    ttl: FIFTEEN_MINUTES_MS,
    limit: 5,
    getTracker: (req: Record<string, unknown>) => {
      const body = req.body as Record<string, unknown> | undefined;
      const email = typeof body?.email === 'string' ? body.email : 'unknown';
      return normalizeEmail(email);
    },
  },
  {
    name: 'invite-ip',
    ttl: ONE_HOUR_MS,
    limit: 5,
    // default tracker (req.ip)
  },
  {
    name: 'invite-user',
    ttl: ONE_HOUR_MS,
    limit: 5,
    getTracker: (req: Record<string, unknown>) => {
      const user = req.user as { sub?: string } | undefined;
      return user?.sub ?? 'anonymous';
    },
  },
];
