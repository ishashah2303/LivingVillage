# Assignment 6: feature-complete candidate

Updated November 20, 2026. Assignment 5 remains the historical beta submission. This document records the agreed final scope and changes made afterward; it is not the final Assignment 6 submission report.

## Changes since Assignment 5

- Fire Season victory now has a rain arrival sequence before the results. Remaining fires extinguish without extra points; score, health and the gameplay clock stay final. Replay starts a fresh world. Fast frames stop at the outcome instead of executing remaining simulation steps.
- Procedural sound for the bell, water, fire, rain and win/loss cues. Sound starts after a user gesture, has a persistent mute preference, and is silenced while paused or the page is hidden. No external audio assets are required.
- Visible objectives, contextual tool guidance, initially expanded instructions, and defeat-specific retry advice. Menu and end dialogs prevent interaction with the underlying game.
- Assignment 5 TA feedback incorporated before classmate testing: directly clickable flames, a short water splash, fire-strength meters while Water is selected, smaller flames as strength falls, success/miss/empty-bucket messages and a visible refill countdown. Misses consume no bucket. Extinguished flames fade even when gameplay is paused.
- First Fire Season visit opens a skippable three-step guide with a harmless two-bucket practice fire, bell/food instructions and scoring goals. Gameplay pauses while the guide is open; the existing speed/pause setting is preserved. Completion or skipping is remembered in browser storage, with a “How to play” button to reopen it. Score weights and the three-star target are explained; results show the three score contributions.
- Pending planner requests recover through browser rules after disconnects, timeouts, send failures, invalid responses or server errors. Recovery uses a fresh village snapshot and still passes every command through the live safety gate. The UI reports the fallback reason and total wait. Late replies cannot apply twice. Disposal cancels pending work and reconnection; a finished or discarded game cannot receive fallback commands.

Sandbox land expansion and rain were already delivered in Assignment 5; they are not new Assignment 6 features. Backend code, Render configuration and environment variables are unchanged.

## Agreed final feature scope

Keep Fire Season and Sandbox; fire, food shortage, festivals, rain and the single meadow expansion; eight residents for normal gameplay and 8/16/32/64 Sandbox presets; procedural low-poly visuals and sound; behavior trees, current session memories and relationships; optional server/LLM planning with browser fallback; current destination safety and reachability checks.

Remove from this release's production scope: smoke-weighted routes, global refuge allocation/min-cost flow, persistent vector memory, hierarchical planning/model cascades, floods/storms/sickness, replacement rigged characters and an infinite construction economy. These are explicit cuts, not promises for Assignment 7. The user accepted this scope and requested no TA consultation.

The 64-resident preset remains a stress case. Routes do not price smoke exposure along their entire length, and refuge selection is not global occupancy management. Previous benchmark numbers do not measure this new build. No new sustained-FPS claim is made here.

## Verification and remaining submission work

The user reported completion of the browser verification checklist (ending, sound/mute, defeat, replay and rain/expanded-land performance). This is user-reported verification; no new quantitative benchmark was supplied. The November 20 frontend suite passed **66 tests**, with two optional tests skipped; TypeScript and the production static export passed. Fourteen transport tests cover disconnect recovery, fresh-snapshot timeouts, send/error/malformed-response handling, late replies, reconnection, disposal, offline/crowd fallback and integration with the real simulation safety gate. No paid model calls were used. The deployment revision is recorded in the release commit/chat.

The subsequent TA-feedback polish pass passed **72 frontend tests**, with two optional tests skipped. Six added cases check water success/miss/empty/refill behavior, weakened fires, score contributions and the three-star integrity boundary. Browser checks of the local build confirmed automatic first-play opening; practice strength 10 → 4 → 0 without advancing the village clock; all three guide steps; skipping/reopening; retaining an existing pause; subsequent games starting without automatically repeating the guide; direct flame hits; real fire strength 10 → 4 → extinguished with +50 feedback; and missed clicks using no bucket. Screenshots are saved locally under `output/build/first-play-guide.jpg` and `output/build/water-feedback.jpg`. These checks are not a controlled performance benchmark.

The TA's Assignment 5 feedback praised playability and requested clearer water effectiveness feedback, score guidance and a first-play tutorial. It is a separate source of feedback and does **not** count as one of the five required classmate playtests. During those playtests, record whether each classmate completes or skips the built-in guide; do not teach the controls verbally.

1. Publish the verified candidate and use that same revision for the formal playtest. Freeze the feature set; subsequent work is limited to bug fixes, optimization and polish.
2. Test with at least five classmates outside the group. Introduce the premise without teaching the controls; ask them to think aloud, observe without coaching unless completely stuck, and ask the same post-play questions. Record confusion, failures, lag and visual issues with the circumstances.
3. Write the Assignment 6 PDF, maximum two pages: updated schedule, release notes since Assignment 5, hosted build and public source links, study method and findings from all five participants, and 3–5 concrete Assignment 7 actions grounded in those findings.

The five formal playtests and final report are still outstanding. No participant responses or completion claims have been invented. The assignment brief provides no calendar deadline; use the course portal date for the final schedule. The old Assignment 5 schedule's later feature-freeze date is superseded by freezing this candidate for Assignment 6.
