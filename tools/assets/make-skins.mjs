// The 23 orb skins (public/assets/skins/skin01..23.tga), drawn from scratch. Same format and role
// as the original game's: a 64 x 32 texture wrapped around the orb (x = around, y = top to bottom)
// whose red, green and blue say where each of the player's three colours goes (Player::updateSkin
// mixes them). Same kinds of patterns as the original set (camouflage, stripes, checkerboard,
// bricks, smileys...) so the game keeps its look, but every design here is new.
// Usage: node tools/assets/make-skins.mjs [--preview]   (--preview also writes shots/skins/*.png)
import { B, G, R, Raster, circle, ellipse, fbm, path, polygon, rect, ring, rng, writePNG, writeTGA } from './lib.mjs';

const W = 64;
const H = 32;
const TAU = Math.PI * 2;
const Y = [1, 1, 0]; // red + green
const skin = () => new Raster(W, H, { wrapX: true });

/** 5 x 7 pixel letters for the logo skin. */
const FONT = {
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
};
function text(r, str, x0, y0, sx, sy, color) {
  let x = x0;
  for (const ch of str) {
    const g = FONT[ch];
    if (g) g.forEach((row, j) => [...row].forEach((on, i) => on === '1' && r.draw(rect(x + i * sx, y0 + j * sy, x + (i + 1) * sx, y0 + (j + 1) * sy), color)));
    x += 6 * sx;
  }
}

const SKINS = [
  // 01 camouflage: red and blue patches on green
  () => {
    const n = fbm(11, 4, 0, 2);
    return skin().shade((x, y) => {
      const v = n((x / W) * 4, (y / H) * 2);
      return v > 0.58 ? R : v < 0.4 ? B : G;
    });
  },
  // 02 pinstripes
  () => {
    const r = skin().fill(G);
    for (const [a, b] of [[0, 3], [7, 9], [13, 19], [25, 27], [32, 35], [41, 43], [47, 53], [58, 60]]) r.draw(rect(a, 0, b, H), R);
    return r;
  },
  // 03 lightning bolt
  () => skin().fill(G).draw(polygon([[2, 4], [36, 11], [29, 16], [62, 29], [20, 20], [27, 15.5]]), R),
  // 04 plasma: wavy bands of the three colours melting into each other
  () =>
    skin().shade((x, y) => {
      const u = (x / W) * TAU;
      const t = y / 3.2 + 1.6 * Math.sin(u * 3) + 0.8 * Math.sin(u * 7 + y * 0.4);
      const band = (k) => Math.max(0, Math.cos(t - (k * TAU) / 3)) ** 1.5;
      return [band(0), band(1), band(2)];
    }),
  // 05 three-colour checkerboard
  () => skin().shade((x, y) => [R, G, B][(Math.floor(x / 8) + Math.floor(y / 8) * 2) % 3]),
  // 06 spots
  () => {
    const r = skin().fill(G);
    const rand = rng(6);
    for (let i = 0; i < 15; i++) {
      const cx = rand() * W;
      const cy = 3 + rand() * (H - 6);
      const rx = 2.4 + rand() * 3.6;
      r.draw(ellipse(cx, cy, rx, rx * (0.7 + rand() * 0.5)), B);
    }
    return r;
  },
  // 07 chain: rings on a band
  () => {
    const r = skin().fill(G).draw(rect(0, 13.5, W, 18.5), B);
    for (const cx of [8, 24, 40, 56]) r.draw(ring(cx, 16, 4.2, 6.6), R);
    return r;
  },
  // 08 machine band: plates and bolts
  () => {
    const r = skin().fill(G).draw(rect(0, 10, W, 22), R).draw(rect(0, 15.2, W, 16.8), B);
    for (const cx of [8, 24, 40, 56]) r.draw(rect(cx - 4, 11.5, cx + 4, 20.5), B).draw(circle(cx, 16, 2), R);
    for (const cx of [16, 32, 48, 0]) r.draw(circle(cx, 12.3, 0.9), B).draw(circle(cx, 19.7, 0.9), B);
    return r;
  },
  // 09 plain
  () => skin().fill(G),
  // 10 grid
  () => skin().shade((x, y) => (x % 8 < 1.3 || y % 8 < 1.3 ? R : G)),
  // 11 seam: two halves split by a wavy stitched line
  () => {
    const edge = (x) => 16 + 6 * Math.sin((x / W) * TAU * 2);
    const r = skin().shade((x, y) => (y < edge(x) ? B : G));
    const pts = Array.from({ length: 65 }, (_, i) => [i, edge(i)]);
    return r.draw(path(pts, 2.4), R);
  },
  // 12 colour bars between two bands
  () => {
    const bars = [[1, 1, 1], Y, [0, 1, 1], G, [1, 0, 1], R, B, [1, 1, 1]];
    return skin().shade((x, y) => (y < 4 || y >= 28 ? R : bars[Math.floor(x / 8)]));
  },
  // 13 bricks
  () =>
    skin().shade((x, y) => {
      const row = Math.floor(y / 4);
      const xx = x + (row % 2) * 4;
      if (y % 4 < 1 || xx % 8 < 1) return G;
      return (Math.floor(xx / 8) + row) % 2 ? R : B;
    }),
  // 14 squiggles
  () => {
    const r = skin().fill(R).draw(rect(0, 0, W, 4), B).draw(rect(0, 28, W, H), B);
    const rand = rng(14);
    for (let i = 0; i < 26; i++) {
      const x = rand() * W;
      const y = 7 + rand() * 18;
      const a = rand() * TAU;
      const pts = Array.from({ length: 6 }, (_, k) => [x + Math.cos(a) * k * 1.1 + Math.sin(k * 1.7) * 0.9, y + Math.sin(a) * k * 1.1 + Math.cos(k * 1.7) * 0.9]);
      r.draw(path(pts, 0.9), i % 3 ? Y : G);
    }
    return r;
  },
  // 15 stripes with squares
  () => {
    const r = skin().shade((x, y) => (y >= 5 && y < 11) || (y >= 21 && y < 27) ? R : G);
    for (let x = 0; x < W; x += 16) r.draw(rect(x + 5, 6, x + 10, 10), B).draw(rect(x + 13, 22, x + 18, 26), B);
    return r;
  },
  // 16 the game's name
  () => {
    const r = skin().fill(R);
    for (let x = 4; x < W; x += 8) r.draw(circle(x, 2.6, 1.5), G).draw(circle(x, 29.4, 1.5), G);
    text(r, 'MAD', 6, 8.5, 1, 2, B);
    text(r, 'ORBS', 32, 8.5, 1, 2, B);
    return r;
  },
  // 17 candy stripes
  () => skin().shade((x, y) => [R, Y, G][Math.floor((x + y) / 2) % 3]),
  // 18 happy and sad faces
  () => {
    const r = skin().fill(R);
    for (const [i, cx] of [8, 24, 40, 56].entries()) {
      r.draw(circle(cx, 16, 7), G).draw(circle(cx - 2.6, 13.5, 1.1), R).draw(circle(cx + 2.6, 13.5, 1.1), R);
      const smile = i % 2 === 0;
      const pts = Array.from({ length: 9 }, (_, k) => {
        const a = Math.PI * (0.2 + (0.6 * k) / 8);
        return smile ? [cx + Math.cos(a) * 4, 16.2 + Math.sin(a) * 3.4] : [cx + Math.cos(a) * 4, 22.4 - Math.sin(a) * 3.4];
      });
      r.draw(path(pts, 1.1), R);
    }
    return r;
  },
  // 19 racetrack loop
  () => {
    const track = (w) => (x, y) => {
      const dx = Math.max(0, Math.abs(x - 32) - 19);
      const d = Math.hypot(dx, y - 16);
      return Math.abs(d - 9) <= w;
    };
    const r = skin().fill(R).draw(track(2.2), B);
    for (let x = 14; x < 52; x += 5) r.draw(rect(x, 6.6, x + 2.4, 7.6), G).draw(rect(x, 24.4, x + 2.4, 25.4), G);
    return r;
  },
  // 20 polka dots
  () => {
    const r = skin().fill(R);
    for (let y = 2; y < H; y += 4) for (let x = (y / 4) % 2 ? 4 : 2; x < W; x += 4) r.draw(circle(x, y, 1.25), B);
    return r.draw(rect(0, 0, W, 0.8), G).draw(rect(0, 31.2, W, H), G);
  },
  // 21 bars between bands
  () => skin().shade((x, y) => (y < 5 || y >= 27 ? R : x % 6 < 3 ? B : G)),
  // 22 waves
  () => skin().shade((x, y) => (Math.floor((y + 3.5 * Math.sin((x / W) * TAU * 2)) / 4) % 2 ? R : G)),
  // 23 zigzag
  () => {
    const tri = (x) => 2 * Math.abs(((x / 32) % 1) * 2 - 1) - 1;
    return skin().shade((x, y) => (Math.abs(y - (16 + 9 * tri(x))) < 4.2 ? B : R));
  },
];

const preview = process.argv.includes('--preview');
SKINS.forEach((make, i) => {
  const name = `skin${String(i + 1).padStart(2, '0')}`;
  const r = make();
  writeTGA(`public/assets/skins/${name}.tga`, r);
  if (preview) writePNG(`shots/skins/${name}.png`, r);
});
console.log(`wrote ${SKINS.length} skins`);
