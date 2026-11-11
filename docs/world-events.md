# Sandbox events and land expansion - November 11, 2026

## Play

Open **Sandbox**, then use the **Events** controls alongside Festival and Shortage.

- **Reclaim land** sends up to three available non-guard residents to the eastern construction site. Progress counts only volunteers physically working there, totaling 36 worker-seconds. Travel, needs, emergencies, rain and unsafe sites can delay work. Click **Pause building** to stop while preserving progress; click again to resume.
- Completion unlocks **800 m²** of usable meadow: the world grows from 60 x 40 m to 80 x 40 m, a **33.3% increase**. The camera pulls back to show it. Place wells, food, obstacles or fires there with the existing editor tools. Residents visit and socialize there, and North/East/South Meadow become actual evacuation destinations.
- **Rain shower** lasts 25 simulation seconds. It removes 1.4 fire HP per second and suppresses spread while active; construction waits for dry weather. It can be triggered once every 60 simulation seconds. Pause and speed controls apply to weather and building as well as the village.
- Restarting, returning to the menu or changing a crowd preset creates a fresh, unexpanded world. The new controls are Sandbox-only; Fire Season keeps its established challenge rules.

The new meadow supplies three additional *candidate* refuge destinations, not global occupancy management. Homes and population are unchanged. This is one designed expansion, not an infinite terrain generator or a full construction economy. Birds retain their original village flight circuit.

## Implementation

The larger navigation surface is prepared when the simulation is created. Five small TileCache blockers reserve the extension until work completes. Removing them rebuilds affected tiles without replacing live DetourCrowd agents. Placement bounds, planner reports and command validation all use the current unlocked world; locked destinations are absent from reports. Terrain visuals reveal the new district as work progresses, but it remains inaccessible until completion.

Construction is a behavior-tree branch below emergencies, friendship help, festivals and needs, but above routines. Workers animate using the existing work activity. Their arrival and actual position determine progress; failed navigation never counts as work. Fires within 12 m of the site suspend construction.

Weather uses simulation time, one rain-line draw call, low-poly clouds and altered lighting. Fire damage and spread share the same weather state as the renderer.

## Validation

- **49 frontend tests passed** (two optional exporters/benchmarks skipped), including five new integration tests on real Recast/Detour navigation.
- Tests verify locked/unlocked routes and placement, planner acceptance of new refuges, fresh-world reset, work only after arrival, explicit pause/resume, rain and fire interruptions, actual fire extinguishing, cooldown and spread suppression. Fire Season's new-event entry points are disabled.
- Production static export and TypeScript passed.
- Browser: construction completed through normal controls; meadow opened and camera reframed; villagers chose EastMeadow during a fire; rain visuals and event state appeared together.

The Assignment 5 report now includes the November 11 events. Its November 9 benchmark JSON remains historical evidence; those FPS numbers are not measurements of rain or the expanded map. The new events need fresh performance captures and human playtesting before claiming the same frame-time target.
