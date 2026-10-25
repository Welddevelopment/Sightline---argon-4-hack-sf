import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sightline, skidSpeed, speedAt, runAll, KINEMATIC_LABEL } from './checks.js';
import { sightlineRobustness, gazeAngle, robustnessOffsets } from './robustness.js';

function box(id, x, y, z, w, h, d) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
  m.position.set(x, y, z); m.name = id; return m;
}
function makeWorld() {
  const root = new THREE.Group();
  const sig = box('sig_north', 20, 2, 0, 0.3, 4, 0.3);
  const occ = box('occ_shelter', 10, 1.5, 0, 0.5, 3, 4);
  const veh = box('veh_A', 0, 0.75, 5, 4, 1.5, 2);
  root.add(sig, occ, veh);
  return {
    meta: {}, root, duration: 10,
    setTime(t) { veh.position.x = 15 * t; }, // 15 m/s
    objects: {
      sig_north: { node: sig, kind: 'signal', label: 'Signal', citation: 'x', occludes: false },
      occ_shelter: { node: occ, kind: 'occluder', label: 'Shelter', citation: 'x', occludes: true },
      veh_A: { node: veh, kind: 'vehicle', label: 'Truck A', citation: 'x', occludes: true },
    },
    witnesses: [{ id: 'wit_B', name: 'Witness B (fictional)', position: [0, 0, 0], eyeHeight: 1.6, lookAt: 'sig_north', observationTime: 6.5, claim: 'I saw the light was red', citation: 'Depo 27:14' }],
    facts: [], skids: [{ vehicle: 'veh_A', length: 31, mu: 0.7, startTime: 2, citation: 'Police report p.3' }],
  };
}
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('box between witness and signal blocks', () => {
  const w = makeWorld();
  const r = sightline(w, 'wit_B', 'sig_north', 0);
  assert.equal(r.visible, false); assert.equal(r.blockedBy, 'occ_shelter');
  assert.ok(Math.abs(r.hitPoint[0] - 9.75) < 0.01); assert.ok(r.distance > 19);
});
t('removing the box makes it visible', () => {
  const w = makeWorld(); w.root.remove(w.objects.occ_shelter.node); delete w.objects.occ_shelter;
  const r = sightline(w, 'wit_B', 'sig_north', 0);
  assert.equal(r.visible, true); assert.equal(r.blockedBy, null);
});
t('occludes:false does not block', () => {
  const w = makeWorld(); w.objects.occ_shelter.occludes = false;
  assert.equal(sightline(w, 'wit_B', 'sig_north', 0).visible, true);
});
t('moving vehicle occludes only when in line (time dependent)', () => {
  const w = makeWorld(); w.objects.occ_shelter.occludes = false;
  w.witnesses[0].position = [-5, 0, 5]; w.witnesses[0].eyeHeight = 0.5; // low eye so the ray goes through the truck
  w.objects.sig_north.node.position.set(20, 2, 5);
  assert.equal(sightline(w, 'wit_B', 'sig_north', 0.1).visible, false); // veh at x=1.5 right in front
  assert.equal(sightline(w, 'wit_B', 'sig_north', 6).visible, true);    // veh at x=90, past signal
});
t('skid 31 m -> ~46 mph (mu 0.7)', () => {
  const s = skidSpeed(31); assert.ok(Math.abs(s.mph - 46.16) < 0.1, String(s.mph)); assert.ok(Math.abs(s.mps - 20.63) < 0.05);
});
t('speedAt finite difference', () => {
  const s = speedAt(makeWorld(), 'veh_A', 3); assert.ok(Math.abs(s.mps - 15) < 0.01);
  assert.ok(Math.abs(s.mph - 33.55) < 0.05);
});
t('runAll reports sightline + skid', () => {
  const all = runAll(makeWorld());
  const res = all.filter((r) => r.check === 'sightline' || r.check === 'skid_vs_speed');
  assert.equal(res.length, 2);
  assert.equal(res[0].check, 'sightline'); assert.equal(res[0].pass, false);
  assert.match(res[0].detail, /blocked by occ_shelter/); assert.match(res[0].detail, /I saw the light was red/);
  assert.match(res[0].detail, /Witness B's marked position \(Depo 27:14\)/);
  assert.equal(res[1].check, 'skid_vs_speed'); assert.equal(res[1].pass, false); // 33.5 mph < 47*0.9
  const w = makeWorld(); w.setTime = (tt) => { w.objects.veh_A.node.position.x = 25 * tt; };
  assert.equal(runAll(w).find((r) => r.check === 'skid_vs_speed').pass, true); // 56 mph
});

// ---------- CREDIBILITY v1: robustness + gaze ----------
t('robustness offsets: 25 deterministic points in a 2 m disc, eye +/-0.1 alternating', () => {
  const a = robustnessOffsets(), b = robustnessOffsets();
  assert.equal(a.length, 25); assert.deepEqual(a, b);
  assert.deepEqual([a[0].dx, a[0].dz], [0, 0]);
  for (const o of a) assert.ok(Math.hypot(o.dx, o.dz) <= 2 + 1e-9);
  assert.ok(a.some((o) => Math.abs(Math.hypot(o.dx, o.dz) - 2) < 1e-9));
  a.forEach((o, i) => assert.equal(o.dy, i % 2 === 0 ? 0.1 : -0.1));
});
t('robustness: wide occluder blocks from all 25 positions -> robust', () => {
  const w = makeWorld(); // shelter is 4 m deep (z) at x=10, signal at x=20
  w.objects.occ_shelter.node.scale.set(1, 1, 3); // 12 m wide: covers the whole 2 m disc's rays
  const r = sightlineRobustness(w, 'wit_B', 'sig_north', 0);
  assert.equal(r.samples, 25); assert.equal(r.radiusM, 2); assert.equal(r.eyeJitterM, 0.1);
  assert.equal(r.blocked, 25); assert.equal(r.clear, 0); assert.equal(r.verdict, 'robust');
});
t('robustness: no occluder -> not_blocked', () => {
  const w = makeWorld(); w.objects.occ_shelter.occludes = false;
  const r = sightlineRobustness(w, 'wit_B', 'sig_north', 0);
  assert.equal(r.blocked, 0); assert.equal(r.clear, 25); assert.equal(r.verdict, 'not_blocked');
});
t('robustness: narrow pole blocks only some positions -> partial', () => {
  const w = makeWorld();
  w.objects.occ_shelter.node.scale.set(1, 1, 0.1); // 0.4 m wide
  const r = sightlineRobustness(w, 'wit_B', 'sig_north', 0);
  assert.equal(r.verdict, 'partial'); assert.ok(r.blocked > 0 && r.blocked < 25, String(r.blocked));
  assert.equal(r.blocked + r.clear, 25);
});
t('gaze: explicit lookAt point 90 deg off the target -> peripheral, not assumed', () => {
  const w = makeWorld();
  w.witnesses[0].lookAt = [0, 1.6, -10];       // looking north
  const g = gazeAngle(w, 'wit_B', 'sig_north', 0); // signal top due east (slightly above eye)
  assert.equal(g.assumed, false); assert.equal(g.cameraFovDeg, 60); assert.equal(g.peripheral, true);
  assert.ok(Math.abs(g.offAxisDeg - 90) < 0.5, String(g.offAxisDeg));
});
t('gaze: heading (rotation.y convention) facing east -> small angle to signal', () => {
  const w = makeWorld(); w.witnesses[0].heading = -Math.PI / 2; // CCW from north toward west; -90deg = east
  const g = gazeAngle(w, 'wit_B', 'sig_north', 0);
  assert.equal(g.assumed, false); assert.equal(g.peripheral, false);
  assert.ok(g.offAxisDeg < 10, String(g.offAxisDeg));
});
t('gaze: lookAt == target and no impact mark -> assumed toward target at t=0', () => {
  const w = makeWorld(); w.objects.occ_shelter.occludes = false;
  w.witnesses[0].lookAt = 'veh_A';
  const g0 = gazeAngle(w, 'wit_B', 'veh_A', 0);
  assert.equal(g0.assumed, true); assert.equal(g0.offAxisDeg, 0);
  const g = gazeAngle(w, 'wit_B', 'veh_A', 2); // truck moved from (0,_,5) to (30,_,5)
  assert.equal(g.assumed, true); assert.ok(g.offAxisDeg > 60 && g.offAxisDeg < 85, String(g.offAxisDeg));
  assert.equal(g.peripheral, true);
});
t('gaze: lookAt == target with an impact mark -> assumed toward impact mark', () => {
  const w = makeWorld();
  const poi = box('mark_impact', 20, 0.05, 5, 0.5, 0.1, 0.5); w.root.add(poi);
  w.objects.mark_impact = { node: poi, kind: 'mark', label: 'Point of impact', citation: 'x', occludes: false };
  w.witnesses[0].lookAt = 'veh_A';
  const g = gazeAngle(w, 'wit_B', 'veh_A', 1); // truck at (15,_,5), impact at (20,_,5)
  assert.equal(g.assumed, true); assert.equal(g.source, 'mark_impact');
  assert.ok(g.offAxisDeg > 0 && g.offAxisDeg < 15, String(g.offAxisDeg));
});
t('runAll sightline carries robustness + gaze and SPEC wording', () => {
  const blocked = runAll(makeWorld()).find((r) => r.check === 'sightline');
  assert.equal(blocked.robustness.samples, 25); assert.ok(typeof blocked.gaze.offAxisDeg === 'number');
  assert.match(blocked.detail, /Blocked from \d+ of 25 positions within 2 m of Witness B's mark/);
  const w = makeWorld(); w.objects.occ_shelter.occludes = false; w.witnesses[0].lookAt = 'sig_north';
  const clear = runAll(w).find((r) => r.check === 'sightline');
  assert.equal(clear.pass, true);
  assert.match(clear.detail, /had line of sight to sig_north at t=6.5s \(distance [\d.]+ m\); target \d+° from gaze/);
  assert.match(clear.detail, /Clear from all 25 positions within 2 m/);
  assert.doesNotMatch(clear.detail + blocked.detail, /could see/i);
  const p = makeWorld(); p.objects.occ_shelter.node.scale.set(1, 1, 0.1);
  const partial = runAll(p).find((r) => r.check === 'sightline');
  assert.equal(partial.robustness.verdict, 'partial');
  assert.match(partial.detail, /depends on Witness B's exact position/);
  const per = makeWorld(); per.objects.occ_shelter.occludes = false; per.witnesses[0].heading = 0; // facing north
  assert.match(runAll(per).find((r) => r.check === 'sightline').detail, /from gaze \(peripheral\)/);
});
t('KINEMATIC_LABEL re-exported', () => {
  assert.equal(KINEMATIC_LABEL, 'Kinematic reconstruction: motion fitted to cited evidence; not a crash-physics simulation.');
});
t('skid result carries friction range', () => {
  const s = runAll(makeWorld()).find((r) => r.check === 'skid_vs_speed');
  assert.deepEqual(s.range.mu, [0.6, 0.8]); assert.ok(s.range.mph[0] < s.requiredMph && s.requiredMph < s.range.mph[1]);
});
t('runAll appends plausibility + timing (prt) results', () => {
  const w = makeWorld();
  const car = box('veh_B', 40, 0.75, -20, 2, 1.5, 4); w.root.add(car);
  w.objects.veh_B = { node: car, kind: 'vehicle', label: 'Car (Vehicle B)', citation: 'x', occludes: true };
  const st = w.setTime; w.setTime = (tt) => { st(tt); car.position.z = -20 + 3 * tt; };
  const res = runAll(w);
  const pl = res.filter((r) => r.check === 'plausibility');
  assert.ok(pl.some((r) => r.subject === 'veh_A'));
  for (const r of pl) { assert.equal(typeof r.pass, 'boolean'); assert.ok(Array.isArray(r.issues)); }
  const tm = res.filter((r) => r.check === 'timing');
  assert.ok(tm.length >= 1);
  for (const r of tm) { assert.deepEqual(r.prt.rangeS, [1.0, 2.5]); assert.equal(r.prt.typicalS, 1.5); assert.equal(typeof r.pass, 'boolean'); }
});
console.log(`${n} tests passed`);
