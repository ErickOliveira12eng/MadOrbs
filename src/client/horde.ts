// The Horde (15/11/2026, Erick: a new mode, more like a classic roguelike; in test, the testers' accounts only): the
// waves (src/client/wavesRun.ts) on a map twice as big, with the enemies smaller, and levels inside the run: each enemy
// that falls leaves energy on the floor, the energy taken fills the level bar, and each level up offers three cards.
// Nothing of it counts yet (a tester's run: no record, Cores nor report).
import { waveSpec } from './waves';

/** The waves' CTF-Invaders made twice as big (tools/make-horde-map.mjs). */
export const HORDE_MAP = 'HORDE-Invaders';

export const HORDE = {
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
  /** The energy a fallen enemy leaves: a plain one, an elite (Player.badges), a boss (it also gives the boss's cards). */
  energy: { plain: 1, elite: 3, boss: 20 },
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
const FIRST = waveSpec(1).total * HORDE.energy.plain;

/**
 * The energy from level `level` to the next: the first wave's for the first, then 2 more each level (about a level a
 * wave at first, every second wave by wave 20: the waves bring more enemies, and elites worth more, as they go).
 */
export function energyToNext(level: number): number {
  return FIRST + 2 * (level - 1);
}
