/**
 * Static village layout. It keeps the exact layout of the 2D mockup (a 48x32 grid)
 * and converts it to meters, so the 3D slice and the mockup can be compared side by side.
 */
import { Rng, dist, distToSegment, type V2 } from './math';

/** Grid unit -> meters. */
export const S = 1.25;
export const g2w = (gx: number, gy: number): V2 => ({ x: (gx - 24) * S, z: (gy - 16) * S });

export const WORLD = { minX: -30, maxX: 30, minZ: -20, maxZ: 20 };

export type PlaceKey = 'square' | 'market' | 'farm' | 'pond' | 'forest' | 'post';
export interface Place {
  key: PlaceKey;
  name: string;
  /** Identifier used in planner commands, e.g. EVACUATE(ForestClearing). */
  cmd: string;
  x: number;
  z: number;
  /** Radius (m) inside which villagers spread out when they arrive. */
  r: number;
  ring?: boolean;
}

const place = (key: PlaceKey, name: string, cmd: string, gx: number, gy: number, r: number, ring = false): Place => ({
  key, name, cmd, ...g2w(gx, gy), r: r * S, ring,
});

export const PLACES: Record<PlaceKey, Place> = {
  square: place('square', 'Town Square', 'TownSquare', 24, 16, 2.5, true),
  market: place('market', 'Marketplace', 'Marketplace', 33, 12, 1.6),
  farm: place('farm', 'Farm', 'Farm', 8, 24, 3),
  pond: place('pond', 'Pond', 'Pond', 11.5, 11, 1),
  forest: place('forest', 'Forest clearing', 'ForestClearing', 40, 27.5, 1.2),
  post: place('post', 'Guard post', 'GuardPost', 26, 6.8, 0.6),
};
export const PLACE_LIST = Object.values(PLACES);

export interface House {
  i: number;
  x: number;
  z: number;
  door: V2;
  wall: string;
  roof: string;
}
export const HOUSE_HALF = 1.5 * S;
const ROOFS = ['#a4553b', '#56677c', '#7a5c3c'];
const WALLS = ['#efe3cf', '#e6dccb', '#f2e8d5'];
export const HOUSES: House[] = [[16, 7], [17, 24], [24, 27], [31, 24], [41, 19], [41, 5]].map(([gx, gy], i) => {
  const c = g2w(gx, gy);
  return { i, ...c, door: { x: c.x, z: c.z + 2.4 * S }, wall: WALLS[i % 3], roof: ROOFS[i % 3] };
});

export const STALLS = [[30, 9, '#b8413a'], [33, 9, '#3d6fa3'], [36, 9, '#d49a2a']].map(([gx, gy, color]) => ({
  ...g2w(gx as number, gy as number), color: color as string, hw: 1.1 * S, hd: 0.6 * S,
}));
export const CRATES = [{ ...g2w(38, 10.8), s: 0.9 }, { ...g2w(38.4, 11.9), s: 0.8 }];
export const POND = { ...g2w(7, 8), r: 3.6 * S };
export const DOCK = { ...g2w(10.4, 9.4), angle: -0.9, w: 0.9, l: 3 };
export const TOWER = { ...g2w(26, 4), half: 0.9 * S };
export const FOUNTAIN = { x: 0, z: 0, r: 1.2 * S };
export const PLAZA_R = 4.2 * S;
export const FARM = { x0: g2w(2.5, 0).x, x1: g2w(13.5, 0).x, z0: g2w(0, 19.5).z, z1: g2w(0, 28).z };
export const BARN = { ...g2w(2.5, 29.3), half: 1.0 * S };

/** Dirt paths: [from, to, width in meters]. */
export const PATHS: [V2, V2, number][] = [
  ...(['market', 'farm', 'pond', 'forest', 'post'] as PlaceKey[]).map(k => [PLACES.square, PLACES[k], 1.4 * S] as [V2, V2, number]),
  ...HOUSES.map(h => [PLACES.square, h.door, 1.0 * S] as [V2, V2, number]),
];

export interface Tree {
  x: number;
  z: number;
  /** Crown scale. */
  s: number;
  kind: 'pine' | 'round';
  color: string;
}

/** Trees are grown procedurally from a seed, with the same rules as the mockup. */
export function growTrees(seed = 5): Tree[] {
  const rng = new Rng(seed);
  const trees: Tree[] = [];
  const colors = ['#3f7a3d', '#4d8a44', '#356b3a', '#5a8f47'];
  const blockedByStructure = (p: V2) => {
    for (const h of HOUSES) if (Math.abs(p.x - h.x) < HOUSE_HALF + 1.4 && Math.abs(p.z - h.z) < HOUSE_HALF + 1.4) return true;
    for (const s of STALLS) if (Math.abs(p.x - s.x) < s.hw + 1.2 && Math.abs(p.z - s.z) < s.hd + 1.2) return true;
    if (dist(p, POND) < POND.r + 1.6) return true;
    if (Math.abs(p.x - TOWER.x) < TOWER.half + 1.4 && Math.abs(p.z - TOWER.z) < TOWER.half + 1.4) return true;
    if (Math.abs(p.x - BARN.x) < BARN.half + 1.4 && Math.abs(p.z - BARN.z) < BARN.half + 1.4) return true;
    if (dist(p, FOUNTAIN) < PLAZA_R + 1) return true;
    return false;
  };
  const tryTree = (gx: number, gy: number) => {
    const p = g2w(gx, gy);
    if (p.x < WORLD.minX + 1 || p.x > WORLD.maxX - 1 || p.z < WORLD.minZ + 1 || p.z > WORLD.maxZ - 1) return;
    for (const [a, b] of PATHS) if (distToSegment(p, a, b) < 1.5 * S) return;
    for (const P of PLACE_LIST) if (dist(p, P) < P.r + 2 * S) return;
    if (p.x > FARM.x0 - 1 && p.x < FARM.x1 + 1 && p.z > FARM.z0 - 1 && p.z < FARM.z1 + 1) return;
    if (blockedByStructure(p)) return;
    for (const t of trees) if (dist(p, t) < 2.3) return;
    trees.push({ ...p, s: rng.range(0.85, 1.25), kind: rng.next() < 0.55 ? 'pine' : 'round', color: rng.pick(colors) });
  };
  for (let k = 0; k < 200; k++) tryTree(rng.range(35, 47), rng.range(22, 31));
  for (let k = 0; k < 160; k++) {
    const e = rng.int(4);
    tryTree(
      e === 0 ? rng.range(1, 4) : e === 1 ? rng.range(44, 47) : rng.range(1, 47),
      e === 2 ? rng.range(1, 3) : e === 3 ? rng.range(29, 31) : rng.range(1, 31),
    );
  }
  return trees;
}

export const TREES = growTrees();

/** Nearest named place to a point (used for log messages such as "a fire near the Pond"). */
export function placeName(p: V2) {
  let best = PLACE_LIST[0], bd = Infinity;
  for (const P of PLACE_LIST) {
    const d = dist(p, P);
    if (d < bd) { bd = d; best = P; }
  }
  return best.name;
}

export interface SafeSpot {
  name: string;
  cmd: string;
  x: number;
  z: number;
}

/** Candidate evacuation targets: every place except the guard post, plus every house door. */
export const SAFE_SPOTS: SafeSpot[] = [
  ...PLACE_LIST.filter(p => p.key !== 'post').map(p => ({ name: `the ${p.name}`, cmd: p.cmd, x: p.x, z: p.z })),
  ...HOUSES.map(h => ({ name: `house ${h.i + 1}`, cmd: `House${h.i + 1}`, x: h.door.x, z: h.door.z + 0.8 })),
];
export const spotByCmd = (cmd: string) => SAFE_SPOTS.find(s => s.cmd === cmd);
