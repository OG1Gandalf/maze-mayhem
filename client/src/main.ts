import './style.css';
import { NAME_MAX, SHOT_SPEED } from '../../shared/constants';
import { DIR_VEC, hasWall, type MazeData } from '../../shared/maze';
import type { GameOverMsg, JoinResult, LobbyState, Slot, StateMsg } from '../../shared/protocol';
import { sfx } from './audio';
import { setupInput } from './input';
import { connect, session } from './net';
import { drawMinimap } from './render/minimap';
import { cellSizeFor, drawPov, type PovModel } from './render/pov';
import { Tween } from './render/tween';
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
  state: null as StateMsg | null,
  stateAt: 0,
  over: null as GameOverMsg | null,
  inRoom: false,
};

const meTween = new Tween();
const oppTween = new Tween();
let oppWasVisible = false;

function go(screen: ScreenName): void {
  S.screen = screen;
  showScreen(screen);
  if (screen === 'game') resize();
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

// ---------------------------------------------------------------- dialogue

const dialogue = new Dialogue({
  action: (a) => socket.emit('npc:action', a),
  offer: (n) => socket.emit('npc:offer', n),
});

// ---------------------------------------------------------------- input

setupInput($('screen-game'), $('touch'), {
  move: (dir) => socket.emit('input:move', dir),
  shoot: () => socket.emit('input:shoot'),
  enabled: () => S.screen === 'game' && !dialogue.isOpen() && $('result').hidden && S.state?.phase === 'playing',
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
  S.maze = g.maze;
  S.you = g.you;
  S.names = g.names;
  S.state = null;
  S.over = null;
  meTween.reset();
  oppTween.reset();
  oppWasVisible = false;
  $('result').hidden = true;
  dialogue.close();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  hud.setPlayers(g.you, g.names);
  go('game');
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
  const now = performance.now();
  S.state = s;
  S.stateAt = now;
  meTween.target(s.me.x, s.me.y, s.me.moveMs, now);
  if (s.opp.visible && s.opp.x !== undefined && s.opp.y !== undefined) {
    if (!oppWasVisible) oppTween.snap(s.opp.x, s.opp.y);
    else oppTween.target(s.opp.x, s.opp.y, s.opp.moveMs, now);
  }
  oppWasVisible = s.opp.visible;
  hud.update(s);
  if (!S.over) dialogue.update(s.encounter);
});

socket.on('maze:update', (cells) => {
  if (S.maze) S.maze = { ...S.maze, cells };
  hud.notify({ text: 'The walls shift: a shortcut opened!', tone: 'info' });
});

socket.on('game:fx', (f) => {
  const mine = f.slot === S.you;
  switch (f.kind) {
    case 'shot':
      sfx.shoot(mine || !!S.state?.opp.visible);
      break;
    case 'hit':
      if (mine) {
        sfx.hurt();
        hud.flash();
        navigator.vibrate?.(60);
      } else sfx.hit();
      break;
    case 'coin':
      if (mine) sfx.coin();
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
      if (mine) sfx.kill();
      break;
  }
});

socket.on('game:notify', (n) => {
  hud.notify(n);
  if (n.tone === 'warn') sfx.notify();
});

socket.on('npc:result', (r) => {
  const tone = r.outcome === 'bribed' ? 'good' : r.outcome === 'failed' ? 'bad' : r.outcome === 'killed' ? 'warn' : 'info';
  hud.notify({ text: r.text, tone });
});

socket.on('game:over', (o) => {
  S.over = o;
  dialogue.close();
  $('countdown').hidden = true;
  renderResult(o, S.you);
  renderRematch(S.lobby, S.you);
  $('result').hidden = false;
  requestAnimationFrame(() => $('rematch-btn').focus());
  if (o.winner === S.you) sfx.win();
  else sfx.lose();
});

// ---------------------------------------------------------------- rendering

const view = $<HTMLCanvasElement>('view');
const minimap = $<HTMLCanvasElement>('minimap');
const ctx = view.getContext('2d')!;
let vw = 0;
let vh = 0;

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  vw = view.clientWidth;
  vh = view.clientHeight;
  view.width = Math.round(vw * dpr);
  view.height = Math.round(vh * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

/** Extrapolates a projectile between server ticks without letting it pass through walls. */
function projectilePos(maze: MazeData, p: StateMsg['projectiles'][number], elapsedMs: number) {
  let x = p.x;
  let y = p.y;
  let t = p.progress + (SHOT_SPEED * Math.min(elapsedMs, 120)) / 1000;
  const v = DIR_VEC[p.dir];
  while (t >= 0.5) {
    if (hasWall(maze, x, y, p.dir)) {
      t = 0.45;
      break;
    }
    if (t < 1) break;
    x += v.x;
    y += v.y;
    t -= 1;
  }
  return { owner: p.owner, x: x + 0.5 + v.x * t, y: y + 0.5 + v.y * t };
}

function frame(): void {
  requestAnimationFrame(frame);
  if (S.screen !== 'game' || !S.maze || !S.state) return;
  const now = performance.now();
  const s = S.state;
  const maze = S.maze;
  const me = meTween.get(now);
  const opp = s.opp.visible ? oppTween.get(now) : null;
  const elapsed = now - S.stateAt;
  const oppSlot: Slot = S.you === 0 ? 1 : 0;

  const model: PovModel = {
    maze,
    me: { ...me, facing: s.me.facing, slot: S.you, isMe: true, frozen: s.me.frozenMs > elapsed, boosted: s.me.boostMs > elapsed, name: S.names[S.you] },
    opp: opp && s.opp.facing ? { ...opp, facing: s.opp.facing, slot: oppSlot, isMe: false, name: s.opp.name } : null,
    projectiles: s.projectiles.map((p) => projectilePos(maze, p, elapsed)),
    coins: s.coins,
    npcs: s.npcs,
    reveal: s.reveal && s.reveal.ms > elapsed ? s.reveal.path : null,
  };
  drawPov(ctx, vw, vh, model, now);

  const cs = cellSizeFor(vw, vh);
  drawMinimap(
    minimap,
    {
      maze,
      you: S.you,
      me,
      opp,
      reveal: model.reveal,
      viewHalf: { x: vw / cs / 2, y: vh / cs / 2 },
    },
    now,
  );
}
requestAnimationFrame(frame);

go('home');
