# WQ-RENDER status (reference review Gap #1: lighting / AO / materials)

`web/render_quality.js` — `applyRenderQuality(renderer, scene, {quality, lighting, sun, roi, world, overlays, ao, env, exposure})`
- Colour: SRGB output + ACESFilmic, exposure per lighting (day 1.0).
- IBL: `scene.environment` = PMREM of the world's sky dome (`env_sky` from web/assets/environment.js, or any `sky*` /
  `userData.envSource` mesh); fallback sky gradient from scene.background; `env:'room'` or failure -> RoomEnvironment.
  `scene.environmentIntensity` 0.6 (day), 0.45 dawn, 0.06 night.
- Fill: viewer's HemisphereLight recoloured to sky 0xddeeff / ground 0x333322 @ 0.6 (day; warm variant at dawn; night keeps
  its own dim hemi). One shadow-casting sun (adopts the world's authored `light_sun` direction/colour and hides the duplicate).
- Shadows: PCFShadowMap + radius (r186 has no PCFSoftShadowMap), 2048 interactive / 4096 render, shadow camera refit each
  frame to ROI + vehicle boxes, texel-snapped (no shimmer), capped at 560 m.
- AO: three's GTAOPass in an HDR EffectComposer (RenderPass -> GTAO -> OutputPass), radius 1.6 m, blend 0.8 day, AO buffers at
  half the drawing-buffer res. `n8ao` is installed but its module imports the pmndrs `postprocessing` package (not in the
  import map), so GTAO (same algorithm family) is used. Overlays (markers, labels, sight rays, highlight / x-ray boxes) are
  drawn after the composer straight to the canvas, depth-tested against the world, untouched by tone mapping/AO.
  Shadow map is rendered once per frame even though the composer draws the scene twice.
- AA: 'interactive' = 4x MSAA composer target, dpr<=2; 'render' = 2x supersampling (pixel ratio 2, box-filtered down).
- Switches: `?rq=off` legacy look; `?ao=0` no AO. No bloom / motion blur / lens effects.
- `handle.render(camera)` — viewer.js `renderFrame()` calls it (one-line edit); falls back to `renderer.render`.

`render/record.js`: `viewUrl()` merges `?case=` style `page` queries (no second `?`); CLI gains `--page`, `--still 1 --t`,
`--quality`; `secPerFrame` reported for clips and stills. `renderViews` API unchanged.

Before/after (reference world, t=9.9): renders/wq_before_clean/{overhead,wit_B}_t9p9.png (`?rq=off`) vs
renders/wq_after/{overhead,wit_B}_t9p9.png.
