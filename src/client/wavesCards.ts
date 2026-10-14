// The waves' cards (Erick, 12/10/2026, in the style of Archero): each time the boss falls (wave 10, 20,
// 30...) the game stops and offers 3 cards; the player takes one, for the rest of the run. Taking a
// card again raises its level. Commons have 5 levels, the epics 3 (shadow allies, the reflector shield),
// the legendaries 3 too, offered from wave 40 only (missiles falling, the silver bullet, the necromancer).
// What each level does lives here; WavesRun applies it to the player (src/sim/player.ts: extra volleys,
// piercing, criticals, dodging, the reflector) and the HUD shows the cards.

export type CardID = 'double' | 'parallel' | 'fan' | 'pierce' | 'crit' | 'vampire' | 'rage' | 'dodge' | 'grenadier' | 'blast' | 'ricochet' | 'missiles' | 'shadow' | 'reflect' | 'silver' | 'necro';
export type Rarity = 'common' | 'epic' | 'legendary';

export interface CardDef {
  id: CardID;
  rarity: Rarity;
  /** Top level. */
  max: number;
  /** The first wave its offer can come on (the legendaries: 40). */
  from?: number;
}

export const CARDS: CardDef[] = [
  { id: 'double', rarity: 'common', max: 5 },
  { id: 'parallel', rarity: 'common', max: 5 },
  { id: 'fan', rarity: 'common', max: 5 },
  { id: 'pierce', rarity: 'common', max: 5 },
  { id: 'crit', rarity: 'common', max: 5 },
  { id: 'vampire', rarity: 'common', max: 5 },
  { id: 'rage', rarity: 'common', max: 5 },
  { id: 'dodge', rarity: 'common', max: 5 },
  { id: 'grenadier', rarity: 'common', max: 5 },
  { id: 'blast', rarity: 'common', max: 5 },
  { id: 'ricochet', rarity: 'common', max: 5 },
  { id: 'shadow', rarity: 'epic', max: 3 },
  { id: 'reflect', rarity: 'epic', max: 3 },
  { id: 'missiles', rarity: 'legendary', max: 3, from: 40 },
  { id: 'silver', rarity: 'legendary', max: 3, from: 40 },
  { id: 'necro', rarity: 'legendary', max: 3, from: 40 },
];

/** How likely each rarity is in an offer (by weight). */
const RARITY_WEIGHT: Record<Rarity, number> = { common: 70, epic: 25, legendary: 8 };

/**
 * What a card does at a level (1..max): Double shot, chance of a second volley right after; Parallel,
 * the side volley's share of the damage; Fan, the two diagonal volleys' share; Pierce, enemies a bullet
 * goes through; Critical, chance of double damage; Vampire, life back per kill; Rage, extra damage at
 * no life left (it grows as the life goes down); Dodge, chance a hit misses; Grenadier, seconds for a
 * grenade to come back by itself; Blast, the power of the blast a kill makes (a bot's life, before its
 * toughness; BLAST_RADIUS); Ricochet, enemies a hit jumps on to; Missiles, rockets falling every
 * MISSILE_EVERY seconds; Shadow, allies at the player's side; Reflector, seconds the shield stays up
 * (every REFLECT_EVERY seconds); Silver, seconds of firing that load a silver bullet; Necromancer, the
 * chance an enemy killed rises on the player's side (NECRO_TIME seconds, NECRO_MAX at once).
 */
export const CARD_LEVELS: Record<CardID, number[]> = {
  double: [0, 0.2, 0.4, 0.6, 0.8, 1],
  parallel: [0, 0.5, 0.6, 0.7, 0.85, 1],
  fan: [0, 0.3, 0.4, 0.5, 0.6, 0.7],
  pierce: [0, 1, 2, 3, 4, 5],
  crit: [0, 0.06, 0.12, 0.18, 0.24, 0.3],
  vampire: [0, 0.02, 0.04, 0.06, 0.08, 0.1],
  rage: [0, 0.2, 0.4, 0.6, 0.8, 1],
  dodge: [0, 0.05, 0.1, 0.15, 0.2, 0.25],
  grenadier: [0, 20, 16, 12, 9, 6],
  blast: [0, 0.5, 0.6, 0.7, 0.85, 1],
  ricochet: [0, 1, 2, 3, 4, 5],
  missiles: [0, 3, 5, 7],
  shadow: [0, 1, 2, 3],
  reflect: [0, 2, 3, 4],
  silver: [0, 5, 4, 3],
  necro: [0, 0.2, 0.3, 0.4],
};

/** Blast: how far a kill's blast reaches (cells), by level. */
export const BLAST_RADIUS = [0, 1.5, 1.75, 2, 2.25, 2.5];
/** Ricochet: how far a hit jumps (cells) and the share of the damage it keeps at each jump. */
export const RICOCHET_RANGE = 5;
export const RICOCHET_KEEP = 0.7;
/** Missiles: seconds between two volleys, how far from the player they look for targets. */
export const MISSILE_EVERY = 15;
export const MISSILE_RANGE = 14;
/** Reflector: seconds between the end of a shield and the next one. */
export const REFLECT_EVERY = 10;
/**
 * Silver bullet: its damage, in the lives of an ordinary enemy of the wave (more than one: it drops them;
 * the tanks and the boss, tougher, only lose a share).
 */
export const SILVER_LIFE = 1.05;
/**
 * Shadow: the allies against the wave's enemies (12/10/2026, they were too weak and in the way): the share of
 * the damage they take, how much harder they hit, the skill they add, the seconds a fallen one takes to come
 * back, how far from the player they go to fight, and the room they keep beside him.
 */
export const SHADOW_ALLY = { tough: 0.5, hit: 1.5, skill: 0.25, respawn: 8, slack: 4.5, gap: 0.8 };
/** Necromancer: seconds a risen enemy fights for the player, and how many at once, by level. */
export const NECRO_TIME = 10;
export const NECRO_MAX = [0, 3, 4, 5];

export type CardLevels = Partial<Record<CardID, number>>;

/** A card's number at a level, as its text shows it (a share as a percent, life as points, seconds). */
export function cardValue(id: CardID, level: number): string {
  const v = CARD_LEVELS[id][level] ?? 0;
  switch (id) {
    case 'pierce':
    case 'ricochet':
    case 'missiles':
    case 'shadow':
      return String(v);
    case 'vampire':
      return String(Math.round(v * 100));
    case 'grenadier':
    case 'reflect':
    case 'silver':
      return `${v} s`;
    default:
      return `${Math.round(v * 100)}%`;
  }
}

/**
 * Three different cards for wave n: by the rarities' weights, none at its top level, no legendary
 * before its wave. Fewer when fewer are left.
 */
export function rollCards(n: number, owned: CardLevels, count = 3): CardID[] {
  const pool = CARDS.filter((c) => (owned[c.id] ?? 0) < c.max && n >= (c.from ?? 0));
  const out: CardID[] = [];
  while (out.length < count && pool.length) {
    let r = Math.random() * pool.reduce((s, c) => s + RARITY_WEIGHT[c.rarity], 0);
    let i = 0;
    for (; i < pool.length - 1; i++) {
      r -= RARITY_WEIGHT[pool[i].rarity];
      if (r <= 0) break;
    }
    out.push(pool[i].id);
    pool.splice(i, 1);
  }
  return out;
}

export const cardDef = (id: CardID): CardDef => CARDS.find((c) => c.id === id)!;
