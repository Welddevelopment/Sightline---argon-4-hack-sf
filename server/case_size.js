// ARGON-ONLY UI slice: how big is a case, and what did Argon actually read?
//   GET /api/cases/:id/size   -> { totalTokens, measured, videoSec, videoCount, pages, documents, ... }
//   GET /api/cases/:id/frame?video=<evidence file>&t=<sec|MM:SS|HH:MM:SS>[&cue=mid][&format=json]
//       -> PNG still from a case video (cached at cases/<id>/cache/frames/<video>_<t>.png).
//       cue=mid moves t to the middle of the subtitle cue spoken at t (uses <video>.srt beside it),
//       so "Depo 27:04" lands on the frame where the witness is answering / marking the exhibit.
// Mounted from server/server.js via mountCaseSize(app, ctx).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const VIDEO_TOK_PER_SEC = 71;      // Gemini video at the default sampling (1 fps + audio), ~70 tok/s
const PDF_TOK_PER_PAGE = 560;
const CHARS_PER_TOKEN = 4;
const CHARS_PER_PAGE = 3000;       // page-equivalent for plain-text exhibits (~500 words)
const ARGON_MODEL = 'gemini-4-argon';

const readJson = (f, fb = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const validId = (id) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(id || ''));

function probe(file, entries) {
  try {
    const r = spawnSync('ffprobe', ['-v', 'error', ...entries, '-of', 'json', file], { encoding: 'utf8', timeout: 15000 });
    return JSON.parse(r.stdout || '{}');
  } catch { return {}; }
}
function videoDuration(file) {
  const j = probe(file, ['-show_entries', 'format=duration']);
  const d = parseFloat(j.format && j.format.duration);
  return Number.isFinite(d) ? d : 0;
}
function imageTokens(file) {
  const j = probe(file, ['-select_streams', 'v:0', '-show_entries', 'stream=width,height']);
  const s = (j.streams && j.streams[0]) || {};
  const w = Number(s.width) || 0, h = Number(s.height) || 0;
  if (!w || !h) return 258;
  if (w <= 384 && h <= 384) return 258;
  return Math.min(1092, Math.max(258, Math.ceil(w / 768) * Math.ceil(h / 768) * 258));
}
function pdfPages(file) {
  try {
    const r = spawnSync('pdfinfo', [file], { encoding: 'utf8', timeout: 15000 });
    const m = /Pages:\s+(\d+)/.exec(r.stdout || '');
    return m ? Number(m[1]) : 0;
  } catch { return 0; }
}

// Argon call metadata (cache/*.meta.json) -> { promptTokens, at, file, model, modalities }
function argonCalls(cacheDir) {
  let names = [];
  try { names = fs.readdirSync(cacheDir).filter((n) => n.endsWith('.meta.json')); } catch { return []; }
  const out = [];
  for (const n of names) {
    const f = path.join(cacheDir, n);
    const m = readJson(f);
    if (!m || typeof m !== 'object') continue;
    if (m.model && !/argon/i.test(m.model)) continue;
    const u = m.usage || m.usageMetadata || {};
    const pt = Number(u.promptTokenCount ?? u.promptTokens ?? u.inputTokens);
    if (!Number.isFinite(pt) || pt <= 0) continue;
    const at = Date.parse(m.at || m.finishedAt || '') || fs.statSync(f).mtimeMs;
    const modalities = {};
    for (const d of u.promptTokensDetails || []) if (d && d.modality) modalities[d.modality.toLowerCase()] = d.tokenCount;
    out.push({ file: n, name: m.name || n.replace(/\.meta\.json$/, ''), model: m.model || ARGON_MODEL, promptTokens: pt, at, modalities });
  }
  return out;
}

export function caseSize(ROOT, id) {
  const dir = path.join(ROOT, 'cases', id);
  const man = readJson(path.join(dir, 'case.json'));
  if (!man) return null;
  const est = { video: 0, text: 0, pdf: 0, image: 0 };
  let videoSec = 0, videoCount = 0, pdfPageCount = 0, textChars = 0, documents = 0;
  for (const f of man.files || []) {
    const ev = path.join(dir, 'evidence', f.name || '');
    if (f.type === 'video') {
      const d = Number(f.durationSec) || (fs.existsSync(ev) ? videoDuration(ev) : 0);
      videoSec += d; videoCount++;
      est.video += Math.round(d * VIDEO_TOK_PER_SEC);
      continue;
    }
    documents++;
    if (f.type === 'pdf') {
      const pg = Number(f.pages) || (fs.existsSync(ev) ? pdfPages(ev) : 0) || 1;
      pdfPageCount += pg;
      est.pdf += pg * PDF_TOK_PER_PAGE;
    } else if (f.type === 'image') {
      est.image += fs.existsSync(ev) ? imageTokens(ev) : 258;
    } else {
      let chars = 0;
      const tp = f.textPath ? path.join(dir, f.textPath) : ev;
      try { chars = fs.readFileSync(tp, 'utf8').length; } catch { chars = Number(f.size) || 0; }
      textChars += chars;
      est.text += Math.ceil(chars / CHARS_PER_TOKEN);
    }
  }
  const estimatedTokens = est.video + est.text + est.pdf + est.image;
  const textPages = Math.ceil(textChars / CHARS_PER_PAGE);

  // measured: the most recent Argon call that read the whole case (prompt >= half the estimate);
  // small follow-up calls (e.g. one new witness statement) are not a read of the case.
  const calls = argonCalls(path.join(dir, 'cache'));
  const full = calls.filter((c) => c.promptTokens >= 0.5 * estimatedTokens).sort((a, b) => b.at - a.at);
  const pick = full[0] || null;

  // A build session may write cases/<id>/argon_only.json (see status/argon_only_ui.md); it wins when present.
  const ao = readJson(path.join(dir, 'argon_only.json'));
  if (ao && typeof ao === 'object' && Number(ao.tokens_total) > 0) {
    return {
      caseId: id,
      totalTokens: Number(ao.tokens_total),
      measured: ao.measured !== false,
      estimatedTokens,
      estimate: est,
      videoSec: Number(ao.video_seconds) || Math.round(videoSec * 10) / 10,
      videoCount: Number(ao.video_count) || videoCount,
      pages: Number(ao.pages) || pdfPageCount + textPages,
      pdfPages: pdfPageCount,
      textPages,
      documents: Number(ao.documents) || documents,
      model: ao.model || ARGON_MODEL,
      source: 'argon_only.json',
      measuredFrom: { call: 'argon_only.json', file: 'argon_only.json', at: ao.at || null },
      method: 'reported by the case build (argon_only.json)',
      argonOnly: ao,
    };
  }

  return {
    caseId: id,
    source: pick ? 'meta' : 'estimate',
    totalTokens: pick ? pick.promptTokens : estimatedTokens,
    measured: !!pick,
    estimatedTokens,
    estimate: est,
    videoSec: Math.round(videoSec * 10) / 10,
    videoCount,
    pages: pdfPageCount + textPages,
    pdfPages: pdfPageCount,
    textPages,
    documents,
    model: (pick && pick.model) || ARGON_MODEL,
    measuredFrom: pick ? { call: pick.name, file: 'cache/' + pick.file, at: new Date(pick.at).toISOString(), modalities: pick.modalities } : null,
    method: pick
      ? 'promptTokenCount reported by the API for the Argon call'
      : `estimate: video ${VIDEO_TOK_PER_SEC} tok/s, text chars/${CHARS_PER_TOKEN}, PDF ${PDF_TOK_PER_PAGE} tok/page, images 258–1092`,
  };
}

// ---- frames ----
function parseT(s) {
  if (s == null || s === '') return NaN;
  const str = String(s).trim();
  if (/^\d+(\.\d+)?$/.test(str)) return Number(str);
  const parts = str.split(':').map(Number);
  if (parts.some((x) => !Number.isFinite(x))) return NaN;
  return parts.reduce((acc, x) => acc * 60 + x, 0);
}
const srtT = (s) => { const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(s); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000 : NaN; };
function readCues(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const cues = [];
  for (const block of txt.split(/\r?\n\r?\n/)) {
    const lines = block.trim().split(/\r?\n/);
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const start = srtT(a), end = srtT(b);
    if (Number.isFinite(start) && Number.isFinite(end)) cues.push({ start, end, text: lines.slice(i + 1).join(' ').trim() });
  }
  return cues;
}
// cue spoken at t: one that starts in [t-0.5, t+2] (citations are truncated to the second), else one containing t
function cueAt(cues, t) {
  return cues.find((c) => c.start >= t - 0.5 && c.start <= t + 2) || cues.find((c) => c.start <= t && c.end > t) || null;
}
export const fmtTc = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
};

export function mountCaseSize(app, ctx = {}) {
  const ROOT = ctx.ROOT;
  const errMsg = ctx.errMsg || ((e) => (e && e.message) || String(e));

  app.get('/api/cases/:id/size', (req, res) => {
    const id = req.params.id;
    if (!validId(id)) return res.status(400).json({ error: 'bad case id' });
    try {
      const r = caseSize(ROOT, id);
      if (!r) return res.status(404).json({ error: `no such case: ${id}` });
      res.json(r);
    } catch (e) { res.status(500).json({ error: errMsg(e) }); }
  });

  app.get('/api/cases/:id/frame', (req, res) => {
    const id = req.params.id;
    if (!validId(id)) return res.status(400).json({ error: 'bad case id' });
    const dir = path.join(ROOT, 'cases', id);
    const man = readJson(path.join(dir, 'case.json'));
    if (!man) return res.status(404).json({ error: `no such case: ${id}` });
    let video = path.basename(String(req.query.video || ''));
    if (!video) { const v = (man.files || []).find((f) => f.type === 'video'); video = v ? v.name : ''; }
    const vfile = path.join(dir, 'evidence', video);
    if (!video || !fs.existsSync(vfile)) return res.status(404).json({ error: `no such video: ${video || '(none)'}` });
    let t = parseT(req.query.t);
    if (!Number.isFinite(t) || t < 0) return res.status(400).json({ error: 't (seconds, MM:SS or HH:MM:SS) required' });
    const requested = t;
    let cue = null;
    if (req.query.cue === 'mid') {
      cue = cueAt(readCues(path.join(dir, 'evidence', video.replace(/\.[^.]+$/, '') + '.srt')), t);
      if (cue) t = (cue.start + cue.end) / 2;
    }
    t = Math.round(t * 10) / 10;
    const outDir = path.join(dir, 'cache', 'frames');
    const outName = `${video.replace(/[^\w.-]+/g, '_')}_${t.toFixed(1)}.png`;
    const out = path.join(outDir, outName);
    try {
      if (!fs.existsSync(out)) {
        fs.mkdirSync(outDir, { recursive: true });
        const tmp = out + '.tmp.png';
        const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', vfile, '-frames:v', '1', '-vf', 'scale=960:-2', tmp], { timeout: 30000 });
        if (r.status !== 0 || !fs.existsSync(tmp)) return res.status(500).json({ error: 'ffmpeg failed: ' + String(r.stderr || '').slice(0, 300) });
        fs.renameSync(tmp, out);
      }
    } catch (e) { return res.status(500).json({ error: errMsg(e) }); }
    const url = `/cases/${encodeURIComponent(id)}/cache/frames/${encodeURIComponent(outName)}`;
    res.set('X-Frame-Time', String(t));
    if (req.query.format === 'json') {
      return res.json({ url, video, t, tc: fmtTc(t), requested, requestedTc: fmtTc(requested), cue });
    }
    res.type('png').sendFile(out);
  });
}
