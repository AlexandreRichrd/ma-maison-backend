import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import type { ClimateAlertEvent } from '../climate/events/climate-alert.event';
import { AlexaLwaTokenService } from './alexa-lwa-token.service';

const PROACTIVE_EVENTS_URL =
  'https://api.eu.amazonalexa.com/v1/proactiveEvents/stages/development';

// "Open the windows now" is worthless an hour later — see the issue's own
// framing. Amazon's Proactive Events API reference caps expiryTime to
// 5 minutes-24 hours from timestamp (a 400 outside that range); 10 minutes
// is comfortably inside that floor while still short enough that a stale
// alert doesn't sit in the queue.
const EXPIRY_MS = 10 * 60_000;

// Also declared in localizedAttributes below (required on every proactive
// event request regardless of event type, even though
// AMAZON.MessageAlert.Activated's own payload has no locale-specific
// strings — see CLAUDE.md's Alexa section). NOT the same as a guarantee
// that Amazon actually has an AMAZON.MessageAlert.Activated notification
// template in French: that isn't documented one way or the other, and
// this codebase has no way to confirm it short of a live device test —
// see CLAUDE.md's Alexa section for that open risk.
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
      this.logger.log(`sent Alexa proactive event (${event.direction})`);
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
      referenceId: buildReferenceId(event),
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

// referenceId must be alphanumeric-plus-tilde only, per Amazon's Proactive
// Events API reference — a hyphen, colon, period, or underscore anywhere in
// it (all present in the direction string and an ISO timestamp) makes
// every request a 400. Stripping down to [A-Za-z0-9~] keeps the same
// stability/uniqueness properties (pure function of direction + firedAt:
// same firing -> same id, different firing -> different id) without
// relying on any particular separator surviving.
function buildReferenceId(event: ClimateAlertEvent): string {
  return `climateAlert${event.direction}${event.firedAt.toISOString()}`.replace(
    /[^A-Za-z0-9~]/g,
    '',
  );
}
