'use client';
import type { Game } from '@/sim/game';
import Stage from './scene/Stage';
import { labelLayer, useUI, type Phase } from './store';
import { EventLog, Inspector, PerfOverlay, PlannerPanel, Toolbar, TopBar } from './ui/Panels';
import { Hud } from './ui/Screens';
import { WaterNotice } from './ui/WaterFeedback';

/**
 * The game screen: 3D stage, panels and HUD. It pulls in three.js, React Three Fiber and the
 * simulation (about 1.8 MB of JavaScript), so VillageApp loads it lazily behind the start menu.
 */
export default function Workspace({ game, phase, onMenu }: { game: Game; phase: Phase; onMenu: () => void }) {
  const tutorialOpen = useUI(s => s.tutorialOpen);
  return (
    <div className={`app${phase === 'menu' ? ' attract' : ''}`} inert={phase !== 'playing' || tutorialOpen}>
      <TopBar onMenu={onMenu} />
      <Toolbar />
      <main className="stage card" ref={el => { if (el) labelLayer.current = el; }}>
        <Stage />
        {phase !== 'menu' && game.mode === 'challenge' && <Hud />}
        {phase === 'playing' && game.mode === 'challenge' && <WaterNotice />}
        <PlannerPanel />
        <PerfOverlay />
      </main>
      <Inspector />
      <EventLog />
    </div>
  );
}
