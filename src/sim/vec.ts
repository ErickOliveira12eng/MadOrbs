// Minimal 3D vector mirroring the original engine's CVector3f (Engine/DukZeven/Code/CVector.*).
// World space matches the original game: Z up, X right, Y toward the top of the screen,
// 1 unit = 1 map cell.

export const TO_RADIANT = 0.017453;
export const TO_DEGREE = 57.29578;

export class Vec3 {
  constructor(public x = 0, public y = 0, public z = 0) {}

  static from(a: ArrayLike<number>): Vec3 {
    return new Vec3(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0);
  }

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v: Vec3): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }

  /** Index access, to port `v[0]`, `v[1]`, `v[2]` from C++. */
  get(i: number): number {
    return i === 0 ? this.x : i === 1 ? this.y : this.z;
  }

  setAt(i: number, value: number): this {
    if (i === 0) this.x = value;
    else if (i === 1) this.y = value;
    else this.z = value;
    return this;
  }

  // --- Non-mutating (like C++ operators) ---
  add(v: Vec3): Vec3 {
    return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  sub(v: Vec3): Vec3 {
    return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  mul(s: number): Vec3 {
    return new Vec3(this.x * s, this.y * s, this.z * s);
  }

  div(s: number): Vec3 {
    return new Vec3(this.x / s, this.y / s, this.z / s);
  }

  neg(): Vec3 {
    return new Vec3(-this.x, -this.y, -this.z);
  }

  // --- Mutating (like C++ compound operators) ---
  addIn(v: Vec3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  subIn(v: Vec3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  mulIn(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  addScaledIn(v: Vec3, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }

  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  /** In-place normalize (same as the C++ free function `normalize(v)`). Zero vectors stay zero. */
  normalizeIn(): this {
    const len = this.length();
    if (len > 0) {
      this.x /= len;
      this.y /= len;
      this.z /= len;
    }
    return this;
  }

  dot(v: Vec3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v: Vec3): Vec3 {
    return new Vec3(this.y * v.z - this.z * v.y, this.z * v.x - this.x * v.z, this.x * v.y - this.y * v.x);
  }

  equals(v: Vec3): boolean {
    return this.x === v.x && this.y === v.y && this.z === v.z;
  }
}

export function normalize(v: Vec3): Vec3 {
  return v.normalizeIn();
}

export function dot(a: Vec3, b: Vec3): number {
  return a.dot(b);
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return a.cross(b);
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.sqrt(distanceSquared(a, b));
}

export function distanceSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Port of CVector.cpp rotateAboutAxis. `angle` is in degrees; `axis` must be normalized. */
export function rotateAboutAxis(p: Vec3, angle: number, axis: Vec3): Vec3 {
  angle *= TO_RADIANT;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const [ax, ay, az] = [axis.x, axis.y, axis.z];
  return new Vec3(
    (c + (1 - c) * ax * ax) * p.x + ((1 - c) * ax * ay - az * s) * p.y + ((1 - c) * ax * az + ay * s) * p.z,
    ((1 - c) * ax * ay + az * s) * p.x + (c + (1 - c) * ay * ay) * p.y + ((1 - c) * ay * az - ax * s) * p.z,
    ((1 - c) * ax * az - ay * s) * p.x + ((1 - c) * ay * az + ax * s) * p.y + (c + (1 - c) * az * az) * p.z,
  );
}

/** Port of the engine's `rand(float from, float to)`. */
export function randRange(from: number, to: number): number {
  return from + Math.random() * (to - from);
}

/** Port of `rand(CVector3f from, CVector3f to)` (per-component random). */
export function randVec(from: Vec3, to: Vec3): Vec3 {
  return new Vec3(randRange(from.x, to.x), randRange(from.y, to.y), randRange(from.z, to.z));
}

/** C-style `rand()` returning a non-negative integer (0..32767 like MSVC RAND_MAX). */
export function crand(): number {
  return Math.floor(Math.random() * 32768);
}
