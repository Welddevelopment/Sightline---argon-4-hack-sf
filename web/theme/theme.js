// Sightline theme switches (DESIGN session). Only touches <html> attributes, the /theme/ stylesheets and one toggle button.
//
// Rollback switches (each persists in this browser until switched back):
//   ?theme=off            → turn the whole design layer off (original look);  ?theme=on to restore
//   ?design-off=a,b       → turn off individual changes; keys: compare, overlays, fixes, steps, logo, keyframes
//   ?design-off=          → (empty) turn all individual changes back on
//   ?mode=light|dark      → set the colour mode (same as the header toggle)
// Default colour mode: dark on every page (stage continuity), except the report, which is always paper/light.
(function () {
  var DEFAULT_MODE = 'dark';
  var root = document.documentElement;
  var q = new URLSearchParams(location.search);
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  };

  // 1) master switch
  if (q.get('theme') === 'off') store.set('sl-theme-off', '1');
  if (q.get('theme') === 'on') store.set('sl-theme-off', null);
  if (store.get('sl-theme-off') === '1') {
    var links = document.querySelectorAll('link[href^="/theme/"], link[href^="theme/"]');
    for (var i = 0; i < links.length; i++) links[i].disabled = true;
    root.setAttribute('data-design', 'off');
    return;
  }

  // 2) per-change switches
  if (q.has('design-off')) store.set('sl-design-off', q.get('design-off').replace(/,/g, ' ').trim() || null);
  var off = store.get('sl-design-off');
  if (off) root.setAttribute('data-design-off', off);

  // 3) colour mode
  var isReport = /report\.html$/.test(location.pathname);
  if (isReport) { root.setAttribute('data-theme', 'light'); return; }
  if (q.get('mode') === 'light' || q.get('mode') === 'dark') store.set('sl-mode', q.get('mode'));
  var mode = store.get('sl-mode') || DEFAULT_MODE;
  root.setAttribute('data-theme', mode);

  function mount() {
    if (document.querySelector('.theme-toggle')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'theme-toggle';
    var paint = function () {
      var c = root.getAttribute('data-theme');
      b.textContent = c === 'dark' ? 'Light mode' : 'Dark mode';
      b.setAttribute('aria-label', 'Switch to ' + (c === 'dark' ? 'light' : 'dark') + ' mode');
    };
    b.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      store.set('sl-mode', next);
      paint();
    });
    paint();
    var host = document.querySelector('#top, body > header, header');
    if (host) { b.classList.add('in-header'); host.appendChild(b); } else document.body.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
