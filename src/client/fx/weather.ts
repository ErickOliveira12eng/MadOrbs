// Port of the map weather effects: CWeather.h (base), CRain.cpp, CSnow.cpp, CLava.cpp, and the
// weather selection of Map::reloadWeather (Map.cpp). WEATHER_* / THEME_* constants from Map.h.
//
// Note: in the original, weather only exists when gameVar.r_weatherEffects is true (default FALSE).
// Rain drips on the ground are spawned by Game::update (see Effects.rainDrips), not by CRain.
// Map fog is never actually enabled by the original (reloadWeather leaves fogDensity at 0).
import * as THREE from 'three';
import { Vec3, randRange } from '../../sim/vec';
import { audio, type SoundHandle } from '../audio/audio';
import type { FxTextureArray, FxTexture } from './fxTextures';
import { QuadBatch, DKP_SRC_ALPHA, DKP_ONE_MINUS_SRC_ALPHA } from './quadBatch';

// Map.h
export const WEATHER_NONE = 0;
export const WEATHER_FOG = 1;
export const WEATHER_SNOW = 2;
export const WEATHER_RAIN = 3;
export const WEATHER_SANDSTORM = 4;
export const WEATHER_LAVA = 5;

export const THEME_GRASS = 0;
export const THEME_SNOW = 1;
export const THEME_SAND = 2;
export const THEME_CITY = 3;
export const THEME_MODERN = 4;
export const THEME_LAVA = 5;
export const THEME_ANIMAL = 6;
export const THEME_ORANGE = 7;
export const THEME_CORE = 8;
export const THEME_FROZEN = 9;
export const THEME_GRAIN = 10;
export const THEME_MEDIEVAL = 11;
export const THEME_METAL = 12;
export const THEME_RAINY = 13;
export const THEME_REAL = 14;
export const THEME_ROAD = 15;
export const THEME_ROCK = 16;
export const THEME_SAVANA = 17;
export const THEME_SOFT = 18;
export const THEME_STREET = 19;
export const THEME_TROPICAL = 20;
export const THEME_WINTER = 21;
export const THEME_WOODEN = 22;

/** renderOrder of the weather (GameRender: after the particles, before the nuke flashes). */
export const WEATHER_RENDER_ORDER = 40;

/**
 * Map::reloadWeather theme -> weather. Faithful to the original, including its quirk: the
 * THEME_GRAIN fog assignment is overwritten by the following if/else chain (so it ends up NONE).
 */
export function weatherFromTheme(theme: number, weatherEffects = true): number {
  if (!weatherEffects) return WEATHER_NONE;
  let weather = WEATHER_NONE;
  if (theme === THEME_GRAIN) weather = WEATHER_FOG;
  if (theme === THEME_SNOW || theme === THEME_FROZEN || theme === THEME_WINTER) weather = WEATHER_SNOW;
  else if (theme === THEME_SAND || theme === THEME_STREET) weather = WEATHER_SANDSTORM;
  else if (theme === THEME_CITY || theme === THEME_RAINY || theme === THEME_ROAD) weather = WEATHER_RAIN;
  else if (theme === THEME_LAVA || theme === THEME_CORE || theme === THEME_ROCK) weather = WEATHER_LAVA;
  else weather = WEATHER_NONE;
  return weather;
}

/** CWeather */
export abstract class CWeather {
  readonly object = new THREE.Group();
  private loop: AudioBufferSourceNode | null = null;
  private loopSound: SoundHandle | null = null;
  private loopVolume = 0;
  private disposed = false;

  /** dksPlaySound(sound, -1, volume) on a looping sample, started as soon as audio is available. */
  protected startLoop(url: string, volume: number): void {
    this.loopVolume = volume;
    void audio.loadAsync(url).then((h) => {
      if (this.disposed) return;
      this.loopSound = h;
      this.tryStartLoop();
    });
  }

  private tryStartLoop(): void {
    if (this.loop || !this.loopSound || this.disposed) return;
    const ctx = audio.context;
    if (!ctx || ctx.state !== 'running') return;
    this.loop = audio.play(this.loopSound, this.loopVolume, true, 'ambient');
  }

  /** Per sim tick. camPos = map->camPos (camera eye position). */
  update(_delay: number, _camPos: Vec3): void {
    this.tryStartLoop();
  }

  /** Per rendered frame (fills GPU buffers). */
  render(_camera: THREE.Camera, _alpha = 1): void {}

  dispose(): void {
    this.disposed = true;
    if (this.loop) {
      try {
        this.loop.stop();
      } catch {
        /* already stopped */
      }
    }
    this.loop = null;
    this.object.removeFromParent();
  }
}

// ---------------------------------------------------------------------------------------------
// CRain
// ---------------------------------------------------------------------------------------------

const RAIN_VERT = /* glsl */ `
uniform vec2 uResolution;
uniform float uWidth;
uniform float uNear;
attribute vec4 iDrop; // xyz = top of the drop, w = alpha
varying float vAlpha;
void main() {
  // SRain::render: GL_LINES from pos to pos - (0,0,.5), glLineWidth(2)
  vec4 va = modelViewMatrix * vec4(iDrop.xyz, 1.0);
  vec4 vb = modelViewMatrix * vec4(iDrop.xyz - vec3(0.0, 0.0, 0.5), 1.0);
  float nz = -uNear;
  vAlpha = iDrop.w;
  if (va.z > nz && vb.z > nz) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  if (va.z > nz) va = mix(vb, va, (nz - vb.z) / (va.z - vb.z));
  if (vb.z > nz) vb = mix(va, vb, (nz - va.z) / (vb.z - va.z));
  vec4 ca = projectionMatrix * va;
  vec4 cb = projectionMatrix * vb;
  vec2 d = (cb.xy / cb.w - ca.xy / ca.w) * uResolution;
  float len = length(d);
  vec2 n = len > 1e-4 ? vec2(-d.y, d.x) / len : vec2(1.0, 0.0);
  vec4 c = position.y < 0.5 ? ca : cb;
  c.xy += n * position.x * (uWidth / uResolution) * c.w;
  gl_Position = c;
}
`;

const RAIN_FRAG = /* glsl */ `
varying float vAlpha;
void main() {
  gl_FragColor = vec4(0.25, 0.7, 0.3, clamp(vAlpha, 0.0, 1.0));
}
`;

const MAX_RAIN = 100;

export class CRain extends CWeather {
  /** SRain rains[100] (top of each drop) */
  readonly rains: Vec3[] = [];
  private readonly lastRains: Vec3[] = [];
  nextRain = 0;
  private readonly data = new Float32Array(MAX_RAIN * 4);
  private readonly attr: THREE.InstancedBufferAttribute;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    super();
    this.object.name = 'rain';
    for (let i = 0; i < MAX_RAIN; i++) {
      this.rains.push(new Vec3());
      this.lastRains.push(new Vec3());
    }
    const g = new THREE.InstancedBufferGeometry();
    // x = side (-1/+1), y = 0 top / 1 bottom
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.attr = new THREE.InstancedBufferAttribute(this.data, 4);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iDrop', this.attr);
    g.instanceCount = 0;
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      uniforms: {
        uResolution: { value: new THREE.Vector2(1280, 720) },
        uWidth: { value: 2 },
        uNear: { value: 0.1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending, // SRC_ALPHA, ONE_MINUS_SRC_ALPHA
      side: THREE.DoubleSide,
      fog: false,
    });
    const mesh = new THREE.Mesh(g, this.material);
    mesh.frustumCulled = false;
    mesh.renderOrder = WEATHER_RENDER_ORDER;
    const size = new THREE.Vector2();
    mesh.onBeforeRender = (renderer) => {
      renderer.getDrawingBufferSize(size);
      this.material.uniforms.uResolution.value.copy(size);
      // glLineWidth(2) at the original's typical 768 lines, scaled with the resolution.
      this.material.uniforms.uWidth.value = Math.max(1, (2 * size.y) / 768);
    };
    this.object.add(mesh);
    this.startLoop('/assets/sounds/rain2.wav', 50);
  }

  override update(delay: number, camPos: Vec3): void {
    super.update(delay, camPos);
    // On crée la pluie
    for (let i = 0; i < 3; ++i) {
      const r = this.rains[this.nextRain];
      r.set(randRange(camPos.x - 3, camPos.x + 3), randRange(camPos.y - 3, camPos.y + 3), camPos.z + 5);
      this.lastRains[this.nextRain].copy(r);
      this.nextRain++;
      if (this.nextRain === MAX_RAIN) this.nextRain = 0;
    }
    // On anime la pluie (SRain::update)
    for (let i = 0; i < MAX_RAIN; ++i) {
      const r = this.rains[i];
      this.lastRains[i].copy(r);
      if (r.z > 0) r.z -= 15 * delay;
    }
  }

  override render(camera: THREE.Camera, alpha = 1): void {
    const pc = camera as THREE.PerspectiveCamera;
    this.material.uniforms.uNear.value = (pc.isPerspectiveCamera ? pc.near : 0.1) * 1.01;
    let n = 0;
    const d = this.data;
    for (let i = 0; i < MAX_RAIN; ++i) {
      const r = this.rains[i];
      if (!(r.z > 0)) continue;
      const l = this.lastRains[i];
      const z = l.z + (r.z - l.z) * alpha;
      const o = n * 4;
      d[o] = l.x + (r.x - l.x) * alpha;
      d[o + 1] = l.y + (r.y - l.y) * alpha;
      d[o + 2] = z;
      d[o + 3] = ((z > 2 ? 2 : z) / 2) * 0.3;
      n++;
    }
    this.attr.clearUpdateRanges();
    if (n > 0) {
      this.attr.addUpdateRange(0, n * 4);
      this.attr.needsUpdate = true;
    }
    this.geometry.instanceCount = n;
    this.object.visible = n > 0;
  }

  override dispose(): void {
    super.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// CSnow
// ---------------------------------------------------------------------------------------------

export class CSnow extends CWeather {
  /** SSnow rains[100] */
  readonly rains: Vec3[] = [];
  private readonly lastRains: Vec3[] = [];
  nextRain = 0;
  nextIn = 0;
  readonly tex_snow: FxTexture;
  private readonly batch: QuadBatch;

  constructor(textures: FxTextureArray) {
    super();
    this.object.name = 'snow';
    for (let i = 0; i < MAX_RAIN; i++) {
      this.rains.push(new Vec3());
      this.lastRains.push(new Vec3());
    }
    this.tex_snow = textures.get('main/textures/snowflake.tga');
    this.batch = new QuadBatch(textures, { renderOrder: WEATHER_RENDER_ORDER, name: 'snow', initialCapacity: MAX_RAIN });
    this.object.add(this.batch.mesh);
    this.startLoop('/assets/sounds/wind.wav', 50);
  }

  override update(delay: number, camPos: Vec3): void {
    super.update(delay, camPos);
    --this.nextIn;
    // On crée la neige
    if (this.nextIn <= 0) {
      this.nextIn = 3;
      const r = this.rains[this.nextRain];
      r.set(randRange(camPos.x - 3, camPos.x + 3), randRange(camPos.y - 3, camPos.y + 3), camPos.z - 2);
      this.lastRains[this.nextRain].copy(r);
      this.nextRain++;
      if (this.nextRain === MAX_RAIN) this.nextRain = 0;
    }
    // SSnow::update
    for (let i = 0; i < MAX_RAIN; ++i) {
      const r = this.rains[i];
      this.lastRains[i].copy(r);
      if (r.z > 0) {
        r.z -= 2 * delay;
        r.x += randRange(-1, 1) * delay;
        r.y += randRange(-1, 1) * delay;
      }
    }
  }

  override render(_camera: THREE.Camera, alpha = 1): void {
    const b = this.batch;
    b.begin();
    for (let i = 0; i < MAX_RAIN; ++i) {
      const r = this.rains[i];
      if (!(r.z > 0)) continue;
      const l = this.lastRains[i];
      const z = l.z + (r.z - l.z) * alpha;
      // SSnow::render: flat quad ±.05, colour (1,1,1, min(z,2)/2)
      b.push(l.x + (r.x - l.x) * alpha, l.y + (r.y - l.y) * alpha, z, 0.05, 0, 0, 0, 0.05, 0, 1, 1, 1, (z > 2 ? 2 : z) / 2, this.tex_snow, 1, DKP_SRC_ALPHA, DKP_ONE_MINUS_SRC_ALPHA);
    }
    b.end();
  }

  override dispose(): void {
    super.dispose();
    this.batch.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// CLava (ambient sound only)
// ---------------------------------------------------------------------------------------------

export class CLava extends CWeather {
  constructor() {
    super();
    this.object.name = 'lava';
    this.startLoop('/assets/sounds/lava.wav', 50);
  }
}

/**
 * Map::reloadWeather: CRain for WEATHER_RAIN, CSnow for WEATHER_SNOW, CLava for WEATHER_LAVA,
 * nothing otherwise (fog / sandstorm have no weather object). The object is added to `parent`.
 */
export function createWeather(weatherType: number, textures: FxTextureArray, parent: THREE.Object3D | null = null): CWeather | null {
  let w: CWeather | null = null;
  if (weatherType === WEATHER_RAIN) w = new CRain();
  else if (weatherType === WEATHER_SNOW) w = new CSnow(textures);
  else if (weatherType === WEATHER_LAVA) w = new CLava();
  if (w && parent) parent.add(w.object);
  return w;
}
