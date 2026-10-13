# Assignment 3 demo video script (target about 2:45; the limit is 2 to 3 minutes)

## What the assignment asks for, and where the video covers it

| Assignment 3 requirement | Where |
| --- | --- |
| Duration 2 to 3 minutes | About 390 spoken words: roughly 2:40 at a relaxed pace, plus a few seconds of clicking |
| Visual proof: screen capture running in real time | The whole video; do not speed footage up |
| Feature walkthrough: voiceover explaining what is on screen | Every section below |
| Stress test: push to the limit until FPS drops | Section 6 |
| Core algorithms working (our pillars) | Sections 2, 4 and 6: behavior tree, Recast/Detour navmesh, boids |
| Runtime AI: API calls functional | Section 3: a live Claude plan arrives and villagers act on it |
| Target frame rate from our spec (60 FPS) | Start of section 6 |

## Before you hit record

- Open https://ishashah2303.github.io/LivingVillage/ a minute early so the server wakes up. The pill at the top left of the map should say **● Claude planner** with a green dot.
- Click that pill once so it stays open. It will show Claude's plan summary when it arrives.
- Full screen, browser zoom 100%, other heavy apps closed.
- Do one practice run. Claude takes 5 to 20 seconds to answer, so get a feel for how long you need to keep talking in section 3.
- Each fire costs a few cents. Three or four practice takes are fine.

## The script

Speak normally. Lines in *italics* are what to do on screen; the quoted lines are what you say. Short pauses while you click are fine.

### 1. Intro (0:00 to 0:15)

*Wide view of the village, running at 1×.*

> Hi, I'm Isha, and this is Living Village. It's a little 3D village that runs itself: eight villagers, a flock of birds, and a world you can mess with. Everything here is running live in the browser.

### 2. Behavior tree (0:15 to 0:35)

*Click Maya, on the map or her name on the right.*

> Let me click on Maya. On the right you can see her needs, what she's doing, and why. This list is her actual behavior tree, ticking live: emergencies on top, then needs, then her routine. The highlighted path is the decision she's making right now.

### 3. Fire and the Claude planner (0:35 to 1:20)

*Under Demos, click **Fire near Maya**. Keep Maya selected.*

> Okay, let's cause some trouble. I'm starting a fire right next to her.

*Point at Maya running and the birds scattering.*

> She doesn't wait around: her reflexes kick in and she runs, and the birds scatter. Meanwhile, the browser sends a snapshot of the village to our server, and Claude works out a plan for everyone. You can see it says "thinking" up here.

*If the plan hasn't arrived yet, add:*

> We built it this way on purpose. An LLM takes a few seconds, so nobody waits for it.

*Plan arrives (the pill updates and a **🧠 Plan** line appears in the log). Point at the pill, then Maya's inspector.*

> And there it is. Claude sent Maya to the Town Square and told Tomas, our guard, to put the fire out. Her inspector shows the decision came from the planner, with Claude's own reasoning. Every command passes a safety check first.

### 4. Navmesh and obstacles (1:20 to 1:42)

*Open **Debug overlays** on the left and tick **NavMesh (Recast)**.*

> Movement runs on a real Recast navmesh, compiled to WebAssembly. That's this layer, and every villager is a Detour crowd agent on it.

*Pick the **Obstacle** tile and drop two rocks in front of a walking villager. Press Esc, untick NavMesh.*

> If I drop rocks in someone's path, only the patch under each rock gets rebuilt, in under a millisecond, and they just walk around it.

### 5. The stale-plan problem (1:42 to 2:00)

*Click **Stale plan**. While it runs, point at the log.*

> One tricky thing with an LLM: by the time it answers, the world may have changed. Here a second fire starts while Claude is still thinking, so the safety gate throws out the commands that aren't safe anymore. Those are the red lines in the log.

### 6. Stress test (2:00 to 2:35)

*Open **Stress test** on the left. The FPS panel opens at the bottom left of the map.*

> Now let's push it. Our target was 60 frames per second, and with thirty birds we're at about [number].

*Click **1k**, then **2k**.*

> I'll go to a thousand birds, then two thousand, and the frame rate drops to around [number].

*Untick **Boids spatial grid**, wait about three seconds, then tick it again.*

> If I turn off the spatial grid, every bird checks every other bird, that's n-squared, and it falls apart: [number]. Turn it back on and it recovers. It's about three times faster at this size.

*Click **+20 rocks** twice.*

> And twenty obstacles at once? The navmesh still holds up.

### 7. Wrap-up (2:35 to 2:48)

*Click **30** birds and **Clear**, then zoom out to the wide view.*

> So that's our MVP: behavior trees, navmesh pathfinding, boids and a live LLM planner, all working together. Next, we're adding long-term memory with pgvector and proper character animation. Thanks for watching!

## Tips

- Say the real FPS numbers you see in section 6 and write them down. They go into section 2 of the report.
- If something goes wrong mid-take, redo that section and cut the takes together. Don't speed up any footage: the assignment asks for real-time capture.
- Running over 3 minutes? Trim section 4 first: show the navmesh, drop one rock, move on.
