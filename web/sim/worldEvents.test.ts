import { afterEach, describe, expect, it } from 'vitest';
import { LAND_PROJECT, MEADOW_SPOTS, WORLD } from './layout';
import { validateCommand } from './planner';
import { DT, Simulation } from './simulation';

const worlds: Simulation[] = [];
async function village() {
  const sim = await Simulation.create({ seed: 5 });
  worlds.push(sim);
  return sim;
}
const advance = (sim: Simulation, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) sim.step(DT);
};
afterEach(() => { worlds.splice(0).forEach(s => s.dispose()); });

describe('sandbox world events', () => {
  it('keeps unreclaimed land inaccessible, then opens real routes, placement and planner refuges after physical work', async () => {
    const sim = await village();
    const target = MEADOW_SPOTS[1];
    expect(sim.canPlace(target)).toBe(false);
    expect(sim.nav.snap(target, 1)).toBeNull();
    expect(sim.spotByCmd(target.cmd)).toBeUndefined();
    expect(sim.toggleLandProject()).toBe(true);
    advance(sim, 1);
    expect(sim.landWork).toBe(0); // travel is not construction work
    for (let i = 0; i < 150 / DT && !sim.meadowOpen; i++) sim.step(DT);
    expect(sim.landWork).toBe(LAND_PROJECT.workRequired);
    expect(sim.meadowOpen).toBe(true);
    expect(sim.bounds.maxX).toBe(50);
    expect(sim.canPlace(target)).toBe(true);
    expect(sim.nav.path({ x: 25, z: 0 }, target)).not.toBeNull();
    expect(sim.situationReport('test').spots.some(s => s.cmd === target.cmd)).toBe(true);
    const fire = sim.startFire({ x: 4, z: 4 });
    expect(fire).not.toBeNull();
    expect(validateCommand(sim, { agent: 'Maya', verb: 'EVACUATE', arg: target.cmd, reason: 'new refuge', ttlS: 20 }, 0).ok).toBe(true);
    expect(sim.addWell({ x: 44, z: 7 })).not.toBeNull();
    expect(sim.toggleLandProject()).toBe(false); // one expansion per world
    const fresh = await village();
    expect(fresh.bounds).toEqual(WORLD);
    expect(fresh.canPlace(target)).toBe(false); // no global mutation across restarts
  }, 30000);

  it('pauses construction for rain and explicit pause without losing completed work', async () => {
    const sim = await village();
    sim.toggleLandProject();
    for (let i = 0; i < 100 / DT && sim.landWork === 0; i++) sim.step(DT);
    expect(sim.landWork).toBeGreaterThan(0);
    const work = sim.landWork;
    sim.startRain();
    advance(sim, 5);
    expect(sim.landWork).toBe(work);
    expect(sim.landWorkers).toBe(0);
    sim.toggleLandProject();
    advance(sim, 25);
    expect(sim.landWork).toBe(work);
    expect(sim.buildingLand).toBe(false);
    sim.toggleLandProject();
    for (let i = 0; i < 150 / DT && !sim.meadowOpen; i++) sim.step(DT);
    expect(sim.meadowOpen).toBe(true);
  }, 30000);

  it('interrupts construction when a fire threatens the site', async () => {
    const sim = await village();
    sim.toggleLandProject();
    for (let i = 0; i < 100 / DT && sim.landWork === 0; i++) sim.step(DT);
    const work = sim.landWork;
    expect(work).toBeGreaterThan(0);
    const f = sim.startFire({ x: 26, z: -5 });
    expect(f).not.toBeNull();
    advance(sim, 1);
    expect(sim.landWork).toBe(work);
    expect(sim.villagers.some(v => v.goal?.key === 'reclaimLand')).toBe(false);
  }, 30000);

  it('rain extinguishes actual fires and enforces its cooldown', async () => {
    const sim = await village();
    sim.villagers.filter(v => v.role === 'guard').forEach(v => v.injured = true);
    const fire = sim.startFire({ x: 4, z: 4 })!;
    expect(sim.startRain()).toBe(true);
    expect(sim.startRain()).toBe(false);
    advance(sim, 8);
    expect(fire.alive).toBe(false);
    expect(sim.stats.firesOut).toBe(1);
    advance(sim, 18);
    expect(sim.rain).toBe(0);
    expect(sim.startRain()).toBe(false);
    advance(sim, 35);
    expect(sim.startRain()).toBe(true);
  });

  it('suppresses spread during rain and leaves Fire Season controls unchanged', async () => {
    const sim = await village();
    sim.rules.spread = true;
    const f = sim.startFire({ x: 4, z: 4 })!;
    f.hp = 100;
    sim.startRain();
    advance(sim, 20);
    expect(f.hp).toBeLessThan(100);
    expect(f.spread).toBe(false);
    advance(sim, 6);
    expect(f.spread).toBe(true);
    const challenge = await village();
    challenge.rules.harm = true;
    expect(challenge.startRain()).toBe(false);
    expect(challenge.toggleLandProject()).toBe(false);
  });
});
