// Port of Game.cpp / GameSpawn.cpp / Server.cpp (Deathmatch rules), simulation side.
//
// The original split this logic between the shooter's client (movement, fire timing) and the
// server (hits, damage, projectiles, scores). The same class runs in three modes:
//  - 'local':  everything here (offline play against bots),
//  - 'server': authoritative game on the Node server; humans send their own babo's coordinates
//              (like the original clients did) and ask to shoot, the server decides hits,
//              damage, projectiles, items and scores,
//  - 'client': the browser drives its own babo and forwards actions to the server through
//              `ClientNet`; everything else comes from the server.
import {
  FLAG_DROPPED,
  FLAG_ON_POD,
  GAME_BLUE_WIN,
  GAME_DONT_SHOW,
  GAME_DRAW,
  GAME_PLAYING,
  GAME_RED_WIN,
  GAME_TYPE_CTF,
  GAME_TYPE_DM,
  GAME_TYPE_SND,
  GAME_TYPE_TDM,
  MAX_PLAYER,
  PLAYER_STATUS_ALIVE,
  PLAYER_STATUS_DEAD,
  PLAYER_TEAM_BLUE,
  PLAYER_TEAM_RED,
  PROJECTILE_COCKTAIL_MOLOTOV,
  PROJECTILE_DIRECT,
  PROJECTILE_DROPED_WEAPON,
  PROJECTILE_GRENADE,
  PROJECTILE_ROCKET,
  SERVER_TYPE_PRO,
  ITEM_WEAPON,
  WEAPON_BAZOOKA,
  WEAPON_CHAIN_GUN,
  WEAPON_COCKTAIL_MOLOTOV,
  WEAPON_GRENADE,
  WEAPON_FLAME_THROWER,
  WEAPON_KNIVES,
  WEAPON_NUCLEAR,
  WEAPON_PHOTON_RIFLE,
  WEAPON_SHOTGUN,
  WEAPON_SNIPER,
} from './constants';
import { EventQueue } from './events';
import { bazookaDamage, sv, weaponDefs } from './gameVar';
import { distanceToSegment, segmentToSphere } from './helpers';
import type { GameMap } from './map';
import { Player } from './player';
import { Projectile } from './projectile';
import { Vec3, distance, distanceSquared, randRange, rotateAboutAxis } from './vec';

const Z_AXIS = new Vec3(0, 0, 1);
/** Map::BOUNCE_FACTOR */
const BOUNCE_FACTOR = 0.45;
/** Lag compensation: how far back (beyond the shooter's ping) a touched babo may have been... */
const LAG_COMP_MARGIN_FRAMES = 6;
const LAG_COMP_MAX_FRAMES = 30;
/** ...and how far from where the shooter saw it (interpolation differences). */
const LAG_COMP_TOLERANCE = 0.4;

/** One bullet of a shot: from the muzzle to where it stopped, and the babos it touched. */
interface Bullet {
  p1: Vec3;
  p2: Vec3;
  /** Wall normal, or the bullet direction when it touched a babo. */
  normal: Vec3;
  /** At most one, except for the weapons that go through (photon rifle, flame thrower). */
  hits: Player[];
}

export type GameMode = 'local' | 'server' | 'client';

/** What a 'client' game sends to the server (the original client -> server messages). */
export interface ClientNet {
  /** NET_CLSV_PLAYER_SHOOT, traced by us: each bullet is [endX, endY, endZ, ...touched player IDs]. */
  shoot(origin: Vec3, nuzzleID: number, weaponID: number, bullets: number[][]): void;
  /** NET_CLSV_SVCL_PLAYER_PROJECTILE (rocket, grenade, molotov). */
  projectile(projectileType: number, origin: Vec3, direction: Vec3, nuzzleID: number, weaponID: number): void;
  /** NET_CLSV_SVCL_PLAYER_SHOOT_MELEE */
  melee(): void;
  /** NET_CLSV_PICKUP_REQUEST */
  pickup(): void;
  /** NET_CLSV_SPAWN_REQUEST */
  spawn(weaponID: number, meleeID: number): void;
  /** NET_SVCL_PLAY_SOUND relayed to the others (photon charge, chain gun overheat). */
  sound(soundID: number, position: Vec3): void;
}

export interface GameOptions {
  /** Called when the server wants the next map (the host loads it and calls `changeMap`). */
  onMapChangeRequest?: (currentMap: string) => void;
  mode?: GameMode;
  net?: ClientNet;
  /** GAME_TYPE_DM (default), GAME_TYPE_TDM or GAME_TYPE_CTF. */
  gameType?: number;
}

/** Map::flagState, the flag touching distances of Server::updateCTF. */
const FLAG_POD_REACH = 0.25;
/**
 * A dropped flag is picked up or returned within this distance. The original used .5 for the
 * blue flag and .25 for the red one (a copy-paste slip); both teams get the .5 here.
 */
const FLAG_DROPPED_REACH = 0.5;

export class Game {
  map: GameMap;
  players: (Player | null)[] = new Array(MAX_PLAYER).fill(null);
  projectiles: Projectile[] = [];
  readonly events = new EventQueue();
  readonly gameType: number;
  roundState = GAME_PLAYING;
  gameTimeLeft = sv.sv_gameTimeLimit;
  roundTimeLeft = sv.sv_roundTimeLimit;
  /** Team scores: frags in TDM, captures in CTF (blueScore = blueWin there). */
  blueScore = 0;
  redScore = 0;
  /** CTF captures (Game::blueWin / redWin). */
  blueWin = 0;
  redWin = 0;
  /** CTF flags [FLAG_BLUE, FLAG_RED]: FLAG_ON_POD, FLAG_DROPPED (at flagPos) or the carrier's playerID. */
  flagState: [number, number] = [FLAG_ON_POD, FLAG_ON_POD];
  flagPos: [Vec3, Vec3] = [new Vec3(), new Vec3()];
  changeMapDelay = 0;
  /** The match's first kill was made (First Blood, src/sim/feats.ts). */
  firstBloodDone = false;
  private autoBalanceTimer = 0;
  private uniqueProjectileID = 0;
  /** Client mode: ids of our predicted projectiles, negative so they never meet the server's. */
  private predictedProjectileID = 0;
  private opts: GameOptions;
  /** Total simulated ticks. */
  frame = 0;
  readonly mode: GameMode;
  readonly net: ClientNet | null;

  constructor(map: GameMap, opts: GameOptions = {}) {
    this.map = map;
    this.opts = opts;
    this.mode = opts.mode ?? 'local';
    this.net = opts.net ?? null;
    this.gameType = opts.gameType ?? GAME_TYPE_DM;
    this.resetFlags();
  }

  /** True where hits, damage, projectiles and scores are decided (not in a 'client' game). */
  get isAuthority(): boolean {
    return this.mode !== 'client';
  }

  /** Team Deathmatch or Capture the Flag. */
  get isTeamGame(): boolean {
    return this.gameType === GAME_TYPE_TDM || this.gameType === GAME_TYPE_CTF;
  }

  // ---------------------------------------------------------------- flags (CTF)

  /** Both flags back on their pods (new map). */
  resetFlags(): void {
    for (let i = 0; i < 2; ++i) {
      this.flagState[i] = FLAG_ON_POD;
      this.flagPos[i] = this.map.flagPodPos[i].clone();
    }
  }

  /** Where flag `i` is now: its pod, where it lies, or on its carrier (Map::update). */
  flagPosition(i: number): Vec3 {
    const s = this.flagState[i];
    if (s === FLAG_ON_POD) return this.map.flagPodPos[i];
    if (s >= 0) {
      const carrier = this.players[s];
      if (carrier) return carrier.currentCF.position;
    }
    return this.flagPos[i];
  }

  /** The flag the player carries (FLAG_BLUE / FLAG_RED), or -1. */
  carriedFlag(player: Player): number {
    if (this.flagState[0] === player.playerID) return 0;
    if (this.flagState[1] === player.playerID) return 1;
    return -1;
  }

  /** Player::kill / ~Player: a dying or leaving carrier drops the flag where it is (authority). */
  dropFlags(player: Player): void {
    if (this.gameType !== GAME_TYPE_CTF || !this.isAuthority) return;
    for (let i = 0; i < 2; ++i) {
      if (this.flagState[i] !== player.playerID) continue;
      this.flagState[i] = FLAG_DROPPED;
      this.flagPos[i] = new Vec3(player.currentCF.position.x, player.currentCF.position.y, 0);
      this.events.push({ type: 'flag', flagID: i, state: FLAG_DROPPED, playerID: player.playerID, position: this.flagPos[i].clone(), reason: 'dropped' });
    }
  }

  /** Client: a flag change the server announced (NET_SVCL_CHANGE_FLAG_STATE / NET_SVCL_DROP_FLAG). */
  applyFlag(flagID: number, state: number, position: Vec3): void {
    if (flagID !== 0 && flagID !== 1) return;
    this.flagState[flagID] = state;
    if (state === FLAG_ON_POD) this.flagPos[flagID] = this.map.flagPodPos[flagID].clone();
    else if (state === FLAG_DROPPED) this.flagPos[flagID] = position.clone();
  }

  /**
   * Server::updateCTF: an enemy touching a flag takes it (from its pod or the ground), its own
   * team touching it on the ground sends it home, and a carrier reaching the pod of its own flag,
   * while that flag is home, scores.
   */
  private updateCTF(): void {
    const near = (a: Vec3, p: Player, reach: number): boolean => {
      const dx = a.x - p.currentCF.position.x;
      const dy = a.y - p.currentCF.position.y;
      return dx * dx + dy * dy <= reach * reach;
    };
    for (let i = 0; i < 2; ++i) {
      const owner = i; // FLAG_BLUE is PLAYER_TEAM_BLUE's flag
      const enemyFlag = 1 - i;
      const state = this.flagState[i];
      if (state !== FLAG_ON_POD && state !== FLAG_DROPPED) continue;
      const at = state === FLAG_ON_POD ? this.map.flagPodPos[i] : this.flagPos[i];
      const reach = state === FLAG_ON_POD ? FLAG_POD_REACH : FLAG_DROPPED_REACH;
      for (const p of this.players) {
        if (!p || !p.isAlive || !near(at, p, reach)) continue;
        if (p.teamID === 1 - owner) {
          // Ce joueur pogne le flag !!!!!!
          this.flagState[i] = p.playerID;
          p.flagAttempts++;
          this.events.push({ type: 'flag', flagID: i, state: p.playerID, playerID: p.playerID, position: at.clone(), reason: 'took' });
          break;
        }
        if (p.teamID === owner && state === FLAG_DROPPED) {
          // Ce joueur retourne le flag !
          this.flagState[i] = FLAG_ON_POD;
          this.flagPos[i] = this.map.flagPodPos[i].clone();
          p.returns++;
          this.events.push({ type: 'flag', flagID: i, state: FLAG_ON_POD, playerID: p.playerID, position: this.flagPos[i].clone(), reason: 'returned' });
          break;
        }
        if (p.teamID === owner && this.flagState[enemyFlag] === p.playerID) {
          // On a scoooré !!!!!!
          this.flagState[enemyFlag] = FLAG_ON_POD;
          this.flagPos[enemyFlag] = this.map.flagPodPos[enemyFlag].clone();
          p.score++;
          if (owner === PLAYER_TEAM_BLUE) this.blueScore = ++this.blueWin;
          else this.redScore = ++this.redWin;
          this.events.push({ type: 'flag', flagID: enemyFlag, state: FLAG_ON_POD, playerID: p.playerID, position: this.flagPos[enemyFlag].clone(), reason: 'captured' });
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------- teams

  /** Moves a player to the other team (Game::assignPlayerTeam): the babo dies and respawns there. */
  private switchTeam(player: Player, teamID: number): void {
    if (player.teamID === teamID) return;
    player.kill(true);
    player.timeToSpawn = sv.sv_timeToSpawn;
    player.spawnRequested = false;
    player.teamID = teamID;
    this.events.push({ type: 'teamChange', playerID: player.playerID, teamID });
  }

  /**
   * Server::update + Server::autoBalance: when a team has 2 players more than the other for
   * sv_autoBalanceTime seconds, the extra players who played the least in this game switch (never
   * the flag carrier).
   */
  private updateAutoBalance(delay: number): void {
    if (!this.isTeamGame || !sv.sv_autoBalance) {
      this.autoBalanceTimer = 0;
      return;
    }
    const blues = this.players.filter((p): p is Player => !!p && p.teamID === PLAYER_TEAM_BLUE);
    const reds = this.players.filter((p): p is Player => !!p && p.teamID === PLAYER_TEAM_RED);
    const uneven = Math.abs(blues.length - reds.length) > 1;
    if (!uneven) {
      this.autoBalanceTimer = 0;
      return;
    }
    if (this.autoBalanceTimer === 0) {
      this.autoBalanceTimer = sv.sv_autoBalanceTime;
      return;
    }
    this.autoBalanceTimer -= delay;
    if (this.autoBalanceTimer > 0) return;
    this.autoBalanceTimer = 0;
    const [big, target] = blues.length > reds.length ? [blues, PLAYER_TEAM_RED] : [reds, PLAYER_TEAM_BLUE];
    let nbToSwitch = Math.floor((Math.abs(blues.length - reds.length)) / 2);
    const candidates = big.filter((p) => this.carriedFlag(p) < 0).sort((a, b) => a.timePlayedCurGame - b.timePlayedCurGame);
    for (const p of candidates) {
      if (nbToSwitch-- <= 0) break;
      this.switchTeam(p, target);
    }
  }

  // ---------------------------------------------------------------- players

  /** Game::createNewPlayerSV + assignPlayerTeam(PLAYER_TEAM_AUTO_ASSIGN). */
  addPlayer(name: string, isBot = false): Player | null {
    const slot = this.players.findIndex((p) => p === null);
    if (slot < 0) return null;
    const player = new Player(this, slot);
    player.name = name;
    player.isBot = isBot;
    player.reinit();
    this.players[slot] = player;
    this.assignPlayerTeam(player);
    player.status = PLAYER_STATUS_DEAD;
    player.timeToSpawn = 0;
    player.currentCF.position.set(-999, -999, 0);
    this.events.push({ type: 'playerJoin', playerID: slot });
    return player;
  }

  /** Client mode: mirrors a player created by the server, in the same slot. */
  addRemotePlayer(playerID: number, name: string, teamID: number, isBot: boolean): Player {
    const player = new Player(this, playerID);
    player.name = name;
    player.teamID = teamID;
    player.isBot = isBot;
    player.locallyControlled = false;
    player.status = PLAYER_STATUS_DEAD;
    player.currentCF.position.set(-999, -999, 0);
    this.players[playerID] = player;
    this.events.push({ type: 'playerJoin', playerID });
    return player;
  }

  removePlayer(playerID: number): void {
    const p = this.players[playerID];
    if (!p) return;
    this.dropFlags(p); // ~Player: a carrier who leaves drops the flag
    this.players[playerID] = null;
    this.events.push({ type: 'playerLeave', playerID });
  }

  /** Auto-assign: the team with the fewest players (then the losing team, then random). */
  assignPlayerTeam(player: Player): void {
    let blue = 0;
    let red = 0;
    for (const p of this.players) {
      if (!p || p === player) continue;
      if (p.teamID === PLAYER_TEAM_BLUE) blue++;
      else if (p.teamID === PLAYER_TEAM_RED) red++;
    }
    let team: number;
    if (red > blue) team = PLAYER_TEAM_BLUE;
    else if (red < blue) team = PLAYER_TEAM_RED;
    else if (this.blueScore < this.redScore) team = PLAYER_TEAM_BLUE;
    else if (this.blueScore > this.redScore) team = PLAYER_TEAM_RED;
    else team = Math.random() < 0.5 ? PLAYER_TEAM_BLUE : PLAYER_TEAM_RED;
    player.teamID = team;
  }

  /** NET_CLSV_SPAWN_REQUEST */
  requestSpawn(player: Player): void {
    if (this.mode === 'client') {
      this.net?.spawn(player.nextSpawnWeapon, player.nextMeleeWeapon);
      return;
    }
    if (this.roundState !== GAME_PLAYING) {
      player.spawnRequested = false;
      return;
    }
    this.spawnPlayer(player);
  }

  /** Game::spawnPlayer — DM: the spawn point farthest from the closest alive player. */
  spawnPlayer(player: Player): boolean {
    if (player.teamID !== PLAYER_TEAM_BLUE && player.teamID !== PLAYER_TEAM_RED) return false;
    const spawns = this.map.dmSpawns;
    if (spawns.length === 0) return false;
    let currentScore = 0;
    let bestFound = 0;
    for (let i = 0; i < spawns.length; ++i) {
      let nearestPlayer = 100000;
      let nbPlayer = 0;
      for (const p of this.players) {
        if (!p || p === player || p.status !== PLAYER_STATUS_ALIVE) continue;
        // TDM/CTF only consider enemies; DM considers everybody
        if (this.gameType !== GAME_TYPE_DM && p.teamID === player.teamID) continue;
        nbPlayer++;
        const dis = distanceSquared(spawns[i], p.currentCF.position);
        if (dis < nearestPlayer) nearestPlayer = dis;
      }
      if (nearestPlayer > currentScore) {
        currentScore = nearestPlayer;
        bestFound = i;
      }
      if (nbPlayer === 0) {
        bestFound = Math.floor(Math.random() * spawns.length);
        break;
      }
    }
    player.spawn(new Vec3(spawns[bestFound].x, spawns[bestFound].y, 0.25));
    this.events.push({
      type: 'spawn',
      playerID: player.playerID,
      position: player.currentCF.position.clone(),
      weaponID: player.nextSpawnWeapon,
      meleeID: player.nextMeleeWeapon,
    });
    return true;
  }

  // ---------------------------------------------------------------- update

  update(delay: number): void {
    this.frame++;
    if (this.mode === 'client') {
      this.updateClient(delay);
      return;
    }
    if (this.roundState === GAME_PLAYING) {
      for (const p of this.players) {
        if (!p) continue;
        p.update(delay);
        this.updatePhotonBeam(p);
      }

      // Nuke bot collisions with walls
      for (const p of this.players) {
        if (p && p.isAlive && p.minibot) {
          this.map.performCollision(p.minibot.lastCF, p.minibot.currentCF, 0.15);
          this.map.collisionClip(p.minibot.currentCF, 0.15);
        }
      }

      // Collisions of the babos driven here (the original did this for its own player only)
      for (const p of this.players) {
        if (p && p.isAlive && p.locallyControlled) this.performPlayerCollisions(p);
      }

      // Where everybody is, to check the online shots against what their shooter saw
      if (this.mode === 'server') {
        for (const p of this.players) if (p && p.isAlive) p.recordHistory(this.frame);
      }
    }

    // Projectiles
    for (let i = 0; i < this.projectiles.length; ++i) {
      const projectile = this.projectiles[i];
      projectile.update(delay, this);
      if (projectile.needToBeDeleted) {
        if (!projectile.reallyNeedToBeDeleted) {
          projectile.reallyNeedToBeDeleted = true;
          continue;
        }
        this.projectiles.splice(i, 1);
        this.events.push({ type: 'projectileRemoved', uniqueID: projectile.uniqueID });
        i--;
      }
    }

    this.updateServerRules(delay);
  }

  /**
   * Client mode: our babo is simulated here, the others are interpolated from the server's
   * coordinates (CoordFrame::interpolate), projectiles only spin (their positions come from the
   * server) and the rules/timers are the server's.
   */
  private updateClient(delay: number): void {
    if (this.roundState === GAME_PLAYING) {
      for (const p of this.players) if (p) p.update(delay);
      for (const p of this.players) {
        if (p && p.isAlive && p.locallyControlled) this.performPlayerCollisions(p);
      }
    }
    for (let i = 0; i < this.projectiles.length; ++i) {
      const projectile = this.projectiles[i];
      if (!projectile.predicted) {
        projectile.rotation += delay * projectile.rotateVel;
        while (projectile.rotation >= 360) projectile.rotation -= 360;
        while (projectile.rotation < 0) projectile.rotation += 360;
        continue;
      }
      // Our predicted ones fly here, as on the server
      projectile.update(delay, this);
      if (projectile.needToBeDeleted) {
        if (!projectile.reallyNeedToBeDeleted) {
          projectile.reallyNeedToBeDeleted = true;
          continue;
        }
        this.projectiles.splice(i, 1);
        this.events.push({ type: 'projectileRemoved', uniqueID: projectile.uniqueID });
        i--;
      }
    }
  }

  /** Photon rifle beam: keeps hurting whatever crosses it for 30 frames (Game::update). */
  private updatePhotonBeam(p: Player): void {
    if (p.incShot <= 0) return;
    p.incShot--;
    if (p.incShot % 3 !== 0) return;
    let p3 = p.p2.clone();
    for (const other of this.players) {
      if (!other || other === p || !other.isAlive) continue;
      if (!(other.teamID !== p.teamID || this.gameType === GAME_TYPE_DM || this.gameType === GAME_TYPE_SND || sv.sv_friendlyFire || sv.sv_reflectedDamage)) continue;
      if (segmentToSphere(p.p1, p3, other.currentCF.position, 0.35)) {
        p3 = p.p2.clone(); // full length
        other.hitSV(WEAPON_PHOTON_RIFLE, p, weaponDefs[WEAPON_PHOTON_RIFLE].damage / 2);
      }
    }
  }

  /** Babo vs babo and babo vs map collisions (Game::update, client part). */
  private performPlayerCollisions(p: Player): void {
    const map = this.map;
    for (const other of this.players) {
      if (!other || other === p || !other.isAlive) continue;
      // Must have been on the field for more than 3 seconds
      if (other.timeAlive > 3 && p.timeAlive > 3) {
        const disSq = distanceSquared(p.currentCF.position, other.currentCF.position);
        if (disSq <= 0.5 * 0.5) {
          const dis = other.currentCF.position.sub(p.currentCF.position).normalizeIn();
          p.currentCF.position = other.currentCF.position.sub(dis.mul(0.51));
          p.currentCF.vel = p.currentCF.vel.mul(-BOUNCE_FACTOR);
          map.performCollision(p.lastCF, p.currentCF, 0.25);
          map.collisionClip(p.currentCF, 0.25);
          p.lastCF.position.copy(p.currentCF.position);
        }
      }
    }
    map.performCollision(p.lastCF, p.currentCF, 0.25);
    // Final clip
    map.collisionClip(p.currentCF, 0.25);

    // Stuck in a wall? Respawn request
    const x = Math.trunc(p.currentCF.position.x);
    const y = Math.trunc(p.currentCF.position.y);
    const inside = x >= 0 && y >= 0 && x < map.size[0] && y < map.size[1];
    if (!inside || !map.cells[y * map.size[0] + x].passable) {
      if (!p.spawnRequested) {
        p.spawnRequested = true;
        if (this.mode === 'client') this.requestSpawn(p);
        else this.spawnPlayer(p);
      }
    }
  }

  /** Server::update timing, the flags, the team balance and the end conditions of each game type. */
  private updateServerRules(delay: number): void {
    if (this.changeMapDelay > 0) {
      this.changeMapDelay -= delay;
      if (this.changeMapDelay <= 0) {
        this.changeMapDelay = 0;
        if (this.opts.onMapChangeRequest) this.opts.onMapChangeRequest(this.map.name);
        else this.changeMap(this.map);
      }
    }
    if (this.gameTimeLeft > 0) this.gameTimeLeft -= delay;
    if (this.roundTimeLeft > 0) this.roundTimeLeft -= delay;
    if (this.gameTimeLeft < 0) this.gameTimeLeft = 0;
    if (this.roundTimeLeft < 0) this.roundTimeLeft = 0;

    if (this.roundState !== GAME_PLAYING) return;
    if (this.gameType === GAME_TYPE_CTF) this.updateCTF();
    this.updateAutoBalance(delay);

    const timeUp = this.gameTimeLeft === 0 && sv.sv_gameTimeLimit > 0;
    let state = GAME_PLAYING;
    if (this.gameType === GAME_TYPE_DM) {
      // Time up, or a player reached the score limit
      if (timeUp || this.players.some((p) => p && p.score >= sv.sv_scoreLimit && sv.sv_scoreLimit > 0)) state = GAME_DONT_SHOW;
    } else if (this.gameType === GAME_TYPE_TDM) {
      // A team reached the score limit (frags); time up ends the game without a winner
      const limit = sv.sv_scoreLimit;
      if (limit > 0 && this.blueScore === this.redScore && this.redScore >= limit) state = GAME_DRAW;
      else if (limit > 0 && this.blueScore >= limit) state = GAME_BLUE_WIN;
      else if (limit > 0 && this.redScore >= limit) state = GAME_RED_WIN;
      if (timeUp) state = GAME_DONT_SHOW;
    } else if (this.gameType === GAME_TYPE_CTF) {
      // A team reached the win limit (captures); time up: the one with more captures
      const limit = sv.sv_winLimit;
      if (limit > 0 && this.blueWin === this.redWin && this.redWin >= limit) state = GAME_DRAW;
      else if (limit > 0 && this.blueWin >= limit) state = GAME_BLUE_WIN;
      else if (limit > 0 && this.redWin >= limit) state = GAME_RED_WIN;
      if (timeUp) state = this.blueWin === this.redWin ? GAME_DRAW : this.blueWin > this.redWin ? GAME_BLUE_WIN : GAME_RED_WIN;
    }
    if (state !== GAME_PLAYING) {
      this.roundState = state;
      this.changeMapDelay = sv.changeMapDelay;
      this.events.push({ type: 'roundState', state: this.roundState });
    }
  }

  /** Loads a new map (after the end-of-map delay): scores reset, everybody respawns. */
  changeMap(map: GameMap): void {
    this.map = map;
    this.projectiles = [];
    this.blueScore = 0;
    this.redScore = 0;
    this.blueWin = 0;
    this.redWin = 0;
    this.resetFlags();
    this.gameTimeLeft = sv.sv_gameTimeLimit;
    this.roundTimeLeft = sv.sv_roundTimeLimit;
    this.roundState = GAME_PLAYING;
    this.firstBloodDone = false;
    for (const p of this.players) {
      if (!p) continue;
      p.reinit();
      p.kill(true);
      p.timeToSpawn = 0;
      p.spawnRequested = false;
      p.incShot = 0;
    }
    this.events.push({ type: 'mapChange', mapName: map.name });
    this.events.push({ type: 'roundState', state: this.roundState });
  }

  // ---------------------------------------------------------------- shooting

  /**
   * Game::shoot — the shooter fires (direct shot or projectile). A 'client' game traces its own
   * direct shots right away, so they show without waiting for the server, and sends them; rockets
   * and throws are sent as requests. Otherwise the shot is handled here and now.
   */
  shoot(position: Vec3, direction: Vec3, _imp: number, _damage: number, from: Player, projectileType: number): void {
    const weapon = from.weapon;
    if (!weapon) return;
    const isThrow = projectileType === PROJECTILE_GRENADE || projectileType === PROJECTILE_COCKTAIL_MOLOTOV;
    if (this.mode === 'client') {
      if (projectileType === PROJECTILE_DIRECT) this.predictShot(from, position, direction);
      else if (projectileType === PROJECTILE_ROCKET || isThrow) {
        if (!this.predictProjectile(from, projectileType, position, direction)) return;
        const weaponID = projectileType === PROJECTILE_GRENADE ? WEAPON_GRENADE : projectileType === PROJECTILE_COCKTAIL_MOLOTOV ? WEAPON_COCKTAIL_MOLOTOV : weapon.weaponID;
        this.net?.projectile(projectileType, position, direction, weapon.firingNuzzle, weaponID);
      }
      return;
    }
    if (projectileType === PROJECTILE_DIRECT) this.fireDirect(from, position, direction, weapon.firingNuzzle);
    else if (projectileType === PROJECTILE_ROCKET || isThrow) this.handleProjectileRequest(from, projectileType, position, direction, weapon.firingNuzzle, false);
  }

  /**
   * Client mode: our rocket, grenade or molotov starts flying on our screen now, like the server's
   * will (same launch, see Projectile), instead of a round trip later. With our rocket in the air
   * the click detonates it here too (Game.handleProjectileRequest). False: don't send it.
   */
  private predictProjectile(from: Player, type: number, origin: Vec3, direction: Vec3): boolean {
    if (type === PROJECTILE_ROCKET && from.rocketInAir) {
      const rocket = this.projectiles.find((p) => p.predicted && p.projectileType === PROJECTILE_ROCKET && p.fromID === from.playerID && !p.needToBeDeleted);
      if (!rocket) return true; // the server's, not predicted: it decides
      // The server detonates only after 0.25 s of flight, and launches a new rocket otherwise
      if (!(sv.sv_zookaRemoteDet && sv.sv_serverType === SERVER_TYPE_PRO) || rocket.timeSinceThrown < 0.3) return false;
      from.detonateRocket = true;
      return true;
    }
    if (type === PROJECTILE_COCKTAIL_MOLOTOV && !sv.sv_enableMolotov) return true;
    const p = new Projectile(origin.clone(), direction.clone(), from.playerID, type, --this.predictedProjectileID);
    p.predicted = true;
    this.projectiles.push(p);
    if (type === PROJECTILE_ROCKET) from.rocketInAir = true;
    this.events.push({ type: 'projectileSpawn', uniqueID: p.uniqueID, nuzzleID: 0, launchPosition: origin.clone(), launchVel: direction.clone() });
    return true;
  }

  /** A direct shot traced and applied here, against the babos where this game has them. */
  private fireDirect(from: Player, origin: Vec3, direction: Vec3, nuzzleID: number): void {
    const weapon = from.weapon;
    if (!weapon || weapon.projectileType !== PROJECTILE_DIRECT) return;
    if (!(from.isAlive || (from.isDead && from.timeDead < 0.2))) return;
    this.beforeShot(from);
    for (const b of this.fanOut(from, origin.clone(), direction.clone())) {
      this.traceBabos(from, weapon.weaponID, b);
      this.applyBullet(from, weapon.weaponID, nuzzleID, b);
    }
    from.firedShowDelay = 2;
  }

  /**
   * Online client: our shot, traced here against the babos as we see them. The trail, the impact
   * and the blood show right away; the bullets and the babos they touched go to the server, which
   * checks them and decides the damage.
   */
  private predictShot(from: Player, origin: Vec3, direction: Vec3): void {
    const weapon = from.weapon;
    if (!weapon || weapon.projectileType !== PROJECTILE_DIRECT) return;
    const weaponID = weapon.weaponID;
    const nuzzleID = weapon.firingNuzzle;
    const piercing = weaponID === WEAPON_PHOTON_RIFLE || weaponID === WEAPON_FLAME_THROWER;
    this.beforeShot(from);
    const bullets: number[][] = [];
    for (const b of this.fanOut(from, origin.clone(), direction.clone())) {
      this.traceBabos(from, weaponID, b);
      const hitPlayerID = !piercing && b.hits.length ? b.hits[0].playerID : -1;
      this.events.push({ type: 'shoot', playerID: from.playerID, weaponID, nuzzleID, p1: b.p1.clone(), p2: b.p2.clone(), normal: b.normal.clone(), hitPlayerID });
      for (const h of b.hits) this.events.push({ type: 'hitPredicted', playerID: h.playerID, fromID: from.playerID, weaponID, position: h.currentCF.position.clone() });
      bullets.push([b.p2.x, b.p2.y, b.p2.z, ...b.hits.map((h) => h.playerID)]);
    }
    from.firedShowDelay = 2;
    this.net?.shoot(origin, nuzzleID, weaponID, bullets);
  }

  /**
   * Server: a shot traced by the shooter's own client (NET_CLSV_PLAYER_SHOOT), each bullet with
   * where it ended and which babos it touched on the shooter's screen. The shooter sees the others
   * a little in the past (network delay), so a touched babo counts if it really was there during
   * that time (lag compensation); walls are checked here. If a claim doesn't hold, the server's
   * own view decides that bullet.
   */
  handleShootNet(from: Player, origin: Vec3, nuzzleID: number, weaponID: number, bullets: { end: Vec3; hits: number[] }[]): void {
    const weapon = from.weapon;
    if (!weapon || weapon.projectileType !== PROJECTILE_DIRECT || weaponID !== weapon.weaponID) return;
    if (!(from.isAlive || (from.isDead && from.timeDead < 0.2))) return;
    if (!this.validShotOrigin(from, origin)) return;
    if (!this.consumeShotToken(from, weapon.fireDelay)) return;
    this.beforeShot(from);
    weapon.shotFrom.copy(origin);
    const id = weapon.weaponID;
    const piercing = id === WEAPON_PHOTON_RIFLE || id === WEAPON_FLAME_THROWER;
    const radius = id === WEAPON_FLAME_THROWER ? 0.5 : 0.25;
    const maxRange = id === WEAPON_FLAME_THROWER ? sv.sv_ftMaxRange : 128;
    // The sniper fires 3 bullets zoomed out (camera >= 10), 2 otherwise; the camera height we know lags a little
    const maxBullets = id === WEAPON_SNIPER ? (from.input.camPosZ >= 9 ? 3 : 2) : Math.max(1, weapon.nbShot);
    const since = this.frame - Math.min(LAG_COMP_MAX_FRAMES, from.pingFrames + LAG_COMP_MARGIN_FRAMES);
    nuzzleID = Math.max(0, Math.trunc(nuzzleID));
    for (const bullet of bullets.slice(0, maxBullets)) {
      const p1 = origin.clone();
      const pushOut = new Vec3();
      // Shot starting inside a wall: push it out
      if (this.map.rayTest(from.currentCF.position.clone(), p1, pushOut)) p1.addIn(pushOut.mul(0.01));
      const dir = bullet.end.sub(p1);
      let len = dir.length();
      if (!(len > 1e-4)) continue;
      dir.mulIn(1 / len);
      if (len > maxRange) len = maxRange;
      const b: Bullet = { p1, p2: p1.add(dir.mul(len)), normal: new Vec3(), hits: [] };
      this.map.rayTest(b.p1, b.p2, b.normal); // stops at the first wall
      const reach = b.p2.sub(b.p1).length();
      let trusted = true;
      for (const targetID of bullet.hits) {
        const t = this.players[targetID];
        const ok =
          !!t &&
          t !== from &&
          t.isAlive &&
          (piercing
            ? this.canPierce(from, t) && t.wasNear(since, (c) => distanceToSegment(c, b.p1, b.p2) <= radius + LAG_COMP_TOLERANCE)
            : bullet.end.sub(b.p1).length() <= reach + 0.05 && t.wasNear(since, (c) => distance(c, bullet.end) <= radius + LAG_COMP_TOLERANCE));
        if (!ok) {
          trusted = false;
          break;
        }
        if (!b.hits.includes(t)) b.hits.push(t);
        if (!piercing) break; // one babo at most
      }
      if (!trusted) this.traceBabos(from, id, b);
      else if (b.hits.length) {
        if (!piercing) b.p2 = bullet.end.clone();
        b.normal = dir.clone();
      }
      this.applyBullet(from, id, nuzzleID, b);
    }
    from.firedShowDelay = 2;
  }

  /** Server side of NET_CLSV_SVCL_PLAYER_PROJECTILE (rocket, grenade, molotov). */
  handleProjectileRequest(from: Player, projectileType: number, origin: Vec3, direction: Vec3, nuzzleID: number, validate = true): void {
    const weapon = from.weapon;
    if (!weapon) return;
    if (!(from.isAlive || (from.isDead && from.timeDead < 0.2))) return;
    let dir = direction;
    if (validate) {
      if (!this.validShotOrigin(from, origin)) return;
      dir = sanitizeDirection(direction);
    }
    if (projectileType === PROJECTILE_COCKTAIL_MOLOTOV && !sv.sv_enableMolotov) return;
    if (projectileType === PROJECTILE_ROCKET) {
      // No rocket launcher in hand, no rocket
      if (weapon.weaponID !== WEAPON_BAZOOKA) return;
      if (sv.sv_zookaRemoteDet && sv.sv_serverType === SERVER_TYPE_PRO) {
        if (from.rocketInAir && from.mfElapsedSinceLastShot > 0.25) {
          // Rocket already in the air: detonate it instead of launching another one
          from.detonateRocket = true;
          return;
        }
      }
      if (validate && !this.consumeShotToken(from, weapon.fireDelay)) return;
      if (!this.spawnProjectile(origin, dir, from.playerID, projectileType, 0, nuzzleID)) return;
      from.rocketInAir = true;
      from.mfElapsedSinceLastShot = 0;
    } else if (projectileType === PROJECTILE_GRENADE || projectileType === PROJECTILE_COCKTAIL_MOLOTOV) {
      this.spawnProjectile(origin, dir, from.playerID, projectileType, 0, nuzzleID);
    }
  }

  /** The muzzle of a babo is at most ~.7 units from its centre: reject shots from elsewhere. */
  private validShotOrigin(from: Player, origin: Vec3): boolean {
    if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y) || !Number.isFinite(origin.z)) return false;
    const dx = origin.x - from.currentCF.position.x;
    const dy = origin.y - from.currentCF.position.y;
    return dx * dx + dy * dy <= 1.5 * 1.5 && origin.z >= -0.5 && origin.z <= 1.5;
  }

  /** Token bucket refilled in Player.update (one token per fire delay, a burst of 3 at most). */
  private consumeShotToken(from: Player, fireDelay: number): boolean {
    from.shotRate = fireDelay;
    if (from.shotTokens < 0.95) return false;
    from.shotTokens -= 1;
    return true;
  }

  /** Bookkeeping of every shot, wherever it is traced (start of Game::shootSV). */
  private beforeShot(from: Player): void {
    const weapon = from.weapon!;
    const id = weapon.weaponID;
    if (id === WEAPON_SHOTGUN || id === WEAPON_SNIPER) {
      if (id === WEAPON_SNIPER) weapon.nbShot = from.input.camPosZ >= 10 ? 3 : 2;
      from.mfElapsedSinceLastShot = 0;
    } else {
      // Used to track how long an automatic weapon has been firing (flame thrower range)
      if (from.mfElapsedSinceLastShot < weapon.fireDelay + 0.05) from.secondsFired += weapon.fireDelay;
      else from.secondsFired = 0;
      from.mfElapsedSinceLastShot = 0;
    }
  }

  /** Game::shootSV(net_clsv_player_shoot) — fans a shot out into bullets (pro rules), up to the walls. */
  private fanOut(player: Player, p1: Vec3, p2: Vec3): Bullet[] {
    const weapon = player.weapon!;
    weapon.shotFrom.copy(p1);
    const out: Bullet[] = [];
    if (weapon.weaponID === WEAPON_SHOTGUN) {
      const directionAngles = [-10, -5, 0, 5, 10];
      const deviationAngles = [1, 2, 3, 4, 5]; // identifiers of each pellet (see pellet)
      for (let i = 0; i < weapon.nbShot; ++i) {
        out.push(this.pellet(player, deviationAngles[i], p1.clone(), rotateAboutAxis(p2, directionAngles[i], Z_AXIS)));
      }
    } else if (weapon.weaponID === WEAPON_SNIPER) {
      for (let i = 0; i < weapon.nbShot; ++i) out.push(this.pellet(player, 0, p1.clone(), p2.clone()));
    } else if (weapon.weaponID === WEAPON_CHAIN_GUN) {
      weapon.currentImp += 3;
      if (weapon.currentImp > weapon.impressision) weapon.currentImp = weapon.impressision;
      let imp = weapon.currentImp;
      if (sv.sv_serverType === SERVER_TYPE_PRO && player.currentCF.vel.length() < 1.15) imp /= 2.7;
      for (let i = 0; i < weapon.nbShot; ++i) out.push(this.pellet(player, imp, p1.clone(), p2.clone()));
    } else {
      weapon.currentImp += 3;
      if (weapon.currentImp > weapon.impressision) weapon.currentImp = weapon.impressision;
      for (let i = 0; i < weapon.nbShot; ++i) out.push(this.pellet(player, weapon.currentImp, p1.clone(), p2.clone()));
    }
    return out;
  }

  /**
   * Game::shootSV(int playerID, int nuzzleID, float imp, p1, p2) up to the walls: one bullet with
   * its spread, range and wall hit. `p2` is a direction.
   */
  private pellet(player: Player, imp: number, p1: Vec3, p2: Vec3): Bullet {
    const weapon = player.weapon!;
    const weaponID = weapon.weaponID;
    const ident = Math.trunc(imp);
    let oldP2 = new Vec3();
    if (weaponID === WEAPON_SHOTGUN) {
      const angles: Record<number, number> = { 1: 10, 2: 5, 3: 0, 4: -5, 5: -10 };
      oldP2 = rotateAboutAxis(p2, angles[ident] ?? 0, Z_AXIS).normalizeIn();
      imp = 3.5;
    }

    const dir = p2.clone();
    if (weaponID === WEAPON_FLAME_THROWER) {
      if (sv.sv_ftExpirationTimer > 0) {
        // The flame thrower range decreases the longer it's fired
        let mult = (1 - player.secondsFired / sv.sv_ftExpirationTimer) * sv.sv_ftMaxRange;
        if (mult < sv.sv_ftMinRange) mult = sv.sv_ftMinRange;
        p2 = p2.mul(mult);
      } else p2 = p2.mul(sv.sv_ftMaxRange);
    } else p2 = p2.mul(128);

    p2 = rotateAboutAxis(p2, randRange(-imp, imp), Z_AXIS);
    const dirN = dir.clone().normalizeIn();
    p2 = rotateAboutAxis(p2, randRange(0, 360), dirN);
    p2.z *= 0.5;
    p2.addIn(p1);

    const normal = new Vec3();
    if (weaponID === WEAPON_SHOTGUN) {
      // Clamp the pellet
      const d = p2.sub(p1).normalizeIn();
      let clampShot: number;
      const variation = 0.01;
      if (sv.sv_serverType === SERVER_TYPE_PRO) {
        const sinTheta = d.cross(oldP2).length();
        clampShot = sv.sv_shottyDropRadius / sinTheta;
      } else {
        switch (ident) {
          case 1:
          case 5:
            clampShot = sv.sv_shottyRange * (0.333 + randRange(-variation, variation));
            break;
          case 2:
          case 4:
            clampShot = sv.sv_shottyRange * (0.667 + randRange(-variation, variation));
            break;
          default:
            clampShot = sv.sv_shottyRange;
        }
      }
      if (!Number.isFinite(clampShot)) clampShot = 128;
      p2 = p1.add(d.mul(clampShot));
    }

    // Shot starting inside a wall: push it out
    if (this.map.rayTest(player.currentCF.position.clone(), p1, normal)) p1.addIn(normal.mul(0.01));
    this.map.rayTest(p1, p2, normal);
    return { p1, p2, normal, hits: [] };
  }

  /** Photon beam and flames hurt the babos they cross (as the original loop tested them). */
  private canPierce(player: Player, other: Player): boolean {
    return other.teamID !== player.teamID || this.gameType === GAME_TYPE_DM || this.gameType === GAME_TYPE_SND || sv.sv_friendlyFire || sv.sv_reflectedDamage;
  }

  /** Which babos a bullet touches, with everybody where this game has them (end of Game::shootSV). */
  private traceBabos(player: Player, weaponID: number, b: Bullet): void {
    b.hits = [];
    if (weaponID === WEAPON_PHOTON_RIFLE || weaponID === WEAPON_FLAME_THROWER) {
      let p3 = b.p2.clone();
      for (const other of this.players) {
        if (!other || other === player || !other.isAlive || !this.canPierce(player, other)) continue;
        if (segmentToSphere(b.p1, p3, other.currentCF.position, weaponID === WEAPON_FLAME_THROWER ? 0.5 : 0.25)) {
          b.normal = p3.sub(b.p1).normalizeIn();
          p3 = b.p2.clone(); // full length (goes through everybody)
          b.hits.push(other);
        }
      }
    } else {
      let hit: Player | null = null;
      for (const other of this.players) {
        if (!other || other === player || !other.isAlive) continue;
        // segmentToSphere shortens p2 to the hit point, so the closest babo wins
        if (segmentToSphere(b.p1, b.p2, other.currentCF.position, 0.25)) {
          hit = other;
          b.normal = b.p2.sub(b.p1).normalizeIn();
        }
      }
      if (hit) b.hits.push(hit);
    }
  }

  /** Damage, knockback and the shot event of one bullet. */
  private applyBullet(player: Player, weaponID: number, nuzzleID: number, b: Bullet): void {
    if (weaponID === WEAPON_PHOTON_RIFLE || weaponID === WEAPON_FLAME_THROWER) {
      if (weaponID === WEAPON_PHOTON_RIFLE) {
        player.p1.copy(b.p1);
        player.p2.copy(b.p2);
        player.incShot = 30;
      }
      for (const other of b.hits) other.hitSV(weaponID, player, weaponDefs[weaponID].damage);
      this.events.push({ type: 'shoot', playerID: player.playerID, weaponID, nuzzleID, p1: b.p1.clone(), p2: b.p2.clone(), normal: b.normal.clone(), hitPlayerID: -1 });
      return;
    }
    const hit = b.hits[0] ?? null;
    if (hit) {
      // Knockback on the victim (ClientRecv NET_SVCL_PLAYER_SHOOT)
      const direction = b.p2.sub(b.p1).normalizeIn();
      hit.currentCF.vel.addIn(direction.mul(weaponDefs[weaponID].damage * 2));
      hit.hitSV(weaponID, player);
    }
    this.events.push({
      type: 'shoot',
      playerID: player.playerID,
      weaponID,
      nuzzleID,
      p1: b.p1.clone(),
      p2: b.p2.clone(),
      normal: b.normal.clone(),
      hitPlayerID: hit ? hit.playerID : -1,
    });
  }

  /** Game::playerInRadius */
  playerInRadius(position: Vec3, radius: number, ignore = -1): Player | null {
    for (const p of this.players) {
      if (!p || !p.isAlive || p.playerID === ignore) continue;
      if (distanceSquared(position, p.currentCF.position) <= (radius + 0.25) * (radius + 0.25)) return p;
    }
    return null;
  }

  /** Game::radiusHit — damage falls off with the distance, walls protect. */
  radiusHit(pos: Vec3, radius: number, fromID: number, weaponID: number, sameDmg = false): void {
    const position = pos.clone();
    const from = this.players[fromID];
    if (!from) return;
    const weaponDamage = weaponID === WEAPON_BAZOOKA ? bazookaDamage() : weaponDefs[weaponID].damage;
    for (const player of this.players) {
      if (!player) continue;
      if (player.playerID === fromID && weaponID === WEAPON_KNIVES) continue;
      const dis = distance(player.currentCF.position, position);
      if (dis < radius) {
        const normal = new Vec3();
        if (!this.map.rayTest(position.clone(), player.currentCF.position.clone(), normal)) {
          player.hitSV(weaponID, from, (sameDmg ? 1 : 1 - dis / radius) * weaponDamage);
        }
      }
    }
  }

  /** Whether a blast there would hurt that player (Game::radiusHit's distance and wall rules). */
  blastReaches(pos: Vec3, radius: number, playerID: number): boolean {
    const p = this.players[playerID];
    if (!p || !p.isAlive || distance(p.currentCF.position, pos) >= radius) return false;
    return !this.map.rayTest(pos.clone(), p.currentCF.position.clone(), new Vec3());
  }

  explosion(position: Vec3, normal: Vec3, radius: number, playerID: number): void {
    this.events.push({ type: 'explosion', position, normal, radius, playerID });
  }

  /** The nuke bot explodes (Weapon::update, WEAPON_NUCLEAR). */
  nukeExplode(owner: Player): void {
    const bot = owner.minibot;
    if (!bot || !this.isAuthority) return;
    const pos = bot.currentCF.position.clone();
    this.explosion(pos.clone(), new Vec3(0, 0, 1), sv.sv_nukeRadius, owner.playerID);
    this.radiusHit(pos, sv.sv_nukeRadius, owner.playerID, WEAPON_NUCLEAR);
    owner.minibot = null;
  }

  /** Game::spawnProjectile (server). `nuzzleID` is only used by the remote clients' fire effects. */
  spawnProjectile(position: Vec3, vel: Vec3, fromID: number, projectileType: number, weaponID: number, nuzzleID = 0): boolean {
    const from = this.players[fromID];
    if (projectileType === PROJECTILE_GRENADE) {
      if (!from || from.nbGrenadeLeft <= 0) return false;
      from.nbGrenadeLeft--;
    }
    if (projectileType === PROJECTILE_COCKTAIL_MOLOTOV) {
      if (!from || from.nbMolotovLeft <= 0) return false;
      from.nbMolotovLeft--;
    }
    const projectile = new Projectile(position.clone(), vel.clone(), fromID, projectileType, ++this.uniqueProjectileID, weaponID);
    this.projectiles.push(projectile);
    this.events.push({ type: 'projectileSpawn', uniqueID: projectile.uniqueID, nuzzleID, launchPosition: position.clone(), launchVel: vel.clone() });
    return true;
  }

  /** NET_CLSV_PICKUP_REQUEST — swap weapons with one lying on the ground. */
  pickupRequest(player: Player): void {
    if (this.mode === 'client') {
      this.net?.pickup();
      return;
    }
    if (!player.isAlive || !player.weapon) return;
    for (const projectile of this.projectiles) {
      if (projectile.projectileType !== PROJECTILE_DROPED_WEAPON || projectile.needToBeDeleted) continue;
      const a = new Vec3(projectile.currentCF.position.x, projectile.currentCF.position.y, 0);
      const b = new Vec3(player.currentCF.position.x, player.currentCF.position.y, 0);
      if (distanceSquared(a, b) <= 0.5 * 0.5) {
        // Drop ours
        this.spawnProjectile(player.currentCF.position.clone(), player.currentCF.vel.clone(), player.playerID, PROJECTILE_DROPED_WEAPON, player.weapon.weaponID);
        player.switchWeapon(projectile.weaponID);
        this.events.push({ type: 'pickup', playerID: player.playerID, itemType: ITEM_WEAPON, itemFlag: projectile.weaponID });
        projectile.needToBeDeleted = true;
        break;
      }
    }
  }

  getProjectile(uniqueID: number): Projectile | undefined {
    return this.projectiles.find((p) => p.uniqueID === uniqueID);
  }
}

/** Normalized horizontal-ish direction from a network message (falls back to +Y). */
function sanitizeDirection(d: Vec3): Vec3 {
  const v = new Vec3(Number.isFinite(d.x) ? d.x : 0, Number.isFinite(d.y) ? d.y : 0, Number.isFinite(d.z) ? Math.max(-1, Math.min(1, d.z)) : 0);
  if (v.lengthSq() < 1e-8) return new Vec3(0, 1, 0);
  return v.normalizeIn();
}
