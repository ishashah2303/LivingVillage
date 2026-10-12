# Living Village

A generative multi-agent ecosystem: a small 3D village that runs on its own. You watch it, inspect it, and disrupt it.
Visual Computing course project, Group JJ: Harjeet Singh Chahal (hc1242, group leader) and Isha Nimesh Shah (ins28).

**Pillars:** NPC AI / behavior trees · pathfinding and navigation (Recast/Detour) · swarm / boids.

## Status (stage 2)

A 3D vertical slice on the stack from our proposal:

- **3D village** in Three.js via React Three Fiber (Next.js): same layout as the stage 1 mockup, day/night cycle, procedural character animation, fire/smoke effects, festival lanterns.
- **Navigation:** a real Recast/Detour navmesh (recast-navigation-js, WebAssembly). Houses, trees, the pond, and every user edit are TileCache obstacles, so an edit rebuilds only the tiles it touches (under 1 ms). Villagers are DetourCrowd agents.
- **Behavior:** a small reactive behavior-tree library; one tree drives all eight villagers. The inspector renders the live tree, the decision and where it came from (routine, need, reflex, planner).
- **Memory and relationships:** episodic memories with importance; memories change behavior (after a fire, villagers avoid that place for the rest of the day); helping someone raises the relationship.
- **Boids:** 30 birds in 3D with separation, alignment and cohesion, a day circuit and night roost, fire avoidance and a startle response.
- **Deliberative planner:** a FastAPI service over WebSocket. On big events the browser sends a situation report; the planner answers with `EVACUATE(place)`, `INVESTIGATE(Fire#n)` and `HELP_AGENT(name)`. It is rule-based today (an LLM later) and has a simulated "LLM latency" slider. Every command passes a client-side **safety gate** (names exist, still safe, reachable, not expired) because it was planned for a world that may have moved on. Offline, the same rules run in the browser.
- **Tests:** 17 simulation tests (behavior-tree semantics, planner and gate, headless scenario runs on the real WASM navmesh, a full-day soak) and 5 server tests.

## Repository

| Path | What |
| --- | --- |
| `index.html` | Stage 1 2D mockup (also at https://ishashah2303.github.io/living-village/) |
| `web/` | 3D app: Next.js 16, React Three Fiber, Three.js, recast-navigation-js |
| `web/sim/` | Framework-free simulation core (runs in the browser and in Node tests) |
| `web/components/` | The R3F scene (`scene/`) and UI panels (`ui/`) |
| `server/` | FastAPI planner service |
| `docs/stage2-presenter-guide.md` | 5-minute script, demo runbook, Q&A prep |
| `Assignment 1.pdf`, `Assignment1_LivingVillage_hc1242_ins28.pdf` | Brief and our stage 1 proposal |

## Run it

Needs Node 20+ and Python 3.11+ with [uv](https://docs.astral.sh/uv/).

Planner service (port 8000):

```bash
cd server && uv sync && uv run uvicorn app.main:app --port 8000
```

Web app (port 3000), in a second terminal:

```bash
cd web && npm install && npm run dev
```

Open http://localhost:3000. The planner panel turns green when the server is connected. The app also works without the server, using the in-browser fallback.

For a presentation, use the production build (faster, no dev overlay):

```bash
cd web && npm run demo
```

### Controls

- **World editor:** select a villager, start a fire, drop an obstacle, leave food, build a well, remove an item; hold a festival or cause a food shortage.
- **Demo: fire near Maya** starts the scripted scenario and selects Maya. **Demo: stale plan** sets the planner latency to 4 s and starts a second fire while the plan is in flight, so the safety gate rejects commands that are no longer safe.
- **Debug overlays:** navmesh, TileCache obstacles, paths and DetourCrowd corridors, perception radius.
- **Keys:** `1`–`6` tools, `Space` pause, `F` follow the selected villager, `N` navmesh overlay, `Esc` back to select.
- **Camera:** drag to orbit, right-drag to pan, scroll to zoom.
- **Debug handles** in the browser console: `sim` (the simulation), `ui` (UI store), `view([x, y, z], [tx, ty, tz])` (camera).

## Architecture

```
BROWSER  (Next.js + React Three Fiber + Three.js)

  world event → perception → behavior tree + memory → navigation      → animation
                             (2.5 Hz)        │  ▲      (Recast/Detour,   (60 fps)
                                             │  │       WASM, 30 Hz)
                            situation report │  │ commands, re-checked
                            (WebSocket)      ▼  │ by the safety gate
SERVER  (FastAPI)
                             planner: rules today, an LLM later
                             memory store (later): PostgreSQL + pgvector
```

The fast loop never waits for the server. Reflexes act immediately; the planner's coordinated plan arrives 0 to 10 s later and refines them if it still makes sense.

| File | Role |
| --- | --- |
| `web/sim/simulation.ts` | World state, fixed 30 Hz step, events, needs, goals, movement, planner round-trips |
| `web/sim/villagerTree.ts` | The villager behavior tree |
| `web/sim/bt.ts` | Behavior-tree library (selector, sequence, condition, action, live trace) |
| `web/sim/nav.ts` | Recast/Detour wrapper: TileCache navmesh, obstacles, DetourCrowd, path queries |
| `web/sim/boids.ts` | 3D boids |
| `web/sim/planner.ts` | Command grammar, rule-based planner (mirror of the server), safety gate |
| `web/sim/plannerClient.ts` | WebSocket client with reconnect and in-browser fallback |
| `web/sim/layout.ts` | Village layout (the stage 1 grid converted to meters), procedural trees |
| `server/app/planner.py` | Rule-based planner; `LLMPlanner` interface sketch |
| `server/app/main.py` | REST (`/api/health`, `/api/commands`, `/api/plan`) and WebSocket (`/ws/planner`) |

## Tests

```bash
cd web && npm test              # 17 simulation tests (Vitest, real WASM navmesh in Node)
cd web && npm run typecheck
cd server && uv run pytest      # 5 planner and API tests
```

## Static hosting

The app can be exported as a static site (for example to GitHub Pages, like the mockup). Without the server, it uses the in-browser planner.

```bash
cd web && STATIC_EXPORT=1 BASE_PATH=/living-village npm run build   # output in web/out/
```

## Next

1. Rigged characters with animation blending, danger area costs in the navmesh, crowd polish.
2. A memory store in PostgreSQL with pgvector (reflection and retrieval).
3. An LLM planner behind the same safety gate; the rule planner stays as the fallback.
4. Evaluation: a scenario suite, metrics (time to safety, goal switches per minute, stuck recoveries, commands accepted vs rejected) and a small believability study.
