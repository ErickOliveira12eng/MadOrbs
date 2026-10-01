// Draws orbs (the game's babo: GLU sphere with its recoloured skin) into 2D canvases. The whole
// start screen shares this one WebGL context: the previews, the style gallery and the background.
import * as THREE from 'three';
import '../client/engine/renderer'; // colour management off, like the game
import { createGluSphere, loadSkinBase, recolorSkin } from '../client/render/baboRenderer';
import type { SkinInfo } from '../sim/player';

const SIZE = 512;
const MAX_TEXTURES = 80;

/** Turned so that the skin's band faces the viewer (the poles of the texture look pinched). */
export const FRONT = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + 0.35, 0, 0.5));

export class OrbStudio {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(16, 1, 0.1, 20);
  private readonly material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  private readonly sphere: THREE.Mesh;
  /** Recoloured skins, least recently used first. */
  private readonly textures = new Map<string, THREE.DataTexture>();

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(SIZE, SIZE, false);
    this.renderer.setClearColor(0x000000, 0);
    // A three-quarter view from the front, lit from the top left like in the game
    this.camera.position.set(0, -1.9, 1.25);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.5 * Math.PI));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0 * Math.PI);
    sun.position.set(-1.3, -1.2, 2.4);
    this.scene.add(sun);
    this.sphere = new THREE.Mesh(createGluSphere(0.25, 48, 32), this.material);
    this.scene.add(this.sphere);
  }

  /** The skin recoloured with its three decal colours (Player::updateSkin). */
  async texture(info: SkinInfo): Promise<THREE.DataTexture> {
    const key = `${info.skin}|${info.redDecal}|${info.greenDecal}|${info.blueDecal}`;
    const cached = this.textures.get(key);
    if (cached) {
      this.textures.delete(key);
      this.textures.set(key, cached);
      return cached;
    }
    const tex = recolorSkin(await loadSkinBase(info.skin), info);
    this.textures.set(key, tex);
    for (const [k, t] of this.textures) {
      if (this.textures.size <= MAX_TEXTURES) break;
      t.dispose();
      this.textures.delete(k);
    }
    return tex;
  }

  /** Draws the orb, turned by `rotation`, over the whole canvas. */
  draw(canvas: HTMLCanvasElement, tex: THREE.Texture, rotation: THREE.Quaternion): void {
    if (this.material.map !== tex) {
      if (!this.material.map) this.material.needsUpdate = true;
      this.material.map = tex;
    }
    this.sphere.quaternion.copy(rotation);
    // Only as many pixels as the target needs (small thumbnails are cheap)
    const n = Math.min(SIZE, Math.max(canvas.width, canvas.height));
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(0, 0, n, n);
    this.renderer.setViewport(0, 0, n, n);
    this.renderer.render(this.scene, this.camera);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // GL's viewport starts at the bottom left
    ctx.drawImage(this.renderer.domElement, 0, SIZE - n, n, n, 0, 0, canvas.width, canvas.height);
  }

  /** A still picture of the orb, as a data URL (for <img> elements). */
  async picture(info: SkinInfo, size: number, rotation = FRONT): Promise<string> {
    const tex = await this.texture(info);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    this.draw(canvas, tex, rotation);
    return canvas.toDataURL('image/png');
  }
}
