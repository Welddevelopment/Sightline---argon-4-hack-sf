// Sightline exports: injects export controls into the viewer (index.html) and case page (cases.html).
//  - "Export report"  -> GET /api/cases/:id/report.pdf (server-rendered with headless Chromium; cached for the demo in mock mode)
//  - "More exports"   -> report preview, scene download (GET /api/cases/:id/scene.zip, .glb, .json?download=1)
//                        and one witness-view clip per camera (GET /api/cases/:id/clips -> clips/:camera.mp4?...&download=1)
(() => {
  if (window.__slExports) return;
  window.__slExports = true;
  const isCasesPage = /\/cases(\.html)?$/.test(location.pathname);

  const css = document.createElement('style');
  css.textContent = `
    .sl-export { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; flex: none; }
    .sl-export svg { width: 13px; height: 13px; flex: none; }
    .sl-export[aria-busy="true"] { opacity: .75; cursor: progress; }
    .sl-export-wrap { display: inline-flex; align-items: center; gap: 6px; flex: none; position: relative; }
    .sl-export-err { font-size: 11px; color: var(--red, #ff5a5a); max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sl-more { position: relative; }
    .sl-more > summary { list-style: none; }
    .sl-more > summary::-webkit-details-marker { display: none; }
    .sl-more > summary .caret { font-size: 9px; opacity: .7; }
    .sl-menu { position: absolute; right: 0; top: calc(100% + 6px); z-index: 50; min-width: 280px; max-width: 340px; background: var(--panel, #10151c);
      border: 1px solid var(--line, #222b38); border-radius: 6px; box-shadow: 0 10px 28px rgba(0,0,0,.45); padding: 6px 0; font: 12px var(--sans, system-ui, sans-serif); color: var(--text, #dfe5ee); }
    .sl-menu h4 { margin: 6px 12px 4px; font: 600 10px var(--sans, system-ui, sans-serif); letter-spacing: .08em; text-transform: uppercase; color: var(--muted, #8794a7); }
    .sl-menu a, .sl-menu button.sl-item { display: flex; width: 100%; box-sizing: border-box; align-items: baseline; justify-content: space-between; gap: 10px; padding: 6px 12px;
      background: none; border: 0; color: inherit; font: inherit; text-align: left; text-decoration: none; cursor: pointer; }
    .sl-menu a:hover, .sl-menu button.sl-item:hover { background: var(--panel2, #151b24); }
    .sl-menu .sub { color: var(--muted, #8794a7); font-size: 11px; white-space: nowrap; }
    .sl-menu .sub.ok { color: var(--green, #3ddc84); }
    .sl-menu .sub.bad { color: var(--red, #ff5a5a); }
    .sl-menu .note { margin: 2px 12px 6px; font-size: 11px; color: var(--muted, #8794a7); line-height: 1.4; }
    .sl-menu hr { border: 0; border-top: 1px solid var(--line, #222b38); margin: 6px 0; }
    .sl-menu .sl-item[aria-busy="true"] { cursor: progress; opacity: .8; }
  `;
  document.head.appendChild(css);

  const caseId = () => {
    const q = new URLSearchParams(location.search).get('case');
    if (q) return q;
    if (isCasesPage) return null; // case list / new-case form: nothing to export yet
    const pick = document.getElementById('casePick');
    return (pick && pick.value) || 'demo';
  };
  const enc = encodeURIComponent;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const small = isCasesPage ? 'sm' : 'small';

  const icon = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 2v8m0 0l-3-3m3 3l3-3M3 12.5h10"/></svg>';
  const wrap = document.createElement('span');
  wrap.className = 'sl-export-wrap';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `btn ${small} sl-export`;
  btn.innerHTML = `${icon}<span>Export report</span>`;
  btn.title = 'Download the analysis report (PDF): findings, independent checks, witness-view figures, validation and provenance';

  const more = document.createElement('details');
  more.className = 'sl-more';
  more.innerHTML = `<summary class="btn ${small} sl-export" title="Report preview, 3D scene download and witness-view clips">More exports <span class="caret">▾</span></summary><div class="sl-menu" role="menu"></div>`;
  const menu = more.querySelector('.sl-menu');

  const err = document.createElement('span');
  err.className = 'sl-export-err';
  err.hidden = true;
  wrap.append(btn, more, err);
  const label = btn.querySelector('span');

  function sync() {
    const id = caseId();
    wrap.hidden = !id;
    if (more.open && id !== more.dataset.case) more.open = false;
  }

  function showErr(m) { err.textContent = m; err.title = m; err.hidden = false; }

  // fetch -> blob -> save, so long renders (clips on a cache miss) can show progress instead of a silent wait
  async function download(url, filename) {
    const r = await fetch(url);
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { const j = await r.json(); msg = j.error || msg; } catch { /* not json */ }
      throw new Error(msg);
    }
    const cd = r.headers.get('Content-Disposition') || '';
    const name = (cd.match(/filename="?([^";]+)"?/) || [])[1] || filename;
    const blob = await r.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  }

  btn.addEventListener('click', async () => {
    const id = caseId();
    if (!id || btn.getAttribute('aria-busy') === 'true') return;
    btn.setAttribute('aria-busy', 'true');
    err.hidden = true;
    label.textContent = 'Preparing PDF…';
    try {
      await download(`/api/cases/${enc(id)}/report.pdf`, `sightline-${id}-report.pdf`);
      label.textContent = 'Report downloaded';
      setTimeout(() => { label.textContent = 'Export report'; }, 2500);
    } catch (e) {
      label.textContent = 'Export report';
      showErr('Export failed: ' + (e && e.message || e));
    } finally {
      btn.removeAttribute('aria-busy');
    }
  });

  const fmtT = (t) => `${Number(t).toFixed(1)} s`;

  async function fillMenu() {
    const id = caseId();
    if (!id) return;
    more.dataset.case = id;
    const base = `/api/cases/${enc(id)}`;
    menu.innerHTML = `
      <h4>Report</h4>
      <a href="/report.html?case=${enc(id)}" target="_blank" rel="noopener" role="menuitem">Preview report <span class="sub">opens in a new tab</span></a>
      <hr>
      <h4>3D scene</h4>
      <a href="${base}/scene.zip" download role="menuitem" title="glTF scene + JSON timeline + README (units, axes, labels)">Download scene (.zip) <span class="sub">.glb + .json + README</span></a>
      <a href="${base}/scene.glb" download role="menuitem">Scene model only <span class="sub">.glb</span></a>
      <a href="${base}/scene.json?download=1" download role="menuitem">Scene data only <span class="sub">.json</span></a>
      <hr>
      <h4>Witness-view clips (.mp4)</h4>
      <div class="sl-clips"><div class="note">Loading clips…</div></div>`;
    const box = menu.querySelector('.sl-clips');
    try {
      const r = await fetch(`${base}/clips`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      const witNames = {};
      try { for (const w of (window.sl && window.sl.world && window.sl.world.witnesses) || []) witNames[w.id] = w.name || w.id; } catch { /* viewer not ready */ }
      const clips = j.clips || [];
      if (!clips.length) { box.innerHTML = '<div class="note">No clips for this case yet.</div>'; return; }
      box.innerHTML = clips.map((c, i) => {
        const name = c.camera === 'overhead' ? 'Overhead' : (witNames[c.camera] || c.camera);
        const ck = c.check ? `<span class="sub ${c.check.pass ? 'ok' : 'bad'}">${c.check.pass ? 'clear' : 'blocked'}</span>` : '';
        return `<button type="button" class="sl-item" role="menuitem" data-i="${i}" title="${esc(c.check ? c.check.text : 'Overhead view across the observation window')}">
          <span>${esc(name)} <span class="sub">${fmtT(c.t0)}–${fmtT(c.t1)}</span></span><span class="sub st">${ck}${c.cached ? '' : ' <span class="sub">render ~1–2 min</span>'}</span></button>`;
      }).join('') + '<div class="note">Viewer frames with a burned-in caption: SIMULATED / FICTIONAL RECONSTRUCTION and the sight-line check result.</div>';
      box.querySelectorAll('.sl-item').forEach((el) => el.addEventListener('click', async () => {
        if (el.getAttribute('aria-busy') === 'true') return;
        const c = clips[Number(el.dataset.i)];
        const st = el.querySelector('.st');
        const prev = st.innerHTML;
        el.setAttribute('aria-busy', 'true');
        err.hidden = true;
        st.innerHTML = `<span class="sub">${c.cached ? 'downloading…' : 'rendering…'}</span>`;
        try {
          await download(c.url + (c.url.includes('?') ? '&' : '?') + 'download=1', `sightline_${id}_${c.camera}.mp4`);
          c.cached = true;
          st.innerHTML = '<span class="sub ok">downloaded</span>';
          setTimeout(() => { st.innerHTML = prev.replace(/ <span class="sub">render ~1–2 min<\/span>/, ''); }, 2500);
        } catch (e) {
          st.innerHTML = prev;
          showErr('Clip failed: ' + (e && e.message || e));
        } finally { el.removeAttribute('aria-busy'); }
      }));
    } catch (e) {
      box.innerHTML = `<div class="note">Clips unavailable: ${esc(e && e.message || e)}</div>`;
    }
  }

  more.addEventListener('toggle', () => { if (more.open) fillMenu(); });
  document.addEventListener('click', (e) => { if (more.open && !more.contains(e.target)) more.open = false; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && more.open) more.open = false; });

  function mount() {
    const top = document.getElementById('top');
    if (!top) return;
    if (isCasesPage) {
      const nav = top.querySelector('nav');
      if (nav) nav.prepend(wrap); else top.appendChild(wrap);
      nav && (nav.style.display = nav.style.display || 'flex', nav.style.gap = nav.style.gap || '10px', nav.style.alignItems = 'center');
    } else {
      const cams = document.getElementById('cams');
      if (cams) top.insertBefore(wrap, cams); else top.appendChild(wrap);
    }
    sync();
  }

  // cases.js / ui.js change ?case= with history.replaceState/pushState; keep the controls' target in step.
  for (const k of ['pushState', 'replaceState']) {
    const orig = history[k];
    history[k] = function (...a) { const r = orig.apply(this, a); setTimeout(sync, 0); return r; };
  }
  window.addEventListener('popstate', sync);
  document.addEventListener('change', (e) => { if (e.target && e.target.id === 'casePick') sync(); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
