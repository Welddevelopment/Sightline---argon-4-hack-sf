# SCENE ROADS status (web/assets/scene.js, textures.js, web/scene_preview.html)

Kept as-is (reference review: "already near standard"): rural asphalt shader, lane wear, shoulders, edge fringe, RPMs, ditches.

## New (gap #3 / #5)
- Median openings: `openings:[{at, width, radius, curb:true, stopBars:true, centerLine}]`
  - `curb` = raised 0.15 m concrete nose curb, yellow-painted, following the fillet edge of both median noses (`road_median_nose`).
  - `stopBars` = 24" white median stop bars for crossing traffic at both carriageways + yellow line across the opening.
- `roadDecal({kind, position:[x,z], heading, w, h, color})`: high-res CanvasTexture markings (200 px/m, worn paint,
  anisotropy from `setAnisotropy(renderer max)`). Kinds: arrow_left|arrow_right|arrow_through|arrow_left_through|stop_bar|
  crosswalk (continental)|nose_hatch (FDOT yellow 45-degree hatch)|double_yellow. Arrows point along heading.
  (Turn-lane arrows / stop bars inside road() are still crisp polygon geometry, worn-paint texture.)
- `guardrail({points:[[x,z]..] world, side, railTop=0.79, postSpacing=1.905, endTreatment:'turndown'})`: MGS W-beam,
  galvanised posts + blockouts, swept W profile, follows terrainHeight, buried turn-down ends.
- `sitePad({position, width, depth, heading, paved, surface})`: flattens natural terrain under a building/lot (registers
  with terrainHeight + groundPlane like a road corridor) and optionally lays an asphalt/concrete slab.
- `parkingLot({position, heading, width, depth, rows, stallWidth=2.74, stallDepth=5.5, aisle=7.3, accessible})`:
  paved lot, 4" white 90-degree stall lines, blue accessible stall lines, concrete wheel stops (row 1 at local -Z edge).
- `driveway({position (throat at road edge), heading (into site), width=7.3, length, radius=4.5})`: flared apron, paved.
- `treeline()` crowns are now instanced alpha-clipped leaf-card clusters (oak/pine/shrub, alphaTest 0.5, castShadow)
  with a small opaque core per crown; no more icosphere "broccoli". Pines = tall bare trunk + high crown.
- textures.js: `foliageTexture(kind)`, `foliageMaterial(kind)` (no back-face normal flip -> volumetric shading),
  `foliageClusterGeometry({cards, flat, seed})`, `decalTexture(kind, opts)`.

## Preview (web/scene_preview.html?view=eye|crossover|store|lot|driver|intersection|crest|overhead|wide)
Site laid out from the USGS NAIP aerial (cases/demo/exhibits/aerial): dense slash-pine/mixed forest both sides behind
mown ROW, flat-roof store + 2-row striped lot + two driveway aprons north of the crossover, small brick building + lot
SW of NE 140th Ct, open SE pasture with scattered live oaks + barbed-wire fence, wood pole line with spans/wires,
MUTCD stop (with street blades), speed limit 60, side-road warning, US 27 shield, median stop sign. 16:36 EDT sun.

## Kenney CC0 kits (assets_src/kenney/*): REJECTED for every item
city-kit-roads, city-kit-commercial, city-kit-suburban, nature-kit are stylised low-poly (flat colours, chunky
proportions, toy trees). Next to realistic vehicles they read as cartoon, so the procedural versions stay.
web/models/furniture/ is not used.
