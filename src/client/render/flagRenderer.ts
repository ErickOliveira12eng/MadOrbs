// CTF flags and their pods (Map::renderMisc / Map::renderFlag / Map::update). The pods stay where
// the map puts them; each flag stands on its pod, lies where its carrier died, or rides on its
// carrier (turned with it), always waving through its model's 11 frames at 10 frames a second.
//
// Not in the original: seen from the top-down camera a flag's cloth is edge-on, so each flag also
// lights the ground under it in its team's colour, steady on its pod and pulsing when it's away.
import * as THREE from 'three';
import { FLAG_DROPPED, FLAG_ON_POD, GAME_TYPE_CTF } from '../../sim/constants';
import type { Game } from '../../sim/game';
import type { Vec3 } from '../../sim/vec';
import { getModel, MODEL_FLAG_PODS, MODEL_FLAGS } from '../assets';
import { createDkoObject3D, disposeDkoObject3D, setDkoFrame } from '../engine/dko';
import { loadTexture } from '../engine/textures';

/** glScalef(.005f, .005f, .005f) */
const MODEL_SCALE = 0.005;
const TEAM_COLOURS = [0x3d7bff, 0xff3b3b];

/** Where a carrier is drawn this frame (its interpolated position) and where it looks (degrees). */
export type CarrierLookup = (playerID: number) => { position: Vec3; angle: number } | null;

export class FlagRenderer {
  private readonly group = new THREE.Group();
  private readonly pods: THREE.Group[] = [];
  private readonly flags: { holder: THREE.Group; model: THREE.Object3D; glow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> }[] = [];
  /** Map::flagAnim */
  private anim = 0;
  private time = 0;

  constructor(scene: THREE.Object3D) {
    const glowTex = loadTexture('main/textures/shotGlow.tga', { clamp: true });
    const glowGeom = new THREE.PlaneGeometry(1.6, 1.6);
    for (let i = 0; i < 2; ++i) {
      const glow = new THREE.Mesh(
        glowGeom,
        new THREE.MeshBasicMaterial({ map: glowTex, color: TEAM_COLOURS[i], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      glow.renderOrder = -940; // on the floor, under the babos (floor decal layer)
      this.group.add(glow);
      const pod = new THREE.Group().add(createDkoObject3D(getModel(MODEL_FLAG_PODS[i]), 0));
      pod.scale.setScalar(MODEL_SCALE);
      const model = createDkoObject3D(getModel(MODEL_FLAGS[i]), 0);
      const holder = new THREE.Group().add(model);
      holder.scale.setScalar(MODEL_SCALE);
      this.pods.push(pod);
      this.flags.push({ holder, model, glow });
      this.group.add(pod, holder);
    }
    this.group.visible = false;
    scene.add(this.group);
  }

  render(game: Game, delay: number, carrier: CarrierLookup): void {
    this.group.visible = game.gameType === GAME_TYPE_CTF;
    if (!this.group.visible) return;
    this.anim += delay * 10;
    while (this.anim >= 10) this.anim -= 10;
    this.time += delay;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
    for (let i = 0; i < 2; ++i) {
      const pod = game.map.flagPodPos[i];
      this.pods[i].position.set(pod.x, pod.y, pod.z);
      const f = this.flags[i];
      const state = game.flagState[i];
      let angle = 0;
      f.holder.visible = f.glow.visible = true;
      if (state === FLAG_ON_POD) f.holder.position.set(pod.x, pod.y, pod.z);
      else if (state === FLAG_DROPPED) f.holder.position.set(game.flagPos[i].x, game.flagPos[i].y, 0);
      else {
        // Player::render: flagAngle = currentCF.angle - 90, the flag at the babo's centre
        const c = carrier(state);
        if (!c) {
          f.holder.visible = f.glow.visible = false;
          continue;
        }
        f.holder.position.set(c.position.x, c.position.y, c.position.z);
        angle = c.angle - 90;
      }
      f.holder.rotation.set(0, 0, (angle * Math.PI) / 180);
      setDkoFrame(f.model, this.anim);
      // The glow under it: steady at home, pulsing and bigger when it's away
      const home = state === FLAG_ON_POD;
      f.glow.position.set(f.holder.position.x, f.holder.position.y, 0.03);
      f.glow.scale.setScalar(home ? 1 : 1.1 + pulse * 0.35);
      f.glow.material.opacity = home ? 0.55 : 0.55 + pulse * 0.45;
    }
  }

  dispose(): void {
    for (const f of this.flags) {
      disposeDkoObject3D(f.model);
      f.glow.material.dispose();
    }
    this.flags[0]?.glow.geometry.dispose();
    for (const p of this.pods) disposeDkoObject3D(p.children[0]);
    this.group.removeFromParent();
  }
}
