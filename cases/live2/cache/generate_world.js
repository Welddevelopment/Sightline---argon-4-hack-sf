// caseId: live2 — NTSB/HAR-17/02 (HWY16FH018): Car into turning tractor-semitrailer, US-27A at NE 140th Ct, Levy County, FL, 2016-05-07 16:36:12.7 EDT.
// Origin (0,0,0) = POI in center of EB outside lane on NE 140th Ct centerline (police_report.txt p.3; facts.txt). +X=East, -Z=North.
// US-27A: 4-lane divided (12 ft = 3.66 m lanes), ~60 ft (18.29 m) grass median, 130 ft (39.6 m) crossover; highway center z = -12.805 m (facts.txt F6-F8).
// Crest: 1,132 ft (345.03 m) W of intersection (facts.txt F10, F28). At 74 mph (33.08 m/s), impactT = 10.43 s.
// Contact: Veh A front (x=0 at t=10.43, center x=-2.45) hits Veh T trailer right side (center x=1.30, heading 180 deg) 45 ft 5 in (13.84 m) behind tractor front (facts.txt F16).
// Witness B: says "by the corner, near the shelter" [7.2, 6.8], but marks Exhibit 4 at Depo 27:05 on the N side of the WB lanes at [-15, -31.5], where the trailer blocks her view of Veh A.
export default function createWorld(THREE, assets) {
  const root = new THREE.Group(), objects = {}, D2R = Math.PI / 180;
  const add = (id, node, kind, label, citation, occludes, x = 0, z = 0, headingDeg = 0, extra = {}) => {
    node.name = id; node.position.set(x, 0, z); node.rotation.y = -headingDeg * D2R; root.add(node);
    return (objects[id] = { node, kind, label, citation, occludes, ...extra });
  };

  root.add(assets.environment({
    date: '2016-05-07', timeOfDay: '16:36:12', utcOffset: '-04:00', timeZone: 'America/New_York',
    lat: 29.40, lon: -82.53, lighting: 'day', weather: 'clear'
  }));
  root.add(assets.groundPlane({ id: 'ground', size: 1400, kind: 'grass' }));

  add('road_us27a', assets.road({
    id: 'road_us27a', lanes: 4, laneWidth: 3.66, length: 1200, divided: true, medianWidth: 18.29,
    markings: 'center_dashed', edgeLines: true, shoulder: 1.52, openings: [{ at: 0, width: 39.6 }]
  }), 'road', 'US-27A (4-lane divided highway, 60 ft median, 12 ft lanes)', 'facts.txt F6-F8; police_report.txt p.1, p.3', false, 0, -12.805, 90);

  add('road_wb_turn', assets.road({
    id: 'road_wb_turn', lanes: 1, laneWidth: 3.66, length: 167.6, markings: 'none', edgeLines: true, shoulder: 0
  }), 'road', 'US-27A WB left-turn lane (550 ft)', 'facts.txt F8; police_report.txt p.3; evidence/map.png', false, 103.6, -20.12, 90);

  add('road_140th', assets.road({
    id: 'road_140th', lanes: 2, laneWidth: 3.05, length: 140, markings: 'none', edgeLines: false, shoulder: 0
  }), 'road', 'NE 140th Court (local paved side road, 6.1 m wide)', 'inferred: facts.txt F11 and modeling assumptions (6.1 m width, straightened to 90 deg)', false, 0, 71.8, 0);

  add('occ_crest', assets.building({ id: 'occ_crest', w: 4, d: 60, h: 1.2, kind: 'generic' }),
    'terrain', 'Vertical hill crest (1,132 ft / 345 m west of intersection, approximated as low terrain proxy)',
    'inferred: facts.txt F10, F27-F28 (crest at 345 m W limits sight distance); approximated as building', true, -352, -12.8, 0);

  add('bld_store', assets.building({ id: 'bld_store', w: 18, d: 12, h: 4.5, kind: 'store' }),
    'building', 'Retail convenience/feed store on SE corner', 'inferred: police_report.txt p.1; evidence/map.png scale bar (~18x12 m); height assumed', true, 18, 17, 0);

  add('occ_shelter', assets.shelter({ id: 'occ_shelter', open: true }),
    'shelter', 'Open-sided bench shelter in front of retail store', 'Depo 09:05; evidence/map.png; facts.txt modeling assumptions', false, 8.8, 6.8, 0);

  add('sig_stop', assets.sign({ id: 'sig_stop', kind: 'stop', text: 'STOP' }),
    'sign', 'Stop sign on NE 140th Ct approach', 'inferred: police_report.txt p.1 (stop sign on NE 140th Ct approach); position estimated', false, 4.2, 6.0, 180);

  add('sig_speed', assets.sign({ id: 'sig_speed', kind: 'speed_limit', text: '65' }),
    'sign', 'Speed limit 65 mph sign on US-27A EB', 'inferred: facts.txt F13; police_report.txt p.1 (posted 65 mph); position estimated', false, -120, 4.5, 90);

  add('occ_pole', assets.pole({ id: 'occ_pole', height: 9 }),
    'pole', 'Wooden utility pole on south roadside (struck by Vehicle A at t=18.83 s)', 'inferred: facts.txt F24, F26 (pole strike 8.4 s after impact); position estimated along post-impact path', false, 200, 14.2, 0);

  add('mark_poi', assets.impactMarker({ id: 'mark_poi', position: [0, 0] }),
    'marker', 'Initial Point of Impact (POI) in EB outside lane at NE 140th Ct', 'police_report.txt p.3; evidence/map.png', false);

  add('veh_A', assets.vehicle('sedan', { id: 'veh_A', color: '#2b2d34' }),
    'vehicle', 'Vehicle A (2015 4-door sedan, dark color, eastbound at 74 mph)', 'facts.txt F14, F17; Depo 15:45', true);
  objects.veh_A.node.userData.setLights(false);

  add('veh_T_tractor', assets.vehicle('truck_tractor', { id: 'veh_T_tractor', color: '#2c3540' }),
    'vehicle', 'Vehicle T Tractor (2014 conventional truck-tractor, dark cab)', 'facts.txt F15; Depo 13:12', true);

  add('veh_T_trailer', assets.vehicle('semitrailer', { id: 'veh_T_trailer', color: '#f5f5f5' }),
    'vehicle', 'Vehicle T Semitrailer (2003 white refrigerated van semitrailer)', 'facts.txt F15; Depo 13:12', true);

  add('veh_witA', assets.vehicle('sedan', { id: 'veh_witA', color: '#6b7280' }),
    'vehicle', 'Witness A vehicle (westbound in outside lane ~0.25 mi behind truck at 60 mph)', 'witness_A.txt p.1; facts.txt F30', true);

  add('veh_witC', assets.vehicle('pickup', { id: 'veh_witC', color: '#4a5568' }),
    'vehicle', 'Witness C pickup (stopped in WB inside lane 18 m west of crossover)', 'witness_C.txt p.1', true);

  add('ped_witB_marked', assets.pedestrian({ id: 'ped_witB_marked', height: 1.65 }),
    'pedestrian', 'Witness B at Exhibit 4 marked position (north of WB lanes)', 'Depo 27:05 (Exhibit 4 red X mark)', false, -15.0, -31.5, 135);

  const K = {
    veh_A: [
      [0, -347.82, 0, 90, 33.08],
      [10.43, -2.45, 0, 90, 33.08],
      [11.0, 14.5, 0.4, 93, 28.0],
      [18.83, 198.0, 14.2, 95, 16.0],
      [25.0, 277.0, 20.0, 0, 0]
    ],
    veh_T_tractor: [
      [0, 14.0, -20.12, 270, 0.8],
      [2.5, 11.0, -20.12, 270, 2.2],
      [6.0, 3.5, -16.5, 225, 3.8],
      [10.43, 1.30, 8.21, 180, 5.5],
      [14.0, 1.30, 26.0, 180, 4.0],
      [18.5, 1.30, 40.0, 180, 0]
    ],
    veh_T_trailer: [
      [0, 23.09, -20.12, 270, 0.8],
      [2.5, 20.09, -20.12, 270, 2.2],
      [6.0, 11.2, -19.2, 250, 3.5],
      [10.43, 1.30, -0.88, 180, 5.5],
      [14.0, 1.30, 16.91, 180, 4.0],
      [18.5, 1.30, 30.91, 180, 0]
    ],
    veh_witA: [
      [0, 415.0, -27.44, 270, 26.82],
      [10.43, 135.3, -27.44, 270, 26.82],
      [15.0, 25.0, -27.44, 270, 18.0],
      [21.0, -45.0, -29.8, 270, 0]
    ],
    veh_witC: [
      [0, -18.0, -23.78, 270, 0],
      [25.0, -18.0, -23.78, 270, 0]
    ]
  };

  const pose = (k, t) => {
    if (t <= k[0][0]) return k[0].slice(1, 4);
    let i = 0; while (i < k.length - 2 && t > k[i + 1][0]) i++;
    const a = k[i], b = k[i + 1]; if (t >= b[0]) return b.slice(1, 4);
    const T = b[0] - a[0], u = (t - a[0]) / T, u2 = u * u, u3 = u2 * u, h10 = u3 - 2 * u2 + u, h01 = 3 * u2 - 2 * u3, h11 = u3 - u2;
    const vx = (p) => p[4] * Math.sin(p[3] * D2R) * T, vz = (p) => -p[4] * Math.cos(p[3] * D2R) * T;
    let dh = b[3] - a[3]; dh -= 360 * Math.round(dh / 360);
    return [a[1] + (b[1] - a[1]) * h01 + vx(a) * h10 + vx(b) * h11, a[2] + (b[2] - a[2]) * h01 + vz(a) * h10 + vz(b) * h11, a[3] + dh * h01];
  };

  const duration = 25;
  function setTime(t) {
    t = Math.min(Math.max(t, 0), duration);
    for (const id in K) {
      const [x, z, h] = pose(K[id], t);
      objects[id].node.position.set(x, 0, z);
      objects[id].node.rotation.y = -h * D2R;
    }
    root.updateMatrixWorld(true);
  }

  const witnesses = [
    {
      id: 'wit_B', name: 'Witness B (at Exhibit 4 marked position)',
      position: [-15.0, 0, -31.5], eyeHeight: 1.6, lookAt: 'veh_A', observationTime: 9.8,
      claim: 'I had a clear view of the car the whole way in. I watched it right up until the moment it hit. Nothing was in the way.',
      citation: 'Depo 27:05 (Exhibit 4 red X mark on WB shoulder N of highway); Depo 27:46-28:27'
    },
    {
      id: 'wit_A', name: 'Witness A (westbound driver)',
      position: [152.2, 0, -27.44], eyeHeight: 1.2, lookAt: 'veh_A', observationTime: 9.8,
      claim: 'Once the trailer was out across the eastbound lanes, it blocked my view of the car. I didn\'t see the car hit the trailer.',
      citation: 'witness_A.txt p.1; facts.txt F30 (~0.25 mi behind truck at 60 mph in WB outside lane)'
    },
    {
      id: 'wit_C', name: 'Witness C (stopped pickup in WB inside lane)',
      position: [-18.0, 0, -23.78], eyeHeight: 1.5, lookAt: 'veh_T_trailer', observationTime: 9.8,
      claim: 'I was watching the truck, not the other side of the road... It was one loud crunch, and then I saw the car come out the far side heading east.',
      citation: 'witness_C.txt p.1 (stopped in WB inside lane 18 m west of NE 140th Ct)'
    }
  ];

  const facts = [
    { id: 'f_speed_A', text: 'Vehicle A cruise control set to 74 mph; speed 74 mph (33.08 m/s) at impact with no braking', value: 74, unit: 'mph', citation: 'facts.txt F17, F18; police_report.txt p.3', kind: 'speed' },
    { id: 'f_crest_dist', text: 'Vertical crest 1,132 ft (345 m) west of intersection center limits sight distance', value: 345, unit: 'm', citation: 'facts.txt F10, F27, F28; police_report.txt p.3', kind: 'distance' },
    { id: 'f_sight_time', text: 'Maximum mutual visibility time between crest and impact at 74 mph', value: 10.4, unit: 's', citation: 'facts.txt F28; police_report.txt p.3', kind: 'time' },
    { id: 'f_impact_offset', text: 'Impact on semitrailer centered 45 ft 5 in (13.84 m) behind front of tractor', value: 13.84, unit: 'm', citation: 'facts.txt F16; police_report.txt p.1, p.3', kind: 'distance' },
    { id: 'f_post_impact_A', text: 'Vehicle A traveled 910 ft (277 m) post-impact before coming to rest in yard', value: 277, unit: 'm', citation: 'facts.txt F25; police_report.txt p.2, p.3', kind: 'distance' },
    { id: 'f_pole_time', text: 'Vehicle A struck utility pole and deployed airbags 8.4 s after initial impact', value: 8.4, unit: 's', citation: 'facts.txt F26; police_report.txt p.3', kind: 'time' },
    { id: 'f_median_width', text: 'Grass median width about 60 ft (18.29 m) with 130 ft (39.6 m) crossover', value: 18.29, unit: 'm', citation: 'facts.txt F7, F8; police_report.txt p.3', kind: 'distance' },
    { id: 'f_witB_marked_pos', text: 'Witness B marked her standing position on Exhibit 4 on the north side of the WB lanes [-15.0, -31.5], contradicting her spoken claim of standing by the SE corner store shelter [7.2, 6.8]', value: -31.5, unit: 'm', citation: 'Depo 27:05 (visual red X mark on Exhibit 4 vs spoken testimony at Depo 09:05, 27:04)', kind: 'position' },
    { id: 'f_witB_spoken_pos', text: 'Witness B verbally testified she was standing by the store corner near the bench shelter on the south side [7.2, 6.8]', value: 6.8, unit: 'm', citation: 'Depo 09:05, 27:04; evidence/map.png', kind: 'position' },
    { id: 'f_truck_rest_pos', text: 'Vehicle T came to a stop on NE 140th Court south of the retail store', value: 40, unit: 'm', citation: 'facts.txt F12; police_report.txt p.2, p.3; Depo 26:38 (Exhibit 4 mark)', kind: 'position' },
    { id: 'f_witA_pos', text: 'Witness A was driving westbound in the outside lane about 0.25 mi (402 m) behind the truck at 60 mph (26.82 m/s)', value: 152.2, unit: 'm', citation: 'witness_A.txt p.1; facts.txt F30', kind: 'position' },
    { id: 'f_witC_pos', text: 'Witness C was stopped in a pickup in the WB inside lane about 18 m west of the side road', value: -18, unit: 'm', citation: 'witness_C.txt p.1', kind: 'position' }
  ];

  const world = {
    meta: {
      caseId: 'live2',
      title: 'US-27A at NE 140th Court — Car into Turning Tractor-Semitrailer (NTSB HWY16FH018)',
      date: '2016-05-07', timeOfDay: '16:36', timeZone: 'America/New_York', utcOffset: '-04:00',
      lat: 29.40, lon: -82.53, lighting: 'day', weather: 'clear',
      source: 'NTSB/HAR-17/02 (HWY16FH018); police_report.txt; deposition.mp4',
      impactT: 10.43
    },
    root, duration, setTime, objects, witnesses, facts, skids: []
  };
  setTime(0);
  return world;
}
