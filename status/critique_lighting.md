# CRITIQUE-LIGHTING status (world-gen brief step 5)

Done.
- `argon/prompts/critique.md`: new check D + "Lighting & visibility audit (mandatory)" section (time of day/sun elevation+azimuth,
  shadow bearing, weather/visibility, artificial lights & headlights, sun glare, real footage comparison; must say explicitly
  when no real scene footage exists). Findings get `"type"` (lighting|...) and, for lighting, a `lighting` numbers object;
  new top-level `lightingAudit` summary. New `{{LIGHTING}}` facts block before the world module. "Citing videos" kept.
- `argon/solar.js` (new): `lightingAudit({caseId, world, scene, evidence})` — scene from confirmed_facts > extraction >
  case.json > world.meta (per-field sources); approx. geocode table when lat/lon missing (demo/live1: 29.41,-82.54);
  UTC offset assumed from US zone + US DST when the record has none (flagged). Solar position via
  `web/assets/environment.js` (NOAA). Render sun = world-authored DirectionalLight else viewer preset (mirrors viewer.js).
  Glare: sun up, el < 30 deg, within 15 deg of witness eye->lookAt at observationTime; drivers by travel direction (sampled 0.5 s).
- `argon/critique.js`: computes the audit (loads the world via checks/load_world.js, or accepts `world`/`scene` args),
  fills `{{LIGHTING}}`; result adds `lighting` (computed facts) + `lightingAudit` (Argon's); `call` unchanged.

Demo (2016-05-07 16:36:12 EDT): expected sun az 265.0 (W) / el 45.1, shadows toward 85 deg, sunset 20:12; render sun
(light_sun) az 250.3 / el 48.8 (14.7 deg az error); no glare (min 45 deg).
Tests: `node argon/test_live_stub.js` PASS. LIVE critique on a copy of live1: 190 s total (138.6 s model), Argon wrote
lighting finding F7 (consistent daylight/weather/headlights, no glare, "no real scene footage exists") and patched the
sun to the NOAA position (render was az 255.1/el 54.8).
