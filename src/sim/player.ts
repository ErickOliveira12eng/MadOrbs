// Port of Player.cpp / PlayerUpdate.cpp (simulation side).
import { newFeats, onDeath, onKill } from './feats';
import {
  GAME_TYPE_CTF,
  GAME_TYPE_DM,
  GAME_TYPE_SND,
  GAME_TYPE_TDM,
  ITEM_GRENADE,
  PLAYER_STATUS_ALIVE,
  PLAYER_STATUS_DEAD,
  PLAYER_STATUS_LOADING,
  PLAYER_TEAM_BLUE,
  PLAYER_TEAM_RED,
  PLAYER_TEAM_SPECTATOR,
  PROJECTILE_DROPED_GRENADE,
  PROJECTILE_DROPED_WEAPON,
  PROJECTILE_LIFE_PACK,
  SERVER_TYPE_PRO,
  WEAPON_BAZOOKA,
  WEAPON_CHAIN_GUN,
  WEAPON_COCKTAIL_MOLOTOV,
  WEAPON_DUAL_MACHINE_GUN,
  WEAPON_FLAME_THROWER,
  WEAPON_GRENADE,
  WEAPON_KNIVES,
  WEAPON_PHOTON_RIFLE,
  WEAPON_SHOTGUN,
  WEAPON_SMG,
  WEAPON_SNIPER,
  PI,
} from './constants';
import { CoordFrame } from './coordFrame';
import { sv, weaponDefs } from './gameVar';
import { angleFromDir } from './helpers';
import { emptyInput, type PlayerInput } from './input';
import { Vec3, randRange, rotateAboutAxis } from './vec';
import { Weapon, WEAPON_MODEL_SCALE } from './weapon';
import type { Game } from './game';

const Z_AXIS = new Vec3(0, 0, 1);
/** Frames of position history kept for lag compensation (1.5 s). */
const HISTORY_FRAMES = 45;

/** The little bot dropped by the "Nuke Bot" secondary weapon (CMiniBot with nukeBot = true). */
export class MiniBot {
  nukeBot = true;
  currentCF = new CoordFrame();
  lastCF = new CoordFrame();
  destination = new Vec3();
  seekingTime = 5;
}

/** Skin customisation (cl_skin, cl_redDecal, cl_greenDecal, cl_blueDecal). */
export interface SkinInfo {
  skin: string;
  redDecal: [number, number, number];
  greenDecal: [number, number, number];
  blueDecal: [number, number, number];
}

export const DEFAULT_SKIN: SkinInfo = {
  skin: 'skin10',
  redDecal: [0.5, 0.5, 1],
  greenDecal: [0, 0, 1],
  blueDecal: [0, 0, 0.5],
};

/** Player::updateSkin: the decal colours of each team in team games. */
const TEAM_DECALS: Record<number, Omit<SkinInfo, 'skin'>> = {
  [PLAYER_TEAM_BLUE]: { redDecal: [0.5, 0.5, 1], greenDecal: [0, 0, 1], blueDecal: [0, 0, 0.5] },
  [PLAYER_TEAM_RED]: { redDecal: [1, 0.5, 0.5], greenDecal: [1, 0, 0], blueDecal: [0.5, 0, 0] },
};

export class Player {
  readonly game: Game;
  readonly playerID: number;
  name = 'Orb';
  /** Player ID shown next to the name on the score table (online only; see NetPlayerInfo.tag). */
  tag = '';
  teamID = PLAYER_TEAM_SPECTATOR;
  status = PLAYER_STATUS_LOADING;
  isBot = false;
  skin: SkinInfo = { ...DEFAULT_SKIN };

  life = 1;
  // Stats
  dmg = 0;
  kills = 0;
  deaths = 0;
  score = 0;
  ping = 0;
  /** CTF: own flag brought back home, enemy flag picked up (Player::returns, flagAttempts). */
  returns = 0;
  /** Multi-kills, sprees, revenges... of this match (src/sim/feats.ts). */
  feats = newFeats();
  flagAttempts = 0;

  currentCF = new CoordFrame();
  lastCF = new CoordFrame();

  weapon: Weapon | null = null;
  meleeWeapon: Weapon | null = null;
  nextSpawnWeapon = WEAPON_SMG;
  nextMeleeWeapon = WEAPON_KNIVES;

  timeToSpawn = sv.sv_timeToSpawn;
  immuneTime = 0;
  /** Spawns left (the campaign: 1, nobody comes back); Infinity elsewhere. */
  lives = Infinity;
  /** Size of the babo for hits and walls (the campaign's bosses are bigger). */
  radius = 0.25;
  /** Share of the damage taken (the campaign's bosses take less). */
  damageScale = 1;
  /** Picks up life packs (the campaign's bosses don't: neither the map's nor the ones bots drop). */
  takesLifePacks = true;
  protection = 0;
  timeDead = 0;
  timeAlive = 0;
  timeIdle = 0;
  timeInServer = 0;
  timePlayedCurGame = 0;
  deadSince = 0;
  spawnRequested = false;

  screenHit = 0;
  firedShowDelay = 0;
  grenadeDelay = 0;
  meleeDelay = 0;
  nbGrenadeLeft = 2;
  nbMolotovLeft = 1;
  fireFrameDelay = 0;
  lastShootWasNade = false;
  shootShakeDis = new Vec3();

  rocketInAir = false;
  detonateRocket = false;
  mfElapsedSinceLastShot = 9999;
  secondsFired = 0;
  shotCount = 0;
  /** Server-side fire-rate check for network requests (see Game.handleShootRequest). */
  shotTokens = 3;
  shotRate = 0.1;

  // Network keyframes of a remotely driven babo (CoordFrame netCF0 / netCF1 / cFProgression)
  netCF0 = new CoordFrame();
  netCF1 = new CoordFrame();
  cFProgression = 0;
  /** Client ping in network frames (33 ms), shown in the score table. */
  pingFrames = 0;
  // Server: where this babo was, one sample per frame, to check shots against what the shooter
  // saw (lag compensation, see Game.handleShootNet)
  private historyFrames = new Int32Array(HISTORY_FRAMES);
  private historyPos = new Float64Array(HISTORY_FRAMES * 3);
  private historyLen = 0;
  private historyHead = 0;

  // Photon rifle beam (server): damages what crosses it for 1 second
  incShot = 0;
  p1 = new Vec3();
  p2 = new Vec3();

  minibot: MiniBot | null = null;

  /** Input for this tick (set by the controlling client / bot before Game.update). */
  input: PlayerInput = emptyInput();
  private initedMouseClic = false;
  /** True when the player's own machine drives its movement (always true in local play). */
  locallyControlled = true;

  constructor(game: Game, playerID: number) {
    this.game = game;
    this.playerID = playerID;
  }

  get isAlive(): boolean {
    return this.status === PLAYER_STATUS_ALIVE;
  }

  get isDead(): boolean {
    return this.status === PLAYER_STATUS_DEAD;
  }

  /**
   * Player::updateSkin: in team games the babo wears its team's colours (the skin's pattern stays),
   * elsewhere the colours its player chose.
   */
  get displaySkin(): SkinInfo {
    if (!this.game.isTeamGame) return this.skin;
    if (this.teamID === PLAYER_TEAM_BLUE) return { skin: this.skin.skin, ...TEAM_DECALS[PLAYER_TEAM_BLUE] };
    if (this.teamID === PLAYER_TEAM_RED) return { skin: this.skin.skin, ...TEAM_DECALS[PLAYER_TEAM_RED] };
    return this.skin;
  }

  /** Player::update */
  update(delay: number): void {
    const game = this.game;
    if (this.teamID !== PLAYER_TEAM_SPECTATOR) this.timeIdle += delay;
    else this.timeIdle = 0;

    let lenShake = this.shootShakeDis.length();
    if (lenShake > 0) {
      this.shootShakeDis.normalizeIn();
      lenShake -= delay;
      if (lenShake < 0) lenShake = 0;
      this.shootShakeDis.mulIn(lenShake);
    }

    this.mfElapsedSinceLastShot += delay;
    this.shotTokens = Math.min(3, this.shotTokens + delay / Math.max(0.05, this.shotRate));
    if (this.protection > 0) {
      this.protection -= delay;
      if (this.protection < 0) this.protection = 0;
    }
    if (this.immuneTime > 0) {
      this.immuneTime -= delay;
      if (this.immuneTime < 0) this.immuneTime = 0;
    }
    if (this.fireFrameDelay > 0) this.fireFrameDelay--;

    this.lastCF.copyFrom(this.currentCF);
    this.currentCF.frameID++;
    if (this.minibot) {
      this.minibot.lastCF.copyFrom(this.minibot.currentCF);
      this.minibot.currentCF.frameID++;
    }

    if (this.screenHit > 0) {
      this.screenHit -= delay * 0.25;
      if (this.screenHit < 0) this.screenHit = 0;
    }
    if (this.firedShowDelay > 0) {
      this.firedShowDelay -= delay;
      if (this.firedShowDelay < 0) this.firedShowDelay = 0;
    }
    if (this.grenadeDelay > 0) {
      this.grenadeDelay -= delay;
      if (this.grenadeDelay < 0) this.grenadeDelay = 0;
    }
    if (this.meleeDelay > 0) {
      this.meleeDelay -= delay;
      if (this.meleeDelay < 0) this.meleeDelay = 0;
    }

    // Complete shotgun reload (one shell every sixth of the 3 second reload)
    const w = this.weapon;
    if (w && w.fullReload && w.weaponID === WEAPON_SHOTGUN) {
      if (w.shotInc > 0) {
        if (Math.trunc((w.currentFireDelay / 3) * 100) % 17 === 0) {
          w.shotInc--;
          game.events.push({ type: 'shotgunReload', playerID: this.playerID, position: this.currentCF.position.clone() });
        }
      } else {
        w.fullReload = false;
      }
    }

    if (this.weapon) this.weapon.update(delay);
    if (this.meleeWeapon) this.meleeWeapon.update(delay);

    if (this.status === PLAYER_STATUS_DEAD) this.timeDead += delay;
    this.timeInServer += delay;

    if (this.status === PLAYER_STATUS_ALIVE) {
      this.timeAlive += delay;
      this.timePlayedCurGame += delay;

      if (this.minibot) {
        const bot = this.minibot;
        bot.currentCF.position.addScaledIn(bot.currentCF.vel, delay);
        let size = bot.currentCF.vel.length();
        if (size > 0) {
          size -= delay * 8;
          if (size < 0) size = 0;
          bot.currentCF.vel.normalizeIn().mulIn(size);
        }
        bot.currentCF.position.z = 0.15;
        this.minibotThink(delay);
      }

      if (!this.locallyControlled) {
        // A babo driven by another machine: follow its keyframes (CoordFrame::interpolate)
        this.interpolate(delay);
        this.currentCF.position.z = 0.25;
      } else {
        // Move with the velocity
        this.currentCF.position.addScaledIn(this.currentCF.vel, delay);
        // Slow down (friction)
        let size = this.currentCF.vel.length();
        if (size > 0) {
          if (game.map.themeName === 'snow' && sv.sv_slideOnIce && this.onSplatter()) size -= delay * 1;
          else size -= delay * 4;
          if (size < 0) size = 0;
          this.currentCF.vel.normalizeIn().mulIn(size);
        }
        this.currentCF.position.z = 0.25;
        this.controlIt(delay);
      }

      // We are alive, so the respawn delay restarts
      this.timeToSpawn = sv.sv_timeToSpawn;

      // Orientation towards the mouse
      this.updateAngle();
    } else if ((this.teamID === PLAYER_TEAM_BLUE || this.teamID === PLAYER_TEAM_RED) && this.status === PLAYER_STATUS_DEAD && this.timeToSpawn >= 0) {
      this.timeToSpawn -= delay;
      if (this.timeToSpawn <= 0) {
        this.timeToSpawn = 0;
        if ((sv.sv_forceRespawn || this.input.shootPressed) && !this.spawnRequested) {
          this.spawnRequested = true;
          game.requestSpawn(this);
        }
      }
    }
  }

  /** Is the player on a "splatter" cell (ice, lava, water puddle...)? */
  onSplatter(): boolean {
    const map = this.game.map;
    const x = Math.trunc(this.currentCF.position.x - 0.5);
    const y = Math.trunc(this.currentCF.position.y - 0.5);
    if (x < 0 || y < 0 || x >= map.size[0] || y >= map.size[1]) return false;
    return map.cells[y * map.size[0] + x].splater[0] > 0.5;
  }

  /** Orientation (PlayerUpdate.cpp "On l'oriente") — cl_preciseCursor aims from the muzzle. */
  updateAngle(): void {
    const w = this.weapon;
    let dirVect = this.currentCF.mousePosOnMap.sub(this.currentCF.position);
    if (w && w.nuzzleFlashes.length > 0) {
      const f = w.nuzzleFlashes[Math.min(w.firingNuzzle, w.nuzzleFlashes.length - 1)];
      const shotOrigin = rotateAboutAxis(Vec3.from(f.position).mul(WEAPON_MODEL_SCALE), this.currentCF.angle, Z_AXIS).add(this.currentCF.position);
      const fromMuzzle = this.currentCF.mousePosOnMap.sub(shotOrigin);
      // cl_preciseCursor = true (default)
      if (!(w.weaponID === WEAPON_DUAL_MACHINE_GUN || dirVect.length() <= 1.5)) dirVect = fromMuzzle;
    }
    dirVect.z = 0;
    if (dirVect.lengthSq() > 0) this.currentCF.angle = angleFromDir(dirVect);
  }

  /** Player::controlIt — reads the tick input. */
  controlIt(delay: number): void {
    const input = this.input;
    const game = this.game;
    this.currentCF.mousePosOnMap.copy(input.mousePosOnMap);

    let accel = 12.5;
    if (game.map.themeName === 'snow' && sv.sv_slideOnIce && this.onSplatter()) accel = 4.0;

    // Absolute movement (scope mode was never enabled in the shipped game)
    if (input.up) this.currentCF.vel.y += delay * accel;
    if (input.down) this.currentCF.vel.y -= delay * accel;
    if (input.right) this.currentCF.vel.x += delay * accel;
    if (input.left) this.currentCF.vel.x -= delay * accel;

    // Shooting
    if (!input.shoot && this.weapon) this.weapon.charge = 0;
    if (input.shootPressed) this.initedMouseClic = true;
    // Not in the original: with a rocket in the air, the remote detonation needs a new click. Holding
    // the button blew the rocket up 0.25 s after launch, right in front of the shooter (bots hold it).
    const holdingOverRocket = this.weapon?.weaponID === WEAPON_BAZOOKA && this.rocketInAir && !input.shootPressed;
    if (input.shoot && this.initedMouseClic && !holdingOverRocket) {
      if (this.weapon && this.grenadeDelay === 0 && this.meleeDelay === 0) {
        this.firedShowDelay = 2;
        this.weapon.shoot(this);
      }
    }

    // Secondary fire (melee weapon)
    if (!this.minibot && input.melee && this.grenadeDelay === 0 && this.meleeDelay === 0 && sv.sv_enableSecondary) {
      if (this.meleeWeapon) {
        this.firedShowDelay = 2;
        // NET_CLSV_SVCL_PLAYER_SHOOT_MELEE: the server runs it and tells everybody (feedback included)
        if (game.mode === 'client') game.net?.melee();
        else this.meleeWeapon.shootMeleeSV(this);
        this.meleeDelay = this.meleeWeapon.fireDelay;
      }
    }

    // Grenade
    if (input.throwGrenadePressed && this.grenadeDelay === 0 && this.nbGrenadeLeft > 0 && this.meleeDelay === 0) {
      if (this.weapon && this.weapon.currentFireDelay <= 0) {
        this.lastShootWasNade = true;
        // The shooter's client counts its own grenades (the server keeps its own count)
        if (game.mode === 'client') this.nbGrenadeLeft--;
        this.grenadeDelay = weaponDefs[WEAPON_GRENADE].fireDelay;
        this.throwProjectileWeapon(WEAPON_GRENADE);
      }
    }

    // Molotov cocktail
    if (input.throwMolotovPressed && this.grenadeDelay === 0 && this.nbMolotovLeft > 0 && sv.sv_enableMolotov) {
      if (this.weapon && this.weapon.currentFireDelay <= 0) {
        this.lastShootWasNade = false;
        if (game.mode === 'client') this.nbMolotovLeft--;
        this.grenadeDelay = weaponDefs[WEAPON_COCKTAIL_MOLOTOV].fireDelay;
        this.throwProjectileWeapon(WEAPON_COCKTAIL_MOLOTOV);
      }
    }

    // Pick up a weapon on the ground
    if (input.pickUpPressed) game.pickupRequest(this);

    // Clamp the velocity ("Upgrade, faster ! haha")
    const size = this.currentCF.vel.length();
    if (size > 3.25) this.currentCF.vel.normalizeIn().mulIn(3.25);
  }

  /**
   * gameVar.weapons[WEAPON_GRENADE]->shoot(this): the grenade/molotov "weapon" uses the Hand model,
   * whose dummies give the throw origin. No recoil (reculVel = -1 is only used with nuzzles).
   */
  private throwProjectileWeapon(weaponID: number): void {
    const w = new Weapon(weaponID);
    w.owner = this;
    w.shoot(this);
  }

  /**
   * Player::setCoordFrame — a keyframe of a babo driven elsewhere (its own client, or the server
   * for the others). Out-of-order keyframes are ignored.
   */
  setCoordFrame(frameID: number, position: Vec3, vel: Vec3, mousePosOnMap: Vec3): void {
    if (this.netCF1.frameID > frameID) return;
    if (this.netCF1.frameID === frameID && frameID !== 0) return;
    // Our last keyframe becomes where we are now
    this.netCF0.copyFrom(this.currentCF);
    this.netCF0.frameID = this.netCF1.frameID;
    this.cFProgression = 0;
    this.currentCF.vel.copy(vel);
    this.netCF1.frameID = frameID;
    this.netCF1.position.copy(position);
    this.netCF1.vel.copy(vel);
    this.netCF1.mousePosOnMap.copy(mousePosOnMap);
    if (this.netCF0.frameID === 0) this.netCF0.copyFrom(this.netCF1);
  }

  /** CoordFrame::interpolate (cl_cubicMotion): cubic spline to the last keyframe, then dead reckoning. */
  private interpolate(delay: number): void {
    const cf = this.currentCF;
    const from = this.netCF0;
    const to = this.netCF1;
    this.cFProgression++;
    const size = to.frameID - from.frameID;
    if (this.cFProgression > size) {
      if (this.cFProgression < 15) {
        // Keep going with the velocity
        cf.position.addScaledIn(cf.vel, delay);
      } else {
        cf.position.copy(to.position);
      }
    } else if (this.cFProgression >= 0 && size > 0) {
      const t = this.cFProgression / size;
      const animTime = size / (30 * 3);
      cf.position = cubicSpline(from.position, from.position.add(from.vel.mul(animTime)), to.position.sub(to.vel.mul(animTime)), to.position, t);
      cf.mousePosOnMap = cubicSpline(
        from.mousePosOnMap,
        from.mousePosOnMap.add(to.mousePosOnMap.sub(from.mousePosOnMap).mul(animTime)),
        to.mousePosOnMap.sub(from.mousePosOnMap.sub(to.mousePosOnMap).mul(animTime)),
        to.mousePosOnMap,
        t,
      );
    } else {
      cf.position.copy(to.position);
      cf.mousePosOnMap.copy(to.mousePosOnMap);
    }
  }

  /** Server: remembers where the babo is at this frame (lag compensation). */
  recordHistory(frame: number): void {
    const i = this.historyHead;
    const p = this.currentCF.position;
    this.historyFrames[i] = frame;
    this.historyPos[i * 3] = p.x;
    this.historyPos[i * 3 + 1] = p.y;
    this.historyPos[i * 3 + 2] = p.z;
    this.historyHead = (i + 1) % HISTORY_FRAMES;
    if (this.historyLen < HISTORY_FRAMES) this.historyLen++;
  }

  /** Was the babo's centre, now or at some frame since `fromFrame`, somewhere `test` accepts? */
  wasNear(fromFrame: number, test: (centre: Vec3) => boolean): boolean {
    if (test(this.currentCF.position)) return true;
    const c = new Vec3();
    for (let k = 0; k < this.historyLen; k++) {
      const i = (this.historyHead - 1 - k + HISTORY_FRAMES) % HISTORY_FRAMES;
      if (this.historyFrames[i] < fromFrame) break;
      c.set(this.historyPos[i * 3], this.historyPos[i * 3 + 1], this.historyPos[i * 3 + 2]);
      if (test(c)) return true;
    }
    return false;
  }

  /** Player::spawn */
  spawn(spawnPoint: Vec3): void {
    this.historyLen = 0;
    this.status = PLAYER_STATUS_ALIVE;
    this.life = 1;
    this.timeToSpawn = sv.sv_timeToSpawn;
    this.immuneTime = sv.sv_spawnImmunityTime;
    this.timeDead = 0;
    this.timeAlive = 0;
    this.timeIdle = 0;
    this.spawnRequested = false;
    this.currentCF.position.copy(spawnPoint);
    this.currentCF.vel.set(0, 0, 0);
    this.currentCF.angle = 0;
    this.lastCF.copyFrom(this.currentCF);
    this.netCF0.copyFrom(this.currentCF);
    this.netCF1.copyFrom(this.currentCF);
    this.netCF0.frameID = 0;
    this.netCF1.frameID = 0;
    this.cFProgression = 0;
    this.shotTokens = 3;
    this.grenadeDelay = 0;
    this.meleeDelay = 0;
    this.nbGrenadeLeft = 2;
    this.nbMolotovLeft = 1;
    this.screenHit = 0;
    this.rocketInAir = false;
    this.detonateRocket = false;
    this.initedMouseClic = false;
    this.switchWeapon(this.nextSpawnWeapon);
    this.switchMeleeWeapon(this.nextMeleeWeapon);
  }

  /** Player::reinit — reset the stats. */
  reinit(): void {
    this.timeIdle = 0;
    this.dmg = 0;
    this.kills = 0;
    this.deaths = 0;
    this.score = 0;
    this.returns = 0;
    this.feats = newFeats();
    this.flagAttempts = 0;
    this.timePlayedCurGame = 0;
  }

  /** Player::switchWeapon */
  switchWeapon(newWeaponID: number, forceSwitch = false): void {
    if (this.weapon && forceSwitch && this.weapon.weaponID === newWeaponID) return;
    this.weapon = new Weapon(newWeaponID);
    this.weapon.currentFireDelay = 1; // one second delay when switching weapons
    this.weapon.owner = this;
    this.shotCount = 0;
    this.game.events.push({ type: 'switchWeapon', playerID: this.playerID, weaponID: newWeaponID });
  }

  /** Player::switchMeleeWeapon */
  switchMeleeWeapon(newWeaponID: number, forceSwitch = false): void {
    if (this.meleeWeapon && forceSwitch && this.meleeWeapon.weaponID === newWeaponID) return;
    this.meleeWeapon = new Weapon(newWeaponID);
    this.meleeWeapon.currentFireDelay = 0;
    this.meleeWeapon.owner = this;
  }

  /** Player::kill */
  kill(silenceDeath: boolean): void {
    this.status = PLAYER_STATUS_DEAD;
    this.deadSince = 0;
    void silenceDeath;
    this.minibot = null;
    // Si il avait le flag, on le laisse tomber
    this.game.dropFlags(this);
    this.currentCF.position.set(-999, -999, 0);
  }

  /** Player::SpawnNukeBotSV */
  spawnNukeBotSV(): void {
    if (this.minibot) return;
    const bot = new MiniBot();
    const botPos = this.currentCF.position.clone();
    botPos.z = 0.15;
    bot.currentCF.position.copy(botPos);
    bot.currentCF.mousePosOnMap.copy(botPos);
    bot.currentCF.mousePosOnMap.z = 0;
    bot.lastCF.copyFrom(bot.currentCF);
    bot.destination.copy(botPos);
    this.minibot = bot;
    this.game.events.push({ type: 'nukeBotSpawn', playerID: this.playerID });
  }

  /** CMiniBot::Think (nuke bot: only aims at the closest visible enemy, never shoots). */
  private minibotThink(_delay: number): void {
    const bot = this.minibot!;
    const game = this.game;
    let closest: Player | null = null;
    let closestDis = 10000;
    for (const p of game.players) {
      if (!p || !p.isAlive || p === this) continue;
      if (!(p.teamID !== this.teamID || game.gameType === GAME_TYPE_DM || game.gameType === GAME_TYPE_SND)) continue;
      const d = bot.currentCF.position.sub(p.currentCF.position).lengthSq();
      if (d < 36 && d < closestDis) {
        const shootDir = p.currentCF.position.sub(bot.currentCF.position).normalizeIn();
        const mountOffset = rotateAboutAxis(shootDir, -90, Z_AXIS).normalizeIn().mulIn(0.1);
        const origin = bot.currentCF.position.add(mountOffset);
        const normal = new Vec3();
        if (!game.map.rayTest(origin, p.currentCF.position.clone(), normal)) {
          closestDis = d;
          closest = p;
        }
      }
    }
    if (closest) bot.currentCF.mousePosOnMap.copy(closest.currentCF.position);
    // Orientation
    const dir = bot.currentCF.mousePosOnMap.sub(bot.currentCF.position);
    dir.z = 0;
    if (dir.lengthSq() > 0) bot.currentCF.angle = angleFromDir(dir);
  }

  /**
   * Player::hitSV — server-side damage. `damage < 0` means "use the weapon's damage".
   * Returns true if the player died.
   */
  hitSV(fromWeaponID: number, from: Player, damage = -1): boolean {
    const game = this.game;
    let cdamage = damage;
    const fromDef = weaponDefs[fromWeaponID];
    if (damage === -1) {
      if (sv.sv_serverType === SERVER_TYPE_PRO) {
        switch (fromWeaponID) {
          case WEAPON_SMG:
            cdamage = sv.sv_smgDamage;
            break;
          case WEAPON_SNIPER:
            cdamage = sv.sv_sniperDamage;
            break;
          case WEAPON_SHOTGUN:
            cdamage = sv.sv_shottyDamage;
            break;
          case WEAPON_DUAL_MACHINE_GUN:
            cdamage = sv.sv_dmgDamage;
            break;
          case WEAPON_CHAIN_GUN:
            cdamage = sv.sv_cgDamage;
            break;
          default:
            cdamage = fromDef.damage;
        }
      } else cdamage = fromDef.damage;
    }
    if (fromWeaponID === WEAPON_PHOTON_RIFLE && sv.sv_serverType === SERVER_TYPE_PRO && from !== this) {
      const shotFrom = from.weapon ? from.weapon.shotFrom : from.currentCF.position;
      const distance = this.currentCF.position.sub(shotFrom).length();
      switch (sv.sv_photonType) {
        case 1: // a+(pi/2-arctan(x-b)c)d
          cdamage = cdamage * (sv.sv_photonVerticalShift + sv.sv_photonDamageCoefficient * (PI / 2 - Math.atan((distance - sv.sv_photonHorizontalShift) * sv.sv_photonDistMult)));
          break;
        case 2: {
          const d = distance === 0 ? 1e-30 : distance;
          cdamage = cdamage * (sv.sv_photonVerticalShift + sv.sv_photonDamageCoefficient / ((d - sv.sv_photonHorizontalShift) * sv.sv_photonDistMult));
          break;
        }
        case 3:
          cdamage = cdamage * (sv.sv_photonVerticalShift + sv.sv_photonDamageCoefficient / (1 + Math.pow((distance - sv.sv_photonHorizontalShift) * sv.sv_photonDistMult, 2)));
          break;
        default:
          cdamage = cdamage * sv.sv_photonDamageCoefficient;
      }
    }
    if (fromWeaponID === WEAPON_FLAME_THROWER && sv.sv_serverType === SERVER_TYPE_PRO && from !== this) {
      cdamage = sv.sv_ftDamage;
      const shotFrom = from.weapon ? from.weapon.shotFrom : from.currentCF.position;
      const distance = this.currentCF.position.sub(shotFrom).length();
      cdamage = (1 - distance / sv.sv_ftMaxRange) * cdamage;
    }

    // A tougher babo (the campaign's bosses)
    cdamage *= this.damageScale;
    // Shield protection
    if (this.protection > 0.6) cdamage *= 0.5;
    // Spawn immunity
    if (this.immuneTime > 0.3) cdamage = 0;

    if (this.status !== PLAYER_STATUS_ALIVE) return false;

    const sameTeamRules = from.teamID === this.teamID && game.gameType !== GAME_TYPE_DM && game.gameType !== GAME_TYPE_SND;
    if (sameTeamRules) {
      if (sv.sv_friendlyFire || from.playerID === this.playerID) {
        this.applyDamage(cdamage, from, fromWeaponID);
      }
      if (sv.sv_reflectedDamage && from.playerID !== this.playerID) from.hitSV(fromWeaponID, from, cdamage);
      if (this.life <= Number.EPSILON) {
        this.dieSV(from, fromWeaponID, true);
        return true;
      }
    } else {
      this.applyDamage(cdamage, from, fromWeaponID);
      if (this.life <= Number.EPSILON) {
        this.dieSV(from, fromWeaponID, false);
        return true;
      }
    }
    return false;
  }

  private applyDamage(cdamage: number, from: Player, fromWeaponID: number): void {
    if (from !== this) from.dmg += cdamage < this.life ? cdamage : this.life;
    this.life -= cdamage;
    this.screenHit += cdamage;
    if (this.screenHit > 1) this.screenHit = 1;
    if (cdamage > 1) this.screenHit = 0;
    this.game.events.push({ type: 'hit', playerID: this.playerID, fromID: from.playerID, weaponID: fromWeaponID, damage: cdamage, life: this.life, position: this.currentCF.position.clone() });
  }

  /** Death on the server: drop life pack, weapon and grenades, update scores (Player::hitSV). */
  private dieSV(from: Player, fromWeaponID: number, friendlyFire: boolean): void {
    const game = this.game;
    const dropVel = (): Vec3 => {
      let v = new Vec3(0, 0, 1);
      v = rotateAboutAxis(v, randRange(-45, 45), new Vec3(1, 0, 0));
      v = rotateAboutAxis(v, randRange(0, 360), Z_AXIS).mul(3);
      return v.add(this.currentCF.vel.mul(0.25));
    };
    game.spawnProjectile(this.currentCF.position.clone(), dropVel(), this.playerID, PROJECTILE_LIFE_PACK, 0);
    if (this.weapon) game.spawnProjectile(this.currentCF.position.clone(), dropVel(), this.playerID, PROJECTILE_DROPED_WEAPON, this.weapon.weaponID);
    for (let i = 0; i < this.nbGrenadeLeft; ++i) {
      game.spawnProjectile(this.currentCF.position.clone(), dropVel(), this.playerID, PROJECTILE_DROPED_GRENADE, 0);
    }
    game.events.push({ type: 'death', playerID: this.playerID, fromID: from.playerID, weaponID: fromWeaponID, friendlyFire, position: this.currentCF.position.clone() });
    this.kill(true);

    if (friendlyFire) {
      // Friendly kill: the killer loses points (TDM)
      if (game.gameType === GAME_TYPE_TDM) {
        if (from.teamID === PLAYER_TEAM_BLUE) game.blueScore--;
        else if (from.teamID === PLAYER_TEAM_RED) game.redScore--;
      }
      from.deaths++;
      if (game.gameType !== GAME_TYPE_CTF) from.score--; // CTF scores are captures only
      onDeath(game, this);
      return;
    }
    if (from !== this) {
      if (from.teamID === PLAYER_TEAM_BLUE && game.gameType !== GAME_TYPE_CTF) game.blueScore++;
      else if (from.teamID === PLAYER_TEAM_RED && game.gameType !== GAME_TYPE_CTF) game.redScore++;
      if (game.gameType !== GAME_TYPE_CTF) from.score++;
      from.kills++;
      this.deaths++;
      onKill(game, from, this);
    } else {
      onDeath(game, this);
      from.deaths++;
      if (game.gameType !== GAME_TYPE_CTF) {
        from.kills--;
        from.score--;
      }
    }
  }

  /** Grenade pickup (dropped grenades). */
  giveGrenade(): void {
    this.nbGrenadeLeft += 1;
    if (this.nbGrenadeLeft > 3) this.nbGrenadeLeft = 3;
    this.game.events.push({ type: 'pickup', playerID: this.playerID, itemType: ITEM_GRENADE, itemFlag: 0 });
  }
}

/** Helper.cpp cubicSpline (Bezier). */
function cubicSpline(x0: Vec3, x1: Vec3, x2: Vec3, x3: Vec3, t: number): Vec3 {
  const u = 1 - t;
  return x0.mul(u * u * u).add(x1.mul(3 * t * u * u)).add(x2.mul(3 * t * t * u)).add(x3.mul(t * t * t));
}
