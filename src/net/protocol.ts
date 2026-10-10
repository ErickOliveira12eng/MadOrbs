// Network protocol between the browser clients and the Node game server (WebSocket). The messages
// sent many times a second (the server's frame, the client's coordinates and shots) travel in binary
// (wire.ts); the others in JSON.
//
// It follows the original game's split: each client sends its own babo's coordinates (every
// sv_minSendInterval = 2 frames) and asks the server to shoot / throw / use its secondary weapon;
// the server decides hits, damage, projectiles, items and scores and sends the results.
import { GAME_TYPE_CTF, GAME_TYPE_DM, GAME_TYPE_TDM } from '../sim/constants';
import type { FeatCounts } from '../sim/feats';
import type { GameEvent } from '../sim/events';
import type { SkinInfo } from '../sim/player';
import { Vec3 } from '../sim/vec';

export const PROTOCOL_VERSION = 13;
/** The client sends its coordinates every 2 simulation frames (gameVar.sv_minSendInterval). */
export const CF_SEND_INTERVAL = 2;
/** The server sends the players' state every 2 frames (15 Hz); events go out every frame. */
export const SNAPSHOT_INTERVAL = 2;
export const WS_PATH = '/ws';

/** The game modes of the online rooms (several rooms per mode); the start screen picks the mode. */
export const ROOM_MODES = ['dm', 'tdm', 'ctf'] as const;
export type RoomMode = (typeof ROOM_MODES)[number];
export const ROOM_GAME_TYPE: Record<RoomMode, number> = { dm: GAME_TYPE_DM, tdm: GAME_TYPE_TDM, ctf: GAME_TYPE_CTF };
/** WebSocket path of a room ("/ws" alone is the Deathmatch room). */
export const roomPath = (mode: RoomMode): string => `${WS_PATH}/${mode}`;

// --------------------------------------------------------------------------- private rooms
//
// A room made by a signed-in player for their friends (anybody can join it): the matchmaking never
// sends anybody there, the link (/r/<code>) or the code does. It begins with a warm-up (nobody's score counts) until its host
// starts the match; its matches never count for the ranking or the stats. Created with
// POST /api/rooms, described by GET /api/rooms/<code>, joined at /ws/room/<code>.

/** The codes' letters: no look-alikes (0/O, 1/I/L), like the player IDs. */
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 6;
export const isRoomCode = (s: unknown): s is string => typeof s === 'string' && new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`).test(s);
/** WebSocket path of a private room. */
export const privateRoomPath = (code: string): string => `${WS_PATH}/room/${code}`;
/** The page that joins a private room (the invitation link), in a language folder or at the root. */
export const ROOM_LINK_RE = /^\/(?:(pt|es)\/)?r\/([A-Za-z0-9]{4,12})\/?$/;

/** What a private room can be set to (the choices of the start screen's window). */
export const PRIVATE_CHOICES = {
  /** Frags to win (a player in DM, a team in TDM); 0: no limit. */
  kills: [10, 20, 30, 50, 100, 0],
  /** CTF captures to win; 0: no limit. */
  captures: [3, 5, 7, 10, 0],
  /** Minutes per match; 0: no limit. */
  minutes: [5, 10, 15, 20, 30, 0],
  players: [2, 4, 6, 8, 10, 12, 16],
} as const;

/** The private room asked for (POST /api/rooms). map '': the mode's rotation. */
export interface PrivateRoomSettings {
  mode: RoomMode;
  map: string;
  /** Kills in DM / TDM, captures in CTF; 0: no limit. */
  scoreLimit: number;
  /** Minutes; 0: no limit (not both). */
  timeLimit: number;
  maxPlayers: number;
}

/**
 * POST /api/rooms (with the account's session: "Authorization: Bearer <token>"): the code, and the key
 * that makes its holder the host (kept in that browser). 'signin': only a signed-in player makes rooms.
 */
export type CreateRoomAnswer = { code: string; key: string } | { error: 'full' | 'limit' | 'bad' | 'signin' };

/** GET /api/rooms/mine (with the session): the account's private rooms open now, with their keys. */
export type MyRoom = PrivateRoomInfo & { key: string };

/** GET /api/rooms/<code>: the room as the invitation shows it. */
export interface PrivateRoomInfo {
  code: string;
  mode: RoomMode;
  map: string;
  players: number;
  maxPlayers: number;
  locked: boolean;
  /** The host's name ('' while nobody is in). */
  host: string;
  warmup: boolean;
}

/** A private room as its players see it (welcome, 'room'). */
export interface NetRoom {
  code: string;
  /** The host's player ID (-1: nobody yet). */
  host: number;
  /** Before the host starts the match: nobody's score counts, no limits. */
  warmup: boolean;
  /** Nobody else can come in. */
  locked: boolean;
  maxPlayers: number;
  /** The limits of the matches (the rules carry 0 during the warm-up). */
  scoreLimit: number;
  timeLimit: number;
  /** Every map the host can switch to. */
  maps: string[];
}

/** What the host of a private room can do. */
export const HOST_ACTIONS = ['start', 'restart', 'map', 'lock', 'unlock', 'kick', 'team', 'shuffle'] as const;
export type HostAction = (typeof HOST_ACTIONS)[number];

/**
 * A mode in /health: what the start screen shows. players: everybody playing the mode; maxPlayers:
 * the players plus every free seat of the server (no seat left: full); map: of the room you'd join.
 */
export interface RoomStatus {
  map: string;
  players: number;
  maxPlayers: number;
  /** How many rooms of the mode are open. */
  rooms?: number;
}
export const MAX_MESSAGE_BYTES = 8192;
export const MAX_CHAT_LENGTH = 100;
export const MAX_NAME_LENGTH = 31;

export type V3 = [number, number, number];
export type V2 = [number, number];

// --------------------------------------------------------------------------- client -> server

export type ClientMessage =
  /** token: the Supabase session of a signed-in player (its player ID is shown, its stats are kept). */
  | { t: 'hello'; v: number; name: string; skin: SkinInfo; token?: string; key?: string }
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
  /** The end-of-match map vote: index of the chosen map in the vote's list. */
  | { t: 'vote'; i: number }
  /** A private room's host: id = a player (kick, team), team = PLAYER_TEAM_BLUE / RED, map = a map name. */
  | { t: 'host'; a: HostAction; id?: number; team?: number; map?: string }
  | { t: 'pong'; id: number };

// --------------------------------------------------------------------------- server -> client

export interface NetPlayerInfo {
  id: number;
  name: string;
  team: number;
  bot: boolean;
  skin: SkinInfo;
  /** Player ID shown next to the name: the account's ("K7Q2MX") or a guest's ("ANON-7Q2M"). */
  tag?: string;
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

/** The end-of-match map vote: the maps offered and how many votes each has. */
export interface NetVote {
  maps: string[];
  counts: number[];
}

/** How many maps the end-of-match vote offers. */
export const VOTE_CHOICES = 3;

/** [id, kills, deaths, score, dmg, pingFrames, returns, ...the feat counts (src/sim/feats.ts FeatCounts)] */
export type NetScore = [number, number, number, number, number, number, number, ...FeatCounts];

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
      /** The map vote, when joining during one. */
      vote?: NetVote;
      /** A private room (else a public one). */
      room?: NetRoom;
    }
  /**
   * code: what the client says in its language; reason: the text for pages older than the codes.
   * 'banned': the account or the address is blocked, until that time (ms since 1970; none: for good).
   * Private rooms: 'noroom' (closed or never was), 'locked' (by its host), 'kicked' (by its host).
   */
  | { t: 'reject'; code?: 'version' | 'full' | 'banned' | 'noroom' | 'locked' | 'kicked'; reason: string; until?: number }
  /** Every frame: events; every SNAPSHOT_INTERVAL frames also the players (p), timer (gt) and round state (rs). */
  | { t: 'tick'; f: number; e?: NetEvent[]; pr?: NetProjectileState[]; p?: NetPlayerState[]; gt?: number; rs?: number }
  | { t: 'players'; list: NetPlayerInfo[] }
  /** A private room changed (host, warm-up, lock); rules: the match's new rules (the warm-up ended). */
  | { t: 'room'; room: NetRoom; rules?: NetRules }
  /** The end-of-match map vote opened or its counts changed (the next mapChange closes it). */
  | ({ t: 'vote' } & NetVote)
  /** s: one NetScore per player; ts: the team scores */
  | { t: 'scores'; s: NetScore[]; ts: NetTeams }
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
