// Sightline PRODUCT-C slice: per-camera witness-view clip export ("take it away").
//
//   GET /api/cases/:id/clips/:camera.mp4?t0=&t1=[&download=1][&fresh=1]
//       -> MP4 (H.264 veryfast, 1280x720, CLIP_FPS fps, default 24) of that camera's view,
//          rendered headless from the viewer in clean mode (WebGL canvas + HUD/labels DOM overlay),
//          plus a burned-in caption strip (case, camera, clip window, SIMULATED/FICTIONAL, sightline check).
//       Defaults: t0 = observationTime - 3 s, t1 = observationTime + 1 s (observation time from the
//       case's state.checks sightline entry for that witness, else the witness's observationTime),
//       clamped to [0, duration]. overhead: window spanning every witness observation (min-3 .. max+1).
//   GET /api/cases/:id/clips  -> JSON index: cameras, default windows, check results, cached clip URLs.
//
// Cache: cases/<id>/exports/clips/<camera>__<world>.<hash8>__<t0>-<t1>.mp4 (+ .json sidecar), keyed by
// (case, world content, camera [+ live-witness definition], t0, t1). Mock mode serves the cache when present
// (and, if a render fails, falls back to any cached clip of that camera).
// Rendering runs in a child process under scripts/render_lock.sh (shared 2-CPU box):
//   scripts/render_lock.sh node server/clips.js --job <job.json>
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT_DEFAULT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = +(process.env.CLIP_W || 1280), H = +(process.env.CLIP_H || 720);
const FPS = Math.max(1, Math.min(30, +(process.env.CLIP_FPS || 24)));
const MAX_LEN = 30; // seconds per clip
const FONT = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']
  .find((f) => fs.existsSync(f)) || null;

const readJson = (f, fb = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const r2 = (x) => Math.round(x * 100) / 100;
const fmt = (x) => r2(x).toFixed(2);

export function mountClips(app, ctx = {}) {
  const ROOT = ctx.ROOT || ROOT_DEFAULT;
  const MODE = ctx.MODE || process.env.SIGHTLINE_MODE || 'mock';
  const errMsg = ctx.errMsg || ((e) => (e && e.message) || String(e));
  const validId = (id) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(id || ''));
  const caseDir = (id, ...a) => path.join(ROOT, 'cases', id, ...a);
  const clipDir = (id) => caseDir(id, 'exports', 'clips');
  const inflight = new Map(); // cache file -> Promise

  async function getThree() { return ctx.getThree ? ctx.getThree() : import('three'); }

  async function caseState(id) {
    const own = readJson(caseDir(id, 'cache', 'state.json'));
    if (own) return own;
    if (id === 'demo' && ctx.legacyState) { try { return await ctx.legacyState(); } catch { /* ignore */ } }
    return null;
  }
  const extraWitnesses = (id) => {
    const w = readJson(caseDir(id, 'cache', 'extra_witnesses.json'), []);
    return Array.isArray(w) ? w : [];
  };

  function worldFile(url) {
    const rel = String(url || '').replace(/^\/+/, '').split('?')[0];
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) || !/\.m?js$/.test(file) || !fs.existsSync(file)) throw new Error(`world file not found: ${url}`);
    return file;
  }

  // Load world metadata (duration, witnesses) server-side without a browser.
  const metaCache = new Map();
  async function worldMeta(id, worldUrl) {
    const file = worldFile(worldUrl);
    const src = fs.readFileSync(file);
    const hash = crypto.createHash('sha1').update(src).digest('hex').slice(0, 8);
    const extras = extraWitnesses(id);
    const key = file + ':' + hash + ':' + JSON.stringify(extras.map((w) => w.id));
    if (metaCache.has(key)) return metaCache.get(key);
    const THREE = await getThree();
    const mod = await import(pathToFileURL(file).href + `?h=${hash}`);
    const world = mod.default(THREE);
    const wits = [...(world.witnesses || [])];
    for (const w of extras) { const i = wits.findIndex((x) => x.id === w.id); if (i >= 0) wits[i] = w; else wits.push(w); }
    const labels = Object.fromEntries(Object.entries(world.objects || {}).map(([k, o]) => [k, (o && o.label) || k]));
    const m = { file, hash, tag: path.basename(file).replace(/\.m?js$/, '') + '.' + hash, duration: +world.duration || 0, labels,
      witnesses: wits.map((w) => ({ id: w.id, name: w.name || w.label || w.id, observationTime: w.observationTime, lookAt: w.lookAt })) };
    metaCache.set(key, m);
    return m;
  }

  function sightCheck(state, camera) {
    const cs = (state && Array.isArray(state.checks)) ? state.checks : [];
    return cs.find((c) => c && c.check === 'sightline' && c.subject === camera) || null;
  }

  function checkText(chk, meta) {
    if (!chk) return null;
    const tgt = meta.labels[chk.target] || chk.target || 'target';
    const at = chk.t != null ? ` at t=${fmt(+chk.t)} s` : '';
    if (chk.pass) return `Sightline check: VISIBLE - line of sight to ${tgt}${at}`;
    const by = chk.blockedBy ? (meta.labels[chk.blockedBy] || chk.blockedBy) : 'an obstruction';
    return `Sightline check: BLOCKED by ${by} (target ${tgt})${at}`;
  }

  function obsTime(state, meta, camera) {
    const chk = sightCheck(state, camera);
    if (chk && Number.isFinite(+chk.t)) return +chk.t;
    const w = meta.witnesses.find((x) => x.id === camera);
    if (w && Number.isFinite(+w.observationTime)) return +w.observationTime;
    return null;
  }

  function window_(state, meta, camera, q) {
    const D = meta.duration;
    let d0, d1;
    if (camera === 'overhead') {
      const ts = meta.witnesses.map((w) => obsTime(state, meta, w.id)).filter((t) => t != null);
      if (ts.length) { d0 = Math.min(...ts) - 3; d1 = Math.max(...ts) + 1; } else { d0 = 0; d1 = Math.min(D, MAX_LEN); }
    } else {
      const ot = obsTime(state, meta, camera);
      const o = ot != null ? ot : D / 2;
      d0 = o - 3; d1 = o + 1;
    }
    const num = (v) => (v === undefined || v === '' || v === null ? null : Number(v));
    let t0 = num(q.t0), t1 = num(q.t1);
    if (t0 != null && !Number.isFinite(t0)) throw Object.assign(new Error('t0 must be a number (seconds)'), { status: 400 });
    if (t1 != null && !Number.isFinite(t1)) throw Object.assign(new Error('t1 must be a number (seconds)'), { status: 400 });
    if (t0 == null) t0 = d0;
    if (t1 == null) t1 = num(q.t0) != null ? t0 + (d1 - d0) : d1;
    const clamp = (x) => Math.max(0, Math.min(D, x));
    t0 = r2(clamp(t0)); t1 = r2(clamp(t1));
    if (t1 - t0 < 0.1) throw Object.assign(new Error(`empty clip window after clamping to [0, ${D}]: t0=${t0} t1=${t1}`), { status: 400 });
    if (t1 - t0 > MAX_LEN) t1 = r2(t0 + MAX_LEN);
    return { t0, t1 };
  }

  function clipName(meta, camera, t0, t1, extra) {
    let tag = meta.tag;
    if (extra) tag += '.' + crypto.createHash('sha1').update(JSON.stringify(extra)).digest('hex').slice(0, 6);
    return `${camera}__${tag}__${fmt(t0)}-${fmt(t1)}.mp4`;
  }

  async function resolveJob(id, camera, q) {
    if (!validId(id)) throw Object.assign(new Error('bad case id'), { status: 400 });
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(camera)) throw Object.assign(new Error('bad camera id'), { status: 400 });
    const manifest = readJson(caseDir(id, 'case.json'));
    const state = await caseState(id);
    if (!manifest && !state) throw Object.assign(new Error(`no such case: ${id}`), { status: 404 });
    const worldUrl = (q.world && String(q.world)) || (state && state.world);
    if (!worldUrl) throw Object.assign(new Error('case has no reconstructed world yet; run reconstruction first'), { status: 409 });
    const meta = await worldMeta(id, worldUrl);
    const wit = meta.witnesses.find((w) => w.id === camera);
    if (camera !== 'overhead' && !wit) {
      throw Object.assign(new Error(`unknown camera '${camera}'; expected overhead or one of: ${meta.witnesses.map((w) => w.id).join(', ')}`), { status: 404 });
    }
    const { t0, t1 } = window_(state, meta, camera, q);
    const extra = extraWitnesses(id).find((w) => w.id === camera) || null;
    const name = clipName(meta, camera, t0, t1, extra);
    const chk = camera === 'overhead' ? null : sightCheck(state, camera);
    const title = (manifest && manifest.title) || id;
    const camLabel = camera === 'overhead' ? 'Overhead view' : `View of ${wit.name}`;
    const caption = [
      `SIMULATED / FICTIONAL RECONSTRUCTION  |  case: ${id}  |  ${camLabel}`,
      `${checkText(chk, meta) || (camera === 'overhead' ? 'Overhead: all vehicles and witness positions' : 'Sightline check: not available')}  |  clip t=${fmt(t0)}-${fmt(t1)} s of ${fmt(meta.duration)} s`,
    ];
    return {
      id, camera, t0, t1, name, file: path.join(clipDir(id), name), worldUrl: '/' + path.relative(ROOT, meta.file).split(path.sep).join('/'),
      title, caption, check: chk ? { pass: !!chk.pass, target: chk.target, blockedBy: chk.blockedBy || null, t: chk.t, text: checkText(chk, meta) } : null,
      extraWitnesses: extraWitnesses(id), duration: meta.duration,
    };
  }

  function runRender(job, base) {
    if (inflight.has(job.file)) return inflight.get(job.file);
    const p = (async () => {
      fs.mkdirSync(path.dirname(job.file), { recursive: true });
      const tmp = path.join(os.tmpdir(), `sl_clipjob_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.json`);
      fs.writeFileSync(tmp, JSON.stringify({ ...job, base, fps: FPS, width: W, height: H }));
      const t0 = Date.now();
      try {
        const out = await new Promise((resolve, reject) => {
          const ch = spawn(path.join(ROOT, 'scripts', 'render_lock.sh'), [process.execPath, path.join(ROOT, 'server', 'clips.js'), '--job', tmp],
            { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
          let so = '', se = '';
          ch.stdout.on('data', (d) => { so += d; });
          ch.stderr.on('data', (d) => { se += d; });
          const killer = setTimeout(() => ch.kill('SIGKILL'), 15 * 60 * 1000);
          ch.on('close', (code) => { clearTimeout(killer); code === 0 ? resolve(so) : reject(new Error(`clip render failed (exit ${code}): ${(se || so).slice(-800)}`)); });
          ch.on('error', reject);
        });
        if (!fs.existsSync(job.file)) throw new Error('clip render produced no file: ' + out.slice(-400));
        return { seconds: (Date.now() - t0) / 1000 };
      } finally { fs.rmSync(tmp, { force: true }); }
    })();
    inflight.set(job.file, p);
    p.finally(() => inflight.delete(job.file)).catch(() => {});
    return p;
  }

  const clipUrl = (id, camera, t0, t1) => `/api/cases/${id}/clips/${encodeURIComponent(camera)}.mp4?t0=${fmt(t0)}&t1=${fmt(t1)}`;

  app.get('/api/cases/:id/clips', async (req, res) => {
    try {
      const id = req.params.id;
      const state = await caseState(id);
      if (!state || !state.world) return res.status(409).json({ error: 'case has no reconstructed world yet' });
      const cams = ['overhead', ...(await worldMeta(id, state.world)).witnesses.map((w) => w.id)];
      const list = [];
      for (const cam of cams) {
        const j = await resolveJob(id, cam, {});
        list.push({ camera: cam, t0: j.t0, t1: j.t1, check: j.check, url: clipUrl(id, cam, j.t0, j.t1), cached: fs.existsSync(j.file),
          cacheFile: path.relative(ROOT, j.file) });
      }
      res.json({ caseId: id, mode: MODE, world: state.world, fps: FPS, width: W, height: H, clips: list });
    } catch (e) { res.status(e.status || 500).json({ error: errMsg(e) }); }
  });

  app.get('/api/cases/:id/clips/:file', async (req, res) => {
    const m = /^(.+)\.mp4$/i.exec(req.params.file || '');
    if (!m) return res.status(400).json({ error: 'expected /api/cases/:id/clips/<camera>.mp4' });
    let job;
    try { job = await resolveJob(req.params.id, m[1], req.query); }
    catch (e) { return res.status(e.status || 500).json({ error: errMsg(e) }); }
    let cache = 'hit', seconds = null;
    const fresh = MODE !== 'mock' && req.query.fresh === '1';
    if (!fs.existsSync(job.file) || fresh) {
      cache = 'miss';
      try {
        ({ seconds } = await runRender(job, `http://127.0.0.1:${req.socket.localPort}`));
      } catch (e) {
        // mock mode: any cached clip of this camera beats an error
        const dir = clipDir(job.id);
        const alt = MODE === 'mock' && fs.existsSync(dir) && fs.readdirSync(dir).filter((f) => f.startsWith(job.camera + '__') && f.endsWith('.mp4')).sort().pop();
        if (!alt) return res.status(500).json({ error: errMsg(e) });
        job.file = path.join(dir, alt); cache = 'fallback';
      }
    }
    const side = readJson(job.file.replace(/\.mp4$/, '.json'), {});
    res.set({
      'X-Clip-Cache': cache, 'X-Clip-Window': `${fmt(job.t0)}-${fmt(job.t1)}`,
      ...(seconds != null ? { 'X-Clip-Render-Seconds': seconds.toFixed(1) } : side.renderSeconds ? { 'X-Clip-Render-Seconds': String(side.renderSeconds) } : {}),
      'Content-Disposition': `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="sightline_${job.id}_${job.camera}_${fmt(job.t0)}-${fmt(job.t1)}.mp4"`,
      'Cache-Control': 'private, max-age=60',
    });
    res.type('video/mp4').sendFile(job.file);
  });
}

// ---------------- child-process renderer (runs under scripts/render_lock.sh) ----------------
async function renderJob(job) {
  const started = Date.now();
  const { launchBrowser } = await import(pathToFileURL(path.join(ROOT_DEFAULT, 'render', 'record.js')).href);
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), `sl_clip_${job.camera}_`));
  const browser = await launchBrowser();
  let nFrames = 0;
  try {
    const bctx = await browser.newContext({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: 1 });
    const page = await bctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    const hasExtra = (job.extraWitnesses || []).some((w) => w.id === job.camera);
    const u = `${job.base}/index.html?clean=1&world=${encodeURIComponent(job.worldUrl)}&cam=${encodeURIComponent(hasExtra ? 'overhead' : job.camera)}&t=${job.t0}`;
    await page.goto(u, { waitUntil: 'load' });
    try {
      await page.waitForFunction(() => window.sl && window.sl.ready, null, { timeout: 60000 });
      await page.evaluate(() => window.sl.ready);
    } catch (e) { throw new Error(`viewer not ready for ${u}: ${e.message}\n${errs.join('\n')}`); }
    if (job.extraWitnesses && job.extraWitnesses.length) {
      await page.evaluate(({ ws, cam }) => {
        const list = window.sl.world.witnesses || (window.sl.world.witnesses = []);
        for (const w of ws) { const i = list.findIndex((x) => x.id === w.id); if (i >= 0) list[i] = w; else list.push(w); }
        window.sl.setCamera(cam);
      }, { ws: job.extraWitnesses, cam: job.camera });
    }
    const n = Math.max(1, Math.round((job.t1 - job.t0) * job.fps) + 1);
    for (let i = 0; i < n; i++) {
      const t = Math.min(job.t0 + i / job.fps, job.t1);
      await page.evaluate((tt) => { window.sl.setTime(tt); window.sl.renderFrame(); }, t);
      await page.screenshot({ path: path.join(framesDir, `f${String(i + 1).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
      nFrames++;
    }
  } finally { await browser.close(); }

  // caption strip (burned in; the HUD/labels are already in the screenshots)
  const filters = [];
  if (FONT) {
    job.caption.forEach((line, i) => {
      const tf = path.join(framesDir, `cap${i}.txt`);
      fs.writeFileSync(tf, line);
      filters.push(`drawtext=fontfile=${FONT}:textfile=${tf}:expansion=none:fontsize=${i ? 17 : 18}:fontcolor=${i ? (job.check && !job.check.pass ? '0xff8a80' : '0xb9f6ca') : '0xffd54f'}:x=14:y=${10 + i * 26}`);
    });
    filters.unshift('drawbox=x=0:y=0:w=iw:h=62:color=black@0.62:t=fill');
  }
  const tmpOut = job.file.replace(/\.mp4$/, `.tmp${process.pid}.mp4`);
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(job.fps), '-i', path.join(framesDir, 'f%05d.jpg'),
    '-vf', [...filters, 'scale=trunc(iw/2)*2:trunc(ih/2)*2'].join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-metadata', `title=Sightline ${job.id} ${job.camera} (SIMULATED / FICTIONAL)`,
    '-metadata', `comment=${job.caption.join(' / ')}`, tmpOut], { encoding: 'utf8' });
  fs.rmSync(framesDir, { recursive: true, force: true });
  if (r.status !== 0) { fs.rmSync(tmpOut, { force: true }); throw new Error('ffmpeg failed: ' + r.stderr); }
  fs.renameSync(tmpOut, job.file);
  const renderSeconds = +((Date.now() - started) / 1000).toFixed(1);
  fs.writeFileSync(job.file.replace(/\.mp4$/, '.json'), JSON.stringify({
    caseId: job.id, camera: job.camera, world: job.worldUrl, t0: job.t0, t1: job.t1, fps: job.fps, width: job.width, height: job.height,
    frames: nFrames, caption: job.caption, check: job.check, renderSeconds, renderedAt: new Date().toISOString(),
    label: 'SIMULATED / FICTIONAL reconstruction - not a recording of real events',
  }, null, 2));
  return { file: job.file, frames: nFrames, renderSeconds };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url && process.argv[2] === '--job') {
  try {
    const job = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    console.log(JSON.stringify(await renderJob(job)));
    process.exit(0);
  } catch (e) { console.error(e && e.stack || String(e)); process.exit(1); }
}
