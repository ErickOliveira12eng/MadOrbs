// Immediate-mode 2D renderer for what is still drawn in WebGL over the 3D view (the sniper scope
// and the red flash when hit); the HUD itself is HTML (src/client/hud).
//
// The original draws its UI with OpenGL 1.x immediate mode inside `dkglPushOrtho(w, h)`
// (Engine/DukZeven/Code/dkgl.cpp: glOrtho(0, w, h, 0) — y points down, origin top-left), with
// GL_BLEND (SRC_ALPHA, ONE_MINUS_SRC_ALPHA), GL_MODULATE texturing and glColor as the current colour.
// This class reproduces that model on top of three.js: every quad is appended to one dynamic
// buffer; consecutive quads that share a texture/blend mode become one draw group. `flush()`
// renders everything with a single mesh (one group per batch, drawn in submission order).
//
// Two coordinate spaces are supported through `ortho()`:
//  - the virtual 800x600 space (`dkglPushOrtho(800, 600)`) stretched to the viewport;
//  - the real pixel space of the viewport (`dkglPushOrtho(res[0], res[1])`).
// The viewport is the whole canvas, or the centred rectangle of ratio `aspect` (the game view).

import * as THREE from 'three';

export type BlendMode = 'alpha' | 'add';
export type RGBA = [number, number, number, number];

const VERT = /* glsl */ `
in vec2 position;
in vec2 uv;
in vec4 color;
out vec2 vUv;
out vec4 vColor;
void main() {
  vUv = uv;
  vColor = color;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

// GL_MODULATE: fragment = vertex colour * texel (an untextured quad samples a 1x1 white texture).
const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D map;
in vec2 vUv;
in vec4 vColor;
out highp vec4 fragColor;
void main() {
  fragColor = vColor * texture(map, vUv);
}`;

interface Batch {
  tex: THREE.Texture;
  blend: BlendMode;
  firstQuad: number;
  quadCount: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** True once a texture has pixel data (textures from the async loaders start empty). */
export function isTextureReady(tex: THREE.Texture): boolean {
  const img = tex.image as { data?: unknown; width?: number } | null | undefined;
  if (!img) return false;
  if ('data' in img) return img.data != null;
  return (img.width ?? 0) > 0;
}

export class Draw2D {
  // ---- viewport (CSS pixels of the canvas) ----
  canvasW = 800;
  canvasH = 600;
  /** Rectangle of the canvas the UI maps to (the whole canvas unless `aspect` is set). */
  vpX = 0;
  vpY = 0;
  vpW = 800;
  vpH = 600;
  /** Aspect ratio of the viewport, centred with bars (null: stretch to the whole canvas). */
  aspect: number | null = null;

  // ---- GL-like state ----
  private cr = 1;
  private cg = 1;
  private cb = 1;
  private ca = 1;
  private orthoW = 800;
  private orthoH = 600;
  private ax = 0;
  private bx = 0;
  private ay = 0;
  private by = 0;
  blend: BlendMode = 'alpha';

  // ---- geometry ----
  private capacity = 0; // in quads
  private pos!: Float32Array;
  private uvs!: Float32Array;
  private cols!: Float32Array;
  private quadCount = 0;
  private batches: Batch[] = [];
  private geometry: THREE.BufferGeometry | null = null;
  private readonly mesh: THREE.Mesh;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly materials = new Map<THREE.Texture, Map<BlendMode, THREE.RawShaderMaterial>>();
  readonly white: THREE.DataTexture;

  constructor() {
    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    this.white.needsUpdate = true;
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), []);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.scene.add(this.mesh);
    this.scene.matrixWorldAutoUpdate = false;
    this.grow(4096);
  }

  // =====================================================================================
  // Frame
  // =====================================================================================

  /** Starts a frame for a canvas of `w` x `h` CSS pixels. */
  begin(w: number, h: number): void {
    this.canvasW = Math.max(1, w);
    this.canvasH = Math.max(1, h);
    const ratio = this.aspect;
    if (ratio) {
      if (this.canvasW / this.canvasH >= ratio) {
        this.vpH = this.canvasH;
        this.vpW = this.canvasH * ratio;
      } else {
        this.vpW = this.canvasW;
        this.vpH = this.canvasW / ratio;
      }
      this.vpX = (this.canvasW - this.vpW) / 2;
      this.vpY = (this.canvasH - this.vpH) / 2;
    } else {
      this.vpX = 0;
      this.vpY = 0;
      this.vpW = this.canvasW;
      this.vpH = this.canvasH;
    }
    this.quadCount = 0;
    this.batches.length = 0;
    this.blend = 'alpha';
    this.color(1, 1, 1, 1);
    this.ortho(800, 600);
  }

  /** "res" of the pixel-space ortho: the viewport size. */
  get resX(): number {
    return this.vpW;
  }
  get resY(): number {
    return this.vpH;
  }

  /** dkglPushOrtho(w, h): subsequent coordinates are in a w x h space mapped onto the viewport. */
  ortho(w: number, h: number): void {
    this.orthoW = w;
    this.orthoH = h;
    this.ax = ((this.vpW / w) * 2) / this.canvasW;
    this.bx = (this.vpX * 2) / this.canvasW - 1;
    this.ay = -((this.vpH / h) * 2) / this.canvasH;
    this.by = 1 - (this.vpY * 2) / this.canvasH;
  }
  /** dkglPushOrtho(800, 600). */
  ortho800(): void {
    this.ortho(800, 600);
  }
  /** dkglPushOrtho(res[0], res[1]) — real pixels. */
  orthoPixels(): void {
    this.ortho(this.vpW, this.vpH);
  }
  get orthoWidth(): number {
    return this.orthoW;
  }
  get orthoHeight(): number {
    return this.orthoH;
  }

  /** Converts canvas CSS pixel coordinates to the virtual 800x600 space (`xM`, `yM` in the original). */
  canvasTo800(x: number, y: number): { x: number; y: number } {
    return { x: ((x - this.vpX) / this.vpW) * 800, y: ((y - this.vpY) / this.vpH) * 600 };
  }
  /** Converts canvas CSS pixel coordinates to the pixel-space ortho (subtracts the bars offset). */
  canvasToPixels(x: number, y: number): { x: number; y: number } {
    return { x: x - this.vpX, y: y - this.vpY };
  }

  // =====================================================================================
  // Colour state (glColor)
  // =====================================================================================

  /** glColor4f. */
  color(r: number, g: number, b: number, a = 1): void {
    this.cr = r;
    this.cg = g;
    this.cb = b;
    this.ca = a;
  }
  /** glColor3f — note that it also sets alpha to 1, like OpenGL. */
  color3(r: number, g: number, b: number): void {
    this.color(r, g, b, 1);
  }
  /** glGetFloatv(GL_CURRENT_COLOR). */
  getColor(): RGBA {
    return [this.cr, this.cg, this.cb, this.ca];
  }
  setColor(c: readonly number[]): void {
    this.color(c[0], c[1], c[2], c[3] ?? 1);
  }

  // =====================================================================================
  // Primitives
  // =====================================================================================

  /**
   * Generic GL_QUADS quad. Points are given in GL order (v0..v3). `uv` is 8 numbers (u,v per vertex,
   * OpenGL convention: v=1 is the top of the image). `colors` are 4 RGBA colours (default: current).
   */
  quad(
    tex: THREE.Texture | null,
    x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number,
    uv?: ArrayLike<number> | null,
    colors?: readonly (readonly number[])[] | null,
  ): void {
    const t = tex ?? this.white;
    // A texture that is still loading draws nothing (and must not be uploaded empty).
    if (tex && tex !== this.white && !isTextureReady(tex)) return;
    if (this.quadCount >= this.capacity) this.grow(this.capacity * 2);
    const last = this.batches.length > 0 ? this.batches[this.batches.length - 1] : null;
    if (last && last.tex === t && last.blend === this.blend) last.quadCount++;
    else this.batches.push({ tex: t, blend: this.blend, firstQuad: this.quadCount, quadCount: 1 });

    const q = this.quadCount++;
    const p = this.pos;
    const o = q * 8;
    const ax = this.ax, bx = this.bx, ay = this.ay, by = this.by;
    p[o] = x0 * ax + bx; p[o + 1] = y0 * ay + by;
    p[o + 2] = x1 * ax + bx; p[o + 3] = y1 * ay + by;
    p[o + 4] = x2 * ax + bx; p[o + 5] = y2 * ay + by;
    p[o + 6] = x3 * ax + bx; p[o + 7] = y3 * ay + by;
    const u = this.uvs;
    if (uv) {
      for (let i = 0; i < 8; i++) u[o + i] = uv[i];
    } else {
      u[o] = 0; u[o + 1] = 1; u[o + 2] = 0; u[o + 3] = 0; u[o + 4] = 1; u[o + 5] = 0; u[o + 6] = 1; u[o + 7] = 1;
    }
    const c = this.cols;
    const oc = q * 16;
    for (let i = 0; i < 4; i++) {
      const src = colors ? colors[i] : null;
      // Colours are clamped per vertex like the fixed-function pipeline.
      c[oc + i * 4] = clamp01(src ? src[0] : this.cr);
      c[oc + i * 4 + 1] = clamp01(src ? src[1] : this.cg);
      c[oc + i * 4 + 2] = clamp01(src ? src[2] : this.cb);
      c[oc + i * 4 + 3] = clamp01(src ? (src[3] ?? 1) : this.ca);
    }
  }

  /** Axis-aligned untextured rectangle with the current colour (GL_QUADS (x,y)..(x+w,y+h)). */
  fillRect(x: number, y: number, w: number, h: number): void {
    this.quad(null, x, y, x, y + h, x + w, y + h, x + w, y);
  }
  /** Rectangle from two corners (the way most HUD code writes its glVertex2f calls). */
  fillBox(x0: number, y0: number, x1: number, y1: number): void {
    this.quad(null, x0, y0, x0, y1, x1, y1, x1, y0);
  }
  /** Untextured rectangle with per-corner colours, in the original vertex order: TL, BL, BR, TR. */
  fillRectColors(
    x: number, y: number, w: number, h: number,
    tl: readonly number[], bl: readonly number[], br: readonly number[], tr: readonly number[],
  ): void {
    this.quad(null, x, y, x, y + h, x + w, y + h, x + w, y, null, [tl, bl, br, tr]);
  }

  /** Helper.cpp renderTexturedQuad(x, y, w, h, texture) — texture null == texture 0 (solid colour). */
  renderTexturedQuad(x: number, y: number, w: number, h: number, tex: THREE.Texture | null): void {
    // glTexCoord2i(0,1) (x,y); (0,0) (x,y+h); (1,0) (x+w,y+h); (1,1) (x+w,y)
    this.quad(tex, x, y, x, y + h, x + w, y + h, x + w, y);
  }

  /** Textured quad centred on (cx, cy) with half extents (hw, hh) — the HUD icons (glScalef + (-1..1) quad). */
  texturedQuadCentered(cx: number, cy: number, hw: number, hh: number, tex: THREE.Texture | null): void {
    this.quad(tex, cx - hw, cy - hh, cx - hw, cy + hh, cx + hw, cy + hh, cx + hw, cy - hh);
  }

  /**
   * Outline rectangle (glPolygonMode(GL_LINE) + glLineWidth(px)). The line width is in real
   * pixels, like glLineWidth, whatever the current ortho scale.
   */
  strokeBox(x0: number, y0: number, x1: number, y1: number, linePx: number): void {
    const tx = (linePx / 2) * (this.orthoW / this.vpW);
    const ty = (linePx / 2) * (this.orthoH / this.vpH);
    this.fillBox(x0 - tx, y0 - ty, x1 + tx, y0 + ty); // top
    this.fillBox(x0 - tx, y1 - ty, x1 + tx, y1 + ty); // bottom
    this.fillBox(x0 - tx, y0 + ty, x0 + tx, y1 - ty); // left
    this.fillBox(x1 - tx, y0 + ty, x1 + tx, y1 - ty); // right
  }

  // =====================================================================================
  // Rendering
  // =====================================================================================

  private grow(quads: number): void {
    const old = this.capacity;
    const pos = new Float32Array(quads * 8);
    const uvs = new Float32Array(quads * 8);
    const cols = new Float32Array(quads * 16);
    if (old > 0) {
      pos.set(this.pos);
      uvs.set(this.uvs);
      cols.set(this.cols);
    }
    this.pos = pos;
    this.uvs = uvs;
    this.cols = cols;
    this.capacity = quads;

    const index = new Uint32Array(quads * 6);
    for (let q = 0; q < quads; q++) {
      const v = q * 4;
      const i = q * 6;
      index[i] = v;
      index[i + 1] = v + 1;
      index[i + 2] = v + 2;
      index[i + 3] = v;
      index[i + 4] = v + 2;
      index[i + 5] = v + 3;
    }
    const g = new THREE.BufferGeometry();
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.setAttribute('position', new THREE.BufferAttribute(pos, 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(cols, 4).setUsage(THREE.DynamicDrawUsage));
    if (this.geometry) this.geometry.dispose();
    this.geometry = g;
    if (this.mesh) this.mesh.geometry = g;
  }

  private material(tex: THREE.Texture, blend: BlendMode): THREE.RawShaderMaterial {
    let byBlend = this.materials.get(tex);
    if (!byBlend) {
      byBlend = new Map();
      this.materials.set(tex, byBlend);
    }
    let m = byBlend.get(blend);
    if (!m) {
      m = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { map: { value: tex } },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: blend === 'add' ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
      });
      byBlend.set(blend, m);
    }
    return m;
  }

  /**
   * Draws everything submitted since `begin()` on top of what is already in the framebuffer.
   * Saves/restores renderer.autoClear, sortObjects and the viewport.
   */
  flush(renderer: THREE.WebGLRenderer): void {
    const g = this.geometry!;
    const n = this.quadCount;
    if (n === 0) return;
    const pa = g.getAttribute('position') as THREE.BufferAttribute;
    const ua = g.getAttribute('uv') as THREE.BufferAttribute;
    const ca = g.getAttribute('color') as THREE.BufferAttribute;
    for (const [a, size] of [[pa, 8], [ua, 8], [ca, 16]] as const) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * size);
      a.needsUpdate = true;
    }
    g.clearGroups();
    const mats: THREE.Material[] = [];
    const matIndex = new Map<THREE.Material, number>();
    for (const b of this.batches) {
      const m = this.material(b.tex, b.blend);
      let idx = matIndex.get(m);
      if (idx === undefined) {
        idx = mats.length;
        mats.push(m);
        matIndex.set(m, idx);
      }
      g.addGroup(b.firstQuad * 6, b.quadCount * 6, idx);
    }
    this.mesh.material = mats;
    g.setDrawRange(0, n * 6);

    const autoClear = renderer.autoClear;
    const sortObjects = renderer.sortObjects;
    const vp = renderer.getViewport(new THREE.Vector4());
    const size = renderer.getSize(new THREE.Vector2());
    renderer.autoClear = false;
    renderer.sortObjects = false; // keep submission order (painter's algorithm)
    renderer.setViewport(0, 0, size.x, size.y);
    renderer.render(this.scene, this.camera);
    renderer.setViewport(vp);
    renderer.autoClear = autoClear;
    renderer.sortObjects = sortObjects;
  }

  dispose(): void {
    this.geometry?.dispose();
    for (const byBlend of this.materials.values()) for (const m of byBlend.values()) m.dispose();
    this.materials.clear();
    this.white.dispose();
  }
}
