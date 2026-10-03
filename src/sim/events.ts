// Events emitted by the simulation for the client (visuals / sounds / HUD).
// They correspond to the network messages the original server sent (NET_SVCL_*) plus the
// immediate client-side feedback the shooter's own client produced (Weapon::shoot).
import type { FeatKind } from './feats';
import type { Vec3 } from './vec';

/** What happened to a CTF flag. */
export type FlagReason = 'took' | 'returned' | 'captured' | 'dropped';

export type GameEvent =
  /** A weapon was fired by `playerID` (nuzzle flash, fire sound, firing smoke, casing). Weapon::shoot. */
  | { type: 'fire'; playerID: number; weaponID: number; nuzzleID: number; origin: Vec3; direction: Vec3 }
  /** Result of one traced shot (one per pellet). NET_SVCL_PLAYER_SHOOT / Weapon::shoot(playerShoot). */
  | { type: 'shoot'; playerID: number; weaponID: number; nuzzleID: number; p1: Vec3; p2: Vec3; normal: Vec3; hitPlayerID: number }
  | { type: 'photonCharge'; playerID: number; position: Vec3 }
  | { type: 'overheat'; playerID: number; position: Vec3 }
  | { type: 'shotgunReload'; playerID: number; position: Vec3 }
  /** Secondary weapon used (knives / shield sound + animation). Weapon::shootMelee. */
  | { type: 'melee'; playerID: number; weaponID: number }
  /** A projectile was created (launchPosition/launchVel: the request's origin and direction). */
  | { type: 'projectileSpawn'; uniqueID: number; nuzzleID: number; launchPosition: Vec3; launchVel: Vec3 }
  | { type: 'projectileRemoved'; uniqueID: number }
  | { type: 'grenadeRebound'; position: Vec3 }
  /** NET_SVCL_EXPLOSION */
  | { type: 'explosion'; position: Vec3; normal: Vec3; radius: number; playerID: number }
  /** NET_SVCL_PLAY_SOUND (molotov, ...) */
  | { type: 'sound'; soundID: number; position: Vec3; volume: number; range: number; playerID?: number }
  /** Online client: our own shot touched this babo on our screen (blood and hit marker right away; the server confirms with 'hit'). */
  | { type: 'hitPredicted'; playerID: number; fromID: number; weaponID: number; position: Vec3 }
  /** NET_SVCL_PLAYER_HIT: `life` is the victim's life after the hit, `damage` the amount removed. */
  | { type: 'hit'; playerID: number; fromID: number; weaponID: number; damage: number; life: number; position: Vec3 }
  /** A player died (kill message, death sound, blood). */
  | { type: 'death'; playerID: number; fromID: number; weaponID: number; friendlyFire: boolean; position: Vec3 }
  /** A kill feat of playerID (src/sim/feats.ts); n: the spree length (sprees) or the streak ended (shutdown). */
  | { type: 'feat'; playerID: number; feat: FeatKind; victimID: number; n?: number }
  /** NET_SVCL_PLAYER_SPAWN: where the server placed the babo and with which weapons. */
  | { type: 'spawn'; playerID: number; position: Vec3; weaponID: number; meleeID: number }
  | { type: 'switchWeapon'; playerID: number; weaponID: number }
  /** NET_SVCL_PICKUP_ITEM */
  | { type: 'pickup'; playerID: number; itemType: number; itemFlag: number }
  | { type: 'flameStick'; uniqueID: number; playerID: number }
  | { type: 'nukeBotSpawn'; playerID: number }
  | { type: 'nukeBeep'; playerID: number }
  | { type: 'roundState'; state: number }
  /**
   * NET_SVCL_CHANGE_FLAG_STATE / NET_SVCL_DROP_FLAG (CTF): flag `flagID` (FLAG_BLUE, FLAG_RED) is now
   * `state` (FLAG_ON_POD, FLAG_DROPPED at `position`, or the carrier's playerID); `playerID` did it.
   */
  | { type: 'flag'; flagID: number; state: number; playerID: number; position: Vec3; reason: FlagReason }
  /** Server::autoBalance moved a player to the other team. */
  | { type: 'teamChange'; playerID: number; teamID: number }
  | { type: 'mapChange'; mapName: string }
  | { type: 'playerJoin'; playerID: number }
  | { type: 'playerLeave'; playerID: number }
  /**
   * playerID -1: the server's own line. `sys` 'join' / 'leave' (with `text` the player's name and
   * `team` their team, or -1) are written by each client in its language.
   */
  | { type: 'chat'; playerID: number; text: string; sys?: 'join' | 'leave' | 'admin'; team?: number };

export class EventQueue {
  private list: GameEvent[] = [];

  push(e: GameEvent): void {
    this.list.push(e);
  }

  /** Returns and clears pending events. */
  drain(): GameEvent[] {
    const l = this.list;
    this.list = [];
    return l;
  }
}
