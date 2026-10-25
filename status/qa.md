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
