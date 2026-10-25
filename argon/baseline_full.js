// argon/baseline_full.js — the FAIR baseline: every model gets EXACTLY the same inputs as Argon
// (all documents + all images + every deposition video via the Files API) and the same neutral question.
//
//   single : one call per model over the full case file, all models in parallel.
//   chunked: conventional chunk-and-summarize over EVERYTHING (videos cut into ~20 min pieces with ffmpeg,
//            documents into ~100k-token pieces, images/native docs as their own chunks), baseline model only,
//            then one final call over the summaries with the same question.
//
// Scoring compares each result with the hidden truth in case_full/meta.json (read ONLY by the scorer, never
// sent to a model) → cases/<id>/cache/baseline_full.json.
//
// CLI: node argon/baseline_full.js --case demo-full [--models gemini-4-argon,gemini-3.8-flash] [--variant single|chunked|both]
//   SIGHTLINE_MODE unset/mock: uses cached outputs if present, else prints the plan (part counts, est. tokens) and exits 0.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, callArgon, getAI, ARGON_MODEL, BASELINE_MODEL, readPrompt, fill, textPart, filePart, imagePart,
  uploadVideo, mimeFor, readJSON, writeJSON, isLive, mode } from './client.js';
import { caseDirs, loadCaseText, evidenceMediaParts, listEvidence, caseVideos, videoDurationSec, fmtClock, defaultCaseId } from './case.js';

export const TOKEN_LIMIT = 1_048_576;
export const CHUNK_SEC = Number(process.env.BASELINE_FULL_CHUNK_SEC || 20 * 60);
export const DOC_CHUNK_TOKENS = Number(process.env.BASELINE_FULL_DOC_CHUNK_TOKENS || 100_000);
const CHARS_PER_TOKEN = 4;
const VIDEO_TOKENS_PER_SEC = 300;   // ~258 frame + ~32 audio tokens per second at default resolution
const IMAGE_TOKENS = 258;
const PDF_TOKENS_GUESS = 2_000;
const CONCURRENCY = 6;

export const slug = (m) => String(m).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const rel = (p) => '/' + path.relative(ROOT, p).split(path.sep).join('/');

// ---------------------------------------------------------------- shared
const SINGLE_NOTE = '# CASE FILE\nThe complete case file follows: every text document (each under "=== FILE: <path> ===" with its page markers), then every image, video and native document, each labelled.';
const CHUNKED_NOTE = '# CASE FILE (chunk summaries)\nThe case file was too large to read at once, so every part of it (all documents, all images and every video, in pieces) was summarized chunk by chunk. You are given all the chunk summaries below, each labelled with its source. Timecodes refer to the original videos.';

function readMeta(cacheDir, name) { return readJSON(path.join(cacheDir, `${name}.meta.json`)); }
function cached(cacheDir, name, ext = 'json') { return fs.existsSync(path.join(cacheDir, `${name}.${ext}`)); }
function usageOf(meta) {
  const u = meta?.usage || {};
  return { input: u.promptTokenCount ?? u.promptTokens ?? null, output: u.candidatesTokenCount ?? u.outputTokens ?? null,
    thinking: u.thoughtsTokenCount ?? u.thoughtsTokens ?? null };
}
const sumTok = (list) => list.reduce((acc, t) => ({ input: (acc.input || 0) + (t.input || 0), output: (acc.output || 0) + (t.output || 0),
  thinking: (acc.thinking || 0) + (t.thinking || 0) }), { input: 0, output: 0, thinking: 0 });

/** Rough token estimate for a list of parts (mock planning only). */
export function estimateTokens(parts, inv) {
  let t = 0;
  const vids = new Map((inv?.videos || []).map((v) => [v, videoDurationSec(v)]));
  for (const p of parts) {
    if (p.text) t += Math.ceil(p.text.length / CHARS_PER_TOKEN);
    else if (p.inlineData) t += IMAGE_TOKENS;
    else if (p.fileData) {
      const m = String(p.fileData.fileUri).match(/^mock:\/\/files\/(.+)$/);
      const abs = m ? path.join(ROOT, m[1]) : null;
      if (/^video\//.test(p.fileData.mimeType)) t += Math.round((vids.get(abs) ?? (abs ? videoDurationSec(abs) : 0) ?? 0) * VIDEO_TOKENS_PER_SEC);
      else if (/^image\//.test(p.fileData.mimeType)) t += IMAGE_TOKENS;
      else t += PDF_TOKENS_GUESS;
    }
  }
  return t;
}
const partCounts = (parts) => ({ total: parts.length, text: parts.filter((p) => p.text).length,
  inline: parts.filter((p) => p.inlineData).length, files: parts.filter((p) => p.fileData).length });

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

/** Call and record latency_ms + usage into <name>.meta.json (callArgon already writes usage from usageMetadata). */
async function timedCall(opts) {
  const t0 = Date.now();
  const res = await callArgon(opts);
  const metaPath = path.join(opts.cacheDir, `${opts.name}.meta.json`);
  let meta = readJSON(metaPath) || {};
  if (res.mode === 'live') {
    meta = { ...meta, latency_ms: Date.now() - t0 };
    writeJSON(metaPath, meta);
  }
  const latency_ms = meta.latency_ms ?? (meta.seconds != null ? Math.round(meta.seconds * 1000) : null);
  return { res, meta, latency_ms, tokens: usageOf(meta) };
}

// ---------------------------------------------------------------- single
export async function buildSingleParts(caseId) {
  const prompt = fill(readPrompt('baseline_full'), { CASE_MATERIAL: SINGLE_NOTE });
  return [textPart(prompt), textPart(loadCaseText(caseId)), ...(await evidenceMediaParts(caseId)),
    textPart('Answer with the JSON object only.')];
}

async function runSingle({ caseId, models, d, parts, inputTokens }) {
  const names = models.map((m) => `baseline_full_${slug(m)}`);
  if (!isLive() && !names.some((n) => cached(d.cache, n))) return {};
  const results = {};
  await Promise.all(models.map(async (model, i) => {
    const name = names[i];
    if (!isLive() && !cached(d.cache, name)) { console.log(`[baseline_full] mock: no cache for ${name}, skipping ${model}`); return; }
    try {
      const r = await timedCall({ name, model, parts, json: true, maxOutputTokens: 16384, cacheDir: d.cache });
      results[model] = { variant: 'single', latency_s: r.latency_ms != null ? +(r.latency_ms / 1000).toFixed(1) : null,
        tokens: r.tokens, raw: r.res.data, mode: r.res.mode };
      console.log(`[baseline_full] ${model} single: ${results[model].latency_s}s, tokens ${JSON.stringify(r.tokens)}`);
    } catch (e) {
      console.error(`[baseline_full] ${model} single FAILED: ${e.message}`);
      results[model] = { variant: 'single', error: e.message, raw: null };
    }
  }));
  return results;
}

// ---------------------------------------------------------------- chunked
/** Cut a video into ~CHUNK_SEC pieces (stream copy). Reuses existing pieces. → [{ file, offsetSec, durationSec }] */
export function splitVideo(file, outDir, chunkSec = CHUNK_SEC) {
  fs.mkdirSync(outDir, { recursive: true });
  const ext = path.extname(file);
  const stem = path.basename(file, ext);
  const st = fs.statSync(file);
  const manPath = path.join(outDir, `${stem}.chunks.json`);
  const man = readJSON(manPath);
  const key = `${st.size}|${Math.round(st.mtimeMs)}|${chunkSec}`;
  if (man?.key === key && man.chunks.every((c) => fs.existsSync(path.join(ROOT, c.file.slice(1))))) {
    return man.chunks.map((c) => ({ ...c, file: path.join(ROOT, c.file.slice(1)) }));
  }
  for (const f of fs.readdirSync(outDir)) if (f.startsWith(`${stem}_`) && f.endsWith(ext)) fs.unlinkSync(path.join(outDir, f));
  console.log(`[baseline_full] splitting ${rel(file)} into ~${chunkSec / 60} min chunks`);
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-c', 'copy', '-map', '0', '-f', 'segment',
    '-segment_time', String(chunkSec), '-reset_timestamps', '1', path.join(outDir, `${stem}_%03d${ext}`)], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg split failed for ${rel(file)}: ${r.stderr || r.error?.message}`);
  const pieces = fs.readdirSync(outDir).filter((f) => f.startsWith(`${stem}_`) && f.endsWith(ext)).sort();
  let off = 0;
  const chunks = pieces.map((f) => {
    const abs = path.join(outDir, f);
    const dur = videoDurationSec(abs) || 0;
    const c = { file: abs, offsetSec: Math.round(off * 10) / 10, durationSec: dur };
    off += dur;
    return c;
  });
  writeJSON(manPath, { key, source: rel(file), chunks: chunks.map((c) => ({ ...c, file: rel(c.file) })) });
  return chunks;
}

/** Split concatenated case text into ~maxTokens pieces at file boundaries (lines inside a big file). */
export function splitText(text, maxTokens = DOC_CHUNK_TOKENS) {
  const max = maxTokens * CHARS_PER_TOKEN;
  const blocks = text.split(/(?==== FILE: )/).filter((b) => b.trim());
  const units = [];
  for (const b of blocks) {
    if (b.length <= max) { units.push(b); continue; }
    const header = (b.match(/^=== FILE: .+? ===/) || [''])[0];
    let cur = '';
    for (const line of b.split('\n')) {
      if (cur.length + line.length + 1 > max && cur) { units.push(cur); cur = `${header} (continued)\n`; }
      cur += line + '\n';
    }
    if (cur.trim()) units.push(cur);
  }
  const out = []; let cur = '';
  for (const u of units) {
    if (cur && cur.length + u.length > max) { out.push(cur); cur = ''; }
    cur += u;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Plan the chunks. In mock mode videos are not cut; their chunk count is computed from the duration. */
export async function planChunks(caseId, d, { split = isLive() } = {}) {
  const inv = listEvidence(caseId);
  const chunks = [];
  splitText(loadCaseText(caseId)).forEach((t, i, all) => chunks.push({ kind: 'text', label: `documents part ${i + 1} of ${all.length}`,
    note: 'Text documents, each under "=== FILE: <path> ===" with page markers.', parts: [textPart(t)], estTokens: Math.ceil(t.length / CHARS_PER_TOKEN) }));
  const vids = inv.videos.length ? caseVideos(caseId) : [];
  for (const v of vids) {
    const who = v.isDepo ? `deposition of ${v.label}` : v.label;
    let pieces;
    if (split) pieces = splitVideo(v.file, path.join(d.cache, 'video_chunks'));
    else {
      const n = Math.max(1, Math.ceil((v.durationSec || 0) / CHUNK_SEC));
      pieces = Array.from({ length: n }, (_, k) => ({ file: v.file, offsetSec: k * CHUNK_SEC,
        durationSec: Math.min(CHUNK_SEC, (v.durationSec || 0) - k * CHUNK_SEC) }));
    }
    pieces.forEach((p, k) => chunks.push({ kind: 'video', label: `VIDEO ${v.index}: ${who}, piece ${k + 1} of ${pieces.length}`,
      note: `This piece starts at ${fmtClock(p.offsetSec)} of the original video (${v.rel}, total ${v.clock}). Report every timecode in the ORIGINAL video's clock: add ${fmtClock(p.offsetSec)} to the time shown in this piece. Cite as "${v.cite.replace('MM:SS', 'H:MM:SS')}". Watch the visuals, not only the speech: people may point at or mark positions on exhibits.`,
      video: p, estTokens: Math.round((p.durationSec || 0) * VIDEO_TOKENS_PER_SEC) }));
  }
  if (inv.images.length) {
    chunks.push({ kind: 'images', label: `images (${inv.images.length})`, note: 'Every image exhibit in the case, each labelled with its file.',
      images: inv.images, estTokens: inv.images.length * IMAGE_TOKENS });
  }
  for (const doc of inv.docsWithoutText) chunks.push({ kind: 'doc', label: `document ${path.relative(d.dir, doc)}`,
    note: 'A native document (no extracted text available).', doc, estTokens: PDF_TOKENS_GUESS });
  return chunks;
}

async function chunkParts(c, d) {
  const head = fill(readPrompt('baseline_full_chunk'), { CHUNK_LABEL: c.label, CHUNK_NOTE: c.note });
  const parts = [textPart(head)];
  if (c.parts) parts.push(...c.parts);
  if (c.video) parts.push(filePart(await uploadVideo(c.video.file)));
  if (c.images) for (const im of c.images) {
    parts.push(textPart(`EVIDENCE IMAGE: ${path.relative(d.dir, im)}`));
    if (isLive() && fs.statSync(im).size > 4 * 1024 * 1024) parts.push(filePart(await uploadVideo(im))); else parts.push(imagePart(im));
  }
  if (c.doc) parts.push(filePart(await uploadVideo(c.doc, { mimeType: mimeFor(c.doc) })));
  return parts;
}

async function runChunked({ caseId, model, d }) {
  const s = slug(model);
  const finalName = `baseline_full_chunked_${s}`;
  const chunks = await planChunks(caseId, d);
  const chunkName = (i) => `baseline_full_chunk_${s}_${String(i + 1).padStart(3, '0')}`;
  if (!isLive()) {
    console.log(`[baseline_full] plan chunked (${model}): ${chunks.length} chunk calls + 1 final call`);
    for (const [i, c] of chunks.entries()) console.log(`    ${chunkName(i)}  ${c.kind.padEnd(6)} ~${c.estTokens.toLocaleString()} tok  ${c.label}`);
    if (!cached(d.cache, finalName)) return null;
  }
  const t0 = Date.now();
  let chunkTokens = [];
  let summaries = [];
  if (isLive()) {
    const outs = await pool(chunks, CONCURRENCY, async (c, i) => {
      const r = await timedCall({ name: chunkName(i), model, parts: await chunkParts(c, d), maxOutputTokens: 8192, cacheDir: d.cache });
      console.log(`[baseline_full] chunk ${i + 1}/${chunks.length} done (${c.label})`);
      return { text: `## CHUNK ${i + 1}: ${c.label}\n${r.res.text.trim()}`, tokens: r.tokens };
    });
    summaries = outs.map((o) => o.text); chunkTokens = outs.map((o) => o.tokens);
  } else {
    chunkTokens = chunks.map((_, i) => usageOf(readMeta(d.cache, chunkName(i))));
  }
  const prompt = fill(readPrompt('baseline_full'), { CASE_MATERIAL: `${CHUNKED_NOTE}\n\n${summaries.join('\n\n')}` });
  const fin = await timedCall({ name: finalName, model, parts: [textPart(prompt), textPart('Answer with the JSON object only.')],
    json: true, maxOutputTokens: 16384, cacheDir: d.cache });
  const metaPath = path.join(d.cache, `${finalName}.meta.json`);
  let latency_ms = Date.now() - t0;
  if (fin.res.mode === 'live') writeJSON(metaPath, { ...readJSON(metaPath), pipeline_latency_ms: latency_ms, chunks: chunks.length, chunk_tokens: sumTok(chunkTokens) });
  else latency_ms = readJSON(metaPath)?.pipeline_latency_ms ?? fin.latency_ms;
  const tokens = sumTok([...chunkTokens, fin.tokens]);
  console.log(`[baseline_full] ${model} chunked: ${chunks.length} chunks, ${(latency_ms / 1000).toFixed(1)}s, tokens ${JSON.stringify(tokens)}`);
  return { variant: 'chunked', chunks: chunks.length, latency_s: latency_ms != null ? +(latency_ms / 1000).toFixed(1) : null, tokens, raw: fin.res.data, mode: fin.res.mode };
}

// ---------------------------------------------------------------- scoring (the ONLY place the hidden truth is read)
export function loadTruth(caseId) {
  const d = caseDirs(caseId);
  for (const p of [path.join(ROOT, 'case_full', 'meta.json'), path.join(d.dir, 'case_full', 'meta.json'), path.join(d.dir, 'meta.json')]) {
    const m = readJSON(p);
    if (m && (m.witness_id != null || m.mark_sec != null)) return { ...m, _path: p };
  }
  return null;
}

/** All timecodes in a string, in seconds ("2:14:30" → 8070, "14:30" → 870). */
export function timecodesIn(s) {
  const out = [];
  const re = /(?<![\d.])(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?![\d])/g;
  let m;
  while ((m = re.exec(String(s ?? '')))) out.push(m[3] != null ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]));
  return out;
}
const normId = (x) => String(x ?? '').toLowerCase().replace(/^\s*(wit(ness)?)[\s_-]*/, '').replace(/[^a-z0-9]/g, '');
function locSec(l) {
  if (typeof l === 'number') return [l];
  if (typeof l === 'string') return timecodesIn(l);
  if (l && typeof l === 'object') {
    const n = l.sec ?? l.t ?? l.time_sec ?? l.start_sec ?? l.seconds;
    if (Number.isFinite(Number(n))) return [Number(n)];
    return timecodesIn(l.timecode || l.time || l.citation || '');
  }
  return [];
}

export function scoreResult(raw, truth, { videoLabels = [] } = {}) {
  if (!raw || !truth) return { found_mark: null, found_claim: null, concluded_blocked: null };
  const wid = normId(truth.witness_id);
  const ws = Array.isArray(raw.witnesses) ? raw.witnesses : [];
  const target = ws.find((w) => normId(w.id) === wid)
    || ws.find((w) => new RegExp(`\\b(witness|wit|depo)[\\s_-]*${wid}\\b`, 'i').test(`${w.id} ${w.position_citation} ${w.claim_citation}`));
  // A timecode only counts if it doesn't explicitly name a different video than the one with the mark.
  const markLabel = truth.mark_video ? String(truth.mark_video).toLowerCase() : null;
  const otherLabels = videoLabels.filter((l) => markLabel && !markLabel.includes(l.toLowerCase()) && !l.toLowerCase().includes(markLabel));
  const namesOther = (s) => otherLabels.some((l) => new RegExp(`\\b${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(String(s))) && !(markLabel && String(s).toLowerCase().includes(markLabel));
  const near = (s, secs, tol = 60) => !namesOther(s) && timecodesIn(s).some((t) => secs.some((x) => Math.abs(t - x) <= tol));
  const markSecs = truth.mark_sec != null ? [Number(truth.mark_sec)] : [];
  const found_mark = markSecs.length ? !!((target && near(target.position_citation, markSecs)) || near(raw.map_mark_timecode, markSecs)) : null;
  const claimSecs = (truth.claim_locations || []).flatMap(locSec);
  const found_claim = !target ? false : claimSecs.length ? near(`${target.claim_citation}`, claimSecs) : !!String(target.claim || '').trim();
  const concluded_blocked = !!(target && String(target.verdict || '').toLowerCase().trim() === 'contradiction');
  return { found_mark, found_claim, concluded_blocked, target_witness: target ? { id: target.id, verdict: target.verdict, position_citation: target.position_citation, claim_citation: target.claim_citation } : null };
}

// ---------------------------------------------------------------- main
export async function runBaselineFull({ caseId = defaultCaseId(), models = [ARGON_MODEL, BASELINE_MODEL], variant = 'single' } = {}) {
  const d = caseDirs(caseId);
  const inv = listEvidence(caseId);
  const wantSingle = variant === 'single' || variant === 'both';
  const wantChunked = variant === 'chunked' || variant === 'both';
  // Live chunked-only runs don't need the full videos uploaded.
  const parts = (wantSingle || !isLive()) ? await buildSingleParts(caseId) : [];
  const est = estimateTokens(parts, inv);
  const chunkModel = BASELINE_MODEL;

  let inputTokens = null;
  if (isLive() && wantSingle) {
    const ai = await getAI();
    const ct = await ai.models.countTokens({ model: models[0], contents: [{ role: 'user', parts: parts.map(({ _path, ...p }) => p) }] });
    inputTokens = ct.totalTokens ?? null;
    console.log(`[baseline_full] countTokens(${models[0]}) = ${inputTokens?.toLocaleString()} tokens (limit ${TOKEN_LIMIT.toLocaleString()})`);
    if (inputTokens != null && inputTokens > TOKEN_LIMIT) {
      throw new Error(`input is ${inputTokens.toLocaleString()} tokens, over the ${TOKEN_LIMIT.toLocaleString()}-token context window — ` +
        'trim the case (shorter/fewer videos, lower resolution) before running the single-call comparison');
    }
  }

  if (!isLive()) {
    console.log(`[baseline_full] mode=${mode()} case=${caseId} variant=${variant} models=${models.join(',')}`);
    console.log(`[baseline_full] plan single: ${JSON.stringify(partCounts(parts))} parts, est ~${est.toLocaleString()} tokens ` +
      `(${inv.text.length + inv.evidenceText.length} text files, ${inv.videos.length} videos, ${inv.images.length} images, ${inv.docsWithoutText.length} native docs)`);
    if (est > TOKEN_LIMIT) console.warn(`[baseline_full] WARNING: estimate exceeds ${TOKEN_LIMIT.toLocaleString()} tokens; the live run would abort`);
    for (const m of models) console.log(`    would call ${m} once as baseline_full_${slug(m)} (json, maxOutputTokens 16384)`);
  }

  const results = {};
  const jobs = [];
  if (wantSingle) jobs.push(runSingle({ caseId, models, d, parts, inputTokens }).then((r) => Object.assign(results, r)));
  if (wantChunked) jobs.push(runChunked({ caseId, model: chunkModel, d }).then((r) => { if (r) results[`${chunkModel} (chunked)`] = r; })
    .catch((e) => { console.error(`[baseline_full] chunked FAILED: ${e.message}`); results[`${chunkModel} (chunked)`] = { variant: 'chunked', error: e.message, raw: null }; }));
  await Promise.all(jobs);

  if (!Object.keys(results).length) {
    console.log('[baseline_full] mock mode and no cached outputs: nothing sent. Run with SIGHTLINE_MODE=live to execute.');
    return null;
  }

  const truth = loadTruth(caseId);
  if (!truth) console.warn('[baseline_full] WARNING: case_full/meta.json not found — skipping scoring (found_* fields are null)');
  const videoLabels = inv.videos.length ? caseVideos(caseId).map((v) => v.label).filter(Boolean) : [];
  const prev = readJSON(path.join(d.cache, 'baseline_full.json')) || {};
  const out = {
    ran_at: new Date().toISOString(),
    inputs: 'same inputs: all documents + all video',
    input_token_count: inputTokens ?? prev.input_token_count ?? usageOf(readMeta(d.cache, `baseline_full_${slug(models[0])}`)).input ?? null,
    scored: !!truth,
    results: { ...(prev.results || {}) },
  };
  for (const [k, r] of Object.entries(results)) {
    const s = scoreResult(r.raw, truth, { videoLabels });
    out.results[k] = { variant: r.variant, ...(r.chunks ? { chunks: r.chunks } : {}), latency_s: r.latency_s ?? null, tokens: r.tokens || null,
      found_mark: s.found_mark, found_claim: s.found_claim, concluded_blocked: s.concluded_blocked, target_witness: s.target_witness ?? null,
      ...(r.error ? { error: r.error } : {}), raw: r.raw };
  }
  const outPath = path.join(d.cache, 'baseline_full.json');
  writeJSON(outPath, out);
  console.log(`[baseline_full] wrote ${rel(outPath)}`);
  for (const [k, r] of Object.entries(out.results)) console.log(`    ${k.padEnd(28)} ${r.variant.padEnd(8)} mark=${r.found_mark} claim=${r.found_claim} blocked=${r.concluded_blocked} ${r.latency_s ?? '?'}s`);
  return out;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const arg = (k, dflt) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : dflt; };
  const variant = arg('variant', 'single');
  if (!['single', 'chunked', 'both'].includes(variant)) { console.error('--variant must be single|chunked|both'); process.exit(2); }
  const models = arg('models', `${ARGON_MODEL},${BASELINE_MODEL}`).split(',').map((s) => s.trim()).filter(Boolean);
  try { await runBaselineFull({ caseId: arg('case', defaultCaseId()), models, variant }); process.exit(0); }
  catch (e) { console.error('[baseline_full] FAILED:', e.message); process.exit(1); }
}
