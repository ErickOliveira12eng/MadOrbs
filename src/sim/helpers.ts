import { Vec3, dot } from './vec';

/**
 * Port of Helper.cpp segmentToSphere: does segment p1-p2 touch the sphere (c, radius)?
 * Like the original, on a hit `p2` is moved (in place) to the closest point of the segment.
 */
export function segmentToSphere(p1: Vec3, p2: Vec3, c: Vec3, radius: number): boolean {
  const u = p2.sub(p1);
  const l = u.length();
  if (l === 0) return p1.sub(c).length() <= radius;
  u.mulIn(1 / l);
  const p = c.sub(p1);
  const d = dot(p, u);
  let r: Vec3;
  if (d < 0) r = p1.clone();
  else if (d > l) r = p2.clone();
  else r = p1.add(u.mul(d));
  if (r.sub(c).lengthSq() <= radius * radius) {
    p2.copy(r);
    return true;
  }
  return false;
}

/** Distance from point `c` to the segment p1-p2. */
export function distanceToSegment(c: Vec3, p1: Vec3, p2: Vec3): number {
  const u = p2.sub(p1);
  const l2 = u.lengthSq();
  if (l2 === 0) return c.sub(p1).length();
  const t = Math.max(0, Math.min(1, dot(c.sub(p1), u) / l2));
  return c.sub(p1.add(u.mul(t))).length();
}

/** Port of CVector.cpp reflect. */
export function reflect(u: Vec3, normal: Vec3): Vec3 {
  const d = dot(u, normal);
  return u.sub(normal.mul(2 * d));
}

/** Orientation angle (degrees) used everywhere for babos, rockets...: 0 = facing +Y. */
export function angleFromDir(dir: Vec3): number {
  const d = new Vec3(dir.x, dir.y, 0).normalizeIn();
  const dotWithY = Math.max(-1, Math.min(1, d.y));
  let angle = Math.acos(dotWithY) * 57.29578;
  if (d.x > 0) angle = -angle;
  return angle;
}

/** Engine `rand(int from, int to)` — integer in [from, to) (from when equal). */
export function randInt(from: number, to: number): number {
  if (from > to) [from, to] = [to, from];
  return from === to ? from : from + Math.floor(Math.random() * (to - from));
}
