// Network protocol between the browser clients and the Node game server (JSON over WebSocket).
//
// It follows the original game's split: each client sends its own babo's coordinates (every
// sv_minSendInterval = 2 frames) and asks the server to shoot / throw / use its secondary weapon;
// the server decides hits, damage, projectiles, items and scores and sends the results.
import { GAME_TYPE_CTF, GAME_TYPE_DM, GAME_TYPE_TDM } from '../sim/constants';
import type { GameEvent } from '../sim/events';
import type { SkinInfo } from '../sim/player';
import { Vec3 } from '../sim/vec';

export const PROTOCOL_VERSION = 4;
/** The client sends its coordinates every 2 simulation frames (gameVar.sv_minSendInterval). */
export const CF_SEND_INTERVAL = 2;
/** The server sends the players' state every 2 frames (15 Hz); events go out every frame. */
export const SNAPSHOT_INTERVAL = 2;
export const WS_PATH = '/ws';

/** The server runs one room per game mode; the start screen lets the player choose one. */
export const ROOM_MODES = ['dm', 'tdm', 'ctf'] as const;
export type RoomMode = (typeof ROOM_MODES)[number];
export const ROOM_GAME_TYPE: Record<RoomMode, number> = { dm: GAME_TYPE_DM, tdm: GAME_TYPE_TDM, ctf: GAME_TYPE_CTF };
/** WebSocket path of a room ("/ws" alone is the Deathmatch room). */
export const roomPath = (mode: RoomMode): string => `${WS_PATH}/${mode}`;

/** A room in /health: what the start screen shows for each mode. */
export interface RoomStatus {
  map: string;
  players: number;
  maxPlayers: number;
}
export const MAX_MESSAGE_BYTES = 8192;
export const MAX_CHAT_LENGTH = 100;
export const MAX_NAME_LENGTH = 31;

export type V3 = [number, number, number];
export type V2 = [number, number];

// --------------------------------------------------------------------------- client -> server

export type ClientMessage =
  | { t: 'hello'; v: number; name: string; skin: SkinInfo }
  /** Our babo's coordinate frame (NET_CLSV_SVCL_PLAYER_COORD_FRAME). z = camera height (sniper). */
  | { t: 'cf'; f: number; p: V3; v: V3; m: V2; z: number }
  /** A shot traced by the client: b = bullets, each [endX, endY, endZ, ...IDs of the babos it touched]. */
  | { t: 'shoot'; o: V3; n: number; w: number; b: number[][] }
  | { t: 'proj'; k: number; o: V3; d: V3; n: number; w: number }
  | { t: 'melee' }
  | { t: 'pickup' }
  | { t: 'spawn'; w: number; m: number }
  | { t: 'snd'; id: number; p: V3 }
  | { t: 'chat'; text: string }
  | { t: 'pong'; id: number };

// --------------------------------------------------------------------------- server -> client

export interface NetPlayerInfo {
  id: number;
  name: string;
  team: number;
  bot: boolean;
  skin: SkinInfo;
}

/**
 * [id, status, frameID, x, y, z, vx, vy, mx, my, life, weaponID, meleeID, flags, botX, botY]
 * flags: 1 = fired recently (minimap), 2 = has a nuke bot (botX/botY valid).
 */
export type NetPlayerState = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];

/** [uniqueID, x, y, z, vx, vy, vz, angle] */
export type NetProjectileState = [number, number, number, number, number, number, number, number];

/** Full projectile description, sent when it is created or when a client joins. */
export interface NetProjectile {
  id: number;
  k: number; // projectileType
  from: number;
  w: number; // weaponID (dropped weapons)
  p: V3;
  v: V3;
  a: number; // angle
  r: number; // rotateVel
}

export interface NetRules {
  timeToSpawn: number;
  scoreLimit: number;
  /** CTF captures to win (sv_winLimit). */
  winLimit: number;
  gameTimeLimit: number;
  enableMolotov: boolean;
  enableSecondary: boolean;
  forceRespawn: boolean;
}

/** [blueScore, redScore, blueWin, redWin] */
export type NetTeams = [number, number, number, number];

/** A CTF flag: [state (FLAG_ON_POD, FLAG_DROPPED or the carrier's id), x, y] */
export type NetFlag = [number, number, number];

/** A GameEvent with its vectors turned into arrays. */
export type NetEvent = Record<string, unknown> & { type: string };

export type ServerMessage =
  | {
      t: 'welcome';
      id: number;
      server: string;
      map: string;
      /** GAME_TYPE_DM, GAME_TYPE_TDM or GAME_TYPE_CTF. */
      gameType: number;
      frame: number;
      rules: NetRules;
      players: NetPlayerInfo[];
      projectiles: NetProjectile[];
      gt: number;
      rs: number;
      teams: NetTeams;
      flags: [NetFlag, NetFlag];
    }
  /** code: what the client says in its language; reason: the text for pages older than the codes. */
  | { t: 'reject'; code?: 'version' | 'full'; reason: string }
  /** Every frame: events; every SNAPSHOT_INTERVAL frames also the players (p), timer (gt) and round state (rs). */
  | { t: 'tick'; f: number; e?: NetEvent[]; pr?: NetProjectileState[]; p?: NetPlayerState[]; gt?: number; rs?: number }
  | { t: 'players'; list: NetPlayerInfo[] }
  /** s: [id, kills, deaths, score, dmg, pingFrames, returns]; ts: the team scores */
  | { t: 'scores'; s: [number, number, number, number, number, number, number][]; ts: NetTeams }
  /** rtt: the last round trip the server measured for this connection, in ms. */
  | { t: 'ping'; id: number; rtt: number };

// --------------------------------------------------------------------------- helpers

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function v3(v: Vec3): V3 {
  return [r3(v.x), r3(v.y), r3(v.z)];
}

export function fromV3(a: unknown): Vec3 | null {
  if (!Array.isArray(a) || a.length !== 3) return null;
  const [x, y, z] = a;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return new Vec3(x, y, z);
}

export function isNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** Event fields holding vectors (encoded as [x, y, z]). */
const VEC_FIELDS = new Set(['position', 'normal', 'p1', 'p2', 'origin', 'direction', 'launchPosition', 'launchVel']);

export function encodeEvent(e: GameEvent): NetEvent {
  const out: NetEvent = { type: e.type };
  for (const [k, val] of Object.entries(e)) {
    if (k === 'type') continue;
    out[k] = val instanceof Vec3 ? v3(val) : typeof val === 'number' ? r3(val) : val;
  }
  return out;
}

export function decodeEvent(n: NetEvent): GameEvent {
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(n)) out[k] = VEC_FIELDS.has(k) ? (fromV3(val) ?? new Vec3()) : val;
  return out as unknown as GameEvent;
}

/** Keeps the original colour codes (\x01..\x09) and printable characters. */
export function sanitizeText(text: unknown, maxLength: number): string {
  if (typeof text !== 'string') return '';
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if ((c >= 1 && c <= 9) || (c >= 32 && c !== 127)) out += ch;
    if (out.length >= maxLength) break;
  }
  return out.trim();
}

export function sanitizeSkin(skin: unknown): SkinInfo {
  const def: SkinInfo = { skin: 'skin10', redDecal: [0.5, 0.5, 1], greenDecal: [0, 0, 1], blueDecal: [0, 0, 0.5] };
  if (!skin || typeof skin !== 'object') return def;
  const s = skin as Record<string, unknown>;
  const col = (c: unknown, d: [number, number, number]): [number, number, number] =>
    Array.isArray(c) && c.length === 3 && c.every(isNum) ? (c.map((x: number) => Math.max(0, Math.min(1, x))) as [number, number, number]) : d;
  return {
    skin: typeof s.skin === 'string' && /^skin\d{2}$/.test(s.skin) && +s.skin.slice(4) >= 1 && +s.skin.slice(4) <= 23 ? s.skin : def.skin,
    redDecal: col(s.redDecal, def.redDecal),
    greenDecal: col(s.greenDecal, def.greenDecal),
    blueDecal: col(s.blueDecal, def.blueDecal),
  };
}
