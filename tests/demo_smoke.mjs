// tests/demo_smoke.mjs — API-level smoke test of the stage demo path (REPLAY clone of the demo source case).
// No rendering: the server it spawns has headless Chromium disabled (RENDER_CHROME=playwright + a non-existent
// PLAYWRIGHT_BROWSERS_PATH, so render/record.js launchBrowser() throws immediately), and endpoints that would build
// with Chromium (uncached report.pdf, uncached clips) are skipped, never requested.
//
//   node tests/demo_smoke.mjs [--port 5205] [--keep]       (spawns `node server/server.js` in mock mode itself)
//
// Covers: health, case list, demo start (x2, no collision), case files/durations, extraction replay, confirm 0 m →
// run → confirm 6 m → run (checks re-run and differ), state/world/findings, size, frame, report.json/.pdf, scene
// .glb/.json, clips list, what-if, review data, restart mid-replay (job restore + re-run), missing aerial/validation,
// live new-witness route on odd input. Deletes the clones it created unless --keep.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('port', 5205));
const KEEP = process.argv.includes('--keep');
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const created = [];
const ok = (name, pass, detail = '') => { results.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); return !!pass; };
const skip = (name, why) => { results.push({ name, pass: true, skipped: true, detail: why }); console.log(`SKIP  ${name}  — ${why}`); };

// ---------- server lifecycle ----------
let srv = null, srvLog = '';
async function startServer() {
  srv = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORT), SIGHTLINE_MODE: 'mock', DEMO_STEP_MS: '2000',
      RENDER_CHROME: 'playwright', PLAYWRIGHT_BROWSERS_PATH: path.join(ROOT, '.no-browsers-for-smoke'), WITNESS_RENDER_BUDGET_MS: '3000' },
  });
  srv.stdout.on('data', (d) => { srvLog += d; });
  srv.stderr.on('data', (d) => { srvLog += d; });
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) return; } catch { /* booting */ }
    await sleep(200);
  }
  throw new Error('server did not come up:\n' + srvLog.slice(-2000));
}
async function stopServer(signal = 'SIGTERM') {
  if (!srv) return;
  const p = new Promise((r) => srv.once('exit', r));
  srv.kill(signal);
  await Promise.race([p, sleep(5000)]);
  srv = null;
}

// ---------- http helpers ----------
async function req(method, url, body, { timeout = 30000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + url, { method, signal: ctl.signal, headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
    const buf = Buffer.from(await r.arrayBuffer());
    let json = null;
    try { json = JSON.parse(buf.toString('utf8')); } catch { /* binary */ }
    return { status: r.status, headers: r.headers, buf, json, ms: Date.now() - t0 };
  } finally { clearTimeout(t); }
}
const get = (u, o) => req('GET', u, undefined, o);
const post = (u, b, o) => req('POST', u, b === undefined ? {} : b, o);

async function poll(fn, { every = 500, max = 90000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > max) return null;
    await sleep(every);
  }
}

async function startDemo() {
  const r = await post('/api/demo/start');
  if (r.status === 201 && r.json && r.json.caseId) created.push(r.json.caseId);
  return r;
}
async function runExtraction(id) {
  const r = await post(`/api/cases/${id}/extraction/run`);
  const done = await poll(async () => { const g = await get(`/api/cases/${id}/extraction`); return g.json && g.json.status === 'ready' ? g : null; }, { max: 20000 });
  return { start: r, done };
}
async function runReplay(id) {
  const r = await post(`/api/cases/${id}/run`);
  const job = await poll(async () => { const j = await get(`/api/cases/${id}/job`); return j.json && ['ready', 'failed'].includes(j.json.status) ? j : null; }, { max: 180000, every: 1000 });
  return { start: r, job };
}
function confirmBody(extraction, moveB) {
  const witnesses = extraction.witnesses.map((w) => (w.id === 'wit_B' && moveB
    ? { ...w, markedPosition: [w.markedPosition[0] + moveB[0], w.markedPosition[1] + moveB[1]] } : { ...w }));
  return { facts: extraction.facts, witnesses, vehicles: extraction.vehicles, objects: extraction.objects, scene: extraction.scene, confirmedBy: 'demo_smoke' };
}
const sightB = (state) => (state.checks || []).find((c) => c.check === 'sightline' && /^wit_(witness_)?B$/.test(c.subject));

// ================= main =================
async function main() {
  await startServer();

  // ---- 1. health + list ----
  const h = await get('/api/health');
  ok('GET /api/health', h.status === 200 && h.json.ok && h.json.mode === 'mock', JSON.stringify(h.json));
  const cfg = await get('/api/demo/config');
  ok('GET /api/demo/config ready', cfg.status === 200 && cfg.json.ready, `source=${cfg.json && cfg.json.sourceCase}`);
  const list = await get('/api/cases');
  const src = cfg.json && cfg.json.sourceCase;
  ok('GET /api/cases lists demo source', list.status === 200 && Array.isArray(list.json) && list.json.some((c) => c.caseId === src), `${(list.json || []).length} cases`);
  ok('cases.html served', (await get('/cases.html')).status === 200);

  // ---- 2. demo start x2 ----
  const d1 = await startDemo(), d2 = await startDemo();
  ok('POST /api/demo/start (1)', d1.status === 201 && /^demo-[0-9a-f]{6}$/.test(d1.json.caseId) && d1.json.replay, d1.json && d1.json.caseId);
  ok('POST /api/demo/start twice → distinct clones', d2.status === 201 && d2.json.caseId !== d1.json.caseId, `${d1.json.caseId} / ${d2.json && d2.json.caseId}`);
  const id = d1.json.caseId, id2 = d2.json.caseId;
  ok('clone #2 has its own case.json', fs.existsSync(path.join(ROOT, 'cases', id2, 'case.json')) && JSON.parse(fs.readFileSync(path.join(ROOT, 'cases', id2, 'case.json'), 'utf8')).caseId === id2);

  // ---- 3. case files ----
  const c0 = await get(`/api/cases/${id}`);
  const vids = (c0.json.files || []).filter((f) => f.type === 'video');
  ok('GET case: videoCount 2', c0.status === 200 && c0.json.videoCount === 2, `videoCount=${c0.json.videoCount}`);
  ok('GET case: real video durations', vids.length === 2 && vids.every((f) => f.durationSec > 60), vids.map((f) => `${f.name}=${f.durationSec}s`).join(', '));
  ok('GET case: totalVideoSec ~9900', Math.abs((c0.json.totalVideoSec || 0) - 9900) < 120, `totalVideoSec=${c0.json.totalVideoSec}`);
  ok('GET case: no state before run (held back)', c0.json.state == null && c0.json.replay === true);
  const ev = vids[0] && await get(vids[0].url, { timeout: 60000 });
  ok('evidence video URL serves', ev && ev.status === 200 && ev.buf.length > 1e6);
  const step = await get(`/api/demo/case/${id}`);
  ok('GET /api/demo/case/:id step info', step.status === 200 && step.json.replay && step.json.reached === 2, `reached=${step.json.reached}`);

  // ---- 4. extraction replay ----
  const ex = await runExtraction(id);
  ok('extraction/run (replay) responds running', ex.start.status === 200 && ex.start.json.status === 'running', `status=${ex.start.json && ex.start.json.status}`);
  ok('extraction poll → ready with witnesses', ex.done && ex.done.json.extraction && ex.done.json.extraction.witnesses.some((w) => w.id === 'wit_B'),
    ex.done ? `${ex.done.json.extraction.witnesses.length} witnesses, meta.replayed=${ex.done.json.meta && ex.done.json.meta.replayed}` : 'timeout');
  const extraction = ex.done.json.extraction;

  // ---- 5. confirm (0 m) → run ----
  const cf0 = await post(`/api/cases/${id}/confirm`, confirmBody(extraction, null));
  ok('confirm (Witness B moved 0 m)', cf0.status === 200 && cf0.json.ok);
  const run0 = await runReplay(id);
  ok('run (replay) 202 → job ready', run0.start.status === 202 && run0.job && run0.job.json.status === 'ready', run0.job ? `job=${run0.job.json.status} ${run0.job.json.error || ''}` : 'timeout');
  const s0 = (await get(`/api/cases/${id}`)).json.state || {};
  ok('state after run: findings + verdict + checks', (s0.findings || []).length > 0 && !!s0.verdict && (s0.checks || []).length > 0, `findings=${(s0.findings || []).length} verdict=${s0.verdict} checks=${(s0.checks || []).length}`);
  ok('0 m confirm keeps recorded checks (no override)', !(s0.replay && s0.replay.confirmedOverrides) && !/_confirmed\.js$/.test(s0.world || ''), s0.world);
  const wjs = await get(s0.world);
  ok('world path fetchable as JS', wjs.status === 200 && /javascript/.test(wjs.headers.get('content-type') || '') && /export default/.test(wjs.buf.toString()), `${s0.world} ${wjs.status} ${wjs.headers.get('content-type')}`);

  // ---- 6. confirm (6 m) → run: checks re-run and differ ----
  let s6 = null, moveUsed = null;
  for (const mv of [[0, 6], [6, 0], [0, -6], [-6, 0]]) {
    const cf6 = await post(`/api/cases/${id}/confirm`, confirmBody(extraction, mv));
    if (cf6.status !== 200) { ok('confirm (Witness B moved 6 m)', false, `status ${cf6.status}`); break; }
    const run6 = await runReplay(id);
    if (!run6.job || run6.job.json.status !== 'ready') { ok('re-run after 6 m confirm', false, run6.job ? run6.job.json.error : 'timeout'); break; }
    s6 = (await get(`/api/cases/${id}`)).json.state || {};
    moveUsed = mv;
    const a = sightB(s0), b = sightB(s6);
    if (a && b && (a.pass !== b.pass || a.blockedBy !== b.blockedBy)) break;
  }
  if (s6) {
    const a = sightB(s0), b = sightB(s6);
    ok('6 m confirm → checks re-ran on confirmed world', /_confirmed\.js$/.test(s6.world || '') && s6.replay && Array.isArray(s6.replay.confirmedOverrides) && s6.replay.confirmedOverrides.some((o) => o.id === 'wit_B' && Math.abs(o.movedBy - 6) < 0.2),
      `world=${s6.world}`);
    ok('6 m checks differ from 0 m checks', a && b && (a.pass !== b.pass || a.blockedBy !== b.blockedBy || JSON.stringify(a.from) !== JSON.stringify(b.from)),
      `move=${JSON.stringify(moveUsed)} wit_B: ${a && (a.pass ? 'VISIBLE' : 'BLOCKED ' + a.blockedBy)} → ${b && (b.pass ? 'VISIBLE' : 'BLOCKED ' + b.blockedBy)}`);
    const w6 = await get(s6.world);
    ok('confirmed world fetchable as JS', w6.status === 200 && /export default/.test(w6.buf.toString()));
  }
  const stream = await get(`/api/cases/${id}/stream`, { timeout: 5000 }).catch((e) => ({ status: 0, err: e.message }));
  ok('SSE stream after replay ends (no hang)', stream.status === 200, stream.err || '');

  // ---- 7. exports + side endpoints ----
  const sz = await get(`/api/cases/${id}/size`);
  ok('GET /size', sz.status === 200 && sz.json, sz.json ? JSON.stringify(sz.json).slice(0, 120) : String(sz.status));
  const fr = await get(`/api/cases/${id}/frame?video=deposition_witness_B.mp4&t=41:10&format=json`, { timeout: 60000 });
  ok('GET /frame (json, MM:SS)', fr.status === 200 && fr.json && fr.json.url, fr.json && (fr.json.url || fr.json.error));
  const frp = fr.json && fr.json.url ? await get(fr.json.url) : null;
  ok('frame PNG fetchable', frp && frp.status === 200 && frp.buf.slice(1, 4).toString() === 'PNG');
  const frBad = await get(`/api/cases/${id}/frame?video=nope.mp4&t=1`);
  ok('GET /frame bad video → 404 not 500', frBad.status === 404);
  const rj = await get(`/api/cases/${id}/report.json`, { timeout: 60000 });
  ok('GET /report.json', rj.status === 200 && rj.json && rj.json.state && rj.json.state.world, rj.json && (rj.json.error || `figures=${(rj.json.figures || []).length}`));
  const pdfPath = path.join(ROOT, 'cases', id, 'exports', 'report.pdf');
  if (fs.existsSync(pdfPath)) {
    const pdf = await get(`/api/cases/${id}/report.pdf`, { timeout: 30000 });
    ok('GET /report.pdf (cached)', pdf.status === 200 && pdf.buf.slice(0, 4).toString() === '%PDF', `${pdf.status} ${pdf.buf.length} B`);
  } else skip('GET /report.pdf', `no recorded exports/report.pdf in source case "${src}" — the route would build it with headless Chromium (minutes) on the stage`);
  const glb = await get(`/api/cases/${id}/scene.glb`, { timeout: 120000 });
  ok('GET /scene.glb', glb.status === 200 && glb.buf.slice(0, 4).toString() === 'glTF', `${glb.status} ${glb.buf.length} B ${glb.ms} ms cache=${glb.headers.get('x-scene-cache')}`);
  const sj = await get(`/api/cases/${id}/scene.json`, { timeout: 120000 });
  ok('GET /scene.json', sj.status === 200 && sj.json && Array.isArray(sj.json.objects), `${sj.ms} ms`);
  const cl = await get(`/api/cases/${id}/clips`, { timeout: 60000 });
  ok('GET /clips list', cl.status === 200 && Array.isArray(cl.json.clips) && cl.json.clips.length > 0, cl.json && (cl.json.error || `${cl.json.clips.length} clips, ${cl.json.clips.filter((c) => c.cached).length} cached`));
  const cached = cl.json && cl.json.clips ? cl.json.clips.find((c) => c.cached) : null;
  if (cached) {
    const mp4 = await get(cached.url, { timeout: 30000 });
    ok('GET cached clip mp4', mp4.status === 200 && mp4.buf.slice(4, 8).toString() === 'ftyp', `${cached.camera} cache=${mp4.headers.get('x-clip-cache')}`);
  } else skip('GET clip mp4', 'no cached clip for this world (would render with Chromium)');
  const wi = await get(`/api/cases/${id}/whatif?targetMph=45`, { timeout: 60000 });
  ok('GET /whatif?targetMph=45', wi.status === 200 && wi.json && Array.isArray(wi.json.checks), wi.json && (wi.json.error || wi.json.sentence || '').slice(0, 120));
  const wiBad = await get(`/api/cases/${id}/whatif?targetMph=abc`);
  ok('GET /whatif bad input → 400', wiBad.status === 400);
  const rv = await get(`/api/cases/${id}/extraction`);
  ok('review data: extraction ready + confirmed', rv.status === 200 && rv.json.status === 'ready' && rv.json.confirmed && rv.json.confirmed.confirmedBy === 'demo_smoke');
  ok('review.html served', (await get('/review.html')).status === 200);
  const ae = await get(`/api/cases/${id}/aerial`);
  ok('GET /aerial', ae.status === 200 && ae.json, ae.json && `available=${ae.json.available}`);
  const dc = await get(`/api/demo/case/${id}`);
  ok('step info after run: reached 7', dc.status === 200 && dc.json.reached === 7 && !dc.json.running, `reached=${dc.json.reached} running=${dc.json.running}`);

  // ---- 8. live new-witness route (mock) on odd input ----
  const statements = [
    ['parseable', 'I was standing 30 m north of the store when the truck turned.'],
    ['empty string', ''],
    ['whitespace', '   '],
    ['very long (200k chars)', 'I was near the store and the truck turned slowly across the road '.repeat(3100)],
    ['pathological regex', '1 m north of ' + 'a '.repeat(50000)],
    ['spanish', 'Estaba de pie cerca de la tienda cuando el camión giró.'],
    ['chinese', '我站在商店前面，看到卡车转弯。'],
    ['emoji/control', '\u0000‮🚗💥\n\t'],
    ['non-string', 12345],
    ['missing', undefined],
  ];
  for (const [label, s] of statements) {
    const body = s === undefined ? {} : { statement: s };
    const r = await post(`/api/cases/${id}/witness`, body, { timeout: 30000 }).catch((e) => ({ status: 0, ms: 30000, err: e.message }));
    const placed = r.status === 200 && r.json && r.json.witness && Array.isArray(r.json.witness.position);
    ok(`witness: ${label}`, r.status !== 500 && r.status !== 0 && r.ms < 10000 && (label !== 'parseable' || placed),
      `${r.status} ${r.ms} ms ${r.err || (placed ? `source=${r.json.witness.source} verdict=${r.json.verdict}` : (r.json && r.json.error || '').slice(0, 100))}`);
  }
  const bodyBad = await req('POST', `/api/cases/${id}/witness`, '{not json', { timeout: 5000 });
  ok('witness: malformed JSON body → 4xx', bodyBad.status >= 400 && bodyBad.status < 500, String(bodyBad.status));
  const noCase = await post('/api/cases/does-not-exist/witness', { statement: 'x' });
  ok('witness: unknown case → 404', noCase.status === 404);
  const noWorld = await post(`/api/cases/${id2}/witness`, { statement: 'I was 30 m north of the store' });
  ok('witness: case without world → 409', noWorld.status === 409, String(noWorld.status));

  // ---- 9. restart mid-replay (clone #2) ----
  const ex2 = await runExtraction(id2);
  ok('clone #2 extraction ready', !!ex2.done);
  const r2 = await post(`/api/cases/${id2}/run`);
  ok('clone #2 run started', r2.status === 202);
  await sleep(3500);
  const mid = await get(`/api/cases/${id2}`);
  ok('GET case during replay → running', mid.json.running === true && mid.json.status === 'running');
  const dup = await post(`/api/cases/${id2}/run`);
  ok('second run while running → 409', dup.status === 409);
  await stopServer('SIGKILL');
  await startServer();
  const jr = await get(`/api/cases/${id2}/job`);
  ok('after restart: job marked failed + resumable', jr.json.status === 'failed' && jr.json.resumable === true && /restart/.test(jr.json.error || ''), `status=${jr.json.status} error=${jr.json.error}`);
  const mr = await get(`/api/cases/${id2}`);
  ok('after restart: case not stuck running', mr.status === 200 && mr.json.status !== 'running' && !mr.json.running, `status=${mr.json.status}`);
  const dcr = await get(`/api/demo/case/${id2}`);
  ok('after restart: step info not running', dcr.status === 200 && !dcr.json.running, `running=${dcr.json.running}`);
  const rerun = await runReplay(id2);
  ok('after restart: re-run completes', rerun.start.status === 202 && rerun.job && rerun.job.json.status === 'ready', rerun.job && rerun.job.json.error);
  const sr = (await get(`/api/cases/${id2}`)).json.state || {};
  ok('after restart: state installed', !!sr.world && (sr.findings || []).length > 0);

  // ---- 10. missing optional files: no aerial, no validation ----
  const d3 = await startDemo();
  const id3 = d3.json.caseId;
  ok('clone #3 started', d3.status === 201);
  fs.rmSync(path.join(ROOT, 'cases', id3, 'exhibits', 'aerial'), { recursive: true, force: true });
  for (const f of ['replay/validation.json', 'cache/validation.json', 'cache/world_validation.json', 'validation_facts.json']) fs.rmSync(path.join(ROOT, 'cases', id3, f), { force: true });
  const ex3 = await runExtraction(id3);
  ok('clone #3 extraction ready', !!ex3.done);
  const run3 = await runReplay(id3);
  ok('clone #3 (no aerial/validation) run ready', run3.job && run3.job.json.status === 'ready', run3.job && run3.job.json.error);
  const c3 = await get(`/api/cases/${id3}`);
  ok('clone #3 GET case ok, validation null', c3.status === 200 && c3.json.validation == null && c3.json.state && c3.json.state.world);
  const ae3 = await get(`/api/cases/${id3}/aerial`);
  ok('clone #3 /aerial → available:false (not 500)', ae3.status === 200 && ae3.json.available === false, ae3.json && ae3.json.reason);
  const rj3 = await get(`/api/cases/${id3}/report.json`, { timeout: 60000 });
  ok('clone #3 /report.json ok', rj3.status === 200 && !rj3.json.error);
  const sj3 = await get(`/api/cases/${id3}/scene.json`, { timeout: 120000 });
  ok('clone #3 /scene.json ok', sj3.status === 200);
  const sz3 = await get(`/api/cases/${id3}/size`);
  ok('clone #3 /size ok', sz3.status === 200);

  // ---- 11. odd ids / unknown routes ----
  ok('GET unknown case → 404', (await get('/api/cases/nope-000')).status === 404);
  ok('POST demo run on unknown case → 404', (await post('/api/cases/nope-000/run')).status === 404);
  ok('GET /api/demo/case/../x → 404', [400, 404].includes((await get('/api/demo/case/..%2Fx')).status));
  ok('server log has no unhandled errors', !/Unhandled|TypeError|ReferenceError/.test(srvLog), (srvLog.match(/.*(Unhandled|TypeError|ReferenceError).*/) || [''])[0].slice(0, 200));
}

let code = 0;
try { await main(); }
catch (e) { ok('harness', false, e.stack || String(e)); }
finally {
  await stopServer();
  if (!KEEP) for (const id of created) { if (/^demo-[0-9a-f]{6}$/.test(id)) fs.rmSync(path.join(ROOT, 'cases', id), { recursive: true, force: true }); }
  const fails = results.filter((r) => !r.pass);
  console.log(`\n${results.length - fails.length}/${results.length} pass, ${results.filter((r) => r.skipped).length} skipped${KEEP ? ` (kept: ${created.join(', ')})` : ` (deleted clones: ${created.join(', ') || 'none'})`}`);
  if (fails.length) { console.log('FAILED:\n' + fails.map((f) => `  - ${f.name}: ${f.detail}`).join('\n')); code = 1; }
  if (process.env.SMOKE_SERVER_LOG) console.log('\n--- server log ---\n' + srvLog.slice(-6000));
}
process.exit(code);
