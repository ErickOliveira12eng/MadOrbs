// Port of the DukZeven particle module (Engine/DukZeven/Code/dkp.cpp, dkp.h, dkpi.h, CParticle.cpp).
//
// Behaviour kept from the original:
//  - integration (CParticle::update): life += fadeSpeed*delay (dies at 1), angle += rotationSpeed*delay,
//    vel += gravity*gravityInfluence*delay, position += vel*delay. Air resistance is NOT applied
//    (the original has an empty "On l'affecte à la densité de l'air" step), airDensity is stored only.
//  - colour/size lerp linearly with life; `transitionFunc` is ignored (unused in the original).
//  - rendering (CParticle::render): camera-plane aligned quad, corners at ±size (so 2*size wide),
//    rotated by `angle` degrees about the view axis, GL_MODULATE, depth test on, depth writes off,
//    no culling, no fog, lighting disabled (single texture path), per-particle glBlendFunc.
//  - particles are drawn in list order (creation order); dkpSetSorting(true) keeps them sorted
//    back-to-front by squared camera distance (the original does an incremental bubble sort, here a
//    full stable sort each update). The game leaves sorting off (r_particleSort = false).
//  - multi-frame textures (textureFrameCount > 1): two quads cross-fading between frames.
//
// Everything is drawn with a handful of instanced draw calls (see quadBatch.ts) — no per-particle Mesh.
import * as THREE from 'three';
import { Vec3, rotateAboutAxis, randRange, crand, cross } from '../../sim/vec';
import type { FxTexture, FxTextureArray } from './fxTextures';
import {
  QuadBatch,
  isPremultipliable,
  DKP_ZERO,
  DKP_ONE,
  DKP_SRC_COLOR,
  DKP_ONE_MINUS_SRC_COLOR,
  DKP_SRC_ALPHA,
  DKP_ONE_MINUS_SRC_ALPHA,
  DKP_DST_ALPHA,
  DKP_ONE_MINUS_DST_ALPHA,
  DKP_DST_COLOR,
  DKP_ONE_MINUS_DST_COLOR,
  DKP_SRC_ALPHA_SATURATE,
} from './quadBatch';

export {
  DKP_ZERO,
  DKP_ONE,
  DKP_SRC_COLOR,
  DKP_ONE_MINUS_SRC_COLOR,
  DKP_SRC_ALPHA,
  DKP_ONE_MINUS_SRC_ALPHA,
  DKP_DST_ALPHA,
  DKP_ONE_MINUS_DST_ALPHA,
  DKP_DST_COLOR,
  DKP_ONE_MINUS_DST_COLOR,
  DKP_SRC_ALPHA_SATURATE,
};

// dkp.h transition functions (accepted, unused like the original)
export const DKP_TRANS_LINEAR = 0;
export const DKP_TRANS_FASTIN = 1;
export const DKP_TRANS_FASTOUT = 2;
export const DKP_TRANS_SMOOTH = 3;

/** RGBA colour, components 0..1 (CColor4f / CVector4f). */
export type Color4 = ArrayLike<number>;

// ---------------------------------------------------------------------------------------------
// Engine random helpers (CVector.cpp)
// ---------------------------------------------------------------------------------------------

/** `int rand(int from, int to)` — NOTE: `to` is exclusive (from + rand()%(to-from)). */
export function randInt(from: number, to: number): number {
  if (from > to) [from, to] = [to, from];
  return from === to ? from : from + (crand() % (to - from));
}

/** `CVector4f rand(from, to)` per component. */
export function randColor(from: Color4, to: Color4): [number, number, number, number] {
  return [randRange(from[0], to[0]), randRange(from[1], to[1]), randRange(from[2], to[2]), randRange(from[3], to[3])];
}

/** `CVector3f rand(from, to)` per component. */
export function randV3(from: Vec3, to: Vec3): Vec3 {
  return new Vec3(randRange(from.x, to.x), randRange(from.y, to.y), randRange(from.z, to.z));
}

/** Port of CVector.cpp createRightUpVectors (right/up are NOT normalized, like the original). */
export function createRightUpVectors(front: Vec3): { right: Vec3; up: Vec3 } {
  const f = front.clone().normalizeIn();
  if (f.y === 1) return { right: new Vec3(1, 0, 0), up: new Vec3(0, 0, 1) };
  if (f.y === -1) return { right: new Vec3(-1, 0, 0), up: new Vec3(0, 0, 1) };
  const up = cross(f, new Vec3(0, 1, 0));
  const right = cross(f, up);
  return { right, up };
}

// ---------------------------------------------------------------------------------------------
// CParticle
// ---------------------------------------------------------------------------------------------

export class CParticle {
  texture: FxTexture;
  position: Vec3;
  /** Position at the previous update (render interpolation). */
  lastPosition: Vec3;
  startColor: [number, number, number, number];
  endColor: [number, number, number, number];
  vel: Vec3;
  /** 0..1 (1 = dead). */
  life = 0;
  lastLife = 0;
  fadeSpeed: number;
  startSize: number;
  endSize: number;
  /** gravityInfluence (1 = fully attracted by gravity). */
  density: number;
  angle: number;
  lastAngle: number;
  rotationSpeed: number;
  srcBlend: number;
  dstBlend: number;
  airResistanceInfluence: number;
  camDis = 0;
  billboard = false;
  billboardOpacity = 0;
  billboardFadeDis = 16;
  billboardFadeDelay = 1;
  toDelete = false;
  isMultipleTexture = false;
  textureArray: FxTexture[] | null = null;
  nbFrame = 1;

  constructor(
    position: Vec3,
    vel: Vec3,
    startColor: Color4,
    endColor: Color4,
    startSize: number,
    endSize: number,
    duration: number,
    density: number,
    airResistanceInfluence: number,
    rotationSpeed: number,
    texture: FxTexture,
    srcBlend: number,
    dstBlend: number,
    _transitionFunc: number,
  ) {
    this.texture = texture;
    this.position = position.clone();
    this.lastPosition = position.clone();
    this.startColor = [startColor[0], startColor[1], startColor[2], startColor[3]];
    this.endColor = [endColor[0], endColor[1], endColor[2], endColor[3]];
    this.vel = vel.clone();
    this.fadeSpeed = 1 / duration;
    this.startSize = startSize;
    this.endSize = endSize;
    this.density = density;
    this.angle = (crand() % 36000) / 100;
    this.lastAngle = this.angle;
    this.rotationSpeed = rotationSpeed;
    this.srcBlend = srcBlend;
    this.dstBlend = dstBlend;
    this.airResistanceInfluence = airResistanceInfluence;
  }
}

// ---------------------------------------------------------------------------------------------
// dkp_preset
// ---------------------------------------------------------------------------------------------

export interface dkp_preset {
  positionFrom: Vec3;
  positionTo: Vec3;
  direction: Vec3;
  speedFrom: number;
  speedTo: number;
  pitchFrom: number;
  pitchTo: number;
  startSizeFrom: number;
  startSizeTo: number;
  endSizeFrom: number;
  endSizeTo: number;
  durationFrom: number;
  durationTo: number;
  startColorFrom: Color4;
  startColorTo: Color4;
  endColorFrom: Color4;
  endColorTo: Color4;
  angleFrom: number;
  angleTo: number;
  angleSpeedFrom: number;
  angleSpeedTo: number;
  gravityInfluence: number;
  airResistanceInfluence: number;
  particleCountFrom: number;
  particleCountTo: number;
  /** `unsigned int *texture`: one texture, or an array of frames. */
  texture: FxTexture | FxTexture[] | null;
  textureFrameCount: number;
  srcBlend: number;
  dstBlend: number;
}

/** A zero-initialised preset (C++ POD struct). */
export function createPreset(overrides: Partial<dkp_preset> = {}): dkp_preset {
  return {
    positionFrom: new Vec3(),
    positionTo: new Vec3(),
    direction: new Vec3(0, 0, 1),
    speedFrom: 0,
    speedTo: 0,
    pitchFrom: 0,
    pitchTo: 0,
    startSizeFrom: 0,
    startSizeTo: 0,
    endSizeFrom: 0,
    endSizeTo: 0,
    durationFrom: 1,
    durationTo: 1,
    startColorFrom: [1, 1, 1, 1],
    startColorTo: [1, 1, 1, 1],
    endColorFrom: [1, 1, 1, 1],
    endColorTo: [1, 1, 1, 1],
    angleFrom: 0,
    angleTo: 0,
    angleSpeedFrom: 0,
    angleSpeedTo: 0,
    gravityInfluence: 0,
    airResistanceInfluence: 0,
    particleCountFrom: 1,
    particleCountTo: 1,
    texture: null,
    textureFrameCount: 0,
    srcBlend: DKP_SRC_ALPHA,
    dstBlend: DKP_ONE_MINUS_SRC_ALPHA,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// CDkp + dkp* functions
// ---------------------------------------------------------------------------------------------

export interface ParticleEngineOptions {
  /** renderOrder of the particle batch (GameRender: after trails, before weather / nuke flash). */
  renderOrder?: number;
}

export class ParticleEngine {
  /** CDkp::particles (render order). */
  particles: CParticle[] = [];
  /** CDkp::gravity */
  gravity = new Vec3(0, 0, -9.8);
  /** CDkp::airDensity (kPa) — stored only, like the original. */
  airDensity = 103.4;
  /** CDkp::sorting */
  sorting = false;
  /** CDkp::camPos (updated from the camera in dkpRender / dkpUpdate). */
  camPos = new Vec3();
  /** Add this to the scene (identity transform). */
  readonly object = new THREE.Group();

  private readonly textures: FxTextureArray;
  private readonly main: QuadBatch;
  private readonly straight = new Map<string, QuadBatch>();
  private readonly renderOrder: number;

  constructor(textures: FxTextureArray, opts: ParticleEngineOptions = {}) {
    this.textures = textures;
    this.renderOrder = opts.renderOrder ?? 30;
    this.object.name = 'dkpParticles';
    this.main = new QuadBatch(textures, { renderOrder: this.renderOrder, name: 'dkpParticles', initialCapacity: 1024 });
    this.object.add(this.main.mesh);
  }

  private insert(p: CParticle): void {
    // Insert at the right place when sorting (dkpCreateParticle*): list is kept far → near.
    if (this.sorting) p.camDis = sqDist(this.camPos, p.position);
    if (this.particles.length > 1 && this.sorting) {
      for (let i = 0; i < this.particles.length; i++) {
        if (p.camDis > this.particles[i].camDis) {
          this.particles.splice(i, 0, p);
          return;
        }
      }
    }
    this.particles.push(p);
  }

  /** dkpCreateParticle */
  dkpCreateParticle(
    position: Vec3,
    vel: Vec3,
    startColor: Color4,
    endColor: Color4,
    startSize: number,
    endSize: number,
    duration: number,
    gravityInfluence: number,
    airResistanceInfluence: number,
    rotationSpeed: number,
    texture: FxTexture,
    srcBlend: number,
    dstBlend: number,
    transitionFunc = 0,
  ): CParticle {
    const p = new CParticle(
      position, vel, startColor, endColor, startSize, endSize, duration,
      gravityInfluence, airResistanceInfluence, rotationSpeed, texture, srcBlend, dstBlend, transitionFunc,
    );
    this.insert(p);
    return p;
  }

  /** dkpCreateParticleEx */
  dkpCreateParticleEx(
    positionFrom: Vec3,
    positionTo: Vec3,
    direction: Vec3,
    speedFrom: number,
    speedTo: number,
    pitchFrom: number,
    pitchTo: number,
    startSizeFrom: number,
    startSizeTo: number,
    endSizeFrom: number,
    endSizeTo: number,
    durationFrom: number,
    durationTo: number,
    startColorFrom: Color4,
    startColorTo: Color4,
    endColorFrom: Color4,
    endColorTo: Color4,
    angleFrom: number,
    angleTo: number,
    angleSpeedFrom: number,
    angleSpeedTo: number,
    gravityInfluence: number,
    airResistanceInfluence: number,
    particleCountFrom: number,
    particleCountTo: number,
    texture: FxTexture | FxTexture[] | null,
    textureFrameCount: number,
    srcBlend: number,
    dstBlend: number,
  ): void {
    const total = randInt(particleCountFrom, particleCountTo);
    const { right } = createRightUpVectors(direction);
    const frames = texture === null ? null : Array.isArray(texture) ? texture : [texture];
    for (let n = 0; n < total; n++) {
      let vel = direction.mul(randRange(speedFrom, speedTo));
      vel = rotateAboutAxis(vel, randRange(pitchFrom, pitchTo), right);
      vel = rotateAboutAxis(vel, randRange(0, 360), direction);
      const p = new CParticle(
        randV3(positionFrom, positionTo),
        vel,
        randColor(startColorFrom, startColorTo),
        randColor(endColorFrom, endColorTo),
        randRange(startSizeFrom, startSizeTo),
        randRange(endSizeFrom, endSizeTo),
        randRange(durationFrom, durationTo),
        gravityInfluence,
        airResistanceInfluence,
        randRange(angleSpeedFrom, angleSpeedTo),
        frames ? frames[0] : 0,
        srcBlend,
        dstBlend,
        0,
      );
      p.angle = randRange(angleFrom, angleTo);
      p.lastAngle = p.angle;
      if (textureFrameCount > 1 && frames) {
        p.isMultipleTexture = true;
        p.nbFrame = textureFrameCount;
        p.textureArray = frames;
      }
      this.insert(p);
    }
  }

  /** dkpCreateParticleExP */
  dkpCreateParticleExP(preset: dkp_preset): void {
    this.dkpCreateParticleEx(
      preset.positionFrom, preset.positionTo, preset.direction,
      preset.speedFrom, preset.speedTo, preset.pitchFrom, preset.pitchTo,
      preset.startSizeFrom, preset.startSizeTo, preset.endSizeFrom, preset.endSizeTo,
      preset.durationFrom, preset.durationTo,
      preset.startColorFrom, preset.startColorTo, preset.endColorFrom, preset.endColorTo,
      preset.angleFrom, preset.angleTo, preset.angleSpeedFrom, preset.angleSpeedTo,
      preset.gravityInfluence, preset.airResistanceInfluence,
      preset.particleCountFrom, preset.particleCountTo,
      preset.texture, preset.textureFrameCount, preset.srcBlend, preset.dstBlend,
    );
  }

  /** dkpCreateBillboard — static billboard (grass), fades in/out with the camera distance. */
  dkpCreateBillboard(
    positionFrom: Vec3,
    positionTo: Vec3,
    fadeSpeed: number,
    fadeOutDistance: number,
    size: number,
    color: Color4,
    texture: FxTexture,
    srcBlend: number,
    dstBlend: number,
  ): CParticle {
    const p = new CParticle(randV3(positionFrom, positionTo), new Vec3(), color, color, size, size, 1, 0, 0, 0, texture, srcBlend, dstBlend, 0);
    p.billboard = true;
    p.billboardFadeDis = fadeOutDistance;
    p.billboardFadeDelay = 1 / fadeSpeed;
    p.angle = 0;
    p.lastAngle = 0;
    this.insert(p);
    return p;
  }

  /** dkpReset */
  dkpReset(): void {
    this.particles.length = 0;
  }

  /** dkpSetAirDensity */
  dkpSetAirDensity(airDensity: number): void {
    this.airDensity = airDensity;
  }

  /** dkpSetGravity */
  dkpSetGravity(vel: Vec3): void {
    this.gravity.copy(vel);
  }

  /** dkpSetSorting */
  dkpSetSorting(sort: boolean): void {
    this.sorting = sort;
  }

  /** dkpUpdate (CParticle::update for each particle). Returns the particle count. */
  dkpUpdate(delay: number, camera?: THREE.Camera): number {
    if (camera) {
      const e = camera.matrixWorld.elements;
      this.camPos.set(e[12], e[13], e[14]);
    }
    const list = this.particles;
    const g = this.gravity;
    const cam = this.camPos;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (updateParticle(p, delay, g, cam, this.sorting)) list[w++] = p;
    }
    list.length = w;
    if (this.sorting && list.length > 1) list.sort((a, b) => b.camDis - a.camDis);
    return w;
  }

  /**
   * dkpRender: fills the GPU buffers. Call once per rendered frame (before renderer.render) with the
   * camera used for rendering. `alpha` (0..1) interpolates between the last two updates; 1 = the
   * latest update (what the original showed).
   */
  dkpRender(camera: THREE.Camera, alpha = 1): void {
    const e = camera.matrixWorld.elements;
    // Camera right/up in world space: the original multiplies by the transposed modelview rotation.
    let rx = e[0], ry = e[1], rz = e[2];
    let ux = e[4], uy = e[5], uz = e[6];
    const rl = Math.hypot(rx, ry, rz) || 1;
    const ul = Math.hypot(ux, uy, uz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    ux /= ul; uy /= ul; uz /= ul;
    this.camPos.set(e[12], e[13], e[14]);

    this.main.begin();
    for (const b of this.straight.values()) b.begin();

    const t = alpha;
    for (const p of this.particles) {
      const life = p.lastLife + (p.life - p.lastLife) * t;
      const sc = p.startColor;
      const ec = p.endColor;
      const r = sc[0] + (ec[0] - sc[0]) * life;
      const gg = sc[1] + (ec[1] - sc[1]) * life;
      const b = sc[2] + (ec[2] - sc[2]) * life;
      let a = sc[3] + (ec[3] - sc[3]) * life;
      if (p.billboard) a *= p.billboardOpacity;
      const size = p.startSize + (p.endSize - p.startSize) * life;
      const ang = (p.lastAngle + (p.angle - p.lastAngle) * t) * (Math.PI / 180);
      const c = Math.cos(ang) * size;
      const s = Math.sin(ang) * size;
      const px = p.lastPosition.x + (p.position.x - p.lastPosition.x) * t;
      const py = p.lastPosition.y + (p.position.y - p.lastPosition.y) * t;
      const pz = p.lastPosition.z + (p.position.z - p.lastPosition.z) * t;
      // glRotatef(angle, 0,0,1) after glScalef(size): local x -> right*c + up*s, local y -> -right*s + up*c
      const ax = rx * c + ux * s, ay = ry * c + uy * s, az = rz * c + uz * s;
      const bx = -rx * s + ux * c, by = -ry * s + uy * c, bz = -rz * s + uz * c;
      const batch = this.batchFor(p.srcBlend, p.dstBlend);
      if (p.isMultipleTexture && p.textureArray) {
        const currentFrame = Math.min(p.nbFrame - 1, Math.floor(p.nbFrame * life));
        let nextFrame = currentFrame + 1;
        const midFrame = p.nbFrame * life - currentFrame;
        if (nextFrame >= p.nbFrame) nextFrame = currentFrame;
        batch.push(px, py, pz, ax, ay, az, bx, by, bz, r, gg, b, a * (1 - midFrame), p.textureArray[currentFrame], 1, p.srcBlend, p.dstBlend);
        batch.push(px, py, pz, ax, ay, az, bx, by, bz, r, gg, b, a * midFrame, p.textureArray[nextFrame], 1, p.srcBlend, p.dstBlend);
      } else {
        batch.push(px, py, pz, ax, ay, az, bx, by, bz, r, gg, b, a, p.texture, 1, p.srcBlend, p.dstBlend);
      }
    }

    this.main.end();
    for (const bt of this.straight.values()) bt.end();
  }

  private batchFor(src: number, dst: number): QuadBatch {
    if (isPremultipliable(src, dst)) return this.main;
    const key = `${src},${dst}`;
    let b = this.straight.get(key);
    if (!b) {
      b = new QuadBatch(this.textures, {
        renderOrder: this.renderOrder + 0.5,
        straightBlend: { src, dst },
        name: `dkpParticles(${key})`,
      });
      this.straight.set(key, b);
      this.object.add(b.mesh);
    }
    return b;
  }

  /** Particle count (gameVar.ro_nbParticle). */
  get count(): number {
    return this.particles.length;
  }

  /** dkpShutDown */
  dispose(): void {
    this.particles.length = 0;
    this.main.dispose();
    for (const b of this.straight.values()) b.dispose();
    this.straight.clear();
    this.object.removeFromParent();
  }
}

function sqDist(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/** CParticle::update. Returns false when the particle must be deleted. */
function updateParticle(p: CParticle, delay: number, gravity: Vec3, camPos: Vec3, sorting: boolean): boolean {
  p.lastPosition.copy(p.position);
  p.lastLife = p.life;
  p.lastAngle = p.angle;
  if (p.billboard) {
    p.camDis = sqDist(camPos, p.position);
    if (p.toDelete) {
      p.billboardOpacity -= delay * p.billboardFadeDelay;
      if (p.billboardOpacity <= 0) return false;
    } else if (p.camDis >= p.billboardFadeDis * p.billboardFadeDis) {
      p.toDelete = true;
    } else if (p.billboardOpacity < 1) {
      p.billboardOpacity += delay * p.billboardFadeDelay;
      if (p.billboardOpacity > 1) p.billboardOpacity = 1;
    }
    return true;
  }
  // On diminue sa vie
  p.life += p.fadeSpeed * delay;
  if (p.life >= 1) return false;
  // Sa rotation
  p.angle += p.rotationSpeed * delay;
  // On affecte la gravité
  p.vel.x += gravity.x * p.density * delay;
  p.vel.y += gravity.y * p.density * delay;
  p.vel.z += gravity.z * p.density * delay;
  // (air resistance: not implemented in the original either)
  // On anime finalement sa position
  p.position.x += p.vel.x * delay;
  p.position.y += p.vel.y * delay;
  p.position.z += p.vel.z * delay;
  if (sorting) p.camDis = sqDist(camPos, p.position);
  return true;
}
