// The Vesuvius (31/10/2026, Erick: the prize of whoever gets past wave 100 of the Waves): a boss fight on the volcano
// map (src/client/vesuviusRun.ts). Who may play it
// is the server's call (GET /api/vesuvius, src/server/index.ts): an account whose record, checked by the server
// (src/server/wavesCheck.ts), is past VESUVIUS_WAVE, or a tester's (DEBUG_USER_IDS) with "everything unlocked" ticked
// in the account window. The Workshop shows it locked to everybody else (src/menu/wavesModal.ts).

/** The volcano map (tools/make-boss-map.mjs: CTF-Reticulated made over). */
export const VESUVIUS_MAP = 'BOSS-Vesuvio';

/** The record (the highest wave reached) must be past this wave: this one beaten. */
export const VESUVIUS_WAVE = 100;

export const vesuviusOpen = (record: number): boolean => record > VESUVIUS_WAVE;

/**
 * The numbers the server's check of a run needs too (src/server/vesuviusCheck.ts; the rest of the rules are VES in
 * src/client/vesuviusRun.ts): the volcano's bar in bars of an ordinary Orb, the seconds it erupts between two phases
 * (untouchable), the seconds a death adds to the time.
 */
export const VESUVIUS_BOSS_LIFE = 150;
export const VESUVIUS_ERUPTION = 4.5;
export const VESUVIUS_DEATH_PENALTY = 15;

/** GET /api/vesuvius's answer. */
export interface VesuviusAccess {
  open: boolean;
  /** The account's checked record (null: no account, or the database unread). */
  wave: number | null;
  /** Open as a tester's account. */
  test: boolean;
  /** Why it isn't: no account signed in, or no way to read the records. */
  reason?: 'signin' | 'unknown';
}
