// RENDER slice: headless Playwright -> per-view mp4 + PNG stills.
// CLI: node render/record.js --world /worlds/reference_world.js --views overhead,wit_A,wit_B --fps 10 --out renders/<name>
// Lib: import { renderViews } from './render/record.js'
// Env: RENDER_CHROME=packaged|playwright (default auto), BASE_URL (use a running app server), RENDER_PAGE (default /, may carry ?case=),
//      RENDER_W / RENDER_H (clip size, default 960x540), RENDER_STILL_W / RENDER_STILL_H (stills, default 1280x720),
//      RENDER_QUALITY=render|interactive (default render: 2x supersampled, 4096 shadows; see web/render_quality.js),
//      RENDER_CLEAN=0 to keep the app chrome (default: ?clean=1, full-bleed 3D view + HUD only)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.srt': 'text/plain', '.md': 'text/plain', '.svg': 'image/svg+xml' };

function startStaticServer(root = ROOT) {
  const srv = http.createServer((req, res) => {
    try {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let f = path.join(root, p);
      if (!f.startsWith(root)) { res.writeHead(403).end(); return; }
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
      if (p === '/') f = path.join(root, 'web/index.html');
      if (!fs.existsSync(f)) { const g = path.join(root, 'web', p); if (g.startsWith(root) && fs.existsSync(g) && fs.statSync(g).isFile()) f = g; }  // mimic APP server: web/ served at /
      if (!fs.existsSync(f)) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(f).pipe(res);
    } catch (e) { res.writeHead(500).end(String(e)); }
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, base: `http://127.0.0.1:${srv.address().port}` })));
}

// Flags that make WebGL work headless without a GPU (SwiftShader). Verified with @sparticuz/chromium.
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'];

export async function launchBrowser() {
  const pw = await import('playwright-core');
  const mode = process.env.RENDER_CHROME || 'auto';
  let exe = null, extra = [], how = 'playwright';
  if (mode !== 'packaged') {
    try { const e = pw.chromium.executablePath(); if (e && fs.existsSync(e)) exe = e; } catch {}
    if (mode === 'playwright' && !exe) throw new Error('RENDER_CHROME=playwright but no Playwright chromium; run `npx playwright install chromium`');
  }
  if (!exe) {
    const sp = (await import('@sparticuz/chromium')).default;
    exe = await sp.executablePath();
    extra = sp.args.filter(a => !/disable-webgl|use-gl|use-angle|disable-gpu|single-process/.test(a));
    how = 'packaged';
  }
  const browser = await pw.chromium.launch({ executablePath: exe, headless: true, args: [...extra, ...GL_ARGS] });
  browser.__how = how;
  return browser;
}

const wait = ms => new Promise(r => setTimeout(r, ms));
const pad = n => String(n).padStart(5, '0');

// Build the viewer URL. pagePath may already carry a query (e.g. '/?case=demo'): merge, never append a second '?'.
export function viewUrl(base, pagePath, q) {
  const u = new URL(pagePath || '/', base.replace(/\/$/, '') + '/');
  for (const [k, v] of Object.entries(q)) if (v != null && v !== false) u.searchParams.set(k, String(v));
  return u.href;
}

// After sl.ready: wait for async assets (GLB vehicles, sky) if the world/viewer exposes a ready hook, then redraw.
async function waitAssets(page, ms = 20000) {
  await page.evaluate(async (ms) => {
    const sl = window.sl, w = sl && sl.world;
    const hooks = [sl && sl.assetsReady, sl && sl.assets && sl.assets.ready, w && w.assets && w.assets.ready, w && w.ready, sl && sl.renderQuality && sl.renderQuality.ready];
    const jobs = hooks.filter(Boolean).map((h) => { try { return Promise.resolve(typeof h === 'function' ? h.call((w && w.assets) || sl) : h); } catch (_) { return null; } });
    await Promise.race([Promise.allSettled(jobs), new Promise((r) => setTimeout(r, ms))]);
    if (sl && sl.renderFrame) sl.renderFrame();
  }, ms);
}

function ffmpegMp4(framesDir, fps, outFile) {
  // output at min(fps,12) is unnecessary; keep input fps. even dimensions for yuv420p.
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(framesDir, 'f%05d.png'),
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outFile]);
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + r.stderr);
}

/**
 * renderViews({world, views, fps, outDir, stills=true, baseUrl, width, height})
 *  world: URL path like '/worlds/reference_world.js' (a repo-relative file path also works)
 *  views: array or comma string; 'all' = overhead + every witness in the world
 * returns { videos: [paths], stills: [paths], files: [all paths], duration, browser }
 */
export async function renderViews({ world, worldUrl: worldUrlOpt, views = 'all', fps = 10, outDir, stills = true, baseUrl, width, height, page: pagePath, t, stillOnly = false, extraWitnesses = [] } = {}) {
  world = world || worldUrlOpt;
  if (!world) throw new Error('world required');
  let worldUrl = world.replace(/^\.\//, '');
  if (path.isAbsolute(worldUrl) && fs.existsSync(worldUrl) && worldUrl.startsWith(ROOT)) worldUrl = worldUrl.slice(ROOT.length);
  if (!worldUrl.startsWith('/') && !/^https?:/.test(worldUrl)) worldUrl = '/' + worldUrl;
  outDir = path.resolve(outDir || path.join(ROOT, 'renders', path.basename(worldUrl, '.js')));
  fs.mkdirSync(outDir, { recursive: true });
  const W = +(width || process.env.RENDER_W || 960), H = +(height || process.env.RENDER_H || 540);
  const SW = +(width || process.env.RENDER_STILL_W || 1280), SH = +(height || process.env.RENDER_STILL_H || 720);
  const quality = process.env.RENDER_QUALITY || 'render';
  const clean = process.env.RENDER_CLEAN !== '0';
  pagePath = pagePath || process.env.RENDER_PAGE || '/';

  let srv = null, base = baseUrl || process.env.BASE_URL;
  if (!base) ({ srv, base } = await startStaticServer());
  base = base.replace(/\/$/, '');
  const browser = await launchBrowser();
  const result = { videos: [], stills: [], files: [], mp4s: [], pngs: [], duration: null, browser: browser.__how };
  try {
    const ctx = await browser.newContext({ viewport: stillOnly ? { width: SW, height: SH } : { width: W, height: H }, deviceScaleFactor: 1 });
    const openView = async (cam, t) => {
      const page = await ctx.newPage();
      const errs = [];
      const hasExtra = extraWitnesses && extraWitnesses.length > 0;
      page.on('pageerror', e => errs.push(String(e)));
      page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
      const u = viewUrl(base, pagePath, { world: worldUrl, cam: hasExtra ? 'overhead' : cam, t, quality, clean: clean ? 1 : null });
      await page.goto(u, { waitUntil: 'load' });
      try {
        await page.waitForFunction(() => window.sl && window.sl.ready, null, { timeout: 30000 });
        await page.evaluate(() => window.sl.ready);
      } catch (e) { throw new Error(`viewer not ready for ${u}: ${e.message}\n${errs.join('\n')}`); }
      await waitAssets(page);
      if (extraWitnesses && extraWitnesses.length) {
        await page.evaluate(({ ws, cam }) => {
          const list = window.sl.world.witnesses || (window.sl.world.witnesses = []);
          for (const w of ws) { const i = list.findIndex(x => x.id === w.id); if (i >= 0) list[i] = w; else list.push(w); }
          window.sl.setCamera(cam);
        }, { ws: extraWitnesses, cam });
      }
      return page;
    };

    if (stillOnly) {
      // fast path: one PNG per view at time t (default: that witness's observationTime, else duration/2)
      const list = (Array.isArray(views) ? views : String(views).split(',')).map(s => s.trim()).filter(Boolean);
      for (const view of list.length ? list : ['overhead']) {
        const page = await openView(view);
        const ts = await page.evaluate(({ t, view }) => {
          const w = window.sl.world; const wit = (w.witnesses || []).find(x => x.id === view);
          const tt = t != null ? t : (wit && wit.observationTime != null ? wit.observationTime : w.duration / 2);
          window.sl.setTime(tt); window.sl.renderFrame(); return tt;
        }, { t: t != null ? +t : null, view });
        const png = path.join(outDir, `${view}_t${String(ts).replace('.', 'p')}${extraWitnesses.length ? '_' + Date.now() : ''}.png`);
        await page.screenshot({ path: png });
        result.stills.push(png);
        await page.close();
      }
      result.files = [...result.stills]; result.pngs = result.stills;
      return result;
    }

    // first page: learn world metadata
    const p0 = await openView('overhead');
    const info = await p0.evaluate(() => ({ duration: window.sl.world.duration,
      witnesses: (window.sl.world.witnesses || []).map(w => ({ id: w.id, observationTime: w.observationTime })) }));
    await p0.close();
    result.duration = info.duration;
    let list = Array.isArray(views) ? views : String(views).split(',').map(s => s.trim()).filter(Boolean);
    if (list.length === 1 && list[0] === 'all') list = ['overhead', ...info.witnesses.map(w => w.id)];
    const obs = Object.fromEntries(info.witnesses.map(w => [w.id, w.observationTime]));

    for (const view of list) {
      const page = await openView(view);
      const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), `sl_${view}_`));
      const n = Math.floor(info.duration * fps) + 1;
      const tc0 = Date.now();
      for (let i = 0; i < n; i++) {
        await page.evaluate(t => { window.sl.setTime(t); window.sl.renderFrame(); }, Math.min(i / fps, info.duration));
        await page.screenshot({ path: path.join(framesDir, `f${pad(i + 1)}.png`) });
      }
      (result.secPerFrame || (result.secPerFrame = {}))[view] = +((Date.now() - tc0) / 1000 / n).toFixed(3);
      const mp4 = path.join(outDir, `${view}.mp4`);
      ffmpegMp4(framesDir, fps, mp4);
      result.videos.push(mp4);
      if (stills) {
        const ts = obs[view] != null ? obs[view] : info.duration / 2;
        if (SW !== W || SH !== H) { await page.setViewportSize({ width: SW, height: SH }); await wait(50); }
        await page.evaluate(t => { window.sl.setTime(t); window.sl.renderFrame(); }, ts);
        const png = path.join(outDir, `${view}.png`);
        await page.screenshot({ path: png });
        result.stills.push(png);
      }
      fs.rmSync(framesDir, { recursive: true, force: true });
      await page.close();
    }
  } finally {
    await browser.close();
    if (srv) srv.close();
  }
  result.files = [...result.videos, ...result.stills]; result.mp4s = result.videos; result.pngs = result.stills;
  return result;
}

// ---- CLI ----
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const a = {};
  for (let i = 2; i < process.argv.length; i++) if (process.argv[i].startsWith('--')) a[process.argv[i].slice(2)] = process.argv[++i];
  try {
    const t0 = Date.now();
    const r = await renderViews({ world: a.world || '/worlds/reference_world.js', views: a.views || 'all', fps: +(a.fps || 10), outDir: a.out, page: a.page });
    console.log(JSON.stringify({ ...r, seconds: ((Date.now() - t0) / 1000).toFixed(1) }, null, 2));
  } catch (e) { console.error(e.message); process.exit(1); }
}
