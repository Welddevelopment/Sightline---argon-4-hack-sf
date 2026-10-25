import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sightline, skidSpeed, speedAt, runAll } from './checks.js';

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
  const res = runAll(makeWorld());
  assert.equal(res.length, 2);
  assert.equal(res[0].check, 'sightline'); assert.equal(res[0].pass, false);
  assert.match(res[0].detail, /blocked by occ_shelter/); assert.match(res[0].detail, /I saw the light was red/);
  assert.match(res[0].detail, /Witness B's marked position \(Depo 27:14\)/);
  assert.equal(res[1].check, 'skid_vs_speed'); assert.equal(res[1].pass, false); // 33.5 mph < 47*0.9
  const w = makeWorld(); w.setTime = (tt) => { w.objects.veh_A.node.position.x = 25 * tt; };
  assert.equal(runAll(w)[1].pass, true); // 56 mph
});
console.log(`${n} tests passed`);
