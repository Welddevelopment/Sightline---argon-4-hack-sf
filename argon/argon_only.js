// argon/argon_only.js — the "what only Argon could do" summary card for the demo.
//   → cases/<id>/argon_only.json  { tokens_total, video_seconds, videos[], pages, baseline{}, argon{}, key_frames{} }
// Reads: cache/generate_world.meta.json (or cache/baseline_full_<argon>.meta.json), cache/baseline_full.json,
//        docket_manifest.json, evidence videos (ffprobe), renders/world_v*/wit_<B>.png, keyframes/, case_full/meta.json.
// No model calls; safe in mock mode.
// CLI: node argon/argon_only.js --case demo-full
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, ARGON_MODEL, BASELINE_MODEL, readJSON, writeJSON } from './client.js';
import { caseDirs, listEvidence, caseVideos, fmtClock, defaultCaseId } from './case.js';
import { slug, loadTruth } from './baseline_full.js';

const rel = (p) => (p ? '/' + path.relative(ROOT, p).split(path.sep).join('/') : null);
const promptTokens = (m) => m?.usage?.promptTokenCount ?? m?.usage?.promptTokens ?? null;

function sumPages(x) {
  if (Array.isArray(x)) return x.reduce((n, v) => n + sumPages(v), 0);
  if (x && typeof x === 'object') return Object.entries(x).reduce((n, [k, v]) =>
    n + (k === 'pages' && Number.isFinite(Number(v)) && typeof v !== 'object' ? Number(v) : sumPages(v)), 0);
  return 0;
}
const PAGE_MARK = /^=+\s.*?\bp(?:age|\.)\s*\d+.*?=+\s*$/gim;

export function countPages(caseId) {
  const d = caseDirs(caseId);
  const man = readJSON(path.join(d.dir, 'docket_manifest.json'));
  const manStr = man ? JSON.stringify(man).toLowerCase() : '';
  let pages = man ? sumPages(man) : 0;
  const inv = listEvidence(caseId);
  for (const f of [...inv.text, ...inv.evidenceText]) {
    const stem = path.basename(f).replace(/\.[^.]+$/, '').toLowerCase();
    if (man && manStr.includes(stem)) continue;           // already counted from the manifest
    pages += (fs.readFileSync(f, 'utf8').match(PAGE_MARK) || []).length;
  }
  return pages;
}

function shortVerdict(r, truth) {
  if (!r) return 'baseline not run yet';
  if (r.error) return `baseline call failed: ${r.error}`;
  const t = r.target_witness;
  const who = truth?.witness_id != null ? `Witness ${truth.witness_id}` : 'the key witness';
  if (!t) return `Did not identify ${who}'s visibility claim as a separate finding.`;
  const v = String(t.verdict || 'undetermined').toLowerCase();
  const mark = r.found_mark ? 'found the on-screen map mark' : 'did not find the on-screen map mark';
  if (v === 'contradiction') return `Flagged ${who} as a contradiction and ${mark}.`;
  if (v === 'consistent') return `Rated ${who}'s testimony consistent (did not conclude the view was blocked) and ${mark}.`;
  return `Left ${who} undetermined and ${mark}.`;
}

function newestRender(d, witnessId) {
  if (!fs.existsSync(d.renders)) return null;
  const vers = fs.readdirSync(d.renders).map((n) => [n, Number((n.match(/^world_v(\d+)$/) || [])[1])]).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
  for (const [n, v] of vers) {
    const p = path.join(d.renders, n, `wit_${witnessId}.png`);
    if (fs.existsSync(p)) return { png: p, version: v };
  }
  return null;
}

async function observationTime(d, version, witnessId) {
  try {
    const f = path.join(d.worlds, `world_v${version}.js`);
    if (!fs.existsSync(f)) return null;
    const { loadWorldFile } = await import('./world_io.js');
    const w = await loadWorldFile(f);
    const wit = (w.witnesses || []).find((x) => x.id === `wit_${witnessId}` || x.id === witnessId);
    return wit?.observationTime ?? null;
  } catch { return null; }
}

function findKeyframe(d, markSec) {
  const dir = path.join(d.dir, 'keyframes');
  if (!fs.existsSync(dir) || markSec == null) return null;
  const s = Math.round(Number(markSec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p2 = (n) => String(n).padStart(2, '0');
  const forms = [`${h}-${p2(m)}-${p2(ss)}`, `${h}_${p2(m)}_${p2(ss)}`, `${p2(h)}${p2(m)}${p2(ss)}`, `${h}h${p2(m)}m${p2(ss)}s`,
    `${p2(h)}-${p2(m)}-${p2(ss)}`, `${p2(h)}_${p2(m)}_${p2(ss)}`, `t${s}`, `_${s}`, `${s}s`];
  const files = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();
  const hit = files.find((f) => forms.some((x) => f.toLowerCase().includes(x.toLowerCase()))) || files.find((f) => /mark/i.test(f));
  return hit ? path.join(dir, hit) : null;
}

export async function buildArgonOnly(caseId = defaultCaseId()) {
  const d = caseDirs(caseId);
  const gw = readJSON(path.join(d.cache, 'generate_world.meta.json'));
  const bfArgon = readJSON(path.join(d.cache, `baseline_full_${slug(ARGON_MODEL)}.meta.json`));
  const tokens_total = promptTokens(gw) ?? promptTokens(bfArgon) ?? null;

  const vids = listEvidence(caseId).videos.length ? caseVideos(caseId) : [];
  const videos = vids.map((v) => ({ label: v.label, seconds: v.durationSec }));
  const video_seconds = Math.round(videos.reduce((n, v) => n + (v.seconds || 0), 0) * 10) / 10;

  const truth = loadTruth(caseId);
  const bf = readJSON(path.join(d.cache, 'baseline_full.json'));
  const R = bf?.results || {};
  const base = R[BASELINE_MODEL] || R[`${BASELINE_MODEL} (chunked)`] || null;
  const arg = R[ARGON_MODEL] || null;

  const wid = truth?.witness_id != null ? String(truth.witness_id).replace(/^wit(ness)?[_\s-]*/i, '') : 'B';
  const render = newestRender(d, wid);
  const depo = findKeyframe(d, truth?.mark_sec);

  const out = {
    case: caseId,
    built_at: new Date().toISOString(),
    tokens_total,
    video_seconds,
    videos,
    pages: countPages(caseId),
    baseline: { model: BASELINE_MODEL, variant: base?.variant ?? null, inputs: 'same inputs: all documents + all video',
      verdict: shortVerdict(base, truth), found_mark: base?.found_mark ?? null, found_claim: base?.found_claim ?? null,
      concluded_blocked: base?.concluded_blocked ?? null },
    argon: { model: ARGON_MODEL, found_mark: arg?.found_mark ?? null, concluded_blocked: arg?.concluded_blocked ?? null, latency_s: arg?.latency_s ?? null },
    key_frames: {
      render_png: rel(render?.png),
      render_t: render ? await observationTime(d, render.version, wid) : null,
      depo_png: rel(depo),
      depo_timecode: depo && truth?.mark_sec != null ? fmtClock(Number(truth.mark_sec)) : null,
    },
  };
  if (!bf) console.warn('[argon_only] WARNING: cache/baseline_full.json not found — run argon/baseline_full.js first');
  if (!truth) console.warn('[argon_only] WARNING: case_full/meta.json not found — mark/keyframe fields left null');
  const p = path.join(d.dir, 'argon_only.json');
  writeJSON(p, out);
  console.log(`[argon_only] wrote ${rel(p)}`);
  return out;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const i = process.argv.indexOf('--case');
  try { console.log(JSON.stringify(await buildArgonOnly(i > 0 ? process.argv[i + 1] : undefined), null, 2)); process.exit(0); }
  catch (e) { console.error('[argon_only] FAILED:', e.message); process.exit(1); }
}
