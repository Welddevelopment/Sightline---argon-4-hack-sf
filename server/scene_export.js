// Sightline "Download scene" (EXPORTS): the final reconstructed world as glTF binary + a JSON of facts/witnesses,
// for a forensic animation studio or an expert. Mounted via mountSceneExport(app, ctx) in server/server.js.
//   GET /api/cases/:id/scene.glb?t=   world posed at t (default: key observation time), witness eye cameras, extras
//   GET /api/cases/:id/scene.json     meta, objects + 10 Hz keyframes, witnesses, facts, findings, checks, provenance
//   GET /api/cases/:id/scene.zip      scene.glb + scene.json + README.txt
// Generic: nothing here knows about a particular case. The world module is loaded unchanged in Node (as checks/ does).
// CLI (refresh a case's cached export): node server/scene_export.js <caseId> [t]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..');
const SAMPLE_HZ = 10;
const FOV_DEG = 60;
const ASPECT = 16 / 9;
const EXPORT_VERSION = 1;
const DRAFT_LABEL = 'ANALYSIS DRAFT - NOT EVIDENCE. Simulated reconstruction for review by a qualified expert.';
const FICTION_LABEL = 'FICTIONAL WITNESSES: witness names, positions and testimony in this case are fictional.';
const SIMULATED_VIEW_LABEL = 'Witness eye views are simulated from marked positions; they are not what any witness actually saw.';
const KINEMATIC_FALLBACK = 'Kinematic reconstruction: motion fitted to cited evidence; not a crash-physics simulation.';
const AXES = { units: { length: 'm', time: 's', speed: 'm/s', angle: 'deg' },
  axes: '-Z north, +X east, Y up (ground y=0); glTF is Y-up so Blender imports it as +X east, +Y north, Z up',
  bearing: 'bearingDeg = compass bearing of the object\'s forward (local -Z) axis: 0 north, 90 east' };

// GLTFExporter writes binary output through FileReader; Node has Blob but no FileReader (same shim as render/export_gltf.mjs).
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(b) { b.arrayBuffer().then((buf) => { this.result = buf; this.onloadend && this.onloadend(); this.onload && this.onload({ target: this }); }); }
    readAsDataURL(b) { b.arrayBuffer().then((buf) => { this.result = `data:${b.type || 'application/octet-stream'};base64,` + Buffer.from(buf).toString('base64'); this.onloadend && this.onloadend(); this.onload && this.onload({ target: this }); }); }
  };
}

const readJson = (f, fb = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const r3 = (v) => Math.round(v * 1000) / 1000;
const errMsg = (e) => (e && e.message) ? e.message : String(e);
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(id);
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function makeHelpers(ROOT) {
  const caseDir = (id, ...a) => path.join(ROOT, 'cases', id, ...a);

  // Current world of a case: cases/<id>/cache/state.json.world; demo falls back to the legacy cache/state.json;
  // otherwise the highest cases/<id>/worlds/world_vN.js.
  function resolveWorld(id) {
    const st = readJson(caseDir(id, 'cache', 'state.json'));
    let state = st, url = st && st.world;
    if (!url && id === 'demo') { state = readJson(path.join(ROOT, 'cache', 'state.json')); url = state && state.world; }
    if (!url) {
      const wd = caseDir(id, 'worlds');
      const vs = fs.existsSync(wd) ? fs.readdirSync(wd).map((n) => /^world_v(\d+)\.js$/.exec(n)).filter(Boolean).sort((a, b) => b[1] - a[1]) : [];
      if (vs.length) url = `/cases/${id}/worlds/${vs[0][0]}`;
    }
    if (!url) return null;
    const file = path.resolve(ROOT, String(url).replace(/^\/+/, ''));
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) return null;
    return { url: url.startsWith('/') ? url : '/' + url, file, state: state || {} };
  }

  async function tryImport(rel) {
    const f = path.join(ROOT, rel);
    if (!fs.existsSync(f)) return null;
    try { return await import(pathToFileURL(f).href + `?t=${fs.statSync(f).mtimeMs}`); } catch { return null; }
  }

  async function instantiate(file, THREE) {
    const mod = await import(pathToFileURL(file).href + `?t=${fs.statSync(file).mtimeMs}`);
    if (typeof mod.default !== 'function') throw new Error('world module has no default export createWorld');
    let assets;
    try { const lw = await tryImport('checks/load_world.js'); if (lw && lw.nodeAssets) assets = await lw.nodeAssets(); } catch { assets = undefined; }
    const world = mod.default(THREE, assets);
    world.witnesses = world.witnesses || [];
    world.objects = world.objects || {};
    return world;
  }

  return { caseDir, resolveWorld, tryImport, instantiate };
}

// Key observation time: the witness involved in the most serious finding (contradictions first); else the first witness.
function keyTime(world, findings) {
  const sev = { critical: 4, high: 3, medium: 2, low: 1 };
  const score = (f) => (f.status === 'contradiction' ? 10 : 0) + (sev[String(f.severity || '').toLowerCase()] || 0);
  const wit = (id) => world.witnesses.find((w) => w.id === id && Number.isFinite(Number(w.observationTime)));
  for (const f of [...(findings || [])].sort((a, b) => score(b) - score(a))) {
    for (const id of f.involves || []) {
      const w = wit(id);
      if (w) return { t: Number(w.observationTime), witnessId: w.id, findingId: f.id || null, reason: `observation time of ${w.id} (finding ${f.id || '?'}, ${f.status || f.severity || ''})` };
    }
  }
  const w = world.witnesses.find((x) => Number.isFinite(Number(x.observationTime)));
  if (w) return { t: Number(w.observationTime), witnessId: w.id, findingId: null, reason: `observation time of ${w.id}` };
  return { t: (world.duration || 0) / 2, witnessId: null, findingId: null, reason: 'mid-timeline (no witness observation time)' };
}

function isShown(o) { for (let n = o; n; n = n.parent) if (n.visible === false) return false; return true; }

/** Build both artifacts for a case. Returns { glb: Buffer, json: object, t }. */
export async function buildSceneExport(ROOT, caseId, opts = {}) {
  const H = makeHelpers(ROOT);
  if (!validId(caseId) || !fs.existsSync(H.caseDir(caseId))) throw new HttpError(404, 'no such case');
  const W = H.resolveWorld(caseId);
  if (!W) throw new HttpError(409, 'case has no reconstructed world yet');
  const THREE = await import('three');
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const world = await H.instantiate(W.file, THREE);
  const worldSrc = fs.readFileSync(W.file);
  const manifest = readJson(H.caseDir(caseId, 'case.json'), {});
  const duration = Number(world.duration) || 0;
  const clampT = (t) => Math.min(Math.max(t, 0), duration);

  // live-statement witnesses added through the app
  const extra = readJson(H.caseDir(caseId, 'cache', 'extra_witnesses.json'), []) || [];
  for (const w of extra) if (w && w.id && !world.witnesses.some((x) => x.id === w.id)) world.witnesses.push({ ...w, source: 'live statement' });

  const findings = Array.isArray(W.state.findings) ? W.state.findings : [];
  const key = keyTime(world, findings);
  const t = clampT(opts.t != null ? Number(opts.t) : key.t);

  // checks: cached state checks, else run them now (checks.runAll moves the world; we re-pose afterwards)
  const ck = await H.tryImport('checks/checks.js');
  let checks = Array.isArray(W.state.checks) && W.state.checks.length ? W.state.checks : null, checksSource = checks ? 'cache/state.json' : null;
  if (!checks && ck && typeof ck.runAll === 'function') {
    try { checks = await ck.runAll(world); checksSource = 'checks/checks.js runAll (computed at export)'; } catch (e) { checks = []; checksSource = `checks failed: ${errMsg(e)}`; }
  }
  const kinematicLabel = (ck && typeof ck.KINEMATIC_LABEL === 'string') ? ck.KINEMATIC_LABEL : KINEMATIC_FALLBACK;

  // ---- sample every object at 10 Hz over [0, duration] ----
  const ids = Object.keys(world.objects);
  const n = Math.max(1, Math.round(duration * SAMPLE_HZ)) + 1;
  const times = Array.from({ length: n }, (_, i) => (i === n - 1 ? duration : r3(i / SAMPLE_HZ)));
  const v = new THREE.Vector3(), q = new THREE.Quaternion(), fwd = new THREE.Vector3();
  const samples = Object.fromEntries(ids.map((id) => [id, []]));
  const local = Object.fromEntries(ids.map((id) => [id, { pos: [], quat: [] }]));
  for (const ti of times) {
    world.setTime(ti);
    world.root.updateMatrixWorld(true);
    for (const id of ids) {
      const o = world.objects[id], node = o && o.node;
      if (!node) continue;
      node.getWorldPosition(v); node.getWorldQuaternion(q);
      fwd.set(0, 0, -1).applyQuaternion(q);
      const k = { t: ti, position: [r3(v.x), r3(v.y), r3(v.z)], quaternion: q.toArray().map((x) => Math.round(x * 1e5) / 1e5),
        bearingDeg: Math.round((((Math.atan2(fwd.x, -fwd.z) * 180 / Math.PI) + 360) % 360) * 10) / 10, visible: isShown(node) };
      if (typeof o.state === 'function') { try { k.state = o.state(ti); } catch { /* ignore */ } }
      samples[id].push(k);
      local[id].pos.push(node.position.x, node.position.y, node.position.z);
      local[id].quat.push(node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w);
    }
  }
  const dynamic = (id) => {
    const s = samples[id]; if (!s.length) return false;
    const a = s[0];
    return s.some((k) => k.visible !== a.visible || k.state !== a.state || k.position.some((x, i) => Math.abs(x - a.position[i]) > 1e-3) || k.quaternion.some((x, i) => Math.abs(x - a.quaternion[i]) > 1e-4));
  };
  for (const id of ids) {
    const s = samples[id];
    for (let i = 0; i < s.length; i++) {
      const a = s[Math.max(0, i - 1)], b = s[Math.min(s.length - 1, i + 1)];
      const dt = b.t - a.t;
      s[i].speedMps = dt > 0 ? Math.round(Math.hypot(b.position[0] - a.position[0], b.position[2] - a.position[2]) / dt * 100) / 100 : 0;
    }
  }

  // ---- pose at t, tag nodes, add witness cameras ----
  world.setTime(t);
  world.root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const objectsOut = [];
  for (const id of ids) {
    const o = world.objects[id]; const node = o && o.node;
    if (!node) continue;
    if (!node.name) node.name = id;
    const citation = o.citation || null;
    let stateAtT;
    if (typeof o.state === 'function') { try { stateAtT = o.state(t); } catch { /* ignore */ } }
    Object.assign(node.userData, { sightlineId: id, kind: o.kind || null, label: o.label || id, citation,
      inferred: /inferred/i.test(citation || ''), occludes: !!o.occludes, ...(stateAtT !== undefined ? { signalState: stateAtT } : {}) });
    box.setFromObject(node);
    const isDyn = dynamic(id);
    objectsOut.push({ id, kind: o.kind || null, label: o.label || id, citation, inferred: /inferred/i.test(citation || ''), occludes: !!o.occludes,
      assetType: node.userData.assetType || null, dims: node.userData.dims || null, gltfNode: node.name,
      atT: { t, ...samples[id].find((k) => Math.abs(k.t - t) < 0.051) || {}, position: (node.getWorldPosition(v), [r3(v.x), r3(v.y), r3(v.z)]),
        bbox: box.isEmpty() ? null : { min: box.min.toArray().map(r3), max: box.max.toArray().map(r3) }, ...(stateAtT !== undefined ? { state: stateAtT } : {}) },
      dynamic: isDyn, keyframes: isDyn ? samples[id] : samples[id].slice(0, 1) });
  }

  const aim = (lookAt) => {
    if (Array.isArray(lookAt)) return new THREE.Vector3(...lookAt.map(Number));
    const o = world.objects[lookAt];
    if (!o || !o.node) return null;
    box.setFromObject(o.node);
    return box.isEmpty() ? o.node.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
  };
  const sightOf = (wid) => (checks || []).find((c) => c && c.check === 'sightline' && c.subject === wid) || null;
  const cams = new THREE.Group(); cams.name = 'witness_cameras';
  const witnessesOut = [];
  for (const w of world.witnesses) {
    const p = Array.isArray(w.position) ? w.position.map(Number) : [0, 0, 0];
    const eyeH = w.eyeHeight != null ? Number(w.eyeHeight) : 1.6;
    const eye = new THREE.Vector3(p[0], (p[1] || 0) + eyeH, p[2]);
    const target = aim(w.lookAt) || new THREE.Vector3(p[0], eyeH, p[2] - 10);
    const cam = new THREE.PerspectiveCamera(FOV_DEG, ASPECT, 0.1, 3000);
    cam.name = `cam_${w.id}`;
    cam.position.copy(eye); cam.up.set(0, 1, 0); cam.lookAt(target);
    cam.userData = { witnessId: w.id, label: w.name || w.id, claim: w.claim || null, citation: w.citation || null,
      positionCitation: w.positionCitation || null, observationTime: w.observationTime ?? null, lookAt: w.lookAt ?? null,
      fovDeg: FOV_DEG, fovAxis: 'vertical', aspect: ASPECT, source: w.source || 'world' };
    cams.add(cam);
    witnessesOut.push({ id: w.id, name: w.name || w.id, source: w.source || 'world', position: p, eyeHeight: eyeH, eye: eye.toArray().map(r3),
      lookAt: w.lookAt ?? null, lookAtPointAtT: target.toArray().map(r3), observationTime: w.observationTime ?? null,
      claim: w.claim || null, citation: w.citation || null, positionCitation: w.positionCitation || null,
      camera: { gltfNode: cam.name, fovDeg: FOV_DEG, fovAxis: 'vertical', aspect: ASPECT, near: 0.1, far: 3000 }, sightlineCheck: sightOf(w.id) });
  }

  const fictional = /fictional/i.test([world.meta && world.meta.source, ...world.witnesses.map((w) => `${w.name} ${w.citation}`)].join(' '));
  const labels = [DRAFT_LABEL, ...(fictional ? [FICTION_LABEL] : []), SIMULATED_VIEW_LABEL, kinematicLabel];
  const provFile = W.file.replace(/\.js$/, '.provenance.json');
  const provenance = {
    world: W.url, worldSha256: sha256(worldSrc), worldProvenance: readJson(provFile, null),
    exporter: { module: 'server/scene_export.js', version: EXPORT_VERSION, three: THREE.REVISION, gltf: 'GLTFExporter (binary)' },
    mode: process.env.SIGHTLINE_MODE || 'mock', exportedAt: new Date().toISOString(),
  };
  const meta = { caseId, title: manifest.title || (world.meta && world.meta.title) || caseId, world: W.url, worldMeta: world.meta || null,
    duration, sampleHz: SAMPLE_HZ, sampleCount: n, keyTime: key, glbTime: t, ...AXES, labels };

  // ---- GLB ----
  const scene = new THREE.Scene();
  scene.name = `sightline_${caseId}`;
  scene.add(world.root);
  scene.add(cams);
  world.root.traverse((o) => { if (o.isLight) o.visible = false; }); // lighting is the studio's call; sun is recorded in extras
  let sun = null;
  world.root.traverse((o) => { if (o.isDirectionalLight && (!sun || o.name === 'light_sun')) sun = o; });
  const sunDir = sun ? sun.getWorldPosition(new THREE.Vector3()).sub(sun.target.getWorldPosition(new THREE.Vector3())).normalize().toArray().map(r3) : null;
  scene.userData = { sightline: { caseId, title: meta.title, world: W.url, worldSha256: provenance.worldSha256, t, keyTime: key, duration,
    units: AXES.units, axes: AXES.axes, labels, sunDirection: sunDir, timeOfDay: world.meta && world.meta.timeOfDay,
    witnessCameras: witnessesOut.map((w) => w.camera.gltfNode), animation: 'timeline (10 Hz, dynamic objects, t in seconds)', exportedAt: provenance.exportedAt } };

  // timeline animation for dynamic objects that are present in the exported (visible-at-t) hierarchy
  const tracks = [];
  for (const id of ids) {
    const node = world.objects[id] && world.objects[id].node;
    if (!node || !isShown(node) || !dynamic(id)) continue;
    tracks.push(new THREE.VectorKeyframeTrack(`${node.uuid}.position`, times, local[id].pos));
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.uuid}.quaternion`, times, local[id].quat));
  }
  // Node has no <canvas>, and GLTFExporter needs one to encode ANY texture (v2 asset materials carry metal/rough/colour maps):
  // export untextured copies of those materials (geometry, colours and PBR factors are kept; shared asset materials untouched).
  const untextured = (m) => {
    if (!m || !Object.values(m).some((x) => x && x.isTexture)) return m;
    const c = m.clone();
    for (const k of Object.keys(c)) if (c[k] && c[k].isTexture) c[k] = null;
    return c;
  };
  if (typeof document === 'undefined') scene.traverse((o) => { if (o.material) o.material = Array.isArray(o.material) ? o.material.map(untextured) : untextured(o.material); });
  const exportOpts = { binary: true, onlyVisible: true };
  let glbAb;
  const warn = console.warn; console.warn = () => {}; // GLTFExporter warns about non-serialisable userData functions
  try {
    try { glbAb = await new GLTFExporter().parseAsync(scene, tracks.length ? { ...exportOpts, animations: [new THREE.AnimationClip('timeline', duration, tracks)] } : exportOpts); }
    catch { glbAb = await new GLTFExporter().parseAsync(scene, exportOpts); }
  } finally { console.warn = warn; }
  const glb = Buffer.from(glbAb);
  provenance.glbSha256 = sha256(glb);

  // ---- JSON ----
  const json = {
    meta, objects: objectsOut, witnesses: witnessesOut,
    facts: Array.isArray(world.facts) ? world.facts : [], skids: Array.isArray(world.skids) ? world.skids : [],
    confirmedFacts: readJson(H.caseDir(caseId, 'confirmed_facts.json'), null),
    extraction: readJson(H.caseDir(caseId, 'cache', 'extraction.json'), null),
    findings, checks: { source: checksSource, results: checks || [], validation: readJson(H.caseDir(caseId, 'cache', 'validation.json'), null) },
    provenance,
  };
  return { glb, json, t };
}

export function readmeText(json) {
  const m = json.meta;
  return [
    `SIGHTLINE SCENE EXPORT - ${m.title}`,
    '',
    ...m.labels.map((l) => '*** ' + l),
    '',
    `Case: ${m.caseId}    World: ${m.world}    Exported: ${json.provenance.exportedAt}`,
    `scene.glb is posed at t = ${m.glbTime} s (${m.keyTime.reason}); timeline 0..${m.duration} s.`,
    '',
    'FILES',
    '  scene.glb   glTF 2.0 binary. Node names = world object ids (veh_, occ_, sig_, road_, mark_, bld_ ...).',
    '              Labels, citations, kind, inferred flag and signal state are in each node\'s glTF "extras"',
    '              (Blender: Object Properties > Custom Properties). Scene extras hold case meta + labels.',
    `              Cameras cam_<witness id>: witness eye position, ${FOV_DEG} deg vertical FOV, 16:9, aimed at the witness's lookAt target at t.`,
    '              Animation "timeline": 10 Hz position/rotation keys for moving objects (time in seconds).',
    '              Lights are not included (sun direction is in scene extras).',
    '  scene.json  meta, objects (id, label, citation, pose at t, keyframes sampled at 10 Hz over [0, duration]),',
    '              witnesses (eye, lookAt, claim, citations, camera, sightline check), facts, skids, confirmed facts /',
    '              extraction (if present), findings, checks + validation, provenance (hashes, model, inputs).',
    '',
    'UNITS AND AXES',
    '  meters, seconds, m/s, degrees.',
    '  -Z = north, +X = east, Y = up, ground at y = 0. (Blender glTF import: +X east, +Y north, Z up.)',
    `  ${AXES.bearing}.`,
    '  Citations containing "inferred" are modelling assumptions, not cited evidence.',
    '',
    'This file is an analysis draft produced by software for review by a qualified reconstruction expert.',
    'It is not evidence and has not been validated for court use.',
    '',
  ].join('\n');
}

export async function buildZip(glb, json) {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('README.txt', readmeText(json));
  zip.file('scene.glb', glb);
  zip.file('scene.json', JSON.stringify(json, null, 2));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/** Build + write cases/<id>/exports/scene.{glb,json,zip}. */
export async function writeSceneCache(ROOT, caseId, opts = {}) {
  const { glb, json, t } = await buildSceneExport(ROOT, caseId, opts);
  const dir = path.join(ROOT, 'cases', caseId, 'exports');
  fs.mkdirSync(dir, { recursive: true });
  const zip = await buildZip(glb, json);
  fs.writeFileSync(path.join(dir, 'scene.glb'), glb);
  fs.writeFileSync(path.join(dir, 'scene.json'), JSON.stringify(json, null, 2));
  fs.writeFileSync(path.join(dir, 'scene.zip'), zip);
  return { glb, json, zip, t, dir };
}

export function mountSceneExport(app, ctx = {}) {
  const ROOT = ctx.ROOT || DEFAULT_ROOT;
  const MODE = ctx.MODE || process.env.SIGHTLINE_MODE || 'mock';
  const H = makeHelpers(ROOT);
  const inflight = new Map(); // key -> Promise<{glb,json,zip?}>
  const exportDir = (id) => H.caseDir(id, 'exports');

  // Cached files are used when: mock mode + demo case (always), or the cached JSON matches the current world content.
  function cached(id) {
    const d = exportDir(id);
    const f = { glb: path.join(d, 'scene.glb'), json: path.join(d, 'scene.json'), zip: path.join(d, 'scene.zip') };
    if (!fs.existsSync(f.glb) || !fs.existsSync(f.json) || !fs.existsSync(f.zip)) return null;
    if (MODE === 'mock' && id === 'demo') return f;
    const j = readJson(f.json);
    const W = H.resolveWorld(id);
    if (!j || !W || j.meta?.world !== W.url || j.provenance?.worldSha256 !== sha256(fs.readFileSync(W.file))) return null;
    return f;
  }

  async function get(id, tParam, want) {
    if (!validId(id) || !fs.existsSync(H.caseDir(id, 'case.json'))) throw new HttpError(404, 'no such case');
    let t = null;
    if (tParam !== undefined && tParam !== '') {
      t = Number(tParam);
      if (!Number.isFinite(t)) throw new HttpError(400, 't must be a number (seconds)');
    }
    const c = cached(id);
    if (c) {
      const meta = readJson(c.json)?.meta;
      if (want === 'json' || t == null || Math.abs(t - (meta?.glbTime ?? -1)) < 1e-6) return { file: c[want], cache: 'hit' };
    }
    const key = `${id}|${t}`;
    if (!inflight.has(key)) {
      inflight.set(key, (async () => {
        if (t == null) { const r = await writeSceneCache(ROOT, id); return { ...r }; }
        const r = await buildSceneExport(ROOT, id, { t });
        return { ...r, zip: await buildZip(r.glb, r.json) };
      })().finally(() => setTimeout(() => inflight.delete(key), 0)));
    }
    const r = await inflight.get(key);
    const body = want === 'glb' ? r.glb : want === 'zip' ? r.zip : Buffer.from(JSON.stringify(r.json, null, 2));
    return { body, cache: 'miss' };
  }

  const send = (want, type) => async (req, res) => {
    const id = req.params.id;
    try {
      const r = await get(id, req.query.t, want);
      res.set('X-Scene-Cache', r.cache);
      res.type(type);
      if (want !== 'json' || req.query.download) res.set('Content-Disposition', `attachment; filename="sightline_${id}_scene.${want}"`);
      if (r.file) return res.sendFile(r.file);
      res.send(r.body);
    } catch (e) {
      res.status(e.status || 500).json({ error: errMsg(e) });
    }
  };
  app.get('/api/cases/:id/scene.glb', send('glb', 'model/gltf-binary'));
  app.get('/api/cases/:id/scene.json', send('json', 'application/json'));
  app.get('/api/cases/:id/scene.zip', send('zip', 'application/zip'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [id = 'demo', tArg] = process.argv.slice(2);
  const r = await writeSceneCache(DEFAULT_ROOT, id, tArg != null ? { t: Number(tArg) } : {});
  console.log(`wrote ${path.relative(DEFAULT_ROOT, r.dir)}/scene.{glb,json,zip} t=${r.t} glb=${(r.glb.length / 1024).toFixed(0)}KB json=${(JSON.stringify(r.json).length / 1024).toFixed(0)}KB zip=${(r.zip.length / 1024).toFixed(0)}KB objects=${r.json.objects.length} witnesses=${r.json.witnesses.length}`);
}
