// SHOT RIG: headless, deterministic short film of a case world in a forensic studio's shot grammar.
// CLI: scripts/render_lock.sh node render/film.mjs --case demo [--plan cases/demo/plan/shot_plan.json] [--w 960 --h 540] [--fps 12]
//        [--quality interactive|render] [--shots id1,id2] [--keys-only] [--out cases/demo/exports/film] [--keep-frames]
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

export async function renderFilm({ caseId = 'demo', plan: planArg, width = 960, height = 540, fps, quality = 'interactive', shots: onlyShots, keysOnly = false, outDir, keepFrames = false, log = console.error } = {}) {
  const worldUrl = caseWorld(caseId);
  outDir = path.resolve(outDir || path.join(ROOT, 'cases', caseId, 'exports', 'film'));
  fs.mkdirSync(outDir, { recursive: true });
  const planFile = planArg ? path.resolve(planArg) : path.join(ROOT, 'cases', caseId, 'plan', 'shot_plan.json');
  const plan = fs.existsSync(planFile) ? readJson(planFile) : null;
  if (planArg && !plan) throw new Error('plan not readable: ' + planFile);
  const aerial = aerialFor(caseId);

  const { srv, base } = await startServer();
  const browser = await launchBrowser();
  const t0 = Date.now();
  const result = { caseId, world: worldUrl, plan: plan ? path.relative(ROOT, planFile) : 'default (built from world)', aerial: aerial ? aerial.url : null, width, height, quality, browser: browser.__how };
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
    const info = await page.evaluate(({ plan, aerial, fps }) => window.film.setup(plan, { aerial, fps }), { plan, aerial, fps });
    if (aerial) await page.waitForFunction(() => { const i = document.getElementById('film-aerial'); return !i.src || i.complete; }, null, { timeout: 30000 }).catch(() => {});
    result.timeline = info;
    log(`[film] ${caseId}: ${info.shots.length} shots, ${info.frames} frames @ ${info.fps} fps (${info.seconds} s), impact t=${info.impactT}, primary=${info.primary}${aerial ? ', aerial photo' : ''}`);

    const want = new Set((onlyShots ? String(onlyShots).split(',') : info.shots.map((s) => s.id)).map((s) => s.trim()));
    const sel = info.shots.filter((s) => want.has(s.id));
    const framesDir = path.join(outDir, '.frames');
    fs.rmSync(framesDir, { recursive: true, force: true });
    fs.mkdirSync(framesDir, { recursive: true });
    for (const f of fs.readdirSync(outDir)) if (/^key_\d+_.*\.png$/.test(f) && (!onlyShots || sel.some((s) => f.endsWith('_' + s.id + '.png')))) fs.rmSync(path.join(outDir, f));
    const keys = [];
    let rendered = 0, reused = 0, renderMs = 0, out = 0, prev = null;
    const pad = (n) => String(n).padStart(5, '0');
    for (const s of sel) {
      const idx = keysOnly ? [s.key] : Array.from({ length: s.n }, (_, k) => s.start + k);
      for (const i of idx) {
        const ta = Date.now();
        const r = await page.evaluate((i) => window.film.frame(i), i);
        const fj = path.join(framesDir, `f${pad(++out)}.jpg`);
        if (r.same && prev && !keysOnly) { fs.copyFileSync(prev, fj); reused++; }
        else {
          if (!keysOnly) await page.screenshot({ path: fj, type: 'jpeg', quality: 92, timeout: 180000 });
          rendered++; renderMs += Date.now() - ta;
        }
        prev = fj;
        if (i === s.key) {
          const kp = path.join(outDir, `key_${String(info.shots.indexOf(s)).padStart(2, "0")}_${s.id}.png`);
          await page.screenshot({ path: kp, type: 'png', timeout: 180000 });
          keys.push(path.relative(ROOT, kp));
        }
        if (out % 60 === 0) log(`[film] frame ${out} (${s.id}) ${((Date.now() - t0) / 1000).toFixed(0)} s elapsed, ${(renderMs / 1000 / Math.max(1, rendered)).toFixed(2)} s/rendered frame`);
      }
    }
    result.keyFrames = keys;
    result.frames = { total: out, rendered, reused, secPerRenderedFrame: +(renderMs / 1000 / Math.max(1, rendered)).toFixed(3) };
    if (!keysOnly) {
      const mp4 = path.join(outDir, onlyShots ? 'film_partial.mp4' : 'film.mp4');
      const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(info.fps), '-i', path.join(framesDir, 'f%05d.jpg'),
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
      if (ff.status !== 0) throw new Error('ffmpeg failed: ' + ff.stderr);
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
  if (!keysOnly && !onlyShots) fs.writeFileSync(path.join(outDir, 'film.json'), JSON.stringify(result, null, 2));
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
      quality: a.quality || 'interactive', shots: a.shots, keysOnly: !!a['keys-only'], outDir: a.out, keepFrames: !!a['keep-frames'] });
    console.log(JSON.stringify(r, null, 2));
  } catch (e) { console.error(e.stack || e.message); process.exit(1); }
}
