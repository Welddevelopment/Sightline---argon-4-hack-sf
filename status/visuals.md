# Visuals (asset library world-quality pass) — owner: asset library

Captures: `/tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/wq2/` (`r*/` = WebGL via scripts/render_lock.sh,
`*_tq*.png / s*.png` = CPU rasterizer of the baked car meshes, `raster.py` + `dump.mjs`, used to iterate shapes without the lock).

## Changes (2026-10-25 14:00-14:30)
- **Shelter glass / frame** (furniture.js): shared `M.glass` is now clear float glass (near-black albedo, opacity 0.12, env
  reflections) instead of a milky 0xd6e6ea @ 0.2 slab; shelter frame dark anodised aluminium (0x2f3236, metalness 0.45), roof 0x6f7477.
- **Grass** (textures.js): `grass` 1024 px / 3 m tile, lower blade contrast, normal 2; `grass*`/`pasture*` surface materials get an
  anti-tiling shader (rotated 7x resample blended 40% + 50x-scale brightness modulation) -> no visible repeat, no mid-range noise.
- **Sky** (render_quality.js `tuneSky`): optional display scale of the Preetham dome (`LOOK.<lighting>.skyScale`, `?skyk=` A/B);
  applied before the PMREM bake so IBL and the visible sky stay consistent.
- **Passenger cars** (vehicles.js): sedan nose raked (bumper 0.50 m -> hood edge 0.78 m -> cowl 0.95 m, deck 1.01 m), strong plan taper at
  the front corners (no more boxed front face), bigger swept headlamps / grille; SUV/pickup/van front plan taper; SUV lower cladding
  follows a horizontal line (the per-face arch test made a staircase around the wheel openings). Catalog envelopes unchanged
  (4.90x1.90x1.45 etc.), driver eyes unchanged. Argon round-0 sedan (renders/asset_forge/sedan_r0.png) not adopted (lumpy).
- **Trees**: scene.js `treeline` slash pines = straight bare trunk to 0.97 H + open flat-topped crown of 6-10 needle pads on branch
  stubs (InstancedMesh trunks+branches); oaks = short trunk + 6-9 spreading leaf masses with limbs. The opaque smooth "core"
  icosahedra (the green balls in eye.png) are replaced by inner, darker leaf-card clusters in both treeline and furniture `tree()`.
- **Store** (furniture.js `building({kind:'store'})`): 3D storefront — recessed dark glass curtain, aluminium mullion grid
  (1.5 m bays, transom 2.25 m), centred double door, cantilevered 2.1 m canopy (fascia, light soffit, downlights, tie rods). No
  columns, so eye-level sightlines are unchanged. Parking-lot stall lines / wheel stops already in scene.js `parkingLot`.
- New probe page `web/sky_probe.html` (?view=witB|road|sky, ?skyk=, ?exposure=): viewer pipeline (assets.js env + groundPlane +
  render_quality) with shelter/road/sedan/pine for fast lighting checks.

## Checks (Node, after changes)
- worlds/reference_world.js and cases/demo/worlds/world_v2.js: Witness A clear 25/25, Witness B blocked by trailer 25/25 (unchanged).
- cases/demo-full/worlds/world_v3.js: Witness A blocked 25/25 by `veh_witness_a_pickup` — the witness eye is a fixed point that the
  moving pickup drives through (wit_A render = inside the pickup shell). World-authoring issue (eye should ride the pickup's
  driverEye or the pickup should be occludes=false), not an asset change.
