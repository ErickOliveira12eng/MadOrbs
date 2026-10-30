// The waves' crowns (src/sim/crowns.ts: who wears which). A crown modelled in code (nothing of the original game): a band whose top rises
// in curved points, a ball on each point, two rims and gems on the band, lit by a matcap (a small picture of a lit metal
// sphere) drawn here for each metal, so one model makes the three. It sits on the Orb upright, never rolling with it.
import * as THREE from 'three';
import { CROWN_TIERS, type CrownTier } from '../../sim/crowns';

export { CROWN_TIERS, type CrownTier };

/** The metals: highlight, body, shadow, deep shadow (the matcap's light to dark). */
const METALS: Record<CrownTier | 'gem', [string, string, string, string]> = {
  gold: ['#fffbe0', '#ffd23a', '#c98a00', '#4f3200'],
  silver: ['#ffffff', '#d3d8e2', '#757d8c', '#252a36'],
  bronze: ['#ffe0bd', '#c9803f', '#73401a', '#2b1406'],
  gem: ['#ffffff', '#e8f0ff', '#9aa8c8', '#3a4460'],
};

/** The crown's size against the Orb's (radius 0.25): the band's radius at its foot, and where it sits. */
const BAND_R = 0.165;
// (the Orb's surface at the band's radius is at z 0.188: the foot sits just in it)
const BAND_Z = 0.18;
const BAND_H = 0.07;
const SPIKE_H = 0.105;
const POINTS = 5;
const FLARE = 0.035;
/** The rounded lip along the points' edge, and the rims' tube (radius). */
const LIP = 0.009;
const RIM = 0.013;

const matcaps = new Map<string, THREE.CanvasTexture>();

/** A matcap of a metal: a lit sphere, the light from the top left, a darker horizon band like a reflected room. */
function matcap(kind: CrownTier | 'gem'): THREE.CanvasTexture {
  let tex = matcaps.get(kind);
  if (tex) return tex;
  const [light, body, shade, deep] = METALS[kind];
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  // In memory: a GPU reset wipes GPU canvases drawn once (the waves' crates went black)
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = deep;
  g.fillRect(0, 0, 256, 256);
  const base = g.createRadialGradient(100, 86, 6, 128, 128, 132);
  base.addColorStop(0, light);
  base.addColorStop(0.28, body);
  base.addColorStop(0.72, shade);
  base.addColorStop(1, deep);
  g.fillStyle = base;
  g.beginPath();
  g.arc(128, 128, 128, 0, Math.PI * 2);
  g.fill();
  // The reflected horizon: a dark band a little under the middle, then a warm floor light under it
  const band = g.createLinearGradient(0, 120, 0, 200);
  band.addColorStop(0, 'rgba(0,0,0,0)');
  band.addColorStop(0.35, 'rgba(0,0,0,0.38)');
  band.addColorStop(0.55, 'rgba(0,0,0,0.1)');
  band.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = band;
  g.fillRect(0, 0, 256, 256);
  const floor = g.createRadialGradient(150, 220, 4, 150, 220, 70);
  floor.addColorStop(0, body);
  floor.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = 0.55;
  g.fillStyle = floor;
  g.fillRect(0, 0, 256, 256);
  // A sharp highlight
  g.globalAlpha = 0.9;
  const spot = g.createRadialGradient(92, 74, 0, 92, 74, 26);
  spot.addColorStop(0, '#ffffff');
  spot.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = spot;
  g.fillRect(0, 0, 256, 256);
  g.globalAlpha = 1;
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  matcaps.set(kind, tex);
  return tex;
}

/** The band's height above its foot at angle a: low between the points, rising in a curve to each one. */
const rise = (a: number) => BAND_H + SPIKE_H * ((Math.cos(POINTS * a) + 1) / 2) ** 2.2;

/** The band with its points: a ring whose top follows rise(), opening a little outwards as it goes up. */
function bandGeometry(): THREE.BufferGeometry {
  const seg = POINTS * 32;
  const rows = 10;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const r = BAND_R + FLARE * v;
      pos.push(Math.cos(a) * r, Math.sin(a) * r, BAND_Z + rise(a) * v);
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      const b = a + seg + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** The points' edge as a closed curve (the band's top), for the rounded lip along it. */
class LipCurve extends THREE.Curve<THREE.Vector3> {
  constructor() {
    super();
  }

  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const a = t * Math.PI * 2;
    const r = BAND_R + FLARE;
    return target.set(Math.cos(a) * r, Math.sin(a) * r, BAND_Z + rise(a));
  }
}

let shared: {
  band: THREE.BufferGeometry;
  lip: THREE.BufferGeometry;
  ball: THREE.BufferGeometry;
  gem: THREE.BufferGeometry;
} | null = null;

/** A crown of `tier`, its foot on the top of an Orb of radius 0.25 centred at the origin (Z up). */
export function makeCrown(tier: CrownTier): THREE.Group {
  shared ??= {
    band: bandGeometry(),
    lip: new THREE.TubeGeometry(new LipCurve(), POINTS * 48, LIP, 8, true),
    ball: new THREE.SphereGeometry(1, 16, 12),
    gem: new THREE.OctahedronGeometry(1, 0),
  };
  const metal = new THREE.MeshMatcapMaterial({ matcap: matcap(tier), side: THREE.DoubleSide });
  const gemMat = new THREE.MeshMatcapMaterial({ matcap: matcap('gem') });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(shared.band, metal), new THREE.Mesh(shared.lip, metal));
  // The rims: at the foot and a little above it
  for (const [z, r, tube] of [
    [BAND_Z + 0.006, BAND_R + 0.004, RIM],
    [BAND_Z + BAND_H * 0.66, BAND_R + FLARE * 0.33 + 0.003, RIM * 0.75],
  ]) {
    // A torus of radius r and tube `tube` (the geometry is 1 and 1: scaled per axis would bend it, so built per rim)
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 12, 96), metal);
    rim.position.z = z;
    group.add(rim);
  }
  // A ball on each point, and a gem on the band under each valley
  for (let p = 0; p < POINTS; p++) {
    const a = (p / POINTS) * Math.PI * 2;
    const r = BAND_R + FLARE;
    const ball = new THREE.Mesh(shared.ball, metal);
    ball.scale.setScalar(0.024);
    ball.position.set(Math.cos(a) * r, Math.sin(a) * r, BAND_Z + BAND_H + SPIKE_H + 0.02);
    group.add(ball);
    const v = a + Math.PI / POINTS;
    const gem = new THREE.Mesh(shared.gem, gemMat);
    gem.scale.set(0.028, 0.028, 0.032);
    const gr = BAND_R + FLARE * 0.2 + 0.016;
    gem.position.set(Math.cos(v) * gr, Math.sin(v) * gr, BAND_Z + BAND_H * 0.34);
    gem.rotation.z = v;
    group.add(gem);
  }
  return group;
}
