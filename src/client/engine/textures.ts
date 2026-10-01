// Shared texture cache. Original assets are TGA files under /assets (public/assets).
import * as THREE from 'three';
import { TGALoader } from 'three/examples/jsm/loaders/TGALoader.js';

const tgaLoader = new TGALoader();
const imgLoader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();
const pending = new Map<string, Promise<THREE.Texture>>();

export const ASSET_ROOT = '/assets/';

/** Resolve a path as written in the original code ("main/textures/Smoke2.tga") to a served URL. */
export function assetUrl(path: string): string {
  let p = path.replace(/\\/g, '/');
  if (p.startsWith('/assets/')) return p;
  if (p.startsWith('main/')) p = p.slice(5);
  return ASSET_ROOT + p;
}

export interface TextureOptions {
  /** GL_CLAMP instead of GL_REPEAT. */
  clamp?: boolean;
  /** Disable mipmaps / use nearest filtering (fonts, UI). */
  nearest?: boolean;
}

/** Pixel rows ordered from the top of the image down (what TGALoader decodes). */
export interface TopDownImage {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * TGALoader returns top-down rows with `flipY = true`. Uploading a DataTexture with flipY and
 * then generating mipmaps makes small textures sample as transparent on some WebGL
 * implementations, so the rows are flipped here once (bottom row first, like the original raw
 * GL upload) and flipY is turned off. The top-down pixels stay available via `topDownPixels()`.
 */
function normalizeOrientation(tex: THREE.Texture): void {
  const dt = tex as THREE.DataTexture;
  const img = tex.image as TopDownImage | null | undefined;
  if (!dt.isDataTexture || !tex.flipY || !img || !img.data || !img.width || !img.height) return;
  const { data, width, height } = img;
  const row = (data.length / height) | 0;
  const flipped = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) flipped.set(data.subarray(y * row, (y + 1) * row), (height - 1 - y) * row);
  tex.userData.topDown = { data, width, height } satisfies TopDownImage;
  tex.image = { data: flipped, width, height };
  tex.flipY = false;
}

/** Pixels of a loaded texture, rows from the top of the image down. */
export function topDownPixels(tex: THREE.Texture): TopDownImage | null {
  const td = tex.userData.topDown as TopDownImage | undefined;
  if (td) return td;
  const img = tex.image as TopDownImage | null | undefined;
  return img && img.data ? img : null;
}

function configure(tex: THREE.Texture, opts: TextureOptions): void {
  normalizeOrientation(tex);
  // Raw texel values like the original GL renderer (see engine/renderer.ts).
  tex.colorSpace = THREE.NoColorSpace;
  const wrap = opts.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  tex.wrapS = wrap;
  tex.wrapT = wrap;
  if (opts.nearest) {
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
  } else {
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 4;
  }
  // Only upload once the pixels exist (a DataTexture placeholder has width 1 but no data).
  const img = tex.image as { width?: number; data?: unknown } | null | undefined;
  const hasPixels = !!img && ('data' in img ? !!img.data : (img.width ?? 0) > 0);
  if (hasPixels) tex.needsUpdate = true;
}

function key(url: string, opts: TextureOptions): string {
  return `${url}|${opts.clamp ? 'c' : 'r'}|${opts.nearest ? 'n' : 'l'}`;
}

/**
 * Returns a texture immediately (it fills in when loaded). TGA images are decoded by three's
 * TGALoader, which already flips them so that UV (0,0) is the bottom-left like OpenGL.
 */
export function loadTexture(path: string, opts: TextureOptions = {}): THREE.Texture {
  const url = assetUrl(path);
  const k = key(url, opts);
  const hit = cache.get(k);
  if (hit) return hit;
  const loader = url.toLowerCase().endsWith('.tga') ? tgaLoader : imgLoader;
  const tex = loader.load(
    url,
    (t) => configure(t, opts),
    undefined,
    (err) => console.warn('texture load failed', url, err),
  );
  configure(tex, opts);
  cache.set(k, tex);
  return tex;
}

/** Same as loadTexture but resolves once the image data is available. */
export function loadTextureAsync(path: string, opts: TextureOptions = {}): Promise<THREE.Texture> {
  const url = assetUrl(path);
  const k = key(url, opts);
  const hit = cache.get(k);
  if (hit && hit.image) return Promise.resolve(hit);
  let p = pending.get(k);
  if (p) return p;
  const loader = url.toLowerCase().endsWith('.tga') ? tgaLoader : imgLoader;
  p = loader.loadAsync(url).then((t) => {
    configure(t, opts);
    cache.set(k, t);
    return t;
  });
  pending.set(k, p);
  return p;
}
