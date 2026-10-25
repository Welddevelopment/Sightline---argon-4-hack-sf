// Sightline reference world (hand-written). Follows THE WORLD CONTRACT in SPEC.md.
// Generic four-way signalized intersection. No imports: THREE is passed in.
// Axes: +X east, -Z north, Y up, ground y=0, meters, seconds.
export default function createWorld(THREE) {
  const root = new THREE.Group();
  root.name = 'world_root';
  const objects = {};

  // ---------- helpers ----------
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
  function box(w, h, d, color, x = 0, y = 0, z = 0, name) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'number' ? mat(color) : color);
    m.position.set(x, y, z);
    if (name) m.name = name;
    return m;
  }
  function flat(w, d, color, x, z, y = 0.01, name) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(color));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    if (name) m.name = name;
    return m;
  }
  function add(id, node, info) {
    node.name = id;
    root.add(node);
    objects[id] = { node, ...info };
    return node;
  }

  // ---------- lighting (day) ----------
  const hemi = new THREE.HemisphereLight(0xdde8ff, 0x4a4a3a, 0.9);
  hemi.name = 'light_hemi';
  root.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.name = 'light_sun';
  sun.position.set(-40, 80, 30);
  root.add(sun);

  // ---------- ground, roads, markings ----------
  const ROAD_HALF = 3.6;   // two 3.6 m lanes per road
  const LANE = 1.8;        // lane center offset from road centerline
  const ROAD_LEN = 440;    // roads run +-220 m

  root.add(flat(600, 600, 0x6b7a5a, 0, 0, 0, 'ground'));

  const roadNS = new THREE.Group();
  roadNS.add(flat(ROAD_HALF * 2, ROAD_LEN, 0x3a3a3c, 0, 0, 0.02));
  const roadEW = new THREE.Group();
  roadEW.add(flat(ROAD_LEN, ROAD_HALF * 2, 0x3a3a3c, 0, 0, 0.021));
  // double-yellow centerlines (skip through the box), white edge lines
  for (const s of [-1, 1]) {
    const zc = s * (ROAD_HALF + 110);
    roadNS.add(flat(0.12, 220 - ROAD_HALF, 0xf2c200, -0.15, zc, 0.03));
    roadNS.add(flat(0.12, 220 - ROAD_HALF, 0xf2c200, 0.15, zc, 0.03));
    roadEW.add(flat(220 - ROAD_HALF, 0.12, 0xf2c200, zc, -0.15, 0.03));
    roadEW.add(flat(220 - ROAD_HALF, 0.12, 0xf2c200, zc, 0.15, 0.03));
    for (const e of [-1, 1]) {
      roadNS.add(flat(0.15, 220 - ROAD_HALF, 0xffffff, e * (ROAD_HALF - 0.2), zc, 0.03));
      roadEW.add(flat(220 - ROAD_HALF, 0.15, 0xffffff, zc, e * (ROAD_HALF - 0.2), 0.03));
    }
  }
  // stop bars (one per approach, across the inbound lane) and crosswalk stripes
  roadNS.add(flat(ROAD_HALF, 0.4, 0xffffff, LANE, ROAD_HALF + 3.2, 0.035));   // northbound stop bar (south side)
  roadNS.add(flat(ROAD_HALF, 0.4, 0xffffff, -LANE, -ROAD_HALF - 3.2, 0.035)); // southbound stop bar
  roadEW.add(flat(0.4, ROAD_HALF, 0xffffff, -ROAD_HALF - 3.2, LANE, 0.035));  // eastbound stop bar (west side)
  roadEW.add(flat(0.4, ROAD_HALF, 0xffffff, ROAD_HALF + 3.2, -LANE, 0.035));  // westbound stop bar
  for (let i = -3; i <= 3; i++) {
    for (const s of [-1, 1]) {
      roadNS.add(flat(0.5, 2.4, 0xffffff, i * 1.0, s * (ROAD_HALF + 1.6), 0.034));
      roadEW.add(flat(2.4, 0.5, 0xffffff, s * (ROAD_HALF + 1.6), i * 1.0, 0.034));
    }
  }
  add('road_ns', roadNS, { kind: 'road', label: 'Main St (north-south, 2 lanes, 35 mph)', citation: 'Police report p.1', occludes: false });
  add('road_ew', roadEW, { kind: 'road', label: 'Oak Ave (east-west, 2 lanes, 35 mph)', citation: 'Police report p.1', occludes: false });

  // sidewalks (4 m wide) along both roads, non-occluding scenery
  const walks = new THREE.Group();
  walks.name = 'sidewalks';
  for (const s of [-1, 1]) {
    walks.add(box(4, 0.15, ROAD_LEN, 0xb8b4aa, s * (ROAD_HALF + 2), 0.075, 0));
    walks.add(box(ROAD_LEN, 0.15, 4, 0xb8b4aa, 0, 0.074, s * (ROAD_HALF + 2)));
  }
  root.add(walks);

  // corner buildings (set back from the corners)
  const bldColors = [0x8a7f73, 0x9c8f80, 0x7d8590, 0x8c8478];
  [[-1, -1, 10, 'NW'], [1, -1, 9, 'NE'], [-1, 1, 8, 'SW'], [1, 1, 12, 'SE']].forEach(([sx, sz, h, tag], i) => {
    const b = box(24, h, 24, bldColors[i], sx * 23, h / 2, sz * 23);
    add(`bld_${tag.toLowerCase()}`, b, { kind: 'building', label: `${tag} corner building (${h} m)`, citation: 'Exhibit 1 (scene diagram)', occludes: true });
  });

  // ---------- occluders ----------
  // Bus shelter on the SE corner sidewalk: roof + solid advertising panel on its north end.
  const shelter = new THREE.Group();
  shelter.add(box(3.0, 2.6, 1.4, mat(0x2f5d8a), 0, 1.3, 0));          // opaque ad panel + frame (faces north)
  shelter.add(box(3.2, 0.12, 4.0, 0x444444, 0, 2.66, 1.3));             // roof
  shelter.add(box(0.1, 2.6, 0.1, 0x555555, -1.5, 1.3, 3.2));            // rear posts
  shelter.add(box(0.1, 2.6, 0.1, 0x555555, 1.5, 1.3, 3.2));
  shelter.position.set(6.7, 0, 13.7);                                    // static
  add('occ_shelter', shelter, { kind: 'occluder', label: 'Bus shelter with solid ad panel (SE corner)', citation: 'Police report p.3; Exhibit 1', occludes: true });

  // Double-parked delivery truck in the westbound lane east of the intersection, facing west.
  const truck = new THREE.Group();
  truck.add(box(2.5, 3.4, 6.0, 0xeeeeee, 0, 1.9, 0.9));    // box body
  truck.add(box(2.4, 2.4, 1.8, 0xc23b22, 0, 1.4, -3.0));   // cab (forward = local -Z)
  truck.position.set(22, 0, -LANE - 0.3);
  truck.rotation.y = Math.PI / 2;                          // forward faces west (-X)
  add('occ_truck', truck, { kind: 'occluder', label: 'Double-parked delivery truck (westbound lane)', citation: 'Police report p.3', occludes: true });

  // ---------- signals ----------
  function makeSignal(id, x, z, faceRotY, label, citation, phases) {
    const g = new THREE.Group();
    g.add(box(0.25, 4.2, 0.25, 0x333333, 0, 2.1, 0));     // pole (box keeps it simple)
    const head = box(0.45, 1.3, 0.35, 0x111111, 0, 4.85, 0);
    g.add(head);
    const lamps = {};
    [['red', 0xff2020, 0.4], ['yellow', 0xffc000, 0], ['green', 0x20ff40, -0.4]].forEach(([c, col, dy]) => {
      const lm = new THREE.MeshStandardMaterial({ color: 0x202020, emissive: col, emissiveIntensity: 0 });
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.05), lm);
      lamp.position.set(0, 4.85 + dy, 0.2);
      lamp.name = `${id}_${c}`;
      g.add(lamp);
      lamps[c] = lm;
    });
    g.position.set(x, 0, z);
    g.rotation.y = faceRotY;
    const state = (t) => {
      for (const [t0, t1, s] of phases) if (t >= t0 && t < t1) return s;
      return phases[phases.length - 1][2];
    };
    add(id, g, { kind: 'signal', label, citation, occludes: false, state, _lamps: lamps });
  }
  // sig_north: far-side signal on the NE corner, faces south (controls northbound Main St, i.e. veh_A).
  makeSignal('sig_north', 5.4, -6.0, 0, 'Signal for northbound Main St (NE corner)', 'Signal timing sheet p.1',
    [[0, 3, 'green'], [3, 6, 'yellow'], [6, 1e9, 'red']]);
  // sig_west: far-side signal on the SE corner, faces west (controls eastbound Oak Ave, i.e. veh_B).
  makeSignal('sig_west', 6.0, 5.4, -Math.PI / 2, 'Signal for eastbound Oak Ave (SE corner)', 'Signal timing sheet p.1',
    [[0, 7, 'red'], [7, 1e9, 'green']]);

  // ---------- vehicles ----------
  function makeVehicle(id, len, wid, hgt, color, label, citation) {
    const g = new THREE.Group();
    g.add(box(wid, hgt * 0.55, len, color, 0, 0.35 + hgt * 0.275, 0));                     // body
    g.add(box(wid * 0.9, hgt * 0.45, len * 0.4, color, 0, 0.35 + hgt * 0.55 + hgt * 0.225 - 0.05, len * 0.05)); // cabin
    g.add(box(wid * 0.8, 0.15, 0.1, 0xffffcc, 0, 0.7, -len / 2));                          // headlight bar (front = -Z)
    add(id, g, { kind: 'vehicle', label, citation, occludes: true });
    return g;
  }
  makeVehicle('veh_A', 5.3, 1.9, 1.85, 0x2255aa, 'Pickup truck (Vehicle A), northbound Main St', 'Police report p.2');
  makeVehicle('veh_B', 4.6, 1.8, 1.45, 0xbb2222, 'Sedan (Vehicle B), eastbound Oak Ave', 'Police report p.2');

  // ---------- marks ----------
  const SKID = 31;            // m, measured
  const T_IMPACT = 8.0;       // s
  const IMPACT_Z_A = LANE;    // veh_A center z at impact (crossing eastbound lane)
  const skid = new THREE.Group();
  for (const dx of [-0.8, 0.8]) skid.add(flat(0.25, SKID, 0x111111, LANE + dx, IMPACT_Z_A + SKID / 2, 0.04));
  add('mark_skid_A', skid, { kind: 'mark', label: '31 m skid marks, Vehicle A (northbound)', citation: 'Police report p.3', occludes: false });
  const impact = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.02, 20), mat(0xff00ff));
  impact.position.set(LANE - 1.0, 0.045, LANE);
  add('mark_impact', impact, { kind: 'mark', label: 'Area of impact (AOI)', citation: 'Police report p.3', occludes: false });

  // ---------- motion (deterministic, closed-form) ----------
  // veh_A: 24 m/s (53.7 mph) cruise, brakes at mu*g over the last 31 m, hits at t=8 at ~12.3 m/s.
  const G = 9.81, MU = 0.7, DECEL = MU * G;
  const V0A = 24.0;
  const VIA = Math.sqrt(V0A * V0A - 2 * DECEL * SKID);   // impact speed
  const TB = (V0A - VIA) / DECEL;                        // braking duration
  const T_BRAKE = T_IMPACT - TB;
  const S_TOTAL_A = V0A * T_BRAKE + SKID;                // distance travelled to impact
  function distA(t) {                                    // distance from start along northbound path
    if (t <= T_BRAKE) return V0A * t;
    const tt = Math.min(t, T_IMPACT) - T_BRAKE;
    return V0A * T_BRAKE + V0A * tt - 0.5 * DECEL * tt * tt;
  }
  // veh_B: constant 13 m/s (29 mph) eastbound, front bumper reaches veh_A's west side at t=8.
  const V_B = 13.0;
  const B_IMPACT_X = LANE - 1.9 / 2 - 4.6 / 2;           // center x when its nose touches veh_A
  const ease = (u) => 1 - Math.pow(1 - Math.min(Math.max(u, 0), 1), 2);

  function setTime(t) {
    t = Math.min(Math.max(t, 0), duration);
    const A = objects.veh_A.node, B = objects.veh_B.node;
    if (t <= T_IMPACT) {
      A.position.set(LANE, 0, IMPACT_Z_A + (S_TOTAL_A - distA(t)));
      A.rotation.set(0, 0, 0);
      B.position.set(B_IMPACT_X - V_B * (T_IMPACT - t), 0, LANE);
      B.rotation.set(0, -Math.PI / 2, 0);
    } else {                                            // post-impact: slide NE together and rotate
      const u = ease((t - T_IMPACT) / 1.5);
      A.position.set(LANE + 2.5 * u, 0, IMPACT_Z_A - 3.5 * u);
      A.rotation.set(0, -0.6 * u, 0);
      B.position.set(B_IMPACT_X + 3.0 * u, 0, LANE - 1.5 * u);
      B.rotation.set(0, -Math.PI / 2 - 0.3 * u, 0);
    }
    for (const id of ['sig_north', 'sig_west']) {
      const o = objects[id], s = o.state(t);
      for (const c of ['red', 'yellow', 'green']) o._lamps[c].emissiveIntensity = c === s ? 2.0 : 0;
    }
    root.updateMatrixWorld(true);
  }

  // ---------- witnesses (fictional) ----------
  const witnesses = [
    { id: 'wit_A', name: 'Witness A (fictional)', position: [-6.0, 0, 6.5], eyeHeight: 1.65, lookAt: 'veh_A',
      observationTime: 7.0, claim: 'The pickup was going really fast and only braked right before the intersection.',
      citation: 'Deposition 12:03' },
    { id: 'wit_B', name: 'Witness B (fictional)', position: [7.0, 0, 16.5], eyeHeight: 1.6, lookAt: 'sig_north',
      observationTime: 6.5, claim: 'I was at the bus stop and looked up; the light was green for the pickup.',
      citation: 'Deposition 27:14' },
    { id: 'wit_C', name: 'Witness C (fictional)', position: [-7.0, 0, -7.0], eyeHeight: 1.7, lookAt: 'veh_B',
      observationTime: 7.5, claim: 'The red car went through when its light turned green; it was not speeding.',
      citation: 'Deposition 41:50' },
  ];

  const facts = [
    { id: 'f1', text: 'Skid marks from Vehicle A measured 31 m before the area of impact', value: 31, unit: 'm', citation: 'Police report p.3', kind: 'skid' },
    { id: 'f2', text: 'Posted speed limit on Main St and Oak Ave is 35 mph', value: 35, unit: 'mph', citation: 'Police report p.1', kind: 'speed' },
    { id: 'f3', text: 'Collision occurred about 8 s into the reconstructed timeline', value: 8, unit: 's', citation: 'Police report p.2', kind: 'time' },
    { id: 'f4', text: 'Northbound signal: green 0-3 s, yellow 3-6 s, red from 6 s', value: 6, unit: 's', citation: 'Signal timing sheet p.1', kind: 'time' },
    { id: 'f5', text: 'Bus shelter with solid advertising panel on SE corner, ~14 m south of the stop line area', value: 13.7, unit: 'm', citation: 'Police report p.3', kind: 'position' },
    { id: 'f6', text: 'Road surface dry asphalt, friction coefficient ~0.7', value: 0.7, unit: 'mu', citation: 'Police report p.3', kind: 'skid' },
  ];
  const skids = [{ vehicle: 'veh_A', length: SKID, mu: MU, citation: 'Police report p.3' }];

  const duration = 12;
  const world = {
    meta: { caseId: 'generic-001', title: 'Main St & Oak Ave intersection collision (generic reference)', timeOfDay: '14:30', lighting: 'day',
      source: 'Hand-written generic reference world; fictional witnesses' },
    root, duration, setTime, objects, witnesses, facts, skids,
  };
  setTime(0);
  return world;
}
