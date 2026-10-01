// Constants from the original game (GameVar.h, Weapon.h, Player.h, Game.h).

// --- Weapons (GameVar.h) ---
export const WEAPON_SMG = 0;
export const WEAPON_SHOTGUN = 1;
export const WEAPON_SNIPER = 2;
export const WEAPON_DUAL_MACHINE_GUN = 3;
export const WEAPON_CHAIN_GUN = 4;
export const WEAPON_BAZOOKA = 5;
export const WEAPON_PHOTON_RIFLE = 6;
export const WEAPON_FLAME_THROWER = 7;
export const WEAPON_GRENADE = 8;
export const WEAPON_COCKTAIL_MOLOTOV = 9;
export const WEAPON_KNIVES = 10;
export const WEAPON_NUCLEAR = 11;
export const WEAPON_SHIELD = 12;
export const WEAPON_MINIBOT = 13;
export const WEAPON_COUNT = 14;

export const PRIMARY_WEAPONS = [
  WEAPON_SMG,
  WEAPON_SHOTGUN,
  WEAPON_SNIPER,
  WEAPON_DUAL_MACHINE_GUN,
  WEAPON_CHAIN_GUN,
  WEAPON_BAZOOKA,
  WEAPON_PHOTON_RIFLE,
  WEAPON_FLAME_THROWER,
] as const;
export const SECONDARY_WEAPONS = [WEAPON_KNIVES, WEAPON_NUCLEAR, WEAPON_SHIELD] as const;

// --- Projectile types (Weapon.h) ---
export const PROJECTILE_DIRECT = 1;
export const PROJECTILE_ROCKET = 2;
export const PROJECTILE_GRENADE = 3;
export const PROJECTILE_LIFE_PACK = 4;
export const PROJECTILE_DROPED_WEAPON = 5;
export const PROJECTILE_DROPED_GRENADE = 6;
export const PROJECTILE_COCKTAIL_MOLOTOV = 7;
export const PROJECTILE_FLAME = 8;
export const PROJECTILE_GIB = 9;
export const PROJECTILE_NONE = 10;
export const PROJECTILE_PHOTON = 11;

// --- Player (Player.h) ---
export const PLAYER_TEAM_SPECTATOR = -1;
export const PLAYER_TEAM_BLUE = 0;
export const PLAYER_TEAM_RED = 1;
export const PLAYER_TEAM_AUTO_ASSIGN = 2;

export const PLAYER_STATUS_ALIVE = 0;
export const PLAYER_STATUS_DEAD = 1;
export const PLAYER_STATUS_LOADING = 2;

export const MAX_PLAYER = 32;

// --- Game (Game.h) ---
export const GAME_TYPE_DM = 0;
export const GAME_TYPE_TDM = 1;
export const GAME_TYPE_CTF = 2;
export const GAME_TYPE_SND = 3;

export const SERVER_TYPE_NORMAL = 0;
export const SERVER_TYPE_PRO = 1;

/** Map::flagState: which flag (flagState[FLAG_BLUE] is the blue team's own flag)... */
export const FLAG_BLUE = 0;
export const FLAG_RED = 1;
/** ...and where it is: on its pod, dropped on the ground, or else the carrier's playerID. */
export const FLAG_ON_POD = -2;
export const FLAG_DROPPED = -1;

export const GAME_PLAYING = -1;
export const GAME_BLUE_WIN = 0;
export const GAME_RED_WIN = 1;
export const GAME_DRAW = 2;
export const GAME_DONT_SHOW = 3;
export const GAME_MAP_CHANGE = 4;

export const ITEM_LIFE_PACK = 1;
export const ITEM_WEAPON = 2;
export const ITEM_GRENADE = 3;

// --- Sounds sent by the server (GameVar.h) ---
export const SOUND_GRENADE_REBOUND = 1;
export const SOUND_MOLOTOV = 2;
export const SOUND_OVERHEAT = 3;
export const SOUND_PHOTON_START = 4;

/** Fixed simulation step (dkcInit(30) in main.cpp). */
export const TICK_RATE = 30;
export const TICK = 1 / TICK_RATE;

export const PI = 3.1415926535;
