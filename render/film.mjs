// SHOT RIG: headless, deterministic short film of a case world in a forensic studio's shot grammar.
// CLI: scripts/render_lock.sh node render/film.mjs --case demo [--plan cases/demo/plan/shot_plan.json] [--w 960 --h 540] [--fps 12]
//        [--quality interactive|render] [--shots id1,id2] [--keys-only] [--stills [S03@18,...]] [--out cases/demo/exports/film] [--keep-frames]
//      --stills alone renders plan/shots_reference.json stillFrames (ourShotId @ ourFilmSec) to <out>/stills/; --plan default ignores shot_plan.json
// Lib:  import { renderFilm } from './render/film.mjs'
// Page: web/film.html + web/film.js (loads the world through web/viewer.js; overlays via web/overlays.js when present).
// Plan: cases/<id>/plan/shot_plan.json if present (else --plan, else a default derived from the world). Schema: status/shot_rig.md.
// Aerial: cases/<id>/exhibits/aerial/aerial.jpg + bounds.json (world-metre bounds) -> 'aerial' shots dissolve from the photo.
// Output: <out>/film.mp4 (H.264 veryfast), <out>/key_NN_<shot>.png per shot, <out>/film.json (timeline + timings).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { launchBrowser } from './record.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.hdr': 'application/octet-stream',
  '.ktx2': 'image/ktx2', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream' };

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }

// static server (web/ at /, repo at /) + the two read-only API routes the viewer/overlays ask for
function startServer() {
  const srv = http.createServer((req, res) => {
    try {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const api = p.match(/^\/api\/cases\/([^/]+)$/);
      if (api || p === '/api/state') {
        const st = api ? readJson(path.join(ROOT, 'cases', api[1], 'cache', 'state.json')) : null;
        if (!st) { res.writeHead(404).end('{}'); return; }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ caseId: api && api[1], state: st, checks: st.checks || [] }));
        return;
      }
      let f = path.join(ROOT, p);
      if (!f.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { const g = path.join(ROOT, 'web', p); if (g.startsWith(ROOT) && fs.existsSync(g) && fs.statSync(g).isFile()) f = g; }
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(f).pipe(res);
    } catch (e) { res.writeHead(500).end(String(e)); }
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, base: `http://127.0.0.1:${srv.address().port}` })));
}

export function caseWorld(caseId) {
  const st = readJson(path.join(ROOT, 'cases', caseId, 'cache', 'state.json'));
  if (st && st.world && fs.existsSync(path.join(ROOT, st.world))) return st.world;
  const dir = path.join(ROOT, 'cases', caseId, 'worlds');
  const ws = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^world_v\d+\.js$/.test(f)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]) : [];
  if (!ws.length) throw new Error('no world for case ' + caseId);
  return `/cases/${caseId}/worlds/${ws[ws.length - 1]}`;
}

function aerialFor(caseId) {
  const d = path.join(ROOT, 'cases', caseId, 'exhibits', 'aerial');
  const img = ['aerial.jpg', 'aerial.jpeg', 'aerial.png'].map((f) => path.join(d, f)).find((f) => fs.existsSync(f));
  const bounds = readJson(path.join(d, 'bounds.json'));
  if (!img || !bounds) return null;
  return { url: '/' + path.relative(ROOT, img).split(path.sep).join('/'), bounds };
}

async function waitAssets(page, ms = 20000) {
  await page.evaluate(async (ms) => {
    const sl = window.sl, w = sl && sl.world;
    const hooks = [sl && sl.assetsReady, sl && sl.assets && sl.assets.ready, w && w.assets && w.assets.ready, w && w.ready, sl && sl.renderQuality && sl.renderQuality.ready];
    const jobs = hooks.filter(Boolean).map((h) => { try { return Promise.resolve(typeof h === 'function' ? h.call((w && w.assets) || sl) : h); } catch (_) { return null; } });
    await Promise.race([Promise.allSettled(jobs), new Promise((r) => setTimeout(r, ms))]);
  }, ms);
}

// Build the ffmpeg graph: per-shot image sequences; 'dissolve' boundaries cross-dissolve (overlap), 'fade' boundaries
// fade through black; first/last shot fade in/out per their transitions.
function assemble(segs, fps, mp4) {
  const args = ['-y', '-loglevel', 'error'];
  segs.forEach((g) => args.push('-framerate', String(fps), '-i', path.join(g.dir, 'f%05d.jpg')));
  const f = [];
  const dur = segs.map((g) => g.n / fps);
  const boundary = (i) => { // between segs[i] and segs[i+1]
    const a = segs[i].tout || {}, b = segs[i + 1].tin || {};
    if (a.kind === 'dissolve' || b.kind === 'dissolve') return { kind: 'dissolve', d: Math.min(Math.max(a.kind === 'dissolve' ? a.d : 0, b.kind === 'dissolve' ? b.d : 0) || 1, dur[i] / 2, dur[i + 1] / 2) };
    return { kind: 'fade', out: a.kind === 'fade' ? Math.min(a.d, dur[i] / 3) : 0, in: b.kind === 'fade' ? Math.min(b.d, dur[i + 1] / 3) : 0 };
  };
  const B = segs.slice(0, -1).map((_, i) => boundary(i));
  segs.forEach((g, i) => {
    const fl = [`settb=AVTB`, `fps=${fps}`, `scale=trunc(iw/2)*2:trunc(ih/2)*2`, `format=yuv420p`];
    const fin = i === 0 ? (g.tin && g.tin.kind !== 'cut' ? Math.min(g.tin.d, dur[i] / 3) : 0) : B[i - 1].kind === 'fade' ? B[i - 1].in : 0;
    const fout = i === segs.length - 1 ? (g.tout && g.tout.kind !== 'cut' ? Math.min(g.tout.d, dur[i] / 3) : 0) : B[i].kind === 'fade' ? B[i].out : 0;
    if (fin > 0) fl.push(`fade=t=in:st=0:d=${fin.toFixed(3)}`);
    if (fout > 0) fl.push(`fade=t=out:st=${(dur[i] - fout).toFixed(3)}:d=${fout.toFixed(3)}`);
    f.push(`[${i}:v]${fl.join(',')}[s${i}]`);
  });
  let cur = 's0', curDur = dur[0];
  for (let i = 1; i < segs.length; i++) {
    const o = `c${i}`;
    if (B[i - 1].kind === 'dissolve') { const d = B[i - 1].d; f.push(`[${cur}][s${i}]xfade=transition=fade:duration=${d.toFixed(3)}:offset=${(curDur - d).toFixed(3)}[${o}]`); curDur += dur[i] - d; }
    else { f.push(`[${cur}][s${i}]concat=n=2:v=1:a=0[${o}]`); curDur += dur[i]; }
    cur = o;
  }
  const script = path.join(path.dirname(mp4), '.filter.txt');
  fs.writeFileSync(script, f.join(';\n'));
  args.push('-filter_complex_script', script, '-map', `[${cur}]`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', String(fps), '-movflags', '+faststart', mp4);
  const ff = spawnSync('ffmpeg', args, { maxBuffer: 1 << 26 });
  fs.rmSync(script, { force: true });
  if (ff.status !== 0) throw new Error('ffmpeg failed: ' + String(ff.stderr).slice(-2000));
  return +curDur.toFixed(2);
}

function stillList(caseId) {
  const ref = readJson(path.join(ROOT, 'cases', caseId, 'plan', 'shots_reference.json'));
  return (ref && Array.isArray(ref.stillFrames) ? ref.stillFrames : []).filter((x) => x.ourShotId && x.ourFilmSec != null)
    .map((x) => ({ shot: x.ourShotId, sec: +x.ourFilmSec, ref: `${x.videoId}@${x.timestamp}` }));
}

export async function renderFilm({ caseId = 'demo', plan: planArg, width = 960, height = 540, fps, quality = 'interactive', shots: onlyShots, keysOnly = false, stills = null,
  outDir, keepFrames = false, log = console.error } = {}) {
  const worldUrl = caseWorld(caseId);
  outDir = path.resolve(outDir || path.join(ROOT, 'cases', caseId, 'exports', 'film'));
  fs.mkdirSync(outDir, { recursive: true });
  const planFile = planArg ? path.resolve(planArg) : path.join(ROOT, 'cases', caseId, 'plan', 'shot_plan.json');
  const plan = planArg === 'default' ? null : fs.existsSync(planFile) ? readJson(planFile) : null;
  if (planArg && planArg !== 'default' && !plan) throw new Error('plan not readable: ' + planFile);
  const aerial = aerialFor(caseId);
  const fbImg = ['map.png', 'map.jpg', 'diagram.png'].map((f) => path.join(ROOT, 'cases', caseId, 'evidence', f)).find((f) => fs.existsSync(f));
  const fallbackImage = fbImg ? '/' + path.relative(ROOT, fbImg).split(path.sep).join('/') : null;

  const { srv, base } = await startServer();
  const browser = await launchBrowser();
  const t0 = Date.now();
  const result = { caseId, world: worldUrl, plan: plan ? path.relative(ROOT, planFile) : 'default (built from world)', aerial: aerial ? aerial.url : null, fallbackImage, width, height, quality, browser: browser.__how };
  try {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
    const u = new URL('/film.html', base);
    u.searchParams.set('world', worldUrl); u.searchParams.set('quality', quality); u.searchParams.set('clean', '1');
    await page.goto(u.href, { waitUntil: 'load' });
    try { await page.waitForFunction(() => window.film && window.sl && window.sl.world, null, { timeout: 240000 }); }
    catch (e) { throw new Error(`film page not ready: ${e.message}\n${errs.join('\n')}`); }
    await waitAssets(page);
    const info = await page.evaluate(({ plan, aerial, fallbackImage, fps }) => window.film.setup(plan, { aerial, fallbackImage, fps }), { plan, aerial, fallbackImage, fps });
    await page.waitForFunction(() => { const i = document.getElementById('film-img'); return !i.getAttribute('src') || i.complete; }, null, { timeout: 60000 }).catch(() => {});
    result.timeline = info;
    log(`[film] ${caseId}: ${info.shots.length} shots, ${info.frames} frames @ ${info.fps} fps (${info.seconds} s), impact t=${info.impactT}, primary=${info.primary}, image=${info.image}`);
    const pad = (n) => String(n).padStart(5, '0');

    if (stills) { // matching stills: [{shot, sec}] -> <out>/stills/<shot>_<sec>s.png
      const sdir = path.join(outDir, 'stills');
      fs.mkdirSync(sdir, { recursive: true });
      result.stills = [];
      for (const st of stills) {
        const sh = info.shots.find((s) => s.id === st.shot);
        if (!sh) { log(`[film] still: no shot ${st.shot}`); continue; }
        const i = sh.start + Math.min(sh.n - 1, Math.round(st.sec * info.fps));
        const r = await page.evaluate((i) => window.film.frame(i), i);
        const fp = path.join(sdir, `${st.shot}_${String(st.sec).replace('.', 'p')}s.png`);
        await page.screenshot({ path: fp, type: 'png', timeout: 180000 });
        result.stills.push({ file: path.relative(ROOT, fp), shot: st.shot, sec: st.sec, t: r.t, ref: st.ref || null });
      }
      fs.writeFileSync(path.join(sdir, 'stills.json'), JSON.stringify(result.stills, null, 2));
      return result;
    }

    const want = new Set((onlyShots ? String(onlyShots).split(',') : info.shots.map((s) => s.id)).map((s) => s.trim()));
    const sel = info.shots.filter((s) => want.has(s.id));
    const framesDir = path.join(outDir, '.frames');
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.mkdirSync(framesDir, { recursive: true });
    for (const f of fs.readdirSync(outDir)) if (/^key_\d+_.*\.png$/.test(f) && (!onlyShots || sel.some((s) => f.endsWith('_' + s.id + '.png')))) fs.rmSync(path.join(outDir, f));
    const keys = [], segs = [];
    let rendered = 0, reused = 0, renderMs = 0, out = 0, prev = null;
    for (const s of sel) {
      const dir = path.join(framesDir, String(info.shots.indexOf(s)).padStart(2, '0'));
      fs.mkdirSync(dir, { recursive: true });
      const idx = keysOnly ? [s.key] : Array.from({ length: s.n }, (_, k) => s.start + k);
      let k = 0;
      for (const i of idx) {
        const ta = Date.now();
        const r = await page.evaluate((i) => window.film.frame(i), i);
        const fj = path.join(dir, `f${pad(++k)}.jpg`);
        out++;
        if (r.same && prev && !keysOnly) { fs.copyFileSync(prev, fj); reused++; }
        else {
          if (!keysOnly) await page.screenshot({ path: fj, type: 'jpeg', quality: 92, timeout: 180000 });
          rendered++; renderMs += Date.now() - ta;
        }
        prev = keysOnly ? null : fj;
        if (i === s.key) {
          const kp = path.join(outDir, `key_${String(info.shots.indexOf(s)).padStart(2, '0')}_${s.id}.png`);
          await page.screenshot({ path: kp, type: 'png', timeout: 180000 });
          keys.push(path.relative(ROOT, kp));
        }
        if (out % 60 === 0) log(`[film] frame ${out} (${s.id}) ${((Date.now() - t0) / 1000).toFixed(0)} s elapsed, ${(renderMs / 1000 / Math.max(1, rendered)).toFixed(2)} s/rendered frame, ${reused} reused`);
      }
      segs.push({ dir, n: k, tin: s.tin, tout: s.tout, id: s.id });
    }
    result.keyFrames = keys;
    result.frames = { total: out, rendered, reused, secPerRenderedFrame: +(renderMs / 1000 / Math.max(1, rendered)).toFixed(3) };
    if (!keysOnly) {
      const mp4 = path.join(outDir, onlyShots ? 'film_partial.mp4' : 'film.mp4');
      result.durationSec = assemble(segs, info.fps, mp4);
      result.mp4 = path.relative(ROOT, mp4);
      result.mp4Bytes = fs.statSync(mp4).size;
    }
    if (!keepFrames) fs.rmSync(framesDir, { recursive: true, force: true });
    const pageErrs = errs.filter((e) => !/favicon|404|Failed to load resource/i.test(e));
    if (pageErrs.length) result.pageWarnings = pageErrs.slice(0, 12);
  } finally {
    await browser.close();
    srv.close();
  }
  result.seconds = +((Date.now() - t0) / 1000).toFixed(1);
  result.secPerFrameWall = result.frames ? +(result.seconds / Math.max(1, result.frames.total)).toFixed(3) : null;
  if (!keysOnly && !onlyShots && !stills) fs.writeFileSync(path.join(outDir, 'film.json'), JSON.stringify(result, null, 2));
  return result;
}

// ---- CLI ----
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const a = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (!process.argv[i].startsWith('--')) continue;
    const k = process.argv[i].slice(2), v = process.argv[i + 1];
    if (v == null || v.startsWith('--')) a[k] = true; else { a[k] = v; i++; }
  }
  try {
    const r = await renderFilm({ caseId: a.case || 'demo', plan: a.plan, width: +(a.w || 960), height: +(a.h || 540), fps: a.fps ? +a.fps : undefined,
      quality: a.quality || 'interactive', shots: a.shots, keysOnly: !!a['keys-only'], outDir: a.out, keepFrames: !!a['keep-frames'],
      stills: a.stills ? (a.stills === true ? stillList(a.case || 'demo') : String(a.stills).split(',').map((x) => { const [shot, sec] = x.split('@'); return { shot, sec: +sec }; })) : null });
    console.log(JSON.stringify(r, null, 2));
  } catch (e) { console.error(e.stack || e.message); process.exit(1); }
}
