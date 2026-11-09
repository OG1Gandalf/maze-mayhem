import * as THREE from 'three';
import { hasWall, type MazeData, type Point } from '../../../shared/maze';
import type { CashPickupView } from '../../../shared/protocol';
import { CELL, WALL_H, WALL_T, toWorld, type Assets } from './common';

type WallKey = string;

/** Every wall segment in the maze: 'h' runs along x at the top edge of (x,y), 'v' along z at its left edge. */
function wallKeys(m: MazeData): Set<WallKey> {
  const keys = new Set<WallKey>();
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (hasWall(m, x, y, 'up')) keys.add(`h,${x},${y}`);
      if (hasWall(m, x, y, 'left')) keys.add(`v,${x},${y}`);
      if (y === m.height - 1 && hasWall(m, x, y, 'down')) keys.add(`h,${x},${y + 1}`);
      if (x === m.width - 1 && hasWall(m, x, y, 'right')) keys.add(`v,${x + 1},${y}`);
    }
  }
  return keys;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

function wallMatrix(key: WallKey, sink = 0, out = tmpM): THREE.Matrix4 {
  const [kind, xs, ys] = key.split(',');
  const x = Number(xs);
  const y = Number(ys);
  const len = CELL + WALL_T;
  if (kind === 'h') {
    tmpP.set((x + 0.5) * CELL, WALL_H / 2 - sink, y * CELL);
    tmpS.set(len, WALL_H, WALL_T);
  } else {
    tmpP.set(x * CELL, WALL_H / 2 - sink, (y + 0.5) * CELL);
    tmpS.set(WALL_T, WALL_H, len);
  }
  return out.compose(tmpP, tmpQ.identity(), tmpS);
}

function floorTexture(assets: Assets): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#141b2c';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#18213a';
  g.fillRect(6, 6, 116, 116);
  g.strokeStyle = '#0c111e';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 125, 125);
  g.strokeStyle = '#1e2946';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(64, 10);
  g.lineTo(64, 118);
  g.moveTo(10, 64);
  g.lineTo(118, 64);
  g.stroke();
  const tex = assets.track(new THREE.CanvasTexture(c));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

export class Maze3D {
  readonly group = new THREE.Group();
  private readonly walls: THREE.InstancedMesh;
  private readonly caps: THREE.InstancedMesh;
  private readonly sinking: THREE.InstancedMesh;
  private keys: Set<WallKey>;
  private sinkList: { key: WallKey; start: number }[] = [];
  private readonly beaconInner: THREE.Mesh;
  private readonly beaconOuter: THREE.Mesh;
  private readonly rings: THREE.Mesh[] = [];
  private readonly markers: THREE.InstancedMesh;
  private readonly markerMat: THREE.MeshBasicMaterial;
  private readonly pickups = new Map<number, THREE.Group>();
  private readonly bundleParts: { geom: THREE.BufferGeometry; mat: THREE.Material; pos: [number, number, number] }[];
  private readonly maxWalls: number;

  constructor(assets: Assets, private maze: MazeData, opts: { shadows: boolean }) {
    const w = maze.width * CELL;
    const h = maze.height * CELL;

    const floorTex = floorTexture(assets);
    floorTex.repeat.set(maze.width, maze.height);
    const floor = new THREE.Mesh(
      assets.geom('floor', () => new THREE.PlaneGeometry(w, h)),
      assets.track(new THREE.MeshLambertMaterial({ map: floorTex })),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(w / 2, 0, h / 2);
    floor.receiveShadow = opts.shadows;
    this.group.add(floor);

    // Walls are a single instanced box; MLA shortcuts just rewrite the instance matrices.
    this.maxWalls = 2 * (maze.width + 1) * (maze.height + 1);
    const unit = assets.box(1, 1, 1);
    this.walls = new THREE.InstancedMesh(unit, assets.lambert(0x2c3a5e), this.maxWalls);
    this.walls.castShadow = opts.shadows;
    this.walls.receiveShadow = opts.shadows;
    this.caps = new THREE.InstancedMesh(unit, new THREE.MeshBasicMaterial({ color: 0x3557b0 }), this.maxWalls);
    assets.track(this.caps.material as THREE.Material);
    this.sinking = new THREE.InstancedMesh(unit, assets.lambert(0x2c3a5e), 16);
    this.sinking.count = 0;
    this.group.add(this.walls, this.caps, this.sinking);
    this.keys = wallKeys(maze);
    this.writeWalls();

    // Goal: glowing floor pad and a light pillar that ignores fog so it is visible from anywhere.
    const goal = toWorld(maze.goal.x, maze.goal.y);
    const pad = new THREE.Mesh(assets.geom('pad', () => new THREE.CircleGeometry(0.8, 24)), assets.glow(0xfacc15, 0.55));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(goal.x, 0.02, goal.z);
    this.beaconOuter = new THREE.Mesh(
      assets.geom('beaconO', () => new THREE.CylinderGeometry(0.55, 0.75, 60, 16, 1, true)),
      assets.glow(0xfbbf24, 0.18, false),
    );
    this.beaconOuter.position.set(goal.x, 30, goal.z);
    this.beaconInner = new THREE.Mesh(
      assets.geom('beaconI', () => new THREE.CylinderGeometry(0.16, 0.22, 60, 10, 1, true)),
      assets.glow(0xfff3c4, 0.6, false),
    );
    this.beaconInner.position.copy(this.beaconOuter.position);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(assets.geom('ring', () => new THREE.TorusGeometry(0.7, 0.04, 6, 24)), assets.glow(0xfacc15, 0.7, false));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(goal.x, 0.4 + i * 0.6, goal.z);
      this.rings.push(ring);
    }
    const goalLight = new THREE.PointLight(0xffc94a, 6, 7, 1.6);
    goalLight.position.set(goal.x, 1.6, goal.z);
    this.group.add(pad, this.beaconOuter, this.beaconInner, goalLight, ...this.rings);

    // MP path reveal: glowing chevrons on the floor.
    const chevron = assets.geom('chevron', () => {
      const s = new THREE.Shape();
      s.moveTo(-0.32, 0.12);
      s.lineTo(0, -0.22);
      s.lineTo(0.32, 0.12);
      s.lineTo(0.32, 0.3);
      s.lineTo(0, -0.04);
      s.lineTo(-0.32, 0.3);
      s.closePath();
      const g = new THREE.ShapeGeometry(s);
      g.rotateX(-Math.PI / 2);
      return g;
    });
    this.markerMat = assets.track(
      new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.markers = new THREE.InstancedMesh(chevron, this.markerMat, maze.width * maze.height);
    this.markers.count = 0;
    this.markers.renderOrder = 2;
    this.group.add(this.markers);

    const bill = assets.box(0.46, 0.06, 0.22);
    const band = assets.box(0.08, 0.065, 0.225);
    const green = assets.lambert(0x2f9e55, { emissive: 0x0b3d1c });
    const paper = assets.lambert(0xf5f0dc);
    this.bundleParts = [];
    for (let i = 0; i < 3; i++) {
      this.bundleParts.push({ geom: bill, mat: green, pos: [0, 0.03 + i * 0.065, 0] });
      this.bundleParts.push({ geom: band, mat: paper, pos: [0, 0.03 + i * 0.065, 0] });
    }
  }

  private writeWalls(): void {
    let i = 0;
    for (const key of this.keys) {
      this.walls.setMatrixAt(i, wallMatrix(key));
      const m = wallMatrix(key);
      // Thin glowing strip along the top edge.
      m.elements[5] = 0.03;
      m.elements[13] = WALL_H + 0.015;
      this.caps.setMatrixAt(i, m);
      i++;
    }
    this.walls.count = this.caps.count = i;
    this.walls.instanceMatrix.needsUpdate = true;
    this.caps.instanceMatrix.needsUpdate = true;
    this.walls.computeBoundingSphere();
    this.caps.computeBoundingSphere();
  }

  /** Live MLA shortcut: removed walls sink into the floor. */
  setCells(maze: MazeData, now: number): void {
    this.maze = maze;
    const next = wallKeys(maze);
    for (const k of this.keys) if (!next.has(k)) this.sinkList.push({ key: k, start: now });
    this.keys = next;
    this.writeWalls();
  }

  setPickups(list: CashPickupView[]): void {
    const live = new Set(list.map((p) => p.id));
    for (const [id, g] of this.pickups) {
      if (!live.has(id)) {
        this.group.remove(g);
        this.pickups.delete(id);
      }
    }
    for (const p of list) {
      if (this.pickups.has(p.id)) continue;
      const g = new THREE.Group();
      // Bigger pickups get a second bundle.
      const bundles = p.value >= 13 ? 2 : 1;
      for (let b = 0; b < bundles; b++) {
        for (const part of this.bundleParts) {
          const mesh = new THREE.Mesh(part.geom, part.mat);
          mesh.position.set(part.pos[0] + (b ? 0.16 : 0), part.pos[1] + (b ? 0.2 : 0), part.pos[2] + (b ? 0.05 : 0));
          mesh.rotation.y = b ? 0.5 : 0;
          g.add(mesh);
        }
      }
      const at = toWorld(p.x, p.y);
      g.position.set(at.x, 0.25, at.z);
      g.userData.phase = (p.id * 1.7) % (Math.PI * 2);
      this.pickups.set(p.id, g);
      this.group.add(g);
    }
  }

  setReveal(path: Point[] | null): void {
    if (!path || path.length < 2) {
      this.markers.count = 0;
      return;
    }
    let n = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const p = toWorld(a.x, a.y);
      tmpP.set(p.x, 0.03, p.z);
      // The chevron tip points along +z; turn it to point from a to b.
      const yaw = Math.atan2(b.x - a.x, b.y - a.y);
      tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      tmpS.set(1, 1, 1);
      this.markers.setMatrixAt(n++, tmpM.compose(tmpP, tmpQ, tmpS));
    }
    this.markers.count = n;
    this.markers.instanceMatrix.needsUpdate = true;
    this.markers.computeBoundingSphere();
  }

  update(now: number, t: number): void {
    this.beaconOuter.rotation.y = t * 0.4;
    (this.beaconOuter.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(t * 2.2) * 0.04;
    this.rings.forEach((r, i) => {
      const k = (t * 0.35 + i / 3) % 1;
      r.position.y = 0.2 + k * 2.2;
      r.scale.setScalar(1.1 - k * 0.5);
    });
    this.markerMat.opacity = 0.55 + Math.sin(t * 5) * 0.3;
    for (const g of this.pickups.values()) {
      g.rotation.y = t * 1.6 + g.userData.phase;
      g.position.y = 0.25 + Math.sin(t * 2.5 + g.userData.phase) * 0.07;
    }
    this.sinkList = this.sinkList.filter((s) => now - s.start < 1100);
    this.sinking.count = this.sinkList.length;
    this.sinkList.forEach((s, i) => {
      const k = Math.min(1, (now - s.start) / 1000);
      const m = wallMatrix(s.key, k * k * WALL_H);
      // Shudder while sinking.
      m.elements[12] += Math.sin(now * 0.08 + i) * 0.03 * (1 - k);
      this.sinking.setMatrixAt(i, m);
    });
    if (this.sinkList.length) {
      this.sinking.instanceMatrix.needsUpdate = true;
      this.sinking.computeBoundingSphere();
    }
  }

  dispose(): void {
    this.walls.dispose();
    this.caps.dispose();
    this.sinking.dispose();
    this.markers.dispose();
  }

  /** How far (world units) the camera can sit behind a cell centre before hitting a wall, looking along `dir` backwards. */
  freeBehind(x: number, y: number, back: { x: number; y: number }, max: number): number {
    const dir = back.x > 0 ? 'right' : back.x < 0 ? 'left' : back.y > 0 ? 'down' : 'up';
    let dist = CELL / 2 - 0.25;
    let cx = x;
    let cy = y;
    while (dist < max) {
      if (hasWall(this.maze, cx, cy, dir)) return dist;
      cx += back.x;
      cy += back.y;
      dist += CELL;
    }
    return max;
  }
}
