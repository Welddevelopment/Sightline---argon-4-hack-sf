// node checks/test_glare.mjs : solar position (NOAA vs an independent sidereal-time formula), environment() smoke, glare check.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { solarPosition, resolveDate, sunTimes, environment, sunDirection, lunarPosition } from '../web/assets/environment.js';
import { glareCheck } from './glare.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n     ', e.message); }
}
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

// ---- independent formula: Astronomical Almanac low-precision sun (Michalsky 1988) + GMST hour angle. Shares no code with NOAA.
function almanacSun(date, lat, lon) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * D2R;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 0.0000004 * n) * D2R;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lmst = (gmst + lon / 15) * 15 * D2R;
  const ha = lmst - ra;
  const phi = lat * D2R;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { azimuthDeg: ((az * R2D) % 360 + 360) % 360, elevationDeg: el * R2D };
}
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// Demo case: NTSB HWY16FH018, US-27A at NE 140th Ct near Williston FL. Impact 16:36:12.7 EDT (UTC-4) on 2016-05-07.
const CASE = { date: '2016-05-07T16:36:12.7-04:00', lat: 29.4106, lon: -82.5393 };
const BRIEF = { lat: 29.39, lon: -82.45 };   // coordinates given in the task brief (Williston town centre)

test('resolveDate handles offsets and timeOfDay', () => {
  assert.equal(resolveDate('2016-05-07T16:36:12-04:00').date.toISOString(), '2016-05-07T20:36:12.000Z');
  assert.equal(resolveDate('2016-05-07', '16:36', '-04:00').date.toISOString(), '2016-05-07T20:36:00.000Z');
  assert.equal(resolveDate('2016-05-07T08:00-04:00', '19:45').date.toISOString(), '2016-05-07T23:45:00.000Z');
  assert.equal(resolveDate('2016-05-07', '12:00', null, -82.5).assumedOffset, true);
});

test('demo case 16:36 EDT: elevation 45-50, azimuth 255-266 (both coordinate sets)', () => {
  for (const p of [CASE, BRIEF]) {
    const s = solarPosition(CASE.date, p.lat, p.lon);
    console.log(`      NOAA  ${p.lat},${p.lon}: az ${s.azimuthDeg.toFixed(2)}  el ${s.elevationDeg.toFixed(2)} (true ${s.trueElevationDeg.toFixed(2)}, refr ${(s.refractionDeg * 60).toFixed(2)}')`);
    assert.ok(s.elevationDeg > 44 && s.elevationDeg < 50, `el ${s.elevationDeg}`);
    assert.ok(s.azimuthDeg > 255 && s.azimuthDeg < 266, `az ${s.azimuthDeg}`);
  }
});

test('NOAA agrees with independent almanac formula (< 0.05 deg) over a year, 4 sites', () => {
  let worst = 0;
  const sites = [[29.4106, -82.5393], [51.48, 0], [-33.87, 151.21], [64.84, -147.72]];
  for (const [lat, lon] of sites) {
    for (let day = 0; day < 365; day += 7) for (let h = 0; h < 24; h += 1.5) {
      const d = new Date(Date.UTC(2016, 0, 1) + day * 86400000 + h * 3600000);
      const a = solarPosition(d, lat, lon), b = almanacSun(d, lat, lon);
      const de = Math.abs(a.trueElevationDeg - b.elevationDeg);
      const da = b.elevationDeg > 2 && b.elevationDeg < 85 ? angDiff(a.azimuthDeg, b.azimuthDeg) * Math.cos(b.elevationDeg * D2R) : 0;
      worst = Math.max(worst, de, da);
    }
  }
  console.log(`      worst |NOAA - almanac| = ${worst.toFixed(4)} deg`);
  assert.ok(worst < 0.05, `worst ${worst}`);
});

test('demo case vs almanac formula', () => {
  const a = solarPosition(CASE.date, CASE.lat, CASE.lon);
  const b = almanacSun(resolveDate(CASE.date).date, CASE.lat, CASE.lon);
  console.log(`      almanac: az ${b.azimuthDeg.toFixed(2)}  el ${b.elevationDeg.toFixed(2)} (geometric)`);
  assert.ok(Math.abs(a.trueElevationDeg - b.elevationDeg) < 0.02);
  assert.ok(angDiff(a.azimuthDeg, b.azimuthDeg) < 0.03);
});

test('sunrise/sunset Williston 2016-05-07 ~06:41 / ~20:12 EDT', () => {
  const st = sunTimes(CASE.date, CASE.lat, CASE.lon, -240);
  const hm = (d) => { const x = new Date(d.getTime() - 240 * 60000); return x.getUTCHours() * 60 + x.getUTCMinutes(); };
  assert.ok(Math.abs(hm(st.sunrise) - (6 * 60 + 41)) <= 2, 'sunrise');
  assert.ok(Math.abs(hm(st.sunset) - (20 * 60 + 12)) <= 2, 'sunset');
});

test('moon on 2016-05-07 is a thin crescent (new moon 2016-05-06 19:30 UTC)', () => {
  const m = lunarPosition(CASE.date, CASE.lat, CASE.lon);
  assert.ok(m.illuminatedFraction < 0.06, `fraction ${m.illuminatedFraction}`);
});

test('sunDirection: world axes (+X east, -Z north, +Y up)', () => {
  const close = (v, w) => v.every((x, i) => Math.abs(x - w[i]) < 1e-9);
  assert.ok(close(sunDirection(90, 0), [1, 0, 0]));
  assert.ok(close(sunDirection(0, 0), [0, 0, -1]));
  assert.ok(close(sunDirection(180, 90).map((x) => Math.round(x * 1e9) / 1e9), [0, 1, 0]));
});

test('environment(): sun light placed from solarPosition, flags per phase', () => {
  const cases = [['06:45', 'day'], ['12:00', 'day'], ['16:36', 'day'], ['19:45', 'day'], ['20:25', 'civil'], ['21:30', 'astronomical']];
  for (const [tod, phase] of cases) {
    const env = environment(THREE, { date: '2016-05-07', timeOfDay: tod, utcOffset: '-04:00', lat: CASE.lat, lon: CASE.lon, weather: 'clear', Sky });
    assert.equal(env.info.phase, phase, tod);
    assert.ok(env.sun.isDirectionalLight && env.hemisphere.isHemisphereLight && env.sky && env.fog);
    const dir = env.sun.position.clone().sub(env.sun.target.position).normalize();
    const exp = new THREE.Vector3(...sunDirection(env.info.sunAzimuth, Math.max(env.info.sunElevation, 0.5)));
    if (env.info.keySource === 'sun') assert.ok(dir.angleTo(exp) < 0.01, `sun dir ${tod}`);
    if (tod === '16:36') { assert.equal(env.info.night, false); assert.equal(env.info.civilTwilight, false); assert.ok(env.sun.castShadow); }
    if (tod === '20:25') { assert.equal(env.info.civilTwilight, true); assert.equal(env.info.night, false); }
    if (tod === '21:30') { assert.equal(env.info.night, true); assert.ok(env.sun.intensity < 0.05); }
    const cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 2000);
    cam.position.set(7.5, 1.6, 6.5); cam.lookAt(-20, 1.6, 0); cam.updateMatrixWorld();
    env.update(cam);
    env.dispose();
  }
  const oc = environment(THREE, { date: CASE.date, lat: CASE.lat, lon: CASE.lon, weather: 'overcast', Sky });
  assert.equal(oc.sun.castShadow, false);
  assert.ok(oc.info.illuminanceLux.global < 40000);
});

// ---- glare on the demo world
const { default: createWorld } = await import('../cases/demo/worlds/world_v2.js');
const world = createWorld(THREE);
const gopts = { date: '2016-05-07T16:36:12.7-04:00', tZero: 10.43, lat: CASE.lat, lon: CASE.lon };

test('Witness B -> veh_A at t=9.9: no glare (sun 45 deg high)', () => {
  const g = glareCheck(world, 'wit_B', 'veh_A', 9.9, gopts);
  console.log('      ' + g.detail);
  assert.equal(g.glareRisk, false);
  assert.ok(g.sunAngleFromSightlineDeg > 30);
});

test('driver of veh_A looking ahead at t=5: sun behind the car, no glare', () => {
  const g = glareCheck(world, 'veh_A', null, 5, gopts);
  console.log('      ' + g.detail);
  assert.equal(g.glareRisk, false);
});

test('synthetic: same geometry at 19:45 looking into the low sun -> glare risk', () => {
  const sp = solarPosition('2016-05-07T19:45:00-04:00', CASE.lat, CASE.lon);
  const d = sunDirection(sp.azimuthDeg, 0);
  const wit = world.witnesses.find((w) => w.id === 'wit_B');
  const aim = [wit.position[0] + d[0] * 100, 1.6, wit.position[2] + d[2] * 100];
  const g = glareCheck(world, 'wit_B', aim, 9.9, { date: '2016-05-07T19:45:00-04:00', lat: CASE.lat, lon: CASE.lon });
  console.log('      ' + g.detail);
  assert.equal(g.glareRisk, true);
});

test('sun below horizon never flags glare', () => {
  const g = glareCheck(world, 'wit_B', 'veh_A', 9.9, { date: '2016-05-07T21:30:00-04:00', lat: CASE.lat, lon: CASE.lon });
  assert.equal(g.glareRisk, false);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
