'use client';
import { Fragment } from 'react';
import { ROLE_LABEL } from '@/sim/agents';
import { BOIDS } from '@/sim/boids';
import { activePath, flatten, type Status } from '@/sim/bt';
import { PLACES } from '@/sim/layout';
import { ACTIVITY_LABEL, DT } from '@/sim/simulation';
import { framePerf, useSim, useTick, useUI, type Tool } from '../store';

/** Renders `code` spans for text between backticks (log lines and reasons). */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

const SPEEDS: [number, string][] = [[0, 'Pause'], [1, '1×'], [3, '3×'], [10, '10×']];

export function TopBar() {
  const sim = useSim();
  const refresh = useTick(4);
  return (
    <header className="top card">
      <h1>Living Village</h1>
      <p>3D vertical slice · behavior trees · Recast/Detour · boids</p>
      <span className="clock">Day {sim.day}, {sim.clock()}</span>
      <div className="seg" role="group" aria-label="Simulation speed">
        {SPEEDS.map(([s, label]) => (
          <button key={s} aria-pressed={sim.speed === s} onClick={() => ((sim.speed = s), refresh())}>
            {label}
          </button>
        ))}
      </div>
    </header>
  );
}

const TOOLS: [Tool, string, string][] = [
  ['select', '👆', 'Select villager'],
  ['fire', '🔥', 'Start a fire'],
  ['rock', '🪨', 'Drop obstacle'],
  ['food', '🧺', 'Leave food'],
  ['well', '⛲', 'Build a well'],
  ['erase', '✖', 'Remove item'],
];

export function Toolbar() {
  const sim = useSim();
  const { tool, setTool, overlays, toggleOverlay, select } = useUI();
  const refresh = useTick(4);
  return (
    <aside className="tools card" aria-label="World editor">
      <h3>World editor</h3>
      {TOOLS.map(([t, ic, label], i) => (
        <button key={t} className={`tool${t === 'fire' ? ' fire' : ''}`} aria-pressed={tool === t} onClick={() => setTool(t)} title={`Shortcut: ${i + 1}`}>
          <span className="ic">{ic}</span>
          {label}
        </button>
      ))}
      <div className="sep" />
      <button className={`tool${sim.festival > 0 ? ' on' : ''}`} onClick={() => (sim.setFestival(!(sim.festival > 0)), refresh())}>
        <span className="ic">🎉</span>Hold a festival
      </button>
      <button className={`tool${sim.shortage > 0 ? ' on alert' : ''}`} onClick={() => (sim.setShortage(!(sim.shortage > 0)), refresh())}>
        <span className="ic">🌾</span>Food shortage
      </button>
      <button
        className="tool demo"
        onClick={() => {
          if (sim.startFireNear('Maya')) select(0);
        }}
      >
        <span className="ic">▶</span>Demo: fire near Maya
      </button>
      <button
        className="tool demo"
        title="Hard problem 2: the planner answers after 4 s, but a second fire has started in the square meanwhile"
        onClick={() => {
          sim.plannerLatencyMs = 4000;
          if (!sim.startFireNear('Maya')) return;
          select(0);
          refresh();
          setTimeout(() => sim.startFire({ x: 3.2, z: 3.4 }) ?? sim.startFire({ x: -3.4, z: 3.2 }), 800);
        }}
      >
        <span className="ic">▶</span>Demo: stale plan
      </button>
      <div className="sep" />
      <StressControls />
      <div className="sep" />
      <h3>Debug overlays</h3>
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
      <p className="hint">Pick a tool, then click the map. Every edit rebuilds only the navmesh tiles it touches, and villagers reroute.</p>
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
      <h3>Stress test</h3>
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
      <button className="tool" onClick={() => (sim.scatterObstacles(20), refresh())}>
        <span className="ic">🪨</span>Drop 20 obstacles
      </button>
      <button className="tool" onClick={() => (sim.clearObstacles(), refresh())}>
        <span className="ic">🧹</span>Clear obstacles
      </button>
    </>
  );
}

export function PerfOverlay() {
  const sim = useSim();
  useTick(4);
  const { fps, frameMs, worstMs, simMs, calls, triangles } = framePerf;
  const { brainMs, navMs, boidsMs } = sim.perf;
  const n = sim.flock.birds.length;
  const color = fps >= 55 ? 'var(--moss)' : fps >= 30 ? '#d49a2a' : 'var(--ember)';
  return (
    <div className="overlay perf">
      <div>
        <b className="fps" style={{ color }}>{fps.toFixed(0)} FPS</b> · frame <b>{frameMs.toFixed(1)}</b> ms (worst {worstMs.toFixed(0)}) · sim <b>{simMs.toFixed(1)}</b> ms/frame
      </div>
      <div>
        Per 30 Hz step: brains <b>{brainMs.toFixed(2)}</b> · navmesh + crowd <b>{navMs.toFixed(2)}</b> · boids <b>{boidsMs.toFixed(2)}</b> ms
      </div>
      <div>
        {sim.villagers.length} villagers · {n} birds ({sim.flock.grid ? 'grid' : 'all pairs'}, {n ? Math.round(sim.flock.pairChecks / n) : 0} checks/bird) · {calls} draw calls · {(triangles / 1000).toFixed(0)}k tris
      </div>
    </div>
  );
}

export function PlannerPanel() {
  const sim = useSim();
  const refresh = useTick(4);
  const status = sim.planner?.status() ?? 'offline';
  const info = (sim.planner as { serverInfo?: { planner: string; version: string; llm: boolean } | null } | null)?.serverInfo;
  const llm = status === 'online' && !!info?.llm;
  const color = status === 'online' ? '#3f9a5a' : status === 'connecting' ? '#d49a2a' : '#c9502a';
  return (
    <div className="overlay planner">
      <div className="row">
        <span className="status" style={{ background: color }} />
        <strong>
          {llm ? 'Planner: Claude via FastAPI' : status === 'online' ? 'Planner: FastAPI server' : status === 'connecting' ? 'Connecting to planner…' : 'Planner: in-browser fallback'}
        </strong>
      </div>
      <div style={{ color: 'var(--muted)', marginTop: 2 }}>
        {status === 'online' && info ? `${info.planner} · v${info.version} · WebSocket` : 'server offline, same rules run locally'}
      </div>
      {llm ? (
        <p style={{ color: 'var(--muted)', margin: '8px 0 0' }}>Real LLM latency: every fire triggers a Claude call; reflexes act while it thinks.</p>
      ) : (
        <label>
          Simulated LLM latency: <b>{(sim.plannerLatencyMs / 1000).toFixed(1)} s</b>
          <input
            type="range" min={0} max={6000} step={250} value={sim.plannerLatencyMs}
            onChange={e => ((sim.plannerLatencyMs = Number(e.target.value)), refresh())}
          />
        </label>
      )}
      <div style={{ marginTop: 4 }}>
        {sim.pendingPlans > 0 ? (
          <span className="pending">⏳ {sim.pendingPlans} plan in flight; reflexes are acting meanwhile</span>
        ) : (
          <span style={{ color: 'var(--muted)' }}>
            Commands: <b style={{ color: 'var(--moss)' }}>{sim.stats.accepted} accepted</b> · <b style={{ color: 'var(--ember)' }}>{sim.stats.rejected} rejected</b>
          </span>
        )}
      </div>
    </div>
  );
}

export function StatsOverlay() {
  const sim = useSim();
  useTick(2);
  const minutes = Math.max(sim.simTime / 60, 1 / 60);
  const switches = sim.stats.goalSwitches / sim.villagers.length / minutes;
  return (
    <div className="overlay stats">
      NavMesh <b>{sim.nav.obstacleCount}</b> obstacles · rebuild <b>{sim.stats.lastRebuildMs.toFixed(1)} ms</b> · goal switches/min <b>{switches.toFixed(1)}</b> · stuck fixes <b>{sim.stats.stuckRecoveries}</b>
      {sim.stats.lastTimeToSafety != null && <> · time to safety <b>{sim.stats.lastTimeToSafety.toFixed(1)} s</b></>}
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
          <button key={o.id} className="chip" aria-pressed={o.id === selected} onClick={() => select(o.id === selected ? null : o.id)}>
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
            <dd>{ACTIVITY_LABEL[v.act]}</dd>
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
          {bar('Hunger', v.hunger, '#c9502a')}
          {bar('Energy', v.energy, '#3f8f5a')}
          {bar('Social', v.social, '#4a78b0')}
          <h3 className="sub">
            Behavior tree <small>live, ticks every 0.4 s</small>
          </h3>
          <ul className="bt">
            {flat
              .filter(n => n.depth <= 1 || (n.parent != null && v.trace.has(n.parent)))
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
      <h3>
        Village log <small>fixed step {Math.round(1 / DT)} Hz · planner replies are validated before use</small>
      </h3>
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
