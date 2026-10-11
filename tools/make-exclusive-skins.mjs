// Draws the waves mode's exclusive Orb skins (skin24..skin26: Honeycomb, Flames, Crown), won at the
// waves' milestones (src/client/wavesProgress.ts). Mad Orbs' own art, made here, not the original
// game's. A skin is a 64x32 equirectangular texture whose red, green and blue say how much of each of
// the player's three colours goes on each texel (src/client/render/baboRenderer.ts, Player::updateSkin).
//   node tools/make-exclusive-skins.mjs            -> public/assets/skins/skin24.tga ... skin26.tga
//   node tools/make-exclusive-skins.mjs --preview  -> also shots/exclusive-skins.ppm (8x, to look at)
import { mkdirSync, writeFileSync } from 'node:fs';

const W = 64;
const H = 32;
/** Samples per texel side: the edges come out smooth. */
const SS = 6;

const fract = (x) => x - Math.floor(x);
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Each skin: (u, v) -> [red, green, blue] shares, u around the Orb (0..1), v from the top row (0) to
 * the bottom one (1).
 */
const SKINS = {
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
};

function render(fn) {
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
      const n = SS * SS;
      px.set([r / n, g / n, b / n], (y * W + x) * 3);
    }
  }
  return px;
}

/** An uncompressed 24-bit TGA, rows from the bottom up (as the game's skins are). */
function tga(px) {
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
  const px = render(fn);
  writeFileSync(`public/assets/skins/${name}.tga`, tga(px));
  rendered.push(px);
  console.log(`public/assets/skins/${name}.tga`);
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
