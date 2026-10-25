# PRODUCT-C: per-camera witness-view clip export — status

DONE (see verification below). Contract: SPEC.md "## EXPORTS (12:10)" -> "Witness-view clips" + "Clips correction (12:55)".

Files (mine): server/clips.js, cases/demo/exports/clips/* (mp4 + .json sidecars), status/product_c.md.
Edits elsewhere: one mount line in server/server.js (`mountClips(app, { ROOT, MODE, getThree, errMsg, legacyState })`).

Endpoints
- GET /api/cases/:id/clips -> JSON index: one entry per camera (overhead + every witness), default window, check result, ready URL, cached flag.
- GET /api/cases/:id/clips/:camera.mp4?t0=&t1=[&download=1][&fresh=1 live only] -> H.264 (libx264 -preset veryfast, crf 23, yuv420p, faststart) 1280x720 @ 12 fps (CLIP_FPS).
  Default window = sightline-check t (state.checks, check=sightline, subject=camera; else witness.observationTime) -3 s .. +1 s; overhead = min(obs)-3 .. max(obs)+1; clamped to [0, duration], max 30 s.
- Frames: headless Chromium (render/record.js launchBrowser) on the viewer `/?clean=1&world=..&cam=..&t=..`, sl.setTime + renderFrame per frame, screenshot (WebGL + HUD/labels overlay visible).
- Burned-in caption (ffmpeg drawbox+drawtext): line 1 "SIMULATED / FICTIONAL WITNESS — analysis draft, not evidence | case | camera"; line 2 sightline check (VISIBLE / BLOCKED by X, target, t) + clip window; top-right running scene time "t = N.NN s". MP4 title/comment metadata carry the same labels.
- Cache: cases/<id>/exports/clips/<camera>__<world>.<sha256[0:12]>__<t0>-<t1>.mp4 + .json (worldSha256, caption, check, frames, renderSeconds). Key = sha256 of world file (+ live-witness def), so re-seeding the demo world changes the key; stale clips are never served. Mock mode serves cache; on a render failure in mock mode falls back only to a same-camera, same-world-sha clip. Headers X-Clip-Cache hit|miss|fallback, X-Clip-Window, X-Clip-Render-Seconds.
- All Chromium/ffmpeg runs: child process `scripts/render_lock.sh node server/clips.js --job <job.json>`.

Re-render the demo defaults (after a world change): start the server, then
  for c in overhead wit_A wit_B wit_C; do curl -s -o /dev/null "http://127.0.0.1:<port>/api/cases/demo/clips/$c.mp4"; done
(old-sha files in cases/demo/exports/clips/ can be deleted; they are never served).
