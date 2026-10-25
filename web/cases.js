// Sightline cases page (UI-C). Everything shown here comes from the server:
//   GET /api/health        -> server mode (SIGHTLINE_MODE)
//   GET /api/cases         -> case list
//   GET /api/cases/:id     -> manifest + files (size/duration recomputed from disk), state, validation
//   case facts text file   -> incident date, location, source (parsed from its heading)
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- formatting ----------
export function fmtSize(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
  return Math.max(1, Math.round(n / 1e3)) + ' KB';
}
export function fmtDur(sec) {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return '';
  const s = Math.round(sec);
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60), r = s % 60;
  if (m >= 10 || r === 0) return Math.round(s / 60) + ' min';
  return `${m} min ${r} s`;
}
const fmtWhen = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const plural = (n, w, pl) => `${n} ${n === 1 ? w : (pl || w + 's')}`;

const EXT_TYPE = { pdf: 'pdf', txt: 'text', md: 'text', markdown: 'text', docx: 'text', rtf: 'text', csv: 'text', json: 'text', srt: 'text', vtt: 'text',
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', mp4: 'video', mov: 'video', webm: 'video', m4v: 'video', mkv: 'video' };
const typeOf = (name) => EXT_TYPE[(name.split('.').pop() || '').toLowerCase()] || null;
const TYPE_LABEL = { video: 'Video', image: 'Image', pdf: 'PDF', text: 'Text' };

function evidenceCounts(files) {
  const n = { video: 0, image: 0, doc: 0 };
  for (const f of files || []) { if (f.type === 'video') n.video++; else if (f.type === 'image') n.image++; else n.doc++; }
  const parts = [plural((files || []).length, 'exhibit')];
  if (n.doc) parts.push(plural(n.doc, 'document'));
  if (n.video) parts.push(plural(n.video, 'video'));
  if (n.image) parts.push(plural(n.image, 'image'));
  return parts;
}

// ---------- case metadata (date / location / source) ----------
const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE_RE = new RegExp(`${MONTH}\\.?\\s+\\d{1,2},\\s*\\d{4}|\\d{4}-\\d{2}-\\d{2}`);
export function parseFacts(text) {
  const out = {};
  const head = (String(text || '').match(/^#\s+(.+)$/m) || [])[1];
  if (head) {
    const h = head.replace(/^case facts\s*[:—-]\s*/i, '').trim();
    const m = h.match(/^(.*?)\s*\((.+)\)\s*$/);
    const ref = (m ? m[1] : h).trim();
    const paren = m ? m[2] : '';
    const date = (paren.match(DATE_RE) || [])[0];
    if (date) out.date = date;
    const loc = paren.replace(DATE_RE, '').split(',').map((s) => s.trim()).filter(Boolean);
    if (loc.length) out.location = loc.join(', ');
    if (ref) out.ref = ref;
  }
  const real = /\b(NTSB|NHTSA|FMCSA|police|sheriff|highway patrol)\b/i.test(out.ref || '');
  const fict = /witness(?:es)?[^.\n]{0,80}\bfictional\b|\bfictional\b[^.\n]{0,40}witness/i.test(text || '');
  if (out.ref) out.source = out.ref + (real ? ' (real)' : '') + (fict ? ' · witnesses fictional' : '');
  return out;
}
const metaCache = new Map();
async function caseMeta(c) {
  if (metaCache.has(c.caseId)) return metaCache.get(c.caseId);
  const p = (async () => {
    // explicit manifest fields win; otherwise read the case-facts document
    const meta = { date: c.incidentDate || c.date, location: c.location, source: c.source };
    if (meta.date && meta.location && meta.source) return meta;
    const files = (c.files || []).filter((f) => f.textUrl);
    const facts = files.find((f) => /^(case[_ -]?)?facts\b/i.test(f.name)) || files.find((f) => /facts/i.test(f.name));
    if (!facts) return meta;
    try {
      const r = await fetch(facts.textUrl);
      if (r.ok) { const pf = parseFacts(await r.text()); for (const k of ['date', 'location', 'source']) meta[k] = meta[k] || pf[k]; }
    } catch (_) { /* metadata is optional */ }
    return meta;
  })();
  metaCache.set(c.caseId, p);
  return p;
}

// ---------- run status / verdict ----------
function verdictOf(c, listStatus) {
  const status = listStatus || c.status;
  if (c.running || status === 'running') return { cls: 'run', label: 'Running' };
  if (status === 'error') return { cls: 'err', label: 'Last run failed' };
  const st = c.state;
  const v = st && st.verdict;
  if (!st || !st.world) return { cls: 'idle', label: 'Not yet run' };
  if (v === 'contradiction_found' || (st.findings || []).some((f) => f.status === 'contradiction')) return { cls: 'contra', label: 'Contradiction found' };
  if (!v || /consistent|no_contradiction|clear/i.test(v)) return { cls: 'ok', label: 'No contradictions' };
  return { cls: 'idle', label: String(v).replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase()) };
}
function lastRun(c) {
  const st = c.state; if (!st || !st.world) return '';
  const when = st.updatedAt || (st.loopLog && st.loopLog.length && st.loopLog[st.loopLog.length - 1].finishedAt);
  return [when ? fmtWhen(when) : '', st.mode ? st.mode + ' run' : ''].filter(Boolean).join(' · ');
}

// ---------- step tracker (run progress) ----------
const STEPS = [
  ['extract', 'Extracting text'],
  ['upload', 'Uploading videos to Argon'],
  ['generate', 'Generating world'],
  ['render', 'Rendering views'],
  ['checks', 'Independent checks'],
  ['critique', 'Argon critique'],
  ['patch', 'Applying fix'],
];
const stepKey = (ev) => {
  const s = String(ev.step || '').toLowerCase();
  if (/upload|files?$|video|evidence/.test(s)) return 'upload';
  if (/gen/.test(s)) return 'generate';
  if (/render/.test(s)) return 'render';
  if (/check/.test(s)) return 'checks';
  if (/critique|review/.test(s)) return 'critique';
  if (/patch|fix|apply/.test(s)) return 'patch';
  if (/extract|ingest|text/.test(s)) return 'extract';
  return null;
};

let cases = [];          // list rows from /api/cases
const details = new Map(); // caseId -> /api/cases/:id payload
let current = null;
let pending = [];
let es = null;
let modeName = null;     // from /api/health; null = unknown

async function api(url, opt) {
  const r = await fetch(url, opt);
  let j = null; try { j = await r.json(); } catch (_) {}
  if (!r.ok) { const e = new Error((j && j.error) || 'HTTP ' + r.status); e.body = j; throw e; }
  return j;
}

function modeNote() {
  if (modeName === 'live') return 'Server mode: <b>Live</b>. Reconstructions call Argon from the build workspace.';
  if (modeName === 'mock') return 'Server mode: <b>Mock</b>. Runs replay cached Argon output. Live runs execute in the build workspace (server started with SIGHTLINE_MODE=live).';
  return 'Server mode unknown: the health check did not respond.';
}

// ---------- case list ----------
async function refreshList() {
  try { cases = await api('/api/cases'); } catch (e) { cases = []; }
  const ul = $('#caselist');
  $('#caseCount').textContent = cases.length ? String(cases.length) : '';
  if (!cases.length) { ul.innerHTML = '<li class="muted small" style="padding:8px 2px">No cases yet.</li>'; return; }
  ul.innerHTML = cases.map((c) => `<li class="card${c.caseId === current ? ' sel' : ''}" data-id="${esc(c.caseId)}" tabindex="0" role="button">
      <div class="ct">${esc(c.title)}</div>
      <div class="cm" data-meta></div>
      <div class="cf"><span data-counts>${esc(plural(c.fileCount, 'exhibit'))}</span><span data-verdict></span></div>
    </li>`).join('');
  ul.querySelectorAll('.card').forEach((li) => {
    li.onclick = () => selectCase(li.dataset.id);
    li.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectCase(li.dataset.id); } };
  });
  await Promise.all(cases.map(async (row) => {
    let c = details.get(row.caseId);
    if (!c || c.status !== row.status) {
      try { c = await api('/api/cases/' + encodeURIComponent(row.caseId)); details.set(row.caseId, c); } catch (_) { return; }
    }
    const li = ul.querySelector(`.card[data-id="${CSS.escape(row.caseId)}"]`); if (!li) return;
    const meta = await caseMeta(c);
    const v = verdictOf(c, row.status);
    const lr = lastRun(c);
    li.querySelector('[data-meta]').innerHTML =
      [meta.date ? `<b>${esc(meta.date)}</b>` : '', meta.location ? esc(meta.location) : ''].filter(Boolean).join(' · ') +
      (meta.source ? `<div class="cs">${esc(meta.source)}</div>` : '') +
      (lr ? `<div class="cs lr">Last run ${esc(lr)}</div>` : '');
    li.querySelector('[data-counts]').textContent = evidenceCounts(c.files).filter((p) => !/document/.test(p)).join(' · ');
    li.querySelector('[data-verdict]').innerHTML = `<span class="tag ${v.cls}">${esc(v.label)}</span>`;
  }));
}

// ---------- new case form ----------
function showNew() {
  current = null; pending = [];
  if (es) { es.close(); es = null; }
  history.replaceState(null, '', location.pathname + '?new');
  refreshList();
  $('#content').innerHTML = `
    <div class="crumb"><a href="/cases.html">Cases</a> / New</div>
    <h1>Open a new case</h1>
    <p class="lede">Upload the case file: police and expert reports, depositions and statements, photos, diagrams, and any video (videotaped depositions, dashcam, bodycam). Argon reads and watches the material and builds a 3D reconstruction you can test from each witness's position.</p>
    <label class="f" for="title">Case title</label>
    <input type="text" id="title" placeholder="e.g. Doe v. Acme Freight, 2025-CV-1042" autocomplete="off">
    <div id="drop" tabindex="0" role="button" aria-label="Add files">
      <strong>Drop files here or click to browse</strong>
      <span>PDF, TXT, MD, DOCX &middot; PNG, JPG &middot; MP4, MOV, WEBM</span>
      <input type="file" id="picker" multiple hidden accept=".pdf,.txt,.md,.markdown,.docx,.png,.jpg,.jpeg,.webp,.mp4,.mov,.webm,.m4v">
    </div>
    <ul class="files" id="flist"></ul>
    <div class="bar" id="ubar" hidden><i></i></div>
    <div class="err" id="uerr"></div>
    <div class="actions newactions"><button class="btn primary" id="createBtn" disabled>Create case</button><span class="muted small" id="usum"></span></div>`;
  const drop = $('#drop'), picker = $('#picker');
  drop.onclick = () => picker.click();
  drop.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') picker.click(); };
  picker.onchange = () => { addFiles([...picker.files]); picker.value = ''; };
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', async (e) => addFiles(await collectDropped(e.dataTransfer)));
  $('#createBtn').onclick = createCase;
  renderPending();
}
async function collectDropped(dt) {
  const items = [...(dt.items || [])].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!items.length) return [...dt.files];
  const out = [];
  const walk = async (en) => {
    if (en.isFile) out.push(await new Promise((res, rej) => en.file(res, rej)));
    else if (en.isDirectory) {
      const rd = en.createReader();
      for (;;) { const batch = await new Promise((res, rej) => rd.readEntries(res, rej)); if (!batch.length) break; for (const b of batch) await walk(b); }
    }
  };
  for (const en of items) await walk(en);
  return out;
}
function addFiles(files) {
  for (const f of files) {
    if (!typeOf(f.name)) continue;
    if (pending.some((p) => p.name === f.name && p.size === f.size)) continue;
    pending.push(f);
  }
  renderPending();
}
function renderPending() {
  const ul = $('#flist'); if (!ul) return;
  ul.innerHTML = pending.map((f, i) => `<li><span class="ty">${typeOf(f.name)}</span><span class="nm">${esc(f.name)}</span><span class="sz">${fmtSize(f.size)}</span><button class="rm" data-i="${i}" title="Remove" aria-label="Remove">&times;</button></li>`).join('');
  ul.querySelectorAll('.rm').forEach((b) => { b.onclick = () => { pending.splice(+b.dataset.i, 1); renderPending(); }; });
  $('#createBtn').disabled = !pending.length;
  const total = pending.reduce((n, f) => n + f.size, 0);
  $('#usum').textContent = pending.length ? `${plural(pending.length, 'file')}, ${fmtSize(total)}` : '';
}
function createCase() {
  const btn = $('#createBtn'); btn.disabled = true;
  const fd = new FormData();
  fd.append('title', $('#title').value.trim() || 'Untitled case');
  pending.forEach((f) => fd.append('files', f, f.name));
  const bar = $('#ubar'); bar.hidden = false;
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/cases');
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) { bar.firstElementChild.style.width = (100 * e.loaded / e.total) + '%'; $('#usum').textContent = `Uploading… ${Math.round(100 * e.loaded / e.total)}%`; } };
  xhr.onload = async () => {
    let j = null; try { j = JSON.parse(xhr.responseText); } catch (_) {}
    if (xhr.status >= 200 && xhr.status < 300 && j) { pending = []; await refreshList(); selectCase(j.caseId); }
    else { $('#uerr').textContent = (j && j.error) || 'Upload failed (HTTP ' + xhr.status + ')'; btn.disabled = false; bar.hidden = true; }
  };
  xhr.onerror = () => { $('#uerr').textContent = 'Network error during upload.'; btn.disabled = false; bar.hidden = true; };
  xhr.send(fd);
  $('#usum').textContent = 'Uploading…';
}

// ---------- case detail ----------
function evidenceTable(files) {
  return `<table class="evid"><thead><tr><th>Type</th><th>Exhibit</th><th class="num">Length</th><th class="num">Size</th></tr></thead><tbody>${
    files.map((f) => {
      const len = f.type === 'video' ? fmtDur(f.durationSec) : (f.pages ? plural(f.pages, 'page') : '');
      const note = f.error ? `<span class="note e">${esc(f.error)}</span>` : (f.note ? `<span class="note">${esc(f.note)}</span>` : '');
      return `<tr><td class="ty">${esc(TYPE_LABEL[f.type] || f.type || '')}</td>
        <td class="nm"><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.name)}</a>${note}</td>
        <td class="num">${esc(len) || '<span class="muted">—</span>'}</td>
        <td class="num">${fmtSize(f.size)}</td></tr>`;
    }).join('')}</tbody></table>`;
}
function findingsList(finds) {
  const tag = (s) => s === 'contradiction' ? ['contra', 'Contradiction'] : s === 'consistent' ? ['ok', 'Consistent'] : ['idle', s ? s.replace(/^./, (x) => x.toUpperCase()) : 'Open'];
  return `<ul class="finds">${finds.map((f) => { const [cls, label] = tag(f.status); return `<li><span class="fid">${esc(f.id || '')}</span><span class="tag ${cls}">${esc(label)}</span><span class="fs">${esc(f.summary || '')}</span></li>`; }).join('')}</ul>`;
}

async function selectCase(id) {
  current = id;
  history.replaceState(null, '', '?case=' + encodeURIComponent(id));
  if (es) { es.close(); es = null; }
  let c;
  try { c = await api('/api/cases/' + encodeURIComponent(id)); details.set(id, c); }
  catch (e) { $('#content').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  refreshList();
  const meta = await caseMeta(c);
  if (current !== id) return;
  const st = c.state || {};
  const hasWorld = !!st.world;
  const finds = st.findings || [];
  const n = (s) => finds.filter((f) => f.status === s).length;
  const v = verdictOf(c);
  const val = c.validation;
  const lr = lastRun(c);
  const rounds = (st.loopLog || []).length;
  const runParts = [];
  if (hasWorld && finds.length) runParts.push(`<span><b>${n('contradiction')}</b> contradiction${n('contradiction') === 1 ? '' : 's'} · ${n('consistent')} consistent${n('unverifiable') ? ` · ${n('unverifiable')} unverifiable` : ''}</span>`);
  if (val && val.total) runParts.push(`<span>Validated <b>${val.matched} of ${val.total}</b> facts against ${esc(val.source || 'published investigation')}</span>`);

  $('#content').innerHTML = `
    <div class="crumb"><a href="/cases.html">Cases</a> / <span class="mono">${esc(c.caseId)}</span></div>
    <h1>${esc(c.title)}</h1>
    <dl class="facts">
      <div><dt>Incident date</dt><dd>${esc(meta.date || '—')}</dd></div>
      <div><dt>Location</dt><dd>${esc(meta.location || '—')}</dd></div>
      <div><dt>Source</dt><dd>${esc(meta.source || '—')}</dd></div>
      <div><dt>Opened</dt><dd>${esc(fmtWhen(c.createdAt) || '—')}</dd></div>
    </dl>
    <div class="runline"><span class="tag ${v.cls}" id="verdictTag">${esc(v.label)}</span>${runParts.map((p) => '<span class="sep"></span>' + p).join('')}</div>
    ${lr ? `<div class="lastrun">Last run ${esc(lr)}${rounds ? ` · ${plural(rounds, 'round')}` : ''}</div>` : ''}
    <div class="actions">
      <button class="btn primary" id="runBtn">${hasWorld ? 'Re-run reconstruction' : 'Run reconstruction'}</button>
      ${hasWorld ? `<a class="btn" href="/?case=${encodeURIComponent(id)}">Open in viewer</a>` : ''}
    </div>
    <p class="modenote" id="modeNote">${modeNote()}</p>
    <div id="banner"></div>
    <div class="sect" id="progress" ${c.running || c.status === 'error' ? '' : 'hidden'}>
      <h3>Progress</h3>
      <div class="steps" id="steps"></div>
      <div id="log" aria-live="polite"></div>
    </div>
    ${hasWorld && finds.length ? `<div class="sect"><h3>Findings <span class="muted small">from the most recent run</span></h3>${findingsList(finds)}</div>` : ''}
    <div class="sect"><h3>Evidence <span class="muted small">${esc(evidenceCounts(c.files).join(' · '))}</span></h3>${evidenceTable(c.files || [])}</div>`;
  $('#runBtn').onclick = () => runCase(id);
  if (c.running) attachStream(id);
  else if (c.status === 'error' && c.error) { $('#progress').hidden = false; $('#runBtn').textContent = 'Retry reconstruction'; logLine({ step: 'error', message: c.error }, true); drawSteps(); }
}

const stepState = {};
function drawSteps() {
  const el = $('#steps'); if (!el) return;
  el.innerHTML = STEPS.map(([k, label]) => `<span class="step ${stepState[k] || ''}">${label}</span>`).join('') +
    (stepState.round ? `<span class="step active">Round ${stepState.round}</span>` : '');
}
function logLine(ev, isErr) {
  const log = $('#log'); if (!log) return;
  const d = document.createElement('div');
  const t = ev.at ? new Date(ev.at).toLocaleTimeString([], { hour12: false }) : new Date().toLocaleTimeString([], { hour12: false });
  const label = ev.step || ev.type || '';
  d.innerHTML = `<span class="t">${esc(t)}</span><span class="st">${esc(label)}${ev.round ? ' r' + esc(ev.round) : ''}</span><span class="${isErr ? 'e' : (ev.type === 'done' ? 'ok' : '')}">${esc(ev.message || (ev.type === 'start' ? 'Started (' + (ev.mode || '') + ' mode)' : ''))}</span>`;
  log.appendChild(d); log.scrollTop = log.scrollHeight;
}
function onEvent(id, ev) {
  if (ev.type === 'hello') { if (ev.mode && ev.mode !== modeName) { modeName = ev.mode; setModeBadge(); } return; }
  if (ev.type === 'progress' || ev.type === 'start') {
    const k = stepKey(ev);
    if (k) {
      const idx = STEPS.findIndex((s) => s[0] === k);
      STEPS.forEach(([sk], i) => { if (i < idx && stepState[sk] !== 'done') stepState[sk] = 'done'; });
      if (ev.round && ev.round !== stepState.round && ev.round > 1 && (k === 'render' || k === 'generate')) { STEPS.forEach(([sk]) => { stepState[sk] = (sk === 'extract' || sk === 'upload' || sk === 'generate') ? 'done' : ''; }); }
      if (ev.round) stepState.round = ev.round;
      stepState[k] = 'active';
    }
    logLine(ev);
  } else if (ev.type === 'error') {
    for (const [k] of STEPS) if (stepState[k] === 'active') stepState[k] = 'fail';
    logLine(ev, true);
    const rb = $('#runBtn'); if (rb) { rb.disabled = false; rb.textContent = 'Retry reconstruction'; }
    es && es.close(); es = null; refreshList();
  } else if (ev.type === 'done') {
    STEPS.forEach(([k]) => { stepState[k] = 'done'; });
    stepState.round = 0;
    es && es.close(); es = null; refreshList();
    const pm = ev.state && ev.state.pendingMore;
    if (pm) { askMoreRounds(id, pm); }
    else {
      logLine({ ...ev, step: 'done', message: 'Reconstruction complete. Opening the viewer…' });
      setTimeout(() => { location.href = '/?case=' + encodeURIComponent(id); }, 1600);
    }
  }
  drawSteps();
}
// After 3 correction rounds with world errors left, the user decides whether Argon keeps going.
function askMoreRounds(id, pm) {
  const box = document.createElement('div');
  box.className = 'ask-more';
  box.innerHTML = `<p><strong>${esc(pm.question)}</strong></p><p class="sub">These are errors in the reconstructed world (not findings). More rounds give Argon another try at fixing them.</p>` +
    `<button type="button" class="btn primary" data-more="3">Run 3 more rounds</button> <button type="button" class="btn" data-more="0">Stop and open the viewer</button>`;
  ($('#progress') || document.body).appendChild(box);
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-more]'); if (!b) return;
    const n = Number(b.dataset.more); box.remove();
    if (!n) { location.href = '/?case=' + encodeURIComponent(id); return; }
    try {
      await api(`/api/cases/${encodeURIComponent(id)}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ continue: true, rounds: n }) });
      attachStream(id);
    } catch (err) { logLine({ type: 'error', message: 'Could not start more rounds: ' + (err && err.message || err) }, true); }
  });
}
function attachStream(id) {
  Object.keys(stepState).forEach((k) => delete stepState[k]);
  $('#progress').hidden = false; $('#log').innerHTML = '';
  const rb = $('#runBtn'); if (rb) { rb.disabled = true; rb.textContent = 'Running…'; }
  const vt = $('#verdictTag'); if (vt) { vt.className = 'tag run'; vt.textContent = 'Running'; }
  drawSteps();
  es = new EventSource(`/api/cases/${encodeURIComponent(id)}/stream`);
  es.onmessage = (m) => { try { onEvent(id, JSON.parse(m.data)); } catch (_) {} };
  es.onerror = () => { /* browser auto-reconnects; history is replayed by the server */ };
}
async function runCase(id) {
  $('#banner').innerHTML = '';
  const btn = $('#runBtn'); btn.disabled = true;
  try {
    await api(`/api/cases/${encodeURIComponent(id)}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    attachStream(id);
  } catch (e) {
    btn.disabled = false;
    $('#banner').innerHTML = `<div class="banner">${esc(e.message)}${e.body && e.body.blockedOn ? ' <span class="muted">(waiting on: ' + esc(e.body.blockedOn) + ')</span>' : ''}</div>`;
  }
}

function setModeBadge() {
  const b = $('#modeBadge');
  b.textContent = modeName === 'live' ? 'LIVE · ARGON' : modeName === 'mock' ? 'MOCK · CACHED REPLAY' : 'SERVER OFFLINE';
  b.title = modeName ? `SIGHTLINE_MODE=${modeName} (from /api/health)` : '';
  const mn = $('#modeNote'); if (mn) mn.innerHTML = modeNote();
}

// ---------- boot ----------
$('#newBtn').onclick = showNew;
(async () => {
  try { const h = await api('/api/health'); modeName = h.mode || null; } catch (_) { modeName = null; }
  setModeBadge();
  await refreshList();
  const q = new URLSearchParams(location.search);
  const want = q.get('case');
  if (want) selectCase(want); else if (cases.length && !q.has('new')) selectCase(cases[0].caseId); else showNew();
})();
