# APP slice status
server/server.js DONE. `npm run dev` -> http://localhost:5173 (PORT env), logs mode (mock default; key never logged).
Tested with real server (modules missing) and with stub modules (witness+loop+SSE flow OK).

Endpoints: GET / (503 until web/index.html exists); static /web /worlds /renders /case /cache /node_modules /deposition/out;
GET /api/state; GET /api/witnesses (witnesses added live); POST /api/witness {statement}; POST /api/loop; GET /api/loop/stream (SSE: hello/start/progress/done/error); GET /api/health.

Assumed contracts of other slices (adjust one side if different):
- argon/new_witness.js: `newWitness(statement, world)` -> witness entry (or {witness}); id defaulted to wit_live_N.
- argon/loop.js: `runLoop({mode, onProgress(ev)})` -> optionally {world, findings, checks, loopLog}; if returned it is written to cache/state.json. If it emits no progress in mock mode, server replays cache/loop_log.json (array or {rounds}) with 700ms delays. Findings read from cache/findings.json or last round of loop_log.
- checks/checks.js: runAll(world), sightline(world, witnessId, targetId, t).
- render/record.js: `renderViews({world, worldUrl, views:[witnessId], t, stillOnly:true, extraWitnesses})` -> any structure containing png/mp4 paths; first png under renders/ becomes renderUrl.
- World loaded in Node via import(file)(THREE); live witnesses are in memory + cache/extra_witnesses.json + GET /api/witnesses (viewer/render should merge these so the new witness camera exists in the browser).
- cache/state.json (if present) overrides the default {world:/worlds/reference_world.js}.
