// Round 2 patch: Move Witness B (wit_B / ped_witB) from erroneous WB lane position [-4, 0, -29.3] to her actual red-X mark on Exhibit 4 on the SE corner near the bench shelter [5.5, 0, 4.0] (Depo 27:05–27:13; evidence/map.png), refine Vehicle T turn keyframes at impact to match the 13.84 m tractor-front-to-POI offset and eliminate acceleration spikes (facts.txt F15, F16), set occludes: false on witness vehicles veh_witA and veh_witC to prevent self-occlusion, and include date/lat/lon in meta.
// caseId: live2 — US-27A at NE 140th Ct, Levy County, FL (May 7, 2016, 16:36 EDT; NTSB/HAR-17/02 HWY16FH018)
// Origin (0,0,0) = POI in center of EB outside lane on NE 140th Ct centerline (facts.txt Modeling assumptions; police_report.txt p.3).
// +X = east, -Z = north. EB lanes z=[-5.49, 1.83] (center -1.83); median z=[-23.78,-5.49]; WB turn lane z=-25.60; WB lanes z=[-34.75,-27.43].
// Event clock: t=0 car at vertical crest x=-345m; impact at t=10.43s (345m / 33.08m/s); pole strike t=18.83s; car rest x=277m at t=26s.
export default function createWorld(THREE, assets) {
  const root = new THREE.Group(), objects = {}, D2R = Math.PI / 180;
  const add = (id, node, kind, label, citation, occludes, x = 0, z = 0, headingDeg = 0, extra = {}) => {
    node.name = id; node.position.set(x, 0, z); node.rotation.y = -headingDeg * D2R; root.add(node);
    return (objects[id] = { node, kind, label, citation, occludes, ...extra });
  };
  root.add(assets.environment({ timeOfDay: '16:36', date: '2016-05-07', utcOffset: '-04:00', lat: 29.39, lon: -82.53, lighting: 'day', weather: 'clear' }));
  root.add(assets.groundPlane({ id: 'ground', size: 1200, kind: 'grass' }));

  add('road_eb', assets.road({ id: 'road_eb', lanes: 2, laneWidth: 3.66, length: 900, markings: 'center_dashed', edgeLines: true, shoulder: 1.52 }), 'road', 'US-27A Eastbound (2×12 ft lanes)', 'facts.txt F6; police_report.txt p.3', false, -50, -1.83, 90);
  add('road_wb', assets.road({ id: 'road_wb', lanes: 2, laneWidth: 3.66, length: 900, markings: 'center_dashed', edgeLines: true, shoulder: 1.52 }), 'road', 'US-27A Westbound (2×12 ft lanes)', 'facts.txt F6; police_report.txt p.3', false, -50, -31.09, 90);
  add('road_wb_turn', assets.road({ id: 'road_wb_turn', lanes: 1, laneWidth: 3.66, length: 168, markings: 'none', edgeLines: true, shoulder: 0 }), 'road', 'WB left-turn lane (550 ft)', 'facts.txt F8; evidence/map.png', false, 94, -25.60, 90);
  add('road_crossover', assets.road({ id: 'road_crossover', lanes: 2, laneWidth: 3.66, length: 24, markings: 'none', edgeLines: false, shoulder: 2 }), 'road', 'Median crossover at NE 140th Ct', 'facts.txt F8; evidence/map.png', false, 0, -15.5, 0);
  add('road_median_w', assets.median({ id: 'road_median_w', width: 18.29, length: 400 }), 'road', 'Grass median west (~60 ft wide)', 'facts.txt F7; evidence/map.png', false, -220, -14.63, 90);
  add('road_median_e', assets.median({ id: 'road_median_e', width: 18.29, length: 400 }), 'road', 'Grass median east (~60 ft wide)', 'facts.txt F7; evidence/map.png', false, 220, -14.63, 90);
  add('road_140th', assets.road({ id: 'road_140th', lanes: 2, laneWidth: 3.05, length: 120, markings: 'none', edgeLines: false, shoulder: 0 }), 'road', 'NE 140th Court (6.1 m wide)', 'facts.txt F11, Modeling assumptions; evidence/map.png', false, 0, 61.8, 0);

  add('bld_store', assets.building({ id: 'bld_store', w: 18, d: 12, h: 4.5, kind: 'store' }), 'building', 'Retail store on SE corner', 'inferred: footprint from evidence/map.png scale bar; facts.txt F12, Modeling assumptions', true, 18, 16, 0);
  add('occ_shelter', assets.shelter({ id: 'occ_shelter', open: true }), 'occluder', 'Open-sided bench shelter in front of store', 'facts.txt Modeling assumptions; evidence/map.png; Depo 09:05', false, 8, 5.5, 90);
  add('sig_stop', assets.sign({ id: 'sig_stop', kind: 'stop', text: 'STOP' }), 'signal', 'Stop sign on NE 140th Ct approach', 'inferred: position on SE corner from police_report.txt p.1', false, 4.2, 6.0, 180, { state: () => 'red' });
  add('sig_speed', assets.sign({ id: 'sig_speed', kind: 'speed_limit', text: '65' }), 'signal', 'Speed limit 65 mph sign', 'inferred: typical roadside placement; facts.txt F13', false, -60, 4.5, 270, { state: () => 'green' });
  add('occ_pole', assets.pole({ id: 'occ_pole', height: 10 }), 'occluder', 'Wooden utility pole struck by Vehicle A (~8.4 s post-impact)', 'inferred: position ~185 m E of POI from 8.4 s post-impact travel (facts.txt F24, F26)', false, 185, 9.0, 0);
  add('bld_house', assets.building({ id: 'bld_house', w: 14, d: 12, h: 4.2, kind: 'house' }), 'building', 'Residence near Vehicle A final rest', 'inferred: house near final rest at 277 m (facts.txt F25; police_report.txt p.2)', true, 277, 25, 0);
  add('occ_crest', assets.building({ id: 'occ_crest', w: 4, d: 50, h: 4.0, kind: 'generic' }), 'occluder', 'Vertical crest sight-line proxy (1,132 ft / 345 m W of POI)', 'inferred: terrain crest at -345 m approximated as building occluder behind crest (facts.txt F10, F27)', true, -352, -16, 0);
  add('mark_poi', assets.impactMarker({ id: 'mark_poi', position: [0, 0] }), 'mark', 'Point of Impact (POI)', 'facts.txt F21, Modeling assumptions; evidence/map.png', false, 0, 0, 0);

  const K = {
    veh_A: [
      [0, -345, 0, 90, 33.08],
      [10.43, 0, 0, 90, 33.08],
      [18.83, 185, 9, 93, 14.0],
      [26.0, 277, 14, 0, 0]
    ],
    veh_T_tractor: [
      [0.0, 12.0, -25.6, 270, 1.5],
      [3.0, 6.0, -22.5, 230, 3.2],
      [6.5, 1.0, -10.5, 190, 4.5],
      [10.43, 0.0, 9.5, 180, 5.0],
      [14.5, 0.0, 26.0, 180, 3.0],
      [18.0, 0.0, 32.0, 180, 0.0]
    ],
    veh_T_trailer: [
      [0.0, 19.5, -25.6, 270, 1.5],
      [3.0, 13.5, -24.2, 250, 3.0],
      [6.5, 4.2, -16.0, 205, 4.2],
      [10.43, 0.2, 2.2, 182, 5.0],
      [14.5, 0.0, 19.0, 180, 3.0],
      [18.0, 0.0, 25.0, 180, 0.0]
    ],
    veh_witA: [
      [0, 420, -32.92, 270, 26.82],
      [10.43, 140, -32.92, 270, 26.82],
      [18.0, -20, -35.5, 270, 0],
      [26.0, -20, -35.5, 270, 0]
    ],
    veh_witC: [
      [0, -18, -29.26, 270, 0],
      [26.0, -18, -29.26, 270, 0]
    ]
  };

  add('veh_A', assets.vehicle('sedan', { id: 'veh_A', color: '#2b323b' }), 'vehicle', 'Vehicle A (2015 4-door sedan, eastbound at 74 mph)', 'facts.txt F14, F17; police_report.txt p.1', true);
  objects.veh_A.node.userData.setLights(false);
  add('veh_T_tractor', assets.vehicle('truck_tractor', { id: 'veh_T_tractor', color: '#2c3539' }), 'vehicle', 'Vehicle T Tractor (2014 truck-tractor)', 'facts.txt F15, F19; Depo 13:25', true);
  add('veh_T_trailer', assets.vehicle('semitrailer', { id: 'veh_T_trailer', color: '#f5f5f5' }), 'vehicle', 'Vehicle T Semitrailer (2003 53-ft refrigerated van)', 'facts.txt F15, F16; Depo 13:13', true);
  add('veh_witA', assets.vehicle('sedan', { id: 'veh_witA', color: '#6b7b8c' }), 'vehicle', 'Witness A vehicle (westbound motorist ~0.25 mi behind truck)', 'witness_A.txt p.1; facts.txt F30', false);
  add('veh_witC', assets.vehicle('pickup', { id: 'veh_witC', color: '#5c5346' }), 'vehicle', 'Witness C pickup (stopped in WB inside lane 18 m W of crossover)', 'witness_C.txt p.1', false);
  add('ped_witB', assets.pedestrian({ id: 'ped_witB', height: 1.68 }), 'pedestrian', 'Witness B (at Exhibit 4 video-marked position on SE corner near shelter)', 'Depo 27:05-27:13 (evidence/deposition.mp4 27:05); evidence/map.png', false, 5.5, 4.0, 290);

  const pose = (k, t) => {
    if (t <= k[0][0]) return k[0].slice(1, 4);
    let i = 0; while (i < k.length - 2 && t > k[i + 1][0]) i++;
    const a = k[i], b = k[i + 1]; if (t >= b[0]) return b.slice(1, 4);
    const T = b[0] - a[0], u = (t - a[0]) / T, u2 = u * u, u3 = u2 * u, h10 = u3 - 2 * u2 + u, h01 = 3 * u2 - 2 * u3, h11 = u3 - u2;
    const vx = (p) => p[4] * Math.sin(p[3] * D2R) * T, vz = (p) => -p[4] * Math.cos(p[3] * D2R) * T;
    let dh = b[3] - a[3]; dh -= 360 * Math.round(dh / 360);
    return [a[1] + (b[1] - a[1]) * h01 + vx(a) * h10 + vx(b) * h11, a[2] + (b[2] - a[2]) * h01 + vz(a) * h10 + vz(b) * h11, a[3] + dh * h01];
  };

  const duration = 26.0;
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
      id: 'wit_B',
      name: 'Witness B (fictional pedestrian)',
      position: [5.5, 0, 4.0],
      eyeHeight: 1.6,
      lookAt: 'veh_A',
      observationTime: 9.8,
      claim: 'I had a clear view of the car the whole way in. I watched it right up until the moment it hit. Nothing was in the way.',
      citation: 'Depo 27:05-27:13 (video mark on Exhibit 4 on SE corner near bench shelter at [5.5, 0, 4.0]); Depo 27:47–28:27'
    },
    {
      id: 'wit_A',
      name: 'Witness A (fictional westbound driver)',
      position: [156, 0, -32.92],
      eyeHeight: 1.2,
      lookAt: 'veh_A',
      observationTime: 9.8,
      claim: 'Once the trailer was out across the eastbound lanes, it blocked my view of the car. I didn\'t see the car hit the trailer.',
      citation: 'witness_A.txt p.1; facts.txt F30'
    },
    {
      id: 'wit_C',
      name: 'Witness C (fictional stopped pickup driver)',
      position: [-18, 0, -29.26],
      eyeHeight: 1.5,
      lookAt: 'veh_T_trailer',
      observationTime: 9.8,
      claim: 'The truck started across... I was watching the truck, not the other side of the road... It was one loud crunch, and then I saw the car come out the far side.',
      citation: 'witness_C.txt p.1'
    }
  ];

  const facts = [
    { id: 'f_speed_A', text: 'Vehicle A cruise control and pre-impact speed', value: 74, unit: 'mph', citation: 'facts.txt F17; police_report.txt p.3', kind: 'speed' },
    { id: 'f_speed_limit', text: 'Posted speed limit on US-27A', value: 65, unit: 'mph', citation: 'facts.txt F13; police_report.txt p.1', kind: 'speed' },
    { id: 'f_crest_dist', text: 'Vertical crest distance west of intersection center', value: 345, unit: 'm', citation: 'facts.txt F10 (1,132 ft = 345 m); police_report.txt p.3', kind: 'distance' },
    { id: 'f_sight_time', text: 'Maximum sight time from crest to impact at 74 mph', value: 10.4, unit: 's', citation: 'facts.txt F28; police_report.txt p.3', kind: 'time' },
    { id: 'f_median_width', text: 'Grass median width', value: 18.29, unit: 'm', citation: 'facts.txt F7 (60 ft = 18.29 m)', kind: 'distance' },
    { id: 'f_combo_len', text: 'Vehicle T tractor-semitrailer combination length', value: 21.82, unit: 'm', citation: 'facts.txt F15 (71 ft 7 in = 21.82 m)', kind: 'distance' },
    { id: 'f_impact_offset', text: 'Impact point on trailer rearward of tractor front', value: 13.84, unit: 'm', citation: 'facts.txt F16 (45 ft 5 in = 13.84 m)', kind: 'distance' },
    { id: 'f_post_impact_dist', text: 'Vehicle A post-impact travel distance to final rest', value: 277, unit: 'm', citation: 'facts.txt F25 (910 ft = 277 m); police_report.txt p.3', kind: 'distance' },
    { id: 'f_pole_time', text: 'Time from trailer impact to utility pole strike / airbag deployment', value: 8.4, unit: 's', citation: 'facts.txt F26; police_report.txt p.3', kind: 'time' },
    { id: 'f_no_skids', text: 'Pre-collision roadway tire/skid marks from either vehicle', value: 0, unit: 'm', citation: 'facts.txt F22; police_report.txt p.3', kind: 'skid' },
    { id: 'f_witB_pos', text: 'Witness B red X mark on Exhibit 4 in video (Depo 27:05) is on the SE corner in front of the store near the bench shelter at [5.5, 0, 4.0], where the turning semitrailer blocks her view of Vehicle A before impact', value: [5.5, 0, 4.0], unit: 'm', citation: 'Depo 27:05-27:13 (evidence/deposition.mp4 27:05); evidence/map.png', kind: 'position' },
    { id: 'f_witB_truck_rest_mark', text: 'Witness B red mark on Exhibit 4 for Vehicle T final rest on NE 140th Ct south of store', value: [0, 0, 28], unit: 'm', citation: 'Depo 26:38 (evidence/deposition.mp4 26:38); facts.txt F12', kind: 'position' },
    { id: 'f_witA_pos', text: 'Witness A westbound position at observation (~0.25 mi behind truck at 60 mph)', value: [156, 0, -32.92], unit: 'm', citation: 'witness_A.txt p.1; facts.txt F30', kind: 'position' },
    { id: 'f_witC_pos', text: 'Witness C stopped pickup position in WB inside lane 18 m west of crossover', value: [-18, 0, -29.26], unit: 'm', citation: 'witness_C.txt p.1', kind: 'position' }
  ];

  const world = {
    meta: {
      caseId: 'live2',
      title: 'US-27A at NE 140th Court — Car into Turning Tractor-Semitrailer (NTSB HWY16FH018)',
      date: '2016-05-07',
      timeOfDay: '16:36',
      utcOffset: -4,
      lat: 29.39,
      lon: -82.53,
      lighting: 'day',
      source: 'NTSB/HAR-17/02 (HWY16FH018); police_report.txt; facts.txt; deposition.mp4',
      impactT: 10.43
    },
    root,
    duration,
    setTime,
    objects,
    witnesses,
    facts,
    skids: []
  };
  setTime(0);
  return world;
}
