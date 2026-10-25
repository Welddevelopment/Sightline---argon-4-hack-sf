# WORLD slice status — step 2 DONE (real case HWY16FH018)
worlds/reference_world.js = real case: NTSB HWY16FH018, Williston FL, 7 May 2016, 16:36, day. A passenger car (veh_A) going east at 74 mph hits a tractor-semitrailer (veh_T_tractor + veh_T_trailer) turning left across the eastbound lanes onto NE 140th Ct. Witnesses are fictional.
- GENERATED from case/case.json by `node worlds/build_reference_world.mjs`. Re-run it if case.json changes. Motion is linear interpolation of the case.json keyframes. Ground is flat.
- Timeline: duration 22.4 s. Car at the crest at t=0. Impact at t=10.43 at the origin. Car at rest at t≈22. speedAt(veh_A) = 74.0 mph (matches fact f_speed).
- Ids: road_eb road_wb road_crossover road_ne140 occ_crest bld_store occ_shelter(occludes:false, open bench shelter) occ_pole mark_impact mark_rest_A mark_path_A veh_A veh_T_tractor veh_T_trailer
- No sig_ (uncontrolled crossover) and skids:[] (NTSB found no pre-impact marks). CHECKS: runAll emits 3 sightline results and no skid result.
- veh_A has a child `veh_A_cabin` that is hidden at t>=10.43 (roof sheared).
- Witnesses (from case.json, positions given with y=0 and eyeHeight separate):
  - wit_A [357.2,0,-34.75] -> veh_A @2.0: VISIBLE (consistent; blocked by the tractor from 6.5 to 8 s, as she says).
  - wit_B [7.5,0,6.5] -> veh_A @9.9: BLOCKED by veh_T_tractor (28.3 m) = THE CONTRADICTION. She is blocked from t=9.1 to 10.0 by the tractor and from 10.0 to 10.3 by the trailer, which matches case.json expected_contradiction.first_blocked_t=9.1. Clear view before 9.0.
  - wit_C [-18,0,-40.5] -> veh_T_tractor @5.0: VISIBLE (consistent).
- worlds/generic_world.js = the step-1 generic world (4-way, signal, skid, wit_B blocked by occ_shelter). Use it for skid/signal tests.
- worlds/test_world.mjs [file]: contract test. PASSES for both worlds.
- worlds/CONTRACT_EXAMPLE.md: annotated example for the Argon prompt (closed-form + keyframe patterns).
