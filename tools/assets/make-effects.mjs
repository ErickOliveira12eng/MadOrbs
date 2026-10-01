// The effect and HUD textures (public/assets/textures/*.tga), drawn from scratch with the same
// size, channels and role as the original game's, so the effects code keeps working unchanged:
//  - white + alpha masks tinted by the particle colour: Smoke1, Smoke2 (trail strip, repeats along
//    its length), shotGlow, BaboHalo, snowflake, blood01..10, drip, glowTrail
//  - black + alpha: BaboShadow, ExplosionMark; red + alpha: screenHit
//  - opaque flame on black (additive): nuzzleFlash
//  - little pictures for the HUD: GrenadeIcon, molotovIcon, BlueFlag, RedFlag
// Usage: node tools/assets/make-effects.mjs [--preview]   (--preview also writes shots/effects/*.png)
import { Raster, circle, ellipse, fbm, line, path, polygon, rng, writePNG, writeTGA } from './lib.mjs';

const WHITE = [1, 1, 1];
const BLACK = [0, 0, 0];
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Pixel centre -> centred coordinates in [-0.5, 0.5]. */
const uv = (size, fn) => (x, y) => fn(x / size - 0.5, y / size - 0.5);
const mask = (size, color, alphaFn) => new Raster(size, size).shade(uv(size, (u, v) => [...color, clamp(alphaFn(u, v))]));

const TEX = {};

// ------------------------------------------------------------------ smoke and glows

TEX.Smoke1 = () => {
  const n = fbm(21, 0, 0, 4);
  return mask(128, WHITE, (u, v) => {
    const r = Math.hypot(u, v);
    const a = Math.atan2(v, u) + r * 7; // swirl
    const s = n(4 + Math.cos(a) * r * 6, 4 + Math.sin(a) * r * 6);
    return smooth(0.5, 0.12, r) * (0.25 + 0.95 * s) * 0.97;
  });
};

// Trail strip: fades across (x), repeats along (y)
TEX.Smoke2 = () => {
  const n = fbm(22, 0, 4, 4);
  return mask(128, WHITE, (u, v) => {
    const edge = smooth(0.5, 0.18, Math.abs(u));
    return edge * (0.3 + 0.85 * n(u * 3 + 10, (v + 0.5) * 4)) * 0.97;
  });
};

TEX.shotGlow = () => mask(32, WHITE, (u, v) => smooth(0.5, 0.04, Math.hypot(u, v)) ** 0.85);

TEX.BaboHalo = () =>
  mask(128, WHITE, (u, v) => {
    const r = Math.hypot(u, v);
    const core = smooth(0.36, 0.02, r) ** 0.75;
    const rim = Math.exp(-(((r - 0.41) / 0.022) ** 2));
    return core + rim * 0.95;
  });

TEX.glowTrail = () => mask(32, WHITE, (u) => Math.exp(-((u / 0.2) ** 2)));

TEX.drip = () => mask(16, WHITE, (u, v) => Math.exp(-(((Math.hypot(u, v) - 0.34) / 0.075) ** 2)));

TEX.snowflake = () => {
  const r = new Raster(16, 16).fill(WHITE, 0);
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI) / 3 + 0.3;
    const [dx, dy] = [Math.cos(a) * 6.2, Math.sin(a) * 6.2];
    r.draw(line(8 - dx, 8 - dy, 8 + dx, 8 + dy, 1.5), WHITE);
  }
  return r.draw(circle(8, 8, 2), WHITE);
};

TEX.BaboShadow = () => mask(32, BLACK, (u, v) => smooth(0.5, 0.05, Math.hypot(u, v)) ** 1.3);

TEX.screenHit = () =>
  new Raster(128, 128).shade(
    uv(128, (u, v) => {
      const d = (Math.abs(u * 2) ** 4 + Math.abs(v * 2) ** 4) ** 0.25;
      return [0.8, 0.04, 0.04, smooth(0.45, 1.02, d)];
    }),
  );

// ------------------------------------------------------------------ muzzle flash (additive, opaque)

TEX.nuzzleFlash = () => {
  const n = fbm(31, 0, 0, 3);
  // Tongues of flame rising from the base: [x, half width, height]
  const tongues = [[0, 0.2, 0.95], [-0.15, 0.13, 0.62], [0.16, 0.13, 0.7], [-0.06, 0.09, 0.82], [0.08, 0.08, 0.55]];
  return new Raster(32, 32).shade((x, y) => {
    const u = x / 32 - 0.5;
    const h = 1 - y / 32; // 0 at the base (bottom), 1 at the top
    let t = 0;
    tongues.forEach(([tx, w, top], i) => {
      if (h > top) return;
      const cx = tx + 0.05 * Math.sin(h * 9 + i * 2);
      const width = w * (1 - h / top) ** 0.7;
      t = Math.max(t, clamp(1 - Math.abs(u - cx) / Math.max(0.001, width)));
    });
    t *= (0.55 + 0.6 * n(x / 4, y / 4)) * smooth(-0.04, 0.1, h);
    t = clamp(t * 1.25);
    // black -> red -> orange -> yellow
    const c = t < 0.35 ? mix(BLACK, [0.55, 0.05, 0], t / 0.35) : t < 0.7 ? mix([0.55, 0.05, 0], [0.95, 0.5, 0.02], (t - 0.35) / 0.35) : mix([0.95, 0.5, 0.02], [0.99, 0.86, 0.1], (t - 0.7) / 0.3);
    return c;
  });
};

// ------------------------------------------------------------------ blood and marks

function splatter(seed) {
  const rand = rng(seed);
  const n = fbm(seed, 0, 0, 3);
  const r = new Raster(64, 64).fill(WHITE, 0);
  const cx = 32 + (rand() - 0.5) * 6;
  const cy = 32 + (rand() - 0.5) * 6;
  const R0 = 8 + rand() * 6;
  // Irregular body, grainy like a spray
  const grain = fbm(seed + 3, 0, 0, 2);
  r.draw(
    (x, y) => {
      const a = Math.atan2(y - cy, x - cx);
      const rr = R0 * (0.75 + 0.55 * n(3 + Math.cos(a) * 2, 3 + Math.sin(a) * 2));
      return Math.hypot(x - cx, y - cy) < rr;
    },
    (x, y) => [1, 1, 1, 0.55 + 0.45 * grain(x / 2.2, y / 2.2)],
  );
  // Fine mist around the body
  r.draw(
    (x, y) => Math.hypot(x - cx, y - cy) < R0 * 2.1,
    (x, y) => [1, 1, 1, 0.5 * smooth(R0 * 2.1, R0 * 0.8, Math.hypot(x - cx, y - cy)) * smooth(0.45, 0.8, grain(x / 1.4 + 9, y / 1.4))],
  );
  // Streaks
  const streaks = 4 + Math.floor(rand() * 5);
  for (let i = 0; i < streaks; i++) {
    const a = rand() * Math.PI * 2;
    const len = R0 + 3 + rand() * 9;
    const w = 0.8 + rand() * 1.4;
    r.draw(line(cx + Math.cos(a) * R0 * 0.5, cy + Math.sin(a) * R0 * 0.5, cx + Math.cos(a) * len, cy + Math.sin(a) * len, w), WHITE, 0.85);
    r.draw(circle(cx + Math.cos(a) * len, cy + Math.sin(a) * len, w * 0.9), WHITE, 0.85);
  }
  // Droplets, smaller the farther
  const drops = 24 + Math.floor(rand() * 22);
  for (let i = 0; i < drops; i++) {
    const a = rand() * Math.PI * 2;
    const d = R0 + rand() * 18;
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    if (x < 2 || y < 2 || x > 62 || y > 62) continue;
    r.draw(circle(x, y, 0.6 + rand() * 2 * (1 - (d - R0) / 22)), WHITE, 0.6 + rand() * 0.4);
  }
  return r;
}
for (let i = 1; i <= 10; i++) TEX[`blood${String(i).padStart(2, '0')}`] = () => splatter(100 + i * 7);

TEX.ExplosionMark = () => {
  const rand = rng(41);
  const spikes = Array.from({ length: 14 }, () => ({ a: rand() * Math.PI * 2, len: 0.3 + rand() * 0.17, w: 0.2 + rand() * 0.22 }));
  const n = fbm(42, 0, 0, 3);
  return mask(64, BLACK, (u, v) => {
    const r = Math.hypot(u, v);
    const a = Math.atan2(v, u);
    let reach = 0.25 + 0.07 * n(3 + Math.cos(a) * 2, 3 + Math.sin(a) * 2);
    for (const s of spikes) {
      const da = Math.abs(((a - s.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      reach = Math.max(reach, s.len * (1 - da / s.w));
    }
    return smooth(reach + 0.03, reach - 0.08, r) * (0.7 + 0.3 * smooth(0.3, 0, r));
  });
};

// ------------------------------------------------------------------ HUD pictures

/** Light from the top left on a sphere-ish shape centred at (cx, cy) of radius rad. */
const lit = (base, cx, cy, rad) => (x, y) => {
  const d = Math.hypot(x - (cx - rad * 0.35), y - (cy - rad * 0.4)) / (rad * 1.5);
  const k = 1.25 - clamp(d) * 0.75;
  return base.map((c) => clamp(c * k));
};

TEX.GrenadeIcon = () => {
  const r = new Raster(64, 64).fill(BLACK, 0);
  const [cx, cy, rad] = [31, 37, 19];
  r.draw(circle(cx, cy, rad), lit([0.33, 0.45, 0.2], cx, cy, rad));
  // Segments of the body
  for (const off of [-10, 0, 10]) r.draw(line(cx + off, cy - rad + 3, cx + off * 1.1, cy + rad - 3, 1.4), [0.18, 0.26, 0.1], 0.8);
  r.draw(line(cx - rad + 3, cy, cx + rad - 3, cy, 1.4), [0.18, 0.26, 0.1], 0.8);
  // Fuse head, lever, ring
  r.draw(polygon([[24, 15], [38, 15], [36, 22], [26, 22]]), lit([0.42, 0.42, 0.4], 31, 18, 7));
  r.draw(path([[36, 16], [44, 17], [49, 24], [50, 33]], 4.2), [0.72, 0.7, 0.45]);
  r.draw((x, y) => Math.abs(Math.hypot(x - 20, y - 13) - 5) < 1.2, [0.6, 0.6, 0.6]);
  return r;
};

TEX.molotovIcon = () => {
  const r = new Raster(64, 64).fill(BLACK, 0);
  const glass = (x, y) => {
    // across the bottle (perpendicular to its axis), for the shine
    const t = ((x - 34) * 0.7 - (y - 38) * 0.7) / 9;
    return [0.45 + 0.35 * smooth(0.6, -0.4, t), 0.55 + 0.3 * smooth(0.6, -0.4, t), 0.42 + 0.2 * smooth(0.6, -0.4, t)];
  };
  r.draw(line(27, 31, 46, 50, 17), glass);
  r.draw(line(14, 18, 28, 32, 7), glass);
  // Cloth stuffed in the neck, and the flame
  r.draw(polygon([[9, 15], [15, 10], [19, 15], [15, 20]]), [0.85, 0.78, 0.55]);
  r.draw(ellipse(10, 9, 4.5, 6.5), [1, 0.55, 0.08], 0.9);
  r.draw(ellipse(10.5, 10, 2.4, 3.8), [1, 0.9, 0.3]);
  return r;
};

function flagIcon(color) {
  const r = new Raster(64, 64).fill(BLACK, 0);
  const top = 8;
  const wave = (x) => 2.6 * Math.sin((x - 18) / 7);
  const shade = (x, y) => {
    const k = 0.8 + 0.25 * Math.cos((x - 18) / 7);
    return color.map((c) => clamp(c * k));
  };
  r.draw((x, y) => x > 18 && x < 58 && y > top + wave(x) && y < top + 26 + wave(x) - (x - 18) * 0.12, shade);
  r.draw(line(16, 60, 18.5, 5, 3.6), [0.42, 0.3, 0.14]);
  return r.draw(circle(18.5, 5, 2.4), [0.75, 0.68, 0.3]);
}
TEX.BlueFlag = () => flagIcon([0.1, 0.12, 0.85]);
TEX.RedFlag = () => flagIcon([0.85, 0.08, 0.06]);

// ------------------------------------------------------------------ write

const ALPHA = new Set(Object.keys(TEX).filter((k) => k !== 'nuzzleFlash'));
const preview = process.argv.includes('--preview');
for (const [name, make] of Object.entries(TEX)) {
  const r = make();
  writeTGA(`public/assets/textures/${name}.tga`, r, ALPHA.has(name));
  if (preview) writePNG(`shots/effects/${name}.png`, r);
}
console.log(`wrote ${Object.keys(TEX).length} textures`);
