// The game camera: port of Map::setCameraPos / Map::update (camera part), Client::render
// (camLookAt), Game::update (view shake) and GameRender.cpp (gluLookAt + mouse unprojection).
//
// The "counterweight" feel of the original aim comes from this loop:
//  - every rendered frame the cursor is unprojected onto the ground with the *current* camera,
//  - the camera target is (player*5 + mouseOnMap*4) / 9,
//  - the camera eases towards it: camPos += (camDest - camPos) * 2.5 * delay (30 Hz),
// so moving the mouse drags the camera, which moves the world under the cursor, which moves the
// aim point further — converging to an aim point 1.8x the cursor offset with a smooth lag.
import * as THREE from 'three';
import { WEAPON_SNIPER } from '../sim/constants';
import type { Player } from '../sim/player';
import { Vec3, distance, randRange, rotateAboutAxis } from '../sim/vec';
import { ORIGINAL_ASPECT, VIEW_ASPECT } from './view';

const Z_AXIS = new Vec3(0, 0, 1);

/** The original lens: dkglSetProjection(60, 1, 50, ...) (Scene.cpp). camPos heights assume it. */
const ORIGINAL_FOV = 60;
/**
 * The lens the view is drawn with. Through the original 60 degrees, a 16:9 view stretches what is
 * near its edges (an orb in a corner looks like an egg); this narrower lens, from proportionally
 * higher up, shows the same patch of ground with far less of that. Only the drawing changes:
 * camPos (sound, sniper damage, network) keeps the original heights.
 */
const RENDER_FOV = 40;
/** Drawn camera height / logical camera height (same ground footprint as the original lens). */
export const LENS_HEIGHT = Math.tan((ORIGINAL_FOV * Math.PI) / 360) / Math.tan((RENDER_FOV * Math.PI) / 360);

export class GameCamera {
  readonly camera = new THREE.PerspectiveCamera(RENDER_FOV, VIEW_ASPECT, 1, 50 * LENS_HEIGHT);
  camPos = new Vec3();
  camLookAt = new Vec3();
  camDest = new Vec3();
  private prevCamPos = new Vec3();
  viewShake = 0;
  private mapSize: [number, number] = [32, 32];
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();

  constructor() {
    const up = new THREE.Vector3(0, 1, 1).normalize();
    this.camera.up.copy(up);
  }

  setMapSize(size: [number, number]): void {
    this.mapSize = size;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Map::setCameraPos */
  setCameraPos(p: Vec3): void {
    this.camLookAt.copy(p);
    this.camDest = this.camLookAt.add(new Vec3(0, 0, 7));
    this.camPos.copy(this.camDest);
    this.prevCamPos.copy(this.camPos);
  }

  /** Client::render — camera target between the babo and the aim point. Call every frame. */
  followPlayer(player: Player | null): void {
    if (!player || !player.isAlive) return;
    const p = player.currentCF.position;
    const m = player.currentCF.mousePosOnMap;
    this.camLookAt.set((p.x * 5 + m.x * 4) / 9, (p.y * 5 + m.y * 4) / 9, (p.z * 5 + m.z * 4) / 9);
    const [w, h] = this.mapSize;
    if (this.camLookAt.x < 0) this.camLookAt.x = 0;
    if (this.camLookAt.y < -1) this.camLookAt.y = -1;
    if (this.camLookAt.x > w) this.camLookAt.x = w;
    if (this.camLookAt.y > h + 1) this.camLookAt.y = h + 1;
  }

  /** Map::update (camera part) + Game::update view shake. Call once per simulation tick. */
  tick(delay: number, player: Player | null, spectatorSpeed?: { x: number; y: number }): void {
    this.prevCamPos.copy(this.camPos);
    const [w, h] = this.mapSize;
    const sniper = !!player && player.isAlive && player.weapon?.weaponID === WEAPON_SNIPER;
    if (spectatorSpeed) {
      this.camLookAt.x += spectatorSpeed.x * delay;
      this.camLookAt.y += spectatorSpeed.y * delay;
    }
    // Snipers can scope at the map edges
    if (!sniper) {
      // The original kept its 4:3 view inside the map with a 5-cell margin: a wider view needs a
      // wider one, and a map narrower than the view stays centred
      const mx = 5 * (this.camera.aspect / ORIGINAL_ASPECT);
      if (w <= mx * 2) this.camLookAt.x = w / 2;
      else if (this.camLookAt.x < mx) this.camLookAt.x = mx;
      else if (this.camLookAt.x > w - mx) this.camLookAt.x = w - mx;
      if (this.camLookAt.y < 4) this.camLookAt.y = 4;
      if (this.camLookAt.y > h - 4) this.camLookAt.y = h - 4;
    }
    this.camDest = this.camLookAt.add(new Vec3(0, 0, 7));
    if (player && player.isAlive && sniper) {
      // The farther the mouse, the higher the camera (see farther to snipe)
      let dis = distance(player.currentCF.mousePosOnMap, player.currentCF.position) * 2;
      if (dis > 12) dis = 12;
      if (dis < 5) dis = 5;
      this.camDest = this.camLookAt.add(new Vec3(0, 0, dis));
    }
    this.camPos.addIn(this.camDest.sub(this.camPos).mul(2.5 * delay));

    // View shake (explosions)
    if (this.viewShake > 0) {
      if (this.viewShake > 2.5) this.viewShake = 2.5;
      let dir = new Vec3(1, 0, 0);
      dir = rotateAboutAxis(dir, randRange(0, 360), Z_AXIS).mul(this.viewShake * 0.1);
      this.camPos.addIn(dir);
      this.viewShake -= delay * 0.75;
      if (this.viewShake < 0) this.viewShake = 0;
    }
  }

  /**
   * gluLookAt(camPos, (camPos.x, camPos.y, 0), up = (0,1,1)), interpolated between ticks; drawn
   * from LENS_HEIGHT times higher with the narrower lens (same ground under every pixel).
   */
  apply(alpha: number): void {
    const x = this.prevCamPos.x + (this.camPos.x - this.prevCamPos.x) * alpha;
    const y = this.prevCamPos.y + (this.camPos.y - this.prevCamPos.y) * alpha;
    const z = this.prevCamPos.z + (this.camPos.z - this.prevCamPos.z) * alpha;
    this.camera.position.set(x, y, z * LENS_HEIGHT);
    this.camera.lookAt(x, y, 0);
    this.camera.updateMatrixWorld();
  }

  /** Camera height of this frame in the original's terms (for the sniper scope overlay). */
  get renderHeight(): number {
    return this.camera.position.z / LENS_HEIGHT;
  }

  /** camPos as drawn this frame, in the original's terms (weather around the camera). */
  get eye(): Vec3 {
    const p = this.camera.position;
    return new Vec3(p.x, p.y, p.z / LENS_HEIGHT);
  }

  /** GameRender.cpp: the point of the ground (z = 0) under the cursor. */
  unproject(mouseX: number, mouseY: number, width: number, height: number, out: Vec3): Vec3 {
    this.ndc.set((mouseX / width) * 2 - 1, -(mouseY / height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const o = this.raycaster.ray.origin;
    const d = this.raycaster.ray.direction;
    if (Math.abs(d.z) < 1e-6) return out;
    const t = -o.z / d.z;
    return out.set(o.x + d.x * t, o.y + d.y * t, 0);
  }

  /** World -> screen pixels (dkglProject), e.g. for names over babos. */
  project(p: Vec3, width: number, height: number): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(p.x, p.y, p.z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height, visible: v.z < 1 };
  }
}
