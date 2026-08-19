import { OnEvent } from '@nestjs/event-emitter';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

import type { ClimateSocketData } from '../auth/ws-auth.adapter';
import { PrismaService } from '../prisma/prisma.service';
import { selectBroadcast } from './broadcast-selection';
import type { MeasuresIngestedEvent } from './events/measures-ingested.event';

// Node's setTimeout delay is a 32-bit signed int internally — see
// scheduleExpiryDisconnect's comment.
const MAX_SET_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Pushes live climate readings to the dashboard widget. No dependency on
 * ClimateService or the ingestion controller — it only reacts to
 * `climate.measures.ingested`, emitted after a batch is durably persisted
 * (see MeasuresIngestedEvent). Handshake auth is WsAuthAdapter, not a
 * guard here — see that file for why, and for where the socket's
 * `household:<id>` room membership is set up.
 */
@WebSocketGateway({ namespace: 'climate' })
export class ClimateGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() private readonly server!: Server;

  // Single process, no horizontal scaling (see CLAUDE.md's "no scale
  // problem to solve yet") — in-memory state is fine. Resets on restart,
  // which just means the first batch afterward always broadcasts, since
  // there's nothing yet to compare it against.
  private lastBroadcastAt: Date | null = null;

  // Measures carry no household reference of their own (single-household
  // app, see CLAUDE.md) — resolved once and reused rather than queried on
  // every broadcast. The household this app manages never changes once
  // bootstrapped (see bootstrap-household.ts's refuse-if-one-exists
  // guard), so caching it for the process lifetime is safe.
  private householdId: string | null = null;

  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly prisma: PrismaService) {}

  // socket.io only authenticates at handshake (WsAuthAdapter) — a
  // connection otherwise stays open indefinitely after its token expires.
  // Disconnect it once that happens. client.disconnect(true) is a
  // server-initiated close, which socket.io-client reports client-side as
  // reason "io server disconnect" — a reason it deliberately does NOT
  // auto-reconnect from (by design: see Socket.ondisconnect() in
  // socket.io-client's source). my-home's climate-socket.client.ts
  // specifically branches on that reason to force a loader revalidation
  // instead, which is what actually gets the user back to a working state
  // (a fresh login) since the same expired cookie would just be rejected
  // again on any retry. This handler is the only thing that calls
  // socket.disconnect(true) today — if that ever changes, whatever else
  // calls it will hit the same client-side branch and log the user out.
  handleConnection(client: Socket) {
    const { tokenExp } = client.data as ClimateSocketData;
    this.scheduleExpiryDisconnect(client, tokenExp);
  }

  // setTimeout's delay is a 32-bit signed int — anything past ~24.8 days
  // silently overflows and fires almost immediately instead (Node logs a
  // TimeoutOverflowWarning and clamps it to 1ms). JWT_EXPIRES_IN defaults
  // to 30 days (see my-home-backend/CLAUDE.md's Authentication section),
  // so a naive single setTimeout(msUntilExpiry) disconnected every socket
  // within ~1ms of connecting whenever that default was in play — caught
  // by testing against a real 30-day-lived token, not the short TTLs a
  // faster manual test reaches for. Chains timers under the cap instead,
  // recomputing the remainder from the wall clock each hop so drift
  // across days-long chains doesn't accumulate.
  private scheduleExpiryDisconnect(client: Socket, tokenExp: number) {
    const msUntilExpiry = tokenExp * 1000 - Date.now();
    const delay = Math.min(Math.max(msUntilExpiry, 0), MAX_SET_TIMEOUT_MS);
    this.expiryTimers.set(
      client.id,
      setTimeout(() => {
        if (msUntilExpiry > MAX_SET_TIMEOUT_MS) {
          this.scheduleExpiryDisconnect(client, tokenExp);
        } else {
          client.disconnect(true);
        }
      }, delay),
    );
  }

  handleDisconnect(client: Socket) {
    const timer = this.expiryTimers.get(client.id);
    if (timer) {
      clearTimeout(timer);
      this.expiryTimers.delete(client.id);
    }
  }

  @OnEvent('climate.measures.ingested')
  async handleMeasuresIngested(event: MeasuresIngestedEvent): Promise<void> {
    const selection = selectBroadcast(event.measures, this.lastBroadcastAt);
    if (!selection) return;
    this.lastBroadcastAt = selection.lastBroadcastAt;

    this.householdId ??= (await this.prisma.household.findFirstOrThrow()).id;
    this.server
      .to(`household:${this.householdId}`)
      .emit('measurement', selection.measures);
  }
}
