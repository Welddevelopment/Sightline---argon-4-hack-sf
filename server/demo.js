// server/demo.js — STAGE DEMO FLOW: "replay mode" cases.
//
// A demo case is an ordinary case whose case.json says { replay: true, replayOf: '<source case>' }. Every pipeline
// step of such a case serves the cached outputs of the source case's earlier LIVE run instead of calling Gemini,
// as a short replay (2–4 s per step: the recorded progress log lines, then the result, then the real recorded
// timing from the cache meta). Every other case runs exactly as before; nothing here touches non-replay cases.
//
//   GET  /api/demo/config          → { sourceCase, ready, title, recordedAt, recordedMode, reason }
//   POST /api/demo/start           → clones the source case into "demo-<hex>" (replay:true) → { caseId, next }
//   GET  /api/demo/case/:id        → step-bar info { replay, has:{…}, reached, running, replayLog, … } (any case)
//
// Replay-mode overrides (only when cases/<id>/case.json has replay:true; otherwise next() → normal routes):
//   POST /api/cases/:id/extraction/run   replays the recorded extraction (status "running" for ~3 s, then ready)
//   GET  /api/cases/:id/extraction       reports "running" while that replay is in progress
//   POST /api/cases/:id/run              replays the recorded loop log over SSE + job.json, then installs the
//                                        recorded state; if the reviewer moved witnesses on the review screen,
//                                        the INDEPENDENT checks re-run for real (local) with the confirmed positions
//   GET  /api/cases/:id/stream           SSE of that replay
//   GET  /api/cases/:id                  marks running:true while the replay runs
//   GET  /api/cases/:id/report.pdf       serves the recorded report (exports/report.pdf)
// Confirm (POST /confirm) and new-witness (POST /witness) are NOT overridden: confirm is stored normally and the
// new-witness call stays live.
//
// Source case: env DEMO_SOURCE_CASE, else server/demo.config.json { "sourceCase": "…" }, else 'demo-full' when it is
// present with cached outputs, else 'demo'. Per-step replay length: DEMO_STEP_MS (default 2800, clamped 2000–4000).
// Must be mounted BEFORE mountCases/mountReview (Express matches routes in registration order).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const DEMO_TITLE = 'Demo case — Williston FL crash (pre-loaded)';
const RECORDED = ['extraction.json', 'extraction.meta.json', 'state.json', 'loop_log.json', 'validation.json']; // step outputs held back until replayed
const SKIP_TOP = new Set(['case.json', 'confirmed_facts.json', 'replay', '.upload-tmp']);
const SKIP_REL = new Set(['cache/job.json', 'cache/extra_witnesses.json', 'renders/live']);
const LINK_DIRS = new Set(['evidence', 'keyframes']); // large media: hard-link (never rewritten in place), copy on failure
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function mountDemo(app, ctx = {}) {
  const ROOT = ctx.ROOT;
  const errMsg = ctx.errMsg || ((e) => (e && e.message) || String(e));
  const CASES = path.join(ROOT, 'cases');
  const STEP_MS = clamp(Number(process.env.DEMO_STEP_MS) || 2800, 2000, 4000);
  const LOCAL_MS = Math.round(STEP_MS * 0.45); // local (non-Argon) steps: evidence/render/patch replay faster

  const dir = (id, ...a) => path.join(CASES, id, ...a);
  const validId = (id) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(id || ''));
  const readJson = (f, fb = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
  const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 2)); fs.renameSync(t, f); };
  const manifest = (id) => (validId(id) ? readJson(dir(id, 'case.json')) : null);
  const isReplay = (id) => !!(manifest(id) || {}).replay;
  const fileOf = (url) => path.resolve(ROOT, String(url || '').replace(/^\/+/, ''));
  const urlOf = (file) => '/' + path.relative(ROOT, file).split(path.sep).join('/');

  // ---------- source case ----------
  function caseReady(id) {
    const s = readJson(dir(id, 'cache', 'state.json'));
    return !!(manifest(id) && s && s.world && fs.existsSync(fileOf(s.world)));
  }
  function sourceCase() {
    const env = String(process.env.DEMO_SOURCE_CASE || '').trim();
    const cfg = readJson(path.join(ROOT, 'server', 'demo.config.json'), {}) || {};
    const tried = [];
    for (const [id, why] of [[env, 'env DEMO_SOURCE_CASE'], [cfg.sourceCase, 'server/demo.config.json'], ['demo-full', 'default (big case)'], ['demo', 'fallback']]) {
      if (!id) continue;
      if (caseReady(id)) return { id, reason: why, tried };
      tried.push(`${id} (${why}): not present with cached outputs`);
    }
    return { id: null, reason: 'no source case with cached outputs', tried };
  }

  // ---------- recorded timing ----------
  const metaTime = (m) => m && (m.finishedAt || m.at);
  function recordedInfo(caseDir) {
    const st = readJson(path.join(caseDir, 'cache', 'state.json')) || readJson(path.join(caseDir, 'replay', 'state.json')) || {};
    let at = null, liveCalls = 0;
    for (const d of ['cache', 'replay']) {
      const p = path.join(caseDir, d);
      if (!fs.existsSync(p)) continue;
      for (const f of fs.readdirSync(p)) {
        if (!f.endsWith('.meta.json') || f.startsWith('new_witness')) continue;
        const m = readJson(path.join(p, f));
        if (!m || m.mode === 'mock') continue;
        liveCalls++;
        const t = metaTime(m);
        if (t && (!at || t > at)) at = t;
      }
    }
    if (st.mode === 'live' && st.updatedAt && (!at || st.updatedAt > at)) at = st.updatedAt;
    return { recordedAt: at || st.updatedAt || null, recordedMode: st.mode === 'live' ? 'live' : (liveCalls ? 'live-cached' : (st.mode || 'unknown')), liveCalls };
  }
  const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));
  /** "live run: 129 s · 164k tokens · replayed" from a cache meta file; honest fallback when none was recorded. */
  function timingLine(meta, what = 'this step') {
    if (!meta) return `live timing for ${what} not recorded in the cache · replayed`;
    const sec = Number(meta.seconds ?? meta.wallSeconds);
    const u = meta.usage || {};
    const tok = Number(u.totalTokens ?? u.totalTokenCount ?? ((Number(u.promptTokens ?? u.promptTokenCount) || 0) + (Number(u.outputTokens ?? u.candidatesTokenCount) || 0)));
    const label = meta.mode === 'mock' ? 'recorded run (mock)' : 'live run';
    return [`${label}: ${Number.isFinite(sec) ? Math.round(sec) + ' s' : 'time n/a'}`, tok ? `${fmtTok(tok)} tokens` : null, 'replayed'].filter(Boolean).join(' · ');
  }

  // ---------- clone ----------
  function rewriteText(s, src, id) {
    return s.replace(new RegExp(`(^|[^A-Za-z0-9_-])cases/${reEsc(src)}/`, 'g'), `$1cases/${id}/`)
      .replace(new RegExp(`"caseId"(\\s*):(\\s*)"${reEsc(src)}"`, 'g'), `"caseId"$1:$2"${id}"`)
      .replace(new RegExp(`\\bCase ${reEsc(src)}:`, 'g'), `Case ${id}:`);
  }
  function walk(root, fn, rel = '') {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(root, fn, r); else if (e.isFile()) fn(r);
    }
  }
  function cloneCase(src) {
    let id;
    do { id = 'demo-' + crypto.randomBytes(3).toString('hex'); } while (fs.existsSync(dir(id)));
    const from = dir(src), to = dir(id);
    fs.mkdirSync(to, { recursive: true });
    walk(from, (rel) => {
      const top = rel.split('/')[0];
      if (SKIP_TOP.has(top) || [...SKIP_REL].some((s) => rel === s || rel.startsWith(s + '/'))) return;
      const a = path.join(from, rel), b = path.join(to, rel);
      fs.mkdirSync(path.dirname(b), { recursive: true });
      if (LINK_DIRS.has(top)) { try { fs.linkSync(a, b); return; } catch { /* cross-device etc. → copy */ } }
      fs.copyFileSync(a, b);
      const st = fs.statSync(a); fs.utimesSync(b, st.atime, st.mtime); // keep recorded mtimes (log ordering, render reuse)
    });
    // Rewrite /cases/<src>/ paths + caseId in recorded JSON and logs (world .js modules are left byte-identical so
    // content-keyed caches — clips, scene export — still hit).
    walk(to, (rel) => {
      if (!/\.(json|log)$/i.test(rel) || /^(evidence|text|keyframes)\//.test(rel)) return;
      const f = path.join(to, rel);
      const st = fs.statSync(f);
      if (st.size > 20e6) return;
      const s = fs.readFileSync(f, 'utf8'), r = rewriteText(s, src, id);
      if (r !== s) { fs.writeFileSync(f, r); fs.utimesSync(f, st.atime, st.mtime); }
    });
    // Hold back step outputs: they are installed when their step is replayed.
    fs.mkdirSync(path.join(to, 'replay'), { recursive: true });
    for (const f of RECORDED) {
      const a = path.join(to, 'cache', f);
      if (fs.existsSync(a)) fs.renameSync(a, path.join(to, 'replay', f));
    }
    for (const d of ['evidence', 'text', 'worlds', 'renders', 'cache']) fs.mkdirSync(path.join(to, d), { recursive: true });
    const sm = manifest(src) || {};
    const rec = recordedInfo(from);
    const m = { ...sm, caseId: id, title: DEMO_TITLE, sourceTitle: sm.title || src, createdAt: new Date().toISOString(), status: 'ready',
      replay: true, replayOf: src, recordedAt: rec.recordedAt, recordedMode: rec.recordedMode };
    delete m.error;
    writeJson(dir(id, 'case.json'), m);
    writeJson(dir(id, 'replay', 'replay.json'), { caseId: id, replayOf: src, sourceTitle: m.sourceTitle, clonedAt: m.createdAt, ...rec, recorded: RECORDED.filter((f) => fs.existsSync(dir(id, 'replay', f))) });
    return m;
  }

  // ---------- per-case replay runtime ----------
  const rt = new Map(); // id -> { extract: {...}, run: {...} }
  const R = (id) => { if (!rt.has(id)) rt.set(id, { extract: null, run: null }); return rt.get(id); };
  const extractActive = (id) => { const e = R(id).extract; return !!(e && !e.done); };
  const runActive = (id) => { const r = R(id).run; return !!(r && r.running); };

  // ---------- extraction replay ----------
  function parseLog(file) { // recorded CLI logs → { key: [lines] } ; key "r|step" for [loop], "extract" for extraction
    const out = {};
    let key = null;
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
      const l = raw.replace(/\s+$/, '');
      let m;
      if ((m = l.match(/^\[loop\] r(\d+|-) (\w+): (.*)$/))) { key = `${m[1] === '-' ? 0 : m[1]}|${m[2]}`; (out[key] ||= []).push(m[3]); continue; }
      if ((m = l.match(/^\[argon\] (.*)$/))) { const k = /extraction/.test(m[1]) ? 'extract' : key; if (k) (out[k] ||= []).push(m[1]); continue; }
      if ((m = l.match(/^\[extract\] (.*)$/))) { key = 'extract'; (out.extract ||= []).push(m[1]); continue; }
      if (key === 'extract' && /^ {2}\S/.test(l)) out.extract.push(l.trim());
    }
    return out;
  }
  function recordedLogs(id) { // later logs override earlier ones key-by-key
    const cdir = dir(id, 'cache');
    if (!fs.existsSync(cdir)) return {};
    const files = fs.readdirSync(cdir).filter((f) => f.endsWith('.log')).map((f) => path.join(cdir, f))
      .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
    const merged = {};
    for (const f of files) { try { Object.assign(merged, parseLog(f)); } catch { /* unreadable log */ } }
    return merged;
  }
  function evidenceLine(id) {
    const files = (manifest(id) || {}).files || [];
    const n = (t) => files.filter((f) => f.type === t).length;
    return `Case file: ${files.length - n('video') - n('image')} document(s), ${n('video')} video(s), ${n('image')} image(s) — already attached`;
  }
  function extractionLines(id) {
    const m = manifest(id) || {};
    const meta = readJson(dir(id, 'replay', 'extraction.meta.json')) || readJson(dir(id, 'cache', 'extraction.meta.json'));
    const ex = readJson(dir(id, 'replay', 'extraction.json')) || readJson(dir(id, 'cache', 'extraction.json')) || {};
    const lines = [`Replaying the recorded extraction of cases/${m.replayOf}`, evidenceLine(id)];
    const logged = recordedLogs(id).extract;
    if (logged && logged.length) lines.push(...logged.slice(0, 14));
    else {
      lines.push(`[argon] extraction_raw: calling ${(meta && meta.model) || 'Argon'} over every document, image and video`);
      if (meta) lines.push(`[argon] extraction_raw: done in ${meta.seconds}s, finish=${meta.finishReason || 'STOP'}`);
      const c = (meta && meta.counts) || { facts: (ex.facts || []).length, vehicles: (ex.vehicles || []).length, objects: (ex.objects || []).length, witnesses: (ex.witnesses || []).length };
      lines.push(`Extracted ${c.facts} facts · ${c.vehicles} vehicles · ${c.objects} objects · ${c.witnesses} witnesses`);
      for (const w of (ex.witnesses || []).slice(0, 6)) lines.push(`${w.id} ${w.name || ''} marked=${JSON.stringify(w.markedPosition)}`);
    }
    lines.push(timingLine(meta, 'extraction'));
    return lines;
  }
  const visibleLines = (rec) => {
    if (!rec) return [];
    const el = Date.now() - rec.startedAt;
    return rec.lines.filter((l) => l.atMs <= el).map((l) => l.text);
  };
  function startExtractionReplay(id) {
    const texts = extractionLines(id);
    const durMs = Math.round(STEP_MS * 1.15);
    const rec = { kind: 'extract', startedAt: Date.now(), durMs, done: false, lines: texts.map((text, i) => ({ text, atMs: Math.round((i / texts.length) * durMs * 0.9) })) };
    R(id).extract = rec;
    setTimeout(() => {
      try {
        for (const f of ['extraction.json', 'extraction.meta.json']) {
          const a = dir(id, 'replay', f);
          if (!fs.existsSync(a)) continue;
          const v = readJson(a);
          if (f === 'extraction.meta.json' && v) Object.assign(v, { replayed: true, replayedAt: new Date().toISOString(), replayOf: (manifest(id) || {}).replayOf });
          writeJson(dir(id, 'cache', f), v);
        }
      } catch (e) { rec.error = errMsg(e); }
      rec.done = true; rec.finishedAt = Date.now();
    }, durMs);
    return rec;
  }
  function extractionSnapshot(id) {
    return { caseId: id, status: 'running', extraction: null, meta: null, confirmed: readJson(dir(id, 'confirmed_facts.json')), error: null,
      replay: { kind: 'extract', lines: visibleLines(R(id).extract) } };
  }

  // ---------- loop replay ----------
  function jobSave(id, patch) {
    const f = dir(id, 'cache', 'job.json');
    const j = { ...(readJson(f) || {}), ...patch, caseId: id };
    try { writeJson(f, j); } catch { /* best effort */ }
    return j;
  }
  function emit(id, ev) {
    const run = R(id).run;
    const e = { at: new Date().toISOString(), ...ev };
    run.events.push(e);
    const data = `data: ${JSON.stringify(e)}\n\n`;
    for (const c of run.clients) { try { c.write(data); } catch { run.clients.delete(c); } }
    if (e.type !== 'hello') {
      const slim = {}; for (const k of ['at', 'type', 'step', 'round', 'message', 'replay']) if (e[k] != null) slim[k] = e[k];
      const j = readJson(dir(id, 'cache', 'job.json')) || {};
      const patch = { events: [...(j.events || []), slim].slice(-25) };
      if (e.step) patch.step = e.step;
      if (e.message) patch.message = e.message;
      if (e.round != null) patch.round = e.round;
      if (e.type === 'done') Object.assign(patch, { status: 'ready', step: 'done', finishedAt: e.at, error: null });
      if (e.type === 'error') Object.assign(patch, { status: 'failed', step: 'error', finishedAt: e.at, error: e.message, resumable: true });
      jobSave(id, patch);
    }
  }
  function stepPlan(id) {
    const st = readJson(dir(id, 'replay', 'state.json')) || {};
    const rounds = readJson(dir(id, 'replay', 'loop_log.json')) || st.loopLog || [];
    const logs = recordedLogs(id);
    const meta = (n) => readJson(dir(id, 'cache', n + '.meta.json'));
    const plan = [];
    const add = (step, round, lines, ms, timing) => plan.push({ step, round, lines: lines.filter(Boolean), ms, timing });
    add('evidence', 1, logs['1|evidence'] || [evidenceLine(id)], LOCAL_MS);
    const genMeta = meta('generate_world');
    if (logs['1|generate'] || genMeta || fs.existsSync(dir(id, 'cache', 'generate_world.js'))) {
      add('generate', 1, logs['1|generate'] || ['Argon is reading every document and watching every video to write the world module…',
        rounds[0] && rounds[0].world ? `World module written: ${rounds[0].world}` : null], STEP_MS, timingLine(genMeta, 'world generation'));
    }
    rounds.forEach((r, i) => {
      const n = r.round ?? i + 1;
      const rv = (r.renders && r.renders.videos) || [], rs = (r.renders && r.renders.stills) || [];
      add('render', n, logs[`${n}|render`] || [`Rendering ${r.world} from overhead + witness viewpoints…`,
        r.renderError ? `Render skipped: ${r.renderError}` : `Rendered ${rv.length} videos, ${rs.length} stills`], LOCAL_MS);
      const ck = r.checks || [];
      const fails = ck.filter((c) => !c.pass);
      add('checks', n, logs[`${n}|checks`] || [`Independent checks: ${ck.length - fails.length}/${ck.length} pass` +
        (fails.length ? ` — ${fails.map((c) => `${c.subject}: ${c.blockedBy ? 'blocked by ' + c.blockedBy : 'fail'}`).join('; ')}` : '')], LOCAL_MS);
      const cr = r.critique || {};
      add('critique', n, logs[`${n}|critique`] || ['Argon is watching the witness-view renders against the evidence videos and documents…',
        cr.verdict ? `${cr.verdict}: ${cr.summary || ''}` : null], STEP_MS, timingLine(meta(`critique_round${n}`), `critique round ${n}`));
      if (r.patch && r.patch.world) add('patch', n, logs[`${n}|patch`] || [`Argon patched the world → ${r.patch.world}`], LOCAL_MS);
    });
    return { plan, rounds };
  }

  // Reviewer-moved witnesses: confirmed markedPosition vs the extraction's (same rule as the review screen's "moved by").
  function movedWitnesses(id) {
    const conf = readJson(dir(id, 'confirmed_facts.json'));
    const ex = readJson(dir(id, 'cache', 'extraction.json')) || readJson(dir(id, 'replay', 'extraction.json'));
    if (!conf || !Array.isArray(conf.witnesses) || !ex) return { confirmed: !!conf, moved: [] };
    const ok = (p) => Array.isArray(p) && p.length >= 2 && p.every((v) => Number.isFinite(Number(v)));
    const moved = [];
    for (const w of conf.witnesses) {
      const o = (ex.witnesses || []).find((x) => x.id === w.id);
      if (!o || !ok(o.markedPosition) || !ok(w.markedPosition)) continue;
      const d = Math.hypot(w.markedPosition[0] - o.markedPosition[0], w.markedPosition[1] - o.markedPosition[1]);
      if (d >= 0.5) moved.push({ id: w.id, name: w.name || w.id, from: o.markedPosition.map(Number), to: w.markedPosition.map(Number), movedBy: Math.round(d * 10) / 10 });
    }
    return { confirmed: true, moved };
  }
  async function loadWorld(file) {
    const THREE = await ctx.getThree();
    const mod = await import(pathToFileURL(file).href + `?t=${fs.statSync(file).mtimeMs}`);
    const world = mod.default(THREE, await (await import('../checks/load_world.js')).nodeAssets());
    world.witnesses = world.witnesses || [];
    return world;
  }
  /** Real, local: write a wrapper world (recorded world + confirmed witness positions) and re-run checks.runAll on it. */
  async function recheckWithConfirmed(id, recordedWorldUrl, moved) {
    const baseFile = fileOf(recordedWorldUrl);
    const base = path.basename(baseFile, '.js');
    const wrapper = path.join(path.dirname(baseFile), `${base}_confirmed.js`);
    const overrides = Object.fromEntries(moved.map((m) => [m.id, { x: m.to[0], z: m.to[1], movedBy: m.movedBy }]));
    fs.writeFileSync(wrapper, `// Generated by server/demo.js (replay mode): the recorded world ${base}.js with the witness positions the reviewer\n` +
      `// confirmed on the review screen. Only witnesses moved there are overridden; everything else is the recorded live output.\n` +
      `import base from './${base}.js';\nexport * from './${base}.js';\nconst OVERRIDES = ${JSON.stringify(overrides)};\n` +
      `export default function (...args) {\n  const world = base(...args);\n  for (const w of world.witnesses || []) {\n    const o = OVERRIDES[w.id];\n` +
      `    if (!o) continue;\n    const y = Array.isArray(w.position) ? w.position[1] : 0;\n    w.recordedPosition = Array.isArray(w.position) ? w.position.slice() : null;\n` +
      `    w.position = [o.x, y, o.z];\n    w.confirmedPosition = true;\n  }\n  return world;\n}\n`);
    const ck = await ctx.tryImport('checks/checks.js');
    if (!ck.mod || typeof ck.mod.runAll !== 'function') throw new Error(ck.error || 'checks.runAll unavailable');
    const world = await loadWorld(wrapper);
    const missing = moved.filter((m) => !world.witnesses.some((w) => w.id === m.id)).map((m) => m.id);
    const t0 = Date.now();
    const checks = ck.mod.runAll(world);
    return { world: urlOf(wrapper), checks, ms: Date.now() - t0, missing };
  }
  const checkSummary = (checks) => {
    const fails = checks.filter((c) => !c.pass);
    return `${checks.length - fails.length}/${checks.length} pass` + (fails.length ? ` — ${fails.map((c) => `${c.subject}: ${c.blockedBy ? 'blocked by ' + c.blockedBy : 'fail'}`).join('; ')}` : '');
  };

  async function playRun(id) {
    const m = manifest(id);
    const { plan } = stepPlan(id);
    for (const s of plan) {
      const msgs = [...s.lines, ...(s.timing ? [s.timing] : [])];
      const gap = Math.max(250, Math.round(s.ms / Math.max(1, msgs.length)));
      for (const msg of msgs) {
        emit(id, { type: 'progress', step: s.step, round: s.round, message: msg, replay: true });
        await sleep(gap);
      }
    }
    // install the recorded result
    const recorded = readJson(dir(id, 'replay', 'state.json'));
    if (!recorded || !recorded.world) throw new Error('recording has no state.json; cannot replay this case');
    for (const f of ['loop_log.json', 'validation.json']) {
      const v = readJson(dir(id, 'replay', f));
      if (v) writeJson(dir(id, 'cache', f), v);
    }
    const info = readJson(dir(id, 'replay', 'replay.json')) || {};
    const state = { ...recorded, caseId: id, replay: { of: m.replayOf, recordedAt: info.recordedAt || m.recordedAt || null, recordedMode: info.recordedMode || null, replayedAt: new Date().toISOString() } };
    const { confirmed, moved } = movedWitnesses(id);
    if (moved.length) {
      emit(id, { type: 'progress', step: 'checks', round: 'confirmed', message: `Reviewer moved ${moved.map((w) => `${w.name} ${w.movedBy} m`).join(', ')} on the review screen → re-running the independent checks on the recorded world with the confirmed positions (local, live)…` });
      const r = await recheckWithConfirmed(id, recorded.world, moved);
      state.world = r.world;
      state.checks = r.checks;
      state.replay.recordedWorld = recorded.world;
      state.replay.confirmedOverrides = moved;
      state.replay.checksRecomputedAt = new Date().toISOString();
      const before = (recorded.checks || []).filter((c) => c.check === 'sightline');
      for (const w of moved) {
        const nb = r.checks.find((c) => c.check === 'sightline' && c.subject === w.id), ob = before.find((c) => c.subject === w.id);
        const v = (c) => (!c ? 'n/a' : c.pass ? 'VISIBLE' : `BLOCKED by ${c.blockedBy || '?'}`);
        if (nb) emit(id, { type: 'progress', step: 'checks', message: `Sightline ${w.id}: ${v(nb)} from the confirmed position (recorded run: ${v(ob)})` });
      }
      if (r.missing.length) emit(id, { type: 'progress', step: 'checks', message: `Not in the recorded world, left as recorded: ${r.missing.join(', ')}` });
      emit(id, { type: 'progress', step: 'checks', message: `Independent checks (live, ${r.ms} ms): ${checkSummary(r.checks)} · Argon findings are from the recorded run` });
    } else if (confirmed) {
      emit(id, { type: 'progress', step: 'checks', message: 'Confirmed witness positions match the recording; the recorded checks stand.' });
    }
    writeJson(dir(id, 'cache', 'state.json'), state);
    const mm = manifest(id); mm.status = 'done'; delete mm.error; writeJson(dir(id, 'case.json'), mm);
    emit(id, { type: 'done', message: 'Reconstruction complete (replayed from the recorded live run).', state });
  }

  function startRunReplay(id) {
    const run = { running: true, events: [], clients: new Set(), startedAt: Date.now() };
    R(id).run = run;
    const m = manifest(id); m.status = 'running'; delete m.error; writeJson(dir(id, 'case.json'), m);
    const at = new Date().toISOString();
    try { fs.writeFileSync(dir(id, 'cache', 'job.json'), JSON.stringify({ caseId: id, status: 'building', step: 'start', message: 'Replaying the recorded live run', mode: 'replay',
      pid: process.pid, startedAt: at, buildingAt: at, finishedAt: null, error: null, resumable: false, events: [] }, null, 2)); } catch { /* */ }
    emit(id, { type: 'start', mode: 'replay', caseId: id, message: `Replaying the recorded run of cases/${m.replayOf} (no Argon calls)` });
    (async () => {
      try { await playRun(id); }
      catch (e) {
        const mm = manifest(id); if (mm) { mm.status = 'error'; mm.error = errMsg(e); writeJson(dir(id, 'case.json'), mm); }
        emit(id, { type: 'error', message: errMsg(e) });
      } finally {
        run.running = false;
        setTimeout(() => { for (const c of run.clients) { try { c.end(); } catch { /* */ } } run.clients.clear(); }, 1500);
      }
    })();
    return run;
  }

  // ================= routes =================
  app.get('/api/demo/config', (req, res) => {
    const s = sourceCase();
    res.json({ sourceCase: s.id, ready: !!s.id, reason: s.reason, tried: s.tried, title: DEMO_TITLE, stepMs: STEP_MS,
      ...(s.id ? { sourceTitle: (manifest(s.id) || {}).title, ...recordedInfo(dir(s.id)) } : {}) });
  });

  app.post('/api/demo/start', (req, res) => {
    const s = sourceCase();
    if (!s.id) return res.status(409).json({ error: 'no demo source case with cached outputs', tried: s.tried });
    try {
      const m = cloneCase(s.id);
      res.status(201).json({ caseId: m.caseId, title: m.title, replay: true, replayOf: s.id, sourceReason: s.reason, recordedAt: m.recordedAt,
        next: `/cases.html?case=${encodeURIComponent(m.caseId)}&step=1` });
    } catch (e) { res.status(500).json({ error: `demo clone failed: ${errMsg(e)}` }); }
  });

  // Step-bar info for ANY case (replay or live).
  app.get('/api/demo/case/:id', (req, res) => {
    const id = req.params.id;
    const m = manifest(id);
    if (!m) return res.status(404).json({ error: 'no such case' });
    const st = readJson(dir(id, 'cache', 'state.json'));
    const job = readJson(dir(id, 'cache', 'job.json'));
    const has = {
      files: (m.files || []).length > 0,
      extraction: fs.existsSync(dir(id, 'cache', 'extraction.json')) && !extractActive(id),
      confirmed: fs.existsSync(dir(id, 'confirmed_facts.json')),
      world: !!(st && st.world),
    };
    const running = runActive(id) || m.status === 'running' || !!(job && (job.status === 'building' || job.status === 'queued') && !m.replay);
    const reached = has.world ? 7 : (has.confirmed || running) ? 4 : has.extraction ? 3 : 2;
    const out = { caseId: id, title: m.title, replay: !!m.replay, replayOf: m.replayOf || null, recordedAt: m.recordedAt || null, recordedMode: m.recordedMode || null,
      has, running, extractActive: extractActive(id), reached, jobStatus: job ? job.status : null };
    if (m.replay) {
      const e = R(id).extract, r = R(id).run;
      if (e) out.extractReplay = { done: e.done, lines: visibleLines(e), error: e.error || null };
      if (r) out.runReplay = { running: r.running, last: (r.events[r.events.length - 1] || {}).message || null, events: r.events.length };
      const meta = readJson(dir(id, 'cache', 'extraction.meta.json'));
      if (meta && has.extraction) out.extractTiming = timingLine(meta, 'extraction');
      if (st && st.replay) out.stateReplay = { replayedAt: st.replay.replayedAt, confirmedOverrides: st.replay.confirmedOverrides || null };
    }
    res.json(out);
  });

  // ---- replay-mode overrides (fall through for every non-replay case) ----
  app.post('/api/cases/:id/extraction/run', (req, res, next) => {
    const id = req.params.id;
    if (!isReplay(id) || !fs.existsSync(dir(id, 'replay', 'extraction.json'))) return next();
    if (!extractActive(id)) startExtractionReplay(id);
    res.json(extractionSnapshot(id));
  });
  app.get('/api/cases/:id/extraction', (req, res, next) => {
    const id = req.params.id;
    if (!isReplay(id) || !extractActive(id)) return next();
    res.json(extractionSnapshot(id));
  });
  app.post('/api/cases/:id/run', (req, res, next) => {
    const id = req.params.id;
    if (!isReplay(id) || !fs.existsSync(dir(id, 'replay', 'state.json'))) return next();
    if (runActive(id)) return res.status(409).json({ error: 'already running', hint: `GET /api/cases/${id}/stream` });
    startRunReplay(id);
    res.status(202).json({ started: true, caseId: id, mode: 'replay', replay: true, stream: `/api/cases/${id}/stream` });
  });
  app.get('/api/cases/:id/stream', (req, res, next) => {
    const id = req.params.id;
    const run = isReplay(id) ? R(id).run : null;
    if (!run) return next();
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders?.();
    res.write(`data: ${JSON.stringify({ type: 'hello', mode: ctx.MODE, running: run.running, replay: true })}\n\n`);
    for (const ev of run.events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    if (run.running) { run.clients.add(res); req.on('close', () => run.clients.delete(res)); }
    else res.end();
  });
  app.get('/api/cases/:id', (req, res, next) => {
    const id = req.params.id;
    if (!runActive(id)) return next();
    const json = res.json.bind(res);
    res.json = (body) => json(body && typeof body === 'object' ? { ...body, status: 'running', running: true } : body);
    next();
  });
  app.get('/api/cases/:id/report.pdf', (req, res, next) => {
    const id = req.params.id;
    if (!isReplay(id) || req.query.fresh === '1' || req.query.fresh === 'true') return next();
    const pdf = dir(id, 'exports', 'report.pdf');
    const st = readJson(dir(id, 'cache', 'state.json'));
    if (!fs.existsSync(pdf) || !st || (st.replay && st.replay.confirmedOverrides)) return next(); // moved witnesses → build for real
    res.set('Content-Disposition', `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename="sightline-${id}-report.pdf"`);
    res.set('Cache-Control', 'no-store');
    res.set('X-Sightline-Replay', 'recorded');
    res.type('application/pdf').sendFile(pdf);
  });

  const s = sourceCase();
  console.log(`[sightline] demo flow mounted: source case ${s.id || '(none)'} (${s.reason}), replay step ${STEP_MS} ms`);
  return { sourceCase, cloneCase, isReplay };
}
