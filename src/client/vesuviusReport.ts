// The Vesuvius's runs told to the game server (src/server/vesuviusRuns.ts; ClientGame calls it): the start (with the
// session: only an account's run can be ranked), each phase as it begins, the end. The server keeps its own clock of
// them and checks a win before its time reaches the ranking (src/server/vesuviusCheck.ts). A failed report is dropped.
export type VesuviusRunReport =
  | { phase: 'start'; id: string }
  | { phase: 'phase'; id: string; n: number }
  | { phase: 'end'; id: string; won: boolean; seconds: number; deaths: number };

/** Sends a report; `token`: the session (the start). keepalive: it still goes as the tab closes. */
export function reportVesuviusRun(report: VesuviusRunReport, token?: string): void {
  try {
    void fetch('/api/vesuvius/run', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(report),
    }).catch(() => {});
  } catch {
    // No fetch: nothing to tell
  }
}
