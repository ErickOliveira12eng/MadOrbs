// BVM map data + collision (pure TypeScript: no DOM, no three.js — also runs on the server).
//
// Ported from the original BaboViolent 2 source (BaboViolent2/Code):
//   - Map.h            (constants, map_cell, inline setTileDirt/addTileDirt/removeTileDirt, rayTileTest)
//   - Map.cpp          (Map::Map file loading, reloadWeather, reloadTheme theme names, rayTest,
//                       regenTex minimap data, IsMapValid)
//   - MapRender.cpp    (Map::performCollision, Map::collisionClip)
//   - FileIO.cpp       (binary reader: getInt() is a 16-bit short, getULong() 32-bit, little endian)
//
// World conventions: Z up, 1 unit = 1 cell, cell (x, y) covers [x, x+1] x [y, y+1],
// cells[y * size[0] + x].
//
// Notes on things that exist in the original but are intentionally absent here:
//   - dko_map / dko_mapLM (full-3D maps with octree collision). The original looked for them in
//     "main/modelmaps_______/<name>/<name>.DKO" — a path deliberately disabled with underscores that
//     never exists in the shipped game, so every map uses the grid code below.
//   - The A* build (_PRO_ only) and the editor code paths.

import { Vec3 } from './vec';
import { CoordFrame } from './coordFrame';

// ---------------------------------------------------------------------------------------------
// Constants (Map.h)
// ---------------------------------------------------------------------------------------------

export const THEME_START = 0;
// Classic themes
export const THEME_GRASS = THEME_START + 0;
export const THEME_SNOW = THEME_START + 1;
export const THEME_SAND = THEME_START + 2;
export const THEME_CITY = THEME_START + 3;
export const THEME_MODERN = THEME_START + 4;
export const THEME_LAVA = THEME_START + 5;
export const THEME_ANIMAL = THEME_START + 6;
export const THEME_ORANGE = THEME_START + 7;
// Pacifist's themes
export const THEME_CORE = THEME_START + 8;
export const THEME_FROZEN = THEME_START + 9;
export const THEME_GRAIN = THEME_START + 10;
export const THEME_MEDIEVAL = THEME_START + 11;
export const THEME_METAL = THEME_START + 12;
export const THEME_RAINY = THEME_START + 13;
export const THEME_REAL = THEME_START + 14;
export const THEME_ROAD = THEME_START + 15;
export const THEME_ROCK = THEME_START + 16;
export const THEME_SAVANA = THEME_START + 17;
export const THEME_SOFT = THEME_START + 18;
export const THEME_STREET = THEME_START + 19;
export const THEME_TROPICAL = THEME_START + 20;
export const THEME_WINTER = THEME_START + 21;
export const THEME_WOODEN = THEME_START + 22;
export const THEME_END = THEME_WOODEN;

/** THEME_*_STR, indexed by THEME_* value. Also the folder name under textures/themes/. */
export const THEME_NAMES: readonly string[] = [
  'grass', 'snow', 'sand', 'city', 'modern', 'lava', 'animal', 'orange',
  'core', 'frozen', 'grain', 'medieval', 'metal', 'rainy', 'real', 'road',
  'rock', 'savana', 'soft', 'street', 'tropical', 'winter', 'wooden',
];

export const WEATHER_NONE = 0;
export const WEATHER_FOG = 1;
export const WEATHER_SNOW = 2;
export const WEATHER_RAIN = 3;
export const WEATHER_SANDSTORM = 4;
export const WEATHER_LAVA = 5;

export const COLLISION_EPSILON = 0.05;
export const BOUNCE_FACTOR = 0.45;

/** Latest file version written by the editor. */
export const MAP_VERSION = 20202;
/** All BVM versions understood by Map::Map. */
export const BVM_VERSIONS: readonly number[] = [10010, 10011, 20201, 20202];

export const FLAG_BLUE = 0;
export const FLAG_RED = 1;

/** Map file names are truncated to 15 characters by Map::Map (`mapFilename.resize(15)`). */
export const MAP_NAME_MAX_LEN = 15;

// Game.h — only needed to read the 20202 per-game-type sections (kept private on purpose: the
// game-rules module owns the public GAME_TYPE_* constants).
const GAME_TYPE_COUNT = 4;
const GAME_TYPE_DM = 0;
const GAME_TYPE_TDM = 1;
const GAME_TYPE_CTF = 2;
const GAME_TYPE_SND = 3;

// Map.cpp rayTest
const TEST_DIR_X = 0;
const TEST_DIR_X_NEG = 1;
const TEST_DIR_Y = 2;
const TEST_DIR_Y_NEG = 3;

// performCollision tests the 3 neighbours in this order: same column/row, then -1, then +1.
const NEIGHBOUR_ORDER: readonly number[] = [0, -1, 1];

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

/** Port of `map_cell` (Map.h). */
export interface MapCell {
  passable: boolean;
  /** Wall height in cells (1 by default; 0..127 from the file). Only meaningful for walls. */
  height: number;
  /**
   * Dirt amount (0..1) at the 4 corners of the cell, as used by Map::buildGroundLayer:
   * [0] = (x, y+1), [1] = (x, y), [2] = (x+1, y), [3] = (x+1, y+1).
   * Vertex (x, y) is owned by cell (x, y).splater[1]; setTileDirt keeps the neighbours in sync.
   */
  splater: [number, number, number, number];
}

/** Options mirroring the relevant gameVar settings (defaults = shipped main/bv2.cfg). */
export interface MapLoadOptions {
  /** gameVar.r_weatherEffects (bv2.cfg: true). When false, weather is forced to WEATHER_NONE. */
  weatherEffects?: boolean;
  /** gameVar.cl_grassTextureForAllMaps (default false). */
  grassTextureForAllMaps?: boolean;
}

/** Minimap texture data, port of Map::regenTex (white = wall, black = floor). */
export interface MinimapData {
  /** Power-of-two texture size. */
  width: number;
  height: number;
  /** Fraction of the texture actually used by the map (texMapSize). */
  texMapSize: [number, number];
  /** RGB bytes, row 0 = map row y = 0 (bottom, like the GL upload). */
  data: Uint8Array;
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/**
 * C `(int)f` conversion: truncation toward zero. NaN / out-of-range values give INT_MIN like the
 * x86 cvttss2si instruction the original compiled to (so the bounds checks reject them).
 */
function toInt(v: number): number {
  if (!Number.isFinite(v) || v >= 2147483648 || v < -2147483648) return -2147483648;
  return Math.trunc(v);
}

/** Little-endian reader mirroring FileIO's getters. */
class BvmReader {
  private view: DataView;
  pos = 0;

  constructor(private bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.byteLength - this.pos;
  }

  private need(n: number): void {
    if (this.pos + n > this.bytes.byteLength) {
      throw new Error(`BVM: unexpected end of file at offset ${this.pos} (need ${n} bytes)`);
    }
  }

  /** FileIO::getULong — uint32. */
  getULong(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /** FileIO::getInt — reads a *short* (int16). */
  getInt(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  /** FileIO::getUByte. */
  getUByte(): number {
    this.need(1);
    return this.bytes[this.pos++]!;
  }

  /** FileIO::getFloat — float32. */
  getFloat(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /** FileIO::getVector3f. */
  getVector3f(): Vec3 {
    const x = this.getFloat();
    const y = this.getFloat();
    const z = this.getFloat();
    return new Vec3(x, y, z);
  }

  /** FileIO::getByteArray. */
  getByteArray(size: number): Uint8Array {
    this.need(size);
    const out = this.bytes.slice(this.pos, this.pos + size);
    this.pos += size;
    return out;
  }
}

/** Removes the BV2 in-string colour codes (bytes 1..9, see dkf) from a string. */
export function stripColorCodes(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x01-\x09]/g, '');
}

// ---------------------------------------------------------------------------------------------
// GameMap (port of class Map, data + collision part)
// ---------------------------------------------------------------------------------------------

export class GameMap {
  /** mapName (file name without extension, truncated to 15 chars like the original). */
  name: string;
  /** BVM file version the map was loaded from (10010, 10011, 20201 or 20202). */
  version = 0;
  /** CVector2i size. */
  size: [number, number] = [0, 0];
  /** Row-major cells[y * size[0] + x]. */
  cells: MapCell[] = [];

  /** Theme after Map::reloadTheme (unknown values fall back to THEME_GRASS). */
  theme = THEME_GRASS;
  /** Texture folder for the theme ("grass", "snow", ...). */
  themeName = 'grass';
  /** Theme value stored in the file (versions 20201/20202; THEME_GRASS for older files). */
  fileTheme = THEME_GRASS;
  /** Weather after Map::reloadWeather (derived from the theme — the file value is ignored). */
  weather = WEATHER_NONE;
  /** Weather value stored in the file (versions 20201/20202). Unused by the game, kept for reference. */
  fileWeather = WEATHER_NONE;

  // Map::reloadWeather fog values. Note: the original never leaves fogDensity > 0, so GL fog is
  // never actually enabled in-game (see GameRender.cpp); fogColor is still used as the colour of
  // the reflection "sky" on rainy / snow maps.
  fogColor: [number, number, number, number] = [1, 1, 1, 1];
  fogDensity = 1;
  fogStart = -3;
  fogEnd = -3;

  /** Common spawns (used by DM, TDM and CTF). */
  dmSpawns: Vec3[] = [];
  /** Team spawns (only used by Search & Destroy). */
  blueSpawns: Vec3[] = [];
  redSpawns: Vec3[] = [];
  /** CTF flag pods [FLAG_BLUE, FLAG_RED]. (0,0,0) when the map has none. */
  flagPodPos: [Vec3, Vec3] = [new Vec3(), new Vec3()];
  /** S&D bomb objectives. (0,0,0) when the map has none. */
  objective: [Vec3, Vec3] = [new Vec3(), new Vec3()];

  /** [PM] author_name (version 20202 only), raw with BV2 colour codes (bytes 1..9). */
  author?: string;

  /** Map::isValid. */
  isValid = true;

  /** Bytes left unread after parsing (diagnostic; the original ignores them). */
  trailingBytes = 0;

  /** Incremented by every set/add/removeTileDirt call (lets renderers know when to refresh). */
  dirtRevision = 0;

  constructor(name: string, sizeX = 0, sizeY = 0) {
    this.name = name.length > MAP_NAME_MAX_LEN ? name.slice(0, MAP_NAME_MAX_LEN) : name;
    if (sizeX > 0 && sizeY > 0) this.allocCells(sizeX, sizeY);
  }

  /** Plain author name without colour codes. */
  get authorPlain(): string | undefined {
    return this.author === undefined ? undefined : stripColorCodes(this.author);
  }

  private allocCells(w: number, h: number): void {
    this.size = [w, h];
    const n = Math.max(0, w) * Math.max(0, h);
    this.cells = new Array<MapCell>(n);
    for (let i = 0; i < n; ++i) {
      // map_cell(): passable, height 1, no dirt
      this.cells[i] = { passable: true, height: 1, splater: [0, 0, 0, 0] };
    }
  }

  // -------------------------------------------------------------------------------------------
  // Loading (Map::Map)
  // -------------------------------------------------------------------------------------------

  /**
   * Parses a .bvm file (Map::Map). Throws on truncated / unknown files.
   * @param name map name (file name without ".bvm")
   */
  static parse(buffer: ArrayBuffer | Uint8Array, name: string, opts: MapLoadOptions = {}): GameMap {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const file = new BvmReader(bytes);
    const map = new GameMap(name);

    const mapVersion = file.getULong();
    map.version = mapVersion;

    const readCells = (): void => {
      const w = file.getInt();
      const h = file.getInt();
      if (w <= 0 || h <= 0) throw new Error(`BVM: invalid map size ${w}x${h}`);
      map.allocCells(w, h);
      for (let j = 0; j < h; ++j) {
        for (let i = 0; i < w; ++i) {
          let data = file.getUByte();
          const cell = map.cells[j * w + i]!;
          cell.passable = (data & 128) !== 0;
          cell.height = data & 127;
          data = file.getUByte();
          map.setTileDirt(i, j, data / 255);
        }
      }
    };

    const readVec3List = (list: Vec3[]): void => {
      const nbSpawn = file.getInt();
      for (let i = 0; i < nbSpawn; ++i) list.push(file.getVector3f());
    };

    switch (mapVersion) {
      case 10010: {
        readCells();
        break;
      }
      case 10011: {
        readCells();
        // Les flag
        map.flagPodPos[0] = file.getVector3f();
        map.flagPodPos[1] = file.getVector3f();
        // Les objectifs
        map.objective[0] = file.getVector3f();
        map.objective[1] = file.getVector3f();
        // Les spawn point
        readVec3List(map.dmSpawns);
        readVec3List(map.blueSpawns);
        readVec3List(map.redSpawns);
        break;
      }
      case 20201: {
        map.fileTheme = file.getInt();
        map.fileWeather = file.getInt();
        readCells();
        map.flagPodPos[0] = file.getVector3f();
        map.flagPodPos[1] = file.getVector3f();
        map.objective[0] = file.getVector3f();
        map.objective[1] = file.getVector3f();
        readVec3List(map.dmSpawns);
        readVec3List(map.blueSpawns);
        readVec3List(map.redSpawns);
        break;
      }
      case 20202: {
        // Common map data: author_name.set("%.24s", buffer) — 25 bytes, NUL terminated
        const authorBytes = file.getByteArray(25);
        let len = 0;
        while (len < 24 && authorBytes[len] !== 0) ++len;
        map.author = String.fromCharCode(...authorBytes.subarray(0, len));
        map.fileTheme = file.getInt();
        map.fileWeather = file.getInt();
        readCells();
        // common spawns
        readVec3List(map.dmSpawns);
        // read game-type specific data: one section per supported game type
        for (let gtnum = 0; gtnum < GAME_TYPE_COUNT; ++gtnum) {
          const id = file.getInt();
          switch (id) {
            case GAME_TYPE_DM:
            case GAME_TYPE_TDM:
              break; // nothing to do for DM and TDM
            case GAME_TYPE_CTF:
              map.flagPodPos[0] = file.getVector3f();
              map.flagPodPos[1] = file.getVector3f();
              break;
            case GAME_TYPE_SND:
              map.objective[0] = file.getVector3f();
              map.objective[1] = file.getVector3f();
              readVec3List(map.blueSpawns);
              readVec3List(map.redSpawns);
              break;
            default:
              // console->add("> Error: unknown game-type id found in map-file")
              break;
          }
        }
        break;
      }
      default:
        // The original silently leaves the map without cells (and crashes later).
        throw new Error(`BVM: unknown map version ${mapVersion} in "${name}"`);
    }

    map.trailingBytes = file.remaining;

    // Constructor order: reloadWeather() (uses the raw theme), then reloadTheme().
    map.theme = map.fileTheme;
    map.reloadWeather(opts.weatherEffects ?? true);
    map.reloadTheme(opts.grassTextureForAllMaps ?? false);
    return map;
  }

  /**
   * Port of Map::reloadWeather: the weather is derived from the theme (the file value is ignored).
   * Faithful quirk: THEME_GRAIN's WEATHER_FOG is immediately overwritten by the if/else chain,
   * so no map ever gets WEATHER_FOG, and fogDensity always ends at 0.
   */
  reloadWeather(weatherEffects = true): void {
    const theme = this.theme;
    this.fogDensity = 1;
    this.fogStart = -3;
    this.fogEnd = -3;
    this.fogColor = [1, 1, 1, 1];

    if (!weatherEffects) {
      this.weather = WEATHER_NONE;
      this.fogDensity = 0;
      return;
    }

    this.fogDensity = 0;

    // Set weather to match theme
    if (theme === THEME_GRAIN) this.weather = WEATHER_FOG;
    if (theme === THEME_SNOW || theme === THEME_FROZEN || theme === THEME_WINTER) this.weather = WEATHER_SNOW;
    else if (theme === THEME_SAND || theme === THEME_STREET) this.weather = WEATHER_SANDSTORM;
    else if (theme === THEME_CITY || theme === THEME_RAINY || theme === THEME_ROAD) this.weather = WEATHER_RAIN;
    else if (theme === THEME_LAVA || theme === THEME_CORE || theme === THEME_ROCK) this.weather = WEATHER_LAVA;
    else this.weather = WEATHER_NONE;

    if (this.weather === WEATHER_RAIN) {
      this.fogStart = 4;
      this.fogEnd = -3;
      this.fogColor = [0.15, 0.25, 0.25, 1];
      // m_weather = new CRain();
    }
    if (this.weather === WEATHER_FOG) {
      this.fogStart = 1;
      this.fogEnd = -0.25;
      this.fogColor = [0.3, 0.4, 0.4, 1];
    }
    if (this.weather === WEATHER_SNOW) {
      this.fogDensity = 0;
      // m_weather = new CSnow();
    }
    if (this.weather === WEATHER_LAVA) {
      this.fogDensity = 0;
      // m_weather = new CLava();
    }
  }

  /** Port of the theme-name part of Map::reloadTheme (unknown theme -> grass). */
  reloadTheme(grassTextureForAllMaps = false): void {
    const name = this.theme >= THEME_START && this.theme <= THEME_END ? THEME_NAMES[this.theme - THEME_START] : undefined;
    if (name === undefined || grassTextureForAllMaps) {
      this.theme = THEME_GRASS;
      this.themeName = THEME_NAMES[THEME_GRASS]!;
    } else {
      this.themeName = name;
    }
  }

  // -------------------------------------------------------------------------------------------
  // Cell helpers
  // -------------------------------------------------------------------------------------------

  /** Cell at (x, y) or undefined when outside the map. */
  cellAt(x: number, y: number): MapCell | undefined {
    if (x < 0 || y < 0 || x >= this.size[0] || y >= this.size[1]) return undefined;
    return this.cells[y * this.size[0] + x];
  }

  /** True if (x, y) is inside the map and passable. */
  isPassable(x: number, y: number): boolean {
    const c = this.cellAt(x, y);
    return c !== undefined && c.passable;
  }

  /**
   * `cells[index].passable` with a raw linear index, exactly like the C++ pointer arithmetic
   * (neighbour lookups at x-1 / x+1 wrap into the previous / next row). Out-of-array reads were
   * undefined behaviour in C++; here they count as walls.
   */
  private passIdx(index: number): boolean {
    const c = this.cells[index];
    return c !== undefined && c.passable;
  }

  // -------------------------------------------------------------------------------------------
  // Dirt (Map.h inline functions)
  // -------------------------------------------------------------------------------------------

  /** Propagates cell(x, y).splater[1] (grid vertex (x, y)) to the neighbours sharing that vertex. */
  private shareTileDirt(x: number, y: number): void {
    const w = this.size[0];
    const v = this.cells[y * w + x]!.splater[1];
    // Ses voisins qui sharent ce vertex
    if (x > 0) {
      this.cells[y * w + x - 1]!.splater[2] = v;
      if (y > 0) this.cells[(y - 1) * w + x - 1]!.splater[3] = v;
    }
    if (y > 0) this.cells[(y - 1) * w + x]!.splater[0] = v;
    this.dirtRevision++;
  }

  setTileDirt(x: number, y: number, value: number): void {
    if (x < 0 || y < 0 || x >= this.size[0] || y >= this.size[1]) return;
    this.cells[y * this.size[0] + x]!.splater[1] = value;
    this.shareTileDirt(x, y);
  }

  addTileDirt(x: number, y: number, value: number): void {
    if (x < 0 || y < 0 || x >= this.size[0] || y >= this.size[1]) return;
    const s = this.cells[y * this.size[0] + x]!.splater;
    s[1] += value;
    if (s[1] > 1) s[1] = 1;
    this.shareTileDirt(x, y);
  }

  removeTileDirt(x: number, y: number, value: number): void {
    if (x < 0 || y < 0 || x >= this.size[0] || y >= this.size[1]) return;
    const s = this.cells[y * this.size[0] + x]!.splater;
    s[1] -= value;
    if (s[1] < 0) s[1] = 0;
    this.shareTileDirt(x, y);
  }

  // -------------------------------------------------------------------------------------------
  // Collision (MapRender.cpp)
  // -------------------------------------------------------------------------------------------

  /**
   * Port of Map::performCollision. Mutates `cf` (position pushed out of walls, velocity reflected
   * with BOUNCE_FACTOR on the colliding axis) and then copies cf.position into lastCF.position,
   * exactly like the C++.
   */
  performCollision(lastCF: CoordFrame, cf: CoordFrame, radius: number): void {
    const cells = this.cells;
    if (cells.length > 0) {
      const w = this.size[0];
      const pos = cf.position;
      const vel = cf.vel;
      const last = lastCF.position;
      let x = toInt(pos.x);
      let y = toInt(pos.y);
      // On check en Y first of all
      if (x < 1) x = 1;
      if (y < 1) y = 1;
      if (x >= this.size[0] - 1) x = this.size[0] - 2;
      if (y >= this.size[1] - 1) y = this.size[1] - 2;
      // prevents high velocity objects (minibots) from going into outer walls and causing a crash

      if (vel.y < 0) {
        for (const o of NEIGHBOUR_ORDER) {
          const cx = x + o;
          if (!this.passIdx((y - 1) * w + cx)) {
            // Est-ce qu'on entre en collision avec
            if (
              last.x - radius <= cx + 1 &&
              last.x + radius >= cx &&
              pos.y - radius <= y - 1 + 1 &&
              pos.y + radius >= y - 1
            ) {
              // On le ramène en Y
              pos.y = y - 1 + 1 + radius + COLLISION_EPSILON;
              vel.y = -vel.y * BOUNCE_FACTOR; // On le fait rebondir ! Bedong!
            }
          }
        }
      } else if (vel.y > 0) {
        for (const o of NEIGHBOUR_ORDER) {
          const cx = x + o;
          if (!this.passIdx((y + 1) * w + cx)) {
            if (
              last.x - radius <= cx + 1 &&
              last.x + radius >= cx &&
              pos.y - radius <= y + 1 + 1 &&
              pos.y + radius >= y + 1
            ) {
              pos.y = y + 1 - radius - COLLISION_EPSILON;
              vel.y = -vel.y * BOUNCE_FACTOR;
            }
          }
        }
      }

      // On check en X asteur (sti c sketch comme technique, mais bon, c juste babo là!)
      if (vel.x < 0) {
        for (const o of NEIGHBOUR_ORDER) {
          const cy = y + o;
          if (!this.passIdx(cy * w + (x - 1))) {
            if (
              pos.x - radius <= x - 1 + 1 &&
              pos.x + radius >= x - 1 &&
              last.y - radius <= cy + 1 &&
              last.y + radius >= cy
            ) {
              pos.x = x - 1 + 1 + radius + COLLISION_EPSILON;
              vel.x = -vel.x * BOUNCE_FACTOR;
            }
          }
        }
      } else if (vel.x > 0) {
        for (const o of NEIGHBOUR_ORDER) {
          const cy = y + o;
          if (!this.passIdx(cy * w + (x + 1))) {
            if (
              pos.x - radius <= x + 1 + 1 &&
              pos.x + radius >= x + 1 &&
              last.y - radius <= cy + 1 &&
              last.y + radius >= cy
            ) {
              pos.x = x + 1 - radius - COLLISION_EPSILON;
              vel.x = -vel.x * BOUNCE_FACTOR;
            }
          }
        }
      }
    }

    lastCF.position.copy(cf.position);
  }

  /**
   * Port of Map::collisionClip: clips the position against the 4 neighbour walls, clamps it inside
   * the outer border, and pushes it out if it ended inside a wall cell. Mutates cf.position.
   */
  collisionClip(cf: CoordFrame, radius: number): void {
    const w = this.size[0];
    const pos = cf.position;
    const x = toInt(pos.x);
    const y = toInt(pos.y);

    // Là c simple, on check les 8 cases autour, pis on clip (pour éviter de se faire pousser dans le mur)
    if (this.cells.length > 0) {
      if (pos.x + radius + COLLISION_EPSILON > x + 1 && !this.passIdx(y * w + (x + 1))) {
        pos.x = x + 1 - radius - COLLISION_EPSILON;
      }
      if (pos.x - radius - COLLISION_EPSILON < x && !this.passIdx(y * w + (x - 1))) {
        pos.x = x + radius + COLLISION_EPSILON;
      }
      if (pos.y + radius + COLLISION_EPSILON > y + 1 && !this.passIdx((y + 1) * w + x)) {
        pos.y = y + 1 - radius - COLLISION_EPSILON;
      }
      if (pos.y - radius - COLLISION_EPSILON < y && !this.passIdx((y - 1) * w + x)) {
        pos.y = y + radius + COLLISION_EPSILON;
      }
    }

    // Clamp with the universe
    if (x <= 0) pos.x = 1 + radius + COLLISION_EPSILON;
    if (x >= this.size[0] - 1) pos.x = this.size[0] - 1 - radius - COLLISION_EPSILON;
    if (y <= 0) pos.y = 1 + radius + COLLISION_EPSILON;
    if (y >= this.size[1] - 1) pos.y = this.size[1] - 1 - radius - COLLISION_EPSILON;

    // check if we are in a cell, move to the next allowed cells
    if (!this.passIdx(y * w + x)) {
      const possible = [false, false, false, false];
      if (this.passIdx(y * w + (x - 1))) possible[0] = true;
      if (this.passIdx(y * w + (x + 1))) possible[1] = true;
      if (this.passIdx((y - 1) * w + x)) possible[2] = true;
      if (this.passIdx((y + 1) * w + x)) possible[3] = true;

      //--- On essaye de pogner le best choice pareil là
      const dis = [pos.x - x, 1 - (pos.x - x), pos.y - y, 1 - (pos.y - y)];

      let currentMin = 2;
      if (possible[0] && dis[0]! < currentMin) {
        pos.x = x - radius - COLLISION_EPSILON;
        currentMin = dis[0]!;
      }
      if (possible[1] && dis[1]! < currentMin) {
        pos.x = x + 1 + radius + COLLISION_EPSILON;
        currentMin = dis[1]!;
      }
      if (possible[2] && dis[2]! < currentMin) {
        pos.y = y - radius - COLLISION_EPSILON;
        currentMin = dis[2]!;
      }
      if (possible[3] && dis[3]! < currentMin) {
        pos.y = y + 1 + radius + COLLISION_EPSILON;
        currentMin = dis[3]!;
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Ray tests (Map.cpp rayTest, Map.h rayTileTest)
  // -------------------------------------------------------------------------------------------

  /**
   * Port of Map::rayTest. Like the C++ references: on hit returns true, sets `p2` in place to the
   * hit point and writes `normal`. If p1 starts inside a wall, p2 = p1 (normal untouched).
   * Returns false (p2 untouched) when p1 is outside the map.
   */
  rayTest(p1: Vec3, p2: Vec3, normal: Vec3): boolean {
    const w = this.size[0];
    const h = this.size[1];

    // On pogne notre cell de départ
    let i = toInt(p1.x);
    let j = toInt(p1.y);

    // On check que notre tuile n'est pas déjà occupée
    if (i >= 0 && i < w && j >= 0 && j < h) {
      const c = this.cells[j * w + i]!;
      if (!c.passable && p1.z < c.height) {
        p2.copy(p1);
        return true;
      }
    } else {
      return false;
    }

    // On défini dans quel sens on va voyager (4 sens)
    let sens: number;
    if (Math.abs(p2.x - p1.x) > Math.abs(p2.y - p1.y)) {
      sens = p2.x > p1.x ? TEST_DIR_X : TEST_DIR_X_NEG;
    } else {
      sens = p2.y > p1.y ? TEST_DIR_Y : TEST_DIR_Y_NEG;
    }

    // On while tant qu'on ne l'a pas trouvé
    let percent: number;
    for (;;) {
      // On check qu'on n'a pas dépassé
      if (
        i < 0 ||
        i >= w ||
        j < 0 ||
        j >= h ||
        (sens === TEST_DIR_X && i > toInt(p2.x)) ||
        (sens === TEST_DIR_X_NEG && i < toInt(p2.x)) ||
        (sens === TEST_DIR_Y && j > toInt(p2.y)) ||
        (sens === TEST_DIR_Y_NEG && j < toInt(p2.y))
      ) {
        return false;
      }

      switch (sens) {
        case TEST_DIR_X:
          // On test nos 3 tuiles
          if (this.rayTileTest(i, j, p1, p2, normal)) return true;
          if (this.rayTileTest(i, j - 1, p1, p2, normal)) return true;
          if (this.rayTileTest(i, j + 1, p1, p2, normal)) return true;
          // On incrémente à la prochaine tuile
          i++;
          percent = (i - p1.x) / Math.abs(p2.x - p1.x);
          j = toInt(p1.y + (p2.y - p1.y) * percent);
          break;
        case TEST_DIR_X_NEG:
          if (this.rayTileTest(i, j, p1, p2, normal)) return true;
          if (this.rayTileTest(i, j - 1, p1, p2, normal)) return true;
          if (this.rayTileTest(i, j + 1, p1, p2, normal)) return true;
          i--;
          percent = (p1.x - (i + 1)) / Math.abs(p2.x - p1.x);
          j = toInt(p1.y + (p2.y - p1.y) * percent);
          break;
        case TEST_DIR_Y:
          if (this.rayTileTest(i, j, p1, p2, normal)) return true;
          if (this.rayTileTest(i - 1, j, p1, p2, normal)) return true;
          if (this.rayTileTest(i + 1, j, p1, p2, normal)) return true;
          j++;
          percent = (j - p1.y) / Math.abs(p2.y - p1.y);
          i = toInt(p1.x + (p2.x - p1.x) * percent);
          break;
        default: // TEST_DIR_Y_NEG
          if (this.rayTileTest(i, j, p1, p2, normal)) return true;
          if (this.rayTileTest(i - 1, j, p1, p2, normal)) return true;
          if (this.rayTileTest(i + 1, j, p1, p2, normal)) return true;
          j--;
          percent = (p1.y - (j + 1)) / Math.abs(p2.y - p1.y);
          i = toInt(p1.x + (p2.x - p1.x) * percent);
          break;
      }
    }
  }

  /**
   * Port of the inline Map::rayTileTest: tests segment p1->p2 against one tile (its floor if
   * passable; its roof and 4 sides if it is a wall). On hit sets p2 to the hit point, writes
   * `normal` and returns true.
   */
  rayTileTest(x: number, y: number, p1: Vec3, p2: Vec3, normal: Vec3): boolean {
    if (x >= 0 && x < this.size[0] && y >= 0 && y < this.size[1]) {
      const x1 = x;
      const x2 = x + 1;
      const y1 = y;
      const y2 = y + 1;
      let percent: number;
      const cell = this.cells[y * this.size[0] + x]!;
      const height = cell.height;
      let px: number, py: number, pz: number;

      if (cell.passable) {
        // On check juste si on pogne le plancher !
        if (p1.z > 0 && p2.z <= 0) {
          percent = p1.z / Math.abs(p2.z - p1.z);
          px = p1.x + (p2.x - p1.x) * percent;
          py = p1.y + (p2.y - p1.y) * percent;
          pz = p1.z + (p2.z - p1.z) * percent;
          if (px >= x1 && px <= x2 && py >= y1 && py <= y2) {
            p2.set(px, py, pz);
            normal.set(0, 0, 1);
            return true;
          }
          return false;
        }
        return false;
      }

      // !passable: on check si on pogne le plafond
      if (p1.z > height && p2.z <= height) {
        percent = (p1.z - height) / Math.abs(p2.z - height - (p1.z - height));
        px = p1.x + (p2.x - p1.x) * percent;
        py = p1.y + (p2.y - p1.y) * percent;
        pz = p1.z + (p2.z - p1.z) * percent;
        if (px >= x1 && px <= x2 && py >= y1 && py <= y2) {
          p2.set(px, py, pz);
          normal.set(0, 0, 1);
          return true;
        }
      }

      // Le côté x1 en premier
      if (p1.x <= x1 && p2.x > x1) {
        percent = Math.abs(x1 - p1.x) / Math.abs(p2.x - p1.x);
        px = p1.x + (p2.x - p1.x) * percent;
        py = p1.y + (p2.y - p1.y) * percent;
        pz = p1.z + (p2.z - p1.z) * percent;
        if (py <= y2 && py >= y1 && pz < height) {
          p2.set(px, py, pz);
          normal.set(-1, 0, 0);
          return true;
        }
      }

      // Le côté opposé
      if (p1.x >= x2 && p2.x < x2) {
        percent = Math.abs(p1.x - x2) / Math.abs(p2.x - p1.x);
        px = p1.x + (p2.x - p1.x) * percent;
        py = p1.y + (p2.y - p1.y) * percent;
        pz = p1.z + (p2.z - p1.z) * percent;
        if (py <= y2 && py >= y1 && pz < height) {
          p2.set(px, py, pz);
          normal.set(1, 0, 0);
          return true;
        }
      }

      // Le côté y1
      if (p1.y <= y1 && p2.y > y1) {
        percent = Math.abs(y1 - p1.y) / Math.abs(p2.y - p1.y);
        px = p1.x + (p2.x - p1.x) * percent;
        py = p1.y + (p2.y - p1.y) * percent;
        pz = p1.z + (p2.z - p1.z) * percent;
        if (px <= x2 && px >= x1 && pz < height) {
          p2.set(px, py, pz);
          normal.set(0, -1, 0);
          return true;
        }
      }

      // Le côté opposé
      if (p1.y >= y2 && p2.y < y2) {
        percent = Math.abs(p1.y - y2) / Math.abs(p2.y - p1.y);
        px = p1.x + (p2.x - p1.x) * percent;
        py = p1.y + (p2.y - p1.y) * percent;
        pz = p1.z + (p2.z - p1.z) * percent;
        if (px <= x2 && px >= x1 && pz < height) {
          p2.set(px, py, pz);
          normal.set(0, 1, 0);
          return true;
        }
      }
    }
    return false;
  }

  // -------------------------------------------------------------------------------------------
  // Spawns / validity / minimap
  // -------------------------------------------------------------------------------------------

  /**
   * Spawn positions used by Game::spawnPlayer (GameSpawn.cpp) for DM, TDM and CTF: the map's
   * dm_spawns with z forced to .25 (babo radius). Team spawns (blue/red) are only used by S&D.
   *
   * The selection rule itself (game rules, not implemented here): for each candidate compute the
   * squared distance to the nearest *alive* other player (DM: everybody; TDM/CTF: enemies only)
   * and keep the candidate with the largest value (strictly greater, starting from score 0; the
   * "nearest" starts at 100000). If there is no such player, pick `rand() % count` instead.
   * Then `map->setCameraPos(spawnPos)`.
   */
  getDmSpawnCandidates(): Vec3[] {
    return this.dmSpawns.map((s) => new Vec3(s.x, s.y, 0.25));
  }

  /** Port of Map::regenTex (minimap texture: walls white, floor black, power-of-two sized). */
  buildMinimapData(): MinimapData {
    const [sw, sh] = this.size;
    let width = 1;
    while (width < sw) width *= 2;
    let height = 1;
    while (height < sh) height *= 2;
    const texMapSize: [number, number] = [width !== sw ? sw / width : 1, height !== sh ? sh / height : 1];
    const data = new Uint8Array(width * height * 3);
    for (let j = 0; j < sh; ++j) {
      for (let i = 0; i < sw; ++i) {
        if (!this.cells[j * sw + i]!.passable) {
          const o = (j * width + i) * 3;
          data[o] = 255;
          data[o + 1] = 255;
          data[o + 2] = 255;
        }
      }
    }
    return { width, height, texMapSize, data };
  }
}

/**
 * Port of IsMapValid (Map.cpp): tells if a map has everything needed for a game type
 * (0 = DM, 1 = TDM, 2 = CTF, 3 = SND, the GAME_TYPE_* values of Game.h).
 */
export function isMapValid(map: GameMap, gameType: number): boolean {
  const isZero = (v: Vec3): boolean => v.x === 0 && v.y === 0 && v.z === 0;
  switch (gameType) {
    case GAME_TYPE_DM:
    case GAME_TYPE_TDM:
      return map.dmSpawns.length >= 1;
    case GAME_TYPE_CTF:
      return map.dmSpawns.length >= 1 && !isZero(map.flagPodPos[0]) && !isZero(map.flagPodPos[1]);
    case GAME_TYPE_SND:
      return (
        map.blueSpawns.length >= 1 &&
        map.redSpawns.length >= 1 &&
        !isZero(map.objective[0]) &&
        !isZero(map.objective[1])
      );
    default:
      return true;
  }
}

/** URL of a map shipped with the game assets. */
export function mapUrl(name: string): string {
  return `/assets/maps/${name}.bvm`;
}

/**
 * Fetches and parses a map (browser, or Node >= 18 with an absolute URL).
 * `url` may also be a bare map name ("DM-Arena"), resolved with mapUrl().
 */
export async function loadMap(url: string, opts: MapLoadOptions = {}): Promise<GameMap> {
  const isBareName = !url.includes('/') && !url.toLowerCase().endsWith('.bvm');
  const fullUrl = isBareName ? mapUrl(url) : url;
  const res = await fetch(fullUrl);
  if (!res.ok) throw new Error(`loadMap: ${fullUrl}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const base = fullUrl.split('?')[0]!.split('/').pop() ?? fullUrl;
  const name = decodeURIComponent(base.replace(/\.bvm$/i, ''));
  return GameMap.parse(buf, name, opts);
}
