// Sightline background-job watcher (included on index.html and cases.html).
// Polls GET /api/jobs; shows a floating status badge, toasts on Ready/Failed, a browser Notification when a
// reconstruction becomes Ready (permission asked on first user gesture), navigator app badge + title count,
// and Building / Queued / Ready / Failed pills on the case list (#caselist li[data-id]).
(() => {
  if (window.__sightlineJobs) return; window.__sightlineJobs = true;
  const FAST = 2500, SLOW = 15000, SEEN_KEY = 'sightline.jobs.seen';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = { get() { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; } catch { return {}; } },
    set(v) { try { localStorage.setItem(SEEN_KEY, JSON.stringify(v)); } catch { /* */ } } };
  const LABEL = { queued: 'Queued', building: 'Building', ready: 'Ready', failed: 'Failed' };
  const STEP = { start: 'starting', queued: 'queued', extract: 'extracting', evidence: 'reading evidence', generate: 'generating world', render: 'rendering',
    checks: 'checks', critique: 'critique', patch: 'patching', round: 'replaying', done: 'finishing' };
  let jobs = [], prev = null, timer = null, unseen = new Set(), baseTitle = document.title;

  // ---- styles ----
  const css = document.createElement('style');
  css.textContent = `
  .sj-pill{display:inline-flex;align-items:center;gap:5px;font:600 10px/1 var(--sans,system-ui);letter-spacing:.06em;text-transform:uppercase;padding:4px 7px;border-radius:3px;border:1px solid;white-space:nowrap;margin-left:6px}
  .sj-pill.building,.sj-pill.queued{color:#e2b052;border-color:rgba(226,176,82,.5);background:rgba(226,176,82,.08)}
  .sj-pill.ready{color:#5fc28a;border-color:rgba(95,194,138,.5);background:rgba(95,194,138,.08)}
  .sj-pill.failed{color:#e5715f;border-color:rgba(229,113,95,.5);background:rgba(229,113,95,.08)}
  .sj-pill .sj-dot{width:6px;height:6px;border-radius:50%;background:currentColor;animation:sjp 1s ease-in-out infinite alternate}
  .sj-pill .sj-step{font-weight:500;text-transform:none;letter-spacing:0;opacity:.85}
  @keyframes sjp{from{opacity:.25}to{opacity:1}}
  .sj-resume{font:600 10px var(--sans,system-ui);color:inherit;background:none;border:0;text-decoration:underline;cursor:pointer;padding:0 0 0 4px}
  #sj-badge{position:fixed;right:16px;bottom:16px;z-index:9998;display:none;align-items:center;gap:8px;padding:8px 12px;border-radius:18px;cursor:pointer;
    background:var(--panel2,#151b24);color:var(--text,#e6e9ee);border:1px solid var(--line,#222b38);font:500 12px var(--sans,system-ui);box-shadow:0 4px 16px rgba(0,0,0,.35)}
  #sj-badge .sj-n{min-width:18px;height:18px;border-radius:9px;background:#5fc28a;color:#0b0e13;font:700 11px/18px var(--sans,system-ui);text-align:center;padding:0 5px}
  #sj-panel{position:fixed;right:16px;bottom:58px;z-index:9998;width:min(340px,calc(100vw - 32px));max-height:50vh;overflow:auto;display:none;
    background:var(--panel,#10151c);color:var(--text,#e6e9ee);border:1px solid var(--line,#222b38);border-radius:6px;box-shadow:0 8px 28px rgba(0,0,0,.45);font:12px/1.4 var(--sans,system-ui)}
  #sj-panel .sj-row{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--line,#222b38)}
  #sj-panel .sj-row a{color:inherit;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:none}
  #sj-panel .sj-row a:hover{text-decoration:underline}
  #sj-toasts{position:fixed;right:16px;top:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:min(360px,calc(100vw - 32px))}
  .sj-toast{background:var(--panel2,#151b24);color:var(--text,#e6e9ee);border:1px solid var(--line,#222b38);border-left:3px solid #5fc28a;border-radius:4px;padding:10px 12px;
    font:12px/1.4 var(--sans,system-ui);box-shadow:0 6px 20px rgba(0,0,0,.4);display:flex;gap:10px;align-items:flex-start}
  .sj-toast.failed{border-left-color:#e5715f}
  .sj-toast b{display:block;margin-bottom:2px}
  .sj-toast .sj-x{margin-left:auto;background:none;border:0;color:var(--muted,#8794a7);cursor:pointer;font-size:15px;line-height:1}
  .sj-toast a,.sj-toast button.sj-act{color:#e2b052;background:none;border:0;padding:0;font:600 12px var(--sans,system-ui);cursor:pointer;text-decoration:underline;margin-right:10px}`;
  document.head.appendChild(css);

  const el = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); Object.assign(e, attrs); if (html) e.innerHTML = html; return e; };
  const badge = el('button', { id: 'sj-badge', type: 'button', title: 'Background reconstructions' });
  const panel = el('div', { id: 'sj-panel', role: 'dialog', ariaLabel: 'Reconstruction jobs' });
  const toasts = el('div', { id: 'sj-toasts', role: 'status', ariaLive: 'polite' });
  const mount = () => { document.body.append(badge, panel, toasts); };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  badge.onclick = () => { panel.style.display = panel.style.display === 'block' ? 'none' : 'block'; unseen.clear(); paint(); };

  const openUrl = (id) => '/?case=' + encodeURIComponent(id);
  const stepText = (j) => j.status === 'building' ? (STEP[j.step] || j.step || '') + (j.round ? ` r${j.round}` : '')
    : j.status === 'queued' ? (j.queuePosition ? `#${j.queuePosition} in line` : '') : '';
  const pill = (j) => `<span class="sj-pill ${esc(j.status)}" title="${esc(j.error || j.message || '')}">${j.status === 'building' || j.status === 'queued' ? '<span class="sj-dot"></span>' : ''}${esc(LABEL[j.status] || j.status)}${stepText(j) ? ` <span class="sj-step">${esc(stepText(j))}</span>` : ''}${j.status === 'failed' ? `<button class="sj-resume" data-resume="${esc(j.caseId)}" type="button">${j.resumable ? 'Resume' : 'Retry'}</button>` : ''}</span>`;

  async function resume(id) {
    const j = jobs.find((x) => x.caseId === id);
    try {
      const r = await fetch(`/api/cases/${encodeURIComponent(id)}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(j && j.mode ? { mode: j.mode } : {}) });
      if (!r.ok) { const b = await r.json().catch(() => ({})); toast({ caseId: id, status: 'failed', title: j?.title || id, error: b.error || 'HTTP ' + r.status }, true); }
    } catch (e) { toast({ caseId: id, status: 'failed', title: j?.title || id, error: e.message }, true); }
    poll(true);
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-resume]');
    if (b) { e.preventDefault(); e.stopPropagation(); resume(b.dataset.resume); }
  }, true);

  // ---- notifications ----
  const canNotify = () => 'Notification' in window;
  function askPermission() { if (canNotify() && Notification.permission === 'default') { try { Notification.requestPermission(); } catch { /* */ } } }
  // Browsers require a user gesture for the permission prompt: ask on the first click while a job is (or gets) active.
  document.addEventListener('click', () => { if (jobs.some((j) => j.status === 'building' || j.status === 'queued')) askPermission(); }, true);
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#runBtn')) askPermission(); }, true);
  function notify(j) {
    if (!canNotify() || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(j.status === 'ready' ? 'Reconstruction ready' : 'Reconstruction failed', {
        body: `${j.title || j.caseId}${j.status === 'failed' && j.error ? ' — ' + j.error : ''}`, tag: 'sightline-job-' + j.caseId });
      n.onclick = () => { window.focus(); if (j.status === 'ready') location.href = openUrl(j.caseId); n.close(); };
    } catch { /* */ }
  }

  function toast(j, quick) {
    const t = el('div', { className: 'sj-toast' + (j.status === 'failed' ? ' failed' : '') });
    t.innerHTML = `<div><b>${j.status === 'ready' ? 'Reconstruction ready' : 'Reconstruction failed'}</b>${esc(j.title || j.caseId)}${j.status === 'failed' && j.error ? `<div style="opacity:.8">${esc(j.error)}</div>` : ''}
      <div style="margin-top:6px">${j.status === 'ready' ? `<a href="${openUrl(j.caseId)}">Open in viewer</a>` : `<button class="sj-act" data-resume="${esc(j.caseId)}" type="button">${j.resumable ? 'Resume' : 'Retry'}</button>`}</div></div>
      <button class="sj-x" type="button" aria-label="Dismiss">&times;</button>`;
    t.querySelector('.sj-x').onclick = () => t.remove();
    toasts.appendChild(t);
    setTimeout(() => t.remove(), quick ? 6000 : 20000);
  }

  // ---- case list decoration ----
  function decorateList() {
    const ul = document.getElementById('caselist');
    if (!ul) return;
    for (const li of ul.querySelectorAll('li[data-id]')) {
      const j = jobs.find((x) => x.caseId === li.dataset.id);
      let slot = li.querySelector('.sj-slot');
      const html = j ? pill(j) : '';
      if (!html) { slot?.remove(); continue; }
      if (!slot) { slot = el('span', { className: 'sj-slot' }); (li.querySelector('.cf') || li).appendChild(slot); }
      if (slot.innerHTML !== html) slot.innerHTML = html;
    }
  }
  const mo = new MutationObserver(() => decorateList());
  const watchList = () => { const ul = document.getElementById('caselist'); if (ul) mo.observe(ul, { childList: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchList); else watchList();

  function paint() {
    const active = jobs.filter((j) => j.status === 'building' || j.status === 'queued');
    const n = unseen.size;
    if (!active.length && !n && panel.style.display !== 'block') { badge.style.display = 'none'; }
    else {
      badge.style.display = 'inline-flex';
      badge.innerHTML = active.length ? `${pill(active.find((j) => j.status === 'building') || active[0])}<span>${active.length > 1 ? active.length + ' jobs' : esc(active[0].title || active[0].caseId)}</span>${n ? `<span class="sj-n">${n}</span>` : ''}`
        : `<span class="sj-n">${n}</span><span>ready</span>`;
    }
    panel.innerHTML = jobs.length ? jobs.map((j) => `<div class="sj-row"><a href="${openUrl(j.caseId)}">${esc(j.title || j.caseId)}</a>${pill(j)}</div>`).join('') : '<div class="sj-row">No reconstructions yet.</div>';
    document.title = (active.length ? `(${active.length}) ` : n ? `(${n} ready) ` : '') + baseTitle;
    try { if (navigator.setAppBadge) { if (n || active.length) navigator.setAppBadge(n || active.length); else navigator.clearAppBadge(); } } catch { /* */ }
    decorateList();
  }

  async function poll(soon) {
    clearTimeout(timer);
    try {
      const r = await fetch('/api/jobs', { cache: 'no-store' });
      if (r.ok) {
        jobs = await r.json();
        const seen = store.get();
        for (const j of jobs) {
          const key = j.caseId + '@' + (j.startedAt || '');
          const was = prev ? prev.get(j.caseId) : undefined;
          // Transition seen live, or a job finished while no tab was open that we last saw active.
          const lastSeen = seen[j.caseId];
          const finished = j.status === 'ready' || j.status === 'failed';
          const transitioned = finished && ((was && was.key === key && (was.status === 'building' || was.status === 'queued'))
            || (!was && lastSeen && lastSeen.key === key && (lastSeen.status === 'building' || lastSeen.status === 'queued')));
          if (transitioned) { toast(j); notify(j); if (j.status === 'ready') unseen.add(j.caseId); }
          seen[j.caseId] = { key, status: j.status };
        }
        store.set(seen);
        prev = new Map(jobs.map((j) => [j.caseId, { key: j.caseId + '@' + (j.startedAt || ''), status: j.status }]));
        paint();
      }
    } catch { /* server down: keep last view */ }
    const active = jobs.some((j) => j.status === 'building' || j.status === 'queued');
    timer = setTimeout(poll, soon || active ? FAST : SLOW);
  }
  // Pick up runs started on this page quickly.
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#runBtn')) setTimeout(() => poll(true), 600); }, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  poll();
})();
