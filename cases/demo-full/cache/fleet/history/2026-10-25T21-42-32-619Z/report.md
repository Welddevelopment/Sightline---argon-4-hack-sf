# Fleet verification — demo-full

World `/cases/demo-full/worlds/world_v2.js` (sha 526ea902d593) · 2026-10-25T21:42:32.619Z
Lead: gemini-4-argon · Workers: 22 Managed Agents (antigravity-preview-09-2026, gemini-3.8-flash) · 22 ok
Fleet wall 345 s vs sequential 5204 s (15.1×); Argon plan 16 s, merge 25 s

**All 22 independent verification jobs completed with 0 failures and 100% agreement across all 17 machine-compared metrics against world sha 526ea902d593, confirming the obstruction of Witnesses B and D and the clear sightlines of Witnesses A, C, and both drivers.**

## Agreements
- Job full_suite independently reproduced all 10/10 baseline timing, kinematic plausibility, and sightline checks with zero code drift between local and public repo checks.
- Jobs sl_wit_A, rob_wit_A, gaze_wit_A, and r_wit_A reproduced Witness A's unobstructed view of veh_A at t=4.5s (466.79 m distance, 0/25 robustness samples blocked, 2.8° off-axis gaze, and 2,533/2,533 visible target pixels after cab filtering), confirming F2.
- Jobs sl_wit_B, rob_wit_B, gaze_wit_B, and r_wit_B reproduced the blockage of Witness B's sightline to veh_A by veh_T_tractor at t=9.8s (30.22 m distance, 21/25 robustness samples blocked, 31.5° off-axis gaze, and 0/3,426 visible pixels), confirming F1.
- Jobs sl_wit_C, rob_wit_C, gaze_wit_C, and r_wit_C reproduced Witness C's clear sightline to veh_T_trailer at impact t=10.43s (32.53 m distance, 0/25 robustness samples blocked, 7.0° off-axis gaze, and 4,048/4,092 or 98.9% visible pixels), confirming F4.
- Jobs sl_wit_D, rob_wit_D, gaze_wit_D, and r_wit_D reproduced Witness D's complete obstruction toward veh_A at t=10.43s (33.25 m distance, 25/25 robustness samples blocked, 1.2° off-axis gaze, and 0/4,747 visible pixels), confirming F3.
- Job prt_all independently confirmed F5, showing both drivers (veh_A to veh_T_trailer and veh_T_tractor to veh_A) had a continuous 10.43 s unobstructed line of sight from t=0.00s to t=10.43s, exceeding the 1.0–2.5 s perception-reaction time range.

## Disagreements
- Blocker ID label on Witness D (sl_wit_D vs local checks and r_wit_D): sl_wit_D reports the primary raycast blocker as bld_store at 33.25 m, whereas local checks and r_wit_D report occ_store_front (3,426/3,426 pixels blocked by occ_store_front). Job rob_wit_D shows both co-located meshes block the sightline across the 25-sample grid (22 by bld_store, 3 by occ_store_front), indicating co-planar geometry ordering between the store building and storefront occluder rather than a disagreement on visibility (0/101 steps visible).
- Witness A trailer-occlusion timing (wt_wit_A vs local claim text): Witness A claimed the turning trailer eventually blocked his view of the car, and wt_wit_A tested t=2.5s to 6.5s expecting to capture the cutoff; however, veh_A remained visible across the entire 2.5–6.5s sweep (400.8 m to 532.81 m), with sl_wit_A showing visibility in 93/101 timeline steps (indicating the 8 blocked steps occur after t=6.5s).
- Raw pixel self-occlusion in render jobs (r_wit_A, r_wit_C): r_wit_A and r_wit_C report rawVisibleFraction=0 due to 100% raw pixel blockage by the witnesses' own vehicle meshes (veh_witA and veh_witC), whereas the observer-filtered visibleFraction is 1.0 (100%) and 0.989 (98.9%), respectively—a known modeling artifact documented in F2.

## Sensitivities
- Witness A (rob_wit_A, wt_wit_A, gaze_wit_A): Highly robust; 0/25 samples blocked across all perturbation rings from 0.5 m to 8 m, central gaze at 2.8° off-axis (73.06° if looking at mark_pole_poi), and continuously visible across the entire ±2.0 s time sweep (t=2.5s to 6.5s).
- Witness B position and gaze (rob_wit_B, gaze_wit_B): At t=9.8s, Witness B is completely blocked (25/25) within 0.5 m and 1.0 m perturbation rings; partial visibility only begins at a ≥2 m shift (21/25 blocked at 2 m: 11 by veh_T_tractor, 10 by occ_shelter; 19/25 at 3 m; 17/25 at 5–8 m). Furthermore, veh_A is 31.5° off-axis (peripheral) assuming gaze at mark_poi.
- Witness B time and speed (wt_wit_B, ws_wit_B): Witness B's sightline is clear from t=7.8s to 9.3s, but becomes blocked right before impact at t=9.8s by veh_T_tractor and at t=10.3s–10.8s by occ_shelter (only clearing post-impact at t=11.3s). In speed sweeps (ws_wit_B), the sightline at t=9.8s remains blocked for speed multipliers k=0.7 to 1.1 (17/25 to 25/25 blocked) and only clears the center ray if veh_A approaches at least 20% faster (k=1.2 or 1.3, where 10/25 and 9/25 samples still remain blocked).
- Witness C (rob_wit_C, gaze_wit_C): Highly robust; 0/25 samples blocked across all perturbation rings from 0.5 m to 8 m, with a central gaze angle of 7.0° off-axis (98.9% of trailer pixels visible at impact, with 1.1% occluded by colliding veh_A).
- Witness D (rob_wit_D, sl_wit_D, gaze_wit_D): Completely invariant to perturbation; 25/25 samples are blocked across every ring from 0.5 m to 8 m and 0/101 timeline steps are visible, despite a direct 1.2° gaze alignment toward the impact point.

## Finding updates
- F1 — strengthened: Confirmed by sl_wit_B, r_wit_B (0/3,426 visible pixels), rob_wit_B (25/25 blocked within 1 m, 21/25 at 2 m), wt_wit_B (blocked from t=9.8s through impact at 10.43s by tractor and shelter), and ws_wit_B (blocked unless veh_A speed increases by ≥20%).
- F2 — strengthened: Confirmed by r_wit_A, which explicitly captures the rawBlockers veh_witA fraction=1.0 self-occlusion vs 100% (2,533/2,533 px) clear visibility once the cab mesh is excluded, alongside sl_wit_A and rob_wit_A (0/25 blocked across 0.5–8 m).
- F3 — strengthened: Confirmed by sl_wit_D (0/101 timeline steps visible), r_wit_D (0/4,747 visible pixels, 100% blocked by occ_store_front), and rob_wit_D (25/25 blocked across all rings up to 8 m by bld_store and occ_store_front).
- F4 — strengthened: Confirmed by sl_wit_C (visible at t=10.43s at 32.53 m), rob_wit_C (0/25 blocked across 0.5–8 m rings), gaze_wit_C (7.0° off-axis), and r_wit_C (4,048/4,092 pixels or 98.9% visible).
- F5 — strengthened: Confirmed by full_suite (all timing and plausibility checks pass) and prt_all (10.43 s continuous unobstructed sightline for both veh_A and veh_T_tractor drivers from t=0.00s to impact).
- F6 — unchanged: No sandbox jobs directly tested solar angles or weather documentation, though scene renders (r_overhead, r_wit_A..D) executed cleanly against the world file.

## Fleet vs local (machine comparison)
| job | subject | metric | local | fleet | agree |
|---|---|---|---|---|---|
| full_suite | all | pass/fail match | 10 local | 10/10 same | yes |
| sl_wit_A | wit_A | visible@tObs | true | true | yes |
| rob_wit_A | wit_A | blocked/25 | 0 | 0 | yes |
| gaze_wit_A | wit_A | gazeDeg | 2.8 | 2.8 | yes |
| sl_wit_B | wit_B | visible@tObs | false | false | yes |
| rob_wit_B | wit_B | blocked/25 | 21 | 21 | yes |
| gaze_wit_B | wit_B | gazeDeg | 31.5 | 31.5 | yes |
| sl_wit_C | wit_C | visible@tObs | true | true | yes |
| rob_wit_C | wit_C | blocked/25 | 0 | 0 | yes |
| gaze_wit_C | wit_C | gazeDeg | 7 | 7 | yes |
| sl_wit_D | wit_D | visible@tObs | false | false | yes |
| rob_wit_D | wit_D | blocked/25 | 25 | 25 | yes |
| gaze_wit_D | wit_D | gazeDeg | 1.2 | 1.2 | yes |
| r_wit_A | wit_A | raycast+pixels | true | true (100% px) | yes |
| r_wit_B | wit_B | raycast+pixels | false | false (0% px) | yes |
| r_wit_C | wit_C | raycast+pixels | true | true (99% px) | yes |
| r_wit_D | wit_D | raycast+pixels | false | false (0% px) | yes |
