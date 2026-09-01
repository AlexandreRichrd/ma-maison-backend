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

// messageGroup.creator.name — read aloud as-is by whatever fr-FR rendering
// (if any) Amazon has for this event, so it's spelled for French
// pronunciation rather than as the skill's actual name ("Hearth" would be
// read with an English accent by a French TTS voice).
const NOTIFICATION_CREATOR_NAME = 'eurse';

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
      referenceId: buildReferenceId(event),
      expiryTime: new Date(event.firedAt.getTime() + EXPIRY_MS).toISOString(),
      event: {
        name: 'AMAZON.MessageAlert.Activated',
        payload: {
          state: { status: 'UNREAD', freshness: 'NEW' },
          messageGroup: {
            creator: { name: NOTIFICATION_CREATOR_NAME },
            count: 1,
          },
        },
      },
      localizedAttributes: [{ locale: SKILL_LOCALE }],
      relevantAudience: { type: 'Multicast', payload: {} },
    };
    const requestBody = JSON.stringify(body);

    const response = await fetch(PROACTIVE_EVENTS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: requestBody,
    });

    const responseBody = await response.text().catch(() => '');
    const responseHeaders = Object.fromEntries(response.headers.entries());
    const statusNote =
      response.status === 202
        ? '202 accepted for processing — not a delivery confirmation'
        : `responded ${response.status}`;

    // Permanent, not scaffolding — see CLAUDE.md's Alexa section. This API
    // has no delivery-confirmation signal at all (no webhook, no polling
    // endpoint): a 202 means Amazon accepted the event for async
    // processing, nothing more. It can still be discarded downstream with
    // no further signal to us, so "sent" was misleading — logged here
    // whether or not the POST ultimately succeeds, since diagnosing a
    // silent non-delivery needs the exact request Amazon received compared
    // against its reference, not just a pass/fail boolean. No secrets:
    // the access token lives only in the Authorization header, which is
    // never included here.
    this.logger.log(
      `Alexa proactive event ${statusNote} — url=${PROACTIVE_EVENTS_URL} ` +
        `request=${requestBody} responseHeaders=${JSON.stringify(responseHeaders)} ` +
        `responseBody=${responseBody}`,
    );

    if (!response.ok) {
      throw new Error(
        `proactive event POST failed: ${response.status} ${responseBody}`,
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
