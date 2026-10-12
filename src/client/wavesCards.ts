// The waves' cards (Erick, 12/10/2026, in the style of Archero): each time the boss falls (wave 10, 20,
// 30...) the game stops and offers 3 cards; the player takes one, for the rest of the run. Taking a
// card again raises its level. Commons have 5 levels; epics (unique effects) and legendaries (from
// wave 40) come in the next steps. What each level does lives here; WavesRun applies it to the player
// (src/sim/player.ts: extra volleys, piercing, criticals, dodging) and the HUD shows the cards.

export type CardID = 'double' | 'parallel' | 'fan' | 'pierce' | 'crit' | 'vampire' | 'rage' | 'dodge' | 'grenadier';
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
];

/** How likely each rarity is in an offer (by weight). */
const RARITY_WEIGHT: Record<Rarity, number> = { common: 70, epic: 25, legendary: 8 };

/**
 * What a card does at a level (1..max): Double shot, chance of a second volley right after; Parallel,
 * the side volley's share of the damage; Fan, the two diagonal volleys' share; Pierce, enemies a bullet
 * goes through; Critical, chance of double damage; Vampire, life back per kill; Rage, extra damage at
 * no life left (it grows as the life goes down); Dodge, chance a hit misses; Grenadier, seconds for a
 * grenade to come back by itself.
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
};

export type CardLevels = Partial<Record<CardID, number>>;

/** A card's number at a level, as its text shows it (a share as a percent, life as points, seconds). */
export function cardValue(id: CardID, level: number): string {
  const v = CARD_LEVELS[id][level] ?? 0;
  switch (id) {
    case 'pierce':
      return String(v);
    case 'vampire':
      return String(Math.round(v * 100));
    case 'grenadier':
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
