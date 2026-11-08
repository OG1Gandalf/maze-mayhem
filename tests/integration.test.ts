import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { createAppServer, type AppServer } from '../server/app';
import type { ClientToServerEvents, GameOverMsg, JoinResult, LobbyState, ServerToClientEvents, StateMsg } from '../shared/protocol';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: AppServer;
let url: string;
const clients: Client[] = [];

beforeEach(async () => {
  server = createAppServer({ rooms: { countdownStepMs: 20, graceMs: 300, tickMs: 20 } });
  const port = await server.listen(0, '127.0.0.1');
  url = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  clients.splice(0).forEach((c) => c.disconnect());
  await server.close();
});

function client(): Promise<Client> {
  const c: Client = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  clients.push(c);
  return new Promise((resolve) => c.on('connect', () => resolve(c)));
}

function once<E extends keyof ServerToClientEvents>(c: Client, event: E, pred: (...a: Parameters<ServerToClientEvents[E]>) => boolean = () => true) {
  return new Promise<Parameters<ServerToClientEvents[E]>[0]>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), 3000);
    const handler = ((...args: Parameters<ServerToClientEvents[E]>) => {
      if (!pred(...args)) return;
      clearTimeout(timer);
      c.off(event, handler as never);
      resolve(args[0]);
    }) as never;
    c.on(event, handler);
  });
}

const create = (c: Client, name: string) => new Promise<JoinResult>((r) => c.emit('room:create', { name }, r));
const join = (c: Client, name: string, code: string) => new Promise<JoinResult>((r) => c.emit('room:join', { name, code }, r));

async function startGame() {
  const a = await client();
  const b = await client();
  const ra = await create(a, '  <Alice>  the very long name ');
  if (!ra.ok) throw new Error(ra.error);
  const rb = await join(b, 'Bob', ra.code.toLowerCase());
  if (!rb.ok) throw new Error(rb.error);
  const go = Promise.all([once(a, 'game:countdown', (n) => n === 0), once(b, 'game:countdown', (n) => n === 0)]);
  const initA = once(a, 'game:init');
  a.emit('lobby:ready', true);
  b.emit('lobby:ready', true);
  const init = await initA;
  await go;
  return { a, b, ra, rb, init };
}

describe('socket protocol', () => {
  it('creates a 4-letter room, sanitizes names, and rejects bad joins', async () => {
    const a = await client();
    const lobby = once(a, 'lobby:state');
    const r = await create(a, '  <Alice>  the very long name ');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.code).toMatch(/^[A-Z]{4}$/);
    const s = (await lobby) as LobbyState;
    expect(s.players[0]?.name).toBe('Alice the very l');
    expect(s.players[0]!.name.length).toBeLessThanOrEqual(16);

    const b = await client();
    expect(await join(b, 'Bob', 'ZZZZ')).toMatchObject({ ok: false });
    expect(await join(b, 'Bob', r.code)).toMatchObject({ ok: true, slot: 1 });
    const c = await client();
    expect(await join(c, 'Carol', r.code)).toEqual({ ok: false, error: 'Room is full' });
  });

  it('ready -> countdown -> game with the same maze for both players and authoritative moves', async () => {
    const { a, b, init } = await startGame();
    const initB = init.you === 0 ? null : init;
    expect(initB).toBeNull();
    const stateA = (await once(a, 'game:state', (s) => s.phase === 'playing')) as StateMsg;
    expect(stateA.me).toMatchObject({ x: 0, y: 0, hp: 10, coins: 100 });
    const stateB = (await once(b, 'game:state', (s) => s.phase === 'playing')) as StateMsg;
    expect(stateB.me).toMatchObject({ x: 20, y: 20 });

    const open = (['right', 'down'] as const).find((d) => !(init.maze.cells[0] & (d === 'right' ? 2 : 4)))!;
    a.emit('input:move', open);
    const moved = (await once(a, 'game:state', (s) => s.me.x + s.me.y === 1)) as StateMsg;
    expect(moved.me.facing).toBe(open);
  });

  it('disconnecting forfeits after the grace period', async () => {
    const { a, b } = await startGame();
    const over = once(a, 'game:over');
    b.disconnect();
    const o = (await over) as GameOverMsg;
    expect(o).toMatchObject({ winner: 0, reason: 'forfeit' });
  });

  it('reconnecting within the grace period resumes the game', async () => {
    const { a, b, rb } = await startGame();
    if (!rb.ok) throw new Error();
    let forfeited = false;
    a.on('game:over', () => (forfeited = true));
    b.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    const b2 = await client();
    const init = once(b2, 'game:init');
    const ok = await new Promise<{ ok: boolean }>((r) => b2.emit('room:resume', { token: rb.token }, r));
    expect(ok.ok).toBe(true);
    expect((await init).you).toBe(1);
    await new Promise((r) => setTimeout(r, 400));
    expect(forfeited).toBe(false);
  });

  it('rematch from both players starts a new game with a new maze', async () => {
    const { a, b, init } = await startGame();
    const overA = once(a, 'game:over');
    const lobbyA = once(a, 'lobby:state', (s) => s.phase === 'lobby');
    b.emit('room:leave');
    expect(await overA).toMatchObject({ winner: 0, reason: 'forfeit' });
    const lobby = (await lobbyA) as LobbyState;
    expect(lobby.players[1]).toBeNull();

    const c = await client();
    const rc = await join(c, 'Carol', lobby.code);
    expect(rc.ok).toBe(true);
    const next = once(a, 'game:init');
    a.emit('lobby:ready', true);
    c.emit('lobby:ready', true);
    const init2 = await next;
    expect(init2.maze.cells).not.toEqual(init.maze.cells);
    expect(init2.names).toEqual(['Alice the very l', 'Carol']);

    const over2 = once(a, 'game:over');
    server.rooms.rooms.get(lobby.code)!.game!.forfeit(1);
    await over2;
    const third = Promise.all([once(a, 'game:init'), once(c, 'game:init')]);
    a.emit('game:rematch');
    c.emit('game:rematch');
    const [i3] = await third;
    expect(i3.maze.cells).not.toEqual(init2.maze.cells);
  });
});
