# PRODUCT-F status — Download scene (step 7)
DONE. server/scene_export.js `mountSceneExport(app, {ROOT, MODE, errMsg})`, one mount line in server/server.js (after report.js).
Endpoints: GET /api/cases/:id/scene.glb?t= | scene.json | scene.zip — docs in SPEC.md "## EXPORTS (12:10)" > "Download scene".
Implementation: Node + three GLTFExporter (FileReader shim, same as render/export_gltf.mjs; no Chromium). World instantiated with checks/load_world.js nodeAssets (v2) or plain THREE (v1).
render/export_gltf.mjs (BLENDER) works but carries no labels/citations/animation, so its conventions (60° cams, lights off, sun dir) were mirrored in-module.
Demo cache: cases/demo/exports/scene.{glb,json,zip} (t=9.9, wit_B / F1). Refresh: `node server/scene_export.js demo`.
Tested PORT=5198 mock: glb/json/zip 200 (cache hit), ?t=3 miss 200, bad t 400, unknown case 404; GLB parsed by GLTFLoader (197 meshes, cam_wit_A/B/C, timeline 22.4 s); live1 also exports (5 witness cams).
