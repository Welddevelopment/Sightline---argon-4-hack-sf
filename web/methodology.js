// Sightline METHODOLOGY panel (UI-A slice). Self-mounting; reads GET /api/cases/:id
// (provenance, validation, kinematicLabel, state.checks, state.loopLog) and renders a
// forensic-report style sheet: inputs, model runs, assumptions, equations, inferred values,
// validation against the published investigation, and what changed per loop round.
// Degrades gracefully: every section works with any subset of the CREDIBILITY v1 fields.
(() => {
  const params = new URLSearchParams(location.search);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const INFERRED = /inferred/i;
  const DEFAULTS = { prt: [1.0, 2.5], prtTypical: 1.5, mu: [0.6, 0.8], radiusM: 2, samples: 25, eyeJitterM: 0.1, fov: 60, peripheralDeg: 30, g: 9.81 };
  const KL_FALLBACK = 'Kinematic reconstruction: motion fitted to cited evidence; not a crash-physics simulation.';

  let data = null;          // last /api/cases/:id payload
  let loading = null;
  const caseId = () => new URLSearchParams(location.search).get('case') || params.get('case') || 'demo';

  async function load(force) {
    if (data && !force && data.caseId === caseId()) return data;
    if (loading && !force) return loading;
    loading = (async () => {
      const r = await fetch('/api/cases/' + encodeURIComponent(caseId()));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      data = await r.json();
      return data;
    })().finally(() => { loading = null; });
    return loading;
  }

  // ---------- formatting helpers ----------
  const fmtNum = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v)) ? (Math.abs(v) >= 100 ? v.toFixed(0) : String(+v.toFixed(d))) : (v == null ? '—' : esc(v));
  const fmtInt = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v.toLocaleString('en-US') : '—';
  const fmtBytes = (n) => (typeof n !== 'number') ? '—' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const fmtTime = (s) => { if (!s) return '—'; const d = new Date(s); return isNaN(d) ? esc(s) : d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC'); };
  const base = (p) => String(p || '').split(/[\\/]/).pop();
  const hash = (h, n = 16) => h ? `<span class="mth-hash" title="${esc(h)}">${esc(String(h).slice(0, n))}${String(h).length > n ? '…' : ''}</span>` : '<span class="mth-na">not recorded</span>';
  const fmtVal = (v) => Array.isArray(v) ? '(' + v.map((x) => fmtNum(x)).join(', ') + ')' : fmtNum(v);
  const withUnit = (v, u) => v == null ? '—' : `${fmtVal(v)}${u ? ' ' + esc(u) : ''}`;
  const fmtTol = (t, u) => t == null ? '—' : (typeof t === 'object' && !Array.isArray(t))
    ? Object.entries(t).map(([k, x]) => `± ${withUnit(x, u)} <span class="mth-muted">${esc(k)}</span>`).join('<br>') : '± ' + withUnit(t, u);
  const verRe = /_v(\d+)\.js$/;
  const worldVer = (w, p) => (p && p.version != null) ? p.version : ((String(w).match(verRe) || [])[1] ?? '?');

  // ---------- inferred values ----------
  function inferredFromWorld(world) {
    const out = [];
    if (!world) return out;
    for (const [id, o] of Object.entries(world.objects || {})) if (o && INFERRED.test(o.citation || '')) out.push({ id, label: o.label || id, citation: o.citation });
    for (const w of world.witnesses || []) if (w && INFERRED.test(w.citation || '')) out.push({ id: w.id, label: w.name || w.id, citation: w.citation });
    for (const f of world.facts || []) if (f && INFERRED.test(f.citation || '')) out.push({ id: f.id, label: f.text || f.id, value: f.value, unit: f.unit, citation: f.citation });
    for (const s of world.skids || []) if (s && INFERRED.test(s.citation || '')) out.push({ id: 'skid ' + (s.vehicle || ''), label: `Skid ${fmtNum(s.length)} m, μ ${fmtNum(s.mu)}`, citation: s.citation });
    return out;
  }
  // Source-text fallback when the world is not loaded in this page (e.g. cases.html).
  function inferredFromSource(src) {
    const out = [];
    const re = /citation\s*:\s*(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g;
    let m;
    while ((m = re.exec(src))) {
      const cit = m[2];
      if (!INFERRED.test(cit)) continue;
      const before = src.slice(Math.max(0, m.index - 600), m.index);
      const ids = [...before.matchAll(/(?:["'](\w+_\w[\w-]*)["']\s*:|\bid\s*:\s*["']([\w-]+)["'])/g)];
      const labels = [...before.matchAll(/\b(?:label|name|text)\s*:\s*(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g)];
      const id = ids.length ? (ids[ids.length - 1][1] || ids[ids.length - 1][2]) : '';
      const label = labels.length ? labels[labels.length - 1][2] : id || '(unnamed)';
      out.push({ id, label: label.replace(/\\(.)/g, '$1'), citation: cit.replace(/\\(.)/g, '$1') });
    }
    return out;
  }
  async function inferredValues(d) {
    const worldUrl = d.state && d.state.world;
    const sl = window.sl;
    if (sl && sl.world && sl.world.objects && (!worldUrl || !sl.worldUrl || sl.worldUrl === worldUrl)) return { items: inferredFromWorld(sl.world), from: 'loaded world' };
    if (!worldUrl) return { items: [], from: null };
    try { const src = await (await fetch(worldUrl)).text(); return { items: inferredFromSource(src), from: base(worldUrl) }; }
    catch { return { items: [], from: null, error: true }; }
  }

  // ---------- sections ----------
  function sectionLabel(n, title, sub) {
    return `<h3 class="mth-h"><span class="mth-n">${n}</span>${esc(title)}${sub ? `<span class="mth-hsub">${sub}</span>` : ''}</h3>`;
  }

  function validationBlock(v) {
    if (!v || !Array.isArray(v.items)) {
      return `<div class="mth-valid none"><div class="mth-valid-head"><span class="mth-badge">NOT VALIDATED</span>
        <span>No validation run is on file for this case (<span class="mono">cache/validation.json</span>). Values below are unverified against a published investigation.</span></div></div>`;
    }
    const total = v.total ?? v.items.length, matched = v.matched ?? v.items.filter((i) => i.pass).length;
    const ok = matched === total;
    const rows = v.items.map((i) => `<tr class="${i.pass ? 'pass' : 'fail'}">
      <td>${esc(i.label || i.id)}${i.note ? `<div class="mth-vnote">${esc(i.note)}</div>` : ''}</td><td class="num">${withUnit(i.expected, i.unit)}</td><td class="num">${i.actual == null ? '<span class="mth-na">not reached</span>' : withUnit(i.actual, i.unit)}</td>
      <td class="num">${fmtTol(i.tolerance, i.unit)}</td>
      <td class="res">${i.pass ? 'PASS' : 'FAIL'}</td><td class="cit">${esc(i.citation || '')}</td></tr>`).join('');
    return `<div class="mth-valid ${ok ? 'ok' : 'partial'}">
      <div class="mth-valid-head"><span class="mth-badge">${ok ? 'VALIDATED' : 'PARTIAL'}</span>
        <span>Validated against <b>${esc(v.source || 'published investigation')}</b>: <b>${fmtInt(matched)} of ${fmtInt(total)}</b> measured facts within tolerance${v.world ? ` <span class="mth-muted">(${esc(base(v.world))})</span>` : ''}.</span></div>
      <details class="mth-details"><summary>Show fact-by-fact comparison</summary>
        <div class="mth-tablewrap"><table class="mth-table"><thead><tr><th>Measured fact</th><th class="num">Expected</th><th class="num">Reconstruction</th><th class="num">Tolerance</th><th>Result</th><th>Citation</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="mth-na">No items.</td></tr>'}</tbody></table></div>
      </details></div>`;
  }

  function inputsBlock(d, provs) {
    const seen = new Map();
    for (const p of provs) for (const i of p.inputs || []) {
      const k = i.sha256 || i.file;
      if (!seen.has(k)) seen.set(k, { file: i.file, sha256: i.sha256, bytes: i.bytes, worlds: new Set() });
      seen.get(k).worlds.add('v' + worldVer(p.world, p));
    }
    const hashedNames = new Set([...seen.values()].map((x) => base(x.file)));
    const unhashed = (d.files || []).filter((f) => !hashedNames.has(f.name));
    const rows = [...seen.values()].map((x) => `<tr><td>${esc(base(x.file))}<div class="mth-path">${esc(x.file)}</div></td><td class="num">${fmtBytes(x.bytes)}</td><td>${hash(x.sha256, 20)}</td><td>${esc([...x.worlds].join(', '))}</td></tr>`)
      .concat(unhashed.map((f) => `<tr><td>${esc(f.name)}<div class="mth-path">evidence/${esc(f.name)} · ${esc(f.type || '')}</div></td><td class="num">${fmtBytes(f.size)}</td><td>${hash(null)}</td><td class="mth-muted">${seen.size ? 'not a model input' : '—'}</td></tr>`));
    return `<div class="mth-tablewrap"><table class="mth-table"><thead><tr><th>Evidence file</th><th class="num">Size</th><th>SHA-256</th><th>Used by</th></tr></thead>
      <tbody>${rows.join('') || '<tr><td colspan="4" class="mth-na">No evidence files on record.</td></tr>'}</tbody></table></div>
      ${seen.size ? '' : '<p class="mth-note">No provenance files were found for this case, so input hashes were not recorded.</p>'}`;
  }

  function runsBlock(d, provEntries, metaFallback) {
    if (!provEntries.length && !metaFallback.length) return '<p class="mth-na">No model run records (provenance) for this case.</p>';
    const rows = provEntries.map(([w, p]) => {
      const u = p.usage || {};
      return `<tr><td><b>v${esc(worldVer(w, p))}</b><div class="mth-path">${esc(base(w))}${p.parentWorld ? ' ← ' + esc(base(p.parentWorld)) : ''}</div></td>
        <td>${p.model ? esc(p.model) : `<span class="mth-na">${'no model call'}</span>`}<div class="mth-path">${esc(p.mode || '')}${p.finishReason ? ' · ' + esc(p.finishReason) : ''}</div></td>
        <td>${esc(base(p.promptFile) || '—')}<div class="mth-path">${p.promptVersion ? 'sha256 ' + hash(p.promptVersion, 12) : ''}</div></td>
        <td>${fmtTime(p.createdAt)}</td>
        <td class="num">${p.thinkingBudget == null ? '—' : fmtInt(p.thinkingBudget)}</td>
        <td class="num">${[u.promptTokens, u.outputTokens, u.thoughtsTokens].some((x) => x != null) ? `${fmtInt(u.promptTokens)} / ${fmtInt(u.outputTokens)} / ${fmtInt(u.thoughtsTokens)}` : '<span class="mth-na">not recorded</span>'}</td>
        <td class="num">${p.seconds == null ? '—' : fmtNum(p.seconds, 1) + ' s'}</td>
        <td>${hash(p.outputSha256, 12)}</td></tr>`;
    }).concat(metaFallback.map((m) => `<tr class="mth-fallback"><td><b>${esc(m.name)}</b><div class="mth-path">run metadata (no provenance file)</div></td>
        <td>${esc(m.model || '—')}<div class="mth-path">${esc(m.finishReason || '')}</div></td><td class="mth-na">not recorded</td><td>${fmtTime(m.at)}</td><td class="num">—</td>
        <td class="num">${fmtInt(m.usage && m.usage.promptTokenCount)} / ${fmtInt(m.usage && m.usage.candidatesTokenCount)} / ${fmtInt(m.usage && m.usage.thoughtsTokenCount)}</td>
        <td class="num">${m.seconds == null ? '—' : fmtNum(m.seconds, 1) + ' s'}</td><td class="mth-na">—</td></tr>`));
    return `<div class="mth-tablewrap"><table class="mth-table mth-runs"><thead><tr><th>World</th><th>Model</th><th>Prompt</th><th>Generated</th><th class="num">Thinking budget</th><th class="num">Tokens in / out / thought</th><th class="num">Latency</th><th>Output SHA-256</th></tr></thead>
      <tbody>${rows.join('')}</tbody></table></div>`;
  }

  function assumptionsFrom(checks) {
    const a = { ...DEFAULTS, src: {} };
    for (const c of checks || []) {
      if (c.range && Array.isArray(c.range.mu)) { a.mu = c.range.mu; a.src.mu = 1; }
      if (c.prt && Array.isArray(c.prt.rangeS)) { a.prt = c.prt.rangeS; if (c.prt.typicalS) a.prtTypical = c.prt.typicalS; a.src.prt = 1; }
      if (c.robustness) { if (c.robustness.radiusM) a.radiusM = c.robustness.radiusM; if (c.robustness.samples) a.samples = c.robustness.samples; if (c.robustness.eyeJitterM != null) a.eyeJitterM = c.robustness.eyeJitterM; a.src.rob = 1; }
      if (c.gaze && c.gaze.cameraFovDeg) { a.fov = c.gaze.cameraFovDeg; a.src.fov = 1; }
    }
    return a;
  }

  function assumptionsBlock(a) {
    const tag = (k) => a.src[k] ? '<span class="mth-src">as applied by checks</span>' : '<span class="mth-src def">standard default</span>';
    const rows = [
      ['Perception–reaction time (PRT)', `${fmtNum(a.prt[0], 1)}–${fmtNum(a.prt[1], 1)} s (typical ${fmtNum(a.prtTypical, 1)} s)`, 'Time a driver needs to perceive a hazard and begin braking. Available time below the range is insufficient; within it, marginal.', tag('prt')],
      ['Tire–road friction μ', `${fmtNum(a.mu[0], 2)}–${fmtNum(a.mu[1], 2)}`, 'Dry asphalt range used for skid-to-speed; results are reported as a range, never a single speed.', tag('mu')],
      ['Witness mark tolerance', `${fmtNum(a.radiusM)} m radius · ${a.samples} samples · eye ±${fmtNum(a.eyeJitterM)} m`, 'A position marked on an exhibit is not exact; the sightline is re-tested from points in a disc around the mark.', tag('rob')],
      ['Witness camera field of view', `${fmtNum(a.fov, 0)}° (peripheral beyond ${DEFAULTS.peripheralDeg}° off gaze)`, 'Eye-level renders use a 60° perspective camera; a target more than 30° from the gaze direction is flagged as peripheral.', tag('fov')],
      ['Gravitational acceleration g', `${DEFAULTS.g} m/s²`, 'Used in the skid equation.', '<span class="mth-src def">constant</span>'],
      ['Plausibility limits', '1.0 g · 5 m per 0.05 s · 60 m/s', 'Motion exceeding these outside ±0.5 s of impact is flagged as physically implausible.', '<span class="mth-src def">screening threshold</span>'],
    ];
    return `<table class="mth-table mth-assume"><tbody>${rows.map((r) => `<tr><th>${r[0]}</th><td class="val">${r[1]}</td><td>${esc(r[2])} ${r[3]}</td></tr>`).join('')}</tbody></table>`;
  }

  function equationsBlock(checks, a) {
    const skid = (checks || []).find((c) => c.range && Array.isArray(c.range.mph));
    const worked = skid ? `<div class="mth-worked">Applied: ${esc(skid.subject || 'skid')} — ${skid.range.mph.map((x) => fmtNum(x, 0)).join('–')} mph (${skid.range.mps.map((x) => fmtNum(x, 1)).join('–')} m/s) for μ ${skid.range.mu.join('–')}${skid.citation ? ` · <span class="mth-muted">${esc(skid.citation)}</span>` : ''}</div>` : '';
    return `<ol class="mth-eqs">
      <li><div class="mth-eq">v = <span class="mth-sqrt"><span>2 μ g d</span></span></div>
        <p>Minimum speed at the start of a skid of length <i>d</i> that brings the vehicle to rest, with friction <i>μ</i> and <i>g</i> = ${DEFAULTS.g} m/s². Evaluated at both ends of the friction range.</p>${worked}</li>
      <li><div class="mth-eq">sightline = ray( eye → target, t )</div>
        <p>A straight ray is cast from the witness's eye (marked position, eye height) to the target's centre at the observation time. The first occluding object it meets is reported. Repeated from ${a.samples} points within ${fmtNum(a.radiusM)} m of the mark: <i>robust</i> if blocked from all, <i>partial</i> if from some.</p></li>
      <li><div class="mth-eq">θ = arccos( <span class="mth-vec">ĝ</span> · <span class="mth-vec">t̂</span> )</div>
        <p>Angle between the direction the witness was looking (<span class="mth-vec">ĝ</span>) and the direction to the target (<span class="mth-vec">t̂</span>). A clear line of sight is reported as "had line of sight; target θ° from gaze", never as "could see".</p></li>
      <li><div class="mth-eq">t<sub>available</sub> ≥ PRT ?</div>
        <p>Time between the hazard becoming visible and impact, compared with the ${fmtNum(a.prt[0], 1)}–${fmtNum(a.prt[1], 1)} s reaction range.</p></li>
    </ol>`;
  }

  function inferredBlock(inf) {
    if (!inf.items.length) return `<p class="mth-na">${inf.error ? 'World source could not be read.' : 'No values in this reconstruction are marked as inferred; every object cites the evidence.'}</p>`;
    return `<p class="mth-note">Values not stated in the evidence but inferred by Argon to complete the scene. They are drawn in the viewer with the amber dashed <span class="mth-inf-tag">inferred</span> style.</p>
      <ul class="mth-inferred">${inf.items.map((i) => `<li><span class="mth-inf-tag">inferred</span> <b>${esc(i.label)}</b>${i.id && i.id !== i.label ? ` <span class="mth-path">${esc(i.id)}</span>` : ''}${i.value != null ? ` = ${withUnit(i.value, i.unit)}` : ''}<div class="mth-cit">${esc(i.citation)}</div></li>`).join('')}</ul>`;
  }

  function changesBlock(loopLog) {
    const rounds = Array.isArray(loopLog) ? loopLog : [];
    if (!rounds.length) return '<p class="mth-na">No loop rounds recorded.</p>';
    return `<ol class="mth-rounds">${rounds.map((r, i) => {
      const c = r.critique || {};
      const next = (r.patch && r.patch.world) || (c.patched && rounds[i + 1] && rounds[i + 1].world) || null;
      const patched = !!(next && next !== r.world) || c.patched === true;
      const head = patched ? `Argon patched <span class="mono">${esc(base(r.world))}</span> → <span class="mono">${esc(base(next) || 'next version')}</span>`
        : `No change to <span class="mono">${esc(base(r.world) || 'world')}</span>${c.verdict ? ` — verdict: ${esc(String(c.verdict).replace(/_/g, ' '))}` : ''}`;
      const changes = [].concat(r.changes || c.changes || (r.patch && r.patch.changes) || []).map((x) => typeof x === 'string' ? { what: x } : x || {});
      const finds = (r.findings || c.findings || []);
      const drivers = finds.filter((f) => f.status !== 'consistent');
      const ev = []; const seenEv = new Set();
      for (const f of (drivers.length ? drivers : finds)) for (const e of f.evidence || []) {
        const k = (e.source || '') + '|' + (e.citation || '');
        if (!seenEv.has(k)) { seenEv.add(k); ev.push(e); }
      }
      const err = r.error ? `<p class="mth-err">Round error: ${esc(r.error)}</p>` : '';
      const probs = (r.contractProblems || []).length ? `<p class="mth-err">Contract problems: ${esc(r.contractProblems.join('; '))}</p>` : '';
      return `<li><div class="mth-round-h"><span class="mth-round-n">Round ${esc(r.round ?? i + 1)}</span>${head}${r.finishedAt ? `<span class="mth-muted mth-round-t">${fmtTime(r.finishedAt)}</span>` : ''}</div>
        ${changes.length ? `<ul class="mth-changes">${changes.map((x) => `<li><b>${esc(x.what || x.summary || '')}</b>${x.why ? ` — ${esc(x.why)}` : ''}${x.citation ? ` <span class="mth-cit">${esc(x.citation)}</span>` : ''}</li>`).join('')}</ul>` : ''}
        ${c.summary ? `<p class="mth-why"><span class="mth-k">Why</span>${esc(c.summary)}</p>` : ''}
        ${drivers.length ? `<p class="mth-why"><span class="mth-k">Findings</span>${drivers.map((f) => `${esc(f.id || '')} ${esc(f.summary || '')}`).join('<br>')}</p>` : ''}
        ${ev.length ? `<div class="mth-evid"><span class="mth-k">Cited evidence</span><ul>${ev.slice(0, 10).map((e) => `<li><span class="mth-src-name">${esc(e.source || '')}</span> ${esc(e.citation || '')}</li>`).join('')}${ev.length > 10 ? `<li class="mth-muted">+ ${ev.length - 10} more</li>` : ''}</ul></div>` : ''}
        ${probs}${err}</li>`;
    }).join('')}</ol>`;
  }

  // Fallback run metadata (Argon cache meta files) when no provenance exists.
  async function metaFallback(id, loopLog) {
    const names = ['generate_world'].concat((loopLog || []).map((r, i) => 'critique_round' + (r.round ?? i + 1)));
    const out = [];
    await Promise.all(names.map(async (n, i) => {
      try {
        const r = await fetch(`/cases/${encodeURIComponent(id)}/cache/${n}.meta.json`);
        if (r.ok) { const m = await r.json(); out[i] = { ...m, name: n.replace('_', ' ') }; }
      } catch { /* none */ }
    }));
    return out.filter(Boolean);
  }

  async function render(d) {
    const st = d.state || {};
    const checks = st.checks || [];
    const provEntries = Object.entries(d.provenance || {}).sort((a, b) => (Number(worldVer(a[0], a[1])) || 0) - (Number(worldVer(b[0], b[1])) || 0));
    const provs = provEntries.map((e) => e[1]);
    const [inf, meta] = await Promise.all([inferredValues(d), provEntries.length ? [] : metaFallback(d.caseId, st.loopLog)]);
    const a = assumptionsFrom(checks);
    const kl = d.kinematicLabel || KL_FALLBACK;
    const nInf = inf.items.length;
    return `<article class="mth-sheet" role="document">
      <header class="mth-top">
        <div class="mth-kicker">Sightline · Methodology statement</div>
        <h2 class="mth-title">${esc(d.title || d.caseId)}</h2>
        <div class="mth-meta"><span>Case <span class="mono">${esc(d.caseId)}</span></span>${st.world ? `<span>Reconstruction <span class="mono">${esc(base(st.world))}</span></span>` : ''}${st.updatedAt ? `<span>Updated ${fmtTime(st.updatedAt)}</span>` : ''}<span>Mode ${esc(st.mode || '—')}</span></div>
        <div class="mth-kin"><span class="mth-kin-l">KINEMATIC</span>${esc(kl)}</div>
      </header>
      <section>${sectionLabel('A', 'Validation', 'against the published investigation')}${validationBlock(d.validation)}</section>
      <section>${sectionLabel(1, 'Inputs', 'evidence supplied to the model')}${inputsBlock(d, provs)}</section>
      <section>${sectionLabel(2, 'Model runs', 'one row per world version')}${runsBlock(d, provEntries, meta)}</section>
      <section>${sectionLabel(3, 'Assumptions')}${assumptionsBlock(a)}</section>
      <section>${sectionLabel(4, 'Equations and tests')}${equationsBlock(checks, a)}</section>
      <section>${sectionLabel(5, 'Inferred values', nInf ? `${nInf} not stated in the evidence` : '')}${inferredBlock(inf)}</section>
      <section>${sectionLabel(6, 'What changed', 'Argon loop, round by round')}${changesBlock(st.loopLog)}</section>
      <footer class="mth-foot">Witness accounts in the demo case are fictional. Every value in the reconstruction carries a citation; independent checks are deterministic geometry and physics, not model output.</footer>
    </article>`;
  }

  // ---------- modal ----------
  let modal = null;
  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'mthModal'; modal.className = 'mth-modal'; modal.hidden = true;
    modal.innerHTML = `<div class="mth-backdrop" data-close="1"></div><div class="mth-scroll" data-close="1"><div class="mth-bar"><button class="mth-print" type="button">Print</button><button class="mth-close" type="button" aria-label="Close methodology">Close</button></div><div class="mth-body"></div></div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target.dataset && e.target.dataset.close) close(); });
    modal.querySelector('.mth-close').onclick = close;
    modal.querySelector('.mth-print').onclick = () => window.print();
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) close(); });
    return modal;
  }
  function close() { if (modal) { modal.hidden = true; document.documentElement.classList.remove('mth-open'); } }
  async function open() {
    const m = ensureModal();
    const body = m.querySelector('.mth-body');
    body.innerHTML = '<article class="mth-sheet"><p class="mth-na">Loading methodology…</p></article>';
    m.hidden = false; document.documentElement.classList.add('mth-open');
    try { body.innerHTML = await render(await load(true)); updateSummary(); }
    catch (e) { body.innerHTML = `<article class="mth-sheet"><p class="mth-err">Could not load case data: ${esc(e.message)}</p></article>`; }
    m.querySelector('.mth-scroll').scrollTop = 0;
  }

  // ---------- mount points ----------
  function summaryText(d) {
    const v = d && d.validation;
    if (v && Array.isArray(v.items)) {
      const total = v.total ?? v.items.length, matched = v.matched ?? v.items.filter((i) => i.pass).length;
      return { cls: matched === total ? 'ok' : 'partial', html: `Validated against ${esc(v.source || 'published facts')}: <b>${matched} of ${total}</b> within tolerance` };
    }
    return { cls: 'none', html: 'Not validated against a published investigation' };
  }
  function updateSummary() {
    for (const el of document.querySelectorAll('.mth-sum')) { const s = summaryText(data); el.className = 'mth-sum ' + s.cls; el.innerHTML = s.html; }
  }
  function makeBar(compact) {
    const bar = document.createElement('div');
    bar.className = 'mth-launch' + (compact ? ' compact' : '');
    bar.innerHTML = `<button type="button" class="btn small mth-btn">Methodology</button><span class="mth-sum none">…</span>`;
    bar.querySelector('button').onclick = open;
    return bar;
  }

  function mountViewer() {
    const findings = document.getElementById('findings');
    if (!findings || document.getElementById('mthLaunch')) return;
    const bar = makeBar(false); bar.id = 'mthLaunch';
    // Prefer the top of the findings panel so the validation summary is visible without scrolling.
    const head = findings.parentElement && findings.parentElement.querySelector(':scope > h2');
    if (head) { bar.classList.add('top'); head.insertAdjacentElement('afterend', bar); }
    else findings.insertAdjacentElement('afterend', bar);
    load().then(updateSummary, () => { const s = bar.querySelector('.mth-sum'); s.textContent = ''; });
  }
  function mountCases() {
    const content = document.getElementById('content');
    if (!content) return;
    const tryMount = () => {
      const actions = content.querySelector('.actions');
      if (!actions || actions.querySelector('.mth-btn')) return;
      if (!new URLSearchParams(location.search).get('case')) return;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn mth-btn'; b.textContent = 'Methodology';
      b.onclick = open;
      const run = actions.querySelector('#runBtn');
      actions.insertBefore(b, run ? run.nextSibling : null);
      data = null; // case may have changed; reload on open
    };
    new MutationObserver(tryMount).observe(content, { childList: true, subtree: true });
    tryMount();
  }

  window.slMethodology = { open, close, reload: () => load(true).then(updateSummary) };
  const boot = () => { mountViewer(); mountCases(); if (params.get('methodology') === '1') open(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
