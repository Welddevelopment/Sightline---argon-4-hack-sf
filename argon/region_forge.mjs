#!/usr/bin/env node
// argon/region_forge.mjs — step D: Gemini 4 Argon writes the site in PARALLEL REGIONS (one call each, full detail),
// then reviews renders of its own work against the forensic reference standard and returns corrected modules.
//
//   node argon/region_forge.mjs gen      [--only r1_crossover,r2_west] [--round 0]
//   node argon/region_forge.mjs render   [--round 0] [--views oblique,eyeB,...]
//   node argon/region_forge.mjs critique --round 1 [--only ...]     (uses stills of round-1 → writes round N modules)
//   node argon/region_forge.mjs validate
// Needs SIGHTLINE_MODE=live + GEMINI_API_KEY for gen/critique. Region modules land in web/regions_argon/<id>.js only
// after they pass the Node validator (syntax, contract, NaN, bbox, triangle budget); otherwise the previous good
// version is kept. Raw outputs + usage meta: renders/region_forge/cache/.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { ROOT, callArgon, readPrompt, fill, imagePart, textPart, isLive } from './client.js';

const OUT_DIR = path.join(ROOT, 'web', 'regions_argon');
const STAGE = path.join(OUT_DIR, '_staging');
const RDIR = path.join(ROOT, 'renders', 'region_forge');
const CACHE = path.join(RDIR, 'cache');
const STATUS = path.join(ROOT, 'status', 'region_forge.md');
const SCENE_SPEC = path.join(ROOT, 'cases', 'demo', 'plan', 'scene_spec.json');
for (const d of [OUT_DIR, STAGE, RDIR, CACHE]) fs.mkdirSync(d, { recursive: true });

const args = process.argv.slice(2);
const cmd = args[0] || 'gen';
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const ONLY = opt('only') ? opt('only').split(',') : null;
const THINK = Number(opt('thinking', process.env.ARGON_THINKING_BUDGET || 6000));
process.env.ARGON_THINKING_BUDGET = String(THINK);

// ------------------------------------------------------------------ region briefs
export const REGIONS = [
  { id: 'r1_crossover', tris: 200000, brief: `
**Scope:** the median crossover intersection: x in [-45, 45] for the US-27A mainline (both carriageways, shoulders,
all markings, median noses), the crossover pavement, the first 16 m of NE 140th Ct (mouth flare, z from 3.35 to 16),
and all traffic control devices at the intersection.
**Build, with real positions:**
- EB and WB carriageway + paved shoulder strips for x in [-45, 45] (draped on roadY), asphalt via ctx.surface('asphalt'),
  shoulders slightly lighter/older asphalt tint; 0.05 m asphalt edge drop-off to the grass.
- Crossover pavement x [-19.81, 19.81] between the carriageways' inner edges, with its own subtle patch seam lines.
- The WB left-turn lane start (x 19.81..45, z [-29.26,-25.60]) and EB left-turn lane end (x -45..-19.81, z [-9.15,-5.49]),
  EB right-turn lane end (x -45..-9, z [1.83, 5.49]) with the shoulder outside it.
- Median noses at both crossover ends: raised concrete curbed noses (Type F curb, 0.15 m) with rounded 1.2 m-radius
  ends, yellow reflective paint on the nose, plus a yellow-black object marker (OM-3) and a KEEP RIGHT (R4-7) sign on
  each nose; ONE WAY (R6-1) signs in the median facing crossover traffic; DIVIDED HIGHWAY (R6-3) sign under the stop sign.
- NE 140th Ct mouth: flared pavement (x [-16,16] at z=3.35 narrowing to [-3.05,3.05] by z=16, smooth radius-12 m
  returns), stop bar (0.40 m) at z=5.5 across the northbound half (x [0, 3.05]), STOP sign (R1-1, 30 in, bottom 2.13 m) at
  (4.2, 6.0) facing +Z (northbound drivers; rotation.y = PI) with a 'NE 140TH CT' / 'US 27A' street-name blade pair on top, gravel/shell shoulder at the mouth edges.
- Markings (MUTCD, crisp, painted on pavement, paint material with slight wear): EB/WB dashed lane lines,
  white right edge lines, yellow left edge lines — all broken at the crossover/side-road mouth exactly as in practice;
  white solid turn-lane lines; 2 left-turn arrows in each turn lane within your x range (canvas decal or extruded
  arrow shape); dotted white extension lines through the crossover for both turn movements; RPMs every 12.2 m.
- The NORTH leg (USGS aerial): a local road mouth leaving the WB north shoulder at x ~ -38..-14 (z -38.1 to -44,
  flared, heading NNW) — build its first 6 m of pavement; r4 builds the rest. The SW corner landscaped island
  (layout.aerial.swCorner.island, low curb + grass, flush) is yours.
- Optional: a street light is NOT in the record — do not add one.
- Clear: Witness B point (7.5,6.5), the truck turn path, the car path.
**Not yours:** the mainline beyond |x|>45 (r2/r3), the store, apron, shelter and side road beyond z=16 (r5),
north roadside (r4), terrain/grass ground mesh (r6 lays the whole ground; you only add pavement/curbs/signs on top).` },
  { id: 'r2_west', tris: 120000, brief: `
**Scope:** the EB/WB mainline WEST of the intersection: x in [-900, -45], including the hill crest at x=-345 (+7.42 m)
and the 2.15% descent toward the intersection (follow ctx.roadY exactly — this crest is THE sight restriction in the
case, so the pavement must be smoothly draped, sub-divided every <= 6 m near the crest), both carriageways, shoulders,
the EB left-turn lane x [-187.45, -45] with its taper to -220, the EB right-turn lane x [-170, -45] with taper to -200
(right shoulder shifts outside it), and roadside furniture within the right-of-way (z in [-44, 10]).
**Build:**
- Pavement strips (asphalt PBR, UVs in meters), shoulders, 0.6 m-wide milled rumble strips on the shoulders (subtle
  darker ribbed texture), lane-wear darkening in the wheel paths (canvas or vertex colors), patched cracks occasional.
- Markings: dashed white lane lines (3.05 m / 9.15 m), white right edge, yellow left edge, turn-lane solid white lines,
  2 left-turn arrows and 1 right-turn arrow + 'ONLY' legend in the turn lanes, RPMs every 12.2 m — use InstancedMesh.
- Signs facing EB traffic (face = local -Z at rotation 0; rotation.y = +PI/2 faces westward to EB drivers):
  SPEED LIMIT 65 at x=-600 (z=6), intersection/side-road warning (W2-2, 'generic' plate with the warning text if
  needed) at x=-480 (z=6), mile marker 29 post (green, small) at x=-250, 'NE 140TH CT' advance street name plate at x=-250.
  For WB traffic (face +X): SPEED LIMIT 65 at x=-120 on the north side (z=-40.5).
- Flexible white delineator posts every 60 m on both outer shoulders, low (1.2 m).
- A concrete drainage culvert headwall pair where the median swale is crossed by nothing (just for detail) at x=-520.
- No trees, buildings, guardrail, or anything solid > 0.6 m inside z in [-50, 12] for x in [-700, 0] (NTSB found no
  obstructions; keep the corridor clean and flush — mowed grass is r6's ground).
**Not yours:** terrain/grass mesh (r6), trees, fences and poles beyond the ditches (r4 north, r5 south), |x| < 45 (r1).` },
  { id: 'r3_east', tris: 120000, brief: `
**Scope:** the EB/WB mainline EAST of the intersection: x in [45, 800], both carriageways and shoulders on the
2.15% descent that levels at x=+100 (follow ctx.roadY), the WB left-turn lane (the truck's lane) x [45, 187.45] full
width plus its taper to x=220, and roadside furniture inside the right-of-way z in [-44, 8].
**Build:**
- Pavement strips (asphalt PBR), shoulders, rumble strips, wheel-path wear, crack sealing, occasional patches.
- Markings: dashed white lane lines, white right edge, yellow left edge, solid white turn-lane line, 3 left-turn arrows
  + 'ONLY' in the WB turn lane, taper lines, RPMs every 12.2 m (InstancedMesh).
- Signs facing WB traffic (face +X: rotation.y = -PI/2): SPEED LIMIT 65 at x=600 (z=-40.5), side-road warning at
  x=480 (z=-40.5), 'NE 140TH CT' advance name plate at x=250 (z=-40.5), LEFT LANE MUST TURN LEFT / turn-lane sign at x=200 (z=-24.5,
  in the median). Facing EB traffic (rotation.y = +PI/2): SPEED LIMIT 65 at x=150 (z=6.5); mile marker at x=360.
- Flexible delineator posts every 60 m; the drainage culvert the car went through (NTSB p.1): a farm-field crossing
  at layout.culvert (x=120, z=9) — 0.9 m corrugated/concrete pipe under a 5 m-wide shell-rock crossing in the south
  ditch, concrete headwalls/mitered ends at z 7.0 and 11.0 (use ctx.groundY), plus the residence driveway apron
  x [278, 282] from z=3.35 to 8 (shell-rock, ctx.surface('gravel')) with its own pipe ends.
- Keep the car's post-impact path clear except the culvert. Witness A stands in the WB outside lane at (357.2,-34.75).
**Not yours:** terrain (r6), poles/fences/house south of z=8 (r5), north roadside beyond z=-44 (r4), |x|<45 (r1).` },
  { id: 'r4_north', tris: 330000, brief: `
**Scope:** NORTH roadside: everything north of the WB shoulder ditch, z in [-500, -44], x in [-1000, 800], plus the
north ditch itself (built into groundY at z=-44; you add ditch details only).
**Build (rural Florida pasture land, NTSB found nothing obstructing):**
- North right-of-way fence at z=-50 along the whole length: woven-wire or 4-strand barbed wire on wood posts every
  3 m with steel T-posts between (use assets.fence? not exposed — write your own InstancedMesh posts + strands), gates at driveways.
- FROM THE AERIAL (place by reading the gridded images): the north leg local road from z=-44 north (paved, ~6 m,
  heading NNW, x ~ -25 at z=-44 to ~ -60 at z=-170, then beyond); the retail store north of the highway with its
  large paved parking lot (layout.aerial.northStore: building ~26 x 20 m, flat roof, facade facing the lot/highway,
  striped stalls, a few light poles, 2 parked vehicles max), its driveway(s) to the north leg / highway; the other
  buildings north-east (x 150..300, z -120..-60: metal warehouse/shop buildings, a house with a pool, sheds) and
  north-west; dirt/shell driveways (e.g. the one at x ~ 230 heading north) with culvert ends and mailboxes.
- Dense slash-pine forest from the forest edge (~z = -60 to -75, read it off the aerial) northward: your own instanced
  low-poly pines (tall straight trunks, high crowns; <= 80 tris each, up to ~2500 instances near the edge, sparser
  inside), mixed oaks; a ragged realistic edge with understory palmetto (instanced). Clearings where the aerial shows them.
- Hero trees (assets.tree, max 4) only at buildings.
- Witness C stood at (-18, -40.5) on the WB shoulder edge — keep (-30..-5, -60..-38) free of anything tall.
**Not yours:** pavement (r1-r3), terrain mesh (r6), the far horizon ring beyond |z|>500 or x outside [-1000,800] (r6).` },
  { id: 'r5_south', tris: 330000, brief: `
**Scope:** SOUTH roadside: z in [3.35, 500] (south of the EB shoulder; the south ditch at z=9 is in groundY),
x in [-1000, 800], EXCEPT the NE 140th Ct mouth z<16 (r1). Includes NE 140th Ct from z=16 to 230, the retail store
and its apron, the bench shelter, the utility pole line + wires, both wire fences, the residence + front yard where
the car came to rest, and south-side vegetation.
**Build, with real positions:**
- NE 140th Ct: 6.1 m local paved road (no centre line, worn edges, grass shoulders) from z=16 to 230, a few
  residential driveways, mailboxes; the truck stopped on it ~z=34..45 (keep x [-4,4] clear).
- Retail store, SE corner (footprint x [9,27], z [13,25], 4.5 m, faces north): procedural facade — storefront glazing
  with mullions, entry door, metal canopy/awning along the front, parapet with a plain (unbranded) 'FOOD STORE' sign
  band (canvas text; NO real brand names), stucco/CMU walls (canvas texture or color), roof-top HVAC units,
  rear dumpster enclosure, ice chest + propane cage by the front, wall-pack lights (off). You may call
  assets.building({style:'commercial', w:18, d:12, h:4.5}) as the shell and add the detail, or model it yourself.
- Optional fuel island east of the store (x ~ 30..42, z ~ 14..22): canopy on 4 columns + 2 dispensers, citation
  'inferred: scene dressing, not in NTSB record'. Keep it out of the car path.
- Apron x [4, 33], z [3.35, 13]: shell-rock/asphalt parking with faded white stall stripes (canvas or thin strips),
  wheel stops, 2 parked vehicles max (assets.parkedVehicle('pickup'|'sedan', {id, color}) — 65-76k tris each) in
  stalls in front of the store at x 20..30 (NOT near Witness B or the shelter).
- Open bench shelter at (8, 7.9) (assets.shelter({id, open:true}), rotated so its open side faces the highway), on a
  small concrete pad; trash can. Witness B point (7.5,6.5): nothing within 1.5 m.
- Utility pole line along z=18.5: poles every 75 m with one exactly at x=239.3 (the pole Vehicle A struck; build it
  intact, pre-crash; userData.citation NTSB p.1), from x=-1000 to 800 (skip any that falls in the side road or the store),
  assets.pole({id, height:10.5}) rotated so the crossarm is perpendicular to the line (crossarm is local X), and draw
  sagging catenary conductors (3 + neutral + comm cable) between consecutive poles yourself (TubeGeometry is too
  heavy — use thin InstancedMesh cylinder segments, 8 per span) using each pole's userData.attach points.
- Fences: EXACTLY two wire fences cross the car's post-impact path (NTSB p.1): layout.fenceSouth1 (z=14.5, x 85..225,
  E-W) and layout.fenceSouth2 (x=225, z 13..31, N-S). The south ROW fence (z=14.5) exists only for x in [-1000,-8] and
  [310, 800] so no third fence crosses the path. Wood posts every 3.66 m, steel T-posts between, 4 strands, sag.
- Residence where the car came to rest (front yard, near a driveway): ranch house at layout.residence (262, 40),
  20 x 14 m, faces north (assets.building({kind:'house'}) + porch, carport), shell-rock driveway x [278,282] from z=8
  to 44, mailbox at (284, 8), front-yard lawn (the car rests at (276.6, 23.9): keep 4 m around it clear), 2 live oaks, a palm.
- FROM THE AERIAL: the SW-corner small commercial building + canopy structure (layout.aerial.swCorner) with its
  paved/shell lot; houses along NE 140th Ct and along the dirt road at z ~ 130 (read positions from image 1; apply
  x_model = x_aerial - 0.33*z for things positioned relative to the skewed side road), the open grass field SE
  (layout.aerial.openFieldSE) with scattered live oaks, the cleared sandy areas SW (x -500..-300, z 100..300).
- Dense pine forest south of the highway west of the side road from the forest edge (z ~ 15-30) southward, and
  forest/hammocks elsewhere as the aerial shows (instanced low-poly pines/oaks, <= 80 tris each, <= 2500 instances), palmetto clumps.
  Nothing taller than 0.6 m at z < 12 for x in [-700, 0].
- Keep clear: the car path polyline (except the fences, culvert and pole), the truck path, Witness B, and the west
  sight corridor x [-700, 0], z <= 40 (nothing > 0.6 m there).
**Not yours:** pavement of US-27A and its shoulders (r1-r3), the culvert at x=118 (r3), terrain mesh (r6).` },
  { id: 'r6_terrain', tris: 250000, brief: `
**Scope:** the GROUND for the whole site and the far vegetation ring.
**Build:**
- One terrain mesh covering x [-1000, 800], z [-500, 500], heights from ctx.groundY(x,z) at every vertex (the road
  regions lay pavement on top; the terrain must sit 0.03 m BELOW roadY under pavement/shoulders so it never pokes
  through: for vertices whose z is inside a carriageway+shoulder band (EB z [-6.10, 3.35] incl. EB right-turn lane
  z up to 5.49 for x in [-200,-9]; WB z [-38.10, -28.65]; WB turn lane z [-29.26,-24.99] x [19,220]; EB left-turn
  z [-9.76,-5.49] x [-220,-19]; the crossover; NE 140th Ct x [-3.6, 3.6] z>3) use roadY(x) - 0.03).
  Use a NON-UNIFORM grid: rows densely spaced across the road corridor (every 0.5–1 m for z in [-50, 20]),
  coarser away (up to 12 m), columns every 4 m for x in [-450, 300], coarser beyond (up to 15 m). Stay within budget.
- Vertex colors / blended materials: mowed ROW grass (bright, short) within the right-of-way (z in [-50, 12]),
  slightly darker, patchier pasture beyond, sandy bare patches at ditch bottoms and the side-road mouth, tire-worn
  dirt at driveway edges. Use ctx.surface('grass') for the ROW and ctx.surface('pasture') beyond (two meshes or
  one mesh with vertex colors multiplying a single material); UVs in meters.
- Grass detail: instanced low grass tufts / weeds along fence lines and ditch edges only (cheap, <= 15k instances,
  <= 6 tris each, height <= 0.4 m) — none on pavement.
- Far vegetation ring that closes the horizon: continuous tree lines (instanced low-poly pines + oak blobs, plus
  silhouette cards) along x = -1000 / 800 and z = ±500 bands, i.e. OUTSIDE the aerial's coverage (x [-500,500],
  z [-300,300]) which r4/r5 populate. Land-cover colours inside the aerial area must match it (mown ROW, pasture/field
  SE, sandy clearings, forest floor under the pines darker). Respect ctx.blocked(x,z): NOTHING solid in the west sight
  corridor x [-700, 0], z [-50, 12]. Beyond the
  crest (x < -345) the road must remain visible from the crest: keep trees > 45 m from the road centreline there.
- A huge, low-detail skirt beyond the terrain edge (ring out to 3 km, flat at the edge heights, same pasture color)
  so the horizon never shows a void.
**Not yours:** pavement, markings, signs, fences, poles, buildings, the near-road vegetation of r4/r5.` },
];

// ------------------------------------------------------------------ USGS NAIP aerial (ground truth for land cover)
const AERIAL_DIR = path.join(RDIR, 'aerial');
const AERIAL_IMAGES = [path.join(AERIAL_DIR, 'aerial_world_grid.jpg'), path.join(AERIAL_DIR, 'aerial_crossover_grid.jpg')];
function aerialParts() { return AERIAL_IMAGES.filter((f) => fs.existsSync(f)).map((f) => imagePart(f)); }
const AERIAL_NOTE = `# Ground truth: USGS NAIP aerial (the FIRST TWO attached images)
Source cases/demo/exhibits/aerial/aerial.jpg (USDA FSA NAIP via USGS The National Map, public domain, ~0.30 m/px), already
ROTATED INTO THE WORLD FRAME for you (calibration world = rotY(18.83 deg)*photo + offset; residual < 0.5 m): image up = -Z
(north), right = +X (east), magenta circle = origin (impact point). Image 1 = whole site x [-500, 500], z [-300, 300] with a
50 m grid (yellow labels x every 100 m, cyan labels z every 100 m). Image 2 = close-up x [-150, 150], z [-100, 100] with a
10 m grid (labels every 50 m). Read positions straight off the grid. Cite such elements "USGS NAIP aerial (measured)".
What it shows (verify yourself): dense pine forest on both sides with the forest edge roughly 55-75 m north of the
highway and 15-30 m south of it west of the side road; mown rights-of-way along the highway; the 4-leg crossover:
a NORTH leg road leaving the WB carriageway at x ~ -25 heading north-north-west, and NE 140th Ct to the south (the model
straightens it to run due south at x = 0; the real road drifts east ~0.33 m per m south — shift anything you place along
it by x_model = x_aerial - 0.33*z); a retail store with a large paved parking lot NORTH of the highway at about
x [-110, -50], z [-115, -60]; a small commercial building + canopy/structure and a landscaped corner island at the SW
corner of the side road (x ~ -25..0, z ~ 3..55); an open grass field SE (x ~ 60..260, z ~ 10..95) with scattered oaks;
houses along the side road and along a dirt road at z ~ 130; more buildings north-east (x 150..300, z -120..-60).
CONFLICT RULE: the shared layout (pavement, side road at x=0, the SE-corner case store at (18,19) with its bench
shelter and Witness B's spot, the struck pole, the two fences, the residence/rest area, the culvert, the keep-clear
zones) is AUTHORITATIVE because the motion data and witness testimony are keyed to it. Everything else — forest edges,
other buildings, the north store + lot, the north leg road, driveways, fields, house positions — take from the aerial.`;

// ------------------------------------------------------------------ prompt pieces
const ASSET_API = `- assets.tree({id, kind:'oak'|'pine'|'palm'|'shrub', height}) → detailed tree (oak/pine ~10k tris, palm ~1.5k). Hero trees only.
- assets.pole({id, height=10.5, crossarm=true, insulators=3}) → wooden utility pole, crossarm along LOCAL X at y=height-0.55;
  pole.userData.attach = [[x,y,z],...] local wire attachment points (3 crossarm tips + top + neutral). Wires: draw yourself.
- assets.sign({id, kind:'stop'|'yield'|'speed_limit'|'street_name'|'generic', text, speed, streetName, streetName2,
  mountHeight, rural:true, w, h, bg:'#ffffff', fg:'#000000'}) → MUTCD sign on a perforated post, canvas face. The face
  points LOCAL -Z at rotation 0: rotation.y=+PI/2 faces -X (EB drivers), -PI/2 faces +X (WB drivers), PI faces +Z
  (northbound side-road drivers). 'generic' = rectangular plate with multi-line text ('\\n') and bg/fg colours
  (use it for KEEP RIGHT, ONE WAY, DIVIDED HIGHWAY, warnings with words, mile markers with bg '#00653a').
- assets.streetlight({id, height=9, on:false}); assets.shelter({id, open:true}) 3.5 x 1.5 x 2.5 (long axis local X);
  assets.building({id, w, d, h, kind:'store'|'house'|'generic', style:'commercial'|'house'|'gas_station'|'barn'}) →
  textured building shell (~120 tris), front faces local -Z; assets.parkedVehicle(type, {id, color}) with type in
  sedan|suv|pickup|van|box_truck (65–76k tris each!), front faces local -Z.
- assets.pedestrian — do NOT use (people are placed by the dynamic world).
- assets.road / median / intersection / curb / sidewalk / crosswalk exist but are flat (y=0) and ignore the grade:
  do NOT use them; build pavement yourself on ctx.roadY.
All library objects: origin = ground-level centre of footprint; set position.y = ctx.groundY(x,z).`;

const STANDARD = `Reference: professional forensic animations (ESI traditional studio; Ziva/Unreal real-time). Jurors trust them because
the road geometry is provably right and nothing looks toy-like. Concretely for static scenery:
- Flat matte asphalt with real aggregate texture, crisp high-contrast vector-like markings (exact MUTCD widths,
  dash/gap), stop bars, arrows, wheel-path wear and oil strips, sealed cracks; concrete curbs and painted median noses;
  W-beam guardrail only where it exists (here: none recorded).
- Fully modelled street furniture: signs with real faces on breakaway posts, utility poles with crossarms,
  insulators and sagging wires, fences with posts and strands.
- Buildings: clean architectural massing with facade detail (window grids, mullions, awnings, parapets, rooftop units,
  signage band) — not untextured boxes. No real brand names.
- Vegetation: varied real species silhouettes (no lollipop/broccoli spheres), set back realistically, horizon closed.
- Everything grounded: no floating objects, no z-fighting, no gaps between pavement and ground, consistent scale.
- Known defects of OUR earlier renders to avoid: brown untextured boxes, neon flat grass, blocky untextured
  intersections without stop bars/arrows/curb radii, sphere trees, objects floating or sunk.`;

function layoutJSON(ctxLayout) {
  const L = JSON.parse(JSON.stringify(ctxLayout));
  return JSON.stringify(L, null, 1);
}

async function loadLayout() {
  const m = await import(pathToFileURL(path.join(OUT_DIR, 'site_ctx.js')).href);
  return m;
}

function sceneSpecText() {
  if (!fs.existsSync(SCENE_SPEC)) return '';
  let s;
  try {
    const j = JSON.parse(fs.readFileSync(SCENE_SPEC, 'utf8'));
    const keep = ['id', 'category', 'label', 'position', 'headingDeg', 'dimensions', 'polyline', 'material', 'mutcd', 'citation'];
    s = JSON.stringify({ lighting: j.lighting, crossSection: j.crossSection, profile: j.profile,
      elements: (j.elements || []).filter((e) => !/^(mark_impact|mark_rest|mark_path|veh_|wit_)/.test(e.id)).map((e) => Object.fromEntries(keep.filter((k) => e[k] !== undefined).map((k) => [k, e[k]]))),
      risks: (j.risks || []).map((r) => r.description) });
  } catch { s = fs.readFileSync(SCENE_SPEC, 'utf8'); }
  return `# Scene spec from the shot planner (cases/demo/plan/scene_spec.json) — use any positions it gives for your region;
if it conflicts with the shared layout above, the shared layout wins (it matches the motion data and the other regions). Use the spec for materials/colours/MUTCD details.
\`\`\`json
${s.length > 30000 ? s.slice(0, 30000) + '\n... (truncated)' : s}
\`\`\``;
}

async function buildPrompt(R, extra = '') {
  const { LAYOUT } = await loadLayout();
  return fill(readPrompt('region_forge'), {
    REGION_ID: R.id, REGION_BRIEF: R.brief.trim(), LAYOUT_JSON: layoutJSON(LAYOUT), ASSET_API, STANDARD,
    TRI_BUDGET: R.tris.toLocaleString('en-US'), EXTRA: [AERIAL_NOTE, sceneSpecText(), extra].filter(Boolean).join('\n\n'),
  });
}

// ------------------------------------------------------------------ Node validator
const FORBIDDEN = /\bimport\s*\(|^\s*import\s|\brequire\s*\(|\bfetch\s*\(|\beval\s*\(|new\s+Function|Math\.random|setTimeout|setInterval|XMLHttpRequest|document\.(getElement|querySelector)/m;
let _assetsP = null;
async function nodeAssets() {
  if (!_assetsP) _assetsP = (async () => {
    const THREE = await import('three');
    const { loadAssets } = await import(pathToFileURL(path.join(ROOT, 'web', 'assets.js')).href);
    return { THREE, assets: await loadAssets(THREE, { headless: true }) };
  })();
  return _assetsP;
}
export function countTris(obj) {
  let n = 0;
  obj.traverse((m) => {
    if (!m.isMesh || !m.geometry) return;
    const g = m.geometry, c = (g.index ? g.index.count : (g.attributes.position?.count || 0)) / 3;
    n += c * (m.isInstancedMesh ? m.count : 1);
  });
  return Math.round(n);
}
export async function validateModule(file, R) {
  const errors = [], warnings = [];
  const src = fs.readFileSync(file, 'utf8');
  if (FORBIDDEN.test(src)) errors.push('forbidden token (import/require/fetch/eval/Math.random/timers/DOM query) in module source');
  if (!/export\s+default\s+function/.test(src)) errors.push('missing `export default function region(THREE, assets, ctx)`');
  if (errors.length) return { ok: false, errors, warnings };
  const { THREE, assets } = await nodeAssets();
  const { makeCtx, LAYOUT } = await loadLayout();
  let mod, g;
  try { mod = await import(pathToFileURL(file).href + '?v=' + Date.now()); }
  catch (e) { return { ok: false, errors: ['import/syntax error: ' + String(e.message).slice(0, 400)], warnings }; }
  const t0 = Date.now();
  try { g = mod.default(THREE, assets, makeCtx({ headless: true })); }
  catch (e) { return { ok: false, errors: ['runtime error while building (Node, headless, ctx.makeCanvas returns null): ' + String(e.stack || e).split('\n').slice(0, 4).join(' | ').slice(0, 600)], warnings }; }
  const buildMs = Date.now() - t0;
  if (!g || !g.isObject3D) return { ok: false, errors: ['region() did not return a THREE.Object3D'], warnings };
  g.updateMatrixWorld(true);
  let nan = 0, meshes = 0, inst = 0, nanWhere = [];
  const m4 = new THREE.Matrix4();
  g.traverse((o) => {
    for (const v of [o.position, o.scale]) if (![v.x, v.y, v.z].every(Number.isFinite)) { nan++; nanWhere.push(o.name || o.type); }
    if (o.isMesh) {
      meshes++;
      const p = o.geometry?.attributes?.position;
      if (p) { const a = p.array; for (let i = 0; i < a.length; i += 97) if (!Number.isFinite(a[i])) { nan++; nanWhere.push((o.name || 'mesh') + ':geom'); break; } }
      if (o.isInstancedMesh) { inst++; for (let i = 0; i < o.count; i += Math.max(1, Math.floor(o.count / 50))) { o.getMatrixAt(i, m4); if (!m4.elements.every(Number.isFinite)) { nan++; nanWhere.push((o.name || 'inst') + ':matrix'); break; } } }
    }
  });
  if (nan) errors.push(`NaN/Infinity in ${nan} places: ${[...new Set(nanWhere)].slice(0, 8).join(', ')}`);
  const box = new THREE.Box3();
  // bbox from mesh geometry (instanced: include instance matrices sampled)
  g.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox; if (!bb || !Number.isFinite(bb.min.x)) return;
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i += Math.max(1, Math.floor(o.count / 200))) { o.getMatrixAt(i, m4); box.union(bb.clone().applyMatrix4(m4.premultiply(o.matrixWorld))); }
    } else box.union(bb.clone().applyMatrix4(o.matrixWorld));
  });
  const tris = countTris(g);
  const E = LAYOUT.extent, pad = R.id === 'r6_terrain' ? 3200 : 150;
  const bb = box.isEmpty() ? null : { min: box.min.toArray().map((v) => +v.toFixed(1)), max: box.max.toArray().map((v) => +v.toFixed(1)) };
  if (!bb) errors.push('region is empty (no meshes)');
  else {
    if (bb.min[0] < E.xMin - pad || bb.max[0] > E.xMax + pad || bb.min[2] < E.zMin - pad || bb.max[2] > E.zMax + pad) errors.push(`bounding box ${JSON.stringify(bb)} exceeds site extent ${JSON.stringify(E)} (+${pad} m)`);
    if (bb.min[1] < -25 || bb.max[1] > 80) errors.push(`bounding box y range [${bb.min[1]}, ${bb.max[1]}] is not sane (expected about [-5, 30])`);
  }
  if (tris > R.tris * 1.25) errors.push(`triangle count ${tris} exceeds the region budget ${R.tris} by more than 25% — instance or simplify`);
  else if (tris > R.tris) warnings.push(`triangle count ${tris} above budget ${R.tris}`);
  let uncited = 0; for (const c of g.children) if (!c.userData?.citation) uncited++;
  if (uncited) warnings.push(`${uncited}/${g.children.length} direct children lack userData.citation`);
  return { ok: errors.length === 0, errors, warnings, tris, meshes, instanced: inst, children: g.children.length, bbox: bb, buildMs, bytes: src.length };
}

// ------------------------------------------------------------------ Argon calls
function metaOf(name) { try { return JSON.parse(fs.readFileSync(path.join(CACHE, `${name}.meta.json`), 'utf8')); } catch { return null; } }
function log(line) {
  const s = `- ${new Date().toTimeString().slice(0, 5)} ${line}`;
  console.log(s);
  fs.appendFileSync(STATUS, s + '\n');
}

async function argonModule(name, parts) {
  const r = await callArgon({ name, parts, ext: 'js', maxOutputTokens: 32768, cacheDir: CACHE });
  return { code: r.text, meta: metaOf(name) };
}

async function forgeOne(R, round, partsBuilder) {
  const name = `rf_r${round}_${R.id}`;
  const t0 = Date.now();
  const rec = { id: R.id, round, calls: [] };
  try {
    let { code, meta } = await argonModule(name, await partsBuilder());
    rec.calls.push({ name, usage: meta?.usage, seconds: meta?.seconds, finish: meta?.finishReason });
    let stage = path.join(STAGE, `${R.id}.r${round}.js`);
    fs.writeFileSync(stage, code);
    let v = await validateModule(stage, R);
    for (let k = 1; k <= 2 && !v.ok; k++) {
      log(`${R.id} round ${round}: validation failed (${v.errors.join(' ; ').slice(0, 300)}) → repair call ${k}`);
      const rname = `${name}_repair${k > 1 ? k : ''}`;
      const parts = [textPart(await buildPrompt(R, `# REPAIR\nYour previous module for this region failed validation in Node (headless: ctx.makeCanvas returns null):\n${v.errors.map((e) => '- ' + e).join('\n')}\n\nReturn the COMPLETE corrected module (same scope and detail), fixing these errors. Previous module:\n\`\`\`js\n${code}\n\`\`\``)), ...aerialParts()];
      ({ code, meta } = await argonModule(rname, parts));
      rec.calls.push({ name: rname, usage: meta?.usage, seconds: meta?.seconds, finish: meta?.finishReason });
      stage = path.join(STAGE, `${R.id}.r${round}.repair${k}.js`);
      fs.writeFileSync(stage, code);
      v = await validateModule(stage, R);
    }
    rec.validation = v;
    if (v.ok) {
      fs.copyFileSync(stage, path.join(OUT_DIR, `${R.id}.js`));
      fs.copyFileSync(stage, path.join(RDIR, `${R.id}.round${round}.js`));
    }
    rec.ok = v.ok;
  } catch (e) {
    rec.ok = false; rec.error = String(e.stack || e).slice(0, 800);
  }
  rec.seconds = Math.round((Date.now() - t0) / 1000);
  const u = rec.calls.reduce((a, c) => ({ out: a.out + (c.usage?.candidatesTokenCount || 0), think: a.think + (c.usage?.thoughtsTokenCount || 0), prompt: a.prompt + (c.usage?.promptTokenCount || 0) }), { out: 0, think: 0, prompt: 0 });
  rec.tokens = u;
  log(`${R.id} round ${round}: ${rec.ok ? 'OK' : 'FAILED'} in ${rec.seconds}s; tokens prompt ${u.prompt} / out ${u.out} / think ${u.think}; ${rec.validation ? `tris ${rec.validation.tris}, ${rec.validation.bytes} B, warn: ${(rec.validation.warnings || []).join('; ') || 'none'}` : rec.error}`);
  return rec;
}

function writePlaceholders() {
  for (const R of REGIONS) {
    const f = path.join(OUT_DIR, `${R.id}.js`);
    if (!fs.existsSync(f)) fs.writeFileSync(f, `// placeholder until Argon writes ${R.id}\nexport default function region(THREE) { const g = new THREE.Group(); g.name = 'region_${R.id}'; g.userData.citation = 'placeholder'; return g; }\n`);
  }
}

async function cmdGen() {
  if (!isLive()) throw new Error('gen needs SIGHTLINE_MODE=live');
  writePlaceholders();
  const round = Number(opt('round', 0));
  const regs = REGIONS.filter((R) => !ONLY || ONLY.includes(R.id));
  log(`gen round ${round}: ${regs.length} parallel gemini-4-argon calls (thinking ${THINK}, maxOutputTokens 32768); scene_spec ${fs.existsSync(SCENE_SPEC) ? 'present' : 'absent'}`);
  const recs = await Promise.all(regs.map((R) => forgeOne(R, round, async () => [textPart(await buildPrompt(R)), ...aerialParts()])));
  fs.writeFileSync(path.join(RDIR, `gen_round${round}.json`), JSON.stringify(recs, null, 2));
  return recs;
}

// ------------------------------------------------------------------ renders
const VIEWS = ['oblique', 'eyeB', 'r1', 'r2', 'r3', 'r4', 'r5', 'r5b', 'r6'];
function staticServer() {
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, base: `http://127.0.0.1:${srv.address().port}` })));
}
export async function renderStills({ round = 0, views = VIEWS, w = 1280, h = 720, query = '' } = {}) {
  const { launchBrowser } = await import(pathToFileURL(path.join(ROOT, 'render', 'record.js')).href);
  const outDir = path.join(RDIR, `round${round}`);
  fs.mkdirSync(outDir, { recursive: true });
  const { srv, base } = await staticServer();
  const browser = await launchBrowser();
  const out = {};
  try {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const logs = [];
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 300)));
    const t0 = Date.now();
    await page.goto(`${base}/web/regions_argon/preview.html?w=${w}&h=${h}${query}`, { timeout: 180000 });
    await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 600000 });
    const info = await page.evaluate(() => ({ error: window.__error || null, stats: window.__stats || null }));
    if (info.error) throw new Error('preview error: ' + info.error);
    out._stats = info.stats; out._loadS = (Date.now() - t0) / 1000;
    for (const v of views) {
      const t1 = Date.now();
      const dataUrl = await page.evaluate((v) => window.__shot(v), v);
      const f = path.join(outDir, `${v}.png`);
      fs.writeFileSync(f, Buffer.from(dataUrl.split(',')[1], 'base64'));
      out[v] = path.relative(ROOT, f);
      console.log(`[render] ${v} → ${out[v]} (${((Date.now() - t1) / 1000).toFixed(1)}s)`);
    }
    out._console = logs.slice(0, 30);
  } finally { await browser.close(); srv.close(); }
  fs.writeFileSync(path.join(outDir, 'render.json'), JSON.stringify(out, null, 2));
  return out;
}

// ------------------------------------------------------------------ critique round
const REGION_VIEWS = { r1_crossover: ['r1', 'oblique', 'eyeB'], r2_west: ['r2', 'eyeB', 'r6'], r3_east: ['r3', 'oblique'], r4_north: ['r4', 'r6'], r5_south: ['r5', 'r5b', 'eyeB'], r6_terrain: ['r6', 'r2', 'oblique'] };
async function cmdCritique() {
  if (!isLive()) throw new Error('critique needs SIGHTLINE_MODE=live');
  const round = Number(opt('round', 1));
  const prevDir = path.join(RDIR, `round${round - 1}`);
  const prevVal = JSON.parse(fs.readFileSync(path.join(RDIR, `validate_round${round - 1}.json`), 'utf8'));
  const regs = REGIONS.filter((R) => !ONLY || ONLY.includes(R.id));
  log(`critique round ${round}: ${regs.length} parallel review+rewrite calls using stills from ${path.relative(ROOT, prevDir)}`);
  const recs = await Promise.all(regs.map((R) => forgeOne(R, round, async () => {
    const code = fs.readFileSync(path.join(OUT_DIR, `${R.id}.js`), 'utf8');
    const v = prevVal.regions?.[R.id] || {};
    const views = (REGION_VIEWS[R.id] || []).filter((x) => fs.existsSync(path.join(prevDir, `${x}.png`)));
    const parts = [textPart(await buildPrompt(R, `# REVIEW ROUND ${round}: your module below was rendered (headless Chromium, SwiftShader WebGL, 16:36 sun, environment sky).
The first two attached images are the aerial (see above); ${views.length ? `the renders follow: ${views.map((x, i) => `image ${i + 3} = view '${x}' (${VIEW_DESC[x]})`).join('; ')}. Other regions (written by other copies of you) are also visible.` : 'no renders are available for this round: review your module against the AERIAL (positions of forest edges, buildings, roads, driveways, fields) and against your brief, and correct it.'}
Node validation of your module: ${JSON.stringify({ tris: v.tris, budget: R.tris, bbox: v.bbox, warnings: v.warnings, buildMs: v.buildMs })}.

Task: act as a senior forensic-animation art director. Compare what YOUR region contributes in these stills with a
professional forensic animation (the quality standard above). List the concrete defects you see (floating/sunk
objects, z-fighting, wrong scale or placement vs the layout, missing elements from your brief, toy-like or untextured
surfaces, markings that are blurry/missing/wrong, vegetation that looks fake, holes, seams, anything off-brand for a
courtroom). Then return the COMPLETE corrected module that fixes them, same scope and contract, within budget.
Put the defect list as a comment block at the very top of the module:
// DEFECTS (round ${round}):
// 1. ... -> fix: ...
Current module:
\`\`\`js
${code}
\`\`\``))];
    parts.push(...aerialParts());
    for (const x of views) { const f = path.join(prevDir, `${x}.png`); if (fs.existsSync(f)) parts.push(imagePart(f)); }
    return parts;
  })));
  for (const rec of recs) {
    try {
      const src = fs.readFileSync(path.join(OUT_DIR, `${rec.id}.js`), 'utf8');
      const m = src.match(/\/\/ DEFECTS[\s\S]*?(?=\n(?!\/\/))/);
      if (m) fs.writeFileSync(path.join(RDIR, `${rec.id}.defects_round${round}.txt`), m[0]);
    } catch {}
  }
  fs.writeFileSync(path.join(RDIR, `critique_round${round}.json`), JSON.stringify(recs, null, 2));
  return recs;
}
const VIEW_DESC = {
  oblique: 'elevated oblique of the crossover from the south-east, ~95 m', eyeB: "Witness B eye height 1.6 m at (7.5,6.5) looking west up the EB approach toward the crest",
  r1: 'high oblique over the crossover looking north', r2: 'EB driver eye 1.2 m just east of the crest (x=-330) looking east down the grade to the intersection',
  r3: 'elevated view from x=40 looking east along the WB turn lane and east approach', r4: 'elevated view over the north roadside looking north-east',
  r5: 'elevated view of the store, apron and shelter from the north-west', r5b: 'elevated view of the post-impact area: poles, fences, residence (looking south-east from the road)',
  r6: 'high wide aerial of the whole site from the south-west',
};

async function cmdValidate(round) {
  const res = { at: new Date().toISOString(), regions: {}, totalTris: 0 };
  for (const R of REGIONS) {
    const f = path.join(OUT_DIR, `${R.id}.js`);
    if (!fs.existsSync(f)) { res.regions[R.id] = { ok: false, errors: ['missing'] }; continue; }
    const v = await validateModule(f, R);
    res.regions[R.id] = v; res.totalTris += v.tris || 0;
  }
  // whole-site through index.js (Node)
  try {
    const { THREE, assets } = await nodeAssets();
    const { buildSite } = await import(pathToFileURL(path.join(OUT_DIR, 'index.js')).href + '?v=' + Date.now());
    const site = buildSite(THREE, assets, { headless: true });
    res.site = { children: site.children.length, errors: site.userData.errors, tris: countTris(site), regions: site.userData.regions };
  } catch (e) { res.site = { error: String(e.stack || e).slice(0, 500) }; }
  res.underBudget = res.totalTris < 1.5e6;
  fs.writeFileSync(path.join(RDIR, `validate_round${round}.json`), JSON.stringify(res, null, 2));
  console.log(JSON.stringify({ totalTris: res.totalTris, underBudget: res.underBudget, site: res.site, regions: Object.fromEntries(Object.entries(res.regions).map(([k, v]) => [k, { ok: v.ok, tris: v.tris, errors: v.errors, warnings: v.warnings, bbox: v.bbox, ms: v.buildMs }])) }, null, 1));
  return res;
}

// ------------------------------------------------------------------ main
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const round = opt('round', '0');
  if (cmd === 'gen') await cmdGen();
  else if (cmd === 'prompt') { const R = REGIONS.find((r) => r.id === (opt('id') || 'r1_crossover')); console.log(await buildPrompt(R)); }
  else if (cmd === 'validate') await cmdValidate(round);
  else if (cmd === 'render') console.log(JSON.stringify(await renderStills({ round, views: opt('views') ? opt('views').split(',') : VIEWS, query: opt('query', '') }), null, 1));
  else if (cmd === 'critique') await cmdCritique();
  else { console.error('usage: gen|prompt|validate|render|critique'); process.exit(2); }
}
