// Kill feats with an announcer, like League of Legends: one count, kills without dying, gives Double
// Kill (2), Triple Kill (3), Dominating (4) and Unstoppable (5, then every 5 more); also First Blood
// and Revenge Kill (killing your killer); dying with a streak of 3 or more is Mission Failed (for the
// one who died). Decided where the game is authoritative (the server, or the page offline) from
// Player.dieSV; they go out as 'feat' events and each player's counts travel with the scores.
import type { Game } from './game';
import type { Player } from './player';

export type FeatKind = 'firstBlood' | 'double' | 'triple' | 'dominating' | 'unstoppable' | 'revenge' | 'missionFailed';

/** Kills without dying -> the feat announced (Unstoppable again every 5 more: 10, 15...). */
const STREAK: Record<number, FeatKind> = { 2: 'double', 3: 'triple', 4: 'dominating', 5: 'unstoppable' };

/** A player's feats in the current match (and the state that leads to them). */
export interface PlayerFeats {
  /** Kills since the last death. */
  streak: number;
  /** Who killed us last (-1: nobody, or already avenged). */
  lastKilledBy: number;
  // Counts shown on the score table and at the end of the match
  double: number;
  triple: number;
  dominating: number;
  unstoppable: number;
  bestStreak: number;
  revenges: number;
  firstBlood: number;
}

export function newFeats(): PlayerFeats {
  return { streak: 0, lastKilledBy: -1, double: 0, triple: 0, dominating: 0, unstoppable: 0, bestStreak: 0, revenges: 0, firstBlood: 0 };
}

/** [double, triple, dominating, unstoppable, bestStreak, revenges, firstBlood] (the scores message). */
export type FeatCounts = [number, number, number, number, number, number, number];

export function featCounts(f: PlayerFeats): FeatCounts {
  return [f.double, f.triple, f.dominating, f.unstoppable, f.bestStreak, f.revenges, f.firstBlood];
}

export function applyFeatCounts(f: PlayerFeats, c: readonly number[] | undefined): void {
  if (!c) return;
  [f.double, f.triple, f.dominating, f.unstoppable, f.bestStreak, f.revenges, f.firstBlood] = [0, 1, 2, 3, 4, 5, 6].map((i) => c[i] ?? 0);
}

/** A real kill (not a suicide, not a team kill): the killer's feats, and the victim's streak ends. */
export function onKill(game: Game, killer: Player, victim: Player): void {
  const k = killer.feats;
  const v = victim.feats;
  streakLost(game, victim, killer);
  v.lastKilledBy = killer.playerID;
  const feat = (kind: FeatKind, n?: number) => game.events.push({ type: 'feat', playerID: killer.playerID, feat: kind, victimID: victim.playerID, n });

  if (!game.firstBloodDone) {
    game.firstBloodDone = true;
    k.firstBlood++;
    feat('firstBlood');
  }
  k.streak++;
  k.bestStreak = Math.max(k.bestStreak, k.streak);
  const streak = STREAK[k.streak] ?? (k.streak > 5 && k.streak % 5 === 0 ? 'unstoppable' : undefined);
  if (streak) {
    k[streak as 'double' | 'triple' | 'dominating' | 'unstoppable']++;
    feat(streak, k.streak);
  }
  if (k.lastKilledBy === victim.playerID) {
    k.revenges++;
    k.lastKilledBy = -1;
    feat('revenge');
  }
}

/**
 * Announced to the whole room: Triple Kill and up, and First Blood. Double Kill, Revenge Kill and
 * Mission Failed only to the player they are about.
 */
export function isAnnouncedToAll(kind: FeatKind): boolean {
  return kind !== 'double' && kind !== 'revenge' && kind !== 'missionFailed';
}

/** Any other death (suicide, team kill, the map): the streak ends. */
export function onDeath(game: Game, victim: Player): void {
  streakLost(game, victim, null);
}

/** The streak ends; after a Triple Kill (3 or more) that's Mission Failed for the one who died. */
function streakLost(game: Game, victim: Player, killer: Player | null): void {
  const n = victim.feats.streak;
  victim.feats.streak = 0;
  if (n >= 3) game.events.push({ type: 'feat', playerID: victim.playerID, feat: 'missionFailed', victimID: killer?.playerID ?? -1, n });
}
