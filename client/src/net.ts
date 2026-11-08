import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../../shared/protocol';

export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Same-origin connection: the Express server serves both the page and Socket.IO. */
export function connect(): ClientSocket {
  return io({ reconnectionDelay: 500, reconnectionDelayMax: 2000 });
}

// sessionStorage (not localStorage) so two tabs on one machine can be two different players.
const TOKEN_KEY = 'mm.token';
const NAME_KEY = 'mm.name';

export const session = {
  get token(): string | null {
    return sessionStorage.getItem(TOKEN_KEY);
  },
  set token(v: string | null) {
    if (v) sessionStorage.setItem(TOKEN_KEY, v);
    else sessionStorage.removeItem(TOKEN_KEY);
  },
  get name(): string {
    return localStorage.getItem(NAME_KEY) ?? '';
  },
  set name(v: string) {
    localStorage.setItem(NAME_KEY, v);
  },
};
