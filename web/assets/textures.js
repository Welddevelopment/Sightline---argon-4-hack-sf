// Procedural PBR surface textures for Sightline scenes (browser + Node).
// - Pure-JS tileable noise -> RGBA pixel buffers -> CanvasTexture (browser) or DataTexture (Node).
// - Every texture is seamless (periodic lattice noise, wrapped finite differences for normals).
// - Geometry UVs are in METERS; each set carries `tile` (meters per repeat) and texture.repeat = 1/tile.
// - Lazy + cached: nothing is generated until a kind is first requested.
// - In Node (no document) textures are generated at 1/8 resolution: nobody renders them there,
//   but materials/maps still exist so world modules behave identically.
import * as THREE from 'three';

const IS_BROWSER = typeof document !== 'undefined' && typeof document.createElement === 'function';
const NODE_SCALE = (typeof process !== 'undefined' && process.env && process.env.SL_TEX_FULL) ? 1 : 8;
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
  // Mowed right-of-way grass (bahia/St Augustine, end of the May dry season): dull olive with straw flecks.
  // Large-scale colour variation is deliberately weak here (it would repeat every tile); groundPlane adds it per vertex.
  grass: {
    size: 1024, tile: 3.0, normal: 2,
    gen(u, v, p) {
      const mid = fbm(u, v, 12, 3, 62), fine = fbm(u, v, 48, 2, 66);
      const blade = fbm2(u, v, 160, 40, 2, 63);
      const fleck = hash2(Math.floor(u * 1024), Math.floor(v * 1024), 64);
      const dry = smooth(0.35, 0.75, mid * 0.6 + fine * 0.4);
      const gap = smooth(0.64, 0.8, fbm(u, v, 40, 2, 65));  // soil showing between tufts
      let r = lerp(100, 134, dry), g = lerp(110, 124, dry), b = lerp(56, 72, dry);
      const shade = 0.86 + blade * 0.22 + (fine - 0.5) * 0.08;   // low blade contrast: reads as turf, not noise, at 5-50 m
      r *= shade; g *= shade; b *= shade;
      if (fleck > 0.988) { r = 150; g = 142; b = 100; }   // straw
      r = lerp(r, 118, gap * 0.4); g = lerp(g, 106, gap * 0.4); b = lerp(b, 80, gap * 0.4);
      p.r = r; p.g = g; p.b = b;
      p.h = blade * 0.7 + fine * 0.3 - gap * 0.3;
      p.ro = 0.96;
    },
  },
  // Florida improved pasture: taller, tuftier and browner than the mowed strip; sandy bare spots.
  pasture: {
    size: 512, tile: 5.0, normal: 3.5,
    gen(u, v, p) {
      const mid = fbm(u, v, 10, 3, 72), fine = fbm(u, v, 40, 2, 76);
      const tuft = worley(u, v, 70, 73), clump = smooth(0.0, 0.5, tuft[0]), tid = tuft[2];
      const blade = fbm2(u, v, 120, 30, 2, 74);
      const dry = smooth(0.3, 0.8, mid * 0.55 + fine * 0.25 + tid * 0.2);
      const sand = smooth(0.74, 0.86, fbm(u, v, 9, 3, 75));
      let r = lerp(98, 142, dry), g = lerp(106, 124, dry), b = lerp(54, 74, dry);
      const shade = 0.74 + blade * 0.3 + (1 - clump) * 0.14;
      r *= shade; g *= shade; b *= shade;
      r = lerp(r, 160, sand * 0.45); g = lerp(g, 146, sand * 0.45); b = lerp(b, 112, sand * 0.45);
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
  if (/^(grass|pasture)/.test(kind)) antiTile(m);
  m.name = 'surface_' + kind;
  matCache.set(key, m);
  return m;
}

// Anti-tiling for vegetation ground: the albedo is blended with a rotated 7x-larger resample of itself and modulated
// by a 50x-larger one, so the 3 m tile never reads as a repeating pattern and mid-distance turf gets soft patchiness.
function antiTile(m) {
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  vec2 uvB = mat2( 0.8, -0.6, 0.6, 0.8 ) * vMapUv * 0.143 + vec2( 0.37, 0.11 );
  vec4 texB = texture2D( map, uvB );
  vec4 texC = texture2D( map, mat2( 0.28, 0.96, -0.96, 0.28 ) * vMapUv * 0.021 + vec2( 0.53, 0.29 ) );
  float lC = dot( texC.rgb, vec3( 0.3, 0.5, 0.2 ) );
  sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, texB.rgb, 0.4 ) * ( 0.8 + 0.4 * smoothstep( 0.06, 0.2, lC ) );
  diffuseColor *= sampledDiffuseColor;
#endif`);
  };
  m.customProgramCacheKey = () => 'surface-antitile';
}

// ---------------------------------------------------------------- decal / overlay textures
function cachedTex(key, build) { if (!cache.has(key)) cache.set(key, build()); return cache.get(key); }
const dims = (w, h) => IS_BROWSER ? [w, h] : [Math.max(8, w / NODE_SCALE), Math.max(8, h / NODE_SCALE)];

/** Lane wear overlay (RGBA, alpha-blended over asphalt). U across ONE lane (0..1), V along `tile` meters.
 *  Lighter polished wheel paths, dark oil-drip band at lane centre, sealed longitudinal joint near the lane line,
 *  occasional transverse sealed cracks ("tar snakes") and patch stains. Returns {map, roughnessMap, tile}. */
export function laneWearTextures() {
  return cachedTex('lanewear', () => {
    const [w, h] = dims(128, 1024), tile = 96;
    const color = new Uint8ClampedArray(w * h * 4), rough = new Float32Array(w * h);
    const cracks = [];
    for (let k = 0; k < 3; k++) cracks.push({ v: (k + 0.2 + hash2(k, 1, 301) * 0.6) / 3, amp: 0.0006 + hash2(k, 2, 301) * 0.0012, ph: hash2(k, 3, 301) * 6.28, len: 0.25 + hash2(k, 4, 301) * 0.5, start: 0.05 + hash2(k, 5, 301) * 0.4 });
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h, i = y * w + x;
      const along = fbm2(u, v, 2, 24, 4, 311);
      const streak = fbm2(u, v, 24, 6, 3, 312);
      const wp = Math.max(Math.exp(-(((u - 0.255) / 0.085) ** 2)), Math.exp(-(((u - 0.745) / 0.085) ** 2)));
      const oil = Math.exp(-(((u - 0.5) / (0.055 + along * 0.03)) ** 2)) * smooth(0.25, 0.75, fbm2(u, v, 4, 96, 3, 313));
      let r = 0, g = 0, b = 0, a = 0, ro = 0.85;
      // wheel paths: lighter, worn binder, smoother
      const wpa = wp * (0.10 + streak * 0.10);
      r = 146; g = 145; b = 141; a = wpa; ro = lerp(0.9, 0.62, wp);
      // oil drip band: dark, blotchy
      const oa = oil * 0.30;
      if (oa > a * 0.6) { r = 38; g = 37; b = 35; a = Math.max(a, oa); ro = 0.7; }
      // sealed longitudinal joint just inside the lane line (u ~ 0.03) — wavy dark band
      const jx = 0.03 + (fbm2(u, v, 1, 40, 2, 314) - 0.5) * 0.03;
      const joint = Math.exp(-(((u - jx) / 0.012) ** 2)) * smooth(0.3, 0.5, fbm2(u, v, 1, 8, 2, 315));
      if (joint > 0.25) { r = 34; g = 34; b = 33; a = Math.max(a, joint * 0.5); ro = 0.5; }
      // transverse tar snakes
      for (const c of cracks) {
        if (u < c.start || u > c.start + c.len) continue;
        const cv = c.v + Math.sin(u * 9 + c.ph) * c.amp + (fbm2(u, c.v, 6, 1, 2, 316) - 0.5) * 0.003;
        let dv = Math.abs(v - cv); dv = Math.min(dv, 1 - dv);
        const t = Math.exp(-((dv / 0.0007) ** 2)) * smooth(0, 0.05, u - c.start) * smooth(0, 0.05, c.start + c.len - u);
        if (t > 0.3) { r = 30; g = 30; b = 29; a = Math.max(a, t * 0.55); ro = 0.45; }
      }
      // faint large stains
      const stain = smooth(0.62, 0.8, fbm2(u, v, 1, 6, 4, 317));
      if (stain * 0.14 > a) { r = 52; g = 51; b = 49; a = stain * 0.14; }
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
      const t = 128 + (n - 0.5) * 30 + (g - 0.5) * 24;
      color[o] = t + 8; color[o + 1] = t; color[o + 2] = t - 16; color[o + 3] = a * 0.7 * 255;
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

// ---------------------------------------------------------------- foliage (alpha-clipped leaf cards)
/** Leaf-card texture: RGBA spray of leaves on twigs, transparent background (use alphaTest 0.5).
 *  kind 'oak' (small dark live-oak leaves), 'pine' (needle tufts), 'shrub' (dense small leaves), 'palmetto'. */
export function foliageTexture(kind = 'oak') {
  return cachedTex('foliage:' + kind, () => {
    const S = IS_BROWSER ? 512 : 64;
    let tex;
    if (IS_BROWSER) {
      const cv = document.createElement('canvas'); cv.width = cv.height = S;
      const g = cv.getContext('2d');
      let seed = kind.length * 977 + 13; const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      g.clearRect(0, 0, S, S);
      const C = (l, a = 1) => { const v = l * (0.85 + R() * 0.3); return kind === 'pine' ? `rgba(${v * 0.62 | 0},${v * 0.86 | 0},${v * 0.42 | 0},${a})` : `rgba(${v * 0.6 | 0},${v * 0.9 | 0},${v * 0.36 | 0},${a})`; };
      const inDisc = (x, y, r = 0.47) => (x / S - 0.5) ** 2 + (y / S - 0.5) ** 2 < r * r;
      if (kind === 'pine') {
        // slash pine: tufts of long needles radiating from twig tips
        g.strokeStyle = 'rgba(70,55,40,1)'; g.lineWidth = 3;
        const tips = [];
        for (let b = 0; b < 5; b++) { const a0 = R() * 6.28, x0 = S / 2 + Math.cos(a0) * S * 0.05, y0 = S / 2 + Math.sin(a0) * S * 0.05, x1 = S / 2 + Math.cos(a0) * S * 0.3, y1 = S / 2 + Math.sin(a0) * S * 0.3; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); tips.push([x1, y1], [(x0 + x1) / 2, (y0 + y1) / 2]); }
        tips.push([S / 2, S / 2]);
        for (const [cx, cy] of tips) for (let i = 0; i < 90; i++) {
          const a = R() * 6.28, l = S * (0.06 + R() * 0.13); g.strokeStyle = C(60 + R() * 90); g.lineWidth = 1.2 + R() * 1.2;
          g.beginPath(); g.moveTo(cx, cy); g.quadraticCurveTo(cx + Math.cos(a) * l * 0.5, cy + Math.sin(a) * l * 0.5 + l * 0.08, cx + Math.cos(a) * l, cy + Math.sin(a) * l + l * 0.15); g.stroke();
        }
      } else {
        const small = kind === 'shrub' ? 0.75 : kind === 'palmetto' ? 2.2 : 1;
        // twigs
        g.strokeStyle = 'rgba(62,50,38,1)';
        const twigs = [];
        for (let b = 0; b < 7; b++) { let x = S / 2 + (R() - 0.5) * S * 0.2, y = S / 2 + (R() - 0.5) * S * 0.2; const a = R() * 6.28; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += Math.cos(a + (R() - 0.5)) * S * 0.07; y += Math.sin(a + (R() - 0.5)) * S * 0.07; g.lineTo(x, y); twigs.push([x, y]); } g.stroke(); }
        // leaves: dark underlayer then lighter top leaves, clustered on twigs, ragged outline
        for (const pass of [0, 1, 2]) {
          const n = (kind === 'shrub' ? 900 : 700) * (pass === 2 ? 0.5 : 1) / small;
          for (let i = 0; i < n; i++) {
            const t = twigs[(R() * twigs.length) | 0], rr = S * 0.16 * Math.sqrt(R()), a = R() * 6.28;
            const x = t[0] + Math.cos(a) * rr, y = t[1] + Math.sin(a) * rr;
            if (!inDisc(x, y)) continue;
            const L = (S / 512) * (7 + R() * 5) * small, Wd = L * (kind === 'palmetto' ? 0.18 : 0.45);
            g.fillStyle = C(pass === 0 ? 55 : pass === 1 ? 85 : 120); g.save(); g.translate(x, y); g.rotate(R() * 6.28);
            g.beginPath(); g.ellipse(0, 0, L, Wd, 0, 0, Math.PI * 2); g.fill(); g.restore();
          }
        }
      }
      tex = new THREE.CanvasTexture(cv);
    } else {
      const d = new Uint8ClampedArray(S * S * 4);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const o = (y * S + x) * 4, r = Math.hypot(x / S - 0.5, y / S - 0.5); d[o] = 70; d[o + 1] = 100; d[o + 2] = 45; d[o + 3] = r < 0.42 && hash2(x, y, 9) > 0.3 ? 255 : 0; }
      tex = new THREE.DataTexture(d, S, S, THREE.RGBAFormat); tex.generateMipmaps = true;
    }
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = ANISO;
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
    return { map: tex };
  });
}
const FOLIAGE_MATS = new Map();
/** Shared leaf-card material: alphaTest 0.5, double-sided, normals not flipped on back faces (so cluster normals
 *  that point outward from the crown give soft volumetric shading). Use with castShadow (alpha-tested shadows). */
export function foliageMaterial(kind = 'oak', opts = {}) {
  const key = kind + JSON.stringify(opts);
  if (FOLIAGE_MATS.has(key)) return FOLIAGE_MATS.get(key);
  const m = new THREE.MeshStandardMaterial({ map: foliageTexture(kind).map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.88, metalness: 0, color: 0xffffff, ...opts });
  m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;')); };
  m.customProgramCacheKey = () => 'foliage-noflip';
  m.name = 'foliage_' + kind;
  FOLIAGE_MATS.set(key, m);
  return m;
}
/** Leaf-card cluster geometry in a unit sphere (radius 1): `cards` quads with random orientation, normals pointing
 *  away from the cluster centre (blended with the up vector) so instanced crowns shade like volumes. flat<1 squashes Y. */
export function foliageClusterGeometry({ cards = 9, seed = 1, flat = 0.75, size = 0.95, hollow = 0.35 } = {}) {
  let s = seed * 7919 + 17; const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pos = [], nor = [], uv = [], idx = [];
  const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let c = 0; c < cards; c++) {
    // centre on a shell (so the crown reads as a volume with a lacy edge)
    const u = R() * 2 - 1, ph = R() * 6.28, rr = hollow + (1 - hollow) * Math.cbrt(R()) * 0.75, sq = Math.sqrt(1 - u * u);
    const cx = sq * Math.cos(ph) * rr, cy = u * rr * flat, cz = sq * Math.sin(ph) * rr;
    e.set(R() * 6.28, R() * 6.28, R() * 6.28); q.setFromEuler(e);
    a.set(1, 0, 0).applyQuaternion(q); b.set(0, 1, 0).applyQuaternion(q);
    const h = size * (0.75 + R() * 0.5) / 2, base = pos.length / 3;
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      v.set(cx + (a.x * i + b.x * j) * h, cy + (a.y * i + b.y * j) * h, cz + (a.z * i + b.z * j) * h);
      pos.push(v.x, v.y, v.z);
      const n = new THREE.Vector3(v.x, v.y / Math.max(0.3, flat), v.z).normalize().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.45, 0)).normalize();
      nor.push(n.x, n.y, n.z); uv.push((i + 1) / 2, (j + 1) / 2);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

// ---------------------------------------------------------------- high-res pavement marking decals (CanvasTexture)
/** decalTexture(kind, {pxPerM=200, w, h}) -> {map, w, h}  Worn thermoplastic paint on a transparent canvas, sized in metres.
 *  kinds: 'arrow_left' | 'arrow_right' | 'arrow_through' | 'arrow_left_through' | 'stop_bar' | 'crosswalk' (continental,
 *  w = walk width, h = road width) | 'nose_hatch' (yellow diagonal hatch for median noses) | 'double_yellow'.
 *  Arrows point toward canvas top (+V). Anisotropy follows setAnisotropy(). Browser only (null in Node). */
export function decalTexture(kind, o = {}) {
  if (!IS_BROWSER) return null;
  const key = 'decal:' + kind + ':' + JSON.stringify(o);
  return cachedTex(key, () => {
    const D = { arrow_left: [1.6, 4.0], arrow_right: [1.6, 4.0], arrow_through: [1.0, 4.0], arrow_left_through: [1.9, 4.6], stop_bar: [3.4, 0.61], crosswalk: [3.0, 7.3], nose_hatch: [4, 12], double_yellow: [0.4, 12] }[kind] || [2, 2];
    const w = o.w ?? D[0], h = o.h ?? D[1];
    const ppm = Math.min(o.pxPerM ?? (kind === 'nose_hatch' || kind === 'double_yellow' ? 90 : 200), 4096 / Math.max(w, h));
    const cv = document.createElement('canvas'); cv.width = Math.max(4, Math.round(w * ppm)); cv.height = Math.max(4, Math.round(h * ppm));
    const g = cv.getContext('2d'), W = cv.width, H = cv.height;
    const X = m => (m + w / 2) * ppm, Y = m => H - m * ppm; // x centred, y from bottom (metres)
    const white = '#f2f1ea', yellow = '#e5a91f';
    g.fillStyle = o.color === 'yellow' || kind === 'nose_hatch' || kind === 'double_yellow' ? yellow : white;
    const poly = pts => { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))); g.closePath(); g.fill(); };
    const s = h / 4.0;
    const through = [[0.11, 0], [0.11, 2.7 * s], [0.4, 2.7 * s], [0, 3.95 * s], [-0.4, 2.7 * s], [-0.11, 2.7 * s], [-0.11, 0]];
    const left = (m = 1, dx = 0) => { // stem + curved hook to the left (m=-1 mirrors)
      const P = [[0.11, 0], [0.11, 1.75 * s]];
      for (let k = 0; k <= 10; k++) { const a = (k / 10) * Math.PI / 2; P.push([-0.55 + 0.66 * Math.cos(a), 1.75 * s + 0.66 * Math.sin(a) * s * 1.2]); }
      P.push([-0.55, 2.75 * s], [-0.55, 3.15 * s], [-1.3 * 0.75, 2.42 * s * 1.0], [-0.55, 1.65 * s + 0.1], [-0.55, 2.2 * s]);
      for (let k = 10; k >= 0; k--) { const a = (k / 10) * Math.PI / 2; P.push([-0.55 + 0.44 * Math.cos(a), 1.75 * s + 0.44 * Math.sin(a) * s * 1.2]); }
      P.push([-0.11, 1.75 * s], [-0.11, 0]);
      poly(P.map(([x, y]) => [x * m + dx, y]));
    };
    if (kind === 'arrow_through') poly(through);
    else if (kind === 'arrow_left') left(1, 0.35);
    else if (kind === 'arrow_right') left(-1, -0.35);
    else if (kind === 'arrow_left_through') { poly(through.map(([x, y]) => [x + 0.35, y])); left(1, 0.35); }
    else if (kind === 'stop_bar') g.fillRect(0, 0, W, H);
    else if (kind === 'crosswalk') { const bar = 0.6, pitch = 1.2, n = Math.floor((h + pitch - bar) / pitch), st = (h - (n - 1) * pitch) / 2; for (let i = 0; i < n; i++) g.fillRect(0, Y(st + i * pitch + bar / 2), W, bar * ppm); }
    else if (kind === 'double_yellow') { g.fillRect(0, 0, 0.1 * ppm, H); g.fillRect(W - 0.1 * ppm, 0, 0.1 * ppm, H); }
    else if (kind === 'nose_hatch') { // solid outline + 45-degree hatch, 0.3 m bars at 3 m (FDOT Index 711)
      const lw = 0.15 * ppm; g.lineWidth = lw; g.strokeStyle = yellow; g.strokeRect(lw / 2, lw / 2, W - lw, H - lw);
      g.save(); g.beginPath(); g.rect(0, 0, W, H); g.clip(); g.lineWidth = 0.3 * ppm;
      for (let d = -W; d < H + W; d += 3 * ppm) { g.beginPath(); g.moveTo(0, d); g.lineTo(W, d - W); g.stroke(); } g.restore();
    }
    // wear: punch holes / thin the paint with noise (aggregate showing through)
    const img = g.getImageData(0, 0, W, H), d = img.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4; if (!d[i + 3]) continue;
      const n = fbm2(x / W, y / H, 4, 4, 4, 811), gr = hash2(x, y, 812);
      const hole = smooth(0.62, 0.74, n) * 0.6 + (gr > 0.94 ? 0.55 : 0);
      d[i + 3] = d[i + 3] * clamp01(1 - hole) * (0.9 + 0.1 * gr);
      const k = 0.94 + gr * 0.08; d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = ANISO; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
    return { map: t, w, h };
  });
}
