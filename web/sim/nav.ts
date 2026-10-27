/**
 * Navigation layer: Recast/Detour via recast-navigation-js (WebAssembly).
 *
 * - The walkable ground is baked once into a TileCache navmesh.
 * - Every structure (houses, pond, trees...) and every user edit (rocks, wells, fires)
 *   is a TileCache obstacle, so edits only rebuild the few tiles they touch (~1 ms).
 * - Villagers are DetourCrowd agents: path corridor following + local avoidance.
 */
import { Crowd, NavMeshQuery, init, type CrowdAgent, type CrowdAgentParams, type NavMesh, type Obstacle, type TileCache } from 'recast-navigation';
import { generateTileCache } from 'recast-navigation/generators';
import { BARN, CRATES, FOUNTAIN, HOUSES, HOUSE_HALF, POND, STALLS, TOWER, TREES, WORLD } from './layout';
import { dist, type V2 } from './math';

export const AGENT_RADIUS = 0.4;
/** Obstacles are carved without erosion, so we inflate them by the agent radius ourselves. */
const INFLATE = AGENT_RADIUS + 0.05;

export const NAV_CONFIG = {
  cs: 0.2,
  ch: 0.2,
  tileSize: 64,
  walkableRadius: 2, // voxels -> 0.4 m
  walkableHeight: 9, // voxels -> 1.8 m
  walkableClimb: 2, // voxels -> 0.4 m
  walkableSlopeAngle: 45,
  maxSimplificationError: 1.3,
  expectedLayersPerTile: 2,
  maxObstacles: 512,
} as const;

export type ObstacleSpec =
  | { kind: 'cyl'; x: number; z: number; r: number }
  | { kind: 'box'; x: number; z: number; hx: number; hz: number; angle?: number };

export function staticObstacles(): ObstacleSpec[] {
  return [
    ...HOUSES.map(h => ({ kind: 'box' as const, x: h.x, z: h.z, hx: HOUSE_HALF, hz: HOUSE_HALF })),
    ...STALLS.map(s => ({ kind: 'box' as const, x: s.x, z: s.z, hx: s.hw, hz: s.hd })),
    ...CRATES.map(c => ({ kind: 'box' as const, x: c.x, z: c.z, hx: c.s / 2, hz: c.s / 2 })),
    { kind: 'box', x: TOWER.x, z: TOWER.z, hx: TOWER.half, hz: TOWER.half },
    { kind: 'box', x: BARN.x, z: BARN.z, hx: BARN.half, hz: BARN.half },
    { kind: 'cyl', x: POND.x, z: POND.z, r: POND.r },
    { kind: 'cyl', x: FOUNTAIN.x, z: FOUNTAIN.z, r: FOUNTAIN.r },
    ...TREES.map(t => ({ kind: 'cyl' as const, x: t.x, z: t.z, r: 0.3 })),
  ];
}

let recastReady: Promise<void> | null = null;
/** Loads the WebAssembly module once (the default build inlines the .wasm, so no bundler config is needed). */
export const initRecast = () => (recastReady ??= init());

function groundGeometry() {
  const { minX, maxX, minZ, maxZ } = WORLD;
  const NX = 12, NZ = 8, pos: number[] = [], idx: number[] = [];
  for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) pos.push(minX + ((maxX - minX) * i) / NX, 0, minZ + ((maxZ - minZ) * j) / NZ);
  for (let j = 0; j < NZ; j++)
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
      idx.push(a, c, b, b, c, d); // counter-clockwise from above, so normals face up
    }
  return { pos, idx };
}

const HALF_EXTENTS = (r: number) => ({ x: r, y: 2, z: r });

export class NavWorld {
  /** Increments every time navmesh tiles are rebuilt. */
  revision = 0;
  obstacleCount = 0;
  lastRebuildMs = 0;
  private dirty = false;

  private constructor(
    readonly navMesh: NavMesh,
    readonly tileCache: TileCache,
    readonly query: NavMeshQuery,
    readonly crowd: Crowd,
  ) {}

  static async create(statics: ObstacleSpec[] = staticObstacles()): Promise<NavWorld> {
    await initRecast();
    const { pos, idx } = groundGeometry();
    const res = generateTileCache(pos, idx, {
      ...NAV_CONFIG,
      bounds: [[WORLD.minX - 1, -1, WORLD.minZ - 1], [WORLD.maxX + 1, 4, WORLD.maxZ + 1]],
    });
    if (!res.success) throw new Error(`NavMesh generation failed: ${res.error}`);
    const query = new NavMeshQuery(res.navMesh);
    const crowd = new Crowd(res.navMesh, { maxAgents: 24, maxAgentRadius: 0.6 });
    const world = new NavWorld(res.navMesh, res.tileCache, query, crowd);
    // TileCache queues at most 64 obstacle requests, so flush in batches.
    statics.forEach((s, i) => {
      world.addObstacle(s);
      if (i % 32 === 31) world.flush();
    });
    world.flush();
    return world;
  }

  addObstacle(s: ObstacleSpec): Obstacle | null {
    const r =
      s.kind === 'cyl'
        ? this.tileCache.addCylinderObstacle({ x: s.x, y: -0.5, z: s.z }, s.r + INFLATE, 3)
        : this.tileCache.addBoxObstacle({ x: s.x, y: 1, z: s.z }, { x: s.hx + INFLATE, y: 2, z: s.hz + INFLATE }, s.angle ?? 0);
    if (!r.success) return null;
    this.dirty = true;
    this.obstacleCount++;
    return r.obstacle;
  }

  removeObstacle(o: Obstacle) {
    if (this.tileCache.removeObstacle(o).success) {
      this.dirty = true;
      this.obstacleCount--;
    }
  }

  /** Rebuilds the tiles touched by pending obstacle requests. Returns true if anything changed. */
  flush(maxIterations = 64) {
    if (!this.dirty) return false;
    const t0 = performance.now();
    for (let i = 0; i < maxIterations; i++) if (this.tileCache.update(this.navMesh).upToDate) break;
    this.lastRebuildMs = performance.now() - t0;
    this.dirty = false;
    this.revision++;
    return true;
  }

  /** Closest point on the navmesh, or null if nothing walkable is within `radius`. */
  snap(p: V2, radius = 2): V2 | null {
    const r = this.query.findClosestPoint({ x: p.x, y: 0, z: p.z }, { halfExtents: HALF_EXTENTS(radius) });
    return r.success && r.polyRef ? { x: r.point.x, z: r.point.z } : null;
  }

  /** Straight path corners, or null if `b` cannot be reached (Detour returns partial paths otherwise). */
  path(a: V2, b: V2, tolerance = 1.2): V2[] | null {
    const end = this.snap(b, 3);
    if (!end) return null;
    const r = this.query.computePath({ x: a.x, y: 0, z: a.z }, { x: end.x, y: 0, z: end.z }, { halfExtents: HALF_EXTENTS(2) });
    if (!r.success || r.path.length === 0) return null;
    const last = r.path[r.path.length - 1];
    if (dist({ x: last.x, z: last.z }, end) > tolerance) return null;
    return r.path.map(p => ({ x: p.x, z: p.z }));
  }

  /** Random walkable point within `r` of `p` (used for short detours when an agent is boxed in). */
  randomNear(p: V2, r: number): V2 | null {
    const res = this.query.findRandomPointAroundCircle({ x: p.x, y: 0.2, z: p.z }, r, { halfExtents: HALF_EXTENTS(1) });
    return res.success ? { x: res.randomPoint.x, z: res.randomPoint.z } : null;
  }

  pathLength(a: V2, b: V2) {
    const p = this.path(a, b);
    if (!p) return Infinity;
    let len = 0;
    for (let i = 1; i < p.length; i++) len += dist(p[i - 1], p[i]);
    return len;
  }

  addAgent(p: V2, params: Partial<CrowdAgentParams>): CrowdAgent {
    const at = this.snap(p, 4) ?? p;
    return this.crowd.addAgent({ x: at.x, y: 0.2, z: at.z }, params);
  }

  step(dt: number) {
    this.crowd.update(dt);
  }

  /** Frees the WebAssembly memory; a new game builds a fresh NavWorld. */
  dispose() {
    this.crowd.destroy();
    this.query.destroy();
    this.tileCache.destroy();
    this.navMesh.destroy();
  }
}
