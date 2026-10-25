You are the director of a court-grade crash-reconstruction film. You are given:
1. `REFERENCE BREAKDOWN`: a shot-by-shot analysis of professional forensic animations and the shot grammar they share.
2. `SCENE SPEC`: the cited scene graph of OUR crash site (world meters: +X east, -Z north, Y up, ground y = 0).
3. `CURRENT WORLD`: the world module that drives the animation. Its vehicle keyframe tables give the exact position of every vehicle at each scene time t (rows [t, x, z, headingDeg]; heading is compass degrees, 0 = north, 90 = east; positions are footprint centers). Its witnesses give eye positions and observation times.
4. `DIRECTOR NOTES`: the shot list the case team wants.

Write OUR film's shot plan so that it mirrors the reference's shot grammar (order, holds, title cards, pacing, camera heights/FOVs) for OUR case. A separate SHOT-RIG program will execute it literally, so every number must be usable as is.

## Time
- Scene time `t` = the world's event clock (seconds). Film time `s` = seconds from the start of each shot.
- Each shot has `sceneTimeMap`: piecewise-linear [[s, t], ...] covering the whole shot. A hold = two points with different s and the same t. A freeze at contact = the map stops increasing at the contact time. Real-time playback = slope 1.
- Title cards have no scene time (`sceneTimeMap: null`).

## Camera
- `camera.projection`: perspective | orthographic. `fovDeg` is VERTICAL field of view (three.js convention) for 16:9; also give `hfovDeg`. For orthographic give `orthoHeightM` (visible height in meters) instead.
- `camera.keyframes`: [{ "s": film seconds, "position": [x, y, z], "lookAt": [x, y, z], "fovDeg": n, "ease": "linear|in|out|inout" }]. World meters, absolute. For orbits give at least 9 keyframes around the circle (every 45° or less) with the same radius/height. For chase and witness-tracking shots compute the positions from the world keyframe tables at the scene times your sceneTimeMap gives (e.g. for a chase 12 m behind and 3 m above the car, position = car position minus 12 m along its heading); give a keyframe at least every 0.5 s of scene time while vehicles move, plus the contact frame.
- Optional `camera.follow`: { "target": object id, "offsetLocal": [right, up, back] meters, "lookAheadM": n } as a hint; keyframes still required.
- Witness eye shots: camera exactly at the witness position with y = eye height, looking at the object of the claim; no camera motion except a smooth pan that keeps the subject in frame (lookAt keyframes).

## Overlays
`overlays`: [{ "kind": "title_card|lower_third|hud|label|sightline|marker|watermark|scale_bar|north_arrow", "text": "...", "from": s, "to": s, "anchor": "center|top_left|top_right|bottom_left|bottom_right|lower_third|world", "worldPos": [x,y,z] (labels/markers), "style": "..." }].
A `sightline` overlay is a 3D ray: { "kind": "sightline", "fromWitness": "<witness id>" or "fromPos": [x,y,z], "toObject": "<object id>", "colorClear": "#30d158", "colorBlocked": "#ff3b30", "from": s, "to": s }. The rig colors it from a live ray cast, never from your guess.
All on-screen text must be neutral and factual (what the geometry shows, cited), never argument. Mark the film "SIMULATED / FICTIONAL WITNESSES" where the evidence says witnesses are fictional.

## Output
Return ONLY JSON:
{
  "title": "...", "aspect": "16:9", "fps": 30, "totalDurationSec": n,
  "sceneClock": { "t0": "what t = 0 is", "impactT": n, "wallClockAtImpact": "...", "lighting": "..." },
  "shots": [ {
    "id": "S01_title", "n": 1, "type": "<reference grammar type>", "mirrors": ["<videoId>#<n>"], "purpose": "...",
    "durationSec": n, "transitionIn": "cut|dissolve 1.0|fade 0.5", "transitionOut": "...",
    "sceneTimeMap": [[s, t], ...] | null, "holdStartSec": n, "holdEndSec": n, "freezeAtT": n | null,
    "camera": { "projection": "...", "fovDeg": n, "hfovDeg": n, "keyframes": [ ... ], "follow": {...} },
    "overlays": [ ... ], "requires": ["assets or data this shot needs, e.g. aerial imagery"], "optional": false,
    "fallback": "what to do if a requirement is missing", "citations": ["..."] } ],
  "notes": ["..."]
}
