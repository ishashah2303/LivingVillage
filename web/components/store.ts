'use client';
import { createContext, useContext, useEffect, useReducer } from 'react';
import { create } from 'zustand';
import type { Game, Mode } from '@/sim/game';
import type { Simulation } from '@/sim/simulation';

export type Tool = 'select' | 'fire' | 'rock' | 'food' | 'well' | 'erase' | 'water';
/** Start state (menu over a live village), active state, end state. */
export type Phase = 'menu' | 'playing' | 'over';

export interface Overlays {
  navmesh: boolean;
  obstacles: boolean;
  paths: boolean;
  perception: boolean;
}

interface UIState {
  phase: Phase;
  /** Menu choices: game mode and planner backbone (a model id from BACKBONES, or "rules"). */
  mode: Mode;
  backbone: string;
  tool: Tool;
  selected: number | null;
  follow: boolean;
  overlays: Overlays;
  /** Expanded state of the scene overlays (collapsed to one-line pills by default). */
  plannerOpen: boolean;
  perfOpen: boolean;
  setPhase: (p: Phase) => void;
  setMode: (m: Mode) => void;
  setBackbone: (b: string) => void;
  setTool: (t: Tool) => void;
  select: (id: number | null) => void;
  setFollow: (f: boolean) => void;
  toggleOverlay: (k: keyof Overlays) => void;
  setPlannerOpen: (open: boolean) => void;
  setPerfOpen: (open: boolean) => void;
}

/** Menu choices persist per browser (best effort: storage can be blocked). */
const saved = (key: string, fallback: string) => {
  try {
    return (typeof localStorage !== 'undefined' && localStorage.getItem(`lv.${key}`)) || fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, value: string) => {
  try {
    localStorage.setItem(`lv.${key}`, value);
  } catch {}
};

export const useUI = create<UIState>(set => ({
  phase: 'menu',
  mode: saved('mode', 'challenge') as Mode,
  backbone: saved('backbone', 'claude-sonnet-5-5'),
  tool: 'select',
  selected: 0,
  follow: false,
  overlays: { navmesh: false, obstacles: false, paths: true, perception: false },
  plannerOpen: false,
  perfOpen: false,
  setPhase: phase => set({ phase }),
  setMode: mode => (save('mode', mode), set({ mode })),
  setBackbone: backbone => (save('backbone', backbone), set({ backbone })),
  setTool: tool => set({ tool }),
  select: selected => set({ selected }),
  setFollow: follow => set({ follow }),
  toggleOverlay: k => set(s => ({ overlays: { ...s.overlays, [k]: !s.overlays[k] } })),
  setPlannerOpen: plannerOpen => set({ plannerOpen }),
  setPerfOpen: perfOpen => set({ perfOpen }),
}));

export const SimContext = createContext<Simulation | null>(null);
export const GameContext = createContext<Game | null>(null);

/** Render-loop measurements, written by <PerfProbe> inside the canvas and read by the overlay. */
export const framePerf = { fps: 0, frameMs: 0, worstMs: 0, simMs: 0, calls: 0, triangles: 0, dpr: 1 };

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

export function useGame() {
  const game = useContext(GameContext);
  if (!game) throw new Error('useGame must be used inside <GameContext.Provider>');
  return game;
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
