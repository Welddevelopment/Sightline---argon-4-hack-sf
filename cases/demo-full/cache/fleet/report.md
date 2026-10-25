# Fleet verification — demo-full

World `/cases/demo-full/worlds/world_v4.js` (sha 549d69915f59) · 2026-10-25T23:23:42.167Z
Lead: gemini-4-argon · Workers: 23 Managed Agents (antigravity-preview-09-2026, gemini-3.8-flash) · 23 ok
Fleet wall 492 s vs sequential 8135 s (16.5×); Argon plan 17 s, merge 20 s

**Independent sandbox verification Across 23 jobs reproduces all 9 core local sightline, timing, and kinematic checks against world_v4.js (sha 549d69915f59), confirming the physical impossibility of Witness B's testimony while highlighting self-occlusion rendering sensitivities for driving witnesses A and C.**

## Agreements
- full_suite independently reproduced all 9 local check verdicts (4 witness sightlines, 1 vehicle timing check, and 4 vehicle plausibility checks) with 0 code drift.
- sl_wit_b, rob_wit_b, wt_wit_b, ws_wit_b, and r_wit_b reproduce Finding F1 and the local check for Witness B: at t=9.9s (distance 29.88m), Car A is completely blocked by occ_bench_shelter (0/3269 visible pixels), and standard robustness is 25/25 blocked (11 by occ_bench_shelter, 14 by veh_truck_tractor).
- sl_wit_a, rob_wit_a, and wt_wit_a reproduce Witness A's unblocked raycast sightline to Car A at t=4.0s (distance 553.58m, 0/25 standard robustness blocked) and confirm continuous visibility across t=2.0s to t=6.0s (Supporting F2).
- sl_wit_c, rob_wit_c, and gaze_wit_c reproduce Witness C's unblocked raycast sightline to the semitrailer at t=10.43s (distance 34.96m, 0/25 standard robustness blocked, 6.6° off-axis gaze).
- sl_wit_d, rob_wit_d, gaze_wit_d, wt_wit_d, and r_wit_d reproduce Finding F3 and all local metrics for Witness D at t=10.43s: Car A is blocked by bld_retail_store at 30.42m (0/101 visible timeline steps, 0/3866 visible pixels, 23/25 standard robustness blocked, and 2.9° off-axis gaze).

## Disagreements
- gaze_wit_a reports primary offAxisDeg as 1.5° versus the local check's 2.3°; this is a target-reference selection difference rather than code drift, as gaze_wit_a also computes altGazeDegByMark.mark_poi = 2.29° (matching the local 2.3°).
- r_wit_a and r_wit_c return a 'partial' verdict with 0% visible pixels (0/2315 pixels for Witness A blocked 100% by veh_witness_a_pickup; 0/3560 pixels for Witness C blocked 100% by veh_witness_c_pickup), even though raycast checks (sl_wit_a, sl_wit_c) pass as visible=true. This stems from a modelling assumption where raycasts ignore the observer's own vehicle mesh while pixel rendering does not cull the opaque cab geometry surrounding the driver eye.

## Sensitivities
- Witness B's blocked verdict is exceptionally robust: rob_wit_b shows 25/25 blocked across 0.5m, 1m, 2m, and 3m position rings, only opening slightly at 5m (23/25 blocked) and 8m (20/25 blocked). Time sweeps (wt_wit_b, t=7.9s to 11.9s) and Car A speed variations (ws_wit_b, k=0.7 to 1.3) remain 100% blocked by occ_bench_shelter.
- Witness A and C raycast sightlines pass standard robustness (0/25 blocked), but ring perturbations reveal severe proximity sensitivity to their own pickup trucks: rob_wit_a is blocked 22/25 at 0.5m and 15/25 at 1m, while rob_wit_c is blocked 20/25 at 0.5m and 14/25 at 1m, declining as the perturbation radius exceeds the vehicle footprint (down to 3/25 and 1/25 at 8m).
- Witness D's sightline is completely blocked within 0.5m and 1m rings (25/25 blocked in rob_wit_d) and across the entire ±2.0s time window (wt_wit_d, t=8.43s to 12.43s), but opens slightly at 2m (23/25 blocked) to 8m (16/25 blocked) as sample points clear the retail store envelope.
- Driver perception-reaction time (prt_drivers) shows Vehicle A had a continuous line of sight to the semitrailer for 10.43s (from t=0.00s to impact at t=10.43s), though the semitrailer only entered within 3m of Vehicle A's path centerline 1.73s before impact.

## Finding updates
- F1 — strengthened: Confirmed by sl_wit_b, rob_wit_b, wt_wit_b, ws_wit_b, and r_wit_b: Witness B is 100% occluded (25/25 blocked up to a 3m radius, 0 visible pixels) across all ±2s time and ±30% speed sweeps.
- F2 — strengthened: Confirmed by sl_wit_a and wt_wit_a showing unobstructed raycast visibility from t=2.0s to t=6.0s, while r_wit_a, r_wit_c, rob_wit_a, and rob_wit_c expose self-occlusion by the witnesses' own pickup meshes in pixel renders and 0.5m–1m rings.
- F3 — strengthened: Confirmed by sl_wit_d, rob_wit_d, wt_wit_d, and r_wit_d: Witness D has 0/101 visible steps, 0/3866 visible pixels, 25/25 blockage within 1m of the register, and total occlusion across t=8.43s–12.43s.
- F4 — strengthened: Confirmed by full_suite (all timing and plausibility checks pass), r_overhead, and prt_drivers verifying 10.43s of kinematic sightline prior to impact.
- F5 — unchanged: Solar audit and lighting parameters were not separately varied by the verification fleet.

## Fleet vs local (machine comparison)
| job | subject | metric | local | fleet | agree |
|---|---|---|---|---|---|
| full_suite | all | pass/fail match | 9 local | 9/9 same | yes |
| sl_wit_a | wit_witness_A | visible@tObs | true | true | yes |
| rob_wit_a | wit_witness_A | blocked/25 | 0 | 0 | yes |
| gaze_wit_a | wit_witness_A | gazeDeg | 2.3 | 1.5 | NO |
| sl_wit_b | wit_witness_B | visible@tObs | false | false | yes |
| rob_wit_b | wit_witness_B | blocked/25 | 25 | 25 | yes |
| gaze_wit_b | wit_witness_B | gazeDeg | 29.5 | 29.5 | yes |
| sl_wit_c | wit_witness_C | visible@tObs | true | true | yes |
| rob_wit_c | wit_witness_C | blocked/25 | 0 | 0 | yes |
| gaze_wit_c | wit_witness_C | gazeDeg | 6.6 | 6.6 | yes |
| sl_wit_d | wit_witness_D | visible@tObs | false | false | yes |
| rob_wit_d | wit_witness_D | blocked/25 | 23 | 23 | yes |
| gaze_wit_d | wit_witness_D | gazeDeg | 2.9 | 2.9 | yes |
| r_wit_a | wit_witness_A | raycast+pixels | true | true (0% px) | yes |
| r_wit_b | wit_witness_B | raycast+pixels | false | false (0% px) | yes |
| r_wit_c | wit_witness_C | raycast+pixels | true | true (0% px) | yes |
| r_wit_d | wit_witness_D | raycast+pixels | false | false (0% px) | yes |
