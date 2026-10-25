// argon/validate_world.js — contract validation of an Argon-written world module (WORLD CONTRACT v1 + v2).
//   import { validateWorldSource, validateWorldFile, logValidation } from './validate_world.js';
//   const v = await validateWorldSource(src, { caseId });   // → { ok, errors[], warnings[], stats }
// CLI: node argon/validate_world.js <world.js> [--json]
//
// Steps: static scan (export default createWorld; no import/require/fetch/eval/Function/DOM/random/clock) → syntax check
// (node --check) → ISOLATED runtime check in a child process with a timeout (createWorld(THREE, recordingAssets)):
// required keys, id prefixes, node.name, citations on every object/witness/fact, "inferred" labelling, witness on ground,
// lookAt resolves, deterministic setTime over [0,duration], positions finite and in scene bounds, only catalog asset
// methods/types, sane lane widths, kinematic plausibility (checks/physics.js plausibilityCheck; pre-impact failures).
// Errors are sent back to Argon in ONE repair round (argon/generate_world.js); warnings are logged only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SELF = fileURLToPath(import.meta.url);

export const ID_PREFIX = /^(veh|occ|sig|road|mark|bld|ped)_[\w-]+$/;
export const SCENE_BOUNDS_M = 2000;
const EVIDENCE_REF = /(\.(md|txt|pdf|mp4|mov|webm|png|jpe?g|srt|vtt|docx?|csv|json)\b)|\bpp?\.\s*\d|\bdepo\w*\b|\b\d{1,2}:\d{2}\b|§|exhibit|report|statement|deposition|transcript|testimony|diagram|photo|video|figure|fig\.|table|ntsb|police|record/i;
const UNSOURCED = /\b(typical|assumed|assumption|estimate[sd]?|not in (the )?record|standard value|default|approximate(ly)? placed|placeholder)\b/i;

// ---------------------------------------------------------------- static
export function staticScan(src) {
  const errors = [], warnings = [];
  if (!/export\s+default\s+function\s*(createWorld)?\s*\(/.test(src)) errors.push('module must `export default function createWorld(THREE, assets) { ... }`');
  const banned = [
    [/^\s*import\s[\s\S]*?from\s|^\s*import\s*\(|\bimport\s*\(/m, 'no import statements / dynamic import (THREE and assets are passed in)'],
    [/\brequire\s*\(/, 'no require()'], [/\bfetch\s*\(/, 'no fetch()'], [/\beval\s*\(/, 'no eval()'],
    [/\bnew\s+Function\b|\bFunction\s*\(/, 'no Function constructor'], [/\bXMLHttpRequest\b|\bWebSocket\b/, 'no network APIs'],
    [/\bprocess\.|\bglobalThis\b|\bwindow\.|\bdocument\.|\blocalStorage\b/, 'no globals / DOM / process access'],
    [/\bMath\.random\s*\(/, 'no Math.random (setTime must be deterministic)'], [/\bDate\.now\s*\(|\bnew\s+Date\s*\(|performance\.now/, 'no clock access (setTime must be deterministic)'],
    [/\bsetTimeout\b|\bsetInterval\b|\brequestAnimationFrame\b|\basync\s+function\b|\bawait\b/, 'no timers/async'],
  ];
  for (const [re, msg] of banned) if (re.test(src)) errors.push(msg);
  const lights = src.match(/new\s+THREE\.(DirectionalLight|SpotLight|PointLight|HemisphereLight|AmbientLight|RectAreaLight)\b/g);
  if (lights) errors.push(`module creates its own lights (${[...new Set(lights.map((l) => l.replace(/new\s+THREE\./, '')))].join(', ')}); remove them — sun/sky come only from assets.environment({ date, timeOfDay, utcOffset, timeZone, lat, lon, weather }) with the case's cited values`);
  const geo = (src.match(/new\s+THREE\.\w+Geometry\b/g) || []).length;
  if (geo) warnings.push(`module builds ${geo} THREE geometr${geo === 1 ? 'y' : 'ies'} itself; v2 worlds should only place library assets`);
  return { errors, warnings, geometryCalls: geo };
}

export function syntaxCheck(file) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 20000 });
  if (r.status === 0) return null;
  const msg = (r.stderr || r.stdout || 'syntax check failed').split('\n').filter((l) => l.trim() && !/^\s*at\s|^Node\.js/.test(l)).slice(0, 6).join(' | ');
  return 'syntax error: ' + msg.replace(new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'world.js');
}

// ---------------------------------------------------------------- runtime (runs in the child process)
async function runtimeCheck(file) {
  const errors = [], warnings = [];
  const THREE = await import('three');
  const am = await import(pathToFileURL(path.join(ROOT, 'web', 'assets.js')).href);
  const calls = [];
  const base = await am.loadAssets(THREE, { headless: true, onCall: (method, args) => calls.push({ method, args }) });
  const methods = new Set(am.ASSET_METHODS);
  const assets = new Proxy(base, {
    get(t, k) {
      if (typeof k !== 'string' || k in t) return t[k];
      errors.push(`assets.${k} is not in the asset catalog (allowed: ${am.ASSET_METHODS.join(', ')})`);
      return (...a) => t.groundPlane({ id: 'unknown_' + k, size: 1 });
    },
  });
  const typeErr = (m, args) => { if (!am.VEHICLE_TYPES.includes(args[0])) errors.push(`assets.${m}('${args[0]}') — unknown vehicle type; use one of ${am.VEHICLE_TYPES.join(', ')}`); };
  const origV = base.vehicle, origP = base.parkedVehicle;
  base.vehicle = (type, o) => { typeErr('vehicle', [type]); return origV(type, o); };
  base.parkedVehicle = (type, o) => { typeErr('parkedVehicle', [type]); return origP(type, o); };

  const mod = await import(pathToFileURL(file).href + '?v=' + Date.now());
  if (typeof mod.default !== 'function') return { errors: ['no default export function'], warnings, stats: {} };
  let world;
  try { world = mod.default(THREE, assets); } catch (e) { return { errors: [`createWorld threw: ${e.message}`], warnings, stats: {} }; }
  if (!world || typeof world !== 'object') return { errors: ['createWorld returned nothing'], warnings, stats: {} };

  // required keys
  const m = world.meta || {};
  for (const k of ['caseId', 'title', 'timeOfDay', 'lighting', 'source']) if (!m[k]) errors.push(`meta.${k} missing`);
  if (m.lighting && !['dawn', 'day', 'dusk', 'night'].includes(m.lighting)) errors.push(`meta.lighting "${m.lighting}" must be dawn|day|dusk|night`);
  if (m.timeOfDay && !/^\d{1,2}:\d{2}/.test(String(m.timeOfDay))) errors.push(`meta.timeOfDay "${m.timeOfDay}" must be "HH:MM" (24 h, from the evidence)`);
  if (m.lighting && m.timeOfDay && /^\d/.test(m.timeOfDay)) {
    const h = Number(String(m.timeOfDay).split(':')[0]) + Number(String(m.timeOfDay).split(':')[1] || 0) / 60;
    if (h >= 9 && h <= 16.75 && m.lighting !== 'day') warnings.push(`meta.lighting "${m.lighting}" at ${m.timeOfDay}: expected "day" (check the case's own date/time/location)`);
  }
  if (!world.root?.isObject3D) errors.push('root must be a THREE.Object3D (Group)');
  if (!(Number.isFinite(world.duration) && world.duration > 0 && world.duration <= 300)) errors.push(`duration must be a number of seconds in (0, 300], got ${world.duration}`);
  if (typeof world.setTime !== 'function') errors.push('setTime(t) missing');
  if (!world.objects || typeof world.objects !== 'object') errors.push('objects missing');
  if (!Array.isArray(world.witnesses)) errors.push('witnesses[] missing');
  if (!Array.isArray(world.facts)) errors.push('facts[] missing');
  if (!(Number.isFinite(m.impactT) || (world.facts || []).some((f) => /impact/i.test(`${f.id} ${f.text}`) && f.unit === 's'))) warnings.push('meta.impactT (event-clock time of impact, s) missing');
  if (errors.length && (!world.root || typeof world.setTime !== 'function' || !world.objects)) return { errors, warnings, stats: {} };

  const objects = world.objects || {};
  const ids = Object.keys(objects);
  const inferredCount = { inferred: 0, unlabeled: 0 };
  const citeCheck = (where, c) => {
    if (typeof c !== 'string' || !c.trim()) { errors.push(`${where}: citation missing`); return; }
    if (/inferred/i.test(c)) { inferredCount.inferred++; return; }
    if (UNSOURCED.test(c)) { errors.push(`${where}: citation "${c.slice(0, 80)}" is not from the evidence — prefix it with "inferred: "`); inferredCount.unlabeled++; return; }
    if (!EVIDENCE_REF.test(c)) warnings.push(`${where}: citation "${c.slice(0, 60)}" names no evidence file/page/timecode (if it is not from the record, label it "inferred: ...")`);
  };
  for (const [id, o] of Object.entries(objects)) {
    if (!ID_PREFIX.test(id)) errors.push(`object id "${id}" must start with veh_|occ_|sig_|road_|mark_|bld_|ped_`);
    if (!o || !o.node?.isObject3D) { errors.push(`${id}: node is not a THREE.Object3D`); continue; }
    if (o.node.name !== id) errors.push(`${id}: node.name must equal the id (got "${o.node.name}")`);
    let inRoot = false; for (let n = o.node; n; n = n.parent) if (n === world.root) inRoot = true;
    if (!inRoot) errors.push(`${id}: node is not under world.root`);
    if (typeof o.kind !== 'string' || !o.kind) errors.push(`${id}: kind missing`);
    if (typeof o.label !== 'string' || !o.label) errors.push(`${id}: label missing`);
    if (typeof o.occludes !== 'boolean') errors.push(`${id}: occludes must be true/false`);
    citeCheck(id, o.citation);
    const isSign = o.node.userData?.assetType === 'sign' || o.kind === 'sign';
    if ((o.kind === 'signal' && !isSign) || typeof o.state === 'function') {   // signs need no state(t)
      if (typeof o.state !== 'function') errors.push(`${id}: traffic signal (kind 'signal') needs state(t)`);
      else for (let t = 0; t <= (world.duration || 0); t += Math.max(0.25, world.duration / 40)) {
        let s; try { s = o.state(t); } catch (e) { errors.push(`${id}: state(${t}) threw ${e.message}`); break; }
        if (!['red', 'yellow', 'green', 'off'].includes(s)) { errors.push(`${id}: state(${t.toFixed(2)}) returned "${s}"`); break; }
      }
    }
    if (id.startsWith('veh_')) {
      let lib = false; o.node.traverse((n) => { if (n.userData?.assetType) lib = true; });
      if (!lib) warnings.push(`${id}: not built from assets.vehicle(...) (v2 worlds place library vehicles)`);
    }
  }
  if (!ids.some((k) => k.startsWith('veh_'))) errors.push('no veh_ objects');

  for (const w of world.witnesses || []) {
    const W = `witness ${w?.id}`;
    if (!/^wit_[\w-]+$/.test(w?.id || '')) errors.push(`${W}: id must start with wit_`);
    if (!w.name) errors.push(`${W}: name missing`);
    if (!Array.isArray(w.position) || w.position.length !== 3 || !w.position.every(Number.isFinite)) { errors.push(`${W}: position must be [x, y, z] numbers`); continue; }
    if (Math.abs(w.position[1]) > 0.5) errors.push(`${W}: position y=${w.position[1]} — witnesses stand on the ground (y=0); eye height goes in eyeHeight`);
    if (Math.abs(w.position[0]) > SCENE_BOUNDS_M || Math.abs(w.position[2]) > SCENE_BOUNDS_M) errors.push(`${W}: position out of scene bounds (±${SCENE_BOUNDS_M} m)`);
    if (!(Number.isFinite(w.eyeHeight) && w.eyeHeight >= 0.3 && w.eyeHeight <= 5)) errors.push(`${W}: eyeHeight must be 0.3–5 m (got ${w.eyeHeight})`);
    if (!(Array.isArray(w.lookAt) && w.lookAt.length === 3 && w.lookAt.every(Number.isFinite)) && !objects[w.lookAt]) errors.push(`${W}: lookAt "${w.lookAt}" is not an object id or [x,y,z]`);
    if (!(w.observationTime >= 0 && w.observationTime <= world.duration)) errors.push(`${W}: observationTime ${w.observationTime} outside [0, duration]`);
    if (!w.claim) errors.push(`${W}: claim missing`);
    citeCheck(W, w.citation);
  }
  for (const f of world.facts || []) { if (!f.id || !f.text) errors.push(`fact ${f?.id}: id/text missing`); citeCheck(`fact ${f?.id}`, f?.citation); }
  for (const s of world.skids || []) { if (!objects[s.vehicle]) errors.push(`skid: vehicle "${s.vehicle}" not in objects`); if (!(s.length > 0)) errors.push(`skid ${s.vehicle}: length must be > 0`); citeCheck(`skid ${s.vehicle}`, s.citation); }

  // lighting must come from the library's environment(), computed from the case's own date/time/place
  const envCalls = calls.filter((c) => c.method === 'environment');
  let sun = null;
  if (!envCalls.length) errors.push('no assets.environment(...) call: add root.add(assets.environment({ date, timeOfDay, utcOffset, timeZone, lat, lon, lighting, weather })) with the case\'s cited date/time/location/weather');
  else {
    const a = envCalls[0].args[0] || {};
    const miss = ['date', 'timeOfDay', 'lat', 'lon'].filter((k) => a[k] === undefined || a[k] === null || a[k] === '');
    if (miss.length) errors.push(`assets.environment(...) is missing ${miss.join(', ')} — pass the case's own date, local time, latitude/longitude (approximate from the named place if needed) so the sun is computed, not guessed`);
    if (!a.utcOffset && !a.timeZone) warnings.push('assets.environment: no utcOffset/timeZone; local time is converted with a longitude guess (no DST)');
    if (envCalls.length > 1) warnings.push(`assets.environment called ${envCalls.length} times (once is enough)`);
    let envNode = null; world.root.traverse((n) => { if (!envNode && n.userData?.isEnvironment) envNode = n; });
    if (!envNode) errors.push('the assets.environment(...) result is not added under world.root');
    const sk = envNode?.userData?.sky || {};
    const az = sk.sunAzimuth ?? sk.sunAzimuthDeg, el = sk.sunElevation ?? sk.sunElevationDeg;
    if (Number.isFinite(az)) sun = { azimuthDeg: Math.round(az * 10) / 10, elevationDeg: Math.round(el * 10) / 10 };
  }

  // asset call sanity (lanes 3.0–3.7 m)
  for (const c of calls) {
    if (c.method === 'road') {
      const lw = c.args[0]?.laneWidth;
      if (Number.isFinite(lw) && (lw < 2.5 || lw > 4.5)) errors.push(`road ${c.args[0]?.id || ''}: laneWidth ${lw} m is not a traffic lane (use 3.0–3.7 m; widen with more lanes or a shoulder)`);
      else if (Number.isFinite(lw) && (lw < 3.0 || lw > 3.7)) warnings.push(`road ${c.args[0]?.id || ''}: laneWidth ${lw} m outside the usual 3.0–3.7 m`);
    }
  }

  // determinism + bounds over [0, duration]
  const dur = world.duration;
  const N = 48, ts = Array.from({ length: N + 1 }, (_, i) => (dur * i) / N);
  const v = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  const snap = () => {
    world.root.updateMatrixWorld(true);
    return ids.map((id) => {
      const n = objects[id].node; n.matrixWorld.decompose(v, q, s);
      const st = typeof objects[id].state === 'function' ? objects[id].state : null;
      return [v.x, v.y, v.z, q.x, q.y, q.z, q.w, st ? 0 : 0].map((x) => Math.round(x * 1e5) / 1e5).join(',') + (n.visible ? '' : 'h');
    });
  };
  const fwd = [];
  let oob = new Map(), nan = new Set();
  try {
    for (const t of ts) {
      world.setTime(t);
      const sn = snap(); fwd.push(sn);
      sn.forEach((row, i) => {
        const [x, y, z] = row.split(',').map(Number);
        if (![x, y, z].every(Number.isFinite)) nan.add(ids[i]);
        else if (Math.abs(x) > SCENE_BOUNDS_M || Math.abs(z) > SCENE_BOUNDS_M || y < -20 || y > 80) { if (!oob.has(ids[i])) oob.set(ids[i], `t=${t.toFixed(2)} at [${x.toFixed(0)}, ${y.toFixed(1)}, ${z.toFixed(0)}]`); }
        else if (ids[i].startsWith('veh_') && (y < -1 || y > 6)) { if (!oob.has(ids[i])) oob.set(ids[i], `t=${t.toFixed(2)} y=${y.toFixed(2)} (vehicles sit on the ground, y≈0)`); }
      });
    }
    const bad = [];
    for (let k = N; k >= 0; k--) { world.setTime(ts[k]); const sn = snap(); sn.forEach((row, i) => { if (row !== fwd[k][i] && !bad.includes(ids[i])) bad.push(ids[i]); }); }
    world.setTime(ts[Math.floor(N / 3)]); world.setTime(ts[Math.floor(N / 3)]);
    if (snap().join('|') !== fwd[Math.floor(N / 3)].join('|')) bad.push('(repeat call)');
    if (bad.length) errors.push(`setTime is not deterministic (state depends on call history) for: ${bad.slice(0, 6).join(', ')} — compute every pose from t alone`);
  } catch (e) { errors.push(`setTime threw: ${e.message}`); }
  for (const id of nan) errors.push(`${id}: position becomes NaN/Infinity during setTime`);
  for (const [id, where] of oob) errors.push(`${id}: out of scene bounds ${where}`);
  const moving = ids.filter((id, i) => fwd.length && fwd.some((sn) => sn[i] !== fwd[0][i]));
  if (ids.some((k) => k.startsWith('veh_')) && !moving.length) warnings.push('nothing moves over [0, duration]');

  // kinematic plausibility (pre-impact accelerations ≤ limit, no teleports)
  let plaus = [];
  try {
    const ph = await import(pathToFileURL(path.join(ROOT, 'checks', 'physics.js')).href);
    plaus = ph.plausibilityCheck(world) || [];
    for (const p of plaus.filter((r) => !r.pass)) errors.push(`implausible motion of ${p.subject}: ${p.issues.join('; ')} — keyframes must give continuous speed (≤0.8 g before impact; ease/constant-acceleration segments; no teleports)`);
  } catch (e) { warnings.push('plausibility check unavailable: ' + e.message); }

  const assetStats = base.stats();
  return {
    errors, warnings,
    stats: { objects: ids.length, witnesses: (world.witnesses || []).length, facts: (world.facts || []).length, duration: dur, moving: moving.length,
      assetCalls: calls.length, assetMethods: [...new Set(calls.map((c) => c.method))], vehicleTypes: calls.filter((c) => c.method === 'vehicle' || c.method === 'parkedVehicle').map((c) => c.args[0]),
      sun, citations: inferredCount, plausibility: plaus.map((p) => ({ subject: p.subject, pass: p.pass, maxAccelG: p.maxAccelG, maxSpeedMph: p.maxSpeedMph })),
      assetFallbacks: Object.fromEntries(Object.entries(assetStats).filter(([, s]) => s.box || s.fallback).map(([k, s]) => [k, { fallback: s.fallback, box: s.box }])) },
  };
}

// ---------------------------------------------------------------- public API
/** Validate a module file. opts.timeoutMs (default 60 s) bounds the isolated child run. */
export async function validateWorldFile(file, { timeoutMs = 60000 } = {}) {
  const abs = path.resolve(file);
  const src = fs.readFileSync(abs, 'utf8');
  const st = staticScan(src);
  const errors = [...st.errors], warnings = [...st.warnings];
  const syn = syntaxCheck(abs);
  if (syn) return { ok: false, errors: [...errors, syn], warnings, stats: { lines: src.split('\n').length, chars: src.length } };
  const r = spawnSync(process.execPath, [SELF, '--child', abs], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 << 20, cwd: ROOT });
  let rt;
  if (r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM') rt = { errors: [`createWorld/setTime did not finish within ${timeoutMs / 1000} s (infinite loop?)`], warnings: [], stats: {} };
  else {
    const line = (r.stdout || '').trim().split('\n').reverse().find((l) => l.startsWith('{"__validate":'));
    try { rt = JSON.parse(line).__validate; } catch { rt = { errors: [`module failed in isolated import: ${(r.stderr || '').split('\n').filter(Boolean).slice(0, 3).join(' | ').slice(0, 400)}`], warnings: [], stats: {} }; }
  }
  errors.push(...rt.errors); warnings.push(...rt.warnings);
  return { ok: errors.length === 0, errors: dedupe(errors), warnings: dedupe(warnings), stats: { lines: src.split('\n').length, chars: src.length, geometryCalls: st.geometryCalls, ...rt.stats } };
}

/** Validate module source text (written to a temp file next to the case cache). */
export async function validateWorldSource(src, { caseId, dir } = {}) {
  const d = dir || (caseId ? path.join(ROOT, 'cases', caseId, 'cache') : path.join(ROOT, 'cache'));
  fs.mkdirSync(d, { recursive: true });
  const tmp = path.join(d, `.validate_${crypto.createHash('sha1').update(src).digest('hex').slice(0, 10)}.mjs`);
  fs.writeFileSync(tmp, src);
  try { return await validateWorldFile(tmp); } finally { try { fs.unlinkSync(tmp); } catch {} }
}

const dedupe = (a) => [...new Set(a)];

/** Format errors for the Argon repair prompt. */
export const formatErrors = (v) => v.errors.map((e, i) => `${i + 1}. ${e}`).join('\n');

/** Append one entry to cases/<id>/cache/world_validation.json and cache/world_validation_log.jsonl. */
export function logValidation(caseId, entry) {
  const e = { caseId, at: new Date().toISOString(), ...entry };
  try {
    const f = path.join(ROOT, 'cases', caseId, 'cache', 'world_validation.json');
    let arr = []; try { arr = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
    if (!Array.isArray(arr)) arr = [];
    arr.push(e); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(arr, null, 2));
    fs.mkdirSync(path.join(ROOT, 'cache'), { recursive: true });
    fs.appendFileSync(path.join(ROOT, 'cache', 'world_validation_log.jsonl'), JSON.stringify(e) + '\n');
  } catch (err) { console.warn('[validate_world] log failed:', err.message); }
  return e;
}

// ---------------------------------------------------------------- CLI / child
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  if (process.argv[2] === '--child') {
    runtimeCheck(path.resolve(process.argv[3]))
      .then((r) => { process.stdout.write('\n' + JSON.stringify({ __validate: r }) + '\n'); process.exit(0); })
      .catch((e) => { process.stdout.write('\n' + JSON.stringify({ __validate: { errors: [`isolated import failed: ${e.message}`], warnings: [], stats: {} } }) + '\n'); process.exit(0); });
  } else {
    const file = process.argv[2];
    if (!file) { console.error('usage: node argon/validate_world.js <world.js> [--json]'); process.exit(2); }
    const v = await validateWorldFile(file);
    if (process.argv.includes('--json')) console.log(JSON.stringify(v, null, 2));
    else {
      console.log(`${v.ok ? 'VALID' : 'INVALID'} ${file}: ${v.errors.length} error(s), ${v.warnings.length} warning(s)`);
      for (const e of v.errors) console.log('  ERROR ' + e);
      for (const w of v.warnings) console.log('  warn  ' + w);
      console.log('  stats ' + JSON.stringify(v.stats));
    }
    process.exit(v.ok ? 0 : 1);
  }
}
