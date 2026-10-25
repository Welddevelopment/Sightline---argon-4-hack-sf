export default function createWorld(THREE) {
  const root = new THREE.Group(); root.name = 'root';
  const objects = {};
  const mk = (id, geo, color, pos, kind, label) => { const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({color})); m.name = id; m.position.set(...pos); root.add(m); objects[id] = { node: m, kind, label, citation: 'dev', occludes: true }; return m; };
  mk('road_main', new THREE.BoxGeometry(80, .1, 10), 0x333333, [0, 0, 0], 'road', 'Road');
  const A = mk('veh_A', new THREE.BoxGeometry(4, 1.5, 2), 0xcc2222, [-30, .85, 0], 'vehicle', 'Truck A');
  mk('occ_shelter', new THREE.BoxGeometry(3, 2.5, 6), 0x2266cc, [0, 1.25, 8], 'occluder', 'Shelter');
  mk('sig_north', new THREE.CylinderGeometry(.3, .3, 5), 0x22cc22, [20, 2.5, -8], 'signal', 'Signal');
  return { meta: { caseId: 'dev', title: 'dev', timeOfDay: '12:00', lighting: 'day', source: 'dev' }, root, duration: 6, objects,
    setTime(t) { A.position.x = -30 + 10 * t; },
    witnesses: [{ id: 'wit_B', name: 'Witness B', position: [-10, 0, 15], eyeHeight: 1.6, lookAt: 'veh_A', observationTime: 3, claim: 'x', citation: 'dev' }],
    facts: [], skids: [] };
}
