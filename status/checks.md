# CHECKS slice status
- DONE: checks/checks.js (sightline, skidSpeed, speedAt, timingCheck, runAll), checks/run_checks.mjs, checks/test_checks.mjs (7/7 pass).
- Usage: `node checks/run_checks.mjs worlds/reference_world.js > cache/checks_reference.json`
- Notes: skid start time = skid.startTime (optional extra field) else peak world speed; skid speed is a minimum (10% tolerance). Raycast uses FrontSide materials, so a witness standing inside an occluder box is not blocked by it. Signals/targets taller than 3 m are aimed at ~0.15 m below top.
- Reference world run done: cache/checks_reference.json (wit_A pass, wit_B FAIL blocked by occ_shelter, wit_C pass, skid veh_A pass 53.7 mph vs min 46.2 mph).
