// The waves' cards (Erick, 12/10/2026, in the style of Archero): each time the boss falls (wave 10, 20,
// 30...) the game stops and offers 3 cards, and after waves 5, 15, 25... 3 common ones (offerCards: one of them a card
// already taken, sometimes two levels at once); the player takes one, for the rest of the run. Taking a
// card again raises its level. Commons have 5 levels, the epics 3 (shadow allies, the reflector shield),
// the legendaries 3 too, offered from wave 40 only (missiles falling, the silver bullet, the necromancer).
// What each level does lives here; WavesRun applies it to the player (src/sim/player.ts: extra volleys,
// piercing, criticals, dodging, the reflector) and the HUD shows the cards.
import type { SkinInfo } from '../sim/player';

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

/**
 * A choice of common cards after every this many waves, not the boss's (10, 20, 30...: its choice has every rarity),
 * so 5, 15, 25... (Erick, 15/10/2026: a choice every 5 waves stays; every 3 was tried, too many).
 */
export const COMMON_CARDS_EVERY = 5;

/** How likely each rarity is in an offer (by weight). */
const RARITY_WEIGHT: Record<Rarity, number> = { common: 70, epic: 25, legendary: 8 };

/**
 * What a card does at a level (1..max): Double shot, chance of a second volley right after (more on one
 * target); Parallel, the share of the damage of its two volleys, one on each side opening a little (the
 * enemies beside the target); Fan, the two diagonal volleys' share; Pierce, enemies a bullet
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
  parallel: [0, 0.35, 0.45, 0.55, 0.65, 0.75],
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
/** Missiles: the least room between two of a volley's landing spots (cells). */
export const MISSILE_GAP = 1.3;
/** Reflector: seconds between the end of a shield and the next one. */
export const REFLECT_EVERY = 10;
/**
 * Silver bullet: its damage, in the lives of an ordinary enemy of the wave (more than one: it drops them;
 * the tanks and the boss, tougher, only lose a share).
 */
export const SILVER_LIFE = 1.05;
/**
 * Shadow: the allies, as strong as the player but a little less, never more (13/10/2026, Erick: too weak,
 * then "a bit stronger, never more than me"): the damage they take against what he takes (his armour and
 * the Workshop's included), the damage they deal against his, their aim (a bot's skill: at least this, more
 * when the wave's bots have more), the seconds a fallen one takes to come back, how far from the player they
 * go to fight, and the room they keep beside him. They take none of his other upgrades.
 */
export const SHADOW_ALLY = { takes: 1.15, deals: 0.9, skill: 0.8, respawn: 8, slack: 4.5, gap: 0.8 };
/**
 * The allies' colours in place of the blue team's (Player.teamTint; 13/10/2026: the same blue as the player,
 * he lost himself among them): the Shadow's a light cyan blue, the Necromancer's risen a ghostly green.
 */
export const SHADOW_TINT: Omit<SkinInfo, 'skin'> = { redDecal: [0.7, 1, 1], greenDecal: [0, 0.8, 0.95], blueDecal: [0, 0.32, 0.45] };
export const UNDEAD_TINT: Omit<SkinInfo, 'skin'> = { redDecal: [0.75, 1, 0.75], greenDecal: [0.2, 0.8, 0.35], blueDecal: [0.05, 0.3, 0.12] };
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
 * before its wave; `commonOnly`: the commons only (after waves 5, 15, 25...: the boss's offer has them all).
 * Fewer when fewer are left.
 */
export function rollCards(n: number, owned: CardLevels, count = 3, commonOnly = false): CardID[] {
  const pool = CARDS.filter((c) => (owned[c.id] ?? 0) < c.max && n >= (c.from ?? 0) && (!commonOnly || c.rarity === 'common'));
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

/** A card offered, and the levels it gives (2: a card already taken climbing two at once, shown apart). */
export interface CardOffer {
  id: CardID;
  up: number;
}

/** The chance a card already taken is offered two levels at once (beside a new epic or legendary: always). */
export const DOUBLE_CHANCE = 0.2;

/**
 * What a choice offers (Erick, 15/10/2026, after Vampire Survivors: build on what you have): three cards
 * (rollCards), one of them always a card already taken that isn't at its top, in place of a new common one
 * (never of a rarer card); that one sometimes climbs two levels at once (DOUBLE_CHANCE), and always when a new
 * epic or legendary is offered beside it: a level 1 of the rare card, or two levels of yours.
 */
export function offerCards(n: number, owned: CardLevels, commonOnly: boolean): CardOffer[] {
  const ids = rollCards(n, owned, 3, commonOnly);
  if (!ids.length) return [];
  const level = (id: CardID) => owned[id] ?? 0;
  const left = (id: CardID) => cardDef(id).max - level(id);
  const mine = CARDS.filter((c) => level(c.id) > 0 && left(c.id) > 0 && n >= (c.from ?? 0) && (!commonOnly || c.rarity === 'common')).map((c) => c.id);
  const offer = ids.map((id) => ({ id, up: 1 }));
  if (!mine.length) return offer;
  const rareNew = ids.some((id) => cardDef(id).rarity !== 'common' && level(id) === 0);
  const double = rareNew || Math.random() < DOUBLE_CHANCE;
  const pickMine = (from: CardID[]) => {
    const two = from.filter((id) => left(id) >= 2);
    const pool = double && two.length ? two : from;
    return pool[Math.floor(Math.random() * pool.length)];
  };
  // The one of yours: already offered, else in place of a new common card (the last one), else the last card
  let slot = ids.findIndex((id) => mine.includes(id) && (!double || left(id) >= 2));
  if (slot < 0) slot = ids.findIndex((id) => mine.includes(id));
  if (slot < 0 || (double && left(ids[slot]) < 2 && mine.some((id) => left(id) >= 2 && !ids.includes(id)))) {
    if (slot < 0) {
      slot = ids.length - 1;
      for (let i = ids.length - 1; i >= 0; i--) {
        if (cardDef(ids[i]).rarity === 'common' && level(ids[i]) === 0) {
          slot = i;
          break;
        }
      }
    }
    const id = pickMine(mine.filter((m) => !ids.includes(m)));
    if (id) offer[slot] = { id, up: 1 };
  }
  if (double && left(offer[slot].id) >= 2) offer[slot].up = 2;
  return offer;
}
