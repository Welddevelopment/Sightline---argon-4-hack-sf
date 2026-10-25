# Visual judge (gemini-4-argon vs professional forensic references)

References: https://www.youtube.com/watch?v=Y7Api99fPuw , https://www.youtube.com/watch?v=JlXN-FTQxDE
Each round: /?case=demo at t=9.9 (overhead, chase/oblique, Witness B eye, Witness A eye) + newest asset previews, 1280x720, scored 1-10 by gemini-4-argon. Newest round at the bottom.

| round | time | veh | road | veg/bldg | light | HUD | camera | LAW FIRM |
|---|---|---|---|---|---|---|---|---|
| R1 | 2026-10-25 13:25 | 4 | 3 | 3 | 4 | 2 | 3 | 2 |
| R2 | 2026-10-25 14:02 | 5 | 3 | 4 | 4 | 3 | 3 | 3 |
| R3 | 2026-10-25 14:34 | 6 | 3 | 4 | 4 | 3 | 5 | 4 |

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

## Round 2 — 2026-10-25 14:02

**Scores:** vehicles 5 · road_markings 3 · vegetation_buildings 4 · lighting_shadows_ao 4 · overlays_hud 3 · camera_composition 3 · overall_law_firm 3

**Capture note:** started by the previous judge session under the old spec (case=demo, quality=render, t=9.9); Witness B shot failed (render-lock/screenshot timeout, ~5 min per shot at quality=render). From R3 on: case=demo-full, t=9.85, quality=interactive.

**Changed since last round:** Better: aerial satellite imagery added to overhead view, center-screen 3D callout boxes moved to a bottom-left HUD card, and truck geometry looks cleaner. Worse/Unfixed: the new bottom-left HUD card is massive and overlaps Vehicle A in chase view, the top-left HUD has overlapping boxes in S12, overhead camera is still zoomed way too far out with overlapping labels on the left, asphalt is still washed-out light grey, and trees in S12 have floating disconnected green spheres.

**Viewer console errors:** `Failed to load resource: the server responded with a status of 404 (Not Found)`; `Failed to load resource: the server responded with a status of 404 (Not Found)`; `Failed to load resource: the server responded with a status of 404 (Not Found)`

**Top 5 fixes (ranked):**

1. **[overlays.js]** Fix the top-left HUD overlap in S12_witness_eye_C.png by hiding or docking the 'WITNESS C (FICTIONAL)' debug box so it never covers the 't = 5.00 s / IMPACT IN' panel. Shrink the bottom-left witness card width by 35% and font size by 20% so it does not overlap Vehicle A in chase_chase_veh_A.png, fix truncated text ('...once the truck pulled across, the...' in witA), and remove all 3D world-space label collisions in overhead_overhead.png ('Open-sided covered bench...', 'Retail business...') plus the orange dashed wireframe around the building. — _Overlapping HUD panels and colliding 3D text labels look broken and amateurish, immediately disqualifying the render as a courtroom exhibit._
2. **[viewer.js]** Tighten the overhead camera zoom by 3x in overhead_overhead.png and center the frustum on the collision intersection (x around the crossover, showing ~120m of road instead of 450m) to match Reference 2 (0:20). In chase_chase_veh_A.png, shift the camera slightly right or pan left so Vehicle A is centered in the right two-thirds of the frame away from the left-side HUD cards, and fix Vehicle A's lateral lane position so it drives inside the lane rather than straddling the white dashed line. — _In the overhead view the crash is cramped into 10% of the screen on the far left edge, and in the chase view the main vehicle is covered by the UI card._
3. **[scene.js]** Darken the highway road surface material from washed-out light grey (#b0b5ba) to dark charcoal asphalt (#36393e, roughness 0.85) so the white lane dashes, edge lines, and sightline rays pop with high contrast like Reference 2. Also remove the stray brown frustum/cylinder artifact sitting on the road surface directly underneath the semitrailer in chase_chase_veh_A.png. — _The current light-grey road washes out the white lane markings, sightline rays, and white semitrailer, whereas Reference 1 and 2 rely on dark asphalt for immediate visual clarity._
4. **[furniture.js]** Fix the procedural tree foliage generator seen in r2/asset_key_11_S12_witness_eye_C.png (right side) where dozens of green metaball/sphere clusters float in mid-air disconnected from trunks or branches; clamp leaf cluster offsets tightly to branch endpoints or replace with cohesive low-poly tree crowns, and remove the glowing yellow/orange wireframe tower on the far left horizon of S12. — _Floating green spheres in the sky immediately break photorealism and look like a rendering bug._
5. **[web/assets/vehicles*.js]** Upgrade Vehicle A (blue passenger sedan in chase_chase_veh_A.png): replace the featureless wrap-around pink/red tail band with distinct dark-red segmented taillight housings, add a recessed license plate pocket, a rear bumper seam, side mirrors, dark glass windshield/rear window with a subtle sky reflection, and strong dark ambient-occlusion contact shadows under all four tires and the truck's tandem axles. — _In the chase view the sedan is the closest object to the camera and still looks like an untextured capsule floating on the pavement._

**Per-image notes:**

- r2/asset_key_11_S12_witness_eye_C.png: Severe UI collision in top-left where 'WITNESS C (FICTIONAL)' box directly overlaps the 't = 5.00 s' telemetry panel, trees on the right have floating disconnected green spheres, and orange dashed debug wireframe is still visible around the building.
- r2/asset_key_12_S13_closing_sources.png: Clean typography and layout on the closing citations card, though body text is slightly small.
- r2/chase_chase_veh_A.png: The oversized bottom-left HUD panel directly overlaps the left half of Vehicle A, the sedan still looks like a smooth plastic toy straddling the lane line, and a strange brown cylinder/cone sits under the trailer.
- r2/overhead_overhead.png: Satellite ground texture is a great addition, but the camera is still zoomed out 400m leaving the crash tiny on the far left under a pile of overlapping labels ('16 m', 'Witness B', 'Open-sided covered bench...').
- r2/witA_wit_A.png: Witness A view is 379m away where vehicles are 2-pixel dots and the truncated claim text ('once the truck pulled across, the...') adds no visual proof.

**Images:** `/tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/judge/r2/asset_key_11_S12_witness_eye_C.png`, `/tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/judge/r2/asset_key_12_S13_closing_sources.png`, `/tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/judge/r2/chase_chase_veh_A.png`, `/tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/judge/r2/overhead_overhead.png`, `/tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/judge/r2/witA_wit_A.png`

## Round 3 — 2026-10-25 14:34

**Scores:** vehicles 6 · road_markings 3 · vegetation_buildings 4 · lighting_shadows_ao 4 · overlays_hud 3 · camera_composition 5 · overall_law_firm 4

**Capture note:** first demo-full round (CASES=demo-full only, per lead; resumed 14:30 after the render pause). quality=interactive, ~30-55 s/shot. Witness-eye views captured for the first time. Judge's own spot-check of chase_chase_veh_A.png: the claim card does cover the sedan; the sedan sits inside its lane but the chase camera is offset left/high so it reads as straddling — fix belongs in viewer.js chase framing (center behind the car, lower, ~8 m back). film stills are still the old cases/demo 13:24 set.

**Capture:** case=demo-full t=9.85 quality=interactive shots=overhead(53s), chase(36s), witB(30s), witA(28s)

**Changed since last round:** Better: overhead_overhead.png is now properly zoomed in and centered on the collision crossover, witB_wit_B.png is now present and shows a great eye-level occlusion angle with the red tractor cab, and the brown cone artifact under the trailer is gone. Worse/Unfixed: bottom-left HUD card STILL overlaps the left half of Vehicle A in chase_chase_veh_A.png, Vehicle A still drives straddling the white dashed lane line, S12_witness_eye_C.png appears completely un-updated (still has top-left HUD overlap and floating green tree spheres), road asphalt is still washed-out light grey, and orange dashed bounding-box wireframes are still visible around buildings and trees.

**Top 5 fixes (ranked):**

1. **[overlays.js]** Reduce the bottom-left witness claim card max-width to 360px (currently ~620px) and compact its padding so it never overlaps Vehicle A in chase_chase_veh_A.png. Remove all orange dashed bounding-box wireframes around inferred buildings and trees in chase_chase_veh_A.png, witA_wit_A.png, and S12. Also remove the duplicate 'WITNESS C (FICTIONAL)' top-left overlay in S12_witness_eye_C.png that collides with 't = 5.00 s', and hide secondary furniture labels ('Stop Sign on NE 140th...', 'Bench Shelter with...', 'Storefront Drink Cooler...') in overhead_overhead.png. — _UI panels covering the primary subject vehicle in chase view and debug orange wireframes around buildings/trees immediately make the exhibit look like a debug build._
2. **[scene.js]** Darken the asphalt road surface material across the highway and crossover from washed-out light grey (#b0b5ba) to dark charcoal asphalt (#33363b, roughness 0.88) so the white lane dashes, solid edge lines, and white semitrailer have crisp contrast matching Reference 2. Also make the median crossover pavement a seamless dark asphalt junction with proper curved fillet radii and a white stop bar on the side street instead of a flat light-grey rectangle. — _In overhead_overhead.png and chase_chase_veh_A.png, the light grey road washes out the white lane lines and white trailer, hurting visual clarity._
3. **[viewer.js]** Fix Vehicle A's lateral coordinate in the eastbound lanes (or shift the lane marking UV offset) so Vehicle A drives centered inside the right or left travel lane instead of straddling the center white dashed line in chase_chase_veh_A.png and overhead_overhead.png. In witA_wit_A.png, narrow the camera FOV from 60 deg to 28 deg (telephoto/attention zoom) or advance the keyframe time so the crossover and truck occlusion are clearly legible rather than 4-pixel dots 290m away. — _A car driving directly down the middle of a dashed lane divider for hundreds of meters looks physically wrong to a jury, and Witness A's view is too distant to see the occlusion._
4. **[furniture.js]** Fix the procedural tree generator in witA_wit_A.png (left tree with angular dark-green facets and orange wireframe) and S12_witness_eye_C.png (right trees with disconnected floating green spheres) by clamping foliage clusters tightly to branch tips with cohesive overlapping canopy meshes, and re-export the asset_key_11_S12_witness_eye_C.png still so it reflects the v2 world and red tractor. — _Floating green spheres and angular tree artifacts break scene believability, and S12 is out of sync with the red tractor in the other renders._
5. **[web/assets/vehicles*.js]** Refine Vehicle A's rear end in chase_chase_veh_A.png: replace the continuous pink-red wrap-around strip with separate left/right dark-red taillight lenses, a recessed white license plate in the center trunk lid, a distinct rear bumper crease, and a stronger dark contact shadow blob on the road beneath the sedan and trailer tires. — _The chase camera stares directly at the back of Vehicle A; giving it realistic taillights, a license plate, and a strong ground shadow will anchor it in the scene like Reference 1 (1:28)._

**Per-image notes:**

- r3/asset_compare_sheet.png: Shows v2 improvements in truck model and ground textures, though Oblique and Witness B panels on the right are unrendered placeholders.
- r3/asset_key_11_S12_witness_eye_C.png: Unchanged from previous round: severe top-left UI overlap ('WITNESS C' box over telemetry), floating disconnected green spheres on trees, and orange dashed wireframe on the store.
- r3/asset_key_12_S13_closing_sources.png: Clean, legible closing citations slide.
- r3/chase_chase_veh_A.png: Bottom-left HUD card still covers the left 40% of Vehicle A, Vehicle A is still straddling the white lane divider line instead of centered in a lane, and orange dashed wireframes surround the store and tree.
- r3/overhead_overhead.png: Camera zoom and framing are much better centered on the crash, but the light-grey road blends into the white trailer and labels around Witness B ('Stop Sign...', 'Bench Shelter...') still stack tightly.
- r3/witA_wit_A.png: Still 290m away where the crash is tiny on the horizon and the 4 floating dark grey labels stack vertically over the distant vehicles; orange wireframe box visible around the left tree.
- r3/witB_wit_B.png: Strong new viewpoint clearly demonstrating tractor occlusion from the bench shelter, though the yellow/red target silhouette inside the truck hood and orange wireframe on the distant horizon look slightly debug-like.

**Images:** `/tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/judge/r3/asset_compare_sheet.png`, `/tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/judge/r3/asset_key_11_S12_witness_eye_C.png`, `/tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/judge/r3/asset_key_12_S13_closing_sources.png`, `/tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/judge/r3/chase_chase_veh_A.png`, `/tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/judge/r3/overhead_overhead.png`, `/tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/judge/r3/witA_wit_A.png`, `/tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/judge/r3/witB_wit_B.png`
