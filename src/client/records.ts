// Personal records kept in this browser: the most kills in one online match, per mode. A signed-in
// player's record is also kept by the account (player_stats.best_kills); the start of a game uses the
// higher of the two.
import type { RoomMode } from '../net/protocol';

const KEY = 'madorbs.records';

function read(): Partial<Record<RoomMode, number>> {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<RoomMode, unknown>>;
    return Object.fromEntries(Object.entries(r).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) as Partial<Record<RoomMode, number>>;
  } catch {
    return {};
  }
}

export function bestKills(mode: RoomMode): number {
  return read()[mode] ?? 0;
}

export function saveBestKills(mode: RoomMode, kills: number): void {
  const r = read();
  if (kills <= (r[mode] ?? 0)) return;
  r[mode] = kills;
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* storage unavailable: the record lasts for this page */
  }
}
