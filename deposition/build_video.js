#!/usr/bin/env node
// Usage: node deposition/build_video.js [scriptPath]   (default: case/deposition_script.json)
// Env: FPS (default 8). Writes out/deposition.mp4, out/deposition.srt, out/keyframes/*.png, out/plan.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(HERE, 'out');
const FRAMES = path.join(OUT, 'frames');
const KEY = path.join(OUT, 'keyframes');
const FFMPEG = fs.existsSync('/usr/local/bin/ffmpeg') ? '/usr/local/bin/ffmpeg' : 'ffmpeg';
const FPS = Number(process.env.FPS || 4);
const FONT_MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf';

const scriptPath = path.resolve(process.argv[2] || path.join(ROOT, 'case/deposition_script.json'));
if (!fs.existsSync(scriptPath)) { console.error('script not found:', scriptPath); process.exit(1); }
const entries = JSON.parse(fs.readFileSync(scriptPath, 'utf8')).slice().sort((a, b) => a.t_start_sec - b.t_start_sec);

// ---- map config: map_config.json defaults, overridden by case/case.json "map" if present ----
const mapCfg = JSON.parse(fs.readFileSync(path.join(HERE, 'map_config.json'), 'utf8'));
let caseJson = {};
try { caseJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'case/case.json'), 'utf8')); } catch {}
const cm = caseJson.map || {};
const mapPng = path.join(ROOT, 'case/exhibits/map.png');
const map = {
  image: fs.existsSync(mapPng) ? mapPng : null,
  px_per_m: cm.px_per_m ?? mapCfg.px_per_m,
  origin_px: cm.origin_px ?? mapCfg.origin_px,   // null => image centre = world (0,0)
  size: mapCfg.placeholder_size_px,
};
const caption = caseJson.caption || caseJson.title || mapCfg.case_caption;

// ---- build timeline: split long lines into subtitle chunks, durations from next t_start ----
const lastDur = e => Math.max(6, e.text.split(/\s+/).length * 0.45);
const MAXW = 16;
function chunk(text) {
  const words = text.split(/\s+/), n = Math.max(1, Math.ceil(words.length / MAXW)), per = Math.ceil(words.length / n);
  const out = []; for (let i = 0; i < words.length; i += per) out.push(words.slice(i, i + per).join(' '));
  return out;
}
const states = [];
entries.forEach((e, i) => {
  const end = i + 1 < entries.length ? entries[i + 1].t_start_sec : e.t_start_sec + lastDur(e);
  const parts = chunk(e.text), total = parts.reduce((s, p) => s + p.length, 0);
  let t = e.t_start_sec;
  parts.forEach((p, k) => {
    const dur = (end - e.t_start_sec) * p.length / total;
    states.push({ start: t, end: t + dur, speaker: e.speaker, text: p, exhibit: e.exhibit?.type === 'map_mark' ? e.exhibit : null });
    t += dur;
  });
});
const t0 = states[0].start;
// Video starts at t=0; if script starts later, first state is held from 0.
states[0].start = 0;
states.forEach((s, i) => { s.file = `f${String(i).padStart(4, '0')}.png`; });
const total = states[states.length - 1].end;

fs.rmSync(FRAMES, { recursive: true, force: true }); fs.mkdirSync(FRAMES, { recursive: true });
fs.mkdirSync(KEY, { recursive: true });
const planPath = path.join(OUT, 'plan.json');
fs.writeFileSync(planPath, JSON.stringify({ frames_dir: FRAMES, caption, map, states }, null, 1));

// ---- SRT (subtitles contain ONLY spoken text; no exhibit coordinates) ----
const ts = s => { const ms = Math.round(s * 1000), p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
fs.writeFileSync(path.join(OUT, 'deposition.srt'),
  states.map((s, i) => `${i + 1}\n${ts(s.start)} --> ${ts(s.end)}\n${s.speaker.toUpperCase()}: ${s.text}\n`).join('\n'));

// ---- frames ----
let r = spawnSync('python3', [path.join(HERE, 'render_frames.py'), planPath], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);

// ---- ffmpeg concat + timecode ----
const concat = states.map(s => `file '${path.join(FRAMES, s.file)}'\nduration ${(s.end - s.start).toFixed(3)}`).join('\n')
  + `\nfile '${path.join(FRAMES, states[states.length - 1].file)}'\n`;
const concatPath = path.join(OUT, 'concat.txt'); fs.writeFileSync(concatPath, concat);
const mp4 = path.join(OUT, 'deposition.mp4');
const tcExpr = "%{eif\\:trunc(t/3600)\\:d\\:2}\\:%{eif\\:trunc(mod(t,3600)/60)\\:d\\:2}\\:%{eif\\:trunc(mod(t,60))\\:d\\:2}";
const dt = `drawtext=fontfile=${FONT_MONO}:text='${tcExpr}':x=w-tw-16:y=46:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=4`;
r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concatPath,
  '-vf', `fps=${FPS},${dt},format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
  '-g', String(FPS * 30), '-movflags', '+faststart', mp4], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);

// ---- keyframes: start, mid, each distinct exhibit's first moment (+2s) ----
fs.readdirSync(KEY).forEach(f => fs.unlinkSync(path.join(KEY, f)));
const grab = (t, name) => spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', t.toFixed(2), '-i', mp4, '-frames:v', '1', path.join(KEY, name)]);
grab(1, 'kf_start.png'); grab(total / 2, 'kf_mid.png');
const mm = states.find(s => s.exhibit);
if (mm) grab(mm.start + 2, 'kf_map_mark.png');
const markT = mm ? Math.round(mm.start) : null;
const tc = s => new Date(s * 1000).toISOString().substr(11, 8);
console.log(JSON.stringify({ video: mp4, srt: path.join(OUT, 'deposition.srt'), duration_sec: +total.toFixed(1), duration_tc: tc(total),
  map_mark_timecode: mm ? tc(mm.start) : null, map_mark_xz: mm ? [mm.exhibit.x_m, mm.exhibit.z_m] : null,
  size_mb: +(fs.statSync(mp4).size / 1e6).toFixed(2), map_image: map.image || 'placeholder' }, null, 2));
