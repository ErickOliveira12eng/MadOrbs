// The volcano map for the boss mode (31/10/2026, Erick: CTF-Reticulated, by Vesuvius, made over): written from the
// original map file, which stays as it is (it keeps its rain in the online rotation).
//   - the lava theme (Map::reloadWeather: lava weather, no rain; the lava's ambient sound);
//   - the tower in the middle made floor, an open arena where the boss stands, and the spawn points next to it gone;
//   - lava around the boss's spot (the floor's dirt, which the lava theme draws as glowing lava);
//   - Deathmatch and Team Deathmatch only: the flag pods zeroed (isMapValid says no to CTF).
// Not DM- nor CTF-: the server's rotations take those prefixes (src/server/index.ts), and mapList.ts doesn't list it,
// so it shows nowhere until a mode loads it by name.
//   node tools/make-boss-map.mjs   -> public/assets/maps/BOSS-Vesuvio.bvm
// The file (Map::Map, version 20202; src/sim/map.ts parses it): uint32 version, the author (25 bytes), then int16
// theme, weather, width, height; per cell two bytes (passable bit 128 + wall height, the dirt of its corner (x, y) in
// 255ths); the spawn points (an int16 count, then x y z float32 each); one section per game type (an int16 id: DM and
// TDM nothing, CTF the two flag pods, S&D the objectives and the team spawns).
import { readFileSync, writeFileSync } from 'node:fs';

const SOURCE = 'public/assets/maps/CTF-Reticulated.bvm';
const OUT = 'public/assets/maps/BOSS-Vesuvio.bvm';
/** THEME_LAVA, WEATHER_LAVA (src/sim/map.ts). */
const LAVA = 5;
/** The middle of the map, where the boss stands. */
const CENTRE = 15.5;
/** The tower: walls in these cells (both ways) become floor. */
const TOWER = [12, 18];
/** Spawn points closer than this to the middle are dropped. */
const SPAWN_CLEAR = 4;
/** The lava under the boss: full up to `full` from the middle, gone at `edge` (cells). */
const POOL = { full: 2.2, edge: 3.4 };
const GAME_TYPE_CTF = 2;

const b = Buffer.from(readFileSync(SOURCE));
if (b.readUInt32LE(0) !== 20202) throw new Error(`${SOURCE}: not a version 20202 map`);
b.writeInt16LE(LAVA, 29);
b.writeInt16LE(LAVA, 31);
const w = b.readInt16LE(33);
const h = b.readInt16LE(35);
const at = (x, y) => 37 + (y * w + x) * 2;

// The tower made floor (the floor byte of a cell next to it)
const floor = b[at(TOWER[0] - 1, CENTRE | 0)];
if (!(floor & 128)) throw new Error('expected floor beside the tower');
let cleared = 0;
for (let y = TOWER[0]; y <= TOWER[1]; y++) {
  for (let x = TOWER[0]; x <= TOWER[1]; x++) {
    if (!(b[at(x, y)] & 128)) {
      b[at(x, y)] = floor;
      cleared++;
    }
  }
}

// The lava pool: each cell's corner (x, y), smoothly from full to none
const smooth = (t) => t * t * (3 - 2 * t);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - CENTRE, y - CENTRE);
    const pool = smooth(Math.min(1, Math.max(0, (POOL.edge - d) / (POOL.edge - POOL.full))));
    if (pool > 0) b[at(x, y) + 1] = Math.max(b[at(x, y) + 1], Math.round(pool * 255));
  }
}

// The spawn points, without the ones by the middle
const spawnsAt = 37 + w * h * 2;
const count = b.readInt16LE(spawnsAt);
const spawns = [];
for (let i = 0; i < count; i++) {
  const o = spawnsAt + 2 + i * 12;
  if (Math.hypot(b.readFloatLE(o) - CENTRE, b.readFloatLE(o + 4) - CENTRE) > SPAWN_CLEAR) spawns.push(b.subarray(o, o + 12));
}

// The game type sections, the flag pods zeroed
const rest = Buffer.from(b.subarray(spawnsAt + 2 + count * 12));
for (let o = 0; o < rest.length; ) {
  const id = rest.readInt16LE(o);
  o += 2;
  if (id === GAME_TYPE_CTF) {
    rest.fill(0, o, o + 24);
    o += 24;
  } else if (id === 3) {
    o += 24;
    for (let k = 0; k < 2; k++) o += 2 + rest.readInt16LE(o) * 12;
  }
}

const n = Buffer.alloc(2);
n.writeInt16LE(spawns.length);
writeFileSync(OUT, Buffer.concat([b.subarray(0, spawnsAt), n, ...spawns, rest]));
console.log(`${OUT}: ${w}x${h}, ${cleared} tower cells made floor, ${spawns.length} of ${count} spawn points`);
