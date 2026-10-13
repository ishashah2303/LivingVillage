'use client';
import { useEffect, useState } from 'react';
import { PlannerClient } from '@/sim/plannerClient';
import { Simulation } from '@/sim/simulation';
import Stage from './scene/Stage';
import { SimContext, labelLayer, useUI, type Tool } from './store';
import { EventLog, Inspector, PerfOverlay, PlannerPanel, Toolbar, TopBar } from './ui/Panels';

const KEY_TOOLS: Tool[] = ['select', 'fire', 'rock', 'food', 'well', 'erase'];

declare global {
  interface Window {
    /** Debug handle: poke the simulation from the browser console. */
    sim?: Simulation;
  }
}

export default function VillageApp() {
  const [sim, setSim] = useState<Simulation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let client: PlannerClient | null = null;
    Simulation.create()
      .then(s => {
        if (cancelled) return;
        client = new PlannerClient();
        s.planner = client;
        window.sim = s;
        setSim(s);
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      client?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!sim) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const ui = useUI.getState();
      const n = Number(e.key);
      if (n >= 1 && n <= KEY_TOOLS.length) ui.setTool(KEY_TOOLS[n - 1]);
      else if (e.key === ' ') {
        e.preventDefault();
        sim.speed = sim.speed === 0 ? 1 : 0;
      } else if (e.key === 'f') ui.setFollow(!ui.follow);
      else if (e.key === 'n') ui.toggleOverlay('navmesh');
      else if (e.key === 'Escape') ui.setTool('select');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sim]);

  if (error) return <div className="boot"><div><strong>Could not start the simulation</strong>{error}</div></div>;
  if (!sim) return <div className="boot"><div><strong>Living Village</strong>Building the navmesh (Recast/Detour, WebAssembly)…</div></div>;

  return (
    <SimContext.Provider value={sim}>
      <div className="app">
        <TopBar />
        <Toolbar />
        <main className="stage card" ref={el => { if (el) labelLayer.current = el; }}>
          <Stage />
          <PlannerPanel />
          <PerfOverlay />
        </main>
        <Inspector />
        <EventLog />
      </div>
    </SimContext.Provider>
  );
}
