'use client';
import { Fragment } from 'react';
import { ROLE_LABEL } from '@/sim/agents';
import { BOIDS } from '@/sim/boids';
import { activePath, flatten, type Status } from '@/sim/bt';
import { PLACES } from '@/sim/layout';
import { SEASON } from '@/sim/game';
import { backboneLabel } from '@/sim/plannerClient';
import { ACTIVITY_LABEL, DT } from '@/sim/simulation';
import { framePerf, useGame, useSim, useTick, useUI, type Tool } from '../store';

/** Renders `code` spans for text between backticks (log lines and reasons). */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

const SPEEDS: [number, string][] = [[0, 'Pause'], [1, '1×'], [3, '3×'], [10, '10×']];

const KEYS: [string, string][] = [
  ['1–6', 'pick a tool (Fire Season: 1–3)'],
  ['B', 'ring the alarm bell (Fire Season)'],
  ['Space', 'pause / resume'],
  ['F', 'follow the selected villager'],
  ['N', 'navmesh overlay'],
  ['Esc', 'back to select'],
  ['Drag', 'orbit · right-drag pan · scroll zoom'],
];

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const sim = useSim();
  const game = useGame();
  const refresh = useTick(4);
  return (
    <header className="top card">
      <h1>Living Village</h1>
      <span className={`mode-badge ${game.mode}`}>{game.mode === 'challenge' ? '🔥 Fire Season' : '🧪 Sandbox'}</span>
      <p>behavior trees · Recast/Detour · boids · LLM planner</p>
      <span className="clock">Day {sim.day}, {sim.clock()}</span>
      <div className="seg" role="group" aria-label="Simulation speed">
        {SPEEDS.map(([s, label]) => (
          <button key={s} aria-pressed={sim.speed === s} onClick={() => ((sim.speed = s), refresh())}>
            {label}
          </button>
        ))}
      </div>
      {game.mode === 'sandbox' && (
        <button className="bar-btn" onClick={() => game.end()} title="See a summary of this session">End session</button>
      )}
      <button className="bar-btn" onClick={onMenu} title="Back to the start menu (this game is discarded)">Menu</button>
      <details className="keys">
        <summary aria-label="Keyboard and mouse controls" title="Controls">?</summary>
        <dl>
          {KEYS.map(([k, what]) => (
            <Fragment key={k}>
              <dt><kbd>{k}</kbd></dt>
              <dd>{what}</dd>
            </Fragment>
          ))}
        </dl>
      </details>
    </header>
  );
}

const TOOLS: [Tool, string, string, string][] = [
  ['select', '👆', 'Select', 'Select a villager'],
  ['fire', '🔥', 'Fire', 'Start a fire'],
  ['rock', '🪨', 'Obstacle', 'Drop an obstacle'],
  ['food', '🧺', 'Food', 'Leave food'],
  ['well', '⛲', 'Well', 'Build a well'],
  ['erase', '✖', 'Remove', 'Remove an item'],
];

function DebugOverlays() {
  const { overlays, toggleOverlay } = useUI();
  return (
    <details className="fold">
      <summary>Debug overlays</summary>
      {([
        ['navmesh', 'NavMesh (Recast)'],
        ['obstacles', 'TileCache obstacles'],
        ['paths', 'Paths & corridors'],
        ['perception', 'Perception radius'],
      ] as const).map(([k, label]) => (
        <label key={k} className="toggle">
          <input type="checkbox" checked={overlays[k]} onChange={() => toggleOverlay(k)} />
          {label}
        </label>
      ))}
    </details>
  );
}

/** Charge meter for a tool that refills over time. */
const Charges = ({ value, max }: { value: number; max: number }) => (
  <span className="charges" aria-label={`${Math.floor(value)} of ${max}`}>
    {Array.from({ length: max }, (_, k) => (
      <i key={k} style={{ '--p': `${Math.round(Math.min(1, Math.max(0, value - k)) * 100)}%` } as React.CSSProperties} />
    ))}
  </span>
);

/** Fire Season: the player protects the village instead of editing it. */
function ChallengeTools() {
  const game = useGame();
  const { tool, setTool } = useUI();
  const refresh = useTick(5);
  const tools: [Tool, string, string, string, React.ReactNode][] = [
    ['select', '👆', 'Select', 'Select a villager (1)', null],
    ['water', '💧', 'Water', 'Throw water on a fire (2). Two buckets put one out.', <Charges key="w" value={game.water} max={SEASON.water.max} />],
    ['food', '🧺', 'Food', 'Leave a food basket (3), for the shortage', <Charges key="f" value={game.food} max={SEASON.food.max} />],
  ];
  return (
    <aside className="tools card" aria-label="Your tools">
      <h3>Your tools</h3>
      <div className="stack">
        {tools.map(([t, ic, label, long, extra]) => (
          <button key={t} className={`tile wide${t === 'water' ? ' water' : ''}`} aria-pressed={tool === t} onClick={() => setTool(t)} title={long}>
            <span className="ic">{ic}</span>
            {label}
            {extra}
          </button>
        ))}
        <button
          className="tile wide bell" disabled={game.alarmIn > 0 || !game.sim.aliveFires().length}
          onClick={() => (game.ringAlarm(), refresh())}
          title="Everyone within 20 m of a fire evacuates now, and the planner is asked for a plan (B)"
        >
          <span className="ic">🔔</span>
          {game.alarmIn > 0 ? `Bell in ${Math.ceil(game.alarmIn)} s` : game.sim.aliveFires().length ? 'Ring the bell' : 'Bell (no fire)'}
        </button>
      </div>
      <p className="tip">Fires near houses do double damage. Tomas fights fires on his own; water helps him finish them before they spread.</p>
      <DebugOverlays />
    </aside>
  );
}

export function Toolbar() {
  const game = useGame();
  return game.mode === 'challenge' ? <ChallengeTools /> : <EditorTools />;
}

function EditorTools() {
  const sim = useSim();
  const { tool, setTool, select, setPerfOpen } = useUI();
  const refresh = useTick(4);
  return (
    <aside className="tools card" aria-label="World editor">
      <h3 title="Pick a tool, then click the map. Every edit rebuilds only the navmesh tiles it touches, and villagers reroute.">World editor</h3>
      <div className="tile-grid">
        {TOOLS.map(([t, ic, label, long], i) => (
          <button key={t} className={`tile${t === 'fire' ? ' fire' : ''}`} aria-pressed={tool === t} onClick={() => setTool(t)} title={`${long} (${i + 1})`}>
            <span className="ic">{ic}</span>
            {label}
          </button>
        ))}
      </div>

      <h3>Events</h3>
      <div className="pair">
        <button className={`tool${sim.festival > 0 ? ' on' : ''}`} onClick={() => (sim.setFestival(!(sim.festival > 0)), refresh())} title="Villagers gather to dance in the square">
          <span className="ic">🎉</span>Festival
        </button>
        <button className={`tool${sim.shortage > 0 ? ' on alert' : ''}`} onClick={() => (sim.setShortage(!(sim.shortage > 0)), refresh())} title="The market empties and hunger rises twice as fast">
          <span className="ic">🌾</span>Shortage
        </button>
      </div>

      <h3>Demos</h3>
      <button className="tool demo" onClick={() => sim.startFireNear('Maya') && select(0)} title="A fire a few meters from Maya; watch her decide and the planner coordinate">
        <span className="ic">▶</span>Fire near Maya
      </button>
      <button
        className="tool demo"
        title="The planner answers late, and a second fire has started meanwhile: the safety gate rejects commands that are no longer safe"
        onClick={() => {
          // Slow the simulated planner down for this one plan only (it used to stay at 4 s for the rest of the session).
          const before = sim.plannerLatencyMs;
          sim.plannerLatencyMs = 4000;
          const fire = sim.startFireNear('Maya');
          sim.plannerLatencyMs = before;
          if (!fire) return;
          select(0);
          refresh();
          setTimeout(() => sim.startFire({ x: 3.2, z: 3.4 }) ?? sim.startFire({ x: -3.4, z: 3.2 }), 800);
        }}
      >
        <span className="ic">▶</span>Stale plan
      </button>

      <details className="fold" onToggle={e => setPerfOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>Stress test</summary>
        <StressControls />
      </details>
      <DebugOverlays />
    </aside>
  );
}

const BIRD_COUNTS = [30, 250, 500, 1000, BOIDS.maxCount];

/** Push the systems past their design load and watch the performance overlay. */
function StressControls() {
  const sim = useSim();
  const refresh = useTick(4);
  const n = sim.flock.birds.length;
  return (
    <>
      <div className="seg stress" role="group" aria-label="Number of birds">
        {BIRD_COUNTS.map(c => (
          <button key={c} aria-pressed={n === c} onClick={() => (sim.setBirdCount(c), refresh())} title={`${c} birds`}>
            {c >= 1000 ? `${c / 1000}k` : c}
          </button>
        ))}
      </div>
      <label className="toggle" title="Off: every bird checks every other bird, O(n²)">
        <input type="checkbox" checked={sim.flock.grid} onChange={() => ((sim.flock.grid = !sim.flock.grid), refresh())} />
        Boids spatial grid
      </label>
      <div className="pair">
        <button className="tool" onClick={() => (sim.scatterObstacles(20), refresh())} title="Drop 20 obstacles at random spots">
          <span className="ic">🪨</span>+20 rocks
        </button>
        <button className="tool" onClick={() => (sim.clearObstacles(), refresh())} title="Remove every obstacle">
          <span className="ic">🧹</span>Clear
        </button>
      </div>
    </>
  );
}

const fpsColor = (fps: number) => (fps >= 55 ? 'var(--moss)' : fps >= 30 ? '#d49a2a' : 'var(--ember)');

export function PerfOverlay() {
  const sim = useSim();
  const { perfOpen, setPerfOpen } = useUI();
  useTick(4);
  const { fps, frameMs, worstMs, simMs, calls, triangles, dpr } = framePerf;
  const { brainMs, navMs, boidsMs } = sim.perf;
  const n = sim.flock.birds.length;
  const minutes = Math.max(sim.simTime / 60, 1 / 60);
  const switches = sim.stats.goalSwitches / sim.villagers.length / minutes;
  return (
    <div className={`overlay perf${perfOpen ? ' open' : ''}`}>
      <button className="pill" onClick={() => setPerfOpen(!perfOpen)} aria-expanded={perfOpen} title="Performance details">
        <b className="fps" style={{ color: fpsColor(fps) }}>{fps.toFixed(0)} FPS</b>
        <span>{frameMs.toFixed(1)} ms</span>
        {n !== BOIDS.count && <span>{n} birds</span>}
        <span className="chev">{perfOpen ? '▾' : '▸'}</span>
      </button>
      {perfOpen && (
        <div className="details">
          <div>
            frame <b>{frameMs.toFixed(1)}</b> ms (worst {worstMs.toFixed(0)}) · sim <b>{simMs.toFixed(1)}</b> ms/frame · {calls} draw calls · {(triangles / 1000).toFixed(0)}k tris · resolution <b>{dpr}x</b> (auto)
          </div>
          <div>
            per 30 Hz step: brains <b>{brainMs.toFixed(2)}</b> · navmesh + crowd <b>{navMs.toFixed(2)}</b> · boids <b>{boidsMs.toFixed(2)}</b> ms
          </div>
          <div>
            {sim.villagers.length} villagers · {n} birds ({sim.flock.grid ? 'grid' : 'all pairs'}, {n ? Math.round(sim.flock.pairChecks / n) : 0} checks/bird)
          </div>
          <div>
            navmesh <b>{sim.nav.obstacleCount}</b> obstacles · rebuild <b>{sim.stats.lastRebuildMs.toFixed(1)}</b> ms · goal switches/min <b>{switches.toFixed(1)}</b> · stuck fixes <b>{sim.stats.stuckRecoveries}</b>
            {sim.stats.lastTimeToSafety != null && <> · time to safety <b>{sim.stats.lastTimeToSafety.toFixed(1)} s</b></>}
          </div>
        </div>
      )}
    </div>
  );
}

export function PlannerPanel() {
  const sim = useSim();
  const { plannerOpen, setPlannerOpen, backbone } = useUI();
  const refresh = useTick(4);
  const status = sim.planner?.status() ?? 'offline';
  const info = (sim.planner as { serverInfo?: { planner: string; version: string; llm: boolean } | null } | null)?.serverInfo;
  const llm = status === 'online' && !!info?.llm && backbone !== 'rules';
  const color = status === 'online' ? '#3f9a5a' : status === 'connecting' ? '#d49a2a' : '#c9502a';
  const label = llm ? backboneLabel(backbone) : status === 'online' ? 'Server rules' : status === 'connecting' ? 'Connecting…' : 'Local planner';
  const last = sim.lastPlan;
  return (
    <div className={`overlay planner${plannerOpen ? ' open' : ''}`}>
      <button className="pill" onClick={() => setPlannerOpen(!plannerOpen)} aria-expanded={plannerOpen} title="Planner details">
        <span className="status" style={{ background: color }} />
        <strong>{label}</strong>
        {sim.pendingPlans > 0 ? (
          <span className="pending">thinking…</span>
        ) : (
          <span className="counts">
            <b className="ok">{sim.stats.accepted} ✓</b> <b className="no">{sim.stats.rejected} ✗</b>
          </span>
        )}
        <span className="chev">{plannerOpen ? '▾' : '▸'}</span>
      </button>
      {plannerOpen && (
        <div className="details">
          <div className="muted">
            {status === 'online' && info ? `${info.planner} · v${info.version} · WebSocket` : 'Server offline: the same rules run in the browser.'}
          </div>
          {llm ? (
            <p className="muted">
              Every fire triggers an LLM call; villagers act on reflexes while it thinks. Spent so far: <b>${sim.stats.llmCostUsd.toFixed(3)}</b> over {sim.stats.plans} plans.
            </p>
          ) : (
            <label>
              Simulated LLM latency: <b>{(sim.plannerLatencyMs / 1000).toFixed(1)} s</b>
              <input
                type="range" min={0} max={6000} step={250} value={sim.plannerLatencyMs}
                onChange={e => ((sim.plannerLatencyMs = Number(e.target.value)), refresh())}
              />
            </label>
          )}
          {last && (
            <p className="last">
              <span className="muted">Last plan ({last.latencyS.toFixed(1)} s, {last.accepted} accepted{last.rejected ? `, ${last.rejected} rejected` : ''}{last.costUsd ? `, $${last.costUsd.toFixed(4)}` : ''}):</span>{' '}
              {last.summary || `${last.planner}.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const bar = (label: string, value: number, color: string) => (
  <div className="need" key={label}>
    <span>{label}</span>
    <div className="track">
      <div className="fill" style={{ width: `${value}%`, background: color }} />
    </div>
    <span>{Math.round(value)}</span>
  </div>
);

const KIND_ICON = { selector: '?', sequence: '→', condition: '◇', action: '▶' } as const;
const STATUS_ICON: Record<Status, string> = { running: '●', success: '✓', failure: '✗' };

export function Inspector() {
  const sim = useSim();
  const { selected, select, follow, setFollow } = useUI();
  useTick(4);
  const v = selected == null ? null : sim.villagers[selected];
  const flat = flatten(sim.tree);
  const path = v ? activePath(sim.tree, v.trace).map(n => n.id) : [];
  const fears = v ? Object.entries(v.fear).filter(([, until]) => (until ?? 0) > sim.day) : [];
  return (
    <aside className="insp card" aria-label="Villager inspector">
      <h3>Villagers</h3>
      <div className="chips">
        {sim.villagers.map(o => (
          <button key={o.id} className={`chip${o.injured ? ' hurt' : ''}`} aria-pressed={o.id === selected} onClick={() => select(o.id === selected ? null : o.id)}>
            <span className="dot" style={{ background: o.color }} />
            {o.name}
          </button>
        ))}
      </div>
      {!v ? (
        <p className="empty">Click a villager on the map, or a name above, to see their needs, goal, behavior tree and memories.</p>
      ) : (
        <>
          <div className="who">
            <span className="dot" style={{ background: v.color }} />
            <div>
              <h2>{v.name}</h2>
              <p>{ROLE_LABEL[v.role]}, lives in house {v.home + 1}</p>
            </div>
            <button className="follow" aria-pressed={follow} onClick={() => setFollow(!follow)} title="Camera follows this villager (F)">
              {follow ? 'Following' : 'Follow'}
            </button>
          </div>
          <dl>
            <dt>State</dt>
            <dd>{v.injured ? 'Hurt in the smoke, with the healer' : ACTIVITY_LABEL[v.act]}</dd>
            <dt>Goal</dt>
            <dd>{v.goal?.label ?? 'Deciding'}</dd>
            <dt>Decision</dt>
            <dd className="decision">
              {v.goal?.cmd ? <code>{v.goal.cmd}</code> : <span>Following routine</span>}
              {v.goal && <span className={`badge src-${v.goal.source}`}>{v.goal.source}</span>}
            </dd>
          </dl>
          <p className="why">Why: {sim.explain(v)}</p>
          {fears.length > 0 && (
            <p className="fear">
              Memory at work: avoids the {fears.map(([k]) => PLACES[k as keyof typeof PLACES]?.name ?? k).join(', ')} until day {fears[0][1]}
            </p>
          )}
          {sim.rules.harm && bar('Health', v.health, v.health > 50 ? '#3f8f5a' : v.health > 25 ? '#d49a2a' : '#c9502a')}
          {bar('Hunger', v.hunger, '#c9502a')}
          {bar('Energy', v.energy, '#3f8f5a')}
          {bar('Social', v.social, '#4a78b0')}
          <h3 className="sub">
            Behavior tree <small>live, ticks every 0.4 s</small>
          </h3>
          <ul className="bt">
            {flat
              .filter(n => n.depth <= 1 || (n.parent != null && path.includes(n.parent)))
              .map(n => {
                const s = v.trace.get(n.id);
                const onPath = path.includes(n.id);
                const cls = s == null ? 'unvisited' : onPath && s !== 'failure' ? 'running' : s;
                return (
                  <li key={n.id} className={cls} style={{ paddingLeft: n.depth * 12 }} title={n.id}>
                    <span className="st">{s ? STATUS_ICON[s] : '·'}</span>
                    <span className="k">{KIND_ICON[n.kind]}</span>
                    {n.label}
                  </li>
                );
              })}
          </ul>
          <h3 className="sub">Closest relationships</h3>
          {Object.entries(v.rel)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([id, val]) => bar(sim.villagers[Number(id)].name, val, sim.villagers[Number(id)].color))}
          <h3 className="sub">Episodic memory</h3>
          {v.memory.length ? (
            <ul className="mem">
              {v.memory.map((m, i) => (
                <li key={i}>
                  <time>{m.t}</time>
                  {m.text}
                  <span className="imp" title={`importance ${m.importance}/10`}>{'●'.repeat(Math.ceil(m.importance / 2))}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">Nothing memorable yet. Try starting a fire nearby.</p>
          )}
        </>
      )}
    </aside>
  );
}

export function EventLog() {
  const sim = useSim();
  useTick(4);
  return (
    <section className="logbox card" aria-label="Event log">
      <h3 title={`Fixed step ${Math.round(1 / DT)} Hz; planner replies are validated before use`}>Village log</h3>
      <ul className="log">
        {sim.log.map(l => (
          <li key={l.id} className={l.kind}>
            <time>{l.t}</time>
            <Rich text={l.text} />
          </li>
        ))}
      </ul>
    </section>
  );
}
