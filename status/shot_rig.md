# SHOT RIG (plan step E): status

Owner files: `render/film.mjs`, `web/film.html`, `web/film.js`, `cases/<id>/exports/film/*`. viewer.js and record.js are not edited.

## Run
```
scripts/render_lock.sh node render/film.mjs --case demo                         # draft film, 960x540 @ 12 fps
scripts/render_lock.sh node render/film.mjs --case demo --w 1280 --h 720        # final
scripts/render_lock.sh node render/film.mjs --case demo --keys-only             # one PNG per shot (fast iteration)
scripts/render_lock.sh node render/film.mjs --case demo --shots S06_chase_veh_A # subset -> film_partial.mp4
scripts/render_lock.sh node render/film.mjs --case demo --w 1280 --h 720 --stills   # plan/shots_reference.json stillFrames -> exports/film/stills/
  other flags: --plan <file>|default  --fps N (default min(15, plan.fps))  --quality interactive|render  --keep-frames
```
Output: `exports/film/film.mp4` (H.264 veryfast, crf 21), `key_NN_<shot>.png` per shot, `film.json` (timeline, timings, warnings), `stills/*.png` + `stills.json`.
Preview in a browser: `/film.html?world=/cases/demo/worlds/world_v2.js&plan=/cases/demo/plan/shot_plan.json&play=1`.

## How it works
- `web/film.html` loads `film.js`, which `import`s `viewer.js` (same world loading, lighting, render_quality, assets) and `overlays.js` (live clock, impact countdown, speeds, sight line).
  It takes the viewer's renderer from `scene.onBeforeRender`, mutes the viewer's own renders, and draws `sl.world.root.parent` with a film camera (perspective or orthographic).
- The viewer's camera *mode* is still set per shot (`overhead`, `chase_<veh>`, or a witness id). That gives the witness views their x-ray and LINE OF SIGHT banner, and gives overlays.js the right layout.
- Deterministic: `film.frame(i)` sets the scene time from the shot's time map and the camera from its keyframes. A frame that is identical to the previous one (holds, title cards) is not rendered again; its JPEG is copied.
- Assembly: one image sequence per shot goes into an ffmpeg graph. `dissolve` becomes an xfade overlap, and `fade` becomes a fade through black.

## Plan input (`cases/<id>/plan/shot_plan.json`)
ARGON-SHOTS keyframed form (used as is):
- `shots[]: {id, type, durationSec, transitionIn/Out: "fade 0.5"|"dissolve 1.0"|"cut", sceneTimeMap: [[shotSec, sceneT],...] (piecewise linear; null = title), freezeAtT,
  camera: {projection, fovDeg, orthoHeightM, follow?, keyframes: [{s, position, lookAt, fovDeg, ease: linear|in|out|inout}]}, overlays: [...]}`.
  - Camera position is a Catmull-Rom curve through the keyframes, with each segment eased by its start key's `ease`. lookAt and FOV are interpolated linearly.
  - A `top_down_tracking` camera within 10° of vertical renders orthographic, so the scale bar and plan overlays measure true.
  - A witness view is detected when the camera sits at a witness eye (within 1.5 m), or from a `sightline` overlay.
- Overlay kinds: `title_card` (black card; first line is the title, `• ` lines become a list), `lower_third` (text before " — " is the heading; a red `background` style gives the alert style), `hud` (top-left; ` | ` separates lines), `label`/`marker` (with `worldPos`; projected each frame, with a leader to the ground), `north_arrow`, `scale_bar` (metres measured at the view target), `watermark`, `sightline` (`fromWitness` selects the witness for the viewer and overlays.js rays). `from`/`to` are shot seconds.
- `aerial_dissolve`: the photo is registered to the ground with a projective (matrix3d) map of its 4 world corners. `bounds.json` provides `boundsMeters` and `calibration` {rotationDeg, offsetX, offsetZ}. The photo is shown for `holdStartSec`, then dissolves over `dissolveSec` (default ≤ 2 s). It carries the credit "Aerial: USGS The National Map (NAIP)". If there is no aerial, the rig falls back to `evidence/map.png`, letterboxed.
- Playback state is always on screen (top right): REAL TIME 1.0×, TIME HELD · t, FREEZE · t, or N× SLOW MOTION.

Simple typed form (the built-in default when there is no plan; it is derived from the world, so it works for any case):
`{type: title|orbit|topdown|chase|pov|aerial|keyframes, sceneTime:[t0,t1] | t, holdStart=3, holdEnd=3, duration, ...}`
- `orbit`: {target, radius, height, startDeg, sweepDeg}; constant angular speed.
- `topdown`: {frame:[ids], margin, minHalf} or {follow|center, halfHeight}.
- `chase`: {vehicle, offset:[behind, up, right], lookAhead, freezeAt}.
- `pov`: {witness | position, lookAt, panTo, track}.
- `aerial`: {t, zoomFrom}.
- `overlay`: {title, caption}.

## Results
(see bottom; updated after each render)
