// Sightline EXPORT slice: printable analysis report (PDF) for a case.
//   mountReport(app, ctx)                     -> routes below (ctx: { ROOT, MODE, errMsg, getThree })
//   GET /api/cases/:id/report.json            -> everything web/report.html renders (case + state + checks + provenance + figures)
//   GET /api/cases/:id/report.pdf[?fresh=1]   -> PDF generated with the bundled headless Chromium (page.pdf of /report.html?case=<id>)
//                                                mock mode serves the cached cases/<id>/exports/report.pdf when present.
// CLI (spawned by the route under scripts/render_lock.sh so Chromium runs are serialized across agents):
//   node server/report.js --build <caseId> --base http://127.0.0.1:<port> [--refigs]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT_DEFAULT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOTICE_DRAFT = 'Analysis draft for expert review — not evidence';
const NOTICE_SIM = 'SIMULATED DEPOSITION / FICTIONAL WITNESSES';
const validId = (id) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(id || ''));
const readJson = (f, fb = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };

// ---------- helpers shared by route + CLI ----------
function caseDir(ROOT, id, ...a) { return path.join(ROOT, 'cases', id, ...a); }

function readCaseText(ROOT, id) {
  const dir = caseDir(ROOT, id, 'text');
  const out = {};
  try { for (const n of fs.readdirSync(dir)) out[n] = fs.readFileSync(path.join(dir, n), 'utf8'); } catch { /* none */ }
  return out;
}

// Case reference/source from the facts document ("# Case Facts: <ref> (<place, date>)" + "**Source:** ...").
function parseSource(texts) {
  const name = Object.keys(texts).find((n) => /^(case[_ -]?)?facts\b/i.test(n)) || Object.keys(texts).find((n) => /facts/i.test(n));
  if (!name) return null;
  const t = texts[name];
  const out = {};
  const head = (t.match(/^#\s+(.+)$/m) || [])[1];
  if (head) {
    const h = head.replace(/^case facts\s*[:—-]\s*/i, '').trim();
    const m = h.match(/^(.*?)\s*\((.+)\)\s*$/);
    out.ref = (m ? m[1] : h).trim();
    if (m) out.where = m[2].trim();
  }
  const src = (t.match(/^\*\*Source:\*\*\s*(.+)$/mi) || [])[1];
  if (src) out.text = src.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  out.urls = [...new Set((t.match(/https?:\/\/[^\s)>\]]+/g) || []))].slice(0, 3);
  return out;
}

// "the case says so": explicit manifest flags win, else the case documents' own notices.
function disclaimers(manifest, texts, witnesses) {
  const m = manifest || {};
  const all = Object.values(texts).join('\n');
  const fictional = m.fictionalWitnesses === true || /witness(?:es)?[^.\n]{0,80}\bfictional\b|\bfictional\b[^.\n]{0,40}witness/i.test(all)
    || (witnesses || []).some((w) => /fictional/i.test(String(w.name || '') + ' ' + String(w.citation || '')));
  const simulated = m.simulatedDeposition === true || /\bsimulated\b/i.test(all) || fictional;
  const flagged = m.simulated === false ? false : (fictional || simulated);
  return { draft: NOTICE_DRAFT, simulation: flagged ? NOTICE_SIM : null, fictional, simulated };
}

async function loadWorldMeta(ROOT, getThree, worldUrl) {
  if (!worldUrl) return null;
  const file = path.resolve(ROOT, String(worldUrl).replace(/^\/+/, ''));
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) return null;
  const THREE = getThree ? await getThree() : await import('three');
  const mod = await import(pathToFileURL(file).href + `?t=${mtime(file)}`);
  let assets;
  try { assets = await (await import(pathToFileURL(path.join(ROOT, 'checks', 'load_world.js')).href)).nodeAssets(); } catch { /* v1 worlds need none */ }
  const w = await mod.default(THREE, assets); // v2 worlds need the asset library
  const objects = {};
  for (const [id, o] of Object.entries(w.objects || {})) objects[id] = { label: o.label || id, kind: o.kind || null, citation: o.citation || null };
  return {
    duration: w.duration,
    meta: w.meta || null,
    objects,
    witnesses: (w.witnesses || []).map((x) => ({ id: x.id, name: x.name || x.id, observationTime: x.observationTime ?? null, lookAt: x.lookAt ?? null,
      eyeHeight: x.eyeHeight ?? null, position: x.position || null, citation: x.citation || null, claim: x.claim || x.statement || null })),
  };
}

// Time each witness's claim is tested at: its sightline check's t, else observationTime.
function witnessTimes(witnesses, checks) {
  const out = {};
  for (const w of witnesses || []) {
    const ck = (checks || []).find((c) => c.check === 'sightline' && c.subject === w.id);
    const t = ck && Number.isFinite(Number(ck.t)) ? Number(ck.t) : (w.observationTime != null ? Number(w.observationTime) : null);
    if (t != null && Number.isFinite(t)) out[w.id] = t;
  }
  return out;
}

// Figure plan: overhead at the key time (first contradiction, else impact), then per witness overhead (its sight line only) + eye view.
function figurePlan(world, checks, findings) {
  const times = witnessTimes(world.witnesses, checks);
  const contra = (findings || []).find((f) => /contradict/i.test(f.status || ''));
  const keyWit = contra && (contra.involves || []).find((id) => times[id] != null);
  const impactCk = (checks || []).find((c) => Number.isFinite(Number(c.impactT)));
  const keyT = keyWit ? times[keyWit] : impactCk ? Number(impactCk.impactT) : (world.duration || 0) / 2;
  const plan = [{ id: 'overview', cam: 'overhead', t: keyT, solo: null, kind: 'overhead' }];
  for (const w of world.witnesses) {
    if (times[w.id] == null) continue;
    plan.push({ id: `${w.id}_overhead`, cam: 'overhead', t: times[w.id], solo: w.id, kind: 'overhead', witness: w.id });
    plan.push({ id: `${w.id}_eye`, cam: w.id, t: times[w.id], solo: null, kind: 'eye', witness: w.id });
  }
  return plan;
}

// ---------- routes ----------
export function mountReport(app, ctx = {}) {
  const ROOT = ctx.ROOT || ROOT_DEFAULT;
  const MODE = ctx.MODE || process.env.SIGHTLINE_MODE || 'mock';
  const errMsg = ctx.errMsg || ((e) => (e && e.message) || String(e));
  const building = new Map(); // caseId -> Promise

  const selfBase = (req) => `http://127.0.0.1:${req.socket.localPort}`;

  app.get('/api/cases/:id/report.json', async (req, res) => {
    const id = req.params.id;
    if (!validId(id)) return res.status(400).json({ error: 'bad case id' });
    try {
      const r = await fetch(`${selfBase(req)}/api/cases/${encodeURIComponent(id)}`);
      if (!r.ok) return res.status(r.status).json(await r.json().catch(() => ({ error: 'case fetch failed' })));
      const c = await r.json();
      const state = c.state || {};
      const texts = readCaseText(ROOT, id);
      let world = null, worldError = null;
      try { world = await loadWorldMeta(ROOT, ctx.getThree, state.world); } catch (e) { worldError = errMsg(e); }
      // Statements added live in the viewer are not part of the reconstruction; listed in an appendix only with ?added=1.
      const witnesses = [...((world && world.witnesses) || [])];
      const added = req.query.added === '1' ? (state.witnesses || []).filter((w) => !witnesses.some((x) => x.id === w.id))
        .map((w) => ({ id: w.id, name: w.name || w.id, claim: w.claim || null, observationTime: w.observationTime ?? null, lookAt: w.lookAt ?? null, confidence: w.confidence || null, assumptions: w.assumptions || null })) : [];
      // figures: rendered set (exports/figs/manifest.json) if it matches this world, else the loop's renders for that world
      const figMan = readJson(caseDir(ROOT, id, 'exports', 'figs', 'manifest.json'));
      let figures = [];
      if (figMan && figMan.world === state.world && Array.isArray(figMan.figures)) {
        figures = figMan.figures.map((f) => ({ ...f, url: `/cases/${id}/exports/figs/${encodeURIComponent(f.file)}?v=${Math.round(mtime(caseDir(ROOT, id, 'exports', 'figs', f.file)))}` }));
      } else if (state.world && world) {
        const wname = path.basename(state.world, '.js');
        const dir = caseDir(ROOT, id, 'renders', wname);
        const times = witnessTimes(witnesses, state.checks);
        if (fs.existsSync(path.join(dir, 'overhead.png'))) figures.push({ id: 'overview', kind: 'overhead', cam: 'overhead', t: null, url: `/cases/${id}/renders/${wname}/overhead.png`, fallback: true });
        for (const w of witnesses) if (fs.existsSync(path.join(dir, `${w.id}.png`))) figures.push({ id: `${w.id}_eye`, kind: 'eye', cam: w.id, witness: w.id, t: times[w.id] ?? null, url: `/cases/${id}/renders/${wname}/${w.id}.png`, fallback: true });
      }
      res.json({
        caseId: id,
        title: c.title,
        createdAt: c.createdAt,
        generatedAt: new Date().toISOString(),
        mode: state.mode || MODE,
        serverMode: MODE,
        source: parseSource(texts),
        notices: disclaimers(c, texts, witnesses),
        files: c.files || [],
        state: { world: state.world || null, verdict: state.verdict || null, updatedAt: state.updatedAt || null, findings: state.findings || [], checks: state.checks || [],
          rounds: Array.isArray(state.loopLog) ? state.loopLog.length : 0, warning: state.warning || null },
        world, worldError, added,
        provenance: c.provenance || {},
        validation: c.validation || null,
        kinematicLabel: c.kinematicLabel || null,
        figures,
      });
    } catch (e) { res.status(500).json({ error: errMsg(e) }); }
  });

  app.get('/api/cases/:id/report.pdf', async (req, res) => {
    const id = req.params.id;
    if (!validId(id) || !fs.existsSync(caseDir(ROOT, id, 'case.json'))) return res.status(404).json({ error: 'no such case' });
    const pdf = caseDir(ROOT, id, 'exports', 'report.pdf');
    const fresh = req.query.fresh === '1' || req.query.fresh === 'true';
    const inputsNewer = () => {
      const t = mtime(pdf);
      const st = readJson(caseDir(ROOT, id, 'cache', 'state.json'));
      const worldFile = st && st.world ? path.resolve(ROOT, String(st.world).replace(/^\/+/, '')) : null;
      return [caseDir(ROOT, id, 'cache', 'state.json'), caseDir(ROOT, id, 'cache', 'validation.json'), caseDir(ROOT, id, 'case.json'), worldFile]
        .filter(Boolean).some((f) => mtime(f) > t);
    };
    const useCache = fs.existsSync(pdf) && !fresh && (MODE === 'mock' || !inputsNewer());
    const send = () => {
      res.set('Content-Disposition', `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename="sightline-${id}-report.pdf"`);
      res.set('Cache-Control', 'no-store');
      res.type('application/pdf').sendFile(pdf);
    };
    if (useCache) return send();
    try {
      if (!building.has(id)) {
        const p = buildViaLock(ROOT, id, selfBase(req), { refigs: fresh && req.query.refigs === '1' }).finally(() => building.delete(id));
        building.set(id, p);
      }
      await building.get(id);
      if (!fs.existsSync(pdf)) throw new Error('report build produced no PDF');
      send();
    } catch (e) {
      res.status(500).json({ error: `report build failed: ${errMsg(e)}` });
    }
  });
}

function buildViaLock(ROOT, id, base, { refigs = false } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['node', path.join(ROOT, 'server', 'report.js'), '--build', id, '--base', base, ...(refigs ? ['--refigs'] : [])];
    const child = spawn(path.join(ROOT, 'scripts', 'render_lock.sh'), args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stdout.on('data', (d) => process.stdout.write('[report] ' + d));
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('report build timed out')); }, 12 * 60 * 1000);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(err.trim().split('\n').slice(-3).join(' | ') || `exit ${code}`)); });
  });
}

// ---------- build (runs in a child process under render_lock.sh) ----------
export async function buildReport({ ROOT = ROOT_DEFAULT, caseId, base, refigs = false, log = console.log } = {}) {
  base = base.replace(/\/$/, '');
  const { launchBrowser } = await import(pathToFileURL(path.join(ROOT, 'render', 'record.js')).href);
  const outDir = caseDir(ROOT, caseId, 'exports');
  const figDir = path.join(outDir, 'figs');
  fs.mkdirSync(figDir, { recursive: true });

  const data = await (await fetch(`${base}/api/cases/${encodeURIComponent(caseId)}/report.json`)).json();
  if (data.error) throw new Error(data.error);
  const browser = await launchBrowser();
  try {
    // 1) figures (re-rendered only when the world changed)
    const st = data.state || {};
    const worldFile = st.world ? path.resolve(ROOT, String(st.world).replace(/^\/+/, '')) : null;
    const prev = readJson(path.join(figDir, 'manifest.json'));
    const upToDate = prev && prev.world === st.world && prev.worldMtime === mtime(worldFile) && prev.checksAt === (st.updatedAt || null)
      && (prev.figures || []).every((f) => fs.existsSync(path.join(figDir, f.file)));
    if (data.world && st.world && (refigs || !upToDate)) {
      const plan = figurePlan(data.world, st.checks, st.findings);
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      const figures = [];
      for (const f of plan) {
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(String(e)));
        const u = `${base}/?case=${encodeURIComponent(caseId)}&clean=1${process.env.REPORT_RQ_OFF === '1' ? '&rq=off' : ''}&cam=${encodeURIComponent(f.cam)}&t=${f.t}`; // REPORT_RQ_OFF=1: lighter pipeline for software (no-GPU) rendering
        await page.goto(u, { waitUntil: 'load' });
        try {
          await page.waitForFunction(() => window.sl && window.sl.world && window.sl.renderFrame, null, { timeout: 45000 });
          await page.evaluate(() => window.sl.ready);
        } catch (e) { await page.close(); log(`figure ${f.id} skipped: ${e.message} ${errs.join(' ')}`); continue; }
        await page.evaluate(({ f }) => {
          const sl = window.sl;
          if (f.solo) sl.world.witnesses = (sl.world.witnesses || []).filter((w) => w.id === f.solo);
          if (sl.setLabels) sl.setLabels(true);
          sl.setCamera(f.cam);
          sl.setTime(f.t);
          if (sl.refresh) sl.refresh();
          sl.renderFrame();
        }, { f });
        await page.waitForTimeout(250);
        const file = `${f.id}.png`;
        await page.screenshot({ path: path.join(figDir, file), timeout: 240000 });
        const verdict = await page.evaluate(() => { const b = document.querySelector('.sl-banner'); return b && !b.hidden ? b.textContent : null; });
        figures.push({ ...f, file, banner: verdict });
        await page.close();
        log(`figure ${file} t=${f.t}`);
      }
      await ctx.close();
      fs.writeFileSync(path.join(figDir, 'manifest.json'), JSON.stringify({ world: st.world, worldMtime: mtime(worldFile), checksAt: st.updatedAt || null, renderedAt: new Date().toISOString(), figures }, null, 2));
    }

    // 2) the report page -> PDF
    const ctx = await browser.newContext({ viewport: { width: 816, height: 1056 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(`${base}/report.html?case=${encodeURIComponent(caseId)}&print=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__reportReady === true || window.__reportError, null, { timeout: 60000 });
    const rerr = await page.evaluate(() => window.__reportError || null);
    if (rerr) throw new Error('report page: ' + rerr);
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))));
    await page.emulateMedia({ media: 'print' });
    const n = await page.evaluate(() => window.__reportNotices || {});
    const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const box = 'font-family: Georgia, "Times New Roman", serif; font-size: 7.5pt; color: #333; width: 100%; padding: 0 0.85in; display: flex; justify-content: space-between; align-items: center; -webkit-print-color-adjust: exact;';
    const headerTemplate = `<div style='${box} border: 0;'><span style="letter-spacing: .02em;">${esc(n.draft || NOTICE_DRAFT)}</span>${n.simulation ? `<span style="font-family: Helvetica, Arial, sans-serif; font-weight: 700; font-size: 7pt; letter-spacing: .08em; color: #8a1c1c;">${esc(n.simulation)}</span>` : '<span></span>'}</div>`;
    const footerTemplate = `<div style='${box}'><span>${esc(n.short || 'Sightline report')}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
    const tmp = path.join(outDir, 'report.pdf.tmp');
    await page.pdf({ path: tmp, format: 'Letter', printBackground: true, displayHeaderFooter: true, headerTemplate, footerTemplate,
      margin: { top: '0.8in', bottom: '0.8in', left: '0.85in', right: '0.85in' } });
    fs.renameSync(tmp, path.join(outDir, 'report.pdf'));
    log(`wrote ${path.join(outDir, 'report.pdf')}${errs.length ? ' (page errors: ' + errs.join(' | ') + ')' : ''}`);
    await ctx.close();
  } finally {
    await browser.close();
  }
}

// ---------- CLI ----------
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const a = {};
  for (let i = 2; i < process.argv.length; i++) {
    const k = process.argv[i];
    if (!k.startsWith('--')) continue;
    const v = process.argv[i + 1];
    if (v == null || v.startsWith('--')) a[k.slice(2)] = true; else { a[k.slice(2)] = v; i++; }
  }
  if (!a.build || !a.base) { console.error('usage: node server/report.js --build <caseId> --base http://127.0.0.1:<port> [--refigs]'); process.exit(2); }
  try {
    const t0 = Date.now();
    await buildReport({ caseId: a.build, base: a.base, refigs: !!a.refigs });
    console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    process.exit(0);
  } catch (e) { console.error(e && e.stack || e); process.exit(1); }
}
