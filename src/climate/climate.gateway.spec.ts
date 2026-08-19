import type { Socket } from 'socket.io';

import type { ClimateSocketData } from '../auth/ws-auth.adapter';
import type { PrismaService } from '../prisma/prisma.service';
import { ClimateGateway } from './climate.gateway';

// disconnect is kept as its own local, not read back off `client`, so
// assertions never touch a Socket-typed method property (which trips
// @typescript-eslint/unbound-method even when the runtime value is a mock).
function fakeSocket(tokenExp: number): {
  client: Socket;
  disconnect: jest.Mock;
} {
  const disconnect = jest.fn();
  const data: ClimateSocketData = { tokenExp };
  const client = { id: 'socket-1', data, disconnect } as unknown as Socket;
  return { client, disconnect };
}

describe('ClimateGateway', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('handleConnection', () => {
    // Node's setTimeout delay is a 32-bit signed int (max ~24.8 days) —
    // JWT_EXPIRES_IN defaults to 30 days (see CLAUDE.md's Authentication
    // section), so a naive single setTimeout(msUntilExpiry) overflows and
    // fires almost immediately instead of ~30 days out. This is the exact
    // bug caught by testing against a real 30-day token rather than a
    // short one: every socket was disconnecting within ~1ms of connecting.
    it('does not disconnect a 30-day-lived token within the first day', () => {
      const gateway = new ClimateGateway({} as PrismaService);
      const tokenExp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      const { client, disconnect } = fakeSocket(tokenExp);

      gateway.handleConnection(client);
      jest.advanceTimersByTime(24 * 60 * 60 * 1000);

      expect(disconnect).not.toHaveBeenCalled();
    });

    it('disconnects once a 30-day-lived token actually expires, across chained timers', () => {
      const gateway = new ClimateGateway({} as PrismaService);
      const tokenExp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      const { client, disconnect } = fakeSocket(tokenExp);

      gateway.handleConnection(client);
      jest.advanceTimersByTime(30 * 24 * 60 * 60 * 1000 + 1000);

      expect(disconnect).toHaveBeenCalledWith(true);
    });

    it('disconnects a short-lived token at roughly its real expiry', () => {
      const gateway = new ClimateGateway({} as PrismaService);
      const tokenExp = Math.floor(Date.now() / 1000) + 8;
      const { client, disconnect } = fakeSocket(tokenExp);

      gateway.handleConnection(client);

      jest.advanceTimersByTime(7000);
      expect(disconnect).not.toHaveBeenCalled();

      jest.advanceTimersByTime(2000);
      expect(disconnect).toHaveBeenCalledWith(true);
    });

    it('does not disconnect an already-cancelled timer after handleDisconnect', () => {
      const gateway = new ClimateGateway({} as PrismaService);
      const tokenExp = Math.floor(Date.now() / 1000) + 8;
      const { client, disconnect } = fakeSocket(tokenExp);

      gateway.handleConnection(client);
      gateway.handleDisconnect(client);
      jest.advanceTimersByTime(10000);

      expect(disconnect).not.toHaveBeenCalled();
    });
  });
});
