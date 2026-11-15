// The Horde (15/11/2026, Erick: a new mode, more like a classic roguelike; in test, the testers' accounts only): the
// waves (src/client/wavesRun.ts) on a map twice as big, with every Orb smaller, and levels inside the run: each enemy
// that falls leaves energy on the floor, the energy taken fills the level bar, and each level up offers three cards.
// Nothing of it counts yet (a tester's run: no record, Cores nor report).
import { waveSpec } from './waves';

/** The waves' CTF-Invaders made twice as big (tools/make-horde-map.mjs). */
export const HORDE_MAP = 'HORDE-Invaders';

export const HORDE = {
  /** Every Orb's size against the other modes' (hits, walls and drawing: Player.radius), the bosses' too. */
  orbScale: 0.7,
  /** The energy a fallen enemy leaves: a plain one, an elite (Player.badges), a boss (it also gives the boss's cards). */
  energy: { plain: 1, elite: 3, boss: 20 },
  /**
   * The energy on the floor: pulled to the player from `magnet` cells (flying at `speed` cells a second), taken at
   * `take`. It never goes away (after Vampire Survivors: none lost), and with more than `most` on the floor a new drop
   * goes into the nearest one, which grows (the game keeps its pace with a crowd of them). When a wave is cleared,
   * all of it flies to the player (after Brotato's end-of-wave collect): clearing wave 1 always brings level 2.
   */
  floor: { magnet: 1.6, speed: 9, take: 0.3, most: 250 },
  /**
   * Where the enemies come in (cells from the player): just off his screen all around him, after the classic
   * roguelikes, not at the map's far edge (on a map this big they walked past the wave's time and nothing was cleared).
   */
  ring: [11, 15],
} as const;

/** The energy the first wave's enemies leave: the first level up comes with the first wave cleared (Erick). */
const FIRST = waveSpec(1).total * HORDE.energy.plain;

/**
 * The energy from level `level` to the next: the first wave's for the first, then 2 more each level (about a level a
 * wave at first, every second wave by wave 20: the waves bring more enemies, and elites worth more, as they go).
 */
export function energyToNext(level: number): number {
  return FIRST + 2 * (level - 1);
}
