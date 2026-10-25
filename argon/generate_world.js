// argon/generate_world.js — ALL case evidence (text + videos + images) → world module cases/<caseId>/worlds/world_v1.js
// CLI: node argon/generate_world.js [--case demo] [--version 1] [--print-prompt]
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { callArgon, ARGON_MODEL, readPrompt, fill, loadWorldContract, textPart, mode } from './client.js';
import { caseDirs, loadCaseText, evidenceMediaParts, evidenceSummary, defaultCaseId } from './case.js';
import { writeWorldVersion } from './world_io.js';

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
  const parts = [textPart(buildGeneratePrompt(caseId)), ...(await evidenceMediaParts(caseId)),
    textPart('Output the complete world module now, in ONE ```js block.')];
  const res = await callArgon({ name: 'generate_world', model: ARGON_MODEL, parts, ext: 'js', maxOutputTokens, cacheDir: d.cache });
  const out = await writeWorldVersion(version, res.text, d.worlds);
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
