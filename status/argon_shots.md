# ARGON SHOTS (world plan steps A + B + C) — DONE (live, gemini-4-argon)

Script: `argon/world_plan.mjs` (case-generic; prompts `argon/prompts/{shots_reference,scene_spec,shot_plan}.md`, no case facts).
`node argon/world_plan.mjs --case demo [--step all|A|B|C|stills]` — A and B run in parallel, then C, then stills.
Mock (default) replays `cases/demo/cache/plan_*.json`; live writes them + `.meta.json` (usage) + `.raw.txt`.

## Outputs (cases/demo/plan/)
- `shots_reference.json` — A. ref_esi (Y7Api99fPuw, 133 s): 8 shots (aerial dissolve+orbit 0:00–0:34, top-down 0:34–1:02.5, cards "Night Time View"/"Rear View"/"Witness View", 2 chase shots 2.2 m high / 7.5 m back / 45° freezing at contact, witness eye 1.6 m / 50°). ref_ziva (JlXN-FTQxDE, 50 s): 9 shots (diagram split-screen, top-down sightline ray, driver POV, witness corner, counterfactual split). Plus `grammar`, `titleCardSpec`, `rulesOfThumb`, and **`stillFrames`** (4 picks for side-by-side): ref_esi 00:28.0 -> S03 @18 s, ref_esi 00:46.0 -> S04 @11.5 s, ref_esi 01:36.5 -> S06 @11 s, ref_ziva 00:32.5 -> S08 @7.5 s.
- `scene_spec.json` — B. frame (origin = POI, +X east, -Z north), lighting (sun az 265 / el 45.1, NOAA calc), 10-band `crossSection` (z -38.1 .. +12), `profile` (crest x=-345 m, +7.42 m, 2.15%), 42 `elements` with position/dims/material/MUTCD/occludes/citation, 5 `vehicles` (sedan, tractor, 53 ft reefer, witness A car, witness C pickup; generic, no brands), 3 `witnesses`, `risks`, `openQuestions`. Positions agree with world_v2.js.
- `shot_plan.json` — C. 13 shots, 155 s: S01 title, S02 diagram->3D dissolve (no aerial imagery in evidence; Exhibit 4 fallback), S03 360° orbit r=95 m h=60 m + push-in, S04 top-down tracking, S05 card, S06 chase 12 m back / 3 m up, freeze at t=10.43, S07 card, S08 Witness B eye [7.5,1.6,6.5] + sightline ray, hold 3.5 s at t=9.9, S09–S12 Witness A and C, S13 sources. Each shot: `sceneTimeMap` [[s,t]], camera keyframes (world m, vertical fovDeg), overlays.

## Latency / tokens (live)
| call | s | prompt tok | output tok |
|---|---|---|---|
| A plan_shots_reference (2 YouTube videos) | 148.0 | 20,473 (18,504 video) | 12,723 |
| B plan_scene_spec | 183.7 | 38,609 | 19,429 |
| C plan_shot_plan | 165.8 | 35,193 | 20,609 |
| stills plan_still_frames | 14.7 | 22,312 | 686 |
Wall clock A||B then C: 349.7 s.

## Caveats
- Store is described as a convenience/feed store in the evidence; Argon did NOT add fuel pumps/canopy (not in evidence).
- Many markings/signs cite "standard: MUTCD 2009 §…; inferred placement" (placement is not in evidence).
- Witness B position comes from world_v2.js (her Exhibit 4 mark is only in the deposition video).
- Running mock mode rewrites plan/*.json from cache; `_provenance.mode` then reads "mock" (usage/at still from the live meta).
