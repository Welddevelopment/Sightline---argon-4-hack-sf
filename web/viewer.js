// Sightline viewer: loads a world module, renders it, exposes window.sl
import * as THREE from 'three';
import { applyRenderQuality } from './render_quality.js';

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
// ?quality=render (headless clips/stills) = 2x supersampled + 4096 shadows; default 'interactive'
const RENDER_QUALITY = params.get('quality') === 'render' ? 'render' : 'interactive';
applyRenderQuality(renderer, null, { quality: RENDER_QUALITY });
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

// witness-eye measurements (FOV, gaze, robustness) — shown only in witness cameras
const eyePanel = document.createElement('div');
eyePanel.className = 'sl-eye';
eyePanel.hidden = true;
stage.appendChild(eyePanel);

// persistent kinematic disclaimer (text from API kinematicLabel when available)
const KINEMATIC_FALLBACK = 'Kinematic reconstruction: motion fitted to cited evidence; not a crash-physics simulation.';
const kinLabel = document.createElement('div');
kinLabel.className = 'sl-kin';
kinLabel.textContent = KINEMATIC_FALLBACK;
stage.appendChild(kinLabel);

// case data pushed in by ui.js (or fetched at boot with ?case=): checks, kinematicLabel
let caseData = { checks: [], kinematicLabel: null };
const INFERRED_RE = /inferred/i;
const INFERRED_COLOR = 0xf5a524;
const isInferred = (o) => !!(o && o.citation && INFERRED_RE.test(String(o.citation)));

const scene = new THREE.Scene();
const envGroup = new THREE.Group();   // lights, ground
const markerGroup = new THREE.Group(); // witness markers
const labelGroup = new THREE.Group();  // sprite labels
const rayGroup = new THREE.Group();    // sight lines
const hiGroup = new THREE.Group();     // highlight boxes
const previewGroup = new THREE.Group(); // placement preview (Place on map)
const infGroup = new THREE.Group();    // dashed outlines around inferred (uncited) objects
scene.add(envGroup, markerGroup, labelGroup, rayGroup, hiGroup, previewGroup, infGroup);
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
  if (opts.dashed) ctx.setLineDash([7, 5]);
  ctx.strokeRect(1, 1, c.width - 2, c.height - 2);
  ctx.setLineDash([]);
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
    const winf = isInferred(w);
    const sp = makeLabel(shortName(w) + (winf ? '  · inferred' : ''), { color: '#ffd98a', border: winf ? '#f5a524' : 'rgba(242,184,75,0.8)', dashed: winf });
    sp.userData.ref = w.id; sp.userData.kind = 'witness';
    labelGroup.add(sp);
    labels.push(sp);
  }
  for (const [id, o] of Object.entries(world.objects)) {
    const inf = isInferred(o);
    if (!['vehicle', 'occluder', 'signal'].includes(o.kind) && !(inf && !isHuge(o))) continue;
    const sp = inf
      ? makeLabel(shortLabel(o.label || id) + '  · inferred', { color: '#ffd28a', border: '#f5a524', dashed: true })
      : makeLabel(shortLabel(o.label || id));
    sp.userData.ref = id; sp.userData.kind = 'object';
    labelGroup.add(sp);
    labels.push(sp);
  }
}

// roads, ground planes and other very large objects get no outline/label (they would frame the whole scene)
function isHuge(o) {
  if (!o || !o.node || o.kind === 'road') return true;
  const b = nodeBox(o.node, new THREE.Box3());
  if (b.isEmpty()) return true;
  const s = b.getSize(new THREE.Vector3());
  return s.x > 80 || s.z > 80;
}

// thin amber dashed box around every inferred object (redrawn per frame: dynamic objects move)
const BOX_EDGES = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
function updateInferred() {
  disposeGroup(infGroup);
  if (!world) return;
  const overhead = camId === 'overhead';
  const dash = overhead ? Math.max(0.5, halfNow() * 0.018) : 0.35;
  for (const [id, o] of Object.entries(world.objects)) {
    if (!isInferred(o) || isHuge(o)) continue;
    if (camId === 'chase_' + id) continue;
    const b = nodeBox(o.node, new THREE.Box3());
    b.expandByScalar(0.3);
    const c = [];
    for (let i = 0; i < 8; i++) c.push(new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z));
    const pts = [];
    for (const [a, z] of BOX_EDGES) pts.push(c[a], c[z]);
    const seg = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({ color: INFERRED_COLOR, dashSize: dash, gapSize: dash * 0.7, depthTest: !overhead, transparent: true, opacity: 0.95 }));
    seg.computeLineDistances();
    seg.renderOrder = 17;
    seg.name = 'inferred_' + id;
    infGroup.add(seg);
  }
}

// schematic analysis marks (impact point, rest position, travel path) are map annotations, not things on the road:
// show them in the overhead plan only. Physical marks (skid / tire / gouge / debris) stay visible at eye level.
const PHYSICAL_MARK_RE = /skid|tire|tyre|gouge|scuff|scrape|debris|yaw/i;
function isAnnotationMark(id, o) {
  if (!o || !o.node || !(id.startsWith('mark_') || o.kind === 'mark')) return false;
  return !PHYSICAL_MARK_RE.test(id + ' ' + (o.label || ''));
}
function updateAnnotationMarks() {
  const show = camId === 'overhead';
  for (const [id, o] of Object.entries(world.objects)) {
    if (!isAnnotationMark(id, o)) continue;
    if (o.node.userData.slVis == null) o.node.userData.slVis = o.node.visible !== false;
    o.node.visible = show && o.node.userData.slVis;
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
    // with callouts on, overlays.js draws each vehicle's name + speed; skip the duplicate sprite
    if (sp.userData.kind === 'object' && sl.overlays && sl.overlays.enabled && (world.objects[sp.userData.ref] || {}).kind === 'vehicle') { sp.visible = false; continue; }
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

function computeBounds() { /* superseded by fitOverhead (region of interest at the current time) */ }

function fitOverhead(t) {
  const { a } = size();
  const tt = t != null ? t : curT;
  const prev = curT;
  world.setTime(tt);
  world.root.updateMatrixWorld(true);
  const wits = world.witnesses || [];
  const pts = wits.map((w) => new THREE.Vector3((w.position || [0, 0, 0])[0], 0, (w.position || [0, 0, 0])[2]));
  const boxOf = (o) => nodeBox(o.node, new THREE.Box3());
  const centreOf = (bx) => bx.getCenter(new THREE.Vector3());
  // reference point: impact mark if there is one, else the witnesses' centroid, else origin
  let ref = null;
  const entries = Object.entries(world.objects);
  const impact = entries.find(([id]) => /^mark_impact/.test(id)) || entries.find(([id]) => /impact|poi|aoi/i.test(id) && id.startsWith('mark_'));
  if (impact) ref = centreOf(boxOf(impact[1]));
  else if (pts.length) { ref = new THREE.Vector3(); pts.forEach((p) => ref.add(p)); ref.multiplyScalar(1 / pts.length); }
  else ref = new THREE.Vector3();
  const roi = new THREE.Box3();
  pts.forEach((p) => roi.expandByPoint(p));
  const near = (bx, r) => { const c = centreOf(bx); return Math.hypot(c.x - ref.x, c.z - ref.z) <= r; };
  for (const [id, o] of entries) {
    if (!o.node) continue;
    const bx = boxOf(o);
    if (bx.isEmpty()) continue;
    const sz = bx.getSize(new THREE.Vector3());
    if (o.kind === 'vehicle') { roi.union(bx); continue; }
    if (o.kind === 'road' || id.startsWith('road_')) continue;
    if (sz.x > 150 || sz.z > 150) continue;
    if (o.kind === 'mark' || id.startsWith('mark_')) { if (near(bx, 120)) roi.union(bx); continue; }
    if (o.kind === 'occluder' || o.kind === 'building' || o.kind === 'signal') { if (near(bx, 60)) roi.union(bx); }
  }
  if (roi.isEmpty()) roi.set(new THREE.Vector3(-30, 0, -30), new THREE.Vector3(30, 5, 30));
  world.setTime(prev);
  world.root.updateMatrixWorld(true);
  bounds = roi;
  const s = roi.getSize(new THREE.Vector3());
  viewHalf = Math.max(s.z / 2, s.x / 2 / a, 12) * 1.2;
  const c = roi.getCenter(new THREE.Vector3());
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
  aerialMode(camId === 'overhead');
  camera.updateMatrixWorld(true);
}

// ---------- per-case aerial photo (cases/<id>/exhibits/aerial): under the 3D road in the overhead view ----------
let aerial = null;
function aerialMode(on) {
  if (!aerial || !world) return;
  aerial.visible = on;
  world.root.traverse((o) => { if (o.userData?.assetType === 'groundPlane') o.visible = !on; });
  envGroup.children.forEach((c) => { if (c.name === '__ground') c.visible = on || !world.root.getObjectByProperty?.('name', 'ground'); });
}
async function loadAerial(url, assets) {
  if (aerial) { scene.remove(aerial); aerial = null; }
  if (params.get('aerial') === '0') return;
  const caseId = params.get('case') || (/\/cases\/([^/]+)\/worlds\//.exec(url) || [])[1];
  if (!caseId) return;
  try {
    const A = await import('./assets/aerial.js');
    let meta = await A.loadCaseAerial(caseId);
    if (!meta) {
      const base = '/cases/' + encodeURIComponent(caseId) + '/exhibits/aerial/';
      const r = await fetch(base + 'bounds.json'); if (!r.ok) return;
      const b = await r.json(); meta = { url: base + (b.image || 'aerial.jpg'), boundsMeters: b.boundsMeters, calibration: b.calibration };
    }
    const g = A.aerialGround(THREE, { url: meta.url, boundsMeters: meta.boundsMeters, calibration: meta.calibration, heightFn: assets?.terrain ? (x, z) => assets.terrain.roadHeight(x, z) : undefined });
    await Promise.race([g.userData.ready, new Promise((res) => setTimeout(res, 8000))]);
    g.name = '__aerial'; g.receiveShadow = true; g.castShadow = false;
    aerial = g; scene.add(g); aerialMode(camId === 'overhead');
  } catch (e) { console.warn('aerial unavailable', e); }
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
  for (const id of (res.blockedBy ? [res.blockedBy] : [])) {
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
  banner.textContent = res.visible ? 'LINE OF SIGHT: CLEAR' : 'LINE OF SIGHT BLOCKED \u2014 ' + lbl(res.blockedBy);
  banner.dataset.verdict = res.visible ? 'VISIBLE' : 'BLOCKED';
  banner.dataset.blockedBy = res.blockedBy || '';
}

// ---------- witness-eye measurement panel ----------
function sightCheckFor(wid) {
  const arr = Array.isArray(caseData.checks) ? caseData.checks : [];
  return arr.find((c) => c && c.check === 'sightline' && c.subject === wid) || null;
}
const fmtDeg = (x) => Math.round(Number(x)) + '\u00b0';
const escH = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function robustnessLine(rb) {
  if (!rb || rb.samples == null) return null;
  const n = Number(rb.samples), blocked = Number(rb.blocked ?? (n - Number(rb.clear || 0)));
  const clear = Number(rb.clear ?? (n - blocked));
  const r = rb.radiusM != null ? rb.radiusM : 2;
  if (blocked >= n || (rb.verdict === 'robust' && blocked > 0 && blocked >= clear)) return { cls: 'bad', text: `Blocked from ${blocked} of ${n} positions within ${r} m of mark` };
  if (blocked <= 0 || rb.verdict === 'not_blocked') return { cls: 'ok', text: `Clear from ${clear} of ${n} positions within ${r} m of mark` };
  return { cls: 'warn', text: `Blocked from ${blocked} of ${n} positions within ${r} m of mark` };
}
export function gazeLine(g) {
  if (!g || g.offAxisDeg == null || !Number.isFinite(Number(g.offAxisDeg))) return null;
  const per = g.peripheral != null ? !!g.peripheral : Number(g.offAxisDeg) > 30;
  const src = g.source && world && world.objects[g.source] ? String(world.objects[g.source].label || g.source).replace(/\s*\([^)]*\)/g, '') : null;
  const how = g.assumed ? ' (assumed gaze)' : '';
  return { cls: per ? 'warn' : '', text: `Target ${fmtDeg(g.offAxisDeg)} off gaze \u2014 ${per ? 'peripheral' : 'central'}${how}`,
    title: g.assumed ? 'Gaze direction is an assumption' + (src ? ': toward ' + src.toLowerCase() : '') + '; the witness may have been looking elsewhere.' : '' };
}

function updateEyePanel() {
  const w = !camId.startsWith('chase_') && camId !== 'overhead' ? findWitness(camId) : null;
  if (!w) { eyePanel.hidden = true; return; }
  const chk = sightCheckFor(w.id);
  const rows = [];
  const fov = Math.round(persp.fov);
  rows.push({ cls: '', text: `Camera FOV ${fov}\u00b0${fov !== 60 ? ' (widened: target close)' : ''}` });
  const g = chk && gazeLine(chk.gaze);
  if (g) rows.push(g);
  const rb = chk && robustnessLine(chk.robustness);
  if (rb) rows.push(rb);
  if (chk && chk.t != null && (g || rb) && Math.abs(Number(chk.t) - curT) > 0.05) rows.push({ cls: 'note', text: `measured at t = ${Number(chk.t).toFixed(1)} s` });
  eyePanel.innerHTML = rows.map((r) => `<div class="sl-eye-row ${r.cls}">${escH(r.text)}</div>`).join('');
  eyePanel.hidden = false;
}

function setCaseData(d) {
  d = d || {};
  const st = d.state || d;
  caseData = {
    checks: Array.isArray(d.checks) ? d.checks : Array.isArray(st.checks) ? st.checks : caseData.checks,
    kinematicLabel: d.kinematicLabel || caseData.kinematicLabel,
  };
  kinLabel.textContent = caseData.kinematicLabel || KINEMATIC_FALLBACK;
  if (world) renderFrame();
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
  updateAnnotationMarks();
  updateMarkersAndLabels();
  updateSightRays();
  updateHighlight();
  updatePreview();
  updateInferred();
  updateXrayAndBanner();
  updateEyePanel();
  hudCam.textContent = cameraLabel();
  hudTime.textContent = 't = ' + curT.toFixed(2) + ' s';
  // render_quality: AO composer (world) + overlays in UI colours; plain render when unavailable / ?rq=off
  if (sl.renderQuality && sl.renderQuality.render) sl.renderQuality.render(camera); else renderer.render(scene, camera);
}

// ---------- public API ----------
async function loadWorld(url) {
  worldUrl = url;
  const sep = url.includes('?') ? '&' : '?';
  const full = new URL(url, location.href).href + sep + '_=' + (++loadCount) + '_' + Date.now();
  const mod = await import(full);
  // WORLD CONTRACT v2: pass the shared asset library (v1 worlds ignore it). Missing/broken facade → undefined.
  const assets = await (sl._assetsP ||= import('./assets.js').then((m) => m.loadAssets(THREE)).catch((e) => { console.warn('assets.js unavailable:', e); return undefined; }));
  try { assets?.beginWorld?.(); } catch {}   // clear terrain left by a previously loaded world
  const w = mod.default(THREE, assets);
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
  { const ts = (world.witnesses || []).map((w) => w.observationTime).filter((x) => x != null).sort((p, q) => p - q);
    fitOverhead(ts.length ? ts[Math.floor(ts.length / 2)] : world.duration * 0.5); }
  const kind = (world.meta.lighting || 'day').toLowerCase();
  setupLighting(kind);
  { // v2 worlds: adopt the library environment (sky/fog/hemisphere) and terrain ground instead of the viewer presets
    let envG = null, hasGround = false;
    world.root.traverse((o) => { if (o.userData?.isEnvironment) envG = envG || o; if (o.userData?.assetType === 'groundPlane') hasGround = true; });
    if (hasGround) envGroup.children.forEach((c) => { if (c.name === '__ground') c.visible = false; });
    if (envG) {
      const sk = envG.userData.sky || {};
      if (sk.fog) fogCfg = sk.fog;
      if (sk.background?.isColor && !sk.skyMesh) scene.background = sk.background;
      envGroup.children.forEach((c) => { if (c.isHemisphereLight) c.visible = false; });
    }
  }
  await loadAerial(url, assets);
  addHeadlights();
  // render quality (web/render_quality.js): tone mapping/exposure, single shadowed sun fit to the ROI, PMREM sky fill, AA
  sl.renderQuality = applyRenderQuality(renderer, scene, { quality: RENDER_QUALITY, lighting: kind, sun, roi: bounds, world,
    overlays: [markerGroup, labelGroup, rayGroup, hiGroup, previewGroup, infGroup] });
  await sl.renderQuality.ready;
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
  const was = camId;
  camId = ok ? id : 'overhead';
  if (camId === 'overhead' && was !== 'overhead') fitOverhead(curT);
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
  // credibility: checks + kinematicLabel from GET /api/cases/:id (or /api/state); missing fields degrade gracefully
  setCaseData,
  isInferred,
  fmt: { robustnessLine, gazeLine },
  refresh() { if (world) { rebuildMarkers(); renderFrame(); } },
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
// hover tooltip: object label + citation (marks inferred objects)
let hoverTs = 0;
function hoverTitle(e) {
  const now = performance.now();
  if (!world || now - hoverTs < 120) return;
  hoverTs = now;
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  raycaster.near = 0; raycaster.far = Infinity;
  let tip = '';
  for (const h of raycaster.intersectObjects([markerGroup, world.root], true)) {
    if (!h.object.isMesh || !isVisibleChain(h.object)) continue;
    if (h.object.userData.witnessId) {
      const w = findWitness(h.object.userData.witnessId);
      if (w) tip = shortName(w) + (isInferred(w) ? ' [inferred]' : '') + (w.citation ? '\nSource: ' + w.citation : '');
      break;
    }
    const id = idForNode(h.object);
    if (id) {
      const o = world.objects[id];
      if (o.kind === 'road' && !isInferred(o)) continue;
      tip = (o.label || id) + (isInferred(o) ? ' [inferred]' : '') + (o.citation ? '\nSource: ' + o.citation : '');
      break;
    }
  }
  if (canvas.title !== tip) canvas.title = tip;
}
canvas.addEventListener('pointermove', (e) => {
  if (!down) { hoverTitle(e); return; }
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
        if (cj) setCaseData(cj);
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
    if (params.has('t')) { setTime(parseFloat(params.get('t'))); if (camId === 'overhead') { fitOverhead(curT); renderFrame(); } }
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
