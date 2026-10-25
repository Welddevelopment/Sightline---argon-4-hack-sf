// Sightline exports: injects an "Export report" button into the viewer (index.html) and case page (cases.html).
// Downloads GET /api/cases/:id/report.pdf (server-rendered with headless Chromium; cached for the demo in mock mode).
(() => {
  if (window.__slExports) return;
  window.__slExports = true;
  const isCasesPage = /\/cases(\.html)?$/.test(location.pathname);

  const css = document.createElement('style');
  css.textContent = `
    .sl-export { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; flex: none; }
    .sl-export svg { width: 13px; height: 13px; flex: none; }
    .sl-export[aria-busy="true"] { opacity: .75; cursor: progress; }
    .sl-export-wrap { display: inline-flex; align-items: center; gap: 6px; flex: none; }
    .sl-export-preview { font-size: 11px; color: var(--muted, #8794a7); text-decoration: none; white-space: nowrap; }
    .sl-export-preview:hover { color: var(--text, #dfe5ee); text-decoration: underline; }
    .sl-export-err { font-size: 11px; color: var(--red, #ff5a5a); max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `;
  document.head.appendChild(css);

  const caseId = () => {
    const q = new URLSearchParams(location.search).get('case');
    if (q) return q;
    if (isCasesPage) return null; // case list / new-case form: nothing to export yet
    const pick = document.getElementById('casePick');
    return (pick && pick.value) || 'demo';
  };

  const icon = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 2v8m0 0l-3-3m3 3l3-3M3 12.5h10"/></svg>';
  const wrap = document.createElement('span');
  wrap.className = 'sl-export-wrap';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn ' + (isCasesPage ? 'sm' : 'small') + ' sl-export';
  btn.innerHTML = `${icon}<span>Export report</span>`;
  btn.title = 'Download the analysis report (PDF): findings, independent checks, witness-view figures, validation and provenance';
  const preview = document.createElement('a');
  preview.className = 'sl-export-preview';
  preview.textContent = 'Preview';
  preview.target = '_blank';
  preview.rel = 'noopener';
  const err = document.createElement('span');
  err.className = 'sl-export-err';
  err.hidden = true;
  wrap.append(btn, preview, err);

  const label = btn.querySelector('span');
  function sync() {
    const id = caseId();
    wrap.hidden = !id;
    if (id) preview.href = `/report.html?case=${encodeURIComponent(id)}`;
  }

  btn.addEventListener('click', async () => {
    const id = caseId();
    if (!id || btn.getAttribute('aria-busy') === 'true') return;
    btn.setAttribute('aria-busy', 'true');
    err.hidden = true;
    label.textContent = 'Preparing PDF…';
    try {
      const r = await fetch(`/api/cases/${encodeURIComponent(id)}/report.pdf`);
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try { const j = await r.json(); msg = j.error || msg; } catch { /* not json */ }
        throw new Error(msg);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sightline-${id}-report.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      label.textContent = 'Report downloaded';
      setTimeout(() => { label.textContent = 'Export report'; }, 2500);
    } catch (e) {
      label.textContent = 'Export report';
      err.textContent = 'Export failed: ' + (e && e.message || e);
      err.title = err.textContent;
      err.hidden = false;
    } finally {
      btn.removeAttribute('aria-busy');
    }
  });

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

  // cases.js / ui.js change ?case= with history.replaceState/pushState; keep the button's target in step.
  for (const k of ['pushState', 'replaceState']) {
    const orig = history[k];
    history[k] = function (...a) { const r = orig.apply(this, a); setTimeout(sync, 0); return r; };
  }
  window.addEventListener('popstate', sync);
  document.addEventListener('change', (e) => { if (e.target && e.target.id === 'casePick') sync(); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
