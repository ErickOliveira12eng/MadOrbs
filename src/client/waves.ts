// The waves mode: alone (blue) against waves of bots (red) that grow and get better without end;
// between waves a short break, and crates (src/sim/crate.ts) that drop power-ups when broken, some of
// them for the rest of the run. Three lives; the result is the wave reached (a record in this browser).
// The run itself is src/client/wavesRun.ts.
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
  /** Lives: spawns at the start and after each death. */
  lives: 3,
  /** Share of the damage the player takes: the bots hit half as hard as elsewhere. */
  playerDamage: 0.5,
  /** The player's weapons, the same at each spawn (better ones come from the crates). */
  primary: WEAPON_SMG,
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
};

export interface WaveSpec {
  n: number;
  /** A boss wave (every WAVES.bossEvery). */
  boss: boolean;
  /** Bots in the wave (the boss not counted); they all come, a few each second. */
  total: number;
  /** Seconds between two bots joining. */
  spawnGap: number;
  skill: number;
  /** Share of the damage the bots take (they get tougher), and how hard they hit (×). */
  toughness: number;
  hitBoost: number;
  /** The bots' weapons, one at random each. */
  weapons: number[];
}

/**
 * Wave n, with no last wave: every number grows without end, the ones that can't (the bots' skill)
 * close in on a ceiling. Bots: 2 + 1.2 n + n²/50 (3, 5, 16 on wave 10, 34 on 20, 80 on 40); their
 * skill 0.95 - 0.75 e^(-(n-1)/10); they take 1/(1 + 0.04 (n-1)) of the damage (35% tougher on wave
 * 10, twice on 26) and hit 1 + 0.02 (n-1) as hard (on top of WAVES.playerDamage). The permanent
 * power-ups keep the player in the race for a while; sooner or later the waves win.
 */
export function waveSpec(n: number): WaveSpec {
  const boss = n % WAVES.bossEvery === 0;
  const weapons = [WEAPON_SMG];
  if (n >= 3) weapons.push(WEAPON_SHOTGUN);
  if (n >= 5) weapons.push(WEAPON_DUAL_MACHINE_GUN);
  if (n >= 7) weapons.push(WEAPON_CHAIN_GUN, WEAPON_SNIPER);
  if (n >= 9) weapons.push(WEAPON_BAZOOKA);
  if (n >= 12) weapons.push(WEAPON_FLAME_THROWER, WEAPON_PHOTON_RIFLE);
  const total = Math.round(2 + 1.2 * n + (n * n) / 50);
  return {
    n,
    boss,
    // A boss wave: fewer bots around the boss
    total: boss ? Math.ceil(total * 0.6) : total,
    spawnGap: Math.max(0.25, 0.8 - n * 0.02),
    skill: 0.95 - 0.75 * Math.exp(-(n - 1) / 10),
    toughness: 1 / (1 + 0.04 * (n - 1)),
    hitBoost: 1 + 0.02 * (n - 1),
    weapons,
  };
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
  speed: { weight: 5, timed: true, perm: false, color: '#2fd3e0' },
  rapid: { weight: 5, timed: true, perm: false, color: '#ffd23f' },
  shield: { weight: 5, timed: true, perm: false, color: '#a77bff' },
  fury: { weight: 4, timed: true, perm: false, color: '#ff4d5e' },
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

export function rollPower(): PowerKind {
  const kinds = Object.keys(POWERS) as PowerKind[];
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
