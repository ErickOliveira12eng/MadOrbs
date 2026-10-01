import { Vec3 } from './vec';

/** Port of the original `CoordFrame` (Player.h): a babo's (or projectile's) kinematic state. */
export class CoordFrame {
  position = new Vec3();
  vel = new Vec3();
  frameID = 0;
  angle = 0;
  mousePosOnMap = new Vec3();

  copyFrom(o: CoordFrame): this {
    this.position.copy(o.position);
    this.vel.copy(o.vel);
    this.frameID = o.frameID;
    this.angle = o.angle;
    this.mousePosOnMap.copy(o.mousePosOnMap);
    return this;
  }

  clone(): CoordFrame {
    return new CoordFrame().copyFrom(this);
  }
}
