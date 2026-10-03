// Babo rendering: port of Player::render, Player::updateSkin, Weapon::render and NuzzleFlash::render.
import * as THREE from 'three';
import { PI, WEAPON_KNIVES, WEAPON_NUCLEAR, WEAPON_SHIELD, WEAPON_FLAME_THROWER } from '../../sim/constants';
import { weaponDefs } from '../../sim/gameVar';
import type { Player, SkinInfo } from '../../sim/player';
import { Vec3 } from '../../sim/vec';
import { weaponDummies } from '../../sim/weaponDummies';
import { createDkoObject3D, setDkoFrame } from '../engine/dko';
import { loadTextureAsync } from '../engine/textures';
import { recolorMix, upscaleSkinMix, type SkinMix, type SkinPixels } from './skinUpscale';
import { getModel, getTexture, MODEL_SHIELD_MAGNET, TEXTURES } from '../assets';

/** NUZZLE_DELAY (Weapon.h) */
const NUZZLE_DELAY = 0.1;
const WEAPON_SCALE = 0.005;

// ------------------------------------------------------------------ GLU sphere

/** gluSphere(radius, slices, stacks) with gluQuadricTexture — same vertex/UV layout as GLU. */
export function createGluSphere(radius: number, slices: number, stacks: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const drho = Math.PI / stacks;
  const dtheta = (2 * Math.PI) / slices;
  for (let i = 0; i <= stacks; i++) {
    const rho = i * drho;
    const t = 1 - i / stacks;
    for (let j = 0; j <= slices; j++) {
      const theta = j === slices ? 0 : j * dtheta;
      const x = -Math.sin(theta) * Math.sin(rho);
      const y = Math.cos(theta) * Math.sin(rho);
      const z = Math.cos(rho);
      pos.push(x * radius, y * radius, z * radius);
      nor.push(x, y, z);
      uv.push(j / slices, t);
    }
  }
  const row = slices + 1;
  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < slices; j++) {
      const a = i * row + j;
      const b = (i + 1) * row + j;
      // GL_QUAD_STRIP winding of gluSphere (outside, counter-clockwise)
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// The original's gluSphere(0.25, 16, 16) looked faceted and bent the skin's drawing: twice the slices
const baboSphere = createGluSphere(0.25, 32, 24);
const botSphere = createGluSphere(0.15, 8, 8);

// ------------------------------------------------------------------ skins

const skinCache = new Map<string, Promise<THREE.Texture>>();

/** The babos in game get their skin 4x bigger, with sharp edges (skinUpscale.ts). */
const GAME_SKIN_SCALE = 4;

/** Player::updateSkin for the babos in game (cached per skin and colours). */
export function getSkinTexture(info: SkinInfo): Promise<THREE.Texture> {
  const key = `${info.skin}|${info.redDecal}|${info.greenDecal}|${info.blueDecal}`;
  let p = skinCache.get(key);
  if (!p) {
    p = loadSkinBase(info.skin).then((src) => recolorSkinHD(src, info, GAME_SKIN_SCALE));
    skinCache.set(key, p);
  }
  return p;
}

/** Upscaled skins (the slow part, the same whatever the colours), per skin and scale. */
const mixCache = new Map<string, SkinMix>();

/**
 * Player::updateSkin at `scale` times the 64x32 skin: drawn edges come out smooth and sharp,
 * gradients stay gradients (src/client/render/skinUpscale.ts). Not cached: the caller owns the texture.
 */
export function recolorSkinHD(src: THREE.Texture, info: SkinInfo, scale: number, anisotropy = 4): THREE.DataTexture {
  const key = `${info.skin}|${scale}`;
  let mix = mixCache.get(key);
  if (mix) mixCache.delete(key);
  else mix = upscaleSkinMix(src.image as SkinPixels, scale);
  mixCache.set(key, mix);
  // Least recently used out (a 4x skin is 128 KB, an 8x one 512 KB)
  for (const k of mixCache.keys()) {
    if (mixCache.size <= 32) break;
    mixCache.delete(k);
  }
  const tex = new THREE.DataTexture(recolorMix(mix, [info.redDecal, info.greenDecal, info.blueDecal]), mix.width, mix.height, THREE.RGBAFormat);
  tex.flipY = src.flipY;
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** The skin's original texture (its red, green and blue areas take the three decal colours). */
export function loadSkinBase(skin: string): Promise<THREE.Texture> {
  return loadTextureAsync(`main/skins/${skin}.tga`);
}

/**
 * Player::updateSkin: recolour the 64x32 skin with the three decal colours
 * finalColor = (redDecal * r + greenDecal * g + blueDecal * b) / (r + g + b).
 * Not cached: the caller owns (and disposes) the texture.
 */
export function recolorSkin(src: THREE.Texture, info: SkinInfo): THREE.DataTexture {
  const img = src.image as { data: Uint8Array | Uint8ClampedArray; width: number; height: number };
  const w = img.width;
  const h = img.height;
  const out = new Uint8Array(w * h * 4);
  const [rr, rg, rb] = info.redDecal;
  const [gr, gg, gb] = info.greenDecal;
  const [br, bg, bb] = info.blueDecal;
  for (let i = 0; i < w * h; i++) {
    const r = img.data[i * 4] / 255;
    const g = img.data[i * 4 + 1] / 255;
    const b = img.data[i * 4 + 2] / 255;
    const sum = r + g + b;
    let fr = 0;
    let fg = 0;
    let fb = 0;
    if (sum > 0) {
      fr = (rr * r + gr * g + br * b) / sum;
      fg = (rg * r + gg * g + bg * b) / sum;
      fb = (rb * r + gb * g + bb * b) / sum;
    }
    out[i * 4] = Math.min(255, fr * 255);
    out[i * 4 + 1] = Math.min(255, fg * 255);
    out[i * 4 + 2] = Math.min(255, fb * 255);
    out[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  tex.flipY = src.flipY;
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

// ------------------------------------------------------------------ shared materials

let shadowMat: THREE.MeshBasicMaterial | null = null;
function getShadowMaterial(): THREE.MeshBasicMaterial {
  if (!shadowMat) {
    shadowMat = new THREE.MeshBasicMaterial({
      map: getTexture(TEXTURES.baboShadow),
      color: 0xffffff,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });
  }
  return shadowMat;
}

function additiveMaterial(tex: THREE.Texture, color = 0xffffff, depthTest = true): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    map: tex,
    color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest,
    side: THREE.DoubleSide,
  });
}

function quad(x0: number, y0: number, x1: number, y1: number): THREE.BufferGeometry {
  // glTexCoord (0,1)(0,0)(1,0)(1,1) on (x0,y1)(x0,y0)(x1,y0)(x1,y1) in the XY plane
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y1, 0, x0, y0, 0, x1, y0, 0, x1, y1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 1, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** NuzzleFlash::render geometry: two crossed quads (XY and YZ planes), model units. */
function nuzzleCrossGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-50, 100, 0, -50, 0, 0, 50, 0, 0, 50, 100, 0, 0, 100, 50, 0, 0, 50, 0, 0, -50, 0, 100, -50], 3),
  );
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return g;
}

const shadowGeom = quad(-0.5, -0.5, 0.5, 0.5);
const botShadowGeom = quad(-0.25, -0.25, 0.25, 0.25);
const glowGeom500 = quad(-500, -500, 500, 500);
const glowGeom25 = quad(-25, -25, 25, 25);
const glowGeom1000 = quad(-1000, -1000, 1000, 1000);
const crossGeom = nuzzleCrossGeometry();

// ------------------------------------------------------------------ weapon visual

class NuzzleFlashVisual {
  delay = 0;
  angle = 0;
  readonly group = new THREE.Group();
  private glow: THREE.Mesh;
  private cross: THREE.Mesh;
  private glowMat: THREE.MeshBasicMaterial;
  private crossMat: THREE.MeshBasicMaterial;

  constructor(position: [number, number, number]) {
    this.glowMat = additiveMaterial(getTexture(TEXTURES.shotGlow));
    this.crossMat = additiveMaterial(getTexture(TEXTURES.nuzzleFlash));
    this.glow = new THREE.Mesh(glowGeom500, this.glowMat);
    // The original draws the glow below the ground with the depth test off; we keep it just above
    // the ground (in world units) so walls drawn later still hide it.
    this.glow.position.set(position[0], position[1], 4); // model units (.02 world units above the ground)
    this.glow.renderOrder = 5;
    this.cross = new THREE.Mesh(crossGeom, this.crossMat);
    this.cross.position.set(position[0], position[1], position[2]);
    this.cross.renderOrder = 6;
    this.group.add(this.glow, this.cross);
    this.group.visible = false;
  }

  shoot(): void {
    this.delay = NUZZLE_DELAY;
    this.angle = Math.random() * 360;
  }

  update(delay: number): void {
    this.delay -= delay;
    if (this.delay <= 0) this.delay = 0;
  }

  render(): void {
    if (this.delay <= 0) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const k = this.delay / NUZZLE_DELAY;
    this.glowMat.opacity = k * k * 0.25;
    this.crossMat.opacity = k;
    const s = (1 - k) * 2 + 0.5;
    this.cross.scale.set(s, s, s);
    this.cross.rotation.set(0, this.angle * (PI / 180), 0);
  }
}

/** The weapon model held by a babo (Weapon::render), in weapon model space (scaled by .005). */
class WeaponVisual {
  readonly weaponID: number;
  readonly group = new THREE.Group();
  readonly flashes: NuzzleFlashVisual[] = [];
  private model: THREE.Object3D;
  private magnet: THREE.Object3D | null = null;
  private shieldCopies: THREE.Object3D[] = [];
  private shieldGlow: THREE.Mesh | null = null;
  private shieldGlowMat: THREE.MeshBasicMaterial | null = null;
  private nukeGlow: THREE.Mesh | null = null;

  constructor(weaponID: number, onBot = false) {
    this.weaponID = weaponID;
    const def = weaponDefs[weaponID];
    const model = getModel(def.model);
    if (weaponID === WEAPON_KNIVES) {
      this.model = createDkoObject3D(model, 0, { alphaTest: 0.3 });
      this.group.add(this.model);
    } else if (weaponID === WEAPON_SHIELD) {
      this.magnet = createDkoObject3D(getModel(MODEL_SHIELD_MAGNET), 0);
      this.group.add(this.magnet);
      this.model = createDkoObject3D(model, 0, { blending: 'additive' });
      this.group.add(this.model);
      for (let i = 1; i <= 10; i++) {
        const copy = createDkoObject3D(model, 0, { blending: 'additive', depthWrite: false });
        const holder = new THREE.Group();
        holder.rotation.z = ((36 * i) * Math.PI) / 180;
        holder.add(copy);
        this.group.add(holder);
        this.shieldCopies.push(copy);
      }
      this.shieldGlowMat = additiveMaterial(getTexture(TEXTURES.shotGlow), 0x00e6ff, false);
      this.shieldGlow = new THREE.Mesh(glowGeom25, this.shieldGlowMat);
      this.shieldGlow.renderOrder = 6;
      this.group.add(this.shieldGlow);
    } else if (weaponID === WEAPON_NUCLEAR) {
      this.model = createDkoObject3D(model, 0);
      this.group.add(this.model);
      if (onBot) {
        const mat = additiveMaterial(getTexture(TEXTURES.shotGlow), 0xff4040, false);
        mat.opacity = 0.5;
        this.nukeGlow = new THREE.Mesh(glowGeom1000, mat);
        this.nukeGlow.renderOrder = 6;
        this.nukeGlow.visible = false;
        this.group.add(this.nukeGlow);
      }
    } else {
      this.model = createDkoObject3D(model, 0);
      this.group.add(this.model);
      const dummies = weaponDummies[weaponID]?.flashes ?? [];
      for (const d of dummies) {
        const f = new NuzzleFlashVisual(d.position);
        this.flashes.push(f);
        this.group.add(f.group);
      }
    }
  }

  update(delay: number): void {
    for (const f of this.flashes) f.update(delay);
  }

  /** `modelAnim` comes from the sim weapon; `nukeFrameID`/`nukeActive` for the blinking nuke bot. */
  render(modelAnim: number, nukeFrameID = 0, nukeActive = false): void {
    if (this.weaponID === WEAPON_KNIVES) setDkoFrame(this.model, modelAnim);
    else if (this.weaponID === WEAPON_SHIELD) {
      if (this.magnet) setDkoFrame(this.magnet, modelAnim);
      setDkoFrame(this.model, modelAnim);
      for (const c of this.shieldCopies) setDkoFrame(c, modelAnim);
      if (this.shieldGlow && this.shieldGlowMat) {
        this.shieldGlow.visible = modelAnim < 10;
        this.shieldGlowMat.opacity = 1 - modelAnim / 10;
      }
    } else if (this.nukeGlow) {
      this.nukeGlow.visible = nukeActive && nukeFrameID % 45 < 23;
    }
    for (const f of this.flashes) f.render();
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}

// ------------------------------------------------------------------ babo

export class BaboVisual {
  readonly root = new THREE.Group();
  private shadow: THREE.Mesh;
  private sphere: THREE.Mesh;
  private sphereMat: THREE.MeshLambertMaterial;
  private weaponHolder = new THREE.Group();
  private weapon: WeaponVisual | null = null;
  private melee: WeaponVisual | null = null;
  private roll = new THREE.Quaternion();
  /** The roll at the previous tick: frames in between interpolate, like the position. */
  private prevRoll = new THREE.Quaternion();
  private prevPos = new Vec3();
  private curPos = new Vec3();
  private prevAngle = 0;
  private curAngle = 0;
  private skinKey = '';
  private wasAlive = false;
  // Nuke bot
  private botRoot = new THREE.Group();
  private botSphere: THREE.Mesh;
  private botShadow: THREE.Mesh;
  private botWeaponHolder = new THREE.Group();
  private botNuke: WeaponVisual | null = null;
  private botAntenna: THREE.Object3D;
  private botPrev = new Vec3();
  private botCur = new Vec3();
  private botRoll = new THREE.Quaternion();
  private botPrevRoll = new THREE.Quaternion();
  private botAngle = 0;

  constructor(scene: THREE.Object3D) {
    this.shadow = new THREE.Mesh(shadowGeom, getShadowMaterial());
    this.shadow.renderOrder = -950; // floor decal layer (see MAP_RENDER_ORDER)
    this.sphereMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.sphere = new THREE.Mesh(baboSphere, this.sphereMat);
    this.weaponHolder.scale.setScalar(WEAPON_SCALE);
    this.root.add(this.shadow, this.sphere, this.weaponHolder);

    this.botShadow = new THREE.Mesh(botShadowGeom, getShadowMaterial());
    this.botShadow.renderOrder = -950;
    this.botSphere = new THREE.Mesh(botSphere, this.sphereMat);
    this.botWeaponHolder.scale.setScalar(0.003);
    this.botAntenna = createDkoObject3D(getModel(weaponDefs[13].model), 0);
    this.botWeaponHolder.add(this.botAntenna);
    this.botRoot.add(this.botShadow, this.botSphere, this.botWeaponHolder);
    this.botRoot.visible = false;

    scene.add(this.root, this.botRoot);
    this.root.visible = false;
  }

  setSkin(info: SkinInfo): void {
    const key = `${info.skin}|${info.redDecal}|${info.greenDecal}|${info.blueDecal}`;
    if (key === this.skinKey) return;
    this.skinKey = key;
    void getSkinTexture(info).then((tex) => {
      if (this.skinKey !== key) return;
      this.sphereMat.map = tex;
      this.sphereMat.needsUpdate = true;
    });
  }

  /** Nuzzle flash trigger (Weapon::shoot -> nuzzleFlashes[firingNuzzle]->shoot()). */
  fire(weaponID: number, nuzzleID: number): void {
    if (this.weapon && this.weapon.weaponID === weaponID && weaponID !== WEAPON_FLAME_THROWER) {
      this.weapon.flashes[nuzzleID]?.shoot();
    }
  }

  /** Called after every simulation tick. */
  tick(player: Player, delay: number): void {
    this.setSkin(player.displaySkin);
    const alive = player.isAlive;
    const pos = player.currentCF.position;
    this.prevRoll.copy(this.roll);
    if (alive && !this.wasAlive) {
      this.prevPos.copy(pos);
      this.curPos.copy(pos);
      this.roll.identity(); // matrix.LoadIdentity() on spawn
      this.prevRoll.identity();
      this.prevAngle = this.curAngle = player.currentCF.angle;
    } else {
      this.prevPos.copy(this.curPos);
      this.curPos.copy(pos);
      this.prevAngle = this.curAngle;
      this.curAngle = player.currentCF.angle;
    }
    this.wasAlive = alive;

    // Roll the ball ("On fait rouler la bouboule"). The original rolled by currentCF - lastCF inside
    // Player::update, before Map::performCollision set lastCF = currentCF; here the game update is
    // over, so the tick's movement is taken from the positions this visual keeps.
    if (alive) {
      const mv = this.curPos.sub(this.prevPos);
      const len = mv.length();
      if (len > 0) {
        const angle = PI * len;
        const right = new THREE.Vector3(mv.y, -mv.x, 0); // cross(mouvement, (0,0,1))
        if (right.lengthSq() > 0) {
          right.normalize();
          const q = new THREE.Quaternion().setFromAxisAngle(right, -angle);
          this.roll.premultiply(q).normalize();
        }
      }
    }

    // Weapons
    const wid = player.weapon ? player.weapon.weaponID : -1;
    if (!this.weapon || this.weapon.weaponID !== wid) {
      this.weapon?.dispose();
      this.weapon = wid >= 0 ? new WeaponVisual(wid) : null;
      if (this.weapon) this.weaponHolder.add(this.weapon.group);
    }
    const mid = player.meleeWeapon ? player.meleeWeapon.weaponID : -1;
    if (!this.melee || this.melee.weaponID !== mid) {
      this.melee?.dispose();
      this.melee = mid >= 0 ? new WeaponVisual(mid) : null;
      if (this.melee) this.weaponHolder.add(this.melee.group);
    }
    this.weapon?.update(delay);
    this.melee?.update(delay);

    // Nuke bot
    const bot = player.minibot;
    this.botPrevRoll.copy(this.botRoll);
    if (bot && alive) {
      if (!this.botRoot.visible) {
        this.botPrev.copy(bot.currentCF.position);
        this.botCur.copy(bot.currentCF.position);
        this.botRoll.identity();
        this.botPrevRoll.identity();
        if (!this.botNuke) {
          this.botNuke = new WeaponVisual(WEAPON_NUCLEAR, true);
          this.botWeaponHolder.add(this.botNuke.group);
        }
      } else {
        this.botPrev.copy(this.botCur);
        this.botCur.copy(bot.currentCF.position);
      }
      const mv = this.botCur.sub(this.botPrev);
      const len = mv.length();
      if (len > 0) {
        const angle = 0.5 * PI * len * 4;
        const right = new THREE.Vector3(mv.y, -mv.x, 0);
        if (right.lengthSq() > 0) {
          this.botRoll.premultiply(new THREE.Quaternion().setFromAxisAngle(right.normalize(), -angle)).normalize();
        }
      }
      this.botAngle = bot.currentCF.angle;
      this.botRoot.visible = true;
    } else {
      this.botRoot.visible = false;
    }
  }

  /** Called every rendered frame; `alpha` interpolates between the last two ticks. */
  render(player: Player, alpha: number): void {
    const alive = player.isAlive;
    this.root.visible = alive;
    if (!alive) {
      this.botRoot.visible = false;
      return;
    }
    const x = this.prevPos.x + (this.curPos.x - this.prevPos.x) * alpha;
    const y = this.prevPos.y + (this.curPos.y - this.prevPos.y) * alpha;
    const z = this.prevPos.z + (this.curPos.z - this.prevPos.z) * alpha;
    this.shadow.position.set(x + 0.1, y - 0.1, 0.025);
    this.sphere.position.set(x, y, z);
    this.sphere.quaternion.slerpQuaternions(this.prevRoll, this.roll, alpha);
    this.weaponHolder.position.set(x, y, 0);
    let da = this.curAngle - this.prevAngle;
    if (da > 180) da -= 360;
    if (da < -180) da += 360;
    this.weaponHolder.rotation.set(0, 0, ((this.prevAngle + da * alpha) * Math.PI) / 180);
    this.weapon?.render(player.weapon?.modelAnim ?? 0);
    this.melee?.render(player.meleeWeapon?.modelAnim ?? 0);

    if (this.botRoot.visible && player.minibot) {
      const bx = this.botPrev.x + (this.botCur.x - this.botPrev.x) * alpha;
      const by = this.botPrev.y + (this.botCur.y - this.botPrev.y) * alpha;
      const bz = this.botPrev.z + (this.botCur.z - this.botPrev.z) * alpha;
      this.botShadow.position.set(bx + 0.06, by - 0.06, 0.025);
      this.botSphere.position.set(bx, by, bz);
      this.botSphere.quaternion.slerpQuaternions(this.botPrevRoll, this.botRoll, alpha);
      this.botWeaponHolder.position.set(bx, by, 0);
      this.botWeaponHolder.rotation.set(0, 0, (this.botAngle * Math.PI) / 180);
      const melee = player.meleeWeapon;
      this.botNuke?.render(0, melee?.nukeFrameID ?? 0, !!melee && melee.currentFireDelay > 0);
    }
  }

  /** Interpolated position (for names, sounds...). */
  get renderPosition(): Vec3 {
    return new Vec3(this.sphere.position.x, this.sphere.position.y, this.sphere.position.z);
  }

  dispose(): void {
    this.weapon?.dispose();
    this.melee?.dispose();
    this.root.removeFromParent();
    this.botRoot.removeFromParent();
  }
}
