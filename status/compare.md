# COMPARE & WHAT-IF slice

Files: `web/compare.html`, `web/compare.js`, `web/compare.css`, `server/whatif.js` (`mountWhatIf(app, ctx)`), one mount line in
`server/server.js`. SPEC: "## COMPARE & WHAT-IF (12:26)".

## Page: `/compare.html?case=<id>`
Optional: `a=wit_X&b=wit_Y` (pair; default = a clear vs a blocked sight line on the same target), `t=` (start time), `mph=` (start in
what-if), `object=veh_X` (vehicle to re-time; default = the fastest vehicle just before `meta.impactT`).
- One `THREE.WebGLRenderer`, three scissor viewports that follow three transparent DOM panes: A's eye view, B's eye view (60° FOV at the
  witness eye, aimed at `lookAt`), overhead ortho camera framing the impact + the two witnesses. Live ray-cast per frame (same rules as
  `checks.castRay`): reticle on the target, green/red sight ray on the overhead, "line of sight clear / blocked by X" badge.
- Captions under each pane: claim (quote) + citation + independent result (cached `state.checks`; in what-if mode the server result,
  with the as-reconstructed result dimmed below). Overhead caption = physical evidence (world objects of kind `mark` with citations +
  position/distance/skid facts) + timing/plausibility checks summary.
- Shared timeline with ticks: each witness's claim time, impact, what-if arrival, "path clear"; jump buttons; Play.
- What-if slider (0.4x–1.4x of the reconstructed speed). On change: fresh world, `retimeWorld` client-side for the preview and
  sentence, then `GET /api/cases/:id/whatif` re-runs `checks.runAll` server-side; captions update from the server result.
  The overhead shows the as-reconstructed position as a white ghost and the dashed conflict corridor.

## Endpoint: `GET /api/cases/:id/whatif?object=veh_A&targetMph=60`
Loads the case world (cache/state.json `world`, else the newest `worlds/world_vN.js`), adds case witnesses, `retimeWorld` (exported
from web/compare.js; Node imports it with `three` from node_modules), `checks.runAll`, diffs sight lines vs. the as-reconstructed
results. Memoized per (case, world file mtime, object, mph). ~2.5 s cold, instant cached.

## Tested (mock, case `demo`)
`targetMph=60`: "At 60 mph instead of 74, the passenger sedan reaches the impact location 2.4 s later (t=12.9 s instead of 10.4 s).
The refrigerated van semitrailer clears its path at t=12.0 s, ... needs 64 mph or less." 8 checks, sight lines unchanged
(witness observation times are fixed). Screenshots in headless Chromium (see below).
