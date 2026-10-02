// Pictures used by the HTML HUD, made from the game's own files: the weapons (their DKO models
// rendered once in a throwaway WebGL context), the grenade and molotov icons of the original HUD,
// and the players' orbs (their recoloured skin, drawn by the start screen's OrbStudio).
import * as THREE from 'three';
import { PRIMARY_WEAPONS, WEAPON_KNIVES, WEAPON_NUCLEAR, WEAPON_SHIELD } from '../../sim/constants';
import { weaponDefs } from '../../sim/gameVar';
import type { SkinInfo } from '../../sim/player';
import { getModel } from '../assets';
import { createDkoObject3D, disposeDkoObject3D } from '../engine/dko';
import { loadTextureAsync, topDownPixels } from '../engine/textures';
import { isTextureReady } from '../ui/draw2d';

/** Draws an orb with its skin as a PNG data URL (OrbStudio.picture on the start screen). */
export type OrbPictureFn = (skin: SkinInfo, size: number) => Promise<string>;

/** Weapons drawn as SVG: their models only show with additive glows in the game. */
export const SVG_WEAPONS = new Set([WEAPON_KNIVES, WEAPON_SHIELD]);

let weaponArt: Promise<Map<number, string>> | null = null;
let iconArt: Promise<Map<string, string>> | null = null;

/** How far the box's corners reach on screen: 1 = the edge of the view. */
function ndcExtent(box: THREE.Box3, camera: THREE.Camera): number {
  let extent = 0;
  const p = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
    extent = Math.max(extent, Math.abs(p.x), Math.abs(p.y));
  }
  return extent;
}

/** Every weapon picture, rendered once per page (the models are already preloaded). */
function renderWeapons(): Promise<Map<number, string>> {
  weaponArt ??= (async () => {
    const out = new Map<number, string>();
    const W = 360;
    const H = 180;
    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch {
      return out; // no WebGL left: the HUD shows names only
    }
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.95 * Math.PI));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5 * Math.PI);
    scene.add(sun, sun.target);
    const camera = new THREE.PerspectiveCamera(18, W / H, 0.01, 1000);
    camera.up.set(0, 0, 1);

    for (const id of [...PRIMARY_WEAPONS, WEAPON_NUCLEAR]) {
      const def = weaponDefs[id];
      if (!def) continue;
      const obj = createDkoObject3D(getModel(def.model), 0);
      // Slings, harness and ammo belt wrap around the orb: without one they hang in the air
      for (const node of obj.children) if (node.name === 'Strap') node.visible = false;
      const group = new THREE.Group().add(obj);
      scene.add(group);
      group.updateMatrixWorld(true);
      await texturesReady(group);
      // Three-quarter view from the side: the barrel (+y) points right
      const box = new THREE.Box3();
      group.traverseVisible((o) => {
        if ((o as THREE.Mesh).isMesh) box.expandByObject(o);
      });
      const centre = box.getCenter(new THREE.Vector3());
      const radius = box.getSize(new THREE.Vector3()).length() / 2;
      const dir = new THREE.Vector3(1, -0.35, 0.55).normalize();
      // As close as the whole weapon allows, with a small margin (the picture is cropped anyway)
      let dist = radius / Math.sin(THREE.MathUtils.degToRad(18) / 2);
      for (let i = 0; i < 4; i++) {
        camera.position.copy(centre).addScaledVector(dir, dist);
        camera.near = dist / 100;
        camera.far = dist * 10;
        camera.updateProjectionMatrix();
        camera.lookAt(centre);
        camera.updateMatrixWorld();
        dist *= ndcExtent(box, camera) / 0.92;
      }
      camera.position.copy(centre).addScaledVector(dir, dist);
      camera.near = dist / 100;
      camera.far = dist * 10;
      camera.updateProjectionMatrix();
      camera.lookAt(centre);
      sun.position.copy(centre).add(new THREE.Vector3(dir.x * 0.3 - 0.8, dir.y - 0.6, 1.5).multiplyScalar(radius * 4));
      sun.target.position.copy(centre);
      sun.target.updateMatrixWorld();
      renderer.render(scene, camera);
      const url = croppedPng(renderer.domElement);
      if (url) out.set(id, url);
      scene.remove(group);
      disposeDkoObject3D(obj);
    }
    renderer.dispose();
    renderer.forceContextLoss();
    return out;
  })();
  return weaponArt;
}

export type IconName = 'grenade' | 'molotov' | 'blueFlag' | 'redFlag';

/** The original HUD icons (grenades, molotovs, the team flags of ClientRender) as PNG data URLs. */
function loadIcons(): Promise<Map<string, string>> {
  iconArt ??= (async () => {
    const out = new Map<string, string>();
    const files: [IconName, string][] = [['grenade', 'GrenadeIcon'], ['molotov', 'molotovIcon'], ['blueFlag', 'BlueFlag'], ['redFlag', 'RedFlag']];
    for (const [key, file] of files) {
      try {
        const img = topDownPixels(await loadTextureAsync(`main/textures/${file}.tga`));
        if (!img) continue;
        const cv = document.createElement('canvas');
        cv.width = img.width;
        cv.height = img.height;
        const ctx = cv.getContext('2d')!;
        const px = img.data.length / (img.width * img.height);
        const data = ctx.createImageData(img.width, img.height);
        for (let i = 0; i < img.width * img.height; i++) {
          data.data[i * 4] = img.data[i * px];
          data.data[i * 4 + 1] = img.data[i * px + 1];
          data.data[i * 4 + 2] = img.data[i * px + 2];
          data.data[i * 4 + 3] = px === 4 ? img.data[i * px + 3] : 255;
        }
        ctx.putImageData(data, 0, 0);
        out.set(key, cv.toDataURL('image/png'));
      } catch {
        /* the HUD shows the count without the icon */
      }
    }
    return out;
  })();
  return iconArt;
}

/** Waits (a little) for the model's textures, so the picture isn't taken untextured. */
async function texturesReady(root: THREE.Object3D): Promise<void> {
  const maps: THREE.Texture[] = [];
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      const map = (mat as THREE.MeshBasicMaterial).map;
      if (map) maps.push(map);
    }
  });
  const start = performance.now();
  while (maps.some((t) => !isTextureReady(t)) && performance.now() - start < 4000) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** The canvas cropped to its visible pixels, as a PNG data URL. */
function croppedPng(src: HTMLCanvasElement): string | null {
  const cv = document.createElement('canvas');
  cv.width = src.width;
  cv.height = src.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, cv.width, cv.height);
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(cv, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

const skinKey = (s: SkinInfo): string => [s.skin, ...s.redDecal, ...s.greenDecal, ...s.blueDecal].map((v) => (typeof v === 'number' ? v.toFixed(3) : v)).join('|');

export class HudArt {
  private weapons = new Map<number, string>();
  private icons = new Map<string, string>();
  private readonly orbs = new Map<string, string>();
  private readonly pending = new Set<string>();
  private readonly failed = new Set<string>();

  constructor(private readonly orbPicture?: OrbPictureFn) {}

  /** Renders the weapons and loads the icons. */
  async load(): Promise<void> {
    [this.weapons, this.icons] = await Promise.all([renderWeapons(), loadIcons()]);
  }

  weapon(id: number): string | undefined {
    return this.weapons.get(id);
  }

  icon(key: IconName): string | undefined {
    return this.icons.get(key);
  }

  /** The player's orb, or undefined while it is being drawn (ask again on the next frame). */
  orb(skin: SkinInfo): string | undefined {
    const key = skinKey(skin);
    const url = this.orbs.get(key);
    if (url || !this.orbPicture || this.pending.has(key) || this.failed.has(key)) return url;
    this.pending.add(key);
    this.orbPicture(skin, 96)
      .then((u) => this.orbs.set(key, u))
      .catch(() => this.failed.add(key))
      .finally(() => this.pending.delete(key));
    return undefined;
  }
}
