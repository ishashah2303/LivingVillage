'use client';
import { useEffect, useRef, useState } from 'react';
import { SEASON } from '@/sim/game';
import { BACKBONES, backboneLabel, type PlannerClient } from '@/sim/plannerClient';
import { useGame, useSim, useTick, useUI } from '../store';
import { SoundButton } from '../Soundscape';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const MODES = [
  {
    id: 'challenge', icon: '🔥', title: 'Fire Season', kind: 'Challenge',
    text: `Hold out for ${SEASON.duration / 60} minutes until the rains come. Fires start faster and faster, unattended ones spread, and smoke hurts. Keep the village standing and no more than ${SEASON.maxInjured - 1} villagers hurt.`,
  },
  {
    id: 'sandbox', icon: '🧪', title: 'Sandbox', kind: 'Free play',
    text: 'Shape a living village: reclaim a meadow, bring the rain, build wells, and see how residents respond to fires, festivals and shortages. End the session whenever you like.',
  },
] as const;

/**
 * Start state: pick a mode and the planner's LLM backbone, over the live village. It shows at once;
 * only Start waits until the village (navmesh, WebAssembly) is built.
 */
export function Menu({ onStart, planner, ready }: { onStart: () => void; planner: PlannerClient | null; ready: boolean }) {
  const { mode, setMode, backbone, setBackbone } = useUI();
  useTick(2);
  const start = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (ready) start.current?.focus();
  }, [ready]);
  const status = planner?.status() ?? 'offline';
  const llmReady = status === 'online' && !!planner?.serverInfo?.llm;
  return (
    <div className="screen" role="dialog" aria-modal="true" aria-labelledby="menu-title">
      <div className="panel menu">
        <h1 id="menu-title">Living Village</h1>
        <p className="lede">Eight villagers with lives of their own. Help them survive Fire Season, or build and experiment together in the Sandbox.</p>
        <SoundButton />

        <div className="modes" role="radiogroup" aria-label="Game mode">
          {MODES.map(m => (
            <button key={m.id} role="radio" aria-checked={mode === m.id} className="mode" onClick={() => setMode(m.id)}>
              <span className="mode-ic">{m.icon}</span>
              <span>
                <strong>{m.title}</strong> <small>{m.kind}</small>
                <span className="mode-text">{m.text}</span>
              </span>
            </button>
          ))}
        </div>

        <fieldset className="backbones">
          <legend>Planner backbone</legend>
          {BACKBONES.map(b => (
            <label key={b.id} className={!llmReady && b.id !== 'rules' ? 'off' : ''}>
              <input type="radio" name="backbone" checked={backbone === b.id} onChange={() => setBackbone(b.id)} />
              <span><b>{b.label}</b> <small>{b.note}</small></span>
            </label>
          ))}
          <p className="hint">
            {llmReady
              ? 'Planner server connected. Your choice is used for every emergency; the HUD shows its latency and cost.'
              : status === 'connecting'
                ? 'Connecting to the planner server… (the hosted one can take a minute to wake up)'
                : 'Planner server offline: the same rules run in your browser, whatever you pick.'}
          </p>
        </fieldset>

        {mode === 'challenge' && (
          <details className="how" open>
            <summary>How to play</summary>
            <ul>
              <li><b>💧 Water</b> (key 2): click a fire. Two buckets put one out; you carry {SEASON.water.max}, and one refills every {SEASON.water.recharge} s.</li>
              <li><b>🔔 Bell</b> (key B): everyone within 20 m of a fire evacuates at once and the planner is asked for a plan.</li>
              <li><b>🧺 Food</b> (key 3): leave a basket when the food shortage hits.</li>
              <li>Tomas the guard fights fires on his own but backs off when the smoke hurts him. Fires near houses do triple damage.</li>
              <li><kbd>Space</kbd> pauses. Drag to orbit, right-drag to pan, scroll to zoom.</li>
            </ul>
          </details>
        )}

        <button ref={start} className="start" onClick={onStart} disabled={!ready}>
          {!ready ? 'Building the village…' : mode === 'challenge' ? 'Start Fire Season' : 'Open the sandbox'} <span aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}

/** Always-visible, contextual instructions; playtesters need no spoken control tutorial. */
export function PlayGuide() {
  const game = useGame();
  const sim = useSim();
  const tool = useUI(s => s.tool);
  useTick(4);
  const challenge = game.mode === 'challenge';
  let hint = challenge
    ? 'Watch for fire. Choose Water (2), then click the flames. Bell (B) warns nearby villagers.'
    : 'Choose a tool, then click open ground. Try Reclaim land to give the village room to grow.';
  if (tool === 'water') hint = game.water >= 1
    ? 'Click the flames to throw a bucket. Two buckets put out a fresh fire.'
    : `Water refills in ${Math.ceil((1 - game.water) * SEASON.water.recharge)} s. Ring the bell if it is ready.`;
  else if (tool === 'food') hint = challenge && game.food < 1
    ? `A basket refills in ${Math.ceil((1 - game.food) * SEASON.food.recharge)} s.`
    : 'Click open ground near hungry villagers to leave a food basket.';
  else if (tool === 'erase') hint = 'Click an item you placed to remove it.';
  else if (tool !== 'select') hint = 'Click clear ground inside the village. Red means this spot is blocked.';
  else if (challenge && sim.shortage > 0) hint = 'Food shortage: choose Food (3) and leave a basket near hungry villagers.';
  return <div className="play-guide">
    <b>{challenge ? 'Survive until the rain' : 'Build, observe, experiment'}</b>
    <p>{challenge ? 'Keep the village standing and fewer than 3 villagers hurt for 4 minutes.' : 'Rain puts out fires but pauses construction. The meadow adds land and safe refuges.'}</p>
    <p className="guide-action" role="status">{sim.speed === 0 ? 'Paused. Press Space or choose 1× to continue.' : hint}</p>
    <small>Space: pause · Drag: orbit · Right-drag: pan · Scroll: zoom</small>
  </div>;
}

/** Active state, challenge HUD: time left, how much of the village stands, who is hurt, what is burning. */
export function Hud() {
  const game = useGame();
  const sim = useSim();
  useTick(5);
  const burning = sim.aliveFires().length;
  const hurt = game.injured;
  const integrity = Math.ceil(game.integrity);
  return (
    <div className="hud" aria-live="off">
      <div className="hud-item" title="Hold out until the rains come">
        <span className="hud-k">Rain in</span>
        <b className={game.remaining < 30 ? 'soon' : ''}>{mmss(game.remaining)}</b>
      </div>
      <div className="hud-item wide" title="Every burning fire damages the village; fires near houses do triple damage">
        <span className="hud-k">Village</span>
        <div className="track"><div className="fill" style={{ width: `${integrity}%`, background: integrity > 50 ? 'var(--moss)' : integrity > 25 ? '#d49a2a' : 'var(--ember)' }} /></div>
        <b>{integrity}%</b>
      </div>
      <div className="hud-item" title={`The game is lost when ${SEASON.maxInjured} villagers are hurt`}>
        <span className="hud-k">Hurt</span>
        <b className={hurt ? 'bad' : ''}>{hurt}/{SEASON.maxInjured}</b>
      </div>
      <div className="hud-item">
        <span className="hud-k">Burning</span>
        <b className={burning ? 'bad' : ''}>🔥 {burning}</b>
      </div>
      {sim.speed === 0 && !game.outcome && <div className="hud-paused">Paused · Space to resume</div>}
    </div>
  );
}

/** End state: win / loss / session summary, then play again or go back to the menu. */
export function EndScreen({ onAgain, onMenu }: { onAgain: () => void; onMenu: () => void }) {
  const game = useGame();
  const sim = useSim();
  const backbone = useUI(s => s.backbone);
  const again = useRef<HTMLButtonElement>(null);
  const [skip, setSkip] = useState(false);
  useTick(10);
  const reveal = game.outcome?.result === 'won' && game.victoryTime < 3.5 && !skip;
  useEffect(() => { if (!reveal) again.current?.focus(); }, [reveal]);
  const o = game.outcome;
  if (!o) return null;
  if (reveal) return <div className="screen victory-reveal" role="dialog" aria-modal="true" aria-labelledby="rain-title">
    <div className="panel end won">
      <p className="kicker">Fire Season survived</p>
      <h1 id="rain-title">The rains came</h1>
      <p className="lede">The fires fade. Your village is safe.</p>
      <button autoFocus className="bar-btn" onClick={() => setSkip(true)}>View results</button>{' '}
      <SoundButton />
    </div>
  </div>;
  const s = sim.stats;
  const rows: [string, string][] = [
    ...(game.mode === 'challenge'
      ? ([
          ['Time held out', `${mmss(Math.min(game.elapsed, SEASON.duration))} of ${mmss(SEASON.duration)}`],
          ['Village standing', `${Math.ceil(game.integrity)}%`],
          ['Villagers safe', `${sim.villagers.length - game.injured} of ${sim.villagers.length}`],
        ] as [string, string][])
      : []),
    [o.result === 'won' ? 'Fires put out before rain' : 'Fires put out', `${s.firesOut} of ${s.firesStarted}`],
    ['Planner', sim.planner?.name ?? backboneLabel(backbone)],
    ['Commands accepted / rejected', `${s.accepted} / ${s.rejected}`],
    ['Mean planner latency', s.plans ? `${(s.planLatencyS / s.plans).toFixed(1)} s over ${s.plans} plans` : '–'],
    ['LLM cost (list price)', `$${s.llmCostUsd.toFixed(3)}`],
  ];
  return (
    <div className="screen" role="dialog" aria-modal="true" aria-labelledby="end-title">
      <div className={`panel end ${o.result}`}>
        <p className="kicker">{o.result === 'won' ? 'Victory' : o.result === 'lost' ? 'Defeat' : game.mode === 'sandbox' ? 'Sandbox' : 'Game over'}</p>
        <h1 id="end-title">{o.title}</h1>
        <p className="lede">{o.reason}</p>
        {o.result === 'won' && (
          <p className="stars" aria-label={`${o.stars} of 3 stars`}>
            {[1, 2, 3].map(k => <span key={k} className={k <= o.stars ? 'on' : ''}>★</span>)}
          </p>
        )}
        {o.result !== 'ended' && <p className="score">Score <b>{o.score.toLocaleString()}</b></p>}
        {o.result === 'lost' && <p className="retry-tip">{game.injured >= SEASON.maxInjured
          ? 'Next time: ring the bell early to move residents away from smoke, then water the fire.'
          : 'Next time: prioritize fires near houses. They damage the village three times faster.'}</p>}
        <SoundButton />
        <dl className="stats">
          {rows.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
        <div className="actions">
          <button ref={again} className="start" onClick={onAgain}>Play again</button>
          <button className="ghost" onClick={onMenu}>Main menu</button>
        </div>
      </div>
    </div>
  );
}
