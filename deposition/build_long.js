#!/usr/bin/env node
// Long-form deposition video builder (hours-long scripts), reusing deposition/render_frames.py unchanged.
// Usage:
//   node deposition/build_long.js --script <global.json> --out <file.mp4> --caption "<caption>" \
//        --map <map.png> --px-per-m 10 --origin 600,450 [--fps 2] [--seg-sec 1200] [--jobs 2]
// Splits the timeline into seg-sec windows; per window writes a plan JSON + frames (render_frames.py) into
// case_full/render_tmp/<name>/segK/ and encodes an mp4 with a burned-in GLOBAL timecode; windows run in
// parallel; then concat (-c copy) into --out. Also writes <out>.srt, <out-stem>_transcript.txt and
// <outdir>/keyframes_<name>/kf_mark_<HHMMSS>.png (mark start + 3 s).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FFMPEG = fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg';
const FFPROBE = ['/usr/local/bin/ffprobe', '/usr/bin/ffprobe'].find(p => fs.existsSync(p)) || 'ffprobe';
const FONT_MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf';

// ---- args ----
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) { console.error('unexpected arg', a); process.exit(1); }
  args[a.slice(2)] = process.argv[++i];
}
const need = ['script', 'out'];
for (const k of need) if (!args[k]) { console.error(`missing --${k}`); process.exit(1); }
const scriptPath = path.resolve(args.script);
const outMp4 = path.resolve(args.out);
const FPS = Number(args.fps || 2);
const SEG = Number(args['seg-sec'] || 1200);
const JOBS = Math.max(1, Number(args.jobs || 2));
const caption = args.caption || 'SIMULATED DEPOSITION';
const mapImg = args.map ? path.resolve(args.map) : null;
const map = {
  image: mapImg && fs.existsSync(mapImg) ? mapImg : null,
  px_per_m: Number(args['px-per-m'] || 10),
  origin_px: args.origin ? args.origin.split(',').map(Number) : null,
  size: 900,
};
if (mapImg && !map.image) console.error('[build_long] WARN map not found, using placeholder:', mapImg);
if (!(SEG * FPS > 0) || Math.abs(SEG * FPS - Math.round(SEG * FPS)) > 1e-9) { console.error('--seg-sec * --fps must be a positive integer'); process.exit(1); }

const name = path.basename(outMp4).replace(/\.mp4$/i, '');
const outDir = path.dirname(outMp4);
const TMP = path.join(ROOT, 'case_full/render_tmp', name);
const KEY = path.join(outDir, `keyframes_${name}`);
fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
fs.rmSync(KEY, { recursive: true, force: true }); fs.mkdirSync(KEY, { recursive: true });

const T0 = Date.now();
const entries = JSON.parse(fs.readFileSync(scriptPath, 'utf8')).slice().sort((a, b) => a.t_start_sec - b.t_start_sec);
if (!entries.length) { console.error('empty script'); process.exit(1); }

// ---- global timeline (same chunking as build_video.js) ----
const lastDur = e => e.dur_sec ?? Math.max(6, e.text.split(/\s+/).length * 0.45);
const MAXW = 16;
function chunk(text) {
  const words = text.split(/\s+/), n = Math.max(1, Math.ceil(words.length / MAXW)), per = Math.ceil(words.length / n);
  const out = []; for (let i = 0; i < words.length; i += per) out.push(words.slice(i, i + per).join(' '));
  return out;
}
const states = [];
entries.forEach((e, i) => {
  const end = i + 1 < entries.length ? entries[i + 1].t_start_sec : e.t_start_sec + lastDur(e);
  const parts = chunk(e.text), tot = parts.reduce((s, p) => s + p.length, 0);
  let t = e.t_start_sec;
  parts.forEach(p => {
    const dur = (end - e.t_start_sec) * p.length / tot;
    states.push({ start: t, end: t + dur, speaker: e.speaker, text: p, exhibit: e.exhibit?.type === 'map_mark' ? e.exhibit : null });
    t += dur;
  });
});
states[0].start = 0;                       // hold first frame from t=0
const total = states[states.length - 1].end;
const totalFrames = Math.round(total * FPS);

// ---- SRT (spoken text only, never exhibit coordinates) + transcript ----
const p2 = (n, w = 2) => String(n).padStart(w, '0');
const srtTs = s => { const ms = Math.round(s * 1000); return `${p2(Math.floor(ms / 3600000))}:${p2(Math.floor(ms / 60000) % 60)}:${p2(Math.floor(ms / 1000) % 60)},${p2(ms % 1000, 3)}`; };
const tc = s => { const x = Math.floor(s + 1e-6); return `${p2(Math.floor(x / 3600))}:${p2(Math.floor(x / 60) % 60)}:${p2(x % 60)}`; };
const srtPath = outMp4 + '.srt';
fs.writeFileSync(srtPath, states.map((s, i) => `${i + 1}\n${srtTs(s.start)} --> ${srtTs(s.end)}\n${s.speaker.toUpperCase()}: ${s.text}\n`).join('\n'));
const txPath = outMp4.replace(/\.mp4$/i, '') + '_transcript.txt';
fs.writeFileSync(txPath, entries.map(e => `${tc(e.t_start_sec)} ${e.speaker.toUpperCase()}: ${e.text}`).join('\n') + '\n');

// ---- segment jobs ----
const segs = [];
for (let k = 0, f0 = 0; f0 < totalFrames; k++) {
  let nFrames = Math.min(SEG * FPS, totalFrames - f0);
  if (totalFrames - f0 - nFrames < 60 * FPS) nFrames = totalFrames - f0;  // fold a tiny tail into the last segment
  segs.push({ k, off: f0 / FPS, len: nFrames / FPS, nFrames, dir: path.join(TMP, `seg${k}`) });
  f0 += nFrames;
}

function run(cmd, argv) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = ''; p.stdout.on('data', () => {}); p.stderr.on('data', d => { err += d; });
    p.on('close', code => code === 0 ? res() : rej(new Error(`${path.basename(cmd)} exited ${code}: ${err.slice(-2000)}`)));
  });
}

async function doSeg(sg) {
  const t0 = Date.now();
  const a = sg.off, b = sg.off + sg.len;
  const local = [];
  states.forEach(s => {
    const st = Math.max(s.start, a), en = Math.min(s.end, b);
    if (en - st > 1e-6) local.push({ ...s, start: st - a, end: en - a });
  });
  local.forEach((s, i) => { s.file = `f${String(i).padStart(5, '0')}.png`; });
  const frames = path.join(sg.dir, 'frames');
  fs.mkdirSync(frames, { recursive: true });
  const planPath = path.join(sg.dir, 'plan.json');
  fs.writeFileSync(planPath, JSON.stringify({ frames_dir: frames, caption, map, states: local }));
  await run('python3', [path.join(HERE, 'render_frames.py'), planPath]);
  const tR = Date.now();
  const concat = local.map(s => `file '${path.join(frames, s.file)}'\nduration ${(s.end - s.start).toFixed(4)}`).join('\n')
    + `\nfile '${path.join(frames, local[local.length - 1].file)}'\n`;
  const concatPath = path.join(sg.dir, 'concat.txt'); fs.writeFileSync(concatPath, concat);
  const T = `(t+${sg.off})`;
  const tcExpr = `%{eif\\:trunc(${T}/3600)\\:d\\:2}\\:%{eif\\:trunc(mod(${T},3600)/60)\\:d\\:2}\\:%{eif\\:trunc(mod(${T},60))\\:d\\:2}`;
  const dt = `drawtext=fontfile=${FONT_MONO}:text='${tcExpr}':x=w-tw-16:y=46:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=4`;
  sg.mp4 = path.join(sg.dir, `seg${sg.k}.mp4`);
  // tpad guarantees enough frames; -frames:v makes every segment exactly nFrames long (no timecode jumps)
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concatPath,
    '-vf', `fps=${FPS},tpad=stop_mode=clone:stop_duration=5,${dt},format=yuv420p`, '-frames:v', String(sg.nFrames),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-g', String(FPS * 30), '-r', String(FPS), sg.mp4]);
  fs.rmSync(frames, { recursive: true, force: true });  // PNGs no longer needed
  sg.render_s = (tR - t0) / 1000; sg.encode_s = (Date.now() - tR) / 1000; sg.states = local.length;
  console.error(`[build_long] seg${sg.k} ${tc(a)}-${tc(b)}: ${local.length} states, render ${sg.render_s.toFixed(1)}s, encode ${sg.encode_s.toFixed(1)}s`);
}

async function main() {
  const queue = segs.slice();
  await Promise.all(Array.from({ length: Math.min(JOBS, segs.length) }, async () => {
    while (queue.length) await doSeg(queue.shift());
  }));
  const list = path.join(TMP, 'segments.txt');
  fs.writeFileSync(list, segs.map(s => `file '${s.mp4}'`).join('\n') + '\n');
  let r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', outMp4], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status || 1);

  // ---- verify duration ----
  r = spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outMp4], { encoding: 'utf8' });
  const probed = Number(r.stdout.trim());
  const scriptEnd = entries[entries.length - 1].t_start_sec + lastDur(entries[entries.length - 1]);
  const durOk = Math.abs(probed - scriptEnd) <= 1;
  if (!durOk) console.error(`[build_long] WARN duration ${probed}s != script end ${scriptEnd}s`);

  // ---- keyframes: each map_mark entry at start + 3 s ----
  const marks = entries.filter(e => e.exhibit?.type === 'map_mark');
  const keyframes = [];
  for (const m of marks) {
    const t = Math.min(m.t_start_sec + 3, probed - 0.5);
    const f = path.join(KEY, `kf_mark_${tc(m.t_start_sec).replace(/:/g, '')}.png`);
    spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', t.toFixed(2), '-i', outMp4, '-frames:v', '1', f]);
    if (fs.existsSync(f)) keyframes.push(f);
  }
  const wall = (Date.now() - T0) / 1000;
  const renderTotal = segs.reduce((s, x) => s + x.render_s + x.encode_s, 0);
  console.log(JSON.stringify({
    video: outMp4, srt: srtPath, transcript: txPath,
    duration_sec: +probed.toFixed(2), duration_tc: tc(probed), script_end_sec: +scriptEnd.toFixed(2), duration_ok: durOk,
    size_mb: +(fs.statSync(outMp4).size / 1e6).toFixed(2), fps: FPS, segments: segs.length, seg_sec: SEG, jobs: JOBS,
    map_mark_timecodes: marks.map(m => tc(m.t_start_sec)), keyframes,
    wall_sec: +wall.toFixed(1), wall_sec_per_20min_video: +(wall * 1200 / probed).toFixed(1),
    cpu_job_sec_per_20min_video: +(renderTotal * 1200 / probed).toFixed(1),
  }, null, 2));
}
main().catch(e => { console.error(e.message); process.exit(1); });
