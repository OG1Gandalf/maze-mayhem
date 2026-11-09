import * as THREE from 'three';
import type { Dir } from '../../../shared/protocol';

/** World units per maze cell. Grid x maps to world x, grid y to world z. */
export const CELL = 2;
export const WALL_H = 2.55;
export const WALL_T = 0.18;

export const toWorld = (x: number, y: number): THREE.Vector3 => new THREE.Vector3((x + 0.5) * CELL, 0, (y + 0.5) * CELL);

/** Yaw where forward = (sin yaw, 0, -cos yaw): up = 0, right = pi/2, down = pi, left = -pi/2. */
export const DIR_YAW: Record<Dir, number> = { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 };

export function forwardOf(yaw: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(Math.sin(yaw), 0, -Math.cos(yaw));
}

/** Moves angle `a` towards `b` along the shortest arc by fraction `t`. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Frame-rate independent smoothing factor for exponential approach. */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

export const isMobile = (): boolean => matchMedia('(pointer: coarse)').matches;

/**
 * Geometry/material cache shared by everything in one game. `dispose()` frees all of it when leaving a game.
 */
export class Assets {
  private readonly geoms = new Map<string, THREE.BufferGeometry>();
  private readonly mats = new Map<string, THREE.Material>();
  private readonly extra: { dispose(): void }[] = [];

  geom<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
    let g = this.geoms.get(key);
    if (!g) {
      g = make();
      this.geoms.set(key, g);
    }
    return g as T;
  }

  /** Flat-shaded Lambert material shared by colour. */
  lambert(color: number, opts: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
    const key = `l${color}:${JSON.stringify(opts)}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
      this.mats.set(key, m);
    }
    return m as THREE.MeshLambertMaterial;
  }

  /** Unlit additive glow material shared by colour. */
  glow(color: number, opacity = 1, fog = true): THREE.MeshBasicMaterial {
    const key = `g${color}:${opacity}:${fog}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog,
      });
      this.mats.set(key, m);
    }
    return m as THREE.MeshBasicMaterial;
  }

  box(w: number, h: number, d: number): THREE.BoxGeometry {
    return this.geom(`box${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
  }

  cyl(rt: number, rb: number, h: number, seg = 6): THREE.CylinderGeometry {
    return this.geom(`cyl${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
  }

  /** Tracks something else (textures, per-character materials) to dispose with the game. */
  track<T extends { dispose(): void }>(thing: T): T {
    this.extra.push(thing);
    return thing;
  }

  dispose(): void {
    for (const g of this.geoms.values()) g.dispose();
    for (const m of this.mats.values()) m.dispose();
    for (const x of this.extra) x.dispose();
    this.geoms.clear();
    this.mats.clear();
    this.extra.length = 0;
  }
}

/** Text label drawn to a canvas texture, shown as a camera-facing sprite. */
export function makeLabel(assets: Assets, text: string, color: string, opts: { bg?: string; scale?: number } = {}): THREE.Sprite {
  const scale = opts.scale ?? 1;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = '700 40px system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 36;
  canvas.width = w;
  canvas.height = 64;
  ctx.font = font;
  ctx.fillStyle = opts.bg ?? '#070b14cc';
  ctx.beginPath();
  ctx.roundRect(2, 4, w - 4, 56, 18);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, 34);
  const tex = assets.track(new THREE.CanvasTexture(canvas));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const mat = assets.track(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  const sprite = new THREE.Sprite(mat);
  const h = 0.32 * scale;
  sprite.scale.set((h * w) / 64, h, 1);
  sprite.renderOrder = 10;
  return sprite;
}
