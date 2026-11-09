import * as THREE from 'three';
import type { Role } from '../../../shared/protocol';
import { damp, type Assets } from './common';

export type HumanoidKind = 'player' | Role;

export interface HumanoidOpts {
  kind: HumanoidKind;
  shirt: number;
  pants: number;
  skin?: number;
  hair?: number;
  shoes?: number;
}

/** Role outfits: colours plus a prop or two, so each NPC reads at a glance. */
export const NPC_OUTFIT: Record<Role, HumanoidOpts> = {
  POLICE: { kind: 'POLICE', shirt: 0xb59a5a, pants: 0x8c7642, skin: 0xa86b45, hair: 0x1b1410 },
  MP: { kind: 'MP', shirt: 0xf3f0e6, pants: 0xe8e4d6, skin: 0xb77a4f, hair: 0xdedede },
  MLA: { kind: 'MLA', shirt: 0xf5f5ef, pants: 0xdcd8c8, skin: 0x9a6340, hair: 0x2a1d14 },
  BUSINESSMAN: { kind: 'BUSINESSMAN', shirt: 0x1e2a4a, pants: 0x1a2340, skin: 0xc48a5f, hair: 0x15100c },
};

/** Low-poly procedural character, modelled facing -z with its origin at the feet. */
export class Humanoid {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly head = new THREE.Group();
  readonly armL = new THREE.Group();
  readonly armR = new THREE.Group();
  readonly legL = new THREE.Group();
  readonly legR = new THREE.Group();
  readonly gun = new THREE.Group();
  private readonly muzzle = new THREE.Object3D();
  private readonly shirtMat: THREE.MeshLambertMaterial;

  private phase = 0;
  /** 0..1 how far the right arm is raised to aim. */
  private aim = 0;
  aimTarget = 0;
  gunHeld = false;
  private recoil = 0;
  private hitGlow = 0;
  private nodT = 0;
  private shakeT = 0;
  /** 0..1 fall-over progress (death). */
  fall = 0;

  constructor(private readonly assets: Assets, opts: HumanoidOpts) {
    const a = assets;
    const skin = a.lambert(opts.skin ?? 0xd8a27a);
    const hair = a.lambert(opts.hair ?? 0x2b1d12);
    const pants = a.lambert(opts.pants);
    const shoes = a.lambert(opts.shoes ?? 0x1a1a1f);
    const dark = a.lambert(0x111318);
    // Own shirt material so hits can flash this character red without affecting others.
    this.shirtMat = assets.track(new THREE.MeshLambertMaterial({ color: opts.shirt, flatShading: true, emissive: 0x000000 }));
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z);
      return o;
    };

    this.root.add(this.body);

    // Legs (pivot at the hip).
    for (const [leg, x] of [[this.legL, -0.09], [this.legR, 0.09]] as const) {
      leg.position.set(x, 0.6, 0);
      leg.add(mesh(a.box(0.13, 0.56, 0.14), pants, 0, -0.28, 0));
      leg.add(mesh(a.box(0.14, 0.07, 0.22), shoes, 0, -0.565, -0.04));
      this.body.add(leg);
    }
    this.body.add(mesh(a.box(0.34, 0.14, 0.2), pants, 0, 0.64, 0));

    // Torso: tapered hexagonal prism, flattened front-to-back.
    const torso = mesh(a.cyl(0.21, 0.17, 0.44, 6), this.shirtMat, 0, 0.9, 0);
    torso.scale.z = 0.62;
    this.body.add(torso);

    // Head.
    this.head.position.set(0, 1.12, 0);
    this.head.add(mesh(a.box(0.07, 0.08, 0.07), skin, 0, 0.02, 0));
    this.head.add(mesh(a.box(0.22, 0.24, 0.22), skin, 0, 0.17, 0));
    this.head.add(mesh(a.box(0.235, 0.07, 0.235), hair, 0, 0.3, 0.005));
    this.head.add(mesh(a.box(0.04, 0.035, 0.02), dark, -0.05, 0.19, -0.112));
    this.head.add(mesh(a.box(0.04, 0.035, 0.02), dark, 0.05, 0.19, -0.112));
    this.body.add(this.head);

    // Arms (pivot at the shoulder), hands at the end.
    for (const [arm, x] of [[this.armL, -0.26], [this.armR, 0.26]] as const) {
      arm.position.set(x, 1.06, 0);
      arm.add(mesh(a.box(0.1, 0.5, 0.11), this.shirtMat, 0, -0.24, 0));
      arm.add(mesh(a.box(0.09, 0.09, 0.09), skin, 0, -0.52, 0));
      this.body.add(arm);
    }

    // Pistol, mounted in the right hand pointing along the arm.
    const steel = a.lambert(0x2a2d33);
    this.gun.add(mesh(a.box(0.05, 0.06, 0.22), steel, 0, 0.03, -0.06));
    this.gun.add(mesh(a.box(0.045, 0.11, 0.05), a.lambert(0x3b2a1f), 0, -0.03, 0.02));
    this.muzzle.position.set(0, 0.03, -0.19);
    this.gun.add(this.muzzle);
    this.gun.position.set(0, -0.55, -0.02);
    this.gun.rotation.x = -Math.PI / 2;
    this.gun.visible = false;
    this.armR.add(this.gun);

    this.addOutfit(opts, mesh);
  }

  private addOutfit(opts: HumanoidOpts, mesh: (g: THREE.BufferGeometry, m: THREE.Material, x?: number, y?: number, z?: number) => THREE.Mesh): void {
    const a = this.assets;
    const dark = a.lambert(0x111318);
    switch (opts.kind) {
      case 'player': {
        const pack = mesh(a.box(0.26, 0.3, 0.12), a.lambert(new THREE.Color(opts.shirt).multiplyScalar(0.45).getHex()), 0, 0.92, 0.16);
        this.body.add(pack);
        this.head.add(mesh(a.box(0.24, 0.04, 0.24), a.lambert(opts.shirt, { emissive: opts.shirt, emissiveIntensity: 0.5 }), 0, 0.25, 0));
        break;
      }
      case 'POLICE': {
        const khaki = a.lambert(0x9c8148);
        this.head.add(mesh(a.cyl(0.14, 0.13, 0.08, 8), khaki, 0, 0.36, 0));
        this.head.add(mesh(a.box(0.2, 0.02, 0.1), a.lambert(0x1a1a1a), 0, 0.33, -0.12));
        this.head.add(mesh(a.box(0.12, 0.025, 0.02), dark, 0, 0.13, -0.112));
        this.body.add(mesh(a.box(0.36, 0.05, 0.22), a.lambert(0x4a2e18), 0, 0.72, 0));
        const lathi = mesh(a.cyl(0.02, 0.02, 0.8, 5), a.lambert(0x6b4420), 0, -0.5, -0.25);
        lathi.rotation.x = Math.PI / 2.4;
        this.armR.add(lathi);
        break;
      }
      case 'MP': {
        this.body.add(mesh(a.box(0.34, 0.26, 0.2), a.lambert(0xf3f0e6), 0, 0.56, 0));
        const vest = mesh(a.box(0.3, 0.36, 0.05), a.lambert(0x2b2f3a), 0, 0.9, -0.1);
        this.body.add(vest);
        const sash = mesh(a.box(0.07, 0.56, 0.03), a.lambert(0xff9933, { emissive: 0x552200 }), 0, 0.9, -0.13);
        sash.rotation.z = 0.6;
        this.body.add(sash);
        this.head.add(mesh(a.box(0.2, 0.05, 0.03), a.lambert(0x050505), 0, 0.19, -0.115));
        break;
      }
      case 'MLA': {
        this.body.add(mesh(a.box(0.34, 0.26, 0.2), a.lambert(0xf5f5ef), 0, 0.56, 0));
        this.head.add(mesh(a.box(0.25, 0.08, 0.15), a.lambert(0xffffff), 0, 0.34, 0));
        this.body.add(mesh(a.box(0.06, 0.5, 0.03), a.lambert(0x138808), -0.08, 0.92, -0.12));
        const files = mesh(a.box(0.22, 0.05, 0.3), a.lambert(0xd9b98a), 0.02, -0.35, -0.1);
        files.rotation.z = 0.15;
        this.armL.add(files);
        break;
      }
      case 'BUSINESSMAN': {
        this.body.add(mesh(a.box(0.1, 0.36, 0.03), a.lambert(0xffffff), 0, 0.92, -0.11));
        this.body.add(mesh(a.box(0.05, 0.3, 0.035), a.lambert(0xc81e1e, { emissive: 0x330000 }), 0, 0.9, -0.125));
        this.armL.add(mesh(a.box(0.08, 0.24, 0.32), a.lambert(0x6b3e1f), 0, -0.66, 0));
        this.head.add(mesh(a.box(0.23, 0.04, 0.05), a.lambert(0xd4af37), 0, 0.12, -0.11));
        break;
      }
    }
  }

  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    return this.muzzle.getWorldPosition(out);
  }

  /** Flinch backwards with a red flash. */
  hit(): void {
    this.recoil = 1;
    this.hitGlow = 1;
  }

  nod(): void {
    this.nodT = 1;
  }

  shake(): void {
    this.shakeT = 1;
  }

  /** Kicks the arm up after a shot. */
  kick(): void {
    this.aim = Math.max(this.aim, 1.15);
  }

  /** `speed` in cells per second (0 = idle). */
  update(dt: number, speed: number, t: number): void {
    const moving = speed > 0.05;
    if (moving) this.phase += dt * Math.min(speed, 8) * 4.2;
    const swing = moving ? Math.sin(this.phase) * 0.75 : 0;
    const k = damp(moving ? 18 : 10, dt);
    this.legL.rotation.x += (swing - this.legL.rotation.x) * k;
    this.legR.rotation.x += (-swing - this.legR.rotation.x) * k;
    const idleSway = moving ? 0 : Math.sin(t * 1.7) * 0.04;
    this.armL.rotation.x += (-swing * 0.8 + idleSway - this.armL.rotation.x) * k;
    this.body.position.y = moving ? Math.abs(Math.sin(this.phase)) * 0.05 : Math.sin(t * 2) * 0.006;
    this.body.rotation.y = moving ? Math.sin(this.phase) * 0.06 : 0;

    this.aim += (this.aimTarget - this.aim) * damp(14, dt);
    const armSwing = swing * 0.8 * (1 - Math.min(1, this.aim)) - idleSway;
    this.armR.rotation.x = armSwing + this.aim * (Math.PI / 2);
    this.gun.visible = this.gunHeld || this.aim > 0.3;

    this.recoil = Math.max(0, this.recoil - dt * 4);
    this.hitGlow = Math.max(0, this.hitGlow - dt * 3.5);
    this.shirtMat.emissive.setRGB(this.hitGlow * 0.9, 0, 0);

    this.nodT = Math.max(0, this.nodT - dt * 1.4);
    this.shakeT = Math.max(0, this.shakeT - dt * 1.3);
    this.head.rotation.x = Math.sin(this.nodT * Math.PI * 4) * 0.35 * this.nodT;
    this.head.rotation.y = Math.sin(this.shakeT * Math.PI * 6) * 0.5 * this.shakeT;

    const f = this.fall * this.fall * (3 - 2 * this.fall);
    this.body.rotation.x = f * (Math.PI / 2) - this.recoil * 0.3;
  }
}
