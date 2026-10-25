const _textureCache = new Map();

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str ?? 'argon_grass_default');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makePRNG(seedInt) {
  let s = (seedInt || 1) >>> 0;
  return function rand() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

// Fast periodic 2D grid noise sampled at integer lattice with period P (power of 2)
function createPeriodicGrid(period, rand) {
  const mask = period - 1;
  const data = new Float32Array(period * period);
  for (let i = 0; i < data.length; i++) {
    data[i] = rand();
  }
  return function sample(u, v) {
    const x = u * period;
    const y = v * period;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u0 = xf * xf * (3 - 2 * xf);
    const v0 = yf * yf * (3 - 2 * yf);
    const x0 = xi & mask;
    const x1 = (xi + 1) & mask;
    const y0 = (yi & mask) * period;
    const y1 = ((yi + 1) & mask) * period;
    const a = data[y0 + x0];
    const b = data[y0 + x1];
    const c = data[y1 + x0];
    const d = data[y1 + x1];
    return a + (b - a) * u0 + (c - a) * v0 + (a - b - c + d) * u0 * v0;
  };
}

function buildGrassMaps(THREE, seedKey, tintR, tintG, tintB) {
  const cached = _textureCache.get(seedKey);
  if (cached) return cached;

  const SIZE = 1024;
  const MASK = SIZE - 1;
  const N = SIZE * SIZE;

  const rand = makePRNG(hashSeed(seedKey));

  // Periodic multi-scale noise grids (periods must be powers of 2 for seamless tiling)
  const nMacro1 = createPeriodicGrid(4, rand);
  const nMacro2 = createPeriodicGrid(8, rand);
  const nPatch1 = createPeriodicGrid(16, rand);
  const nPatch2 = createPeriodicGrid(32, rand);
  const nClump1 = createPeriodicGrid(64, rand);
  const nClump2 = createPeriodicGrid(128, rand);
  const nGrain  = createPeriodicGrid(256, rand);

  // Working buffers
  const rBuf = new Float32Array(N);
  const gBuf = new Float32Array(N);
  const bBuf = new Float32Array(N);
  const hBuf = new Float32Array(N);
  const roughBuf = new Float32Array(N);

  // Colour palette (linear-ish working values in 0..255 sRGB space for direct control)
  // 1. Sandy Florida soil / organic humus
  const soilR = 116, soilG = 101, soilB = 78;
  // 2. Dry dormant bahia / sun-bleached straw thatch
  const dryR = 164, dryG = 144, dryB = 86;
  // 3. Deep St. Augustine blue-green lush base
  const darkR = 46, darkG = 78, darkB = 34;
  // 4. Mid Bahia summer roadside green
  const midR = 76, midG = 112, midB = 42;
  // 5. Sunlit yellow-green young shoots / bahia blades
  const yelR = 118, yelG = 142, yelB = 50;

  const invSize = 1 / SIZE;

  // Pass 1: Continuous periodic field (macro patches, soil peek-through, thatch, mowing band)
  for (let y = 0; y < SIZE; y++) {
    const v = y * invSize;
    // Subtle diagonal mower track wave (2 passes per 3m tile -> 1.5m deck width)
    const mowAngle = (v * 2.0) * Math.PI * 2.0;
    const mowWaveBase = Math.sin(mowAngle);

    const rowOffset = y * SIZE;
    for (let x = 0; x < SIZE; x++) {
      const u = x * invSize;
      const idx = rowOffset + x;

      // Domain warp for natural non-grid shapes (periodic because sin(2*pi*u) is periodic)
      const wu = u + (nMacro2(u, v) - 0.5) * 0.08 + (nPatch1(u, v) - 0.5) * 0.03;
      const wv = v + (nMacro2(u + 0.37, v + 0.61) - 0.5) * 0.08 + (nPatch1(u + 0.23, v + 0.19) - 0.5) * 0.03;

      const m1 = nMacro1(wu, wv);
      const m2 = nMacro2(wu, wv);
      const p1 = nPatch1(wu, wv);
      const p2 = nPatch2(u, v);
      const c1 = nClump1(u, v);
      const c2 = nClump2(u, v);
      const gr = nGrain(u, v);

      // Moisture / lushness index (large scale 1–3m)
      const lushness = clamp01(m1 * 0.52 + m2 * 0.30 + p1 * 0.18);
      // Sun-bleached / yellow-green variation
      const sunTone = clamp01(m2 * 0.45 + p1 * 0.35 + c1 * 0.20);
      // Dry straw patch mask
      const dryRaw = (1.0 - lushness) * 0.58 + p2 * 0.27 + c1 * 0.15;
      const dryMask = smoothstep(0.56, 0.78, dryRaw);
      // Bare sandy soil mask (shows in sparse dry depressions)
      const soilRaw = (1.0 - lushness) * 0.48 + (1.0 - p1) * 0.32 + (1.0 - c1) * 0.20;
      const soilMask = smoothstep(0.68, 0.84, soilRaw);

      // Subtle mower stripe (broken up by clump noise so it's never mechanical)
      const mowStripe = Math.sin(mowAngle + (u * 1.0) * Math.PI * 2.0 + (p1 - 0.5) * 2.2) * 0.5 + 0.5;
      const mowFactor = (mowStripe - 0.5) * 0.07 * (1.0 - soilMask);

      // Blend base greens
      const gBlend = smoothstep(0.25, 0.75, lushness);
      let r = darkR * gBlend + midR * (1 - gBlend);
      let g = darkG * gBlend + midG * (1 - gBlend);
      let b = darkB * gBlend + midB * (1 - gBlend);

      // Mix in yellow-green bahia highlights
      const yMix = smoothstep(0.38, 0.78, sunTone) * 0.55;
      r = r * (1 - yMix) + yelR * yMix;
      g = g * (1 - yMix) + yelG * yMix;
      b = b * (1 - yMix) + yelB * yMix;

      // Clump-scale shading (dark between stolon clumps, brighter on crowns)
      const clumpCrown = (c1 * 0.6 + c2 * 0.4);
      const crownShade = 0.78 + clumpCrown * 0.38 + mowFactor;
      r *= crownShade;
      g *= crownShade;
      b *= crownShade;

      // Blend dry straw thatch patches
      if (dryMask > 0.001) {
        const thatchTex = 0.86 + (c2 - 0.5) * 0.28 + (gr - 0.5) * 0.16;
        r = r * (1 - dryMask) + (dryR * thatchTex) * dryMask;
        g = g * (1 - dryMask) + (dryG * thatchTex) * dryMask;
        b = b * (1 - dryMask) + (dryB * thatchTex) * dryMask;
      }

      // Blend sandy soil specks & patches
      if (soilMask > 0.001) {
        // Quartz sand speckle in soil
        const sandSpeck = (gr > 0.72 ? 1.18 : 0.92) + (c2 - 0.5) * 0.15;
        r = r * (1 - soilMask) + (soilR * sandSpeck) * soilMask;
        g = g * (1 - soilMask) + (soilG * sandSpeck) * soilMask;
        b = b * (1 - soilMask) + (soilB * sandSpeck) * soilMask;
      }

      // Micro-grain organic modulation
      const micro = 0.93 + (gr - 0.5) * 0.14;
      rBuf[idx] = r * micro;
      gBuf[idx] = g * micro;
      bBuf[idx] = b * micro;

      // Base height: soil is lowest, dry thatch low-mid, lush turf clumps higher
      const turfH = (0.35 + clumpCrown * 0.45 + p2 * 0.20) * (1.0 - soilMask * 0.65) * (1.0 - dryMask * 0.22);
      hBuf[idx] = turfH + (gr - 0.5) * 0.06 + mowWaveBase * 0.015;

      // Roughness: sandy soil ~0.96, dry straw ~0.94, lush waxy St. Augustine blades ~0.87
      roughBuf[idx] = 0.90 + soilMask * 0.07 + dryMask * 0.04 - lushness * 0.03 + (gr - 0.5) * 0.04;
    }
  }

  // Pass 2: Stamp wrapped individual grass blades, stolons, dry straw stems, and clover/weed rosettes
  // At 1024px = 3.0m, 1 pixel = 2.93mm.
  // St. Augustine / Bahia blades are 4–9mm wide (1.5–3px) and 25–65mm long (8–22px).

  // Helper to splat a soft pixel with seamless wrap
  function blendPixel(px, py, alpha, cr, cg, cb, dh, dRough) {
    const wx = px & MASK;
    const wy = py & MASK;
    const idx = wy * SIZE + wx;
    const invA = 1.0 - alpha;
    rBuf[idx] = rBuf[idx] * invA + cr * alpha;
    gBuf[idx] = gBuf[idx] * invA + cg * alpha;
    bBuf[idx] = bBuf[idx] * invA + cb * alpha;
    hBuf[idx] = Math.max(hBuf[idx], hBuf[idx] * invA + dh * alpha);
    roughBuf[idx] = roughBuf[idx] * invA + dRough * alpha;
  }

  // 2A: 24,000 grass blades (clumped along stolon runners + scattered)
  const NUM_BLADES = 24000;
  for (let i = 0; i < NUM_BLADES; i++) {
    const cx = rand() * SIZE;
    const cy = rand() * SIZE;
    const sampleIdx = ((cy | 0) & MASK) * SIZE + ((cx | 0) & MASK);

    // Check local height/soil so we don't put dense green blades in the middle of bare sand
    const baseH = hBuf[sampleIdx];
    const isSparse = baseH < 0.28;
    if (isSparse && rand() < 0.72) continue;

    // Decide if this blade is dry straw thatch or live green blade
    const isDryBlade = (rBuf[sampleIdx] > gBuf[sampleIdx] * 0.98) ? (rand() < 0.65) : (rand() < 0.14);

    // Blade geometry in pixels
    const len = isDryBlade ? (7 + rand() * 13) : (8 + rand() * 14);
    const angle = rand() * Math.PI * 2;
    const curve = (rand() - 0.5) * 0.35; // slight blade bend
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const nx = -dy;
    const ny = dx;

    let br, bg, bb, bRough, bHeightPeak;
    if (isDryBlade) {
      const shade = 0.85 + rand() * 0.30;
      br = 168 * shade;
      bg = 148 * shade;
      bb = 88 * shade;
      bRough = 0.95;
      bHeightPeak = baseH + 0.18 + rand() * 0.12;
    } else {
      // Mix between dark blue-green, mid green, and bright yellow-green bahia
      const tone = rand();
      const shade = 0.82 + rand() * 0.36;
      if (tone < 0.32) {
        br = 44 * shade; bg = 82 * shade; bb = 32 * shade;
      } else if (tone < 0.72) {
        br = 78 * shade; bg = 118 * shade; bb = 42 * shade;
      } else {
        br = 122 * shade; bg = 148 * shade; bb = 48 * shade;
      }
      bRough = 0.85 + rand() * 0.06;
      bHeightPeak = baseH + 0.25 + rand() * 0.28;
    }

    // Dark ambient occlusion shadow at the root/side of the blade
    const steps = Math.ceil(len);
    const invSteps = 1 / steps;
    for (let s = 0; s <= steps; s++) {
      const t = s * invSteps; // 0 = root, 1 = cut/tapered tip
      const bendOffset = (t * t) * curve * len;
      const px = cx + dx * (t * len) + nx * bendOffset;
      const py = cy + dy * (t * len) + ny * bendOffset;

      // Blade profile along length: dark at root, brightest near upper middle
      const tipTaper = 1.0 - t * 0.65;
      const lightGrad = 0.72 + 0.42 * Math.sin(t * Math.PI * 0.85);
      const hVal = baseH + (bHeightPeak - baseH) * Math.sin(t * Math.PI * 0.9);

      const ix = Math.round(px);
      const iy = Math.round(py);

      // Center spine of blade
      blendPixel(
        ix, iy,
        0.68 * tipTaper,
        br * lightGrad,
        bg * lightGrad,
        bb * lightGrad,
        hVal,
        bRough
      );

      // Broad St. Augustine blade width (1px flank on one side, shadow on opposite)
      if (t < 0.8) {
        const sx = Math.round(px + nx * 0.9);
        const sy = Math.round(py + ny * 0.9);
        blendPixel(
          sx, sy,
          0.35 * tipTaper,
          br * lightGrad * 0.92,
          bg * lightGrad * 0.92,
          bb * lightGrad * 0.92,
          hVal * 0.92,
          bRough
        );

        // Micro contact shadow under blade edge
        const shx = Math.round(px - nx * 1.0);
        const shy = Math.round(py - ny * 1.0);
        const shIdx = ((shy & MASK) * SIZE) + (shx & MASK);
        rBuf[shIdx] *= 0.94;
        gBuf[shIdx] *= 0.94;
        bBuf[shIdx] *= 0.94;
        hBuf[shIdx] *= 0.96;
      }
    }
  }

  // 2B: Scattered clover clusters, dollarweed pads, and tiny white/yellow roadside weed dots
  const NUM_CLOVER_PATCHES = 85;
  for (let p = 0; p < NUM_CLOVER_PATCHES; p++) {
    const patchX = rand() * SIZE;
    const patchY = rand() * SIZE;
    const numLeaves = 6 + ((rand() * 14) | 0);
    const patchRadius = 8 + rand() * 22;

    for (let l = 0; l < numLeaves; l++) {
      const a = rand() * Math.PI * 2;
      const dist = rand() * patchRadius;
      const lx = patchX + Math.cos(a) * dist;
      const ly = patchY + Math.sin(a) * dist;

      // 3 trifoliate leaflets per clover stem
      const baseAngle = rand() * Math.PI * 2;
      const leafShade = 0.85 + rand() * 0.25;
      const cr = 54 * leafShade;
      const cg = 98 * leafShade;
      const cb = 42 * leafShade;

      for (let f = 0; f < 3; f++) {
        const fa = baseAngle + f * ((Math.PI * 2) / 3) + (rand() - 0.5) * 0.25;
        const fx = Math.round(lx + Math.cos(fa) * 2.2);
        const fy = Math.round(ly + Math.sin(fa) * 2.2);

        // Draw a tiny 3x3 rounded leaflet with pale chevron center
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const d2 = ox * ox + oy * oy;
            if (d2 > 2) continue;
            const isCenter = d2 === 0;
            const chevron = isCenter ? 1.18 : 0.95;
            blendPixel(
              fx + ox,
              fy + oy,
              isCenter ? 0.75 : 0.45,
              cr * chevron,
              cg * chevron,
              cb * chevron,
              0.82,
              0.86
            );
          }
        }
      }
    }

    // Occasional tiny white clover blossom or yellow dandelion/oxalis speck in the patch
    if (rand() < 0.42) {
      const bx = Math.round(patchX + (rand() - 0.5) * patchRadius * 0.8);
      const by = Math.round(patchY + (rand() - 0.5) * patchRadius * 0.8);
      const isYellow = rand() < 0.35;
      const wr = isYellow ? 215 : 218;
      const wg = isYellow ? 188 : 216;
      const wb = isYellow ? 58  : 198;
      blendPixel(bx, by, 0.80, wr, wg, wb, 0.92, 0.88);
      blendPixel(bx + 1, by, 0.45, wr * 0.9, wg * 0.9, wb * 0.9, 0.88, 0.88);
      blendPixel(bx, by + 1, 0.45, wr * 0.9, wg * 0.9, wb * 0.9, 0.88, 0.88);
    }
  }

  // Pass 3: Encode RGBA Albedo, Tangent-Space Normal Map, and Roughness Map
  const albedoData = new Uint8Array(N * 4);
  const normalData = new Uint8Array(N * 4);
  const roughData  = new Uint8Array(N * 4);

  const normalStrength = 5.5; // sharp blade/clump relief

  for (let y = 0; y < SIZE; y++) {
    const yUp = ((y - 1) & MASK) * SIZE;
    const yDn = ((y + 1) & MASK) * SIZE;
    const yRow = y * SIZE;

    for (let x = 0; x < SIZE; x++) {
      const idx = yRow + x;
      const p4 = idx * 4;

      // Apply user colour tint multiplier (normalized around default mid-grass colour)
      const r = clampByte(rBuf[idx] * tintR);
      const g = clampByte(gBuf[idx] * tintG);
      const b = clampByte(bBuf[idx] * tintB);

      albedoData[p4]     = r;
      albedoData[p4 + 1] = g;
      albedoData[p4 + 2] = b;
      albedoData[p4 + 3] = 255;

      // Sobel / central-difference normal from periodic height buffer
      const xLt = (x - 1) & MASK;
      const xRt = (x + 1) & MASK;

      const hL  = hBuf[yRow + xLt];
      const hR  = hBuf[yRow + xRt];
      const hU  = hBuf[yUp + x];
      const hD  = hBuf[yDn + x];
      const hUL = hBuf[yUp + xLt];
      const hUR = hBuf[yUp + xRt];
      const hDL = hBuf[yDn + xLt];
      const hDR = hBuf[yDn + xRt];

      const dX = ((hR - hL) * 2.0 + (hUR - hUL) + (hDR - hDL)) * 0.25 * normalStrength;
      const dY = ((hD - hU) * 2.0 + (hDL - hUL) + (hDR - hUR)) * 0.25 * normalStrength;

      const nx = -dX;
      const ny = -dY;
      const nz = 1.0;
      const invLen = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);

      normalData[p4]     = clampByte((nx * invLen * 0.5 + 0.5) * 255);
      normalData[p4 + 1] = clampByte((ny * invLen * 0.5 + 0.5) * 255);
      normalData[p4 + 2] = clampByte((nz * invLen * 0.5 + 0.5) * 255);
      normalData[p4 + 3] = 255;

      // Roughness in ~0.85..1.0 range (G channel read by Three.js roughnessMap)
      const rVal = clampByte(clamp01(roughBuf[idx]) * 255);
      roughData[p4]     = rVal;
      roughData[p4 + 1] = rVal;
      roughData[p4 + 2] = rVal;
      roughData[p4 + 3] = 255;
    }
  }

  function makeTex(data, isSRGB) {
    const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    if (isSRGB && 'SRGBColorSpace' in THREE) {
      tex.colorSpace = THREE.SRGBColorSpace;
    } else if (!isSRGB && 'NoColorSpace' in THREE) {
      tex.colorSpace = THREE.NoColorSpace;
    }
    tex.needsUpdate = true;
    return tex;
  }

  const maps = {
    map: makeTex(albedoData, true),
    normalMap: makeTex(normalData, false),
    roughnessMap: makeTex(roughData, false)
  };

  _textureCache.set(seedKey, maps);
  return maps;
}

export default function create(THREE, opts = {}) {
  const tileMeters = (typeof opts.tileMeters === 'number' && opts.tileMeters > 0) ? opts.tileMeters : 3;
  const repeat = 1 / tileMeters;

  // Default real-world Florida Bahia / St. Augustine summer turf colour
  const defaultColorHex = 0x567432;
  const baseColor = new THREE.Color(opts.color !== undefined ? opts.color : defaultColorHex);
  const refColor = new THREE.Color(defaultColorHex);

  // Compute gentle relative tint ratios so custom opts.color shifts the palette naturally
  // while default opts.color produces the exact calibrated turf palette
  const tintR = refColor.r > 0.001 ? clamp01(baseColor.r / refColor.r * 0.5) * 2.0 : 1.0;
  const tintG = refColor.g > 0.001 ? clamp01(baseColor.g / refColor.g * 0.5) * 2.0 : 1.0;
  const tintB = refColor.b > 0.001 ? clamp01(baseColor.b / refColor.b * 0.5) * 2.0 : 1.0;

  const seed = opts.seed ?? opts.id ?? 'florida_bahia_verge_v1';
  const cacheKey = `${seed}_${tintR.toFixed(3)}_${tintG.toFixed(3)}_${tintB.toFixed(3)}`;

  const sharedMaps = buildGrassMaps(THREE, cacheKey, tintR, tintG, tintB);

  // Clone texture handles if tileMeters differs from cached repeat, or set repeat directly
  const map = sharedMaps.map.clone();
  map.needsUpdate = true;
  map.repeat.set(repeat, repeat);
  map.anisotropy = 8;

  const normalMap = sharedMaps.normalMap.clone();
  normalMap.needsUpdate = true;
  normalMap.repeat.set(repeat, repeat);
  normalMap.anisotropy = 8;

  const roughnessMap = sharedMaps.roughnessMap.clone();
  roughnessMap.needsUpdate = true;
  roughnessMap.repeat.set(repeat, repeat);
  roughnessMap.anisotropy = 8;

  const material = new THREE.MeshStandardMaterial({
    name: 'argon_grass',
    color: new THREE.Color(0xffffff),
    map,
    normalMap,
    normalScale: new THREE.Vector2(1.15, 1.15),
    roughnessMap,
    roughness: 0.95,
    metalness: 0.0
  });

  material.name = 'argon_grass';
  material.userData = {
    assetType: 'material',
    tileMeters,
    id: opts.id ?? 'argon_grass'
  };

  return material;
}
