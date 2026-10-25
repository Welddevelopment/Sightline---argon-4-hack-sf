// argon/case.js — per-case paths and evidence loading. Nothing case-specific lives here.
//   cases/<caseId>/evidence/  uploaded files (pdf, md/txt, images, videos)
//   cases/<caseId>/text/      extracted text (INGEST slice) — one file per evidence document
//   cases/<caseId>/worlds|renders|cache/  outputs
import fs from 'node:fs';
import path from 'node:path';
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

/** Every video uploaded via the Files API + every image inline + PDFs without extracted text. */
export async function evidenceMediaParts(caseId) {
  const inv = listEvidence(caseId);
  const parts = [];
  for (const v of inv.videos) {
    const f = await uploadVideo(v);
    parts.push(textPart(`EVIDENCE VIDEO: ${relCase(inv.dirs, v)} — cite moments as "<file name> MM:SS" (for a deposition: "Depo MM:SS"). ` +
      'Watch the visuals, not only the speech: people may point at or mark positions on exhibits, and what is shown can differ from what is said.'));
    parts.push(filePart(f));
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
  return { caseId: inv.dirs.caseId, text: r([...inv.text, ...inv.evidenceText]), videos: r(inv.videos), images: r(inv.images), nativeDocs: r(inv.docsWithoutText) };
}

export const caseMeta = (caseId) => readJSON(path.join(caseDirs(caseId).dir, 'case.json'), {});
