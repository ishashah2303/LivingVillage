'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { Game, type Mode } from '@/sim/game';
import { PlannerClient } from '@/sim/plannerClient';
import type { Simulation } from '@/sim/simulation';
import { GameContext, SimContext, useUI, type Tool } from './store';
import { EndScreen, Menu } from './ui/Screens';

// The menu is plain HTML and paints at once; the 3D workspace (three.js, R3F) and the simulation
// (Recast/Detour WebAssembly) are fetched in parallel behind it instead of blocking the first paint.
const loadSimulation = () => import('@/sim/simulation');
const Workspace = dynamic(() => import('./Workspace'), { ssr: false });
if (typeof window !== 'undefined') {
  void loadSimulation();
  void import('./Workspace');
}

const SANDBOX_KEYS: Tool[] = ['select', 'fire', 'rock', 'food', 'well', 'erase'];
const CHALLENGE_KEYS: Tool[] = ['select', 'water', 'food'];

declare global {
  interface Window {
    /** Debug handles: poke the simulation and the game loop from the browser console. */
    sim?: Simulation;
    game?: Game;
  }
}

/**
 * The game loop's outer shell. Start state: the menu over a live sandbox village. Active state:
 * a fresh simulation per game. End state: win / loss / session summary, then play again or menu.
 * Every new game disposes the previous simulation (navmesh memory, pending planner replies).
 */
export default function VillageApp() {
  const [game, setGame] = useState<Game | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Connect to the planner right away: the hosted one may need a minute to wake up.
  const [client] = useState(() => new PlannerClient());
  const phase = useUI(s => s.phase);

  const launch = useCallback(async (mode: Mode, phase: 'menu' | 'playing') => {
    const ui = useUI.getState();
    client.model = ui.backbone;
    try {
      const { Simulation } = await loadSimulation();
      const sim = await Simulation.create({ seed: phase === 'menu' ? 5 : Math.floor(Math.random() * 1e6) });
      sim.planner = client;
      const g = new Game(sim, mode);
      g.onEnd = () => useUI.getState().setPhase('over');
      setGame(old => {
        old?.sim.dispose();
        return g;
      });
      window.sim = sim;
      window.game = g;
      ui.setTool('select');
      ui.select(phase === 'menu' ? null : 0);
      ui.setFollow(false);
      ui.setPhase(phase);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client]);

  useEffect(() => {
    launch('sandbox', 'menu');
    return () => client.dispose();
  }, [launch, client]);

  const start = useCallback(() => launch(useUI.getState().mode, 'playing'), [launch]);
  const toMenu = useCallback(() => launch('sandbox', 'menu'), [launch]);

  useEffect(() => {
    if (!game || phase !== 'playing') return;
    const keys = game.mode === 'challenge' ? CHALLENGE_KEYS : SANDBOX_KEYS;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const ui = useUI.getState();
      const n = Number(e.key);
      if (n >= 1 && n <= keys.length) ui.setTool(keys[n - 1]);
      else if (e.key === ' ') {
        e.preventDefault();
        game.sim.speed = game.sim.speed === 0 ? 1 : 0;
      } else if (e.key === 'b' && game.mode === 'challenge') game.ringAlarm();
      else if (e.key === 'f') ui.setFollow(!ui.follow);
      else if (e.key === 'n') ui.toggleOverlay('navmesh');
      else if (e.key === 'Escape') ui.setTool('select');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game, phase]);

  if (error) return <div className="boot"><div><strong>Could not start the simulation</strong>{error}</div></div>;
  if (!game) return <div className="boot"><Menu onStart={start} planner={client} ready={false} /></div>;

  return (
    <GameContext.Provider value={game}>
      <SimContext.Provider value={game.sim}>
        <Workspace game={game} phase={phase} onMenu={toMenu} />
        {phase === 'menu' && <Menu onStart={start} planner={client} ready />}
        {phase === 'over' && <EndScreen onAgain={start} onMenu={toMenu} />}
      </SimContext.Provider>
    </GameContext.Provider>
  );
}
