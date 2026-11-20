// The Horde's energy on the floor (src/client/horde.ts): a small crystal turning and bobbing over a glow, cyan, bigger
// the more energy it holds (a merged one, a boss's), golden from ENERGY_GOLD up. Instanced: a crowd of them is two draws.
import * as THREE from 'three';
import { FX_RENDER_ORDER } from '../fx/effects';

/** The energy on the floor, as the run keeps it. */
export interface FloorEnergy {
  x: number;
  y: number;
  value: number;
  /** A magnet was taken: it flies to the player from wherever it is. */
  pulled?: boolean;
  /** Seconds since it fell (its bob and turn start apart from the others'). */
  age: number;
}

/** The most drawn at once (the run merges them past HORDE.floor.most). */
const CAPACITY = 512;
/** A crystal's size for one energy; and from how much it turns gold. */
const SIZE = 0.1;
const ENERGY_GOLD = 10;
const CYAN = new THREE.Color(0.2, 0.85, 1);
const GOLD = new THREE.Color(1, 0.82, 0.3);

export class EnergyRenderer {
  private readonly crystals: THREE.InstancedMesh;
  private readonly glows: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene) {
    const crystal = new THREE.OctahedronGeometry(1, 0);
    crystal.scale(0.75, 0.75, 1.25);
    this.crystals = new THREE.InstancedMesh(crystal, new THREE.MeshBasicMaterial({ color: 0xffffff }), CAPACITY);
    this.crystals.frustumCulled = false;
    this.crystals.count = 0;
    // The glow under it: a soft disc in its colour
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    this.glows = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      // (blended, not added: added on the light sand it went white)
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
      CAPACITY,
    );
    this.glows.frustumCulled = false;
    this.glows.count = 0;
    this.glows.renderOrder = FX_RENDER_ORDER.floorMarks + 1;
    // (the colours: one per instance)
    for (const mesh of [this.crystals, this.glows]) mesh.setColorAt(0, CYAN);
    scene.add(this.glows, this.crystals);
  }

  render(energy: readonly FloorEnergy[], time: number): void {
    const n = Math.min(CAPACITY, energy.length);
    for (let i = 0; i < n; i++) {
      const it = energy[i];
      const k = SIZE * (1 + Math.log2(it.value) * 0.3);
      const t = time + it.age * 0.37;
      // The crystal: up a little, bobbing and turning
      this.e.set(0, 0, t * 2.2);
      this.q.setFromEuler(this.e);
      this.v.set(it.x, it.y, 0.12 + k + Math.sin(t * 3) * 0.03);
      this.s.set(k, k, k);
      this.m.compose(this.v, this.q, this.s);
      this.crystals.setMatrixAt(i, this.m);
      const color = it.value >= ENERGY_GOLD ? GOLD : CYAN;
      this.crystals.setColorAt(i, color);
      // The glow on the floor, breathing
      const r = k * (6 + Math.sin(t * 3) * 0.6);
      this.q.identity();
      this.v.set(it.x, it.y, 0.02);
      this.s.set(r, r, 1);
      this.m.compose(this.v, this.q, this.s);
      this.glows.setMatrixAt(i, this.m);
      this.glows.setColorAt(i, color);
    }
    for (const mesh of [this.crystals, this.glows]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    this.scene.remove(this.glows, this.crystals);
    for (const mesh of [this.crystals, this.glows]) {
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
      mesh.dispose();
    }
  }
}
