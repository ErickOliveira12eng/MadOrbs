// The 64x32 skins, recoloured (Player::updateSkin) at a higher resolution for the big orbs of the
// start screen. A skin is a map of how much of each decal colour goes on each texel; most are drawn
// with hard edges, a few with soft gradients. Each texel's mix is interpolated (Catmull-Rom), then,
// where the texels around are pure colours (a drawn edge), pushed back towards its strongest colour:
// edges come out as smooth, sharp curves instead of blurry blocks, gradients stay gradients.

export interface SkinPixels {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

type Rgb = readonly [number, number, number];

/** How hard the strongest colour wins on an edge (higher = sharper). */
const SHARPNESS = 10;

/** A skin's colour mix, `scale` times bigger: per pixel the share (0..255) of red, green, blue decal and black. */
export interface SkinMix {
  mix: Uint8Array;
  width: number;
  height: number;
}

/**
 * The skin's mix `scale` times bigger (the slow part: once per skin, whatever the colours). The
 * skin wraps around the orb horizontally; vertically it stops at the poles.
 */
export function upscaleSkinMix(src: SkinPixels, scale: number): SkinMix {
  const { width: w, height: h, data } = src;
  // Mix of each texel: red, green, blue decal and black (a texel with no colour at all)
  const mix = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const sum = r + g + b;
    if (sum === 0) mix[i * 4 + 3] = 1;
    else {
      mix[i * 4] = r / sum;
      mix[i * 4 + 1] = g / sum;
      mix[i * 4 + 2] = b / sum;
    }
  }
  const at = (x: number, y: number) => ((Math.min(h - 1, Math.max(0, y)) * w + (((x % w) + w) % w)) * 4);

  // A drawn edge goes from one pure colour to another in a single texel (at most one mixed texel
  // in between: the drawing's own antialiasing); a gradient has several mixed texels in a row.
  // Only the pure texels, and the mixed ones between two different pure colours, are sharpened
  const purity = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) purity[i] = smoothstep(0.8, 0.97, Math.max(mix[i * 4], mix[i * 4 + 1], mix[i * 4 + 2], mix[i * 4 + 3]));
  const purityAt = (x: number, y: number) => purity[at(x, y) / 4];
  const diff = (a: number, b: number) =>
    (Math.abs(mix[a] - mix[b]) + Math.abs(mix[a + 1] - mix[b + 1]) + Math.abs(mix[a + 2] - mix[b + 2]) + Math.abs(mix[a + 3] - mix[b + 3])) / 2;
  const pure = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let p = purityAt(x, y);
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const a = at(x - dx, y - dy);
        const b = at(x + dx, y + dy);
        p = Math.max(p, Math.min(purity[a / 4], purity[b / 4]) * smoothstep(0.5, 0.9, diff(a, b)));
      }
      pure[y * w + x] = p;
    }
  }
  const pureAt = (x: number, y: number) => pure[at(x, y) / 4];

  // Catmull-Rom weights of the 4 texels around each sub-position (the scale is a whole number)
  const kernels: number[][] = [];
  const offsets: number[] = [];
  for (let s = 0; s < scale; s++) {
    const u = (s + 0.5) / scale - 0.5;
    const i0 = Math.floor(u);
    offsets.push(i0);
    kernels.push(catmullRom(u - i0));
  }

  const W = w * scale;
  const H = h * scale;
  const out = new Uint8Array(W * H * 4);
  const m = [0, 0, 0, 0];
  const sharp = [0, 0, 0, 0];
  for (let Y = 0; Y < H; Y++) {
    const ty = Math.floor(Y / scale);
    const y0 = ty + offsets[Y % scale];
    const ky = kernels[Y % scale];
    const fy = (Y + 0.5) / scale - 0.5 - y0;
    for (let X = 0; X < W; X++) {
      const tx = Math.floor(X / scale);
      const x0 = tx + offsets[X % scale];
      const kx = kernels[X % scale];
      const fx = (X + 0.5) / scale - 0.5 - x0;
      m[0] = m[1] = m[2] = m[3] = 0;
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) {
          const k = kx[i] * ky[j];
          const p = at(x0 - 1 + i, y0 - 1 + j);
          m[0] += k * mix[p];
          m[1] += k * mix[p + 1];
          m[2] += k * mix[p + 2];
          m[3] += k * mix[p + 3];
        }
      }
      // The curve overshoots a little next to edges
      let sum = 0;
      for (let c = 0; c < 4; c++) sum += m[c] = Math.max(0, m[c]);
      if (sum <= 0) {
        m[3] = sum = 1;
      }
      // How pure the texels around are (bilinear, so the sharpening fades in without seams)
      const s =
        (pureAt(x0, y0) * (1 - fx) + pureAt(x0 + 1, y0) * fx) * (1 - fy) + (pureAt(x0, y0 + 1) * (1 - fx) + pureAt(x0 + 1, y0 + 1) * fx) * fy;
      let sharpSum = 0;
      if (s > 0) for (let c = 0; c < 4; c++) sharpSum += sharp[c] = (m[c] / sum) ** SHARPNESS;
      const o = (Y * W + X) * 4;
      for (let c = 0; c < 4; c++) {
        const weight = (m[c] / sum) * (1 - s) + (sharpSum > 0 ? (sharp[c] / sharpSum) * s : (m[c] / sum) * s);
        out[o + c] = Math.round(weight * 255);
      }
    }
  }
  return { mix: out, width: W, height: H };
}

/** Player::updateSkin on a mix: finalColor = redDecal * r + greenDecal * g + blueDecal * b (RGBA bytes). */
export function recolorMix(src: SkinMix, decals: readonly [Rgb, Rgb, Rgb]): Uint8Array {
  const { mix } = src;
  const out = new Uint8Array(mix.length);
  const [[rr, rg, rb], [gr, gg, gb], [br, bg, bb]] = decals;
  for (let o = 0; o < mix.length; o += 4) {
    const r = mix[o];
    const g = mix[o + 1];
    const b = mix[o + 2];
    out[o] = Math.min(255, rr * r + gr * g + br * b);
    out[o + 1] = Math.min(255, rg * r + gg * g + bg * b);
    out[o + 2] = Math.min(255, rb * r + gb * g + bb * b);
    out[o + 3] = 255;
  }
  return out;
}

function catmullRom(t: number): number[] {
  const t2 = t * t;
  const t3 = t2 * t;
  return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2];
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
