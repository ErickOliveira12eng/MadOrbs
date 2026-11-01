// The Vesuvius's progress (src/client/vesuviusRun.ts): its own currency, Obsidian, earned only there, spent in its
// own Workshop, the Forge (Erick, 31/10/2026: the Waves' Workshop must not count in this mode). The best time to bring
// the volcano down and the wins. Kept in this browser (madorbs.vesuvius) and, signed in, in the account
// (vesuvius_progress).
import { WEAPON_BAZOOKA, WEAPON_CHAIN_GUN, WEAPON_DUAL_MACHINE_GUN, WEAPON_FLAME_THROWER, WEAPON_SMG } from '../sim/constants';

export type ForgeID = 'damage' | 'fire' | 'grenades' | 'life' | 'armor' | 'barrier' | 'lives' | 'speed' | 'dash';

/** The Forge's kinds of upgrade, in its list. */
export type ForgeGroup = 'attack' | 'defense' | 'moving';

export interface ForgeUpgrade {
  id: ForgeID;
  /** The price of each level (its length is the top level). */
  costs: number[];
  group: ForgeGroup;
}

/** The Forge's upgrades, in the order of its list (6,380 Obsidian in all). */
export const FORGE: ForgeUpgrade[] = [
  { id: 'damage', costs: [50, 100, 160, 240, 350], group: 'attack' },
  { id: 'fire', costs: [50, 100, 160, 240, 350], group: 'attack' },
  { id: 'grenades', costs: [60, 120, 200], group: 'attack' },
  { id: 'life', costs: [40, 80, 140, 210, 300], group: 'defense' },
  { id: 'armor', costs: [50, 100, 160, 240, 350], group: 'defense' },
  { id: 'barrier', costs: [120, 240, 400], group: 'defense' },
  { id: 'lives', costs: [200, 400], group: 'defense' },
  { id: 'speed', costs: [50, 100, 160, 240], group: 'moving' },
  { id: 'dash', costs: [100, 200, 320], group: 'moving' },
];

export const FORGE_GROUPS: ForgeGroup[] = ['attack', 'defense', 'moving'];

/**
 * What a level does: damage +12%, attack speed +10%, one more grenade at each spawn, life +20 points (a bigger bar,
 * Player.lifeMax), 7% less damage taken, a recharging shield (Player.barrier) of this share of a life, one more life,
 * speed +5%, a dash (Shift: untouchable while it lasts) with these seconds to recharge.
 */
export const FORGE_STEP = { damage: 0.12, fire: 0.1, life: 0.2, armor: 0.07, speed: 0.05 };
export const FORGE_BARRIER = [0, 0.15, 0.25, 0.35];
export const FORGE_DASH = [0, 5, 4, 3];

/** The run's lives with no Forge, and the most it can add. */
export const VESUVIUS_LIVES = 3;

export type ForgeLevels = Record<ForgeID, number>;

export const NO_FORGE: ForgeLevels = { damage: 0, fire: 0, grenades: 0, life: 0, armor: 0, barrier: 0, lives: 0, speed: 0, dash: 0 };

/** The weapons to go in with: the Waves' starting ones (whoever got past wave 100 has them all). */
export const VESUVIUS_WEAPONS = [WEAPON_SMG, WEAPON_DUAL_MACHINE_GUN, WEAPON_CHAIN_GUN, WEAPON_BAZOOKA, WEAPON_FLAME_THROWER];

// ------------------------------------------------------------------ Obsidian of a run

/**
 * What a run earns: the volcano's bar taken (OBSIDIAN.bar for the whole of it), each phase reached past the first, the
 * kills, the win, a new best time. A win with no Forge: ~120 + 80 + ~25 + 200 = ~425 (+60 a record); a run lost at half
 * the bar ~100.
 */
export const OBSIDIAN = { bar: 120, phase: 40, kill: 1, win: 200, record: 60 };

export interface RunObsidian {
  /** The share of the volcano's bar taken (0 to 1), and its Obsidian. */
  share: number;
  barObsidian: number;
  /** Phases reached past the first (0 to 2). */
  phases: number;
  phaseObsidian: number;
  kills: number;
  killObsidian: number;
  winObsidian: number;
  recordObsidian: number;
  total: number;
}

export function runObsidian(share: number, phases: number, kills: number, won: boolean, isBest: boolean): RunObsidian {
  const s = Math.max(0, Math.min(1, share));
  const barObsidian = Math.round(s * OBSIDIAN.bar);
  const phaseObsidian = Math.max(0, phases) * OBSIDIAN.phase;
  const killObsidian = Math.max(0, kills) * OBSIDIAN.kill;
  const winObsidian = won ? OBSIDIAN.win : 0;
  const recordObsidian = isBest ? OBSIDIAN.record : 0;
  return {
    share: s,
    barObsidian,
    phases,
    phaseObsidian,
    kills,
    killObsidian,
    winObsidian,
    recordObsidian,
    total: barObsidian + phaseObsidian + killObsidian + winObsidian + recordObsidian,
  };
}

// ------------------------------------------------------------------ saved progress

const KEY = 'madorbs.vesuvius';
const MAX_OBSIDIAN = 100_000_000;

export interface VesuviusProgress {
  /** Every Obsidian ever earned; the balance is what the levels bought didn't spend. */
  earned: number;
  levels: ForgeLevels;
  /** The weapon chosen last. */
  weapon: number;
  /** The best time to bring the volcano down (seconds, the deaths counted), null: never won. */
  best: number | null;
  wins: number;
  runs: number;
}

export function cleanForge(raw: unknown): ForgeLevels {
  const out = { ...NO_FORGE };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const u of FORGE) {
    const v = r[u.id];
    if (typeof v === 'number' && Number.isFinite(v)) out[u.id] = Math.max(0, Math.min(u.costs.length, Math.floor(v)));
  }
  return out;
}

const count = (v: unknown, max: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0);

/** A best time as it should be (whole seconds within a day), or null. */
export function cleanBest(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 86400 ? Math.round(v) : null;
}

export function loadVesuvius(): VesuviusProgress {
  const p: VesuviusProgress = { earned: 0, levels: { ...NO_FORGE }, weapon: WEAPON_SMG, best: null, wins: 0, runs: 0 };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<string, unknown> | null;
    if (!raw) return p;
    p.earned = count(raw.earned, MAX_OBSIDIAN);
    p.levels = cleanForge(raw.levels);
    if (typeof raw.weapon === 'number' && VESUVIUS_WEAPONS.includes(raw.weapon)) p.weapon = raw.weapon;
    p.best = cleanBest(raw.best);
    p.wins = count(raw.wins, 1_000_000);
    p.runs = count(raw.runs, 1_000_000);
  } catch {
    /* storage unavailable or corrupt: a fresh start */
  }
  return p;
}

export function saveVesuvius(p: VesuviusProgress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: the progress lasts for this page */
  }
}

/** The levels' cost: every level bought, at its price. */
export function forgeSpent(levels: ForgeLevels): number {
  let s = 0;
  for (const u of FORGE) for (let i = 0; i < Math.min(levels[u.id], u.costs.length); i++) s += u.costs[i];
  return s;
}

/** Obsidian to spend (never below zero: two devices may have spent the same before syncing). */
export function obsidianBalance(p: VesuviusProgress): number {
  return Math.max(0, p.earned - forgeSpent(p.levels));
}

export function forgeCost(u: ForgeUpgrade, levels: ForgeLevels): number | null {
  return levels[u.id] < u.costs.length ? u.costs[levels[u.id]] : null;
}

/** Buys an upgrade's next level when the Obsidian reaches; the new progress, or null. */
export function buyForge(id: ForgeID): VesuviusProgress | null {
  const p = loadVesuvius();
  const u = FORGE.find((x) => x.id === id);
  const cost = u ? forgeCost(u, p.levels) : null;
  if (!u || cost === null || obsidianBalance(p) < cost) return null;
  p.levels[id]++;
  saveVesuvius(p);
  return p;
}

/** How many upgrades the balance pays for right now (one level each). */
export function forgeAffordable(p: VesuviusProgress): number {
  const b = obsidianBalance(p);
  return FORGE.filter((u) => (forgeCost(u, p.levels) ?? Infinity) <= b).length;
}

/**
 * A run is over: its Obsidian added, the run counted, a win counted and its time kept when it is the best. The new
 * progress, and whether the time was a new best.
 */
export function saveVesuviusRun(obsidian: number, won: boolean, time: number | null): { progress: VesuviusProgress; isBest: boolean } {
  const p = loadVesuvius();
  p.earned = Math.min(MAX_OBSIDIAN, p.earned + Math.max(0, Math.floor(obsidian)));
  p.runs++;
  let isBest = false;
  if (won) {
    p.wins++;
    if (time !== null && (p.best === null || time < p.best)) {
      p.best = Math.round(time);
      isBest = true;
    }
  }
  saveVesuvius(p);
  return { progress: p, isBest };
}

/**
 * The account's progress and this browser's: the most Obsidian ever earned, the highest level of each upgrade, the
 * best time, the most wins and runs. Saved here; `upload`: this browser has more than the account.
 */
export function mergeVesuvius(remote: { earned: number; levels: ForgeLevels; best: number | null; wins: number; runs: number } | null): { merged: VesuviusProgress; upload: boolean } {
  const local = loadVesuvius();
  if (!remote) return { merged: local, upload: local.earned > 0 || local.runs > 0 };
  const merged: VesuviusProgress = {
    ...local,
    earned: Math.max(local.earned, remote.earned),
    levels: { ...local.levels },
    best: local.best === null ? remote.best : remote.best === null ? local.best : Math.min(local.best, remote.best),
    wins: Math.max(local.wins, remote.wins),
    runs: Math.max(local.runs, remote.runs),
  };
  let upload = local.earned > remote.earned || local.wins > remote.wins || local.runs > remote.runs || (local.best !== null && (remote.best === null || local.best < remote.best));
  for (const u of FORGE) {
    if (remote.levels[u.id] > merged.levels[u.id]) merged.levels[u.id] = remote.levels[u.id];
    else if (merged.levels[u.id] > remote.levels[u.id]) upload = true;
  }
  saveVesuvius(merged);
  return { merged, upload };
}
