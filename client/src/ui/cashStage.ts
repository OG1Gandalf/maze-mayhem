import { CASH_BUNDLE_VALUE } from '../../../shared/constants';
import type { Role } from '../../../shared/protocol';
import { sfx } from '../audio';

const STACK_HEIGHT = 8;
const MAX_BUNDLES = 40;
const BUNDLE_W = 46;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Green banknote bundles on the table between you and the NPC. One bundle per CASH_BUNDLE_VALUE of the offer
 * (a thinner "loose notes" bundle for the remainder), stacked in piles that grow and shrink with the slider.
 */
export class CashStage {
  private readonly bundles: HTMLElement[] = [];
  private amount = 0;
  private busy = false;

  constructor(
    private readonly table: HTMLElement,
    private readonly avatar: HTMLElement,
  ) {}

  setRole(role: Role): void {
    this.avatar.dataset.role = role;
    this.avatar.classList.remove('nod', 'shake', 'pocket');
  }

  setAmount(amount: number): void {
    this.amount = amount;
    if (this.busy) return;
    const full = Math.floor(amount / CASH_BUNDLE_VALUE);
    const loose = amount % CASH_BUNDLE_VALUE > 0 ? 1 : 0;
    const count = Math.min(MAX_BUNDLES, full + loose);
    while (this.bundles.length > count) this.bundles.pop()!.remove();
    while (this.bundles.length < count) {
      const b = document.createElement('div');
      b.className = 'bundle pop';
      b.addEventListener('animationend', () => b.classList.remove('pop'), { once: true });
      this.table.append(b);
      this.bundles.push(b);
    }
    this.layout(count, full >= MAX_BUNDLES ? 0 : loose);
  }

  private layout(count: number, loose: number): void {
    const stacks = Math.max(1, Math.ceil(count / STACK_HEIGHT));
    const width = this.table.clientWidth || 300;
    const gap = stacks > 1 ? Math.min(BUNDLE_W + 8, (width - BUNDLE_W) / (stacks - 1)) : 0;
    const left0 = (width - (BUNDLE_W + gap * (stacks - 1))) / 2;
    this.bundles.forEach((b, i) => {
      const stack = Math.floor(i / STACK_HEIGHT);
      const level = i % STACK_HEIGHT;
      b.style.left = `${left0 + stack * gap}px`;
      b.style.bottom = `${level * 7}px`;
      b.style.zIndex = String(level);
      b.classList.toggle('loose', loose === 1 && i === count - 1);
      b.style.transform = '';
      b.style.opacity = '';
      b.style.transition = '';
    });
  }

  /** Bundles fly across to the NPC, with a riffle sound per bundle. */
  async fly(): Promise<void> {
    this.busy = true;
    this.avatar.classList.remove('nod', 'shake', 'pocket');
    const target = this.avatar.querySelector('.av-hand')?.getBoundingClientRect() ?? this.avatar.getBoundingClientRect();
    const tx = target.left + target.width / 2;
    const ty = target.top + target.height / 2;
    const n = this.bundles.length;
    const stagger = Math.min(45, 500 / Math.max(1, n));
    this.bundles.forEach((b, i) => {
      const r = b.getBoundingClientRect();
      const dx = tx - (r.left + r.width / 2);
      const dy = ty - (r.top + r.height / 2);
      const delay = (n - 1 - i) * stagger;
      b.style.transition = `transform 380ms cubic-bezier(.45,-0.25,.55,1) ${delay}ms`;
      b.style.transform = `translate(${dx}px, ${dy}px) scale(.55) rotate(${(i % 2 ? 1 : -1) * 14}deg)`;
      setTimeout(() => sfx.count(i), delay + 120);
    });
    await wait(380 + n * stagger + 40);
  }

  /** Accepted: the NPC pockets the cash. */
  async pocket(): Promise<void> {
    this.avatar.classList.add('nod', 'pocket');
    for (const b of this.bundles) {
      b.style.transition = 'transform 260ms ease-in, opacity 260ms ease-in';
      b.style.transform += ' scale(.2)';
      b.style.opacity = '0';
    }
    await wait(300);
    for (const b of this.bundles) b.remove();
    this.bundles.length = 0;
    this.busy = false;
  }

  /** Refused: head shake and the cash slides back to your side. */
  async slideBack(): Promise<void> {
    this.avatar.classList.remove('shake');
    void this.avatar.offsetWidth;
    this.avatar.classList.add('shake');
    await wait(260);
    const n = this.bundles.length;
    this.bundles.forEach((b, i) => {
      b.style.transition = `transform 420ms cubic-bezier(.2,.8,.3,1) ${i * 18}ms`;
      b.style.transform = '';
    });
    await wait(440 + n * 18);
    this.busy = false;
    this.setAmount(this.amount);
  }

  reset(): void {
    this.busy = false;
    for (const b of this.bundles) b.remove();
    this.bundles.length = 0;
    this.avatar.classList.remove('nod', 'shake', 'pocket');
  }
}
