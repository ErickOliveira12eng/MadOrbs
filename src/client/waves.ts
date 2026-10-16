// The waves mode: alone (blue) against waves of bots (red) that grow and get better without end;
// between waves a short break, and crates (src/sim/crate.ts) that drop power-ups when broken, some of
// them for the rest of the run. Three lives; the result is the wave reached (a record in this browser).
// The run itself is src/client/wavesRun.ts; what lasts between runs (Cores, the Workshop's upgrades,
// milestones, checkpoints) is src/client/wavesProgress.ts.
import {
  WEAPON_BAZOOKA,
  WEAPON_CHAIN_GUN,
  WEAPON_DUAL_MACHINE_GUN,
  WEAPON_FLAME_THROWER,
  WEAPON_PHOTON_RIFLE,
  WEAPON_SHOTGUN,
  WEAPON_SMG,
  WEAPON_SNIPER,
} from '../sim/constants';

/** The map of the first version (chosen by Erick from tools/debug/map-gallery.ts). */
export const WAVES_MAP = 'CTF-Invaders';

export const WAVES = {
  /**
   * Orbs in the game at most: every bot of the wave comes, past the original's 32 (offline nothing
   * needs it; tested by Erick up to 256, 12/10/2026). Online stays at 32 (MAX_PLAYER).
   */
  maxOrbs: 256,
  /** Lives: spawns at the start and after each death. */
  lives: 3,
  /** Share of the damage the player takes: the bots hit a quarter as hard as elsewhere. */
  playerDamage: 0.25,
  /**
   * Life packs: what one gives back (half elsewhere) and the chance a fallen bot drops one (always
   * elsewhere; the boss always does).
   */
  lifePackHeal: 0.25,
  lifePackChance: 0.35,
  /** The bots' speed (they hunt the player down: a little slower, so there is room to run). */
  botSpeed: 0.7,
  /** The player's weapons, the same at each spawn (better ones come from the crates). */
  primary: WEAPON_SMG,
  /** Seconds before the player is back after a death (by itself: no click needed). */
  respawnSeconds: 5,
  /** Seconds before the first wave, and between waves. */
  firstBreak: 5,
  breakSeconds: 9,
  /** Crates on the map: new ones at each break, one more now and then during a wave, at most so many. */
  crates: { perBreak: 3, every: 20, max: 6 },
  /** Seconds a power-up waits on the floor, and how long the timed ones last. */
  powerOnFloor: 30,
  powerSeconds: 15,
  /** A boss every so many waves: its size and the share of the damage it takes (before the wave's toughness). */
  bossEvery: 10,
  boss: { radius: 0.45, damageScale: 0.25 },
  /** Bots that come with the boss and walk beside it. */
  escorts: 2,
};

/**
 * The first waves, easier (Erick, 15/10/2026: everybody who starts playing should get through them): on wave 1 the
 * bots hit half as hard (hit) and take 20% more damage (take), back to the curve step by step by wave `until`
 * (wave 2: x0.63 and x1.15, 3: x0.75 and x1.1, 4: x0.88 and x1.05); from there on nothing changes.
 */
export const EASE = { until: 5, hit: 0.5, take: 1.2 };

export interface WaveSpec {
  n: number;
  /** A boss wave (every WAVES.bossEvery). */
  boss: boolean;
  /** Bots in the wave (the boss not counted); they all come, a few each second. */
  total: number;
  /** Seconds between two bots joining. */
  spawnGap: number;
  /** Seconds the wave lasts: then the next one comes, even with enemies left (they stay). */
  seconds: number;
  skill: number;
  /** Share of the damage the bots take (they get tougher), and how hard they hit (×). */
  toughness: number;
  hitBoost: number;
  /** The bots' weapons, one at random each. */
  weapons: number[];
}

/**
 * Wave n, with no last wave: every number grows without end, the ones that can't (the bots' skill)
 * close in on a ceiling. A gentle start and a steady climb (the first version was hard from the start
 * and too hard soon after; the Workshop's upgrades, src/client/wavesProgress.ts, now carry the player
 * further run after run). Bots: 2 + 0.9 n + n²/80 (3, 7 on wave 5, 12 on 10, 25 on 20, 40 on 30); their
 * skill 0.92 - 0.77 e^(-(n-1)/18) (0.15, 0.27, 0.42, 0.66 on 20). They take 1/(1 + 0.07 (n-1)) of the
 * damage (as if their life were ×1.6 on wave 10, ×2.3 on 20, ×3.7 on 40) and hit 1 + 0.04 (n-1) as hard
 * (×1.4, ×1.8, ×2.6; on top of WAVES.playerDamage): Erick, 12/10/2026, the gentler 0.035 and 0.015 went
 * unnoticed against the player's power-ups. The better weapons come a few waves later than they used to.
 * The first waves are easier still (EASE): nobody new should die on them.
 */
export function waveSpec(n: number): WaveSpec {
  // 1 on wave 1, down to 0 on wave EASE.until
  const ease = Math.max(0, Math.min(1, (EASE.until - n) / (EASE.until - 1)));
  const boss = n % WAVES.bossEvery === 0;
  const weapons = [WEAPON_SMG];
  if (n >= 4) weapons.push(WEAPON_SHOTGUN);
  if (n >= 7) weapons.push(WEAPON_DUAL_MACHINE_GUN);
  if (n >= 10) weapons.push(WEAPON_CHAIN_GUN);
  if (n >= 13) weapons.push(WEAPON_SNIPER);
  if (n >= 16) weapons.push(WEAPON_BAZOOKA);
  if (n >= 20) weapons.push(WEAPON_FLAME_THROWER, WEAPON_PHOTON_RIFLE);
  const total = Math.round(2 + 0.9 * n + (n * n) / 80);
  return {
    n,
    boss,
    // A boss wave: fewer bots around the boss
    total: boss ? Math.ceil(total * 0.6) : total,
    spawnGap: Math.max(0.25, 0.9 - n * 0.02),
    seconds: Math.min(60, 30 + n),
    skill: 0.92 - 0.77 * Math.exp(-(n - 1) / 18),
    toughness: (1 / (1 + 0.07 * (n - 1))) * (1 + (EASE.take - 1) * ease),
    hitBoost: (1 + 0.04 * (n - 1)) * (1 - (1 - EASE.hit) * ease),
    weapons,
  };
}

// ------------------------------------------------------------------ elites

/**
 * Elites (Erick, 12/10/2026: a strong player stopped dying, every bot was the same): from wave 10
 * some bots come with a trait, more of them and stronger ones as the waves go on (by the wave only,
 * not by the player's power-ups). Fast: runs nearly as fast as a boosted player. Brute: hits much
 * harder (and is a bit bigger). Sharpshooter: hardly misses. Tank: takes much less damage. Later on
 * some have two. The name over the orb shows each trait's icon (HudLayer.updateTags).
 */
export type EliteKind = 'fast' | 'brute' | 'sniper' | 'tank';
export const ELITE_KINDS: EliteKind[] = ['fast', 'brute', 'sniper', 'tank'];
export const ELITE_FROM = 10;

/** The share of a wave's bots that are elites: 10% on wave 10, 60% from wave 40. */
export function eliteShare(n: number): number {
  return n < ELITE_FROM ? 0 : Math.min(0.6, 0.1 + (n - ELITE_FROM) / 60);
}

/** The chance an elite has a second trait: from wave 30, up to 50% on wave 50. */
export function eliteDoubleChance(n: number): number {
  return n < 30 ? 0 : Math.min(0.5, (n - 30) / 40);
}

/**
 * How strong the traits are on wave n: the fast one's speed (times WAVES.botSpeed, at most 1.9 in all),
 * the brute's damage (×), the sharpshooter's aim error (×, and the best skill), the tank's share of the
 * damage it takes.
 */
export function eliteStrength(n: number): { speed: number; hit: number; aim: number; tough: number } {
  const k = Math.max(0, n - ELITE_FROM);
  return { speed: 1.3 + 0.02 * k, hit: 1.6 + 0.06 * k, aim: 0.3, tough: 1 / (2 + 0.06 * k) };
}

/**
 * The boss grows each time it comes (wave 10, 20, 30...; Erick, 12/10/2026): bigger (hit and drawn at
 * that size; against the walls it keeps WAVES.boss.radius), much harder hitting, a bit tougher.
 * `k` is how many times it came before.
 */
export function bossStrength(n: number): { radius: number; hit: number; tough: number } {
  const k = Math.max(0, Math.floor(n / WAVES.bossEvery) - 1);
  return { radius: Math.min(1, WAVES.boss.radius + 0.1 * k), hit: 1.5 + 0.75 * k, tough: 1 / (1 + 0.2 * k) };
}

/** A bot's traits on wave n: none (most), one, or two later on. */
export function rollElite(n: number): EliteKind[] {
  if (Math.random() >= eliteShare(n)) return [];
  const pool = [...ELITE_KINDS];
  const pick = () => pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  const out = [pick()];
  if (Math.random() < eliteDoubleChance(n)) out.push(pick());
  return out;
}

// ------------------------------------------------------------------ power-ups

/**
 * Timed ones (WAVES.powerSeconds), one-shot ones, and the permanent ones for the rest of the run
 * (each one more level): fire rate, damage, resistance and moving +10% a level, poison and ice shots.
 */
export type PowerKind =
  | 'life'
  | 'ammo'
  | 'weapon'
  | 'speed'
  | 'rapid'
  | 'shield'
  | 'fury'
  | 'extraLife'
  | 'bomb'
  | 'permFire'
  | 'permDamage'
  | 'permArmor'
  | 'permSpeed'
  | 'poison'
  | 'ice';

export type PermKind = 'permFire' | 'permDamage' | 'permArmor' | 'permSpeed' | 'poison' | 'ice';
export const PERM_KINDS: PermKind[] = ['permFire', 'permDamage', 'permArmor', 'permSpeed', 'poison', 'ice'];

/** Each power-up: how often it drops (weights), whether it lasts a while, whether it stays, its colour. */
export const POWERS: Record<PowerKind, { weight: number; timed: boolean; perm: boolean; color: string }> = {
  life: { weight: 20, timed: false, perm: false, color: '#3fd764' },
  ammo: { weight: 11, timed: false, perm: false, color: '#ff9f1c' },
  weapon: { weight: 8, timed: false, perm: false, color: '#5b95ff' },
  // The timed ones: 2 each since 15/10/2026 (Erick: they came too often; 5, 5, 5 and 4 before, 19% of the crates, now 9%)
  speed: { weight: 2, timed: true, perm: false, color: '#2fd3e0' },
  rapid: { weight: 2, timed: true, perm: false, color: '#ffd23f' },
  shield: { weight: 2, timed: true, perm: false, color: '#a77bff' },
  fury: { weight: 2, timed: true, perm: false, color: '#ff4d5e' },
  extraLife: { weight: 3, timed: false, perm: false, color: '#ff7ab8' },
  bomb: { weight: 3, timed: false, perm: false, color: '#5a5f78' },
  permFire: { weight: 7, timed: false, perm: true, color: '#e8b400' },
  permDamage: { weight: 7, timed: false, perm: true, color: '#e8402f' },
  permArmor: { weight: 7, timed: false, perm: true, color: '#7b61ff' },
  permSpeed: { weight: 7, timed: false, perm: true, color: '#14b8c7' },
  poison: { weight: 5, timed: false, perm: true, color: '#7ed321' },
  ice: { weight: 5, timed: false, perm: true, color: '#7fd8ff' },
};

/** The timed ones' effect on the player. */
export const BOOSTS = { speed: 1.35, rapid: 1.6, shield: 0.5, fury: 2 };

/** A level of a permanent one: +10% fire rate, damage and moving speed; 10% less damage taken. */
export const PERM_STEP = 0.1;
/** Poison: life per second per level (a bot has 1); ice: speed lost per level, at most ICE_MAX. */
export const POISON_DPS = 0.08;
export const ICE_SLOW = 0.15;
export const ICE_MAX = 0.6;

/** Weapons a "new weapon" power-up can give (better than the SMG). */
export const POWER_WEAPONS = [WEAPON_DUAL_MACHINE_GUN, WEAPON_CHAIN_GUN, WEAPON_SHOTGUN, WEAPON_BAZOOKA, WEAPON_PHOTON_RIFLE, WEAPON_FLAME_THROWER, WEAPON_SNIPER];

/**
 * One of the permanent power-ups, by their weights (the Workshop's crate luck, a head start), leaving
 * out those at their limit (`full`); null when all of them are.
 */
export function rollPerm(full: (k: PermKind) => boolean = () => false): PermKind | null {
  const kinds = PERM_KINDS.filter((k) => !full(k));
  if (!kinds.length) return null;
  let r = Math.random() * kinds.reduce((s, k) => s + POWERS[k].weight, 0);
  for (const k of kinds) {
    r -= POWERS[k].weight;
    if (r <= 0) return k;
  }
  return kinds[0];
}

/** A crate's power-up, by the weights, leaving out the permanent ones at their limit (`full`). */
export function rollPower(full: (k: PermKind) => boolean = () => false): PowerKind {
  const kinds = (Object.keys(POWERS) as PowerKind[]).filter((k) => !POWERS[k].perm || !full(k as PermKind));
  let r = Math.random() * kinds.reduce((s, k) => s + POWERS[k].weight, 0);
  for (const k of kinds) {
    r -= POWERS[k].weight;
    if (r <= 0) return k;
  }
  return 'life';
}

// ------------------------------------------------------------------ record (this browser)

const KEY = 'madorbs.waves';

export interface WavesRecord {
  /** The highest wave reached (the one being fought when the last life went). */
  wave: number;
  kills: number;
}

export function loadWavesRecord(): WavesRecord | null {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? 'null') as WavesRecord | null;
    return r && Number.isFinite(r.wave) && r.wave > 0 ? r : null;
  } catch {
    return null;
  }
}

/** Whether run `a` beats run `b` (a higher wave, or the same with more kills). */
export function betterRun(a: WavesRecord, b: WavesRecord | null): boolean {
  return !b || a.wave > b.wave || (a.wave === b.wave && a.kills > b.kills);
}

/**
 * The account's best run merged into this browser's (the better one stays here). Returns this
 * browser's when it beats the account's, to send to it; else null.
 */
export function mergeWavesRecord(remote: WavesRecord | null): WavesRecord | null {
  const local = loadWavesRecord();
  if (remote && betterRun(remote, local)) {
    try {
      localStorage.setItem(KEY, JSON.stringify(remote));
    } catch {
      /* storage unavailable */
    }
    return null;
  }
  return local && betterRun(local, remote) ? local : null;
}

/** Saves a run; true when it beats the record (a higher wave, or the same with more kills). */
export function saveWavesRun(wave: number, kills: number): boolean {
  const best = loadWavesRecord();
  if (best && (best.wave > wave || (best.wave === wave && best.kills >= kills))) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify({ wave, kills }));
  } catch {
    /* storage unavailable: the record lasts for this page */
  }
  return true;
}
