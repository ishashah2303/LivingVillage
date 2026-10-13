'use client';
import { createContext, useContext, useEffect, useReducer } from 'react';
import { create } from 'zustand';
import type { Simulation } from '@/sim/simulation';

export type Tool = 'select' | 'fire' | 'rock' | 'food' | 'well' | 'erase';

export interface Overlays {
  navmesh: boolean;
  obstacles: boolean;
  paths: boolean;
  perception: boolean;
}

interface UIState {
  tool: Tool;
  selected: number | null;
  follow: boolean;
  overlays: Overlays;
  /** Expanded state of the scene overlays (collapsed to one-line pills by default). */
  plannerOpen: boolean;
  perfOpen: boolean;
  setTool: (t: Tool) => void;
  select: (id: number | null) => void;
  setFollow: (f: boolean) => void;
  toggleOverlay: (k: keyof Overlays) => void;
  setPlannerOpen: (open: boolean) => void;
  setPerfOpen: (open: boolean) => void;
}

export const useUI = create<UIState>(set => ({
  tool: 'select',
  selected: 0,
  follow: false,
  overlays: { navmesh: false, obstacles: false, paths: true, perception: false },
  plannerOpen: false,
  perfOpen: false,
  setTool: tool => set({ tool }),
  select: selected => set({ selected }),
  setFollow: follow => set({ follow }),
  toggleOverlay: k => set(s => ({ overlays: { ...s.overlays, [k]: !s.overlays[k] } })),
  setPlannerOpen: plannerOpen => set({ plannerOpen }),
  setPerfOpen: perfOpen => set({ perfOpen }),
}));

export const SimContext = createContext<Simulation | null>(null);

/** Render-loop measurements, written by <PerfProbe> inside the canvas and read by the overlay. */
export const framePerf = { fps: 0, frameMs: 0, worstMs: 0, simMs: 0, calls: 0, triangles: 0 };

/**
 * Stable container for drei <Html> labels. Without it, Html re-creates its React root once R3F
 * connects its event target after mount, which React 19 reports as an unmount-during-render error.
 */
export const labelLayer: { current: HTMLElement } = { current: null as unknown as HTMLElement };

export function useSim() {
  const sim = useContext(SimContext);
  if (!sim) throw new Error('useSim must be used inside <SimContext.Provider>');
  return sim;
}

/**
 * Re-render a panel a few times per second; the simulation itself mutates in place every frame.
 * Returns a function that forces an immediate re-render (for instant feedback on clicks).
 */
export function useTick(hz = 4) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const id = setInterval(bump, 1000 / hz);
    return () => clearInterval(id);
  }, [hz]);
  return bump as () => void;
}
