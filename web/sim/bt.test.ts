import { describe, expect, it } from 'vitest';
import { Action, Condition, Selector, Sequence, activePath, flatten, type Status } from './bt';

type Ctx = { fire: boolean; hungry: boolean; log: string[] };

const tree = Selector<Ctx>('root', 'Root', [
  Sequence('emergency', 'Emergency', [
    Condition('fire', 'Fire?', c => c.fire),
    Action('flee', 'Flee', c => (c.log.push('flee'), 'running')),
  ]),
  Sequence('hunger', 'Hunger', [
    Condition('hungry', 'Hungry?', c => c.hungry),
    Action('eat', 'Eat', c => (c.log.push('eat'), 'running')),
  ]),
  Action('idle', 'Idle', c => (c.log.push('idle'), 'running')),
]);

const tick = (ctx: Ctx) => {
  const trace = new Map<string, Status>();
  const status = tree.tick(ctx, trace);
  return { status, trace };
};

describe('behavior tree', () => {
  it('falls through to the lowest-priority branch when nothing is urgent', () => {
    const ctx = { fire: false, hungry: false, log: [] };
    const { status, trace } = tick(ctx);
    expect(status).toBe('running');
    expect(ctx.log).toEqual(['idle']);
    expect(trace.get('fire')).toBe('failure');
    expect(trace.get('hungry')).toBe('failure');
    expect(activePath(tree, trace).map(n => n.id)).toEqual(['root', 'idle']);
  });

  it('re-evaluates from the root so an emergency preempts a running need', () => {
    const ctx = { fire: false, hungry: true, log: [] as string[] };
    tick(ctx);
    ctx.fire = true;
    const { trace } = tick(ctx);
    expect(ctx.log).toEqual(['eat', 'flee']);
    expect(activePath(tree, trace).map(n => n.id)).toEqual(['root', 'emergency', 'flee']);
    expect(trace.has('hungry')).toBe(false); // never visited this tick
  });

  it('flattens the tree for the inspector', () => {
    const flat = flatten(tree);
    expect(flat.map(n => n.id)).toEqual(['root', 'emergency', 'fire', 'flee', 'hunger', 'hungry', 'eat', 'idle']);
    expect(flat.find(n => n.id === 'flee')?.depth).toBe(2);
  });
});
