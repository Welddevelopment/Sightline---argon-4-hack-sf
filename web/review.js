// Sightline — Review and confirm (B2). A lawyer reviews what Argon extracted from the evidence and signs off
// before the reconstruction is built. Contract: SPEC.md "## REVIEW & CONFIRM (12:10)".
// GET /api/cases/:id/extraction · POST /api/cases/:id/extraction/run · POST /api/cases/:id/confirm · POST /api/cases/:id/run
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;
const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

async function api(url, opts) {
  const r = await fetch(url, opts);
  let body = null;
  try { body = await r.json(); } catch { /* non-JSON */ }
  if (!r.ok) { const e = new Error((body && body.error) || `${r.status} ${r.statusText}`); e.status = r.status; e.body = body; throw e; }
  return body;
}
const post = (url, data) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) });

const q = new URLSearchParams(location.search);
const S = {
  id: q.get('case') || 'demo',
  c: null, ext: null, meta: null, confirmed: null, status: 'loading', error: null, mode: null,
  scene: {}, sceneEdited: new Set(), facts: [], vehicles: [], objects: [], witnesses: [],
  selWit: null, hoverWit: null, placing: null, srcKey: null, map: null, texts: new Map(),
};

// ---------- helpers: items, citations ----------
const isInferred = (it, cite) => (it && it.cited === false) || /inferred/i.test(String(cite ?? (it && it.citation) ?? ''));
const prep = (arr) => (Array.isArray(arr) ? arr : []).map((x, i) => ({ ...clone(x), id: x.id || `item${i + 1}`, _rej: false, _ed: false, _editing: false }));
const strip = (it) => { const o = {}; for (const [k, v] of Object.entries(it)) if (!k.startsWith('_')) o[k] = v; if (it._ed) o.edited = true; return o; };
// Short display name for the scene plan: drop parentheticals and anything after ';' or ',' ("Witness A (fictional; …)" → "Witness A").
const shortName = (w) => { const n = String(w.name || w.id || '').replace(/\s*\(.*$/, '').split(/[;,]/)[0].trim(); return n.length > 22 ? n.slice(0, 21) + '…' : n; };
const witLetter = (w, i) => { const m = /\b([A-Z])$/.exec(shortName(w)) || /^wit_(?:witness_)?([a-z0-9])$/i.exec(w.id || '') || /\b([A-Z])\b/.exec(shortName(w)); return (m ? m[1] : String(i + 1)).toUpperCase().slice(0, 2); };
const fmtPos = (p) => (Array.isArray(p) && p.length >= 2 && p.every(Number.isFinite)) ? `x ${p[0].toFixed(1)} m, z ${p[1].toFixed(1)} m` : null;
// Where Argon originally put a witness (before any drag), and how far the reviewer moved it.
const origPos = (w) => { const o = ((S.ext && S.ext.witnesses) || []).find((x) => x.id === w.id); return o && hasPos(o.markedPosition) ? o.markedPosition.map(Number) : null; };
const movedBy = (w) => { const o = origPos(w); if (!o || !hasPos(w.markedPosition)) return 0; const p = w.markedPosition.map(Number); return Math.hypot(p[0] - o[0], p[1] - o[1]); };
const hasPos = (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(+p[0]) && Number.isFinite(+p[1]) && p[0] !== null && p[1] !== null;

function tsToSec(ts) {
  const parts = String(ts).split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((a, n) => a * 60 + n, 0);
}
const stem = (n) => String(n || '').toLowerCase().replace(/\.[^.]+$/, '').replace(/[_\-]+/g, ' ').trim();
function findFile(name) {
  const files = (S.c && S.c.files) || [];
  if (!name) return null;
  const base = String(name).split('/').pop().toLowerCase();
  return files.find((f) => f.name.toLowerCase() === base) || files.find((f) => stem(f.name) === stem(base)) || null;
}
// Resolve a citation (+ optional structured source) to something we can open.
function resolveSource(citation, source) {
  const files = (S.c && S.c.files) || [];
  const videos = files.filter((f) => f.type === 'video');
  const cite = String(citation || '');
  const pickVideo = (fname) => { const f = findFile(fname); return f && f.type === 'video' ? f : videos[0] || null; };
  if (source && source.timestamp) {
    const v = pickVideo(source.file); const t = tsToSec(source.timestamp);
    if (v && t != null) return { kind: 'video', file: v, t, ts: source.timestamp };
  }
  if (source && source.file) {
    const f = findFile(source.file);
    if (f && f.type === 'video') { const m = /(\d{1,2}:\d{2}(?::\d{2})?)/.exec(cite); return { kind: 'video', file: f, t: m ? tsToSec(m[1]) : 0, ts: m ? m[1] : '0:00' }; }
    if (f) return { kind: 'doc', file: f, page: Number.isFinite(+source.page) && source.page != null ? +source.page : null };
  }
  const dm = /\b(?:depo(?:sition)?|video|vid)\b[^0-9]{0,40}?(\d{1,2}:\d{2}(?::\d{2})?)/i.exec(cite);
  if (dm && videos.length) return { kind: 'video', file: videos[0], t: tsToSec(dm[1]), ts: dm[1] };
  const pm = /\bp(?:age|g)?\.?\s*(\d+)/i.exec(cite);
  const fm = /([\w.\-]+\.(?:md|txt|pdf|docx|srt|vtt|rtf|csv|mp4|mov|webm))/i.exec(cite);
  let f = fm ? findFile(fm[1]) : null;
  if (!f) { const lc = cite.toLowerCase().replace(/[_\-]+/g, ' '); f = files.filter((x) => x.type !== 'image').find((x) => stem(x.name).length > 3 && lc.includes(stem(x.name))) || null; }
  if (f && f.type === 'video') { const tm = /(\d{1,2}:\d{2}(?::\d{2})?)/.exec(cite); return { kind: 'video', file: f, t: tm ? tsToSec(tm[1]) : 0, ts: tm ? tm[1] : '0:00' }; }
  if (f) return { kind: 'doc', file: f, page: pm ? +pm[1] : null };
  return null;
}

let chipSeq = 0;
const chipReg = new Map();
function chip(citation, source, opts = {}) {
  const cite = citation || '';
  const inf = opts.inferred ?? /inferred/i.test(cite);
  const src = resolveSource(cite, source);
  if (!cite && !src) return '<span class="chip none">no citation</span>';
  const key = 'c' + (++chipSeq);
  chipReg.set(key, { cite, src, hl: opts.hl });
  const cls = ['chip', src ? src.kind === 'video' ? 'k-vid' : 'k-doc' : 'none', inf ? 'inf' : '', S.srcKey === cite ? 'on' : ''].join(' ');
  const title = src ? (src.kind === 'video' ? `Play ${src.file.name} at ${src.ts}` : `Open ${src.file.name}${src.page ? ' at page ' + src.page : ''}`) : 'Source not found in this case';
  return `<button type="button" class="${cls}" data-chip="${key}" title="${esc(title + ' — ' + cite)}">${src ? '<i></i>' : ''}<span>${esc(cite || src.file.name)}</span></button>`;
}
const badge = (inf) => inf ? '<span class="bdg inf" title="Not stated in the evidence; inferred by the model">inferred</span>' : '<span class="bdg cited" title="Stated in the cited source">cited</span>';
function conf(c) {
  if (c == null || !Number.isFinite(+c)) return '<span class="muted small">—</span>';
  const p = Math.round(Math.max(0, Math.min(1, +c)) * 100);
  return `<span class="conf ${p < 60 ? 'lo' : ''}" title="Model confidence"><span class="b"><i style="width:${p}%"></i></span>${p}%</span>`;
}

// ---------- source viewer ----------
async function caseText(f) {
  if (!f.textUrl) return null;
  if (!S.texts.has(f.textUrl)) S.texts.set(f.textUrl, fetch(f.textUrl).then((r) => (r.ok ? r.text() : null)).catch(() => null));
  return S.texts.get(f.textUrl);
}
function parseSrt(txt) {
  const cues = [];
  for (const blk of String(txt || '').split(/\r?\n\r?\n/)) {
    const m = /(\d+):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{3})/.exec(blk);
    if (!m) continue;
    const a = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000, b = +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 1000;
    cues.push({ a, b, text: blk.split(/\r?\n/).slice(2).join(' ').trim() });
  }
  return cues;
}
async function captionsFor(video) {
  const files = (S.c && S.c.files) || [];
  const st = stem(video.name);
  const srt = files.find((f) => /\.(srt|vtt)$/i.test(f.name) && stem(f.name) === st) || files.find((f) => /\.(srt|vtt)$/i.test(f.name));
  if (!srt) return [];
  return parseSrt(await caseText(srt));
}
const fmtTs = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

async function openSource(key) {
  const reg = chipReg.get(key);
  if (!reg || !reg.src) return;
  const { cite, src, hl } = reg;
  S.srcKey = cite;
  document.querySelectorAll('.chip.on').forEach((c) => c.classList.remove('on'));
  document.querySelectorAll(`.chip[data-chip]`).forEach((c) => { const r = chipReg.get(c.dataset.chip); if (r && r.cite === cite) c.classList.add('on'); });
  const card = $('#srcCard'); card.hidden = false;
  $('#srcCite').textContent = cite;
  const body = $('#srcBody');
  if (src.kind === 'video') {
    body.innerHTML = `<div class="srcv"><video id="srcVideo" controls preload="metadata" playsinline src="${esc(src.file.url)}#t=${src.t}"></video>
      <div class="cap"><span>${esc(src.file.name)} · seeking to <b class="mono">${esc(fmtTs(src.t))}</b></span><a href="${esc(src.file.url)}" target="_blank" rel="noopener">open file</a></div>
      <div class="doc" id="srcCap" style="max-height:130px;margin-top:8px;font-size:12px"></div></div>`;
    const v = $('#srcVideo');
    const seek = () => { try { v.currentTime = src.t; } catch { /* */ } v.play().catch(() => { /* autoplay blocked; user presses play */ }); };
    if (v.readyState >= 1) seek(); else v.addEventListener('loadedmetadata', seek, { once: true });
    const cues = await captionsFor(src.file);
    const capEl = $('#srcCap');
    if (!capEl) return;
    if (!cues.length) { capEl.remove(); return; }
    const near = cues.filter((c) => c.b >= src.t - 12 && c.a <= src.t + 16);
    capEl.innerHTML = near.map((c) => {
      const on = c.a <= src.t + 0.5 && c.b >= src.t - 0.5;
      return `<div${on ? ' style="color:#fff"' : ''}><span class="mono" style="color:${on ? 'var(--accent)' : '#6f7c90'};font-size:10.5px;margin-right:8px">${fmtTs(c.a)}</span>${on ? '<mark>' + esc(c.text) + '</mark>' : esc(c.text)}</div>`;
    }).join('') || '<span class="muted">No transcript lines near this moment.</span>';
    v.addEventListener('timeupdate', () => {
      const t = v.currentTime; const c = cues.find((x) => t >= x.a && t <= x.b);
      if (c && capEl.dataset.a !== String(c.a)) { capEl.dataset.a = String(c.a); }
    });
    return;
  }
  // document
  body.innerHTML = `<div class="srcv"><div class="doc" id="srcDoc"><span class="spin"></span>Loading ${esc(src.file.name)}…</div>
    <div class="cap"><span>${esc(src.file.name)}${src.page ? ' · page ' + src.page : ''}</span><a href="${esc(src.file.url)}" target="_blank" rel="noopener">open original</a></div></div>`;
  const txt = await caseText(src.file);
  const el = $('#srcDoc');
  if (!el) return;
  if (txt == null) { el.innerHTML = `<span class="muted">No extracted text for this file. <a href="${esc(src.file.url)}" target="_blank" rel="noopener" style="color:var(--accent)">Open the original</a>.</span>`; return; }
  const needles = [hl].filter((n) => n != null && String(n).trim().length >= 2).map((n) => String(n).trim());
  const mark = (s) => {
    let h = esc(s);
    for (const n of needles) { const re = new RegExp(esc(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'); h = h.replace(re, (m) => `<mark>${m}</mark>`); }
    return h;
  };
  const parts = txt.split(/\[\[page (\d+)\]\]\n?/);
  if (parts.length > 1) {
    let html = mark(parts[0]);
    for (let i = 1; i < parts.length; i += 2) html += `<span class="pg${+parts[i] === src.page ? ' hit' : ''}" data-pg="${parts[i]}">PAGE ${parts[i]}</span>` + mark(parts[i + 1] || '');
    el.innerHTML = html;
  } else {
    el.innerHTML = (src.page ? `<span class="pg hit">PAGE ${src.page} (single-page text; page cited by the model)</span>` : '') + mark(txt);
  }
  const target = (src.page && el.querySelector(`.pg[data-pg="${src.page}"]`)) || null;
  const scope = target ? [...el.querySelectorAll('mark')].find((m) => target.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING) : el.querySelector('mark');
  const to = scope || target;
  if (to) el.scrollTop = Math.max(0, to.offsetTop - el.offsetTop - 40);
}
$('#srcClose').onclick = () => { $('#srcCard').hidden = true; const v = $('#srcVideo'); if (v) v.pause(); S.srcKey = null; document.querySelectorAll('.chip.on').forEach((c) => c.classList.remove('on')); };

// ---------- render ----------
function renderMeta() {
  const m = S.meta || {}, e = S.ext || {};
  const model = m.model || null;
  const parts = [];
  if (S.status === 'ready' && (model || m.seconds != null)) {
    const secs = m.seconds != null && Number.isFinite(+m.seconds) ? `${(+m.seconds).toFixed(+m.seconds < 10 ? 1 : 0)} s` : null;
    parts.push(`<span>Extracted by <span class="model">${esc(model || 'Argon')}</span>${secs ? ` in <b>${esc(secs)}</b>` : ''}</span>`);
  } else if (S.status === 'ready') parts.push('<span>Extracted by Argon</span>');
  const mode = m.mode || e.mode;
  if (mode) parts.push(`<span>${esc(mode === 'mock' ? 'cached run (mock)' : mode === 'live-cached' ? 'live, cached' : mode)}</span>`);
  const u = m.usage;
  if (u && (u.promptTokens || u.outputTokens)) parts.push(`<span class="mono small">${(+u.promptTokens || 0).toLocaleString()} in · ${(+u.outputTokens || 0).toLocaleString()} out tokens</span>`);
  const when = m.finishedAt || e.createdAt;
  if (when) { const d = new Date(when); if (!isNaN(d)) parts.push(`<span>${esc(d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span>`); }
  const html = parts.join('<span class="sep"></span>');
  const rerun = S.status === 'ready' || S.status === 'error' ? `<button class="btn sm ghost rerun" id="reExtract">Re-run extraction</button>` : '';
  $('#meta').innerHTML = html + rerun;
  const rb = $('#reExtract'); if (rb) rb.onclick = () => runExtraction();
}

function sceneHtml() {
  const s = S.scene || {};
  const f = (k, label, wide) => `<div class="cell${wide ? ' wide' : ''}"><label for="sc_${k}">${label}</label><input id="sc_${k}" data-scene="${k}" value="${esc(s[k] ?? '')}" class="${S.sceneEdited.has(k) ? 'ed' : ''}" placeholder="—"></div>`;
  const inf = isInferred(s, s.citation);
  return `<div class="sect"><div class="sect-h"><h3>Scene</h3><span class="muted">Where and when; edit any field</span></div>
    <div class="scene">${f('date', 'Date')}${f('time', 'Time')}${f('location', 'Location', true)}${f('weather', 'Weather')}</div>
    <div class="scene" style="margin-top:-1px;border-top-left-radius:0;border-top-right-radius:0">${f('lighting', 'Lighting')}
      <div class="cell"><label>Lat / lon</label><div class="mono small" style="padding:4px 0">${Number.isFinite(+s.lat) && s.lat != null ? (+s.lat).toFixed(4) + ', ' + (+s.lon).toFixed(4) : '—'}</div></div>
      <div class="cell wide" style="grid-column: span 3"><label>Source</label><div style="display:flex;gap:8px;align-items:center">${chip(s.citation, s.source, { inferred: inf })}${badge(inf)}${S.sceneEdited.size ? '<span class="bdg edt">edited</span>' : ''}</div></div></div></div>`;
}

function factsHtml() {
  const rows = S.facts.map((f, i) => {
    const inf = isInferred(f, f.citation);
    const cls = [f._rej ? 'rej' : '', f._ed ? 'ed' : ''].join(' ');
    if (f._editing) {
      return `<tr class="${cls}" data-fact="${i}"><td class="id">${esc(f.id)}</td>
        <td><input data-k="label" value="${esc(f.label)}"></td>
        <td class="val"><input class="n" data-k="value" value="${esc(f.value)}"> <input class="u" data-k="unit" value="${esc(f.unit ?? '')}" placeholder="unit"></td>
        <td>${chip(f.citation, f.source, { inferred: inf, hl: f.value })}</td><td>${badge(inf)}</td><td class="hide-sm">${conf(f.confidence)}</td>
        <td class="act"><button class="ib ok" data-act="save">Save</button><button class="ib" data-act="cancel">Cancel</button></td></tr>`;
    }
    return `<tr class="${cls}" data-fact="${i}"><td class="id">${esc(f.id)}</td>
      <td class="lbl">${esc(f.label)}${f._ed ? '<span class="bdg edt">edited</span>' : ''}</td>
      <td class="val">${esc(f.value ?? '—')}${f.unit ? `<span class="u">${esc(f.unit)}</span>` : ''}</td>
      <td>${chip(f.citation, f.source, { inferred: inf, hl: f.value })}</td><td>${badge(inf)}</td><td class="hide-sm">${conf(f.confidence)}</td>
      <td class="act">${f._rej ? '<button class="ib" data-act="restore">Restore</button>' : '<button class="ib" data-act="edit">Edit</button><button class="ib rej" data-act="reject">Reject</button>'}</td></tr>`;
  }).join('');
  const nInf = S.facts.filter((f) => isInferred(f, f.citation)).length;
  return `<div class="sect"><div class="sect-h"><h3>Facts</h3><span class="muted">${S.facts.length} extracted${nInf ? ` · <span style="color:var(--accent)">${nInf} inferred</span>, check these first` : ''}</span></div>
    ${S.facts.length ? `<table class="tbl" id="factsTbl"><thead><tr><th>ID</th><th>Fact</th><th>Value</th><th>Source</th><th>Basis</th><th class="hide-sm">Confidence</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="muted small">No facts extracted.</div>'}</div>`;
}

function itemsHtml(kind, arr, title, sub) {
  if (!arr.length) return '';
  const cards = arr.map((it, i) => {
    const inf = isInferred(it, it.citation);
    const head = kind === 'veh' ? (it.type || 'vehicle') : (it.kind || 'object');
    const desc = kind === 'veh' ? (it.description || it.label || it.id) : (it.label || it.description || it.id);
    return `<div class="item${it._rej ? ' rej' : ''}" data-${kind}="${i}"><span class="k">${esc(head)} <span style="color:#56627a">· ${esc(it.id)}</span></span>
      <span>${it._rej ? '<button class="ib" data-act="restore">Restore</button>' : '<button class="ib rej" data-act="reject">Reject</button>'}</span>
      <div class="d">${esc(desc)}</div>
      <div class="c">${chip(it.citation, it.source, { inferred: inf })}${kind === 'obj' ? `<span class="pos">${esc(fmtPos(it.position) || 'position unknown')}</span>` : badge(inf)}</div></div>`;
  }).join('');
  return `<div class="sect"><div class="sect-h"><h3>${title}</h3><span class="muted">${sub}</span></div><div class="list" id="${kind}List">${cards}</div></div>`;
}

function witnessesHtml() {
  const rows = S.witnesses.map((w, i) => {
    const pos = hasPos(w.markedPosition) ? fmtPos(w.markedPosition.map(Number)) : null;
    const cls = [w._rej ? 'rej' : '', w._ed ? 'ed' : '', S.selWit === i ? 'sel' : ''].join(' ');
    const mv = movedBy(w), posLine = pos ? `<span class="wpos">${esc(pos)} ${chip(w.positionCitation, null, {})}${mv >= 0.1 ? `<span class="moved">moved ${mv.toFixed(1)} m from extracted ${esc(fmtPos(origPos(w)))}</span>` : ''}</span>` : `<span class="wpos unk">Position not marked · <button class="ib ok" data-act="place">Place on plan</button></span>`;
    if (w._editing) {
      return `<tr class="${cls}" data-wit="${i}"><td><span class="wit-dot">${esc(witLetter(w, i))}</span></td>
        <td><input data-k="name" value="${esc(w.name)}">${posLine}</td>
        <td class="num"><input class="n" data-k="eyeHeight" value="${esc(w.eyeHeight ?? '')}" style="width:60px"></td>
        <td><input data-k="observationTime" value="${esc(w.observationTime ?? '')}" style="width:110px"></td>
        <td><textarea data-k="claim">${esc(w.claim)}</textarea></td>
        <td>${chip(w.claimCitation, w.claimSource, { hl: null })}</td>
        <td class="act"><button class="ib ok" data-act="save">Save</button><button class="ib" data-act="cancel">Cancel</button></td></tr>`;
    }
    return `<tr class="${cls}" data-wit="${i}"><td><span class="wit-dot">${esc(witLetter(w, i))}</span></td>
      <td><span class="wit-name">${esc(w.name || w.id)}${w._ed ? '<span class="bdg edt">edited</span>' : ''}</span>${posLine}</td>
      <td class="num">${w.eyeHeight != null ? esc(w.eyeHeight) + ' m' : '—'}</td>
      <td class="mono small">${esc(w.observationTime ?? '—')}</td>
      <td class="claim"><q>${esc(w.claim || '')}</q></td>
      <td>${chip(w.claimCitation, w.claimSource, {})}</td>
      <td class="act">${w._rej ? '<button class="ib" data-act="restore">Restore</button>' : '<button class="ib" data-act="edit">Edit</button><button class="ib rej" data-act="reject">Reject</button>'}</td></tr>`;
  }).join('');
  return `<div class="sect"><div class="sect-h"><h3>Witnesses</h3><span class="muted">${S.witnesses.length} found · drag markers on the scene plan to correct marked positions</span></div>
    ${S.witnesses.length ? `<table class="tbl" id="witTbl"><thead><tr><th></th><th>Witness · marked position</th><th class="num">Eye ht</th><th>Observed at</th><th>Claim</th><th>Source</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="muted small">No witnesses extracted.</div>'}</div>`;
}

function renderBody() {
  chipReg.clear();
  const b = $('#body');
  if (S.status === 'loading') { b.innerHTML = '<div class="empty"><span class="spin"></span>Loading extraction…</div>'; return; }
  if (S.status === 'none') {
    b.innerHTML = `<div class="banner warn">Argon has not extracted this case yet.<button class="btn primary sm" id="runExt">Run extraction</button></div>`;
    $('#runExt').onclick = () => runExtraction(); return;
  }
  if (S.status === 'running') { b.innerHTML = `<div class="banner warn"><span><span class="spin"></span>Argon is reading the evidence (documents, images and video). This page updates when it finishes.</span></div>`; return; }
  if (S.status === 'error' && !S.ext) {
    b.innerHTML = `<div class="banner bad">Extraction failed: ${esc(S.error || 'unknown error')}<button class="btn sm" id="runExt">Try again</button></div>`;
    const r = $('#runExt'); if (r) r.onclick = () => runExtraction(); return;
  }
  if (S.status === 'missing') { b.innerHTML = `<div class="banner bad">${esc(S.error)}</div>`; return; }
  const conf = S.confirmed;
  const banner = conf ? `<div class="banner">Confirmed by <b>${esc(conf.confirmedBy || 'unknown')}</b> · ${esc(new Date(conf.confirmedAt).toLocaleString())}. The reconstruction uses these inputs.<button class="btn sm" id="clearConf">Clear confirmation</button></div>` : '';
  const stale = conf && S.ext && conf.extractionCreatedAt && S.ext.createdAt && conf.extractionCreatedAt !== S.ext.createdAt ? '<div class="banner warn">A newer extraction exists than the one you confirmed. Review and confirm again.</div>' : '';
  const errB = S.status === 'error' ? `<div class="banner bad">Latest extraction run failed: ${esc(S.error || '')}. Showing the previous result.</div>` : '';
  const nt = S.ext && S.ext.notes ? String(S.ext.notes) : '';
  const notes = nt ? `<details class="notes"><summary><b>Model notes</b><span>${esc(nt.length > 220 ? nt.slice(0, 220).replace(/\s+\S*$/, '') + '…' : nt)}</span></summary>${nt.length > 220 ? `<div class="nfull">${esc(nt).replace(/ (\d+)\. (?=[A-Z])/g, '<br><br>$1. ')}</div>` : ''}</details>` : '';
  b.innerHTML = banner + stale + errB + notes + sceneHtml() + factsHtml() + witnessesHtml() +
    itemsHtml('veh', S.vehicles, 'Vehicles', `${S.vehicles.length} identified`) +
    itemsHtml('obj', S.objects, 'Scene objects', `${S.objects.length} found · occluders, signs, structures`);
  const cc = $('#clearConf'); if (cc) cc.onclick = clearConfirmation;
}

function renderTally() {
  const all = [...S.facts, ...S.witnesses, ...S.vehicles, ...S.objects];
  const kept = all.filter((x) => !x._rej);
  const ed = kept.filter((x) => x._ed).length + (S.sceneEdited.size ? 1 : 0);
  const rej = all.length - kept.length;
  const inf = kept.filter((x) => isInferred(x, x.citation ?? x.claimCitation)).length;
  $('#tally').innerHTML = `<div><b>${kept.length}</b><span>Accepted</span></div><div class="a"><b>${ed}</b><span>Edited</span></div><div class="r"><b>${rej}</b><span>Rejected</span></div><div class="a"><b>${inf}</b><span>Inferred</span></div>`;
  const name = $('#confirmedBy').value.trim();
  const btn = $('#confirmBtn');
  btn.disabled = !(S.status === 'ready' || (S.status === 'error' && S.ext)) || !name || S.busy;
  btn.title = !name ? 'Enter your name to sign off' : '';
}
function renderAll() { renderMeta(); renderBody(); renderTally(); drawMap(); }

// ---------- events (delegated) ----------
$('#body').addEventListener('click', (e) => {
  const ch = e.target.closest('[data-chip]');
  if (ch) { openSource(ch.dataset.chip); return; }
  const btn = e.target.closest('[data-act]');
  const frow = e.target.closest('[data-fact]'), wrow = e.target.closest('[data-wit]');
  const vrow = e.target.closest('[data-veh]'), orow = e.target.closest('[data-obj]');
  if (wrow && !btn && !e.target.closest('input,textarea')) { S.selWit = +wrow.dataset.wit; renderBody(); drawMap(); return; }
  if (!btn) return;
  const act = btn.dataset.act;
  const row = frow || wrow || vrow || orow;
  const arr = frow ? S.facts : wrow ? S.witnesses : vrow ? S.vehicles : orow ? S.objects : null;
  if (!arr) return;
  const it = arr[+(row.dataset.fact ?? row.dataset.wit ?? row.dataset.veh ?? row.dataset.obj)];
  if (act === 'reject') { it._rej = true; it._editing = false; }
  else if (act === 'restore') it._rej = false;
  else if (act === 'edit') it._editing = true;
  else if (act === 'cancel') it._editing = false;
  else if (act === 'place') { S.placing = +row.dataset.wit; S.selWit = S.placing; $('#mapNote').textContent = 'Click the plan to place this witness'; }
  else if (act === 'save') {
    row.querySelectorAll('[data-k]').forEach((inp) => {
      const k = inp.dataset.k; let v = inp.value.trim();
      const old = it[k];
      if (typeof old === 'number' || k === 'eyeHeight') { const n = Number(v); if (v !== '' && Number.isFinite(n)) v = n; }
      if (String(old ?? '') !== String(v)) { it[k] = v; it._ed = true; }
    });
    it._editing = false;
  }
  renderBody(); renderTally(); drawMap();
});
$('#body').addEventListener('change', (e) => {
  const k = e.target.dataset && e.target.dataset.scene;
  if (!k) return;
  const v = e.target.value.trim();
  if (String(S.scene[k] ?? '') !== v) { S.scene[k] = v; S.sceneEdited.add(k); e.target.classList.add('ed'); renderTally(); }
});
$('#body').addEventListener('mouseover', (e) => { const r = e.target.closest('[data-wit]'); const v = r ? +r.dataset.wit : null; if (v !== S.hoverWit) { S.hoverWit = v; drawMap(); } });
$('#body').addEventListener('mouseleave', () => { S.hoverWit = null; drawMap(); });
$('#body').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.tbl input')) { const s = e.target.closest('tr').querySelector('[data-act="save"]'); if (s) s.click(); }
  if (e.key === 'Escape' && e.target.matches('.tbl input, .tbl textarea')) { const s = e.target.closest('tr').querySelector('[data-act="cancel"]'); if (s) s.click(); }
});
$('#confirmedBy').addEventListener('input', () => { lsSet('sightline.reviewer', $('#confirmedBy').value); renderTally(); });

// ---------- scene plan (canvas) ----------
const cv = $('#map'), ctx = cv.getContext('2d');
const PLAN_RADIUS_M = 150;
let view = null; // { w, h, toPx([x,z]) -> [px,py], toM([px,py]) -> [x,z], ppm }
function mapConfig() {
  const m = (S.c && S.c.map) || (S.ext && S.ext.map) || null;
  const files = (S.c && S.c.files) || [];
  const img = (m && (findFile(m.file || m.image))) || files.find((f) => f.type === 'image' && /map|plan|diagram|exhibit/i.test(f.name)) || null;
  const scaled = m && Number.isFinite(+m.px_per_m) && +m.px_per_m > 0;
  return { imgFile: img, scaled, ppm: scaled ? +m.px_per_m : null, origin: m && Array.isArray(m.origin_px) ? m.origin_px.map(Number) : null };
}
// Fallback when the case manifest has an exhibit map but no scale block: the shared exhibit
// manifest (case/case.json) carries {file, px_per_m, origin_px} for the same Exhibit 4 image.
// Used only when the file names match and the loaded image has the same pixel size.
async function refMapScale(imgFile) {
  try {
    const r = await fetch('/case/case.json'); if (!r.ok) return null;
    const m = (await r.json()).map;
    if (!m || !(+m.px_per_m > 0) || !Array.isArray(m.origin_px)) return null;
    const base = (s) => String(s || '').split('/').pop().toLowerCase();
    return base(m.file) === base(imgFile.name) ? m : null;
  } catch { return null; }
}
async function loadMap() {
  const cfg = mapConfig();
  S.map = { ...cfg, img: null };
  if (cfg.imgFile && !cfg.scaled) {
    const m = await refMapScale(cfg.imgFile);
    if (m) Object.assign(S.map, { scaled: true, ppm: +m.px_per_m, origin: m.origin_px.map(Number), scaleSrc: 'case/case.json' });
    Object.assign(cfg, S.map);
  }
  if (cfg.imgFile && cfg.scaled) {
    const im = new Image();
    im.onload = () => { S.map.img = im; if (!S.map.origin) S.map.origin = [im.naturalWidth / 2, im.naturalHeight / 2]; drawMap(); };
    im.src = cfg.imgFile.url;
  }
}
function positions() {
  const pts = [[0, 0]];
  S.witnesses.forEach((w) => hasPos(w.markedPosition) && pts.push(w.markedPosition.map(Number)));
  S.objects.forEach((o) => hasPos(o.position) && pts.push(o.position.map(Number)));
  // Keep the plan readable: far-away items (e.g. a driver 400 m down the road) are drawn as edge pointers instead.
  return pts.filter((p) => Math.hypot(p[0], p[1]) <= PLAN_RADIUS_M);
}
function computeView() {
  const cssW = cv.parentElement.clientWidth || 420;
  const dpr = window.devicePixelRatio || 1;
  let cssH, toPx, toM, ppm;
  if (S.map && S.map.img) {
    const im = S.map.img, k = cssW / im.naturalWidth;
    cssH = Math.round(im.naturalHeight * k);
    const o = S.map.origin, p = S.map.ppm;
    ppm = p * k;
    toPx = ([x, z]) => [(o[0] + x * p) * k, (o[1] + z * p) * k];
    toM = ([px, py]) => [(px / k - o[0]) / p, (py / k - o[1]) / p];
  } else {
    cssH = Math.round(cssW * 0.72);
    const pts = positions();
    let x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
    let z0 = Math.min(...pts.map((p) => p[1])), z1 = Math.max(...pts.map((p) => p[1]));
    const pad = 10; x0 -= pad; x1 += pad; z0 -= pad; z1 += pad;
    const minSpan = 50;
    if (x1 - x0 < minSpan) { const c = (x0 + x1) / 2; x0 = c - minSpan / 2; x1 = c + minSpan / 2; }
    if (z1 - z0 < minSpan * 0.72) { const c = (z0 + z1) / 2; z0 = c - minSpan * 0.36; z1 = c + minSpan * 0.36; }
    ppm = Math.min(cssW / (x1 - x0), cssH / (z1 - z0));
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    toPx = ([x, z]) => [cssW / 2 + (x - cx) * ppm, cssH / 2 + (z - cz) * ppm];
    toM = ([px, py]) => [cx + (px - cssW / 2) / ppm, cz + (py - cssH / 2) / ppm];
  }
  if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) { cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr); }
  cv.style.height = cssH + 'px';
  view = { w: cssW, h: cssH, dpr, toPx, toM, ppm };
}
const EDGE = 16;
function offPlan(px, py) { return px < EDGE || py < EDGE || px > view.w - EDGE || py > view.h - EDGE; }
function clampEdge(px, py) {
  // project from the plan centre to the inset border
  const cx = view.w / 2, cy = view.h / 2, dx = px - cx, dy = py - cy;
  const k = Math.min((cx - EDGE) / Math.abs(dx || 1e-9), (cy - EDGE) / Math.abs(dy || 1e-9));
  return [cx + dx * Math.min(1, k), cy + dy * Math.min(1, k), Math.atan2(dy, dx)];
}
const compass = (x, z) => { const d = Math.hypot(x, z); const dir = (Math.abs(x) > Math.abs(z) * 2 ? '' : z < 0 ? 'N' : 'S') + (Math.abs(z) > Math.abs(x) * 2 ? '' : x > 0 ? 'E' : 'W'); return `${Math.round(d)} m ${dir}`; };
// Label placement: every label/marker rect drawn this frame is recorded; a new label slides
// vertically to the nearest free slot so labels never stack on top of each other.
let occ = [];
const hits = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
function place(x, y, w, h) {
  for (const d of [0, 15, -15, 30, -30, 45, -45, 60, -60]) {
    const r = [x, Math.max(1, Math.min(view.h - h - 1, y + d)), w, h];
    if (!occ.some((o) => hits(r, o))) { occ.push(r); return r[1]; }
  }
  occ.push([x, y, w, h]); return y;
}
function edgeLabel(px, py, text) {
  ctx.font = '600 10px ' + getComputedStyle(document.body).getPropertyValue('--sans');
  const tw = ctx.measureText(text).width;
  // sit beside the pointer, hugging the border it is on, so it never covers the plan centre
  let lx = px - (tw + 8) / 2, ly = py + (py > view.h / 2 ? -16 : 16);
  if (px < EDGE + 2) { lx = px + 2; } else if (px > view.w - EDGE - 2) { lx = px - tw - 10; }
  lx = Math.max(2, Math.min(view.w - tw - 10, lx));
  ly = Math.max(10, Math.min(view.h - 10, ly));
  ly = place(lx, ly - 8, tw + 8, 16) + 8;
  ctx.fillStyle = 'rgba(8,11,16,.85)'; ctx.fillRect(lx, ly - 8, tw + 8, 16);
  ctx.fillStyle = '#e8ecf2'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, lx + 4, ly);
}
function niceStep(ppm, targetPx) { const raw = targetPx / ppm; const p = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) || 10 * p; }
function drawMap() {
  if (!S.map) return;
  computeView();
  const { w, h, dpr, toPx, toM, ppm } = view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const note = $('#mapNote');
  if (S.map.img) {
    ctx.globalAlpha = 0.85; ctx.drawImage(S.map.img, 0, 0, w, h); ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(8,11,16,.25)'; ctx.fillRect(0, 0, w, h);
    if (S.placing == null) note.textContent = `${S.map.imgFile.name} · ${S.map.ppm} px/m${S.map.scaleSrc ? ' (scale: exhibit manifest)' : ''}`;
  } else {
    ctx.fillStyle = '#0c1016'; ctx.fillRect(0, 0, w, h);
    const step = niceStep(ppm, 34);
    const [mx0, mz0] = toM([0, 0]), [mx1, mz1] = toM([w, h]);
    ctx.lineWidth = 1;
    for (let x = Math.ceil(mx0 / step) * step; x <= mx1; x += step) { const [px] = toPx([x, 0]); ctx.strokeStyle = Math.abs(x) < 1e-6 ? '#3a4658' : '#18202b'; ctx.beginPath(); ctx.moveTo(Math.round(px) + .5, 0); ctx.lineTo(Math.round(px) + .5, h); ctx.stroke(); }
    for (let z = Math.ceil(mz0 / step) * step; z <= mz1; z += step) { const [, py] = toPx([0, z]); ctx.strokeStyle = Math.abs(z) < 1e-6 ? '#3a4658' : '#18202b'; ctx.beginPath(); ctx.moveTo(0, Math.round(py) + .5); ctx.lineTo(w, Math.round(py) + .5); ctx.stroke(); }
    if (S.placing == null) note.textContent = S.map.imgFile ? `${S.map.imgFile.name} has no scale; grid ${step} m` : `Grid · ${step} m squares`;
  }
  // reference point
  const [ox, oy] = toPx([0, 0]);
  ctx.strokeStyle = '#9aa6b8'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(ox, oy, 6, 0, Math.PI * 2); ctx.moveTo(ox - 10, oy); ctx.lineTo(ox + 10, oy); ctx.moveTo(ox, oy - 10); ctx.lineTo(ox, oy + 10); ctx.stroke();
  // reserve witness markers + name tags first (highest priority), then off-plan witness pointers
  occ = [];
  const sans = getComputedStyle(document.body).getPropertyValue('--sans');
  S.witnesses.forEach((wt) => {
    if (!hasPos(wt.markedPosition)) return;
    const [px, py] = toPx(wt.markedPosition.map(Number));
    if (offPlan(px, py)) return;
    ctx.font = '600 10.5px ' + sans;
    occ.push([px - 11, py - 11, 22, 22]);
    ctx.font = '600 10.5px ' + sans;
    const lbl = shortName(wt) + (wt._ed ? ' · moved' : ''), tw = ctx.measureText(lbl).width;
    const lx = px + tw + 22 > w ? px - tw - 20 : px + 12;
    wt._lr = [lx, place(lx, py - 8, tw + 8, 16), tw, lbl]; // reserved before scenery labels
  });
  S.witnesses.forEach((wt) => {
    if (!hasPos(wt.markedPosition)) return;
    const [px, py] = toPx(wt.markedPosition.map(Number));
    if (!offPlan(px, py)) return;
    const [ex, ey, a] = clampEdge(px, py);
    ctx.globalAlpha = wt._rej ? 0.35 : 1;
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(a); ctx.fillStyle = '#e2b052'; ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-5, -7); ctx.lineTo(-5, 7); ctx.closePath(); ctx.fill(); ctx.restore();
    edgeLabel(ex, ey, `${shortName(wt)} · ${compass(+wt.markedPosition[0], +wt.markedPosition[1])}`);
    ctx.globalAlpha = 1;
  });
  // objects
  ctx.font = '600 9.5px ' + getComputedStyle(document.body).getPropertyValue('--sans');
  S.objects.forEach((o) => {
    if (!hasPos(o.position) || o._rej) return;
    let [px, py] = toPx(o.position.map(Number));
    if (offPlan(px, py)) {
      const [ex, ey, a] = clampEdge(px, py);
      ctx.save(); ctx.translate(ex, ey); ctx.rotate(a); ctx.fillStyle = '#6f7c90'; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill(); ctx.restore();
      return; // arrow only: off-plan scenery labels crowded the plan (full list is in the table)
    }
    ctx.fillStyle = '#6f7c90'; ctx.strokeStyle = '#0b0e13'; ctx.lineWidth = 1;
    ctx.fillRect(px - 4, py - 4, 8, 8); ctx.strokeRect(px - 4, py - 4, 8, 8);
    const ol0 = String(o.label || o.kind || o.id).replace(/\s*\(.*$/, '').split(/[;,]/)[0].trim(), ol = ol0.length > 18 ? ol0.slice(0, 17).replace(/\s+\S*$/, '') + '…' : ol0;
    ctx.font = '600 9.5px ' + sans; const tw = ctx.measureText(ol).width;
    const r0 = [px + 6, py - 7, tw + 6, 14];
    if (occ.some((q) => hits(r0, q))) return; // no free spot: show the marker only
    occ.push(r0); const ly = py - 7;
    ctx.fillStyle = 'rgba(8,11,16,.62)'; ctx.fillRect(px + 6, ly, tw + 6, 14);
    ctx.fillStyle = '#b4bfcf'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(ol, px + 9, ly + 7);
  });
  // witnesses
  S.witnesses.forEach((wt, i) => {
    if (!hasPos(wt.markedPosition)) return;
    const [px, py] = toPx(wt.markedPosition.map(Number));
    if (offPlan(px, py)) return;
    const o0 = movedBy(wt) >= 0.1 ? origPos(wt) : null;
    if (o0) { // ghost of the extracted position + offset line
      const [gx, gy] = toPx(o0);
      ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = '#e2b052'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(gx, gy, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(px, py); ctx.stroke(); ctx.restore();
      const t = `extracted · ${movedBy(wt).toFixed(1)} m`; ctx.font = '600 9.5px ' + getComputedStyle(document.body).getPropertyValue('--sans');
      const tw2 = ctx.measureText(t).width, gly = place(gx - tw2 / 2 - 4, py >= gy ? gy - 25 : gy + 11, tw2 + 8, 14);
      ctx.fillStyle = 'rgba(8,11,16,.8)'; ctx.fillRect(gx - tw2 / 2 - 4, gly, tw2 + 8, 14);
      ctx.fillStyle = '#e2b052'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, gx, gly + 7);
    }
    const hot = S.selWit === i || S.hoverWit === i || (drag && drag.i === i);
    ctx.globalAlpha = wt._rej ? 0.35 : 1;
    if (hot) { ctx.fillStyle = 'rgba(226,176,82,.22)'; ctx.beginPath(); ctx.arc(px, py, 16, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = wt._ed ? '#ffd27a' : '#e2b052'; ctx.strokeStyle = '#0b0e13'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#17130a'; ctx.font = '700 10px ' + getComputedStyle(document.body).getPropertyValue('--sans'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(witLetter(wt, i), px, py + 0.5);
    ctx.font = '600 10.5px ' + getComputedStyle(document.body).getPropertyValue('--sans'); ctx.textAlign = 'left';
    const [lx, ly, tw, lbl] = wt._lr || [px + 12, py - 8, ctx.measureText(shortName(wt)).width, shortName(wt)];
    ctx.fillStyle = 'rgba(8,11,16,.8)'; ctx.fillRect(lx, ly, tw + 8, 16);
    ctx.fillStyle = '#e8ecf2'; ctx.textBaseline = 'middle'; ctx.fillText(lbl, lx + 4, ly + 8);
    ctx.globalAlpha = 1;
  });
  // north arrow + scale bar
  ctx.fillStyle = 'rgba(8,11,16,.75)'; ctx.fillRect(w - 30, 8, 22, 30);
  ctx.fillStyle = '#dfe5ee'; ctx.beginPath(); ctx.moveTo(w - 19, 12); ctx.lineTo(w - 24, 24); ctx.lineTo(w - 14, 24); ctx.closePath(); ctx.fill();
  ctx.font = '700 9px ' + getComputedStyle(document.body).getPropertyValue('--sans'); ctx.textAlign = 'center'; ctx.fillText('N', w - 19, 32);
  const sb = niceStep(ppm, 70), sbPx = sb * ppm;
  ctx.fillStyle = 'rgba(8,11,16,.75)'; ctx.fillRect(w - sbPx - 22, h - 24, sbPx + 14, 17);
  ctx.strokeStyle = '#dfe5ee'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(w - sbPx - 15, h - 11); ctx.lineTo(w - 15, h - 11); ctx.moveTo(w - sbPx - 15, h - 14); ctx.lineTo(w - sbPx - 15, h - 8); ctx.moveTo(w - 15, h - 14); ctx.lineTo(w - 15, h - 8); ctx.stroke();
  ctx.fillStyle = '#dfe5ee'; ctx.font = '600 9px ' + getComputedStyle(document.body).getPropertyValue('--mono'); ctx.textBaseline = 'alphabetic'; ctx.fillText(`${sb} m`, w - sbPx / 2 - 15, h - 14);
  cv.className = S.placing != null ? 'place' : '';
}
let drag = null;
const evPt = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
function hitWit([x, y]) {
  if (!view) return -1;
  let best = -1, bd = 14;
  S.witnesses.forEach((w, i) => { if (!hasPos(w.markedPosition)) return; const [px, py] = view.toPx(w.markedPosition.map(Number)); if (offPlan(px, py)) return; const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = i; } });
  return best;
}
const r1 = (n) => Math.round(n * 10) / 10;
const readout = (w) => { const el = $('#mapRead'); el.style.display = 'block'; el.textContent = `${w.name || w.id}: ${fmtPos(w.markedPosition)}`; };
cv.addEventListener('pointerdown', (e) => {
  const pt = evPt(e);
  if (S.placing != null) {
    const w = S.witnesses[S.placing];
    w.markedPosition = view.toM(pt).map(r1); w._ed = true;
    S.placing = null; readout(w); renderBody(); renderTally(); drawMap(); return;
  }
  const i = hitWit(pt);
  if (i < 0) return;
  drag = { i, moved: false }; S.selWit = i;
  cv.setPointerCapture(e.pointerId); cv.classList.add('dragging'); drawMap(); readout(S.witnesses[i]);
});
cv.addEventListener('pointermove', (e) => {
  const pt = evPt(e);
  if (!drag) { cv.classList.toggle('grab', hitWit(pt) >= 0 && S.placing == null); return; }
  const w = S.witnesses[drag.i];
  const [x, z] = view.toM([Math.max(0, Math.min(view.w, pt[0])), Math.max(0, Math.min(view.h, pt[1]))]);
  w.markedPosition = [r1(x), r1(z)]; w._ed = true; drag.moved = true;
  readout(w); drawMap();
});
const endDrag = () => { if (!drag) return; const moved = drag.moved; drag = null; cv.classList.remove('dragging'); drawMap(); renderBody(); if (moved) renderTally(); setTimeout(() => { if (!drag) $('#mapRead').style.display = 'none'; }, 2200); };
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
window.addEventListener('resize', () => drawMap());
$('#mapSize').addEventListener('click', () => {
  const on = document.querySelector('.rv-wrap').classList.toggle('map-lg');
  $('#mapSize').textContent = on ? 'Shrink' : 'Enlarge'; $('#mapSize').setAttribute('aria-pressed', String(on));
  lsSet('sightline.review.mapLg', on ? '1' : ''); drawMap();
});
if (lsGet('sightline.review.mapLg') === '1') { document.querySelector('.rv-wrap').classList.add('map-lg'); $('#mapSize').textContent = 'Shrink'; $('#mapSize').setAttribute('aria-pressed', 'true'); }

// ---------- data flow ----------
function applyExtraction(r) {
  S.status = r.status || (r.extraction ? 'ready' : 'none');
  S.error = r.error || null;
  S.meta = r.meta || null;
  S.confirmed = r.confirmed || null;
  if (r.extraction) {
    S.ext = r.extraction;
    S.scene = clone(S.ext.scene) || {};
    S.sceneEdited = new Set();
    S.facts = prep(S.ext.facts); S.vehicles = prep(S.ext.vehicles); S.objects = prep(S.ext.objects); S.witnesses = prep(S.ext.witnesses);
    // Overlay an existing sign-off: items missing from it were rejected; differing values were edited.
    const c = S.confirmed;
    if (c) {
      const overlay = (arr, carr) => {
        if (!Array.isArray(carr)) return;
        const byId = new Map(carr.map((x) => [x.id, x]));
        for (const it of arr) {
          const ci = byId.get(it.id);
          if (!ci) { it._rej = true; continue; }
          for (const [k, v] of Object.entries(ci)) if (k !== 'edited' && JSON.stringify(it[k]) !== JSON.stringify(v)) { it[k] = clone(v); it._ed = true; }
          if (ci.edited) it._ed = true;
        }
      };
      overlay(S.facts, c.facts); overlay(S.vehicles, c.vehicles); overlay(S.objects, c.objects); overlay(S.witnesses, c.witnesses);
      if (c.scene) for (const [k, v] of Object.entries(c.scene)) if (k !== 'edited' && JSON.stringify(S.scene[k]) !== JSON.stringify(v)) { S.scene[k] = clone(v); if (k !== 'citation' && k !== 'source') S.sceneEdited.add(k); }
      if (!$('#confirmedBy').value && c.confirmedBy) $('#confirmedBy').value = c.confirmedBy;
    }
  }
  $('#stepExtract').className = S.status === 'ready' || S.ext ? 'done' : S.status === 'running' ? 'active' : '';
}
let pollT = null;
function schedulePoll() {
  clearTimeout(pollT);
  if (S.status !== 'running') return;
  pollT = setTimeout(async () => {
    try { applyExtraction(await api(`/api/cases/${enc(S.id)}/extraction`)); if (S.status !== 'running') loadMap(); renderAll(); } catch { /* keep polling */ }
    schedulePoll();
  }, 2000);
}
async function runExtraction() {
  S.status = 'running'; renderAll();
  try {
    const body = S.mode === 'live' ? { mode: 'live' } : {};
    applyExtraction(await post(`/api/cases/${enc(S.id)}/extraction/run`, body));
  } catch (e) { S.status = 'error'; S.error = e.message; }
  loadMap(); renderAll(); schedulePoll();
}
async function clearConfirmation() {
  try { await post(`/api/cases/${enc(S.id)}/confirm`, { clear: true }); S.confirmed = null; renderBody(); }
  catch (e) { alert('Could not clear confirmation: ' + e.message); }
}

$('#confirmBtn').onclick = async () => {
  const confirmedBy = $('#confirmedBy').value.trim();
  if (!confirmedBy) return;
  const body = {
    confirmedBy,
    scene: S.scene,
    facts: S.facts.filter((x) => !x._rej).map(strip),
    witnesses: S.witnesses.filter((x) => !x._rej).map(strip),
    vehicles: S.vehicles.filter((x) => !x._rej).map(strip),
    objects: S.objects.filter((x) => !x._rej).map(strip),
  };
  if (S.sceneEdited.size) body.scene = { ...S.scene, edited: true };
  S.busy = true; renderTally();
  const out = $('#runOut');
  const caseUrl = `/cases.html?case=${enc(S.id)}`, viewUrl = `/?case=${enc(S.id)}`;
  out.innerHTML = '<div class="line"><span class="dot"></span>Saving sign-off…</div>';
  try {
    const r = await post(`/api/cases/${enc(S.id)}/confirm`, body);
    S.confirmed = r.confirmed || null;
    renderBody();
  } catch (e) {
    out.innerHTML = `<div class="line"><span class="dot bad"></span>Could not save the sign-off: ${esc(e.message)}</div>`;
    S.busy = false; renderTally(); return;
  }
  out.innerHTML = `<div class="line"><span class="dot ok"></span>Inputs confirmed by ${esc(confirmedBy)}.</div><div class="line" id="runLine"><span class="dot"></span>Starting reconstruction…</div><div class="log" id="runLog"></div><div class="acts"><a class="btn sm" href="${caseUrl}">Case page</a></div>`;
  const line = (cls, msg) => { const l = $('#runLine'); if (l) l.innerHTML = `<span class="dot ${cls}"></span>${msg}`; };
  const log = (msg) => { const l = $('#runLog'); if (l) { l.insertAdjacentHTML('beforeend', `<div>${esc(msg)}</div>`); l.scrollTop = l.scrollHeight; } };
  const viewerBtn = () => { const a = out.querySelector('.acts'); if (a && !a.querySelector('.primary')) a.insertAdjacentHTML('afterbegin', `<a class="btn sm primary" href="${viewUrl}">Open in viewer</a>`); };
  try {
    await post(`/api/cases/${enc(S.id)}/run`, {});
  } catch (e) {
    if (e.status === 409) line('', 'A reconstruction is already running for this case.');
    else { line('bad', `Reconstruction did not start: ${esc(e.message)}`); S.busy = false; renderTally(); return; }
  }
  line('', 'Building the reconstruction from the confirmed inputs…');
  try {
    const es = new EventSource(`/api/cases/${enc(S.id)}/stream`);
    es.onmessage = (m) => {
      let ev; try { ev = JSON.parse(m.data); } catch { return; }
      if (ev.type === 'progress') log(ev.message || (ev.step ? `${ev.step}${ev.round ? ' · round ' + ev.round : ''}` : 'working…'));
      else if (ev.type === 'done') { line('ok', 'Reconstruction complete.'); viewerBtn(); es.close(); S.busy = false; renderTally(); }
      else if (ev.type === 'error') { line('bad', esc(ev.message || 'Run failed.')); es.close(); S.busy = false; renderTally(); }
    };
    es.onerror = () => { /* browser retries; the case page also tracks progress */ };
  } catch { /* no SSE */ }
};

// ---------- boot ----------
(async () => {
  const id = S.id;
  const caseUrl = `/cases.html?case=${enc(id)}`;
  $('#skipLink').href = caseUrl; $('#casesLink').href = caseUrl; $('#viewerLink').href = `/?case=${enc(id)}`;
  $('#confirmedBy').value = lsGet('sightline.reviewer') || '';
  try {
    const h = await api('/api/health'); S.mode = h.mode;
    const b = $('#modeBadge'); b.textContent = h.mode === 'live' ? 'LIVE' : 'MOCK · CACHED'; b.title = h.mode === 'live' ? 'Server calls Argon live' : 'Server replays cached Argon output';
  } catch { $('#modeBadge').textContent = 'OFFLINE'; }
  try {
    S.c = await api(`/api/cases/${enc(id)}`);
    $('#crumb').innerHTML = `<a href="/cases.html">Cases</a> / <a href="${caseUrl}" class="mono">${esc(id)}</a> / Review`;
    $('#caseSub').textContent = S.c.title || id;
    document.title = `Review — ${S.c.title || id} — Sightline`;
  } catch (e) {
    S.status = 'missing'; S.error = e.status === 404 ? `No case "${id}".` : `Could not load case: ${e.message}`; renderAll(); return;
  }
  try { applyExtraction(await api(`/api/cases/${enc(id)}/extraction`)); }
  catch (e) {
    if (e.status === 404 && e.body && /no such endpoint/.test(e.body.error || '')) { S.status = 'missing'; S.error = 'The extraction service is not available on this server yet.'; }
    else if (e.status === 404) { S.status = 'missing'; S.error = e.message; }
    else { S.status = 'error'; S.error = e.message; }
  }
  loadMap(); renderAll(); schedulePoll();
})();
