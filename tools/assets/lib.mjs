// Tiny raster toolkit for the remake's own assets (tools/assets/*.mjs): shapes drawn as coverage
// functions sampled 4x4 per pixel (antialiased), optional horizontal wrap (textures around a
// sphere), deterministic noise, and TGA / PNG writers. Plain Node, no dependencies.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { deflateSync } from 'node:zlib';

export const R = [1, 0, 0];
export const G = [0, 1, 0];
export const B = [0, 0, 1];

/** Seeded random numbers in [0, 1) (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise on a lattice, periodic every `px` lattice cells along x (and `py` along y). */
export function valueNoise(seed, px = 0, py = 0) {
  const rand = rng(seed);
  const table = Float32Array.from({ length: 4096 }, rand);
  const at = (ix, iy) => {
    if (px) ix = ((ix % px) + px) % px;
    if (py) iy = ((iy % py) + py) % py;
    return table[(((ix * 73856093) ^ (iy * 19349663)) >>> 0) % 4096];
  };
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = fade(x - ix);
    const fy = fade(y - iy);
    const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx;
    const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx;
    return a + (b - a) * fy;
  };
}

/** Fractal value noise (octaves), each octave periodic like the first. */
export function fbm(seed, px = 0, py = 0, octaves = 4) {
  const layers = Array.from({ length: octaves }, (_, i) => valueNoise(seed + i * 101, px << i, py << i));
  return (x, y) => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += layers[i](x * (1 << i), y * (1 << i)) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
}

/**
 * Periodic Voronoi cells: an n x n grid of jittered points over a `size` x `size` texture.
 * Returns (x, y) -> { d1, d2, id, cx, cy }: distances to the nearest and second nearest point
 * (d2 - d1 is small near cell borders), the nearest cell's id and its point.
 */
export function voronoi(seed, n, size, jitter = 0.85) {
  const rand = rng(seed);
  const cell = size / n;
  const pts = Array.from({ length: n * n }, (_, i) => [((i % n) + 0.5 + (rand() - 0.5) * jitter) * cell, (Math.floor(i / n) + 0.5 + (rand() - 0.5) * jitter) * cell]);
  return (x, y) => {
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    let d1 = Infinity;
    let d2 = Infinity;
    let id = 0;
    let cx = 0;
    let cy = 0;
    for (let oy = -2; oy <= 2; oy++) {
      for (let ox = -2; ox <= 2; ox++) {
        const ix = gx + ox;
        const iy = gy + oy;
        const wx = ((ix % n) + n) % n;
        const wy = ((iy % n) + n) % n;
        const p = pts[wy * n + wx];
        const px = p[0] + (ix - wx) * cell;
        const py = p[1] + (iy - wy) * cell;
        const d = Math.hypot(x - px, y - py);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          id = wy * n + wx;
          cx = px;
          cy = py;
        } else if (d < d2) d2 = d;
      }
    }
    return { d1, d2, id, cx, cy };
  };
}

// ------------------------------------------------------------------ shapes (coverage tests)

export const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;
export const circle = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
export const ellipse = (cx, cy, rx, ry) => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
export const ring = (cx, cy, r0, r1) => (x, y) => {
  const d = (x - cx) ** 2 + (y - cy) ** 2;
  return d >= r0 * r0 && d <= r1 * r1;
};

/** Thick segment (rounded ends). */
export const line = (x0, y0, x1, y1, w) => (x, y) => {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1)));
  return (x - x0 - dx * t) ** 2 + (y - y0 - dy * t) ** 2 <= (w / 2) ** 2;
};

/** Thick polyline. */
export const path = (pts, w) => {
  const segs = pts.slice(1).map((p, i) => line(pts[i][0], pts[i][1], p[0], p[1], w));
  return (x, y) => segs.some((s) => s(x, y));
};

/** Filled polygon (even-odd). */
export const polygon = (pts) => (x, y) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

export const union = (...fs) => (x, y) => fs.some((f) => f(x, y));

// ------------------------------------------------------------------ canvas

export class Raster {
  /**
   * @param {number} w width in pixels
   * @param {number} h height in pixels
   * @param {{ wrapX?: boolean, ss?: number }} opts wrapX: shapes repeat around (sphere textures)
   */
  constructor(w, h, { wrapX = false, ss = 4 } = {}) {
    this.w = w;
    this.h = h;
    this.wrapX = wrapX;
    this.ss = ss;
    this.px = new Float32Array(w * h * 4); // straight RGBA, 0..1
  }

  /** Every pixel from a function of its centre: (x, y) -> [r, g, b] or [r, g, b, a]. */
  shade(fn) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = fn(x + 0.5, y + 0.5);
        const i = (y * this.w + x) * 4;
        this.px[i] = c[0];
        this.px[i + 1] = c[1];
        this.px[i + 2] = c[2];
        this.px[i + 3] = c.length > 3 ? c[3] : 1;
      }
    }
    return this;
  }

  fill(color, alpha = 1) {
    return this.shade(() => [...color, alpha]);
  }

  /**
   * Paints where `shape` covers, blended by the covered fraction of each pixel. `color` is
   * [r, g, b] or a function of the pixel centre returning [r, g, b] or [r, g, b, a] (shading).
   */
  draw(shape, color, alpha = 1) {
    const n = this.ss;
    const test = this.wrapX ? (x, y) => shape(x, y) || shape(x - this.w, y) || shape(x + this.w, y) : shape;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        let hits = 0;
        for (let sy = 0; sy < n; sy++) for (let sx = 0; sx < n; sx++) if (test(x + (sx + 0.5) / n, y + (sy + 0.5) / n)) hits++;
        if (!hits) continue;
        const c = typeof color === 'function' ? color(x + 0.5, y + 0.5) : color;
        const k = (hits / (n * n)) * alpha * (c.length > 3 ? c[3] : 1);
        this.over((y * this.w + x) * 4, c, k);
      }
    }
    return this;
  }

  /** "Over" compositing of one colour with opacity k on the straight-alpha pixel at index i. */
  over(i, color, k) {
    const a0 = this.px[i + 3];
    const a = k + a0 * (1 - k);
    for (let c = 0; c < 3; c++) this.px[i + c] = a > 0 ? (color[c] * k + this.px[i + c] * a0 * (1 - k)) / a : 0;
    this.px[i + 3] = a;
  }

  /** 8-bit RGBA, rows from the top. */
  bytes() {
    const out = new Uint8Array(this.w * this.h * 4);
    for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.max(0, Math.min(1, this.px[i])) * 255);
    return out;
  }
}

// ------------------------------------------------------------------ writers

/** Uncompressed TGA like the original files: bottom-left origin, BGR(A). */
export function writeTGA(file, raster, alpha = false) {
  const { w, h } = raster;
  const src = raster.bytes();
  const bpp = alpha ? 4 : 3;
  const out = Buffer.alloc(18 + w * h * bpp);
  out[2] = 2;
  out.writeUInt16LE(w, 12);
  out.writeUInt16LE(h, 14);
  out[16] = bpp * 8;
  out[17] = alpha ? 8 : 0;
  let o = 18;
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[o++] = src[i + 2];
      out[o++] = src[i + 1];
      out[o++] = src[i];
      if (alpha) out[o++] = src[i + 3];
    }
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, out);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** RGBA PNG (for previews and, later, the modern formats). */
export function writePNG(file, raster) {
  const { w, h } = raster;
  const src = raster.bytes();
  const rows = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    rows[y * (w * 4 + 1)] = 0;
    Buffer.from(src.buffer, y * w * 4, w * 4).copy(rows, y * (w * 4 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
}
