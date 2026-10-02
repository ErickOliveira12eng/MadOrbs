// What the HUD and the weapon cards say about each weapon: the Portuguese name, the name in the
// original game, and the numbers of the rules this game runs with (sv_*Damage, fireDelay... in
// gameVar.ts, the "Pro" values the server uses). Damage is shown with a full life = 100.
import {
  PRIMARY_WEAPONS, SECONDARY_WEAPONS, SERVER_TYPE_PRO, WEAPON_BAZOOKA, WEAPON_CHAIN_GUN, WEAPON_COCKTAIL_MOLOTOV,
  WEAPON_DUAL_MACHINE_GUN, WEAPON_FLAME_THROWER, WEAPON_GRENADE, WEAPON_KNIVES, WEAPON_MINIBOT,
  WEAPON_NUCLEAR, WEAPON_PHOTON_RIFLE, WEAPON_SHIELD, WEAPON_SHOTGUN, WEAPON_SMG, WEAPON_SNIPER,
} from '../../sim/constants';
import { bazookaDamage, isWeaponEnabled, sv, weaponDefs } from '../../sim/gameVar';

export interface WeaponStat {
  label: string;
  /** 0..1, for the bar. */
  value: number;
  text: string;
}

export interface WeaponInfo {
  id: number;
  /** Portuguese name. */
  name: string;
  /** Name in the original game (English). */
  original: string;
  /** Short label for the small cards of the death screen. */
  short: string;
  /** Article used in "te pegou com a Escopeta". */
  article: 'a' | 'o' | 'as';
  /** Damage, fire rate and accuracy (primary weapons). */
  stats: WeaponStat[];
  tip: string;
  /** "Recarga 3 s" (secondary weapons). */
  cooldown?: string;
}

const NAMES: Record<number, [name: string, original: string, short: string, article: WeaponInfo['article']]> = {
  [WEAPON_SMG]: ['Submetralhadora', 'Sub Machine Gun', 'SMG', 'a'],
  [WEAPON_SHOTGUN]: ['Escopeta', 'Shotgun', 'Escopeta', 'a'],
  [WEAPON_SNIPER]: ['Rifle Sniper', 'Sniper Rifle', 'Sniper', 'o'],
  [WEAPON_DUAL_MACHINE_GUN]: ['Metralhadora Dupla', 'Dual Machine Gun', 'Dupla', 'a'],
  [WEAPON_CHAIN_GUN]: ['Chain Gun', 'Chain Gun', 'Chain Gun', 'a'],
  [WEAPON_BAZOOKA]: ['Bazuca', 'Bazooka', 'Bazuca', 'a'],
  [WEAPON_PHOTON_RIFLE]: ['Rifle de Fótons', 'Photon Rifle', 'Fótons', 'o'],
  [WEAPON_FLAME_THROWER]: ['Lança-chamas', 'Flame Thrower', 'Chamas', 'o'],
  [WEAPON_GRENADE]: ['Granada', 'Grenade', 'Granada', 'a'],
  [WEAPON_COCKTAIL_MOLOTOV]: ['Molotov', 'Molotov Cocktail', 'Molotov', 'o'],
  [WEAPON_KNIVES]: ['Facas', 'Popup Knives', 'Facas', 'as'],
  [WEAPON_NUCLEAR]: ['Robô Nuclear', 'Nuke Bot', 'Nuke', 'o'],
  [WEAPON_SHIELD]: ['Escudo Instantâneo', 'Instant Shield', 'Escudo', 'o'],
  [WEAPON_MINIBOT]: ['Mini Bot', 'Mini Bot', 'Mini Bot', 'o'],
};

/** 1.5 -> "1,5", 2 -> "2". */
function num(v: number, decimals = 1): string {
  const r = Math.round(v * 10 ** decimals) / 10 ** decimals;
  return String(r).replace('.', ',');
}

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
      return [photonMaxDamage() * 100, `até ${num(photonMaxDamage() * 100, 0)}`];
    case WEAPON_FLAME_THROWER:
      return [sv.sv_ftDamage * 100, `até ${num(sv.sv_ftDamage * 100)}`];
    default:
      return [def.damage * 100, num(def.damage * 100)];
  }
}

function tip(id: number): string {
  const def = weaponDefs[id];
  switch (id) {
    case WEAPON_SMG:
      return 'Equilibrada. É a arma com que todo mundo começa.';
    case WEAPON_SHOTGUN:
      return `${def.nbShot} balins em cone. Forte de perto, alcance de ${num(sv.sv_shottyRange, 0)} blocos.`;
    case WEAPON_SNIPER:
      return `Mire longe: com a câmera alta, cada tiro vira 3 balas (${num(3 * sv.sv_sniperDamage * 100)}).`;
    case WEAPON_DUAL_MACHINE_GUN:
      return 'Duas armas: mais dano que a SMG, menos precisão.';
    case WEAPON_CHAIN_GUN:
      return 'O maior dano contínuo. Superaquece se não soltar.';
    case WEAPON_BAZOOKA:
      // Remote detonation (Weapon.shoot / Game.handleProjectileRequest): a new click while it flies
      return sv.sv_zookaRemoteDet && sv.sv_serverType === SERVER_TYPE_PRO
        ? `Explode em área, raio de ${num(sv.sv_zookaRadius)}. Clique de novo para detonar no ar.`
        : `Foguete que explode em área, raio de ${num(sv.sv_zookaRadius)} blocos.`;
    case WEAPON_PHOTON_RIFLE:
      return 'Atravessa Orbs em linha. Mais forte de perto.';
    case WEAPON_FLAME_THROWER:
      return `Atravessa Orbs. Alcance curto, até ${num(sv.sv_ftMaxRange)} blocos.`;
    case WEAPON_KNIVES:
      return `Golpe corpo a corpo: ${num(def.damage * 100)} de dano.`;
    case WEAPON_NUCLEAR:
      return `Explode ${num(sv.sv_nukeTimer)} s depois, raio de ${num(sv.sv_nukeRadius)} blocos.`;
    case WEAPON_SHIELD:
      return 'Metade do dano recebido por um instante.';
    default:
      return '';
  }
}

/** Spread (Weapon::impressision) as a 0..1 accuracy and a word. */
function accuracy(id: number): WeaponStat {
  const def = weaponDefs[id];
  if (def.nbShot > 1) return { label: 'Precisão', value: 0.15, text: 'Cone' };
  const v = def.imp <= 0 ? 1 : Math.max(0.15, 1 - def.imp / 20);
  const text = v >= 0.95 ? 'Máxima' : v >= 0.55 ? 'Boa' : v >= 0.4 ? 'Média' : 'Baixa';
  return { label: 'Precisão', value: v, text };
}

export function weaponInfo(id: number): WeaponInfo {
  const [name, original, short, article] = NAMES[id] ?? [weaponDefs[id]?.name ?? '?', weaponDefs[id]?.name ?? '?', '?', 'a'];
  const def = weaponDefs[id];
  const info: WeaponInfo = { id, name, original, short, article, stats: [], tip: tip(id) };
  if ((PRIMARY_WEAPONS as readonly number[]).includes(id)) {
    const [dmg, dmgText] = shotDamage(id);
    const rate = 1 / def.fireDelay;
    // Square roots: the SMG's 10 and the shotgun's 105 both read on the same bar
    info.stats = [
      { label: 'Dano', value: Math.sqrt(Math.min(1, dmg / 105)), text: dmgText },
      { label: 'Cadência', value: Math.sqrt(Math.min(1, rate / 10)), text: `${num(rate)}/s` },
      accuracy(id),
    ];
  } else if ((SECONDARY_WEAPONS as readonly number[]).includes(id)) {
    info.cooldown = `Recarga ${num(def.fireDelay)} s`;
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
