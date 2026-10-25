// Tests for checks/physics.js on synthetic worlds. Run: node checks/test_physics.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { skidRange, prtCheck, prtAll, plausibilityCheck, impactTimeOf, KINEMATIC_LABEL } from './physics.js';

function box(id, x, y, z, w, h, d) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial()));
  g.children[0].position.y = y;
  g.position.set(x, 0, z); g.name = id; return g;
}
// One car (veh_A) driven by motion(t) -> x position along +X; optional extras.
function oneCar(motion, { duration = 10, meta = {}, facts = [] } = {}) {
  const root = new THREE.Group();
  const car = box('veh_A', 0, 0.7, 0, 1.9, 1.4, 4.8);
  const bld = box('bld_x', 50, 3, -30, 10, 6, 10);   // static: must not be reported
  root.add(car, bld);
  return {
    meta, root, duration, facts, witnesses: [], skids: [],
    setTime(t) { t = Math.min(Math.max(t, 0), duration); car.position.x = motion(t); car.rotation.y = -Math.PI / 2; },
    objects: {
      veh_A: { node: car, kind: 'vehicle', label: 'Sedan (Vehicle A)', citation: 'x', occludes: true },
      bld_x: { node: bld, kind: 'building', label: 'Building', citation: 'x', occludes: true },
    },
  };
}
// Two cars converging on the origin: A eastbound along z=0, B southbound along x=0, both 15 m/s, impact at T.
// Optional wall at the corner that hides B from A until it is removed at wallUntil (s).
function crossing({ T = 8, wallUntil = null, meta = { impactT: 8 }, facts = [] } = {}) {
  const root = new THREE.Group();
  const A = box('veh_A', 0, 0.7, 0, 1.9, 1.4, 4.8);
  const B = box('veh_B', 0, 0.7, 0, 1.9, 1.4, 4.8);
  const wall = box('occ_wall', -12, 2, -12, 16, 4, 16);   // NW corner block
  root.add(A, B, wall);
  const objects = {
    veh_A: { node: A, kind: 'vehicle', label: 'Sedan (Vehicle A)', citation: 'x', occludes: true },
    veh_B: { node: B, kind: 'vehicle', label: 'Sedan (Vehicle B)', citation: 'x', occludes: true },
  };
  if (wallUntil !== null) objects.occ_wall = { node: wall, kind: 'occluder', label: 'Wall', citation: 'x', occludes: true };
  else wall.visible = false;
  return {
    meta, root, duration: 10, facts, witnesses: [], skids: [], objects,
    setTime(t) {
      t = Math.min(Math.max(t, 0), 10); const tc = Math.min(t, T);
      A.position.set(-15 * (T - tc) - 2.4, 0, 0); A.rotation.y = -Math.PI / 2;
      B.position.set(0, 0, -15 * (T - tc) - 2.4); B.rotation.y = Math.PI;
      if (wallUntil !== null) wall.visible = t < wallUntil;
    },
  };
}

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('KINEMATIC_LABEL is the shared string', () => {
  assert.equal(KINEMATIC_LABEL, 'Kinematic reconstruction: motion fitted to cited evidence; not a crash-physics simulation.');
});

t('skidRange(31 m) uses mu 0.6-0.8', () => {
  const r = skidRange(31);
  assert.deepEqual(r.mu, [0.6, 0.8]);
  assert.ok(Math.abs(r.mps[0] - Math.sqrt(2 * 0.6 * 9.81 * 31)) < 1e-9);
  assert.ok(Math.abs(r.mps[1] - Math.sqrt(2 * 0.8 * 9.81 * 31)) < 1e-9);
  assert.ok(r.mph[0] > 42.6 && r.mph[0] < 42.8, r.mph[0]);
  assert.ok(r.mph[1] > 49.2 && r.mph[1] < 49.4, r.mph[1]);
  assert.ok(r.mps[0] < r.mps[1]);
});

t('constant-speed car passes plausibility; static objects are skipped', () => {
  const res = plausibilityCheck(oneCar((t) => 20 * t - 100));
  assert.equal(res.length, 1);
  const r = res[0];
  assert.equal(r.check, 'plausibility');
  assert.equal(r.subject, 'veh_A');
  assert.equal(r.pass, true, r.detail);
  assert.deepEqual(r.issues, []);
  assert.ok(Math.abs(r.maxSpeedMph - 44.7) < 0.2, r.maxSpeedMph);
  assert.ok(r.maxAccelG < 0.01);
  assert.equal(typeof r.detail, 'string');
});

t('teleport fails with a jump issue', () => {
  const r = plausibilityCheck(oneCar((t) => 10 * t + (t >= 4 ? 30 : 0)))[0];
  assert.equal(r.pass, false);
  assert.ok(r.issues.some((s) => /jumps/.test(s)), r.issues.join('; '));
});

t('2 g braking fails (impact elsewhere on the timeline)', () => {
  const a = 2 * 9.81, v0 = 30, tb = 2, ts = v0 / a;   // brakes from t=2 to t=3.53
  const x = (t) => (t < tb ? v0 * t : t < tb + ts ? v0 * tb + v0 * (t - tb) - 0.5 * a * (t - tb) ** 2 : v0 * tb + v0 * v0 / (2 * a));
  const r = plausibilityCheck(oneCar(x, { meta: { impactT: 9 } }))[0];
  assert.equal(r.pass, false);
  assert.ok(r.maxAccelG > 1.8 && r.maxAccelG < 2.6, r.maxAccelG);
  assert.ok(r.issues.some((s) => /acceleration/.test(s)));
});

t('2 g braking also fails with no impact time (max-decel window only excuses +-0.5 s)', () => {
  const a = 2 * 9.81, v0 = 30, tb = 2, ts = v0 / a;
  const x = (t) => (t < tb ? v0 * t : t < tb + ts ? v0 * tb + v0 * (t - tb) - 0.5 * a * (t - tb) ** 2 : v0 * tb + v0 * v0 / (2 * a));
  assert.equal(plausibilityCheck(oneCar(x))[0].pass, false);
});

t('0.7 g braking passes', () => {
  const a = 0.7 * 9.81, v0 = 25, tb = 2, ts = v0 / a;
  const x = (t) => (t < tb ? v0 * t : t < tb + ts ? v0 * tb + v0 * (t - tb) - 0.5 * a * (t - tb) ** 2 : v0 * tb + v0 * v0 / (2 * a));
  const r = plausibilityCheck(oneCar(x, { meta: { impactT: 9 } }))[0];
  assert.equal(r.pass, true, r.detail);
});

t('abrupt stop at the stated impact time is excused', () => {
  const r = plausibilityCheck(oneCar((t) => 20 * Math.min(t, 6), { facts: [{ id: 'f_impact_t', text: 'Impact at t=6 s', value: 6, unit: 's', kind: 'time', citation: 'x' }] }))[0];
  assert.equal(r.pass, true, r.detail);
  assert.ok(r.impactAccelG > 1);
});

t('speed over 60 m/s fails', () => {
  const r = plausibilityCheck(oneCar((t) => 70 * t))[0];
  assert.equal(r.pass, false);
  assert.ok(r.issues.some((s) => /exceeds 60 m\/s/.test(s)));
});

t('impactTimeOf reads meta, then impact facts, and ignores sight-time facts', () => {
  assert.equal(impactTimeOf({ meta: { impactT: 3 }, facts: [] }).t, 3);
  assert.equal(impactTimeOf({ meta: {}, duration: 20, facts: [{ id: 'f_impact_t', text: 'Impact at t=10.43 s', value: 10.43, unit: 's' }] }).t, 10.43);
  assert.equal(impactTimeOf({ meta: {}, duration: 20, facts: [{ id: 'f_sight', text: 'up to 10.4 s of sight time from crest to impact', value: 10.4, unit: 's' }] }), null);
});

t('PRT: clear view the whole way is sufficient (lower bound at timeline start)', () => {
  const r = prtCheck(crossing(), { observerId: 'veh_A', targetId: 'veh_B', impactT: 8 });
  assert.equal(r.verdict, 'sufficient', r.detail);
  assert.equal(r.method, 'sightline');
  assert.ok(Math.abs(r.availableS - 8) < 0.06, r.availableS);
  assert.equal(r.cappedAtStart, true);
  assert.deepEqual(r.rangeS, [1.0, 2.5]);
  assert.equal(r.typicalS, 1.5);
  assert.ok(!/could see/i.test(r.detail));
});

t('PRT: view opens 0.6 s before impact is insufficient', () => {
  const r = prtCheck(crossing({ wallUntil: 7.4 }), { observerId: 'veh_A', targetId: 'veh_B', impactT: 8 });
  assert.equal(r.verdict, 'insufficient', r.detail);
  assert.ok(r.availableS >= 0.5 && r.availableS <= 0.65, r.availableS);
  assert.equal(r.blockedBy, 'occ_wall');
});

t('PRT: view opens 2 s before impact is marginal', () => {
  const r = prtCheck(crossing({ wallUntil: 6 }), { observerId: 'veh_A', targetId: 'veh_B', impactT: 8 });
  assert.equal(r.verdict, 'marginal', r.detail);
  assert.ok(Math.abs(r.availableS - 2) < 0.06, r.availableS);
});

t('PRT: missing impact time or target is unverifiable', () => {
  assert.equal(prtCheck(crossing(), { observerId: 'veh_A', targetId: 'veh_B' }).verdict, 'unverifiable');
  assert.equal(prtCheck(crossing(), { observerId: 'veh_A', targetId: 'veh_Z', impactT: 8 }).verdict, 'unverifiable');
  assert.equal(prtCheck(crossing(), {}).verdict, 'unverifiable');
});

t('prtAll pairs each driver with the other vehicle, using meta impact', () => {
  const rs = prtAll(crossing({ wallUntil: 6 }));
  assert.equal(rs.length, 2);
  assert.deepEqual(rs.map((r) => `${r.observerId}>${r.targetId}`).sort(), ['veh_A>veh_B', 'veh_B>veh_A']);
  for (const r of rs) { assert.equal(r.impactT, 8); assert.equal(r.verdict, 'marginal', r.detail); }
});

t('prtAll without an impact time estimates it from first contact', () => {
  const rs = prtAll(crossing({ meta: {} }));
  assert.equal(rs.length, 2);
  for (const r of rs) { assert.ok(r.impactT > 7.5 && r.impactT <= 8, r.impactT); assert.match(r.impactSource, /contact/); }
});

console.log(`${n} tests passed`);
