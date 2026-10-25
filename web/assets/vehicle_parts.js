// Sightline asset library — shared vehicle parts (browser + Node, no DOM / no imports at load).
// Owner: VEH-CARS. Imported by vehicles.js, vehicles_heavy.js, vehicles_small.js.
//
// API (all take the THREE namespace as first arg; everything is cached per THREE instance):
//   getMaterials(THREE) -> { paint(color), glass, glassDark, rubber, tread, chrome, alloy, steelRim, truckRim, trim, trimGloss,
//                            plastic, underbody, interior, lightHead, lightTail, lightHeadOn, lightTailOn, lightAmber,
//                            lightAmberOn, lightRev, plate, plateText, brake, mirror }
//   makeWheel(THREE, {radius, width, rim:'alloy'|'steel'|'truck', dual, side:'right'|'left'}) -> Group
//       axle along X, centre at origin. Outboard face points +X ('right') or -X ('left').
//       wheel.userData.spin = inner Object3D to rotate; wheel.userData.roll(distanceMeters) rolls it forward (-Z).
//       dual:true builds a twin-tyre set (total width = 2*width + 0.03), centred on origin.
//   loft(THREE, spec) -> BufferGeometry  (smooth lofted body shell; see function doc)
//   roundedBox(THREE, w, h, d, r) -> cached BufferGeometry (ExtrudeGeometry with bevel), centred.
//   makeLamp(THREE, {name, kind:'head'|'tail'|'amber', w, h, d}) -> Mesh named `name` (e.g. 'headlight_L')
//   attachLightAPI(THREE, root, {spot=true, spotIntensity, headY, frontZ}) -> sets root.userData.setLights(on, opts)
//   finalizeVehicle(THREE, root, {type, id, dims, driverEye, wheels}) -> root (name, userData, shadows, setLights, roll)

const CACHE = new WeakMap();
function cache(THREE) {
  let c = CACHE.get(THREE);
  if (!c) { c = { mats: null, paints: new Map(), geo: new Map() }; CACHE.set(THREE, c); }
  return c;
}
export function cachedGeo(THREE, key, build) {
  const c = cache(THREE);
  let g = c.geo.get(key);
  if (!g) { g = build(); c.geo.set(key, g); }
  return g;
}

// ---------------------------------------------------------------- materials
const NAMED = {
  white: 0xe9eaea, black: 0x0f1012, silver: 0xa9adb2, gray: 0x6b6f74, grey: 0x6b6f74, darkgray: 0x3c3f43, charcoal: 0x2e3135,
  red: 0x9b1b1e, maroon: 0x5a1416, blue: 0x1d3f7a, navy: 0x17233f, lightblue: 0x7c9cc0, green: 0x24452f, darkgreen: 0x1c3324,
  yellow: 0xd9a91f, gold: 0xb0915a, orange: 0xc4561d, brown: 0x4a3426, beige: 0xc8b996, tan: 0xb59f7a, champagne: 0xc9b99a,
  bronze: 0x6e5236, purple: 0x3d2a52,
};
export function parseColor(THREE, color) {
  if (color instanceof THREE.Color) return color.clone();
  if (typeof color === 'number') return new THREE.Color(color);
  if (typeof color === 'string') {
    const k = color.trim().toLowerCase().replace(/[\s_-]/g, '');
    if (NAMED[k] != null) return new THREE.Color(NAMED[k]);
    try { return new THREE.Color(color.trim().toLowerCase()); } catch { /* fall through */ }
  }
  return new THREE.Color(NAMED.silver);
}

export function getMaterials(THREE) {
  const c = cache(THREE);
  if (c.mats) return c.mats;
  const Phys = THREE.MeshPhysicalMaterial || THREE.MeshStandardMaterial;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const m = {
    glass: new Phys({ color: 0x0a1014, metalness: 0.0, roughness: 0.04, transparent: true, opacity: 0.94, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4 }),
    glassDark: new Phys({ color: 0x07090b, metalness: 0.0, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03 }),
    rubber: std({ color: 0x1b1c1e, roughness: 0.88, metalness: 0 }),
    tread: std({ color: 0x121314, roughness: 0.95, metalness: 0 }),
    chrome: std({ color: 0xe2e4e6, roughness: 0.12, metalness: 1.0 }),
    alloy: std({ color: 0xb9bdc2, roughness: 0.3, metalness: 0.85 }),
    steelRim: std({ color: 0x8d9095, roughness: 0.45, metalness: 0.6 }),
    truckRim: std({ color: 0xd2d5d8, roughness: 0.22, metalness: 0.95 }),
    trim: std({ color: 0x18191b, roughness: 0.62, metalness: 0 }),
    trimGloss: new Phys({ color: 0x0b0c0d, roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 }),
    plastic: std({ color: 0x2a2c2f, roughness: 0.75, metalness: 0 }),
    underbody: std({ color: 0x0c0d0e, roughness: 0.95, metalness: 0 }),
    interior: std({ color: 0x0a0b0c, roughness: 0.95, metalness: 0, envMapIntensity: 0.3 }),
    brake: std({ color: 0x55585c, roughness: 0.5, metalness: 0.7 }),
    mirror: std({ color: 0x9aa3ab, roughness: 0.02, metalness: 1.0 }),
    lightHead: new Phys({ color: 0x5d646b, roughness: 0.08, metalness: 0.85, clearcoat: 1, clearcoatRoughness: 0.02, emissive: 0x000000 }),
    lightHeadOn: std({ color: 0xffffff, roughness: 0.2, metalness: 0, emissive: 0xfff6e8, emissiveIntensity: 6 }),
    lightTail: new Phys({ color: 0x6e0a0e, roughness: 0.12, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, emissive: 0x1a0000 }),
    lightTailOn: std({ color: 0xff2a2a, roughness: 0.3, metalness: 0, emissive: 0xff1010, emissiveIntensity: 4 }),
    lightAmber: new Phys({ color: 0xa8640f, roughness: 0.12, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03 }),
    lightAmberOn: std({ color: 0xffa020, roughness: 0.3, emissive: 0xff8a00, emissiveIntensity: 3 }),
    lightRev: std({ color: 0xdadde0, roughness: 0.1, metalness: 0.5 }),
    plate: std({ color: 0xf1f1ec, roughness: 0.45, metalness: 0.1 }),
    seat: std({ color: 0x1e2024, roughness: 0.9, metalness: 0 }),
    dash: std({ color: 0x15171a, roughness: 0.85, metalness: 0 }),
    steering: std({ color: 0x0e0f11, roughness: 0.7, metalness: 0 }),
    cabinLining: std({ color: 0x1a1c1f, roughness: 0.92, metalness: 0, side: THREE.BackSide }),
    glassTint: new Phys({ color: 0x1a232b, metalness: 0, roughness: 0.05, transmission: 0.7, thickness: 0.004, ior: 1.5,
      transparent: true, opacity: 1, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.2, side: THREE.DoubleSide, depthWrite: false }),
    plateText: std({ color: 0x9aa0a6, roughness: 0.6, metalness: 0 }),
  };
  m.paint = (color) => {
    const col = parseColor(THREE, color);
    const key = col.getHexString();
    let p = c.paints.get(key);
    if (!p) {
      // clearcoat automotive paint; metalness kept modest so it reads correctly with or without an env map
      const hsl = {}; col.getHSL(hsl);
      // forensic-standard clearcoat paint (metalness 0.4 / roughness 0.25 / clearcoat 1 / cc-roughness 0.05);
      // very light solids (white) keep a lower metalness so they still read white under weak IBL
      const metal = hsl.l > 0.78 ? 0.15 : 0.4;
      p = new Phys({ color: col, metalness: metal, roughness: 0.25, clearcoat: 1.0, clearcoatRoughness: 0.05, envMapIntensity: 1.0 });
      p.name = 'paint_' + key;
      c.paints.set(key, p);
    }
    return p;
  };
  for (const [k, v] of Object.entries(m)) if (v && v.isMaterial) v.name = k;
  c.mats = m;
  return m;
}

// ---------------------------------------------------------------- geometry helpers
export function roundedBox(THREE, w, h, d, r = 0.02, seg = 3) {
  const key = `rbox|${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}|${r.toFixed(4)}|${seg}`;
  return cachedGeo(THREE, key, () => {
    r = Math.max(0.0005, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
    const s = new THREE.Shape();
    const x0 = -w / 2 + r, x1 = w / 2 - r, y0 = -h / 2 + r, y1 = h / 2 - r;
    s.moveTo(x0, -h / 2); s.lineTo(x1, -h / 2); s.absarc(x1, y0, r, -Math.PI / 2, 0, false);
    s.lineTo(w / 2, y1); s.absarc(x1, y1, r, 0, Math.PI / 2, false);
    s.lineTo(x0, h / 2); s.absarc(x0, y1, r, Math.PI / 2, Math.PI, false);
    s.lineTo(-w / 2, y0); s.absarc(x0, y0, r, Math.PI, Math.PI * 1.5, false);
    const depth = Math.max(1e-4, d - 2 * r);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: r, bevelSize: r * 0.999, bevelOffset: -r * 0.999, bevelSegments: seg, curveSegments: seg * 2 });
    g.translate(0, 0, -depth / 2);
    g.computeVertexNormals();
    return g;
  });
}

function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
export { smoothstep };

// Piecewise monotone-cubic interpolation over [[x,y],...] sorted by x.
export function curve(pts) {
  const n = pts.length, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const d = new Array(n - 1), m = new Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / Math.max(1e-9, xs[i + 1] - xs[i]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = (d[i - 1] * d[i] <= 0) ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/**
 * loft(THREE, spec): smooth shell lofted along Z through superellipse cross-sections.
 * spec = {
 *   stations: [z...] sorted ascending (front = most negative),
 *   section(z) -> { yb, yt, hw, cx=0, n=4 (squareness, higher = boxier), nTop?, nBot?, tumble=0 (fractional width loss at top),
 *                   flare=0 (fractional width loss at bottom) },
 *   ring = 40 (points around), open=false (true = open at bottom: only the upper half ring, e.g. greenhouse),
 *   sinkY = 0 (open shells: extend the lower edge down by this much),
 *   material(zMid, theta, yMid, iStation) -> group index (0..k), default 0
 *   caps = true (close ends with fans; ignored for open)
 * }
 * theta: ring angle, 0 = +X side middle, PI/2 = top, PI = -X side, -PI/2 (=3PI/2) = bottom.
 */
export function loft(THREE, spec) {
  const st = spec.stations, N = st.length, M = spec.ring || 40, open = !!spec.open;
  const pos = [], uvs = [];
  const ringT = [];
  if (open) {
    for (let j = 0; j <= M; j++) ringT.push(-0.12 + (Math.PI + 0.24) * (j / M)); // slightly past horizontal both sides
  } else {
    for (let j = 0; j < M; j++) ringT.push((j / M) * Math.PI * 2);
  }
  let R = ringT.length;
  const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
  const crisp = !open && spec.section(st[0]).crisp;
  if (crisp) { const r0 = crispRing(spec.section(st[0])); ringT.length = 0; for (const p of r0) ringT.push(p[2]); R = ringT.length; }
  for (let i = 0; i < N; i++) {
    const z = st[i], s = spec.section(z);
    if (crisp) {
      const ring = crispRing(s);
      for (let j = 0; j < R; j++) {
        let [x, y] = ring[j];
        if (spec.clampY) y = spec.clampY(z, x, y);
        pos.push(x, y, z); uvs.push(j / (R - 1), i / (N - 1));
      }
      continue;
    }
    const yc = (s.yb + s.yt) / 2, hh = Math.max(1e-4, (s.yt - s.yb) / 2), cx = s.cx || 0;
    const nTop = s.nTop || s.n || 4, nBot = s.nBot || s.n || 4;
    for (let j = 0; j < R; j++) {
      const t = ringT[j], ct = Math.cos(t), stt = Math.sin(t);
      const n = stt >= 0 ? nTop : nBot;
      let y = yc + hh * spow(stt, 2 / n);
      let x = s.hw * spow(ct, 2 / n);
      const fy = (y - s.yb) / (2 * hh);
      x *= 1 - (s.tumble || 0) * fy * fy - (s.flare || 0) * (1 - fy) * (1 - fy);
      if (open && stt < 0) y = s.yb - (spec.sinkY || 0) * Math.min(1, -stt / 0.12);
      if (spec.clampY) y = spec.clampY(z, cx + x, y);
      pos.push(cx + x, y, z);
      uvs.push(j / (R - 1), i / (N - 1));
    }
  }
  const groups = new Map();
  const addTri = (g, a, b, c) => { let arr = groups.get(g); if (!arr) groups.set(g, arr = []); arr.push(a, b, c); };
  const matFn = spec.material || (() => 0);
  const segs = open ? R - 1 : R;
  for (let i = 0; i < N - 1; i++) {
    const zMid = (st[i] + st[i + 1]) / 2;
    for (let j = 0; j < segs; j++) {
      const j2 = (j + 1) % R;
      const a = i * R + j, b = i * R + j2, c = (i + 1) * R + j, d = (i + 1) * R + j2;
      let tMid = (ringT[j] + (open ? ringT[j2] : (j2 === 0 ? Math.PI * 2 : ringT[j2]))) / 2;
      const yMid = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1] + pos[d * 3 + 1]) / 4;
      const g = matFn(zMid, tMid, yMid, i);
      // outward winding: ring goes CCW seen from +Z (front of ring toward -Z) -> faces (a,c,b),(b,c,d)
      addTri(g, a, b, c); addTri(g, b, d, c);
    }
  }
  if (!open && spec.caps !== false) {
    for (const [i, flip] of [[0, true], [N - 1, false]]) {
      let sx = 0, sy = 0; const z = st[i];
      for (let j = 0; j < R; j++) { sx += pos[(i * R + j) * 3]; sy += pos[(i * R + j) * 3 + 1]; }
      const ci = pos.length / 3; pos.push(sx / R, sy / R, z); uvs.push(0.5, i ? 1 : 0);
      const g = spec.capMaterial ? spec.capMaterial(i === 0 ? 'front' : 'rear') : 0;
      for (let j = 0; j < R; j++) {
        const a = i * R + j, b = i * R + (j + 1) % R;
        if (flip) addTri(g, a, ci, b); else addTri(g, a, b, ci);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const idx = []; let start = 0;
  for (const g of [...groups.keys()].sort((a, b) => a - b)) {
    const arr = groups.get(g); idx.push(...arr); geo.addGroup(start, arr.length, g); start += arr.length;
  }
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------- crisp sections (flat panels, defined creases)
// s.crisp = { crease: 0..1 (height fraction of the beltline/shoulder crease = max width), tuck: rocker tuck-in (fraction of hw),
//             shoulder: top-edge inset (fraction of hw), crown: hood/roof crown (m), r: [rocker, lowerSide, crease, shoulder, top] fillet radii (m) }
// Fixed topology (same vertex count at every station). Returns ring [[x, y, t], ...] with t in [0, 2PI) as in loft
// (0 = +X side, PI/2 = top), starting near t = 0 and running CCW (up over the top).
const CRISP_SEG = [3, 1, 4, 3, 2, 5];   // straight-run subdivisions between the 7 key points
const CRISP_FIL = 4;                    // points per fillet
function filletPolyline(P, radii) {
  const out = [];
  const seg = (a, b, n, from0) => { for (let k = from0 ? 0 : 1; k <= n; k++) { const f = k / n; out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); } };
  // trim points for each interior vertex
  const cuts = P.map((B, i) => {
    if (i === 0 || i === P.length - 1) return null;
    const A = P[i - 1], C = P[i + 1];
    const la = Math.hypot(A[0] - B[0], A[1] - B[1]), lc = Math.hypot(C[0] - B[0], C[1] - B[1]);
    const d = Math.max(1e-5, Math.min(radii[i - 1] || 0.01, la * 0.45, lc * 0.45));
    return { a: [B[0] + (A[0] - B[0]) * d / la, B[1] + (A[1] - B[1]) * d / la], c: [B[0] + (C[0] - B[0]) * d / lc, B[1] + (C[1] - B[1]) * d / lc], B };
  });
  let cur = P[0]; out.push(cur.slice());
  for (let i = 1; i < P.length; i++) {
    const end = cuts[i] ? cuts[i].a : P[i];
    seg(cur, end, CRISP_SEG[i - 1] || 2, false);
    if (cuts[i]) {
      const { a, c, B } = cuts[i];
      for (let k = 1; k <= CRISP_FIL; k++) { const t = k / (CRISP_FIL + 1), u = 1 - t; out.push([u * u * a[0] + 2 * u * t * B[0] + t * t * c[0], u * u * a[1] + 2 * u * t * B[1] + t * t * c[1]]); }
      out.push(c.slice()); cur = c;
    } else cur = end;
  }
  return out;
}
export function crispHalf(s) {
  const c = s.crisp, yb = s.yb, yt = s.yt, hw = s.hw, h = Math.max(1e-3, yt - yb);
  const yc = yb + (c.crease ?? 0.82) * h;
  const tuck = c.tuck ?? 0.05, sh = c.shoulder ?? 0.07, crown = c.crown ?? 0.01;
  const topY = yt - crown;
  const P = [
    [0, yb],
    [hw * (1 - tuck) - Math.min(0.08, h * 0.12), yb],
    [hw * (1 - tuck * 0.6), yb + Math.min(0.1, h * 0.16)],
    [hw, yc],
    [hw * (1 - sh * 0.75), Math.max(yc + 0.01, topY - Math.min(0.02, h * 0.03))],
    [hw * (1 - sh) - Math.min(0.12, hw * 0.14), topY],
    [0, yt],
  ];
  return filletPolyline(P, c.r || [0.05, 0.12, 0.018, 0.05, 0.2]);
}
const RING_CACHE = new WeakMap();
export function crispRing(s) {
  if (RING_CACHE.has(s)) return RING_CACHE.get(s);
  const H = crispHalf(s), cx = s.cx || 0;
  const yb = s.yb, yt = s.yt, ycen = (yb + yt) / 2, hh = Math.max(1e-4, (yt - yb) / 2), hw = Math.max(1e-4, s.hw);
  const tOf = (x, y) => { let t = Math.atan2((y - ycen) / hh, x / hw); if (t < 0) t += Math.PI * 2; return t; };
  // right half bottom->top, then left half top->bottom (skip the shared centre points)
  const full = [];
  for (const p of H) full.push([p[0], p[1]]);
  for (let k = H.length - 2; k >= 1; k--) full.push([-H[k][0], H[k][1]]);
  // rotate so the ring starts at the right-side point nearest t = 0 and t increases CCW (up over the top)
  let i0 = 0, best = 1e9;
  for (let k = 0; k < H.length; k++) { const d = Math.abs(full[k][1] - ycen); if (d < best) { best = d; i0 = k; } }
  const ring = [];
  for (let k = 0; k < full.length; k++) {
    const p = full[(i0 + k) % full.length];
    let t = tOf(p[0], p[1]);
    if (k === 0) t = 0; else if (t < ring[k - 1][2] - 1e-6) t += Math.PI * 2;  // keep monotonic
    if (t >= Math.PI * 2 - 1e-6 && k > 0 && k === full.length - 1) t = Math.min(t, Math.PI * 2 - 1e-4);
    ring.push([cx + p[0], p[1], Math.min(t, Math.PI * 2 - 1e-4)]);
  }
  RING_CACHE.set(s, ring);
  return ring;
}
/** x of a crisp section's right-hand surface at height y (max over the profile). */
export function crispX(s, y) {
  const H = crispHalf(s);
  let best = 0;
  for (let k = 0; k < H.length - 1; k++) {
    const a = H[k], b = H[k + 1];
    if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) { const f = (y - a[1]) / (b[1] - a[1]); best = Math.max(best, a[0] + (b[0] - a[0]) * f); }
  }
  return best;
}

// point on a loft section (same formula as loft); t = ring angle; off = outward offset (m)
export function sectionPoint(s, t, off = 0) {
  if (s.crisp) {
    const ring = crispRing(s);
    const tt = ((t % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    let k = 0; while (k < ring.length - 1 && ring[k + 1][2] < tt) k++;
    const a = ring[k], b = ring[(k + 1) % ring.length];
    const tb = k + 1 < ring.length ? b[2] : Math.PI * 2;
    const f = Math.max(0, Math.min(1, (tt - a[2]) / Math.max(1e-6, tb - a[2])));
    let x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
    // outward offset along the segment normal
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    x += (dy / l) * off; y += (-dx / l) * off;
    return [x, y];
  }
  const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
  const yb = s.yb - off, yt = s.yt + off, hw = s.hw + off;
  const yc = (yb + yt) / 2, hh = Math.max(1e-4, (yt - yb) / 2);
  const st = Math.sin(t), n = st >= 0 ? (s.nTop || s.n || 4) : (s.nBot || s.n || 4);
  const y = yc + hh * spow(st, 2 / n);
  let x = hw * spow(Math.cos(t), 2 / n);
  const fy = (y - yb) / (2 * hh);
  x *= 1 - (s.tumble || 0) * fy * fy - (s.flare || 0) * (1 - fy) * (1 - fy);
  return [(s.cx || 0) + x, y];
}

/** surfacePatch: a conforming skin patch over a loft (lamps, badges-free trim, decals).
 *  spec = { stations:[z...], section(z), range(z) -> [t0, t1] | null, nT = 8, off = 0.004 } */
export function surfacePatch(THREE, spec) {
  const nT = spec.nT || 8, off = spec.off ?? 0.004, pos = [], idx = [];
  let rows = 0;
  for (const z of spec.stations) {
    const r = spec.range(z); if (!r) continue;
    const sct = spec.section(z);
    for (let k = 0; k <= nT; k++) { const t = r[0] + (r[1] - r[0]) * (k / nT); const [x, y] = sectionPoint(sct, t, off); pos.push(x, y, z); }
    rows++;
  }
  for (let i = 0; i < rows - 1; i++) for (let k = 0; k < nT; k++) {
    const a = i * (nT + 1) + k, b = a + 1, c = a + nT + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- wheels
const RIM_RATIO = { alloy: 0.66, steel: 0.6, truck: 0.56 };

function wheelGeos(THREE, R, W, rim) {
  const key = `wheel|${R.toFixed(3)}|${W.toFixed(3)}|${rim}`;
  return cachedGeo(THREE, key, () => {
    const rr = R * (RIM_RATIO[rim] || 0.64);
    const hw = W / 2;
    const side = Math.min(R - rr, W * 0.5);
    // tyre cross-section (r, axial y), lathe around Y then rotate to X axis
    const tp = [];
    const sh = Math.min(side * 0.35, hw * 0.35);
    tp.push(new THREE.Vector2(rr * 0.98, -hw * 0.86));
    tp.push(new THREE.Vector2(rr + side * 0.18, -hw * 0.97));
    tp.push(new THREE.Vector2(rr + side * 0.55, -hw * 1.0));
    tp.push(new THREE.Vector2(R - sh, -hw * 0.97));
    for (let k = 1; k <= 4; k++) { const a = (k / 5) * Math.PI / 2; tp.push(new THREE.Vector2(R - sh + Math.sin(a) * sh, -hw + sh * (1 - Math.cos(a)) * 0.9 + 0.0)); }
    // crown with 3 circumferential tread grooves (reads as tread in close-ups / low witness views)
    { const a0 = -hw + sh, a1 = hw - sh, gd = Math.min(0.009, R * 0.025), gw = (a1 - a0) * 0.045;
      tp.push(new THREE.Vector2(R, a0));
      for (const f of [0.25, 0.5, 0.75]) {
        const c = a0 + (a1 - a0) * f;
        tp.push(new THREE.Vector2(R, c - gw), new THREE.Vector2(R - gd, c - gw * 0.7), new THREE.Vector2(R - gd, c + gw * 0.7), new THREE.Vector2(R, c + gw));
      }
      tp.push(new THREE.Vector2(R, a1)); }
    for (let k = 4; k >= 1; k--) { const a = (k / 5) * Math.PI / 2; tp.push(new THREE.Vector2(R - sh + Math.sin(a) * sh, hw - sh * (1 - Math.cos(a)) * 0.9)); }
    tp.push(new THREE.Vector2(R - sh, hw * 0.97));
    tp.push(new THREE.Vector2(rr + side * 0.55, hw * 1.0));
    tp.push(new THREE.Vector2(rr + side * 0.18, hw * 0.97));
    tp.push(new THREE.Vector2(rr * 0.98, hw * 0.86));
    const tire = new THREE.LatheGeometry(tp, 48);
    // rim barrel + face (outboard = +y before rotation -> +X after)
    const lip = hw * 0.86;
    const rp = [
      new THREE.Vector2(rr * 0.9, -lip * 0.9), new THREE.Vector2(rr, -lip), new THREE.Vector2(rr * 1.02, -lip * 0.94),
      new THREE.Vector2(rr * 0.97, -lip * 0.6), new THREE.Vector2(rr * 0.97, lip * 0.75),
      new THREE.Vector2(rr * 1.03, lip * 0.92), new THREE.Vector2(rr * 1.02, lip * 1.0), new THREE.Vector2(rr * 0.95, lip * 0.98),
    ];
    const face = [];
    const dish = rim === 'truck' ? -lip * 0.55 : rim === 'steel' ? lip * 0.25 : lip * 0.45;
    face.push(new THREE.Vector2(rr * 0.95, lip * 0.98));
    face.push(new THREE.Vector2(rr * 0.9, lip * 0.86));
    face.push(new THREE.Vector2(rr * 0.82, dish + (lip - dish) * 0.35));
    face.push(new THREE.Vector2(rr * 0.5, dish));
    face.push(new THREE.Vector2(rr * 0.3, dish + lip * 0.06));
    face.push(new THREE.Vector2(rr * 0.22, dish + lip * 0.14));
    face.push(new THREE.Vector2(rr * 0.1, dish + lip * 0.18));
    face.push(new THREE.Vector2(0.0001, dish + lip * 0.18));
    const barrel = new THREE.LatheGeometry(rp, 36);
    let faceG;
    if (rim === 'alloy') {
      // inner barrel dark, face built from spokes
      faceG = new THREE.LatheGeometry([new THREE.Vector2(rr * 0.24, dish + lip * 0.16), new THREE.Vector2(rr * 0.16, dish + lip * 0.22), new THREE.Vector2(0.0001, dish + lip * 0.24)], 24);
    } else {
      faceG = new THREE.LatheGeometry(face.slice().reverse(), 36);
    }
    const geos = { tire, barrel, face: faceG, rr, lip, dish };
    // spokes (alloy): 5 twin spokes as tapered boxes in the rim face plane
    if (rim === 'alloy') {
      const sw = rr * 0.16, len = rr * 0.78;
      const sp = new THREE.BufferGeometry();
      const parts = [];
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 + ((k % 2) ? 0.13 : -0.13);
        const b = new THREE.BoxGeometry(sw * 0.62, len, rr * 0.07);
        b.translate(0, rr * 0.2 + len / 2, 0);
        // twist outer end toward the lip for a concave look
        const p = b.attributes.position;
        for (let v = 0; v < p.count; v++) {
          const yy = p.getY(v), f = (yy - rr * 0.2) / len;
          p.setX(v, p.getX(v) * (1.15 - 0.35 * f));
          p.setZ(v, p.getZ(v) + (dish + lip * 0.16) * (1 - f) + (lip * 0.9) * f);
        }
        b.rotateZ(a);
        parts.push(b);
      }
      geos.spokes = mergeSimple(THREE, parts);
      geos.disc = new THREE.CylinderGeometry(rr * 0.78, rr * 0.78, 0.025, 28).rotateX(Math.PI / 2).translate(0, 0, dish - 0.03);
      geos.caliper = new THREE.BoxGeometry(rr * 0.35, rr * 0.55, 0.05).translate(rr * 0.55, rr * 0.1, dish - 0.06);
    }
    // holes / lugs for steel & truck
    if (rim === 'steel' || rim === 'truck') {
      const holes = [], lugs = [];
      const nH = rim === 'truck' ? 10 : 8, rH = rr * (rim === 'truck' ? 0.66 : 0.68);
      for (let k = 0; k < nH; k++) {
        const a = (k / nH) * Math.PI * 2;
        const h = new THREE.CylinderGeometry(1, 1, 0.004, 16);
        h.scale(rr * (rim === 'truck' ? 0.11 : 0.09), 1, rr * (rim === 'truck' ? 0.16 : 0.13));
        h.rotateX(Math.PI / 2);
        h.rotateZ(a);
        h.translate(Math.cos(a + Math.PI / 2) * rH, Math.sin(a + Math.PI / 2) * rH, dish + (lip - dish) * 0.2 + 0.002);
        holes.push(h);
      }
      const nL = rim === 'truck' ? 10 : 5, rL = rr * 0.26;
      for (let k = 0; k < nL; k++) {
        const a = (k / nL) * Math.PI * 2;
        const l = new THREE.CylinderGeometry(rr * 0.035, rr * 0.035, 0.03, 6).rotateX(Math.PI / 2);
        l.translate(Math.cos(a) * rL, Math.sin(a) * rL, dish + lip * 0.18 + 0.012);
        lugs.push(l);
      }
      geos.holes = mergeSimple(THREE, holes);
      geos.lugs = mergeSimple(THREE, lugs);
      geos.hub = new THREE.CylinderGeometry(rr * 0.15, rr * 0.18, rim === 'truck' ? 0.09 : 0.03, 20).rotateX(Math.PI / 2).translate(0, 0, dish + lip * 0.18 + (rim === 'truck' ? 0.04 : 0.01));
    }
    if (rim === 'alloy') {
      const lugs = [];
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + Math.PI / 10;
        lugs.push(new THREE.CylinderGeometry(rr * 0.03, rr * 0.03, 0.02, 6).rotateX(Math.PI / 2).translate(Math.cos(a) * rr * 0.17, Math.sin(a) * rr * 0.17, dish + lip * 0.24));
      }
      geos.lugs = mergeSimple(THREE, lugs);
    }
    // orient: lathe axis Y -> X ; face-local z (spokes etc.) -> X as well
    const toX = (g) => { g.rotateZ(-Math.PI / 2); return g; };       // lathe: +Y -> +X
    const zToX = (g) => { g.rotateY(Math.PI / 2); return g; };       // +Z -> +X
    toX(tire); toX(barrel); toX(faceG);
    for (const k of ['spokes', 'disc', 'caliper', 'holes', 'lugs', 'hub']) if (geos[k]) zToX(geos[k]);
    for (const g of [tire, barrel, faceG]) g.computeVertexNormals();
    return geos;
  });
}

// minimal merge (position/normal/uv, non-indexed) so we need no BufferGeometryUtils import
export function mergeSimple(THREE, list) {
  const out = { position: [], normal: [], uv: [] };
  for (let g of list) {
    if (g.index) g = g.toNonIndexed();
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      out.position.push(p.getX(i), p.getY(i), p.getZ(i));
      out.normal.push(n.getX(i), n.getY(i), n.getZ(i));
      out.uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
    }
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.Float32BufferAttribute(out.position, 3));
  m.setAttribute('normal', new THREE.Float32BufferAttribute(out.normal, 3));
  m.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  return m;
}

function buildSingleWheel(THREE, R, W, rim) {
  const M = getMaterials(THREE), g = wheelGeos(THREE, R, W, rim);
  const grp = new THREE.Group();
  const rimMat = rim === 'truck' ? M.truckRim : rim === 'steel' ? M.steelRim : M.alloy;
  const add = (geo, mat, name) => { const m = new THREE.Mesh(geo, mat); m.name = name; m.castShadow = true; m.receiveShadow = true; grp.add(m); return m; };
  add(g.tire, M.rubber, 'tire');
  add(g.barrel, rim === 'alloy' ? M.brake : rimMat, 'rim_barrel');
  add(g.face, rim === 'alloy' ? rimMat : rimMat, 'rim_face');
  if (g.spokes) add(g.spokes, rimMat, 'rim_spokes');
  if (g.disc) add(g.disc, M.brake, 'brake_disc');
  if (g.caliper) add(g.caliper, M.trim, 'caliper');
  if (g.holes) add(g.holes, M.underbody, 'rim_holes');
  if (g.lugs) add(g.lugs, M.chrome, 'lugs');
  if (g.hub) add(g.hub, rim === 'truck' ? M.chrome : M.steelRim, 'hub');
  return grp;
}

export function makeWheel(THREE, opts = {}) {
  const R = opts.radius || 0.33, W = opts.width || 0.22, rim = opts.rim || 'alloy';
  const side = opts.side === 'left' ? 'left' : 'right';
  const outer = new THREE.Group(); outer.name = 'wheel';
  const spin = new THREE.Group(); spin.name = 'wheel_spin';
  if (opts.dual) {
    const gap = 0.03;
    const o = buildSingleWheel(THREE, R, W, rim); o.position.x = (W + gap) / 2;
    const i = buildSingleWheel(THREE, R, W, rim); i.position.x = -(W + gap) / 2; i.rotation.y = Math.PI;
    spin.add(o, i);
  } else {
    spin.add(buildSingleWheel(THREE, R, W, rim));
  }
  if (side === 'left') outer.rotation.y = Math.PI;
  outer.add(spin);
  const sign = side === 'left' ? 1 : -1;
  outer.userData = { assetPart: 'wheel', radius: R, width: opts.dual ? 2 * W + 0.03 : W, side, spin,
    roll(dist) { spin.rotation.x = sign * dist / R; } };
  return outer;
}

// ---------------------------------------------------------------- lamps & lights
export function makeLamp(THREE, { name, kind = 'head', w = 0.3, h = 0.1, d = 0.05, r } = {}) {
  const M = getMaterials(THREE);
  const mat = kind === 'tail' ? M.lightTail : kind === 'amber' ? M.lightAmber : M.lightHead;
  const mesh = new THREE.Mesh(roundedBox(THREE, w, h, d, r ?? Math.min(w, h) * 0.3), mat);
  mesh.name = name || (kind + 'light');
  mesh.userData.lampKind = kind;
  mesh.castShadow = false; mesh.receiveShadow = false;
  return mesh;
}

export function attachLightAPI(THREE, root, opts = {}) {
  const M = getMaterials(THREE);
  const lamps = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    const n = o.name || '';
    let kind = o.userData.lampKind;
    if (/^headlight/i.test(n)) kind = 'head';
    else if (/^taillight|^brakelight/i.test(n)) kind = 'tail';
    if (kind === 'head' || kind === 'tail') { lamps.push(o); o.userData.offMat = o.material; o.userData.lampKind = kind; }
  });
  let spots = null;
  const state = { on: false };
  root.userData.lightsOn = false;
  root.userData.setLights = (on, o2 = {}) => {
    on = !!on; state.on = on; root.userData.lightsOn = on;
    for (const l of lamps) l.material = on ? (l.userData.lampKind === 'head' ? M.lightHeadOn : M.lightTailOn) : l.userData.offMat;
    const wantSpot = o2.spot ?? opts.spot ?? true;
    if (on && wantSpot && !spots && THREE.SpotLight) {
      spots = [];
      const heads = lamps.filter(l => l.userData.lampKind === 'head');
      const y = opts.headY ?? (heads[0] ? heads[0].position.y : 0.7);
      const z = opts.frontZ ?? (heads[0] ? heads[0].position.z : -2);
      const sp = new THREE.SpotLight(0xfff4e0, opts.spotIntensity ?? 18000, 90, 0.42, 0.55, 2);
      sp.name = 'headlamp_beam';
      sp.position.set(0, y, z);
      sp.target.position.set(0, y - 1.2, z - 30);
      sp.castShadow = false;
      root.add(sp, sp.target);
      spots.push(sp);
    }
    if (spots) for (const s of spots) s.visible = on && wantSpot;
    return root;
  };
  return root;
}

export function finalizeVehicle(THREE, root, { type, id, dims, driverEye, wheels, assetType = 'vehicle' } = {}) {
  root.name = id || root.name || type;
  root.traverse(o => { if (o.isMesh) { if (o.castShadow !== false || !o.userData.lampKind) o.castShadow = !o.userData.lampKind; o.receiveShadow = true; } });
  Object.assign(root.userData, { assetType, vehicleType: type, dims: { ...dims } });
  if (driverEye) root.userData.driverEye = driverEye.slice();
  if (!root.userData.setLights) attachLightAPI(THREE, root);
  const ws = wheels || [];
  root.userData.wheels = ws;
  root.userData.roll = (dist) => { for (const w of ws) w.userData.roll && w.userData.roll(dist); };
  return root;
}


// ---------------------------------------------------------------- interior tub (driver-seat views)
/**
 * makeInterior(THREE, {eye:[x,y,z], width, floorY, dashZ, rearZ, rows, wheelR}) -> Group 'interior'
 * Dark, low-poly cabin: floor tub, dash with hood/cowl top, steering wheel + column ahead of the driver eye,
 * front seats (+ optional rear bench). Coordinates are vehicle-local (front = -Z, driver on -X).
 */
export function makeInterior(THREE, o = {}) {
  const M = getMaterials(THREE);
  const g = new THREE.Group(); g.name = 'interior';
  const [ex, ey, ez] = o.eye || [-0.36, 1.15, 0];
  const W = o.width || 1.5, floorY = o.floorY ?? 0.32;
  const dashZ = o.dashZ ?? ez - 0.85, rearZ = o.rearZ ?? ez + 1.3;
  const add = (geo, mat, name, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat); m.name = name; m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m;
  };
  const seatH = ey - 0.62;                       // cushion top ~0.62 m below eye
  // floor tub
  add(roundedBox(THREE, W, 0.04, rearZ - dashZ + 0.2, 0.01), M.interior, 'int_floor', 0, floorY, (dashZ + rearZ) / 2);
  // dash: main block + top pad + centre stack
  const dashTop = ey - 0.32;
  const DW = Math.min(W, o.dashW || W);
  add(roundedBox(THREE, DW, dashTop - floorY - 0.05, 0.38, 0.04), M.interior, 'int_dash', 0, (dashTop + floorY) / 2, dashZ - 0.12);
  add(roundedBox(THREE, DW - 0.04, 0.05, 0.5, 0.025), M.dash || M.interior, 'int_dash_top', 0, dashTop, dashZ - 0.08, -0.12);
  add(roundedBox(THREE, 0.26, 0.3, 0.08, 0.02), M.trimGloss, 'int_stack', 0, dashTop - 0.2, dashZ + 0.09, 0.15);
  add(roundedBox(THREE, 0.28, 0.06, 0.6, 0.02), M.interior, 'int_console', 0, seatH - 0.05, ez + 0.25);
  // instrument binnacle + steering wheel
  add(roundedBox(THREE, 0.34, 0.09, 0.16, 0.03), M.interior, 'int_binnacle', ex, dashTop + 0.035, dashZ + 0.05);
  const swZ = ez - 0.47, swY = ey - (o.swDrop ?? 0.4), T = 0.4;   // wheel plane tilted back ~23 deg
  const ring = cachedGeo(THREE, 'int_swring', () => new THREE.TorusGeometry(0.185, 0.017, 8, 28));
  add(ring, M.steering, 'steering_wheel', ex, swY, swZ, T, 0, 0);
  add(cachedGeo(THREE, 'int_swhub', () => new THREE.CylinderGeometry(0.055, 0.06, 0.05, 14)), M.trim, 'steering_hub', ex, swY, swZ, Math.PI / 2 + T);
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const sp = add(roundedBox(THREE, 0.15, 0.024, 0.014, 0.006), M.trim, 'steering_spoke', ex, swY, swZ, T, 0, a);
    sp.translateX(0.095);
  }
  const col = add(cachedGeo(THREE, 'int_col', () => new THREE.CylinderGeometry(0.035, 0.045, 0.42, 10)), M.trim, 'steering_column', ex, swY, swZ, Math.PI / 2 + T);
  col.translateY(-0.22);
  // seats
  const seat = (x, z, w) => {
    add(roundedBox(THREE, w, 0.13, 0.5, 0.05), M.seat || M.interior, 'seat_cushion', x, seatH, z);
    const back = add(roundedBox(THREE, w, 0.62, 0.12, 0.05), M.seat || M.interior, 'seat_back', x, seatH + 0.33, z + 0.28);
    back.rotation.x = 0.2;
    add(roundedBox(THREE, w * 0.55, 0.18, 0.1, 0.04), M.seat || M.interior, 'headrest', x, seatH + 0.75, z + 0.38);
    add(roundedBox(THREE, w * 0.9, seatH - floorY - 0.08, 0.4, 0.02), M.interior, 'seat_base', x, (seatH + floorY) / 2, z);
  };
  seat(ex, ez + 0.12, 0.5); seat(-ex, ez + 0.12, 0.5);
  if (o.rows !== 1 && rearZ - ez > 1.05) {
    add(roundedBox(THREE, W - 0.1, 0.13, 0.5, 0.05), M.seat || M.interior, 'rear_cushion', 0, seatH - 0.02, ez + 0.98);
    const rb = add(roundedBox(THREE, W - 0.1, 0.6, 0.12, 0.05), M.seat || M.interior, 'rear_back', 0, seatH + 0.3, ez + 1.25); rb.rotation.x = 0.22;
    for (const x of [-0.45, 0.45]) add(roundedBox(THREE, 0.26, 0.17, 0.1, 0.04), M.seat || M.interior, 'headrest', x, seatH + 0.68, ez + 1.33);
  }
  // rear-view mirror
  add(roundedBox(THREE, 0.24, 0.07, 0.03, 0.015), M.trim, 'int_rvmirror', 0, o.mirrorY ?? ey + 0.1, o.mirrorZ ?? ez - 0.6);
  g.traverse(m => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = true; } });
  return g;
}

// ---------------------------------------------------------------- loop-stack surfaces (passenger car bodies)
// A body is a stack of closed plan-view loops ("levels"), ordered from the underbody centre line, out and up the
// sides, over the shoulder and in to the top centre line. Each loop = front superellipse quadrant + side run + rear
// quadrant (right half), mirrored to the left. Fronts/rears therefore wrap round in plan (real bumper corners), the
// hood/deck/roof crown is formed by inset loops, and every vertex has a semantic address (level i, right index r).
//   level = { zF, zR, dF, dR, nF, nR, half(u) -> side half width, y(x, u) -> height, sideU?: [u..] (NS values) }
//   (u = metres from the front bumper; the geometry is emitted with z = u + zOff)
export function stackHalf(lv, NQF, NQR, sideFr) {
  const out = [];
  const a = lv.zF + lv.dF, b = lv.zR - lv.dR;
  const nF = lv.nF || 2.6, nR = lv.nR || 2.6;
  const hA = Math.max(0, lv.half(a)), hB = Math.max(0, lv.half(b));
  const pw = (v, e) => Math.pow(Math.max(0, v), e);
  for (let k = 0; k < NQF; k++) {
    const t = (k / NQF) * Math.PI / 2;
    out.push({ x: hA * pw(Math.sin(t), 2 / nF), u: lv.zF + lv.dF * (1 - pw(Math.cos(t), 2 / nF)), seg: 'F', k, t: k / NQF });
  }
  const su = lv.sideU || sideFr.map(fr => a + (b - a) * fr);
  su.forEach((u, k) => out.push({ x: Math.max(0, lv.half(u)), u, seg: 'S', k, t: k / Math.max(1, su.length - 1) }));
  for (let k = NQR - 1; k >= 0; k--) {
    const t = (k / NQR) * Math.PI / 2;
    out.push({ x: hB * pw(Math.sin(t), 2 / nR), u: lv.zR - lv.dR * (1 - pw(Math.cos(t), 2 / nR)), seg: 'R', k, t: k / NQR });
  }
  return out;
}

/**
 * stackGeometry(THREE, levels, {NQF, NQR, sideFr, zOff, material(q), cut(q), snap(p, i)}) -> {geo, grid}
 * q = {i, r, seg, k, t, side, x(|x|), y, u, lv} describes a quad (centroid). Coincident vertices are welded so collapsed
 * centre lines and poles shade smoothly. Faces wind outward when levels run bottom -> sides -> top.
 */
export function stackGeometry(THREE, levels, o) {
  const NQF = o.NQF, NQR = o.NQR, zOff = o.zOff || 0;
  const grid = levels.map((lv, i) => {
    const half = stackHalf(lv, NQF, NQR, o.sideFr);
    for (const p of half) { p.y = lv.y(p.x, p.u, p); if (o.snap) o.snap(p, i, lv); }
    return half;
  });
  const H = grid[0].length, M = 2 * H - 2;
  const pos = [], keyIdx = new Map(), vid = [];
  const vtx = (x, y, z) => {
    const key = Math.round(x * 2e4) + ',' + Math.round(y * 2e4) + ',' + Math.round(z * 2e4);
    let id = keyIdx.get(key);
    if (id == null) { id = pos.length / 3; pos.push(x, y, z); keyIdx.set(key, id); }
    return id;
  };
  for (let i = 0; i < grid.length; i++) {
    const row = [];
    for (let j = 0; j < M; j++) {
      const r = j < H ? j : M - j, p = grid[i][r], sx = j < H ? 1 : -1;
      row.push(vtx(sx * p.x, p.y, p.u + zOff));
    }
    vid.push(row);
  }
  const groups = new Map();
  const add = (g, a, b, c) => { if (a === b || b === c || a === c) return; let arr = groups.get(g); if (!arr) groups.set(g, arr = []); arr.push(a, b, c); };
  for (let i = 0; i < grid.length - 1; i++) {
    for (let j = 0; j < M; j++) {
      const j2 = (j + 1) % M;
      const rj = j < H ? j : M - j, rj2 = j2 < H ? j2 : M - j2;
      const r = Math.min(rj, rj2), side = j < H - 1 ? 1 : -1;
      const P = [grid[i][rj], grid[i][rj2], grid[i + 1][rj], grid[i + 1][rj2]];
      const q = { i, r, seg: grid[i][r].seg, k: grid[i][r].k, t: grid[i][r].t, side, lv: levels[i],
        x: (P[0].x + P[1].x + P[2].x + P[3].x) / 4, y: (P[0].y + P[1].y + P[2].y + P[3].y) / 4, u: (P[0].u + P[1].u + P[2].u + P[3].u) / 4 };
      if (o.cut && o.cut(q)) continue;
      const g = o.material ? o.material(q) : 0;
      const a = vid[i][j], b = vid[i][j2], c = vid[i + 1][j], d = vid[i + 1][j2];
      add(g, a, c, b); add(g, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const idx = []; let start = 0;
  for (const g of [...groups.keys()].sort((a, b) => a - b)) { const arr = groups.get(g); for (const v of arr) idx.push(v); geo.addGroup(start, arr.length, g); start += arr.length; }
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return { geo, grid, H, M };
}

/** Raycast helper against finished meshes: hit([x,y,z], [dx,dy,dz]) -> {p:[..], n:[..] (smooth, facing the ray)} | null */
export function surfaceCaster(THREE, meshes) {
  const rc = new THREE.Raycaster();
  const o = new THREE.Vector3(), d = new THREE.Vector3(), bc = new THREE.Vector3();
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (const m of meshes) m.updateMatrixWorld(true);
  return (origin, dir, far = 6) => {
    o.set(origin[0], origin[1], origin[2]); d.set(dir[0], dir[1], dir[2]).normalize();
    rc.set(o, d); rc.far = far;
    const hits = rc.intersectObjects(meshes, false);
    const h = hits[0];
    if (!h) return null;
    const g = h.object.geometry, P = g.attributes.position, N = g.attributes.normal;
    A.fromBufferAttribute(P, h.face.a); B.fromBufferAttribute(P, h.face.b); C.fromBufferAttribute(P, h.face.c);
    const lp = h.object.worldToLocal(h.point.clone());
    THREE.Triangle.getBarycoord(lp, A, B, C, bc);
    const n = new THREE.Vector3();
    if (N) {
      n.addScaledVector(A.fromBufferAttribute(N, h.face.a), bc.x).addScaledVector(B.fromBufferAttribute(N, h.face.b), bc.y).addScaledVector(C.fromBufferAttribute(N, h.face.c), bc.z);
    } else n.copy(h.face.normal);
    n.transformDirection(h.object.matrixWorld);
    if (n.dot(d) > 0) n.negate();
    return { p: [h.point.x, h.point.y, h.point.z], n: [n.x, n.y, n.z] };
  };
}

/** Conforming patch from a rows x cols grid of hits (null = hole). off = offset along the normal (m). */
export function hitPatch(THREE, rows, off = 0.003) {
  const pos = [], nor = [], idx = [], id = rows.map(r => r.map(() => -1));
  rows.forEach((row, i) => row.forEach((h, j) => {
    if (!h) return;
    id[i][j] = pos.length / 3;
    pos.push(h.p[0] + h.n[0] * off, h.p[1] + h.n[1] * off, h.p[2] + h.n[2] * off); nor.push(...h.n);
  }));
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < rows[i].length - 1; j++) {
    const a = id[i][j], b = id[i][j + 1], c = id[i + 1][j], d = id[i + 1][j + 1];
    if (a < 0 || b < 0 || c < 0 || d < 0) continue;
    // wind so the face normal agrees with the surface normal
    const pa = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]], pb = [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]], pc = [pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]];
    const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const flip = cr[0] * nor[a * 3] + cr[1] * nor[a * 3 + 1] + cr[2] * nor[a * 3 + 2] < 0;
    if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/** Strip of width w along a polyline of hits, lifted off the surface by off (panel gaps, trim strips, wipers). */
export function hitRibbon(THREE, hits, w = 0.006, off = 0.0015) {
  const hs = hits.filter(Boolean);
  const rows = [[], []];
  for (let i = 0; i < hs.length; i++) {
    const a = hs[Math.max(0, i - 1)].p, b = hs[Math.min(hs.length - 1, i + 1)].p, n = hs[i].n;
    const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let s = [t[1] * n[2] - t[2] * n[1], t[2] * n[0] - t[0] * n[2], t[0] * n[1] - t[1] * n[0]];
    const l = Math.hypot(s[0], s[1], s[2]) || 1; s = s.map(v => v / l * w / 2);
    const p = hs[i].p;
    rows[0].push({ p: [p[0] - s[0], p[1] - s[1], p[2] - s[2]], n });
    rows[1].push({ p: [p[0] + s[0], p[1] + s[1], p[2] + s[2]], n });
  }
  return hitPatch(THREE, rows, off);
}

/** Mirror a geometry across x = 0 (flips winding so faces stay outward). */
export function mirrorX(THREE, geo) {
  const g = geo.clone();
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) { p.setX(i, -p.getX(i)); if (n) n.setX(i, -n.getX(i)); }
  if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } }
  p.needsUpdate = true;
  return g;
}
