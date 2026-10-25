// Sightline theme switch (DESIGN session). Only sets <html data-theme>; no other DOM or app logic.
// Default: no attribute → tokens.css picks dark for the viewer (#stage) and light elsewhere.
(function () {
  var root = document.documentElement;
  var key = 'sl-theme:' + (location.pathname === '/' || /index\.html$/.test(location.pathname) ? 'viewer' : 'pages');
  if (/report\.html$/.test(location.pathname)) { root.setAttribute('data-theme', 'light'); return; } // the report is paper: always light, no toggle
  try { var saved = localStorage.getItem(key); if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved); } catch (e) {}
  function current() {
    var a = root.getAttribute('data-theme');
    if (a) return a;
    return getComputedStyle(root).colorScheme.indexOf('dark') >= 0 ? 'dark' : 'light';
  }
  function mount() {
    if (document.querySelector('.theme-toggle')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'theme-toggle';
    var paint = function () { var c = current(); b.textContent = c === 'dark' ? 'Light theme' : 'Dark theme'; b.setAttribute('aria-label', 'Switch to ' + (c === 'dark' ? 'light' : 'dark') + ' theme'); };
    b.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(key, next); } catch (e) {}
      paint();
    });
    paint();
    var host = document.querySelector('#top, body > header, header');
    if (host) { b.classList.add('in-header'); host.appendChild(b); } else document.body.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
