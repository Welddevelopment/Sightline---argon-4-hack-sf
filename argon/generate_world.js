// argon/generate_world.js — ALL case evidence (text + videos + images) → world module cases/<caseId>/worlds/world_v1.js
// CLI: node argon/generate_world.js [--case demo] [--version 1] [--print-prompt]
// WORLD CONTRACT v2 (default): Argon only PLACES library assets (createWorld(THREE, assets)); prompt argon/prompts/generate_world_v2.md.
//   SIGHTLINE_WORLD_CONTRACT=v1 → legacy prompt generate_world.md (Argon models boxes itself).
// Every output is validated (argon/validate_world.js). On errors: ONE Argon repair round (generate_world_repair) with the
// validator errors; still invalid → fall back to worlds/reference_world.js. Attempts, tokens and latency are logged to
// cases/<caseId>/cache/world_validation.json and cache/world_validation_log.jsonl.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { callArgon, ARGON_MODEL, ROOT, readPrompt, fill, loadWorldContract, textPart, mode, readJSON } from './client.js';
import { caseDirs, loadCaseText, evidenceMediaParts, evidenceSummary, defaultCaseId } from './case.js';
import { writeWorldVersion } from './world_io.js';
import { callProvenance } from './provenance.js';
import { validateWorldSource, formatErrors, logValidation } from './validate_world.js';

export const worldContract = () => ((process.env.SIGHTLINE_WORLD_CONTRACT || 'v2').toLowerCase() === 'v1' ? 'v1' : 'v2');
export const generatePromptFile = () => (worldContract() === 'v1' ? 'generate_world' : 'generate_world_v2');
const REFERENCE = path.join(ROOT, 'worlds', 'reference_world.js');

/** Case scene (date/time/location/weather) for the v2 environment() rule: confirmed_facts → cache/extraction → case.json `scene`. */
export function caseSceneHint(caseId) {
  const d = caseDirs(caseId);
  const src = [[path.join(d.dir, 'confirmed_facts.json'), 'human-confirmed'], [path.join(d.cache, 'extraction.json'), 'Argon extraction'], [path.join(d.dir, 'case.json'), 'case metadata']];
  for (const [f, label] of src) {
    const sc = readJSON(f, null)?.scene;
    if (sc && (sc.date || sc.time)) {
      const { frame, ...rest } = sc;
      return `${JSON.stringify(rest)} (${label}). Missing lat/lon: approximate them from the named location.`;
    }
  }
  return 'not pre-extracted — take the date, local time, location and weather from the evidence.';
}

export function buildGeneratePrompt(caseId) {
  return fill(readPrompt(generatePromptFile()), {
    CONTRACT: worldContract() === 'v1' ? loadWorldContract() : '',
    SCENE: caseSceneHint(caseId),
    CASE_ID: caseId,
    INVENTORY: JSON.stringify(evidenceSummary(caseId)),
    CASE_TEXT: loadCaseText(caseId),
  });
}

async function buildRepairPrompt(caseId, source, v) {
  const am = await import(pathToFileURL(path.join(ROOT, 'web', 'assets.js')).href);
  return fill(readPrompt('generate_world_repair'), {
    CASE_ID: caseId, ERRORS: formatErrors(v), SOURCE: source.trim(),
    ASSET_METHODS: am.ASSET_METHODS.join(', '), VEHICLE_TYPES: am.VEHICLE_TYPES.join(', '),
  });
}

function callMeta(cacheDir, name, res) {
  const meta = readJSON(path.join(cacheDir, `${name}.meta.json`), null);
  const fresh = res?.mode === 'live' || res?.mode === 'live-cached';
  const u = fresh ? meta?.usage || {} : {};
  return { name, mode: res?.mode || null, model: res?.model || null, seconds: fresh ? meta?.seconds ?? null : null, finishReason: fresh ? meta?.finishReason ?? null : null,
    promptTokens: u.promptTokenCount ?? null, outputTokens: u.candidatesTokenCount ?? null, thoughtsTokens: u.thoughtsTokenCount ?? null };
}
const brief = (v) => ({ ok: v.ok, errors: v.errors, warnings: v.warnings.slice(0, 12), stats: v.stats });

/** Returns { source, file, url, problems, mode, validation, outcome }. outcome ∈ argon | argon_repaired | reference_fallback. */
export async function generateWorld({ caseId = defaultCaseId(), version = 1,
  maxOutputTokens = Number(process.env.ARGON_WORLD_MAX_TOKENS || 32768) } = {}) {
  const d = caseDirs(caseId);
  const promptFile = generatePromptFile();
  // Step 3 (review & confirm): if a human confirmed the extracted inputs, they override the raw evidence. Absent → unchanged.
  let confirmed = null; try { confirmed = fs.readFileSync(path.join(d.dir, 'confirmed_facts.json'), 'utf8'); } catch {}
  const parts = [textPart(buildGeneratePrompt(caseId)), ...(await evidenceMediaParts(caseId)),
    ...(confirmed ? [textPart('AUTHORITATIVE CONFIRMED FACTS (human-reviewed). A reviewer checked these items against the evidence; where they differ from your own reading, ' +
      'USE THESE values, positions and citations (keep their citations; mark items with cited:false as inferred). Items not listed: use the evidence as usual.\n' + confirmed)] : []),
    textPart(worldContract() === 'v2'
      ? 'Output the complete, COMPACT world module now (createWorld(THREE, assets); only catalog assets; ≤ 220 lines), in ONE ```js block.'
      : 'Output the complete world module now, in ONE ```js block.')];

  const attempts = [];
  const t0 = Date.now();
  const res = await callArgon({ name: 'generate_world', model: ARGON_MODEL, parts, ext: 'js', maxOutputTokens, cacheDir: d.cache });
  let source = res.text, call = { name: 'generate_world', res, promptFile };
  let v = await validateWorldSource(source, { caseId });
  attempts.push({ ...callMeta(d.cache, 'generate_world', res), validation: brief(v) });
  console.log(`[generate_world] validation: ${v.ok ? 'OK' : v.errors.length + ' error(s)'}, ${v.warnings.length} warning(s), ${v.stats.lines} lines / ${v.stats.chars} chars`);
  let outcome = 'argon';

  if (!v.ok) {
    console.warn('[generate_world] validator errors:\n  ' + v.errors.slice(0, 20).join('\n  '));
    const canRepair = mode() === 'live' || fs.existsSync(path.join(d.cache, 'generate_world_repair.js'));
    if (canRepair) {
      try {
        const rp = await buildRepairPrompt(caseId, source, v);
        const rr = await callArgon({ name: 'generate_world_repair', model: ARGON_MODEL, parts: [textPart(rp)], ext: 'js', maxOutputTokens, cacheDir: d.cache });
        const v2 = await validateWorldSource(rr.text, { caseId });
        attempts.push({ ...callMeta(d.cache, 'generate_world_repair', rr), validation: brief(v2) });
        console.log(`[generate_world] repair round: ${v2.ok ? 'OK' : v2.errors.length + ' error(s) remain'}`);
        if (v2.ok) { source = rr.text; v = v2; call = { name: 'generate_world_repair', res: rr, promptFile: 'generate_world_repair' }; outcome = 'argon_repaired'; }
        else console.warn('[generate_world] still invalid after repair:\n  ' + v2.errors.slice(0, 12).join('\n  '));
      } catch (e) { attempts.push({ name: 'generate_world_repair', error: e.message }); console.warn('[generate_world] repair failed:', e.message); }
    }
    if (outcome === 'argon') {
      outcome = 'reference_fallback';
      source = `// FALLBACK: Argon's world for case "${caseId}" failed validation (see cases/${caseId}/cache/world_validation.json); ` +
        `this is worlds/reference_world.js.\n` + fs.readFileSync(REFERENCE, 'utf8');
      v = await validateWorldSource(source, { caseId });
      console.warn(`[generate_world] FALLING BACK to worlds/reference_world.js for case ${caseId}`);
    }
  }

  const prov = outcome === 'reference_fallback'
    ? { caseId, mode: 'fallback', model: null, promptFile: null, meta: null }
    : callProvenance({ caseId, call: { name: call.name, model: call.res.model, mode: call.res.mode, cacheDir: d.cache, maxOutputTokens, promptFile: call.promptFile } });
  const out = await writeWorldVersion(version, source, d.worlds, prov);
  logValidation(caseId, { world: out.url, contract: worldContract(), outcome, totalSeconds: Math.round((Date.now() - t0) / 100) / 10, attempts,
    final: brief(v), problems: out.problems });
  if (out.problems.length) console.warn(`[generate_world] contract problems in world_v${version}:\n  ` + out.problems.join('\n  '));
  return { source, ...out, mode: res.mode, validation: brief(v), outcome, attempts };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const arg = (k, dflt) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : dflt; };
  const caseId = arg('case', defaultCaseId());
  if (process.argv.includes('--print-prompt')) { console.log(buildGeneratePrompt(caseId)); process.exit(0); }
  try {
    const r = await generateWorld({ caseId, version: Number(arg('version', 1)) });
    console.log(`[generate_world] case=${caseId} mode=${mode()} outcome=${r.outcome} wrote ${r.url} (${r.source.length} chars) problems=${r.problems.length}`);
  } catch (e) { console.error('[generate_world] FAILED:', e.message); process.exit(1); }
}
