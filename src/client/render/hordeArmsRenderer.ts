// The Horde's own cards on screen (src/client/hordeArms.ts): the blades turning around the player (a bright gold blade
// over a soft glow), the drones (a small cyan body with its rotor ring), and the energy field (a violet disc breathing
// with a ring at its reach). The player's cards are gold elsewhere; the drones and the field have their own colours so
// they read apart from the shots.
import * as THREE from 'three';
import { FX_RENDER_ORDER } from '../fx/effects';
import type { ArmsView } from '../hordeArms';

const ABOVE_FLOOR = FX_RENDER_ORDER.floorMarks + 2;

export class HordeArmsRenderer {
  private readonly root = new THREE.Group();
  private readonly bladeGeometry = new THREE.BoxGeometry(0.52, 0.11, 0.04);
  private readonly bladeMaterial = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
  private readonly glowGeometry = new THREE.CircleGeometry(0.2, 24);
  // (blended, not added: added on the light sand it went white)
  private readonly bladeGlow = new THREE.MeshBasicMaterial({ color: 0xffb428, transparent: true, opacity: 0.3, depthWrite: false });
  private readonly droneGeometry = new THREE.OctahedronGeometry(0.11, 0);
  private readonly droneMaterial = new THREE.MeshBasicMaterial({ color: 0x7fe9ff });
  private readonly rotorGeometry = new THREE.RingGeometry(0.13, 0.17, 20);
  private readonly rotorMaterial = new THREE.MeshBasicMaterial({ color: 0x3fc6ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });
  private readonly auraDisc: THREE.Mesh;
  private readonly auraRing: THREE.Mesh;
  private readonly auraDiscMaterial = new THREE.MeshBasicMaterial({ color: 0x9a5cff, transparent: true, opacity: 0.16, depthWrite: false });
  private readonly auraRingMaterial = new THREE.MeshBasicMaterial({ color: 0xa66bff, transparent: true, opacity: 0.75, depthWrite: false });
  private readonly blades: { blade: THREE.Mesh; glow: THREE.Mesh }[] = [];
  private readonly drones: { body: THREE.Mesh; rotor: THREE.Mesh }[] = [];

  constructor(private readonly scene: THREE.Scene) {
    this.auraDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), this.auraDiscMaterial);
    this.auraRing = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 64), this.auraRingMaterial);
    for (const m of [this.auraDisc, this.auraRing]) {
      m.renderOrder = ABOVE_FLOOR;
      m.frustumCulled = false;
      m.visible = false;
      this.root.add(m);
    }
    scene.add(this.root);
  }

  render(view: ArmsView, time: number): void {
    // Blades
    while (this.blades.length < view.blades.length) {
      const blade = new THREE.Mesh(this.bladeGeometry, this.bladeMaterial);
      const glow = new THREE.Mesh(this.glowGeometry, this.bladeGlow);
      glow.renderOrder = ABOVE_FLOOR;
      this.root.add(glow, blade);
      this.blades.push({ blade, glow });
    }
    this.blades.forEach((v, i) => {
      const b = view.blades[i];
      v.blade.visible = v.glow.visible = !!b;
      if (!b) return;
      v.blade.position.set(b.x, b.y, 0.32);
      // (spinning on itself as it goes round)
      v.blade.rotation.set(0, 0, b.angle * 3 + time * 9);
      v.glow.position.set(b.x, b.y, 0.04);
    });
    // Drones
    while (this.drones.length < view.drones.length) {
      const body = new THREE.Mesh(this.droneGeometry, this.droneMaterial);
      const rotor = new THREE.Mesh(this.rotorGeometry, this.rotorMaterial);
      this.root.add(body, rotor);
      this.drones.push({ body, rotor });
    }
    this.drones.forEach((v, i) => {
      const d = view.drones[i];
      v.body.visible = v.rotor.visible = !!d;
      if (!d) return;
      v.body.position.set(d.x, d.y, d.z);
      v.body.rotation.set(0, 0, time * 5);
      v.rotor.position.set(d.x, d.y, d.z + 0.06);
      v.rotor.scale.setScalar(1 + Math.sin(time * 30 + i) * 0.08);
    });
    // The field
    const a = view.aura;
    this.auraDisc.visible = this.auraRing.visible = !!a;
    if (a) {
      const breath = 1 + Math.sin(time * 3) * 0.03;
      this.auraDisc.position.set(a.x, a.y, 0.03);
      this.auraRing.position.set(a.x, a.y, 0.035);
      this.auraDisc.scale.setScalar(a.radius * breath);
      this.auraRing.scale.setScalar(a.radius * breath);
      this.auraDiscMaterial.opacity = 0.16 + Math.sin(time * 3) * 0.04;
    }
  }

  dispose(): void {
    this.scene.remove(this.root);
    for (const g of [this.bladeGeometry, this.glowGeometry, this.droneGeometry, this.rotorGeometry, this.auraDisc.geometry, this.auraRing.geometry]) g.dispose();
    for (const m of [this.bladeMaterial, this.bladeGlow, this.droneMaterial, this.rotorMaterial, this.auraDiscMaterial, this.auraRingMaterial]) m.dispose();
  }
}
