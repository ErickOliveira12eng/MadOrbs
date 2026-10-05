// The waves mode on screen: the crates (wooden boxes drawn here: the original game has no crate
// model), their splinters when they break, and the power-ups waiting on the floor (a bobbing icon
// over a glowing ring). Plain materials, like the rest of the game's look.
import * as THREE from 'three';
import { CRATE_LIFE, type Crate } from '../../sim/crate';
import { powerIcon } from '../powerIcons';
import { POWERS, type PowerKind } from '../waves';

/** An enemy under the poison or ice shots (a ring under it, green or icy blue). */
export interface AilmentMark {
  id: number;
  x: number;
  y: number;
  poison: boolean;
  ice: boolean;
}

/** A power-up on the floor, as the run keeps it. */
export interface FloorPower {
  id: number;
  kind: PowerKind;
  x: number;
  y: number;
  /** Seconds it has waited. */
  age: number;
  /** Seconds it may wait. */
  life: number;
}

const CRATE_SIZE = 0.6;
const CRATE_HEIGHT = 0.5;

/** The crate's sides: planks with dark seams, a darker frame and metal corners. */
function crateTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#9a6a3a';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 4; i++) {
    const y = i * 32;
    g.fillStyle = i % 2 ? '#a8763f' : '#93622f';
    g.fillRect(0, y + 2, 128, 28);
    g.fillStyle = 'rgba(60,32,10,0.35)';
    for (let k = 0; k < 6; k++) g.fillRect(Math.random() * 128, y + 4 + Math.random() * 24, 20 + Math.random() * 30, 1.5);
  }
  // Frame and the cross brace
  g.strokeStyle = '#5c3a1a';
  g.lineWidth = 12;
  g.strokeRect(6, 6, 116, 116);
  g.lineWidth = 9;
  g.beginPath();
  g.moveTo(12, 12);
  g.lineTo(116, 116);
  g.stroke();
  // Metal corners
  g.fillStyle = '#b9c0cc';
  for (const [x, y] of [[0, 0], [104, 0], [0, 104], [104, 104]]) g.fillRect(x, y, 24, 24);
  g.fillStyle = '#6f7685';
  for (const [x, y] of [[8, 8], [112, 8], [8, 112], [112, 112]]) g.fillRect(x, y, 6, 6);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}

interface CrateView {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  shake: number;
}

interface Splinter {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

interface PowerView {
  group: THREE.Group;
  icon: THREE.Sprite;
  ring: THREE.Mesh;
}

export class WavesRenderer {
  private readonly root = new THREE.Group();
  private readonly crateGeometry = new THREE.BoxGeometry(CRATE_SIZE, CRATE_SIZE, CRATE_HEIGHT);
  private readonly crateTexture = crateTexture();
  private readonly splinterGeometry = new THREE.BoxGeometry(0.12, 0.04, 0.03);
  private readonly splinterMaterial = new THREE.MeshBasicMaterial({ color: 0x8a5a2b });
  private readonly ringGeometry = new THREE.RingGeometry(0.22, 0.3, 32);
  private readonly crates = new Map<number, CrateView>();
  private readonly powers = new Map<number, PowerView>();
  private splinters: Splinter[] = [];
  private readonly markGeometry = new THREE.RingGeometry(0.27, 0.36, 28);
  private readonly poisonMaterial = new THREE.MeshBasicMaterial({ color: 0x7ed321, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  private readonly iceMaterial = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  /** Rings in use and spare ones, reused frame to frame. */
  private marks: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
  }

  /** A crate was hit: it shakes; broken, it flies apart. */
  crateHit(crateID: number, x: number, y: number, broken: boolean): void {
    const view = this.crates.get(crateID);
    if (view) view.shake = 0.18;
    if (!broken) return;
    for (let i = 0; i < 14; i++) {
      const mesh = new THREE.Mesh(this.splinterGeometry, this.splinterMaterial);
      mesh.position.set(x + (Math.random() - 0.5) * 0.4, y + (Math.random() - 0.5) * 0.4, 0.1 + Math.random() * 0.4);
      const a = Math.random() * Math.PI * 2;
      const s = 1.5 + Math.random() * 2.5;
      this.root.add(mesh);
      this.splinters.push({
        mesh,
        vel: new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s, 2 + Math.random() * 3),
        spin: new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12),
        life: 0.9 + Math.random() * 0.4,
      });
    }
  }

  /** Every frame: the crates and power-ups as they are now, and the splinters flying. */
  render(crates: readonly Crate[], powers: readonly FloorPower[], ailments: readonly AilmentMark[], dt: number, time: number): void {
    // Rings under the poisoned (green) and chilled (icy) enemies
    let used = 0;
    const ring = (x: number, y: number, material: THREE.Material, scale: number) => {
      let m = this.marks[used];
      if (!m) {
        m = new THREE.Mesh(this.markGeometry, material);
        this.root.add(m);
        this.marks.push(m);
      }
      m.material = material;
      m.visible = true;
      m.position.set(x, y, 0.03);
      m.scale.setScalar(scale);
      used++;
    };
    for (const a of ailments) {
      if (a.poison) ring(a.x, a.y, this.poisonMaterial, 1 + Math.sin(time * 8 + a.id) * 0.08);
      if (a.ice) ring(a.x, a.y, this.iceMaterial, 1.2);
    }
    for (let i = used; i < this.marks.length; i++) this.marks[i].visible = false;

    // Crates: new ones appear, broken ones go; a damaged crate darkens
    const seen = new Set<number>();
    for (const crate of crates) {
      seen.add(crate.id);
      let view = this.crates.get(crate.id);
      if (!view) {
        const material = new THREE.MeshBasicMaterial({ map: this.crateTexture });
        const mesh = new THREE.Mesh(this.crateGeometry, material);
        mesh.rotation.z = (crate.id * 0.7) % (Math.PI / 2);
        this.root.add(mesh);
        view = { mesh, material, shake: 0 };
        this.crates.set(crate.id, view);
      }
      view.shake = Math.max(0, view.shake - dt);
      const jolt = view.shake > 0 ? Math.sin(time * 70) * 0.04 * (view.shake / 0.18) : 0;
      view.mesh.position.set(crate.position.x + jolt, crate.position.y, CRATE_HEIGHT / 2);
      const shade = 0.55 + 0.45 * Math.max(0, crate.life / CRATE_LIFE);
      view.material.color.setRGB(shade, shade, shade);
    }
    for (const [id, view] of this.crates) {
      if (seen.has(id)) continue;
      this.root.remove(view.mesh);
      view.material.dispose();
      this.crates.delete(id);
    }

    // Power-ups: a bobbing, turning icon over a ring; blinking when about to go
    const here = new Set<number>();
    for (const p of powers) {
      here.add(p.id);
      let view = this.powers.get(p.id);
      if (!view) {
        const tex = new THREE.CanvasTexture(powerIcon(p.kind));
        tex.colorSpace = THREE.NoColorSpace;
        const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
        icon.scale.set(0.5, 0.5, 1);
        const ring = new THREE.Mesh(
          this.ringGeometry,
          new THREE.MeshBasicMaterial({ color: new THREE.Color(POWERS[p.kind].color), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }),
        );
        ring.position.z = 0.02;
        const group = new THREE.Group();
        group.add(ring, icon);
        this.root.add(group);
        view = { group, icon, ring };
        this.powers.set(p.id, view);
      }
      view.group.position.set(p.x, p.y, 0);
      view.icon.position.z = 0.42 + Math.sin(time * 3 + p.id) * 0.06;
      view.ring.scale.setScalar(1 + Math.sin(time * 4 + p.id) * 0.12);
      const left = p.life - p.age;
      view.group.visible = left > 5 || Math.sin(time * 14) > 0;
    }
    for (const [id, view] of this.powers) {
      if (here.has(id)) continue;
      this.root.remove(view.group);
      (view.icon.material as THREE.SpriteMaterial).map?.dispose();
      view.icon.material.dispose();
      (view.ring.material as THREE.Material).dispose();
      this.powers.delete(id);
    }

    // Splinters: thrown, falling, gone
    this.splinters = this.splinters.filter((s) => {
      s.life -= dt;
      if (s.life <= 0) {
        this.root.remove(s.mesh);
        return false;
      }
      s.vel.z -= 9.8 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      if (s.mesh.position.z < 0.02) {
        s.mesh.position.z = 0.02;
        s.vel.multiplyScalar(0.4);
        s.vel.z = Math.abs(s.vel.z) * 0.3;
      }
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      return true;
    });
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const v of this.crates.values()) v.material.dispose();
    for (const v of this.powers.values()) {
      (v.icon.material as THREE.SpriteMaterial).map?.dispose();
      v.icon.material.dispose();
      (v.ring.material as THREE.Material).dispose();
    }
    this.crateGeometry.dispose();
    this.crateTexture.dispose();
    this.splinterGeometry.dispose();
    this.splinterMaterial.dispose();
    this.ringGeometry.dispose();
    this.markGeometry.dispose();
    this.poisonMaterial.dispose();
    this.iceMaterial.dispose();
  }
}
