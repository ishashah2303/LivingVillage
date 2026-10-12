/**
 * A small reactive behavior-tree library.
 *
 * The tree is re-evaluated from the root on every tick, so a higher-priority branch
 * (e.g. "a fire is nearby") preempts whatever the villager was doing. Each tick writes
 * the status of every visited node into a Trace, which the inspector renders as the
 * villager's live "reasoning".
 */
export type Status = 'success' | 'failure' | 'running';
export type Trace = Map<string, Status>;
export type NodeKind = 'selector' | 'sequence' | 'condition' | 'action';

export interface BTNode<C> {
  id: string;
  label: string;
  kind: NodeKind;
  children?: BTNode<C>[];
  tick(ctx: C, trace: Trace): Status;
}

/** Tries children in priority order; the first that does not fail wins. */
export function Selector<C>(id: string, label: string, children: BTNode<C>[]): BTNode<C> {
  return {
    id, label, kind: 'selector', children,
    tick(ctx, trace) {
      for (const child of children) {
        const s = child.tick(ctx, trace);
        if (s !== 'failure') {
          trace.set(id, s);
          return s;
        }
      }
      trace.set(id, 'failure');
      return 'failure';
    },
  };
}

/** Runs children in order; stops at the first child that is not a success. */
export function Sequence<C>(id: string, label: string, children: BTNode<C>[]): BTNode<C> {
  return {
    id, label, kind: 'sequence', children,
    tick(ctx, trace) {
      for (const child of children) {
        const s = child.tick(ctx, trace);
        if (s !== 'success') {
          trace.set(id, s);
          return s;
        }
      }
      trace.set(id, 'success');
      return 'success';
    },
  };
}

export function Condition<C>(id: string, label: string, test: (ctx: C) => boolean): BTNode<C> {
  return {
    id, label, kind: 'condition',
    tick(ctx, trace) {
      const s: Status = test(ctx) ? 'success' : 'failure';
      trace.set(id, s);
      return s;
    },
  };
}

export function Action<C>(id: string, label: string, run: (ctx: C) => Status): BTNode<C> {
  return {
    id, label, kind: 'action',
    tick(ctx, trace) {
      const s = run(ctx);
      trace.set(id, s);
      return s;
    },
  };
}

export interface FlatNode {
  id: string;
  label: string;
  kind: NodeKind;
  depth: number;
  parent: string | null;
}

/** Depth-first list of nodes, for rendering the tree in the UI. */
export function flatten<C>(root: BTNode<C>): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (n: BTNode<C>, depth: number, parent: string | null) => {
    out.push({ id: n.id, label: n.label, kind: n.kind, depth, parent });
    n.children?.forEach(c => walk(c, depth + 1, n.id));
  };
  walk(root, 0, null);
  return out;
}

/** The chain of node labels from the root down to the leaf that decided this tick. */
export function activePath<C>(root: BTNode<C>, trace: Trace): BTNode<C>[] {
  const path: BTNode<C>[] = [];
  let node: BTNode<C> | undefined = root;
  while (node) {
    path.push(node);
    const s = trace.get(node.id);
    if (!node.children || s === undefined) break;
    // Selectors stop at the first non-failing child; sequences are decided by their last visited child.
    node =
      node.kind === 'selector'
        ? node.children.find(c => trace.has(c.id) && trace.get(c.id) !== 'failure')
        : [...node.children].reverse().find(c => trace.has(c.id));
  }
  return path;
}
