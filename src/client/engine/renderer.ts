// Renderer + lighting setup that reproduces the original OpenGL 1.x fixed-function look.
//
// The original did all colour math directly on the 8-bit texture values (no sRGB/linear
// conversion), so colour management is disabled: textures are used raw (NoColorSpace) and the
// framebuffer output is not gamma-encoded.
import * as THREE from 'three';

THREE.ColorManagement.enabled = false;

export function createRenderer(opts: { antialias?: boolean; canvas?: HTMLCanvasElement } = {}): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: opts.antialias ?? true, canvas: opts.canvas });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  return renderer;
}

/**
 * The game's only light: `dkglSetPointLight(1, -1000, 1000, 2000, 1, 1, 1)` (GameRender.cpp),
 * i.e. diffuse (1,1,1), ambient (1/6) per light, plus OpenGL's default global ambient (0.2).
 * The light is so far away that it is effectively directional.
 *
 * three.js' Lambert/Phong BRDFs divide by PI, so intensities are multiplied by PI to match
 * fixed-function GL where `color = ambient + diffuse * max(N.L, 0)`.
 */
export const GL_AMBIENT = 0.2 + 1 / 6;

export function addGameLights(scene: THREE.Scene): { ambient: THREE.AmbientLight; sun: THREE.DirectionalLight } {
  const ambient = new THREE.AmbientLight(0xffffff, GL_AMBIENT * Math.PI);
  const sun = new THREE.DirectionalLight(0xffffff, 1 * Math.PI);
  sun.position.set(-1000, 1000, 2000);
  sun.target.position.set(0, 0, 0);
  scene.add(ambient, sun, sun.target);
  return { ambient, sun };
}
