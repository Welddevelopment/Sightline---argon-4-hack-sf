// road_surface_material.js
// Procedural aged dense-graded US highway asphalt material (3-6 years old)
// Returns THREE.MeshStandardMaterial with co-registered 1024x1024 DataTextures.

const TEX_SIZE = 1024;
const _textureCache = new Map();

function hashSeed(str) {
  const s = String(str ?? 'argon_asphalt_default');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// Fast periodic value noise on a power-of-two grid
function createPeriodicNoiseGrid(period, prng) {
  const mask = period - 1;
  const grid = new Float32Array(period * period);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = prng();
  }
  return function sample(u, v) {
    const x = u * period;
    const y = v * period;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const uFade = xf * xf * (3.0 - 2.0 * xf);
    const vFade = yf * yf * (3.0 - 2.0 * yf);

    const x0 = xi & mask;
    const x1 = (xi + 1) & mask;
    const y0 = (yi & mask) * period;
    const y1 = ((yi + 1) & mask) * period;

    const a = grid[y0 + x0];
    const b = grid[y0 + x1];
    const c = grid[y1 + x0];
    const d = grid[y1 + x1];

    const ab = a + (b - a) * uFade;
    const cd = c + (d - c) * uFade;
    return ab + (cd - ab) * vFade;
  };
}

// Build periodic crack / tar-snake SDF-like mask on a 512x512 grid, bilinearly sampled
function buildCrackAndTarField(size, prng) {
  const fSize = 512;
  const mask = fSize - 1;
  const tarMask = new Float32Array(fSize * fSize);      // 0..1 sealed tar snake intensity
  const openCrack = new Float32Array(fSize * fSize);    // 0..1 unsealed hairline crack depth

  const nWarp1 = createPeriodicNoiseGrid(16, prng);
  const nWarp2 = createPeriodicNoiseGrid(32, prng);
  const nWarp3 = createPeriodicNoiseGrid(64, prng);
  const nVar = createPeriodicNoiseGrid(32, prng);

  // Define 2 sparse longitudinal sealed cracks and 1 transverse thermal crack
  // All coordinates are periodic on [0, 1)
  const longPos1 = 0.21 + (prng() - 0.5) * 0.06;
  const longPos2 = 0.74 + (prng() - 0.5) * 0.06;
  const transPos1 = 0.43 + (prng() - 0.5) * 0.08;

  for (let y = 0; y < fSize; y++) {
    const v = y / fSize;
    const s1 = Math.sin(v * Math.PI * 2.0);
    const c1 = Math.cos(v * Math.PI * 2.0);
    const s2 = Math.sin(v * Math.PI * 4.0 + 1.3);

    for (let x = 0; x < fSize; x++) {
      const u = x / fSize;
      const idx = y * fSize + x;

      const w1 = nWarp1(u, v) - 0.5;
      const w2 = nWarp2(u, v) - 0.5;
      const w3 = nWarp3(u, v) - 0.5;
      const localVar = nVar(u, v);

      // Longitudinal tar snake 1 (meandering along V, intermittent)
      const meander1 = longPos1 + 0.022 * s1 + 0.011 * s2 + 0.028 * w1 + 0.012 * w2 + 0.005 * w3;
      let d1 = Math.abs(u - meander1);
      if (d1 > 0.5) d1 = 1.0 - d1;
      // Presence modulation along V so it doesn't look like a continuous ruler line
      const pres1 = smoothstep(0.28, 0.42, 0.5 + 0.35 * c1 + 0.35 * (nWarp1(0.15, v) - 0.5));
      const width1 = 0.0042 + 0.0022 * localVar; // ~16-25 mm squeegee width at 4m
      const tar1 = (1.0 - smoothstep(width1 * 0.45, width1, d1)) * pres1;

      // Transverse sealed thermal crack (runs mostly across U, fades near edges)
      const su = Math.sin(u * Math.PI * 2.0 + 0.7);
      const cu = Math.cos(u * Math.PI * 2.0 + 0.7);
      const meanderT = transPos1 + 0.025 * su + 0.032 * w1 + 0.014 * w2 + 0.006 * w3;
      let dT = Math.abs(v - meanderT);
      if (dT > 0.5) dT = 1.0 - dT;
      const presT = smoothstep(0.32, 0.48, 0.5 + 0.38 * cu + 0.3 * (nWarp1(u, 0.6) - 0.5));
      const widthT = 0.0038 + 0.0020 * localVar;
      const tarT = (1.0 - smoothstep(widthT * 0.45, widthT, dT)) * presT;

      // Secondary unsealed hairline crack + partial seal along longPos2
      const meander2 = longPos2 - 0.018 * s1 + 0.026 * w1 + 0.013 * w2 + 0.007 * w3;
      let d2 = Math.abs(u - meander2);
      if (d2 > 0.5) d2 = 1.0 - d2;
      const pres2 = smoothstep(0.35, 0.50, 0.5 - 0.35 * s1 + 0.35 * (nWarp2(0.8, v) - 0.5));
      const hairWidth = 0.0016 + 0.0007 * localVar;
      const hair2 = (1.0 - smoothstep(hairWidth * 0.25, hairWidth, d2)) * pres2;

      // Center hairline inside tar1/tarT where sealant slightly recessed
      const hair1 = (1.0 - smoothstep(0.0005, 0.0014, d1)) * pres1 * 0.35;

      tarMask[idx] = Math.max(tar1, tarT);
      openCrack[idx] = Math.max(hair2, hair1);
    }
  }

  return function sampleCrack(u, v) {
    const x = u * fSize;
    const y = v * fSize;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;

    const x0 = xi & mask;
    const x1 = (xi + 1) & mask;
    const y0 = (yi & mask) * fSize;
    const y1 = ((yi + 1) & mask) * fSize;

    const t00 = tarMask[y0 + x0];
    const t10 = tarMask[y0 + x1];
    const t01 = tarMask[y1 + x0];
    const t11 = tarMask[y1 + x1];
    const tar = (t00 + (t10 - t00) * xf) * (1 - yf) + (t01 + (t11 - t01) * xf) * yf;

    const c00 = openCrack[y0 + x0];
    const c10 = openCrack[y0 + x1];
    const c01 = openCrack[y1 + x0];
    const c11 = openCrack[y1 + x1];
    const crack = (c00 + (c10 - c00) * xf) * (1 - yf) + (c01 + (c11 - c01) * xf) * yf;

    return { tar, crack };
  };
}

function generateAsphaltMaps(THREE, seedKey, tintColor) {
  const cacheKey = `${seedKey}_${tintColor.getHexString()}`;
  if (_textureCache.has(cacheKey)) {
    return _textureCache.get(cacheKey);
  }

  const prng = mulberry32(hashSeed(seedKey));
  const N = TEX_SIZE;
  const mask = N - 1;

  // Multi-scale periodic noise layers
  // At 4m tile:
  // period 512 -> ~8mm cells (fine aggregate 2-6mm)
  // period 256 -> ~15mm cells (medium aggregate 6-12mm)
  // period 128 -> ~31mm macro texture clusters
  // period 32  -> ~125mm binder oxidation / patchiness
  // period 8   -> ~500mm macro mottling & oil stains
  const nFine1 = createPeriodicNoiseGrid(512, prng);
  const nFine2 = createPeriodicNoiseGrid(512, prng);
  const nMed1 = createPeriodicNoiseGrid(256, prng);
  const nMed2 = createPeriodicNoiseGrid(256, prng);
  const nCluster = createPeriodicNoiseGrid(128, prng);
  const nPatch = createPeriodicNoiseGrid(32, prng);
  const nMacro = createPeriodicNoiseGrid(8, prng);
  const nOil = createPeriodicNoiseGrid(16, prng);

  // Per-pixel high-frequency grit table (periodic 1024x1024)
  const microGrit = new Float32Array(N * N);
  const stoneHueVar = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    microGrit[i] = prng();
    stoneHueVar[i] = prng();
  }

  const sampleCrack = buildCrackAndTarField(N, prng);

  const heightField = new Float32Array(N * N);
  const albedoData = new Uint8Array(N * N * 4);
  const roughData = new Uint8Array(N * N * 4);
  const normalData = new Uint8Array(N * N * 4);

  // Compute tint multiplier relative to default neutral aged asphalt (#68696b)
  // Default sRGB ~(104, 105, 107) -> linear ~0.14
  const baseDefault = new THREE.Color(0x68696b);
  const tintR = clamp(tintColor.r / Math.max(0.01, baseDefault.r), 0.5, 1.6);
  const tintG = clamp(tintColor.g / Math.max(0.01, baseDefault.g), 0.5, 1.6);
  const tintB = clamp(tintColor.b / Math.max(0.01, baseDefault.b), 0.5, 1.6);

  for (let y = 0; y < N; y++) {
    const v = y / N;
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const idx = y * N + x;

      // 1. Wheel-path & center oil-drip longitudinal profiles (periodic in U)
      // Two subtle wheel tracks around u = 0.27 and u = 0.73, oil drip zone around u = 0.50
      const dWheelL = Math.abs(u - 0.27);
      const dWheelR = Math.abs(u - 0.73);
      const wheelTrack =
        Math.exp(-(dWheelL * dWheelL) / (2.0 * 0.085 * 0.085)) +
        Math.exp(-(dWheelR * dWheelR) / (2.0 * 0.085 * 0.085));

      const dCenter = Math.abs(u - 0.50);
      const centerZone = Math.exp(-(dCenter * dCenter) / (2.0 * 0.095 * 0.095));

      // Longitudinal streak modulation (stretched in V)
      const streakMod = nPatch((u * 2.0) % 1.0, (v * 0.25) % 1.0);
      const wheelPolish = clamp(wheelTrack * (0.75 + 0.5 * streakMod), 0.0, 1.0);

      // Oil mottling (stronger in center zone + random patches)
      const oilNoise = nOil(u, (v * 0.5) % 1.0) * nMacro(u, v);
      const oilStain = smoothstep(0.28, 0.68, oilNoise * (0.45 + 0.75 * centerZone));

      // 2. Dense-graded aggregate stone synthesis
      const f1 = nFine1(u, v);
      const f2 = nFine2((u + 0.37) % 1.0, (v + 0.61) % 1.0);
      const m1 = nMed1(u, v);
      const m2 = nMed2((u + 0.19) % 1.0, (v + 0.43) % 1.0);
      const cl = nCluster(u, v);
      const grit = microGrit[idx];

      // Sharp cellular-like stone peaks by combining inverted abs differences
      const fineChip = 1.0 - Math.abs(f1 - f2) * 2.0;
      const medChip = 1.0 - Math.abs(m1 - m2) * 2.0;

      // Stone exposure mask: peaks of medium (6-12mm) and fine (2-5mm) chips
      const medStone = smoothstep(0.58, 0.88, medChip * (0.75 + 0.25 * cl));
      const fineStone = smoothstep(0.52, 0.86, fineChip);
      const microStone = smoothstep(0.72, 0.96, grit);

      const chipExposure = clamp(
        medStone * 0.65 + fineStone * 0.50 + microStone * 0.25,
        0.0,
        1.0
      );

      // Voids / small surface pits between aggregate stones
      const voidPit = smoothstep(0.68, 0.92, (1.0 - fineChip) * (1.0 - medChip));

      // 3. Cracks and sealed tar snakes
      const { tar, crack } = sampleCrack(u, v);

      // 4. Unified Height Field (in normalized mm-like relief units, 0..1)
      // Base macro undulation + aggregate stones protruding + void pits recessed
      const macroH = (nPatch(u, v) - 0.5) * 0.12 + (cl - 0.5) * 0.10;
      const stoneH =
        medStone * 0.38 +
        fineStone * 0.30 +
        (grit - 0.5) * 0.12 -
        voidPit * 0.35;

      let h = 0.5 + macroH + stoneH;

      // Wheel path slightly compacts & wears flat the highest stone peaks
      h = h * (1.0 - 0.12 * wheelPolish);

      // Tar snake fills voids and sits slightly proud (~1-2mm overband) with smooth surface
      if (tar > 0.001) {
        const tarSurfaceH = 0.56 + (nPatch(u, v) - 0.5) * 0.04 + (grit - 0.5) * 0.015;
        const tarBlend = smoothstep(0.0, 0.75, tar);
        h = h * (1.0 - tarBlend * 0.88) + tarSurfaceH * (tarBlend * 0.88);
      }

      // Open hairline cracks cut sharply downward
      if (crack > 0.001) {
        h -= crack * 0.55;
      }

      heightField[idx] = clamp(h, 0.0, 1.0);

      // 5. Albedo (sRGB values tuned for linear reflectance 0.12 - 0.18)
      // Linear 0.12 -> sRGB ~98; Linear 0.15 -> sRGB ~108; Linear 0.18 -> sRGB ~118
      const oxPatch = nPatch(u, v) * 0.6 + nMacro(u, v) * 0.4;

      // Oxidized grey asphalt binder base (sRGB ~92 - 106)
      let r = 93.0 + oxPatch * 14.0;
      let g = 94.0 + oxPatch * 14.0;
      let b = 97.0 + oxPatch * 15.0;

      // Aggregate chip mineral variety (crushed granite/limestone: light grey, warm quartz/tan, dark basalt)
      const mineralType = (f1 * 0.5 + m2 * 0.35 + stoneHueVar[idx] * 0.15);
      let chipR, chipG, chipB;
      if (mineralType > 0.66) {
        // Light grey / quartzite exposed chip
        chipR = 138.0 + grit * 20.0;
        chipG = 139.0 + grit * 20.0;
        chipB = 142.0 + grit * 22.0;
      } else if (mineralType > 0.36) {
        // Warm buff / granitic chip
        chipR = 132.0 + grit * 16.0;
        chipG = 126.0 + grit * 15.0;
        chipB = 118.0 + grit * 14.0;
      } else {
        // Dark grey basaltic / traprock chip
        chipR = 78.0 + grit * 12.0;
        chipG = 80.0 + grit * 12.0;
        chipB = 84.0 + grit * 13.0;
      }

      // Blend exposed aggregate chips into binder (wheel paths expose slightly more aggregate)
      const effectiveChip = clamp(chipExposure * (0.82 + 0.25 * wheelPolish), 0.0, 1.0);
      r = r * (1.0 - effectiveChip) + chipR * effectiveChip;
      g = g * (1.0 - effectiveChip) + chipG * effectiveChip;
      b = b * (1.0 - effectiveChip) + chipB * effectiveChip;

      // Darken inside small surface pits (micro ambient occlusion)
      const pitDarken = 1.0 - voidPit * 0.26;
      r *= pitDarken;
      g *= pitDarken;
      b *= pitDarken;

      // Subtle tire rubber darkening + oil stain mottling
      const stainDarken = 1.0 - wheelPolish * 0.05 - oilStain * 0.18;
      r *= stainDarken;
      g *= stainDarken * 0.99;
      b *= stainDarken * 0.97;

      // Tar snake sealant (dark bitumen brown-black, sRGB ~46-56)
      if (tar > 0.001) {
        const tarBlend = smoothstep(0.05, 0.65, tar);
        const tarR = 48.0 + grit * 6.0;
        const tarG = 47.0 + grit * 6.0;
        const tarB = 49.0 + grit * 6.0;
        r = r * (1.0 - tarBlend) + tarR * tarBlend;
        g = g * (1.0 - tarBlend) + tarG * tarBlend;
        b = b * (1.0 - tarBlend) + tarB * tarBlend;
      }

      // Open crack shadow (deep dark crevice)
      if (crack > 0.001) {
        const crackDark = 1.0 - crack * 0.65;
        r *= crackDark;
        g *= crackDark;
        b *= crackDark;
      }

      // Apply user color tint
      r = clamp(Math.round(r * tintR), 20, 235);
      g = clamp(Math.round(g * tintG), 20, 235);
      b = clamp(Math.round(b * tintB), 20, 235);

      const p4 = idx * 4;
      albedoData[p4] = r;
      albedoData[p4 + 1] = g;
      albedoData[p4 + 2] = b;
      albedoData[p4 + 3] = 255;

      // 6. Roughness Map (0.80 - 0.95 base, smoother 0.76 - 0.84 in polished wheel paths, 0.42 - 0.55 on tar snakes)
      let rough = 0.89 + (oxPatch - 0.5) * 0.06 + voidPit * 0.05 - effectiveChip * 0.04 + (grit - 0.5) * 0.04;
      // Polished wheel path along V
      rough -= wheelPolish * 0.085;
      // Oil stain slightly reduces roughness
      rough -= oilStain * 0.06;

      if (tar > 0.001) {
        const tarBlend = smoothstep(0.05, 0.65, tar);
        const tarRough = 0.46 + (grit - 0.5) * 0.06;
        rough = rough * (1.0 - tarBlend) + tarRough * tarBlend;
      }
      if (crack > 0.001) {
        rough = Math.min(0.98, rough + crack * 0.12);
      }

      const roughByte = clamp(Math.round(clamp(rough, 0.35, 0.98) * 255), 0, 255);
      roughData[p4] = roughByte;
      roughData[p4 + 1] = roughByte;
      roughData[p4 + 2] = roughByte;
      roughData[p4 + 3] = 255;
    }
  }

  // 7. Compute Tangent-Space Normal Map from periodic heightField using 3x3 Sobel filter
  const normalStrength = 3.2;
  for (let y = 0; y < N; y++) {
    const ym1 = ((y - 1) & mask) * N;
    const y0 = y * N;
    const yp1 = ((y + 1) & mask) * N;

    for (let x = 0; x < N; x++) {
      const xm1 = (x - 1) & mask;
      const x0 = x;
      const xp1 = (x + 1) & mask;

      const h00 = heightField[ym1 + xm1];
      const h10 = heightField[ym1 + x0];
      const h20 = heightField[ym1 + xp1];
      const h01 = heightField[y0 + xm1];
      const h21 = heightField[y0 + xp1];
      const h02 = heightField[yp1 + xm1];
      const h12 = heightField[yp1 + x0];
      const h22 = heightField[yp1 + xp1];

      const dX = (h20 + 2.0 * h21 + h22) - (h00 + 2.0 * h01 + h02);
      const dY = (h02 + 2.0 * h12 + h22) - (h00 + 2.0 * h10 + h20);

      let nx = -dX * normalStrength;
      let ny = -dY * normalStrength;
      let nz = 1.0;
      const invLen = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const p4 = (y0 + x0) * 4;
      normalData[p4] = clamp(Math.round((nx * 0.5 + 0.5) * 255), 0, 255);
      normalData[p4 + 1] = clamp(Math.round((ny * 0.5 + 0.5) * 255), 0, 255);
      normalData[p4 + 2] = clamp(Math.round((nz * 0.5 + 0.5) * 255), 128, 255);
      normalData[p4 + 3] = 255;
    }
  }

  const entry = { albedoData, normalData, roughData };
  _textureCache.set(cacheKey, entry);
  return entry;
}

function makeDataTexture(THREE, uint8Data, repeatVal, isSRGB) {
  const tex = new THREE.DataTexture(uint8Data, TEX_SIZE, TEX_SIZE, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatVal, repeatVal);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  if (isSRGB && THREE.SRGBColorSpace) {
    tex.colorSpace = THREE.SRGBColorSpace;
  } else if (!isSRGB && THREE.NoColorSpace) {
    tex.colorSpace = THREE.NoColorSpace;
  }
  tex.needsUpdate = true;
  return tex;
}

export default function create(THREE, opts = {}) {
  const tileMeters = (typeof opts.tileMeters === 'number' && opts.tileMeters > 0) ? opts.tileMeters : 4;
  const repeatVal = 1.0 / tileMeters;
  const seedKey = opts.seed ?? opts.id ?? 'argon_asphalt';

  // Default aged highway asphalt base colour (~0.14 linear albedo)
  const tintColor = new THREE.Color(opts.color ?? '#68696b');

  const { albedoData, normalData, roughData } = generateAsphaltMaps(THREE, seedKey, tintColor);

  const map = makeDataTexture(THREE, albedoData, repeatVal, true);
  const normalMap = makeDataTexture(THREE, normalData, repeatVal, false);
  const roughnessMap = makeDataTexture(THREE, roughData, repeatVal, false);

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, // Full texture fidelity (opts.color already baked into map)
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap,
    roughness: 1.0,  // Driven directly by roughnessMap (0.42 tar snakes .. 0.95 aged binder)
    metalness: 0.0
  });

  material.name = 'argon_asphalt';
  material.userData = {
    assetType: 'material',
    tileMeters,
    id: opts.id ?? 'road_surface_material'
  };

  return material;
}
