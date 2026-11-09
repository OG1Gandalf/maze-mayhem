import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import {
  COUNTDOWN_SECONDS,
  RATE_LIMIT_BURST,
  RATE_LIMIT_PER_SEC,
  RECONNECT_GRACE_MS,
  ROOM_CODE_LENGTH,
  TICK_MS,
} from '../shared/constants';
import { isRelDir } from '../shared/maze';
import type {
  ClientToServerEvents,
  JoinResult,
  LobbyState,
  RoomPhase,
  ServerToClientEvents,
  Slot,
} from '../shared/protocol';
import { Game } from './game';
import { randomSeed } from './rng';
import { sanitizeCode, sanitizeName } from './sanitize';

interface SocketData {
  code?: string;
  slot?: Slot;
}

export type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface RoomOptions {
  countdownStepMs?: number;
  graceMs?: number;
  tickMs?: number;
}

interface Seat {
  token: string;
  name: string;
  socketId: string | null;
  ready: boolean;
  graceTimer: NodeJS.Timeout | null;
}

interface Room {
  code: string;
  seats: [Seat | null, Seat | null];
  phase: RoomPhase;
  game: Game | null;
  rematch: [boolean, boolean];
  countdownTimers: NodeJS.Timeout[];
  tickTimer: NodeJS.Timeout | null;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const SLOTS: readonly Slot[] = [0, 1];
const other = (s: Slot): Slot => (s === 0 ? 1 : 0);

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly tokens = new Map<string, { code: string; slot: Slot }>();
  private readonly countdownStepMs: number;
  private readonly graceMs: number;
  private readonly tickMs: number;

  constructor(private readonly io: IO, opts: RoomOptions = {}) {
    this.countdownStepMs = opts.countdownStepMs ?? 1000;
    this.graceMs = opts.graceMs ?? RECONNECT_GRACE_MS;
    this.tickMs = opts.tickMs ?? TICK_MS;
    io.on('connection', (socket) => this.attach(socket));
  }

  shutdown(): void {
    for (const room of this.rooms.values()) {
      this.stopTimers(room);
      for (const seat of room.seats) if (seat?.graceTimer) clearTimeout(seat.graceTimer);
    }
    this.rooms.clear();
    this.tokens.clear();
  }

  // ------------------------------------------------------------ socket wiring

  private attach(socket: Sock): void {
    let tokens = RATE_LIMIT_BURST;
    let refilled = Date.now();
    socket.use((_packet, next) => {
      const now = Date.now();
      tokens = Math.min(RATE_LIMIT_BURST, tokens + ((now - refilled) * RATE_LIMIT_PER_SEC) / 1000);
      refilled = now;
      if (tokens < 1) return;
      tokens -= 1;
      next();
    });

    socket.on('room:create', (p, ack) => {
      if (typeof ack !== 'function') return;
      this.leaveCurrent(socket);
      const room = this.createRoom();
      ack(this.seat(socket, room, 0, sanitizeName(p?.name)));
    });

    socket.on('room:join', (p, ack) => {
      if (typeof ack !== 'function') return;
      const code = sanitizeCode(p?.code);
      const room = this.rooms.get(code);
      if (!room) return ack({ ok: false, error: `No room with code ${code || '(empty)'}` });
      if (room.phase === 'countdown' || room.phase === 'playing') return ack({ ok: false, error: 'That game is already in progress' });
      const slot = SLOTS.find((s) => !room.seats[s]);
      if (slot === undefined) return ack({ ok: false, error: 'Room is full' });
      this.leaveCurrent(socket);
      if (room.phase === 'over') this.resetToLobby(room);
      ack(this.seat(socket, room, slot, sanitizeName(p?.name)));
    });

    socket.on('room:resume', (p, ack) => {
      if (typeof ack !== 'function') return;
      const ref = typeof p?.token === 'string' ? this.tokens.get(p.token) : undefined;
      const room = ref && this.rooms.get(ref.code);
      const seat = room?.seats[ref!.slot];
      if (!ref || !room || !seat) return ack({ ok: false });
      if (seat.socketId && seat.socketId !== socket.id) this.io.sockets.sockets.get(seat.socketId)?.disconnect(true);
      if (seat.graceTimer) clearTimeout(seat.graceTimer);
      seat.graceTimer = null;
      seat.socketId = socket.id;
      socket.data.code = room.code;
      socket.data.slot = ref.slot;
      socket.join(room.code);
      ack({ ok: true });
      this.emitLobby(room);
      if (room.game) {
        room.game.setConnected(ref.slot, true);
        socket.emit('game:init', { maze: room.game.maze, you: ref.slot, names: [room.game.players[0].name, room.game.players[1].name], seed: room.game.seed });
        if (room.phase === 'over' && room.game.result) socket.emit('game:over', room.game.result);
        else this.emitTo(room, other(ref.slot), 'game:notify', { text: `${seat.name} reconnected`, tone: 'info' });
        room.game.broadcastState();
      }
    });

    socket.on('room:leave', () => this.leaveCurrent(socket));

    socket.on('lobby:ready', (ready) => {
      const ctx = this.ctx(socket);
      if (!ctx || ctx.room.phase !== 'lobby') return;
      ctx.seat.ready = ready === true;
      this.emitLobby(ctx.room);
      const [a, b] = ctx.room.seats;
      if (a?.ready && b?.ready) this.startCountdown(ctx.room);
    });

    socket.on('input:move', (dir) => {
      const ctx = this.ctx(socket);
      if (ctx?.room.game && isRelDir(dir)) ctx.room.game.handleMove(ctx.slot, dir);
    });
    socket.on('input:shoot', () => {
      const ctx = this.ctx(socket);
      ctx?.room.game?.handleShoot(ctx.slot);
    });
    socket.on('npc:action', (action) => {
      const ctx = this.ctx(socket);
      if (ctx?.room.game && (action === 'negotiate' || action === 'kill' || action === 'walk')) ctx.room.game.handleNpcAction(ctx.slot, action);
    });
    socket.on('npc:offer', (amount) => {
      const ctx = this.ctx(socket);
      if (ctx?.room.game && typeof amount === 'number') ctx.room.game.handleOffer(ctx.slot, amount);
    });

    socket.on('game:rematch', () => {
      const ctx = this.ctx(socket);
      if (!ctx || ctx.room.phase !== 'over') return;
      ctx.room.rematch[ctx.slot] = true;
      this.emitLobby(ctx.room);
      const [a, b] = ctx.room.seats;
      if (a && b && ctx.room.rematch[0] && ctx.room.rematch[1]) this.startCountdown(ctx.room);
    });

    socket.on('disconnect', () => {
      const ctx = this.ctx(socket);
      if (!ctx) return;
      const { room, seat, slot } = ctx;
      seat.socketId = null;
      room.game?.setConnected(slot, false);
      if (room.phase === 'playing' || room.phase === 'countdown') {
        this.emitTo(room, other(slot), 'game:notify', {
          text: `${seat.name} disconnected. ${Math.round(this.graceMs / 1000)}s to reconnect or they forfeit.`,
          tone: 'warn',
        });
      }
      this.emitLobby(room);
      seat.graceTimer = setTimeout(() => {
        seat.graceTimer = null;
        if (room.seats[slot] === seat && !seat.socketId) this.removeSeat(room, slot);
      }, this.graceMs);
    });
  }

  // ------------------------------------------------------------ rooms

  private createRoom(): Room {
    let code = '';
    do {
      code = Array.from({ length: ROOM_CODE_LENGTH }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room: Room = { code, seats: [null, null], phase: 'lobby', game: null, rematch: [false, false], countdownTimers: [], tickTimer: null };
    this.rooms.set(code, room);
    return room;
  }

  private seat(socket: Sock, room: Room, slot: Slot, name: string): JoinResult {
    const token = randomUUID();
    room.seats[slot] = { token, name, socketId: socket.id, ready: false, graceTimer: null };
    this.tokens.set(token, { code: room.code, slot });
    socket.data.code = room.code;
    socket.data.slot = slot;
    socket.join(room.code);
    queueMicrotask(() => this.emitLobby(room));
    return { ok: true, code: room.code, slot, token };
  }

  private ctx(socket: Sock): { room: Room; seat: Seat; slot: Slot } | null {
    const { code, slot } = socket.data;
    if (code === undefined || slot === undefined) return null;
    const room = this.rooms.get(code);
    const seat = room?.seats[slot];
    if (!room || !seat || seat.socketId !== socket.id) return null;
    return { room, seat, slot };
  }

  private leaveCurrent(socket: Sock): void {
    const ctx = this.ctx(socket);
    socket.data.code = undefined;
    socket.data.slot = undefined;
    if (!ctx) return;
    socket.leave(ctx.room.code);
    this.removeSeat(ctx.room, ctx.slot);
  }

  private removeSeat(room: Room, slot: Slot): void {
    const seat = room.seats[slot];
    if (!seat) return;
    if (seat.graceTimer) clearTimeout(seat.graceTimer);
    if (room.phase === 'playing' && room.game) room.game.forfeit(slot);
    this.tokens.delete(seat.token);
    room.seats[slot] = null;
    if (!room.seats[0] && !room.seats[1]) {
      this.stopTimers(room);
      this.rooms.delete(room.code);
      return;
    }
    if (room.phase === 'countdown') {
      this.emitTo(room, other(slot), 'game:notify', { text: `${seat.name} left before the start`, tone: 'warn' });
    }
    this.resetToLobby(room);
  }

  private resetToLobby(room: Room): void {
    this.stopTimers(room);
    room.phase = 'lobby';
    room.game = null;
    room.rematch = [false, false];
    for (const s of room.seats) if (s) s.ready = false;
    this.emitLobby(room);
  }

  private stopTimers(room: Room): void {
    room.countdownTimers.forEach(clearTimeout);
    room.countdownTimers = [];
    if (room.tickTimer) clearInterval(room.tickTimer);
    room.tickTimer = null;
  }

  // ------------------------------------------------------------ game lifecycle

  private startCountdown(room: Room): void {
    const [a, b] = room.seats;
    if (!a || !b) return;
    this.stopTimers(room);
    room.phase = 'countdown';
    room.rematch = [false, false];
    a.ready = false;
    b.ready = false;
    const game = new Game(
      { seed: randomSeed(), names: [a.name, b.name] },
      {
        state: (slot, s) => this.emitTo(room, slot, 'game:state', s),
        fx: (f) => this.io.to(room.code).emit('game:fx', f),
        notify: (slot, n) => this.emitTo(room, slot, 'game:notify', n),
        npcResult: (slot, r) => this.emitTo(room, slot, 'npc:result', r),
        mazeUpdate: (cells) => this.io.to(room.code).emit('maze:update', cells),
        over: (o) => {
          if (room.game !== game) return;
          this.stopTimers(room);
          room.phase = 'over';
          this.io.to(room.code).emit('game:over', o);
          this.emitLobby(room);
        },
      },
    );
    room.game = game;
    for (const slot of SLOTS) this.emitTo(room, slot, 'game:init', { maze: game.maze, you: slot, names: [a.name, b.name], seed: game.seed });
    game.broadcastState();
    this.emitLobby(room);

    for (let i = 0; i <= COUNTDOWN_SECONDS; i++) {
      const n = COUNTDOWN_SECONDS - i;
      const t = setTimeout(() => {
        if (room.game !== game || room.phase !== 'countdown') return;
        this.io.to(room.code).emit('game:countdown', n);
        if (n > 0) return;
        room.phase = 'playing';
        game.start();
        this.emitLobby(room);
        room.tickTimer = setInterval(() => game.tick(), this.tickMs);
        for (const s of SLOTS) {
          if (!room.seats[s]?.socketId) game.setConnected(s, false);
        }
      }, i * this.countdownStepMs);
      room.countdownTimers.push(t);
    }
  }

  // ------------------------------------------------------------ emit helpers

  private emitTo<E extends keyof ServerToClientEvents>(
    room: Room,
    slot: Slot,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    const sid = room.seats[slot]?.socketId;
    if (sid) this.io.to(sid).emit(event, ...args);
  }

  private emitLobby(room: Room): void {
    for (const slot of SLOTS) {
      if (!room.seats[slot]?.socketId) continue;
      const state: LobbyState = {
        code: room.code,
        you: slot,
        phase: room.phase,
        players: [this.lobbyPlayer(room.seats[0]), this.lobbyPlayer(room.seats[1])],
        rematch: [room.rematch[0], room.rematch[1]],
      };
      this.emitTo(room, slot, 'lobby:state', state);
    }
  }

  private lobbyPlayer(seat: Seat | null) {
    return seat ? { name: seat.name, ready: seat.ready, connected: seat.socketId !== null } : null;
  }
}
