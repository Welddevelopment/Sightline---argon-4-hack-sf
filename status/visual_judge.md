# Visual judge (gemini-4-argon vs professional forensic references)

References: https://www.youtube.com/watch?v=Y7Api99fPuw , https://www.youtube.com/watch?v=JlXN-FTQxDE
Each round: /?case=demo at t=9.9 (overhead, chase/oblique, Witness B eye, Witness A eye) + newest asset previews, 1280x720, scored 1-10 by gemini-4-argon. Newest round at the bottom.

| round | time | veh | road | veg/bldg | light | HUD | camera | LAW FIRM |
|---|---|---|---|---|---|---|---|---|
| R1 | 2026-10-25 13:25 | 4 | 3 | 3 | 4 | 2 | 3 | 2 |

## Round 1 — 2026-10-25 13:25

**Scores:** vehicles 4 · road_markings 3 · vegetation_buildings 3 · lighting_shadows_ao 4 · overlays_hud 2 · camera_composition 3 · overall_law_firm 2

**Changed since last round:** baseline

**Capture note:** witness-eye screenshots timed out (180 s) under render-lock contention; this round judged overhead + chase only.

**Top 5 fixes (ranked):**

1. **[overlays.js]** Remove 3D world-space text boxes ('Actual brake point...', 'Witness B -> Vehicle A...') from the center of the viewport or move their data into the top-left HUD stack; in both renders they sit directly on top of the vehicles and impact point. Also remove truncated '...' text and orange dashed debug borders. — _A trial exhibit must clearly show the vehicles and sightlines; currently the 3D labels completely block the crash action in both views._
2. **[viewer.js]** Tighten the overhead camera frustum/zoom by ~3x and center it on the intersection and collision zone rather than the entire 400m highway corridor (see Reference 2 at 0:20). In the chase view, fix Vehicle A's lateral position or road lane width so the sedan is centered in the right-hand travel lane instead of straddling the dashed white dividing line. — _In overhead_overhead.png the vehicles are microscopic and pushed to the far left edge, whereas Reference 2 frames the intersection tightly so vehicle positions and sightlines are immediately legible._
3. **[scene.js]** Darken the asphalt material from washed-out light grey (#999999) to realistic darkcharcoal asphalt (#383b40) with higher roughness (0.85), increase road marking contrast (solid yellow center/median lines, crisp white stop bars and edge lines), and break up the visible checkerboard tiling of the grass texture. — _High contrast between dark asphalt and bright lane markings is the visual foundation of both Reference 1 and Reference 2._
4. **[web/assets/vehicles*.js]** Upgrade the passenger sedan rear geometry and materials in chase_chase_veh_A.png: tone down the over-reflective chrome/blue body shader, add distinct red/amber segmented taillight lenses, a recessed license plate area, a rear bumper crease, dark rubber tires, and side mirrors. — _In the chase camera view, the sedan is the primary foreground subject and currently looks like an untextured low-poly capsule._
5. **[render_quality.js]** Add ground-contact ambient occlusion (SSAO or dark soft contact blob shadows directly beneath the sedan and semitrailer) and deepen directional shadow contrast; also hide the orange wireframe bounding box around the white roadside building in chase_chase_veh_A.png. — _Without strong contact shadows under the chassis and tires, the truck and sedan appear to float above the bright grey road surface._

**Per-image notes:**

- r1/chase_chase_veh_A.png: Vehicle A is straddling the lane line, floating text callouts completely obscure the collision zone and vehicles, and the sedan rear looks like a smooth toy.
- r1/overhead_overhead.png: Camera is zoomed way too far out leaving 90% empty repeating grass texture while all floating labels pile up in an unreadable mess on the left.

**Images:** `/tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/judge/r1/chase_chase_veh_A.png`, `/tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/judge/r1/overhead_overhead.png`
