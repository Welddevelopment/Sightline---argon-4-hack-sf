// argon/extract.js — step 3 "Review and confirm": an Argon EXTRACTION pass over all case evidence
// (text + deposition video + images) BEFORE generate_world, so a human can confirm the inputs.
//   → cases/<caseId>/cache/extraction.json (+ extraction.meta.json; raw model output in extraction_raw.*)
// Mock mode serves the cached extraction.json. Shapes: SPEC.md "## REVIEW & CONFIRM (12:10)".
// CLI: node argon/extract.js [--case live1] [--print-prompt]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { callArgon, ARGON_MODEL, readPrompt, fill, textPart, mode as clientMode, readJSON, writeJSON } from './client.js';
import { caseDirs, loadCaseText, evidenceMediaParts, evidenceSummary, defaultCaseId } from './case.js';

export const extractionPath = (caseId) => path.join(caseDirs(caseId).cache, 'extraction.json');
export const extractionMetaPath = (caseId) => path.join(caseDirs(caseId).cache, 'extraction.meta.json');
export const confirmedPath = (caseId) => path.join(caseDirs(caseId).dir, 'confirmed_facts.json');

export function buildExtractPrompt(caseId) {
  return fill(readPrompt('extract'), {
    CASE_ID: caseId,
    INVENTORY: JSON.stringify(evidenceSummary(caseId)),
    CASE_TEXT: loadCaseText(caseId),
  });
}

// ---------- normalization (model output → SPEC shape; tolerant of small deviations) ----------
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const str = (v) => (v === null || v === undefined ? '' : String(v));
const xz = (p) => {
  if (Array.isArray(p) && p.length >= 2 && p.every((v) => Number.isFinite(Number(v)))) {
    return p.length >= 3 ? [Number(p[0]), Number(p[2])] : [Number(p[0]), Number(p[1])];
  }
  if (p && typeof p === 'object' && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.z))) return [Number(p.x), Number(p.z)];
  return null;
};
const isInferred = (c) => /inferred|assum|typical|not in record|estimat/i.test(str(c));

/** Parse a citation into { file, page, timestamp }. */
export function sourceFromCitation(c, fallbackFile = null) {
  const s = str(c);
  const ts = s.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
  const isDepo = /\bdepo/i.test(s) || /\.(mp4|mov|webm|m4v|mkv)\b/i.test(s);
  if (ts && isDepo) {
    const vf = s.match(/([\w.-]+\.(?:mp4|mov|webm|m4v|mkv))/i);
    return { file: vf ? vf[1] : 'deposition.mp4', page: null, timestamp: ts[1] };
  }
  const file = (s.match(/([\w.-]+\.(?:md|txt|pdf|srt|vtt|json|csv|docx?|png|jpe?g|webp))/i) || [])[1] || fallbackFile;
  const pg = s.match(/\bp\.?\s*(\d+)/i);
  return { file: file || null, page: pg ? Number(pg[1]) : null, timestamp: null };
}

function normFact(f, i) {
  const citation = str(f.citation);
  const src = f.source && typeof f.source === 'object' ? f.source : {};
  const parsed = sourceFromCitation(citation, src.file || null);
  const cited = typeof f.cited === 'boolean' ? f.cited && !/^inferred/i.test(citation) : !isInferred(citation);
  let conf = num(f.confidence);
  if (conf !== null && conf > 1) conf = conf / 100;
  return {
    id: str(f.id) || `f${i + 1}`,
    label: str(f.label || f.name),
    value: typeof f.value === 'number' || typeof f.value === 'string' ? f.value : (f.value === null || f.value === undefined ? null : JSON.stringify(f.value)),
    unit: f.unit === undefined || f.unit === '' ? null : f.unit,
    citation,
    source: {
      file: src.file ? path.basename(str(src.file)) : parsed.file,
      page: num(src.page) ?? parsed.page,
      timestamp: src.timestamp ? str(src.timestamp) : parsed.timestamp,
    },
    cited,
    confidence: conf === null ? (cited ? 0.8 : 0.5) : Math.max(0, Math.min(1, conf)),
  };
}

export function normalizeExtraction(raw, { caseId, mode, createdAt = new Date().toISOString() } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const sc = r.scene || {};
  return {
    caseId,
    createdAt,
    mode,
    scene: {
      date: str(sc.date), time: str(sc.time), location: str(sc.location),
      lat: num(sc.lat), lon: num(sc.lon), weather: str(sc.weather), lighting: str(sc.lighting),
      frame: str(sc.frame), citation: str(sc.citation),
    },
    facts: (Array.isArray(r.facts) ? r.facts : []).map(normFact),
    vehicles: (Array.isArray(r.vehicles) ? r.vehicles : []).map((v, i) => ({
      id: str(v.id) || `veh_${i + 1}`, type: str(v.type), description: str(v.description || v.label), citation: str(v.citation),
    })),
    objects: (Array.isArray(r.objects) ? r.objects : []).map((o, i) => ({
      id: str(o.id) || `obj_${i + 1}`, kind: str(o.kind) || 'other', label: str(o.label || o.description),
      position: xz(o.position), citation: str(o.citation),
    })),
    witnesses: (Array.isArray(r.witnesses) ? r.witnesses : []).map((w, i) => ({
      id: str(w.id) || `wit_${i + 1}`, name: str(w.name),
      markedPosition: xz(w.markedPosition ?? w.position),
      positionCitation: str(w.positionCitation),
      eyeHeight: num(w.eyeHeight) ?? 1.6,
      observationTime: str(w.observationTime),
      claim: str(w.claim), claimCitation: str(w.claimCitation || w.citation),
    })),
    notes: typeof r.notes === 'string' ? r.notes : (r.notes ? JSON.stringify(r.notes) : ''),
  };
}

// ---------- public API ----------
export function readExtraction(caseId) {
  return { extraction: readJSON(extractionPath(caseId)), meta: readJSON(extractionMetaPath(caseId)) };
}

/**
 * runExtraction(caseId, { mode }) → { extraction, meta }
 *  mode "mock": serve cases/<id>/cache/extraction.json (error if absent).
 *  mode "live": Argon call over all evidence (needs the process in live mode; SIGHTLINE_MODE=live).
 */
export async function runExtraction(caseId = defaultCaseId(), { mode = clientMode(),
  maxOutputTokens = Number(process.env.ARGON_EXTRACT_MAX_TOKENS || 24576) } = {}) {
  const d = caseDirs(caseId);
  if (mode !== 'live') {
    const cached = readExtraction(caseId);
    if (!cached.extraction) throw new Error(`no cached extraction for case "${caseId}" (cases/${caseId}/cache/extraction.json); run it live`);
    return cached;
  }
  if (clientMode() !== 'live') throw new Error('live extraction requested but the process is in mock mode (set SIGHTLINE_MODE=live)');

  const t0 = Date.now();
  const parts = [textPart(buildExtractPrompt(caseId)), ...(await evidenceMediaParts(caseId)),
    textPart('Output the single JSON object now.')];
  // JSON output; client.js caps thinking (thinkingBudget, default 8192) whenever maxOutputTokens >= 16384.
  const res = await callArgon({ name: 'extraction_raw', model: ARGON_MODEL, parts, json: true, maxOutputTokens, cacheDir: d.cache });
  const rawMeta = readJSON(path.join(d.cache, 'extraction_raw.meta.json'), {}) || {};
  const extraction = normalizeExtraction(res.data, { caseId, mode: res.mode });
  const u = rawMeta.usage || {};
  const meta = {
    caseId, mode: res.mode, model: res.model,
    seconds: rawMeta.seconds ?? Number(((Date.now() - t0) / 1000).toFixed(1)),
    wallSeconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
    usage: { promptTokens: u.promptTokenCount ?? null, outputTokens: u.candidatesTokenCount ?? null, thoughtsTokens: u.thoughtsTokenCount ?? null, totalTokens: u.totalTokenCount ?? null },
    finishReason: rawMeta.finishReason ?? null,
    thinkingBudget: Number(process.env.ARGON_THINKING_BUDGET || 8192),
    maxOutputTokens,
    counts: { facts: extraction.facts.length, vehicles: extraction.vehicles.length, objects: extraction.objects.length, witnesses: extraction.witnesses.length },
    finishedAt: new Date().toISOString(),
  };
  writeJSON(extractionPath(caseId), extraction);
  writeJSON(extractionMetaPath(caseId), meta);
  return { extraction, meta };
}

/** Write cases/<id>/confirmed_facts.json from the reviewer's accepted/edited items. */
export function writeConfirmed(caseId, body = {}) {
  const { extraction } = readExtraction(caseId);
  const arr = (v, k) => (Array.isArray(v) ? v : (extraction?.[k] || []));
  const confirmed = {
    caseId,
    confirmedAt: new Date().toISOString(),
    confirmedBy: str(body.confirmedBy) || 'reviewer',
    extractionCreatedAt: extraction?.createdAt || null,
    scene: body.scene && typeof body.scene === 'object' ? body.scene : (extraction?.scene || {}),
    facts: arr(body.facts, 'facts'),
    vehicles: arr(body.vehicles, 'vehicles'),
    objects: arr(body.objects, 'objects'),
    witnesses: arr(body.witnesses, 'witnesses'),
  };
  writeJSON(confirmedPath(caseId), confirmed);
  return confirmed;
}

export function clearConfirmed(caseId) {
  try { fs.unlinkSync(confirmedPath(caseId)); } catch { /* already absent */ }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const arg = (k, dflt) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : dflt; };
  const caseId = arg('case', defaultCaseId());
  if (process.argv.includes('--print-prompt')) { console.log(buildExtractPrompt(caseId)); process.exit(0); }
  try {
    const { extraction: e, meta } = await runExtraction(caseId, { mode: arg('mode', clientMode()) });
    console.log(`[extract] case=${caseId} mode=${meta?.mode} ${meta?.seconds}s usage=${JSON.stringify(meta?.usage)} ` +
      `facts=${e.facts.length} vehicles=${e.vehicles.length} objects=${e.objects.length} witnesses=${e.witnesses.length}`);
    for (const w of e.witnesses) console.log(`  ${w.id} ${w.name} marked=${JSON.stringify(w.markedPosition)} @ ${w.positionCitation}`);
  } catch (err) { console.error('[extract] FAILED:', err.message); process.exit(1); }
}
