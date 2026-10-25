// argon/world_plan.mjs — Argon plans the film (case-generic; no case facts in this file or its prompts).
//   A) shots_reference: Argon watches professional reference animations (YouTube URLs as fileData parts) and
//      breaks them down shot by shot  -> cases/<id>/plan/shots_reference.json
//   B) scene_spec: Argon writes a full cited scene graph of OUR site from the case evidence + latest world
//                                      -> cases/<id>/plan/scene_spec.json
//   C) shot_plan: Argon writes OUR film mirroring the reference grammar (consumed by the SHOT-RIG)
//                                      -> cases/<id>/plan/shot_plan.json
// A and B run in parallel, then C.
//   D) stills: 3–4 reference timestamps for a still-frame side-by-side -> shots_reference.json .stillFrames
//   node argon/world_plan.mjs [--case demo] [--step all|A|B|C|stills] [--ref <youtube url> ...]
//   SIGHTLINE_MODE=live to call Gemini (default mock = replay cases/<id>/cache/plan_*.json).
//   Optional per-case overrides: cases/<id>/plan/director_notes.md, cases/<id>/plan/references.json ([{id,url,label}]).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, ARGON_MODEL, callArgon, readPrompt, textPart, imagePart, writeJSON, readJSON, mode } from './client.js';
import { caseDirs, listEvidence, loadCaseText, caseMeta } from './case.js';

const DEFAULT_REFS = [
  { id: 'ref_esi', url: 'https://www.youtube.com/watch?v=Y7Api99fPuw', label: 'Professional forensic animation (traditional studio): night-time semi underride' },
  { id: 'ref_ziva', url: 'https://www.youtube.com/watch?v=JlXN-FTQxDE', label: 'Professional forensic animation (real-time engine sample)' },
];

const DEFAULT_DIRECTOR_NOTES = `Shot list wanted (mirror the reference grammar and order; adapt to this case's time of day and lighting from the evidence):
1. Opening title card(s): case title, location, date/time, "SIMULATED / FICTIONAL WITNESSES" if witnesses are fictional.
2. Aerial dissolve: ONLY if aerial/satellite imagery is in the evidence; otherwise mark optional and give a fallback (e.g. dissolve from the scene-diagram exhibit into a registered top-down 3D view).
3. 360-degree orbit of the conflict point / intersection, static vehicles at their pre-event positions.
4. Top-down tracking of all involved vehicles through the whole event (real time), with labels.
5. Title card + chase camera behind the striking vehicle into the collision, freezing at first contact.
6. Title card + eye view of every witness whose claim is about what they could see, at their marked position, with a live sight-line ray to the object of the claim at their observation time; hold on the decisive frame.
7. Closing card listing sources.`;

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const allArgs = (k) => args.flatMap((a, i) => (a === k && args[i + 1] ? [args[i + 1]] : []));

function latestWorld(d) {
  const files = fs.existsSync(d.worlds) ? fs.readdirSync(d.worlds).filter((f) => /^world_v\d+\.js$/.test(f)) : [];
  files.sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  return files.length ? path.join(d.worlds, files[files.length - 1]) : null;
}

async function sunFacts(caseId) {
  try {
    const { resolveScene } = await import('./solar.js');
    const env = await import(pathToFileURL(path.join(ROOT, 'web', 'assets', 'environment.js')).href);
    const s = resolveScene(caseId);
    if (!s.date || s.lat == null) return null;
    const { assumeUtcOffset } = await import('./solar.js');
    const off = s.utcOffset || assumeUtcOffset(s.date, s.time, s.lat, s.lon).utcOffset;
    const { date } = env.resolveDate(s.date, String(s.time || '12:00').slice(0, 8), off, s.lon);
    const p = env.solarPosition(date, s.lat, s.lon);
    return { ...s, utcOffset: off, sunAzimuthDeg: +p.azimuthDeg.toFixed(1), sunElevationDeg: +p.elevationDeg.toFixed(1), basis: 'NOAA solar position (web/assets/environment.js) at the evidence date/time and approx. location' };
  } catch (e) { return { error: e.message }; }
}

const meta = (r) => ({ model: r.model, mode: r.mode, cacheName: r.name, cachePath: path.relative(ROOT, r.cachePath),
  ...(readJSON(r.cachePath.replace(/\.json$/, '.meta.json')) || {}) });

async function callJSON(opts, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await callArgon({ ...opts, json: true }); } catch (e) { last = e; console.warn(`[plan] ${opts.name} attempt ${i + 1} failed: ${e.message}`); if (mode() !== 'live') break; }
  }
  throw last;
}

export async function shotsReference({ caseId = 'demo', refs } = {}) {
  const d = caseDirs(caseId);
  refs = refs?.length ? refs : readJSON(path.join(d.dir, 'plan', 'references.json')) || DEFAULT_REFS;
  const parts = [textPart(readPrompt('shots_reference'))];
  refs.forEach((r, i) => {
    parts.push(textPart(`\n=== VIDEO ${i + 1}: id "${r.id}", url ${r.url} — ${r.label || ''} ===`));
    parts.push({ fileData: { fileUri: r.url } });
  });
  parts.push(textPart('\nReturn the JSON now. Use the ids given above.'));
  const r = await callJSON({ name: 'plan_shots_reference', parts, maxOutputTokens: 65536, cacheDir: d.cache });
  return { data: r.data, meta: meta(r) };
}

export async function sceneSpec({ caseId = 'demo' } = {}) {
  const d = caseDirs(caseId);
  const inv = listEvidence(caseId);
  const wf = latestWorld(d);
  const sun = await sunFacts(caseId);
  const parts = [textPart(readPrompt('scene_spec')),
    textPart(`\n=== CASE ===\n${JSON.stringify({ caseId, title: caseMeta(caseId).title || null }, null, 2)}`),
    textPart(`\n=== COMPUTED LIGHTING (use for the lighting block) ===\n${JSON.stringify(sun, null, 2)}`),
    textPart(`\n=== TEXT EVIDENCE (cite these file names) ===\n${loadCaseText(caseId)}`)];
  for (const img of inv.images) {
    parts.push(textPart(`\n=== IMAGE EXHIBIT: evidence/${path.basename(img)} ===`));
    parts.push(imagePart(img));
  }
  if (wf) parts.push(textPart(`\n=== CURRENT WORLD MODULE (${path.relative(d.dir, wf)}; prior Argon output — positions here, e.g. witness marks read from deposition video exhibits, may be cited as "${path.basename(wf)} (<its citation>)") ===\n${fs.readFileSync(wf, 'utf8')}`));
  parts.push(textPart('\nReturn the JSON scene spec now.'));
  const r = await callJSON({ name: 'plan_scene_spec', parts, maxOutputTokens: 65536, cacheDir: d.cache });
  return { data: r.data, meta: meta(r), world: wf && path.relative(ROOT, wf) };
}

export async function shotPlan({ caseId = 'demo', reference, scene } = {}) {
  const d = caseDirs(caseId);
  const wf = latestWorld(d);
  const notes = fs.existsSync(path.join(d.dir, 'plan', 'director_notes.md')) ? fs.readFileSync(path.join(d.dir, 'plan', 'director_notes.md'), 'utf8') : DEFAULT_DIRECTOR_NOTES;
  const strip = (o) => { const { _provenance, ...x } = o || {}; return x; };
  const parts = [textPart(readPrompt('shot_plan')),
    textPart(`\n=== DIRECTOR NOTES ===\n${notes}`),
    textPart(`\n=== REFERENCE BREAKDOWN ===\n${JSON.stringify(strip(reference))}`),
    textPart(`\n=== SCENE SPEC ===\n${JSON.stringify(strip(scene))}`),
    textPart(`\n=== CURRENT WORLD (${wf ? path.relative(d.dir, wf) : 'none'}) ===\n${wf ? fs.readFileSync(wf, 'utf8') : '(none)'}`),
    textPart('\nReturn the JSON shot plan now.')];
  const r = await callJSON({ name: 'plan_shot_plan', parts, maxOutputTokens: 65536, cacheDir: d.cache });
  return { data: r.data, meta: meta(r), world: wf && path.relative(ROOT, wf) };
}

/** Pick 3–4 reference timestamps for still-frame side-by-side with OUR shots (needs A and, if present, C). */
export async function stillFrames({ caseId = 'demo', reference, plan } = {}) {
  const d = caseDirs(caseId);
  const refs = (reference?.videos || []).map((v) => ({ id: v.id, url: v.url }));
  const parts = [textPart(`You picked shots from these professional forensic animations earlier (breakdown below). Now choose the 3–4 BEST single timestamps for a still-frame side-by-side comparison against OUR film. Prefer frames that (a) show the scene geometry, vehicles and lighting clearly, (b) correspond to a shot type our film also has, (c) are not mid-dissolve or motion-blurred, and (d) together cover different shot types (e.g. orbit/establishing, top-down, chase at contact, witness eye). For each give: videoId, timestamp "mm:ss.s", sec, refShotN, shotType, whatToCompare (materials, markings, lighting, framing...), ourShotId (from OUR SHOT PLAN) and ourFilmSec (seconds into that shot that best matches the framing), and why. Return ONLY JSON: {"stillFrames":[...]}`)];
  for (const r of refs) { parts.push(textPart(`\n=== VIDEO "${r.id}" ${r.url} ===`)); parts.push({ fileData: { fileUri: r.url } }); }
  const brief = (o) => JSON.stringify(o, (k, v) => (k === '_provenance' ? undefined : v));
  parts.push(textPart(`\n=== REFERENCE BREAKDOWN ===\n${brief({ videos: reference?.videos?.map((v) => ({ id: v.id, shots: v.shots.map((s) => ({ n: s.n, start: s.start, end: s.end, type: s.type, description: s.description })) })) })}`));
  if (plan) parts.push(textPart(`\n=== OUR SHOT PLAN (summary) ===\n${brief(plan.shots.map((s) => ({ id: s.id, type: s.type, durationSec: s.durationSec, purpose: s.purpose, mirrors: s.mirrors })))}`));
  const r = await callJSON({ name: 'plan_still_frames', parts, maxOutputTokens: 16384, cacheDir: d.cache });
  return { data: r.data, meta: meta(r) };
}

// ---------- light sanity checks (reported, not fatal) ----------
export function lintScene(s) {
  const issues = [];
  const els = s?.elements || [];
  for (const e of els) {
    if (!e.citation) issues.push(`${e.id}: no citation`);
    if (!Array.isArray(e.position) || e.position.length !== 3 || e.position.some((v) => !Number.isFinite(v))) issues.push(`${e.id}: bad position`);
    if (!e.dimensions && !e.polyline) issues.push(`${e.id}: no dimensions/polyline`);
  }
  for (const w of s?.witnesses || []) if (!w.citation) issues.push(`${w.id}: witness without citation`);
  return { elements: els.length, inferred: els.filter((e) => /^inferred|^standard/i.test(e.citation || '')).length, vehicles: (s?.vehicles || []).length, witnesses: (s?.witnesses || []).length, issues };
}
export function lintPlan(p) {
  const issues = [];
  for (const sh of p?.shots || []) {
    const kf = sh.camera?.keyframes || [];
    if (sh.type !== 'title_card' && kf.length < 2) issues.push(`${sh.id}: <2 camera keyframes`);
    for (const k of kf) if (!Array.isArray(k.position) || k.position.length !== 3) { issues.push(`${sh.id}: bad keyframe position`); break; }
    if (sh.type !== 'title_card' && !Array.isArray(sh.sceneTimeMap)) issues.push(`${sh.id}: no sceneTimeMap`);
  }
  return { shots: (p?.shots || []).length, totalDurationSec: p?.totalDurationSec, issues };
}

async function main() {
  const caseId = arg('--case', process.env.SIGHTLINE_CASE || 'demo');
  const step = (arg('--step', 'all') || 'all').toUpperCase();
  const refs = allArgs('--ref').map((url, i) => ({ id: `ref_${i + 1}`, url, label: 'reference animation' }));
  const d = caseDirs(caseId);
  const outDir = path.join(d.dir, 'plan');
  fs.mkdirSync(outDir, { recursive: true });
  const out = (n) => path.join(outDir, n);
  const t0 = Date.now();
  console.log(`[plan] case=${caseId} mode=${mode()} model=${ARGON_MODEL} step=${step}`);

  let reference = readJSON(out('shots_reference.json'));
  let scene = readJSON(out('scene_spec.json'));
  const jobs = [];
  if (step === 'ALL' || step === 'A') jobs.push(shotsReference({ caseId, refs }).then((r) => {
    reference = { ...r.data, _provenance: { step: 'A', prompt: 'argon/prompts/shots_reference.md', ...r.meta } };
    writeJSON(out('shots_reference.json'), reference);
    console.log(`[plan] A shots_reference: ${(r.data.videos || []).map((v) => `${v.id}=${(v.shots || []).length} shots`).join(', ')}`);
  }));
  if (step === 'ALL' || step === 'B') jobs.push(sceneSpec({ caseId }).then((r) => {
    scene = { ...r.data, _provenance: { step: 'B', prompt: 'argon/prompts/scene_spec.md', world: r.world, ...r.meta } };
    writeJSON(out('scene_spec.json'), scene);
    console.log(`[plan] B scene_spec: ${JSON.stringify(lintScene(r.data)).slice(0, 600)}`);
  }));
  const settled = await Promise.allSettled(jobs);
  for (const s of settled) if (s.status === 'rejected') console.error('[plan] step failed:', s.reason?.message || s.reason);
  if (settled.some((s) => s.status === 'rejected')) process.exitCode = 1;

  if ((step === 'ALL' || step === 'C') && reference && scene) {
    const r = await shotPlan({ caseId, reference, scene });
    const plan = { ...r.data, _provenance: { step: 'C', prompt: 'argon/prompts/shot_plan.md', world: r.world,
      inputs: ['plan/shots_reference.json', 'plan/scene_spec.json'], ...r.meta } };
    writeJSON(out('shot_plan.json'), plan);
    console.log(`[plan] C shot_plan: ${JSON.stringify(lintPlan(r.data)).slice(0, 600)}`);
  } else if (step === 'ALL' || step === 'C') { console.error('[plan] C skipped: missing shots_reference or scene_spec'); process.exitCode = 1; }

  // Stills: 3–4 reference timestamps for the side-by-side, merged into shots_reference.json.
  if ((step === 'ALL' || step === 'STILLS') && reference) {
    const plan = readJSON(out('shot_plan.json'));
    const r = await stillFrames({ caseId, reference, plan });
    reference = readJSON(out('shots_reference.json')) || reference;
    reference.stillFrames = r.data.stillFrames || r.data;
    reference._provenance = { ...reference._provenance, stillFrames: { prompt: 'inline in argon/world_plan.mjs stillFrames()', ...r.meta } };
    writeJSON(out('shots_reference.json'), reference);
    console.log(`[plan] stills: ${(reference.stillFrames || []).map((f) => `${f.videoId}@${f.timestamp}->${f.ourShotId}`).join(', ')}`);
  }
  console.log(`[plan] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
