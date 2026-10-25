// web/fleet.js — "Verification fleet" panel in the viewer's findings column.
// Shows the cached Managed Agents fleet run for the case (GET /api/cases/:id/fleet, server/fleet_api.js):
// lede line, a witness × check grid of the jobs (status, key number, agreement with the local check), the what-if
// insight, and per-job details on click. Replay demo clones get the source case's run via the API fallback.
// Plain script, no imports; injects /fleet.css; appears only once the findings list has findings.
// Semantic classes only: .panel.fleet-panel, .fleet-*.
(function () {
  'use strict';
  if (/[?&]clean=1/.test(location.search)) return;
  if (!document.getElementById('findings')) return;

  if (!document.querySelector('link[href="/fleet.css"]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/fleet.css'; document.head.appendChild(l);
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const caseId = () => new URLSearchParams(location.search).get('case') || 'demo';
  const human = (id) => {
    const s = String(id || ''); let m;
    if ((m = s.match(/^wit_([A-Za-z0-9]+)$/))) return 'Witness ' + m[1];
    if ((m = s.match(/^veh_([A-Za-z0-9]+)$/))) return 'Vehicle ' + m[1];
    if ((m = s.match(/^veh_([A-Za-z0-9]+)_(.+)$/))) return `Vehicle ${m[1]} ${m[2].replace(/_/g, ' ')}`;
    if ((m = s.match(/^bld_(.+)$/))) return m[1].replace(/_/g, ' ') + ' building';
    if ((m = s.match(/^occ_(.+)$/))) return m[1].replace(/_/g, ' ');
    return s.replace(/_/g, ' ');
  };
  const fmtDur = (s) => { s = Math.round(+s || 0); const m = Math.floor(s / 60); return m ? `${m} min ${s % 60} s` : `${s} s`; };
  const fmtK = (n) => (n >= 1000 ? Math.round(n / 1000) + 'k' : String(n || 0));

  const COLS = [
    { key: 'sightline', label: 'Sight', title: 'Ray-cast sightline at the stated moment' },
    { key: 'robustness', label: 'Robust', title: 'Positions blocked of 25 within 2 m of the mark' },
    { key: 'gaze', label: 'Gaze', title: 'Target angle off the assumed gaze' },
    { key: 'render', label: 'Pixels', title: 'Software render: share of target pixels visible' },
    { key: 'whatif', label: 'What-if', title: 'Time (±2 s) and speed (×0.7–1.3) sweeps' },
  ];
  const TYPE_LABEL = { full_checks: 'Full check suite', prt: 'Perception-reaction time', sightline: 'Sightline', robustness: 'Robustness disc', gaze: 'Gaze angle', render: 'Software render', whatif_time: 'What-if: time ±2 s', whatif_speed: 'What-if: speed ×k' };

  let data = null, loading = false, loadedFor = null, openJob = null;

  function load() {
    const id = caseId();
    if (loading || loadedFor === id) return;
    loading = true;
    fetch('/api/cases/' + encodeURIComponent(id) + '/fleet')
      .then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((d) => { data = d && Array.isArray(d.jobs) && d.jobs.length ? d : null; loadedFor = id; loading = false; paint(); });
  }

  function hasFindings() { return !!document.querySelector('#findings .finding'); }

  function ensureBox() {
    let box = document.getElementById('fleet');
    if (!box) {
      const f = document.getElementById('findings');
      if (!f || !f.parentNode) return null;
      box = document.createElement('section');
      box.id = 'fleet';
      box.className = 'panel fleet-panel';
      box.setAttribute('aria-label', 'Verification fleet');
      f.parentNode.insertBefore(box, f.nextSibling);
      box.addEventListener('click', onClick);
    }
    return box;
  }

  function cellBtn(j, extraCls = '') {
    const agree = j.compare ? (j.compare.agree ? 'agree' : 'differ') : 'new';
    const markTxt = agree === 'agree' ? '= local' : agree === 'differ' ? '≠ local' : 'new';
    const tip = `${j.id} · ${TYPE_LABEL[j.type] || j.type}${j.compare ? ` · local ${j.compare.local} / fleet ${j.compare.fleet}` : ' · no local counterpart'}`;
    return `<button type="button" class="fleet-cell fleet-${agree}${j.ok ? '' : ' fleet-failed'}${openJob === j.id ? ' fleet-open' : ''}${extraCls ? ' ' + extraCls : ''}" data-job="${esc(j.id)}" title="${esc(tip)}">`
      + `<span class="fleet-num">${esc(j.cell)}</span><span class="fleet-mark"><span class="fleet-ok" aria-label="${j.ok ? 'completed' : 'failed'}">${j.ok ? '✓' : '✕'}</span> ${markTxt}</span></button>`;
  }

  function grid(d) {
    const byW = new Map();
    const caseWide = [];
    for (const j of d.jobs) {
      const w = j.witness;
      if (!w) { caseWide.push(j); continue; }
      if (!byW.has(w)) byW.set(w, {});
      const col = /^whatif/.test(j.type) ? 'whatif' : j.type;
      const row = byW.get(w);
      (row[col] = row[col] || []).push(j);
    }
    const wits = [...byW.keys()].sort();
    const head = `<tr><th scope="col" class="fleet-rowhead"><span class="fleet-sr">Witness</span></th>${COLS.map((c) => `<th scope="col" title="${esc(c.title)}">${esc(c.label)}</th>`).join('')}</tr>`;
    const rows = wits.map((w) => {
      const row = byW.get(w);
      const short = String(w).replace(/^wit_/, '');
      return `<tr><th scope="row" class="fleet-rowhead" title="${esc(human(w))}">${esc(short)}</th>${COLS.map((c) => {
        const js = (row[c.key] || []).sort((a, b) => (a.type < b.type ? 1 : -1)); // time before speed
        return `<td>${js.length ? js.map((j) => cellBtn(j, js.length > 1 ? 'fleet-stack' : '')).join('') : '<span class="fleet-none" title="Not planned by Argon for this witness">·</span>'}</td>`;
      }).join('')}</tr>`;
    }).join('');
    const label = (j) => (j.type === 'full_checks' ? 'Full suite' : j.type === 'prt' ? 'PRT' : j.type === 'render' ? 'Overhead' : (TYPE_LABEL[j.type] || j.type));
    const cw = caseWide.length ? `<div class="fleet-casewide"><span class="fleet-cw-label">Case-wide</span>${caseWide.map((j) =>
      `<span class="fleet-cw-item"><span class="fleet-cw-name">${esc(label(j))}</span>${cellBtn(j)}</span>`).join('')}</div>` : '';
    return `<table class="fleet-grid">${head}${rows}</table>${cw}`;
  }

  function sweepStrip(sweep, kind, mark) {
    return `<div class="fleet-strip" role="img" aria-label="${esc(kind === 'time' ? 'Visibility by time' : 'Visibility by speed multiplier')}">${sweep.map((x) => {
      const lab = kind === 'time' ? x.t : '×' + x.k;
      const at = kind === 'time' ? x.t === mark : x.k === 1;
      return `<span class="fleet-step ${x.visible ? 'fleet-clear' : 'fleet-blocked'}${at ? ' fleet-at' : ''}" title="${esc(`${lab}${kind === 'time' ? ' s' : ''}: ${x.visible ? 'clear' : 'blocked' + (x.blockedBy ? ' by ' + human(x.blockedBy) : '')}`)}"><i></i><b>${esc(lab)}</b></span>`;
    }).join('')}</div>`;
  }

  function insightHtml(d) {
    const ins = d.insight;
    if (!ins) return '';
    const wt = d.jobs.find((j) => j.id === ins.jobs[0]);
    const strip = wt && wt.detail && wt.detail.sweep ? sweepStrip(wt.detail.sweep, 'time', ins.blockedAt) : '';
    const faster = ins.pctFaster != null ? `only a ≥${ins.pctFaster}% faster ${esc(human(ins.target))} clears it` : 'no speed in the sweep clears it';
    return `<div class="fleet-insight"><div class="fleet-insight-text"><span class="fleet-kicker">What-if</span> ${esc(human(ins.witness))} clear t=${esc(ins.clearFrom)}–${esc(ins.clearTo)} s, blocked at ${esc(ins.blockedAt)} s by ${esc(human(ins.blockedBy))}; ${faster}.</div>${strip}</div>`;
  }

  function detailHtml(d, j) {
    if (!j) return '';
    const dt = j.detail || {};
    let extra = '';
    if (j.type === 'robustness' && dt.rings) {
      extra = `<div class="fleet-rings">${dt.rings.map((r) => `<span title="${esc(`${r.blocked}/${r.samples} blocked at ${r.radiusM} m`)}"><b>${esc(r.radiusM)} m</b>${esc(r.blocked)}/${esc(r.samples)}</span>`).join('')}</div>`
        + (Object.keys(dt.blockers || {}).length ? `<div class="fleet-dline muted">Blockers at 2 m: ${Object.entries(dt.blockers).map(([k, v]) => `${esc(human(k))} ${esc(v)}`).join(', ')}</div>` : '');
    } else if (j.type === 'whatif_time' && dt.sweep) {
      extra = sweepStrip(dt.sweep, 'time', (dt.sweep.find((x, i, a) => i === Math.floor(a.length / 2)) || {}).t);
    } else if (j.type === 'whatif_speed' && dt.sweep) {
      extra = sweepStrip(dt.sweep, 'speed') + (dt.note ? `<div class="fleet-dline muted">${esc(dt.note)}</div>` : '');
    } else if (j.type === 'full_checks' && dt.checks) {
      extra = `<ul class="fleet-checks">${dt.checks.map((c) => `<li class="${c.pass ? 'fleet-pass' : 'fleet-fail'}">${esc(c.check)} <span class="muted">${esc(c.subject || '')}</span> <b>${c.pass ? 'pass' : 'fail'}</b></li>`).join('')}</ul>`;
    } else if (j.type === 'gaze' && dt.altGazeDegByMark) {
      extra = `<div class="fleet-dline muted">If gazing at another mark: ${Object.entries(dt.altGazeDegByMark).map(([k, v]) => `${esc(k.replace(/^mark_/, ''))} ${esc(v)}°`).join(' · ')}</div>`;
    } else if (j.type === 'prt' && dt.prt) {
      extra = `<ul class="fleet-checks">${dt.prt.map((p) => `<li class="fleet-pass">${esc(human(p.observerId))} → ${esc(human(p.targetId))} <b>${esc(p.availableS)} s</b></li>`).join('')}</ul><div class="fleet-dline muted">Typical perception-reaction range 1.0–2.5 s.</div>`;
    }
    const img = j.still ? `<img class="fleet-still" src="${esc(d.rendersBase + j.still)}" alt="${esc(`Sandbox software render, ${j.view === 'overhead' ? 'overhead view' : human(j.view) + ' view'}`)}" loading="lazy">` : '';
    const cmp = j.compare
      ? `<div class="fleet-dline fleet-${j.compare.agree ? 'agree' : 'differ'}-txt">${j.compare.agree ? 'Agrees with' : 'Differs from'} local check · ${esc(j.compare.metric)}: local <span class="mono">${esc(j.compare.local)}</span>, fleet <span class="mono">${esc(j.compare.fleet)}</span></div>`
      : `<div class="fleet-dline fleet-new-txt">New evidence · no local counterpart to compare</div>`;
    return `<div class="fleet-detail-head"><span><b class="mono">${esc(j.id)}</b> · ${esc(TYPE_LABEL[j.type] || j.type)}${j.witness ? ' · ' + esc(human(j.witness)) : ''}</span><button type="button" class="fleet-close" data-close aria-label="Close job details">×</button></div>
      <div class="fleet-dline">${esc(j.line)}</div>
      ${cmp}${extra}${img}
      ${j.interpretation ? `<blockquote class="fleet-agent"><span class="muted">Sandbox agent (${esc(d.agentModel || 'Flash')}):</span> ${esc(j.interpretation)}</blockquote>` : ''}
      <div class="fleet-meta mono">${j.ok ? '✓ ' + esc(j.status || 'completed') : '✕ failed'} · ${esc(j.wallS)} s wall${j.tokens ? ' · ' + fmtK(j.tokens) + ' tokens' : ''}${j.environmentId ? ' · sandbox ' + esc(String(j.environmentId).slice(0, 8)) + '…' : ''}</div>`;
  }

  function moreHtml(d) {
    const t = d.timings || {}, a = d.agents || {};
    const dis = (d.disagreements || []).map((x) => `<li>${esc(x)}</li>`).join('');
    return `<details class="fleet-more"><summary>How this was run</summary>
      <ul class="fleet-facts">
        <li>Argon read the case state and planned ${esc(a.dispatched)} jobs in ${esc(Math.round(t.argonPlanS || 0))} s; each ran as its own Managed Agent (${esc(d.agent)}, ${esc(d.agentModel)}) in a separate sandbox with the repo mounted and the exact world file uploaded.</li>
        <li>Results were pulled as JSON from each sandbox (not the agent's transcription) and machine-compared to the local checks: ${esc(d.agreement.agree)}/${esc(d.agreement.total)} metrics agree. Checks code drift vs. local: ${d.codeDrift === 0 ? 'none' : esc(d.codeDrift)}.</li>
        <li>Fleet wall ${esc(fmtDur(t.fleetWallS))} vs ${esc(fmtDur(t.sequentialEstimateS))} summed (${esc(t.speedup)}×) · sandbox compute ${esc(Math.round(t.sandboxComputeS || 0))} s · ${esc(fmtK(a.tokens))} tokens · Argon merge ${esc(Math.round(t.argonMergeS || 0))} s.</li>
        <li class="muted">World ${esc(d.world || '')} · sha ${esc(d.worldSha || '')} · run ${esc((d.at || '').replace('T', ' ').slice(0, 16))} UTC${d.source && d.source.fallback ? ` · recorded on case ${esc(d.source.caseId)}` : ''}</li>
      </ul>
      ${dis ? `<div class="fleet-sub">Flagged by Argon when merging</div><ul class="fleet-flags">${dis}</ul>` : ''}
    </details>`;
  }

  function paint() {
    const existing = document.getElementById('fleet');
    if (!data || !hasFindings()) { if (existing) existing.hidden = true; return; }
    const box = ensureBox();
    if (!box) return;
    box.hidden = false;
    const d = data, t = d.timings || {}, a = d.agents || {};
    const seqMin = Math.round((t.sequentialEstimateS || 0) / 60);
    const okAll = a.ok === a.dispatched && !a.failed;
    const job = openJob && d.jobs.find((j) => j.id === openJob);
    box.innerHTML = `<div class="fleet-head"><h3 class="fleet-title">Verification fleet</h3><span class="fleet-badge${d.agreement.agree === d.agreement.total ? '' : ' fleet-badge-warn'}" title="Fleet results machine-compared with the local checks">${esc(d.agreement.agree)}/${esc(d.agreement.total)} agree with local checks</span></div>
      <p class="fleet-lede">Independently verified by <b>${esc(a.dispatched)} sandboxed agents</b> in parallel · <b>${esc(fmtDur(t.fleetWallS))}</b> (vs ~${esc(seqMin)} min sequential) · planned and merged by <span class="mono">${esc(d.leadModel || 'gemini-4-argon')}</span></p>
      ${grid(d)}
      <div class="fleet-legend"><span>${okAll ? '✓' : '!'} ${esc(a.ok)}/${esc(a.dispatched)} completed</span><span><i class="fleet-key fleet-agree"></i>= local: matches the local check</span><span><i class="fleet-key fleet-new"></i>new: no local counterpart</span></div>
      ${insightHtml(d)}
      <div class="fleet-detail"${job ? '' : ' hidden'}>${detailHtml(d, job)}</div>
      ${moreHtml(d)}`;
  }

  function onClick(ev) {
    if (ev.target.closest('[data-close]')) { openJob = null; paint(); return; }
    const b = ev.target.closest('.fleet-cell');
    if (!b) return;
    openJob = openJob === b.dataset.job ? null : b.dataset.job;
    const moreOpen = document.querySelector('#fleet .fleet-more[open]');
    paint();
    if (moreOpen) { const m = document.querySelector('#fleet .fleet-more'); if (m) m.open = true; }
    const det = document.querySelector('#fleet .fleet-detail');
    if (det && !det.hidden && det.scrollIntoView) det.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Findings are rendered (and re-rendered) by ui.js; follow them.
  let pending = false;
  const mo = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (loadedFor !== caseId()) load();
      const box = document.getElementById('fleet');
      if (!box || box.hidden !== !(data && hasFindings())) paint();
    });
  });
  const start = () => { mo.observe(document.getElementById('findings'), { childList: true }); load(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
