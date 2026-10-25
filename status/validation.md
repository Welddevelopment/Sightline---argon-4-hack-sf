# validation — "is it accurate?"

Compares a generated world with the investigation's measured findings (CREDIBILITY v1 validation contract).

- Facts: `cases/demo/validation_facts.json` (12 facts, copied to `cases/live1/`). Every value is from case/facts.md (NTSB/HAR-17/02, page cited); tolerances are per fact (lane width, half car width, rounding in the report). No invented values.
- Tool: `node argon/validate_world.mjs <caseId> [worldPath] [--out file] [--quiet]` → `cases/<id>/cache/validation.json`
  `{source, caseId, world, matched, total, impact, roles, notes, generatedAt, items:[{id,label,expected,actual,unit,tolerance,pass,citation,objects,delta,note}]}`.
  Default world = highest `world_vN.js`. No facts file → prints "no published findings for this case", exit 0. `export async function validateWorld(caseId, worldPath, {out, write})` (returns null when there are no facts).
  Generic: objects resolved by role (car / tractor / trailer / pole / crest) from ids and labels; ids actually used are recorded per item. Impact = first footprint contact between car and truck (10 ms scan). Source label comes from the citations (or `{source, facts}` object form).
- `how.type` supported: speed, max_decel, time_to_cover, occluder_distance, position, impact_offset, combination_length, meta_time, contact_time, distance, lateral_offset, heading_vs_travel.

## Results (2026-10-25)
| world | matched | failed |
|---|---|---|
| cases/demo world_v2 | 11/12 | crest_to_impact_time: car path begins 343.4 m (10.39 s) before impact, short of the 345 m / 10.4 s crest window → not measurable, counted as fail |
| cases/live1 world_v1 (Argon live) | 10/12 | crest_to_impact_time (path begins 341.4 m / 10.33 s before impact); impact_offset_on_trailer 10.93 m vs 13.84 ±1 m (−2.91 m: car hits the trailer ~3 m too far forward) |
| worlds/reference_world.js | 11/12 | same crest_to_impact_time gap as demo (scratch output only) |

All other facts pass: 74 mph pre-impact, no braking, crest at ~345 m, impact in the right EB lane, combination length 21.8 m, 16:36 clock, pole at ~8.4 s, ~278 m to rest, rest south of the road, perpendicular.
