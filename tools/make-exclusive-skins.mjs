// Draws Mad Orbs' own Orb skins (skin24..skin26: Honeycomb, Flames, Royal; Royal was named Crown until 29/10/2026, when the
// crowns came; skin27: the 8 ball, 29/10/2026; skin28: the camo, 30/10/2026, the look of the site's icon), won at the
// waves' milestones (src/client/wavesProgress.ts), and the original game's styles redrawn (skin01: the tennis ball,
// 30/10/2026, Erick: the original's hand-drawn seam came out lumpy; skin03: the lightning bolt, the same day; skin04: the
// star, skin06: the cow print, skin07: the belt and skin08: the grille band, 31/10/2026). Mad Orbs' own art, made here,
// not the original game's. A skin is a 64x32 equirectangular texture (the 8 ball, the camo and the redrawn ones 256x128, for their detail)
// whose red, green and blue say how much of each of the player's three colours goes on each texel, black where all
// three are 0 (src/client/render/baboRenderer.ts, Player::updateSkin).
//   node tools/make-exclusive-skins.mjs            -> public/assets/skins/skin01.tga, skin03.tga, skin04.tga, skin06.tga, skin07.tga, skin08.tga, skin24.tga ... skin28.tga
//   node tools/make-exclusive-skins.mjs --preview  -> also shots/exclusive-skins.ppm (8x, to look at)
//   node tools/make-exclusive-skins.mjs --drafts   -> also shots/drafts/<name>.tga: the draws kept for later (DRAFTS)
import { mkdirSync, writeFileSync } from 'node:fs';

/** The original game's size (the 8 ball is bigger: SIZES). */
const W = 64;
const H = 32;
const SIZES = { skin01: [256, 128], skin03: [256, 128], skin04: [256, 128], skin06: [256, 128], skin07: [256, 128], skin08: [256, 128], skin27: [256, 128], skin28: [256, 128] };
/** Samples per texel side: the edges come out smooth. */
const SS = 6;

const fract = (x) => x - Math.floor(x);
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------ for the camo
/** The point of the Orb at (u, v) (createGluSphere in src/client/render/baboRenderer.ts: v 0 is the +z pole). */
function dirOf(u, v) {
  const t = u * Math.PI * 2;
  const r = v * Math.PI;
  return [-Math.sin(t) * Math.sin(r), Math.cos(t) * Math.sin(r), Math.cos(r)];
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const l = Math.hypot(...a);
  return a.map((x) => x / l);
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** 3D gradient noise (Perlin's improved noise), seeded: sampled on the sphere itself, no seam and no pinch at the poles. */
const PERM = (() => {
  const p = Array.from({ length: 256 }, (_, i) => i);
  let seed = 20261030;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  return [...p, ...p];
})();
function grad(h, x, y, z) {
  const a = h < 8 ? x : y;
  const b = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? a : -a) + ((h & 2) === 0 ? b : -b);
}
function noise(x, y, z) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const f = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  const [u, v, w] = [f(x), f(y), f(z)];
  const A = PERM[X] + Y;
  const AA = PERM[A] + Z;
  const AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y;
  const BA = PERM[B] + Z;
  const BB = PERM[B + 1] + Z;
  const g = (i, dx, dy, dz) => grad(PERM[i] & 15, x - dx, y - dy, z - dz);
  return lerp(
    lerp(lerp(g(AA, 0, 0, 0), g(BA, 1, 0, 0), u), lerp(g(AB, 0, 1, 0), g(BB, 1, 1, 0), u), v),
    lerp(lerp(g(AA + 1, 0, 0, 1), g(BA + 1, 1, 0, 1), u), lerp(g(AB + 1, 0, 1, 1), g(BB + 1, 1, 1, 1), u), v),
    w,
  );
}
/** A few octaves of it, `k` times smaller, moved by `o`: ragged edges on big blobs. */
const fbm = (p, k, o) =>
  noise(p[0] * k + o, p[1] * k + o * 1.7, p[2] * k - o) * 0.62 +
  noise(p[0] * k * 2.3 + 4.1, p[1] * k * 2.3 - o, p[2] * k * 2.3 + 2.6) * 0.26 +
  noise(p[0] * k * 5.1 - 1.3, p[1] * k * 5.1 + 3.3, p[2] * k * 5.1 + o) * 0.12;
/** Smoother: two octaves, for the black, whose edges can't be soft (a texel is black or not). */
const fbm2 = (p, k, o) => noise(p[0] * k + o, p[1] * k + o * 1.7, p[2] * k - o) * 0.8 + noise(p[0] * k * 2.2 + 4.1, p[1] * k * 2.2 - o, p[2] * k * 2.2 + 2.6) * 0.2;

/**
 * Where the camo's bandana sits: around the top of the Orb as the start screen shows it at rest (orbStudio's FRONT:
 * the world's up falls on u 0.42, v 0.389 of the texture, the viewer on u 0.42, v 0.703, the right on u 0.67, v 0.5),
 * tied on the right, a little to the back.
 */
const UP = dirOf(0.42, 0.389);
const VIEW = norm(dirOf(0.42, 0.703).map((x, i) => x - UP[i] * dot(dirOf(0.42, 0.703), UP)));
const SIDE = (() => {
  const c = norm(cross(VIEW, UP));
  return dot(c, dirOf(0.67, 0.5)) > 0 ? c : c.map((x) => -x);
})();
/** The band: between these angles (radians) from the top. */
const BAND = [0.97, 1.24];
const KNOT_AT = (() => {
  const a = (BAND[0] + BAND[1]) / 2;
  const around = norm(SIDE.map((x, i) => x * 0.95 - VIEW[i] * 0.3));
  return norm(UP.map((x, i) => x * Math.cos(a) + around[i] * Math.sin(a)));
})();
/** The knot's own frame: down the Orb and across. */
const KNOT_DOWN = norm(UP.map((x, i) => -x + KNOT_AT[i] * dot(UP, KNOT_AT)));
const KNOT_ACROSS = cross(KNOT_AT, KNOT_DOWN);

// ------------------------------------------------------------------ for the tennis ball
/**
 * The tennis ball's seam: x = a cos t + b cos 3t, y = a sin t - b sin 3t, z = 2√(ab) sin 2t, on the sphere when
 * a + b = 1 (b: how far the two halves reach into each other). Sampled, with each point's sideways direction (which half).
 */
const SEAM_B = 0.28;
const SEAM_N = 2400;
const SEAM = (() => {
  const a = 1 - SEAM_B;
  const b = SEAM_B;
  const c = 2 * Math.sqrt(a * b);
  const pts = [];
  const sides = [];
  for (let i = 0; i < SEAM_N; i++) {
    const t = (i / SEAM_N) * Math.PI * 2;
    const p = [a * Math.cos(t) + b * Math.cos(3 * t), a * Math.sin(t) - b * Math.sin(3 * t), c * Math.sin(2 * t)];
    const d = [-a * Math.sin(t) - 3 * b * Math.sin(3 * t), a * Math.cos(t) - 3 * b * Math.cos(3 * t), 2 * c * Math.cos(2 * t)];
    pts.push(p);
    sides.push(norm(cross(p, d)));
  }
  return { pts, sides };
})();
/** The seam's half width, in radians of the Orb. */
const SEAM_WIDTH = 0.045;
/** The seam turned around the Orb (in turns) so the picker's still Orbs (orbStudio's FRONT) show its curve across the front. */
const SEAM_TURN = -0.17;

/** The seam point nearest to `p`: every 24th first, then the ones around the best of them. */
function nearestSeam(p) {
  const step = 24;
  let best = -2;
  let k = 0;
  for (let i = 0; i < SEAM_N; i += step) {
    const d = dot(p, SEAM.pts[i]);
    if (d > best) [best, k] = [d, i];
  }
  const around = k;
  for (let j = -step; j <= step; j++) {
    const i = (around + j + SEAM_N) % SEAM_N;
    const d = dot(p, SEAM.pts[i]);
    if (d > best) [best, k] = [d, i];
  }
  return { dist: Math.acos(Math.min(1, best)), side: dot(p, SEAM.sides[k]) };
}

// ------------------------------------------------------------------ for the lightning bolt
const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
};
/** Whether (x, y) is inside the polygon (even-odd), and how far it is from its edge. */
function polygon(poly, x, y) {
  let inside = false;
  let dist = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    dist = Math.min(dist, segDist(x, y, xj, yj, xi, yi));
  }
  return { inside, dist };
}
/** The bolt (Lucide's "zap" icon on its 24 grid, y down), centred, in units of the Orb's radius. */
const BOLT = [[13, 2], [3, 14], [12, 14], [11, 22], [21, 10], [12, 10]].map(([x, y]) => [(x - 12) * 0.058, (12 - y) * 0.058]);
/** The bolt's edge, in colour 3. */
const BOLT_EDGE = 0.035;
/**
 * Two bolts, seen from above their centres (an orthographic view of the sphere there): one where the Orb at rest faces
 * the viewer (orbStudio's FRONT: u 0.42, v 0.703), upright, and one on the far side, so a rolling Orb always shows one.
 */
const BOLT_FACES = [dirOf(0.42, 0.703), dirOf(0.42, 0.703).map((x) => -x)].map((c) => {
  const up = norm(UP.map((x, i) => x - c[i] * dot(UP, c)));
  return { c, up, right: cross(up, c) };
});

// ------------------------------------------------------------------ for the star
/** A star: `n` points at radius `out`, the notches between them at `inner`, the first point at the angle `turn`. */
const starPoly = (n, out, inner, turn) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const a = turn + (i * Math.PI) / n;
    const r = i % 2 ? inner : out;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
/**
 * The stars' axis: the Orb at rest's up tipped 0.6 rad towards the viewer, so the menu shows a star at the top front.
 * Seen from above it (an orthographic view of the sphere), a point of the star points to the top of the Orb.
 */
const STAR_AXIS = norm(UP.map((x, i) => x * Math.cos(0.6) + VIEW[i] * Math.sin(0.6)));
const STAR_UP = norm(UP.map((x, i) => x - STAR_AXIS[i] * dot(UP, STAR_AXIS)));
const STAR_RIGHT = cross(STAR_UP, STAR_AXIS);
/** The 8-point star (colour 1) and the toothed disc around it (colour 3), in units of the Orb's radius. */
const STAR = starPoly(8, 0.6, 0.27, Math.PI / 2);
const STAR_DISC = starPoly(16, 0.86, 0.76, Math.PI / 2 + Math.PI / 16);

// ------------------------------------------------------------------ for the belt
/**
 * The belt (skin07) keeps the original's drawing, measured on its 64x32 grid (x = 64u, y = 32v): two rails around the
 * middle, centred 5 rows above and below it, and two rounded rings on them, a hole in each; every stroke 4 texels wide,
 * 1 of edge on each side.
 */
const BELT_RAILS = [11, 21];
const BELT_RINGS = [15.5, 47.5];
/** The rings' centre line: a rounded rectangle, half its width and height, and its corners' radius. */
const BELT_RING = { w: 8.5, h: 9.5, r: 6.25 };
const BELT_HALF = 2;
const BELT_EDGE = 1;
/** How round the corners where the rails meet the rings are (the smooth minimum's reach, in texels). */
const BELT_ROUND = 1.5;
/** The smaller of two distances, rounded where they're close (a polynomial smooth minimum). */
function smoothMin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
}
/** Signed distance from (x, y) to a rounded rectangle centred on 0 (negative inside). */
function roundRect(x, y, { w, h, r }) {
  const qx = Math.abs(x) - (w - r);
  const qy = Math.abs(y) - (h - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// ------------------------------------------------------------------ for the grille band
/**
 * The grille band (skin08) keeps the original's drawing, measured on its 64x32 grid (x = 64u, y = 32v), symmetric about
 * the front (x 32) and the middle (y 16): a band in colour 1 between rows 7 and 25; at the front an oval in colour 2
 * with three bars in colour 3, the middle one running on through the band to a dot near each pole; a slit out to each
 * side; four windows at the back.
 */
const GRILLE_DOTS = [dirOf(0.5, 1.8 / 32), dirOf(0.5, 30.2 / 32)];
/** Whether (x, y) is inside a rounded box centred on (cx, cy): half its width and height, and its corners' radius. */
const inBox = (x, y, cx, cy, w, h, r) => roundRect(x - cx, y - cy, { w, h, r }) < 0;

// ------------------------------------------------------------------ for the volleyball (a draft)
/** tan 15°: each face's three strips split at ±15° from its middle. */
const T15 = Math.tan(Math.PI / 12);
/** The seams' half width, in radians of the Orb. */
const VOLLEY_SEAM = 0.022;

/**
 * Each skin: (u, v) -> [red, green, blue] shares, u around the Orb (0..1), v from the top row (0) to
 * the bottom one (1). All three 0 is black.
 */
const SKINS = {
  // The tennis ball (the original game's skin01 redrawn, 30/10/2026: its seam was drawn by hand on the 64x32 texture and
  // came out lumpy on the Orb): the two halves in colours 1 and 3, the seam in colour 2
  skin01(u, v) {
    const { dist, side } = nearestSeam(dirOf(u + SEAM_TURN, v));
    if (dist < SEAM_WIDTH) return [0, 1, 0];
    return side > 0 ? [1, 0, 0] : [0, 0, 1];
  },
  // The lightning bolt (the original game's skin03 redrawn, 30/10/2026: one hand-drawn stroke lying around the Orb at
  // 64x32): two bolts in colour 1 with an edge in colour 3, on colour 2
  skin03(u, v) {
    const p = dirOf(u, v);
    for (const { c, up, right } of BOLT_FACES) {
      if (dot(p, c) <= 0.2) continue;
      const { inside, dist } = polygon(BOLT, dot(p, right), dot(p, up));
      if (inside) return [1, 0, 0];
      if (dist < BOLT_EDGE) return [0, 0, 1];
    }
    return [0, 1, 0];
  },
  // The star (the original game's skin04 redrawn, 31/10/2026: an 8-point star at each pole on a toothed dark disc,
  // painted in soft blurs at 64x32): the stars in colour 1 on toothed discs in colour 3, the rest in colour 2. Both
  // poles have one (the star is the same seen from either side), so a rolling Orb shows one
  skin04(u, v) {
    const p = dirOf(u, v);
    const x = dot(p, STAR_RIGHT);
    const y = dot(p, STAR_UP);
    if (polygon(STAR, x, y).inside) return [1, 0, 0];
    if (polygon(STAR_DISC, x, y).inside) return [0, 0, 1];
    return [0, 1, 0];
  },
  // The cow print (the original game's skin06 redrawn, 31/10/2026: big blobs in colours 2 and 3 blurred at 64x32, colour 1
  // left out): big patches in colour 3 and smaller ones in colour 1 on colour 2, round-edged (two octaves of noise,
  // warped a little); with orange, white and black, a calico
  skin06(u, v) {
    const p = dirOf(u, v);
    const warp = [
      noise(p[0] * 1.3 + 5, p[1] * 1.3, p[2] * 1.3),
      noise(p[0] * 1.3, p[1] * 1.3 + 9, p[2] * 1.3),
      noise(p[0] * 1.3, p[1] * 1.3, p[2] * 1.3 + 13),
    ];
    const q = p.map((x, i) => x + warp[i] * 0.35);
    const big = fbm2(q, 1.5, 41.2);
    if (big > 0.13) return [0, 0, 1];
    if (fbm2(q, 1.6, 77.7) > 0.2 && big < 0.07) return [1, 0, 0];
    return [0, 1, 0];
  },
  // The belt (the original game's skin07 redrawn, 31/10/2026, the same drawing: it was good, only blocky at 64x32): rails
  // and rings in colour 3 with an edge in colour 1, on colour 2; where they meet, the strokes merge, and the rings'
  // holes cut the rails
  skin07(u, v) {
    const x = u * 64;
    const y = v * 32;
    let ring = Infinity;
    for (const c of BELT_RINGS) {
      const dx = ((((x - c) % 64) + 96) % 64) - 32;
      ring = Math.min(ring, roundRect(dx, y - 16, BELT_RING));
    }
    if (ring < -BELT_HALF) return [0, 1, 0];
    // The hole's edge goes all the way round, across the rails too
    if (ring < -BELT_HALF + BELT_EDGE) return [1, 0, 0];
    // Rings and rails merged with a small round where they meet (a smooth minimum)
    const stroke = BELT_RAILS.reduce((d, r) => smoothMin(d, Math.abs(y - r) - BELT_HALF, BELT_ROUND), Math.abs(ring) - BELT_HALF);
    if (stroke < -BELT_EDGE) return [0, 0, 1];
    if (stroke < 0) return [1, 0, 0];
    return [0, 1, 0];
  },
  // The grille band (the original game's skin08 redrawn, 31/10/2026, the same drawing: it was blurred at 64x32, and its
  // dots near the poles came out as spikes)
  skin08(u, v) {
    const x = u * 64;
    const y = v * 32;
    // The dots near the poles, round on the Orb itself (a box on the grid would come out as a spike so near the pole)
    const p = dirOf(u, v);
    if (GRILLE_DOTS.some((c) => dot(p, c) > Math.cos(0.075))) return [0, 0, 1];
    if (y <= 7 || y >= 25) return [0, 1, 0];
    const fx = Math.abs(x - 32);
    // The oval (a superellipse) and its bars
    if (Math.pow(fx / 14, 2.6) + Math.pow(Math.abs(y - 16) / 6.6, 2.6) < 1) {
      return inBox(fx, y, 0, 15.5, 2, 5.4, 1) || inBox(fx, y, 6, 15.5, 2, 5.2, 1) ? [0, 0, 1] : [0, 1, 0];
    }
    // The middle bar through the band, with a colour 2 margin
    if (fx < 1) return [0, 0, 1];
    if (fx < 2.2) return [0, 1, 0];
    // The slits: colour 2 lines from the oval out, a colour 3 dash in each
    if (inBox(fx, y, 21.5, 15.25, 3, 0.8, 0.6)) return [0, 0, 1];
    if (inBox(fx, y, 20.5, 15.25, 7, 1.6, 1.2)) return [0, 1, 0];
    // The windows at the back
    if (inBox(Math.min(x, 64 - x), Math.abs(y - 16), 5.5, 6.3, 3.4, 1.1, 0.8)) return [0, 1, 0];
    return [1, 0, 0];
  },
  // Honeycomb: green cells with red walls and a blue core in each
  skin24(u, v) {
    // Texel units; cell centres 8 texels apart around the Orb, rows 6.4 apart, every other row
    // shifted half a cell: the nearest centre draws hexagons, and the grid closes all the way around
    const x = u * W;
    const y = v * H;
    const cw = 8;
    const rh = H / 5;
    let d1 = Infinity;
    let d2 = Infinity;
    const row0 = Math.floor(y / rh);
    for (let row = row0 - 1; row <= row0 + 2; row++) {
      const shift = row % 2 === 0 ? 0 : cw / 2;
      for (let col = 0; col < W / cw; col++) {
        let dx = Math.abs(x - (col * cw + shift)) % W;
        dx = Math.min(dx, W - dx);
        const d = Math.hypot(dx, y - (row + 0.5) * rh);
        if (d < d1) {
          d2 = d1;
          d1 = d;
        } else if (d < d2) d2 = d;
      }
    }
    // On a wall the two nearest centres are about as far
    const wall = 1 - smooth(0.6, 0.95, d2 - d1);
    const core = 1 - smooth(1.4, 1.9, d1);
    return [wall, (1 - wall) * (1 - core), (1 - wall) * core];
  },
  // Flames: red above, green flames rising from below with blue hearts
  skin25(u, v) {
    const a = u * Math.PI * 2;
    const h = 0.5 + 0.17 * Math.sin(a * 5) + 0.07 * Math.sin(a * 11 + 1.3) + 0.04 * Math.sin(a * 17 + 0.4);
    const up = 1 - v;
    const flame = 1 - smooth(h - 0.03, h + 0.03, up);
    const heart = 1 - smooth(h * 0.52 - 0.03, h * 0.52 + 0.03, up);
    return [1 - flame, flame * (1 - heart), heart];
  },
  // Crown: a green crown with blue gems on a red Orb, a blue cap on top
  skin26(u, v) {
    const spikes = 7;
    const s = Math.abs(fract(u * spikes) - 0.5) * 2; // 0 at a spike's tip, 1 between two
    const top = 0.2 + 0.32 * s;
    const crown = smooth(top - 0.02, top + 0.02, v) * (1 - smooth(0.6, 0.64, v));
    const band = smooth(0.68, 0.71, v) * (1 - smooth(0.76, 0.79, v));
    // The gems: one under each tip, and a small one on each tip
    const gx = (fract(u * spikes) - 0.5) / spikes;
    const gem = Math.max(
      1 - smooth(0.05, 0.06, Math.hypot(gx * 2.2, v - 0.48)),
      1 - smooth(0.022, 0.032, Math.hypot(gx * 2.2, v - 0.25)) * 1,
    );
    const cap = 1 - smooth(0.08, 0.11, v);
    const blue = Math.max(cap, crown * gem);
    const green = Math.max(crown, band) * (1 - blue);
    return [Math.max(0, 1 - green - blue), green, blue];
  },
  // The 8 ball: a body in colour 1, a round patch in colour 2 with an 8 in colour 3 (black, white, black for the real one)
  skin27(u, v) {
    // Where the patch's centre sits (found by looking at the Orb at rest, frontFor's FRONT: it shows on the front, a
    // little low, under a crown); the point seen from above its centre (an orthographic view of the sphere there), so
    // the patch and the 8 stay round wherever they are
    const lon = (u - 0.46) * Math.PI * 2;
    const lat = (v - 0.5) * Math.PI;
    const lat0 = 0.75;
    const cosC = Math.sin(lat0) * Math.sin(lat) + Math.cos(lat0) * Math.cos(lat) * Math.cos(lon);
    const x = Math.cos(lat) * Math.sin(lon);
    const y = Math.cos(lat0) * Math.sin(lat) - Math.sin(lat0) * Math.cos(lat) * Math.cos(lon);
    const d = cosC > 0 ? Math.hypot(x, y) : 9;
    const patch = 1 - smooth(0.39, 0.41, d);
    // The 8: two rings, the top one smaller
    const ring = (cy, r) => 1 - smooth(0.028, 0.04, Math.abs(Math.hypot(x, y - cy) - r));
    const eight = patch * Math.max(ring(-0.095, 0.085), ring(0.1, 0.105));
    return [1 - patch, patch * (1 - eight), eight];
  },
  // Camo (the site's icon, 30/10/2026): woodland blobs in colour 2 and black on colour 1, a bandana in colour 3 with a
  // black edge, tied on the side with two tails (olive, dark green and red for the icon's look)
  skin28(u, v) {
    const p = dirOf(u, v);
    // Blobs: noise warped by noise, so they come out long and ragged, not round
    const warp = [fbm(p, 1.1, 3.1), fbm(p, 1.1, 7.9), fbm(p, 1.1, 12.4)];
    const q = p.map((x, i) => x + warp[i] * 0.55);
    const dark = smooth(-0.015, 0.015, fbm(q, 1.9, 21.7) - 0.01);
    const black = smooth(-0.015, 0.015, fbm2(q, 2.1, 33.3) - 0.25);
    let r = (1 - black) * (1 - dark);
    let g = (1 - black) * dark;
    // The bandana: the band between BAND's angles from the top, and the knot with its tails, seen from above the knot
    const a = Math.acos(Math.max(-1, Math.min(1, dot(p, UP))));
    const band = (grow) => smooth(BAND[0] - grow - 0.012, BAND[0] - grow + 0.012, a) * (1 - smooth(BAND[1] + grow - 0.012, BAND[1] + grow + 0.012, a));
    let tie = () => 0;
    if (dot(p, KNOT_AT) > 0) {
      const x = dot(p, KNOT_ACROSS);
      const y = dot(p, KNOT_DOWN);
      const ellipse = (cx, cy, ax, ay, turn, grow) => {
        const c = Math.cos(turn);
        const s = Math.sin(turn);
        const dx = x - cx;
        const dy = y - cy;
        return 1 - smooth(0.93, 1.07, Math.hypot((dx * c + dy * s) / (ax + grow), (-dx * s + dy * c) / (ay + grow)));
      };
      tie = (grow) =>
        Math.max(ellipse(0, 0, 0.085, 0.095, 0, grow), ellipse(-0.09, 0.24, 0.06, 0.17, 0.38, grow), ellipse(0.085, 0.23, 0.055, 0.16, -0.3, grow));
    }
    const edge = Math.max(band(0.03), tie(0.025));
    const cloth = Math.max(band(0), tie(0));
    r *= (1 - edge) * (1 - cloth);
    g *= (1 - edge) * (1 - cloth);
    return [r, g, cloth];
  },
};

/** The robot's face: where the Orb at rest faces the viewer (orbStudio's FRONT), upright. */
const ROBOT_C = dirOf(0.42, 0.703);
const ROBOT_UP = norm(UP.map((x, i) => x - ROBOT_C[i] * dot(UP, ROBOT_C)));
const ROBOT_RIGHT = cross(ROBOT_UP, ROBOT_C);

/**
 * Draws kept for later, not in the game (Erick, 31/10/2026, choosing the star for Style 4: "guarda a de vôlei"; and the
 * grille band for Style 8: "guarda a B", the robot). `--drafts` writes each one to shots/drafts/<name>.tga (256x128):
 * copy it over a skin to try it.
 */
const DRAFTS = {
  // A volleyball: the sphere split into the six faces of a cube, three strips on each, the neighbours' strips across
  // theirs (the strips of the face around axis k run along axis (k + 2) % 3); the outer strips in colour 1, the middle
  // ones in colour 2, the seams in colour 3
  volleyball(u, v) {
    const p = dirOf(u, v);
    const a = p.map(Math.abs);
    const k = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
    const m = (k + 2) % 3;
    // The face's edges (the planes |p_k| = |p_j|) and the strips' borders (p_m = ±tan 15° |p_k|)
    let edge = Infinity;
    for (const j of [0, 1, 2]) if (j !== k) edge = Math.min(edge, Math.asin((a[k] - a[j]) / Math.SQRT2));
    const c = p[m];
    const border = Math.min(Math.abs(c - T15 * a[k]), Math.abs(c + T15 * a[k])) / Math.sqrt(1 + T15 * T15);
    if (edge < VOLLEY_SEAM || Math.asin(Math.min(1, border)) < VOLLEY_SEAM) return [0, 0, 1];
    return Math.abs(c) < T15 * a[k] ? [0, 1, 0] : [1, 0, 0];
  },
  // A robot's head: a visor (colour 3) with two eyes (colour 1) and a mouth grille at the front, a bolt on each side, a
  // seam over the back and a panel with three vents there; the head in colour 2
  robot(u, v) {
    const p = dirOf(u, v);
    const z = dot(p, ROBOT_C);
    const x = dot(p, ROBOT_RIGHT);
    const y = dot(p, ROBOT_UP);
    for (const s of [1, -1]) {
      const d = Math.acos(Math.min(1, s * x));
      if (d < 0.1) return [1, 0, 0];
      if (d < 0.2) return [0, 0, 1];
      if (d < 0.24) return [1, 0, 0];
    }
    if (z < -0.3 && roundRect(-x, y + 0.05, { w: 0.3, h: 0.24, r: 0.07 }) < 0) {
      for (const vy of [0.1, -0.05, -0.2]) if (roundRect(-x, y - vy, { w: 0.22, h: 0.035, r: 0.035 }) < 0) return [0, 0, 1];
      return [1, 0, 0];
    }
    if (z > 0.15) {
      const visor = roundRect(x, y - 0.2, { w: 0.6, h: 0.2, r: 0.14 });
      if (visor < 0) {
        for (const s of [1, -1]) if (Math.hypot(x - s * 0.27, y - 0.2) < 0.1) return [1, 0, 0];
        return [0, 0, 1];
      }
      if (visor < 0.04) return [1, 0, 0];
      if (roundRect(x, y + 0.33, { w: 0.34, h: 0.12, r: 0.06 }) < 0) {
        const slot = Math.abs(((x + 0.34) % 0.136) - 0.068);
        return slot < 0.026 && Math.abs(y + 0.33) < 0.075 && Math.abs(x) < 0.3 ? [0, 0, 1] : [1, 0, 0];
      }
    }
    if (z < -0.05 && Math.abs(y) < 0.025) return [0, 0, 1];
    return [0, 1, 0];
  },
};

function render(fn, W, H) {
  const px = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [cr, cg, cb] = fn((x + (sx + 0.5) / SS) / W, (y + (sy + 0.5) / SS) / H);
          r += cr;
          g += cg;
          b += cb;
        }
      }
      // A texel is black or in the colours, never between: the game takes the colours' shares out of their sum
      // (only all three 0 is black), so a half-black texel would come out in full colour
      const sum = r + g + b;
      px.set(sum < (SS * SS) / 2 ? [0, 0, 0] : [r / sum, g / sum, b / sum], (y * W + x) * 3);
    }
  }
  return px;
}

/** An uncompressed 24-bit TGA, rows from the bottom up (as the game's skins are). */
function tga(px, W, H) {
  const out = Buffer.alloc(18 + W * H * 3);
  out[2] = 2;
  out.writeUInt16LE(W, 12);
  out.writeUInt16LE(H, 14);
  out[16] = 24;
  let o = 18;
  for (let y = H - 1; y >= 0; y--) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const byte = (c) => Math.round(Math.min(1, Math.max(0, c)) * 255);
      out[o++] = byte(px[i + 2]);
      out[o++] = byte(px[i + 1]);
      out[o++] = byte(px[i]);
    }
  }
  return out;
}

const preview = process.argv.includes('--preview');
const rendered = [];
for (const [name, fn] of Object.entries(SKINS)) {
  const [w, h] = SIZES[name] ?? [W, H];
  const px = render(fn, w, h);
  writeFileSync(`public/assets/skins/${name}.tga`, tga(px, w, h));
  // (the preview shows the 64x32 ones)
  if (w === W) rendered.push(px);
  else if (preview) {
    // The big ones on their own, twice as big, in the colours of the icon's look (olive, dark green, red)
    const k = 2;
    const cols = [
      [0.55, 0.6, 0.27],
      [0.2, 0.3, 0.12],
      [0.85, 0.12, 0.1],
    ];
    const img = Buffer.alloc(w * k * h * k * 3);
    for (let y = 0; y < h * k; y++) {
      for (let x = 0; x < w * k; x++) {
        const i = (Math.floor(y / k) * w + Math.floor(x / k)) * 3;
        for (let c = 0; c < 3; c++) img[(y * w * k + x) * 3 + c] = Math.round(255 * (px[i] * cols[0][c] + px[i + 1] * cols[1][c] + px[i + 2] * cols[2][c]));
      }
    }
    mkdirSync('shots', { recursive: true });
    writeFileSync(`shots/${name}.ppm`, Buffer.concat([Buffer.from(`P6 ${w * k} ${h * k} 255\n`), img]));
    console.log(`shots/${name}.ppm`);
  }
  console.log(`public/assets/skins/${name}.tga`);
}
if (process.argv.includes('--drafts')) {
  mkdirSync('shots/drafts', { recursive: true });
  for (const [name, fn] of Object.entries(DRAFTS)) {
    writeFileSync(`shots/drafts/${name}.tga`, tga(render(fn, 256, 128), 256, 128));
    console.log(`shots/drafts/${name}.tga`);
  }
}
if (preview) {
  // One image with the skins one under the other, 8 times bigger
  const k = 8;
  const pw = W * k;
  const ph = (H * k + 8) * rendered.length;
  const img = Buffer.alloc(pw * ph * 3, 40);
  rendered.forEach((px, n) => {
    for (let y = 0; y < H * k; y++) {
      for (let x = 0; x < pw; x++) {
        const i = (Math.floor(y / k) * W + Math.floor(x / k)) * 3;
        const o = ((n * (H * k + 8) + y) * pw + x) * 3;
        for (let c = 0; c < 3; c++) img[o + c] = Math.round(px[i + c] * 255);
      }
    }
  });
  mkdirSync('shots', { recursive: true });
  writeFileSync('shots/exclusive-skins.ppm', Buffer.concat([Buffer.from(`P6 ${pw} ${ph} 255\n`), img]));
  console.log('shots/exclusive-skins.ppm');
}
