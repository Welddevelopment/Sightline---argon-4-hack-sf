# RENDER status
- Headless WebGL WORKS here: @sparticuz/chromium (npm, in package.json) + args --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist. WebGL2 via SwiftShader verified; Three.js scene screenshots verified (PNG read back).
- render/record.js: CLI + `renderViews({world|worldUrl, views, fps, outDir, t, stillOnly, extraWitnesses, baseUrl, page})` -> {videos|mp4s, stills|pngs, files, duration, browser}
  - views: array/comma list or 'all' (overhead + all witnesses). Stills at witness observationTime (overhead: duration/2).
  - stillOnly+t: one PNG per view, ~1.3s total. extraWitnesses are injected into window.sl.world.witnesses (page loaded with cam=overhead, then sl.setCamera(view)).
  - Browser: RENDER_CHROME=packaged|playwright, default auto (Playwright chromium if installed, else packaged). BASE_URL uses a running server, else an internal static server on the repo root (also serves web/ at /).
  - Page: default '/' (web/index.html); override with --page or RENDER_PAGE. Size RENDER_W/RENDER_H (960x540).
- Dev: render/dev/index.html + dev_world.js (proved 6s world, 2 views mp4 in ~15s at 10fps).
- TODO: re-run against real web/index.html + worlds/reference_world.js when they land.
