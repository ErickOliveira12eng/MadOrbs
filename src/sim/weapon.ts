// Port of Weapon.cpp (weapon instances held by players).
import {
  SOUND_OVERHEAT,
  SOUND_PHOTON_START,
  PROJECTILE_NONE,
  WEAPON_BAZOOKA,
  WEAPON_CHAIN_GUN,
  WEAPON_FLAME_THROWER,
  WEAPON_KNIVES,
  WEAPON_NUCLEAR,
  WEAPON_PHOTON_RIFLE,
  WEAPON_SHIELD,
  WEAPON_SHOTGUN,
  WEAPON_MINIBOT,
} from './constants';
import { sv, weaponDefs, type WeaponDef } from './gameVar';
import { Vec3, rotateAboutAxis } from './vec';
import { weaponDummies, type WeaponDummy } from './weaponDummies';
import type { Player } from './player';

const Z_AXIS = new Vec3(0, 0, 1);

/** Weapon models are rendered with glScalef(0.005f): dummy positions are converted with this. */
export const WEAPON_MODEL_SCALE = 0.005;

export class Weapon {
  readonly def: WeaponDef;
  readonly weaponID: number;
  readonly weaponName: string;
  fireDelay: number;
  currentFireDelay = 0;
  damage: number;
  impressision: number;
  startImp: number;
  currentImp: number;
  nbShot: number;
  reculVel: number;
  projectileType: number;

  modelAnim = 0;
  nukeFrameID = 0;
  // shotgun
  shotInc = 0;
  fullReload = true;
  // photon rifle
  charge = 0;
  justCharged = 0;
  // chain gun overheat
  chainOverHeat = 1;
  overHeated = false;

  firingNuzzle = 0;
  shotFrom = new Vec3();
  owner: Player | null = null;

  constructor(weaponID: number) {
    const d = weaponDefs[weaponID];
    this.def = d;
    this.weaponID = d.id;
    this.weaponName = d.name;
    this.fireDelay = d.fireDelay;
    this.damage = d.damage;
    this.impressision = d.imp;
    this.startImp = d.startImp;
    this.currentImp = d.startImp;
    this.nbShot = d.nbShot;
    this.reculVel = d.reculVel;
    this.projectileType = d.projectileType;
  }

  get nuzzleFlashes(): WeaponDummy[] {
    return weaponDummies[this.weaponID]?.flashes ?? [];
  }

  get ejectingBrass(): WeaponDummy[] {
    return weaponDummies[this.weaponID]?.ejects ?? [];
  }

  /** World position of the current muzzle and the firing direction (Weapon::shoot). */
  firingOriginAndDirection(owner: Player): { origin: Vec3; direction: Vec3 } {
    const flashes = this.nuzzleFlashes;
    let origin: Vec3;
    if (flashes.length > 0) {
      const f = flashes[Math.min(this.firingNuzzle, flashes.length - 1)];
      origin = rotateAboutAxis(Vec3.from(f.position).mul(WEAPON_MODEL_SCALE), owner.currentCF.angle, Z_AXIS).add(owner.currentCF.position);
      origin.z -= owner.currentCF.position.z;
    } else {
      origin = owner.currentCF.position.clone();
    }
    const direction = rotateAboutAxis(new Vec3(0, 1, 0), owner.currentCF.angle, Z_AXIS);
    return { origin, direction };
  }

  /** Port of the client-side Weapon::shoot(Player*) — the shooter's fire logic. */
  shoot(owner: Player): void {
    const game = owner.game;
    // Remote detonation of the rocket already in the air (pro servers).
    if (this.weaponID === WEAPON_BAZOOKA && owner.rocketInAir && this.currentFireDelay <= this.fireDelay - 0.25) {
      if (this.nuzzleFlashes.length > 0) owner.currentCF.position.z = 0.25;
      const { origin, direction } = this.firingOriginAndDirection(owner);
      game.shoot(origin, direction, 0, this.damage, owner, this.projectileType);
      return;
    }

    if (this.currentFireDelay <= 0 && !this.overHeated) {
      if (this.weaponID === WEAPON_PHOTON_RIFLE && this.charge < 0.5) {
        if (this.charge === 0 && this.justCharged === 0) {
          this.justCharged = 1;
          // We start the charge: tell the others to play the charge sound
          game.events.push({ type: 'photonCharge', playerID: owner.playerID, position: owner.currentCF.position.clone() });
          if (game.mode === 'client') game.net?.sound(SOUND_PHOTON_START, owner.currentCF.position);
        }
        this.charge += 0.033333;
        return;
      }
      this.charge = 0;
      this.modelAnim = 0;
      this.chainOverHeat -= 0.052;
      if (this.chainOverHeat < 0) {
        this.chainOverHeat = 0;
        if (this.weaponID === WEAPON_CHAIN_GUN) {
          game.events.push({ type: 'overheat', playerID: owner.playerID, position: owner.currentCF.position.clone() });
          if (game.mode === 'client') game.net?.sound(SOUND_OVERHEAT, owner.currentCF.position);
          this.overHeated = true;
        }
      }

      const flashes = this.nuzzleFlashes;
      this.firingNuzzle++;
      if (this.firingNuzzle >= flashes.length) this.firingNuzzle = 0;
      // The waves' rapid fire power-up shortens the delay
      this.currentFireDelay = this.fireDelay / owner.fireBoost;

      // Shotgun: after 6 shots, full reload
      this.shotInc++;
      if (this.shotInc >= 6 && this.weaponID === WEAPON_SHOTGUN) {
        if (sv.sv_enableShotgunReload) {
          this.currentFireDelay = 3;
          this.fullReload = true;
        } else this.shotInc = 0;
      }

      if (flashes.length > 0) {
        owner.currentCF.position.z = 0.25;
        const { origin, direction } = this.firingOriginAndDirection(owner);
        // Recoil
        owner.currentCF.vel.subIn(direction.mul(this.reculVel));
        const playSound = owner.fireFrameDelay === 0;
        if (playSound) owner.fireFrameDelay = 2;
        owner.shootShakeDis = direction.mul(-this.reculVel * 0.5);
        game.events.push({ type: 'fire', playerID: owner.playerID, weaponID: this.weaponID, nuzzleID: this.firingNuzzle, origin, direction });
        game.shoot(origin, direction, 0, this.damage, owner, this.projectileType);
      }
    }
  }

  /** Server side secondary fire (Weapon::shootMeleeSV). */
  shootMeleeSV(owner: Player): void {
    const game = owner.game;
    this.currentFireDelay = this.fireDelay;
    owner.fireFrameDelay = 2;
    switch (this.weaponID) {
      case WEAPON_KNIVES:
        // Everybody within a radius of 1 :D
        game.radiusHit(owner.currentCF.position, 1, owner.playerID, this.weaponID, true);
        break;
      case WEAPON_NUCLEAR:
        owner.spawnNukeBotSV();
        this.nukeFrameID = 0;
        break;
      case WEAPON_SHIELD:
        // Protect this player for 2 seconds
        owner.protection = 2;
        break;
      case WEAPON_MINIBOT:
        break;
    }
    // Everybody's feedback (Weapon::shootMelee): sound + animation (knives, shield, nuke bot siren).
    if (this.weaponID === WEAPON_KNIVES || this.weaponID === WEAPON_SHIELD || (this.weaponID === WEAPON_NUCLEAR && owner.minibot)) {
      this.nukeFrameID = 0;
      this.modelAnim = 0;
      game.events.push({ type: 'melee', playerID: owner.playerID, weaponID: this.weaponID });
    }
  }

  /** Weapon::shootMelee — everybody's feedback when a secondary weapon is used (sound + animation). */
  shootMelee(): void {
    this.nukeFrameID = 0;
    this.currentFireDelay = this.fireDelay;
    this.modelAnim = 0;
  }

  /** Weapon::update */
  update(delay: number): void {
    if (this.justCharged > 0) this.justCharged -= delay;
    if (this.justCharged < 0) this.justCharged = 0;
    const owner = this.owner;
    if (owner && !owner.isAlive) return;
    if (this.currentImp > this.startImp) {
      this.currentImp -= delay * 10;
      if (this.currentImp < this.startImp) this.currentImp = this.startImp;
    }
    if (this.currentFireDelay > 0) {
      this.currentFireDelay -= delay;
      if (this.weaponID === WEAPON_KNIVES) {
        if (this.currentFireDelay > this.fireDelay - 0.1) {
          this.modelAnim = (1 - (this.currentFireDelay - (this.fireDelay - 0.1)) / 0.1) * 10;
          if (this.modelAnim > 10) this.modelAnim = 10;
        } else if (this.currentFireDelay < 0.25) {
          this.modelAnim = (this.currentFireDelay / 0.25) * 10;
          if (this.modelAnim < 0) this.modelAnim = 0;
        } else this.modelAnim = 10;
      }
      if (this.weaponID === WEAPON_SHIELD) {
        this.modelAnim = ((3 - this.currentFireDelay) / 3) * 20;
        if (this.modelAnim > 20) this.modelAnim = 20;
      }
      if (this.weaponID === WEAPON_NUCLEAR && owner) {
        this.nukeFrameID++;
        if (this.nukeFrameID % 45 === 0 && owner.minibot) {
          owner.game.events.push({ type: 'nukeBeep', playerID: owner.playerID });
        }
        // Explodes after sv_nukeTimer seconds
        if (this.nukeFrameID >= 30 * sv.sv_nukeTimer && owner.minibot) {
          owner.game.nukeExplode(owner);
        }
      }
    } else {
      this.modelAnim = 0;
    }

    this.chainOverHeat += delay * 0.25;
    if (this.chainOverHeat > 1) {
      this.chainOverHeat = 1;
      this.overHeated = false;
    }
    if (this.chainOverHeat > 0.5) this.overHeated = false;
  }

  get isMelee(): boolean {
    return this.projectileType === PROJECTILE_NONE;
  }

  get isFlameThrower(): boolean {
    return this.weaponID === WEAPON_FLAME_THROWER;
  }

  get isShield(): boolean {
    return this.weaponID === WEAPON_SHIELD;
  }
}
