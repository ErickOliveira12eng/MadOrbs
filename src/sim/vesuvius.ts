// The Vesuvius (31/10/2026, Erick: the prize of whoever gets past wave 100 of the Waves): a mode on the volcano map,
// with a boss standing in the middle, still being made; for now the map alone, empty, to walk around. Who may play it
// is the server's call (GET /api/vesuvius, src/server/index.ts): an account whose record, checked by the server
// (src/server/wavesCheck.ts), is past VESUVIUS_WAVE, or a tester's (DEBUG_USER_IDS) with "everything unlocked" ticked
// in the account window. The Workshop shows it locked to everybody else (src/menu/wavesModal.ts).

/** The volcano map (tools/make-boss-map.mjs: CTF-Reticulated made over). */
export const VESUVIUS_MAP = 'BOSS-Vesuvio';

/** The record (the highest wave reached) must be past this wave: this one beaten. */
export const VESUVIUS_WAVE = 100;

export const vesuviusOpen = (record: number): boolean => record > VESUVIUS_WAVE;

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
