// argon/generate_world.js — ALL case evidence (text + videos + images) → world module cases/<caseId>/worlds/world_v1.js
// CLI: node argon/generate_world.js [--case demo] [--version 1] [--print-prompt]
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { callArgon, ARGON_MODEL, readPrompt, fill, loadWorldContract, textPart, mode } from './client.js';
import { caseDirs, loadCaseText, evidenceMediaParts, evidenceSummary, defaultCaseId } from './case.js';
import { writeWorldVersion } from './world_io.js';
import { callProvenance } from './provenance.js';

export function buildGeneratePrompt(caseId) {
  return fill(readPrompt('generate_world'), {
    CONTRACT: loadWorldContract(),
    CASE_ID: caseId,
    INVENTORY: JSON.stringify(evidenceSummary(caseId)),
    CASE_TEXT: loadCaseText(caseId),
  });
}

/** Returns { source, file, url, problems, mode }. */
export async function generateWorld({ caseId = defaultCaseId(), version = 1,
  maxOutputTokens = Number(process.env.ARGON_WORLD_MAX_TOKENS || 65536) } = {}) {
  const d = caseDirs(caseId);
  // Step 3 (review & confirm): if a human confirmed the extracted inputs, they override the raw evidence. Absent → unchanged.
  const confirmed = await import('node:fs').then((fs) => { try { return fs.readFileSync(path.join(d.dir, 'confirmed_facts.json'), 'utf8'); } catch { return null; } });
  const parts = [textPart(buildGeneratePrompt(caseId)), ...(await evidenceMediaParts(caseId)),
    ...(confirmed ? [textPart('AUTHORITATIVE CONFIRMED FACTS (human-reviewed). A reviewer checked these items against the evidence; where they differ from your own reading, ' +
      'USE THESE values, positions and citations (keep their citations; mark items with cited:false as inferred). Items not listed: use the evidence as usual.\n' + confirmed)] : []),
    textPart('Output the complete world module now, in ONE ```js block.')];
  const res = await callArgon({ name: 'generate_world', model: ARGON_MODEL, parts, ext: 'js', maxOutputTokens, cacheDir: d.cache });
  const out = await writeWorldVersion(version, res.text, d.worlds, callProvenance({ caseId,
    call: { name: 'generate_world', model: res.model, mode: res.mode, cacheDir: d.cache, maxOutputTokens, promptFile: 'generate_world' } }));
  if (out.problems.length) console.warn(`[generate_world] contract problems in world_v${version}:\n  ` + out.problems.join('\n  '));
  return { source: res.text, ...out, mode: res.mode };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const arg = (k, dflt) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : dflt; };
  const caseId = arg('case', defaultCaseId());
  if (process.argv.includes('--print-prompt')) { console.log(buildGeneratePrompt(caseId)); process.exit(0); }
  try {
    const r = await generateWorld({ caseId, version: Number(arg('version', 1)) });
    console.log(`[generate_world] case=${caseId} mode=${mode()} wrote ${r.url} (${r.source.length} chars) problems=${r.problems.length}`);
  } catch (e) { console.error('[generate_world] FAILED:', e.message); process.exit(1); }
}
