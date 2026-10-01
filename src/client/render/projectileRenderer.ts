// Port of Projectile::render / Projectile::renderShadow.
import * as THREE from 'three';
import {
  PROJECTILE_COCKTAIL_MOLOTOV,
  PROJECTILE_DROPED_GRENADE,
  PROJECTILE_DROPED_WEAPON,
  PROJECTILE_FLAME,
  PROJECTILE_GRENADE,
  PROJECTILE_LIFE_PACK,
  PROJECTILE_ROCKET,
} from '../../sim/constants';
import { weaponDefs } from '../../sim/gameVar';
import type { Projectile } from '../../sim/projectile';
import { Vec3, randRange } from '../../sim/vec';
import { createDkoObject3D } from '../engine/dko';
import { getModel, getTexture, MODEL_COCKTAIL_MOLOTOV, MODEL_GRENADE, MODEL_LIFE_PACK, MODEL_ROCKET, TEXTURES } from '../assets';

function quad(x0: number, y0: number, x1: number, y1: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y1, 0, x0, y0, 0, x1, y0, 0, x1, y1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 1, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** The rocket exhaust flame (two crossed quads, Projectile::render). */
function rocketFlameGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-0.25, 0, 0, -0.25, -1, 0, 0.25, -1, 0, 0.25, 0, 0, 0, 0, 0.25, 0, -1, 0.25, 0, -1, -0.25, 0, 0, -0.25], 3),
  );
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0], 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return g;
}

const glow25 = quad(-2.5, -2.5, 2.5, 2.5);
const glow10 = quad(-1, -1, 1, 1);
const shadowGeom = quad(-0.25, -0.25, 0.25, 0.25);
const flameGeom = rocketFlameGeometry();

function additive(tex: THREE.Texture, color = 0xffffff, depthTest = true): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest, side: THREE.DoubleSide });
}

let shadowMat: THREE.MeshBasicMaterial | null = null;

class ProjectileVisual {
  readonly root = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private modelHolder = new THREE.Group();
  private glow: THREE.Mesh | null = null;
  private glowMat: THREE.MeshBasicMaterial | null = null;
  private flame: THREE.Mesh | null = null;
  private shadow: THREE.Mesh | null = null;
  private prev = new Vec3();
  private cur = new Vec3();
  private type: number;

  constructor(p: Projectile, scene: THREE.Object3D) {
    this.type = p.projectileType;
    this.prev.copy(p.currentCF.position);
    this.cur.copy(p.currentCF.position);
    const shotGlow = getTexture(TEXTURES.shotGlow);

    if (this.type === PROJECTILE_ROCKET || this.type === PROJECTILE_COCKTAIL_MOLOTOV) {
      this.glowMat = additive(shotGlow, 0xffffff, false);
      this.glow = new THREE.Mesh(glow25, this.glowMat);
      this.glow.renderOrder = 7;
      this.root.add(this.glow);
    }
    if (this.type === PROJECTILE_FLAME) {
      this.glowMat = additive(shotGlow, 0xffbf00, false);
      this.glow = new THREE.Mesh(glow10, this.glowMat);
      this.glow.renderOrder = 7;
      this.root.add(this.glow);
    }
    if (this.type === PROJECTILE_ROCKET) {
      this.flame = new THREE.Mesh(flameGeom, additive(getTexture(TEXTURES.nuzzleFlash)));
      this.flame.renderOrder = 8;
      this.root.add(this.flame);
    }

    let modelPath: string | null = null;
    let scale = 0.0025;
    switch (this.type) {
      case PROJECTILE_ROCKET:
        modelPath = MODEL_ROCKET;
        break;
      case PROJECTILE_GRENADE:
      case PROJECTILE_DROPED_GRENADE:
        modelPath = MODEL_GRENADE;
        break;
      case PROJECTILE_COCKTAIL_MOLOTOV:
        modelPath = MODEL_COCKTAIL_MOLOTOV;
        break;
      case PROJECTILE_LIFE_PACK:
        modelPath = MODEL_LIFE_PACK;
        break;
      case PROJECTILE_DROPED_WEAPON:
        modelPath = weaponDefs[p.weaponID]?.model ?? null;
        scale = 0.005;
        break;
    }
    if (modelPath) {
      this.model = createDkoObject3D(getModel(modelPath), 0);
      this.modelHolder.add(this.model);
      this.modelHolder.scale.setScalar(scale);
      this.root.add(this.modelHolder);
    }
    if (this.type !== PROJECTILE_FLAME) {
      if (!shadowMat) {
        shadowMat = new THREE.MeshBasicMaterial({ map: getTexture(TEXTURES.baboShadow), color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
      }
      this.shadow = new THREE.Mesh(shadowGeom, shadowMat);
      this.shadow.renderOrder = -950; // floor decal layer (see MAP_RENDER_ORDER)
      this.root.add(this.shadow);
    }
    scene.add(this.root);
  }

  tick(p: Projectile): void {
    this.prev.copy(this.cur);
    this.cur.copy(p.currentCF.position);
  }

  render(p: Projectile, alpha: number): void {
    const x = this.prev.x + (this.cur.x - this.prev.x) * alpha;
    const y = this.prev.y + (this.cur.y - this.prev.y) * alpha;
    const z = this.prev.z + (this.cur.z - this.prev.z) * alpha;
    const cf = p.currentCF;
    if (this.glow && this.glowMat) {
      this.glow.position.set(x, y, 0.03);
      if (this.type === PROJECTILE_FLAME) this.glowMat.opacity = randRange(0.1, 0.15) * (1 - z);
      else this.glowMat.opacity = randRange(0.05, 0.25);
    }
    if (this.flame) {
      this.flame.position.set(x, y, z);
      this.flame.rotation.set(0, 0, 0);
      this.flame.rotateZ((cf.angle * Math.PI) / 180);
      this.flame.rotateY((randRange(0, 360) * Math.PI) / 180);
      this.flame.scale.setScalar(0.5);
    }
    if (this.shadow) this.shadow.position.set(x + 0.1, y - 0.1, 0.025);

    const h = this.modelHolder;
    h.position.set(x, y, z);
    h.quaternion.identity();
    switch (this.type) {
      case PROJECTILE_ROCKET:
        h.rotateZ((cf.angle * Math.PI) / 180);
        break;
      case PROJECTILE_GRENADE:
      case PROJECTILE_COCKTAIL_MOLOTOV: {
        const axis = new THREE.Vector3(cf.vel.x, cf.vel.y, 0);
        if (axis.lengthSq() > 0) h.quaternion.setFromAxisAngle(axis.normalize(), (p.rotation * Math.PI) / 180);
        break;
      }
      case PROJECTILE_LIFE_PACK:
        h.position.z = z - 0.2;
        break;
      case PROJECTILE_DROPED_WEAPON:
        h.position.z = z - 0.3;
        h.rotateZ((p.rotation * Math.PI) / 180);
        break;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}

export class ProjectileRenderer {
  private visuals = new Map<number, ProjectileVisual>();
  private scene: THREE.Object3D;

  constructor(scene: THREE.Object3D) {
    this.scene = scene;
  }

  /** Sync with the simulation after each tick. */
  tick(projectiles: Projectile[]): void {
    const alive = new Set<number>();
    for (const p of projectiles) {
      alive.add(p.uniqueID);
      let v = this.visuals.get(p.uniqueID);
      if (!v) {
        v = new ProjectileVisual(p, this.scene);
        this.visuals.set(p.uniqueID, v);
      } else v.tick(p);
    }
    for (const [id, v] of this.visuals) {
      if (!alive.has(id)) {
        v.dispose();
        this.visuals.delete(id);
      }
    }
  }

  render(projectiles: Projectile[], alpha: number): void {
    for (const p of projectiles) this.visuals.get(p.uniqueID)?.render(p, alpha);
  }

  clear(): void {
    for (const v of this.visuals.values()) v.dispose();
    this.visuals.clear();
  }
}
