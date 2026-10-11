// The waves' milestone prizes in words and pictures (the Workshop, the end of a run).
import { t } from '../i18n';
import { CAMPAIGN } from './campaign';
import type { Milestone } from './wavesProgress';

/** A weapon's picture and name (the campaign's chapters know them all). */
export function weaponLook(weaponID: number): { picture: string; name: string } {
  const c = CAMPAIGN.find((x) => x.chapter.weaponID === weaponID)?.chapter;
  return c ? { picture: `/guia/${c.picture}`, name: t(`w.${c.weaponKey}.name`) } : { picture: '', name: '' };
}

/** An exclusive Orb's name. */
export const orbName = (skin: string): string => t(`orb.${skin}` as 'orb.skin24');

/** A milestone's prize, in words. */
export function prizeText(m: Milestone): string {
  return 'weapon' in m ? t('workshop.prizeWeapon', { weapon: weaponLook(m.weapon).name }) : t('workshop.prizeOrb', { name: orbName(m.skin) });
}
