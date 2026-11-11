# Living Village: Assignment 5 readiness and implementation plan

Reviewed November 8, 2026. Baseline commit: `428659a` (Assignment 4 alpha).

**Historical study:** this document preserves the original audit and proposed scope. For the implemented November 9 beta, verification results and remaining limits, see [beta-release.md](beta-release.md). Proposals below are not all assignment requirements; active-goal revalidation, true-arrival checks, crowd scaling and readability fixes have now shipped locally.

Follow-up: sandbox crowd scaling and performance capture are now implemented. See [the scaling experiment](scaling-notes.md) for controls, measured limits and raw evidence. The original baseline observations below describe the pre-scaling checkout; the proposed hazard-aware beta work remains outstanding.

This is a project study and proposed beta scope. Features below marked as proposed have not been implemented. The course brief is `C:\Users\ishas\Downloads\Assignment 5_ Beta Build.pdf`; both pages were read and visually inspected.

## What the assignment requires

The brief calls for incremental expansion, meaningful secondary-pillar integration, visual cohesion, stability under normal input, preservation of the Start / Active / End loop, and performance against the Assignment 2 target. It explicitly allows some mechanics to remain in development; it does not require a feature freeze.

Submit a PDF of **at most two pages** containing:

- An updated schedule.
- Beta release notes describing changes since Assignment 4.
- A very brief review of the first pillar and its achievements (the TA's added requirement).
- An exact explanation of how the secondary pillar interacts with the core loop.
- New features and honest known issues.
- A hosted-project or build-ZIP link, plus the updated public GitHub repository link.

The brief gives no due date. Assignment 2's original specification is absent from this checkout. `docs/assignment3-report.html` records its target as **60 FPS with eight villagers, 40 birds, and runtime navmesh updates**; use that as provisional context until the original specification is available. The app defaults to 30 birds.

## Project map

| Area | Implementation and role |
| --- | --- |
| Original prototype | Root `index.html`: self-contained 2D canvas mockup with grid A*, priority decisions, and 2D boids. Historical reference; the current app is in `web/`. |
| App and lifecycle | `web/app/`, `ClientRoot.tsx`, `VillageApp.tsx`, `Workspace.tsx`: Next.js client app, lazy scene loading, start menu, fresh simulation per game, results and restart. |
| Simulation | `web/sim/simulation.ts`: fixed 30 Hz step, time, needs, health, events, memory, movement, world editing, planner requests and command application. |
| First pillar | `bt.ts`, `villagerTree.ts`, `agents.ts`: reactive behavior trees at roughly 2.5 Hz; emergencies precede social help, events, needs and routine. Eight named villagers have occupations and relationships. |
| Second pillar | `nav.ts`, `layout.ts`: Recast/Detour WASM, TileCache obstacle updates, DetourCrowd, reachability queries, shared scene layout. |
| Third pillar | `boids.ts`: 3D separation, alignment and cohesion; spatial hash; day circuit, night roost, fire repulsion and startle; up to 2,000 birds in the stress test. |
| Game | `game.ts`: four-minute Fire Season, escalating fires, spread, shortage, integrity and injury loss conditions, rechargeable tools, alarm, score and stars. Sandbox has an explicit session end. |
| Planning | `planner.ts`, `localPlanner.ts`, `plannerClient.ts`; `server/app/`: rules in TypeScript and Python, optional Claude coordination over WebSocket, constrained names, server grounding, live client validation, timeouts and spend limits. |
| Presentation | `components/scene/`: procedural low-poly geometry and animation, fire/smoke, lighting, instanced birds/trees/crops, merged static meshes, debug overlays. `components/ui/` and `globals.css`: tools, inspector, event log, menu, HUD and results. |
| Evidence | Vitest and pytest suites; `server/bench/` scenario exporter, benchmark harness and saved results; proposal, Assignment 3/4 reports and presenter scripts. |
| Deployment | `.github/workflows/pages.yml`: test and static export to GitHub Pages. `render.yaml`: FastAPI planner hosting. |

The fast simulation stays in the browser. A fire changes the navmesh, triggers immediate behavior-tree responses and bird reactions, and sends a situation report to the slower planner. Accepted commands parameterize existing behaviors. Memory changes later behavior rather than merely adding log entries.

## Verified alpha baseline

- Start / Active / End states, Fire Season and Sandbox already exist.
- Dynamic obstacles, crowd movement, emergency behavior, fire-reactive boids and coordinated evacuation already exist. These must be described as prior achievements, not new beta features.
- The current cast is eight villagers. The 24/32-person benchmark cases are synthetic planner inputs, not playable crowds.
- Memory consists of up to eight in-session episodes per villager, fear of places, and relationship values. There is no PostgreSQL/pgvector store or memory retrieval into the planner prompt.
- Characters and scenery are procedural. Rigged character assets, animation blending, audio, floods, storms, sickness, hierarchical planning, a model cascade and a boids worker are roadmap items.
- Rendering already includes material sharing, static geometry merging, instancing, adaptive pixel density, a fixed light pool and fire warmup.

### Checks performed

| Check | Result |
| --- | --- |
| Frontend simulation suite | **31 passed**, one optional scenario-export test skipped. Real Recast WASM is exercised, including bot wins, idle-player losses, stale commands, obstacle edits, flock stress and a day-long soak. |
| TypeScript | `npm run typecheck` passed. |
| Backend suite | **18 passed**. API/WebSocket round trips, rules, fake-client LLM grounding/fallback and limits; no real LLM calls. |
| Browser smoke check | Local menu and Sandbox loaded. Triggered Fire near Maya and observed reflex evacuation, three accepted local-planner commands, Oskar helping Maya, Tomas putting the fire out, and Maya subsequently avoiding the farm. End session showed the summary; Play again reset the day, statistics and memories in a fresh village. |
| Performance observation | The live overlay reached 60 FPS after loading but varied during the check. This was a brief development-build observation, not a controlled release benchmark. |
| Fresh production build and public deployment | Not verified in this study. |

The initial Vitest run failed to find files in the sandbox temporary directory. A rerun using `tmp/vitest` as TEMP/TMP and one worker passed. Backend tests initially hung in Python's Windows event-loop socket setup; the same suite passed outside the sandbox. These are environment findings, not demonstrated game defects.

## Findings that matter for the beta

1. **Navigation avoids fire geometry, but not smoke exposure along a route.** `nav.ts` carves the flame footprint. `simulation.ts` applies damage within a wider smoke radius. The route query has no hazard-area cost. `planner.ts` scores destinations by straight-line distance and safety at the destination; the client then checks reachability. A reachable destination can still have a risky route.

2. **A current escape target can become unsafe.** `actFlee()` retains `v.flee[fireId]` without rechecking all current hazards or reachability. The command gate checks incoming plans, but does not continuously validate already-active goals. Add a regression scenario where a second fire or obstacle invalidates a target during evacuation.

3. **A failed trip can be treated as arrival.** `syncAgent()` calls `arrive()` after more than four failed recovery attempts. For a shelter goal, `arrive()` records a time-to-safety. Separate failed movement from actual safe arrival before using this metric as evaluation evidence.

4. **Crowd expansion crosses several limits.** The live cast is fixed in `agents.ts`; DetourCrowd has `maxAgents: 24`; the server caps reports at 32 agents and 32 relationships per agent. Shelter capacity is three per spot, and hazards reduce the usable spots. A better assignment algorithm cannot create missing shelter capacity. Scaling requires coordinated changes to agents, navigation, schemas, shelters, UI and rendering.

5. **Offline fallback has an in-flight gap.** `PlannerClient.plan()` uses local rules if offline at dispatch. A connection closing or timing out after dispatch rejects that request; the simulation logs it and continues on reflexes. It does not retry that particular report through local rules. Improve this with disposal-aware fallback and malformed-message handling.

6. **User-facing text needs reconciliation.** The HUD/help say fires near houses cause double damage, while `game.ts` computes `0.3 + 0.6 = 0.9`, three times the normal drain. The menu calls Haiku the fastest while the saved Assignment 4 comparison found Sonnet faster in those runs. Model labels, current availability and pricing need separate provider verification before a new release; this study only inspected the repository's configuration and historical evidence.

7. **Some historical issues need reproduction.** The alpha report says sleeping villagers ignore nearby fires. Current behavior-tree evaluation includes sleeping villagers, while alarm and health handling explicitly skip invisible villagers. Test nighttime fire and alarm cases rather than copying the old statement into the beta report as a confirmed current defect.

8. **Evaluation coverage is narrower than the roadmap.** Whole-game bot tests do not attach an asynchronous planner. Saved benchmarks measure snapshot command validity/coverage, not completed evacuations or rendered FPS. Browser stress, reconnects, repeated restarts, overlapping emergencies, and human playtesting remain important release checks.

## Recommended Assignment 5 scope

Make **hazard-aware evacuation** the central beta improvement. It directly deepens the original pathfinding/navigation pillar and produces a visible, measurable difference in the existing Fire Season loop.

### Core implementation

- Give civilians routes that account for smoke exposure, while allowing a healthy guard to approach the fire. Prototype how the installed Recast binding supports area costs and crowd filters; ensure the route actually followed uses the same policy as the route evaluated.
- Recheck active evacuation destinations when hazards or obstacles change, retain safe assignments to reduce dithering, and replace unsafe or unreachable ones promptly.
- Distinguish arrival, failure and recovery. Count someone as safe only when position and hazard distance meet the condition.
- Use reachable route costs for evacuation assignment. If adding min-cost flow, include shelter capacity and existing occupancy, and keep the browser/server planning contract consistent.
- Close the in-flight planner fallback gap and cover nighttime emergencies and restart races with focused tests.

### Visual integration

- Preserve the village's low-poly aesthetic and moss/stone/ember palette.
- Show evacuation destinations and danger clearly; keep detailed navmesh diagnostics optional.
- Make smoke, evacuation state, tool use and the alarm communicate the same emergency state used by the simulation.
- Add a visible rain transition when Fire Season ends; currently victory stops the simulation and shows text, without a rain effect.
- Improve label overlap, instruction accuracy and small-screen readability. Lightweight procedural animation and audio are optional polish; rigged assets are not required by this assignment.

### Optional expansion after the core is stable

- A playable 8/16/32-villager selector, with sufficient refuge capacity and measured frame-time impact.
- Stronger boids integration such as a clearly visible alarm/startle response, backed by a concrete gameplay explanation. Existing fire avoidance alone is alpha functionality.
- One additional hazard only if it shares the same hazard model, navigation, behavior, HUD and end-state logic.

Defer 64 villagers, four emergency types, persistent vector memory and a full model cascade until the core beta is measured. The Assignment 4 schedule can be revised honestly; it should distinguish delivered, deferred and planned work.

## Suggested sprint sequence

These are relative workdays, not a course deadline or a commitment for either teammate.

| Workday | Deliverable | Acceptance evidence |
| --- | --- | --- |
| 1 | Reproduce evacuation edge cases; implement true arrival/failure semantics and active-goal validation | Two-fire, blocked-refuge and stuck-agent regression scenarios |
| 2-3 | Hazard-aware movement and route-aware assignments | Same-seed comparison of travel time, smoke exposure, safe arrivals and goal switches |
| 4 | Visual pass and accurate instructions | Playable start-to-end loop, understandable tools/danger, readable desktop and smaller viewport |
| 5 | Stability and performance | Frontend/backend suites, typecheck, static build; repeat restart/offline cases; measured normal-load and stress runs |
| 6 | Playtest, release notes and PDF | Record actual feedback; link verified build and source; inspect final PDF and confirm at most two pages |

Measure the production build at a fixed viewport, device pixel ratio, browser and hardware. Include the recorded specification load of eight villagers and 40 birds, active fires and obstacle edits. Report average and p95 frame time as well as FPS, simulation cost and draw calls. Distinguish default gameplay from the 2,000-bird stress case.

## Report outline and release gate

**Page 1:** project/group and links; brief first-pillar recap; secondary-pillar integration with a concrete before/after example; concise release notes for features actually delivered.

**Page 2:** updated schedule; compact validation/performance evidence; known issues and deferred work.

Before calling the work a beta release:

- All existing and new relevant tests pass, TypeScript passes, and the static production export builds.
- Start, win/loss, replay, return to menu and Sandbox end work in the browser.
- New navigation affects actual villagers, health/safety outcomes and UI feedback inside the game.
- Performance is measured and the report reflects actual results.
- Public build and repository links are verified for the submitted revision.
- The final PDF has no placeholder claims, fabricated measurements or unimplemented features listed as shipped.

Repository-declared links (not checked against the live deployment during this study):

- Build: https://ishashah2303.github.io/LivingVillage/
- Source: https://github.com/ishashah2303/LivingVillage
