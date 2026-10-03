// Kill feats, like League of Legends' announcements: multi-kills (Double Kill .. Penta Kill: each kill
// within MULTI_KILL_WINDOW of the previous one), killing sprees without dying (3: Killing Spree ..
// 8+: Legendary), First Blood, Shutdown (ending someone's spree) and Revenge (killing your killer).
// Decided where the game is authoritative (the server, or the page offline) from Player.dieSV; they
// go out as 'feat' events and each player's counts travel with the scores.
import { TICK_RATE } from './constants';
import type { Game } from './game';
import type { Player } from './player';

/** Seconds allowed between two kills of a multi-kill (LoL uses 10 s; matches here are faster). */
export const MULTI_KILL_WINDOW = 6;

export type FeatKind =
  | 'firstBlood'
  | 'double'
  | 'triple'
  | 'quadra'
  | 'penta'
  | 'spree'
  | 'rampage'
  | 'unstoppable'
  | 'dominating'
  | 'godlike'
  | 'legendary'
  | 'shutdown'
  | 'revenge';

/** Kills in a row without dying -> the spree announced (every 2 kills from 8 on: Legendary). */
const SPREES: Record<number, FeatKind> = { 3: 'spree', 4: 'rampage', 5: 'unstoppable', 6: 'dominating', 7: 'godlike' };
const MULTI: Record<number, FeatKind> = { 2: 'double', 3: 'triple', 4: 'quadra', 5: 'penta' };

/** A player's feats in the current match (and the state that leads to them). */
export interface PlayerFeats {
  /** Kills since the last death. */
  streak: number;
  /** Kills in the current multi-kill. */
  multi: number;
  lastKillAt: number;
  /** Who killed us last (-1: nobody, or already avenged). */
  lastKilledBy: number;
  // Counts shown on the score table and at the end of the match
  double: number;
  triple: number;
  quadra: number;
  penta: number;
  bestStreak: number;
  revenges: number;
  shutdowns: number;
  firstBlood: number;
}

export function newFeats(): PlayerFeats {
  return { streak: 0, multi: 0, lastKillAt: -1e9, lastKilledBy: -1, double: 0, triple: 0, quadra: 0, penta: 0, bestStreak: 0, revenges: 0, shutdowns: 0, firstBlood: 0 };
}

/** [double, triple, quadra, penta, bestStreak, revenges, shutdowns, firstBlood] (the scores message). */
export type FeatCounts = [number, number, number, number, number, number, number, number];

export function featCounts(f: PlayerFeats): FeatCounts {
  return [f.double, f.triple, f.quadra, f.penta, f.bestStreak, f.revenges, f.shutdowns, f.firstBlood];
}

export function applyFeatCounts(f: PlayerFeats, c: readonly number[] | undefined): void {
  if (!c) return;
  [f.double, f.triple, f.quadra, f.penta, f.bestStreak, f.revenges, f.shutdowns, f.firstBlood] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => c[i] ?? 0);
}

/** A real kill (not a suicide, not a team kill): the killer's feats, and the victim's streak ends. */
export function onKill(game: Game, killer: Player, victim: Player): void {
  const now = game.frame / TICK_RATE;
  const k = killer.feats;
  const v = victim.feats;
  const victimStreak = v.streak;
  v.streak = 0;
  v.multi = 0;
  v.lastKilledBy = killer.playerID;
  const feat = (kind: FeatKind, n?: number) => game.events.push({ type: 'feat', playerID: killer.playerID, feat: kind, victimID: victim.playerID, n });

  if (!game.firstBloodDone) {
    game.firstBloodDone = true;
    k.firstBlood++;
    feat('firstBlood');
  }
  k.streak++;
  k.bestStreak = Math.max(k.bestStreak, k.streak);
  k.multi = now - k.lastKillAt <= MULTI_KILL_WINDOW && k.multi < 5 ? k.multi + 1 : 1;
  k.lastKillAt = now;
  const multi = MULTI[k.multi];
  if (multi) {
    k[multi as 'double' | 'triple' | 'quadra' | 'penta']++;
    feat(multi);
  }
  const spree = SPREES[k.streak] ?? (k.streak >= 8 && k.streak % 2 === 0 ? 'legendary' : undefined);
  if (spree) feat(spree, k.streak);
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
 * Announced to the whole room: the big feats (Triple Kill and up, First Blood, sprees from 5 on, the
 * end of a spree of 5 or more). The others (Double Kill, sprees of 3 and 4, small shutdowns, Revenge)
 * only to the one who made them: a match with 8 players gives one feat every few seconds.
 */
export function isAnnouncedToAll(kind: FeatKind, n = 0): boolean {
  switch (kind) {
    case 'double':
    case 'spree':
    case 'rampage':
    case 'revenge':
      return false;
    case 'shutdown':
      return n >= 5;
    default:
      return true;
  }
}

/** Any other death (suicide, team kill, the map): the streak and the multi-kill end, no feat. */
export function onDeath(victim: Player): void {
  victim.feats.streak = 0;
  victim.feats.multi = 0;
}
