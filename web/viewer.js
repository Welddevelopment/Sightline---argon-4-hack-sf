// Sightline viewer: loads a world module, renders it, exposes window.sl
import * as THREE from 'three';

const params = new URLSearchParams(location.search);
const DEFAULT_WORLD = '/worlds/reference_world.js';
const FALLBACK_WORLD = new URL('dev_world.js', import.meta.url).href;

// window.sl may already exist (inline script in index.html creates sl.ready); otherwise create it.
let resolveReady = window.__slResolve, rejectReady = window.__slReject;
const sl = window.sl || {};
if (!sl.ready) {
  sl.ready = new Promise((a, b) => { resolveReady = a; rejectReady = b; });
  sl.ready.catch(() => {});
}
window.sl = sl;
sl.events = new EventTarget();
const emit = (type, detail) => sl.events.dispatchEvent(new CustomEvent(type, { detail }));

// ---------- renderer / scene ----------
const stage = document.getElementById('stage') || document.body;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const canvas = renderer.domElement;
canvas.style.display = 'block';
canvas.style.width = '100%';
canvas.style.height = '100%';
stage.appendChild(canvas);

const hud = document.createElement('div');
hud.className = 'sl-hud';
hud.innerHTML = '<span class="sl-hud-cam"></span><span class="sl-hud-time"></span><span class="sl-hud-badge">SIMULATED / FICTIONAL WITNESSES</span>';
stage.appendChild(hud);
const hudCam = hud.querySelector('.sl-hud-cam');
const hudTime = hud.querySelector('.sl-hud-time');

const scene = new THREE.Scene();
const envGroup = new THREE.Group();   // lights, ground
const markerGroup = new THREE.Group(); // witness markers
const labelGroup = new THREE.Group();  // sprite labels
const rayGroup = new THREE.Group();    // sight lines
const hiGroup = new THREE.Group();     // highlight boxes
const previewGroup = new THREE.Group(); // placement preview (Place on map)
scene.add(envGroup, markerGroup, labelGroup, rayGroup, hiGroup, previewGroup);
let pickHandler = null;   // when set, overhead clicks go to this instead of the popover
let previewSpec = null;

const persp = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
const ortho = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 3000);
let camera = ortho;

const raycaster = new THREE.Raycaster();
const _box = new THREE.Box3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// ---------- state ----------
let world = null;
let worldUrl = null;
let camId = 'overhead';
let curT = 0;
let bounds = new THREE.Box3(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 5, 50));
let viewHalf = 50;        // half height of overhead view (before zoom)
let zoom = 1;
const pan = new THREE.Vector2(0, 0);
let nodeToId = new Map();
let highlightIds = [];
let showRays = true;
let showLabels = true;
let lightingKind = 'day';
let planLight = null;
let sun = null;
let fogCfg = null;
const markers = new Map();   // witnessId -> group
const labels = [];           // { sprite, kind: 'witness'|'object', ref }
let loadCount = 0;

// ---------- helpers ----------
function size() {
  const w = stage.clientWidth || window.innerWidth;
  const h = stage.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  const a = w / h;
  persp.aspect = a; persp.updateProjectionMatrix();
  return { w, h, a };
}

function disposeGroup(g) {
  for (const c of [...g.children]) {
    g.remove(c);
    c.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }
}

function makeLabel(text, opts = {}) {
  const fs = opts.fs || 24, pad = 10;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `600 ${fs}px sans-serif`;
  const tw = Math.ceil(ctx.measureText(text).width);
  c.width = tw + pad * 2; c.height = fs + pad;
  ctx.font = `600 ${fs}px sans-serif`;
  ctx.fillStyle = opts.bg || 'rgba(8,11,16,0.78)';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = opts.border || 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, c.width - 2, c.height - 2);
  ctx.fillStyle = opts.color || '#e8ecf2';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pad, c.height / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.userData.aspect = c.width / c.height;
  sp.renderOrder = 20;
  return sp;
}

function nodeBox(node, out = _box) {
  node.updateWorldMatrix(true, true);
  return out.setFromObject(node);
}

function targetPoint(look, out) {
  if (Array.isArray(look)) return out.set(look[0], look[1], look[2]);
  const o = world && world.objects[look];
  if (!o) return out.set(0, 1, 0);
  nodeBox(o.node, _box);
  return _box.getCenter(out);
}

function witnessEye(w, out) {
  const p = w.position || [0, 0, 0];
  return out.set(p[0], w.eyeHeight != null ? w.eyeHeight : (p[1] || 1.6), p[2]);
}

function findWitness(id) {
  return world && (world.witnesses || []).find((w) => w.id === id);
}

function idForNode(obj) {
  let o = obj;
  while (o) {
    if (nodeToId.has(o)) return nodeToId.get(o);
    o = o.parent;
  }
  return null;
}

function isVisibleChain(o) {
  while (o) { if (o.visible === false) return false; o = o.parent; }
  return true;
}

function isDescendant(o, anc) {
  while (o) { if (o === anc) return true; o = o.parent; }
  return false;
}

// ---------- sightline (browser-side) ----------
function computeSightline(w) {
  world.root.updateMatrixWorld(true);
  const eye = witnessEye(w, new THREE.Vector3());
  const tgt = targetPoint(w.lookAt, new THREE.Vector3());
  const dir = tgt.clone().sub(eye);
  const dist = dir.length();
  const res = { visible: true, blockedBy: null, distance: dist, from: eye.toArray(), to: tgt.toArray(), hit: null, blockers: [] };
  if (dist < 1e-6) return res;
  dir.normalize();
  raycaster.set(eye, dir);
  raycaster.near = 0; raycaster.far = dist;
  const targetNode = typeof w.lookAt === 'string' && world.objects[w.lookAt] ? world.objects[w.lookAt].node : null;
  const occ = [];
  for (const o of Object.values(world.objects)) {
    if (o.occludes && o.node !== targetNode) occ.push(o.node);
  }
  const hits = raycaster.intersectObjects(occ, true);
  raycaster.far = Infinity;
  for (const h of hits) {
    if (!h.object.isMesh || !isVisibleChain(h.object)) continue;
    if (targetNode && isDescendant(h.object, targetNode)) continue;
    const bid = idForNode(h.object);
    if (res.visible) {
      res.visible = false;
      res.blockedBy = bid;
      res.hit = h.point.toArray();
      res.distanceToBlocker = h.distance;
    }
    if (bid && !res.blockers.includes(bid)) res.blockers.push(bid);
  }
  return res;
}

// ---------- lighting ----------
function setupLighting(kind) {
  disposeGroup(envGroup);
  lightingKind = kind;
  const cfg = {
    dawn: { bg: 0xe3a981, ground: 0x6c6f5c, hemi: [0xffd1a0, 0x3a3f4a, 0.75], sun: [0xffb070, 1.4, [-90, 40, -70]], fog: [0xe3a981, 120, 600] },
    day: { bg: 0x9ec9ec, ground: 0x7d9a64, hemi: [0xffffff, 0x8a9a7a, 0.95], sun: [0xffffff, 1.7, [70, 130, 50]], fog: [0x9ec9ec, 200, 900] },
    night: { bg: 0x02040a, ground: 0x0b0f0d, hemi: [0x1a2440, 0x05060a, 0.16], sun: [0x6678a8, 0.12, [-50, 100, 30]], fog: [0x02040a, 35, 220] },
  }[kind] || null;
  const c = cfg || { bg: 0x9ec9ec, ground: 0x7d9a64, hemi: [0xffffff, 0x8a9a7a, 0.95], sun: [0xffffff, 1.7, [70, 130, 50]], fog: [0x9ec9ec, 200, 900] };
  scene.background = new THREE.Color(c.bg);
  fogCfg = new THREE.Fog(c.fog[0], c.fog[1], c.fog[2]);
  envGroup.add(new THREE.HemisphereLight(c.hemi[0], c.hemi[1], c.hemi[2]));
  sun = new THREE.DirectionalLight(c.sun[0], c.sun[1]);
  sun.position.set(...c.sun[2]);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  const half = Math.min(Math.max(viewHalf * 2, 60), 250);
  sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 1; sc.far = 600;
  sun.shadow.bias = -0.0004;
  envGroup.add(sun, sun.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: c.ground, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  ground.receiveShadow = true;
  ground.name = '__ground';
  envGroup.add(ground);
  // schematic light so the overhead plan is readable at night/dawn
  planLight = new THREE.AmbientLight(0xffffff, kind === 'night' ? 1.6 : kind === 'dawn' ? 0.5 : 0);
  envGroup.add(planLight);
}

function addHeadlights() {
  if (lightingKind === 'day') return;
  for (const [id, o] of Object.entries(world.objects)) {
    if (o.kind !== 'vehicle') continue;
    const node = o.node;
    world.setTime(0);
    node.updateWorldMatrix(true, true);
    // local bounding box (excluding any previously added lights)
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    const bb = new THREE.Box3();
    node.traverse((m) => {
      if (!m.isMesh || m.userData.isHeadlight) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld).applyMatrix4(inv);
      bb.union(b);
    });
    if (bb.isEmpty()) continue;
    // forward direction in node-local space: detect from motion
    let fwd = null;
    const T = world.duration || 10;
    for (let k = 1; k <= 4 && !fwd; k++) {
      world.setTime((k - 1) * T / 4); node.updateWorldMatrix(true, false);
      const p0 = node.getWorldPosition(new THREE.Vector3());
      const q0 = node.getWorldQuaternion(new THREE.Quaternion());
      world.setTime(k * T / 4); node.updateWorldMatrix(true, false);
      const p1 = node.getWorldPosition(new THREE.Vector3());
      const d = p1.sub(p0); d.y = 0;
      if (d.length() > 0.5) {
        d.normalize().applyQuaternion(q0.invert());
        fwd = Math.abs(d.x) > Math.abs(d.z) ? new THREE.Vector3(Math.sign(d.x), 0, 0) : new THREE.Vector3(0, 0, Math.sign(d.z));
      }
    }
    world.setTime(0);
    const sz = bb.getSize(new THREE.Vector3());
    if (!fwd) fwd = sz.x >= sz.z ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const alongX = fwd.x !== 0;
    const c = bb.getCenter(new THREE.Vector3());
    const fc = alongX ? (fwd.x > 0 ? bb.max.x : bb.min.x) : (fwd.z > 0 ? bb.max.z : bb.min.z);
    const halfW = (alongX ? sz.z : sz.x) / 2;
    const y = bb.min.y + sz.y * 0.35;
    const mat = new THREE.MeshBasicMaterial({ color: 0xfff4c8 });
    const geo = alongX ? new THREE.BoxGeometry(0.12, 0.2, 0.34) : new THREE.BoxGeometry(0.34, 0.2, 0.12);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(geo, mat);
      m.userData.isHeadlight = true;
      m.name = `${id}_headlight`;
      if (alongX) m.position.set(fc + fwd.x * 0.03, y, c.z + s * halfW * 0.6);
      else m.position.set(c.x + s * halfW * 0.6, y, fc + fwd.z * 0.03);
      node.add(m);
    }
    if (lightingKind === 'night') {
      const spot = new THREE.SpotLight(0xfff0c8, 900, 90, 0.42, 0.55, 2);
      const sp = new THREE.Vector3(c.x, y, c.z);
      if (alongX) sp.x = fc; else sp.z = fc;
      spot.position.copy(sp);
      const tgt = new THREE.Object3D();
      tgt.position.copy(sp).addScaledVector(fwd, 12).add(new THREE.Vector3(0, -1.2, 0));
      node.add(spot, tgt);
      spot.target = tgt;
    }
  }
}

// ---------- markers / labels ----------
function rebuildMarkers() {
  disposeGroup(markerGroup);
  disposeGroup(labelGroup);
  markers.clear();
  labels.length = 0;
  for (const w of world.witnesses || []) {
    const g = new THREE.Group();
    g.name = 'marker_' + w.id;
    const mat = new THREE.MeshBasicMaterial({ color: 0xf2b84b });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 1.35, 12), mat);
    body.position.y = 0.7;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), mat);
    head.position.y = 1.65;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.95, 24), new THREE.MeshBasicMaterial({ color: 0xf2b84b, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
    for (const m of [body, head, ring]) m.userData.witnessId = w.id;
    g.add(body, head, ring);
    const p = w.position || [0, 0, 0];
    g.position.set(p[0], 0, p[2]);
    markerGroup.add(g);
    markers.set(w.id, g);
    const sp = makeLabel(shortName(w), { color: '#ffd98a', border: 'rgba(242,184,75,0.8)' });
    sp.userData.ref = w.id; sp.userData.kind = 'witness';
    labelGroup.add(sp);
    labels.push(sp);
  }
  for (const [id, o] of Object.entries(world.objects)) {
    if (!['vehicle', 'occluder', 'signal'].includes(o.kind)) continue;
    const sp = makeLabel(shortLabel(o.label || id));
    sp.userData.ref = id; sp.userData.kind = 'object';
    labelGroup.add(sp);
    labels.push(sp);
  }
}

function shortLabel(t) {
  t = String(t).replace(/\s*\([^)]*\)/g, '');   // drop parentheticals
  return t.length > 26 ? t.slice(0, 25) + '…' : t;
}

function shortName(w) {
  return String(w.name || w.id).replace(/\s*\(fictional\)/i, '');
}

function updateMarkersAndLabels() {
  const overhead = camId === 'overhead';
  const k = overhead ? Math.max(1, halfNow() / 22) : 1;
  for (const [id, g] of markers) {
    g.scale.setScalar(k);
    g.visible = camId !== id;
  }
  const hgt = halfNow() * 0.034;
  const placed = [];
  const order = labels.slice().sort((a, b) => (a.userData.kind === 'witness' ? 0 : 1) - (b.userData.kind === 'witness' ? 0 : 1));
  for (const sp of order) {
    sp.visible = overhead && showLabels;
    if (!sp.visible) continue;
    const isW = sp.userData.kind === 'witness';
    const s = hgt * (isW ? 1.1 : 0.85);
    const w = s * sp.userData.aspect;
    sp.scale.set(w, s, 1);
    let x, z;
    if (isW) {
      const g = markers.get(sp.userData.ref);
      if (!g) { sp.visible = false; continue; }
      x = g.position.x; z = g.position.z - s * 1.2 - k * 1.3;
    } else {
      const o = world.objects[sp.userData.ref];
      if (!o) { sp.visible = false; continue; }
      nodeBox(o.node, _box);
      _box.getCenter(_v);
      x = _v.x; z = _box.min.z - s * 0.8;
    }
    // greedy de-overlap: push the label further north (up the screen) until it is free
    for (let i = 0; i < 14; i++) {
      const hit = placed.find((r) => Math.abs(r.x - x) < (r.w + w) / 2 + s * 0.15 && Math.abs(r.z - z) < (r.h + s) / 2 + s * 0.1);
      if (!hit) break;
      z = hit.z - (hit.h + s) / 2 - s * 0.12;
    }
    placed.push({ x, z, w, h: s });
    sp.position.set(x, 6, z);
  }
}

// ---------- sight rays / highlight ----------
function updateSightRays() {
  disposeGroup(rayGroup);
  if (camId !== 'overhead' || !showRays) return;
  for (const w of world.witnesses || []) {
    const r = computeSightline(w);
    const color = r.visible ? 0x3ddc84 : 0xff4d4d;
    const end = r.visible ? r.to : r.hit;
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...r.from), new THREE.Vector3(...end)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
    line.renderOrder = 15;
    rayGroup.add(line);
    if (!r.visible) {
      const rest = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...end), new THREE.Vector3(...r.to)]);
      const dl = new THREE.Line(rest, new THREE.LineDashedMaterial({ color: 0x8a94a6, dashSize: 0.8, gapSize: 0.6, depthTest: false, transparent: true, opacity: 0.7 }));
      dl.computeLineDistances();
      dl.renderOrder = 15;
      rayGroup.add(dl);
    }
    const dot = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.35, halfNow() * 0.008), 10, 8), new THREE.MeshBasicMaterial({ color, depthTest: false }));
    dot.position.set(...end);
    dot.renderOrder = 16;
    rayGroup.add(dot);
  }
}

function updatePreview() {
  disposeGroup(previewGroup);
  if (!previewSpec || camId !== 'overhead') return;
  const k = Math.max(1, halfNow() / 22);
  const col = 0x4dd2ff;
  const p = previewSpec.position;
  if (p) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: col });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 1.35, 12), mat); body.position.y = 0.7;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), mat); head.position.y = 1.65;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.95, 24), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08;
    g.add(body, head, ring);
    g.position.set(p[0], 0, p[2]); g.scale.setScalar(k);
    previewGroup.add(g);
    const lab = makeLabel(previewSpec.name || 'New witness', { color: '#9fe6ff', border: 'rgba(77,210,255,0.9)' });
    const s = halfNow() * 0.037;
    lab.scale.set(s * lab.userData.aspect, s, 1);
    lab.position.set(p[0], 6, p[2] - s * 1.2 - k * 1.3);
    previewGroup.add(lab);
    if (previewSpec.lookAt) {
      const t = targetPoint(previewSpec.lookAt, new THREE.Vector3());
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(p[0], 1.6, p[2]), t]),
        new THREE.LineDashedMaterial({ color: col, dashSize: 1, gapSize: 0.7, depthTest: false }));
      line.computeLineDistances(); line.renderOrder = 15;
      previewGroup.add(line);
    }
  }
}

function updateHighlight() {
  disposeGroup(hiGroup);
  for (const id of highlightIds) {
    const o = world.objects[id];
    if (!o) continue;
    const b = nodeBox(o.node, new THREE.Box3());
    if (b.isEmpty()) continue;
    b.expandByScalar(0.25);
    const h = new THREE.Box3Helper(b, 0xff3b3b);
    h.material.depthTest = false;
    h.renderOrder = 18;
    hiGroup.add(h);
  }
}

// ---------- cameras ----------
function halfNow() { return viewHalf * zoom; }

function computeBounds() {
  // Fit to static scene content (buildings, occluders, signals, marks, witnesses) plus vehicles near the action.
  // Roads are long strips, so they only contribute their intersection area (they are excluded from the extent).
  const T = world.duration || 10;
  const stat = new THREE.Box3();
  const vehBoxes = [];
  const times = [0, T * 0.25, T * 0.5, T * 0.7, T * 0.85, T];
  world.setTime(0);
  world.root.updateMatrixWorld(true);
  for (const [id, o] of Object.entries(world.objects)) {
    if (o.kind === 'road' || id.startsWith('road_')) continue;
    if (o.kind === 'vehicle') continue;
    const nb = nodeBox(o.node, new THREE.Box3());
    if (nb.isEmpty()) continue;
    const s = nb.getSize(_v);
    if (s.x > 150 || s.z > 150) continue;  // giant planes / long strips
    stat.union(nb);
  }
  for (const w of world.witnesses || []) {
    const p = w.position || [0, 0, 0];
    stat.expandByPoint(_v.set(p[0], 0, p[2]));
  }
  if (stat.isEmpty()) stat.set(new THREE.Vector3(-30, 0, -30), new THREE.Vector3(30, 5, 30));
  const c = stat.getCenter(new THREE.Vector3());
  const sz = stat.getSize(new THREE.Vector3());
  const reach = Math.max(sz.x, sz.z, 40) * 0.75;  // vehicles farther than this from the static centre are ignored
  const b = stat.clone();
  for (const t of times) {
    world.setTime(t);
    world.root.updateMatrixWorld(true);
    for (const o of Object.values(world.objects)) {
      if (o.kind !== 'vehicle') continue;
      const nb = nodeBox(o.node, new THREE.Box3());
      if (nb.isEmpty()) continue;
      const vc = nb.getCenter(new THREE.Vector3());
      if (Math.hypot(vc.x - c.x, vc.z - c.z) <= reach) b.union(nb);
    }
  }
  world.setTime(0);
  bounds = b;
}

function fitOverhead() {
  const { a } = size();
  const s = bounds.getSize(new THREE.Vector3());
  viewHalf = Math.max(s.z / 2, s.x / 2 / a, 12) * 1.18;
  const c = bounds.getCenter(new THREE.Vector3());
  pan.set(c.x, c.z);
  zoom = 1;
}

function vehicleDir(id) {
  const node = world.objects[id].node;
  const T = world.duration || 10;
  const pos = (t) => { world.setTime(t); node.updateWorldMatrix(true, false); return node.getWorldPosition(new THREE.Vector3()); };
  let d = pos(Math.min(T, curT + 0.1)).sub(pos(Math.max(0, curT - 0.1)));
  d.y = 0;
  if (d.length() < 1e-4) { d = pos(T).sub(pos(0)); d.y = 0; }
  world.setTime(curT);
  node.updateWorldMatrix(true, false);
  if (d.length() < 1e-4) d.set(1, 0, 0);
  return d.normalize();
}

function applyCamera() {
  const { a } = size();
  if (camId === 'overhead') {
    const h = halfNow();
    ortho.left = -h * a; ortho.right = h * a; ortho.top = h; ortho.bottom = -h;
    ortho.up.set(0, 0, -1);
    ortho.position.set(pan.x, 400, pan.y);
    ortho.lookAt(pan.x, 0, pan.y);
    ortho.updateProjectionMatrix();
    camera = ortho;
    scene.fog = null;
    if (planLight) planLight.visible = true;
  } else if (camId.startsWith('chase_')) {
    const vid = camId.slice(6);
    const o = world.objects[vid];
    camera = persp;
    persp.up.set(0, 1, 0);
    if (persp.fov !== 60) { persp.fov = 60; persp.updateProjectionMatrix(); }
    if (o) {
      const dir = vehicleDir(vid);
      const p = nodeBox(o.node, new THREE.Box3()).getCenter(new THREE.Vector3());
      persp.position.copy(p).addScaledVector(dir, -10).add(new THREE.Vector3(0, 4, 0));
      persp.lookAt(p.clone().addScaledVector(dir, 12).add(new THREE.Vector3(0, 1.2, 0)));
    }
    scene.fog = fogCfg;
    if (planLight) planLight.visible = false;
  } else {
    const w = findWitness(camId);
    camera = persp;
    persp.up.set(0, 1, 0);
    if (w) {
      const eye = witnessEye(w, new THREE.Vector3());
      const tp = targetPoint(w.lookAt, new THREE.Vector3());
      persp.position.copy(eye);
      persp.lookAt(tp);
      // 60 deg normally; widen to 75 deg if the target is very close or fills a large part of the view
      let fov = 60;
      const d = eye.distanceTo(tp);
      let rad = 0;
      if (typeof w.lookAt === 'string' && world.objects[w.lookAt]) rad = nodeBox(world.objects[w.lookAt].node, new THREE.Box3()).getSize(new THREE.Vector3()).length() / 2;
      if (d < 15 || (d > 0 && Math.atan(rad / d) > 0.35)) fov = 75;
      if (persp.fov !== fov) { persp.fov = fov; persp.updateProjectionMatrix(); }
    }
    scene.fog = fogCfg;
    if (planLight) planLight.visible = false;
  }
  camera.updateMatrixWorld(true);
}

// ---------- occlusion x-ray (witness cameras) + banner ----------
const xrayRestore = [];   // { mesh, material, extra: [objects to remove] }
const banner = document.createElement('div');
banner.className = 'sl-banner';
banner.hidden = true;
stage.appendChild(banner);

function clearXray() {
  while (xrayRestore.length) {
    const r = xrayRestore.pop();
    if (r.material) { const m = r.mesh.material; r.mesh.material = r.material; (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose()); }
    for (const e of r.extra) { r.mesh.remove(e); if (e.geometry) e.geometry.dispose(); if (e.material) e.material.dispose(); }
  }
}

function ghostMaterial(m) {
  const g = m.clone();
  g.transparent = true; g.opacity = 0.35; g.depthWrite = false;
  return g;
}

function applyXray(w, res) {
  clearXray();
  if (res.visible) return;
  for (const id of res.blockers) {
    const o = world.objects[id];
    if (!o) continue;
    o.node.traverse((m) => {
      if (!m.isMesh || m.userData.isHeadlight || m.userData.xray) return;
      const orig = m.material;
      m.material = Array.isArray(orig) ? orig.map(ghostMaterial) : ghostMaterial(orig);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 20), new THREE.LineBasicMaterial({ color: 0xff5a5a }));
      edges.userData.xray = true; edges.renderOrder = 12;
      m.add(edges);
      xrayRestore.push({ mesh: m, material: orig, extra: [edges] });
    });
  }
  // x-ray the target: bright fill + edges drawn through everything
  const tgt = typeof w.lookAt === 'string' ? world.objects[w.lookAt] : null;
  if (tgt) {
    tgt.node.traverse((m) => {
      if (!m.isMesh || m.userData.isHeadlight || m.userData.xray) return;
      const fill = new THREE.Mesh(m.geometry, new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false }));
      fill.userData.xray = true; fill.renderOrder = 30;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 20), new THREE.LineBasicMaterial({ color: 0xffe14d, depthTest: false, transparent: true }));
      edges.userData.xray = true; edges.renderOrder = 31;
      m.add(fill, edges);
      xrayRestore.push({ mesh: m, material: null, extra: [fill, edges] });
    });
  }
}

function updateXrayAndBanner() {
  const w = !camId.startsWith('chase_') && camId !== 'overhead' ? findWitness(camId) : null;
  if (!w) { clearXray(); banner.hidden = true; return; }
  const res = computeSightline(w);
  applyXray(w, res);
  const lbl = (id) => ((world.objects[id] && world.objects[id].label) || id || 'unknown').replace(/\s*\([^)]*\)/g, '').replace(/\s+with\s.*$/i, '');
  banner.hidden = false;
  banner.className = 'sl-banner ' + (res.visible ? 'ok' : 'bad');
  banner.textContent = res.visible ? 'LINE OF SIGHT: VISIBLE' : 'LINE OF SIGHT BLOCKED \u2014 ' + lbl(res.blockedBy);
  banner.dataset.verdict = res.visible ? 'VISIBLE' : 'BLOCKED';
  banner.dataset.blockedBy = res.blockedBy || '';
}

function cameraLabel() {
  if (camId === 'overhead') return 'Overhead (north up)';
  if (camId.startsWith('chase_')) return 'Chase: ' + ((world.objects[camId.slice(6)] || {}).label || camId.slice(6));
  const w = findWitness(camId);
  return w ? 'View of ' + shortName(w) + ' (eye ' + (w.eyeHeight || 1.6) + ' m)' : camId;
}

function renderFrame() {
  if (!world) return;
  world.root.updateMatrixWorld(true);
  applyCamera();
  updateMarkersAndLabels();
  updateSightRays();
  updateHighlight();
  updatePreview();
  updateXrayAndBanner();
  hudCam.textContent = cameraLabel();
  hudTime.textContent = 't = ' + curT.toFixed(2) + ' s';
  renderer.render(scene, camera);
}

// ---------- public API ----------
async function loadWorld(url) {
  worldUrl = url;
  const sep = url.includes('?') ? '&' : '?';
  const full = new URL(url, location.href).href + sep + '_=' + (++loadCount) + '_' + Date.now();
  const mod = await import(full);
  const w = mod.default(THREE);
  if (!w || !w.root || typeof w.setTime !== 'function') throw new Error('Bad world module: ' + url);
  w.objects = w.objects || {};
  w.witnesses = w.witnesses || [];
  w.duration = w.duration || 10;
  w.meta = w.meta || {};
  // teardown old
  if (world) scene.remove(world.root);
  world = w;
  scene.add(world.root);
  world.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  nodeToId = new Map();
  for (const [id, o] of Object.entries(world.objects)) {
    if (o.node) { nodeToId.set(o.node, id); if (!o.node.name) o.node.name = id; }
  }
  world.setTime(0);
  computeBounds();
  fitOverhead();
  const kind = (world.meta.lighting || 'day').toLowerCase();
  setupLighting(kind);
  addHeadlights();
  rebuildMarkers();
  highlightIds = [];
  curT = 0;
  world.setTime(0);
  if (camId !== 'overhead' && !sl.cameras().some((c) => c.id === camId)) camId = 'overhead';
  sl.world = world;
  sl.worldUrl = worldUrl;
  renderFrame();
  emit('loaded', { url, world });
  return world;
}

function setCamera(id) {
  if (!world) { camId = id; return; }
  const ok = sl.cameras().some((c) => c.id === id);
  camId = ok ? id : 'overhead';
  renderFrame();
  emit('camera', camId);
}

function setTime(t) {
  if (!world) { curT = Number(t) || 0; return; }
  curT = Math.max(0, Math.min(world.duration, Number(t) || 0));
  world.setTime(curT);
  renderFrame();
  emit('time', curT);
}

function cameras() {
  const out = [{ id: 'overhead', label: 'Overhead' }];
  if (!world) return out;
  for (const w of world.witnesses || []) out.push({ id: w.id, label: shortName(w) });
  for (const [id, o] of Object.entries(world.objects)) {
    if (o.kind === 'vehicle') out.push({ id: 'chase_' + id, label: 'Chase ' + (o.label || id).replace(/\s*\(.*\)/, '') });
  }
  return out;
}

function sightlineFor(wOrId, t) {
  const w = typeof wOrId === 'string' ? findWitness(wOrId) : wOrId;
  if (!w) return null;
  let prev = null;
  if (t != null) { prev = curT; world.setTime(t); }
  const r = computeSightline(w);
  if (prev != null) world.setTime(prev);
  r.witness = w.id;
  return r;
}

function addWitness(w) {
  if (!world || !w) return null;
  if (!w.id) w.id = 'wit_live_' + (world.witnesses.length + 1);
  const i = world.witnesses.findIndex((x) => x.id === w.id);
  if (i >= 0) world.witnesses[i] = w; else world.witnesses.push(w);
  rebuildMarkers();
  renderFrame();
  emit('witnesses', w);
  return w;
}

function highlight(ids) {
  highlightIds = ids == null ? [] : Array.isArray(ids) ? ids.filter(Boolean) : [ids];
  if (world) renderFrame();
}

Object.assign(sl, {
  loadWorld,
  setCamera,
  setTime,
  renderFrame,
  cameras,
  sightline: sightlineFor,
  addWitness,
  highlight,
  // placement helpers for the "Place on map" flow
  setPickHandler(fn) { pickHandler = fn || null; canvas.style.cursor = fn ? 'crosshair' : ''; },
  setPreview(spec) { previewSpec = spec || null; if (world) renderFrame(); },
  setRays(v) { showRays = !!v; renderFrame(); },
  setLabels(v) { showLabels = !!v; renderFrame(); },
  world: null,
  worldUrl: null,
  THREE,
});

Object.defineProperties(sl, {
  camera: { get: () => camId, enumerable: true },
  time: { get: () => curT, enumerable: true },
});

// ---------- picking / pan / zoom ----------
function pick(ev) {
  if (!world) return;
  const r = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  raycaster.near = 0; raycaster.far = Infinity;
  if (pickHandler && camId === 'overhead') {
    const pt = new THREE.Vector3();
    const ok = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pt);
    let objectId = null;
    for (const h of raycaster.intersectObjects([world.root], true)) {
      if (!h.object.isMesh || !isVisibleChain(h.object)) continue;
      const id = idForNode(h.object);
      if (id && !(world.objects[id].kind === 'road')) { objectId = id; break; }
    }
    if (ok) { pickHandler({ point: [pt.x, 0, pt.z], objectId, clientX: ev.clientX, clientY: ev.clientY }); return; }
  }
  const hits = raycaster.intersectObjects([markerGroup, world.root], true);
  for (const h of hits) {
    if (!h.object.isMesh || !isVisibleChain(h.object)) continue;
    if (h.object.userData.witnessId) {
      const w = findWitness(h.object.userData.witnessId);
      emit('pick', { type: 'witness', id: w.id, witness: w, clientX: ev.clientX, clientY: ev.clientY });
      return;
    }
    const id = idForNode(h.object);
    if (id) {
      emit('pick', { type: 'object', id, obj: world.objects[id], clientX: ev.clientX, clientY: ev.clientY });
      return;
    }
  }
  emit('pick', null);
}

let down = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false }; try { canvas.setPointerCapture(e.pointerId); } catch (_) {} });
canvas.addEventListener('pointermove', (e) => {
  if (!down) return;
  if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) down.moved = true;
  if (down.moved && camId === 'overhead' && world) {
    const upp = (2 * halfNow()) / (canvas.clientHeight || 1);
    pan.x -= (e.clientX - down.lx) * upp;
    pan.y -= (e.clientY - down.ly) * upp;
    renderFrame();
  }
  down.lx = e.clientX; down.ly = e.clientY;
});
canvas.addEventListener('pointerup', (e) => {
  if (down && !down.moved) pick(e);
  down = null;
});
canvas.addEventListener('wheel', (e) => {
  if (camId !== 'overhead' || !world) return;
  e.preventDefault();
  zoom = Math.max(0.15, Math.min(3, zoom * Math.exp(e.deltaY * 0.001)));
  renderFrame();
}, { passive: false });

if (window.ResizeObserver) new ResizeObserver(() => renderFrame()).observe(stage);
window.addEventListener('resize', () => renderFrame());

// ---------- boot ----------
(async () => {
  try {
    let want = params.get('world');
    const caseId = params.get('case');
    if (!want && caseId) {
      // per-case view: load that case's latest world; a case that was never reconstructed goes to the case page
      try {
        const cj = await (await fetch('/api/cases/' + encodeURIComponent(caseId))).json();
        want = cj && cj.state && cj.state.world;
      } catch (_) {}
      if (!want) { location.replace('/cases.html?case=' + encodeURIComponent(caseId)); return; }
    }
    try {
      await loadWorld(want || DEFAULT_WORLD);
    } catch (e) {
      if (want) throw e;
      console.warn('Default world failed, using dev_world.js fallback:', e.message);
      await loadWorld(FALLBACK_WORLD);
    }
    const cam = params.get('cam');
    if (cam) setCamera(cam);
    if (params.has('t')) setTime(parseFloat(params.get('t')));
    else renderFrame();
    if (params.has('rays') && params.get('rays') === '0') sl.setRays(false);
    resolveReady && resolveReady(sl);
    emit('ready', sl);
  } catch (e) {
    console.error('Viewer failed:', e);
    hudCam.textContent = 'Failed to load world: ' + e.message;
    rejectReady && rejectReady(e);
    emit('error', e);
  }
})();
