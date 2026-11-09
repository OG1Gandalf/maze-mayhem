import './style.css';
import { NAME_MAX, NPC_CHASE_RADIUS } from '../../shared/constants';
import { chebyshev, type MazeData } from '../../shared/maze';
import type { GameOverMsg, JoinResult, LobbyState, Slot, StateMsg } from '../../shared/protocol';
import { sfx } from './audio';
import { setupInput } from './input';
import { connect, session } from './net';
import { Minimap } from './render/minimap';
import { World3D } from './three/world';
import { Dialogue } from './ui/dialogue';
import { Hud } from './ui/hud';
import { renderLobby, renderResult, renderRematch, showScreen, type ScreenName } from './ui/screens';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const socket = connect();
const hud = new Hud();

const S = {
  screen: 'home' as ScreenName,
  lobby: null as LobbyState | null,
  you: 0 as Slot,
  names: ['', ''] as [string, string],
  maze: null as MazeData | null,
  seed: 0,
  state: null as StateMsg | null,
  over: null as GameOverMsg | null,
  inRoom: false,
  bigMap: false,
};

const view = $<HTMLCanvasElement>('view');
const minimapEl = $<HTMLCanvasElement>('minimap');
let world: World3D | null = null;
let minimap: Minimap | null = null;

/** Frees the 3D scene of the current game (geometries, materials, textures). */
function disposeWorld(): void {
  world?.dispose();
  world = null;
  minimap = null;
}

function go(screen: ScreenName): void {
  S.screen = screen;
  showScreen(screen);
  if (screen !== 'game') disposeWorld();
  else world?.resize();
}

// ---------------------------------------------------------------- home

const nameInput = $<HTMLInputElement>('name-input');
const codeInput = $<HTMLInputElement>('code-input');
const homeError = $('home-error');
nameInput.value = session.name;
nameInput.maxLength = NAME_MAX;

function currentName(): string | null {
  const name = nameInput.value.trim().slice(0, NAME_MAX);
  if (!name) {
    homeError.textContent = 'Enter a display name first.';
    nameInput.focus();
    return null;
  }
  session.name = name;
  return name;
}

function onJoined(r: JoinResult): void {
  if (!r.ok) {
    homeError.textContent = r.error;
    return;
  }
  homeError.textContent = '';
  session.token = r.token;
  S.inRoom = true;
  S.you = r.slot;
  S.over = null;
  go('lobby');
}

$('home-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = currentName();
  if (name) socket.emit('room:create', { name }, onJoined);
});

function join(): void {
  const name = currentName();
  const code = codeInput.value.trim().toUpperCase();
  if (!name) return;
  if (code.length !== 4) {
    homeError.textContent = 'Room codes are 4 letters.';
    codeInput.focus();
    return;
  }
  socket.emit('room:join', { name, code }, onJoined);
}
$('join-btn').addEventListener('click', join);
codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
});
codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    join();
  }
});
const params = new URLSearchParams(location.search);
if (params.get('room')) codeInput.value = params.get('room')!.toUpperCase().slice(0, 4);

// ---------------------------------------------------------------- lobby

$('ready-btn').addEventListener('click', () => {
  const me = S.lobby?.players[S.you];
  socket.emit('lobby:ready', !me?.ready);
});

function leaveRoom(): void {
  socket.emit('room:leave');
  session.token = null;
  S.inRoom = false;
  S.lobby = null;
  S.over = null;
  S.maze = null;
  $('result').hidden = true;
  dialogue.close();
  go('home');
}
$('leave-btn').addEventListener('click', leaveRoom);
$('res-leave-btn').addEventListener('click', leaveRoom);

$('room-code').addEventListener('click', async () => {
  const code = S.lobby?.code;
  if (!code) return;
  const url = `${location.origin}/?room=${code}`;
  try {
    await navigator.clipboard.writeText(url);
    $('lobby-hint').textContent = `Invite link copied: ${url}`;
  } catch {
    $('lobby-hint').textContent = `Share: ${url}`;
  }
});

$('rematch-btn').addEventListener('click', () => {
  const btn = $<HTMLButtonElement>('rematch-btn');
  if (btn.dataset.mode === 'lobby') {
    $('result').hidden = true;
    S.over = null;
    if (S.lobby) renderLobby(S.lobby);
    go('lobby');
    return;
  }
  socket.emit('game:rematch');
});

// ---------------------------------------------------------------- dialogue + input

const dialogue = new Dialogue({
  action: (a) => socket.emit('npc:action', a),
  offer: (n) => socket.emit('npc:offer', n),
});

function toggleMap(): void {
  S.bigMap = !S.bigMap;
  minimapEl.classList.toggle('big', S.bigMap);
  minimapEl.setAttribute('aria-label', S.bigMap ? 'Minimap, tap to shrink' : 'Minimap, tap to enlarge');
}
minimapEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  toggleMap();
});

setupInput($('screen-game'), $('touch'), {
  move: (rel) => socket.emit('input:move', rel),
  shoot: () => socket.emit('input:shoot'),
  toggleMap,
  enabled: () =>
    S.screen === 'game' &&
    !dialogue.isOpen() &&
    $('result').hidden &&
    S.state?.phase === 'playing' &&
    !(world?.inCinematic() ?? false),
  inGame: () => S.screen === 'game',
});

// ---------------------------------------------------------------- socket events

socket.on('connect', () => {
  $('conn').hidden = true;
  const token = session.token;
  if (!token) return;
  socket.emit('room:resume', { token }, (r) => {
    if (r.ok) {
      S.inRoom = true;
      return;
    }
    session.token = null;
    S.inRoom = false;
    if (S.screen !== 'home') {
      $('result').hidden = true;
      dialogue.close();
      go('home');
      homeError.textContent = 'Your previous session expired.';
    }
  });
});

socket.on('disconnect', () => {
  if (S.inRoom) $('conn').hidden = false;
});

socket.on('lobby:state', (s) => {
  S.lobby = s;
  S.you = s.you;
  if (S.over) {
    renderRematch(s, s.you);
    return;
  }
  if (s.phase === 'lobby') {
    renderLobby(s);
    if (S.screen !== 'lobby') {
      dialogue.close();
      go('lobby');
    }
  } else if (S.screen === 'lobby') {
    renderLobby(s);
  }
});

socket.on('game:init', (g) => {
  const sameGame = world && S.seed === g.seed && S.you === g.you;
  S.maze = g.maze;
  S.you = g.you;
  S.names = g.names;
  S.seed = g.seed;
  S.state = null;
  S.over = null;
  $('result').hidden = true;
  dialogue.close();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  hud.setPlayers(g.you, g.names);
  go('game');
  if (!sameGame) {
    disposeWorld();
    world = new World3D(view, g.maze, g.you, g.names);
  }
  minimap = new Minimap(minimapEl, g.maze, g.seed);
});

let countdownTimer = 0;
socket.on('game:countdown', (n) => {
  const el = $('countdown');
  el.hidden = false;
  el.classList.toggle('go', n === 0);
  el.textContent = n > 0 ? String(n) : 'GO!';
  if (n > 0) sfx.tick();
  else sfx.go();
  clearTimeout(countdownTimer);
  if (n === 0) countdownTimer = window.setTimeout(() => (el.hidden = true), 700);
});

socket.on('game:state', (s) => {
  S.state = s;
  world?.onState(s, performance.now());
  hud.update(s);
  if (!S.over) dialogue.update(s.encounter);
});

socket.on('maze:update', (cells) => {
  if (S.maze) S.maze = { ...S.maze, cells };
  world?.onMaze(cells, performance.now());
  hud.notify({ text: 'The walls rumble: a shortcut opened!', tone: 'info' });
});

socket.on('game:fx', (f) => {
  const mine = f.slot === S.you;
  world?.onFx(f, performance.now());
  switch (f.kind) {
    case 'shot':
      if (mine || S.state?.opp.visible) sfx.shoot(true);
      else sfx.shoot(false);
      break;
    case 'hit':
      if (mine) {
        sfx.hurt();
        hud.flash();
        navigator.vibrate?.(60);
      } else sfx.hit();
      break;
    case 'cash':
      if (mine) sfx.cash();
      break;
    case 'encounter':
      if (mine) sfx.encounter();
      break;
    case 'bribe_ok':
      if (mine) sfx.bribeOk();
      break;
    case 'bribe_fail':
      if (mine) sfx.bribeFail();
      break;
    case 'kill':
      if (mine) navigator.vibrate?.([30, 250, 30, 250, 30, 250, 30]);
      break;
  }
});

socket.on('game:notify', (n) => {
  hud.notify(n);
  if (n.tone === 'warn') sfx.notify();
});

socket.on('npc:result', (r) => {
  dialogue.result(r);
  const tone = r.outcome === 'bribed' ? 'good' : r.outcome === 'failed' ? 'bad' : r.outcome === 'killed' ? 'warn' : 'info';
  hud.notify({ text: r.text, tone });
});

socket.on('game:over', async (o) => {
  S.over = o;
  $('countdown').hidden = true;
  // Let a bribe outcome (e.g. the arrest) play out before the result screen.
  await dialogue.whenIdle(2600);
  if (S.over !== o) return;
  dialogue.close();
  renderResult(o, S.you);
  renderRematch(S.lobby, S.you);
  $('result').hidden = false;
  requestAnimationFrame(() => $('rematch-btn').focus());
  if (o.winner === S.you) sfx.win();
  else sfx.lose();
});

// ---------------------------------------------------------------- rendering

let resizeTimer = 0;
const onResize = () => {
  world?.resize();
  clearTimeout(resizeTimer);
  // Mobile browsers report the final size a little after rotation.
  resizeTimer = window.setTimeout(() => world?.resize(), 250);
};
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
screen.orientation?.addEventListener?.('change', onResize);

function frame(): void {
  requestAnimationFrame(frame);
  if (S.screen !== 'game' || !world || !S.maze) return;
  const now = performance.now();
  const info = world.frame(now);
  const s = S.state;
  if (!minimap || !s) return;
  minimap.draw(
    {
      maze: S.maze,
      you: S.you,
      me: info.me,
      yaw: info.yaw,
      opp: s.opp.near && s.opp.x !== undefined && s.opp.y !== undefined ? { x: s.opp.x, y: s.opp.y } : null,
      reveal: s.reveal?.path ?? null,
      npcs: s.npcs.filter((n) => n.status === 'active' && chebyshev(n, s.me) <= NPC_CHASE_RADIUS),
    },
    now,
    S.bigMap,
  );
}
requestAnimationFrame(frame);

go('home');
