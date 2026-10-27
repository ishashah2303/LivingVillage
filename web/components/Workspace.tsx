'use client';
import type { Game } from '@/sim/game';
import Stage from './scene/Stage';
import { labelLayer, type Phase } from './store';
import { EventLog, Inspector, PerfOverlay, PlannerPanel, Toolbar, TopBar } from './ui/Panels';
import { Hud } from './ui/Screens';

/**
 * The game screen: 3D stage, panels and HUD. It pulls in three.js, React Three Fiber and the
 * simulation (about 1.8 MB of JavaScript), so VillageApp loads it lazily behind the start menu.
 */
export default function Workspace({ game, phase, onMenu }: { game: Game; phase: Phase; onMenu: () => void }) {
  return (
    <div className={`app${phase === 'menu' ? ' attract' : ''}`}>
      <TopBar onMenu={onMenu} />
      <Toolbar />
      <main className="stage card" ref={el => { if (el) labelLayer.current = el; }}>
        <Stage />
        {phase !== 'menu' && game.mode === 'challenge' && <Hud />}
        <PlannerPanel />
        <PerfOverlay />
      </main>
      <Inspector />
      <EventLog />
    </div>
  );
}
