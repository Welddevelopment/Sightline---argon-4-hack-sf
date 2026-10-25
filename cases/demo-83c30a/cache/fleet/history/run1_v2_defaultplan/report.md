# Fleet verification — demo-full

World `/cases/demo-full/worlds/world_v2.js` (sha 526ea902d593) · 2026-10-25T21:34:52.131Z
Lead: gemini-4-argon · Workers: 18 Managed Agents (antigravity-preview-09-2026, gemini-3.8-flash) · 18 ok
Fleet wall 649 s vs sequential 7390 s (11.4×); Argon plan 0 s, merge 18 s

**All 18 independent sandbox verification jobs succeeded with zero code drift against world sha 526ea902d593, reproducing 10/10 local geometric and physics checks while surfacing pixel-level rendering nuances for Witnesses A and C.**

## Agreements
- Job full_checks independently reproduced 10/10 local check outcomes: 4 sightline checks (wit_A=true, wit_B=false, wit_C=true, wit_D=false), 2 timing checks (veh_A=true, veh_T_tractor=true), and 4 plausibility checks (veh_A, veh_T_tractor, veh_T_trailer, veh_witA all true), strengthening F5.
- Finding F1 (Witness B): Jobs sl_wit_B and r_wit_B confirmed wit_B's line of sight to veh_A at t=9.8 s (distance 30.22 m) was completely blocked by veh_T_tractor (0/214 target pixels visible; 100% blocked fraction). Jobs rob_wit_B (21/25 blocked) and gz_wit_B (31.5° off-axis) matched local metrics.
- Finding F2 (Witness A): Job sl_wit_A confirmed an unobstructed sightline from wit_A to veh_A at t=4.5 s (distance 466.79 m, visible 93/101 steps), verifying that veh_witA no longer self-occludes. Jobs rob_wit_A (0/25 blocked) and gz_wit_A (2.8° off-axis) exactly matched local checks.
- Finding F3 (Witness D): Jobs sl_wit_D and r_wit_D confirmed wit_D's sightline to veh_A at t=10.43 s (distance 33.25 m) was completely blocked by occ_store_front (0/247 target pixels visible). Jobs rob_wit_D (25/25 blocked) and gz_wit_D (1.2° off-axis) matched local metrics.
- Finding F4 (Witness C): Job sl_wit_C confirmed an unobstructed raycast sightline from wit_C to veh_T_trailer at t=10.43 s (distance 32.53 m, visible 85/101 steps). Jobs rob_wit_C (0/25 blocked) and gz_wit_C (7° off-axis) matched local checks.

## Disagreements
- Job r_wit_C vs. sl_wit_C / F4 (Modelling assumption): While raycast checks (sl_wit_C, local checks) report wit_C's sightline to veh_T_trailer at t=10.43 s as unobstructed (visible=true), the pixel renderer in r_wit_C returned a 'partial' verdict with 0/2,662 target pixels visible because wit_C's own pickup mesh (veh_witC) blocked 100% of the rendered camera view (analogous to the F2 self-occlusion issue previously fixed for veh_witA).
- Job r_wit_A vs. sl_wit_A (Resolution / modelling limit): While raycast check sl_wit_A confirmed visibility at t=4.5 s, render job r_wit_A returned a 'partial' verdict with 0 target pixels and 0 visible pixels because veh_A at a distance of 466.79 m sub-tends less than one pixel at the render resolution.

## Sensitivities
- Witness A (rob_wit_A, gz_wit_A): Highly robust; 0/25 blocked rays across all perturbation rings from 0.5 m to 8 m (0.5m:0/25, 1m:0/25, 2m:0/25, 3m:0/25, 5m:0/25, 8m:0/25). Target veh_A is well within central vision at 2.8° off-axis when looking at mark_poi (2.94° for mark_tire_impression, but 73.06° if looking at mark_pole_poi).
- Witness B (rob_wit_B, gz_wit_B): Moderately position-sensitive at larger radii; standard robustness is 21/25 blocked (11 by veh_T_tractor, 10 by occ_shelter). Within 0.5 m and 1 m rings, sightline is 25/25 (100%) blocked, dropping to 21/25 at 2 m, 19/25 at 3 m, 17/25 at 5 m, and 15/25 at 8 m. Furthermore, at t=9.8 s, veh_A is 31.5° off-axis (peripheral vision, outside the 60° FOV half-angle of 30°) assuming gaze toward mark_poi (28.93° for mark_tire_impression, 164.27° for mark_pole_poi).
- Witness C (rob_wit_C, gz_wit_C): Raycast sightline is completely insensitive to position perturbation, with 0/25 blocked rays across all rings from 0.5 m to 8 m. Gaze is central at 7° off-axis toward mark_poi (7.17° for mark_tire_impression, 46.6° for mark_pole_poi).
- Witness D (rob_wit_D, gz_wit_D): Maximally robust obstruction; 25/25 rays are blocked by occ_store_front across every perturbation ring from 0.5 m up to 8 m. Even though gaze toward mark_poi places veh_A at 1.2° off-axis (1.61° for mark_tire_impression, 131.92° for mark_pole_poi), the storefront completely prevents visibility.

## Finding updates
- F1 — strengthened: Confirmed by sl_wit_B, r_wit_B (0/214 visible pixels, 100% blocked by veh_T_tractor), rob_wit_B (25/25 blocked within 1 m, 21/25 standard), and gz_wit_B (31.5° peripheral off-axis angle).
- F2 — strengthened: Confirmed by sl_wit_A and rob_wit_A (0/25 blocked across 0.5 m to 8 m rings at t=4.5 s), though r_wit_A notes veh_A resolves to 0 pixels at 466.79 m distance.
- F3 — strengthened: Confirmed by sl_wit_D, r_wit_D (0/247 visible pixels, 100% blocked by occ_store_front), and rob_wit_D (25/25 blocked across all rings up to 8 m).
- F4 — strengthened: Raycast and robustness jobs (sl_wit_C, rob_wit_C: 0/25 blocked, gz_wit_C: 7° off-axis) confirm physical consistency, though r_wit_C reveals veh_witC causes 100% pixel self-occlusion (0/2,662 pixels visible) in the rendered view.
- F5 — strengthened: Job full_checks independently verified all 6 timing and physical plausibility checks for veh_A, veh_T_tractor, veh_T_trailer, and veh_witA.
- F6 — unchanged: Environmental and solar calculations were not directly re-tested by specific sandbox metrics beyond standard scene rendering in r_overhead.

## Fleet vs local (machine comparison)
| job | subject | metric | local | fleet | agree |
|---|---|---|---|---|---|
| sl_wit_B | wit_B | visible@tObs | false | false | yes |
| r_wit_B | wit_B | raycast+pixels | false | false (0% px) | yes |
| full_checks | all | pass/fail match | 10 local | 10/10 same | yes |
| sl_wit_A | wit_A | visible@tObs | true | true | yes |
| rob_wit_A | wit_A | blocked/25 | 0 | 0 | yes |
| gz_wit_A | wit_A | gazeDeg | 2.8 | 2.8 | yes |
| rob_wit_B | wit_B | blocked/25 | 21 | 21 | yes |
| gz_wit_B | wit_B | gazeDeg | 31.5 | 31.5 | yes |
| sl_wit_C | wit_C | visible@tObs | true | true | yes |
| rob_wit_C | wit_C | blocked/25 | 0 | 0 | yes |
| gz_wit_C | wit_C | gazeDeg | 7 | 7 | yes |
| sl_wit_D | wit_D | visible@tObs | false | false | yes |
| rob_wit_D | wit_D | blocked/25 | 25 | 25 | yes |
| gz_wit_D | wit_D | gazeDeg | 1.2 | 1.2 | yes |
| r_wit_A | wit_A | raycast+pixels | true | true (0% px) | yes |
| r_wit_C | wit_C | raycast+pixels | true | true (0% px) | yes |
| r_wit_D | wit_D | raycast+pixels | false | false (0% px) | yes |
