// argon/case.js — per-case paths and evidence loading. Nothing case-specific lives here.
//   cases/<caseId>/evidence/  uploaded files (pdf, md/txt, images, videos)
//   cases/<caseId>/text/      extracted text (INGEST slice) — one file per evidence document
//   cases/<caseId>/worlds|renders|cache/  outputs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, isLive, uploadVideo, textPart, filePart, imagePart, mimeFor, readJSON } from './client.js';

export const CASES_DIR = process.env.SIGHTLINE_CASES_DIR || path.join(ROOT, 'cases');
export const defaultCaseId = () => process.env.SIGHTLINE_CASE || 'demo';

export function caseDirs(caseId = defaultCaseId()) {
  if (!/^[\w.-]+$/.test(caseId)) throw new Error(`bad caseId: ${caseId}`);
  const dir = path.join(CASES_DIR, caseId);
  const d = { caseId, dir, evidence: path.join(dir, 'evidence'), text: path.join(dir, 'text'),
    worlds: path.join(dir, 'worlds'), renders: path.join(dir, 'renders'), cache: path.join(dir, 'cache') };
  for (const k of ['worlds', 'renders', 'cache']) fs.mkdirSync(d[k], { recursive: true });
  return d;
}

const VIDEO = /\.(mp4|mov|webm|m4v|avi|mkv|mpeg|mpg|3gp)$/i;
const IMAGE = /\.(png|jpe?g|webp|gif|heic)$/i;
const TEXT = /\.(md|txt|json|srt|vtt|csv|html?)$/i;
const DOC = /\.(pdf|docx?|rtf)$/i;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out.sort();
}
const stem = (p) => path.basename(p).replace(/\.[^.]+$/, '').toLowerCase();

/** Inventory of a case's evidence. */
export function listEvidence(caseId) {
  const d = caseDirs(caseId);
  const ev = walk(d.evidence), tx = walk(d.text).filter((f) => TEXT.test(f));
  const textStems = new Set(tx.map(stem));
  return {
    dirs: d,
    text: tx,
    evidenceText: ev.filter((f) => TEXT.test(f) && !textStems.has(stem(f))),   // raw text uploads not already extracted
    videos: ev.filter((f) => VIDEO.test(f)),
    images: ev.filter((f) => IMAGE.test(f)),
    docsWithoutText: ev.filter((f) => DOC.test(f) && !textStems.has(stem(f))),  // send natively if INGEST didn't extract
  };
}

const relCase = (d, f) => path.relative(d.dir, f).split(path.sep).join('/');

/** All text evidence concatenated with "=== FILE: <path> ===" headers (citations name these files). */
export function loadCaseText(caseId) {
  const inv = listEvidence(caseId);
  const files = [...inv.text, ...inv.evidenceText];
  if (!files.length) return '(no text evidence in this case)';
  return files.map((f) => `=== FILE: ${relCase(inv.dirs, f)} ===\n${fs.readFileSync(f, 'utf8').trim()}\n`).join('\n');
}

/** Transcript-like text (for the text-only baseline): .srt/.vtt and files whose name suggests a transcript/deposition. */
export function loadTranscripts(caseId) {
  const inv = listEvidence(caseId);
  const files = [...inv.text, ...inv.evidenceText].filter((f) => /\.(srt|vtt)$/i.test(f) || /transcript|depo|deposition|interview|statement|testimony/i.test(path.basename(f)));
  return files.map((f) => ({ file: relCase(inv.dirs, f), text: fs.readFileSync(f, 'utf8') }));
}

// ---------- multi-video labelling (several depositions per case) ----------
const _dur = new Map(); // abs path -> { mtimeMs, sec }
/** Real duration (s) via ffprobe (cached by mtime); falls back to case.json files[].durationSec. */
export function videoDurationSec(file, fallback = null) {
  try {
    const st = fs.statSync(file);
    const hit = _dur.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.sec ?? fallback;
    const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8', timeout: 15000 });
    const d = parseFloat(r.stdout);
    const sec = Number.isFinite(d) ? Math.round(d * 10) / 10 : null;
    _dur.set(file, { mtimeMs: st.mtimeMs, sec });
    return sec ?? fallback;
  } catch { return fallback; }
}
/** 1801.8 → "30:01"; ≥1 h → "1:02:03". */
export function fmtClock(sec) {
  if (!Number.isFinite(sec)) return '?:??';
  const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
const DEPO_RE = /depo|deposition|testimony|interview|witness|statement/i;
const titleWord = (w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1));
/** "depo_brandt.mp4" → "Brandt", "deposition-witness_c.mp4" → "Witness C", "deposition.mp4" → "" */
export function labelFromFilename(name) {
  const words = path.basename(name).replace(/\.[^.]+$/, '').split(/[^A-Za-z0-9]+/).filter(Boolean)
    .filter((w) => !/^(depo|deposition|video|vid|of|the|recording|tape|clip|final|\d+)$/i.test(w));
  return words.map(titleWord).join(' ');
}
/**
 * Every evidence video with a citation label and real duration.
 * Label: case.json files[].label (or .deponent / .witness), else from the file name, else "A", "B", ... by order.
 * → [{ file, rel, name, index, label, isDepo, durationSec, clock, cite }]
 */
export function caseVideos(caseId) {
  const inv = listEvidence(caseId);
  const metaFiles = (caseMeta(caseId).files || []);
  const used = new Set();
  return inv.videos.map((file, i) => {
    const name = path.basename(file);
    const m = metaFiles.find((f) => f && f.name === name) || {};
    let label = String(m.label || m.deponent || m.witness || '').trim() || labelFromFilename(name);
    if (!label || used.has(label.toLowerCase())) label = (label ? label + ' ' : '') + String.fromCharCode(65 + i);
    used.add(label.toLowerCase());
    const isDepo = DEPO_RE.test(name) || !!(m.deponent || m.witness) || /deposition/i.test(m.kind || '');
    const durationSec = videoDurationSec(file, m.durationSec ?? null);
    return { file, rel: relCase(inv.dirs, file), name, index: i + 1, label, isDepo, durationSec, clock: fmtClock(durationSec),
      cite: isDepo ? `Depo ${label} MM:SS` : `${label} MM:SS` };
  });
}

const WATCH_VISUALS = 'Watch the visuals, not only the speech: people may point at or mark positions on exhibits, and what is shown can differ from what is said.';

/** Every video uploaded via the Files API + every image inline + PDFs without extracted text. */
export async function evidenceMediaParts(caseId) {
  const inv = listEvidence(caseId);
  const parts = [];
  if (inv.videos.length <= 1) {
    // Single video: byte-identical parts to the original demo calls (keeps cached outputs / live reuse hashes valid).
    for (const v of inv.videos) {
      const f = await uploadVideo(v);
      parts.push(textPart(`EVIDENCE VIDEO: ${relCase(inv.dirs, v)} — cite moments as "<file name> MM:SS" (for a deposition: "Depo MM:SS"). ` + WATCH_VISUALS));
      parts.push(filePart(f));
    }
  } else {
    const vids = caseVideos(caseId);
    const total = vids.reduce((n, v) => n + (v.durationSec || 0), 0);
    parts.push(textPart(`EVIDENCE VIDEOS: ${vids.length} videos, total ${fmtClock(total)}. Each is labelled below. ` +
      'CITATION RULE: every video moment must name which video it comes from — "Depo <label> MM:SS" for a deposition ' +
      `(e.g. "${vids[0].cite.replace('MM:SS', '27:04')}"), "<label> MM:SS" otherwise; MM:SS is that video's own clock. ` +
      'Never write a bare "Depo MM:SS" in this case. Compare the videos against each other and against the documents.'));
    for (const v of vids) {
      const f = await uploadVideo(v.file);
      parts.push(textPart(`VIDEO ${v.index}: ${v.isDepo ? `deposition of ${v.label}` : v.label} (${v.clock}) — file ${v.rel}. ` +
        `Cite moments as "${v.cite}". ` + WATCH_VISUALS));
      parts.push(filePart(f));
    }
  }
  for (const im of inv.images) {
    parts.push(textPart(`EVIDENCE IMAGE: ${relCase(inv.dirs, im)}`));
    if (isLive() && fs.statSync(im).size > 4 * 1024 * 1024) parts.push(filePart(await uploadVideo(im)));
    else parts.push(imagePart(im));
  }
  for (const doc of inv.docsWithoutText) {
    parts.push(textPart(`EVIDENCE DOCUMENT (no extracted text available, sent natively): ${relCase(inv.dirs, doc)}`));
    parts.push(filePart(await uploadVideo(doc, { mimeType: mimeFor(doc) })));
  }
  return parts;
}

export function evidenceSummary(caseId) {
  const inv = listEvidence(caseId);
  const r = (a) => a.map((f) => relCase(inv.dirs, f));
  const out = { caseId: inv.dirs.caseId, text: r([...inv.text, ...inv.evidenceText]), videos: r(inv.videos), images: r(inv.images), nativeDocs: r(inv.docsWithoutText) };
  // Multi-video cases only (single-video inventory stays unchanged): label, real length and citation form per video.
  if (inv.videos.length > 1) out.videoIndex = caseVideos(caseId).map((v) => ({ video: v.index, file: v.rel, label: v.label, length: v.clock, cite: v.cite }));
  return out;
}

export const caseMeta = (caseId) => readJSON(path.join(caseDirs(caseId).dir, 'case.json'), {});
