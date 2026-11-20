'use client';
import { useEffect } from 'react';
import type { Game } from '@/sim/game';
import { useUI } from './store';
import { villageSound } from './sound';

export function SoundButton() {
  const { muted, setMuted } = useUI();
  return <button className="bar-btn" aria-label={muted ? 'Unmute sound' : 'Mute sound'} aria-pressed={!muted}
    onClick={() => { villageSound.activate(!muted); setMuted(!muted); }}>
    {muted ? 'Sound off' : 'Sound on'}
  </button>;
}

/** Poll counters rather than logs so rendering never creates or repeats gameplay events. */
export default function Soundscape({ game }: { game: Game | null }) {
  useEffect(() => {
    const unlock = () => villageSound.activate(useUI.getState().muted);
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      villageSound.dispose();
    };
  }, []);
  useEffect(() => {
    if (!game) return;
    let water = game.sim.soundCues.water, bell = game.sim.soundCues.bell;
    let outcome = game.outcome;
    const update = () => {
      const { muted, phase, tutorialOpen } = useUI.getState();
      const sim = game.sim;
      const won = game.outcome?.result === 'won';
      const audible = !tutorialOpen && !document.hidden && phase !== 'menu' && (sim.speed > 0 || !!game.outcome);
      villageSound.mix(muted, audible, won || (!game.outcome && sim.rain > 0), game.outcome ? 0 : sim.aliveFires().length);
      if (audible) {
        if (sim.soundCues.water !== water) villageSound.cue('water');
        if (sim.soundCues.bell !== bell) villageSound.cue('bell');
        if (game.outcome !== outcome && game.outcome?.result !== 'ended' && game.outcome)
          villageSound.cue(game.outcome.result);
      }
      water = sim.soundCues.water; bell = sim.soundCues.bell; outcome = game.outcome;
    };
    update();
    const timer = setInterval(update, 80);
    const unsubscribe = useUI.subscribe(update);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); unsubscribe(); document.removeEventListener('visibilitychange', update); villageSound.mix(true, false, false, 0); };
  }, [game]);
  return null;
}
