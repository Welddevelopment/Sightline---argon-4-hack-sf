// Sightline APP slice: Express API + static hosting.
// Every dependency module (argon/*, checks/*, render/*) is imported dynamically inside
// handlers so the server boots even when another slice has not landed yet.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mountCases } from './cases.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 5173;

// ---- env / mode (never print the key) ----
try {
  const envFile = path.join(ROOT, '.env');
  if (fs.existsSync(envFile)) {
    const dotenv = await import('dotenv');
    (dotenv.default || dotenv).config({ path: envFile, quiet: true });
  }
} catch { /* dotenv optional */ }
const MODE = (process.env.SIGHTLINE_MODE || 'mock').toLowerCase() === 'live' ? 'live' : 'mock';
process.env.SIGHTLINE_MODE = MODE;

const p = (...a) => path.join(ROOT, ...a);
const readJson = (file, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};
const errMsg = (e) => (e && e.message) ? e.message : String(e);

// Dynamic import of a project module; returns { mod, error }.
async function tryImport(rel) {
  const file = p(rel);
  if (!fs.existsSync(file)) return { mod: null, error: `module missing: ${rel}` };
  try {
    const mod = await import(pathToFileURL(file).href + `?t=${fs.statSync(file).mtimeMs}`);
    return { mod, error: null };
  } catch (e) {
    return { mod: null, error: `failed to import ${rel}: ${errMsg(e)}` };
  }
}

// ---- world loading (in-memory, so witnesses can be pushed into it) ----
let THREE_MOD = null;
async function getThree() {
  if (!THREE_MOD) THREE_MOD = await import('three');
  return THREE_MOD;
}

const worldCache = { url: null, mtime: 0, world: null };
const extraWitnesses = []; // witnesses added via POST /api/witness (also exposed to viewer/render)

function worldFile(url) {
  const rel = String(url || '').replace(/^\/+/, '');
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) throw new Error('bad world path');
  return file;
}

async function loadWorld(url) {
  const file = worldFile(url);
  if (!fs.existsSync(file)) throw new Error(`world file not found: ${url}`);
  const mtime = fs.statSync(file).mtimeMs;
  if (worldCache.world && worldCache.url === url && worldCache.mtime === mtime) return worldCache.world;
  const THREE = await getThree();
  const mod = await import(pathToFileURL(file).href + `?t=${mtime}`);
  const world = mod.default(THREE);
  world.witnesses = world.witnesses || [];
  for (const w of extraWitnesses) {
    if (!world.witnesses.some((x) => x.id === w.id)) world.witnesses.push(w);
  }
  worldCache.url = url; worldCache.mtime = mtime; worldCache.world = world;
  return world;
}

// ---- state ----
const DEFAULT_WORLD = '/worlds/reference_world.js';

function latestFindings() {
  const f = readJson(p('cache', 'findings.json'));
  if (Array.isArray(f)) return f;
  if (f && Array.isArray(f.findings)) return f.findings;
  const log = readJson(p('cache', 'loop_log.json'));
  const rounds = Array.isArray(log) ? log : (log && log.rounds) || [];
  for (let i = rounds.length - 1; i >= 0; i--) {
    const r = rounds[i];
    const fs_ = r && (r.findings || (r.critique && r.critique.findings));
    if (Array.isArray(fs_)) return fs_;
  }
  return [];
}

function loopLog() {
  const log = readJson(p('cache', 'loop_log.json'), []);
  return Array.isArray(log) ? log : (log.rounds || []);
}

async function computeChecks(worldUrl) {
  const { mod, error } = await tryImport('checks/checks.js');
  if (!mod || typeof mod.runAll !== 'function') return { checks: [], warning: error || 'checks.runAll unavailable' };
  try {
    const world = await loadWorld(worldUrl);
    return { checks: await mod.runAll(world) };
  } catch (e) {
    return { checks: [], warning: `checks failed: ${errMsg(e)}` };
  }
}

async function buildState() {
  const cached = readJson(p('cache', 'state.json'));
  const world = (cached && cached.world) || DEFAULT_WORLD;
  const state = {
    mode: MODE,
    world,
    findings: (cached && cached.findings) || latestFindings(),
    checks: (cached && cached.checks) || null,
    loopLog: (cached && cached.loopLog) || loopLog(),
    witnesses: extraWitnesses,
  };
  if (!state.checks || (Array.isArray(state.checks) && !state.checks.length)) {
    const r = await computeChecks(world);
    state.checks = r.checks;
    if (r.warning) state.warning = r.warning;
  }
  return state;
}

// ---- app ----
const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/', (req, res) => {
  const f = p('web', 'index.html');
  if (!fs.existsSync(f)) return res.status(503).type('text').send('web/index.html not built yet (VIEWER slice)');
  res.sendFile(f);
});

for (const dir of ['web', 'worlds', 'renders', 'case', 'node_modules', 'cache']) {
  app.use('/' + dir, express.static(p(dir), { fallthrough: true }));
}
app.use('/deposition/out', express.static(p('deposition', 'out')));
// web/ assets at the site root too (index.html uses relative style.css / viewer.js / ui.js; cases.html lives here)
app.use(express.static(p('web'), { index: false }));

app.get('/api/health', (req, res) => res.json({ ok: true, mode: MODE }));

app.get('/api/witnesses', (req, res) => res.json(extraWitnesses));

app.get('/api/state', async (req, res) => {
  try { res.json(await buildState()); }
  catch (e) { res.status(500).json({ error: errMsg(e) }); }
});

// ---- POST /api/witness ----
app.post('/api/witness', async (req, res) => {
  const statement = req.body && req.body.statement;
  if (!statement || typeof statement !== 'string') return res.status(400).json({ error: 'body.statement (string) required' });

  const nw = await tryImport('argon/new_witness.js');
  if (!nw.mod || typeof nw.mod.newWitness !== 'function') {
    return res.status(501).json({ error: nw.error || 'argon/new_witness.js does not export newWitness', blockedOn: 'ARGON slice' });
  }

  let state, world;
  try {
    state = readJson(p('cache', 'state.json'));
    world = await loadWorld((state && state.world) || DEFAULT_WORLD);
  } catch (e) {
    return res.status(500).json({ error: `cannot load world: ${errMsg(e)}`, blockedOn: 'WORLD slice' });
  }

  let witness;
  try {
    witness = await nw.mod.newWitness(statement, world);
    if (witness && witness.witness) witness = witness.witness;
    if (!witness || typeof witness !== 'object') throw new Error('newWitness returned no witness entry');
  } catch (e) {
    return res.status(500).json({ error: `newWitness failed: ${errMsg(e)}` });
  }

  if (!witness.id) witness.id = 'wit_live_' + (extraWitnesses.length + 1);
  const idx = world.witnesses.findIndex((w) => w.id === witness.id);
  if (idx >= 0) world.witnesses[idx] = witness; else world.witnesses.push(witness);
  const ei = extraWitnesses.findIndex((w) => w.id === witness.id);
  if (ei >= 0) extraWitnesses[ei] = witness; else extraWitnesses.push(witness);
  try { fs.writeFileSync(p('cache', 'extra_witnesses.json'), JSON.stringify(extraWitnesses, null, 2)); } catch { /* ignore */ }

  const warnings = [];

  // sightline check
  let sightline = null;
  let verdict = 'UNKNOWN';
  const ck = await tryImport('checks/checks.js');
  if (ck.mod && typeof ck.mod.sightline === 'function') {
    try {
      const target = witness.lookAt;
      const targetId = typeof target === 'string' ? target : null;
      const t = witness.observationTime ?? 0;
      if (world.setTime) world.setTime(t);
      sightline = await ck.mod.sightline(world, witness.id, targetId, t);
      if (sightline) {
        if (sightline.visible) verdict = 'VISIBLE';
        else {
          const b = sightline.blockedBy;
          const label = (b && world.objects && world.objects[b] && world.objects[b].label) || b || 'unknown obstruction';
          verdict = `BLOCKED by ${label}`;
        }
      }
    } catch (e) { warnings.push(`sightline failed: ${errMsg(e)}`); }
  } else {
    warnings.push(ck.error || 'checks.sightline unavailable');
  }

  // optional render
  let renderUrl = null;
  const rr = await tryImport('render/record.js');
  if (rr.mod && typeof rr.mod.renderViews === 'function') {
    try {
      const out = await rr.mod.renderViews({
        world: (state && state.world) || worldCache.url || DEFAULT_WORLD,
        worldUrl: (state && state.world) || worldCache.url || DEFAULT_WORLD,
        views: [witness.id],
        t: witness.observationTime ?? 0,
        stillOnly: true,
        extraWitnesses,
      });
      renderUrl = findRenderUrl(out);
    } catch (e) { warnings.push(`render skipped: ${errMsg(e)}`); }
  } else {
    warnings.push(rr.error || 'render.renderViews unavailable');
  }

  res.json({ witness, sightline, renderUrl, verdict, ...(warnings.length ? { warnings } : {}) });
});

// Pull a /renders/... URL out of whatever renderViews returned.
function findRenderUrl(out) {
  const cands = [];
  const walk = (v) => {
    if (!v) return;
    if (typeof v === 'string') cands.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(out);
  const toUrl = (s) => {
    if (/^\/renders\//.test(s)) return s;
    const abs = path.resolve(s);
    const rel = path.relative(p('renders'), abs);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) return '/renders/' + rel.split(path.sep).join('/');
    const i = s.indexOf('renders/');
    return i >= 0 ? '/' + s.slice(i) : null;
  };
  const imgs = cands.filter((s) => /\.(png|jpe?g)$/i.test(s));
  for (const s of [...imgs, ...cands.filter((s) => /\.mp4$/i.test(s))]) {
    const u = toUrl(s);
    if (u) return u;
  }
  return null;
}

// ---- loop + SSE ----
const sseClients = new Set();
let loopRunning = false;
const loopEvents = []; // history of the current/last run, replayed to late SSE subscribers

function emit(event) {
  loopEvents.push(event);
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of sseClients) { try { c.write(data); } catch { sseClients.delete(c); } }
}

app.get('/api/loop/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ type: 'hello', mode: MODE, running: loopRunning })}\n\n`);
  for (const ev of loopEvents) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.post('/api/loop', async (req, res) => {
  if (loopRunning) return res.status(409).json({ error: 'loop already running', hint: 'GET /api/loop/stream or poll /api/state' });
  loopRunning = true;
  loopEvents.length = 0;
  emit({ type: 'start', mode: MODE });
  const warnings = [];
  let emitted = 0;
  try {
    const lp = await tryImport('argon/loop.js');
    let result = null;
    if (lp.mod && typeof lp.mod.runLoop === 'function') {
      try {
        result = await lp.mod.runLoop({
          mode: MODE,
          onProgress: (ev) => { emitted++; emit({ type: 'progress', ...(typeof ev === 'object' ? ev : { message: String(ev) }) }); },
        });
      } catch (e) {
        warnings.push(`runLoop failed: ${errMsg(e)}`);
        emit({ type: 'error', message: errMsg(e) });
      }
    } else {
      warnings.push(lp.error || 'argon/loop.js does not export runLoop');
    }

    // Mock mode: replay cached rounds with small delays if runLoop did not stream progress itself.
    if (MODE === 'mock' && emitted === 0) {
      const rounds = loopLog();
      if (rounds.length) {
        for (let i = 0; i < rounds.length; i++) {
          await sleep(700);
          emit({ type: 'progress', round: rounds[i].round ?? i + 1, of: rounds.length, entry: rounds[i], replay: true });
        }
      } else if (!result) {
        warnings.push('no cache/loop_log.json to replay');
      }
    }

    // Persist state if runLoop returned one.
    if (result && typeof result === 'object' && (result.world || result.findings)) {
      const prev = readJson(p('cache', 'state.json'), {}) || {};
      try {
        fs.writeFileSync(p('cache', 'state.json'), JSON.stringify({
          ...prev,
          world: result.world || prev.world || DEFAULT_WORLD,
          findings: result.findings || prev.findings || [],
          ...(result.checks ? { checks: result.checks } : {}),
          ...(result.loopLog ? { loopLog: result.loopLog } : {}),
        }, null, 2));
      } catch { /* ignore */ }
    }

    const state = await buildState();
    emit({ type: 'done', state });
    const failed = warnings.length && !state.loopLog.length && !state.findings.length;
    res.status(failed ? 501 : 200).json({ ...state, ...(warnings.length ? { warnings } : {}), ...(failed ? { error: warnings.join('; '), blockedOn: 'ARGON slice' } : {}) });
  } catch (e) {
    emit({ type: 'error', message: errMsg(e) });
    res.status(500).json({ error: errMsg(e) });
  } finally {
    loopRunning = false;
  }
});

// ---- INGEST slice: multi-case API (cases/<id>/...). Legacy /api/state|witness|loop above keep serving the demo case. ----
mountCases(app, {
  ROOT, MODE, tryImport, getThree, errMsg, findRenderUrl,
  legacyState: buildState,
  legacyHasWorld: () => fs.existsSync(p('cache', 'state.json')) || fs.existsSync(p('worlds', 'reference_world.js')),
});

app.use('/api', (req, res) => res.status(404).json({ error: `no such endpoint: ${req.method} ${req.originalUrl}` }));

app.use((err, req, res, next) => {
  res.status(500).json({ error: errMsg(err) });
});

app.listen(PORT, () => {
  console.log(`[sightline] server on http://localhost:${PORT}  mode=${MODE}`);
});
