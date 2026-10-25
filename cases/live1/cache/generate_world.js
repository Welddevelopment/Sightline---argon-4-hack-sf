```js
/**
 * Case ID: live1 (NTSB/HAR-17/02, HWY16FH018 — US-27A at NE 140th Court, Williston, FL, May 7, 2016)
 * Title: US-27A & NE 140th Court — Tractor-Semitrailer Left Turn / Eastbound Sedan Underride
 *
 * Coordinate Frame & Origin:
 * - Origin (0, 0, 0): Initial point of impact (POI / AOI), in the center of the eastbound outside (right)
 *   lane of US-27A on the centerline of NE 140th Court (text/facts.txt modeling assumptions; text/police_report.txt p.3; evidence/map.png).
 * - Axes: +X = east (toward Williston), -X = west (toward Bronson), -Z = north, +Z = south (down NE 140th Ct), +Y = up, ground y = 0.
 * - The 109 deg intersection skew is straightened to 90 deg per Exhibit 4 (evidence/map.png) and text/facts.txt.
 *
 * Key Evidence -> Geometry & Kinematics Decisions:
 * - Roadway cross-section (text/facts.txt F6-F8; text/police_report.txt p.3; evidence/map.png):
 *   - EB lanes: two 12-ft (3.66 m) lanes; outside lane centered at z = 0 (z = -1.83 to +1.83 m), inside lane centered at z = -3.66 m (z = -5.49 to -1.83 m).
 *   - EB shoulders: 5-ft (1.52 m) paved right shoulder (z = +1.83 to +3.35 m), 2-ft (0.61 m) left shoulder (z = -6.10 to -5.49 m).
 *   - Grass median: ~60 ft (18.29 m) wide; total median + left-turn lane + shoulders = 78 ft (23.77 m) between EB and WB through lanes (z = -5.49 to -29.26 m).
 *   - Median crossover at NE 140th Ct: 130 ft (39.62 m) long (x = -19.81 to +19.81 m).
 *   - WB left-turn lane: 12 ft (3.66 m) wide, 550 ft (167.6 m) long, centered at z = -27.43 m (z = -29.26 to -25.60 m).
 *   - WB through lanes: two 12-ft (3.66 m) lanes; inside lane centered at z = -31.09 m, outside lane centered at z = -34.75 m, 5-ft north shoulder.
 *   - NE 140th Court: 6.1 m wide paved side road running south (+Z) from US-27A along x = 0 (text/facts.txt F11, modeling assumptions; evidence/map.png).
 * - Vehicles (text/facts.txt F14-F16, modeling assumptions; text/police_report.txt p.1):
 *   - Vehicle A (veh_A): 2015 4-door sedan, 4.97 m x 1.96 m x 1.445 m, hood trailing edge ~0.91 m (3 ft) high.
 *   - Vehicle T (veh_T_tractor + veh_T_trailer): 2014 tractor (6.6 m x 2.59 m x 4.0 m) pulling 2003 53-ft (16.15 m) white refrigerated semitrailer
 *     (width 2.59 m, box 1.20 m to 4.11 m above ground so cars can pass/be seen beneath the 1.20 m bed; total combination length 71 ft 7 in = 21.82 m).
 * - Timeline & Motion (text/facts.txt F10, F16-F26, F28, modeling assumptions):
 *   - t = 0.0 s: Vehicle A crests the vertical rise 1,132 ft (345 m) west of POI (center x = -347.5 m) at 74 mph (33.08 m/s) on cruise control, no braking.
 *   - t = 10.43 s: Impact at (0, 0, 0). Impact on trailer is 45 ft 5 in (13.84 m) behind tractor front (tractor front at z = +13.84 m, tractor center at z = +10.54 m, trailer center at z = +0.10 m stretched across both EB lanes).
 *   - t = 18.83 s: Vehicle A strikes and breaks utility pole on south roadside (8.4 s post-impact, text/facts.txt F26).
 *   - t = 22.0 s: Vehicle A comes to rest 910 ft (277 m) from POI at (276.6, 0, 23.9) facing north (0 deg); Vehicle T stops on NE 140th Ct south of the retail store (z ~ 34 m, Depo 26:38).
 * - Witnesses:
 *   - Witness A (wit_A): Westbound driver in outside lane (z = -34.75 m) ~0.25 mi behind truck at 60 mph; saw Vehicle A crest the hill before truck turned (text/witness_A.txt p.1; text/facts.txt F30).
 *   - Witness B (wit_B): Pedestrian at SE corner store; marked Exhibit 4 at [5.5, 0, 6.2] near bench shelter (Depo 27:05, evidence/deposition.mp4 27:05); claims clear view of Vehicle A in the last second before impact (Depo 27:46), which is physically occluded by veh_T_trailer.
 *   - Witness C (wit_C): Stopped pickup driver in WB inside lane 18 m west of crossover [-18.0, 0, -31.09], watching truck turn across EB lanes (text/witness_C.txt p.1).
 */

export default function createWorld(THREE) {
  const root = new THREE.Group();
  const objects = {};

  const M = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.1, ...opts });
  const box = (w, h, d, c, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof c === 'number' ? M(c) : c);
    m.position.set(x, y, z);
    return m;
  };
  const cyl = (rt, rb, h, c, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 16), typeof c === 'number' ? M(c) : c);
    m.position.set(x, y, z);
    return m;
  };
  const flat = (w, d, c, x = 0, z = 0, y = 0.02) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), typeof c === 'number' ? M(c) : c);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    return m;
  };
  const add = (id, node, info) => {
    node.name = id;
    root.add(node);
    objects[id] = { node, ...info };
    return node;
  };

  // Lighting: Clear sunny afternoon at 16:36 EDT, sun high in the western sky behind eastbound traffic (text/facts.txt F1-F3; Depo 10:01)
  root.add(new THREE.HemisphereLight(0xdff0ff, 0x6b705c, 0.95));
  const sun = new THREE.DirectionalLight(0xfff7e6, 1.45);
  sun.position.set(-120, 160, 40);
  root.add(sun);

  // Ground plane
  const ground = flat(1200, 500, 0xc8c3b0, 0, 0, -0.01);
  ground.name = 'ground_base';
  root.add(ground);

  // --- ROADWAYS ---
  // 1. US-27A Eastbound (2 x 3.66 m lanes, 1.52 m right shoulder, 0.61 m left shoulder)
  const roadEB = new THREE.Group();
  // Asphalt: z from -6.10 to +3.35 (width 9.45 m, center z = -1.375)
  roadEB.add(flat(1000, 9.45, 0x3b3c3e, 0, -1.375, 0.01));
  // Yellow north edge line (z = -5.49)
  roadEB.add(flat(460.38, 0.15, 0xe8b800, -249.81, -5.49, 0.025));
  roadEB.add(flat(460.38, 0.15, 0xe8b800, 249.81, -5.49, 0.025));
  // White south edge line (z = +1.83)
  roadEB.add(flat(496.95, 0.15, 0xf2f2f2, -251.53, 1.83, 0.025));
  roadEB.add(flat(496.95, 0.15, 0xf2f2f2, 251.53, 1.83, 0.025));
  // Dashed white lane divider between EB inside and outside lanes (z = -1.83)
  for (let x = -450; x <= 450; x += 12) {
    roadEB.add(flat(3.0, 0.15, 0xf2f2f2, x, -1.83, 0.025));
  }
  add('road_eb', roadEB, {
    kind: 'road',
    label: 'US-27A Eastbound (2 through lanes + shoulders)',
    citation: 'text/facts.txt F6; text/police_report.txt p.3; evidence/map.png',
    occludes: false,
  });

  // 2. US-27A Westbound (2 x 3.66 m through lanes + 3.66 m left-turn lane + shoulders)
  const roadWB = new THREE.Group();
  // Main WB asphalt: z from -38.10 to -29.26 (width 8.84 m, center z = -33.68)
  roadWB.add(flat(1000, 8.84, 0x3b3c3e, 0, -33.68, 0.01));
  // WB left-turn lane asphalt (550 ft = 167.64 m long east of crossover, plus extension): z from -29.26 to -25.60 (width 3.66 m, center z = -27.43)
  roadWB.add(flat(400, 3.66, 0x3b3c3e, 180, -27.43, 0.01));
  roadWB.add(flat(400, 3.66, 0x3b3c3e, -220, -27.43, 0.01));
  // White north edge line (z = -36.58)
  roadWB.add(flat(1000, 0.15, 0xf2f2f2, 0, -36.58, 0.025));
  // White line separating WB inside lane and WB left-turn lane (z = -29.26)
  roadWB.add(flat(1000, 0.15, 0xf2f2f2, 0, -29.26, 0.025));
  // Yellow south edge line of WB turn lane (z = -25.60) outside crossover
  roadWB.add(flat(460.38, 0.15, 0xe8b800, -249.81, -25.60, 0.025));
  roadWB.add(flat(460.38, 0.15, 0xe8b800, 249.81, -25.60, 0.025));
  // Dashed white lane divider between WB inside and outside lanes (z = -32.92)
  for (let x = -450; x <= 450; x += 12) {
    roadWB.add(flat(3.0, 0.15, 0xf2f2f2, x, -32.92, 0.025));
  }
  add('road_wb', roadWB, {
    kind: 'road',
    label: 'US-27A Westbound (2 through lanes + 550-ft left-turn lane + shoulders)',
    citation: 'text/facts.txt F6, F8; text/police_report.txt p.3; evidence/map.png',
    occludes: false,
  });

  // 3. Grass Median & 130-ft (39.62 m) Median Crossover
  const roadMedian = new THREE.Group();
  // West grass median (x < -19.81, z from -25.60 to -6.10, width 19.50 m, center z = -15.85)
  roadMedian.add(flat(460.38, 18.29, 0x8fb076, -249.81, -15.85, 0.015));
  // East grass median (x > +19.81)
  roadMedian.add(flat(460.38, 18.29, 0x8fb076, 249.81, -15.85, 0.015));
  // Paved median crossover (130 ft = 39.62 m wide, x = -19.81 to +19.81, z = -29.26 to -5.49)
  roadMedian.add(flat(39.62, 23.77, 0x434446, 0, -17.375, 0.012));
  add('road_median', roadMedian, {
    kind: 'road',
    label: '60-ft grass median and 130-ft paved median crossover',
    citation: 'text/facts.txt F7, F8; text/police_report.txt p.1, p.3; evidence/map.png',
    occludes: false,
  });

  // 4. NE 140th Court (local paved side road running south from US-27A along x = 0, width 6.1 m)
  const road140th = new THREE.Group();
  road140th.add(flat(6.1, 140, 0x434446, 0, 71.83, 0.012));
  add('road_140th', road140th, {
    kind: 'road',
    label: 'NE 140th Court (local paved road, south approach)',
    citation: 'text/facts.txt F11, modeling assumptions; evidence/map.png',
    occludes: false,
  });

  // --- TRAFFIC CONTROL ---
  // Stop sign on NE 140th Court approach only; intersection is otherwise unsignalized (text/police_report.txt p.1; text/facts.txt F11)
  const stopSign = new THREE.Group();
  stopSign.add(cyl(0.04, 0.04, 2.2, 0x777777, 0, 1.1, 0));
  stopSign.add(box(0.75, 0.75, 0.04, 0xbb1111, 0, 2.2, 0));
  stopSign.position.set(3.8, 0, 6.0);
  add('sig_stop_140th', stopSign, {
    kind: 'signal',
    label: 'Stop sign on NE 140th Court northbound approach (unsignalized intersection)',
    citation: 'text/police_report.txt p.1; text/facts.txt F11',
    occludes: false,
    state: () => 'off',
  });

  // --- BUILDINGS & SCENE OBJECTS ---
  // Retail store on SE corner (measured from Exhibit 4 scale bar: x = 9.0 to 27.1 m, z = 13.8 to 26.4 m)
  const store = new THREE.Group();
  store.add(box(18.0, 4.5, 12.6, 0xb5926b, 0, 2.25, 0));
  store.add(box(18.4, 0.3, 13.0, 0x5c4328, 0, 4.55, 0));
  store.position.set(18.08, 0, 20.12);
  add('bld_store', store, {
    kind: 'building',
    label: 'Retail convenience/feed store (SE corner)',
    citation: 'text/facts.txt F12; Depo 07:47, 26:14; evidence/map.png',
    occludes: true,
  });

  // Bench shelter in front of the store (open sides, roof overhead, measured from Exhibit 4: x = 8.0 m, z = 8.4 m)
  const shelter = new THREE.Group();
  // Bench seat (low, y = 0.45 m)
  shelter.add(box(2.4, 0.45, 0.6, 0x6e5034, 0, 0.225, 0.2));
  // Four thin corner posts supporting roof (open sides per Exhibit 4 label)
  shelter.add(cyl(0.05, 0.05, 2.4, 0x444444, -1.4, 1.2, -0.75));
  shelter.add(cyl(0.05, 0.05, 2.4, 0x444444, 1.4, 1.2, -0.75));
  shelter.add(cyl(0.05, 0.05, 2.4, 0x444444, -1.4, 1.2, 0.75));
  shelter.add(cyl(0.05, 0.05, 2.4, 0x444444, 1.4, 1.2, 0.75));
  // Roof canopy overhead (y = 2.4 to 2.6 m)
  shelter.add(box(3.1, 0.2, 1.8, 0x3b5978, 0, 2.5, 0));
  shelter.position.set(8.0, 0, 8.4);
  add('occ_shelter', shelter, {
    kind: 'occluder',
    label: 'Bench shelter with roof and open sides in front of retail store',
    citation: 'Depo 09:04, 27:04; evidence/map.png; text/facts.txt modeling assumptions',
    occludes: true,
  });

  // Vertical crest 1,132 ft (345 m) west of intersection center (limits sight distance beyond 345 m west)
  const crest = new THREE.Group();
  crest.add(box(120, 4.5, 60, 0x7b9464, -415, 2.25, -18));
  add('occ_crest', crest, {
    kind: 'occluder',
    label: 'Vertical crest 1,132 ft (345 m) west of intersection (2.15% EB descent)',
    citation: 'text/facts.txt F10, F27, F28; text/police_report.txt p.3',
    occludes: true,
  });

  // Wooden utility pole on south roadside east of intersection (struck by Vehicle A at t = 18.83 s, 8.4 s after impact)
  const pole = new THREE.Group();
  pole.add(cyl(0.18, 0.22, 9.0, 0x5c4028, 0, 4.5, 0));
  pole.position.set(215.0, 0, 16.5);
  add('occ_pole', pole, {
    kind: 'occluder',
    label: 'Wooden utility pole on south roadside (struck 8.4 s post-impact)',
    citation: 'text/facts.txt F24, F26, modeling assumptions; text/police_report.txt p.2, p.3',
    occludes: true,
  });

  // Wire fences & drainage culvert along south roadside post-impact path
  const fences = new THREE.Group();
  fences.add(box(2.5, 0.3, 1.2, 0x777777, 110, 0.15, 9.0)); // drainage culvert
  fences.add(box(0.1, 1.1, 12.0, 0x888888, 145, 0.55, 13.0)); // wire fence 1
  fences.add(box(0.1, 1.1, 12.0, 0x888888, 185, 0.55, 15.5)); // wire fence 2
  add('occ_fences', fences, {
    kind: 'occluder',
    label: 'Drainage culvert and wire fences along south roadside',
    citation: 'text/facts.txt F24; text/police_report.txt p.2',
    occludes: false,
  });

  // --- PHYSICAL EVIDENCE MARKERS ---
  // Area of Impact (AOI) at (0, 0, 0)
  const markPOI = new THREE.Group();
  markPOI.add(flat(2.2, 2.2, 0xcc1111, 0, 0, 0.04));
  add('mark_poi', markPOI, {
    kind: 'mark',
    label: 'Initial Point of Impact (AOI) — center of EB outside lane at NE 140th Ct centerline',
    citation: 'text/facts.txt F21, modeling assumptions; text/police_report.txt p.3; evidence/map.png',
    occludes: false,
  });

  // Vehicle A final rest marker (~910 ft / 277 m east of POI in residential front yard)
  const markRestA = new THREE.Group();
  markRestA.add(flat(2.4, 5.2, 0x992222, 276.6, 23.9, 0.04));
  add('mark_rest_A', markRestA, {
    kind: 'mark',
    label: 'Final rest of Vehicle A (~910 ft / 277 m from POI, perpendicular to highway)',
    citation: 'text/facts.txt F25; text/police_report.txt p.2, p.3',
    occludes: false,
  });

  // Vehicle T final rest marker on NE 140th Ct south of retail store (marked by Witness B at Depo 26:38)
  const markRestT = new THREE.Group();
  markRestT.add(flat(3.0, 22.0, 0x2266aa, 0, 35.0, 0.04));
  add('mark_rest_T', markRestT, {
    kind: 'mark',
    label: 'Final rest of Vehicle T on NE 140th Ct south of retail store',
    citation: 'text/facts.txt F12; text/police_report.txt p.2, p.3; Depo 26:38',
    occludes: false,
  });

  // --- VEHICLES ---
  // Vehicle A: 2015 4-door passenger sedan (4.97 m long x 1.96 m wide x 1.445 m high; local -Z is front)
  const vehA = new THREE.Group();
  // Lower body (hood height ~0.91 m = 3 ft per text/facts.txt F14)
  vehA.add(box(1.96, 0.71, 4.97, 0x2b2f36, 0, 0.555, 0));
  // Cabin / greenhouse (top at 1.445 m)
  vehA.add(box(1.72, 0.535, 2.45, 0x1e2228, 0, 1.1775, 0.25));
  // 4 wheels
  vehA.add(box(0.24, 0.68, 0.68, 0x111111, -0.92, 0.34, -1.48));
  vehA.add(box(0.24, 0.68, 0.68, 0x111111, 0.92, 0.34, -1.48));
  vehA.add(box(0.24, 0.68, 0.68, 0x111111, -0.92, 0.34, 1.48));
  vehA.add(box(0.24, 0.68, 0.68, 0x111111, 0.92, 0.34, 1.48));
  add('veh_A', vehA, {
    kind: 'vehicle',
    label: 'Vehicle A (2015 4-door sedan, eastbound at 74 mph)',
    citation: 'text/facts.txt F14, F17, modeling assumptions; text/police_report.txt p.1',
    occludes: true,
  });

  // Vehicle T Tractor: 2014 truck-tractor (6.6 m long x 2.59 m wide x 4.0 m tall; local -Z is front)
  const vehTTractor = new THREE.Group();
  // Chassis frame rails (y = 0.4 to 1.15 m)
  vehTTractor.add(box(2.59, 0.75, 6.6, 0x222222, 0, 0.775, 0));
  // Engine hood (front 2.0 m, y = 1.15 to 2.15 m)
  vehTTractor.add(box(2.3, 1.0, 2.0, 0x23395d, 0, 1.65, -2.3));
  // Cab and sleeper fairing (y = 1.15 to 4.0 m)
  vehTTractor.add(box(2.55, 2.85, 2.6, 0x23395d, 0, 2.575, 0.0));
  // Tractor wheels
  vehTTractor.add(box(2.59, 1.0, 1.0, 0x111111, 0, 0.5, -2.4));
  vehTTractor.add(box(2.59, 1.0, 2.2, 0x111111, 0, 0.5, 1.9));
  add('veh_T_tractor', vehTTractor, {
    kind: 'vehicle',
    label: 'Vehicle T Tractor (2014 truck-tractor, 6.6 m long x 4.0 m tall)',
    citation: 'text/facts.txt F15, modeling assumptions; text/police_report.txt p.1',
    occludes: true,
  });

  // Vehicle T Semitrailer: 2003 53-ft (16.15 m) white refrigerated van semitrailer
  // Width 2.59 m, box 1.20 m to 4.11 m above ground so cars can pass/be seen beneath the 1.20 m bed (text/facts.txt modeling assumptions)
  const vehTTrailer = new THREE.Group();
  // Main refrigerated van box: y from 1.20 m to 4.11 m (height = 2.91 m, center y = 2.655 m)
  vehTTrailer.add(box(2.59, 2.91, 16.15, 0xf4f4f6, 0, 2.655, 0));
  // Front refrigeration unit (reefer) on front of trailer box
  vehTTrailer.add(box(1.9, 1.6, 0.45, 0xd8d8dc, 0, 2.9, -8.3));
  // Rear tandem bogie / wheels at back of trailer (z = +5.6 to +7.8 m)
  vehTTrailer.add(box(2.55, 1.2, 2.4, 0x1a1a1a, 0, 0.6, 6.6));
  add('veh_T_trailer', vehTTrailer, {
    kind: 'vehicle',
    label: 'Vehicle T Semitrailer (2003 refrigerated van, box 1.20-4.11 m above ground)',
    citation: 'text/facts.txt F15, F16, modeling assumptions; Depo 13:12',
    occludes: true,
  });

  // Witness C's pickup truck stopped in WB inside lane 18 m west of side road (non-occluding witness vehicle)
  const vehC = new THREE.Group();
  vehC.add(box(2.0, 0.85, 5.4, 0x6b7c8c, 0, 0.65, 0));
  vehC.position.set(-18.0, 0, -31.09);
  vehC.rotation.set(0, -270 * Math.PI / 180, 0);
  add('veh_C', vehC, {
    kind: 'vehicle',
    label: 'Witness C pickup truck (stopped in WB inside lane 18 m west of crossover)',
    citation: 'text/witness_C.txt p.1',
    occludes: false,
  });

  // --- KEYFRAMED MOTION ---
  // Heading convention: compass degrees (0 = North/-Z, 90 = East/+X, 180 = South/+Z, 270 = West/-X)
  // Vehicle A center keyframes:
  // t = 0: at crest (-347.5 m center, front bumper at -345.0 m)
  // t = 10.43 s: impact at (0, 0) at 33.08 m/s (74 mph)
  // t = 18.83 s: utility pole strike at (215.0, 16.5)
  // t = 22.0 s: final rest at (276.6, 23.9), heading 0 deg (perpendicular to US-27A)
  const KA = [
    [0.0, -347.5, 0.0, 90],
    [10.43, 0.0, 0.0, 90],
    [18.83, 215
