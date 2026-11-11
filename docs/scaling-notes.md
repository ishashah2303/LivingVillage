# Living Village: first crowd-scaling pass

Implemented November 8, 2026. This is a sandbox capacity experiment for Assignment 5, not a completed beta release or a new Fire Season balance.

**Historical baseline:** the tables below precede the November 9 evacuation fixes, selected-only large-crowd labels and paths-off default. See [the beta release record](beta-release.md) for current validation and a new active-game capture; original evidence is preserved here without rewriting its conditions.

## Changes

- Sandbox → Stress test offers 8, 16, 32 and 64 villagers. Each button starts a fresh world with seed 5, 40 birds, speed 1× and local rules. Previous edits, events and villagers are discarded together; disposed worlds ignore late plans.
- Every resident has a real behavior tree, needs, relationships, memories, navigation and animation. Extra residents repeat the original role/home distribution with unique names, such as Maya 2. Guards also scale, so this is not an equal-difficulty gameplay comparison.
- DetourCrowd capacity increases from 24 to 64. Unsupported populations fail before navigation allocation. Normal starts and Fire Season retain eight villagers.
- Crowd presets use local planning without model calls. Browser transport also keeps reports above 32 agents local because the hosted server schema accepts at most 32.
- Performance capture uses 3 seconds of warm-up and 10 seconds of frame samples. It records FPS, p95 frame time, p95 simulation cost per rendered frame, slow frames, draw calls and DPR range. Results survive restarts and export as JSON. Hidden/interrupted tabs and changes to tracked settings cancel the capture.
- The inspector scrolls the expanded name list, and narrow layouts retain the stress controls.

## Reproduce

From `web`, run `npm run build` and `npm run start`. Open Sandbox → Stress test. Select a population, then immediately click **Capture performance (10 s)**. Keep the tab active and the camera still. Compare identical viewports, overlays, speed and bird counts. Click **Export captures** to save results. FPS is display-refresh limited; it does not quantify unused CPU capacity.

Run `npm run benchmark:scale` from `web` for the headless sweep: real WASM navigation, four populations, 40/250 birds and seeds 5/11/23. Each case warms up for 10 simulated seconds, adds 20 rocks and a fire, applies local planning, then measures 900 steps (30 simulated seconds). Results go to `docs/benchmarks/scaling-headless.json`; progress is in ignored `tmp/vitest/scaling-progress.txt`. Set `SCALE_EXTENDED=1` to include the much slower 1,000-bird cases. The full extended sweep was not completed in this pass.

Headless timings exclude rendering. Plan timing includes report generation, rules and client validation, but no network, LLM or artificial delay. Step maxima include scheduling/GC outliers. The sweep records invalid agent samples, stuck recoveries and whether the fire ended during observation; it does not prove that every evacuee reached safety.

## Limits

32 villagers is the next development target; keep 64 as a stress case. These short measurements on one machine establish neither a universal maximum nor sustained 60 FPS. Larger viewports and DPR can be slower.

The village retains six homes and three planner assignments per safe spot per plan. Scaling does not add global shelter occupancy or hazard-aware routes. Relationship reports still grow quadratically. Individual meshes and HTML labels remain; batching/instancing and label culling are useful follow-up experiments. Timings alone cannot distinguish GPU cost from CPU rendering and DOM work.

Validation: 39 frontend tests passed, including movement, fire-plan application and valid agent state at every population; TypeScript and production build passed. Browser verification includes preset resets and a 64-villager fire after 20 rocks: 25 commands accepted and the fire extinguished. The existing safety metric reported 13 arrivals; that is not a guarantee for all residents.

Raw evidence: `benchmarks/scaling-browser.json` and `benchmarks/scaling-headless.json`. Measured tables and run conditions follow below.

## Measurements

Windows x64, Intel Core i7-8550U, Node 24.22.1. Production browser build in the Codex in-app Chromium 156 browser, 698 × 474 CSS-pixel canvas, DPR 1, default camera, paths enabled, 1× speed, 40 birds and the spatial grid enabled. Each final capture started immediately after its population preset. No headless benchmark or build ran during these final captures. These are short morning-routine samples without fires; not a worst-case full-day or full-screen benchmark.

| Villagers | Mean FPS | p95 frame (ms) | p95 simulation/frame (ms) | Mean draw calls |
| --- | ---: | ---: | ---: | ---: |
| 8 | 60.0 | 20.8 | 0.4 | 198 |
| 16 | 60.0 | 19.0 | 0.5 | 317 |
| 32 | 57.3 | 25.3 | 0.8 | 554 |
| 64 | 36.9 | 39.5 | 1.7 | 1,043 |

The browser JSON retains eight captures, newest first. The table uses the newest four; the earlier exploratory four overlapped CPU benchmarking and should not be used for clean comparisons. At 64 residents, labels overlap substantially as well as adding rendering work (see `benchmarks/scaling-preview.jpg`). The screenshot's instantaneous FPS is separate from the 10-second average.

The final headless sweep ran with the browser preview closed and no rendering or build workload. Below, mean step cost averages three seeds; p95 is the worst per-seed p95. Run order and JIT warm-up affect small timing differences, so a lower 16-agent cost than 8 agents does not establish better asymptotic scaling. The fixed simulation step is 33.3 ms; these numbers are CPU costs, not FPS predictions.

| Villagers | Birds | Mean step (ms) | Worst p95 step (ms) | Fires ended within observation |
| --- | ---: | ---: | ---: | ---: |
| 8 | 40 | 0.22 | 1.02 | 3/3 |
| 8 | 250 | 1.18 | 1.98 | 3/3 |
| 16 | 40 | 0.15 | 0.28 | 3/3 |
| 16 | 250 | 0.84 | 1.24 | 3/3 |
| 32 | 40 | 0.28 | 0.49 | 3/3 |
| 32 | 250 | 0.90 | 1.43 | 2/3 |
| 64 | 40 | 0.70 | 1.10 | 3/3 |
| 64 | 250 | 1.32 | 1.70 | 3/3 |

All 24 runs recorded zero invalid navigation-agent samples. One 32-villager/250-bird scenario still had an active fire at the 30-second cutoff. Each run measures a workload, not a certified safe evacuation. Population and flock size consume the shared seeded RNG differently, so obstacle/fire placement is not identical across different loads. Follow-up controlled safety comparisons should use fixed event coordinates and a fixed guard count.

The next practical step is to target 32 residents while reducing draw calls and label clutter, then repeat these captures at the intended submission viewport. Eight and sixteen residents came closest to the existing 60 FPS target; 32 and 64 do not meet a sustained 60 FPS claim on this evidence.
