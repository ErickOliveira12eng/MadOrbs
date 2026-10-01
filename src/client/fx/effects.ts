// Visual effects of the game: ports of the client-only structs of Game.h (NukeFlash, Drip, FloorMark,
// Douille, Trail — `Explosion` is commented out in the original) and of the visual spawn functions
// of GameSpawn.cpp (spawnBlood, spawnImpact, spawnExplosion), plus ready-to-call helpers that
// reproduce exactly what the other game functions spawn (Weapon::shoot, Projectile ctor/update,
// Map::updateDummies, Game::update rain drips / lava smoke, Player::hit / kill).
//
// Timing: `update(delay, camera)` once per sim tick (delay = 1/30) AFTER the game logic of that tick
// (the original runs Game::update then dkpUpdate); `render(camera, alpha)` once per rendered frame
// before renderer.render().
import * as THREE from 'three';
import { Vec3, rotateAboutAxis, randRange, crand, cross, dot } from '../../sim/vec';
import { audio, type SoundHandle } from '../audio/audio';
import { loadTexture } from '../engine/textures';
import { FxTextureArray, type FxTexture } from './fxTextures';
import { QuadBatch } from './quadBatch';
import {
  ParticleEngine,
  createPreset,
  createRightUpVectors,
  randColor,
  randV3,
  type Color4,
  type dkp_preset,
  DKP_ONE,
  DKP_SRC_ALPHA,
  DKP_ONE_MINUS_SRC_ALPHA,
} from './particles';
import { createWeather, type CWeather } from './weather';

// ---------------------------------------------------------------------------------------------
// Game constants used by the effects (GameVar.h, Player.h, Game.h, Weapon.h). Local copies —
// swap for the centralized src/sim constants when they exist.
// ---------------------------------------------------------------------------------------------
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
/** Weapons with projectileType == PROJECTILE_DIRECT (GameVar.cpp weapon table). */
const DIRECT_WEAPONS = new Set([WEAPON_SMG, WEAPON_SHOTGUN, WEAPON_SNIPER, WEAPON_DUAL_MACHINE_GUN, WEAPON_CHAIN_GUN, WEAPON_PHOTON_RIFLE, WEAPON_FLAME_THROWER]);

export const PLAYER_TEAM_BLUE = 0;
export const PLAYER_TEAM_RED = 1;
export const GAME_TYPE_DM = 0;
export const GAME_TYPE_TDM = 1;
export const GAME_TYPE_CTF = 2;
export const GAME_TYPE_SND = 3;

export const MAX_FLOOR_MARK = 500; // Game.h
export const NUZZLE_DELAY = 0.1; // Weapon.h
export const DOUILLE_TYPE_DOUILLE = 0; // Game.h
export const DOUILLE_TYPE_GIB = 1;

/**
 * renderOrder of each effect layer, in the order GameRender.cpp draws them. All effect meshes are
 * transparent (depthWrite off) so they render after the opaque pass. Drips are drawn BEFORE the
 * ground in the original (they only show through the transparent splatter parts of the ground).
 */
export const FX_RENDER_ORDER = {
  drips: -10,
  floorMarks: 10,
  nuzzleFlash: 15,
  trails: 20,
  bullets: 21,
  particles: 30,
  weather: 40,
  nukeFlash: 50,
};

/** Structural subset of GameMap (src/sim/map.ts) the effects need (douille collisions). */
export interface FxMapQuery {
  size: ArrayLike<number>;
  cells: ArrayLike<{ passable: boolean; height: number }>;
}

export interface EffectsOptions {
  /** gameVar.r_reducedParticles (default false) */
  reducedParticles?: boolean;
  /** gameVar.r_showCasing (default true) */
  showCasing?: boolean;
  /** gameVar.r_showGroundMark (default true) */
  showGroundMark?: boolean;
  /** gameVar.r_particleSort (default false) */
  particleSort?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** CVector.cpp reflect (projection uses normal.length(), like the engine). */
function reflect(u: Vec3, normal: Vec3): Vec3 {
  const len = normal.length() || 1;
  return u.sub(normal.mul((dot(u, normal) / len) * 2));
}

/** Map.h rayTileTest. Mutates p2 (hit point) and normal like the original. */
function rayTileTest(map: FxMapQuery, x: number, y: number, p1: Vec3, p2: Vec3, normal: Vec3): boolean {
  const sx = map.size[0], sy = map.size[1];
  if (x < 0 || x >= sx || y < 0 || y >= sy) return false;
  const x1 = x, x2 = x + 1, y1 = y, y2 = y + 1;
  const cell = map.cells[y * sx + x];
  const height = cell.height;
  let percent: number;
  let p: Vec3;
  if (cell.passable) {
    if (p1.z > 0 && p2.z <= 0) {
      percent = p1.z / Math.abs(p2.z - p1.z);
      p = p1.add(p2.sub(p1).mul(percent));
      if (p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2) {
        p2.copy(p);
        normal.set(0, 0, 1);
        return true;
      }
    }
    return false;
  }
  // ceiling
  if (p1.z > height && p2.z <= height) {
    percent = (p1.z - height) / Math.abs(p2.z - height - (p1.z - height));
    p = p1.add(p2.sub(p1).mul(percent));
    if (p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2) {
      p2.copy(p);
      normal.set(0, 0, 1);
      return true;
    }
  }
  if (p1.x <= x1 && p2.x > x1) {
    percent = Math.abs(x1 - p1.x) / Math.abs(p2.x - p1.x);
    p = p1.add(p2.sub(p1).mul(percent));
    if (p.y <= y2 && p.y >= y1 && p.z < height) {
      p2.copy(p);
      normal.set(-1, 0, 0);
      return true;
    }
  }
  if (p1.x >= x2 && p2.x < x2) {
    percent = Math.abs(p1.x - x2) / Math.abs(p2.x - p1.x);
    p = p1.add(p2.sub(p1).mul(percent));
    if (p.y <= y2 && p.y >= y1 && p.z < height) {
      p2.copy(p);
      normal.set(1, 0, 0);
      return true;
    }
  }
  if (p1.y <= y1 && p2.y > y1) {
    percent = Math.abs(y1 - p1.y) / Math.abs(p2.y - p1.y);
    p = p1.add(p2.sub(p1).mul(percent));
    if (p.x <= x2 && p.x >= x1 && p.z < height) {
      p2.copy(p);
      normal.set(0, -1, 0);
      return true;
    }
  }
  if (p1.y >= y2 && p2.y < y2) {
    percent = Math.abs(p1.y - y2) / Math.abs(p2.y - p1.y);
    p = p1.add(p2.sub(p1).mul(percent));
    if (p.x <= x2 && p.x >= x1 && p.z < height) {
      p2.copy(p);
      normal.set(0, 1, 0);
      return true;
    }
  }
  return false;
}

/**
 * Map::rayTest (tile maps only; the 3D dko map branch is not supported). With no map, only the
 * ground plane z = 0 is tested. Mutates p2 (hit point) and normal like the original.
 */
export function fxRayTest(map: FxMapQuery | null, p1: Vec3, p2: Vec3, normal: Vec3): boolean {
  if (!map) {
    if (p1.z > 0 && p2.z <= 0) {
      const percent = p1.z / Math.abs(p2.z - p1.z);
      p2.copy(p1.add(p2.sub(p1).mul(percent)));
      normal.set(0, 0, 1);
      return true;
    }
    return false;
  }
  const sx = map.size[0], sy = map.size[1];
  let i = Math.trunc(p1.x);
  let j = Math.trunc(p1.y);
  if (i >= 0 && i < sx && j >= 0 && j < sy) {
    const c = map.cells[j * sx + i];
    if (!c.passable && p1.z < c.height) {
      p2.copy(p1);
      return true;
    }
  } else {
    return false;
  }
  const TEST_DIR_X = 0, TEST_DIR_X_NEG = 1, TEST_DIR_Y = 2, TEST_DIR_Y_NEG = 3;
  let sens: number;
  if (Math.abs(p2.x - p1.x) > Math.abs(p2.y - p1.y)) sens = p2.x > p1.x ? TEST_DIR_X : TEST_DIR_X_NEG;
  else sens = p2.y > p1.y ? TEST_DIR_Y : TEST_DIR_Y_NEG;
  let percent: number;
  for (let guard = 0; guard < 100000; guard++) {
    if (
      i < 0 || i >= sx || j < 0 || j >= sy ||
      (sens === TEST_DIR_X && i > Math.trunc(p2.x)) ||
      (sens === TEST_DIR_X_NEG && i < Math.trunc(p2.x)) ||
      (sens === TEST_DIR_Y && j > Math.trunc(p2.y)) ||
      (sens === TEST_DIR_Y_NEG && j < Math.trunc(p2.y))
    ) {
      return false;
    }
    switch (sens) {
      case TEST_DIR_X:
        if (rayTileTest(map, i, j, p1, p2, normal)) return true;
        if (rayTileTest(map, i, j - 1, p1, p2, normal)) return true;
        if (rayTileTest(map, i, j + 1, p1, p2, normal)) return true;
        i++;
        percent = (i - p1.x) / Math.abs(p2.x - p1.x);
        j = Math.trunc(p1.y + (p2.y - p1.y) * percent);
        break;
      case TEST_DIR_X_NEG:
        if (rayTileTest(map, i, j, p1, p2, normal)) return true;
        if (rayTileTest(map, i, j - 1, p1, p2, normal)) return true;
        if (rayTileTest(map, i, j + 1, p1, p2, normal)) return true;
        i--;
        percent = (p1.x - (i + 1)) / Math.abs(p2.x - p1.x);
        j = Math.trunc(p1.y + (p2.y - p1.y) * percent);
        break;
      case TEST_DIR_Y:
        if (rayTileTest(map, i, j, p1, p2, normal)) return true;
        if (rayTileTest(map, i - 1, j, p1, p2, normal)) return true;
        if (rayTileTest(map, i + 1, j, p1, p2, normal)) return true;
        j++;
        percent = (j - p1.y) / Math.abs(p2.y - p1.y);
        i = Math.trunc(p1.x + (p2.x - p1.x) * percent);
        break;
      default:
        if (rayTileTest(map, i, j, p1, p2, normal)) return true;
        if (rayTileTest(map, i - 1, j, p1, p2, normal)) return true;
        if (rayTileTest(map, i + 1, j, p1, p2, normal)) return true;
        j--;
        percent = (p1.y - (j + 1)) / Math.abs(p2.y - p1.y);
        i = Math.trunc(p1.x + (p2.x - p1.x) * percent);
        break;
    }
  }
  return false;
}

/** C float truncation of `(int)(f * 10)` with float32 rounding (spawnBlood particle count). */
function intTimes10(f: number): number {
  return Math.trunc(Math.fround(Math.fround(f) * 10));
}

// ---------------------------------------------------------------------------------------------
// Game.h structs
// ---------------------------------------------------------------------------------------------

/** Game.h NukeFlash (big additive shotGlow quad on the ground, no depth test). */
export class NukeFlash {
  position = new Vec3();
  life = 1;
  fadeSpeed = 0.5;
  density = 2;
  radius = 16;
  update(pdelay: number): void {
    this.life -= pdelay * this.fadeSpeed;
  }
}

/** Game.h Drip (rain ripple on the ground, tex_drip). */
export class Drip {
  position = new Vec3();
  /** Pool entries start dead (Game::resetRound sets life = 0). */
  life = 0;
  lastLife = 0;
  size = 0.15;
  fadeSpeed = 2;
  update(pdelay: number): void {
    this.life -= pdelay * this.fadeSpeed;
  }
}

/** Game.h FloorMark (blood / explosion decals). */
export class FloorMark {
  position = new Vec3();
  angle = 0;
  size = 0;
  /** Remaining life (seconds). */
  delay = 0;
  startDelay = 0;
  texture: FxTexture = 0;
  color: [number, number, number, number] = [1, 1, 1, 1];
  set(pposition: Vec3, pangle: number, psize: number, pdelay: number, pstartDelay: number, ptexture: FxTexture, pcolor: Color4): void {
    this.position.copy(pposition);
    this.angle = pangle;
    this.size = psize;
    this.delay = pdelay;
    this.startDelay = pstartDelay;
    this.texture = ptexture;
    this.color = [pcolor[0], pcolor[1], pcolor[2], pcolor[3]];
  }
  update(pdelay: number): void {
    if (this.startDelay > 0) this.startDelay -= pdelay;
    else this.delay -= pdelay;
  }
}

/** Game.h Douille (shell casing / gib), client only physics. */
export class Douille {
  position: Vec3;
  lastPosition: Vec3;
  vel: Vec3;
  delay = 2;
  soundPlayed = false;
  type: number;
  object: THREE.Object3D | null = null;
  constructor(pPosition: Vec3, pDirection: Vec3, right: Vec3, inType = DOUILLE_TYPE_DOUILLE) {
    this.type = inType;
    this.vel = pDirection.mul(1.5);
    if (this.type === DOUILLE_TYPE_DOUILLE) {
      this.delay = 2; // ça dure 2sec
      this.vel = rotateAboutAxis(this.vel, randRange(-30, 30), right);
      this.vel = rotateAboutAxis(this.vel, randRange(0, 360), pDirection);
    } else if (this.type === DOUILLE_TYPE_GIB) {
      this.delay = 2;
    }
    this.position = pPosition.clone();
    this.lastPosition = pPosition.clone();
  }
}

/** Game.h Trail (bullet trail). trailType 0 = smoke trail + bullet glow, 1 = glow trail (photon). */
export class Trail {
  p1: Vec3;
  p2: Vec3;
  dis: number;
  delay = 0;
  lastDelay = 0;
  size: number;
  delaySpeed: number;
  offset: number;
  trailType: number;
  color: [number, number, number, number];
  right: Vec3;
  constructor(pP1: Vec3, pP2: Vec3, pSize: number, pColor: Color4, duration: number, inTrailType = 0) {
    this.trailType = inTrailType;
    this.dis = pP1.sub(pP2).length();
    this.delaySpeed = 1 / duration;
    this.p1 = pP1.clone();
    this.p2 = pP2.clone();
    this.size = pSize;
    this.color = [pColor[0], pColor[1], pColor[2], pColor[3]];
    this.right = cross(this.p2.sub(this.p1), new Vec3(0, 0, 1)).normalizeIn();
    this.offset = randRange(0, 1);
  }
  update(pDelay: number): void {
    this.lastDelay = this.delay;
    if (this.delay > 0) this.delay += pDelay * this.delaySpeed;
    else this.delay = 0.001;
  }
}

/**
 * Weapon.h NuzzleFlash, rendered like NuzzleFlash::render. Add `object` as a child of the weapon
 * model node, in DKO model units (the space of the "nuzzle" dummy positions, before the player's
 * .005 scale). Call shoot() when firing, update(delay) per tick and render() per frame.
 */
export class NuzzleFlashFx {
  readonly object = new THREE.Group();
  delay = 0;
  angle = 0;
  private readonly glow: THREE.Mesh;
  private readonly flash: THREE.Group;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly flashMat: THREE.MeshBasicMaterial;

  constructor(position: Vec3, texShotGlow: THREE.Texture, texNuzzleFlash: THREE.Texture) {
    this.object.name = 'nuzzleFlash';
    const mk = (map: THREE.Texture, depthTest: boolean) =>
      new THREE.MeshBasicMaterial({
        map,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending, // glBlendFunc(GL_SRC_ALPHA, GL_ONE)
        depthWrite: false,
        depthTest,
        side: THREE.DoubleSide,
        fog: false,
        toneMapped: false,
      });
    // Shot glow: 1000x1000 model units, .5 world units (.5/.005) below the nuzzle, no depth test.
    this.glowMat = mk(texShotGlow, false);
    const glowGeo = new THREE.PlaneGeometry(1000, 1000);
    this.glow = new THREE.Mesh(glowGeo, this.glowMat);
    this.glow.position.set(position.x, position.y, position.z - 0.5 / 0.005);
    this.glow.renderOrder = FX_RENDER_ORDER.nuzzleFlash;
    // Flame: two crossed quads 100 long along +Y, 100 wide.
    this.flashMat = mk(texNuzzleFlash, true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([
      -50, 100, 0, -50, 0, 0, 50, 0, 0, 50, 100, 0,
      0, 100, 50, 0, 0, 50, 0, 0, -50, 0, 100, -50,
    ], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    const flashMesh = new THREE.Mesh(g, this.flashMat);
    flashMesh.renderOrder = FX_RENDER_ORDER.nuzzleFlash;
    this.flash = new THREE.Group();
    this.flash.position.set(position.x, position.y, position.z);
    this.flash.add(flashMesh);
    this.object.add(this.glow, this.flash);
    this.object.visible = false;
  }

  /** NuzzleFlash::shoot */
  shoot(): void {
    this.delay = NUZZLE_DELAY;
    this.angle = randRange(0, 360);
  }

  /** NuzzleFlash::update */
  update(pDelay: number): void {
    this.delay -= pDelay;
    if (this.delay <= 0) this.delay = 0;
  }

  /** NuzzleFlash::render (per frame). */
  render(): void {
    const d = this.delay / NUZZLE_DELAY;
    // Stay hidden until both textures have pixels (avoids uploading empty DataTextures).
    this.object.visible = this.delay > 0 && texReady(this.glowMat.map) && texReady(this.flashMat.map);
    if (!this.object.visible) return;
    this.glowMat.opacity = d * d * 0.25;
    this.flashMat.opacity = d;
    const s = (1 - d) * 2 + 0.5;
    this.flash.scale.set(s, s, s);
    this.flash.rotation.set(0, (this.angle * Math.PI) / 180, 0); // glRotatef(angle, 0, 1, 0)
  }

  dispose(): void {
    this.glowMat.dispose();
    this.flashMat.dispose();
    this.glow.geometry.dispose();
    (this.flash.children[0] as THREE.Mesh).geometry.dispose();
    this.object.removeFromParent();
  }
}

/** True once a texture from the shared loader has pixels (DataTextures start with data = null). */
function texReady(t: THREE.Texture | null): boolean {
  const img = t?.image as { data?: unknown; width?: number } | undefined;
  if (!img) return false;
  return 'data' in img ? img.data !== null && img.data !== undefined : (img.width ?? 0) > 0;
}

/** Brass ejection data computed from the weapon's "ejectingBrass" dummy (Weapon::shoot). */
export interface BrassEjection {
  /** rotateAboutAxis(brass.position*.005, angle, Z) + ownerPos - (0,0,.25) */
  pos: Vec3;
  /** rotateAboutAxis(brass.matrix.getUp(), angle, Z) */
  dir: Vec3;
  /** rotateAboutAxis(brass.matrix.getRight(), angle, Z) */
  right: Vec3;
}

// ---------------------------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------------------------

export class Effects {
  /** Add to the scene with an identity transform (done by the constructor when a scene is given). */
  readonly group = new THREE.Group();
  readonly textures = new FxTextureArray();
  readonly dkp: ParticleEngine;
  readonly options: Required<EffectsOptions>;

  // gameVar.tex_* (layers of the shared array)
  readonly tex_smoke1: FxTexture;
  readonly tex_shotGlow: FxTexture;
  readonly tex_smokeTrail: FxTexture;
  readonly tex_blood: FxTexture[];
  readonly tex_explosionMark: FxTexture;
  readonly tex_drip: FxTexture;
  readonly tex_glowTrail: FxTexture;

  // gameVar.sfx_*
  readonly sfx_ric: SoundHandle[];
  readonly sfx_hit: SoundHandle[];
  readonly sfx_baboCreve: SoundHandle[];
  readonly sfx_explosion: SoundHandle[];
  readonly sfx_grenadeRebond: SoundHandle;
  readonly sfx_douille: SoundHandle[];
  readonly sfx_lavaSteam: SoundHandle;

  /** gameVar.dkpp_firingSmoke (GameVar.cpp) */
  readonly dkpp_firingSmoke: dkp_preset;

  // Game members
  trails: Trail[] = [];
  douilles: Douille[] = [];
  readonly floorMarks: FloorMark[] = [];
  nextWriteFloorMark = 0;
  readonly drips: Drip[] = [];
  nextWriteDrip = 0;
  nikeFlashes: NukeFlash[] = [];

  private map: FxMapQuery | null = null;
  private weather: CWeather | null = null;
  private readonly camPos = new Vec3(0, 0, 7);

  private readonly dripBatch: QuadBatch;
  private readonly markBatch: QuadBatch;
  private readonly trailBatch: QuadBatch;
  private readonly bulletBatch: QuadBatch;
  private readonly nukeBatch: QuadBatch;
  private readonly douilleGroup = new THREE.Group();
  private douilleTemplates: (THREE.Object3D | null)[] = [null, null];
  private douillePools: THREE.Object3D[][] = [[], []];

  constructor(scene: THREE.Object3D | null = null, options: EffectsOptions = {}) {
    this.options = {
      reducedParticles: options.reducedParticles ?? false,
      showCasing: options.showCasing ?? true,
      showGroundMark: options.showGroundMark ?? true,
      particleSort: options.particleSort ?? false,
    };
    this.group.name = 'effects';
    const T = this.textures;
    this.tex_smoke1 = T.get('main/textures/Smoke1.tga');
    this.tex_shotGlow = T.get('main/textures/shotGlow.tga');
    this.tex_smokeTrail = T.get('main/textures/Smoke2.tga');
    this.tex_blood = [];
    for (let i = 1; i <= 10; i++) this.tex_blood.push(T.get(`main/textures/blood${i < 10 ? '0' + i : i}.tga`));
    this.tex_explosionMark = T.get('main/textures/ExplosionMark.tga');
    this.tex_drip = T.get('main/textures/drip.tga');
    this.tex_glowTrail = T.get('main/textures/glowTrail.tga');

    const S = (n: string) => audio.load(`/assets/sounds/${n}`);
    this.sfx_ric = [S('ric1.wav'), S('ric2.wav'), S('ric3.wav'), S('ric4.wav'), S('ric5.wav')];
    this.sfx_hit = [S('hit1.wav'), S('hit2.wav')];
    this.sfx_baboCreve = [S('BaboCreve1.wav'), S('BaboCreve2.wav'), S('BaboCreve3.wav')];
    this.sfx_explosion = [S('Explosion1.wav')];
    this.sfx_grenadeRebond = S('GrenadeRebond.wav');
    this.sfx_douille = [S('douille1.wav'), S('douille2.wav'), S('douille3.wav')];
    this.sfx_lavaSteam = S('lavasteam.wav');

    // GameVar.cpp dkpp_firingSmoke
    this.dkpp_firingSmoke = createPreset({
      angleFrom: 0,
      angleTo: 360,
      angleSpeedFrom: -30,
      angleSpeedTo: 30,
      srcBlend: DKP_SRC_ALPHA,
      dstBlend: DKP_ONE_MINUS_SRC_ALPHA,
      durationFrom: 0.25,
      durationTo: 0.5,
      endColorFrom: [1, 1, 0.7, 0],
      endColorTo: [1, 1, 0.7, 0],
      startColorFrom: [0.7, 0.7, 0.7, 1],
      startColorTo: [0.7, 0.7, 0.7, 1],
      endSizeFrom: 0.25,
      endSizeTo: 0.3,
      startSizeFrom: 0.15,
      startSizeTo: 0.18,
      airResistanceInfluence: 0,
      gravityInfluence: 0,
      pitchFrom: 0,
      pitchTo: 180,
      speedFrom: 0,
      speedTo: 1.8,
      textureFrameCount: 0,
      texture: this.tex_smoke1,
      particleCountFrom: 2,
      particleCountTo: 4,
    });

    for (let i = 0; i < MAX_FLOOR_MARK; i++) {
      this.floorMarks.push(new FloorMark());
      this.drips.push(new Drip());
    }

    this.dripBatch = new QuadBatch(T, { renderOrder: FX_RENDER_ORDER.drips, name: 'fxDrips', initialCapacity: 128 });
    this.markBatch = new QuadBatch(T, { renderOrder: FX_RENDER_ORDER.floorMarks, name: 'fxFloorMarks', initialCapacity: 512 });
    this.trailBatch = new QuadBatch(T, { renderOrder: FX_RENDER_ORDER.trails, name: 'fxTrails', initialCapacity: 128 });
    this.bulletBatch = new QuadBatch(T, { renderOrder: FX_RENDER_ORDER.bullets, name: 'fxBullets', initialCapacity: 128 });
    this.nukeBatch = new QuadBatch(T, { renderOrder: FX_RENDER_ORDER.nukeFlash, depthTest: false, name: 'fxNukeFlash', initialCapacity: 4 });
    this.dkp = new ParticleEngine(T, { renderOrder: FX_RENDER_ORDER.particles });
    this.dkp.dkpSetSorting(false); // Game::Game
    this.douilleGroup.name = 'douilles';
    this.group.add(this.dripBatch.mesh, this.markBatch.mesh, this.trailBatch.mesh, this.bulletBatch.mesh, this.nukeBatch.mesh, this.dkp.object, this.douilleGroup);
    if (scene) scene.add(this.group);
  }

  // -------------------------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------------------------

  setMap(map: FxMapQuery | null): void {
    this.map = map;
  }

  /**
   * Model used to draw casings (gameVar.dko_douille, type 0) and gibs (gameVar.dko_gib, type 1).
   * The template is cloned per casing and drawn with glScalef(.005) like Douille::render.
   * Until one is given a small procedural stand-in is used.
   */
  setDouilleModel(type: number, template: THREE.Object3D | null): void {
    this.douilleTemplates[type] = template;
    for (const o of this.douillePools[type]) o.removeFromParent();
    this.douillePools[type] = [];
    for (const d of this.douilles) {
      if (d.type === type && d.object) {
        d.object.removeFromParent();
        d.object = null;
      }
    }
  }

  /** Creates the map weather (Map::reloadWeather: CRain / CSnow / CLava) or removes it (null / WEATHER_NONE). */
  setWeather(weatherType: number | null): CWeather | null {
    this.weather?.dispose();
    this.weather = weatherType === null ? null : createWeather(weatherType, this.textures, this.group);
    return this.weather;
  }

  get currentWeather(): CWeather | null {
    return this.weather;
  }

  /** The effect meshes, e.g. to adjust renderOrder against the map's own transparent meshes. */
  get meshes(): { drips: THREE.Mesh; floorMarks: THREE.Mesh; trails: THREE.Mesh; bullets: THREE.Mesh; nukeFlash: THREE.Mesh; particles: THREE.Object3D; douilles: THREE.Object3D } {
    return {
      drips: this.dripBatch.mesh,
      floorMarks: this.markBatch.mesh,
      trails: this.trailBatch.mesh,
      bullets: this.bulletBatch.mesh,
      nukeFlash: this.nukeBatch.mesh,
      particles: this.dkp.object,
      douilles: this.douilleGroup,
    };
  }

  /** Creates a nuzzle flash to attach to a weapon model (see NuzzleFlashFx). */
  createNuzzleFlash(position: Vec3): NuzzleFlashFx {
    return new NuzzleFlashFx(position, loadTexture('main/textures/shotGlow.tga'), loadTexture('main/textures/nuzzleFlash.tga'));
  }

  // -------------------------------------------------------------------------------------------
  // Particles (dkp)
  // -------------------------------------------------------------------------------------------

  /** dkpCreateParticle */
  createParticle(...args: Parameters<ParticleEngine['dkpCreateParticle']>): void {
    this.dkp.dkpCreateParticle(...args);
  }

  /** dkpCreateParticleEx */
  createParticleEx(...args: Parameters<ParticleEngine['dkpCreateParticleEx']>): void {
    this.dkp.dkpCreateParticleEx(...args);
  }

  /** dkpCreateParticleExP */
  createParticleExP(preset: dkp_preset): void {
    this.dkp.dkpCreateParticleExP(preset);
  }

  // -------------------------------------------------------------------------------------------
  // Game.h structs
  // -------------------------------------------------------------------------------------------

  /** Game::getNextFloorMark */
  getNextFloorMark(): number {
    this.nextWriteFloorMark++;
    if (this.nextWriteFloorMark >= MAX_FLOOR_MARK) this.nextWriteFloorMark = 0;
    return this.nextWriteFloorMark;
  }

  /** Game::getNextDrip */
  getNextDrip(): number {
    this.nextWriteDrip++;
    if (this.nextWriteDrip >= MAX_FLOOR_MARK) this.nextWriteDrip = 0;
    return this.nextWriteDrip;
  }

  /** floorMarks[getNextFloorMark()].set(...) */
  addFloorMark(position: Vec3, angle: number, size: number, delay: number, startDelay: number, texture: FxTexture, color: Color4): FloorMark {
    const m = this.floorMarks[this.getNextFloorMark()];
    m.set(position, angle, size, delay, startDelay, texture, color);
    return m;
  }

  /** drips[getNextDrip()] = {life, position (z forced to 0), size, fadeSpeed} (Game::update) */
  addDrip(position: Vec3, life = 1, size = 0.15, fadeSpeed = 2): Drip {
    const d = this.drips[this.getNextDrip()];
    d.life = life;
    d.lastLife = life;
    d.position.copy(position);
    d.position.z = 0;
    d.size = size;
    d.fadeSpeed = fadeSpeed;
    return d;
  }

  /** nikeFlashes.push_back(new NukeFlash) (spawnExplosion) */
  addNukeFlash(position: Vec3, radius = 16): NukeFlash {
    const n = new NukeFlash();
    n.position.copy(position);
    n.radius = radius;
    this.nikeFlashes.push(n);
    return n;
  }

  /** trails.push_back(new Trail(p1, p2, size, color, duration, trailType)) */
  addTrail(p1: Vec3, p2: Vec3, size: number, color: Color4, duration: number, trailType = 0): Trail {
    const t = new Trail(p1, p2, size, color, duration, trailType);
    this.trails.push(t);
    return t;
  }

  /** douilles.push_back(new Douille(position, direction, right, type)) */
  addDouille(position: Vec3, direction: Vec3, right: Vec3, type = DOUILLE_TYPE_DOUILLE): Douille {
    const d = new Douille(position, direction, right, type);
    this.douilles.push(d);
    return d;
  }

  // -------------------------------------------------------------------------------------------
  // GameSpawn.cpp
  // -------------------------------------------------------------------------------------------

  /** Game::spawnBlood */
  spawnBlood(position: Vec3, damage: number): void {
    if (damage > 2.0) damage = 2.0;
    const n = intTimes10(damage);
    for (let i = 0; i < n; ++i) {
      const bloodColor = randRange(0.3, 1.0);
      this.dkp.dkpCreateParticleEx(
        position, position, new Vec3(0, 0, 1),
        damage, damage * 2, // speed
        0, 90, // pitch
        0.25, 0.25, 0.25, 0.25, // sizes
        2, 2, // duration
        [bloodColor, 0, 0, 1], [bloodColor, 0, 0, 1], [bloodColor, 0, 0, 0], [bloodColor, 0, 0, 0],
        0, 360, -30, 30, // angle, angle speed
        0.1, 0, // gravity, air resistance
        1, 1,
        this.tex_blood[crand() % 10], 0,
        DKP_SRC_ALPHA, DKP_ONE_MINUS_SRC_ALPHA,
      );
      // On crée les marks de sang au sol
      let pos = rotateAboutAxis(new Vec3(1, 0, 0), randRange(0, 360), new Vec3(0, 0, 1));
      const distance = randRange(0, damage * 2.5);
      const sizeMax = (1 - distance / 2.5) * 1.0;
      pos = pos.mul(distance).add(position);
      pos.z = 0;
      this.addFloorMark(pos, randRange(0, 360), randRange(0.05, sizeMax), 30, distance * 0.5, this.tex_blood[crand() % 10], [randRange(0.25, 0.5), 0, 0, randRange(0.5, 1.0)]);
    }
  }

  /**
   * Game::spawnImpact — trail(s), impact spark/smoke particles and ricochet sound.
   * Called by Weapon::shoot(net) for every direct weapon except the flame thrower, and by
   * ClientRecv (NET_SVCL_PLAYER_SHOOT) for our own shots / minibot shots (weaponID SMG, damage .08).
   */
  spawnImpact(p1: Vec3, p2: Vec3, normal: Vec3, weaponID: number, damage: number, team: number): void {
    // CMatrix3x3f with right/front/up, RotateAboutFront(rand 0..360), RotateAboutRight(rand -30..30)
    const front0 = normal.clone();
    const { right: right0, up: up0 } = createRightUpVectors(front0);
    let a = randRange(0, 360) * (Math.PI / 180);
    let c = Math.cos(a), s = Math.sin(a);
    const up1 = up0.mul(c).add(right0.mul(s));
    a = randRange(-30, 30) * (Math.PI / 180);
    c = Math.cos(a);
    s = Math.sin(a);
    const front = front0.mul(c).add(up1.mul(s));

    const type = weaponID === WEAPON_PHOTON_RIFLE ? 1 : 0;
    if (type === 0) {
      this.addTrail(p1, p2, damage, [team === PLAYER_TEAM_RED ? 0.9 : 0.5, 0.5, team === PLAYER_TEAM_BLUE ? 0.9 : 0.5, 1], damage * 4, 0);
    } else {
      if (weaponID === WEAPON_PHOTON_RIFLE) damage = 2.0;
      const col: Color4 = [team === PLAYER_TEAM_RED ? 0.9 : 0.25, 0.25, team === PLAYER_TEAM_BLUE ? 0.9 : 0.25, 1];
      this.addTrail(p1, p2, damage, col, damage * 4, 0);
      this.addTrail(p1, p2, damage / 4, col, damage, 1);
      this.addTrail(p1, p2, damage / 8, col, damage, 1);
      this.addTrail(p1, p2, damage / 16, col, damage, 1);
    }

    const d = this.dkp;
    d.dkpCreateParticle(p2, front.mul(0), [1, 1, 0, 1], [1, 1, 0, 0], 0.15, 0.15, 0.3, -0.1, 0, 0, this.tex_shotGlow, DKP_SRC_ALPHA, DKP_ONE, 0);
    d.dkpCreateParticle(p2, front.mul(0.25), [1, 1, 1, 0.5], [1, 1, 1, 0], 0, 0.5, 1, -0.1, 0, 90, this.tex_smoke1, DKP_SRC_ALPHA, DKP_ONE_MINUS_SRC_ALPHA, 0);
    d.dkpCreateParticle(p2, front.mul(2.0), [1, 1, 1, 0.75], [1, 1, 1, 0], 0.125, 0.25, 0.5, 0, 0, 90, this.tex_smoke1, DKP_SRC_ALPHA, DKP_ONE_MINUS_SRC_ALPHA, 0);
    d.dkpCreateParticle(p2, front.mul(4.0), [1, 1, 1, 0.75], [1, 1, 1, 0], 0.125, 0.25, 0.25, 0, 0, 90, this.tex_smoke1, DKP_SRC_ALPHA, DKP_ONE_MINUS_SRC_ALPHA, 0);

    // on ricoche!
    audio.play3D(this.sfx_ric[crand() % 5], 2, p2, 150);
  }

  /**
   * Game::spawnExplosion (NET_SVCL_EXPLOSION). size = explosion radius; >= 4 is the nuke
   * (nuke flash + low-pitched sound). The camera shake is NOT here (moved to NET_SVCL_PLAYER_HIT).
   */
  spawnExplosion(position: Vec3, normal: Vec3, size: number): void {
    if (size >= 4.0) this.addNukeFlash(position, size * 3);

    const trueSize = size;
    size *= 3;

    // FSOUND_PlaySoundEx + MinMaxDistance(10, ...) + SetFrequency(5000 | 22050) (Explosion1.wav is 22050 Hz)
    const h = audio.play3D(this.sfx_explosion[0], 10, position, 255);
    if (h) h.source.playbackRate.value = (trueSize >= 4.0 ? 5000 : 22050) / 22050;

    let duration = size * 0.5;
    const maxDuration = this.options.reducedParticles ? 1.0 : 10.0;
    if (duration > maxDuration) duration = maxDuration;

    const d = this.dkp;
    const smoke = this.tex_smoke1;
    d.dkpCreateParticleEx(position, position, normal, 0.5, 0.5, 80, 90, size * 0.03, size * 0.03, size * 0.2, size * 0.2,
      duration * 0.5, duration * 0.5, [0, 0, 0, 1], [0, 0, 0, 1], [0.7, 0.7, 0.7, 0], [0.7, 0.7, 0.7, 0],
      0, 360, 0, 30, 0, 1, 20, 20, smoke, 0, DKP_SRC_ALPHA, DKP_ONE_MINUS_SRC_ALPHA);
    d.dkpCreateParticleEx(position, position, normal, 0.05, 0.55, 0, 45, size * 0.03, size * 0.03, size * 0.2, size * 0.2,
      duration, duration, [0, 0, 0, 1], [0, 0, 0, 1], [0.7, 0.7, 0.7, 0], [0.7, 0.7, 0.7, 0],
      0, 360, 0, 30, 0, 1, 10, 10, smoke, 0, DKP_SRC_ALPHA, DKP_ONE_MINUS_SRC_ALPHA);
    d.dkpCreateParticleEx(position, position, normal, 1.5, 3.5, 0, 90, size * 0.01, size * 0.01, size * 0.02, size * 0.02,
      duration * 0.1, duration * 0.1, [1, 0, 0, 1], [1, 1, 0, 1], [1, 1, 0, 0], [1, 1, 0, 0],
      0, 360, 0, 30, 0, 1, 20, 20, smoke, 0, DKP_SRC_ALPHA, DKP_ONE);
    d.dkpCreateParticleEx(position, position, normal, 0.05, 0.35, 0, 90, size * 0.05, size * 0.05, size * 0.1, size * 0.1,
      duration * 0.1, duration * 0.1, [1, 0, 0, 1], [1, 1, 0, 1], [1, 1, 0, 0], [1, 1, 0, 0],
      0, 360, 0, 30, 0, 1, 5, 5, smoke, 0, DKP_SRC_ALPHA, DKP_ONE);
    d.dkpCreateParticleEx(
      position.sub(new Vec3(trueSize * 0.35, trueSize * 0.35, 0)), position.add(new Vec3(trueSize * 0.35, trueSize * 0.35, 0)),
      normal, 0, 0, 0, 90, trueSize * 0.25, trueSize * 0.25, trueSize * 0.5, trueSize * 0.5,
      0.25, 0.25, [1, 0, 0, 1], [1, 1, 0, 1], [1, 0, 0, 0], [1, 1, 0, 0],
      0, 360, -180, 180, 0, 1, 8, 8, smoke, 0, DKP_SRC_ALPHA, DKP_ONE);

    this.addFloorMark(new Vec3(position.x, position.y, 0), randRange(0, 360), size * 0.18, 30, 0, this.tex_explosionMark, [1, 1, 1, 0.5]);
  }

  // -------------------------------------------------------------------------------------------
  // Helpers reproducing what other game functions spawn
  // -------------------------------------------------------------------------------------------

  /** dkpCreateParticleExP(gameVar.dkpp_firingSmoke) after setting position/direction/pitchTo. */
  firingSmoke(position: Vec3, direction: Vec3, pitchTo: number): void {
    const p = this.dkpp_firingSmoke;
    p.positionFrom = position.clone();
    p.positionTo = position.clone();
    p.direction = direction.clone();
    p.pitchTo = pitchTo;
    this.dkp.dkpCreateParticleExP(p);
  }

  /**
   * Weapon::shoot(Player*) (PlayerUpdate.cpp) — OUR player firing, client side, before the server
   * confirms the shot (after nuzzleFlashes[firingNuzzle]->shoot()). The trail/impact comes later
   * from ClientRecv NET_SVCL_PLAYER_SHOOT: spawnImpact(...) (or flameThrowerFire for the flame thrower).
   * nuzzlePos = rotateAboutAxis(nuzzle.position*.005, angle, Z) + ownerPos with z = nuzzle z*.005
   * (the original subtracts the owner z), nuzzleDir = rotateAboutAxis((0,1,0), angle, Z).
   * Reproduces the original quirk: when a casing is ejected, the smoke puff is created twice at the
   * brass position and none at the nuzzle. The weapon sound (range 5, volume 255, once per 2
   * frames), the recoil and Game::shoot are game logic, not done here.
   */
  weaponFireLocal(weaponID: number, damage: number, nuzzlePos: Vec3, nuzzleDir: Vec3, brass: BrassEjection | null): void {
    this.dkpp_firingSmoke.positionFrom = nuzzlePos.clone();
    this.dkpp_firingSmoke.positionTo = nuzzlePos.clone();
    this.dkpp_firingSmoke.direction = nuzzleDir.clone();
    this.dkpp_firingSmoke.pitchTo = 45;
    if (DIRECT_WEAPONS.has(weaponID) && weaponID !== WEAPON_FLAME_THROWER && weaponID !== WEAPON_PHOTON_RIFLE && brass) {
      this.firingSmoke(brass.pos, brass.dir, 0);
      if (this.options.showCasing) this.addDouille(brass.pos, brass.dir.mul(damage + 1), brass.right);
    }
    this.dkp.dkpCreateParticleExP(this.dkpp_firingSmoke);
  }

  /**
   * Weapon::shoot(net_svcl_player_shoot, owner) — ClientRecv NET_SVCL_PLAYER_SHOOT for OTHER players'
   * shots (`if (!itsMine)`; the caller also sets firedShowDelay = 2).
   * p1/p2/normal are the decoded shot, ownerAngle the owner's currentCF.angle (degrees),
   * weaponSound the weapon's sfx_sound (played at p1, range 5, volume 150). The nuzzle flash
   * (nuzzleFlashes[nuzzleID]->shoot(), not for the flame thrower) is up to the caller.
   */
  weaponFireRemote(
    weaponID: number,
    damage: number,
    team: number,
    p1: Vec3,
    p2: Vec3,
    normal: Vec3,
    ownerAngle: number,
    brass: BrassEjection | null,
    weaponSound: SoundHandle | null = null,
  ): void {
    const dir = rotateAboutAxis(new Vec3(0, 1, 0), ownerAngle, new Vec3(0, 0, 1));
    if (weaponSound) audio.play3D(weaponSound, 5, p1, 150);
    this.firingSmoke(p1, dir, 45);
    if (DIRECT_WEAPONS.has(weaponID) && weaponID !== WEAPON_FLAME_THROWER) {
      if (weaponID !== WEAPON_PHOTON_RIFLE && brass) {
        this.firingSmoke(brass.pos, brass.dir, 0);
        if (this.options.showCasing) this.addDouille(brass.pos, brass.dir.mul(damage + 1), brass.right);
      }
      this.spawnImpact(p1, p2, normal, weaponID, damage, team);
    } else if (weaponID === WEAPON_FLAME_THROWER) {
      this.flameThrowerFire(p1, p2, normal);
    }
  }

  /**
   * Flame thrower fire along the shot (Weapon::shoot(net) and ClientRecv NET_SVCL_PLAYER_SHOOT for
   * our own flame thrower shots): `for (float i=0;i<=1;i+=.05f)` two additive particles per step.
   */
  flameThrowerFire(p1: Vec3, p2: Vec3, normal: Vec3): void {
    const d = this.dkp;
    const up = new Vec3(0, 0, 1);
    for (let i = 0; i <= 1; i = Math.fround(i + Math.fround(0.05))) {
      const firePos = p1.add(p2.sub(p1).mul(i));
      const spread = (): Vec3 => firePos.add(randV3(new Vec3(-i * 0.3, -i * 0.3, 0), new Vec3(i * 0.3, i * 0.3, 0)));
      d.dkpCreateParticle(
        spread(), up.add(normal),
        randColor([i, 0, 1 - i, 0], [i, i * 0.75, 1 - i, 0]), [i, i * 0.75, 1 - i, 1],
        0.6 * (i * 0.5 + 0.5), 0, i, 0, 0, randRange(0, 30),
        this.tex_smoke1, DKP_SRC_ALPHA, DKP_ONE, 0,
      );
      d.dkpCreateParticle(
        spread(), up.add(normal).add(randV3(new Vec3(-0.2, -0.2, 0), new Vec3(0.2, 0.2, 0))),
        randColor([i, 0, 1 - i, 1], [i, i * 0.75, 1 - i, 1]), [i, i * 0.75, 1 - i, 0],
        0, 0.6 * (i * 0.5 + 0.5), i, 0, 0, randRange(0, 30),
        this.tex_smoke1, DKP_SRC_ALPHA, DKP_ONE, 0,
      );
    }
  }

  /**
   * Projectile::Projectile, PROJECTILE_ROCKET on clients (remoteEntity): launch smoke.
   * `vel` is the constructor velocity (before the *2.5 boost).
   */
  rocketLaunchSmoke(position: Vec3, vel: Vec3): void {
    const back = position.sub(vel);
    const nvel = vel.neg();
    for (let i = 0; i < 10; ++i) {
      this.dkp.dkpCreateParticleEx(back, back, nvel, 1, 2, 0, 45, 0.05, 0.25, 0.25, 0.45, 0.5, 2,
        [0.5, 0.5, 0.5, 1], [0.5, 0.5, 0.5, 1], [0.5, 0.5, 0.5, 0], [0.5, 0.5, 0.5, 0],
        0, 360, -30, 30, 0, 0.25, 5, 5, this.tex_smoke1, 0, DKP_SRC_ALPHA, DKP_ONE_MINUS_SRC_ALPHA);
      this.dkp.dkpCreateParticleEx(position, position, vel, 1, 2, 0, 45, 0.05, 0.25, 0.25, 0.45, 0.5, 2,
        [0.5, 0.5, 0.5, 1], [0.5, 0.5, 0.5, 1], [0.5, 0.5, 0.5, 0], [0.5, 0.5, 0.5, 0],
        0, 360, -30, 30, 0, 0.25, 5, 5, this.tex_smoke1, 0, DKP_SRC_ALPHA, DKP_ONE_MINUS_SRC_ALPHA);
    }
  }

  /**
   * Projectile::update, PROJECTILE_ROCKET on clients: one smoke particle per tick.
   * Team coloured in TDM/CTF (team = owner's teamID, null if the owner is gone).
   */
  rocketSmoke(position: Vec3, gameType: number, team: number | null): void {
    let c1 = 1, c2 = 1, c3 = 1;
    if ((gameType === GAME_TYPE_TDM || gameType === GAME_TYPE_CTF) && team !== null) {
      if (team === PLAYER_TEAM_BLUE) {
        c3 = 1;
        c1 = c2 = 0.25;
      } else if (team === PLAYER_TEAM_RED) {
        c1 = 1;
        c2 = c3 = 0.25;
      }
    }
    this.dkp.dkpCreateParticle(position, new Vec3(), [c1, c2, c3, 0.75], [c1, c2, c3, 0], 0.125, randRange(0.6, 1.0),
      this.options.reducedParticles ? 0.5 : 5.0, 0, 0, randRange(0, 30), this.tex_smoke1, DKP_SRC_ALPHA, DKP_ONE_MINUS_SRC_ALPHA, 0);
  }

  /** Projectile::update, PROJECTILE_GRENADE on clients: one additive glow per tick (team coloured). */
  grenadeTrail(position: Vec3, gameType: number, team: number | null): void {
    let col: Color4 | null = null;
    if (gameType === GAME_TYPE_DM) col = [1, 1, 1];
    else if (team === PLAYER_TEAM_RED) col = [1, 0.25, 0.25];
    else if (team === PLAYER_TEAM_BLUE) col = [0.25, 0.25, 1];
    if (!col) return;
    this.dkp.dkpCreateParticle(position, new Vec3(), [col[0], col[1], col[2], 0.25], [col[0], col[1], col[2], 0], 0.125, 0.2,
      this.options.reducedParticles ? 1.0 : 2.0, 0, 0, randRange(0, 30), this.tex_shotGlow, DKP_SRC_ALPHA, DKP_ONE, 0);
  }

  /** Projectile::update, PROJECTILE_COCKTAIL_MOLOTOV on clients: burning rag (rotation = projectile rotation). */
  molotovFire(position: Vec3, vel: Vec3, rotation: number): void {
    // Axis (vel.x, vel.y, 0) is not normalized in the original either.
    const fireDirection = rotateAboutAxis(new Vec3(0, 0, 1), rotation, new Vec3(vel.x, vel.y, 0));
    this.dkp.dkpCreateParticle(position, fireDirection.mul(0.15), [1, 0.75, 0, 1], [1, 0.75, 0, 0], 0.25, 0.025, 0.25, 0, 0,
      randRange(0, 30), this.tex_smoke1, DKP_SRC_ALPHA, DKP_ONE, 0);
  }

  /**
   * Projectile::update, PROJECTILE_FLAME on clients (molotov fire on the ground). Pass the
   * projectile's spawnParticleTime; returns the new value to store back.
   */
  flameProjectile(position: Vec3, spawnParticleTime: number): number {
    spawnParticleTime++;
    if (spawnParticleTime >= 30) spawnParticleTime = 0;
    const d = this.dkp;
    const jitter = (r: number) => randV3(new Vec3(-r, -r, 0), new Vec3(r, r, 0));
    if (spawnParticleTime % 3 === 0) {
      d.dkpCreateParticle(position.add(jitter(0.2)), new Vec3(0, 0, 1), randColor([1, 0, 0, 0], [1, 0.75, 0, 0]), [1, 0.75, 0, 1],
        0.3, 0, 1.0, 0, 0, randRange(0, 30), this.tex_smoke1, DKP_SRC_ALPHA, DKP_ONE, 0);
      d.dkpCreateParticle(position.add(jitter(0.2)), new Vec3(0, 0, 1).add(jitter(0.2)), randColor([1, 0, 0, 1], [1, 0.75, 0, 1]), [1, 0.75, 0, 0],
        0, 0.3, 1.0, 0, 0, randRange(0, 30), this.tex_smoke1, DKP_SRC_ALPHA, DKP_ONE, 0);
    }
    if (spawnParticleTime % 10 === 0) {
      d.dkpCreateParticle(position, new Vec3(-0.5, 0, 0.5), [0.5, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0], 0.15, 1.0, 3.0, 0, 0,
        randRange(0, 30), this.tex_smoke1, DKP_SRC_ALPHA, DKP_ONE_MINUS_SRC_ALPHA, 0);
    }
    return spawnParticleTime;
  }

  /** Map::updateDummies, DUMMY_TYPE_FLAME (3D maps). Returns the new spawnParticleTime. */
  mapDummyFlame(position: Vec3, spawnParticleTime: number): number {
    spawnParticleTime++;
    if (spawnParticleTime >= 30) spawnParticleTime = 0;
    if (spawnParticleTime % 3 === 0) {
      const jitter = (r: number) => randV3(new Vec3(-r, -r, 0), new Vec3(r, r, 0));
      this.dkp.dkpCreateParticle(position.add(jitter(0.1)), new Vec3(0, 0, 1), randColor([1, 0, 0, 0], [1, 0.75, 0, 0]), [1, 0.75, 0, 1],
        0.3, 0, 1.0, 0, 0, randRange(0, 30), this.tex_smoke1, DKP_SRC_ALPHA, DKP_ONE, 0);
      this.dkp.dkpCreateParticle(position.add(jitter(0.1)), new Vec3(0, 0, 1).add(jitter(0.2)), randColor([1, 0, 0, 1], [1, 0.75, 0, 1]), [1, 0.75, 0, 0],
        0, 0.3, 0.5, 0, 0, randRange(0, 30), this.tex_smoke1, DKP_SRC_ALPHA, DKP_ONE, 0);
    }
    return spawnParticleTime;
  }

  /**
   * Game::update, THEME_LAVA: steam when a live player rolls on lava. The caller checks the
   * condition: `rand()%50 == 5 && cells[(int)(y-.5)*w + (int)(x-.5)].splater[0] > .5`.
   */
  lavaSteam(position: Vec3): void {
    for (let j = 0; j < 4; ++j) {
      this.dkp.dkpCreateParticle(position, new Vec3(0, 0, j * 0.25), [0.7, 0.7, 0.7, 1], [0.7, 0.7, 0.7, 0], 0.25, 0.5, 2, 0, 0, 30,
        this.tex_smoke1, DKP_SRC_ALPHA, DKP_ONE_MINUS_SRC_ALPHA, 0);
    }
    audio.play3D(this.sfx_lavaSteam, 5, position, 125, false, 'ambient');
  }

  /** Game::update, WEATHER_RAIN: 5 drips per tick around map->camPos. */
  rainDrips(camPos: Vec3): void {
    for (let i = 0; i < 5; ++i) {
      const pos = randV3(camPos.add(new Vec3(-5, -5, 0)), camPos.add(new Vec3(5, 5, 0)));
      this.addDrip(pos, 1, 0.15, 2);
    }
  }

  /**
   * Game::update, WEATHER_RAIN: splash under a live player rolling on water. The caller checks
   * `splater[0] > .5 && vel.length() >= 2.25`.
   */
  playerDrip(position: Vec3): void {
    this.addDrip(position, 0.5, 0.3, 1);
  }

  /** Player::hit (client): hit sound + blood. cdamage as computed by Player::hit. */
  playerHit(position: Vec3, cdamage: number): void {
    audio.play3D(this.sfx_hit[crand() % 2], 5, position, 255);
    this.spawnBlood(position, cdamage);
  }

  /** Player::kill(false) (client): death sound + blood. */
  playerDeath(position: Vec3): void {
    audio.play3D(this.sfx_baboCreve[crand() % 3], 5, position, 255);
    this.spawnBlood(position, 1);
  }

  // -------------------------------------------------------------------------------------------
  // Update / render
  // -------------------------------------------------------------------------------------------

  /**
   * Once per sim tick, after the game logic (Game::update effect parts + Map weather + dkpUpdate).
   * `eye` is map->camPos, the camera position in the original's terms (GameCamera.eye); `camera`
   * is the one drawing, for sorting the particles.
   */
  update(delay: number, eye?: Vec3, camera?: THREE.Camera): number {
    if (eye) this.camPos.copy(eye);
    // nuke flashes
    this.nikeFlashes = this.nikeFlashes.filter((n) => {
      n.update(delay);
      return n.life > 0;
    });
    // trails
    this.trails = this.trails.filter((t) => {
      t.update(delay);
      return t.delay < 1;
    });
    // floor marks + drips
    for (let i = 0; i < MAX_FLOOR_MARK; ++i) {
      const m = this.floorMarks[i];
      if (m.delay > 0) m.update(delay);
      const d = this.drips[i];
      d.lastLife = d.life;
      if (d.life > 0) d.update(delay);
    }
    // douilles
    this.douilles = this.douilles.filter((d) => {
      this.updateDouille(d, delay);
      if (d.delay <= 0) {
        this.releaseDouille(d);
        return false;
      }
      return true;
    });
    // weather (Map::update)
    this.weather?.update(delay, this.camPos);
    // particles (Scene::update -> dkpUpdate)
    this.dkp.dkpSetSorting(this.options.particleSort);
    return this.dkp.dkpUpdate(delay, camera);
  }

  /** Douille::update */
  private updateDouille(d: Douille, pDelay: number): void {
    const lastPos = d.position.clone();
    d.lastPosition.copy(d.position);
    d.delay -= pDelay;
    if (d.vel.length() > 0.5) {
      d.position.addScaledIn(d.vel, pDelay);
      d.vel.z -= 9.8 * pDelay;
      const p1 = lastPos;
      const p2 = d.position.clone();
      const normal = new Vec3();
      if (fxRayTest(this.map, p1, p2, normal)) {
        if (!d.soundPlayed) {
          if (d.type === DOUILLE_TYPE_DOUILLE) audio.play3D(this.sfx_douille[crand() % 3], 1, d.position, 255);
          else if (d.type === DOUILLE_TYPE_GIB) this.spawnBlood(d.position, 0.1);
          d.soundPlayed = true;
        }
        d.position = p2.add(normal.mul(0.1));
        d.vel = reflect(d.vel, normal).mul(0.3);
      }
    }
  }

  private acquireDouilleObject(type: number): THREE.Object3D {
    const pool = this.douillePools[type];
    const o = pool.pop();
    if (o) return o;
    const tpl = this.douilleTemplates[type];
    if (tpl) return tpl.clone(true);
    return makeFallbackDouille(type);
  }

  private releaseDouille(d: Douille): void {
    if (!d.object) return;
    d.object.visible = false;
    this.douillePools[d.type]?.push(d.object);
    d.object = null;
  }

  /** Once per rendered frame, before renderer.render(). alpha = interpolation between the last two ticks. */
  render(camera: THREE.Camera, alpha = 1): void {
    camera.updateMatrixWorld();
    const t = alpha;
    const showMarks = this.options.showGroundMark;

    // Drips (GameRender: tex_drip, SRC_ALPHA/ONE_MINUS_SRC_ALPHA)
    const db = this.dripBatch;
    db.begin();
    if (showMarks) {
      for (const d of this.drips) {
        if (d.life <= 0) continue;
        const life = d.lastLife + (d.life - d.lastLife) * t;
        const s = (1 - life) * d.size;
        db.push(d.position.x, d.position.y, d.position.z, s, 0, 0, 0, s, 0, 0.25, 0.7, 0.3, life * 2, this.tex_drip, 1, DKP_SRC_ALPHA, DKP_ONE_MINUS_SRC_ALPHA);
      }
    }
    db.end();

    // Floor marks (FloorMark::render, index order)
    const mb = this.markBatch;
    mb.begin();
    if (showMarks) {
      for (const m of this.floorMarks) {
        if (m.delay <= 0 || m.startDelay > 0) continue;
        const a = (m.angle * Math.PI) / 180;
        const c = Math.cos(a) * m.size;
        const s = Math.sin(a) * m.size;
        const alphaM = m.delay < 10 ? m.color[3] * (m.delay * 0.1) : m.color[3];
        mb.push(m.position.x, m.position.y, m.position.z + 0.025, c, s, 0, -s, c, 0, m.color[0], m.color[1], m.color[2], alphaM, m.texture, 1, DKP_SRC_ALPHA, DKP_ONE_MINUS_SRC_ALPHA);
      }
    }
    mb.end();

    // Trails (Trail::render), then bullets (Trail::renderBullet) for trailType 0
    const tb = this.trailBatch;
    const bb = this.bulletBatch;
    tb.begin();
    bb.begin();
    for (const tr of this.trails) {
      const delay = tr.lastDelay + (tr.delay - tr.lastDelay) * t;
      const w = delay * tr.size;
      const cx = (tr.p1.x + tr.p2.x) * 0.5, cy = (tr.p1.y + tr.p2.y) * 0.5, cz = (tr.p1.z + tr.p2.z) * 0.5;
      const hx = (tr.p2.x - tr.p1.x) * 0.5, hy = (tr.p2.y - tr.p1.y) * 0.5, hz = (tr.p2.z - tr.p1.z) * 0.5;
      const R = tr.right;
      if (tr.trailType === 0) {
        tb.push(cx, cy, cz, R.x * w, R.y * w, R.z * w, hx, hy, hz, 0.7, 0.7, 0.7, (1 - delay) * 0.5, this.tex_smokeTrail, tr.dis, DKP_SRC_ALPHA, DKP_ONE_MINUS_SRC_ALPHA);
      } else {
        tb.push(cx, cy, cz, R.x * w, R.y * w, R.z * w, hx, hy, hz, tr.color[0], tr.color[1], tr.color[2], 1 - delay, this.tex_glowTrail, tr.dis, DKP_SRC_ALPHA, DKP_ONE);
      }
    }
    for (const tr of this.trails) {
      if (tr.trailType !== 0) continue;
      const delay = tr.lastDelay + (tr.delay - tr.lastDelay) * t;
      if (delay <= 0) continue;
      const progress = ((delay / tr.delaySpeed) * 40 + tr.offset * 1) / tr.dis;
      if (!(progress < 1)) continue;
      const dx = tr.p2.x - tr.p1.x, dy = tr.p2.y - tr.p1.y, dz = tr.p2.z - tr.p1.z;
      const x = tr.p1.x + dx * progress;
      const y = tr.p1.y + dy * progress;
      const col = tr.color;
      bb.push(x, y, 0, 1, 0, 0, 0, 1, 0, col[0], col[1], col[2], 0.1, this.tex_shotGlow, 1, DKP_SRC_ALPHA, DKP_ONE);
      const inv = 1 / tr.dis;
      const R = tr.right;
      bb.push(
        tr.p1.x + dx * progress + dx * inv * 0.5, tr.p1.y + dy * progress + dy * inv * 0.5, tr.p1.z + dz * progress + dz * inv * 0.5,
        R.x * 0.05, R.y * 0.05, R.z * 0.05, dx * inv * 0.5, dy * inv * 0.5, dz * inv * 0.5,
        col[0], col[1], col[2], 1, this.tex_shotGlow, 1, DKP_SRC_ALPHA, DKP_ONE,
      );
    }
    tb.end();
    bb.end();

    // Nuke flashes (no depth test, additive shotGlow)
    const nb = this.nukeBatch;
    nb.begin();
    for (const n of this.nikeFlashes) {
      nb.push(n.position.x, n.position.y, n.position.z, n.radius, 0, 0, 0, n.radius, 0, 1, 1, 1, n.density * n.life, this.tex_shotGlow, 1, DKP_SRC_ALPHA, DKP_ONE);
    }
    nb.end();

    // Douilles (Douille::render: translate, glRotatef(delay*90, vel.x, vel.y, 0), scale .005)
    const axis = new THREE.Vector3();
    for (const d of this.douilles) {
      if (!d.object) {
        d.object = this.acquireDouilleObject(d.type);
        this.douilleGroup.add(d.object);
      }
      const o = d.object;
      o.visible = true;
      o.position.set(
        d.lastPosition.x + (d.position.x - d.lastPosition.x) * t,
        d.lastPosition.y + (d.position.y - d.lastPosition.y) * t,
        d.lastPosition.z + (d.position.z - d.lastPosition.z) * t,
      );
      axis.set(d.vel.x, d.vel.y, 0);
      if (axis.lengthSq() > 0) o.quaternion.setFromAxisAngle(axis.normalize(), (d.delay * 90 * Math.PI) / 180);
      else o.quaternion.identity();
      o.scale.setScalar(0.005);
    }

    this.weather?.render(camera, alpha);
    this.dkp.dkpRender(camera, alpha);
  }

  /** Game::resetRound effect part: clears trails, casings, nuke flashes, floor marks, drips, particles. */
  clear(): void {
    this.trails = [];
    for (const d of this.douilles) this.releaseDouille(d);
    this.douilles = [];
    this.nikeFlashes = [];
    for (const m of this.floorMarks) m.delay = 0;
    for (const d of this.drips) {
      d.life = 0;
      d.lastLife = 0;
    }
    this.dkp.dkpReset();
  }

  dispose(): void {
    this.clear();
    this.weather?.dispose();
    this.weather = null;
    this.dripBatch.dispose();
    this.markBatch.dispose();
    this.trailBatch.dispose();
    this.bulletBatch.dispose();
    this.nukeBatch.dispose();
    this.dkp.dispose();
    this.textures.dispose();
    this.group.removeFromParent();
  }
}

// Stand-ins until the DKO models are wired (setDouilleModel). Sizes in DKO units (drawn at .005).
let fallbackGeo: THREE.BufferGeometry[] | null = null;
let fallbackMat: THREE.Material[] | null = null;
function makeFallbackDouille(type: number): THREE.Object3D {
  if (!fallbackGeo || !fallbackMat) {
    fallbackGeo = [new THREE.CylinderGeometry(2.5, 2.5, 9, 8), new THREE.IcosahedronGeometry(6, 0)];
    fallbackMat = [
      new THREE.MeshLambertMaterial({ color: new THREE.Color(0.85, 0.65, 0.2) }),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(0.6, 0.05, 0.05) }),
    ];
  }
  const t = type === DOUILLE_TYPE_GIB ? 1 : 0;
  const m = new THREE.Mesh(fallbackGeo[t], fallbackMat[t]);
  m.name = t ? 'gibFallback' : 'douilleFallback';
  return m;
}
