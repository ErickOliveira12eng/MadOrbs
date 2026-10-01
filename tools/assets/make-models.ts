// The 3D models (public/assets/models/*.DKO + Knife.tga, Shieldtga.tga), built from scratch with a
// small modelling kit and written in the original engine's DKO format, so the game code is
// unchanged. Same names, units and layout as the original set: model units (the game scales them
// by 0.005), z up, y forward, the orb is a ball of radius 50 around (0, 0, 50) and weapons sit on
// its right. The muzzle / shell dummies are the game's own (src/sim/weaponDummies.ts), so shots
// still start where they always did. Same kind of objects, palette and animations (waving flags,
// growing shield bubble, spinning magnet and knives), but every shape here is new.
// Usage: npx tsx tools/assets/make-models.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { weaponDummies } from '../../src/sim/weaponDummies';
import { Raster, fbm, line, polygon, rect, voronoi, writeTGA } from './lib.mjs';

type V3 = [number, number, number];
type UV = [number, number];
interface Vert {
  p: V3;
  n: V3;
  uv: UV;
}
/** A triangle: three vertices, counter-clockwise seen from the side the normal points to. */
type Tri = [Vert, Vert, Vert];

// ------------------------------------------------------------------ vector helpers

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp3 = (a: V3, b: V3, t: number): V3 => add(a, mul(sub(b, a), t));

/** Two unit vectors perpendicular to `axis` (and to each other), right-handed with it. */
function basis(axis: V3): [V3, V3] {
  const w = norm(axis);
  const helper: V3 = Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(helper, w));
  const v = cross(w, u);
  return [u, v];
}

const flatTri = (a: V3, b: V3, c: V3, uv: [UV, UV, UV] = [[0, 0], [0, 0], [0, 0]]): Tri => {
  const n = norm(cross(sub(b, a), sub(c, a)));
  return [
    { p: a, n, uv: uv[0] },
    { p: b, n, uv: uv[1] },
    { p: c, n, uv: uv[2] },
  ];
};

/** Flat triangle, flipped if needed so that its normal points along `out`. */
const facing = (a: V3, b: V3, c: V3, out: V3): Tri => (dot(cross(sub(b, a), sub(c, a)), out) >= 0 ? flatTri(a, b, c) : flatTri(a, c, b));

// ------------------------------------------------------------------ primitives

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Tri[] {
  const c: V3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  const P = (i: number): V3 => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  const faces = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]];
  const out: Tri[] = [];
  for (const [a, b, d, e] of faces) {
    const q = [P(a), P(b), P(d), P(e)];
    const centre = mul(add(add(q[0], q[1]), add(q[2], q[3])), 0.25);
    const dir = sub(centre, c);
    out.push(facing(q[0], q[1], q[2], dir), facing(q[0], q[2], q[3], dir));
  }
  return out;
}

/** Frustum from a (radius r0) to b (radius r1); smooth sides, flat caps. */
function cyl(a: V3, b: V3, r0: number, r1 = r0, seg = 10, caps = true, phase = 0): Tri[] {
  const axis = sub(b, a);
  const [u, v] = basis(axis);
  const w = norm(axis);
  const ring = (c: V3, r: number, i: number): V3 => {
    const t = phase + (i / seg) * Math.PI * 2;
    return add(c, add(mul(u, Math.cos(t) * r), mul(v, Math.sin(t) * r)));
  };
  const slope = (r0 - r1) / (len(axis) || 1);
  const nrm = (i: number): V3 => {
    const t = phase + (i / seg) * Math.PI * 2;
    return norm(add(add(mul(u, Math.cos(t)), mul(v, Math.sin(t))), mul(w, slope)));
  };
  const out: Tri[] = [];
  const z: UV = [0, 0];
  for (let i = 0; i < seg; i++) {
    const a0 = ring(a, r0, i), a1 = ring(a, r0, i + 1), b0 = ring(b, r1, i), b1 = ring(b, r1, i + 1);
    const n0 = nrm(i), n1 = nrm(i + 1);
    out.push([{ p: a0, n: n0, uv: z }, { p: a1, n: n1, uv: z }, { p: b1, n: n1, uv: z }]);
    out.push([{ p: a0, n: n0, uv: z }, { p: b1, n: n1, uv: z }, { p: b0, n: n0, uv: z }]);
    if (caps) {
      if (r1 > 0) out.push(facing(b, b0, b1, w));
      if (r0 > 0) out.push(facing(a, a1, a0, mul(w, -1)));
    }
  }
  return out;
}

/** Ellipsoid around c (radii rx, ry, rz); `flat` gives a faceted look. */
function sphere(c: V3, rx: number, ry = rx, rz = rx, seg = 12, rings = 8, flat = false, uvScale = 1): Tri[] {
  const P = (i: number, j: number): Vert => {
    const t = (i / seg) * Math.PI * 2;
    const f = -Math.PI / 2 + (j / rings) * Math.PI;
    const d: V3 = [Math.cos(f) * Math.cos(t), Math.cos(f) * Math.sin(t), Math.sin(f)];
    return { p: add(c, [d[0] * rx, d[1] * ry, d[2] * rz]), n: norm([d[0] / rx, d[1] / ry, d[2] / rz]), uv: [(i / seg) * uvScale, j / rings] };
  };
  const out: Tri[] = [];
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = P(i, j), b = P(i + 1, j), d = P(i + 1, j + 1), e = P(i, j + 1);
      if (j > 0) out.push(flat ? relit([a, b, d]) : [a, b, d]);
      if (j < rings - 1) out.push(flat ? relit([a, d, e]) : [a, d, e]);
    }
  }
  return out;
}

/** Same triangle with a flat normal (keeps the UVs). */
function relit(t: Tri): Tri {
  const n = norm(cross(sub(t[1].p, t[0].p), sub(t[2].p, t[0].p)));
  return t.map((v) => ({ ...v, n })) as Tri;
}

/** Ear clipping of a simple polygon given counter-clockwise in 2D: triangles as index triples. */
function triangulate(pts: [number, number][]): [number, number, number][] {
  const idx = pts.map((_, i) => i);
  const out: [number, number, number][] = [];
  const area = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p: number[], a: number[], b: number[], c: number[]) => area(a, b, p) > 0 && area(b, c, p) > 0 && area(c, a, p) > 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 1000) {
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const [a, b, c] = [pts[i0], pts[i1], pts[i2]];
      if (area(a, b, c) <= 0) continue;
      if (idx.some((j) => j !== i0 && j !== i1 && j !== i2 && inside(pts[j], a, b, c))) continue;
      out.push([i0, i1, i2]);
      idx.splice(k, 1);
      break;
    }
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

/** A side profile [y, z][] (any winding) extruded across x, from x0 to x1. */
function extrudeX(profile: [number, number][], x0: number, x1: number): Tri[] {
  let pts = profile;
  const signed = pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0);
  if (signed < 0) pts = [...pts].reverse();
  const out: Tri[] = [];
  for (const [i, j, k] of triangulate(pts)) {
    const P = (x: number, q: [number, number]): V3 => [x, q[0], q[1]];
    out.push(facing(P(x1, pts[i]), P(x1, pts[j]), P(x1, pts[k]), [1, 0, 0]));
    out.push(facing(P(x0, pts[i]), P(x0, pts[k]), P(x0, pts[j]), [-1, 0, 0]));
  }
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const outward: V3 = [0, q[1] - p[1], -(q[0] - p[0])];
    const a: V3 = [x0, p[0], p[1]], b: V3 = [x0, q[0], q[1]], c: V3 = [x1, q[0], q[1]], d: V3 = [x1, p[0], p[1]];
    out.push(facing(a, b, c, outward), facing(a, c, d, outward));
  }
  return out;
}

/** A round tube along a polyline (hoses, belts, straps). */
function tube(path: V3[], r: number, seg = 8): Tri[] {
  const out: Tri[] = [];
  for (let i = 0; i < path.length - 1; i++) out.push(...cyl(path[i], path[i + 1], r, r, seg, i === 0 || i === path.length - 2));
  // Joints: small balls so the segments meet cleanly
  for (let i = 1; i < path.length - 1; i++) out.push(...sphere(path[i], r, r, r, seg, 6));
  return out;
}

/** Points on a smooth curve through the given ones (Catmull-Rom), n per span. */
function curve(pts: V3[], n = 6): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)) as V3);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Moves / turns triangles: `f` maps a point, normals follow the linear part. */
function transform(tris: Tri[], f: (p: V3) => V3): Tri[] {
  const o = f([0, 0, 0]);
  const lin = (v: V3) => sub(f(v), o);
  return tris.map((t) => t.map((v) => ({ p: f(v.p), n: norm(lin(v.n)), uv: v.uv })) as Tri);
}
const rotZ = (a: number, c: V3 = [0, 0, 0]) => (p: V3): V3 => {
  const [x, y] = [p[0] - c[0], p[1] - c[1]];
  return [c[0] + x * Math.cos(a) - y * Math.sin(a), c[1] + x * Math.sin(a) + y * Math.cos(a), p[2]];
};
const rotX = (a: number, c: V3 = [0, 0, 0]) => (p: V3): V3 => {
  const [y, z] = [p[1] - c[1], p[2] - c[2]];
  return [p[0], c[1] + y * Math.cos(a) - z * Math.sin(a), c[2] + y * Math.sin(a) + z * Math.cos(a)];
};
const mirrorX = (tris: Tri[]): Tri[] => tris.map((t) => [t[0], t[2], t[1]].map((v) => ({ p: [-v.p[0], v.p[1], v.p[2]] as V3, n: [-v.n[0], v.n[1], v.n[2]] as V3, uv: v.uv })) as Tri);

// ------------------------------------------------------------------ model + DKO writer

interface Material {
  name: string;
  color: V3;
  specular?: number;
  shininess?: number;
  emissive?: V3;
  twoSided?: boolean;
  texture?: string;
}
interface Mesh {
  name: string;
  mat: number;
  /** Triangles per frame (same count and order in every frame). */
  frames: Tri[][];
  /** UVs change per frame (scrolling texture). */
  animatedUV?: boolean;
}
interface Dummy {
  name: string;
  position: V3;
  matrix: number[];
}
interface Model {
  frames: number;
  materials: Material[];
  meshes: Mesh[];
  dummies: Dummy[];
}

const C = {
  VERSION: 0x0000, TIME_INFO: 0x0001, PROPERTIES: 0x0100, NAME: 0x0110, POSITION: 0x0120, MATRIX: 0x0130,
  MATLIST: 0x0200, MATNAME: 0x0210, AMBIENT: 0x0230, DIFFUSE: 0x0240, SPECULAR: 0x0250, EMISSIVE: 0x0260,
  SHININESS: 0x0270, TRANSPARENCY: 0x0280, TWO_SIDED: 0x0290, TEX_DIFFUSE: 0x02c0, TRI_MESH: 0x0300,
  NB_MAT_GROUP: 0x0340, MAT_ID: 0x0341, NB_VERTEX: 0x0342, VERTEX_ARRAY: 0x0343, NORMAL_ARRAY: 0x0344,
  TEXCOORD_ARRAY: 0x0345, TEXCOORD_ARRAY_ANIM: 0x0346, DUMMY: 0x0400, END: 0x0900,
};
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

class Out {
  parts: Buffer[] = [];
  i16(v: number) {
    const b = Buffer.alloc(2);
    b.writeInt16LE(v);
    this.parts.push(b);
  }
  i32(v: number) {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v);
    this.parts.push(b);
  }
  u8(v: number) {
    this.parts.push(Buffer.from([v]));
  }
  f32(...vs: number[]) {
    const b = Buffer.alloc(vs.length * 4);
    vs.forEach((v, i) => b.writeFloatLE(v, i * 4));
    this.parts.push(b);
  }
  str(s: string) {
    this.parts.push(Buffer.from(s + '\0', 'latin1'));
  }
}

/** CDkoModel::loadFromFile in reverse. */
function writeDko(file: string, m: Model): void {
  const o = new Out();
  o.i16(C.VERSION);
  o.i16(2);
  o.i16(C.TIME_INFO);
  o.i16(0);
  o.i16(m.frames - 1);
  o.i16(m.frames);
  o.i16(C.PROPERTIES);
  o.i16(C.NAME);
  o.str('');
  o.i16(C.POSITION);
  o.f32(0, 0, 0);
  o.i16(C.MATRIX);
  o.f32(...IDENTITY);
  o.i16(C.END);
  if (m.materials.length) {
    o.i16(C.MATLIST);
    o.i16(m.materials.length);
    // The reader stores them backward (materialArray[nbMat - i - 1])
    for (const mat of [...m.materials].reverse()) {
      const [r, g, b] = mat.color;
      const s = mat.specular ?? 0;
      o.i16(C.MATNAME);
      o.str(mat.name);
      o.i16(C.AMBIENT);
      o.f32(r, g, b, 1);
      o.i16(C.DIFFUSE);
      o.f32(r, g, b, 1);
      o.i16(C.SPECULAR);
      o.f32(s, s, s, 1);
      o.i16(C.EMISSIVE);
      o.f32(...(mat.emissive ?? [0, 0, 0]), 1);
      o.i16(C.SHININESS);
      o.i16(mat.shininess ?? 9);
      o.i16(C.TRANSPARENCY);
      o.f32(0);
      o.i16(C.TWO_SIDED);
      o.u8(mat.twoSided ? 1 : 0);
      if (mat.texture) {
        o.i16(C.TEX_DIFFUSE);
        o.str(mat.texture);
      }
      o.i16(C.END);
    }
  }
  for (const mesh of m.meshes) {
    const nbVertex = mesh.frames[0].length * 3;
    for (const f of mesh.frames) if (f.length * 3 !== nbVertex) throw new Error(`${file}: ${mesh.name}: frames differ`);
    o.i16(C.TRI_MESH);
    o.i16(C.NAME);
    o.str(mesh.name);
    o.i16(C.POSITION);
    o.f32(0, 0, 0);
    o.i16(C.MATRIX);
    o.f32(...IDENTITY);
    o.i16(C.NB_MAT_GROUP);
    o.i16(1);
    o.i16(C.MAT_ID);
    o.i16(mesh.mat);
    o.i16(C.NB_VERTEX);
    o.i32(nbVertex);
    o.i16(C.VERTEX_ARRAY);
    for (const f of mesh.frames) for (const t of f) for (const v of t) o.f32(...v.p);
    o.i16(C.NORMAL_ARRAY);
    for (const f of mesh.frames) for (const t of f) for (const v of t) o.f32(...v.n);
    if (mesh.animatedUV) {
      o.i16(C.TEXCOORD_ARRAY_ANIM);
      for (const f of mesh.frames) for (const t of f) for (const v of t) o.f32(...v.uv);
    } else {
      o.i16(C.TEXCOORD_ARRAY);
      for (const t of mesh.frames[0]) for (const v of t) o.f32(...v.uv);
    }
    o.i16(C.END); // mat group
    o.i16(C.END); // mesh
  }
  for (const d of m.dummies) {
    o.i16(C.DUMMY);
    o.i16(C.NAME);
    o.str(d.name);
    o.i16(C.POSITION);
    for (let f = 0; f < m.frames; f++) o.f32(...d.position);
    o.i16(C.MATRIX);
    for (let f = 0; f < m.frames; f++) o.f32(...d.matrix);
    o.i16(C.END);
  }
  o.i16(C.END);
  mkdirSync('public/assets/models', { recursive: true });
  writeFileSync(file, Buffer.concat(o.parts));
}

/** A one-frame model: meshes given as [name, material index, triangles]. */
const still = (materials: Material[], meshes: [string, number, Tri[]][], dummies: Dummy[] = []): Model => ({
  frames: 1,
  materials,
  meshes: meshes.map(([name, mat, tris]) => ({ name, mat, frames: [tris] })),
  dummies,
});

/** The game's own muzzle / shell dummies of a weapon. */
const weaponDummyList = (weaponID: number): Dummy[] => {
  const set = weaponDummies[weaponID];
  return [
    ...set.flashes.map((d, i) => ({ name: `flash${i + 1}`, position: d.position, matrix: d.matrix })),
    ...set.ejects.map((d, i) => ({ name: `eject${i + 1}`, position: d.position, matrix: d.matrix })),
  ];
};

const GUN_METAL: Material = { name: 'Gun metal', color: [0.24, 0.24, 0.25] };


// ------------------------------------------------------------------ weapons

function smg(): Model {
  const [x, z] = [33, 49.73];
  return still([GUN_METAL], [['Body', 0, [
    ...box(28, -6, 43, 38, 40, 58),
    ...cyl([x, 38, z], [x, 62, z], 5, 5, 8),
    ...cyl([x, 60, z], [x, 79.57, z], 3, 3, 8),
    ...extrudeX([[12, 43], [21, 43], [23, 26], [15, 26]], 30, 36), // magazine, raked forward
    ...extrudeX([[-4, 43], [4, 43], [0, 31], [-8, 31]], 30.5, 35.5), // grip
    ...extrudeX([[-6, 56], [-6, 47], [-26, 45], [-26, 57]], 30, 36), // stock
    ...box(31, 2, 58, 35, 34, 61), // top rail
    ...box(31.5, 54, 55, 34.5, 58, 59), // front sight
    ...box(38, 16, 52, 39.5, 28, 57), // ejection port
  ]]], weaponDummyList(0));
}

function shotgun(): Model {
  const [x, z] = [15.86, 49.73];
  return still([GUN_METAL], [['Body', 0, [
    ...cyl([x, 44, z], [x, 109.57, z], 4.2, 4.2, 10),
    ...cyl([x, 44, 41.5], [x, 92, 41.5], 3.3, 3.3, 8), // magazine tube
    ...cyl([x, 58, 41.5], [x, 82, 41.5], 6.2, 6.2, 8), // pump
    ...box(9, 14, 39, 27.5, 46, 59), // receiver
    ...extrudeX([[14, 56], [14, 44], [2, 39], [-9, 35], [-9, 53]], 12, 23), // stock
    ...box(10, 0, 33, 16, 8, 41), // grip
    ...tube(curve([[12, 2, 58], [8, 4, 86], [-14, 6, 100], [-40, 4, 88], [-52, 0, 62]]), 2.4, 6), // sling over the orb
  ]]], weaponDummyList(1));
}

function sniper(): Model {
  const x = 24.45;
  return still([GUN_METAL], [['Body', 0, [
    ...cyl([x, 50, 49.73], [x, 118, 49.73], 2.8, 2.6, 8),
    ...cyl([x, 116, 49.73], [x, 126.55, 49.73], 4.2, 4.2, 6), // muzzle brake
    ...box(19, 18, 43, 30, 56, 58), // receiver
    ...cyl([x, 24, 66], [x, 58, 66], 4.4, 4.4, 10), // scope tube
    ...cyl([x, 52, 66], [x, 64, 66], 4.4, 6.8, 10), // objective bell
    ...cyl([x, 16, 66], [x, 26, 66], 6, 4.4, 10), // eyepiece
    ...box(22.5, 28, 57, 26.5, 33, 62.5), // mounts
    ...box(22.5, 46, 57, 26.5, 51, 62.5),
    ...extrudeX([[18, 56], [18, 45], [-8, 40], [-54, 36], [-54, 58], [-24, 57]], 20, 29), // stock
    ...extrudeX([[8, 43], [15, 43], [12, 31], [5, 31]], 21, 28), // grip
    ...box(21, 30, 35, 28, 38, 43), // magazine
  ]]], weaponDummyList(2));
}

function dualMachineGun(): Model {
  const gun = (x: number, z: number): Tri[] => [
    ...box(x - 6, -14, 42, x + 13, 40, 60),
    ...cyl([x, 38, z], [x, 60, z], 5, 5, 8),
    ...cyl([x, 58, z], [x, 79.57, z], 3, 3, 8),
    ...extrudeX([[10, 42], [18, 42], [20, 28], [12, 28]], x - 3, x + 4), // magazine
    ...box(x - 2, 0, 60, x + 2, 30, 63), // rail
  ];
  const right = gun(44.86, 49.73);
  const left = mirrorX(gun(44.86, 50.63));
  return still([GUN_METAL], [['Body', 0, [
    ...right,
    ...left,
    ...tube(curve([[42, -6, 60], [34, -4, 92], [0, -2, 110], [-34, -4, 92], [-42, -6, 60]]), 3, 8), // harness over the orb
  ]]], weaponDummyList(3));
}

function chainGun(): Model {
  const [cx, cz] = [50.32, 49.73];
  const barrels: Tri[] = [];
  for (const a of [0, 90, 180, 270]) {
    const t = (a * Math.PI) / 180;
    const [bx, bz] = [cx + Math.cos(t) * 10, cz + Math.sin(t) * 10];
    barrels.push(...cyl([bx, 28, bz], [bx, 79.57, bz], 2.6, 2.6, 8));
  }
  return still([GUN_METAL], [['Body', 0, [
    ...barrels,
    ...cyl([cx, 24, cz], [cx, 80, cz], 4, 4, 8), // spindle
    ...cyl([cx, 68, cz], [cx, 73, cz], 14.5, 14.5, 12), // front clamp
    ...cyl([cx, 30, cz], [cx, 36, cz], 15, 15, 12), // rear clamp
    ...cyl([cx, -6, cz], [cx, 30, cz], 13.5, 13.5, 10), // motor housing
    ...box(cx - 3, 4, cz + 13, cx + 3, 8, cz + 19), // carry handle posts
    ...box(cx - 3, 22, cz + 13, cx + 3, 26, cz + 19),
    ...box(cx - 3, 4, cz + 18, cx + 3, 26, cz + 21),
    ...box(-53, -26, 38, -30, -4, 60), // ammo box
    ...tube(curve([[-40, -14, 60], [-26, -12, 90], [10, -8, 96], [36, -2, 74], [44, 4, 60]]), 3.2, 8), // belt
  ]]], weaponDummyList(4));
}

function bazooka(): Model {
  const [x, z] = [35.16, 83.95];
  return still([{ name: 'Olive', color: [0.24, 0.33, 0.24] }], [
    ['Tube', 0, [
      ...cyl([x, -52, z], [x, 70, z], 12, 12, 12),
      ...cyl([x, 68, z], [x, 80, z], 12, 15.5, 12, true), // flared muzzle
      ...cyl([x, -60, z], [x, -50, z], 15, 12, 12, true), // rear flare
      ...cyl([x, 20, z], [x, 26, z], 13.5, 13.5, 12), // band
    ]],
    ['Fittings', 0, [
      ...extrudeX([[0, 74], [9, 74], [6, 61], [-1, 61]], x - 4, x + 4), // rear grip
      ...extrudeX([[30, 74], [37, 74], [36, 64], [31, 64]], x - 3.5, x + 3.5), // front grip
      ...box(x - 14, 8, z + 6, x - 9, 32, z + 11), // sight
      ...box(x - 8, -16, z - 12, x + 8, -4, z - 9), // shoulder rest
    ]],
  ], weaponDummyList(5));
}

function photonRifle(): Model {
  const x = 28.62;
  const GLOW: Material = { name: 'Photon', color: [0.39, 0.75, 0.89], emissive: [0.17, 0.33, 0.39] };
  const GREY: Material = { name: 'Casing', color: [0.43, 0.43, 0.45] };
  const coils: Tri[] = [];
  for (const y of [-4, 8, 20, 32]) coils.push(...cyl([x, y, 51], [x, y + 4, 51], 9.5, 9.5, 10));
  return still([GLOW, GREY], [
    ['Casing', 1, [
      ...extrudeX([[-36, 47], [-12, 60], [42, 60], [56, 55], [56, 45], [40, 41], [-12, 41], [-36, 44]], 22, 35),
      ...box(23.5, 44, 56, 33.5, 122, 59), // upper rail
      ...box(23.5, 44, 41, 33.5, 114, 44), // lower rail
      ...extrudeX([[-24, 60], [26, 60], [-10, 104]], 26.5, 30.5), // top fin
      ...box(-45, -32, 44, -24, -10, 66), // power cell
      ...tube(curve([[-26, -20, 60], [-4, -24, 72], [16, -18, 62], [24, -10, 54]]), 2.4, 6), // cable
    ]],
    ['Coils', 0, [
      ...coils,
      ...cyl([x, 40, 50.05], [x, 57.69, 50.05], 3, 3, 8), // emitter core
      ...box(23.5, 118, 55, 33.5, 122, 60), // rail tips
      ...box(23.5, 110, 40, 33.5, 114, 45),
      ...box(-46, -28, 50, -43, -14, 60), // cell window
    ]],
  ], weaponDummyList(6));
}

function flameThrower(): Model {
  const TANK: Material = { name: 'Tank', color: [0.82, 0.02, 0.02], specular: 0.64, shininess: 42 };
  const STEEL: Material = { name: 'Steel', color: [0.29, 0.29, 0.3] };
  const HOSE: Material = { name: 'Hose', color: [0.38, 0.36, 0.81] };
  const tank = (x: number): Tri[] => [
    ...cyl([x, -58, 52], [x, -58, 100], 13, 13, 12, false),
    ...sphere([x, -58, 100], 13, 13, 9, 12, 8),
    ...sphere([x, -58, 52], 13, 13, 9, 12, 8),
  ];
  return still([TANK, STEEL, HOSE], [
    ['Tanks', 0, [...tank(-14), ...tank(14)]],
    ['Gun', 1, [
      ...extrudeX([[-2, 44], [40, 44], [40, 56], [-2, 59]], 34, 44),
      ...cyl([39.12, 38, 49.71], [39.12, 64, 49.71], 3.6, 3, 8),
      ...cyl([39.12, 63, 49.71], [39.12, 69.81, 49.71], 4.8, 4.8, 8), // nozzle tip
      ...box(36, 8, 31, 42, 15, 44), // grip
      ...box(36.5, 52, 42, 41.5, 60, 45), // pilot light
      ...box(-27, -61, 70, 27, -55, 77), // strap between the tanks
      ...cyl([-14, -58, 109], [-14, -58, 115], 4, 4, 8), // valves
      ...cyl([14, -58, 109], [14, -58, 115], 4, 4, 8),
    ]],
    ['Hose', 2, tube(curve([[14, -48, 50], [28, -34, 38], [40, -12, 40], [39, 0, 47]]), 2.6, 8)],
  ], weaponDummyList(7));
}

// ------------------------------------------------------------------ knives, nuke, shield, magnet, mini bot

/** Knife.tga: a blade pointing to +u, its handle on the left, on transparent. */
function knifeTexture(): void {
  const r = new Raster(64, 64).fill([0, 0, 0], 0);
  const steel = (x: number, y: number): number[] => {
    const k = 0.75 + 0.25 * Math.cos(((y - 32) / 6) * Math.PI);
    return [0.86 * k, 0.88 * k, 0.92 * k];
  };
  r.draw(polygon([[24, 26], [50, 26], [62, 32], [50, 37], [24, 37]]), steel);
  r.draw(line(27, 30, 52, 30, 1), [1, 1, 1], 0.7);
  r.draw(rect(20, 22, 25, 42), [0.55, 0.5, 0.42]); // guard
  r.draw(rect(3, 27, 21, 36), (x, y) => [0.45 * (0.8 + 0.2 * Math.sin(x * 1.3)), 0.12, 0.08]); // handle
  r.draw(rect(1, 26, 4, 37), [0.55, 0.5, 0.42]); // pommel
  writeTGA('public/assets/models/Knife.tga', r, true);
}

function knives(): Model {
  // Radius of the spinning blades over the 11 frames of a strike, and their spin
  const R = [50, 63, 72, 78, 84, 92, 102, 110, 115, 113, 106];
  const meshes: Mesh[] = [];
  for (let k = 0; k < 8; k++) {
    const frames: Tri[][] = [];
    for (let f = 0; f < R.length; f++) {
      const a = (k * Math.PI) / 4 + f * 0.21;
      const d: V3 = [Math.cos(a), Math.sin(a), 0];
      const s: V3 = [-Math.sin(a), Math.cos(a), 0];
      const inner = mul(d, R[f] - 30);
      const outer = mul(d, R[f] + 4);
      const zA = 50, zB = 56.5; // slightly tilted blades
      const p = (b: V3, side: number, z: number): V3 => add(add(b, mul(s, side * 6)), [0, 0, z]);
      const q: V3[] = [p(inner, -1, zA), p(outer, -1, zA), p(outer, 1, zB), p(inner, 1, zB)];
      const uv: UV[] = [[0, 1], [1, 1], [1, 0], [0, 0]];
      const n = norm(cross(sub(q[1], q[0]), sub(q[2], q[0])));
      const V = (i: number): Vert => ({ p: q[i], n, uv: uv[i] });
      frames.push([[V(0), V(1), V(2)], [V(0), V(2), V(3)]]);
    }
    meshes.push({ name: `Blade0${k + 1}`, mat: 0, frames, animatedUV: false });
  }
  return { frames: R.length, materials: [{ name: 'Knife', color: [1, 1, 1], shininess: 0, twoSided: true, texture: 'Knife.tga' }], meshes, dummies: [] };
}

function nuclear(): Model {
  const GREY: Material = { name: 'Drum', color: [0.5, 0.5, 0.5] };
  const BLACK: Material = { name: 'Sign', color: [0.02, 0.02, 0.02] };
  const YELLOW: Material = { name: 'Hazard', color: [1, 0.88, 0.2] };
  const [y, z] = [-28, 48];
  // Radiation sign on the drum's end (facing -x): yellow disc, three black blades, black hub
  const end = -70.6;
  const blades: Tri[] = [];
  for (let k = 0; k < 3; k++) {
    const a0 = (k * 2 * Math.PI) / 3 + Math.PI / 6;
    const pts: V3[] = [];
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (i / 6) * (Math.PI / 3);
      pts.push([end - 0.4, y + Math.cos(a) * 13, z + Math.sin(a) * 13]);
    }
    for (let i = 6; i >= 0; i--) {
      const a = a0 + (i / 6) * (Math.PI / 3);
      pts.push([end - 0.4, y + Math.cos(a) * 4.5, z + Math.sin(a) * 4.5]);
    }
    for (let i = 0; i < 6; i++) blades.push(facing(pts[i], pts[i + 1], pts[12 - i], [-1, 0, 0]), facing(pts[i + 1], pts[11 - i], pts[12 - i], [-1, 0, 0]));
  }
  return still([GREY, BLACK, YELLOW], [
    ['Drum', 0, [
      ...cyl([-70, y, z], [-8, y, z], 18, 18, 14),
      ...cyl([-66, y, z], [-62, y, z], 19.3, 19.3, 14, false),
      ...cyl([-16, y, z], [-12, y, z], 19.3, 19.3, 14, false),
      ...box(-12, -34, 40, 2, -22, 56), // clamp to the orb
    ]],
    ['Sign', 1, [...blades, ...cyl([end, y, z], [end - 0.5, y, z], 3, 3, 10)]],
    ['Hazard', 2, [...cyl([-45, y, z], [-33, y, z], 18.6, 18.6, 14, false), ...cyl([-70, y, z], [end, y, z], 16, 16, 16)]],
  ]);
}

/** Shieldtga.tga: dark energy cells with bright seams (drawn additively in game). */
function shieldTexture(): void {
  const v = voronoi(77, 6, 128);
  const n = fbm(78, 4, 4, 4);
  const r = new Raster(128, 128).shade((x, y) => {
    const q = v(x, y);
    const seam = Math.max(0, 1 - (q.d2 - q.d1) / 5) ** 2;
    const k = 0.25 + 0.75 * seam + 0.25 * n((x / 128) * 4, (y / 128) * 4);
    return [0.03 * k, 0.45 * k, 0.95 * k, Math.min(0.82, 0.12 + 0.75 * seam)];
  });
  writeTGA('public/assets/models/Shieldtga.tga', r, true);
}

function shield(): Model {
  // Bubble radius over 21 frames: bursts out, holds, folds back
  const radius = (f: number) => (f <= 5 ? 26 + 73 * Math.sin((f / 5) * (Math.PI / 2)) : f <= 10 ? 99 : 99 - 79 * ((f - 10) / 10) ** 1.4);
  const frames: Tri[][] = [];
  for (let f = 0; f < 21; f++) {
    const r = radius(f);
    const tris = sphere([0, 0, 54 + (10 * (r - 26)) / 73], r, r, r * 0.86, 16, 10, false, 2);
    frames.push(tris.map((t) => t.map((vtx) => ({ ...vtx, uv: [vtx.uv[0] + f * 0.045, vtx.uv[1] + f * 0.02] as UV })) as Tri));
  }
  return { frames: 21, materials: [{ name: 'Energy', color: [0.6, 0.6, 0.6], texture: 'Shieldtga.tga' }], meshes: [{ name: 'Bubble', mat: 0, frames, animatedUV: true }], dummies: [] };
}

function shieldMagnet(): Model {
  // A horseshoe over the orb, turning once during the shield
  const arc: V3[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI * 0.15 + (i / 12) * Math.PI * 1.7;
    arc.push([Math.cos(a) * 44, Math.sin(a) * 44, 56]);
  }
  const base = transform([...tube(arc, 5.5, 8), ...cyl(arc[0], add(arc[0], [6, -4, 0]), 7, 7, 8), ...cyl(arc[12], add(arc[12], [6, 4, 0]), 7, 7, 8)], rotX(0.42, [0, 0, 56]));
  const frames: Tri[][] = [];
  for (let f = 0; f < 21; f++) frames.push(transform(base, rotZ((f / 21) * Math.PI * 2)));
  return { frames: 21, materials: [{ name: 'Magnet', color: [0.67, 0.67, 0.68], specular: 0.19 }], meshes: [{ name: 'Magnet', mat: 0, frames }], dummies: [] };
}

function antenna(): Model {
  const dome = sphere([0, 0, 92], 24, 24, 12, 12, 8).filter((t) => t.every((v) => v.p[2] >= 91.9));
  return still([{ name: 'Dome', color: [0.6, 0.6, 0.6], texture: 'Shieldtga.tga' }, { name: 'Rod', color: [0.14, 0.14, 0.15], specular: 0.19 }], [
    ['Dome', 0, dome],
    ['Rod', 1, [...cyl([0, 0, 100], [0, 0, 156], 2, 1.4, 6), ...sphere([0, 0, 158], 3.5, 3.5, 3.5, 8, 6)]],
  ]);
}

function hand(): Model {
  // No shape: only where thrown grenades and molotovs leave the orb
  return { frames: 1, materials: [], meshes: [], dummies: weaponDummyList(8) };
}

// ------------------------------------------------------------------ projectiles and items

function grenade(): Model {
  const BODY: Material = { name: 'Body', color: [0.36, 0.53, 0.22] };
  const LEVER: Material = { name: 'Lever', color: [0.9, 0.88, 0.62] };
  const ring: V3[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    ring.push([-7 + Math.cos(a) * 4.5, 0, 22 + Math.sin(a) * 4.5]);
  }
  return still([BODY, LEVER], [
    ['Body', 0, sphere([0, 0, 0], 14, 14, 17, 8, 6, true)],
    ['Fuse', 1, [
      ...cyl([0, 0, 14], [0, 0, 21], 5.5, 5, 8),
      ...extrudeX([[-1, 21.5], [4, 22.5], [16, 14], [19, 2], [16, 1], [13, 12], [3, 19]], -2.5, 2.5).map((t) => transform([t], rotZ(Math.PI / 2))[0]),
      ...tube(ring, 0.9, 5),
    ]],
  ]);
}

function molotov(): Model {
  return still([{ name: 'Glass', color: [0.53, 0.61, 0.54], specular: 0.3, shininess: 30 }], [['Bottle', 0, [
    ...cyl([0, 0, -27], [0, 0, 30], 17, 17, 12),
    ...cyl([0, 0, 30], [0, 0, 46], 17, 6.4, 12, false),
    ...cyl([0, 0, 46], [0, 0, 74], 6, 6, 10, false),
    ...cyl([0, 0, 74], [0, 0, 79], 7.2, 7.2, 10),
    ...cyl([0, 0, 79], [0.5, -0.13, 81.73], 4.5, 3.5, 8),
  ]]], [{ name: 'Flame', position: [0.5, -0.13, 81.73], matrix: IDENTITY }]);
}

function rocket(): Model {
  const BODY: Material = { name: 'Body', color: [0.82, 0.82, 0.83], specular: 0.38, shininess: 44 };
  const TIP: Material = { name: 'Tip', color: [0.64, 1, 0], specular: 0.38, shininess: 44 };
  return still([BODY, TIP], [
    ['Body', 0, [
      ...cyl([0, 8, 0], [0, 72, 0], 8, 8, 10),
      ...cyl([0, -2, 0], [0, 9, 0], 5.5, 7.5, 10), // nozzle
      ...box(-16.8, 2, -0.8, 16.8, 22, 0.8), // fins
      ...box(-0.8, 2, -14, 0.8, 22, 14),
    ]],
    ['Tip', 1, cyl([0, 72, 0], [0, 100, 0], 8, 0.6, 10)],
  ], [{ name: 'Exaust', position: [0, 0, 0.25], matrix: [1, 0, 0, 0, 0, 1, 0, -1, 0] }]);
}

function lifePack(): Model {
  // White case with a green cross, like the HUD's health sign (the red cross on white and the white
  // cross on red are protected emblems)
  return still([{ name: 'Case', color: [0.92, 0.92, 0.92] }, { name: 'Cross', color: [0.1, 0.7, 0.25] }], [
    ['Case', 0, [...box(-40, -40, 0, 40, 40, 16), ...box(-36, -36, 16, 36, 36, 19)]],
    ['Cross', 1, [...box(-25, -8, 19, 25, 8, 21), ...box(-8, -25, 19, 8, 25, 21), ...box(-41, -6, 4, 41, 6, 12), ...box(-6, -41, 4, 6, 41, 12)]],
  ]);
}

function flag(color: V3): Model {
  const POLE: Material = { name: 'Pole', color: [0.69, 0.58, 0.29] };
  const CLOTH: Material = { name: 'Cloth', color, emissive: mul(color, 0.5), twoSided: true };
  const pole = [...cyl([0, 0, 0], [0, 0, 200], 4.5, 4.5, 8), ...sphere([0, 0, 203], 6.5, 6.5, 6.5, 8, 6)];
  const cols = 8, rows = 4;
  const frames: Tri[][] = [];
  for (let f = 0; f < 11; f++) {
    const ph = (f / 11) * Math.PI * 2;
    const P = (i: number, j: number): V3 => {
      const x = 5 + (i / cols) * 165;
      const t = x / 170;
      return [x, 10 * t * Math.sin(t * 7 - ph) + 3 * Math.sin(j * 0.9 + ph), 198 - (j / rows) * 70 - 6 * t * t];
    };
    const tris: Tri[] = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        tris.push(flatTri(P(i, j), P(i, j + 1), P(i + 1, j + 1)), flatTri(P(i, j), P(i + 1, j + 1), P(i + 1, j)));
      }
    }
    frames.push(tris);
  }
  return {
    frames: 11,
    materials: [POLE, CLOTH],
    meshes: [{ name: 'Pole', mat: 0, frames: Array.from({ length: 11 }, () => pole) }, { name: 'Cloth', mat: 1, frames }],
    dummies: [],
  };
}

function flagPod(color: V3): Model {
  const panels: Tri[] = [];
  for (let k = 0; k < 4; k++) panels.push(...transform(box(52, -9, 13.5, 80, 9, 16), rotZ(Math.PI / 4 + (k * Math.PI) / 2)));
  return still([{ name: 'Base', color: [0.59, 0.59, 0.6] }, { name: 'Team', color }], [
    ['Base', 0, [
      ...cyl([0, 0, 0], [0, 0, 14], 88, 82, 8, true, Math.PI / 8),
      ...cyl([0, 0, 14], [0, 0, 30], 60, 54, 8, true, Math.PI / 8),
      ...cyl([0, 0, 30], [0, 0, 50], 13, 11, 8, true, Math.PI / 8),
    ]],
    ['Team', 1, [...panels, ...cyl([0, 0, 30], [0, 0, 32], 44, 44, 16)]],
  ], [{ name: 'Flag', position: [0, 0, 50], matrix: IDENTITY }]);
}

function casing(): Model {
  return still([{ name: 'Brass', color: [1, 0.87, 0.59], specular: 0.37, shininess: 63, emissive: [0.5, 0.44, 0.29] }], [['Casing', 0, [
    ...cyl([0, -7.3, 0], [0, 7.7, 0], 3.2, 3.2, 6),
    ...cyl([0, -8.3, 0], [0, -7.3, 0], 3.6, 3.6, 6),
  ]]]);
}

function gib(): Model {
  // A lumpy chunk: a faceted ball pushed in and out
  const lump = (seed: number, c: V3, r: number): Tri[] => {
    const tris = sphere(c, r, r * 0.85, r * 0.75, 7, 5, true);
    return tris.map((t) => relit(t.map((v) => {
      const d = sub(v.p, c);
      const k = 1 + 0.28 * Math.sin(d[0] * 0.9 + seed) * Math.cos(d[1] * 0.7 - seed) + 0.12 * Math.sin(d[2] * 1.3 + seed * 2);
      return { ...v, p: add(c, mul(d, k)) };
    }) as Tri));
  };
  return still([{ name: 'Red', color: [0.56, 0.02, 0.02] }, { name: 'Pale', color: [0.65, 0.48, 0.48] }], [
    ['Chunk', 0, lump(1.3, [0, 0, 2], 12)],
    ['Bit', 1, lump(4.1, [5, -6, 9], 5.5)],
  ]);
}

// ------------------------------------------------------------------ write

const MODELS: Record<string, () => Model> = {
  'SMG.DKO': smg,
  'ShotGun.DKO': shotgun,
  'Sniper.DKO': sniper,
  'DualMachineGun.DKO': dualMachineGun,
  'ChainGun.DKO': chainGun,
  'Bazooka.DKO': bazooka,
  'PhotonRifle.DKO': photonRifle,
  'FlameThrower.DKO': flameThrower,
  'Knifes.DKO': knives,
  'Nuclear.DKO': nuclear,
  'Shield.DKO': shield,
  'ShieldMagnet.DKO': shieldMagnet,
  'Antena.DKO': antenna,
  'Hand.DKO': hand,
  'Grenade.DKO': grenade,
  'CocktailMolotov.DKO': molotov,
  'Rocket.DKO': rocket,
  'LifePack.DKO': lifePack,
  'BlueFlag.DKO': () => flag([0, 0, 1]),
  'RedFlag.DKO': () => flag([1, 0, 0]),
  'BlueFlagPod.DKO': () => flagPod([0, 0, 1]),
  'RedFlagPod.DKO': () => flagPod([1, 0, 0]),
  'Douille.DKO': casing,
  'Gib.DKO': gib,
};

knifeTexture();
shieldTexture();
const only = process.argv.slice(2);
for (const [file, make] of Object.entries(MODELS)) {
  if (only.length && !only.includes(file)) continue;
  writeDko(`public/assets/models/${file}`, make());
}
console.log(`wrote ${only.length ? only.join(', ') : Object.keys(MODELS).length + ' models'} + Knife.tga, Shieldtga.tga`);

