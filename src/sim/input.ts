import { Vec3 } from './vec';

/**
 * One tick of player input (what the original read through dkiGetState in Player::controlIt).
 * `*Pressed` flags are edge-triggered (DKI_DOWN), the others are held states.
 */
export interface PlayerInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  shoot: boolean;
  shootPressed: boolean;
  melee: boolean;
  throwGrenadePressed: boolean;
  throwMolotovPressed: boolean;
  pickUpPressed: boolean;
  /** World position under the mouse cursor (on the ground plane, z = 0). */
  mousePosOnMap: Vec3;
  /** Camera height (map->camPos[2]); the sniper uses it (scope zoom). */
  camPosZ: number;
}

export function emptyInput(): PlayerInput {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    shoot: false,
    shootPressed: false,
    melee: false,
    throwGrenadePressed: false,
    throwMolotovPressed: false,
    pickUpPressed: false,
    mousePosOnMap: new Vec3(),
    camPosZ: 7,
  };
}
