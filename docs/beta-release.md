# Assignment 5 beta - November 9, 2026

The beta extends the Assignment 4 loop with playable crowd scaling and evacuation correctness fixes. It does not implement the entire earlier roadmap. The two-page submission report is in `output/pdf/Assignment5_LivingVillage_hc1242_ins28.pdf`; rebuild it with `python docs/build_assignment5_report.py` (ReportLab required).

## Delivered

- Sandbox presets: 8/16/32/64 real residents, fixed seed 5, 40 birds, local rules, fresh navigation and simulation state. Guards and relationships scale with the cast; challenge mode remains eight residents.
- Fire/obstacle changes revalidate active refuge destinations against every live fire and current reachability. No reachable safe refuge means waiting and retrying, not inventing an arrival.
- Exhausted movement recovery clears failed goals. A shelter arrival must be physically near its destination and at least 12 m from every fire before recording safety time.
- Selected-only labels above 16 residents; all residents remain selectable in the inspector. Paths default off, bird default 40, and near-house fire instructions now correctly say triple damage.
- Browser frame captures, JSON export and a repeatable CPU-only crowd/flock sweep. Active-game captures retain obstacle-count ranges as fires change the world.

## Verification

- **44 frontend tests passed, 2 optional tests skipped** in the ordinary suite. Four new evacuation regressions cover newly dangerous assignments, exhausted recovery, unsafe arrival and unreachable/refuge recovery. Frame-capture tests include changing obstacles during gameplay.
- **18 backend tests passed**, using fake model responses; no paid model calls.
- Type checking and the static production export with `/LivingVillage` base path passed.
- Browser, exact local static export: menu, Fire Season start, actual fire/planner interactions, defeat, replay reset, return to menu, Sandbox start/end, 64-resident reset and selection verified. JSON download verified. Browser victory was not manually completed; headless bot wins and idle losses passed on three seeds each.
- Visual proof: `benchmarks/beta-crowd-preview.png`. At 64 residents the selected resident has one visible label and the scrollable list retains the full cast.

### Active gameplay measurement

Raw evidence: `benchmarks/beta-gameplay-browser.json`. Intel i7-8550U / Windows / Chromium 156; 698 x 474 canvas, DPR 1, 1x speed, eight residents, 40 birds, grid on, debug overlays off, local planner. Three-second warm-up followed by ten seconds / 600 frames with a fire and navigation changes. No build or benchmark overlapped this capture.

- Mean **59.99 FPS**, p95 frame **21.1 ms**, p95 simulation per frame **0.80 ms**.
- Zero frames over 33 ms; mean 216.7 draw calls; obstacle range 75-76.
- This meets a 60 FPS average in this sample, not a sustained 16.7 ms frame-time guarantee or a full-screen/worst-case claim. Assignment 3 quotes the original eight-resident/40-bird target; the original Assignment 2 brief is absent.

### Fresh CPU sweep

`benchmarks/beta-headless.json` reruns the existing 24-case harness after the evacuation fixes, with the browser preview closed. Same 10 simulated seconds warm-up, 20 rocks and fire/local plan, then 900 fixed steps. Three seeds per load. Mean is averaged across seeds; p95 is the worst seed. These are CPU step costs, not rendered FPS or evacuation guarantees.

| Residents | Birds | Mean step ms | Worst p95 ms | Fires ended within 30 s |
| --- | ---: | ---: | ---: | ---: |
| 8 | 40 | 0.20 | 0.60 | 3/3 |
| 8 | 250 | 1.76 | 3.14 | 3/3 |
| 16 | 40 | 0.27 | 0.54 | 3/3 |
| 16 | 250 | 1.73 | 3.80 | 3/3 |
| 32 | 40 | 0.30 | 0.56 | 3/3 |
| 32 | 250 | 1.55 | 3.37 | 2/3 |
| 64 | 40 | 1.23 | 3.35 | 3/3 |
| 64 | 250 | 1.87 | 3.80 | 3/3 |

All 24 cases recorded zero invalid agent samples. One fire remained active at cutoff. Historical pre-beta captures are preserved separately in `scaling-browser.json` / `scaling-headless.json` and explained in `scaling-notes.md`. Different run conditions and procedural RNG consumption prevent treating these as controlled safety or optimization comparisons.

## Known limits and follow-up

Smoke-aware path costs and global refuge occupancy remain incomplete. The six-home village and repeated guard roles are not redesigned for 64-person gameplay. Rendering remains expensive; 64 is a stress case, 32 a development target. No sustained 60 FPS claim is made for either.

An in-flight planner disconnect can drop that report while reflexes continue. Human playtests, manual browser victory, broader viewport/device checks and nighttime alarm behavior remain follow-up validation. Persistent vector memory, min-cost flow, new hazards, a model cascade, rigged assets, audio and victory rain are deferred. The revised report schedule is a plan, not a claim that those features shipped.

## Release use

The public source is https://github.com/ishashah2303/LivingVillage and the Pages build is https://ishashah2303.github.io/LivingVillage/. The workflow tests and builds each push to main. The downloadable local package is `output/build/LivingVillage-beta.zip`; extract and serve its directory over HTTP, then visit `/LivingVillage/`. Do not open the HTML directly with `file://` because WASM/modules require HTTP.
