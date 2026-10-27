/**
 * Exports situation reports from real simulation runs for the LLM backbone benchmark
 * (server/bench/run_bench.py). Skipped in normal test runs; to regenerate:
 *
 *   LV_EXPORT_SCENARIOS=1 npx vitest run sim/exportScenarios.test.ts
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Game } from './game';
import type { SituationReport } from './planner';
import { DT, Simulation } from './simulation';

const run = (sim: Simulation, seconds: number) => {
  for (let t = 0; t < seconds; t += DT) sim.step(DT);
};

/** A village at `hour`, settled for a while so everyone is where their routine puts them. */
const village = async (hour: number, seed = 5) => {
  const sim = await Simulation.create({ seed });
  sim.hour = hour;
  run(sim, 25);
  return sim;
};

const OUT = '../server/bench/scenarios.json';

describe.runIf(process.env.LV_EXPORT_SCENARIOS)('export benchmark scenarios', () => {
  it('writes server/bench/scenarios.json', async () => {
    const scenarios: { id: string; about: string; report: SituationReport }[] = [];
    const add = (id: string, about: string, sim: Simulation) => {
      expect(sim.aliveFires().length).toBeGreaterThan(0);
      scenarios.push({ id, about, report: sim.situationReport('fire_started') });
    };

    let sim = await village(10);
    sim.startFireNear('Maya');
    add('maya-farm', 'One fire next to Maya at work (the Assignment 3 demo)', sim);

    sim = await village(12.4);
    sim.startFire({ x: 9, z: -3.5 });
    add('market-lunch', 'Fire at the market at lunchtime, when most villagers are there', sim);

    sim = await village(10, 7);
    sim.startFireNear('Elena');
    run(sim, 1);
    sim.startFireNear('Jonah');
    add('two-fires', 'Two fires at once in different parts of the village', sim);

    sim = await village(18.5);
    sim.setFestival(true);
    run(sim, 12);
    sim.startFire({ x: 3.2, z: 3.4 });
    add('festival-square', 'Fire beside the square during the festival: everyone is in one place', sim);

    // Mid-game Fire Season: several fires, some spreading, while people are already fleeing.
    const g = new Game(await Simulation.create({ seed: 11 }), 'challenge');
    g.sim.hour = 9;
    for (let t = 0; t < 100 && !g.outcome; t += DT) g.sim.step(DT);
    if (g.sim.aliveFires().length < 2) g.sim.startFireNear('Ravi');
    add('fire-season', 'Fire Season at 1:40: multiple fires, some villagers already fleeing', g.sim);

    writeFileSync(OUT, JSON.stringify(scenarios, null, 1));
    console.log(`wrote ${scenarios.length} scenarios to ${OUT}`);
  });
});
