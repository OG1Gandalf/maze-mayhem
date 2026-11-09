import * as THREE from 'three';
import type { Assets } from './common';

interface Timed {
  mesh: THREE.Mesh;
  start: number;
  dur: number;
  active: boolean;
}

interface Spark extends Timed {
  vel: THREE.Vector3;
}

const Z = new THREE.Vector3(0, 0, 1);

/** Pooled short-lived effects. Lights are created once up front: adding lights later would recompile shaders. */
export class Fx {
  readonly group = new THREE.Group();
  private readonly flashLight = new THREE.PointLight(0xffc266, 0, 6, 2);
  private flashUntil = 0;
  private readonly flashes: Timed[] = [];
  private readonly tracers: Timed[] = [];
  private readonly sparks: Spark[] = [];
  private readonly bullets = new Map<number, THREE.Group>();
  private readonly bulletPool: THREE.Group[] = [];

  constructor(private readonly assets: Assets) {
    this.group.add(this.flashLight);
    const flashGeom = assets.geom('flash', () => new THREE.IcosahedronGeometry(0.12, 0));
    for (let i = 0; i < 4; i++) {
      const mesh = new THREE.Mesh(flashGeom, assets.glow(0xffd27a, 1));
      mesh.visible = false;
      this.flashes.push({ mesh, start: 0, dur: 70, active: false });
      this.group.add(mesh);
    }
    const unit = assets.box(1, 1, 1);
    for (let i = 0; i < 8; i++) {
      const mat = assets.track(
        new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      const mesh = new THREE.Mesh(unit, mat);
      mesh.visible = false;
      this.tracers.push({ mesh, start: 0, dur: 120, active: false });
      this.group.add(mesh);
    }
    for (let i = 0; i < 48; i++) {
      const mesh = new THREE.Mesh(assets.box(0.04, 0.04, 0.04), assets.glow(0xffb347, 1));
      mesh.visible = false;
      this.sparks.push({ mesh, start: 0, dur: 350, active: false, vel: new THREE.Vector3() });
      this.group.add(mesh);
    }
  }

  private take<T extends Timed>(pool: T[], now: number): T {
    const free = pool.find((p) => !p.active) ?? pool.reduce((a, b) => (a.start < b.start ? a : b));
    free.active = true;
    free.start = now;
    free.mesh.visible = true;
    return free;
  }

  muzzle(pos: THREE.Vector3, now: number): void {
    const f = this.take(this.flashes, now);
    f.mesh.position.copy(pos);
    f.mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    this.flashLight.position.copy(pos);
    this.flashLight.intensity = 14;
    this.flashUntil = now + 60;
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, now: number): void {
    const t = this.take(this.tracers, now);
    const len = from.distanceTo(to);
    t.mesh.position.copy(from).lerp(to, 0.5);
    t.mesh.quaternion.setFromUnitVectors(Z, to.clone().sub(from).normalize());
    t.mesh.scale.set(0.03, 0.03, len);
    (t.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
  }

  burst(pos: THREE.Vector3, now: number, count = 10, color?: number): void {
    for (let i = 0; i < count; i++) {
      const s = this.take(this.sparks, now);
      s.mesh.position.copy(pos);
      if (color !== undefined) s.mesh.material = this.assets.glow(color, 1);
      s.vel.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 2.5);
      s.dur = 250 + Math.random() * 250;
    }
  }

  /** PvP projectiles: a glowing slug with a tracer tail, pooled by projectile id. */
  setBullets(list: { id: number; pos: THREE.Vector3; dir: THREE.Vector3; color: number }[]): void {
    const live = new Set(list.map((b) => b.id));
    for (const [id, g] of this.bullets) {
      if (!live.has(id)) {
        g.visible = false;
        this.bulletPool.push(g);
        this.bullets.delete(id);
      }
    }
    for (const b of list) {
      let g = this.bullets.get(b.id);
      if (!g) {
        g = this.bulletPool.pop() ?? this.makeBullet();
        g.visible = true;
        (g.children[1] as THREE.Mesh).material = this.assets.glow(b.color, 0.55);
        this.bullets.set(b.id, g);
      }
      g.position.copy(b.pos);
      g.quaternion.setFromUnitVectors(Z, b.dir);
    }
  }

  private makeBullet(): THREE.Group {
    const g = new THREE.Group();
    const slug = new THREE.Mesh(this.assets.box(0.06, 0.06, 0.22), this.assets.glow(0xfff1b8, 1));
    const tail = new THREE.Mesh(this.assets.box(0.035, 0.035, 1.1), this.assets.glow(0xffffff, 0.55));
    tail.position.z = -0.6;
    g.add(slug, tail);
    this.group.add(g);
    return g;
  }

  update(now: number, dt: number): void {
    this.flashLight.intensity = now < this.flashUntil ? 14 : Math.max(0, this.flashLight.intensity - dt * 200);
    for (const f of this.flashes) {
      if (!f.active) continue;
      const k = (now - f.start) / f.dur;
      if (k >= 1) {
        f.active = f.mesh.visible = false;
        continue;
      }
      f.mesh.scale.setScalar(1.6 - k);
    }
    for (const t of this.tracers) {
      if (!t.active) continue;
      const k = (now - t.start) / t.dur;
      if (k >= 1) {
        t.active = t.mesh.visible = false;
        continue;
      }
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k;
    }
    for (const s of this.sparks) {
      if (!s.active) continue;
      const k = (now - s.start) / s.dur;
      if (k >= 1) {
        s.active = s.mesh.visible = false;
        continue;
      }
      s.vel.y -= dt * 9;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.scale.setScalar(1 - k);
    }
  }
}
