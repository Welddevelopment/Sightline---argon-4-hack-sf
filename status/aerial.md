# AERIAL slice status

A georeferenced aerial photo of the real site sits in the world frame, plus a viewer-agnostic "aerial dissolve" intro that goes from the flat photo to the registered 3D scene (reference video 1, 00:00–00:07).

## Files (owned by this slice)
- `server/aerial.js`: `mountAerial(app, ctx)`, geodesy, planning, fetching and stitching, and a CLI (`probe | plan <id> | fetch <id>`).
- `web/assets/aerial.js`: `loadCaseAerial`, `aerialGround`, `aerialFromMeta`, `hideWorldGround`, `aerialPhotoOverlay`, `aerialDissolve`.
- `cases/demo/exhibits/aerial/aerial.jpg`: 3333x2000 px, 0.30 m/px, NAIP, about 1000x600 m centred on the impact point.
- `cases/demo/exhibits/aerial/bounds.json`: bounds, origin, calibration, the alignment measurements and the credit.
- `server/server.js`: one mount line (next to the other `mount*` calls).

## Sources (probed 2026-10-25 from this workspace)
The first probe got proxy CONNECT 403 for every host. After the user allow-listed the USGS hosts:

| source | host | result |
|---|---|---|
| NAIP ImageServer `exportImage` | imagery.nationalmap.gov | **200**. Used. Best detail, 0.3 m service pixel. |
| USGSImageryOnly MapServer `export` | basemap.nationalmap.gov | **200**. Works but blurrier here. |
| USGSImageryOnly XYZ tiles | basemap.nationalmap.gov | 200 at z16, **404 at z17–z20** (the cache stops at z16 at this site). |
| USDA APFO NAIP / naip-analytic S3 / Planetary Computer | gis.apfo.usda.gov, naip-analytic.s3.amazonaws.com, planetarycomputer.microsoft.com | 403 (not allow-listed, not needed). |

Allow-list needed for a fetch: `imagery.nationalmap.gov`, `basemap.nationalmap.gov`.

Terms:
- USGS The National Map and NAIP (USDA FSA) are public domain. Credit as "USGS The National Map".
- Esri World Imagery, Google and Bing are **not** wired in. Their licences forbid caching or offline use without an agreement.

## Frame and alignment
World frame: metres, Y up, +X east, -Z north. The origin is the initial point of impact, at the centre of the EB outside lane on the NE 140th Ct centreline.

How the photo is placed:
- `boundsMeters` gives the image edges as east/north offsets from `origin`, with north up and north = -Z.
- `calibration` then applies `world = rotY(rotationDeg) * p + (offsetX, 0, offsetZ)`. This is the THREE `rotation.y` sense: counter-clockwise seen from above.

Demo origin, measured on the photo: **29.4105889 N, -82.5397747 W**. The brief's approximate point (29.4106, -82.5393) is 46 m east of it.

Measured with robust line fits:
- Real US-27A bearing is **108.83 deg**, and the WB edge agrees. NE 140th Ct runs about 0.2 deg from due north.
- The world models the highway as due east-west, so `rotationDeg = 18.83`. The residual offset after re-centring is (-0.47, +0.01) m.
- Paved edge to edge measures 41.80 m on the photo against 41.45 m in the model. Paint lines: the fog line is 1.7 m and the lane dashes 5.3 m from the EB outside paved edge.
- Result: the EB and WB carriageways, the lane dashes and the median line up within about 0.3 m along the approach.
- The real side road keeps its true 109 deg skew. The model straightens it to 90 deg (see `coordinate_frame_note`), so in overhead views the photo's side road leaves the model road at about 19 deg south of the shoulder. This is expected and honest. If the world later models the skew, only the side road changes and calibration stays the same.

## HTTP API (mounted by `mountAerial`)
- `GET /api/cases/:id/aerial` returns `{available, url, boundsMeters, calibration, origin, attribution, widthPx, heightPx, metersPerPixel, source}`, or `{available:false, reason, allowlistHosts, howTo}`.
- `GET /api/aerial/probe` returns the curl status of each source host.
- `POST /api/cases/:id/aerial/plan` takes `{lat?,lon?,widthM?,heightM?,resM?}`. It writes `bounds.json` and returns export URLs, so a person can download the image in a browser and save it as `aerial.jpg`.
- `POST /api/cases/:id/aerial/fetch` takes `{lat?,lon?,widthM?,heightM?,resM?,zoom?,source?}`. With `source: auto` it tries NAIP, then the USGS export, then the tiles. A tile fetch is stitched with ImageMagick and cropped to the exact pixel bbox. The stitch was verified pixel-exact on synthetic tiles. A re-fetch keeps the existing calibration.
- `PATCH /api/cases/:id/aerial/calibration` takes `{rotationDeg?, offsetX?, offsetZ?}`.
- The image is served by the existing `/cases` static mount: `/cases/demo/exhibits/aerial/aerial.jpg`.

Supplying an image by hand: drop `cases/<id>/exhibits/aerial.jpg` with either
- `aerial.json` containing `{boundsMeters}` or `{boundsLatLon:{north,south,west,east}, origin:{lat,lon}}`, or
- a world file `aerial.jgw`, plus `aerial.json {"crs":"EPSG:3857"|"EPSG:4326"|"EPSG:269zz"|"EPSG:326zz"}`. UTM grid convergence is folded into `rotationDeg` automatically.

The origin falls back to `case.json` `geo.origin {lat,lon}`, then to the built-in demo default.

## Hooking it into the viewer (for the CONTRACT agent; viewer.js was not edited)
```js
import { loadCaseAerial, aerialFromMeta, hideWorldGround, aerialDissolve } from './assets/aerial.js';
const meta = await loadCaseAerial(caseId);                 // null -> no aerial, skip everything
if (meta) {
  const ground = aerialFromMeta(THREE, meta);              // y = -0.02, MeshBasic (photo-true), not pickable (raycast no-op)
  scene.add(ground);
  // Overhead views: the world's grass groundPlane (y=0) hides the photo, so toggle it:
  let restoreGround = null;
  const setAerial = (on) => { ground.visible = on; if (on) restoreGround ??= hideWorldGround(world.root); else { restoreGround?.(); restoreGround = null; } };
  // Intro: deterministic in t, so it works for live playback AND frame-by-frame recording.
  const intro = aerialDissolve(THREE, { scene, camera, ground, focus: [5, -14], photoSpan: 120, startSpan: 600,
    endPose: { position: [-60, 45, 60], target: [0, 0, -14], fov: 50 } /* optional; omit -> dolly-zoom overhead */,
    underlay: false /* true: keep photo under the road afterwards (pass worldRoot: world.root) */ });
  // render loop:  const s = intro.update(tIntro); renderer.render(scene, camera); if (s.done) intro.dispose();
}
```
- Default phases: hold 1.2 s (flat photo, 8 deg fov straight down, north up) → zoom 2.2 s (startSpan→photoSpan) → dissolve 1.8 s (photo cross-fades into the 3D scene in register) → settle 1.8 s (dolly-zoom to `overheadFov`, or ease to `endPose`). The total is 7.0 s. You can override the timing with `timing:{hold,zoom,dissolve,settle}`.
- `headingDeg` rotates screen-up. Use `-18.83` to show the photo in true north-up rather than model north-up.
- During the intro, `update()` pushes fog near/far up by the camera height and raises `camera.far`. `dispose()` restores both.
- Put the credit "Imagery: USGS The National Map" on screen during the photo phases (`meta.attribution`).
- The photo uses MeshBasicMaterial with `toneMapped:false` and `fog:false`, so it renders photo-true and does not receive 3D shadows. Pass `lit:true` to `aerialGround` if shadows are needed.

## Checks
- Geodesy: round-trip of lat/lon and local metres is exact to 1e-10 m. UTM inverse was spot-checked.
- Stitch/crop: on 91 synthetic z19 tiles (via a `file://` template) the output equals the master crop. Mean diff 3.4 (JPEG) against 6.1 for a 1 px shift.
- Alignment: CPU composite of the calibrated photo with the model's road lines, saved at `/tmp/claude-0/-home-claude/19c8862f-35f6-521f-b076-4851a50cf262/scratchpad/aerialtest/out/cpu_align.png`. EB and WB edges, dashes and median lie on the photo's paint and edges.
- Browser render (world_v2 overhead with the aerial under the road, plus dissolve frames): see below.
