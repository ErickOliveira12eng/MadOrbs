// Shared texture array for every effect quad (particles, trails, floor marks, drips, nuke flash, snow).
//
// The original bound one GL texture per particle (dkp.cpp / CParticle::render). To draw thousands
// of particles in a single call while keeping their exact original order, every effect texture is
// copied into one layer of a THREE.DataArrayTexture and each quad carries its layer index.
// Layers are FX_LAYER_SIZE² RGBA; smaller source images are bilinearly up-sampled with GL_REPEAT
// wrapping (what the GPU would do when magnifying them anyway), raw texel values are kept
// (no colour-space conversion, like the original).
import * as THREE from 'three';
import { loadTextureAsync } from '../engine/textures';

export const FX_LAYER_SIZE = 128;

/** Handle of an effect texture = layer index in the shared array (stands for the GL texture id). */
export type FxTexture = number;

type RawImage = { data: ArrayLike<number> | null; width: number; height: number };

/** Waits until a texture returned by the shared loader actually has pixel data. */
function waitForImage(tex: THREE.Texture, timeoutMs = 20000): Promise<RawImage | null> {
  const start = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      // TGA textures keep their top-down rows in userData (engine/textures.ts normalizes the upload).
      const td = tex.userData.topDown as RawImage | undefined;
      if (td && td.data && td.width > 0) {
        resolve(td);
        return;
      }
      const img = tex.image as RawImage | HTMLImageElement | ImageBitmap | HTMLCanvasElement | undefined;
      if (img && 'data' in img && img.data && img.width > 0) {
        resolve(img as RawImage);
        return;
      }
      if (img && !('data' in img) && img.width > 0) {
        // HTML image (png/jpg): read it back through a canvas (only used for non-TGA files).
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(img as CanvasImageSource, 0, 0);
        const d = ctx.getImageData(0, 0, img.width, img.height);
        resolve({ data: d.data, width: img.width, height: img.height });
        return;
      }
      if (performance.now() - start > timeoutMs) return resolve(null);
      setTimeout(check, 30);
    };
    check();
  });
}

export class FxTextureArray {
  /** Shared uniform: every effect material points at this object, so growing the array is transparent. */
  readonly uniform: { value: THREE.DataArrayTexture };
  private data: Uint8Array<ArrayBuffer>;
  private capacity: number;
  private readonly layers = new Map<string, FxTexture>();
  private readonly ready = new Set<FxTexture>();
  private count = 0;

  constructor(capacity = 24) {
    this.capacity = capacity;
    this.data = new Uint8Array(FX_LAYER_SIZE * FX_LAYER_SIZE * 4 * capacity);
    this.uniform = { value: this.makeTexture() };
  }

  get texture(): THREE.DataArrayTexture {
    return this.uniform.value;
  }

  private makeTexture(): THREE.DataArrayTexture {
    const t = new THREE.DataArrayTexture(this.data, FX_LAYER_SIZE, FX_LAYER_SIZE, this.capacity);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.colorSpace = THREE.NoColorSpace;
    t.wrapS = THREE.RepeatWrapping; // GL_REPEAT (dkt default) - trails tile their texture along v
    t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.flipY = false;
    t.unpackAlignment = 4;
    t.needsUpdate = true;
    return t;
  }

  private grow(): void {
    const old = this.uniform.value;
    this.capacity *= 2;
    const data = new Uint8Array(FX_LAYER_SIZE * FX_LAYER_SIZE * 4 * this.capacity);
    data.set(this.data);
    this.data = data;
    this.uniform.value = this.makeTexture();
    old.dispose();
  }

  /** Returns the layer of `path` (original-style path, e.g. "main/textures/Smoke1.tga"), loading it once. */
  get(path: string): FxTexture {
    const hit = this.layers.get(path);
    if (hit !== undefined) return hit;
    if (this.count >= this.capacity) this.grow();
    const layer = this.count++;
    this.layers.set(path, layer);
    void loadTextureAsync(path)
      .then((tex) => waitForImage(tex))
      .then((img) => {
        if (!img || !img.data) {
          console.warn('fx texture has no data', path);
          return;
        }
        this.writeLayer(layer, img);
      })
      .catch((e) => console.warn('fx texture load failed', path, e));
    return layer;
  }

  /** True once the layer's pixels are uploaded (used by the dev page only). */
  isReady(layer: FxTexture): boolean {
    return this.ready.has(layer);
  }

  get layerCount(): number {
    return this.count;
  }

  /**
   * Copies `img` (top row first, as produced by TGALoader) into `layer`, flipped so that v=0 is the
   * bottom row like the original OpenGL upload, bilinear re-sampled to FX_LAYER_SIZE with wrapping.
   */
  private writeLayer(layer: FxTexture, img: RawImage): void {
    const S = FX_LAYER_SIZE;
    const { width: w, height: h } = img;
    const src = img.data as ArrayLike<number>;
    const out = this.data;
    const base = layer * S * S * 4;
    const sx = w / S;
    const sy = h / S;
    for (let y = 0; y < S; y++) {
      // Destination row y counts from the bottom (v = (y+.5)/S); source rows count from the top.
      const fy = (y + 0.5) * sy - 0.5;
      const y0f = Math.floor(fy);
      const ty = fy - y0f;
      const ya = h - 1 - (((y0f % h) + h) % h);
      const yb = h - 1 - ((((y0f + 1) % h) + h) % h);
      for (let x = 0; x < S; x++) {
        const fx = (x + 0.5) * sx - 0.5;
        const x0f = Math.floor(fx);
        const tx = fx - x0f;
        const xa = ((x0f % w) + w) % w;
        const xb = (((x0f + 1) % w) + w) % w;
        const i00 = (ya * w + xa) * 4;
        const i10 = (ya * w + xb) * 4;
        const i01 = (yb * w + xa) * 4;
        const i11 = (yb * w + xb) * 4;
        const o = base + (y * S + x) * 4;
        for (let c = 0; c < 4; c++) {
          const top = src[i00 + c] * (1 - tx) + src[i10 + c] * tx;
          const bot = src[i01 + c] * (1 - tx) + src[i11 + c] * tx;
          out[o + c] = Math.round(top * (1 - ty) + bot * ty);
        }
      }
    }
    this.ready.add(layer);
    this.uniform.value.needsUpdate = true;
  }

  dispose(): void {
    this.uniform.value.dispose();
  }
}
