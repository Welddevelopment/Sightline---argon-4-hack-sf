// Temporary dev world following the world contract (fallback if /worlds/reference_world.js is missing).
export default function createWorld(THREE) {
  const root = new THREE.Group();
  root.name = 'root';
  const objects = {};
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });
  const add = (id, node, kind, label, citation, occludes, extra = {}) => {
    node.name = id;
    root.add(node);
    objects[id] = { node, kind, label, citation, occludes, ...extra };
    return node;
  };
  const box = (w, h, d, c) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));

  const road = box(220, 0.05, 9, 0x2b2e33); road.position.set(0, 0.025, 0);
  add('road_main', road, 'road', 'Main Street (E-W)', 'Police report p.1', false);
  const cross = box(9, 0.05, 160, 0x2b2e33); cross.position.set(10, 0.03, 0);
  add('road_cross', cross, 'road', 'Cross Street (N-S)', 'Police report p.1', false);

  const shelter = box(6, 3.2, 1.6, 0x4f7a8c); shelter.position.set(-8, 1.6, 6);
  add('occ_shelter', shelter, 'occluder', 'Bus shelter', 'Police report p.2', true);

  const pole = new THREE.Group();
  const post = box(0.3, 5, 0.3, 0x333333); post.position.y = 2.5; pole.add(post);
  const head = box(0.6, 1.4, 0.5, 0x111111); head.position.y = 5; pole.add(head);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
  lamp.position.set(0, 5.3, 0.3); pole.add(lamp);
  pole.position.set(10, 0, -8);
  const stateAt = (t) => (t < 4 ? 'green' : t < 6 ? 'yellow' : 'red');
  add('sig_north', pole, 'signal', 'Signal (north approach)', 'Police report p.2', false, { state: stateAt });

  const truck = new THREE.Group();
  const body = box(6, 1.8, 2.3, 0xb03030); body.position.y = 1.1; truck.add(body);
  const cab = box(2, 1.2, 2.2, 0x902020); cab.position.set(1.5, 2.6, 0); truck.add(cab);
  add('veh_A', truck, 'vehicle', 'Pickup truck (Vehicle A)', 'Police report p.2', true);

  const witnesses = [
    { id: 'wit_B', name: 'Witness B (fictional)', position: [-20, 0, 12], eyeHeight: 1.6, lookAt: 'sig_north',
      observationTime: 6.5, claim: 'I saw the light was red', citation: 'Deposition 27:14' },
  ];
  const facts = [{ id: 'f1', text: 'Skid marks 31 m before impact', value: 31, unit: 'm', citation: 'Police report p.3', kind: 'skid' }];

  const dur = 12;
  function setTime(t) {
    truck.position.set(-60 + (80 / dur) * t, 0, 2);
    truck.rotation.y = 0;
    lamp.material.color.set({ green: 0x00ff00, yellow: 0xffcc00, red: 0xff2020 }[stateAt(t)]);
  }
  setTime(0);
  return {
    meta: { caseId: 'dev', title: 'Dev world', timeOfDay: '06:45', lighting: 'dawn', source: 'dev' },
    root, duration: dur, setTime, objects, witnesses, facts,
    skids: [{ vehicle: 'veh_A', length: 31, mu: 0.7, citation: 'Police report p.3' }],
  };
}
