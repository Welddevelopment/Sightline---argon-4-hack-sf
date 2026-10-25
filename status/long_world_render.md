# long_world_render: single-response world (world_long.js) vs current world_v2.js

Sheet: renders/long_world/compare_sheet.png (left = world_long.js, right = world_v2.js; 5 rows, t = 9.9 s, 1280x720 sources)

## What was rendered and how
- Pipeline: the real viewer (web/viewer.js, quality=render, clean=1) through `render/record.js renderViews` stillOnly,
  driven by `renders/long_world/render_compare.mjs` (oblique = an injected elevated pseudo-witness at [55, 32 m, 58] looking
  at [-6, 0, -12], FOV 60). Run under `scripts/render_lock.sh`.
- The lock was busy for ~25 min. At 14:15 the lead asked me to stop taking it, so I killed my job mid-run.
- world_long.js stills (`renders/long_world/long/`): overhead, oblique, chase_veh_A, wit_B. **wit_A was not rendered.**
- world_v2.js stills (`renders/long_world/v2/`): **copied, not rendered by me.** They come from the judge capture
  (scratchpad judge/r2, 13:43-14:01, `/?case=demo&clean=1&quality=render&t=9.9`, worldUrl /cases/demo/worlds/world_v2.js,
  so it is the current file): overhead, chase_veh_A, wit_A. **The oblique and wit_B views were not rendered.** The only
  world_v2 wit_B still that exists is from 11:35 and an old UI, so it was left out.
- The missing cells are marked NOT RENDERED on the sheet. Rebuild the sheet with `python3 renders/long_world/compare_sheet.py`.
- The world_long.js file loads and runs in the viewer as a v1 world with no errors. Its motion matches v2 on every HUD
  readout (A 75 mph, T 13 mph, impact in 0.53 s, wit_B blocked with A 28.4 m away), as expected because it copies v2's
  witnesses, facts and timing.

## Verdict, view by view
- **Overhead: v2 is much more credible.** v2 shows real aerial imagery (buildings, lots, tree cover) under the roads.
  world_long.js shows flat procedural bands: the median has a striped/noise texture, a white strip and black shadow boxes
  sit at the crossover, and the lane labels pile into one cluttered stack.
- **Chase veh_A: v2 is a little more credible.** v2 has a cloudy sky, a dense natural tree line, and correct edge and
  lane lines. Its defects: the retail store is an untextured white box, and the road and grass look pale and washed out.
  world_long.js has the more readable store (facade, windows, awning) and utility wires. Its defects: cartoon
  lollipop trees, a flat sky, and a dark floating slab at the lower right.
- **Oblique (world_long.js only): a coherent diorama.** The crossover, store, tractor-trailer, poles, fences and a
  stopped pickup are all placed sensibly. Its defects: lollipop trees, the grass plane ends in hard bands near the
  horizon, a mast pokes through the store roof, and there is no ground imagery.
- **Witness B eye (world_long.js only): a strong, legible image.** The tractor-trailer fills the view about 6.7 m
  away, the stop sign is in the foreground, and veh_A shows highlighted behind the trailer. Its defects: the tractor
  sleeper and fairing are boxy and flat-shaded, faint orange vertical debug/occluder lines cross the frame, and the
  foreground ground texture is noisy.
- **Witness A eye (v2 only): believable.** It shows a long empty highway with A and T tiny at 379 m. Its defects:
  heavy haze, and the grass texture is streaky.

## Bottom line
In the close views, the world one response wrote reads about as well as v2. It looks hand-built and stylized (stronger
store and truck silhouettes), but less real (lollipop trees, flat sky, no ground imagery). v2 wins clearly on overhead
and environment realism. Its biggest defect is the blank white box standing in for the store.
