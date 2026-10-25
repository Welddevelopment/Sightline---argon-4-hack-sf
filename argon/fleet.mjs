// argon/fleet.mjs — VERIFICATION + RENDER FLEET on Gemini Managed Agents.
//
//   Argon (gemini-4-argon) reads the case state and PLANS independent jobs (witness × check type, what-if sweeps, renders).
//   Each job is dispatched as its own Managed Agent interaction (agent antigravity-preview-09-2026, Flash model) in a
//   Google-hosted sandbox: the public repo is mounted (environment source type "repository"), the exact world file +
//   task + runner are uploaded inline, the agent runs ONE check with the repo's checks/ code and reads back the result.
//   All jobs run in parallel (background interactions); we poll, download each result file from the sandbox's file API,
//   compare against the local checks, and Argon MERGES everything into a verification report.
//
//   SIGHTLINE_MODE=live node argon/fleet.mjs demo-full [--max 24] [--no-renders] [--only sl_wit_B,rob_wit_B]
//   SIGHTLINE_MODE=mock (default) replays cases/<id>/cache/fleet/run.json.
//
// Security: the API key is used only by this process (SDK + file-download header). It is never placed in a sandbox
// prompt, environment config, env var or uploaded file. Sandbox egress is allowlisted to npm + GitHub only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ROOT, isLive, getAI, callArgon, readPrompt, readJSON, writeJSON } from './client.js';

export const FLEET_AGENT = process.env.FLEET_AGENT || 'antigravity-preview-09-2026';
export const FLEET_MODEL = process.env.FLEET_MODEL || 'gemini-3.8-flash';
export const REPO_URL = 'https://github.com/Welddevelopment/Sightline---argon-4-hack-sf';
const API = 'https://generativelanguage.googleapis.com/v1beta';
const SANDBOX_DIR = path.join(ROOT, 'argon', 'fleet_sandbox');
const TYPES = new Set(['full_checks', 'sightline', 'robustness', 'gaze', 'prt', 'whatif_speed', 'whatif_time', 'render']);
const NETWORK = { allowlist: [{ domain: 'registry.npmjs.org' }, { domain: 'github.com' }, { domain: 'codeload.github.com' }, { domain: '*.githubusercontent.com' }] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha12 = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
const log = (...a) => console.log('[fleet]', ...a);

// ---------- case state ----------
export function loadCase(caseId) {
  const caseDir = path.join(ROOT, 'cases', caseId);
  const state = readJSON(path.join(caseDir, 'cache', 'state.json'));
  if (!state?.world) throw new Error(`no world in cases/${caseId}/cache/state.json`);
  const worldAbs = path.join(ROOT, state.world.replace(/^\//, ''));
  const sl = (state.checks || []).filter((c) => c.check === 'sightline');
  const witnesses = sl.map((c) => ({ id: c.subject, target: c.target, t: c.t, localVisible: c.pass, blockedBy: c.blockedBy || null,
    robustness: c.robustness ? { verdict: c.robustness.verdict, blocked: c.robustness.blocked, samples: c.robustness.samples } : null,
    gazeDeg: c.gaze?.offAxisDeg ?? null, claim: (c.detail?.match(/Claim: "([^"]+)"/) || [])[1] || null }));
  return { caseId, caseDir, state, worldAbs, worldRel: state.world, witnesses, fleetDir: path.join(caseDir, 'cache', 'fleet') };
}

function caseSummary(c) {
  const otherChecks = (c.state.checks || []).filter((x) => x.check !== 'sightline').map((x) => ({ check: x.check, subject: x.subject, pass: x.pass }));
  return JSON.stringify({ caseId: c.caseId, world: c.worldRel, witnesses: c.witnesses, otherChecks,
    findings: (c.state.findings || []).map((f) => ({ id: f.id, severity: f.severity, summary: f.summary })) }, null, 1);
}

// Deterministic fallback / coverage filler for Argon's plan.
export function defaultPlan(c, { renders = true } = {}) {
  const t = [{ id: 'full_checks', type: 'full_checks', why: 'Independent clean-machine rerun of the whole checks suite.' },
    { id: 'prt_all', type: 'prt', why: 'Perception-reaction time available to each colliding driver.' }];
  for (const w of c.witnesses) {
    t.push({ id: `sl_${w.id}`, type: 'sightline', witness: w.id, why: `Ray-cast + timeline for ${w.id}.` });
    t.push({ id: `rob_${w.id}`, type: 'robustness', witness: w.id, why: `Position robustness for ${w.id}.` });
    t.push({ id: `gz_${w.id}`, type: 'gaze', witness: w.id, why: `Gaze angle for ${w.id}.` });
    if (!w.localVisible || w.robustness?.verdict === 'partial' || (w.gazeDeg ?? 0) > 30) t.push({ id: `ws_${w.id}`, type: 'whatif_speed', witness: w.id, why: `Speed sensitivity for ${w.id}.` });
  }
  if (renders) { t.push({ id: 'r_overhead', type: 'render', view: 'overhead', why: 'Overhead render.' }); for (const w of c.witnesses) t.push({ id: `r_${w.id}`, type: 'render', view: w.id, why: `POV render for ${w.id}.` }); }
  return t;
}

function sanitizePlan(c, tasks, { max, renders }) {
  const wids = new Set(c.witnesses.map((w) => w.id));
  const seen = new Set();
  let out = [];
  for (const x of tasks || []) {
    if (!x || !TYPES.has(x.type)) continue;
    if (x.type === 'render') { x.view = x.view || x.witness || 'overhead'; if (x.view !== 'overhead' && !wids.has(x.view)) continue; if (!renders) continue; }
    else if (['sightline', 'robustness', 'gaze', 'whatif_speed', 'whatif_time'].includes(x.type) && !wids.has(x.witness)) continue;
    x.id = String(x.id || `${x.type}_${x.witness || x.view || ''}`).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40);
    if (seen.has(x.id)) continue; seen.add(x.id); out.push(x);
  }
  // guarantee coverage: full_checks + sightline/robustness/gaze per witness + renders
  const have = (type, w) => out.some((x) => x.type === type && (x.witness === w || x.view === w));
  for (const d of defaultPlan(c, { renders })) {
    const key = d.witness || d.view;
    if (['full_checks', 'sightline', 'robustness', 'gaze', 'render'].includes(d.type) && !have(d.type, key) && !(d.type === 'full_checks' && out.some((x) => x.type === 'full_checks'))) {
      d.why += ' (added for coverage)'; out.push(d);
    }
  }
  return out.slice(0, max);
}

// ---------- sandbox job ----------
function jobSpec(c, task, files) {
  const isRender = task.type === 'render';
  const prep = 'cd /workspace/job && mkdir -p repo out && cp -r /workspace/repo/checks /workspace/repo/web repo/ && npm i --no-audit --no-fund --loglevel=error three@0.186.1 >/dev/null';
  const resultRel = isRender ? `out/${task.view}/verdict.json` : 'out/result.json';
  const run = isRender
    ? `node render_view.mjs --repo /workspace/job/repo --world /workspace/job/world.js --view ${task.view} --out /workspace/job/out/${task.view} --fps ${task.params?.fps || 2} --w ${task.params?.w || 480} --h ${task.params?.h || 270}`
    : 'node run_task.mjs --repo /workspace/job/repo --world /workspace/job/world.js --task-file /workspace/job/task.json --out /workspace/job/out/result.json';
  const command = `${prep} && ${run}`;
  const input = readPrompt('fleet_agent').replace('{{COMMAND}}', command).replace('{{RESULT}}', `/workspace/job/${resultRel}`)
    .replace('{{SUBJECT}}', task.witness || task.view || 'the reconstruction');
  const sources = [
    { type: 'repository', source: REPO_URL, target: '/workspace/repo' },
    { type: 'inline', target: '/workspace/job/package.json', content: '{"private":true,"type":"module"}\n' },
    { type: 'inline', target: '/workspace/job/world.js', content: files.world },
    { type: 'inline', target: '/workspace/job/task.json', content: JSON.stringify({ id: task.id, type: task.type, witness: task.witness, target: task.target, params: task.params || {} }) },
    { type: 'inline', target: `/workspace/job/${isRender ? 'render_view.mjs' : 'run_task.mjs'}`, content: isRender ? files.render : files.runner },
  ];
  return { resultRel, command, req: {
    agent: FLEET_AGENT, agent_config: { type: 'antigravity', model: FLEET_MODEL }, background: true,
    environment: { type: 'remote', network: NETWORK, sources }, input,
    labels: { app: 'sightline', case: c.caseId.replace(/[^a-z0-9_-]/g, '_'), job: task.id.toLowerCase().slice(0, 60) },
  } };
}

async function fetchEnvFile(envId, rel, { binary = false } = {}) {
  const url = `${API}/environments/${envId}/files/workspace/job/${rel}?alt=media`;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY } });
    if (r.ok) return binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
    if (r.status !== 404 && r.status < 500) return null;
    await sleep(3000);
  }
  return null;
}

function parseAgentReply(txt) {
  if (!txt) return null;
  const m = String(txt).match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return { raw: String(txt).slice(0, 400) }; }
}

async function createWithRetry(ai, req) {
  for (let i = 0; ; i++) {
    try { return await ai.interactions.create(req); }
    catch (e) { if (i >= 4 || ![429, 500, 502, 503, 504].includes(e.status)) throw e; await sleep(2000 * 2 ** i); }
  }
}

async function runJob(ai, c, task, files, tDispatch0) {
  const spec = jobSpec(c, task, files);
  const rec = { id: task.id, type: task.type, witness: task.witness, view: task.view, why: task.why, command: spec.command };
  const t0 = Date.now();
  try {
    const it = await createWithRetry(ai, spec.req);
    rec.interactionId = it.id; rec.dispatchedAtMs = t0 - tDispatch0; rec.createMs = Date.now() - t0;
    let g = it;
    while (['in_progress', 'queued', 'pending', 'running', undefined].includes(g.status) && Date.now() - t0 < 15 * 60 * 1000) {
      await sleep(4000);
      try { g = await ai.interactions.get(it.id); } catch (e) { if (![429, 500, 502, 503, 504].includes(e.status)) throw e; }
    }
    rec.status = g.status; rec.environmentId = g.environment_id; rec.usage = g.usage ? { total: g.usage.total_tokens, input: g.usage.total_input_tokens, cached: g.usage.total_cached_tokens } : null;
    rec.serverCreated = g.created; rec.serverUpdated = g.updated;
    rec.agentReply = parseAgentReply(g.output_text);
    if (g.environment_id) {
      const txt = await fetchEnvFile(g.environment_id, spec.resultRel);
      rec.result = txt ? JSON.parse(txt) : null;
      if (task.type === 'render') {
        const png = await fetchEnvFile(g.environment_id, `out/${task.view}/still.png`, { binary: true });
        if (png && png.length > 100) {
          const p = path.join(c.fleetDir, 'renders', `${task.view}.png`);
          fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, png);
          rec.still = path.relative(ROOT, p);
        }
      }
    }
    rec.ok = rec.status === 'completed' && !!rec.result && (task.type === 'render' || rec.result.ok);
  } catch (e) {
    rec.status = rec.status || 'error'; rec.ok = false; rec.error = `${e.status || ''} ${String(e.message || e).slice(0, 300)}`;
  }
  rec.wallMs = Date.now() - t0; rec.doneAtMs = Date.now() - tDispatch0;
  writeJSON(path.join(c.fleetDir, 'jobs', `${task.id}.json`), rec);
  log(`${rec.ok ? 'ok ' : 'ERR'} ${task.id.padEnd(16)} ${(rec.wallMs / 1000).toFixed(0)}s ${rec.status}${rec.error ? ' ' + rec.error : ''}`);
  return rec;
}

// ---------- comparison vs local checks ----------
export function compare(c, jobs) {
  const local = Object.fromEntries(c.witnesses.map((w) => [w.id, w]));
  const rows = [];
  const add = (job, subject, metric, localV, fleetV, agree) => rows.push({ job, subject, metric, local: localV, fleet: fleetV, agree });
  for (const j of jobs) {
    if (!j.ok) { add(j.id, j.witness || j.view || '-', 'job', 'n/a', j.status || 'failed', null); continue; }
    const r = j.result?.result, L = local[j.witness || j.view];
    if (j.type === 'sightline' && L) add(j.id, j.witness, 'visible@tObs', L.localVisible, r.at.visible, L.localVisible === r.at.visible);
    if (j.type === 'robustness' && L?.robustness) add(j.id, j.witness, 'blocked/25', L.robustness.blocked, r.standard.blocked, L.robustness.blocked === r.standard.blocked);
    if (j.type === 'gaze' && L?.gazeDeg != null) add(j.id, j.witness, 'gazeDeg', L.gazeDeg, r.gaze.offAxisDeg, Math.abs(L.gazeDeg - r.gaze.offAxisDeg) <= 0.5);
    if (j.type === 'render' && L) add(j.id, j.view, 'raycast+pixels', L.localVisible, `${j.result.raycast?.visible} (${Math.round((j.result.pixels?.visibleFraction ?? NaN) * 100)}% px)`, L.localVisible === j.result.raycast?.visible);
    if (j.type === 'full_checks') {
      const loc = c.state.checks || [];
      let n = 0, same = 0; const diffs = [];
      for (const fc of r.checks) { const lc = loc.find((x) => x.check === fc.check && x.subject === fc.subject); if (!lc) continue; n++; if (lc.pass === fc.pass) same++; else diffs.push(`${fc.check}:${fc.subject}`); }
      add(j.id, 'all', 'pass/fail match', `${n} local`, `${same}/${n} same`, same === n ? true : false);
      if (diffs.length) rows.at(-1).diffs = diffs;
    }
  }
  return rows;
}

function compactResult(j) {
  if (!j.ok) return { id: j.id, failed: j.status, error: j.error || j.result?.error || null };
  const r = j.result?.result ?? j.result;
  let s;
  switch (j.type) {
    case 'sightline': s = { at: r.at, firstVisibleT: r.firstVisibleT, lastVisibleT: r.lastVisibleT, visibleSteps: `${r.visibleSteps}/${r.steps}` }; break;
    case 'robustness': s = { standard: { blocked: r.standard.blocked, verdict: r.standard.verdict, blockers: r.standard.blockers }, rings: r.rings.map((x) => `${x.radiusM}m:${x.blocked}/${x.samples}`) }; break;
    case 'gaze': s = { gaze: r.gaze, altGazeDegByMark: r.altGazeDegByMark }; break;
    case 'render': s = { verdict: j.result.verdict, raycast: j.result.raycast, pixels: j.result.pixels, frames: j.result.frames, renderMs: j.result.renderMs }; break;
    case 'full_checks': s = { checks: r.checks.map((x) => `${x.check}:${x.subject}=${x.pass}`) }; break;
    default: s = r;
  }
  return { id: j.id, type: j.type, subject: j.witness || j.view, result: s, sandbox: j.result?.env ? { host: j.result.env.host, checksSha: j.result.env.checksSha, worldSha: j.result.env.worldSha } : null, agent: j.agentReply?.interpretation };
}

// ---------- main ----------
export async function runFleet({ caseId, tasks, max = Number(process.env.FLEET_MAX || 24), renders = true, only = null } = {}) {
  const c = loadCase(caseId);
  fs.mkdirSync(c.fleetDir, { recursive: true });
  if (!isLive()) {
    const run = readJSON(path.join(c.fleetDir, 'run.json'));
    if (!run) throw new Error(`[mock] no fleet cache at ${path.relative(ROOT, c.fleetDir)}/run.json`);
    return run;
  }
  const tStart = Date.now();
  const worldBuf = fs.readFileSync(c.worldAbs);
  const files = { world: worldBuf.toString('utf8'), runner: fs.readFileSync(path.join(SANDBOX_DIR, 'run_task.mjs'), 'utf8'), render: fs.readFileSync(path.join(SANDBOX_DIR, 'render_view.mjs'), 'utf8') };
  if (/GEMINI_API_KEY|AIza[0-9A-Za-z_-]{20,}/.test(files.world + files.runner + files.render)) throw new Error('refusing: key-like string in sandbox upload');
  const localChecksSha = Object.fromEntries(['checks.js', 'robustness.js', 'physics.js'].map((f) => [f, sha12(fs.readFileSync(path.join(ROOT, 'checks', f)))]));

  // 1. Argon plans
  let plan, planNote = null, planSecs = 0;
  if (tasks) plan = tasks;
  else {
    const t0 = Date.now();
    try {
      const prompt = readPrompt('fleet_plan').replace('{{MAX}}', String(max)).replace('{{CASE}}', caseSummary(c));
      const res = await callArgon({ name: 'plan', parts: [{ text: prompt }], json: true, maxOutputTokens: 16384, cacheDir: c.fleetDir });
      plan = res.data?.tasks; planNote = res.data?.plan_note || null;
    } catch (e) { log('Argon plan failed, using default plan:', e.message); plan = defaultPlan(c, { renders }); planNote = 'default plan (Argon planning failed)'; }
    planSecs = (Date.now() - t0) / 1000;
  }
  plan = sanitizePlan(c, plan, { max, renders });
  if (only) plan = plan.filter((x) => only.includes(x.id));
  writeJSON(path.join(c.fleetDir, 'plan_final.json'), { planNote, tasks: plan });
  log(`plan: ${plan.length} jobs (${planSecs.toFixed(0)}s Argon) — ${planNote || ''}`);

  // 2. Dispatch every job as its own Managed Agent, all in parallel
  const ai = await getAI();
  const tDispatch0 = Date.now();
  const jobs = await Promise.all(plan.map((task, i) => sleep(i * 250).then(() => runJob(ai, c, task, files, tDispatch0))));
  const fleetWallMs = Date.now() - tDispatch0;
  const seqMs = jobs.reduce((a, j) => a + (j.wallMs || 0), 0);
  const sandboxComputeMs = jobs.reduce((a, j) => a + (j.result?.env?.ms || j.result?.renderMs || 0), 0);

  // 3. Compare + Argon merges
  const comparison = compare(c, jobs);
  const drift = jobs.map((j) => j.result?.env?.checksSha).filter(Boolean)[0];
  const codeDrift = drift ? Object.keys(localChecksSha).filter((k) => drift[k] !== localChecksSha[k]) : null;
  const body = [
    '## PLAN', JSON.stringify(plan.map(({ id, type, witness, view, why }) => ({ id, type, witness, view, why }))),
    '## LOCAL CHECKS (reconstruction loop)', caseSummary(c),
    '## MACHINE COMPARISON (fleet vs local)', JSON.stringify(comparison),
    `## CODE PROVENANCE: sandbox checks/ (public repo main) vs local checks/ differ in: ${codeDrift ? (codeDrift.join(', ') || 'none') : 'unknown'}; world sha ${sha12(worldBuf)}`,
    '## SANDBOX RESULTS', JSON.stringify(jobs.map(compactResult)),
  ].join('\n');
  let report = null, mergeSecs = 0;
  { const t0 = Date.now();
    try { report = (await callArgon({ name: 'merge', parts: [{ text: readPrompt('fleet_merge').replace('{{BODY}}', body) }], json: true, maxOutputTokens: 16384, cacheDir: c.fleetDir })).data; }
    catch (e) { log('Argon merge failed:', e.message); report = { headline: 'Argon merge failed; see comparison table.', error: e.message }; }
    mergeSecs = (Date.now() - t0) / 1000; }

  const run = {
    caseId, world: c.worldRel, worldSha: sha12(worldBuf), at: new Date().toISOString(), agent: FLEET_AGENT, agentModel: FLEET_MODEL, leadModel: 'gemini-4-argon',
    planNote, timings: { totalS: (Date.now() - tStart) / 1000, argonPlanS: planSecs, fleetWallS: fleetWallMs / 1000, sequentialEstimateS: seqMs / 1000,
      speedup: +(seqMs / Math.max(1, fleetWallMs)).toFixed(1), sandboxComputeS: sandboxComputeMs / 1000, argonMergeS: mergeSecs },
    agents: { dispatched: jobs.length, ok: jobs.filter((j) => j.ok).length, failed: jobs.filter((j) => !j.ok).map((j) => j.id),
      tokens: jobs.reduce((a, j) => a + (j.usage?.total || 0), 0) },
    codeDrift, comparison, report,
    jobs: jobs.map(({ id, type, witness, view, ok, status, wallMs, interactionId, environmentId, still, agentReply, error }) => ({ id, type, witness, view, ok, status, wallS: wallMs / 1000, interactionId, environmentId, still, interpretation: agentReply?.interpretation, error })),
  };
  writeJSON(path.join(c.fleetDir, 'run.json'), run);
  fs.writeFileSync(path.join(c.fleetDir, 'report.md'), reportMd(run));
  log(`done: ${run.agents.ok}/${run.agents.dispatched} agents ok, fleet wall ${run.timings.fleetWallS.toFixed(0)}s vs sequential ${run.timings.sequentialEstimateS.toFixed(0)}s (${run.timings.speedup}x)`);
  return run;
}

export function reportMd(run) {
  const r = run.report || {};
  const L = [`# Fleet verification — ${run.caseId}`, '', `World \`${run.world}\` (sha ${run.worldSha}) · ${run.at}`,
    `Lead: ${run.leadModel} · Workers: ${run.agents.dispatched} Managed Agents (${run.agent}, ${run.agentModel}) · ${run.agents.ok} ok`,
    `Fleet wall ${run.timings.fleetWallS.toFixed(0)} s vs sequential ${run.timings.sequentialEstimateS.toFixed(0)} s (${run.timings.speedup}×); Argon plan ${run.timings.argonPlanS.toFixed(0)} s, merge ${run.timings.argonMergeS.toFixed(0)} s`,
    '', `**${r.headline || ''}**`, ''];
  for (const [k, t] of [['agreements', 'Agreements'], ['disagreements', 'Disagreements'], ['sensitivities', 'Sensitivities'], ['failed_jobs', 'Failed jobs']]) if (r[k]?.length) { L.push(`## ${t}`); for (const x of r[k]) L.push(`- ${x}`); L.push(''); }
  if (r.finding_updates?.length) { L.push('## Finding updates'); for (const f of r.finding_updates) L.push(`- ${f.id} — ${f.effect}: ${f.note}`); L.push(''); }
  L.push('## Fleet vs local (machine comparison)', '| job | subject | metric | local | fleet | agree |', '|---|---|---|---|---|---|');
  for (const x of run.comparison) L.push(`| ${x.job} | ${x.subject} | ${x.metric} | ${x.local} | ${x.fleet} | ${x.agree === null ? '—' : x.agree ? 'yes' : 'NO'} |`);
  return L.join('\n') + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (k) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : null; };
  const caseId = a.find((x) => !x.startsWith('--') && a[a.indexOf(x) - 1]?.startsWith?.('--') !== true) || 'demo-full';
  const run = await runFleet({ caseId: a[0] && !a[0].startsWith('--') ? a[0] : caseId, max: Number(opt('max') || process.env.FLEET_MAX || 24),
    renders: !a.includes('--no-renders'), only: opt('only') ? opt('only').split(',') : null });
  console.log(JSON.stringify({ timings: run.timings, agents: run.agents, headline: run.report?.headline }, null, 2));
}
