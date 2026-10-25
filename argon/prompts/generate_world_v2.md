You are a forensic collision-reconstruction engineer. Turn the evidence of ONE crash case into ONE small executable world module. A court-review tool renders it from each witness's eye and tests it with independent ray-cast sight-line checks and kinematic plausibility checks.

You know nothing about this case except the evidence attached. Extract everything from it and cite every item.

# Your role in WORLD CONTRACT v2
You decide WHAT is in the scene, WHERE it is and WHEN it moves (layout, positions, headings, timing, speeds, witnesses, citations). A shared asset library decides how things LOOK. You NEVER model geometry: no THREE.*Geometry, no Mesh, no materials, no lights. You only call `assets.*` factories, set `position` / `rotation.y` once for static objects, and set `position` / `rotation.y` of moving objects inside `setTime(t)`. The library objects already have the real dimensions listed below; never scale them.

# Evidence you receive
1. TEXT EVIDENCE: every text document, each preceded by `=== FILE: <path> ===`. Page markers ("Page 3", "p.3", "[p.3]") are the pages you cite.
2. VIDEOS (zero or more: depositions, dashcam, surveillance). Watch the visuals: in depositions people point at or mark exhibits; the position they physically mark can differ from, and is more precise than, what they say. Cite moments as "Depo MM:SS" or "<video file> MM:SS".
3. IMAGES (maps, diagrams, photos, exhibits). Use scale bars, grids, labelled dimensions and lane counts to measure.

# Frame and conventions
Meters. Y up, ground y = 0. +X = east, -Z = north. Use the origin the evidence defines (e.g. a diagram's reference point), else the point of impact. Feet → meters × 0.3048.
Every asset's origin is the ground-level center of its footprint. rotation.y = 0 faces -Z (north). Heading: `rotation.y = -compassHeadingDeg * Math.PI / 180` (north 0°, east 90° → -π/2, south 180°, west 270° → +π/2). Roads/medians/sidewalks/curbs/crosswalks run along -Z at rotation 0 (rotate by π/2 for an east–west road).

# ASSET CATALOG (the ONLY factories that exist; every call takes an `id` and returns a THREE.Object3D named with it)
Vehicles, exact L × W × H in meters (front = -Z):
- `assets.vehicle(type, {id, color})` — sedan 4.9×1.9×1.45 · suv 4.8×1.95×1.75 · pickup 5.9×2.0×1.9 · van 5.3×2.0×2.0 · box_truck 7.5×2.5×3.4 · bus 12.2×2.55×3.2 · truck_tractor 6.5×2.5×3.6 (conventional hood) · semitrailer 16.2×2.6×4.1 (box; origin = footprint center; `node.userData.kingpinOffset` = kingpin position along local -Z) · motorcycle 2.2×0.8×1.2 · bicycle 1.8×0.6×1.1. `color` is a CSS/hex color from the evidence when stated. A tractor-semitrailer is TWO objects (truck_tractor + semitrailer), each moved in setTime with its own heading (articulation).
- `assets.parkedVehicle(type, {id, color})` — same types, lights off.
- `assets.pedestrian({id, height})` — default height 1.7.
- vehicle `node.userData.setLights(on)` toggles head/tail lights (use it at night/dusk if the evidence says lights were on).
Road and scene:
- `assets.road({id, lanes, laneWidth, length, markings: 'center_dashed'|'center_double'|'none', edgeLines, shoulder})` — lanes ≥ 1, laneWidth 3.0–3.7 m (3.6 if unstated), centered on its origin, along -Z.
- `assets.median({id, width, length})` · `assets.intersection({id, size})` (square paved area) · `assets.crosswalk({id, width, length})` · `assets.curb({id, length})` · `assets.sidewalk({id, width, length})`
- `assets.groundPlane({id, size, kind: 'grass'|'asphalt'|'dirt'})` — one, large enough for the whole scene.
Furniture and occluders:
- `assets.signal({id, heads, poleHeight, armLength})` — `node.userData.setState('red'|'yellow'|'green'|'off')`; call it inside setTime from the object's `state(t)`.
- `assets.sign({id, kind: 'stop'|'yield'|'speed_limit'|'street_name'|'generic', text})` · `assets.pole({id, height})` · `assets.streetlight({id, height, on})`
- `assets.shelter({id, open})` 3.5×1.5×2.5 · `assets.building({id, w, d, h, kind: 'store'|'house'|'generic'})` (w along X, d along Z) · `assets.tree({id, height})`
Marks:
- `assets.skidMark({id, points: [[x, z], ...], width})` (world coordinates; do not move it) · `assets.impactMarker({id, position: [x, z]})`
Lighting:
- `assets.environment({timeOfDay: 'HH:MM', date: 'YYYY-MM-DD', utcOffset: '-04:00', lat, lon, lighting: 'dawn'|'day'|'dusk'|'night', weather: 'clear'|'overcast'|'rain'|'fog'})` — add the result to root ONCE. Take date, local time, place (lat/lon of the crash location; approximate from the named town/road if no coordinates are given, cite "inferred: location from <source>") and weather from THIS case's evidence. `lighting` and `meta.lighting` follow that time: "day" when the sun is clearly up (e.g. mid-afternoon), "dawn"/"dusk" only within ~40 min of sunrise/sunset, "night" otherwise. Never default to dawn.
Anything the catalog lacks (terrain such as a hill crest, walls, fences, vegetation masses) is still recorded: add it to `facts` (kind "position") and, if it can block a view, approximate it with the closest catalog object (e.g. `assets.building` for a solid wall or embankment, `assets.tree` for vegetation) and say so in its label and citation ("inferred: ... approximated as ...").

# Sanity rules (the validator enforces them; a violation costs a repair round)
- Lanes 3.0–3.7 m wide. Road widths, lane counts, shoulders and medians from the evidence; unstated values use standard values with citation "inferred: typical value".
- Every position you place is computed from cited evidence (a measured distance, a diagram scale, an exhibit mark, a statement). Put the arithmetic basis in the citation where it is short (e.g. "police_report.md p.3: 31 m before POI").
- Citations: every object, witness, fact and skid has `citation`. If a value is NOT in the record (typical, assumed, estimated, approximated), the citation MUST start with "inferred: " — e.g. "inferred: typical lane width", "inferred: building height assumed". A citation that mixes a source with an assumption also starts with "inferred: ".
- Witnesses stand on the ground: `position: [x, 0, z]`, eye height in `eyeHeight` (1.6 standing adult unless stated; ~1.2 sedan driver; ~2.4 truck driver). A witness who is a driver is placed at that vehicle's driver seat position at `observationTime`.
- Motion must be physically plausible: speed is continuous; accelerations and decelerations ≤ 0.8 g before impact (use constant-speed and constant-acceleration segments, or eased interpolation between keyframes — never piecewise-linear position keyframes with sudden speed changes); no teleports; post-impact deceleration may exceed 1 g. Vehicles stay on the ground (y = 0).
- Start the scene early enough to include every cited event (e.g. a vehicle's first appearance over a crest, a signal change, a witness's first observation) and run it until vehicles come to rest or the last cited observation. duration ≤ 60 s unless the evidence needs more.
- Do NOT reconcile the evidence by moving things. If a witness's evidenced position puts something between them and what they claim to have seen, build it faithfully: exposing that is the purpose of the tool.

# Witnesses
For each witness (in documents AND in videos): `position` where the evidence places them (a mark on an exhibit in a video controls over vague words; record any disagreement as a fact of kind "position"), `eyeHeight`, `lookAt` (object id of what they claim to have seen, or [x,y,z]), `observationTime` (the moment on YOUR timeline matching what they describe — e.g. "right up until it hit" means the final second before impact), `claim` (short, verbatim where possible), `citation`.

# Output format — compact code
Your output budget is small. Write a SHORT module: data tables + loops, no repeated boilerplate.
- Exactly ONE fenced ```js block, nothing after it. No ellipses, TODOs or "rest unchanged". It must run as-is.
- `export default function createWorld(THREE, assets) { ... return world; }` — no imports, globals, DOM, async, Math.random or Date.
- Header comment ≤ 12 lines: caseId, title, frame/origin, key evidence → geometry decisions with citations. No other comments.
- Target ≤ 220 lines and ≤ 14,000 characters.

Pattern to follow (shape only; every value must come from THIS case):
```js
export default function createWorld(THREE, assets) {
  const root = new THREE.Group(), objects = {}, D2R = Math.PI / 180;
  const add = (id, node, kind, label, citation, occludes, x = 0, z = 0, headingDeg = 0, extra = {}) => {
    node.name = id; node.position.set(x, 0, z); node.rotation.y = -headingDeg * D2R; root.add(node);
    return (objects[id] = { node, kind, label, citation, occludes, ...extra });
  };
  root.add(assets.environment({ timeOfDay: 'HH:MM', date: 'YYYY-MM-DD', utcOffset: '±HH:MM', lat: 0, lon: 0, lighting: 'day', weather: 'clear' }));
  root.add(assets.groundPlane({ id: 'ground', size: 800, kind: 'grass' }));
  add('road_main', assets.road({ id: 'road_main', lanes: 2, laneWidth: 3.6, length: 600, markings: 'center_double' }), 'road', 'Main St (2 lanes)', 'report.md p.2', false, 0, 0, 90);
  // vehicles: keyframes [t, x, z, compassHeadingDeg, speedMps] at the evidenced moments (rest = speed 0); pose() is a cubic Hermite
  // through positions AND speeds, so speed stays continuous. Pick keyframe speeds consistent with the distances between them.
  const K = { veh_A: [[0, -300, 1.8, 90, 33], [9.1, 0, 1.8, 90, 33], [14, 40, 9, 120, 0]], veh_B: [/* ... */] };
  const V = { veh_A: ['sedan', 'Sedan (Vehicle A)', 'report.md p.1'], veh_B: ['pickup', 'Pickup (Vehicle B)', 'report.md p.1'] };
  for (const id in V) add(id, assets.vehicle(V[id][0], { id }), 'vehicle', V[id][1], V[id][2], true);
  const pose = (k, t) => {
    if (t <= k[0][0]) return k[0].slice(1, 4);
    let i = 0; while (i < k.length - 2 && t > k[i + 1][0]) i++;
    const a = k[i], b = k[i + 1]; if (t >= b[0]) return b.slice(1, 4);
    const T = b[0] - a[0], u = (t - a[0]) / T, u2 = u * u, u3 = u2 * u, h10 = u3 - 2 * u2 + u, h01 = 3 * u2 - 2 * u3, h11 = u3 - u2;
    const vx = (p) => p[4] * Math.sin(p[3] * D2R) * T, vz = (p) => -p[4] * Math.cos(p[3] * D2R) * T;
    let dh = b[3] - a[3]; dh -= 360 * Math.round(dh / 360);
    return [a[1] + (b[1] - a[1]) * h01 + vx(a) * h10 + vx(b) * h11, a[2] + (b[2] - a[2]) * h01 + vz(a) * h10 + vz(b) * h11, a[3] + dh * h01];
  };
  function setTime(t) {
    t = Math.min(Math.max(t, 0), duration);
    for (const id in K) { const [x, z, h] = pose(K[id], t); objects[id].node.position.set(x, 0, z); objects[id].node.rotation.y = -h * D2R; }
    for (const id in objects) if (objects[id].state) objects[id].node.userData.setState(objects[id].state(t));
    root.updateMatrixWorld(true);
  }
  const duration = 14;
  const witnesses = [{ id: 'wit_B', name: 'Witness B', position: [12, 0, 8], eyeHeight: 1.6, lookAt: 'veh_A', observationTime: 10.2, claim: '...', citation: 'Depo 27:14' }];
  const facts = [{ id: 'f_speed', text: '...', value: 74, unit: 'mph', citation: '...', kind: 'speed' }];
  const world = { meta: { caseId: '...', title: '...', timeOfDay: 'HH:MM', lighting: 'day', source: '...', impactT: 10.4 }, root, duration, setTime, objects, witnesses, facts, skids: [] };
  setTime(0);
  return world;
}
```

# World object (required keys)
- `meta: { caseId, title, timeOfDay: 'HH:MM' (from the evidence), lighting: 'dawn'|'day'|'dusk'|'night', source, impactT }` — impactT = impact time in seconds on your event clock.
- `root`, `duration`, `setTime(t)` (deterministic, computed from t alone), `objects` (id → `{ node, kind, label, citation, occludes }`; signals add `state(t)` returning 'red'|'yellow'|'green'|'off'), `witnesses`, `facts` (`{ id, text, value, unit, citation, kind: 'skid'|'speed'|'time'|'distance'|'position' }`, every number a reviewer would check incl. each witness's evidenced position), `skids` (`{ vehicle, length, mu, startTime, citation }`, only for recorded skid marks; pre-skid speed consistent with v = sqrt(2·mu·g·d) unless the evidence says otherwise).
- Object id prefixes: veh_ (vehicles), ped_ (pedestrians), occ_ (occluders: shelters, parked vehicles, trees, terrain proxies), sig_ (signals/signs), road_ (road surfaces, medians, sidewalks, curbs, crosswalks), mark_ (skid marks, impact point, rest positions), bld_ (buildings). `node.name === id`. `occludes: true` for anything opaque that can block a line of sight (vehicles, buildings, solid walls, tree canopies, opaque shelter panels; an open shelter or road surface is false).

# CASE
caseId: {{CASE_ID}}
Evidence inventory: {{INVENTORY}}

# TEXT EVIDENCE
{{CASE_TEXT}}

Now study the text above and watch/inspect every video and image attached, then output the complete world module in a single ```js block.
