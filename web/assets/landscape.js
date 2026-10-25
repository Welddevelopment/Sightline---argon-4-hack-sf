// Sightline LANDSCAPE: photographic rural-Florida ground, roadside grass, forest / treeline impostors, fair-weather
// cumulus, fences and drainage swales — all at real scale, cached, browser + Node safe (no DOM needed except to decode an
// aerial photo; in Node textures are generated at 1/8 resolution and aerial-driven forest is skipped).
// Pure ES module: THREE is passed in (same rule as environment.js); this file never imports three or other assets.
// World frame (SPEC WORLD CONTRACT v2): metres, Y up, +X east, -Z north.
//
//   import * as L from './assets/landscape.js';
//   const site   = L.aerialSite(THREE, { url, boundsMeters, calibration });          // optional: real aerial (forest mask + photo)
//   const ground = L.pastureGround(THREE, { size: 4000, terrainHeight, roadHeight, roads: 'auto', site });
//   const forest = L.forest(THREE, { site, terrainHeight, roads: 'auto', avoid: 'auto' }); // trees where the photo shows canopy
//   const ring   = L.treeline(THREE, { distance: [300, 1100], terrainHeight, roads: 'auto', exclude: site });
//   const grass  = L.grassBlades(THREE, { focus: [[x,z],...], radius: 45, density: 14, terrainHeight, roadHeight, roads: 'auto' });
//   const clouds = L.skyClouds(THREE, { coverage: 0.12, sunAzimuth: 265, sunElevation: 45 });
//   const fence  = L.fenceLine(THREE, { points, terrainHeight });  const sw = L.ditch(THREE, { points, terrainHeight });
//
// roads: an array from roadsFromWorld(THREE, root), or 'auto' = discover road groups (userData.assetType 'road', made by
// scene.js road()) in the scene graph the first time the object is rendered / updateMatrixWorld()'d after being added.

const IS_BROWSER = typeof document !== 'undefined' && typeof document.createElement === 'function';
const NODE_SCALE = 8;
const TEX = new Map();
const MAT = new Map();
const cached = (map, key, make) => (map.has(key) ? map.get(key) : (map.set(key, make()), map.get(key)));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- noise (periodic value noise)
function hash2(i, j, seed) {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const pmod = (a, n) => ((a % n) + n) % n;
function vnoise(x, y, P, seed) {
  const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const x0 = pmod(xi, P), x1 = pmod(xi + 1, P), y0 = pmod(yi, P), y1 = pmod(yi + 1, P);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(u, v, P, oct, seed, gain = 0.5) {
  let s = 0, amp = 1, norm = 0, p = P;
  for (let o = 0; o < oct; o++) { s += amp * vnoise(u * p, v * p, p, seed + o * 101); norm += amp; amp *= gain; p *= 2; }
  return s / norm;
}
function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function dataTexture(THREE, data, w, h, { srgb = false, repeat = true, mips = true, aniso = 8 } = {}) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.generateMipmaps = mips; t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
const res = (n) => (IS_BROWSER ? n : Math.max(8, n / NODE_SCALE));

// normals from a wrapped height field -> RGBA bytes (tangent space, +Y = +v)
function heightToNormals(hgt, N, strength, wrap = true) {
  const out = new Uint8Array(N * N * 4);
  const at = (x, y) => (wrap ? hgt[pmod(y, N) * N + pmod(x, N)] : hgt[clamp(y, 0, N - 1) * N + clamp(x, 0, N - 1)]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    let nx = -dx, ny = -dy, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * N + x) * 4;
    out[i] = (nx * 0.5 + 0.5) * 255; out[i + 1] = (ny * 0.5 + 0.5) * 255; out[i + 2] = (nz * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
  return out;
}

// ---------------------------------------------------------------- grass detail tiles (top-down blades, seamless)
// kind 'mowed': bahia / St Augustine right-of-way cut ~10 cm, fresh May growth with cut-straw flecks.
// kind 'pasture': taller, tuftier, more dead thatch and sandy soil showing.
// Colours are sRGB; the shader divides by the tile's linear mean, so the tile carries only blade-scale variation.
const GRASS_PALETTES = {
  mowed: { soil: [74, 66, 44], blades: [[[84, 104, 44], 0.30], [[98, 116, 52], 0.25], [[70, 92, 38], 0.18], [[118, 126, 62], 0.12], [[150, 142, 92], 0.09], [[128, 112, 70], 0.06]], density: 0.050, len: [5, 16], width: [1.1, 2.1] },
  pasture: { soil: [96, 86, 62], blades: [[[90, 104, 48], 0.24], [[106, 112, 56], 0.18], [[140, 134, 84], 0.22], [[166, 154, 104], 0.14], [[78, 88, 42], 0.12], [[116, 98, 66], 0.10]], density: 0.040, len: [8, 28], width: [1.0, 2.2] },
};
function grassTile(THREE, kind) {
  return cached(TEX, 'grass_' + kind, () => {
    const N = res(1024), P = GRASS_PALETTES[kind], R = rng(kind === 'mowed' ? 11 : 23);
    const col = new Float32Array(N * N * 3), hgt = new Float32Array(N * N);
    const sc = N / 1024;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {   // soil / thatch bed
      const n = fbm(x / N, y / N, 16, 3, 5) * 0.6 + vnoise(x / N * 128, y / N * 128, 128, 9) * 0.4, i = (y * N + x) * 3;
      for (let c = 0; c < 3; c++) col[i + c] = P.soil[c] * (0.7 + 0.5 * n);
      hgt[y * N + x] = n * 0.15;
    }
    const pick = () => { let r = R(), acc = 0; for (const [c, w] of P.blades) { acc += w; if (r <= acc) return c; } return P.blades[0][0]; };
    const count = Math.round(N * N * P.density);
    for (let k = 0; k < count; k++) {
      const x0 = R() * N, y0 = R() * N, ang = R() * Math.PI * 2, len = (P.len[0] + R() * (P.len[1] - P.len[0])) * sc;
      const w0 = Math.max(0.6, (P.width[0] + R() * (P.width[1] - P.width[0])) * sc);
      const base = pick(), j = 0.85 + R() * 0.3, layer = k / count;
      const ca = Math.cos(ang), sa = Math.sin(ang), steps = Math.max(2, Math.ceil(len / 0.6));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps, px = x0 + ca * len * t, py = y0 + sa * len * t, w = w0 * (1 - 0.7 * t);
        const lift = 0.75 + 0.45 * t;                                   // tips catch more light
        const nw = Math.max(1, Math.ceil(w / 0.6));
        for (let q = 0; q < nw; q++) {
          const o = (q / Math.max(1, nw - 1) - 0.5) * w, xx = pmod(Math.round(px - sa * o), N), yy = pmod(Math.round(py + ca * o), N);
          const ii = yy * N + xx;
          const hh = 0.3 + layer * 0.4 + t * 0.3;
          if (hh < hgt[ii]) continue;
          hgt[ii] = hh;
          col[ii * 3] = base[0] * j * lift; col[ii * 3 + 1] = base[1] * j * lift; col[ii * 3 + 2] = base[2] * j * lift;
        }
      }
    }
    const out = new Uint8Array(N * N * 4); const mean = [0, 0, 0];
    for (let i = 0; i < N * N; i++) for (let c = 0; c < 4; c++) {
      if (c === 3) { out[i * 4 + 3] = 255; continue; }
      const v = clamp(col[i * 3 + c], 0, 255); out[i * 4 + c] = v; mean[c] += srgbToLin(v / 255);
    }
    for (let c = 0; c < 3; c++) mean[c] /= N * N;
    return {
      map: dataTexture(THREE, out, N, N, { srgb: true }),
      normalMap: dataTexture(THREE, heightToNormals(hgt, N, 3.2 * sc), N, N),
      mean,
    };
  });
}

// macro variation (non-repeating look from 4 incommensurate scales in the shader): r dryness, g brightness, b sand, a tussocks
function macroTexture(THREE) {
  return cached(TEX, 'macro', () => {
    const N = res(512), out = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N, i = (y * N + x) * 4;
      out[i] = fbm(u, v, 3, 5, 41) * 255;
      out[i + 1] = fbm(u, v, 6, 4, 43) * 255;
      out[i + 2] = fbm(u, v, 4, 5, 47, 0.55) * 255;
      out[i + 3] = fbm(u, v, 12, 3, 53) * 255;
    }
    return dataTexture(THREE, out, N, N);
  });
}
const blankTex = (THREE, rgba = [0, 0, 0, 255]) => cached(TEX, 'blank' + rgba, () => dataTexture(THREE, new Uint8Array(rgba), 1, 1, { mips: false }));

// ---------------------------------------------------------------- roads (from scene.js road() groups)
/** roadsFromWorld(THREE, root) -> [{inv:Matrix4, outer, inner, divided, half}] — pavement description of every road group. */
export function roadsFromWorld(THREE, root) {
  const out = [];
  if (!root) return out;
  root.updateMatrixWorld?.(true);
  root.traverse((o) => {
    const u = o.userData || {};
    if (u.assetType !== 'road' || !u.edges) return;
    const inv = new THREE.Matrix4().copy(o.matrixWorld).invert();
    out.push({ inv: inv.elements.slice(), outer: u.edges.outer, inner: u.divided ? Math.max(0, u.edges.inner - 0.61) : 0, divided: !!u.divided, half: (u.dims?.length ?? 400) / 2 });
  });
  return out;
}
/** roadInfo(roads, x, z) -> {d: metres from the nearest pavement edge (<0 on pavement), median: bool} */
export function roadInfo(roads, x, z) {
  let best = 1e9, median = false;
  for (const r of roads || []) {
    const e = r.inv, lx = e[0] * x + e[8] * z + e[12], lz = e[2] * x + e[10] * z + e[14];
    const s = -lz, u = Math.abs(lx);
    let d, med = false;
    if (r.divided && u < r.inner) { d = r.inner - u; med = true; } else d = u - r.outer;
    const ex = Math.abs(s) - r.half;
    if (ex > 0) { d = Math.hypot(Math.max(d, 0), ex); med = false; }
    if (d < best) { best = d; median = med; }
  }
  return { d: best, median };
}
function findRoot(o) { let r = o; while (r.parent) r = r.parent; return r; }
function resolveRoads(THREE, roads, obj) {
  if (Array.isArray(roads)) return roads;
  if (roads === 'auto' && obj) return roadsFromWorld(THREE, findRoot(obj));
  return [];
}
// run fn(root) once, the first time obj is part of a scene graph and gets updateMatrixWorld()'d (renderers do this per frame)
function onFirstAttach(obj, fn) {
  const umw = obj.updateMatrixWorld.bind(obj); let done = false;
  obj.updateMatrixWorld = (force) => {
    umw(force);
    if (!done && obj.parent) { done = true; obj.updateMatrixWorld = umw; try { fn(findRoot(obj)); } catch (e) { obj.userData.error = String(e?.message || e); } }
  };
}
const pavedTest = (terrainHeight, roadHeight) => (x, z, th = terrainHeight(x, z)) => (roadHeight ? Math.abs(th - (roadHeight(x, z) - 0.02)) < 2e-4 : false);
function defaultTerrain(x, z) {   // gentle Florida undulation when no terrain model is given
  return (vnoise(x / 140 + 512, z / 140 + 512, 1 << 20, 7) - 0.5) * 0.6 + (vnoise(x / 40 + 99, z / 40 + 99, 1 << 20, 8) - 0.5) * 0.2;
}

// ---------------------------------------------------------------- aerial site (real photo -> forest mask + ground photo)
/** aerialSite(THREE, {url | image, boundsMeters, calibration, metersPerCell=1})
 *  Decodes a georeferenced aerial (e.g. cases/<id>/exhibits/aerial/aerial.jpg + bounds.json) and classifies tree canopy
 *  (dark + textured at 4 m scale) into a forest-density mask. Returns {ready: Promise<site>, texture, maskTexture,
 *  forestAt(x,z) 0..1, inside(x,z), toLocal, boundsMeters, calibration}. In Node, ready resolves with no mask. */
export function aerialSite(THREE, opts = {}) {
  const b = opts.boundsMeters, cal = { rotationDeg: 0, offsetX: 0, offsetZ: 0, ...(opts.calibration || {}) };
  if (!b) throw new Error('aerialSite: boundsMeters required');
  const c = Math.cos(cal.rotationDeg * DEG), s = Math.sin(cal.rotationDeg * DEG);
  const W = b.maxX - b.minX, D = b.maxZ - b.minZ, cell = opts.metersPerCell ?? 1;
  const site = {
    boundsMeters: b, calibration: cal, texture: null, maskTexture: null, mask: null, mw: 0, mh: 0, ok: false,
    // world -> image-local metres (inverse of world = rotY(rot) * local + offset)
    toLocal(x, z) { const qx = x - cal.offsetX, qz = z - cal.offsetZ; return [c * qx - s * qz, s * qx + c * qz]; },
    toWorld(lx, lz) { return [c * lx + s * lz + cal.offsetX, -s * lx + c * lz + cal.offsetZ]; },
    inside(x, z, margin = 0) { const [lx, lz] = site.toLocal(x, z); return lx > b.minX + margin && lx < b.maxX - margin && lz > b.minZ + margin && lz < b.maxZ - margin; },
    forestAt(x, z) {
      if (!site.mask) return 0;
      const [lx, lz] = site.toLocal(x, z);
      const fx = (lx - b.minX) / cell - 0.5, fz = (lz - b.minZ) / cell - 0.5;
      if (fx < 0 || fz < 0 || fx > site.mw - 1 || fz > site.mh - 1) return 0;
      const x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0, m = site.mask, w = site.mw;
      const x1 = Math.min(x0 + 1, site.mw - 1), z1 = Math.min(z0 + 1, site.mh - 1);
      return (m[z0 * w + x0] * (1 - tx) + m[z0 * w + x1] * tx) * (1 - tz) + (m[z1 * w + x0] * (1 - tx) + m[z1 * w + x1] * tx) * tz;
    },
    edgeAt(x, z) {               // 0 deep inside the forest / open ground, ~1 at the forest edge
      if (!site.blur) return 0;
      const [lx, lz] = site.toLocal(x, z);
      const ix = Math.round((lx - b.minX) / cell - 0.5), iz = Math.round((lz - b.minZ) / cell - 0.5);
      if (ix < 0 || iz < 0 || ix >= site.mw || iz >= site.mh) return 0;
      const v = site.blur[iz * site.mw + ix]; return 1 - Math.abs(v - 0.5) * 2;
    },
    uniforms() {
      return { rect: [b.minX, b.minZ, W, D], xf: [c, s, cal.offsetX, cal.offsetZ] };
    },
  };
  const classify = (img) => {
    const mw = Math.round(W / cell), mh = Math.round(D / cell);
    const cv = document.createElement('canvas'); cv.width = mw; cv.height = mh;
    const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, mw, mh);
    const px = g.getImageData(0, 0, mw, mh).data, n = mw * mh;
    const Lm = new Float32Array(n), L2 = new Float32Array(n);
    for (let i = 0; i < n; i++) { const l = (0.3 * px[i * 4] + 0.59 * px[i * 4 + 1] + 0.11 * px[i * 4 + 2]) / 255; Lm[i] = l; L2[i] = l * l; }
    const boxBlur = (src, r) => {          // separable box blur, edge clamped
      const tmp = new Float32Array(n), out = new Float32Array(n), k = 2 * r + 1;
      for (let y = 0; y < mh; y++) { let acc = 0; for (let x = -r - 1; x < r; x++) acc += src[y * mw + clamp(x, 0, mw - 1)];
        for (let x = 0; x < mw; x++) { acc += src[y * mw + Math.min(x + r, mw - 1)] - src[y * mw + clamp(x - r - 1, 0, mw - 1)]; tmp[y * mw + x] = acc / k; } }
      for (let x = 0; x < mw; x++) { let acc = 0; for (let y = -r - 1; y < r; y++) acc += tmp[clamp(y, 0, mh - 1) * mw + x];
        for (let y = 0; y < mh; y++) { acc += tmp[Math.min(y + r, mh - 1) * mw + x] - tmp[clamp(y - r - 1, 0, mh - 1) * mw + x]; out[y * mw + x] = acc / k; } }
      return out;
    };
    const r = Math.max(1, Math.round(4 / cell));
    const mL = boxBlur(Lm, r), mL2 = boxBlur(L2, r), f = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = Math.sqrt(Math.max(0, mL2[i] - mL[i] * mL[i]));
      f[i] = smooth(0.52, 0.40, mL[i]) * smooth(0.018, 0.04, v);     // canopy: dark AND textured; grass/sand/roofs/asphalt fail one
    }
    const mask = boxBlur(f, Math.max(1, Math.round(2 / cell)));
    site.mask = mask; site.mw = mw; site.mh = mh; site.blur = boxBlur(mask, Math.max(2, Math.round(8 / cell)));
    const bytes = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { bytes[i * 4] = clamp(mask[i], 0, 1) * 255; bytes[i * 4 + 3] = 255; }
    // flip rows so texture v = 1 at the image top (north), matching the photo texture (flipY)
    const flipped = new Uint8Array(n * 4);
    for (let y = 0; y < mh; y++) flipped.set(bytes.subarray(y * mw * 4, (y + 1) * mw * 4), (mh - 1 - y) * mw * 4);
    site.maskTexture = dataTexture(THREE, flipped, mw, mh, { repeat: false });
    site.ok = true;
  };
  site.ready = (async () => {
    if (!IS_BROWSER) return site;
    try {
      let img = opts.image || null;
      if (!img && opts.url) img = await new Promise((ok, no) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => ok(im); im.onerror = () => no(new Error('aerialSite: cannot load ' + opts.url)); im.src = opts.url; });
      if (!img) return site;
      const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true;
      t.minFilter = THREE.LinearMipmapLinearFilter; site.texture = t;
      classify(img);
    } catch (e) { site.error = String(e?.message || e); }
    for (const fn of site._listeners || []) try { fn(site); } catch {}
    return site;
  })();
  site.onReady = (fn) => { (site._listeners ||= []).push(fn); if (site.ok || site.error) fn(site); };
  return site;
}

// ---------------------------------------------------------------- ground
const GROUND_COLORS = {   // sRGB, end of the May dry season, north-central Florida
  green: [86, 102, 46], olive: [112, 112, 60], straw: [160, 146, 98], sand: [176, 164, 134], wet: [56, 76, 34],
  floor: [72, 58, 40], mowA: [92, 110, 50], mowB: [122, 124, 66],
};
const linCol = (THREE, c) => new THREE.Color().setRGB(srgbToLin(c[0] / 255), srgbToLin(c[1] / 255), srgbToLin(c[2] / 255), THREE.LinearSRGBColorSpace);

function groundMaterial(THREE, opts = {}) {
  const key = 'ground|' + (opts.key || '');
  return cached(MAT, key, () => {
    const mow = grassTile(THREE, 'mowed'), pas = grassTile(THREE, 'pasture'), macro = macroTexture(THREE);
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, name: 'landscape_ground' });
    const C = { ...GROUND_COLORS, ...(opts.colors || {}) };
    const U = {
      tMow: { value: mow.map }, tMowN: { value: mow.normalMap }, tPas: { value: pas.map }, tPasN: { value: pas.normalMap }, tMacro: { value: macro },
      tAerial: { value: blankTex(THREE, [128, 128, 128, 255]) }, tMask: { value: blankTex(THREE) },
      cMowMean: { value: new THREE.Vector3(...mow.mean) }, cPasMean: { value: new THREE.Vector3(...pas.mean) },
      mowWidth: { value: opts.mowWidth ?? 16 }, stripeW: { value: 2.3 }, aerialOn: { value: 0 }, maskOn: { value: 0 }, aerialMix: { value: opts.aerialMix ?? 0.85 },
      aerialRect: { value: new THREE.Vector4(0, 0, 1, 1) }, aerialXf: { value: new THREE.Vector4(1, 0, 0, 0) },
      detailNear: { value: 18 }, detailFar: { value: 160 },
    };
    for (const k of Object.keys(GROUND_COLORS)) U['c_' + k] = { value: linCol(THREE, C[k]) };
    m.userData.uniforms = U;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 land;\nvarying vec3 vLW;\nvarying vec4 vLand;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvLand = land;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vLW; varying vec4 vLand;
uniform sampler2D tMow, tMowN, tPas, tPasN, tMacro, tAerial, tMask;
uniform vec3 cMowMean, cPasMean;
uniform vec3 c_green, c_olive, c_straw, c_sand, c_wet, c_floor, c_mowA, c_mowB;
uniform float mowWidth, stripeW, aerialOn, maskOn, aerialMix, detailNear, detailFar;
uniform vec4 aerialRect, aerialXf;
vec2 lsRot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
vec2 lsAerialUV(vec2 p) { vec2 q = p - aerialXf.zw; vec2 l = vec2(aerialXf.x * q.x - aerialXf.y * q.y, aerialXf.y * q.x + aerialXf.x * q.y);
  vec2 uv = (l - aerialRect.xy) / aerialRect.zw; return vec2(uv.x, 1.0 - uv.y); }
float lsMow; float lsK; vec2 lsP;`)
        .replace('#include <map_fragment>', `
  lsP = vLW.xz;
  float lsDist = length(vLW - cameraPosition);
  vec4 M1 = texture2D(tMacro, lsP / 331.0);
  vec4 M2 = texture2D(tMacro, lsRot(lsP, 0.7) / 97.0 + 0.37);
  vec4 M3 = texture2D(tMacro, lsRot(lsP, 2.1) / 27.0 + 0.71);
  vec4 M4 = texture2D(tMacro, lsRot(lsP, 4.0) / 6.1 + 0.13);
  float dry = clamp(M1.r * 0.6 + M2.r * 0.35 + M3.r * 0.25 - 0.1, 0.0, 1.0);
  float bright = 0.80 + 0.22 * M2.g + 0.14 * M3.g + 0.10 * M4.g;
  // pasture / old field: green-olive-straw mosaic, darker tussocks, bare sand patches
  vec3 pas = mix(c_green, c_olive, smoothstep(0.30, 0.52, dry));
  pas = mix(pas, c_straw, smoothstep(0.52, 0.80, dry) * 0.85);
  pas *= 1.0 - 0.28 * smoothstep(0.55, 0.85, M4.a) * smoothstep(0.4, 0.7, M3.a);
  float sand = smoothstep(0.66, 0.76, M2.b * 0.6 + M3.b * 0.4 + (M4.b - 0.5) * 0.12);
  pas = mix(pas, c_sand * (0.92 + 0.16 * M4.g), sand * 0.9);
  // mowed right-of-way + median, ragged mow line, tractor stripes parallel to the road
  float dd = vLand.x + (M3.a - 0.5) * 3.0 + (M4.r - 0.5) * 1.2;
  lsMow = max(1.0 - smoothstep(mowWidth - 0.8, mowWidth + 0.8, dd), vLand.z);
  vec3 mw = mix(c_mowA, c_mowB, smoothstep(0.30, 0.80, M2.r * 0.6 + M3.r * 0.4));
  mw = mix(mw, c_straw, smoothstep(0.62, 0.85, M3.r * 0.5 + M4.r * 0.5) * 0.35);
  float st = sin(vLand.x / stripeW * 3.14159);
  mw *= 1.0 + 0.05 * sign(st) * smoothstep(0.0, 0.35, abs(st)) * (1.0 - vLand.z * 0.4);
  float fringe = (1.0 - smoothstep(0.15, 1.1, vLand.x + (M4.g - 0.5) * 0.6)) * (1.0 - vLand.w);
  mw = mix(mw, c_sand * 0.85, fringe * 0.75);
  vec3 col = mix(pas, mw, lsMow) * bright;
  col = mix(col, c_wet * (0.85 + 0.3 * M3.g), clamp(vLand.y, 0.0, 1.0) * 0.85);
  // forest floor (pine straw, leaf litter) under the canopy classified from the aerial photo
  vec2 auv = lsAerialUV(lsP);
  float inA = step(0.0, auv.x) * step(auv.x, 1.0) * step(0.0, auv.y) * step(auv.y, 1.0);
  float fm = maskOn * inA * texture2D(tMask, auv).r;
  col = mix(col, c_floor * (0.8 + 0.4 * M3.g), smoothstep(0.35, 0.8, fm) * 0.9 * (1.0 - lsMow));
  // detail: blade-scale texture at two scales, faded with distance (mips carry the mean further out)
  lsK = 1.0 - smoothstep(detailNear, detailFar, lsDist);
  vec3 dMow = mix(texture2D(tMow, lsP / 1.9).rgb, texture2D(tMow, lsRot(lsP, 1.3) / 0.83).rgb, 0.45) / cMowMean;
  vec3 dPas = mix(texture2D(tPas, lsP / 2.7).rgb, texture2D(tPas, lsRot(lsP, 2.4) / 1.13).rgb, 0.4) / cPasMean;
  vec3 det = mix(dPas, dMow, lsMow);
  col *= mix(vec3(1.0), det, 0.25 + 0.75 * lsK);
  // real aerial photo, far from the road, for overhead views (fades in with camera height)
  float hCam = cameraPosition.y - vLW.y;
  float wA = aerialOn * inA * aerialMix * smoothstep(14.0, 90.0, hCam) * max(smoothstep(6.0, 30.0, vLand.x), fm) * (1.0 - vLand.w);
  col = mix(col, texture2D(tAerial, auv).rgb * 0.92, wA);
  diffuseColor.rgb *= col;`)
        .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness - 0.05 * lsMow - 0.2 * clamp(vLand.y, 0.0, 1.0);`)
        .replace('#include <normal_fragment_maps>', `{
  vec3 tnA = texture2D(tMowN, lsP / 1.9).xyz * 2.0 - 1.0;
  vec3 tnB = texture2D(tPasN, lsP / 2.7).xyz * 2.0 - 1.0;
  vec3 tn = normalize(mix(tnB, tnA, lsMow));
  tn.xy *= 0.9 * lsK;
  vec3 T = normalize((viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  vec3 B = normalize((viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
  T = normalize(T - normal * dot(normal, T)); B = normalize(B - normal * dot(normal, B) - T * dot(T, B));
  normal = normalize(T * tn.x + B * tn.y + normal * tn.z);
}`);
    };
    m.customProgramCacheKey = () => 'landscape_ground_v1';
    return m;
  });
}
function bindSite(THREE, material, site) {
  if (!site) return;
  site.onReady((s) => {
    const U = material.userData.uniforms, u = s.uniforms();
    U.aerialRect.value.set(...u.rect); U.aerialXf.value.set(...u.xf);
    if (s.texture) { U.tAerial.value = s.texture; U.aerialOn.value = 1; }
    if (s.maskTexture) { U.tMask.value = s.maskTexture; U.maskOn.value = 1; }
  });
}

/** pastureGround(THREE, {size=4000, center=[0,0], terrainHeight, roadHeight, roads:'auto'|array, site, fine, mowWidth=16,
 *   colors, aerialMix=0.85, id='ground'})
 *  Multi-resolution terrain mesh (1 m grid around the site, 5 m to 800 m, 40 m beyond) following terrainHeight(x,z)
 *  (scene.js terrainHeight: hill crest, ditches, median swale). Pavement areas (terrainHeight == roadHeight - 0.02) are
 *  sunk 5 cm under the road meshes. Shader: multi-scale procedural PBR grass (blade-detail albedo + normal maps, four
 *  macro-variation scales so nothing visibly tiles), mowed right-of-way with tractor stripes and a ragged mow line, sand
 *  patches, wet ditch/median-swale grass (from depth below the road profile), forest floor + real aerial photo when `site`
 *  (aerialSite) is given. userData: assetType 'groundPlane', refresh() re-reads roads/terrain. */
export function pastureGround(THREE, opts = {}) {
  const { size = 4000, center = [0, 0], id = 'ground', site = null } = opts;
  const terrainHeight = opts.terrainHeight || defaultTerrain, roadHeight = opts.roadHeight || null;
  const isPaved = pavedTest(terrainHeight, roadHeight);
  const fine = { x0: center[0] - 400, x1: center[0] + 400, z0: center[1] - 120, z1: center[1] + 80, step: 1, ...(opts.fine || {}) };
  const midHalf = opts.midHalf ?? 800, midStep = opts.midStep ?? 5, outStep = opts.outerStep ?? 40;
  const snap = (v, s) => Math.round(v / s) * s;
  fine.x0 = snap(fine.x0, midStep); fine.x1 = snap(fine.x1, midStep); fine.z0 = snap(fine.z0, midStep); fine.z1 = snap(fine.z1, midStep);
  const mid = { x0: snap(center[0] - midHalf, outStep), x1: snap(center[0] + midHalf, outStep), z0: snap(center[1] - midHalf, outStep), z1: snap(center[1] + midHalf, outStep), step: midStep };
  const half = size / 2;
  const out = { x0: snap(center[0] - half, outStep), x1: snap(center[0] + half, outStep), z0: snap(center[1] - half, outStep), z1: snap(center[1] + half, outStep), step: outStep };
  const material = groundMaterial(THREE, opts);
  bindSite(THREE, material, site);
  const g = new THREE.Group(); g.name = id;
  const meshes = [];
  const build = (R, hole, name) => {
    const nx = Math.round((R.x1 - R.x0) / R.step), nz = Math.round((R.z1 - R.z0) / R.step);
    const pos = new Float32Array((nx + 1) * (nz + 1) * 3), land = new Float32Array((nx + 1) * (nz + 1) * 4), idx = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const k = j * (nx + 1) + i; pos[k * 3] = R.x0 + i * R.step; pos[k * 3 + 2] = R.z0 + j * R.step; }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      if (hole) { const cx = R.x0 + (i + 0.5) * R.step, cz = R.z0 + (j + 0.5) * R.step; if (cx > hole.x0 + R.step && cx < hole.x1 - R.step && cz > hole.z0 + R.step && cz < hole.z1 - R.step) continue; }
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
    geo.setAttribute('land', new THREE.BufferAttribute(land, 4));
    geo.setIndex(idx.length > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    const mesh = new THREE.Mesh(geo, material); mesh.name = id + '_' + name; mesh.receiveShadow = true;
    mesh.userData.hole = hole; mesh.userData.ring = R;
    meshes.push(mesh); g.add(mesh);
  };
  build(fine, null, 'fine'); build(mid, fine, 'mid'); build(out, mid, 'outer');
  let roads = Array.isArray(opts.roads) ? opts.roads : [];
  const shape = () => {
    for (const mesh of meshes) {
      const p = mesh.geometry.getAttribute('position'), L = mesh.geometry.getAttribute('land'), hole = mesh.userData.hole;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        const th = terrainHeight(x, z), paved = isPaved(x, z, th);
        let y = paved ? th - 0.05 : th;
        if (hole && x > hole.x0 && x < hole.x1 && z > hole.z0 && z < hole.z1) y -= 0.6;   // hidden under the finer ring
        p.setY(i, y);
        const ri = roads.length ? roadInfo(roads, x, z) : { d: 999, median: false };
        let wet = 0;
        if (roadHeight && ri.d < 30 && !paved) wet = smooth(0.32, 0.58, roadHeight(x, z) - th);
        L.setXYZW(i, clamp(ri.d, -1, 500), wet, ri.median ? 1 : 0, paved ? 1 : 0);
      }
      p.needsUpdate = true; L.needsUpdate = true;
      mesh.geometry.computeVertexNormals(); mesh.geometry.computeBoundingSphere(); mesh.geometry.computeBoundingBox();
    }
  };
  shape();
  const refresh = (root) => { roads = resolveRoads(THREE, opts.roads ?? 'auto', root ? root : g); shape(); };
  if (!Array.isArray(opts.roads) && opts.roads !== false) onFirstAttach(g, () => refresh());
  g.userData = { assetType: 'groundPlane', dims: { length: size, width: size, height: 0 }, kind: 'pasture', landscape: true, refresh, material };
  return g;
}

// ---------------------------------------------------------------- roadside grass clumps (instanced, near cameras only)
function clumpGeometry(THREE, blades = 6, seed = 3) {
  const R = rng(seed), pos = [], nrm = [], col = [], idx = [];
  for (let b = 0; b < blades; b++) {
    const a = R() * Math.PI * 2, r = R() * 0.35, ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    const face = R() * Math.PI, lean = 0.15 + R() * 0.45, ld = R() * Math.PI * 2, h = 0.6 + R() * 0.4, w = 0.03 + R() * 0.015;
    const fx = Math.cos(face), fz = Math.sin(face), lx = Math.cos(ld) * lean, lz = Math.sin(ld) * lean;
    const base = pos.length / 3;
    const tone = 0.8 + R() * 0.4;
    for (const [t, ww] of [[0, w], [0.55, w * 0.7], [1, 0]]) {
      const bend = t * t;
      const cx = ox + lx * bend * h, cy = t * h * (1 - 0.25 * lean * t), cz = oz + lz * bend * h;
      for (const side of ww > 0 ? [-1, 1] : [0]) {
        pos.push(cx + fx * ww * side * 0.5, cy, cz + fz * ww * side * 0.5);
        nrm.push(-fz * 0.35, 0.94, fx * 0.35);
        const k = (0.45 + 0.75 * t) * tone; col.push(k, k, k);
      }
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
function seedHeadGeometry(THREE) {   // bahia grass stalk with its V of two racemes (the May roadside signature)
  const pos = [], nrm = [], col = [], idx = [];
  const quad = (x0, y0, z0, x1, y1, z1, w, c0, c1) => {
    const b = pos.length / 3;
    pos.push(x0 - w, y0, z0, x0 + w, y0, z0, x1 - w * 0.6, y1, z1, x1 + w * 0.6, y1, z1);
    for (let i = 0; i < 4; i++) nrm.push(0, 1, 0);
    col.push(c0, c0, c0, c0, c0, c0, c1, c1, c1, c1, c1, c1);
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  };
  quad(0, 0, 0, 0.02, 0.86, 0.01, 0.006, 0.55, 0.9);
  quad(0.02, 0.86, 0.01, -0.06, 1.0, 0.0, 0.009, 0.75, 0.6);
  quad(0.02, 0.86, 0.01, 0.1, 0.99, 0.02, 0.009, 0.75, 0.6);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
/** grassBlades(THREE, {focus:[[x,z],...], radius=45, density=14 (clumps/m² at the focus), area, terrainHeight, roadHeight,
 *   roads:'auto'|array, mowWidth=16, maxCount=45000, seed})
 *  Instanced grass clumps + bahia seed heads on the mowed shoulders / median (and taller tufts beyond the mow line),
 *  only within `radius` of the camera points; density falls off with distance (LOD-friendly; regenerate with
 *  userData.setFocus(points)). area(x,z) -> 0..1 optionally overrides where grass grows. Never on pavement. */
export function grassBlades(THREE, opts = {}) {
  const g = new THREE.Group(); g.name = opts.id || 'grass_blades';
  const terrainHeight = opts.terrainHeight || defaultTerrain, isPaved = pavedTest(terrainHeight, opts.roadHeight || null);
  const maxCount = opts.maxCount ?? 45000, radius = opts.radius ?? 45, density = opts.density ?? 14, mowW = opts.mowWidth ?? 16;
  const clumpMat = cached(MAT, 'grassClump', () => new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8, metalness: 0, name: 'grass_clump' }));
  const clumps = new THREE.InstancedMesh(clumpGeometry(THREE), clumpMat, maxCount);
  const heads = new THREE.InstancedMesh(seedHeadGeometry(THREE), clumpMat, Math.ceil(maxCount * 0.08));
  for (const m of [clumps, heads]) { m.receiveShadow = true; m.castShadow = false; m.count = 0; m.frustumCulled = false; m.raycast = () => {}; g.add(m); }
  clumps.name = 'grass_clumps'; heads.name = 'grass_seedheads';
  let roads = Array.isArray(opts.roads) ? opts.roads : [];
  const o = new THREE.Object3D(), c = new THREE.Color();
  const generate = (focus) => {
    const R = rng(opts.seed ?? 77);
    let n = 0, nh = 0;
    const cell = 1 / Math.sqrt(density);
    const pts = (focus || []).map((f) => (Array.isArray(f) ? f : [f.x, f.z]));
    const seen = new Set();
    for (const [fx, fz] of pts) {
      const steps = Math.ceil(radius / cell);
      for (let j = -steps; j <= steps && n < maxCount; j++) for (let i = -steps; i <= steps && n < maxCount; i++) {
        const gx = Math.round(fx / cell) + i, gz = Math.round(fz / cell) + j, key = gx * 73856093 ^ gz * 19349663;
        if (seen.has(key)) continue; seen.add(key);
        const x = (gx + hash2(gx, gz, 1)) * cell, z = (gz + hash2(gx, gz, 2)) * cell;
        let dmin = Infinity; for (const [px, pz] of pts) dmin = Math.min(dmin, Math.hypot(x - px, z - pz));
        if (dmin > radius) continue;
        const keep = Math.pow(1 - dmin / radius, 1.6) * 0.92 + 0.08 * (dmin < radius * 0.3 ? 1 : 0);
        if (hash2(gx, gz, 3) > keep) continue;
        let w = 1, ri = null;
        if (opts.area) w = opts.area(x, z);
        else if (roads.length) { ri = roadInfo(roads, x, z); w = ri.d < 0.25 ? 0 : 1; }
        if (w <= 0 || hash2(gx, gz, 4) > w) continue;
        const th = terrainHeight(x, z);
        if (isPaved(x, z, th)) continue;
        const mowed = ri ? (ri.median || ri.d < mowW + (hash2(gx, gz, 5) - 0.5) * 3) : true;
        const hgt = mowed ? 0.07 + R() * 0.09 : 0.18 + R() * 0.32;
        const wid = (mowed ? 0.08 : 0.12) + R() * 0.08;
        o.position.set(x, th - 0.005, z); o.rotation.set(0, R() * Math.PI * 2, 0); o.scale.set(wid / 0.35, hgt, wid / 0.35); o.updateMatrix();
        clumps.setMatrixAt(n, o.matrix);
        const dry = hash2(gx >> 3, gz >> 3, 6) * 0.5 + R() * 0.5;
        if (mowed) c.setRGB(0.20 + dry * 0.12, 0.25 + dry * 0.06, 0.09 + dry * 0.04, THREE.SRGBColorSpace);
        else c.setRGB(0.26 + dry * 0.22, 0.28 + dry * 0.14, 0.12 + dry * 0.08, THREE.SRGBColorSpace);
        clumps.setColorAt(n, c); n++;
        if (nh < heads.instanceMatrix.count && R() < (mowed ? 0.05 : 0.09)) {
          const hh = mowed ? 0.28 + R() * 0.22 : 0.45 + R() * 0.3;
          o.position.set(x + (R() - 0.5) * 0.1, th, z + (R() - 0.5) * 0.1); o.rotation.set((R() - 0.5) * 0.3, R() * Math.PI * 2, (R() - 0.5) * 0.3); o.scale.set(1, hh, 1); o.updateMatrix();
          heads.setMatrixAt(nh, o.matrix); c.setRGB(0.42 + R() * 0.15, 0.38 + R() * 0.1, 0.24, THREE.SRGBColorSpace); heads.setColorAt(nh, c); nh++;
        }
      }
    }
    clumps.count = n; heads.count = nh;
    clumps.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
    if (clumps.instanceColor) clumps.instanceColor.needsUpdate = true;
    if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
    g.userData.count = n + nh;
  };
  const setFocus = (pts) => { g.userData.focus = pts; generate(pts); };
  g.userData = { assetType: 'grassBlades', scenery: true, dims: { length: 2 * radius, width: 2 * radius, height: 0.5 }, setFocus };
  g.userData.focus = opts.focus || [[0, 0]];
  if (Array.isArray(opts.roads) || opts.area || opts.roads === false) generate(g.userData.focus);
  else onFirstAttach(g, () => { roads = resolveRoads(THREE, 'auto', g); generate(g.userData.focus); });
  return g;
}

// ---------------------------------------------------------------- tree impostor atlas (pixel-painted, baked normals)
// Each cell is painted as overlapping noisy spheres (crown clumps) + cylinders (trunks) with a z-buffer, writing
// albedo + ambient occlusion and a tangent-space normal, so camera-facing cards shade with the real sun direction.
const ATLAS_W = 2048, ATLAS_H = 1024;
const CELLS = {   // px rect in the atlas (y from the top) + world height of the full cell (m)
  pineA: { x: 0, y: 0, w: 256, h: 768, H: 24 }, pineB: { x: 256, y: 0, w: 256, h: 768, H: 22 }, pineC: { x: 512, y: 0, w: 256, h: 768, H: 26 },
  youngPine: { x: 768, y: 0, w: 256, h: 768, H: 13 }, palm: { x: 1024, y: 0, w: 256, h: 768, H: 13 }, laurel: { x: 1280, y: 0, w: 256, h: 768, H: 17 },
  oak: { x: 1536, y: 0, w: 512, h: 768, H: 17 },
  palmetto: { x: 0, y: 768, w: 512, h: 256, H: 2.4 }, shrub: { x: 512, y: 768, w: 512, h: 256, H: 4.5 }, mass: { x: 1024, y: 768, w: 1024, h: 256, H: 24 },
};
function treeAtlas(THREE) {
  return cached(TEX, 'treeAtlas', () => {
    const S = IS_BROWSER ? 1 : 1 / NODE_SCALE, W = Math.round(ATLAS_W * S), H = Math.round(ATLAS_H * S);
    const col = new Uint8Array(W * H * 4), nrm = new Uint8Array(W * H * 4), zb = new Float32Array(W * H).fill(-1e9);
    for (let i = 0; i < W * H; i++) { nrm[i * 4 + 2] = 255; nrm[i * 4] = nrm[i * 4 + 1] = 128; }
    for (const [name, C] of Object.entries(CELLS)) {
      const cx0 = Math.round(C.x * S), cy0 = Math.round(C.y * S), cw = Math.round(C.w * S), ch = Math.round(C.h * S), ppm = ch / C.H;
      // painter in cell coords: X metres from the cell centre, Y metres up from the bottom
      const put = (px, py, depth, r, g, b, nx, ny, nz) => {
        if (px < 0 || py < 0 || px >= cw || py >= ch) return;
        const ax = cx0 + px, ay = cy0 + (ch - 1 - py), i = ay * W + ax;
        if (depth <= zb[i]) return; zb[i] = depth;
        col[i * 4] = clamp(r, 0, 255); col[i * 4 + 1] = clamp(g, 0, 255); col[i * 4 + 2] = clamp(b, 0, 255); col[i * 4 + 3] = 255;
        nrm[i * 4] = (nx * 0.5 + 0.5) * 255; nrm[i * 4 + 1] = (ny * 0.5 + 0.5) * 255; nrm[i * 4 + 2] = (nz * 0.5 + 0.5) * 255; nrm[i * 4 + 3] = 255;
      };
      const R = rng(name.length * 977 + name.charCodeAt(0));
      const seedN = name.length * 13;
      // crown clump: noisy sphere; leaf = edge raggedness; ao = how deep inside the crown (0 dark .. 1 outer)
      const blob = (X, Y, rad, Z, base, { leaf = 1, ao = 1, holes = 0.25, stretch = 1 } = {}) => {
        const cxp = cw / 2 + X * ppm, cyp = Y * ppm, rp = rad * ppm, rpy = rp * stretch;
        const x0 = Math.floor(cxp - rp - 2), x1 = Math.ceil(cxp + rp + 2), y0 = Math.floor(cyp - rpy - 2), y1 = Math.ceil(cyp + rpy + 2);
        const fs = Math.max(0.5, ppm * 0.18);  // leaf-cluster scale (~18 cm)
        for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
          const dx = (px - cxp) / rp, dy = (py - cyp) / rpy, d2 = dx * dx + dy * dy;
          if (d2 > 1.25) continue;
          const n1 = vnoise((px + cx0) / fs, (py + cy0) / fs, 1 << 16, seedN), n2 = vnoise((px + cx0) / (fs * 0.45), (py + cy0) / (fs * 0.45), 1 << 16, seedN + 7);
          const edge = 1 - leaf * (0.55 * n1 + 0.25 * n2);
          if (d2 > edge * edge) continue;
          if (holes > 0 && n2 > 1 - holes * 0.5 && n1 > 0.55 && d2 > 0.2) continue;
          const nz = Math.sqrt(Math.max(0.05, 1 - Math.min(d2, 1)));
          let nx = dx + (n1 - 0.5) * 0.9, ny = dy + (n2 - 0.5) * 0.9, nzz = nz; const l = Math.hypot(nx, ny, nzz); nx /= l; ny /= l; nzz /= l;
          const occ = (0.55 + 0.45 * nz) * ao * (0.8 + 0.4 * n1);
          put(px, py, Z + nz * rad, base[0] * occ, base[1] * occ, base[2] * occ, nx, ny, nzz);
        }
      };
      const trunk = (X0, Y0, X1, Y1, w0, w1, Z, base) => {
        const len = Math.hypot(X1 - X0, Y1 - Y0) * ppm, steps = Math.max(2, Math.ceil(len));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps, X = X0 + (X1 - X0) * t, Y = Y0 + (Y1 - Y0) * t, w = (w0 + (w1 - w0) * t) * ppm, hw = Math.max(0.6, w / 2);
          const cxp = cw / 2 + X * ppm, cyp = Y * ppm;
          for (let q = -Math.ceil(hw); q <= Math.ceil(hw); q++) {
            const u = clamp(q / hw, -1, 1), nz = Math.sqrt(1 - u * u);
            const bark = 0.75 + 0.5 * vnoise((cx0 + cxp + q) * 0.8, (cy0 + cyp) * 0.12, 1 << 16, 3);
            put(Math.round(cxp + q), Math.round(cyp), Z + nz * w / ppm * 0.5, base[0] * bark * (0.6 + 0.4 * nz), base[1] * bark * (0.6 + 0.4 * nz), base[2] * bark * (0.6 + 0.4 * nz), u, 0, nz);
          }
        }
      };
      const half = C.w / C.h * C.H / 2;   // half width of the cell in metres
      const jit = (c, k = 14) => [c[0] + (R() - 0.5) * k, c[1] + (R() - 0.5) * k, c[2] + (R() - 0.5) * k * 0.6];
      if (name.startsWith('pine')) {         // slash / loblolly pine: tall clear bole, flat-topped clumpy crown in the top third
        const top = C.H * (0.93 + R() * 0.05), crownBase = C.H * (0.55 + R() * 0.12), lean = (R() - 0.5) * 0.8;
        trunk(0, 0, lean, top - 0.5, 0.48, 0.16, 0, [92, 72, 58]);
        const nBr = 7 + Math.floor(R() * 5);
        for (let k = 0; k < nBr; k++) {
          const t = k / (nBr - 1), y = crownBase + (top - crownBase) * (0.15 + 0.85 * t), side = R() < 0.5 ? -1 : 1;
          const reach = (1.0 + R() * 2.4) * (1 - 0.45 * t), ex = lean * (y / top) + side * reach, ey = y + R() * 1.0;
          trunk(lean * (y / top), y - 0.4, ex, ey, 0.12, 0.05, -1, [70, 56, 44]);
          const nc = 3 + Math.floor(R() * 4);
          for (let q = 0; q < nc; q++) blob(ex + (R() - 0.5) * 1.6, ey + (R() - 0.3) * 1.0, 0.55 + R() * 0.65, (R() - 0.5) * 2, jit([62, 80, 40], 16), { leaf: 1.1, holes: 0.35, stretch: 0.75 });
        }
        for (let q = 0; q < 5; q++) blob(lean + (R() - 0.5) * 1.5, top - R() * 1.6, 0.7 + R() * 0.6, 0.5, jit([66, 84, 42], 12), { leaf: 1.1, holes: 0.3, stretch: 0.75 });
      } else if (name === 'youngPine') {
        trunk(0, 0, 0, C.H * 0.9, 0.3, 0.08, 0, [88, 70, 56]);
        for (let k = 0; k < 40; k++) { const t = R(), y = 2 + t * (C.H * 0.92 - 2), wmax = (1 - t) * 2.6 + 0.4; blob((R() - 0.5) * 2 * wmax, y, 0.5 + R() * 0.6, (R() - 0.5) * 2, jit([60, 82, 40], 16), { leaf: 1.1, holes: 0.2, stretch: 0.8 }); }
      } else if (name === 'palm') {          // cabbage palm (Sabal palmetto): straight boot-textured trunk, round head of fans
        const top = C.H * 0.82;
        trunk(0, 0, 0.15, top, 0.38, 0.32, 0, [110, 98, 80]);
        for (let k = 0; k < 9; k++) blob((R() - 0.5) * 1.0, top - 0.6 - R() * 1.6, 0.35 + R() * 0.3, -0.3, [120, 96, 62], { leaf: 0.8, holes: 0.2, stretch: 1.6 });  // dead frond skirt
        for (let f = 0; f < 22; f++) {
          const a = R() * Math.PI * 2, L = 2.0 + R() * 0.9, droop = 0.25 + R() * 0.5;
          for (let s = 0; s <= 9; s++) { const t = s / 9, X = 0.15 + Math.cos(a) * L * t, Y = top + 0.6 + Math.sin(a) * L * t * 0.75 - droop * t * t * L; blob(X, Y, 0.18 + 0.4 * Math.sin(t * Math.PI) , Math.sin(a * 3) * 0.5, jit([84, 98, 50], 12), { leaf: 1.2, holes: 0.1, stretch: 0.7 }); }
        }
      } else if (name === 'laurel' || name === 'oak') {   // laurel / live / water oak: short trunk, broad billowing crown
        const wide = name === 'oak' ? 1 : 0.62, top = C.H * 0.95;
        trunk(0, 0, (R() - 0.5) * 0.6, C.H * 0.45, 0.6, 0.35, 0, [78, 68, 56]);
        trunk(0, C.H * 0.3, -half * 0.45 * wide, C.H * 0.55, 0.3, 0.12, -1, [70, 60, 50]);
        trunk(0, C.H * 0.33, half * 0.5 * wide, C.H * 0.6, 0.3, 0.12, -1, [70, 60, 50]);
        const n = name === 'oak' ? 70 : 46;
        for (let k = 0; k < n; k++) {
          const a = R() * Math.PI, rr = Math.sqrt(R());
          const X = Math.cos(a) * rr * half * 0.85 * (k % 3 ? 1 : 0.6), Y = C.H * 0.42 + Math.sin(a) * rr * (top - C.H * 0.42) * 0.95;
          blob(X, Y, (1.1 + R() * 1.3) * (name === 'oak' ? 1.05 : 0.9), (R() - 0.5) * 3, jit(name === 'oak' ? [64, 80, 42] : [72, 92, 46], 18), { leaf: 0.9, holes: 0.15, stretch: 0.85 });
        }
      } else if (name === 'palmetto') {      // saw palmetto understory: low mounds of stiff fans, bluish-olive
        for (let k = 0; k < 90; k++) { const X = (R() - 0.5) * 2 * half * 0.9, Y = 0.15 + R() * (C.H * 0.6) * (1 - Math.abs(X) / half * 0.6); blob(X, Y, 0.25 + R() * 0.35, (R() - 0.5) * 2, jit([92, 104, 62], 18), { leaf: 1.3, holes: 0.2, stretch: 0.6 }); }
      } else if (name === 'shrub') {         // wax myrtle / young oak / gallberry thicket at the forest edge
        for (let k = 0; k < 110; k++) { const X = (R() - 0.5) * 2 * half * 0.92, Y = 0.2 + R() * C.H * 0.85 * (1 - Math.pow(Math.abs(X) / half, 2) * 0.7); blob(X, Y, 0.35 + R() * 0.55, (R() - 0.5) * 3, jit([70, 86, 44], 20), { leaf: 1, holes: 0.12, stretch: 0.85 }); }
      } else if (name === 'mass') {          // distant forest wall: dense dark body, ragged pine / hardwood skyline
        for (let k = 0; k < 220; k++) { const X = (R() - 0.5) * 2 * half * 0.98, Y = R() * C.H * 0.55; blob(X, Y, 1.5 + R() * 2.2, -2 + R() * 2, jit([44, 56, 32], 10), { leaf: 0.6, ao: 0.75, holes: 0, stretch: 1 }); }
        for (let k = 0; k < 160; k++) { const X = (R() - 0.5) * 2 * half * 0.98, top = C.H * (0.55 + 0.4 * vnoise(X / 9 + 50, 3, 1 << 16, 9) + R() * 0.1); blob(X, top - R() * 3, 1.0 + R() * 1.6, R() * 2, jit([58, 74, 40], 16), { leaf: 1.0, holes: 0.12, stretch: 0.8 }); }
      }
    }
    // bleed colour into transparent texels (keeps mip edges from going black)
    for (let pass = 0; pass < 3; pass++) for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x; if (col[i * 4 + 3]) continue;
      for (const j of [i - 1, i + 1, i - W, i + W]) if (col[j * 4 + 3] || col[j * 4] || col[j * 4 + 1]) { col[i * 4] = col[j * 4]; col[i * 4 + 1] = col[j * 4 + 1]; col[i * 4 + 2] = col[j * 4 + 2]; break; }
    }
    const map = dataTexture(THREE, col, W, H, { srgb: true, repeat: false });
    map.flipY = false; // rows already top-down
    const normalMap = dataTexture(THREE, nrm, W, H, { repeat: false }); normalMap.flipY = false;
    return { map, normalMap, W, H };
  });
}
const cellRect = (name) => { const C = CELLS[name]; return [C.x / ATLAS_W, C.y / ATLAS_H, (C.x + C.w) / ATLAS_W, (C.y + C.h) / ATLAS_H]; };
const cellAspect = (name) => CELLS[name].w / CELLS[name].h;

const BILLBOARD_VERT = `
  vec3 lsBase = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  float lsW = aSize.x, lsH = aSize.y;
  vec3 lsTo = cameraPosition - lsBase; float lsDist = length(lsTo); lsTo /= max(lsDist, 1e-4);
  vec3 lsUpW = vec3(0.0, 1.0, 0.0);
  vec3 lsR = cross(lsUpW, lsTo); float lsRl = length(lsR); lsR = lsRl > 1e-4 ? lsR / lsRl : vec3(1.0, 0.0, 0.0);
  float lsTilt = TILT * smoothstep(0.35, 0.95, lsTo.y);
  vec3 lsU = normalize(mix(lsUpW, cross(lsTo, lsR), lsTilt));
  float lsPiv = 0.55 * lsH;
  vec3 lsWP = lsBase + lsUpW * lsPiv + lsR * position.x * lsW + lsU * (position.y * lsH - lsPiv);
  vAUv = vec2(mix(aRect.x, aRect.z, position.x + 0.5), mix(aRect.w, aRect.y, position.y));
`;
function billboardMaterial(THREE) {
  return cached(MAT, 'billboard', () => {
    const atlas = treeAtlas(THREE);
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, name: 'landscape_tree_impostor' });
    const U = { tAtlas: { value: atlas.map }, tAtlasN: { value: atlas.normalMap }, hazeColor: { value: new THREE.Color(0.78, 0.84, 0.9) }, hazeDist: { value: 7000 } };
    m.userData.uniforms = U;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n#define TILT 1.0\nattribute vec4 aRect;\nattribute vec2 aSize;\nvarying vec2 vAUv;\nvarying float vFlip;\nvarying vec3 vBR;\nvarying vec3 vBU;\nvarying float vBDist;')
        .replace('#include <beginnormal_vertex>', `vec3 objectNormal = vec3(0.0, 0.0, 1.0);\n${BILLBOARD_VERT}\n vFlip = aRect.x > aRect.z ? -1.0 : 1.0; vBR = normalize((viewMatrix * vec4(lsR, 0.0)).xyz); vBU = normalize((viewMatrix * vec4(lsU, 0.0)).xyz); vBDist = lsDist;`)
        .replace('#include <defaultnormal_vertex>', 'vec3 transformedNormal = normalize((viewMatrix * vec4(lsTo, 0.0)).xyz);')
        .replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4(lsWP, 1.0);\ngl_Position = projectionMatrix * mvPosition;')
        .replace('#include <worldpos_vertex>', 'vec4 worldPosition = vec4(lsWP, 1.0);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tAtlas, tAtlasN;\nuniform vec3 hazeColor;\nuniform float hazeDist;\nvarying vec2 vAUv;\nvarying float vFlip;\nvarying vec3 vBR;\nvarying vec3 vBU;\nvarying float vBDist;')
        .replace('#include <map_fragment>', `
  vec4 lsTex = texture2D(tAtlas, vAUv);
  float lsLod = log2(max(max(fwidth(vAUv.x) * ${ATLAS_W}.0, fwidth(vAUv.y) * ${ATLAS_H}.0), 1.0));
  if (lsTex.a * (1.0 + 0.35 * lsLod) < 0.5) discard;
  diffuseColor.rgb *= lsTex.rgb;`)
        .replace('#include <normal_fragment_maps>', `{
  vec3 tn = texture2D(tAtlasN, vAUv).xyz * 2.0 - 1.0; tn.x *= vFlip;
  vec3 F = normalize(cross(vBR, vBU));
  normal = normalize(vBR * tn.x + vBU * tn.y + F * tn.z);
}`)
        .replace('#include <fog_fragment>', `gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeColor, 1.0 - exp(-vBDist / hazeDist));\n#include <fog_fragment>`);
    };
    m.customProgramCacheKey = () => 'landscape_billboard_v1';
    return m;
  });
}
function billboardDepthMaterial(THREE) {
  return cached(MAT, 'billboardDepth', () => {
    const atlas = treeAtlas(THREE);
    const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.tAtlas = { value: atlas.map };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n#define TILT 0.0\nattribute vec4 aRect;\nattribute vec2 aSize;\nvarying vec2 vAUv;')
        .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);\n${BILLBOARD_VERT}`)
        .replace('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4(lsWP, 1.0);\ngl_Position = projectionMatrix * mvPosition;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tAtlas;\nvarying vec2 vAUv;')
        .replace('#include <map_fragment>', 'if (texture2D(tAtlas, vAUv).a < 0.5) discard;');
    };
    m.customProgramCacheKey = () => 'landscape_billboard_depth_v1';
    return m;
  });
}
/** impostors(THREE, list:[{x,y,z,cell,h,tint:[r,g,b]}], {castShadow}) -> InstancedMesh of camera-facing tree cards */
export function impostors(THREE, list, { castShadow = true, name = 'tree_impostors', raycast = false } = {}) {
  const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0, 0.5, 0);
  const n = Math.max(1, list.length);
  const rect = new Float32Array(n * 4), size = new Float32Array(n * 2);
  const mesh = new THREE.InstancedMesh(geo, billboardMaterial(THREE), n);
  const o = new THREE.Object3D(), c = new THREE.Color();
  list.forEach((t, i) => {
    const C = CELLS[t.cell], h = t.h ?? C.H, w = h * cellAspect(t.cell) * (t.flip ? -1 : 1);
    // zero-scale instance matrix: the card is built in the vertex shader from aSize, so override-material passes (GTAO
    // normals, picking) see degenerate triangles instead of unbillboarded quads
    o.position.set(t.x, t.y, t.z); o.rotation.set(0, 0, 0); o.scale.set(1e-6, 1e-6, 1e-6); o.updateMatrix();
    size[i * 2] = Math.abs(w); size[i * 2 + 1] = h;
    mesh.setMatrixAt(i, o.matrix);
    const r = cellRect(t.cell); if (t.flip) { rect.set([r[2], r[1], r[0], r[3]], i * 4); } else rect.set(r, i * 4);
    const tn = t.tint || [1, 1, 1]; mesh.setColorAt(i, c.setRGB(tn[0], tn[1], tn[2]));
  });
  geo.setAttribute('aRect', new THREE.InstancedBufferAttribute(rect, 4));
  geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 2));
  mesh.count = list.length;
  mesh.customDepthMaterial = billboardDepthMaterial(THREE);
  mesh.castShadow = castShadow; mesh.receiveShadow = false; mesh.name = name;
  if (!raycast) mesh.raycast = () => {};
  mesh.frustumCulled = false;
  return mesh;
}
const tintFor = (R, k = 0.16) => { const b = 1 - k / 2 + R() * k; return [b * (0.94 + R() * 0.12), b * (0.95 + R() * 0.1), b * (0.9 + R() * 0.12)]; };
function avoidFromWorld(root, pad = 4) {
  const boxes = [];
  if (!root) return boxes;
  root.traverse((o) => {
    const t = o.userData?.assetType;
    if (!['building', 'shelter', 'signal', 'streetlight'].includes(t) || o.visible === false) return;
    const d = o.userData.dims || {};
    o.updateWorldMatrix?.(true, false);
    const e = o.matrixWorld.elements, r = Math.hypot(d.length || 4, d.width || 4) / 2 + pad;
    boxes.push({ x: e[12], z: e[14], r });
  });
  return boxes;
}
const avoided = (boxes, x, z) => boxes.some((b) => (x - b.x) ** 2 + (z - b.z) ** 2 < b.r * b.r);

/** forest(THREE, {site, terrainHeight, roads:'auto', avoid:'auto'|[{x,z,r}], clearance=12, spacing=4.6, edgeShrubs=true, seed})
 *  Trees exactly where the aerial photo shows canopy (aerialSite mask): slash pine dominant, laurel/live oak, cabbage palm,
 *  young pine; saw palmetto + wax myrtle along every forest edge. Camera-facing impostors with baked normals (they light
 *  with the real sun and cast alpha-tested shadows). Populates when site.ready resolves (userData.ready). Scenery only:
 *  never raycast (not occluders in the checks). */
export function forest(THREE, opts = {}) {
  const g = new THREE.Group(); g.name = opts.id || 'forest';
  g.userData = { assetType: 'forest', scenery: true, dims: { length: 0, width: 0, height: 26 } };
  const site = opts.site;
  const terrainHeight = opts.terrainHeight || defaultTerrain;
  const spacing = opts.spacing ?? 4.6, clearance = opts.clearance ?? 12;
  let roads = Array.isArray(opts.roads) ? opts.roads : [], boxes = Array.isArray(opts.avoid) ? opts.avoid : [];
  let attached = false, siteReady = false, built = false, resolveReady;
  g.userData.ready = new Promise((r) => (resolveReady = r));
  const build = () => {
    if (built || !siteReady || !(attached || Array.isArray(opts.roads))) return;
    built = true;
    if (!site?.mask) { resolveReady(g); return; }
    const R = rng(opts.seed ?? 5), list = [], under = [];
    const b = site.boundsMeters;
    for (let lz = b.minZ; lz < b.maxZ; lz += spacing) for (let lx = b.minX; lx < b.maxX; lx += spacing) {
      const [x, z] = site.toWorld(lx + (R() - 0.5) * spacing * 0.9, lz + (R() - 0.5) * spacing * 0.9);
      const f = site.forestAt(x, z);
      if (f < 0.25 || R() > Math.pow(f, 1.4) * 0.92) continue;
      if (roads.length && roadInfo(roads, x, z).d < clearance) continue;
      if (avoided(boxes, x, z)) continue;
      const y = terrainHeight(x, z) - 0.25, p = R();
      const cell = p < 0.2 ? 'pineA' : p < 0.4 ? 'pineB' : p < 0.56 ? 'pineC' : p < 0.66 ? 'youngPine' : p < 0.71 ? 'palm' : p < 0.85 ? 'laurel' : 'oak';
      const h = CELLS[cell].H * (0.78 + R() * 0.36) * (0.85 + 0.25 * f);
      list.push({ x, y, z, cell, h, tint: tintFor(R), flip: R() < 0.5 });
      if (opts.edgeShrubs !== false && site.edgeAt(x, z) > 0.45 && R() < 0.85) {
        const k = R() < 0.55 ? 'palmetto' : 'shrub';
        under.push({ x: x + (R() - 0.5) * 3, y: y + 0.1, z: z + (R() - 0.5) * 3, cell: k, h: CELLS[k].H * (0.7 + R() * 0.6), tint: tintFor(R, 0.2), flip: R() < 0.5 });
      }
    }
    // understory inside the forest too (dark gaps between boles at eye level)
    for (let i = 0; i < list.length; i += 3) { const t = list[i]; under.push({ x: t.x + (R() - 0.5) * 4, y: t.y + 0.1, z: t.z + (R() - 0.5) * 4, cell: R() < 0.6 ? 'palmetto' : 'shrub', h: 2.5 + R() * 2, tint: tintFor(R, 0.25), flip: R() < 0.5 }); }
    g.add(impostors(THREE, list, { name: 'forest_trees' }), impostors(THREE, under, { name: 'forest_understory', castShadow: true }));
    g.userData.count = list.length + under.length;
    resolveReady(g);
  };
  if (site) site.ready.then(() => { siteReady = true; build(); }); else { siteReady = true; }
  onFirstAttach(g, (root) => {
    if (!Array.isArray(opts.roads)) roads = resolveRoads(THREE, 'auto', g);
    if (!Array.isArray(opts.avoid)) boxes = avoidFromWorld(root, opts.avoidPad ?? 5);
    attached = true; build();
  });
  if (!site) resolveReady(g);
  return g;
}

/** treeline(THREE, {distance:[300,800], length, center=[0,0], terrainHeight, roads:'auto', clearance=30, exclude: site |
 *   (x,z)=>bool, coverage=0.8, seed})
 *  Distant forest / hammock belt ringing the site so the horizon is never empty: individual pine/oak/palm impostors out
 *  to ~600 m, forest-mass cards beyond. `distance` = [inner, outer] radius (m); `length` stretches the ring along X (the
 *  road axis) into a stadium of that straight length. Gaps follow a low-frequency noise (open fields); the road corridor
 *  stays open, so the highway runs into the trees at the vanishing point. `exclude` skips the aerial-mapped area. */
export function treeline(THREE, opts = {}) {
  const g = new THREE.Group(); g.name = opts.id || 'treeline_ring';
  g.userData = { assetType: 'treeline', scenery: true, dims: { length: 0, width: 0, height: 24 } };
  const [d0, d1] = Array.isArray(opts.distance) ? opts.distance : [opts.distance ?? 300, (opts.distance ?? 300) + 500];
  const L = opts.length ?? 0, center = opts.center || [0, 0], cov = opts.coverage ?? 0.8, clearance = opts.clearance ?? 30;
  const terrainHeight = opts.terrainHeight || defaultTerrain;
  let roads = Array.isArray(opts.roads) ? opts.roads : [];
  const ex = opts.exclude;
  const excluded = typeof ex === 'function' ? ex : ex && ex.inside ? (x, z) => !!ex.mask && ex.inside(x, z, 20) : () => false;
  let resolveReady; g.userData.ready = new Promise((r) => (resolveReady = r));
  const build = () => {
    const R = rng(opts.seed ?? 9), list = [];
    const radial = (x, z) => { const dx = Math.max(0, Math.abs(x - center[0]) - L / 2), dz = z - center[1]; return Math.hypot(dx, dz); };
    const ext = d1 + L / 2;
    for (let pass = 0; pass < 2; pass++) {
      const step = pass === 0 ? 7 : 26;               // near pass: individual trees; far pass: forest-mass cards
      const rIn = pass === 0 ? d0 : Math.max(d0, Math.min(d1, 600)), rOut = pass === 0 ? Math.min(d1, 640) : d1;
      if (rOut <= rIn) continue;
      for (let z = center[1] - d1; z <= center[1] + d1; z += step) for (let x = center[0] - ext; x <= center[0] + ext; x += step) {
        const px = x + (R() - 0.5) * step, pz = z + (R() - 0.5) * step, r = radial(px, pz);
        if (r < rIn || r > rOut) continue;
        const n = vnoise(px / 160 + 31, pz / 160 + 17, 1 << 20, 4) * 0.65 + vnoise(px / 45, pz / 45, 1 << 20, 5) * 0.35;
        if (n < 1 - cov - 0.1 || (n < 1 - cov && R() > 0.3)) continue;
        if (excluded(px, pz)) continue;
        if (roads.length && roadInfo(roads, px, pz).d < clearance + (pass ? 25 : 0)) continue;
        const y = terrainHeight(px, pz) - 0.3;
        if (pass === 0) {
          const p = R(), cell = p < 0.5 ? (R() < 0.5 ? 'pineA' : 'pineC') : p < 0.62 ? 'pineB' : p < 0.7 ? 'palm' : p < 0.85 ? 'laurel' : 'oak';
          list.push({ x: px, y, z: pz, cell, h: CELLS[cell].H * (0.8 + R() * 0.35), tint: tintFor(R, 0.2), flip: R() < 0.5 });
          if (R() < 0.35) list.push({ x: px + (R() - 0.5) * 5, y, z: pz + (R() - 0.5) * 5, cell: 'shrub', h: 4 + R() * 3, tint: tintFor(R), flip: R() < 0.5 });
        } else list.push({ x: px, y, z: pz, cell: 'mass', h: 18 + R() * 9, tint: tintFor(R, 0.2), flip: R() < 0.5 });
      }
    }
    g.add(impostors(THREE, list, { name: 'treeline_ring_trees', castShadow: false }));
    g.userData.count = list.length;
    resolveReady(g);
  };
  const wait = ex && ex.ready ? ex.ready : Promise.resolve();
  let attached = Array.isArray(opts.roads);
  const go = () => wait.then(() => { if (!g.userData.built) { g.userData.built = true; build(); } });
  if (attached) go();
  else onFirstAttach(g, () => { roads = resolveRoads(THREE, 'auto', g); go(); });
  return g;
}

// ---------------------------------------------------------------- fair-weather cumulus
function cloudTexture(THREE) {
  return cached(TEX, 'clouds', () => {
    const N = res(512), out = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N, i = (y * N + x) * 4;
      const big = fbm(u, v, 5, 3, 61), puff = fbm(u, v, 20, 4, 67, 0.55);
      out[i] = clamp((big * 0.72 + puff * 0.38) * 255, 0, 255);
      out[i + 1] = fbm(u, v, 48, 3, 71) * 255; out[i + 2] = big * 255; out[i + 3] = 255;
    }
    return dataTexture(THREE, out, N, N);
  });
}
/** skyClouds(THREE, {coverage=0.12, altitude=1500, tile=7000, sunAzimuth=265, sunElevation=45, brightness=1, horizonColor,
 *   wind:[x,z]}) -> Mesh: camera-following dome; each pixel ray-casts a flat cloud layer at `altitude` so perspective is right
 *  at any dome radius (inside camera.far). Sparse fair-weather cumulus ("clear" = coverage <= 0.15): white sunlit tops,
 *  flat grey bases, faded into the horizon haze. Works alongside three's Sky.js (renders after it, no depth write). */
export function skyClouds(THREE, opts = {}) {
  const az = (opts.sunAzimuth ?? 265) * DEG, el = (opts.sunElevation ?? 45) * DEG;
  const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tCloud: { value: cloudTexture(THREE) }, coverage: { value: opts.coverage ?? 0.12 }, altitude: { value: opts.altitude ?? 1500 },
      tile: { value: opts.tile ?? 7000 }, sunDir: { value: sunDir }, brightness: { value: opts.brightness ?? 1.0 },
      horizon: { value: opts.horizonColor ? new THREE.Color(opts.horizonColor) : new THREE.Color(0.62, 0.72, 0.85) },
      offset: { value: new THREE.Vector2(...(opts.offset || [0.13, 0.41])) },
    },
    vertexShader: `varying vec3 vDir; void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vDir = wp.xyz - cameraPosition; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `
      uniform sampler2D tCloud; uniform float coverage, altitude, tile, brightness; uniform vec3 sunDir, horizon; uniform vec2 offset;
      varying vec3 vDir;
      float dens(vec2 uv) { vec4 t = texture2D(tCloud, uv); float thr = 1.0 - coverage * 1.15 - 0.27; return smoothstep(thr, thr + 0.07, t.r * 0.9 + t.g * 0.1); }
      void main() {
        vec3 d = normalize(vDir);
        if (d.y < 0.005) discard;
        float t = (altitude - cameraPosition.y) / d.y;
        vec2 p = cameraPosition.xz + d.xz * t;
        vec2 uv = p / tile + offset;
        float c = dens(uv);
        if (c < 0.003) discard;
        vec2 sd = normalize(sunDir.xz + 1e-5) * 0.0045;
        float toward = dens(uv + sd), away = dens(uv - sd);
        float body = texture2D(tCloud, uv).b;
        // seen from below: flat grey bases, bright rims on the sun side and on thin edges
        float rim = clamp((1.0 - c) * 1.6 + (away - toward) * 1.2, 0.0, 1.0);
        float thick = smoothstep(0.55, 0.85, body);
        vec3 base = vec3(0.70, 0.73, 0.79) * (1.0 - 0.18 * thick);
        vec3 lit = vec3(1.0, 0.985, 0.955);
        vec3 col = mix(base, lit, clamp(rim * 0.85 + 0.15 + sunDir.y * 0.15, 0.0, 1.0)) * brightness;
        float fade = smoothstep(0.02, 0.22, d.y);
        col = mix(horizon, col, smoothstep(0.0, 0.35, d.y) * 0.6 + 0.4);
        gl_FragColor = vec4(col, c * fade * 0.96);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, depthTest: true, fog: false, side: THREE.BackSide, toneMapped: true,
  });
  mat.name = 'sky_clouds';
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  mesh.name = opts.id || 'sky_clouds'; mesh.frustumCulled = false; mesh.renderOrder = -900; mesh.raycast = () => {};
  mesh.onBeforeRender = (renderer, scene, camera) => {
    mesh.position.copy(camera.position); mesh.scale.setScalar(Math.min((camera.far || 2000) * 0.9, 5000)); mesh.updateMatrixWorld();
  };
  mesh.userData = { assetType: 'skyClouds', scenery: true, uniforms: mat.uniforms, dims: { length: 0, width: 0, height: 0 } };
  return mesh;
}

// ---------------------------------------------------------------- fence and ditch helpers
/** fenceLine(THREE, {points:[[x,z],...], terrainHeight, spacing=3.05, height=1.3, strands=4, style:'barbed'|'board'})
 *  Florida ranch fence: treated round wood posts every 4th bay, green steel T-posts between, barbed-wire strands with sag;
 *  style 'board' = three-rail board fence. Instanced posts, LineSegments wire. */
export function fenceLine(THREE, opts = {}) {
  const pts = opts.points || [[-50, 0], [50, 0]], th = opts.terrainHeight || (() => 0);
  const spacing = opts.spacing ?? 3.05, H = opts.height ?? 1.3, strands = opts.strands ?? 4, board = opts.style === 'board';
  const g = new THREE.Group(); g.name = opts.id || 'fence_line';
  const posts = [];
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1], [x1, z1] = pts[i], len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / spacing));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) { const t = k / n; posts.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t]); }
  }
  const woodM = cached(MAT, 'fenceWood', () => new THREE.MeshStandardMaterial({ color: 0x7d7162, roughness: 0.95, name: 'fence_post_wood' }));
  const steelM = cached(MAT, 'fenceSteel', () => new THREE.MeshStandardMaterial({ color: 0x3f4a3c, roughness: 0.6, metalness: 0.4, name: 'fence_tpost' }));
  const wood = posts.filter((_, i) => board || i % 4 === 0), steel = posts.filter((_, i) => !board && i % 4 !== 0);
  const o = new THREE.Object3D();
  const inst = (geo, m, list, hh) => {
    const im = new THREE.InstancedMesh(geo, m, Math.max(1, list.length));
    list.forEach(([x, z], i) => { o.position.set(x, th(x, z), z); o.rotation.set((hash2(i, 1, 9) - 0.5) * 0.04, hash2(i, 2, 9) * 3, (hash2(i, 3, 9) - 0.5) * 0.04); o.scale.set(1, hh * (0.97 + hash2(i, 4, 9) * 0.06), 1); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
    im.count = list.length; im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere?.(); return im;
  };
  const wg = new THREE.CylinderGeometry(0.06, 0.065, 1, 7); wg.translate(0, 0.5, 0);
  const sg = new THREE.BoxGeometry(0.04, 1, 0.04); sg.translate(0, 0.5, 0);
  g.add(inst(wg, woodM, wood, H + 0.08), inst(sg, steelM, steel, H - 0.08));
  if (board) {
    const bm = cached(MAT, 'fenceBoard', () => new THREE.MeshStandardMaterial({ color: 0x8a7e6c, roughness: 0.95 }));
    for (let i = 1; i < posts.length; i++) {
      const [x0, z0] = posts[i - 1], [x1, z1] = posts[i], len = Math.hypot(x1 - x0, z1 - z0);
      for (const hh of [0.45, 0.85, 1.22]) {
        const m = new THREE.Mesh(cached(TEX, 'boardGeo', () => new THREE.BoxGeometry(1, 0.14, 0.025)), bm);
        m.position.set((x0 + x1) / 2, (th(x0, z0) + th(x1, z1)) / 2 + hh, (z0 + z1) / 2); m.rotation.y = -Math.atan2(z1 - z0, x1 - x0); m.scale.x = len; m.castShadow = true; g.add(m);
      }
    }
  } else {
    const v = [];
    for (let s = 0; s < strands; s++) {
      const hh = 0.38 + (H - 0.5) * s / Math.max(1, strands - 1);
      for (let i = 1; i < posts.length; i++) {
        const [x0, z0] = posts[i - 1], [x1, z1] = posts[i], y0 = th(x0, z0) + hh, y1 = th(x1, z1) + hh;
        let px = x0, py = y0, pz = z0;
        for (let q = 1; q <= 4; q++) { const t = q / 4, sag = 0.025 * Math.sin(t * Math.PI); const nx = x0 + (x1 - x0) * t, nz = z0 + (z1 - z0) * t, ny = y0 + (y1 - y0) * t - sag; v.push(px, py, pz, nx, ny, nz); px = nx; py = ny; pz = nz; }
      }
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    const lm = cached(MAT, 'fenceWire', () => new THREE.LineBasicMaterial({ color: 0x6b6d6a, transparent: true, opacity: 0.75, name: 'fence_wire' }));
    const wire = new THREE.LineSegments(lg, lm); wire.raycast = () => {}; g.add(wire);
  }
  g.userData = { assetType: 'fence', scenery: true, dims: { length: posts.length * spacing, width: 0.1, height: H }, posts: posts.length };
  return g;
}

/** ditch(THREE, {points:[[x,z],...], width=3.5, terrainHeight, wetness=1, standingWater=false})
 *  Roadside drainage swale overlay: a terrain-draped strip of darker, lusher wet grass (soft feathered edges, lower
 *  roughness), optionally a thin sheet of standing water down the invert. Pair with scene.js road() grading, which already
 *  cuts the swale shape into terrainHeight. */
export function ditch(THREE, opts = {}) {
  const pts = opts.points || [[-50, 0], [50, 0]], th = opts.terrainHeight || (() => 0), W = opts.width ?? 3.5;
  const g = new THREE.Group(); g.name = opts.id || 'ditch';
  const mow = grassTile(THREE, 'mowed');
  const mat = cached(MAT, 'ditchWet', () => {
    const m = new THREE.MeshStandardMaterial({ map: mow.map, normalMap: mow.normalMap, color: 0x4f6a35, roughness: 0.62, metalness: 0, transparent: true, depthWrite: false, vertexColors: true,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, name: 'ditch_wet_grass' });
    m.map = mow.map.clone(); m.map.repeat.set(1 / 1.9, 1 / 1.9); m.map.needsUpdate = true;
    m.normalMap = mow.normalMap.clone(); m.normalMap.repeat.set(1 / 1.9, 1 / 1.9); m.normalMap.needsUpdate = true;
    return m;
  });
  const across = 7, pos = [], uv = [], colr = [], idx = [];
  let rows = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1], [x1, z1] = pts[i], len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(len / 2));
    const tx = (x1 - x0) / len, tz = (z1 - z0) / len;
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n, cx = x0 + (x1 - x0) * t, cz = z0 + (z1 - z0) * t;
      for (let a = 0; a < across; a++) {
        const u = a / (across - 1) - 0.5, x = cx - tz * u * W, z = cz + tx * u * W;
        pos.push(x, th(x, z) + 0.015, z); uv.push(x, z);
        const edge = 1 - Math.pow(Math.abs(u) * 2, 2), wob = 0.75 + 0.25 * vnoise(x / 3, z / 3, 1 << 20, 3);
        const a1 = clamp(edge * wob * (opts.wetness ?? 1), 0, 1); colr.push(1, 1, 1, a1);
      }
      rows++;
    }
  }
  for (let r = 0; r < rows - 1; r++) for (let a = 0; a < across - 1; a++) { const p = r * across + a; idx.push(p, p + across, p + 1, p + 1, p + across, p + across + 1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colr, 4)); geo.setIndex(idx); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.name = 'ditch_grass'; m.raycast = () => {}; g.add(m);
  if (opts.standingWater) {
    const wm = cached(MAT, 'ditchWater', () => new THREE.MeshStandardMaterial({ color: 0x2c3326, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    const wgeo = geo.clone(); const wpos = wgeo.getAttribute('position');
    for (let i = 0; i < wpos.count; i++) { const a = i % across; const u = a / (across - 1) - 0.5; if (Math.abs(u) > 0.18) wpos.setY(i, wpos.getY(i) - 0.05); }
    const w = new THREE.Mesh(wgeo, wm); w.name = 'ditch_water'; w.raycast = () => {}; g.add(w);
  }
  g.userData = { assetType: 'ditch', scenery: true, dims: { length: 0, width: W, height: 0 } };
  return g;
}

/** setLandscapeHaze(color) — tint used for aerial perspective on tree impostors (pass the environment's fog/horizon colour). */
export function setLandscapeHaze(THREE, color, dist) {
  const m = billboardMaterial(THREE);
  if (color) m.userData.uniforms.hazeColor.value.copy(color.isColor ? color : new THREE.Color(color));
  if (dist) m.userData.uniforms.hazeDist.value = dist;
}
export const LANDSCAPE_CELLS = Object.keys(CELLS);
