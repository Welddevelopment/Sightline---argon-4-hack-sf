// Sightline scene kit: to-scale roads, markings, terrain and evidence decals (browser + Node; three.js).
// Conventions (SPEC WORLD CONTRACT v2): meters; Y up; +X east; -Z north; asset origin = ground-level centre;
// rotation.y = 0 faces -Z (north); heading = rotation.y (radians, CCW from north toward west).
//
// Roads are built in a local frame: s = distance ALONG the road (forward = local -Z), u = distance ACROSS
// (+u = right of forward = local +X). Road surface top is exactly y = 0 (+ terrain profile, see below), so
// vehicles placed at y = 0 sit on the pavement. Pass `position:[x,z]` and `heading` to the factory (preferred),
// or move/rotate the returned group afterwards — terrain and draping follow either way.
//
// Terrain: terrainHeight(x,z) = elevation profiles (hillCrest / elevationProfile, default none = flat)
//          + roadside grading registered by every road (paved = 0, mowed shoulders, ditches, median swale)
//          + gentle natural undulation away from roads. groundPlane() renders it.
//
// US markings (MUTCD): white right edge line; dashed white lane lines 3 m dash / 9 m gap (10 ft / 30 ft);
// solid yellow left edge line on divided roads; double solid / dashed yellow centre line on two-way roads;
// solid white stop bars; turn-lane lines + arrows; raised pavement markers every 12.2 m (40 ft).
import * as THREE from 'three';
import { surfaceMaterial, laneWearTextures, markingTexture, skidTexture, edgeFringeTexture, sprayTexture, getTextureSet, foliageMaterial, foliageClusterGeometry, decalTexture, _noise } from './textures.js';

export { getTextureSet, surfaceMaterial, setAnisotropy, foliageMaterial, foliageClusterGeometry, decalTexture } from './textures.js';

const { vnoise } = _noise;
const FT = 0.3048;
export const US = Object.freeze({
  laneWidth: 12 * FT, lineWidth: 6 * 0.0254, wideLine: 8 * 0.0254, dash: 10 * FT, gap: 30 * FT,
  stopBarWidth: 24 * 0.0254, rpmSpacing: 40 * FT, yellow: 0xe3a51c, white: 0xf1f1ec,
});

// ------------------------------------------------------------------ shared materials
const MAT = {};
function mat(key, make) { return MAT[key] || (MAT[key] = make()); }
const asphaltMat = (tint = 0xffffff) => surfaceMaterial('asphalt', { color: tint, polygonOffset: -1 });
function paintMat(color) {
  return mat('paint' + color, () => {
    const t = markingTexture();
    const m = new THREE.MeshStandardMaterial({ color, map: t.map, transparent: true, roughness: 0.62, metalness: 0, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    m.name = 'paint'; return m;
  });
}
function wearMat() {
  return mat('wear', () => {
    const t = laneWearTextures();
    return new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.roughnessMap, transparent: true, depthWrite: false, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, name: 'lane_wear' });
  });
}
function fringeMat() {
  return mat('fringe', () => new THREE.MeshStandardMaterial({ map: edgeFringeTexture().map, transparent: true, depthWrite: false, roughness: 0.97,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6, name: 'edge_fringe' }));
}

// ------------------------------------------------------------------ terrain state
const TERRAIN = { corridors: [], profiles: [], grounds: new Set(), version: 1, profileVersion: 1, undulation: 0.45, seed: 7 };

/** Clear all registered roads/profiles (call when loading a new world in the same page). */
export function resetTerrain() {
  TERRAIN.corridors.length = 0; TERRAIN.profiles.length = 0; TERRAIN.version++; TERRAIN.profileVersion++;
}
/** Natural undulation amplitude in metres away from roads (Florida pasture ~0.3–0.6). */
export function setTerrainOptions({ undulation, seed } = {}) {
  if (undulation != null) TERRAIN.undulation = undulation;
  if (seed != null) TERRAIN.seed = seed;
  TERRAIN.version++;
}

/** elevationProfile({origin:[x,z], heading, points:[[s,y],...], curve=150, halfWidth=Infinity})
 *  Elevation along an axis through `origin` pointing at `heading` (s = metres along it), linear between points
 *  with parabolic vertical curves of length `curve` at each grade break (AASHTO style). Applies across the whole
 *  world (a landform), fading to 0 beyond `halfWidth` from the axis if given. Roads drape onto it. */
export function elevationProfile({ origin = [0, 0], heading = 0, points, curve = 150, halfWidth = Infinity, fade = 150 } = {}) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const P = { ox: origin[0], oz: origin[1], fx: -Math.sin(heading), fz: -Math.cos(heading), pts, curve, halfWidth, fade };
  TERRAIN.profiles.push(P); TERRAIN.version++; TERRAIN.profileVersion++;
  return P;
}
function profileAt(P, s) {
  const p = P.pts, n = p.length;
  const lin = s <= p[0][0] ? p[0][1] : s >= p[n - 1][0] ? p[n - 1][1] : (() => {
    for (let i = 0; i < n - 1; i++) if (s <= p[i + 1][0]) { const t = (s - p[i][0]) / (p[i + 1][0] - p[i][0]); return p[i][1] + (p[i + 1][1] - p[i][1]) * t; }
  })();
  let y = lin;
  for (let i = 0; i < n; i++) {
    const g1 = i === 0 ? 0 : (p[i][1] - p[i - 1][1]) / (p[i][0] - p[i - 1][0]);
    const g2 = i === n - 1 ? 0 : (p[i + 1][1] - p[i][1]) / (p[i + 1][0] - p[i][0]);
    const L = Math.min(P.curve, i > 0 ? (p[i][0] - p[i - 1][0]) : Infinity, i < n - 1 ? (p[i + 1][0] - p[i][0]) : Infinity);
    const x = s - p[i][0];
    if (L > 0 && Math.abs(x) < L / 2) y += (g2 - g1) / (2 * L) * (x + L / 2) ** 2 - (x > 0 ? (g2 - g1) * x : 0);
  }
  return y;
}
/** hillCrest({at:[x,z], heading, height, gradeUp=0.02, gradeDown=0.0215, lengthDown, lengthUp=300, curve=200, datumAt})
 *  Vertical crest whose top is at `at`, axis along `heading` (direction of travel going DOWN the far side).
 *  The ground rises at gradeUp for lengthUp before the crest and falls at gradeDown for lengthDown after it, then
 *  levels. `height` = crest elevation above the level ground after the descent (default gradeDown*lengthDown).
 *  `datumAt` = s (from the crest along heading) where elevation should be 0 (keeps y=0 at the crash site). */
export function hillCrest({ at = [0, 0], heading = -Math.PI / 2, gradeUp = 0.02, gradeDown = 0.0215, lengthDown = 400, lengthUp = 300, curve = 200, height, datumAt = null, halfWidth = Infinity } = {}) {
  const h = height ?? gradeDown * lengthDown;
  let pts = [[-lengthUp, h - gradeUp * lengthUp], [0, h], [lengthDown, h - gradeDown * lengthDown]];
  const P0 = { pts, curve };
  const off = datumAt == null ? -(h - gradeDown * lengthDown) : profileAt(P0, datumAt);
  pts = pts.map(([s, y]) => [s, y - off]);
  return elevationProfile({ origin: at, heading, points: pts, curve, halfWidth });
}
function profileH(x, z) {
  let y = 0;
  for (const P of TERRAIN.profiles) {
    const dx = x - P.ox, dz = z - P.oz, s = dx * P.fx + dz * P.fz;
    let w = 1;
    if (P.halfWidth !== Infinity) { const c = Math.abs(dx * P.fz - dz * P.fx); w = 1 - smooth(P.halfWidth, P.halfWidth + P.fade, c); }
    if (w > 0) y += w * profileAt(P, s);
  }
  return y;
}
function natural(x, z) {
  if (!TERRAIN.undulation) return 0;
  const s = TERRAIN.seed, BIG = 1 << 20;
  const n = vnoise(x / 140 + 512, z / 140 + 512, BIG, s) * 0.6 + vnoise(x / 55 + 512, z / 55 + 512, BIG, s + 1) * 0.3 + vnoise(x / 13 + 512, z / 13 + 512, BIG, s + 2) * 0.1;
  return (n - 0.5) * 2 * TERRAIN.undulation;
}
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// keep corridor transforms in sync with their groups (worlds may move the group after creation)
const _m4 = new THREE.Matrix4();
function syncCorridors() {
  let changed = false;
  for (const c of TERRAIN.corridors) {
    c.group.updateWorldMatrix(true, false);
    const e = c.group.matrixWorld.elements;
    if (!c.last || e.some((v, i) => v !== c.last[i])) {
      c.last = e.slice(); c.inv.copy(c.group.matrixWorld).invert(); c.mw.copy(c.group.matrixWorld); changed = true; c.drapedFor = 0;
    }
    if (c.drapedFor !== TERRAIN.profileVersion) { redrape(c.group); c.drapedFor = TERRAIN.profileVersion; }
  }
  if (changed) TERRAIN.version++;
}
const _v = new THREE.Vector3();
function corridorSample(x, z) {
  let paved = false, wmax = 0, median = false, mow = 0;
  const cand = [];
  for (const c of TERRAIN.corridors) {
    _v.set(x, 0, z).applyMatrix4(c.inv);
    const r = c.fn(_v.x, -_v.z);
    if (!r) continue;
    if (r.paved) { paved = true; mow = 1; break; }
    if (r.w > 0.001) { cand.push(r); if (r.w > wmax) wmax = r.w; if (r.median) median = true; mow = Math.max(mow, r.mow || 0); }
  }
  let rel = 0;
  if (!paved && cand.length) { rel = -Infinity; for (const r of cand) if (r.w >= wmax - 0.3 && r.rel > rel) rel = r.rel; }
  return { paved, rel: paved ? 0 : rel, w: paved ? 1 : wmax, median, mow };
}
/** terrainHeight(x,z): ground elevation (m). Pavement surface = terrainHeight + 0.02 on paved areas (i.e. profile height). */
export function terrainHeight(x, z) {
  syncCorridors();
  const base = profileH(x, z), cs = corridorSample(x, z);
  if (cs.paved) return base - 0.02;
  return base + cs.rel * cs.w + natural(x, z) * (1 - cs.w);
}
/** roadHeight(x,z): elevation of the road surface / vehicle ground contact (profile only). */
export function roadHeight(x, z) { return profileH(x, z); }

// ------------------------------------------------------------------ geometry helpers (local u,s -> x=u, z=-s)
function finishGeo(pos, uv, idx, lift, extra = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('lift', new THREE.Float32BufferAttribute(lift, 1));
  for (const [k, v] of Object.entries(extra)) g.setAttribute(k, v);
  g.setIndex(idx);
  const n = new Float32Array(pos.length); for (let i = 1; i < n.length; i += 3) n[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return g;
}
/** ribbon over s in [s0,s1] between u0(s)..u1(s). uvMode: 'meters' (u,s) | 'across' (0..1 across, s along). */
function ribbon({ s0, s1, u0, u1, step = 4, lift = 0, liftFn = null, uvMode = 'meters', breaks = [], cols = null, colUV = null }) {
  if (cols) return ribbonCols({ s0, s1, cols, colUV, step, liftFn, lift, breaks });
  const U0 = typeof u0 === 'function' ? u0 : () => u0, U1 = typeof u1 === 'function' ? u1 : () => u1;
  const ss = new Set([s0, s1]);
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  for (let i = 1; i < n; i++) ss.add(s0 + (s1 - s0) * i / n);
  for (const b of breaks) if (b > s0 && b < s1) ss.add(b);
  const S = [...ss].sort((a, b) => a - b);
  const pos = [], uv = [], idx = [], lifts = [];
  S.forEach((s, i) => {
    const a = U0(s), b = U1(s), lo = Math.min(a, b), hi = Math.max(a, b);
    for (const [u, k] of [[lo, 0], [hi, 1]]) {
      pos.push(u, 0, -s);
      uv.push(uvMode === 'across' ? k : u, s);
      lifts.push(liftFn ? liftFn(u, s) : lift);
    }
    if (i > 0) { const o = (i - 1) * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
  });
  return finishGeo(pos, uv, idx, lifts);
}
function ribbonCols({ s0, s1, cols, colUV, step, liftFn, lift, breaks }) {
  const F = cols.map(c => typeof c === 'function' ? c : () => c), nc = F.length;
  const ss = new Set([s0, s1]); const n = Math.max(1, Math.ceil((s1 - s0) / step));
  for (let i = 1; i < n; i++) ss.add(s0 + (s1 - s0) * i / n);
  for (const b of breaks) if (b > s0 && b < s1) ss.add(b);
  const S = [...ss].sort((a, b) => a - b), pos = [], uv = [], idx = [], lifts = [];
  S.forEach((s, i) => {
    F.forEach((f, k) => { const u = f(s); pos.push(u, 0, -s); uv.push(colUV ? colUV[k] : k / (nc - 1), s); lifts.push(liftFn ? liftFn(u, s, k) : lift); });
    if (i > 0) for (let k = 0; k < nc - 1; k++) {
      const a = (i - 1) * nc + k, b = a + 1, c = a + nc, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  });
  return finishGeo(pos, uv, idx, lifts);
}
/** grid over [u0,u1] x [s0,s1] with per-vertex lift function (used for median swales). */
function grid({ u0, u1, s0, s1, du = 1.5, ds = 3, liftFn, skip = null }) {
  const nu = Math.max(1, Math.ceil((u1 - u0) / du)), ns = Math.max(1, Math.ceil((s1 - s0) / ds));
  const pos = [], uv = [], idx = [], lifts = [];
  for (let j = 0; j <= ns; j++) for (let i = 0; i <= nu; i++) {
    const u = u0 + (u1 - u0) * i / nu, s = s0 + (s1 - s0) * j / ns;
    pos.push(u, 0, -s); uv.push(u, s); lifts.push(liftFn(u, s));
  }
  for (let j = 0; j < ns; j++) for (let i = 0; i < nu; i++) {
    const uc = u0 + (u1 - u0) * (i + 0.5) / nu, sc = s0 + (s1 - s0) * (j + 0.5) / ns;
    if (skip && skip(uc, sc)) continue;
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = finishGeo(pos, uv, idx, lifts);
  return g;
}
/** polygon from [[u,s],...] (CCW or CW) -> flat geometry at lift. */
function polygon(pts, lift = 0, holes = []) {
  const shape = new THREE.Shape(pts.map(([u, s]) => new THREE.Vector2(u, s)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([u, s]) => new THREE.Vector2(u, s))));
  const sg = new THREE.ShapeGeometry(shape, 6);
  const p = sg.getAttribute('position'), pos = [], uv = [], lifts = [];
  for (let i = 0; i < p.count; i++) { const u = p.getX(i), s = p.getY(i); pos.push(u, 0, -s); uv.push(u, s); lifts.push(lift); }
  // CCW in (u,s) maps to an upward-facing triangle under (u,s)->(x=u, z=-s)
  const idx = sg.index ? Array.from(sg.index.array) : [...Array(p.count).keys()];
  sg.dispose();
  return finishGeo(pos, uv, idx, lifts);
}
function meshOf(geo, material, name, { shadow = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.name = name; m.receiveShadow = shadow; m.castShadow = false;
  m.userData.drape = true;
  return m;
}
/** set every draped vertex y = profile(world xz) + lift - group world y. */
function redrape(group) {
  group.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4();
  group.traverse(o => {
    if (!o.isMesh || !o.userData.drape) return;
    const g = o.geometry, p = g.getAttribute('position'), L = g.getAttribute('lift');
    if (!L) return;
    const mw = o.matrixWorld; inv.copy(mw).invert();
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), 0, p.getZ(i)).applyMatrix4(mw);
      const h = TERRAIN.profiles.length ? profileH(v.x, v.z) : 0;
      v.y = h + L.getX(i);
      v.applyMatrix4(inv);
      p.setY(i, v.y);
    }
    p.needsUpdate = true;
    if (o.userData.smoothNormals || TERRAIN.profiles.length) g.computeVertexNormals();
    g.computeBoundingSphere(); g.computeBoundingBox();
  });
}
function placeGroup(group, opts) {
  if (opts.position) group.position.set(opts.position[0], opts.position[2] !== undefined ? opts.position[1] : 0, opts.position[2] !== undefined ? opts.position[2] : opts.position[1]);
  if (opts.heading != null) group.rotation.y = opts.heading;
}
function tag(obj, id, assetType, dims, extra = {}) {
  obj.name = id || assetType;
  obj.userData.assetType = assetType;
  obj.userData.dims = dims;
  Object.assign(obj.userData, extra);
  return obj;
}
function subtractRanges(s0, s1, gaps) {
  let out = [[s0, s1]];
  for (const [g0, g1] of gaps) {
    const nx = [];
    for (const [a, b] of out) { if (g1 <= a || g0 >= b) nx.push([a, b]); else { if (g0 > a) nx.push([a, g0]); if (g1 < b) nx.push([g1, b]); } }
    out = nx;
  }
  return out.filter(([a, b]) => b - a > 0.05);
}

// ------------------------------------------------------------------ markings
/** add a painted line along s, centred at u = uc(s), optionally dashed [on, off] with phase (m). */
function paintLine(group, { uc, width = US.lineWidth, s0, s1, color = US.white, dash = null, phase = 0, gaps = [], lift = 0.003, name = 'mark_line', _across = null }) {
  if (_across !== null) { // a line running across the road (along u) at s = _across, from u = s0 .. s1
    const m = meshOf(polygon([[s0, _across - width / 2], [s1, _across - width / 2], [s1, _across + width / 2], [s0, _across + width / 2]], lift), paintMat(color), name);
    group.add(m); return m;
  }
  const UC = typeof uc === 'function' ? uc : () => uc;
  const ranges = subtractRanges(s0, s1, gaps);
  const segs = [];
  for (const [a, b] of ranges) {
    if (!dash) { segs.push([a, b]); continue; }
    const [on, off] = dash, P = on + off;
    let k = Math.floor((a - phase) / P);
    for (let st = phase + k * P; st < b; st += P) { const d0 = Math.max(a, st), d1 = Math.min(b, st + on); if (d1 - d0 > 0.05) segs.push([d0, d1]); }
  }
  if (!segs.length) return null;
  const geos = segs.map(([a, b]) => ribbon({ s0: a, s1: b, u0: s => UC(s) - width / 2, u1: s => UC(s) + width / 2, step: dash ? 100 : 3, lift, uvMode: 'across' }));
  const geo = mergeGeos(geos);
  const m = meshOf(geo, paintMat(color), name);
  group.add(m);
  return m;
}
function mergeGeos(geos) {
  const pos = [], uv = [], lift = [], idx = [];
  let off = 0;
  for (const g of geos) {
    const p = g.getAttribute('position'), t = g.getAttribute('uv'), l = g.getAttribute('lift');
    pos.push(...p.array); uv.push(...t.array); lift.push(...l.array);
    for (const i of g.index.array) idx.push(i + off);
    off += p.count; g.dispose();
  }
  return finishGeo(pos, uv, idx, lift);
}
const ARROW_LEFT = (() => {
  const pts = [[0.11, 0], [0.11, 1.4]];
  for (let k = 0; k <= 8; k++) { const a = (k / 8) * Math.PI / 2; pts.push([-0.7 + 0.81 * Math.cos(a), 1.4 + 0.81 * Math.sin(a)]); }
  pts.push([-0.7, 2.45], [-1.42, 2.1], [-0.7, 1.75], [-0.7, 1.99]);
  for (let k = 8; k >= 0; k--) { const a = (k / 8) * Math.PI / 2; pts.push([-0.7 + 0.59 * Math.cos(a), 1.4 + 0.59 * Math.sin(a)]); }
  pts.push([-0.11, 1.4], [-0.11, 0]);
  return pts;
})();
const ARROW_THROUGH = [[0.11, 0], [0.11, 1.9], [0.38, 1.9], [0, 2.9], [-0.38, 1.9], [-0.11, 1.9], [-0.11, 0]];
/** arrow polygon in local (u,s): base at (u,s0), pointing +s*dir. kind left|right|through. ~3 m long (MUTCD). */
function arrowPts(kind, u, s0, dir = 1, stretch = 1.25) {
  const base = kind === 'through' ? ARROW_THROUGH : ARROW_LEFT;
  const mirror = kind === 'right' ? -1 : 1;
  // shape coords: x = to the right of travel... ARROW_LEFT has hook toward -x = left of travel (+y)
  return base.map(([x, y]) => [u + dir * mirror * x, s0 + dir * y * stretch]);
}
function addArrow(group, kind, u, s0, dir, color = US.white) {
  const m = meshOf(polygon(arrowPts(kind, u, s0, dir), 0.003), paintMat(color), 'mark_arrow_' + kind);
  group.add(m); return m;
}
const RPM_GEO = new THREE.BoxGeometry(0.1, 0.018, 0.1);
function addRPMs(group, list) {
  if (!list.length) return;
  const byColor = {};
  for (const r of list) (byColor[r.color] ||= []).push(r);
  for (const [color, arr] of Object.entries(byColor)) {
    const m = new THREE.InstancedMesh(RPM_GEO, mat('rpm' + color, () => new THREE.MeshStandardMaterial({ color: +color, roughness: 0.35, metalness: 0.1, emissive: +color, emissiveIntensity: 0.08 })), arr.length);
    const o = new THREE.Object3D();
    arr.forEach((r, i) => { o.position.set(r.u, 0.009, -r.s); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    m.name = 'mark_rpm'; m.userData.rpm = arr.map(r => [r.u, r.s]);
    group.add(m);
  }
}

// ------------------------------------------------------------------ road
/**
 * road({ id, lanes=2, laneWidth=3.66, length=400, markings='standard'|'center_double'|'center_dashed'|'none',
 *        edgeLines=true, shoulderWidth=1.52 (outside/right, paved), leftShoulderWidth=0.61 (divided, inside),
 *        divided=false, medianWidth=18 (between the yellow inside edge lines, divided only),
 *        openings:[{at, width, radius=10}]  median crossovers (s = metres along the road from its centre),
 *        turnLanes:[{carriageway:'forward'|'reverse', stopAt, length=100, taper=30, arrows=2}],
 *        sideRoads:[{at, side:'right'|'left', width=6.1, radius=9}]  break edge lines + paved corner returns,
 *        stopBar: {s, side:'right'|'left'} | 'end' | 'start' (two-way roads), rpms=true, wear=true,
 *        dashPhase=0, roadside:{ditchDepth=0.6, medianDepth=0.8}, surface:'asphalt'|'concrete',
 *        position:[x,z], heading })
 * lanes = total lanes (divided: split evenly per direction). Forward traffic (+s, local -Z) uses the +u side.
 * Returns a Group: userData.assetType 'road', dims, laneCenters {forward:[u...], reverse:[u...]} and edges.
 */
export function road(opts = {}) {
  const o = {
    lanes: 2, laneWidth: US.laneWidth, length: 400, markings: 'standard', edgeLines: true,
    shoulderWidth: opts.shoulder ?? 1.52, leftShoulderWidth: 0.61, divided: false, medianWidth: 18,
    openings: [], turnLanes: [], sideRoads: [], stopBar: null, rpms: true, wear: true, dashPhase: 0,
    surface: 'asphalt', ...opts,
  };
  o.roadside = { ditchDepth: o.divided ? 0.6 : 0.4, medianDepth: 0.8, mowWidth: 18, ...(opts.roadside || {}) };
  const group = new THREE.Group();
  placeGroup(group, o);
  const L = o.length, s0 = -L / 2, s1 = L / 2, w = o.laneWidth;
  const sideRoadGaps = side => o.sideRoads.filter(r => (r.side || 'right') === side).map(r => { const R = r.radius ?? 9, W = r.width ?? 6.1; return [r.at - W / 2 - R, r.at + W / 2 + R]; });
  const surfMat = o.surface === 'concrete' ? surfaceMaterial('concrete', { polygonOffset: -1 }) : asphaltMat();
  const shoulderMat = o.surface === 'concrete' ? surfMat : asphaltMat(0xe9e7e2);
  const rpms = [];
  const laneCenters = { forward: [], reverse: [] };

  // ---- cross-section description in carriageway-relative coordinate r (distance from centreline toward outside)
  const carriageways = o.divided ? [+1, -1] : [0];
  const nPer = o.divided ? Math.round(o.lanes / 2) : o.lanes;
  const a = o.divided ? o.medianWidth / 2 : 0;
  const turnFor = sigma => o.turnLanes.filter(t => (t.carriageway === 'reverse' ? -1 : 1) === sigma);
  const turnWidthAt = (sigma, s) => {
    let wt = 0;
    for (const t of turnFor(sigma)) {
      const len = t.length ?? 100, tap = t.taper ?? 30, q = sigma * (t.stopAt - s);
      if (q >= 0 && q <= len) wt = Math.max(wt, t.width ?? w);
      else if (q > len && q < len + tap) wt = Math.max(wt, (t.width ?? w) * (1 - smooth(0, 1, (q - len) / tap)));
    }
    return wt;
  };
  const openingAt = (s, u = null) => o.openings.find(op => {
    const R = op.radius ?? 10; let hw = op.width / 2;
    if (u !== null && o.divided) { // fillet: wider near the carriageway edges
      const dEdge = Math.max(0, a - o.leftShoulderWidth - Math.max(turnWidthAt(1, s), turnWidthAt(-1, s)) - Math.abs(u));
      const t = Math.min(dEdge, R); hw += R - Math.sqrt(Math.max(0, R * R - (R - t) * (R - t)));
    } else if (u === null) hw += R;
    return Math.abs(s - op.at) <= hw;
  });
  const outerR = o.divided ? a + nPer * w + o.shoulderWidth : (o.lanes * w) / 2 + o.shoulderWidth;

  // ---- pavement surfaces
  if (o.divided) {
    for (const sg of carriageways) {
      const lanesU0 = sg > 0 ? a : -(a + nPer * w), lanesU1 = sg > 0 ? a + nPer * w : -a;
      if (nPer > 0) group.add(meshOf(ribbon({ s0, s1, u0: lanesU0, u1: lanesU1, step: 8 }), surfMat, `road_lanes_${sg > 0 ? 'fwd' : 'rev'}`));
      // right (outside) shoulder
      const shIn = a + nPer * w, shOut = shIn + o.shoulderWidth;
      if (o.shoulderWidth > 0) group.add(meshOf(ribbon({ s0, s1, u0: sg * shIn, u1: sg * shOut, step: 8 }), shoulderMat, 'road_shoulder_out'));
      // inside: turn lane (variable) + left shoulder
      const wt = s => turnWidthAt(sg, s);
      const tl = turnFor(sg);
      const brk = tl.flatMap(t => { const len = t.length ?? 100, tap = t.taper ?? 30; return [t.stopAt, t.stopAt - sg * len, t.stopAt - sg * (len + tap)]; });
      if (tl.length) group.add(meshOf(ribbon({ s0, s1, u0: s => sg * (a - wt(s)), u1: sg * a, step: 2, breaks: brk }), surfMat, 'road_turnlane'));
      if (o.leftShoulderWidth > 0) group.add(meshOf(ribbon({ s0, s1, u0: s => sg * (a - wt(s) - o.leftShoulderWidth), u1: s => sg * (a - wt(s)), step: tl.length ? 2 : 8, breaks: brk }), shoulderMat, 'road_shoulder_in'));
      for (let k = 0; k < nPer; k++) (sg > 0 ? laneCenters.forward : laneCenters.reverse).push(sg * (a + (k + 0.5) * w));
    }
    // median crossovers (paved, with filleted noses)
    for (const op of o.openings) {
      const R = op.radius ?? 10;
      const inner = s => a - o.leftShoulderWidth - Math.max(turnWidthAt(1, s), turnWidthAt(-1, s));
      const uIn = inner(op.at);
      const hw = op.width / 2, N = 10;
      // build as rectangle + fillet ribbons: simpler and robust
      const rect = polygon([[-uIn - 0.05, op.at - hw], [uIn + 0.05, op.at - hw], [uIn + 0.05, op.at + hw], [-uIn - 0.05, op.at + hw]], 0);
      group.add(meshOf(rect, surfMat, 'road_crossover'));
      for (const sg of [1, -1]) for (const ds of [1, -1]) {
        // fillet region next to carriageway edge, from s = at ± hw outward to ± (hw+R)
        const fp = [[sg * (uIn + 0.05), op.at + ds * hw], [sg * (uIn + 0.05), op.at + ds * (hw + R)]];
        for (let k = 0; k <= N; k++) { const ang = (k / N) * Math.PI / 2; fp.push([sg * (uIn - R + R * Math.cos(ang)), op.at + ds * (hw + R - R * Math.sin(ang))]); }
        group.add(meshOf(polygon(fp, 0), surfMat, 'road_crossover_fillet'));
      }
      // raised concrete median-nose curb with yellow paint (op.curb) and median stop bars for crossing traffic (op.stopBars)
      if (op.curb) for (const ds of [1, -1]) {
        const pts = [];
        for (let k = 0; k <= N; k++) { const ang = (k / N) * Math.PI / 2; pts.push([uIn - R + R * Math.cos(ang), op.at + ds * (hw + R - R * Math.sin(ang))]); }
        for (let k = N; k >= 0; k--) { const ang = (k / N) * Math.PI / 2; pts.push([-(uIn - R + R * Math.cos(ang)), op.at + ds * (hw + R - R * Math.sin(ang))]); }
        group.add(curbStrip(ds > 0 ? pts : pts.reverse(), { height: op.curbHeight ?? 0.15, width: 0.3, name: 'road_median_nose' }));
      }
      if (op.stopBars) {
        const off = op.curb ? 0.35 : 0.1;
        paintLine(group, { uc: -(uIn - 1.4), width: US.stopBarWidth, s0: op.at + 0.3, s1: op.at + hw - off, name: 'mark_median_stop_bar' });
        paintLine(group, { uc: uIn - 1.4, width: US.stopBarWidth, s0: op.at - hw + off, s1: op.at - 0.3, name: 'mark_median_stop_bar' });
        if (op.centerLine !== false) paintLine(group, { uc: 0, width: 0.1, s0: -uIn + 1.4, s1: uIn - 1.4, color: US.yellow, name: 'mark_crossover_center', _across: op.at });
      }
    }
  } else {
    const half = (o.lanes * w) / 2;
    group.add(meshOf(ribbon({ s0, s1, u0: -half, u1: half, step: 8 }), surfMat, 'road_lanes'));
    if (o.shoulderWidth > 0) for (const sg of [1, -1]) group.add(meshOf(ribbon({ s0, s1, u0: sg * half, u1: sg * (half + o.shoulderWidth), step: 8 }), shoulderMat, 'road_shoulder'));
    for (let k = 0; k < o.lanes; k++) { const uc = -half + (k + 0.5) * w; (uc > 0 ? laneCenters.forward : laneCenters.reverse).push(uc); }
  }
  // corner returns for side roads (paved quarter-circle fillets outside the outer edge)
  for (const sr of o.sideRoads) {
    const sg = (sr.side || 'right') === 'right' ? 1 : -1, R = sr.radius ?? 9, W = sr.width ?? 6.1, ue = outerR;
    for (const ds of [1, -1]) {
      const fp = [[sg * (ue - 0.05), sr.at + ds * W / 2], [sg * (ue - 0.05), sr.at + ds * (W / 2 + R)]];
      for (let k = 0; k <= 10; k++) { const ang = (k / 10) * Math.PI / 2; fp.push([sg * (ue + R - R * Math.cos(ang)), sr.at + ds * (W / 2 + R - R * Math.sin(ang))]); }
      group.add(meshOf(polygon(fp, 0), surfMat, 'road_corner_return'));
    }
    group.add(meshOf(polygon([[sg * (ue - 0.05), sr.at - W / 2], [sg * (ue + R + 0.05), sr.at - W / 2], [sg * (ue + R + 0.05), sr.at + W / 2], [sg * (ue - 0.05), sr.at + W / 2]], 0), surfMat, 'road_side_throat'));
  }

  // ---- lane wear overlays (per through lane)
  if (o.wear && o.surface === 'asphalt') {
    const centers = [...laneCenters.forward.map(u => [u, 1]), ...laneCenters.reverse.map(u => [u, -1])];
    centers.forEach(([uc, dir], k) => {
      const g = ribbon({ s0, s1, u0: uc - w / 2, u1: uc + w / 2, step: 16, lift: 0.001, uvMode: 'across' });
      const uvA = g.getAttribute('uv');
      for (let i = 0; i < uvA.count; i++) { uvA.setY(i, uvA.getY(i) + k * 23.7); if (dir < 0) uvA.setX(i, 1 - uvA.getX(i)); }
      group.add(meshOf(g, wearMat(), 'road_wear'));
    });
  }

  // ---- markings
  const lw = US.lineWidth, dash = [US.dash, US.gap];
  if (o.markings !== 'none') {
    if (o.divided) {
      for (const sg of carriageways) {
        const fwd = sg > 0;
        // right edge line (white), broken at side roads on that side
        if (o.edgeLines) paintLine(group, { uc: sg * (a + nPer * w - lw / 2), s0, s1, gaps: sideRoadGaps(fwd ? 'right' : 'left'), name: 'mark_edge_white' });
        // lane lines (white dashed)
        for (let k = 1; k < nPer; k++) {
          const uc = sg * (a + k * w);
          paintLine(group, { uc, s0, s1, dash, phase: o.dashPhase, name: 'mark_lane_dashed' });
          if (o.rpms) { const P = US.dash + US.gap, ph = o.dashPhase + US.dash + US.gap / 2; for (let s = Math.ceil((s0 - ph) / P) * P + ph; s < s1; s += P) rpms.push({ u: uc, s, color: 0xf4f4f4 }); }
        }
        // inside (left) edge: solid yellow, follows the turn lane, broken at openings
        const tl = turnFor(sg);
        const opGaps = o.openings.map(op => [op.at - op.width / 2 - (op.radius ?? 10), op.at + op.width / 2 + (op.radius ?? 10)]);
        paintLine(group, { uc: s => sg * (a - turnWidthAt(sg, s) + lw / 2), s0, s1, color: US.yellow, gaps: opGaps, name: 'mark_edge_yellow' });
        if (o.rpms) for (let s = s0 + 6; s < s1; s += US.rpmSpacing * 2) if (!opGaps.some(([g0, g1]) => s > g0 && s < g1) && !turnWidthAt(sg, s)) rpms.push({ u: sg * (a + 0.25), s, color: US.yellow });
        // turn lanes: solid white separation along storage, dotted along taper, arrows
        for (const t of tl) {
          const len = t.length ?? 100, tap = t.taper ?? 30, ws = t.width ?? w;
          const sA = t.stopAt, sB = t.stopAt - sg * len, sC = t.stopAt - sg * (len + tap);
          paintLine(group, { uc: sg * (a + US.wideLine / 2 - 0.0), width: US.wideLine, s0: Math.min(sA, sB), s1: Math.max(sA, sB), name: 'mark_turn_line' });
          paintLine(group, { uc: sg * (a + US.wideLine / 2), width: US.wideLine, s0: Math.min(sB, sC), s1: Math.max(sB, sC), dash: [0.9, 2.7], phase: Math.min(sB, sC), name: 'mark_turn_dotted' });
          const nArr = t.arrows ?? 2, ucT = sg * (a - ws / 2);
          for (let k = 0; k < nArr; k++) addArrow(group, 'left', ucT + sg * 0.65, sA - sg * (6 + k * 28) - sg * 3.6, sg);
          if (t.stopBar !== false) paintLine(group, { uc: sg * (a - ws / 2), width: ws - 0.3, s0: Math.min(sA, sA - sg * US.stopBarWidth), s1: Math.max(sA, sA - sg * US.stopBarWidth), name: 'mark_stop_bar' });
        }
      }
    } else {
      const half = (o.lanes * w) / 2;
      if (o.edgeLines) for (const sg of [1, -1]) paintLine(group, { uc: sg * (half - lw / 2), s0, s1, gaps: sideRoadGaps(sg > 0 ? 'right' : 'left'), name: 'mark_edge_white' });
      if (o.markings === 'center_double' || o.markings === 'standard') {
        for (const sg of [1, -1]) paintLine(group, { uc: sg * 0.1, width: 0.1, s0, s1, color: US.yellow, name: 'mark_center_double' });
      } else if (o.markings === 'center_dashed') {
        paintLine(group, { uc: 0, s0, s1, color: US.yellow, dash, phase: o.dashPhase, name: 'mark_center_dashed' });
      }
      const perSide = Math.floor(o.lanes / 2);
      for (let k = 1; k < perSide; k++) for (const sg of [1, -1]) paintLine(group, { uc: sg * k * w, s0, s1, dash, phase: o.dashPhase, name: 'mark_lane_dashed' });
      // stop bar
      if (o.stopBar) {
        const sb = typeof o.stopBar === 'string' ? { s: o.stopBar === 'start' ? s0 + 1.2 : s1 - 1.2, side: o.stopBar === 'start' ? 'left' : 'right' } : o.stopBar;
        const sg = (sb.side || 'right') === 'right' ? 1 : -1;
        const dir = sg; // forward traffic (+s) stops on the right half
        paintLine(group, { uc: sg * half / 2, width: half - 0.2, s0: sb.s - (dir > 0 ? US.stopBarWidth : 0), s1: sb.s + (dir > 0 ? 0 : US.stopBarWidth), name: 'mark_stop_bar' });
      }
    }
  }
  addRPMs(group, rpms);

  // ---- median grass (follows the same swale as terrain) + pavement edge fringe
  const fn = corridorFn();
  if (o.divided && o.medianSurface !== false) {
    const uM = a - o.leftShoulderWidth;
    const g = grid({ u0: -uM, u1: uM, s0, s1, du: Math.min(1.5, uM / 3), ds: 3,
      liftFn: (u, s) => { const r = fn(u, s); return r.paved ? -0.03 : r.rel; },
      skip: (u, s) => fn(u, s).paved });
    const mm = meshOf(g, surfaceMaterial('grass'), 'road_median_grass'); mm.userData.smoothNormals = true; group.add(mm);
  }
  if (o.surface === 'asphalt') {
    for (const sg of [1, -1]) {
      const ue = outerR, ranges = subtractRanges(s0, s1, sideRoadGaps(sg > 0 ? 'right' : 'left'));
      for (const [r0, r1] of ranges) {
        const cols = sg > 0 ? [ue - 0.12, ue, ue + 0.4] : [-(ue + 0.4), -ue, -(ue - 0.12)];
        const colUV = sg > 0 ? [0, 0.23, 1] : [1, 0.23, 0];
        const gg = ribbon({ s0: r0, s1: r1, cols, colUV, step: 8, liftFn: (u, s, k) => (sg > 0 ? k <= 1 : k >= 1) ? 0.0015 : -0.022 });
        group.add(meshOf(gg, fringeMat(), 'road_edge_fringe'));
      }
    }
  }

  // ---- terrain corridor registration
  function corridorFn() {
    const rs = o.roadside;
    // paved intervals in u at s
    const intervals = s => {
      const iv = [];
      if (o.divided) {
        for (const sg of [1, -1]) {
          const wt = turnWidthAt(sg, s), rin = a - wt - o.leftShoulderWidth, rout = a + nPer * w + o.shoulderWidth;
          iv.push(sg > 0 ? [rin, rout] : [-rout, -rin]);
        }
      } else iv.push([-outerR, outerR]);
      return iv;
    };
    const reach = outerR + 46 + Math.max(0, ...o.sideRoads.map(r => r.radius ?? 9));
    return (u, s) => {
      if (s < s0 - 60 || s > s1 + 60 || u > reach || u < -reach) return null;
      const iv = intervals(Math.min(s1, Math.max(s0, s)));
      let d = Infinity, inside = false;
      for (const [lo, hi] of iv) { if (u >= lo && u <= hi) { inside = true; d = Math.min(d, -Math.min(u - lo, hi - u)); } else d = Math.min(d, u < lo ? lo - u : u - hi); }
      let median = false;
      if (o.divided && !inside && Math.abs(u) < a) {
        median = true;
        const op = openingAt(s, u);
        if (op) { inside = true; d = -1; }
        else for (const op2 of o.openings) d = Math.min(d, Math.max(0, Math.abs(s - op2.at) - op2.width / 2 - (op2.radius ?? 10) * 0.6));
      }
      for (const sr of o.sideRoads) { // corner returns + throat count as paved
        const sg = (sr.side || 'right') === 'right' ? 1 : -1, W = sr.width ?? 6.1, R = sr.radius ?? 9, du = sg * u - outerR;
        if (du >= -0.1 && du <= R) {
          const ds = Math.abs(s - sr.at) - W / 2;
          const inRet = ds <= 0 || (ds <= R && Math.hypot(R - du, R - ds) >= R);
          if (inRet) { inside = true; d = Math.min(d, -0.5); }
          else d = Math.min(d, Math.max(0.01, R - Math.hypot(R - du, R - Math.min(ds, R)) > 0 ? 0.01 : Math.hypot(R - du, R - ds) - R));
        }
      }
      if (s < s0 || s > s1) { const ex = s < s0 ? s0 - s : s - s1; if (inside) { inside = false; d = ex; } else d = Math.hypot(d, ex); }
      if (inside) return { paved: true, d, rel: 0, w: 1, mow: 1 };
      const dd = Math.max(0, d - 0.6);
      let rel, wgt = 1, mow = 1;
      if (median) {
        const depth = rs.medianDepth; const lin = dd / 6;
        rel = -0.03 - depth * (1 - Math.exp(-lin / depth * 1.2)) ; // 1:6 side slope easing to a rounded bottom
      } else {
        const D = rs.ditchDepth, fore = D * 6, bottom = 1.5, back = D * 4;
        if (dd < fore) rel = -0.03 - dd / 6;
        else if (dd < fore + bottom) rel = -0.03 - D;
        else if (dd < fore + bottom + back) rel = -0.03 - D + (dd - fore - bottom) / 4 * 1.0;
        else rel = 0;
        rel = Math.min(rel, 0);
        const end = fore + bottom + back;
        wgt = 1 - smooth(end, end + 30, dd);
        mow = 1 - smooth(rs.mowWidth - 2, rs.mowWidth + 2, d);
      }
      return { paved: false, d, rel, w: wgt, median, mow };
    };
  }
  const corridor = { group, fn, inv: new THREE.Matrix4(), mw: new THREE.Matrix4(), last: null, drapedFor: 0 };
  if (o.register !== false) { TERRAIN.corridors.push(corridor); TERRAIN.version++; }

  const totalW = 2 * outerR;
  tag(group, o.id, 'road', { length: L, width: totalW, height: 0 }, {
    lanes: o.lanes, laneWidth: w, laneCenters, divided: o.divided, medianWidth: o.divided ? o.medianWidth : 0,
    edges: { outer: outerR, inner: o.divided ? a : 0 }, corridor: true,
  });
  group.updateMatrixWorld(true);
  if (o.register !== false) syncCorridors(); else redrape(group);
  return group;
}

/** median({id, width, length, kind:'grass'|'concrete'|'raised', position, heading}) — standalone median strip (local -Z). */
export function median(opts = {}) {
  const { id, width = 6, length = 100, kind = 'grass' } = opts;
  const g = new THREE.Group(); placeGroup(g, opts);
  if (kind === 'grass') {
    const depth = Math.min(0.6, width / 14);
    const geo = grid({ u0: -width / 2, u1: width / 2, s0: -length / 2, s1: length / 2, du: Math.min(1, width / 4), ds: 3,
      liftFn: (u) => -0.03 - depth * (1 - (2 * u / width) ** 2) });
    const m = meshOf(geo, surfaceMaterial('grass'), 'median_grass'); m.userData.smoothNormals = true; g.add(m);
  } else {
    const h = kind === 'raised' ? 0.15 : 0.02;
    const body = boxM(width, h, length, surfaceMaterial('concrete'));
    body.position.y = h / 2; g.add(body);
  }
  tag(g, id, 'median', { length, width, height: kind === 'raised' ? 0.15 : 0 });
  redrape(g);
  return g;
}

/** intersection({id, size=20 | width,length, position, heading}) — plain asphalt pad for a crossing (marking-free). */
export function intersection(opts = {}) {
  const { id, size = 20, width = size, length = size } = opts;
  const g = new THREE.Group(); placeGroup(g, opts);
  g.add(meshOf(polygon([[-width / 2, -length / 2], [width / 2, -length / 2], [width / 2, length / 2], [-width / 2, length / 2]], 0.0005), asphaltMat(), 'intersection_pad'));
  tag(g, id, 'intersection', { length, width, height: 0 });
  redrape(g);
  return g;
}

/** crossover({id, width=39.6 (along road), medianWidth=18, leftShoulderWidth=0.61, laneWidth, radius=10,
 *   turnLanes:[{carriageway, length, taper}], position, heading}) — a median opening for a divided road you built
 *   yourself (the road() `openings`/`turnLanes` options are preferred: they also break lines and grade the median). */
export function crossover(opts = {}) {
  const { id, width = 39.6, medianWidth = 18, leftShoulderWidth = 0.61, laneWidth = US.laneWidth, radius = 10, turnLanes = [] } = opts;
  const len = width + 2 * radius + Math.max(0, ...turnLanes.map(t => (t.length ?? 100) + (t.taper ?? 30))) * 2 + 2;
  const g = road({ lanes: 0, divided: true, register: false, medianSurface: false, medianWidth, leftShoulderWidth, laneWidth, shoulderWidth: 0, length: len, markings: 'standard', edgeLines: false, rpms: false, wear: false,
    openings: [{ at: 0, width, radius }],
    turnLanes: turnLanes.map(t => ({ ...t, stopAt: (t.carriageway === 'reverse' ? 1 : -1) * width / 2 })) });
  placeGroup(g, opts);
  tag(g, id, 'crossover', { length: width, width: medianWidth, height: 0 });
  return g;
}

/** crosswalk({id, width=3.0 (walking path), length=7.3 (distance across the road), style:'continental'|'parallel', position, heading})
 *  At rotation 0 it crosses a north-south road (spans X); continental bars run with traffic (along Z). */
export function crosswalk(opts = {}) {
  const { id, width = 3.0, length = 7.3, style = 'continental' } = opts;
  const g = new THREE.Group(); placeGroup(g, opts);
  if (style === 'continental') {
    const bar = 0.6, pitch = 1.2;
    const n = Math.floor((length + pitch - bar) / pitch), start = -((n - 1) * pitch) / 2;
    const geos = [];
    for (let i = 0; i < n; i++) { const u = start + i * pitch; geos.push(ribbon({ s0: -width / 2, s1: width / 2, u0: u - bar / 2, u1: u + bar / 2, step: 10, lift: 0.003, uvMode: 'across' })); }
    g.add(meshOf(mergeGeos(geos), paintMat(US.white), 'crosswalk_bars'));
  } else {
    for (const sg of [1, -1]) paintLine(g, { uc: 0, width: length, s0: sg * width / 2 - 0.15, s1: sg * width / 2 + 0.15, name: 'crosswalk_line' });
  }
  tag(g, id, 'crosswalk', { length: width, width: length, height: 0 });
  redrape(g);
  return g;
}

// box with UVs in metres on every face
function boxM(w, h, d, material) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.getAttribute('uv'), n = geo.getAttribute('normal');
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const [su, sv] = ax > 0.5 ? [d, h] : ay > 0.5 ? [w, d] : [w, h];
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  const m = new THREE.Mesh(geo, material); m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** curb({id, length=20, height=0.15, width=0.15, gutter=0.6, position, heading}) — concrete curb (+ gutter pan) along local -Z;
 *  local +X is the sidewalk side, the gutter lies at -X (road side). */
export function curb(opts = {}) {
  const { id, length = 20, height = 0.15, width = 0.15, gutter = 0.6 } = opts;
  const g = new THREE.Group(); placeGroup(g, opts);
  const c = boxM(width, height, length, surfaceMaterial('concrete')); c.position.set(width / 2, height / 2, 0); c.name = 'curb_body'; g.add(c);
  if (gutter > 0) g.add(meshOf(polygon([[-gutter, -length / 2], [0, -length / 2], [0, length / 2], [-gutter, length / 2]], 0.004), surfaceMaterial('concrete', { color: 0xd8d6d0, polygonOffset: -2 }), 'curb_gutter'));
  tag(g, id, 'curb', { length, width: width + gutter, height });
  redrape(g);
  return g;
}

/** sidewalk({id, width=1.5, length=20, height=0.15, joint=1.5, position, heading}) — concrete slab with tooled joints. */
export function sidewalk(opts = {}) {
  const { id, width = 1.5, length = 20, height = 0.15, joint = 1.5 } = opts;
  const g = new THREE.Group(); placeGroup(g, opts);
  const slab = boxM(width, height, length, surfaceMaterial('concrete')); slab.position.y = height / 2; slab.name = 'sidewalk_slab'; g.add(slab);
  const jm = mat('joint', () => new THREE.MeshStandardMaterial({ color: 0x55534f, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  const geos = [];
  for (let s = -length / 2 + joint; s < length / 2 - 0.01; s += joint) geos.push(ribbon({ s0: s - 0.006, s1: s + 0.006, u0: -width / 2, u1: width / 2, step: 10, lift: height + 0.001 }));
  if (geos.length) g.add(meshOf(mergeGeos(geos), jm, 'sidewalk_joints'));
  tag(g, id, 'sidewalk', { length, width, height });
  redrape(g);
  return g;
}

/** stopBar({id, width=3.6 (across), depth=0.6, position, heading}) — standalone stop line (across local X). */
export function stopBar(opts = {}) {
  const { id, width = US.laneWidth, depth = US.stopBarWidth } = opts;
  const g = new THREE.Group(); placeGroup(g, opts);
  paintLine(g, { uc: 0, width, s0: -depth / 2, s1: depth / 2, name: 'stop_bar' });
  tag(g, id, 'stopBar', { length: depth, width, height: 0 });
  redrape(g); return g;
}
/** turnArrow({id, kind:'left'|'right'|'through', position, heading}) — MUTCD-style pavement arrow, ~3 m, pointing local -Z. */
export function turnArrow(opts = {}) {
  const { id, kind = 'left' } = opts;
  const g = new THREE.Group(); placeGroup(g, opts);
  addArrow(g, kind, 0, -1.5, 1);
  tag(g, id, 'turnArrow', { length: 3, width: 1.5, height: 0 });
  redrape(g); return g;
}



// ------------------------------------------------------------------ site pads, parking lots, driveways
/** sitePad({id, position:[x,z], heading, width (local X), depth (local Z), paved=true, feather=12, surface='asphalt'|'concrete'|null})
 *  Flattens the natural terrain under a building / lot (registers with terrainHeight + groundPlane) and, when
 *  `surface` is set, lays a paved slab. Returns a Group whose local frame is the pad (u = local X, s = -local Z). */
export function sitePad(opts = {}) {
  const { id, width = 20, depth = 20, paved = true, feather = 12, surface = paved ? 'asphalt' : null, mowRing = 6 } = opts;
  const g = new THREE.Group(); placeGroup(g, opts);
  const W = width / 2, D = depth / 2;
  const fn = (u, s) => {
    const du = Math.max(0, Math.abs(u) - W), ds = Math.max(0, Math.abs(s) - D), d = Math.hypot(du, ds);
    if (d > feather + 2) return null;
    if (d === 0) return paved ? { paved: true, d: -Math.min(W - Math.abs(u), D - Math.abs(s)), rel: 0, w: 1, mow: 1 } : { paved: false, d: 0, rel: -0.02, w: 1, mow: 1 };
    return { paved: false, d, rel: -0.03 - Math.min(0.05, d * 0.01), w: 1 - smooth(0, feather, d), median: false, mow: 1 - smooth(mowRing * 0.6, mowRing, d) };
  };
  if (surface) {
    const sm = surface === 'concrete' ? surfaceMaterial('concrete', { polygonOffset: -1 }) : asphaltMat(0xf2f0ec);
    g.add(meshOf(polygon([[-W, -D], [W, -D], [W, D], [-W, D]], 0.0), sm, 'pad_surface'));
  }
  const corridor = { group: g, fn, inv: new THREE.Matrix4(), mw: new THREE.Matrix4(), last: null, drapedFor: 0 };
  TERRAIN.corridors.push(corridor); TERRAIN.version++;
  tag(g, id, 'sitePad', { length: depth, width, height: 0 }, { paved });
  g.updateMatrixWorld(true); syncCorridors();
  return g;
}

/** parkingLot({id, position, heading, width, depth, stallWidth=2.74, stallDepth=5.5, rows=2, aisle=7.3, accessible=1,
 *   surface='asphalt'}) — paved lot with 4-inch white stall lines (90-degree parking). Row 1 sits along the local -Z
 *  edge (the building side when the lot is placed in front of a building rotated to face it), further rows follow
 *  across `aisle`-wide drive aisles. Wheel stops on row 1. */
export function parkingLot(opts = {}) {
  const { width = 30, depth = 24, stallWidth = 2.74, stallDepth = 5.5, rows = 2, aisle = 7.3, accessible = 1 } = opts;
  const g = sitePad({ ...opts, paved: true, surface: opts.surface || 'asphalt' });
  g.userData.assetType = 'parkingLot';
  const W = width / 2, D = depth / 2, lw = 0.1;
  const nSt = Math.floor((width - 1) / stallWidth), u0 = -nSt * stallWidth / 2;
  const geos = [];
  const rowsS = [];
  let sTop = D - 0.3;
  for (let r = 0; r < rows; r++) {
    const s1 = sTop, s0 = s1 - stallDepth; if (s0 < -D + 0.3) break;
    rowsS.push([s0, s1, r]);
    for (let k = 0; k <= nSt; k++) { const u = u0 + k * stallWidth; geos.push(ribbon({ s0, s1, u0: u - lw / 2, u1: u + lw / 2, step: 10, lift: 0.003, uvMode: 'across' })); }
    sTop = r % 2 === 0 ? s0 : s0 - aisle; // double-loaded rows share the head line; aisles between pairs
  }
  if (geos.length) g.add(meshOf(mergeGeos(geos), paintMat(US.white), 'lot_stall_lines'));
  // accessible stalls (blue lines + 1.5 m access aisle hatch) at the first row's west end
  if (accessible && rowsS.length) {
    const [s0, s1] = rowsS[0], bl = mat('paintBlue', () => { const m = paintMat(US.white).clone(); m.color.setHex(0x2a5bb8); return m; });
    const ag = [];
    for (let k = 0; k < Math.min(accessible, nSt - 1); k++) { const u = u0 + k * stallWidth; for (const uu of [u, u + stallWidth]) ag.push(ribbon({ s0, s1, u0: uu - lw / 2, u1: uu + lw / 2, step: 10, lift: 0.0035, uvMode: 'across' })); }
    g.add(meshOf(mergeGeos(ag), bl, 'lot_accessible'));
  }
  // concrete wheel stops on row 1
  if (rowsS.length) {
    const [, s1] = rowsS[0];
    const ws = new THREE.InstancedMesh(new THREE.BoxGeometry(1.83, 0.12, 0.15), surfaceMaterial('concrete'), nSt);
    const o = new THREE.Object3D();
    for (let k = 0; k < nSt; k++) { o.position.set(u0 + (k + 0.5) * stallWidth, 0.06, -(s1 - 0.75)); o.updateMatrix(); ws.setMatrixAt(k, o.matrix); }
    ws.castShadow = ws.receiveShadow = true; ws.name = 'lot_wheel_stops'; g.add(ws);
    if (opts.position) ws.position.y = profileH(opts.position[0], opts.position[opts.position.length > 2 ? 2 : 1]);
  }
  g.userData.stalls = nSt * rowsS.length;
  redrape(g);
  return g;
}

/** driveway({id, position:[x,z] (centre of the throat at the road edge), heading (direction INTO the site), width=7.3,
 *   length=12, radius=4.5}) — paved apron from a road edge into a site, with flared radius returns. */
export function driveway(opts = {}) {
  const { width = 7.3, length = 12, radius = 4.5 } = opts;
  const g = new THREE.Group(); placeGroup(g, opts);
  const W = width / 2, R = radius, pts = [[-W - R, 0]];
  for (let k = 0; k <= 8; k++) { const a = (k / 8) * Math.PI / 2; pts.push([-W - R + R * Math.sin(a), R - R * Math.cos(a)]); }
  pts.push([-W, length], [W, length]);
  for (let k = 8; k >= 0; k--) { const a = (k / 8) * Math.PI / 2; pts.push([W + R - R * Math.sin(a), R - R * Math.cos(a)]); }
  pts.push([W + R, 0]);
  g.add(meshOf(polygon(pts.slice().reverse(), 0.0), asphaltMat(0xf2f0ec), 'driveway_apron'));
  const fn = (u, s) => {
    if (s < -1 || s > length + 10 || Math.abs(u) > W + R + 10) return null;
    const inside = s >= 0 && s <= length && (Math.abs(u) <= W || (s <= R && Math.hypot(Math.abs(u) - W - R, s - R) >= R && Math.abs(u) <= W + R));
    if (inside) return { paved: true, d: -0.5, rel: 0, w: 1, mow: 1 };
    const d = Math.max(0, Math.abs(u) - W - (s < R ? R - s : 0), s - length);
    return { paved: false, d, rel: -0.03, w: 1 - smooth(0, 8, d), mow: 1 };
  };
  TERRAIN.corridors.push({ group: g, fn, inv: new THREE.Matrix4(), mw: new THREE.Matrix4(), last: null, drapedFor: 0 }); TERRAIN.version++;
  tag(g, opts.id, 'driveway', { length, width: width + 2 * R, height: 0 });
  g.updateMatrixWorld(true); syncCorridors();
  return g;
}

// ------------------------------------------------------------------ curbs along a path, W-beam guardrail, canvas decals
/** curbStrip(pts[[u,s]...], {height, width, name}) — raised curb following a polyline in a road's local frame (draped).
 *  The curb's face is on the LEFT of the direction of travel along pts. Painted yellow (median noses) unless color given. */
function curbStrip(pts, { height = 0.15, width = 0.3, name = 'curb_strip', color = 0xd8a62a } = {}) {
  const pos = [], lift = [], uv = [];
  const P = pts.map(([u, s]) => new THREE.Vector2(u, s));
  const quad = (a, b, c, d, la, lb, lc, ld) => { for (const [v, l] of [[a, la], [b, lb], [c, lc], [a, la], [c, lc], [d, ld]]) { pos.push(v.x, 0, -v.y); lift.push(l); uv.push(v.x, v.y); } };
  const offs = P.map((p, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)]; const t = b.clone().sub(a).normalize(); return new THREE.Vector2(t.y, -t.x); }); // right normal
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1], na = offs[i], nb = offs[i + 1];
    const aI = a.clone(), bI = b.clone(), aO = a.clone().addScaledVector(na, width), bO = b.clone().addScaledVector(nb, width);
    // top (CCW seen from above in (u,s) -> up-facing after the u,s -> x,-z map)
    quad(aI, aO, bO, bI, height, height, height, height);
    quad(aI, bI, bI, aI, 0.0, 0.0, height, height); // face (left side, toward the opening)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('lift', new THREE.Float32BufferAttribute(lift, 1));
  for (let i = 0; i < pos.length; i += 3) pos[i + 1] = lift[i / 3];
  g.getAttribute('position').array.set(pos); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat('curbPaint' + color, () => new THREE.MeshStandardMaterial({ color, roughness: 0.72, side: THREE.DoubleSide, name: 'curb_paint' })));
  m.name = name; m.castShadow = true; m.receiveShadow = true; m.userData.drape = true; m.userData.smoothNormals = false;
  return m;
}

/** guardrail({id, points:[[x,z],...] WORLD, postSpacing=1.905, railTop=0.79, side:'left'|'right' (blockout side),
 *  endTreatment:'turndown'|'none'}) — MGS/W-beam guardrail: galvanised W6x9 posts, routed blockouts, 12-ga W-beam,
 *  following terrainHeight(). Ends turn down to grade over 7.6 m (buried terminal) by default. */
export function guardrail(opts = {}) {
  const { id, points = [[-20, 0], [20, 0]], postSpacing = 1.905, railTop = 0.79, side = 'right', endTreatment = 'turndown' } = opts;
  const g = new THREE.Group();
  const galv = mat('galvRail', () => new THREE.MeshStandardMaterial({ color: 0xa9aeb0, metalness: 0.8, roughness: 0.38, side: THREE.DoubleSide, name: 'galv' }));
  const wood = mat('blockout', () => new THREE.MeshStandardMaterial({ color: 0x5e5246, roughness: 0.95 }));
  // resample the polyline
  const P = points.map(p => new THREE.Vector2(p[0], p[1]));
  const samples = []; let tot = 0;
  for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1], L = a.distanceTo(b), n = Math.max(1, Math.round(L / postSpacing)); for (let k = i ? 1 : 0; k <= n; k++) { const t = k / n; samples.push({ p: a.clone().lerp(b, t), d: tot + L * t }); } tot += L; }
  const sgn = side === 'right' ? 1 : -1, beamH = 0.31, cY = railTop - beamH / 2;
  const drop = d => endTreatment === 'turndown' ? Math.min(1, d / 7.6, (tot - d) / 7.6) : 1;
  const ys = samples.map(s => terrainHeight(s.p.x, s.p.y) + 0.02);
  const dirs = samples.map((s, i) => { const a = samples[Math.max(0, i - 1)].p, b = samples[Math.min(samples.length - 1, i + 1)].p; return b.clone().sub(a).normalize(); });
  // posts + blockouts
  const post = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, 1, 0.152), galv, samples.length);
  const blk = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.36, 0.15), wood, samples.length);
  const o = new THREE.Object3D();
  samples.forEach((s, i) => {
    const dr = dirs[i], nx = dr.y * sgn, nz = -dr.x * sgn, ang = Math.atan2(-dr.x, -dr.y);
    const k = drop(s.d), top = Math.max(0.2, (railTop + 0.05) * k);
    o.position.set(s.p.x, ys[i] + top / 2 - 0.0, s.p.y); o.rotation.set(0, ang, 0); o.scale.set(1, top, 1); o.updateMatrix(); post.setMatrixAt(i, o.matrix);
    o.position.set(s.p.x + nx * 0.17, ys[i] + Math.max(0.15, cY * k), s.p.y + nz * 0.17); o.scale.set(k > 0.4 ? 1 : 0.001, 1, 1); o.updateMatrix(); blk.setMatrixAt(i, o.matrix);
  });
  post.castShadow = blk.castShadow = true; post.receiveShadow = blk.receiveShadow = true; post.name = 'guardrail_posts'; blk.name = 'guardrail_blockouts';
  // W-beam: sweep the corrugated profile along the samples (offset to the blockout face)
  const prof = [[0, -0.155], [0.035, -0.12], [0.083, -0.085], [0.083, -0.045], [0.03, -0.012], [0.03, 0.012], [0.083, 0.045], [0.083, 0.085], [0.035, 0.12], [0, 0.155]];
  const pos = [], idx = [], NP = prof.length;
  samples.forEach((s, i) => {
    const dr = dirs[i], nx = dr.y * sgn, nz = -dr.x * sgn, k = drop(s.d), yc = ys[i] + Math.max(0.12, cY * k);
    for (const [dd, dy] of prof) { const off = 0.27 + dd; pos.push(s.p.x + nx * off, yc + dy, s.p.y + nz * off); }
    if (i) for (let j = 0; j < NP - 1; j++) { const a = (i - 1) * NP + j, b = a + 1, c = a + NP, d = c + 1; idx.push(a, c, b, b, c, d); }
  });
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.setIndex(idx); bg.computeVertexNormals();
  const beam = new THREE.Mesh(bg, galv); beam.castShadow = true; beam.receiveShadow = true; beam.name = 'guardrail_beam';
  g.add(post, blk, beam);
  for (const m of [post, blk]) { m.computeBoundingBox(); m.computeBoundingSphere(); }
  tag(g, id, 'guardrail', { length: tot, width: 0.5, height: railTop }, { points, postSpacing });
  return g;
}

/** roadDecal({id, kind, position:[x,z], heading, w, h, color}) — high-resolution CanvasTexture pavement marking
 *  (see textures.decalTexture kinds), draped on the road surface. Arrows point along local -Z (direction of heading).
 *  Uses renderer max anisotropy via setAnisotropy(). */
export function roadDecal(opts = {}) {
  const { id, kind = 'arrow_through', color } = opts;
  const g = new THREE.Group(); placeGroup(g, opts);
  const t = decalTexture(kind, { ...(opts.w ? { w: opts.w } : {}), ...(opts.h ? { h: opts.h } : {}), ...(color ? { color } : {}) });
  const w = t?.w ?? opts.w ?? 2, h = t?.h ?? opts.h ?? 2;
  const material = t ? mat('decal:' + t.map.uuid, () => new THREE.MeshStandardMaterial({ map: t.map, transparent: true, depthWrite: false, roughness: 0.6, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8, name: 'decal_' + kind })) : paintMat(color === 'yellow' ? US.yellow : US.white);
  const geo = ribbon({ s0: 0, s1: h, u0: -w / 2, u1: w / 2, step: Math.max(1, h / 6), lift: 0.004, uvMode: 'across' });
  const uv = geo.getAttribute('uv'); for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) / h);
  const m = meshOf(geo, material, 'decal_' + kind); m.renderOrder = 1; g.add(m);
  tag(g, id, 'roadDecal', { length: h, width: w, height: 0 }, { kind });
  redrape(g); return g;
}

// ------------------------------------------------------------------ evidence decals
/** skidMark({id, points:[[x,z],...] (WORLD coords), width=0.25, pair=false, track=1.6, darkness=1}) — tire marks
 *  draped on the road surface. pair:true draws left+right tire marks `track` apart, centred on the polyline. */
export function skidMark(opts = {}) {
  const { id, points = [], width = 0.25, pair = false, track = 1.6, darkness = 1 } = opts;
  const g = new THREE.Group();
  const tex = skidTexture();
  const m = mat('skid' + darkness, () => new THREE.MeshStandardMaterial({ map: tex.map, color: 0xffffff, transparent: true, opacity: Math.min(1, 0.9 * darkness), depthWrite: false,
    roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10, vertexColors: true, side: THREE.DoubleSide }));
  const offsets = pair ? [-track / 2, track / 2] : [0];
  let total = 0;
  for (const off of offsets) {
    const P = points.map(p => new THREE.Vector2(p[0], p[1]));
    if (P.length < 2) continue;
    const pos = [], uv = [], col = [], idx = [], lift = [];
    let acc = 0; const lenTot = P.reduce((s, p, i) => i ? s + p.distanceTo(P[i - 1]) : 0, 0);
    P.forEach((p, i) => {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      const t = new THREE.Vector2().subVectors(b, a).normalize(), nrm = new THREE.Vector2(-t.y, t.x);
      if (i) acc += p.distanceTo(P[i - 1]);
      const c = p.clone().addScaledVector(nrm, off);
      const fade = Math.min(1, acc / 0.8, (lenTot - acc) / 0.4);
      for (const k of [-1, 1]) {
        const q = c.clone().addScaledVector(nrm, k * width / 2);
        pos.push(q.x, 0, q.y); uv.push(k < 0 ? 0 : 1, acc); col.push(1, 1, 1, Math.max(0, fade)); lift.push(0.004);
      }
      if (i) { const o = (i - 1) * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
    });
    total = lenTot;
    const geo = finishGeo(pos, uv, idx, lift, { color: new THREE.Float32BufferAttribute(col, 4) });
    // winding check: ensure faces point up
    geo.computeVertexNormals(); const ny = geo.getAttribute('normal').getY(0);
    if (ny < 0) { const ia = geo.index.array; for (let i = 0; i < ia.length; i += 3) { const t = ia[i + 1]; ia[i + 1] = ia[i + 2]; ia[i + 2] = t; } }
    const nn = geo.getAttribute('normal'); for (let i = 0; i < nn.count; i++) nn.setXYZ(i, 0, 1, 0);
    const mesh = meshOf(geo, m, 'skid_tire'); mesh.renderOrder = 2; g.add(mesh);
  }
  tag(g, id, 'skidMark', { length: total, width: pair ? track + width : width, height: 0 }, { points });
  redrape(g);
  return g;
}

/** impactMarker({id, position:[x,z], radius=0.45, color=0xf26a21}) — subtle spray-painted ring + cross on the pavement
 *  (how investigators mark the area of impact). Ground-level only; never a floating/eye-level object. */
export function impactMarker(opts = {}) {
  const { id, position = [0, 0], radius = 0.45, color = 0xf26a21 } = opts;
  const g = new THREE.Group(); g.position.set(position[0], 0, position[1]);
  const m = mat('spray' + color, () => new THREE.MeshStandardMaterial({ color, map: sprayTexture().map, transparent: true, side: THREE.DoubleSide, opacity: 0.85, depthWrite: false, roughness: 0.7,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 }));
  const ring = polygonRing(radius, 0.05, 40);
  const lw = 0.05, arm = radius * 1.6;
  const geos = [ring,
    ribbon({ s0: -arm, s1: arm, u0: -lw / 2, u1: lw / 2, step: 10, lift: 0.004, uvMode: 'across' }),
    polygon([[-arm, -lw / 2], [arm, -lw / 2], [arm, lw / 2], [-arm, lw / 2]], 0.004)];
  g.add(meshOf(mergeGeos(geos), m, 'impact_paint'));
  tag(g, id, 'impactMarker', { length: 2 * arm, width: 2 * arm, height: 0 });
  redrape(g);
  return g;
}
function polygonRing(r, w, n) {
  const pos = [], uv = [], idx = [], lift = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    for (const rr of [r - w / 2, r + w / 2]) { pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr); uv.push(Math.cos(a) * rr, Math.sin(a) * rr); lift.push(0.004); }
    if (i) { const o = (i - 1) * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
  }
  return finishGeo(pos, uv, idx, lift);
}

// ------------------------------------------------------------------ ground
/** groundPlane({id, size=3000, kind='pasture'|'grass'|'dirt'|'asphalt', center:[x,z], inner=900, innerStep=2.5, outerStep=25})
 *  Textured terrain following terrainHeight(); rebuilds itself automatically when roads/profiles change.
 *  Vertex colours add macro variation (mowed right-of-way vs pasture patches). */
export function groundPlane(opts = {}) {
  const { id = 'ground', size = 3000, kind = 'pasture', center = [0, 0], inner = 900, innerStep = 2.5, outerStep = 25 } = opts;
  const g = new THREE.Group(); g.name = id;
  const texKind = kind === 'asphalt' ? 'asphalt' : kind === 'dirt' ? 'dirt' : kind === 'grass' ? 'grass' : 'pasture';
  const material = surfaceMaterial(texKind, { vertexColors: true });
  const build = (half, step, hole) => {
    const n = Math.ceil((2 * half) / step), pos = [], uv = [], idx = [];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const x = center[0] - half + (2 * half) * i / n, z = center[1] - half + (2 * half) * j / n;
      pos.push(x, 0, z); uv.push(x, -z);
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      if (hole) { const xc = center[0] - half + (2 * half) * (i + 0.5) / n - center[0], zc = center[1] - half + (2 * half) * (j + 0.5) / n - center[1]; if (Math.abs(xc) < hole - step / 2 && Math.abs(zc) < hole - step / 2) continue; }
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3));
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, material); m.receiveShadow = true; m.name = id + '_mesh';
    return m;
  };
  const innerMesh = build(inner / 2, innerStep, 0), outerMesh = build(size / 2, outerStep, inner / 2);
  g.add(innerMesh, outerMesh);
  const state = { built: 0 };
  const BIG = 1 << 20;
  const rebuild = () => {
    for (const mesh of [innerMesh, outerMesh]) {
      const p = mesh.geometry.getAttribute('position'), c = mesh.geometry.getAttribute('color');
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        const base = profileH(x, z), cs = corridorSample(x, z);
        let y = cs.paved ? base - 0.06 : base + cs.rel * cs.w + natural(x, z) * (1 - cs.w);
        if (cs.median) y -= 0.08;           // the road's own median mesh shows; keep ground below it
        p.setY(i, y);
        // macro colour (non-repeating): dry straw patches vs greener swales, mottling, mowed right-of-way
        const patch = vnoise(x / 45 + 99, z / 45 + 99, BIG, 31), mott = vnoise(x / 11 + 9, z / 11 + 9, BIG, 32), broad = vnoise(x / 190, z / 190, BIG, 33);
        const dry = smooth(0.35, 0.8, broad * 0.6 + patch * 0.4);
        let r = 0.9 + dry * 0.24, gg = 0.97 + dry * 0.05, b = 0.9 - dry * 0.04;
        const br = 0.9 + mott * 0.18 + (patch - 0.5) * 0.08; r *= br; gg *= br; b *= br;
        if (cs.mow > 0) { const t = cs.mow; const mb = 0.97 + (mott - 0.5) * 0.06; r = r * (1 - t) + 0.98 * mb * t; gg = gg * (1 - t) + 1.02 * mb * t; b = b * (1 - t) + 0.92 * mb * t; }
        const ditchWet = cs.rel < -0.35 && !cs.paved ? Math.min(1, (-cs.rel - 0.35) * 2) * cs.w : 0;
        c.setXYZ(i, r * (1 - ditchWet * 0.25), gg * (1 - ditchWet * 0.12), b * (1 - ditchWet * 0.2));
      }
      p.needsUpdate = true; c.needsUpdate = true;
      mesh.geometry.computeVertexNormals(); mesh.geometry.computeBoundingSphere(); mesh.geometry.computeBoundingBox();
    }
    state.built = TERRAIN.version;
  };
  const check = () => { syncCorridors(); if (state.built !== TERRAIN.version) rebuild(); };
  // auto-refresh before each render (renderer calls scene.updateMatrixWorld() before culling/upload)
  const umw = g.updateMatrixWorld.bind(g);
  g.updateMatrixWorld = force => { umw(force); check(); };
  check();
  TERRAIN.grounds.add(g);
  tag(g, id, 'groundPlane', { length: size, width: size, height: 0 }, { kind, refresh: check });
  return g;
}

// ------------------------------------------------------------------ distant vegetation
/** treeline({id, points:[[x,z],...], depth=14, spacing=7, height=13, pineRatio=0.35, seed=1}) — a belt of Florida
 *  hammock trees (live-oak masses + slash pines) along a polyline. Cheap instanced geometry for horizons. */
export function treeline(opts = {}) {
  const { id, points = [[-200, -100], [200, -100]], depth = 14, spacing = 7, height = 13, pineRatio = 0.35, seed = 1 } = opts;
  const g = new THREE.Group();
  const rnd = (() => { let s = seed * 9301 + 49297; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); })();
  const crowns = [], trunks = [];
  const C = (r, g, b) => [r, g, b];
  for (let i = 1; i < points.length; i++) {
    const [x0, z0] = points[i - 1], [x1, z1] = points[i];
    const len = Math.hypot(x1 - x0, z1 - z0), tx = (x1 - x0) / len, tz = (z1 - z0) / len;
    const rows = Math.max(1, Math.round(depth / spacing));
    for (let d = 0; d < len; d += spacing * (0.6 + rnd() * 0.7)) {
      for (let row = 0; row < rows; row++) {
        const off = (row / rows - 0.5) * depth + (rnd() - 0.5) * spacing;
        const x = x0 + tx * d - tz * off, z = z0 + tz * d + tx * off, y0 = TERRAIN.profiles.length ? profileH(x, z) : 0;
        const h = height * (0.7 + rnd() * 0.55);
        if (rnd() < pineRatio) {             // slash pine: tall bare trunk, small irregular crown on top
          const H = h * 1.35;
          trunks.push({ x, z, y: y0, h: H, r: 0.2 });
          for (let k = 0; k < 3; k++) { const cr = 1.6 + rnd() * 1.4; crowns.push({ k: 'pine', x: x + (rnd() - 0.5) * 2.5, z: z + (rnd() - 0.5) * 2.5, y: y0 + H - 1.2 - k * 1.4 - rnd(), sx: cr * 1.3, sy: cr * 0.7, sz: cr * 1.3, c: C(0.24 + rnd() * 0.05, 0.28 + rnd() * 0.05, 0.16) }); }
        } else {                              // live oak / laurel oak mass: broad, low, overlapping crowns
          const w = h * (0.7 + rnd() * 0.4);
          trunks.push({ x, z, y: y0, h: h * 0.35, r: 0.32 });
          const n = 5 + Math.floor(rnd() * 4);
          for (let k = 0; k < n; k++) crowns.push({ k: 'oak', x: x + (rnd() - 0.5) * w * 0.9, z: z + (rnd() - 0.5) * w * 0.9, y: y0 + h * (0.42 + rnd() * 0.38), sx: w * (0.28 + rnd() * 0.2), sy: h * (0.18 + rnd() * 0.12), sz: w * (0.28 + rnd() * 0.2),
            c: C(0.22 + rnd() * 0.07, 0.27 + rnd() * 0.07, 0.15 + rnd() * 0.04) });
        }
        // understory (palmetto, wax myrtle, young oaks) hides trunk gaps
        if (row === 0 || rnd() < 0.4) for (let k = 0; k < 2; k++) { const sw = 2 + rnd() * 3; crowns.push({ k: 'shrub', x: x + (rnd() - 0.5) * spacing, z: z + (rnd() - 0.5) * spacing, y: y0 + sw * 0.35, sx: sw, sy: sw * (0.45 + rnd() * 0.3), sz: sw, c: C(0.25 + rnd() * 0.06, 0.29 + rnd() * 0.06, 0.16 + rnd() * 0.04) }); }
      }
    }
  }
  // crowns: instanced clusters of alpha-clipped leaf cards (alphaTest 0.5, cast alpha-tested shadows), one
  // InstancedMesh per species; a dark inner core (shrunk, opaque) stops the sky showing through dense masses.
  const tm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.7, 1, 1, 6), new THREE.MeshStandardMaterial({ color: 0x4a3f33, roughness: 1 }), trunks.length);
  const o = new THREE.Object3D(), col = new THREE.Color();
  const SPEC = { oak: { cards: 14, flat: 0.7, size: 0.85 }, pine: { cards: 12, flat: 0.55, size: 0.9 }, shrub: { cards: 10, flat: 0.75, size: 0.8 } };
  const coreMat = mat('treeCore', () => new THREE.MeshStandardMaterial({ color: 0x27331c, roughness: 1 }));
  const coreGeo = new THREE.IcosahedronGeometry(0.62, 1);
  for (const kind of Object.keys(SPEC)) {
    const list = crowns.filter(c => c.k === kind); if (!list.length) continue;
    const cmK = new THREE.InstancedMesh(foliageClusterGeometry({ ...SPEC[kind], seed: kind.length + seed }), foliageMaterial(kind === 'pine' ? 'pine' : kind), list.length);
    const core = new THREE.InstancedMesh(coreGeo, coreMat, list.length);
    list.forEach((c, i) => {
      o.position.set(c.x, c.y, c.z); o.scale.set(c.sx, c.sy, c.sz); o.rotation.set(0, i * 2.39, 0); o.updateMatrix(); cmK.setMatrixAt(i, o.matrix);
      o.scale.multiplyScalar(0.92); o.updateMatrix(); core.setMatrixAt(i, o.matrix);
      cmK.setColorAt(i, col.setRGB(0.86 + (c.c[0] - 0.24) * 3, 0.9 + (c.c[1] - 0.29) * 3, 0.82 + (c.c[2] - 0.16) * 3));
    });
    cmK.castShadow = true; cmK.receiveShadow = true; cmK.name = 'treeline_leaves_' + kind; cmK.computeBoundingSphere();
    core.castShadow = true; core.receiveShadow = true; core.name = 'treeline_core_' + kind; core.computeBoundingSphere();
    g.add(cmK, core);
  }
  tm.castShadow = true;
  tm.name = 'treeline_trunks'; tm.computeBoundingSphere();
  g.add(tm);
  tag(g, id, 'treeline', { length: 0, width: depth, height }, { count: trunks.length });
  return g;
}

// ------------------------------------------------------------------ furniture / environment re-exports
// Owned by web/assets/furniture.js and web/assets/environment.js. Loaded with a timeout so a missing file or an
// import cycle never blocks this module; boxes of catalog dimensions stand in until they exist.
// NOTE for those modules: import './textures.js' if needed, never './scene.js'.
const withTimeout = (p, ms) => Promise.race([p, new Promise(r => { const t = setTimeout(() => r(null), ms); t?.unref?.(); })]);
let FURN = null, ENV = null;
try { FURN = await withTimeout(import('./furniture.js'), 4000); } catch { FURN = null; }
try { ENV = await withTimeout(import('./environment.js'), 4000); } catch { ENV = null; }

function stubBox(id, type, L, W, H, color = 0x8a8f96) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(W, H, L), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  m.position.y = H / 2; m.castShadow = m.receiveShadow = true; g.add(m);
  return tag(g, id, type, { length: L, width: W, height: H }, { stub: true });
}
const STUBS = {
  signal: (o = {}) => { const g = stubBox(o.id, 'signal', 0.3, 0.3, o.poleHeight ?? 5.5, 0x333333); g.userData.setState = () => {}; return g; },
  sign: (o = {}) => stubBox(o.id, 'sign', 0.1, 0.75, 2.4, 0xb0b0b0),
  pole: (o = {}) => { const g = new THREE.Group(); const h = o.height ?? 10.7; const m = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, h, 10), new THREE.MeshStandardMaterial({ color: 0x5b4a3a, roughness: 1 })); m.position.y = h / 2; m.castShadow = true; g.add(m); return tag(g, o.id, 'pole', { length: 0.34, width: 0.34, height: h }, { stub: true }); },
  streetlight: (o = {}) => stubBox(o.id, 'streetlight', 0.25, 0.25, o.height ?? 9, 0x9a9a9a),
  shelter: (o = {}) => stubBox(o.id, 'shelter', 1.5, 3.5, 2.5, 0x5d6b78),
  building: (o = {}) => stubBox(o.id, 'building', o.d ?? 10, o.w ?? 10, o.h ?? 4, 0xc9bfae),
  tree: (o = {}) => { const g = new THREE.Group(); const h = o.height ?? 8; const t = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, h * 0.45, 8), new THREE.MeshStandardMaterial({ color: 0x4a3f33 })); t.position.y = h * 0.225; const c = new THREE.Mesh(new THREE.IcosahedronGeometry(h * 0.33, 1), new THREE.MeshStandardMaterial({ color: 0x3d5a2a, roughness: 1 })); c.position.y = h * 0.66; t.castShadow = c.castShadow = true; g.add(t, c); return tag(g, o.id, 'tree', { length: h * 0.66, width: h * 0.66, height: h }, { stub: true }); },
  fence: (o = {}) => stubBox(o.id, 'fence', o.length ?? 20, 0.1, o.height ?? 1.2, 0x8b7d6b),
  parkedVehicle: (type, o = {}) => stubBox(o.id, 'vehicle', 4.9, 1.9, 1.45, 0x777777),
};
const pick = (name) => (FURN && (FURN[name] || FURN.default?.[name])) || STUBS[name];
export const signal = (...a) => pick('signal')(...a);
export const sign = (...a) => pick('sign')(...a);
export const pole = (...a) => pick('pole')(...a);
export const streetlight = (...a) => pick('streetlight')(...a);
export const shelter = (...a) => pick('shelter')(...a);
export const building = (...a) => pick('building')(...a);
export const tree = (...a) => pick('tree')(...a);
export const fence = (...a) => pick('fence')(...a);
export const parkedVehicle = (...a) => pick('parkedVehicle')(...a);

/** solarPosition(date|{dateISO, timeOfDay, lat, lon, tzOffsetHours}) -> {azimuthDeg, elevationDeg} (NOAA approx; stub if environment.js absent). */
function solarStub(arg = {}) {
  const lat = arg.lat ?? 29.4, lon = arg.lon ?? -82.6, tz = arg.tzOffsetHours ?? -4;
  const d = arg instanceof Date ? arg : new Date((arg.dateISO || '2016-05-07') + 'T' + (arg.timeOfDay || '16:36') + ':00Z');
  const hours = d.getUTCHours() + d.getUTCMinutes() / 60 - tz;
  const start = Date.UTC(d.getUTCFullYear(), 0, 0), doy = Math.floor((d - start) / 864e5);
  const g = 2 * Math.PI / 365 * (doy - 1 + (hours - 12) / 24);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = hours * 60 + eqt + 4 * lon - 60 * tz, ha = (tst / 4 - 180) * Math.PI / 180, la = lat * Math.PI / 180;
  const cosZ = Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha), zen = Math.acos(Math.min(1, Math.max(-1, cosZ)));
  let az = Math.acos(Math.min(1, Math.max(-1, (Math.sin(la) * Math.cos(zen) - Math.sin(decl)) / (Math.cos(la) * Math.sin(zen))))) * 180 / Math.PI;
  az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360;
  return { azimuthDeg: az, elevationDeg: 90 - zen * 180 / Math.PI };
}
function environmentStub(o = {}) {
  const sp = o.sunAzimuthDeg != null ? { azimuthDeg: o.sunAzimuthDeg, elevationDeg: o.sunElevationDeg ?? 45 } : solarStub({ timeOfDay: o.timeOfDay });
  const g = new THREE.Group(); g.name = o.id || 'environment';
  const az = sp.azimuthDeg * Math.PI / 180, el = Math.max(2, sp.elevationDeg) * Math.PI / 180;
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(400);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 10, far: 1200 }); sun.shadow.bias = -0.0004;
  const hemi = new THREE.HemisphereLight(0xbfd6f0, 0x6b6a4a, 0.9);
  g.add(sun, sun.target, hemi);
  g.userData = { assetType: 'environment', dims: { length: 0, width: 0, height: 0 }, sun: sp, sky: { top: 0x6f9fd8, horizon: 0xdfe7ee, fog: 0xd9e2ea, fogNear: 300, fogFar: 2600 }, stub: true };
  return { group: g, lights: [sun, hemi], sky: g.userData.sky, sun: sp };
}
export const environment = (...a) => ((ENV && (ENV.environment || ENV.default?.environment)) || environmentStub)(...a);
export const solarPosition = (...a) => ((ENV && (ENV.solarPosition || ENV.default?.solarPosition)) || solarStub)(...a);
export const LOADED = { furniture: !!FURN, environment: !!ENV };
