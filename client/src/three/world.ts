import * as THREE from 'three';
import { KILL_CINEMATIC_MS, ROLE_LABEL, SHOT_SPEED } from '../../../shared/constants';
import { DIR_VEC, hasWall, type MazeData } from '../../../shared/maze';
import type { Dir, FxMsg, NpcView, ProjectileView, Role, Slot, StateMsg } from '../../../shared/protocol';
import { sfx } from '../audio';
import { Tween } from '../render/tween';
import { Assets, CELL, DIR_YAW, damp, forwardOf, isMobile, lerpAngle, makeLabel, toWorld } from './common';
import { Fx } from './fx';
import { Humanoid, NPC_OUTFIT } from './humanoid';
import { Maze3D } from './maze3d';

const PLAYER_COLORS: Record<Slot, number> = { 0: 0x22d3ee, 1: 0xfb923c };
const PLAYER_CSS: Record<Slot, string> = { 0: '#22d3ee', 1: '#fb923c' };
const ROLE_CSS: Record<Role, string> = { MP: '#facc15', BUSINESSMAN: '#4ade80', MLA: '#e879f9', POLICE: '#60a5fa' };
const BG = 0x070b14;

let sharedRenderer: THREE.WebGLRenderer | null = null;

/** One renderer for the page lifetime (browsers cap the number of WebGL contexts); scenes are per game. */
function rendererFor(canvas: HTMLCanvasElement, mobile: boolean): THREE.WebGLRenderer {
  if (sharedRenderer) return sharedRenderer;
  sharedRenderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile || devicePixelRatio < 2, powerPreference: 'high-performance' });
  sharedRenderer.setClearColor(BG);
  sharedRenderer.outputColorSpace = THREE.SRGBColorSpace;
  sharedRenderer.shadowMap.enabled = !mobile;
  sharedRenderer.shadowMap.type = THREE.PCFShadowMap;
  return sharedRenderer;
}

interface NpcEntry {
  view: NpcView;
  model: Humanoid;
  label: THREE.Sprite;
  tween: Tween;
  yaw: number;
  last: { x: number; y: number };
  /** Set once the NPC is resolved: plays its exit and then is removed. */
  exit: { kind: 'bribed' | 'failed' | 'skipped' | 'killed'; start: number } | null;
}

interface Cinematic {
  npcId: number;
  start: number;
  shots: number[];
  fired: number;
}

export interface FrameInfo {
  /** Interpolated player position in cell units (cell centre = x + 0.5). */
  me: { x: number; y: number };
  /** Camera yaw, for rotating the minimap with the view. */
  yaw: number;
}

export class World3D {
  private readonly assets = new Assets();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(62, 1, 0.08, 120);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly mobile = isMobile();
  private readonly maze3d: Maze3D;
  private readonly fx: Fx;
  private readonly torch = new THREE.PointLight(0xffb15c, 9, 9, 1.4);
  private readonly sun: THREE.DirectionalLight;
  private readonly me: Humanoid;
  private readonly opp: Humanoid;
  private readonly oppLabel: THREE.Sprite;
  private readonly meTween = new Tween();
  private readonly oppTween = new Tween();
  private readonly npcs = new Map<number, NpcEntry>();
  private maze: MazeData;
  private state: StateMsg | null = null;
  private stateAt = 0;
  private oppWasVisible = false;
  private meYaw = 0;
  private oppYaw = 0;
  private camYaw = 0;
  private camDist = 2.35;
  private camHeight = 1.45;
  private shake = 0;
  private aimUntil: [number, number] = [0, 0];
  private cinematic: Cinematic | null = null;
  private cineBlend = 0;
  private lastFrame = 0;
  private lastMe = { x: 0, y: 0 };
  private lastOpp = { x: 0, y: 0 };
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    maze: MazeData,
    private readonly you: Slot,
    names: [string, string],
  ) {
    this.maze = maze;
    this.renderer = rendererFor(canvas, this.mobile);
    this.scene.background = new THREE.Color(BG);
    this.scene.fog = new THREE.Fog(BG, 6, this.mobile ? 18 : 24);

    this.scene.add(new THREE.HemisphereLight(0x8fa6ff, 0x1a1410, 1.1));
    this.sun = new THREE.DirectionalLight(0xbfd0ff, 0.9);
    this.sun.position.set(-6, 14, -4);
    if (!this.mobile) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(1024, 1024);
      const c = this.sun.shadow.camera;
      c.left = c.bottom = -11;
      c.right = c.top = 11;
      c.near = 1;
      c.far = 40;
      this.sun.shadow.bias = -0.0015;
    }
    this.scene.add(this.sun, this.sun.target, this.torch);

    this.maze3d = new Maze3D(this.assets, maze, { shadows: !this.mobile });
    this.fx = new Fx(this.assets);
    this.scene.add(this.maze3d.group, this.fx.group);

    const oppSlot: Slot = you === 0 ? 1 : 0;
    this.me = this.makePlayer(you);
    this.opp = this.makePlayer(oppSlot);
    this.oppLabel = makeLabel(this.assets, names[oppSlot], PLAYER_CSS[oppSlot]);
    this.oppLabel.position.y = 1.7;
    this.opp.root.add(this.oppLabel);
    this.opp.root.visible = false;

    const start = maze.starts[you];
    this.meTween.snap(start.x, start.y);
    this.camYaw = this.meYaw = DIR_YAW[you === 0 ? 'right' : 'left'];
    this.resize();
  }

  private makePlayer(slot: Slot): Humanoid {
    const h = new Humanoid(this.assets, { kind: 'player', shirt: PLAYER_COLORS[slot], pants: 0x23283a, skin: slot === 0 ? 0xd9a477 : 0xb07850 });
    this.castShadows(h.root);
    this.scene.add(h.root);
    return h;
  }

  private castShadows(o: THREE.Object3D): void {
    if (this.mobile) return;
    o.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) c.castShadow = true;
    });
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Portrait screens get a wider vertical FOV so the corridor sides stay in view.
    this.camera.fov = w < h ? 74 : 60;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ server events

  onState(s: StateMsg, now: number): void {
    this.state = s;
    this.stateAt = now;
    this.meTween.target(s.me.x, s.me.y, s.me.moveMs, now);
    if (s.opp.visible && s.opp.x !== undefined && s.opp.y !== undefined) {
      if (!this.oppWasVisible) {
        this.oppTween.snap(s.opp.x, s.opp.y);
        if (s.opp.facing) this.oppYaw = DIR_YAW[s.opp.facing];
      } else this.oppTween.target(s.opp.x, s.opp.y, s.opp.moveMs, now);
    }
    this.oppWasVisible = s.opp.visible;
    this.maze3d.setPickups(s.pickups);
    this.maze3d.setReveal(s.reveal?.path ?? null);
    this.syncNpcs(s.npcs, now);
  }

  private syncNpcs(list: NpcView[], now: number): void {
    for (const v of list) {
      let e = this.npcs.get(v.id);
      if (!e) {
        if (v.status !== 'active') continue;
        const model = new Humanoid(this.assets, NPC_OUTFIT[v.role]);
        this.castShadows(model.root);
        const label = makeLabel(this.assets, ROLE_LABEL[v.role], ROLE_CSS[v.role], { scale: 0.85 });
        label.position.y = 1.72;
        model.root.add(label);
        const tween = new Tween();
        tween.snap(v.x, v.y);
        e = { view: v, model, label, tween, yaw: DIR_YAW[v.facing], last: { x: v.x, y: v.y }, exit: null };
        this.npcs.set(v.id, e);
        this.scene.add(model.root);
      }
      e.view = v;
      e.tween.target(v.x, v.y, v.moveMs, now);
      if (v.status !== 'active' && !e.exit) {
        e.exit = { kind: v.status === 'killed' ? 'killed' : (v.status as 'bribed' | 'failed' | 'skipped'), start: now };
        if (e.exit.kind === 'bribed') e.model.nod();
        else if (e.exit.kind === 'failed') e.model.shake();
      }
    }
  }

  onMaze(cells: number[], now: number): void {
    this.maze = { ...this.maze, cells };
    this.maze3d.setCells(this.maze, now);
    this.shake = Math.max(this.shake, 0.35);
  }

  onFx(f: FxMsg, now: number): void {
    const mine = f.slot === this.you;
    const actor = mine ? this.me : this.opp;
    switch (f.kind) {
      case 'shot':
        this.aimUntil[f.slot] = now + 380;
        if (mine || this.state?.opp.visible) {
          actor.aimTarget = 1;
          actor.kick();
          this.actorMuzzleSoon(actor, now);
        }
        if (mine) this.shake = Math.max(this.shake, 0.12);
        break;
      case 'hit': {
        const victim = mine ? this.me : this.opp;
        victim.hit();
        if (mine || this.state?.opp.visible) this.fx.burst(this.v1.copy(victim.root.position).setY(0.95), now, 10, 0xff5a5a);
        if (mine) this.shake = Math.max(this.shake, 0.4);
        break;
      }
      case 'cash':
        if (mine) this.fx.burst(this.v1.copy(this.me.root.position).setY(0.4), now, 14, 0x4ade80);
        break;
      case 'kill':
        if (mine && f.npcId !== undefined) this.startCinematic(f.npcId, now);
        break;
      default:
        break;
    }
  }

  /** The muzzle position depends on the arm pose, so flash one frame after the arm is raised. */
  private pendingMuzzle: { actor: Humanoid; at: number }[] = [];
  private actorMuzzleSoon(actor: Humanoid, now: number): void {
    this.pendingMuzzle.push({ actor, at: now + 30 });
  }

  private startCinematic(npcId: number, now: number): void {
    this.cinematic = { npcId, start: now, shots: [450, 720, 990, 1260], fired: 0 };
    this.me.gunHeld = true;
    this.me.aimTarget = 1;
    sfx.draw();
  }

  // ------------------------------------------------------------ frame

  frame(now: number): FrameInfo {
    const dt = Math.min(0.05, this.lastFrame ? (now - this.lastFrame) / 1000 : 0.016);
    this.lastFrame = now;
    const t = now / 1000;
    const s = this.state;

    // Player.
    const me = this.meTween.get(now);
    const facing: Dir = s?.me.facing ?? (this.you === 0 ? 'right' : 'left');
    this.meYaw = lerpAngle(this.meYaw, DIR_YAW[facing], damp(22, dt));
    const meSpeed = Math.hypot(me.x - this.lastMe.x, me.y - this.lastMe.y) / Math.max(dt, 1e-3);
    this.lastMe = me;
    const mePos = toWorld(me.x, me.y);
    const encNpc = s?.encounter?.npcId ?? this.cinematic?.npcId ?? null;
    if (encNpc !== null) mePos.addScaledVector(forwardOf(DIR_YAW[facing]), -0.3);
    this.me.root.position.copy(mePos);
    this.me.root.rotation.y = -this.meYaw;
    if (!this.cinematic && now > this.aimUntil[this.you]) this.me.aimTarget = 0;
    this.me.update(dt, meSpeed, t);

    // Opponent.
    const oppVisible = !!s?.opp.visible;
    this.opp.root.visible = oppVisible;
    if (oppVisible && s) {
      const o = this.oppTween.get(now);
      const oSpeed = Math.hypot(o.x - this.lastOpp.x, o.y - this.lastOpp.y) / Math.max(dt, 1e-3);
      this.lastOpp = o;
      if (s.opp.facing) this.oppYaw = lerpAngle(this.oppYaw, DIR_YAW[s.opp.facing], damp(18, dt));
      this.opp.root.position.copy(toWorld(o.x, o.y));
      this.opp.root.rotation.y = -this.oppYaw;
      if (now > this.aimUntil[this.you === 0 ? 1 : 0]) this.opp.aimTarget = 0;
      this.opp.update(dt, oSpeed, t);
    }

    for (const p of this.pendingMuzzle) {
      if (now >= p.at) this.fx.muzzle(p.actor.muzzleWorld(this.v1), now);
    }
    this.pendingMuzzle = this.pendingMuzzle.filter((p) => now < p.at);

    this.updateNpcs(now, dt, t, mePos, encNpc);
    this.updateCinematic(now);
    this.updateBullets(now);

    // Camera: behind and above, swinging to the new facing; pulled in when a wall is behind.
    this.camYaw = lerpAngle(this.camYaw, DIR_YAW[facing], damp(7, dt));
    const cf = forwardOf(this.camYaw);
    const cell = { x: Math.round(me.x), y: Math.round(me.y) };
    const back = DIR_VEC[oppositeOf(facing)];
    const want = 2.45;
    const free = this.maze3d.freeBehind(cell.x, cell.y, back, want);
    const dist = Math.min(want, Math.max(1.35, free));
    this.camDist += (dist - this.camDist) * damp(6, dt);
    // Stay in the corridor. A wall behind only pulls the camera closer, never up over the walls.
    this.camHeight += (1.42 + Math.max(0, want - dist) * 0.12 - this.camHeight) * damp(6, dt);
    this.cineBlend += ((this.cinematic ? 1 : 0) - this.cineBlend) * damp(5, dt);

    const camPos = this.v1.copy(mePos).addScaledVector(cf, -this.camDist);
    camPos.y = this.camHeight;
    this.look.copy(mePos).addScaledVector(cf, 4.2);
    this.look.y = 0.95;
    if (this.cineBlend > 0.001) {
      // Over-the-shoulder framing for the kill.
      const right = this.v2.set(-cf.z, 0, cf.x);
      const shoulder = mePos.clone().addScaledVector(cf, -1.5).addScaledVector(right, 0.72);
      shoulder.y = 1.75;
      camPos.lerp(shoulder, this.cineBlend);
      const target = mePos.clone().addScaledVector(cf, 1.6).addScaledVector(right, -0.15);
      target.y = 0.8;
      this.look.lerp(target, this.cineBlend);
    }
    if (this.shake > 0) {
      camPos.x += (Math.random() - 0.5) * this.shake * 0.3;
      camPos.y += (Math.random() - 0.5) * this.shake * 0.3;
      camPos.z += (Math.random() - 0.5) * this.shake * 0.3;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
    this.camera.position.copy(camPos);
    this.camera.lookAt(this.look);

    // Torch near the player's shoulder, flickering.
    this.torch.position.copy(mePos).addScaledVector(cf, 0.4);
    this.torch.position.y = 1.9;
    this.torch.intensity = 8.5 + Math.sin(t * 13) * 0.4 + Math.sin(t * 7.3) * 0.5;
    if (!this.mobile) {
      this.sun.position.set(mePos.x - 6, 14, mePos.z - 4);
      this.sun.target.position.copy(mePos);
    }

    this.maze3d.update(now, t);
    this.fx.update(now, dt);
    this.renderer.render(this.scene, this.camera);
    return { me, yaw: this.camYaw };
  }

  private updateNpcs(now: number, dt: number, t: number, mePos: THREE.Vector3, encNpc: number | null): void {
    const facing = this.state?.me.facing ?? 'up';
    for (const [id, e] of this.npcs) {
      const root = e.model.root;
      const engaged = id === encNpc;
      const cur = e.tween.get(now);
      const speed = Math.hypot(cur.x - e.last.x, cur.y - e.last.y) / Math.max(dt, 1e-3);
      e.last = cur;
      if (engaged || e.exit?.kind === 'killed') {
        // Stand face to face with the player inside their cell.
        const target = mePos.clone().addScaledVector(forwardOf(DIR_YAW[facing]), 1.05);
        root.position.lerp(target, engaged && !e.exit ? damp(10, dt) : 1);
        e.yaw = lerpAngle(e.yaw, DIR_YAW[facing] + Math.PI, damp(12, dt));
      } else if (!e.exit) {
        root.position.copy(toWorld(cur.x, cur.y));
        e.yaw = lerpAngle(e.yaw, DIR_YAW[e.view.facing], damp(10, dt));
      }
      root.rotation.y = -e.yaw;
      // Chasing NPCs get a pulsing label.
      e.label.material.opacity = e.view.mode === 'chase' ? 0.75 + Math.sin(t * 10) * 0.25 : 1;
      e.model.update(dt, e.exit ? 0 : speed, t);

      if (e.exit && e.exit.kind !== 'killed') {
        const k = (now - e.exit.start) / 1000;
        const hold = e.exit.kind === 'bribed' ? 0.8 : 0.5;
        if (k > hold) {
          const f = Math.min(1, (k - hold) / 0.5);
          root.scale.setScalar(1 - f);
          root.position.y = f * 0.8;
          if (f >= 1) this.removeNpc(id);
        }
      }
    }
  }

  private updateCinematic(now: number): void {
    const c = this.cinematic;
    if (!c) return;
    const e = this.npcs.get(c.npcId);
    const el = now - c.start;
    while (c.fired < c.shots.length && el >= c.shots[c.fired]) {
      c.fired++;
      const muzzle = this.me.muzzleWorld(new THREE.Vector3());
      this.me.kick();
      this.fx.muzzle(muzzle, now);
      sfx.gunshot();
      this.shake = Math.max(this.shake, 0.3);
      if (e) {
        const chest = e.model.root.position.clone();
        chest.y = 0.9 + (Math.random() - 0.5) * 0.25;
        chest.x += (Math.random() - 0.5) * 0.15;
        this.fx.tracer(muzzle, chest, now);
        this.fx.burst(chest, now, 8, 0xc0262d);
        e.model.hit();
      }
    }
    if (e) {
      e.model.fall = Math.min(1, Math.max(0, (el - 1380) / 450));
      if (el > 2050) {
        const f = Math.min(1, (el - 2050) / 450);
        e.model.root.scale.setScalar(1 - f * 0.9);
        e.model.root.position.y = -f * 0.4;
      }
    }
    if (el > 1850) {
      this.me.gunHeld = false;
      this.me.aimTarget = 0;
    }
    if (el >= KILL_CINEMATIC_MS) {
      this.cinematic = null;
      this.removeNpc(c.npcId);
    }
  }

  private removeNpc(id: number): void {
    const e = this.npcs.get(id);
    if (!e) return;
    this.scene.remove(e.model.root);
    this.npcs.delete(id);
  }

  private updateBullets(now: number): void {
    const s = this.state;
    if (!s) {
      this.fx.setBullets([]);
      return;
    }
    const elapsed = now - this.stateAt;
    this.fx.setBullets(
      s.projectiles.map((p) => {
        const at = projectilePos(this.maze, p, elapsed);
        const v = DIR_VEC[p.dir];
        return {
          id: p.id,
          pos: new THREE.Vector3(at.x * CELL, 1.05, at.y * CELL),
          dir: new THREE.Vector3(v.x, 0, v.y),
          color: PLAYER_COLORS[p.owner],
        };
      }),
    );
  }

  /** True while the kill cinematic is playing (input stays locked). */
  inCinematic(): boolean {
    return !!this.cinematic;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.clear();
    this.maze3d.dispose();
    this.assets.dispose();
    this.renderer.renderLists.dispose();
  }
}

function oppositeOf(d: Dir): Dir {
  return d === 'up' ? 'down' : d === 'down' ? 'up' : d === 'left' ? 'right' : 'left';
}

/** Extrapolates a projectile between server ticks without letting it pass through walls. Returns cell-space coordinates. */
function projectilePos(maze: MazeData, p: ProjectileView, elapsedMs: number): { x: number; y: number } {
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
  return { x: x + 0.5 + v.x * t, y: y + 0.5 + v.y * t };
}
