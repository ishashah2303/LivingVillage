/**
 * Boids (Reynolds 1987) in 3D: separation, alignment and cohesion, plus
 * a moving "home" target, an altitude band, soft world bounds, fire avoidance
 * and a startle impulse when something dramatic happens.
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

export class Flock {
  birds: Bird[];
  startle = 0;

  constructor(rng: Rng, count = BOIDS.count) {
    this.birds = Array.from({ length: count }, () => {
      const x = rng.range(-8, 8), y = rng.range(9, 12), z = rng.range(-6, 6);
      return { x, y, z, vx: rng.range(-3, 3), vy: 0, vz: rng.range(-3, 3), px: x, py: y, pz: z, flap: rng.range(0, 6) };
    });
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
    for (const b of this.birds) {
      let sx = 0, sy = 0, sz = 0, ax = 0, ay = 0, az = 0, cx = 0, cy = 0, cz = 0, n = 0;
      for (const o of this.birds) {
        if (o === b) continue;
        const dx = b.x - o.x, dy = b.y - o.y, dz = b.z - o.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        n++;
        ax += o.vx; ay += o.vy; az += o.vz;
        cx += o.x; cy += o.y; cz += o.z;
        if (d2 < s2) { const k = 1 / (d2 + 0.01); sx += dx * k; sy += dy * k; sz += dz * k; } // separation
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
    this.startle = Math.max(0, this.startle - dt * 0.45);
  }
}
