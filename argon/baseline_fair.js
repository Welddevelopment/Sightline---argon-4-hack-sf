// argon/baseline_fair.js — a FAIR model comparison: every model gets EXACTLY the same parts
// (the same prompt + all case text + every evidence video via the Files API + every image), one call each,
// run in parallel. Plus, for completeness, the conventional chunked pipeline (Flash over 10-min video chunks
// + document chunks, then one merge call). No 3D world: this isolates evidence comprehension.
//
// Scoring is a fixed rule-based check (see RUBRICS) on the Witness-B entry of each answer:
//   (a) mark   — located her map mark (video moment ~Depo 27:04, never spoken aloud)
//   (b) claim  — found her "clear view the whole way" claim (Depo 27:46 / 28:17)
//   (c) blocked— concluded the claim is NOT physically possible because the truck/trailer blocks the view
// The rule check is crude by design; read the saved answers too (status/baseline_fair.md has the human reading).
//
// Output: cases/<caseId>/cache/baseline_fair.json (only file written, plus baseline_fair_chunks.json scratch log).
// Video segments for the chunked variant go to $BASELINE_FAIR_TMP or the OS temp dir (not the repo).
// CLI (live only): SIGHTLINE_MODE=live node argon/baseline_fair.js --case demo [--models a,b] [--no-chunked] [--only-chunked]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { getAI, isLive, readPrompt, fill, textPart, filePart, imagePart, uploadVideo, writeJSON, readJSON, extractJSON, BASELINE_MODEL, ARGON_MODEL } from './client.js';
import { caseDirs, listEvidence, loadCaseText, evidenceMediaParts, evidenceSummary, caseVideos, fmtClock, defaultCaseId } from './case.js';

export const TASK = 'For each witness, determine where they were and whether their claimed observations are physically possible given the evidence; cite timestamps and pages.';
const MAX_OUT = Number(process.env.BASELINE_FAIR_MAX_TOKENS || 16384);       // within both models' output limits (Argon 32,768)
const THINKING = Number(process.env.BASELINE_FAIR_THINKING_BUDGET || 8192);  // same thinking budget for every model
const CHUNK_SEC = Number(process.env.BASELINE_FAIR_CHUNK_SEC || 600);        // 10-minute video chunks
const DOC_CHUNK_CHARS = Number(process.env.BASELINE_FAIR_DOC_CHUNK_CHARS || 40000);
const CONCURRENCY = Number(process.env.BASELINE_FAIR_CONCURRENCY || 6);

// ---------- rubric (per case; demo-full falls back to demo's chain with any video label) ----------
const toSec = (s) => { const p = s.split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };
export const RUBRICS = {
  demo: { witness: /witness\s*b\b|^b$|\bwit_b\b/i, markWindow: ['26:50', '27:20'], claimWindow: ['27:40', '28:25'] },
};
const rubricFor = (caseId) => RUBRICS[caseId] || RUBRICS.demo;

function timestamps(s) { return [...String(s).matchAll(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/g)].map((m) => toSec(m[1])); }
const inWindow = (s, [lo, hi]) => timestamps(s).some((t) => t >= toSec(lo) && t <= toSec(hi));

export function score(answer, caseId) {
  const R = rubricFor(caseId);
  const ws = Array.isArray(answer?.witnesses) ? answer.witnesses : [];
  const B = ws.find((w) => R.witness.test(String(w.name || '').trim())) || ws.find((w) => R.witness.test(JSON.stringify(w)));
  if (!B) return { witnessFound: false, mark: false, claim: false, blocked: false, notes: 'no Witness B entry' };
  const posBlob = `${B.position || ''} ${(B.positionCitations || []).join(' ')}`;
  const all = JSON.stringify(B);
  // markCited: a ~27:04 moment is cited for her position (weak: the transcript also has a [27:04] line, "over by the corner, near the shelter").
  // mark: her position text itself reports the on-screen mark (X / mark / exhibit / drew) — the visual-only fact.
  const markCited = inWindow(posBlob, R.markWindow);
  const mark = markCited && /\bmark(ed|s)?\b|\bX\b|exhibit\s*4|red pen|\bdrew\b|\bdraws?\b/i.test(B.position || '');
  const markAnywhere = inWindow(all, R.markWindow) && /\bmark|\bX\b/i.test(all);
  const claims = Array.isArray(B.claims) ? B.claims : [];
  const claimHit = claims.find((c) => /clear view|whole way|nothing was in the way|saw it clearly/i.test(c.claim || '') || inWindow(c.citation || '', R.claimWindow));
  const blockedHit = claims.find((c) => String(c.physicallyPossible).toLowerCase() === 'no'
    && /trailer|truck|tractor|semi|rig|cab/i.test(c.reasoning || '') && /block|obstruct|occlud|between|in the way|hidden|cut off|line of sight/i.test(c.reasoning || ''));
  return {
    witnessFound: true, position: B.position || '', positionCitations: B.positionCitations || [],
    mark, markCited, markAnywhere, claim: !!claimHit, blocked: !!blockedHit,
    claimVerdicts: claims.map((c) => ({ claim: String(c.claim || '').slice(0, 160), citation: c.citation, physicallyPossible: c.physicallyPossible })),
  };
}

// ---------- low-level call (own writer: only baseline_fair*.json is written) ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function cleanParts(parts) { return parts.map(({ _path, ...p }) => p); }
function partsDigest(parts) {
  const h = crypto.createHash('sha256');
  for (const p of parts) {
    if (p.text) h.update('T' + p.text);
    else if (p.inlineData) h.update('I' + crypto.createHash('sha256').update(p.inlineData.data).digest('hex'));
    else if (p.fileData) h.update('F' + p.fileData.fileUri);
  }
  return h.digest('hex').slice(0, 16);
}
function describeParts(parts) {
  return parts.map((p) => p.text ? { text: p.text.length > 200 ? `<${p.text.length} chars> ${p.text.slice(0, 120)}…` : p.text }
    : p.fileData ? { file: p.fileData.mimeType } : p.inlineData ? { inline: p.inlineData.mimeType } : {});
}

export async function callModel({ model, parts, json = true, maxOutputTokens = MAX_OUT, label = model }) {
  const ai = await getAI();
  const config = { maxOutputTokens, thinkingConfig: { thinkingBudget: THINKING }, httpOptions: { timeout: 20 * 60 * 1000 } };
  if (json) config.responseMimeType = 'application/json';
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const t0 = Date.now();
    try {
      const stream = await ai.models.generateContentStream({ model, contents: [{ role: 'user', parts: cleanParts(parts) }], config });
      let raw = '', finishReason = null, usage = null;
      for await (const ch of stream) { raw += ch.text || ''; finishReason = ch.candidates?.[0]?.finishReason || finishReason; usage = ch.usageMetadata || usage; }
      const seconds = Number(((Date.now() - t0) / 1000).toFixed(1));
      if (!raw.trim()) throw new Error(`empty response (finish=${finishReason})`);
      let data = null, parseError = null;
      if (json) { try { data = extractJSON(raw); } catch (e) { parseError = e.message; } }
      console.log(`[fair] ${label}: ${seconds}s finish=${finishReason} prompt=${usage?.promptTokenCount} out=${usage?.candidatesTokenCount} think=${usage?.thoughtsTokenCount}`);
      return { model, seconds, finishReason, usage, raw, data, parseError, attempts: attempt };
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      console.warn(`[fair] ${label}: attempt ${attempt} failed after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${msg.slice(0, 300)}`);
      if (!/429|500|502|503|504|RESOURCE_EXHAUSTED|UNAVAILABLE|INTERNAL|fetch failed|ECONNRESET|timeout|terminated/i.test(msg)) break;
      await sleep(15000 * attempt);
    }
  }
  return { model, error: String(lastErr?.message || lastErr).slice(0, 2000) };
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

// ---------- the identical single-call parts ----------
export async function buildParts(caseId) {
  const prompt = fill(readPrompt('baseline_fair'), { CASE_ID: caseId, INVENTORY: JSON.stringify(evidenceSummary(caseId)), CASE_TEXT: loadCaseText(caseId) });
  // evidenceMediaParts is the exact function the Argon pipeline (extract / generate_world / critique) uses.
  return [textPart(prompt), ...(await evidenceMediaParts(caseId)), textPart('Output the single JSON object now.')];
}

// ---------- chunked pipeline (Flash): 10-min video chunks + document chunks → merge ----------
function cutVideo(file, outDir, chunkSec) {
  fs.mkdirSync(outDir, { recursive: true });
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
  const dur = parseFloat(r.stdout) || 0;
  const segs = [];
  for (let s = 0, k = 1; s < dur - 1; s += chunkSec, k++) {
    const out = path.join(outDir, `${path.basename(file).replace(/\.[^.]+$/, '')}_part${String(k).padStart(2, '0')}.mp4`);
    if (!fs.existsSync(out) || fs.statSync(out).size === 0) {
      const x = spawnSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(s), '-i', file, '-t', String(chunkSec), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'aac', out], { encoding: 'utf8' });
      if (x.status !== 0) throw new Error(`ffmpeg failed for ${out}: ${x.stderr}`);
    }
    segs.push({ file: out, startSec: s, endSec: Math.min(dur, s + chunkSec) });
  }
  return segs;
}

function splitDocs(caseText, maxChars) {
  const blocks = caseText.split(/(?==== FILE: )/).filter((b) => b.trim());
  const chunks = []; let cur = '';
  for (const b of blocks) {
    if (b.length > maxChars) {                       // a long document: split by lines
      if (cur) { chunks.push(cur); cur = ''; }
      const head = (b.match(/^=== FILE: .+? ===/) || [''])[0];
      let piece = '';
      for (const line of b.split('\n')) {
        if (piece.length + line.length > maxChars) { chunks.push(piece); piece = `${head} (continued)\n`; }
        piece += line + '\n';
      }
      if (piece.trim()) chunks.push(piece);
    } else if (cur.length + b.length > maxChars) { chunks.push(cur); cur = b; } else cur += b;
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

export async function runChunked({ caseId, model = BASELINE_MODEL, tmpDir }) {
  const inv = listEvidence(caseId);
  const vids = caseVideos(caseId);
  const multi = vids.length > 1;
  tmpDir = tmpDir || path.join(process.env.BASELINE_FAIR_TMP || os.tmpdir(), 'sightline_baseline_fair', caseId);
  const t0 = Date.now();
  const jobs = [];
  for (const v of vids) {
    for (const [k, seg] of cutVideo(v.file, tmpDir, CHUNK_SEC).entries()) {
      jobs.push({ kind: 'video', label: `${v.label || v.name} part ${k + 1} (${fmtClock(seg.startSec)}–${fmtClock(seg.endSec)})`, v, seg });
    }
  }
  const docChunks = splitDocs(loadCaseText(caseId), DOC_CHUNK_CHARS);
  docChunks.forEach((c, k) => jobs.push({ kind: 'doc', label: `documents chunk ${k + 1}/${docChunks.length}`, text: c }));
  console.log(`[fair] chunked: ${jobs.length} chunk calls (${jobs.filter((j) => j.kind === 'video').length} video, ${docChunks.length} doc)`);

  const sums = await pool(jobs, CONCURRENCY, async (j) => {
    let parts;
    if (j.kind === 'video') {
      const f = await uploadVideo(j.seg.file);
      const cite = multi ? `Depo ${j.v.label} MM:SS` : 'Depo MM:SS';
      parts = [textPart(`You are watching one segment of a video in a litigation case: ${j.v.isDepo ? `the deposition of ${j.v.label || 'a witness'}` : j.v.label} (file ${j.v.rel}). ` +
        `This segment covers ${fmtClock(j.seg.startSec)}–${fmtClock(j.seg.endSec)} of the full video. Timestamps inside this segment start at 0:00; ADD ${fmtClock(j.seg.startSec)} to convert them to the full video's clock, and cite moments as "${cite}" on the full video's clock.\n` +
        'Summarize for a litigation team: every factual assertion a witness makes (where they were, what they saw, positions, signal states, speeds, times) and everything shown on screen (exhibits, marks or drawings on exhibits, gestures). Concise bullet points, each with its full-video timestamp.'), filePart(f)];
    } else {
      parts = [textPart('Summarize this chunk of case documents for a litigation team. Keep every factual assertion (positions, distances, dimensions, speeds, times, what each witness says they saw) with its file and page citation ("<file> p.N"). Concise bullet points.\n\n' + j.text)];
    }
    const r = await callModel({ model, parts, json: false, maxOutputTokens: 8192, label: `chunk ${j.label}` });
    return { label: j.label, kind: j.kind, seconds: r.seconds, usage: r.usage, error: r.error, text: r.raw || '' };
  });

  const summaryText = sums.map((s) => `## ${s.label}\n${s.error ? `(chunk failed: ${s.error})` : s.text.trim()}`).join('\n\n');
  const prompt = fill(readPrompt('baseline_fair'), {
    CASE_ID: caseId, INVENTORY: JSON.stringify(evidenceSummary(caseId)),
    CASE_TEXT: '(The full documents and videos were too large to read at once. Below are chunk-by-chunk summaries of every document and every 10-minute video segment, produced by a first pass.)\n\n' + summaryText,
  });
  const imgParts = [];
  for (const im of inv.images) { imgParts.push(textPart(`EVIDENCE IMAGE: ${path.relative(inv.dirs.dir, im)}`)); imgParts.push(imagePart(im)); }
  const merge = await callModel({ model, parts: [textPart(prompt), ...imgParts, textPart('Output the single JSON object now.')], label: 'chunked merge' });
  const sumU = (k) => [...sums.map((s) => s.usage?.[k] || 0), merge.usage?.[k] || 0].reduce((a, b) => a + b, 0);
  return {
    model, method: `chunked: ${jobs.length} chunk calls (${CHUNK_SEC / 60}-min video segments + ~${DOC_CHUNK_CHARS / 1000}k-char document chunks, ${CONCURRENCY} in parallel) → 1 merge call (summaries + images)`,
    wallSeconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
    usage: { promptTokenCount: sumU('promptTokenCount'), candidatesTokenCount: sumU('candidatesTokenCount'), thoughtsTokenCount: sumU('thoughtsTokenCount'), totalTokenCount: sumU('totalTokenCount') },
    merge: { seconds: merge.seconds, finishReason: merge.finishReason, usage: merge.usage, error: merge.error, parseError: merge.parseError },
    answer: merge.data, raw: merge.data ? undefined : merge.raw, chunks: sums,
  };
}

// ---------- main ----------
export async function runFairBaseline({ caseId = defaultCaseId(), models = [BASELINE_MODEL, ARGON_MODEL], task = TASK, chunked = true, singles = true } = {}) {
  if (!isLive()) throw new Error('baseline_fair is live-only (SIGHTLINE_MODE=live)');
  if (task !== TASK) throw new Error('custom task text not supported: edit argon/prompts/baseline_fair.md');
  const d = caseDirs(caseId);
  const outPath = path.join(d.cache, 'baseline_fair.json');
  const prev = readJSON(outPath, {}) || {};
  const t0 = Date.now();
  const parts = singles ? await buildParts(caseId) : null;
  const digest = parts ? partsDigest(cleanParts(parts)) : null;
  console.log(`[fair] case=${caseId} models=${models.join(',')} parts=${parts?.length} digest=${digest} (identical for every model)`);

  const [singleRes, chunkRes] = await Promise.all([
    singles ? Promise.all(models.map((m) => callModel({ model: m, parts, label: `single ${m}` }))) : Promise.resolve(null),
    chunked ? runChunked({ caseId }).catch((e) => ({ error: String(e.message || e) })) : Promise.resolve(null),
  ]);

  const out = {
    caseId, at: new Date().toISOString(), task,
    config: { maxOutputTokens: MAX_OUT, thinkingBudget: THINKING, responseMimeType: 'application/json', prompt: 'argon/prompts/baseline_fair.md',
      note: 'Every single-call model got byte-identical parts (same prompt, same case text, same Files-API video URIs, same images); see inputs.digest.' },
    inputs: singles ? { digest, evidence: evidenceSummary(caseId), parts: describeParts(cleanParts(parts)) } : prev.inputs,
    single: singles ? Object.fromEntries(singleRes.map((r) => [r.model, {
      seconds: r.seconds, finishReason: r.finishReason, usage: r.usage, error: r.error, parseError: r.parseError,
      score: r.data ? score(r.data, caseId) : null, answer: r.data, raw: r.data ? undefined : r.raw,
    }])) : prev.single,
    chunked: chunked ? (chunkRes.error ? chunkRes : { ...chunkRes, score: chunkRes.answer ? score(chunkRes.answer, caseId) : null }) : prev.chunked,
    wallSeconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
  };
  writeJSON(outPath, out);
  console.log(`[fair] wrote ${path.relative(process.cwd(), outPath)}`);
  return out;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const arg = (k, dflt) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : dflt; };
  const models = arg('models', `${BASELINE_MODEL},${ARGON_MODEL}`).split(',');
  try {
    const r = await runFairBaseline({ caseId: arg('case', defaultCaseId()), models,
      chunked: !process.argv.includes('--no-chunked'), singles: !process.argv.includes('--only-chunked') });
    const line = (name, x) => x && console.log(`${name}: ${x.error ? 'ERROR ' + x.error.slice(0, 200) : JSON.stringify({ mark: x.score?.mark, markCited: x.score?.markCited, markAnywhere: x.score?.markAnywhere, claim: x.score?.claim, blocked: x.score?.blocked, s: x.seconds ?? x.wallSeconds, prompt: x.usage?.promptTokenCount })}`);
    for (const [m, x] of Object.entries(r.single || {})) line(m, x);
    line('chunked', r.chunked);
  } catch (e) { console.error('[fair] FAILED:', e.stack || e.message); process.exit(1); }
}
