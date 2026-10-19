// The waves' Power: one number for how strong a player starts a run, from the starting weapon and the Workshop's
// levels (Erick, 18/10/2026: "Power x2.4" on top of the Workshop, going up with each purchase, so the player feels
// it before playing; later, the ranking). 100 = a new player with the SMG and nothing bought.
//
//   attack     the weapon (WEAPON_POWER) x damage x attack speed, plus the shock wave and the grenades
//   toughness  what a blow takes of a life (life, defence), the recharging shield, moving speed, the dash, the
//              life back between waves, life packs, the second wind, and the lives
//   growth     how fast a run grows: luck in the crates, the limit of the run's power-ups, card rerolls
//   power      100 x sqrt(attack x toughness) x growth: attack and toughness weigh the same (like the "combat power"
//              of other games); a level of damage and a level of life both move it
//
// What a run picks up (crates, cards) is left out: it's the power a run starts with. Pure: no DOM, the same numbers
// anywhere (a ranking can recompute it from the levels the account keeps, waves_progress).
import { WEAPON_BAZOOKA, WEAPON_CHAIN_GUN, WEAPON_FLAME_THROWER, WEAPON_SHOTGUN, WEAPON_SMG } from '../sim/constants';
import { WAVES } from './waves';
import { BARRIER_SIZE, BREATHER, DASH_COOLDOWN, SECOND_WIND_LIFE, SHOCK, SHOCK_COOLDOWN, UPGRADE_STEP, startWeapons, type Levels } from './wavesProgress';

/**
 * The starting weapons against a crowd, the SMG = 1: one target's damage a second (the "Pro" rules: SMG 1.0,
 * shotgun 1.24, chain gun 1.6, bazooka 0.49, flame thrower 1.2 up close) times the enemies one shot reaches in the
 * waves' crowds (the shotgun's pellets spread onto the neighbours, the bazooka's blast takes a few, the flames go
 * through them). An estimate, in the milestones' order.
 */
export const WEAPON_POWER: Record<number, number> = {
  [WEAPON_SMG]: 1,
  [WEAPON_SHOTGUN]: 1.35,
  [WEAPON_CHAIN_GUN]: 1.6,
  [WEAPON_BAZOOKA]: 1.8,
  [WEAPON_FLAME_THROWER]: 2,
};

/** The shock wave: the enemies it catches on average, and the share of its cooldowns used. */
const SHOCK_TARGETS = 3;
const SHOCK_USE = 0.5;
/** A grenade more at each spawn: its damage over a life, in SMG-seconds. */
const GRENADE_ATTACK = 0.06;

export interface WavesPower {
  /** 100 = a new player with the SMG */
  power: number;
  /** Times a new player's (1 = nothing bought, the SMG) */
  attack: number;
  toughness: number;
  growth: number;
}

export function wavesPower(lv: Levels, weapon: number): WavesPower {
  const hit = 1 + UPGRADE_STEP.damage * lv.damage;
  const shock = lv.shock ? (SHOCK_TARGETS * SHOCK.damage * SHOCK_USE) / SHOCK_COOLDOWN[lv.shock] : 0;
  // (the grenades get only part of the damage: WAVES.grenadeBonus)
  const grenades = GRENADE_ATTACK * lv.grenades * (1 + (hit - 1) * WAVES.grenadeBonus);
  const attack = (WEAPON_POWER[weapon] ?? 1) * hit * (1 + UPGRADE_STEP.fire * lv.fire) + hit * shock + grenades;

  const lives = WAVES.lives + lv.lives;
  const toughness =
    ((1 + UPGRADE_STEP.life * lv.life) / (1 - UPGRADE_STEP.armor * lv.armor)) *
    // the shield takes its share of a life, again and again: worth about its size
    (1 + BARRIER_SIZE[lv.barrier]) *
    // faster, fewer blows land
    Math.sqrt(1 + UPGRADE_STEP.speed * lv.speed) *
    (lv.dash ? 1 + 0.3 / DASH_COOLDOWN[lv.dash] : 1) *
    (1 + 0.4 * BREATHER[lv.breather]) *
    (1 + 0.6 * UPGRADE_STEP.drops * lv.drops) *
    (1 + (SECOND_WIND_LIFE * lv.secondWind) / lives) *
    (lives / WAVES.lives);

  const growth = (1 + 0.4 * UPGRADE_STEP.luck * lv.luck) * (1 + 0.02 * lv.cap) * (1 + 0.03 * lv.reroll);
  return { power: Math.round(100 * Math.sqrt(attack * toughness) * growth), attack, toughness, growth };
}

/** The power with the best starting weapon the record has opened (a ranking's number: the weapon is the player's pick). */
export function bestWavesPower(lv: Levels, record: number): WavesPower {
  return startWeapons(record)
    .map((w) => wavesPower(lv, w))
    .reduce((a, b) => (b.power > a.power ? b : a));
}
