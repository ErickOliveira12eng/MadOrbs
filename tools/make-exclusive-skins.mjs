// Draws Mad Orbs' own Orb skins (skin24..skin26: Honeycomb, Flames, Royal; Royal was named Crown until 29/10/2026, when the
// crowns came, and left the game on 31/10/2026; skin27: the 8 ball, 29/10/2026; skin28: the camo, 30/10/2026), won at the
// waves' milestones (src/client/wavesProgress.ts); skin29: the skull, 31/10/2026, free; and the original game's styles
// redrawn, one by one (30 and 31/10/2026, Erick: drawn by hand at 64x32, they came out blurred or lumpy on the Orb; each
// one's comment in SKINS says what it was). Mad Orbs' own art, made here, not the original game's (the world map's
// coastlines are Natural Earth's, public domain). A skin is a 64x32 equirectangular texture (all but the honeycomb and the
// royal 256x128, for their detail: SIZES) whose red, green and blue say how much of each of the player's three colours
// goes on each texel, black where all three are 0 (src/client/render/baboRenderer.ts, Player::updateSkin).
//   node tools/make-exclusive-skins.mjs            -> public/assets/skins/<each skin in SKINS>.tga
//   node tools/make-exclusive-skins.mjs --preview  -> also shots/exclusive-skins.ppm (8x, to look at)
//   node tools/make-exclusive-skins.mjs --drafts   -> also shots/drafts/<name>.tga: the draws kept for later (DRAFTS)
import { mkdirSync, writeFileSync } from 'node:fs';

/** The original game's size (most are bigger: SIZES). */
const W = 64;
const H = 32;
const SIZES = { skin01: [256, 128], skin03: [256, 128], skin04: [256, 128], skin06: [256, 128], skin07: [256, 128], skin08: [256, 128], skin11: [256, 128], skin12: [256, 128], skin14: [256, 128], skin16: [256, 128], skin18: [256, 128], skin21: [256, 128], skin22: [256, 128], skin23: [256, 128], skin25: [256, 128], skin27: [256, 128], skin28: [256, 128], skin29: [256, 128] };
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
 * The Orb at rest as the start screen shows it (orbStudio's FRONT): the world's up falls on u 0.42, v 0.389 of the
 * texture, the viewer on u 0.42, v 0.703.
 */
const UP = dirOf(0.42, 0.389);
const VIEW = norm(dirOf(0.42, 0.703).map((x, i) => x - UP[i] * dot(dirOf(0.42, 0.703), UP)));

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

// ------------------------------------------------------------------ for the faces
/**
 * The faces (skin18) keep the original's drawing: a sad face at the front and a happy one at the back, each a disc in
 * colour 2 on colour 1 with eyes and a mouth in colour 3. The discs are true circles on the Orb (the original drew circles
 * on the texture, which the sphere bends out of round); the eyes and mouths keep the 64x32 grid's measures (x = 64u,
 * y = 32v, from the face's centre), near the middle, where the texture barely bends.
 */
const FACES = [
  { c: dirOf(0.5, 0.5), x: 32, smile: false },
  { c: dirOf(0, 0.5), x: 0, smile: true },
];
/** The discs' radius and their thin edge in colour 3, in radians of the Orb. */
const FACE_RADIUS = 1.2;
const FACE_EDGE = 0.03;
/** The mouths: arcs of a circle (its centre below the middle, its radius, how far to each side) 1.9 texels thick. */
const SMILE = { cy: 0.46, r: 6.54, reach: 5.5 };
const FROWN = { cy: 13.47, r: 9.67, reach: 7 };
const MOUTH_HALF = 0.95;
/** The distance from (x, y) to a mouth's arc, round at its ends. */
function mouthDist(x, y, { cy, r, reach }, down) {
  const dy = (y - cy) * (down ? 1 : -1);
  const a = Math.asin(reach / r);
  if (dy > 0 && Math.abs(Math.atan2(x, dy)) <= a) return Math.abs(Math.hypot(x, dy) - r);
  return Math.hypot(Math.abs(x) - r * Math.sin(a), dy - r * Math.cos(a));
}

// ------------------------------------------------------------------ for the waves
/**
 * The waves (skin22) keep the original's drawing, measured on its 64x32 grid: stripes 8 rows apart that rise and fall
 * 5.5 rows twice around the Orb; across a stripe, colour 1, then colour 2, then a thin line of colour 3 (the original
 * blurred them into each other, in these shares). Near the poles the waves flatten into rings (`w`): the texture
 * pinched them into swirls there.
 */
const WAVE_BAND = 1.78;
const WAVE_LINE = 3.47;

// ------------------------------------------------------------------ for the designs seen face on
/** Where the Orb at rest faces the viewer (orbStudio's FRONT), upright: x to the right, y up, z towards the viewer. */
const FRONT = dirOf(0.42, 0.703);
const FRONT_UP = norm(UP.map((x, i) => x - FRONT[i] * dot(UP, FRONT)));
const FRONT_RIGHT = cross(FRONT_UP, FRONT);

// ------------------------------------------------------------------ for the basketball
/**
 * The basketball (skin11) keeps the original's idea, drawn as a real ball: the seams (colour 3) are two great circles
 * and a curve around each of the ball's poles; the caps inside the curves in colour 2, the rest in colour 1 (the
 * original blurred them, and on the still Orb the caps read as stripes, too close to Style 2's). Turned to the classic
 * ball (🏀): both great circles cross where the Orb at rest faces the viewer, one upright and one level, the ball's poles
 * to the left and the right, so a curve on each side.
 */
const BALL_POLE = FRONT_RIGHT;
const BALL_SIDE = cross(BALL_POLE, FRONT);
/** The seams' half width, in radians of the Orb. */
const BALL_SEAM = 0.03;
/** The curve's angle from the ball's pole, at the angle `f` around it (0 towards the viewer): 21° to 69°. */
const ballCurve = (f) => (45 + 24 * Math.cos(2 * f)) * (Math.PI / 180);
const BALL_CURVE = Array.from({ length: 1600 }, (_, i) => {
  const f = (i / 1600) * Math.PI * 2;
  const t = ballCurve(f);
  return [Math.sin(t) * Math.cos(f), Math.sin(t) * Math.sin(f), Math.cos(t)];
});
/** The angle from `q` (in the ball's frame) to the curve: every 16th point first, then the ones around the best of them. */
function ballCurveDist(q) {
  let best = -2;
  let at = 0;
  for (let i = 0; i < BALL_CURVE.length; i += 16) {
    const d = dot(q, BALL_CURVE[i]);
    if (d > best) [best, at] = [d, i];
  }
  for (let i = at - 16; i <= at + 16; i++) best = Math.max(best, dot(q, BALL_CURVE[(i + BALL_CURVE.length) % BALL_CURVE.length]));
  return Math.acos(Math.min(1, best));
}

// ------------------------------------------------------------------ for the yin-yang
/**
 * The yin-yang (skin23) keeps the original's idea, drawn true, in colours 1 and 3 (the original wrapped it around the
 * Orb, blurred, and left colour 2 unused, as this one does). Face on (theta the angle from the front, phi around it from
 * the right) the symbol's S is the curve phi = theta: r = sin(theta) = sin(phi) is the small circle. The curve goes on
 * turning to the back (31/10/2026, Erick: "em um ponto fica certinho, em outros não"; it was the symbol mirrored at the
 * rim, with a corner at the top and the bottom), so the symbol shows whole from the front and from the back, and the line
 * runs smooth between. Seen from the exact side it is mostly one colour: there the view falls on one of the two halves.
 * The small circles' radius and the dots', in units of the Orb's radius.
 */
const YIN_HALF = 0.5;
const YIN_DOT = 0.13;

// ------------------------------------------------------------------ for the skull
/**
 * The skull (skin29, Mad Orbs' own, 31/10/2026: Erick took the yin-yang for Style 23 and wanted the skull offered with it
 * as a new style): a skull face on and crossed bones on the far side, in colour 2 with an edge and holes in colour 3, on
 * colour 1. In units of the Orb's radius.
 */
const SKULL_EDGE = 0.035;
const SKULL_NOSE = [[-0.06, -0.07], [0.06, -0.07], [0, -0.19]];
const capsule = (x, y, ax, ay, bx, by, r) => segDist(x, y, ax, ay, bx, by) - r;
/** Signed distance to the skull's outline (negative inside): the head and the jaw under it. */
const skullDist = (x, y) => Math.min(Math.hypot(x, y - 0.12) - 0.46, roundRect(x, y + 0.3, { w: 0.27, h: 0.16, r: 0.08 }));
/** Signed distance to the crossed bones: two bars corner to corner, with two knobs across each end. */
function bonesDist(x, y) {
  let d = Infinity;
  for (const s of [1, -1]) {
    const ax = -0.42 * s;
    const ay = -0.42;
    const bx = 0.42 * s;
    const by = 0.42;
    d = Math.min(d, capsule(x, y, ax, ay, bx, by, 0.065));
    const nx = 0.07 / Math.SQRT2;
    for (const [ex, ey] of [[ax, ay], [bx, by]]) {
      d = Math.min(d, Math.hypot(x - ex - nx, y - ey + nx * s) - 0.1, Math.hypot(x - ex + nx, y - ey - nx * s) - 0.1);
    }
  }
  return d;
}

// ------------------------------------------------------------------ for the beach ball
/**
 * The beach ball (skin12) keeps the original's drawing, sharp: six gores, in colour 1, colours 2 and 3 half and half,
 * colour 3, colours 1 and 2, colour 2, colours 1 and 3; a cap in colour 1 on each pole, BEACH_CAP radians wide.
 */
const BEACH_GORES = [[1, 0, 0], [0, 0.5, 0.5], [0, 0, 1], [0.5, 0.5, 0], [0, 1, 0], [0.5, 0, 0.5]];
const BEACH_CAP = Math.PI / 16;

// ------------------------------------------------------------------ for the eye
/**
 * The eye (skin14, also every boss's) keeps the original's drawing, sharp: the pupil at the +z pole in black, the iris
 * around it in colour 3 with a ring of colour 1 in its middle and fibres across it, the white in colour 1 with veins (colours
 * 1 and 2 blended) running away from the iris, thinner towards it and gone before the back. The pupil's and the iris's
 * radius, in radians of the Orb.
 */
const EYE_PUPIL = 0.2;
const EYE_IRIS = 0.98;

// ------------------------------------------------------------------ for the letters
/** An arc of an ellipse as a polyline: centre, radii, from angle a0 to a1 (degrees, counterclockwise when a1 > a0). */
const arc = (cx, cy, rx, ry, a0, a1, n = 24) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });
/** The letters Mad Orbs needs: polylines in a box `w` wide and 1 high, y up. */
const GLYPHS = {
  M: { w: 0.86, lines: [[[0, 0], [0, 1], [0.43, 0.4], [0.86, 1], [0.86, 0]]] },
  A: { w: 0.8, lines: [[[0, 0], [0.4, 1], [0.8, 0]], [[0.17, 0.33], [0.63, 0.33]]] },
  D: { w: 0.74, lines: [[[0, 0], [0, 1], [0.26, 1], ...arc(0.26, 0.5, 0.48, 0.5, 90, -90).slice(1), [0, 0]]] },
  ' ': { w: 0.3, lines: [] },
  O: { w: 0.82, lines: [arc(0.41, 0.5, 0.41, 0.5, 0, 360, 48)] },
  R: { w: 0.74, lines: [[[0, 0], [0, 1], [0.4, 1], ...arc(0.4, 0.755, 0.3, 0.245, 90, -90).slice(1), [0, 0.51]], [[0.34, 0.51], [0.74, 0]]] },
  B: {
    w: 0.74,
    lines: [
      [[0, 0], [0, 1], [0.38, 1], ...arc(0.38, 0.765, 0.3, 0.235, 90, -90).slice(1), [0, 0.53]],
      [[0, 0.53], [0.42, 0.53], ...arc(0.42, 0.265, 0.32, 0.265, 90, -90).slice(1), [0, 0]],
    ],
  },
  S: { w: 0.72, lines: [[...arc(0.36, 0.75, 0.34, 0.25, 30, 270), ...arc(0.36, 0.25, 0.36, 0.25, 90, -150).slice(1)]] },
};
/** The strokes' half width and the gap between letters, in units of the letters' height. */
const TEXT_HALF = 0.12;
const TEXT_GAP = 0.2;
/** Signed distance from (x, y) to the text, centred on 0 (x from its middle, y from its middle line), in its height's units. */
function textDist(text, x, y) {
  const total = [...text].reduce((s, ch, i) => s + GLYPHS[ch].w + (i ? TEXT_GAP : 0), 0);
  let at = -total / 2;
  let d = Infinity;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (x > at - 0.4 && x < at + g.w + 0.4) {
      for (const line of g.lines) {
        for (let i = 1; i < line.length; i++) d = Math.min(d, segDist(x - at, y + 0.5, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]));
      }
    }
    at += g.w + TEXT_GAP;
  }
  return d - TEXT_HALF;
}
/**
 * Mad Orbs (skin16): the letters' height (radians of the Orb), and the rings around each pole of its line of text (the
 * original's rings by the texture's poles), 0.55 radians from it.
 */
const MAD_EM = 0.33;
const MAD_RINGS = [1, -1].flatMap((s) =>
  [0, 1, 2, 3].map((k) => {
    const a = (Math.PI / 2) * k + Math.PI / 4;
    return norm(FRONT_UP.map((x, i) => x * s * Math.cos(0.55) + (FRONT[i] * Math.cos(a) + FRONT_RIGHT[i] * Math.sin(a)) * Math.sin(0.55)));
  }),
);

// ------------------------------------------------------------------ for the flames
/** A repeatable random number in 0..1 for (i, k). */
const rand = (i, k) => fract(Math.sin(i * 127.1 + k * 311.7) * 43758.5453);
/** `n` flame tongues around the Orb: where each one stands, its height above `base`, its half width and its lean. */
function tongues(n, base, height, width, lean, seed) {
  return Array.from({ length: n }, (_, i) => ({
    at: (i + 0.5 + (rand(i, seed) - 0.5) * 0.5) / n,
    h: height * (0.7 + 0.5 * rand(i, seed + 1)),
    w: width * (0.8 + 0.4 * rand(i, seed + 2)),
    lean: lean * (rand(i, seed + 3) - 0.3),
    base,
  }));
}
/**
 * The flames (skin25, redrawn sharp on 31/10/2026: its soft waves came out blurred) keep the drawing: colour 2 flames
 * rising from below, smaller hearts of colour 3 inside, colour 1 above; the tongues now pointed, leaning a little.
 * Heights in the texture's v, from the bottom.
 */
const FLAMES = tongues(9, 0.36, 0.3, 0.07, 0.5, 1);
const HEARTS = tongues(9, 0.17, 0.17, 0.045, 0.5, 9);
/** Whether (u, `up` from the bottom) is inside the tongues: under their wavy base or under one of them. */
function inTongues(set, u, up) {
  if (up < set[0].base + 0.02 * Math.sin(u * Math.PI * 2 * 4)) return true;
  for (const f of set) {
    const du = fract(u - f.at + 0.5) - 0.5 - f.lean * (up - f.base) * 0.4;
    const t = 1 - Math.abs(du) / f.w;
    if (t > 0 && up < f.base + f.h * t ** 1.8) return true;
  }
  return false;
}

// ------------------------------------------------------------------ for the world map
/**
 * The land (Natural Earth's 1:110m land, public domain, naturalearthdata.com), simplified to 0.4° and without the islands
 * under 1.5 square degrees: each ring a run of points, each point two base-36 pairs, (longitude + 180) × 2 and
 * (latitude + 90) × 2; the rings split by spaces, the lines broken anywhere.
 */
const LAND = `
6p0k6o0i6f0i6b0j6k0j6n0l 160l120l0x0n120n 7i0o7k0n7l0k770i700j760l7b0o 3a0x3f0x3c0w370x 4i104m104o0z4e0z4b10 671
26610620z5w0z5u11601261156316 6r1g6k1e6j1d6k1c6h1b6d186i166k136m0x6f0t630r5q0r5x0o5o0n5o0m5t0j6p0f6s0e780h7m0g7q
0h8f0j8d0l810l810o910u950v950w930w950y9f119l119m12a011af14aj14am12ar14bi13bs15bw17c514d11cdf18dk19du18dv16ds13du
13ds10dw0zdy10e414eb15ee17em1aeu1aew1cez1afc19fj1afq1dfw1agb1cgo19gu1bh61ahi1chi1dhn1ai31ai518ia17il17iz13jb12ji
11jf0xj80vj30sj30qj50oja0mj00miw0ijf0ck00bk0000000000b020c0b0b0k0c18091r09220a220b1h0d1i0g1a0i1n0h1v0j1p0l1d0m18
0o170q1l0p1w0r1w0t1y0u2i0v3d0v3o0x3r0v4f0t4g0u4b0w490z4n0x500x520z5h0w5j0y5u0w690z69116715691869196i1f6s1h6u1h 6
8206e1z6d1y6a1y661x5z1z5v2262206523 6r266s256s246n236m24 i32qi92qi82mi42li12q jm2qjo2pjl2ljm2kjj2kjh2gjf2fj92gja
2ijh2mjk2qjm2r jp30ju2wjx2xjw2uju2ujq2pjp2pjq2rjq2sjo2tjp2ujp2xjl33jp31 ja3sj73tj43w cs49ct45cr45cs42cm3mcj3lcg3
mcf3sch3wcg41ch44cl44cn47cq4c hz48i047i148i346i53yia3vib3rid3rie3pii3kij3gii39id31ic2xi52ui22vi22whz2uht2whr30ho
31ho33hm31ho36hk32hh37hb39h038gw36gv34go34gk32ge34gf35gf39gb3kgc3jgb3lgc3jgb3ngc3sgc3rgh3vgq3xgu43gv41gw42gv43gz
48h248h546h746h747h94bhd4chc4dhd4ehj4chl4chm4bhk49hj46hs41hu41hv46hw4ehx4fhy4e gx4ggv4ggw4hh34j g14mg64ngf4jgd4i
g14kfv4mfw4o ig4pic4ni94pic4qie4pif4sih4r hg4yhh4uhj4thl4vhp4xi14si44pi74oi84ni64ni64lid4fi84gi44ki14lhz4khz4ihx
4hhq4khn4jhp4lho4phf4the4shc4uhf4whc4wh94yhd4z gy53gv50go50go4zgq4xgv4zgr4wgu4pgs4pgt4rgr4rgq4vgp4ugp4pgn4pgn4tg
m4ugo51gq53gu52 h552h44yh354h454 fw4oft4ofp4sfh54fb5bff5afl54fn54fs50fr4zfw4u gk54gm52gk52gj4ygh4xgg4sg44ug44xg2
4zg253g354g654g755ga56gh5egm5bgj56 h15hh15eh05dh05fgz5egz5bgw5cgw5fgv5ggs5egv5hgw5ggz5igz5k ei5ceh5ceg5eeg5kek5f
 gw5lgu5igt5jgu5mgv5mgv5lgw5m gz5oh05mgy5ngz5lgy5kgx5ngy5ogx5p gr61gs61gt5ygr5wgr5tgw5sgw5pgu5rgp5sgq5tgo5ugo5xg
p5wgp61 5z64646367616361615z5z605w605v615z615x63 g561g161g163g664 5l6a5w655o645q655n675g685g695a685f6a gq6agp68g
o6bgr6fgs6e hh6whg6uhd6uhe6w av74au71ap73ap74 ai7aak79aj76ai76ag7a hu72ht6yhm6xhk6vhi6xha6whc6uhb6rh96qh86rh96th
76vhd6zhj6zhl73hn72hr74ht7ahv7bhw78 i07gi37hi37fi07ehy7chv7dhu7bhs7bhs7dht7fhv7fhw7j 357p317q2w7s2v7u307t 6w7t6u
7s6w7s6x7s6w7r717q707p727p737n727l707m707o6x7m6w7m6x7n6v7n6p7n6q7p6t7t6w7v6x7v 2n802p802o7y2q7w2m7z2m80 hz7ti17q
hy7rhx7ohz7khx7lhw7khv7zhx81 9m7x9g7w9i7y9h809n829p81 1i861g851f871j881k87 9u899s879w879u849w84a17ya37xa27wa37v9
q7s9o7s9t7v9p7w9s7x9r7z9u7z9u809q829q849p839o869q89 5a8n5k8j5i8j5e8k598i588j568j578k588n 978p978o998m8z8j8q8k8s8
l8o8m8s8n8n8n8s8p8v8n 5s8q5q8r5s8t5u8r 0a8p0b8p0b8q0g8q0k8o0f8n0e8l088n038n038o008o018n008m008u0a8q 4p8u4g8v4k8w
 4z8v4z8t528v548t538s558q598u598w5f8v5h8u5g8s5h8r5d8p588p558m508k4y8i4u8g4s8e4r8a4u8a4v864y875a835f825g7z5k7u5n7
x5k815r855p885n8a5p8c5o8h5w8h618e658e658a69886f8d6l866k856t816w7z6x7w6o7s6b7s627m677p6e7q6g7p6e7o6f7k6l7k6n7m6o7
k6d7f6c7f6c7h6f7j6a7i637e627d647b5x7a607a5w7a5u765t775u755s725r765r745q745r745t6z5h6r5k6i5j6e5h6g5e6m5c6o5a6n576
p526p516o526n506m4s6n4n6l4l6j4k694n634r604w614y634z665667566654615361535x525w5a5w5d5v5c5m5h5i5l5j5q5h5t5j5u5m5x5
m605p625o605n615i625k615m645n645o685l6e5k6f5l6k5l6j5l6j5k6m5j6n5h6q5g6u5c705c7558785377507b507b4y7c4z7i4x7j4v7s4
u7y4q814q834l824i7v4a7t407q3s7o3q7j3p7d3m7b3k7a3f70336w326r346u2y6t2w6q2v6j2u6k2r6j2q6e2q6e2o6h2n6e2l6d2i692h692
f6d2e6c2c66276823622262205u235t2b5w2e5t2f5v2g5v2k5y2j5z2n5x2o5x2l5v2m5y2t5x2y6137613e623h643w633z61415s475k4m5i4
o5h4r5k4v5i4w5i4y5k525m535q585o5h5l5i5j5g5k5f5i5e5i5g5d5h5a5k5a5j595k595m555r4y5s4r5w4n5v496145644567446a3x6f3x6
h3s6m3q6q3o6r3m6s3n6o3t6h3v6d3x6b3w6a3s6d3r6g3m6j3o6l3l6n3h6u3b6x3379347j337o367o377m367q2x7u2w7x2u7y2t7z2o832k8
82f88288b1u8e1s8d1s8c1l8a1l8d1n8f1g8b1h8a1g8817840u8119871a8a1089108b0w8c0s8f0v8i128k118l128m0u8l0o8n0v8p118o0q8
t0y8v108x1b8z2f8u2s8w2u8w2w8x308v338w338v398w3m8u3o8t3l8s3w8s3y8r408s3y8t408t448u4d8r4j8s4j8t4l8t4o8s4o8r4p8s4r8
s4s8u4n8w4n8y4q904u8z4x8w4v8v 3o923n913r923u913w92408z41903z9243924591478y4e8w4e8v4b8v4c8u4b8u448u3p8t3k8u3h8w3r
8x3g8x3f8y3k8z3d8z3g91 5r925l915i935o93 579258915a935f945j915j905o915w8z608z688w6a8u668t6k8q6g8m6b8p688p688n6d8l
6f8j6e8h668j6c8g628i5u8l5p8k5n8l5o8n5w8n5v8o5z8r5y8r5m8w5h8v538x518y538y508y509053935894 4f944l944k924n914n8z4h8
z4b914f914d93 hz92hs93hw94 4u924p904o934r944z94 3b8z368y3090349332953h943l933e91 id96ib95i496 4t964m964q97 i297i
196hq95hm97hq98 4j994l994k964b974b99 4098449843963p953s963h963l993y973v993x9a d78xcz8ycv8zcv90cx90cx92d193cz93d4
95d396de99ds9adu99d995d391d38z 4r9a4x9a52975i975k9654954v964u984s994m9a 3k9b3i9936983e9b fy9afy99g699gc98gc97g39
4ga94gb93gf94gu92gv93h293h592h691h590hb8yhd90hs8zhq91ht92ib90ii8yiu8yiw8xiv8viy8vjc8vjf8tji8ujg8vjh8wjx8vk08uk08
mjv8ljz8hjn8fjh8cje8dj98cj38cj088j287j284j084iz83j082ix81iw7yit7yis7wiq7uin83io86iq88it88j38ej58hj38hiw8div8gip8
fik8cim8aif8aif8bic8bhw8ahi81ho80hs80hv7yhv7wht7uhs7pho7lhi7fhf7ehd7fh378h376h772h66yh16xh071h272h073gx74gz77gx7
8gq76gs79gr7agk76gj75gm73gn72gq74gt73gt72gq71gm6ygo6xgs6rgr6pgs6ogr6kgl6dgg6ag667g565g465g467g167fw64fv62g25vg35
rg25nfu5hfu5kfr5lfp5ofm5pfm5rfk5rfi5ifk5ifl5ffq5bfs53fn56fk5dfh5hfh5gfi5nfe5yfb5vf85wf960f36af16af168eu67et64eq6
3ek5xeh5weg5leb5ge95ie35we167dx66du68dv6adr6cdp6fdf6ed76fd56id16hcv6kcs6oco6ocu6ecu6gcv6gcw6cd06cd56hd66cd96bdc6
9d864d762d35ycx5xcw5vcp5scf5pcd5yc667c56bbx6kby6nbw6jbt6obz6cbz6ac268c361c560c75wcf5pcd5nch5lcu5ocu5lcn58c94vc64
rc64nc74mc64jc94eca47c743by3wbz3pbt3lbs3ebk36bg34b934b332b134b039au3iat3sao40ao44ar4car4fao4qai4yak56aj57ah5aac5
9a95da45c9w599r5a9l599i5a9b5f965m935o935r915t935w94609268976h9h6o9h6t9m6w9o709w6ya371aj73ak71am72al6wau6tav6rb26
pb46qb46sb76ubm6qbq6rbs6qbw6qc06xc071bt70br71bn70bj71bh74bi76bg77bj79bm79bm7abq7abv7cc57ac97acb7ccb7dc17ic47kc37
lc67nby7lby7jc17jc17ibw7hbt7jbv7kbp7lbn7ibm7ibj7dbm7abh78bg7abe7abb79bd78bc78b979bc73ba74ba71b971b379b37baq7jap7
jap7gb178ay79ax78ay76aw74av74aw76av78ao7bal7eak7gai7had7ea67ea67ca27a9z77a0759w719r719p709n729i729i759h759i7a9h7
e9k7f9w7f9x7g9y7k9u7n9r7o9r7p9x7p9w7s9y7ra37sa37ua87va97yag7zai80ag83ah86al87al86am85aj83am80ap81as80az82b381b78
2b787b988bc86bd89bb89bb8abm8cbk8dba8cb78db68hb78ibf8mbc8ob88nb68mb78lb08hay8fb28cb08aay89aw84aq83al8bah89ab89aa8
gal8lau8sb28wba8wbd8ybk8ybr8xbo8wbq8vbs8wc98sca8qc88pbu8pby8oby8lc28kc18mc28mc78lc98mc88ncc8pcg8och8qcf8rcg8scf8
tcl8tcm8rcj8rcj8qcl8pcz8ud18ucz8sda8udc8tde8udc8vdd8wdt8sdu8tdq8vdp8ydu92e192e290e08ze28xe18ue38tdz8pe18oe68se58
te68ue38ve58xe28ze690e592e791e78ze98ye890eb91ej90eh91eh93eu94es95eu96fm99ft9bfw9bft9a 3w9b3p9b3t9c3w9c bd9cb59bb
79cb69dba9d 4o9c4k9c4j9e4p9d 4g9d4h9c469d489d459f fu9dfj9cfo9ffv9d b19fb79eb29day9aaw9aas9bat9bal9f bf9hbj9gba9f
az9h cu9hcn9gcl9gcm9hci9h fk9efa9ef29hfc9jfk9g 569f589f4y9c4u9d4s9e4u9f4n9g4r9i4v9j549h 679m6k9l699j6d9j629g5q9f
5t9e5s9e5t9d5k9a5o9a5j985199519a549a539c5a9b549d5a9f569h5g9h559h4x9k599l5e9l5l9m 8i9n8u9l899k8q9k8s9j8q9i949k9c9
j8w9g919g8x9e8x9b8z9a8t998w988x968v968x958t948v948u938p938r908m918s8z8s8x8p8x8l8z8m8y8j8w8r8w8h8t888s848p7s8n7q8
j7m8h7n8g7l8c7b8e758j708q728t758t768w718v6z8v6z8y758x6w8z6z916r976l986798619a6a9b5x9c6d9f6d9g689g6k9j6j9k729k779
l7j9j7e9k7e9l7l9m`;
const LAND_RINGS = LAND.replace(/\n/g, '')
  .trim()
  .split(' ')
  .map((r) => {
    const pts = [];
    for (let i = 0; i < r.length; i += 4) pts.push([parseInt(r.slice(i, i + 2), 36) / 2 - 180, parseInt(r.slice(i + 2, i + 4), 36) / 2 - 90]);
    return pts;
  });
/** The land drawn once on a grid of MAP_STEP degrees: 1 land, 2 ice (Greenland and Antarctica), 0 sea. */
const MAP_STEP = 0.25;
const MAP_W = 360 / MAP_STEP;
const MAP_H = 180 / MAP_STEP;
const LAND_MASK = (() => {
  const mask = new Uint8Array(MAP_W * MAP_H);
  for (const ring of LAND_RINGS) {
    const lons = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    const cx = (Math.min(...lons) + Math.max(...lons)) / 2;
    const cy = (Math.min(...lats) + Math.max(...lats)) / 2;
    const ice = cy < -60 || (cx > -75 && cx < -10 && cy > 58 && cy < 85);
    for (let row = 0; row < MAP_H; row++) {
      const lat = 90 - (row + 0.5) * MAP_STEP;
      const xs = [];
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x1, y1] = ring[j];
        const [x2, y2] = ring[i];
        if (y1 > lat !== y2 > lat) xs.push(x1 + ((lat - y1) * (x2 - x1)) / (y2 - y1));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] + 180) / MAP_STEP - 0.5));
        const c1 = Math.min(MAP_W - 1, Math.floor((xs[k + 1] + 180) / MAP_STEP - 0.5));
        for (let c = c0; c <= c1; c++) mask[row * MAP_W + c] = ice ? 2 : 1;
      }
    }
  }
  return mask;
})();
/** The globe's north is the Orb at rest's up, and this longitude faces the viewer (the Americas). */
const MAP_FRONT = -55;

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
  // The world map (31/10/2026, Erick: Style 6 a world map; it was a cow print redrawn the same day, kept in DRAFTS, and the
  // original's blurred blobs before): the sea in colour 2, the land in colour 1, the ice (Greenland, Antarctica, the
  // Arctic's) in colour 3; north up and the Americas to the front on the Orb at rest
  skin06(u, v) {
    const p = dirOf(u, v);
    const lat = (Math.asin(Math.max(-1, Math.min(1, dot(p, FRONT_UP)))) * 180) / Math.PI;
    const lon = MAP_FRONT + (Math.atan2(dot(p, FRONT_RIGHT), dot(p, FRONT)) * 180) / Math.PI;
    const row = Math.min(MAP_H - 1, Math.max(0, Math.floor((90 - lat) / MAP_STEP)));
    const col = ((Math.floor((lon + 180) / MAP_STEP) % MAP_W) + MAP_W) % MAP_W;
    const m = LAND_MASK[row * MAP_W + col];
    if (m === 2) return [0, 0, 1];
    if (m === 1) return [1, 0, 0];
    if (lat > 79 + 3 * noise(p[0] * 4, p[1] * 4, p[2] * 4)) return [0, 0, 1];
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
  // The basketball (the original game's skin11 redrawn, 31/10/2026: blurred, its caps read as stripes): the seams in
  // colour 3, the caps in colour 2, the rest in colour 1
  skin11(u, v) {
    const p = dirOf(u, v);
    // In the ball's own frame: x towards the viewer, z its pole
    const q = [dot(p, FRONT), dot(p, BALL_SIDE), dot(p, BALL_POLE)];
    if (Math.abs(Math.asin(q[2])) < BALL_SEAM || Math.abs(Math.asin(q[1])) < BALL_SEAM) return [0, 0, 1];
    // Each half has its curve around its pole
    q[2] = Math.abs(q[2]);
    if (ballCurveDist(q) < BALL_SEAM) return [0, 0, 1];
    return Math.acos(q[2]) < ballCurve(Math.atan2(q[1], q[0])) ? [0, 1, 0] : [1, 0, 0];
  },
  // The beach ball (the original game's skin12 redrawn, 31/10/2026, the same drawing, sharp)
  skin12(u, v) {
    if (Math.abs(dirOf(u, v)[2]) > Math.cos(BEACH_CAP)) return [1, 0, 0];
    return BEACH_GORES[Math.floor(fract(u) * 6)];
  },
  // The eye (the original game's skin14 redrawn, 31/10/2026, the same drawing, sharp: its pupil and iris were blocky
  // rings, its veins smudges)
  skin14(u, v) {
    const p = dirOf(u, v);
    const t = Math.acos(Math.max(-1, Math.min(1, p[2])));
    if (t < EYE_PUPIL) return [0, 0, 0];
    const phi = Math.atan2(p[1], p[0]);
    if (t < EYE_IRIS) {
      const k = (t - EYE_PUPIL) / (EYE_IRIS - EYE_PUPIL);
      // The ring, the fibres (noise fast around the pupil, slow away from it), dark at the pupil's edge and at the rim
      const ring = 0.42 * Math.exp(-(((k - 0.55) / 0.2) ** 2));
      const fibre = noise(Math.cos(phi) * 9, Math.sin(phi) * 9, k * 1.6) * 0.9 + noise(Math.cos(phi) * 23, Math.sin(phi) * 23, k * 2.5 + 7) * 0.5;
      let light = ring + Math.max(0, fibre) * 0.45 * smooth(0.05, 0.25, k);
      light *= 1 - smooth(0.82, 0.88, k);
      light = Math.max(0, Math.min(0.6, light));
      return [light, 0, 1 - light];
    }
    // The veins: where a noise crosses 0 (fast around the eye, slow along it, bent by another), thicker away from the
    // iris (`reach`), here and there (`some`); the big ones and thinner branches
    const reach = smooth(EYE_IRIS + 0.05, EYE_IRIS + 1, t) * (1 - smooth(2.35, 2.75, t));
    const vein = (k, freq, width, o) => {
      const w = noise(Math.cos(phi) * 2 + o, Math.sin(phi) * 2, t * 1.4) * 0.35;
      const line = Math.abs(noise(Math.cos(phi + w) * freq, Math.sin(phi + w) * freq, t * 1.1 + o));
      const some = smooth(-0.05, 0.2, noise(Math.cos(phi) * 2.5 + o * 3, Math.sin(phi) * 2.5, t * 1.6 + 5));
      return line < width * reach ** k * some;
    };
    if (vein(1, 4.5, 0.075, 11) || vein(2, 9, 0.06, 29)) {
      const deep = 0.35 + 0.3 * reach;
      return [1 - deep, deep, 0];
    }
    return [1, 0, 0];
  },
  // Mad Orbs (the original game's skin16, its "RndLabs" made "MAD ORBS"; redrawn 31/10/2026, Erick: the letters were too
  // big to read): "MAD ORBS" in colour 3 on colour 1 around the middle, short enough to read whole from the front, and
  // again on the far side, turned half a turn around the right (the pedestal rolls the Orb that way, so it comes up
  // reading); four rings of colour 2 around each pole
  skin16(u, v) {
    const p = dirOf(u, v);
    for (const c of MAD_RINGS) if (Math.abs(Math.acos(Math.min(1, dot(p, c))) - 0.2) < 0.045) return [0, 1, 0];
    const z = dot(p, FRONT);
    const s = z >= 0 ? 1 : -1;
    const lat = Math.asin(Math.max(-1, Math.min(1, dot(p, FRONT_UP) * s)));
    const lon = Math.atan2(dot(p, FRONT_RIGHT), z * s);
    return textDist('MAD ORBS', lon / MAD_EM, lat / MAD_EM) < 0 ? [0, 0, 1] : [1, 0, 0];
  },
  // The faces (the original game's skin18 redrawn, 31/10/2026, the same drawing: its discs weren't round on the Orb)
  skin18(u, v) {
    const p = dirOf(u, v);
    for (const f of FACES) {
      const d = Math.acos(Math.min(1, dot(p, f.c)));
      if (d > FACE_RADIUS) continue;
      if (d > FACE_RADIUS - FACE_EDGE) return [0, 0, 1];
      const x = ((((u * 64 - f.x) % 64) + 96) % 64) - 32;
      const y = v * 32 - 16;
      // The eyes: 3 by 4 texels, 3.5 to each side and 3 above the middle
      if (inBox(Math.abs(x), y, 3.5, -3, 1.5, 2, 1)) return [0, 0, 1];
      if (mouthDist(x, y, f.smile ? SMILE : FROWN, f.smile) < MOUTH_HALF) return [0, 0, 1];
      return [0, 1, 0];
    }
    return [1, 0, 0];
  },
  // The bars (the original game's skin21 redrawn, 31/10/2026, the same drawing, sharp: measured on its 64x32 grid): eight
  // bars in colour 3 around the middle on colour 2, and near each pole a double ring in colour 1
  skin21(u, v) {
    const x = u * 64;
    const y = v * 32;
    const fy = Math.abs(y - 16);
    if (fy > 10 && fy < 13) return Math.abs(fy - 11.5) < 0.4 ? [0, 1, 0] : [1, 0, 0];
    const bx = ((((x - 3.5) % 8) + 12) % 8) - 4;
    return inBox(bx, y, 0, 16, 2, 8.42, 1) ? [0, 0, 1] : [0, 1, 0];
  },
  // The waves (the original game's skin22 redrawn, 31/10/2026, the same drawing, sharp)
  skin22(u, v) {
    const x = u * 64;
    const y = v * 32;
    const w = Math.sin(Math.PI * v);
    const centre = 11 - 5.5 * Math.cos((2 * Math.PI * (x - 8)) / 32) * w;
    const d = Math.abs(((((y - centre) % 8) + 12) % 8) - 4);
    if (d < WAVE_BAND) return [1, 0, 0];
    if (d > WAVE_LINE) return [0, 0, 1];
    return [0, 1, 0];
  },
  // The yin-yang (the original game's skin23 redrawn, 31/10/2026: wrapped around the Orb and blurred, it didn't read):
  // the symbol face on and on the back, in colours 1 and 3
  skin23(u, v) {
    const p = dirOf(u, v);
    const x = dot(p, FRONT_RIGHT);
    const y = dot(p, FRONT_UP);
    const z = dot(p, FRONT);
    // The dots: the back's are the front's turned half a turn around the right
    const s = z >= 0 ? 1 : -1;
    if (Math.hypot(x, y - YIN_HALF * s) < YIN_DOT) return [0, 0, 1];
    if (Math.hypot(x, y + YIN_HALF * s) < YIN_DOT) return [1, 0, 0];
    const theta = Math.acos(Math.max(-1, Math.min(1, z)));
    const d = (((Math.atan2(y, x) - theta) % (2 * Math.PI)) + 4 * Math.PI) % (2 * Math.PI);
    return d < Math.PI ? [1, 0, 0] : [0, 0, 1];
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
  // Flames: colour 1 above, colour 2 flames rising from below with hearts of colour 3 (redrawn sharp, 31/10/2026)
  skin25(u, v) {
    const up = 1 - v;
    if (inTongues(HEARTS, u, up)) return [0, 0, 1];
    if (inTongues(FLAMES, u, up)) return [0, 1, 0];
    return [1, 0, 0];
  },
  // Royal (Crown until 29/10/2026): a green crown with blue gems on a red Orb, a blue cap on top. Out of the game since
  // 31/10/2026 (Erick: "pode remover"; RETIRED_SKINS): kept so its texture stays as it is
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
  // Camo (30/10/2026): woodland blobs in colours 1, 2 and 3 (the third was black, and colour 3 a bandana tied on the side
  // until 31/10/2026, when Erick took it off)
  skin28(u, v) {
    const p = dirOf(u, v);
    // Blobs: noise warped by noise, so they come out long and ragged, not round
    const warp = [fbm(p, 1.1, 3.1), fbm(p, 1.1, 7.9), fbm(p, 1.1, 12.4)];
    const q = p.map((x, i) => x + warp[i] * 0.55);
    const dark = smooth(-0.015, 0.015, fbm(q, 1.9, 21.7) - 0.01);
    const third = smooth(-0.015, 0.015, fbm2(q, 2.1, 33.3) - 0.25);
    return [(1 - third) * (1 - dark), (1 - third) * dark, third];
  },
  // The skull (31/10/2026, a free style): a skull at the front and crossed bones at the back, in colour 2 with an edge
  // and holes in colour 3, on colour 1
  skin29(u, v) {
    const p = dirOf(u, v);
    const x = dot(p, FRONT_RIGHT);
    const y = dot(p, FRONT_UP);
    if (dot(p, FRONT) > 0) {
      const d = skullDist(x, y);
      if (d > SKULL_EDGE) return [1, 0, 0];
      if (d > 0) return [0, 0, 1];
      // The eyes, the nose and the gaps between the teeth
      for (const s of [1, -1]) if (Math.hypot((x - s * 0.18) / 0.13, (y - 0.08) / 0.15) < 1) return [0, 0, 1];
      if (polygon(SKULL_NOSE, x, y).inside) return [0, 0, 1];
      if (y < -0.24 && y > -0.42 && Math.abs(x) < 0.2 && Math.abs(((x + 0.2) % 0.08) - 0.04) > 0.03) return [0, 0, 1];
      return [0, 1, 0];
    }
    // The bones, seen from behind
    const d = bonesDist(-x, y);
    if (d > SKULL_EDGE) return [1, 0, 0];
    if (d > 0) return [0, 0, 1];
    return [0, 1, 0];
  },
};

/**
 * Draws kept for later, not in the game (Erick, 31/10/2026, choosing the star for Style 4: "guarda a de vôlei"; and the
 * grille band for Style 8: "guarda a B", the robot). `--drafts` writes each one to shots/drafts/<name>.tga (256x128):
 * copy it over a skin to try it.
 */
const DRAFTS = {
  // The cow print (Style 6 for a few hours on 31/10/2026, then the world map: big blobs in colours 2 and 3 blurred at 64x32, colour 1
  // left out): big patches in colour 3 and smaller ones in colour 1 on colour 2, round-edged (two octaves of noise,
  // warped a little); with orange, white and black, a calico
  cow(u, v) {
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
    const z = dot(p, FRONT);
    const x = dot(p, FRONT_RIGHT);
    const y = dot(p, FRONT_UP);
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
