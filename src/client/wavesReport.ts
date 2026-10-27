// The waves runs told to the game server (src/server/wavesRuns.ts: the admin page's "Ondas" screen; ClientGame calls it): when one starts
// (with the session, so the server knows the account) and when it ends. With the statistics allowed (the cookie
// banner, public/consent.js), a random identifier of this browser goes with it (madorbs.visitor) to count the guests
// who come back; without, the run is counted but tied to nobody. A failed report is dropped. Since 26/10/2026 also when
// each wave starts: the server checks the end against those times before the record counts (src/server/wavesCheck.ts),
// and it alone writes the account's record.
import { lang } from '../i18n';

export type WavesRunReport =
  | { phase: 'start'; id: string; startWave: number; weapon: number; power: number; levels: Record<string, number> }
  | { phase: 'wave'; id: string; wave: number }
  | {
      phase: 'end';
      id: string;
      wave: number;
      kills: number;
      seconds: number;
      cores: number;
      bosses: number;
      cards: { id: string; level: number }[];
      result: 'died' | 'quit' | 'closed';
      best: boolean;
      test: boolean;
      fps: number;
      /** The ranking's time to the wave and the checkpoints' times (WavesEnd), null and {} when unknown */
      time: number | null;
      splits: Record<number, number>;
    };

const VISITOR_KEY = 'madorbs.visitor';

/** This browser's random identifier, made the first time (null when the statistics are refused) */
export function visitor(): string | null {
  const consent = (window as unknown as { madorbsConsent?: { allows: (k: string) => boolean } }).madorbsConsent;
  if (!consent?.allows('analytics')) return null;
  try {
    let v = localStorage.getItem(VISITOR_KEY);
    if (!v || !/^[a-z0-9]{8,32}$/.test(v)) {
      v = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('');
      localStorage.setItem(VISITOR_KEY, v);
    }
    return v;
  } catch {
    return null;
  }
}

/** A run's id (crypto.randomUUID only exists on https and localhost: elsewhere, made by hand) */
export function newRunId(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const h = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Sends a report; `token`: the session (the start of a run signed in). keepalive: it still goes as the tab closes. */
export function reportWavesRun(report: WavesRunReport, token?: string): void {
  try {
    void fetch('/api/waves/run', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ ...report, visitor: visitor(), lang: lang() }),
    }).catch(() => {});
  } catch {
    // No fetch: nothing to tell
  }
}
