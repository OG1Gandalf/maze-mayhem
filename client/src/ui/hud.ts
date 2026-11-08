import { MAX_HP, ROLES, ROLE_BADGE, ROLE_LABEL } from '../../../shared/constants';
import type { NotifyMsg, Slot, StateMsg } from '../../../shared/protocol';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function hpCardHtml(): string {
  return '<span class="who"></span><span class="num"></span><div class="bar" role="meter" aria-valuemin="0" aria-valuemax="10"><div class="fill"></div></div>';
}

export class Hud {
  private readonly me = $('hp-me');
  private readonly opp = $('hp-opp');
  private readonly coins = $('coins');
  private readonly status = $('status');
  private readonly kills = $('kills');
  private readonly feed = $('feed');
  private readonly flashEl = $('flash');
  private lastKills = '';

  constructor() {
    this.me.innerHTML = hpCardHtml();
    this.opp.innerHTML = hpCardHtml();
  }

  setPlayers(you: Slot, names: [string, string]): void {
    const opp: Slot = you === 0 ? 1 : 0;
    this.me.className = `hp-card s${you}`;
    this.opp.className = `hp-card s${opp}`;
    this.me.querySelector('.who')!.textContent = `P${you + 1} ${names[you]} (you)`;
    this.opp.querySelector('.who')!.textContent = `P${opp + 1} ${names[opp]}`;
    this.lastKills = '';
    this.feed.replaceChildren();
  }

  update(s: StateMsg): void {
    this.setHp(this.me, s.me.hp);
    this.setHp(this.opp, s.opp.hp);
    this.opp.classList.toggle('hidden-opp', !s.opp.visible);
    this.coins.textContent = `\u{1FA99} ${s.me.coins} coins`;

    const chips: string[] = [];
    if (s.me.frozenMs > 0) chips.push(`<span class="chip freeze">\u2744 Frozen ${Math.ceil(s.me.frozenMs / 1000)}s</span>`);
    if (s.me.boostMs > 0) chips.push(`<span class="chip boost">\u26A1 Boost ${Math.ceil(s.me.boostMs / 1000)}s</span>`);
    if (s.reveal) chips.push(`<span class="chip path">\u27A4 Path ${Math.ceil(s.reveal.ms / 1000)}s</span>`);
    if (!s.opp.connected) chips.push('<span class="chip freeze">Opponent offline</span>');
    const html = chips.join('');
    if (this.status.innerHTML !== html) this.status.innerHTML = html;

    const killsKey = ROLES.map((r) => (s.me.killed[r] ? 1 : 0)).join('');
    if (killsKey !== this.lastKills) {
      this.lastKills = killsKey;
      this.kills.innerHTML = ROLES.map((r) => {
        const used = s.me.killed[r];
        const label = `${ROLE_LABEL[r]}: ${used ? 'kill used' : 'kill available'}`;
        return `<span class="chip${used ? ' used' : ''}" title="${label}" aria-label="${label}">${ROLE_BADGE[r]} ${used ? '\u2715' : '\u25CB'}</span>`;
      }).join('');
    }
  }

  private setHp(card: HTMLElement, hp: number): void {
    (card.querySelector('.fill') as HTMLElement).style.width = `${(hp / MAX_HP) * 100}%`;
    card.querySelector('.num')!.textContent = `${hp}/${MAX_HP} HP`;
    card.querySelector('.bar')!.setAttribute('aria-valuenow', String(hp));
  }

  notify(n: NotifyMsg): void {
    const li = document.createElement('li');
    li.className = n.tone;
    li.textContent = n.text;
    this.feed.append(li);
    while (this.feed.children.length > 4) this.feed.firstElementChild!.remove();
    setTimeout(() => li.classList.add('fade'), 4500);
    setTimeout(() => li.remove(), 5000);
  }

  flash(): void {
    this.flashEl.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => this.flashEl.classList.remove('on')));
  }
}
