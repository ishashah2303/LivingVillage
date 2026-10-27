import type { CrowdAgent } from 'recast-navigation';
import type { Trace } from './bt';
import { clamp, Rng, type V2 } from './math';

export type Role = 'farmer' | 'merchant' | 'guard' | 'fisher' | 'woodcutter' | 'villager';
export type Activity =
  | 'walk' | 'idle' | 'chores' | 'work' | 'eat' | 'forage' | 'sleep' | 'social' | 'dance' | 'shelter' | 'douse';
export type DecisionSource = 'routine' | 'need' | 'reflex' | 'planner' | 'social' | 'event';

export interface Goal {
  /** Identity of the goal. A new key means a new destination; the same key means "keep going". */
  key: string;
  label: string;
  x: number;
  z: number;
  /** What the villager does once it arrives. */
  act: Activity;
  run?: boolean;
  /** High-level command this goal executes, e.g. EVACUATE(ForestClearing). */
  cmd?: string;
  source: DecisionSource;
  /** Follow another villager (target is re-read every tick). */
  follow?: number;
  fireId?: number;
  pileId?: number;
  /** Goes inside on arrival (hidden from the map). */
  indoors?: boolean;
}

export interface Memory {
  day: number;
  t: string;
  text: string;
  /** 1-10. Drives which memories the (future) LLM layer retrieves first. */
  importance: number;
}

export interface FleeTarget {
  name: string;
  cmd: string;
  x: number;
  z: number;
  source: 'reflex' | 'planner';
  latencyMs?: number;
}

export interface Villager {
  id: number;
  name: string;
  role: Role;
  color: string;
  home: number;
  walkSpeed: number;
  runSpeed: number;
  /** Personal offsets so villagers spread out instead of stacking on one point. */
  ang: number;
  rad: number;
  ox: number;
  oz: number;

  hunger: number;
  energy: number;
  social: number;
  /** Hysteresis latches: hungry above 75 until below 15, tired below 15 until above 85. */
  hungry: boolean;
  tired: boolean;
  /** 0-100. Smoke and starvation hurt only when the game's harm rule is on (Fire Season). */
  health: number;
  /** Health reached 0: taken to the healer, off the map for the rest of the game. */
  injured: boolean;

  memory: Memory[];
  rel: Record<number, number>;
  /** Places this villager avoids after a bad experience, with the day the fear fades. */
  fear: Partial<Record<string, number>>;

  trace: Trace;
  thinkIn: number;
  goal: Goal | null;
  act: Activity;
  flee: Record<number, FleeTarget>;
  help: { victim: number; fireId: number; until: number; source: 'planner' } | null;
  investigate: number | null;
  lastCmd: string | null;
  /** The last planner command this villager accepted, with the planner's own reason (shown in the inspector). */
  plannerNote: { cmd: string; reason: string; planner: string; latencyMs: number } | null;

  agent: CrowdAgent | null;
  target: V2 | null;
  moveT: number;
  stuckT: number;
  retries: number;
  /** Seconds left on a sidestep detour before resuming the real target. */
  detourT: number;
  nudged: boolean;
  pos: V2;
  prev: V2;
  heading: number;
  speed: number;
  visible: boolean;
  /** Distance walked, drives the procedural walk cycle so feet do not slide. */
  stride: number;

  say: string;
  sayT: number;
}

export const ROLE_LABEL: Record<Role, string> = {
  farmer: 'Farmer', merchant: 'Merchant', guard: 'Guard', fisher: 'Fisher', woodcutter: 'Woodcutter', villager: 'Villager',
};

/** Same eight villagers as the 2D mockup: [name, role, color, home]. */
export const VILLAGER_DEFS: [string, Role, string, number][] = [
  ['Maya', 'farmer', '#c9853a', 0], ['Ravi', 'merchant', '#3d6fa3', 1], ['Tomas', 'guard', '#5d6470', 2],
  ['Elena', 'fisher', '#3f8f86', 3], ['Jonah', 'woodcutter', '#7a4b33', 4], ['Priya', 'merchant', '#a94c7a', 1],
  ['Oskar', 'farmer', '#8e9a3a', 5], ['Lina', 'villager', '#d0674b', 0],
];

/** Pairs with a history: [a, b, bond]. */
const FRIENDSHIPS: [number, number, number][] = [[0, 6, 85], [1, 5, 80], [3, 7, 78], [2, 4, 72], [0, 7, 74]];

export function createVillagers(rng: Rng, spawn: (home: number) => V2): Villager[] {
  const vs: Villager[] = VILLAGER_DEFS.map(([name, role, color, home], id) => {
    const p = spawn(home);
    return {
      id, name, role, color, home,
      walkSpeed: rng.range(1.9, 2.3), runSpeed: rng.range(4.0, 4.6),
      ang: rng.range(0, Math.PI * 2), rad: rng.next(), ox: rng.range(-1, 1), oz: rng.range(-1, 1),
      hunger: rng.range(10, 45), energy: rng.range(65, 95), social: rng.range(20, 60),
      hungry: false, tired: false, health: 100, injured: false,
      memory: [], rel: {}, fear: {},
      trace: new Map(), thinkIn: rng.range(0, 0.4), goal: null, act: 'idle',
      flee: {}, help: null, investigate: null, lastCmd: null, plannerNote: null,
      agent: null, target: null, moveT: 0, stuckT: 0, retries: 0, detourT: 0, nudged: false,
      pos: { ...p }, prev: { ...p }, heading: 0, speed: 0, visible: true, stride: 0,
      say: '', sayT: 0,
    };
  });
  for (const a of vs) for (const b of vs) if (a !== b) a.rel[b.id] = Math.round(rng.range(15, 70));
  for (const [a, b, v] of FRIENDSHIPS) { vs[a].rel[b] = v; vs[b].rel[a] = v; }
  return vs;
}

export const bond = (a: Villager, b: Villager, delta: number) => {
  a.rel[b.id] = clamp(a.rel[b.id] + delta, 0, 100);
  b.rel[a.id] = clamp(b.rel[a.id] + delta, 0, 100);
};

export const say = (v: Villager, text: string, seconds = 2.5) => {
  v.say = text;
  v.sayT = seconds;
};
