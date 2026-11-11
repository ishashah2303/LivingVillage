import { describe, expect, it } from 'vitest';
import { CROWD_PRESETS, createVillagers } from './agents';
import { Rng, dist } from './math';
import { ruleBasedPlan } from './planner';
import { DT, Simulation } from './simulation';
import { FrameBenchmark, type FrameSetup } from './frameBenchmark';

describe('crowd scaling', () => {
  it('preserves the original cast and makes deterministic, uniquely addressable extra residents', () => {
    const make = (count: number) => createVillagers(new Rng(5), home => ({ x: home, z: 0 }), count);
    expect(make(8).map(v => v.name)).toEqual(['Maya', 'Ravi', 'Tomas', 'Elena', 'Jonah', 'Priya', 'Oskar', 'Lina']);
    const crowd = make(64);
    expect(crowd).toEqual(make(64));
    expect(new Set(crowd.map(v => v.name)).size).toBe(64);
    for (const [i, v] of crowd.entries()) {
      expect(v.id).toBe(i);
      expect(Object.keys(v.rel)).toHaveLength(63);
    }
  });

  it('rejects unsupported counts before allocating a navmesh', async () => {
    for (const count of [0, 7, 65, 8.5, NaN])
      await expect(Simulation.create({ villagerCount: count })).rejects.toThrow(RangeError);
  });

  it.each(CROWD_PRESETS)('%i real crowd agents can navigate and process a fire after obstacle edits', async count => {
    const sim = await Simulation.create({ seed: 5, villagerCount: count });
    try {
      sim.hour = 10;
      const initial = sim.villagers.map(v => ({ ...v.pos }));
      expect(sim.villagers.filter(v => v.agent && v.agent.state() !== 0)).toHaveLength(count);
      for (let i = 0; i < 600; i++) sim.step(DT);
      expect(sim.villagers.filter((v, i) => dist(v.pos, initial[i]) > 2).length).toBeGreaterThan(count * 0.75);
      expect(sim.scatterObstacles(20)).toBe(20);
      const fire = sim.startFireNear('Maya');
      expect(fire).not.toBeNull();
      const report = sim.situationReport('fire_started');
      expect(report.agents).toHaveLength(count);
      sim.applyPlan({ source: 'local', planner: 'test', commands: ruleBasedPlan(report) }, report.version, performance.now());
      expect(sim.stats.accepted).toBeGreaterThan(0);
      for (let i = 0; i < 900; i++) sim.step(DT);
      for (const v of sim.villagers) {
        expect(Number.isFinite(v.pos.x) && Number.isFinite(v.pos.z)).toBe(true);
        if (v.agent) expect(v.agent.state()).not.toBe(0);
      }
      expect(sim.villagers.every(v => v.trace.size > 0)).toBe(true);
      // No arrival-time or evacuation guarantee here: congestion is measured separately.
    } finally { sim.dispose(); }
  });
});

describe('frame capture', () => {
  const setup: FrameSetup = { villagers: 8, birds: 40, grid: true, speed: 1, obstacles: 75,
    paths: true, navmesh: false, perception: false, obstacleOverlay: false, width: 800, height: 600 };
  it('excludes warm-up, retains the slow-frame tail, and records resolution changes', () => {
    const b = new FrameBenchmark();
    b.start(setup);
    for (let i = 0; i < 30; i++) b.record(100, 50, 1.5, 500, setup, false);
    for (let i = 0; i < 100; i++) b.record(100, 2, i < 50 ? 1.5 : 1, 200, setup, false);
    expect(b.active).toBe(false);
    expect(b.results[0]).toMatchObject({ fps: 10, p95FrameMs: 100, p95SimMs: 2, frames: 100, over33Ms: 100, dprMin: 1, dprMax: 1.5 });
  });
  it('discards interrupted or mixed-configuration runs', () => {
    const b = new FrameBenchmark();
    b.start(setup);
    b.record(16, 1, 1, 200, { ...setup, speed: 3 }, false);
    expect(b.active).toBe(false);
    b.start(setup);
    b.record(16, 1, 1, 200, setup, true);
    expect(b.results).toHaveLength(0);
    expect(b.active).toBe(false);
  });
  it('keeps Fire Season captures running while fires change navigation obstacles', () => {
    const b = new FrameBenchmark();
    const challenge = { ...setup, mode: 'challenge' as const };
    b.start(challenge);
    for (let i = 0; i < 30; i++) b.record(100, 1, 1, 200, challenge, false);
    for (let i = 0; i < 100; i++) b.record(100, 1, 1, 200, { ...challenge, obstacles: i < 50 ? 76 : 77 }, false);
    expect(b.results[0]).toMatchObject({ obstaclesMin: 75, obstaclesMax: 77, frames: 100 });
  });
});
