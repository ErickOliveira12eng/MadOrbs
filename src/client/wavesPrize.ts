// The waves' milestone prizes in words and pictures (the Workshop, the end of a run).
import { t } from '../i18n';
import { CAMPAIGN } from './campaign';
import type { Milestone } from './wavesProgress';
import type { CrownTier } from '../sim/crowns';

/** A weapon's picture and name (the campaign's chapters know them all). */
export function weaponLook(weaponID: number): { picture: string; name: string } {
  const c = CAMPAIGN.find((x) => x.chapter.weaponID === weaponID)?.chapter;
  return c ? { picture: `/guia/${c.picture}`, name: t(`w.${c.weaponKey}.name`) } : { picture: '', name: '' };
}

/** A won Orb style's name (the ones the milestones give have one). */
export const orbName = (skin: string): string => t(`orb.${skin}` as 'orb.skin24');

/** A Survival crown's name ("Bronze crown"). */
export const crownName = (tier: CrownTier): string => t(`crown.${tier}`);

/** A crown's picture (tools/make-crown-icons.mjs). */
export const crownPicture = (tier: CrownTier): string => `/menu/crown-${tier}.png`;

/** A milestone's prize, short: the weapon, the Orb or the crown. */
export function prizeName(m: Milestone): string {
  if ('weapon' in m) return weaponLook(m.weapon).name;
  if ('crown' in m) return crownName(m.crown);
  return t('workshop.orbNamed', { name: orbName(m.skin) });
}

/** A milestone's prize, in words. */
export function prizeText(m: Milestone): string {
  if ('weapon' in m) return t('workshop.prizeWeapon', { weapon: weaponLook(m.weapon).name });
  if ('crown' in m) return crownName(m.crown);
  return t('workshop.prizeOrb', { name: orbName(m.skin) });
}

/**
 * A milestone's picture: the weapon's, the crown's, or an Orb to draw in the player's colours (its `data-orb`, filled
 * by the caller; `orb` when it already has the picture).
 */
export function prizeArt(m: Milestone, orb?: string): string {
  if ('weapon' in m) return `<img class="w" src="${weaponLook(m.weapon).picture}" alt="" />`;
  if ('crown' in m) return `<img class="c" src="${crownPicture(m.crown)}" alt="" />`;
  return orb ? `<img class="o" src="${orb}" alt="" />` : `<img class="o" data-orb="${m.skin}" alt="" />`;
}
