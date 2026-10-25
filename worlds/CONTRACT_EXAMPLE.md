# World module pattern (follow exactly)

Output ONE ES module. No `import` statements. THREE is passed in. Meters, seconds. Y up, ground y=0, +X east, -Z north.
Every object: `node.name = id`, a `citation` string pointing at real case evidence, `occludes` boolean.
Id prefixes: `veh_ occ_ sig_ road_ mark_ bld_`. Witness ids `wit_`. Dynamic objects are positioned ONLY inside `setTime(t)`; it must be deterministic (closed-form in t, no accumulated state).
Use Box/Plane/Cylinder geometry only. Vehicle "front" = local -Z. Opaque occluders must be solid meshes (raycasts hit them).

```js
export default function createWorld(THREE) {
  const root = new THREE.Group();
  const objects = {};
  const M = (c) => new THREE.MeshStandardMaterial({ color: c });
  const box = (w, h, d, c, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(c)); m.position.set(x, y, z); return m; };
  const flat = (w, d, c, x, z, y = 0.02) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), M(c)); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); return m; };
  const add = (id, node, info) => { node.name = id; root.add(node); objects[id] = { node, ...info }; return node; };

  // Lighting must match meta.lighting (dawn: low warm sun, dim hemi; night: dark hemi + street lights).
  root.add(new THREE.HemisphereLight(0xdde8ff, 0x444433, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(-40, 80, 30); root.add(sun);

  // Static scenery: roads (2 lanes x 3.6 m), markings, buildings. Placed once, never moved.
  const ns = new THREE.Group(); ns.add(flat(7.2, 400, 0x3a3a3c, 0, 0)); ns.add(flat(0.15, 400, 0xf2c200, 0, 0, 0.03));
  add('road_ns', ns, { kind: 'road', label: 'Main St (N-S)', citation: 'Police report p.1', occludes: false });
  const ew = new THREE.Group(); ew.add(flat(400, 7.2, 0x3a3a3c, 0, 0, 0.021)); ew.add(flat(400, 0.15, 0xf2c200, 0, 0, 0.031));
  add('road_ew', ew, { kind: 'road', label: 'Oak Ave (E-W)', citation: 'Police report p.1', occludes: false });

  // Occluder: the thing that can block a witness. Position it from the diagram/report, cite it.
  const shelter = new THREE.Group(); shelter.add(box(3.0, 2.6, 1.4, 0x2f5d8a, 0, 1.3, 0)); shelter.position.set(6.7, 0, 13.7);
  add('occ_shelter', shelter, { kind: 'occluder', label: 'Bus shelter, solid ad panel (SE corner)', citation: 'Police report p.3', occludes: true });

  // Signal: needs state(t). Light the lamp inside setTime.
  const sig = new THREE.Group(); sig.add(box(0.25, 4.2, 0.25, 0x333333, 0, 2.1, 0)); sig.add(box(0.45, 1.3, 0.35, 0x111111, 0, 4.85, 0));
  const lamp = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xff0000, emissiveIntensity: 0 });
  const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.05), lamp); bulb.position.set(0, 4.85, 0.2); sig.add(bulb);
  sig.position.set(5.4, 0, -6.0);
  add('sig_north', sig, { kind: 'signal', label: 'Signal for northbound traffic', citation: 'Signal timing sheet p.1', occludes: false,
    state: (t) => (t < 3 ? 'green' : t < 6 ? 'yellow' : 'red') });

  // Vehicles (occlude = true). Real dimensions from the report.
  const A = new THREE.Group(); A.add(box(1.9, 1.6, 5.3, 0x2255aa, 0, 0.9, 0));
  add('veh_A', A, { kind: 'vehicle', label: 'Pickup (Vehicle A), northbound', citation: 'Police report p.2', occludes: true });
  const B = new THREE.Group(); B.add(box(1.8, 1.3, 4.6, 0xbb2222, 0, 0.75, 0));
  add('veh_B', B, { kind: 'vehicle', label: 'Sedan (Vehicle B), eastbound', citation: 'Police report p.2', occludes: true });

  // Skid marks end at the impact point; length must equal the measured value.
  const skid = new THREE.Group(); skid.add(flat(0.25, 31, 0x111111, 1.0, 1.8 + 15.5, 0.04)); skid.add(flat(0.25, 31, 0x111111, 2.6, 1.8 + 15.5, 0.04));
  add('mark_skid_A', skid, { kind: 'mark', label: '31 m skid, Vehicle A', citation: 'Police report p.3', occludes: false });

  // Motion: closed-form. Speeds must agree with skids (v >= sqrt(2*mu*g*d)) and the impact time.
  const T_IMPACT = 8, V0 = 24, DEC = 0.7 * 9.81, VI = Math.sqrt(V0 * V0 - 2 * DEC * 31), TB = T_IMPACT - (V0 - VI) / DEC;
  const sA = (t) => (t <= TB ? V0 * t : V0 * TB + V0 * (t - TB) - 0.5 * DEC * (t - TB) ** 2);
  const duration = 12;
  function setTime(t) {
    t = Math.min(Math.max(t, 0), duration);
    const tc = Math.min(t, T_IMPACT);                                   // freeze (or animate post-impact) after T_IMPACT
    A.position.set(1.8, 0, 1.8 + (sA(T_IMPACT) - sA(tc))); A.rotation.set(0, 0, 0);          // heading north = rot 0
    B.position.set(-1.4 - 13 * (T_IMPACT - tc), 0, 1.8); B.rotation.set(0, -Math.PI / 2, 0); // heading east
    const s = objects.sig_north.state(t); lamp.emissive.set(s === 'red' ? 0xff2020 : s === 'yellow' ? 0xffc000 : 0x20ff40); lamp.emissiveIntensity = s === 'off' ? 0 : 2;
    root.updateMatrixWorld(true);
  }

  // Witnesses: position = where they marked themselves (map exhibit / video), lookAt = object id or [x,y,z].
  const witnesses = [
    { id: 'wit_B', name: 'Witness B (fictional)', position: [7.0, 0, 16.5], eyeHeight: 1.6, lookAt: 'sig_north',
      observationTime: 6.5, claim: 'The light was green for the pickup.', citation: 'Deposition 27:14' },
  ];
  const facts = [{ id: 'f1', text: 'Skid marks 31 m before impact', value: 31, unit: 'm', citation: 'Police report p.3', kind: 'skid' }];
  const skids = [{ vehicle: 'veh_A', length: 31, mu: 0.7, citation: 'Police report p.3' }];

  const world = { meta: { caseId: 'example', title: 'Main St & Oak Ave', timeOfDay: '14:30', lighting: 'day', source: 'facts + fictional witnesses' },
    root, duration, setTime, objects, witnesses, facts, skids };
  setTime(0);
  return world;
}
```

Keyframed alternative (use when the case gives keyframes `[t, x, z, heading_deg]`, heading is compass: 0=north(-Z), 90=east(+X)):
```js
const KA = [[0, -347.5, 0, 90], [10.43, 0, 0, 90], [22, 276.6, 23.9, 0]];   // vehicle CENTER keyframes
function sample(K, t) { if (t <= K[0][0]) return K[0]; const L = K[K.length - 1]; if (t >= L[0]) return L;
  let i = 0; while (K[i + 1][0] < t) i++; const a = K[i], b = K[i + 1], u = (t - a[0]) / (b[0] - a[0]);
  return [t, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u]; }
// in setTime: const s = sample(KA, t); A.position.set(s[1], 0, s[2]); A.rotation.set(0, -s[3] * Math.PI / 180, 0);
```
Articulated trucks: make the tractor and trailer two separate objects (`veh_T_tractor`, `veh_T_trailer`), each with its own keyframes; give the trailer box its real bed height (e.g. 1.2 m to 4.11 m) so cars can be seen under it.

Checklist before returning: no imports; every id in `objects` has node.name === id and a citation; every witness has position, eyeHeight, lookAt, observationTime, claim, citation; vehicles actually meet at the stated impact time; signal `state(t)` returns only `red|yellow|green|off`.
