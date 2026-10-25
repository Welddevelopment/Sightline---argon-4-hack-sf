// ARGON-ONLY UI: make "only Argon can do this" visible.
//  1. Case-size banner (viewer stage + case page): tokens · video · pages · documents · read in one pass.
//  2. Key finding: witness-eye render at the key time next to the deposition frame where she marks the map.
//  3. "Same inputs" baseline card (cases/<id>/cache/baseline_fair.json; falls back to the old #compare card).
// Data preference: cases/<id>/argon_only.json (via /api/cases/:id/size .argonOnly) > /size estimate/meta > baseline_fair.json.
// Plain script, no imports; injects its own stylesheet; survives ui.js / cases.js re-rendering via MutationObserver.
(function () {
  'use strict';
  if (/[?&]clean=1/.test(location.search)) return;           // headless renders: no chrome
  const IS_VIEWER = !!document.getElementById('stageWrap');
  const IS_CASES = !IS_VIEWER && !!document.getElementById('content');
  if (!IS_VIEWER && !IS_CASES) return;

  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = '/argon_only.css';
  document.head.appendChild(css);

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const caseId = () => new URLSearchParams(location.search).get('case') || (IS_VIEWER ? 'demo' : '');
  const getJson = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); };
  const tryJson = (url) => getJson(url).catch(() => null);
  const exists = (url) => fetch(url, { method: 'HEAD' }).then((r) => r.ok && !/json/.test(r.headers.get('content-type') || '')).catch(() => false);

  // ---------- formatting ----------
  function fmtTokens(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 2).replace(/\.?0+$/, '') + 'M';
    if (n >= 1e4) return Math.round(n / 1000) + 'k';
    return n.toLocaleString('en-US');
  }
  function fmtDur(sec) {
    sec = Math.round(Number(sec) || 0);
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
    if (sec < 90) return sec + ' s';
    return Math.round(sec / 60) + ' min';
  }
  const tcToSec = (s) => String(s).split(':').map(Number).reduce((a, x) => a * 60 + x, 0);
  const plural = (n, w) => `${Number(n).toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;
  const prettyModel = (m) => String(m || '').replace(/^models\//, '');
  const relUrl = (id, p) => !p ? null : (/^(\/|https?:|data:)/.test(p) ? p : `/cases/${encodeURIComponent(id)}/${String(p).replace(/^\.?\//, '')}`);

  // ---------- data ----------
  let D = null;          // { id, size, ao, fair, findings, key, world }
  let loadingFor = null;

  async function load(id) {
    loadingFor = id;
    const [size, fair, st] = await Promise.all([
      tryJson('/api/cases/' + encodeURIComponent(id) + '/size'),
      tryJson('/cases/' + encodeURIComponent(id) + '/cache/baseline_fair.json'),
      IS_VIEWER && !new URLSearchParams(location.search).get('case') ? tryJson('/api/state') : tryJson('/api/cases/' + encodeURIComponent(id)).then((c) => c && (c.state || null)),
    ]);
    if (loadingFor !== id) return;
    const findings = (st && st.findings) || [];
    const key = findings.find((f) => String(f.status || '').toLowerCase() === 'contradiction') || null;
    D = { id, size, ao: (size && size.argonOnly) || null, fair, findings, key, world: st && st.world, frames: null };
    D.frames = await keyFrames(D);
    if (loadingFor !== id) return;
    paint();
  }

  // ---------- citations -> frames ----------
  const citesOf = (f) => (f.evidence || []).map((e) => (typeof e === 'string' ? { citation: e } : e)).concat((f.citations || []).map((c) => ({ citation: c })));
  function markCitation(f) {
    const depo = citesOf(f).filter((e) => /\bdepo/i.test(e.citation || '') && /(\d+:\d{2}(?::\d{2})?)/.test(e.citation));
    const pick = depo.find((e) => /mark|exhibit|position|map|diagram/i.test(e.citation)) || depo[0];
    if (!pick) return null;
    const tc = /(\d+:\d{2}(?::\d{2})?)/.exec(pick.citation)[1];
    const src = /\.(mp4|mov|webm|m4v|mkv)$/i.test(pick.source || '') ? pick.source : '';
    return { tc, t: tcToSec(tc), video: src, citation: pick.citation };
  }
  function renderCitation(f) {
    for (const e of citesOf(f)) {
      const m = /(wit_[\w-]+)\.png\s*@\s*t\s*=\s*([\d.]+)/i.exec(e.citation || '');
      if (m) return { wit: m[1], t: Number(m[2]) };
    }
    for (const e of citesOf(f)) { const m = /@\s*t\s*=\s*([\d.]+)\s*s/i.exec(e.citation || ''); if (m) return { wit: null, t: Number(m[1]) }; }
    return null;
  }
  async function keyFrames(d) {
    const out = { render: null, depo: null };
    const kf = (d.ao && d.ao.key_frames) || null;
    const f = d.key;
    const rc = f ? renderCitation(f) : null;
    const wit = (rc && rc.wit) || (f && (f.involves || []).find((x) => /^wit_/.test(x))) || null;
    const witName = wit ? wit.replace(/^wit_/, 'Witness ') : 'Witness';
    // witness-eye render
    if (kf && kf.render_png) {
      out.render = { src: relUrl(d.id, kf.render_png), t: Number(kf.render_t), wit, witName };
    } else if (wit) {
      const t = rc ? rc.t : null;
      const worldName = d.world ? String(d.world).split('/').pop().replace(/\.js$/, '') : '';
      const cands = [];
      if (worldName) cands.push(`/cases/${encodeURIComponent(d.id)}/renders/${worldName}/${wit}.png`);
      cands.push(`/renders/${wit}.png`);
      for (const u of cands) if (await exists(u)) { out.render = { src: u, t, wit, witName }; break; }
      if (!out.render && IS_VIEWER) out.render = { src: null, t, wit, witName, live: true };
    }
    // deposition frame at the mark
    if (kf && kf.depo_png) {
      out.depo = { src: relUrl(d.id, kf.depo_png), tc: kf.depo_timecode || '', cited: kf.depo_timecode || '' };
    } else if (f) {
      const mc = markCitation(f);
      if (mc) {
        const video = mc.video || ((d.size && d.size.videoCount) ? '' : '');
        const q = `video=${encodeURIComponent(video)}&t=${mc.t}&cue=mid&format=json`;
        const j = await tryJson(`/api/cases/${encodeURIComponent(d.id)}/frame?${q}`);
        if (j && j.url) out.depo = { src: j.url, tc: j.tc, cited: mc.tc, t: j.t, quote: j.cue && j.cue.text, video: j.video };
      }
    }
    return out;
  }
  // render from the live viewer when no PNG exists on disk
  function liveSnapshot(r) {
    const sl = window.sl;
    if (!sl || !sl.world || !sl.setCamera || !r.wit) return null;
    const canvas = document.querySelector('#stage canvas');
    if (!canvas) return null;
    const cam = sl.camera, t0 = sl.time;
    try {
      sl.setCamera(r.wit);
      if (r.t != null) sl.setTime(r.t);
      sl.renderFrame && sl.renderFrame();
      return canvas.toDataURL('image/jpeg', 0.88);
    } catch (_) { return null; }
    finally { try { sl.setCamera(cam); sl.setTime(t0); sl.renderFrame && sl.renderFrame(); } catch (_) {} }
  }

  // ---------- 1. banner ----------
  function bannerHtml() {
    const s = D.size;
    if (!s) return '';
    const parts = [`<b>${esc(fmtTokens(s.totalTokens))}</b> tokens`];
    if (s.videoSec) parts.push(`<b>${esc(fmtDur(s.videoSec))}</b> video` + (s.videoCount > 1 ? ` <span class="ao-dim">(${s.videoCount} files)</span>` : ''));
    if (s.pages) parts.push(`<b>${esc(Number(s.pages).toLocaleString('en-US'))}</b> pages`);
    if (s.documents) parts.push(esc(plural(s.documents, 'document')));
    const tip = [
      `${Number(s.totalTokens).toLocaleString('en-US')} input tokens — ${s.method || ''}`,
      s.measured && s.measuredFrom ? `Source: ${s.measuredFrom.file}${s.measuredFrom.at ? ' (' + s.measuredFrom.at + ')' : ''}` : '',
      s.measured && s.estimatedTokens ? `Pre-flight estimate was ${Number(s.estimatedTokens).toLocaleString('en-US')}` : '',
      s.pdfPages || s.textPages ? `Pages: ${s.pdfPages || 0} PDF + ${s.textPages || 0} text page-equivalents (~3,000 chars)` : '',
    ].filter(Boolean).join('\n');
    return `<span class="ao-k">Case</span><span class="ao-parts">${parts.join('<i class="ao-sep">·</i>')}<i class="ao-sep">·</i>read in one pass by <span class="ao-model">${esc(prettyModel(s.model || 'gemini-4-argon'))}</span></span>` +
      `<span class="ao-tag ${s.measured ? 'm' : 'e'}" title="${esc(tip)}">${s.measured ? 'Measured' : 'Estimated'}</span>`;
  }
  function paintBanner() {
    const html = bannerHtml();
    if (!html) return;
    let el = document.getElementById('aoBanner');
    if (IS_VIEWER) {
      const host = document.getElementById('stageWrap');
      if (!el) { el = document.createElement('div'); el.id = 'aoBanner'; el.className = 'ao-banner ao-stage'; host.appendChild(el); }
    } else {
      const h1 = document.querySelector('#content h1');
      if (!h1) return;
      if (!el || !document.getElementById('content').contains(el)) {
        el = document.createElement('div'); el.id = 'aoBanner'; el.className = 'ao-banner ao-page';
        const anchor = document.querySelector('#content .facts') || h1;
        anchor.after(el);
      }
    }
    if (el.dataset.k !== html) { el.innerHTML = html; el.dataset.k = html; }
    el.title = '';
  }

  // ---------- 2. key frames ----------
  function framesHtml() {
    const fr = D.frames;
    if (!fr || (!fr.render && !fr.depo)) return '';
    const fig = (src, cls, cap, sub, attrs = '') => `<figure class="ao-fig ${cls}"${attrs}>${src ? `<img src="${esc(src)}" alt="${esc(cap)}" loading="lazy">` : '<div class="ao-ph">rendering…</div>'}<figcaption><b>${cap}</b>${sub ? `<span>${sub}</span>` : ''}</figcaption></figure>`;
    const r = fr.render, d = fr.depo;
    const rCap = r ? `${esc(r.witName)} · eye level` : '';
    const rSub = r ? `Reconstruction${r.t != null && Number.isFinite(r.t) ? ` · t = ${esc(Number(r.t).toFixed(1))} s` : ''}` : '';
    const dCap = d ? `Deposition · ${esc(d.tc)}` : '';
    const dSub = d ? (d.quote ? `“${esc(d.quote)}”` : 'Marks her position on the exhibit') + (d.cited && d.cited !== d.tc ? ` <em>cited ${esc(d.cited)}</em>` : '') : '';
    return `<div class="ao-frames-h">What she said she saw <span>vs</span> what her marked position sees</div>
      <div class="ao-frames">
        ${d ? fig(d.src, 'ao-depo', dCap, dSub, d.t != null ? ` data-seek="${esc(d.tc)}" title="Click to open the deposition at ${esc(d.tc)}"` : '') : ''}
        ${r ? fig(r.src, 'ao-render', rCap, rSub, ' title="Click to enlarge"') : ''}
      </div>`;
  }
  function wireFrames(box) {
    box.addEventListener('click', (ev) => {
      const figEl = ev.target.closest('.ao-fig');
      if (!figEl) return;
      ev.stopPropagation();
      const img = figEl.querySelector('img');
      if (figEl.dataset.seek && IS_VIEWER) {
        const inp = document.getElementById('seekInput'), btn = document.getElementById('seekBtn');
        if (inp && btn) { inp.value = figEl.dataset.seek; btn.click(); }
      }
      if (img) lightbox(img.src, figEl.querySelector('figcaption').innerHTML);
    });
  }
  function lightbox(src, capHtml) {
    let lb = document.getElementById('aoLightbox');
    if (!lb) {
      lb = document.createElement('div'); lb.id = 'aoLightbox'; lb.className = 'ao-lightbox';
      lb.onclick = () => { lb.hidden = true; };
      document.body.appendChild(lb);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') lb.hidden = true; });
    }
    lb.innerHTML = `<figure><img src="${esc(src)}" alt=""><figcaption>${capHtml}</figcaption></figure>`;
    lb.hidden = false;
  }
  function paintFrames() {
    if (!D.key) return;
    const fr = D.frames;
    if (fr && fr.render && fr.render.live && !fr.render.src && window.sl && window.sl.world) {
      const snap = liveSnapshot(fr.render);
      if (snap) fr.render.src = snap;
    }
    const html = framesHtml();
    if (!html) return;
    let host = null;
    if (IS_VIEWER) host = document.querySelector(`#findings .finding[data-id="${CSS.escape(String(D.key.id))}"]`);
    else host = Array.from(document.querySelectorAll('#content .finds li')).find((li) => (li.querySelector('.fid') || {}).textContent === String(D.key.id));
    if (!host || host.querySelector('.ao-keyframes')) return;
    const box = document.createElement('div');
    box.className = 'ao-keyframes';
    box.innerHTML = html;
    wireFrames(box);
    const chips = host.querySelector('.chips');
    if (chips) chips.before(box); else host.appendChild(box);
  }

  // ---------- 3. same-inputs baseline ----------
  function normFair(fair) {
    if (!fair || typeof fair !== 'object') return null;
    let rows = [];
    const src = fair.models || fair.results || fair.runs || fair;
    if (Array.isArray(src)) rows = src.filter((r) => r && typeof r === 'object').map((r) => ({ ...r, model: r.model || r.name }));
    else for (const [k, v] of Object.entries(src)) if (v && typeof v === 'object' && !Array.isArray(v) && ('answer' in v || 'foundMark' in v || 'concludedBlocked' in v)) rows.push({ model: v.model || k, ...v });
    if (!rows.length) return null;
    const inputTokens = Number(fair.inputTokens || fair.tokens || (fair.inputs && (fair.inputs.tokens || fair.inputs.totalTokens))) || Math.max(...rows.map((r) => Number(r.tokens && (r.tokens.prompt || r.tokens.input)) || Number(r.tokens) || 0));
    rows.sort((a, b) => (/argon/i.test(a.model) ? 1 : 0) - (/argon/i.test(b.model) ? 1 : 0));
    return { rows, inputTokens, inputs: fair.inputs, at: fair.at || fair.generatedAt };
  }
  const yn = (v, yes, no) => v == null ? `<span class="ao-q">— ${esc(no)}</span>` : (v ? `<span class="ao-y">✓ ${esc(yes)}</span>` : `<span class="ao-n">✗ ${esc(no)}</span>`);
  function rowTokens(r) { const t = r.tokens; if (t == null) return null; if (typeof t === 'object') return Number(t.prompt || t.input || t.total) || null; return Number(t) || null; }
  function fairHtml(F) {
    const mark = D.key && markCitation(D.key);
    const claim = D.key && citesOf(D.key).map((e) => e.citation || '').find((c) => /claim/i.test(c) && /\d+:\d{2}/.test(c));
    const claimTc = claim ? /(\d+:\d{2}(?::\d{2})?)/.exec(claim)[1] : '';
    const anyBlocked = F.rows.filter((r) => !/argon/i.test(r.model) && r.concludedBlocked);
    const cols = F.rows.map((r) => {
      const isArgon = /argon/i.test(r.model);
      const verdict = r.concludedBlocked == null ? 'No verdict' : (r.concludedBlocked ? 'View blocked: contradiction' : 'Clear view: consistent');
      const vcls = r.concludedBlocked ? 'contradiction' : (r.concludedBlocked == null ? 'unverifiable' : 'consistent');
      const tok = rowTokens(r);
      const meta = [r.latencyS != null ? `${Number(r.latencyS).toFixed(0)} s` : '', tok ? `${fmtTokens(tok)} tokens in` : ''].filter(Boolean).join(' · ');
      const ans = String(r.answer || '').trim();
      return `<div class="ao-col${isArgon ? ' argon' : ''}">
        <div class="ao-mname">${esc(prettyModel(r.model))}${meta ? `<span>${esc(meta)}</span>` : ''}</div>
        <span class="cmp-verdict ${vcls}">${esc(verdict)}</span>
        <ul class="ao-checks">
          <li>${yn(r.foundMark, `found the map mark${mark ? ' (' + mark.tc + ')' : ''}`, 'missed the map mark')}</li>
          <li>${yn(r.foundClaim, `found the “clear view” claim${claimTc ? ' (' + claimTc + ')' : ''}`, 'missed the “clear view” claim')}</li>
        </ul>
        ${ans ? `<details class="ao-ans"><summary>Answer</summary><p>${esc(ans.length > 900 ? ans.slice(0, 900) + '…' : ans)}</p></details>` : ''}
      </div>`;
    }).join('');
    const note = anyBlocked.length
      ? `<div class="ao-note">${esc(anyBlocked.map((r) => prettyModel(r.model)).join(', '))} also concluded the view was blocked on these inputs.</div>`
      : '';
    return `<div class="ao-bh">Same inputs, one prompt</div>
      <div class="ao-bsub">All documents + all video${F.inputTokens ? ` (${esc(fmtTokens(F.inputTokens))} tokens)` : ''} sent unchanged to each model</div>
      <div class="ao-cols">${cols}</div>${note}`;
  }
  function aoBaselineHtml(b) {
    // argon_only.json: baseline {model, inputs, verdict}; the Argon column is the key finding itself
    const inputs = typeof b.inputs === 'string' ? b.inputs : (b.inputs && (b.inputs.label || b.inputs.description)) || 'All documents + all video';
    const tok = (D.ao && D.ao.tokens_total) || (b.inputs && b.inputs.tokens);
    const v = String(b.verdict || '');
    const vcls = /contradict|block/i.test(v) ? 'contradiction' : (/consistent|clear/i.test(v) ? 'consistent' : 'unverifiable');
    return `<div class="ao-bh">Same inputs, one prompt</div>
      <div class="ao-bsub">${esc(inputs)}${tok ? ` (${esc(fmtTokens(tok))} tokens)` : ''} sent unchanged to each model</div>
      <div class="ao-cols">
        <div class="ao-col"><div class="ao-mname">${esc(prettyModel(b.model || 'baseline'))}</div><span class="cmp-verdict ${vcls}">${esc(vcls === 'contradiction' ? 'Contradiction' : vcls === 'consistent' ? 'Consistent' : 'No verdict')}</span><p class="ao-why">${esc(v)}</p></div>
        <div class="ao-col argon"><div class="ao-mname">${esc(prettyModel((D.size && D.size.model) || 'gemini-4-argon'))}</div><span class="cmp-verdict contradiction">Contradiction</span><p class="ao-why">${esc(D.key ? D.key.summary : '')}</p></div>
      </div>${vcls === 'contradiction' ? `<div class="ao-note">${esc(prettyModel(b.model))} also reached the contradiction on these inputs.</div>` : ''}`;
  }
  function paintBaseline() {
    const aoB = D.ao && D.ao.baseline;
    const F = aoB ? null : normFair(D.fair);
    if (!aoB && !F) return;                       // keep the old baseline.json card (#compare) as is
    const html = aoB ? aoBaselineHtml(aoB) : fairHtml(F);
    let el = document.getElementById('aoBaseline');
    if (IS_VIEWER) {
      const cmp = document.getElementById('compare');
      if (!cmp) return;
      if (!el) { el = document.createElement('details'); el.id = 'aoBaseline'; el.className = 'ao-baseline'; el.open = true; cmp.before(el); }
      cmp.classList.add('ao-hidden');
    } else {
      const sect = Array.from(document.querySelectorAll('#content .sect')).find((s) => s.querySelector('.finds'));
      if (!sect) return;
      if (!el || !sect.parentNode.contains(el)) { el = document.createElement('div'); el.id = 'aoBaseline'; el.className = 'ao-baseline sect'; sect.after(el); }
    }
    const body = IS_VIEWER ? `<summary>Weaker model, same inputs</summary><div class="ao-bbody">${html}</div>` : `<h3>Weaker model, same inputs</h3><div class="ao-bbody">${html}</div>`;
    if (el.dataset.k !== body) { el.innerHTML = body; el.dataset.k = body; }
  }

  // ---------- paint + observe ----------
  let painting = false;
  function paint() {
    if (!D || painting) return;
    painting = true;
    try { paintBanner(); paintFrames(); paintBaseline(); } catch (e) { console.warn('[argon_only]', e); }
    finally { painting = false; }
  }
  const obsTargets = IS_VIEWER ? ['findings', 'compare'] : ['content'];
  const mo = new MutationObserver(() => { if (!painting) requestAnimationFrame(paint); });
  function observe() { for (const id of obsTargets) { const el = document.getElementById(id); if (el) mo.observe(el, { childList: true, subtree: !IS_VIEWER }); } }

  let lastId = null;
  function check() {
    const id = caseId();
    if (!id || id === lastId) return;
    lastId = id; D = null;
    const old = document.getElementById('aoBanner'); if (old && IS_CASES) old.remove();
    load(id).catch((e) => console.warn('[argon_only] load failed', e));
  }
  function boot() {
    observe();
    check();
    if (IS_CASES) setInterval(check, 500);         // cases.js switches case with history.replaceState
    if (IS_VIEWER && window.sl && window.sl.ready) window.sl.ready.then(() => setTimeout(paint, 300)).catch(() => {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
