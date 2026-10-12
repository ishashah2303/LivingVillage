import { describe, expect, it } from 'vitest';
import type { Villager } from './agents';
import { spotByCmd } from './layout';
import { ruleBasedPlan, validateCommand, type GateWorld, type SituationReport } from './planner';
import { allSpots } from './planner';

const agent = (id: number, name: string, role: string, x: number, z: number, rel: Record<string, number> = {}) => ({
  id, name, role, x, z, activity: 'work', fleeingTo: null as string | null, rel,
});

const report = (over: Partial<SituationReport> = {}): SituationReport => ({
  version: 3, day: 1, clock: '10:00', trigger: 'fire_started',
  fires: [{ id: 1, x: -17, z: 0, place: 'Pond' }],
  spots: allSpots(),
  agents: [
    agent(0, 'Maya', 'farmer', -18, 4, { Oskar: 85, Lina: 74 }),
    agent(3, 'Elena', 'fisher', -15, -5, { Lina: 78 }),
    agent(6, 'Oskar', 'farmer', -19, 9, { Maya: 85 }),
    agent(2, 'Tomas', 'guard', 5, -12),
    agent(7, 'Lina', 'villager', 10, 5, { Maya: 74, Elena: 78 }),
  ],
  ...over,
});

describe('rule-based planner', () => {
  it('sends the guard, evacuates everyone at risk and asks a friend to help', () => {
    const cmds = ruleBasedPlan(report());
    expect(cmds).toContainEqual(expect.objectContaining({ agent: 'Tomas', verb: 'INVESTIGATE', arg: 'Fire#1' }));
    const evac = cmds.filter(c => c.verb === 'EVACUATE').map(c => c.agent).sort();
    expect(evac).toEqual(['Elena', 'Maya', 'Oskar']);
    // Maya is closest to the fire; Lina is her closest friend who is not in danger (Oskar is).
    expect(cmds).toContainEqual(expect.objectContaining({ agent: 'Lina', verb: 'HELP_AGENT', arg: 'Maya' }));
  });

  it('only sends villagers to spots far from every fire, and spreads them out', () => {
    const cmds = ruleBasedPlan(report()).filter(c => c.verb === 'EVACUATE');
    for (const c of cmds) {
      const s = spotByCmd(c.arg)!;
      expect(Math.hypot(s.x + 17, s.z)).toBeGreaterThanOrEqual(15);
    }
    const counts = new Map<string, number>();
    for (const c of cmds) counts.set(c.arg, (counts.get(c.arg) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(3);
  });

  it('returns nothing when no fire is burning', () => {
    expect(ruleBasedPlan(report({ fires: [] }))).toEqual([]);
  });
});

describe('command gate', () => {
  const villager = (name: string, role: string, x: number, z: number) => ({ name, role, pos: { x, z } }) as unknown as Villager;
  const maya = villager('Maya', 'farmer', -18, 4), lina = villager('Lina', 'villager', 10, 5), tomas = villager('Tomas', 'guard', 5, -12);
  const world = (fires: { x: number; z: number }[], reachable = true): GateWorld => ({
    villagerByName: n => [maya, lina, tomas].find(v => v.name === n),
    fireById: id => (id === 1 ? { id: 1, alive: fires.length > 0 } : undefined),
    aliveFires: () => fires,
    reachable: () => reachable,
  });
  const cmd = (agent: string, verb: string, arg: string) => ({ agent, verb, arg, reason: '', ttlS: 20 });

  it('accepts a grounded, still-valid command', () => {
    expect(validateCommand(world([{ x: -17, z: 0 }]), cmd('Maya', 'EVACUATE', 'ForestClearing'), 1.5)).toEqual({ ok: true });
  });

  it('rejects names that do not exist (hallucinated targets)', () => {
    expect(validateCommand(world([{ x: -17, z: 0 }]), cmd('Mia', 'EVACUATE', 'ForestClearing'), 1).ok).toBe(false);
    expect(validateCommand(world([{ x: -17, z: 0 }]), cmd('Maya', 'EVACUATE', 'Castle'), 1).ok).toBe(false);
    expect(validateCommand(world([{ x: -17, z: 0 }]), cmd('Maya', 'TELEPORT', 'Farm'), 1).ok).toBe(false);
  });

  it('re-checks safety at arrival time: a target that caught fire meanwhile is rejected', () => {
    const forest = spotByCmd('ForestClearing')!;
    const v = validateCommand(world([{ x: -17, z: 0 }, { x: forest.x + 3, z: forest.z }]), cmd('Maya', 'EVACUATE', 'ForestClearing'), 2);
    expect(v).toEqual({ ok: false, reason: expect.stringContaining('only 3.0 m from a fire') });
  });

  it('rejects stale help once the victim is already safe, and expired commands', () => {
    const farFire = [{ x: 25, z: -18 }];
    expect(validateCommand(world(farFire), cmd('Lina', 'HELP_AGENT', 'Maya'), 1)).toEqual({ ok: false, reason: 'Maya already reached safety' });
    expect(validateCommand(world([{ x: -17, z: 0 }]), cmd('Maya', 'EVACUATE', 'ForestClearing'), 25).ok).toBe(false);
  });

  it('rejects unreachable targets and role mismatches', () => {
    expect(validateCommand(world([{ x: -17, z: 0 }], false), cmd('Maya', 'EVACUATE', 'ForestClearing'), 1).ok).toBe(false);
    expect(validateCommand(world([{ x: -17, z: 0 }]), cmd('Maya', 'INVESTIGATE', 'Fire#1'), 1).ok).toBe(false);
    expect(validateCommand(world([{ x: -17, z: 0 }]), cmd('Tomas', 'INVESTIGATE', 'Fire#1'), 1).ok).toBe(true);
  });
});
