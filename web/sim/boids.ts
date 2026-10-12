/**
 * Boids (Reynolds 1987) in 3D: separation, alignment and cohesion, plus
 * a moving "home" target, an altitude band, soft world bounds, fire avoidance
 * and a startle impulse when something dramatic happens.
 *
 * Neighbor search uses a uniform grid (cell = neighbor radius), so each bird only checks the 27
 * cells around it. The O(n^2) all-pairs scan is kept as a switch for the stress test.
 */
import { Rng, type V2 } from './math';

export interface Bird {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  px: number; py: number; pz: number;
  flap: number;
}

export const BOIDS = {
  count: 30,
  /** Upper bound for the stress test (instanced meshes are allocated for this many). */
  maxCount: 2000,
  neighborRadius: 5,
  separationRadius: 1.6,
  wSeparation: 2.6,
  wAlignment: 0.9,
  wCohesion: 0.45,
  wHome: 0.05,
  maxSpeed: 7,
  startledSpeed: 12,
  minSpeed: 3,
  fearRadius: 14,
  bounds: { x: 34, z: 24, minY: 4, maxY: 18 },
};

export interface FlockContext {
  time: number;
  hour: number;
  fires: V2[];
}

const TABLE = 4096; // hash buckets (power of two); collisions only add candidates, never drop them
const hashCell = (ix: number, iy: number, iz: number) =>
  (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & (TABLE - 1);

function spawnBird(rng: Rng): Bird {
  const x = rng.range(-8, 8), y = rng.range(9, 12), z = rng.range(-6, 6);
  return { x, y, z, vx: rng.range(-3, 3), vy: 0, vz: rng.range(-3, 3), px: x, py: y, pz: z, flap: rng.range(0, 6) };
}

export class Flock {
  birds: Bird[];
  startle = 0;
  /** Spatial grid for neighbor search; false = brute-force all pairs. */
  grid = true;
  /** Pair distance tests in the last step (the cost the grid is there to cut). */
  pairChecks = 0;
  // Counting-sort grid: bird indices sorted by bucket, so a bucket is a range of `order`.
  private cellStart = new Int32Array(TABLE + 1);
  private cursor = new Int32Array(TABLE);
  private order = new Int32Array(BOIDS.maxCount);
  private bucketOf = new Int32Array(BOIDS.maxCount);
  private ranges = new Int32Array(54);

  constructor(rng: Rng, count = BOIDS.count) {
    this.birds = Array.from({ length: count }, () => spawnBird(rng));
  }

  /** Stress test: grow or shrink the flock; new birds join near the current flock. */
  resize(count: number, rng: Rng) {
    count = Math.max(0, Math.min(BOIDS.maxCount, Math.round(count)));
    if (count < this.birds.length) this.birds.length = count;
    while (this.birds.length < count) {
      const b = spawnBird(rng), o = this.birds[Math.floor(rng.range(0, this.birds.length))];
      if (o) { b.x = b.px = o.x + rng.range(-3, 3); b.y = b.py = o.y + rng.range(-1, 1); b.z = b.pz = o.z + rng.range(-3, 3); }
      this.birds.push(b);
    }
  }

  private buildGrid() {
    const c = BOIDS.neighborRadius, n = this.birds.length, start = this.cellStart;
    start.fill(0);
    for (let i = 0; i < n; i++) {
      const b = this.birds[i], h = hashCell(Math.floor(b.x / c), Math.floor(b.y / c), Math.floor(b.z / c));
      this.bucketOf[i] = h;
      start[h + 1]++;
    }
    for (let h = 0; h < TABLE; h++) start[h + 1] += start[h];
    this.cursor.set(start.subarray(0, TABLE));
    for (let i = 0; i < n; i++) this.order[this.cursor[this.bucketOf[i]]++] = i;
  }

  /** Fills `ranges` with [lo, hi) spans of `order` covering the 27 cells around `b`; returns the span count. */
  private gather(b: Bird) {
    const c = BOIDS.neighborRadius, ix = Math.floor(b.x / c), iy = Math.floor(b.y / c), iz = Math.floor(b.z / c);
    let k = 0;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const h = hashCell(ix + dx, iy + dy, iz + dz), lo = this.cellStart[h], hi = this.cellStart[h + 1];
          if (lo === hi) continue;
          let dup = false; // two cells can share a bucket; count it once
          for (let r = 0; r < k && !dup; r++) dup = this.ranges[2 * r] === lo;
          if (dup) continue;
          this.ranges[2 * k] = lo;
          this.ranges[2 * k + 1] = hi;
          k++;
        }
    return k;
  }

  /** Home target: circle over the village by day, roost over the forest at night. */
  home(ctx: FlockContext) {
    const night = ctx.hour >= 21 || ctx.hour < 6;
    return night
      ? { x: 20, y: 5, z: 14, night }
      : { x: Math.cos(ctx.time * 0.06) * 14, y: 11, z: Math.sin(ctx.time * 0.06) * 9, night };
  }

  step(dt: number, ctx: FlockContext, rng: Rng) {
    const P = BOIDS, h = this.home(ctx), B = P.bounds;
    const r2 = P.neighborRadius ** 2, s2 = P.separationRadius ** 2;
    const birds = this.birds, order = this.order, ranges = this.ranges;
    if (this.grid) this.buildGrid();
    else {
      for (let i = 0; i < birds.length; i++) order[i] = i;
      ranges[0] = 0;
      ranges[1] = birds.length;
    }
    let checks = 0;
    for (const b of birds) {
      let sx = 0, sy = 0, sz = 0, ax = 0, ay = 0, az = 0, cx = 0, cy = 0, cz = 0, n = 0;
      const spans = this.grid ? this.gather(b) : 1;
      for (let r = 0; r < spans; r++) {
        const hi = ranges[2 * r + 1];
        checks += hi - ranges[2 * r];
        for (let j = ranges[2 * r]; j < hi; j++) {
          const o = birds[order[j]];
          if (o === b) continue;
          const dx = b.x - o.x, dy = b.y - o.y, dz = b.z - o.z, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > r2) continue;
          n++;
          ax += o.vx; ay += o.vy; az += o.vz;
          cx += o.x; cy += o.y; cz += o.z;
          if (d2 < s2) { const k = 1 / (d2 + 0.01); sx += dx * k; sy += dy * k; sz += dz * k; } // separation
        }
      }
      let fx = sx * P.wSeparation, fy = sy * P.wSeparation, fz = sz * P.wSeparation;
      if (n) {
        fx += (ax / n - b.vx) * P.wAlignment + (cx / n - b.x) * P.wCohesion; // alignment + cohesion
        fy += (ay / n - b.vy) * P.wAlignment + (cy / n - b.y) * P.wCohesion;
        fz += (az / n - b.vz) * P.wAlignment + (cz / n - b.z) * P.wCohesion;
      }
      fx += (h.x - b.x) * P.wHome; fy += (h.y - b.y) * P.wHome * 4; fz += (h.z - b.z) * P.wHome;
      // soft bounds
      if (b.x < -B.x) fx += (-B.x - b.x) * 4; if (b.x > B.x) fx -= (b.x - B.x) * 4;
      if (b.z < -B.z) fz += (-B.z - b.z) * 4; if (b.z > B.z) fz -= (b.z - B.z) * 4;
      if (b.y < B.minY) fy += (B.minY - b.y) * 6; if (b.y > B.maxY) fy -= (b.y - B.maxY) * 4;
      // flee fires: push away horizontally and climb
      for (const f of ctx.fires) {
        const dx = b.x - f.x, dz = b.z - f.z, d = Math.hypot(dx, dz) || 1;
        if (d < P.fearRadius) {
          const k = (P.fearRadius - d) * 1.6;
          fx += (dx / d) * k; fz += (dz / d) * k; fy += k * 0.3;
        }
      }
      if (this.startle > 0) {
        fx += rng.range(-1, 1) * 14 * this.startle;
        fy += rng.range(0, 1) * 8 * this.startle;
        fz += rng.range(-1, 1) * 14 * this.startle;
      }
      b.vx += fx * dt; b.vy += fy * dt; b.vz += fz * dt;
      const sp = Math.hypot(b.vx, b.vy, b.vz) || 1;
      const max = this.startle > 0.05 ? P.startledSpeed : P.maxSpeed;
      const min = h.night && Math.hypot(h.x - b.x, h.z - b.z) < 4 ? 1.2 : P.minSpeed;
      const k = sp > max ? max / sp : sp < min ? min / sp : 1;
      b.vx *= k; b.vy *= k; b.vz *= k;
      b.px = b.x; b.py = b.y; b.pz = b.z;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      b.flap += dt * (9 + Math.hypot(b.vx, b.vy, b.vz) * 1.2);
    }
    this.pairChecks = checks;
    this.startle = Math.max(0, this.startle - dt * 0.45);
  }
}
