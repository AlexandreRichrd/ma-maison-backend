import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import type { ClimateAlertEvent } from '../climate/events/climate-alert.event';
import { AlexaLwaTokenService } from './alexa-lwa-token.service';

const PROACTIVE_EVENTS_URL =
  'https://api.eu.amazonalexa.com/v1/proactiveEvents/stages/development';

// "Open the windows now" is worthless an hour later — see the issue's own
// framing. Short enough that a stale notification doesn't sit in the
// queue, long enough that someone glancing at the Echo a few minutes later
// still sees it.
const EXPIRY_MS = 10 * 60_000;

const SKILL_LOCALE = 'fr-FR';

type ProactiveEventRequest = {
  timestamp: string;
  referenceId: string;
  expiryTime: string;
  event: {
    name: 'AMAZON.MessageAlert.Activated';
    payload: {
      state: { status: 'UNREAD'; freshness: 'NEW' };
      messageGroup: { creator: { name: string }; count: number };
    };
  };
  localizedAttributes: { locale: string }[];
  relevantAudience: { type: 'Multicast'; payload: Record<string, never> };
};

/**
 * The Alexa channel for 'climate.alert.triggered' (see
 * CLAUDE.md's Climate alerts section and Alexa section) — sends a silent
 * BROADCAST proactive event so the shared Echo's ring goes yellow. Never
 * sends the actual reading: that's read back on-demand by the inbound
 * skill endpoint (AlexaService). Failure here is caught and logged, never
 * rethrown — ClimateAlertMailListener's email must go out regardless of
 * whether this channel succeeds, same "one channel failing never loses the
 * alert" requirement that shapes that listener too.
 */
@Injectable()
export class AlexaProactiveEventListener {
  private readonly logger = new Logger(AlexaProactiveEventListener.name);

  constructor(private readonly lwaToken: AlexaLwaTokenService) {}

  @OnEvent('climate.alert.triggered')
  async handleClimateAlert(event: ClimateAlertEvent): Promise<void> {
    try {
      const accessToken = await this.lwaToken.getAccessToken();
      await this.sendProactiveEvent(accessToken, event);
    } catch (error) {
      this.logger.error('failed to send Alexa proactive event', error);
    }
  }

  private async sendProactiveEvent(
    accessToken: string,
    event: ClimateAlertEvent,
  ): Promise<void> {
    const body: ProactiveEventRequest = {
      timestamp: event.firedAt.toISOString(),
      // Stable across a retry of this same firing (not wall-clock time
      // observed here) — see ClimateAlertEvent.firedAt's own comment.
      referenceId: `climate-alert-${event.direction}-${event.firedAt.toISOString()}`,
      expiryTime: new Date(event.firedAt.getTime() + EXPIRY_MS).toISOString(),
      event: {
        name: 'AMAZON.MessageAlert.Activated',
        payload: {
          state: { status: 'UNREAD', freshness: 'NEW' },
          messageGroup: { creator: { name: 'Hearth' }, count: 1 },
        },
      },
      localizedAttributes: [{ locale: SKILL_LOCALE }],
      relevantAudience: { type: 'Multicast', payload: {} },
    };

    const response = await fetch(PROACTIVE_EVENTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `proactive event POST failed: ${response.status} ${text}`,
      );
    }
  }
}
