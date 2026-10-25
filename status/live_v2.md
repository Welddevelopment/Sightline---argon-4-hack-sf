# LIVE v2 (validator + v2 prompt + first live contract-v2 run) — status

## Validator — argon/validate_world.js
`node argon/validate_world.js <world.js> [--case <id>] [--json]` (case inferred from `cases/<id>/...`); lib `validateWorldSource(src,{caseId,advisory})`.
Static scan (no import/require/fetch/eval/Function/globals/DOM/Math.random/Date/async, no hand-made lights) → `node --check` →
isolated child import with the real assets facade (timeout 60 s): required keys, id prefixes, node.name, citation on every
object/witness/fact/skid, "inferred:" labelling, witnesses on ground, lookAt, deterministic setTime over [0,duration] (fwd/back/repeat),
bounds (±2000 m, vehicles y≈0), only catalog methods + vehicle types, lane widths, environment() present + date/time/lat/lon,
plausibilityCheck (checks/physics.js), and NEW:
- **environment()**: an ISO `date` with time+offset (`"2016-05-07T16:36:12-04:00"`) satisfies timeOfDay/utcOffset (lead 13:07); meta.timeOfDay then only warns.
- **approach start**: `cases/<id>/case.json` `worldRules.minApproach: [{role:'car', meters:345, citation, why}]` — the car's FRONT at t=0
  must be ≥ meters from the impact marker (mark_*impact/POI) — same measure as the NTSB validator's crest_to_impact_time.
  Generic: a vehicle moving at impact must not start in front of a crest/hill/curve object on its approach line.
- **advisory mode** (auto for worlds/reference_world.js or a `// FALLBACK:` module; generate_world passes advisory:true for the fallback):
  only fatal errors (does not parse/load/run) fail; everything else becomes "advisory:" warnings, so the fallback always works.
Repair/fallback/logging live in argon/generate_world.js (one repair call, else reference world; attempts+tokens+latency →
`cases/<id>/cache/world_validation.json` + `cache/world_validation_log.jsonl`).

## Prompt — argon/prompts/generate_world_v2.md (+ generate_world_repair.md)
Exact catalog with real dims/orientation; divided-road options (divided, medianWidth, openings) + lane-centre formula; `{{SCENE}}`
(filled by generate_world.js `caseSceneHint`: confirmed_facts → cache/extraction → case.json `scene`) for environment();
"Citing videos" paragraph restored; ≤0.8 g continuous speeds; start at/behind the cited sight restriction; contact geometry
(origins are footprint centres: striking front = centre + L/2 at the POI at impactT); compact code. Confirmed-facts hook untouched.

## Live run (case live2 = live1 evidence/text + case.json with scene + worldRules)
See bottom (filled after run).
