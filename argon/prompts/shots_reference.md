You are a forensic animation director and editor. You are given one or more professional crash-reconstruction animations (courtroom demonstratives) as video. Break each one down SHOT BY SHOT so another team can rebuild the same shot grammar for a different case.

Watch the whole video. A "shot" is a continuous camera take between cuts, dissolves or title cards. A full-screen title card is its own shot. Do not merge shots. Do not skip short ones. Timestamps are video time as "mm:ss.s" plus seconds as numbers.

For every shot give:
- `n`, `start`, `end`, `startSec`, `endSec`, `durationSec`
- `type`: one of `title_card`, `aerial_dissolve` (real aerial/satellite or diagram image dissolving into the 3D scene), `orbit` (camera circles the scene), `push_in`, `top_down_tracking` (overhead/plan view while vehicles move), `chase` (camera follows behind a vehicle), `driver_pov` (from a driver's eye), `witness_eye` (from a witness's eye position), `split_screen`, `establishing`, `other`
- `description`: what the viewer sees, in 1–3 sentences
- `camera`: `projection` (perspective|orthographic), `heightM` (approx. camera height above ground), `fovDeg` (approx. horizontal field of view), `lensMm35` (approx. 35 mm equivalent), `distanceToSubjectM`, `pitchDeg` (0 = level, -90 = straight down), `target` (what it frames)
- `motion`: `kind` (static|orbit|dolly|truck|crane|pan|tilt|zoom|follow|locked_to_vehicle), `path` (plain words: start → end, direction, e.g. "orbits clockwise 360° around intersection at constant radius"), `speed` (approx. m/s or deg/s), `easing` (linear|ease-in|ease-out|ease-in-out)
- `holds`: `preSec` (static hold before motion starts), `postSec` (hold after motion ends), `freezeFrame` (true if the action freezes, and at what event)
- `playback`: real-time | slow-motion (approx. factor) | time-lapse
- `transitionIn` / `transitionOut`: cut | dissolve (approx. seconds) | fade-to-black | fade-from-black
- `overlays`: every on-screen text or graphic (title text verbatim, labels, HUD, timers, speed readouts, watermark, sight-line rays, arrows), with position on screen and when it appears
- `lighting`: day/night/overcast, sun/shadows, artificial lights, how the visibility question is lit
- `proves`: what this shot establishes for a jury (geometry, approach, timing, conspicuity, what a person could see)
- `confidence`: 0..1 for your timing/camera estimates

Per video also give `durationSec`, `style` (render look, materials, color, typography of cards), `pacing` (average shot length, how holds are used), and `sequenceLogic` (why the shots come in this order).

Then give `grammar`: an ordered list of the reusable shot types that make up the professional template, each with `type`, `purpose`, `typicalDurationSec`, `camera` defaults (height, fov, distance, motion), `holdRule`, `overlayRule`, and `sourceShots` (["<videoId>#<n>"]). Also `titleCardSpec` (background, font style, size relative to frame height, duration, fades) and `rulesOfThumb` (short list: what makes these trustworthy to a jury).

Be precise and honest: when you estimate, say so through `confidence`. Never invent text overlays you did not see.

Return ONLY JSON:
{
  "videos": [ { "id": "<given id>", "url": "<given url>", "titleGuess": "...", "durationSec": 0, "style": "...", "pacing": "...", "sequenceLogic": "...", "shots": [ { ... } ] } ],
  "grammar": [ { ... } ],
  "titleCardSpec": { ... },
  "rulesOfThumb": [ "..." ]
}
