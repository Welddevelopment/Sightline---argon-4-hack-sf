// argon/asset_forge.mjs — Gemini 4 Argon authors the Sightline visual asset library, one asset per call,
// then watches its own renders and fixes them (render -> Argon critiques the still -> corrected module, <= 2 rounds).
//
//   node argon/asset_forge.mjs [--assets sedan,suv] [--rounds 2] [--concurrency 6]      (live; needs GEMINI_API_KEY)
//   node argon/asset_forge.mjs --validate <module.js> <asset>                             (child: Node import + bbox check)
//   node argon/asset_forge.mjs --render-batch <jobs.json>                                 (child: run under scripts/render_lock.sh)
//
// Outputs: renders/asset_forge/work/<asset>.r<N>.js (+ .raw.txt, .meta.json), renders/asset_forge/<asset>_{current,r<N>}.png,
//          renders/asset_forge/<asset>_compare.png, renders/asset_forge/summary.json. Winners are copied to web/assets_argon/ by hand
//          after visual review (see status/asset_forge.md).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'renders', 'asset_forge');
const WORK = path.join(OUT, 'work');
const MODEL = process.env.ARGON_MODEL || 'gemini-4-argon';
const THINKING = Number(process.env.FORGE_THINKING || 6000);
const MAX_OUT = 32768;
const REF = '/tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/ref/argon_reference_review.md';

// ------------------------------------------------------------------ asset briefs (dims = target bbox, metres)
// dims: length = Z extent, width = X extent, height = Y extent. center: expected bbox centre [x,z] (default [0,0]).
const VEHICLE_API = `userData: assetType 'vehicle', vehicleType '<type>', dims, driverEye [x,y,z] (local eye point of a seated LEFT-hand-drive driver, x<0),
setLights(on:boolean) toggling emissive intensity of child meshes named exactly 'headlight_L','headlight_R','taillight_L','taillight_R' (L = -X side)
and optionally adding/showing SpotLight headlamp beams when on; userData.wheels = array of the wheel Object3Ds (each spins about its local X axle).
Name the side-mirror groups 'mirror_L'/'mirror_R': the target width EXCLUDES mirrors (mirrors may stick out up to 0.15 m each side).`;
const ASSETS = {
  sedan: { kind: 'vehicle', dims: [4.9, 1.9, 1.45], color: '#a9adb2', view: 'front34', current: ['vehicle', 'sedan'],
    brief: `Mid-size 4-door sedan (generic modern fastback-sedan proportions like a Tesla Model S / Accord class; NO brand). Overall 4.90 L x 1.90 W (body, without mirrors) x 1.45 H.
Wheelbase 2.96 m, front overhang 0.95 m, rear overhang 0.99 m, track 1.64 m, tires 245/45R19 (overall diameter 0.68 m, width 0.245), ground clearance 0.14 m, beltline ~0.98 m, roof peak ~1.45 m over the rear seats, long sloped windshield and fastback rear glass, trunk lid with integrated spoiler lip.
Details: 4 doors with panel gaps and flush/pull door handles, A/B/C pillars (B pillar gloss black), side mirrors on the doors, frameless-looking side glass with dark interior visible (seats, headrests, steering wheel, dashboard silhouette), swept LED headlight clusters, full-width or split LED taillights, lower front intake with mesh, front & rear bumpers, blank license plate recesses (front and rear), 5-spoke or multi-spoke alloy rims with brake discs and calipers, tire sidewalls + tread grooves, side sill, underbody dark.
${VEHICLE_API}` },
  suv: { kind: 'vehicle', dims: [4.8, 1.95, 1.75], color: '#1d3f7a', view: 'front34', current: ['vehicle', 'suv'],
    brief: `Mid-size 2-row crossover SUV (generic RAV4 / CR-V / Model Y class; NO brand). Overall 4.80 L x 1.95 W (body, without mirrors) x 1.75 H (incl. roof rails).
Wheelbase 2.85 m, front overhang 0.93 m, rear overhang 1.02 m, track 1.65 m, tires 235/60R18 (diameter 0.74 m), ground clearance 0.21 m, beltline ~1.10 m, near-vertical liftgate with rear spoiler, upright greenhouse with D-pillar.
Details: black plastic wheel-arch and rocker cladding, roof rails, 4 doors + liftgate with panel gaps, door handles, mirrors, rear quarter glass, dark interior visible, LED headlights + tall wrap-around taillights, large grille + lower intake + skid plate, bumpers, blank plate recesses, alloy rims + brakes, tread.
${VEHICLE_API}` },
  pickup: { kind: 'vehicle', dims: [5.9, 2.0, 1.9], color: '#e9eaea', view: 'front34', current: ['vehicle', 'pickup'],
    brief: `Full-size crew-cab pickup with short bed (generic F-150 / Silverado class; NO brand). Overall 5.90 L x 2.00 W (body, without mirrors) x 1.90 H.
Wheelbase 3.68 m, front overhang 0.98 m, rear overhang 1.24 m, track 1.72 m, tires 275/65R18 (diameter 0.82 m, width 0.275), ground clearance 0.24 m. Tall flat hood (leading edge ~1.25 m), big upright grille, separate cab (4 doors) and cargo bed (inside length 1.70 m, bed rail height ~1.30 m, open box with floor, wheel-well humps, tailgate with handle, bed rail caps), gap between cab and bed.
Details: large towing mirrors, door handles, running boards/side steps, chrome or body-colour bumpers, rear step bumper with trailer hitch receiver, vertical taillights at the bed corners, LED headlights, fender flares, dark interior through glass, rear sliding window, 6-lug alloy rims, all-terrain tread.
${VEHICLE_API}` },
  truck_tractor: { kind: 'vehicle', dims: [6.5, 2.5, 3.6], color: '#9b1b1e', view: 'front34', current: ['vehicle', 'truck_tractor'],
    brief: `Class 8 conventional (long-hood, NOT cab-over) day-cab truck tractor, 3 axles 6x4 (generic Freightliner Cascadia / Kenworth T680 class; NO brand). Overall 6.50 L x 2.50 W (body/fenders, without mirrors) x 3.60 H (top of roof fairing).
Front bumper at z=-3.25. Steer axle 1.25 m behind the front bumper; tandem drive axles centred 5.05 m behind the front bumper (spacing 1.32 m); tires 295/75R22.5 (diameter 1.03 m, width 0.30), DUAL tires on both drive axles, single on steer. Aerodynamic sloped hood (top ~2.0 m), large grille, cab back at ~z=+0.7, roof fairing above cab, chassis frame rails (0.27 m deep, 0.86 m apart, top at ~1.1 m) exposed behind the cab with the fifth-wheel plate (top 1.22 m) centred at z=+1.9.
Details: chrome/aluminium fuel tanks + steps under the doors, DPF/aftertreatment box, vertical exhaust stack(s) behind cab, air intake, cab doors with handles and grab handles, large west-coast + hood mirrors, windshield (split or one-piece) with wipers, sun visor, headlights in the hood corners, amber cab marker lights on the roof, rear mud flaps, drive-wheel fenders/quarter fenders, aluminium disc wheels (10 stud), aggressive tread.
Extra userData: fifthWheel = [0, 1.22, 1.9] (local pivot point).
${VEHICLE_API}` },
  semitrailer_box: { kind: 'vehicle', dims: [16.2, 2.6, 4.1], color: '#e9eaea', view: 'rear34', current: ['vehicle', 'semitrailer'],
    brief: `53-ft dry-van box semitrailer (generic; NO brand). Overall 16.20 L x 2.60 W x 4.10 H. Nose at z=-8.1, rear doors at z=+8.1.
Floor underside ~1.17 m above ground, box from y~1.2 to 4.1. Kingpin 0.91 m behind the nose at height 1.22 (upper coupler plate). Landing-gear legs with sand shoes ~3.3 m behind the kingpin (z≈-3.9), crank handle. Sliding tandem axle group at the REAR: axles at z≈+5.55 and +6.80, DUAL tires 295/75R22.5 (diameter 1.03 m) on each side, spring/air suspension hangers, slider rails.
CRITICAL forensic details: (1) the SIDE UNDERRIDE GAP — the side is OPEN (no side skirts) between landing gear and tandem: you must see the longitudinal main rails and transverse floor cross-members (every ~0.3 m) underneath, with daylight through the gap; (2) rear impact (ICC/underride) guard: horizontal steel bumper ~0.10x0.20 m spanning the width, bottom edge 0.50 m above ground, set ~0.25 m forward of the rear, on vertical struts; (3) red/white DOT-C2 retroreflective conspicuity tape: alternating 0.3 m red / 0.45 m white segments along the lower side rail and an outline on the rear doors/upper corners; (4) amber side marker lights mid-length and red rear lamps.
Body: aluminium sheet-and-post sides (vertical posts every ~0.6 m as slightly raised strips and rivet lines), top and bottom rails, front corner caps, rear frame with two swing doors, 4 vertical locking bars with cam keepers and handles, hinges, rear light bar (taillights taillight_L/_R + 3 ID lights), mud flaps behind tandem, aluminium or steel wheels. Headlights do not exist on a trailer — omit headlight_* (setLights toggles tail + marker lamps).
Extra userData: kingpinOffset = -7.19 (local z of the kingpin), kingpin = [0, 1.22, -7.19].
${VEHICLE_API}` },
  signal_mast: { kind: 'object', dims: [0.9, 9.6, 7.5], center: [4.35, 0], absTol: 0.25, view: 'signal', current: ['signal', { heads: 2, armLength: 9, id: 'signal_mast' }],
    brief: `US mast-arm traffic signal assembly. ORIGIN = centre of the pole base (pole axis at x=0,z=0), NOT the footprint centre; the mast arm reaches along +X. Bounding box: X from about -0.45 (foundation) to +9.15, Z within ±0.45, Y 0 to 7.5.
Concrete foundation 0.85 m diameter, 0.2 m above grade, anchor-bolt base plate with nut covers; galvanized steel tapered round pole (0.33 m base dia → 0.23 m top) to 7.5 m with a cap; tapered round mast arm 9.0 m long attached at y=6.1 m with a clamp/flange box, rising slightly (~2°) toward the tip, plus an upper tie/truss rod for the long arm.
Two 3-section vehicle signal heads (12 in / 300 mm lenses: red top, yellow middle, green bottom) hung on rigid mounts under the arm at x=5.4 and x=8.5, bottom of each head ≥ 5.0 m above road; yellow (or black) polycarbonate housing ~0.36 W x 1.1 H x 0.25 D, deep cut-away TUNNEL VISORS over every lens, flat black backplate with 50 mm yellow retroreflective border, lenses face -Z. A street-name blade sign (blank green, white border, no text) on the arm near x=3.5; pedestrian push-button + small signal box on the pole at 1.1 m; handhole near the base.
userData: assetType 'signal', heads (array of head groups), setState('red'|'yellow'|'green'|'off') — the active lens glows (emissive, intensity ≥ 3) and the others are dark-tinted but visibly coloured; default state 'red'.` },
  bus_shelter: { kind: 'object', dims: [1.5, 3.5, 2.5], absTol: 0.15, view: 'front34', current: ['shelter', { id: 'bus_shelter' }],
    brief: `Municipal bus shelter, 3.50 W (X) x 1.50 D (Z) x 2.50 H, OPEN side facing -Z (the street). Origin = centre of the footprint at grade.
Anodized aluminium extruded frame (dark bronze/black, 80 mm posts), tempered glass back wall and two end panels with VISIBLE THICKNESS (12 mm) and slight green edge tint, mostly see-through (important: the shelter is a sight-line occluder in crash cases, so glass must read as glass, with a dotted frit band at ~1.4 m), roof canopy with slight back-fall and a deep fascia overhanging the front ~0.2 m, gutter, an illuminated advertising panel at one end (blank light-box, no text), perforated metal bench (0.45 m seat height) with armrests, a small route-info frame, a trash receptacle, concrete pad 0.1 m.
userData: assetType 'shelter', open (true).` },
  utility_pole: { kind: 'object', dims: [0.5, 2.44, 10.7], absTol: 0.25, view: 'pole', current: ['pole', { height: 10.5, id: 'utility_pole' }],
    brief: `Wooden distribution utility pole (Class 3, 40 ft, set 1.8 m deep) → 10.5 m above grade, top insulator to ~10.7 m. Origin = pole axis at grade.
Pole: tapered round, 0.32 m diameter at groundline → 0.22 m at top, weathered creosote/penta brown-grey with vertical wood grain + checking cracks (procedural texture), slightly darker band near the ground, roof-cut top. 8-ft (2.44 m) wooden crossarm (0.09 x 0.11 m) 0.55 m below the top on the -Z face, galvanized steel V-braces, 3 porcelain/polymer pin insulators on the arm + 1 top insulator, a secondary/neutral spool rack at ~8.4 m, a telecom cable clamp at ~6.2 m, copper/galv ground wire running down the pole, aluminium pole ID tag at 1.8 m, climbing-step holes (optional), short conductor stubs (≤ 0.4 m) leaving the insulators (no long wires). opts.transformer (default false) adds a 25 kVA pole-top transformer can on the +Z side.
userData: assetType 'pole', attach (array of local [x,y,z] wire attachment points).` },
  oak_tree: { kind: 'object', dims: [10, 10, 9], view: 'tree', current: ['tree', { kind: 'oak', height: 9, id: 'oak_tree' }],
    brief: `Mature southern live oak / red oak, 9.0 m tall, crown spread 10 m (both X and Z extents ≈ 10 m), crown base ~2.5 m. Origin = trunk base at grade. opts.height (default 9) scales everything uniformly; opts.seed varies shape deterministically.
Trunk 0.6 m diameter at breast height with root flare and furrowed dark-grey bark (procedural bark texture), dividing at 2–2.8 m into 3–5 major sinuous limbs that branch recursively (tapered TubeGeometry along curves) — branch structure must be visible through gaps in the canopy. Foliage: MANY leaf clusters (e.g. InstancedMesh of crossed leaf-card quads with an alpha-tested canvas leaf texture, alphaTest 0.5, side DoubleSide; or thousands of small instanced leaf blobs) placed around branch tips, forming a broad irregular dome with depth, holes and self-shadowing; slight colour variation (dark olive to fresh green, instance colours). NOT a few smooth spheres.
userData: assetType 'tree', kind 'oak'.` },
  pine_tree: { kind: 'object', dims: [6, 6, 18], view: 'tree', current: ['tree', { kind: 'pine', height: 18, id: 'pine_tree' }],
    brief: `Mature southern pine (slash / loblolly pine), 18 m tall, crown spread 6 m (X and Z ≈ 6 m). Origin = trunk base at grade. opts.height (default 18) scales; opts.seed varies shape.
Straight slightly-tapering trunk 0.45 m DBH with reddish-brown PLATED bark (procedural texture with plates and dark fissures), clear of branches to ~10–11 m except a few dead branch stubs; open, irregular rounded-flat crown of upward-curving branches ending in dense tufts of long needles (instanced needle-tuft cards or radial needle-cone clusters with alpha texture, dark yellow-green); visible gaps between branch whorls; some sparse lower dead stubs.
userData: assetType 'tree', kind 'pine'.` },
  road_surface_material: { kind: 'material', view: 'material', current: ['surface', 'asphalt'],
    brief: `Return a THREE.MeshStandardMaterial (not an Object3D) for an aged dense-graded asphalt road surface (US highway, 3–6 years old). The geometry it is applied to has UVs in METRES (1 UV unit = 1 m), so set texture.repeat = 1/tileMeters (opts.tileMeters default 4) with RepeatWrapping.
Build map (albedo, medium-dark grey, albedo ~0.12–0.18 with lighter oxidized grey binder and exposed light aggregate chips 2–12 mm), normalMap (aggregate relief + hairline cracks), roughnessMap (0.8–0.95, slightly smoother polished wheel-path streak along V), all from ONE procedural height/colour field so they line up; no visible tile seams (make the noise periodic), no obvious repetition at 4 m. Include sparse sealed crack lines (tar snakes, darker, glossier) and subtle oil-stain mottling. Use DataTexture (works in Node and browser) or lazy canvas. Texture resolution 1024. Set colorSpace = THREE.SRGBColorSpace on map only; anisotropy 8.
material.name = 'argon_asphalt'; material.userData.assetType = 'material'; material.userData.tileMeters.` },
  grass_material: { kind: 'material', view: 'material', current: ['surface', 'grass'],
    brief: `Return a THREE.MeshStandardMaterial (not an Object3D) for mowed roadside turf (Florida bahia / St. Augustine grass verge, late afternoon summer). The geometry has UVs in METRES; opts.tileMeters default 3, texture.repeat = 1/tileMeters, RepeatWrapping.
Build map (albedo: blade-scale streaks and clumps of mixed greens from dark blue-green to yellow-green, scattered dry straw-coloured patches, a few clover/weed dots, bits of sandy soil showing), normalMap (blade/clump relief), roughnessMap (~0.9–1.0), from one periodic procedural field so they align; seamless, no visible repetition at 3 m; large-scale low-frequency colour variation over ~1–3 m so a large field is not uniform. Resolution 1024; map in SRGBColorSpace; anisotropy 8.
material.name = 'argon_grass'; material.userData.assetType = 'material'; material.userData.tileMeters.` },
  gas_station_canopy: { kind: 'object', dims: [12, 24, 5.6], absTol: 0.3, view: 'canopy', current: ['box', [12, 24, 5.6]],
    brief: `Gas/fuel station forecourt canopy (generic, NO brand, no text). Canopy 24.0 m along X x 12.0 m along Z, top of fascia 5.6 m, underside (clearance) 4.6 m. Origin = centre of the footprint at grade.
Flat steel-framed canopy with a 0.9 m tall continuous fascia band (white ACM panels with one coloured horizontal accent stripe and rounded corners), flat soffit underneath with a grid of recessed square LED canopy lights (emissive panels), 4 square columns (0.45 m, clad in brushed metal or ACM, with concrete bases/bollard guards) positioned on two fuel islands. Two raised concrete fuel islands (0.15 m high, 1.2 W x 8 L, rounded ends) running along X under the canopy, each with 2 fuel dispensers (multi-product pump cabinets ~1.0 W x 0.6 D x 2.2 H with display panels, nozzles/hoses holstered on both faces), yellow steel bollards at island ends, trash/squeegee stands, concrete forecourt pad (24 x 12 m slab, 0.02 m, light grey with saw-cut joints). Roof drain downpipes inside two columns.
userData: assetType 'canopy', setLights(on) toggles the LED soffit lights (emissive + optional RectArea-free SpotLights/PointLights).` },
  pedestrian: { kind: 'object', dims: [0.3, 0.5, 1.7], absTol: 0.1, view: 'pedestrian', color: '#3b5b8a', current: ['vehicle', 'pedestrian'],
    brief: `Adult pedestrian, 1.70 m tall (opts.height default 1.7 scales uniformly), standing at ease facing -Z, arms relaxed at the sides slightly bent, feet slightly apart. Origin = between the feet at grade.
Realistic human proportions (head ≈ 1/7.5 of height, shoulders ~0.44 m wide, hips ~0.36 m), smooth organic forms (LatheGeometry / tapered capsules for torso, limbs; shaped hands; head with neck, nose, ears, hair cap) — NOT a mannequin of spheres and cylinders, NOT a Lego figure. Clothing: shirt/jacket in opts.color (default '#3b5b8a') with collar and sleeves, dark jeans, sneakers with white soles, skin tone opts.skin (default '#c58c64'), short dark hair. opts.pose 'standing' | 'walking' (mid-stride, arms swinging).
userData: assetType 'pedestrian', height, eyeHeight = height*0.93 (eye point local [0, eyeHeight, -0.08]).` },
};
export const ASSET_NAMES = Object.keys(ASSETS);

// camera framing per view: [targetX, targetY, targetZ, azimuthDeg (0 = from -Z/front, 90 = from -X/left), elevationDeg, distance]
function framing(name) {
  const a = ASSETS[name];
  const [L, W, H] = a.dims || [0, 0, 0];
  const R = Math.hypot(L, W, H) / 2;
  const fov = 35 * Math.PI / 180;
  const fit = (r, k = 1.08) => (r / Math.sin(fov / 2)) * k * 0.68;
  switch (a.view) {
    case 'front34': return { t: [0, H * 0.42, 0], az: 38, el: 14, d: fit(R) };
    case 'rear34': return { t: [0, H * 0.42, 0.5], az: 145, el: 12, d: fit(R, 0.95) };
    case 'signal': return { t: [4.3, 3.9, 0], az: 28, el: 7, d: 19.5 };
    case 'pole': return { t: [0, 6.2, 0], az: 35, el: 8, d: 16 };
    case 'tree': return { t: [0, H * 0.47, 0], az: 35, el: 6, d: fit(R, 1.02) };
    case 'canopy': return { t: [0, 2.6, 0], az: 30, el: 16, d: 34 };
    case 'pedestrian': return { t: [0, 0.88, 0], az: 30, el: 6, d: 4.2 };
    case 'material': return { t: [0, 0, -3.5], az: 0, el: 22, d: 9.5, material: true };
    default: return { t: [0, H / 2, 0], az: 35, el: 12, d: fit(R) };
  }
}

// ------------------------------------------------------------------ helpers
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
function extractCode(text) {
  const re = /```(?:js|javascript|mjs)?\s*\n([\s\S]*?)```/gi;
  let best = null, m;
  while ((m = re.exec(text))) if (!best || m[1].length > best.length) best = m[1];
  if (best) return best.trim() + '\n';
  throw new Error('no complete ```js block in output');
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

let _ai = null;
async function ai() {
  if (_ai) return _ai;
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
  const { GoogleGenAI } = await import('@google/genai');
  _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { timeout: 15 * 60 * 1000 } });
  return _ai;
}

async function callArgon(parts, tag) {
  const client = await ai();
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const t0 = Date.now();
    try {
      const stream = await client.models.generateContentStream({
        model: MODEL, contents: [{ role: 'user', parts }],
        config: { maxOutputTokens: MAX_OUT, thinkingConfig: { thinkingBudget: THINKING }, httpOptions: { timeout: 15 * 60 * 1000 } },
      });
      let raw = '', finish = null, usage = null;
      for await (const ch of stream) { raw += ch.text || ''; finish = ch.candidates?.[0]?.finishReason || finish; usage = ch.usageMetadata || usage; }
      const seconds = +((Date.now() - t0) / 1000).toFixed(1);
      log(`[argon] ${tag}: ${seconds}s finish=${finish} chars=${raw.length} out=${usage?.candidatesTokenCount} think=${usage?.thoughtsTokenCount}`);
      if (!raw.trim()) throw new Error(`empty response (finish=${finish})`);
      return { raw, finish, usage, seconds };
    } catch (e) {
      lastErr = e;
      log(`[argon] ${tag}: attempt ${attempt + 1} failed: ${String(e.message || e).slice(0, 200)}`);
      await sleep(5000 * (attempt + 1));
    }
  }
  throw lastErr;
}

function refNotes() {
  try { return fs.readFileSync(REF, 'utf8'); } catch { return null; }
}

function basePrompt(name, ref) {
  const a = ASSETS[name];
  const sys = fs.readFileSync(path.join(ROOT, 'argon', 'prompts', 'asset_forge.md'), 'utf8');
  const dimTxt = a.dims ? `Target bounding box: length (Z) ${a.dims[0]} m, width (X) ${a.dims[1]} m, height (Y) ${a.dims[2]} m — the rendered bbox is checked to within 5%.` : 'Returns a Material (no bounding box).';
  return `${sys}\n${ref ? `\n## Reference standard (review of paid forensic crash animations — match this level)\n${ref.trim()}\n(Our constraints override the reference where they conflict: everything is procedural code — no .glb downloads, no glass transmission, no post-processing. Use it for the level of DETAIL and realism expected.)\n` : ''}
## THE ASSET: \`${name}\`
${dimTxt}
${a.brief}
Default opts.color: '${a.color || 'appropriate real-world colour'}'.`;
}

// ------------------------------------------------------------------ child: validate in Node
async function validateChild(file, name) {
  const a = ASSETS[name];
  const THREE = await import('three');
  const src = fs.readFileSync(file, 'utf8');
  const res = { ok: false, errors: [], warnings: [] };
  if (/^\s*import\s|\bimport\s*\(|\brequire\s*\(|\bfetch\s*\(|\beval\s*\(/m.test(src)) res.errors.push('forbidden import/require/fetch/eval');
  let mod;
  try { mod = await import(pathToFileURL(file).href + '?v=' + Date.now()); } catch (e) { res.errors.push('import failed: ' + e.message); return res; }
  if (typeof mod.default !== 'function') { res.errors.push('no default export function'); return res; }
  const t0 = performance.now();
  let obj;
  try { obj = mod.default(THREE, { id: name + '_1', color: a.color }); } catch (e) { res.errors.push('create() threw in Node: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); return res; }
  res.buildMs = +(performance.now() - t0).toFixed(1);
  if (a.kind === 'material') {
    if (!obj || !obj.isMaterial) res.errors.push('create() must return a THREE.Material');
    else res.material = { type: obj.type, name: obj.name, hasMap: !!obj.map, hasNormal: !!obj.normalMap, hasRough: !!obj.roughnessMap };
    res.ok = res.errors.length === 0; return res;
  }
  if (!obj || !obj.isObject3D) { res.errors.push('create() must return a THREE.Object3D'); return res; }
  obj.updateMatrixWorld(true);
  let tris = 0, meshes = 0, nan = false;
  const box = new THREE.Box3(), boxNoMirror = new THREE.Box3();
  const names = new Set();
  obj.traverse((o) => {
    if (o.name) names.add(o.name);
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry; if (!g || !g.attributes.position) return;
    const cnt = o.isInstancedMesh ? o.count : 1;
    tris += ((g.index ? g.index.count : g.attributes.position.count) / 3) * cnt;
    const arr = g.attributes.position.array; for (let i = 0; i < Math.min(arr.length, 3000); i++) if (!Number.isFinite(arr[i])) { nan = true; break; }
  });
  box.setFromObject(obj, true);
  // bbox excluding mirrors
  const mirrors = []; obj.traverse((o) => { if (/^mirror/i.test(o.name || '')) mirrors.push(o); });
  const isUnderMirror = (o) => { for (let p = o; p; p = p.parent) if (mirrors.includes(p)) return true; return false; };
  obj.traverse((o) => { if (o.isMesh && !isUnderMirror(o)) { const b = new THREE.Box3().setFromObject(o, true); if (!b.isEmpty()) boxNoMirror.union(b); } });
  const B = mirrors.length ? boxNoMirror : box;
  const size = B.getSize(new THREE.Vector3()), c = B.getCenter(new THREE.Vector3());
  res.tris = Math.round(tris); res.meshes = meshes;
  res.bbox = { min: B.min.toArray().map((v) => +v.toFixed(3)), max: B.max.toArray().map((v) => +v.toFixed(3)), size: { length: +size.z.toFixed(3), width: +size.x.toFixed(3), height: +size.y.toFixed(3) } };
  if (nan) res.errors.push('NaN in geometry');
  const [L, W, H] = a.dims; const abs = a.absTol || 0;
  const chk = (lbl, got, want) => { const tol = Math.max(want * 0.05, abs); if (Math.abs(got - want) > tol) res.errors.push(`${lbl} ${got.toFixed(2)} m vs target ${want} m (tol ±${tol.toFixed(2)})`); };
  chk('length(Z)', size.z, L); chk('width(X)', size.x, W); chk('height(Y)', size.y, H);
  if (Math.abs(B.min.y) > 0.05) res.errors.push(`bbox min.y = ${B.min.y.toFixed(3)} (asset must sit on y=0)`);
  const [cx, cz] = a.center || [0, 0];
  if (Math.abs(c.x - cx) > Math.max(W * 0.05, 0.1)) res.errors.push(`bbox centre x = ${c.x.toFixed(2)}, expected ${cx}`);
  if (Math.abs(c.z - cz) > Math.max(L * 0.05, 0.1)) res.errors.push(`bbox centre z = ${c.z.toFixed(2)}, expected ${cz}`);
  const ud = obj.userData || {};
  if (!ud.assetType) res.errors.push('missing userData.assetType');
  if (!ud.dims) res.errors.push('missing userData.dims');
  if (obj.name !== name + '_1') res.warnings.push(`name is "${obj.name}", expected opts.id`);
  if (a.kind === 'vehicle') {
    if (typeof ud.setLights !== 'function') res.errors.push('missing userData.setLights');
    if (!Array.isArray(ud.driverEye) && name !== 'semitrailer_box') res.errors.push('missing userData.driverEye');
    const need = name === 'semitrailer_box' ? ['taillight_L', 'taillight_R'] : ['headlight_L', 'headlight_R', 'taillight_L', 'taillight_R'];
    for (const n of need) if (!names.has(n)) res.errors.push(`missing child mesh named ${n}`);
    try { ud.setLights && ud.setLights(true); ud.setLights && ud.setLights(false); } catch (e) { res.errors.push('setLights threw: ' + e.message); }
  }
  if (name === 'signal_mast') { if (typeof ud.setState !== 'function') res.errors.push('missing userData.setState'); else { try { for (const s of ['red', 'yellow', 'green', 'off']) ud.setState(s); } catch (e) { res.errors.push('setState threw: ' + e.message); } } }
  if (name === 'pedestrian' && !(ud.eyeHeight > 1.4)) res.errors.push('missing/invalid userData.eyeHeight');
  const budget = a.kind === 'vehicle' ? 150000 : 80000;
  if (tris > budget * 1.5) res.errors.push(`triangle count ${Math.round(tris)} exceeds budget ${budget}`);
  else if (tris > budget) res.warnings.push(`triangle count ${Math.round(tris)} above budget ${budget}`);
  if (res.buildMs > 1500) res.warnings.push(`slow build ${res.buildMs} ms`);
  res.ok = res.errors.length === 0;
  return res;
}

function runValidate(file, name) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [fileURLToPath(import.meta.url), '--validate', file, name], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const to = setTimeout(() => { p.kill('SIGKILL'); }, 60000);
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => {
      clearTimeout(to);
      const line = out.trim().split('\n').pop();
      try { resolve(JSON.parse(line)); } catch { resolve({ ok: false, errors: [`validator crashed (code ${code}): ${(err || out).slice(-600)}`] }); }
    });
  });
}

// ------------------------------------------------------------------ child: render batch (Chromium)
function staticServer() {
  const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, base: `http://127.0.0.1:${srv.address().port}` })));
}

async function renderBatchChild(jobsFile) {
  const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
  const { launchBrowser } = await import('../render/record.js');
  const { srv, base } = await staticServer();
  const browser = await launchBrowser();
  const results = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    for (const j of jobs) {
      const t0 = Date.now();
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
      const q = new URLSearchParams({ asset: j.asset, mode: j.mode, src: j.src || '', cfg: JSON.stringify(j.cfg) });
      let info = null;
      try {
        await page.goto(`${base}/web/assets_argon/studio.html?${q}`, { waitUntil: 'load', timeout: 120000 });
        await page.waitForFunction(() => window.__done, null, { timeout: 240000 });
        info = await page.evaluate(() => window.__done);
        await page.screenshot({ path: j.out, timeout: 120000 });
      } catch (e) { errs.push('render failed: ' + String(e.message || e).slice(0, 300)); }
      await page.close();
      results.push({ out: j.out, ok: fs.existsSync(j.out) && !!info && info.ok, info, errors: errs, seconds: (Date.now() - t0) / 1000 });
      console.error(`[render] ${path.basename(j.out)} ${((Date.now() - t0) / 1000).toFixed(1)}s ${errs.length ? 'errs=' + errs.length : ''}`);
    }
  } finally { await browser.close(); srv.close(); }
  fs.writeFileSync(jobsFile.replace(/\.json$/, '.out.json'), JSON.stringify(results, null, 2));
}

function runLockedOnce(jf) {
  const outF = jf.replace(/\.json$/, '.out.json');
  try { fs.unlinkSync(outF); } catch {}
  return new Promise((resolve) => {
    const p = spawn(path.join(ROOT, 'scripts', 'render_lock.sh'), [process.execPath, fileURLToPath(import.meta.url), '--render-batch', jf], { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('close', (code) => {
      let r = null; try { r = JSON.parse(fs.readFileSync(outF, 'utf8')); } catch {}
      resolve(r);
    });
  });
}
// The shared lock times out after 10 min (many agents queue on it): retry until each chunk actually ran.
// Chunks of <= 7 stills so we never hold the lock for long.
async function runRenderBatch(jobs, tag) {
  if (!jobs.length) return [];
  for (const j of jobs) try { fs.unlinkSync(j.out); } catch {}
  const all = [];
  for (let c = 0; c * 7 < jobs.length; c++) {
    const chunk = jobs.slice(c * 7, c * 7 + 7);
    const jf = path.join(WORK, `jobs_${tag}_${c}.json`);
    fs.writeFileSync(jf, JSON.stringify(chunk, null, 2));
    let r = null;
    for (let attempt = 1; attempt <= 8 && !r; attempt++) {
      log(`[render] batch ${tag}.${c}: ${chunk.length} stills (waiting for render lock, attempt ${attempt})`);
      r = await runLockedOnce(jf);
      if (!r) await sleep(3000);
    }
    log(`[render] batch ${tag}.${c}: ${r ? r.filter((x) => x.ok).length + '/' + chunk.length + ' ok' : 'FAILED (lock)'}`);
    if (r) all.push(...r);
  }
  return all;
}

// ------------------------------------------------------------------ main pipeline
async function main(args) {
  const names = (args.assets ? args.assets.split(',') : ASSET_NAMES).filter((n) => ASSETS[n]);
  const rounds = Number(args.rounds ?? 2);
  const conc = Number(args.concurrency ?? 6);
  fs.mkdirSync(WORK, { recursive: true });
  const T0 = Date.now();

  // reference notes: wait up to 3 min
  let ref = refNotes();
  for (let i = 0; !ref && i < 36 && !args.noRefWait; i++) { if (i === 0) log('waiting up to 3 min for reference review notes...'); await sleep(5000); ref = refNotes(); }
  log(ref ? `reference notes: ${ref.length} chars` : 'reference notes: not found, continuing without');

  const state = Object.fromEntries(names.map((n) => [n, { asset: n, rounds: [], tokens: { prompt: 0, output: 0, thoughts: 0, total: 0 }, seconds: 0 }]));
  const addUsage = (s, r) => { const u = r.usage || {}; r.seconds = r.seconds || 0; s.tokens.prompt += u.promptTokenCount || 0; s.tokens.output += u.candidatesTokenCount || 0; s.tokens.thoughts += u.thoughtsTokenCount || 0; s.tokens.total += u.totalTokenCount || 0; s.seconds += r.seconds; };

  async function generate(name, round, prev) {
    const s = state[name];
    const file = path.join(WORK, `${name}.r${round}.js`);
    const parts = [{ text: basePrompt(name, ref) }];
    if (round > 0) {
      const a = ASSETS[name];
      parts.push({ text: `\n## ROUND ${round} — watch your render and fix it\nBelow is your previous module and a 960x540 render of it (${a.kind === 'material' ? 'applied to a 16 x 16 m ground patch with metre UVs, camera ~3.5 m high looking down the patch; 1 m grid around it' : 'neutral studio, 1 m grid on the floor, 3/4 view'}).
Compare it with a real ${name.replace(/_/g, ' ')} and with a professional forensic crash animation (paid studio standard). List the defects you see (proportions, silhouette, missing parts, wrong materials, scale, artefacts, anything toy-like), most important first, then return the corrected FULL module.
Automated validation of the previous module: ${JSON.stringify({ ok: prev.validation.ok, errors: prev.validation.errors, warnings: prev.validation.warnings, bbox: prev.validation.bbox?.size, tris: prev.validation.tris })}
Browser render: ${prev.render ? JSON.stringify({ ok: prev.render.ok, errors: prev.render.errors?.slice(0, 6), info: prev.render.info }) : 'not rendered'}
### previous module
\`\`\`js
${prev.code}
\`\`\`` });
      if (prev.render?.ok && fs.existsSync(prev.png)) parts.push({ inlineData: { mimeType: 'image/png', data: fs.readFileSync(prev.png).toString('base64') } });
    }
    const rec = { round, file, png: path.join(OUT, `${name}_r${round}.png`) };
    const metaF = file.replace(/\.js$/, '.meta.json');
    if (args.resume && fs.existsSync(file) && fs.existsSync(metaF)) {
      const m = JSON.parse(fs.readFileSync(metaF, 'utf8'));
      if (!m.error) {
        Object.assign(rec, { finish: m.finish, usage: m.usage, seconds: m.seconds, defects: m.defects, resumed: true });
        addUsage(s, m);
        rec.code = fs.readFileSync(file, 'utf8');
        rec.validation = await runValidate(file, name);
        log(`[forge] ${name} r${round}: resumed valid=${rec.validation.ok}`);
        s.rounds.push(rec);
        return rec;
      }
    }
    try {
      const r = await callArgon(parts, `${name} r${round}`);
      addUsage(s, r);
      Object.assign(rec, { finish: r.finish, usage: r.usage, seconds: r.seconds });
      fs.writeFileSync(file.replace(/\.js$/, '.raw.txt'), r.raw);
      rec.code = extractCode(r.raw);
      rec.defects = round > 0 ? r.raw.slice(0, r.raw.indexOf('```')).trim().slice(0, 3000) : null;
      fs.writeFileSync(file, rec.code);
      rec.validation = await runValidate(file, name);
    } catch (e) {
      rec.error = String(e.message || e);
      rec.validation = { ok: false, errors: [rec.error] };
    }
    fs.writeFileSync(file.replace(/\.js$/, '.meta.json'), JSON.stringify({ ...rec, code: undefined }, null, 2));
    log(`[forge] ${name} r${round}: ${rec.code ? 'code ' + rec.code.length + ' chars' : 'NO CODE'} valid=${rec.validation.ok} ${rec.validation.errors?.slice(0, 3).join('; ') || ''}`);
    s.rounds.push(rec);
    return rec;
  }

  const jobFor = (name, rec, mode) => {
    const a = ASSETS[name];
    const cfg = { ...framing(name), kind: a.kind, dims: a.dims, color: a.color, current: a.current };
    if (mode === 'current') return { asset: name, mode, cfg, out: path.join(OUT, `${name}_current.png`) };
    return { asset: name, mode, cfg, src: '/' + path.relative(ROOT, rec.file) + '?v=' + Date.now(), out: rec.png };
  };

  // round 0: generate all
  let cur = await pool(names, conc, (n) => generate(n, 0, null));
  let jobs = [];
  names.forEach((n, i) => { jobs.push(jobFor(n, null, 'current')); if (cur[i].code && !cur[i].error) jobs.push(jobFor(n, cur[i], 'argon')); });
  let rr = await runRenderBatch(jobs, 'r0');
  const attach = (recs, results) => recs.forEach((rec) => { if (rec) rec.render = results.find((x) => x.out === rec.png) || null; });
  attach(cur, rr);
  names.forEach((n) => { state[n].currentRender = rr.find((x) => x.out === path.join(OUT, `${n}_current.png`)) || null; });

  for (let round = 1; round <= rounds; round++) {
    // previous = last round that produced code (fall back further if this one failed to produce code)
    const prevs = names.map((n) => [...state[n].rounds].reverse().find((r) => r.code));
    const todo = names.filter((n, i) => prevs[i]);
    const recs = await pool(todo, conc, (n) => generate(n, round, prevs[names.indexOf(n)]));
    rr = await runRenderBatch(recs.filter((r) => r.code && !r.error).map((r) => jobFor(path.basename(r.file).split('.r')[0], r, 'argon')), 'r' + round);
    attach(recs, rr);
  }

  // pick final Argon version per asset: latest round that validated and rendered; else latest that rendered
  const summary = [];
  for (const n of names) {
    const s = state[n];
    const good = [...s.rounds].reverse();
    const fin = good.find((r) => r.validation?.ok && r.render?.ok) || good.find((r) => r.render?.ok) || null;
    s.final = fin ? fin.round : null;
    if (fin) {
      const cmp = path.join(OUT, `${n}_compare.png`);
      const curPng = path.join(OUT, `${n}_current.png`);
      const py = `
import sys
from PIL import Image, ImageDraw, ImageFont
a, b, out, la, lb = sys.argv[1:6]
def load(p):
    try: return Image.open(p).convert('RGB').resize((960, 540))
    except Exception: im = Image.new('RGB', (960, 540), (60, 60, 60)); return im
A, B = load(a), load(b)
W = Image.new('RGB', (1920 + 8, 540 + 40), (20, 22, 26))
W.paste(A, (0, 40)); W.paste(B, (968, 40))
d = ImageDraw.Draw(W)
try: f = ImageFont.load_default(size=22)
except Exception: f = ImageFont.load_default()
d.text((12, 8), la, fill=(235, 235, 235), font=f); d.text((980, 8), lb, fill=(255, 210, 120), font=f)
W.save(out)
`;
      spawnSync('python3', ['-I', '-c', py, curPng, fin.png, cmp, `CURRENT  web/assets (${n})`, `ARGON round ${fin.round}  (${n})`]);
    }
    summary.push({ asset: n, final: s.final, tokens: s.tokens, argonSeconds: +s.seconds.toFixed(1),
      rounds: s.rounds.map((r) => ({ round: r.round, finish: r.finish, seconds: r.seconds, valid: r.validation?.ok, errors: r.validation?.errors, warnings: r.validation?.warnings, bbox: r.validation?.bbox?.size, tris: r.validation?.tris, rendered: r.render?.ok, renderErrors: r.render?.errors?.slice(0, 4), defects: r.defects, error: r.error })),
      currentRendered: s.currentRender?.ok, currentErrors: s.currentRender?.errors?.slice(0, 4) });
  }
  const tot = summary.reduce((acc, s) => { for (const k of Object.keys(s.tokens)) acc[k] = (acc[k] || 0) + s.tokens[k]; return acc; }, {});
  const sumFile = path.join(OUT, 'summary.json');
  let prior = {}; try { prior = JSON.parse(fs.readFileSync(sumFile, 'utf8')); } catch {}
  const merged = { ...(prior.assets ? Object.fromEntries(prior.assets.map((a) => [a.asset, a])) : {}), ...Object.fromEntries(summary.map((a) => [a.asset, a])) };
  fs.writeFileSync(sumFile, JSON.stringify({ model: MODEL, thinkingBudget: THINKING, maxOutputTokens: MAX_OUT, ref: !!ref, lastRun: { assets: names, wallSeconds: +((Date.now() - T0) / 1000).toFixed(1), tokens: tot }, runs: [...(prior.runs || []), { assets: names, wallSeconds: +((Date.now() - T0) / 1000).toFixed(1), tokens: tot, at: new Date().toISOString() }], assets: Object.values(merged) }, null, 2));
  log(`[forge] done in ${((Date.now() - T0) / 1000).toFixed(0)}s; tokens ${JSON.stringify(tot)}`);
}

// ------------------------------------------------------------------ CLI
const argv = process.argv.slice(2);
if (argv[0] === '--validate') {
  validateChild(path.resolve(argv[1]), argv[2]).then((r) => { console.log(JSON.stringify(r)); process.exit(0); }, (e) => { console.log(JSON.stringify({ ok: false, errors: ['validator: ' + e.message] })); process.exit(0); });
} else if (argv[0] === '--render-batch') {
  renderBatchChild(path.resolve(argv[1])).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
} else if (argv[0] === '--render-only') {
  // re-render existing modules: --render-only <asset> <round|current>[,...]
  fs.mkdirSync(WORK, { recursive: true });
  const jobs = [];
  for (const spec of argv.slice(1)) {
    const [n, r] = spec.split(':'); const a = ASSETS[n];
    const cfg = { ...framing(n), kind: a.kind, dims: a.dims, color: a.color, current: a.current };
    if (r === 'current') jobs.push({ asset: n, mode: 'current', cfg, out: path.join(OUT, `${n}_current.png`) });
    else jobs.push({ asset: n, mode: 'argon', cfg, src: `/renders/asset_forge/work/${n}.r${r}.js?v=${Date.now()}`, out: path.join(OUT, `${n}_r${r}.png`) });
  }
  runRenderBatch(jobs, 'manual').then((r) => console.log(JSON.stringify(r.map((x) => ({ out: path.basename(x.out), ok: x.ok, errors: x.errors, info: x.info })), null, 1)));
} else {
  const args = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) { const k = argv[i].slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase()); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; args[k] = v; }
  main(args).catch((e) => { console.error(e); process.exit(1); });
}
