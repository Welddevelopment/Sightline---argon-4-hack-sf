// argon/solar.js — lighting/visibility facts for the critique (world-gen brief step 5).
// Expected sun from the EVIDENCE (date, local time, place) via the NOAA solar position in web/assets/environment.js,
// the sun our RENDERS actually use, artificial lights in the world, and a glare check per witness / moving driver.
//   import { lightingAudit, formatLightingAudit } from './solar.js';
//   const audit = await lightingAudit({ caseId, world });   // world = instantiated world module (optional)
// Glare rule: sun above the horizon, elevation < 30 deg, and within 15 deg of the line of sight.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './client.js';

export const GLARE_MAX_ANGLE_DEG = 15;
export const GLARE_MAX_ELEVATION_DEG = 30;
const R2D = 180 / Math.PI, D2R = Math.PI / 180;
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// Approximate geocodes for case locations whose evidence names a place but gives no coordinates (flagged as approx.).
const GAZETTEER = [
  { re: /williston|NE 140th C(our)?t|levy county/i, lat: 29.41, lon: -82.54, label: 'approx. geocode: US-27A at NE 140th Ct, ~5 mi W of Williston, FL' },
];

async function envModule() {
  const f = path.join(ROOT, 'web', 'assets', 'environment.js');
  if (!fs.existsSync(f)) return null;
  try { return await import(pathToFileURL(f).href); } catch { return null; }
}

// US DST (2007+): second Sunday of March 02:00 local -> first Sunday of November 02:00 local.
function nthSunday(y, mo, n) { const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay(); return 1 + ((7 - first) % 7) + 7 * (n - 1); }
function usDst(y, mo, d, hh) {
  const a = nthSunday(y, 3, 2), b = nthSunday(y, 11, 1);
  const k = mo * 10000 + d * 100 + hh;
  return k >= 3 * 10000 + a * 100 + 2 && k < 11 * 10000 + b * 100 + 2;
}
/** Local UTC offset when the record does not state one: standard zone from longitude, + US DST inside the contiguous US. */
export function assumeUtcOffset(date, time, lat, lon) {
  const [y, mo, d] = String(date).slice(0, 10).split('-').map(Number);
  const hh = Number(String(time || '12').split(':')[0]) || 0;
  const inUS = lat > 24 && lat < 50 && lon > -125 && lon < -66;
  // contiguous-US zones by rough longitude boundary (Eastern/Central ~-86.5, Central/Mountain ~-102, Mountain/Pacific ~-114.5)
  const std = inUS ? (lon > -86.5 ? -5 : lon > -102 ? -6 : lon > -114.5 ? -7 : -8) : Math.round(lon / 15);
  const dst = inUS && usDst(y, mo, d, hh);
  const h = std + (dst ? 1 : 0);
  return { utcOffset: `${h < 0 ? '-' : '+'}${String(Math.abs(h)).padStart(2, '0')}:00`, basis: `assumed from longitude (UTC${std}${dst ? ', +1 h US daylight saving' : ''})` };
}

/** Case scene from the evidence: confirmed facts > extraction > case.json > world meta (each field records its source). */
export function resolveScene(caseId, world = null, override = {}) {
  const dir = path.join(ROOT, 'cases', caseId);
  const layers = [
    ['override', override || {}],
    ['confirmed_facts.json scene', readJson(path.join(dir, 'confirmed_facts.json'))?.scene],
    ['extraction.json scene', readJson(path.join(dir, 'cache', 'extraction.json'))?.scene],
    ['case.json scene', readJson(path.join(dir, 'case.json'))?.scene],
    ['world meta', world?.meta && { ...world.meta, time: world.meta.time ?? world.meta.timeOfDay }],
  ];
  const s = { sources: {} };
  for (const k of ['date', 'time', 'utcOffset', 'lat', 'lon', 'weather', 'lighting', 'location', 'citation']) {
    for (const [src, L] of layers) {
      const v = L?.[k];
      if (v === null || v === undefined || v === '') continue;
      if ((k === 'lat' || k === 'lon') && num(v) === null) continue;
      s[k] = k === 'lat' || k === 'lon' ? +v : v; s.sources[k] = src; break;
    }
  }
  if ((s.lat == null || s.lon == null) && s.location) {
    const g = GAZETTEER.find((e) => e.re.test(s.location));
    if (g) { s.lat = g.lat; s.lon = g.lon; s.sources.lat = s.sources.lon = g.label; }
  }
  return s;
}

const toVec = (azDeg, elDeg) => [Math.cos(elDeg * D2R) * Math.sin(azDeg * D2R), Math.sin(elDeg * D2R), -Math.cos(elDeg * D2R) * Math.cos(azDeg * D2R)];
const toAzEl = (v) => { const n = Math.hypot(v[0], v[1], v[2]) || 1; return { azimuthDeg: ((Math.atan2(v[0], -v[2]) * R2D) % 360 + 360) % 360, elevationDeg: Math.asin(v[1] / n) * R2D }; };
const angleDeg = (a, b) => { const na = Math.hypot(...a) || 1, nb = Math.hypot(...b) || 1; return Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (na * nb)))) * R2D; };
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (az) => COMPASS[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];

// Mirrors web/viewer.js setupLighting(): the sun the renders use when the world authors no DirectionalLight.
const VIEWER_PRESET_SUN = { day: [70, 130, 50], dawn: [-90, 40, -70], night: [-50, 100, 30] };

/** The light our renders actually use (authored world DirectionalLight wins, as in web/render_quality.js). */
export function renderLighting(world) {
  if (!world) return null;
  const kind = String(world.meta?.lighting || 'day').toLowerCase();
  let authored = null;
  const points = [];
  world.root?.updateMatrixWorld?.(true);
  world.root?.traverse?.((o) => {
    if (o.isDirectionalLight && o.visible !== false && (!authored || o.intensity > authored.intensity)) authored = o;
    if ((o.isPointLight || o.isSpotLight) && o.visible !== false && o.intensity > 0) points.push(o.name || o.type);
  });
  let sun, basis;
  if (authored) {
    const p = authored.getWorldPosition ? authored.getWorldPosition(authored.position.clone()) : authored.position;
    const t = authored.target?.getWorldPosition ? authored.target.getWorldPosition(authored.position.clone()) : { x: 0, y: 0, z: 0 };
    sun = toAzEl([p.x - t.x, p.y - t.y, p.z - t.z]); basis = `world-authored DirectionalLight "${authored.name || '(unnamed)'}"`;
  } else {
    sun = toAzEl(VIEWER_PRESET_SUN[kind] || VIEWER_PRESET_SUN.day); basis = `viewer preset for meta.lighting="${kind}" (no sun authored in the world; direction is NOT computed from the case date/time)`;
  }
  const lightish = Object.entries(world.objects || {}).filter(([id, o]) => /street ?light|lamp|lighting|luminaire/i.test(`${id} ${o.label || ''} ${o.kind || ''}`)).map(([id]) => id);
  return { lighting: kind, timeOfDay: world.meta?.timeOfDay ?? null, sun: { azimuthDeg: r1(sun.azimuthDeg), elevationDeg: r1(sun.elevationDeg), compass: compass(sun.azimuthDeg), basis },
    shadowBearingDeg: r1((sun.azimuthDeg + 180) % 360), streetlightObjects: lightish, pointOrSpotLights: points.length,
    headlights: kind === 'day' ? 'viewer adds no headlight beams for lighting="day"' : `viewer adds headlight beams to every vehicle for lighting="${kind}"` };
}

/** Per-witness glare (eye -> lookAt at observationTime) and per-driver glare (direction of travel, sampled). */
export async function glareCheck(world, sun) {
  if (!world || !sun || !Number.isFinite(sun.elevationDeg)) return { witnesses: [], drivers: [] };
  const S = toVec(sun.azimuthDeg, sun.elevationDeg);
  const up = sun.elevationDeg > 0, low = sun.elevationDeg < GLARE_MAX_ELEVATION_DEG;
  const { witnessEye, resolveTarget } = await import('../checks/checks.js');
  const witnesses = [];
  for (const w of world.witnesses || []) {
    try {
      world.setTime(w.observationTime ?? 0);
      world.root?.updateMatrixWorld?.(true);
      const eye = witnessEye(w);
      const { to } = resolveTarget(world, w.lookAt);
      const los = [to.x - eye[0], to.y - eye[1], to.z - eye[2]];
      const sep = angleDeg(los, S), d = toAzEl(los);
      witnesses.push({ id: w.id, t: w.observationTime ?? 0, lookAt: Array.isArray(w.lookAt) ? 'point' : w.lookAt,
        lineOfSightAzimuthDeg: r1(d.azimuthDeg), lineOfSightElevationDeg: r1(d.elevationDeg), sunAngleFromLineOfSightDeg: r1(sep),
        glareRisk: up && low && sep < GLARE_MAX_ANGLE_DEG });
    } catch (e) { witnesses.push({ id: w.id, error: e.message, glareRisk: null }); }
  }
  const drivers = [];
  const dur = world.duration || 0, dt = 0.5;
  for (const [id, o] of Object.entries(world.objects || {})) {
    if (o.kind !== 'vehicle' || !o.node) continue;
    let best = null, prev = null;
    for (let t = 0; t <= dur + 1e-9; t += dt) {
      world.setTime(t); world.root?.updateMatrixWorld?.(true);
      const p = o.node.getWorldPosition ? o.node.getWorldPosition(o.node.position.clone()) : o.node.position;
      if (prev && Math.hypot(p.x - prev.x, p.z - prev.z) > 0.25) {        // moving: travel direction = driver's view ahead
        const fwd = [p.x - prev.x, 0, p.z - prev.z], sep = angleDeg(fwd, S);
        if (!best || sep < best.sep) best = { sep, t, heading: toAzEl(fwd).azimuthDeg };
      }
      prev = { x: p.x, z: p.z };
    }
    if (best) drivers.push({ id, minSunAngleFromTravelDirDeg: r1(best.sep), atT: r1(best.t), travelHeadingDeg: r1(best.heading), glareRisk: up && low && best.sep < GLARE_MAX_ANGLE_DEG });
  }
  try { world.setTime(0); } catch { /* ignore */ }
  return { witnesses, drivers };
}

/** Full lighting audit facts for the critique prompt. */
export async function lightingAudit({ caseId, world = null, scene: override = {}, evidence = null } = {}) {
  const scene = resolveScene(caseId, world, override);
  const out = { scene, expected: null, render: renderLighting(world), glare: { witnesses: [], drivers: [] },
    rule: `glareRisk = sun above horizon AND sun elevation < ${GLARE_MAX_ELEVATION_DEG} deg AND sun within ${GLARE_MAX_ANGLE_DEG} deg of the line of sight`, notes: [] };
  const em = await envModule();
  if (!em?.solarPosition || !em?.resolveDate) out.notes.push('Solar module web/assets/environment.js unavailable: expected sun position not computed.');
  else if (!scene.date || scene.lat == null || scene.lon == null) out.notes.push(`Expected sun not computed: missing ${['date', 'lat', 'lon'].filter((k) => scene[k] == null).join(', ')} in the record.`);
  else {
    let off = scene.utcOffset, offBasis = scene.sources.utcOffset || null;
    if (off == null) ({ utcOffset: off, basis: offBasis } = assumeUtcOffset(scene.date, scene.time, scene.lat, scene.lon));
    const when = em.resolveDate(String(scene.date).slice(0, 10), scene.time ? String(scene.time).slice(0, 8) : undefined, off, scene.lon).date;
    const sp = em.solarPosition(when, scene.lat, scene.lon);
    const exp = { utc: when.toISOString(), local: `${String(scene.date).slice(0, 10)} ${scene.time || '(time unknown: noon assumed)'} UTC${off}`, utcOffsetBasis: offBasis,
      sunAzimuthDeg: r1(sp.azimuthDeg), sunElevationDeg: r1(sp.elevationDeg), sunCompass: compass(sp.azimuthDeg), shadowBearingDeg: r1((sp.azimuthDeg + 180) % 360) };
    if (em.sunTimes) {
      try {
        const st = em.sunTimes(when, scene.lat, scene.lon, em.parseUtcOffset ? em.parseUtcOffset(off) : null);
        const loc = (d) => (d instanceof Date && !isNaN(d) ? new Date(d.getTime() + (em.parseUtcOffset?.(off) ?? 0) * 60000).toISOString().slice(11, 16) : null);
        Object.assign(exp, { sunriseLocal: loc(st.sunrise), sunsetLocal: loc(st.sunset), civilDuskLocal: loc(st.civilDusk) });
        if (st.sunset instanceof Date) exp.minutesBeforeSunset = Math.round((st.sunset - when) / 60000);
      } catch { /* optional */ }
    }
    if (sp.elevationDeg < 0 && em.lunarPosition) {
      try { const m = em.lunarPosition(when, scene.lat, scene.lon); exp.moon = { azimuthDeg: r1(m.azimuthDeg), elevationDeg: r1(m.elevationDeg), illuminatedFraction: r1(m.illuminatedFraction) }; } catch { /* optional */ }
    }
    exp.daylight = sp.elevationDeg > 6 ? 'day' : sp.elevationDeg > -0.833 ? 'low sun / golden hour' : sp.elevationDeg > -6 ? 'civil twilight' : sp.elevationDeg > -12 ? 'nautical twilight' : 'night';
    out.expected = exp;
    out.glare = await glareCheck(world, { azimuthDeg: sp.azimuthDeg, elevationDeg: sp.elevationDeg });
    if (out.render) {
      out.render.sunAzimuthErrorDeg = r1(Math.abs(((out.render.sun.azimuthDeg - sp.azimuthDeg + 540) % 360) - 180));
      out.render.sunElevationErrorDeg = r1(out.render.sun.elevationDeg - sp.elevationDeg);
    }
  }
  if (evidence) {
    const media = [...(evidence.videos || []), ...(evidence.images || [])];
    const scenic = media.filter((f) => !/depo|deposition|transcript|interview|map|diagram|exhibit|sketch|drawing/i.test(f));
    out.realFootage = { mediaFiles: media, possibleSceneFootage: scenic,
      note: scenic.length ? 'Filenames suggest real scene photos/footage: compare render lighting against them.' : 'No real photo/video of the scene is apparent (only depositions/diagrams): lighting can only be compared against the documentary record and computed sun position.' };
  }
  return out;
}

export function formatLightingAudit(a) {
  return '```json\n' + JSON.stringify(a, null, 2) + '\n```';
}
