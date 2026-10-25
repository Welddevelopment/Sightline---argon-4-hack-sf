# TREES status (web/assets/trees.js, web/trees_preview.html)

Owner: trees agent. Replaces the blobby sphere-cluster / lollipop trees.

## API (CONTRACT)
```js
import * as TR from './assets/trees.js';            // pure module, THREE passed in, Node-safe (no DOM -> flat colours, same geometry)
TR.tree(THREE, { kind: 'pine'|'oak'|'live_oak'|'laurel_oak'|'palmetto'|'shrub', height, seed, id, moss })
  // -> Group (userData.assetType 'tree', dims {length,width,height}, kind); children 'wood' + 'leaves' (+ 'moss')
TR.forestBand(THREE, {
  polyline: [[x,z],...], side: 'left'|'right',      // forest EDGE line; forest lies on that side (left of west->east = north)
  centered: false,                                   // true: belt of width `depth` centred on the polyline (scene.treeline)
  polygon: [[x,z],...],                              // alternative: closed area, all boundary = edge
  depth: 70, density: 2.2,                           // canopy stems per 100 m^2
  mix: { pine: .75, oak: .25, laurel_oak: 0, palmetto: 5, shrub: 1.2 },   // canopy fractions | understory per 100 m^2 at edge
  heightScale: 1, seed: 1, terrainHeight: (x,z)=>y, exclude: (x,z)=>bool,
  lodDistance: 150, understoryCull: 350, interiorUnderstory: 0.4, maxInstances: 15000, floor: false })
  // -> Group (assetType 'forest', userData {count, counts, update(camera), lodDistance})
```
- Delegation: `furniture.tree(opts)` -> `TR.tree(THREE, opts)` for every kind except 'palm' (or `legacy:true`);
  `scene.treeline(opts)` -> `TR.forestBand({polyline: points, centered: true, ...})` (spacing -> density, pineRatio -> mix,
  height/13 -> heightScale, understory -> palmetto density; `legacy:true` keeps the old belt).
- Leaves meshes carry `userData.porous = true` (alpha cards: opaque to ray casts in Node) — checks may want to skip them.
- Impostors and the LOD driver never ray-cast and are `userData.noShadow`.

## How it works
- Species templates (4 variants each, cached, shared by every band): tapered parallel-transport bark tubes + alpha-tested
  cards (canvas-drawn needle brushes / leaf clumps / palmetto fans) with crown-volume normals and baked AO in vertex colour.
- Textures are DataTextures with hand-built mips: alpha-weighted colour + coverage-preserving alpha per level, so sparse
  pine crowns keep their density at distance under alphaTest 0.5.
- forestBand: jittered-grid placement behind a ragged edge (noise ±6 m); oaks favoured within ~12 m of the edge, young
  pines at the edge, saw palmetto everywhere (dense at edge, spills 2 m onto grass), wax myrtle at the edge.
  One InstancedMesh per species x variant x {trunks, leaves, side impostor, crown card}; per-instance tint, lean, xz stretch.
- LOD: invisible driver mesh re-partitions instances in onBeforeRender when the camera moved > 4 m: full trees inside
  lodDistance (dithered ±10 %), billboards (rasterised from the same template) beyond, flat crown cards when the camera
  is > 45° above (overhead view); understory LOD at 0.6 x lodDistance, culled beyond understoryCull.
