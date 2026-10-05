// The waves mode: alone (blue) against waves of bots (red) that grow and get better; between waves a
// short break, and crates (src/sim/crate.ts) that drop power-ups when broken. Three lives; the result
// is the wave reached (a record in this browser). The run itself is src/client/wavesRun.ts.
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
  /** Share of the damage the player takes. */
  playerDamage: 0.6,
  /** The player's weapons, the same at each spawn (better ones come from the crates). */
  primary: WEAPON_SMG,
  /** Seconds before the first wave, and between waves. */
  firstBreak: 5,
  breakSeconds: 9,
  /** Seconds between two bots joining a wave. */
  spawnGap: 0.7,
  /** Crates on the map: new ones at each break, one more now and then during a wave, at most so many. */
  crates: { perBreak: 3, every: 25, max: 5 },
  /** Seconds a power-up waits on the floor, and how long the timed ones last. */
  powerOnFloor: 30,
  powerSeconds: 15,
  /** The boss of every 5th wave: size, damage taken. */
  boss: { radius: 0.45, damageScale: 0.25 },
};

export interface WaveSpec {
  n: number;
  /** A boss wave (every 5th). */
  boss: boolean;
  /** Bots in the wave (the boss not counted). */
  total: number;
  /** At most so many at once. */
  atOnce: number;
  skill: number;
  /** The bots' weapons, one at random each. */
  weapons: number[];
}

export function waveSpec(n: number): WaveSpec {
  const boss = n % 5 === 0;
  const weapons = [WEAPON_SMG];
  if (n >= 3) weapons.push(WEAPON_SHOTGUN);
  if (n >= 5) weapons.push(WEAPON_DUAL_MACHINE_GUN);
  if (n >= 7) weapons.push(WEAPON_CHAIN_GUN, WEAPON_SNIPER);
  if (n >= 9) weapons.push(WEAPON_BAZOOKA);
  if (n >= 12) weapons.push(WEAPON_FLAME_THROWER, WEAPON_PHOTON_RIFLE);
  return {
    n,
    boss,
    // Boss waves: fewer bots around the boss
    total: boss ? 2 + Math.floor(n / 5) : 2 + n,
    atOnce: Math.min(8, 3 + Math.floor(n / 2)),
    skill: Math.min(0.9, 0.2 + n * 0.045),
    weapons,
  };
}

// ------------------------------------------------------------------ power-ups

export type PowerKind = 'life' | 'ammo' | 'weapon' | 'speed' | 'rapid' | 'shield' | 'fury' | 'extraLife' | 'bomb';

/** Each power-up: how often it drops (weights), whether it lasts (WAVES.powerSeconds), its colour. */
export const POWERS: Record<PowerKind, { weight: number; timed: boolean; color: string }> = {
  life: { weight: 24, timed: false, color: '#3fd764' },
  ammo: { weight: 18, timed: false, color: '#ff9f1c' },
  weapon: { weight: 13, timed: false, color: '#5b95ff' },
  speed: { weight: 10, timed: true, color: '#2fd3e0' },
  rapid: { weight: 10, timed: true, color: '#ffd23f' },
  shield: { weight: 10, timed: true, color: '#a77bff' },
  fury: { weight: 7, timed: true, color: '#ff4d5e' },
  extraLife: { weight: 4, timed: false, color: '#ff7ab8' },
  bomb: { weight: 4, timed: false, color: '#5a5f78' },
};

/** The timed ones' effect on the player. */
export const BOOSTS = { speed: 1.35, rapid: 1.6, shield: 0.5, fury: 2 };

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
