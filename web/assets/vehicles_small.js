// Sightline asset library — small road users: motorcycle, bicycle (optional seated rider) and
// pedestrian / occupant figures. Browser + Node: no imports, THREE is passed in. Procedural only.
//
//   createSmallVehicle(THREE, 'motorcycle'|'bicycle', {id, color, rider, lights, spotlights})
//     rider: true | {height, clothing, helmet}   (motorcycle helmet defaults on, bicycle off)
//     -> Object3D, origin at ground centre of footprint, faces -Z at rotation.y = 0.
//        userData: assetType, dims {length,width,height}, driverEye [x,y,z] (local), setLights(on), rider (Object3D|null)
//        lamp meshes: headlight_L/R, taillight_L/R (bicycle: lamp + reflector)
//   createPedestrian(THREE, {height=1.7, pose:'standing'|'walking'|'seated', clothing, id, helmet, seat})
//     standing/walking: origin at ground between the feet; userData.eyeHeight = 0.93*height
//     seated: seat:'vehicle' (default) -> origin = H-point (hip joint centre), occupant reclined, hands at
//             9-and-3 on a wheel, feet on pedals; userData.eyeHeight is the eye height ABOVE THE H-POINT.
//             seat:'bench' + seatHeight (default 0.45) -> origin on the ground under the hips.
//     userData: assetType 'pedestrian', dims, height, pose, eyeHeight, eye [x,y,z] local, joints, setGait(phase 0..1)
//
// Proportions follow standard adult anthropometry expressed as fractions of stature (eye 0.93, shoulder 0.81,
// elbow 0.63, wrist 0.485, hip joint 0.53, knee 0.285, ankle 0.044). Geometry/materials are cached per THREE.

const caches = new WeakMap();
function cacheOf(THREE) {
  let c = caches.get(THREE);
  if (!c) { c = { geo: new Map(), mat: new Map() }; caches.set(THREE, c); }
  return c;
}
const geo = (T, key, fn) => { const c = cacheOf(T).geo; if (!c.has(key)) c.set(key, fn()); return c.get(key); };
const mat = (T, key, fn) => { const c = cacheOf(T).mat; if (!c.has(key)) c.set(key, fn()); return c.get(key); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hex = (T, c, d) => { try { return new T.Color(c ?? d).getHexString(); } catch { return new T.Color(d).getHexString(); } };

function mesh(T, g, m, name) {
  const o = new T.Mesh(g, m);
  o.castShadow = true; o.receiveShadow = true;
  if (name) o.name = name;
  return o;
}

// ---------------------------------------------------------------- materials
const M = {
  skin: T => mat(T, 'skin', () => new T.MeshStandardMaterial({ color: 0xb9afa4, roughness: 0.62, metalness: 0 })),
  cloth: (T, c) => { const h = hex(T, c, '#4d6680'); return mat(T, 'cloth' + h, () => new T.MeshStandardMaterial({ color: '#' + h, roughness: 0.88, metalness: 0 })); },
  pants: T => mat(T, 'pants', () => new T.MeshStandardMaterial({ color: 0x3b4048, roughness: 0.9, metalness: 0 })),
  shoe: T => mat(T, 'shoe', () => new T.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.7, metalness: 0 })),
  paint: (T, c) => { const h = hex(T, c, '#8a1c1c'); return mat(T, 'paint' + h, () => new T.MeshPhysicalMaterial({ color: '#' + h, roughness: 0.32, metalness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08 })); },
  rubber: T => mat(T, 'rubber', () => new T.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.92, metalness: 0 })),
  alu: T => mat(T, 'alu', () => new T.MeshStandardMaterial({ color: 0xb4b8bd, roughness: 0.32, metalness: 0.75 })),
  steel: T => mat(T, 'steel', () => new T.MeshStandardMaterial({ color: 0x9a9da2, roughness: 0.28, metalness: 0.8 })),
  dark: T => mat(T, 'darkmetal', () => new T.MeshStandardMaterial({ color: 0x2c2e32, roughness: 0.5, metalness: 0.45 })),
  engine: T => mat(T, 'engine', () => new T.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.45, metalness: 0.55 })),
  black: T => mat(T, 'blackplastic', () => new T.MeshStandardMaterial({ color: 0x18191b, roughness: 0.6, metalness: 0.05 })),
  seat: T => mat(T, 'seatvinyl', () => new T.MeshStandardMaterial({ color: 0x141416, roughness: 0.75, metalness: 0 })),
  glass: T => mat(T, 'mirror', () => new T.MeshStandardMaterial({ color: 0x6d7a86, roughness: 0.05, metalness: 0.9 })),
  visor: T => mat(T, 'visor', () => new T.MeshPhysicalMaterial({ color: 0x15181c, roughness: 0.08, metalness: 0.2, clearcoat: 1 })),
  plate: T => mat(T, 'plate', () => new T.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.5, metalness: 0.1 })),
  amber: T => mat(T, 'amber', () => new T.MeshStandardMaterial({ color: 0xd88a1a, roughness: 0.25, metalness: 0, emissive: 0x2a1500 })),
};
// Lamps get per-vehicle materials so setLights can toggle them independently.
function lampMat(T, color, on) {
  return new T.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: on ? 2.2 : 0.0, roughness: 0.18, metalness: 0 });
}

// ---------------------------------------------------------------- geometry helpers
// Tapered limb: joint at the origin, hangs along -Y, rounded caps (lathe). Radii/length in any unit.
function limbGeo(T, r0, r1, len, bulge = 0, bulgeAt = 0.35, seg = 18) {
  return geo(T, `limb:${r0}:${r1}:${len}:${bulge}:${bulgeAt}`, () => {
    const pts = [];
    for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + (i / 5) * (Math.PI / 2); pts.push(new T.Vector2(Math.max(0, r1 * Math.cos(a)), -len + r1 * Math.sin(a))); }
    for (let i = 1; i < 12; i++) {
      const t = i / 12, fromTop = 1 - t;
      const r = r1 + (r0 - r1) * t + bulge * Math.exp(-(((fromTop - bulgeAt) / 0.22) ** 2));
      pts.push(new T.Vector2(r, -len + t * len));
    }
    for (let i = 0; i <= 5; i++) { const a = (i / 5) * (Math.PI / 2); pts.push(new T.Vector2(i === 5 ? 0 : r0 * Math.cos(a), r0 * Math.sin(a))); }
    return new T.LatheGeometry(pts, seg);
  });
}
// Lathe from [halfWidth, y] profile, elliptical cross-section (depth ratio).
function latheGeo(T, key, prof, depth = 1, seg = 28) {
  return geo(T, key, () => { const g = new T.LatheGeometry(prof.map(([r, y]) => new T.Vector2(r, y)), seg); g.scale(1, 1, depth); return g; });
}
function ellipsoidGeo(T, rx, ry, rz, seg = 22, thetaLen = Math.PI) {
  return geo(T, `ell:${rx}:${ry}:${rz}:${seg}:${thetaLen}`, () => { const g = new T.SphereGeometry(1, seg, Math.round(seg * 0.75), 0, Math.PI * 2, 0, thetaLen); g.scale(rx, ry, rz); return g; });
}
// Side-profile extrusion: pts = [[z, y], ...] in vehicle coords (z forward-negative); extruded symmetrically in X.
function sideGeo(T, key, pts, width, bevel = 0, smooth = false) {
  return geo(T, 'side:' + key, () => {
    const s = new T.Shape();
    const v = pts.map(([z, y]) => new T.Vector2(-z, y));
    if (smooth) { s.moveTo(v[0].x, v[0].y); s.splineThru([...v.slice(1), v[0]]); }
    else { s.moveTo(v[0].x, v[0].y); for (const p of v.slice(1)) s.lineTo(p.x, p.y); s.closePath(); }
    const depth = Math.max(0.001, width - 2 * bevel);
    const g = new T.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 4, curveSegments: smooth ? 24 : 6, steps: 1 });
    g.rotateY(Math.PI / 2);
    g.translate(-depth / 2, 0, 0);
    g.computeVertexNormals();
    return g;
  });
}
const unitCyl = (T, seg = 14) => geo(T, 'ucyl' + seg, () => new T.CylinderGeometry(1, 1, 1, seg, 1));
const unitBox = T => geo(T, 'ubox', () => new T.BoxGeometry(1, 1, 1));
const UP = [0, 1, 0];
// Cylinder of radius r between points a and b.
function tube(T, a, b, r, m, name, seg = 14) {
  const A = new T.Vector3(...a), B = new T.Vector3(...b), d = B.clone().sub(A), len = d.length();
  const o = mesh(T, unitCyl(T, seg), m, name);
  o.position.copy(A).add(B).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(new T.Vector3(...UP), d.normalize());
  o.scale.set(r, len, r);
  return o;
}
// Box of cross-section w (x) by h between points a and b.
function bar(T, a, b, w, h, m, name) {
  const A = new T.Vector3(...a), B = new T.Vector3(...b), d = B.clone().sub(A), len = d.length();
  const o = mesh(T, unitBox(T), m, name);
  o.position.copy(A).add(B).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), d.normalize());
  o.scale.set(w, h, len);
  return o;
}
function at(o, x, y, z, rx = 0, ry = 0, rz = 0) { o.position.set(x, y, z); o.rotation.set(rx, ry, rz); return o; }
// Merge non-indexed copies of (geometry, matrix) pairs (position+normal only).
function merge(T, parts) {
  const pos = [], nor = [];
  for (const [g0, m4] of parts) {
    const g = (g0.index ? g0.toNonIndexed() : g0.clone()); g.applyMatrix4(m4);
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  return out;
}
// Ring (torus) whose axis is X, i.e. a wheel lying in the Y-Z plane.
function ringX(T, R, r, rs = 12, ts = 56, sx = 1) {
  return geo(T, `ringX:${R}:${r}:${rs}:${ts}:${sx}`, () => { const g = new T.TorusGeometry(R, r, rs, ts); g.rotateY(Math.PI / 2); g.scale(sx, 1, 1); return g; });
}
function discX(T, R, w, seg = 40, open = false) {
  return geo(T, `discX:${R}:${w}:${seg}:${open}`, () => { const g = new T.CylinderGeometry(R, R, w, seg, 1, open); g.rotateZ(Math.PI / 2); return g; });
}

// ================================================================= HUMAN FIGURE
// Unit-stature figure (1.0 = height); the "figure" group is scaled uniformly by height.
const FIG = {
  hipY: 0.53, hipX: 0.05, thigh: 0.245, shin: 0.241, ankleY: 0.044,
  spineY: 0.60, shoulderY: 0.805, shoulderX: 0.106, upperArm: 0.178, foreArm: 0.148,
  neckY: 0.83, headY: 0.89, eyeY: 0.93, headC: 0.932, seatDrop: 0.075,
};
const PELVIS_PROF = [[0, 0.452], [0.05, 0.456], [0.08, 0.469], [0.096, 0.495], [0.1, 0.525], [0.095, 0.565], [0.086, 0.6], [0.082, 0.625], [0.06, 0.632], [0, 0.634]];
const CHEST_PROF = [[0, 0.583], [0.072, 0.586], [0.084, 0.6], [0.083, 0.625], [0.086, 0.665], [0.092, 0.71], [0.096, 0.75], [0.097, 0.78], [0.092, 0.803], [0.072, 0.822], [0.042, 0.836], [0, 0.841]];

function shoeGeo(T) {
  return geo(T, 'shoe', () => {
    const g = sideGeo(T, 'shoeRaw', [[0.04, 0], [0.046, 0.03], [0.032, 0.066], [0.0, 0.08], [-0.035, 0.062], [-0.075, 0.042], [-0.1, 0.03], [-0.109, 0.013], [-0.105, 0]], 0.052, 0.008, true).clone();
    g.translate(0, 0.007 - FIG.ankleY, 0);
    return g;
  });
}

function buildFigure(T, o = {}) {
  const H = +o.height > 0.5 ? +o.height : 1.7;
  const skin = M.skin(T), top = M.cloth(T, o.clothing), pants = M.pants(T), shoe = M.shoe(T);
  const root = new T.Group();
  const fig = new T.Group(); fig.name = 'figure'; fig.scale.setScalar(H); root.add(fig);
  const G = (name, parent, x, y, z) => { const g = new T.Group(); g.name = name; g.position.set(x, y, z); parent.add(g); return g; };
  const j = {};
  j.pelvis = G('pelvis', fig, 0, FIG.hipY, 0);
  const pel = mesh(T, latheGeo(T, 'pelvis', PELVIS_PROF, 0.68), pants, 'pelvis'); pel.position.y = -FIG.hipY; j.pelvis.add(pel);
  j.spine = G('spine', j.pelvis, 0, FIG.spineY - FIG.hipY, 0);
  const chest = mesh(T, latheGeo(T, 'chest', CHEST_PROF, 0.66), top, 'torso'); chest.position.y = -FIG.spineY; j.spine.add(chest);
  // neck + head
  j.neck = G('neck', j.spine, 0, FIG.neckY - FIG.spineY, 0);
  const neck = mesh(T, limbGeo(T, 0.029, 0.034, 0.075), skin, 'neck'); neck.position.y = 0.058; j.neck.add(neck);
  j.head = G('head', j.neck, 0, FIG.headY - FIG.neckY, -0.004);
  const hc = FIG.headC - FIG.headY;
  const cran = mesh(T, ellipsoidGeo(T, 0.0445, 0.066, 0.055, 28), skin, 'head'); cran.position.set(0, hc, 0.004); j.head.add(cran);
  const jaw = mesh(T, ellipsoidGeo(T, 0.036, 0.04, 0.043), skin, 'jaw'); jaw.position.set(0, hc - 0.034, -0.014); j.head.add(jaw);
  const nose = mesh(T, ellipsoidGeo(T, 0.008, 0.015, 0.012, 12), skin, 'nose'); nose.position.set(0, hc - 0.01, -0.05); nose.rotation.x = -0.25; j.head.add(nose);
  for (const s of [-1, 1]) { const ear = mesh(T, ellipsoidGeo(T, 0.006, 0.017, 0.011, 10), skin, 'ear'); ear.position.set(s * 0.044, hc - 0.006, 0.006); j.head.add(ear); }
  const eye = new T.Object3D(); eye.name = 'eye'; eye.position.set(0, FIG.eyeY - FIG.headY, -0.046); j.head.add(eye); j.eye = eye;
  if (o.helmet) {
    const full = o.helmet === 'full' || o.helmet === true && o.helmetFull;
    const hm = o.helmetColor != null ? M.paint(T, o.helmetColor) : M.paint(T, '#d9dadc');
    if (full) {
      const shell = mesh(T, ellipsoidGeo(T, 0.062, 0.078, 0.07, 28), hm, 'helmet'); shell.position.set(0, hc - 0.006, 0.004); j.head.add(shell);
      const visor = mesh(T, geo(T, 'visor', () => { const g = new T.SphereGeometry(1, 24, 10, -Math.PI * 0.5 - 0.95, 1.9, Math.PI * 0.36, Math.PI * 0.2); g.scale(0.0635, 0.079, 0.0715); return g; }), M.visor(T), 'visor');
      visor.position.copy(shell.position); j.head.add(visor);
    } else {
      const shell = mesh(T, ellipsoidGeo(T, 0.058, 0.064, 0.07, 26, Math.PI * 0.52), hm, 'helmet'); shell.position.set(0, hc + 0.004, 0.006); j.head.add(shell);
    }
  }
  // arms (L = -X, figure faces -Z)
  for (const [S, s] of [['L', -1], ['R', 1]]) {
    const sh = j['shoulder' + S] = G('shoulder' + S, j.spine, s * FIG.shoulderX, FIG.shoulderY - FIG.spineY, 0.004);
    const delt = mesh(T, ellipsoidGeo(T, 0.034, 0.036, 0.034), top, 'deltoid'); delt.position.set(s * 0.004, -0.008, 0); sh.add(delt);
    sh.add(mesh(T, limbGeo(T, 0.03, 0.0225, FIG.upperArm, 0.002, 0.4), top, 'upperArm' + S));
    const el = j['elbow' + S] = G('elbow' + S, sh, 0, -FIG.upperArm, 0);
    el.add(mesh(T, limbGeo(T, 0.0235, 0.0165, FIG.foreArm, 0.003, 0.25), skin, 'foreArm' + S));
    const wr = j['wrist' + S] = G('wrist' + S, el, 0, -FIG.foreArm, 0);
    const hand = mesh(T, geo(T, 'hand', () => { const g = limbGeo(T, 0.021, 0.015, 0.072, 0.002, 0.45).clone(); g.scale(0.5, 1, 1); return g; }), skin, 'hand' + S);
    hand.position.y = -0.006; wr.add(hand);
    const thumb = mesh(T, limbGeo(T, 0.0085, 0.007, 0.03), skin, 'thumb'); thumb.position.set(-s * 0.004, -0.012, -0.014); thumb.rotation.set(0.5, 0, -s * 0.25); wr.add(thumb);
    // legs
    const hp = j['hip' + S] = G('hip' + S, j.pelvis, s * FIG.hipX, 0, 0);
    hp.add(mesh(T, limbGeo(T, 0.05, 0.03, FIG.thigh, 0.004, 0.3), pants, 'thigh' + S));
    const kn = j['knee' + S] = G('knee' + S, hp, 0, -FIG.thigh, 0);
    kn.add(mesh(T, limbGeo(T, 0.0315, 0.0195, FIG.shin, 0.0075, 0.3), pants, 'shin' + S));
    const an = j['ankle' + S] = G('ankle' + S, kn, 0, -FIG.shin, 0);
    an.add(mesh(T, shoeGeo(T), shoe, 'foot' + S));
  }
  return { root, fig, j, H };
}

// --- posing
function aimBone(T, bone, dirW) {
  bone.parent.updateWorldMatrix(true, false);
  const q = bone.parent.getWorldQuaternion(new T.Quaternion()).invert();
  const d = dirW.clone().applyQuaternion(q).normalize();
  bone.rotation.set(Math.atan2(-d.z, -d.y), 0, Math.asin(clamp(d.x, -1, 1)));
  bone.updateMatrixWorld(true);
}
function aimFoot(T, ankle, dirW) {
  ankle.parent.updateWorldMatrix(true, false);
  const q = ankle.parent.getWorldQuaternion(new T.Quaternion()).invert();
  const f = dirW.clone().applyQuaternion(q).normalize();
  ankle.rotation.set(Math.atan2(f.y, -f.z), Math.asin(clamp(-f.x, -1, 1)), 0, 'XYZ');
  ankle.updateMatrixWorld(true);
}
// Two-bone IK: upper joint -> lower joint -> end joint reaches targetW; pole sets the bend plane.
function solveLimb(T, upper, lower, end, targetW, poleW) {
  upper.updateWorldMatrix(true, true);
  const P = upper.getWorldPosition(new T.Vector3()), E0 = lower.getWorldPosition(new T.Vector3()), F0 = end.getWorldPosition(new T.Vector3());
  const L1 = P.distanceTo(E0), L2 = E0.distanceTo(F0);
  const D = targetW.clone().sub(P), dist = clamp(D.length(), Math.abs(L1 - L2) + 1e-4, (L1 + L2) * 0.9995);
  const Dn = D.normalize();
  const a = Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1));
  const perp = poleW.clone().sub(Dn.clone().multiplyScalar(poleW.dot(Dn)));
  if (perp.lengthSq() < 1e-8) perp.set(0, 0, -1); perp.normalize();
  const U = Dn.clone().multiplyScalar(Math.cos(a)).add(perp.multiplyScalar(Math.sin(a)));
  aimBone(T, upper, U);
  const E = lower.getWorldPosition(new T.Vector3());
  aimBone(T, lower, targetW.clone().sub(E));
}
function restArms(j, flex = 0.12) {
  j.shoulderL.rotation.set(0.02, 0, -0.11); j.shoulderR.rotation.set(0.02, 0, 0.11);
  j.elbowL.rotation.set(flex, 0, 0.02); j.elbowR.rotation.set(flex, 0, -0.02);
  j.wristL.rotation.set(0, 0.25, 0); j.wristR.rotation.set(0, -0.25, 0);
}
function setGait(fig, j, phase) {
  const w = 2 * Math.PI * phase;
  const legs = [['L', 0], ['R', Math.PI]];
  for (const [S, off] of legs) {
    const s = Math.sin(w + off), c = Math.cos(w + off);
    const th = 0.36 * s, kn = -(0.07 + 0.62 * Math.max(0, c) * Math.max(0, -s + 0.6) / 1.6);
    j['hip' + S].rotation.set(th, 0, (S === 'L' ? -1 : 1) * 0.02);
    j['knee' + S].rotation.set(kn, 0, 0);
    j['ankle' + S].rotation.set(clamp(-(th + kn) * 0.75 + (s > 0 ? -0.12 * s : 0.25 * -s), -0.4, 0.5), 0, 0);
    const arm = j['shoulder' + S];
    arm.rotation.set(-0.3 * s, 0, (S === 'L' ? -1 : 1) * 0.1);
    j['elbow' + S].rotation.set(0.22 + 0.2 * Math.max(0, -s), 0, 0);
  }
  j.pelvis.rotation.set(0, 0.05 * Math.sin(w), 0);
  j.spine.rotation.set(-0.04, -0.08 * Math.sin(w), 0);
  ground(fig, j);
}
const _box = {};
function ground(fig, j) {
  // drop the figure so the lowest shoe vertex touches y=0 (precise, shoes only)
  const T = ground.T;
  fig.position.y = 0; fig.updateMatrixWorld(true);
  let min = Infinity;
  for (const S of ['L', 'R']) {
    const foot = j['ankle' + S].children[0];
    const b = new T.Box3().setFromObject(foot, true); min = Math.min(min, b.min.y);
  }
  // fig is a child of root at identity during build; world == root-local
  const rootY = fig.parent ? fig.parent.getWorldPosition(new T.Vector3()).y : 0;
  fig.position.y = -(min - rootY);
  fig.updateMatrixWorld(true);
}

// targets in the coordinate frame of `space` (an ancestor; usually the vehicle root at build time)
function poseSeatedTo(T, F, space, t) {
  const { fig, j, H } = F;
  const toW = v => space.localToWorld(new T.Vector3(...v));
  fig.position.set(t.hip[0], t.hip[1] - FIG.hipY * H, t.hip[2]);
  j.pelvis.rotation.set(t.pelvis || 0, 0, 0);
  j.spine.rotation.set(t.spine || 0, 0, 0);
  j.neck.rotation.set(t.neck || 0, 0, 0);
  j.head.rotation.set(t.head || 0, 0, 0);
  space.updateMatrixWorld(true);
  for (const [S, s] of [['L', -1], ['R', 1]]) {
    const ft = t.feet[S === 'L' ? 0 : 1];
    solveLimb(T, j['hip' + S], j['knee' + S], j['ankle' + S], toW(ft), new T.Vector3(s * (t.kneeOut || 0.15), 0.35, -1).normalize());
    const fp = t.footPitch ?? 0;
    aimFoot(T, j['ankle' + S], new T.Vector3(s * 0.08, Math.sin(fp), -Math.cos(fp)).normalize());
    if (t.hands) {
      const ht = t.hands[S === 'L' ? 0 : 1];
      solveLimb(T, j['shoulder' + S], j['elbow' + S], j['wrist' + S], toW(ht), new T.Vector3(s * 0.7, -0.5, 0.5).normalize());
      j['wrist' + S].rotation.set(-0.35, s * -0.2, s * 0.15);
    }
  }
  space.updateMatrixWorld(true);
}

function eyeIn(T, F, space) {
  space.updateMatrixWorld(true);
  const p = F.j.eye.getWorldPosition(new T.Vector3());
  space.worldToLocal(p);
  return [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)];
}
function dimsOf(T, obj) {
  obj.updateMatrixWorld(true);
  const b = new T.Box3().setFromObject(obj, false), s = b.getSize(new T.Vector3());
  return { length: +s.z.toFixed(2), width: +s.x.toFixed(2), height: +s.y.toFixed(2) };
}

export function createPedestrian(THREE, opts = {}) {
  const T = THREE; ground.T = T;
  const pose = ['standing', 'walking', 'seated'].includes(opts.pose) ? opts.pose : 'standing';
  const F = buildFigure(T, { ...opts, helmetFull: opts.helmet === 'full' });
  const { root, fig, j, H } = F;
  root.name = opts.id || 'pedestrian';
  if (pose === 'standing') { restArms(j); ground(fig, j); }
  else if (pose === 'walking') { setGait(fig, j, opts.phase ?? 0.25); }
  else if ((opts.seat || (opts.seatHeight != null ? 'bench' : 'vehicle')) === 'bench') {
    const sh = opts.seatHeight ?? 0.45;
    const hipY = sh + FIG.seatDrop * H, kneeZ = -FIG.thigh * H;
    poseSeatedTo(T, F, root, {
      hip: [0, hipY, 0], pelvis: 0.04, spine: -0.02, neck: -0.04,
      feet: [[-0.1 * H, FIG.ankleY * H, kneeZ - 0.04 * H], [0.1 * H, FIG.ankleY * H, kneeZ - 0.04 * H]],
      footPitch: 0, kneeOut: 0.25,
    });
    j.shoulderL.rotation.set(0.42, 0, -0.08); j.shoulderR.rotation.set(0.42, 0, 0.08);
    j.elbowL.rotation.set(0.95, 0, 0.1); j.elbowR.rotation.set(0.95, 0, -0.1);
  } else {
    // vehicle occupant, origin = H-point. Targets scale with stature (reference 1.75 m).
    const s = H / 1.75;
    poseSeatedTo(T, F, root, {
      hip: [0, 0, 0], pelvis: 0.24, spine: 0.04, neck: -0.18, head: -0.1,
      feet: [[-0.13 * s, -0.24 * s, -0.74 * s], [0.13 * s, -0.24 * s, -0.74 * s]], footPitch: 0.75, kneeOut: 0.2,
      hands: opts.hands === false ? null : [[-0.19 * s, 0.37 * s, -0.37 * s], [0.19 * s, 0.37 * s, -0.37 * s]],
    });
    if (opts.hands === false) restArms(j, 0.9);
  }
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const eye = eyeIn(T, F, root);
  root.userData = {
    assetType: 'pedestrian', height: H, pose, dims: dimsOf(T, root),
    eyeHeight: pose === 'seated' ? eye[1] : +(0.93 * H).toFixed(3), eye,
    origin: pose === 'seated' && !(opts.seat === 'bench' || opts.seatHeight != null) ? 'h-point' : 'ground',
    joints: j,
    setGait: p => { setGait(fig, j, p); },
  };
  return root;
}

// ================================================================= BICYCLE
function buildBicycle(T, o, g) {
  const paint = M.paint(T, o.color ?? '#2f5d8a'), rub = M.rubber(T), alu = M.alu(T), blk = M.black(T), dk = M.dark(T);
  const riderH = o.riderH || 1.75;
  const RA = [0, 0.35, 0.53], FA = [0, 0.35, -0.53], BB = [0, 0.285, 0.1], SC = [0, 0.78, 0.255], HT = [0, 0.885, -0.36], HB = [0, 0.725, -0.41];
  // wheels
  for (const [name, A] of [['wheel_R', RA], ['wheel_F', FA]]) {
    const w = new T.Group(); w.name = name; w.position.set(...A); g.add(w);
    w.add(mesh(T, ringX(T, 0.332, 0.018, 12, 64, 1.0), rub, 'tire'));
    w.add(mesh(T, ringX(T, 0.312, 0.009, 8, 64, 1.6), alu, 'rim'));
    w.add(mesh(T, discX(T, 0.022, 0.1, 16), alu, 'hub'));
    w.add(mesh(T, geo(T, 'bikeSpokes', () => {
      const parts = [], cyl = new T.CylinderGeometry(0.0012, 0.0012, 1, 4, 1);
      for (let i = 0; i < 32; i++) {
        const side = i % 2 ? 1 : -1, a = (i / 32) * Math.PI * 2, b = a + side * 0.35;
        const p0 = new T.Vector3(side * 0.035, Math.cos(a) * 0.02, Math.sin(a) * 0.02), p1 = new T.Vector3(0, Math.cos(b) * 0.305, Math.sin(b) * 0.305);
        const d = p1.clone().sub(p0), m4 = new T.Matrix4().compose(p0.clone().add(p1).multiplyScalar(0.5), new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.clone().normalize()), new T.Vector3(1, d.length(), 1));
        parts.push([cyl, m4]);
      }
      return merge(T, parts);
    }), M.steel(T), 'spokes'));
  }
  // frame
  const r = 0.019;
  g.add(tube(T, SC, HT, r * 0.95, paint, 'top_tube'));
  g.add(tube(T, BB, HB, r * 1.15, paint, 'down_tube'));
  g.add(tube(T, BB, SC, r, paint, 'seat_tube'));
  g.add(tube(T, HB, [0, HT[1] + 0.02, HT[2] + 0.017], 0.022, paint, 'head_tube'));
  for (const s of [-1, 1]) {
    g.add(tube(T, [s * 0.02, BB[1], BB[2] + 0.02], [s * 0.066, RA[1], RA[2]], 0.011, paint, 'chainstay'));
    g.add(tube(T, [s * 0.018, SC[1] - 0.03, SC[2] + 0.01], [s * 0.066, RA[1], RA[2]], 0.009, paint, 'seatstay'));
    g.add(tube(T, [s * 0.03, HB[1] - 0.04, HB[2] - 0.012], [s * 0.052, FA[1], FA[2] + 0.005], 0.0135, paint, 'fork'));
  }
  g.add(bar(T, [0, HB[1] - 0.03, HB[2] - 0.01], [0, HB[1] - 0.03, HB[2] - 0.012], 0.11, 0.035, paint, 'fork_crown'));
  // seatpost + saddle (height from rider inseam ~0.45H, saddle-to-BB = 0.883 * inseam)
  const sTop = clamp(BB[1] + 0.883 * 0.45 * riderH, 0.85, 1.08);
  const dir = [SC[2] - BB[2], SC[1] - BB[1]], dl = Math.hypot(...dir), du = [dir[0] / dl, dir[1] / dl];
  const postLen = (sTop - 0.045 - SC[1]) / du[1];
  const PT = [0, SC[1] + du[1] * postLen, SC[2] + du[0] * postLen];
  g.add(tube(T, [0, SC[1] - 0.04, SC[2] - 0.012], PT, 0.0135, alu, 'seatpost'));
  const saddle = mesh(T, sideGeo(T, 'saddle', [[0.1, 0.0], [0.11, 0.03], [0.06, 0.045], [-0.06, 0.035], [-0.15, 0.03], [-0.16, 0.012], [-0.05, 0.0]], 0.15, 0.022, true), blk, 'saddle');
  saddle.position.set(0, PT[1] - 0.004, PT[2] + 0.01); g.add(saddle);
  saddle.scale.set(1, 1, 0.92);
  // stem + bars
  const ST = [0, HT[1] + 0.075, HT[2] + 0.025], BC = [0, ST[1] + 0.03, ST[2] - 0.1];
  g.add(tube(T, [0, HT[1] + 0.01, HT[2] + 0.004], ST, 0.016, alu, 'steerer'));
  g.add(tube(T, ST, BC, 0.016, alu, 'stem'));
  g.add(tube(T, [-0.29, BC[1], BC[2] + 0.04], [0.29, BC[1], BC[2] + 0.04], 0.011, alu, 'handlebar'));
  g.add(tube(T, [-0.1, BC[1], BC[2]], [0.1, BC[1], BC[2]], 0.012, alu, 'handlebar_c'));
  for (const s of [-1, 1]) {
    g.add(tube(T, [s * 0.1, BC[1], BC[2]], [s * 0.17, BC[1], BC[2] + 0.04], 0.011, alu));
    g.add(tube(T, [s * 0.18, BC[1], BC[2] + 0.04], [s * 0.3, BC[1], BC[2] + 0.04], 0.016, blk, 'grip'));
    g.add(bar(T, [s * 0.2, BC[1] + 0.005, BC[2] + 0.03], [s * 0.26, BC[1] - 0.005, BC[2] - 0.035], 0.012, 0.012, blk, 'brake_lever'));
  }
  // drivetrain (right side = +X)
  const crank = 0.17, ca = o.crankAngle ?? 0.55; // radians from forward-horizontal
  const ring = mesh(T, discX(T, 0.1, 0.004, 40), dk, 'chainring'); ring.position.set(0.075, BB[1], BB[2]); g.add(ring);
  g.add(mesh(T, ringX(T, 0.1, 0.005, 6, 40), M.steel(T), 'chainring_teeth')).position.set(0.075, BB[1], BB[2]);
  const cas = mesh(T, discX(T, 0.045, 0.03, 24), M.steel(T), 'cassette'); cas.position.set(0.06, RA[1], RA[2]); g.add(cas);
  g.add(tube(T, [0.074, BB[1] + 0.1, BB[2]], [0.06, RA[1] + 0.045, RA[2]], 0.004, dk, 'chain'));
  g.add(tube(T, [0.074, BB[1] - 0.1, BB[2]], [0.06, RA[1] - 0.045, RA[2]], 0.004, dk, 'chain'));
  g.add(mesh(T, discX(T, 0.02, 0.16, 12), dk, 'bb_axle')).position.set(0, BB[1], BB[2]);
  const pedals = [];
  for (const [s, ang] of [[1, ca], [-1, ca + Math.PI]]) {
    const end = [s * 0.09, BB[1] + Math.sin(ang) * crank, BB[2] - Math.cos(ang) * crank];
    g.add(bar(T, [s * 0.085, BB[1], BB[2]], end, 0.012, 0.022, alu, 'crank'));
    const ped = mesh(T, unitBox(T), blk, 'pedal'); ped.scale.set(0.09, 0.02, 0.07); ped.position.set(s * 0.14, end[1], end[2]); g.add(ped);
    pedals.push([s * 0.13, end[1], end[2]]);
  }
  // lamps: headlight_L (lamp on bar), headlight_R (front reflector), taillight_L (seatpost lamp), taillight_R (reflector)
  const L = { head: lampMat(T, 0xfff6e0, o.lights), tail: lampMat(T, 0xff2a1a, o.lights), refl: new T.MeshStandardMaterial({ color: 0xc8302a, roughness: 0.3, emissive: 0x200000 }) };
  const hl = mesh(T, discX(T, 0.022, 0.05, 16), blk); hl.rotation.y = Math.PI / 2; hl.position.set(0.06, BC[1] - 0.025, BC[2] - 0.005); g.add(hl);
  const hlLens = mesh(T, geo(T, 'lensZ', () => new T.CircleGeometry(1, 20)), L.head, 'headlight_L'); hlLens.scale.setScalar(0.019); hlLens.rotation.y = Math.PI; hlLens.position.set(0.06, BC[1] - 0.025, BC[2] - 0.031); hlLens.rotation.y = 0; g.add(hlLens);
  const fr = mesh(T, unitBox(T), new T.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.3 }), 'headlight_R'); fr.scale.set(0.035, 0.025, 0.006); fr.position.set(0, HB[1] - 0.06, HB[2] - 0.035); g.add(fr);
  const tl = mesh(T, unitBox(T), L.tail, 'taillight_L'); tl.scale.set(0.03, 0.05, 0.02); tl.position.set(0, PT[1] - 0.09, PT[2] + 0.025); g.add(tl);
  const tr = mesh(T, unitBox(T), L.refl, 'taillight_R'); tr.scale.set(0.04, 0.03, 0.006); tr.position.set(0, SC[1] - 0.12, SC[2] + 0.09); g.add(tr);
  return {
    lamps: L, headPos: [0.06, BC[1] - 0.025, BC[2] - 0.04],
    seat: [0, PT[1] + 0.03, PT[2] + 0.01], grips: [[-0.25, BC[1] + 0.01, BC[2] + 0.045], [0.25, BC[1] + 0.01, BC[2] + 0.045]],
    pedals: pedals[0][0] < 0 ? pedals : [pedals[1], pedals[0]],
  };
}

// ================================================================= MOTORCYCLE (naked / standard, 17" wheels)
function buildMotorcycle(T, o, g) {
  const paint = M.paint(T, o.color ?? '#8a1c1c'), rub = M.rubber(T), alu = M.alu(T), blk = M.black(T), dk = M.dark(T), eng = M.engine(T), st = M.steel(T);
  const FA = [0, 0.31, -0.74], RA = [0, 0.315, 0.71];
  // wheels: tyre, rim, 5 twin spokes, hub, discs
  const wheel = (name, A, R, tr, sx, disc) => {
    const w = new T.Group(); w.name = name; w.position.set(...A); g.add(w);
    w.add(mesh(T, ringX(T, R, tr, 16, 64, sx), rub, 'tire'));
    w.add(mesh(T, ringX(T, 0.216, 0.011, 8, 64), alu, 'rim_lip'));
    w.add(mesh(T, geo(T, `rimBarrel:${sx}`, () => { const gg = new T.CylinderGeometry(0.212, 0.212, 0.075 * sx, 48, 1, true); gg.rotateZ(Math.PI / 2); return gg; }), dk, 'rim'));
    w.add(mesh(T, discX(T, 0.05, 0.12, 20), alu, 'hub'));
    w.add(mesh(T, geo(T, 'motoSpokes', () => {
      const parts = [], bx = new T.BoxGeometry(0.018, 1, 0.026);
      for (let i = 0; i < 10; i++) {
        const a = (Math.floor(i / 2) / 5) * Math.PI * 2 + (i % 2 ? 0.16 : -0.16);
        const p0 = new T.Vector3(0, Math.cos(a) * 0.045, Math.sin(a) * 0.045), p1 = new T.Vector3(0, Math.cos(a + (i % 2 ? -0.1 : 0.1)) * 0.21, Math.sin(a + (i % 2 ? -0.1 : 0.1)) * 0.21);
        const d = p1.clone().sub(p0);
        parts.push([bx, new T.Matrix4().compose(p0.clone().add(p1).multiplyScalar(0.5), new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.clone().normalize()), new T.Vector3(1, d.length(), 1))]);
      }
      return merge(T, parts);
    }), dk, 'spokes'));
    for (const [x, rr] of disc) { const d = mesh(T, discX(T, rr, 0.006, 40), st, 'brake_disc'); d.position.x = x; w.add(d); }
    return w;
  };
  wheel('wheel_F', FA, 0.25, 0.06, 1.0, [[-0.075, 0.155], [0.075, 0.155]]);
  wheel('wheel_R', RA, 0.235, 0.08, 1.05, [[0.09, 0.11]]);
  for (const s of [-1, 1]) { const c = mesh(T, unitBox(T), M.steel(T), 'caliper'); c.scale.set(0.035, 0.09, 0.05); c.position.set(s * 0.1, FA[1] + 0.1, FA[2] + 0.1); c.rotation.x = 0.6; g.add(c); }
  // fork (25 deg rake)
  const rake = 25 * Math.PI / 180, fd = [Math.sin(rake), Math.cos(rake)]; // (z, y)
  const fp = l => [FA[1] + fd[1] * l, FA[2] + fd[0] * l];
  const [yLow, zLow] = fp(0.3), [yC1, zC1] = fp(0.56), [yC2, zC2] = fp(0.67);
  for (const s of [-1, 1]) {
    g.add(tube(T, [s * 0.1, FA[1], FA[2]], [s * 0.1, yLow, zLow], 0.032, dk, 'fork_lower'));
    g.add(tube(T, [s * 0.1, yLow - 0.02, zLow - 0.01], [s * 0.1, yC2 + 0.02, zC2 + 0.01], 0.022, M.amber(T).clone ? mat(T, 'stanchion', () => new T.MeshStandardMaterial({ color: 0xc9a14a, roughness: 0.25, metalness: 0.8 })) : st, 'fork_stanchion'));
  }
  g.add(bar(T, [0, yC1, zC1 + 0.01], [0, yC1, zC1 - 0.01], 0.27, 0.035, alu, 'triple_lower'));
  g.add(bar(T, [0, yC2, zC2 + 0.01], [0, yC2, zC2 - 0.01], 0.26, 0.03, alu, 'triple_upper'));
  g.add(tube(T, [0, yC1 - 0.02, zC1 + 0.015], [0, yC2 + 0.01, zC2 + 0.02], 0.038, dk, 'steering_head'));
  // front fender
  const fen = mesh(T, geo(T, 'motoFender', () => { const gg = new T.CylinderGeometry(0.33, 0.33, 0.13, 32, 1, true, -0.4, 1.9); gg.rotateZ(Math.PI / 2); return gg; }), paint, 'fender_F');
  fen.position.set(...FA); fen.rotation.x = -0.2; fen.material = paint; g.add(fen);
  fen.geometry = fen.geometry; fen.material.side = fen.material.side; // (paint is FrontSide; open cylinder viewed from above reads fine)
  // handlebar, grips, levers, mirrors
  const by = yC2 + 0.085, bz = zC2 + 0.02;
  for (const s of [-1, 1]) g.add(tube(T, [s * 0.05, yC2, zC2], [s * 0.05, by, bz], 0.014, blk, 'riser'));
  g.add(tube(T, [-0.24, by + 0.01, bz + 0.05], [0, by, bz], 0.012, blk, 'handlebar'));
  g.add(tube(T, [0, by, bz], [0.24, by + 0.01, bz + 0.05], 0.012, blk, 'handlebar'));
  for (const s of [-1, 1]) {
    g.add(tube(T, [s * 0.24, by + 0.01, bz + 0.05], [s * 0.36, by + 0.012, bz + 0.07], 0.018, rub, 'grip'));
    g.add(bar(T, [s * 0.22, by + 0.02, bz + 0.03], [s * 0.33, by + 0.0, bz - 0.03], 0.014, 0.012, alu, 'lever'));
    const mStalk = [s * 0.2, by + 0.02, bz + 0.04], mHead = [s * 0.29, 1.12, bz + 0.07];
    g.add(tube(T, mStalk, mHead, 0.006, blk, 'mirror_stalk'));
    const mh = mesh(T, ellipsoidGeo(T, 0.06, 0.04, 0.018, 16), blk, 'mirror'); mh.position.set(s * 0.33, 1.15, bz + 0.08); mh.rotation.set(0, 0, s * 0.12); g.add(mh);
    const mg = mesh(T, geo(T, 'mirrorGlass', () => { const gg = new T.CircleGeometry(1, 20); gg.scale(0.055, 0.036, 1); return gg; }), M.glass(T)); mg.position.set(s * 0.33, 1.15, bz + 0.0985); mg.rotation.z = s * 0.12; g.add(mg);
  }
  // headlight nacelle + twin LED headlights
  const nac = mesh(T, sideGeo(T, 'nacelle', [[-0.04, -0.09], [-0.1, -0.02], [-0.11, 0.05], [-0.05, 0.11], [0.04, 0.08], [0.05, -0.08]], 0.22, 0.03, true), paint, 'nacelle');
  nac.position.set(0, yC1 + 0.05, zC1 - 0.07); g.add(nac);
  const lamps = { head: lampMat(T, 0xf4f8ff, o.lights), tail: lampMat(T, 0xff1e12, o.lights) };
  for (const [nm, s] of [['headlight_L', -1], ['headlight_R', 1]]) {
    const h = mesh(T, ellipsoidGeo(T, 0.042, 0.032, 0.02, 18), lamps.head, nm); h.position.set(s * 0.045, yC1 + 0.07, zC1 - 0.185); g.add(h);
  }
  for (const s of [-1, 1]) { const ts = mesh(T, ellipsoidGeo(T, 0.018, 0.012, 0.026, 10), M.amber(T), 'turn_F'); ts.position.set(s * 0.14, yC1 + 0.03, zC1 - 0.08); g.add(ts); }
  // radiator + frame + swingarm
  g.add(bar(T, [0, 0.6, -0.42], [0, 0.6, -0.44], 0.36, 0.3, blk, 'radiator')).rotation.x += 0.2;
  const SH = [0, yC1 + 0.02, zC1 + 0.03], PV = 0.13;
  for (const s of [-1, 1]) {
    g.add(bar(T, [s * 0.05, SH[1], SH[2]], [s * PV, 0.8, -0.2], 0.04, 0.09, dk, 'frame_spar'));
    g.add(bar(T, [s * PV, 0.8, -0.2], [s * PV, 0.66, 0.1], 0.04, 0.09, dk, 'frame_spar'));
    g.add(bar(T, [s * PV, 0.66, 0.1], [s * PV, 0.44, 0.14], 0.04, 0.08, dk, 'frame_plate'));
    g.add(bar(T, [s * (PV - 0.01), 0.45, 0.14], [s * 0.12, RA[1], RA[2]], 0.035, 0.07, alu, 'swingarm'));
    g.add(tube(T, [s * 0.1, 0.76, 0.14], [s * 0.08, 0.84, 0.62], 0.012, dk, 'subframe'));
  }
  g.add(tube(T, [0, 0.62, 0.12], [0.03, 0.82, 0.3], 0.03, mat(T, 'spring', () => new T.MeshStandardMaterial({ color: 0xb8322a, roughness: 0.4, metalness: 0.3 })), 'shock'));
  // engine (inline-4 style): crankcase, cylinder block, head cover, sump
  g.add(mesh(T, sideGeo(T, 'crankcase', [[0.12, 0.24], [0.13, 0.46], [-0.05, 0.5], [-0.3, 0.46], [-0.33, 0.3], [-0.22, 0.22]], 0.34, 0.035, true), eng, 'crankcase'));
  g.add(mesh(T, sideGeo(T, 'cylinders', [[-0.06, 0.47], [-0.11, 0.69], [-0.33, 0.67], [-0.31, 0.45]], 0.36, 0.02), eng, 'cylinders'));
  for (let i = 0; i < 5; i++) { const f = mesh(T, sideGeo(T, 'fin', [[-0.065, 0], [-0.33, 0], [-0.33, 0.008], [-0.065, 0.008]], 0.385, 0), dk, 'fin'); f.position.y = 0.5 + i * 0.035; f.position.z = -i * 0.008; g.add(f); }
  g.add(mesh(T, sideGeo(T, 'headcover', [[-0.1, 0.69], [-0.12, 0.76], [-0.33, 0.74], [-0.33, 0.67]], 0.3, 0.025, true), st, 'head_cover'));
  const cover = mesh(T, discX(T, 0.075, 0.03, 28), st, 'clutch_cover'); cover.position.set(0.185, 0.36, -0.06); g.add(cover);
  const cover2 = mesh(T, discX(T, 0.06, 0.03, 28), st, 'stator_cover'); cover2.position.set(-0.185, 0.37, -0.12); g.add(cover2);
  // exhaust: 4 headers -> collector -> muffler (right)
  for (let i = 0; i < 4; i++) {
    const x = -0.12 + i * 0.08;
    g.add(tube(T, [x, 0.55, -0.34], [x * 0.7, 0.3, -0.36], 0.018, st, 'header'));
    g.add(tube(T, [x * 0.7, 0.3, -0.36], [x * 0.3 + 0.05, 0.17, -0.12], 0.018, st, 'header'));
  }
  g.add(tube(T, [0.06, 0.17, -0.12], [0.16, 0.24, 0.2], 0.03, st, 'collector'));
  g.add(tube(T, [0.16, 0.24, 0.2], [0.2, 0.4, 0.55], 0.065, mat(T, 'muffler', () => new T.MeshStandardMaterial({ color: 0x7c7f84, roughness: 0.22, metalness: 0.85 })), 'muffler', 24));
  g.add(tube(T, [0.2, 0.4, 0.55], [0.205, 0.415, 0.575], 0.05, blk, 'muffler_tip', 24));
  // tank, seat, tail, side panels
  g.add(mesh(T, sideGeo(T, 'tank', [[-0.4, 0.8], [-0.43, 0.9], [-0.35, 0.985], [-0.12, 1.005], [0.04, 0.93], [0.11, 0.83], [0.08, 0.79], [-0.2, 0.78]], 0.36, 0.07, true), paint, 'tank'));
  g.add(mesh(T, sideGeo(T, 'sidepanel', [[0.05, 0.62], [0.12, 0.8], [0.45, 0.8], [0.4, 0.68]], 0.24, 0.02, true), paint, 'side_panel'));
  g.add(mesh(T, sideGeo(T, 'seat', [[0.08, 0.79], [0.1, 0.85], [0.22, 0.845], [0.42, 0.86], [0.58, 0.9], [0.66, 0.9], [0.62, 0.85], [0.4, 0.8]], 0.29, 0.035, true), M.seat(T), 'seat'));
  g.add(mesh(T, sideGeo(T, 'tail', [[0.42, 0.75], [0.62, 0.85], [0.86, 0.9], [0.9, 0.87], [0.72, 0.76], [0.48, 0.7]], 0.2, 0.03, true), paint, 'tail'));
  for (const [nm, s] of [['taillight_L', -1], ['taillight_R', 1]]) { const t = mesh(T, ellipsoidGeo(T, 0.028, 0.016, 0.015, 14), lamps.tail, nm); t.position.set(s * 0.035, 0.872, 0.9); g.add(t); }
  g.add(tube(T, [0, 0.78, 0.82], [0, 0.6, 0.98], 0.012, blk, 'hugger'));
  const plate = mesh(T, unitBox(T), M.plate(T), 'plate'); plate.scale.set(0.18, 0.12, 0.006); plate.position.set(0, 0.6, 1.0); plate.rotation.x = -0.25; g.add(plate);
  for (const s of [-1, 1]) {
    g.add(tube(T, [s * 0.03, 0.66, 0.97], [s * 0.12, 0.66, 0.97], 0.006, blk));
    const ts = mesh(T, ellipsoidGeo(T, 0.018, 0.012, 0.026, 10), M.amber(T), 'turn_R'); ts.position.set(s * 0.13, 0.66, 0.97); g.add(ts);
    // footpegs, brake/shift
    g.add(tube(T, [s * 0.11, 0.36, 0.12], [s * 0.2, 0.36, 0.12], 0.011, alu, 'footpeg'));
    g.add(bar(T, [s * 0.12, 0.42, 0.16], [s * 0.15, 0.35, 0.04], 0.03, 0.06, alu, 'peg_bracket'));
  }
  // chain + sprockets (left)
  g.add(mesh(T, discX(T, 0.045, 0.012, 20), dk, 'sprocket_F')).position.set(-0.11, 0.36, 0.06);
  g.add(mesh(T, discX(T, 0.105, 0.008, 32), alu, 'sprocket_R')).position.set(-0.115, RA[1], RA[2]);
  g.add(tube(T, [-0.112, 0.405, 0.06], [-0.115, RA[1] + 0.105, RA[2]], 0.007, dk, 'chain'));
  g.add(tube(T, [-0.112, 0.315, 0.06], [-0.115, RA[1] - 0.105, RA[2]], 0.007, dk, 'chain'));
  return {
    lamps, headPos: [0, yC1 + 0.07, zC1 - 0.2],
    seat: [0, 0.875, 0.3], grips: [[-0.31, by + 0.012, bz + 0.065], [0.31, by + 0.012, bz + 0.065]],
    pegs: [[-0.16, 0.36, 0.13], [0.16, 0.36, 0.13]],
  };
}

const SMALL = {
  motorcycle: { dims: { length: 2.2, width: 0.8, height: 1.2 }, build: buildMotorcycle, eye: [0, 1.52, 0.12] },
  bicycle: { dims: { length: 1.8, width: 0.6, height: 1.1 }, build: buildBicycle, eye: [0, 1.6, 0.06] },
};
const ALIAS = { motorbike: 'motorcycle', moto: 'motorcycle', scooter: 'motorcycle', bike: 'bicycle', cycle: 'bicycle', cyclist: 'bicycle' };

export function createSmallVehicle(THREE, type, opts = {}) {
  const T = THREE; ground.T = T;
  const kind = ALIAS[type] || type, spec = SMALL[kind];
  if (!spec) throw new Error(`createSmallVehicle: unknown type "${type}"`);
  const root = new T.Group(); root.name = opts.id || kind;
  const riderOpt = opts.rider ? (opts.rider === true ? {} : opts.rider) : null;
  const lightsOn = opts.lights ?? (kind === 'motorcycle');
  const parts = spec.build(T, { ...opts, lights: lightsOn, riderH: riderOpt?.height }, root);
  root.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });

  // rider (also computes driverEye); a 1.75 m reference rider gives driverEye when none is shown
  const mkRider = (ro, show) => {
    const F = buildFigure(T, {
      height: ro.height ?? 1.75, clothing: ro.clothing ?? (kind === 'motorcycle' ? '#2b2d31' : '#4d6680'),
      helmet: ro.helmet ?? (kind === 'motorcycle'), helmetFull: kind === 'motorcycle', helmetColor: ro.helmetColor,
    });
    F.root.name = (opts.id || kind) + '_rider';
    root.add(F.root); root.updateMatrixWorld(true);
    const H = F.H;
    if (kind === 'motorcycle') {
      const hip = [0, parts.seat[1] + FIG.seatDrop * H - 0.01, parts.seat[2] - 0.02];
      poseSeatedTo(T, F, root, {
        hip, pelvis: -0.18, spine: -0.22, neck: 0.18, head: 0.14, kneeOut: 0.55, footPitch: 0.05,
        feet: parts.pegs.map(p => [p[0] * 0.95, p[1] + 0.06, p[2] - 0.02]),
        hands: parts.grips.map(p => [p[0], p[1] + 0.02, p[2] + 0.05]),
      });
    } else {
      const hip = [0, parts.seat[1] + FIG.seatDrop * H - 0.015, parts.seat[2] - 0.02];
      poseSeatedTo(T, F, root, {
        hip, pelvis: -0.35, spine: -0.25, neck: 0.3, head: 0.2, kneeOut: 0.12, footPitch: -0.1,
        feet: parts.pedals.map(p => [p[0] * 0.8, p[1] + 0.07, p[2] + 0.03]),
        hands: parts.grips.map(p => [p[0], p[1] + 0.02, p[2] + 0.05]),
      });
    }
    const eye = eyeIn(T, F, root);
    if (!show) root.remove(F.root);
    else F.root.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    return { F, eye };
  };
  let rider = null, driverEye = spec.eye;
  try {
    const r = mkRider(riderOpt || {}, !!riderOpt);
    driverEye = r.eye; if (riderOpt) rider = r.F.root;
  } catch (e) { /* keep default eye */ }

  // lights
  let spot = null;
  const setLights = (on, o2 = {}) => {
    for (const m of [parts.lamps.head, parts.lamps.tail]) m.emissiveIntensity = on ? 2.2 : 0;
    if ((opts.spotlights || o2.spot) && on && !spot) {
      spot = new T.SpotLight(0xfff4e0, kind === 'motorcycle' ? 40 : 8, kind === 'motorcycle' ? 60 : 25, 0.42, 0.5, 1.6);
      spot.name = 'headlight_spot'; spot.position.set(...parts.headPos);
      spot.target.position.set(parts.headPos[0], 0, parts.headPos[2] - 12);
      root.add(spot, spot.target);
    }
    if (spot) spot.visible = !!on;
    root.userData.lightsOn = !!on;
  };
  root.userData = { assetType: kind, dims: { ...spec.dims }, driverEye, rider, setLights, lightsOn: lightsOn };
  if (lightsOn && opts.spotlights) setLights(true);
  return root;
}

export default { createSmallVehicle, createPedestrian };
