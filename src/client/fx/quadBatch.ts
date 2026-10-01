// Instanced textured quads used by every effect (particles, trails, floor marks, drips, nuke flash,
// snow). One quad = centre + two half-extent axes (world space), so billboards, ground decals and
// trail ribbons all share one shader and one draw call per batch.
//
// Blending: the original used glBlendFunc(src, dst) per particle (CParticle::render). The two modes
// the game really uses, (SRC_ALPHA, ONE_MINUS_SRC_ALPHA) and (SRC_ALPHA, ONE), and every other
// combination of src ∈ {ZERO, ONE, SRC_ALPHA} × dst ∈ {ZERO, ONE, ONE_MINUS_SRC_ALPHA}, can be
// expressed exactly with a single premultiplied blend func (ONE, ONE_MINUS_SRC_ALPHA):
//   rgb_out = colour * srcFactor, alpha_out = 1 - dstFactor.
// So a "premultiplied" batch renders mixed blend modes in their exact original order. Any other
// GL blend pair goes to a "straight" batch that uses THREE.CustomBlending with the real factors.
import * as THREE from 'three';
import type { FxTextureArray, FxTexture } from './fxTextures';

// GL blending factors (dkp.h DKP_* == GL_* values)
export const DKP_ZERO = 0;
export const DKP_ONE = 1;
export const DKP_SRC_COLOR = 0x0300;
export const DKP_ONE_MINUS_SRC_COLOR = 0x0301;
export const DKP_SRC_ALPHA = 0x0302;
export const DKP_ONE_MINUS_SRC_ALPHA = 0x0303;
export const DKP_DST_ALPHA = 0x0304;
export const DKP_ONE_MINUS_DST_ALPHA = 0x0305;
export const DKP_DST_COLOR = 0x0306;
export const DKP_ONE_MINUS_DST_COLOR = 0x0307;
export const DKP_SRC_ALPHA_SATURATE = 0x0308;

/** Maps a GL blend constant to the three.js blending factor. */
export function glBlendToThree(f: number): THREE.BlendingSrcFactor {
  switch (f) {
    case DKP_ZERO: return THREE.ZeroFactor;
    case DKP_ONE: return THREE.OneFactor;
    case DKP_SRC_COLOR: return THREE.SrcColorFactor;
    case DKP_ONE_MINUS_SRC_COLOR: return THREE.OneMinusSrcColorFactor;
    case DKP_SRC_ALPHA: return THREE.SrcAlphaFactor;
    case DKP_ONE_MINUS_SRC_ALPHA: return THREE.OneMinusSrcAlphaFactor;
    case DKP_DST_ALPHA: return THREE.DstAlphaFactor;
    case DKP_ONE_MINUS_DST_ALPHA: return THREE.OneMinusDstAlphaFactor;
    case DKP_DST_COLOR: return THREE.DstColorFactor;
    case DKP_ONE_MINUS_DST_COLOR: return THREE.OneMinusDstColorFactor;
    case DKP_SRC_ALPHA_SATURATE: return THREE.SrcAlphaSaturateFactor;
    default: return THREE.OneFactor;
  }
}

/** Premultiplied src mode: 0 = ZERO, 1 = ONE, 2 = SRC_ALPHA, -1 = not expressible. */
export function premulSrcMode(src: number): number {
  return src === DKP_ZERO ? 0 : src === DKP_ONE ? 1 : src === DKP_SRC_ALPHA ? 2 : -1;
}
/** Premultiplied dst mode: 0 = ZERO, 1 = ONE, 2 = ONE_MINUS_SRC_ALPHA, -1 = not expressible. */
export function premulDstMode(dst: number): number {
  return dst === DKP_ZERO ? 0 : dst === DKP_ONE ? 1 : dst === DKP_ONE_MINUS_SRC_ALPHA ? 2 : -1;
}
export function isPremultipliable(src: number, dst: number): boolean {
  return premulSrcMode(src) >= 0 && premulDstMode(dst) >= 0;
}

const VERT = /* glsl */ `
attribute vec3 iCenter;
attribute vec3 iAxisX;
attribute vec3 iAxisY;
attribute vec4 iColor;
attribute vec4 iParams; // layer, vScale, srcMode, dstMode
varying vec2 vUv;
varying vec4 vColor;
flat varying float vLayer;
flat varying vec2 vBlend;
void main() {
  vec3 p = iCenter + iAxisX * position.x + iAxisY * position.y;
  // Corner (-1,-1) -> uv (0,0), (1,1) -> (1,vScale) exactly like the original quads.
  vUv = vec2((position.x + 1.0) * 0.5, (position.y + 1.0) * 0.5 * iParams.y);
  vColor = clamp(iColor, 0.0, 1.0); // glColor4f values are clamped by fixed-function GL
  vLayer = iParams.x;
  vBlend = iParams.zw;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2DArray uMaps;
varying vec2 vUv;
varying vec4 vColor;
flat varying float vLayer;
flat varying vec2 vBlend;
void main() {
  vec4 c = texture(uMaps, vec3(vUv, vLayer)) * vColor; // GL_MODULATE
#ifdef PREMULTIPLIED
  vec3 rgb = vBlend.x < 0.5 ? vec3(0.0) : (vBlend.x < 1.5 ? c.rgb : c.rgb * c.a);
  float a = vBlend.y < 0.5 ? 1.0 : (vBlend.y < 1.5 ? 0.0 : c.a);
  gl_FragColor = vec4(rgb, a);
#else
  gl_FragColor = c;
#endif
}
`;

export interface QuadBatchOptions {
  renderOrder: number;
  depthTest?: boolean;
  /** Straight (non premultiplied) batch with this exact GL blend pair. */
  straightBlend?: { src: number; dst: number };
  initialCapacity?: number;
  name?: string;
}

const FLOATS = 17; // centre 3, axisX 3, axisY 3, colour 4, params 4

export class QuadBatch {
  readonly mesh: THREE.Mesh;
  readonly premultiplied: boolean;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private capacity = 0;
  private buf = new Float32Array(0);
  private interleaved: THREE.InstancedInterleavedBuffer | null = null;
  count = 0;

  constructor(textures: FxTextureArray, opts: QuadBatchOptions) {
    this.premultiplied = !opts.straightBlend;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.geometry = g;
    const m = new THREE.ShaderMaterial({
      name: opts.name ?? 'fxQuads',
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uMaps: textures.uniform },
      defines: this.premultiplied ? { PREMULTIPLIED: 1 } : {},
      transparent: true,
      depthWrite: false, // glDepthMask(GL_FALSE)
      depthTest: opts.depthTest ?? true,
      side: THREE.DoubleSide, // glDisable(GL_CULL_FACE)
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: this.premultiplied ? THREE.OneFactor : glBlendToThree(opts.straightBlend!.src),
      blendDst: this.premultiplied
        ? THREE.OneMinusSrcAlphaFactor
        : (glBlendToThree(opts.straightBlend!.dst) as THREE.BlendingDstFactor),
      fog: false,
    });
    this.material = m;
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.name = opts.name ?? 'fxQuads';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder;
    this.mesh.matrixAutoUpdate = false;
    this.ensureCapacity(opts.initialCapacity ?? 256);
    g.instanceCount = 0;
  }

  private ensureCapacity(n: number): void {
    if (n <= this.capacity) return;
    let cap = Math.max(16, this.capacity);
    while (cap < n) cap *= 2;
    // Growing: release the old GPU buffers (base quad + index are re-uploaded, they are tiny).
    if (this.capacity > 0) this.geometry.dispose();
    const nb = new Float32Array(cap * FLOATS);
    nb.set(this.buf.subarray(0, Math.min(this.buf.length, this.count * FLOATS)));
    this.buf = nb;
    this.capacity = cap;
    const ib = new THREE.InstancedInterleavedBuffer(nb, FLOATS, 1);
    ib.setUsage(THREE.DynamicDrawUsage);
    this.interleaved = ib;
    const g = this.geometry;
    g.setAttribute('iCenter', new THREE.InterleavedBufferAttribute(ib, 3, 0));
    g.setAttribute('iAxisX', new THREE.InterleavedBufferAttribute(ib, 3, 3));
    g.setAttribute('iAxisY', new THREE.InterleavedBufferAttribute(ib, 3, 6));
    g.setAttribute('iColor', new THREE.InterleavedBufferAttribute(ib, 4, 9));
    g.setAttribute('iParams', new THREE.InterleavedBufferAttribute(ib, 4, 13));
  }

  begin(): void {
    this.count = 0;
  }

  /**
   * Adds one quad. Corners are centre ± axisX ± axisY; texture coordinates follow the original
   * quads: (-1,+1)→(0,vScale), (-1,-1)→(0,0), (+1,-1)→(1,0), (+1,+1)→(1,vScale).
   */
  push(
    cx: number, cy: number, cz: number,
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    r: number, g: number, b: number, a: number,
    layer: FxTexture, vScale: number, srcBlend: number, dstBlend: number,
  ): void {
    if (this.count >= this.capacity) this.ensureCapacity(this.count + 1);
    const o = this.count * FLOATS;
    const f = this.buf;
    f[o] = cx; f[o + 1] = cy; f[o + 2] = cz;
    f[o + 3] = ax; f[o + 4] = ay; f[o + 5] = az;
    f[o + 6] = bx; f[o + 7] = by; f[o + 8] = bz;
    f[o + 9] = r; f[o + 10] = g; f[o + 11] = b; f[o + 12] = a;
    f[o + 13] = layer; f[o + 14] = vScale;
    f[o + 15] = this.premultiplied ? premulSrcMode(srcBlend) : 0;
    f[o + 16] = this.premultiplied ? premulDstMode(dstBlend) : 0;
    this.count++;
  }

  end(): void {
    const ib = this.interleaved!;
    ib.clearUpdateRanges();
    if (this.count > 0) {
      ib.addUpdateRange(0, this.count * FLOATS);
      ib.needsUpdate = true;
    }
    this.geometry.instanceCount = this.count;
    this.mesh.visible = this.count > 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
