/**
 * Dev helper: a headless second player for solo testing.
 *   npx tsx scripts/bot.ts ABCD            # join room ABCD, ready up, wander and shoot
 *   npx tsx scripts/bot.ts ABCD --idle     # join and ready, but stand still
 * Optional: URL=http://192.168.1.5:3000
 */
import { io, type Socket } from 'socket.io-client';
import { DIRS, hasWall, type MazeData } from '../shared/maze';
import type { ClientToServerEvents, Dir, ServerToClientEvents, StateMsg } from '../shared/protocol';

const code = process.argv[2];
const idle = process.argv.includes('--idle');
if (!code) {
  console.error('Usage: npx tsx scripts/bot.ts <ROOM CODE> [--idle]');
  process.exit(1);
}

const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(process.env.URL ?? 'http://localhost:3000');
let maze: MazeData | null = null;
let state: StateMsg | null = null;
let last: Dir = 'up';

socket.on('connect', () => {
  socket.emit('room:join', { name: 'Bot', code }, (r) => {
    if (!r.ok) {
      console.error('Join failed:', r.error);
      process.exit(1);
    }
    console.log(`Joined ${r.code} as P${r.slot + 1}`);
    socket.emit('lobby:ready', true);
  });
});
socket.on('game:init', (g) => {
  maze = g.maze;
  console.log('Game starting');
});
socket.on('maze:update', (cells) => {
  if (maze) maze.cells = cells;
});
socket.on('game:state', (s) => {
  state = s;
  if (s.encounter && s.encounter.phase === 'choose') socket.emit('npc:action', s.encounter.canWalk ? 'walk' : 'negotiate');
});
socket.on('game:over', (o) => {
  console.log(`Game over: ${o.names[o.winner]} wins (${o.reason})`);
  socket.emit('game:rematch');
});
socket.on('lobby:state', (s) => {
  if (s.phase === 'lobby' && !s.players[s.you]?.ready && s.players[0] && s.players[1]) socket.emit('lobby:ready', true);
});

setInterval(() => {
  if (idle || !maze || !state || state.phase !== 'playing') return;
  if (state.encounter) {
    if (state.encounter.phase === 'negotiate') socket.emit('npc:offer', state.encounter.quick.high);
    return;
  }
  const open = DIRS.filter((d) => !hasWall(maze!, state!.me.x, state!.me.y, d));
  const back: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const forward = open.filter((d) => d !== back[last]);
  last = (forward.length ? forward : open)[Math.floor(Math.random() * (forward.length || open.length))];
  socket.emit('input:move', last);
  if (state.opp.visible && Math.random() < 0.3) socket.emit('input:shoot');
}, 250);
