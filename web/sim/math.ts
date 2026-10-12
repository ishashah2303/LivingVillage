export type V2 = { x: number; z: number };

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dist = (a: V2, b: V2) => Math.hypot(a.x - b.x, a.z - b.z);
export const distXZ = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

/** Shortest-arc interpolation between two angles (radians). */
export function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Distance from point p to segment ab on the XZ plane. */
export function distToSegment(p: V2, a: V2, b: V2) {
  const vx = b.x - a.x, vz = b.z - a.z;
  const t = clamp(((p.x - a.x) * vx + (p.z - a.z) * vz) / (vx * vx + vz * vz || 1), 0, 1);
  return distXZ(p.x, p.z, a.x + vx * t, a.z + vz * t);
}

/** Small seeded PRNG (mulberry32) so every run of the village is reproducible. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + this.next() * (b - a);
  }
  int(n: number) {
    return Math.floor(this.next() * n);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
}
