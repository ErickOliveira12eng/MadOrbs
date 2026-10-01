// The map themes (public/assets/textures/themes/<theme>/tex_floor, tex_floor_dirt,
// tex_wall_center .tga), drawn from scratch. Same 23 themes, same role and the same kind of
// material as the original game's (grass, sand, bricks, ice...), each tuned to the original
// theme's average colour and contrast so the maps keep their mood, but every texture is new.
// 128 x 128 and seamless: the ground repeats every 2 x 2 cells, the walls every cell of height.
// Usage: node tools/assets/make-themes.mjs [--preview] [theme ...]
import { Raster, fbm, rng, voronoi, writePNG, writeTGA } from './lib.mjs';

const S = 128;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const mul = (c, k) => c.map((v) => v * k);
const wrap = (v) => ((v % S) + S) % S;

/**
 * Periodic fractal noise in [0, 1]: `cells` lattice cells across the texture (`cellsY` down it,
 * for streaks). Scale with the cell counts, never by multiplying x or y by a fraction: that
 * would break the seamless tiling. Whole multiples (x * 2) and shears (x + y) are fine.
 */
const noise = (seed, cells, octaves = 4, cellsY = cells) => {
  const n = fbm(seed, cells, cellsY, octaves);
  return (x, y) => n((wrap(x) / S) * cells, (wrap(y) / S) * cellsY);
};

/** Light from the top left on a height field h(x, y) (periodic): 1 on flat ground. */
const relief = (h, strength) => {
  const L = [-0.62, -0.62, 0.48];
  return (x, y) => {
    const gx = (h(x + 1, y) - h(x - 1, y)) * strength;
    const gy = (h(x, y + 1) - h(x, y - 1)) * strength;
    const len = Math.hypot(gx, gy, 2);
    return Math.max(0.15, (-gx * L[0] - gy * L[1] + 2 * L[2]) / len / L[2]);
  };
};

/** Per-id colour variation in [-1, 1]. */
const vary = (seed) => {
  const r = rng(seed);
  const t = Array.from({ length: 1024 }, () => r() * 2 - 1);
  return (id) => t[((id % 1024) + 1024) % 1024];
};

const tex = (fn) => new Raster(S, S).shade(fn);

// ------------------------------------------------------------------ materials

const M = {
  grass: (c, seed) => {
    const fine = noise(seed, 32, 3);
    const blades = noise(seed + 1, 64, 2, 20);
    const patches = noise(seed + 2, 4, 3);
    return tex((x, y) => {
      const b = blades(x, y);
      return mul(c, 0.62 + 0.45 * fine(x, y) + 0.35 * (b - 0.5) + 0.3 * (patches(x, y) - 0.5));
    });
  },
  soil: (c, seed) => {
    const n = noise(seed, 8, 5);
    const v = voronoi(seed + 3, 10, S);
    const pebble = (x, y) => smooth(0, 3, v(wrap(x), wrap(y)).d2 - v(wrap(x), wrap(y)).d1) * 0.6 + n(x, y);
    const light = relief(pebble, 1.2);
    return tex((x, y) => mul(c, (0.55 + 0.9 * n(x, y)) * light(x, y)));
  },
  sand: (c, seed) => {
    const n = noise(seed, 16, 4);
    const w = noise(seed + 1, 4, 2);
    const h = (x, y) => 0.5 + 0.5 * Math.sin(((y + w(x, y) * 40) / S) * Math.PI * 2 * 6) * 0.3 + n(x, y) * 0.4;
    const light = relief(h, 3);
    return tex((x, y) => mul(c, (0.82 + 0.36 * n(x * 2, y * 2)) * light(x, y)));
  },
  snow: (c, seed) => {
    const n = noise(seed, 8, 5);
    const light = relief(n, 6);
    return tex((x, y) => mul(c, (0.94 + 0.1 * n(x * 3, y * 3)) * light(x, y)));
  },
  ice: (c, seed, hatch = 1) => {
    const n = noise(seed, 8, 4);
    const m = noise(seed + 1, 16, 3);
    return tex((x, y) => {
      const a = Math.abs(Math.sin(((x + y) / S) * Math.PI * 16 + n(x, y) * 6)) ** 12;
      const b = Math.abs(Math.sin(((x - y) / S) * Math.PI * 16 + m(x, y) * 6)) ** 12;
      return mul(mix(c, [1, 1, 1], (a + b) * 0.45 * hatch), 0.7 + 0.6 * n(x, y));
    });
  },
  gravel: (c, seed, n = 14) => {
    const v = voronoi(seed, n, S);
    const tone = vary(seed);
    const grain = noise(seed + 5, 32, 2);
    const h = (x, y) => {
      const q = v(wrap(x), wrap(y));
      return smooth(0, S / n / 2, q.d2 - q.d1);
    };
    const light = relief(h, 3.5);
    return tex((x, y) => {
      const q = v(wrap(x), wrap(y));
      const k = (0.85 + 0.3 * tone(q.id)) * light(x, y) * (0.85 + 0.3 * grain(x, y)) * (0.5 + 0.5 * smooth(0, 2.5, q.d2 - q.d1));
      return mul(c, k);
    });
  },
  cobbles: (c, mortar, seed, n = 6) => {
    const v = voronoi(seed, n, S, 0.7);
    const tone = vary(seed);
    const grain = noise(seed + 5, 24, 3);
    const gap = 2.2;
    const h = (x, y) => {
      const q = v(wrap(x), wrap(y));
      return Math.sqrt(smooth(gap, S / n / 2.2, q.d2 - q.d1));
    };
    const light = relief(h, 5);
    return tex((x, y) => {
      const q = v(wrap(x), wrap(y));
      if (q.d2 - q.d1 < gap) return mul(mortar, 0.8 + 0.4 * grain(x, y));
      return mul(c, (0.85 + 0.28 * tone(q.id)) * light(x, y) * (0.8 + 0.4 * grain(x, y)));
    });
  },
  flagstones: (c, gapColor, seed, n = 5) => {
    const v = voronoi(seed, n, S, 0.9);
    const tone = vary(seed);
    const grain = noise(seed + 5, 16, 4);
    const h = (x, y) => smooth(0, 3, v(wrap(x), wrap(y)).d2 - v(wrap(x), wrap(y)).d1);
    const light = relief(h, 2);
    return tex((x, y) => {
      const q = v(wrap(x), wrap(y));
      if (q.d2 - q.d1 < 1.6) return mul(gapColor, 0.8 + 0.3 * grain(x, y));
      return mul(c, (0.85 + 0.25 * tone(q.id)) * (0.75 + 0.5 * grain(x, y)) * light(x, y));
    });
  },
  /** Bricks / stone blocks: `rows` courses, `cols` bricks per course, half offset every other one. */
  bricks: (c, mortar, seed, rows = 8, cols = 4, gap = 2, bevel = 2) => {
    const bh = S / rows;
    const bw = S / cols;
    const tone = vary(seed);
    const grain = noise(seed + 5, 32, 3);
    const coarse = noise(seed + 6, 8, 3);
    const at = (x, y) => {
      const row = Math.floor(wrap(y) / bh);
      const xx = wrap(x + (row % 2) * bw * 0.5);
      const col = Math.floor(xx / bw);
      const ex = Math.min(xx - col * bw, (col + 1) * bw - xx);
      const ey = Math.min(wrap(y) - row * bh, (row + 1) * bh - wrap(y));
      return { id: row * 64 + (col % cols), e: Math.min(ex, ey) };
    };
    const h = (x, y) => smooth(gap, gap + bevel, at(x, y).e) + coarse(x, y) * 0.3;
    const light = relief(h, 2.5);
    return tex((x, y) => {
      const b = at(x, y);
      if (b.e < gap) return mul(mortar, 0.8 + 0.4 * grain(x, y));
      return mul(c, (0.86 + 0.24 * tone(b.id)) * (0.78 + 0.44 * grain(x, y)) * light(x, y));
    });
  },
  tiles: (c, grout, seed, count = 4, gap = 1.5) => {
    const size = S / count;
    const tone = vary(seed);
    const grain = noise(seed + 5, 32, 3);
    const e = (x, y) => Math.min(wrap(x) % size, size - (wrap(x) % size), wrap(y) % size, size - (wrap(y) % size));
    const light = relief((x, y) => smooth(gap, gap + 2, e(x, y)), 2);
    return tex((x, y) => {
      if (e(x, y) < gap) return mul(grout, 0.85 + 0.3 * grain(x, y));
      const id = Math.floor(wrap(x) / size) + Math.floor(wrap(y) / size) * 31;
      return mul(c, (0.9 + 0.16 * tone(id)) * (0.85 + 0.3 * grain(x, y)) * light(x, y));
    });
  },
  hexes: (c, grout, seed, n = 4) => {
    // Hex cells: Voronoi of a regular hexagonal point lattice that tiles the square
    const pts = [];
    const dx = S / n;
    const dy = S / (n * 2);
    for (let j = 0; j < n * 2; j++) for (let i = 0; i < n; i++) pts.push([(i + (j % 2) * 0.5) * dx, (j + 0.5) * dy]);
    const tone = vary(seed);
    const grain = noise(seed + 5, 32, 3);
    const near = (x, y) => {
      let d1 = Infinity;
      let d2 = Infinity;
      let id = 0;
      pts.forEach(([px, py], k) => {
        for (const ox of [-S, 0, S]) {
          for (const oy of [-S, 0, S]) {
            const d = Math.hypot(wrap(x) - px - ox, (wrap(y) - py - oy) * 1.73);
            if (d < d1) [d2, d1, id] = [d1, d, k];
            else if (d < d2) d2 = d;
          }
        }
      });
      return { e: d2 - d1, id };
    };
    const light = relief((x, y) => smooth(1.5, 4, near(x, y).e), 2);
    return tex((x, y) => {
      const q = near(x, y);
      if (q.e < 1.8) return mul(grout, 0.85 + 0.3 * grain(x, y));
      return mul(c, (0.88 + 0.2 * tone(q.id)) * (0.85 + 0.3 * grain(x, y)) * light(x, y));
    });
  },
  concrete: (c, seed, cracks = true) => {
    const n = noise(seed, 8, 5);
    const fine = noise(seed + 1, 64, 2);
    const v = voronoi(seed + 2, 3, S, 1);
    const crackRand = vary(seed + 3);
    return tex((x, y) => {
      let k = (0.72 + 0.5 * n(x, y)) * (0.9 + 0.2 * fine(x, y));
      if (cracks) {
        const q = v(wrap(x), wrap(y));
        if (q.d2 - q.d1 < 0.9 && crackRand(q.id) > 0) k *= 0.55;
      }
      return mul(c, k);
    });
  },
  asphalt: (c, seed) => {
    const n = noise(seed, 8, 4);
    const r = rng(seed);
    const dots = new Float32Array(S * S).map(() => (r() < 0.06 ? (r() - 0.4) * 1.2 : 0));
    return tex((x, y) => mul(c, (0.85 + 0.3 * n(x, y)) * (1 + dots[Math.floor(y) * S + Math.floor(x)])));
  },
  /** Raised bars, alternating direction in a checkerboard (anti-slip floor plates). */
  treadPlate: (c, seed) => {
    const grain = noise(seed, 32, 3);
    const n = noise(seed + 1, 4, 3);
    const cellSize = S / 4;
    const h = (x, y) => {
      const cx = Math.floor(wrap(x) / cellSize);
      const cy = Math.floor(wrap(y) / cellSize);
      const u = (wrap(x) % cellSize) / cellSize - 0.5;
      const v = (wrap(y) % cellSize) / cellSize - 0.5;
      const flip = (cx + cy) % 2 ? 1 : -1;
      // Two chevron bars per cell
      const a = Math.abs(v - flip * Math.abs(u) * 0.8 + 0.12);
      const b = Math.abs(v - flip * Math.abs(u) * 0.8 - 0.22);
      const bar = Math.max(smooth(0.07, 0.035, a), smooth(0.07, 0.035, b));
      return bar * smooth(0.48, 0.4, Math.abs(u)) * smooth(0.48, 0.4, Math.abs(v));
    };
    const light = relief(h, 3);
    return tex((x, y) => mul(c, (0.85 + 0.3 * grain(x, y)) * (0.85 + 0.3 * n(x, y)) * light(x, y)));
  },
  perforated: (c, hole, seed, count = 8) => {
    const size = S / count;
    const grain = noise(seed, 32, 3);
    const rust = noise(seed + 1, 8, 4);
    const d = (x, y) => Math.hypot((wrap(x) % size) - size / 2, (wrap(y) % size) - size / 2);
    const light = relief((x, y) => smooth(size * 0.24, size * 0.38, d(x, y)), 3);
    return tex((x, y) => {
      if (d(x, y) < size * 0.26) return mul(hole, 0.8 + 0.3 * grain(x, y));
      return mul(c, (0.75 + 0.4 * grain(x, y)) * (0.8 + 0.4 * rust(x, y)) * light(x, y));
    });
  },
  rust: (c, seed) => {
    const n = noise(seed, 8, 5);
    const spots = noise(seed + 1, 16, 3);
    return tex((x, y) => mul(mix(c, mul(c, 0.55), smooth(0.55, 0.75, spots(x, y))), 0.75 + 0.5 * n(x, y)));
  },
  /** Metal crate face: frame, cross braces and rivets (one panel per cell). */
  crate: (c, seed) => {
    const grain = noise(seed, 32, 3);
    const n = noise(seed + 1, 4, 3);
    const h = (x, y) => {
      const u = wrap(x) / S;
      const v = wrap(y) / S;
      const edge = Math.min(u, 1 - u, v, 1 - v);
      const frame = smooth(0.1, 0.085, edge);
      const diag = Math.min(Math.abs(u - v), Math.abs(u + v - 1));
      const brace = smooth(0.055, 0.035, diag) * smooth(0.1, 0.13, edge);
      const centre = smooth(0.12, 0.1, Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)));
      let rivet = 0;
      for (const [rx, ry] of [[0.05, 0.05], [0.95, 0.05], [0.05, 0.95], [0.95, 0.95], [0.5, 0.05], [0.5, 0.95], [0.05, 0.5], [0.95, 0.5]]) rivet = Math.max(rivet, smooth(0.025, 0.012, Math.hypot(u - rx, v - ry)));
      return Math.max(frame, brace, centre * 0.8) + rivet * 0.5;
    };
    const light = relief(h, 4);
    return tex((x, y) => mul(c, (0.8 + 0.3 * grain(x, y)) * (0.85 + 0.3 * n(x, y)) * light(x, y) * (h(x, y) > 0.5 ? 1.05 : 0.85)));
  },
  /** Dark metal with a grid of studs. */
  studs: (c, seed, count = 8) => {
    const size = S / count;
    const grain = noise(seed, 32, 3);
    const h = (x, y) => {
      const u = (wrap(x) % size) / size - 0.5;
      const v = (wrap(y) % size) / size - 0.5;
      return smooth(0.32, 0.18, Math.max(Math.abs(u), Math.abs(v))) * (0.6 + 0.4 * smooth(0.3, 0, Math.hypot(u, v)));
    };
    const light = relief(h, 6);
    return tex((x, y) => mul(c, (0.75 + 0.4 * grain(x, y)) * light(x, y)));
  },
  planks: (c, seed, count = 4) => {
    const w = S / count;
    const tone = vary(seed);
    const grain = noise(seed, 4, 3, 2);
    return tex((x, y) => {
      const i = Math.floor(wrap(x) / w);
      const u = wrap(x) % w;
      const rings = 0.5 + 0.5 * Math.sin((u / w) * 9 + grain(x + i * 37, y) * 14);
      const seam = Math.min(u, w - u) < 1.2 ? 0.45 : 1;
      return mul(c, (0.82 + 0.18 * tone(i)) * (0.8 + 0.35 * rings) * seam);
    });
  },
  /** Basketweave parquet: squares of strips, alternating horizontal and vertical. */
  parquet: (c, seed, count = 4, strips = 4) => {
    const size = S / count;
    const tone = vary(seed);
    const grain = noise(seed, 6, 3);
    return tex((x, y) => {
      const cx = Math.floor(wrap(x) / size);
      const cy = Math.floor(wrap(y) / size);
      const vertical = (cx + cy) % 2 === 0;
      const along = vertical ? wrap(y) : wrap(x);
      const across = (vertical ? wrap(x) : wrap(y)) % size;
      const strip = Math.floor(across / (size / strips));
      const inStrip = across % (size / strips);
      const edge = Math.min(inStrip, size / strips - inStrip, (vertical ? wrap(y) : wrap(x)) % size, size - ((vertical ? wrap(y) : wrap(x)) % size));
      const id = cx * 7 + cy * 13 + strip;
      const lines = 0.5 + 0.5 * Math.sin(along * 0.35 + grain(x, y) * 10 + id);
      return mul(c, (0.85 + 0.2 * tone(id)) * (0.85 + 0.2 * lines) * (edge < 0.9 ? 0.6 : 1));
    });
  },
  /** Hay / thatch: long stalks, mostly along `slant` (-1, 0 or 1: a 45 degree shear). */
  straw: (c, seed, slant = 1) => {
    const a = noise(seed, 64, 2, 6);
    const b = noise(seed + 2, 64, 2, 8);
    const n = noise(seed + 1, 8, 3);
    return tex((x, y) => {
      const s = 0.65 * a(x + y * slant, y) + 0.35 * b(x - y * slant, y);
      return mul(c, (0.55 + 0.9 * s) * (0.8 + 0.4 * n(x, y)));
    });
  },
  lavaRock: (rock, glow, seed) => {
    const v = voronoi(seed, 5, S, 0.9);
    const n = noise(seed + 1, 16, 4);
    return tex((x, y) => {
      const q = v(wrap(x), wrap(y));
      const crack = smooth(3.5, 0.5, q.d2 - q.d1);
      return mix(mul(rock, 0.6 + 0.6 * n(x, y)), glow, crack * (0.6 + 0.4 * n(x * 2, y * 2)));
    });
  },
  rock: (c, seed) => {
    const n = noise(seed, 8, 6);
    const light = relief(n, 14);
    return tex((x, y) => mul(c, (0.7 + 0.6 * n(x, y)) * light(x, y)));
  },
  fur: (c, seed) => {
    const n = noise(seed, 8, 4);
    const strands = noise(seed + 1, 64, 2, 16);
    return tex((x, y) => mul(c, (0.82 + 0.3 * n(x, y)) * (0.85 + 0.3 * strands(x + y, y))));
  },
  scales: (c, seed, rows = 8) => {
    const h = S / rows;
    const w = h * 1.2;
    const cols = Math.round(S / w);
    const sw = S / cols;
    const grain = noise(seed, 16, 3);
    const height = (x, y) => {
      let best = 0;
      for (const dy of [0, 1]) {
        const row = Math.floor(wrap(y) / h) + dy;
        const ox = (row % 2) * sw * 0.5;
        const col = Math.round((wrap(x) - ox) / sw);
        const cx = col * sw + ox;
        const cy = row * h;
        const d = Math.hypot((wrap(x) - cx) / sw, (wrap(y) - cy) / h);
        if (d < 0.75) best = Math.max(best, 1 - d / 0.75);
      }
      return best;
    };
    const light = relief(height, 3);
    return tex((x, y) => mul(c, (0.75 + 0.4 * grain(x, y)) * light(x, y)));
  },
  weave: (c, seed, count = 8) => {
    const size = S / count;
    const grain = noise(seed, 32, 3);
    const h = (x, y) => {
      const i = Math.floor(wrap(x) / size);
      const j = Math.floor(wrap(y) / size);
      const u = (wrap(x) % size) / size;
      const v = (wrap(y) % size) / size;
      const horiz = (i + j) % 2 === 0;
      const t = horiz ? v : u;
      const along = horiz ? u : v;
      return Math.sin(t * Math.PI) * (0.6 + 0.4 * Math.sin(along * Math.PI));
    };
    const light = relief(h, 5);
    return tex((x, y) => mul(c, (0.75 + 0.4 * grain(x, y)) * light(x, y)));
  },
  flat: (c, seed, amount = 0.04) => {
    const n = noise(seed, 4, 3);
    return tex((x, y) => mul(c, 1 - amount + 2 * amount * n(x, y)));
  },
  /** Paving with a few coloured slabs set in it. */
  pavers: (c, accents, seed) => {
    const base = M.concrete(c, seed, false);
    const r = rng(seed);
    const slabs = [];
    for (let i = 0; i < 4; i++) slabs.push({ x: Math.floor(r() * 4) * 32 + 3, y: Math.floor(r() * 4) * 32 + 3, w: 26 + Math.floor(r() * 2) * 32, h: 26, c: accents[i % accents.length] });
    const grain = noise(seed + 9, 32, 3);
    const px = base.px;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        // grout grid every 32 px
        if (x % 32 < 1 || y % 32 < 1) {
          px[i] *= 0.7;
          px[i + 1] *= 0.7;
          px[i + 2] *= 0.7;
        }
        for (const s of slabs) {
          const lx = wrap(x - s.x);
          const ly = wrap(y - s.y);
          if (lx < s.w && ly < s.h) {
            const edge = Math.min(lx, s.w - 1 - lx, ly, s.h - 1 - ly);
            const k = (edge < 1 ? 0.65 : 1) * (0.85 + 0.3 * grain(x, y));
            [px[i], px[i + 1], px[i + 2]] = mul(s.c, k);
          }
        }
      }
    }
    return base;
  },
  poolTiles: (c, grout, seed) => M.tiles(c, grout, seed, 8, 1.2),
};

// ------------------------------------------------------------------ themes: floor, dirt, wall

const THEMES = {
  animal: [(s) => M.fur(hex('#7d6f70'), s), (s) => M.scales(hex('#3c3c3c'), s), (s) => M.weave(hex('#433334'), s)],
  city: [(s) => M.grass(hex('#3c6701'), s), (s) => M.tiles(hex('#767c78'), hex('#4a4f4c'), s, 4), (s) => M.concrete(hex('#706861'), s)],
  core: [(s) => M.soil(hex('#66422e'), s), (s) => M.gravel(hex('#a8461c'), s, 18), (s) => M.rock(hex('#333531'), s)],
  frozen: [(s) => M.ice(hex('#296895'), s, 1.2), (s) => M.ice(hex('#82a3c2'), s, 0.5), (s) => M.ice(hex('#5f8fa9'), s, 0.9)],
  grain: [(s) => M.straw(hex('#9e7300'), s, 1), (s) => M.straw(hex('#99834a'), s, 0), (s) => M.bricks(hex('#3c2e26'), hex('#22190f'), s, 4, 2, 2.5, 3)],
  grass: [(s) => M.grass(hex('#3c6701'), s), (s) => M.soil(hex('#4e3a31'), s), (s) => M.bricks(hex('#5c5b57'), hex('#3d3c39'), s, 4, 2, 2, 3)],
  lava: [(s) => M.cobbles(hex('#45372d'), hex('#3a2e25'), s, 5), (s) => M.rust(hex('#6e3b15'), s), (s) => M.rock(hex('#3a3632'), s)],
  medieval: [(s) => M.grass(hex('#556538'), s), (s) => M.flagstones(hex('#6a5c54'), hex('#3e342f'), s), (s) => M.cobbles(hex('#77685e'), hex('#3b322c'), s, 5)],
  metal: [(s) => M.perforated(hex('#b88664'), hex('#3a2416'), s), (s) => M.rust(hex('#b88155'), s), (s) => M.studs(hex('#494949'), s)],
  modern: [(s) => M.treadPlate(hex('#474746'), s), (s) => M.soil(hex('#4e3a31'), s), (s) => M.crate(hex('#3d3a35'), s)],
  orange: [(s) => M.flat(hex('#3b90c3'), s), (s) => M.flat(hex('#b2d3e7'), s, 0.02), (s) => M.flat(hex('#c28019'), s)],
  rainy: [(s) => M.grass(hex('#005600'), s), (s) => M.tiles(hex('#8d9085'), hex('#5c5e57'), s, 4), (s) => M.cobbles(hex('#b8c6c1'), hex('#5f6866'), s, 6)],
  real: [(s) => M.grass(hex('#505c3a'), s), (s) => M.soil(hex('#655b41'), s), (s) => M.bricks(hex('#8a5a40'), hex('#9b9285'), s, 8, 4, 1.6, 1.5)],
  road: [(s) => M.asphalt(hex('#2c2f30'), s), (s) => M.asphalt(hex('#253536'), s), (s) => M.hexes(hex('#8b8e8f'), hex('#4c4f50'), s)],
  rock: [(s) => M.gravel(hex('#7a7d76'), s, 16), (s) => M.gravel(hex('#605353'), s, 12), (s) => M.cobbles(hex('#a39b8a'), hex('#5c564c'), s, 5)],
  sand: [(s) => M.sand(hex('#ab8a6e'), s), (s) => M.soil(hex('#7a6853'), s), (s) => M.flagstones(hex('#bca06d'), hex('#8a7448'), s, 4)],
  savana: [(s) => M.straw(hex('#8b6616'), s, 1), (s) => M.gravel(hex('#8a8472'), s, 9), (s) => M.weave(hex('#a28e6a'), s, 4)],
  snow: [(s) => M.snow(hex('#d1cfd7'), s), (s) => M.ice(hex('#aec9d6'), s, 0.2), (s) => M.rock(hex('#696a6b'), s)],
  soft: [(s) => M.pavers(hex('#94816d'), [hex('#c99a8c'), hex('#d9c3a0')], s), (s) => M.pavers(hex('#95805d'), [hex('#e0b83a')], s), (s) => M.tiles(hex('#99952e'), hex('#5e5b16'), s, 2, 2)],
  street: [(s) => M.concrete(hex('#8a908f'), s), (s) => M.poolTiles(hex('#7cb8e0'), hex('#d8e8f0'), s), (s) => M.bricks(hex('#9a841e'), hex('#5e5012'), s, 4, 2, 2, 3)],
  tropical: [(s) => M.grass(hex('#607f41'), s), (s) => M.sand(hex('#caac8f'), s), (s) => M.bricks(hex('#6e6e6e'), hex('#4a4a4a'), s, 8, 4, 1.6, 1.5)],
  winter: [(s) => M.straw(hex('#b4b4b4'), s, -1), (s) => M.ice(hex('#6ca2bb'), s, 0.4), (s) => M.bricks(hex('#64829a'), hex('#9fb4c4'), s, 6, 3, 2, 2)],
  wooden: [(s) => M.parquet(hex('#bf6f2a'), s), (s) => M.parquet(hex('#8c3c04'), s), (s) => M.planks(hex('#8a4000'), s)],
};

// The original themes' average colour and contrast (per texture), to keep each map's mood
const TARGET = {
  animal: [['#7d6f70', 10], ['#3c3c3c', 11], ['#433334', 19]],
  city: [['#3c6701', 14], ['#707672', 31], ['#706861', 16]],
  core: [['#66422e', 27], ['#973918', 39], ['#333531', 23]],
  frozen: [['#296895', 72], ['#82a3c2', 38], ['#5f8fa9', 48]],
  grain: [['#9e7300', 18], ['#99834a', 9], ['#3c2e26', 23]],
  grass: [['#3c6701', 14], ['#4e3a31', 11], ['#5c5b57', 16]],
  lava: [['#45372d', 6], ['#6e3b15', 11], ['#3a3632', 8]],
  medieval: [['#556538', 17], ['#655750', 24], ['#6d5f56', 54]],
  metal: [['#a17557', 53], ['#b88155', 13], ['#494949', 58]],
  modern: [['#474746', 19], ['#4e3a31', 11], ['#3d3a35', 23]],
  orange: [['#3b90c3', 1], ['#b2d3e7', 0], ['#c28019', 3]],
  rainy: [['#005600', 13], ['#898c81', 18], ['#aab9b4', 62]],
  real: [['#505c3a', 14], ['#655b41', 14], ['#7f624c', 35]],
  road: [['#2c2f30', 6], ['#253536', 6], ['#828586', 29]],
  rock: [['#7a7d76', 51], ['#605353', 48], ['#9a9382', 44]],
  sand: [['#ab8a6e', 13], ['#7a6853', 23], ['#b79b69', 17]],
  savana: [['#8b6616', 37], ['#8a8472', 34], ['#a28e6a', 27]],
  snow: [['#d1cfd7', 8], ['#aec9d6', 4], ['#696a6b', 26]],
  soft: [['#94816d', 36], ['#95805d', 40], ['#938f2b', 37]],
  street: [['#8a908f', 12], ['#81bade', 23], ['#8e791c', 16]],
  tropical: [['#607f41', 23], ['#caac8f', 6], ['#686868', 25]],
  winter: [['#adadad', 16], ['#6ca2bb', 20], ['#607d93', 35]],
  wooden: [['#bf6f2a', 19], ['#8c3c04', 16], ['#8a4000', 9]],
};

/** Shifts the texture to the target mean colour, and its contrast toward the target. */
function calibrate(r, [color, std]) {
  const px = r.px;
  const n = S * S;
  const mean = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) mean[c] += px[i * 4 + c] / n;
  let dev = 0;
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) dev += (px[i * 4 + c] - mean[c]) ** 2 / (n * 3);
  dev = Math.sqrt(dev) * 255;
  const target = hex(color);
  const k = clamp(Math.max(std, 4) / Math.max(dev, 1), 0.3, 1.5);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v = target[c] + (px[i * 4 + c] - mean[c]) * k * (mean[c] > 0.01 ? target[c] / Math.max(mean[c], 0.05) : 1);
      px[i * 4 + c] = clamp(v);
    }
  }
  return r;
}

const preview = process.argv.includes('--preview');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const NAMES = ['tex_floor', 'tex_floor_dirt', 'tex_wall_center'];
let seed = 1000;
for (const [theme, makers] of Object.entries(THEMES)) {
  makers.forEach((make, i) => {
    seed += 17;
    if (only.length && !only.includes(theme)) return;
    const r = calibrate(make(seed), TARGET[theme][i]);
    writeTGA(`public/assets/textures/themes/${theme}/${NAMES[i]}.tga`, r);
    if (preview) writePNG(`shots/themes/${theme}-${NAMES[i]}.png`, r);
  });
}
console.log(`wrote ${only.length ? only.join(', ') : Object.keys(THEMES).length + ' themes'}`);
