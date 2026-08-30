import { Logger } from '@nestjs/common';

import { ClimateAlertEvent } from '../climate/events/climate-alert.event';
import { AlexaLwaTokenService } from './alexa-lwa-token.service';
import { AlexaProactiveEventListener } from './alexa-proactive-event.listener';

jest.mock('./alexa-lwa-token.service');

// Real Response objects always have a real Headers instance — only test
// mocks can omit it, and doing so would silently mask whether the
// diagnostic logging (which reads response.headers.entries()) actually
// works. Every mocked response below carries one.
function fakeResponse(
  status: number,
  body: string,
  headers: Record<string, string> = { 'x-amzn-requestid': 'req-abc' },
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: () => Promise.resolve(body),
  };
}

describe('AlexaProactiveEventListener', () => {
  let tokenService: jest.Mocked<AlexaLwaTokenService>;
  let listener: AlexaProactiveEventListener;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  const firedAt = new Date('2026-08-29T10:00:00.000Z');
  const event = new ClimateAlertEvent('cool_down', 25.1, 18.4, firedAt);

  beforeEach(() => {
    tokenService =
      new AlexaLwaTokenService() as jest.Mocked<AlexaLwaTokenService>;
    tokenService.getAccessToken = jest.fn().mockResolvedValue('access-token');
    listener = new AlexaProactiveEventListener(tokenService);
    // Spying on Logger.prototype rather than reaching into the listener's
    // private `logger` field — every Logger instance shares these
    // prototype methods, so this needs no `any` cast to a private member.
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts the exact proactive event shape', async () => {
    const fetchMock = jest.fn().mockResolvedValue(fakeResponse(202, ''));
    global.fetch = fetchMock;

    await listener.handleClimateAlert(event);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.eu.amazonalexa.com/v1/proactiveEvents/stages/development',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer access-token',
          'Content-Type': 'application/json',
        },
      }),
    );
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      timestamp: '2026-08-29T10:00:00.000Z',
      referenceId: 'climateAlertcooldown20260829T100000000Z',
      expiryTime: '2026-08-29T10:10:00.000Z',
      event: {
        name: 'AMAZON.MessageAlert.Activated',
        payload: {
          state: { status: 'UNREAD', freshness: 'NEW' },
          messageGroup: { creator: { name: 'eurse' }, count: 1 },
        },
      },
      localizedAttributes: [{ locale: 'fr-FR' }],
      relevantAudience: { type: 'Multicast', payload: {} },
    });
  });

  // Regression test: referenceId originally included the raw direction
  // string and an ISO timestamp joined with hyphens, which put `-`, `:`,
  // and `.` into the field — Amazon's Proactive Events API reference
  // restricts referenceId to alphanumeric characters and `~` only, so
  // every real send would have been rejected with a 400 despite every
  // other test here passing (they mock the verifier/fetch and never
  // checked the character set).
  it('builds a referenceId using only alphanumeric characters and ~', async () => {
    global.fetch = jest.fn().mockResolvedValue(fakeResponse(202, ''));

    await listener.handleClimateAlert(event);

    const fetchMock = global.fetch as jest.Mock;
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const { referenceId } = JSON.parse(options.body as string) as {
      referenceId: string;
    };
    expect(referenceId).toMatch(/^[A-Za-z0-9~]+$/);
  });

  it('produces a stable referenceId for the same event, different for a different firedAt', async () => {
    const fetchMock = jest.fn().mockResolvedValue(fakeResponse(202, ''));
    global.fetch = fetchMock;

    await listener.handleClimateAlert(event);
    await listener.handleClimateAlert(event);
    const laterEvent = new ClimateAlertEvent(
      'cool_down',
      25.1,
      18.4,
      new Date('2026-08-29T11:00:00.000Z'),
    );
    await listener.handleClimateAlert(laterEvent);

    const calls = fetchMock.mock.calls as [string, RequestInit][];
    const referenceIds = calls.map(([, options]) => {
      return (JSON.parse(options.body as string) as { referenceId: string })
        .referenceId;
    });
    expect(referenceIds[0]).toBe(referenceIds[1]);
    expect(referenceIds[2]).not.toBe(referenceIds[0]);
  });

  it('logs and does not throw when the token service fails', async () => {
    tokenService.getAccessToken = jest
      .fn()
      .mockRejectedValue(new Error('LWA down'));
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    await expect(listener.handleClimateAlert(event)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs and does not throw when the proactive event POST fails', async () => {
    global.fetch = jest.fn().mockResolvedValue(fakeResponse(403, 'forbidden'));

    await expect(listener.handleClimateAlert(event)).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  // The diagnostic logging is the point of this change: a 202 from this
  // API means "accepted for processing", never "delivered" (no webhook,
  // no polling endpoint exists to confirm actual delivery — see CLAUDE.md's
  // Alexa section). The log line must say so, and must carry enough to
  // compare against Amazon's reference by hand: url, full request body,
  // response status, response headers, response body. Never the access
  // token.
  describe('diagnostic logging', () => {
    it('logs the request/response detail and says 202 is not a delivery guarantee', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(
          fakeResponse(202, '', { 'x-amzn-requestid': 'req-xyz' }),
        );

      await listener.handleClimateAlert(event);

      expect(logSpy).toHaveBeenCalledTimes(1);
      const [message] = logSpy.mock.calls[0] as [string];
      expect(message).toContain('202');
      expect(message).toContain('not a delivery confirmation');
      expect(message).toContain(
        'https://api.eu.amazonalexa.com/v1/proactiveEvents/stages/development',
      );
      expect(message).toContain('AMAZON.MessageAlert.Activated');
      expect(message).toContain('req-xyz');
      expect(message).not.toContain('access-token');
    });

    it('logs a plain status note for a non-202 response, e.g. 200', async () => {
      global.fetch = jest.fn().mockResolvedValue(fakeResponse(200, 'ok'));

      await listener.handleClimateAlert(event);

      const [message] = logSpy.mock.calls[0] as [string];
      expect(message).toContain('responded 200');
      expect(message).not.toContain('not a delivery confirmation');
    });

    it('still logs the full diagnostic detail even when the POST fails', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(fakeResponse(403, 'forbidden'));

      await listener.handleClimateAlert(event);

      const [message] = logSpy.mock.calls[0] as [string];
      expect(message).toContain('responded 403');
      expect(message).toContain('forbidden');
      expect(message).not.toContain('access-token');
    });
  });
});
