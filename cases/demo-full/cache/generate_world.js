/*
 * Case: demo-full — NTSB HWY16FH018 (US-27A at NE 140th Ct, Williston, FL, 2016-05-07 16:36 EDT)
 * Frame: Origin (0,0,0) = POI in center of EB outside lane on NE 140th Ct centerline (police_report.md p.3, Exhibit 4).
 * +X = east, -Z = north, Y = up. Event clock t=0 when Vehicle A crests grade 1,132 ft (345 m) west of POI (HAR-17/02 p.29).
 * Impact at t=10.43 s (345 m / 33.08 m/s at 74 mph; HAR-17/02 p.15, p.29). Pole strike at t=18.83 s (+8.4 s; HAR-17/02 p.5).
 * Rest at 910 ft (277.4 m) east of POI (HAR-17/02 p.1). Witness B marks (8, 9) behind bench shelter on Exhibit 4 (Depo Witness B 1:54:30).
 */
export default function createWorld(THREE, assets) {
  const root = new THREE.Group(), objects = {}, D2R = Math.PI / 180;
  const add = (id, node, kind, label, citation, occludes, x = 0, z = 0, headingDeg = 0, extra = {}) => {
    node.name = id; node.position.set(x, 0, z); node.rotation.y = -headingDeg * D2R; root.add(node);
    return (objects[id] = { node, kind, label, citation, occludes, ...extra });
  };

  root.add(assets.environment({
    date: '2016-05-07', timeOfDay: '16:36', utcOffset: '-04:00', timeZone: 'America/New_York',
    lat: 29.4106, lon: -82.53979, lighting: 'day', weather: 'clear'
  }));
  root.add(assets.groundPlane({ id: 'ground', size: 1400, kind: 'grass' }));

  add('road_eb', assets.road({ id: 'road_eb', lanes: 2, laneWidth: 3.66, length: 1200, markings: 'center_dashed', edgeLines: true, shoulder: 1.52 }),
    'road', 'US-27A Eastbound (2×12 ft lanes, 5 ft right shoulder)', 'HAR-17/02 p.3, p.21; police_report.md p.3', false, 0, -1.83, 90);
  add('road_wb', assets.road({ id: 'road_wb', lanes: 2, laneWidth: 3.66, length: 1200, markings: 'center_dashed', edgeLines: true, shoulder: 1.52 }),
    'road', 'US-27A Westbound (2×12 ft lanes, 5 ft right shoulder)', 'HAR-17/02 p.3, p.21; police_report.md p.3', false, 0, -29.26, 90);
  add('road_wb_turn', assets.road({ id: 'road_wb_turn', lanes: 1, laneWidth: 3.66, length: 168, markings: 'none', edgeLines: true, shoulder: 0 }),
    'road', 'US-27A WB Left-Turn Lane (~550 ft)', 'HAR-17/02 p.3; Highway Factual p.9', false, 95, -23.77, 90);
  add('road_eb_turn', assets.road({ id: 'road_eb_turn', lanes: 1, laneWidth: 3.66, length: 168, markings: 'none', edgeLines: true, shoulder: 0 }),
    'road', 'US-27A EB Left-Turn Lane (~550 ft)', 'HAR-17/02 p.3; Highway Factual p.9', false, -95, -7.32, 90);
  add('road_median_w', assets.median({ id: 'road_median_w', width: 18.29, length: 500 }),
    'road', 'Grass Median West (~60 ft wide)', 'HAR-17/02 p.3, p.21; Exhibit 4', false, -270, -14.63, 90);
  add('road_median_e', assets.median({ id: 'road_median_e', width: 18.29, length: 500 }),
    'road', 'Grass Median East (~60 ft wide)', 'HAR-17/02 p.3, p.21; Exhibit 4', false, 270, -14.63, 90);
  add('road_crossover', assets.intersection({ id: 'road_crossover', size: 39.6 }),
    'road', 'Median Crossover (~130 ft opening)', 'HAR-17/02 p.3; Highway Factual p.9', false, 0, -15.5, 0);
  add('road_140th', assets.road({ id: 'road_140th', lanes: 2, laneWidth: 3.05, length: 240, markings: 'none', edgeLines: true, shoulder: 0 }),
    'road', 'NE 140th Court (2 lanes, south of US-27A)', 'inferred: HAR-17/02 p.1, p.3; Exhibit 4 (~6.1 m width)', false, 0, 121.8, 0);

  add('bld_store', assets.building({ id: 'bld_store', w: 18, d: 12, h: 4.5, kind: 'store' }),
    'building', 'Retail Store on SE Corner', 'inferred: HAR-17/02 p.1; Exhibit 4 (~18×12 m footprint, height assumed)', true, 18, 22, 0);
  add('occ_shelter', assets.shelter({ id: 'occ_shelter', open: false }),
    'occluder', 'Bench Shelter with Sheet-Metal Back Panel', 'Depo Witness D 09:51, 10:21; Exhibit 4', true, 8, 7.25, 0);
  add('sig_stop', assets.sign({ id: 'sig_stop', kind: 'stop', text: 'STOP' }),
    'signal', 'Stop Sign on NE 140th Ct Approach', 'police_report.md p.1; Depo Witness B 27:05', false, 4.2, 6.5, 0);
  add('sig_speed', assets.sign({ id: 'sig_speed', kind: 'speed_limit', text: '65' }),
    'signal', 'Posted Speed Limit 65 mph Sign', 'inferred: HAR-17/02 p.1, p.22; position typical along EB shoulder', false, -180, 4.5, 270);
  add('occ_pole', assets.pole({ id: 'occ_pole', height: 10 }),
    'occluder', 'Wooden Utility Pole (struck by Vehicle A ~848 ft E of POI)', 'Tech Recon Factual p.4, p.7 (326+334+195 ft post-POI)', false, 258.5, 16.5, 0);
  add('occ_crest_wall', assets.building({ id: 'occ_crest_wall', w: 4, d: 50, h: 3.0, kind: 'generic' }),
    'occluder', 'Hill Crest Sight-Line Horizon (~1,132 ft W of POI, approximated as wall)', 'inferred: HAR-17/02 p.22, p.29; 1,132 ft crest approximated as building', true, -352, -15, 0);

  for (let i = 0; i < 5; i++) {
    add(`occ_tree_${i}`, assets.tree({ id: `occ_tree_${i}`, height: 9 }),
      'occluder', `Roadside Tree ${i + 1}`, 'inferred: Witness Interview p.8; Tech Recon Factual p.7 (cluster near pole)', true, 220 + i * 12, 22 + (i % 2) * 4, 0);
  }

  add('mark_poi', assets.impactMarker({ id: 'mark_poi', position: [0, 0] }),
    'marker', 'Initial Point of Impact (EB outside lane at NE 140th Ct)', 'HAR-17/02 p.3, p.5; police_report.md p.3', false, 0, 0, 0);
  add('mark_pole_poi', assets.impactMarker({ id: 'mark_pole_poi', position: [258.5, 16.5] }),
    'marker', 'Utility Pole Impact Point', 'HAR-17/02 p.5, p.16; Tech Recon Factual p.4', false, 258.5, 16.5, 0);
  add('mark_tire_impression', assets.skidMark({ id: 'mark_tire_impression', points: [[-1.75, 0.8], [1.75, 0.8]], width: 0.25 }),
    'marker', 'Post-impact vertical-loading tire mark (11.5 ft; no pre-impact braking skids)', 'Tech Recon Factual p.4; HAR-17/02 p.5', false, 0, 0, 0);

  add('veh_A', assets.vehicle('sedan', { id: 'veh_A', color: '#1c1c20' }),
    'vehicle', 'Vehicle A (2015 Dark Sedan, 70D)', 'HAR-17/02 p.1, p.5; FL Traffic Crash Report p.2 (BLK)', true);
  objects.veh_A.node.userData.setLights(false);

  add('veh_T_tractor', assets.vehicle('truck_tractor', { id: 'veh_T_tractor', color: '#a61c1c' }),
    'vehicle', 'Vehicle T Tractor (2014 Truck-Tractor)', 'HAR-17/02 p.1; FL Traffic Crash Report p.2 (RED)', true);
  add('veh_T_trailer', assets.vehicle('semitrailer', { id: 'veh_T_trailer', color: '#f2f2f2' }),
    'vehicle', 'Vehicle T Semitrailer (2003 53-ft Refrigerated Van)', 'HAR-17/02 p.1, p.6; Tech Recon Factual p.10', true);

  add('veh_witA', assets.vehicle('pickup', { id: 'veh_witA', color: '#222222' }),
    'vehicle', 'Witness A Pickup (Westbound US-27A)', 'HAR-17/02 p.1–2, p.29; witness_A.md; Witness Interview p.16', true);
  add('veh_witC', assets.vehicle('pickup', { id: 'veh_witC', color: '#4a5568' }),
    'vehicle', 'Witness C Pickup (Stopped in WB inside lane)', 'witness_C.md p.1', true);
  add('ped_witB', assets.pedestrian({ id: 'ped_witB', height: 1.68 }),
    'pedestrian', 'Witness B (Standing behind bench shelter)', 'Depo Witness B 17:01 (5 ft 6 in), 1:54:30 (Exhibit 4 mark #2)', false, 8, 9, 0);

  const K = {
    veh_A: [
      [0.0, -345.0, 0.0, 90, 33.08],
      [10.43, 0.0, 0.0, 90, 33.08],
      [13.4, 99.4, 2.95, 93.8, 31.0],
      [18.83, 258.5, 16.5, 93.8, 21.93],
      [25.0, 276.0, 22.0, 0, 0.0]
    ],
    veh_T_tractor: [
      [0.0, 12.0, -23.77, 270, 0.0],
      [2.0, 9.0, -23.77, 265, 2.2],
      [6.5, 0.5, -14.5, 200, 5.2],
      [10.43, -1.5, 7.6, 185, 6.2],
      [16.0, -1.5, 34.0, 180, 5.8],
      [22.0, -1.5, 53.0, 180, 0.0],
      [25.0, -1.5, 53.0, 180, 0.0]
    ],
    veh_T_trailer: [
      [0.0, 20.5, -23.77, 270, 0.0],
      [2.0, 17.5, -23.77, 269, 2.0],
      [6.5, 7.5, -19.5, 232, 4.7],
      [10.43, 0.4, -0.7, 195, 6.0],
      [16.0, -1.5, 25.5, 180, 5.8],
      [22.0, -1.5, 44.5, 180, 0.0],
      [25.0, -1.5, 44.5, 180, 0.0]
    ],
    veh_witA: [
      [0.0, 390.0, -31.09, 270, 26.82],
      [10.43, 110.3, -31.09, 270, 26.82],
      [16.5, 12.0, -23.77, 260, 4.0],
      [21.0, 6.0, -1.83, 90, 10.0],
      [25.0, 65.0, -1.83, 90, 18.0]
    ],
    veh_witC: [
      [0.0, -18.0, -27.43, 270, 0.0],
      [25.0, -18.0, -27.43, 270, 0.0]
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
      id: 'wit_A', name: 'Witness A (Westbound Driver)',
      position: [269.6, 0, -31.09], eyeHeight: 1.5, lookAt: 'veh_A', observationTime: 4.5,
      claim: 'Saw dark car come over the hill eastbound before truck turned; once trailer crossed eastbound lanes it blocked view of the car.',
      citation: 'witness_A.md p.1; HAR-17/02 p.1–2, p.29–30'
    },
    {
      id: 'wit_B', name: 'Witness B (Pedestrian at Store)',
      position: [8.0, 0, 9.0], eyeHeight: 1.56, lookAt: 'veh_A', observationTime: 9.8,
      claim: 'I had a clear view of the car the whole way in. I watched it right up until the moment it hit. Nothing was in the way.',
      citation: 'Depo Witness B 41:10, 52:00, 1:54:30 (Exhibit 4 mark #2)'
    },
    {
      id: 'wit_C', name: 'Witness C (Stopped Westbound Pickup)',
      position: [-18.0, 0, -27.43], eyeHeight: 1.5, lookAt: 'veh_T_trailer', observationTime: 10.43,
      claim: 'Stopped in WB inside lane ~18 m west of crossover; watched truck creep across EB lanes and saw car emerge on far side after loud crunch.',
      citation: 'witness_C.md p.1'
    },
    {
      id: 'wit_D', name: 'Witness D (Store Counter Clerk)',
      position: [23.0, 0, 24.0], eyeHeight: 1.6, lookAt: 'veh_A', observationTime: 10.43,
      claim: 'Inside behind the register at the back of the counter; could not see the highway due to cooler and window posters, only heard the bang.',
      citation: 'Depo Witness D 07:38, 08:08, 18:02, 18:42'
    }
  ];

  const facts = [
    { id: 'f_speed_A', text: 'Vehicle A TACC cruise speed set to and traveling at 74 mph (33.08 m/s) prior to impact with no braking', value: 74, unit: 'mph', citation: 'HAR-17/02 p.2, p.15', kind: 'speed' },
    { id: 'f_posted_speed', text: 'Posted speed limit on US-27A at crash location', value: 65, unit: 'mph', citation: 'HAR-17/02 p.1, p.11', kind: 'speed' },
    { id: 'f_crest_dist', text: 'Vertical grade crest distance west of intersection center (sight distance)', value: 1132, unit: 'ft', citation: 'HAR-17/02 p.22, p.29', kind: 'distance' },
    { id: 'f_sight_time', text: 'Available line-of-sight time between opposing drivers from crest to impact at 74 mph', value: 10.4, unit: 's', citation: 'HAR-17/02 p.29', kind: 'time' },
    { id: 'f_median_width', text: 'Width of grassy median separating eastbound and westbound lanes on US-27A', value: 60, unit: 'ft', citation: 'HAR-17/02 p.3, p.21', kind: 'distance' },
    { id: 'f_turn_lane_len', text: 'Length of left-turn lanes on US-27A approaching NE 140th Court', value: 550, unit: 'ft', citation: 'HAR-17/02 p.3; Highway Factual p.9', kind: 'distance' },
    { id: 'f_crossover_len', text: 'Length of paved median crossover opening at NE 140th Court', value: 130, unit: 'ft', citation: 'HAR-17/02 p.3', kind: 'distance' },
    { id: 'f_comb_len', text: 'Overall length of tractor-semitrailer combination (71 ft 7 in)', value: 71.58, unit: 'ft', citation: 'HAR-17/02 p.6 fn.6', kind: 'distance' },
    { id: 'f_impact_offset', text: 'Impact center on right side of semitrailer rearward of tractor front (45 ft 5 in)', value: 45.42, unit: 'ft', citation: 'HAR-17/02 p.6 fn.6', kind: 'distance' },
    { id: 'f_road_depart', text: 'Distance from area of impact to where Vehicle A departed right side of roadway', value: 326, unit: 'ft', citation: 'Crash Summary p.2; Tech Recon Factual p.4', kind: 'distance' },
    { id: 'f_post_impact_dist', text: 'Total linear distance traveled by Vehicle A after striking semitrailer to final rest', value: 910, unit: 'ft', citation: 'HAR-17/02 p.1, p.11; Tech Recon Factual p.5', kind: 'distance' },
    { id: 'f_pole_time', text: 'Time after initial impact when Vehicle A struck utility pole and deployed airbags (49.05 mph)', value: 8.4, unit: 's', citation: 'HAR-17/02 p.5; Tech Recon Factual p.13', kind: 'time' },
    { id: 'f_no_skids', text: 'Pre-collision roadway skid marks from either vehicle (0 m; only 11.5 ft vertical-load tire mark at POI)', value: 0, unit: 'm', citation: 'HAR-17/02 p.5; Tech Recon Factual p.4', kind: 'skid' },
    { id: 'f_pos_witA', text: 'Witness A position: driving westbound at ~60 mph about 0.25 mi (~402 m) behind truck', value: 402, unit: 'm', citation: 'HAR-17/02 p.11, p.29; witness_A.md', kind: 'position' },
    { id: 'f_pos_witB', text: 'Witness B marked position #2 on Exhibit 4 at (x=8 m, z=9 m) directly behind opaque sheet-metal back of bench shelter, contradicting her verbal claim of an unobstructed view', value: 8, unit: 'm', citation: 'Depo Witness B 1:54:30 (Exhibit 4 mark #2); Depo Witness D 10:21', kind: 'position' },
    { id: 'f_pos_witC', text: 'Witness C position: stopped in WB inside lane ~18 m west of NE 140th Ct centerline', value: -18, unit: 'm', citation: 'witness_C.md p.1', kind: 'position' },
    { id: 'f_pos_witD', text: 'Witness D position: inside store behind register at back of counter (x=23 m, z=24 m), view blocked by cooler and window posters', value: 23, unit: 'm', citation: 'Depo Witness D 07:38, 08:08, 18:02', kind: 'position' }
  ];

  const world = {
    meta: {
      caseId: 'demo-full',
      title: 'NTSB HWY16FH018 — US-27A & NE 140th Ct Tractor-Semitrailer Underride Crash (Williston, FL)',
      date: '2016-05-07', timeOfDay: '16:36', timeZone: 'America/New_York', utcOffset: '-04:00',
      lat: 29.4106, lon: -82.53979, lighting: 'day',
      source: 'NTSB/HAR-17/02 (HWY16FH018)', impactT: 10.43
    },
    root, duration, setTime, objects, witnesses, facts, skids: []
  };
  setTime(0);
  return world;
}
