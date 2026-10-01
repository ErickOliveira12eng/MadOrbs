// What is still drawn in WebGL over the 3D view, from Client::render (ClientRender.cpp): the sniper
// scope and the red flash when the local player gets hit. The rest of the HUD is HTML
// (src/client/hud). Drawn in the pixels of the game view, so the scope stays round whatever its shape.
import * as THREE from 'three';
import { loadTexture } from '../engine/textures';
import { Draw2D } from './draw2d';

export interface OverlayState {
  /** Sniper scope opacity 0..1 (0: no scope). See scopeAlpha(). */
  scope: number;
  /** Cursor in canvas CSS pixels (centre of the scope). */
  mouseX: number;
  mouseY: number;
  /** Player::screenHit 0..1, drawn with alpha screenHit * 3. */
  screenHit: number;
  /** The Esc menu is open: the scope blacks out the whole view behind it. */
  menuOpen: boolean;
}

/** ClientRender.cpp: the scope fades in when the camera goes above 8 (opaque from 10). */
export function scopeAlpha(camZ: number): number {
  if (camZ <= 8) return 0;
  const a = 10 - (camZ - 2);
  return a > 0 ? 1 - a / 2 : 1;
}

/** GameVar::loadTextures: 256x256, transparent inside a radius of 118 except the two centre lines. */
function makeSniperScopeTexture(): THREE.DataTexture {
  const w = 256;
  const h = 256;
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const x = i % w;
    const y = Math.trunc(i / w);
    const dx = x - w / 2;
    const dy = y - h / 2;
    data[i * 4 + 3] = Math.sqrt(dx * dx + dy * dy) < 118 && x !== w / 2 && y !== h / 2 ? 0 : 255;
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export class ViewOverlay {
  private readonly draw = new Draw2D();
  private readonly texScreenHit = loadTexture('main/textures/screenHit.tga', { clamp: true });
  private readonly texScope = makeSniperScopeTexture();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    aspect: number,
  ) {
    this.draw.aspect = aspect;
  }

  render(renderer: THREE.WebGLRenderer, s: OverlayState): void {
    if (s.scope <= 0 && s.screenHit <= 0) return;
    const d = this.draw;
    d.begin(this.canvas.clientWidth, this.canvas.clientHeight);
    d.orthoPixels();
    const W = d.resX;
    const H = d.resY;
    if (s.scope > 0) {
      d.color(0, 0, 0, s.scope);
      if (s.menuOpen) {
        d.renderTexturedQuad(0, 0, W, H, null);
      } else {
        // The 256x256 hole of the 800x600 layout, around the cursor, and black everywhere else
        const r = (128 / 600) * H;
        const { x, y } = d.canvasToPixels(s.mouseX, s.mouseY);
        d.renderTexturedQuad(x - r, y - r, r * 2, r * 2, this.texScope);
        d.renderTexturedQuad(0, 0, W, y - r, null);
        d.renderTexturedQuad(0, y + r, W, H - (y + r), null);
        d.renderTexturedQuad(0, y - r, x - r, r * 2, null);
        d.renderTexturedQuad(x + r, y - r, W - (x + r), r * 2, null);
      }
    }
    if (s.screenHit > 0) {
      d.color(1, 1, 1, s.screenHit * 3);
      d.renderTexturedQuad(0, 0, W, H, this.texScreenHit);
    }
    d.flush(renderer);
  }

  dispose(): void {
    this.texScope.dispose();
    this.draw.dispose();
  }
}
