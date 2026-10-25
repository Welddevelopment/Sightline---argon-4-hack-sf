# SCENE ENV status (environment / sun / sky / glare) — DONE, ready to integrate

Files: web/assets/environment.js, checks/glare.js, checks/test_glare.mjs (12/12 pass: `node checks/test_glare.mjs`), web/env_preview.html.
Previews: renders/env/env_preview_case.png (06:45/12:00/16:36/19:45), renders/env/env_dusk.png (20:00/20:25/20:45/21:30), renders/env/env_weather.png (16:36 clear/overcast/rain/fog).

## Demo case values (2016-05-07, impact 16:36:12.7 EDT = UTC-4, site 29.4106 N, -82.5393 W = US-27A at NE 140th Ct)
- Sun at impact: az 265.00, el 45.10 (apparent; geometric 45.08). Brief coords 29.39/-82.45 give az 265.07, el 45.03.
- Independent check (Astronomical Almanac low-precision + GMST, in test): az 265.00, el 45.08. Over a year x 4 sites the max NOAA-almanac difference is 0.0097 deg.
- Sunrise 06:41, solar noon 13:26, sunset 20:12, civil dusk 20:36 EDT. Moon: about 2% lit (new moon was 6 May), so it adds no light.
- Glare, Witness B -> veh_A at t=9.9 (16:36:12.2): sightline bearing 283.3 deg, 28.3 m. Sun 49.6 deg off the sightline and 45 deg high, so NO glare risk.

## API (THREE is passed in; Sky class too)
```js
import { Sky } from 'three/addons/objects/Sky.js';
import { environment, configureRenderer } from '/web/assets/environment.js';
const env = environment(THREE, { date: '2016-05-07', timeOfDay: '16:36', utcOffset: '-04:00', lat, lon, weather: 'clear', Sky, center: [0,0], radius: 120 });
scene.add(env.group); scene.fog = env.fog;           // remove the world's own lights (world_v2 has light_hemi / light_sun)
configureRenderer(THREE, renderer);                  // NeutralToneMapping, exposure 1, sRGB (the Preetham sky needs tone mapping)
env.update(camera[, focus]);                         // every frame: keeps the sky on the camera and the shadow frustum on the ROI
env.info -> { sunAzimuth, sunElevation, phase, civilTwilight, night, sunAboveHorizon, needsArtificialLight, keySource, illuminanceLux, luxToIntensity, visibilityM, fogExtinctionPerM, sunrise, sunset, ... }
```
- `date` can also be a full ISO string with an offset ('2016-05-07T16:36:12.7-04:00'). If no offset is given, it is guessed from longitude, which ignores DST; `info.assumedUtcOffset` is then true.
- Flags: `civilTwilight` means -6 <= el <= -0.833. `night` means el < -6, where headlights and streetlights carry the scene. `keySource` is 'sun', 'moon' or 'none'.
- Light levels are in lux (Kasten-Young air mass, Rayleigh + Angstrom extinction, twilight falls about 1 decade per 2.5 deg). They are mapped to three.js intensity through an adapted-eye curve (perceived brightness ~ E^0.25, option `adaptationExponent`). Headlights and streetlights should multiply their lux by `info.luxToIntensity` so they match the daylight. Note that viewer.js headlight intensities (SpotLight 900) assume exposure 1, so they will look far too bright at night unless they are scaled this way.
- Sky: three's Sky.js, with clouds turned off (none are invented). It is patched for exposure matching, a CIE overcast sky, a twilight sky below the horizon, the anti-solar Belt of Venus, and a luminance floor tied to the scene's diffuse light.
- Weather: overcast and rain have no direct sun and no hard shadows. Fog is FogExp2 matched to Koschmieder visibility at V/2, so it is only approximate in renders. Visibility arithmetic should use `info.fogExtinctionPerM`.
- PCFSoftShadowMap was removed in three r186 (the console warns about it). Use PCFShadowMap.

## glareCheck(world, witnessOrVehicleId, targetId|[x,y,z]|null, t, {date, lat, lon, tZero?, timeOfDay?, utcOffset?})
- glareRisk is true when the sun is up, less than 15 deg from the sightline, and lower than 30 deg. It returns the angle, the sun and sightline az/el, the eye and aim points, the local time, the assumptions, and a detail string.
- `tZero` is the event-clock second that `date` refers to. For the demo use date 16:36:12.7 with tZero 10.43.
- For a vehicle, the driver's eye is taken from node.userData.driverEye. If that is missing, an assumed left-hand-drive eye point is used and recorded in `assumptions`.

## Not done / for integrators
- viewer.js still uses its own fixed day/dawn/night presets. Wiring environment() in is the viewer owner's job: case meta needs lat/lon/date/utcOffset/weather.
- The lead's Kenney furniture instruction (web/models/furniture, scene_furniture.md) is outside this slice. The environment uses no models.
