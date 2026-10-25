// Sightline demo UI. Works standalone (world from ?world=) and with the /api/* server.
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const CLEAN = params.get('clean') === '1';
const CASE = params.get('case') || '';            // per-case mode (cases/<id>); empty = legacy demo endpoints
const CASE_API = CASE ? '/api/cases/' + encodeURIComponent(CASE) : '';
let caseInfo = null;                              // GET /api/cases/:id payload
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let sl = window.sl;
let state = null;         // /api/state payload
let findings = [];
let docs = [];            // { name, file, text }
let playing = false;
let lastTs = 0;
let speed = 1;
let draggingScrub = false;

// ---------- toast ----------
let toastTimer = null;
function toast(msg, ms = 3200) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- deposition video ----------
const depo = $('depo');
function parseTimecode(s) {
  if (typeof s === 'number') return s;
  const parts = String(s).trim().split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}
function seekDepo(tc) {
  const secs = parseTimecode(tc);
  if (secs == null) return;
  const go = () => { depo.currentTime = secs; depo.play().catch(() => {}); };
  expandDepo(true);
  $('depoTc').textContent = fmtTc(secs);
  if (depo.readyState >= 1) go(); else { depo.addEventListener('loadedmetadata', go, { once: true }); depo.load(); }
  toast('Deposition video @ ' + fmtTc(secs));
}
function expandDepo(on) {
  $('depoWrap').classList.toggle('expanded', !!on);
  $('depoBackdrop').hidden = !on;
  $('depoClose').hidden = !on;
  $('depoExpand').hidden = !!on;
}
$('depoExpand').onclick = () => expandDepo(true);
$('depoClose').onclick = () => expandDepo(false);
$('depoBackdrop').onclick = () => expandDepo(false);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') expandDepo(false); });
depo.addEventListener('timeupdate', () => { $('depoTc').textContent = fmtTc(depo.currentTime); });
function fmtTc(s) { s = Math.round(s); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
window.seekDepo = seekDepo;
depo.addEventListener('error', () => { $('depoNote').textContent = 'Deposition video not available yet (/deposition/out/deposition.mp4).'; });
$('seekBtn').onclick = () => { if ($('seekInput').value) seekDepo($('seekInput').value); };

// ---------- documents ----------
const DEFAULT_DOCS = ['facts.md', 'police_report.md', 'witness_b.md'];
function prettyName(f) {
  return f.replace(/\.md$/, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
async function loadCaseDocs() {
  const ul = $('docs');
  ul.innerHTML = '';
  docs = [];
  const files = (caseInfo && caseInfo.files) || [];
  const vid = files.find((f) => f.type === 'video');
  if (vid) { depo.src = vid.url; $('depoNote').textContent = vid.name; } else { depo.removeAttribute('src'); depo.style.display = 'none'; $('depoNote').textContent = 'No video in this case.'; }
  for (const f of files) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dn">${esc(f.name)}</span><span class="df">${esc(f.type)}${f.pages ? ' · ' + f.pages + ' pp' : ''}</span>`;
    if (f.textUrl) {
      const d = { name: f.name, file: f.name, text: null, textUrl: f.textUrl };
      docs.push(d);
      li.onclick = async () => {
        if (d.text == null) { try { d.text = await (await fetch(d.textUrl)).text(); } catch (_) { d.text = '(could not load text)'; } }
        openDoc(d);
      };
    } else if (f.type === 'image') li.onclick = () => openImage(f.url, f.name);
    else if (f.type === 'video') li.onclick = () => { depo.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
    else li.onclick = () => window.open(f.url, '_blank');
    ul.appendChild(li);
  }
  if (!files.length) ul.innerHTML = '<li class="muted">No evidence files.</li>';
}
async function loadDocs() {
  if (CASE) return loadCaseDocs();
  let files = [];
  try {
    const r = await fetch('/case/case.json');
    if (r.ok) {
      const j = await r.json();
      const arr = Array.isArray(j) ? j : (j.docs || j.documents || j.files || j.index || []);
      const flat = Array.isArray(arr) ? arr : Object.values(arr);
      for (const d of flat) {
        const f = typeof d === 'string' ? d : (d.file || d.path || d.name || d.href);
        if (f && /\.md$/i.test(f)) files.push(f.split('/').pop());
      }
      if (j.title && $('caseTitle').textContent === 'Sightline') $('caseTitle').textContent = j.title;
    }
  } catch (_) {}
  if (!files.length) files = DEFAULT_DOCS;
  files = [...new Set(files)];
  const got = await Promise.all(files.map(async (f) => {
    try {
      const r = await fetch('/case/' + f);
      if (!r.ok) return null;
      const text = await r.text();
      if (/^\s*<!doctype html|^\s*<html/i.test(text)) return null;
      return { name: prettyName(f), file: f, text };
    } catch (_) { return null; }
  }));
  docs = got.filter(Boolean);
  const ul = $('docs');
  ul.innerHTML = '';
  if (!docs.length) { ul.innerHTML = '<li class="muted">No case documents served.</li>'; return; }
  for (const d of docs) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dn">${esc(d.name)}</span><span class="df">/case/${esc(d.file)}</span>`;
    li.onclick = () => openDoc(d);
    ul.appendChild(li);
  }
  const ex = document.createElement('li');
  ex.innerHTML = '<span class="dn">Map exhibit</span><span class="df">/case/exhibits/map.png</span>';
  ex.onclick = () => openImage('/case/exhibits/map.png', 'Map exhibit');
  ul.appendChild(ex);
}
function openDoc(d, needle) {
  $('docTitle').textContent = d.name;
  const body = $('docBody');
  body.textContent = d.text;
  $('docview').hidden = false;
  body.scrollTop = 0;
  if (needle) {
    const i = d.text.toLowerCase().indexOf(needle.toLowerCase());
    if (i >= 0) {
      // best-effort anchor: scroll proportionally to the match position, then highlight it
      const frac = i / Math.max(1, d.text.length);
      const host = body.closest('#docview') || body;
      const target = body.scrollHeight > body.clientHeight ? body : host;
      target.scrollTop = Math.max(0, frac * target.scrollHeight - 60);
    }
  }
}
function openImage(src, title) {
  $('docTitle').textContent = title;
  $('docBody').innerHTML = `<img src="${esc(src)}" alt="${esc(title)}" style="max-width:100%">`;
  $('docview').hidden = false;
}
$('docClose').onclick = () => { $('docview').hidden = true; };

// ---------- citations ----------
function openCitation(text) {
  const c = String(text);
  const m = c.match(/depo\w*\.?\s*(?:@\s*|p\.?\s*)?(\d+):(\d+)(?::(\d+))?/i);
  if (m) {
    const secs = m[3] != null ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
    seekDepo(secs);
    return;
  }
  const lc = c.toLowerCase();
  let d = null;
  const pg = c.match(/\b(?:p\.?|pp\.?|page)\s*(\d+)/i);
  if (CASE) {
    // generic: the document whose name (without extension) appears in the citation, else a token overlap
    const norm = (x) => x.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
    const cn = norm(c);
    d = docs.find((x) => cn.includes(norm(x.file))) ||
        docs.map((x) => ({ x, n: norm(x.file).split(' ').filter((t) => t.length > 2 && cn.includes(t)).length })).filter((o) => o.n).sort((a, b) => b.n - a.n).map((o) => o.x)[0];
    if (d) {
      (async () => { if (d.text == null) { try { d.text = await (await fetch(d.textUrl)).text(); } catch (_) { d.text = ''; } } openDoc(d, pg ? `[[page ${pg[1]}]]` : undefined); })();
      return;
    }
    toast('Citation: ' + c); return;
  }
  if (/police|report/.test(lc)) d = docs.find((x) => /police/i.test(x.file));
  else if (/fact|ntsb/.test(lc)) d = docs.find((x) => /fact/i.test(x.file));
  else if (/map|exhibit/.test(lc)) { openImage('/case/exhibits/map.png', 'Map exhibit'); return; }
  else {
    const w = lc.match(/witness\s+([a-z])\b/);
    if (w) d = docs.find((x) => new RegExp('witness_' + w[1], 'i').test(x.file));
  }
  if (!d) d = docs.find((x) => lc.includes(x.name.toLowerCase()));
  if (d) openDoc(d); else toast('Citation: ' + c);
}

// ---------- cameras ----------
function renderCameras() {
  const nav = $('cams');
  nav.innerHTML = '';
  for (const c of sl.cameras()) {
    const b = document.createElement('button');
    b.textContent = c.label;
    b.dataset.cam = c.id;
    b.onclick = () => selectCamera(c.id);
    nav.appendChild(b);
  }
  markActiveCamera();
}
function markActiveCamera() {
  for (const b of $('cams').children) b.classList.toggle('active', b.dataset.cam === sl.camera);
}

// ---------- timeline ----------
function setupTimeline() {
  const dur = sl.world.duration;
  const s = $('scrubber');
  s.max = dur; s.value = sl.time;
  const ticks = $('ticks');
  ticks.innerHTML = '';
  for (const w of sl.world.witnesses || []) {
    if (w.observationTime == null) continue;
    const d = document.createElement('div');
    d.className = 'tick';
    d.style.left = (w.observationTime / dur) * 100 + '%';
    d.innerHTML = `<span>${esc(String(w.name || w.id).replace(/\s*\(fictional\)/i, '').replace(/^Witness\s+/i, ''))}</span>`;
    ticks.appendChild(d);
  }
  updateTimeUI(sl.time);
}
function updateTimeUI(t) {
  if (!sl.world) return;
  if (!draggingScrub) $('scrubber').value = t;
  $('timeLabel').textContent = t.toFixed(2) + ' / ' + sl.world.duration.toFixed(2) + ' s';
}
$('scrubber').addEventListener('input', (e) => { draggingScrub = true; pause(); sl.setTime(parseFloat(e.target.value)); draggingScrub = false; });
function pause() { playing = false; $('play').textContent = 'Play'; }
function play() {
  if (sl.time >= sl.world.duration - 0.01) sl.setTime(0);
  playing = true; lastTs = 0; $('play').textContent = 'Pause';
  requestAnimationFrame(tick);
}
function tick(ts) {
  if (!playing) return;
  if (lastTs) {
    const t = sl.time + ((ts - lastTs) / 1000) * speed;
    if (t >= sl.world.duration) { sl.setTime(sl.world.duration); pause(); return; }
    sl.setTime(t);
  }
  lastTs = ts;
  requestAnimationFrame(tick);
}
$('play').onclick = () => (playing ? pause() : play());

// ---------- findings ----------
function sevClass(s) { return 'sev-' + String(s == null ? 'low' : s).toLowerCase().replace(/[^a-z]/g, ''); }
function citationsOf(f) {
  const out = [];
  for (const e of f.evidence || []) {
    const c = typeof e === 'string' ? e : (e.citation || e.source);
    if (c && !out.includes(c)) out.push(c);
  }
  for (const c of f.citations || []) if (!out.includes(c)) out.push(c);
  return out;
}
// ---------- weaker-model comparison ----------
let baseline = null;
async function loadBaseline() {
  baseline = null;
  const id = CASE || 'demo';
  try { baseline = await fetchJson('/cases/' + encodeURIComponent(id) + '/cache/baseline.json'); } catch (_) { baseline = null; }
  renderCompare();
}
function shortCite(c) { const m = String(c).match(/^(Depo\w*\.?\s*\d+:\d+(?::\d+)?)/i); return m ? m[1] : String(c).replace(/\s*\(.*$/, ''); }
function renderCompare() {
  const box = $('compare');
  if (!box) return;
  const key = findings.find((f) => (f.status || '').toLowerCase() === 'contradiction');
  if (!key || !baseline || !Array.isArray(baseline.findings)) { box.innerHTML = ''; return; }
  const inv = key.involves || [];
  const pool = baseline.findings.filter((b) => (b.involves || []).some((x) => inv.includes(x)));
  const cand = pool.length ? pool : baseline.findings;
  const rank = (b) => ({ contradiction: 0, consistent: 1, unverifiable: 2 }[(b.status || '').toLowerCase()] ?? 3);
  // the weaker model's take on the same claim: prefer a "consistent" verdict that mentions a clear view, else the first
  const bf = cand.slice().sort((a, b) => rank(a) - rank(b))[0] || cand[0];
  const bst = (bf.status || 'unverifiable').toLowerCase();
  const modelName = (m) => /flash/i.test(m || '') ? 'Gemini Flash' : String(m || 'Weaker model');
  const cites = citationsOf(key).filter((c) => /^depo/i.test(c)).slice(0, 3);
  const why = baseline.missed ? `<div class="cmp-miss"><b>What it missed:</b> ${esc(baseline.missed)}</div>` : '';
  box.innerHTML = `<details open><summary>Weaker model comparison</summary>
    <div class="cmp-grid">
      <div class="cmp-col">
        <div class="cmp-model"><b>${esc(modelName(baseline.model))}</b>transcript only</div>
        <span class="cmp-verdict ${esc(bst)}">${esc(bst.toUpperCase())}</span>
        <div class="cmp-why">${esc(bf.summary)}</div>
      </div>
      <div class="cmp-col">
        <div class="cmp-model"><b>Gemini 4 Argon</b>full case + video</div>
        <span class="cmp-verdict contradiction">CONTRADICTION</span>
        <div class="cmp-why">${esc(key.summary)}</div>
        <div class="chips">${cites.map((c) => `<span class="chip" data-cite="${esc(c)}">${esc(shortCite(c))}</span>`).join('')}</div>
      </div>
      ${why}
    </div></details>`;
  box.querySelectorAll('.chip').forEach((chip) => { chip.onclick = () => openCitation(chip.dataset.cite); });
}

// ---------- measurements (CREDIBILITY v1 check fields; every field optional) ----------
const cleanLbl = (id) => String(labelOf(id)).replace(/\s*\([^)]*\)/g, '');
const fmtFmt = () => (sl && sl.fmt) || {};
const n0 = (x) => Math.round(Number(x));
const n1 = (x) => (Math.round(Number(x) * 10) / 10).toFixed(1);
function sightChecks() { return ((state && state.checks) || []).filter((c) => c && c.check === 'sightline'); }
function witnessMeasureLines(c) {
  const out = [];
  const f = fmtFmt();
  const rb = f.robustnessLine ? f.robustnessLine(c.robustness) : null;
  if (rb) out.push(rb);
  const g = f.gazeLine ? f.gazeLine(c.gaze) : null;
  if (g) out.push(g);
  return out;
}
function prtLine(p) {
  if (!p) return null;
  const v = String(p.verdict || 'unverifiable').toLowerCase();
  const cls = { insufficient: 'bad', marginal: 'warn', sufficient: 'ok' }[v] || '';
  const typ = p.typicalS != null ? `typical ${n1(p.typicalS)} s` : '';
  if (p.availableS == null || !Number.isFinite(Number(p.availableS))) return { cls, text: `Perception-reaction time: unverifiable${typ ? ' (' + typ + ')' : ''}` };
  return { cls, text: `${n1(p.availableS)} s available to perceive and react; ${typ}${typ ? ' — ' : ''}${v}` };
}
function rangeLine(r) {
  if (!r || !Array.isArray(r.mph) || r.mph.length < 2) return null;
  const mu = Array.isArray(r.mu) ? r.mu : [0.6, 0.8];
  return `${n0(r.mph[0])}–${n0(r.mph[1])} mph, friction ${mu[0]}–${mu[1]}`;
}
function measureItems() {
  const items = [];
  const checks = (state && state.checks) || [];
  for (const c of checks) {
    if (!c) continue;
    if (c.check === 'sightline') {
      const w = (sl.world.witnesses || []).find((x) => x.id === c.subject);
      const who = w ? shortWit(w) : c.subject;
      const tgt = c.target && sl.world.objects[c.target] ? cleanLbl(c.target) : (c.target || 'target');
      const lines = [];
      if (c.pass === false && c.blockedBy) lines.push({ cls: 'bad', text: `Line of sight blocked by ${cleanLbl(c.blockedBy)}` });
      else if (c.pass === true) lines.push({ cls: 'ok', text: `Had line of sight${c.distance != null ? ' (' + n1(c.distance) + ' m)' : ''}` });
      lines.push(...witnessMeasureLines(c));
      items.push({ head: `${who} → ${tgt}`, sub: c.t != null ? `t = ${n1(c.t)} s` : '', lines, focus: () => focusFinding({ involves: [c.subject] }, null) });
    }
    if (c.range) {
      const txt = rangeLine(c.range);
      if (txt) {
        const lines = [{ cls: c.pass === false ? 'bad' : '', text: `Skid speed ${txt}` }];
        if (c.actualMph != null) lines.push({ cls: c.pass === false ? 'bad' : 'ok', text: `Reconstruction: ${n0(c.actualMph)} mph${c.t != null ? ' at t = ' + n1(c.t) + ' s' : ''}` });
        items.push({ head: c.subject && sl.world.objects[c.subject] ? cleanLbl(c.subject) : (c.subject || 'Skid'), sub: 'skid marks', lines });
      }
    }
    if (c.prt) {
      const l = prtLine(c.prt);
      const obs = c.prt.observerId || c.observerId || c.subject;
      const tg = c.prt.targetId || c.targetId || c.target;
      const wObs = (sl.world.witnesses || []).find((x) => x.id === obs);
      const who = wObs ? shortWit(wObs) : obs && sl.world.objects[obs] ? (sl.world.objects[obs].kind === 'vehicle' ? 'Driver of ' : '') + cleanLbl(obs) : (obs || 'Observer');
      if (l && c.cappedAtStart && l.text.includes('available')) l.text = l.text.replace(' s available', ' s+ available');
      if (l) items.push({ head: who + (tg ? ' \u2192 ' + (sl.world.objects[tg] ? cleanLbl(tg) : tg) : ''), sub: 'perception-reaction', lines: [l] });
    }
  }
  const pl = checks.filter((c) => c && c.check === 'plausibility');
  const failed = pl.filter((c) => c.pass === false);
  if (failed.length) {
    for (const c of failed) {
      const issues = Array.isArray(c.issues) && c.issues.length ? c.issues : [c.detail || 'implausible motion'];
      items.push({ head: sl.world.objects[c.subject] ? cleanLbl(c.subject) : c.subject, sub: 'motion plausibility', lines: issues.map((t) => ({ cls: 'bad', text: String(t) })) });
    }
  } else if (pl.length) {
    items.push({ head: 'Motion plausibility', sub: '', lines: [{ cls: 'ok', text: `${pl.length} moving object${pl.length > 1 ? 's' : ''}: no acceleration, jump or speed limit exceeded` }] });
  }
  return items;
}
function lineHtml(l, base = 'm-line') { return `<div class="${base} ${esc(l.cls || '')}">${esc(l.text)}</div>`; }
function renderMeasures() {
  let box = $('measures');
  if (!box) {
    box = document.createElement('div');
    box.id = 'measures';
    const f = $('findings');
    if (!f || !f.parentNode) return;
    f.parentNode.insertBefore(box, f);
  }
  if (!sl.world || !state) { box.innerHTML = ''; return; }
  const items = measureItems();
  if (!items.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<details open><summary>Measurements <span class="count">(independent checks)</span></summary><ul class="m-list">${items.map((it, i) =>
    `<li class="m-item" data-i="${i}"><div class="m-head">${esc(it.head)}${it.sub ? ' <span class="muted small">· ' + esc(it.sub) + '</span>' : ''}</div>${it.lines.map((l) => lineHtml(l)).join('')}</li>`).join('')}</ul></details>`;
  box.querySelectorAll('.m-item').forEach((li) => {
    const it = items[+li.dataset.i];
    if (it.focus) { li.style.cursor = 'pointer'; li.onclick = it.focus; }
  });
}

function renderFindings() {
  const box = $('findings');
  renderMeasures();
  $('findCount').textContent = findings.length ? '(' + findings.length + ')' : '';
  if (!findings.length) {
    box.innerHTML = '<div class="muted">No findings yet. Run the loop on the server to generate them' + (state ? '.' : ' (API not available — viewer is running standalone).') + '</div>';
    return;
  }
  box.innerHTML = '';
  for (const f of findings) {
    const el = document.createElement('div');
    const st = (f.status || 'unverifiable').toLowerCase();
    el.className = 'finding ' + st;
    el.dataset.id = f.id;
    el.innerHTML = `<div class="f-top"><span class="pill ${sevClass(f.severity)}">${esc(f.severity || 'info')}</span><span class="pill ${esc(st)}">${esc(st)}</span></div>
      <div class="f-sum">${esc(f.summary)}</div>
      ${findingMeasures(f)}
      <div class="chips">${citationsOf(f).map((c) => `<span class="chip${/inferred/i.test(c) ? ' inferred' : ''}" data-cite="${esc(c)}">${esc(c)}</span>`).join('')}</div>`;
    el.onclick = () => focusFinding(f, el);
    el.querySelectorAll('.chip').forEach((chip) => {
      chip.onclick = (ev) => { ev.stopPropagation(); openCitation(chip.dataset.cite); };
    });
    box.appendChild(el);
  }
}
// robustness + gaze lines for the witness(es) a finding involves
function findingMeasures(f) {
  if (!sl.world) return '';
  const inv = f.involves || [];
  const lines = [];
  for (const c of sightChecks()) {
    if (!inv.includes(c.subject)) continue;
    lines.push(...witnessMeasureLines(c));
  }
  return lines.length ? `<div class="f-meas">${lines.map((l) => lineHtml(l)).join('')}</div>` : '';
}
function focusFinding(f, el) {
  document.querySelectorAll('.finding.active').forEach((x) => x.classList.remove('active'));
  if (el) el.classList.add('active');
  const ids = f.involves || [];
  const wits = sl.world.witnesses || [];
  const w = wits.find((x) => ids.includes(x.id));
  const hi = ids.filter((id) => sl.world.objects[id]);
  if (w) {
    pause();
    sl.setCamera(w.id);
    if (w.observationTime != null) sl.setTime(w.observationTime);
    const r = sl.sightline(w.id);
    if (r && !r.visible && r.blockedBy && !hi.includes(r.blockedBy)) hi.push(r.blockedBy);
    toast(shortWit(w) + ' @ t=' + (w.observationTime != null ? w.observationTime : sl.time).toFixed(1) + ' s — ' + (r ? (r.visible ? 'had line of sight to target' : 'line of sight blocked by ' + labelOf(r.blockedBy)) : ''));
  } else {
    const veh = hi.find((id) => sl.world.objects[id].kind === 'vehicle');
    sl.setCamera(veh && f.camera === 'chase' ? 'chase_' + veh : 'overhead');
    if (f.time != null) sl.setTime(f.time);
  }
  sl.highlight(hi);
}
const shortWit = (w) => String(w.name || w.id).replace(/\s*\(fictional\)/i, '');
const labelOf = (id) => (sl.world.objects[id] && sl.world.objects[id].label) || id || 'unknown object';

function renderChecks(checks) {
  const ul = $('checks');
  ul.innerHTML = '';
  const arr = Array.isArray(checks) ? checks : [];
  // a failed testimony check is a confirmed contradiction (a finding), not an error; plausibility failures flag the reconstruction itself
  const kindOf = (c) => {
    if (c.check === 'plausibility') return c.pass === false ? 'flag' : 'plausible';
    if (c.pass === false) return 'contradiction';
    if (c.pass === true) return 'consistent';
    return 'unverifiable';
  };
  const n = { contradiction: 0, consistent: 0, flag: 0, plausible: 0, unverifiable: 0 };
  for (const c of arr) n[kindOf(c)]++;
  const parts = [];
  if (n.contradiction) parts.push(`${n.contradiction} contradiction${n.contradiction > 1 ? 's' : ''} confirmed`);
  if (n.consistent) parts.push(`${n.consistent} consistent`);
  if (n.unverifiable) parts.push(`${n.unverifiable} unverifiable`);
  if (n.flag) parts.push(`${n.flag} motion flag${n.flag > 1 ? 's' : ''}`);
  else if (n.plausible) parts.push('motion plausible');
  $('checkCount').textContent = parts.length ? ': ' + parts.join(', ') : '';
  if (!arr.length) { ul.innerHTML = '<li class="muted">No check results.</li>'; return; }
  const TAG = { contradiction: 'CONTRADICTION', consistent: 'CONSISTENT', flag: 'MOTION FLAG', plausible: 'PLAUSIBLE', unverifiable: 'UNVERIFIABLE' };
  const order = { contradiction: 0, flag: 1, consistent: 2, unverifiable: 3, plausible: 4 };
  for (const c of arr.slice().sort((a, b) => order[kindOf(a)] - order[kindOf(b)])) {
    const k = kindOf(c);
    const subj = sl.world && sl.world.objects[c.subject] ? cleanLbl(c.subject) : (sl.world && (sl.world.witnesses || []).find((w) => w.id === c.subject) ? shortWit(sl.world.witnesses.find((w) => w.id === c.subject)) : c.subject);
    const li = document.createElement('li');
    li.className = 'ck-' + k;
    li.innerHTML = `<span class="ck-tag ${k}">${TAG[k]}</span><span><b>${esc(c.check)} · ${esc(subj)}</b> — ${esc(String(c.detail || '').replace(/could see/gi, 'had line of sight to'))}</span>`;
    ul.appendChild(li);
  }
}

// ---------- popover ----------
function showPopover(d) {
  const p = $('popover');
  if (!d) { p.hidden = true; return; }
  let title, meta, cite;
  if (d.type === 'witness') {
    const w = d.witness;
    title = w.name || w.id; meta = 'Witness · observes t=' + w.observationTime + ' s';
    cite = w.citation;
    const inf = /inferred/i.test(cite || '');
    p.innerHTML = `<div class="p-title">${esc(title)}${inf ? '<span class="tag-inferred">inferred</span>' : ''}</div><div class="p-meta">${esc(meta)}</div><div style="margin-bottom:6px">“${esc(w.claim)}”</div>${cite ? `<span class="chip${inf ? ' inferred' : ''}" data-cite="${esc(cite)}">${esc(cite)}</span>` : ''}`;
  } else {
    const o = d.obj;
    title = o.label || d.id; meta = (o.kind || 'object') + ' · ' + d.id + (o.occludes ? ' · occludes' : '');
    cite = o.citation;
    const inf = /inferred/i.test(cite || '');
    p.innerHTML = `<div class="p-title">${esc(title)}${inf ? '<span class="tag-inferred">inferred</span>' : ''}</div><div class="p-meta">${esc(meta)}${inf ? ' · not directly cited' : ''}</div>${cite ? `<span class="chip${inf ? ' inferred' : ''}" data-cite="${esc(cite)}">${esc(cite)}</span>` : '<span class="muted small">No citation</span>'}`;
  }
  p.querySelectorAll('.chip').forEach((c) => { c.onclick = () => openCitation(c.dataset.cite); });
  const wrap = $('stageWrap').getBoundingClientRect();
  p.hidden = false;
  const x = Math.min(d.clientX - wrap.left + 12, wrap.width - p.offsetWidth - 8);
  const y = Math.min(d.clientY - wrap.top + 12, wrap.height - p.offsetHeight - 8);
  p.style.left = Math.max(8, x) + 'px';
  p.style.top = Math.max(8, y) + 'px';
}

// ---------- add a witness ----------
function nextLiveId() {
  let n = 1;
  const ids = new Set((sl.world.witnesses || []).map((w) => w.id));
  while (ids.has('wit_live_' + n)) n++;
  return n;
}

// Show the new witness: camera, time, verdict card. `j` is an optional server response ({sightline, verdict, renderUrl}).
function showWitness(w, j = {}, how = '') {
  const out = $('witResult');
  sl.addWitness(w);
  renderCameras();
  setupTimeline();
  pause();
  sl.setCamera(w.id);
  if (w.observationTime != null) sl.setTime(w.observationTime);
  const local = sl.sightline(w.id);
  const sight = j.sightline || local || {};
  let verdict = String(j.verdict || (sight.visible ? 'VISIBLE' : 'BLOCKED')).toUpperCase();
  if (!/VISIBLE|BLOCKED/.test(verdict)) verdict = (sight.visible === false ? 'BLOCKED' : 'VISIBLE');
  const blocker = sight.blockedBy || (local && local.blockedBy) || null;
  if (verdict === 'BLOCKED' && blocker) sl.highlight(blocker); else sl.highlight(null);
  out.hidden = false;
  out.innerHTML = `<span class="verdict ${verdict}">${verdict}</span>
    <div><strong>${esc(w.name || w.id)}</strong> <span class="muted small">${esc(how)}</span></div>
    <div class="muted small">${esc(w.claim || '')}</div>
    <div class="small" style="margin-top:6px">${verdict === 'BLOCKED' ? 'View blocked by <strong>' + esc(labelOf(blocker)) + '</strong> (highlighted in red).' : 'Clear line of sight to ' + esc(typeof w.lookAt === 'string' ? labelOf(w.lookAt) : 'target') + '.'}</div>
    <div class="row" style="margin-top:8px"><button class="btn small" id="adjustBtn">Adjust on map</button></div>
    ${j.renderUrl ? `<div class="small" style="margin-top:6px"><a style="color:var(--accent)" href="${esc(j.renderUrl)}" target="_blank" rel="noopener">Open render</a></div>` : ''}`;
  $('adjustBtn').onclick = () => startMapPlacement(w);
}

async function addWitness() {
  const statement = $('witText').value.trim();
  if (!statement) { toast('Type a statement first.'); return; }
  cancelMapPlacement();
  const btn = $('witBtn');
  btn.disabled = true; btn.textContent = 'Placing…';
  const out = $('witResult');
  try {
    const r = await fetch(CASE ? CASE_API + '/witness' : '/api/witness', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statement }) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const w = j.witness;
    if (!w) throw new Error('No witness returned');
    if (!w.id) w.id = 'wit_live_' + nextLiveId();
    showWitness(w, j, '(placed by Argon)');
  } catch (e) {
    out.hidden = false;
    out.innerHTML = `<div class="muted">Argon placement unavailable (${esc(e.message)}). Use <strong>Place on map</strong> to position the witness yourself.</div>`;
  } finally {
    btn.disabled = false; btn.textContent = 'Place witness & test view';
  }
}

// ----- Place on map (client-side, no server needed) -----
const MP = { active: false, step: null, pos: null, target: null, adjusting: null };
function defaultObsTime() {
  const ts = (sl.world.witnesses || []).map((w) => w.observationTime).filter((t) => t != null && !Number.isNaN(t)).sort((a, b) => a - b);
  if (ts.length) return ts[Math.floor(ts.length / 2)];
  return +(sl.world.duration * 0.66).toFixed(1);
}
function fillTargets() {
  const sel = $('mapTarget');
  sel.innerHTML = '<option value="">Click an object on the map…</option>';
  const kinds = ['signal', 'vehicle', 'occluder', 'sign', 'building'];
  const items = Object.entries(sl.world.objects).filter(([id, o]) => kinds.includes(o.kind) || /^(sig_|veh_|occ_|bld_)/.test(id));
  items.sort((a, b) => kinds.indexOf(a[1].kind) - kinds.indexOf(b[1].kind));
  for (const [id, o] of items) {
    const op = document.createElement('option');
    op.value = id; op.textContent = String(o.label || id).replace(/\s*\([^)]*\)/g, '') + (/inferred/i.test(o.citation || '') ? ' [inferred]' : '');
    if (o.citation) op.title = o.citation;
    sel.appendChild(op);
  }
}
function mapStepText() {
  const el = $('mapStep');
  if (MP.step === 'pos') el.textContent = (MP.adjusting ? 'Adjust: ' : 'Step 1: ') + 'click the overhead map where the witness stood.';
  else if (MP.step === 'look') el.textContent = 'Step 2: click what they saw (an object), or choose it below.';
  else el.textContent = 'Ready: press Test view (or click the map to move the witness).';
  $('mapGo').disabled = !(MP.pos && MP.target);
}
function updateMapPreview() {
  const nm = MP.adjusting ? (MP.adjusting.name || MP.adjusting.id) : 'Live witness ' + nextLiveId();
  sl.setPreview(MP.pos ? { position: MP.pos, lookAt: MP.target, name: nm } : null);
}
function startMapPlacement(existing) {
  if (!sl.world) return;
  MP.active = true; MP.adjusting = existing || null;
  MP.pos = existing ? [existing.position[0], 0, existing.position[2]] : null;
  MP.target = existing ? existing.lookAt : null;
  MP.step = 'pos';
  fillTargets();
  $('mapTarget').value = typeof MP.target === 'string' ? MP.target : '';
  $('mapTime').value = existing && existing.observationTime != null ? existing.observationTime : defaultObsTime();
  $('mapPlace').hidden = false;
  pause();
  sl.highlight(null);
  sl.setCamera('overhead');
  sl.setPickHandler(onMapPick);
  updateMapPreview();
  mapStepSync();
  toast(existing ? 'Click the map to move ' + shortWit(existing) : 'Click the overhead map to place the witness');
}
function mapStepSync() { mapStepText(); }
function onMapPick(d) {
  if (!MP.active) return;
  if (MP.step === 'pos' || MP.step === 'ready') {
    MP.pos = d.point;
    if (MP.step === 'pos' && !MP.target) MP.step = 'look'; else MP.step = MP.target ? 'ready' : 'look';
  } else if (MP.step === 'look') {
    MP.target = d.objectId || [d.point[0], 1.5, d.point[2]];
    if (d.objectId) $('mapTarget').value = d.objectId;
    MP.step = 'ready';
    updateMapPreview(); mapStepSync();
    runMapPlacement();   // second click completes the placement
    return;
  }
  updateMapPreview();
  mapStepSync();
}
$('mapTarget').onchange = (e) => {
  MP.target = e.target.value || null;
  if (MP.pos && MP.target) MP.step = 'ready'; else if (MP.pos) MP.step = 'look';
  updateMapPreview(); mapStepSync();
};
function cancelMapPlacement() {
  MP.active = false; MP.step = null; MP.adjusting = null;
  sl.setPickHandler(null);
  sl.setPreview(null);
  $('mapPlace').hidden = true;
}
function runMapPlacement() {
  if (!(MP.pos && MP.target)) return;
  const t = parseFloat($('mapTime').value);
  const obsT = Number.isFinite(t) ? Math.max(0, Math.min(sl.world.duration, t)) : defaultObsTime();
  const statement = $('witText').value.trim();
  let w;
  if (MP.adjusting) {
    w = MP.adjusting;
    w.position = [MP.pos[0], 0, MP.pos[2]];
    w.lookAt = MP.target;
    w.observationTime = obsT;
  } else {
    const n = nextLiveId();
    w = { id: 'wit_live_' + n, name: 'Live witness ' + n, position: [MP.pos[0], 0, MP.pos[2]], eyeHeight: 1.6, lookAt: MP.target,
      observationTime: obsT, claim: statement || 'Live statement (no text entered)', citation: 'Live statement' };
  }
  const wasAdjust = !!MP.adjusting;
  $('toast').hidden = true;
  cancelMapPlacement();
  showWitness(w, {}, wasAdjust ? '(adjusted on map)' : '(placed on map)');
}
$('mapBtn').onclick = () => (MP.active ? cancelMapPlacement() : startMapPlacement(null));
$('mapGo').onclick = runMapPlacement;
$('mapCancel').onclick = cancelMapPlacement;
window.slPlace = { start: startMapPlacement, pick: onMapPick, cancel: cancelMapPlacement };
$('witBtn').onclick = addWitness;

$('loopBtn').onclick = async () => {
  const b = $('loopBtn'); b.disabled = true; b.textContent = 'Running…';
  try {
    if (CASE) { location.href = '/cases.html?case=' + encodeURIComponent(CASE); return; }
    const r = await fetch('/api/loop', { method: 'POST' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    await loadState(true);
    toast('Loop complete.');
  } catch (e) { toast('Loop unavailable: ' + e.message); }
  b.disabled = false; b.textContent = 'Re-run loop';
};

// ---------- state / API ----------
async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
async function loadState(allowWorldSwap) {
  try {
    if (CASE) { caseInfo = await fetchJson(CASE_API); state = caseInfo.state || { findings: [], checks: [] }; $('caseTitle').dataset.fixed = caseInfo.title; }
    else state = await fetchJson('/api/state');
  } catch (_) {
    state = null;
    findings = [];
    renderFindings();
    renderChecks([]);
    return;
  }
  findings = state.findings || [];
  try { sl.setCaseData && sl.setCaseData({ checks: state.checks || [], kinematicLabel: (caseInfo && caseInfo.kinematicLabel) || state.kinematicLabel }); } catch (_) {}
  renderFindings();
  renderCompare();
  loadBaseline();
  renderChecks(state.checks);
  if (allowWorldSwap && state.world && !params.has('world') && state.world !== sl.worldUrl) {
    try {
      await sl.loadWorld(state.world);
      afterWorld();
      renderFindings();
    } catch (e) { console.warn('Could not load state world', e); }
  }
  // live witnesses added earlier through the API
  try {
    const lw = await fetchJson(CASE ? CASE_API + '/witnesses' : '/api/witnesses');
    const arr = Array.isArray(lw) ? lw : (lw.witnesses || []);
    let added = false;
    for (const w of arr) {
      if (!(sl.world.witnesses || []).some((x) => x.id === w.id)) { sl.addWitness(w); added = true; }
    }
    if (added) { renderCameras(); setupTimeline(); }
  } catch (_) {}
}

function afterWorld() {
  const m = sl.world.meta || {};
  $('caseTitle').textContent = (caseInfo && caseInfo.title) || m.title || 'Sightline';
  $('caseTitle').title = $('caseTitle').textContent;
  $('caseSub').textContent = [m.caseId, m.timeOfDay, m.lighting].filter(Boolean).join(' · ');
  renderCameras();
  setupTimeline();
}

// ---------- boot ----------
sl.events && sl.events.addEventListener('camera', markActiveCamera);
sl.events && sl.events.addEventListener('time', (e) => updateTimeUI(e.detail));
sl.events && sl.events.addEventListener('pick', (e) => showPopover(e.detail));
sl.events && sl.events.addEventListener('loaded', () => { try { afterWorld(); } catch (_) {} });

(async () => {
  if (CLEAN) return;
  try {
    await sl.ready;
  } catch (e) {
    $('caseSub').textContent = 'Failed to load world: ' + e.message;
    $('findings').innerHTML = `<div class="muted">World failed to load: ${esc(e.message)}</div>`;
    return;
  }
  afterWorld();
  initCasePicker();
  if (CASE) { try { caseInfo = await fetchJson(CASE_API); afterWorld(); } catch (_) {} }
  loadDocs();
  loadState(true);
})();

// ---------- case picker ----------
async function initCasePicker() {
  const sel = $('casePick');
  if (!sel) return;
  let list = [];
  try { list = await fetchJson('/api/cases'); } catch (_) {}
  sel.innerHTML = '';
  const legacy = !CASE;
  if (legacy) { const o = document.createElement('option'); o.value = ''; o.textContent = 'Default case'; sel.appendChild(o); }
  for (const c of list) {
    const o = document.createElement('option');
    o.value = c.caseId; o.textContent = c.title + (c.hasWorld ? '' : '  (not reconstructed)');
    sel.appendChild(o);
  }
  sel.value = CASE;
  if (sel.value !== CASE) { const o = document.createElement('option'); o.value = CASE; o.textContent = CASE; sel.appendChild(o); sel.value = CASE; }
  sel.onchange = () => {
    if (!sel.value) { location.href = '/'; return; }
    const c = list.find((x) => x.caseId === sel.value);
    location.href = c && !c.hasWorld ? '/cases.html?case=' + encodeURIComponent(sel.value) : '/?case=' + encodeURIComponent(sel.value);
  };
}
