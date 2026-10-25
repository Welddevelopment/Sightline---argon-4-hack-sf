# STAGE DEMO FLOW — status

Owner files: `server/demo.js`, `web/demo-flow.js`, `web/demo-flow.css` (one mount line in `server/server.js`, include
lines in `index.html` / `cases.html` / `review.html`).

## What it does
- **Demo case = a normal case in REPLAY mode** (`case.json` `replay:true, replayOf:<source>`). `POST /api/demo/start`
  clones the source case (whatever is on disk at click time; default `demo-full`, fallback `demo`; override with
  `DEMO_SOURCE_CASE` or `server/demo.config.json`) into `demo-<hex>` titled "Demo case — Williston FL crash (pre-loaded)".
  Evidence/keyframes are hard-linked. Step outputs (extraction, state, loop log, validation) are kept back in
  `replay/` and only installed when that step is replayed.
- **Extract** (`POST /extraction/run`): about 3 s replay of the recorded log, ending with `live run: 224 s · 857k tokens · replayed`.
- **Reconstruct** (`POST /run` + `/stream` SSE + job.json): evidence → generate → render → checks → critique → patch,
  2–4 s per step. Prints the real recorded timing per Argon call (`live run: 147 s · 856k tokens · replayed`), then installs
  the recorded state.json.
- **Confirm stays real**: confirm is stored by the normal route. If the reviewer moved a witness on the review screen
  (≥0.5 m vs the extraction), the INDEPENDENT checks re-run locally on a wrapper world (`<world>_confirmed.js` = recorded
  world plus the confirmed witness positions). Example: Witness B moved 6.7 m → `wit_B VISIBLE from the confirmed position (recorded run:
  BLOCKED by veh_T_tractor)`. The Argon findings stay as recorded and are labelled so.
- **New witness (step 6) stays LIVE** (not overridden). Report PDF: the recorded one is served unless witnesses were
  moved; then it is built fresh.
- Every other case is untouched (every override calls `next()` unless the case has `replay:true`).

## UI
- Cases page card: "Demo case — Williston FL crash (pre-loaded) · Replays a cached live run" with a **Start demo** button.
- Step bar on every case page: 1 Upload → 2 Extract → 3 Review & confirm → 4 Reconstruct → 5 Findings →
  6 Test a witness → 7 Export. Replay cases also get a "Replay of live run · <recorded time>" badge and a one-line
  note (the extraction replay log streams into it).

## API
`GET /api/demo/config` · `POST /api/demo/start` → `{caseId, next}` · `GET /api/demo/case/:id` (step-bar info, any case).
Step length: `DEMO_STEP_MS` (default 2800, clamped 2000–4000).

## Test
`PORT=5204 SIGHTLINE_MODE=mock node server/server.js`, open `/cases.html` and click **Start demo**. Headless click-through:
scratchpad `demo_e2e.mjs`.
