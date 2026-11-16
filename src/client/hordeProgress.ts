// The Horde's progress (src/client/horde.ts; Erick, 15/11/2026: "a Workshop for this mode too"): its own currency,
// Essence, earned only there and spent in its own Workshop, the Survival window's Horde tab. The upgrades are the Waves'
// Workshop's (src/client/wavesProgress.ts UPGRADES: the same effects, prices and mastery, read by the same WavesRun),
// bought apart: the Waves' Workshop doesn't count in the Horde, nor the Horde's in the Waves. The best wave and level
// reached. Kept in this browser (madorbs.horde) and, signed in, in the account (horde_progress).
import { NO_LEVELS, UPGRADES, cleanLevels, levelCost, spent, topLevel, waveCores, type Levels, type Upgrade, type UpgradeID } from './wavesProgress';
import { HORDE } from './horde';

const KEY = 'madorbs.horde';
const MAX_ESSENCE = 100_000_000;

/**
 * What a run earns, the Waves' Cores' measure (the upgrades' prices were made for them): each wave cleared (waveCores),
 * one for every KILLS kills, each boss, each level past the first, a new best wave.
 */
export const ESSENCE = { kills: 2, boss: 60, level: 5, record: 45 };

export interface RunEssence {
  /** Waves cleared, and their Essence. */
  waves: number;
  waveEssence: number;
  kills: number;
  killEssence: number;
  bosses: number;
  bossEssence: number;
  /** The level reached (1: none gained), and its Essence. */
  level: number;
  levelEssence: number;
  recordEssence: number;
  total: number;
}

/** A run that ended on `wave` (the one being fought), on `level`. */
export function runEssence(wave: number, kills: number, bosses: number, level: number, isBest: boolean): RunEssence {
  let we = 0;
  for (let n = 1; n < wave; n++) we += waveCores(n);
  // (the swarm: HORDE.swarm.count times the waves' enemies, each worth that much less)
  const killEssence = Math.floor(Math.max(0, kills) / (ESSENCE.kills * HORDE.swarm.count));
  const bossEssence = bosses * ESSENCE.boss;
  const levelEssence = Math.max(0, level - 1) * ESSENCE.level;
  const recordEssence = isBest ? ESSENCE.record : 0;
  return {
    waves: Math.max(0, wave - 1),
    waveEssence: we,
    kills,
    killEssence,
    bosses,
    bossEssence,
    level,
    levelEssence,
    recordEssence,
    total: we + killEssence + bossEssence + levelEssence + recordEssence,
  };
}

export interface HordeProgress {
  /** Every Essence ever earned; the balance is what the levels bought didn't spend. */
  earned: number;
  levels: Levels;
  /** The best wave reached (0: never played), the best level, the runs. */
  bestWave: number;
  bestLevel: number;
  runs: number;
}

const count = (v: unknown, max: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0);

export function loadHorde(): HordeProgress {
  const p: HordeProgress = { earned: 0, levels: { ...NO_LEVELS }, bestWave: 0, bestLevel: 0, runs: 0 };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<string, unknown> | null;
    if (!raw) return p;
    p.earned = count(raw.earned, MAX_ESSENCE);
    p.levels = cleanLevels(raw.levels);
    p.bestWave = count(raw.bestWave, 100_000);
    p.bestLevel = count(raw.bestLevel, 100_000);
    p.runs = count(raw.runs, 1_000_000);
  } catch {
    /* storage unavailable or corrupt: a fresh start */
  }
  return p;
}

export function saveHorde(p: HordeProgress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: the progress lasts for this page */
  }
}

/** Essence to spend (never below zero: two devices may have spent the same before syncing). */
export function essenceBalance(p: HordeProgress): number {
  return Math.max(0, p.earned - spent(p.levels));
}

export function hordeCost(u: Upgrade, levels: Levels): number | null {
  return levels[u.id] < topLevel(u) ? levelCost(u, levels[u.id]) : null;
}

/** Buys an upgrade's next level when the Essence reaches; the new progress, or null. */
export function buyHorde(id: UpgradeID): HordeProgress | null {
  const p = loadHorde();
  const u = UPGRADES.find((x) => x.id === id);
  const cost = u ? hordeCost(u, p.levels) : null;
  if (!u || cost === null || essenceBalance(p) < cost) return null;
  p.levels[id]++;
  saveHorde(p);
  return p;
}

/** How many upgrades the balance pays for right now (one level each). */
export function hordeAffordable(p: HordeProgress): number {
  const b = essenceBalance(p);
  return UPGRADES.filter((u) => (hordeCost(u, p.levels) ?? Infinity) <= b).length;
}

/** Whether a run on `wave` and `level` beats the best (the wave first, then the level). */
export function hordeIsBest(wave: number, level: number, p = loadHorde()): boolean {
  return wave > p.bestWave || (wave === p.bestWave && level > p.bestLevel);
}

/** A run is over: its Essence added, the run counted, the best wave and level kept. The new progress. */
export function saveHordeRun(essence: number, wave: number, level: number): HordeProgress {
  const p = loadHorde();
  p.earned = Math.min(MAX_ESSENCE, p.earned + Math.max(0, Math.floor(essence)));
  p.runs++;
  if (hordeIsBest(wave, level, p)) {
    p.bestWave = wave;
    p.bestLevel = level;
  }
  saveHorde(p);
  return p;
}

/**
 * The account's progress and this browser's: the most Essence ever earned, the highest level of each upgrade, the best
 * wave (with its level), the most runs. Saved here; `upload`: this browser has more than the account.
 */
export function mergeHorde(remote: { earned: number; levels: Levels; bestWave: number; bestLevel: number; runs: number } | null): { merged: HordeProgress; upload: boolean } {
  const local = loadHorde();
  if (!remote) return { merged: local, upload: local.earned > 0 || local.runs > 0 };
  const merged: HordeProgress = {
    earned: Math.max(local.earned, remote.earned),
    levels: { ...local.levels },
    ...(hordeIsBest(remote.bestWave, remote.bestLevel, local) ? { bestWave: remote.bestWave, bestLevel: remote.bestLevel } : { bestWave: local.bestWave, bestLevel: local.bestLevel }),
    runs: Math.max(local.runs, remote.runs),
  };
  let upload = local.earned > remote.earned || local.runs > remote.runs || hordeIsBest(local.bestWave, local.bestLevel, { ...merged, bestWave: remote.bestWave, bestLevel: remote.bestLevel });
  for (const u of UPGRADES) {
    if (remote.levels[u.id] > merged.levels[u.id]) merged.levels[u.id] = remote.levels[u.id];
    else if (merged.levels[u.id] > remote.levels[u.id]) upload = true;
  }
  saveHorde(merged);
  return { merged, upload };
}
