// argon/provenance.js — CREDIBILITY v1 provenance: cases/<id>/worlds/world_vN.provenance.json beside every world write.
// Format (SPEC.md "CREDIBILITY v1 — shared data contract"):
//   { world, version, createdAt, mode: "mock"|"live"|"live-cached"|"seeded", model, promptFile, promptVersion,
//     inputs: [{file, sha256, bytes}], outputSha256, usage: {promptTokens, outputTokens, thoughtsTokens},
//     seconds, finishReason, thinkingBudget, maxOutputTokens, parentWorld }
// Lib:  writeProvenance({...}) / callProvenance({ caseId, call, parentWorld })
// CLI backfill: node argon/provenance.js --backfill <caseId> [--mode seeded]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ROOT, PROMPTS_DIR, readJSON, writeJSON } from './client.js';
import { listEvidence, caseDirs } from './case.js';

const posix = (p) => p.split(path.sep).join('/');
const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const urlFor = (f) => '/' + posix(path.relative(ROOT, path.resolve(ROOT, f)));

/** Prompt template path (repo-relative) + promptVersion (first 12 hex of the template's sha256). */
export function promptInfo(promptFile) {
  if (!promptFile) return { promptFile: null, promptVersion: null };
  let abs = path.isAbsolute(promptFile) ? promptFile : path.resolve(ROOT, promptFile);
  if (!fs.existsSync(abs)) abs = path.join(PROMPTS_DIR, promptFile.endsWith('.md') ? path.basename(promptFile) : `${path.basename(promptFile)}.md`);
  if (!fs.existsSync(abs)) return { promptFile: posix(promptFile), promptVersion: null };
  return { promptFile: posix(path.relative(ROOT, abs)), promptVersion: sha256File(abs).slice(0, 12) };
}

/** Every evidence file a world call sends (same selection as case.js loadCaseText + evidenceMediaParts), case-relative. */
export function evidenceInputs(caseId) {
  const inv = listEvidence(caseId);
  const files = [...inv.text, ...inv.evidenceText, ...inv.videos, ...inv.images, ...inv.docsWithoutText];
  return files.map((f) => fileInput(f, inv.dirs.dir));
}
function fileInput(f, baseDir) {
  const abs = path.resolve(baseDir || ROOT, f);
  return { file: posix(path.relative(baseDir || ROOT, abs)), sha256: sha256File(abs), bytes: fs.statSync(abs).size };
}

/** Mirrors client.js callArgon thinkingConfig: env level → null budget; maxOutputTokens ≥ 16384 → ARGON_THINKING_BUDGET||8192. */
export function thinkingBudgetFor(maxOutputTokens) {
  if (process.env.ARGON_THINKING_LEVEL) return null;
  return maxOutputTokens >= 16384 ? Number(process.env.ARGON_THINKING_BUDGET || 8192) : null;
}

export function readCallMeta(cacheDir, name) {
  return readJSON(path.join(cacheDir, `${name}.meta.json`), null);
}

function mapUsage(u) {
  if (!u) return { promptTokens: null, outputTokens: null, thoughtsTokens: null };
  const p = u.promptTokenCount ?? null, o = u.candidatesTokenCount ?? null;
  let t = u.thoughtsTokenCount ?? null;
  if (t == null && p != null && o != null && u.totalTokenCount != null) t = Math.max(0, u.totalTokenCount - p - o);
  return { promptTokens: p, outputTokens: o, thoughtsTokens: t };
}

/**
 * writeProvenance({ caseId, worldPath, mode, model, promptFile, inputs, meta, parentWorld, thinkingBudget, maxOutputTokens,
 *                   createdAt?, outPath? }) → { path, provenance }
 *  - inputs: omit → every evidence file of the case; or an array of paths / {file,sha256,bytes}.
 *  - meta: client.js call meta ({ model, usage, seconds, finishReason, hash, at }) or null.
 *  - outPath: default <worldPath without .js>.provenance.json.
 */
export function writeProvenance({ caseId, worldPath, mode, model, promptFile, inputs, meta = null, parentWorld = null,
  thinkingBudget = null, maxOutputTokens = null, createdAt, outPath } = {}) {
  const worldAbs = path.resolve(ROOT, worldPath);
  const caseDir = caseId ? caseDirs(caseId).dir : null;
  const ins = inputs === undefined ? (caseId ? evidenceInputs(caseId) : [])
    : inputs.map((x) => (typeof x === 'string' ? fileInput(x, caseDir) : x));
  const v = /world_v(\d+)\.js$/.exec(worldAbs);
  const provenance = {
    world: urlFor(worldAbs),
    version: v ? Number(v[1]) : null,
    createdAt: createdAt || new Date().toISOString(),
    mode,
    model: model || meta?.model || null,
    ...promptInfo(promptFile),
    inputs: ins,
    outputSha256: sha256File(worldAbs),
    usage: mapUsage(meta?.usage),
    seconds: meta?.seconds ?? null,
    finishReason: meta?.finishReason ?? null,
    thinkingBudget: thinkingBudget ?? null,
    maxOutputTokens: maxOutputTokens ?? null,
    parentWorld: parentWorld ? (parentWorld.startsWith('/') ? parentWorld : urlFor(parentWorld)) : null,
  };
  const out = outPath ? path.resolve(ROOT, outPath) : worldAbs.replace(/\.js$/, '.provenance.json');
  writeJSON(out, provenance);
  return { path: out, provenance };
}

/** Build writeProvenance args from a callArgon descriptor { name, model, mode, cacheDir, maxOutputTokens, promptFile }. */
export function callProvenance({ caseId, call, parentWorld = null }) {
  const live = call.mode === 'live' || call.mode === 'live-cached';
  return {
    caseId, mode: call.mode, model: call.model, promptFile: call.promptFile, parentWorld,
    meta: call.cacheDir ? readCallMeta(call.cacheDir, call.name) : null,
    maxOutputTokens: live ? call.maxOutputTokens ?? null : null,
    thinkingBudget: live ? thinkingBudgetFor(call.maxOutputTokens) : null,
  };
}

/** Backfill provenance for existing cases/<id>/worlds/world_vN.js (v1 = generate_world, vN+1 = critique_roundN patch). */
export function backfillCase(caseId, { mode, maxOutputTokens = null, thinkingBudget = null, force = false } = {}) {
  const d = caseDirs(caseId);
  const written = [];
  const worlds = fs.readdirSync(d.worlds).map((f) => /^world_v(\d+)\.js$/.exec(f)).filter(Boolean)
    .map((m) => Number(m[1])).sort((a, b) => a - b);
  for (const n of worlds) {
    const worldPath = path.join(d.worlds, `world_v${n}.js`);
    const out = worldPath.replace(/\.js$/, '.provenance.json');
    if (fs.existsSync(out) && !force) continue;
    const name = n === 1 ? 'generate_world' : `critique_round${n - 1}`;
    const meta = readCallMeta(d.cache, name);
    const m = mode || (meta ? 'live' : 'seeded');
    written.push(writeProvenance({
      caseId, worldPath, mode: m, model: meta?.model || null, promptFile: n === 1 ? 'generate_world' : 'critique', meta,
      parentWorld: n > 1 ? path.join(d.worlds, `world_v${n - 1}.js`) : null,
      thinkingBudget, maxOutputTokens, createdAt: meta?.at || fs.statSync(worldPath).mtime.toISOString(),
    }).path);
  }
  return written;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : undefined; };
  const caseId = arg('backfill');
  if (!caseId) { console.error('usage: node argon/provenance.js --backfill <caseId> [--mode seeded|live] [--max-output-tokens N] [--thinking-budget N] [--force]'); process.exit(1); }
  const num = (k) => (arg(k) != null ? Number(arg(k)) : null);
  const w = backfillCase(caseId, { mode: arg('mode'), maxOutputTokens: num('max-output-tokens'), thinkingBudget: num('thinking-budget'), force: process.argv.includes('--force') });
  console.log(`[provenance] ${caseId}: wrote ${w.length} file(s)\n  ` + w.map((f) => path.relative(ROOT, f)).join('\n  '));
}
