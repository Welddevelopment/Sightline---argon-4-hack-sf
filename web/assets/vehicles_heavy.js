// Sightline heavy-vehicle library (VEH-HEAVY). Browser + Node, no DOM at import, no THREE import (THREE is passed in).
//
//   import { createHeavyVehicle, coupleTrailer } from './assets/vehicles_heavy.js';
//   const tractor = createHeavyVehicle(THREE, 'truck_tractor', { id: 'veh_T_tractor', color: 0x8a1c1c });
//   const trailer = createHeavyVehicle(THREE, 'semitrailer',  { id: 'veh_T_trailer', variant: 'box' });   // or variant:'flatbed'
//   const truck   = createHeavyVehicle(THREE, 'box_truck', { id: 'veh_B' });
//   const bus     = createHeavyVehicle(THREE, 'bus', { id: 'veh_bus', variant: 'transit' });             // or variant:'school'
//
// WORLD CONTRACT v2: meters, Y up, origin = ground-level centre of the footprint, rotation.y = 0 faces -Z (front at -Z).
// Catalog dims (exact): truck_tractor 6.5 x 2.5 x 3.6 · semitrailer 16.2 x 2.6 x 4.1 (flatbed: deck height 1.52)
//                       box_truck 7.5 x 2.5 x 3.4 · bus 12.2 x 2.55 x 3.2  (mirrors excluded from width, as on spec sheets)
// Every object: name = id, userData.{assetType, variant, dims, setLights(on, {beams}), setBrake(on), driverEye|null}.
// Lamps are child meshes named headlight_L/R and taillight_L/R (L = driver side = -X when facing -Z).
//
// ARTICULATION API (tractor + semitrailer are two separate objects; put both under the SAME parent)
//   Headings: h = rotation.y (rad). Heading 0 faces -Z; positive h turns LEFT (counter-clockwise seen from above, +Y up).
//   Articulation angle  a = h_tractor - h_trailer   (a > 0: tractor turned left of the trailer; |a| < ~1.4 rad physically)
//   tractor.userData.fifthWheel     = [0, 1.22, zF]   local fifth-wheel pivot (zF = +1.95, over the drive tandem)
//   trailer.userData.kingpin        = [0, 1.22, zK]   local kingpin; trailer.userData.kingpinOffset = zK (= -7.19 m,
//                                                     0.91 m / 36 in behind the trailer nose)
//   trailer.userData.kingpinToAxles = L  (13.37 m, kingpin to trailer tandem centre: the tractrix length)
//   Pose rule (exact): P = tractor.position + R(h)·(0,0,zF);  trailer.rotation.y = h - a;
//                      trailer.position = P - R(h - a)·(0,0,zK)            with R(h)·(0,0,z) = (z sin h, 0, z cos h)
//   coupleTrailer(tractor, trailer, a)    places the trailer from the tractor's current pose (returns {pivot, trailerHeading}).
//   followTrailer(tractor, trailer)       kinematic follow for animation: call once per frame AFTER moving the tractor;
//                                         the trailer axle drags along the pivot path (discrete tractrix, valid forward and
//                                         reversing, frame-rate independent for steps << L). Returns the articulation angle.
//   articulationOf(tractor, trailer)      current a, wrapped to (-pi, pi].
//   tractor.userData.hitch(trailer, a) / tractor.userData.follow(trailer) are the same calls without an import.
//   Continuous form: d(h_trailer)/ds = sin(a) / L  (s = distance travelled by the pivot).
// CONTACT SHADOW: every vehicle carries a baked soft AO footprint (userData.contactShadow, a raycast-transparent plane at
//   y = 0.006); pass {contactShadow:false} to omit it. LAMPS: setLights(on, {beams, glow}) lights head/tail/amber/red markers
//   (emissive) and their additive glare halos (glow default true); setBrake(on) brightens the tails.

let SHARED = null;
try { SHARED = await import('./vehicle_parts.js'); } catch (e) { SHARED = null; }   // optional; local parts below are the fallback

const CATALOG = {
  truck_tractor: { length: 6.5, width: 2.5, height: 3.6 },
  semitrailer:   { length: 16.2, width: 2.6, height: 4.1 },
  semitrailer_flatbed: { length: 16.2, width: 2.6, height: 1.52 },
  box_truck:     { length: 7.5, width: 2.5, height: 3.4 },
  bus:           { length: 12.2, width: 2.55, height: 3.2 },
  bus_school:    { length: 12.2, width: 2.55, height: 3.2 },
};
export const HEAVY_TYPES = ['truck_tractor', 'semitrailer', 'box_truck', 'bus'];
export const HEAVY_DIMS = CATALOG;

// ---------------------------------------------------------------- caches (per THREE instance)
const CACHES = new WeakMap();
function cacheFor(T) {
  let c = CACHES.get(T);
  if (!c) { c = { mats: {}, paint: {}, built: {}, geo: {} }; CACHES.set(T, c); }
  return c;
}

// ---------------------------------------------------------------- materials (PBR)
function mats(T) {
  const c = cacheFor(T);
  if (c.mats.chrome) return c.mats;
  const S = (o) => new T.MeshStandardMaterial(o);
  const P = (o) => new (T.MeshPhysicalMaterial || T.MeshStandardMaterial)(o);
  const m = c.mats;
  // Env-map-friendly metals: physical materials whose look comes from scene.environment (IBL); with no env map they
  // fall back to a mid-grey base so they never read as black voids.
  m.chrome = P({ color: 0xeceef0, metalness: 1.0, roughness: 0.07, envMapIntensity: 1.25 });
  m.alum = P({ color: 0xd2d6da, metalness: 1.0, roughness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.08, envMapIntensity: 1.1 });
  m.alumDull = P({ color: 0xb2b6bb, metalness: 0.8, roughness: 0.42, envMapIntensity: 0.9 });
  m.frame = S({ color: 0x1b1c1e, metalness: 0.35, roughness: 0.55 });
  m.steelDark = S({ color: 0x2a2c2f, metalness: 0.5, roughness: 0.5 });
  m.trim = S({ color: 0x151617, metalness: 0.0, roughness: 0.55 });
  m.grille = S({ color: 0x0b0c0d, metalness: 0.6, roughness: 0.45 });
  m.rubber = S({ color: 0x111112, metalness: 0.0, roughness: 0.9 });
  m.tire = S({ color: 0x18191a, metalness: 0.0, roughness: 0.88 });
  m.hole = S({ color: 0x050505, metalness: 0.0, roughness: 1.0 });
  m.well = S({ color: 0x0a0a0b, metalness: 0.0, roughness: 0.95, side: T.BackSide });
  m.glass = P({ color: 0x1a252d, metalness: 0.05, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.88 });
  m.panelWhite = P({ color: 0xe9ebea, metalness: 0.2, roughness: 0.38, clearcoat: 0.35, clearcoatRoughness: 0.2, envMapIntensity: 0.9 });
  m.frp = P({ color: 0xf2f2ee, metalness: 0.0, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.15, envMapIntensity: 0.9 });
  m.wood = S({ color: 0x8a6440, metalness: 0.0, roughness: 0.82 });
  m.rimWhite = P({ color: 0xd8d8d2, metalness: 0.3, roughness: 0.35, clearcoat: 0.6 });
  // DOT-C2 retroreflective sheeting: bright under light, slight self-lit floor so it reads at night in headlamps
  m.reflRed = S({ color: 0xb4121a, metalness: 0.1, roughness: 0.3, emissive: 0x200000 });
  m.reflWhite = S({ color: 0xf4f4f4, metalness: 0.1, roughness: 0.25, emissive: 0x111111 });
  m.reflAmber = S({ color: 0xd07a0c, metalness: 0.1, roughness: 0.3, emissive: 0x1a0d00 });
  m.yellowBus = P({ color: 0xf2a900, metalness: 0.1, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
  m.redSign = S({ color: 0xb01018, metalness: 0.1, roughness: 0.35 });
  m.ledSign = S({ color: 0x1a1408, metalness: 0.2, roughness: 0.3, emissive: 0x3a2400, emissiveIntensity: 1 });
  m.flapPrint = S({ color: 0xd8d8d8, metalness: 0.6, roughness: 0.3 });
  for (const k in m) m[k].name = 'heavy_' + k;
  if (SHARED && SHARED.getMaterials) {            // library-wide look: share glass/rubber/trim with the car models
    const sm = SHARED.getMaterials(T);
    m.glass = sm.glass; m.rubber = sm.rubber; m.trim = sm.trim; m.tire = sm.rubber;
  }
  return m;
}
function paint(T, hex) {
  if (SHARED && SHARED.getMaterials) return SHARED.getMaterials(T).paint(hex);
  const c = cacheFor(T);
  const key = String(hex);
  if (!c.paint[key]) {
    c.paint[key] = new T.MeshPhysicalMaterial({ color: hex, metalness: 0.25, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 });
    c.paint[key].name = 'heavy_paint_' + key;
  }
  return c.paint[key];
}
function toHex(color, dflt) {
  if (color === undefined || color === null || color === '') return dflt;
  if (typeof color === 'number') return color;
  const named = { white: 0xf2f2f0, black: 0x141518, red: 0x9a1b1b, blue: 0x1f3d7a, silver: 0xb9bdc2, gray: 0x6b6f75, grey: 0x6b6f75,
    green: 0x1f5a3a, yellow: 0xf2a900, orange: 0xd9601a, maroon: 0x5c1a1f, brown: 0x5a3d2b, gold: 0xb8913a };
  const s = String(color).trim().toLowerCase();
  if (named[s] !== undefined) return named[s];
  if (/^#?[0-9a-f]{6}$/.test(s)) return parseInt(s.replace('#', ''), 16);
  return dflt;
}

// ---------------------------------------------------------------- geometry helpers
// Builder: accumulates transformed geometry per material key, merges once per (type, variant), cached.
class Builder {
  constructor(T) { this.T = T; this.b = {}; this.wheels = []; this.m4 = new T.Matrix4(); this.q = new T.Quaternion(); this.e = new T.Euler(); }
  add(mat, geo, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1]) {
    const T = this.T;
    this.e.set(rot[0], rot[1], rot[2]);
    this.q.setFromEuler(this.e);
    this.m4.compose(new T.Vector3(...pos), this.q, new T.Vector3(...scl));
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    g.applyMatrix4(this.m4);
    if (scl[0] * scl[1] * scl[2] < 0) flipWinding(g);
    (this.b[mat] = this.b[mat] || []).push(g);
    return this;
  }
  box(mat, [x0, x1], [y0, y1], [z0, z1], rot) {
    const g = new this.T.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
    return this.add(mat, g, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], rot);
  }
  // mirrored pair across x=0 for a box
  box2(mat, [x0, x1], ys, zs) { this.box(mat, [x0, x1], ys, zs); return this.box(mat, [-x1, -x0], ys, zs); }
  cyl(mat, axis, r, len, pos, seg = 20, r2) {
    const g = new this.T.CylinderGeometry(r2 === undefined ? r : r2, r, len, seg);
    const rot = axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
    return this.add(mat, g, pos, rot);
  }
  build() {
    const out = {};
    for (const k in this.b) out[k] = mergeGeos(this.T, this.b[k]);
    Object.defineProperty(out, '__wheels', { value: this.wheels, enumerable: false });
    return out;
  }
}
function flipWinding(g) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i += 3) for (const a of [p, n, uv]) if (a) {
    const s = a.itemSize;
    for (let k = 0; k < s; k++) { const t = a.array[(i + 1) * s + k]; a.array[(i + 1) * s + k] = a.array[(i + 2) * s + k]; a.array[(i + 2) * s + k] = t; }
  }
}
function mergeGeos(T, list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += c;
    g.dispose();
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3));
  out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  out.setAttribute('uv', new T.BufferAttribute(uv, 2));
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}

// Profile path in the vehicle's side plane. Nodes: [z, y, cornerRadius?] or ['arch', zc, yc, r] (wheel-arch cut through the
// line between its neighbours, centre (zc,yc)). Shape coords: sx = -z, sy = y (so the extrude, rotated, puts front at -Z).
function profileShape(T, nodes) {
  const pts = [];
  // resolve arch endpoints
  const N = nodes.length;
  const res = nodes.map(n => (n[0] === 'arch' ? { arc: true, xc: -n[1], yc: n[2], r: n[3] } : { x: -n[0], y: n[1], r: n[2] || 0 }));
  for (let i = 0; i < N; i++) {
    const n = res[i];
    if (!n.arc) continue;
    const prev = res[(i - 1 + N) % N], next = res[(i + 1) % N];
    const py = prev.arc ? next.y : prev.y, ny = next.arc ? prev.y : next.y;
    const pxx = prev.arc ? prev.xc : prev.x, nxx = next.arc ? next.xc : next.x;
    const yb = (py + ny) / 2;
    const a0 = Math.asin(Math.max(-1, Math.min(1, (yb - n.yc) / n.r)));
    const dxr = n.r * Math.cos(a0);
    if (nxx > pxx) { n.s = [n.xc - dxr, yb]; n.e = [n.xc + dxr, yb]; n.a = [Math.PI - a0, a0, true]; }
    else { n.s = [n.xc + dxr, yb]; n.e = [n.xc - dxr, yb]; n.a = [a0, Math.PI - a0, false]; }
  }
  const endOf = (n) => (n.arc ? n.e : [n.x, n.y]);
  const startOf = (n) => (n.arc ? n.s : [n.x, n.y]);
  const sh = new T.Shape();
  for (let i = 0; i < N; i++) {
    const n = res[i];
    if (n.arc) { sh.lineTo(n.s[0], n.s[1]); sh.absarc(n.xc, n.yc, n.r, n.a[0], n.a[1], n.a[2]); continue; }
    const p = [n.x, n.y];
    if (n.r > 0) {
      const pv = endOf(res[(i - 1 + N) % N]), nx = startOf(res[(i + 1) % N]);
      const d1 = Math.hypot(pv[0] - p[0], pv[1] - p[1]), d2 = Math.hypot(nx[0] - p[0], nx[1] - p[1]);
      const r = Math.min(n.r, d1 * 0.49, d2 * 0.49);
      const a = [p[0] + (pv[0] - p[0]) / d1 * r, p[1] + (pv[1] - p[1]) / d1 * r];
      const b = [p[0] + (nx[0] - p[0]) / d2 * r, p[1] + (nx[1] - p[1]) / d2 * r];
      if (i === 0) sh.moveTo(a[0], a[1]); else sh.lineTo(a[0], a[1]);
      sh.quadraticCurveTo(p[0], p[1], b[0], b[1]);
    } else {
      if (i === 0) sh.moveTo(p[0], p[1]); else sh.lineTo(p[0], p[1]);
    }
  }
  sh.closePath();
  return sh;
}
// Extrude a side profile across X (total width w, centred on xc), rounded edges via bevel.
function sideGeo(T, nodes, w, bevel = 0.04, seg = 8) {
  const sh = profileShape(T, nodes);
  const b = Math.min(bevel, w * 0.45);
  const depth = Math.max(0.001, w - 2 * b);
  const g = new T.ExtrudeGeometry(sh, { depth, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: b > 0 ? 3 : 0, curveSegments: seg });
  g.rotateY(Math.PI / 2);          // shape x -> -z ... (sx=-z so z' = -sx = z), extrude axis -> +x
  g.translate(-depth / 2, 0, 0);
  return g;
}
// Extrude a plan (top-view) outline [x,z,r?] vertically from y0 to y1.
function planGeo(T, nodes, y0, y1, bevel = 0.02, seg = 8) {
  const sh = profileShape(T, nodes.map(n => [-n[0], -n[1], n[2] || 0]));   // sx = x, sy = -z
  const h = y1 - y0, b = Math.min(bevel, h * 0.45), depth = Math.max(0.001, h - 2 * b);
  const g = new T.ExtrudeGeometry(sh, { depth, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: b > 0 ? 2 : 0, curveSegments: seg });
  g.rotateX(-Math.PI / 2);         // extrude -> +y, sy -> -z
  g.translate(0, y0 + b, 0);
  return g;
}
// Front-facing plate (outline in x,y), thickness t, front face at z = zf facing -Z.
function frontGeo(T, nodes, t, bevel = 0.0, holes = []) {
  const sh = profileShape(T, nodes.map(n => [-n[0], n[1], n[2] || 0]));
  for (const h of holes) sh.holes.push(profileShape(T, h.map(n => [-n[0], n[1], n[2] || 0])));
  const b = Math.min(bevel, t * 0.45);
  const g = new T.ExtrudeGeometry(sh, { depth: Math.max(0.001, t - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, b);            // z from 0..t, front face at z=0 is "toward -Z" after we place at zf
  return g;
}
const rrect = (x0, x1, y0, y1, r) => [[x0, y0, r], [x1, y0, r], [x1, y1, r], [x0, y1, r]];

// Windows on the body sides: outline in (z,y) nodes, gasket + glass, on side(s) at |x| = xs.
function sideWindow(B, T, nodes, xs, sides = [-1, 1], gasket = 0.025) {
  const g = sideGeo(T, nodes, 0.012, 0.0);
  const grow = nodes.map(n => n); // gasket = same outline slightly behind and scaled out
  for (const s of sides) {
    B.add('trim', sideGeo(T, grow, 0.01, 0.0), [s * (xs + 0.002), 0, 0]);
    B.add('glass', g, [s * (xs + 0.008), 0, 0], [0, 0, 0], [1, 1, 1]);
  }
  if (gasket > 0) {
    // gasket ring: inflate around centroid
    let cz = 0, cy = 0; for (const n of nodes) { cz += n[0]; cy += n[1]; } cz /= nodes.length; cy /= nodes.length;
    const inf = nodes.map(n => { const dz = n[0] - cz, dy = n[1] - cy, L = Math.hypot(dz, dy) || 1; return [n[0] + dz / L * gasket, n[1] + dy / L * gasket, (n[2] || 0) + gasket * 0.5]; });
    for (const s of sides) B.add('trim', sideGeo(T, inf, 0.01, 0.0), [s * (xs + 0.001), 0, 0]);
  }
}
// Slanted windscreen between (zb,yb) bottom and (zt,yt) top, width w; panes split if split>0.
function windscreen(B, T, zb, yb, zt, yt, w, split = 0, r = 0.06) {
  const L = Math.hypot(zt - zb, yt - yb), ang = Math.atan2(zt - zb, yt - yb); // lean back = positive rotation about X
  const nz = Math.cos(ang), ny = Math.sin(ang);                               // outward normal ~ (-z) direction
  const cz = (zb + zt) / 2 - nz * 0.012, cy = (yb + yt) / 2 + ny * 0.012;
  const rot = [-(Math.PI / 2) + 0, 0, 0];
  // plate built in x,y then tilted: frontGeo outline (x,y) local, faces -Z
  const gas = frontGeo(T, rrect(-w / 2 - 0.04, w / 2 + 0.04, -L / 2 - 0.04, L / 2 + 0.04, r + 0.03), 0.01);
  B.add('trim', gas, [0, cy, cz + nz * 0.004], [ang, 0, 0]);
  if (split > 0) {
    const hw = (w - split) / 2;
    B.add('glass', frontGeo(T, rrect(-w / 2, -split / 2, -L / 2, L / 2, r), 0.012), [0, cy + ny * 0.004, cz - nz * 0.004], [ang, 0, 0]);
    B.add('glass', frontGeo(T, rrect(split / 2, w / 2, -L / 2, L / 2, r), 0.012), [0, cy + ny * 0.004, cz - nz * 0.004], [ang, 0, 0]);
    void hw;
  } else {
    B.add('glass', frontGeo(T, rrect(-w / 2, w / 2, -L / 2, L / 2, r), 0.012), [0, cy + ny * 0.004, cz - nz * 0.004], [ang, 0, 0]);
  }
  void rot;
}

// ---------------------------------------------------------------- wheels (local parts; shared module used if compatible)
function tireGeo(T, R, w, Rr) {
  const P = (r, y) => new T.Vector2(r, y);
  const pts = [P(Rr, -w * 0.40), P(Rr + 0.03, -w * 0.47), P(R - 0.075, -w * 0.5), P(R - 0.03, -w * 0.47), P(R - 0.008, -w * 0.42),
    P(R, -w * 0.36), P(R, -w * 0.2), P(R - 0.012, -w * 0.17), P(R - 0.012, -w * 0.11), P(R, -w * 0.08), P(R, w * 0.08), P(R - 0.012, w * 0.11),
    P(R - 0.012, w * 0.17), P(R, w * 0.2), P(R, w * 0.36), P(R - 0.008, w * 0.42), P(R - 0.03, w * 0.47), P(R - 0.075, w * 0.5),
    P(Rr + 0.03, w * 0.47), P(Rr, w * 0.40)];
  const g = new T.LatheGeometry(pts, 40);
  g.rotateZ(Math.PI / 2);   // axis -> X, profile y<0 (outer face) -> +X
  return g;
}
function rimGeo(T, Rr, w, style) {
  const P = (r, y) => new T.Vector2(r, y);
  const f = -w * 0.5;
  const pts = style === 'steel'
    ? [P(0.0, f + 0.05), P(0.1, f + 0.05), P(0.13, f + 0.035), P(0.2, f + 0.03), P(0.235, f + 0.045), P(Rr - 0.03, f + 0.03), P(Rr - 0.01, f + 0.005), P(Rr + 0.018, f), P(Rr + 0.02, f + 0.02), P(Rr - 0.005, f + 0.03), P(Rr - 0.01, -f)]
    : [P(0.0, f + 0.035), P(0.12, f + 0.035), P(0.13, f + 0.05), P(Rr - 0.06, f + 0.055), P(Rr - 0.03, f + 0.03), P(Rr - 0.01, f + 0.005), P(Rr + 0.018, f), P(Rr + 0.02, f + 0.02), P(Rr - 0.005, f + 0.03), P(Rr - 0.01, -f)];
  const g = new T.LatheGeometry(pts, 40);
  g.rotateZ(Math.PI / 2);
  return g;
}
function hubGeo(T, w, holes, style) {
  const f = -w * 0.5;
  const parts = [];
  const P = (r, y) => new T.Vector2(r, y);
  const cap = new T.LatheGeometry([P(0, f - 0.09), P(0.04, f - 0.088), P(0.07, f - 0.07), P(0.085, f - 0.03), P(0.09, f + 0.03)], 24);
  parts.push(cap);
  const nut = new T.CylinderGeometry(0.016, 0.016, 0.035, 6);
  const nH = holes;
  for (let i = 0; i < nH; i++) {
    const a = (i / nH) * Math.PI * 2;
    const g = nut.clone(); g.translate(Math.cos(a) * 0.143, f + (style === 'steel' ? 0.035 : 0.02), Math.sin(a) * 0.143);
    parts.push(g);
  }
  return parts.map(g => { g.rotateZ(Math.PI / 2); return g; });
}
function handHoles(T, w, Rr, n) {
  const f = -w * 0.5;
  const out = [];
  const g0 = new T.CylinderGeometry(0.036, 0.036, 0.006, 14);
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2;
    const g = g0.clone(); g.translate(Math.cos(a) * 0.205, f + 0.032, Math.sin(a) * 0.205); g.rotateZ(Math.PI / 2); out.push(g);
  }
  return out;
}
// Adds one wheel (or a dual pair) with its centre at (x, R, z). side = sign of x (outer face direction).
function addWheel(B, T, x, z, { R = 0.51, w = 0.28, Rr = 0.286, dual = false, rim = 'alum', gap = 0.05 } = {}) {
  const side = x < 0 ? -1 : 1;
  if (SHARED && SHARED.makeWheel) {               // shared wheel (spins via userData.roll); dual set is centred on its origin
    const xc = dual ? x - side * (w + 0.03) / 2 : x;
    B.wheels.push({ x: xc, y: R, z, radius: R, width: w, dual, side: side > 0 ? 'right' : 'left' });
    return;
  }
  const rotY = side > 0 ? 0 : Math.PI;
  const c = cacheFor(T).geo;
  const key = `${R}|${w}|${Rr}|${rim}`;
  if (!c[key]) {
    c[key] = { tire: tireGeo(T, R, w, Rr), rim: rimGeo(T, Rr, w * 0.82, rim), hub: hubGeo(T, w * 0.82, 10, rim), holes: rim === 'alum' ? handHoles(T, w * 0.82, Rr, 10) : handHoles(T, w * 0.82, Rr, 5) };
  }
  const W = c[key];
  const rimMat = rim === 'alum' ? 'alum' : 'rimWhite';
  const place = (xx) => {
    B.add('tire', W.tire, [xx, R, z], [0, rotY, 0]);
    B.add(rimMat, W.rim, [xx, R, z], [0, rotY, 0]);
    for (const h of W.hub) B.add('chrome', h, [xx, R, z], [0, rotY, 0]);
    for (const h of W.holes) B.add('hole', h, [xx, R, z], [0, rotY, 0]);
  };
  place(x);
  if (dual) {
    const xi = x - side * (w + gap);
    B.add('tire', W.tire, [xi, R, z], [0, rotY, 0]);
    B.add('steelDark', W.rim, [xi, R, z], [0, rotY, 0]);
  }
}
function mudflap(B, x0, x1, z, yTop = 0.95, yBot = 0.22) {
  B.box('rubber', [x0, x1], [yBot, yTop], [z, z + 0.012]);
}

// ---------------------------------------------------------------- lamps (per-instance materials)
function lampMats(T) {
  const S = (o) => new T.MeshStandardMaterial(o);
  return {
    head: S({ color: 0xdfe3e6, metalness: 0.2, roughness: 0.08, emissive: 0xfff3dc, emissiveIntensity: 0 }),
    tail: S({ color: 0x7a0a0e, metalness: 0.1, roughness: 0.2, emissive: 0xff1810, emissiveIntensity: 0 }),
    amber: S({ color: 0xc46a08, metalness: 0.1, roughness: 0.2, emissive: 0xff8a10, emissiveIntensity: 0 }),
    marker: S({ color: 0x7a0a0e, metalness: 0.1, roughness: 0.2, emissive: 0xff1810, emissiveIntensity: 0 }),
  };
}
function lampMesh(T, geo, mat, name, pos, rot = [0, 0, 0]) {
  const m = new T.Mesh(geo, mat);
  m.name = name; m.position.set(...pos); m.rotation.set(...rot);
  m.castShadow = false; m.receiveShadow = false;
  return m;
}

// ---------------------------------------------------------------- contact shadow (baked soft AO footprint, no DOM needed)
// A ground-hugging plane (y = 0.006) with a procedurally baked alpha texture: soft footprint under the body plus darker
// contact blobs under every tyre. It never casts/receives shadows and is invisible to raycasts (LOS code is unaffected).
// spec: { L, W, rects: [[x0,x1,z0,z1,alpha,soft]], blobs: [[x,z,rx,rz,alpha]] } in vehicle-local metres.
function contactShadow(T, key, spec) {
  const c = cacheFor(T);
  c.shadow = c.shadow || {};
  if (!c.shadow[key]) {
    const pad = 0.7, PW = spec.W + 2 * pad, PL = spec.L + 2 * pad;
    const nx = 48, nz = Math.max(64, Math.min(320, Math.round(nx * PL / PW)));
    const data = new Uint8Array(nx * nz * 4);
    const sm = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = -PW / 2 + (i + 0.5) / nx * PW, z = -PL / 2 + (j + 0.5) / nz * PL;
      let keep = 1;
      for (const [x0, x1, z0, z1, a, soft = 0.45] of spec.rects) {
        const fx = sm(x0 - soft, x0 + soft * 0.4, x) * (1 - sm(x1 - soft * 0.4, x1 + soft, x));
        const fz = sm(z0 - soft, z0 + soft * 0.4, z) * (1 - sm(z1 - soft * 0.4, z1 + soft, z));
        keep *= 1 - a * fx * fz;
      }
      for (const [bx, bz, rx, rz, a] of spec.blobs) {
        const d = Math.hypot((x - bx) / rx, (z - bz) / rz);
        keep *= 1 - a * Math.exp(-d * d * 2.2);
      }
      const k = (j * nx + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = 0; data[k + 3] = Math.round((1 - keep) * 255);
    }
    const tex = new T.DataTexture(data, nx, nz, T.RGBAFormat);
    tex.magFilter = T.LinearFilter; tex.minFilter = T.LinearFilter; tex.needsUpdate = true;
    // Vertex positions are all at the origin and the quad is expanded in the vertex shader from a 'corner' attribute,
    // so Box3.setFromObject(vehicle[, precise]) and raycasts never see the shadow plane (catalog envelopes stay exact).
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array(12), 3));
    geo.setAttribute('corner', new T.BufferAttribute(new Float32Array([-PW / 2, -PL / 2, PW / 2, -PL / 2, PW / 2, PL / 2, -PW / 2, PL / 2]), 2));
    geo.setAttribute('uv', new T.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));   // v = 0 at the front (-Z) = data row 0
    geo.setAttribute('normal', new T.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
    geo.setIndex([0, 2, 1, 0, 3, 2]);
    geo.boundingSphere = new T.Sphere(new T.Vector3(), Math.hypot(PW, PL) / 2);
    geo.boundingBox = new T.Box3(new T.Vector3(), new T.Vector3());
    const mat = new T.MeshBasicMaterial({ color: 0x000000, map: tex, transparent: true, depthWrite: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, opacity: 0.85 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 corner;')
        .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position) + vec3(corner.x, 0.0, corner.y);');
    };
    mat.customProgramCacheKey = () => 'heavy_contact_shadow';
    mat.name = 'heavy_contact_shadow';
    c.shadow[key] = { geo, mat };
  }
  const { geo, mat } = c.shadow[key];
  const m = new T.Mesh(geo, mat);
  m.position.y = 0.006; m.renderOrder = -1;
  m.castShadow = false; m.receiveShadow = false;
  m.raycast = () => {};
  m.userData.noOcclude = true;
  return m;
}
function addContactShadow(T, root, key, spec, opts) {
  if (opts && opts.contactShadow === false) { root.userData.contactShadow = null; return; }
  const m = contactShadow(T, key, spec);
  m.name = root.name + '_contact_shadow';
  root.add(m);
  root.userData.contactShadow = m;
}
// blobs for a row of wheels at ±x (dual = wider blob)
const wheelBlobs = (x, zs, dual, R = 0.51) => zs.flatMap(z => [-1, 1].map(s => [s * x, z, dual ? 0.42 : 0.26, R * 0.55, 0.75]));

// ---------------------------------------------------------------- lamp glare halos (night "star" glow, additive sprites)
function haloTex(T) {
  const c = cacheFor(T);
  if (!c.halo) {
    const n = 64, d = new Uint8Array(n * n * 4);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = (i + 0.5) / n * 2 - 1, y = (j + 0.5) / n * 2 - 1, r = Math.hypot(x, y);
      const core = Math.exp(-r * r * 18), glow = Math.max(0, 1 - r) ** 2.4 * 0.55;
      const streak = Math.exp(-(y * y) * 900) * Math.max(0, 1 - Math.abs(x)) * 0.35 + Math.exp(-(x * x) * 900) * Math.max(0, 1 - Math.abs(y)) * 0.2;
      const v = Math.min(1, core + glow + streak);
      const k = (j * n + i) * 4; d[k] = d[k + 1] = d[k + 2] = 255; d[k + 3] = Math.round(v * 255);
    }
    c.halo = new T.DataTexture(d, n, n, T.RGBAFormat);
    c.halo.magFilter = T.LinearFilter; c.halo.minFilter = T.LinearFilter; c.halo.needsUpdate = true;
  }
  return c.halo;
}
const HALO_COLOR = { head: 0xfff1d8, tail: 0xff2a14, marker: 0xff2a14, amber: 0xffa020 };
const HALO_SIZE = { head: 1.1, tail: 0.6, marker: 0.42, amber: 0.42 };
// Camera-facing quad built in the vertex shader (positions all at the origin, so the halo never widens bounding boxes
// or blocks raycasts). Size = mesh scale (metres).
const HALO_VS = `attribute vec2 corner; varying vec2 vUv;
void main() { vUv = corner * 0.5 + 0.5; vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float s = length(modelMatrix[0].xyz); mv.xy += corner * 0.5 * s; mv.z += 0.05; gl_Position = projectionMatrix * mv; }`;
const HALO_FS = `uniform sampler2D map; uniform vec3 color; uniform float opacity; varying vec2 vUv;
void main() { float a = texture2D(map, vUv).a * opacity; gl_FragColor = vec4(color * a, a); }`;
function haloSprite(T, kind) {
  const c = cacheFor(T);
  c.haloMat = c.haloMat || {};
  if (!c.haloMat[kind]) {
    c.haloMat[kind] = new T.ShaderMaterial({ uniforms: { map: { value: haloTex(T) }, color: { value: new T.Color(HALO_COLOR[kind]) }, opacity: { value: kind === 'head' ? 0.95 : 0.85 } },
      vertexShader: HALO_VS, fragmentShader: HALO_FS, blending: T.AdditiveBlending, transparent: true, depthWrite: false });
    c.haloMat[kind].name = 'heavy_halo_' + kind;
  }
  if (!c.haloGeo) {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(new Float32Array(12), 3));
    g.setAttribute('corner', new T.BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.boundingSphere = new T.Sphere(new T.Vector3(), 0.75); g.boundingBox = new T.Box3(new T.Vector3(), new T.Vector3());
    c.haloGeo = g;
  }
  const sp = new T.Mesh(c.haloGeo, c.haloMat[kind]);
  sp.scale.setScalar(HALO_SIZE[kind] || 0.4);
  sp.raycast = () => {};
  sp.castShadow = false; sp.receiveShadow = false; sp.visible = false; sp.renderOrder = 10;
  sp.userData.noOcclude = true;
  return sp;
}
// wheel-well liner: dark inside of an arch cut through a body side profile, so you never see through the body
function wheelWell(B, T, z, R, archR, halfW, inset = 0.25) {
  const g = new T.CylinderGeometry(archR - 0.02, archR - 0.02, halfW * 2 - 0.04, 24, 1, true, 0, Math.PI);
  g.rotateZ(Math.PI / 2);                                  // axis -> X, half-shell (x>=0 half) -> top (y>=0)
  B.add('well', g, [0, R, z]);
  void inset;
}

// ---------------------------------------------------------------- TRUCK TRACTOR (conventional long-nose, mid-roof sleeper)
const TR = { front: -3.25, rear: 3.25, axF: -2.33, axD1: 1.40, axD2: 2.72, R: 0.51, fifthZ: 1.95, fifthY: 1.22 };
function buildTractor(T) {
  const B = new Builder(T);
  // chassis rails + crossmembers
  B.box2('frame', [0.38, 0.48], [0.80, 1.08], [-3.0, 3.22]);
  for (const z of [-2.9, -1.4, 0.6, 2.05, 3.15]) B.box('frame', [-0.38, 0.38], [0.84, 1.04], [z - 0.05, z + 0.05]);
  // front axle beam, drive axle housings, springs
  B.box('frame', [-0.95, 0.95], [0.42, 0.56], [TR.axF - 0.06, TR.axF + 0.06]);
  for (const z of [TR.axD1, TR.axD2]) { B.cyl('steelDark', 'x', 0.09, 1.7, [0, TR.R, z], 16); B.add('steelDark', new T.SphereGeometry(0.2, 16, 10), [0, TR.R, z], [0, 0, 0], [0.9, 1, 1]); }
  B.box2('steelDark', [0.36, 0.5], [0.66, 0.82], [TR.axD1 - 0.5, TR.axD2 + 0.4]);
  B.box2('steelDark', [0.36, 0.5], [0.62, 0.8], [TR.axF - 0.7, TR.axF + 0.7]);
  // chrome bumper (wraps the corners)
  B.add('chrome', planGeo(T, [[-1.2, -3.06, 0.1], [-0.6, -3.24, 0.4], [0.6, -3.24, 0.4], [1.2, -3.06, 0.1], [1.2, -2.94, 0], [-1.2, -2.94, 0]], 0.36, 0.76, 0.025));
  // hood (long nose) — centre section between the fenders
  const hood = [[-3.02, 0.78, 0], [-3.04, 1.74, 0.06], [-2.92, 1.84, 0.12], [-1.28, 2.04, 0.05], [-1.22, 0.78, 0]];
  B.add('paint', sideGeo(T, hood, 1.36, 0.1));
  // fenders with wheel arches
  const fender = [[-3.0, 0.88, 0], [-3.03, 1.24, 0.2], [-2.62, 1.47, 0.35], [-1.85, 1.48, 0.25], [-1.28, 1.32, 0.1], [-1.24, 0.86, 0], ['arch', TR.axF, TR.R, 0.64]];
  const fg = sideGeo(T, fender, 0.58, 0.12, 12);
  B.add('paint', fg, [0.95, 0, 0]); B.add('paint', fg, [-0.95, 0, 0]);
  // grille: chrome surround + dark mesh + horizontal bars
  const gw = 0.56, gy0 = 0.82, gy1 = 1.78;
  B.add('chrome', frontGeo(T, rrect(-gw - 0.06, gw + 0.06, gy0 - 0.05, gy1 + 0.05, 0.08), 0.05, 0.015, [rrect(-gw, gw, gy0, gy1, 0.05)]), [0, 0, -3.09]);
  B.box('grille', [-gw, gw], [gy0, gy1], [-3.05, -3.02]);
  for (let y = gy0 + 0.06; y < gy1 - 0.02; y += 0.075) B.box('chrome', [-gw + 0.01, gw - 0.01], [y, y + 0.018], [-3.075, -3.05]);
  // cab + sleeper (one aero profile), width 2.24
  const cabW = 2.24;
  const cab = [[-1.26, 1.02, 0], [-1.27, 2.0, 0.06], [-1.14, 2.1, 0.08], [-0.76, 2.94, 0.1], [-0.52, 3.05, 0.25], [0.42, 3.52, 0.35], [1.72, 3.58, 0.1], [1.76, 3.4, 0.05], [1.76, 1.02, 0]];
  B.add('paint', sideGeo(T, cab, cabW, 0.09, 10));
  // lower cab skirt / rocker in black
  B.box('trim', [-cabW / 2 + 0.02, cabW / 2 - 0.02], [0.98, 1.06], [-1.25, 1.74]);
  // windscreen (2-piece) and side glass
  windscreen(B, T, -1.13, 2.13, -0.79, 2.89, 1.96, 0.05, 0.06);
  const xs = cabW / 2;
  sideWindow(B, T, [[-1.0, 2.12, 0.04], [-0.72, 2.86, 0.08], [-0.2, 2.86, 0.06], [-0.2, 2.12, 0.04]], xs);
  sideWindow(B, T, [[-0.12, 2.3, 0.03], [-0.12, 2.86, 0.06], [0.22, 2.86, 0.04], [0.22, 2.3, 0.03]], xs);      // rear quarter
  sideWindow(B, T, [[0.75, 2.5, 0.05], [0.75, 2.85, 0.05], [1.25, 2.85, 0.05], [1.25, 2.5, 0.05]], xs, [-1, 1], 0.02); // sleeper bunk
  // door seams + handle, sleeper baggage door
  for (const s of [-1, 1]) {
    const x = s * (xs + 0.003);
    B.box('trim', [x - 0.004, x + 0.004], [1.1, 2.95], [-1.06, -1.05]);
    B.box('trim', [x - 0.004, x + 0.004], [1.1, 2.95], [0.27, 0.28]);
    B.box('chrome', [x - 0.012 * s, x + 0.012 * s].sort((a, b) => a - b), [1.86, 1.9], [0.05, 0.2]);
    B.box('trim', [x - 0.004, x + 0.004], [1.15, 1.8], [0.62, 0.63]);
    B.box('trim', [x - 0.004, x + 0.004], [1.15, 1.8], [1.32, 1.33]);
    B.box('trim', [x - 0.004, x + 0.004], [1.8, 1.81], [0.62, 1.33]);
    // cab extenders (side fairings at the sleeper's trailing edge)
    B.add('paint', sideGeo(T, [[1.5, 1.2, 0], [1.5, 3.45, 0.1], [1.86, 3.45, 0], [1.86, 1.2, 0]], 0.04, 0.0), [s * (cabW / 2 + 0.025), 0, 0]);
    // west-coast mirror on arms
    const mx = s * 1.34;
    B.box('chrome', [Math.min(s * 1.1, mx), Math.max(s * 1.1, mx)], [2.2, 2.23], [-1.0, -0.97]);
    B.box('chrome', [Math.min(s * 1.1, mx), Math.max(s * 1.1, mx)], [2.82, 2.85], [-1.0, -0.97]);
    B.add('trim', planGeo(T, [[mx - 0.05, -1.02, 0.02], [mx + 0.05, -1.02, 0.02], [mx + 0.05, -0.93, 0.02], [mx - 0.05, -0.93, 0.02]], 2.15, 2.9, 0.015));
    // hood-mounted convex mirror
    B.cyl('trim', 'y', 0.006, 0.25, [s * 1.12, 1.62, -2.75], 6);
    B.add('trim', new T.SphereGeometry(0.07, 12, 8), [s * 1.14, 1.76, -2.76], [0, 0, 0], [0.5, 1, 1]);
    // air cleaner canister (chrome) at the cowl
    B.cyl('chrome', 'y', 0.18, 0.66, [s * 0.98, 1.72, -1.47], 28);
    B.add('chrome', new T.SphereGeometry(0.18, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), [s * 0.98, 2.05, -1.47], [0, 0, 0], [1, 0.35, 1]);
    B.cyl('trim', 'y', 0.186, 0.035, [s * 0.98, 1.84, -1.47], 28);
    B.cyl('trim', 'z', 0.07, 0.3, [s * 0.82, 1.62, -1.35], 12);
    // hood side louvres (dark vent with chrome surround)
    B.box('chrome', [s * 0.672, s * 0.69].sort((a, b) => a - b), [1.5, 1.86], [-2.05, -1.45]);
    B.box('grille', [s * 0.68, s * 0.695].sort((a, b) => a - b), [1.53, 1.83], [-2.02, -1.48]);
    for (let y = 1.56; y < 1.82; y += 0.045) B.box('chrome', [s * 0.69, s * 0.7].sort((a, b) => a - b), [y, y + 0.012], [-2.0, -1.5]);
    // exhaust stack + heat shield behind the cab corners
    B.cyl('chrome', 'y', 0.065, 2.2, [s * 1.19, 2.45, 1.92], 16);
    B.cyl('alum', 'y', 0.085, 0.9, [s * 1.19, 2.2, 1.92], 16);
    B.cyl('chrome', 'z', 0.05, 0.3, [s * 1.19, 1.38, 1.8], 12);
    // fuel tank (polished aluminium) with straps, step box ahead of it
    B.cyl('alum', 'z', 0.32, 1.45, [s * 0.86, 0.74, -0.35], 28);
    for (const z of [-0.95, 0.25]) B.cyl('trim', 'z', 0.326, 0.06, [s * 0.86, 0.74, z], 28);
    B.box('alumDull', [s > 0 ? 0.62 : -1.2, s > 0 ? 1.2 : -0.62], [0.42, 1.02], [-1.3, -1.08]);
    for (const y of [0.52, 0.8]) B.box('alum', [s > 0 ? 0.7 : -1.21, s > 0 ? 1.21 : -0.7], [y, y + 0.03], [-1.32, -1.04]);
    // battery/tool box behind tank
    B.box('trim', [s > 0 ? 0.55 : -1.15, s > 0 ? 1.15 : -0.55], [0.48, 1.0], [0.48, 1.1]);
    // quarter fenders over drive tandem and mud flaps with chrome hangers
    B.add('trim', sideGeo(T, [[TR.axD1 - 0.62, 1.12, 0.05], [TR.axD1 - 0.62, 1.18, 0.05], [TR.axD1 + 0.15, 1.18, 0.05], [TR.axD1 + 0.15, 1.12, 0.05]], 0.62, 0.02), [s * 0.95, 0, 0]);
    mudflap(B, s > 0 ? 0.62 : -1.22, s > 0 ? 1.22 : -0.62, 3.2, 0.98, 0.2);
    B.box('chrome', [s > 0 ? 0.48 : -1.22, s > 0 ? 1.22 : -0.48], [0.98, 1.03], [3.18, 3.22]);
    // drive wheels (duals) + steer wheel
    addWheel(B, T, s * 1.1, TR.axF, { R: TR.R });
    addWheel(B, T, s * 1.1, TR.axD1, { R: TR.R, dual: true });
    addWheel(B, T, s * 1.1, TR.axD2, { R: TR.R, dual: true });
  }
  // fifth wheel (plate with V throat toward the rear) on its mount
  B.box2('steelDark', [0.3, 0.42], [1.08, 1.16], [TR.fifthZ - 0.35, TR.fifthZ + 0.35]);
  B.add('steelDark', planGeo(T, [[-0.46, TR.fifthZ - 0.45, 0.25], [0.46, TR.fifthZ - 0.45, 0.25], [0.46, TR.fifthZ + 0.42, 0.06], [0.08, TR.fifthZ + 0.42, 0], [0.0, TR.fifthZ, 0], [-0.08, TR.fifthZ + 0.42, 0], [-0.46, TR.fifthZ + 0.42, 0.06]], TR.fifthY - 0.06, TR.fifthY, 0.012));
  // deck plate between cab and fifth wheel, air lines (red/blue)
  B.box('alumDull', [-0.5, 0.5], [1.08, 1.12], [1.76, 1.45 + 0.06]);
  B.add('reflRed', new T.TorusGeometry(0.16, 0.012, 6, 20), [0.18, 1.6, 1.79]);
  B.add('panelWhite', new T.TorusGeometry(0.16, 0.012, 6, 20), [-0.18, 1.6, 1.79]);
  // rear crossmember
  B.box('frame', [-0.55, 0.55], [0.84, 1.0], [3.14, 3.24]);
  return B.build();
}

// ---------------------------------------------------------------- SEMITRAILER (53 ft dry van or flatbed)
const ST = { front: -8.1, rear: 8.1, kingpinZ: -7.19, kingpinY: 1.22, floorBot: 1.17, floorTop: 1.42, roof: 4.1, ax1: 5.55, ax2: 6.8, R: 0.51, legZ: -4.65 };
function buildTrailerCommon(B, T, deckBot, W) {
  const hw = W / 2;
  // upper coupler plate + kingpin
  B.box('steelDark', [-1.1, 1.1], [ST.kingpinY, deckBot + 0.02], [-8.08, -6.2]);
  B.cyl('steelDark', 'y', 0.045, 0.09, [0, ST.kingpinY - 0.045, ST.kingpinZ], 16);
  B.cyl('steelDark', 'y', 0.06, 0.02, [0, ST.kingpinY - 0.075, ST.kingpinZ], 16);
  // crossmembers (I-beams) every 0.3 m under the floor
  const cm = new T.BoxGeometry(W - 0.12, 0.1, 0.035), cf = new T.BoxGeometry(W - 0.12, 0.012, 0.09);
  for (let z = -6.1; z < 7.95; z += 0.3) {
    B.add('steelDark', cm, [0, deckBot - 0.05, z]);
    B.add('steelDark', cf, [0, deckBot - 0.1, z]);
  }
  // landing gear: two legs, braces, sand shoes, gearbox + crank (curb side, +X)
  for (const s of [-1, 1]) {
    const x = s * 0.82;
    B.box('steelDark', [x - 0.065, x + 0.065], [0.2, deckBot - 0.02], [ST.legZ - 0.065, ST.legZ + 0.065]);
    B.box('frame', [x - 0.05, x + 0.05], [0.07, 0.6], [ST.legZ - 0.05, ST.legZ + 0.05]);
    B.box('frame', [x - 0.13, x + 0.13], [0.0, 0.06], [ST.legZ - 0.14, ST.legZ + 0.14]);
    const bl = Math.hypot(0.9, deckBot - 0.6), ba = Math.atan2(0.9, deckBot - 0.6);
    B.box('steelDark', [x - 0.025, x + 0.025], [-bl / 2, bl / 2], [-0.025, 0.025], [0, 0, 0]);
    B.b.steelDark[B.b.steelDark.length - 1].applyMatrix4(new T.Matrix4().makeRotationX(ba)).translate(0, (deckBot + 0.6) / 2, ST.legZ - 0.45);
    // diagonal side brace leg -> centre
  }
  B.box('steelDark', [-0.82, 0.82], [0.55, 0.62], [ST.legZ - 0.03, ST.legZ + 0.03]);
  B.box('steelDark', [0.82, 1.0], [0.85, 1.0], [ST.legZ - 0.08, ST.legZ + 0.08]);
  B.cyl('steelDark', 'x', 0.015, 0.35, [1.12, 0.9, ST.legZ], 8);
  B.box('steelDark', [1.28, 1.31], [0.62, 0.92], [ST.legZ - 0.015, ST.legZ + 0.015]);
  // sliding tandem: rails, hangers, axles, air springs
  B.box2('steelDark', [0.42, 0.55], [deckBot - 0.24, deckBot - 0.1], [4.3, 7.75]);
  for (const z of [ST.ax1, ST.ax2]) {
    B.cyl('steelDark', 'x', 0.065, 1.9, [0, ST.R, z], 14);
    for (const s of [-1, 1]) {
      B.box('steelDark', [s * 0.42, s * 0.55].sort((a, b) => a - b), [ST.R, deckBot - 0.24], [z - 0.45, z - 0.35]);
      B.box('steelDark', [s * 0.43, s * 0.54].sort((a, b) => a - b), [ST.R - 0.05, ST.R + 0.07], [z - 0.45, z + 0.3]);
      B.cyl('rubber', 'y', 0.13, 0.25, [s * 0.49, deckBot - 0.37, z + 0.28], 16);
      addWheel(B, T, s * (hw - 0.17), z, { R: ST.R, dual: true, rim: 'steel' });
    }
  }
  for (const s of [-1, 1]) mudflap(B, s > 0 ? 0.68 : -hw + 0.06, s > 0 ? hw - 0.06 : -0.68, 7.5, deckBot - 0.25, 0.25);
  B.box('steelDark', [-hw + 0.06, hw - 0.06], [deckBot - 0.3, deckBot - 0.24], [7.48, 7.52]);
  // rear underride guard (ICC bar; bottom edge 0.42 m < 22 in), struts + braces, conspicuity tape on the bar
  B.box('steelDark', [-1.13, 1.13], [0.42, 0.56], [7.92, 8.04]);
  for (const x of [-0.92, -0.5, 0.5, 0.92]) B.box('steelDark', [x - 0.04, x + 0.04], [0.56, deckBot], [7.94, 8.02]);
  for (let i = 0; i < 12; i++) { const x0 = -1.12 + i * (2.24 / 12); B.box(i % 2 ? 'reflWhite' : 'reflRed', [x0, x0 + 2.24 / 12], [0.44, 0.54], [8.04, 8.047]); }
}
function conspicuityStrip(B, z0, z1, y0, y1, x, side) {
  // DOT-C2: alternating 18 cm white / 28 cm red, slightly proud of the panel
  const xs = [x, x + side * 0.006].sort((a, b) => a - b);
  let z = z0, red = true;
  while (z < z1 - 0.01) { const L = red ? 0.28 : 0.18; const ze = Math.min(z1, z + L); B.box(red ? 'reflRed' : 'reflWhite', xs, [y0, y1], [z, ze]); z = ze + 0.0; red = !red; }
}
function buildBoxTrailer(T) {
  const B = new Builder(T);
  const W = 2.6, hw = W / 2;
  buildTrailerCommon(B, T, ST.floorBot, W);
  // box shell (aluminium sheet & post exterior)
  B.box('panelWhite', [-hw + 0.012, hw - 0.012], [ST.floorBot + 0.2, ST.roof - 0.1], [ST.front + 0.04, ST.rear - 0.07]);
  // top rails (rounded extrusion) & bottom rails
  for (const s of [-1, 1]) {
    B.add('alum', sideGeo(T, [[ST.front, ST.roof - 0.13, 0], [ST.front, ST.roof, 0.04], [ST.rear, ST.roof, 0.04], [ST.rear, ST.roof - 0.13, 0]], 0.08, 0.025), [s * (hw - 0.04), 0, 0]);
    B.add('alum', sideGeo(T, [[ST.front, ST.floorBot, 0], [ST.front, ST.floorBot + 0.27, 0], [ST.rear, ST.floorBot + 0.27, 0], [ST.rear, ST.floorBot, 0]], 0.06, 0.015), [s * (hw - 0.03), 0, 0]);
    // exterior posts every 0.61 m (24 in)
    const post = new T.BoxGeometry(0.014, ST.roof - 0.13 - ST.floorBot - 0.27, 0.075);
    for (let z = ST.front + 0.6; z < ST.rear - 0.4; z += 0.61) B.add('alumDull', post, [s * (hw - 0.002), (ST.roof - 0.13 + ST.floorBot + 0.27) / 2, z]);
    conspicuityStrip(B, ST.front + 0.3, ST.rear - 0.2, ST.floorBot + 0.08, ST.floorBot + 0.13, s * (hw + 0.002), s);
  }
  // front wall: corner caps + horizontal rib
  B.box('alum', [-hw, hw], [ST.floorBot, ST.roof], [ST.front, ST.front + 0.05]);
  for (const s of [-1, 1]) B.box('alumDull', [s > 0 ? hw - 0.09 : -hw, s > 0 ? hw : -hw + 0.09], [ST.floorBot, ST.roof], [ST.front - 0.01, ST.front + 0.06]);
  for (const y of [2.1, 3.0]) B.box('alumDull', [-hw + 0.1, hw - 0.1], [y, y + 0.04], [ST.front - 0.012, ST.front]);
  B.box('trim', [-0.08, 0.08], [1.55, 1.75], [ST.front - 0.03, ST.front]);    // 7-way receptacle + gladhands
  // rear frame: header, sill, corner posts, two swing doors with lock rods and hinges
  const rz = ST.rear;
  B.box('alum', [-hw, hw], [ST.floorBot, ST.floorTop + 0.02], [rz - 0.12, rz]);       // rear sill
  B.box('alum', [-hw, hw], [ST.roof - 0.25, ST.roof], [rz - 0.12, rz]);                // header
  B.box2('alum', [hw - 0.1, hw], [ST.floorBot, ST.roof], [rz - 0.12, rz]);            // corner posts
  // two swing ("barn") doors, each with two vertical lock rods: rod guides, top/bottom cam keepers, a handle on its
  // retainer, 4 hinges on the outer edge, door gasket seam; DOT-C2 upper-corner L marks.
  const dY0 = ST.floorTop + 0.02, dY1 = ST.roof - 0.25, rodTop = dY1 + 0.12, rodBot = ST.floorBot + 0.04;
  for (const s of [-1, 1]) {
    const x0 = s > 0 ? 0.008 : -hw + 0.1, x1 = s > 0 ? hw - 0.1 : -0.008;
    B.box('panelWhite', [x0, x1], [dY0, dY1], [rz - 0.06, rz - 0.02]);
    // door skin stiffener ribs (horizontal, shallow)
    for (const y of [1.95, 2.65, 3.35]) B.box('alumDull', [x0 + 0.04, x1 - 0.04], [y, y + 0.03], [rz - 0.02, rz - 0.012]);
    // gasket seam around the door
    B.box('trim', [x0, x1], [dY0 - 0.012, dY0], [rz - 0.03, rz - 0.015]);
    B.box('trim', [x0, x1], [dY1, dY1 + 0.012], [rz - 0.03, rz - 0.015]);
    for (const f of [0.26, 0.74]) {
      const x = x0 + (x1 - x0) * f;
      B.cyl('chrome', 'y', 0.017, rodTop - rodBot, [x, (rodTop + rodBot) / 2, rz + 0.012], 12);
      // cam keepers (top in the header, bottom in the sill) + rod guides
      for (const y of [rodTop - 0.06, rodBot + 0.05]) B.box('steelDark', [x - 0.04, x + 0.04], [y - 0.05, y + 0.05], [rz - 0.005, rz + 0.04]);
      for (const y of [2.3, 3.05, 3.65]) B.box('steelDark', [x - 0.032, x + 0.032], [y, y + 0.04], [rz - 0.02, rz + 0.032]);
      // handle (folded flat, pointing toward the door's centre line) + its retainer catch
      const hx = s > 0 ? x - 0.3 : x + 0.3;
      B.box('steelDark', [Math.min(x, hx), Math.max(x, hx)], [1.72, 1.765], [rz + 0.022, rz + 0.042]);
      B.box('steelDark', [x - 0.03, x + 0.03], [1.69, 1.8], [rz - 0.005, rz + 0.035]);
      B.box('alumDull', [hx - 0.035, hx + 0.035], [1.68, 1.81], [rz - 0.01, rz + 0.03]);
    }
    for (const y of [1.75, 2.45, 3.15, 3.7]) B.box('steelDark', [s > 0 ? hw - 0.2 : -hw + 0.02, s > 0 ? hw - 0.02 : -hw + 0.2], [y, y + 0.08], [rz - 0.01, rz + 0.025]);
    // DOT-C2 upper corner L marks and lower rear tape
    B.box('reflWhite', [s > 0 ? hw - 0.32 : -hw + 0.02, s > 0 ? hw - 0.02 : -hw + 0.32], [ST.roof - 0.12, ST.roof - 0.07], [rz + 0.001, rz + 0.006]);
    B.box('reflWhite', [s > 0 ? hw - 0.07 : -hw + 0.02, s > 0 ? hw - 0.02 : -hw + 0.07], [ST.roof - 0.42, ST.roof - 0.07], [rz + 0.001, rz + 0.006]);
  }
  // licence plate + lamp bracket (curb-side door, lower)
  B.box('panelWhite', [0.3, 0.6], [1.5, 1.65], [rz + 0.02, rz + 0.026]);
  B.box('steelDark', [0.28, 0.62], [1.65, 1.68], [rz, rz + 0.04]);
  B.box('trim', [-0.008, 0.008], [ST.floorTop, ST.roof - 0.25], [rz - 0.02, rz + 0.005]);
  for (let i = 0; i < 14; i++) { const x0 = -hw + 0.12 + i * ((W - 0.24) / 14); B.box(i % 2 ? 'reflWhite' : 'reflRed', [x0, x0 + (W - 0.24) / 14], [ST.floorBot + 0.04, ST.floorBot + 0.1], [rz + 0.001, rz + 0.006]); }
  return B.build();
}
function buildFlatbed(T) {
  const B = new Builder(T);
  const W = 2.6, hw = W / 2, deck = 1.52, beamTop = deck - 0.06;
  buildTrailerCommon(B, T, beamTop - 0.18, W);
  // main I-beams (cambered, deep in the middle, tapering at the ends)
  const beam = [[-8.1, beamTop - 0.22, 0], [-6.2, beamTop - 0.3, 0.4], [-3.0, beamTop - 0.52, 1.2], [3.5, beamTop - 0.52, 1.2], [7.0, beamTop - 0.3, 0.4], [8.1, beamTop - 0.24, 0], [8.1, beamTop, 0], [-8.1, beamTop, 0]];
  for (const s of [-1, 1]) B.add('steelDark', sideGeo(T, beam, 0.12, 0.0), [s * 0.5, 0, 0]);
  // side rails with stake pockets
  for (const s of [-1, 1]) {
    B.add('alum', sideGeo(T, [[-8.1, deck - 0.24, 0], [-8.1, deck, 0], [8.1, deck, 0], [8.1, deck - 0.24, 0]], 0.08, 0.012), [s * (hw - 0.04), 0, 0]);
    for (let z = -7.7; z < 7.9; z += 0.61) B.box('hole', [s > 0 ? hw - 0.002 : -hw - 0.004, s > 0 ? hw + 0.004 : -hw + 0.002], [deck - 0.1, deck - 0.04], [z - 0.04, z + 0.04]);
    conspicuityStrip(B, -7.9, 7.9, deck - 0.2, deck - 0.15, s * (hw + 0.002), s);
  }
  // wooden deck planks
  const nP = 14;
  for (let i = 0; i < nP; i++) {
    const x0 = -hw + 0.08 + i * ((W - 0.16) / nP), x1 = x0 + (W - 0.16) / nP - 0.008;
    B.box('wood', [x0, x1], [deck - 0.05, deck - 0.005], [-8.05, 8.05]);
  }
  B.box('alum', [-hw, hw], [deck - 0.25, deck], [7.98, 8.1]);           // rear sill
  B.box('alum', [-hw, hw], [deck - 0.25, deck], [-8.1, -8.0]);          // front sill
  for (let i = 0; i < 14; i++) { const x0 = -hw + 0.12 + i * ((W - 0.24) / 14); B.box(i % 2 ? 'reflWhite' : 'reflRed', [x0, x0 + (W - 0.24) / 14], [deck - 0.2, deck - 0.14], [8.1, 8.106]); }
  return B.build();
}

// ---------------------------------------------------------------- BOX TRUCK (class 6/7 conventional, 26 ft-class straight truck)
const BT = { front: -3.75, rear: 3.75, axF: -2.85, axR: 2.05, R: 0.47, boxF: -0.85, boxBot: 1.08, boxTop: 3.4 };
function buildBoxTruck(T) {
  const B = new Builder(T);
  const W = 2.5, hw = W / 2, cabW = 2.3;
  B.box2('frame', [0.38, 0.47], [0.62, 0.88], [-3.5, 3.6]);
  for (const z of [-3.4, -1.0, 0.8, 2.6, 3.55]) B.box('frame', [-0.38, 0.38], [0.66, 0.84], [z - 0.04, z + 0.04]);
  B.box('frame', [-0.9, 0.9], [0.36, 0.48], [BT.axF - 0.05, BT.axF + 0.05]);
  B.cyl('steelDark', 'x', 0.08, 1.6, [0, BT.R, BT.axR], 14);
  B.add('steelDark', new T.SphereGeometry(0.18, 14, 10), [0, BT.R, BT.axR]);
  // bumper
  B.add('chrome', planGeo(T, [[-1.12, -3.6, 0.1], [-0.6, -3.74, 0.4], [0.6, -3.74, 0.4], [1.12, -3.6, 0.1], [1.12, -3.48, 0], [-1.12, -3.48, 0]], 0.36, 0.7, 0.02));
  // sloped aero hood with integrated fenders + wheel arches
  const hood = [[-3.5, 0.72, 0], [-3.56, 1.38, 0.12], [-3.4, 1.58, 0.2], [-2.62, 1.78, 0.08], [-2.5, 0.72, 0], ['arch', BT.axF, BT.R, 0.6]];
  B.add('paint', sideGeo(T, hood, 2.2, 0.16, 12));
  wheelWell(B, T, BT.axF, BT.R, 0.6, 1.08);
  // grille
  B.add('chrome', frontGeo(T, rrect(-0.5, 0.5, 0.78, 1.42, 0.06), 0.04, 0.01, [rrect(-0.44, 0.44, 0.83, 1.37, 0.04)]), [0, 0, -3.59]);
  B.box('grille', [-0.44, 0.44], [0.83, 1.37], [-3.56, -3.53]);
  for (let y = 0.88; y < 1.36; y += 0.07) B.box('steelDark', [-0.43, 0.43], [y, y + 0.02], [-3.575, -3.555]);
  // cab
  const cab = [[-2.6, 0.95, 0], [-2.6, 1.76, 0.05], [-2.5, 1.84, 0.06], [-2.18, 2.66, 0.08], [-2.02, 2.78, 0.15], [-1.0, 2.8, 0.1], [-0.95, 0.95, 0]];
  B.add('paint', sideGeo(T, cab, cabW, 0.09, 10));
  B.box('trim', [-cabW / 2 + 0.03, cabW / 2 - 0.03], [0.9, 0.98], [-2.55, -0.98]);
  windscreen(B, T, -2.48, 1.87, -2.2, 2.6, 2.0, 0.0, 0.07);
  sideWindow(B, T, [[-2.36, 1.86, 0.04], [-2.12, 2.6, 0.06], [-1.35, 2.62, 0.05], [-1.35, 1.86, 0.04]], cabW / 2);
  sideWindow(B, T, [[-1.25, 2.12, 0.03], [-1.25, 2.6, 0.04], [-1.08, 2.6, 0.03], [-1.08, 2.12, 0.03]], cabW / 2);
  for (const s of [-1, 1]) {
    const x = s * (cabW / 2 + 0.003);
    B.box('trim', [x - 0.004, x + 0.004], [1.0, 2.7], [-2.42, -2.41]);
    B.box('trim', [x - 0.004, x + 0.004], [1.0, 2.7], [-1.3, -1.29]);
    B.box('chrome', [x - 0.01, x + 0.01], [1.72, 1.75], [-1.5, -1.38]);
    // mirrors
    const mx = s * 1.3;
    B.box('trim', [Math.min(s * 1.12, mx), Math.max(s * 1.12, mx)], [2.0, 2.03], [-2.3, -2.27]);
    B.box('trim', [Math.min(s * 1.12, mx), Math.max(s * 1.12, mx)], [2.5, 2.53], [-2.3, -2.27]);
    B.add('trim', planGeo(T, [[mx - 0.05, -2.32, 0.02], [mx + 0.05, -2.32, 0.02], [mx + 0.05, -2.24, 0.02], [mx - 0.05, -2.24, 0.02]], 1.95, 2.6, 0.015));
    // step + tank (left) / battery box (right)
    B.box('alumDull', [s > 0 ? 0.75 : -1.17, s > 0 ? 1.17 : -0.75], [0.42, 0.62], [-1.9, -1.3]);
    if (s < 0) { B.cyl('alum', 'z', 0.27, 0.95, [-0.88, 0.62, -0.55], 24); for (const z of [-0.95, -0.15]) B.cyl('trim', 'z', 0.276, 0.05, [-0.88, 0.62, z], 24); }
    else B.box('trim', [0.6, 1.1], [0.38, 0.82], [-0.9, -0.2]);
    addWheel(B, T, s * 1.05, BT.axF, { R: BT.R, w: 0.25, Rr: 0.25 });
    addWheel(B, T, s * 1.07, BT.axR, { R: BT.R, w: 0.25, Rr: 0.25, dual: true });
    mudflap(B, s > 0 ? 0.62 : -1.2, s > 0 ? 1.2 : -0.62, 2.62, 0.95, 0.24);
  }
  // cargo box: FRP panels, aluminium corner caps, rails, scuff band
  const zf = BT.boxF, zr = BT.rear;
  B.box('frp', [-hw + 0.01, hw - 0.01], [BT.boxBot + 0.02, BT.boxTop - 0.02], [zf + 0.01, zr - 0.08]);
  for (const s of [-1, 1]) {
    B.box('alum', [s > 0 ? hw - 0.04 : -hw, s > 0 ? hw : -hw + 0.04], [BT.boxTop - 0.1, BT.boxTop], [zf, zr]);
    B.box('alum', [s > 0 ? hw - 0.04 : -hw, s > 0 ? hw : -hw + 0.04], [BT.boxBot, BT.boxBot + 0.16], [zf, zr]);
    B.box('alum', [s > 0 ? hw - 0.06 : -hw, s > 0 ? hw : -hw + 0.06], [BT.boxBot, BT.boxTop], [zf, zf + 0.06]);
    B.box('alum', [s > 0 ? hw - 0.1 : -hw, s > 0 ? hw : -hw + 0.1], [BT.boxBot, BT.boxTop], [zr - 0.1, zr]);
    conspicuityStrip(B, zf + 0.2, zr - 0.2, BT.boxBot + 0.05, BT.boxBot + 0.1, s * (hw + 0.002), s);
    B.box('trim', [s > 0 ? hw - 0.25 : -hw, s > 0 ? hw : -hw + 0.25], [BT.boxBot - 0.1, BT.boxBot], [zf + 0.3, zr - 0.3]);   // under-box rub rail
  }
  B.box('alum', [-hw, hw], [BT.boxTop - 0.1, BT.boxTop], [zf, zf + 0.06]);
  // rear: roll-up door (ribbed), header, sill, step bumper + ICC bar
  B.box('alum', [-hw, hw], [BT.boxTop - 0.28, BT.boxTop], [zr - 0.1, zr]);
  B.box('alum', [-hw, hw], [BT.boxBot, BT.boxBot + 0.12], [zr - 0.1, zr]);
  B.box('panelWhite', [-hw + 0.1, hw - 0.1], [BT.boxBot + 0.12, BT.boxTop - 0.28], [zr - 0.06, zr - 0.03]);
  for (let y = BT.boxBot + 0.12 + 0.3; y < BT.boxTop - 0.3; y += 0.3) B.box('alumDull', [-hw + 0.1, hw - 0.1], [y - 0.008, y + 0.008], [zr - 0.03, zr - 0.02]);
  B.box('steelDark', [-0.12, 0.12], [BT.boxBot + 0.2, BT.boxBot + 0.26], [zr - 0.03, zr]);
  B.box('alumDull', [-1.05, 1.05], [0.48, 0.6], [zr - 0.25, zr]);
  for (const x of [-0.7, 0.7]) B.box('steelDark', [x - 0.04, x + 0.04], [0.6, BT.boxBot], [zr - 0.2, zr - 0.12]);
  for (let i = 0; i < 10; i++) { const x0 = -1.05 + i * 0.21; B.box(i % 2 ? 'reflWhite' : 'reflRed', [x0, x0 + 0.21], [0.5, 0.58], [zr, zr + 0.006]); }
  return B.build();
}

// ---------------------------------------------------------------- BUS (transit low-floor, or school bus type C)
const BU = { front: -6.1, rear: 6.1, R: 0.5 };
function buildTransit(T) {
  const B = new Builder(T);
  const W = 2.55, hw = W / 2, axF = -3.55, axR = 2.75;
  const body = [[-6.1, 0.32, 0.12], [-6.1, 2.15, 0], [-6.03, 2.94, 0.18], [-5.75, 3.02, 0.12], [6.1, 3.02, 0.14], [6.1, 0.32, 0.12], ['arch', axR, BU.R, 0.62], ['arch', axF, BU.R, 0.6]];
  // node order runs front-bottom -> up -> roof -> rear -> bottom back toward front: arches must be ordered rear->front
  B.add('paint', sideGeo(T, body, W, 0.14, 12));
  // lower skirt/bumper band, interrupted at the wheel arches; dark wheel-well liners inside the arches
  for (const [z0, z1] of [[-5.95, axF - 0.62], [axF + 0.62, axR - 0.64], [axR + 0.64, 5.95]]) {
    B.box('trim', [-hw + 0.03, hw - 0.03], [0.3, 0.6], [z0, z1]);
    for (const s of [-1, 1]) B.box('trim', s > 0 ? [hw - 0.005, hw + 0.005] : [-hw - 0.005, -hw + 0.005], [0.32, 0.62], [z0, z1]);
  }
  wheelWell(B, T, axF, BU.R, 0.6, hw - 0.02); wheelWell(B, T, axR, BU.R, 0.62, hw - 0.02);
  // roof HVAC pod + rear engine-door louvres
  B.add('panelWhite', planGeo(T, [[-0.95, -1.9, 0.3], [0.95, -1.9, 0.3], [0.95, 1.4, 0.2], [-0.95, 1.4, 0.2]], 3.0, 3.2, 0.07));
  B.box('trim', [-1.0, 1.0], [0.75, 1.35], [6.1, 6.115]);
  for (let y = 0.8; y < 1.33; y += 0.06) B.box('steelDark', [-0.95, 0.95], [y, y + 0.025], [6.115, 6.125]);
  // front: windscreen, destination sign, bumper
  B.add('trim', frontGeo(T, rrect(-1.2, 1.2, 0.78, 2.96, 0.14), 0.012), [0, 0, -6.115]);
  B.add('glass', frontGeo(T, rrect(-1.15, 1.15, 0.85, 2.58, 0.1), 0.012), [0, 0, -6.125]);
  B.add('ledSign', frontGeo(T, rrect(-1.0, 1.0, 2.64, 2.9, 0.03), 0.01), [0, 0, -6.125]);
  B.box('trim', [-1.23, 1.23], [0.28, 0.62], [-6.18, -6.05]);
  // rear window
  B.add('trim', frontGeo(T, rrect(-1.05, 1.05, 2.05, 2.85, 0.1), 0.012), [0, 0, 6.1 + 0.002]);
  B.add('glass', frontGeo(T, rrect(-1.0, 1.0, 2.1, 2.8, 0.08), 0.012), [0, 0, 6.1 + 0.006]);
  // side window band: driver side (-X) continuous; curb side (+X) interrupted by front + rear doors
  const winY0 = 1.32, winY1 = 2.62;
  const panes = (z0, z1, n) => { const out = []; const L = (z1 - z0) / n; for (let i = 0; i < n; i++) out.push([z0 + i * L + 0.04, z0 + (i + 1) * L - 0.04]); return out; };
  sideWindow(B, T, rrect(-5.55, -4.85, 1.05, winY1, 0.05).map(n => [n[0], n[1], n[2]]), hw, [-1], 0);   // driver window, deeper
  for (const [a, b] of panes(-4.7, 5.5, 8)) sideWindow(B, T, rrect(a, b, winY0, winY1, 0.06), hw, [-1], 0.02);
  for (const [a, b] of [...panes(-4.4, 0.7, 4), ...panes(2.05, 5.5, 3)]) sideWindow(B, T, rrect(a, b, winY0, winY1, 0.06), hw, [1], 0.02);
  // curb-side doors (double-leaf glass): front ahead of the front axle, rear in mid-body
  for (const [z0, z1] of [[-5.95, -4.6], [0.82, 1.95]]) {
    const zm = (z0 + z1) / 2;
    B.add('alumDull', sideGeo(T, rrect(z0, z1, 0.36, 2.78, 0.04), 0.014, 0), [hw + 0.006, 0, 0]);
    for (const [a, b] of [[z0 + 0.06, zm - 0.02], [zm + 0.02, z1 - 0.06]]) B.add('glass', sideGeo(T, rrect(a, b, 0.48, 2.62, 0.05), 0.012, 0), [hw + 0.014, 0, 0]);
    B.box('trim', [hw + 0.012, hw + 0.022], [0.36, 2.78], [zm - 0.02, zm + 0.02]);
  }
  // mirrors (forward-mounted on arms)
  for (const s of [-1, 1]) {
    B.box('trim', [Math.min(s * 1.1, s * 1.42), Math.max(s * 1.1, s * 1.42)], [2.5, 2.54], [-6.25, -6.21]);
    B.add('trim', planGeo(T, [[s * 1.42 - 0.07, -6.3, 0.03], [s * 1.42 + 0.07, -6.3, 0.03], [s * 1.42 + 0.07, -6.2, 0.03], [s * 1.42 - 0.07, -6.2, 0.03]], 2.0, 2.55, 0.02));
    addWheel(B, T, s * 1.1, axF, { R: BU.R, w: 0.3, Rr: 0.286 });
    addWheel(B, T, s * 1.1, axR, { R: BU.R, w: 0.28, dual: true });
  }
  B.cyl('steelDark', 'x', 0.08, 1.7, [0, BU.R, axR], 14);
  B.box('steelDark', [-0.9, 0.9], [0.4, 0.55], [axF - 0.06, axF + 0.06]);
  return { geo: B.build(), axF, axR };
}
function buildSchoolBus(T) {
  const B = new Builder(T);
  const W = 2.5, hw = W / 2, axF = -5.0, axR = 2.0, R = 0.5;
  B.box2('frame', [0.4, 0.5], [0.55, 0.82], [-5.95, 5.9]);
  // body shell (high floor), wheel arches
  const body = [[-4.85, 0.78, 0], [-4.86, 2.12, 0], [-4.74, 3.02, 0.25], [-4.4, 3.2, 0.25], [5.9, 3.2, 0.25], [6.1, 3.0, 0.18], [6.1, 0.78, 0.06], ['arch', axR, R, 0.62]];
  B.add('paint', sideGeo(T, body, W, 0.08, 12));
  // hood + fenders (yellow), black grille, bumper
  const hood = [[-6.02, 0.82, 0], [-6.05, 1.34, 0.12], [-5.9, 1.5, 0.15], [-4.95, 1.7, 0.05], [-4.84, 0.82, 0], ['arch', axF, R, 0.62]];
  B.add('paint', sideGeo(T, hood, 2.3, 0.15, 12));
  wheelWell(B, T, axF, R, 0.62, 1.13); wheelWell(B, T, axR, R, 0.62, hw - 0.02);
  B.add('chrome', frontGeo(T, rrect(-0.5, 0.5, 0.86, 1.36, 0.06), 0.04, 0.01, [rrect(-0.44, 0.44, 0.9, 1.32, 0.04)]), [0, 0, -6.08]);
  B.box('grille', [-0.44, 0.44], [0.9, 1.32], [-6.05, -6.02]);
  for (let y = 0.94; y < 1.31; y += 0.06) B.box('chrome', [-0.43, 0.43], [y, y + 0.015], [-6.065, -6.045]);
  B.add('trim', planGeo(T, [[-1.22, -6.0, 0.08], [-0.6, -6.18, 0.4], [0.6, -6.18, 0.4], [1.22, -6.0, 0.08], [1.22, -5.9, 0], [-1.22, -5.9, 0]], 0.45, 0.82, 0.02));
  // black rub rails + window band surround
  for (const s of [-1, 1]) {
    const x = s * (hw + 0.004);
    for (const y of [0.95, 1.38]) B.box('trim', [x - 0.012, x + 0.012], [y, y + 0.07], [-4.8, 6.06]);
    B.box('trim', [x - 0.006, x + 0.006], [1.62, 1.66], [-4.8, 6.06]);
  }
  B.box('trim', [-hw + 0.04, hw - 0.04], [0.78, 0.86], [-4.86, 6.06]);
  // windows: split-sash passenger windows
  const winY0 = 1.75, winY1 = 2.55;
  const nW = 11, z0 = -3.55, z1 = 5.6, L = (z1 - z0) / nW;
  for (let i = 0; i < nW; i++) {
    const a = z0 + i * L + 0.05, b = z0 + (i + 1) * L - 0.05;
    for (const s of [-1, 1]) {
      if (s > 0 && i === 0) continue;
      sideWindow(B, T, rrect(a, b, winY0, winY1, 0.06), hw, [s], 0.025);
      B.box('alumDull', s > 0 ? [hw + 0.008, hw + 0.016] : [-hw - 0.016, -hw - 0.008], [2.2, 2.23], [a, b]);
    }
  }
  // driver window (left) and entry door (right, split glass)
  sideWindow(B, T, rrect(-4.65, -3.75, 1.7, 2.6, 0.06), hw, [-1], 0.025);
  B.add('trim', sideGeo(T, rrect(-4.75, -3.72, 0.82, 2.65, 0.03), 0.012, 0), [hw + 0.006, 0, 0]);
  for (const [a, b] of [[-4.7, -4.25], [-4.21, -3.77]]) for (const [y0, y1] of [[0.9, 1.65], [1.72, 2.58]]) B.add('glass', sideGeo(T, rrect(a, b, y0, y1, 0.03), 0.012, 0), [hw + 0.014, 0, 0]);
  // windscreen (2 panes), front cap
  windscreen(B, T, -4.84, 2.12, -4.74, 2.82, 2.2, 0.06, 0.06);
  // rear emergency door + rear windows
  B.add('trim', frontGeo(T, rrect(-0.5, 0.5, 0.95, 2.75, 0.04), 0.012), [0, 0, 6.1 + 0.002]);
  B.add('glass', frontGeo(T, rrect(-0.44, 0.44, 1.95, 2.65, 0.05), 0.012), [0, 0, 6.1 + 0.006]);
  for (const s of [-1, 1]) B.add('glass', frontGeo(T, rrect(s > 0 ? 0.62 : -1.1, s > 0 ? 1.1 : -0.62, 1.95, 2.55, 0.05), 0.012), [0, 0, 6.1 + 0.006]);
  B.box('trim', [-1.2, 1.2], [0.55, 0.8], [6.08, 6.2]);
  // folded stop arm (driver side) — red octagon plate
  const oct = []; for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; oct.push([-4.3 + Math.cos(a) * 0.23, 1.9 + Math.sin(a) * 0.23, 0]); }
  B.add('redSign', sideGeo(T, oct, 0.02, 0), [-hw - 0.03, 0, 0]);
  // crossing arm at front bumper (folded) + mirrors
  B.box('steelDark', [0.6, 1.0], [0.62, 0.66], [-6.2, -6.16]);
  for (const s of [-1, 1]) {
    B.cyl('trim', 'y', 0.012, 0.9, [s * 1.38, 2.0, -4.9], 6);
    B.add('trim', planGeo(T, [[s * 1.38 - 0.05, -4.96, 0.02], [s * 1.38 + 0.05, -4.96, 0.02], [s * 1.38 + 0.05, -4.86, 0.02], [s * 1.38 - 0.05, -4.86, 0.02]], 1.85, 2.4, 0.015));
    B.box('trim', [Math.min(s * 1.25, s * 1.38), Math.max(s * 1.25, s * 1.38)], [2.3, 2.33], [-4.92, -4.89]);
    B.add('trim', new T.SphereGeometry(0.1, 12, 8), [s * 0.95, 1.62, -5.95], [0, 0, 0], [1, 1, 0.5]); // crossover mirrors on hood
    addWheel(B, T, s * 1.04, axF, { R, w: 0.28 });
    addWheel(B, T, s * 1.06, axR, { R, w: 0.28, dual: true });
    mudflap(B, s > 0 ? 0.65 : -1.2, s > 0 ? 1.2 : -0.65, 2.65, 0.75, 0.22);
  }
  B.cyl('steelDark', 'x', 0.08, 1.6, [0, R, axR], 14);
  return { geo: B.build(), axF, axR };
}

// ---------------------------------------------------------------- assembly
function assemble(T, id, type, variant, geoByMat, paintHex, dims) {
  const M = mats(T);
  const root = new T.Group();
  root.name = id || type;
  const body = new T.Group(); body.name = (id || type) + '_body'; root.add(body);
  for (const k in geoByMat) {
    const mat = k === 'paint' ? paint(T, paintHex) : M[k];
    const mesh = new T.Mesh(geoByMat[k], mat);
    mesh.name = `${root.name}_${k}`;
    mesh.castShadow = k !== 'glass' && k !== 'hole';
    mesh.receiveShadow = true;
    body.add(mesh);
  }
  const wheels = [];
  for (const w of geoByMat.__wheels || []) {
    const wh = SHARED.makeWheel(T, { radius: w.radius, width: w.width, rim: 'truck', dual: w.dual, side: w.side });
    wh.position.set(w.x, w.y, w.z);
    wh.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    body.add(wh); wheels.push(wh);
  }
  root.userData.wheels = wheels;
  root.userData.roll = (dist) => { for (const w of wheels) w.userData.roll && w.userData.roll(dist); };
  root.userData.assetType = type;
  root.userData.vehicleType = type;
  root.userData.variant = variant;
  root.userData.dims = { ...dims };
  return root;
}
function attachLights(T, root, lamps, heads) {
  const L = lampMats(T);
  const SM = SHARED && SHARED.attachLightAPI && SHARED.getMaterials ? SHARED.getMaterials(T) : null;
  const tails = [], halos = [];
  for (const l of lamps) {
    const mat = SM && l.kind === 'head' ? SM.lightHead : SM && l.kind === 'tail' ? SM.lightTail : L[l.kind];
    const m = lampMesh(T, l.geo, mat, l.name, l.pos, l.rot);
    m.userData.lampKind = l.kind;
    if (l.kind === 'tail') tails.push(m);
    root.add(m);
    if (l.halo !== false) {                       // glare halo, shown with the lamp at night (setLights(on, {glow}))
      const h = haloSprite(T, l.kind), [x, y, z] = l.pos;
      h.position.set(x, y, z);                        // shader pulls the quad 5 cm toward the camera
      if (l.haloScale) h.scale.multiplyScalar(l.haloScale);
      h.name = l.name + '_halo'; h.userData.lampKind = l.kind;
      root.add(h); halos.push(h);
    }
  }
  let on = false, brake = false, beams = null, base = null;
  if (SM) {
    // shared API swaps head/tail materials (meshes named headlight_* / taillight_*) and owns the headlamp SpotLight
    SHARED.attachLightAPI(T, root, { spot: !!heads, spotIntensity: 22000 });
    base = root.userData.setLights;
  }
  const apply = (opts = {}) => {
    if (base) {
      base(on, heads ? { spot: opts.beams ?? opts.spot } : { spot: false });
      if (brake) for (const t of tails) t.material = SM.lightTailOn;
      for (const t of tails) if (!/^taillight/.test(t.name)) t.material = brake || on ? SM.lightTailOn : SM.lightTail;  // warn/aux reds
    } else {
      L.head.emissiveIntensity = on ? 3.0 : 0;
      L.tail.emissiveIntensity = brake ? 3.2 : on ? 1.1 : 0;
      if (opts.beams && !beams && heads && heads.length) {
        beams = heads.map(([x, y, z]) => {
          const sp = new T.SpotLight(0xfff2dc, 22000, 90, 0.42, 0.5, 2);
          sp.position.set(x, y, z); sp.target.position.set(x, y - 1.2, z - 30); sp.castShadow = false;
          root.add(sp); root.add(sp.target); return sp;
        });
      }
      if (beams) for (const b of beams) b.visible = on;
    }
    L.amber.emissiveIntensity = on ? 2.4 : 0;
    L.marker.emissiveIntensity = on ? 2.0 : 0;
    const glow = opts.glow ?? true;
    for (const h of halos) h.visible = glow && (h.userData.lampKind === 'tail' ? on || brake : on);
  };
  let last = {};
  root.userData.setLights = (v, opts = {}) => { on = !!v; last = opts || {}; root.userData.lightsOn = on; apply(last); return root; };
  root.userData.setBrake = (v) => { brake = !!v; apply(last); return root; };
  root.userData.lamps = lamps.map(l => l.name);
  root.userData.halos = halos;
  root.userData.lightsOn = false;
  apply({ spot: false });
}
const lamp = (T, kind, name, w, h, d, pos, rot) => ({ kind, name, geo: new T.BoxGeometry(w, h, d), pos, rot });
const roundLamp = (T, kind, name, r, d, pos, axis = 'z') => {
  const g = new T.CylinderGeometry(r, r, d, 18);
  if (axis === 'z') g.rotateX(Math.PI / 2); else if (axis === 'x') g.rotateZ(Math.PI / 2);
  return { kind, name, geo: g, pos };
};

function makeTractor(T, o) {
  const c = cacheFor(T).built;
  c.tractor = c.tractor || buildTractor(T);
  const dims = CATALOG.truck_tractor;
  const root = assemble(T, o.id, 'truck_tractor', 'conventional_sleeper', c.tractor, toHex(o.color, 0x7d1c1f), dims);
  const lamps = [];
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    lamps.push(lamp(T, 'head', 'headlight_' + n, 0.36, 0.17, 0.05, [s * 0.95, 1.22, -3.03]));
    lamps.push(lamp(T, 'amber', 'turn_front_' + n, 0.1, 0.17, 0.05, [s * 1.18, 1.18, -2.97]));
    lamps.push(roundLamp(T, 'tail', 'taillight_' + n, 0.06, 0.03, [s * 0.66, 0.92, 3.25]));
    lamps.push(lamp(T, 'amber', 'cab_marker_' + n, 0.12, 0.05, 0.04, [s * 0.45, 3.58, 0.38]));
  }
  lamps.push(lamp(T, 'amber', 'cab_marker_C', 0.12, 0.05, 0.04, [0, 3.6, 0.36]));
  for (const s of [-1, 1]) {   // FMVSS 108 front side markers (amber) on the hood flanks, red rear side marker on the frame end
    const n = s < 0 ? 'L' : 'R';
    lamps.push(lamp(T, 'amber', 'side_marker_front_' + n, 0.012, 0.05, 0.12, [s * 1.252, 1.3, -2.95]));
    lamps.push(lamp(T, 'marker', 'side_marker_rear_' + n, 0.012, 0.05, 0.1, [s * 1.225, 1.05, 3.12]));
  }
  attachLights(T, root, lamps, [[-0.95, 1.22, -3.06], [0.95, 1.22, -3.06]]);
  addContactShadow(T, root, 'tractor', { L: 6.5, W: 2.5, rects: [[-1.15, 1.15, -3.15, 3.2, 0.42, 0.5]],
    blobs: [...wheelBlobs(1.1, [TR.axF], false, TR.R), ...wheelBlobs(0.945, [TR.axD1, TR.axD2], true, TR.R)] }, o);
  root.userData.driverEye = [-0.55, 2.5, -0.45];
  root.userData.fifthWheel = [0, TR.fifthY, TR.fifthZ];
  root.userData.hitch = (trailer, art = 0) => coupleTrailer(root, trailer, art);
  root.userData.follow = (trailer) => followTrailer(root, trailer);
  return root;
}
function makeTrailer(T, o) {
  const flat = /flat/.test(String(o.variant || ''));
  const c = cacheFor(T).built;
  const key = flat ? 'flatbed' : 'van';
  c[key] = c[key] || (flat ? buildFlatbed(T) : buildBoxTrailer(T));
  const dims = flat ? CATALOG.semitrailer_flatbed : CATALOG.semitrailer;
  const root = assemble(T, o.id, 'semitrailer', flat ? 'flatbed' : 'box', c[key], toHex(o.color, 0xe9ebea), dims);
  const lamps = [];
  const sillY = flat ? 1.38 : ST.floorBot + 0.2;
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    lamps.push(roundLamp(T, 'tail', 'taillight_' + n, 0.075, 0.03, [s * 0.95, sillY, 8.12]));
    lamps.push(roundLamp(T, 'tail', 'taillight2_' + n, 0.075, 0.03, [s * 0.72, sillY, 8.12]));
    // FMVSS 108 side markers: amber front + intermediate, red rear (on the bottom rail, just above the C2 tape)
    lamps.push(lamp(T, 'amber', 'side_marker_front_' + n, 0.014, 0.055, 0.12, [s * 1.31, sillY + 0.03, -7.9]));
    lamps.push(lamp(T, 'amber', 'side_marker_mid_' + n, 0.014, 0.055, 0.12, [s * 1.31, sillY + 0.03, 0.0]));
    lamps.push(lamp(T, 'marker', 'side_marker_rear_' + n, 0.014, 0.055, 0.12, [s * 1.31, sillY + 0.03, 7.9]));
    if (!flat) lamps.push(lamp(T, 'marker', 'side_marker_rearupper_' + n, 0.014, 0.05, 0.1, [s * 1.31, 3.9, 7.95]));
    if (!flat) {
      lamps.push(lamp(T, 'amber', 'top_marker_front_' + n, 0.1, 0.05, 0.03, [s * 1.18, 4.03, -8.12]));
      lamps.push(lamp(T, 'marker', 'top_marker_rear_' + n, 0.1, 0.05, 0.03, [s * 1.18, 4.03, 8.11]));
    }
  }
  if (!flat) for (const x of [-0.15, 0, 0.15]) lamps.push(lamp(T, 'marker', 'id_lamp_' + x, 0.06, 0.04, 0.03, [x, 3.98, 8.11]));
  attachLights(T, root, lamps, null);
  addContactShadow(T, root, flat ? 'flatbed' : 'van', { L: 16.2, W: 2.6,
    rects: [[-1.25, 1.25, -8.0, 8.05, flat ? 0.16 : 0.26, 0.7], [-1.2, 1.2, 4.6, 7.75, 0.3, 0.4], [-1.0, 1.0, -8.05, -6.2, 0.18, 0.4]],
    blobs: [...wheelBlobs(1.13 - 0.155, [ST.ax1, ST.ax2], true, ST.R), [-0.82, ST.legZ, 0.2, 0.2, 0.55], [0.82, ST.legZ, 0.2, 0.2, 0.55]] }, o);
  root.userData.driverEye = null;
  root.userData.kingpinOffset = ST.kingpinZ;
  root.userData.kingpin = [0, ST.kingpinY, ST.kingpinZ];
  root.userData.kingpinToAxles = (ST.ax1 + ST.ax2) / 2 - ST.kingpinZ;
  root.userData.underrideClearance = flat ? 1.38 - 0.18 : ST.floorBot - 0.1;   // lowest crossmember flange above ground between landing gear and tandem
  return root;
}
function makeBoxTruck(T, o) {
  const c = cacheFor(T).built;
  c.boxtruck = c.boxtruck || buildBoxTruck(T);
  const root = assemble(T, o.id, 'box_truck', 'conventional', c.boxtruck, toHex(o.color, 0xf2f2f0), CATALOG.box_truck);
  const lamps = [];
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    lamps.push(lamp(T, 'head', 'headlight_' + n, 0.32, 0.15, 0.05, [s * 0.78, 1.18, -3.5], [0, 0, 0]));
    lamps.push(lamp(T, 'amber', 'turn_front_' + n, 0.08, 0.15, 0.05, [s * 1.0, 1.16, -3.45]));
    lamps.push(lamp(T, 'tail', 'taillight_' + n, 0.08, 0.3, 0.03, [s * 1.16, 1.42, 3.762]));
    lamps.push(lamp(T, 'marker', 'top_marker_rear_' + n, 0.08, 0.05, 0.03, [s * 1.1, 3.33, 3.762]));
    lamps.push(lamp(T, 'amber', 'top_marker_front_' + n, 0.08, 0.05, 0.03, [s * 1.1, 3.33, -0.87]));
  }
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    lamps.push(lamp(T, 'amber', 'side_marker_front_' + n, 0.014, 0.05, 0.12, [s * 1.262, BT.boxBot + 0.2, BT.boxF + 0.25]));
    lamps.push(lamp(T, 'amber', 'side_marker_mid_' + n, 0.014, 0.05, 0.12, [s * 1.262, BT.boxBot + 0.2, (BT.boxF + BT.rear) / 2]));
    lamps.push(lamp(T, 'marker', 'side_marker_rear_' + n, 0.014, 0.05, 0.12, [s * 1.262, BT.boxBot + 0.2, BT.rear - 0.25]));
    lamps.push(lamp(T, 'amber', 'cab_marker_' + n, 0.1, 0.045, 0.04, [s * 0.42, 2.815, -1.9]));
    lamps.push(lamp(T, 'amber', 'hood_marker_' + n, 0.012, 0.045, 0.1, [s * 1.112, 1.32, -3.2]));
  }
  lamps.push(lamp(T, 'amber', 'cab_marker_C', 0.1, 0.045, 0.04, [0, 2.82, -1.9]));
  for (const x of [-0.15, 0, 0.15]) lamps.push(lamp(T, 'marker', 'id_lamp_' + x, 0.06, 0.04, 0.03, [x, 3.3, 3.762]));
  attachLights(T, root, lamps, [[-0.78, 1.18, -3.53], [0.78, 1.18, -3.53]]);
  addContactShadow(T, root, 'boxtruck', { L: 7.5, W: 2.5, rects: [[-1.18, 1.18, -3.65, 3.7, 0.45, 0.5]],
    blobs: [...wheelBlobs(1.05, [BT.axF], false, BT.R), ...wheelBlobs(1.07 - 0.14, [BT.axR], true, BT.R)] }, o);
  root.userData.driverEye = [-0.5, 2.28, -1.75];
  return root;
}
function makeBus(T, o) {
  const school = /school/.test(String(o.variant || ''));
  const c = cacheFor(T).built;
  const key = school ? 'school' : 'transit';
  c[key] = c[key] || (school ? buildSchoolBus(T) : buildTransit(T));
  const root = assemble(T, o.id, 'bus', school ? 'school' : 'transit', c[key].geo, toHex(o.color, school ? 0xf2a900 : 0xf0f1ef), CATALOG.bus);
  const lamps = [];
  for (const s of [-1, 1]) {
    const n = s < 0 ? 'L' : 'R';
    if (school) {
      lamps.push(roundLamp(T, 'head', 'headlight_' + n, 0.09, 0.04, [s * 0.75, 1.15, -6.07]));
      lamps.push(roundLamp(T, 'tail', 'taillight_' + n, 0.09, 0.03, [s * 0.9, 1.15, 6.115]));
      lamps.push(roundLamp(T, 'tail', 'warn_red_front_' + n, 0.09, 0.04, [s * 0.95, 3.0, -4.78]));
      lamps.push(roundLamp(T, 'amber', 'warn_amber_front_' + n, 0.09, 0.04, [s * 0.65, 3.0, -4.78]));
      lamps.push(roundLamp(T, 'tail', 'warn_red_rear_' + n, 0.09, 0.04, [s * 0.95, 2.9, 6.12]));
      lamps.push(roundLamp(T, 'amber', 'warn_amber_rear_' + n, 0.09, 0.04, [s * 0.65, 2.9, 6.12]));
    } else {
      lamps.push(lamp(T, 'head', 'headlight_' + n, 0.3, 0.12, 0.04, [s * 0.92, 0.72, -6.11]));
      lamps.push(lamp(T, 'amber', 'turn_front_' + n, 0.12, 0.12, 0.04, [s * 1.12, 0.72, -6.11]));
      lamps.push(lamp(T, 'tail', 'taillight_' + n, 0.14, 0.42, 0.03, [s * 1.12, 1.15, 6.115]));
      lamps.push(lamp(T, 'marker', 'top_marker_rear_' + n, 0.08, 0.05, 0.03, [s * 1.0, 2.95, 6.115]));
      lamps.push(lamp(T, 'amber', 'top_marker_front_' + n, 0.08, 0.05, 0.03, [s * 1.05, 2.98, -6.125]));
    }
    // side markers: amber front + mid, red rear (low on the body side)
    const hx = school ? 1.262 : 1.285, my = school ? 0.9 : 0.68;
    lamps.push(lamp(T, 'amber', 'side_marker_front_' + n, 0.014, 0.05, 0.12, [s * hx, my, school ? -4.6 : -5.7]));
    lamps.push(lamp(T, 'amber', 'side_marker_mid_' + n, 0.014, 0.05, 0.12, [s * hx, my, school ? 0.4 : -0.2]));
    lamps.push(lamp(T, 'marker', 'side_marker_rear_' + n, 0.014, 0.05, 0.12, [s * hx, my, 5.85]));
  }
  attachLights(T, root, lamps, school ? [[-0.75, 1.15, -6.1], [0.75, 1.15, -6.1]] : [[-0.92, 0.72, -6.13], [0.92, 0.72, -6.13]]);
  const ax = c[key];
  addContactShadow(T, root, key, { L: 12.2, W: 2.55, rects: [[-1.22, 1.22, school ? -6.05 : -6.05, 6.05, school ? 0.42 : 0.55, 0.5]],
    blobs: [...wheelBlobs(school ? 1.04 : 1.1, [ax.axF], false, BU.R), ...wheelBlobs(school ? 0.915 : 0.955, [ax.axR], true, BU.R)] }, o);
  root.userData.driverEye = school ? [-0.62, 2.12, -4.4] : [-0.72, 2.05, -5.25];
  root.userData.axles = [c[key].axF, c[key].axR];
  return root;
}

/** createHeavyVehicle(THREE, type, {id, color, variant}) -> THREE.Group (see header). Unknown type -> null. */
export function createHeavyVehicle(T, type, opts = {}) {
  const o = opts || {};
  let obj = null;
  switch (type) {
    case 'truck_tractor': case 'tractor': obj = makeTractor(T, o); break;
    case 'semitrailer': case 'trailer': case 'semitrailer_flatbed': obj = makeTrailer(T, type === 'semitrailer_flatbed' ? { ...o, variant: 'flatbed' } : o); break;
    case 'box_truck': obj = makeBoxTruck(T, o); break;
    case 'bus': case 'school_bus': obj = makeBus(T, type === 'school_bus' ? { ...o, variant: 'school' } : o); break;
    default: return null;
  }
  obj.userData.id = o.id;
  return obj;
}

/** Couple a trailer to a tractor (same parent). articulation a = tractor heading - trailer heading (rad; a > 0 = tractor turned left). */
export function coupleTrailer(tractor, trailer, articulation = 0) {
  const h = tractor.rotation.y, zF = tractor.userData.fifthWheel[2];
  const ht = h - articulation, zK = trailer.userData.kingpinOffset;
  const px = tractor.position.x + zF * Math.sin(h), pz = tractor.position.z + zF * Math.cos(h);
  trailer.position.set(px - zK * Math.sin(ht), tractor.position.y, pz - zK * Math.cos(ht));
  trailer.rotation.y = ht;
  trailer.userData._pivot = [px, pz];
  return { pivot: [px, pz], trailerHeading: ht };
}
const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
export function articulationOf(tractor, trailer) { return wrapPi(tractor.rotation.y - trailer.rotation.y); }
/** Kinematic trailer follow (discrete tractrix). Call after moving the tractor each frame. Returns the articulation angle. */
export function followTrailer(tractor, trailer) {
  const h = tractor.rotation.y, zF = tractor.userData.fifthWheel[2], zK = trailer.userData.kingpinOffset;
  const L = trailer.userData.kingpinToAxles || 13.37;
  const px = tractor.position.x + zF * Math.sin(h), pz = tractor.position.z + zF * Math.cos(h);
  let ht = trailer.rotation.y;
  const prev = trailer.userData._pivot;
  if (prev) {
    // the trailer axle point (behind the kingpin by L) is dragged toward the new pivot position
    const ax = prev[0] + L * Math.sin(ht), az = prev[1] + L * Math.cos(ht);
    const dx = ax - px, dz = az - pz;
    if (dx * dx + dz * dz > 1e-10) ht = Math.atan2(dx, dz);
    ht = h - wrapPi(h - ht);                       // keep the heading continuous with the tractor's (no 2*pi jumps)
  }
  trailer.position.set(px - zK * Math.sin(ht), tractor.position.y, pz - zK * Math.cos(ht));
  trailer.rotation.y = ht;
  trailer.userData._pivot = [px, pz];
  return wrapPi(h - ht);
}

// Facade (web/assets.js) looks up create<PascalType>(THREE, type, opts) per vehicle type; these route here.
export function createTruckTractor(T, type, o) { return createHeavyVehicle(T, 'truck_tractor', typeof type === 'object' ? type : o); }
export function createSemitrailer(T, type, o) { return createHeavyVehicle(T, 'semitrailer', typeof type === 'object' ? type : o); }
export function createBoxTruck(T, type, o) { return createHeavyVehicle(T, 'box_truck', typeof type === 'object' ? type : o); }
export function createBus(T, type, o) { return createHeavyVehicle(T, 'bus', typeof type === 'object' ? type : o); }

export const HEAVY_PARTS_SOURCE = SHARED ? 'vehicle_parts.js' : 'local fallback';
export default createHeavyVehicle;
