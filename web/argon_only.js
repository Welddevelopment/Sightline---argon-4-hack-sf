// ARGON-ONLY UI: make "only Argon can do this" visible.
//  1. Case-size banner (viewer stage + case page): "Case: N tokens · H h MM min video · P pages · read in one pass by gemini-4-argon".
//  2. Key finding: witness-eye render at the key time next to the deposition frame where she marks the map.
//  3. The existing Flash card (#compare, ui.js, cache/baseline.json) gets a precise label of what that baseline was.
// Data preference: cases/<id>/argon_only.json (via /api/cases/:id/size .argonOnly) > /size meta/estimate.
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
  let D = null;          // { id, size, ao, findings, key, world, frames }
  let loadingFor = null;

  async function load(id) {
    loadingFor = id;
    const [size, st] = await Promise.all([
      tryJson('/api/cases/' + encodeURIComponent(id) + '/size'),
      IS_VIEWER && !new URLSearchParams(location.search).get('case') ? tryJson('/api/state') : tryJson('/api/cases/' + encodeURIComponent(id)).then((c) => c && (c.state || null)),
    ]);
    if (loadingFor !== id) return;
    const findings = (st && st.findings) || [];
    const key = findings.find((f) => String(f.status || '').toLowerCase() === 'contradiction') || null;
    D = { id, size, ao: (size && size.argonOnly) || null, findings, key, world: st && st.world, frames: null };
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
      // clean witness-eye still: snapshot cached by the viewer (POST /eyeframe), else the live viewer snapshots now,
      // else the recorded render PNG (a full-UI capture, cropped to the 3D stage by CSS)
      const eye = t != null ? `/cases/${encodeURIComponent(d.id)}/cache/frames/eye_${wit}_${Number(t).toFixed(1)}.jpg` : null;
      const eyeOk = eye && await exists(eye);
      if (IS_VIEWER) out.render = { src: eyeOk ? eye : null, t, wit, witName, live: true };
      else if (eyeOk) out.render = { src: eye, t, wit, witName };
      else {
        const worldName = d.world ? String(d.world).split('/').pop().replace(/\.js$/, '') : '';
        const cands = [];
        if (worldName) cands.push(`/cases/${encodeURIComponent(d.id)}/renders/${worldName}/${wit}.png`);
        for (const u of cands) if (await exists(u)) { out.render = { src: u, t, wit, witName, uishot: true }; break; }
      }
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
    const tip = [
      `${Number(s.totalTokens).toLocaleString('en-US')} input tokens — ${s.method || ''}`,
      s.measured && s.measuredFrom ? `Source: ${s.measuredFrom.file}${s.measuredFrom.at ? ' (' + s.measuredFrom.at + ')' : ''}` : '',
      s.measured && s.estimatedTokens ? `Pre-flight estimate was ${Number(s.estimatedTokens).toLocaleString('en-US')}` : '',
      s.documents ? `${plural(s.documents, 'document')}${s.videoCount ? ' + ' + plural(s.videoCount, 'video') : ''}` : '',
      s.pdfPages || s.textPages ? `Pages: ${s.pdfPages || 0} PDF + ${s.textPages || 0} text page-equivalents (~3,000 chars)` : '',
    ].filter(Boolean).join('\n');
    return `<span class="ao-k">Case:</span><span class="ao-parts">${parts.join('<i class="ao-sep">·</i>')}<i class="ao-sep">·</i>read in one pass by <span class="ao-model">${esc(prettyModel(s.model || 'gemini-4-argon'))}</span></span>` +
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
    const q = d && d.quote ? String(d.quote).replace(/^[A-Z][A-Z .'-]{1,30}:\s*/, '') : '';
    const dSub = d ? (q ? `“${esc(q)}”` :'Marks her position on the exhibit') + (d.cited && d.cited !== d.tc ? ` <em>cited ${esc(d.cited)}</em>` : '') : '';
    return `<div class="ao-frames-h">What she said she saw <span>vs</span> what her marked position sees</div>
      <div class="ao-frames">
        ${d ? fig(d.src, 'ao-depo', dCap, dSub, d.t != null ? ` data-seek="${esc(d.tc)}" title="Click to open the deposition at ${esc(d.tc)}"` : '') : ''}
        ${r ? fig(r.src, 'ao-render' + (r.uishot ? ' ao-uishot' : ''), rCap, rSub, ' title="Click to enlarge"') : ''}
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
  function worldReady(r) {
    const sl = window.sl;
    if (!sl || !sl.world || !r.wit) return false;
    if (D.world && sl.worldUrl && String(sl.worldUrl).replace(/^\/+/, '') !== String(D.world).replace(/^\/+/, '')) return false;
    return (sl.world.witnesses || []).some((w) => w.id === r.wit);
  }
  function maybeSnapshot() {
    const r = D && D.frames && D.frames.render;
    if (!r || !r.live || r.snapped || !worldReady(r)) return;
    r.snapped = true;
    const snap = liveSnapshot(r);
    if (!snap) return;
    r.src = snap; r.uishot = false;
    fetch('/api/cases/' + encodeURIComponent(D.id) + '/eyeframe', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wit: r.wit, t: r.t, dataUrl: snap, world: D.world }) }).catch(() => {});
    paint();
  }
  let snapTimer = null;
  function scheduleSnapshot(ms) { clearTimeout(snapTimer); snapTimer = setTimeout(maybeSnapshot, ms); }
  function paintFrames() {
    if (!D.key) return;
    const html = framesHtml();
    if (!html) return;
    let host = null;
    if (IS_VIEWER) host = document.querySelector(`#findings .finding[data-id="${CSS.escape(String(D.key.id))}"]`);
    else host = Array.from(document.querySelectorAll('#content .finds li')).find((li) => (li.querySelector('.fid') || {}).textContent === String(D.key.id));
    if (!host) return;
    let box = host.querySelector('.ao-keyframes');
    if (!box) {
      box = document.createElement('div');
      box.className = 'ao-keyframes';
      wireFrames(box);
      const chips = host.querySelector('.chips');
      if (chips) chips.before(box); else host.appendChild(box);
    }
    if (box.dataset.k !== html) { box.innerHTML = html; box.dataset.k = html; }
    const r = D.frames && D.frames.render;
    if (r && r.live && !r.snapped) scheduleSnapshot(2500);
  }

  // ---------- 3. existing Flash card (#compare, from cache/baseline.json): label it precisely ----------
  // Per lead/user decision: no "same inputs" card; baseline_fair.json is not read by the UI.
  const FLASH_LABEL = '<b class="ao-inl">Gemini Flash</b> · chunk-and-summarize pipeline over the transcript · no video';
  function labelCompare() {
    if (!IS_VIEWER) return;
    const m = document.querySelector('#compare .cmp-grid .cmp-col:first-child .cmp-model');
    if (m && m.innerHTML !== FLASH_LABEL && /flash/i.test(m.textContent)) { m.innerHTML = FLASH_LABEL; m.classList.add('ao-flash-label'); }
  }

  // ---------- paint + observe ----------
  let painting = false;
  function paint() {
    if (!D || painting) return;
    painting = true;
    try { paintBanner(); paintFrames(); labelCompare(); } catch (e) { console.warn('[argon_only]', e); }
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
    if (IS_VIEWER && window.sl && window.sl.ready) {
      window.sl.ready.then(() => setTimeout(paint, 300)).catch(() => {});
      if (window.sl.events) window.sl.events.addEventListener('loaded', () => { if (D && D.frames && D.frames.render && !D.frames.render.snapped) scheduleSnapshot(2500); });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
