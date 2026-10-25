// Sightline INGEST slice: per-case storage, upload + text extraction, per-case run/SSE/witness API.
// Mounted from server/server.js via mountCases(app, helpers).
//
// Layout: cases/<caseId>/{case.json, evidence/, text/, worlds/, renders/, cache/}
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import multer from 'multer';

export const TYPE_BY_EXT = {
  '.pdf': 'pdf', '.txt': 'text', '.md': 'text', '.markdown': 'text', '.docx': 'text', '.rtf': 'text', '.csv': 'text', '.json': 'text', '.srt': 'text', '.vtt': 'text',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image',
  '.mp4': 'video', '.mov': 'video', '.webm': 'video', '.m4v': 'video', '.mkv': 'video',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function slugify(s) {
  return String(s || 'case').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'case';
}
export function safeName(name) {
  const base = path.basename(String(name || 'file')).replace(/[^\w.\- ()]+/g, '_').replace(/^\.+/, '_');
  return base.slice(0, 120) || 'file';
}
export function fileType(name) { return TYPE_BY_EXT[path.extname(name).toLowerCase()] || null; }

export function createCaseStore(ROOT) {
  const CASES = path.join(ROOT, 'cases');
  const dir = (id, ...a) => path.join(CASES, id, ...a);
  const validId = (id) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(id || ''));
  const readJson = (f, fb = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
  const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };

  function ensure(id) {
    for (const d of ['evidence', 'text', 'worlds', 'renders', 'cache']) fs.mkdirSync(dir(id, d), { recursive: true });
  }
  function manifest(id) { return validId(id) ? readJson(dir(id, 'case.json')) : null; }
  function saveManifest(m) { ensure(m.caseId); writeJson(dir(m.caseId, 'case.json'), m); return m; }
  function list() {
    if (!fs.existsSync(CASES)) return [];
    return fs.readdirSync(CASES).map((id) => manifest(id)).filter(Boolean)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  function newId(title) {
    for (;;) {
      const id = slugify(title) + '-' + crypto.randomBytes(2).toString('hex');
      if (!fs.existsSync(dir(id))) return id;
    }
  }
  return { ROOT, CASES, dir, validId, readJson, writeJson, ensure, manifest, saveManifest, list, newId };
}

// ---------- text extraction ----------
async function pdfToText(file) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(file)) });
  try {
    const r = await parser.getText();
    const pages = r.pages && r.pages.length ? r.pages : [{ num: 1, text: r.text }];
    const out = pages.map((pg) => `[[page ${pg.num}]]\n${String(pg.text || '').trim()}\n`).join('\n');
    const chars = pages.reduce((n, pg) => n + String(pg.text || '').trim().length, 0);
    return { text: out, pages: pages.length, chars };
  } finally { try { await parser.destroy(); } catch { /* ignore */ } }
}
async function docxToText(file) {
  const mammoth = (await import('mammoth')).default;
  const r = await mammoth.extractRawText({ path: file });
  return { text: r.value, chars: r.value.length };
}
function videoInfo(file) {
  try {
    const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8', timeout: 15000 });
    const d = parseFloat(r.stdout);
    return Number.isFinite(d) ? { durationSec: Math.round(d * 10) / 10 } : {};
  } catch { return {}; }
}

/** Ingest one file already placed at cases/<id>/evidence/<name>. Returns manifest file entry. */
export async function ingestFile(store, caseId, name) {
  const type = fileType(name);
  const file = store.dir(caseId, 'evidence', name);
  const entry = { name, type, size: fs.statSync(file).size };
  const ext = path.extname(name).toLowerCase();
  const textName = name.replace(/\.[^.]+$/, '') + '.txt';
  const textFile = store.dir(caseId, 'text', textName);
  try {
    if (ext === '.pdf') {
      const r = await pdfToText(file);
      fs.writeFileSync(textFile, r.text);
      Object.assign(entry, { textPath: `text/${textName}`, pages: r.pages });
      if (r.chars < 20) entry.note = 'No extractable text (scanned PDF?). Argon will read the PDF visually.';
    } else if (ext === '.docx') {
      const r = await docxToText(file);
      fs.writeFileSync(textFile, r.text);
      entry.textPath = `text/${textName}`;
    } else if (type === 'text') {
      const dest = ext === '.md' || ext === '.txt' ? store.dir(caseId, 'text', name) : textFile;
      fs.copyFileSync(file, dest);
      entry.textPath = 'text/' + path.basename(dest);
    } else if (type === 'video') {
      Object.assign(entry, videoInfo(file));
    }
  } catch (e) {
    entry.error = `text extraction failed: ${e.message}`;
  }
  return entry;
}

// ---------- routes ----------
export function mountCases(app, h) {
  // h: { ROOT, MODE, tryImport, getThree, errMsg, legacyState(), legacyWitnesses }
  const store = createCaseStore(h.ROOT);
  fs.mkdirSync(store.CASES, { recursive: true });
  const tmpDir = path.join(store.CASES, '.upload-tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const upload = multer({ dest: tmpDir, limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 60 } });

  app.use('/cases', express.static(store.CASES, { fallthrough: true, dotfiles: 'deny' }));

  // ---- per-case runtime state ----
  const runs = new Map();       // caseId -> { running, events:[], clients:Set }
  const witnessMem = new Map(); // caseId -> witness[]
  const getRun = (id) => { if (!runs.has(id)) runs.set(id, { running: false, events: [], clients: new Set() }); return runs.get(id); };
  const emit = (id, ev) => {
    const r = getRun(id);
    const e = { at: new Date().toISOString(), ...ev };
    r.events.push(e);
    const data = `data: ${JSON.stringify(e)}\n\n`;
    for (const c of r.clients) { try { c.write(data); } catch { r.clients.delete(c); } }
  };
  const caseWitnesses = (id) => {
    if (!witnessMem.has(id)) witnessMem.set(id, store.readJson(store.dir(id, 'cache', 'extra_witnesses.json'), []));
    return witnessMem.get(id);
  };

  const urlFor = (id, rel) => `/cases/${id}/${rel}`;
  const fileUrls = (id, f) => ({
    ...f,
    url: urlFor(id, 'evidence/' + encodeURIComponent(f.name)),
    textUrl: f.textPath ? urlFor(id, f.textPath.split('/').map(encodeURIComponent).join('/')) : null,
  });

  function caseState(id) {
    const s = store.readJson(store.dir(id, 'cache', 'state.json'));
    return s || null;
  }
  // The demo case falls back to the legacy global cache (pre-run Argon outputs) until it has its own.
  async function stateFor(id) {
    const own = caseState(id);
    if (own) return { mode: h.MODE, ...own, witnesses: caseWitnesses(id) };
    if (id === 'demo' && h.legacyState) {
      try { return await h.legacyState(); } catch { /* fall through */ }
    }
    return null;
  }

  async function loadCaseWorld(id, worldUrl) {
    const rel = String(worldUrl || '').replace(/^\/+/, '');
    const file = path.resolve(h.ROOT, rel);
    if (!file.startsWith(h.ROOT + path.sep) || !fs.existsSync(file)) throw new Error(`world file not found: ${worldUrl}`);
    const THREE = await h.getThree();
    const mod = await import(pathToFileURL(file).href + `?t=${fs.statSync(file).mtimeMs}`);
    const world = mod.default(THREE);
    world.witnesses = world.witnesses || [];
    for (const w of caseWitnesses(id)) if (!world.witnesses.some((x) => x.id === w.id)) world.witnesses.push(w);
    return world;
  }

  async function withChecks(id, state) {
    if (!state || !state.world) return state;
    if (Array.isArray(state.checks) && state.checks.length) return state;
    const ck = await h.tryImport('checks/checks.js');
    if (!ck.mod || typeof ck.mod.runAll !== 'function') return { ...state, warning: ck.error || 'checks.runAll unavailable' };
    try { return { ...state, checks: await ck.mod.runAll(await loadCaseWorld(id, state.world)) }; }
    catch (e) { return { ...state, checks: state.checks || [], warning: `checks failed: ${h.errMsg(e)}` }; }
  }

  // ---- list ----
  app.get('/api/cases', (req, res) => {
    const cases = store.list().map((m) => {
      const s = caseState(m.caseId);
      return { caseId: m.caseId, title: m.title, createdAt: m.createdAt, status: getRun(m.caseId).running ? 'running' : m.status,
        fileCount: (m.files || []).length, hasWorld: !!(s && s.world) || (m.caseId === 'demo' && !!h.legacyHasWorld?.()) };
    });
    res.json(cases);
  });

  // ---- create (multipart) ----
  app.post('/api/cases', upload.array('files', 60), async (req, res) => {
    const uploaded = req.files || [];
    const cleanup = () => uploaded.forEach((f) => { try { fs.unlinkSync(f.path); } catch { /* moved */ } });
    try {
      const title = String((req.body && req.body.title) || '').trim() || 'Untitled case';
      const caseId = store.newId(title);
      store.ensure(caseId);
      const m = { caseId, title, createdAt: new Date().toISOString(), files: [], status: 'created' };
      const skipped = [];
      for (const f of uploaded) {
        const name = uniqueName(store.dir(caseId, 'evidence'), safeName(f.originalname));
        if (!fileType(name)) { skipped.push({ name: f.originalname, reason: 'unsupported file type' }); try { fs.unlinkSync(f.path); } catch { /* */ } continue; }
        fs.renameSync(f.path, store.dir(caseId, 'evidence', name));
        m.files.push(await ingestFile(store, caseId, name));
      }
      if (!m.files.length) {
        fs.rmSync(store.dir(caseId), { recursive: true, force: true });
        cleanup();
        return res.status(400).json({ error: 'no supported files uploaded (pdf, txt, md, docx, png, jpg, mp4, mov, webm)', skipped });
      }
      m.status = 'ready';
      store.saveManifest(m);
      res.status(201).json({ ...m, files: m.files.map((f) => fileUrls(caseId, f)), ...(skipped.length ? { skipped } : {}) });
    } catch (e) {
      cleanup();
      res.status(500).json({ error: h.errMsg(e) });
    }
  });

  // ---- add more evidence to an existing case ----
  app.post('/api/cases/:id/files', upload.array('files', 60), async (req, res) => {
    const id = req.params.id;
    const m = store.manifest(id);
    if (!m) { (req.files || []).forEach((f) => { try { fs.unlinkSync(f.path); } catch { /* */ } }); return res.status(404).json({ error: 'no such case' }); }
    for (const f of req.files || []) {
      const name = uniqueName(store.dir(id, 'evidence'), safeName(f.originalname));
      if (!fileType(name)) { try { fs.unlinkSync(f.path); } catch { /* */ } continue; }
      fs.renameSync(f.path, store.dir(id, 'evidence', name));
      m.files.push(await ingestFile(store, id, name));
    }
    store.saveManifest(m);
    res.json({ ...m, files: m.files.map((f) => fileUrls(id, f)) });
  });

  // ---- get one ----
  app.get('/api/cases/:id', async (req, res) => {
    const id = req.params.id;
    const m = store.manifest(id);
    if (!m) return res.status(404).json({ error: 'no such case' });
    let state = null;
    try { state = await withChecks(id, await stateFor(id)); } catch (e) { state = { error: h.errMsg(e) }; }
    res.json({ ...m, status: getRun(id).running ? 'running' : m.status, files: (m.files || []).map((f) => fileUrls(id, f)), state, running: getRun(id).running });
  });

  // ---- delete ----
  app.delete('/api/cases/:id', (req, res) => {
    const id = req.params.id;
    if (!store.manifest(id)) return res.status(404).json({ error: 'no such case' });
    if (id === 'demo') return res.status(403).json({ error: 'the demo case cannot be deleted' });
    if (getRun(id).running) return res.status(409).json({ error: 'case is running' });
    fs.rmSync(store.dir(id), { recursive: true, force: true });
    res.json({ ok: true });
  });

  // ---- SSE ----
  app.get('/api/cases/:id/stream', (req, res) => {
    const id = req.params.id;
    if (!store.manifest(id)) return res.status(404).json({ error: 'no such case' });
    const run = getRun(id);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders?.();
    res.write(`data: ${JSON.stringify({ type: 'hello', mode: h.MODE, running: run.running })}\n\n`);
    for (const ev of run.events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    run.clients.add(res);
    req.on('close', () => run.clients.delete(res));
  });

  // ---- run reconstruction ----
  app.post('/api/cases/:id/run', async (req, res) => {
    const id = req.params.id;
    const m = store.manifest(id);
    if (!m) return res.status(404).json({ error: 'no such case' });
    const run = getRun(id);
    if (run.running) return res.status(409).json({ error: 'already running', hint: `GET /api/cases/${id}/stream` });

    // Check readiness up front so the failure is immediate and graceful.
    const lp = await h.tryImport('argon/loop.js');
    if (!lp.mod || typeof lp.mod.runLoop !== 'function') {
      return res.status(501).json({ error: lp.error || 'argon/loop.js does not export runLoop', blockedOn: 'ARGON slice' });
    }

    // Guard: an Argon loop that predates per-case support would run the demo case and write global files.
    if (id !== 'demo' && !/caseId/.test(Function.prototype.toString.call(lp.mod.runLoop))) {
      return res.status(501).json({ error: 'argon/loop.js runLoop does not accept caseId yet', blockedOn: 'ARGON slice' });
    }

    run.running = true; run.events.length = 0;
    m.status = 'running'; store.saveManifest(m);
    const mode = (req.body && req.body.mode) || h.MODE;
    emit(id, { type: 'start', mode, caseId: id });
    res.status(202).json({ started: true, caseId: id, mode, stream: `/api/cases/${id}/stream` });

    (async () => {
      let emitted = 0;
      const stateFile = store.dir(id, 'cache', 'state.json');
      const prevStateRaw = fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf8') : null;
      const restoreState = () => { try { if (prevStateRaw != null) fs.writeFileSync(stateFile, prevStateRaw); else fs.rmSync(stateFile, { force: true }); } catch { /* ignore */ } };
      try {
        const files = m.files || [];
        const texts = files.filter((f) => f.textPath), vids = files.filter((f) => f.type === 'video'), imgs = files.filter((f) => f.type === 'image');
        emit(id, { type: 'progress', step: 'extract', message: `Extracted text from ${texts.length} document(s); ${vids.length} video(s) and ${imgs.length} image(s) queued for Argon.` });
        const result = await lp.mod.runLoop({
          caseId: id, mode,
          onProgress: (ev) => { emitted++; emit(id, { type: 'progress', ...(ev && typeof ev === 'object' ? ev : { message: String(ev) }) }); },
        });
        // Only persist a result whose world file actually exists and whose last round did not error,
        // so a failed re-run never clobbers a good prior state.
        const worldOk = (u) => !!u && fs.existsSync(path.resolve(h.ROOT, String(u).replace(/^\/+/, '')));
        const lastRound = result && Array.isArray(result.loopLog) ? result.loopLog[result.loopLog.length - 1] : null;
        const failed = !result || !worldOk(result.world) || (lastRound && lastRound.error);
        if (result && typeof result === 'object' && !failed) {
          const prev = caseState(id) || {};
          store.writeJson(store.dir(id, 'cache', 'state.json'), { ...prev, ...result, caseId: id, updatedAt: new Date().toISOString() });
        } else if (result && lastRound && lastRound.error) {
          throw new Error(`Run failed in round ${lastRound.round}: ${lastRound.error}`);
        } else if (failed) restoreState();
        // Mock-mode replay of cached rounds if the loop didn't stream anything.
        if (h.MODE === 'mock' && emitted === 0) {
          const log = store.readJson(store.dir(id, 'cache', 'loop_log.json'), []);
          const rounds = Array.isArray(log) ? log : log.rounds || [];
          for (let i = 0; i < rounds.length; i++) { await sleep(500); emit(id, { type: 'progress', step: 'round', round: rounds[i].round ?? i + 1, message: `Replayed cached round ${i + 1}`, replay: true }); }
        }
        const state = await withChecks(id, caseState(id));
        m.status = !failed && state && state.world ? 'done' : 'error';
        store.saveManifest(m);
        emit(id, { type: m.status === 'done' ? 'done' : 'error', message: m.status === 'done' ? 'Reconstruction complete.' : 'Run finished without producing a world.', state });
      } catch (e) {
        restoreState();
        m.status = 'error'; m.error = h.errMsg(e); store.saveManifest(m);
        emit(id, { type: 'error', message: h.errMsg(e) });
      } finally { run.running = false; }
    })();
  });

  // ---- per-case witness ----
  app.post('/api/cases/:id/witness', async (req, res) => {
    const id = req.params.id;
    if (!store.manifest(id)) return res.status(404).json({ error: 'no such case' });
    const statement = req.body && req.body.statement;
    if (!statement || typeof statement !== 'string') return res.status(400).json({ error: 'body.statement (string) required' });
    const nw = await h.tryImport('argon/new_witness.js');
    if (!nw.mod || typeof nw.mod.newWitness !== 'function') return res.status(501).json({ error: nw.error || 'argon/new_witness.js does not export newWitness', blockedOn: 'ARGON slice' });
    const state = await stateFor(id);
    if (!state || !state.world) return res.status(409).json({ error: 'case has no reconstructed world yet; run reconstruction first' });

    let world, witness;
    try { world = await loadCaseWorld(id, state.world); } catch (e) { return res.status(500).json({ error: `cannot load world: ${h.errMsg(e)}` }); }
    try {
      // Pass caseId as a third arg; ARGON's newWitness may use it to read the case's evidence.
      witness = await nw.mod.newWitness(statement, world, { caseId: id });
      if (witness && witness.witness) witness = witness.witness;
      if (!witness || typeof witness !== 'object') throw new Error('newWitness returned no witness entry');
    } catch (e) { return res.status(500).json({ error: `newWitness failed: ${h.errMsg(e)}` }); }

    const list = caseWitnesses(id);
    if (!witness.id) witness.id = 'wit_live_' + (list.length + 1);
    const i = list.findIndex((w) => w.id === witness.id);
    if (i >= 0) list[i] = witness; else list.push(witness);
    const wi = world.witnesses.findIndex((w) => w.id === witness.id);
    if (wi >= 0) world.witnesses[wi] = witness; else world.witnesses.push(witness);
    store.writeJson(store.dir(id, 'cache', 'extra_witnesses.json'), list);

    const warnings = [];
    let sightline = null, verdict = 'UNKNOWN';
    const ck = await h.tryImport('checks/checks.js');
    if (ck.mod && typeof ck.mod.sightline === 'function') {
      try {
        const t = witness.observationTime ?? 0;
        world.setTime?.(t);
        sightline = await ck.mod.sightline(world, witness.id, typeof witness.lookAt === 'string' ? witness.lookAt : null, t);
        if (sightline) {
          if (sightline.visible) verdict = 'VISIBLE';
          else { const b = sightline.blockedBy; verdict = `BLOCKED by ${(b && world.objects?.[b]?.label) || b || 'unknown obstruction'}`; }
        }
      } catch (e) { warnings.push(`sightline failed: ${h.errMsg(e)}`); }
    } else warnings.push(ck.error || 'checks.sightline unavailable');

    let renderUrl = null;
    const rr = await h.tryImport('render/record.js');
    if (rr.mod && typeof rr.mod.renderViews === 'function') {
      try {
        const out = await rr.mod.renderViews({ world: state.world, worldUrl: state.world, views: [witness.id], t: witness.observationTime ?? 0, stillOnly: true, extraWitnesses: list, outDir: store.dir(id, 'renders', 'live') });
        renderUrl = h.findRenderUrl(out);
      } catch (e) { warnings.push(`render skipped: ${h.errMsg(e)}`); }
    } else warnings.push(rr.error || 'render.renderViews unavailable');

    res.json({ witness, sightline, renderUrl, verdict, ...(warnings.length ? { warnings } : {}) });
  });

  app.get('/api/cases/:id/witnesses', (req, res) => {
    if (!store.manifest(req.params.id)) return res.status(404).json({ error: 'no such case' });
    res.json(caseWitnesses(req.params.id));
  });

  return store;
}

function uniqueName(dirPath, name) {
  if (!fs.existsSync(path.join(dirPath, name))) return name;
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  for (let i = 2; ; i++) { const n = `${stem}-${i}${ext}`; if (!fs.existsSync(path.join(dirPath, n))) return n; }
}
