// Server/game variables and weapon definitions (port of GameVar.cpp defaults).
import {
  PROJECTILE_COCKTAIL_MOLOTOV,
  PROJECTILE_DIRECT,
  PROJECTILE_GRENADE,
  PROJECTILE_NONE,
  PROJECTILE_ROCKET,
  SERVER_TYPE_PRO,
  WEAPON_BAZOOKA,
  WEAPON_CHAIN_GUN,
  WEAPON_COCKTAIL_MOLOTOV,
  WEAPON_DUAL_MACHINE_GUN,
  WEAPON_FLAME_THROWER,
  WEAPON_GRENADE,
  WEAPON_KNIVES,
  WEAPON_MINIBOT,
  WEAPON_NUCLEAR,
  WEAPON_PHOTON_RIFLE,
  WEAPON_SHIELD,
  WEAPON_SHOTGUN,
  WEAPON_SMG,
  WEAPON_SNIPER,
  GAME_TYPE_DM,
} from './constants';

/**
 * Server variables with the original defaults (GameVar.cpp).
 *
 * `sv_serverType`: the original server code contains `if (gameVar.sv_serverType = 1)` (an
 * assignment, GameProjectile.cpp) that runs on every projectile update, so in practice every
 * server switched to the "Pro" rules after the first projectile. We reproduce that effective
 * behaviour by defaulting the server-side rules to PRO. Client-side weapon tuning that the client
 * derived from the value it received on connect (UpdateProSettings) stays "normal".
 */
export const sv = {
  sv_friendlyFire: false,
  sv_reflectedDamage: false,
  sv_timeToSpawn: 5,
  sv_topView: true,
  sv_forceRespawn: false,
  sv_roundTimeLimit: 3 * 60,
  sv_gameTimeLimit: 30 * 60,
  sv_scoreLimit: 50,
  sv_winLimit: 7,
  sv_serverType: SERVER_TYPE_PRO,
  sv_gameType: GAME_TYPE_DM,
  sv_maxPlayer: 16,
  sv_enableSMG: true,
  sv_enableShotgun: true,
  sv_enableSniper: true,
  sv_enableDualMachineGun: true,
  sv_enableChainGun: true,
  sv_enableBazooka: true,
  sv_enablePhotonRifle: true,
  sv_enableFlameThrower: true,
  sv_enableShotgunReload: true,
  sv_slideOnIce: false,
  sv_showEnemyTag: false,
  sv_enableSecondary: true,
  sv_enableKnives: true,
  sv_enableNuclear: true,
  sv_enableShield: true,
  sv_enableMinibot: false, // not offered in the weapon menu of this remake
  sv_enableMolotov: true,
  sv_shottyDropRadius: 0.4,
  sv_shottyRange: 6.75,
  sv_ftMaxRange: 8.0,
  sv_ftMinRange: 1.0,
  sv_ftExpirationTimer: 1.5,
  sv_photonDamageCoefficient: 0.5,
  sv_photonVerticalShift: 0.325,
  sv_photonDistMult: 0.25,
  sv_photonHorizontalShift: 5.0,
  sv_photonType: 1,
  sv_ftDamage: 0.12,
  sv_smgDamage: 0.1,
  sv_dmgDamage: 0.14,
  sv_cgDamage: 0.16,
  sv_sniperDamage: 0.2,
  sv_shottyDamage: 0.21,
  sv_zookaDamage: 0.85,
  sv_zookaRadius: 2.0,
  sv_zookaRemoteDet: true,
  sv_nukeRadius: 6.0,
  sv_nukeTimer: 3.0,
  sv_nukeReload: 12.0,
  sv_explodingFT: false,
  sv_spawnImmunityTime: 2.0,
  /** Team games: even the teams out when one has 2 players more (Server::autoBalance)... */
  sv_autoBalance: true,
  /** ...after this many seconds. */
  sv_autoBalanceTime: 4,
  /** Seconds the end-of-map scoreboard stays before the next map (Server::changeMap changeMapDelay). */
  changeMapDelay: 10,
};

export type ServerVars = typeof sv;

/** Arguments of the original `Weapon` constructor (GameVar.cpp, client build). */
export interface WeaponDef {
  id: number;
  name: string;
  model: string; // main/models/*.DKO
  sound: string; // main/sounds/*
  fireDelay: number;
  damage: number;
  imp: number; // "impressision" (spread, degrees)
  nbShot: number;
  reculVel: number; // recoil velocity
  startImp: number;
  projectileType: number;
}

function def(
  id: number,
  model: string,
  sound: string,
  fireDelay: number,
  name: string,
  damage: number,
  imp: number,
  nbShot: number,
  reculVel: number,
  startImp: number,
  projectileType: number,
): WeaponDef {
  return { id, name, model, sound, fireDelay, damage, imp, nbShot, reculVel, startImp, projectileType };
}

/** gameVar.weapons[] — shared definitions. Players get instances (see weapon.ts). */
export const weaponDefs: WeaponDef[] = [];
weaponDefs[WEAPON_DUAL_MACHINE_GUN] = def(WEAPON_DUAL_MACHINE_GUN, 'main/models/DualMachineGun.DKO', 'main/sounds/DualMachineGun.wav', 0.1, 'Dual Machine Gun', 0.13, 10, 1, 0.8, 2, PROJECTILE_DIRECT);
weaponDefs[WEAPON_SMG] = def(WEAPON_SMG, 'main/models/SMG.DKO', 'main/sounds/SMG.wav', 0.1, 'SMG', 0.1, 8, 1, 0.5, 1, PROJECTILE_DIRECT);
weaponDefs[WEAPON_CHAIN_GUN] = def(WEAPON_CHAIN_GUN, 'main/models/ChainGun.DKO', 'main/sounds/ChainGun.wav', 0.1, 'ChainGun', 0.19, 15, 1, 2.0, 5, PROJECTILE_DIRECT);
weaponDefs[WEAPON_SHOTGUN] = def(WEAPON_SHOTGUN, 'main/models/ShotGun.DKO', 'main/sounds/Shotgun.wav', 0.85, 'Shotgun', 0.21, 20, 5, 3.0, 12, PROJECTILE_DIRECT);
weaponDefs[WEAPON_SNIPER] = def(WEAPON_SNIPER, 'main/models/Sniper.DKO', 'main/sounds/Sniper.wav', 2.0, 'Sniper Rifle', 0.3, 0, 1, 3.0, 0, PROJECTILE_DIRECT);
weaponDefs[WEAPON_BAZOOKA] = def(WEAPON_BAZOOKA, 'main/models/Bazooka.DKO', 'main/sounds/Bazooka.wav', 1.75, 'Bazooka', 0.75, 0, 1, 3.0, 0, PROJECTILE_ROCKET);
weaponDefs[WEAPON_GRENADE] = def(WEAPON_GRENADE, 'main/models/Hand.DKO', 'main/sounds/Grenade.wav', 1.0, 'Grenade', 1.5, 0, 1, -1.0, 0, PROJECTILE_GRENADE);
weaponDefs[WEAPON_COCKTAIL_MOLOTOV] = def(WEAPON_COCKTAIL_MOLOTOV, 'main/models/Hand.DKO', 'main/sounds/Grenade.wav', 1.0, 'Flame', 0.15, 0, 1, -1.0, 0, PROJECTILE_COCKTAIL_MOLOTOV);
weaponDefs[WEAPON_KNIVES] = def(WEAPON_KNIVES, 'main/models/Knifes.DKO', 'main/sounds/knifes.wav', 1.0, 'Popup Knives', 0.6, 0, 1, 0, 0, PROJECTILE_NONE);
weaponDefs[WEAPON_NUCLEAR] = def(WEAPON_NUCLEAR, 'main/models/Nuclear.DKO', 'main/sounds/Siren.WAV', 12.0, 'Nuke Bot', 8.0, 0, 1, 0, 0, PROJECTILE_NONE);
weaponDefs[WEAPON_PHOTON_RIFLE] = def(WEAPON_PHOTON_RIFLE, 'main/models/PhotonRifle.DKO', 'main/sounds/PhotonRifle.wav', 1.5, 'Photon Rifle', 0.24, 0, 1, 5.0, 0, PROJECTILE_DIRECT);
weaponDefs[WEAPON_FLAME_THROWER] = def(WEAPON_FLAME_THROWER, 'main/models/FlameThrower.DKO', 'main/sounds/FlameThrower.wav', 0.1, 'Flame Thrower', 0.08, 10, 1, 0, 10, PROJECTILE_DIRECT);
weaponDefs[WEAPON_SHIELD] = def(WEAPON_SHIELD, 'main/models/Shield.DKO', 'main/sounds/shield.wav', 3.0, 'Instant Shield', 0, 0, 1, 0, 0, PROJECTILE_NONE);
weaponDefs[WEAPON_MINIBOT] = def(WEAPON_MINIBOT, 'main/models/Antena.DKO', 'main/sounds/equip.wav', 1.0, 'Mini Bot', 0.05, 0, 1, 0, 0, PROJECTILE_NONE);

/**
 * Game::UpdateProSettings, as seen by clients (they keep sv_serverType = normal, see `sv` above).
 * The weapon tuning applied on the shooter's side (recoil, secondary fire delays).
 */
function applyClientWeaponTuning(): void {
  weaponDefs[WEAPON_NUCLEAR].fireDelay = sv.sv_nukeReload;
  weaponDefs[WEAPON_SHIELD].fireDelay = 3.0;
  weaponDefs[WEAPON_CHAIN_GUN].reculVel = 2.0;
}
applyClientWeaponTuning();

/** Server-side weapon damage for the rocket (GameProjectile.cpp: sv_serverType forced to 1). */
export function bazookaDamage(): number {
  return sv.sv_serverType === SERVER_TYPE_PRO ? sv.sv_zookaDamage : 0.75;
}

/** Game::SelectToAvailableWeapon — first enabled primary weapon. */
export function isWeaponEnabled(id: number): boolean {
  switch (id) {
    case WEAPON_SMG:
      return sv.sv_enableSMG;
    case WEAPON_SHOTGUN:
      return sv.sv_enableShotgun;
    case WEAPON_SNIPER:
      return sv.sv_enableSniper;
    case WEAPON_DUAL_MACHINE_GUN:
      return sv.sv_enableDualMachineGun;
    case WEAPON_CHAIN_GUN:
      return sv.sv_enableChainGun;
    case WEAPON_BAZOOKA:
      return sv.sv_enableBazooka;
    case WEAPON_PHOTON_RIFLE:
      return sv.sv_enablePhotonRifle;
    case WEAPON_FLAME_THROWER:
      return sv.sv_enableFlameThrower;
    case WEAPON_KNIVES:
      return sv.sv_enableSecondary && sv.sv_enableKnives;
    case WEAPON_NUCLEAR:
      return sv.sv_enableSecondary && sv.sv_enableNuclear;
    case WEAPON_SHIELD:
      return sv.sv_enableSecondary && sv.sv_enableShield;
    case WEAPON_MINIBOT:
      return sv.sv_enableSecondary && sv.sv_enableMinibot;
    default:
      return false;
  }
}
