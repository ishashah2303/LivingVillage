import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlannerClient } from './plannerClient';
import { ruleBasedPlan, type SituationReport } from './planner';
import { Simulation } from './simulation';

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  sent: { requestId: string; report: SituationReport }[] = [];
  failSend = false;
  constructor() { Socket.instances.push(this); }
  open(llm = false) {
    this.readyState = 1; this.onopen?.();
    this.message({ type: 'hello', planner: 'Test server', version: 'test', llm });
  }
  send(text: string) {
    if (this.failSend) throw new Error('socket closing');
    this.sent.push(JSON.parse(text));
  }
  message(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}

const report = (): SituationReport => ({
  version: 1, day: 1, clock: '10:00', trigger: 'fire_started',
  fires: [{ id: 1, x: 0, z: 0, place: 'farm' }],
  spots: [{ cmd: 'TownSquare', name: 'Square', x: 20, z: 0 }],
  agents: [
    { id: 0, name: 'Maya', role: 'farmer', x: 2, z: 0, activity: 'walk', fleeingTo: null, rel: {} },
    { id: 1, name: 'Tomas', role: 'guard', x: 8, z: 0, activity: 'walk', fleeingTo: null, rel: {} },
  ],
});
const clients: PlannerClient[] = [];
const worlds: Simulation[] = [];
const setup = (llm = false) => {
  const client = new PlannerClient('ws://test/planner');
  clients.push(client);
  const socket = Socket.instances.at(-1)!;
  socket.open(llm);
  return { client, socket };
};
const reply = (requestId: string) => ({ type: 'plan', requestId, planner: 'Server rules', commands: ruleBasedPlan(report()) });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.stubGlobal('WebSocket', Socket);
  Socket.instances = [];
});
afterEach(() => {
  clients.splice(0).forEach(c => c.dispose());
  worlds.splice(0).forEach(s => s.dispose());
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('planner transport recovery', () => {
  it('recovers every pending report once, ignores the old socket, and reconnects', async () => {
    const { client, socket } = setup();
    const a = report(), b = { ...report(), fires: [{ id: 9, x: 0, z: 0, place: 'market' }] };
    const first = client.plan(a, 1500), second = client.plan(b, 1500);
    const oldMessage = socket.onmessage!, oldClose = socket.onclose!;
    socket.close();
    expect((await first).commands).toEqual(ruleBasedPlan(a));
    expect((await second).commands).toEqual(ruleBasedPlan(b));
    expect((await first).source).toBe('local');
    expect(client.status()).toBe('offline');
    expect(client.serverInfo).toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    const fresh = Socket.instances.at(-1)!;
    fresh.open();
    oldClose(); oldMessage({ data: JSON.stringify(reply(socket.sent[0].requestId)) });
    expect(client.status()).toBe('online');
    const next = client.plan(a, 0);
    fresh.message(reply(fresh.sent[0].requestId));
    expect((await next).source).toBe('server');
  });

  it.each([false, true])('falls back on timeout without another artificial delay (LLM=%s)', async llm => {
    const { client, socket } = setup(llm);
    const current = { ...report(), fires: [] };
    const refresh = vi.fn(() => current);
    const pending = client.plan(report(), 500, refresh);
    const done = vi.fn(); void pending.then(done);
    const deadline = llm ? 35000 : 8500;
    await vi.advanceTimersByTimeAsync(deadline - 1);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledOnce();
    expect(await pending).toMatchObject({ source: 'local', commands: [], summary: expect.stringContaining('timed out') });
    socket.message(reply(socket.sent[0].requestId));
    await vi.advanceTimersByTimeAsync(40000);
    expect(done).toHaveBeenCalledOnce();
  });

  it.each(['send', 'error', 'json', 'shape', 'refusal'])('recovers from %s failures', async kind => {
    const { client, socket } = setup();
    socket.failSend = kind === 'send';
    const pending = client.plan(report(), 0);
    if (kind === 'error') socket.onerror?.();
    if (kind === 'json') socket.onmessage?.({ data: 'broken json' });
    if (kind === 'shape') socket.message({ ...reply(socket.sent[0].requestId), commands: [null] });
    if (kind === 'refusal') socket.message({ type: 'error', requestId: socket.sent[0].requestId, detail: 'busy' });
    expect(await pending).toMatchObject({ source: 'local', commands: ruleBasedPlan(report()) });
  });

  it('preserves successful server plans and clears the fallback timer', async () => {
    const { client, socket } = setup();
    const refresh = vi.fn(() => report());
    const pending = client.plan(report(), 0, refresh);
    socket.message(reply(socket.sent[0].requestId));
    expect((await pending).source).toBe('server');
    await vi.advanceTimersByTimeAsync(40000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each(['pending', 'offline'])('disposes %s work without fallback or reconnecting', async kind => {
    const { client, socket } = setup();
    if (kind !== 'pending') socket.close();
    const refresh = vi.fn(() => report());
    const pending = client.plan(report(), 500, refresh);
    const rejected = expect(pending).rejects.toThrow('disposed');
    client.dispose();
    await rejected;
    await vi.advanceTimersByTimeAsync(40000);
    expect(Socket.instances).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
    await expect(client.plan(report(), 0)).rejects.toThrow('disposed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps offline and large-crowd planning local', async () => {
    const { client, socket } = setup();
    const large = report();
    large.agents = Array.from({ length: 33 }, (_, id) => ({ ...large.agents[0], id, name: `Resident ${id}` }));
    const pending = client.plan(large, 500);
    expect(socket.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(500);
    expect((await pending).source).toBe('local');
    socket.close();
    const offline = client.plan(report(), 500);
    await vi.advanceTimersByTimeAsync(500);
    expect((await offline).commands).toEqual(ruleBasedPlan(report()));
  });

  it('a timeout produces usable fresh commands through the real simulation gate', async () => {
    const { client } = setup(true);
    const sim = await Simulation.create({ seed: 5 }); worlds.push(sim);
    sim.planner = client;
    const fire = sim.startFire({ x: 8, z: 8 })!;
    expect(fire).toBeTruthy();
    expect(sim.pendingPlans).toBe(1);
    await vi.advanceTimersByTimeAsync(35000);
    expect(sim.pendingPlans).toBe(0);
    expect(sim.stats.plans).toBe(1);
    expect(sim.stats.accepted).toBeGreaterThan(0); // not expired at the 20/30-second command TTL
    expect(sim.lastPlan?.planner).toBe('Browser rule-based fallback');
    expect(sim.lastPlan?.latencyS).toBe(35); // still report the full wait honestly
  });

  it('does not plan for a disposed village while its shared client stays connected', async () => {
    const { client, socket } = setup();
    const sim = await Simulation.create({ seed: 5 }); worlds.push(sim);
    sim.planner = client;
    sim.startFire({ x: 8, z: 8 });
    sim.dispose(); socket.close();
    await vi.advanceTimersByTimeAsync(0);
    expect(sim.stats.plans).toBe(0);
    expect(sim.pendingPlans).toBe(0);
  });
});
