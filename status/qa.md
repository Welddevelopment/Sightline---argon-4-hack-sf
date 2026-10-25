# QA status (regression watch)

Owner: QA agent. Runs every ~8 min for 90 min: unit tests (checks, physics, world contract x2, live stub), mock server API (/api/health, /api/cases, /api/cases/demo: findings, deposition durationSec~1801.8, Witness B contradiction), headless Chromium stills (cases page, demo overhead t=9.9, demo wit_B t=9.9) + console errors. Artifacts under /tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/qa/runs/<ts>/.

### QA run 20261025T190708Z — VOID (port 5191 was answered by another agent's LIVE server pid 15932; QA now uses its own free port 539x)
- **PASS** test_checks — 19 tests passed
- **PASS** test_physics — 16 tests passed
- **PASS** world_reference — ALL CONTRACT ASSERTIONS PASSED (reference_world.js: 14 objects, 3 witnesses)
- **PASS** world_demo_v2 — ALL CONTRACT ASSERTIONS PASSED (world_v2.js: 14 objects, 3 witnesses)
- **PASS** live_stub — LIVE-STUB: PASS
- **PASS** server_boot — pid 17096
- **PASS** api: health — 200 {"ok":true,"mode":"live"}
- **PASS** api: cases — 200 n=2
- **PASS** api: demo json — 200
- **PASS** api: demo findings — n=5 verdict=contradiction_found world=/cases/demo/worlds/world_v2.js
- **PASS** api: deposition durationSec~1801.8 — durationSec=1801.8
- **PASS** api: Witness B contradiction — finding=F1 check.pass=false
- **PASS** shot: cases — /tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/qa/runs/20261025T190708Z/cases.png
- **PASS** shot: cases_demo — /tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/qa/runs/20261025T190708Z/cases_demo.png
- **PASS** shot: demo_overhead_t9.9 — /tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/qa/runs/20261025T190708Z/demo_overhead_t9.9.png {"cam":"overhead","t":9.9,"world":"/cases/demo/worlds/world_v2.js","witB":{"visible":false,"blockedBy":"veh_T_tractor"}}
- **PASS** shot: demo_witB_t9.9 — /tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/qa/runs/20261025T190708Z/demo_witB_t9.9.png {"cam":"wit_B","t":9.9,"world":"/cases/demo/worlds/world_v2.js","witB":{"visible":false,"blockedBy":"veh_T_tractor"}}

### QA run 20261025T190824Z — ALL PASS
- **PASS** test_checks — 19 tests passed
- **PASS** test_physics — 19 tests passed
- **PASS** world_reference — ALL CONTRACT ASSERTIONS PASSED (reference_world.js: 14 objects, 3 witnesses)
- **PASS** world_demo_v2 — ALL CONTRACT ASSERTIONS PASSED (world_v2.js: 14 objects, 3 witnesses)
- **PASS** live_stub — LIVE-STUB: PASS
- **PASS** server_boot — pid 18795 port 5391 mode=mock
- **PASS** api: health — 200 {"ok":true,"mode":"mock"}
- **PASS** api: cases — 200 n=2
- **PASS** api: demo json — 200
- **PASS** api: demo findings — n=5 verdict=contradiction_found world=/cases/demo/worlds/world_v2.js
- **PASS** api: deposition durationSec~1801.8 — durationSec=1801.8
- **PASS** api: Witness B contradiction — finding=F1 check.pass=false
- **PASS** shot: cases — /tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/qa/runs/20261025T190824Z/cases.png
- **PASS** shot: cases_demo — /tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/qa/runs/20261025T190824Z/cases_demo.png
- **PASS** shot: demo_overhead_t9.9 — /tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/qa/runs/20261025T190824Z/demo_overhead_t9.9.png {"cam":"overhead","t":9.9,"world":"/cases/demo/worlds/world_v2.js","witB":{"visible":false,"blockedBy":"veh_T_tractor"}}
- **PASS** shot: demo_witB_t9.9 — /tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/qa/runs/20261025T190824Z/demo_witB_t9.9.png {"cam":"wit_B","t":9.9,"world":"/cases/demo/worlds/world_v2.js","witB":{"visible":false,"blockedBy":"veh_T_tractor"}}
- note (visual, not a failure): in both viewer stills the 'Kinematic reconstruction: motion fitted to cited evidence…' label overlaps the bottom HUD strip ('SIMULATED / FICTIONAL…' text is cut off). Watch start 19:07Z, end ~20:37Z.

### QA run 20261025T191643Z — 2 FAIL
- **PASS** test_checks — 19 tests passed
- **PASS** test_physics — 19 tests passed
- **PASS** world_reference — ALL CONTRACT ASSERTIONS PASSED (reference_world.js: 14 objects, 3 witnesses)
- **PASS** world_demo_v2 — ALL CONTRACT ASSERTIONS PASSED (world_v2.js: 14 objects, 3 witnesses)
- **PASS** live_stub — LIVE-STUB: PASS
- **PASS** server_boot — pid 27528 port 5391 mode=mock
- **PASS** api: health — 200 {"ok":true,"mode":"mock"}
- **PASS** api: cases — 200 n=2
- **PASS** api: demo json — 200
- **PASS** api: demo findings — n=5 verdict=contradiction_found world=/cases/demo/worlds/world_v2.js
- **PASS** api: deposition durationSec~1801.8 — durationSec=1801.8
- **PASS** api: Witness B contradiction — finding=F1 check.pass=false
- **PASS** shot: cases — /tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/qa/runs/20261025T191643Z/cases.png
- **PASS** shot: cases_demo — /tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/qa/runs/20261025T191643Z/cases_demo.png
- **FAIL** shot: demo_overhead_t9.9 —  {"cam":"overhead","t":9.9,"world":"/cases/demo/worlds/world_v2.js","witB":{"visible":false,"blockedBy":"veh_T_tractor"}} ERR page.screenshot: Timeout 30000ms exceeded. [console: Failed to load resource: the server responded with a status of 404 (Not Found)] http>=400: 404 /assets/scene.js
- **FAIL** shot: demo_witB_t9.9 —  ERR page.waitForFunction: Timeout 30000ms exceeded.
- NEWLY BROKEN: shot: demo_overhead_t9.9 shot: demo_witB_t9.9
  - files modified since last all-green run (19:08:58Z): ./blender/render_still.py ./blender/out/render_log.txt ./server/clips.js ./server/review.js ./server/report.js ./server/jobs.js ./server/cases.js ./server/scene_export.js ./server/server.js ./cases/live1/cache/new_witness_8dbed99bdd177849.meta.json ./cases/live1/cache/extraction.json ./cases/live1/cache/extraction_raw.json ./cases/live1/cache/new_witness_ece46586511f9fd1.meta.json ./cases/live1/cache/new_witness_8dbed99bdd177849.raw.txt ./cases/live1/cache/state.json ./cases/live1/cache/new_witness_63edd7a5e67738d1.raw.txt ./cases/live1/cache/new_witness_replay.json ./cases/live1/cache/new_witness_865d7236e960cf40.raw.txt ./cases/live1/cache/extraction_raw.meta.json ./cases/live1/cache/extra_witnesses.json ./cases/live1/cache/new_witness_ece46586511f9fd1.raw.txt ./cases/live1/cache/new_witness_865d7236e960cf40.meta.json ./cases/live1/cache/extraction_raw.raw.txt ./cases/live1/cache/new_witness_63edd7a5e67738d1.meta.json ./cases/live1/cache/extraction.meta.json 
  - git status --short:  M argon/critique.js; M argon/generate_world.js; M argon/prompts/critique.md; M argon/world_io.js; M cases/demo/cache/generate_world.js; M cases/demo/cache/new_witness_replay.json; M cases/live1/cache/extra_witnesses.json; M cases/live1/cache/new_witness_ece46586511f9fd1.meta.json; M cases/live1/cache/new_witness_ece46586511f9fd1.raw.txt; M cases/live1/cache/new_witness_replay.json; M checks/run_checks.mjs; D renders/env/env_v1.png; D renders/env/env_v2.png; D renders/env/env_v3.png; D renders/env/env_v4.png; D renders/env/env_v5.png; M server/cases.js; M server/server.js; M status/qa.md; M web/assets.js; M web/assets/vehicles_heavy.js; M web/render_quality.js; M web/small_preview.html; M web/viewer.js; M worlds/build_reference_world.mjs; M worlds/reference_world.js; M worlds/test_world.mjs;?? argon/prompts/baseline_fair.md;?? argon/solar.js;?? cache/world_validation_log.jsonl;?? cases/demo-full/;?? cases/demo/cache/extra_witnesses.json;?? cases/demo/cache/new_witness_865d7236e960cf40.meta.json;?? cases/demo/cache/new_witness_865d7236e960cf40.raw.txt;?? checks/glare.js;?? checks/test_glare.mjs;?? renders/env/env_preview_case.png;?? status/scene_env.md;?? v1_overview.png;?? web/_rq_probe.html;
- triage 19:20Z: both viewer-still failures look transient. web/assets/scene.js (loaded by name from web/assets.js MODULE_NAMES) did not exist until 19:19Z, which gave the 404, and load avg was 27 on 2 CPUs, which caused the screenshot/ready timeouts. QA timeouts raised to 60s. Will re-check next run.

### QA run 20261025T192734Z — 1 FAIL
- **PASS** test_checks — 19 tests passed
- **PASS** test_physics — 19 tests passed
- **PASS** world_reference — ALL CONTRACT ASSERTIONS PASSED (reference_world.js: 18 objects, 3 witnesses)
- **PASS** world_demo_v2 — ALL CONTRACT ASSERTIONS PASSED (world_v2.js: 18 objects, 3 witnesses)
- **PASS** live_stub — LIVE-STUB: PASS
- **PASS** server_boot — pid 4029 port 5391 mode=mock
- **PASS** api: health — 200 {"ok":true,"mode":"mock"}
- **PASS** api: cases — 200 n=3
- **PASS** api: demo json — 200
- **PASS** api: demo findings — n=5 verdict=contradiction_found world=/cases/demo/worlds/world_v2.js
- **PASS** api: deposition durationSec~1801.8 — durationSec=1801.8
- **PASS** api: Witness B contradiction — finding=F1 check.pass=false
- **FAIL** shot: shots — no result: node:internal/modules/run_main:123 triggerUncaughtException( ^ browserContext.newPage: Target page, context or browser has been closed at /tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/qa/shots.mjs:34:26 { log: [] } Node.js v22.23.4 
- NEWLY BROKEN: shot: shots
  - files modified since last all-green run (19:08:58Z): ./blender/render_still.py ./blender/out/render_log.txt ./server/clips.js ./server/review.js ./server/report.js ./server/jobs.js ./server/whatif.js ./server/case_size.js ./server/cases.js ./server/scene_export.js ./server/server.js ./cases/live1/cache/new_witness_8dbed99bdd177849.meta.json ./cases/live1/cache/extraction.json ./cases/live1/cache/extraction_raw.json ./cases/live1/cache/new_witness_ece46586511f9fd1.meta.json ./cases/live1/cache/new_witness_8dbed99bdd177849.raw.txt ./cases/live1/cache/state.json ./cases/live1/cache/new_witness_63edd7a5e67738d1.raw.txt ./cases/live1/cache/new_witness_replay.json ./cases/live1/cache/new_witness_865d7236e960cf40.raw.txt ./cases/live1/cache/new_witness_865d7236e960cf40_retry.meta.json ./cases/live1/cache/extraction_raw.meta.json ./cases/live1/cache/new_witness_ece46586511f9fd1.raw.txt ./cases/live1/cache/new_witness_865d7236e960cf40_retry.raw.txt ./cases/live1/cache/new_witness_865d7236e960cf40.meta.json 
  - git status --short:  M server/whatif.js; M status/qa.md; M web/assets/vehicles.js; M web/compare.js; M web/heavy_preview.html;
