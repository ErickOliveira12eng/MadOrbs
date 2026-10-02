// What the player chose on the start screen, remembered in this browser.
import { audio } from '../client/audio/audio';
import { ROOM_MODES, type RoomMode } from '../net/protocol';
import type { SkinInfo } from '../sim/player';

const KEY = 'madorbs.settings';

export const SKINS = Array.from({ length: 23 }, (_, i) => `skin${String(i + 1).padStart(2, '0')}`);

export interface Settings {
  name: string;
  /** skin01..skin23 */
  skin: string;
  /** The skin's three decal colours (#rrggbb). */
  red: string;
  green: string;
  blue: string;
  /** Game mode, online and in the training. */
  mode: RoomMode;
  // Offline training: the map of Deathmatch / Team Deathmatch, and the one of Capture the Flag
  map: string;
  ctfMap: string;
  bots: number;
  skill: number;
  /** Every sound off (the panel's main switch); the channels keep their own volume and mute. */
  muted: boolean;
  // Sound, 0..100
  music: number;
  sfx: number;
  /** The map's sounds: rain, wind, lava. */
  ambient: number;
  musicMuted: boolean;
  sfxMuted: boolean;
  ambientMuted: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  skin: 'skin10',
  // cl_redDecal (.5,.5,1), cl_greenDecal (0,0,1), cl_blueDecal (0,0,.5)
  red: '#8080ff',
  green: '#0000ff',
  blue: '#000080',
  mode: 'dm',
  map: 'DM-Arena',
  ctfMap: 'CTF-Fort',
  bots: 5,
  skill: 0.5,
  muted: false,
  music: 70,
  sfx: 90,
  // The rain of the original was loud against everything else
  ambient: 50,
  musicMuted: false,
  sfxMuted: false,
  ambientMuted: false,
};

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function loadSettings(): Settings {
  const s = { ...DEFAULT_SETTINGS };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    if (typeof raw.name === 'string') s.name = raw.name.slice(0, 31);
    if (typeof raw.skin === 'string' && SKINS.includes(raw.skin)) s.skin = raw.skin;
    if (isHex(raw.red)) s.red = raw.red;
    if (isHex(raw.green)) s.green = raw.green;
    if (isHex(raw.blue)) s.blue = raw.blue;
    if (typeof raw.mode === 'string' && (ROOM_MODES as readonly string[]).includes(raw.mode)) s.mode = raw.mode as RoomMode;
    if (typeof raw.map === 'string') s.map = raw.map;
    if (typeof raw.ctfMap === 'string') s.ctfMap = raw.ctfMap;
    if (isNum(raw.bots)) s.bots = Math.max(0, Math.min(15, Math.round(raw.bots)));
    if (isNum(raw.skill)) s.skill = raw.skill;
    if (isNum(raw.music)) s.music = Math.max(0, Math.min(100, raw.music));
    if (isNum(raw.sfx)) s.sfx = Math.max(0, Math.min(100, raw.sfx));
    if (isNum(raw.ambient)) s.ambient = Math.max(0, Math.min(100, raw.ambient));
    if (typeof raw.musicMuted === 'boolean') s.musicMuted = raw.musicMuted;
    if (typeof raw.sfxMuted === 'boolean') s.sfxMuted = raw.sfxMuted;
    if (typeof raw.ambientMuted === 'boolean') s.ambientMuted = raw.ambientMuted;
    if (typeof raw.muted === 'boolean') s.muted = raw.muted;
    else if (s.musicMuted && s.sfxMuted && s.ambientMuted) {
      // Saved before the main switch existed, when "all off" muted the three channels
      s.muted = true;
      s.musicMuted = s.sfxMuted = s.ambientMuted = false;
    }
    if (s.name === 'Unnamed Babo') s.name = '';
  } catch {
    /* storage unavailable or corrupt: defaults */
  }
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function skinInfo(s: Pick<Settings, 'skin' | 'red' | 'green' | 'blue'>): SkinInfo {
  return { skin: s.skin, redDecal: hexToRgb(s.red), greenDecal: hexToRgb(s.green), blueDecal: hexToRgb(s.blue) };
}

/** Slider positions feel linear when the gain follows their square. */
export function applyAudioSettings(s: Settings): void {
  audio.setVolumes({
    muted: s.muted,
    music: (s.music / 100) ** 2,
    sfx: (s.sfx / 100) ** 2,
    ambient: (s.ambient / 100) ** 2,
    musicMuted: s.musicMuted,
    sfxMuted: s.sfxMuted,
    ambientMuted: s.ambientMuted,
  });
}
