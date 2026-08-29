import { Injectable } from '@nestjs/common';

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const PROACTIVE_EVENTS_SCOPE = 'alexa::proactive_events';

// Refresh this long before the token actually expires — a cached token
// that's still "valid" but expires mid-flight would otherwise fail the
// proactive-event POST with no chance to retry within the same call.
const REFRESH_BUFFER_MS = 60_000;

type LwaTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

/**
 * Obtains and caches an LWA (Login with Amazon) access token scoped to
 * alexa::proactive_events, via the client_credentials grant — see
 * CLAUDE.md's Alexa section for the exact request/response shape, verified
 * against Amazon's docs before writing this (the client_id/client_secret
 * here are the skill's OAuth credentials for outbound API calls, distinct
 * from ALEXA_SKILL_ID, which is the application id AlexaSignatureGuard
 * checks on inbound requests).
 *
 * In-memory cache only — single process, no scale problem to solve yet,
 * same reasoning as ClimateGateway/ClimateAlertTriggerService's own
 * in-memory state. Resets on restart, which just means one extra token
 * request after a deploy.
 */
@Injectable()
export class AlexaLwaTokenService {
  private cached: CachedToken | null = null;

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt - REFRESH_BUFFER_MS > now) {
      return this.cached.accessToken;
    }

    const clientId = process.env.ALEXA_LWA_CLIENT_ID;
    const clientSecret = process.env.ALEXA_LWA_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error(
        'ALEXA_LWA_CLIENT_ID/ALEXA_LWA_CLIENT_SECRET not configured',
      );
    }

    const response = await fetch(LWA_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: PROACTIVE_EVENTS_SCOPE,
      }),
    });

    if (!response.ok) {
      throw new Error(`LWA token request failed: ${response.status}`);
    }

    const body = (await response.json()) as LwaTokenResponse;
    this.cached = {
      accessToken: body.access_token,
      expiresAt: now + body.expires_in * 1000,
    };
    return this.cached.accessToken;
  }
}
