// The waves mode on screen: the crates (wooden boxes drawn here: the original game has no crate
// model), their splinters when they break, and the power-ups waiting on the floor (a bobbing icon
// over a glowing ring). Plain materials, like the rest of the game's look.
import * as THREE from 'three';
import { CRATE_LIFE, type Crate } from '../../sim/crate';
import { powerIcon } from '../powerIcons';
import { POWERS, type PowerKind } from '../waves';

/** An enemy under the poison or ice shots (streaks over it and ripples where it goes, light green or light blue). */
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
/** The poison and ice looks: light green, light blue. */
const POISON_LOOK = new THREE.Color(0x86ff5c);
const ICE_LOOK = new THREE.Color(0x7fd4ff);
const MAX_STREAKS = 400;
const MAX_RIPPLES = 160;
const RIPPLE_LIFE = 0.7;
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
  // The poison and ice shots' look, after the rainy maps' rain (falling streaks) and its ripples on
  // the floor: over an enemy, light green (poison) or light blue (ice), the ripples left where it goes
  private readonly streaks: { x: number; y: number; z: number; color: THREE.Color }[] = [];
  private readonly streakPositions = new Float32Array(MAX_STREAKS * 6);
  private readonly streakColors = new Float32Array(MAX_STREAKS * 6);
  private readonly streakGeometry = new THREE.BufferGeometry();
  private readonly streakLines: THREE.LineSegments;
  private readonly rippleGeometry = new THREE.RingGeometry(0.05, 0.075, 20);
  private ripples: { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; age: number }[] = [];
  private spareRipples: { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; age: number }[] = [];
  /** Per enemy: time to its next streak and next ripple. */
  private readonly ailmentClock = new Map<number, { streak: number; ripple: number }>();

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
    this.streakGeometry.setAttribute('position', new THREE.BufferAttribute(this.streakPositions, 3));
    this.streakGeometry.setAttribute('color', new THREE.BufferAttribute(this.streakColors, 3));
    this.streakLines = new THREE.LineSegments(
      this.streakGeometry,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.streakLines.frustumCulled = false;
    this.root.add(this.streakLines);
  }

  /** Streaks falling over the poisoned or chilled enemies, ripples left on the floor where they go. */
  private renderAilments(ailments: readonly AilmentMark[], dt: number): void {
    const seen = new Set<number>();
    for (const a of ailments) {
      seen.add(a.id);
      let clock = this.ailmentClock.get(a.id);
      if (!clock) this.ailmentClock.set(a.id, (clock = { streak: 0, ripple: 0 }));
      const colors = [a.poison ? POISON_LOOK : null, a.ice ? ICE_LOOK : null].filter((c): c is THREE.Color => !!c);
      clock.streak -= dt;
      while (clock.streak <= 0 && this.streaks.length < MAX_STREAKS) {
        clock.streak += 0.035;
        const color = colors[Math.floor(Math.random() * colors.length)];
        this.streaks.push({ x: a.x + (Math.random() - 0.5) * 0.6, y: a.y + (Math.random() - 0.5) * 0.6, z: 0.9 + Math.random() * 0.4, color });
      }
      clock.ripple -= dt;
      if (clock.ripple <= 0) {
        clock.ripple = 0.12;
        for (const color of colors) this.addRipple(a.x + (Math.random() - 0.5) * 0.25, a.y + (Math.random() - 0.5) * 0.25, color);
      }
    }
    for (const id of this.ailmentClock.keys()) if (!seen.has(id)) this.ailmentClock.delete(id);

    // Streaks fall like the rain; one landing leaves a ripple now and then
    let n = 0;
    for (let i = 0; i < this.streaks.length; i++) {
      const st = this.streaks[i];
      st.z -= dt * 5;
      if (st.z <= 0.03) {
        if (Math.random() < 0.25) this.addRipple(st.x, st.y, st.color);
        continue;
      }
      this.streaks[n++] = st;
    }
    this.streaks.length = n;
    for (let i = 0; i < MAX_STREAKS; i++) {
      const st = this.streaks[i];
      const o = i * 6;
      if (!st) {
        this.streakPositions.fill(0, o, o + 6);
        this.streakColors.fill(0, o, o + 6);
        continue;
      }
      this.streakPositions.set([st.x, st.y, st.z, st.x, st.y, Math.max(0.03, st.z - 0.22)], o);
      this.streakColors.set([st.color.r, st.color.g, st.color.b, st.color.r * 0.3, st.color.g * 0.3, st.color.b * 0.3], o);
    }
    this.streakGeometry.attributes.position.needsUpdate = true;
    this.streakGeometry.attributes.color.needsUpdate = true;
    this.streakGeometry.setDrawRange(0, this.streaks.length * 2);

    // Ripples grow and fade
    this.ripples = this.ripples.filter((r) => {
      r.age += dt;
      const k = r.age / RIPPLE_LIFE;
      if (k >= 1) {
        r.mesh.visible = false;
        this.spareRipples.push(r);
        return false;
      }
      r.mesh.scale.setScalar(1 + k * 3.5);
      r.material.opacity = 0.75 * (1 - k);
      return true;
    });
  }

  private addRipple(x: number, y: number, color: THREE.Color): void {
    if (this.ripples.length >= MAX_RIPPLES) return;
    let r = this.spareRipples.pop();
    if (!r) {
      const material = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(this.rippleGeometry, material);
      this.root.add(mesh);
      r = { mesh, material, age: 0 };
    }
    r.age = 0;
    r.material.color.copy(color);
    r.mesh.position.set(x, y, 0.025);
    r.mesh.visible = true;
    this.ripples.push(r);
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
    this.renderAilments(ailments, dt);

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
    this.streakGeometry.dispose();
    (this.streakLines.material as THREE.Material).dispose();
    this.rippleGeometry.dispose();
    for (const r of [...this.ripples, ...this.spareRipples]) r.material.dispose();
  }
}
