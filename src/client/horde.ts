// The Horde (15/11/2026, Erick: a new mode, more like a classic roguelike; in test, the testers' accounts only): the
// waves (src/client/wavesRun.ts) on a map twice as big, with the enemies smaller, and levels inside the run: each enemy
// that falls leaves energy on the floor, the energy taken fills the level bar, and each level up offers three cards.
// Nothing of it counts yet (a tester's run: no record, Cores nor report).
import { waveSpec } from './waves';

/** A big field of ruins (tools/make-horde-map.mjs). */
export const HORDE_MAP = 'HORDE-Ruins';

export const HORDE = {
  /**
   * A swarm (Erick, 16/11/2026: "the damage smaller, the volume bigger"): each wave brings `count` times the waves'
   * enemies, each with `life` of the life and `hit` of the damage (on top of `enemyHit`; the plain ones, the elites and
   * the boss's escorts: the boss and the nuke bot keep theirs), and `rush` of them come right at the player
   * (BotController.rush; the waves' WAVES.rushShare). The energy a level asks grows with `count` (energyToNext), the
   * Essence of the kills and the Vampire card's life a kill shrink with it.
   */
  swarm: { count: 3, life: 0.4, hit: 0.35, rush: 0.75 },
  /**
   * The enemies' size against the other modes' (hits, walls and drawing: Player.radius), the bosses' too; the player and
   * his allies (the Shadow, the undead) keep theirs, and the camera is the waves' (Erick, 15/11/2026: 25% smaller; it was
   * every Orb at 70% that morning).
   */
  enemyScale: 0.75,
  /**
   * The enemies' damage against the waves' (bots, elites, the boss and his attacks; the nuke bot's blast is a share of the
   * player's life and stays): the map is more open, more of them shoot at once (Erick, 15/11/2026: half).
   */
  enemyHit: 0.5,
  /** The player's spread (Player.spreadScale): steadier, the enemies being smaller (Erick, 15/11/2026). */
  spread: 0.5,
  /**
   * How close the enemies shoot from, in cells (BotController.fireRange): the common weapons only once on the player's
   * screen (it shows ~8 cells to each side, ~4.5 up and down), the photon rifle, the sniper and the bazooka from a little
   * off it, never from across the map (Erick, 15/11/2026: they shot at him from off his screen).
   */
  fireRange: { near: 6, far: 10 },
  /**
   * The better crates (Erick, 15/11/2026): each crate dropped is a rare one (blue) at `rare.chance` or an epic one
   * (purple) at `epic.chance` from wave `epic.from`; their life in an SMG bullet's (0.1 each) times the player's damage
   * boost when they come (a few seconds of fire whatever his build). A rare one leaves a big energy (`rare.energy` of a
   * level) or two of the crates' permanent upgrades; an epic one an epic card to choose (`epic.cards`) or a bigger energy.
   */
  crates: {
    // (life 2 and 4 until 20/11/2026, Erick: the crates far too weak)
    rare: { chance: 0.18, life: 6, energy: 0.6 },
    epic: { chance: 0.06, from: 3, life: 12, energy: 1.5, cards: 0.6 },
  },
  /** The energy a fallen enemy leaves: a plain one, an elite (Player.badges), a boss (it also gives the boss's cards). */
  energy: { plain: 1, elite: 3, boss: 60 },
  /**
   * The energy on the floor: taken by walking over it (Erick, 15/11/2026), when it is within the player's radius + `take`;
   * with the Workshop's Magnetism (wavesProgress.ts MAGNET), from its reach it flies to him at `pull` cells a second or more. It never goes away (after Vampire Survivors: none lost), and with more
   * than `most` on the floor a new drop goes into the nearest one, which grows (the game keeps its pace with a crowd).
   */
  floor: { take: 0.1, most: 250, pull: 9 },
  /**
   * Where the enemies come in (cells from the player): just off his screen all around him, after the classic
   * roguelikes, not at the map's far edge (on a map this big they walked past the wave's time and nothing was cleared).
   */
  ring: [11, 15],
} as const;

/** The energy the first wave's enemies leave: the first level up comes with the first wave cleared (Erick). */
const FIRST = Math.round(waveSpec(1).total * HORDE.swarm.count) * HORDE.energy.plain;

/**
 * The energy from level `level` to the next: the first wave's for the first, then more and more (Erick, 16/11/2026:
 * "after a certain level one shouldn't level up so easily"; it grew 6 a level, and the waves' energy grows faster than
 * that: level 144 by wave 100, a card offer a wave or more). Taking all of it: level 8 by wave 10, 15 by 20, 29 by 50,
 * 47 by 100, 62 by 150 (a level every three waves or so by then).
 */
export function energyToNext(level: number): number {
  const k = level - 1;
  return Math.round(FIRST + 2 * HORDE.swarm.count * k + 0.05 * k ** 3);
}
