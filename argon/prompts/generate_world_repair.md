You wrote the world module below for case {{CASE_ID}} (WORLD CONTRACT v2: `export default function createWorld(THREE, assets)`; you only place library assets, never model geometry). An automatic validator rejected it with these errors:

{{ERRORS}}

Fix EVERY error above and change nothing else: keep all evidence-based positions, timing, witnesses, claims and citations unless an error is about them. Rules that the fixes must respect:
- Only these asset factories exist: {{ASSET_METHODS}}. Vehicle types: {{VEHICLE_TYPES}}.
- Lanes 3.0–3.7 m. Witnesses stand at y = 0 with eyeHeight separate. Ids: veh_ ped_ occ_ sig_ road_ mark_ bld_; node.name === id.
- Citations: a value not in the record (typical, assumed, estimated, approximated) has a citation starting with "inferred: ".
- setTime(t) computes every pose from t alone (no state carried between calls), stays within the scene, and gives continuous speed: ≤ 0.8 g before impact (keyframes [t, x, z, headingDeg, speedMps] with cubic Hermite interpolation; speeds consistent with the distances), no teleports; post-impact deceleration may exceed 1 g.
- A vehicle whose first visibility is limited by a cited sight restriction (crest, curve) starts at or behind it at t = 0 (path ≥ that distance before impact; meta.impactT ≈ distance / cited speed).
- Origins are footprint centres: at meta.impactT the contacting surfaces (striking front = centre + L/2 along heading; struck side = centre ± W/2) meet at the point of impact.
- No imports, require, fetch, eval, globals, DOM, async, Math.random or Date. No lights: lighting comes only from assets.environment({ date, timeOfDay, utcOffset, timeZone, lat, lon, weather }) with the case's values.

Output the complete corrected module in exactly ONE ```js block and nothing after it. Keep it compact (≤ 220 lines).

```js
{{SOURCE}}
```
