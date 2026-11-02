// The Survival crowns (Erick, 29/10/2026): a look only, worn on top of the Orb by who reached wave 25 (bronze), 50
// (silver), 100 (gold) or 200 (platinum, a little bigger: Erick, 02/11/2026) of the waves, offline and online (where
// the game server checks the account's record). The model is src/client/render/crown.ts; this is what the browser and
// the server share.

export type CrownTier = 'bronze' | 'silver' | 'gold' | 'platinum';
/** Every crown, the lesser first. */
export const CROWN_TIERS: CrownTier[] = ['bronze', 'silver', 'gold', 'platinum'];
/** The record (highest wave) that gives each crown. */
export const CROWN_WAVES: Record<CrownTier, number> = { bronze: 25, silver: 50, gold: 100, platinum: 200 };

export const isCrownTier = (v: unknown): v is CrownTier => CROWN_TIERS.includes(v as CrownTier);

/** The best crown a record gives, or null. */
export function crownFor(record: number): CrownTier | null {
  for (let i = CROWN_TIERS.length - 1; i >= 0; i--) if (record >= CROWN_WAVES[CROWN_TIERS[i]]) return CROWN_TIERS[i];
  return null;
}

/** Whether `best` (the best crown someone may wear) allows wearing `tier`: the same one or a lesser one. */
export const crownAllowed = (tier: CrownTier, best: CrownTier | null): boolean => !!best && CROWN_TIERS.indexOf(tier) <= CROWN_TIERS.indexOf(best);
