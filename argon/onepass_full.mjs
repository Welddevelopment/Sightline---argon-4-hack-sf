// argon/onepass_full.mjs — ONE-PASS stage world for a large case (default demo-full): a single gemini-4-argon long-decode
// call (Interactions API, background:true) reads the WHOLE case (all docket text, every deposition video via Files API,
// exhibit image, USGS aerial as ground-truth image) and writes the complete WORLD CONTRACT v2 module.
// Usage: node argon/onepass_full.mjs [caseId=demo-full] [--max=160000] [--resume=<interactionId>] [--followup]
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
  for (const im of inv.images) {
    input.push({ type: 'text', text: `EVIDENCE IMAGE: ${path.relative(CASE, im)}` });
    input.push({ type: 'image', data: fs.readFileSync(im).toString('base64'), mime_type: im.endsWith('.png') ? 'image/png' : 'image/jpeg' });
  }
  const aerial = path.join(OUT, 'aerial_1600.jpg');
  input.push({ type: 'text', text: 'GROUND-TRUTH AERIAL of the site (USGS The National Map / USDA NAIP, public domain; see "GROUND TRUTH AERIAL" above for scale, rotation and origin). Not case evidence about the event; cite it as "aerial (USGS NAIP)".' });
  input.push({ type: 'image', data: fs.readFileSync(aerial).toString('base64'), mime_type: 'image/jpeg' });
  input.push({ type: 'text', text: 'Now study all text above, watch both depositions, inspect the exhibit and the aerial, then output the complete, detailed WORLD CONTRACT v2 module in a single ```js block.' });
  log('prompt chars', prompt.length, 'videos', videoUris.map((v) => v.uri).join(' '), 'max_output_tokens', maxTok);
  const startedAt = new Date().toISOString();
  it = await ai.interactions.create({ model: MODEL, background: true, input, generation_config: { max_output_tokens: maxTok, thinking_level: 'low' } });
  meta = { interactionId: it.id, model: MODEL, caseId, api: 'interactions (background)', maxOutputTokens: maxTok, thinkingLevel: 'low', promptChars: prompt.length,
    videos: videoUris, images: [...inv.images.map((f) => path.relative(CASE, f)), 'worlds/onepass/aerial_1600.jpg (USGS NAIP, downscaled)'], prepSec: Math.round((Date.now() - t0) / 1000), startedAt };
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
