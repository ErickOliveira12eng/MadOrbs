// Preloads the models/textures the game needs synchronously while rendering
// (GameVar::loadModels / loadTextures in the original).
import type * as THREE from 'three';
import { loadDko, type DkoModel } from './engine/dko';
import { loadTextureAsync } from './engine/textures';
import { weaponDefs } from '../sim/gameVar';

export const MODEL_ROCKET = 'main/models/Rocket.DKO';
export const MODEL_GRENADE = 'main/models/Grenade.DKO';
export const MODEL_DOUILLE = 'main/models/Douille.DKO';
export const MODEL_LIFE_PACK = 'main/models/LifePack.DKO';
export const MODEL_COCKTAIL_MOLOTOV = 'main/models/CocktailMolotov.DKO';
export const MODEL_GIB = 'main/models/Gib.DKO';
export const MODEL_SHIELD_MAGNET = 'main/models/ShieldMagnet.DKO';
/** CTF (Map::dko_flag / dko_flagPod): [blue, red]. */
export const MODEL_FLAGS = ['main/models/BlueFlag.DKO', 'main/models/RedFlag.DKO'] as const;
export const MODEL_FLAG_PODS = ['main/models/BlueFlagPod.DKO', 'main/models/RedFlagPod.DKO'] as const;

const models = new Map<string, DkoModel>();
const textures = new Map<string, THREE.Texture>();

export const TEXTURES = {
  baboShadow: 'main/textures/BaboShadow.tga',
  baboHalo: 'main/textures/BaboHalo.tga',
  nuzzleFlash: 'main/textures/nuzzleFlash.tga',
  shotGlow: 'main/textures/shotGlow.tga',
  smoke1: 'main/textures/Smoke1.tga',
} as const;

export function getModel(path: string): DkoModel {
  const m = models.get(path);
  if (!m) throw new Error(`model not preloaded: ${path}`);
  return m;
}

export function getTexture(path: string): THREE.Texture {
  const t = textures.get(path);
  if (!t) throw new Error(`texture not preloaded: ${path}`);
  return t;
}

export async function preloadAssets(onProgress?: (done: number, total: number) => void): Promise<void> {
  const modelPaths = new Set<string>([MODEL_ROCKET, MODEL_GRENADE, MODEL_DOUILLE, MODEL_LIFE_PACK, MODEL_COCKTAIL_MOLOTOV, MODEL_GIB, MODEL_SHIELD_MAGNET, ...MODEL_FLAGS, ...MODEL_FLAG_PODS]);
  for (const d of weaponDefs) if (d) modelPaths.add(d.model);
  const texPaths = Object.values(TEXTURES);
  const total = modelPaths.size + texPaths.length;
  let done = 0;
  const step = () => onProgress?.(++done, total);
  await Promise.all([
    ...[...modelPaths].map(async (p) => {
      models.set(p, await loadDko(p));
      step();
    }),
    ...texPaths.map(async (p) => {
      textures.set(p, await loadTextureAsync(p));
      step();
    }),
  ]);
}
