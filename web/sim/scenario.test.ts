/**
 * Scenario tests: the real navmesh (WebAssembly), the real behavior tree, headless.
 * "Believable" can't be unit-tested, but these invariants can: nobody walks into a fire,
 * nobody stays stuck, the guard does its job, stale planner commands are refused.
 */
import { describe, expect, it } from 'vitest';
import { LocalPlanner } from './localPlanner';
import { dist } from './math';
import { ruleBasedPlan } from './planner';
import { spotByCmd } from './layout';
import { DT, Simulation } from './simulation';

const run = (sim: Simulation, seconds: number, each?: () => void) => {
  for (let t = 0; t < seconds; t += DT) {
    sim.step(DT);
    each?.();
  }
};

const workingVillage = async () => {
  const sim = await Simulation.create({ seed: 5 });
  sim.hour = 10;
  run(sim, 25);
  return sim;
};

describe('scenario: a fire breaks out next to Maya', () => {
  it('nearby villagers get clear, never enter the fire, and the guard puts it out', async () => {
    const sim = await workingVillage();
    const fire = sim.startFireNear('Maya')!;
    expect(fire).not.toBeNull();
    const nearby = sim.villagers.filter(v => v.role !== 'guard' && v.visible && dist(v.pos, fire) < 11);
    expect(nearby.map(v => v.name)).toContain('Maya');

    let closest = Infinity;
    run(sim, 15, () => {
      for (const v of sim.villagers) if (v.visible && fire.alive) closest = Math.min(closest, dist(v.pos, fire));
    });
    expect(closest).toBeGreaterThan(2.0); // the carved obstacle keeps everyone out of the flames
    for (const v of nearby) expect(dist(v.pos, fire)).toBeGreaterThan(12);
    expect(nearby.every(v => v.memory.some(m => m.text.includes('Saw a fire')))).toBe(true);

    run(sim, 30);
    expect(fire.alive).toBe(false);
    expect(fire.hp).toBeLessThanOrEqual(0); // put out by Tomas, not burned out
    expect(sim.villagers.find(v => v.name === 'Tomas')!.memory[0].text).toContain('Put out the fire');
  });

  it('applies a coordinated plan from the planner and spreads evacuees over safe spots', async () => {
    const sim = await workingVillage();
    sim.planner = new LocalPlanner();
    sim.plannerLatencyMs = 0;
    sim.startFireNear('Maya');
    await new Promise(r => setTimeout(r, 20));
    expect(sim.stats.accepted).toBeGreaterThan(0);
    const targets = sim.villagers.flatMap(v => Object.values(v.flee)).filter(t => t.source === 'planner');
    expect(targets.length).toBeGreaterThan(0);
    const perSpot = new Map<string, number>();
    for (const t of targets) perSpot.set(t.cmd, (perSpot.get(t.cmd) ?? 0) + 1);
    expect(Math.max(...perSpot.values())).toBeLessThanOrEqual(3);
  });

  it('refuses a stale command whose target caught fire while the planner was thinking', async () => {
    const sim = await workingVillage();
    const fire = sim.startFireNear('Maya')!;
    const report = sim.situationReport('fire_started');
    const plan = ruleBasedPlan(report);
    const evac = plan.find(c => c.verb === 'EVACUATE')!;
    const target = spotByCmd(evac.arg)!;
    // While the plan is "in flight", a second fire starts right next to the chosen target.
    let second = null;
    for (let k = 0; k < 16 && !second; k++) second = sim.startFire({ x: target.x + Math.cos(k) * 3, z: target.z + Math.sin(k) * 3 });
    expect(second).not.toBeNull();
    const before = sim.stats.rejected;
    sim.applyPlan({ source: 'local', planner: 'test', commands: [evac] }, report.version, performance.now() - 1500);
    expect(sim.stats.rejected).toBe(before + 1);
    expect(sim.log.some(l => l.kind === 'reject' && l.text.includes(evac.arg))).toBe(true);
    expect(fire.alive).toBe(true);
  });
});

describe('scenario: the user drops obstacles on busy paths', () => {
  it('agents under a new rock are pushed out and everyone keeps moving', async () => {
    const sim = await workingVillage();
    const walker = sim.villagers.find(v => v.visible && v.name !== 'Tomas')!;
    const rock = sim.addRock({ x: walker.pos.x + 0.2, z: walker.pos.z })!;
    expect(rock).not.toBeNull();
    expect(dist(walker.pos, rock)).toBeGreaterThan(1.25 + 0.4);
    // Block the main road between the square and the market too.
    sim.addRock({ x: 5, z: -2.5 });
    run(sim, 40);
    expect(sim.villagers.filter(v => v.agent && v.agent.state() === 0)).toHaveLength(0); // no invalid (off-mesh) agents
    for (const v of sim.villagers) if (v.visible) for (const r of sim.items) if (r.kind === 'rock') expect(dist(v.pos, r)).toBeGreaterThan(1.25);
  });
});

describe('boids', () => {
  it('birds keep their distance and stay clear of a fire', async () => {
    const sim = await workingVillage();
    const fire = sim.startFire({ x: 0, z: 3.5 }) ?? sim.startFireNear('Ravi')!;
    const B = sim.flock.birds;
    let closest = Infinity, minPair = Infinity;
    run(sim, 3);
    run(sim, 10, () => {
      for (const b of B) closest = Math.min(closest, Math.hypot(b.x - fire.x, b.z - fire.z));
    });
    for (let i = 0; i < B.length; i++)
      for (let j = i + 1; j < B.length; j++) minPair = Math.min(minPair, Math.hypot(B[i].x - B[j].x, B[i].y - B[j].y, B[i].z - B[j].z));
    expect(closest).toBeGreaterThan(4);
    expect(minPair).toBeGreaterThan(0.2);
  });
});

describe('soak: a full day', () => {
  it('runs a whole day with a festival; everyone is home asleep after midnight', async () => {
    const sim = await Simulation.create({ seed: 5 });
    let festivalStarted = false, maxDancers = 0;
    let t = 0;
    // The festival lasts 35 s of sim time (5.6 in-game hours), so it runs from 16:30 to ~22:00.
    while (sim.day === 1 || sim.hour < 0.5) {
      sim.step(DT);
      t += DT;
      if (!festivalStarted && sim.hour >= 16.5) { sim.setFestival(true); festivalStarted = true; }
      maxDancers = Math.max(maxDancers, sim.villagers.filter(v => v.act === 'dance').length);
    }
    expect(maxDancers).toBeGreaterThanOrEqual(6);
    expect(sim.villagers.filter(v => v.visible).map(v => v.name)).toEqual([]);
    expect(sim.villagers.every(v => v.memory.some(m => m.text === 'Danced at the festival'))).toBe(true);
    const minutes = t / 60;
    // Dithering metric: goal switches per villager per real minute at 1x.
    const switchesPerMin = sim.stats.goalSwitches / sim.villagers.length / minutes;
    expect(switchesPerMin).toBeLessThan(12);
    console.log(`goal switches/villager/min: ${switchesPerMin.toFixed(1)}, stuck recoveries: ${sim.stats.stuckRecoveries}, navmesh rebuilds: ${sim.stats.rebuilds}`);
  });
});
