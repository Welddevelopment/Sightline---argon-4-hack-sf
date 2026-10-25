# DEMO HARDEN — API-level smoke of the stage demo path (no rendering)

Test: `node tests/demo_smoke.mjs [--port 5205] [--keep]`. It starts its own mock server with headless Chromium disabled
(RENDER_CHROME=playwright + a missing PLAYWRIGHT_BROWSERS_PATH), never requests a URL that would build with Chromium,
and deletes the demo-* clones it created. Takes about 3 min. Latest result: **74/74 pass, 2 skipped** (report.pdf, clip mp4).

## Covered
health · case list (demo source present) · demo/start twice (distinct clones) · case files (2 videos, 7200 s + 2700 s from
ffprobe, totalVideoSec 9900) · extraction replay → ready · confirm with Witness B moved 0 m → run → recorded checks stand ·
confirm with B moved 6 m (+z) → run → checks re-run on `world_v2_confirmed.js`, wit_B BLOCKED by veh_T_tractor → VISIBLE ·
world JS fetchable · SSE ends · /size · /frame (MM:SS, PNG; bad video 404) · report.json · scene.glb (glTF) · scene.json ·
clips list · whatif (+ bad input 400) · review data/page · aerial · step info · server kill mid-replay → job failed+resumable,
case not stuck running, re-run completes · clone with no aerial / no validation → all graceful · live witness route on odd input.

## Bugs fixed (small edits)
- `server/scene_export.js` (before `exportOpts`): scene.glb/.json returned 500 for v2 worlds (`document is not defined`:
  GLTFExporter needs a canvas for any texture). Now exports untextured *copies* of textured materials when running in Node.
- `server/cases.js` witness route: a statement the parser can't place (whitespace, Spanish, Chinese, emoji) returned 500.
  Now returns 422 with a hint. The UI already shows a fallback for any non-OK reply.
- `server/server.js` final error handler: malformed JSON body returned 500. Now returns the parser's 4xx (400).

## Open issues (not fixed)
- **report.pdf**: `cases/demo-full/exports/report.pdf` does not exist, so in a demo clone `GET /report.pdf` falls through
  demo.js:863 to report.js:182, which builds the PDF with headless Chromium via render_lock.sh. That can take minutes (timeout 12 min).
  Fix: build the PDF once for demo-full under the render lock. Clones copy `exports/`.
- **scene.glb** first request takes about 11 s and returns 78 MB (it also writes the zip). Running `node server/scene_export.js demo-full`
  once should let clones hit the cache: demo.js rewrites `cases/demo-full/` paths in JSON under 20 MB, and the world sha is the same.
  After a witness is moved, the world becomes the `_confirmed` wrapper, so the export is rebuilt (about 11 s).
- **Clips**: no cached clip matches demo-full's world, so any clip click renders with Chromium (clips.js:233).
- **Live witness in mock mode**: demo-full has no `cache/new_witness_example.json` or `new_witness_replay.json`. In mock mode,
  any statement without a landmark gets a 422, not a placement. Live mode calls Argon first.
- After the 6 m confirm, mock-mode report.pdf (if one existed) would be the stale recorded PDF: report.js:178 uses the cache in mock.
