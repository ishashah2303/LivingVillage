import { afterEach, expect, it, vi } from 'vitest';
import { DT, Simulation } from './simulation';
import { GATE } from './planner';
import { dist } from './math';

afterEach(() => vi.restoreAllMocks());

it('replaces an active shelter assignment when a second fire makes it unsafe', async () => {
  const sim = await Simulation.create({ seed: 5 });
  try {
    const v = sim.villagers[0];
    const fire = sim.startFireNear(v.name)!;
    sim.actFlee(v);
    const old = v.flee[fire.id];
    expect(old).toBeDefined();
    let second = null;
    for (let k = 0; k < 16 && !second; k++)
      second = sim.startFire({ x: old.x + Math.cos(k) * 3, z: old.z + Math.sin(k) * 3 });
    expect(second).not.toBeNull();
    sim.actFlee(v);
    expect(v.flee[fire.id]?.cmd).not.toBe(old.cmd);
    expect(v.target).not.toBeNull();
    expect(sim.aliveFires().every(f => dist(v.target!, f) >= GATE.safeDistance)).toBe(true);
    expect(v.act).not.toBe('shelter');
  } finally { sim.dispose(); }
});

it('does not mark a stalled trip as a safe arrival after the recovery budget runs out', async () => {
  const sim = await Simulation.create({ seed: 5 });
  try {
    const v = sim.villagers[0], fire = sim.startFireNear(v.name)!;
    sim.actFlee(v);
    v.agent!.resetMoveTarget();
    vi.spyOn(sim.nav, 'step').mockImplementation(() => {});
    v.thinkIn = 999;
    v.retries = 4;
    v.stuckT = 2;
    expect(dist(v.pos, v.target!)).toBeGreaterThan(2.2);
    sim.step(DT);
    expect(v.target).toBeNull();
    expect(v.goal).toBeNull();
    expect(v.act).toBe('idle');
    expect(fire.safeAt[v.id]).toBeUndefined();
    expect(v.say).not.toBe('Safe here.');
  } finally { sim.dispose(); }
});

it('does not claim shelter when arrival is physically close but still hazardous', async () => {
  const sim = await Simulation.create({ seed: 5 });
  try {
    const v = sim.villagers[0], fire = sim.startFireNear(v.name)!;
    sim.intend(v, { key: 'unsafe-test', label: 'Unsafe shelter', ...v.pos, act: 'shelter', source: 'reflex', fireId: fire.id });
    v.thinkIn = 999;
    sim.step(DT);
    expect(dist(v.pos, fire)).toBeLessThan(GATE.safeDistance);
    expect(fire.safeAt[v.id]).toBeUndefined();
    expect(v.act).not.toBe('shelter');
  } finally { sim.dispose(); }
});

it('stops without a false arrival when every refuge is unreachable, then retries after the edit clears', async () => {
  const sim = await Simulation.create({ seed: 5 });
  try {
    const v = sim.villagers[0], fire = sim.startFireNear(v.name)!;
    sim.actFlee(v);
    const path = vi.spyOn(sim.nav, 'path').mockReturnValue(null);
    sim.worldVersion++;
    sim.actFlee(v);
    expect(v.goal).toBeNull();
    expect(v.act).toBe('idle');
    expect(fire.safeAt[v.id]).toBeUndefined();
    path.mockRestore();
    sim.worldVersion++;
    sim.actFlee(v);
    expect(v.goal?.act).toBe('shelter');
    expect(v.act).toBe('walk');
  } finally { sim.dispose(); }
});
