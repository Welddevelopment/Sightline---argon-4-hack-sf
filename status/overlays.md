# OVERLAYS + UI-B HUD — status

Owner files: `web/overlays.js`, `web/overlays.css` (+ small HUD/label edits in `web/viewer.js`, `web/ui.js`, `web/style.css`).

## What is on screen
- **Telemetry HUD (top-left, one block)**: `t = 9.90 s`, cited clock (anchored to impact), `IMPACT IN 0.53 s`,
  per-vehicle speed rows (`VEHICLE A 74 mph`, inferred units get an amber dashed tag), signal state, and a sight-line
  **state trigger** for the selected witness (`VEHICLE A NOW HIDDEN FROM WITNESS B · behind Vehicle T semitrailer · since t = 9.1 s`;
  "NOW" for 1 s after a change, from a 0.1 s visibility timeline sampled with `sl.sightline(id, t)`).
  Sits below the argon_only case banner when present (`#stageWrap:has(.ao-stage)`).
- **Sight line**: three.js `Line2` (3.5 px, anti-aliased), eye -> obstruction, red `#ff3b30` blocked / green `#30d158` clear,
  dashed grey obstruction -> target; recomputed every frame from the viewer's raycaster (`sl.sightline`). Chase: depth-tested
  line + faint see-through ghost. Overhead: drawn on top. Witness's own view: reticle on the target.
- **Lower-third card** (`.slo-card.panel.narrative`): `FROM WITNESS B'S POSITION [BLOCKED]`, claim + citation (`(Depo 27:46)`,
  amber dashed tag if the citation says "inferred"), `Blocked from 25 of 25 positions within 2 m of her mark · target 29° off gaze (assumed)`
  (`.finding`), live-ray line, camera FOV note (witness view), and in overhead/chase the stopping-distance sentence.
- **Vehicle tags**: `A · 74 mph` with leader; dashed when occluded from the camera; amber dashed when inferred. The viewer's
  duplicate vehicle sprites are hidden while callouts are on.
- **Full mode only**: stopping-distance / brake-point bars on the road with one-line tags, vehicle gap as a thin dimension
  line with a small label, street/lane labels on the overhead plan.

## Declutter pass (14:20, studio style)
- **Auto mode = Minimal in every view** (overhead included); Full via the toggle / `?callouts=full`.
- **Minimal overhead** shows only: HUD (top-left), vehicle tags (`A · 74 mph`), witness names, the main road name, the
  ACTIVE sight line, lower-third card (witness explanation + stopping / brake-point note). Hidden in minimal: viewer
  object labels (trees, poles, coolers, occluders), amber "inferred" boxes, the all-witness overhead rays (`__sl_rays`).
- **No overlaps**: viewer label sprites and vehicle tags that would overlap an already placed box are dropped, not stacked.
- **Blocker highlight** (viewer.js `applyXray`): the blocking object stays SOLID with a subtle red edge outline on its
  body (parts < 0.6 m radius skipped). The old see-through red wireframe ghost is gone.
- **Overhead framing** (viewer.js `fitOverhead`): witnesses > 70 m and vehicles > 80 m from the impact mark no longer
  widen the plan (demo-full Witness A is 270 m back), so the camera frames the crossover.

## Controls / API
- Toggle (top-right of stage, hidden with `?clean=1`): `Callouts  Off | Minimal | Full`. Default (auto): Minimal everywhere. URL `?callouts=0|1|min|full`. `sl.overlays.set(true|false|'min'|'full'|'off')`,
  `sl.setCallouts(...)`, `sl.overlays.selectWitness(id)`, `sl.overlays.info()`. `#stage.slo-on` while on.
- Viewer's `.sl-eye` panel and `.sl-banner` are hidden by CSS while callouts are on (banner text still in DOM for server/report.js).
- Overlays update inside `scene.onBeforeRender`, so `render/record.js` / `server/clips.js` captures include them.

## Earlier UI-B items (done)
- Witness camera selection jumps to its observation time; `?t=` honoured on load; `?cam=wit_X` without t opens at its observation time.
- Kinematic label strip from API `kinematicLabel`; cited vs inferred dashed amber tags/outlines; "Independent checks: 1 contradiction
  confirmed, N consistent" summary with the contradiction styled as a finding.
- Stray magenta impact disc in witness views: schematic marks (impact / rest / path) show only in the overhead plan.

## Test
`PORT=5193 SIGHTLINE_MODE=mock node server/server.js`, then `/?case=demo&cam=overhead|wit_B|chase_veh_A&t=9.9`.
