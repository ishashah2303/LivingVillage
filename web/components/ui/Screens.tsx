'use client';
import { useEffect, useRef } from 'react';
import { SEASON } from '@/sim/game';
import { BACKBONES, backboneLabel, type PlannerClient } from '@/sim/plannerClient';
import { useGame, useSim, useTick, useUI } from '../store';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const MODES = [
  {
    id: 'challenge', icon: '🔥', title: 'Fire Season', kind: 'Challenge',
    text: `Hold out for ${SEASON.duration / 60} minutes until the rains come. Fires start faster and faster, unattended ones spread, and smoke hurts. Keep the village standing and no more than ${SEASON.maxInjured - 1} villagers hurt.`,
  },
  {
    id: 'sandbox', icon: '🧪', title: 'Sandbox', kind: 'Free play',
    text: 'The world editor: start fires, drop obstacles and food, build wells, call festivals and shortages, and stress-test the systems. No rules; end the session whenever you like.',
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
        <p className="lede">A village that runs itself: every villager has a behavior tree, finds its way on a Recast/Detour navmesh and remembers what happened. An LLM planner coordinates them in emergencies.</p>

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
          <details className="how">
            <summary>How to play</summary>
            <ul>
              <li><b>💧 Water</b> (key 2): click a fire. Two buckets put one out; you carry {SEASON.water.max}, and one refills every {SEASON.water.recharge} s.</li>
              <li><b>🔔 Bell</b> (key B): everyone within 20 m of a fire evacuates at once and the planner is asked for a plan.</li>
              <li><b>🧺 Food</b> (key 3): leave a basket when the food shortage hits.</li>
              <li>Tomas the guard fights fires on his own but backs off when the smoke hurts him. Fires near houses do double damage.</li>
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
      <div className="hud-item wide" title="Every burning fire damages the village; fires near houses do double damage">
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
  useEffect(() => again.current?.focus(), []);
  const o = game.outcome;
  if (!o) return null;
  const s = sim.stats;
  const rows: [string, string][] = [
    ...(game.mode === 'challenge'
      ? ([
          ['Time held out', `${mmss(Math.min(game.elapsed, SEASON.duration))} of ${mmss(SEASON.duration)}`],
          ['Village standing', `${Math.ceil(game.integrity)}%`],
          ['Villagers safe', `${sim.villagers.length - game.injured} of ${sim.villagers.length}`],
        ] as [string, string][])
      : []),
    ['Fires put out', `${s.firesOut} of ${s.firesStarted}`],
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
