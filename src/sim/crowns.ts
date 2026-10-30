// The Survival crowns (Erick, 29/10/2026): a look only, worn on top of the Orb by who reached wave 25 (bronze), 50
// (silver) or 100 (gold) of the waves, offline and online (where the game server checks the account's record). The
// model is src/client/render/crown.ts; this is what the browser and the server share.

export type CrownTier = 'bronze' | 'silver' | 'gold';
export const CROWN_TIERS: CrownTier[] = ['bronze', 'silver', 'gold'];
/** The record (highest wave) that gives each crown. */
export const CROWN_WAVES: Record<CrownTier, number> = { bronze: 25, silver: 50, gold: 100 };

export const isCrownTier = (v: unknown): v is CrownTier => v === 'bronze' || v === 'silver' || v === 'gold';

/** The best crown a record gives, or null. */
export function crownFor(record: number): CrownTier | null {
  return record >= CROWN_WAVES.gold ? 'gold' : record >= CROWN_WAVES.silver ? 'silver' : record >= CROWN_WAVES.bronze ? 'bronze' : null;
}

/** Whether `best` (the best crown someone may wear) allows wearing `tier`: the same one or a lesser one. */
export const crownAllowed = (tier: CrownTier, best: CrownTier | null): boolean => !!best && CROWN_TIERS.indexOf(tier) <= CROWN_TIERS.indexOf(best);
