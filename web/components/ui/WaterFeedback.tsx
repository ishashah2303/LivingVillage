'use client';
import { useEffect, useState } from 'react';
import { SCORE, SEASON, type WaterFeedback } from '@/sim/game';
import { FIRE } from '@/sim/simulation';
import { useGame, useTick } from '../store';

function message(f: WaterFeedback) {
  if (f.kind === 'empty') return 'No water left. Buckets refill automatically; check the countdown beside Water.';
  if (f.kind === 'miss') return 'No fire here. Click the flames directly. No bucket used.';
  if (f.kind === 'out') return `Fire extinguished! +${SCORE.fire} points.`;
  const buckets = Math.ceil(f.strength / SEASON.water.power);
  return `Water applied · ${Math.ceil(f.strength)}/${FIRE.hp} fire strength left. ${buckets} more bucket${buckets === 1 ? '' : 's'} will put it out.`;
}

export function WaterReadout() {
  const game = useGame();
  useTick(5);
  const next = Math.ceil((Math.floor(game.water) + 1 - game.water) * SEASON.water.recharge);
  return <div className="water-readout">
    <b>{Math.floor(game.water)}/{SEASON.water.max} buckets ready</b>
    <span>{game.water >= SEASON.water.max ? 'Full · two buckets for a fresh fire' : `Next bucket in ${next} s${game.sim.speed === 0 ? ' · paused' : ''}`}</span>
    {game.waterFeedback && <p>{game.waterFeedback.kind === 'empty' && game.water >= 1
      ? 'Water refilled. Ready for another throw.' : `Last attempt: ${message(game.waterFeedback)}`}</p>}
  </div>;
}

export function WaterNotice() {
  const game = useGame();
  useTick(10);
  const feedback = game.waterFeedback;
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!feedback) return;
    setVisible(true);
    const timeout = setTimeout(() => setVisible(false), 4500);
    return () => clearTimeout(timeout);
  }, [feedback]);
  return <div className={`water-notice${visible && feedback ? ' shown' : ''}`} role="status" aria-live="polite" aria-atomic="true">
    {visible && feedback ? message(feedback) : ''}
  </div>;
}
