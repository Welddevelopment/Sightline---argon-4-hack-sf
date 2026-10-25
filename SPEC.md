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

## REVIEW & CONFIRM (12:10) — owner B1 (argon/extract.js, server/review.js). UI (B2) codes against these exact shapes.
Pipeline: ingest → **extraction (Argon)** → human review/confirm → generate_world → render → checks → critique.
Skip path: if `cases/<id>/confirmed_facts.json` does not exist, generate_world is unchanged. If it exists, generate_world adds it to the prompt as "AUTHORITATIVE CONFIRMED FACTS (human-reviewed)".

### Extraction object (cases/<id>/cache/extraction.json)
```json
{
  "caseId": "live1", "createdAt": "ISO", "mode": "live|mock|live-cached",
  "scene": { "date": "2016-05-07", "time": "16:40", "location": "US-27A at NE 140th Ct, near Williston, FL",
             "lat": 29.41, "lon": -82.54, "weather": "clear", "lighting": "day", "citation": "police_report.md p.1" },
  "facts": [ { "id": "f1", "label": "Car speed before impact", "value": 74, "unit": "mph",
               "citation": "facts.md p.2", "source": { "file": "facts.md", "page": 2, "timestamp": null },
               "cited": true, "confidence": 0.9 } ],
  "vehicles": [ { "id": "veh_car", "type": "sedan", "description": "2015 Tesla Model S, eastbound", "citation": "police_report.md p.1" } ],
  "objects":  [ { "id": "obj_shelter", "kind": "occluder|sign|shelter|signal|building|tree|vegetation|parked_vehicle|other",
                  "position": [x, z] , "citation": "Depo 12:30" } ],
  "witnesses": [ { "id": "wit_B", "name": "Witness B", "markedPosition": [x, z], "positionCitation": "Depo 27:04",
                   "eyeHeight": 1.6, "observationTime": "16:40:12 or seconds-before-impact as string",
                   "claim": "Saw the truck turning ...", "claimCitation": "Depo 27:14" } ],
  "notes": "free text from Argon (optional)"
}
```
- Citations: video moments `"Depo MM:SS"`; documents `"<file> p.N"`; inferred values have `cited:false` and citation containing `"inferred"` (render amber dashed per UI conventions).
- `source`: `{ file, page: number|null, timestamp: "MM:SS"|null }` (exactly one of page/timestamp normally set).
- `confidence`: 0..1. `position`/`markedPosition`: scene meters [x, z] (+X east, -Z north, origin = the scene's primary reference point, usually the conflict/impact point) or `null` if unknown.
- `objects[].position` may be null.

### Endpoints (mounted via `mountReview(app, ctx)` in server/review.js)
- `GET /api/cases/:id/extraction` →
  `{ caseId, status: "none"|"running"|"ready"|"error", extraction: <Extraction>|null, meta: { mode, model, seconds, usage: {promptTokens, outputTokens, thoughtsTokens}, finishedAt }|null, confirmed: <Confirmed>|null, error: string|null }`
- `POST /api/cases/:id/extraction/run` body `{ mode?: "mock"|"live" }` → same shape as GET. Mock (default when server is in mock mode) serves the cached extraction immediately (`status:"ready"`). Live returns `status:"running"` immediately; poll GET every ~2 s until `ready`/`error`.
- `POST /api/cases/:id/confirm` body `{ facts: [...], witnesses: [...], scene: {...}, vehicles?: [...], objects?: [...], confirmedBy: "name" }` (same item shapes as the extraction; the UI sends the edited/accepted items, dropping rejected ones; an edited item may carry `"edited": true`) →
  `{ ok: true, confirmed: <Confirmed> }`, where Confirmed (= cases/<id>/confirmed_facts.json) is
  `{ caseId, confirmedAt: "ISO", confirmedBy, extractionCreatedAt, scene, facts, vehicles, objects, witnesses }`.
  Body `{ clear: true }` deletes confirmed_facts.json (back to the skip path) → `{ ok: true, confirmed: null }`.

## EXPORTS (12:10)
### Witness-view clips — owner PRODUCT-C (server/clips.js). PRODUCT-A's web/exports.js codes against these.
- `GET /api/cases/:id/clips` → `{ caseId, mode, world, fps, width, height, clips: [{ camera, t0, t1, url, cached, cacheFile, check }] }` — one entry per camera (`overhead` + every witness id), with the default window and a ready-to-use `url`. `check` = `{ pass, target, blockedBy, t, text }` (null for overhead). Use this to build one "Download clip" button per camera.
- `GET /api/cases/:id/clips/:camera.mp4?t0=&t1=[&download=1]` → `video/mp4` (H.264, 1280x720, 24 fps, faststart; Range supported so it plays in `<video>`). Default window: witness observation time (state.checks sightline `t`, else witness.observationTime) −3 s … +1 s; overhead: min(obs)−3 … max(obs)+1; clamped to [0, duration], max 30 s. `download=1` → `Content-Disposition: attachment; filename="sightline_<case>_<camera>_<t0>-<t1>.mp4"`. Errors are JSON: 400 bad t0/t1, 404 unknown case/camera, 409 no world yet, 500 render failed.
- Frames are the viewer in `?clean=1` mode (WebGL + HUD/labels/verdict overlay) plus a burned-in caption strip: "SIMULATED / FICTIONAL RECONSTRUCTION | case | camera" and the sightline check result + clip window.
- Cached at `cases/<id>/exports/clips/<camera>__<world>.<sha8>__<t0>-<t1>.mp4` (+ `.json` sidecar with caption/check/renderSeconds); key = (case, world content, camera, t0, t1). Headers: `X-Clip-Cache: hit|miss|fallback`, `X-Clip-Window`, `X-Clip-Render-Seconds`. A miss renders synchronously (~1–2 min for a 4 s clip; serialized via scripts/render_lock.sh), so show a spinner; demo defaults are pre-rendered (instant). Mock mode never re-renders a cached clip (`fresh=1` is live-only).
### Download scene (.glb + .json) — owner PRODUCT-F (server/scene_export.js, `mountSceneExport(app, ctx)`). For a forensic animation studio / expert.
- `GET /api/cases/:id/scene.glb[?t=]` → `model/gltf-binary` (attachment `sightline_<case>_scene.glb`). glTF 2.0 of the case's current world posed at `t` s (default = key observation time: witness of the most serious finding, contradictions first; else first witness). Node names = world object ids; each object node's `extras` = `{ sightlineId, kind, label, citation, inferred, occludes, signalState? }`. Cameras `cam_<witnessId>` (eye position, 60° vertical FOV, 16:9, aimed at lookAt at t; extras: claim, citation, observationTime). Scene extras `sightline` = case meta, t, units/axes, disclaimer labels, sun direction. Animation `timeline` = 10 Hz position/quaternion keys of moving objects over [0, duration]. Lights omitted.
- `GET /api/cases/:id/scene.json[?download=1]` → `{ meta: { caseId, title, world, duration, sampleHz: 10, keyTime: { t, witnessId, findingId, reason }, glbTime, units, axes, bearing, labels[] }, objects: [{ id, kind, label, citation, inferred, occludes, assetType, dims, gltfNode, atT: { position, bbox, state? }, dynamic, keyframes: [{ t, position, quaternion, bearingDeg, visible, speedMps, state? }] }] (static objects: 1 keyframe), witnesses: [{ id, name, source, position, eyeHeight, eye, lookAt, lookAtPointAtT, observationTime, claim, citation, positionCitation, camera, sightlineCheck }], facts, skids, confirmedFacts|null, extraction|null, findings, checks: { source, results, validation }, provenance: { world, worldSha256, glbSha256, worldProvenance, exporter, mode, exportedAt } }`.
- `GET /api/cases/:id/scene.zip[?t=]` → `application/zip` with `scene.glb`, `scene.json`, `README.txt` (units m/s/m·s⁻¹/deg; axes −Z north, +X east, Y up; "ANALYSIS DRAFT - NOT EVIDENCE", fictional-witness label when the case says so, kinematic label).
- Cache: default-t exports are written to `cases/<id>/exports/scene.{glb,json,zip}`; served cached in mock mode for demo, otherwise when the cached world sha matches. A `t` other than the cached one is built on the fly (~0.5 s, not cached). Header `X-Scene-Cache: hit|miss`. Errors JSON: 400 bad t, 404 unknown case, 409 no world yet. Refresh: `node server/scene_export.js <caseId>`.
- UI: one "Download scene (.zip)" button → `/api/cases/<id>/scene.zip`; optional secondary links for `.glb` / `.json?download=1`.
