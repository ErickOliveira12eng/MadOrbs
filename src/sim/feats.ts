// Kill feats with an announcer, like League of Legends: one count, kills without dying, gives Double
// Kill (2), Triple Kill (3), Dominating (4) and Unstoppable (5, then every 5 more); also First Blood,
// Shutdown (ending a streak of 3 or more) and Revenge Kill (killing your killer). Decided where the
// game is authoritative (the server, or the page offline) from Player.dieSV; they go out as 'feat'
// events and each player's counts travel with the scores.
import type { Game } from './game';
import type { Player } from './player';

export type FeatKind = 'firstBlood' | 'double' | 'triple' | 'dominating' | 'unstoppable' | 'shutdown' | 'revenge';

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
  shutdowns: number;
  firstBlood: number;
}

export function newFeats(): PlayerFeats {
  return { streak: 0, lastKilledBy: -1, double: 0, triple: 0, dominating: 0, unstoppable: 0, bestStreak: 0, revenges: 0, shutdowns: 0, firstBlood: 0 };
}

/** [double, triple, dominating, unstoppable, bestStreak, revenges, shutdowns, firstBlood] (the scores message). */
export type FeatCounts = [number, number, number, number, number, number, number, number];

export function featCounts(f: PlayerFeats): FeatCounts {
  return [f.double, f.triple, f.dominating, f.unstoppable, f.bestStreak, f.revenges, f.shutdowns, f.firstBlood];
}

export function applyFeatCounts(f: PlayerFeats, c: readonly number[] | undefined): void {
  if (!c) return;
  [f.double, f.triple, f.dominating, f.unstoppable, f.bestStreak, f.revenges, f.shutdowns, f.firstBlood] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => c[i] ?? 0);
}

/** A real kill (not a suicide, not a team kill): the killer's feats, and the victim's streak ends. */
export function onKill(game: Game, killer: Player, victim: Player): void {
  const k = killer.feats;
  const v = victim.feats;
  const victimStreak = v.streak;
  v.streak = 0;
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
  if (victimStreak >= 3) {
    k.shutdowns++;
    feat('shutdown', victimStreak);
  }
  if (k.lastKilledBy === victim.playerID) {
    k.revenges++;
    k.lastKilledBy = -1;
    feat('revenge');
  }
}

/**
 * Announced to the whole room: Triple Kill and up, First Blood and the end of a streak of 4 or more.
 * Double Kill, small shutdowns and Revenge Kill only to the one who made them.
 */
export function isAnnouncedToAll(kind: FeatKind, n = 0): boolean {
  switch (kind) {
    case 'double':
    case 'revenge':
      return false;
    case 'shutdown':
      return n >= 4;
    default:
      return true;
  }
}

/** Any other death (suicide, team kill, the map): the streak ends, no feat. */
export function onDeath(victim: Player): void {
  victim.feats.streak = 0;
}
