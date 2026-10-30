// What the player chose on the start screen, remembered in this browser.
import { audio } from '../client/audio/audio';
import { ROOM_MODES, cleanName, isReservedName, type RoomMode } from '../net/protocol';
import type { SkinInfo } from '../sim/player';
import { loadWavesRecord } from '../client/waves';
import { WAVES_SKINS, skinUnlocked, skinWave } from '../client/wavesProgress';
import { SKIN_COUNT } from '../net/protocol';
import { CROWN_TIERS, CROWN_WAVES, isCrownTier, type CrownTier } from '../sim/crowns';

const KEY = 'madorbs.settings';

/** Every Orb style: the original game's 23, then Mad Orbs' own (the waves' exclusive ones, skin24..26, the 8 ball, the camo). */
export const SKINS = Array.from({ length: SKIN_COUNT }, (_, i) => `skin${String(i + 1).padStart(2, '0')}`);
/** The styles anyone can pick, and the bots wear (the waves' milestones give the others). */
export const FREE_SKINS = SKINS.filter((s) => !WAVES_SKINS.includes(s));
/**
 * The order the Orb picker and the pedestal's arrows go through them (Erick, 30/10/2026): the free ones, then the waves'
 * in the order they are won, so the open ones come first and the locked ones after, the next to win at their head.
 */
export const SKIN_ORDER = [...FREE_SKINS, ...[...WAVES_SKINS].sort((a, b) => skinWave(a)! - skinWave(b)!)];

/** The testers' switch (the account window, DEBUG_USER_IDS accounts): every style and crown open, to try them. */
let testUnlock = false;
export function setTestUnlock(on: boolean): void {
  testUnlock = on;
}

/** The styles this player can pick: the free ones and the ones won in the waves. */
export function availableSkins(): string[] {
  const record = loadWavesRecord()?.wave ?? 0;
  return SKIN_ORDER.filter((s) => testUnlock || skinUnlocked(s, record));
}

/** The crowns this player has won (src/sim/crowns.ts), by this browser's record. */
export function availableCrowns(): CrownTier[] {
  const record = loadWavesRecord()?.wave ?? 0;
  return CROWN_TIERS.filter((c) => testUnlock || record >= CROWN_WAVES[c]);
}

/** The crown worn: the one chosen if won, the best won on 'auto' (a new one is worn at once), none on 'none'. */
export function wornCrown(s: Settings): CrownTier | null {
  const open = availableCrowns();
  if (s.crown === 'none') return null;
  if (s.crown !== 'auto' && open.includes(s.crown)) return s.crown;
  return open[open.length - 1] ?? null;
}

export interface Settings {
  name: string;
  /** skin01..skin28 */
  skin: string;
  /** The Survival crown: the best won ('auto'), one of them, or none. */
  crown: 'auto' | 'none' | CrownTier;
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
  crown: 'auto',
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

/** A random style in one vivid colour: a lighter, the colour itself and a darker shade. */
export function randomOrb(): Pick<Settings, 'skin' | 'red' | 'green' | 'blue'> {
  const hue = Math.random() * 360;
  return {
    skin: FREE_SKINS[Math.floor(Math.random() * FREE_SKINS.length)],
    red: hslHex(hue, 0.9, 0.75),
    green: hslHex(hue, 0.85, 0.5),
    blue: hslHex(hue, 0.9, 0.25),
  };
}

function hslHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function loadSettings(): Settings {
  const s = { ...DEFAULT_SETTINGS };
  try {
    const saved = localStorage.getItem(KEY);
    // First visit: a random Orb (otherwise every new player is the same blue one), kept from now on
    if (saved === null) {
      Object.assign(s, randomOrb());
      saveSettings(s);
      return s;
    }
    const raw = JSON.parse(saved) as Record<string, unknown>;
    // The name's rules (src/net/protocol.ts): saved before them, it may need cleaning
    if (typeof raw.name === 'string') {
      const name = cleanName(raw.name);
      s.name = isReservedName(name) ? '' : name;
    }
    if (typeof raw.skin === 'string' && SKINS.includes(raw.skin)) s.skin = raw.skin;
    if (raw.crown === 'auto' || raw.crown === 'none' || isCrownTier(raw.crown)) s.crown = raw.crown;
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
