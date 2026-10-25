// Sightline road-furniture library (WORLD CONTRACT v2). Shared by browser + Node.
// Conventions: meters, Y up, ground y=0, rotation.y=0 => the object's FACE (sign face, signal lenses,
// building front, shelter opening) points -Z (north). Rotate by Math.PI to serve northbound traffic.
// Arms (signal mast arm, streetlight arm) reach along +X from the pole, which stands at the origin.
// Canvas textures are created lazily and only when a DOM exists; in Node every material falls back
// to a plain PBR colour so geometry (used for ray-cast checks) is identical in both environments.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

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
  glass: () => std('glass', { color: 0xd6e6ea, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
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
  const fr = std('shelterFrame', { color: 0x4a4d50, metalness: 0.8, roughness: 0.35 });
  const post = 0.07, x0 = -W / 2 + post / 2, x1 = W / 2 - post / 2, zb = D / 2 - post / 2, zf = -D / 2 + post / 2;
  mesh(box(W + 0.4, 0.12, D + 0.5), M.concrete(), root, 0, 0.06, 0); // pad
  const posts = [[x0, zb], [x1, zb], [0, zb], [x0, zf], [x1, zf]];
  for (const [x, z] of posts) mesh(box(post, H - 0.12, post), fr, root, x, 0.12 + (H - 0.12) / 2 - 0.08, z);
  // roof: slight back-fall, deep fascia
  const roof = mesh(box(W + 0.3, 0.06, D + 0.45), std('shelterRoof', { color: 0x9aa0a3, metalness: 0.6, roughness: 0.4 }), root, 0, H - 0.05, -0.1);
  roof.rotation.x = -0.05;
  mesh(box(W + 0.32, 0.18, 0.04), fr, root, 0, H - 0.03, -D / 2 - 0.34);
  // glass: back (2 bays) + ends; front open unless open:false
  const gl = M.glass();
  const glassPanel = (w, h, x, y, z, ry = 0) => { const m = mesh(box(w, h, 0.012), gl, root, x, y, z, false); m.rotation.y = ry; m.userData.seeThrough = true; m.renderOrder = 2; return m; };
  const gh = H - 0.5, gy = 0.25 + gh / 2;
  glassPanel(W / 2 - post, gh, -W / 4, gy, zb);
  glassPanel(W / 2 - post, gh, W / 4, gy, zb);
  glassPanel(D - post, gh, x0, gy, 0, Math.PI / 2);
  if (opts.open === false) { glassPanel(W * 0.3, gh, x0 + W * 0.15, gy, zf); glassPanel(W * 0.3, gh, x1 - W * 0.15, gy, zf); }
  for (const y of [0.25, 0.25 + gh]) { mesh(box(W - post, 0.04, 0.04), fr, root, 0, y, zb); mesh(box(0.04, 0.04, D - post), fr, root, x0, y, 0); }
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
    return new THREE.MeshStandardMaterial({ color: t ? 0xffffff : fb, map: t, roughness: 0.85, side: THREE.FrontSide, shadowSide: THREE.DoubleSide, ...p });
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
  else { m.rotation.order = 'YZX'; m.rotation.y = Math.PI / 2; m.rotation.z = Math.atan2(dy, du); m.position.set(0, cy, cu); }
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
  if (o.awning !== false) { const aw = std('awning', { color: 0x2f4f5f, roughness: 0.7 }); mesh(box(w - 0.6, 0.12, 1.1), aw, root, 0, 3.2, -d / 2 - 0.55); }
  mesh(box(w + 0.6, 0.12, 2.0), M.concrete(), root, 0, 0.06, -d / 2 - 1.0);
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
  if (style === 'store' || style === 'generic') style = 'commercial';
  const D = { commercial: [18, 14, 5.2], house: [12, 9, 2.9], gas_station: [24, 30, 4.5], barn: [10, 16, 4.2] }[style] || [12, 10, 5];
  const w = opts.w ?? D[0], d = opts.d ?? D[1], h = opts.h ?? D[2];
  const root = new THREE.Group();
  ({ house: buildHouse, gas_station: buildGas, barn: buildBarn }[style] || buildCommercial)(root, w, d, h, { ...opts, id });
  const bb = new THREE.Box3().setFromObject(root);
  return finish(root, 'building', id, { length: d, width: w, height: +bb.max.y.toFixed(2) }, { style, footprint: { x: w, z: d } });
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
export function tree(opts = {}) {
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
  // foliage blobs (instanced, per-clump colour variation)
  const palette = { oak: [0.27, 0.42, 0.13, 0.2], pine: [0.25, 0.35, 0.13, 0.2], shrub: [0.27, 0.45, 0.16, 0.24] }[kind];
  if (clumps.length) {
    const groups = [0, 1, 2].map(v => clumps.filter((_, i) => i % 3 === v));
    groups.forEach((cl, v) => {
      if (!cl.length) return;
      const im = new THREE.InstancedMesh(blobGeo(v), std('foliage', { color: 0xffffff, roughness: 0.88 }), cl.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
      cl.forEach((c, i) => {
        q.setFromAxisAngle(UP, R() * 6.28);
        m4.compose(c.p, q, V(c.s, c.s * (c.flat ?? 0.72), c.s)); im.setMatrixAt(i, m4);
        col.setHSL(palette[0] + (R() - 0.5) * 0.04, palette[1] + (R() - 0.5) * 0.1, palette[2] + R() * (palette[3] - palette[2]) * 0.6); im.setColorAt(i, col);
      });
      im.castShadow = im.receiveShadow = true; im.name = 'foliage'; root.add(im);
    });
    // leaf cards break up the silhouette (browser only)
    const tex = leafTex(kind === 'pine' ? 'pine' : 'broad');
    if (tex) {
      const per = kind === 'shrub' ? 22 : 18, n = clumps.length * per;
      const im = new THREE.InstancedMesh(card(), std('leafCard:' + kind, { map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85 }), n);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(); let i = 0;
      for (const c of clumps) for (let k = 0; k < per; k++) {
        const u = R() * 2 - 1, a = R() * 6.28, rr = Math.sqrt(1 - u * u), fl = c.flat ?? 0.72;
        const p = V(rr * Math.cos(a) * c.s * 1.02, u * c.s * fl * 1.02, rr * Math.sin(a) * c.s * 1.02).add(c.p);
        e.set(R() * 6.28, R() * 6.28, R() * 6.28); q.setFromEuler(e); const sz = c.s * (kind === 'pine' ? 0.9 : 0.75) * (0.7 + R() * 0.6);
        m4.compose(p, q, V(sz, sz, sz)); im.setMatrixAt(i, m4);
        col.setHSL(palette[0] + (R() - 0.5) * 0.05, palette[1] + 0.05, 0.42 + R() * 0.25); im.setColorAt(i++, col);
      }
      im.castShadow = true; im.receiveShadow = true; im.name = 'leaves'; root.add(im);
    }
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
  root.updateMatrixWorld(true);
  const bb = new THREE.Box3(); root.traverse(o => { if (o.isInstancedMesh) { o.computeBoundingBox(); o.computeBoundingSphere(); bb.union(o.boundingBox); } else if (o.isMesh) bb.expandByObject(o); });
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

export const FURNITURE = { signal, sign, pole, streetlight, shelter, building, tree, fence, parkedVehicle };
export default FURNITURE;
