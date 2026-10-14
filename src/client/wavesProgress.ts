// The waves mode's progress that outlives a run (a roguelite): Cores earned in every run (the waves
// survived, the kills, the bosses, a new record), spent in the Workshop on permanent upgrades; the
// milestones of the record (starting weapons, exclusive Orbs) and the checkpoints to start from.
// Kept in this browser (madorbs.wavesProgress) and, signed in, in the account (waves_progress).
import { WEAPON_BAZOOKA, WEAPON_CHAIN_GUN, WEAPON_FLAME_THROWER, WEAPON_SHOTGUN, WEAPON_SMG } from '../sim/constants';

export type UpgradeID = 'life' | 'armor' | 'damage' | 'fire' | 'speed' | 'lives' | 'grenades' | 'luck' | 'drops' | 'breather' | 'secondWind' | 'cap' | 'dash' | 'barrier' | 'shock';

/** The Workshop's kinds of upgrade (its list, src/menu/wavesModal.ts): the last two are in the other tab. */
export type UpgradeGroup = 'attack' | 'defense' | 'survival' | 'abilities' | 'limits';

export interface Upgrade {
  id: UpgradeID;
  /** The price of each level (its length is the top level). */
  costs: number[];
  /** Its kind, in the Workshop's list. */
  group: UpgradeGroup;
}

/** The Workshop's upgrades, in the order of its list. */
export const UPGRADES: Upgrade[] = [
  { id: 'damage', costs: [80, 150, 250, 400, 600], group: 'attack' },
  { id: 'fire', costs: [80, 150, 250, 400, 600], group: 'attack' },
  { id: 'grenades', costs: [100, 220, 400], group: 'attack' },
  { id: 'life', costs: [60, 120, 200, 320, 500], group: 'defense' },
  { id: 'armor', costs: [80, 150, 250, 400, 600], group: 'defense' },
  { id: 'lives', costs: [300, 600], group: 'defense' },
  { id: 'secondWind', costs: [1500], group: 'defense' },
  { id: 'speed', costs: [50, 100, 180, 280, 400], group: 'survival' },
  { id: 'luck', costs: [70, 140, 240, 360, 520], group: 'survival' },
  { id: 'drops', costs: [60, 120, 200, 300, 450], group: 'survival' },
  { id: 'breather', costs: [180, 350, 600], group: 'survival' },
  // Only the Workshop gives these (Erick, 12/10/2026: its numbers got lost among the run's power-ups)
  { id: 'dash', costs: [200, 350, 550, 800, 1100], group: 'abilities' },
  { id: 'barrier', costs: [250, 400, 600, 850, 1200], group: 'abilities' },
  { id: 'shock', costs: [300, 500, 750, 1050, 1400], group: 'abilities' },
  { id: 'cap', costs: [150, 300, 500, 800, 1200, 1800, 2600, 3600], group: 'limits' },
];

/**
 * What a level does: life +10% (the damage taken shrinks as if the life were bigger), defence 4% less
 * damage taken, damage and fire rate +5%, speed +4%, one more life, one more grenade at each spawn,
 * +10% chance that a crate drops a permanent power-up, +5 points on the chance a fallen bot drops a
 * life pack (WAVES.lifePackChance), life back between waves (20%, 35%, 50%), and once a run a blow
 * that would kill leaves half the life.
 */
export const UPGRADE_STEP = { life: 0.1, armor: 0.04, damage: 0.05, fire: 0.05, speed: 0.04, luck: 0.1, drops: 0.05 };
export const BREATHER = [0, 0.2, 0.35, 0.5];
export const SECOND_WIND_LIFE = 0.5;

export type Levels = Record<UpgradeID, number>;

export const NO_LEVELS: Levels = { life: 0, armor: 0, damage: 0, fire: 0, speed: 0, lives: 0, grenades: 0, luck: 0, drops: 0, breather: 0, secondWind: 0, cap: 0, dash: 0, barrier: 0, shock: 0 };

/**
 * What only the Workshop gives. The run's limits: each permanent power-up of a run stops at
 * PERM_CAP_BASE levels, PERM_CAP_STEP more a level of 'cap' (5 up to 21). The abilities: a dash (Shift)
 * and a shock wave (Q), their cooldowns (seconds) by level; a recharging shield that takes this share of
 * a life before the life does (Player.barrier).
 */
export const PERM_CAP_BASE = 5;
export const PERM_CAP_STEP = 2;
export const DASH_COOLDOWN = [0, 6, 5, 4, 3, 2.2];
export const SHOCK_COOLDOWN = [0, 20, 16, 13, 10, 8];
export const BARRIER_SIZE = [0, 0.15, 0.25, 0.35, 0.45, 0.6];
export const SHOCK = { radius: 3.5, damage: 1.2, push: 7 };

// ------------------------------------------------------------------ milestones and checkpoints

export type Milestone = { wave: number; weapon: number } | { wave: number; skin: string };

/** Reach the wave once and the prize stays: a weapon to start with, or an Orb only won here. */
export const MILESTONES: Milestone[] = [
  { wave: 10, weapon: WEAPON_SHOTGUN },
  { wave: 15, skin: 'skin24' },
  { wave: 20, weapon: WEAPON_CHAIN_GUN },
  { wave: 25, skin: 'skin25' },
  { wave: 30, weapon: WEAPON_BAZOOKA },
  { wave: 40, weapon: WEAPON_FLAME_THROWER },
  { wave: 50, skin: 'skin26' },
];

/** The Orbs only the waves give (src/menu/settings.ts keeps them out of the others' reach). */
export const WAVES_SKINS = MILESTONES.flatMap((m) => ('skin' in m ? [m.skin] : []));

/** The weapons to start a run with, the SMG and those of the milestones reached. */
export function startWeapons(record: number): number[] {
  return [WEAPON_SMG, ...MILESTONES.flatMap((m) => ('weapon' in m && record >= m.wave ? [m.weapon] : []))];
}

/** Whether an exclusive Orb was won (any other skin: always). */
export function skinUnlocked(skin: string, record: number): boolean {
  const m = MILESTONES.find((x) => 'skin' in x && x.skin === skin);
  return !m || record >= m.wave;
}

/** The wave that gives an exclusive Orb, or null for the others. */
export function skinWave(skin: string): number | null {
  return MILESTONES.find((x) => 'skin' in x && x.skin === skin)?.wave ?? null;
}

/** The next milestone above the record, or null when all were reached. */
export function nextMilestone(record: number): Milestone | null {
  return MILESTONES.find((m) => m.wave > record) ?? null;
}

/**
 * Every CHECKPOINT waves a run can start from, once the record is CHECKPOINT waves past it: wave 20 opens
 * wave 10, wave 30 opens wave 20 (Erick, 12/10/2026: starting right on the wave reached was too hard).
 */
export const CHECKPOINT = 10;

/** The waves a run can start from: the first, and each checkpoint the record went far enough past. */
export function checkpoints(record: number): number[] {
  const out = [1];
  for (let w = CHECKPOINT; w + CHECKPOINT <= record; w += CHECKPOINT) out.push(w);
  return out;
}

/** A run started further on gets a permanent power-up of the run for every two waves skipped. */
export function headStartPowers(startWave: number): number {
  return Math.floor((startWave - 1) / 2);
}

// ------------------------------------------------------------------ Cores of a run

/**
 * A wave survived (the next one began): 3 Cores plus one for every two waves of its number, times
 * WAVE_CORES_SCALE: 5 for the first, 13 for the 10th, 21 for the 20th. Raised twice at Erick's asking: 30% more
 * on 12/10/2026 (1.3), and on 14/10/2026 about 23% more on a whole run (1.6, a Core every 4 kills instead of 5,
 * 30 for a boss instead of 25): waves 1 to 10 give 136 instead of 111, 1 to 20 380 instead of 310, 1 to 30 738
 * instead of 601 (every enemy killed, no record).
 */
export const WAVE_CORES_SCALE = 1.6;
export const waveCores = (n: number): number => Math.round(WAVE_CORES_SCALE * (3 + Math.floor(n / 2)));
export const KILLS_PER_CORE = 4;
export const BOSS_CORES = 30;
export const RECORD_CORES = 30;

export interface RunCores {
  /** Waves survived in the run (from the one it began on), and their Cores. */
  waves: number;
  waveCores: number;
  kills: number;
  killCores: number;
  bosses: number;
  bossCores: number;
  /** The run beat the record. */
  recordCores: number;
  total: number;
}

/** What a run earns: it began on `startWave`, ended on `wave` (the one being fought). */
export function runCores(startWave: number, wave: number, kills: number, bosses: number, isBest: boolean): RunCores {
  let wc = 0;
  for (let n = startWave; n < wave; n++) wc += waveCores(n);
  const killCores = Math.floor(Math.max(0, kills) / KILLS_PER_CORE);
  const bossCores = bosses * BOSS_CORES;
  const recordCores = isBest ? RECORD_CORES : 0;
  return {
    waves: Math.max(0, wave - startWave),
    waveCores: wc,
    kills,
    killCores,
    bosses,
    bossCores,
    recordCores,
    total: wc + killCores + bossCores + recordCores,
  };
}

// ------------------------------------------------------------------ saved progress

const KEY = 'madorbs.wavesProgress';

export interface WavesProgress {
  /** Every Core ever earned; the balance is what the levels bought didn't spend. */
  earned: number;
  levels: Levels;
  /** The Workshop's last choices: the wave to start from, the weapon. */
  startWave: number;
  startWeapon: number;
  /** The daily reward: the day it was last taken (YYYY-MM-DD, this computer's date) and the days in a row. */
  daily: { last: string; streak: number };
}

const MAX_CORES = 100_000_000;

/** The levels' cost: every level bought, at its price. */
export function spent(levels: Levels): number {
  let s = 0;
  for (const u of UPGRADES) for (let i = 0; i < Math.min(levels[u.id], u.costs.length); i++) s += u.costs[i];
  return s;
}

/** Cores to spend (never below zero: two devices may have spent the same ones before syncing). */
export function balance(p: WavesProgress): number {
  return Math.max(0, p.earned - spent(p.levels));
}

/** Levels from anything (storage, the account): known upgrades, whole numbers within their range. */
export function cleanLevels(raw: unknown): Levels {
  const out = { ...NO_LEVELS };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const u of UPGRADES) {
    const v = r[u.id];
    if (typeof v === 'number' && Number.isFinite(v)) out[u.id] = Math.max(0, Math.min(u.costs.length, Math.floor(v)));
  }
  return out;
}

export function loadProgress(): WavesProgress {
  const p: WavesProgress = { earned: 0, levels: { ...NO_LEVELS }, startWave: 1, startWeapon: WEAPON_SMG, daily: { last: '', streak: 0 } };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<string, unknown> | null;
    if (!raw) return p;
    if (typeof raw.earned === 'number' && Number.isFinite(raw.earned)) p.earned = Math.max(0, Math.min(MAX_CORES, Math.floor(raw.earned)));
    p.levels = cleanLevels(raw.levels);
    if (typeof raw.startWave === 'number' && Number.isInteger(raw.startWave)) p.startWave = raw.startWave;
    if (typeof raw.startWeapon === 'number' && Number.isInteger(raw.startWeapon)) p.startWeapon = raw.startWeapon;
    const d = raw.daily as { last?: unknown; streak?: unknown } | undefined;
    if (d && typeof d.last === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.last) && typeof d.streak === 'number' && Number.isInteger(d.streak))
      p.daily = { last: d.last, streak: Math.max(0, Math.min(10000, d.streak)) };
  } catch {
    /* storage unavailable or corrupt: a fresh start */
  }
  return p;
}

export function saveProgress(p: WavesProgress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: the progress lasts for this page */
  }
}

// ------------------------------------------------------------------ the daily reward

/**
 * Cores for coming back each day (in the Workshop): more each day in a row, up to the 7th, then the
 * week starts again; a day missed starts it over.
 */
export const DAILY_CORES = [30, 40, 50, 60, 80, 100, 150];

/** A date as YYYY-MM-DD, by this computer's clock (the reward turns at its midnight). */
function dayOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface DailyState {
  /** Today's reward is still there to take. */
  ready: boolean;
  /** The day of the week of rewards: the one to take now, or the one taken today (1..7). */
  day: number;
  cores: number;
}

export function dailyState(p: WavesProgress, now = new Date()): DailyState {
  const today = dayOf(now);
  if (p.daily.last === today) {
    const day = ((p.daily.streak - 1) % DAILY_CORES.length) + 1;
    return { ready: false, day, cores: DAILY_CORES[day - 1] };
  }
  const yesterday = dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const streak = p.daily.last === yesterday ? p.daily.streak + 1 : 1;
  const day = ((streak - 1) % DAILY_CORES.length) + 1;
  return { ready: true, day, cores: DAILY_CORES[day - 1] };
}

/** Takes today's reward; null when it was already taken. */
export function claimDaily(now = new Date()): { progress: WavesProgress; day: number; cores: number } | null {
  const p = loadProgress();
  const state = dailyState(p, now);
  if (!state.ready) return null;
  const yesterday = dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  p.daily = { last: dayOf(now), streak: p.daily.last === yesterday ? p.daily.streak + 1 : 1 };
  p.earned = Math.min(MAX_CORES, p.earned + state.cores);
  saveProgress(p);
  return { progress: p, day: state.day, cores: state.cores };
}

/** Adds a run's Cores; returns the new progress. */
export function addCores(n: number): WavesProgress {
  const p = loadProgress();
  p.earned = Math.min(MAX_CORES, p.earned + Math.max(0, Math.floor(n)));
  saveProgress(p);
  return p;
}

/** The price of an upgrade's next level, or null at the top. */
export function nextCost(u: Upgrade, levels: Levels): number | null {
  return levels[u.id] < u.costs.length ? u.costs[levels[u.id]] : null;
}

/** Buys an upgrade's next level when the Cores reach; returns the new progress, or null. */
export function buy(id: UpgradeID): WavesProgress | null {
  const p = loadProgress();
  const u = UPGRADES.find((x) => x.id === id);
  const cost = u ? nextCost(u, p.levels) : null;
  if (!u || cost === null || balance(p) < cost) return null;
  p.levels[id]++;
  saveProgress(p);
  return p;
}

/** How many upgrades the balance pays for right now (one level each): the menu's badge. */
export function affordable(p: WavesProgress): number {
  const b = balance(p);
  return UPGRADES.filter((u) => {
    const c = nextCost(u, p.levels);
    return c !== null && c <= b;
  }).length;
}

/**
 * The account's progress merged into this browser's: the most Cores ever earned, the highest level
 * of each upgrade. Saved here; returned to be sent to the account when it has more than it.
 */
export function mergeProgress(remote: { earned: number; levels: Levels } | null): { merged: WavesProgress; upload: boolean } {
  const local = loadProgress();
  if (!remote) return { merged: local, upload: local.earned > 0 || spent(local.levels) > 0 };
  const merged: WavesProgress = { ...local, earned: Math.max(local.earned, remote.earned), levels: { ...local.levels } };
  let upload = local.earned > remote.earned;
  for (const u of UPGRADES) {
    if (remote.levels[u.id] > merged.levels[u.id]) merged.levels[u.id] = remote.levels[u.id];
    else if (merged.levels[u.id] > remote.levels[u.id]) upload = true;
  }
  saveProgress(merged);
  return { merged, upload };
}
