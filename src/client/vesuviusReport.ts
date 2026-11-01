// The Vesuvius's runs told to the game server (src/server/vesuviusRuns.ts; ClientGame calls it): the start (with the
// session: only an account's run can be ranked), each phase as it begins, the end. The server keeps its own clock of
// them and checks a win before its time reaches the ranking (src/server/vesuviusCheck.ts). A failed report is dropped.
// Since 01/11/2026 the server also writes each run for the admin page's "Vesúvio" screen: the start carries the weapon
// and the Forge, the end how it ended, the phase reached, the bar taken, the kills, the Obsidian and the frame rate.
import { lang } from '../i18n';

export type VesuviusRunReport =
  | { phase: 'start'; id: string; weapon: number; levels: Record<string, number> }
  | { phase: 'phase'; id: string; n: number }
  | {
      phase: 'end';
      id: string;
      won: boolean;
      result: 'won' | 'died' | 'quit' | 'closed';
      /** The phase it ended in (1 to 3), the share of the volcano's bar taken (0 to 1). */
      reached: number;
      share: number;
      seconds: number;
      deaths: number;
      kills: number;
      obsidian: number;
      fps: number;
    };

/** Sends a report; `token`: the session (the start). keepalive: it still goes as the tab closes. */
export function reportVesuviusRun(report: VesuviusRunReport, token?: string): void {
  try {
    void fetch('/api/vesuvius/run', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(report.phase === 'start' ? { ...report, lang: lang() } : report),
    }).catch(() => {});
  } catch {
    // No fetch: nothing to tell
  }
}
