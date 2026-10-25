# VIEWER slice status
Done (untested in a real browser: no Chromium available here; JS passes `node --check`, sightline logic verified in Node against worlds/reference_world.js: wit_B blocked by occ_shelter, A and C visible).

Files: web/index.html, web/viewer.js, web/ui.js, web/style.css, web/dev_world.js (fallback only).

URL params: ?world=&cam=overhead|wit_X|chase_veh_X&t=  plus ?clean=1 (hides all UI chrome; full-bleed canvas + HUD, for headless screenshots) and ?rays=0.
window.sl: ready, loadWorld(url), setCamera(id), setTime(t), renderFrame(), world (per spec) plus extras:
 cameras(), sightline(witnessId[, t]) -> {visible, blockedBy, distance, from, to, hit}, addWitness(w), highlight(id|[ids]|null),
 setRays(bool), setLabels(bool), camera, time, worldUrl, events (EventTarget: loaded/camera/time/witnesses/pick/ready).
sl exists immediately (inline script in index.html) so `await window.sl.ready` works before viewer.js loads.
Import map: three -> /node_modules/three/build/three.module.js ; three/addons/ -> /node_modules/three/examples/jsm/
Needs server to serve /node_modules, /worlds, /case, /deposition/out, /api/*.
API use: GET /api/state, GET /api/witnesses, POST /api/witness, POST /api/loop. All optional; UI works standalone.
