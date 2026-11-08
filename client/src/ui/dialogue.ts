import { ROLE_BADGE, ROLE_LABEL } from '../../../shared/constants';
import type { EncounterView, NpcAction } from '../../../shared/protocol';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface DialogueHandlers {
  action(a: NpcAction): void;
  offer(amount: number): void;
}

export class Dialogue {
  private readonly root = $('dialogue');
  private readonly badge = $('dlg-badge');
  private readonly title = $('dlg-title');
  private readonly step = $('dlg-step');
  private readonly flavor = $('dlg-flavor');
  private readonly reply = $('dlg-reply');
  private readonly choose = $('dlg-choose');
  private readonly negotiate = $('dlg-negotiate');
  private readonly note = $('dlg-note');
  private readonly range = $<HTMLInputElement>('offer-range');
  private readonly value = $<HTMLOutputElement>('offer-value');
  private readonly of = $('offer-of');
  private readonly offerBtn = $<HTMLButtonElement>('offer-btn');
  private readonly killBtn = this.choose.querySelector<HTMLButtonElement>('[data-action="kill"]')!;
  private readonly walkBtn = this.choose.querySelector<HTMLButtonElement>('[data-action="walk"]')!;
  private view: EncounterView | null = null;

  constructor(private readonly h: DialogueHandlers) {
    for (const btn of this.choose.querySelectorAll<HTMLButtonElement>('[data-action]')) {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        this.lock();
        this.h.action(btn.dataset.action as NpcAction);
      });
    }
    for (const btn of this.negotiate.querySelectorAll<HTMLButtonElement>('[data-quick]')) {
      btn.addEventListener('click', () => {
        if (!this.view) return;
        this.setOffer(this.view.quick[btn.dataset.quick as 'low' | 'medium' | 'high']);
      });
    }
    this.range.addEventListener('input', () => this.setOffer(Number(this.range.value)));
    this.range.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.offerBtn.click();
    });
    this.offerBtn.addEventListener('click', () => {
      if (this.offerBtn.disabled) return;
      this.lock();
      this.h.offer(Number(this.range.value));
    });
    this.root.addEventListener('keydown', (e) => this.trapFocus(e));
  }

  isOpen(): boolean {
    return !this.root.hidden;
  }

  update(v: EncounterView | null): void {
    if (!v) {
      if (this.isOpen()) this.close();
      return;
    }
    if (this.view && this.view.rev === v.rev && this.isOpen()) return;
    const opening = !this.isOpen() || this.view?.npcId !== v.npcId;
    const phaseChanged = this.view?.phase !== v.phase;
    this.view = v;
    this.render(v, opening || phaseChanged);
    if (opening) this.root.hidden = false;
  }

  close(): void {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && this.root.contains(focused)) focused.blur();
    this.root.hidden = true;
    this.view = null;
  }

  private render(v: EncounterView, focusFirst: boolean): void {
    this.badge.textContent = ROLE_BADGE[v.role];
    this.title.textContent = ROLE_LABEL[v.role];
    this.flavor.textContent = v.flavor;
    this.choose.hidden = v.phase !== 'choose';
    this.negotiate.hidden = v.phase !== 'negotiate';
    this.step.textContent = v.phase === 'negotiate' ? `Step ${v.step} of ${v.maxSteps}` : 'Encounter';

    if (v.phase === 'negotiate' && v.reply && v.reply !== 'accept') {
      const close = v.reply === 'not_enough';
      this.reply.hidden = false;
      this.reply.className = `reply ${close ? 'close' : 'far'}`;
      this.reply.textContent =
        (close ? '\u270B Not enough \u2014 you are close, offer a bit more.' : '\u2716 Too much to ask \u2014 your offer is way off.') +
        (v.farTooLow ? ' (Insulting offer: a step was lost.)' : '');
    } else {
      this.reply.hidden = true;
    }

    this.killBtn.textContent = v.canKill ? `Kill (\u2212${v.killCost} HP)` : 'Kill (already used for this type)';
    this.walkBtn.textContent = `Walk away (\u2212${v.walkCost} HP)`;
    this.walkBtn.hidden = !v.canWalk;
    this.note.textContent =
      v.role === 'POLICE'
        ? 'You cannot walk away from the police. Fail a bribe and you are arrested (instant loss). Killing a cop alerts your opponent.'
        : 'Bribe to earn a reward. A failed bribe has a penalty.';

    this.range.max = String(v.coins);
    this.of.textContent = `of ${v.coins} coins`;
    if (v.phase === 'negotiate') {
      const current = Number(this.range.value);
      this.setOffer(v.step === 1 && focusFirst ? v.quick.medium : Math.min(current, v.coins));
      this.offerBtn.textContent = v.step >= v.maxSteps ? 'Final offer' : 'Make offer';
    }

    this.unlock(v);
    if (focusFirst) {
      requestAnimationFrame(() => {
        const first = v.phase === 'choose' ? this.choose.querySelector<HTMLButtonElement>('button:not([hidden])') : this.range;
        first?.focus();
      });
    }
  }

  private setOffer(n: number): void {
    const max = Number(this.range.max);
    const val = Math.max(0, Math.min(max, Math.round(n)));
    this.range.value = String(val);
    this.value.textContent = String(val);
    this.range.setAttribute('aria-valuetext', `${val} coins`);
  }

  private lock(): void {
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('button')) b.disabled = true;
    const rev = this.view?.rev;
    // Safety net in case the server ignores the request (e.g. it raced with the game ending).
    setTimeout(() => {
      if (this.view && this.view.rev === rev) this.unlock(this.view);
    }, 1500);
  }

  private unlock(v: EncounterView): void {
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('button')) b.disabled = false;
    this.killBtn.disabled = !v.canKill;
  }

  private trapFocus(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const items = [...this.root.querySelectorAll<HTMLElement>('button, input')].filter(
      (el) => !el.closest('[hidden]') && !(el as HTMLButtonElement).disabled,
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
