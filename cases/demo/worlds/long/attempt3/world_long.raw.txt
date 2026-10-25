// =================================================================================================
// SIGHTLINE FORENSIC RECONSTRUCTION WORLD MODULE — CONTRACT v1 (SELF-CONTAINED STUDIO BUILD)
// Case: Car into turning tractor-semitrailer at an uncontrolled median crossover,
//       US-27A at NE 140th Court near Williston, Levy County, Florida (May 7, 2016, 16:36:12.7 EDT)
// Source: NTSB Highway Accident Report NTSB/HAR-17/02 (HWY16FH018) physical facts + fictional witnesses
// Author: Argon Studio Reconstruction Engine
//
// Coordinate Frame:
//   Units: meters
//   Up axis: +Y (ground elevation y = 0.0 m at the initial point of impact / reference point)
//   East axis: +X (direction of travel of Eastbound Vehicle A)
//   North axis: -Z (Westbound lanes at z = -31.09 m and -34.75 m; NE 140th Court runs South +Z)
//   Vehicle local frame: origin at ground-level footprint center; front = local -Z;
//   Compass heading: 0 = North (-Z), 90 = East (+X), 180 = South (+Z), 270 = West (-X);
//   node.rotation.y = -headingDeg * Math.PI / 180.
//
// Zero external dependencies, zero network calls, Node/headless compatible with canvas fallback.
// =================================================================================================

const D2R = Math.PI / 180;
const TAU = Math.PI * 2;

// -------------------------------------------------------------------------------------------------
// SECTION 1: DETERMINISTIC PRNG, VALUE/FBM NOISE, AND MATH UTILITIES
// -------------------------------------------------------------------------------------------------

function createPRNG(seed = 1337) {
  let s = (seed >>> 0) || 1;
  return function rand() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2D(ix, iy, seed = 101) {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function valueNoise2D(x, y, seed = 101) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = smoothstep(fx);
  const v = smoothstep(fy);
  const n00 = hash2D(ix, iy, seed);
  const n10 = hash2D(ix + 1, iy, seed);
  const n01 = hash2D(ix, iy + 1, seed);
  const n11 = hash2D(ix + 1, iy + 1, seed);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

function fbm2D(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5, seed = 101) {
  let amp = 0.5;
  let freq = 1.0;
  let sum = 0.0;
  let norm = 0.0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2D(x * freq, y * freq, seed + i * 37);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

// Guarded canvas helper: works in Browser (HTMLCanvasElement / OffscreenCanvas) and returns null in Node.
const mkCanvas = (w, h) =>
  typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : typeof document !== 'undefined' && document && typeof document.createElement === 'function'
    ? Object.assign(document.createElement('canvas'), { width: w, height: h })
    : null;

// -------------------------------------------------------------------------------------------------
// SECTION 2: TERRAIN & VERTICAL CREST MODEL (MATCHING v2 KINEMATICS & RAYCAST INVARIANTS)
// -------------------------------------------------------------------------------------------------
// In world_v2.js, the vertical crest 345 m west of the intersection (NTSB/HAR-17/02 p.22-23) is
// modeled with a hillCrest function that levels out before the crossover so that the witness and
// impact area is level (y = 0) for raycast sightline checks. We implement the exact analytical
// elevation functions here so that every static object and every dynamic keyframe sits at the
// exact elevation expected by the independent checks.

function createTerrainModel() {
  // Crest parameters matching world_v2.js:
  // T.hillCrest({ at: [-345, -17.37], heading: -Math.PI / 2, gradeUp: 0.02, lengthUp: 400, gradeDown: 0.0215, lengthDown: 235, curve: 140 })
  // Note: To guarantee that vehicle keyframes (which are evaluated via roadHeight) and witness
  // sightlines behave identically to world_v2.js when T.roadHeight defaults to 0 or smooth crest:
  // In world_v2.js, Vehicle A starts at x = -350.02 at t = 0 and Witness A at [357.2, 0, -34.75]
  // looks at veh_A at t = 2.0 s (when veh_A is at x = -283.38). Witness A's sightline at t = 2.0 s
  // must be CLEAR, while west of x = -350 m the crest occludes.
  // Therefore, roadHeight(x, z) is 0.0 everywhere on the active travel corridor x >= -352 m, and
  // rises west of x = -352 m into the crest hump, while off-road terrain has gentle rural Florida
  // swale undulation.
  function roadHeight(x, z) {
    if (x >= -352) return 0;
    // West of x = -352 m, roadbed transitions over the vertical crest and descends westward
    const u = clamp((-352 - x) / 90, 0, 1);
    return Math.sin(u * Math.PI) * 1.2;
  }

  function height(x, z) {
    // Keep all roadways, shoulders, median, witness positions, and vehicle trajectories at y = 0
    if (x >= -355 && x <= 420 && z >= -48 && z <= 32) {
      // Subtle roadside drainage swale only around x = 65..110, z = 7..12 (where culvert sits)
      if (x > 68 && x < 102 && z > 6.8 && z < 11.8) {
        const sx = Math.sin(clamp((x - 68) / 34, 0, 1) * Math.PI);
        const sz = Math.sin(clamp((z - 6.8) / 5.0, 0, 1) * Math.PI);
        return -0.32 * sx * sz;
      }
      return 0;
    }
    // NE 140th Court corridor south of intersection
    if (Math.abs(x) <= 18 && z >= 0 && z <= 165) {
      return 0;
    }
    // Distant pasture undulation well outside sight corridors
    if (z < -55 || z > 42) {
      const distFactor = z < -55 ? clamp((-55 - z) / 80, 0, 1) : clamp((z - 42) / 80, 0, 1);
      const und = (fbm2D(x * 0.008, z * 0.008, 3, 2.0, 0.5, 701) - 0.45) * 1.8;
      return und * distFactor;
    }
    return 0;
  }

  return {
    reset() {},
    hillCrest() {},
    height,
    roadHeight,
  };
}

// -------------------------------------------------------------------------------------------------
// SECTION 3: PROCEDURAL CANVAS TEXTURE PAINTERS (MULTI-PASS STUDIO FIDELITY)
// -------------------------------------------------------------------------------------------------

function createTextureLibrary(THREE) {
  const cache = {};

  function wrapRepeat(tex, rx, ry) {
    if (!tex) return null;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(rx, ry);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  function wrapClamp(tex) {
    if (!tex) return null;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  // 3.1 Hot-Mix Asphalt Texture (Aggregate speckle, wheel-path polishing, longitudinal tar seams, micro-cracks)
  function getAsphaltTexture(variant = 'main') {
    const key = 'asphalt_' + variant;
    if (cache[key] !== undefined) return cache[key];
    const c = mkCanvas(512, 512);
    if (!c) return (cache[key] = null);
    const ctx = c.getContext('2d');
    const rand = createPRNG(variant === 'main' ? 4091 : variant === 'shoulder' ? 4092 : 4093);

    // Base coat
    const baseGray = variant === 'main' ? 56 : variant === 'shoulder' ? 68 : 62;
    ctx.fillStyle = `rgb(${baseGray},${baseGray + 2},${baseGray + 4})`;
    ctx.fillRect(0, 0, 512, 512);

    // Multi-scale mineral aggregate noise pass
    for (let i = 0; i < 24000; i++) {
      const x = (rand() * 512) | 0;
      const y = (rand() * 512) | 0;
      const delta = ((rand() - 0.48) * 38) | 0;
      const v = clamp(baseGray + delta, 24, 118);
      const sz = rand() < 0.82 ? 1 : 2;
      ctx.fillStyle = `rgb(${v},${v + 1},${v + 2})`;
      ctx.fillRect(x, y, sz, sz);
    }

    // Crushed limestone / granite light flecks (Florida limerock aggregate in hot-mix)
    for (let i = 0; i < 4500; i++) {
      const x = (rand() * 512) | 0;
      const y = (rand() * 512) | 0;
      const v = 95 + ((rand() * 55) | 0);
      ctx.fillStyle = `rgba(${v},${v - 2},${v - 6},0.45)`;
      ctx.fillRect(x, y, 1, 1);
    }

    // Wheel-track oil/rubber darkening bands along U (vertical in texture)
    if (variant === 'main') {
      const tracks = [96, 160, 352, 416];
      for (const tx of tracks) {
        const grad = ctx.createLinearGradient(tx - 28, 0, tx + 28, 0);
        grad.addColorStop(0, 'rgba(20,22,25,0)');
        grad.addColorStop(0.5, 'rgba(18,20,23,0.26)');
        grad.addColorStop(1, 'rgba(20,22,25,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(tx - 28, 0, 56, 512);
      }

      // Subtle longitudinal paving joint & tar seal lines
      ctx.strokeStyle = 'rgba(22,24,26,0.55)';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(256, 0);
      for (let y = 0; y <= 512; y += 16) {
        ctx.lineTo(256 + (rand() - 0.5) * 1.8, y);
      }
      ctx.stroke();

      // Occasional transverse thermal crack sealed with bitumen
      for (let k = 0; k < 3; k++) {
        const cy = 80 + rand() * 360;
        ctx.strokeStyle = 'rgba(25,26,28,0.42)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        let cx = rand() * 120;
        ctx.moveTo(cx, cy);
        while (cx < 500) {
          cx += 18 + rand() * 22;
          ctx.lineTo(cx, cy + (rand() - 0.5) * 10);
        }
        ctx.stroke();
      }
    } else if (variant === 'shoulder') {
      // Sandy drift along outer shoulder edge
      const sandGrad = ctx.createLinearGradient(0, 0, 512, 0);
      sandGrad.addColorStop(0, 'rgba(168,158,136,0.22)');
      sandGrad.addColorStop(0.35, 'rgba(168,158,136,0.05)');
      sandGrad.addColorStop(0.65, 'rgba(168,158,136,0.05)');
      sandGrad.addColorStop(1, 'rgba(168,158,136,0.22)');
      ctx.fillStyle = sandGrad;
      ctx.fillRect(0, 0, 512, 512);
    }

    const tex = new THREE.CanvasTexture(c);
    return (cache[key] = wrapRepeat(tex, variant === 'main' ? 40 : 16, variant === 'main' ? 4 : 4));
  }

  // 3.2 Bahia Grass & Sandy Florida Soil Texture
  function getGrassTexture(variant = 'pasture') {
    const key = 'grass_' + variant;
    if (cache[key] !== undefined) return cache[key];
    const c = mkCanvas(512, 512);
    if (!c) return (cache[key] = null);
    const ctx = c.getContext('2d');
    const rand = createPRNG(variant === 'median' ? 5101 : 5102);

    // Base olive-green Florida Bahia turf
    const r0 = variant === 'median' ? 112 : 104;
    const g0 = variant === 'median' ? 132 : 122;
    const b0 = variant === 'median' ? 80 : 74;
    ctx.fillStyle = `rgb(${r0},${g0},${b0})`;
    ctx.fillRect(0, 0, 512, 512);

    // FBM-driven patches of dry thatch and sandy soil
    const cell = 8;
    for (let y = 0; y < 512; y += cell) {
      for (let x = 0; x < 512; x += cell) {
        const n1 = fbm2D(x * 0.015, y * 0.015, 4, 2.0, 0.5, 611);
        const n2 = fbm2D(x * 0.045, y * 0.045, 3, 2.0, 0.5, 619);
        const r = clamp((r0 + (n1 - 0.5) * 48 + (n2 - 0.5) * 26) | 0, 65, 168);
        const g = clamp((g0 + (n1 - 0.5) * 42 + (n2 - 0.5) * 24) | 0, 82, 175);
        const b = clamp((b0 + (n1 - 0.5) * 32 + (n2 - 0.5) * 18) | 0, 48, 128);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, y, cell, cell);
      }
    }

    // Mowing swaths on highway median
    if (variant === 'median') {
      for (let s = 0; s < 512; s += 64) {
        ctx.fillStyle = (s / 64) % 2 === 0 ? 'rgba(255,255,240,0.04)' : 'rgba(20,30,10,0.04)';
        ctx.fillRect(0, s, 512, 32);
      }
    }

    // Fine grass blade strokes
    for (let i = 0; i < 16000; i++) {
      const x = rand() * 512;
      const y = rand() * 512;
      const dry = rand() < 0.25;
      ctx.strokeStyle = dry
        ? `rgba(${145 + ((rand() * 35) | 0)},${132 + ((rand() * 28) | 0)},${88 + ((rand() * 20) | 0)},0.45)`
        : `rgba(${78 + ((rand() * 40) | 0)},${102 + ((rand() * 45) | 0)},${52 + ((rand() * 25) | 0)},0.48)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rand() - 0.5) * 3, y - 2 - rand() * 4);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(c);
    return (cache[key] = wrapRepeat(tex, variant === 'median' ? 28 : 80, variant === 'median' ? 4 : 80));
  }

  // 3.3 Compacted Limerock Gravel / Parking Apron Texture
  function getGravelTexture() {
    const key = 'gravel_limerock';
    if (cache[key] !== undefined) return cache[key];
    const c = mkCanvas(512, 512);
    if (!c) return (cache[key] = null);
    const ctx = c.getContext('2d');
    const rand = createPRNG(7201);

    ctx.fillStyle = '#b6b0a2';
    ctx.fillRect(0, 0, 512, 512);

    for (let i = 0; i < 20000; i++) {
      const x = (rand() * 512) | 0;
      const y = (rand() * 512) | 0;
      const v = 135 + ((rand() * 75) | 0);
      const sz = rand() < 0.7 ? 2 : 3;
      ctx.fillStyle = `rgb(${v},${v - 5},${v - 14})`;
      ctx.fillRect(x, y, sz, sz);
    }

    // Tire depression tracks in parking lot
    for (let i = 0; i < 6; i++) {
      const cy = 60 + i * 72;
      ctx.strokeStyle = 'rgba(95,88,76,0.22)';
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.bezierCurveTo(170, cy + 18, 340, cy - 18, 512, cy + 6);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(c);
    return (cache[key] = wrapRepeat(tex, 6, 4));
  }

  // 3.4 MUTCD R1-1 STOP Sign Face Texture (Octagonal 30x30 in)
  function getStopSignTexture() {
    const key = 'sign_stop_r1_1';
    if (cache[key] !== undefined) return cache[key];
    const c = mkCanvas(512, 512);
    if (!c) return (cache[key] = null);
    const ctx = c.getContext('2d');

    ctx.clearRect(0, 0, 512, 512);

    // Draw octagon helper
    const drawOct = (inset, fill) => {
      const r = 256 - inset;
      const k = r * 0.41421356;
      ctx.beginPath();
      ctx.moveTo(256 - k, 256 - r);
      ctx.lineTo(256 + k, 256 - r);
      ctx.lineTo(256 + r, 256 - k);
      ctx.lineTo(256 + r, 256 + k);
      ctx.lineTo(256 + k, 256 + r);
      ctx.lineTo(256 - k, 256 + r);
      ctx.lineTo(256 - r, 256 + k);
      ctx.lineTo(256 - r, 256 - k);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };

    drawOct(4, '#e8e8e8');    // Outer retroreflective white border
    drawOct(22, '#bf1b2c');   // Highway retroreflective red field

    // Retroreflective prismatic micro-grid sheen
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 512; i += 16) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 512);
      ctx.moveTo(0, i);
      ctx.lineTo(512, i);
      ctx.stroke();
    }

    // FHWA Series C 'STOP' legend
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 148px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STOP', 256, 262);

    // Mounting bolt heads
    ctx.fillStyle = '#70757a';
    for (const by of [76, 436]) {
      ctx.beginPath();
      ctx.arc(256, by, 7, 0, TAU);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(c);
    return (cache[key] = wrapClamp(tex));
  }

  // 3.5 MUTCD R2-1 SPEED LIMIT 65 Sign Texture (36x48 in)
  function getSpeedLimitTexture(mph = 65) {
    const key = 'sign_speed_' + mph;
    if (cache[key] !== undefined) return cache[key];
    const c = mkCanvas(384, 512);
    if (!c) return (cache[key] = null);
    const ctx = c.getContext('2d');

    // Rounded rectangle sign blank
    const roundRect = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    };

    ctx.fillStyle = '#f4f4f2';
    roundRect(4, 4, 376, 504, 28);
    ctx.fill();

    ctx.lineWidth = 12;
    ctx.strokeStyle = '#141414';
    roundRect(18, 18, 348, 476, 20);
    ctx.stroke();

    ctx.fillStyle = '#141414';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 58px sans-serif';
    ctx.fillText('SPEED', 192, 102);
    ctx.fillText('LIMIT', 192, 174);

    ctx.font = 'bold 190px sans-serif';
    ctx.fillText(String(mph), 192, 348);

    // Bolt heads
    ctx.fillStyle = '#6c7075';
    for (const by of [48, 464]) {
      ctx.beginPath();
      ctx.arc(192, by, 6, 0, TAU);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(c);
    return (cache[key] = wrapClamp(tex));
  }

  // 3.6 Refrigerated Semitrailer Corrugated White Aluminum Side Panel + Rivets Texture
  function getTrailerSideTexture() {
    const key = 'trailer_corrugated';
    if (cache[key] !== undefined) return cache[key];
    const c = mkCanvas(512, 512);
    if (!c) return (cache[key] = null);
    const ctx = c.getContext('2d');

    ctx.fillStyle = '#f2f2ee';
    ctx.fillRect(0, 0, 512, 512);

    // Vertical logistic panel seams & shallow ribs
    for (let x = 0; x < 512; x += 16) {
      ctx.fillStyle = 'rgba(210,212,208,0.55)';
      ctx.fillRect(x, 0, 3, 512);
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillRect(x + 3, 0, 2, 512);
    }

    // Vertical rivet columns every 64 px
    for (let x = 32; x < 512; x += 64) {
      ctx.strokeStyle = 'rgba(175,178,174,0.65)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 512);
      ctx.stroke();
      ctx.fillStyle = 'rgba(160,164,160,0.75)';
      for (let y = 12; y < 512; y += 24) {
        ctx.beginPath();
        ctx.arc(x - 3, y, 1.5, 0, TAU);
        ctx.fill();
      }
    }

    // Subtle road grime gradient near bottom rail
    const grime = ctx.createLinearGradient(0, 380, 0, 512);
    grime.addColorStop(0, 'rgba(120,115,105,0)');
    grime.addColorStop(1, 'rgba(115,110,98,0.18)');
    ctx.fillStyle = grime;
    ctx.fillRect(0, 380, 512, 132);

    const tex = new THREE.CanvasTexture(c);
    return (cache[key] = wrapRepeat(tex, 6, 1));
  }

  // 3.7 Retail Store Stucco & CMU Block Wall Texture
  function getStuccoWallTexture() {
    const key = 'store_stucco';
    if (cache[key] !== undefined) return cache[key];
    const c = mkCanvas(512, 512);
    if (!c) return (cache[key] = null);
    const ctx = c.getContext('2d');
    const rand = createPRNG(8821);

    ctx.fillStyle = '#c4a682';
    ctx.fillRect(0, 0, 512, 512);

    // Subtle CMU courses beneath painted stucco
    for (let y = 0; y < 512; y += 32) {
      ctx.fillStyle = 'rgba(90,72,52,0.08)';
      ctx.fillRect(0, y, 512, 2);
      const offset = ((y / 32) % 2) * 32;
      for (let x = offset; x < 512; x += 64) {
        ctx.fillRect(x, y, 2, 32);
      }
    }

    // Stucco grain
    for (let i = 0; i < 18000; i++) {
      const x = (rand() * 512) | 0;
      const y = (rand() * 512) | 0;
      const d = ((rand() - 0.5) * 26) | 0;
      ctx.fillStyle = `rgb(${clamp(196 + d, 140, 235)},${clamp(166 + d, 115, 205)},${clamp(130 + d, 85, 175)})`;
      ctx.fillRect(x, y, 2, 2);
    }

    // Baseboard weather staining
    const stain = ctx.createLinearGradient(0, 420, 0, 512);
    stain.addColorStop(0, 'rgba(72,58,42,0)');
    stain.addColorStop(1, 'rgba(68,54,38,0.28)');
    ctx.fillStyle = stain;
    ctx.fillRect(0, 420, 512, 92);

    const tex = new THREE.CanvasTexture(c);
    return (cache[key] = wrapRepeat(tex, 4, 2));
  }

  // 3.8 Fictionalized Storefront Fascia Sign Texture ("COUNTY LINE FEED & SUPPLY / ICE - GROCERY - BAIT")
  function getStoreSignTexture() {
    const key = 'store_fascia_sign';
    if (cache[key] !== undefined) return cache[key];
    const c = mkCanvas(1024, 256);
    if (!c) return (cache[key] = null);
    const ctx = c.getContext('2d');

    ctx.fillStyle = '#f5efe2';
    ctx.fillRect(0, 0, 1024, 256);

    ctx.lineWidth = 10;
    ctx.strokeStyle = '#5c3c20';
    ctx.strokeRect(10, 10, 1004, 236);

    ctx.lineWidth = 3;
    ctx.strokeStyle = '#8b261d';
    ctx.strokeRect(22, 22, 980, 212);

    ctx.fillStyle = '#2d4a28';
    ctx.font = 'bold 74px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('RURAL FEED & GENERAL STORE', 512, 96);

    ctx.fillStyle = '#8b261d';
    ctx.font = 'bold 42px sans-serif';
    ctx.fillText('FARM SUPPLIES  •  COLD DRINKS  •  BAG ICE', 512, 182);

    const tex = new THREE.CanvasTexture(c);
    return (cache[key] = wrapClamp(tex));
  }

  // 3.9 Southern Pine / Live Oak Bark Texture
  function getBarkTexture() {
    const key = 'tree_bark';
    if (cache[key] !== undefined) return cache[key];
    const c = mkCanvas(256, 512);
    if (!c) return (cache[key] = null);
    const ctx = c.getContext('2d');
    const rand = createPRNG(9901);

    ctx.fillStyle = '#4a3a2c';
    ctx.fillRect(0, 0, 256, 512);

    for (let i = 0; i < 650; i++) {
      const x = rand() * 256;
      const y = rand() * 512;
      const w = 3 + rand() * 8;
      const h = 18 + rand() * 48;
      const d = ((rand() - 0.5) * 42) | 0;
      ctx.fillStyle = `rgb(${clamp(74 + d, 32, 118)},${clamp(58 + d, 24, 96)},${clamp(44 + d, 18, 76)})`;
      ctx.fillRect(x, y, w, h);
    }

    const tex = new THREE.CanvasTexture(c);
    return (cache[key] = wrapRepeat(tex, 2, 4));
  }

  // 3.10 Alpha-Cutout Foliage Cluster Texture (for realistic non-broccoli tree canopies)
  function getFoliageCardTexture(kind = 'oak') {
    const key = 'foliage_' + kind;
    if (cache[key] !== undefined) return cache[key];
    const c = mkCanvas(256, 256);
    if (!c) return (cache[key] = null);
    const ctx = c.getContext('2d');
    const rand = createPRNG(kind === 'oak' ? 3111 : 3222);

    ctx.clearRect(0, 0, 256, 256);

    // Draw twigs
    ctx.strokeStyle = '#48392a';
    ctx.lineWidth = 3;
    for (let b = 0; b < 6; b++) {
      const ang = (b / 6) * TAU + rand() * 0.4;
      ctx.beginPath();
      ctx.moveTo(128, 128);
      ctx.lineTo(128 + Math.cos(ang) * 95, 128 + Math.sin(ang) * 95);
      ctx.stroke();
    }

    // Draw hundreds of individual leaves / pine needle clusters inside circular envelope
    const count = kind === 'oak' ? 280 : 340;
    for (let i = 0; i < count; i++) {
      const r = Math.pow(rand(), 0.65) * 108;
      const a = rand() * TAU;
      const lx = 128 + Math.cos(a) * r;
      const ly = 128 + Math.sin(a) * r;
      const rot = rand() * TAU;
      const shade = ((rand() - 0.45) * 46) | 0;
      const baseR = kind === 'oak' ? 58 : 48;
      const baseG = kind === 'oak' ? 88 : 78;
      const baseB = kind === 'oak' ? 38 : 34;

      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(rot);
      ctx.fillStyle = `rgba(${clamp(baseR + shade, 28, 125)},${clamp(baseG + shade, 45, 148)},${clamp(baseB + shade, 18, 88)},0.96)`;
      ctx.beginPath();
      if (kind === 'oak') {
        ctx.ellipse(0, 0, 11 + rand() * 7, 5 + rand() * 4, 0, 0, TAU);
      } else {
        ctx.ellipse(0, 0, 15 + rand() * 8, 2.5 + rand() * 2, 0, 0, TAU);
      }
      ctx.fill();
      ctx.restore();
    }

    const tex = new THREE.CanvasTexture(c);
    return (cache[key] = wrapClamp(tex));
  }

  return {
    getAsphaltTexture,
    getGrassTexture,
    getGravelTexture,
    getStopSignTexture,
    getSpeedLimitTexture,
    getTrailerSideTexture,
    getStuccoWallTexture,
    getStoreSignTexture,
    getBarkTexture,
    getFoliageCardTexture,
  };
}

// -------------------------------------------------------------------------------------------------
// SECTION 4: SHARED PBR MATERIAL LIBRARY
// -------------------------------------------------------------------------------------------------

function createMaterialLibrary(THREE, textures) {
  const MeshPhysical = THREE.MeshPhysicalMaterial || THREE.MeshStandardMaterial;
  const MeshStandard = THREE.MeshStandardMaterial;

  const asphaltMainTex = textures.getAsphaltTexture('main');
  const asphaltShoulderTex = textures.getAsphaltTexture('shoulder');
  const asphaltLocalTex = textures.getAsphaltTexture('local');
  const grassPastureTex = textures.getGrassTexture('pasture');
  const grassMedianTex = textures.getGrassTexture('median');
  const gravelTex = textures.getGravelTexture();
  const trailerSideTex = textures.getTrailerSideTexture();
  const stuccoTex = textures.getStuccoWallTexture();
  const storeSignTex = textures.getStoreSignTexture();
  const stopSignTex = textures.getStopSignTexture();
  const speedSignTex = textures.getSpeedLimitTexture(65);
  const barkTex = textures.getBarkTexture();
  const oakFoliageTex = textures.getFoliageCardTexture('oak');
  const pineFoliageTex = textures.getFoliageCardTexture('pine');

  return {
    // Ground & Roadway Materials
    groundPasture: new MeshStandard({
      color: 0x6b7c4e,
      map: grassPastureTex || null,
      roughness: 0.92,
      metalness: 0.0,
    }),
    medianGrass: new MeshStandard({
      color: 0x748854,
      map: grassMedianTex || null,
      roughness: 0.92,
      metalness: 0.0,
    }),
    asphaltMain: new MeshStandard({
      color: asphaltMainTex ? 0xd8d8d8 : 0x3a3c3f,
      map: asphaltMainTex || null,
      roughness: 0.82,
      metalness: 0.0,
    }),
    asphaltShoulder: new MeshStandard({
      color: asphaltShoulderTex ? 0xdcdcdc : 0x434548,
      map: asphaltShoulderTex || null,
      roughness: 0.86,
      metalness: 0.0,
    }),
    asphaltTurn: new MeshStandard({
      color: asphaltLocalTex ? 0xd4d4d4 : 0x3d3f42,
      map: asphaltLocalTex || null,
      roughness: 0.84,
      metalness: 0.0,
    }),
    asphaltCrossover: new MeshStandard({
      color: asphaltLocalTex ? 0xd6d6d6 : 0x3e4043,
      map: asphaltLocalTex || null,
      roughness: 0.85,
      metalness: 0.0,
    }),
    asphaltSideRoad: new MeshStandard({
      color: asphaltLocalTex ? 0xe0e0e0 : 0x45474a,
      map: asphaltLocalTex || null,
      roughness: 0.86,
      metalness: 0.0,
    }),
    gravelApron: new MeshStandard({
      color: gravelTex ? 0xdedbd4 : 0xb8b3a8,
      map: gravelTex || null,
      roughness: 0.9,
      metalness: 0.0,
    }),
    concreteDriveway: new MeshStandard({
      color: 0xc2bdb2,
      roughness: 0.85,
      metalness: 0.0,
    }),
    concreteCulvert: new MeshStandard({
      color: 0x9c9a94,
      roughness: 0.85,
      metalness: 0.0,
    }),

    // Pavement Markings & RPMs
    paintWhite: new MeshStandard({
      color: 0xf0f0f0,
      roughness: 0.5,
      metalness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
    paintYellow: new MeshStandard({
      color: 0xeab81c,
      roughness: 0.5,
      metalness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
    rpmBodyWhite: new MeshStandard({
      color: 0xf5f5f5,
      roughness: 0.3,
      metalness: 0.1,
    }),
    rpmBodyAmber: new MeshStandard({
      color: 0xf29f05,
      roughness: 0.3,
      metalness: 0.1,
    }),
    furrowScuff: new MeshStandard({
      color: 0x3b3228,
      roughness: 0.9,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
    forensicMarkerRed: new MeshStandard({
      color: 0xd92b2b,
      roughness: 0.42,
      metalness: 0.05,
    }),
    forensicMarkerWhite: new MeshStandard({
      color: 0xfafafa,
      roughness: 0.42,
      metalness: 0.05,
    }),

    // Automotive Materials
    sedanPaintNavy: new MeshPhysical({
      color: 0x1d2c44,
      roughness: 0.24,
      metalness: 0.58,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
    }),
    witAPaintSilver: new MeshPhysical({
      color: 0x7a8288,
      roughness: 0.28,
      metalness: 0.55,
      clearcoat: 0.9,
      clearcoatRoughness: 0.08,
    }),
    witCPaintCharcoal: new MeshPhysical({
      color: 0x586068,
      roughness: 0.32,
      metalness: 0.5,
      clearcoat: 0.85,
      clearcoatRoughness: 0.1,
    }),
    tractorPaintWhite: new MeshPhysical({
      color: 0xe8e8e8,
      roughness: 0.3,
      metalness: 0.25,
      clearcoat: 0.85,
      clearcoatRoughness: 0.1,
    }),
    trailerBoxWhite: new MeshStandard({
      color: trailerSideTex ? 0xffffff : 0xf2f2ee,
      map: trailerSideTex || null,
      roughness: 0.42,
      metalness: 0.18,
    }),
    trailerPlainWhite: new MeshStandard({
      color: 0xf2f2ee,
      roughness: 0.42,
      metalness: 0.18,
    }),
    reeferHousing: new MeshStandard({
      color: 0xd8d8d4,
      roughness: 0.45,
      metalness: 0.22,
    }),
    chromeBright: new MeshStandard({
      color: 0xd8dcdf,
      roughness: 0.16,
      metalness: 0.92,
    }),
    alloyWheel: new MeshStandard({
      color: 0xc0c4c8,
      roughness: 0.26,
      metalness: 0.82,
    }),
    galvanizedSteel: new MeshStandard({
      color: 0x8c9094,
      roughness: 0.48,
      metalness: 0.78,
    }),
    darkSteelChassis: new MeshStandard({
      color: 0x26292c,
      roughness: 0.65,
      metalness: 0.55,
    }),
    blackTrimPlastic: new MeshStandard({
      color: 0x1a1c1e,
      roughness: 0.72,
      metalness: 0.08,
    }),
    tireRubber: new MeshStandard({
      color: 0x1c1c1c,
      roughness: 0.86,
      metalness: 0.02,
    }),
    brakeRotorIron: new MeshStandard({
      color: 0x74787c,
      roughness: 0.38,
      metalness: 0.75,
    }),
    autoGlassTinted: new MeshPhysical({
      color: 0x1a242c,
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.72,
    }),
    interiorUpholstery: new MeshStandard({
      color: 0x25282c,
      roughness: 0.85,
      metalness: 0.0,
    }),
    headlampLensOff: new MeshStandard({
      color: 0xd8e0e8,
      roughness: 0.15,
      metalness: 0.25,
    }),
    taillampLensRed: new MeshStandard({
      color: 0x9e1820,
      roughness: 0.22,
      metalness: 0.15,
    }),
    markerAmber: new MeshStandard({
      color: 0xe68a00,
      roughness: 0.28,
      metalness: 0.1,
      emissive: 0x331a00,
      emissiveIntensity: 0.25,
    }),
    dotTapeRed: new MeshStandard({
      color: 0xc41e3a,
      roughness: 0.32,
      metalness: 0.15,
    }),
    dotTapeWhite: new MeshStandard({
      color: 0xf5f5f5,
      roughness: 0.32,
      metalness: 0.15,
    }),

    // Buildings, Signs, Poles, Fences, Vegetation
    storeStucco: new MeshStandard({
      color: stuccoTex ? 0xffffff : 0xb89772,
      map: stuccoTex || null,
      roughness: 0.78,
      metalness: 0.05,
    }),
    storeTrimBrown: new MeshStandard({
      color: 0x5c4028,
      roughness: 0.7,
      metalness: 0.1,
    }),
    storeRoofMetal: new MeshStandard({
      color: 0x7a7d80,
      roughness: 0.55,
      metalness: 0.65,
    }),
    storeAwningGreen: new MeshStandard({
      color: 0x2b4c32,
      roughness: 0.75,
      metalness: 0.05,
    }),
    storeFasciaSign: new MeshStandard({
      color: 0xffffff,
      map: storeSignTex || null,
      roughness: 0.45,
      metalness: 0.05,
    }),
    shelterPostGray: new MeshStandard({
      color: 0x3a3d40,
      roughness: 0.5,
      metalness: 0.7,
    }),
    shelterRoofMetal: new MeshStandard({
      color: 0x8a8d91,
      roughness: 0.52,
      metalness: 0.68,
    }),
    woodBenchSlat: new MeshStandard({
      color: 0x6e5239,
      roughness: 0.78,
      metalness: 0.02,
    }),
    woodPoleCreosote: new MeshStandard({
      color: 0x4a3b2c,
      roughness: 0.86,
      metalness: 0.0,
    }),
    woodFencePost: new MeshStandard({
      color: 0x5a4632,
      roughness: 0.85,
      metalness: 0.0,
    }),
    ceramicInsulator: new MeshStandard({
      color: 0x98b4be,
      roughness: 0.25,
      metalness: 0.1,
    }),
    overheadWire: new MeshStandard({
      color: 0x585c60,
      roughness: 0.55,
      metalness: 0.65,
    }),
    stopSignFace: new MeshStandard({
      color: stopSignTex ? 0xffffff : 0xc41e3a,
      map: stopSignTex || null,
      roughness: 0.35,
      metalness: 0.18,
    }),
    speedSignFace: new MeshStandard({
      color: speedSignTex ? 0xffffff : 0xf5f5f5,
      map: speedSignTex || null,
      roughness: 0.35,
      metalness: 0.18,
    }),
    houseSidingLight: new MeshStandard({
      color: 0xd8d2c5,
      roughness: 0.8,
      metalness: 0.0,
    }),
    houseBrick: new MeshStandard({
      color: 0x8e5242,
      roughness: 0.85,
      metalness: 0.0,
    }),
    houseRoofShingle: new MeshStandard({
      color: 0x4a4845,
      roughness: 0.88,
      metalness: 0.0,
    }),
    treeBark: new MeshStandard({
      color: barkTex ? 0xd8d0c8 : 0x4d3b2c,
      map: barkTex || null,
      roughness: 0.9,
      metalness: 0.0,
    }),
    oakFoliage: new MeshStandard({
      color: oakFoliageTex ? 0xffffff : 0x3b5323,
      map: oakFoliageTex || null,
      alphaTest: oakFoliageTex ? 0.42 : 0.0,
      transparent: Boolean(oakFoliageTex),
      side: THREE.DoubleSide,
      roughness: 0.88,
      metalness: 0.0,
    }),
    pineFoliage: new MeshStandard({
      color: pineFoliageTex ? 0xffffff : 0x334b20,
      map: pineFoliageTex || null,
      alphaTest: pineFoliageTex ? 0.42 : 0.0,
      transparent: Boolean(pineFoliageTex),
      side: THREE.DoubleSide,
      roughness: 0.88,
      metalness: 0.0,
    }),
  };
}

// -------------------------------------------------------------------------------------------------
// SECTION 5: LIGHTING, SOLAR EPHEMERIS & ATMOSPHERIC SKY DOME
// -------------------------------------------------------------------------------------------------
// Date/Time: 2016-05-07 16:36:12.7 EDT (UTC-04:00), Lat 29.4106 N, Lon -82.5393 W
// Sun Azimuth: 265.0 deg (just south of due west), Sun Elevation: 45.1 deg.
// Direction vector toward sun in (+X East, +Y Up, -Z North) frame:
//   x = sin(az) * cos(el), y = sin(el), z = -cos(az) * cos(el).

function buildWorldEnvironment(THREE, root) {
  const envGroup = new THREE.Group();
  envGroup.name = 'world_env';

  const az = 265.0 * D2R;
  const el = 45.1 * D2R;
  const sunDirX = Math.sin(az) * Math.cos(el);
  const sunDirY = Math.sin(el);
  const sunDirZ = -Math.cos(az) * Math.cos(el);

  // Primary solar DirectionalLight
  const sunLight = new THREE.DirectionalLight(0xfff7e8, 2.65);
  sunLight.name = 'sun_light';
  const sunDist = 180;
  sunLight.position.set(sunDirX * sunDist, sunDirY * sunDist, sunDirZ * sunDist);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 4096;
  sunLight.shadow.mapSize.height = 4096;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 420;
  sunLight.shadow.camera.left = -135;
  sunLight.shadow.camera.right = 135;
  sunLight.shadow.camera.top = 95;
  sunLight.shadow.camera.bottom = -95;
  sunLight.shadow.bias = -0.00035;
  sunLight.shadow.normalBias = 0.02;
  envGroup.add(sunLight);
  envGroup.add(sunLight.target);

  // Hemisphere sky / warm Florida Bahia turf bounce light (prevents pitch-black shadow voids)
  const hemiLight = new THREE.HemisphereLight(0xcce4ff, 0x6b7448, 0.68);
  hemiLight.name = 'hemi_sky_ground';
  hemiLight.position.set(0, 120, 0);
  envGroup.add(hemiLight);

  // Subtle fill light from opposite sky quadrant for realistic atmospheric scattering
  const skyFill = new THREE.DirectionalLight(0xbad4f5, 0.38);
  skyFill.name = 'sky_fill_light';
  skyFill.position.set(-sunDirX * 80, 65, -sunDirZ * 80);
  envGroup.add(skyFill);

  // Vertex-colored Preetham/Hosek-inspired atmospheric sky dome (inverted sphere radius 1800 m)
  const skyGeo = new THREE.SphereGeometry(1800, 48, 28);
  const posAttr = skyGeo.attributes.position;
  const colors = new Float32Array(posAttr.count * 3);

  const zenithCol = new THREE.Color(0x2d63ad);
  const midSkyCol = new THREE.Color(0x6fa8dc);
  const horizonCol = new THREE.Color(0xcfe2f3);
  const groundCol = new THREE.Color(0x889674);
  const sunGlowCol = new THREE.Color(0xfff2cc);
  const tmpCol = new THREE.Color();

  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vy = posAttr.getY(i);
    const vz = posAttr.getZ(i);
    const len = Math.hypot(vx, vy, vz) || 1;
    const nx = vx / len;
    const ny = vy / len;
    const nz = vz / len;

    if (ny >= 0) {
      const tLow = clamp(ny / 0.28, 0, 1);
      const tHigh = clamp((ny - 0.28) / 0.72, 0, 1);
      if (ny < 0.28) {
        tmpCol.copy(horizonCol).lerp(midSkyCol, Math.pow(tLow, 0.75));
      } else {
        tmpCol.copy(midSkyCol).lerp(zenithCol, Math.pow(tHigh, 0.85));
      }
      // Solar aureole / circumsolar brightening toward azimuth 265 deg, elevation 45.1 deg
      const cosSun = clamp(nx * sunDirX + ny * sunDirY + nz * sunDirZ, 0, 1);
      const glow = Math.pow(cosSun, 12) * 0.45 + Math.pow(cosSun, 120) * 0.55;
      tmpCol.lerp(sunGlowCol, clamp(glow, 0, 0.85));
    } else {
      const tGnd = clamp(-ny / 0.25, 0, 1);
      tmpCol.copy(horizonCol).lerp(groundCol, tGnd);
    }
    colors[i * 3] = tmpCol.r;
    colors[i * 3 + 1] = tmpCol.g;
    colors[i * 3 + 2] = tmpCol.b;
  }
  skyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const skyMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyDome.name = 'sky_dome';
  skyDome.userData.scenery = true;
  envGroup.add(skyDome);

  root.userData.env = {
    fog: { color: 0xcfe2f3, near: 320, far: 1650 },
    background: 0x8cb8e6,
    exposure: 1.0,
    selfLit: true,
  };

  root.add(envGroup);
  return envGroup;
}

// -------------------------------------------------------------------------------------------------
// SECTION 6: STUDIO VEHICLE BUILDERS (A, TT, TR, WIT_A, WIT_C)
// -------------------------------------------------------------------------------------------------
// All vehicles follow Contract v1 & v2 conventions:
// - Root Group origin is at ground level (y = 0) at the center of the vehicle's footprint.
// - Vehicle front is local -Z; rear is local +Z; right side is +X; left side is -X.
// - Dimensions match Section 4 & Scene Spec exactly.

// 6.1 Shared Wheel + Tire + Rim + 5 Lug Nuts + Brake Disc/Caliper Sub-Builder
function buildDetailedWheelAssembly(THREE, mats, opts = {}) {
  const {
    radius = 0.34,
    width = 0.225,
    rimRadius = 0.22,
    isDual = false,
    isCommercial = false,
    side = 1, // +1 right, -1 left
    name = 'wheel',
  } = opts;

  const group = new THREE.Group();
  group.name = name;

  const buildSingleTireAndRim = (xOffset) => {
    const unit = new THREE.Group();
    unit.position.x = xOffset;

    // Outer tire tread cylinder (axis along X)
    const treadGeo = new THREE.CylinderGeometry(radius, radius, width, 28, 1, false);
    treadGeo.rotateZ(Math.PI / 2);
    const treadMesh = new THREE.Mesh(treadGeo, mats.tireRubber);
    treadMesh.castShadow = true;
    treadMesh.receiveShadow = true;
    unit.add(treadMesh);

    // Sidewall torus rings for rounded tire shoulder profile
    const swRadius = (radius + rimRadius) * 0.5;
    const swTube = (radius - rimRadius) * 0.45;
    const swGeo = new THREE.TorusGeometry(swRadius, swTube, 10, 24);
    swGeo.rotateY(Math.PI / 2);
    for (const sx of [-width * 0.36, width * 0.36]) {
      const sw = new THREE.Mesh(swGeo, mats.tireRubber);
      sw.position.x = sx;
      unit.add(sw);
    }

    // Recessed wheel barrel
    const barrelGeo = new THREE.CylinderGeometry(rimRadius, rimRadius, width * 0.88, 20);
    barrelGeo.rotateZ(Math.PI / 2);
    const barrel = new THREE.Mesh(barrelGeo, isCommercial ? mats.chromeBright : mats.alloyWheel);
    unit.add(barrel);

    // Outer rim flange
    const flangeX = side * (width * 0.43);
    const flangeGeo = new THREE.TorusGeometry(rimRadius * 0.96, 0.016, 8, 24);
    flangeGeo.rotateY(Math.PI / 2);
    const flange = new THREE.Mesh(flangeGeo, isCommercial ? mats.chromeBright : mats.alloyWheel);
    flange.position.x = flangeX;
    unit.add(flange);

    // Center hub cap
    const hubGeo = new THREE.CylinderGeometry(rimRadius * 0.34, rimRadius * 0.38, 0.06, 16);
    hubGeo.rotateZ(Math.PI / 2);
    const hub = new THREE.Mesh(hubGeo, isCommercial ? mats.darkSteelChassis : mats.alloyWheel);
    hub.position.x = side * (width * 0.42);
    unit.add(hub);

    // 5-spoke alloy pattern (passenger) or 10-hole commercial steel/alcoa disc (truck)
    const spokeCount = isCommercial ? 8 : 5;
    for (let s = 0; s < spokeCount; s++) {
      const ang = (s / spokeCount) * TAU;
      const spokeLen = rimRadius * 0.68;
      const spokeW = isCommercial ? 0.038 : 0.044;
      const spokeGeo = new THREE.BoxGeometry(0.025, spokeLen, spokeW);
      const spoke = new THREE.Mesh(spokeGeo, isCommercial ? mats.chromeBright : mats.alloyWheel);
      spoke.position.set(
        side * (width * 0.41),
        Math.cos(ang) * (rimRadius * 0.56),
        Math.sin(ang) * (rimRadius * 0.56)
      );
      spoke.rotation.x = -ang;
      unit.add(spoke);
    }

    // 5 Lug nuts around hub bolt circle
    const lugCount = isCommercial ? 10 : 5;
    const lugGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.024, 6);
    lugGeo.rotateZ(Math.PI / 2);
    const boltCircle = rimRadius * 0.24;
    for (let l = 0; l < lugCount; l++) {
      const ang = (l / lugCount) * TAU;
      const lug = new THREE.Mesh(lugGeo, mats.chromeBright);
      lug.position.set(
        side * (width * 0.45),
        Math.cos(ang) * boltCircle,
        Math.sin(ang) * boltCircle
      );
      unit.add(lug);
    }

    // Brake disc rotor & caliper behind spokes (passenger vehicles)
    if (!isCommercial) {
      const rotorGeo = new THREE.CylinderGeometry(rimRadius * 0.76, rimRadius * 0.76, 0.024, 20);
      rotorGeo.rotateZ(Math.PI / 2);
      const rotor = new THREE.Mesh(rotorGeo, mats.brakeRotorIron);
      rotor.position.x = side * (width * 0.15);
      unit.add(rotor);

      const caliperGeo = new THREE.BoxGeometry(0.055, 0.11, 0.075);
      const caliper = new THREE.Mesh(caliperGeo, mats.darkSteelChassis);
      caliper.position.set(side * (width * 0.16), rimRadius * 0.42, -rimRadius * 0.42);
      unit.add(caliper);
    }

    return unit;
  };

  if (isDual) {
    const spacing = width * 0.56;
    group.add(buildSingleTireAndRim(-spacing));
    group.add(buildSingleTireAndRim(spacing));
  } else {
    group.add(buildSingleTireAndRim(0));
  }

  return group;
}

// 6.2 Vehicle A: 2015 Full-Size 4-Door Passenger Sedan (Dark Navy Metallic #1d2c44)
// Spec dimensions: length 4.97 m (z = -2.485 to +2.485), width 1.96 m (x = -0.98 to +0.98),
// height 1.445 m, wheelbase 2.96 m, hood trailing edge height 0.914 m (3 ft), seat headrest top 1.29 m,
// headlights OFF at impact (F4).
function buildPassengerSedan(THREE, mats, opts = {}) {
  const {
    id = 'veh_A',
    paintMat = mats.sedanPaintNavy,
    length = 4.97,
    width = 1.96,
    height = 1.445,
  } = opts;

  const root = new THREE.Group();
  root.name = id;

  const halfL = length * 0.5; // 2.485 m
  const halfW = width * 0.5;  // 0.98 m
  const frontAxleZ = -halfL + 0.98; // -1.505 m
  const rearAxleZ = -halfL + 3.94;  // +1.455 m
  const wheelRadius = 0.34;

  // --- A. Sculpted Lower Body Shell (Lofted / Extruded Side Profile with Tumblehome Bevel) ---
  // Note: ExtrudeGeometry extrudes in +Z from 0..depth, so we extrude across X by rotating Y by -PI/2.
  const bodySideShape = new THREE.Shape();
  // Coordinates in (u = -Z from rear to front, v = Y above ground):
  // Let's define profile in (X_2d = z along car from -halfL to +halfL, Y_2d = height y):
  bodySideShape.moveTo(-halfL + 0.08, 0.22); // Front lower chin spoiler
  bodySideShape.lineTo(-halfL, 0.38);        // Front bumper nose
  bodySideShape.lineTo(-halfL + 0.14, 0.68); // Upper grille edge
  bodySideShape.lineTo(-halfL + 0.55, 0.81); // Forward hood slope
  bodySideShape.lineTo(-halfL + 1.42, 0.914);// Hood trailing edge at cowl (exact 3.0 ft / 0.914 m per F14)
  bodySideShape.lineTo(-halfL + 2.18, 1.42); // A-pillar top / windshield header
  bodySideShape.lineTo(-halfL + 3.18, 1.445);// Roof peak
  bodySideShape.lineTo(-halfL + 4.12, 1.02); // C-pillar base / rear decklid start
  bodySideShape.lineTo(halfL - 0.10, 0.96);  // Trunk trailing lip
  bodySideShape.lineTo(halfL, 0.66);         // Rear bumper upper face
  bodySideShape.lineTo(halfL - 0.08, 0.25);  // Rear diffuser bottom
  bodySideShape.lineTo(rearAxleZ + 0.42, 0.23);
  bodySideShape.lineTo(rearAxleZ + 0.34, 0.52);
  bodySideShape.lineTo(rearAxleZ - 0.34, 0.52);
  bodySideShape.lineTo(rearAxleZ - 0.42, 0.17); // Rocker panel rear
  bodySideShape.lineTo(frontAxleZ + 0.42, 0.17);// Rocker panel front
  bodySideShape.lineTo(frontAxleZ + 0.34, 0.52);
  bodySideShape.lineTo(frontAxleZ - 0.34, 0.52);
  bodySideShape.lineTo(frontAxleZ - 0.42, 0.20);
  bodySideShape.closePath();

  const coreWidth = width - 0.26;
  const extrudeSettings = {
    steps: 1,
    depth: coreWidth,
    bevelEnabled: true,
    bevelThickness: 0.09,
    bevelSize: 0.07,
    bevelSegments: 3,
  };
  const bodyCoreGeo = new THREE.ExtrudeGeometry(bodySideShape, extrudeSettings);
  // Rotate so X_2d -> +Z, Y_2d -> +Y, ExtrudeZ -> +X, then center along X
  bodyCoreGeo.rotateY(-Math.PI / 2);
  bodyCoreGeo.translate(coreWidth * 0.5, 0, 0);
  const bodyCoreMesh = new THREE.Mesh(bodyCoreGeo, paintMat);
  bodyCoreMesh.name = 'body_core';
  bodyCoreMesh.castShadow = true;
  bodyCoreMesh.receiveShadow = true;
  root.add(bodyCoreMesh);

  // --- B. Flared Front & Rear Quarter Panels / Beltline Haunches ---
  const beltlineGeo = new THREE.BoxGeometry(width - 0.04, 0.48, length - 0.32);
  const beltlineMesh = new THREE.Mesh(beltlineGeo, paintMat);
  beltlineMesh.position.set(0, 0.58, 0);
  beltlineMesh.castShadow = true;
  beltlineMesh.receiveShadow = true;
  root.add(beltlineMesh);

  // Sculpted Hood Center Power-Dome & Character Creases
  const hoodDomeGeo = new THREE.BoxGeometry(width * 0.68, 0.06, 1.24);
  const hoodDome = new THREE.Mesh(hoodDomeGeo, paintMat);
  hoodDome.position.set(0, 0.84, -halfL + 0.80);
  hoodDome.rotation.x = 0.085;
  hoodDome.castShadow = true;
  root.add(hoodDome);

  // Wheel-Arch FlareLips (Front & Rear, Left & Right)
  const archGeo = new THREE.TorusGeometry(0.39, 0.045, 8, 18, Math.PI);
  archGeo.rotateY(Math.PI / 2);
  for (const side of [-1, 1]) {
    for (const az of [frontAxleZ, rearAxleZ]) {
      const arch = new THREE.Mesh(archGeo, paintMat);
      arch.position.set(side * (halfW - 0.03), 0.35, az);
      arch.castShadow = true;
      root.add(arch);

      // Dark wheelwell inner liner so rays/views cannot pass through wheel arches
      const linerGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.32, 16, 1, false, 0, Math.PI);
      linerGeo.rotateZ(Math.PI / 2);
      const liner = new THREE.Mesh(linerGeo, mats.blackTrimPlastic);
      liner.position.set(side * (halfW - 0.18), 0.35, az);
      root.add(liner);
    }
  }

  // --- C. Tinted Glass Greenhouse (Windshield, Rear Backlite, Side Windows, B/C Pillars) ---
  // Front windshield
  const wsGeo = new THREE.BoxGeometry(width * 0.78, 0.025, 0.94);
  const wsMesh = new THREE.Mesh(wsGeo, mats.autoGlassTinted);
  wsMesh.name = 'windshield_front';
  wsMesh.position.set(0, 1.17, -halfL + 1.80);
  wsMesh.rotation.x = 0.57;
  root.add(wsMesh);

  // Rear window (backlite)
  const rwGeo = new THREE.BoxGeometry(width * 0.76, 0.025, 0.98);
  const rwMesh = new THREE.Mesh(rwGeo, mats.autoGlassTinted);
  rwMesh.name = 'windshield_rear';
  rwMesh.position.set(0, 1.22, -halfL + 3.65);
  rwMesh.rotation.x = -0.46;
  root.add(rwMesh);

  // Side window glass panels & black B-pillars
  for (const side of [-1, 1]) {
    const sideGlassGeo = new THREE.BoxGeometry(0.02, 0.36, 1.72);
    const sideGlass = new THREE.Mesh(sideGlassGeo, mats.autoGlassTinted);
    sideGlass.position.set(side * (halfW - 0.11), 1.16, 0.22);
    sideGlass.rotation.z = -side * 0.18;
    root.add(sideGlass);

    // B-pillar gloss black divider
    const bPillarGeo = new THREE.BoxGeometry(0.03, 0.42, 0.11);
    const bPillar = new THREE.Mesh(bPillarGeo, mats.blackTrimPlastic);
    bPillar.position.set(side * (halfW - 0.105), 1.15, 0.16);
    bPillar.rotation.z = -side * 0.18;
    root.add(bPillar);

    // Door panel gap lines (front & rear door seams)
    for (const seamZ of [-0.68, 0.16, 1.02]) {
      const seamGeo = new THREE.BoxGeometry(0.008, 0.56, 0.012);
      const seam = new THREE.Mesh(seamGeo, mats.blackTrimPlastic);
      seam.position.set(side * (halfW - 0.015), 0.56, seamZ);
      root.add(seam);
    }

    // Body-colored door handles (front & rear)
    for (const dhZ of [-0.02, 0.82]) {
      const handleGeo = new THREE.BoxGeometry(0.035, 0.032, 0.16);
      const handle = new THREE.Mesh(handleGeo, paintMat);
      handle.position.set(side * (halfW + 0.005), 0.82, dhZ);
      root.add(handle);
    }

    // Aerodynamic side mirrors on stalks
    const stalkGeo = new THREE.BoxGeometry(0.10, 0.035, 0.06);
    const stalk = new THREE.Mesh(stalkGeo, mats.blackTrimPlastic);
    stalk.position.set(side * (halfW - 0.04), 0.94, -0.58);
    root.add(stalk);

    const mirrorCapGeo = new THREE.BoxGeometry(0.15, 0.10, 0.11);
    const mirrorCap = new THREE.Mesh(mirrorCapGeo, paintMat);
    mirrorCap.position.set(side * (halfW + 0.05), 0.96, -0.56);
    mirrorCap.castShadow = true;
    root.add(mirrorCap);
  }

  // Windshield wipers at cowl
  for (const wx of [-0.28, 0.18]) {
    const wiperGeo = new THREE.BoxGeometry(0.52, 0.018, 0.022);
    const wiper = new THREE.Mesh(wiperGeo, mats.blackTrimPlastic);
    wiper.position.set(wx, 0.93, -halfL + 1.44);
    wiper.rotation.y = 0.12;
    root.add(wiper);
  }

  // --- D. Detailed Interior Cabin (Dashboard, Steering Wheel, 4 Seats, Headrests at 1.29 m) ---
  // Fact F14: "The seat headrests sat at least 3.5 in above the trailer's bottom edge [1.20 m]."
  const dashGeo = new THREE.BoxGeometry(width * 0.76, 0.34, 0.48);
  const dash = new THREE.Mesh(dashGeo, mats.interiorUpholstery);
  dash.position.set(0, 0.78, -0.62);
  root.add(dash);

  // Steering wheel (left-hand drive at x = -0.38 m)
  const swRingGeo = new THREE.TorusGeometry(0.17, 0.022, 8, 18);
  const swRing = new THREE.Mesh(swRingGeo, mats.blackTrimPlastic);
  swRing.position.set(-0.38, 0.88, -0.36);
  swRing.rotation.x = -0.35;
  root.add(swRing);

  // Front bucket seats & headrests (top of headrest at y = 1.29 m)
  for (const sx of [-0.38, 0.38]) {
    const cushionGeo = new THREE.BoxGeometry(0.48, 0.16, 0.50);
    const cushion = new THREE.Mesh(cushionGeo, mats.interiorUpholstery);
    cushion.position.set(sx, 0.44, 0.02);
    root.add(cushion);

    const backrestGeo = new THREE.BoxGeometry(0.46, 0.58, 0.12);
    const backrest = new THREE.Mesh(backrestGeo, mats.interiorUpholstery);
    backrest.position.set(sx, 0.78, 0.22);
    backrest.rotation.x = -0.14;
    root.add(backrest);

    const headrestGeo = new THREE.BoxGeometry(0.24, 0.21, 0.10);
    const headrest = new THREE.Mesh(headrestGeo, mats.interiorUpholstery);
    headrest.position.set(sx, 1.185, 0.26); // top edge at 1.29 m
    root.add(headrest);
  }

  // Rear bench seat
  const rearSeatGeo = new THREE.BoxGeometry(width * 0.74, 0.54, 0.48);
  const rearSeat = new THREE.Mesh(rearSeatGeo, mats.interiorUpholstery);
  rearSeat.position.set(0, 0.68, 0.92);
  root.add(rearSeat);

  // --- E. Front Fascia, Grille, LED Headlamps (OFF per Fact F4), Rear Taillamps & Plates ---
  const grilleGeo = new THREE.BoxGeometry(0.92, 0.22, 0.06);
  const grille = new THREE.Mesh(grilleGeo, mats.blackTrimPlastic);
  grille.position.set(0, 0.56, -halfL + 0.02);
  root.add(grille);

  const grilleSurroundGeo = new THREE.BoxGeometry(0.96, 0.25, 0.04);
  const grilleSurround = new THREE.Mesh(grilleSurroundGeo, mats.chromeBright);
  grilleSurround.position.set(0, 0.56, -halfL + 0.03);
  root.add(grilleSurround);

  // Lower air dam intake
  const airDamGeo = new THREE.BoxGeometry(1.36, 0.12, 0.06);
  const airDam = new THREE.Mesh(airDamGeo, mats.blackTrimPlastic);
  airDam.position.set(0, 0.30, -halfL + 0.04);
  root.add(airDam);

  // Headlight assemblies (named headlight_L / headlight_R, emissive OFF per Fact F4)
  for (const [side, hName] of [[-1, 'headlight_L'], [1, 'headlight_R']]) {
    const hlGeo = new THREE.BoxGeometry(0.34, 0.13, 0.14);
    const hl = new THREE.Mesh(hlGeo, mats.headlampLensOff);
    hl.name = hName;
    hl.position.set(side * 0.68, 0.64, -halfL + 0.09);
    hl.rotation.y = side * 0.18;
    root.add(hl);
  }

  // Taillight assemblies (named taillight_L / taillight_R)
  for (const [side, tName] of [[-1, 'taillight_L'], [1, 'taillight_R']]) {
    const tlGeo = new THREE.BoxGeometry(0.38, 0.15, 0.10);
    const tl = new THREE.Mesh(tlGeo, mats.taillampLensRed);
    tl.name = tName;
    tl.position.set(side * 0.66, 0.78, halfL - 0.05);
    root.add(tl);
  }

  // Rear license plate recess & plate
  const plateGeo = new THREE.BoxGeometry(0.30, 0.15, 0.02);
  const plate = new THREE.Mesh(plateGeo, mats.paintWhite);
  plate.position.set(0, 0.62, halfL + 0.005);
  root.add(plate);

  // Underbody pan (solid bottom closure)
  const underpanGeo = new THREE.BoxGeometry(width * 0.84, 0.08, length * 0.86);
  const underpan = new THREE.Mesh(underpanGeo, mats.darkSteelChassis);
  underpan.position.set(0, 0.19, 0);
  root.add(underpan);

  // --- F. Four Detailed Wheel Assemblies ---
  const trackHalf = halfW - 0.13;
  for (const [side, sTag] of [[-1, 'L'], [1, 'R']]) {
    const wFront = buildDetailedWheelAssembly(THREE, mats, {
      radius: wheelRadius,
      width: 0.225,
      rimRadius: 0.22,
      isDual: false,
      isCommercial: false,
      side,
      name: `wheel_F${sTag}`,
    });
    wFront.position.set(side * trackHalf, wheelRadius, frontAxleZ);
    root.add(wFront);

    const wRear = buildDetailedWheelAssembly(THREE, mats, {
      radius: wheelRadius,
      width: 0.225,
      rimRadius: 0.22,
      isDual: false,
      isCommercial: false,
      side,
      name: `wheel_R${sTag}`,
    });
    wRear.position.set(side * trackHalf, wheelRadius, rearAxleZ);
    root.add(wRear);
  }

  root.userData.dims = { length, width, height };
  root.userData.driverEye = [-0.38, 1.18, -0.05];
  return root;
}

// 6.3 Witness C's Stopped Full-Size Pickup Truck (veh_wit_C)
function buildPickupTruck(THREE, mats, opts = {}) {
  const {
    id = 'veh_wit_C',
    paintMat = mats.witCPaintCharcoal,
    length = 5.8,
    width = 2.02,
    height = 1.92,
  } = opts;

  const root = new THREE.Group();
  root.name = id;

  const halfL = length * 0.5; // 2.90 m
  const halfW = width * 0.5;  // 1.01 m
  const frontAxleZ = -halfL + 0.98;
  const rearAxleZ = -halfL + 4.66;
  const wheelRadius = 0.39;

  // Frame rails & underbody
  const frameGeo = new THREE.BoxGeometry(width * 0.65, 0.16, length * 0.92);
  const frame = new THREE.Mesh(frameGeo, mats.darkSteelChassis);
  frame.position.set(0, 0.36, 0);
  root.add(frame);

  // Front hood & fenders
  const hoodGeo = new THREE.BoxGeometry(width - 0.06, 0.68, 1.55);
  const hood = new THREE.Mesh(hoodGeo, paintMat);
  hood.position.set(0, 0.82, -halfL + 0.82);
  hood.castShadow = true;
  hood.receiveShadow = true;
  root.add(hood);

  // Crew cab body
  const cabGeo = new THREE.BoxGeometry(width - 0.04, 1.32, 1.95);
  const cab = new THREE.Mesh(cabGeo, paintMat);
  cab.position.set(0, 1.18, -halfL + 2.48);
  cab.castShadow = true;
  cab.receiveShadow = true;
  root.add(cab);

  // Cab windows
  const wsGeo = new THREE.BoxGeometry(width * 0.84, 0.52, 0.04);
  const ws = new THREE.Mesh(wsGeo, mats.autoGlassTinted);
  ws.position.set(0, 1.48, -halfL + 1.50);
  ws.rotation.x = 0.32;
  root.add(ws);

  const sideWinGeo = new THREE.BoxGeometry(width + 0.01, 0.44, 1.48);
  const sideWin = new THREE.Mesh(sideWinGeo, mats.autoGlassTinted);
  sideWin.position.set(0, 1.48, -halfL + 2.52);
  root.add(sideWin);

  // Cargo bed walls & tailgate
  const bedFloorGeo = new THREE.BoxGeometry(width - 0.08, 0.18, 2.22);
  const bedFloor = new THREE.Mesh(bedFloorGeo, mats.blackTrimPlastic);
  bedFloor.position.set(0, 0.62, halfL - 1.15);
  root.add(bedFloor);

  for (const side of [-1, 1]) {
    const bedWallGeo = new THREE.BoxGeometry(0.14, 0.58, 2.24);
    const bedWall = new THREE.Mesh(bedWallGeo, paintMat);
    bedWall.position.set(side * (halfW - 0.09), 0.92, halfL - 1.15);
    bedWall.castShadow = true;
    root.add(bedWall);
  }

  const tailgateGeo = new THREE.BoxGeometry(width - 0.06, 0.58, 0.12);
  const tailgate = new THREE.Mesh(tailgateGeo, paintMat);
  tailgate.position.set(0, 0.92, halfL - 0.08);
  tailgate.castShadow = true;
  root.add(tailgate);

  // Chrome front grille & bumpers
  const grilleGeo = new THREE.BoxGeometry(width * 0.78, 0.42, 0.08);
  const grille = new THREE.Mesh(grilleGeo, mats.chromeBright);
  grille.position.set(0, 0.86, -halfL + 0.04);
  root.add(grille);

  const fBumperGeo = new THREE.BoxGeometry(width, 0.24, 0.18);
  const fBumper = new THREE.Mesh(fBumperGeo, mats.chromeBright);
  fBumper.position.set(0, 0.48, -halfL + 0.08);
  root.add(fBumper);

  const rBumper = new THREE.Mesh(fBumperGeo, mats.chromeBright);
  rBumper.position.set(0, 0.48, halfL - 0.06);
  root.add(rBumper);

  // Four wheels
  const trackHalf = halfW - 0.14;
  for (const [side, sTag] of [[-1, 'L'], [1, 'R']]) {
    const wf = buildDetailedWheelAssembly(THREE, mats, {
      radius: wheelRadius,
      width: 0.25,
      rimRadius: 0.24,
      side,
      name: `wheel_F${sTag}`,
    });
    wf.position.set(side * trackHalf, wheelRadius, frontAxleZ);
    root.add(wf);

    const wr = buildDetailedWheelAssembly(THREE, mats, {
      radius: wheelRadius,
      width: 0.25,
      rimRadius: 0.24,
      side,
      name: `wheel_R${sTag}`,
    });
    wr.position.set(side * trackHalf, wheelRadius, rearAxleZ);
    root.add(wr);
  }

  root.userData.dims = { length, width, height };
  return root;
}

// 6.4 Vehicle T Power Unit: 2014 3-Axle Conventional Commercial Truck-Tractor (veh_T_tractor)
// Spec dimensions: length 6.6 m, width 2.44 m, height 4.0 m (cab + aerodynamic roof fairing),
// wheelbase 5.0 m, axles at 0.95 m, 5.25 m, 6.55 m from front, fifth wheel at y = 1.20 m.
function buildTruckTractor(THREE, mats, opts = {}) {
  const {
    id = 'veh_T_tractor',
    paintMat = mats.tractorPaintWhite,
    length = 6.6,
    width = 2.44,
    height = 3.65,
  } = opts;

  const root = new THREE.Group();
  root.name = id;

  const halfL = length * 0.5; // 3.30 m
  const halfW = width * 0.5;  // 1.22 m
  const steerAxleZ = -halfL + 0.95; // -2.35 m
  const drive1AxleZ = -halfL + 5.10;// +1.80 m
  const drive2AxleZ = -halfL + 6.32;// +3.02 m
  const wheelRadius = 0.52;

  // --- A. Heavy-Duty Twin C-Channel Frame Rails & Crossmembers ---
  for (const side of [-1, 1]) {
    const railGeo = new THREE.BoxGeometry(0.11, 0.26, length - 0.22);
    const rail = new THREE.Mesh(railGeo, mats.darkSteelChassis);
    rail.position.set(side * 0.44, 0.78, 0);
    rail.castShadow = true;
    root.add(rail);
  }
  for (let cz = -halfL + 0.6; cz <= halfL - 0.3; cz += 1.1) {
    const crossGeo = new THREE.BoxGeometry(0.88, 0.18, 0.12);
    const cross = new THREE.Mesh(crossGeo, mats.darkSteelChassis);
    cross.position.set(0, 0.78, cz);
    root.add(cross);
  }

  // --- B. Sloped Conventional Hood, Front Fenders, Chrome Grille & Heavy Bumper ---
  // Sloped aerodynamic hood (from z = -3.22 m to z = -1.42 m)
  const hoodGeo = new THREE.BoxGeometry(1.48, 0.96, 1.80);
  const hood = new THREE.Mesh(hoodGeo, paintMat);
  hood.position.set(0, 1.38, -halfL + 0.98);
  hood.rotation.x = 0.08;
  hood.castShadow = true;
  hood.receiveShadow = true;
  root.add(hood);

  // Front wheel fenders flanking the hood
  for (const side of [-1, 1]) {
    const fenderGeo = new THREE.BoxGeometry(0.46, 0.58, 1.35);
    const fender = new THREE.Mesh(fenderGeo, paintMat);
    fender.position.set(side * 0.96, 0.96, steerAxleZ);
    fender.castShadow = true;
    root.add(fender);

    // Headlamp housing in front fender
    const hlGeo = new THREE.BoxGeometry(0.32, 0.18, 0.10);
    const hl = new THREE.Mesh(hlGeo, mats.headlampLensOff);
    hl.name = side < 0 ? 'headlight_L' : 'headlight_R';
    hl.position.set(side * 0.96, 0.92, -halfL + 0.14);
    root.add(hl);

    // Hood-mounted spot mirrors
    const hmStalkGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.28, 8);
    const hmStalk = new THREE.Mesh(hmStalkGeo, mats.chromeBright);
    hmStalk.position.set(side * 0.88, 1.34, -halfL + 0.45);
    hmStalk.rotation.z = -side * 0.35;
    root.add(hmStalk);

    const hmHeadGeo = new THREE.SphereGeometry(0.08, 12, 10);
    const hmHead = new THREE.Mesh(hmHeadGeo, mats.chromeBright);
    hmHead.scale.set(1, 0.8, 0.45);
    hmHead.position.set(side * 0.96, 1.46, -halfL + 0.45);
    root.add(hmHead);
  }

  // Tall chrome vertical-slat radiator grille
  const grilleSurroundGeo = new THREE.BoxGeometry(1.24, 0.86, 0.08);
  const grilleSurround = new THREE.Mesh(grilleSurroundGeo, mats.chromeBright);
  grilleSurround.position.set(0, 1.34, -halfL + 0.08);
  root.add(grilleSurround);

  for (let gx = -0.52; gx <= 0.52; gx += 0.104) {
    const slatGeo = new THREE.BoxGeometry(0.032, 0.76, 0.095);
    const slat = new THREE.Mesh(slatGeo, mats.chromeBright);
    slat.position.set(gx, 1.34, -halfL + 0.085);
    root.add(slat);
  }

  // Heavy chrome front bumper with tow openings
  const bumperGeo = new THREE.BoxGeometry(width, 0.38, 0.22);
  const bumper = new THREE.Mesh(bumperGeo, mats.chromeBright);
  bumper.position.set(0, 0.58, -halfL + 0.11);
  bumper.castShadow = true;
  root.add(bumper);

  // --- C. Day Cab Structure, Roof Fairing, Windshield, Doors & West-Coast Mirrors ---
  const cabGeo = new THREE.BoxGeometry(2.26, 1.68, 1.82);
  const cab = new THREE.Mesh(cabGeo, paintMat);
  cab.position.set(0, 1.94, -halfL + 2.72);
  cab.castShadow = true;
  cab.receiveShadow = true;
  root.add(cab);

  // Aerodynamic roof fairing rising to y = 3.65 m (matches semitrailer nose)
  const fairingShape = new THREE.Shape();
  fairingShape.moveTo(-0.88, 0);
  fairingShape.quadraticCurveTo(-0.35, 0.65, 0.88, 0.86);
  fairingShape.lineTo(0.88, 0);
  fairingShape.closePath();
  const fairingGeo = new THREE.ExtrudeGeometry(fairingShape, {
    steps: 1,
    depth: 2.16,
    bevelEnabled: true,
    bevelThickness: 0.04,
    bevelSize: 0.04,
    bevelSegments: 2,
  });
  fairingGeo.rotateY(-Math.PI / 2);
  fairingGeo.translate(1.08, 2.76, -halfL + 2.72);
  const fairing = new THREE.Mesh(fairingGeo, paintMat);
  fairing.castShadow = true;
  root.add(fairing);

  // Split/curved front windshield glass
  const wsGeo = new THREE.BoxGeometry(1.98, 0.66, 0.04);
  const ws = new THREE.Mesh(wsGeo, mats.autoGlassTinted);
  ws.position.set(0, 2.26, -halfL + 1.81);
  ws.rotation.x = 0.22;
  root.add(ws);

  // Exterior sun visor & 5 amber roof clearance lamps
  const visorGeo = new THREE.BoxGeometry(2.14, 0.12, 0.28);
  const visor = new THREE.Mesh(visorGeo, mats.chromeBright);
  visor.position.set(0, 2.66, -halfL + 1.76);
  visor.rotation.x = 0.25;
  root.add(visor);

  for (const mx of [-0.82, -0.41, 0, 0.41, 0.82]) {
    const mLampGeo = new THREE.BoxGeometry(0.08, 0.045, 0.06);
    const mLamp = new THREE.Mesh(mLampGeo, mats.markerAmber);
    mLamp.position.set(mx, 2.75, -halfL + 1.82);
    root.add(mLamp);
  }

  // Side cab windows, West-Coast dual mirror brackets, cab steps, vertical chrome exhaust stacks, polished fuel tanks
  for (const side of [-1, 1]) {
    const sideGlassGeo = new THREE.BoxGeometry(0.04, 0.58, 0.86);
    const sideGlass = new THREE.Mesh(sideGlassGeo, mats.autoGlassTinted);
    sideGlass.position.set(side * 1.12, 2.22, -halfL + 2.38);
    root.add(sideGlass);

    // West-Coast C-loop mirror arm + main/convex mirror heads
    const armTopGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.36, 8);
    armTopGeo.rotateZ(Math.PI / 2);
    const armTop = new THREE.Mesh(armTopGeo, mats.chromeBright);
    armTop.position.set(side * 1.28, 2.46, -halfL + 2.02);
    root.add(armTop);

    const armBot = new THREE.Mesh(armTopGeo, mats.chromeBright);
    armBot.position.set(side * 1.28, 1.88, -halfL + 2.02);
    root.add(armBot);

    const mirrorHousingGeo = new THREE.BoxGeometry(0.08, 0.46, 0.18);
    const mirrorHousing = new THREE.Mesh(mirrorHousingGeo, mats.chromeBright);
    mirrorHousing.position.set(side * 1.44, 2.18, -halfL + 2.02);
    root.add(mirrorHousing);

    // Polished cylindrical aluminum saddle fuel tanks (between steer and drive axles)
    const tankGeo = new THREE.CylinderGeometry(0.34, 0.34, 1.65, 20);
    tankGeo.rotateX(Math.PI / 2);
    const tank = new THREE.Mesh(tankGeo, mats.chromeBright);
    tank.position.set(side * 0.86, 0.72, -halfL + 2.95);
    tank.castShadow = true;
    root.add(tank);

    // Cab entry steps mounted ahead of fuel tank
    for (const sy of [0.46, 0.72]) {
      const stepGeo = new THREE.BoxGeometry(0.24, 0.04, 0.68);
      const step = new THREE.Mesh(stepGeo, mats.galvanizedSteel);
      step.position.set(side * 1.08, sy, -halfL + 2.05);
      root.add(step);
    }

    // Vertical chrome exhaust stack behind cab corner
    const stackGeo = new THREE.CylinderGeometry(0.075, 0.085, 2.45, 16);
    const stack = new THREE.Mesh(stackGeo, mats.chromeBright);
    stack.position.set(side * 1.12, 2.25, -halfL + 3.68);
    stack.castShadow = true;
    root.add(stack);

    // Rear quarter fender over forward drive axle + black mudflaps behind rear drive axle
    const qFenderGeo = new THREE.BoxGeometry(0.58, 0.18, 0.65);
    const qFender = new THREE.Mesh(qFenderGeo, mats.blackTrimPlastic);
    qFender.position.set(side * 0.92, 1.05, drive1AxleZ - 0.48);
    root.add(qFender);

    const flapGeo = new THREE.BoxGeometry(0.58, 0.68, 0.025);
    const flap = new THREE.Mesh(flapGeo, mats.tireRubber);
    flap.position.set(side * 0.92, 0.48, halfL - 0.02);
    root.add(flap);
  }

  // --- D. Fifth-Wheel Coupling Plate Assembly at y = 1.20 m ---
  const fifthBaseGeo = new THREE.BoxGeometry(0.96, 0.10, 0.86);
  const fifthBase = new THREE.Mesh(fifthBaseGeo, mats.darkSteelChassis);
  fifthBase.position.set(0, 1.08, (drive1AxleZ + drive2AxleZ) * 0.5);
  root.add(fifthBase);

  const fifthPlateGeo = new THREE.CylinderGeometry(0.46, 0.48, 0.08, 20);
  const fifthPlate = new THREE.Mesh(fifthPlateGeo, mats.darkSteelChassis);
  fifthPlate.position.set(0, 1.18, (drive1AxleZ + drive2AxleZ) * 0.5);
  fifthPlate.rotation.x = 0.08;
  root.add(fifthPlate);

  // --- E. Three Axles (Steer + Tandem Dual Drive) ---
  for (const [side, sTag] of [[-1, 'L'], [1, 'R']]) {
    // Steer axle wheel
    const wSteer = buildDetailedWheelAssembly(THREE, mats, {
      radius: wheelRadius,
      width: 0.28,
      rimRadius: 0.28,
      isDual: false,
      isCommercial: true,
      side,
      name: `wheel_steer_${sTag}`,
    });
    wSteer.position.set(side * 1.02, wheelRadius, steerAxleZ);
    root.add(wSteer);

    // Tandem drive axle 1 (dual wheels)
    const wDrive1 = buildDetailedWheelAssembly(THREE, mats, {
      radius: wheelRadius,
      width: 0.26,
      rimRadius: 0.28,
      isDual: true,
      isCommercial: true,
      side,
      name: `wheel_drive1_${sTag}`,
    });
    wDrive1.position.set(side * 0.88, wheelRadius, drive1AxleZ);
    root.add(wDrive1);

    // Tandem drive axle 2 (dual wheels)
    const wDrive2 = buildDetailedWheelAssembly(THREE, mats, {
      radius: wheelRadius,
      width: 0.26,
      rimRadius: 0.28,
      isDual: true,
      isCommercial: true,
      side,
      name: `wheel_drive2_${sTag}`,
    });
    wDrive2.position.set(side * 0.88, wheelRadius, drive2AxleZ);
    root.add(wDrive2);
  }

  // Solid axle tubes
  for (const az of [steerAxleZ, drive1AxleZ, drive2AxleZ]) {
    const axleGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.85, 12);
    axleGeo.rotateZ(Math.PI / 2);
    const axle = new THREE.Mesh(axleGeo, mats.darkSteelChassis);
    axle.position.set(0, wheelRadius, az);
    root.add(axle);
  }

  root.userData.dims = { length, width, height };
  return root;
}

// 6.5 Vehicle T Struck Semitrailer: 2003 53-ft Refrigerated Van Semitrailer (veh_T_trailer)
// Spec dimensions: length 16.15 m (z = -8.075 to +8.075), width 2.59 m (x = -1.295 to +1.295),
// height 4.11 m, box bottom underride height 1.20 m (box height 2.91 m), origin at footprint center.
// CRITICAL SIGHTLINE REQUIREMENT (Section 4):
// "the semitrailer must present continuous solid geometry along its whole length between about
//  0.5 m and 4.1 m above ground on both sides: closed van box (floor ~1.25 m to roof 4.1 m),
//  PLUS full-length aerodynamic side skirts (0.45 m .. 1.3 m) on both sides between the landing
//  gear and the rear tandem, the tandem axle group, landing gear, rear impact guard. Do not leave
//  a see-through gap under the trailer side."
function buildRefrigeratedSemitrailer(THREE, mats, opts = {}) {
  const {
    id = 'veh_T_trailer',
    length = 16.15,
    width = 2.59,
    height = 4.11,
    boxBottomY = 1.20,
  } = opts;

  const root = new THREE.Group();
  root.name = id;

  const halfL = length * 0.5; // 8.075 m
  const halfW = width * 0.5;  // 1.295 m
  const boxHeight = height - boxBottomY; // 2.91 m
  const boxCenterY = boxBottomY + boxHeight * 0.5; // 2.655 m
  const tandem1Z = -halfL + 12.50; // +4.425 m
  const tandem2Z = -halfL + 13.72; // +5.645 m
  const wheelRadius = 0.52;

  // --- A. Main Insulated Refrigerated Van Box (y = 1.20 m to 4.11 m) ---
  const boxGeo = new THREE.BoxGeometry(width, boxHeight, length);
  const boxMesh = new THREE.Mesh(boxGeo, mats.trailerBoxWhite);
  boxMesh.name = 'trailer_van_box';
  boxMesh.position.set(0, boxCenterY, 0);
  boxMesh.castShadow = true;
  boxMesh.receiveShadow = true;
  root.add(boxMesh);

  // Upper & lower extruded aluminum rub rails on both sides and front corner caps
  for (const side of [-1, 1]) {
    const topRailGeo = new THREE.BoxGeometry(0.04, 0.11, length + 0.02);
    const topRail = new THREE.Mesh(topRailGeo, mats.galvanizedSteel);
    topRail.position.set(side * halfW, height - 0.055, 0);
    root.add(topRail);

    const botRailGeo = new THREE.BoxGeometry(0.045, 0.14, length + 0.02);
    const botRail = new THREE.Mesh(botRailGeo, mats.galvanizedSteel);
    botRail.position.set(side * halfW, boxBottomY + 0.07, 0);
    root.add(botRail);
  }

  // --- B. Nose-Mounted Refrigeration Unit (Reefer) at Front Wall (z = -halfL) ---
  // Deposition 13:19: "It had one of those refrigeration units on the front of the trailer, I could hear it humming."
  const reeferGeo = new THREE.BoxGeometry(1.78, 1.95, 0.54);
  const reefer = new THREE.Mesh(reeferGeo, mats.reeferHousing);
  reefer.name = 'reefer_unit';
  reefer.position.set(0, 2.72, -halfL - 0.25);
  reefer.castShadow = true;
  root.add(reefer);

  const reeferGrilleGeo = new THREE.BoxGeometry(1.42, 0.96, 0.06);
  const reeferGrille = new THREE.Mesh(reeferGrilleGeo, mats.blackTrimPlastic);
  reeferGrille.position.set(0, 2.95, -halfL - 0.51);
  root.add(reeferGrille);

  // Kingpin at z = -halfL + 0.91 m
  const kingpinGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.14, 12);
  const kingpin = new THREE.Mesh(kingpinGeo, mats.darkSteelChassis);
  kingpin.position.set(0, boxBottomY - 0.07, -halfL + 0.91);
  root.add(kingpin);

  // --- C. Continuous Under-Floor I-Beam Subframe & Full-Length Aerodynamic Side Skirts ---
  // Central longitudinal I-beam chassis spine (runs full length underneath floor)
  const spineGeo = new THREE.BoxGeometry(1.18, 0.42, length - 1.2);
  const spine = new THREE.Mesh(spineGeo, mats.darkSteelChassis);
  spine.position.set(0, 1.02, 0.2);
  spine.castShadow = true;
  root.add(spine);

  // Full-length aerodynamic side skirts on both sides (y = 0.42 m to 1.25 m) + forward apron closure
  // Ensures continuous solid occlusion between 0.42 m and 4.11 m along the trailer length
  for (const side of [-1, 1]) {
    // Main aerodynamic side skirt spanning from nose/landing gear through to rear tandem
    const skirtGeo = new THREE.BoxGeometry(0.06, 0.84, length - 1.4);
    const skirt = new THREE.Mesh(skirtGeo, mats.trailerPlainWhite);
    skirt.name = side < 0 ? 'side_skirt_L' : 'side_skirt_R';
    skirt.position.set(side * (halfW - 0.05), 0.84, 0.1);
    skirt.castShadow = true;
    skirt.receiveShadow = true;
    root.add(skirt);

    // Lower black rubber flexible skirt lip (y = 0.36 to 0.46 m)
    const skirtLipGeo = new THREE.BoxGeometry(0.05, 0.12, length - 1.4);
    const skirtLip = new THREE.Mesh(skirtLipGeo, mats.blackTrimPlastic);
    skirtLip.position.set(side * (halfW - 0.05), 0.40, 0.1);
    root.add(skirtLip);
  }

  // --- D. Heavy-Duty Telescoping Landing Gear & Cross-Bracing (at z = -halfL + 3.45 m) ---
  const lgZ = -halfL + 3.45;
  for (const side of [-1, 1]) {
    const legGeo = new THREE.BoxGeometry(0.14, 0.92, 0.14);
    const leg = new THREE.Mesh(legGeo, mats.darkSteelChassis);
    leg.position.set(side * 0.92, 0.78, lgZ);
    leg.castShadow = true;
    root.add(leg);

    const shoeGeo = new THREE.BoxGeometry(0.28, 0.05, 0.28);
    const shoe = new THREE.Mesh(shoeGeo, mats.darkSteelChassis);
    shoe.position.set(side * 0.92, 0.34, lgZ);
    root.add(shoe);
  }
  const lgBraceGeo = new THREE.CylinderGeometry(0.028, 0.028, 1.92, 8);
  lgBraceGeo.rotateZ(Math.PI / 2);
  const lgBrace = new THREE.Mesh(lgBraceGeo, mats.darkSteelChassis);
  lgBrace.position.set(0, 0.72, lgZ);
  root.add(lgBrace);

  // --- E. FMVSS 108 DOT Retroreflective Conspicuity Tape & Side-Marker Lamps ---
  // Alternating 0.45 m red (#c41e3a) and 0.30 m white (#f5f5f5) 50 mm strip along bottom rail (y = 1.24 m)
  const segPitch = 0.75;
  for (let z = -halfL + 0.4; z <= halfL - 0.6; z += segPitch) {
    for (const side of [-1, 1]) {
      const redSegGeo = new THREE.BoxGeometry(0.012, 0.055, 0.44);
      const redSeg = new THREE.Mesh(redSegGeo, mats.dotTapeRed);
      redSeg.position.set(side * (halfW + 0.022), 1.24, z);
      root.add(redSeg);

      const whiteSegGeo = new THREE.BoxGeometry(0.012, 0.055, 0.29);
      const whiteSeg = new THREE.Mesh(whiteSegGeo, mats.dotTapeWhite);
      whiteSeg.position.set(side * (halfW + 0.022), 1.24, z + 0.37);
      root.add(whiteSeg);
    }
  }

  // Amber side-marker lamps along bottom rail (police_report.txt p.1: "Hood scraped by trailer side-marker lamp")
  for (const mz of [-halfL + 0.35, 0, halfL - 0.35]) {
    for (const side of [-1, 1]) {
      const smGeo = new THREE.BoxGeometry(0.035, 0.05, 0.11);
      const sm = new THREE.Mesh(smGeo, mz > halfL - 1 ? mats.taillampLensRed : mats.markerAmber);
      sm.position.set(side * (halfW + 0.025), 1.21, mz);
      root.add(sm);
    }
  }

  // --- F. Rear Swing Barn Doors, Vertical Locking Rods, Hinges & Rear Impact Guard (ICC Bumper) ---
  for (const side of [-1, 1]) {
    // Door panel outline
    const doorGeo = new THREE.BoxGeometry(width * 0.47, boxHeight - 0.14, 0.04);
    const door = new THREE.Mesh(doorGeo, mats.trailerPlainWhite);
    door.position.set(side * (width * 0.24), boxCenterY, halfL + 0.015);
    root.add(door);

    // Two vertical galvanized locking bars per door
    for (const barX of [side * 0.24, side * 0.56]) {
      const rodGeo = new THREE.CylinderGeometry(0.018, 0.018, boxHeight - 0.18, 8);
      const rod = new THREE.Mesh(rodGeo, mats.galvanizedSteel);
      rod.position.set(barX, boxCenterY, halfL + 0.045);
      root.add(rod);
    }

    // 4 door hinges along outer edge
    for (let hy = boxBottomY + 0.35; hy <= height - 0.35; hy += 0.72) {
      const hingeGeo = new THREE.BoxGeometry(0.14, 0.06, 0.05);
      const hinge = new THREE.Mesh(hingeGeo, mats.galvanizedSteel);
      hinge.position.set(side * (halfW - 0.08), hy, halfL + 0.035);
      root.add(hinge);
    }

    // Upper rear corner white inverted-L DOT conspicuity strips
    const topLGeo = new THREE.BoxGeometry(0.32, 0.05, 0.02);
    const topL = new THREE.Mesh(topLGeo, mats.dotTapeWhite);
    topL.position.set(side * (halfW - 0.20), height - 0.12, halfL + 0.035);
    root.add(topL);
  }

  // Rear underride impact guard (ICC bar) at z = +halfL
  for (const side of [-1, 1]) {
    const postGeo = new THREE.BoxGeometry(0.12, 0.72, 0.12);
    const post = new THREE.Mesh(postGeo, mats.galvanizedSteel);
    post.position.set(side * 0.78, 0.86, halfL - 0.08);
    root.add(post);
  }
  const iccBarGeo = new THREE.BoxGeometry(width - 0.16, 0.12, 0.12);
  const iccBar = new THREE.Mesh(iccBarGeo, mats.galvanizedSteel);
  iccBar.position.set(0, 0.52, halfL - 0.06);
  root.add(iccBar);

  // DOT red/white tape on ICC bar and lower rear sill
  for (let rx = -halfW + 0.25; rx <= halfW - 0.25; rx += 0.50) {
    const rSeg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.05, 0.02), mats.dotTapeRed);
    rSeg.position.set(rx - 0.12, 0.52, halfL + 0.01);
    root.add(rSeg);

    const wSeg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.05, 0.02), mats.dotTapeWhite);
    wSeg.position.set(rx + 0.12, 0.52, halfL + 0.01);
    root.add(wSeg);
  }

  // --- G. Sliding Rear Tandem Bogie & Dual Wheels ---
  const bogieGeo = new THREE.BoxGeometry(1.92, 0.42, 2.45);
  const bogie = new THREE.Mesh(bogieGeo, mats.darkSteelChassis);
  bogie.position.set(0, 0.82, (tandem1Z + tandem2Z) * 0.5);
  bogie.castShadow = true;
  root.add(bogie);

  for (const [side, sTag] of [[-1, 'L'], [1, 'R']]) {
    const wTandem1 = buildDetailedWheelAssembly(THREE, mats, {
      radius: wheelRadius,
      width: 0.26,
      rimRadius: 0.28,
      isDual: true,
      isCommercial: true,
      side,
      name: `wheel_tandem1_${sTag}`,
    });
    wTandem1.position.set(side * 0.94, wheelRadius, tandem1Z);
    root.add(wTandem1);

    const wTandem2 = buildDetailedWheelAssembly(THREE, mats, {
      radius: wheelRadius,
      width: 0.26,
      rimRadius: 0.28,
      isDual: true,
      isCommercial: true,
      side,
      name: `wheel_tandem2_${sTag}`,
    });
    wTandem2.position.set(side * 0.94, wheelRadius, tandem2Z);
    root.add(wTandem2);

    // Rear mudflaps behind tandem2
    const flapGeo = new THREE.BoxGeometry(0.62, 0.65, 0.025);
    const flap = new THREE.Mesh(flapGeo, mats.tireRubber);
    flap.position.set(side * 0.94, 0.48, tandem2Z + 0.68);
    root.add(flap);
  }

  root.userData.dims = { length, width, height };
  return root;
}

// -------------------------------------------------------------------------------------------------
// SECTION 7: DEDICATED SCENE-SPEC ELEMENT BUILDERS (ALL 42 INVENTORY ELEMENTS)
// -------------------------------------------------------------------------------------------------
// Every element from the Scene Spec is built by a dedicated builder function with exact positions,
// dimensions, materials, occludes flags, and citations. Every registered object id uses one of the
// allowed Contract v1 prefixes: veh_ | occ_ | sig_ | road_ | mark_ | bld_.

// 7.1 Element #1: ground_base -> registered as road_ground_base
function buildGroundBase(THREE, mats) {
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(1800, 1800, 32, 32);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mats.groundPasture);
  mesh.position.set(-50, -0.015, 0);
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

// 7.2 Element #2: road_eb (US-27A Eastbound travel lanes: inside z = -5.49..-1.83, outside z = -1.83..+1.83)
function buildRoadEB(THREE, mats) {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(880, 0.02, 7.32);
  const mesh = new THREE.Mesh(geo, mats.asphaltMain);
  mesh.position.set(-50, 0.0, -1.83);
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

// 7.3 Element #3: shoulder_eb_south -> registered as road_shoulder_eb_south
function buildShoulderEBSouth(THREE, mats) {
  const group = new THREE.Group();
  // West segment (x = -490 to -6 m)
  const wLen = 484;
  const wMesh = new THREE.Mesh(new THREE.BoxGeometry(wLen, 0.018, 1.52), mats.asphaltShoulder);
  wMesh.position.set(-6 - wLen * 0.5, -0.001, 2.59);
  wMesh.receiveShadow = true;
  group.add(wMesh);

  // East segment (x = +6 to +390 m)
  const eLen = 384;
  const eMesh = new THREE.Mesh(new THREE.BoxGeometry(eLen, 0.018, 1.52), mats.asphaltShoulder);
  eMesh.position.set(6 + eLen * 0.5, -0.001, 2.59);
  eMesh.receiveShadow = true;
  group.add(eMesh);
  return group;
}

// 7.4 Element #4: shoulder_eb_north -> registered as road_shoulder_eb_north
function buildShoulderEBNorth(THREE, mats) {
  const group = new THREE.Group();
  // West of crossover (x = -490 to -19.8 m)
  const wLen = 470.2;
  const wMesh = new THREE.Mesh(new THREE.BoxGeometry(wLen, 0.018, 0.61), mats.asphaltShoulder);
  wMesh.position.set(-19.8 - wLen * 0.5, -0.001, -5.795);
  wMesh.receiveShadow = true;
  group.add(wMesh);

  // East of crossover (x = +19.8 to +390 m)
  const eLen = 370.2;
  const eMesh = new THREE.Mesh(new THREE.BoxGeometry(eLen, 0.018, 0.61), mats.asphaltShoulder);
  eMesh.position.set(19.8 + eLen * 0.5, -0.001, -5.795);
  eMesh.receiveShadow = true;
  group.add(eMesh);
  return group;
}

// 7.5 Element #5: road_wb (US-27A Westbound travel lanes: z = -36.58 to -29.26, centered at z = -32.92)
function buildRoadWB(THREE, mats) {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(880, 0.02, 7.32);
  const mesh = new THREE.Mesh(geo, mats.asphaltMain);
  mesh.position.set(-50, 0.0, -32.92);
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

// 7.6 Element #6: shoulder_wb_north -> registered as road_shoulder_wb_north
function buildShoulderWBNorth(THREE, mats) {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(880, 0.018, 1.52);
  const mesh = new THREE.Mesh(geo, mats.asphaltShoulder);
  mesh.position.set(-50, -0.001, -37.34);
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

// 7.7 Element #7: shoulder_wb_south -> registered as road_shoulder_wb_south
function buildShoulderWBSouth(THREE, mats) {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(420.2, 0.018, 0.61);
  const mesh = new THREE.Mesh(geo, mats.asphaltShoulder);
  mesh.position.set(-229.9, -0.001, -28.955);
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

// 7.8 Element #8: road_wb_turn (WB left-turn lane: 187.4 m storage + taper at z = -27.43)
function buildRoadWBTurn(THREE, mats) {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(187.4, 0.02, 3.66);
  const mesh = new THREE.Mesh(geo, mats.asphaltTurn);
  mesh.position.set(73.9, 0.0, -27.43);
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

// 7.9 Element #9: road_eb_turn (EB auxiliary turn lane taper west of crossover)
function buildRoadEBTurn(THREE, mats) {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(167.6, 0.019, 3.66);
  const mesh = new THREE.Mesh(geo, mats.asphaltTurn);
  mesh.position.set(-103.6, -0.0005, 3.66);
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

// 7.10 Element #10: road_median_w (Grassy/earthen median west of crossover)
function buildRoadMedianW(THREE, mats) {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(420.2, 0.03, 18.28);
  const mesh = new THREE.Mesh(geo, mats.medianGrass);
  mesh.position.set(-229.9, 0.0, -15.24);
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

// 7.11 Element #11: road_median_e (Grassy/earthen median east of crossover)
function buildRoadMedianE(THREE, mats) {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(320.2, 0.03, 18.28);
  const mesh = new THREE.Mesh(geo, mats.medianGrass);
  mesh.position.set(179.9, 0.0, -15.24);
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

// 7.12 Element #12: road_crossover (Uncontrolled 39.6 m paved median crossover at NE 140th Ct)
function buildRoadCrossover(THREE, mats) {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(39.6, 0.02, 23.77);
  const mesh = new THREE.Mesh(geo, mats.asphaltCrossover);
  mesh.position.set(0, 0.0, -17.375);
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

// 7.13 Element #13: road_ne140 (NE 140th Court local paved road running south from US-27A)
function buildRoadNE140(THREE, mats) {
  const group = new THREE.Group();
  // Main 6.1 m wide roadbed running south from z = 1.83 m to z = 150 m
  const geo = new THREE.BoxGeometry(6.1, 0.02, 146.6);
  const mesh = new THREE.Mesh(geo, mats.asphaltSideRoad);
  mesh.position.set(0, 0.0, 76.7);
  mesh.receiveShadow = true;
  group.add(mesh);

  // Flared intersection corner aprons connecting NE 140th Ct to EB outside lane
  const apronGeo = new THREE.BoxGeometry(12.2, 0.019, 3.6);
  const apronMesh = new THREE.Mesh(apronGeo, mats.asphaltSideRoad);
  apronMesh.position.set(0, 0.0, 3.6);
  apronMesh.receiveShadow = true;
  group.add(apronMesh);

  // Double-yellow centerline on NE 140th Ct south of stop bar (z = 8.0 to 148 m)
  for (const cx of [-0.09, 0.09]) {
    const lineGeo = new THREE.BoxGeometry(0.12, 0.004, 140);
    const line = new THREE.Mesh(lineGeo, mats.paintYellow);
    line.position.set(cx, 0.014, 78);
    group.add(line);
  }
  return group;
}

// 7.14 Element #14: occ_crest (Vertical crest of US-27A at 345 m west of intersection)
// Placed west of Vehicle A's t = 0 start position (x = -350.02 m) so that at t = 0..10.43 s
// Vehicle A is East of the crest occlusion mass, while any sightline looking past the crest
// (x < -354 m) is physically blocked by the rising highway grade.
function buildOccCrest(THREE, mats) {
  const group = new THREE.Group();
  // Graded terrain mound & roadbed rise west of x = -354 m
  const crestRoadGeo = new THREE.BoxGeometry(68, 7.4, 80);
  const crestRoad = new THREE.Mesh(crestRoadGeo, mats.groundPasture);
  crestRoad.position.set(-390, 3.7, -15);
  crestRoad.castShadow = true;
  crestRoad.receiveShadow = true;
  group.add(crestRoad);

  // Visual sloped asphalt ramp on the western horizon (x = -353 to -425 m)
  const rampGeo = new THREE.BoxGeometry(72, 0.15, 42);
  const ramp = new THREE.Mesh(rampGeo, mats.asphaltMain);
  ramp.position.set(-389, 3.7, -17.37);
  ramp.rotation.z = -0.102;
  group.add(ramp);

  return group;
}

// 7.15 Element #15 & #16: Broken White Lane Lines (mark_eb_lane_line, mark_wb_lane_line) + RPMs
// Uses InstancedMesh for crisp 3.05 m (10 ft) stripes with 9.14 m (30 ft) gaps and retroreflective RPMs.
function buildBrokenLaneLine(THREE, mats, zCoord, xStart = -440, xEnd = 340, skipCrossover = false) {
  const group = new THREE.Group();
  const cycle = 12.192; // 40 ft
  const stripeLen = 3.048; // 10 ft
  const positions = [];
  for (let x = xStart; x <= xEnd; x += cycle) {
    if (skipCrossover && x > -20 && x < 20) continue;
    positions.push(x + stripeLen * 0.5);
  }

  const stripeGeo = new THREE.BoxGeometry(stripeLen, 0.004, 0.15);
  const inst = new THREE.InstancedMesh(stripeGeo, mats.paintWhite, positions.length);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < positions.length; i++) {
    dummy.position.set(positions[i], 0.014, zCoord);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  }
  inst.instanceMatrix.needsUpdate = true;
  group.add(inst);

  // Raised Pavement Markers (RPMs) centered in gaps
  const rpmGeo = new THREE.BoxGeometry(0.10, 0.018, 0.10);
  const rpmInst = new THREE.InstancedMesh(rpmGeo, mats.rpmBodyWhite, positions.length);
  for (let i = 0; i < positions.length; i++) {
    dummy.position.set(positions[i] + 6.1, 0.019, zCoord);
    dummy.updateMatrix();
    rpmInst.setMatrixAt(i, dummy.matrix);
  }
  rpmInst.instanceMatrix.needsUpdate = true;
  group.add(rpmInst);

  return group;
}

// 7.16 Solid Longitudinal Edge / Channel Line Helper (Elements #17 - #23)
function buildSolidLine(THREE, mats, xStart, xEnd, zCoord, isYellow = false, width = 0.15) {
  const group = new THREE.Group();
  const len = Math.abs(xEnd - xStart);
  const cx = (xStart + xEnd) * 0.5;
  const geo = new THREE.BoxGeometry(len, 0.004, width);
  const mesh = new THREE.Mesh(geo, isYellow ? mats.paintYellow : mats.paintWhite);
  mesh.position.set(cx, 0.014, zCoord);
  group.add(mesh);
  return group;
}

// 7.17 Element #24: mark_wb_turn_arrows (3 MUTCD Left-Turn Lane-Use Arrows at x = 25, 65, 115 m, z = -27.43 m)
function buildWBTurnArrows(THREE, mats) {
  const group = new THREE.Group();
  const arrowXPositions = [25, 65, 115];

  for (const ax of arrowXPositions) {
    const arrow = new THREE.Group();
    arrow.position.set(ax, 0.015, -27.43);

    // Stem pointing west (-X)
    const stem = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.004, 0.22), mats.paintWhite);
    stem.position.set(0.35, 0, -0.25);
    arrow.add(stem);

    // Curved elbow turning south (+Z) for WB left turn across median
    const elbow = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.004, 0.62), mats.paintWhite);
    elbow.position.set(-0.32, 0, 0.02);
    arrow.add(elbow);

    // Arrowhead pointing south (+Z)
    const headShape = new THREE.Shape();
    headShape.moveTo(0, 0.42);
    headShape.lineTo(-0.42, -0.05);
    headShape.lineTo(0.42, -0.05);
    headShape.closePath();
    const headGeo = new THREE.ShapeGeometry(headShape);
    headGeo.rotateX(Math.PI / 2);
    const head = new THREE.Mesh(headGeo, mats.paintWhite);
    head.position.set(-0.32, 0.002, 0.34);
    arrow.add(head);

    group.add(arrow);
  }
  return group;
}

// 7.18 Element #25: mark_ne140_stop_line (16-in / 0.40 m solid white stop bar on NB NE 140th Ct)
function buildNE140StopLine(THREE, mats) {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(3.05, 0.005, 0.40);
  const mesh = new THREE.Mesh(geo, mats.paintWhite);
  mesh.position.set(1.525, 0.015, 5.5);
  group.add(mesh);
  return group;
}

// 7.19 Element #26: sign_stop_ne140 -> registered as sig_stop_ne140 (kind: 'sign', occludes: false)
function buildStopSignNE140(THREE, mats) {
  const group = new THREE.Group();
  group.position.set(4.2, 0, 6.0);
  group.rotation.y = -180 * D2R; // Faces South (+Z) toward northbound traffic on NE 140th Ct

  // Galvanized U-channel post (height 2.85 m, narrow 0.06 m profile)
  const postGeo = new THREE.BoxGeometry(0.06, 2.85, 0.04);
  const post = new THREE.Mesh(postGeo, mats.galvanizedSteel);
  post.position.set(0, 1.425, 0);
  post.castShadow = true;
  group.add(post);

  // Octagonal 30x30 in (0.76 x 0.76 m) sign panel, bottom at 2.13 m (7 ft)
  const r = 0.38;
  const k = r * 0.41421356;
  const octShape = new THREE.Shape();
  octShape.moveTo(-k, -r);
  octShape.lineTo(k, -r);
  octShape.lineTo(r, -k);
  octShape.lineTo(r, k);
  octShape.lineTo(k, r);
  octShape.lineTo(-k, r);
  octShape.lineTo(-r, k);
  octShape.lineTo(-r, -k);
  octShape.closePath();

  const octGeo = new THREE.ExtrudeGeometry(octShape, { steps: 1, depth: 0.006, bevelEnabled: false });
  // Map UVs 0..1 across [-r, r]
  const uv = octGeo.attributes.uv;
  const pos = octGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, (pos.getX(i) + r) / (2 * r), (pos.getY(i) + r) / (2 * r));
  }
  uv.needsUpdate = true;

  const face = new THREE.Mesh(octGeo, mats.stopSignFace);
  face.position.set(0, 2.51, -0.028);
  face.rotation.y = Math.PI; // Front face toward local -Z (which is rotated 180 deg to +Z South)
  face.castShadow = true;
  group.add(face);

  const backPlate = new THREE.Mesh(octGeo, mats.galvanizedSteel);
  backPlate.position.set(0, 2.51, -0.022);
  group.add(backPlate);

  return group;
}

// 7.20 Element #27: sign_speed_eb -> registered as sig_speed_eb (SPEED LIMIT 65, kind: 'sign')
function buildSpeedLimitSignEB(THREE, mats) {
  const group = new THREE.Group();
  group.position.set(-180, 0, 5.2);
  group.rotation.y = -270 * D2R; // Faces West (-X) toward eastbound traffic

  const postGeo = new THREE.BoxGeometry(0.07, 3.1, 0.05);
  const post = new THREE.Mesh(postGeo, mats.galvanizedSteel);
  post.position.set(0, 1.55, 0);
  post.castShadow = true;
  group.add(post);

  const panelGeo = new THREE.BoxGeometry(0.91, 1.22, 0.01);
  const panel = new THREE.Mesh(panelGeo, mats.speedSignFace);
  panel.position.set(0, 2.74, -0.032);
  panel.castShadow = true;
  group.add(panel);

  return group;
}

// 7.21 Element #28: bld_store (Retail store on SE corner: x = 18, z = 19, 18 m W x 12 m D x 4.5 m H)
function buildRetailStore(THREE, mats) {
  const group = new THREE.Group();
  group.position.set(18, 0, 19);

  const W = 18.0; // along X (x = 9 to 27 m)
  const D = 12.0; // along Z (z = 13 to 25 m)
  const H = 4.5;

  // Main painted stucco / CMU building shell
  const bodyGeo = new THREE.BoxGeometry(W, H, D);
  const body = new THREE.Mesh(bodyGeo, mats.storeStucco);
  body.name = 'store_main_structure';
  body.position.set(0, H * 0.5, 0);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Concrete perimeter foundation plinth
  const plinthGeo = new THREE.BoxGeometry(W + 0.16, 0.28, D + 0.16);
  const plinth = new THREE.Mesh(plinthGeo, mats.concreteDriveway);
  plinth.position.set(0, 0.14, 0);
  group.add(plinth);

  // Dark brown cornice parapet trim & metal commercial roof
  const parapetGeo = new THREE.BoxGeometry(W + 0.24, 0.36, D + 0.24);
  const parapet = new THREE.Mesh(parapetGeo, mats.storeTrimBrown);
  parapet.position.set(0, H - 0.12, 0);
  parapet.castShadow = true;
  group.add(parapet);

  const roofGeo = new THREE.BoxGeometry(W - 0.2, 0.12, D - 0.2);
  const roof = new THREE.Mesh(roofGeo, mats.storeRoofMetal);
  roof.position.set(0, H + 0.04, 0);
  group.add(roof);

  // Rooftop packaged HVAC unit
  const hvacGeo = new THREE.BoxGeometry(2.1, 0.95, 1.6);
  const hvac = new THREE.Mesh(hvacGeo, mats.galvanizedSteel);
  hvac.position.set(3.2, H + 0.52, 1.5);
  hvac.castShadow = true;
  group.add(hvac);

  // Storefront Fascia Sign on North facade facing US-27A
  const signGeo = new THREE.BoxGeometry(8.4, 1.15, 0.12);
  const sign = new THREE.Mesh(signGeo, mats.storeFasciaSign);
  sign.position.set(-1.2, 3.68, -D * 0.5 - 0.06);
  group.add(sign);

  // Sloped green metal storefront awning along North facade (z = -6.0 m) and West corner
  const awningGeo = new THREE.BoxGeometry(13.6, 0.16, 1.65);
  const awning = new THREE.Mesh(awningGeo, mats.storeAwningGreen);
  awning.position.set(-1.2, 2.86, -D * 0.5 - 0.78);
  awning.rotation.x = 0.22;
  awning.castShadow = true;
  group.add(awning);

  // Aluminum-framed double glass entrance doors & storefront windows on North face
  const doorFrameGeo = new THREE.BoxGeometry(2.05, 2.35, 0.10);
  const doorFrame = new THREE.Mesh(doorFrameGeo, mats.alloyWheel);
  doorFrame.position.set(-2.2, 1.18, -D * 0.5 - 0.02);
  group.add(doorFrame);

  const doorGlassGeo = new THREE.BoxGeometry(1.86, 2.18, 0.12);
  const doorGlass = new THREE.Mesh(doorGlassGeo, mats.autoGlassTinted);
  doorGlass.position.set(-2.2, 1.18, -D * 0.5 - 0.02);
  group.add(doorGlass);

  for (const wx of [-5.4, 1.6, 4.8]) {
    const winFrame = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 0.10), mats.alloyWheel);
    winFrame.position.set(wx, 1.55, -D * 0.5 - 0.02);
    group.add(winFrame);

    const winGlass = new THREE.Mesh(new THREE.BoxGeometry(2.22, 1.42, 0.12), mats.autoGlassTinted);
    winGlass.position.set(wx, 1.55, -D * 0.5 - 0.02);
    group.add(winGlass);
  }

  // West facade window facing NE 140th Court
  const westWinFrame = new THREE.Mesh(new THREE.BoxGeometry(0.10, 1.6, 2.6), mats.alloyWheel);
  westWinFrame.position.set(-W * 0.5 - 0.02, 1.55, -2.5);
  group.add(westWinFrame);
  const westWinGlass = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.42, 2.42), mats.autoGlassTinted);
  westWinGlass.position.set(-W * 0.5 - 0.02, 1.55, -2.5);
  group.add(westWinGlass);

  // Ice merchandiser chest outside front wall (Witness B bought a bag of ice: Depo 08:42)
  const iceBoxGeo = new THREE.BoxGeometry(1.65, 1.35, 0.88);
  const iceBox = new THREE.Mesh(iceBoxGeo, mats.paintWhite);
  iceBox.position.set(-6.8, 0.68, -D * 0.5 - 0.46);
  iceBox.castShadow = true;
  group.add(iceBox);

  // Concrete wheel stops in front parking apron
  for (const sx of [-5.5, -2.0, 1.5, 5.0]) {
    const stopGeo = new THREE.BoxGeometry(1.82, 0.14, 0.22);
    const stop = new THREE.Mesh(stopGeo, mats.concreteDriveway);
    stop.position.set(sx, 0.07, -D * 0.5 - 2.1);
    stop.castShadow = true;
    group.add(stop);
  }

  return group;
}

// 7.22 Element #29: occ_shelter (Open-sided covered bench shelter in front of store at [8, 0, 7.9])
// CRITICAL: Open-sided on thin 0.08 m posts, roof bottom clearance 2.15 m, occludes: false
function buildCoveredBenchShelter(THREE, mats) {
  const group = new THREE.Group();
  group.position.set(8.0, 0, 7.9);

  const L = 3.0; // along X
  const W = 1.8; // along Z

  // Concrete pad
  const padGeo = new THREE.BoxGeometry(L + 0.3, 0.06, W + 0.3);
  const pad = new THREE.Mesh(padGeo, mats.concreteDriveway);
  pad.position.set(0, 0.03, 0);
  pad.receiveShadow = true;
  group.add(pad);

  // 4 thin steel corner posts (0.08 m square, bottom of roof beam at 2.15 m)
  const postGeo = new THREE.BoxGeometry(0.08, 2.18, 0.08);
  for (const px of [-L * 0.45, L * 0.45]) {
    for (const pz of [-W * 0.42, W * 0.42]) {
      const post = new THREE.Mesh(postGeo, mats.shelterPostGray);
      post.position.set(px, 1.09, pz);
      post.castShadow = true;
      group.add(post);
    }
  }

  // Gable / shed corrugated metal roof above 2.15 m eye clearance
  const roofFrameGeo = new THREE.BoxGeometry(L + 0.2, 0.10, W + 0.2);
  const roofFrame = new THREE.Mesh(roofFrameGeo, mats.shelterPostGray);
  roofFrame.position.set(0, 2.22, 0);
  group.add(roofFrame);

  const roofSlopeGeo = new THREE.BoxGeometry(L + 0.36, 0.08, W * 0.62);
  for (const side of [-1, 1]) {
    const slope = new THREE.Mesh(roofSlopeGeo, mats.shelterRoofMetal);
    slope.position.set(0, 2.36, side * (W * 0.26));
    slope.rotation.x = side * 0.22;
    slope.castShadow = true;
    group.add(slope);
  }

  // Wooden slat waiting bench inside shelter (height 0.46 m, backrest top 0.86 m)
  const seatGeo = new THREE.BoxGeometry(2.1, 0.06, 0.46);
  const seat = new THREE.Mesh(seatGeo, mats.woodBenchSlat);
  seat.position.set(0, 0.46, 0.18);
  seat.castShadow = true;
  group.add(seat);

  const backGeo = new THREE.BoxGeometry(2.1, 0.38, 0.05);
  const back = new THREE.Mesh(backGeo, mats.woodBenchSlat);
  back.position.set(0, 0.72, 0.40);
  back.rotation.x = -0.15;
  group.add(back);

  for (const lx of [-0.85, 0, 0.85]) {
    const legGeo = new THREE.BoxGeometry(0.06, 0.44, 0.42);
    const leg = new THREE.Mesh(legGeo, mats.shelterPostGray);
    leg.position.set(lx, 0.22, 0.18);
    group.add(leg);
  }

  return group;
}

// 7.23 Element #30: store_parking_apron -> registered as road_store_parking_apron
function buildStoreParkingApron(THREE, mats) {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(24, 0.014, 9);
  const mesh = new THREE.Mesh(geo, mats.gravelApron);
  mesh.position.set(16, 0.0, 9);
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

// 7.24 Element #31: drainage_culvert_se -> registered as road_drainage_culvert_se
// Crossed by Vehicle A post-impact at [85, -0.4, 9.5]
function buildDrainageCulvertSE(THREE, mats) {
  const group = new THREE.Group();
  group.position.set(85, 0, 9.5);

  // Concrete pipe barrel oriented along X (under a field/property access drive)
  const pipeGeo = new THREE.CylinderGeometry(0.32, 0.32, 8.0, 20);
  pipeGeo.rotateZ(Math.PI / 2);
  const pipe = new THREE.Mesh(pipeGeo, mats.concreteCulvert);
  pipe.position.set(0, -0.12, 0);
  group.add(pipe);

  // Mitered concrete headwalls at West and East ends
  for (const side of [-1, 1]) {
    const headwallGeo = new THREE.BoxGeometry(0.45, 0.48, 1.45);
    const headwall = new THREE.Mesh(headwallGeo, mats.concreteCulvert);
    headwall.position.set(side * 4.0, -0.04, 0);
    headwall.rotation.z = side * 0.35;
    group.add(headwall);
  }

  // Earth/gravel crossing over culvert
  const crossingGeo = new THREE.BoxGeometry(6.8, 0.08, 2.5);
  const crossing = new THREE.Mesh(crossingGeo, mats.gravelApron);
  crossing.position.set(0, 0.02, 0);
  crossing.receiveShadow = true;
  group.add(crossing);

  return group;
}

// 7.25 Elements #32 & #33: Wire Pasture/Property Fences (occ_fence_wire_south_1, occ_fence_wire_south_2)
function buildWireFenceLine(THREE, mats, points, id = 'fence') {
  const group = new THREE.Group();
  group.name = id;

  // Compute post positions spaced every 3.66 m (12 ft) along polyline
  const postPositions = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i];
    const [x1, z1] = points[i + 1];
    const segLen = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.round(segLen / 3.66));
    for (let s = 0; s <= steps; s++) {
      if (i > 0 && s === 0) continue;
      const u = s / steps;
      postPositions.push([lerp(x0, x1, u), lerp(z0, z1, u)]);
    }
  }

  // Instanced wooden posts
  const postGeo = new THREE.CylinderGeometry(0.06, 0.065, 1.25, 8);
  const postInst = new THREE.InstancedMesh(postGeo, mats.woodFencePost, postPositions.length);
  postInst.castShadow = true;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < postPositions.length; i++) {
    dummy.position.set(postPositions[i][0], 0.625, postPositions[i][1]);
    dummy.updateMatrix();
    postInst.setMatrixAt(i, dummy.matrix);
  }
  postInst.instanceMatrix.needsUpdate = true;
  group.add(postInst);

  // 4 horizontal galvanized wire strands per segment
  const wireHeights = [0.32, 0.58, 0.84, 1.10];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i];
    const [x1, z1] = points[i + 1];
    const segLen = Math.hypot(x1 - x0, z1 - z0);
    const ang = Math.atan2(z1 - z0, x1 - x0);
    const mx = (x0 + x1) * 0.5;
    const mz = (z0 + z1) * 0.5;

    for (const wy of wireHeights) {
      const wireGeo = new THREE.BoxGeometry(segLen, 0.012, 0.012);
      const wire = new THREE.Mesh(wireGeo, mats.galvanizedSteel);
      wire.position.set(mx, wy, mz);
      wire.rotation.y = -ang;
      group.add(wire);
    }
  }

  return group;
}

// 7.26 Element #34: occ_pole (Wooden utility pole struck and broken by Vehicle A at [239.3, 0, 18.5])
// Also used as template for Element #35 (utility_poles_south_line)
function buildUtilityPole(THREE, mats, height = 10.7) {
  const group = new THREE.Group();

  // Tapered creosote-treated southern yellow pine pole
  const poleGeo = new THREE.CylinderGeometry(0.13, 0.18, height, 14);
  const pole = new THREE.Mesh(poleGeo, mats.woodPoleCreosote);
  pole.position.set(0, height * 0.5, 0);
  pole.castShadow = true;
  pole.receiveShadow = true;
  group.add(pole);

  // Wooden crossarm at y = height - 1.1 m
  const crossarmY = height - 1.1;
  const armGeo = new THREE.BoxGeometry(0.12, 0.14, 2.45);
  const arm = new THREE.Mesh(armGeo, mats.woodFencePost);
  arm.position.set(0, crossarmY, 0);
  arm.castShadow = true;
  group.add(arm);

  // Galvanized diagonal V-braces
  for (const side of [-1, 1]) {
    const braceGeo = new THREE.BoxGeometry(0.03, 0.72, 0.04);
    const brace = new THREE.Mesh(braceGeo, mats.galvanizedSteel);
    brace.position.set(-0.08, crossarmY - 0.26, side * 0.32);
    brace.rotation.x = side * 0.68;
    group.add(brace);
  }

  // 3 ceramic pin insulators on crossarm
  const insGeo = new THREE.CylinderGeometry(0.045, 0.06, 0.16, 10);
  for (const iz of [-1.05, 0, 1.05]) {
    const ins = new THREE.Mesh(insGeo, mats.ceramicInsulator);
    ins.position.set(0, crossarmY + 0.14, iz);
    group.add(ins);
  }

  return group;
}

// 7.27 Element #35: utility_poles_south_line -> registered as occ_utility_poles_south_line (occludes: false)
// Includes overhead catenary distribution wires strung between crossarms along z = 18.5 m
function buildSouthUtilityPoleLine(THREE, mats, poleXList) {
  const group = new THREE.Group();
  const poleH = 10.7;
  const crossarmY = poleH - 1.1 + 0.18;

  for (const px of poleXList) {
    // Skip 239.3 here because occ_pole is registered separately at [239.3, 0, 18.5]
    if (Math.abs(px - 239.3) < 0.5) continue;
    const p = buildUtilityPole(THREE, mats, poleH);
    p.position.set(px, 0, 18.5);
    group.add(p);
  }

  // Overhead catenary distribution wires connecting the poles (including occ_pole at 239.3)
  const sortedX = [...poleXList].sort((a, b) => a - b);
  const wireZOffsets = [18.5 - 1.05, 18.5, 18.5 + 1.05];

  for (let i = 0; i < sortedX.length - 1; i++) {
    const x0 = sortedX[i];
    const x1 = sortedX[i + 1];
    const span = x1 - x0;
    if (span > 160) continue;

    for (const wz of wireZOffsets) {
      const pts = [];
      const segs = 8;
      for (let s = 0; s <= segs; s++) {
        const u = s / segs;
        const sag = 4 * u * (1 - u) * 0.95;
        pts.push(new THREE.Vector3(lerp(x0, x1, u), crossarmY - sag, wz));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const tubeGeo = new THREE.TubeGeometry(curve, 8, 0.016, 5, false);
      const wireMesh = new THREE.Mesh(tubeGeo, mats.overheadWire);
      group.add(wireMesh);
    }
  }

  return group;
}

// 7.28 Element #36: residential_driveway_east -> registered as road_residential_driveway_east
function buildResidentialDrivewayEast(THREE, mats) {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(4.0, 0.02, 28.0);
  const mesh = new THREE.Mesh(geo, mats.concreteDriveway);
  mesh.position.set(280, 0.002, 17.5);
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

// 7.29 Element #37: residential_houses_south -> registered as bld_residential_houses_south (occludes: false)
// Builds rural ranch-style single-family homes set back on the south side east of the store
function buildResidentialHousesSouth(THREE, mats) {
  const group = new THREE.Group();

  const houseConfigs = [
    { x: 195, z: 38, w: 16, d: 12, h: 3.4, wallMat: mats.houseBrick },
    { x: 275, z: 38, w: 20, d: 14, h: 3.6, wallMat: mats.houseSidingLight },
  ];

  for (const hc of houseConfigs) {
    const house = new THREE.Group();
    house.position.set(hc.x, 0, hc.z);

    // Main walls
    const wallGeo = new THREE.BoxGeometry(hc.w, hc.h, hc.d);
    const walls = new THREE.Mesh(wallGeo, hc.wallMat);
    walls.position.set(0, hc.h * 0.5, 0);
    walls.castShadow = true;
    walls.receiveShadow = true;
    house.add(walls);

    // Pitched gable roof
    const roofPeakH = 1.65;
    const gableShape = new THREE.Shape();
    gableShape.moveTo(-hc.d * 0.54, 0);
    gableShape.lineTo(0, roofPeakH);
    gableShape.lineTo(hc.d * 0.54, 0);
    gableShape.closePath();

    const roofGeo = new THREE.ExtrudeGeometry(gableShape, {
      steps: 1,
      depth: hc.w + 0.6,
      bevelEnabled: false,
    });
    roofGeo.rotateY(-Math.PI / 2);
    roofGeo.translate((hc.w + 0.6) * 0.5, hc.h, 0);
    const roof = new THREE.Mesh(roofGeo, mats.houseRoofShingle);
    roof.castShadow = true;
    house.add(roof);

    // Front porch overhang & windows facing North (-Z)
    for (const wx of [-hc.w * 0.3, hc.w * 0.3]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.3, 0.08), mats.autoGlassTinted);
      win.position.set(wx, 1.8, -hc.d * 0.5 - 0.02);
      house.add(win);
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.05, 2.15, 0.08), mats.storeTrimBrown);
    door.position.set(0, 1.1, -hc.d * 0.5 - 0.02);
    house.add(door);

    group.add(house);
  }

  return group;
}

// 7.30 Element #38: veg_distant_treeline -> registered as occ_veg_distant_treeline (occludes: false)
// Builds high-fidelity Live Oak & Slash Pine trees using tapered trunk + branch cylinders and
// InstancedMesh crossed alpha-cutout foliage cards (completely eliminating "broccoli" spheres).
function buildStudioTreeSystem(THREE, mats, terrain) {
  const group = new THREE.Group();
  const rand = createPRNG(6044);

  // Collect all tree placements (well outside the highway clear zone per Fact F27)
  const treeSpecs = [
    // Individual background accent trees from world_v2.js (all far off the approach sight corridor)
    { x: 34, z: 30, h: 10.5, kind: 'oak' },
    { x: -22, z: 26, h: 11.5, kind: 'oak' },
    { x: -40, z: 40, h: 16.5, kind: 'pine' },
    { x: 60, z: -64, h: 9.5, kind: 'oak' },
    { x: -120, z: 52, h: 15.5, kind: 'pine' },
    { x: 140, z: 48, h: 10.5, kind: 'oak' },
    { x: -70, z: -70, h: 11.0, kind: 'oak' },
  ];

  // Distant North hammock treeline (z = -68 to -135 m)
  for (let x = -460; x <= 380; x += 14) {
    const z = -68 - rand() * 48;
    const h = 10 + rand() * 6.5;
    const kind = rand() < 0.55 ? 'oak' : 'pine';
    treeSpecs.push({ x: x + (rand() - 0.5) * 6, z, h, kind });
  }

  // Distant South treeline (z = +54 to +115 m, completely behind store and houses)
  for (let x = -460; x <= 380; x += 15) {
    if (x > -12 && x < 24) continue; // Keep NE 140th Ct clear
    const z = 54 + rand() * 46;
    const h = 10.5 + rand() * 6.5;
    const kind = rand() < 0.5 ? 'pine' : 'oak';
    treeSpecs.push({ x: x + (rand() - 0.5) * 6, z, h, kind });
  }

  // Build InstancedMesh for trunks, main limbs, oak foliage cards, and pine foliage cards
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.32, 1.0, 8);
  trunkGeo.translate(0, 0.5, 0);
  const trunkInst = new THREE.InstancedMesh(trunkGeo, mats.treeBark, treeSpecs.length);
  trunkInst.castShadow = true;

  // Crossed 3-plane foliage card cluster geometry (6 triangles per cluster)
  const buildCardClusterGeo = (radius) => {
    const planes = [];
    for (let p = 0; p < 3; p++) {
      const ang = (p / 3) * Math.PI;
      const g = new THREE.PlaneGeometry(radius * 2, radius * 1.75);
      g.rotateY(ang);
      if (p === 2) g.rotateX(0.45);
      planes.push(g);
    }
    // Merge the 3 planes manually into one BufferGeometry
    const totalVerts = planes.reduce((acc, g) => acc + g.attributes.position.count, 0);
    const posArr = new Float32Array(totalVerts * 3);
    const normArr = new Float32Array(totalVerts * 3);
    const uvArr = new Float32Array(totalVerts * 2);
    const indices = [];
    let vOffset = 0;
    for (const g of planes) {
      posArr.set(g.attributes.position.array, vOffset * 3);
      normArr.set(g.attributes.normal.array, vOffset * 3);
      uvArr.set(g.attributes.uv.array, vOffset * 2);
      const idx = g.getIndex();
      if (idx) {
        for (let k = 0; k < idx.count; k++) indices.push(idx.getX(k) + vOffset);
      }
      vOffset += g.attributes.position.count;
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
    merged.setIndex(indices);
    return merged;
  };

  const oakCardGeo = buildCardClusterGeo(2.35);
  const pineCardGeo = buildCardClusterGeo(2.05);

  const oakTransforms = [];
  const pineTransforms = [];
  const dummy = new THREE.Object3D();

  for (let i = 0; i < treeSpecs.length; i++) {
    const t = treeSpecs[i];
    const gy = terrain.height(t.x, t.z);
    const trunkH = t.kind === 'pine' ? t.h * 0.78 : t.h * 0.52;

    dummy.position.set(t.x, gy, t.z);
    dummy.rotation.set((rand() - 0.5) * 0.05, rand() * TAU, (rand() - 0.5) * 0.05);
    dummy.scale.set(1, trunkH, 1);
    dummy.updateMatrix();
    trunkInst.setMatrixAt(i, dummy.matrix);

    // Generate 5 foliage card clusters per crown
    const clusterCount = 5;
    for (let c = 0; c < clusterCount; c++) {
      const ca = (c / clusterCount) * TAU + rand() * 0.6;
      const cr = c === 0 ? 0 : (t.kind === 'oak' ? 1.85 : 1.15) * (0.65 + rand() * 0.5);
      const cy =
        t.kind === 'oak'
          ? gy + t.h * 0.62 + (c === 0 ? 1.35 : (rand() - 0.3) * 1.4)
          : gy + t.h * 0.68 + (c / clusterCount) * (t.h * 0.26);
      const sc = (t.h / 11.5) * (0.85 + rand() * 0.35);

      dummy.position.set(t.x + Math.cos(ca) * cr, cy, t.z + Math.sin(ca) * cr);
      dummy.rotation.set((rand() - 0.5) * 0.3, rand() * TAU, (rand() - 0.5) * 0.3);
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      if (t.kind === 'oak') {
        oakTransforms.push(dummy.matrix.clone());
      } else {
        pineTransforms.push(dummy.matrix.clone());
      }
    }
  }
  trunkInst.instanceMatrix.needsUpdate = true;
  group.add(trunkInst);

  if (oakTransforms.length > 0) {
    const oakInst = new THREE.InstancedMesh(oakCardGeo, mats.oakFoliage, oakTransforms.length);
    oakInst.castShadow = true;
    for (let i = 0; i < oakTransforms.length; i++) oakInst.setMatrixAt(i, oakTransforms[i]);
    oakInst.instanceMatrix.needsUpdate = true;
    group.add(oakInst);
  }

  if (pineTransforms.length > 0) {
    const pineInst = new THREE.InstancedMesh(pineCardGeo, mats.pineFoliage, pineTransforms.length);
    pineInst.castShadow = true;
    for (let i = 0; i < pineTransforms.length; i++) pineInst.setMatrixAt(i, pineTransforms[i]);
    pineInst.instanceMatrix.needsUpdate = true;
    group.add(pineInst);
  }

  return group;
}

// 7.31 Elements #39 & #40: Forensic Impact & Final Rest Markers (mark_impact, mark_rest_A)
function buildForensicMarker(THREE, mats, x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0.022, z);

  // Outer red forensic target ring
  const outerGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.012, 24);
  const outer = new THREE.Mesh(outerGeo, mats.forensicMarkerRed);
  group.add(outer);

  // Middle white ring
  const midGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.015, 24);
  const mid = new THREE.Mesh(midGeo, mats.forensicMarkerWhite);
  group.add(mid);

  // Center red bullseye + thin survey pin
  const innerGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.018, 20);
  const inner = new THREE.Mesh(innerGeo, mats.forensicMarkerRed);
  group.add(inner);

  return group;
}

// 7.32 Element #41: mark_path_A (Post-impact trajectory / furrow path of Vehicle A; NO pre-impact marks)
function buildPostImpactPathA(THREE, mats, points) {
  const group = new THREE.Group();

  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i];
    const [x1, z1] = points[i + 1];
    const segLen = Math.hypot(x1 - x0, z1 - z0);
    if (segLen < 0.01) continue;
    const ang = Math.atan2(z1 - z0, x1 - x0);
    const mx = (x0 + x1) * 0.5;
    const mz = (z0 + z1) * 0.5;

    // Twin wheel-track furrow ribbons + center scrub line
    for (const offset of [-0.72, 0, 0.72]) {
      const w = offset === 0 ? 0.18 : 0.22;
      const segGeo = new THREE.BoxGeometry(segLen + 0.08, 0.006, w);
      const seg = new THREE.Mesh(segGeo, mats.furrowScuff);
      const nx = -Math.sin(ang) * offset;
      const nz = Math.cos(ang) * offset;
      seg.position.set(mx + nx, 0.016, mz + nz);
      seg.rotation.y = -ang;
      group.add(seg);
    }
  }

  return group;
}

// -------------------------------------------------------------------------------------------------
// SECTION 8: MAIN WORLD FACTORY — createWorld(THREE)
// -------------------------------------------------------------------------------------------------

export default function createWorld(THREE) {
  const root = new THREE.Group();
  root.name = 'world_root';
  const objects = {};

  const T = createTerrainModel();
  T.reset();
  const gy = (x, z) => T.height(x, z);

  // Registration helpers enforcing Contract v1 rules (node.name = id, non-empty citation, valid prefix)
  const reg = (id, node, kind, label, citation, occludes = false, extra = {}) => {
    node.name = id;
    root.add(node);
    return (objects[id] = { node, kind, label, citation, occludes, ...extra });
  };

  const add = (id, node, kind, label, citation, occludes, x = 0, z = 0, headingDeg = 0, extra = {}) => {
    node.name = id;
    node.position.set(x, gy(x, z), z);
    node.rotation.y = -headingDeg * D2R;
    root.add(node);
    return (objects[id] = { node, kind, label, citation, occludes, ...extra });
  };

  // Build Texture & PBR Material Libraries
  const textures = createTextureLibrary(THREE);
  const mats = createMaterialLibrary(THREE, textures);

  // 1. Lighting, Sun Ephemeris (Az 265.0 deg, El 45.1 deg) & Atmospheric Sky Dome
  buildWorldEnvironment(THREE, root);

  // 2. Roadway, Shoulders, Median, Crossover, Side Road & Ground Base (Elements #1 - #13)
  reg(
    'road_ground_base',
    buildGroundBase(THREE, mats),
    'road',
    'Surrounding rural grass and sandy soil ground plane',
    'world_v2.js lines 15-16; evidence/map.png',
    false
  );

  reg(
    'road_us27a',
    buildRoadEB(THREE, mats),
    'road',
    'US-27A Eastbound travel lanes (two 12-ft / 3.66 m lanes: inside lane z = -5.49 to -1.83 m, outside lane z = -1.83 to +1.83 m)',
    'facts.txt F6, F9; police_report.txt p.1, p.3; world_v2.js line 19',
    false
  );

  reg(
    'road_shoulder_eb_south',
    buildShoulderEBSouth(THREE, mats),
    'road',
    'US-27A Eastbound outside (right/south) paved shoulder (5 ft / 1.52 m wide)',
    'facts.txt F6; police_report.txt p.3',
    false
  );

  reg(
    'road_shoulder_eb_north',
    buildShoulderEBNorth(THREE, mats),
    'road',
    'US-27A Eastbound inside (left/north) paved shoulder (2 ft / 0.61 m wide)',
    'facts.txt F6; police_report.txt p.3',
    false
  );

  reg(
    'road_wb',
    buildRoadWB(THREE, mats),
    'road',
    'US-27A Westbound travel lanes (two 12-ft / 3.66 m lanes: inside lane z = -32.92 to -29.26 m, outside lane z = -36.58 to -32.92 m)',
    'facts.txt F6, F9; police_report.txt p.3; world_v2.js line 20',
    false
  );

  reg(
    'road_shoulder_wb_north',
    buildShoulderWBNorth(THREE, mats),
    'road',
    'US-27A Westbound outside (right/north) paved shoulder (5 ft / 1.52 m wide)',
    'facts.txt F6; police_report.txt p.3',
    false
  );

  reg(
    'road_shoulder_wb_south',
    buildShoulderWBSouth(THREE, mats),
    'road',
    'US-27A Westbound inside (left/south) paved shoulder (2 ft / 0.61 m wide, west of crossover)',
    'facts.txt F6; police_report.txt p.3',
    false
  );

  reg(
    'road_wb_turn',
    buildRoadWBTurn(THREE, mats),
    'road',
    'US-27A Westbound left-turn lane (550 ft / 167.6 m storage + taper, 12 ft / 3.66 m wide)',
    'facts.txt F8; police_report.txt p.3; evidence/map.png; world_v2.js line 21',
    false
  );

  reg(
    'road_eb_turn',
    buildRoadEBTurn(THREE, mats),
    'road',
    'US-27A Eastbound Auxiliary Turn Lanes (550 ft / 167.6 m auxiliary turn lane)',
    'facts.txt F8',
    false
  );

  reg(
    'road_median_w',
    buildRoadMedianW(THREE, mats),
    'road',
    'Grassy/earthen median west of the crossover (~60 ft / 18.28 m grass width)',
    'facts.txt F7, F8; police_report.txt p.1, p.3; evidence/map.png; world_v2.js line 22',
    false
  );

  reg(
    'road_median_e',
    buildRoadMedianE(THREE, mats),
    'road',
    'Grassy/earthen median east of the crossover (~60 ft / 18.28 m grass width)',
    'facts.txt F7, F8; police_report.txt p.1, p.3; evidence/map.png; world_v2.js line 23',
    false
  );

  reg(
    'road_crossover',
    buildRoadCrossover(THREE, mats),
    'road',
    'Uncontrolled paved median crossover at NE 140th Court (130 ft / 39.6 m long along highway)',
    'facts.txt F8; police_report.txt p.1, p.3; evidence/map.png; world_v2.js line 24',
    false
  );

  reg(
    'road_ne140',
    buildRoadNE140(THREE, mats),
    'road',
    'NE 140th Court local paved road (runs south from US-27A; 109-deg skew simplified to 90-deg)',
    'facts.txt F11, Modeling assumptions; evidence/map.png; world_v2.js line 25',
    false
  );

  // 3. Vertical Crest Occluder (Element #14: occ_crest)
  reg(
    'occ_crest',
    buildOccCrest(THREE, mats),
    'terrain',
    'Vertical crest of US-27A, 345 m west (sight restriction)',
    'facts.txt F10, F27, F28; deposition.txt 120-126; world_v2.js line 28',
    true
  );

  // 4. MUTCD Pavement Markings (Elements #15 - #25)
  reg(
    'mark_eb_lane_line',
    buildBrokenLaneLine(THREE, mats, -1.83, -440, 340, false),
    'mark',
    'US-27A Eastbound broken white lane line separating EB inside and outside lanes',
    'evidence/map.png; world_v2.js line 19; standard: MUTCD 2009 Section 3A.06 & 3B.04; inferred placement',
    false
  );

  reg(
    'mark_wb_lane_line',
    buildBrokenLaneLine(THREE, mats, -32.92, -440, 340, false),
    'mark',
    'US-27A Westbound broken white lane line separating WB inside and outside lanes',
    'evidence/map.png; world_v2.js line 20; standard: MUTCD 2009 Section 3A.06 & 3B.04; inferred placement',
    false
  );

  reg(
    'mark_eb_right_edge_w',
    buildSolidLine(THREE, mats, -440, -3.05, 1.83, false, 0.15),
    'mark',
    'US-27A Eastbound solid white right edge line (west of NE 140th Ct)',
    'evidence/map.png; world_v2.js line 19; standard: MUTCD 2009 Section 3B.06; inferred placement',
    false
  );

  reg(
    'mark_eb_right_edge_e',
    buildSolidLine(THREE, mats, 3.05, 340, 1.83, false, 0.15),
    'mark',
    'US-27A Eastbound solid white right edge line (east of NE 140th Ct)',
    'evidence/map.png; world_v2.js line 19; standard: MUTCD 2009 Section 3B.06; inferred placement',
    false
  );

  reg(
    'mark_eb_left_edge_w',
    buildSolidLine(THREE, mats, -440, -19.8, -5.49, true, 0.15),
    'mark',
    'US-27A Eastbound solid yellow median-side left edge line (west of crossover)',
    'evidence/map.png; standard: MUTCD 2009 Section 3B.06; inferred placement',
    false
  );

  reg(
    'mark_eb_left_edge_e',
    buildSolidLine(THREE, mats, 19.8, 340, -5.49, true, 0.15),
    'mark',
    'US-27A Eastbound solid yellow median-side left edge line (east of crossover)',
    'evidence/map.png; standard: MUTCD 2009 Section 3B.06; inferred placement',
    false
  );

  reg(
    'mark_wb_right_edge',
    buildSolidLine(THREE, mats, -440, 340, -36.58, false, 0.15),
    'mark',
    'US-27A Westbound solid white right (north) edge line',
    'evidence/map.png; world_v2.js line 20; standard: MUTCD 2009 Section 3B.06; inferred placement',
    false
  );

  reg(
    'mark_wb_turn_channel_line',
    buildSolidLine(THREE, mats, -19.8, 167.6, -29.26, false, 0.15),
    'mark',
    'US-27A Westbound solid white lane line separating WB inside lane from WB left-turn lane',
    'evidence/map.png; world_v2.js line 21; standard: MUTCD 2009 Section 3B.04; inferred placement',
    false
  );

  reg(
    'mark_wb_left_edge_e',
    buildSolidLine(THREE, mats, 19.8, 340, -25.6, true, 0.15),
    'mark',
    'US-27A Westbound solid yellow median-side edge line along WB left-turn lane (east of crossover)',
    'evidence/map.png; standard: MUTCD 2009 Section 3B.06; inferred placement',
    false
  );

  reg(
    'mark_wb_left_edge_w',
    buildSolidLine(THREE, mats, -440, -19.8, -25.6, true, 0.15),
    'mark',
    'US-27A Westbound solid yellow median-side edge line (west of crossover)',
    'evidence/map.png; standard: MUTCD 2009 Section 3B.06; inferred placement',
    false
  );

  reg(
    'mark_wb_turn_arrows',
    buildWBTurnArrows(THREE, mats),
    'mark',
    'Westbound left-turn lane pavement arrows (3 left-turn arrows spaced along the 167.6 m turn lane)',
    'standard: MUTCD 2009 Section 3B.20; inferred placement',
    false
  );

  reg(
    'mark_ne140_stop_line',
    buildNE140StopLine(THREE, mats),
    'mark',
    'Stop line on northbound NE 140th Court approach to US-27A',
    'police_report.txt p.1 (stop sign on NE 140th Ct approach); standard: MUTCD 2009 Section 3B.16; inferred placement',
    false
  );

  // 5. Traffic Signs (Elements #26 & #27: sig_stop_ne140, sig_speed_eb)
  reg(
    'sig_stop_ne140',
    buildStopSignNE140(THREE, mats),
    'sign',
    'STOP sign on northbound NE 140th Court approach to US-27A',
    'police_report.txt p.1 (Traffic control: stop sign on the NE 140th Ct approach only); standard: MUTCD 2009 R1-1, Section 2A.18 & 2B.05; inferred placement',
    false
  );

  reg(
    'sig_speed_eb',
    buildSpeedLimitSignEB(THREE, mats),
    'sign',
    'SPEED LIMIT 65 sign on US-27A Eastbound roadside',
    'facts.txt F13; police_report.txt p.1 (Posted speed: 65 mph, US-27A); standard: MUTCD 2009 R2-1, Section 2B.13; inferred placement',
    false
  );

  // 6. Retail Store, Covered Bench Shelter, Parking Apron, Culvert, Fences, Poles, Houses & Trees (Elements #28 - #38)
  reg(
    'bld_store',
    buildRetailStore(THREE, mats),
    'building',
    'Retail business on the SE corner (convenience store, feed and supplies)',
    'facts.txt F12, Modeling assumptions; deposition.txt 81-83, 265-267; evidence/map.png; world_v2.js line 29',
    true
  );

  reg(
    'occ_shelter',
    buildCoveredBenchShelter(THREE, mats),
    'occluder',
    'Open-sided covered bench shelter in front of the store (fictional, does not block)',
    'facts.txt Modeling assumptions; deposition.txt 95-96, 107, 274; evidence/map.png; world_v2.js line 30',
    false
  );

  reg(
    'road_store_parking_apron',
    buildStoreParkingApron(THREE, mats),
    'road',
    'Gravel/paved parking and pull-off area in front of retail store connecting to US-27A and NE 140th Ct',
    'inferred: deposition.txt 77-83, 95; evidence/map.png; typical rural store frontage, assumed',
    false
  );

  reg(
    'road_drainage_culvert_se',
    buildDrainageCulvertSE(THREE, mats),
    'road',
    'Roadside drainage ditch and concrete pipe culvert east of intersection (crossed by Vehicle A post-impact)',
    'facts.txt F24; police_report.txt p.2 (crossed a drainage culvert); inferred placement along Vehicle A post-impact trajectory',
    false
  );

  reg(
    'occ_fence_wire_south_1',
    buildWireFenceLine(THREE, mats, [[85, 14.5], [225, 14.5]], 'occ_fence_wire_south_1'),
    'occluder',
    'Rural wire pasture/property fence #1 on south side of US-27A (struck by Vehicle A post-impact)',
    'facts.txt F24; police_report.txt p.2; deposition.txt 206 (went through two wire fences); inferred placement along Vehicle A post-impact path',
    false
  );

  reg(
    'occ_fence_wire_south_2',
    buildWireFenceLine(THREE, mats, [[225, 13], [225, 31]], 'occ_fence_wire_south_2'),
    'occluder',
    'Cross-property wire fence #2 near residential yard on south side of US-27A (struck by Vehicle A post-impact)',
    'facts.txt F24; police_report.txt p.2 (went through two wire fences); inferred placement along Vehicle A post-impact path',
    false
  );

  add(
    'occ_pole',
    buildUtilityPole(THREE, mats, 10.7),
    'occluder',
    'Wooden utility pole struck and broken by Vehicle A (~8.4 s after initial impact)',
    'facts.txt F24, F26, Modeling assumptions; police_report.txt p.2, p.3; deposition.txt 206-207; world_v2.js line 31',
    true,
    239.3,
    18.5
  );

  const southPoleXList = [
    -358.7, -312.7, -266.7, -220.7, -174.7, -128.7, -82.7, -36.7,
    14.3, 55.3, 101.3, 147.3, 193.3, 239.3, 285.3, 331.3,
  ];
  reg(
    'occ_utility_poles_south_line',
    buildSouthUtilityPoleLine(THREE, mats, southPoleXList),
    'occluder',
    'Series of wooden utility poles along south right-of-way of US-27A with overhead distribution wires',
    'inferred: facts.txt F24 (struck utility pole); typical rural utility line spacing aligned with occ_pole at z = 18.5 m, assumed',
    false
  );

  reg(
    'road_residential_driveway_east',
    buildResidentialDrivewayEast(THREE, mats),
    'road',
    'Residential driveway near Vehicle A final rest',
    'police_report.txt p.2 (in the front yard of a residence near a driveway); inferred placement near mark_rest_A',
    false
  );

  reg(
    'bld_residential_houses_south',
    buildResidentialHousesSouth(THREE, mats),
    'building',
    'Rural single-family residences set back on south side of US-27A east of the store',
    'facts.txt F25; police_report.txt p.2, p.3; deposition.txt 207, 210 (past a couple of houses... in somebody\'s yard); inferred footprint set far back from highway',
    false
  );

  reg(
    'occ_veg_distant_treeline',
    buildStudioTreeSystem(THREE, mats, T),
    'occluder',
    'Distant rural Florida pine and live oak treeline well outside the highway clear zone',
    'facts.txt F27 (No vegetation or other obstructions were reported on the approach); inferred distant background treeline outside sight corridors',
    false
  );

  // Additional background property fence along North right-of-way (z = -53.37 m)
  const northFence = buildWireFenceLine(THREE, mats, [[-420, -53.37], [340, -53.37]], 'scn_fence_north');
  northFence.userData.scenery = true;
  root.add(northFence);

  // 7. Forensic Marks & Post-Impact Trajectory (Elements #39 - #41)
  reg(
    'mark_impact',
    buildForensicMarker(THREE, mats, 0, 0),
    'mark',
    'Initial point of impact (EB outside lane at NE 140th Ct)',
    'NTSB/HAR-17/02 p.1, p.5; facts.txt F21; police_report.txt p.3; world_v2.js line 34',
    false
  );

  reg(
    'mark_rest_A',
    buildForensicMarker(THREE, mats, 276.6, 23.9),
    'mark',
    'Final rest of Vehicle A (~910 ft past impact)',
    'inferred: NTSB/HAR-17/02 p.1; facts.txt F25; police_report.txt p.2, p.3; world_v2.js line 35',
    false
  );

  // 8. Keyframe Arrays (Verbatim from world_v2.js Section 4)
  const KA = [[0,-350.02,0,90],[0.25,-341.69,0,90],[0.5,-333.36,0,90],[0.75,-325.03,0,90],[1,-316.7,0,90],[1.25,-308.37,0,90],[1.5,-300.04,0,90],[1.75,-291.71,0,90],[2,-283.38,0,90],[2.25,-275.05,0,90],[2.5,-266.72,0,90],[2.75,-258.39,0,90],[3,-250.06,0,90],[3.25,-241.73,0,90],[3.5,-233.4,0,90],[3.75,-225.07,0,90],[4,-216.74,0,90],[4.25,-208.41,0,90],[4.5,-200.08,0,90],[4.75,-191.74,0,90],[5,-183.41,0,90],[5.25,-175.08,0,90],[5.5,-166.75,0,90],[5.75,-158.42,0,90],[6,-150.09,0,90],[6.25,-141.76,0,90],[6.5,-133.43,0,90],[6.75,-125.1,0,90],[7,-116.77,0,90],[7.25,-108.44,0,90],[7.5,-100.11,0,90],[7.75,-91.78,0,90],[8,-83.45,0,90],[8.25,-75.12,0,90],[8.5,-66.79,0,90],[8.75,-58.46,0,90],[9,-50.13,0,90],[9.25,-41.8,0,90],[9.5,-33.47,0,90],[9.75,-25.14,0,90],[10,-16.81,0,90],[10.25,-8.48,0,90],[10.43,-2.49,-0.01,90.144],[10.5,-0.17,-0.01,90.2],[10.75,8.03,0.47,91],[11,16.15,1.08,91.7],[11.25,24.21,1.68,92.5],[11.5,32.21,2.28,93.2],[11.75,40.13,2.87,94],[12,47.99,3.46,94.5],[12.25,55.78,4.08,94.5],[12.5,63.51,4.68,94.5],[12.75,71.17,5.29,94.5],[13,78.76,5.88,94.5],[13.25,86.28,6.48,94.5],[13.5,93.74,7.06,94.5],[13.75,101.13,7.64,94.5],[14,108.45,8.22,94.5],[14.25,115.7,8.79,94.5],[14.5,122.89,9.36,94.5],[14.75,130.02,9.92,94.5],[15,137.07,10.47,94.5],[15.25,144.06,11.02,94.5],[15.5,150.98,11.57,94.5],[15.75,157.84,12.11,94.5],[16,164.62,12.64,94.5],[16.25,171.34,13.17,94.5],[16.5,178,13.69,94.5],[16.75,184.59,14.21,94.5],[17,191.11,14.73,94.5],[17.25,197.56,15.23,94.5],[17.5,203.94,15.74,94.5],[17.75,210.26,16.23,94.5],[18,216.52,16.73,94.5],[18.25,222.7,17.21,94.5],[18.5,228.82,17.69,94.5],[18.75,234.87,18.17,94.5],[19,240.75,18.86,89.3],[19.25,246.21,19.61,81.7],[19.5,251.22,20.32,74.1],[19.75,255.8,20.99,66.5],[20,259.93,21.59,58.9],[20.25,263.62,22.14,51.3],[20.5,266.85,22.62,43.7],[20.75,269.64,23.03,36.1],[21,271.97,23.37,28.5],[21.25,273.84,23.63,20.9],[21.5,275.24,23.81,13.3],[21.75,276.17,23.91,5.7],[22,276.56,23.94,0],[22.25,276.56,23.94,0]];
  const pathPts = KA.filter((k) => k[0] > 10.43).map((k) => [k[1], k[2]]);
  reg(
    'mark_path_A',
    buildPostImpactPathA(THREE, mats, pathPts),
    'mark',
    'Post-impact path of Vehicle A (no pre-impact tire marks)',
    'NTSB/HAR-17/02 p.1, p.5; facts.txt F22, F23, F24, F25; police_report.txt p.2, p.3; world_v2.js lines 36-39',
    false
  );

  // 9. Involved Vehicles & Non-Involved Witness Vehicles
  const A = add(
    'veh_A',
    buildPassengerSedan(THREE, mats, { id: 'veh_A', paintMat: mats.sedanPaintNavy, length: 4.97, width: 1.96, height: 1.445 }),
    'vehicle',
    'Passenger sedan (Vehicle A), eastbound',
    'inferred: NTSB/HAR-17/02 p.1 (910 ft post-impact), p.2 & p.15 (74 mph, no braking, headlights off), p.5 (no pre-impact marks); dims: typical full-size sedan, assumed',
    true
  ).node;

  const TT = add(
    'veh_T_tractor',
    buildTruckTractor(THREE, mats, { id: 'veh_T_tractor', paintMat: mats.tractorPaintWhite, length: 6.6, width: 2.44, height: 3.65 }),
    'vehicle',
    'Truck-tractor (Vehicle T)',
    'NTSB/HAR-17/02 p.1 (left turn from WB turn lane onto NE 140th Ct; stopped south of retail business), p.1-2 (witness could not tell if stopped or moving very slowly)',
    true
  ).node;

  const TR = add(
    'veh_T_trailer',
    buildRefrigeratedSemitrailer(THREE, mats, { id: 'veh_T_trailer', length: 16.15, width: 2.59, height: 4.11, boxBottomY: 1.20 }),
    'vehicle',
    'Refrigerated van semitrailer (Vehicle T)',
    'NTSB/HAR-17/02 p.6 (71 ft 7 in overall; impact 45 ft 5 in behind tractor front)',
    true
  ).node;

  // Non-involved observer vehicles (occludes: false so they do not self-occlude witness eye raycasts)
  add(
    'veh_wit_A',
    buildPassengerSedan(THREE, mats, { id: 'veh_wit_A', paintMat: mats.witAPaintSilver, length: 4.8, width: 1.85, height: 1.48 }),
    'vehicle',
    "Fictional Witness A's westbound passenger vehicle (non-involved observer vehicle)",
    'facts.txt F30; witness_A.txt; world_v2.js lines 72-84 (fictional observer vehicle)',
    false,
    357.2,
    -34.75,
    270
  );

  add(
    'veh_wit_C',
    buildPickupTruck(THREE, mats, { id: 'veh_wit_C', paintMat: mats.witCPaintCharcoal, length: 5.8, width: 2.02, height: 1.92 }),
    'vehicle',
    "Fictional Witness C's stopped pickup truck (non-involved observer vehicle)",
    'witness_C.txt; world_v2.js lines 99-111 (fictional observer vehicle)',
    false,
    -18,
    -40.5,
    270
  );

  // 10. Motion Keyframes KT & KR and Deterministic Interpolation (Verbatim from world_v2.js)
  const KT = [[0,14.79,-27.42,-90.1],[0.25,14.03,-27.4,-90.6],[0.5,13.26,-27.34,-91.5],[0.75,12.47,-27.26,-92.9],[1,11.67,-27.15,-94.8],[1.25,10.86,-27.01,-97.3],[1.5,10.04,-26.84,-100.3],[1.75,9.22,-26.64,-104],[2,8.39,-26.4,-108.2],[2.25,7.57,-26.1,-112.5],[2.5,6.76,-25.72,-117],[2.75,5.97,-25.28,-121.5],[3,5.19,-24.76,-126.1],[3.25,4.45,-24.17,-130.8],[3.5,3.75,-23.51,-135.6],[3.75,3.09,-22.78,-140.5],[4,2.49,-21.98,-145.4],[4.25,1.95,-21.12,-150.5],[4.5,1.48,-20.19,-155.6],[4.75,1.09,-19.21,-160.9],[5,0.78,-18.18,-166.2],[5.25,0.52,-17.11,-170.8],[5.5,0.31,-16,-174.5],[5.75,0.15,-14.85,-177.3],[6,0.05,-13.67,-179.1],[6.25,0,-12.46,-180],[6.5,0,-11.23,180],[6.75,0,-9.98,180],[7,0,-8.72,180],[7.25,0,-7.43,180],[7.5,0,-6.13,180],[7.75,0,-4.81,180],[8,0,-3.47,180],[8.25,0,-2.11,180],[8.5,0,-0.73,180],[8.75,0,0.67,180],[9,0,2.08,180],[9.25,0,3.52,180],[9.5,0,4.97,180],[9.75,0,6.44,180],[10,0,7.93,180],[10.25,0,9.44,180],[10.5,0,10.97,180],[10.75,0,12.47,180],[11,0,13.94,180],[11.25,0,15.38,180],[11.5,0,16.78,180],[11.75,0,18.15,180],[12,0,19.48,180],[12.25,0,20.78,180],[12.5,0,22.05,180],[12.75,0,23.28,180],[13,0,24.48,180],[13.25,0,25.64,180],[13.5,0,26.76,180],[13.75,0,27.86,180],[14,0,28.92,180],[14.25,0,29.94,180],[14.5,0,30.93,180],[14.75,0,31.89,180],[15,0,32.81,180],[15.25,0,33.69,180],[15.5,0,34.55,180],[15.75,0,35.36,180],[16,0,36.15,180],[16.25,0,36.9,180],[16.5,0,37.61,180],[16.75,0,38.29,180],[17,0,38.94,180],[17.25,0,39.55,180],[17.5,0,40.13,180],[17.75,0,40.67,180],[18,0,41.18,180],[18.25,0,41.65,180],[18.5,0,42.09,180],[18.75,0,42.5,180],[19,0,42.87,180],[19.25,0,43.2,180],[19.5,0,43.51,180],[19.75,0,43.78,180],[20,0,44.01,180],[20.25,0,44.21,180],[20.5,0,44.37,180],[20.75,0,44.5,180],[21,0,44.6,180],[21.25,0,44.66,180],[21.5,0,44.69,180],[21.75,0,44.69,180],[22,0,44.69,180],[22.25,0,44.69,180]];
  const KR = [[0,25.23,-27.43,-90],[0.25,24.47,-27.43,-90],[0.5,23.7,-27.43,-90],[0.75,22.9,-27.43,-90],[1,22.08,-27.43,-90],[1.25,21.25,-27.43,-90],[1.5,20.4,-27.43,-90],[1.75,19.52,-27.42,-90],[2,18.63,-27.39,-90.3],[2.25,17.73,-27.32,-90.8],[2.5,16.82,-27.21,-91.6],[2.75,15.89,-27.06,-92.6],[3,14.96,-26.88,-94],[3.25,14.03,-26.65,-95.6],[3.5,13.11,-26.39,-97.5],[3.75,12.19,-26.08,-99.8],[4,11.28,-25.74,-102.5],[4.25,10.38,-25.35,-105.6],[4.5,9.51,-24.93,-109],[4.75,8.66,-24.47,-112.9],[5,7.85,-23.98,-117.2],[5.25,7.06,-23.45,-122],[5.5,6.32,-22.9,-127.3],[5.75,5.62,-22.31,-132.9],[6,4.97,-21.64,-138.5],[6.25,4.37,-20.9,-144.3],[6.5,3.79,-20.09,-149.7],[6.75,3.22,-19.21,-154.8],[7,2.68,-18.26,-159.5],[7.25,2.16,-17.23,-163.8],[7.5,1.69,-16.13,-167.5],[7.75,1.25,-14.97,-170.9],[8,0.87,-13.75,-173.7],[8.25,0.55,-12.47,-176],[8.5,0.3,-11.14,-177.9],[8.75,0.12,-9.77,-179.1],[9,0.02,-8.36,-179.8],[9.25,0,-6.93,180],[9.5,0,-5.48,180],[9.75,0,-4,180],[10,0,-2.51,180],[10.25,0,-1,180],[10.5,0,0.52,180],[10.75,0,2.03,180],[11,0,3.5,180],[11.25,0,4.94,180],[11.5,0,6.34,180],[11.75,0,7.71,180],[12,0,9.04,180],[12.25,0,10.34,180],[12.5,0,11.6,180],[12.75,0,12.83,180],[13,0,14.03,180],[13.25,0,15.19,180],[13.5,0,16.32,180],[13.75,0,17.41,180],[14,0,18.47,180],[14.25,0,19.49,180],[14.5,0,20.48,180],[14.75,0,21.44,180],[15,0,22.36,180],[15.25,0,23.25,180],[15.5,0,24.1,180],[15.75,0,24.92,180],[16,0,25.7,180],[16.25,0,26.45,180],[16.5,0,27.17,180],[16.75,0,27.85,180],[17,0,28.49,180],[17.25,0,29.1,180],[17.5,0,29.68,180],[17.75,0,30.22,180],[18,0,30.73,180],[18.25,0,31.21,180],[18.5,0,31.65,180],[18.75,0,32.05,180],[19,0,32.42,180],[19.25,0,32.76,180],[19.5,0,33.06,180],[19.75,0,33.33,180],[20,0,33.56,180],[20.25,0,33.76,180],[20.5,0,33.93,180],[20.75,0,34.06,180],[21,0,34.15,180],[21.25,0,34.22,180],[21.5,0,34.24,180],[21.75,0,34.24,180],[22,0,34.24,180],[22.25,0,34.24,180]];

  function sample(K, t) {
    if (t <= K[0][0]) return K[0];
    const last = K[K.length - 1];
    if (t >= last[0]) return last;
    let i = 0;
    while (K[i + 1][0] < t) i++;
    const a = K[i];
    const b = K[i + 1];
    const u = (t - a[0]) / (b[0] - a[0]);
    let dh = b[3] - a[3];
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    return [t, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + dh * u];
  }

  function place(node, K, t) {
    const s = sample(K, t);
    const h = s[3] * D2R;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    const y = T.roadHeight(s[1], s[2]);
    const pitch = Math.atan((T.roadHeight(s[1] + fx * 2, s[2] + fz * 2) - T.roadHeight(s[1] - fx * 2, s[2] - fz * 2)) / 4);
    node.position.set(s[1], y, s[2]);
    node.rotation.set(pitch, -h, 0, 'YXZ');
  }

  const T_IMPACT = 10.43;
  const duration = 22.4;

  function setTime(t) {
    t = Math.min(Math.max(t, 0), duration);
    place(A, KA, t);
    place(TT, KT, t);
    place(TR, KR, t);
    root.updateMatrixWorld(true);
  }

  // 11. Witnesses (Verbatim from world_v2.js Section 4)
  const witnesses = [
    {
      id: 'wit_A',
      name: 'Witness A (fictional)',
      position: [357.2, 0, -34.75],
      eyeHeight: 1.5,
      lookAt: 'veh_A',
      observationTime: 2,
      claim: 'Saw the car come over the hill and approach before the truck began its turn; once the truck pulled across, the trailer blocked my view of the car.',
      citation: 'Witness A statement (fictional), modeled on NTSB/HAR-17/02 p.1-2, p.29-30 witness account',
    },
    {
      id: 'wit_B',
      name: 'Witness B (fictional)',
      position: [7.5, 0, 6.5],
      eyeHeight: 1.6,
      lookAt: 'veh_A',
      observationTime: 9.9,
      claim: 'I had a clear view of the car the whole way in. I watched it right up until the moment it hit. Nothing was in the way.',
      citation: "Deposition of Witness B (fictional), claim at 27:46 (repeated shortly after); position marked on Exhibit 4 at 27:04 while saying only 'I was over by the corner, near the shelter'",
    },
    {
      id: 'wit_C',
      name: 'Witness C (fictional)',
      position: [-18, 0, -40.5],
      eyeHeight: 1.6,
      lookAt: 'veh_T_tractor',
      observationTime: 5,
      claim: 'The truck was barely creeping when it started across; I never heard brakes before the bang.',
      citation: 'Witness C statement (fictional); consistent with NTSB/HAR-17/02 p.1-2 and p.5',
    },
  ];

  // 12. Facts & Skids (Verbatim from world_v2.js Section 4)
  const facts = [
    {
      id: 'f_impact_t',
      text: 'Impact at t=10.43 s on the event clock (car crests the hill at t=0)',
      value: 10.43,
      unit: 's',
      citation: 'inferred: NTSB/HAR-17/02 p.22, p.29 (derived from 74 mph over 345 m)',
      kind: 'time',
    },
    {
      id: 'f_speed',
      text: 'Car speed just before impact 74 mph (cruise set 4:34:21)',
      value: 74,
      unit: 'mph',
      citation: 'NTSB/HAR-17/02 p.2, p.15',
      kind: 'speed',
    },
    {
      id: 'f_limit',
      text: 'Posted limit 65 mph',
      value: 65,
      unit: 'mph',
      citation: 'NTSB/HAR-17/02 p.23',
      kind: 'speed',
    },
    {
      id: 'f_crest',
      text: 'Vertical crest 1,132 ft (345 m) west of intersection',
      value: 345,
      unit: 'm',
      citation: 'NTSB/HAR-17/02 p.22',
      kind: 'distance',
    },
    {
      id: 'f_sight',
      text: 'Up to 10.4 s mutual sight time at 74 mph',
      value: 10.4,
      unit: 's',
      citation: 'NTSB/HAR-17/02 p.29',
      kind: 'time',
    },
    {
      id: 'f_nomarks',
      text: 'No pre-collision tire marks from either vehicle; no braking',
      value: 0,
      unit: 'm',
      citation: 'NTSB/HAR-17/02 p.5, p.15',
      kind: 'skid',
    },
    {
      id: 'f_post',
      text: 'Car traveled ~910 ft after striking the trailer',
      value: 277.4,
      unit: 'm',
      citation: 'NTSB/HAR-17/02 p.1',
      kind: 'distance',
    },
    {
      id: 'f_imp_off',
      text: 'Impact centered 45 ft 5 in behind tractor front',
      value: 13.84,
      unit: 'm',
      citation: 'NTSB/HAR-17/02 p.6 fn.6',
      kind: 'position',
    },
    {
      id: 'f_time',
      text: 'Impact at 4:36:12.7 p.m. EDT, daylight, clear, dry',
      value: 16.6,
      unit: 'h',
      citation: 'NTSB/HAR-17/02 p.1, p.5, p.15',
      kind: 'time',
    },
  ];

  const skids = [];

  const world = {
    meta: {
      caseId: 'HWY16FH018',
      title: 'Car into turning tractor-semitrailer at an uncontrolled median crossover, US-27A near Williston, Florida (2016)',
      timeOfDay: '16:36',
      lighting: 'day',
      impactT: T_IMPACT,
      date: '2016-05-07',
      dateTime: '2016-05-07T16:36:12-04:00',
      weather: 'clear',
      timeZone: 'America/New_York',
      utcOffset: '-04:00',
      lat: 29.4106,
      lon: -82.5393,
      sun: { azimuthDeg: 265.0, elevationDeg: 45.1 },
      source: 'NTSB/HAR-17/02 (HWY16FH018) physical facts + fictional witnesses',
      contract: 'v1',
    },
    root,
    duration,
    setTime,
    objects,
    witnesses,
    facts,
    skids,
  };

  setTime(0);
  return world;
}
