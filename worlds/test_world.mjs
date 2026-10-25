// Contract test for a world module. Usage: node worlds/test_world.mjs [path/to/world.js]
import * as THREE from 'three';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(process.argv[2] || path.join(here, 'reference_world.js'));
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL', msg); } };

const src = fs.readFileSync(file, 'utf8');
ok(!/^\s*import\s/m.test(src), 'module must not import anything');

const mod = await import(pathToFileURL(file).href);
ok(typeof mod.default === 'function', 'default export is a function');
// WORLD CONTRACT v2: createWorld(THREE, assets) with the shared asset library (v1 worlds ignore assets).
const { nodeAssets } = await import(pathToFileURL(path.join(here, '../checks/load_world.js')).href);
const isV2 = /createWorld\s*\(\s*THREE\s*,\s*assets/.test(src);
const world = mod.default(THREE, await nodeAssets());
if (isV2) {
  ok(!/new\s+THREE\.\w+Geometry/.test(src), 'v2: module builds no geometry itself (places library assets only)');
  for (const [id, o] of Object.entries(world.objects || {})) if (id.startsWith('veh_')) ok(o.node.userData?.assetType, `v2: ${id} is a library asset`);
  const v = await import(pathToFileURL(path.join(here, '../argon/validate_world.js')).href);
  const r = await v.validateWorldFile(file);
  for (const e of r.errors) ok(false, 'validator: ' + e);
  console.log(`validator: ${r.ok ? 'VALID' : 'INVALID'} (${r.warnings.length} warning(s)) ${JSON.stringify(r.stats.assetFallbacks || {})}`);
}

ok(world.meta && world.meta.caseId && world.meta.title && world.meta.timeOfDay && world.meta.lighting && world.meta.source, 'meta fields');
ok(['dawn', 'day', 'night', 'dusk'].includes(world.meta.lighting), 'meta.lighting value');
ok(world.root && world.root.isGroup, 'root is a THREE.Group');
ok(typeof world.duration === 'number' && world.duration > 0, 'duration > 0');
ok(typeof world.setTime === 'function', 'setTime function');

const PREFIX = /^(veh|occ|sig|road|mark|bld|ped)_/;
for (const [id, o] of Object.entries(world.objects || {})) {
  ok(PREFIX.test(id), `id prefix ${id}`);
  ok(o.node && o.node.isObject3D, `${id} node is Object3D`);
  ok(o.node && o.node.name === id, `${id} node.name === id`);
  ok(typeof o.kind === 'string' && typeof o.label === 'string', `${id} kind/label`);
  ok(typeof o.citation === 'string' && o.citation.length > 0, `${id} citation`);
  ok(typeof o.occludes === 'boolean', `${id} occludes boolean`);
  let inRoot = false; for (let n = o.node; n; n = n.parent) if (n === world.root) inRoot = true;
  ok(inRoot, `${id} is under root`);
  if (o.kind === 'signal') {
    ok(typeof o.state === 'function', `${id} state(t)`);
    for (let t = 0; t <= world.duration; t += 0.5) ok(['red', 'yellow', 'green', 'off'].includes(o.state(t)), `${id} state(${t}) valid`);
  }
}
const ids = Object.keys(world.objects);
ok(world.objects.veh_A, 'required object veh_A');
ok(ids.filter((k) => k.startsWith('veh_')).length >= 2, 'at least two vehicles');
ok(ids.some((k) => k.startsWith('occ_')), 'at least one occ_ occluder');
if ((world.skids || []).length) ok(ids.some((k) => k.startsWith('mark_skid')), 'skid mark object when skids[] non-empty');

ok(Array.isArray(world.witnesses) && world.witnesses.length >= 3, '>= 3 witnesses');
for (const w of world.witnesses) {
  ok(/^wit_/.test(w.id) && w.name, `witness id/name ${w.id}`);
  ok(Array.isArray(w.position) && w.position.length === 3 && w.position.every(Number.isFinite), `${w.id} position`);
  ok(Number.isFinite(w.eyeHeight), `${w.id} eyeHeight`);
  ok(Array.isArray(w.lookAt) || world.objects[w.lookAt], `${w.id} lookAt resolves`);
  ok(w.observationTime >= 0 && w.observationTime <= world.duration, `${w.id} observationTime in range`);
  ok(typeof w.claim === 'string' && w.claim && typeof w.citation === 'string' && w.citation, `${w.id} claim/citation`);
}
ok(Array.isArray(world.facts) && world.facts.length > 0, 'facts[]');
for (const f of world.facts) ok(f.id && f.text && f.citation && f.kind, `fact ${f.id}`);
for (const s of world.skids || []) ok(world.objects[s.vehicle] && s.length > 0 && s.citation, `skid ${s.vehicle}`);

// determinism + motion
const vehIds = ids.filter((k) => k.startsWith('veh_'));
const snap = () => vehIds.map((id) => world.objects[id].node.getWorldPosition(new THREE.Vector3()).toArray().map((v) => v.toFixed(4)).join(',')).join('|');
const times = [0, 2, 4, 6, 6.5, 7, 7.5, 8, 9, 12];
const seen = {};
for (const t of times) { world.setTime(t); seen[t] = snap(); }
for (const t of [...times].reverse()) { world.setTime(t); ok(snap() === seen[t], `setTime(${t}) deterministic`); }
ok(seen[0] !== seen[4], 'vehicles move over time');

// vehicles meet near impact time
const impactT = (world.facts.find((f) => f.kind === 'time' && /collision|impact/i.test(f.text)) || {}).value ?? 8;
world.setTime(impactT);
const boxA = new THREE.Box3().setFromObject(world.objects.veh_A.node);
let best = [Infinity, null];
for (const id of vehIds.filter((k) => k !== 'veh_A')) {
  const b = new THREE.Box3().setFromObject(world.objects[id].node);
  const gap = Math.max(0, b.min.x - boxA.max.x, boxA.min.x - b.max.x) + Math.max(0, b.min.z - boxA.max.z, boxA.min.z - b.max.z);
  if (gap < best[0]) best = [gap, id];
}
console.log(`t=${impactT}: veh_A footprint gap to ${best[1]} = ${best[0].toFixed(2)} m`);
ok(best[0] < 1.0, 'veh_A meets another vehicle at impact time');

// checks (if the CHECKS slice exists)
try {
  const checks = await import(pathToFileURL(path.join(here, '../checks/checks.js')).href);
  for (const w of world.witnesses) {
    const r = checks.sightline(world, w.id, w.lookAt, w.observationTime);
    console.log(`sightline ${w.id} -> ${Array.isArray(w.lookAt) ? 'point' : w.lookAt} @${w.observationTime}s: visible=${r.visible} blockedBy=${r.blockedBy} d=${r.distance.toFixed(1)}`);
  }
  const wb = world.witnesses.find((w) => w.id === 'wit_B');
  if (wb && !process.env.NO_CONTRADICTION) {
    const r = checks.sightline(world, 'wit_B', wb.lookAt, wb.observationTime);
    ok(!r.visible && r.blockedBy, 'wit_B view is blocked at observationTime (the contradiction)');
  }
  for (const w of world.witnesses.filter((w) => w.id !== 'wit_B')) {
    const r = checks.sightline(world, w.id, w.lookAt, w.observationTime);
    ok(r.visible, `${w.id} has a clear view (consistent)`);
  }
  for (const s of world.skids || []) {
    const need = checks.skidSpeed(s.length, s.mu ?? 0.7);
    console.log(`skid ${s.vehicle}: ${s.length} m -> min ${need.mph.toFixed(1)} mph`);
  }
  if (checks.runAll) for (const r of checks.runAll(world)) console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] ${r.check} ${r.subject}: ${r.detail}`);
} catch (e) { console.log('checks not available:', e.message); }

console.log(fails ? `\n${fails} FAILURE(S)` : `\nALL CONTRACT ASSERTIONS PASSED (${path.basename(file)}: ${Object.keys(world.objects).length} objects, ${world.witnesses.length} witnesses)`);
process.exit(fails ? 1 : 0);
