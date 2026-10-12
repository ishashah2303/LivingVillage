# Stage 2 presentation: presenter guide

Thursday 9/24 · about 5 minutes of presentation, then about 5 minutes of Q&A.
Slides: https://claude.ai/artifact/SmJpexkZ6QLK9GkJVnZDtV (the speaker notes on each slide hold the script below).

## 10 minutes before

1. Start the planner: `cd server && uv run uvicorn app.main:app --port 8000`.
2. Start the app in production mode: `cd web && npm run demo`, then open http://localhost:3000 in Chrome, full screen.
3. Check the planner panel (top left of the 3D view) is green: "Planner: FastAPI server". If it stays orange or red, the demo still works on the in-browser fallback; say so in one sentence.
4. Leave the app running at 1×. A full in-game day lasts 2.5 minutes, so reload the page just before the demo slide: a reload restarts the village at 07:30, when everyone is up and about.
5. Open the slides in Present mode on the other screen or in another window, and silence notifications.
6. On a large projector, zoom the browser (Cmd and +) once or twice so the side panels are readable from the back; the 3D view adapts.

## Timing

| # | Slide | Time |
| --- | --- | --- |
| 1 | Living Village | 0:15 |
| 2 | A small 3D village that runs on its own | 0:35 |
| 3 | From 2D mockup to 3D slice on the real stack | 0:25 |
| 4 | Live demo: a fire next to Maya | 1:15 |
| 5 | Fast loop in the browser, planner on a server | 0:40 |
| 6 | Hard problem 1: navigation | 0:35 |
| 7 | Hard problem 2: deliberation | 0:35 |
| 8 | Hard problem 3: believability | 0:30 |
| 9 | Next steps | 0:15 |
| 10 | Questions | |
| | **Total** | **about 5:05** |

Slides 11 to 13 are backup for the Q&A (the behavior tree, the command gate, tests and numbers).

If you run long, shorten slide 3 to one sentence and skip the optional demo steps.

## Demo runbook (slide 4)

1. Switch to the app. If the clock shows night (22:00 to 06:00), reload the page first: villagers are asleep indoors at night.
2. Click **Demo: fire near Maya** in the left panel. Maya is selected automatically.
3. Narrate while it happens:
   - "Within half a second": villagers near the fire say "Fire!" and run; Tomas the guard runs toward it.
   - "The planner panel": about 1.5 s later the log shows the planner's reply and the ✓ commands; Maya's inspector now shows `EVACUATE(...)` tagged **planner**, and "Why: Coordinated plan from the planner (arrived after 1.5 s)".
   - "Memory": the red note in the inspector says Maya avoids the farm until day 2.
4. Optional, if there is time (about 20 s):
   - Tick **NavMesh (Recast)** to show the hole carved around the fire, then untick it.
   - Click **Demo: stale plan**. It sets the planner latency to 4 s, starts a fire next to Maya, and 0.8 s later starts a second fire in the town square. When the first plan arrives (4 s), the log shows red "✗ Rejected `EVACUATE(…)`: … is now only N m from a fire" lines: commands planned for a world that has changed. That is hard problem 2, live. (It produced at least one rejection in 8 of 8 trial runs at different times of day; which commands get rejected depends on where villagers are.) Drag the latency back to 1.5 s afterwards.
5. Switch back to the slides.

If anything goes wrong (a blank canvas, a frozen tab), don't debug on stage: the screenshot on slide 4 is the same moment. Say "here's the same moment captured earlier" and move on.

## Script

These are the same words as the speaker notes. Say them naturally rather than reading.

**1 · Living Village.** Hi, we're Group JJ, Harjeet and Isha. Our project is Living Village: a small 3D village that runs on its own. In five minutes: what it is, what we built since the proposal, a quick demo, our stack, and the three problems we think will be hardest, especially the ones we don't expect a coding agent to solve for us.

**2 · The project.** Eight villagers with jobs, needs, friendships and memories, plus a flock of birds. Nobody scripts their day; it emerges from needs and a schedule. You can watch it, click any villager and see why they're doing what they do, and disrupt it: start a fire, drop a rock in the road, hold a festival. The goal is behavior that is believable and explainable. Our pillars are behavior trees, navmesh pathfinding, and boids.

**3 · Since the proposal.** At stage one we had this 2D mockup built on stand-ins: grid A*, simple priority rules. Since then we rebuilt it as a 3D vertical slice on the stack we actually proposed: a real Recast/Detour navmesh compiled to WebAssembly, our own behavior-tree library, and a Python planner service, covered by 22 automated tests.

**4 · Demo.** (See the runbook.) Four things to watch: reflexes within half a second; only the navmesh tiles under the fire rebuild, in under a millisecond; the planner's plan arrives 1.5 seconds later and passes a safety gate; and Maya remembers the fire.

**5 · Stack.** Everything that runs every frame stays in the browser: Next.js with React Three Fiber and Three.js, and a framework-free TypeScript simulation core. The top row is the pipeline from our proposal: event, perception, behavior tree with memory, navigation, animation. Slow thinking goes to a FastAPI service over a WebSocket; its commands pass a safety gate before they reach the behavior tree. Today the planner is rule-based; later it's an LLM with pgvector memory. The village never waits for the server.

**6 · Navigation.** Rebuilding the navmesh is fast; everything around it is hard. Agents are halfway along paths through polygons that just vanished, and a rock can land on someone. DetourCrowd only avoids locally, so crowds deadlock. We hit this for real: our guard froze behind a villager standing idle at the fountain, because idle crowd agents never step aside. The fix was a behavior rule, not a parameter. And fire is a soft danger while navmesh obstacles are all-or-nothing.

**7 · Deliberation.** Behavior trees react in under half a second; an LLM takes seconds. We set the planner's latency to four seconds and started a second fire while it was thinking. The plan came back for a world that no longer existed: it sent Elena to the town square, which was now five metres from a fire. The gate re-checks every command on arrival. The hard part isn't the code; it's deciding what a plan may override and when it counts as stale.

**8 · Believability.** There's no unit test for "believable". Our tests all passed while villagers walked to the market at midnight after a festival, because hunger outranked sleep. The fix was a design call: the market closes at nine and people eat at home. Memory should change behavior, not just fill a log; Maya avoiding the farm is our first example. We measure what we can, like goal switches per minute, and make every decision explainable so people can judge the rest.

**9 · Next.** Rigged characters and animation, then a memory store with retrieval, then the LLM planner behind the same gate, and finally evaluation with a scenario suite, metrics and a small believability study.

**10 · Questions.** Thanks, happy to take questions or try anything live.

## Likely questions

**Why Next.js for a real-time 3D simulation?**
It was in our proposal: React for the inspector and editor panels, and a static export for hosting. The 3D canvas is client-only (server rendering is off for it), and the scene updates imperatively every frame; React only re-renders the side panels about four times a second.

**Why not run the simulation on the server?**
The crowd and navmesh step at 30 Hz and the behavior trees at 2.5 Hz, which needs to be local. The navmesh library is WebAssembly and runs in the browser. The server only does slow deliberation, so network latency never touches movement.

**Why a navmesh instead of A*?**
The mockup used grid A*. A navmesh gives continuous paths that account for the agent's radius, supports runtime obstacles through TileCache (only touched tiles rebuild), and comes with DetourCrowd for local avoidance between villagers.

**How do runtime obstacles work?**
Every house, tree and user edit is a TileCache obstacle. Adding one marks the compressed layers of only the tiles it overlaps and rebuilds them (0.1 to 1 ms). DetourCrowd notices corridors through changed polygons and replans. We inflate obstacles by the agent radius, push agents out of a new obstacle's footprint first, and have a stuck detector that asks idle villagers to step aside, then sidesteps.

**What happens when the LLM hallucinates a place or a person?**
The planner can only emit three verbs (`EVACUATE`, `INVESTIGATE`, `HELP_AGENT`). The server validates the schema with Pydantic, and the browser gate checks that every name exists and that the command is still safe, reachable and not expired, against the live world. A rejected command is logged and the reflexes continue.

**How do reflexes and the planner avoid fighting each other?**
Safety comes first: reflexes act immediately. Planner commands don't get their own behavior-tree branch; they parameterize existing branches (which safe spot to flee to, whom to help), and only after passing the gate. Re-plans keep a villager's current target if it's still safe (sticky assignments), so villagers don't change their minds mid-run.

**How will you evaluate "believable"?**
Metrics we already log: time to safety, goal switches per villager per minute (a dithering measure, 3.7 over a simulated day), stuck recoveries, and commands accepted vs rejected. Plus a small study where classmates rate clips. The inspector makes every decision traceable, which also helps us debug.

**How does memory work now, and later?**
Now: a short episodic list per villager with an importance score, plus relationship values. Some memories change behavior (fear of a place for the rest of the day; helping raises the bond). Later: PostgreSQL with pgvector, retrieval scored by recency, importance and relevance, in the style of the Generative Agents paper (Park et al., 2023), feeding the LLM planner.

**How do the boids work?**
Separation, alignment and cohesion within a 5 m neighborhood, plus a home target (a circuit over the village by day, a roost over the forest at night), an altitude band, soft bounds, repulsion from fires and a startle impulse. With 30 birds the O(n²) neighbor search is trivial; for thousands we would use a spatial grid.

**Does it scale?**
DetourCrowd handles hundreds of agents; the behavior-tree ticks are staggered. The bottlenecks for a bigger village would be rendering (instancing and simple animation LOD) and the O(n²) boids.

**What did a coding agent do, and what didn't it?**
A coding agent wrote much of this slice quickly. What it couldn't do on its own was notice that behavior looked wrong or pick the fix: the guard deadlock and the midnight market were found by running scenarios and watching, and both fixes were design decisions. That's why our hard problems are about judgment, not code.

**Is the simulation deterministic?**
The layout and villagers come from a seeded random generator and the simulation uses a fixed 30 Hz step, so the headless scenario tests are reproducible. The planner's latency makes live runs non-deterministic; tests call the planner directly.

## Known rough edges (don't demo these)

- Name tags can overlap when villagers crowd together (for example, dancing in the square).
- At night, when everyone is asleep indoors, "Demo: fire near Maya" does nothing. Reload, or press `10×` until morning.
- The fire effect is stylized; it doesn't spread yet.
