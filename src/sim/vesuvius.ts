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

/**
 * The levels (Erick, 01/11/2026: more than one, without end like the Waves): beating level n opens n + 1. Level n's
 * volcano has VESUVIUS_LEVEL_STEP more life and damage a level than the first's, its adds come VESUVIUS_LEVEL_WAVES
 * waves stronger a level, its Obsidian is as much more (vesuviusScale). The server lets an account start at most one
 * level past the highest it checked won.
 */
export const VESUVIUS_LEVEL_STEP = 0.25;
export const VESUVIUS_LEVEL_WAVES = 3;
export const VESUVIUS_MAX_LEVEL = 10000;
export const vesuviusScale = (level: number): number => 1 + VESUVIUS_LEVEL_STEP * (Math.max(1, Math.floor(level)) - 1);

/** GET /api/vesuvius's answer. */
export interface VesuviusAccess {
  open: boolean;
  /** The account's checked record (null: no account, or the database unread). */
  wave: number | null;
  /** Open as a tester's account. */
  test: boolean;
  /** The highest level the server checked won (0: none), and the highest the account may start (that one + 1). */
  level?: number;
  maxLevel?: number;
  /** Why it isn't: no account signed in, or no way to read the records. */
  reason?: 'signin' | 'unknown';
}
