/**
 * Deliberative layer: the "planner" that coordinates villagers during an emergency.
 *
 * Today it is rule-based (and runs on the FastAPI server, with this TypeScript copy as an
 * offline fallback). Later an LLM will produce the same commands. Either way, commands are
 * untrusted until they pass the client-side gate below, because they are computed on a
 * snapshot of the world that may be seconds old by the time they arrive.
 */
import type { Villager } from './agents';
import { SAFE_SPOTS, spotByCmd } from './layout';
import { distXZ, type V2 } from './math';

export type Verb = 'EVACUATE' | 'INVESTIGATE' | 'HELP_AGENT';
export const VERBS: Verb[] = ['EVACUATE', 'INVESTIGATE', 'HELP_AGENT'];

export interface Command {
  agent: string;
  verb: string;
  arg: string;
  reason: string;
  ttlS: number;
}

export interface PlanResult {
  source: 'server' | 'local';
  planner: string;
  commands: Command[];
  /** One-sentence explanation of the whole plan (the LLM writes one; the rules don't). */
  summary?: string;
  /** Server notes: why the LLM was skipped, or which of its commands were dropped as ungrounded. */
  notes?: string[];
  /** Model id that answered ("rules" for the rule-based planner). */
  model?: string;
  /** Tokens and list-price cost of the LLM call, when there was one. */
  usage?: { inputTokens: number; outputTokens: number; costUsd: number } | null;
}

export interface SituationReport {
  version: number;
  day: number;
  clock: string;
  trigger: string;
  fires: { id: number; x: number; z: number; place: string }[];
  spots: { cmd: string; name: string; x: number; z: number }[];
  agents: {
    id: number;
    name: string;
    role: string;
    x: number;
    z: number;
    activity: string;
    fleeingTo: string | null;
    rel: Record<string, number>;
  }[];
}

export const PLAN = { atRiskRadius: 14, safeDistance: 15, spotCapacity: 3, crowdPenalty: 6, helpBond: 50 };

/** Mirror of server/app/planner.py (keep the two in sync; both are covered by tests). */
export function ruleBasedPlan(r: SituationReport): Command[] {
  const cmds: Command[] = [];
  if (!r.fires.length) return cmds;
  const d = (a: V2, b: V2) => distXZ(a.x, a.z, b.x, b.z);
  const fireDist = (p: V2) => Math.min(...r.fires.map(f => d(p, f)));

  // 1. The guard investigates the newest fire.
  const newest = r.fires.reduce((a, b) => (b.id > a.id ? b : a));
  for (const g of r.agents.filter(a => a.role === 'guard'))
    cmds.push({ agent: g.name, verb: 'INVESTIGATE', arg: `Fire#${newest.id}`, reason: `guard on duty; fire near the ${newest.place}`, ttlS: 30 });

  // 2. Evacuate everyone at risk, spreading them over safe spots (a greedy reflex would send them all to one).
  const atRisk = r.agents.filter(a => a.role !== 'guard' && fireDist(a) < PLAN.atRiskRadius).sort((a, b) => fireDist(a) - fireDist(b));
  const safe = r.spots.filter(s => fireDist(s) >= PLAN.safeDistance);
  const load: Record<string, number> = {};
  for (const a of atRisk) {
    const current = a.fleeingTo ? safe.find(s => s.cmd === a.fleeingTo) : undefined;
    let best = current && (load[current.cmd] ?? 0) < PLAN.spotCapacity ? current : undefined;
    if (!best) {
      let bestScore = Infinity;
      for (const s of safe) {
        const n = load[s.cmd] ?? 0;
        if (n >= PLAN.spotCapacity) continue;
        const score = d(a, s) + n * PLAN.crowdPenalty - 0.3 * fireDist(s);
        if (score < bestScore) { bestScore = score; best = s; }
      }
    }
    if (!best) continue;
    load[best.cmd] = (load[best.cmd] ?? 0) + 1;
    cmds.push({
      agent: a.name, verb: 'EVACUATE', arg: best.cmd, ttlS: 20,
      reason: best === current
        ? `keep current target, still ${Math.round(fireDist(best))} m from the fire`
        : `${best.name} is ${Math.round(fireDist(best))} m from the fire (${load[best.cmd]} assigned)`,
    });
  }

  // 3. The victim's closest friend who is not in danger goes to help.
  const victim = atRisk[0];
  if (victim) {
    const helper = r.agents
      .filter(a => a.role !== 'guard' && a.name !== victim.name && fireDist(a) >= PLAN.atRiskRadius)
      .sort((a, b) => (victim.rel[b.name] ?? 0) - (victim.rel[a.name] ?? 0))[0];
    const bondValue = helper ? victim.rel[helper.name] ?? 0 : 0;
    if (helper && bondValue > PLAN.helpBond)
      cmds.push({ agent: helper.name, verb: 'HELP_AGENT', arg: victim.name, reason: `${victim.name}'s closest friend (bond ${bondValue}) and not in danger`, ttlS: 25 });
  }
  return cmds;
}

/* ---------------- command gate ---------------- */

export const GATE = { safeDistance: 12, dangerRadius: 14 };

export interface GateWorld {
  villagerByName(name: string): Villager | undefined;
  fireById(id: number): { id: number; alive: boolean } | undefined;
  aliveFires(): V2[];
  reachable(from: V2, to: V2): boolean;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

export const inDanger = (v: Villager, fires: V2[]) =>
  fires.some(f => distXZ(v.pos.x, v.pos.z, f.x, f.z) < GATE.dangerRadius);

/**
 * Grounding + freshness checks: names must exist, preconditions must still hold *now*,
 * and stale commands are re-validated against the current world instead of trusted.
 */
export function validateCommand(w: GateWorld, c: Command, ageS: number): Verdict {
  const v = w.villagerByName(c.agent);
  if (!v) return { ok: false, reason: `unknown villager "${c.agent}"` };
  if (v.injured) return { ok: false, reason: `${v.name} is injured and with the healer` };
  if (ageS > c.ttlS) return { ok: false, reason: `expired (${ageS.toFixed(1)} s old, ttl ${c.ttlS} s)` };
  const fires = w.aliveFires();
  switch (c.verb) {
    case 'EVACUATE': {
      const s = spotByCmd(c.arg);
      if (!s) return { ok: false, reason: `unknown place "${c.arg}"` };
      if (!fires.length) return { ok: false, reason: 'no fire is burning any more' };
      const fd = Math.min(...fires.map(f => distXZ(s.x, s.z, f.x, f.z)));
      if (fd < GATE.safeDistance) return { ok: false, reason: `${s.cmd} is now only ${fd.toFixed(1)} m from a fire (needs ${GATE.safeDistance} m)` };
      if (!w.reachable(v.pos, s)) return { ok: false, reason: `${s.cmd} is unreachable from ${v.name}'s position` };
      return { ok: true };
    }
    case 'INVESTIGATE': {
      const f = w.fireById(Number(c.arg.replace(/^Fire#/, '')));
      if (!f || !f.alive) return { ok: false, reason: `${c.arg} is already out` };
      if (v.role !== 'guard') return { ok: false, reason: `${v.name} is not a guard` };
      return { ok: true };
    }
    case 'HELP_AGENT': {
      const victim = w.villagerByName(c.arg);
      if (!victim) return { ok: false, reason: `unknown villager "${c.arg}"` };
      if (victim.injured) return { ok: false, reason: `${victim.name} is already with the healer` };
      if (!inDanger(victim, fires)) return { ok: false, reason: `${victim.name} already reached safety` };
      if (inDanger(v, fires)) return { ok: false, reason: `${v.name} is in danger too` };
      return { ok: true };
    }
    default:
      return { ok: false, reason: `unknown command "${c.verb}"` };
  }
}

export const allSpots = () => SAFE_SPOTS.map(s => ({ cmd: s.cmd, name: s.name, x: s.x, z: s.z }));
