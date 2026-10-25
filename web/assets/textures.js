// Procedural PBR surface textures for Sightline scenes (browser + Node).
// - Pure-JS tileable noise -> RGBA pixel buffers -> CanvasTexture (browser) or DataTexture (Node).
// - Every texture is seamless (periodic lattice noise, wrapped finite differences for normals).
// - Geometry UVs are in METERS; each set carries `tile` (meters per repeat) and texture.repeat = 1/tile.
// - Lazy + cached: nothing is generated until a kind is first requested.
// - In Node (no document) textures are generated at 1/8 resolution: nobody renders them there,
//   but materials/maps still exist so world modules behave identically.
import * as THREE from 'three';

const IS_BROWSER = typeof document !== 'undefined' && typeof document.createElement === 'function';
const NODE_SCALE = 8;
let ANISO = 8;
const cache = new Map();
const matCache = new Map();

// ---------------------------------------------------------------- noise
function hash2(i, j, seed) {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const mod = (a, n) => ((a % n) + n) % n;
const sstep = t => t * t * (3 - 2 * t);
// periodic value noise; x,y in lattice units, period P lattice cells
function vnoise(x, y, P, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = sstep(x - xi), fy = sstep(y - yi);
  const x0 = mod(xi, P), x1 = mod(xi + 1, P), y0 = mod(yi, P), y1 = mod(yi + 1, P);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
// fbm over the unit tile: u,v in [0,1); base period P (cells across the tile); returns ~[0,1]
function fbm(u, v, P, oct, seed, gain = 0.5, Py = P) {
  let s = 0, amp = 1, norm = 0, px = P, py = Py;
  for (let o = 0; o < oct; o++) {
    s += amp * vnoise(u * px, v * py, px, seed + o * 101) * 1; // period px along x
    norm += amp; amp *= gain; px *= 2; py *= 2;
  }
  return s / norm;
}
// anisotropic periodic fbm (different periods in x/y) — needs its own lattice period per axis
function vnoise2(x, y, Px, Py, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = sstep(x - xi), fy = sstep(y - yi);
  const x0 = mod(xi, Px), x1 = mod(xi + 1, Px), y0 = mod(yi, Py), y1 = mod(yi + 1, Py);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm2(u, v, Px, Py, oct, seed, gain = 0.5) {
  let s = 0, amp = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    s += amp * vnoise2(u * Px, v * Py, Px, Py, seed + o * 131);
    norm += amp; amp *= gain; Px *= 2; Py *= 2;
  }
  return s / norm;
}
// periodic Worley with cached feature-point tables: returns [F1, F2, cellRandom] in cell units; u,v in [0,1), P cells across
const worleyTables = new Map();
function worleyTable(P, seed) {
  const k = P + ':' + seed;
  if (!worleyTables.has(k)) {
    const fx = new Float32Array(P * P), fy = new Float32Array(P * P), id = new Float32Array(P * P);
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) { const c = j * P + i; fx[c] = hash2(i, j, seed); fy[c] = hash2(i, j, seed + 7); id[c] = hash2(i, j, seed + 13); }
    worleyTables.set(k, { fx, fy, id });
  }
  return worleyTables.get(k);
}
const _wout = [0, 0, 0];
function worley(u, v, P, seed) {
  const T = worleyTable(P, seed);
  const x = u * P, y = v * P, xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 99, f2 = 99, id = 0;
  for (let j = -1; j <= 1; j++) {
    const cy = mod(yi + j, P), row = cy * P;
    for (let i = -1; i <= 1; i++) {
      const c = row + mod(xi + i, P);
      const dx = xi + i + T.fx[c] - x, dy = yi + j + T.fy[c] - y, d = dx * dx + dy * dy;
      if (d < f1) { f2 = f1; f1 = d; id = T.id[c]; } else if (d < f2) f2 = d;
    }
  }
  _wout[0] = Math.sqrt(f1); _wout[1] = Math.sqrt(f2); _wout[2] = id;
  return _wout;
}
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => sstep(clamp01((x - e0) / (e1 - e0)));

// ---------------------------------------------------------------- buffers -> textures
function makeTexture(data, w, h, { srgb = false, repeat = 1, repeatY = repeat } = {}) {
  let tex;
  if (IS_BROWSER) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(w, h); img.data.set(data); ctx.putImageData(img, 0, 0);
    tex = new THREE.CanvasTexture(cv);
  } else {
    tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    tex.generateMipmaps = true;
  }
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = ANISO;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.repeat.set(repeat, repeatY);
  tex.needsUpdate = true;
  return tex;
}
// height (Float32 0..1, w*h) -> tangent-space normal map RGBA (wrapped)
function normalFromHeight(H, w, h, strength) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = H[y * w + mod(x - 1, w)], r = H[y * w + mod(x + 1, w)];
    const u = H[mod(y - 1, h) * w + x], d = H[mod(y + 1, h) * w + x];
    let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
    const n = Math.hypot(nx, ny, nz); nx /= n; ny /= n; nz /= n;
    const o = (y * w + x) * 4;
    out[o] = (nx * 0.5 + 0.5) * 255; out[o + 1] = (ny * 0.5 + 0.5) * 255; out[o + 2] = (nz * 0.5 + 0.5) * 255; out[o + 3] = 255;
  }
  return out;
}
function grayToRGBA(G, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const g = clamp01(G[i]) * 255; out[i * 4] = g; out[i * 4 + 1] = g; out[i * 4 + 2] = g; out[i * 4 + 3] = 255; }
  return out;
}

// generator signature: (w, h) -> { color: Uint8ClampedArray RGBA, height: Float32Array, rough: Float32Array }
function genSurface(w, h, fn) {
  const color = new Uint8ClampedArray(w * h * 4), height = new Float32Array(w * h), rough = new Float32Array(w * h);
  const px = { r: 0, g: 0, b: 0, a: 255, h: 0.5, ro: 0.9 };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    px.a = 255;
    fn(x / w, y / h, px, x, y);
    color[i * 4] = px.r; color[i * 4 + 1] = px.g; color[i * 4 + 2] = px.b; color[i * 4 + 3] = px.a;
    height[i] = px.h; rough[i] = px.ro;
  }
  return { color, height, rough };
}

// ---------------------------------------------------------------- surface recipes
// Each recipe: { size, tile (m), normal strength, gen(u,v,px) }. Colors are sRGB 0..255.
const RECIPES = {
  // Aged Florida asphalt: limestone aggregate (light) in grey binder, sun-faded.
  asphalt: {
    size: 512, tile: 2.0, normal: 6,
    gen(u, v, p) {
      const [f1, f2, id] = worley(u, v, 180, 11);         // ~11 mm coarse aggregate
      const [g1, g2, gid] = worley(u, v, 400, 23);        // ~5 mm fines
      const edge = f2 - f1, stone = smooth(0.06, 0.28, edge);
      const fine = smooth(0.05, 0.25, g2 - g1);
      const blot = fbm(u, v, 5, 4, 3);                    // decimetre blotches
      const grain = hash2(Math.floor(u * 4096), Math.floor(v * 4096), 5);
      const binder = 72 + blot * 22;
      const stoneTone = 92 + id * 78 + (id > 0.93 ? 40 : 0); // a few bright quartz/limestone chips
      let g = lerp(binder, stoneTone, stone * 0.85);
      g = lerp(g, g + (gid - 0.5) * 36, fine * 0.5);
      const pit = f1 > 0.62 && edge < 0.05 ? 1 : 0;       // voids between stones
      g = g * (1 - pit * 0.35) + (grain - 0.5) * 14;
      const warm = (blot - 0.5) * 6;
      p.r = g + 1 + warm; p.g = g + warm * 0.6; p.b = g - 2;
      p.h = 0.35 + stone * 0.45 * (0.7 + id * 0.3) + fine * 0.12 - pit * 0.3;
      p.ro = 0.93 - stone * 0.16 * id - blot * 0.04;
    },
  },
  // Broom-finished Portland cement concrete (curbs, sidewalks, some crossovers).
  concrete: {
    size: 512, tile: 2.0, normal: 2.5,
    gen(u, v, p) {
      const n = fbm(u, v, 6, 5, 41), f = hash2(Math.floor(u * 2048), Math.floor(v * 2048), 9);
      const broom = fbm2(u, v, 2, 160, 2, 43);            // transverse broom striations
      const [f1, f2, id] = worley(u, v, 400, 47);
      const sand = smooth(0.05, 0.2, f2 - f1) * (id - 0.5);
      const g = 176 + (n - 0.5) * 26 + (f - 0.5) * 10 + (broom - 0.5) * 10 + sand * 14;
      p.r = g + 2; p.g = g + 1; p.b = g - 3;
      p.h = 0.5 + (broom - 0.5) * 0.5 + sand * 0.2;
      p.ro = 0.88 + (n - 0.5) * 0.1;
    },
  },
  // Mowed right-of-way grass (bahia/St Augustine mix): yellow-green with dry straw flecks.
  grass: {
    size: 512, tile: 4.0, normal: 3,
    gen(u, v, p) {
      const big = fbm(u, v, 3, 4, 61), mid = fbm(u, v, 14, 3, 62);
      const blade = fbm2(u, v, 160, 40, 2, 63);
      const fleck = hash2(Math.floor(u * 1024), Math.floor(v * 1024), 64);
      const dry = smooth(0.55, 0.8, big * 0.6 + mid * 0.4);
      const gap = smooth(0.62, 0.8, fbm(u, v, 40, 2, 65));  // soil showing between tufts
      let r = lerp(88, 132, dry), g = lerp(112, 128, dry), b = lerp(44, 64, dry);
      const shade = 0.78 + blade * 0.36 + (mid - 0.5) * 0.18;
      r *= shade; g *= shade; b *= shade;
      if (fleck > 0.985) { r = 170; g = 156; b = 102; }   // straw
      r = lerp(r, 104, gap * 0.45); g = lerp(g, 92, gap * 0.45); b = lerp(b, 66, gap * 0.45);
      p.r = r; p.g = g; p.b = b;
      p.h = blade * 0.7 + mid * 0.3 - gap * 0.3;
      p.ro = 0.96;
    },
  },
  // Florida improved pasture: taller, patchier, browner, sandy bare spots.
  pasture: {
    size: 512, tile: 6.0, normal: 3.5,
    gen(u, v, p) {
      const big = fbm(u, v, 2, 5, 71), mid = fbm(u, v, 10, 3, 72);
      const tuft = worley(u, v, 90, 73), clump = smooth(0.0, 0.5, tuft[0]);
      const blade = fbm2(u, v, 120, 30, 2, 74);
      const dry = smooth(0.4, 0.85, big * 0.55 + mid * 0.45);
      const sand = smooth(0.7, 0.86, fbm(u, v, 8, 4, 75));
      let r = lerp(84, 140, dry), g = lerp(104, 124, dry), b = lerp(42, 66, dry);
      const shade = 0.72 + blade * 0.32 + (1 - clump) * 0.12 + tuft[2] * 0.08;
      r *= shade; g *= shade; b *= shade;
      r = lerp(r, 168, sand * 0.6); g = lerp(g, 150, sand * 0.6); b = lerp(b, 112, sand * 0.6);
      p.r = r; p.g = g; p.b = b;
      p.h = (1 - clump) * 0.5 + blade * 0.4 - sand * 0.3;
      p.ro = 0.97;
    },
  },
  // Sandy dirt shoulder / unpaved edge (light grey-tan Florida sand with shell + pebbles).
  dirt: {
    size: 512, tile: 3.0, normal: 4,
    gen(u, v, p) {
      const n = fbm(u, v, 6, 5, 81), f = hash2(Math.floor(u * 2048), Math.floor(v * 2048), 82);
      const [f1, f2, id] = worley(u, v, 120, 83), peb = smooth(0.1, 0.3, f2 - f1) * smooth(0.55, 0.9, id);
      const wet = smooth(0.55, 0.75, fbm(u, v, 3, 3, 84));
      const g = 158 + (n - 0.5) * 34 + (f - 0.5) * 22;
      p.r = g + 14 - wet * 22; p.g = g + 4 - wet * 22; p.b = g - 18 - wet * 16;
      if (peb > 0.2) { const t = 120 + id * 80; p.r = lerp(p.r, t, peb); p.g = lerp(p.g, t - 4, peb); p.b = lerp(p.b, t - 10, peb); }
      p.h = n * 0.5 + peb * 0.5 + (f - 0.5) * 0.1;
      p.ro = 0.95 - wet * 0.1;
    },
  },
  // Crushed limerock / gravel.
  gravel: {
    size: 512, tile: 1.5, normal: 7,
    gen(u, v, p) {
      const [f1, f2, id] = worley(u, v, 110, 91), st = smooth(0.02, 0.22, f2 - f1);
      const n = fbm(u, v, 8, 3, 92);
      const t = lerp(96, 120 + id * 90, st) + (n - 0.5) * 20;
      p.r = t + 6; p.g = t + 2; p.b = t - 8;
      p.h = st * (0.6 + id * 0.4);
      p.ro = 0.9 - st * 0.12;
    },
  },
};
RECIPES.grass_mowed = RECIPES.grass;

function buildSurface(kind) {
  const R = RECIPES[kind];
  if (!R) throw new Error('unknown surface kind: ' + kind);
  const size = IS_BROWSER ? R.size : Math.max(16, R.size / NODE_SCALE);
  const { color, height, rough } = genSurface(size, size, R.gen);
  const rep = 1 / R.tile;
  return {
    kind, tile: R.tile,
    map: makeTexture(color, size, size, { srgb: true, repeat: rep }),
    normalMap: makeTexture(normalFromHeight(height, size, size, R.normal * size / 512), size, size, { repeat: rep }),
    roughnessMap: makeTexture(grayToRGBA(rough, size, size), size, size, { repeat: rep }),
  };
}

/** getTextureSet(kind) -> { map, normalMap, roughnessMap, tile } (cached). kinds: asphalt concrete grass pasture dirt gravel */
export function getTextureSet(kind) {
  if (!cache.has(kind)) cache.set(kind, buildSurface(kind));
  return cache.get(kind);
}
export const SURFACE_KINDS = Object.keys(RECIPES);

/** surfaceMaterial(kind, {color, roughness, normalScale, polygonOffset, vertexColors}) — cached MeshStandardMaterial.
 *  Geometry must carry UVs in meters. `color` multiplies the albedo (use it for shoulder/patch tints). */
export function surfaceMaterial(kind, opts = {}) {
  const key = kind + JSON.stringify(opts);
  if (matCache.has(key)) return matCache.get(key);
  const t = getTextureSet(kind);
  const m = new THREE.MeshStandardMaterial({
    map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap,
    color: new THREE.Color(opts.color ?? 0xffffff), roughness: opts.roughness ?? 1, metalness: 0,
    normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1),
    vertexColors: !!opts.vertexColors,
  });
  if (opts.polygonOffset) { m.polygonOffset = true; m.polygonOffsetFactor = opts.polygonOffset; m.polygonOffsetUnits = opts.polygonOffset * 2; }
  m.name = 'surface_' + kind;
  matCache.set(key, m);
  return m;
}

// ---------------------------------------------------------------- decal / overlay textures
function cachedTex(key, build) { if (!cache.has(key)) cache.set(key, build()); return cache.get(key); }
const dims = (w, h) => IS_BROWSER ? [w, h] : [Math.max(8, w / NODE_SCALE), Math.max(8, h / NODE_SCALE)];

/** Lane wear overlay (RGBA, alpha-blended over asphalt). U across ONE lane (0..1), V along `tile` meters.
 *  Lighter polished wheel paths, dark oil-drip band at lane centre, sealed longitudinal joint near the lane line,
 *  occasional transverse sealed cracks ("tar snakes") and patch stains. Returns {map, roughnessMap, tile}. */
export function laneWearTextures() {
  return cachedTex('lanewear', () => {
    const [w, h] = dims(256, 2048), tile = 64;
    const color = new Uint8ClampedArray(w * h * 4), rough = new Float32Array(w * h);
    const cracks = [];
    for (let k = 0; k < 7; k++) cracks.push({ v: hash2(k, 1, 301), amp: 0.004 + hash2(k, 2, 301) * 0.01, ph: hash2(k, 3, 301) * 6.28, len: 0.4 + hash2(k, 4, 301) * 0.6, start: hash2(k, 5, 301) * 0.4 });
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h, i = y * w + x;
      const along = fbm2(u, v, 2, 24, 4, 311);
      const streak = fbm2(u, v, 24, 6, 3, 312);
      const wp = Math.max(Math.exp(-(((u - 0.255) / 0.085) ** 2)), Math.exp(-(((u - 0.745) / 0.085) ** 2)));
      const oil = Math.exp(-(((u - 0.5) / (0.055 + along * 0.03)) ** 2)) * smooth(0.25, 0.75, fbm2(u, v, 4, 96, 3, 313));
      let r = 0, g = 0, b = 0, a = 0, ro = 0.85;
      // wheel paths: lighter, worn binder, smoother
      const wpa = wp * (0.20 + streak * 0.12);
      r = g = b = 150; a = wpa; ro = lerp(0.9, 0.62, wp);
      // oil drip band: dark, blotchy
      const oa = oil * 0.42;
      if (oa > a * 0.6) { r = 38; g = 37; b = 35; a = Math.max(a, oa); ro = 0.7; }
      // sealed longitudinal joint just inside the lane line (u ~ 0.03) — wavy dark band
      const jx = 0.03 + (fbm2(u, v, 1, 40, 2, 314) - 0.5) * 0.03;
      const joint = Math.exp(-(((u - jx) / 0.012) ** 2)) * smooth(0.3, 0.5, fbm2(u, v, 1, 8, 2, 315));
      if (joint > 0.25) { r = 24; g = 24; b = 24; a = Math.max(a, joint * 0.85); ro = 0.45; }
      // transverse tar snakes
      for (const c of cracks) {
        if (u < c.start || u > c.start + c.len) continue;
        const cv = c.v + Math.sin(u * 18 + c.ph) * c.amp + (fbm2(u, v, 8, 1, 1, 316) - 0.5) * 0.004;
        let dv = Math.abs(v - cv); dv = Math.min(dv, 1 - dv);
        const t = Math.exp(-((dv / 0.0012) ** 2));
        if (t > 0.3) { r = 22; g = 22; b = 22; a = Math.max(a, t * 0.9); ro = 0.4; }
      }
      // faint large stains
      const stain = smooth(0.62, 0.8, fbm2(u, v, 1, 6, 4, 317));
      if (stain > a) { r = 52; g = 51; b = 49; a = Math.max(a, stain * 0.22); }
      const o = i * 4; color[o] = r; color[o + 1] = g; color[o + 2] = b; color[o + 3] = clamp01(a) * 255;
      rough[i] = ro;
    }
    return { tile, map: makeTexture(color, w, h, { srgb: true, repeat: 1, repeatY: 1 / tile }), roughnessMap: makeTexture(grayToRGBA(rough, w, h), w, h, { repeat: 1, repeatY: 1 / tile }) };
  });
}

/** Pavement-marking paint: near-white RGBA with worn holes (aggregate showing through). V along `tile` m; U across line. */
export function markingTexture() {
  return cachedTex('marking', () => {
    const [w, h] = dims(64, 1024), tile = 6;
    const color = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h, o = (y * w + x) * 4;
      const wear = fbm2(u, v, 2, 48, 4, 401), grain = hash2(x, y, 402);
      const edge = smooth(0, 0.08, u) * smooth(0, 0.08, 1 - u);
      const hole = smooth(0.66, 0.78, wear) * 0.75 + (grain > 0.93 ? 0.5 : 0);
      const g = 228 + (grain - 0.5) * 30;
      color[o] = g; color[o + 1] = g; color[o + 2] = g - 4; color[o + 3] = clamp01((1 - hole) * (0.55 + 0.45 * edge)) * 255;
    }
    return { tile, map: makeTexture(color, w, h, { srgb: true, repeat: 1, repeatY: 1 / tile }) };
  });
}

/** Tire mark (skid/yaw): dark rubber streaks with tread striations and feathered edges. U across mark, V along `tile` m. */
export function skidTexture() {
  return cachedTex('skid', () => {
    const [w, h] = dims(64, 512), tile = 4;
    const color = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h, o = (y * w + x) * 4;
      const stri = 0.65 + 0.35 * Math.sin(u * Math.PI * 2 * 5.5) ** 2;          // tread ribs
      const streak = fbm2(u, v, 16, 3, 3, 501);
      const edge = smooth(0, 0.18, u) * smooth(0, 0.18, 1 - u);
      const a = clamp01(edge * stri * (0.55 + streak * 0.55));
      color[o] = 18; color[o + 1] = 17; color[o + 2] = 16; color[o + 3] = a * 255;
    }
    return { tile, map: makeTexture(color, w, h, { srgb: true, repeat: 1, repeatY: 1 / tile }) };
  });
}

/** Ragged pavement-edge fringe: sand/soil creeping over the asphalt edge onto grass. U 0=pavement side .. 1=grass side. */
export function edgeFringeTexture() {
  return cachedTex('fringe', () => {
    const [w, h] = dims(64, 1024), tile = 16;
    const color = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h, o = (y * w + x) * 4;
      const n = fbm2(u, v, 2, 64, 4, 601), g = hash2(x, y, 602);
      const prof = smooth(0.0, 0.25, u) * (1 - smooth(0.35 + n * 0.5, 0.95, u));
      const a = clamp01(prof * (0.5 + n * 0.7) + (g - 0.5) * 0.2);
      const t = 150 + (n - 0.5) * 40 + (g - 0.5) * 24;
      color[o] = t + 10; color[o + 1] = t; color[o + 2] = t - 22; color[o + 3] = a * 255;
    }
    return { tile, map: makeTexture(color, w, h, { srgb: true, repeat: 1, repeatY: 1 / tile }) };
  });
}

/** Ground "paint" texture for impact/evidence markers (spray paint: soft edges, overspray). */
export function sprayTexture() {
  return cachedTex('spray', () => {
    const [w, h] = dims(128, 128);
    const color = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h, o = (y * w + x) * 4, g = hash2(x, y, 701), n = fbm(u, v, 8, 3, 702);
      const a = clamp01(0.55 + n * 0.5 - (g > 0.9 ? 0.4 : 0));
      color[o] = 255; color[o + 1] = 255; color[o + 2] = 255; color[o + 3] = a * 255;
    }
    return { map: makeTexture(color, w, h, { srgb: true }) };
  });
}

/** setAnisotropy(n): call once with renderer.capabilities.getMaxAnisotropy() (default 8). */
export function setAnisotropy(n) {
  ANISO = n;
  for (const v of cache.values()) for (const t of Object.values(v)) if (t && t.isTexture) { t.anisotropy = n; t.needsUpdate = true; }
}
export const _noise = { hash2, vnoise, fbm, fbm2, worley };
