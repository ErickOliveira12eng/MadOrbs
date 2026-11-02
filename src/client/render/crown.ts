// The waves' crowns (src/sim/crowns.ts: who wears which). A crown modelled in code (nothing of the original game): a band whose top rises
// in curved points, a ball on each point, two rims and gems on the band, lit by a matcap (a small picture of a lit metal
// sphere) drawn here for each metal, so one model makes them all. It sits on the Orb upright, never rolling with it. The
// platinum one (wave 200) is a little bigger, with ice-blue gems.
import * as THREE from 'three';
import { CROWN_TIERS, type CrownTier } from '../../sim/crowns';

export { CROWN_TIERS, type CrownTier };

/** The metals: highlight, body, shadow, deep shadow (the matcap's light to dark). */
const METALS: Record<CrownTier | 'gem' | 'ice', [string, string, string, string]> = {
  // (whiter and brighter than the silver, its shadows a cool blue)
  platinum: ['#ffffff', '#f4f8ff', '#b4c6e2', '#30466e'],
  gold: ['#fffbe0', '#ffd23a', '#c98a00', '#4f3200'],
  // (matte, Erick 02/11/2026: a softer light to dark)
  silver: ['#eef0f4', '#c4c9d2', '#868d9a', '#3a404c'],
  bronze: ['#ffe0bd', '#c9803f', '#73401a', '#2b1406'],
  gem: ['#ffffff', '#e8f0ff', '#9aa8c8', '#3a4460'],
  // The platinum crown's gems
  ice: ['#ffffff', '#b8f2ff', '#2fa8e0', '#06304f'],
};
/**
 * How each metal shines (Erick, 02/11/2026: the silver matte, the platinum brighter): the sharp highlight's strength and
 * size, the reflected horizon's darkness, and a second highlight (the polished platinum's).
 */
const FINISH: Record<CrownTier | 'gem' | 'ice', { spot: number; spotR: number; band: number; glint: number }> = {
  bronze: { spot: 0.9, spotR: 26, band: 0.38, glint: 0 },
  silver: { spot: 0.3, spotR: 60, band: 0.14, glint: 0 },
  gold: { spot: 0.9, spotR: 26, band: 0.38, glint: 0 },
  platinum: { spot: 1, spotR: 22, band: 0.55, glint: 0.85 },
  gem: { spot: 0.9, spotR: 26, band: 0.38, glint: 0 },
  ice: { spot: 1, spotR: 24, band: 0.4, glint: 0.6 },
};

/** The platinum crown, bigger than the others (Erick: "um pouco maior"), and its gems bigger still. */
const TIER_SIZE: Partial<Record<CrownTier, number>> = { platinum: 1.18 };
const GEM_SIZE: Partial<Record<CrownTier, number>> = { platinum: 1.45 };

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
function matcap(kind: CrownTier | 'gem' | 'ice'): THREE.CanvasTexture {
  let tex = matcaps.get(kind);
  if (tex) return tex;
  const [light, body, shade, deep] = METALS[kind];
  const finish = FINISH[kind];
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
  band.addColorStop(0.35, `rgba(0,0,0,${finish.band})`);
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
  // A sharp highlight (broad and faint on a matte metal)
  g.globalAlpha = finish.spot;
  const spot = g.createRadialGradient(92, 74, 0, 92, 74, finish.spotR);
  spot.addColorStop(0, '#ffffff');
  spot.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = spot;
  g.fillRect(0, 0, 256, 256);
  // A polished metal's second light, from the bottom right, and a bright rim
  if (finish.glint > 0) {
    g.globalAlpha = finish.glint;
    const glint = g.createRadialGradient(178, 176, 0, 178, 176, 18);
    glint.addColorStop(0, '#ffffff');
    glint.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glint;
    g.fillRect(0, 0, 256, 256);
    const rim = g.createRadialGradient(128, 128, 104, 128, 128, 128);
    rim.addColorStop(0, 'rgba(255,255,255,0)');
    rim.addColorStop(0.8, 'rgba(255,255,255,0.5)');
    rim.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rim;
    g.fillRect(0, 0, 256, 256);
  }
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

/**
 * The crown as worn (Erick, 01/11/2026, a test): 30% smaller and slid a little down the Orb's side (radians round its
 * centre, to its left of the aim), tilted with it.
 */
const WORN_SCALE = 0.7;
const WORN_TILT = 0.35;

/**
 * A crown of `tier`, its foot on the top of an Orb of radius 0.25 centred at the origin (Z up). `worn` false: upright and
 * at its modelled size (the prizes' pictures, tools/make-crown-icons.mjs).
 */
export function makeCrown(tier: CrownTier, worn = true): THREE.Group {
  shared ??= {
    band: bandGeometry(),
    lip: new THREE.TubeGeometry(new LipCurve(), POINTS * 48, LIP, 8, true),
    ball: new THREE.SphereGeometry(1, 16, 12),
    gem: new THREE.OctahedronGeometry(1, 0),
  };
  const metal = new THREE.MeshMatcapMaterial({ matcap: matcap(tier), side: THREE.DoubleSide });
  const gemMat = new THREE.MeshMatcapMaterial({ matcap: matcap(tier === 'platinum' ? 'ice' : 'gem') });
  const scale = worn ? WORN_SCALE * (TIER_SIZE[tier] ?? 1) : 1;
  // The callers turn `group` (the aim, the menu's sway); it holds the crown worn smaller and tilted a little to the side
  // (WORN_SCALE, WORN_TILT): `inner` is the crown as modelled, its smaller foot set back on the Orb's surface
  const group = new THREE.Group();
  const tilt = new THREE.Group();
  tilt.rotation.x = worn ? WORN_TILT : 0;
  const inner = new THREE.Group();
  inner.scale.setScalar(scale);
  inner.position.z = Math.sqrt(0.25 ** 2 - (scale * BAND_R) ** 2) - scale * BAND_Z;
  tilt.add(inner);
  group.add(tilt);
  inner.add(new THREE.Mesh(shared.band, metal), new THREE.Mesh(shared.lip, metal));
  // The rims: at the foot and a little above it
  for (const [z, r, tube] of [
    [BAND_Z + 0.006, BAND_R + 0.004, RIM],
    [BAND_Z + BAND_H * 0.66, BAND_R + FLARE * 0.33 + 0.003, RIM * 0.75],
  ]) {
    // A torus of radius r and tube `tube` (the geometry is 1 and 1: scaled per axis would bend it, so built per rim)
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 12, 96), metal);
    rim.position.z = z;
    inner.add(rim);
  }
  // A ball on each point, and a gem on the band under each valley
  for (let p = 0; p < POINTS; p++) {
    const a = (p / POINTS) * Math.PI * 2;
    const r = BAND_R + FLARE;
    const ball = new THREE.Mesh(shared.ball, metal);
    ball.scale.setScalar(0.024);
    ball.position.set(Math.cos(a) * r, Math.sin(a) * r, BAND_Z + BAND_H + SPIKE_H + 0.02);
    inner.add(ball);
    const v = a + Math.PI / POINTS;
    const gem = new THREE.Mesh(shared.gem, gemMat);
    const k = GEM_SIZE[tier] ?? 1;
    gem.scale.set(0.028 * k, 0.028 * k, 0.032 * k);
    const gr = BAND_R + FLARE * 0.2 + 0.016;
    gem.position.set(Math.cos(v) * gr, Math.sin(v) * gr, BAND_Z + BAND_H * 0.34);
    gem.rotation.z = v;
    inner.add(gem);
  }
  return group;
}
