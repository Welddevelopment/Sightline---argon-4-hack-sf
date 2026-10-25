// Long-decode world generation: Argon writes the ENTIRE detailed world (v1 contract, self-contained) in ONE response
// via the Interactions API in background mode with a large max_output_tokens.
// Usage: node argon/long_world.mjs [caseId=demo] [--no-video] [--max=160000]
// Env: GEMINI_API_KEY, ARGON_MODEL (default gemini-4-argon).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const caseId = args.find((a) => !a.startsWith('--')) || 'demo';
const noVideo = args.includes('--no-video');
const maxTok = Number((args.find((a) => a.startsWith('--max=')) || '--max=180000').split('=')[1]);
const resumeId = (args.find((a) => a.startsWith('--resume=')) || '').split('=')[1];
const MODEL = process.env.ARGON_MODEL || 'gemini-4-argon';
const CASE = path.join(ROOT, 'cases', caseId);
const tag = (args.find((a) => a.startsWith('--tag=')) || '').split('=')[1];
const OUT = path.join(CASE, 'worlds', 'long', ...(tag ? [tag] : []));
fs.mkdirSync(OUT, { recursive: true });

const rd = (p) => fs.readFileSync(p, 'utf8');
function latestWorld() {
  const dir = path.join(CASE, 'worlds');
  const vs = fs.readdirSync(dir).map((f) => /^world_v(\d+)\.js$/.exec(f)).filter(Boolean).sort((a, b) => b[1] - a[1]);
  return path.join(dir, vs[0][0]);
}
function buildPrompt() {
  const spec = rd(path.join(ROOT, 'SPEC.md'));
  const contract = spec.slice(spec.indexOf('## THE WORLD CONTRACT'), spec.indexOf('## Viewer page contract'));
  const textDir = path.join(CASE, 'text');
  const caseJson = rd(path.join(CASE, 'case.json'));
  const files = ['facts.txt', 'police_report.txt', 'witness_A.txt', 'witness_C.txt', 'deposition_transcript.txt'];
  const evidence = [`case.json:\n${caseJson}`, ...files.filter((f) => fs.existsSync(path.join(textDir, f))).map((f) => `----- ${f} -----\n${rd(path.join(textDir, f))}`)].join('\n\n');
  const kin = latestWorld();
  const reviewPath = process.env.LONG_WORLD_REVIEW || path.join(CASE, 'worlds', 'long', 'reference_review.md');
  const review = fs.existsSync(reviewPath) ? rd(reviewPath) : '(not available)';
  let p = rd(path.join(ROOT, 'argon', 'prompts', 'long_world.md'));
  p = p.replace('{{EVIDENCE}}', `SPEC world contract (original v1 text):\n${contract}\n\n${evidence}`)
    .replace('{{SCENE_SPEC}}', rd(path.join(CASE, 'plan', 'scene_spec.json')))
    .replace('{{WORLD_KINEMATICS}}', `// ===== ${path.relative(ROOT, kin)} =====\n${rd(kin)}`)
    .replace('{{REFERENCE_REVIEW}}', review);
  return { prompt: p, kinematicsFrom: path.relative(ROOT, kin) };
}
function videoUri() {
  try {
    const db = JSON.parse(rd(path.join(ROOT, 'cache', 'files.json')));
    const k = Object.keys(db).find((x) => x.startsWith(`cases/${caseId}/evidence/`) && x.includes('.mp4'));
    if (k && (!db[k].expiresAt || Date.parse(db[k].expiresAt) > Date.now() + 3600e3)) return db[k];
  } catch {}
  return null;
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const log = (...a) => { const s = `[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}`; console.log(s); fs.appendFileSync(path.join(OUT, 'run.log'), s + '\n'); };
const t0 = Date.now();
let it, meta;
if (resumeId) {
  meta = JSON.parse(rd(path.join(OUT, 'world_long.meta.json')));
  it = await ai.interactions.get(resumeId);
  log('resume', resumeId, it.status);
} else {
  const { prompt, kinematicsFrom } = buildPrompt();
  fs.writeFileSync(path.join(OUT, 'prompt.txt'), prompt);
  const vid = noVideo ? null : videoUri();
  const input = vid
    ? [{ type: 'text', text: prompt }, { type: 'text', text: 'Attached: the videotaped deposition of Witness B (the same deposition as deposition_transcript.txt; she marks her position on the map exhibit around 27:04).' }, { type: 'video', uri: vid.uri, mime_type: vid.mimeType || 'video/mp4', resolution: 'low' }]
    : prompt;
  log('prompt chars', prompt.length, 'video', vid ? vid.uri : 'none', 'max_output_tokens', maxTok);
  try {
    it = await ai.interactions.create({ model: MODEL, background: true, input, generation_config: { max_output_tokens: maxTok, thinking_level: 'low' } });
  } catch (e) {
    if (!vid) throw e;
    log('create with video failed:', String(e.message).slice(0, 300), '-> retry text-only');
    it = await ai.interactions.create({ model: MODEL, background: true, input: prompt, generation_config: { max_output_tokens: maxTok, thinking_level: 'low' } });
    meta = { videoFallback: String(e.message).slice(0, 300) };
  }
  meta = { ...(meta || {}), interactionId: it.id, model: MODEL, caseId, maxOutputTokens: maxTok, thinkingLevel: 'low', promptChars: prompt.length, video: vid && !meta?.videoFallback ? vid.uri : null, kinematicsFrom, startedAt: new Date(t0).toISOString() };
  fs.writeFileSync(path.join(OUT, 'world_long.meta.json'), JSON.stringify(meta, null, 2));
  log('created', it.id, it.status);
}

function outputText(r) {
  if (typeof r.output_text === 'string' && r.output_text) return r.output_text;
  return (r.steps || r.outputs || []).filter((s) => s.type === 'model_output' || s.type === 'text')
    .flatMap((s) => (s.content ? s.content : [s])).filter((c) => c && c.type === 'text').map((c) => c.text).join('');
}

let r = it;
while (!['completed', 'failed', 'cancelled', 'incomplete'].includes(r.status)) {
  await new Promise((s) => setTimeout(s, 30000));
  try { r = await ai.interactions.get(it.id); } catch (e) { log('poll error', String(e.message).slice(0, 200)); continue; }
  log(((Date.now() - t0) / 1000).toFixed(0) + 's', r.status, JSON.stringify(r.usage || {}).slice(0, 240));
}
const wall = (Date.now() - Date.parse(meta.startedAt)) / 1000;
fs.writeFileSync(path.join(OUT, 'interaction_result.json'), JSON.stringify(r, null, 1));
let text = outputText(r);
fs.writeFileSync(path.join(OUT, 'world_long.raw.txt'), text);
const fence = /```(?:javascript|js)?\s*\n([\s\S]*?)(?:```|$)/.exec(text);
if (fence && !/^\s*(\/\/|export|\/\*)/.test(text)) text = fence[1];
fs.writeFileSync(path.join(OUT, 'world_long.js'), text);
Object.assign(meta, {
  status: r.status, finishReason: r.status === 'incomplete' ? 'MAX_TOKENS (status incomplete: hit max_output_tokens cap)' : r.status === 'completed' ? 'completed (natural stop)' : r.status,
  totalOutputTokens: r.usage?.total_output_tokens ?? null, usage: r.usage || null, wallSec: Math.round(wall), outputChars: text.length, outputLines: text.split('\n').length, finishedAt: new Date().toISOString(),
});
fs.writeFileSync(path.join(OUT, 'world_long.meta.json'), JSON.stringify(meta, null, 2));
log('DONE', r.status, 'wall', meta.wallSec + 's', 'chars', text.length, 'usage', JSON.stringify(r.usage || {}));
