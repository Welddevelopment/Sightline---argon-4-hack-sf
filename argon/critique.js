// argon/critique.js — Argon watches the witness-view renders + all evidence, uses the independent checks,
// returns findings (+ a full patched world module when the world is wrong).
// CLI: node argon/critique.js [--case demo] [--round 1] [--world cases/demo/worlds/world_v1.js] [--renders <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { callArgon, ARGON_MODEL, readPrompt, fill, loadWorldContract, textPart, imagePart, filePart, uploadVideo, ROOT, mode } from './client.js';
import { caseDirs, loadCaseText, evidenceMediaParts, evidenceSummary, defaultCaseId } from './case.js';

/** Collect render files: a renderViews() result, a list of paths, or a directory of <view>.mp4/.png. */
export function collectRenders(renders) {
  if (!renders) return [];
  let files = [];
  if (typeof renders === 'string') {
    const dir = path.resolve(ROOT, renders);
    if (fs.existsSync(dir)) files = fs.readdirSync(dir).map((f) => path.join(dir, f));
  } else if (Array.isArray(renders)) files = renders;
  else files = renders.files || [...(renders.videos || []), ...(renders.stills || [])];
  return files.filter((f) => /\.(mp4|png)$/i.test(f)).sort();
}

export function normalizePatch(patch) {
  if (typeof patch !== 'string') return null;
  patch = patch.trim();
  const m = patch.match(/```(?:js|javascript)?\s*\n([\s\S]*?)```/);
  if (m) patch = m[1].trim();
  if (!patch || patch === 'null' || !/export\s+default/.test(patch)) return null;
  return patch + '\n';
}

/** critique({ caseId, round, worldFile|worldSource, checks, renders }) → { round, verdict, summary, findings, patch, mode } */
export async function critique({ caseId = defaultCaseId(), round = 1, worldFile, worldSource, checks = [], renders,
  maxOutputTokens = Number(process.env.ARGON_CRITIQUE_MAX_TOKENS || 65536) } = {}) {
  const d = caseDirs(caseId);
  worldSource = worldSource ?? (worldFile ? fs.readFileSync(path.resolve(ROOT, worldFile), 'utf8') : '');
  const prompt = fill(readPrompt('critique'), {
    ROUND: String(round), NEXT_ROUND: String(round + 1), CONTRACT: loadWorldContract(),
    CASE_ID: caseId, INVENTORY: JSON.stringify(evidenceSummary(caseId)), CASE_TEXT: loadCaseText(caseId),
    CHECKS: JSON.stringify(checks, null, 2), WORLD: worldSource,
  });
  const parts = [textPart(prompt), ...(await evidenceMediaParts(caseId))];
  for (const f of collectRenders(renders)) {
    const view = path.basename(f).replace(/\.(mp4|png)$/i, '');
    const rel = path.relative(ROOT, f);
    if (f.endsWith('.mp4')) {
      parts.push(textPart(`RENDER VIDEO — view "${view}" (${rel}), full event timeline of the current world:`));
      parts.push(filePart(await uploadVideo(f)));
    } else {
      parts.push(textPart(`RENDER STILL — view "${view}" (${rel}) at that witness's observationTime (overhead: mid-timeline):`));
      parts.push(imagePart(f));
    }
  }
  parts.push(textPart('Answer with the JSON object only.'));
  const res = await callArgon({ name: `critique_round${round}`, model: ARGON_MODEL, parts, json: true, maxOutputTokens, cacheDir: d.cache });
  const data = res.data || {};
  const patch = normalizePatch(data.patch);
  return { round, verdict: data.verdict || (patch ? 'world_patched' : 'consistent'), summary: data.summary || '', findings: data.findings || [], patch, mode: res.mode,
    call: { name: `critique_round${round}`, model: res.model, mode: res.mode, cacheDir: d.cache, maxOutputTokens, promptFile: 'critique' } };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const arg = (k, dflt) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : dflt; };
  const caseId = arg('case', defaultCaseId());
  const d = caseDirs(caseId);
  const round = Number(arg('round', 1));
  const worldFile = arg('world', path.join(d.worlds, `world_v${round}.js`));
  try {
    const { loadWorldFile } = await import('./world_io.js');
    const { runAll } = await import('../checks/checks.js');
    const checks = runAll(await loadWorldFile(worldFile));
    const r = await critique({ caseId, round, worldFile, checks, renders: arg('renders', path.join(d.renders, path.basename(worldFile, '.js'))) });
    console.log(JSON.stringify({ ...r, patch: r.patch ? `<${r.patch.length} chars>` : null, mode: mode() }, null, 2));
  } catch (e) { console.error('[critique] FAILED:', e.message); process.exit(1); }
}
