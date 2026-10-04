// Port of GameProjectile.cpp (server-side behaviour; visuals live in the client).
import {
  PROJECTILE_COCKTAIL_MOLOTOV,
  PROJECTILE_DROPED_GRENADE,
  PROJECTILE_DROPED_WEAPON,
  PROJECTILE_FLAME,
  PROJECTILE_GRENADE,
  PROJECTILE_LIFE_PACK,
  PROJECTILE_ROCKET,
  SERVER_TYPE_PRO,
  SOUND_MOLOTOV,
  ITEM_LIFE_PACK,
  WEAPON_BAZOOKA,
  WEAPON_COCKTAIL_MOLOTOV,
  WEAPON_GRENADE,
} from './constants';
import { CoordFrame } from './coordFrame';
import { sv } from './gameVar';
import { angleFromDir, reflect } from './helpers';
import { Vec3, randRange, randVec } from './vec';
import type { Game } from './game';

export class Projectile {
  readonly uniqueID: number;
  readonly projectileType: number;
  /** Player who fired it (for PROJECTILE_DROPED_WEAPON the original stored the weapon id here). */
  readonly fromID: number;
  /** Weapon id for dropped weapons. */
  readonly weaponID: number;
  currentCF = new CoordFrame();
  lastCF = new CoordFrame();
  duration = 0;
  timeSinceThrown = 0;
  damageTime = 0;
  stickToPlayer = -1;
  stickFor = 0;
  movementLock = false;
  needToBeDeleted = false;
  reallyNeedToBeDeleted = false;
  // Visual rotation (kept in the sim so every viewer sees the same spin)
  rotation = 0;
  rotateVel = 0;
  /**
   * Client mode: our own rocket, grenade or molotov, flying on our screen from the moment we fire
   * (Game.predictProjectile). Same flight and blasts as the server's, but no damage and no flames:
   * the server's copy decides those.
   */
  predicted = false;
  /** Client mode: the server's copy of a projectile we predicted, kept up to date but not drawn. */
  hidden = false;

  constructor(position: Vec3, vel: Vec3, fromID: number, projectileType: number, uniqueID: number, weaponID = 0) {
    this.fromID = fromID;
    this.weaponID = weaponID;
    this.uniqueID = uniqueID;
    this.projectileType = projectileType;
    this.currentCF.position.copy(position);
    this.currentCF.vel.copy(vel);

    switch (projectileType) {
      case PROJECTILE_ROCKET:
        this.rotateVel = 360;
        this.duration = 10;
        this.currentCF.angle = angleFromDir(vel);
        // The rocket starts faster
        this.currentCF.vel.mulIn(2.5);
        break;
      case PROJECTILE_GRENADE:
        this.rotateVel = 360;
        this.duration = 2;
        this.currentCF.vel.mulIn(5);
        this.currentCF.vel.z += 5; // not too steep, we want to hit walls
        break;
      case PROJECTILE_COCKTAIL_MOLOTOV:
        this.rotateVel = 360;
        this.duration = 10;
        this.currentCF.vel.mulIn(6);
        this.currentCF.vel.z += 2;
        break;
      case PROJECTILE_LIFE_PACK:
        this.rotateVel = randRange(-90, 90);
        this.duration = 20;
        break;
      case PROJECTILE_DROPED_WEAPON:
        this.rotateVel = randRange(-90, 90);
        this.duration = 30;
        break;
      case PROJECTILE_DROPED_GRENADE:
        this.rotateVel = randRange(-90, 90);
        this.duration = 25;
        break;
      case PROJECTILE_FLAME:
        this.rotateVel = 0;
        this.duration = 10;
        break;
    }
    this.lastCF.copyFrom(this.currentCF);
  }

  /** A projectile mirrored from the server (client mode): state taken as-is, no launch boost. */
  static fromNetwork(
    uniqueID: number,
    projectileType: number,
    fromID: number,
    weaponID: number,
    position: Vec3,
    vel: Vec3,
    angle: number,
    rotateVel: number,
  ): Projectile {
    const p = new Projectile(position, vel, fromID, projectileType, uniqueID, weaponID);
    p.currentCF.vel.copy(vel);
    p.currentCF.angle = angle;
    p.rotateVel = rotateVel;
    p.lastCF.copyFrom(p.currentCF);
    return p;
  }

  /**
   * An explosion (Game::explosion) and its damage (Game::radiusHit). A predicted projectile does no
   * damage, and when its blast would reach its own shooter it shows nothing: the server's blast
   * then arrives together with the damage, instead of our blast first and our death a round trip
   * later.
   */
  private blast(game: Game, pos: Vec3, normal: Vec3, radius: number, playerID: number, hitRadius: number, weaponID: number): void {
    if (this.predicted) {
      if (!game.blastReaches(pos, hitRadius, this.fromID)) game.explosion(pos, normal, radius, playerID);
      return;
    }
    game.explosion(pos, normal, radius, playerID);
    game.radiusHit(pos, hitRadius, this.fromID, weaponID);
  }

  /** Projectile::update (server logic). */
  update(delay: number, game: Game): void {
    const map = game.map;
    this.rotation += delay * this.rotateVel;
    while (this.rotation >= 360) this.rotation -= 360;
    while (this.rotation < 0) this.rotation += 360;

    this.lastCF.copyFrom(this.currentCF);
    this.currentCF.frameID++;
    this.timeSinceThrown += delay;

    const cf = this.currentCF;
    let speed = cf.vel.length();
    const type = this.projectileType;

    if (type === PROJECTILE_ROCKET) {
      if (speed > 10) {
        cf.vel.mulIn(10 / speed);
        speed = 10;
      }
      cf.position.addScaledIn(cf.vel, delay);
      // Exponential acceleration
      cf.vel.addIn(cf.vel.mul(delay * 3));
    }

    if (type === PROJECTILE_COCKTAIL_MOLOTOV) {
      cf.position.addScaledIn(cf.vel, delay);
      cf.vel.z -= 9.8 * delay;
    }

    if (type === PROJECTILE_FLAME && !this.movementLock) {
      cf.position.addScaledIn(cf.vel, delay);
      cf.vel.z -= 9.8 * delay;
    }

    // Flame stuck on a player
    if (type === PROJECTILE_FLAME) {
      if (this.stickToPlayer >= 0) {
        const p = game.players[this.stickToPlayer];
        if (p) {
          if (p.isDead) this.stickToPlayer = -1;
          else cf.position.copy(p.currentCF.position);
        }
        this.stickFor -= delay;
        if (this.stickFor <= 0) {
          this.stickFor = 0;
          this.stickToPlayer = -1;
          this.movementLock = false;
          this.stickFor = 1.0; // 1 sec before sticking to another player
          game.events.push({ type: 'flameStick', uniqueID: this.uniqueID, playerID: -1 });
        }
      }
      if (this.stickToPlayer === -1) {
        this.stickFor -= delay;
        if (this.stickFor <= 0) {
          this.stickFor = 0;
          const p = game.playerInRadius(cf.position, 0.5, this.timeSinceThrown > 0.5 ? -1 : this.fromID);
          if (p) {
            this.movementLock = true;
            this.stickToPlayer = p.playerID;
            this.stickFor = 3;
            game.events.push({ type: 'flameStick', uniqueID: this.uniqueID, playerID: p.playerID });
          }
        }
      }
      this.damageTime++;
      if (this.damageTime >= 20) {
        this.damageTime = 0;
        game.radiusHit(cf.position, 0.5, this.fromID, WEAPON_COCKTAIL_MOLOTOV);
      }
    }

    // Flame hits the ground/wall: lock it there
    if (type === PROJECTILE_FLAME && !this.movementLock) {
      const p2 = cf.position.clone();
      const normal = new Vec3();
      if (map.rayTest(this.lastCF.position.clone(), p2, normal)) {
        this.movementLock = true;
        cf.position.copy(p2.add(normal.mul(0.1)));
      }
    }

    const bouncing =
      type === PROJECTILE_GRENADE || type === PROJECTILE_LIFE_PACK || type === PROJECTILE_DROPED_WEAPON || type === PROJECTILE_DROPED_GRENADE;
    if (speed > 0.5 || cf.position.z > 0.2) {
      if (bouncing) {
        cf.position.addScaledIn(cf.vel, delay);
        cf.vel.z -= 9.8 * delay;
        const p2 = cf.position.clone();
        const normal = new Vec3();
        if (map.rayTest(this.lastCF.position.clone(), p2, normal)) {
          game.events.push({ type: 'grenadeRebound', position: p2.clone() });
          cf.position.copy(p2.add(normal.mul(0.01)));
          cf.vel = reflect(cf.vel, normal).mul(0.65);
        }
      }
    } else {
      cf.vel.set(0, 0, 0);
    }

    // Lifetime (the server decides)
    this.duration -= delay;
    if (this.duration <= 0) {
      if (type === PROJECTILE_GRENADE) {
        if (this.needToBeDeleted) return;
        this.needToBeDeleted = true;
        this.blast(game, cf.position.clone(), new Vec3(0, 0, 1), 1.5, -1, 3, WEAPON_GRENADE);
        return;
      }
      if (type === PROJECTILE_ROCKET) {
        const owner = game.players[this.fromID];
        if (owner) {
          owner.rocketInAir = false;
          owner.detonateRocket = false;
        }
      }
      this.needToBeDeleted = true;
      return;
    }

    // Rocket collisions
    const zookaRadius = sv.sv_zookaRemoteDet && sv.sv_serverType === SERVER_TYPE_PRO ? sv.sv_zookaRadius : 3.0;
    if (type === PROJECTILE_ROCKET && !this.needToBeDeleted) {
      const owner = game.players[this.fromID];
      let hit = game.playerInRadius(cf.position, 0.25);
      if (hit && hit.playerID === this.fromID) hit = null;
      if (hit) {
        if (owner) {
          owner.rocketInAir = false;
          owner.detonateRocket = false;
        }
        this.needToBeDeleted = true;
        const pos = hit.currentCF.position.clone();
        this.blast(game, pos, new Vec3(0, 0, 1), zookaRadius, this.fromID, zookaRadius, WEAPON_BAZOOKA);
        return;
      }
      const p2 = cf.position.clone();
      const normal = new Vec3();
      if (map.rayTest(this.lastCF.position.clone(), p2, normal) || (owner && owner.detonateRocket)) {
        if (owner) {
          owner.rocketInAir = false;
          owner.detonateRocket = false;
        }
        p2.addIn(normal.mul(0.1));
        this.needToBeDeleted = true;
        this.blast(game, p2.clone(), normal.clone(), zookaRadius, this.fromID, zookaRadius, WEAPON_BAZOOKA);
        return;
      }
    }

    // Molotov collisions
    if (type === PROJECTILE_COCKTAIL_MOLOTOV && !this.needToBeDeleted) {
      let hit = game.playerInRadius(cf.position, 0.25, this.fromID);
      if (hit && hit.playerID === this.fromID) hit = null;
      if (hit) {
        // Molotov party on a babo
        this.needToBeDeleted = true;
        game.events.push({ type: 'sound', soundID: SOUND_MOLOTOV, position: cf.position.clone(), volume: 250, range: 5 });
        if (this.predicted) return;
        game.spawnProjectile(cf.position.clone(), new Vec3(), this.fromID, PROJECTILE_FLAME, 0);
        // (the original computed a random velocity for the second flame but then sent 0)
        game.spawnProjectile(cf.position.clone(), new Vec3(), this.fromID, PROJECTILE_FLAME, 0);
        return;
      }
      const p2 = cf.position.clone();
      const normal = new Vec3();
      if (map.rayTest(this.lastCF.position.clone(), p2, normal)) {
        cf.position.copy(p2.add(normal.mul(0.1)));
        this.needToBeDeleted = true;
        game.events.push({ type: 'sound', soundID: SOUND_MOLOTOV, position: p2.clone(), volume: 250, range: 5 });
        if (this.predicted) return;
        game.spawnProjectile(cf.position.clone(), new Vec3(), this.fromID, PROJECTILE_FLAME, 0);
        const vel = reflect(cf.vel.mul(0.5), normal).add(randVec(new Vec3(-1, -1, 0), new Vec3(1, 1, 1)));
        game.spawnProjectile(cf.position.clone(), vel, this.fromID, PROJECTILE_FLAME, 0);
        return;
      }
    }

    // Life pack pickup
    if (type === PROJECTILE_LIFE_PACK && !this.needToBeDeleted) {
      const p = game.playerInRadius(new Vec3(cf.position.x, cf.position.y, 0.25), 0.25, -1, (q) => q.takesLifePacks);
      if (p) {
        p.life += 0.5;
        if (p.life > 1) p.life = 1;
        this.needToBeDeleted = true;
        game.events.push({ type: 'pickup', playerID: p.playerID, itemType: ITEM_LIFE_PACK, itemFlag: 0 });
        return;
      }
    }

    // Grenade pickup
    if (type === PROJECTILE_DROPED_GRENADE && !this.needToBeDeleted) {
      const p = game.playerInRadius(new Vec3(cf.position.x, cf.position.y, 0.25), 0.25);
      if (p) {
        p.giveGrenade();
        this.needToBeDeleted = true;
        return;
      }
    }
  }
}
