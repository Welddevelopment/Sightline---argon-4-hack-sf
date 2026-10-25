/**
 * WORLD CONTRACT v2 — Forensic Collision Reconstruction Module
 * Case ID: demo-full (NTSB/HAR-17/02, HWY16FH018 — US-27A & NE 140th Ct, Williston, FL)
 * Event Date/Time: 2016-05-07 16:36:12.7 EDT (UTC-04:00, America/New_York) [docket_har1702.txt p.15, p.25]
 * Coordinates: 29.4106° N, -82.5393° W (POI: 29.4106 N, -82.53979 W; Rest: 29.409516 N, -82.537291 W) [docket_har1702.txt p.32 fn.40]
 * Frame & Origin: World (0,0,0) = Initial Point of Impact (POI) = center of EB outside lane of US-27A at NE 140th Ct centerline.
 *   +X = East (along US-27A toward Williston, bearing 108.83° rotated 18.83° CCW to model +X), -Z = North, +Y = Up.
 * Key Evidence → Geometry & Kinematics Decisions:
 *   1. Roadway: US-27A 4-lane divided (12 ft = 3.66 m lanes, 2 ft = 0.61 m inside shoulder, 5 ft = 1.52 m outside shoulder,
 *      78 ft = 23.77 m median+turn+shoulders between through-lane inside edges) [docket_har1702.txt p.22, p.29 fn.53].
 *      Centerline of US-27A is at Z = -(23.77/2 + 3.66*1.5) = -17.37 m.
 *   2. Vertical Crest: 1,132 ft (345.0 m) west of intersection center, 0.51% ascending West, 2.15% descending East for 1,459 ft
 *      (leveling ~327 ft = 99.7 m east of POI) [docket_har1702.txt p.22-23; docket_tech_recon_factual.txt p.3].
 *   3. Vehicle A (2015 sedan): Constant 74 mph (33.08 m/s) EB in outside lane (Z = 0). Front at crest (X = -345.0 m) at t = 0.0 s;
 *      front reaches X = 0 at impactT = 10.43 s (center at X = -2.45 m) [docket_har1702.txt p.15, p.29; facts.md F17, F28].
 *      Post-impact: departs right at ~1.7° (326 ft = 99.4 m), crosses culvert/2 fences, strikes utility pole at t = 18.83 s
 *      (8.4 s after impact, 855 ft = 260.6 m), rotates CCW to rest facing north at 910 ft = 277.4 m [docket_tech_recon_factual.txt p.4-5, p.13].
 *   4. Vehicle T (2014 tractor + 53-ft semitrailer): Starts in WB left-turn lane, turns left across crossover onto NE 140th Ct,
 *      reaching POI at t = 10.43 s with impact 45 ft 5 in (13.84 m) aft of tractor front, then stops on NE 140th Ct south of store
 *      [docket_har1702.txt p.1, p.6 fn.6; Depo Witness B 1:52:10].
 *   5. Witnesses: Witness A (WB driver ~402 m east at 60 mph, occluded by trailer as it enters EB lanes) [docket_har1702.txt p.1-2, p.29-30];
 *      Witness B (standing at [7.5, 0, 12.0] m per pen mark #2 on Exhibit 4 at Depo Witness B 1:54:30 — behind the store's NW corner
 *      and bench shelter, occluding her claimed view of the EB approach); Witness C (stopped in WB inside lane at [-18, 0, -31.1] m)
 *      [witness_C.md p.1]; Witness D (clerk inside store at register [24.0, 0, 15.0] m, occluded by building/cooler/posters) [Depo Witness D 08:05, 18:02].
 */

export default function createWorld(THREE, assets) {
  const root = new THREE.Group();
  root.name = 'world_root';
  const objects = {};
  const D2R = Math.PI / 180;

  const T = assets.terrain || { reset() {}, hillCrest() {}, elevationProfile() {}, height: () => 0, roadHeight: () => 0 };
  T.reset();
  const gy = (x, z) => T.height(x, z);
  const ry = (x, z) => (T.roadHeight ? T.roadHeight(x, z) : T.height(x, z));

  const add = (id, node, kind, label, citation, occludes, x = 0, z = 0, headingDeg = 0, extra = {}) => {
    node.name = id;
    node.position.set(x, gy(x, z), z);
    node.rotation.y = -headingDeg * D2R;
    root.add(node);
    return (objects[id] = { node, kind, label, citation, occludes, ...extra });
  };

  const reg = (id, node, kind, label, citation, occludes = false, extra = {}) => {
    node.name = id;
    root.add(node);
    return (objects[id] = { node, kind, label, citation, occludes, ...extra });
  };

  const scenery = (node) => {
    if (!node) return null;
    node.userData.scenery = true;
    root.add(node);
    return node;
  };

  // ---------- 1. ENVIRONMENT (NOAA solar position for 2016-05-07 16:36:12 EDT at Williston, FL) ----------
  root.add(
    assets.environment({
      date: '2016-05-07T16:36:12-04:00',
      timeOfDay: '16:36:12',
      utcOffset: '-04:00',
      timeZone: 'America/New_York',
      lat: 29.4106,
      lon: -82.5393,
      lighting: 'day',
      weather: 'clear',
    })
  );

  // ---------- 2. TERRAIN: Vertical crest 1,132 ft (345 m) west of intersection ----------
  // Ascending 0.51% (or ~2% in regional terrain) west of crest, descending 2.15% east of crest for 1,459 ft (444.7 m),
  // leveling out ~327 ft (99.7 m) east of the intersection. Datum kept at 0 near the intersection/witness area.
  T.hillCrest({
    at: [-345.0, -17.37],
    heading: -Math.PI / 2,
    gradeUp: 0.02,
    lengthUp: 400,
    gradeDown: 0.0215,
    lengthDown: 235,
    curve: 140,
  });

  // Explicit terrain proxy object for sight-restriction checks (crest at X = -345 m)
  const crestProxyNode = assets.building({ id: 'occ_hill_crest', w: 6.0, d: 60.0, h: 0.4, kind: 'generic' });
  crestProxyNode.visible = false; // Terrain mesh itself carries the visual crest; proxy records the sight restriction in objects
  add(
    'occ_hill_crest',
    crestProxyNode,
    'terrain',
    'Vertical hill crest on US-27A (1,132 ft / 345 m west of intersection, 2.15% descending grade eastbound)',
    'docket_har1702.txt p.22, p.29; docket_tech_recon_factual.txt p.3: crest 1,132 ft (345 m) west of intersection',
    false,
    -345.0,
    -17.37,
    0
  );

  // ---------- 3. ROADWAYS: US-27A divided highway & NE 140th Court ----------
  // US-27A: 4 through lanes (3.66 m = 12 ft each), divided median (23.77 m = 78 ft total between inside through-lane edges),
  // 1.52 m (5 ft) right shoulder, 0.61 m (2 ft) left shoulder, 39.6 m (130 ft) median crossover, 167.6 m (550 ft) turn lanes.
  reg(
    'road_us27a',
    assets.road({
      id: 'road_us27a',
      lanes: 4,
      laneWidth: 3.66,
      divided: true,
      medianWidth: 23.77,
      length: 1700,
      markings: 'standard',
      shoulderWidth: 1.52,
      leftShoulderWidth: 0.61,
      position: [100, -17.37],
      heading: -Math.PI / 2,
      openings: [
        { at: -100, width: 39.6, radius: 6 },
        { at: 282, width: 22.0, radius: 5 },
      ],
      turnLanes: [
        { carriageway: 'reverse', stopAt: -80.2, length: 167.6, taper: 15 },
        { carriageway: 'forward', stopAt: -80.2, length: 160.9, taper: 15 },
      ],
      sideRoads: [
        { at: -100, side: 'right', width: 6.1, radius: 9 },
        { at: -100, side: 'left', width: 6.1, radius: 9 },
      ],
    }),
    'road',
    'US-27A (SR-500): 4-lane divided rural highway, 12 ft (3.66 m) lanes, ~60 ft grass median (78 ft / 23.77 m between inside through lanes), 130 ft (39.6 m) crossover, 550 ft (167.6 m) WB left-turn lane',
    'docket_har1702.txt p.13, p.21-22, p.29 fn.53; docket_tech_recon_factual.txt p.3-4',
    false
  );

  const outer = objects.road_us27a.node.userData.edges?.outer ?? 20.73;
  const sideStart = -17.37 + outer;

  // NE 140th Court running south from the intersection (straightened to 90° per Exhibit 4 & facts.md)
  reg(
    'road_ne140',
    assets.road({
      id: 'road_ne140',
      lanes: 2,
      laneWidth: 3.05,
      shoulderWidth: 0,
      markings: 'center_double',
      edgeLines: false,
      length: 260,
      position: [0, sideStart + 130],
      heading: 0,
      rpms: false,
      roadside: { ditchDepth: 0.35 },
    }),
    'road',
    'NE 140th Court (local two-lane paved road running south from US-27A; 109 deg skew straightened per Exhibit 4)',
    'inferred: docket_har1702.txt p.11, p.13, p.21; exhibit4_intersection_map.png; 6.1 m width assumed',
    false
  );

  // North side road / driveway opposite NE 140th Ct (visible in USGS aerial & Highway Factual Fig. 1)
  scenery(
    assets.road({
      id: 'scn_road_ne140_n',
      lanes: 2,
      laneWidth: 2.75,
      shoulderWidth: 0,
      markings: 'none',
      edgeLines: false,
      length: 180,
      position: [0, -17.37 - outer - 90],
      heading: 0,
      rpms: false,
    })
  );

  // ---------- 4. GROUND & LANDSCAPE SCENERY (aligned to USGS NAIP aerial) ----------
  const LS = assets.landscape || {};
  const th = (x, z) => T.height(x, z);
  const rh = (x, z) => T.roadHeight(x, z);

  root.add(
    (LS.pastureGround && LS.pastureGround({ id: 'ground', size: 4000, terrainHeight: th, roadHeight: rh, roads: 'auto' })) ||
      assets.groundPlane({ id: 'ground', size: 4000, kind: 'grass' })
  );

  const ring = LS.treeline && LS.treeline({ id: 'scn_treeline_ring', distance: [300, 1100], length: 900, terrainHeight: th, roads: 'auto' });
  if (ring) scenery(ring);

  if (!assets.headless) {
    const grass =
      LS.grassBlades &&
      LS.grassBlades({
        id: 'scn_grass',
        focus: [
          [7.5, 12.0],
          [7.5, 6.5],
          [-18, -31.1],
          [0, 0],
          [-60, 0],
        ],
        radius: 45,
        terrainHeight: th,
        roadHeight: rh,
        roads: 'auto',
      });
    if (grass) scenery(grass);

    const clouds = LS.skyClouds && LS.skyClouds({ coverage: 0.08, sunAzimuth: 265, sunElevation: 45.1 });
    if (clouds) scenery(clouds);
  }

  // Forest edges and tree lines placed from USGS NAIP aerial photo
  scenery(assets.treeline({ id: 'scn_trees_n', points: [[-900, -170], [-400, -190], [-60, -140], [60, -150], [500, -185], [900, -175]], depth: 24, spacing: 8, seed: 3 }));
  scenery(assets.treeline({ id: 'scn_trees_s', points: [[-900, 150], [-300, 170], [-40, 110], [60, 95], [400, 140], [900, 160]], depth: 26, spacing: 8, seed: 5, pineRatio: 0.45 }));
  scenery(assets.treeline({ id: 'scn_trees_s2', points: [[-260, 60], [-180, 64], [-80, 55]], depth: 12, spacing: 7, seed: 9, height: 11 }));
  scenery(assets.treeline({ id: 'scn_trees_nw', points: [[-380, -65], [-220, -62], [-90, -58]], depth: 18, spacing: 7.5, seed: 11, height: 13 }));
  scenery(assets.treeline({ id: 'scn_trees_ne', points: [[40, -62], [180, -65], [320, -60]], depth: 16, spacing: 8, seed: 14, height: 12 }));

  // Scenery fences along northern and western right-of-way
  for (const [id, z, segs] of [
    ['scn_fence_n', -53.37, [[-800, -25], [25, 800]]],
    ['scn_fence_s_west', 12.5, [[-800, -14]]],
  ]) {
    for (const [a, b] of segs) {
      const pts = [];
      for (let x = a; x <= b; x += 50) pts.push([x, z]);
      if (pts[pts.length - 1][0] < b) pts.push([b, z]);
      scenery(assets.fence({ id: id + '_' + a, points: pts }));
    }
  }

  // ---------- 5. BUILDINGS, SHELTER, FENCES, POLES & SIGNS (EVIDENCED) ----------
  // Retail store on SE corner of US-27A and NE 140th Ct (Exhibit 4: X ∈ [10, 30] m, Z ∈ [13, 25] m; center = [20, 19] m)
  add(
    'bld_retail_store',
    assets.building({ id: 'bld_retail_store', w: 20.0, d: 12.0, h: 4.5, kind: 'store' }),
    'building',
    'Retail store / country store on SE corner of US-27A & NE 140th Court (solid west wall, posters/cooler on north windows)',
    'inferred: docket_har1702.txt p.3, p.11; exhibit4_intersection_map.png (X=10..30 m, Z=13..25 m); Depo Witness B 28:33, 1:47:58; Depo Witness D 04:10, 06:39, 09:18; height assumed',
    true,
    20.0,
    19.0,
    0
  );

  // Bench shelter in front (NW) of the retail store (Exhibit 4: centered at X = 8.5 m, Z = 8.2 m; 3.5 x 1.5 x 2.5 m)
  // Witness D testifies (Depo Witness D 10:16) it has a roof and a sheet-metal back, with open sides.
  add(
    'occ_bench_shelter',
    assets.shelter({ id: 'occ_bench_shelter', open: false }),
    'occluder',
    'Bench shelter in front of retail store (roof on posts with sheet-metal back panel)',
    'exhibit4_intersection_map.png (at X=8.5 m, Z=8.2 m); Depo Witness D 09:43, 09:51, 10:16; facts.md p.2',
    true,
    8.5,
    8.2,
    0
  );

  // Store parking lot gravel/asphalt apron, gas island & sign pole (from Depo Witness D 09:34-09:47 & USGS aerial)
  if (THREE.BoxGeometry && THREE.MeshStandardMaterial) {
    const lotGroup = new THREE.Group();
    lotGroup.name = 'scn_store_apron';
    const apronMat = new THREE.MeshStandardMaterial({ color: 0x8a857a, roughness: 0.92, metalness: 0.02 });
    const apronMesh = new THREE.Mesh(new THREE.BoxGeometry(32, 0.08, 22), apronMat);
    apronMesh.position.set(19.0, gy(19.0, 16.0) + 0.02, 16.0);
    apronMesh.receiveShadow = true;
    lotGroup.add(apronMesh);

    // Small gas pump island in front of store (Depo Witness D 09:34: "one gas island, two pumps", low profile outside sight corridor)
    const islandMat = new THREE.MeshStandardMaterial({ color: 0xc8c4bc, roughness: 0.8 });
    const islandBase = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.18, 1.4), islandMat);
    islandBase.position.set(24.5, gy(24.5, 9.5) + 0.09, 9.5);
    islandBase.castShadow = true;
    islandBase.receiveShadow = true;
    lotGroup.add(islandBase);

    // North commercial building across US-27A visible in USGS NAIP aerial (X ≈ -38 m, Z ≈ -68 m)
    const northBld = assets.building({ id: 'scn_bld_north', w: 16, d: 28, h: 5.0, kind: 'store' });
    northBld.position.set(-38, gy(-38, -68), -68);
    lotGroup.add(northBld);

    // Private residence in the SE yard where Vehicle A came to rest (docket_har1702.txt p.11; docket_tech_recon_factual.txt p.7 Fig. 3)
    const resHouse = assets.building({ id: 'scn_bld_residence', w: 18, d: 14, h: 4.8, kind: 'house' });
    resHouse.position.set(272, gy(272, 62), 62);
    lotGroup.add(resHouse);

    scenery(lotGroup);
  }

  // Traffic signs at the intersection (Highway Factual p.9; Police Report p.1; Depo Witness B 15:57, 27:05)
  add(
    'sig_stop_ne140',
    assets.sign({ id: 'sig_stop_ne140', kind: 'stop', text: 'STOP' }),
    'signal',
    'Stop sign on northbound NE 140th Court approach to US-27A',
    'police_report.md p.1; Depo Witness B 27:05',
    false,
    4.2,
    8.5,
    180
  );

  add(
    'sig_speed_65_eb',
    assets.sign({ id: 'sig_speed_65_eb', kind: 'speed_limit', text: '65' }),
    'signal',
    'Posted 65 mph speed limit sign on eastbound US-27A',
    'docket_har1702.txt p.11, p.22; police_report.md p.1',
    false,
    -180.0,
    5.5,
    270
  );

  add(
    'sig_yield_median',
    assets.sign({ id: 'sig_yield_median', kind: 'yield', text: 'YIELD' }),
    'signal',
    'Yield / One-Way sign in median crossover adjacent to turn lane',
    'docket_highway_factual.txt p.9',
    false,
    -21.0,
    -8.5,
    90
  );

  add(
    'sig_street_ne140',
    assets.sign({ id: 'sig_street_ne140', kind: 'street_name', text: 'NE 140th Ct' }),
    'signal',
    'Street name sign at NE 140th Court and US-27A',
    'inferred: docket_har1702.txt p.11; typical intersection signage',
    false,
    -4.5,
    6.5,
    0
  );

  // Evidenced wire fences breached by Vehicle A post-impact:
  // 1) Parallel wire fence along top of drainage culvert back slope (breached at ~660 ft = 201.2 m east of POI)
  const fence1Pts = [];
  for (let x = 40; x <= 320; x += 40) fence1Pts.push([x, 12.5]);
  reg(
    'occ_wire_fence_1',
    assets.fence({ id: 'occ_wire_fence_1', points: fence1Pts }),
    'occluder',
    'First wire fence (parallel to US-27A along south right-of-way; breached by Vehicle A ~660 ft / 201 m east of POI)',
    'docket_har1702.txt p.11; docket_tech_recon_factual.txt p.4, p.7 Fig. 3',
    false
  );

  // 2) Perpendicular wire fence breached by Vehicle A just prior to striking the utility pole (~245 m east of POI)
  reg(
    'occ_wire_fence_2',
    assets.fence({
      id: 'occ_wire_fence_2',
      points: [
        [245.0, 12.5],
        [245.0, 45.0],
        [245.0, 80.0],
      ],
    }),
    'occluder',
    'Second wire fence (perpendicular to US-27A; breached by Vehicle A prior to striking utility pole)',
    'docket_har1702.txt p.11; docket_tech_recon_factual.txt p.4, p.7 Fig. 3',
    false
  );

  // Evidenced wooden utility pole struck and severed by Vehicle A at 855 ft (260.6 m) from POI (910 ft - 55 ft = 855 ft)
  // At 1.7° road departure and field traversal, Z ≈ 18.5 m south of EB outside lane center.
  add(
    'occ_utility_pole_struck',
    assets.pole({ id: 'occ_utility_pole_struck', height: 10.7 }),
    'occluder',
    'Wooden utility pole struck and broken by Vehicle A (855 ft / 260.6 m east-southeast of POI, 55 ft west of final rest)',
    'docket_har1702.txt p.11, p.15; docket_tech_recon_factual.txt p.4-5 (910 ft total - 55 ft to rest = 855 ft / 260.6 m)',
    true,
    259.9,
    18.5,
    0
  );

  // Other utility poles along the south pole line (illustrative scenery)
  for (const x of [
    -680.7, -634.7, -588.7, -542.7, -496.7, -450.7, -404.7, -358.7, -312.7, -266.7, -220.7, -174.7, -128.7, -82.7,
    -36.7, 55.3, 101.3, 147.3, 193.3, 331.3, 377.3, 423.3, 469.3, 515.3, 561.3, 607.3, 653.3, 699.3, 745.3,
  ]) {
    const p = scenery(assets.pole({ id: 'scn_pole_' + x, height: 10.7 }));
    if (p) p.position.set(x, gy(x, 18.5), 18.5);
  }

  // Evidenced cluster of trees along post-impact path (Witness A interview p.8: "went right through an opening in that little cluster of trees")
  add(
    'occ_tree_cluster_1',
    assets.tree({ id: 'occ_tree_cluster_1', kind: 'oak', height: 11 }),
    'occluder',
    'Tree cluster along south field (north of Vehicle A post-impact path)',
    'docket_hp_att4_witness_interview.txt p.8; docket_tech_recon_factual.txt p.7 Fig. 3; aerial (USGS NAIP)',
    true,
    218.0,
    11.0,
    0
  );
  add(
    'occ_tree_cluster_2',
    assets.tree({ id: 'occ_tree_cluster_2', kind: 'pine', height: 13 }),
    'occluder',
    'Tree cluster along south field (south of Vehicle A post-impact path)',
    'docket_hp_att4_witness_interview.txt p.8; docket_tech_recon_factual.txt p.7 Fig. 3; aerial (USGS NAIP)',
    true,
    222.0,
    24.0,
    0
  );

  // Additional background individual trees from USGS NAIP aerial
  for (const [x, z, h, k] of [
    [34, 30, 10, 'oak'],
    [-22, 26, 12, 'oak'],
    [-40, 40, 18, 'pine'],
    [60, -64, 9, 'oak'],
    [-120, 52, 17, 'pine'],
    [140, 48, 10, 'oak'],
    [-70, -70, 11, 'oak'],
  ]) {
    const tr = scenery(assets.tree({ id: 'scn_tree_' + x, kind: k, height: h }));
    if (tr) {
      tr.position.set(x, gy(x, z), z);
      tr.rotation.y = x;
    }
  }

  // ---------- 6. MARKS: Point of Impact, Tire Friction Marks, Final Rest Markers ----------
  reg(
    'mark_poi',
    assets.impactMarker({ id: 'mark_poi', position: [0, 0] }),
    'mark',
    'Initial Point of Impact (POI) in EB outside lane of US-27A at NE 140th Court',
    'docket_har1702.txt p.13 Fig. 2, p.15; docket_tech_recon_factual.txt p.4; exhibit4_intersection_map.png',
    false
  );

  // Two parallel 11.5-ft (3.51 m) vertical-loading tire friction marks in EB outside lane at POI (docket_tech_recon_factual.txt p.4-5 Fig. 1)
  reg(
    'mark_poi_tire_impressions',
    assets.skidMark({
      id: 'mark_poi_tire_impressions',
      points: [
        [-1.0, 0.83],
        [2.51, 0.83],
      ],
      width: 0.25,
    }),
    'mark',
    '11.5 ft (3.51 m) linear tire friction mark at POI from vertical loading / over-deflection during underride (no pre-impact braking skids)',
    'docket_tech_recon_factual.txt p.4-5 Fig. 1: 11.5 ft linear tire friction mark in EB right lane at POI',
    false
  );

  reg(
    'mark_car_rest',
    assets.impactMarker({ id: 'mark_car_rest', position: [276.6, 21.0] }),
    'mark',
    'Vehicle A final rest position (910 ft / 277.4 m ESE of POI, perpendicular to highway in residential front yard)',
    'docket_har1702.txt p.11, p.13 Fig. 2; docket_tech_recon_factual.txt p.5, p.7 Fig. 3',
    false
  );

  reg(
    'mark_truck_rest',
    assets.impactMarker({ id: 'mark_truck_rest', position: [-1.53, 35.0] }),
    'mark',
    'Vehicle T tractor final rest position on southbound NE 140th Court south of retail store (mark #1 on Exhibit 4)',
    'docket_har1702.txt p.11, p.13 Fig. 2; Depo Witness B 1:52:10-1:52:45 (Exhibit 4 mark #1)',
    false
  );

  // ---------- 7. VEHICLES ----------
  // Vehicle A: 2015 dark/black 4-door sedan (L = 4.9 m, W = 1.9 m, H = 1.45 m)
  const vehA = add(
    'veh_car_a',
    assets.vehicle('sedan', { id: 'veh_car_a', color: '#1c2026' }),
    'vehicle',
    'Vehicle A: 2015 4-door passenger sedan (eastbound at 74 mph on TACC + Autosteer, headlights off)',
    'docket_har1702.txt p.11, p.15; docket_highway_att1_fl_crash_report.txt p.2 (BLK 4D); Depo Witness B 40:51',
    true,
    -347.45,
    0,
    90
  );
  if (vehA.node.userData.setLights) vehA.node.userData.setLights(false); // Headlights off at impact (docket_har1702.txt p.15)

  // Vehicle T: 2014 red truck-tractor (L = 6.5 m, W = 2.5 m, H = 3.6 m) + 2003 white 53-ft refrigerated semitrailer (L = 16.2 m, W = 2.6 m, H = 4.1 m)
  const vehTractor = add(
    'veh_truck_tractor',
    assets.vehicle('truck_tractor', { id: 'veh_truck_tractor', color: '#9e2a2b' }),
    'vehicle',
    'Vehicle T (Tractor): 2014 conventional truck-tractor turning left from WB US-27A onto SB NE 140th Ct',
    'docket_har1702.txt p.11, p.16 fn.6; docket_highway_att1_fl_crash_report.txt p.2 (2014 FRHT CASCADIA RED)',
    true,
    -23.0,
    -27.43,
    270
  );

  const vehTrailer = add(
    'veh_semitrailer',
    assets.vehicle('semitrailer', { id: 'veh_semitrailer', color: '#f3f4f6' }),
    'vehicle',
    'Vehicle T (Semitrailer): 2003 53-ft white refrigerated van semitrailer (struck on right side 45 ft 5 in behind tractor front)',
    'docket_har1702.txt p.11, p.16-17; docket_tech_recon_factual.txt p.10-11; Depo Witness B 1:01:43',
    true,
    -15.65,
    -27.43,
    270
  );

  // Witness A's vehicle: black pickup truck traveling westbound in outside lane at 60 mph (26.82 m/s), ~0.25 mi behind truck
  const vehWitA = add(
    'veh_witness_a_pickup',
    assets.vehicle('pickup', { id: 'veh_witness_a_pickup', color: '#1f2421' }),
    'vehicle',
    'Witness A pickup truck: black pickup traveling westbound on US-27A at ~60 mph (~0.25 mi behind truck)',
    'docket_har1702.txt p.11-12, p.29-30; docket_hp_att4_witness_interview.txt p.5-6, p.16; witness_A.md p.1',
    true,
    402.0,
    -34.75,
    270
  );

  // Witness C's vehicle: pickup stopped in WB inside lane 18 m west of NE 140th Ct
  const vehWitC = add(
    'veh_witness_c_pickup',
    assets.vehicle('pickup', { id: 'veh_witness_c_pickup', color: '#5c677d' }),
    'vehicle',
    'Witness C pickup truck: stopped in westbound inside lane 18 m west of NE 140th Court crossover',
    'witness_C.md p.1; police_report.md p.1',
    true,
    -18.0,
    -31.09,
    270
  );

  // ---------- 8. KINEMATICS & CUBIC HERMITE INTERPOLATION ----------
  // Cubic Hermite spline through keyframes [t, x, z, headingDeg, speedMps]
  // Guarantees C1 continuous velocity and smooth acceleration ≤ 0.8 g pre-impact.
  function sampleHermite(kfs, t) {
    if (t <= kfs[0][0]) {
      const [ , x, z, h, v] = kfs[0];
      return { x, z, headingDeg: h, speed: v };
    }
    const last = kfs[kfs.length - 1];
    if (t >= last[0]) {
      const [ , x, z, h, v] = last;
      return { x, z, headingDeg: h, speed: v };
    }
    let i = 0;
    while (i < kfs.length - 2 && t > kfs[i + 1][0]) i++;
    const [t0, x0, z0, h0, v0] = kfs[i];
    const [t1, x1, z1, h1, v1] = kfs[i + 1];
    const dt = t1 - t0;
    const u = (t - t0) / dt;
    const u2 = u * u;
    const u3 = u2 * u;

    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;

    const vx0 = Math.sin(h0 * D2R) * v0;
    const vz0 = -Math.cos(h0 * D2R) * v0;
    const vx1 = Math.sin(h1 * D2R) * v1;
    const vz1 = -Math.cos(h1 * D2R) * v1;

    const x = h00 * x0 + h10 * dt * vx0 + h01 * x1 + h11 * dt * vx1;
    const z = h00 * z0 + h10 * dt * vz0 + h01 * z1 + h11 * dt * vz1;

    // Derivative with respect to u (divide by dt for velocity)
    const dh00 = (6 * u2 - 6 * u) / dt;
    const dh10 = 3 * u2 - 4 * u + 1;
    const dh01 = (-6 * u2 + 6 * u) / dt;
    const dh11 = 3 * u2 - 2 * u;

    const vx = dh00 * x0 + dh10 * vx0 + dh01 * x1 + dh11 * vx1;
    const vz = dh00 * z0 + dh10 * vz0 + dh01 * z1 + dh11 * vz1;
    const speed = Math.hypot(vx, vz);

    //Shortest-angle heading interpolation blended with tangent heading
    let dh = ((h1 - h0 + 540) % 360) - 180;
    const interpH = h0 + dh * (3 * u2 - 2 * u3);
    const tangentH = speed > 0.25 ? ((Math.atan2(vx, -vz) / D2R) + 360) % 360 : interpH;
    const headingDeg = kfs[i + 1][5] === 'spin' ? interpH : tangentH;

    return { x, z, headingDeg, speed };
  }

  // --- Vehicle A Trajectory ---
  // Pre-impact: Constant 74 mph = 33.081 m/s in EB outside lane (Z = 0), heading 90° (East).
  // At t = 0.0 s, front is at crest X = -345.0 m => footprint center (L/2 = 2.45 m behind front) is at X = -347.45 m.
  // At t = 10.43 s (impactT), front is at POI X = 0.0 m => footprint center is at X = -2.45 m.
  // Post-impact: Shallow 1.7° angle toward right roadside, departing pavement ~326 ft (99.4 m) from POI at t ≈ 13.5 s,
  // traversing drainage culvert/field, breaching Fence 1 (~201 m) and Fence 2 (~245 m), striking utility pole at 855 ft (260.6 m)
  // at t = 18.83 s (8.4 s after impact) at 49.05 mph (21.93 m/s), then rotating CCW to rest facing North (0°) at [276.6, 21.0] m
  // (total linear travel 910 ft = 277.4 m) by t = 23.0 s.
  const carKeyframes = [
    [0.0, -347.45, 0.0, 90.0, 33.081],
    [5.0, -182.045, 0.0, 90.0, 33.081],
    [10.43, -2.45, 0.0, 90.0, 33.081],
    [10.65, 4.75, 0.1, 91.7, 32.3],
    [13.55, 96.9, 2.85, 92.8, 31.1],
    [16.8, 194.5, 11.8, 94.8, 28.5],
    [18.83, 249.2, 17.6, 95.5, 25.0],
    [19.0, 253.4, 18.0, 95.0, 21.93],
    [20.8, 271.5, 20.3, 40.0, 6.5, 'spin'],
    [23.0, 276.6, 21.0, 0.0, 0.0, 'spin'],
    [25.0, 276.6, 21.0, 0.0, 0.0, 'spin'],
  ];

  // --- Vehicle T (Tractor & Articulated Semitrailer) Trajectory ---
  // Based on NTSB Vehicle Dynamics Study (docket_vehicle_dynamics_study.txt p.5-13, Run #2 / #4) and HAR-17/02 p.6 fn.6:
  // Combination length = 71 ft 7 in (21.82 m). Impact centered 45 ft 5 in (13.84 m) aft of tractor front (25 ft 9 in = 7.85 m
  // aft of trailer front; 27 ft 3 in = 8.31 m forward of trailer rear).
  // At t = 10.43 s (impactT):
  //   Trailer center is at [-1.29, -0.25] m with heading 178° (almost due south, right side W/2 = 1.30 m facing west at X ≈ -2.59 m
  //   where Car A's front at X = 0.0 m + hood/windshield underrides the right lower rail at Z = 0).
  //   Tractor center is at [-1.53, 10.75] m with heading 178° (tractor front at Z = 10.75 + 3.25 = 14.0 m, entering NE 140th Ct;
  //   13.84 m aft of tractor front is Z = 14.0 - 13.84 = +0.16 m ≈ 0.0 m, center of EB outside lane!).
  const tractorKeyframes = [
    [0.0, -19.5, -27.43, 270.0, 1.2],
    [2.0, -16.2, -27.1, 258.0, 2.2],
    [4.5, -10.2, -23.8, 225.0, 3.8],
    [7.0, -4.2, -14.2, 192.0, 5.2],
    [9.0, -1.9, -1.2, 180.0, 6.2],
    [10.43, -1.53, 10.75, 178.0, 6.4],
    [13.0, -1.53, 25.5, 180.0, 4.2],
    [16.5, -1.53, 35.0, 180.0, 0.0],
    [25.0, -1.53, 35.0, 180.0, 0.0],
  ];

  // Semitrailer heading lags the tractor through the left turn and straightens as it enters NE 140th Ct
  const trailerHeadingKeyframes = [
    [0.0, 270.0],
    [2.0, 267.0],
    [4.5, 248.0],
    [7.0, 212.0],
    [9.0, 187.0],
    [10.43, 178.0],
    [13.0, 179.5],
    [16.5, 180.0],
    [25.0, 180.0],
  ];

  function sampleScalar(pairs, t) {
    if (t <= pairs[0][0]) return pairs[0][1];
    const last = pairs[pairs.length - 1];
    if (t >= last[0]) return last[1];
    let i = 0;
    while (i < pairs.length - 2 && t > pairs[i + 1][0]) i++;
    const [t0, y0] = pairs[i];
    const [t1, y1] = pairs[i + 1];
    const u = (t - t0) / (t1 - t0);
    const s = 3 * u * u - 2 * u * u * u;
    return y0 + (y1 - y0) * s;
  }

  // --- Witness A Pickup Trajectory ---
  // Traveling westbound in WB outside lane (Z = -34.75 m, heading 270°) at ~60 mph (26.82 m/s), ~0.25 mi behind the truck.
  // Reaches the beginning of the WB left-turn lane (~550 ft = 167.6 m east of crossover) ~1 s after impact (docket_vehicle_dynamics_study.txt p.4),
  // then brakes smoothly into the turn lane / shoulder near the crossover.
  const witAKeyframes = [
    [0.0, 445.0, -34.75, 270.0, 26.82],
    [7.0, 257.26, -34.75, 270.0, 26.82],
    [10.43, 165.27, -34.75, 270.0, 26.82],
    [11.43, 138.45, -34.5, 269.0, 26.0],
    [15.0, 62.0, -31.0, 266.0, 15.0],
    [19.5, 8.0, -28.0, 268.0, 3.5],
    [22.0, 0.0, -27.43, 270.0, 0.0],
    [25.0, 0.0, -27.43, 270.0, 0.0],
  ];

  // ---------- 9. WITNESSES ----------
  const witnesses = [
    {
      id: 'witness_A',
      name: 'Witness A (Westbound Driver)',
      label: 'Witness A (westbound pickup driver ~0.25 mi behind truck in WB outside lane)',
      position: [257.26, 0, -34.75],
      eyeHeight: 1.5,
      lookAt: 'veh_car_a',
      observationTime: 7.0,
      claim:
        'Saw the eastbound dark car come over the hill for several seconds before the turning semitrailer entered the eastbound lanes and blocked his view of the car.',
      citation:
        'docket_har1702.txt p.11-12, p.29-30; docket_hp_att4_witness_interview.txt p.5-6, p.12; docket_vehicle_dynamics_study.txt p.2, p.4; witness_A.md p.1',
    },
    {
      id: 'witness_B',
      name: 'Witness B (Store Pedestrian)',
      label: 'Witness B (pedestrian standing at marked position #2 on Exhibit 4, [7.5, 0, 12.0] m)',
      position: [7.5, 0, 12.0],
      eyeHeight: 1.57,
      lookAt: 'veh_car_a',
      observationTime: 9.5,
      claim:
        'I had a clear view of the car the whole way in. I watched it right up until the moment it hit. Nothing was in the way.',
      citation:
        'Depo Witness B 17:01 (5 ft 6 in tall), 41:10-41:20, 52:00-52:07 ("watched it the whole way, right up until it hit"), 1:54:30 (Exhibit 4 pen mark #2 at [7.5, 0, 12.0] m)',
    },
    {
      id: 'witness_C',
      name: 'Witness C (Stopped Westbound Driver)',
      label: 'Witness C (pickup driver stopped in WB inside lane 18 m west of NE 140th Ct crossover)',
      position: [-18.0, 0, -31.09],
      eyeHeight: 1.5,
      lookAt: 'veh_semitrailer',
      observationTime: 10.43,
      claim:
        'Stopped in WB inside lane ~18 m west of crossover watching the truck creep out of the turn lane and swing across the EB lanes; heard the crunch and saw the car emerge from the far side.',
      citation: 'witness_C.md p.1; police_report.md p.1',
    },
    {
      id: 'witness_D',
      name: 'Witness D (Store Counter Clerk)',
      label: 'Witness D (counter clerk inside retail store behind register at [24.0, 0, 15.0] m)',
      position: [24.0, 0, 15.0],
      eyeHeight: 1.6,
      lookAt: 'veh_car_a',
      observationTime: 10.43,
      claim:
        'Inside the store behind the register restocking cigarettes; could not see the highway due to the drink cooler and window posters, and only heard the loud bang before going outside ~10-15 s later.',
      citation: 'Depo Witness D 07:38-08:47, 13:39-14:45, 18:02-19:22, 41:40-42:18',
    },
  ];

  // ---------- 10. FACTS (Every key dimension, speed, timing, and witness position/disagreement) ----------
  const facts = [
    {
      id: 'fact_impact_time',
      kind: 'time',
      text: 'Collision timestamp from Vehicle A ECU power contactor / cascading error messages: 16:36:12.7 EDT on May 7, 2016 (t = 10.43 s after cresting hill at 345 m / 33.08 m/s).',
      value: 10.43,
      unit: 's',
      citation: 'docket_har1702.txt p.15, p.29; docket_tech_recon_factual.txt p.12; facts.md F1, F28',
    },
    {
      id: 'fact_car_speed',
      kind: 'speed',
      text: 'Vehicle A (2015 sedan) traveling eastbound at constant 74 mph (33.08 m/s) with Traffic-Aware Cruise Control (TACC) set to 74 mph 1 min 51 s before impact and Autosteer active.',
      value: 33.08,
      unit: 'm/s',
      citation: 'docket_har1702.txt p.11, p.13, p.15; docket_tech_recon_factual.txt p.12',
    },
    {
      id: 'fact_posted_speed_limit',
      kind: 'speed',
      text: 'Posted speed limit on US-27A at crash location is 65 mph (29.06 m/s); design speed 70 mph; 85th percentile speed 69 mph.',
      value: 29.06,
      unit: 'm/s',
      citation: 'docket_har1702.txt p.11, p.22; docket_highway_att5_spot_speed.txt p.2',
    },
    {
      id: 'fact_crest_distance',
      kind: 'distance',
      text: 'Vertical hill crest on eastbound US-27A is 1,132 ft (345.0 m) west of the NE 140th Court intersection, with a 2.15% descending grade for 1,459 ft (444.7 m).',
      value: 345.0,
      unit: 'm',
      citation: 'docket_har1702.txt p.22, p.29; docket_tech_recon_factual.txt p.3; docket_highway_factual.txt p.10',
    },
    {
      id: 'fact_sight_time',
      kind: 'time',
      text: 'At 74 mph over the 1,132 ft (345 m) sight distance from the vertical crest, both drivers had up to 10.4 seconds of unobstructed line of sight.',
      value: 10.4,
      unit: 's',
      citation: 'docket_har1702.txt p.29; docket_vehicle_dynamics_study.txt p.1-2',
    },
    {
      id: 'fact_lane_width',
      kind: 'distance',
      text: 'US-27A has four 12-ft (3.66 m) through travel lanes (two eastbound, two westbound), with 2-ft (0.61 m) inside shoulders and 5-ft (1.52 m) outside paved shoulders.',
      value: 3.66,
      unit: 'm',
      citation: 'docket_har1702.txt p.13, p.21; docket_highway_factual.txt p.9',
    },
    {
      id: 'fact_median_width',
      kind: 'distance',
      text: 'US-27A grass median is ~60 ft (18.29 m) wide; total separation including left-turn lane and shoulders is 78 ft (23.77 m), with a 130 ft (39.6 m) paved median crossover.',
      value: 23.77,
      unit: 'm',
      citation: 'docket_har1702.txt p.13, p.21, p.29 fn.53; docket_tech_recon_factual.txt p.3-4',
    },
    {
      id: 'fact_turn_lane_length',
      kind: 'distance',
      text: 'Left-turn lanes on US-27A extend approximately 550 ft (167.6 m; measured 557 ft WB and 528 ft EB) in advance of the intersection.',
      value: 167.6,
      unit: 'm',
      citation: 'docket_har1702.txt p.13; docket_tech_recon_factual.txt p.4; docket_highway_factual.txt p.9',
    },
    {
      id: 'fact_combination_length',
      kind: 'distance',
      text: 'Overall length of the 2014 truck-tractor and 2003 53-ft semitrailer combination was 71 ft 7 in (21.82 m); impact was centered 45 ft 5 in (13.84 m) rearward of the tractor front.',
      value: 13.84,
      unit: 'm',
      citation: 'docket_har1702.txt p.6 fn.6; docket_tech_recon_factual.txt p.10-11',
    },
    {
      id: 'fact_no_preimpact_skids',
      kind: 'skid',
      text: 'No pre-collision braking or evasive steering roadway marks were found for either vehicle; a 11.5 ft (3.51 m) vertical-loading tire friction mark was documented at the POI.',
      value: 0,
      unit: 'm',
      citation: 'docket_har1702.txt p.15, p.28; docket_tech_recon_factual.txt p.4-5 Fig. 1',
    },
    {
      id: 'fact_post_impact_departure',
      kind: 'distance',
      text: 'After passing beneath the semitrailer, Vehicle A traveled at a 1.7 deg angle to the right, departing the paved roadway ~326 ft (99.4 m) east of the POI.',
      value: 99.4,
      unit: 'm',
      citation: 'docket_crash_summary.txt p.2; docket_tech_recon_factual.txt p.4',
    },
    {
      id: 'fact_pole_strike_time',
      kind: 'time',
      text: 'Vehicle A airbags deployed at 16:36:21.1 EDT (8.4 seconds after initial impact with the semitrailer) when it struck and severed the utility pole at 49.05 mph (21.93 m/s).',
      value: 8.4,
      unit: 's',
      citation: 'docket_har1702.txt p.15; docket_tech_recon_factual.txt p.13',
    },
    {
      id: 'fact_post_impact_total_distance',
      kind: 'distance',
      text: 'Vehicle A traveled a total linear distance of 910 ft (277.4 m) from the POI, coming to rest 55 ft (16.8 m) east of the severed utility pole, facing north.',
      value: 277.4,
      unit: 'm',
      citation: 'docket_har1702.txt p.11, p.13 Fig. 2; docket_tech_recon_factual.txt p.4-5',
    },
    {
      id: 'fact_witness_A_position',
      kind: 'position',
      text: 'Witness A was driving westbound in the outside lane at ~60 mph (26.82 m/s) about 0.25 mi (402 m) east of the truck, reaching the WB left-turn lane taper just after impact.',
      value: 257.26,
      unit: 'm',
      citation: 'docket_har1702.txt p.11-12, p.29-30; docket_vehicle_dynamics_study.txt p.4; witness_A.md p.1',
    },
    {
      id: 'fact_witness_B_marked_position_disagreement',
      kind: 'position',
      text: 'Witness B testified she stood "out front of the store" with an unobstructed view of Vehicle A all the way to impact, but her pen mark #2 on Exhibit 4 (Depo Witness B 1:54:30) places her at [7.5, 0, 12.0] m — south of the bench shelter (Z=8.2 m, opaque sheet-metal back) and west/northwest of the store corner, which together with the turning trailer occlude parts of the approach.',
      value: 7.5,
      unit: 'm',
      citation: 'Depo Witness B 41:10-41:20, 52:00-52:07, 1:54:30 (Exhibit 4 mark #2); Depo Witness D 10:16-10:29; exhibit4_intersection_map.png',
    },
    {
      id: 'fact_witness_C_position',
      kind: 'position',
      text: 'Witness C was stopped in a pickup in the westbound inside lane of US-27A at [-18.0, 0, -31.09] m (18 m west of the NE 140th Ct crossover).',
      value: -18.0,
      unit: 'm',
      citation: 'witness_C.md p.1; police_report.md p.1',
    },
    {
      id: 'fact_witness_D_position',
      kind: 'position',
      text: 'Witness D (store counter clerk) was inside the retail store behind the register at [24.0, 0, 15.0] m; the drink cooler and window posters blocked any view of the highway.',
      value: 24.0,
      unit: 'm',
      citation: 'Depo Witness D 06:39-08:47, 18:02-18:45, 41:40-42:18',
    },
  ];

  // No pre-impact braking skid marks were recorded for either vehicle (docket_har1702.txt p.15, p.28; facts.md F22)
  const skids = [];

  // ---------- 11. DETERMINISTIC TIMELINE UPDATE setTime(t) ----------
  const duration = 25.0;

  function setTime(t) {
    const clampedT = Math.max(0, Math.min(duration, t));

    // 1. Update Vehicle A (2015 Sedan)
    const stateA = sampleHermite(carKeyframes, clampedT);
    vehA.node.position.set(stateA.x, ry(stateA.x, stateA.z), stateA.z);
    vehA.node.rotation.y = -stateA.headingDeg * D2R;

    // 2. Update Vehicle T (Tractor + Articulated Semitrailer)
    const stateTrac = sampleHermite(tractorKeyframes, clampedT);
    vehTractor.node.position.set(stateTrac.x, ry(stateTrac.x, stateTrac.z), stateTrac.z);
    vehTractor.node.rotation.y = -stateTrac.headingDeg * D2R;

    // Articulated semitrailer coupled at fifth-wheel / kingpin
    // Fifth wheel is ~1.75 m behind tractor center along tractor's local +Z (rearward) axis.
    // Semitrailer kingpinOffset (along local -Z forward axis) is ~6.60 m from trailer footprint center (or node.userData.kingpinOffset).
    const tracRad = stateTrac.headingDeg * D2R;
    const fifthWheelOffset = -1.75; // meters forward of tractor center (negative = behind center)
    const kx = stateTrac.x + Math.sin(tracRad) * fifthWheelOffset;
    const kz = stateTrac.z - Math.cos(tracRad) * fifthWheelOffset;

    const trailHeadingDeg = sampleScalar(trailerHeadingKeyframes, clampedT);
    const trailRad = trailHeadingDeg * D2R;
    const kpOffset = vehTrailer.node.userData?.kingpinOffset ?? 6.6;
    const tx = kx - Math.sin(trailRad) * kpOffset;
    const tz = kz + Math.cos(trailRad) * kpOffset;

    vehTrailer.node.position.set(tx, ry(tx, tz), tz);
    vehTrailer.node.rotation.y = -trailHeadingDeg * D2R;

    // 3. Update Witness A Pickup
    const stateWitA = sampleHermite(witAKeyframes, clampedT);
    vehWitA.node.position.set(stateWitA.x, ry(stateWitA.x, stateWitA.z), stateWitA.z);
    vehWitA.node.rotation.y = -stateWitA.headingDeg * D2R;

    // 4. Witness C Pickup remains stationary at [-18.0, -31.09]
    vehWitC.node.position.set(-18.0, ry(-18.0, -31.09), -31.09);
    vehWitC.node.rotation.y = -270 * D2R;
  }

  // Initialize scene at t = 0
  setTime(0);

  return {
    meta: {
      caseId: 'demo-full',
      title: 'NTSB/HAR-17/02 (HWY16FH018) — US-27A & NE 140th Court, Williston, FL (May 7, 2016)',
      date: '2016-05-07',
      timeOfDay: '16:36',
      timeZone: 'America/New_York',
      utcOffset: '-04:00',
      lat: 29.4106,
      lon: -82.5393,
      lighting: 'day',
      weather: 'clear',
      source: 'NTSB Highway Accident Report NTSB/HAR-17/02 (Docket HWY16FH018)',
      impactT: 10.43,
    },
    root,
    duration,
    setTime,
    objects,
    witnesses,
    facts,
    skids,
  };
}
