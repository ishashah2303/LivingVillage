/**
 * Game-loop tests: whole Fire Season games played headless on the real navmesh. An idle player
 * must lose (the challenge is real) and a simple bot player must win (it is fair). Plus the
 * stability cases a menu and restarts introduce.
 */
import { describe, expect, it } from 'vitest';
import { Game, SEASON } from './game';
import { LocalPlanner } from './localPlanner';
import { dist } from './math';
import { ruleBasedPlan, validateCommand } from './planner';
import { DT, FIRE, Simulation } from './simulation';

type Policy = (g: Game) => void;

/** Plays until the game ends, calling the policy twice per simulated second. */
const play = (g: Game, policy?: Policy) => {
  for (let k = 0; !g.outcome && k < (SEASON.duration + 5) / DT; k++) {
    g.sim.step(DT);
    if (policy && k % 15 === 0) policy(g);
  }
  return g.outcome!;
};

/** Waters the weakest fire whenever a bucket is ready; rings the bell when a new fire starts. */
const bot: Policy = g => {
  const fires = g.sim.aliveFires();
  if (!fires.length) return;
  const newest = fires.reduce((a, b) => (b.startedAt > a.startedAt ? b : a));
  if (g.sim.simTime - newest.startedAt < 1) g.ringAlarm();
  if (g.water >= 1) g.useWater(fires.reduce((a, b) => (b.hp < a.hp ? b : a)));
};

const challenge = async (seed: number) => new Game(await Simulation.create({ seed }), 'challenge');

describe('Fire Season', () => {
  it.each([5, 11, 23])('an idle player loses (seed %i)', async seed => {
    const g = await challenge(seed);
    const o = play(g);
    expect(o.result).toBe('lost');
    expect(o.stars).toBe(0);
    expect(g.sim.speed).toBe(0); // the end state freezes the world
    expect(g.sim.stats.firesStarted).toBeGreaterThan(5);
  });

  it.each([5, 11, 23])('a simple bot player wins (seed %i)', async seed => {
    const g = await challenge(seed);
    const o = play(g, bot);
    expect(o.result).toBe('won');
    expect(o.stars).toBeGreaterThan(0);
    expect(g.integrity).toBeGreaterThan(30);
    expect(g.sim.stats.firesOut).toBe(g.sim.stats.firesStarted);
  });

  it('an unattended fire spreads once; buckets recharge and run out', async () => {
    const g = await challenge(5);
    g.sim.onStep = null; // no director: one controlled fire
    const f = g.sim.startFire({ x: 8, z: 8 })!;
    g.sim.villagers.find(v => v.role === 'guard')!.injured = true; // nobody fights it
    for (let t = 0; t < 18; t += DT) g.sim.step(DT);
    expect(f.spread).toBe(true);
    expect(g.sim.aliveFires().length).toBe(2);

    const child = g.sim.aliveFires().find(o => o !== f)!;
    expect(g.useWater(f)).not.toBeNull();
    expect(g.useWater(f)).not.toBeNull(); // two buckets put a fire out
    expect(f.alive).toBe(false);
    expect(g.useWater(child)).not.toBeNull();
    expect(g.useWater(child)).toBeNull(); // out of water
    g.update(SEASON.water.recharge);
    expect(g.water).toBeGreaterThanOrEqual(1);
  });

  it('smoke hurts, a hurt guard backs off, and the gate refuses commands for the injured', async () => {
    const g = await challenge(5);
    g.sim.onStep = null;
    g.sim.hour = 10;
    for (let t = 0; t < 5; t += DT) g.sim.step(DT);
    const maya = g.sim.villagers[0];
    maya.health = 1;
    const f = g.sim.startFireNear('Maya')!;
    maya.agent!.teleport({ x: f.x + FIRE.blockRadius + 0.5, y: 0.2, z: f.z });
    maya.pos = { x: f.x + FIRE.blockRadius + 0.5, z: f.z };
    for (let t = 0; t < 0.5; t += DT) g.sim.step(DT);
    expect(maya.injured).toBe(true);
    expect(maya.visible).toBe(false);
    expect(g.sim.situationReport('t').agents.some(a => a.name === 'Maya')).toBe(false);
    const verdict = validateCommand(g.sim, { agent: 'Maya', verb: 'EVACUATE', arg: 'Farm', reason: '', ttlS: 20 }, 0);
    expect(verdict.ok).toBe(false);

    const tomas = g.sim.villagers.find(v => v.role === 'guard')!;
    tomas.health = 20;
    for (let t = 0; t < 2; t += DT) g.sim.step(DT);
    expect(tomas.goal?.key.startsWith('douse')).toBe(false);
    expect(dist(tomas.pos, f)).toBeGreaterThan(FIRE.blockRadius);
  });

  it('the alarm evacuates everyone near a fire and has a cooldown', async () => {
    const g = await challenge(5);
    g.sim.onStep = null;
    g.sim.hour = 10;
    for (let t = 0; t < 20; t += DT) g.sim.step(DT);
    expect(g.ringAlarm()).toBe(false); // nothing is burning: the bell keeps its charge
    const f = g.sim.startFireNear('Maya')!;
    const near = g.sim.villagers.filter(v => v.visible && v.role !== 'guard' && dist(v.pos, f) < 20);
    expect(g.ringAlarm()).toBe(true);
    expect(near.every(v => v.flee[f.id])).toBe(true);
    expect(g.ringAlarm()).toBe(false);
  });
});

describe('stability across restarts', () => {
  it('a planner reply that lands after the game was disposed is ignored', async () => {
    const sim = await Simulation.create({ seed: 5 });
    sim.planner = new LocalPlanner();
    sim.plannerLatencyMs = 30;
    sim.hour = 10;
    for (let t = 0; t < 5; t += DT) sim.step(DT);
    sim.startFireNear('Maya');
    expect(sim.pendingPlans).toBe(1);
    sim.dispose();
    await new Promise(r => setTimeout(r, 60));
    expect(sim.stats.plans).toBe(0);
    expect(sim.startFire({ x: 8, z: 8 })).toBeNull();
    sim.advance(1); // no-op, no crash on the freed navmesh
    // A stale command checked against a fresh game is judged on that game's world.
    const next = await Simulation.create({ seed: 6 });
    const cmd = ruleBasedPlan(sim.situationReport('t'))[0];
    if (cmd) expect(validateCommand(next, cmd, 0).ok).toBe(false); // no fire burns in the new game
    next.dispose();
  });

  it('sandbox ends only when the player ends the session', async () => {
    const g = new Game(await Simulation.create({ seed: 5 }), 'sandbox');
    for (let t = 0; t < SEASON.duration + 10; t += DT) g.sim.step(DT);
    expect(g.outcome).toBeNull();
    expect(g.sim.rules).toEqual({ harm: false, spread: false });
    g.end();
    expect(g.outcome?.result).toBe('ended');
    g.sim.dispose();
  });
});
