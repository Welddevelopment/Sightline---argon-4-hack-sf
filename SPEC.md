# Sightline — shared build spec (every slice reads this first)

## PRODUCT RULE (overrides anything below): this is a REAL, GENERAL tool, not a hardcoded demo
A lawyer uploads ANY crash case (PDFs, text docs, images, and videos such as videotaped depositions / dashcam / bodycam) and Sightline reconstructs and tests THAT case. Nothing in the engine (prompts, checks, loop, server, viewer) may contain case-specific facts, ids, coordinates or text. Witnesses, their positions (incl. positions shown only in video), vehicles, occluders and timing are all EXTRACTED BY ARGON from the evidence. Cases live in `cases/<caseId>/` (uploads in `cases/<caseId>/evidence/`, extracted text in `cases/<caseId>/text/`, outputs in `cases/<caseId>/worlds|renders|cache/`). The demo case is just one pre-run case whose Argon outputs are cached for judging (live runs of a brand-new case happen on the laptop with an API key). Mock mode = replay a case's cache; live mode = full pipeline on any case.

Goal: FLOOR working end to end within ~1 hour. Simple > clever. Boxes and lines are fine.
Track 2 loop: Argon generates a 3D crash world (as code) from a case file + long deposition video → we render it from witness viewpoints → Argon watches renders vs evidence → independent checks confirm → Argon patches world → repeat.

## Runtime facts (IMPORTANT)
- The cloud build workspace CANNOT reach the Gemini API. All live Argon calls run on the user's laptop.
- Every module that calls Argon must support `SIGHTLINE_MODE=mock` (read cached JSON/JS from `cache/`) and `SIGHTLINE_MODE=live` (call API, then write to `cache/`). Default: mock.
- Stack: Node 22, ES modules, plain JS (no TypeScript), Three.js (npm `three`), Express server, Playwright (Chromium) for headless rendering, ffmpeg. SDK: `@google/genai`. Model id from env `ARGON_MODEL` (default `gemini-4-argon`); Flash baseline from `BASELINE_MODEL` (default `gemini-3.8-flash`).
- Key from `.env`: `GEMINI_API_KEY`. Never log or commit it. `.env` is gitignored.

## Repo layout (/home/claude/sightline)
```
SPEC.md                 this file
package.json            scripts: dev, smoke, render, loop, baseline
.env.example
case/                   CASE slice: facts.md, police_report.md, witness_*.md, deposition_script.json, exhibits/map.png, case.json (index)
deposition/             VIDEO slice: build_video.js → out/deposition.mp4 (+ .srt)
web/                    VIEWER slice: index.html, viewer.js (loads a world module), ui.js, style.css
worlds/                 world modules: reference_world.js (hand-written fallback, WORLD slice), world_v*.js (Argon-generated)
checks/checks.js        CHECKS slice: independent geometry/physics checks
render/record.js        RENDER slice: Playwright → renders/<world>/<view>.mp4 + .png
argon/                  ARGON slice: client.js, prompts/*.md, generate_world.js, critique.js, new_witness.js, loop.js, baseline.js
server/server.js        APP slice: Express API + serves web/
cache/                  cached Argon outputs for mock mode
renders/                output videos/images
```

## THE WORLD CONTRACT (world modules must follow exactly)
A world module is an ES module: `export default function createWorld(THREE) { ... return world; }`
It must NOT import anything; THREE is passed in. Units: meters. Y is up, ground at y=0. +X = east, -Z = north (so north is "up" in the overhead view). Time t in seconds from 0 to `duration`.

`world` object:
```js
{
  meta: { caseId, title, timeOfDay: "06:45", lighting: "dawn|day|night", source: "NTSB HWY.. facts + fictional witnesses" },
  root: THREE.Group,                 // everything visual lives under here
  duration: 12,                      // seconds of the event timeline
  setTime(t) {},                     // moves every dynamic object to its state at time t (deterministic)
  objects: {                         // every meaningful object, keyed by id
    // id prefixes: veh_ (vehicles), occ_ (occluders: bus, shelter, trees, hill, building), sig_ (signals/signs),
    //              road_ (road surfaces), mark_ (skid marks, impact point), bld_ (buildings)
    "veh_A": { node: THREE.Object3D, kind: "vehicle", label: "Pickup truck (Vehicle A)", citation: "Police report p.2", occludes: true },
    "occ_shelter": { node, kind: "occluder", label, citation, occludes: true },
    "sig_north": { node, kind: "signal", label, citation, occludes: false, state(t) { return "red"|"yellow"|"green"|"off"; } }
  },
  witnesses: [
    { id: "wit_B", name: "Witness B (fictional)", position: [x, y, z], eyeHeight: 1.6, lookAt: "sig_north" | [x,y,z],
      observationTime: 6.5, claim: "I saw the light was red", citation: "Deposition 27:14" }
  ],
  facts: [ { id: "f1", text: "Skid marks 31 m before impact", value: 31, unit: "m", citation: "Police report p.3", kind: "skid|speed|time|distance|position" } ],
  skids: [ { vehicle: "veh_A", length: 31, mu: 0.7, citation: "..." } ]   // optional, for the speed check
}
```
Rules: every object and witness has a `citation` string. Dynamic objects get position/rotation set ONLY inside setTime. Keep geometry simple (Box/Plane/Cylinder). Name every Object3D with its id (`node.name = id`).

## Viewer page contract (web/index.html)
URL params: `?world=/worlds/reference_world.js&cam=overhead|wit_B|chase_veh_A&t=6.5`
Exposes `window.sl` for headless control:
```js
window.sl = {
  ready: Promise,                 // resolves when world loaded and first frame rendered
  loadWorld(url) -> Promise,
  setCamera(id),                  // "overhead" | witness id | "chase_<vehicle id>"
  setTime(t),                     // calls world.setTime + renders
  renderFrame(),                  // forces a render
  world                           // the world object
}
```
Witness camera: positioned at witness.position with y = eyeHeight, looking at lookAt target, 60° FOV. Overhead: orthographic or high perspective camera looking straight down, north up. Show a small HUD: camera name + time + "SIMULATED / FICTIONAL WITNESSES" label.

## Checks contract (checks/checks.js, runs in Node with three)
```js
export function sightline(world, witnessId, targetId, t) -> { visible, blockedBy: id|null, distance, from:[...], to:[...] }
export function skidSpeed(lengthM, mu=0.7) -> { mps, mph }          // v = sqrt(2*mu*g*d)
export function speedAt(world, objectId, t, dt=0.05) -> { mps, mph }
export function runAll(world) -> [{ check, subject, pass, detail, citation }]   // sightline for every witness at observationTime, skid vs speedAt for every skid
```

## Argon calls (argon/)
1. generate_world: input = case file text (all of case/*.md) + deposition video (Files API upload) + SPEC world contract → output = one complete world module JS (save worlds/world_v1.js) + cache.
2. critique: input = case text + deposition video + rendered videos/images of current world + checks JSON → output JSON: `{ findings: [{ id, severity, summary, evidence: [{source, citation}], involves: [ids], status: "contradiction|consistent|unverifiable" }], patch: "<full new world module JS or null>" }`.
3. new_witness: input = typed statement + world → output JSON witness entry (position, lookAt, observationTime, claim, citation:"Live statement").
4. loop: generate → render → checks → critique → apply patch → re-render → re-check (max 3 rounds). Logs each round to cache/loop_log.json.
5. baseline: same critique with BASELINE_MODEL over a chunk-and-summarize of the transcript only (no video) → findings; used to show what it misses.

## Server API (server/server.js, port 5173)
GET / → web/index.html ; GET /worlds/* ; GET /renders/* ; GET /case/* ; GET /deposition/out/*
GET /api/state → { world: "/worlds/world_vN.js", findings, checks, loopLog }
POST /api/witness { statement } → { witness, sightline, renderUrl, verdict }
POST /api/loop → runs loop (mock replays cache)

## The story we must be able to show (floor)
Fictional Witness B testified (deposition video, ~27:14) she saw the signal/vehicle; in the video she marks her position on the map exhibit (visual only, not spoken precisely). From that position a real occluder (bus shelter / parked bus / curve / hill) blocks her view at the observation time → contradiction. Checks.sightline confirms. Argon patches world (e.g., corrects her position or flags testimony) → findings panel shows citations.

## WORLD CONTRACT v2 (lands AFTER the 11:55 gate; see project doc sightline/world-gen-brief.md)
`export default function createWorld(THREE, assets) { ... }` — still no imports. Argon decides WHAT/WHERE/WHEN (layout, positions, timing, speeds, witnesses, citations). The asset library (web/assets.js, shared by browser + Node) decides how things LOOK. Argon never models or rescales vehicles/furniture; it only places library objects and sets position/rotation.y in setTime. v1 worlds (createWorld(THREE)) must keep working: if a world ignores `assets`, nothing breaks.

Conventions: meters; Y up; ground y=0; +X east, -Z north; every asset's origin = ground-level center of its footprint; rotation.y=0 faces -Z (north); heading via rotation.y (radians, counter-clockwise from north toward west, i.e. three.js convention). Every factory returns a THREE.Object3D with `userData.assetType`, `userData.dims` {length,width,height} and `name` = the id you pass. Geometry is procedural (no network); materials MeshStandardMaterial (PBR); meshes castShadow/receiveShadow.

Catalog (exact real dimensions L x W x H in meters):
- assets.vehicle(type, {id, color}) — sedan 4.9x1.9x1.45 · suv 4.8x1.95x1.75 · pickup 5.9x2.0x1.9 · van 5.3x2.0x2.0 · box_truck 7.5x2.5x3.4 · bus 12.2x2.55x3.2 · truck_tractor 6.5x2.5x3.6 (cab-over-engine NOT assumed; conventional hood) · semitrailer 16.2x2.6x4.1 (box; its origin is the kingpin end? NO — origin is footprint center like everything else; userData.kingpinOffset gives the kingpin position along -Z) · motorcycle 2.2x0.8x1.2 · bicycle 1.8x0.6x1.1. Vehicles include body, cabin/glass, wheels, headlights + taillights as child meshes named `headlight_L/R`, `taillight_L/R`; `vehicle.userData.setLights(on:boolean)` toggles emissive + optional SpotLights; `userData.driverEye` = local [x,y,z] of the driver's eye (left-hand drive).
- assets.pedestrian({id, height=1.7}) — simple figure; userData.eyeHeight = height*0.93.
- assets.road({id, lanes=2, laneWidth=3.6, length, markings:'center_dashed'|'center_double'|'none', edgeLines=true, shoulder=0}) — along -Z at rotation 0; asphalt + markings.
- assets.median({id, width, length}) · assets.intersection({id, size}) · assets.crosswalk({id, width, length}) · assets.curb({id, length}) · assets.sidewalk({id, width, length})
- assets.signal({id, heads=1, poleHeight=5.5, armLength=0}) — returned object has userData.setState('red'|'yellow'|'green'|'off'); world still exposes state(t) on its objects entry and calls setState inside setTime.
- assets.sign({id, kind:'stop'|'yield'|'speed_limit'|'street_name'|'generic', text}) · assets.pole({id, height}) · assets.streetlight({id, height=9, on:false})
- assets.shelter({id, open=true}) 3.5x1.5x2.5 · assets.building({id, w, d, h, kind:'store'|'house'|'generic'}) · assets.tree({id, height=8}) · assets.parkedVehicle(type, {id, color}) = vehicle with lights off
- assets.environment({timeOfDay:'16:36', lighting:'dawn'|'day'|'dusk'|'night', weather:'clear'|'overcast'|'rain', sunAzimuthDeg?, sunElevationDeg?}) — returns {lights:[...], sky:{...}} to add under root (viewer applies sky/fog from userData)
- assets.skidMark({id, points:[[x,z],...], width=0.25}) · assets.impactMarker({id, position:[x,z]}) · assets.groundPlane({id, size, kind:'grass'|'asphalt'|'dirt'})
Boxes remain the automatic fallback: if any factory throws, it returns a labeled box of the same dims.
Overlays (speed, time-to-impact, signal state, labels, sight lines, stopping distances) are drawn by the VIEWER from checks.js output — Argon does not write them.
Validation (argon/validate_world.js): syntax check, isolated dynamic import, contract (required keys; citation on every object/witness; id prefixes; no import/require/fetch/eval; setTime deterministic over [0,duration]; positions within scene bounds; witnesses on ground; only catalog asset types). On failure: one Argon repair round with the validator errors, then fall back to worlds/reference_world.js and log it.

## CREDIBILITY v1 — shared data contract (11:57, lead). Agents code against these exact names.

### checks (checks/checks.js runAll output; all existing fields stay)
- sightline result (per witness) adds:
  - `robustness: { radiusM: 2, samples: 25, blocked: N, clear: 25-N, eyeJitterM: 0.1, verdict: "robust"|"partial"|"not_blocked" }` — ray-cast from 25 deterministic points in a 2 m disc around the marked eye position, eye height ±0.1 m.
  - `gaze: { offAxisDeg, assumed: bool, cameraFovDeg: 60, peripheral: offAxisDeg > 30 }` — angle between where the witness was looking and the target.
  - detail wording: "had line of sight; target X° from gaze" / "line of sight blocked by …"; never "could see".
- skid result adds `range: { mu: [0.6, 0.8], mph: [lo, hi], mps: [lo, hi] }`.
- timing result adds `prt: { availableS, rangeS: [1.0, 2.5], typicalS: 1.5, verdict: "insufficient"|"marginal"|"sufficient"|"unverifiable" }`.
- new results `{ check: "plausibility", subject, pass, maxAccelG, maxSpeedMph, issues: [string], detail }` (one per moving object; >1.0 g outside ±0.5 s of impact, jumps >5 m per 0.05 s, >60 m/s).
- `export const KINEMATIC_LABEL = "Kinematic reconstruction: motion fitted to cited evidence; not a crash-physics simulation."`
- physics helpers live in checks/physics.js (skidRange, prtCheck, plausibilityCheck); robustness/gaze in checks/robustness.js; checks.js runAll wires them.

### provenance — cases/<id>/worlds/world_vN.provenance.json
`{ world, version, createdAt, mode: "mock"|"live"|"live-cached"|"seeded", model, promptFile, promptVersion (sha256 first 12 hex), inputs: [{file, sha256, bytes}], outputSha256, usage: {promptTokens, outputTokens, thoughtsTokens}, seconds, finishReason, thinkingBudget, maxOutputTokens, parentWorld }`

### validation — cases/<id>/validation_facts.json (input) and cases/<id>/cache/validation.json (output)
- facts: `[{ id, label, value, unit, tolerance, citation, how }]` taken only from cited case facts (published investigation).
- output: `{ source: "NTSB HAR-17/02", world, matched, total, items: [{ id, label, expected, actual, unit, tolerance, pass, citation }] }`

### server — GET /api/cases/:id additionally returns
`provenance: { "<world path>": {...} }`, `validation: {...}|null`, `kinematicLabel: string`.

### UI conventions
- objects/values whose citation contains "inferred" render in the INFERRED colour (amber dashed) with an "inferred" tag; cited ones normal.
