// Sightline ENVIRONMENT: physically grounded sun / sky / ambient / fog from the case's own date, time, place and weather.
// Pure ES module. Does NOT import three: THREE is passed in (same rule as worlds). Sky.js is passed in too, or the
// Preetham shader is taken from THREE.__Sky / opts.Sky (see environment()).
//
// World axes (SPEC): meters, Y up, +X = east, -Z = north. Azimuth is a compass bearing (0 = north, 90 = east).
//
// Exports
//   solarPosition(date, lat, lon)                -> { azimuthDeg, elevationDeg, trueElevationDeg, zenithDeg, declinationDeg, eqTimeMin, hourAngleDeg, refractionDeg, jd }
//   lunarPosition(date, lat, lon)                -> { azimuthDeg, elevationDeg, illuminatedFraction, phaseAngleDeg }   (low precision, ~1 deg)
//   sunTimes(date, lat, lon, utcOffsetMin)       -> { sunrise, sunset, civilDawn, civilDusk, solarNoon } as Date (scan at 30 s, NOAA position)
//   resolveDate(date, timeOfDay, utcOffset, lon) -> { date: Date, utcOffsetMin, assumedOffset: bool }
//   lightLevels({...})                           -> illuminance model (lux) + perceptual scale, no THREE needed
//   sunDirection(azimuthDeg, elevationDeg)       -> [x, y, z] unit vector toward the sun in world axes
//   environment(THREE, opts)                     -> { group, sun, hemisphere, sky, fog, update(camera, focus?), info, dispose() }
//
// NOAA algorithm: NOAA Global Monitoring Laboratory solar calculator (Meeus, "Astronomical Algorithms"), incl. the NOAA
// atmospheric refraction approximation. Accuracy ~0.01 deg for 1800-2100. elevationDeg is the APPARENT (refracted) elevation,
// which is what a witness sees.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const sinD = (d) => Math.sin(d * D2R);
const cosD = (d) => Math.cos(d * D2R);
const tanD = (d) => Math.tan(d * D2R);
const mod = (a, n) => ((a % n) + n) % n;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ---------------------------------------------------------------- time handling
// "-04:00" | "-0400" | -4 (hours) | -240 (minutes, |v|>16) -> minutes east of UTC
export function parseUtcOffset(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return Math.abs(v) <= 16 ? v * 60 : v;
  const s = String(v).trim();
  if (/^z$/i.test(s) || /^utc$/i.test(s)) return 0;
  const m = s.match(/^([+-])(\d{1,2}):?(\d{2})?$/);
  if (!m) return null;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
}

/**
 * resolveDate(date, timeOfDay, utcOffset, lon)
 *  date: Date | ISO string. With an explicit offset ("2016-05-07T16:36:12-04:00") it is unambiguous.
 *  timeOfDay: optional "HH:MM[:SS]" LOCAL time that replaces the time part (keeps the calendar date + offset).
 *  utcOffset: optional "-04:00" / -4. Needed when date has no offset (or is a Date) and timeOfDay is given.
 *  If no offset is known anywhere, falls back to round(lon/15) h and flags assumedOffset (no DST knowledge!).
 */
export function resolveDate(date, timeOfDay, utcOffset, lon = 0) {
  let off = parseUtcOffset(utcOffset);
  let assumed = false;
  let y, mo, d, hh = 12, mi = 0, ss = 0;
  if (date instanceof Date || typeof date === 'number') {
    const dt = new Date(date);
    if (!timeOfDay) return { date: dt, utcOffsetMin: off ?? 0, assumedOffset: off === null };
    if (off === null) { off = Math.round(lon / 15) * 60; assumed = true; }
    const local = new Date(dt.getTime() + off * 60000);
    y = local.getUTCFullYear(); mo = local.getUTCMonth() + 1; d = local.getUTCDate();
  } else {
    const s = String(date).trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
    if (!m) {
      const dt = new Date(s);
      if (isNaN(dt)) throw new Error(`environment: cannot parse date "${date}"`);
      return { date: dt, utcOffsetMin: off ?? 0, assumedOffset: off === null };
    }
    y = +m[1]; mo = +m[2]; d = +m[3];
    if (m[4] !== undefined) { hh = +m[4]; mi = +m[5]; ss = m[6] ? +m[6] : 0; }
    if (m[7]) { const o = parseUtcOffset(m[7]); if (off === null) off = o; }
  }
  if (timeOfDay) {
    const t = String(timeOfDay).match(/^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/);
    if (!t) throw new Error(`environment: timeOfDay must be "HH:MM[:SS]", got "${timeOfDay}"`);
    hh = +t[1]; mi = +t[2]; ss = t[3] ? +t[3] : 0;
  }
  if (off === null) { off = Math.round(lon / 15) * 60; assumed = true; }
  const ms = Date.UTC(y, mo - 1, d, hh, mi, 0) + ss * 1000 - off * 60000;
  return { date: new Date(ms), utcOffsetMin: off, assumedOffset: assumed };
}

function toDate(date) {
  if (date instanceof Date) return date;
  if (typeof date === 'number') return new Date(date);
  return resolveDate(date).date;
}

// ---------------------------------------------------------------- NOAA solar position
export function solarPosition(date, lat, lon) {
  const dt = toDate(date);
  const jd = dt.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525.0;

  const L0 = mod(280.46646 + T * (36000.76983 + T * 0.0003032), 360);       // geom mean long sun
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);                   // geom mean anomaly
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);              // eccentricity
  const C = sinD(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) + sinD(2 * M) * (0.019993 - 0.000101 * T) + sinD(3 * M) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const appLong = trueLong - 0.00569 - 0.00478 * sinD(omega);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * cosD(omega);
  const decl = Math.asin(sinD(eps) * sinD(appLong)) * R2D;
  const yv = tanD(eps / 2) ** 2;
  const eqTime = 4 * R2D * (yv * sinD(2 * L0) - 2 * e * sinD(M) + 4 * e * yv * sinD(M) * cosD(2 * L0)
    - 0.5 * yv * yv * sinD(4 * L0) - 1.25 * e * e * sinD(2 * M));                    // minutes

  const utcMin = dt.getUTCHours() * 60 + dt.getUTCMinutes() + dt.getUTCSeconds() / 60 + dt.getUTCMilliseconds() / 60000;
  const tst = mod(utcMin + eqTime + 4 * lon, 1440);                               // true solar time, minutes
  let ha = tst / 4 - 180;                                                           // hour angle, deg
  if (ha < -180) ha += 360;

  const cosZ = clamp(sinD(lat) * sinD(decl) + cosD(lat) * cosD(decl) * cosD(ha), -1, 1);
  const zen = Math.acos(cosZ) * R2D;
  let az;
  const den = cosD(lat) * sinD(zen);
  if (Math.abs(den) > 1e-9) {
    const a = Math.acos(clamp((sinD(lat) * cosZ - sinD(decl)) / den, -1, 1)) * R2D;
    az = ha > 0 ? mod(a + 180, 360) : mod(540 - a, 360);
  } else {
    az = lat > 0 ? 180 : 0;
  }
  const trueEl = 90 - zen;
  // NOAA refraction approximation (arc seconds)
  let refr = 0;
  if (trueEl <= 85) {
    const te = tanD(trueEl);
    if (trueEl > 5) refr = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
    else if (trueEl > -0.575) refr = 1735 + trueEl * (-518.2 + trueEl * (103.4 + trueEl * (-12.79 + trueEl * 0.711)));
    else refr = -20.774 / te;
    refr /= 3600;
  }
  return {
    azimuthDeg: az, elevationDeg: trueEl + refr, trueElevationDeg: trueEl, zenithDeg: zen - refr,
    declinationDeg: decl, eqTimeMin: eqTime, hourAngleDeg: ha, refractionDeg: refr, jd,
  };
}

// ---------------------------------------------------------------- low-precision moon (Meeus-truncated, ~1 deg)
function sunRaDec(d) {
  const M = D2R * (357.5291 + 0.98560028 * d);
  const C = D2R * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + D2R * 102.9372 + Math.PI;
  const e = D2R * 23.4397;
  return { ra: Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L)), dec: Math.asin(Math.sin(e) * Math.sin(L)) };
}

export function lunarPosition(date, lat, lon) {
  const dt = toDate(date);
  const d = dt.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const L = D2R * (218.316 + 13.176396 * d);
  const M = D2R * (134.963 + 13.064993 * d);
  const F = D2R * (93.272 + 13.229350 * d);
  const l = L + D2R * 6.289 * Math.sin(M);
  const b = D2R * 5.128 * Math.sin(F);
  const dist = 385001 - 20905 * Math.cos(M);  // km
  const e = D2R * 23.4397;
  const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  const theta = D2R * (280.16 + 360.9856235 * d) + D2R * lon;   // local sidereal time
  const H = theta - ra;
  const phi = D2R * lat;
  let alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  alt -= Math.asin(6378.14 / dist) * Math.cos(alt);             // topocentric parallax (~0.95 deg)
  const azS = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  // phase
  const s = sunRaDec(d);
  const sdist = 149598000;
  const elong = Math.acos(clamp(Math.sin(s.dec) * Math.sin(dec) + Math.cos(s.dec) * Math.cos(dec) * Math.cos(s.ra - ra), -1, 1));
  const inc = Math.atan2(sdist * Math.sin(elong), dist - sdist * Math.cos(elong));
  return {
    azimuthDeg: mod(azS * R2D + 180, 360), elevationDeg: alt * R2D,
    illuminatedFraction: (1 + Math.cos(inc)) / 2, phaseAngleDeg: inc * R2D, distanceKm: dist,
  };
}

// ---------------------------------------------------------------- sunrise / sunset (scan)
export function sunTimes(date, lat, lon, utcOffsetMin = null) {
  const dt = toDate(date);
  const off = utcOffsetMin ?? Math.round(lon / 15) * 60;
  const local = new Date(dt.getTime() + off * 60000);
  const day0 = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - off * 60000;
  const out = { sunrise: null, sunset: null, civilDawn: null, civilDusk: null, solarNoon: null };
  let prev = null, maxEl = -99;
  const step = 30000;
  for (let ms = day0; ms <= day0 + 86400000; ms += step) {
    const el = solarPosition(new Date(ms), lat, lon).elevationDeg;
    if (el > maxEl) { maxEl = el; out.solarNoon = new Date(ms); }
    if (prev !== null) {
      const cross = (h) => (prev < h && el >= h) ? 'up' : (prev >= h && el < h) ? 'down' : null;
      const f = (h) => new Date(ms - step + step * (h - prev) / (el - prev));
      if (cross(-0.833) === 'up') out.sunrise = f(-0.833);
      if (cross(-0.833) === 'down') out.sunset = f(-0.833);
      if (cross(-6) === 'up') out.civilDawn = f(-6);
      if (cross(-6) === 'down') out.civilDusk = f(-6);
    }
    prev = el;
  }
  return out;
}

// World direction toward a body at compass azimuth / elevation (+X east, -Z north, +Y up).
export function sunDirection(azimuthDeg, elevationDeg) {
  const ce = cosD(elevationDeg);
  return [sinD(azimuthDeg) * ce, sinD(elevationDeg), -cosD(azimuthDeg) * ce];
}

// ---------------------------------------------------------------- illuminance model
// Spectral optical depths at the three render primaries (680 / 550 / 450 nm): Rayleigh 0.0088*lambda^-4.05 and an
// Angstrom aerosol term beta*lambda^-1.3 (beta = 0.05: clear rural air, AOD550 ~0.11; ~0.2 for hazy). Kasten-Young air mass.
const LAMBDA = [0.68, 0.55, 0.45];
function airMass(elDeg) {
  const z = 90 - Math.max(elDeg, -0.5);
  return 1 / (cosD(z) + 0.50572 * Math.pow(96.07995 - z, -1.6364));
}
function transmittance(elDeg, beta = 0.05) {
  const am = airMass(elDeg);
  return LAMBDA.map((l) => Math.exp(-am * (0.0088 * Math.pow(l, -4.05) + beta * Math.pow(l, -1.3))));
}

const WEATHER = {
  // direct: fraction of clear-sky direct beam kept; diffuse: diffuse horizontal as a fraction of CLEAR-sky GLOBAL;
  // visibilityM: meteorological visibility (Koschmieder 2% contrast); shadows: hard sun shadows meaningful?
  clear:    { direct: 1.0,  diffuseOfGlobal: null, visibilityM: 30000, beta: 0.05, shadows: true,  overcast: 0.0 },
  overcast: { direct: 0.0,  diffuseOfGlobal: 0.32, visibilityM: 15000, beta: 0.15, shadows: false, overcast: 1.0 },
  rain:     { direct: 0.0,  diffuseOfGlobal: 0.16, visibilityM: 3000,  beta: 0.20, shadows: false, overcast: 1.0 },
  fog:      { direct: 0.12, diffuseOfGlobal: 0.45, visibilityM: 200,   beta: 0.30, shadows: false, overcast: 0.6 },
};

/**
 * lightLevels({sunEl, moonEl, moonFraction, moonPhaseDeg, weather, visibilityM})
 *  Physical horizontal illuminance (lux) of direct sun/moon and diffuse sky, plus the perceptual scale used to turn lux into
 *  three.js intensities: intensity = lux * luxToIntensity. luxToIntensity models an eye/camera ADAPTED to the scene
 *  (perceived brightness ~ E^0.25, a Stevens-type compression): dusk looks dimmer than noon, night darker still, but nothing
 *  is "graded". Other light sources (headlights, streetlights) that want to be physically consistent should use
 *  info.luxToIntensity too.
 */
export function lightLevels({ sunEl, moonEl = -90, moonFraction = 0, moonPhaseDeg = 180, weather = 'clear', visibilityM } = {}) {
  const w = WEATHER[weather] || WEATHER.clear;
  const E0 = 128000; // extraterrestrial illuminance, lux
  const T = transmittance(sunEl, w.beta);
  const dniClear = sunEl > -0.5 ? E0 * T[1] : 0;                      // direct normal, lux
  const sinEl = Math.max(0, sinD(sunEl));
  // clear-sky diffuse horizontal: ~650 lux at sunset, ~20 klux high sun; twilight decays ~1 decade per 2.5 deg of depression
  const diffDay = sunEl > 0 ? 650 + 20000 * Math.pow(sinEl, 0.7) : 0;
  const diffTw = 650 * Math.pow(10, Math.min(0, sunEl) / 2.5);
  const diffClear = Math.max(diffDay, diffTw);
  const globalClear = dniClear * sinEl + diffClear;
  let directNormal = dniClear * w.direct;
  let diffuse = w.diffuseOfGlobal == null ? diffClear : Math.max(diffTw * w.diffuseOfGlobal * 2, globalClear * w.diffuseOfGlobal);
  // moon: full moon at zenith ~0.27 lux on a normal surface; Allen phase law; same extinction model
  let moonNormal = 0;
  if (moonEl > -0.5) {
    const phaseMag = 0.026 * Math.abs(moonPhaseDeg) + 4e-9 * Math.pow(moonPhaseDeg, 4);
    moonNormal = 0.32 * Math.pow(10, -0.4 * phaseMag) * transmittance(moonEl, w.beta)[1] / 0.76;
    if (w.direct === 0) { diffuse += moonNormal * Math.max(0, sinD(moonEl)) * 0.3; moonNormal = 0; }
    else moonNormal *= w.direct;
  }
  const starlight = 0.002; // natural night sky (airglow + stars), lux, moonless clear
  diffuse = Math.max(diffuse, starlight * (w.direct === 0 ? 0.5 : 1));
  const globalLux = directNormal * sinEl + moonNormal * Math.max(0, sinD(moonEl)) + diffuse;
  const Eref = 60000;  // global illuminance at which luxToIntensity gives intensity 3.0 (a white horizontal surface at ~45 deg sun renders near, not above, display white)
  const k = 3.0 / Eref;
  const luxToIntensity = k * Math.pow(Eref / globalLux, 0.75);
  // colour: white-balanced to a high sun (camera 'daylight' balance, AM 1.2) so noon sun is neutral and a low sun turns amber
  const Twb = transmittance(56, w.beta);
  const sunColor = (() => { const c = T.map((x, i) => x / Twb[i]); const m = Math.max(...c); return c.map((x) => x / m); })();
  return {
    directNormalLux: directNormal, diffuseLux: diffuse, moonNormalLux: moonNormal, globalLux,
    luxToIntensity, perceivedBrightness: Math.pow(globalLux / Eref, 0.25), sunColor,
    visibilityM: visibilityM ?? w.visibilityM, shadows: w.shadows, overcast: w.overcast, weather: WEATHER[weather] ? weather : 'clear',
  };
}

// ---------------------------------------------------------------- sky shader patch
// Preetham (three/examples Sky.js) plus: skyGain (exposure match with scene lights), CIE overcast blend, twilight term for a
// sun below the horizon (Preetham goes black at about -2.6 deg; the real civil-twilight sky stays deep blue), horizon haze
// blend toward the fog colour. No clouds are invented on a clear day (cloudCoverage = 0).
function patchSkyMaterial(material) {
  const fs = material.fragmentShader;
  if (fs.includes('uniform float skyGain;')) return;
  material.uniforms.skyGain = { value: 1 };
  material.uniforms.overcastMix = { value: 0 };
  material.uniforms.overcastColor = { value: [0.62, 0.65, 0.69] };
  material.uniforms.twilight = { value: 0 };
  material.uniforms.sunDirTrue = { value: [0, 1, 0] };
  material.uniforms.hazeMix = { value: 0 };
  material.uniforms.hazeColor = { value: [0.7, 0.72, 0.75] };
  material.uniforms.nightColor = { value: [0.0, 0.0, 0.0] };
  const decl = 'uniform float skyGain; uniform float overcastMix; uniform vec3 overcastColor; uniform float twilight; uniform vec3 sunDirTrue; uniform float hazeMix; uniform vec3 hazeColor; uniform vec3 nightColor;\n';
  const tail = /\n\s*gl_FragColor = vec4\( texColor, 1\.0 \);/;
  if (!tail.test(fs)) throw new Error('environment: Sky.js shader layout changed; cannot patch');
  material.fragmentShader = decl + fs.replace(tail, `
      {
        float upY = max( direction.y, 0.0 );
        // twilight sky (sun below horizon): deep blue zenith, paler horizon, warm band on the sun side
        vec2 dxz = normalize( direction.xz + vec2( 1e-5 ) );
        vec2 sxz = normalize( sunDirTrue.xz + vec2( 1e-5 ) );
        float toward = dot( dxz, sxz ) * 0.5 + 0.5;
        float horiz = exp( -upY * 3.5 );
        vec3 tw = mix( vec3( 0.045, 0.085, 0.20 ), vec3( 0.20, 0.22, 0.32 ), horiz );
        tw += vec3( 0.55, 0.28, 0.12 ) * pow( toward, 3.0 ) * exp( -upY * 9.0 );
        texColor += twilight * tw;
        texColor += nightColor * ( 0.6 + 0.4 * horiz );
        // CIE standard overcast sky: L(theta) = Lz * (1 + 2 sin(elev)) / 3
        vec3 oc = overcastColor * ( 1.0 + 2.0 * upY ) / 3.0;
        texColor = mix( texColor, oc, overcastMix );
        // horizon haze toward fog colour
        texColor = mix( texColor, hazeColor, hazeMix * exp( -upY * 6.0 ) );
      }
      gl_FragColor = vec4( texColor * skyGain, 1.0 );`);
  material.needsUpdate = true;
}

// three.js Preetham sun-intensity term (same constants as Sky.js) to normalise sky brightness against our lux model
function preethamSunE(elDeg) {
  const z = Math.acos(clamp(sinD(elDeg), -1, 1));
  return 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - z) / 1.5)));
}

// ---------------------------------------------------------------- environment()
/**
 * environment(THREE, opts)
 *  opts: {
 *    date: '2016-05-07T16:36:12-04:00' | '2016-05-07' | Date,  timeOfDay?: '16:36' (local; replaces the time part),
 *    utcOffset?: '-04:00',  lat, lon,  weather?: 'clear'|'overcast'|'rain'|'fog',  visibilityM?: number,
 *    Sky: the Sky class from 'three/addons/objects/Sky.js' (required for the sky dome; omitted -> plain background colour),
 *    center?: [x, z] region of interest (default [0, 0]),  radius?: shadow half-extent in m (default 120),
 *    shadowMapSize?: 2048,  groundAlbedo?: 0.18,
 *  }
 *  Returns { group, sun, hemisphere, sky, fog, background, update(camera, focus?), info, dispose(), recommendedRenderer }.
 *  Add `group` to the scene, set scene.fog = env.fog (and scene.background = env.background if there is no sky),
 *  and call env.update(camera) each frame (or after camera moves).
 */
export function environment(THREE, opts = {}) {
  const { lat, lon } = opts;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('environment: lat and lon are required numbers');
  const weather = WEATHER[opts.weather] ? opts.weather : 'clear';
  const r = resolveDate(opts.date ?? new Date(), opts.timeOfDay, opts.utcOffset, lon);
  const when = r.date;
  const sp = solarPosition(when, lat, lon);
  const mp = lunarPosition(when, lat, lon);
  const L = lightLevels({ sunEl: sp.elevationDeg, moonEl: mp.elevationDeg, moonFraction: mp.illuminatedFraction,
    moonPhaseDeg: mp.phaseAngleDeg, weather, visibilityM: opts.visibilityM });
  const s = L.luxToIntensity;

  const group = new THREE.Group();
  group.name = 'environment';

  // ---- key light: sun by day, moon when the sun is down and the moon is up
  const sunUp = sp.elevationDeg > -0.833;
  const moonUseful = !sunUp && mp.elevationDeg > 0 && L.moonNormalLux > 0.002;
  const keySource = sunUp && L.directNormalLux > 1 ? 'sun' : moonUseful ? 'moon' : 'none';
  const keyAz = keySource === 'moon' ? mp.azimuthDeg : sp.azimuthDeg;
  const keyEl = keySource === 'moon' ? mp.elevationDeg : sp.elevationDeg;
  const keyDir = new THREE.Vector3(...sunDirection(keyAz, Math.max(keyEl, 0.5))).normalize();

  const sun = new THREE.DirectionalLight(0xffffff, 0);
  sun.name = 'env_sun';
  if (keySource === 'sun') {
    sun.color.setRGB(L.sunColor[0], L.sunColor[1], L.sunColor[2], THREE.LinearSRGBColorSpace);
    sun.intensity = L.directNormalLux * s;
  } else if (keySource === 'moon') {
    sun.color.setRGB(0.80, 0.85, 1.0, THREE.LinearSRGBColorSpace);
    sun.intensity = L.moonNormalLux * s;
  }
  const radius = opts.radius ?? 120;
  const mapSize = opts.shadowMapSize ?? 2048;
  sun.castShadow = L.shadows && keySource !== 'none' && keyEl > 0;
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  const sc = sun.shadow.camera;
  sc.left = -radius; sc.right = radius; sc.top = radius; sc.bottom = -radius; sc.near = 1; sc.far = 3000;
  sun.target.name = 'env_sun_target';
  group.add(sun, sun.target);
  const center = new THREE.Vector3(opts.center?.[0] ?? 0, 0, opts.center?.[1] ?? 0);
  function placeSun(c, R) {
    sun.target.position.copy(c);
    sun.position.copy(c).addScaledVector(keyDir, 1000);
    if (R && Math.abs(R - sc.right) > 1e-3) { sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.updateProjectionMatrix(); }
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }
  placeSun(center, radius);

  // ---- hemisphere (sky dome diffuse + ground bounce)
  const albedo = opts.groundAlbedo ?? 0.18;
  const tw = clamp((sp.elevationDeg + 6) / 12, 0, 1);  // 0 at -6 deg, 1 at +6 deg
  let skyCol, gndCol;
  if (L.overcast >= 1) {
    skyCol = [0.92, 0.95, 1.0];
  } else if (sunUp) {
    // clear sky diffuse: bluish at high sun, more neutral/warm near the horizon
    const hi = clamp(sp.elevationDeg / 40, 0, 1);
    skyCol = [0.78 + 0.1 * (1 - hi), 0.86, 1.0];
  } else {
    skyCol = [0.55 + 0.15 * tw, 0.65 + 0.1 * tw, 1.0];   // twilight / night: blue (also scotopic shift)
  }
  if (weather === 'fog') skyCol = [0.93, 0.95, 0.97];
  const bounce = albedo * L.globalLux / Math.max(L.diffuseLux, 1e-6);
  gndCol = [0.95 * bounce, 0.92 * bounce, 0.80 * bounce];
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0xffffff, L.diffuseLux * s);
  hemisphere.name = 'env_hemisphere';
  hemisphere.color.setRGB(...skyCol, THREE.LinearSRGBColorSpace);
  hemisphere.groundColor.setRGB(...gndCol, THREE.LinearSRGBColorSpace);
  group.add(hemisphere);

  // ---- sky dome (Preetham, patched)
  let sky = null;
  const SkyClass = opts.Sky || THREE.__Sky || null;
  const horizonLin = new THREE.Color();   // linear horizon colour for fog / background
  {
    // horizon colour (approximate, linear): clear day pale blue-grey, golden near sunset, twilight blue, night near-black
    const pb = L.perceivedBrightness;
    let h;
    if (L.overcast >= 1) h = [0.55, 0.58, 0.62];
    else if (sp.elevationDeg > 8) h = [0.62, 0.72, 0.85];
    else if (sp.elevationDeg > -0.833) h = [0.80, 0.68, 0.55];
    else h = [0.20, 0.23, 0.36];
    if (weather === 'fog') h = [0.72, 0.74, 0.76];
    const g = clamp(pb / 1.03, 0, 1.2);
    horizonLin.setRGB(h[0] * g, h[1] * g, h[2] * g, THREE.LinearSRGBColorSpace);
  }
  if (SkyClass) {
    sky = new SkyClass();
    sky.name = 'env_sky';
    sky.scale.setScalar(1000);
    sky.frustumCulled = false;
    sky.renderOrder = -1000;
    patchSkyMaterial(sky.material);
    const u = sky.material.uniforms;
    // tuned against reference photographs of clear subtropical skies: low turbidity + rayleigh ~1.2 keeps the zenith a
    // saturated but not purple blue; mie values give a modest aureole around the sun and a pale horizon.
    const beta = (WEATHER[weather] || WEATHER.clear).beta;
    u.turbidity.value = weather === 'clear' ? 2.6 : 6;
    u.rayleigh.value = weather === 'clear' ? 1.15 : 0.6;
    u.mieCoefficient.value = 0.004 + beta * 0.01;
    u.mieDirectionalG.value = 0.78;
    if (u.cloudCoverage) u.cloudCoverage.value = 0;   // never invent clouds
    if (u.showSunDisc) u.showSunDisc.value = keySource === 'sun' && L.overcast < 1 ? 1 : 0;
    const sd = sunDirection(sp.azimuthDeg, sp.elevationDeg);
    // Preetham fades to black at about -2.6 deg; feed it the true sun so the afterglow ends naturally, twilight term takes over
    u.sunPosition.value.set(sd[0], sd[1], sd[2]).multiplyScalar(1000);
    u.sunDirTrue.value = new THREE.Vector3(sd[0], sd[1], sd[2]);
    // brightness match: Preetham radiance scales with its own sunE; our scene is lit at perceivedBrightness
    const pe = preethamSunE(Math.max(sp.elevationDeg, -10));
    const peRef = preethamSunE(45);
    const pb = L.perceivedBrightness;
    let gain = 0.45 * pb / Math.max(Math.pow(pe / peRef, 0.9), 0.06);
    if (!sunUp) gain = 0.45 * pb / 0.06;
    u.skyGain.value = clamp(gain, 0, 20);
    // twilight term: strongest just after sunset, gone by the end of nautical twilight; scaled to perceived light
    const dep = -sp.elevationDeg;
    const twAmt = dep < -4 ? 0 : clamp(1 - (dep + 4) / 16, 0, 1);  // ramps in from +4 deg to -12 deg
    u.twilight.value = twAmt * twAmt * 0.12 / Math.max(u.skyGain.value, 1e-3) * clamp(pb * 3, 0, 1.5);
    u.nightColor.value = new THREE.Vector3(0.012, 0.016, 0.03).multiplyScalar(1 / Math.max(u.skyGain.value, 1e-3) * (sunUp ? 0 : 1));
    u.overcastMix.value = L.overcast;
    const ocg = clamp(L.perceivedBrightness * 0.95, 0, 1.2) / Math.max(u.skyGain.value, 1e-3);
    u.overcastColor.value = new THREE.Vector3(0.66 * ocg, 0.69 * ocg, 0.73 * ocg);
    u.hazeMix.value = weather === 'fog' ? 0.9 : weather === 'rain' ? 0.5 : 0;
    u.hazeColor.value = new THREE.Vector3(horizonLin.r, horizonLin.g, horizonLin.b).multiplyScalar(1 / Math.max(u.skyGain.value, 1e-3));
    group.add(sky);
  }

  // ---- fog: Koschmieder visibility V -> FogExp2 density so that contrast is 2% at V: exp(-(rho V)^2) = 0.02
  const V = L.visibilityM;
  const fog = new THREE.FogExp2(horizonLin.getHex(THREE.LinearSRGBColorSpace) ?? 0xaaaaaa, Math.sqrt(-Math.log(0.02)) / V);
  fog.color.copy(horizonLin);
  const background = horizonLin.clone();

  // ---- info
  const el = sp.elevationDeg;
  const phase = el > -0.833 ? 'day' : el >= -6 ? 'civil' : el >= -12 ? 'nautical' : el >= -18 ? 'astronomical' : 'night';
  const times = sunTimes(when, lat, lon, r.utcOffsetMin);
  const fmt = (d) => {
    if (!d) return null;
    const x = new Date(d.getTime() + r.utcOffsetMin * 60000);
    return `${String(x.getUTCHours()).padStart(2, '0')}:${String(x.getUTCMinutes()).padStart(2, '0')}`;
  };
  const info = {
    when: when.toISOString(), utcOffsetMin: r.utcOffsetMin, assumedUtcOffset: r.assumedOffset, lat, lon, weather,
    sunAzimuth: +sp.azimuthDeg.toFixed(2), sunElevation: +sp.elevationDeg.toFixed(2), sunTrueElevation: +sp.trueElevationDeg.toFixed(2),
    moonAzimuth: +mp.azimuthDeg.toFixed(1), moonElevation: +mp.elevationDeg.toFixed(1), moonIllumination: +mp.illuminatedFraction.toFixed(3),
    keySource,                                         // 'sun' | 'moon' | 'none'
    phase,                                             // 'day' | 'civil' | 'nautical' | 'astronomical' | 'night'
    sunAboveHorizon: el > -0.833,                      // standard sunrise/sunset definition (refraction + solar radius)
    civilTwilight: el <= -0.833 && el >= -6,
    night: el < -6,                                    // darker than civil twilight: artificial light (headlights, streetlights) dominates
    needsArtificialLight: el < -0.833 || (weather !== 'clear' && L.globalLux < 1000),
    illuminanceLux: { global: +L.globalLux.toPrecision(3), directNormal: +L.directNormalLux.toPrecision(3), diffuse: +L.diffuseLux.toPrecision(3), moon: +L.moonNormalLux.toPrecision(3) },
    luxToIntensity: L.luxToIntensity,                  // multiply a physical lux value by this to get a matching three.js intensity
    visibilityM: V,
    sunrise: fmt(times.sunrise), sunset: fmt(times.sunset), civilDawn: fmt(times.civilDawn), civilDusk: fmt(times.civilDusk), solarNoon: fmt(times.solarNoon),
    model: 'NOAA solar position (Meeus); Kasten-Young air mass; Rayleigh+Angstrom extinction; Preetham sky (three Sky.js) + CIE overcast; perceptual adaptation E^0.25',
  };

  // ---- update: keep sky on the camera, keep the shadow frustum on the region of interest
  const tmp = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  function update(camera, focus) {
    if (!camera) return;
    if (sky) { sky.position.copy(camera.position); sky.updateMatrixWorld(); }
    let c, R = radius;
    if (focus) {
      c = Array.isArray(focus) ? tmp.set(focus[0], 0, focus.length > 2 ? focus[2] : focus[1]) : tmp.set(focus.x, 0, focus.z);
    } else {
      camera.getWorldDirection(fwd);
      const p = camera.position;
      if (camera.isOrthographicCamera) {
        c = tmp.set(p.x, 0, p.z);
        R = Math.max(radius * 0.5, (camera.right - camera.left) / (2 * (camera.zoom || 1)) * 1.1, (camera.top - camera.bottom) / (2 * (camera.zoom || 1)) * 1.1);
      } else {
        // look-at point on the ground, clamped so a near-horizontal view still keeps nearby objects in the shadow map
        const tHit = fwd.y < -1e-3 ? -p.y / fwd.y : Infinity;
        const dist = Math.min(tHit, radius * 0.8);
        c = tmp.set(p.x + fwd.x * dist, 0, p.z + fwd.z * dist);
        R = Math.max(radius * 0.5, Math.min(radius * 2, dist * 1.25 + p.y));
      }
    }
    // snap to shadow texels to avoid shimmering while the camera moves
    const texel = (2 * R) / mapSize;
    c.x = Math.round(c.x / texel) * texel; c.z = Math.round(c.z / texel) * texel;
    placeSun(c, R);
  }

  function dispose() {
    if (sky) { sky.geometry.dispose(); sky.material.dispose(); }
    sun.shadow.map?.dispose?.();
  }

  return {
    group, sun, hemisphere, sky, fog, background, update, info, dispose,
    recommendedRenderer: { toneMapping: 'NeutralToneMapping', toneMappingExposure: 1.0, outputColorSpace: 'srgb', shadowMapType: 'PCFShadowMap' },
  };
}

// Optional helper: apply the recommended renderer settings (Khronos PBR Neutral keeps object colours true; no grading).
export function configureRenderer(THREE, renderer) {
  renderer.toneMapping = THREE.NeutralToneMapping ?? THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;   // PCFSoft was removed in r18x
}
