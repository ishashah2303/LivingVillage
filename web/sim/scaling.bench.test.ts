/** Opt-in repeatable CPU benchmark: npm run benchmark:scale. No renderer or network calls. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { cpus, platform, arch } from 'node:os';
import { resolve } from 'node:path';
import { it } from 'vitest';
import { CROWD_PRESETS } from './agents';
import { percentile } from './frameBenchmark';
import { ruleBasedPlan } from './planner';
import { DT, Simulation } from './simulation';

it.skipIf(process.env.SCALE_BENCH !== '1')('records crowd and flock scaling with real navigation', async () => {
  const output = resolve('../docs/benchmarks/scaling-headless.json');
  const progress = resolve('../tmp/vitest/scaling-progress.txt');
  mkdirSync(resolve('../docs/benchmarks'), { recursive: true });
  const results = [];
  // Keep the default sweep modest; opt into the much slower 1000-bird runs explicitly.
  const birdCounts = process.env.SCALE_EXTENDED === '1' ? [40, 250, 1000] : [40, 250];
  for (const count of CROWD_PRESETS) for (const birds of birdCounts) {
    for (const seed of [5, 11, 23]) {
      const label = `${count} villagers / ${birds} birds / seed ${seed}`;
      writeFileSync(progress, `${label}: creating navigation`);
      const sim = await Simulation.create({ seed, villagerCount: count });
      try {
        sim.hour = 10;
        sim.setBirdCount(birds);
        writeFileSync(progress, `${label}: warm-up`);
        for (let i = 0; i < 300; i++) sim.step(DT);
        const started = performance.now();
        const rocks = sim.scatterObstacles(20);
        const editMs = performance.now() - started;
        const fire = sim.startFireNear('Maya');
        writeFileSync(progress, `${label}: planning`);
        const p0 = performance.now();
        const report = sim.situationReport('fire_started');
        const commands = ruleBasedPlan(report);
        sim.applyPlan({ source: 'local', planner: 'benchmark rules', commands }, report.version, p0);
        const planMs = performance.now() - p0;
        const times: number[] = [];
        let invalidSamples = 0;
        for (let i = 0; i < 900; i++) {
          if (i % 300 === 0) writeFileSync(progress, `${label}: step ${i} / 900`);
          const t0 = performance.now();
          sim.step(DT);
          times.push(performance.now() - t0);
          invalidSamples += sim.villagers.filter(v => !Number.isFinite(v.pos.x) || !Number.isFinite(v.pos.z) || (v.agent && v.agent.state() === 0)).length;
        }
        results.push({ count, birds, seed, steps: times.length, meanStepMs: times.reduce((a, b) => a + b, 0) / times.length,
          p95StepMs: percentile(times, 0.95), maxStepMs: Math.max(...times), editMs, rocks, planMs,
          reportBytes: Buffer.byteLength(JSON.stringify(report)), accepted: sim.stats.accepted, rejected: sim.stats.rejected,
          invalidSamples, stuckRecoveries: sim.stats.stuckRecoveries, fireStarted: !!fire, fireOut: fire ? !fire.alive : null,
          lastTimeToSafety: sim.stats.lastTimeToSafety });
      } finally { sim.dispose(); }
    }
  }
  writeFileSync(progress, 'Completed all simulations; collecting machine metadata');
  writeFileSync(output, JSON.stringify({ recordedAt: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model,
    platform: `${platform()} ${arch()}`, note: 'CPU-only fixed-step timings; not browser FPS. 10 simulated seconds warm-up, 20 rocks + fire + local plan, then 30 simulated seconds at 30 Hz. Three seeds per load.', results }, null, 2));
  console.log(`Wrote ${results.length} scaling runs to ${output}`);
  writeFileSync(progress, `Complete: ${results.length} runs`);
}, 600000);
