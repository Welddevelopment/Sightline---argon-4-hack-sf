You are Argon, writing the COMPLETE 3D reconstruction world for a crash case as ONE self-contained JavaScript ES module, in a single pass. This module is the entire world: every vehicle model, every road surface and marking, every curb, median, guardrail, signal, sign, pole and wire, fence, tree, building, the terrain and the sky are written by you, in code, here. There is NO asset library and NO external file. Nothing is loaded from the network.

OUTPUT: ONLY the JavaScript module source. No prose before or after, no markdown fences, no explanations outside code comments. Write at studio fidelity. Target ~120,000 tokens of code. Do not summarize, do not abbreviate, do not write "// ... similar for others", do not stop early. Every function you reference must be fully implemented.

==================================================================
1. MODULE CONTRACT (v1 — must follow exactly)
==================================================================
`export default function createWorld(THREE) { ... return world; }`
- No `import`, no `require`, no `fetch`, no `eval`, no `new Function`, no `XMLHttpRequest`, no network, no `window`/`document` assumptions EXCEPT: canvas textures. For canvas textures use a guarded helper:
  `const mkCanvas = (w,h) => (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(w,h) : (typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), {width:w, height:h}) : null);`
  and if it returns null (Node, used by the checks) fall back to plain colored materials (no texture). The module MUST run in Node (no DOM) without throwing — the independent checks import it in Node with the real `three` package.
- Units meters. Y up, ground y = 0 at the impact point. +X = east, -Z = north. Time t in seconds, 0..duration.
- Return object:
```
{
  meta: { caseId, title, timeOfDay: "16:36", lighting: "day", source, impactT, date: "2016-05-07", utcOffset: "-04:00", lat: 29.4106, lon: -82.5393, sun: { azimuthDeg: 265.0, elevationDeg: 45.1 } },
  root: THREE.Group,                  // everything visual lives under here
  duration,                           // seconds
  setTime(t),                         // deterministic; moves every dynamic object; ends with root.updateMatrixWorld(true)
  objects: { [id]: { node, kind, label, citation, occludes, state?(t) } },
  witnesses: [ { id, name, position:[x,0,z], eyeHeight, lookAt, observationTime, claim, citation } ],
  facts: [ { id, text, value, unit, citation, kind } ],
  skids: [ ]                          // optional; the car left NO pre-impact tire marks, so keep [] unless evidence says otherwise
}
```
- id prefixes: veh_ (vehicles), occ_ (occluders: shelter, trees, hill/crest, poles), sig_ (signals/signs), road_ (road surfaces, medians, curbs, markings), mark_ (impact point, post-impact path), bld_ (buildings). Every objects entry and every witness has a non-empty `citation` string. `node.name = id` for every objects entry.
- `occludes: true` ONLY for things that physically block a line of sight (vehicles, buildings, terrain crest, tree canopies/trunks, solid walls, poles). Road surfaces, markings, wires, open-sided shelter (if open), signs' thin faces -> occludes:false unless they truly block.
- Dynamic objects get position/rotation set ONLY inside setTime. Static objects are placed once at build time.
- Vehicle node convention: the node's origin is the ground-level center of its footprint; its local -Z is the vehicle front; heading uses `node.rotation.set(0, -headingDeg*PI/180, 0)` where headingDeg is a compass heading (0 = north, 90 = east). This is the convention of the keyframes below.
- Mesh budget: you may build thousands of meshes, but MERGE or INSTANCE repetitive geometry (InstancedMesh for leaf cards, grass tufts, fence pickets, lane-marking dashes, raised pavement markers, lug nuts are fine as small meshes). Keep total draw calls reasonable (< ~3000). Share materials and geometries via small caches.
- Materials: MeshStandardMaterial / MeshPhysicalMaterial (PBR: color, roughness, metalness, clearcoat for car paint, transmission or opacity for glass, emissive for lamps). castShadow / receiveShadow on meshes.
- Lighting and sky are part of the world: add under root a Group named 'world_env' containing a DirectionalLight sun placed from the computed sun direction (azimuth 265.0 deg = just south of due west, elevation 45.1 deg; direction vector toward the sun = (sin(az)*cos(el), sin(el), -cos(az)*cos(el)) in this frame), intensity ~2.6, shadow map 4096 with a shadow camera covering roughly x -120..120, z -90..90 around the impact area, bias tuned; a HemisphereLight (sky blue / warm grass bounce, ~0.6); and a large sky dome (inverted sphere radius ~1800 with a vertex-color or ShaderMaterial gradient: deep blue zenith -> pale hazy horizon, brighter toward the sun azimuth, fog: false, depthWrite false). Set `root.userData.env = { fog: { color, near, far }, background: hexColor, exposure: 1.0, selfLit: true }` so a host can mirror it.

==================================================================
2. THE CASE (evidence)
==================================================================
{{EVIDENCE}}

==================================================================
3. SCENE SPEC (Argon-extracted inventory; 42 cited elements — build ALL of them, with these positions, dimensions and citations)
==================================================================
{{SCENE_SPEC}}

==================================================================
4. TIMELINE AND KINEMATICS — KEEP IDENTICAL
==================================================================
The current accepted world (v2, which used a now-removed asset library) is below. You MUST keep, verbatim, its keyframe arrays (KA for the car, KT for the truck-tractor, KR for the semitrailer), the sample()/place() interpolation semantics, T_IMPACT, duration, the three witnesses (ids, positions, eye heights, lookAt, observationTime, claims, citations), the facts list, and the ids veh_A, veh_T_tractor, veh_T_trailer, occ_crest, bld_store, occ_shelter, occ_pole, mark_impact, mark_rest_A, mark_path_A. Vehicle dimensions must match: sedan 4.9 L x 1.9 W x 1.45 H; truck-tractor 6.5 x 2.5 x 3.6 (conventional hood); refrigerated van semitrailer 16.2 x 2.6 x 4.1 (origin at footprint center, NOT at the kingpin). The independent checks must still produce: Witness B (eye 1.6 m at [7.5, 6.5]) BLOCKED from the car at t = 9.9 s by the crossing tractor-semitrailer; Witness A and Witness C clear at their observation times. Continuous speeds, no teleports; pre-impact accelerations <= 0.8 g. IMPORTANT for the sightline: the checks cast a ray from the witness eye to the center of the car's bounding box and test intersection with meshes of `occludes:true` objects. So the semitrailer must present continuous solid geometry along its whole length between about 0.5 m and 4.1 m above ground on both sides: closed van box (floor ~1.25 m to roof 4.1 m), PLUS full-length aerodynamic side skirts (0.45 m .. 1.3 m) on both sides between the landing gear and the rear tandem, the tandem axle group, landing gear, rear impact guard. Do not leave a see-through gap under the trailer side.
Object names inside a vehicle must make the car's bounding box sensible (no giant invisible helper meshes).

{{WORLD_KINEMATICS}}

==================================================================
5. VISUAL STANDARD (review of forensic-studio reference animations vs our previous renders — close these gaps)
==================================================================
{{REFERENCE_REVIEW}}

==================================================================
6. WHAT TO BUILD — at studio fidelity, all procedural, all in this one module
==================================================================
Organize the module as many well-named helper functions inside createWorld (or at module top level above it — no imports), e.g. materials library, canvas texture painters, geometry helpers (extruded profiles, lathe, tubes), then builders, then placement, then kinematics, witnesses, facts, return.

A. Vehicles (each a THREE.Group, origin footprint center, front = local -Z):
   - veh_A passenger sedan, dark blue metallic (#1d2c44) clearcoat paint: shaped body from extruded/lofted side profile (hood, A/B/C pillars, roof, trunk deck), wheel arches cut or flared, panel lines (thin dark inset strips on doors, hood, trunk), door handles, side mirrors, glass greenhouse (tinted, slightly transmissive), windshield wipers, visible interior (seats, dashboard, steering wheel, headrests), front fascia with grille, LED headlamp clusters (meshes named headlight_L/headlight_R, emissive off: headlights were off), taillamps (taillight_L/R), license plates, five-spoke alloy rims with 5 lug nuts each, tires with sidewall, brake discs/calipers visible behind spokes. userData.dims, userData.driverEye.
   - veh_T_tractor conventional-hood truck-tractor, white: long hood with grille and chrome bumper, fenders, sleeper-less day cab with windshield, side windows, mirrors on arms, exhaust stacks, air intakes, fuel tanks (cylindrical, polished), steps, fifth-wheel plate, 3 axles (steer + tandem drive) with dual rear wheels, mud flaps, marker lights, headlights_L/R.
   - veh_T_trailer refrigerated van semitrailer, white: box with corrugated/riveted side panel texture (canvas), front reefer unit, rear swing doors with hinges and lock rods, side skirts, landing gear, tandem axle (dual wheels) slid rearward, DOT conspicuity tape (red/white alternating on lower sides and rear), rear impact guard, marker lights, kingpin.
B. Roadway (exact geometry from scene spec): US-27A four-lane divided, 2 x 3.66 m lanes each direction, eastbound lanes centered as in v2 (EB lane centerlines at z = 0 and z = -3.66), westbound at z = -31.09 and z = -34.75 (match v2), 18.29 m grass median, paved shoulders, westbound left-turn lane, the 39.6 m uncontrolled median crossover, NE 140th Court running south from the EB edge. Asphalt with canvas-painted texture (aggregate noise, tire-track darkening, subtle patching/cracks), slight crown. MUTCD markings as crisp geometry or texture: 6-in solid white edge lines (right), solid yellow edge lines (left, median side), 10-ft white skip lines with 30-ft gaps between same-direction lanes, turn-lane white solid line + left-turn arrows, crossover edges, stop bar on NE 140th Ct, raised pavement markers (amber/white). Concrete curb and gutter where the spec says, grass shoulders elsewhere, gravel/sod edge transitions.
C. Roadside: utility poles with crossarms, insulators and sagging wires (catenary tubes) along the south side; occ_pole (the pole Vehicle A broke) at its v2 position; speed limit 65 sign (MUTCD R2-1, canvas painted) and any signs in the spec; reflective delineator posts; mailbox/fence lines (wood post + wire or board fence) along properties; guardrail only where the spec places it.
D. Feed store / retail business (bld_store) on the SE corner per spec: block/metal building with storefront glass, awning, signage (fictionalized, no real brand), gravel/asphalt lot, wheel stops, a few parked props if the spec has them; the open-sided bench shelter (occ_shelter) in front with posts, roof, bench — keep it open (occludes as in v2/spec).
E. Vegetation: live oaks / pines as trunk + branch tubes + leaf-card clusters via InstancedMesh with canvas-painted alpha leaf textures (alphaTest), tree lines in the distance on both sides, shrubs, grass with color variation (canvas noise texture on ground, plus instanced grass tuft cards near the road). Tree occluder entries for any tree the spec lists.
F. Terrain: large ground (~1600 m) with gentle undulation away from the road (keep y = 0 under all roads, witness positions and the vehicle paths), and the vertical crest of US-27A ~345 m west of the impact (occ_crest): model the road profile rising to the west (2.15% grade) as a terrain/road hump whose crest at x ≈ -345 hides the road beyond — the road surface west of x ≈ -200 may rise smoothly; ensure the car keyframes (y = 0) are not buried (the car is placed at y = 0 by setTime; keep the road surface at or below y = 0.02 wherever the car is during 0..duration — i.e. let the crest mass sit off the paved centerline or just beyond the car's start point x = -347.5, so sightlines from Witness A over that distance still behave as in v2). occ_crest occludes:true.
G. Sky, sun, atmosphere: as in section 1; distance haze.
H. Marks: mark_impact (small subtle ground decal + thin vertical marker), mark_rest_A, mark_path_A (post-impact path from the KA points after T_IMPACT, thin dark scuff ribbon), all occludes:false.

Every element: cite the scene-spec citation strings (or v2 citation strings) in its objects entry. Fictional dressing must say "fictional" or "assumed" in its citation.


==================================================================
7. HARD RULES AND LENGTH BUDGET
==================================================================
- EVERY key of `objects` MUST start with one of: veh_ occ_ sig_ road_ mark_ bld_ (no other prefixes: shoulders are road_, the ground is road_ground or occ_terrain, signs are sig_). Objects with kind 'signal' MUST have state(t) returning 'red'|'yellow'|'green'|'off' (a stop or speed sign uses kind 'sign', not 'signal', and needs no state). Minor dressing (individual trees, fence panels, wires, grass) does NOT need an objects entry — put it under root in named groups.
- This is a long-form generation. A previous attempt stopped at ~45,000 tokens: that is far too short and too coarse. Spend the budget on fidelity, approximately:
  sedan ~16k tokens (lofted body cross-sections along the length, separate door/hood/trunk panels with gaps, greenhouse, full interior, lamps with reflector+lens, rims, tires, brakes, underbody); truck-tractor ~16k; semitrailer ~12k; road surfaces, shoulders, crossover, turn lane, NE 140th Ct with canvas asphalt texture painter and all MUTCD markings ~14k; curbs, delineators, RPMs, signs (canvas-painted faces), poles, crossarms, insulators, catenary wires ~10k; feed store + lot + shelter + props ~12k; vegetation system (bark/leaf texture painters, branching trees, instanced leaf cards, shrubs, grass tufts, distant tree lines) ~14k; terrain + crest + fences ~8k; sky dome shader, sun, lights, haze ~5k; kinematics, witnesses, facts, objects registry ~10k.
  Total ~120k tokens. Keep writing detailed, non-repetitive code until every section has received its budget. Do not end the module before then.
- Measured history: attempt 1 ended at 45k tokens (3,460 lines), attempt 2 at 63k tokens (4,265 lines). Both were judged too coarse. This attempt must be at least 9,000 lines of real code. Concretely: one dedicated builder function per scene-spec element (all 42), each with its own geometry and materials; the sedan, tractor and trailer builders at least 900 lines EACH (separate sub-builders for body shell cross-sections, each door, hood, trunk/tailgate, bumpers, grille, each lamp assembly, mirrors, glass, interior seats/dash/steering, wheel+tire+rim+lugs+brake, suspension/axles/underbody, chassis rails, fuel tanks, reefer unit, doors, hinges, skirts, landing gear, conspicuity tape); every canvas texture painter (asphalt, concrete, grass, bark, leaves, sign faces, storefront, trailer panels, sky) written out in full with multiple passes of procedural noise. Write it all.

Begin the module now. First line: a comment header. Write the whole thing.
