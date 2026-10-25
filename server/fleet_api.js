// Sightline FLEET API: the Managed Agents verification fleet, as cached by argon/fleet.mjs.
// Mounted from server.js via mountFleet(app, ctx). Read-only; never calls Gemini.
//   GET /api/cases/:id/fleet                 → normalized summary of cases/<id>/cache/fleet/run.json + jobs/*.json
//   GET /api/cases/:id/fleet/renders/:view   → render still (png) from the same fleet dir
// Replay-mode demo clones (case.json { replay: true, replayOf }) use their own cache/fleet when it holds a run.json,
// else fall back to the source case's (source.fallback = true in the response).
import fs from 'node:fs';
import path from 'node:path';

export function mountFleet(app, ctx = {}) {
  const { ROOT } = ctx;
  const errMsg = ctx.errMsg || ((e) => (e && e.message) || String(e));
  const validId = (id) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(id || ''));
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const fleetDir = (id) => path.join(ROOT, 'cases', id, 'cache', 'fleet');
  const memo = new Map(); // dir -> { mtime, data }

  // Which case's fleet run to serve for :id.
  function resolve(id) {
    if (fs.existsSync(path.join(fleetDir(id), 'run.json'))) return { caseId: id, fallback: false };
    const m = readJson(path.join(ROOT, 'cases', id, 'case.json')) || {};
    const r = readJson(path.join(ROOT, 'cases', id, 'replay', 'replay.json')) || {};
    const src = m.replayOf || r.replayOf;
    if (src && validId(src) && src !== id && fs.existsSync(path.join(fleetDir(src), 'run.json'))) return { caseId: src, fallback: true };
    return null;
  }

  const human = (id) => {
    const s = String(id || '');
    let m;
    if ((m = s.match(/^wit_([A-Za-z0-9]+)$/))) return 'Witness ' + m[1];
    if ((m = s.match(/^veh_([A-Za-z0-9]+)$/))) return 'Vehicle ' + m[1];
    if ((m = s.match(/^veh_([A-Za-z0-9]+)_(.+)$/))) return `Vehicle ${m[1]} ${m[2].replace(/_/g, ' ')}`;
    if ((m = s.match(/^bld_(.+)$/))) return m[1].replace(/_/g, ' ') + ' building';
    if ((m = s.match(/^occ_(.+)$/))) return m[1].replace(/_/g, ' ');
    return s.replace(/_/g, ' ');
  };
  const num = (x, d = 1) => (Number.isFinite(+x) ? +(+x).toFixed(d) : null);
  const pct = (f) => (Number.isFinite(+f) ? Math.round(+f * 100) + '%' : '?');

  // Key number (short cell text + one-line long form) and a compact detail object per job type.
  function summarize(job, full) {
    const res = (full && full.result) || {};
    const r = job.type === 'render' ? res : (res.result || {});
    const out = { cell: '✓', line: '', detail: {} };
    try {
      switch (job.type) {
        case 'full_checks': {
          const cs = r.checks || [];
          out.cell = `${cs.length}/${cs.length}`;
          out.line = `${cs.length} checks re-run in the sandbox (${cs.filter((c) => c.pass).length} pass, ${cs.filter((c) => !c.pass).length} fail)`;
          out.detail.checks = cs.map((c) => ({ check: c.check, subject: c.subject, pass: !!c.pass, blockedBy: c.blockedBy || null }));
          break;
        }
        case 'sightline': {
          const a = r.at || {};
          out.cell = a.visible ? 'clear' : 'blocked';
          out.line = `${a.visible ? 'Clear line of sight' : 'Blocked by ' + human(a.blockedBy)} to ${human(r.target)} at t=${a.t} s (${num(a.distance)} m); visible in ${r.visibleSteps}/${r.steps} timeline steps`;
          out.detail = { target: r.target, t: a.t, visible: !!a.visible, blockedBy: a.blockedBy || null, distanceM: num(a.distance), visibleSteps: r.visibleSteps, steps: r.steps };
          break;
        }
        case 'robustness': {
          const s = r.standard || {};
          out.cell = `${s.blocked}/${s.samples}`;
          out.line = `${s.blocked} of ${s.samples} positions within ${s.radiusM} m blocked (${s.verdict})`;
          out.detail = { blockers: s.blockers || {}, rings: (r.rings || []).map((g) => ({ radiusM: g.radiusM, blocked: g.blocked, samples: g.samples })) };
          break;
        }
        case 'gaze': {
          const g = r.gaze || {};
          out.cell = `${num(g.offAxisDeg)}°`;
          out.line = `${human(r.target)} ${num(g.offAxisDeg)}° off-axis at t=${r.tObs} s (${g.peripheral ? 'peripheral' : 'central'} vision; gaze assumed toward ${g.source})`;
          out.detail = { altGazeDegByMark: r.altGazeDegByMark || {} };
          break;
        }
        case 'render': {
          const px = r.pixels;
          if (px) {
            out.cell = pct(px.visibleFraction);
            out.line = `${px.visiblePixels.toLocaleString('en-US')} of ${px.targetPixels.toLocaleString('en-US')} target pixels visible (software raster, item buffer) · ray-cast ${r.raycast && r.raycast.visible ? 'clear' : 'blocked'}`;
            out.detail = { blockers: (px.blockers || []).map((b) => ({ id: b.id, fraction: b.fraction })), rawVisibleFraction: px.rawVisibleFraction, renderMs: r.renderMs };
          } else {
            out.cell = `${r.frames || '?'} fr`;
            out.line = `${r.frames || '?'} frames at ${r.fps || '?'} fps, ${(r.size || []).join('×')}, rendered on CPU in ${num((r.renderMs || 0) / 1000)} s`;
            out.detail = { renderMs: r.renderMs };
          }
          break;
        }
        case 'whatif_time': {
          const sw = r.sweep || [];
          const allClear = sw.length && sw.every((x) => x.visible);
          out.cell = allClear ? 'clear' : (() => { const w = clearWindow(sw, r.tObs); return w ? `${w.from}–${w.to}` : 'blocked'; })();
          out.line = allClear ? `Visible across the whole sweep t=${sw[0].t}–${sw[sw.length - 1].t} s`
            : runs(sw).map((g) => `${g.visible ? 'clear' : 'blocked'} t=${g.from === g.to ? g.from : g.from + '–' + g.to} s${g.blockedBy ? ' (' + human(g.blockedBy) + ')' : ''}`).join('; ');
          out.detail = { sweep: sw.map((x) => ({ t: x.t, visible: !!x.visible, blockedBy: x.blockedBy || null })) };
          break;
        }
        case 'whatif_speed': {
          const sw = r.sweep || [];
          const firstK = sw.find((x) => x.visible);
          out.cell = firstK ? `k≥${firstK.k}` : 'blocked';
          out.line = firstK ? `At t=${r.tObs} s the view clears only if ${human(r.target)} was ×${firstK.k} or faster (${firstK.robustBlockedOf25}/25 positions still blocked); blocked for ×${sw[0].k}–${(sw[sw.indexOf(firstK) - 1] || sw[0]).k}`
            : `Blocked for every speed in the sweep ×${sw[0].k}–${sw[sw.length - 1].k}`;
          out.detail = { sweep: sw.map((x) => ({ k: x.k, visible: !!x.visible, robustBlockedOf25: x.robustBlockedOf25 })), note: r.note || null };
          break;
        }
        case 'prt': {
          const p = r.prt || [];
          const minS = Math.min(...p.map((x) => +x.availableS));
          out.cell = `${num(minS)} s`;
          out.line = p.map((x) => `${human(x.observerId)} → ${human(x.targetId)}: ${x.availableS} s available (${x.verdict})`).join('; ');
          out.detail = { prt: p.map((x) => ({ observerId: x.observerId, targetId: x.targetId, availableS: x.availableS, verdict: x.verdict })) };
          break;
        }
        default: break;
      }
    } catch { /* keep defaults */ }
    return out;
  }
  function runs(sweep) { // consecutive samples with the same visibility + blocker
    const out = [];
    for (const x of sweep) {
      const last = out[out.length - 1];
      if (last && last.visible === !!x.visible && last.blockedBy === (x.blockedBy || null)) last.to = x.t;
      else out.push({ visible: !!x.visible, blockedBy: x.blockedBy || null, from: x.t, to: x.t });
    }
    return out;
  }
  function clearWindow(sweep, tObs) {
    // contiguous visible run that ends just before tObs
    const before = sweep.filter((x) => x.t < tObs).sort((a, b) => a.t - b.t);
    let to = null, from = null;
    for (let i = before.length - 1; i >= 0; i--) { if (before[i].visible) { if (to == null) to = before[i].t; from = before[i].t; } else if (to != null) break; }
    return to == null ? null : { from, to };
  }

  // What-if insight: the witness whose stated moment is blocked but who was clear shortly before.
  function insight(jobsFull) {
    const wt = jobsFull.find((j) => j.type === 'whatif_time' && ((j.result || {}).result || {}).sweep && j.result.result.sweep.some((x) => x.dt === 0 && !x.visible));
    if (!wt) return null;
    const r = wt.result.result;
    const at = r.sweep.find((x) => x.dt === 0);
    const win = clearWindow(r.sweep, r.tObs);
    const ws = jobsFull.find((j) => j.type === 'whatif_speed' && j.witness === wt.witness);
    const sw = ws && ws.result && ws.result.result ? ws.result.result.sweep || [] : [];
    const k = sw.find((x) => x.visible && x.k > 1);
    const pctFaster = k ? Math.round((k.k - 1) * 100) : null;
    const W = human(wt.witness), T = human(r.target);
    const text = `${W} had a clear view t=${win ? win.from + '–' + win.to : '?'} s, but was blocked at the stated moment (${r.tObs} s) by ${human(at.blockedBy)}. `
      + (k ? `Only if ${T} was ≥${pctFaster}% faster does that view clear.` : `No speed in the sweep clears that view.`);
    return { witness: wt.witness, target: r.target, clearFrom: win && win.from, clearTo: win && win.to, blockedAt: r.tObs, blockedBy: at.blockedBy, minSpeedK: k ? k.k : null, pctFaster, jobs: [wt.id, ws && ws.id].filter(Boolean), text };
  }

  function build(srcId) {
    const dir = fleetDir(srcId);
    const runF = path.join(dir, 'run.json');
    const mtime = fs.statSync(runF).mtimeMs;
    const hit = memo.get(dir);
    if (hit && hit.mtime === mtime) return hit.data;
    const run = readJson(runF);
    if (!run) throw new Error('fleet run.json unreadable');
    const cmpBy = new Map((run.comparison || []).map((c) => [c.job, c]));
    const jobsFull = [];
    const jobs = (run.jobs || []).map((j) => {
      const full = readJson(path.join(dir, 'jobs', j.id + '.json')) || {};
      jobsFull.push({ ...j, result: full.result });
      const s = summarize(j, full);
      const c = cmpBy.get(j.id);
      const view = j.view || null;
      return {
        id: j.id, type: j.type, witness: j.witness || (view && view !== 'overhead' ? view : null), view,
        ok: !!j.ok, status: j.status, wallS: num(j.wallS, 0),
        tokens: (full.usage && full.usage.total) || null,
        environmentId: j.environmentId || null, interactionId: j.interactionId || null,
        interpretation: j.interpretation || (full.agentReply && full.agentReply.interpretation) || '',
        cell: s.cell, line: s.line, detail: s.detail,
        compare: c ? { metric: c.metric, local: c.local, fleet: c.fleet, agree: !!c.agree } : null,
        still: view && fs.existsSync(path.join(dir, 'renders', view + '.png')) ? `renders/${view}` : null,
      };
    });
    const cmp = run.comparison || [];
    const t = run.timings || {};
    const rep = run.report || {};
    const data = {
      at: run.at, world: run.world ? path.basename(run.world) : null, worldSha: run.worldSha || null,
      leadModel: run.leadModel, agent: run.agent, agentModel: run.agentModel, planNote: run.planNote || '',
      timings: { fleetWallS: t.fleetWallS, sequentialEstimateS: t.sequentialEstimateS, speedup: t.speedup, sandboxComputeS: t.sandboxComputeS, argonPlanS: t.argonPlanS, argonMergeS: t.argonMergeS },
      agents: { dispatched: (run.agents || {}).dispatched, ok: (run.agents || {}).ok, failed: ((run.agents || {}).failed || []).length, tokens: (run.agents || {}).tokens },
      agreement: { agree: cmp.filter((c) => c.agree).length, total: cmp.length },
      codeDrift: Array.isArray(run.codeDrift) ? run.codeDrift.length : null,
      headline: rep.headline || '',
      disagreements: rep.disagreements || [],
      findingUpdates: rep.finding_updates || [],
      insight: insight(jobsFull),
      jobs,
    };
    memo.set(dir, { mtime, data });
    return data;
  }

  app.get('/api/cases/:id/fleet', (req, res) => {
    const id = req.params.id;
    if (!validId(id) || !fs.existsSync(path.join(ROOT, 'cases', id))) return res.status(404).json({ error: 'no such case' });
    const src = resolve(id);
    if (!src) return res.status(404).json({ error: 'no verification fleet run for this case' });
    try {
      const data = build(src.caseId);
      res.json({ caseId: id, source: src, rendersBase: `/api/cases/${encodeURIComponent(id)}/fleet/`, ...data });
    } catch (e) { res.status(500).json({ error: `fleet summary failed: ${errMsg(e)}` }); }
  });

  app.get('/api/cases/:id/fleet/renders/:view', (req, res) => {
    const id = req.params.id, view = String(req.params.view || '').replace(/\.png$/i, '');
    if (!validId(id) || !/^[A-Za-z0-9_-]{1,40}$/.test(view)) return res.status(404).json({ error: 'not found' });
    const src = resolve(id);
    const f = src && path.join(fleetDir(src.caseId), 'renders', view + '.png');
    if (!f || !fs.existsSync(f)) return res.status(404).json({ error: 'no such render' });
    res.type('png').set('Cache-Control', 'public, max-age=300').sendFile(f);
  });
}
