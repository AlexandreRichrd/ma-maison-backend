import { AlexaLwaTokenService } from './alexa-lwa-token.service';

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  return jest.fn().mockResolvedValueOnce({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
}

describe('AlexaLwaTokenService', () => {
  const OLD_ENV = process.env;
  let service: AlexaLwaTokenService;

  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      ALEXA_LWA_CLIENT_ID: 'client-id',
      ALEXA_LWA_CLIENT_SECRET: 'client-secret',
    };
    service = new AlexaLwaTokenService();
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('throws when the LWA client credentials are not configured', async () => {
    delete process.env.ALEXA_LWA_CLIENT_ID;
    await expect(service.getAccessToken()).rejects.toThrow(
      /ALEXA_LWA_CLIENT_ID/,
    );
  });

  it('requests a token with the client_credentials grant', async () => {
    const fetchMock = mockFetchOnce({
      access_token: 'token-1',
      token_type: 'bearer',
      expires_in: 3600,
    });
    global.fetch = fetchMock;

    const token = await service.getAccessToken();

    expect(token).toBe('token-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.amazon.com/auth/o2/token',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        },
      }),
    );
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = options.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('client_id')).toBe('client-id');
    expect(body.get('client_secret')).toBe('client-secret');
    expect(body.get('scope')).toBe('alexa::proactive_events');
  });

  it('reuses the cached token within its expiry window', async () => {
    const fetchMock = mockFetchOnce({
      access_token: 'token-1',
      token_type: 'bearer',
      expires_in: 3600,
    });
    global.fetch = fetchMock;

    await service.getAccessToken();
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000 + 60_000);
    const token = await service.getAccessToken();

    expect(token).toBe('token-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches once inside the refresh buffer before actual expiry', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'token-1',
            token_type: 'bearer',
            expires_in: 3600,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: 'token-2',
            token_type: 'bearer',
            expires_in: 3600,
          }),
      });
    global.fetch = fetchMock;

    await service.getAccessToken();
    // 3600s later minus less than the 60s refresh buffer => still "expired"
    // for our purposes.
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000 + 3600_000 - 1_000);
    const token = await service.getAccessToken();

    expect(token).toBe('token-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws on a non-OK LWA response', async () => {
    global.fetch = mockFetchOnce({}, false, 401);
    await expect(service.getAccessToken()).rejects.toThrow(/401/);
  });
});
