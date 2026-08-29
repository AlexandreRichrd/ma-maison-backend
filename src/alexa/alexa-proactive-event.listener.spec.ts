import { ClimateAlertEvent } from '../climate/events/climate-alert.event';
import { AlexaLwaTokenService } from './alexa-lwa-token.service';
import { AlexaProactiveEventListener } from './alexa-proactive-event.listener';

jest.mock('./alexa-lwa-token.service');

describe('AlexaProactiveEventListener', () => {
  let tokenService: jest.Mocked<AlexaLwaTokenService>;
  let listener: AlexaProactiveEventListener;
  const firedAt = new Date('2026-08-29T10:00:00.000Z');
  const event = new ClimateAlertEvent('cool_down', 25.1, 18.4, firedAt);

  beforeEach(() => {
    tokenService =
      new AlexaLwaTokenService() as jest.Mocked<AlexaLwaTokenService>;
    tokenService.getAccessToken = jest.fn().mockResolvedValue('access-token');
    listener = new AlexaProactiveEventListener(tokenService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts the exact proactive event shape', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 202,
      text: () => Promise.resolve(''),
    });
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
          messageGroup: { creator: { name: 'Hearth' }, count: 1 },
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
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 202,
      text: () => Promise.resolve(''),
    });
    global.fetch = fetchMock;

    await listener.handleClimateAlert(event);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const { referenceId } = JSON.parse(options.body as string) as {
      referenceId: string;
    };
    expect(referenceId).toMatch(/^[A-Za-z0-9~]+$/);
  });

  it('produces a stable referenceId for the same event, different for a different firedAt', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 202,
      text: () => Promise.resolve(''),
    });
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
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('forbidden'),
    });

    await expect(listener.handleClimateAlert(event)).resolves.toBeUndefined();
  });
});
