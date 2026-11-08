import type { GameOverMsg, LobbyState, PlayerStats, Slot, WinReason } from '../../../shared/protocol';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export type ScreenName = 'home' | 'lobby' | 'game';

export function showScreen(name: ScreenName): void {
  for (const s of ['home', 'lobby', 'game'] as const) $(`screen-${s}`).hidden = s !== name;
}

export function renderLobby(s: LobbyState): void {
  $('room-code').textContent = s.code;
  const seats = $('seats');
  seats.replaceChildren(
    ...s.players.map((p, i) => {
      const li = document.createElement('li');
      li.className = `seat s${i}${p ? '' : ' empty'}`;
      const dot = document.createElement('span');
      dot.className = 'dot';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p ? p.name : 'Waiting for player...';
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = `P${i + 1}${i === s.you ? ' (you)' : ''}${p && !p.connected ? ' \u2022 offline' : ''}`;
      const state = document.createElement('span');
      state.className = `state${p?.ready ? ' ready' : ''}`;
      state.textContent = p ? (p.ready ? '\u2714 Ready' : 'Not ready') : '';
      li.append(dot, name, tag, state);
      return li;
    }),
  );
  const me = s.players[s.you];
  const full = !!(s.players[0] && s.players[1]);
  const readyBtn = $<HTMLButtonElement>('ready-btn');
  readyBtn.setAttribute('aria-pressed', String(!!me?.ready));
  readyBtn.textContent = me?.ready ? '\u2714 Ready (tap to cancel)' : "I'm ready";
  $('lobby-hint').textContent = full
    ? s.phase === 'countdown'
      ? 'Starting...'
      : 'Both players here. Ready up!'
    : 'Share this code with your opponent. They open the same address and tap Join.';
}

const REASON_LABEL: Record<WinReason, string> = {
  center: 'Reached the centre',
  died: 'Opponent died',
  arrested: 'Opponent arrested',
  forfeit: 'Forfeit',
};

const STAT_ROWS: [keyof PlayerStats, string][] = [
  ['coins', 'Coins left'],
  ['hp', 'HP left'],
  ['shotsHit', 'Shots hit'],
  ['shotsFired', 'Shots fired'],
  ['coinsCollected', 'Coins picked up'],
  ['bribed', 'NPCs bribed'],
  ['failedBribes', 'Failed bribes'],
  ['killed', 'NPCs killed'],
  ['walkedAway', 'Walked away'],
];

export function renderResult(o: GameOverMsg, you: Slot): void {
  const won = o.winner === you;
  const title = $('res-title');
  title.className = won ? 'won' : 'lost';
  title.textContent = won ? `\u{1F3C6} Victory! ${o.names[o.winner]} wins` : `\u{1F480} Defeat \u2014 ${o.names[o.winner]} wins`;
  $('res-reason').textContent = `${REASON_LABEL[o.reason]}: ${o.detail}.`;

  const table = $('res-stats');
  const head = `<thead><tr><th></th>${o.names
    .map((n, i) => `<th class="s${i}" scope="col">P${i + 1} ${escapeHtml(n)}${i === you ? ' (you)' : ''}${i === o.winner ? ' \u{1F3C6}' : ''}</th>`)
    .join('')}</tr></thead>`;
  const body = STAT_ROWS.map(([k, label]) => `<tr><th scope="row">${label}</th><td>${o.stats[0][k]}</td><td>${o.stats[1][k]}</td></tr>`).join('');
  table.innerHTML = head + `<tbody>${body}</tbody>`;
}

export function renderRematch(s: LobbyState | null, you: Slot): void {
  const btn = $<HTMLButtonElement>('rematch-btn');
  const status = $('res-status');
  const opp: Slot = you === 0 ? 1 : 0;
  const oppPlayer = s?.players[opp];
  if (!s || !oppPlayer || s.phase === 'lobby') {
    btn.textContent = 'Back to lobby';
    btn.dataset.mode = 'lobby';
    btn.disabled = false;
    status.textContent = oppPlayer
      ? `${oppPlayer.name} joined. Head back to the lobby and ready up.`
      : 'Your opponent left the room. Wait in the lobby for someone new.';
    return;
  }
  btn.dataset.mode = 'rematch';
  if (s.rematch[you]) {
    btn.textContent = 'Waiting...';
    btn.disabled = true;
    status.textContent = `Waiting for ${oppPlayer.name} to accept the rematch.`;
  } else {
    btn.textContent = 'Rematch';
    btn.disabled = false;
    status.textContent = s.rematch[opp] ? `${oppPlayer.name} wants a rematch!` : 'Same room, brand-new maze.';
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
