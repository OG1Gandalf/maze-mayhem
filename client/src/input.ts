import type { RelDir } from '../../shared/protocol';
import { sfx } from './audio';

export interface InputHandlers {
  move(rel: RelDir): void;
  shoot(): void;
  toggleMap(): void;
  /** False while a dialogue/cinematic is active or the game screen is not visible. */
  enabled(): boolean;
  /** True while the game screen is visible (used to block page scroll/zoom gestures). */
  inGame(): boolean;
}

/** Relative to the character: Up = forward, Left/Right = turn and step, Down = turn around and step. */
const KEY_REL: Record<string, RelDir> = {
  ArrowUp: 'forward',
  ArrowDown: 'back',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
};

export function setupInput(gameEl: HTMLElement, touchEl: HTMLElement, h: InputHandlers): void {
  const unlockAudio = () => sfx.unlock();
  window.addEventListener('pointerdown', unlockAudio, { capture: true });
  window.addEventListener('keydown', unlockAudio, { capture: true });

  window.addEventListener('keydown', (e) => {
    if (!h.inGame()) return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select, .modal')) return;
    if (e.code === 'KeyM' && !e.repeat) {
      h.toggleMap();
      return;
    }
    if (!h.enabled()) return;
    const rel = KEY_REL[e.code] ?? KEY_REL[e.key];
    if (rel) {
      e.preventDefault();
      if (!e.repeat) h.move(rel);
    } else if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) h.shoot();
    }
  });

  const enableTouchUi = () => {
    touchEl.hidden = false;
    gameEl.classList.add('touch-on');
  };
  if (matchMedia('(pointer: coarse)').matches) enableTouchUi();
  gameEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') enableTouchUi();
  });

  // Each button tracks its own pointers, so the D-pad and Fire can be held at the same time.
  for (const btn of touchEl.querySelectorAll<HTMLButtonElement>('.tbtn')) {
    const pointers = new Set<number>();
    const release = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (!pointers.size) btn.classList.remove('pressed');
    };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      pointers.add(e.pointerId);
      btn.classList.add('pressed');
      if (!h.enabled()) return;
      const rel = btn.dataset.rel as RelDir | undefined;
      if (rel) h.move(rel);
      else h.shoot();
    });
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    // Keyboard/mouse activation of the on-screen buttons is handled by pointerdown; swallow the click.
    btn.addEventListener('click', (e) => e.preventDefault());
  }

  // Block scrolling, pinch-zoom and double-tap zoom while playing (dialogs may still scroll).
  const blockGesture = (e: Event) => {
    if (h.inGame() && !(e.target instanceof Element && e.target.closest('.modal'))) e.preventDefault();
  };
  document.addEventListener('touchmove', blockGesture, { passive: false });
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) blockGesture(e);
  }, { passive: false });
  document.addEventListener('gesturestart', blockGesture as EventListener, { passive: false });
  document.addEventListener('dblclick', blockGesture, { passive: false });
  gameEl.addEventListener('contextmenu', (e) => e.preventDefault());
}
