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
  // Disconnect it once that happens; the client's automatic reconnection
  // redoes the handshake with whatever cookie it has by then.
  handleConnection(client: Socket) {
    const { tokenExp } = client.data as ClimateSocketData;
    const msUntilExpiry = tokenExp * 1000 - Date.now();
    this.expiryTimers.set(
      client.id,
      setTimeout(() => client.disconnect(true), Math.max(msUntilExpiry, 0)),
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
