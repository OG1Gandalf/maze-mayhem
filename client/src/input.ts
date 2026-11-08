import type { Dir } from '../../shared/protocol';
import { sfx } from './audio';

export interface InputHandlers {
  move(dir: Dir): void;
  shoot(): void;
  /** False while a dialogue is open or the game screen is not active. */
  enabled(): boolean;
  /** True while the game screen is visible (used to block page scroll/zoom gestures). */
  inGame(): boolean;
}

const KEY_DIRS: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

export function setupInput(gameEl: HTMLElement, touchEl: HTMLElement, h: InputHandlers): void {
  const unlockAudio = () => sfx.unlock();
  window.addEventListener('pointerdown', unlockAudio, { capture: true });
  window.addEventListener('keydown', unlockAudio, { capture: true });

  window.addEventListener('keydown', (e) => {
    if (!h.enabled()) return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select, .modal')) return;
    const dir = KEY_DIRS[e.key];
    if (dir) {
      e.preventDefault();
      if (!e.repeat) h.move(dir);
    } else if (e.code === 'Space') {
      e.preventDefault();
      h.shoot();
    }
  });

  const enableTouchUi = () => {
    touchEl.hidden = false;
    gameEl.classList.add('touch-on');
  };
  if (matchMedia('(pointer: coarse)').matches) enableTouchUi();

  // Left / right half of the screen turns and moves; buttons are excluded.
  gameEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    enableTouchUi();
    if ((e.target as HTMLElement).closest('.tbtn, .modal')) return;
    e.preventDefault();
    if (!h.enabled()) return;
    h.move(e.clientX < window.innerWidth / 2 ? 'left' : 'right');
  });

  for (const btn of touchEl.querySelectorAll<HTMLButtonElement>('.tbtn')) {
    const release = () => btn.classList.remove('pressed');
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.classList.add('pressed');
      if (!h.enabled()) return;
      const dir = btn.dataset.dir as Dir | undefined;
      if (dir) h.move(dir);
      else h.shoot();
    });
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Block scrolling, pinch-zoom and double-tap zoom while playing (dialogs may still scroll).
  const blockGesture = (e: Event) => {
    if (h.inGame() && !(e.target instanceof Element && e.target.closest('.modal'))) e.preventDefault();
  };
  document.addEventListener('touchmove', blockGesture, { passive: false });
  document.addEventListener('gesturestart', blockGesture as EventListener, { passive: false });
  document.addEventListener('dblclick', blockGesture, { passive: false });
  gameEl.addEventListener('contextmenu', (e) => e.preventDefault());
}
