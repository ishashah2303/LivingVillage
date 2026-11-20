import { afterEach, expect, it } from 'vitest';
import { Game, SEASON } from './game';
import { Simulation } from './simulation';

const worlds: Simulation[] = [];
const create = async () => {
  const sim = await Simulation.create({ seed: 5 }); worlds.push(sim);
  return new Game(sim, 'challenge');
};
afterEach(() => worlds.splice(0).forEach(s => s.dispose()));

it('distinguishes a miss, damage and extinguishing while charging only successful throws', async () => {
  const g = await create();
  expect(g.useWater({ x: 0, z: 0 })).toBeNull();
  expect(g.waterFeedback?.kind).toBe('miss');
  expect(g.water).toBe(3);
  expect(g.sim.soundCues.water).toBe(0);
  const f = g.sim.startFire({ x: 8, z: 8 })!;
  g.useWater(f);
  expect(g.waterFeedback).toMatchObject({ id: 2, kind: 'hit', x: 8, z: 8, strength: 4 });
  expect(g.water).toBe(2);
  expect(f.alive).toBe(true);
  g.useWater(f);
  expect(g.waterFeedback).toMatchObject({ id: 3, kind: 'out', strength: 0 });
  expect(g.water).toBe(1);
  expect(g.sim.stats.firesOut).toBe(1);
  expect(g.scoreParts.fires).toBe(50);
  expect(g.useWater(f)).toBeNull(); // clicking ashes cannot spend another bucket or earn points
  expect(g.waterFeedback?.kind).toBe('miss');
  expect(g.water).toBe(1);
  expect(g.sim.soundCues.water).toBe(2);
});

it('explains an empty bucket and allows the action again once a charge refills', async () => {
  const g = await create();
  const f = g.sim.startFire({ x: 8, z: 8 })!;
  g.water = 0.5;
  expect(g.useWater(f)).toBeNull();
  expect(g.waterFeedback?.kind).toBe('empty');
  expect(f.hp).toBe(10);
  expect(g.sim.soundCues.water).toBe(0);
  g.update(SEASON.water.recharge / 2);
  expect(g.useWater(f)).toBe(f);
  expect(g.waterFeedback?.kind).toBe('hit');
  expect(g.water).toBe(0);
  g.end();
  const last = g.waterFeedback;
  expect(g.useWater(f)).toBeNull();
  expect(g.waterFeedback).toBe(last); // frozen outcome
});

it('reports a weakened fire as extinguished in one bucket, without negative strength', async () => {
  const g = await create();
  const f = g.sim.startFire({ x: 8, z: 8 })!;
  f.hp = 2.5;
  g.useWater(f);
  expect(g.waterFeedback).toMatchObject({ kind: 'out', strength: 0 });
  expect(g.water).toBe(2);
});

it('the displayed score contributions add up to the final score', async () => {
  const g = await create();
  g.integrity = 73.25;
  g.sim.villagers[0].injured = true;
  g.sim.stats.firesOut = 4;
  expect(g.scoreParts).toEqual({ village: 733, residents: 700, fires: 200, total: 1633 });
  g.elapsed = SEASON.duration;
  g.update(0);
  expect(g.outcome).toMatchObject({ result: 'won', score: 1633, stars: 2 });
});

it.each([59.99, 60])('the three-star guidance matches the actual integrity boundary (%s)', async integrity => {
  const g = await create();
  g.integrity = integrity;
  g.elapsed = SEASON.duration;
  g.update(0);
  expect(g.outcome?.stars).toBe(integrity >= 60 ? 3 : 2);
});
