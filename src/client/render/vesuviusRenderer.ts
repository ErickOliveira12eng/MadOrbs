// The Vesuvius on screen (src/client/vesuviusRun.ts): the warnings of the volcano's attacks on the floor before they
// land (a red line where a rocket will fly, a circle where a missile or a lava bomb will fall, the ring of fire with its
// gap), its beam sweeping the arena, and the edge of the lava that burns. Plain glowing shapes, like the waves'.
import * as THREE from 'three';
import { FX_RENDER_ORDER } from '../fx/effects';

/** After the blood and marks on the floor (FX_RENDER_ORDER.floorMarks), as the waves' rings. */
const ON_FLOOR = FX_RENDER_ORDER.floorMarks + 1;

/** What the run wants on the floor now; `k`: how far a warning has gone (0 to 1, the attack lands at 1). */
export interface VesuviusMarks {
  lines: { x: number; y: number; angle: number; length: number; k: number; width?: number }[];
  circles: { x: number; y: number; radius: number; k: number }[];
  /** The ring of fire about to go: around the boss, with its gap (radians). */
  ring: { x: number; y: number; radius: number; k: number; gap: number; gapWidth: number } | null;
  /** The beam: a thin warning (`on` false) or burning, from the boss out to the wall. */
  beam: { x: number; y: number; angle: number; length: number; on: boolean; k: number } | null;
  /** The lava that burns around the boss (the waves' bosses, src/client/wavesBoss.ts: none). */
  lava: { x: number; y: number; radius: number } | null;
}

const glow = (color: number) => new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

/** A pool of meshes of one shape: as many shown as asked each frame, the rest hidden. */
class Pool {
  private readonly meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  private used = 0;

  constructor(
    private readonly root: THREE.Group,
    private readonly geometry: THREE.BufferGeometry,
    private readonly color: number,
  ) {}

  next(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
    let m = this.meshes[this.used];
    if (!m) {
      m = new THREE.Mesh(this.geometry, glow(this.color));
      m.renderOrder = ON_FLOOR;
      m.frustumCulled = false;
      this.root.add(m);
      this.meshes.push(m);
    }
    this.used++;
    m.visible = true;
    return m;
  }

  /** Hides what this frame didn't use. */
  end(): void {
    for (let i = this.used; i < this.meshes.length; i++) this.meshes[i].visible = false;
    this.used = 0;
  }

  dispose(): void {
    for (const m of this.meshes) m.material.dispose();
    this.geometry.dispose();
  }
}

export class VesuviusRenderer {
  private readonly root = new THREE.Group();
  /** A strip of length 1 starting at its origin (a line, the beam), a ring's outline, a disc. */
  private readonly strip = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
  private readonly lineBase: Pool;
  private readonly lineFill: Pool;
  private readonly circleEdge: Pool;
  private readonly circleFill: Pool;
  private readonly beamCore: Pool;
  private readonly beamGlow: Pool;
  private readonly lavaEdge: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  /** The ring of fire's warning: its geometry made for its gap (a few times a minute). */
  private ringMesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null = null;
  private ringGap = NaN;

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
    this.lineBase = new Pool(this.root, this.strip, 0xff2a1a);
    this.lineFill = new Pool(this.root, this.strip, 0xff5a2a);
    this.circleEdge = new Pool(this.root, new THREE.RingGeometry(0.86, 1, 40), 0xff3a1a);
    this.circleFill = new Pool(this.root, new THREE.CircleGeometry(1, 32), 0xff4a14);
    this.beamCore = new Pool(this.root, this.strip, 0xffe08a);
    this.beamGlow = new Pool(this.root, this.strip, 0xff5a14);
    this.lavaEdge = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 72), glow(0xff7a14));
    this.lavaEdge.renderOrder = ON_FLOOR;
    this.root.add(this.lavaEdge);
  }

  render(m: VesuviusMarks, time: number): void {
    // The rockets' lines: a faint one the whole way, a bright one growing to where it fires
    for (const l of m.lines) {
      const base = this.lineBase.next();
      base.position.set(l.x, l.y, 0.05);
      base.rotation.set(0, 0, l.angle);
      base.scale.set(l.length, l.width ?? 0.34, 1);
      base.material.opacity = 0.22 + 0.12 * Math.sin(time * 30);
      const fill = this.lineFill.next();
      fill.position.set(l.x, l.y, 0.055);
      fill.rotation.set(0, 0, l.angle);
      fill.scale.set(Math.max(0.01, l.length * l.k), (l.width ?? 0.34) * 0.47, 1);
      fill.material.opacity = 0.75;
    }
    this.lineBase.end();
    this.lineFill.end();

    // Where something falls: the edge, and a disc filling up to it
    for (const c of m.circles) {
      const edge = this.circleEdge.next();
      edge.position.set(c.x, c.y, 0.05);
      edge.scale.setScalar(c.radius);
      edge.material.opacity = 0.65 + 0.3 * Math.sin(time * 18);
      const fill = this.circleFill.next();
      fill.position.set(c.x, c.y, 0.045);
      fill.scale.setScalar(Math.max(0.01, c.radius * c.k));
      fill.material.opacity = 0.32;
    }
    this.circleEdge.end();
    this.circleFill.end();

    // The ring of fire about to go out: a band around the boss with its gap, pulsing faster as it comes
    const r = m.ring;
    if (r) {
      if (!this.ringMesh || this.ringGap !== r.gapWidth) {
        this.ringMesh?.geometry.dispose();
        const geometry = new THREE.RingGeometry(0.82, 1, 96, 1, r.gapWidth / 2, Math.PI * 2 - r.gapWidth);
        if (this.ringMesh) this.ringMesh.geometry = geometry;
        else {
          this.ringMesh = new THREE.Mesh(geometry, glow(0xff6a1a));
          this.ringMesh.renderOrder = ON_FLOOR;
          this.root.add(this.ringMesh);
        }
        this.ringGap = r.gapWidth;
      }
      this.ringMesh.visible = true;
      this.ringMesh.position.set(r.x, r.y, 0.05);
      this.ringMesh.rotation.set(0, 0, r.gap);
      this.ringMesh.scale.setScalar(r.radius * (1 + 0.15 * r.k));
      this.ringMesh.material.opacity = 0.45 + 0.4 * Math.abs(Math.sin(time * (6 + 14 * r.k)));
    } else if (this.ringMesh) this.ringMesh.visible = false;

    // The beam: a thin warning, then a burning band with a glow around it
    const b = m.beam;
    if (b) {
      const core = this.beamCore.next();
      core.position.set(b.x, b.y, 0.07);
      core.rotation.set(0, 0, b.angle);
      if (b.on) {
        const flicker = 0.85 + 0.15 * Math.sin(time * 47);
        core.scale.set(b.length, 0.3 * flicker, 1);
        core.material.opacity = 0.95;
        const halo = this.beamGlow.next();
        halo.position.set(b.x, b.y, 0.065);
        halo.rotation.set(0, 0, b.angle);
        halo.scale.set(b.length, 0.85 * flicker, 1);
        halo.material.opacity = 0.55;
      } else {
        core.scale.set(b.length, 0.06 + 0.08 * b.k, 1);
        core.material.opacity = 0.35 + 0.35 * Math.abs(Math.sin(time * 20));
      }
    }
    this.beamCore.end();
    this.beamGlow.end();

    // The lava's edge: where it starts to burn
    this.lavaEdge.visible = !!m.lava;
    if (!m.lava) return;
    this.lavaEdge.position.set(m.lava.x, m.lava.y, 0.04);
    this.lavaEdge.scale.setScalar(m.lava.radius);
    this.lavaEdge.material.opacity = 0.3 + 0.15 * Math.sin(time * 3);
  }

  dispose(): void {
    for (const p of [this.lineBase, this.lineFill, this.circleEdge, this.circleFill, this.beamCore, this.beamGlow]) p.dispose();
    this.strip.dispose();
    this.lavaEdge.geometry.dispose();
    this.lavaEdge.material.dispose();
    this.ringMesh?.geometry.dispose();
    this.ringMesh?.material.dispose();
    this.root.removeFromParent();
  }
}
