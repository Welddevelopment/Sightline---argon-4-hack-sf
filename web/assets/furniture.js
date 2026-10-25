// Sightline road-furniture library (WORLD CONTRACT v2). Shared by browser + Node.
// Conventions: meters, Y up, ground y=0, rotation.y=0 => the object's FACE (sign face, signal lenses,
// building front, shelter opening) points -Z (north). Rotate by Math.PI to serve northbound traffic.
// Arms (signal mast arm, streetlight arm) reach along +X from the pole, which stands at the origin.
// Canvas textures are created lazily and only when a DOM exists; in Node every material falls back
// to a plain PBR colour so geometry (used for ray-cast checks) is identical in both environments.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { foliageMaterial, foliageClusterGeometry } from './textures.js';

// ---------------------------------------------------------------- caches & helpers
const GEO = new Map(), MAT = new Map(), TEX = new Map();
function memo(map, key, make) { let v = map.get(key); if (v === undefined) { v = make(); map.set(key, v); } return v; }
export const hasCanvas = () => typeof document !== 'undefined' && typeof document.createElement === 'function';
const UP = new THREE.Vector3(0, 1, 0);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const f3 = n => (+n).toFixed(3);

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

function std(key, p) { return memo(MAT, key, () => new THREE.MeshStandardMaterial(p)); }
function texStd(key, texFn, fallback, p = {}) {
  return memo(MAT, key, () => { const t = texFn(); return new THREE.MeshStandardMaterial({ color: t ? 0xffffff : fallback, map: t || null, ...p }); });
}
function ctex(key, w, h, draw, { repeat = false, srgb = true } = {}) {
  if (!hasCanvas()) return null;
  return memo(TEX, key, () => {
    const c = document.createElement('canvas'); c.width = Math.max(2, Math.round(w)); c.height = Math.max(2, Math.round(h));
    const g = c.getContext('2d'); draw(g, c.width, c.height);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  });
}
function mesh(geo, mat, parent, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true;
  if (parent) parent.add(m); return m;
}
const box = (w, h, d) => memo(GEO, `box:${f3(w)}:${f3(h)}:${f3(d)}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt, rb, h, s = 16, open = false) => memo(GEO, `cyl:${f3(rt)}:${f3(rb)}:${f3(h)}:${s}:${open}`, () => new THREE.CylinderGeometry(rt, rb, h, s, 1, open));
const sph = (r, ws = 16, hs = 10) => memo(GEO, `sph:${f3(r)}:${ws}:${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
function member(parent, a, b, r0, r1, mat, seg = 12) {
  const d = b.clone().sub(a); const len = d.length();
  const m = mesh(cyl(r1, r0, len, seg), mat, parent);
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UP, d.normalize()); return m;
}
function wire(parent, a, b, sag, r, mat, n = 18) {
  const pts = []; for (let i = 0; i <= n; i++) { const t = i / n; const p = a.clone().lerp(b, t); p.y -= 4 * sag * t * (1 - t); pts.push(p); }
  const m = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, r, 5, false), mat, parent, 0, 0, 0, false);
  return m;
}
function finish(obj, type, id, dims, extra = {}) {
  obj.name = id ?? type; obj.userData.assetType = type; obj.userData.dims = dims; Object.assign(obj.userData, extra); return obj;
}
// planar UV remap for ShapeGeometry (bbox -> 0..1)
function shapeGeo(pts, key) {
  return memo(GEO, key, () => {
    const s = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
    const g = new THREE.ShapeGeometry(s, 4);
    g.computeBoundingBox(); const bb = g.boundingBox; const uv = g.attributes.uv, pos = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) - bb.min.x) / (bb.max.x - bb.min.x), (pos.getY(i) - bb.min.y) / (bb.max.y - bb.min.y));
    return g;
  });
}
function bboxPts(pts) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; }

// convex polygon helpers (meters)
function inset(pts, d) {
  const n = pts.length; let area = 0;
  for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; area += p[0] * q[1] - q[0] * p[1]; }
  const s = area > 0 ? 1 : -1;
  const L = pts.map((p, i) => { const q = pts[(i + 1) % n]; let dx = q[0] - p[0], dy = q[1] - p[1]; const l = Math.hypot(dx, dy); dx /= l; dy /= l; return { px: p[0] - dy * s * d, py: p[1] + dx * s * d, dx, dy }; });
  return L.map((l, i) => { const m = L[(i - 1 + n) % n]; const det = m.dx * l.dy - m.dy * l.dx; const t = ((l.px - m.px) * l.dy - (l.py - m.py) * l.dx) / det; return [m.px + m.dx * t, m.py + m.dy * t]; });
}
function rounded(pts, r, seg = 5) {
  if (!r) return pts; const out = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const d = Math.min(r, la / 2, lb / 2);
    const p1 = [p[0] + (a[0] - p[0]) / la * d, p[1] + (a[1] - p[1]) / la * d], p2 = [p[0] + (b[0] - p[0]) / lb * d, p[1] + (b[1] - p[1]) / lb * d];
    for (let k = 0; k <= seg; k++) { const t = k / seg, u = 1 - t; out.push([u * u * p1[0] + 2 * u * t * p[0] + t * t * p2[0], u * u * p1[1] + 2 * u * t * p[1] + t * t * p2[1]]); }
  }
  return out;
}

// ---------------------------------------------------------------- canvas drawing kit
const FONT = '"Roadgeek 2005 Series D","Highway Gothic","Overpass","Liberation Sans Narrow","Arial Narrow","DejaVu Sans Condensed","Liberation Sans","DejaVu Sans",Arial,Helvetica,sans-serif';
function noise(g, W, H, amt = 14, seed = 1) {
  const R = rng(seed), img = g.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
}
// painter in meter space over a bbox (y up)
function painter(g, W, H, bb) {
  const sx = W / bb.w, sy = H / bb.h;
  const P = {
    g, W, H, ppm: sx,
    x: x => (x - bb.x0) * sx, y: y => (bb.y1 - y) * sy, s: m => m * sx,
    path(pts) { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(P.x(x), P.y(y)) : g.moveTo(P.x(x), P.y(y))); g.closePath(); },
    fill(pts, c) { P.path(pts); g.fillStyle = c; g.fill(); },
    stroke(pts, c, w) { P.path(pts); g.strokeStyle = c; g.lineWidth = P.s(w); g.lineJoin = 'round'; g.stroke(); },
    rect(x, y, w, h, c) { g.fillStyle = c; g.fillRect(P.x(x), P.y(y + h), P.s(w), P.s(h)); },
    line(x1, y1, x2, y2, w, c, cap = 'butt') { g.beginPath(); g.moveTo(P.x(x1), P.y(y1)); g.lineTo(P.x(x2), P.y(y2)); g.strokeStyle = c; g.lineWidth = P.s(w); g.lineCap = cap; g.stroke(); },
    circle(x, y, r, c) { g.beginPath(); g.arc(P.x(x), P.y(y), P.s(r), 0, Math.PI * 2); g.fillStyle = c; g.fill(); },
    // text by cap height (m); baseline placed so caps are centred on y
    text(str, x, y, cap, maxW, c, squeeze = 0.86, weight = 'bold') {
      const px = P.s(cap) / 0.716; g.save(); g.font = `${weight} ${px}px ${FONT}`; g.fillStyle = c; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      const w = g.measureText(str).width * squeeze; const k = Math.min(squeeze, squeeze * P.s(maxW) / Math.max(1, w));
      g.translate(P.x(x), P.y(y) + P.s(cap) / 2); g.scale(k, 1); g.fillText(str, 0, 0); g.restore();
    },
  };
  return P;
}

// ---------------------------------------------------------------- shared materials
const M = {
  galv: () => std('galv', { color: 0xa3a9ac, metalness: 0.85, roughness: 0.4 }),
  galvDull: () => std('galvDull', { color: 0x8e9396, metalness: 0.7, roughness: 0.62 }),
  alum: () => std('alum', { color: 0xc6cacd, metalness: 0.9, roughness: 0.32 }),
  signBack: () => std('signBack', { color: 0x9ea3a6, metalness: 0.6, roughness: 0.5, side: THREE.FrontSide }),
  black: () => std('black', { color: 0x151617, metalness: 0.15, roughness: 0.55 }),
  blackDS: () => std('blackDS', { color: 0x111213, metalness: 0.15, roughness: 0.6, side: THREE.DoubleSide }),
  sigHousing: () => std('sigHousing', { color: 0x1b1c1d, metalness: 0.25, roughness: 0.5 }),
  retroYellow: () => std('retroYellow', { color: 0xf2c400, roughness: 0.35, emissive: 0x1a1400 }),
  concrete: () => texStd('concrete', () => ctex('concrete', 256, 256, (g, W, H) => { g.fillStyle = '#aaa69d'; g.fillRect(0, 0, W, H); noise(g, W, H, 22, 7); }, { repeat: true }), 0xaaa69d, { roughness: 0.92 }),
  cableBlack: () => std('cableBlack', { color: 0x1a1a1a, roughness: 0.6 }),
  conductor: () => std('conductor', { color: 0x6f7376, metalness: 0.8, roughness: 0.45 }),
  wood: () => texStd('woodPole', () => ctex('woodPole', 128, 512, (g, W, H) => {
    g.fillStyle = '#5d4c3b'; g.fillRect(0, 0, W, H); const R = rng(11);
    for (let i = 0; i < 160; i++) { const x = R() * W; g.strokeStyle = `rgba(${R() < 0.5 ? '30,22,15' : '120,104,84'},${0.15 + R() * 0.3})`; g.lineWidth = 0.5 + R() * 2; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + (R() - 0.5) * 8, H * 0.3, x + (R() - 0.5) * 8, H * 0.7, x + (R() - 0.5) * 6, H); g.stroke(); }
    for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(20,14,10,0.6)'; g.fillRect(R() * W, R() * H, 1 + R() * 1.5, 20 + R() * 60); }
    noise(g, W, H, 16, 3);
  }, { repeat: true }), 0x5d4c3b, { roughness: 0.92 }),
  porcelain: () => std('porcelain', { color: 0x8a9a92, roughness: 0.18, metalness: 0.0 }),
  // clear float glass: ~90% transmission, no diffuse body colour (a milky albedo reads as a frosted slab in sunlight);
  // what remains visible is the faint grey tint + the Fresnel sky reflection from the environment map.
  glass: () => std('glass', { color: 0x0e1416, roughness: 0.03, metalness: 0.0, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4 }),
  bark: () => texStd('bark', () => ctex('bark', 128, 256, (g, W, H) => {
    g.fillStyle = '#4f4438'; g.fillRect(0, 0, W, H); const R = rng(5);
    for (let i = 0; i < 90; i++) { const x = R() * W; g.strokeStyle = `rgba(${R() < 0.6 ? '28,22,17' : '110,98,84'},${0.3 + R() * 0.4})`; g.lineWidth = 1 + R() * 3; g.beginPath(); g.moveTo(x, 0); for (let y = 0; y <= H; y += 16) g.lineTo(x + (R() - 0.5) * 6, y); g.stroke(); }
    noise(g, W, H, 20, 9);
  }, { repeat: true }), 0x4f4438, { roughness: 0.95 }),
};

// ================================================================= SIGNAL
const HEAD = { w: 0.356, sec: 0.33, depth: 0.25, lensR: 0.152 };
const LENS = {
  red: { off: 0x2a0806, on: 0xff3b24 },
  yellow: { off: 0x2e2205, on: 0xffb51e },
  green: { off: 0x062418, on: 0x29ffb0 },
};
function signalHead(parent, x, y, z, lensMats, backplate = true) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
  const H = HEAD.sec * 3 + 0.04;
  const housing = memo(GEO, 'sigHousing', () => new RoundedBoxGeometry(HEAD.w, H, HEAD.depth, 3, 0.03));
  mesh(housing, M.sigHousing(), g, 0, -H / 2, 0);
  // tunnel visors (open at the bottom) + lenses, faces -Z
  const visor = memo(GEO, 'sigVisor', () => { const v = new THREE.CylinderGeometry(0.168, 0.168, 0.24, 24, 1, true, 0.75, Math.PI * 2 - 1.5); v.rotateX(Math.PI / 2); return v; });
  const lens = memo(GEO, 'sigLens', () => { const l = new THREE.SphereGeometry(0.36, 24, 6, 0, Math.PI * 2, 0, 0.44); l.rotateX(-Math.PI / 2); l.translate(0, 0, 0.36 - 0.012); return l; });
  const ring = memo(GEO, 'sigRing', () => { const r = new THREE.TorusGeometry(0.158, 0.012, 6, 24); return r; });
  ['red', 'yellow', 'green'].forEach((c, i) => {
    const cy = -0.02 - HEAD.sec * (i + 0.5);
    const l = mesh(lens, lensMats[c], g, 0, cy, -HEAD.depth / 2 - 0.004, false); l.scale.z = -1; l.name = 'lens_' + c;
    mesh(ring, M.black(), g, 0, cy, -HEAD.depth / 2 - 0.004, false);
    mesh(visor, M.blackDS(), g, 0, cy, -HEAD.depth / 2 - 0.12);
  });
  if (backplate) { // black louvred backplate with 2" retroreflective yellow border (FDOT practice)
    mesh(box(0.62, H + 0.26, 0.012), M.retroYellow(), g, 0, -H / 2, 0.032, true);
    mesh(box(0.54, H + 0.18, 0.012), M.black(), g, 0, -H / 2, 0.022, false);
  }
  mesh(cyl(0.025, 0.025, 0.14, 8), M.black(), g, 0, 0.07, 0);
  return g;
}

export function signal(opts = {}) {
  const id = opts.id ?? 'signal';
  const heads = Math.max(1, Math.round(opts.heads ?? 1));
  const spanWire = !!opts.spanWire;
  let arm = opts.mastArm ?? opts.armLength ?? (spanWire ? 14 : 0);
  if (arm === true) arm = 7.5;
  arm = +arm || 0;
  const headH = HEAD.sec * 3 + 0.04;
  const root = new THREE.Group();
  const lensMats = {};
  for (const c of Object.keys(LENS)) lensMats[c] = new THREE.MeshStandardMaterial({ color: LENS[c].off, emissive: LENS[c].on, emissiveIntensity: 0, roughness: 0.15, metalness: 0.0 });
  const pmat = opts.poleColor === 'black' ? M.black() : M.galv();
  let armY, top;
  const foundation = () => { mesh(cyl(0.42, 0.42, 0.16, 20), M.concrete(), root, 0, 0.08, 0); mesh(box(0.5, 0.04, 0.5), pmat, root, 0, 0.18, 0); };
  if (spanWire) {
    armY = Math.max(opts.poleHeight ?? 7.2, 4.6 + headH + 0.9);
    const ph = armY + 0.9;
    for (const x of [0, arm]) { member(root, V(x, 0, 0), V(x, ph, 0), 0.16, 0.11, M.wood()); }
    const a = V(0.12, armY + 0.6, 0), b = V(arm - 0.12, armY + 0.6, 0), sag = Math.min(0.9, arm * 0.035);
    wire(root, a, b, sag, 0.009, M.conductor());
    wire(root, a.clone().setY(armY + 0.85), b.clone().setY(armY + 0.85), sag * 0.9, 0.007, M.conductor());
    const sp = arm / (heads + 1);
    for (let i = 0; i < heads; i++) {
      const x = sp * (i + 1), t = x / arm, wy = armY + 0.6 - 4 * sag * t * (1 - t);
      mesh(cyl(0.02, 0.02, 0.3, 6), M.black(), root, x, wy - 0.15, 0);
      signalHead(root, x, wy - 0.3, 0, lensMats, false);
    }
    top = ph;
  } else if (arm > 0) {
    armY = Math.max(opts.poleHeight ?? 6.4, 4.6 + headH + 0.3);
    const ph = armY + 1.1; top = ph;
    foundation();
    member(root, V(0, 0.2, 0), V(0, ph, 0), 0.2, 0.135, pmat, 20);
    mesh(sph(0.14, 12, 6), pmat, root, 0, ph, 0);
    const tipY = armY + arm * 0.035;
    member(root, V(0.1, armY, 0), V(arm, tipY, 0), 0.13, 0.07, pmat, 16);
    mesh(box(0.08, 0.5, 0.42), pmat, root, 0.15, armY, 0); // arm-to-pole flange
    // diagonal upper tie for long arms
    if (arm > 9) member(root, V(0.05, armY + 0.95, 0), V(arm * 0.45, armY + arm * 0.45 * 0.035 + 0.08, 0), 0.04, 0.035, pmat, 8);
    const sp = heads > 1 ? Math.min(3.6, (arm - 1.4) / (heads - 1)) : 0;
    for (let i = 0; i < heads; i++) {
      const x = arm - 0.6 - sp * i, ay = armY + x * 0.035;
      mesh(box(0.06, 0.16, 0.06), M.black(), root, x, ay - 0.1, 0);
      signalHead(root, x, ay - 0.18, 0, lensMats, true);
    }
    if (opts.streetName) {
      const b = streetBlade(opts.streetName, opts.bladeLength);
      b.position.set(Math.min(arm * 0.42, arm - 2), armY + arm * 0.42 * 0.035 + 0.27, 0); root.add(b);
      mesh(box(0.04, 0.22, 0.04), M.galv(), root, b.position.x, armY + 0.1, 0);
    }
  } else { // post-top / side-mounted head(s)
    const ph = opts.poleHeight ?? 4.4; top = ph + 0.1; armY = ph;
    foundation();
    member(root, V(0, 0.2, 0), V(0, ph, 0), 0.11, 0.08, pmat, 16);
    mesh(sph(0.085, 10, 6), pmat, root, 0, ph, 0);
    for (let i = 0; i < heads; i++) {
      const side = heads === 1 ? 0 : (i % 2 ? 1 : -1) * (0.45 + 0.7 * Math.floor(i / 2));
      if (side) mesh(box(Math.abs(side), 0.06, 0.06), M.black(), root, side / 2, ph - 0.2, 0);
      mesh(box(0.06, 0.06, 0.24), M.black(), root, side, ph - 0.2, -0.12);
      signalHead(root, side, ph - 0.05, -0.32, lensMats, true);
    }
  }
  root.traverse(o => { if (o.isMesh && o.name.startsWith('lens_')) o.castShadow = false; });
  const setState = (state, t) => {
    let on = { red: false, yellow: false, green: false };
    const blink = t == null ? true : Math.floor(t * 2) % 2 === 0; // 60 flashes/min, 50% duty
    if (state === 'red' || state === 'green' || state === 'yellow') on[state] = true;
    else if (state === 'flash' || state === 'flash_yellow') on.yellow = blink;
    else if (state === 'flash_red') on.red = blink;
    for (const c of Object.keys(LENS)) { const m = lensMats[c]; m.emissiveIntensity = on[c] ? 3.2 : 0; m.color.setHex(on[c] ? LENS[c].on : LENS[c].off); }
    root.userData.state = state;
  };
  setState(opts.state || 'off');
  return finish(root, 'signal', id, { length: 0.8, width: Math.max(0.8, arm + 0.4), height: top }, {
    setState, heads, armLength: arm, headCenters: 'faces -Z', mountHeight: armY, origin: 'pole base; arm reaches +X',
  });
}

// ================================================================= SIGNS
const RED = '#b8122b', WHITE = '#f4f4f0', BLACK = '#111', YELLOW = '#f4c300', GREEN = '#00653a';
const IN = 0.0254;
function bladeLen(text) { return Math.max(0.76, Math.min(2.4, 0.2 + String(text).length * 0.105)); }
function signSpec(kind, o) {
  const k = String(kind).toLowerCase();
  const warn = { side_road: 'side_road_right', side_road_right: 1, side_road_left: 1, intersection: 1, intersection_ahead: 'intersection', crossroad: 'intersection', t_intersection: 1, signal_ahead: 1, stop_ahead: 1, curve_left: 1, curve_right: 1, warning: 1 };
  if (k === 'stop') {
    const w = o.size ?? 30 * IN, R = (w / 2) / Math.cos(Math.PI / 8);
    const oct = Array.from({ length: 8 }, (_, i) => { const a = Math.PI / 8 + i * Math.PI / 4; return [R * Math.cos(a), R * Math.sin(a)]; });
    return { key: `stop:${f3(w)}`, pts: rounded(oct, 0.012, 3), w, h: w, fb: 0xb8122b, draw: P => { P.fill(oct, RED); P.stroke(inset(oct, w * 0.03), WHITE, w * 0.025); P.text('STOP', 0, 0, w * 0.333, w * 0.82, WHITE, 0.9); } };
  }
  if (k === 'yield') {
    const s = o.size ?? 36 * IN, h = s * Math.sqrt(3) / 2;
    const tri = [[-s / 2, h / 2], [0, -h / 2], [s / 2, h / 2]];
    return { key: `yield:${f3(s)}`, pts: rounded(tri, 0.03, 4), w: s, h, fb: 0xb8122b, draw: P => { P.fill(tri, RED); P.fill(rounded(inset(tri, s * 0.125), 0.02, 3), WHITE); P.text('YIELD', 0, h / 2 - h / 3 + 0.02, s * 0.12, s * 0.42, RED, 0.9); } };
  }
  if (k === 'speed_limit' || k === 'speed') {
    const w = 24 * IN, h = 30 * IN, n = String(o.speed ?? o.limit ?? o.text ?? 45).replace(/\D/g, '') || '45';
    const r = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
    return { key: `speed:${n}`, pts: rounded(r, 0.035), w, h, fb: 0xeeeeea, draw: P => {
      P.fill(r, WHITE); P.stroke(rounded(inset(r, 0.016), 0.025), BLACK, 0.016);
      P.text('SPEED', 0, h * 0.33, 4 * IN, w * 0.8, BLACK); P.text('LIMIT', 0, h * 0.17, 4 * IN, w * 0.8, BLACK);
      P.text(n, 0, -h * 0.15, 10 * IN, w * 0.84, BLACK, 0.8); } };
  }
  if (k === 'street_name') return { blade: true };
  if (k === 'route_shield' || k === 'route') {
    const w = 24 * IN, n = String(o.text ?? o.route ?? '27'), st = o.style || 'us';
    const r = [[-w / 2, -w / 2], [w / 2, -w / 2], [w / 2, w / 2], [-w / 2, w / 2]];
    return { key: `shield:${st}:${n}`, pts: rounded(r, 0.02), w, h: w, fb: 0x111111, draw: P => {
      P.fill(r, BLACK); const g = P.g;
      if (st === 'state') { P.fill(rounded(inset(r, 0.05), 0.04), WHITE); }
      else {
        const a = w * 0.44; g.beginPath(); g.moveTo(P.x(-a), P.y(a * 0.92));
        g.lineTo(P.x(-a * 0.25), P.y(a * 0.92)); g.quadraticCurveTo(P.x(0), P.y(a * 0.78), P.x(a * 0.25), P.y(a * 0.92)); g.lineTo(P.x(a), P.y(a * 0.92));
        g.quadraticCurveTo(P.x(a * 0.86), P.y(a * 0.45), P.x(a * 0.95), P.y(0.0)); g.quadraticCurveTo(P.x(a * 0.95), P.y(-a * 0.7), P.x(0), P.y(-a * 1.02));
        g.quadraticCurveTo(P.x(-a * 0.95), P.y(-a * 0.7), P.x(-a * 0.95), P.y(0)); g.quadraticCurveTo(P.x(-a * 0.86), P.y(a * 0.45), P.x(-a), P.y(a * 0.92)); g.closePath(); g.fillStyle = WHITE; g.fill();
      }
      P.text(n, 0, -w * 0.02, w * (n.length > 2 ? 0.26 : 0.34), w * 0.66, BLACK, 0.85); } };
  }
  if (warn[k]) {
    const sym = k === 'warning' ? (o.symbol || 'text') : (typeof warn[k] === 'string' ? warn[k] : k);
    const s = o.size ?? 30 * IN, a = s * Math.SQRT2 / 2;
    const dia = [[0, a], [-a, 0], [0, -a], [a, 0]];
    const L = a * 0.62, lw = s * 0.11;
    return { key: `warn:${sym}:${o.text || ''}:${f3(s)}`, pts: rounded(dia, 0.04), w: 2 * a, h: 2 * a, fb: 0xf4c300, draw: P => {
      P.fill(dia, YELLOW); P.stroke(rounded(inset(dia, 0.02), 0.03), BLACK, 0.018);
      const g = P.g;
      if (sym === 'intersection') { P.line(0, -L, 0, L, lw, BLACK); P.line(-L, 0, L, 0, lw, BLACK); }
      else if (sym === 'side_road_right') { P.line(0, -L, 0, L, lw, BLACK); P.line(0, 0, L, 0, lw, BLACK); }
      else if (sym === 'side_road_left') { P.line(0, -L, 0, L, lw, BLACK); P.line(-L, 0, 0, 0, lw, BLACK); }
      else if (sym === 't_intersection') { P.line(-L, L * 0.35, L, L * 0.35, lw, BLACK); P.line(0, -L, 0, L * 0.35, lw, BLACK); }
      else if (sym === 'signal_ahead') {
        P.fill(rounded([[-0.075, -0.2], [0.075, -0.2], [0.075, 0.2], [-0.075, 0.2]], 0.02), BLACK);
        P.circle(0, 0.12, 0.05, '#d81e1e'); P.circle(0, 0, 0.05, YELLOW); P.circle(0, -0.12, 0.05, '#0a9a4a');
      } else if (sym === 'stop_ahead') {
        const R = 0.11 / Math.cos(Math.PI / 8); const oc = Array.from({ length: 8 }, (_, i) => { const t = Math.PI / 8 + i * Math.PI / 4; return [R * Math.cos(t), 0.12 + R * Math.sin(t)]; });
        P.fill(oc, '#c8102e'); P.line(0, -L, 0, -0.08, lw * 0.8, BLACK);
        P.fill([[-0.09, -0.06], [0.09, -0.06], [0, 0.0]], BLACK);
      } else if (sym === 'curve_right' || sym === 'curve_left') {
        const m = sym === 'curve_right' ? 1 : -1;
        g.beginPath(); g.moveTo(P.x(-0.06 * m), P.y(-L)); g.lineTo(P.x(-0.06 * m), P.y(-0.05)); g.quadraticCurveTo(P.x(-0.06 * m), P.y(0.17), P.x(0.13 * m), P.y(0.22));
        g.strokeStyle = BLACK; g.lineWidth = P.s(lw * 0.8); g.stroke();
        P.fill([[0.1 * m, 0.33], [0.3 * m, 0.24], [0.1 * m, 0.1]], BLACK);
      } else {
        const lines = String(o.text || 'CAUTION').toUpperCase().split('\n');
        lines.forEach((t, i) => P.text(t, 0, (lines.length - 1) * 0.07 - i * 0.14, 0.1, a * 1.1, BLACK));
      }
    } };
  }
  // generic rectangular sign
  const w = o.w ?? 0.61, h = o.h ?? 0.76, bg = o.bg || WHITE, fg = o.fg || BLACK;
  const lines = String(o.text ?? '').split('\n').filter(Boolean);
  const r = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  return { key: `gen:${f3(w)}:${f3(h)}:${bg}:${fg}:${lines.join('|')}`, pts: rounded(r, 0.03), w, h, fb: 0xeeeeea, draw: P => {
    P.fill(r, bg); P.stroke(rounded(inset(r, 0.015), 0.02), fg, 0.014);
    const cap = Math.min(0.11, (h * 0.7) / Math.max(1, lines.length * 1.5));
    lines.forEach((t, i) => P.text(t, 0, (lines.length - 1) * cap * 0.75 - i * cap * 1.5, cap, w * 0.86, fg));
  } };
}
function plateFace(spec, faceMat) {
  const bb = bboxPts(spec.pts);
  if (faceMat !== undefined) return faceMat;
  return memo(MAT, 'signface:' + spec.key, () => {
    const ppm = Math.min(700, 1024 / Math.max(bb.w, bb.h));
    const t = ctex('signface:' + spec.key, bb.w * ppm, bb.h * ppm, (g, W, H) => spec.draw(painter(g, W, H, bb)));
    return new THREE.MeshStandardMaterial({ color: t ? 0xffffff : spec.fb, map: t, roughness: 0.42, metalness: 0.0 });
  });
}
// returns a Group: face toward -Z (and +Z when doubleSided), centred on the plate
function signPlate(spec, doubleSided = false) {
  const g = new THREE.Group();
  const geo = shapeGeo(spec.pts, 'plate:' + spec.key);
  const face = mesh(geo, plateFace(spec), g, 0, 0, -0.0015); face.rotation.y = Math.PI;
  const back = mesh(geo, doubleSided ? plateFace(spec) : M.signBack(), g, 0, 0, 0.0015);
  if (!doubleSided) back.castShadow = false;
  return g;
}
function streetBlade(text, len) {
  const L = len ?? bladeLen(text), h = 0.2032;
  const r = [[-L / 2, -h / 2], [L / 2, -h / 2], [L / 2, h / 2], [-L / 2, h / 2]];
  const spec = { key: `blade:${text}:${f3(L)}`, pts: rounded(r, 0.02), fb: 0x00653a, draw: P => {
    P.fill(r, GREEN); P.stroke(rounded(inset(r, 0.012), 0.015), WHITE, 0.01); P.text(String(text).toUpperCase(), 0, 0, 0.11, L - 0.1, WHITE, 0.82); } };
  const g = signPlate(spec, true); g.userData.length = L; return g;
}
let PERF_GEO_LEN = new Map();
function signPost(parent, h, x = 0, z = 0) {
  const geo = memo(GEO, `post:${f3(h)}`, () => {
    const b = new THREE.BoxGeometry(0.051, h, 0.051); const uv = b.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * h / 0.4);
    return b;
  });
  const mat = texStd('perfPost', () => ctex('perfPost', 32, 512, (g, W, H) => {
    g.fillStyle = '#a7acae'; g.fillRect(0, 0, W, H); noise(g, W, H, 18, 4);
    g.fillStyle = '#2a2c2d'; for (let i = 0; i < 16; i++) g.fillRect(W / 2 - 4, i * 32 + 12, 8, 8);
  }, { repeat: true }), 0xa7acae, { metalness: 0.75, roughness: 0.45 });
  return mesh(geo, mat, parent, x, h / 2, z);
}

export function sign(kind = 'generic', opts = {}) {
  if (kind && typeof kind === 'object') { opts = kind; kind = opts.kind || 'generic'; }
  const id = opts.id ?? `sign_${kind}`;
  const root = new THREE.Group();
  const spec = signSpec(kind, opts);
  const bottom = opts.mountHeight ?? (opts.rural ? 1.52 : 2.13);
  let top, width = 0.2;
  const blades = [];
  if (spec.blade) {
    const t1 = opts.text ?? opts.streetName ?? 'MAIN ST';
    blades.push([t1, 0]); if (opts.text2 || opts.streetName2) blades.push([opts.text2 || opts.streetName2, Math.PI / 2]);
    top = (opts.mountHeight ?? 2.75) + 0.26 * blades.length;
    signPost(root, top - 0.05);
  } else {
    const plate = signPlate(spec, false);
    const cy = bottom + spec.h / 2;
    plate.position.set(0, cy, -0.04); root.add(plate);
    for (const dy of [spec.h * 0.32, -spec.h * 0.32]) mesh(cyl(0.011, 0.011, 0.012, 8), M.galv(), root, 0, cy + dy, -0.048).rotation.x = Math.PI / 2;
    top = bottom + spec.h; width = spec.w;
    if (opts.streetName) blades.push([opts.streetName, 0]);
    if (opts.streetName2) blades.push([opts.streetName2, Math.PI / 2]);
    if (blades.length) top = Math.max(top + 0.45, 2.75) + 0.26 * blades.length;
    signPost(root, blades.length ? top - 0.05 : top - 0.03);
  }
  blades.forEach(([t, ry], i) => {
    const b = streetBlade(t); b.rotation.y = ry; b.position.y = top - 0.13 - i * 0.26; root.add(b);
    mesh(box(0.07, 0.24, 0.07), M.galv(), root, 0, b.position.y, 0);
    width = Math.max(width, b.userData.length);
  });
  mesh(box(0.065, 0.3, 0.065), M.galvDull(), root, 0, 0.15, 0); // breakaway base stub
  return finish(root, 'sign', id, { length: 0.1, width, height: top }, { kind: String(kind), faceHeight: spec.blade ? null : [bottom, bottom + spec.h] });
}

// ================================================================= UTILITY POLE
function insulatorGeo() {
  return memo(GEO, 'insulator', () => {
    const p = [[0, 0], [0.03, 0], [0.03, 0.02], [0.065, 0.04], [0.06, 0.055], [0.04, 0.06], [0.06, 0.085], [0.055, 0.1], [0.035, 0.11], [0.04, 0.13], [0.03, 0.15], [0, 0.16]];
    return new THREE.LatheGeometry(p.map(([x, y]) => new THREE.Vector2(x, y)), 14);
  });
}
export function pole(opts = {}) {
  const id = opts.id ?? 'pole';
  const H = opts.height ?? 10.5;
  const root = new THREE.Group();
  member(root, V(0, 0, 0), V(0, H, 0), 0.155, 0.11, M.wood(), 14);
  mesh(cyl(0.0, 0.112, 0.05, 14), M.wood(), root, 0, H + 0.025, 0);
  const tips = []; // wire attachment points (local)
  const armY = H - 0.55;
  if (opts.crossarm !== false) {
    const armMat = texStd('crossarm', () => null, 0x6b5a46, { roughness: 0.9 });
    mesh(box(2.44, 0.11, 0.09), M.wood(), root, 0, armY, -0.16);
    for (const s of [-1, 1]) member(root, V(s * 0.75, armY - 0.05, -0.16), V(0, armY - 0.7, -0.14), 0.012, 0.012, M.galvDull(), 4);
    const xs = (opts.insulators ?? 3) >= 4 ? [-1.1, -0.4, 0.4, 1.1] : [-1.1, 0.35, 1.1];
    for (const x of xs) { mesh(insulatorGeo(), M.porcelain(), root, x, armY + 0.055, -0.16); tips.push(V(x, armY + 0.2, -0.16)); }
    void armMat;
  }
  mesh(insulatorGeo(), M.porcelain(), root, 0, H + 0.04, 0); tips.push(V(0, H + 0.19, 0));
  // secondary/neutral rack + communications cable
  mesh(box(0.06, 0.4, 0.06), M.galvDull(), root, 0, H - 2.1, -0.15); tips.push(V(0, H - 2.0, -0.2));
  mesh(box(0.04, 0.12, 0.08), M.galvDull(), root, 0, H - 4.3, -0.15); const comm = V(0, H - 4.3, -0.22);
  if (opts.transformer) {
    const tm = std('xfmr', { color: 0x7d8584, metalness: 0.55, roughness: 0.45 });
    mesh(cyl(0.26, 0.26, 0.8, 20), tm, root, 0, H - 1.7, 0.42);
    mesh(cyl(0.27, 0.27, 0.04, 20), tm, root, 0, H - 1.28, 0.42);
    mesh(insulatorGeo(), M.porcelain(), root, 0.1, H - 1.26, 0.42);
  }
  member(root, V(0, 0.1, 0.152), V(0, H, 0.11), 0.005, 0.005, std('cu', { color: 0x6a4a2c, metalness: 0.8, roughness: 0.5 }), 4);
  mesh(box(0.06, 0.09, 0.005), M.alum(), root, 0, 1.8, -0.155); // pole tag
  let to = opts.wireTo ?? opts.wiresTo ?? null;
  if (!to && opts.span) to = [0, -opts.span];
  if (to) {
    const off = V(to[0], 0, to[1]); const span = off.length(); const sag = span * 0.022;
    for (const t of tips) wire(root, t, t.clone().add(off), sag, 0.008, M.conductor());
    wire(root, comm, comm.clone().add(off), sag * 1.6, 0.016, M.cableBlack());
  }
  return finish(root, 'pole', id, { length: 0.5, width: opts.crossarm === false ? 0.35 : 2.44, height: H }, { attach: tips.map(v => v.toArray()) });
}

// ================================================================= STREETLIGHT (cobra head)
export function streetlight(opts = {}) {
  const id = opts.id ?? 'streetlight';
  const H = opts.height ?? 9, A = opts.armLength ?? 2.4;
  const root = new THREE.Group();
  mesh(cyl(0.28, 0.32, 0.25, 16), M.concrete(), root, 0, 0.125, 0);
  mesh(box(0.34, 0.04, 0.34), M.galv(), root, 0, 0.27, 0);
  const pTop = H - 0.25;
  member(root, V(0, 0.27, 0), V(0, pTop, 0), 0.105, 0.065, M.galv(), 16);
  const curve = new THREE.CubicBezierCurve3(V(0, pTop - 0.4, 0), V(0, H + 0.25, 0), V(A * 0.35, H + 0.32, 0), V(A, H + 0.22, 0));
  mesh(new THREE.TubeGeometry(curve, 20, 0.04, 8), M.galv(), root);
  mesh(sph(0.066, 10, 6), M.galv(), root, 0, pTop - 0.4, 0);
  // luminaire
  const lum = new THREE.Group(); lum.position.set(A + 0.32, H + 0.16, 0); lum.rotation.z = 0.06; root.add(lum);
  const body = memo(GEO, 'cobraBody', () => { const s = new THREE.SphereGeometry(0.5, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2); s.scale(0.78, 0.26, 0.42); return s; });
  const bodyMat = std('cobra', { color: 0xb9bec1, metalness: 0.55, roughness: 0.38 });
  mesh(body, bodyMat, lum, 0, 0, 0);
  mesh(memo(GEO, 'cobraRim', () => { const c = new THREE.CylinderGeometry(0.5, 0.5, 0.03, 24); c.scale(0.78, 1, 0.42); return c; }), bodyMat, lum, 0, -0.015, 0);
  const lamp = opts.lamp === 'hps' ? 0xffb35a : 0xfff1dc;
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x3a3a38, emissive: lamp, emissiveIntensity: 0, roughness: 0.25 });
  const lens = mesh(memo(GEO, 'cobraLens', () => { const c = new THREE.CircleGeometry(0.5, 24); c.scale(0.62, 0.32, 1); c.rotateX(Math.PI / 2); return c; }), lensMat, lum, 0.03, -0.032, 0, false);
  lens.name = 'lamp';
  let spot = null;
  if (opts.light !== false) {
    spot = new THREE.SpotLight(lamp, opts.intensity ?? 900, 38, 1.05, 0.65, 2);
    spot.position.set(A + 0.35, H + 0.1, 0); spot.target.position.set(A + 2.5, 0, 0);
    spot.castShadow = !!opts.castShadow; spot.name = 'spot';
    root.add(spot, spot.target);
  }
  const setOn = on => { lensMat.emissiveIntensity = on ? 6 : 0; lensMat.color.setHex(on ? 0xfaf6ee : 0x3a3a38); if (spot) spot.visible = !!on; root.userData.on = !!on; };
  setOn(!!opts.on);
  return finish(root, 'streetlight', id, { length: 0.5, width: A + 0.75, height: H + 0.4 }, { setOn, lampPosition: [A + 0.35, H + 0.1, 0] });
}

// ================================================================= BUS SHELTER
export function shelter(opts = {}) {
  const id = opts.id ?? 'shelter';
  const W = opts.w ?? 3.5, D = opts.d ?? 1.5, H = opts.h ?? 2.5;
  const root = new THREE.Group();
  const fr = std('shelterFrameV3', { color: 0x24272b, metalness: 0.7, roughness: 0.32 });   // dark anodised aluminium
  const post = 0.08, x0 = -W / 2 + post / 2, x1 = W / 2 - post / 2, zb = D / 2 - post / 2, zf = -D / 2 + post / 2;
  mesh(box(W + 0.4, 0.12, D + 0.5), M.concrete(), root, 0, 0.06, 0); // pad
  const posts = [[x0, zb], [x1, zb], [0, zb], [x0, zf], [x1, zf]];
  for (const [x, z] of posts) { mesh(box(post, H - 0.12, post), fr, root, x, 0.12 + (H - 0.12) / 2 - 0.08, z); mesh(box(0.2, 0.012, 0.2), fr, root, x, 0.126, z); }
  // roof: aluminium deck with slight back-fall, fascia band all round, light soffit, rear gutter
  const roof = mesh(box(W + 0.3, 0.05, D + 0.45), std('shelterRoofV3', { color: 0x55595d, metalness: 0.55, roughness: 0.4 }), root, 0, H - 0.02, -0.1);
  roof.rotation.x = -0.05;
  mesh(box(W + 0.26, 0.012, D + 0.4), std('shelterSoffit', { color: 0xb9bcbd, metalness: 0.3, roughness: 0.55 }), root, 0, H - 0.075, -0.1, false).rotation.x = -0.05;
  mesh(box(W + 0.32, 0.18, 0.04), fr, root, 0, H - 0.04, -D / 2 - 0.34);
  for (const s of [-1, 1]) mesh(box(0.04, 0.16, D + 0.45), fr, root, s * (W / 2 + 0.15), H - 0.05, -0.1);
  mesh(box(W + 0.32, 0.1, 0.1), fr, root, 0, H - 0.1, D / 2 + 0.12);
  // glass: back (2 bays) + -X end, front open unless open:false. CLEAR tempered glass (black diffuse + additive Fresnel
  // reflection, 7% dimming) in black glazing channels, plus a dotted frit visibility band at 1.3-1.45 m.
  const gl = clearGlassMat('shelter', { opacity: 0.07, env: 1.1 });
  const frit = ctex('fritDots', 128, 32, (g, W2, H2) => { g.clearRect(0, 0, W2, H2); g.fillStyle = '#d9dcdc'; for (let x = 4; x < W2; x += 8) for (let y = 4; y < H2; y += 8) { g.beginPath(); g.arc(x, y, 1.8, 0, 7); g.fill(); } }, { repeat: true });
  const fritMat = frit ? memo(MAT, 'fritMat', () => new THREE.MeshStandardMaterial({ map: frit, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5 })) : null;
  const gh = H - 0.5, gy = 0.25 + gh / 2;
  const glassPanel = (w, h, x, y, z, ry = 0) => {
    const m = mesh(box(w, h, 0.01), gl, root, x, y, z, false); m.rotation.y = ry; m.userData.seeThrough = true; m.userData.glass = true; m.renderOrder = 2;
    const gp = new THREE.Group(); gp.position.set(x, y, z); gp.rotation.y = ry; root.add(gp);
    for (const s of [-1, 1]) { mesh(box(w, 0.035, 0.03), M.black(), gp, 0, s * h / 2, 0); mesh(box(0.03, h, 0.03), M.black(), gp, s * w / 2, 0, 0); }
    if (fritMat) { const fg = new THREE.BoxGeometry(w - 0.06, 0.15, 0.012); const uv = fg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w - 0.06) / 1.0, uv.getY(i) * 0.15 / 0.25); const f = mesh(fg, fritMat, gp, 0, 1.38 - y, 0, false); f.userData.seeThrough = true; }
    return m;
  };
  glassPanel(W / 2 - post, gh, -W / 4, gy, zb);
  glassPanel(W / 2 - post, gh, W / 4, gy, zb);
  glassPanel(D - post, gh, x0, gy, 0, Math.PI / 2);
  if (opts.open === false) { glassPanel(W * 0.3, gh, x0 + W * 0.15, gy, zf); glassPanel(W * 0.3, gh, x1 - W * 0.15, gy, zf); }
  for (const y of [0.25, 0.25 + gh]) { mesh(box(W - post, 0.05, 0.06), fr, root, 0, y, zb); mesh(box(0.06, 0.05, D - post), fr, root, x0, y, 0); }
  // ad panel (blank, back-lit) replaces the +X end glass
  const adMat = std('adBlank', { color: 0xf0f0ec, emissive: 0xfafaf4, emissiveIntensity: opts.adLit ? 0.8 : 0.08, roughness: 0.3 });
  mesh(box(0.16, gh + 0.1, D - 0.18), fr, root, x1, gy, 0);
  for (const s of [-1, 1]) mesh(box(0.004, gh - 0.1, D - 0.34), adMat, root, x1 + s * 0.082, gy, 0, false);
  // bench: perforated steel seat on three legs
  const seatMat = texStd('benchPerf', () => ctex('benchPerf', 128, 64, (g, W2, H2) => { g.fillStyle = '#5a5e61'; g.fillRect(0, 0, W2, H2); g.fillStyle = '#26282a'; for (let x = 4; x < W2; x += 8) for (let y = 4; y < H2; y += 8) { g.beginPath(); g.arc(x, y, 2, 0, 7); g.fill(); } }, { repeat: true }), 0x5a5e61, { metalness: 0.7, roughness: 0.4 });
  const bw = Math.min(2.0, W - 1.0);
  mesh(box(bw, 0.03, 0.4), seatMat, root, -0.25, 0.45, zb - 0.3);
  mesh(box(bw, 0.3, 0.02), seatMat, root, -0.25, 0.72, zb - 0.1).rotation.x = -0.12;
  for (const x of [-0.25 - bw / 2 + 0.1, -0.25, -0.25 + bw / 2 - 0.1]) { mesh(box(0.05, 0.43, 0.05), fr, root, x, 0.335, zb - 0.32); mesh(box(0.05, 0.05, 0.4), fr, root, x, 0.43, zb - 0.3); }
  // bus-stop sign flag on the front-left post
  return finish(root, 'shelter', id, { length: W, width: D, height: H }, { footprint: { x: W, z: D }, open: opts.open !== false, note: 'glass meshes carry userData.seeThrough=true' });
}

// ================================================================= BUILDINGS
function facadeMat(key, wM, hM, fb, draw, p = {}) {
  return memo(MAT, 'facade:' + key, () => {
    const ppm = Math.min(48, 1400 / Math.max(wM, hM));
    const t = ctex('facade:' + key, wM * ppm, hM * ppm, (g, W, H) => draw(painter(g, W, H, { x0: 0, y0: 0, x1: wM, y1: hM, w: wM, h: hM })));
    // roughness + bump maps derived from the painted facade: glazing (dark, blue-grey) is glossy and recessed,
    // mullions/trim stand proud, wall stays matte -> windows catch the sky/environment like real glass.
    let rough = null, bump = null;
    if (t && t.image) {
      const W = t.image.width, H = t.image.height, src = t.image.getContext('2d').getImageData(0, 0, W, H).data;
      const rc = document.createElement('canvas'); rc.width = W; rc.height = H; const rg = rc.getContext('2d'); const ri = rg.createImageData(W, H);
      const bc = document.createElement('canvas'); bc.width = W; bc.height = H; const bg = bc.getContext('2d'); const bi = bg.createImageData(W, H);
      for (let i = 0; i < src.length; i += 4) {
        const r = src[i], g = src[i + 1], b = src[i + 2], L = 0.3 * r + 0.59 * g + 0.11 * b;
        const glass = L < 125 && b >= r + 4;
        const v = glass ? 22 : 200 + (L % 17); ri.data[i] = ri.data[i + 1] = ri.data[i + 2] = v; ri.data[i + 3] = 255;
        const h = glass ? 40 : Math.min(255, 120 + L * 0.35); bi.data[i] = bi.data[i + 1] = bi.data[i + 2] = h; bi.data[i + 3] = 255;
      }
      rg.putImageData(ri, 0, 0); bg.putImageData(bi, 0, 0);
      rough = new THREE.CanvasTexture(rc); bump = new THREE.CanvasTexture(bc);
      for (const x of [rough, bump]) { x.anisotropy = 8; x.wrapS = t.wrapS; x.wrapT = t.wrapT; x.needsUpdate = true; }
    }
    return new THREE.MeshStandardMaterial({ color: t ? 0xffffff : fb, map: t, roughness: rough ? 1 : 0.85, roughnessMap: rough, bumpMap: bump, bumpScale: bump ? 1.5 : 1, side: THREE.FrontSide, shadowSide: THREE.DoubleSide, ...p });
  });
}
const PAINT = {
  siding(P, w, h, col, seed) { P.rect(0, 0, w, h, col); for (let y = 0; y < h; y += 0.2) { P.rect(0, y + 0.17, w, 0.03, 'rgba(0,0,0,0.13)'); P.rect(0, y + 0.165, w, 0.006, 'rgba(255,255,255,0.18)'); } noise(P.g, P.W, P.H, 8, seed); },
  stucco(P, w, h, col, seed) { P.rect(0, 0, w, h, col); noise(P.g, P.W, P.H, 12, seed); P.rect(0, 0, w, 0.25, 'rgba(0,0,0,0.12)'); },
  brick(P, w, h, seed) { P.rect(0, 0, w, h, '#8e8172'); const R = rng(seed); for (let y = 0, r = 0; y < h; y += 0.075, r++) for (let x = (r % 2) * -0.1; x < w; x += 0.2) { const c = 110 + R() * 40; P.rect(x + 0.006, y + 0.008, 0.188, 0.062, `rgb(${c + 30},${c * 0.55},${c * 0.42})`); } noise(P.g, P.W, P.H, 10, seed); },
  boards(P, w, h, col, seed) { P.rect(0, 0, w, h, col); for (let x = 0; x < w; x += 0.3) { P.rect(x, 0, 0.05, h, 'rgba(0,0,0,0.18)'); P.rect(x + 0.05, 0, 0.012, h, 'rgba(255,255,255,0.1)'); } noise(P.g, P.W, P.H, 14, seed); },
  window(P, x, y, w, h, opt = {}) {
    const tr = opt.trim ?? '#f2f0ea';
    P.rect(x - 0.08, y - 0.1, w + 0.16, h + 0.18, tr);
    const g = P.g, gr = g.createLinearGradient(0, P.y(y + h), 0, P.y(y)); gr.addColorStop(0, '#5d6f7c'); gr.addColorStop(0.45, '#2b3740'); gr.addColorStop(1, '#1b2228');
    g.fillStyle = gr; g.fillRect(P.x(x), P.y(y + h), P.s(w), P.s(h));
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.moveTo(P.x(x + w * 0.15), P.y(y + h)); g.lineTo(P.x(x + w * 0.45), P.y(y + h)); g.lineTo(P.x(x + w * 0.1), P.y(y)); g.lineTo(P.x(x), P.y(y)); g.lineTo(P.x(x), P.y(y + h * 0.75)); g.fill();
    if (opt.muntin !== false) { P.rect(x + w / 2 - 0.02, y, 0.04, h, tr); P.rect(x, y + h / 2 - 0.02, w, 0.04, tr); }
    P.rect(x - 0.1, y - 0.12, w + 0.2, 0.05, 'rgba(0,0,0,0.25)');
    if (opt.shutters) { P.rect(x - 0.48, y - 0.02, 0.36, h + 0.04, opt.shutters); P.rect(x + w + 0.12, y - 0.02, 0.36, h + 0.04, opt.shutters); }
  },
  door(P, x, w, h, col = '#5b3a29') { P.rect(x - 0.08, 0, w + 0.16, h + 0.08, '#f2f0ea'); P.rect(x, 0, w, h, col); for (const [dx, dy] of [[0.12, 0.25], [0.12, 1.15], [w / 2 + 0.04, 0.25], [w / 2 + 0.04, 1.15]]) P.rect(x + dx, dy, w / 2 - 0.16, 0.75, 'rgba(0,0,0,0.12)'); P.circle(x + w - 0.1, 1.0, 0.035, '#c9b37a'); },
  garage(P, x, w, h) { P.rect(x - 0.1, 0, w + 0.2, h + 0.1, '#f2f0ea'); P.rect(x, 0, w, h, '#e6e3db'); for (let y = 0; y < h; y += h / 4) P.rect(x, y, w, 0.025, 'rgba(0,0,0,0.2)'); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) P.rect(x + 0.15 + i * (w - 0.3) / 4, 0.12 + j * h / 4, (w - 0.3) / 4 - 0.12, h / 4 - 0.25, 'rgba(0,0,0,0.05)'); },
  storefront(P, w, glassTop = 3.0) {
    const g = P.g, gr = g.createLinearGradient(0, P.y(glassTop), 0, P.y(0.3)); gr.addColorStop(0, '#6c7e8a'); gr.addColorStop(0.5, '#27323a'); gr.addColorStop(1, '#3c4a52');
    g.fillStyle = gr; g.fillRect(P.x(0.3), P.y(glassTop), P.s(w - 0.6), P.s(glassTop - 0.3));
    P.rect(0.3, 0, w - 0.6, 0.3, '#7d7f80');
    const bays = Math.max(2, Math.round((w - 0.6) / 1.6)), bw = (w - 0.6) / bays;
    for (let i = 0; i <= bays; i++) P.rect(0.3 + i * bw - 0.035, 0.3, 0.07, glassTop - 0.3, '#b7bbbe');
    P.rect(0.3, glassTop - 0.07, w - 0.6, 0.07, '#b7bbbe'); P.rect(0.3, 0.27, w - 0.6, 0.06, '#b7bbbe'); P.rect(0.3, 2.25, w - 0.6, 0.05, '#b7bbbe');
    const dx = w / 2 - 0.9; P.rect(dx, 0, 1.8, 2.25, '#2a343b'); P.rect(dx - 0.05, 0, 0.07, 2.3, '#b7bbbe'); P.rect(dx + 0.88, 0, 0.05, 2.25, '#b7bbbe'); P.rect(dx + 1.78, 0, 0.07, 2.3, '#b7bbbe');
    P.rect(dx + 0.6, 1.0, 0.2, 0.03, '#d0d3d5'); P.rect(dx + 1.0, 1.0, 0.2, 0.03, '#d0d3d5');
  },
};
function wallFace(parent, pts, mat, x, z, ry) {
  const m = mesh(shapeGeo(pts, 'wall:' + pts.map(p => p.map(f3).join(',')).join(';')), mat, parent, x, 0, z); m.rotation.y = ry; return m;
}
function slab(parent, p1, p2, len, t, mat, axis = 'z', tile = 1) {
  // a thin roof slab whose cross-section runs p1->p2 ([u,y]) and extrudes along axis
  const du = p2[0] - p1[0], dy = p2[1] - p1[1], w = Math.hypot(du, dy);
  const geo = new THREE.BoxGeometry(w, t, len); const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * len / tile);
  const m = mesh(geo, mat, parent);
  const cu = (p1[0] + p2[0]) / 2, cy = (p1[1] + p2[1]) / 2 + t / 2;
  if (axis === 'z') { m.position.set(cu, cy, 0); m.rotation.z = Math.atan2(dy, du); }
  else { m.rotation.order = 'YZX'; m.rotation.y = -Math.PI / 2; m.rotation.z = Math.atan2(dy, du); m.position.set(0, cy, cu); }
  return m;
}
const shingleMat = col => texStd('shingle:' + col, () => ctex('shingle:' + col, 256, 256, (g, W, H) => {
  g.fillStyle = col; g.fillRect(0, 0, W, H); const R = rng(hash(col));
  for (let r = 0; r < 16; r++) for (let c = 0; c < 9; c++) { const v = (R() - 0.5) * 40; g.fillStyle = `rgba(${v > 0 ? '255,255,255' : '0,0,0'},${Math.abs(v) / 260})`; g.fillRect(((c + (r % 2) * 0.5) * W / 8) % W, r * H / 16, W / 8 - 1, H / 16); g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, r * H / 16 + H / 16 - 2, W, 2); }
  noise(g, W, H, 22, 2);
}, { repeat: true }), 0x4a4a4c, { roughness: 0.95 });
const metalRoofMat = col => texStd('metalroof:' + col, () => ctex('metalroof:' + col, 128, 128, (g, W, H) => { g.fillStyle = col; g.fillRect(0, 0, W, H); for (let x = 0; x < W; x += 32) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x, 0, 3, H); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 3, 0, 3, H); } noise(g, W, H, 8, 6); }, { repeat: true }), 0x9aa0a2, { metalness: 0.6, roughness: 0.42 });

function buildHouse(root, w, d, h, o) {
  const col = o.color || '#d9d2c3', pitch = 0.42, oh = 0.45, rise = d / 2 * pitch, seed = hash(o.id || 'h');
  const twoStory = h > 4.2;
  const front = facadeMat(`house:f:${w}:${d}:${h}:${col}`, w, h, 0xd9d2c3, P => {
    PAINT.siding(P, w, h, col, seed); const garage = w >= 11;
    const gW = 4.9, usable0 = garage ? gW + 0.8 : 0;
    if (garage) PAINT.garage(P, 0.5, gW, 2.15);
    const dx = usable0 + (w - usable0) * 0.45; PAINT.door(P, dx, 0.95, 2.05);
    for (let x = usable0 + 0.9; x < w - 1.2; x += 2.6) if (Math.abs(x + 0.45 - (dx + 0.47)) > 1.2) PAINT.window(P, x, 0.95, 0.9, 1.3, { shutters: '#3e4a52' });
    if (twoStory) for (let x = 1.0; x < w - 1.2; x += 2.6) PAINT.window(P, x, h - 1.9, 0.9, 1.2, { shutters: '#3e4a52' });
  });
  const back = facadeMat(`house:b:${w}:${h}:${col}`, w, h, 0xd9d2c3, P => { PAINT.siding(P, w, h, col, seed + 1); for (let x = 1.0; x < w - 1; x += 3.0) PAINT.window(P, x, 0.95, 0.9, 1.3); });
  const gableH = h + rise;
  const side = facadeMat(`house:s:${d}:${h}:${col}`, d, gableH, 0xd9d2c3, P => { PAINT.siding(P, d, gableH, col, seed + 2); for (let x = 1.0; x < d - 1; x += 3.2) PAINT.window(P, x, 0.95, 0.9, 1.3); PAINT.window(P, d / 2 - 0.3, h + 0.15, 0.6, 0.5, { muntin: false }); });
  const rect = [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]];
  wallFace(root, rect, front, 0, -d / 2, Math.PI);
  wallFace(root, rect, back, 0, d / 2, 0);
  const gable = [[-d / 2, 0], [d / 2, 0], [d / 2, h], [0, gableH], [-d / 2, h]];
  wallFace(root, gable, side, w / 2, 0, Math.PI / 2);
  wallFace(root, gable, side, -w / 2, 0, -Math.PI / 2);
  const rm = shingleMat(o.roofColor || '#3d3f42');
  const r = d / 2 + oh;
  slab(root, [-r, h - oh * pitch], [0, gableH + 0.04], w + 2 * oh, 0.07, rm, 'x', 2);
  slab(root, [0, gableH + 0.04], [r, h - oh * pitch], w + 2 * oh, 0.07, rm, 'x', 2);
  const trim = std('trimWhite', { color: 0xf0eee8, roughness: 0.6 });
  mesh(box(w + 2 * oh, 0.18, 0.04), trim, root, 0, h - oh * pitch - 0.02, -r);
  mesh(box(w + 2 * oh, 0.18, 0.04), trim, root, 0, h - oh * pitch - 0.02, r);
  mesh(box(0.12, 0.08, d + 2 * oh), trim, root, 0, gableH + 0.1, 0);
  mesh(box(w + 0.1, 0.3, d + 0.1), M.concrete(), root, 0, 0.15, 0);
  mesh(box(w - 0.02, 0.05, d - 0.02), std('ceil', { color: 0xc8c4b8 }), root, 0, h - 0.03, 0); // closes the box for shadows/rays
  // porch stoop + driveway hint
  mesh(box(1.8, 0.18, 1.2), M.concrete(), root, -w / 2 + (w >= 11 ? 5.7 : 0) + (w - (w >= 11 ? 5.7 : 0)) * 0.45 + 0.47, 0.09, -d / 2 - 0.6);
  if (o.chimney !== false) mesh(box(0.7, 1.4, 0.7), facadeMat('brickChimney', 0.7, 1.4, 0x8a4a3a, P => PAINT.brick(P, 0.7, 1.4, 3)), root, w / 2 - 1.2, gableH - 0.1, d / 4);
}
function buildCommercial(root, w, d, h, o) {
  const col = o.color || '#d8cfbd', seed = hash(o.id || 'c'), brick = o.material === 'brick';
  const front = facadeMat(`com:f:${w}:${h}:${col}:${brick}`, w, h, 0xd8cfbd, P => {
    brick ? PAINT.brick(P, w, h, seed) : PAINT.stucco(P, w, h, col, seed);
    PAINT.storefront(P, w, 3.0);
    P.rect(0.6, 3.35, w - 1.2, Math.min(0.9, h - 3.9), '#efece4'); P.rect(0.6, 3.35, w - 1.2, 0.05, '#9a9a96'); P.rect(0.6, 3.3 + Math.min(0.9, h - 3.9), w - 1.2, 0.05, '#9a9a96');
  });
  const sideMat = (L, k) => facadeMat(`com:${k}:${L}:${h}:${col}:${brick}`, L, h, 0xd8cfbd, P => { brick ? PAINT.brick(P, L, h, seed + 3) : PAINT.stucco(P, L, h, col, seed + 3); if (k === 'b') { P.rect(L * 0.7, 0, 1.0, 2.15, '#6d7276'); P.rect(L * 0.7 + 0.85, 1.0, 0.08, 0.03, '#ccc'); } });
  wallFace(root, [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]], front, 0, -d / 2, Math.PI);
  wallFace(root, [[-w / 2, 0], [w / 2, 0], [w / 2, h], [-w / 2, h]], sideMat(w, 'b'), 0, d / 2, 0);
  wallFace(root, [[-d / 2, 0], [d / 2, 0], [d / 2, h], [-d / 2, h]], sideMat(d, 's'), w / 2, 0, Math.PI / 2);
  wallFace(root, [[-d / 2, 0], [d / 2, 0], [d / 2, h], [-d / 2, h]], sideMat(d, 's'), -w / 2, 0, -Math.PI / 2);
  const cap = std('coping', { color: 0xbdb9b0, roughness: 0.7 });
  mesh(box(w + 0.12, 0.1, 0.32), cap, root, 0, h + 0.05, -d / 2 + 0.1); mesh(box(w + 0.12, 0.1, 0.32), cap, root, 0, h + 0.05, d / 2 - 0.1);
  mesh(box(0.32, 0.1, d), cap, root, -w / 2 + 0.1, h + 0.05, 0); mesh(box(0.32, 0.1, d), cap, root, w / 2 - 0.1, h + 0.05, 0);
  mesh(box(w - 0.3, 0.05, d - 0.3), std('membrane', { color: 0x8d8f8f, roughness: 0.9 }), root, 0, h - 0.55, 0);
  const hv = std('hvac', { color: 0xb8bcbc, metalness: 0.5, roughness: 0.5 });
  for (let i = 0; i < Math.max(1, Math.floor(w / 9)); i++) { mesh(box(1.4, 0.9, 1.1), hv, root, -w / 2 + 2.5 + i * 6, h - 0.1, d * 0.1); }
  if (o.awning !== false) storefront3D(root, w, d, o);
  mesh(box(w + 0.6, 0.12, 2.0), M.concrete(), root, 0, 0.06, -d / 2 - 1.0);
}
// Real storefront on the -Z face: recessed dark float-glass curtain (reflects the sky through the env map) in an anodised
// aluminium grid (1.5 m bays, transom at 2.25 m), centred double door with push bars, and a cantilevered metal canopy
// (fascia band + light soffit, tie rods to the wall above 3.4 m) - no columns, so eye-level sightlines past the corner
// are unchanged from the plain wall.
function storefront3D(root, w, d, o) {
  const zf = -d / 2, gx0 = -w / 2 + 0.6, gx1 = w / 2 - 0.6, gw = gx1 - gx0, y0 = 0.32, y1 = 3.0;
  const glass = std('storeGlass', { color: 0x17222a, metalness: 0.15, roughness: 0.05, envMapIntensity: 1.6 });
  const alu = std('storeAlu', { color: 0x9da2a6, metalness: 0.6, roughness: 0.38 });
  const dark = std('storeAluDark', { color: 0x2d3135, metalness: 0.4, roughness: 0.45 });
  mesh(box(gw, y1 - y0, 0.02), glass, root, 0, (y0 + y1) / 2, zf - 0.03, false).userData.glass = true;
  mesh(box(gw + 0.2, y0, 0.16), dark, root, 0, y0 / 2, zf - 0.06);                       // kick plate / sill
  const bays = Math.max(2, Math.round(gw / 1.5)), bw = gw / bays, mul = 0.06, dep = 0.12;
  for (let i = 0; i <= bays; i++) mesh(box(mul, y1 - y0, dep), alu, root, gx0 + i * bw, (y0 + y1) / 2, zf - 0.07);
  for (const y of [y0 + 0.03, 2.25, y1]) mesh(box(gw + mul, 0.07, dep), alu, root, 0, y, zf - 0.07);
  // centred double door (darker frame, push bars)
  const dw = Math.min(1.9, bw * 1.3);
  for (const s of [-1, 1]) {
    mesh(box(0.08, 2.2, dep + 0.02), dark, root, s * dw / 2, y0 + 1.1 - 0.16, zf - 0.08);
    mesh(box(dw / 2 - 0.12, 0.04, 0.05), alu, root, s * dw / 4, 1.05, zf - 0.15);
  }
  mesh(box(dw, 0.1, dep + 0.02), dark, root, 0, 2.2, zf - 0.08);
  // canopy: 2.1 m deep, fascia 0.55 m, soffit 3.35 m above grade
  const cd = 2.1, cy = 3.35, fh = 0.55, cw = w - 0.4;
  const fascia = std('canopyFascia', { color: o.canopyColor ?? 0x34434d, metalness: 0.35, roughness: 0.45 });
  const soffit = std('canopySoffit', { color: 0xdcd9d2, roughness: 0.8 });
  mesh(box(cw, 0.08, cd), soffit, root, 0, cy + 0.04, zf - cd / 2);
  mesh(box(cw, 0.12, cd), fascia, root, 0, cy + fh - 0.06, zf - cd / 2);
  mesh(box(cw, fh, 0.06), fascia, root, 0, cy + fh / 2, zf - cd);
  for (const s of [-1, 1]) mesh(box(0.06, fh, cd), fascia, root, s * cw / 2, cy + fh / 2, zf - cd / 2);
  const lamp = std('soffitLamp', { color: 0xf4f2ea, emissive: 0xfff6e0, emissiveIntensity: o.lit ? 1.0 : 0.05, roughness: 0.4 });
  for (let x = -cw / 2 + 1.5; x < cw / 2 - 1; x += 3) mesh(cyl(0.12, 0.12, 0.02, 12), lamp, root, x, cy - 0.005, zf - cd * 0.55, false);
  const rod = std('tieRod', { color: 0x3a3e42, metalness: 0.6, roughness: 0.4 });
  const rise = Math.max(0.3, Math.min(1.4, o.h0 ?? 0.5)), rl = Math.hypot(cd - 0.2, rise), ra = Math.atan2(cd - 0.2, rise);
  for (let x = -cw / 2 + 0.8; x <= cw / 2 - 0.7; x += Math.max(3, (cw - 1.5) / Math.max(1, Math.round((cw - 1.5) / 4.5)))) {
    const r = mesh(cyl(0.02, 0.02, rl, 6), rod, root, x, cy + fh + rise / 2, zf - (cd - 0.2) / 2); r.rotation.x = ra;   // top end at the wall, bottom at the fascia
  }
}
function buildGas(root, w, d, h, o) {
  const cd = d * 0.55, cz = -d / 2 + cd / 2, clear = 4.9, fh = 0.9;
  const fascia = facadeMat(`gasFascia:${o.stripe || '#b2222a'}`, 8, fh, 0xf2f2f0, P => { P.rect(0, 0, 8, fh, '#f4f4f2'); P.rect(0, 0.18, 8, 0.2, o.stripe || '#b2222a'); P.rect(0, 0.05, 8, 0.04, '#c6c6c4'); });
  const canopyMats = [fascia, fascia, std('canopyTop', { color: 0xdedede, roughness: 0.6 }), std('canopyUnder', { color: 0xe9e9e6, roughness: 0.7 }), fascia, fascia];
  const cg = new THREE.BoxGeometry(w, fh, cd); const uv = cg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * w / 8);
  fascia.map && (fascia.map.wrapS = THREE.RepeatWrapping);
  mesh(cg, canopyMats, root, 0, clear + fh / 2, cz);
  const lightMat = std('canopyLight', { color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2 });
  const nI = Math.max(1, Math.floor(w / 7.5));
  for (let i = 0; i < nI; i++) {
    const x = -w / 2 + (i + 0.5) * w / nI;
    for (const z of [cz - cd * 0.25, cz + cd * 0.25]) mesh(box(0.42, 0.42, 0.42), std('column', { color: 0xf2f2ef, roughness: 0.5 }), root, x, clear / 2, z).scale.y = clear / 0.42;
    mesh(box(1.2, 0.22, cd * 0.75), M.concrete(), root, x, 0.11, cz);
    for (const z of [cz - cd * 0.18, cz + cd * 0.18]) {
      mesh(box(0.55, 1.9, 1.1), std('dispenser', { color: 0xe8e8e6, metalness: 0.3, roughness: 0.4 }), root, x, 0.22 + 0.95, z);
      mesh(box(0.57, 0.3, 1.12), std('dispTop', { color: 0x8f2229, roughness: 0.5 }), root, x, 0.22 + 1.75, z);
      for (const s of [-1, 1]) mesh(box(0.01, 0.25, 0.3), std('screen', { color: 0x111, emissive: 0x335566, emissiveIntensity: 0.5 }), root, x + s * 0.28, 1.45, z);
    }
    for (const z of [cz - cd * 0.37, cz + cd * 0.37]) mesh(cyl(0.08, 0.08, 1.0, 12), std('bollard', { color: 0xf2c200, roughness: 0.5 }), root, x, 0.72, z);
    for (const z of [cz - cd * 0.22, cz + cd * 0.22]) mesh(box(w / nI * 0.5, 0.03, 0.6), lightMat, root, x, clear - 0.01, z, false);
  }
  // kiosk store at the back
  const kw = Math.min(w * 0.75, 16), kd = Math.min(d * 0.32, 12), kh = Math.max(3.8, Math.min(h, 4.8));
  const k = new THREE.Group(); k.position.z = d / 2 - kd / 2; root.add(k);
  buildCommercial(k, kw, kd, kh, { ...o, color: o.color || '#e4ded2', awning: false });
}
function buildBarn(root, w, d, h, o) {
  const col = o.color || '#7e2a22', seed = hash(o.id || 'b');
  const prof = [[-w / 2, h], [-w * 0.33, h + w * 0.3], [0, h + w * 0.42], [w * 0.33, h + w * 0.3], [w / 2, h]];
  const top = h + w * 0.42;
  const endPts = [[-w / 2, 0], [w / 2, 0], ...prof.slice().reverse()];
  const frontMat = facadeMat(`barn:f:${w}:${h}:${col}`, w, top, 0x7e2a22, P => {
    PAINT.boards(P, w, top, col, seed);
    const dw = Math.min(4.0, w * 0.4), dh = Math.min(3.8, h * 0.9), x0 = w / 2 - dw / 2;
    P.rect(x0 - 0.15, 0, dw + 0.3, dh + 0.15, '#eeeae0'); P.rect(x0, 0, dw, dh, col);
    for (const [ax, ay, bx, by] of [[x0, 0, x0 + dw / 2, dh], [x0 + dw / 2, 0, x0, dh], [x0 + dw / 2, 0, x0 + dw, dh], [x0 + dw, 0, x0 + dw / 2, dh]]) P.line(ax, ay, bx, by, 0.14, '#eeeae0');
    P.rect(x0 + dw / 2 - 0.05, 0, 0.1, dh, '#eeeae0');
    const lw = 1.4, ly = h + 0.3; P.rect(w / 2 - lw / 2 - 0.1, ly - 0.1, lw + 0.2, 1.4, '#eeeae0'); P.rect(w / 2 - lw / 2, ly, lw, 1.2, '#3a2a22');
  });
  const sideMat = facadeMat(`barn:s:${d}:${h}:${col}`, d, h, 0x7e2a22, P => { PAINT.boards(P, d, h, col, seed + 1); for (let x = 2; x < d - 1.5; x += 4.5) PAINT.window(P, x, 1.6, 0.8, 0.8, { trim: '#eeeae0' }); });
  wallFace(root, endPts, frontMat, 0, -d / 2, Math.PI);
  wallFace(root, endPts, frontMat, 0, d / 2, 0);
  wallFace(root, [[-d / 2, 0], [d / 2, 0], [d / 2, h], [-d / 2, h]], sideMat, w / 2, 0, Math.PI / 2);
  wallFace(root, [[-d / 2, 0], [d / 2, 0], [d / 2, h], [-d / 2, h]], sideMat, -w / 2, 0, -Math.PI / 2);
  const rm = metalRoofMat(o.roofColor || '#9ea4a6');
  const ext = 0.35;
  const P2 = prof.map(([x, y]) => [x, y]); P2[0] = [-w / 2 - ext * 0.6, h - ext * 0.9]; P2[4] = [w / 2 + ext * 0.6, h - ext * 0.9];
  for (let i = 0; i < 4; i++) slab(root, P2[i], P2[i + 1], d + 2 * ext, 0.06, rm, 'z', 1);
}
export function building(opts = {}) {
  const id = opts.id ?? 'building';
  let style = opts.style || opts.kind || 'commercial';
  if (style === 'store' && !opts.legacy) return store(opts);                 // full detailed convenience/feed store
  if (style === 'house' && !opts.legacy) return house({ ...opts, style: opts.houseStyle || 'ranch' }); // 3D windows/porch/shingles
  if (style === 'store' || style === 'generic') style = 'commercial';
  const D = { commercial: [18, 14, 5.2], house: [12, 9, 2.9], gas_station: [24, 30, 4.5], barn: [10, 16, 4.2] }[style] || [12, 10, 5];
  const w = opts.w ?? D[0], d = opts.d ?? D[1], h = opts.h ?? D[2];
  const root = new THREE.Group();
  ({ house: buildHouse, gas_station: buildGas, barn: buildBarn }[style] || buildCommercial)(root, w, d, h, { ...opts, id });
  const bb = new THREE.Box3().setFromObject(root);
  return finish(root, 'building', id, { length: d, width: w, height: +bb.max.y.toFixed(2) }, { style, footprint: { x: w, z: d } });
}

// ================================================================= STORE / PARKING LOT / HOUSE (buildings v3)
// Signatures take an optional leading THREE namespace (ignored - this module's THREE is used), so both
//   store(THREE, {w, d, h, name, storefront})  and  store({w, d, h, ...})  work. Same for parkingLot() and house().
const optsOf = (a, b) => (a && typeof a === 'object' && (a.Mesh || a.REVISION)) ? (b || {}) : (a || {});
// clear float glass: ~black diffuse, blended src*1 + dst*(1-a): the Fresnel/env/sun reflection is ADDED at full
// strength while the pane only dims what is behind it by `opacity`. (A normal-blended pane scales its own reflection
// by opacity and any light albedo reads as a milky slab in sunlight.)
function clearGlassMat(key, { opacity = 0.08, rough = 0.02, env = 1.0 } = {}) {
  return memo(MAT, 'clearGlass:' + key, () => {
    const m = new THREE.MeshPhysicalMaterial({ color: 0x000000, metalness: 0, roughness: rough, ior: 1.52, specularIntensity: 1, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: env });
    m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = THREE.OneFactor; m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    return m;
  });
}
// meter-space UVs for any axis-aligned geometry already placed in its parent frame
function uvWorld(geo, sU, sV = sU) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i)), x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (ny > nx && ny > nz) uv.setXY(i, x / sU, z / sV); else if (nx > nz) uv.setXY(i, z / sU, y / sV); else uv.setXY(i, x / sU, y / sV);
  }
  uv.needsUpdate = true; return geo;
}
// box from extents (parent frame), meter UVs
function wbox(parent, x0, x1, y0, y1, z0, z1, mat, sU = 4, sV = sU, shadow = true) {
  const geo = new THREE.BoxGeometry(Math.max(1e-3, x1 - x0), Math.max(1e-3, y1 - y0), Math.max(1e-3, z1 - z0));
  geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); uvWorld(geo, sU, sV);
  return mesh(geo, mat, parent, 0, 0, 0, shadow);
}
// planar shape in XY (meter UVs) - for gable ends
function shapeUV(pts, sU, sV) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1]))), 1);
  const uv = g.attributes.uv, pos = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / sU, pos.getY(i) / sV); return g;
}
const matTex = (key, texFn, fb, p = {}) => memo(MAT, key, () => { const t = texFn(); return new THREE.MeshStandardMaterial({ color: t ? 0xffffff : fb, map: t || null, ...p }); });
const shade = (g, x, y, w, h, a) => { g.fillStyle = a > 0 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${-a})`; g.fillRect(x, y, w, h); };

// ---- procedural textures (all meter-tiled unless noted)
// painted CMU block wall, 8 m wide tile x full wall height H (bottom grime + rain streaks under the coping baked in)
function cmuTex(col, H, kind = 'cmu') {
  const ppm = 80, W = 8;
  return ctex(`cmu:${kind}:${col}:${f3(H)}`, W * ppm, Math.max(64, Math.round(H * ppm)), (g, Wp, Hp) => {
    const R = rng(hash(col + kind)); g.fillStyle = col; g.fillRect(0, 0, Wp, Hp);
    if (kind === 'cmu') {
      const bh = 0.2 * ppm, bw = 0.4 * ppm;
      for (let r = 0, y = Hp; y > -bh; r++, y -= bh) {
        const off = (r % 2) * bw / 2;
        for (let x = -off; x < Wp; x += bw) shade(g, x, y - bh, bw, bh, (R() - 0.5) * 0.05);
        g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, y - 2, Wp, 2);
        for (let x = -off; x < Wp; x += bw) g.fillRect(x - 1, y - bh, 2, bh);
        g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, y - bh, Wp, 1);
      }
    }
    noise(g, Wp, Hp, kind === 'cmu' ? 9 : 14, 3);
    const gb = g.createLinearGradient(0, Hp, 0, Hp - 0.7 * ppm); gb.addColorStop(0, 'rgba(78,66,48,0.38)'); gb.addColorStop(1, 'rgba(78,66,48,0)');
    g.fillStyle = gb; g.fillRect(0, Hp - 0.7 * ppm, Wp, 0.7 * ppm);
    for (let i = 0; i < 70; i++) {
      const x = R() * Wp, L = (0.3 + R() * 1.6) * ppm, w = 2 + R() * 7, gs = g.createLinearGradient(0, 0, 0, L);
      gs.addColorStop(0, `rgba(66,62,52,${0.05 + R() * 0.1})`); gs.addColorStop(1, 'rgba(66,62,52,0)'); g.fillStyle = gs; g.fillRect(x, 0, w, L);
    }
  }, { repeat: true });
}
const roofMembraneTex = () => ctex('roofMembrane', 384, 384, (g, W, H) => { // 6 m tile, TPO sheets 3 m wide
  g.fillStyle = '#c4c7c6'; g.fillRect(0, 0, W, H); const R = rng(21);
  for (let i = 0; i < 26; i++) { const r = 10 + R() * 50; const gr = g.createRadialGradient(R() * W, R() * H, 0, R() * W, R() * H, r); gr.addColorStop(0, 'rgba(90,86,74,0.16)'); gr.addColorStop(1, 'rgba(90,86,74,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
  for (const x of [0, W / 2]) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x, 0, 3, H); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + 3, 0, 2, H); }
  noise(g, W, H, 10, 8);
}, { repeat: true });
const asphaltTex = () => ctex('lotAsphalt', 512, 512, (g, W, H) => { // 8 m tile
  g.fillStyle = '#45474a'; g.fillRect(0, 0, W, H); const R = rng(33);
  for (let i = 0; i < 9000; i++) { const v = R(); g.fillStyle = v < 0.5 ? `rgba(20,20,22,${0.3 + R() * 0.4})` : `rgba(150,148,142,${0.15 + R() * 0.3})`; g.fillRect(R() * W, R() * H, 1 + R() * 1.5, 1 + R() * 1.5); }
  for (let i = 0; i < 7; i++) { const x = R() * W, y = R() * H, r = 8 + R() * 22, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(18,18,20,0.35)'); gr.addColorStop(1, 'rgba(18,18,20,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
  g.strokeStyle = 'rgba(15,15,16,0.55)'; g.lineWidth = 1.2;
  for (let i = 0; i < 5; i++) { let x = R() * W, y = R() * H; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 14; k++) { x += (R() - 0.5) * 30; y += (R() - 0.3) * 24; g.lineTo(x, y); } g.stroke(); }
  noise(g, W, H, 16, 4);
}, { repeat: true });
const sidewalkTex = () => ctex('sidewalk', 256, 256, (g, W, H) => { // 3 m tile, 1.5 m scored joints
  g.fillStyle = '#b9b4a9'; g.fillRect(0, 0, W, H); noise(g, W, H, 18, 12); const R = rng(4);
  for (let i = 0; i < 8; i++) { const x = R() * W, y = R() * H, r = 10 + R() * 30, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(80,74,60,0.12)'); gr.addColorStop(1, 'rgba(80,74,60,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
  g.fillStyle = 'rgba(40,38,34,0.45)'; for (const t of [0, W / 2]) { g.fillRect(t, 0, 2, H); g.fillRect(0, t, W, 2); }
}, { repeat: true });
function sidingTex(col, kind) { // 4 m x 2 m tile
  return ctex(`siding:${kind}:${col}`, 512, 256, (g, W, H) => {
    g.fillStyle = col; g.fillRect(0, 0, W, H); const ppm = 128;
    if (kind === 'vertical') { for (let x = 0; x < W; x += 0.3 * ppm) { g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x, 0, 3, H); g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(x + 3, 0, 2, H); } }
    else for (let y = 0; y < H; y += 0.2 * ppm) { const gr = g.createLinearGradient(0, y, 0, y + 0.2 * ppm); gr.addColorStop(0, 'rgba(0,0,0,0.0)'); gr.addColorStop(0.82, 'rgba(0,0,0,0.05)'); gr.addColorStop(0.86, 'rgba(0,0,0,0.3)'); gr.addColorStop(0.9, 'rgba(255,255,255,0.16)'); gr.addColorStop(1, 'rgba(255,255,255,0.0)'); g.fillStyle = gr; g.fillRect(0, y, W, 0.2 * ppm); }
    noise(g, W, H, 7, hash(col) % 97);
  }, { repeat: true });
}
const sidingMat = (col, kind = 'lap') => memo(MAT, `sidingMat:${kind}:${col}`, () => { const t = sidingTex(col, kind); return new THREE.MeshStandardMaterial({ color: t ? 0xffffff : new THREE.Color(col), map: t, roughness: 0.82, shadowSide: THREE.DoubleSide }); });
const SHELF_COLS = ['#c8302c', '#e08a1e', '#2a62b8', '#2f8f4a', '#f1f1ea', '#6b3f22', '#e8cf3a', '#7a2c7c', '#1d1d1f', '#d8d0c0'];
const coolerDoorTex = () => ctex('coolerDoor', 128, 320, (g, W, H) => { // one 0.76 x 1.9 m reach-in door, lit
  const R = rng(55); const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#eef5f8'); bg.addColorStop(1, '#b8c6cc'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  for (let s = 0; s < 5; s++) {
    const y1 = 16 + (s + 1) * (H - 30) / 5;
    for (let x = 10; x < W - 12;) { const bw = 7 + R() * 5, bh = 26 + R() * 18, c = SHELF_COLS[Math.floor(R() * SHELF_COLS.length)]; const n = 1 + Math.floor(R() * 3);
      for (let k = 0; k < n && x < W - 12; k++, x += bw + 1) { g.fillStyle = c; g.fillRect(x, y1 - bh, bw, bh); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x + 1, y1 - bh, 2, bh); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x, y1 - bh, bw, 4); } }
    g.fillStyle = '#5c6366'; g.fillRect(6, y1, W - 12, 4);
  }
  g.fillStyle = '#16181a'; g.fillRect(0, 0, W, 8); g.fillRect(0, H - 10, W, 10); g.fillRect(0, 0, 7, H); g.fillRect(W - 7, 0, 7, H);
  g.fillStyle = '#9aa0a3'; g.fillRect(W - 20, H * 0.3, 6, H * 0.4);
});
const gondolaTex = () => ctex('gondola', 256, 160, (g, W, H) => { // 2.4 m x 1.5 m product shelf face
  const R = rng(77); g.fillStyle = '#56595a'; g.fillRect(0, 0, W, H);
  for (let s = 0; s < 4; s++) { const y1 = H - 6 - s * (H - 10) / 4; g.fillStyle = '#7d8183'; g.fillRect(0, y1, W, 4);
    for (let x = 2; x < W - 4;) { const bw = 8 + R() * 14, bh = 12 + R() * 18, c = SHELF_COLS[Math.floor(R() * SHELF_COLS.length)]; g.fillStyle = c; g.fillRect(x, y1 - bh, bw, bh); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + bw - 2, y1 - bh, 2, bh); x += bw + 1; } }
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, W, 6); noise(g, W, H, 10, 9);
});
function posterTex(lines, bg, fg, accent) {
  return ctex(`poster:${lines.join('|')}:${bg}`, 256, 340, (g, W, H) => {
    g.fillStyle = bg; g.fillRect(0, 0, W, H); g.fillStyle = accent; g.fillRect(0, H - 60, W, 60); g.fillRect(0, 0, W, 14);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    const n = lines.length, sz = Math.min(92, 230 / n);
    lines.forEach((t, i) => { g.font = `bold ${sz}px "Liberation Sans","DejaVu Sans",Arial,sans-serif`; const k = Math.min(1, (W - 24) / g.measureText(t).width); g.save(); g.translate(W / 2, 40 + (H - 110) * (i + 0.5) / n); g.scale(k, 1); g.fillText(t, 0, 0); g.restore(); });
    noise(g, W, H, 6, 2);
  });
}
function storeSignTex(text, sw, sh, bg, fg) {
  return ctex(`storeSign:${text}:${f3(sw)}:${f3(sh)}:${bg}:${fg}`, 1024, Math.max(32, Math.round(1024 * sh / sw)), (g, W, H) => {
    g.fillStyle = bg; g.fillRect(0, 0, W, H); const b = Math.max(4, H * 0.07); g.strokeStyle = fg; g.lineWidth = b; g.strokeRect(b * 1.2, b * 1.2, W - b * 2.4, H - b * 2.4);
    if (text) { g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${H * 0.58}px "Liberation Sans","DejaVu Sans",Arial,sans-serif`; const k = Math.min(1, (W * 0.88) / g.measureText(text).width); g.save(); g.translate(W / 2, H * 0.54); g.scale(k, 1); g.fillText(text, 0, 0); g.restore(); }
    noise(g, W, H, 5, 6);
  });
}
const iceTex = () => ctex('iceChest', 320, 268, (g, W, H) => { // 1.55 x 1.3 m merchandiser front
  g.fillStyle = '#f3f5f6'; g.fillRect(0, 0, W, H); const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(120,170,220,0.0)'); gr.addColorStop(1, 'rgba(120,170,220,0.35)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#9aa4aa'; g.lineWidth = 3; g.strokeRect(10, 12, W / 2 - 15, H - 44); g.strokeRect(W / 2 + 5, 12, W / 2 - 15, H - 44);
  g.fillStyle = '#1f5fae'; g.font = 'bold 120px "Liberation Sans","DejaVu Sans",Arial,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ICE', W / 2, H * 0.42);
  g.fillStyle = '#3a3f44'; g.fillRect(0, H - 26, W, 26); g.fillStyle = '#b0b6ba'; g.fillRect(W / 2 - 30, 40, 8, 40); g.fillRect(W / 2 + 22, 40, 8, 40);
});
const louverTex = () => ctex('louver', 128, 128, (g, W, H) => { g.fillStyle = '#b5b9b9'; g.fillRect(0, 0, W, H); for (let y = 6; y < H; y += 8) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(4, y, W - 8, 3); g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(4, y + 3, W - 8, 1); } noise(g, W, H, 8, 5); }, { repeat: true });
const ceilingTex = () => ctex('acTile', 128, 128, (g, W, H) => { g.fillStyle = '#9c9c98'; g.fillRect(0, 0, W, H); noise(g, W, H, 8, 3); g.fillStyle = '#6f706e'; g.fillRect(0, 0, W, 2); g.fillRect(0, H / 2, W, 2); g.fillRect(0, 0, 2, H); }, { repeat: true }); // 1.2 m tile
const floorTex = () => ctex('vct', 128, 128, (g, W, H) => { for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#8d8a82' : '#9b978e'; g.fillRect(i * 32, j * 32, 32, 32); } noise(g, W, H, 10, 2); }, { repeat: true }); // 1.2 m tile
const latticeTex = () => ctex('skirt', 128, 64, (g, W, H) => { g.fillStyle = '#d8d4c8'; g.fillRect(0, 0, W, H); g.fillStyle = 'rgba(0,0,0,0.18)'; for (let x = 0; x < W; x += 16) g.fillRect(x, 0, 2, H); noise(g, W, H, 10, 7); }, { repeat: true });
const blindsTex = () => ctex('blinds', 64, 96, (g, W, H) => { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#46525a'); gr.addColorStop(1, '#141a1e'); g.fillStyle = gr; g.fillRect(0, 0, W, H); const d = 26 + (H * 0.3); g.fillStyle = '#c9c4b6'; g.fillRect(0, 0, W, d); for (let y = 2; y < d; y += 4) { g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, y, W, 1); } });

// ---- small parts
function bollard(parent, x, z, mat) { mesh(cyl(0.085, 0.085, 1.05, 14), mat, parent, x, 0.525, z); mesh(memo(GEO, 'bollardCap', () => new THREE.SphereGeometry(0.085, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2)), mat, parent, x, 1.05, z); }
function hvac(parent, x, y, z, s = 1) {
  const lv = matTex('hvacLouver', louverTex, 0xb5b9b9, { metalness: 0.4, roughness: 0.55 });
  const body = std('hvacBody', { color: 0xbfc3c3, metalness: 0.45, roughness: 0.5 });
  wbox(parent, x - 0.95 * s, x + 0.95 * s, y, y + 0.12, z - 0.65 * s, z + 0.65 * s, std('hvacCurb', { color: 0x8c8f8f, roughness: 0.8 }));
  const b = mesh(box(1.8 * s, 1.0 * s, 1.2 * s), [lv, lv, body, body, lv, lv], parent, x, y + 0.12 + 0.5 * s, z);
  mesh(cyl(0.34 * s, 0.34 * s, 0.06, 20), M.black(), parent, x + 0.4 * s, y + 0.12 + 1.0 * s + 0.03, z);
  mesh(cyl(0.36 * s, 0.36 * s, 0.03, 20, true), body, parent, x + 0.4 * s, y + 0.12 + 1.0 * s + 0.07, z);
  return b;
}
function windowUnit(parent, cx, cy, ww, wh, face, wallPos, opt = {}) {
  // face: '-z' | '+z' | '-x' | '+x'  (outward normal); wallPos = wall outer-plane coordinate on that axis
  const g = new THREE.Group(); parent.add(g);
  g.rotation.y = { '-z': 0, '+z': Math.PI, '+x': -Math.PI / 2, '-x': Math.PI / 2 }[face];
  if (face === '-z' || face === '+z') g.position.set(cx, cy, wallPos); else g.position.set(wallPos, cy, cx);
  const trim = std('trim:' + (opt.trim || '#f2f0ea'), { color: new THREE.Color(opt.trim || '#f2f0ea'), roughness: 0.55 });
  const glass = matTex('houseGlass', blindsTex, 0x1d262c, { roughness: 0.06, metalness: 0.2, envMapIntensity: 1.3 });
  const tw = 0.09, tp = 0.04;
  mesh(box(ww, wh, 0.02), glass, g, 0, 0, 0.01, false).userData.glass = true;
  mesh(box(ww + 2 * tw, tw, tp), trim, g, 0, wh / 2 + tw / 2, -tp / 2); mesh(box(ww + 2 * tw + 0.08, 0.05, 0.09), trim, g, 0, -wh / 2 - 0.025, -0.045);
  for (const s of [-1, 1]) mesh(box(tw, wh, tp), trim, g, s * (ww / 2 + tw / 2), 0, -tp / 2);
  mesh(box(ww, 0.035, 0.03), trim, g, 0, 0, -0.005); // meeting rail
  if (opt.grid !== false) { mesh(box(0.02, wh, 0.015), trim, g, 0, 0, -0.002); for (const f of [-0.25, 0.25]) mesh(box(ww, 0.02, 0.015), trim, g, 0, f * wh, -0.002); }
  if (opt.shutters) { const sm = std('shutter:' + opt.shutters, { color: new THREE.Color(opt.shutters), roughness: 0.7 }); for (const s of [-1, 1]) mesh(box(ww * 0.42, wh + 0.1, 0.03), sm, g, s * (ww / 2 + tw + ww * 0.21 + 0.02), 0, -0.015); }
  return g;
}

// ================================================================= STORE
// Single-storey flat-roof CMU convenience / feed store. Canonical frame: storefront faces -Z ("north"); `storefront`
// rotates the building inside its w (X) x d (Z) footprint so the front faces that compass side. Origin = footprint
// centre at grade. Includes: painted CMU walls (procedural courses, grime, streaks), storefront glazing (clear glass,
// lit coolers / shelving / counter behind it, window posters, OPEN sign), double glass doors, canopy on slim posts with
// downlights and a sign fascia (`name`, default 'FEED & GROCERY'; '' = blank panel), sidewalk + curb, bollards, ice
// merchandiser, propane cage, trash can, flat membrane roof, parapet + coping, rooftop HVAC, rear door, downspouts.
// userData.anchors (root-local): clerkEye (counter clerk eye, 1.62 m), door, signCenter, frontCurb.
export function store(a, b) {
  const o = optsOf(a, b);
  const id = o.id ?? 'store';
  const W = o.w ?? 24, Dd = o.d ?? 18, H = o.h ?? 4.9;
  const face = o.storefront || 'north';
  const sideways = face === 'east' || face === 'west';
  const fw = sideways ? Dd : W, fd = sideways ? W : Dd;
  const root = new THREE.Group(), g = new THREE.Group(); g.name = id + '_body'; root.add(g);
  g.rotation.y = { north: 0, south: Math.PI, east: -Math.PI / 2, west: Math.PI / 2 }[face] ?? 0;
  const t = 0.2, roofY = H - 0.85, zf = -fd / 2;
  const wallCol = o.color || '#d6cdb6', trimCol = o.trimColor || '#2f4a37';
  const wallMat = memo(MAT, `cmuWall:${wallCol}:${f3(H)}:${o.wall || 'cmu'}`, () => { const tx = cmuTex(wallCol, H, o.wall === 'stucco' ? 'stucco' : 'cmu'); return new THREE.MeshStandardMaterial({ color: tx ? 0xffffff : new THREE.Color(wallCol), map: tx, roughness: 0.9 }); });
  const trim = std('storeTrim:' + trimCol, { color: new THREE.Color(trimCol), metalness: 0.35, roughness: 0.45 });
  const bronze = std('storeBronze', { color: 0x2b2722, metalness: 0.55, roughness: 0.38 });
  const glassM = clearGlassMat('storefront', { opacity: 0.16 });
  // ---------- shell
  const gw = Math.min(fw - 3.2, Math.max(5, o.glazingWidth ?? fw * 0.56)), gx0 = Math.max(-fw / 2 + 1.4, Math.min(fw / 2 - 1.4 - gw, (o.glazingOffset ?? 0) - gw / 2)), gx1 = gx0 + gw;
  const gTop = 2.9;
  wbox(g, -fw / 2, fw / 2, 0, H, fd / 2 - t, fd / 2, wallMat, 8, H);
  wbox(g, -fw / 2, -fw / 2 + t, 0, H, zf, fd / 2 - t, wallMat, 8, H);
  wbox(g, fw / 2 - t, fw / 2, 0, H, zf, fd / 2 - t, wallMat, 8, H);
  wbox(g, -fw / 2 + t, gx0, 0, H, zf, zf + t, wallMat, 8, H);
  wbox(g, gx1, fw / 2 - t, 0, H, zf, zf + t, wallMat, 8, H);
  wbox(g, gx0, gx1, gTop, H, zf, zf + t, wallMat, 8, H);
  // roof deck + parapet coping + scuppers/downspouts
  const memb = matTex('roofMembraneMat', roofMembraneTex, 0xc4c7c6, { roughness: 0.85 });
  wbox(g, -fw / 2 + t, fw / 2 - t, roofY - 0.25, roofY, zf + t, fd / 2 - t, memb, 6, 6);
  const cop = std('coping:' + trimCol, { color: new THREE.Color(trimCol), metalness: 0.5, roughness: 0.4 });
  wbox(g, -fw / 2 - 0.04, fw / 2 + 0.04, H, H + 0.07, zf - 0.04, zf + t + 0.03, cop); wbox(g, -fw / 2 - 0.04, fw / 2 + 0.04, H, H + 0.07, fd / 2 - t - 0.03, fd / 2 + 0.04, cop);
  wbox(g, -fw / 2 - 0.04, -fw / 2 + t + 0.03, H, H + 0.07, zf + t, fd / 2 - t, cop); wbox(g, fw / 2 - t - 0.03, fw / 2 + 0.04, H, H + 0.07, zf + t, fd / 2 - t, cop);
  const dsp = std('downspout', { color: 0xe9e6dc, roughness: 0.6 });
  for (const s of [-1, 1]) { const x = s * (fw / 2 - 1.2); wbox(g, x - 0.2, x + 0.2, roofY + 0.05, roofY + 0.45, fd / 2, fd / 2 + 0.25, dsp); wbox(g, x - 0.06, x + 0.06, 0.1, roofY + 0.1, fd / 2 + 0.03, fd / 2 + 0.15, dsp); wbox(g, x - 0.1, x + 0.1, 0, 0.12, fd / 2 + 0.03, fd / 2 + 0.35, dsp); }
  // rooftop units (set back from the front parapet), vent stacks, hatch
  const nH = Math.max(1, Math.min(5, Math.round(fw * fd / 170)));
  for (let i = 0; i < nH; i++) hvac(g, -fw / 2 + fw * (i + 0.5) / nH + (i % 2 ? 0.8 : -0.6), roofY, zf + fd * (i % 2 ? 0.62 : 0.42), 1);
  for (let i = 0; i < 3; i++) mesh(cyl(0.05, 0.05, 0.6, 8), std('vent', { color: 0x7d8080, metalness: 0.5, roughness: 0.5 }), g, -fw / 4 + i * 1.7, roofY + 0.3, fd * 0.25);
  wbox(g, fw * 0.22, fw * 0.22 + 0.9, roofY, roofY + 0.35, fd * 0.1, fd * 0.1 + 0.9, std('hatch', { color: 0x9a9c9c, metalness: 0.4, roughness: 0.5 }));
  // rear service door + light, side meter
  const bdx = fw * 0.25;
  wbox(g, bdx - 0.55, bdx + 0.55, 0, 2.25, fd / 2, fd / 2 + 0.05, std('rearDoorFrame', { color: 0x6e6c64, metalness: 0.4, roughness: 0.5 }));
  wbox(g, bdx - 0.47, bdx + 0.47, 0.02, 2.17, fd / 2 + 0.05, fd / 2 + 0.07, std('rearDoor', { color: 0x8a8678, metalness: 0.35, roughness: 0.5 }));
  wbox(g, bdx - 0.12, bdx + 0.12, 2.5, 2.7, fd / 2, fd / 2 + 0.18, M.black());
  wbox(g, fw / 2, fw / 2 + 0.18, 1.2, 2.0, fd * 0.3, fd * 0.3 + 0.6, std('meterPanel', { color: 0x8f9494, metalness: 0.5, roughness: 0.45 }));
  // ---------- interior visible through the glazing (dark shadow box + lit coolers / shelving / counter)
  const ib = Math.min(fd - 2 * t - 0.4, o.interiorDepth ?? 7.0), iz0 = zf + t, iz1 = iz0 + ib, ix0 = Math.max(-fw / 2 + t, gx0 - 1.2), ix1 = Math.min(fw / 2 - t, gx1 + 1.2), ceilY = 3.15;
  const inWall = std('interiorWall', { color: 0x8c8a83, roughness: 0.9 });
  wbox(g, ix0, ix1, 0, 0.02, iz0, iz1, matTex('vctMat', floorTex, 0x938f87, { roughness: 0.55 }), 1.2, 1.2, false);
  wbox(g, ix0, ix1, ceilY, ceilY + 0.04, iz0, iz1, matTex('ceilMat', ceilingTex, 0x9c9c98, { roughness: 0.9 }), 1.2, 1.2, false);
  wbox(g, ix0, ix1, 0, ceilY, iz1, iz1 + 0.1, inWall, 4, 4, false);
  wbox(g, ix0 - 0.05, ix0, 0, ceilY, iz0, iz1, inWall, 4, 4, false); wbox(g, ix1, ix1 + 0.05, 0, ceilY, iz0, iz1, inWall, 4, 4, false);
  const troffer = std('troffer', { color: 0xf4f6f6, emissive: 0xf2f6ff, emissiveIntensity: o.lit ? 2.0 : 1.1, roughness: 0.4 });
  for (let x = ix0 + 1.5; x < ix1 - 0.8; x += 3) for (let z = iz0 + 1.4; z < iz1 - 0.5; z += 2.4) mesh(box(0.6, 0.02, 1.2), troffer, g, x, ceilY - 0.01, z, false);
  // reach-in coolers along the back partition (right half), lit
  const coolTex = coolerDoorTex(), coolMat = memo(MAT, 'coolerMat', () => new THREE.MeshStandardMaterial({ color: coolTex ? 0xffffff : 0xdfe8ec, map: coolTex, emissive: 0xffffff, emissiveMap: coolTex, emissiveIntensity: o.lit ? 0.9 : 0.55, roughness: 0.2, metalness: 0.1 }));
  const nDoors = Math.max(3, Math.min(12, Math.floor((ix1 - ix0) * 0.55 / 0.78))), cx0 = ix1 - 0.3 - nDoors * 0.78;
  wbox(g, cx0 - 0.1, ix1 - 0.2, 0, 2.45, iz1 - 0.35, iz1, std('coolerBox', { color: 0x2a2c2e, metalness: 0.3, roughness: 0.5 }), 4, 4, false);
  for (let i = 0; i < nDoors; i++) { const m = mesh(memo(GEO, 'coolerDoorPlane', () => new THREE.PlaneGeometry(0.76, 1.9)), coolMat, g, cx0 + 0.39 + i * 0.78, 0.25 + 0.95, iz1 - 0.36, false); m.rotation.y = Math.PI; }
  wbox(g, cx0 - 0.1, ix1 - 0.2, 2.2, 2.5, iz1 - 0.42, iz1 - 0.35, std('coolerHeader', { color: 0x1d4f8f, emissive: 0x1d4f8f, emissiveIntensity: 0.25, roughness: 0.5 }), 4, 4, false);
  // gondola shelving rows parallel to the glass
  const gMat = matTex('gondolaMat', gondolaTex, 0x5a5d5e, { roughness: 0.8 });
  for (const [z, x0r, x1r] of [[iz0 + 2.6, -0.1, 0.55], [iz0 + 4.3, 0.0, 0.7]]) { const xa = ix0 + (ix1 - ix0) * Math.max(0.32, x0r + 0.3), xb = ix0 + (ix1 - ix0) * x1r + 1.5; if (xb - xa > 1.2 && z < iz1 - 1) wbox(g, xa, Math.min(xb, ix1 - 0.5), 0, 1.5, z, z + 0.9, gMat, 2.4, 1.5, false); }
  // check-out counter near the window (left of the door): clerk looks out through the storefront
  const ctrX = gx0 + Math.min(2.2, gw * 0.22), ctrZ = iz0 + 1.25;
  const ctrMat = std('counter', { color: 0x6b5a48, roughness: 0.7 }), topMat = std('counterTop', { color: 0x3c3a36, roughness: 0.35 });
  wbox(g, ctrX - 1.3, ctrX + 1.3, 0, 0.95, ctrZ, ctrZ + 0.65, ctrMat, 2, 2, false); wbox(g, ctrX - 1.35, ctrX + 1.35, 0.95, 1.0, ctrZ - 0.05, ctrZ + 0.7, topMat, 2, 2, false);
  wbox(g, ctrX - 0.2, ctrX + 0.2, 1.0, 1.25, ctrZ + 0.2, ctrZ + 0.5, M.black(), 1, 1, false);
  wbox(g, ctrX - 1.2, ctrX + 1.2, 0.9, 2.4, ctrZ + 1.9, ctrZ + 2.2, gMat, 2.4, 1.5, false); // back-bar shelving behind the clerk
  // window posters + OPEN sign facing out (just inside the glass)
  const posters = o.posters ?? [[['COLD', 'DRINKS'], '#c62a2a', '#ffffff', '#8c1616'], [['ICE'], '#1f5fae', '#ffffff', '#123a6e'], [['FEED', 'SEED', 'HAY'], '#efe6c8', '#2f4a37', '#2f4a37']];
  const pz = zf + t / 2 + 0.05;
  posters.forEach((p, i) => { const tx = posterTex(...p); const pm = memo(MAT, 'posterMat:' + p[0].join('|') + p[1], () => new THREE.MeshStandardMaterial({ color: tx ? 0xffffff : new THREE.Color(p[1]), map: tx, roughness: 0.6 })); const px = gx1 - 0.75 - i * 1.6; if (px > gx0 + 0.6 && Math.abs(px) > 1.7) { const m = mesh(memo(GEO, 'posterPlane', () => new THREE.PlaneGeometry(0.76, 1.0)), pm, g, px, 1.05, pz, false); m.rotation.y = Math.PI; } });
  const openTex = ctex('openSign', 256, 96, (q, Wc, Hc) => { q.fillStyle = '#000'; q.fillRect(0, 0, Wc, Hc); q.strokeStyle = '#ff3b30'; q.lineWidth = 6; q.strokeRect(8, 8, Wc - 16, Hc - 16); q.fillStyle = '#ff5a4a'; q.font = 'bold 62px "Liberation Sans","DejaVu Sans",Arial,sans-serif'; q.textAlign = 'center'; q.textBaseline = 'middle'; q.fillText('OPEN', Wc / 2, Hc / 2 + 2); });
  const openMat = memo(MAT, 'openSignMat', () => new THREE.MeshStandardMaterial({ color: 0x000000, map: openTex, emissive: 0xffffff, emissiveMap: openTex, emissiveIntensity: 1.6, transparent: !!openTex, alphaTest: 0.0, roughness: 0.5 }));
  { const m = mesh(memo(GEO, 'openPlane', () => new THREE.PlaneGeometry(0.75, 0.28)), openMat, g, gx0 + 0.9, 2.3, pz, false); m.rotation.y = Math.PI; }
  // ---------- storefront framing + glass + doors
  const doorX = Math.max(gx0 + 1.3, Math.min(gx1 - 1.3, o.doorX ?? (gx0 + gx1) / 2)), dW = 1.83, dH = 2.18, sfz = zf + t / 2, dep = 0.12;
  const glassPane = (x0, x1, y0, y1, z) => { const m = wbox(g, x0, x1, y0, y1, z - 0.006, z + 0.006, glassM, 4, 4, false); m.userData.seeThrough = true; m.userData.glass = true; m.renderOrder = 2; return m; };
  wbox(g, gx0, doorX - dW / 2, 0, 0.36, sfz - dep / 2, sfz + dep / 2, bronze); wbox(g, doorX + dW / 2, gx1, 0, 0.36, sfz - dep / 2, sfz + dep / 2, bronze);
  glassPane(gx0, doorX - dW / 2, 0.36, gTop, sfz); glassPane(doorX + dW / 2, gx1, 0.36, gTop, sfz); glassPane(doorX - dW / 2, doorX + dW / 2, dH + 0.05, gTop, sfz);
  const mull = (x, y0 = 0, y1 = gTop) => wbox(g, x - 0.045, x + 0.045, y0, y1, sfz - dep / 2, sfz + dep / 2, bronze);
  mull(gx0 + 0.045); mull(gx1 - 0.045); mull(doorX - dW / 2 - 0.045); mull(doorX + dW / 2 + 0.045);
  for (const [a0, a1] of [[gx0, doorX - dW / 2], [doorX + dW / 2, gx1]]) { const n = Math.max(1, Math.round((a1 - a0) / 1.6)); for (let i = 1; i < n; i++) mull(a0 + (a1 - a0) * i / n); }
  for (const y of [0.36, gTop - 0.05]) wbox(g, gx0, gx1, y - 0.04, y + 0.04, sfz - dep / 2, sfz + dep / 2, bronze);
  wbox(g, doorX - dW / 2, doorX + dW / 2, dH, dH + 0.08, sfz - dep / 2, sfz + dep / 2, bronze);
  for (const s of [-1, 1]) { // door leaves (aluminium stile frame + glass + push bar)
    const xa = doorX + (s < 0 ? -dW / 2 : 0), xb = xa + dW / 2, zz = sfz - 0.02;
    wbox(g, xa, xa + 0.1, 0, dH, zz - 0.025, zz + 0.025, bronze); wbox(g, xb - 0.1, xb, 0, dH, zz - 0.025, zz + 0.025, bronze);
    wbox(g, xa, xb, 0, 0.28, zz - 0.025, zz + 0.025, bronze); wbox(g, xa, xb, dH - 0.1, dH, zz - 0.025, zz + 0.025, bronze);
    glassPane(xa + 0.1, xb - 0.1, 0.28, dH - 0.1, zz);
    wbox(g, xa + 0.15, xb - 0.15, 0.98, 1.04, zz - 0.09, zz - 0.04, M.alum());
  }
  // ---------- canopy on slim posts: fascia with sign panel, soffit downlights
  const cd = o.canopyDepth ?? 3.0, cy = 3.3, fh = 0.85, cw = Math.min(fw + 0.3, o.canopyWidth ?? gw + 5), ccx = Math.max(-fw / 2 + cw / 2 - 0.15, Math.min(fw / 2 - cw / 2 + 0.15, (gx0 + gx1) / 2)), cz = zf - cd;
  const soffit = std('storeSoffit', { color: 0xd9d6cd, roughness: 0.8 });
  wbox(g, ccx - cw / 2, ccx + cw / 2, cy, cy + 0.06, cz, zf, soffit);
  wbox(g, ccx - cw / 2, ccx + cw / 2, cy + fh - 0.12, cy + fh - 0.05, cz, zf, std('canopyDeck', { color: 0x8e9090, metalness: 0.4, roughness: 0.6 }));
  wbox(g, ccx - cw / 2, ccx + cw / 2, cy - 0.02, cy + fh, cz - 0.14, cz, trim);
  for (const s of [-1, 1]) wbox(g, ccx + s * cw / 2 - 0.07, ccx + s * cw / 2 + 0.07, cy - 0.02, cy + fh, cz, zf, trim);
  const nP = Math.max(2, Math.ceil(cw / 5.5) + 1);
  if (o.canopyPosts !== false) for (let i = 0; i < nP; i++) { const x = ccx - cw / 2 + 0.25 + (cw - 0.5) * i / (nP - 1); wbox(g, x - 0.075, x + 0.075, 0.15, cy, cz + 0.08, cz + 0.23, trim); wbox(g, x - 0.13, x + 0.13, 0.15, 0.18, cz + 0.02, cz + 0.29, bronze); }
  const dl = std('downlight', { color: 0xf8f6ee, emissive: 0xfff3dc, emissiveIntensity: o.lit ? 3.0 : 0.25, roughness: 0.3 });
  const nL = Math.max(2, Math.round(cw / 2.6));
  for (let i = 0; i < nL; i++) { const x = ccx - cw / 2 + cw * (i + 0.5) / nL; mesh(cyl(0.11, 0.11, 0.02, 14), dl, g, x, cy - 0.005, zf - cd * 0.5, false).name = 'downlight'; }
  if (o.lit && o.lights !== false) for (let i = 0; i < Math.min(4, nL); i++) { const x = ccx - cw / 2 + cw * (i + 0.5) / Math.min(4, nL); const sp = new THREE.SpotLight(0xffeedd, 60, 9, 1.1, 0.7, 2); sp.position.set(x, cy - 0.05, zf - cd * 0.5); sp.target.position.set(x, 0, zf - cd * 0.5); g.add(sp, sp.target); }
  const sw = Math.min(cw - 1.2, o.signWidth ?? Math.min(12, cw * 0.6)), sh = 0.62, name = o.name ?? 'FEED & GROCERY';
  const signTx = storeSignTex(name, sw, sh, o.signBg || '#f1ead6', o.signFg || trimCol);
  const signFace = memo(MAT, `storeSignMat:${name}:${f3(sw)}:${trimCol}`, () => new THREE.MeshStandardMaterial({ color: signTx ? 0xffffff : 0xf1ead6, map: signTx, emissive: 0xffffff, emissiveMap: signTx, emissiveIntensity: o.lit ? 0.6 : 0.0, roughness: 0.45 }));
  wbox(g, ccx - sw / 2 - 0.05, ccx + sw / 2 + 0.05, cy + fh / 2 - sh / 2 - 0.05, cy + fh / 2 + sh / 2 + 0.05, cz - 0.24, cz - 0.14, bronze);
  { const m = mesh(memo(GEO, `signPlane:${f3(sw)}`, () => new THREE.PlaneGeometry(sw, sh)), signFace, g, ccx, cy + fh / 2, cz - 0.245, false); m.rotation.y = Math.PI; m.name = 'store_sign'; }
  // ---------- sidewalk + curb, bollards, ice merchandiser, propane cage, trash can
  const swk = matTex('sidewalkMat', sidewalkTex, 0xb9b4a9, { roughness: 0.9 });
  const sx0 = Math.max(-fw / 2 - 0.3, ccx - cw / 2 - 0.3), sx1 = Math.min(fw / 2 + 0.3, ccx + cw / 2 + 0.3), sz0 = cz - 0.45;
  wbox(g, sx0, sx1, 0, 0.15, sz0, zf, swk, 3, 3);
  wbox(g, sx0, sx1, 0, 0.152, sz0 - 0.02, sz0 + 0.15, std('curbEdge', { color: 0x9c978c, roughness: 0.85 }));
  const yel = std('bollardYellow', { color: 0xe8b80e, roughness: 0.45, metalness: 0.2 });
  if (o.bollards !== false) for (let x = gx0 + 0.6; x < gx1 - 0.3; x += 2.0) if (Math.abs(x - doorX) > 1.6) bollard(g, x, zf - 0.75, yel);
  const iceX = Math.min(fw / 2 - 1.1, gx1 + 1.05), iceFace = matTex('iceFaceMat', iceTex, 0xf3f5f6, { roughness: 0.4 }), iceBody = std('iceBody', { color: 0xeef1f3, roughness: 0.4, metalness: 0.1 });
  if (o.iceChest !== false) mesh(box(1.55, 1.3, 0.8), [iceBody, iceBody, iceBody, iceBody, iceBody, iceFace], g, iceX, 0.15 + 0.65, zf - 0.5);
  if (o.propane !== false && gx0 - 2.0 > -fw / 2) {
    const px = gx0 - 1.1, cage = std('propCage', { color: 0x3c4a54, metalness: 0.5, roughness: 0.45 }), tankM = std('propTank', { color: 0xe9ebe9, metalness: 0.3, roughness: 0.4 });
    for (const sx of [-0.62, 0.62]) for (const sz of [-0.42, 0.42]) wbox(g, px + sx - 0.03, px + sx + 0.03, 0.15, 1.75, zf - 0.5 + sz - 0.03, zf - 0.5 + sz + 0.03, cage);
    for (const y of [0.16, 0.9, 1.72]) wbox(g, px - 0.65, px + 0.65, y, y + 0.04, zf - 0.95, zf - 0.05, cage);
    for (let i = 0; i < 4; i++) for (const y of [0.2, 0.95]) mesh(cyl(0.15, 0.15, 0.58, 14), tankM, g, px - 0.45 + i * 0.3, y + 0.29, zf - 0.5);
    const meshTex = ctex('cageMesh', 64, 64, (q, Wc, Hc) => { q.clearRect(0, 0, Wc, Hc); q.strokeStyle = '#3c4a54'; q.lineWidth = 2; for (let k = 0; k <= Wc; k += 8) { q.beginPath(); q.moveTo(k, 0); q.lineTo(k, Hc); q.stroke(); q.beginPath(); q.moveTo(0, k); q.lineTo(Wc, k); q.stroke(); } }, { repeat: true });
    if (meshTex) { const mm = memo(MAT, 'cageMeshMat', () => new THREE.MeshStandardMaterial({ map: meshTex, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.4, roughness: 0.5 })); wbox(g, px - 0.65, px + 0.65, 0.16, 1.74, zf - 0.96, zf - 0.94, mm, 0.5, 0.5, false); }
  }
  mesh(cyl(0.3, 0.27, 0.95, 16), std('trashCan', { color: 0x2c3a30, roughness: 0.6, metalness: 0.2 }), g, doorX + 1.6, 0.15 + 0.475, zf - 0.55);
  // ---------- anchors (root-local)
  const anchors = {}; const toRoot = v => { const p = new THREE.Vector3(...v).applyEuler(g.rotation); return p.toArray().map(n => +n.toFixed(3)); };
  anchors.clerkEye = toRoot([ctrX, 1.62, ctrZ + 1.0]); anchors.door = toRoot([doorX, 0.15, zf - 0.3]); anchors.signCenter = toRoot([ccx, cy + fh / 2, cz - 0.25]); anchors.frontCurb = toRoot([ccx, 0.15, sz0]);
  const bb = new THREE.Box3().setFromObject(root);
  return finish(root, 'building', id, { length: Dd, width: W, height: +bb.max.y.toFixed(2) }, { style: 'store', footprint: { x: W, z: Dd }, storefront: face, anchors, name, note: 'storefront glass meshes carry userData.seeThrough=true' });
}

// ================================================================= PARKING LOT
// parkingLot({polygon:[[x,z],...], stalls, aprons, y}) - asphalt (meter-tiled texture) inside a CCW/CW polygon,
// white 4" stall lines, concrete wheel stops, optional blue ADA stalls, and concrete driveway aprons out to a road.
//  stalls: number  -> one nose-in row along polygon edge 0->1, stalls extending into the lot
//          array   -> rows [{from:[x,z], to:[x,z], width=2.75, depth=5.5, side=1|-1 (1 = toward the polygon centroid), ada:[i..], wheelStops=true}]
//  aprons: [{from:[x,z] (lot edge), to:[x,z] (road edge), width=7.3, flare=2.0}]
// userData.stalls = [{x, z, heading}] stall centres (heading = rotation.y that points a car nose-in).
export function parkingLot(a, b) {
  const o = optsOf(a, b); const id = o.id ?? 'parking_lot';
  const poly = (o.polygon && o.polygon.length >= 3 ? o.polygon : [[-16, -11], [16, -11], [16, 11], [-16, 11]]).map(p => [+p[0], +p[1]]);
  const root = new THREE.Group(), Y = o.y ?? 0.03;
  let area = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; area += p[0] * q[1] - q[0] * p[1]; }
  const flat = (pts, mat, y, key, tile = 8) => {
    const geo = new THREE.ShapeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], -p[1]))), 2); geo.rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv, pos = geo.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / tile, pos.getZ(i) / tile);
    const m = mesh(geo, mat, root, 0, y, 0, false); m.name = key; return m;
  };
  flat(poly, matTex('lotAsphaltMat', asphaltTex, 0x45474a, { roughness: 0.93 }), Y, 'asphalt');
  const conc = matTex('apronMat', sidewalkTex, 0xb9b4a9, { roughness: 0.9 });
  for (const ap of o.aprons || (o.apron ? [o.apron] : [])) {
    const [fx, fz] = ap.from, [tx, tz] = ap.to, L = Math.hypot(tx - fx, tz - fz), ux = (tx - fx) / L, uz = (tz - fz) / L, nx = -uz, nz = ux, hw = (ap.width ?? 7.3) / 2, fl = ap.flare ?? 2.0;
    const pts = [[fx + nx * hw - ux * 1.0, fz + nz * hw - uz * 1.0], [tx + nx * (hw + fl), tz + nz * (hw + fl)], [tx - nx * (hw + fl), tz - nz * (hw + fl)], [fx - nx * hw - ux * 1.0, fz - nz * hw - uz * 1.0]];
    flat(pts, ap.asphalt ? matTex('lotAsphaltMat', asphaltTex, 0x45474a, { roughness: 0.93 }) : conc, Y + 0.004, 'apron', ap.asphalt ? 8 : 3);
    // stop bar across the exit half, 1.2 m back from the road edge
    const sb = new THREE.Mesh(box(0.45, 0.004, hw), std('lotPaint', { color: 0xeeeeea, roughness: 0.6 })); sb.position.set(tx - ux * 1.4 - nx * hw / 2, Y + 0.009, tz - uz * 1.4 - nz * hw / 2); sb.rotation.y = Math.atan2(nx, nz); sb.receiveShadow = true; root.add(sb);
  }
  let rows = o.stalls ?? 10;
  if (typeof rows === 'number') { const [p, q] = [poly[0], poly[1]], L = Math.hypot(q[0] - p[0], q[1] - p[1]), ux = (q[0] - p[0]) / L, uz = (q[1] - p[1]) / L; const n = Math.min(rows, Math.floor((L - 1) / 2.75)); const s = 0.5 + (L - 1 - n * 2.75) / 2; rows = [{ from: [p[0] + ux * s, p[1] + uz * s], to: [p[0] + ux * (s + n * 2.75), p[1] + uz * (s + n * 2.75)], side: 1 }]; }
  const lines = [], stops = [], ada = [], centres = [];
  const cxP = poly.reduce((s, p) => s + p[0], 0) / poly.length, czP = poly.reduce((s, p) => s + p[1], 0) / poly.length; void area;
  for (const r of rows) {
    const [fx, fz] = r.from, [tx, tz] = r.to, L = Math.hypot(tx - fx, tz - fz); if (L < 1) continue;
    const ux = (tx - fx) / L, uz = (tz - fz) / L, sd = (r.side ?? 1) * ((-uz * (cxP - (fx + tx) / 2) + ux * (czP - (fz + tz) / 2)) >= 0 ? 1 : -1), nx = -uz * sd, nz = ux * sd, wS = r.width ?? 2.75, dS = r.depth ?? 5.5;
    const n = Math.max(1, Math.round(L / wS)), ws = L / n;
    for (let i = 0; i <= n; i++) lines.push({ x: fx + ux * ws * i + nx * dS / 2, z: fz + uz * ws * i + nz * dS / 2, ang: Math.atan2(nx, nz), len: dS, blue: (r.ada || []).includes(i) || (r.ada || []).includes(i - 1) });
    for (let i = 0; i < n; i++) {
      const cx = fx + ux * ws * (i + 0.5), cz = fz + uz * ws * (i + 0.5);
      centres.push({ x: +(cx + nx * dS / 2).toFixed(2), z: +(cz + nz * dS / 2).toFixed(2), heading: +Math.atan2(nx, nz).toFixed(4) });
      if (r.wheelStops !== false) stops.push({ x: cx + nx * 0.75, z: cz + nz * 0.75, ang: Math.atan2(nx, nz) });
      if ((r.ada || []).includes(i)) ada.push({ x: cx + nx * dS * 0.6, z: cz + nz * dS * 0.6, ang: Math.atan2(nx, nz) });
    }
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = V(1, 1, 1);
  const inst = (geo, mat, list, y, name, shadow = false) => { if (!list.length) return; const im = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((l, i) => { q.setFromAxisAngle(UP, l.ang); m4.compose(V(l.x, y, l.z), q, l.len ? V(1, 1, l.len) : s1); im.setMatrixAt(i, m4); }); im.castShadow = shadow; im.receiveShadow = true; im.name = name; im.computeBoundingSphere(); root.add(im); };
  inst(box(0.1, 0.004, 1), std('lotPaint', { color: 0xeeeeea, roughness: 0.6 }), lines.filter(l => !l.blue), Y + 0.006, 'stall_lines');
  inst(box(0.1, 0.004, 1), std('lotPaintBlue', { color: 0x1f56a8, roughness: 0.6 }), lines.filter(l => l.blue), Y + 0.006, 'ada_lines');
  inst(memo(GEO, 'wheelStop', () => { const g2 = new THREE.BoxGeometry(1.8, 0.12, 0.16); g2.translate(0, 0.06, 0); return g2; }), M.concrete(), stops, Y, 'wheel_stops', true);
  const isa = ctex('isaSymbol', 128, 128, (g2, Wc, Hc) => { g2.fillStyle = '#1f56a8'; g2.fillRect(0, 0, Wc, Hc); g2.strokeStyle = '#fff'; g2.fillStyle = '#fff'; g2.lineWidth = 9; g2.lineCap = 'round'; g2.beginPath(); g2.arc(56, 22, 9, 0, 7); g2.fill(); g2.beginPath(); g2.moveTo(54, 38); g2.lineTo(58, 74); g2.lineTo(86, 74); g2.lineTo(98, 100); g2.stroke(); g2.beginPath(); g2.moveTo(56, 52); g2.lineTo(80, 52); g2.stroke(); g2.lineWidth = 7; g2.beginPath(); g2.arc(56, 82, 24, -0.3, Math.PI * 1.35); g2.stroke(); });
  inst(memo(GEO, 'isaPlane', () => { const p = new THREE.PlaneGeometry(1.2, 1.2); p.rotateX(-Math.PI / 2); return p; }), memo(MAT, 'isaMat', () => new THREE.MeshStandardMaterial({ color: isa ? 0xffffff : 0x1f56a8, map: isa, roughness: 0.6 })), ada, Y + 0.007, 'ada_symbols');
  const bb = bboxPts(poly);
  return finish(root, 'parkingLot', id, { length: +bb.h.toFixed(2), width: +bb.w.toFixed(2), height: 0.15 }, { stalls: centres, polygon: poly, occludes: false });
}

// ================================================================= HOUSE
// house({w, d, h, style}) single-storey residence, front (door, porch) faces -Z, origin = footprint centre at grade.
//  style 'ranch' (gable roof, lap siding, front porch on posts), 'hip' (hip roof), 'mobile' (single-wide manufactured
//  home: low-pitch ribbed metal roof, vertical siding, lattice skirt, wood entry deck + steps). h = wall height above floor.
const HOUSE_COLS = ['#d8cfbd', '#e6dfc6', '#c5cfd0', '#efede6', '#c9c4a4', '#dcc9a8', '#b8c3c8', '#d7d9d0'];
const ROOF_COLS = ['#3c3e41', '#4a4440', '#5a5650', '#2f3236', '#56504a'];
export function house(a, b) {
  const o = optsOf(a, b); const id = o.id ?? 'house';
  const style = ['ranch', 'hip', 'mobile'].includes(o.style) ? o.style : 'ranch', mobile = style === 'mobile';
  const w = o.w ?? (mobile ? 18 : 12), d = o.d ?? (mobile ? 4.3 : 8.5), h = Math.min(o.h ?? (mobile ? 2.4 : 2.75), 4.2);
  const R = rng(hash(id)), col = o.color || HOUSE_COLS[Math.floor(R() * HOUSE_COLS.length)], roofCol = o.roofColor || ROOF_COLS[Math.floor(R() * ROOF_COLS.length)];
  const trimCol = o.trim || (mobile ? '#e4e6e6' : '#f2f0ea');
  const root = new THREE.Group(), hg = new THREE.Group(); root.add(hg);
  const base = mobile ? 0.72 : 0.32; hg.position.y = base;
  const t = 0.16, sid = sidingMat(col, mobile ? 'vertical' : 'lap');
  // foundation / skirt
  if (mobile) wbox(root, -w / 2 + 0.05, w / 2 - 0.05, 0, base, -d / 2 + 0.05, d / 2 - 0.05, matTex('skirtMat', latticeTex, 0xd8d4c8, { roughness: 0.85 }), 1, 0.5);
  else wbox(root, -w / 2 - 0.05, w / 2 + 0.05, 0, base, -d / 2 - 0.05, d / 2 + 0.05, M.concrete(), 2, 2);
  // walls (hollow) + ceiling
  wbox(hg, -w / 2, w / 2, 0, h, -d / 2, -d / 2 + t, sid, 4, 2); wbox(hg, -w / 2, w / 2, 0, h, d / 2 - t, d / 2, sid, 4, 2);
  wbox(hg, -w / 2, -w / 2 + t, 0, h, -d / 2 + t, d / 2 - t, sid, 4, 2); wbox(hg, w / 2 - t, w / 2, 0, h, -d / 2 + t, d / 2 - t, sid, 4, 2);
  wbox(hg, -w / 2 + t, w / 2 - t, h - 0.06, h, -d / 2 + t, d / 2 - t, std('houseCeil', { color: 0x9d998e, roughness: 0.9 }), 4, 4, false);
  const trim = std('trim:' + trimCol, { color: new THREE.Color(trimCol), roughness: 0.55 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh(box(0.13, h, 0.13), trim, hg, sx * (w / 2 - 0.05), h / 2, sz * (d / 2 - 0.05)); // corner boards
  // roof
  const pitch = mobile ? 0.14 : (o.pitch ?? 0.42), oh = mobile ? 0.18 : 0.5, rise = (d / 2) * pitch, ridgeY = h + rise;
  const rMat = mobile ? metalRoofMat(o.roofColor || '#b9bdbd') : shingleMat(roofCol);
  if (style === 'hip') {
    const X = w / 2 + oh, Z = d / 2 + oh, ye = h - oh * pitch, yr = h + rise, rx = Math.max(0, X - Z);
    const A = [-X, ye, -Z], B = [X, ye, -Z], C = [X, ye, Z], Dp = [-X, ye, Z], P = [-rx, yr, 0], Q = [rx, yr, 0];
    const tris = [[A, Q, B], [A, P, Q], [C, P, Dp], [C, Q, P], [B, Q, C], [Dp, P, A]];
    const pos = [], uv = [], sl = Math.sqrt(1 + pitch * pitch);
    tris.forEach((tr, k) => { const side = k >= 4; for (const v of tr) { pos.push(...v); uv.push((side ? v[2] : v[0]) / 2, (v[1] - ye) / pitch * sl / 2); } });
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.computeVertexNormals();
    const rm = mesh(geo, rMat, hg); rm.name = 'roof';
    rMat.shadowSide = THREE.DoubleSide;
    for (const [x0, x1, z0, z1] of [[-X, X, -Z, -Z + 0.04], [-X, X, Z - 0.04, Z], [-X, -X + 0.04, -Z, Z], [X - 0.04, X, -Z, Z]]) wbox(hg, x0, x1, ye - 0.2, ye, z0, z1, trim, 1, 1);
    wbox(hg, -X, X, ye - 0.21, ye - 0.19, -Z, Z, std('soffitH', { color: 0xe2e0d8, roughness: 0.8 }), 4, 4, false);
    if (rx > 0) wbox(hg, -rx, rx, yr - 0.02, yr + 0.06, -0.12, 0.12, shingleMat(roofCol), 2, 2);
  } else {
    const r = d / 2 + oh, ye = h - oh * pitch, L = w + 2 * (mobile ? 0.15 : 0.35);
    slab(hg, [-r, ye], [0, ridgeY + 0.04], L, 0.07, rMat, 'x', 2);
    slab(hg, [0, ridgeY + 0.04], [r, ye], L, 0.07, rMat, 'x', 2);
    const gable = shapeUV([[-d / 2, h], [d / 2, h], [0, ridgeY]], 4, 2);
    for (const s of [-1, 1]) { const m = mesh(gable, sid, hg, s * (w / 2 - 0.001), 0, 0); m.rotation.y = s * Math.PI / 2; m.castShadow = true; }
    for (const s of [-1, 1]) { wbox(hg, -L / 2, L / 2, ye - 0.2, ye + 0.02, s * r - 0.03, s * r + 0.03, trim, 1, 1); wbox(hg, -L / 2, L / 2, ye - 0.21, ye - 0.18, s > 0 ? d / 2 : -r, s > 0 ? r : -d / 2, std('soffitH', { color: 0xe2e0d8, roughness: 0.8 }), 4, 4, false); }
    for (const s of [-1, 1]) { // rake boards
      for (const sz of [-1, 1]) { const len = Math.hypot(r, rise + oh * pitch), m = mesh(box(0.05, 0.18, len), trim, hg, s * L / 2, (ye + ridgeY) / 2 - 0.03, sz * r / 2); m.rotation.x = sz * Math.atan2(ridgeY - ye, r); }
    }
    wbox(hg, -L / 2, L / 2, ridgeY + 0.02, ridgeY + 0.1, -0.1, 0.1, mobile ? rMat : shingleMat(roofCol), 2, 2);
  }
  // door + windows
  const doorX = o.doorX ?? (mobile ? -w * 0.18 : w * (R() < 0.5 ? -0.12 : 0.12)), dW = 0.92, dH = 2.03;
  const doorCol = o.doorColor || ['#6b3b2a', '#2e4a3a', '#f2f0ea', '#34495e', '#7a2b2b'][Math.floor(R() * 5)];
  wbox(hg, doorX - dW / 2 - 0.09, doorX + dW / 2 + 0.09, 0, dH + 0.09, -d / 2 - 0.04, -d / 2, trim, 1, 1);
  wbox(hg, doorX - dW / 2, doorX + dW / 2, 0, dH, -d / 2 - 0.05, -d / 2 - 0.02, std('door:' + doorCol, { color: new THREE.Color(doorCol), roughness: 0.55 }), 1, 1);
  wbox(hg, doorX - 0.28, doorX + 0.28, 1.35, 1.85, -d / 2 - 0.06, -d / 2 - 0.05, matTex('houseGlass', blindsTex, 0x1d262c, { roughness: 0.06, metalness: 0.2, envMapIntensity: 1.3 }), 1, 1, false);
  mesh(sph(0.035, 8, 6), M.alum(), hg, doorX + dW / 2 - 0.1, 1.0, -d / 2 - 0.08);
  const wO = { trim: trimCol, shutters: mobile ? null : (o.shutters ?? (R() < 0.5 ? ['#3e4a52', '#2f3e33', '#5a2e2a'][Math.floor(R() * 3)] : null)), grid: !mobile };
  const ww = mobile ? 0.9 : 0.92, wh = mobile ? 1.05 : 1.3, wy = mobile ? 1.35 : 1.45;
  for (let x = -w / 2 + 1.3; x < w / 2 - 0.9; x += mobile ? 2.4 : 2.7) if (Math.abs(x - doorX) > 1.5) windowUnit(hg, x, wy, ww, wh, '-z', -d / 2, wO);
  for (let x = -w / 2 + 1.6; x < w / 2 - 1.0; x += 3.2) windowUnit(hg, -x, wy, ww * 0.9, wh * 0.85, '+z', d / 2, wO);
  for (const s of [-1, 1]) for (let z = -d / 2 + 1.5; z < d / 2 - 1.0; z += 3.0) windowUnit(hg, z, wy, ww * 0.9, wh * 0.85, s > 0 ? '+x' : '-x', s * w / 2, wO);
  // porch / entry deck
  if (mobile) {
    const wood = std('deckWood', { color: 0x8a7458, roughness: 0.85 }), dx = doorX, pw = 2.6, pd = 1.8;
    wbox(root, dx - pw / 2, dx + pw / 2, base - 0.08, base, -d / 2 - pd, -d / 2, wood, 1, 1);
    for (const sx of [-1, 1]) for (const sz of [0, 1]) wbox(root, dx + sx * (pw / 2 - 0.06) - 0.05, dx + sx * (pw / 2 - 0.06) + 0.05, 0, base, -d / 2 - pd * sz - 0.05 + (sz ? 0.1 : -0.1), -d / 2 - pd * sz + 0.05 + (sz ? 0.1 : -0.1), wood, 1, 1);
    for (let k = 0; k < 3; k++) wbox(root, dx - 0.6, dx + 0.6, 0, base * (3 - k) / 4, -d / 2 - pd - 0.3 * (k + 1), -d / 2 - pd - 0.3 * k, wood, 1, 1);
    for (const sx of [-1, 1]) { wbox(root, dx + sx * pw / 2 - 0.04, dx + sx * pw / 2 + 0.04, base, base + 0.95, -d / 2 - pd, -d / 2, wood, 1, 1); wbox(root, dx + sx * pw / 2 - 0.03, dx + sx * pw / 2 + 0.03, base + 0.9, base + 0.96, -d / 2 - pd, -d / 2, wood, 1, 1); }
  } else if (o.porch !== false) {
    const pw = Math.min(w * 0.45, 5.2), pd = 2.1, px = Math.max(-w / 2 + pw / 2, Math.min(w / 2 - pw / 2, doorX)), z0 = -d / 2 - pd;
    wbox(root, px - pw / 2, px + pw / 2, 0, base, z0, -d / 2, M.concrete(), 2, 2);
    wbox(root, doorX - 0.7, doorX + 0.7, 0, base / 2, z0 - 0.3, z0, M.concrete(), 2, 2);
    const yTop = Math.min(h - 0.05, h - oh * pitch - 0.22), yLow = yTop - pd * 0.25, run = pd + 0.3, len = Math.hypot(run, yTop - yLow);
    const pg = uvWorld(new THREE.BoxGeometry(pw + 0.4, 0.06, len), 2, 2);
    const pslab = mesh(pg, shingleMat(roofCol), hg, px, (yTop + yLow) / 2 + 0.03, -d / 2 - run / 2); pslab.rotation.x = -Math.atan2(yTop - yLow, run); pslab.name = 'porch_roof';
    for (const sx of [-1, 1]) wbox(hg, px + sx * (pw / 2 - 0.1) - 0.06, px + sx * (pw / 2 - 0.1) + 0.06, 0, yLow + 0.02, z0 + 0.04, z0 + 0.16, trim, 1, 1);
    wbox(hg, px - pw / 2 - 0.2, px + pw / 2 + 0.2, yLow - 0.16, yLow + 0.02, z0 - 0.04, z0 + 0.16, trim, 1, 1);
  }
  // AC condenser on the +X side
  if (o.ac !== false) { const ax = w / 2 + 0.55, az = d * 0.15; wbox(root, ax - 0.4, ax + 0.4, 0, 0.08, az - 0.4, az + 0.4, M.concrete(), 1, 1); mesh(box(0.7, 0.75, 0.7), matTex('hvacLouver', louverTex, 0xb5b9b9, { metalness: 0.4, roughness: 0.55 }), root, ax, 0.08 + 0.375, az); mesh(cyl(0.26, 0.26, 0.02, 16), M.black(), root, ax, 0.84, az); }
  const bbx = new THREE.Box3().setFromObject(root);
  return finish(root, 'building', id, { length: d, width: w, height: +bbx.max.y.toFixed(2) }, { style: 'house', houseStyle: style, footprint: { x: w, z: d } });
}

// ================================================================= TREES
function blobGeo(v) {
  return memo(GEO, 'blob' + v, () => {
    const g = new THREE.IcosahedronGeometry(1, 3); const p = g.attributes.position, s = v * 1.7 + 0.3;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = Math.sin(x * 3.1 + s) * Math.sin(y * 2.7 + s * 1.3) * Math.sin(z * 3.3 + s * 0.7) + 0.5 * Math.sin(x * 7.3 - s) * Math.sin(y * 6.1 + s) * Math.sin(z * 6.9 + 2 * s);
      const k = 1 + 0.2 * n; p.setXYZ(i, x * k, y * k, z * k);
    }
    g.computeVertexNormals(); return g;
  });
}
const unitCyl = () => memo(GEO, 'unitCyl', () => { const c = new THREE.CylinderGeometry(0.78, 1, 1, 9, 1, true); c.translate(0, 0.5, 0); const uv = c.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 2); return c; });
const card = () => memo(GEO, 'leafCard', () => new THREE.PlaneGeometry(1, 1));
function leafTex(kind) {
  return ctex('leaf:' + kind, 256, 256, (g, W, H) => {
    const R = rng(hash(kind)); g.clearRect(0, 0, W, H);
    if (kind === 'pine') {
      for (let t = 0; t < 9; t++) { const cx = W * (0.2 + R() * 0.6), cy = H * (0.2 + R() * 0.6); for (let i = 0; i < 70; i++) { const a = R() * Math.PI * 2, l = 30 + R() * 50; const v = 60 + R() * 70; g.strokeStyle = `rgb(${v * 0.55},${v},${v * 0.4})`; g.lineWidth = 1.6; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); g.stroke(); } }
    } else if (kind === 'moss') {
      for (let i = 0; i < 70; i++) { let x = W * (0.1 + R() * 0.8); const L = H * (0.35 + R() * 0.65); const v = 150 + R() * 50; g.strokeStyle = `rgba(${v * 0.92},${v},${v * 0.82},${0.55 + R() * 0.4})`; g.lineWidth = 1 + R() * 2; g.beginPath(); g.moveTo(x, 0); for (let y = 0; y < L; y += 8) { x += (R() - 0.5) * 6; g.lineTo(x, y); } g.stroke(); }
    } else {
      for (let i = 0; i < 260; i++) { const x = W * (0.08 + R() * 0.84), y = H * (0.08 + R() * 0.84); const dx = x / W - 0.5, dy = y / H - 0.5; if (dx * dx + dy * dy > 0.2) continue; const v = 70 + R() * 90; g.fillStyle = `rgb(${v * 0.62},${v},${v * 0.38})`; g.save(); g.translate(x, y); g.rotate(R() * Math.PI); g.beginPath(); g.ellipse(0, 0, 9 + R() * 6, 4 + R() * 3, 0, 0, Math.PI * 2); g.fill(); g.restore(); }
    }
  }, { srgb: true });
}
function frondGeo() {
  return memo(GEO, 'frond', () => {
    const n = 12, pos = [], uv = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = t, y = 0.32 * t - 0.62 * t * t, w = t < 0.22 ? 0.02 : 0.2 * Math.sin(Math.PI * Math.min(1, (t - 0.22) / 0.78 * 0.92 + 0.08)), fold = w * 0.35;
      pos.push(x, y - fold, -w, x, y, 0, x, y - fold, w); uv.push(t, 0, t, 0.5, t, 1);
      if (i < n) { const a = i * 3; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
  });
}
const frondTex = () => ctex('frond', 512, 128, (g, W, H) => {
  const R = rng(77); g.clearRect(0, 0, W, H);
  for (let x = W * 0.22; x < W * 0.99; x += 5) { for (const s of [-1, 1]) { const v = 80 + R() * 60; g.strokeStyle = `rgb(${v * 0.6},${v},${v * 0.35})`; g.lineWidth = 3; g.beginPath(); g.moveTo(x, H / 2); g.quadraticCurveTo(x + 18, H / 2 + s * H * 0.3, x + 26 + R() * 8, H / 2 + s * H * (0.44 + R() * 0.05)); g.stroke(); } }
  g.strokeStyle = '#6d6b3a'; g.lineWidth = 6; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
});

const TREE_DEF = { oak: 9, live_oak: 9, pine: 18, palm: 9, shrub: 1.2 };
const TREES = await import('./trees.js').catch(() => null);   // instanced card trees (web/assets/trees.js) when present
export function tree(opts = {}) {
  if (TREES?.tree && opts.kind !== 'palm' && !opts.legacy) return TREES.tree(THREE, opts);
  let kind = opts.kind || 'oak'; if (kind === 'live_oak') kind = 'oak';
  const id = opts.id ?? `tree_${kind}`;
  const H = opts.height ?? TREE_DEF[kind] ?? 8;
  const R = rng(hash(id) ^ (opts.seed || 0) ^ Math.round(H * 100));
  const root = new THREE.Group();
  const segs = [], clumps = [], hang = [];
  const col = new THREE.Color();
  const seg = (a, b, r) => { segs.push({ a, b, r }); return b; };
  if (kind === 'oak') {
    const th = H * (0.2 + R() * 0.06), rT = H * 0.042;
    const tTop = V((R() - 0.5) * 0.4, th, (R() - 0.5) * 0.4);
    seg(V(0, 0, 0), tTop, rT);
    const nL = 5 + Math.floor(R() * 2);
    for (let i = 0; i < nL; i++) {
      const az = (i / nL) * Math.PI * 2 + R() * 0.6, el = 0.35 + R() * 0.45, len = H * (0.5 + R() * 0.18);
      let p = tTop.clone().add(V(0, -R() * th * 0.25, 0)), r = rT * 0.62;
      const dir = V(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
      const n = 4;
      for (let k = 0; k < n; k++) {
        const d = dir.clone(); d.y += (k - 1.2) * 0.12 + (R() - 0.5) * 0.25; d.x += (R() - 0.5) * 0.3; d.z += (R() - 0.5) * 0.3; d.normalize();
        const q = p.clone().addScaledVector(d, len / n); seg(p, q, r); r *= 0.72; p = q;
        if (k >= 1) { // sub-branch + foliage clump
          const sd = d.clone().add(V((R() - 0.5) * 1.2, 0.6 + R() * 0.5, (R() - 0.5) * 1.2)).normalize();
          const sq = p.clone().addScaledVector(sd, len * 0.28); seg(p, sq, r * 0.6);
          clumps.push({ p: sq, s: H * (0.13 + R() * 0.06) });
        }
        if (k >= 2) clumps.push({ p: p.clone().add(V(0, H * 0.04, 0)), s: H * (0.12 + R() * 0.07) });
        if (k >= 1 && opts.moss !== false && (opts.moss || opts.spanishMoss)) for (let m = 0; m < 3; m++) hang.push({ p: p.clone().lerp(q, R()).add(V(0, -r, 0)), l: 0.6 + R() * 1.3 });
      }
    }
    clumps.push({ p: tTop.clone().add(V(0, H * 0.32, 0)), s: H * 0.18 });
  } else if (kind === 'pine') {
    const rT = H * 0.02, lean = V((R() - 0.5) * 0.5, 0, (R() - 0.5) * 0.5);
    let p = V(0, 0, 0), r = rT;
    for (let k = 0; k < 4; k++) { const q = V(lean.x * (k + 1) / 4, H * (k + 1) / 4 * 0.97, lean.z * (k + 1) / 4); seg(p, q, r); r *= 0.86; p = q; }
    const c0 = H * 0.58;
    for (let y = c0; y < H * 0.97; y += H * 0.055) {
      const f = (y - c0) / (H - c0); const t = y / H;
      const base = V(lean.x * t, y, lean.z * t);
      const nb = 3 + Math.floor(R() * 2);
      for (let b = 0; b < nb; b++) {
        const az = R() * Math.PI * 2, len = H * (0.16 - f * 0.11) * (0.7 + R() * 0.5);
        const e = V(Math.cos(az) * len, len * 0.35, Math.sin(az) * len).add(base);
        seg(base, e, rT * 0.25);
        clumps.push({ p: e, s: H * (0.06 - f * 0.02) * (0.8 + R() * 0.5), flat: 0.55 });
      }
    }
    clumps.push({ p: V(lean.x, H * 0.97, lean.z), s: H * 0.05, flat: 0.8 });
    for (let i = 0; i < 4; i++) { const y = H * (0.3 + R() * 0.25), az = R() * 6.28; seg(V(lean.x * y / H, y, lean.z * y / H), V(lean.x * y / H + Math.cos(az) * 0.6, y + 0.15, lean.z * y / H + Math.sin(az) * 0.6), rT * 0.15); }
  } else if (kind === 'palm') {
    const th = H - 1.0, r0 = 0.22; const bend = V((R() - 0.5) * 0.8, 0, (R() - 0.5) * 0.8);
    let p = V(0, 0, 0);
    for (let k = 0; k < 6; k++) { const t = (k + 1) / 6; const q = V(bend.x * t * t, th * t, bend.z * t * t); seg(p, q, r0 * (1 - 0.15 * k / 6)); p = q; }
    root.userData.crown = p.toArray();
  } else { // shrub
    const n = 7 + Math.floor(R() * 4), w = H * 1.4;
    for (let i = 0; i < n; i++) { const a = R() * 6.28, rr = R() * w * 0.45; clumps.push({ p: V(Math.cos(a) * rr, H * (0.35 + R() * 0.25), Math.sin(a) * rr), s: H * (0.32 + R() * 0.15), flat: 0.85 }); }
  }
  // wood
  if (segs.length) {
    const im = new THREE.InstancedMesh(unitCyl(), kind === 'palm' ? palmTrunkMat() : M.bark(), segs.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = V();
    segs.forEach((g, i) => { const d = g.b.clone().sub(g.a); const L = d.length(); q.setFromUnitVectors(UP, d.normalize()); s.set(g.r, L * 1.04, g.r); m4.compose(g.a, q, s); im.setMatrixAt(i, m4); });
    im.castShadow = im.receiveShadow = true; im.name = 'wood'; root.add(im);
  }
  // foliage: alpha-clipped leaf-card clusters (alphaTest 0.5, alpha-tested shadows) + a small opaque dark core per
  // clump so dense crowns don't show sky through the middle. Instanced; 3 cluster variants per species.
  if (clumps.length) {
    const fk = kind === 'pine' ? 'pine' : kind === 'shrub' ? 'shrub' : 'oak';
    const spec = { oak: { cards: 30, flat: 0.72, size: 0.75, hollow: 0.2 }, pine: { cards: 22, flat: 0.5, size: 0.85, hollow: 0.15 }, shrub: { cards: 22, flat: 0.8, size: 0.7, hollow: 0.1 } }[fk];
    const groups = [0, 1, 2].map(v => clumps.filter((_, i) => i % 3 === v));
    // inner mass = a denser, darker leaf-card cluster (self-shadowed foliage), not an opaque smooth core: keeps the crown lacy
    const core = new THREE.InstancedMesh(memo(GEO, `fcore:${fk}`, () => foliageClusterGeometry({ ...spec, cards: Math.round(spec.cards * 0.6), size: 1.0, hollow: 0, seed: 91 + fk.length })), foliageMaterial(fk), clumps.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(); let ci = 0;
    groups.forEach((cl, v) => {
      if (!cl.length) return;
      const im = new THREE.InstancedMesh(memo(GEO, `fcluster:${fk}:${v}`, () => foliageClusterGeometry({ ...spec, seed: 11 + v * 5 + fk.length })), foliageMaterial(fk), cl.length);
      cl.forEach((c, i) => {
        q.setFromAxisAngle(UP, R() * 6.28);
        const sc = V(c.s * 1.15, c.s * 1.15 * (c.flat ?? 0.72) / spec.flat, c.s * 1.15);
        m4.compose(c.p, q, sc); im.setMatrixAt(i, m4);
        col.setRGB(0.72 + R() * 0.16, 0.76 + R() * 0.14, 0.66 + R() * 0.14); im.setColorAt(i, col);
        m4.compose(c.p, q, sc.multiplyScalar(0.6)); core.setColorAt(ci, col.multiplyScalar(0.5)); core.setMatrixAt(ci++, m4);
      });
      im.castShadow = im.receiveShadow = true; im.name = 'leaves'; root.add(im);
    });
    core.castShadow = core.receiveShadow = true; core.name = 'foliage_core'; root.add(core);
  }
  if (kind === 'palm') {
    const top = V(...root.userData.crown);
    mesh(sph(0.3, 12, 8), std('palmBoot', { color: 0x6b5a3c, roughness: 0.95 }), root, top.x, top.y - 0.2, top.z).scale.set(1, 1.6, 1);
    const nF = 16 + Math.floor(R() * 5), dead = opts.skirt === false ? 0 : 5;
    const t = frondTex();
    const im = new THREE.InstancedMesh(frondGeo(), std('frond', t ? { map: t, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 } : { color: 0x3f6a2a, side: THREE.DoubleSide, roughness: 0.8 }), nF + dead);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YZX');
    for (let i = 0; i < nF + dead; i++) {
      const isDead = i >= nF, az = (i / nF) * Math.PI * 2 * 2.618 + R() * 0.3;
      const pitch = isDead ? -1.1 - R() * 0.3 : 0.9 - (i / nF) * 1.4 + (R() - 0.5) * 0.3;
      const L = (isDead ? 1.9 : 2.4 + R() * 0.7) * H / 9;
      e.set(0, az, pitch); q.setFromEuler(e); m4.compose(top, q, V(L, L, L)); im.setMatrixAt(i, m4);
      col.setHSL(isDead ? 0.09 : 0.24 + (R() - 0.5) * 0.04, isDead ? 0.35 : 0.45, isDead ? 0.42 : 0.42 + R() * 0.2); im.setColorAt(i, col);
    }
    im.castShadow = im.receiveShadow = true; im.name = 'fronds'; root.add(im);
  }
  if (hang.length) {
    const tex = leafTex('moss');
    const im = new THREE.InstancedMesh(card(), std('moss', tex ? { map: tex, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.95, color: 0xb9c2ac } : { color: 0x8d9781, roughness: 0.95 }), hang.length * 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(); let i = 0;
    for (const h of hang) for (const ry of [0, Math.PI / 2]) { q.setFromAxisAngle(UP, ry + h.l); m4.compose(h.p.clone().add(V(0, -h.l / 2, 0)), q, V(0.45, h.l, 1)); im.setMatrixAt(i++, m4); }
    im.castShadow = true; im.name = 'moss'; root.add(im);
  }
  const measure = () => { root.updateMatrixWorld(true); const bb = new THREE.Box3(); root.traverse(o => { if (o.isInstancedMesh) { o.computeBoundingBox(); o.computeBoundingSphere(); bb.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld)); } else if (o.isMesh) bb.expandByObject(o); }); return bb; };
  let bb = measure();
  const k = H / Math.max(0.1, bb.max.y); // hit the requested overall height exactly
  if (Math.abs(k - 1) > 0.01) { const inner = new THREE.Group(); inner.name = id + '_inner'; while (root.children.length) inner.add(root.children[0]); inner.scale.setScalar(k); root.add(inner); bb = measure(); }
  return finish(root, 'tree', id, { length: +(bb.max.z - bb.min.z).toFixed(2), width: +(bb.max.x - bb.min.x).toFixed(2), height: +bb.max.y.toFixed(2) }, { kind });
}
const palmTrunkMat = () => texStd('palmTrunk', () => ctex('palmTrunk', 128, 256, (g, W, H) => {
  g.fillStyle = '#6e6250'; g.fillRect(0, 0, W, H); const R = rng(4);
  for (let y = 0; y < H; y += 16) for (let x = (y / 16 % 2) * 16; x < W + 16; x += 32) { g.fillStyle = `rgba(40,32,24,${0.4 + R() * 0.3})`; g.beginPath(); g.moveTo(x - 16, y); g.lineTo(x, y + 12); g.lineTo(x + 16, y); g.lineTo(x, y + 4); g.fill(); }
  noise(g, W, H, 18, 2);
}, { repeat: true }), 0x6e6250, { roughness: 0.95 });

// ================================================================= FENCE (barbed-wire pasture fence)
export function fence(opts = {}) {
  const id = opts.id ?? 'fence';
  const L = opts.length ?? 30;
  const pts = (opts.points && opts.points.length >= 2 ? opts.points : [[0, L / 2], [0, -L / 2]]).map(p => [+p[0], +p[1]]);
  const H = opts.height ?? 1.22, sp = opts.postSpacing ?? 3.0, strands = opts.strands ?? 4, every = opts.woodEvery ?? 4;
  const posts = []; // {x,z,wood}
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1]; const len = Math.hypot(x1 - x0, z1 - z0); const n = Math.max(1, Math.round(len / sp));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) { const t = k / n; posts.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, wood: k === 0 || k === n || k % every === 0 }); }
  }
  const root = new THREE.Group(); const R = rng(hash(id));
  const wood = posts.filter(p => p.wood), steel = posts.filter(p => !p.wood);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const wp = new THREE.InstancedMesh(memo(GEO, 'fencePost', () => { const c = new THREE.CylinderGeometry(0.06, 0.07, 1, 8); c.translate(0, 0.5, 0); return c; }), M.wood(), wood.length);
  wood.forEach((p, i) => { e.set((R() - 0.5) * 0.04, R() * 6, (R() - 0.5) * 0.04); q.setFromEuler(e); m4.compose(V(p.x, 0, p.z), q, V(1, H + 0.12, 1)); wp.setMatrixAt(i, m4); });
  wp.castShadow = wp.receiveShadow = true; root.add(wp);
  if (steel.length) {
    const tp = new THREE.InstancedMesh(memo(GEO, 'tPost', () => { const b = new THREE.BoxGeometry(0.035, 1, 0.012); b.translate(0, 0.5, 0); return b; }), std('tpost', { color: 0x2d4a32, metalness: 0.5, roughness: 0.5 }), steel.length);
    steel.forEach((p, i) => { e.set((R() - 0.5) * 0.05, R() * 0.3, (R() - 0.5) * 0.05); q.setFromEuler(e); m4.compose(V(p.x, 0, p.z), q, V(1, H, 1)); tp.setMatrixAt(i, m4); });
    tp.castShadow = true; root.add(tp);
  }
  // strands: 2 sagging sub-segments per bay
  const n = (posts.length - 1) * strands * 2;
  const wm = new THREE.InstancedMesh(memo(GEO, 'wireUnit', () => { const c = new THREE.CylinderGeometry(1, 1, 1, 4, 1, true); c.translate(0, 0.5, 0); return c; }), M.conductor(), Math.max(1, n));
  let i = 0;
  for (let s = 0; s < strands; s++) {
    const y = H * (0.35 + 0.63 * s / Math.max(1, strands - 1));
    for (let k = 0; k < posts.length - 1; k++) {
      const a = V(posts[k].x, y, posts[k].z), b = V(posts[k + 1].x, y, posts[k + 1].z), mid = a.clone().lerp(b, 0.5); mid.y -= 0.025;
      for (const [p0, p1] of [[a, mid], [mid, b]]) { const d = p1.clone().sub(p0); const l = d.length(); q.setFromUnitVectors(UP, d.normalize()); m4.compose(p0, q, V(0.004, l, 0.004)); wm.setMatrixAt(i++, m4); }
    }
  }
  wm.castShadow = false; root.add(wm);
  for (const o of [wp, wm]) { o.computeBoundingBox(); o.computeBoundingSphere(); }
  const bb = bboxPts(pts);
  return finish(root, 'fence', id, { length: +Math.max(0.15, bb.h).toFixed(2), width: +Math.max(0.15, bb.w).toFixed(2), height: H }, { posts: posts.length, origin: 'local coords of points' });
}

// ================================================================= PARKED VEHICLE
const VEH_DIMS = { sedan: [4.9, 1.9, 1.45], suv: [4.8, 1.95, 1.75], pickup: [5.9, 2.0, 1.9], van: [5.3, 2.0, 2.0], box_truck: [7.5, 2.5, 3.4], bus: [12.2, 2.55, 3.2], truck_tractor: [6.5, 2.5, 3.6], semitrailer: [16.2, 2.6, 4.1], motorcycle: [2.2, 0.8, 1.2], bicycle: [1.8, 0.6, 1.1] };
export function parkedVehicle(vehicleFactory, type = 'sedan', opts = {}) {
  let v = null;
  try { if (typeof vehicleFactory === 'function') v = vehicleFactory(type, { ...opts }); } catch (e) { v = null; }
  if (!v) {
    const [l, w, h] = VEH_DIMS[type] || VEH_DIMS.sedan;
    v = new THREE.Group(); mesh(new RoundedBoxGeometry(w, h, l, 2, 0.12), std('parkedFallback:' + (opts.color || 'gray'), { color: opts.color || 0x777b80, metalness: 0.5, roughness: 0.35 }), v, 0, h / 2, 0);
    finish(v, 'vehicle', opts.id ?? `parked_${type}`, { length: l, width: w, height: h }, { vehicleType: type });
  }
  if (typeof v.userData.setLights === 'function') v.userData.setLights(false);
  v.name = opts.id ?? v.name;
  v.userData.parked = true; v.userData.vehicleType = v.userData.vehicleType || type;
  v.userData.assetType = 'parkedVehicle';
  return v;
}

export const FURNITURE = { signal, sign, pole, streetlight, shelter, building, store, parkingLot, house, tree, fence, parkedVehicle };
export default FURNITURE;
