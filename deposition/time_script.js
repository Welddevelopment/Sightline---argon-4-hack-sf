#!/usr/bin/env node
// Usage: node deposition/time_script.js <segDir> <prefix> <totalSec> <out.json>
// Reads <segDir>/<prefix>1.json, <prefix>2.json, ... (arrays of {speaker, text, anchor_sec?, exhibit?}).
// Segment windows come from case_full/outline.json -> depositions[prefix].segments[] {id,start,end}
// (fallback: equal split of totalSec). Within each segment, natural durations are proportional to word
// count (+0.8 s gap per turn), then mapped piecewise-linearly so every anchored entry starts exactly at
// anchor_sec and the segment exactly fills [start,end]. map_mark exhibits are held >= 8 s on screen
// (time is taken from neighbours inside the same anchor span).
// Output: global array [{t_start_sec, speaker, text, dur_sec, exhibit?}] sorted by time.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const [segDir, prefix, totalArg, outPath] = process.argv.slice(2);
if (!segDir || !prefix || !totalArg || !outPath) {
  console.error('usage: node deposition/time_script.js <segDir> <prefix> <totalSec> <out.json>'); process.exit(1);
}
const totalSec = Number(totalArg);
const SEC_PER_WORD = 0.4, GAP = 0.8, MARK_MIN = 8;
const warn = (...a) => console.error('[time_script] WARN', ...a);

// ---- segment files ----
const files = [];
for (let i = 1; ; i++) {
  const f = path.join(segDir, `${prefix}${i}.json`);
  if (!fs.existsSync(f)) break;
  files.push({ id: `${prefix}${i}`, file: f });
}
if (!files.length) { console.error('no segment files', path.join(segDir, `${prefix}1.json`)); process.exit(1); }

// ---- outline windows ----
let outlineSegs = [];
try {
  const o = JSON.parse(fs.readFileSync(path.join(ROOT, 'case_full/outline.json'), 'utf8'));
  outlineSegs = o.depositions?.[prefix]?.segments || [];
} catch (e) { warn('outline.json unreadable:', e.message); }
const windows = files.map((s, i) => {
  const os = outlineSegs.find(x => x.id === s.id);
  if (os) return { start: Number(os.start), end: Number(os.end) };
  warn(`segment ${s.id} not in outline; using equal split of ${totalSec}s`);
  const n = Math.max(files.length, outlineSegs.length || 0);
  return { start: totalSec * i / n, end: totalSec * (i + 1) / n };
});
const lastEnd = windows[windows.length - 1].end;
if (Math.abs(lastEnd - totalSec) > 0.5) warn(`last segment ends at ${lastEnd}s but totalSec=${totalSec}s`);

const words = t => String(t || '').trim().split(/\s+/).filter(Boolean).length;
const isMark = e => e.exhibit && e.exhibit.type === 'map_mark';

function timeSegment(entries, win, id) {
  const n = entries.length;
  if (!n) return [];
  const w = entries.map(e => Math.max(1, words(e.text)) * SEC_PER_WORD); // natural speaking weight
  const extra = new Array(n).fill(0);                                    // extra hold for map marks
  let out;
  for (let iter = 0; iter < 40; iter++) {
    // natural positions
    const u = [], uEnd = [];
    let acc = 0;
    for (let j = 0; j < n; j++) { u.push(acc); acc += w[j] + extra[j]; uEnd.push(acc); if (j < n - 1) acc += GAP; }
    const U = acc;
    // knots
    const knots = [[0, win.start]];
    entries.forEach((e, j) => {
      if (e.anchor_sec == null) return;
      const a = Number(e.anchor_sec), last = knots[knots.length - 1];
      if (!(a >= win.start && a <= win.end)) { warn(`${id}: anchor ${a}s outside [${win.start},${win.end}] — ignored`); return; }
      if (u[j] === 0) { if (a !== win.start) warn(`${id}: first entry anchored at ${a}s != segment start; segment starts at anchor`); knots[0] = [0, a]; return; }
      if (a <= last[1]) { warn(`${id}: anchor ${a}s not after previous knot ${last[1]}s — ignored`); return; }
      knots.push([u[j], a]);
    });
    if (knots[knots.length - 1][1] >= win.end && knots.length > 1) warn(`${id}: anchor at/after segment end`);
    knots.push([U, win.end]);
    const map = x => {
      for (let k = 1; k < knots.length; k++) {
        const [u0, t0] = knots[k - 1], [u1, t1] = knots[k];
        if (x <= u1 || k === knots.length - 1) return u1 === u0 ? t1 : t0 + (t1 - t0) * (x - u0) / (u1 - u0);
      }
    };
    out = entries.map((e, j) => {
      const t = map(u[j]);
      const o = { t_start_sec: +t.toFixed(2), speaker: e.speaker, text: e.text,
        dur_sec: +Math.max(0.3, map(u[j] + w[j] + extra[j]) - t).toFixed(2) };
      if (e.exhibit) o.exhibit = e.exhibit;
      return o;
    });
    // anchors exact (avoid rounding drift)
    entries.forEach((e, j) => { if (e.anchor_sec != null && knots.some(k => k[0] === u[j] && k[1] === Number(e.anchor_sec))) out[j].t_start_sec = Number(e.anchor_sec); });
    // check map-mark on-screen spans
    let ok = true;
    out.forEach((o, j) => {
      if (!isMark(entries[j])) return;
      const span = (j + 1 < n ? out[j + 1].t_start_sec : win.end) - o.t_start_sec;
      if (span < MARK_MIN) { ok = false; extra[j] += (w[j] + extra[j] + GAP) * (MARK_MIN / Math.max(span, 0.1) - 1) * 1.05 + 0.1; }
    });
    if (ok) break;
    if (iter === 39) warn(`${id}: could not give every map_mark ${MARK_MIN}s (anchors too tight)`);
  }
  return out;
}

let all = [];
files.forEach((s, i) => {
  const entries = JSON.parse(fs.readFileSync(s.file, 'utf8'));
  if (!Array.isArray(entries)) { console.error(`${s.file}: not an array`); process.exit(1); }
  all = all.concat(timeSegment(entries, windows[i], s.id));
});
all.sort((a, b) => a.t_start_sec - b.t_start_sec);
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(all, null, 1));
const marks = all.filter(e => e.exhibit?.type === 'map_mark');
const last = all[all.length - 1];
console.log(JSON.stringify({ out: outPath, entries: all.length, segments: files.length,
  end_sec: +(last.t_start_sec + last.dur_sec).toFixed(2),
  marks: marks.map(m => ({ t: m.t_start_sec, span: +((all[all.indexOf(m) + 1]?.t_start_sec ?? lastEnd) - m.t_start_sec).toFixed(2) })) }));
