// argon/onepass_full.mjs — ONE-PASS stage world for a large case (default demo-full): a single gemini-4-argon long-decode
// call (Interactions API, background:true) reads the WHOLE case (all docket text, every deposition video via Files API,
// exhibit image, USGS aerial as ground-truth image) and writes the complete WORLD CONTRACT v2 module.
// Usage: node argon/onepass_full.mjs [caseId=demo-full] [--max=160000] [--resume=<interactionId>]
//   post stages: --stage=finish (truncation follow-up, validate, ONE repair, checks, save world_vN + provenance)
//                --stage=render --world=<path> (stills; run under scripts/render_lock.sh) · --stage=critique (ONE critique round, v+1, state.json, argon_only.json)
// Env: GEMINI_API_KEY, ARGON_LIVE=1, ARGON_MODEL (default gemini-4-argon).
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { ROOT, uploadVideo } from './client.js';
import { listEvidence, loadCaseText, caseVideos, evidenceSummary, fmtClock } from './case.js';

const args = process.argv.slice(2);
const caseId = args.find((a) => !a.startsWith('--')) || 'demo-full';
const maxTok = Number((args.find((a) => a.startsWith('--max=')) || '--max=160000').split('=')[1]);
const resumeId = (args.find((a) => a.startsWith('--resume=')) || '').split('=')[1];
const MODEL = process.env.ARGON_MODEL || 'gemini-4-argon';
const CASE = path.join(ROOT, 'cases', caseId);
const OUT = path.join(CASE, 'worlds', 'onepass');
fs.mkdirSync(OUT, { recursive: true });
const rd = (p) => fs.readFileSync(p, 'utf8');
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; console.log(s); fs.appendFileSync(path.join(OUT, 'run.log'), s + '\n'); };

function buildPrompt() {
  let base = rd(path.join(ROOT, 'argon', 'prompts', 'generate_world_v2.md'));
  // keep everything up to the compact-output section; replace the output rules with the long-form, high-visual-quality ones
  const cut = base.indexOf('# Output format — compact code');
  const tail = base.slice(base.indexOf('# World object (required keys)'));
  base = base.slice(0, cut) + LONG_OUTPUT + '\n\n' + tail;
  const ref = rd(path.join(ROOT, 'cases', 'demo', 'worlds', 'world_v1.js')).split('\n');
  const a = ref.findIndex((l) => l.startsWith('export default function createWorld'));
  const b = ref.findIndex((l) => l.includes('---------- evidence objects / occluders'));
  const apiSnippet = ref.slice(a, b).join('\n');
  const scene = "date 2016-05-07, 16:36:12 local, UTC-04:00 (America/New_York, EDT), lat 29.4106, lon -82.5393, weather clear — call it exactly as `assets.environment({ date: '2016-05-07T16:36:12-04:00', lat: 29.4106, lon: -82.5393, weather: 'clear' })` (verify against the docket and cite it).";
  return base.replace('# CASE\n', () => EXTENDED_API.replace('{{API_SNIPPET}}', () => apiSnippet) + '\n\n# CASE\n')
    .replace('{{SCENE}}', () => scene)
    .replace('{{CASE_ID}}', () => caseId)
    .replace('{{INVENTORY}}', () => JSON.stringify(evidenceSummary(caseId)))
    .replace('{{CASE_TEXT}}', () => loadCaseText(caseId));
}

const LONG_OUTPUT = `# Output format — ONE complete, detailed, high-visual-quality module (this is the stage demo world)
This is NOT a compact run: you have a large output budget. Write the whole world in one response, as ONE fenced \`\`\`js block and nothing after it. No ellipses, TODOs or "rest unchanged". It must run as-is.
- \`export default function createWorld(THREE, assets) { ... return world; }\` — no imports, globals, DOM, async, Math.random or Date.
- Header comment (≤ 25 lines): caseId, title, frame/origin, aerial alignment, the key evidence → geometry decisions with citations.
- Visual quality matters as much as correctness: a viewer flies through this world and renders each witness's eye view next to the aerial photo. Use the FULL asset library (see EXTENDED LIBRARY API below): physically based environment, terrain with the hill crest, the divided highway with its real markings / crossover / turn lane / shoulders, the side road, photographic pasture ground, grass, tree lines and forest edges where the AERIAL shows them, fences, utility pole line, the store building and the bench shelter, signs, individual trees, and the vehicles (truck_tractor + semitrailer as two articulated objects, the sedan). Place scenery where the aerial image shows it (forest edges, tree clumps, buildings, driveways, parking areas); scenery not in the record is flagged \`userData.scenery = true\` and never claimed as evidence.
- Where the library lacks something visible in the aerial or the photographs (e.g. a parking-lot apron, a driveway, a store sign, a mailbox, a ditch line), you MAY build it yourself with simple THREE meshes (MeshStandardMaterial, castShadow/receiveShadow, y from the terrain height) — never lights.
- Every vehicle and occluder sits on the terrain: y = \`assets.terrain.height(x, z)\` (or \`roadHeight\` on pavement) — see the snippet. Witness positions stay \`[x, 0, z]\` plus eyeHeight; keep the witness / impact area level (y≈0) as in the snippet.
- Motion: keyframes [t, x, z, compassHeadingDeg, speedMps] interpolated with a cubic Hermite through positions AND speeds (speed continuous, ≤ 0.8 g before impact); articulation for the semitrailer (its heading lags the tractor through the turn; kingpin from \`node.userData.kingpinOffset\`); post-impact: the car continues under the trailer and departs the road to its rest position if the record gives it.
- Cite pages (e.g. "docket_har1702.txt p.22") and video moments ("Depo Witness B 1:12:30", "Depo Witness D 31:05") on every object, witness and fact.`;

const EXTENDED_API = `# EXTENDED LIBRARY API (beyond the catalog above; all safe no-ops if a module is missing)
- \`assets.terrain\`: \`reset()\`, \`hillCrest({ at:[x,z], heading, gradeUp, lengthUp, gradeDown, lengthDown, curve, height?, datumAt? })\` (vertical crest; heading = radians of the down-grade direction, three.js convention), \`elevationProfile({ origin, heading, points:[[s,y],...], curve, halfWidth })\`, \`height(x,z)\`, \`roadHeight(x,z)\`. Roads drape onto the terrain automatically.
- \`assets.road({...})\` extended options: \`markings: 'standard'\` (real US markings for a divided highway), \`divided, medianWidth, shoulderWidth, leftShoulderWidth, position:[x,z], heading (radians), openings:[{at, width, radius}], turnLanes:[{carriageway:'forward'|'reverse', stopAt, length, taper}], sideRoads:[{at, side:'left'|'right', width, radius}], roadside:{ditchDepth}\`; \`node.userData.edges\` gives {outer, inner} offsets.
- \`assets.treeline({ id, points:[[x,z],...], depth, spacing, seed, height, pineRatio })\` (a band of trees = forest edge), \`assets.fence({ id, points })\`, \`assets.tree({ id, kind:'oak'|'pine', height })\`, \`assets.pole({ id, height })\`.
- \`assets.landscape.pastureGround / grassBlades / treeline (horizon ring) / skyClouds\` as in the snippet; browser-only detail inside \`if (!assets.headless)\`.
- \`assets.headless\` is true in the Node checks.

API USAGE SNIPPET — library calls only. It is a team-written scaffold for a SMALLER summary case of the same site; its numbers are NOT evidence for you. Learn the call shapes and the quality bar from it, then derive every position, dimension, time and citation yourself from THIS case's docket, depositions, exhibit and the aerial photo (where they differ, follow the evidence and say so in a fact):
\`\`\`js
{{API_SNIPPET}}
\`\`\`

# GROUND TRUTH AERIAL (attached image)
The attached aerial (USGS The National Map / USDA NAIP, public domain) shows THIS site. Downscaled to 1600 × 960 px; the full image covers world X ∈ [-500.4, 500.4] m, Z ∈ [-298.7, 298.7] m (image top = north; ≈0.625 m per px in the attached copy) AFTER a calibration: the photo is rotated 18.83° CCW so the real highway (bearing 108.83°) lies on the model's east–west axis, offset (-0.47, +0.01) m. World origin = the initial point of impact = centre of the EB outside lane of US-27A at the NE 140th Ct centreline (image px ≈ 834, 500 in the attached copy). Use it to place the store, the paved apron, the side road, the forest edges, tree clumps and fences where they really are (convert px → world metres with the scale and rotation above). The viewer drapes this same photo as a ground layer, so your geometry should line up with it.`;

function outputText(r) {
  if (typeof r.output_text === 'string' && r.output_text) return r.output_text;
  return (r.steps || r.outputs || []).filter((s) => s.type === 'model_output' || s.type === 'text')
    .flatMap((s) => (s.content ? s.content : [s])).filter((c) => c && c.type === 'text').map((c) => c.text).join('');
}
const extractJs = (text) => {
  const m = /```(?:javascript|js)?\s*\n([\s\S]*?)(?:```|$)/.exec(text);
  return m && !/^\s*(\/\/|export|\/\*)/.test(text) ? m[1] : text;
};

const STAGE = (args.find((a) => a.startsWith('--stage=')) || '').split('=')[1];
if (STAGE) { await runStage(STAGE); process.exit(0); }

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
let it, meta;
if (resumeId) {
  meta = JSON.parse(rd(path.join(OUT, 'onepass.meta.json')));
  it = await ai.interactions.get(resumeId);
  log('resume', resumeId, it.status);
} else {
  const t0 = Date.now();
  const prompt = buildPrompt();
  fs.writeFileSync(path.join(OUT, 'prompt.txt'), prompt);
  const inv = listEvidence(caseId);
  const vids = caseVideos(caseId);
  const total = vids.reduce((n, v) => n + (v.durationSec || 0), 0);
  const input = [{ type: 'text', text: prompt }];
  input.push({ type: 'text', text: `EVIDENCE VIDEOS: ${vids.length} videos, total ${fmtClock(total)}. CITATION RULE: every video moment names its video — "Depo <label> MM:SS" (or H:MM:SS), on that video's own clock. Watch the visuals, not only the speech: deponents point at or mark positions on exhibits, and what is shown can differ from what is said. Compare the videos against each other and against the documents.` });
  const videoUris = [];
  for (const v of vids) {
    const f = await uploadVideo(v.file);
    videoUris.push({ file: v.rel, label: v.label, uri: f.uri, length: v.clock });
    input.push({ type: 'text', text: `VIDEO ${v.index}: deposition of ${v.label} (${v.clock}) — file ${v.rel}. Cite moments as "${v.cite}".` });
    input.push({ type: 'video', uri: f.uri, mime_type: f.mimeType || 'video/mp4', resolution: 'low' });
  }
  // gemini-4-argon on the Interactions API rejects image parts ("Image input modality is not enabled"), so every image is
  // sent as a 3-second still-frame video (ffmpeg), which the video modality accepts.
  const stills = [];
  for (const im of inv.images) stills.push({ label: `EVIDENCE IMAGE: ${path.relative(CASE, im)} (sent as a 3-second still-frame video; it is a single static image)`, src: im, mp4: path.join(OUT, path.basename(im).replace(/\.[^.]+$/, '') + '_still.mp4') });
  stills.push({ label: 'GROUND-TRUTH AERIAL of the site (USGS The National Map / USDA NAIP, public domain; sent as a 3-second still-frame video of a single 1600 x 960 image; see "GROUND TRUTH AERIAL" above for scale, rotation and origin). Not case evidence about the event; cite it as "aerial (USGS NAIP)".', src: path.join(OUT, 'aerial_1600.jpg'), mp4: path.join(OUT, 'aerial_still.mp4') });
  for (const s of stills) {
    if (!fs.existsSync(s.mp4)) throw new Error('missing still video ' + s.mp4 + ' (make it with ffmpeg -loop 1 -t 3)');
    const f = await uploadVideo(s.mp4);
    input.push({ type: 'text', text: s.label });
    input.push({ type: 'video', uri: f.uri, mime_type: 'video/mp4', resolution: 'high' });
  }
  input.push({ type: 'text', text: 'Now study all text above, watch both depositions, inspect the exhibit and the aerial, then output the complete, detailed WORLD CONTRACT v2 module in a single ```js block.' });
  log('prompt chars', prompt.length, 'videos', videoUris.map((v) => v.uri).join(' '), 'max_output_tokens', maxTok);
  const startedAt = new Date().toISOString();
  it = await ai.interactions.create({ model: MODEL, background: true, input, generation_config: { max_output_tokens: maxTok, thinking_level: 'low' } });
  meta = { interactionId: it.id, model: MODEL, caseId, api: 'interactions (background)', maxOutputTokens: maxTok, thinkingLevel: 'low', promptChars: prompt.length,
    videos: videoUris, images: [...inv.images.map((f) => path.relative(CASE, f)), 'worlds/onepass/aerial_1600.jpg (USGS NAIP, downscaled)'], imagesSentAs: 'still-frame mp4 video parts (Interactions API image modality not enabled for this model)', prepSec: Math.round((Date.now() - t0) / 1000), startedAt };
  fs.writeFileSync(path.join(OUT, 'onepass.meta.json'), JSON.stringify(meta, null, 2));
  log('created', it.id, it.status);
}

let r = it;
while (!['completed', 'failed', 'cancelled', 'incomplete'].includes(r.status)) {
  await new Promise((s) => setTimeout(s, 30000));
  try { r = await ai.interactions.get(it.id); } catch (e) { log('poll error', String(e.message).slice(0, 200)); continue; }
  log(((Date.now() - Date.parse(meta.startedAt)) / 1000).toFixed(0) + 's', r.status, JSON.stringify(r.usage || {}).slice(0, 240));
}
const wall = (Date.now() - Date.parse(meta.startedAt)) / 1000;
fs.writeFileSync(path.join(OUT, 'interaction_result.json'), JSON.stringify(r, null, 1));
const raw = outputText(r);
fs.writeFileSync(path.join(OUT, 'onepass.raw.txt'), raw);
const js = extractJs(raw);
fs.writeFileSync(path.join(OUT, 'world_onepass.js'), js);
Object.assign(meta, {
  status: r.status, finishReason: r.status === 'incomplete' ? 'MAX_TOKENS (incomplete: hit max_output_tokens)' : r.status === 'completed' ? 'completed (natural stop)' : r.status,
  usage: r.usage || null, wallSec: Math.round(wall), outputChars: js.length, outputLines: js.split('\n').length, finishedAt: new Date().toISOString(),
});
fs.writeFileSync(path.join(OUT, 'onepass.meta.json'), JSON.stringify(meta, null, 2));
log('DONE', r.status, 'wall', meta.wallSec + 's', 'lines', meta.outputLines, 'usage', JSON.stringify(r.usage || {}));


// ===================================================================== post stages
async function pollInteraction(ai, id, label) {
  const t0 = Date.now();
  let r = await ai.interactions.get(id);
  while (!['completed', 'failed', 'cancelled', 'incomplete'].includes(r.status)) {
    await new Promise((res) => setTimeout(res, 15000));
    try { r = await ai.interactions.get(id); } catch (e) { log(label, 'poll error', String(e.message).slice(0, 160)); continue; }
    log(label, ((Date.now() - t0) / 1000).toFixed(0) + 's', r.status);
  }
  return { r, sec: Math.round((Date.now() - t0) / 1000) };
}
async function followUp(ai, meta, text, maxOut, label) {
  const t0 = Date.now();
  let it;
  try {
    it = await ai.interactions.create({ model: MODEL, background: true, previous_interaction_id: meta.interactionId, input: text, generation_config: { max_output_tokens: maxOut, thinking_level: 'low' } });
  } catch (e) { log(label, 'create failed', String(e.message).slice(0, 300)); throw e; }
  log(label, 'created', it.id);
  const { r } = await pollInteraction(ai, it.id, label);
  fs.writeFileSync(path.join(OUT, `${label}_result.json`), JSON.stringify(r, null, 1));
  return { id: it.id, status: r.status, usage: r.usage || null, text: outputText(r), sec: Math.round((Date.now() - t0) / 1000) };
}
function latestVersion(dir) { return Math.max(0, ...fs.readdirSync(dir).map((f) => Number((/^world_v(\d+)\.js$/.exec(f) || [])[1] || 0))); }
function sightSummary(checks) { return checks.filter((c) => c.check === 'sightline').map((c) =>
  `${c.subject}: ${c.pass ? 'CLEAR' : 'BLOCKED by ' + (c.blockedBy || '?')}${c.robustness ? ` (${c.robustness.blocked}/${c.robustness.samples} blocked, ${c.robustness.verdict})` : ''}`); }

async function runStage(stage) {
  const { validateWorldFile, syntaxCheck, formatErrors } = await import('./validate_world.js');
  const { loadWorldFile } = await import('./world_io.js');
  const { runAll } = await import('../checks/checks.js');
  const { writeProvenance } = await import('./provenance.js');
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const metaPath = path.join(OUT, 'onepass.meta.json');
  const meta = JSON.parse(rd(metaPath));
  const WD = path.join(CASE, 'worlds');

  if (stage === 'finish') {
    const file = path.join(OUT, 'world_onepass.js');
    let src = rd(file);
    meta.followups = meta.followups || [];
    const prevRepair = path.join(OUT, 'repair_result.json');
    if (fs.existsSync(prevRepair) && !meta.followups.some((f) => f.kind === 'repair')) {
      const rr = JSON.parse(rd(prevRepair));
      meta.followups.push({ kind: 'repair', id: rr.id, status: rr.status, usage: rr.usage || null, note: 'applied in an earlier finish run (7/7 edits applied; validator then VALID)' });
    }
    // 1) truncated at the cap → ONE short continuation
    if (syntaxCheck(file) && meta.status === 'incomplete') {
      const tail = src.split('\n').slice(-30).join('\n');
      const f = await followUp(ai, meta, `Your module was cut off by the output limit. The last lines you wrote were:\n\`\`\`\n${tail}\n\`\`\`\nContinue EXACTLY from the end of that text (do not repeat anything) and close the module as compactly as possible (finish the current statement, the remaining required world keys, setTime(0), return world; }). Output only the continuation code in one \`\`\`js block.`, 24000, 'continuation');
      let cont = f.text; const m = /```(?:javascript|js)?\s*\n([\s\S]*?)(?:```|$)/.exec(cont); if (m) cont = m[1];
      src = src.replace(/\s*$/, '') + '\n' + cont;
      fs.writeFileSync(file, src);
      meta.followups.push({ kind: 'continuation', id: f.id, status: f.status, usage: f.usage, sec: f.sec });
      log('continuation appended', cont.length, 'chars; syntax', syntaxCheck(file) || 'ok');
    }
    // 2) validate → ONE repair (search/replace edits) if invalid
    let v = await validateWorldFile(file, { caseId });
    log('validate', v.ok ? 'VALID' : 'INVALID', v.errors.length, 'errors', v.warnings.length, 'warnings');
    meta.validation = { first: { ok: v.ok, errors: v.errors, warnings: v.warnings.slice(0, 40) } };
    if (!v.ok) {
      const f = await followUp(ai, meta, `The independent validator rejected your world module (the complete current source follows the errors):\n${formatErrors(v)}\n\nCURRENT SOURCE:\n\`\`\`js\n${src}\n\`\`\`\nFix ONLY these problems, keeping the evidence-based layout and visual detail. Answer with ONE \`\`\`json block: an array of edits [{"old": "<exact unique substring of the current source>", "new": "<replacement>"}]. Keep edits minimal.`, 32000, 'repair');
      let edits = []; try { const m = /```(?:json)?\s*\n([\s\S]*?)```/.exec(f.text); edits = JSON.parse(m ? m[1] : f.text); } catch (e) { log('repair parse failed', e.message); }
      let applied = 0, missed = [];
      for (const e of edits) { if (e && typeof e.old === 'string' && src.includes(e.old)) { src = src.replace(e.old, () => e.new ?? ''); applied++; } else missed.push(String(e?.old).slice(0, 80)); }
      fs.writeFileSync(file, src);
      meta.followups.push({ kind: 'repair', id: f.id, status: f.status, usage: f.usage, sec: f.sec, edits: edits.length, applied, missed });
      v = await validateWorldFile(file, { caseId });
      log('repair applied', applied, '/', edits.length, '→', v.ok ? 'VALID' : 'INVALID', v.errors.slice(0, 5).join(' | '));
      meta.validation.afterRepair = { ok: v.ok, errors: v.errors, warnings: v.warnings.slice(0, 40) };
    }
    // 3) checks + save as next world version + provenance
    const world = await loadWorldFile(file);
    const checks = runAll(world);
    const n = Math.max(3, latestVersion(WD) + 1);
    const out = path.join(WD, `world_v${n}.js`);
    fs.copyFileSync(file, out);
    const u = meta.usage || {};
    writeProvenance({ caseId, worldPath: out, mode: 'live', model: MODEL, promptFile: path.relative(ROOT, path.join(OUT, 'prompt.txt')),
      inputs: undefined, maxOutputTokens: meta.maxOutputTokens,
      meta: { model: MODEL, seconds: meta.wallSec, finishReason: meta.finishReason, usage: { promptTokenCount: u.total_input_tokens ?? u.input_tokens ?? null, candidatesTokenCount: u.total_output_tokens ?? u.output_tokens ?? null, thoughtsTokenCount: u.total_thought_tokens ?? u.total_reasoning_tokens ?? null } } });
    const prov = JSON.parse(rd(out.replace(/\.js$/, '.provenance.json')));
    Object.assign(prov, { generator: 'argon/onepass_full.mjs (ONE Interactions API long-decode call, background)', interactionId: meta.interactionId, interactionUsage: meta.usage, followups: meta.followups,
      extraInputs: ['worlds/onepass/aerial_still.mp4 (USGS NAIP aerial, ground truth, still-frame video)', 'worlds/onepass/exhibit4_intersection_map_still.mp4'], validation: v.ok ? 'VALID' : 'INVALID' });
    fs.writeFileSync(out.replace(/\.js$/, '.provenance.json'), JSON.stringify(prov, null, 2));
    meta.savedAs = path.relative(ROOT, out); meta.checks = checks;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    fs.writeFileSync(path.join(OUT, `checks_v${n}.json`), JSON.stringify(checks, null, 2));
    log('saved', meta.savedAs, '|', sightSummary(checks).join(' ; '));
    log('non-pass checks:', checks.filter((c) => !c.pass).map((c) => `${c.check}:${c.subject}`).join(', '));
    return;
  }

  if (stage === 'render') {
    const wf = (args.find((a) => a.startsWith('--world=')) || '').split('=')[1];
    const world = await loadWorldFile(wf);
    const vArg = (args.find((a) => a.startsWith('--views=')) || '').split('=')[1];
    const views = vArg ? vArg.split(',') : ['overhead', ...(world.witnesses || []).map((w) => w.id)];
    const size = (args.find((a) => a.startsWith('--size=')) || '').split('=')[1];
    if (size) { const [w, h] = size.split('x'); process.env.RENDER_STILL_W = w; process.env.RENDER_STILL_H = h; }
    const { renderViews } = await import('../render/record.js');
    const sub = (args.find((a) => a.startsWith('--sub=')) || '').split('=')[1];
    const outDir = path.join(CASE, 'renders', path.basename(wf, '.js'), ...(sub ? [sub] : []));
    const r = await renderViews({ world: '/' + path.relative(ROOT, path.resolve(ROOT, wf)), views, outDir, stillOnly: true, page: `/?case=${caseId}` });
    log('rendered', (r.stills || r.pngs || []).map((f) => path.relative(ROOT, f)).join(' '));
    return;
  }

  if (stage === 'critique') {
    // ONE Argon critique round (same prompt + evidence as argon/critique.js) plus: the deposition frame with the on-screen
    // pen mark (extracted from the evidence video) and an explicit instruction to verify every witness position/time.
    process.env.SIGHTLINE_MODE = 'live';
    const C = await import('./client.js');
    const K = await import('./case.js');
    const { lightingAudit, formatLightingAudit } = await import('./solar.js');
    const { normalizePatch } = await import('./critique.js');
    const { writeWorldVersion } = await import('./world_io.js');
    const { callProvenance } = await import('./provenance.js');
    const vN = Number((args.find((a) => a.startsWith('--round=')) || '').split('=')[1]) || latestVersion(WD);
    const worldFile = path.join(WD, `world_v${vN}.js`);
    const worldSource = rd(worldFile);
    const world = await loadWorldFile(worldFile);
    const checks = runAll(world);
    let lighting = null; try { lighting = await lightingAudit({ caseId, world, evidence: K.evidenceSummary(caseId) }); } catch (e) { lighting = { notes: ['lighting audit failed: ' + e.message] }; }
    const prompt = C.fill(C.readPrompt('critique'), { ROUND: String(vN), NEXT_ROUND: String(vN + 1), CONTRACT: C.loadWorldContract(), CASE_ID: caseId,
      INVENTORY: JSON.stringify(K.evidenceSummary(caseId)), CASE_TEXT: K.loadCaseText(caseId), CHECKS: JSON.stringify(checks, null, 2), WORLD: worldSource, LIGHTING: formatLightingAudit(lighting) });
    const VERIFY = `POSITION AUDIT (do this before anything else): this world was written in ONE pass from the whole case. For EVERY witness, re-derive the position and observationTime from the strongest evidence and compare with the world: an on-screen mark a deponent makes on an exhibit in a video controls over words; measure it on the exhibit with the exhibit's scale bar and its marked reference point (e.g. the AOI / point of impact), convert to world metres in the world's frame, and state the measured value. observationTime must match the claim's wording (e.g. "right up until it hit" = the last second before impact). A still frame from the evidence video at Depo Witness B 1:54:34 showing her pen mark on Exhibit 4 is attached (extracted from deposition_witness_B.mp4; it IS evidence). If any witness is more than 1 m from its evidenced position, or a time/claim mapping is wrong, return the corrected COMPLETE module as \`patch\` (keep all scenery and visual detail; change only what the evidence requires; cite it). A witness who is a DRIVER must ride with their vehicle: in setTime, set that witness's position to the vehicle's driver eye (vehicle.userData.driverEye transformed by the vehicle's pose at t; eyeHeight from it) and look along the vehicle heading, and give the witness "vehicleId" = that vehicle's id; a fixed eye point inside a moving vehicle is wrong. The independent checks above already exclude a witness's own vehicle from the ray-cast. Do not move anything to reach a desired result: build what the evidence shows.`;
    const { worldErrors, formatErrorsForArgon } = await import('./world_errors.js');
    const { errors: worldErrs, validation } = await worldErrors({ caseId, worldFile, world, checks });
    log('world errors before critique:', worldErrs.length, worldErrs.map((e) => e.id).join(', '));
    const ERRORS = formatErrorsForArgon(worldErrs) + (worldErrs.length ? '\nContract reminder: vehicle.userData.driverEye is a LOCAL [x, y, z] ARRAY (index it [0],[1],[2]).' : '');
    const audit = args.includes('--position-audit');
    const parts = [C.textPart(prompt), ...(audit ? [C.textPart(VERIFY)] : []), ...(ERRORS ? [C.textPart(ERRORS)] : []), ...(await K.evidenceMediaParts(caseId))];
    const frame = path.join(OUT, 'depoB_6874.png');
    parts.push(C.textPart('EVIDENCE FRAME — Depo Witness B 1:54:34 (frame extracted from cases/demo-full/evidence/deposition_witness_B.mp4): Exhibit 4 with the witness\'s pen mark, as shown on screen.'));
    parts.push(C.imagePart(frame));
    const rdir = path.join(CASE, 'renders', `world_v${vN}`, 'critique_in');
    const files = fs.existsSync(rdir) ? fs.readdirSync(rdir).filter((f) => f.endsWith('.png')).sort().map((f) => path.join(rdir, f)) : [];
    for (const f of files) { parts.push(C.textPart(`RENDER STILL of the current world — view "${path.basename(f, '.png')}" (${path.relative(ROOT, f)}); _t<sec> = event-clock time:`)); parts.push(C.imagePart(f)); }
    parts.push(C.textPart('Answer with the JSON object only.'));
    const t0 = Date.now();
    const res = await C.callArgon({ name: `critique_round${vN}`, model: MODEL, parts, json: true, maxOutputTokens: 65536, cacheDir: path.join(CASE, 'cache') });
    const critSec = Math.round((Date.now() - t0) / 1000);
    const data = res.data || {};
    const c = { verdict: data.verdict || 'consistent', summary: data.summary || '', findings: data.findings || [], patch: normalizePatch(data.patch),
      call: { name: `critique_round${vN}`, model: res.model || MODEL, mode: res.mode, cacheDir: path.join(CASE, 'cache'), maxOutputTokens: 65536, promptFile: 'critique' } };
    log('critique', c.verdict, '|', String(c.summary).slice(0, 400), '| patch', !!c.patch, '|', critSec + 's');
    let finalFile = worldFile, finalChecks = checks, patch = null;
    if (c.patch) {
      const w = await writeWorldVersion(vN + 1, c.patch, WD, callProvenance({ caseId, call: c.call, parentWorld: '/' + path.relative(ROOT, worldFile) }));
      const v = await validateWorldFile(w.file, { caseId });
      patch = { world: w.url, problems: w.problems, valid: v.ok, errors: v.errors.slice(0, 8) };
      log('patched →', w.url, 'valid', v.ok, v.errors.slice(0, 4).join(' | '));
      if (v.ok && !w.problems.some((p) => p.startsWith('module failed'))) { finalFile = w.file; finalChecks = runAll(await loadWorldFile(w.file)); }
    }
    const rel = (f) => '/' + path.relative(ROOT, f).split(path.sep).join('/');
    const st = { caseId, world: rel(finalFile), findings: c.findings, checks: finalChecks, verdict: c.verdict, mode: 'live', updatedAt: new Date().toISOString(),
      loopLog: [{ round: 1, world: rel(worldFile), generator: 'argon/onepass_full.mjs (one-pass long decode)', checks, critique: { verdict: c.verdict, summary: c.summary, findings: c.findings, patched: !!c.patch }, findings: c.findings,
        renders: { videos: [], stills: files.map(rel) }, patch, finishedAt: new Date().toISOString() }] };
    let finalErrors = worldErrs;
    if (finalFile !== worldFile) finalErrors = (await worldErrors({ caseId, worldFile: finalFile, world: await loadWorldFile(finalFile), checks: finalChecks })).errors;
    log('world errors after critique:', finalErrors.length, finalErrors.map((e) => e.id).join(', '));
    st.loopLog[0].worldErrors = { before: worldErrs, after: finalErrors };
    if (!args.includes('--no-state')) fs.writeFileSync(path.join(CASE, 'cache', 'state.json'), JSON.stringify(st, null, 2));
    else fs.writeFileSync(path.join(OUT, `state_candidate_v${vN + 1}.json`), JSON.stringify(st, null, 2));
    const cm = (() => { try { return JSON.parse(rd(path.join(CASE, 'cache', `critique_round${vN}.meta.json`))); } catch { return null; } })();
    meta.critique = { round: vN, verdict: c.verdict, summary: c.summary, findings: c.findings.length, patched: !!c.patch, patch, seconds: critSec, usage: cm?.usage || null, finalWorld: rel(finalFile) };
    meta.finalChecks = sightSummary(finalChecks);
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    log('state.json →', rel(finalFile), '|', sightSummary(finalChecks).join(' ; '));
    return;
  }
  throw new Error('unknown stage ' + stage);
}
