// web/demo-flow.js — the 7-step bar shown on every page for a case (index.html, cases.html, review.html), plus the
// "Demo case" card on the cases page. Reads GET /api/demo/case/:id (server/demo.js); starts a demo with
// POST /api/demo/start. Styles: /demo-flow.css (injected here). Semantic classes only (.stepbar, .step,
// .step-active, .step-done, .step-locked, .replay-badge, .replay-note, .demo-card) so a design pass can restyle it.
(() => {
  if (window.__slDemoFlow) return;
  window.__slDemoFlow = true;

  const STEPS = [[1, 'Upload'], [2, 'Extract'], [3, 'Review & confirm'], [4, 'Reconstruct'], [5, 'Findings'], [6, 'Test a witness'], [7, 'Export']];
  const P = location.pathname;
  const page = /\/review(\.html)?$/.test(P) ? 'review' : /\/cases(\.html)?$/.test(P) ? 'cases' : (P === '/' || /\/index(\.html)?$/.test(P)) ? 'viewer' : null;
  if (!page) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const enc = encodeURIComponent;
  const fmtWhen = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };

  // css
  if (!document.querySelector('link[href="/demo-flow.css"]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/demo-flow.css'; document.head.appendChild(l);
  }

  // The step requested by a step-bar link (?step=N). Captured now: page scripts later rewrite the URL.
  const q0 = new URLSearchParams(location.search);
  let wantCase = q0.get('case');
  let forced = Number(q0.get('step')) || null;
  const caseId = () => new URLSearchParams(location.search).get('case') || wantCase;

  const hrefFor = (n, id) => {
    const c = enc(id);
    if (n === 1) return `/cases.html?case=${c}&step=1`;
    if (n === 2 || n === 3) return `/review.html?case=${c}&step=${n}`;
    if (n === 4) return `/cases.html?case=${c}&step=4`;
    if (n === 5) return `/?case=${c}`;
    return `/?case=${c}&step=${n}`;
  };

  function currentStep(info) {
    if (info.running) return 4;
    if (page === 'cases') return forced === 4 ? 4 : 1;
    if (page === 'review') {
      if (!info.has.extraction || info.extractActive) { sawExtracting = true; return 2; }
      return forced === 2 && !sawExtracting ? 2 : 3; // an extraction that finished on this page advances to step 3
    }
    return forced === 6 || forced === 7 ? forced : 5;
  }

  let info = null, timer = null, focusedFor = null, sawExtracting = false;
  let bar = null, note = null;

  function mount() {
    if (bar) return;
    const top = document.getElementById('top');
    bar = document.createElement('nav');
    bar.className = 'stepbar';
    bar.setAttribute('aria-label', 'Case steps');
    bar.innerHTML = '<div class="stepbar-row"></div><div class="replay-note" hidden></div>';
    note = bar.querySelector('.replay-note');
    if (top) top.after(bar); else document.body.prepend(bar);
    document.body.classList.add('has-stepbar');
  }

  function render() {
    if (!info) return;
    mount();
    const cur = currentStep(info);
    const id = info.caseId;
    const items = STEPS.map(([n, label]) => {
      const reached = n <= info.reached || n === cur;
      const cls = ['step', n === cur ? 'step-active' : '', n < cur && reached ? 'step-done' : '', reached ? '' : 'step-locked'].filter(Boolean).join(' ');
      const inner = `<span class="step-n">${n}</span><span class="step-label">${esc(label)}</span>`;
      return `<li class="${cls}"${n === cur ? ' aria-current="step"' : ''}>${reached && n !== cur ? `<a href="${hrefFor(n, id)}">${inner}</a>` : `<span>${inner}</span>`}</li>`;
    }).join('');
    const badge = info.replay
      ? `<span class="replay-badge" title="Replay mode: each step serves the cached outputs of a recorded run of case ${esc(info.replayOf)} instead of calling Argon. New witnesses are tested live.">${info.recordedMode === 'live' ? 'Replay of live run' : 'Replay of recorded run'}${info.recordedAt ? ' · ' + esc(fmtWhen(info.recordedAt)) : ''}</span>`
      : '';
    bar.querySelector('.stepbar-row').innerHTML = `<ol class="steps-list">${items}</ol>${badge}`;
    renderNote(cur);
    focusStep(cur);
  }

  function renderNote(cur) {
    if (!info.replay) { note.hidden = true; return; }
    let html = '';
    const e = info.extractReplay;
    if (info.extractActive && e) {
      html = `<div class="replay-head">Replaying extraction from the recorded run of <span class="mono">${esc(info.replayOf)}</span>…</div><ol class="replay-lines">${e.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>`;
    } else if (info.running && info.runReplay) {
      html = `<div class="replay-head">Replaying the recorded reconstruction (no Argon calls)</div><div class="replay-line">${esc(info.runReplay.last || 'starting…')}</div>`;
    } else if (cur === 2 || cur === 3) {
      html = info.extractTiming
        ? `<div class="replay-line">Extraction served from the recorded run of <span class="mono">${esc(info.replayOf)}</span> · ${esc(info.extractTiming)}</div>`
        : `<div class="replay-line">Demo case: “Run extraction” replays the recorded Argon extraction of <span class="mono">${esc(info.replayOf)}</span> in a few seconds.</div>`;
    } else if (cur === 1) {
      html = `<div class="replay-line">Demo case: the evidence of <span class="mono">${esc(info.replayOf)}</span> is already attached. Every step replays the recorded run; new witnesses (step 6) call Argon live.</div>`;
    } else if (cur === 4 && !info.has.world) {
      html = `<div class="replay-line">“Run reconstruction” replays the recorded loop (generate → render → checks → critique → patch), a few seconds per step.</div>`;
    } else if (cur >= 5 && info.stateReplay && info.stateReplay.confirmedOverrides) {
      html = `<div class="replay-line">Independent checks re-ran live with your confirmed positions (${esc(info.stateReplay.confirmedOverrides.map((w) => `${w.name} moved ${w.movedBy} m`).join(', '))}); Argon findings are from the recorded run.</div>`;
    } else if (cur === 6) {
      html = '<div class="replay-line">This step is live: a new statement is placed and tested by Argon now, not replayed.</div>';
    } else if (cur === 7) {
      html = '<div class="replay-line">Exports are served from the recorded run.</div>';
    }
    note.innerHTML = html;
    note.hidden = !html;
  }

  // Bring the step's control into view once per step.
  function focusStep(cur) {
    const key = `${info.caseId}:${cur}`;
    if (focusedFor === key) return;
    const pick = () => {
      if (page === 'viewer' && cur === 6) return document.getElementById('addWit');
      if (page === 'viewer' && cur === 7) return document.querySelector('.sl-export-wrap') || document.querySelector('.sl-export');
      if (page === 'cases' && cur === 4) return document.getElementById('runBtn');
      return null;
    };
    if (!((page === 'viewer' && (cur === 6 || cur === 7)) || (page === 'cases' && cur === 4 && forced === 4))) { focusedFor = key; return; }
    let tries = 0;
    const tick = () => {
      const el = pick();
      if (!el) { if (++tries < 40) setTimeout(tick, 250); return; }
      focusedFor = key;
      document.querySelectorAll('.step-focus').forEach((x) => x.classList.remove('step-focus'));
      el.classList.add('step-focus');
      try { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { /* */ }
      if (cur === 6) { const t = document.getElementById('witText'); if (t) t.focus({ preventScroll: true }); }
      setTimeout(() => el.classList.remove('step-focus'), 6000);
    };
    tick();
  }

  async function refresh() {
    clearTimeout(timer);
    const id = caseId();
    if (!id) { if (bar) { bar.remove(); bar = note = null; document.body.classList.remove('has-stepbar'); } info = null; return; }
    try {
      const r = await fetch(`/api/demo/case/${enc(id)}`);
      if (r.ok) { info = await r.json(); render(); }
    } catch { /* server offline: keep last bar */ }
    const active = info && (info.extractActive || info.running);
    const waiting = info && page === 'review' && !info.has.extraction; // extraction may start any moment: poll faster
    timer = setTimeout(refresh, active ? 500 : waiting ? 1000 : 4000);
  }

  // Page scripts switch cases with history.replaceState/pushState: follow them.
  for (const fn of ['replaceState', 'pushState']) {
    const orig = history[fn].bind(history);
    history[fn] = (...a) => {
      const before = caseId();
      const r = orig(...a);
      const now = new URLSearchParams(location.search).get('case');
      if (now !== before) { wantCase = now; forced = null; focusedFor = null; refresh(); }
      return r;
    };
  }

  // ---------- cases page: demo card ----------
  async function demoCard() {
    if (page !== 'cases') return;
    const side = document.querySelector('.side') || document.querySelector('main');
    if (!side || side.querySelector('.demo-card')) return;
    let cfg = null;
    try { const r = await fetch('/api/demo/config'); if (r.ok) cfg = await r.json(); } catch { /* */ }
    const card = document.createElement('section');
    card.className = 'demo-card';
    const when = cfg && cfg.recordedAt ? fmtWhen(cfg.recordedAt) : '';
    card.innerHTML = `<div class="demo-card-kicker">Demo case</div>
      <div class="demo-card-title">${esc((cfg && cfg.title) || 'Demo case — Williston FL crash (pre-loaded)')}</div>
      <div class="demo-card-sub">Replays a cached live run${cfg && cfg.sourceCase ? ` of <span class="mono">${esc(cfg.sourceCase)}</span>` : ''}${when ? ` · recorded ${esc(when)}` : ''}. New witnesses are tested live.</div>
      <div class="demo-card-actions"><button class="btn primary sm" type="button" data-start ${cfg && cfg.ready ? '' : 'disabled'}>Start demo</button><span class="demo-card-err small"></span></div>`;
    const head = side.querySelector('.side-head');
    if (head) head.after(card); else side.prepend(card);
    const btn = card.querySelector('[data-start]');
    if (cfg && !cfg.ready) card.querySelector('.demo-card-err').textContent = 'No recorded run available on this server.';
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'Preparing…';
      try {
        const r = await fetch('/api/demo/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
        location.href = j.next;
      } catch (e) { btn.disabled = false; btn.textContent = 'Start demo'; card.querySelector('.demo-card-err').textContent = e.message; }
    };
  }

  // run buttons → pick up the replay log / running state right away
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#runExt, #runBtn, #confirmBtn')) setTimeout(refresh, 400); }, true);
  const boot = () => { refresh(); demoCard(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
