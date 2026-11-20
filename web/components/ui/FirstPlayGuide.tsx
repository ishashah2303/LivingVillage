'use client';
import { useEffect, useRef, useState } from 'react';
import { SCORE, SEASON } from '@/sim/game';
import { FIRE } from '@/sim/simulation';
import { useUI } from '../store';

export function ScoreGuide() {
  return <div className="score-guide">
    <b>Earn a better score</b>
    <p>+{SCORE.integrity} points per 1% village standing · +{SCORE.resident} per uninjured villager · +{SCORE.fire} per fire put out by you or the guard.</p>
    <p><strong>★★★ target:</strong> survive all {SEASON.duration / 60} minutes with at least {SCORE.threeStarIntegrity}% village standing and nobody injured.</p>
    <small>Protect houses first: nearby fires cause triple damage. Fires cleared by the final rain earn no extra points.</small>
  </div>;
}

export function FirstPlayGuide() {
  const open = useUI(s => s.tutorialOpen && s.phase === 'playing');
  return open ? <Guide /> : null;
}

function Guide() {
  const close = useUI(s => s.finishTutorial);
  const [step, setStep] = useState(0);
  const [strength, setStrength] = useState(FIRE.hp);
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);
  useEffect(() => () => {
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-tutorial-trigger]')?.focus());
  }, []);
  return <div className="screen" role="dialog" aria-modal="true" aria-labelledby="guide-title" onKeyDown={e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key !== 'Tab') return;
    const buttons = panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    if (!buttons?.length) return;
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }}>
    <div className="panel tutorial" ref={panel}>
      <p className="kicker">Quick guide · {step + 1} of 3 · Village paused</p>
      <h1 id="guide-title" ref={heading} tabIndex={-1}>{['Make every bucket count', 'Keep your villagers safe', 'Aim for three stars'][step]}</h1>
      {step === 0 && <>
        <p>Choose <b>Water</b> or press <kbd>2</kbd>, then click the flames. A fresh fire takes two buckets. A miss uses no water.</p>
        <div className="water-practice">
          <span className="practice-fire" aria-hidden="true">{strength > 0 ? '🔥' : '💧'}</span>
          <div><b>Practice fire · {strength}/{FIRE.hp} strength</b>
            <progress aria-label="Practice fire strength" value={strength} max={FIRE.hp} />
            <p role="status">{strength === FIRE.hp ? 'Try the button below.' : strength > 0 ? 'Water applied! One more bucket will finish it.' : 'Fire out! In the game, this earns 50 points.'}</p>
          </div>
        </div>
        <button className="bar-btn" onClick={() => setStrength(n => n === 0 ? FIRE.hp : Math.max(0, n - SEASON.water.power))}>
          {strength > 0 ? 'Try a bucket' : 'Reset practice fire'}
        </button>
        <p className="hint">Practice only: your real buckets and score stay unchanged. You carry {SEASON.water.max} buckets; one refills every {SEASON.water.recharge} simulation seconds.</p>
      </>}
      {step === 1 && <>
        <p><b>Bell (<kbd>B</kbd>):</b> when a fire starts, warn villagers within 20 m so they evacuate. The bell moves people; it does not put out fires. It recharges in {SEASON.alarmCooldown} simulation seconds.</p>
        <p><b>Food (<kbd>3</kbd>):</b> during a shortage, click open ground near hungry villagers to leave a basket.</p>
        <p>Tomas fights fires on his own. Help him with water, especially near houses. You lose if the village falls to 0% or {SEASON.maxInjured} villagers are injured.</p>
        <p><kbd>Space</kbd> pauses. Drag to orbit, right-drag to pan, scroll to zoom.</p>
      </>}
      {step === 2 && <ScoreGuide />}
      <div className="tutorial-actions">
        <button className="bar-btn" onClick={close}>Skip guide</button>
        {step > 0 && <button className="bar-btn" onClick={() => setStep(step - 1)}>Back</button>}
        <button className="start" onClick={() => step < 2 ? setStep(step + 1) : close()}>{step < 2 ? 'Next' : 'Play'}</button>
      </div>
      <p className="hint">Reopen this anytime using “How to play” at the top.</p>
    </div>
  </div>;
}
