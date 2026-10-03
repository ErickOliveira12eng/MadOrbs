// What the HUD and the weapon cards say about each weapon, in the page's language: the name, the
// name in the original game, and the numbers of the rules this game runs with (sv_*Damage, fireDelay... in
// gameVar.ts, the "Pro" values the server uses). Damage is shown with a full life = 100.
import {
  PRIMARY_WEAPONS, SECONDARY_WEAPONS, SERVER_TYPE_PRO, WEAPON_BAZOOKA, WEAPON_CHAIN_GUN, WEAPON_COCKTAIL_MOLOTOV,
  WEAPON_DUAL_MACHINE_GUN, WEAPON_FLAME_THROWER, WEAPON_GRENADE, WEAPON_KNIVES, WEAPON_MINIBOT,
  WEAPON_NUCLEAR, WEAPON_PHOTON_RIFLE, WEAPON_SHIELD, WEAPON_SHOTGUN, WEAPON_SMG, WEAPON_SNIPER,
} from '../../sim/constants';
import { bazookaDamage, isWeaponEnabled, sv, weaponDefs } from '../../sim/gameVar';
import { num, t } from '../../i18n';

export interface WeaponStat {
  label: string;
  /** 0..1, for the bar. */
  value: number;
  text: string;
}

export interface WeaponInfo {
  id: number;
  /** Name in the page's language. */
  name: string;
  /** Name in the original game (English). */
  original: string;
  /** Short label for the small cards of the death screen. */
  short: string;
  /** Article used in "got you with the Shotgun" ("a" Escopeta, "la" Escopeta). */
  article: string;
  /** Damage, fire rate and accuracy (primary weapons). */
  stats: WeaponStat[];
  tip: string;
  /** "Cooldown 3 s" (secondary weapons). */
  cooldown?: string;
}

/** Each weapon's dictionary key (w.<key>.name, .short, .art) and its name in the original game. */
const NAMES: Record<number, [key: WeaponKey, original: string]> = {
  [WEAPON_SMG]: ['smg', 'Sub Machine Gun'],
  [WEAPON_SHOTGUN]: ['shotgun', 'Shotgun'],
  [WEAPON_SNIPER]: ['sniper', 'Sniper Rifle'],
  [WEAPON_DUAL_MACHINE_GUN]: ['dmg', 'Dual Machine Gun'],
  [WEAPON_CHAIN_GUN]: ['chaingun', 'Chain Gun'],
  [WEAPON_BAZOOKA]: ['bazooka', 'Bazooka'],
  [WEAPON_PHOTON_RIFLE]: ['photon', 'Photon Rifle'],
  [WEAPON_FLAME_THROWER]: ['flame', 'Flame Thrower'],
  [WEAPON_GRENADE]: ['grenade', 'Grenade'],
  [WEAPON_COCKTAIL_MOLOTOV]: ['molotov', 'Molotov Cocktail'],
  [WEAPON_KNIVES]: ['knives', 'Popup Knives'],
  [WEAPON_NUCLEAR]: ['nuke', 'Nuke Bot'],
  [WEAPON_SHIELD]: ['shield', 'Instant Shield'],
  [WEAPON_MINIBOT]: ['minibot', 'Mini Bot'],
};
type WeaponKey = 'smg' | 'shotgun' | 'sniper' | 'dmg' | 'chaingun' | 'bazooka' | 'photon' | 'flame' | 'grenade' | 'molotov' | 'knives' | 'nuke' | 'shield' | 'minibot';

/** Player::hitSV, sv_photonType 1, right in front of the gun: the most a photon beam does. */
function photonMaxDamage(): number {
  const base = weaponDefs[WEAPON_PHOTON_RIFLE].damage;
  return base * (sv.sv_photonVerticalShift + sv.sv_photonDamageCoefficient * (Math.PI / 2 - Math.atan(-sv.sv_photonHorizontalShift * sv.sv_photonDistMult)));
}

/** Damage of one shot (all its pellets / bullets), life = 100, and how to write it. */
function shotDamage(id: number): [number, string] {
  const def = weaponDefs[id];
  switch (id) {
    case WEAPON_SMG:
      return [sv.sv_smgDamage * 100, num(sv.sv_smgDamage * 100)];
    case WEAPON_SHOTGUN:
      return [def.nbShot * sv.sv_shottyDamage * 100, `${def.nbShot}×${num(sv.sv_shottyDamage * 100)}`];
    case WEAPON_SNIPER:
      // Game.handleShootNet: 2 bullets, 3 with the camera up high
      return [2 * sv.sv_sniperDamage * 100, num(2 * sv.sv_sniperDamage * 100)];
    case WEAPON_DUAL_MACHINE_GUN:
      return [sv.sv_dmgDamage * 100, num(sv.sv_dmgDamage * 100)];
    case WEAPON_CHAIN_GUN:
      return [sv.sv_cgDamage * 100, num(sv.sv_cgDamage * 100)];
    case WEAPON_BAZOOKA:
      return [bazookaDamage() * 100, num(bazookaDamage() * 100)];
    case WEAPON_PHOTON_RIFLE:
      return [photonMaxDamage() * 100, t('stat.upTo', { n: num(photonMaxDamage() * 100, 0) })];
    case WEAPON_FLAME_THROWER:
      return [sv.sv_ftDamage * 100, t('stat.upTo', { n: num(sv.sv_ftDamage * 100) })];
    default:
      return [def.damage * 100, num(def.damage * 100)];
  }
}

function tip(id: number): string {
  const def = weaponDefs[id];
  switch (id) {
    case WEAPON_SMG:
      return t('tip.smg');
    case WEAPON_SHOTGUN:
      return t('tip.shotgun', { pellets: def.nbShot, range: num(sv.sv_shottyRange, 0) });
    case WEAPON_SNIPER:
      return t('tip.sniper', { dmg: num(3 * sv.sv_sniperDamage * 100) });
    case WEAPON_DUAL_MACHINE_GUN:
      return t('tip.dmg');
    case WEAPON_CHAIN_GUN:
      return t('tip.chaingun');
    case WEAPON_BAZOOKA:
      // Remote detonation (Weapon.shoot / Game.handleProjectileRequest): a new click while it flies
      return sv.sv_zookaRemoteDet && sv.sv_serverType === SERVER_TYPE_PRO
        ? t('tip.bazookaRemote', { radius: num(sv.sv_zookaRadius) })
        : t('tip.bazooka', { radius: num(sv.sv_zookaRadius) });
    case WEAPON_PHOTON_RIFLE:
      return t('tip.photon');
    case WEAPON_FLAME_THROWER:
      return t('tip.flame', { range: num(sv.sv_ftMaxRange) });
    case WEAPON_KNIVES:
      return t('tip.knives', { damage: num(def.damage * 100) });
    case WEAPON_NUCLEAR:
      return t('tip.nuke', { timer: num(sv.sv_nukeTimer), radius: num(sv.sv_nukeRadius) });
    case WEAPON_SHIELD:
      return t('tip.shield');
    default:
      return '';
  }
}

/** Spread (Weapon::impressision) as a 0..1 accuracy and a word. */
function accuracy(id: number): WeaponStat {
  const def = weaponDefs[id];
  if (def.nbShot > 1) return { label: t('stat.accuracy'), value: 0.15, text: t('acc.cone') };
  const v = def.imp <= 0 ? 1 : Math.max(0.15, 1 - def.imp / 20);
  const text = t(v >= 0.95 ? 'acc.max' : v >= 0.55 ? 'acc.good' : v >= 0.4 ? 'acc.medium' : 'acc.low');
  return { label: t('stat.accuracy'), value: v, text };
}

export function weaponInfo(id: number): WeaponInfo {
  const entry = NAMES[id];
  const def = weaponDefs[id];
  const fallback = def?.name ?? '?';
  const info: WeaponInfo = entry
    ? { id, name: t(`w.${entry[0]}.name`), original: entry[1], short: t(`w.${entry[0]}.short`), article: t(`w.${entry[0]}.art`), stats: [], tip: tip(id) }
    : { id, name: fallback, original: fallback, short: fallback, article: '', stats: [], tip: '' };
  if ((PRIMARY_WEAPONS as readonly number[]).includes(id)) {
    const [dmg, dmgText] = shotDamage(id);
    const rate = 1 / def.fireDelay;
    // Square roots: the SMG's 10 and the shotgun's 105 both read on the same bar
    info.stats = [
      { label: t('stat.damage'), value: Math.sqrt(Math.min(1, dmg / 105)), text: dmgText },
      { label: t('stat.rate'), value: Math.sqrt(Math.min(1, rate / 10)), text: t('stat.perSecond', { n: num(rate) }) },
      accuracy(id),
    ];
  } else if ((SECONDARY_WEAPONS as readonly number[]).includes(id)) {
    info.cooldown = t('stat.cooldown', { n: num(def.fireDelay) });
  }
  return info;
}

/** The primary weapons this server allows, in the order of the original menu. */
export function enabledPrimaries(): number[] {
  return PRIMARY_WEAPONS.filter((id) => isWeaponEnabled(id));
}

/** The secondary weapons this server allows (none when sv_enableSecondary is off). */
export function enabledSecondaries(): number[] {
  return SECONDARY_WEAPONS.filter((id) => isWeaponEnabled(id));
}
