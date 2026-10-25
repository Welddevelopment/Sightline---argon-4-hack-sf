// ============================================================================
// ARGON FORENSIC 3D RECONSTRUCTION MODULE — SELF-CONTAINED WORLD (CONTRACT v1)
// Case: Car into turning tractor-semitrailer at an uncontrolled median crossover,
//       US-27A near Williston, Florida, May 7, 2016 (NTSB/HAR-17/02, HWY16FH018)
// ============================================================================
// Units: meters, Y up, ground y = 0 at the impact point (origin).
// Axes: +X = East, -X = West, -Z = North, +Z = South.
// Heading convention: Compass degrees (0 = North/-Z, 90 = East/+X, 180 = South/+Z, 270 = West/-X).
// Vehicle node convention: Local origin at ground-level footprint center; local -Z is front;
//                          node.rotation.y = -headingDeg * Math.PI / 180.
// Runtime: Pure ES module, zero external imports, zero network calls. Runs in Browser and Node.js.
// ============================================================================

export default function createWorld(THREE) {
  const D2R = Math.PI / 180;
  const PI = Math.PI;
  const TWO_PI = Math.PI * 2;

  const root = new THREE.Group();
  root.name = 'world_root';

  const objects = {};
  const sceneryGroup = new THREE.Group();
  sceneryGroup.name = 'world_scenery';
  sceneryGroup.userData.scenery = true;
  root.add(sceneryGroup);

  // --------------------------------------------------------------------------
  // 1. DETERMINISTIC PRNG & MATH UTILITIES
  // --------------------------------------------------------------------------
  function makePRNG(seed = 1337) {
    let s = seed >>> 0;
    return function rand() {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash2D(ix, iz, seed = 42) {
    let n = (ix * 374761393 + iz * 668265263 + seed * 1442695041) | 0;
    n = (n ^ (n >> 13)) | 0;
    n = Math.imul(n, 1274126177);
    return ((n ^ (n >> 16)) >>> 0) / 4294967296;
  }

  function valueNoise2D(x, z, seed = 42) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);
    const a = hash2D(ix, iz, seed);
    const b = hash2D(ix + 1, iz, seed);
    const c = hash2D(ix, iz + 1, seed);
    const d = hash2D(ix + 1, iz + 1, seed);
    return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  }

  function fbm2D(x, z, octaves = 4, seed = 42) {
    let val = 0;
    let amp = 0.5;
    let freq = 1.0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      val += amp * valueNoise2D(x * freq, z * freq, seed + i * 101);
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return val / norm;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // --------------------------------------------------------------------------
  // 2. GUARDED CANVAS & PROCEDURAL TEXTURE PAINTERS (Browser + Node compatible)
  // --------------------------------------------------------------------------
  const mkCanvas = (w, h) =>
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : typeof document !== 'undefined' && typeof document.createElement === 'function'
      ? Object.assign(document.createElement('canvas'), { width: w, height: h })
      : null;

  const texCache = new Map();

  function makeCanvasTexture(key, w, h, drawFn, opts = {}) {
    if (texCache.has(key)) return texCache.get(key);
    const canvas = mkCanvas(w, h);
    if (!canvas) {
      texCache.set(key, null);
      return null;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      texCache.set(key, null);
      return null;
    }
    drawFn(ctx, w, h);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = opts.wrapS || THREE.RepeatWrapping;
    tex.wrapT = opts.wrapT || THREE.RepeatWrapping;
    if (opts.repeat) {
      tex.repeat.set(opts.repeat[0], opts.repeat[1]);
    }
    if (opts.anisotropy) {
      tex.anisotropy = opts.anisotropy;
    } else {
      tex.anisotropy = 8;
    }
    if (opts.colorSpace && THREE.SRGBColorSpace) {
      tex.colorSpace = THREE.SRGBColorSpace;
    }
    tex.needsUpdate = true;
    texCache.set(key, tex);
    return tex;
  }

  // 2.1 Asphalt Highway Surface Texture (Aggregate, Wheel-Track Wear, Tar Streaks)
  function getAsphaltTexture(variant = 'main', repeatX = 1, repeatY = 80) {
    const key = `asphalt_${variant}_${repeatX}_${repeatY}`;
    return makeCanvasTexture(
      key,
      512,
      512,
      (ctx, w, h) => {
        const rng = makePRNG(variant === 'main' ? 101 : variant === 'shoulder' ? 202 : 303);
        const baseLum = variant === 'main' ? 56 : variant === 'shoulder' ? 67 : 62;
        ctx.fillStyle = `rgb(${baseLum}, ${baseLum + 2}, ${baseLum + 5})`;
        ctx.fillRect(0, 0, w, h);

        // Aggregate grain speckles
        for (let i = 0; i < 18000; i++) {
          const x = rng() * w;
          const y = rng() * h;
          const delta = (rng() - 0.48) * 32;
          const l = clamp(Math.round(baseLum + delta), 24, 120);
          ctx.fillStyle = `rgb(${l},${l + 1},${l + 3})`;
          const sz = rng() < 0.8 ? 1.5 : 2.5;
          ctx.fillRect(x, y, sz, sz);
        }

        // Subtle wheel path polishing / darkening on main lanes
        if (variant === 'main') {
          const tracks = [0.16, 0.34, 0.66, 0.84];
          for (const tx of tracks) {
            const cx = tx * w;
            const grad = ctx.createLinearGradient(cx - 38, 0, cx + 38, 0);
            grad.addColorStop(0, 'rgba(20, 22, 25, 0)');
            grad.addColorStop(0.5, 'rgba(20, 22, 25, 0.22)');
            grad.addColorStop(1, 'rgba(20, 22, 25, 0)');
            ctx.fillStyle = grad;
            ctx.fillRect(cx - 38, 0, 76, h);
          }

          // Longitudinal tar joint & micro-cracks
          ctx.strokeStyle = 'rgba(22, 23, 25, 0.45)';
          ctx.lineWidth = 1.6;
          for (let k = 0; k < 4; k++) {
            let x0 = (0.25 + k * 0.24 + (rng() - 0.5) * 0.04) * w;
            ctx.beginPath();
            ctx.moveTo(x0, 0);
            for (let y = 0; y <= h; y += 16) {
              x0 += (rng() - 0.5) * 2.5;
              ctx.lineTo(x0, y);
            }
            ctx.stroke();
          }
        }

        // Shoulder sand/limerock dusting near outer edge
        if (variant === 'shoulder') {
          const grad = ctx.createLinearGradient(0, 0, w, 0);
          grad.addColorStop(0, 'rgba(175, 168, 150, 0.05)');
          grad.addColorStop(0.7, 'rgba(175, 168, 150, 0.14)');
          grad.addColorStop(1.0, 'rgba(182, 174, 154, 0.35)');
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, w, h);
        }
      },
      { repeat: [repeatX, repeatY], colorSpace: true }
    );
  }

  // 2.2 Asphalt Bump/Roughness Map
  function getAsphaltBumpTexture(repeatX = 2, repeatY = 120) {
    const key = `asphalt_bump_${repeatX}_${repeatY}`;
    return makeCanvasTexture(
      key,
      256,
      256,
      (ctx, w, h) => {
        const rng = makePRNG(909);
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 12000; i++) {
          const v = Math.floor(80 + rng() * 96);
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          ctx.fillRect(rng() * w, rng() * h, 1.5, 1.5);
        }
      },
      { repeat: [repeatX, repeatY] }
    );
  }

  // 2.3 Bahia Grass & Sandy Soil Texture
  function getGrassGroundTexture(variant = 'pasture', repeatX = 40, repeatY = 40) {
    const key = `grass_${variant}_${repeatX}_${repeatY}`;
    return makeCanvasTexture(
      key,
      512,
      512,
      (ctx, w, h) => {
        const rng = makePRNG(variant === 'median' ? 515 : 616);
        const baseR = variant === 'median' ? 112 : 104;
        const baseG = variant === 'median' ? 132 : 121;
        const baseB = variant === 'median' ? 80 : 74;
        ctx.fillStyle = `rgb(${baseR},${baseG},${baseB})`;
        ctx.fillRect(0, 0, w, h);

        // Patches of sandy Florida soil and darker Bahia turf
        for (let i = 0; i < 420; i++) {
          const x = rng() * w;
          const y = rng() * h;
          const rad = 12 + rng() * 38;
          const isSand = rng() < 0.25;
          const grad = ctx.createRadialGradient(x, y, 2, x, y, rad);
          if (isSand) {
            grad.addColorStop(0, 'rgba(168, 155, 124, 0.26)');
            grad.addColorStop(1, 'rgba(168, 155, 124, 0)');
          } else {
            const dr = Math.round(baseR + (rng() - 0.5) * 28);
            const dg = Math.round(baseG + (rng() - 0.5) * 32);
            const db = Math.round(baseB + (rng() - 0.5) * 20);
            grad.addColorStop(0, `rgba(${dr},${dg},${db},0.35)`);
            grad.addColorStop(1, `rgba(${dr},${dg},${db},0)`);
          }
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, rad, 0, TWO_PI);
          ctx.fill();
        }

        // Mow stripes on median
        if (variant === 'median') {
          for (let y = 0; y < h; y += 32) {
            ctx.fillStyle = (y / 32) % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)';
            ctx.fillRect(0, y, w, 16);
          }
        }

        // Fine grass blade noise
        for (let i = 0; i < 14000; i++) {
          const x = rng() * w;
          const y = rng() * h;
          const r = clamp(Math.round(baseR + (rng() - 0.48) * 36), 55, 175);
          const g = clamp(Math.round(baseG + (rng() - 0.48) * 42), 70, 190);
          const b = clamp(Math.round(baseB + (rng() - 0.48) * 28), 40, 140);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(x, y, 1.5, 2.5);
        }
      },
      { repeat: [repeatX, repeatY], colorSpace: true }
    );
  }

  // 2.4 Limerock Gravel Texture (Store Parking Apron & Residential Driveway)
  function getGravelTexture(repeatX = 6, repeatY = 6) {
    const key = `gravel_${repeatX}_${repeatY}`;
    return makeCanvasTexture(
      key,
      512,
      512,
      (ctx, w, h) => {
        const rng = makePRNG(777);
        ctx.fillStyle = '#b8b2a4';
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 16000; i++) {
          const x = rng() * w;
          const y = rng() * h;
          const l = Math.floor(145 + (rng() - 0.5) * 65);
          ctx.fillStyle = `rgb(${l + 6},${l + 2},${l - 6})`;
          const s = 1 + rng() * 2.5;
          ctx.fillRect(x, y, s, s);
        }
      },
      { repeat: [repeatX, repeatY], colorSpace: true }
    );
  }

  // 2.5 Refrigerated Semitrailer Ribbed Aluminum Side Panel + DOT Conspicuity Tape Texture
  function getTrailerSideTexture() {
    const key = 'trailer_side_panel_tex';
    return makeCanvasTexture(
      key,
      1024,
      512,
      (ctx, w, h) => {
        // Off-white painted aluminum reefer box skin
        const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
        bgGrad.addColorStop(0, '#f7f7f4');
        bgGrad.addColorStop(0.1, '#f2f2ee');
        bgGrad.addColorStop(0.88, '#ebebe6');
        bgGrad.addColorStop(1.0, '#dcdcd6');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, w, h);

        // Top and bottom extruded aluminum rub rails
        ctx.fillStyle = '#c8ccd0';
        ctx.fillRect(0, 0, w, 18);
        ctx.fillRect(0, h - 26, w, 26);

        // Vertical corrugated stiffener ribs & rivet lines
        const numRibs = 48;
        const step = w / numRibs;
        for (let i = 0; i < numRibs; i++) {
          const rx = i * step;
          ctx.fillStyle = 'rgba(255,255,255,0.65)';
          ctx.fillRect(rx, 18, 2.5, h - 44);
          ctx.fillStyle = 'rgba(160,164,170,0.45)';
          ctx.fillRect(rx + 2.5, 18, 2.0, h - 44);

          // Rivets along top and bottom rails
          ctx.fillStyle = '#92969c';
          ctx.beginPath();
          ctx.arc(rx + step * 0.5, 9, 2.2, 0, TWO_PI);
          ctx.arc(rx + step * 0.5, h - 18, 2.2, 0, TWO_PI);
          ctx.fill();
        }

        // Subtle vertical weathering streaks
        const rng = makePRNG(404);
        for (let i = 0; i < 65; i++) {
          const sx = rng() * w;
          const sw = 3 + rng() * 10;
          const sh = 60 + rng() * 280;
          const grad = ctx.createLinearGradient(0, 18, 0, 18 + sh);
          grad.addColorStop(0, 'rgba(130, 128, 122, 0.08)');
          grad.addColorStop(1, 'rgba(130, 128, 122, 0)');
          ctx.fillStyle = grad;
          ctx.fillRect(sx, 18, sw, sh);
        }

        // FMVSS 108 Retroreflective Conspicuity Tape along lower rail (alternating Red/White)
        const tapeY = h - 38;
        const tapeH = 11;
        const segs = 32;
        const segW = w / segs;
        for (let s = 0; s < segs; s++) {
          const isRed = s % 2 === 0;
          ctx.fillStyle = isRed ? '#c81d25' : '#f8f9fa';
          ctx.fillRect(s * segW + 1, tapeY, segW - 2, tapeH);
          ctx.strokeStyle = 'rgba(80,80,80,0.4)';
          ctx.lineWidth = 0.8;
          ctx.strokeRect(s * segW + 1, tapeY, segW - 2, tapeH);
        }

        // Upper corner white retroreflective inverted-L markings
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(8, 20, 48, 9);
        ctx.fillRect(8, 20, 9, 48);
        ctx.fillRect(w - 56, 20, 48, 9);
        ctx.fillRect(w - 17, 20, 9, 48);
      },
      { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, colorSpace: true }
    );
  }

  // 2.6 MUTCD Sign Face Textures (R1-1 STOP, R2-1 SPEED LIMIT 65)
  function getStopSignTexture() {
    const key = 'mutcd_r1_1_stop';
    return makeCanvasTexture(
      key,
      512,
      512,
      (ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        const cx = w / 2;
        const cy = h / 2;
        const drawOct = (r, color) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const ang = (i * PI) / 4 + PI / 8;
            const px = cx + Math.cos(ang) * r;
            const py = cy + Math.sin(ang) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
        };
        drawOct(248, '#f5f5f5');
        drawOct(232, '#c41e3a');
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 148px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('STOP', cx, cy + 6);
      },
      { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, colorSpace: true }
    );
  }

  function getSpeedLimitSignTexture(speed = 65) {
    const key = `mutcd_r2_1_speed_${speed}`;
    return makeCanvasTexture(
      key,
      384,
      512,
      (ctx, w, h) => {
        // White retroreflective blank
        ctx.fillStyle = '#f4f5f6';
        ctx.fillRect(0, 0, w, h);
        // Black inner border
        ctx.strokeStyle = '#141516';
        ctx.lineWidth = 14;
        ctx.strokeRect(18, 18, w - 36, h - 36);
        // Text legend
        ctx.fillStyle = '#141516';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 58px sans-serif';
        ctx.fillText('SPEED', w / 2, 102);
        ctx.fillText('LIMIT', w / 2, 174);
        ctx.font = 'bold 188px sans-serif';
        ctx.fillText(String(speed), w / 2, 345);
      },
      { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, colorSpace: true }
    );
  }

  // 2.7 Storefront Sign & Facade Texture (Fictional "COUNTY FEED & SUPPLY / GENERAL STORE")
  function getStoreSignTexture() {
    const key = 'store_fascia_sign';
    return makeCanvasTexture(
      key,
      1024,
      256,
      (ctx, w, h) => {
        ctx.fillStyle = '#2d4732';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#e5d4b3';
        ctx.lineWidth = 10;
        ctx.strokeRect(12, 12, w - 24, h - 24);
        ctx.fillStyle = '#f7efe0';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 74px serif';
        ctx.fillText('WILLISTON FEED & SUPPLY', w / 2, 92);
        ctx.fillStyle = '#e3c578';
        ctx.font = 'bold 42px sans-serif';
        ctx.fillText('GROCERIES  •  ICE  •  HARDWARE  •  BAIT', w / 2, 176);
      },
      { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, colorSpace: true }
    );
  }

  function getStuccoWallTexture(baseHex = '#b89772', repeatX = 4, repeatY = 2) {
    const key = `stucco_${baseHex}_${repeatX}_${repeatY}`;
    return makeCanvasTexture(
      key,
      256,
      256,
      (ctx, w, h) => {
        const rng = makePRNG(808);
        ctx.fillStyle = baseHex;
        ctx.fillRect(0, 0, w, h);
        // Subtle CMU block course lines & stucco grain
        ctx.strokeStyle = 'rgba(70, 55, 40, 0.14)';
        ctx.lineWidth = 1;
        const rows = 8;
        const rh = h / rows;
        for (let r = 0; r < rows; r++) {
          const y = r * rh;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }
        for (let i = 0; i < 6500; i++) {
          const v = rng() < 0.5 ? 'rgba(255,250,240,0.06)' : 'rgba(40,30,20,0.07)';
          ctx.fillStyle = v;
          ctx.fillRect(rng() * w, rng() * h, 2, 2);
        }
      },
      { repeat: [repeatX, repeatY], colorSpace: true }
    );
  }

  // 2.8 Foliage Alpha-Card Texture & Tree Bark Texture
  function getLeafCardTexture(kind = 'oak') {
    const key = `leaf_cluster_${kind}`;
    return makeCanvasTexture(
      key,
      256,
      256,
      (ctx, w, h) => {
        const rng = makePRNG(kind === 'oak' ? 1111 : 2222);
        ctx.clearRect(0, 0, w, h);
        const cx = w / 2;
        const cy = h / 2;

        // Draw twig stems
        ctx.strokeStyle = '#4a3a28';
        ctx.lineWidth = 3;
        for (let b = 0; b < 6; b++) {
          const ang = (b / 6) * TWO_PI + 0.2;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(ang) * 90, cy + Math.sin(ang) * 90);
          ctx.stroke();
        }

        // Draw dense leaf cluster blobs so alphaTest: 0.45 produces crisp leaf silhouettes
        const count = kind === 'oak' ? 210 : 160;
        for (let i = 0; i < count; i++) {
          const r = Math.pow(rng(), 0.65) * 106;
          const ang = rng() * TWO_PI;
          const lx = cx + Math.cos(ang) * r;
          const ly = cy + Math.sin(ang) * r;
          const lAngle = ang + (rng() - 0.5) * 1.2;

          const gr = kind === 'oak' ? 52 + Math.floor(rng() * 34) : 44 + Math.floor(rng() * 28);
          const gg = kind === 'oak' ? 78 + Math.floor(rng() * 44) : 68 + Math.floor(rng() * 38);
          const gb = kind === 'oak' ? 32 + Math.floor(rng() * 24) : 28 + Math.floor(rng() * 20);
          ctx.fillStyle = `rgb(${gr},${gg},${gb})`;

          ctx.save();
          ctx.translate(lx, ly);
          ctx.rotate(lAngle);
          ctx.beginPath();
          if (kind === 'oak') {
            ctx.ellipse(0, 0, 14 + rng() * 10, 7 + rng() * 5, 0, 0, TWO_PI);
          } else {
            ctx.ellipse(0, 0, 22 + rng() * 12, 4 + rng() * 3, 0, 0, TWO_PI);
          }
          ctx.fill();
          ctx.restore();
        }
      },
      { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, colorSpace: true }
    );
  }

  function getBarkTexture() {
    const key = 'tree_bark_tex';
    return makeCanvasTexture(
      key,
      256,
      256,
      (ctx, w, h) => {
        const rng = makePRNG(3333);
        ctx.fillStyle = '#4c3b2b';
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 450; i++) {
          const x = rng() * w;
          const y = rng() * h;
          const bh = 12 + rng() * 42;
          const bw = 2 + rng() * 4;
          const l = Math.floor(45 + rng() * 45);
          ctx.fillStyle = `rgb(${l + 14},${l + 4},${l - 6})`;
          ctx.fillRect(x, y, bw, bh);
        }
      },
      { repeat: [2, 6], colorSpace: true }
    );
  }

  // --------------------------------------------------------------------------
  // 3. SHARED PBR MATERIALS LIBRARY & GEOMETRY CACHE
  // --------------------------------------------------------------------------
  const matCache = new Map();
  function getMat(key, factory) {
    if (!matCache.has(key)) {
      matCache.set(key, factory());
    }
    return matCache.get(key);
  }

  const geoCache = new Map();
  function getGeo(key, factory) {
    if (!geoCache.has(key)) {
      geoCache.set(key, factory());
    }
    return geoCache.get(key);
  }

  const MATS = {
    // Automotive Clearcoat Paints
    carPaintNavy: () =>
      getMat(
        'carPaintNavy',
        () =>
          new THREE.MeshPhysicalMaterial({
            color: 0x1d2c44,
            metalness: 0.58,
            roughness: 0.22,
            clearcoat: 1.0,
            clearcoatRoughness: 0.06,
            reflectivity: 0.9
          })
      ),
    carPaintSilver: () =>
      getMat(
        'carPaintSilver',
        () =>
          new THREE.MeshPhysicalMaterial({
            color: 0x7a8288,
            metalness: 0.52,
            roughness: 0.26,
            clearcoat: 0.95,
            clearcoatRoughness: 0.08
          })
      ),
    carPaintCharcoal: () =>
      getMat(
        'carPaintCharcoal',
        () =>
          new THREE.MeshPhysicalMaterial({
            color: 0x586068,
            metalness: 0.48,
            roughness: 0.28,
            clearcoat: 0.9,
            clearcoatRoughness: 0.1
          })
      ),
    tractorCabPaint: () =>
      getMat(
        'tractorCabPaint',
        () =>
          new THREE.MeshPhysicalMaterial({
            color: 0xe8e8e8,
            metalness: 0.3,
            roughness: 0.28,
            clearcoat: 0.85,
            clearcoatRoughness: 0.1
          })
      ),
    tractorFenderTrim: () =>
      getMat(
        'tractorFenderTrim',
        () =>
          new THREE.MeshPhysicalMaterial({
            color: 0xd0d4d8,
            metalness: 0.38,
            roughness: 0.3,
            clearcoat: 0.7
          })
      ),
    trailerSideSkin: () =>
      getMat('trailerSideSkin', () => {
        const map = getTrailerSideTexture();
        return new THREE.MeshStandardMaterial({
          color: 0xf2f2ee,
          map: map || null,
          roughness: 0.38,
          metalness: 0.18
        });
      }),
    trailerWhitePlain: () =>
      getMat(
        'trailerWhitePlain',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xf2f2ee,
            roughness: 0.4,
            metalness: 0.2
          })
      ),
    reeferHousing: () =>
      getMat(
        'reeferHousing',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xd8d8d4,
            roughness: 0.42,
            metalness: 0.25
          })
      ),
    chrome: () =>
      getMat(
        'chrome',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xdce0e4,
            metalness: 0.92,
            roughness: 0.14
          })
      ),
    alloyWheel: () =>
      getMat(
        'alloyWheel',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xc2c6ca,
            metalness: 0.82,
            roughness: 0.22
          })
      ),
    steelGalvanized: () =>
      getMat(
        'steelGalvanized',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x8c9094,
            metalness: 0.75,
            roughness: 0.45
          })
      ),
    chassisBlack: () =>
      getMat(
        'chassisBlack',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x1e2022,
            metalness: 0.35,
            roughness: 0.72
          })
      ),
    panelGapDark: () =>
      getMat(
        'panelGapDark',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x0b0e14,
            metalness: 0.1,
            roughness: 0.9
          })
      ),
    tireRubber: () =>
      getMat(
        'tireRubber',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x1c1c1e,
            metalness: 0.05,
            roughness: 0.86
          })
      ),
    brakeDiscSteel: () =>
      getMat(
        'brakeDiscSteel',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x909498,
            metalness: 0.85,
            roughness: 0.32
          })
      ),
    brakeCaliper: () =>
      getMat(
        'brakeCaliper',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x3b3f44,
            metalness: 0.6,
            roughness: 0.4
          })
      ),
    autoGlass: () =>
      getMat(
        'autoGlass',
        () =>
          new THREE.MeshPhysicalMaterial({
            color: 0x162028,
            metalness: 0.1,
            roughness: 0.06,
            transmission: 0.62,
            transparent: true,
            opacity: 0.82,
            ior: 1.5,
            reflectivity: 0.9
          })
      ),
    interiorDarkTrim: () =>
      getMat(
        'interiorDarkTrim',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x202328,
            metalness: 0.08,
            roughness: 0.78
          })
      ),
    interiorSeatLeather: () =>
      getMat(
        'interiorSeatLeather',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x282c32,
            metalness: 0.05,
            roughness: 0.65
          })
      ),
    headlampOff: () =>
      getMat(
        'headlampOff',
        () =>
          new THREE.MeshPhysicalMaterial({
            color: 0xdce4ec,
            metalness: 0.45,
            roughness: 0.12,
            emissive: 0x000000,
            emissiveIntensity: 0.0,
            clearcoat: 1.0
          })
      ),
    taillampOff: () =>
      getMat(
        'taillampOff',
        () =>
          new THREE.MeshPhysicalMaterial({
            color: 0x8b151e,
            metalness: 0.2,
            roughness: 0.18,
            emissive: 0x000000,
            emissiveIntensity: 0.0,
            clearcoat: 0.9
          })
      ),
    amberMarkerLamp: () =>
      getMat(
        'amberMarkerLamp',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xe68a00,
            emissive: 0x552a00,
            emissiveIntensity: 0.35,
            roughness: 0.25,
            metalness: 0.2
          })
      ),
    redMarkerLamp: () =>
      getMat(
        'redMarkerLamp',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xc41e3a,
            emissive: 0x3a050a,
            emissiveIntensity: 0.25,
            roughness: 0.25,
            metalness: 0.2
          })
      ),
    conspicuityRed: () =>
      getMat(
        'conspicuityRed',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xc41e3a,
            roughness: 0.28,
            metalness: 0.3
          })
      ),
    conspicuityWhite: () =>
      getMat(
        'conspicuityWhite',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xf5f5f5,
            roughness: 0.28,
            metalness: 0.3
          })
      ),
    paintWhiteStripe: () =>
      getMat(
        'paintWhiteStripe',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xf0f0f0,
            roughness: 0.52,
            metalness: 0.02,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1
          })
      ),
    paintYellowStripe: () =>
      getMat(
        'paintYellowStripe',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xeab81c,
            roughness: 0.52,
            metalness: 0.02,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1
          })
      ),
    woodCreosote: () =>
      getMat(
        'woodCreosote',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x4a3b2c,
            roughness: 0.86,
            metalness: 0.02
          })
      ),
    woodFencePost: () =>
      getMat(
        'woodFencePost',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x5a4632,
            roughness: 0.85,
            metalness: 0.0
          })
      ),
    concreteGrey: () =>
      getMat(
        'concreteGrey',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x9c9a94,
            roughness: 0.84,
            metalness: 0.02
          })
      ),
    forensicRedMarker: () =>
      getMat(
        'forensicRedMarker',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0xd92b2b,
            emissive: 0x350808,
            emissiveIntensity: 0.25,
            roughness: 0.45,
            metalness: 0.05
          })
      ),
    furrowEarth: () =>
      getMat(
        'furrowEarth',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x3b3228,
            roughness: 0.9,
            metalness: 0.0,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2
          })
      )
  };

  // Helper to configure mesh shadow flags
  function setShadows(mesh, cast = true, receive = true) {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    return mesh;
  }

  // --------------------------------------------------------------------------
  // 4. GEOMETRY BUILDERS (LOFTED PROFILES, WHEELS, CATENARY WIRES)
  // --------------------------------------------------------------------------

  /**
   * Builds a symmetrical 3D lofted shell from station cross-sections along local Z.
   * Each station: { z, y0, y1, y2, y3, w0, w1, w2, w3 }
   *   level 0 = bottom sill center (x=0, y=y0)
   *   level 1 = lower rocker/wheel-well edge (x=w0, y=y0)
   *   level 2 = mid beltline / fender flare (x=w1, y=y1)
   *   level 3 = shoulder / hood / deck edge (x=w2, y=y2)
   *   level 4 = roof / centerline crown (x=w3, y=y3)
   *   level 5 = top center spine (x=0, y=y3 + 0.015)
   */
  function buildLoftedCarBodyGeometry(stations) {
    const numS = stations.length;
    const ringPts = 10; // Full closed loop around cross-section: bottom center -> right side -> top center -> left side
    const positions = [];
    const uvs = [];
    const indices = [];

    const zMin = stations[0].z;
    const zMax = stations[numS - 1].z;
    const zSpan = zMax - zMin || 1;

    for (let i = 0; i < numS; i++) {
      const s = stations[i];
      const crown = s.crown !== undefined ? s.crown : 0.018;
      // 10 points around the cross-section perimeter
      const ring = [
        [0, s.y0],
        [s.w0, s.y0],
        [s.w1, s.y1],
        [s.w2, s.y2],
        [s.w3, s.y3],
        [0, s.y3 + crown],
        [-s.w3, s.y3],
        [-s.w2, s.y2],
        [-s.w1, s.y1],
        [-s.w0, s.y0]
      ];
      const vCoord = (s.z - zMin) / zSpan;
      for (let p = 0; p < ringPts; p++) {
        positions.push(ring[p][0], ring[p][1], s.z);
        uvs.push(p / ringPts, vCoord);
      }
    }

    for (let i = 0; i < numS - 1; i++) {
      const r0 = i * ringPts;
      const r1 = (i + 1) * ringPts;
      for (let p = 0; p < ringPts; p++) {
        const pNext = (p + 1) % ringPts;
        const a = r0 + p;
        const b = r0 + pNext;
        const c = r1 + pNext;
        const d = r1 + p;
        indices.push(a, b, c, a, c, d);
      }
    }

    // Front cap (i = 0)
    const frontCenterIdx = positions.length / 3;
    const s0 = stations[0];
    positions.push(0, 0.5 * (s0.y0 + s0.y3), s0.z);
    uvs.push(0.5, 0);
    for (let p = 0; p < ringPts; p++) {
      const pNext = (p + 1) % ringPts;
      indices.push(frontCenterIdx, pNext, p);
    }

    // Rear cap (i = numS - 1)
    const rearCenterIdx = positions.length / 3;
    const sLast = stations[numS - 1];
    positions.push(0, 0.5 * (sLast.y0 + sLast.y3), sLast.z);
    uvs.push(0.5, 1);
    const lastRingOffset = (numS - 1) * ringPts;
    for (let p = 0; p < ringPts; p++) {
      const pNext = (p + 1) % ringPts;
      indices.push(rearCenterIdx, lastRingOffset + p, lastRingOffset + pNext);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Builds a detailed passenger-car wheel assembly (tire, sidewall, 5-spoke alloy rim, 5 lug nuts, brake disc, caliper).
   */
  function buildPassengerWheel(radius = 0.34, width = 0.225, isLeft = true) {
    const group = new THREE.Group();
    const sideSign = isLeft ? -1 : 1;

    // Tire tread cylinder (axis along X)
    const tireGeo = getGeo(`pass_tire_${radius}_${width}`, () => {
      const g = new THREE.CylinderGeometry(radius, radius, width, 28, 1);
      g.rotateZ(PI / 2);
      return g;
    });
    const tireMesh = setShadows(new THREE.Mesh(tireGeo, MATS.tireRubber()));
    group.add(tireMesh);

    // Sidewall torus rings
    const sidewallGeo = getGeo(`pass_sidewall_${radius}_${width}`, () => {
      const g = new THREE.TorusGeometry(radius * 0.84, radius * 0.155, 10, 28);
      g.rotateY(PI / 2);
      return g;
    });
    const swOut = new THREE.Mesh(sidewallGeo, MATS.tireRubber());
    swOut.position.x = sideSign * (width * 0.36);
    group.add(swOut);

    // Alloy rim barrel
    const rimRadius = radius * 0.68;
    const rimBarrelGeo = getGeo(`pass_rim_barrel_${rimRadius}_${width}`, () => {
      const g = new THREE.CylinderGeometry(rimRadius, rimRadius, width * 0.88, 24, 1);
      g.rotateZ(PI / 2);
      return g;
    });
    const rimBarrel = setShadows(new THREE.Mesh(rimBarrelGeo, MATS.alloyWheel()));
    group.add(rimBarrel);

    // Recessed dark wheel well inside barrel
    const innerHubGeo = getGeo(`pass_inner_hub_${rimRadius}_${width}`, () => {
      const g = new THREE.CylinderGeometry(rimRadius * 0.92, rimRadius * 0.92, width * 0.9, 20, 1);
      g.rotateZ(PI / 2);
      return g;
    });
    group.add(new THREE.Mesh(innerHubGeo, MATS.chassisBlack()));

    // Brake disc rotor & caliper behind spokes
    const rotorGeo = getGeo(`pass_rotor_${rimRadius}`, () => {
      const g = new THREE.CylinderGeometry(rimRadius * 0.78, rimRadius * 0.78, 0.026, 24);
      g.rotateZ(PI / 2);
      return g;
    });
    const rotor = new THREE.Mesh(rotorGeo, MATS.brakeDiscSteel());
    rotor.position.x = sideSign * (width * 0.14);
    group.add(rotor);

    const caliperGeo = getGeo(`pass_caliper_${rimRadius}`, () => new THREE.BoxGeometry(0.055, rimRadius * 0.52, rimRadius * 0.38));
    const caliper = new THREE.Mesh(caliperGeo, MATS.brakeCaliper());
    caliper.position.set(sideSign * (width * 0.16), rimRadius * 0.18, rimRadius * 0.42);
    group.add(caliper);

    // 5-Spoke Alloy Face + Center Cap + 5 Lug Nuts
    const spokeLen = rimRadius * 0.88;
    const spokeGeo = getGeo(`pass_spoke_${spokeLen}`, () => new THREE.BoxGeometry(0.024, spokeLen, 0.038));
    const lugGeo = getGeo('pass_lug', () => {
      const g = new THREE.CylinderGeometry(0.011, 0.011, 0.022, 6);
      g.rotateZ(PI / 2);
      return g;
    });

    for (let s = 0; s < 5; s++) {
      const ang = (s * TWO_PI) / 5;
      const spoke = new THREE.Mesh(spokeGeo, MATS.alloyWheel());
      spoke.position.set(
        sideSign * (width * 0.41),
        Math.cos(ang) * (spokeLen * 0.48),
        Math.sin(ang) * (spokeLen * 0.48)
      );
      spoke.rotation.x = -ang;
      group.add(spoke);

      const lugAng = ang + PI / 5;
      const lug = new THREE.Mesh(lugGeo, MATS.chrome());
      lug.position.set(
        sideSign * (width * 0.43),
        Math.cos(lugAng) * (rimRadius * 0.24),
        Math.sin(lugAng) * (rimRadius * 0.24)
      );
      group.add(lug);
    }

    const capGeo = getGeo(`pass_cap_${rimRadius}`, () => {
      const g = new THREE.CylinderGeometry(rimRadius * 0.2, rimRadius * 0.2, 0.028, 16);
      g.rotateZ(PI / 2);
      return g;
    });
    const cap = new THREE.Mesh(capGeo, MATS.chrome());
    cap.position.x = sideSign * (width * 0.42);
    group.add(cap);

    return group;
  }

  /**
   * Builds heavy-duty commercial truck wheel (steer single or dual drive/trailer wheel).
   */
  function buildCommercialWheel(radius = 0.52, width = 0.29, isLeft = true, isDual = false) {
    const group = new THREE.Group();
    const sideSign = isLeft ? -1 : 1;

    const tireGeo = getGeo(`comm_tire_${radius}_${width}`, () => {
      const g = new THREE.CylinderGeometry(radius, radius, width, 28, 1);
      g.rotateZ(PI / 2);
      return g;
    });
    const rimGeo = getGeo(`comm_rim_${radius}_${width}`, () => {
      const g = new THREE.CylinderGeometry(radius * 0.56, radius * 0.56, width * 0.92, 24, 1);
      g.rotateZ(PI / 2);
      return g;
    });
    const hubGeo = getGeo(`comm_hub_${radius}`, () => {
      const g = new THREE.CylinderGeometry(radius * 0.22, radius * 0.24, 0.14, 16);
      g.rotateZ(PI / 2);
      return g;
    });
    const lugGeo = getGeo('comm_lug', () => {
      const g = new THREE.CylinderGeometry(0.013, 0.013, 0.028, 6);
      g.rotateZ(PI / 2);
      return g;
    });

    const offsets = isDual ? [-width * 0.56, width * 0.56] : [0];
    for (const ox of offsets) {
      const tMesh = setShadows(new THREE.Mesh(tireGeo, MATS.tireRubber()));
      tMesh.position.x = ox;
      group.add(tMesh);

      const rMesh = setShadows(new THREE.Mesh(rimGeo, MATS.alloyWheel()));
      rMesh.position.x = ox;
      group.add(rMesh);
    }

    const outerFaceX = isDual ? sideSign * (width * 0.98) : sideSign * (width * 0.45);
    const hub = new THREE.Mesh(hubGeo, MATS.chassisBlack());
    hub.position.x = outerFaceX;
    group.add(hub);

    // 10-lug commercial bolt circle
    for (let i = 0; i < 10; i++) {
      const ang = (i * TWO_PI) / 10;
      const lug = new THREE.Mesh(lugGeo, MATS.chrome());
      lug.position.set(
        outerFaceX,
        Math.cos(ang) * (radius * 0.36),
        Math.sin(ang) * (radius * 0.36)
      );
      group.add(lug);
    }

    return group;
  }

  // --------------------------------------------------------------------------
  // 5. VEHICLE MODELS (STUDIO FIDELITY, EXACT DIMENSIONS & FOOTPRINT ORIGIN)
  // --------------------------------------------------------------------------

  /**
   * 5.1 Vehicle A (veh_A): 2015 Four-Door Full-Size Passenger Sedan
   * Exact spec dimensions: Length = 4.97 m, Width = 1.96 m, Height = 1.445 m.
   * Wheelbase = 2.96 m, Front overhang = 0.98 m (front axle z = -1.505 m, rear axle z = +1.455 m).
   * Hood trailing edge height = 0.914 m (3 ft). Seat headrests top height = 1.29 m.
   * Headlights OFF (headlight_L, headlight_R with emissiveIntensity = 0).
   */
  function buildSedanVehicleA() {
    const veh = new THREE.Group();
    veh.name = 'veh_A';
    const paintMat = MATS.carPaintNavy();

    // Lofted body stations from front bumper (z = -2.485 m) to rear bumper (z = +2.485 m)
    // Total length = 4.97 m, max width = 1.96 m (half-width 0.98 m), roof peak = 1.445 m
    const stations = [
      // Front bumper lower lip & nose
      { z: -2.485, y0: 0.19, y1: 0.38, y2: 0.56, y3: 0.66, w0: 0.72, w1: 0.82, w2: 0.78, w3: 0.52, crown: 0.015 },
      // Front fascia / headlamp plane
      { z: -2.32, y0: 0.17, y1: 0.44, y2: 0.68, y3: 0.74, w0: 0.85, w1: 0.92, w2: 0.86, w3: 0.66, crown: 0.02 },
      // Front wheel arch leading edge
      { z: -1.85, y0: 0.16, y1: 0.50, y2: 0.77, y3: 0.82, w0: 0.92, w1: 0.97, w2: 0.91, w3: 0.74, crown: 0.022 },
      // Front axle center (z = -1.505)
      { z: -1.505, y0: 0.16, y1: 0.53, y2: 0.83, y3: 0.87, w0: 0.93, w1: 0.98, w2: 0.92, w3: 0.77, crown: 0.024 },
      // Hood trailing edge / cowl base (z = -0.92, height = 0.914 m per F14!)
      { z: -0.92, y0: 0.15, y1: 0.56, y2: 0.89, y3: 0.914, w0: 0.93, w1: 0.98, w2: 0.92, w3: 0.80, crown: 0.015 },
      // Windshield header / A-pillar top (z = -0.22, height = 1.41 m)
      { z: -0.22, y0: 0.15, y1: 0.58, y2: 0.95, y3: 1.41, w0: 0.93, w1: 0.98, w2: 0.91, w3: 0.69, crown: 0.03 },
      // B-pillar / roof peak (z = +0.28, height = 1.445 m exact!)
      { z: 0.28, y0: 0.15, y1: 0.59, y2: 0.96, y3: 1.415, w0: 0.93, w1: 0.98, w2: 0.91, w3: 0.70, crown: 0.03 },
      // Rear passenger roof (z = +0.85)
      { z: 0.85, y0: 0.15, y1: 0.60, y2: 0.98, y3: 1.38, w0: 0.93, w1: 0.98, w2: 0.90, w3: 0.67, crown: 0.025 },
      // C-pillar base / rear deck leading edge (z = +1.55)
      { z: 1.55, y0: 0.16, y1: 0.61, y2: 1.01, y3: 1.05, w0: 0.92, w1: 0.97, w2: 0.88, w3: 0.73, crown: 0.018 },
      // Trunk deck trailing lip (z = +2.25)
      { z: 2.25, y0: 0.20, y1: 0.58, y2: 0.96, y3: 1.00, w0: 0.87, w1: 0.92, w2: 0.83, w3: 0.68, crown: 0.012 },
      // Rear bumper face (z = +2.485)
      { z: 2.485, y0: 0.23, y1: 0.52, y2: 0.84, y3: 0.90, w0: 0.79, w1: 0.85, w2: 0.77, w3: 0.60, crown: 0.01 }
    ];

    const bodyGeo = buildLoftedCarBodyGeometry(stations);
    const bodyMesh = setShadows(new THREE.Mesh(bodyGeo, paintMat));
    bodyMesh.name = 'chassis_body';
    veh.add(bodyMesh);

    // Recessed dark wheel wells so tires sit cleanly in sculpted arches
    const archGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.28, 24);
    archGeo.rotateZ(PI / 2);
    for (const [wx, wz] of [
      [-0.84, -1.505],
      [0.84, -1.505],
      [-0.84, 1.455],
      [0.84, 1.455]
    ]) {
      const arch = new THREE.Mesh(archGeo, MATS.panelGapDark());
      arch.position.set(wx, 0.35, wz);
      veh.add(arch);
    }

    // Tinted Glass Greenhouse Panels (Windshield, Rear Backlite, Side Windows)
    // Windshield
    const wsGeo = new THREE.PlaneGeometry(1.42, 0.86, 8, 4);
    const wsPos = wsGeo.attributes.position;
    for (let i = 0; i < wsPos.count; i++) {
      const x = wsPos.getX(i);
      wsPos.setZ(i, -0.045 * (1 - (x / 0.71) * (x / 0.71)));
    }
    wsGeo.computeVertexNormals();
    const windshield = new THREE.Mesh(wsGeo, MATS.autoGlass());
    windshield.position.set(0, 1.165, -0.58);
    windshield.rotation.x = -0.94;
    windshield.name = 'windshield_glass';
    veh.add(windshield);

    // Rear window (backlite)
    const rwGeo = new THREE.PlaneGeometry(1.34, 0.76, 8, 4);
    const rearGlass = new THREE.Mesh(rwGeo, MATS.autoGlass());
    rearGlass.position.set(0, 1.21, 1.21);
    rearGlass.rotation.x = 1.08;
    rearGlass.rotation.y = PI;
    veh.add(rearGlass);

    // Side daylight opening (DLO) glass panels + B-pillar black trim + chrome belt molding
    for (const side of [-1, 1]) {
      const sideGlassShape = new THREE.Shape();
      sideGlassShape.moveTo(-0.78, 0.91);
      sideGlassShape.lineTo(-0.18, 1.37);
      sideGlassShape.lineTo(0.82, 1.35);
      sideGlassShape.lineTo(1.38, 0.99);
      sideGlassShape.lineTo(-0.78, 0.91);
      const sideGlassGeo = new THREE.ShapeGeometry(sideGlassShape);
      const sideGlass = new THREE.Mesh(sideGlassGeo, MATS.autoGlass());
      sideGlass.rotation.y = side > 0 ? PI / 2 : -PI / 2;
      if (side < 0) sideGlass.scale.x = -1;
      sideGlass.position.set(side * 0.815, 0, 0);
      veh.add(sideGlass);

      // B-pillargloss black divider
      const bPillar = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.44, 0.08), MATS.panelGapDark());
      bPillar.position.set(side * 0.81, 1.15, 0.25);
      bPillar.rotation.z = side * 0.24;
      veh.add(bPillar);

      // Chrome lower window sill strip
      const beltChrome = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 2.16), MATS.chrome());
      beltChrome.position.set(side * 0.905, 0.945, 0.3);
      beltChrome.rotation.x = -0.035;
      veh.add(beltChrome);

      // Door panel seams (front & rear doors)
      for (const dz of [-0.75, 0.25, 1.15]) {
        const seam = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.62, 0.008), MATS.panelGapDark());
        seam.position.set(side * 0.975, 0.56, dz);
        veh.add(seam);
      }

      // Flush aerodynamic door handles
      for (const hz of [0.05, 0.92]) {
        const handle = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.026, 0.15), MATS.chrome());
        handle.position.set(side * 0.982, 0.84, hz);
        veh.add(handle);
      }

      // Aerodynamic side mirrors on stalks
      const mirrorGroup = new THREE.Group();
      mirrorGroup.position.set(side * 0.91, 0.96, -0.66);
      const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.03, 0.05), MATS.panelGapDark());
      stalk.position.set(side * 0.04, 0, 0);
      mirrorGroup.add(stalk);
      const housing = setShadows(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.1, 0.09), paintMat));
      housing.position.set(side * 0.11, 0.02, 0.01);
      mirrorGroup.add(housing);
      const mirrorFace = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.08), MATS.chrome());
      mirrorFace.position.set(side * 0.11, 0.02, 0.056);
      mirrorGroup.add(mirrorFace);
      veh.add(mirrorGroup);
    }

    // Windshield wipers
    for (const wx of [-0.28, 0.22]) {
      const wiper = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.015, 0.02), MATS.panelGapDark());
      wiper.position.set(wx, 0.925, -0.89);
      wiper.rotation.y = 0.08;
      veh.add(wiper);
    }

    // Interior Cabin (Dashboard, Steering Wheel, 4 Seats, Headrests at 1.29 m height per F14)
    const interior = new THREE.Group();
    interior.name = 'cabin_interior';
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.32, 0.48), MATS.interiorDarkTrim());
    dash.position.set(0, 0.78, -0.68);
    interior.add(dash);

    // Steering wheel (left-hand drive, x = -0.38)
    const swRing = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.022, 8, 20), MATS.interiorDarkTrim());
    swRing.position.set(-0.38, 0.89, -0.42);
    swRing.rotation.x = -0.38;
    interior.add(swRing);

    // Front and rear seats + headrests (top at y = 1.29 m per F14: at least 3.5 in above trailer bottom 1.20 m)
    for (const [sx, sz] of [
      [-0.38, -0.02],
      [0.38, -0.02],
      [-0.38, 0.78],
      [0.38, 0.78]
    ]) {
      const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.14, 0.48), MATS.interiorSeatLeather());
      cushion.position.set(sx, 0.46, sz);
      interior.add(cushion);

      const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.56, 0.12), MATS.interiorSeatLeather());
      backrest.position.set(sx, 0.80, sz + 0.18);
      backrest.rotation.x = -0.14;
      interior.add(backrest);

      const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.19, 0.09), MATS.interiorSeatLeather());
      headrest.position.set(sx, 1.195, sz + 0.24); // Top at 1.195 + 0.095 = 1.29 m!
      interior.add(headrest);
    }
    veh.add(interior);

    // Front Fascia: Lower air dam, oval nose cone grille, LED headlamps (OFF per F4)
    const frontGrille = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.18, 0.06), MATS.panelGapDark());
    frontGrille.position.set(0, 0.48, -2.465);
    veh.add(frontGrille);

    const grilleChromeTrim = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.022, 0.065), MATS.chrome());
    grilleChromeTrim.position.set(0, 0.57, -2.465);
    veh.add(grilleChromeTrim);

    const lowerAirIntake = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.10, 0.06), MATS.panelGapDark());
    lowerAirIntake.position.set(0, 0.26, -2.46);
    veh.add(lowerAirIntake);

    // Headlamps (named headlight_L and headlight_R, explicitly OFF per F4)
    const hlGeo = new THREE.BoxGeometry(0.32, 0.11, 0.16);
    const hlLeft = new THREE.Mesh(hlGeo, MATS.headlampOff());
    hlLeft.name = 'headlight_L';
    hlLeft.position.set(-0.66, 0.62, -2.36);
    hlLeft.rotation.y = 0.24;
    veh.add(hlLeft);

    const hlRight = new THREE.Mesh(hlGeo, MATS.headlampOff());
    hlRight.name = 'headlight_R';
    hlRight.position.set(0.66, 0.62, -2.36);
    hlRight.rotation.y = -0.24;
    veh.add(hlRight);

    // Taillamps (named taillight_L and taillight_R, OFF — no braking per F18)
    const tlGeo = new THREE.BoxGeometry(0.36, 0.13, 0.12);
    const tlLeft = new THREE.Mesh(tlGeo, MATS.taillampOff());
    tlLeft.name = 'taillight_L';
    tlLeft.position.set(-0.62, 0.82, 2.43);
    tlLeft.rotation.y = -0.15;
    veh.add(tlLeft);

    const tlRight = new THREE.Mesh(tlGeo, MATS.taillampOff());
    tlRight.name = 'taillight_R';
    tlRight.position.set(0.62, 0.82, 2.43);
    tlRight.rotation.y = 0.15;
    veh.add(tlRight);

    // Rear trunk chrome garnish & license plate recess
    const rearChrome = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.025, 0.03), MATS.chrome());
    rearChrome.position.set(0, 0.84, 2.475);
    veh.add(rearChrome);

    const plateMesh = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.15, 0.015), MATS.trailerWhitePlain());
    plateMesh.position.set(0, 0.68, 2.48);
    veh.add(plateMesh);

    // Underbody chassis pan
    const underPan = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.06, 4.45), MATS.chassisBlack());
    underPan.position.set(0, 0.17, 0);
    veh.add(underPan);

    // 4 Wheel Assemblies at exact axle positions from front (0.98 m and 3.94 m -> z = -1.505 m and +1.455 m)
    const wheelConfigs = [
      { name: 'wheel_FL', x: -0.84, z: -1.505, isLeft: true },
      { name: 'wheel_FR', x: 0.84, z: -1.505, isLeft: false },
      { name: 'wheel_RL', x: -0.84, z: 1.455, isLeft: true },
      { name: 'wheel_RR', x: 0.84, z: 1.455, isLeft: false }
    ];
    for (const wc of wheelConfigs) {
      const wNode = buildPassengerWheel(0.34, 0.225, wc.isLeft);
      wNode.name = wc.name;
      wNode.position.set(wc.x, 0.34, wc.z);
      veh.add(wNode);
    }

    veh.userData.dims = { length: 4.97, width: 1.96, height: 1.445 };
    veh.userData.driverEye = [-0.38, 1.18, -0.05];
    return veh;
  }

  /**
   * 5.2 Vehicle T Power Unit (veh_T_tractor): 2014 3-Axle Conventional Commercial Truck-Tractor
   * Exact spec dimensions: Length = 6.60 m, Width = 2.44 m, Height = 4.00 m (fairing peak ~3.85 m, stacks 4.00 m).
   * Origin at footprint center (front bumper z = -3.30 m, rear frame end z = +3.30 m).
   * Axles from front: steer at 0.95 m (z = -2.35 m), drive 1 at 5.25 m (z = +1.95 m), drive 2 at 6.15 m (z = +2.85 m).
   */
  function buildTractorVehicleT() {
    const veh = new THREE.Group();
    veh.name = 'veh_T_tractor';
    const cabMat = MATS.tractorCabPaint();

    // Heavy C-channel steel frame rails
    for (const fx of [-0.46, 0.46]) {
      const rail = setShadows(new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.26, 6.42), MATS.chassisBlack()));
      rail.position.set(fx, 0.78, 0.02);
      veh.add(rail);
    }
    // Frame crossmembers
    for (const cz of [-2.8, -1.5, 0.0, 1.3, 2.4, 3.15]) {
      const xm = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.18, 0.12), MATS.chassisBlack());
      xm.position.set(0, 0.78, cz);
      veh.add(xm);
    }

    // Heavy Chrome Front Bumper (z = -3.30 m to -3.12 m)
    const bumper = setShadows(new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.42, 0.18), MATS.chrome()));
    bumper.position.set(0, 0.54, -3.21);
    veh.add(bumper);

    // Conventional Sloped Hood (z = -3.15 m to -1.35 m)
    const hoodGroup = new THREE.Group();
    const hoodMain = setShadows(new THREE.Mesh(new THREE.BoxGeometry(1.56, 1.02, 1.82), cabMat));
    hoodMain.position.set(0, 1.36, -2.24);
    hoodMain.rotation.x = 0.07;
    hoodGroup.add(hoodMain);

    const hoodCrown = setShadows(new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.18, 1.80), cabMat));
    hoodCrown.position.set(0, 1.88, -2.23);
    hoodCrown.rotation.x = 0.07;
    hoodGroup.add(hoodCrown);

    // Flared Front Fenders over steer wheels
    for (const side of [-1, 1]) {
      const fender = setShadows(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 1.54), MATS.tractorFenderTrim()));
      fender.position.set(side * 0.99, 1.04, -2.32);
      hoodGroup.add(fender);

      // Headlamp pod in front fender
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.15, 0.08), MATS.headlampOff());
      hl.name = side < 0 ? 'headlight_L' : 'headlight_R';
      hl.position.set(side * 0.98, 0.98, -3.09);
      hoodGroup.add(hl);

      // Amber side turn/marker lamp
      const amb = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.09, 0.14), MATS.amberMarkerLamp());
      amb.position.set(side * 1.22, 0.98, -2.85);
      hoodGroup.add(amb);

      // Hood-mounted convex spot mirrors
      const hMirrorArm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 8), MATS.chrome());
      hMirrorArm.position.set(side * 0.98, 1.45, -2.88);
      hMirrorArm.rotation.z = -side * 0.35;
      hoodGroup.add(hMirrorArm);
      const hMirrorHead = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), MATS.chrome());
      hMirrorHead.scale.set(1.0, 0.85, 0.45);
      hMirrorHead.position.set(side * 1.06, 1.58, -2.88);
      hoodGroup.add(hMirrorHead);
    }

    // Chrome radiator grille surround & vertical bars
    const grilleFrame = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.92, 0.08), MATS.chrome());
    grilleFrame.position.set(0, 1.32, -3.14);
    grilleFrame.rotation.x = -0.06;
    hoodGroup.add(grilleFrame);

    const grilleCore = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.80, 0.09), MATS.panelGapDark());
    grilleCore.position.set(0, 1.32, -3.145);
    grilleCore.rotation.x = -0.06;
    hoodGroup.add(grilleCore);

    for (let b = -5; b <= 5; b++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.78, 0.1), MATS.chrome());
      slat.position.set(b * 0.1, 1.32, -3.15);
      slat.rotation.x = -0.06;
      hoodGroup.add(slat);
    }
    veh.add(hoodGroup);

    // Day Cab & Sleeper/Fairing Structure (z = -1.35 m to +0.55 m)
    const cabBox = setShadows(new THREE.Mesh(new THREE.BoxGeometry(2.36, 1.68, 1.90), cabMat));
    cabBox.position.set(0, 1.94, -0.40);
    veh.add(cabBox);

    // Aerodynamic Roof Fairing rising to y = 3.85 m to match trailer height
    const fairingShape = new THREE.Shape();
    fairingShape.moveTo(-1.32, 2.75);
    fairingShape.quadraticCurveTo(-0.55, 3.62, 0.52, 3.86);
    fairingShape.lineTo(0.52, 2.75);
    fairingShape.closePath();
    const fairingGeo = new THREE.ExtrudeGeometry(fairingShape, {
      depth: 2.28,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.04,
      bevelSegments: 3
    });
    fairingGeo.rotateY(PI / 2);
    fairingGeo.translate(-1.14, 0, 0);
    const fairingMesh = setShadows(new THREE.Mesh(fairingGeo, cabMat));
    veh.add(fairingMesh);

    // Cab Windshield & Side Windows
    const cabWs = new THREE.Mesh(new THREE.PlaneGeometry(2.04, 0.72), MATS.autoGlass());
    cabWs.position.set(0, 2.28, -1.36);
    cabWs.rotation.x = PI - 0.18;
    veh.add(cabWs);

    // Rear cab window
    const cabRearWin = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.48), MATS.autoGlass());
    cabRearWin.position.set(0, 2.28, 0.56);
    veh.add(cabRearWin);

    // 5 Amber Roof Marker Lights
    for (const mx of [-0.85, -0.42, 0, 0.42, 0.85]) {
      const mLight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.045, 0.06), MATS.amberMarkerLamp());
      mLight.position.set(mx, 2.82, -1.28);
      veh.add(mLight);
    }

    // Cab Exterior Visor
    const visor = setShadows(new THREE.Mesh(new THREE.BoxGeometry(2.26, 0.16, 0.28), MATS.chrome()));
    visor.position.set(0, 2.68, -1.42);
    visor.rotation.x = 0.25;
    veh.add(visor);

    // Side Doors, Windows, West-Coast Mirrors, Air Cleaners, Chrome Exhaust Stacks, Steps, Fuel Tanks
    for (const side of [-1, 1]) {
      // Side cab window
      const sWin = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.62), MATS.autoGlass());
      sWin.position.set(side * 1.185, 2.24, -0.72);
      sWin.rotation.y = side > 0 ? PI / 2 : -PI / 2;
      veh.add(sWin);

      // Door outline & handle
      const dHandle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.18), MATS.chrome());
      dHandle.position.set(side * 1.19, 1.72, -0.42);
      veh.add(dHandle);

      // West-coast mirror assembly on dual C-loop brackets
      const mBracketTop = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.025, 0.025), MATS.chrome());
      mBracketTop.position.set(side * 1.30, 2.48, -1.05);
      veh.add(mBracketTop);
      const mBracketBot = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.025, 0.025), MATS.chrome());
      mBracketBot.position.set(side * 1.30, 1.96, -1.05);
      veh.add(mBracketBot);
      const mHead = setShadows(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.58, 0.20), MATS.chrome()));
      mHead.position.set(side * 1.42, 2.22, -1.05);
      veh.add(mHead);

      // External air cleaner canister at cowl
      const airCleaner = setShadows(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.68, 16), MATS.chrome()));
      airCleaner.position.set(side * 1.16, 1.78, -1.32);
      veh.add(airCleaner);

      // Vertical Chrome Exhaust Stack behind cab (top at y = 4.00 m exact!)
      const stackPipe = setShadows(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 2.85, 16), MATS.chrome()));
      stackPipe.position.set(side * 1.16, 2.48, 0.48);
      veh.add(stackPipe);
      const stackTip = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.22, 16), MATS.chrome());
      stackTip.position.set(side * 1.16, 3.94, 0.53);
      stackTip.rotation.x = -0.35;
      veh.add(stackTip);

      // Polished Aluminum Cylindrical Saddle Fuel Tank (150 gal) + Integrated Cab Steps
      const tankGeo = new THREE.CylinderGeometry(0.34, 0.34, 1.65, 24);
      tankGeo.rotateX(PI / 2);
      const fuelTank = setShadows(new THREE.Mesh(tankGeo, MATS.chrome()));
      fuelTank.position.set(side * 0.92, 0.68, -0.32);
      veh.add(fuelTank);

      // Tank mounting straps
      for (const sz of [-0.85, 0.22]) {
        const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.348, 0.348, 0.04, 24), MATS.chassisBlack());
        strap.rotation.x = PI / 2;
        strap.position.set(side * 0.92, 0.68, sz);
        veh.add(strap);
      }

      // Dual perforated aluminum cab entry steps
      for (const sy of [0.44, 0.72]) {
        const step = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.92), MATS.alloyWheel());
        step.position.set(side * 1.16, sy, -0.68);
        veh.add(step);
      }

      // Quarter fender & rear mudflaps over drive tandem
      const qFender = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.28, 0.35), MATS.chassisBlack());
      qFender.position.set(side * 0.94, 1.02, 1.25);
      qFender.rotation.x = 0.5;
      veh.add(qFender);

      const mudflap = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.68, 0.025), MATS.tireRubber());
      mudflap.position.set(side * 0.94, 0.52, 3.28);
      veh.add(mudflap);
    }

    // Aluminum deck plate (catwalk) behind cab + coiled air/electrical lines (gladhand lines)
    const catwalk = new THREE.Mesh(new THREE.BoxGeometry(1.10, 0.04, 0.95), MATS.alloyWheel());
    catwalk.position.set(0, 0.93, 1.08);
    veh.add(catwalk);

    // Fifth-Wheel Hitch Assembly (top at y = 1.20 m to mate with trailer kingpin)
    const fifthPedestal = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.22, 0.76), MATS.chassisBlack());
    fifthPedestal.position.set(0, 1.03, 2.38);
    veh.add(fifthPedestal);

    const fifthPlate = setShadows(new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.48, 0.07, 20), MATS.chassisBlack()));
    fifthPlate.position.set(0, 1.175, 2.38);
    fifthPlate.rotation.x = 0.08;
    veh.add(fifthPlate);

    // 3 Axles: Steer (z = -2.35 m) + Tandem Drive (z = +1.95 m, +2.85 m)
    const axleZ = [-2.35, 1.95, 2.85];
    for (let a = 0; a < axleZ.length; a++) {
      const z = axleZ[a];
      const isDual = a > 0;
      const axleTube = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.05, 12), MATS.chassisBlack());
      axleTube.rotation.z = PI / 2;
      axleTube.position.set(0, 0.52, z);
      veh.add(axleTube);

      if (isDual) {
        const diff = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), MATS.chassisBlack());
        diff.position.set(0, 0.52, z);
        veh.add(diff);
      }

      const wLeft = buildCommercialWheel(0.52, 0.28, true, isDual);
      wLeft.name = `wheel_L${a + 1}`;
      wLeft.position.set(isDual ? -0.88 : -1.04, 0.52, z);
      veh.add(wLeft);

      const wRight = buildCommercialWheel(0.52, 0.28, false, isDual);
      wRight.name = `wheel_R${a + 1}`;
      wRight.position.set(isDual ? 0.88 : 1.04, 0.52, z);
      veh.add(wRight);
    }

    veh.userData.dims = { length: 6.6, width: 2.44, height: 4.0 };
    veh.userData.driverEye = [-0.55, 2.38, -0.65];
    return veh;
  }

  /**
   * 5.3 Vehicle T Semitrailer (veh_T_trailer): 2003 53-ft Refrigerated Van Semitrailer (Reefer)
   * Exact spec dimensions: Length = 16.15 m, Width = 2.59 m, Height = 4.11 m.
   * Box bottom underride height = 1.20 m, Box height = 2.91 m (1.20 m to 4.11 m).
   * Origin at footprint center (front nose z = -8.075 m, rear doors z = +8.075 m).
   * CRITICAL SIGHTLINE REQUIREMENT (Section 4):
   * Must present continuous solid geometry along its whole length between ~0.45 m and 4.11 m above ground on both sides:
   * closed van box (1.20 m to 4.11 m), PLUS full-length aerodynamic side skirts (0.45 m to 1.26 m) on both sides,
   * landing gear, tandem axle bogie, and rear impact guard so there is NO see-through gap under the trailer side.
   */
  function buildSemitrailerVehicleT() {
    const veh = new THREE.Group();
    veh.name = 'veh_T_trailer';

    const L = 16.15;
    const W = 2.59;
    const boxBottomY = 1.20;
    const boxTopY = 4.11;
    const boxH = boxTopY - boxBottomY; // 2.91 m

    // Main Refrigerated Van Box (1.20 m .. 4.11 m)
    const sideMat = MATS.trailerSideSkin();
    const plainMat = MATS.trailerWhitePlain();
    const boxMaterials = [
      sideMat, // +X (left/east side)
      sideMat, // -X (right/west side - struck by Vehicle A)
      plainMat, // +Y (roof)
      MATS.chassisBlack(), // -Y (underfloor)
      plainMat, // +Z (rear doors)
      plainMat // -Z (front bulkhead)
    ];
    const mainBoxGeo = new THREE.BoxGeometry(W, boxH, L);
    const mainBox = setShadows(new THREE.Mesh(mainBoxGeo, boxMaterials));
    mainBox.name = 'trailer_van_box';
    mainBox.position.set(0, boxBottomY + boxH * 0.5, 0);
    veh.add(mainBox);

    // 3D Vertical Stiffener Ribs & Extruded Rub Rails along both sides for crisp specular highlights
    const ribGeo = getGeo('trailer_3d_rib', () => new THREE.BoxGeometry(W + 0.016, boxH - 0.14, 0.035));
    for (let z = -7.7; z <= 7.7; z += 0.64) {
      const rib = new THREE.Mesh(ribGeo, plainMat);
      rib.position.set(0, boxBottomY + boxH * 0.5, z);
      veh.add(rib);
    }

    // Top and bottom extruded aluminum rub rails
    const topRail = new THREE.Mesh(new THREE.BoxGeometry(W + 0.03, 0.10, L + 0.02), MATS.alloyWheel());
    topRail.position.set(0, boxTopY - 0.05, 0);
    veh.add(topRail);

    const botRail = new THREE.Mesh(new THREE.BoxGeometry(W + 0.03, 0.12, L + 0.02), MATS.alloyWheel());
    botRail.position.set(0, boxBottomY + 0.06, 0);
    veh.add(botRail);

    // 3D FMVSS 108 Retroreflective Conspicuity Tape Strips (Red/White alternating along bottom side rail at y = 1.22 m)
    const numSegs = 26;
    const segLen = (L - 0.3) / numSegs;
    const tapeStripGeo = getGeo('dot_tape_seg', () => new THREE.BoxGeometry(W + 0.038, 0.055, segLen * 0.94));
    for (let i = 0; i < numSegs; i++) {
      const tz = -L * 0.5 + 0.15 + (i + 0.5) * segLen;
      const mat = i % 2 === 0 ? MATS.conspicuityRed() : MATS.conspicuityWhite();
      const strip = new THREE.Mesh(tapeStripGeo, mat);
      strip.position.set(0, 1.23, tz);
      veh.add(strip);
    }

    // Amber Side-Marker Lamps along bottom rail (V1 hood scraped by mid side-marker lamp per police_report.txt p.1!)
    for (const mz of [-7.85, 0.0, 7.85]) {
      const mat = mz > 5 ? MATS.redMarkerLamp() : MATS.amberMarkerLamp();
      const sLamp = new THREE.Mesh(new THREE.BoxGeometry(W + 0.05, 0.05, 0.11), mat);
      sLamp.position.set(0, 1.20, mz);
      veh.add(sLamp);
    }

    // Front Nose-Mounted Refrigeration Unit (Thermo King / Carrier style reefer unit at z = -8.075 m)
    const reeferGroup = new THREE.Group();
    reeferGroup.name = 'reefer_unit';
    reeferGroup.position.set(0, 2.75, -L * 0.5 - 0.24);
    const reeferBody = setShadows(new THREE.Mesh(new THREE.BoxGeometry(1.92, 1.98, 0.48), MATS.reeferHousing()));
    reeferGroup.add(reeferBody);
    const reeferGrille = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.92, 0.50), MATS.panelGapDark());
    reeferGrille.position.set(0, 0.32, 0);
    reeferGroup.add(reeferGrille);
    const reeferCtrl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.52, 0.51), MATS.chassisBlack());
    reeferCtrl.position.set(-0.62, -0.52, 0);
    reeferGroup.add(reeferCtrl);
    veh.add(reeferGroup);

    // Kingpin & Upper Coupler Bolster Plate (at 0.91 m from front nose -> z = -7.165 m)
    const bolster = new THREE.Mesh(new THREE.BoxGeometry(2.40, 0.06, 1.60), MATS.chassisBlack());
    bolster.position.set(0, 1.18, -7.165);
    veh.add(bolster);
    const kingpin = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 12), MATS.steelGalvanized());
    kingpin.position.set(0, 1.11, -7.165);
    veh.add(kingpin);

    // Full-Length Underframe Sub-Structure & Aerodynamic Side Skirts (0.44 m .. 1.26 m)
    // Ensures continuous solid occlusion geometry under the trailer from front landing gear to rear impact guard
    const skirtHeight = 0.82; // y = 0.44 m to 1.26 m
    const skirtCenterY = 0.85;
    const skirtLength = 13.80; // Spans z = -6.70 m to +7.10 m continuously
    for (const side of [-1, 1]) {
      const skirtPanel = setShadows(
        new THREE.Mesh(new THREE.BoxGeometry(0.06, skirtHeight, skirtLength), plainMat)
      );
      skirtPanel.name = side < 0 ? 'trailer_skirt_R' : 'trailer_skirt_L';
      skirtPanel.position.set(side * (W * 0.5 - 0.05), skirtCenterY, 0.20);
      veh.add(skirtPanel);

      // Skirt lower rubber flexible fairing lip (y = 0.36 m to 0.46 m)
      const skirtLip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.10, skirtLength), MATS.tireRubber());
      skirtLip.position.set(side * (W * 0.5 - 0.05), 0.40, 0.20);
      veh.add(skirtLip);
    }

    // Center longitudinal I-beam spine & cross-ribs under trailer floor (fills internal volume between skirts)
    const centerSpine = setShadows(
      new THREE.Mesh(new THREE.BoxGeometry(2.36, 0.78, 14.20), MATS.chassisBlack())
    );
    centerSpine.name = 'trailer_underchassis_core';
    centerSpine.position.set(0, 0.84, 0.25);
    veh.add(centerSpine);

    // Landing Gear Assembly (at z = -5.15 m)
    const lgGroup = new THREE.Group();
    lgGroup.name = 'landing_gear';
    lgGroup.position.set(0, 0, -5.15);
    for (const side of [-1, 1]) {
      const legUpper = setShadows(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.75, 0.16), MATS.chassisBlack()));
      legUpper.position.set(side * 0.96, 0.86, 0);
      lgGroup.add(legUpper);
      const legFoot = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.28), MATS.chassisBlack());
      legFoot.position.set(side * 0.96, 0.46, 0);
      lgGroup.add(legFoot);
    }
    const lgBrace = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.0, 8), MATS.chassisBlack());
    lgBrace.rotation.z = PI / 2;
    lgBrace.position.set(0, 0.75, 0);
    lgGroup.add(lgBrace);
    veh.add(lgGroup);

    // Underbody Reefer Diesel Fuel Tank (cylindrical aluminum tank at z = -2.4 m)
    const reeferTankGeo = new THREE.CylinderGeometry(0.28, 0.28, 1.45, 20);
    reeferTankGeo.rotateX(PI / 2);
    const reeferTank = setShadows(new THREE.Mesh(reeferTankGeo, MATS.alloyWheel()));
    reeferTank.position.set(0.75, 0.78, -2.4);
    veh.add(reeferTank);

    // Rear Sliding Tandem Axle Bogie (axles at 12.50 m and 13.72 m from front -> z = +4.425 m and +5.645 m)
    const tandemAxleZ = [4.425, 5.645];
    const bogieFrame = setShadows(new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.42, 2.55), MATS.chassisBlack()));
    bogieFrame.position.set(0, 0.96, 5.035);
    veh.add(bogieFrame);

    for (let a = 0; a < tandemAxleZ.length; a++) {
      const az = tandemAxleZ[a];
      const axleBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.15, 12), MATS.chassisBlack());
      axleBeam.rotation.z = PI / 2;
      axleBeam.position.set(0, 0.52, az);
      veh.add(axleBeam);

      const wL = buildCommercialWheel(0.52, 0.28, true, true);
      wL.name = `trailer_wheel_L${a + 1}`;
      wL.position.set(-0.92, 0.52, az);
      veh.add(wL);

      const wR = buildCommercialWheel(0.52, 0.28, false, true);
      wR.name = `trailer_wheel_R${a + 1}`;
      wR.position.set(0.92, 0.52, az);
      veh.add(wR);
    }

    // Rear Barn Doors, Vertical Locking Rods, Hinges, and DOT Rear Underride Impact Guard (at z = +8.075 m)
    const rearZ = L * 0.5;
    // Center door seam
    const doorSeam = new THREE.Mesh(new THREE.BoxGeometry(0.02, boxH - 0.1, 0.02), MATS.panelGapDark());
    doorSeam.position.set(0, boxBottomY + boxH * 0.5, rearZ + 0.005);
    veh.add(doorSeam);

    // 4 Vertical galvanized steel locking bars
    for (const lx of [-0.88, -0.32, 0.32, 0.88]) {
      const lockBar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, boxH - 0.16, 8), MATS.steelGalvanized());
      lockBar.position.set(lx, boxBottomY + boxH * 0.5, rearZ + 0.03);
      veh.add(lockBar);

      // Door latches
      const latch = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.05), MATS.steelGalvanized());
      latch.position.set(lx, boxBottomY + 0.45, rearZ + 0.04);
      veh.add(latch);
    }

    // Door hinges on outer edges
    for (const side of [-1, 1]) {
      for (const hy of [1.55, 2.25, 2.95, 3.65]) {
        const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.04), MATS.steelGalvanized());
        hinge.position.set(side * (W * 0.5 - 0.06), hy, rearZ + 0.02);
        veh.add(hinge);
      }

      // Rear mudflaps
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.65, 0.025), MATS.tireRubber());
      flap.position.set(side * 0.92, 0.52, 6.32);
      veh.add(flap);
    }

    // Rear Impact Guard (ICC Bar / Underride Guard) with red/white conspicuity tape
    const rigGroup = new THREE.Group();
    rigGroup.name = 'rear_impact_guard';
    for (const vx of [-0.82, 0.82]) {
      const strut = setShadows(new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.68, 0.10), MATS.steelGalvanized()));
      strut.position.set(vx, 0.86, rearZ - 0.08);
      rigGroup.add(strut);
    }
    const rigBar = setShadows(new THREE.Mesh(new THREE.BoxGeometry(2.42, 0.12, 0.12), MATS.steelGalvanized()));
    rigBar.position.set(0, 0.52, rearZ - 0.04);
    rigGroup.add(rigBar);

    for (let s = 0; s < 8; s++) {
      const sx = -1.05 + s * 0.30;
      const tape = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.055, 0.015),
        s % 2 === 0 ? MATS.conspicuityRed() : MATS.conspicuityWhite()
      );
      tape.position.set(sx, 0.52, rearZ + 0.025);
      rigGroup.add(tape);
    }
    veh.add(rigGroup);

    // Rear tail/brake lamps & top 3-bar ID lamps
    for (const tx of [-1.05, -0.82, 0.82, 1.05]) {
      const rLamp = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.03, 12), MATS.redMarkerLamp());
      rLamp.rotation.x = PI / 2;
      rLamp.position.set(tx, 1.26, rearZ + 0.02);
      veh.add(rLamp);
    }
    for (const ix of [-0.22, 0, 0.22]) {
      const idLamp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.035, 0.03), MATS.redMarkerLamp());
      idLamp.position.set(ix, boxTopY - 0.05, rearZ + 0.02);
      veh.add(idLamp);
    }

    veh.userData.dims = { length: 16.15, width: 2.59, height: 4.11 };
    return veh;
  }

  /**
   * 5.4 Witness A's Westbound Passenger Sedan (veh_wit_A)
   * Dimensions: Length = 4.80 m, Width = 1.85 m, Height = 1.48 m. Color: Silver/Gray (#7a8288).
   */
  function buildWitnessASedan() {
    const veh = buildSedanVehicleA().clone(true);
    veh.name = 'veh_wit_A';
    veh.scale.set(1.85 / 1.96, 1.48 / 1.445, 4.80 / 4.97);
    const silverMat = MATS.carPaintSilver();
    veh.traverse((child) => {
      if (child.isMesh && child.material === MATS.carPaintNavy()) {
        child.material = silverMat;
      }
    });
    veh.userData.dims = { length: 4.8, width: 1.85, height: 1.48 };
    return veh;
  }

  /**
   * 5.5 Witness C's Stopped Westbound Full-Size Pickup Truck (veh_wit_C)
   * Exact spec dimensions: Length = 5.80 m, Width = 2.02 m, Height = 1.92 m, Wheelbase = 3.68 m.
   * Color: Charcoal Gray (#586068).
   */
  function buildWitnessCPickup() {
    const veh = new THREE.Group();
    veh.name = 'veh_wit_C';
    const paintMat = MATS.carPaintCharcoal();

    // Pickup frame & underbody
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.18, 5.55), MATS.chassisBlack());
    frame.position.set(0, 0.34, 0);
    veh.add(frame);

    // Front Hood & Fenders (z = -2.90 m to -1.15 m)
    const hood = setShadows(new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.78, 1.72), paintMat));
    hood.position.set(0, 0.84, -2.02);
    hood.rotation.x = 0.04;
    veh.add(hood);

    // Chrome front bumper & grille
    const fBumper = setShadows(new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.28, 0.18), MATS.chrome()));
    fBumper.position.set(0, 0.44, -2.84);
    veh.add(fBumper);

    const grille = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.48, 0.08), MATS.chrome());
    grille.position.set(0, 0.88, -2.87);
    veh.add(grille);

    const grilleInsert = new THREE.Mesh(new THREE.BoxGeometry(1.30, 0.38, 0.09), MATS.panelGapDark());
    grilleInsert.position.set(0, 0.88, -2.875);
    veh.add(grilleInsert);

    // Headlamps (OFF in daylight)
    for (const side of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.10), MATS.headlampOff());
      hl.name = side < 0 ? 'headlight_L' : 'headlight_R';
      hl.position.set(side * 0.82, 0.88, -2.86);
      veh.add(hl);
    }

    // Crew Cab (z = -1.18 m to +0.72 m, top at y = 1.92 m)
    const cabLower = setShadows(new THREE.Mesh(new THREE.BoxGeometry(2.00, 0.82, 1.90), paintMat));
    cabLower.position.set(0, 0.84, -0.23);
    veh.add(cabLower);

    const cabUpper = setShadows(new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.68, 1.66), paintMat));
    cabUpper.position.set(0, 1.58, -0.15);
    veh.add(cabUpper);

    // Pickup Windshield & Rear Cab Window
    const pWs = new THREE.Mesh(new THREE.PlaneGeometry(1.66, 0.66), MATS.autoGlass());
    pWs.position.set(0, 1.55, -1.08);
    pWs.rotation.x = -0.58;
    veh.add(pWs);

    const pRearWin = new THREE.Mesh(new THREE.PlaneGeometry(1.58, 0.52), MATS.autoGlass());
    pRearWin.position.set(0, 1.58, 0.69);
    veh.add(pRearWin);

    for (const side of [-1, 1]) {
      const sWin = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.50), MATS.autoGlass());
      sWin.position.set(side * 0.915, 1.56, -0.12);
      sWin.rotation.y = side > 0 ? PI / 2 : -PI / 2;
      veh.add(sWin);

      // Tow mirrors
      const mHead = setShadows(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.10), MATS.panelGapDark()));
      mHead.position.set(side * 1.08, 1.38, -0.82);
      veh.add(mHead);

      // Chrome running boards
      const rBoard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 1.78), MATS.chrome());
      rBoard.position.set(side * 0.98, 0.34, -0.22);
      veh.add(rBoard);
    }

    // Open Cargo Bed with Side Walls, Floor, and Tailgate (z = +0.76 m to +2.90 m)
    const bedFloor = setShadows(new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.14, 2.12), MATS.chassisBlack()));
    bedFloor.position.set(0, 0.62, 1.82);
    veh.add(bedFloor);

    const bedFrontWall = setShadows(new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.58, 0.08), paintMat));
    bedFrontWall.position.set(0, 0.96, 0.78);
    veh.add(bedFrontWall);

    const tailgate = setShadows(new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.58, 0.10), paintMat));
    tailgate.position.set(0, 0.96, 2.85);
    veh.add(tailgate);

    for (const side of [-1, 1]) {
      const bedSide = setShadows(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.58, 2.12), paintMat));
      bedSide.position.set(side * 0.94, 0.96, 1.82);
      veh.add(bedSide);

      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.32, 0.08), MATS.taillampOff());
      tl.name = side < 0 ? 'taillight_L' : 'taillight_R';
      tl.position.set(side * 0.95, 0.98, 2.88);
      veh.add(tl);
    }

    // Chrome Rear Bumper
    const rBumper = setShadows(new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.22, 0.18), MATS.chrome()));
    rBumper.position.set(0, 0.48, 2.88);
    veh.add(rBumper);

    // 4 Pickup Wheels (Axles at 0.98 m and 4.66 m from front -> z = -1.92 m and +1.76 m)
    for (const [wName, wx, wz, isLeft] of [
      ['wheel_FL', -0.89, -1.92, true],
      ['wheel_FR', 0.89, -1.92, false],
      ['wheel_RL', -0.89, 1.76, true],
      ['wheel_RR', 0.89, 1.76, false]
    ]) {
      const w = buildPassengerWheel(0.41, 0.265, isLeft);
      w.name = wName;
      w.position.set(wx, 0.41, wz);
      veh.add(w);
    }

    veh.userData.dims = { length: 5.8, width: 2.02, height: 1.92 };
    veh.userData.driverEye = [-0.45, 1.6, -0.35];
    return veh;
  }

  // --------------------------------------------------------------------------
  // 6. OBJECT REGISTRATION HELPER (STRICT PREFIX CHECK: veh_ occ_ sig_ road_ mark_ bld_)
  // --------------------------------------------------------------------------
  function registerObject(id, node, kind, label, citation, occludes = false, extra = {}) {
    node.name = id;
    root.add(node);
    objects[id] = {
      node,
      kind,
      label,
      citation,
      occludes: Boolean(occludes),
      ...extra
    };
    return objects[id];
  }

  // --------------------------------------------------------------------------
  // 7. LIGHTING, ATMOSPHERE & SKY DOME (world_env)
  // --------------------------------------------------------------------------
  // Date: 2016-05-07 16:36:12.7 EDT (UTC-04:00), Lat 29.4106, Lon -82.5393.
  // Computed Solar Ephemeris: Azimuth = 265.0 deg (just south of due west), Elevation = 45.1 deg.
  // Direction vector toward sun in (+X East, +Y Up, -Z North) frame:
  //   sx = sin(az) * cos(el), sy = sin(el), sz = -cos(az) * cos(el)
  {
    const envGroup = new THREE.Group();
    envGroup.name = 'world_env';

    const sunAz = 265.0 * D2R;
    const sunEl = 45.1 * D2R;
    const sunDir = new THREE.Vector3(
      Math.sin(sunAz) * Math.cos(sunEl),
      Math.sin(sunEl),
      -Math.cos(sunAz) * Math.cos(sunEl)
    ).normalize();

    // Directional Sun Light
    const sunLight = new THREE.DirectionalLight(0xfff7e8, 2.65);
    sunLight.name = 'sun_directional_light';
    sunLight.position.copy(sunDir).multiplyScalar(220);
    sunLight.target.position.set(0, 0, 0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(4096, 4096);
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 520;
    sunLight.shadow.camera.left = -140;
    sunLight.shadow.camera.right = 140;
    sunLight.shadow.camera.top = 100;
    sunLight.shadow.camera.bottom = -100;
    sunLight.shadow.bias = -0.00035;
    sunLight.shadow.normalBias = 0.02;
    envGroup.add(sunLight);
    envGroup.add(sunLight.target);

    // Secondary fill light from opposite sky hemisphere so shadowed sides are never dead black
    const skyFill = new THREE.DirectionalLight(0x9ec2eb, 0.55);
    skyFill.name = 'sky_fill_light';
    skyFill.position.set(-sunDir.x * 120, 95, -sunDir.z * 120);
    skyFill.castShadow = false;
    envGroup.add(skyFill);

    // Hemisphere Light (Sky blue zenith / warm Bahia grass bounce)
    const hemiLight = new THREE.HemisphereLight(0xcce4ff, 0x6b784e, 0.68);
    hemiLight.name = 'hemisphere_light';
    hemiLight.position.set(0, 120, 0);
    envGroup.add(hemiLight);

    // Physically Inspired Atmospheric Sky Dome (inverted sphere radius 1800 m with vertex colors + solar aureole)
    const skyRadius = 1800;
    const skyGeo = new THREE.SphereGeometry(skyRadius, 48, 32);
    const skyPos = skyGeo.attributes.position;
    const skyColors = new Float32Array(skyPos.count * 3);

    const zenithCol = new THREE.Color(0x1f5ca8);
    const midSkyCol = new THREE.Color(0x5a9be0);
    const horizonCol = new THREE.Color(0xcde2f5);
    const groundBounceCol = new THREE.Color(0x7a8668);
    const sunDiskCol = new THREE.Color(0xfffbe6);
    const tmpCol = new THREE.Color();
    const vDir = new THREE.Vector3();

    for (let i = 0; i < skyPos.count; i++) {
      vDir.set(skyPos.getX(i), skyPos.getY(i), skyPos.getZ(i)).normalize();
      const y = vDir.y;
      if (y >= 0) {
        const t1 = Math.pow(clamp(y, 0, 1), 0.45);
        tmpCol.copy(horizonCol).lerp(midSkyCol, clamp(t1 * 1.5, 0, 1));
        if (t1 > 0.35) {
          tmpCol.lerp(zenithCol, (t1 - 0.35) / 0.65);
        }
        // Solar scattering glow (Preetham/Hosek-style forward scatter around sunDir)
        const cosTheta = Math.max(0, vDir.dot(sunDir));
        const mieGlow = Math.pow(cosTheta, 12) * 0.38 + Math.pow(cosTheta, 256) * 0.65;
        tmpCol.lerp(sunDiskCol, clamp(mieGlow, 0, 1));
      } else {
        tmpCol.copy(horizonCol).lerp(groundBounceCol, clamp(-y * 3.5, 0, 1));
      }
      skyColors[i * 3] = tmpCol.r;
      skyColors[i * 3 + 1] = tmpCol.g;
      skyColors[i * 3 + 2] = tmpCol.b;
    }
    skyGeo.setAttribute('color', new THREE.BufferAttribute(skyColors, 3));

    const skyMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false
    });
    const skyDome = new THREE.Mesh(skyGeo, skyMat);
    skyDome.name = 'sky_dome';
    skyDome.renderOrder = -100;
    envGroup.add(skyDome);

    root.add(envGroup);
    root.userData.env = {
      fog: { color: 0xcde2f5, near: 420, far: 1850 },
      background: 0x89b9e8,
      exposure: 1.0,
      selfLit: true
    };
  }

  // --------------------------------------------------------------------------
  // 8. GROUND, ROADWAY CROSS-SECTION, SHOULDERS, MEDIAN, CROSSOVER & NE 140th CT
  // --------------------------------------------------------------------------
  // All 42 scene spec elements are built below with their exact positions, dimensions,
  // citations, and Contract v1 prefix compliance (road_, occ_, sig_, mark_, bld_, veh_).

  // 8.1 Surrounding Rural Grass and Sandy Soil Ground Plane (road_ground_base)
  {
    const grassTex = getGrassGroundTexture('pasture', 64, 64);
    const groundMat = new THREE.MeshStandardMaterial({
      color: grassTex ? 0xffffff : 0x6b7c4e,
      map: grassTex || null,
      roughness: 0.92,
      metalness: 0.0
    });
    const groundGeo = new THREE.PlaneGeometry(1800, 1800, 64, 64);
    groundGeo.rotateX(-PI / 2);

    // Subtle undulation far outside the highway clear zone (|z| > 55 m) while keeping y = 0 flat on all roads & witness spots
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const gx = pos.getX(i) - 50;
      const gz = pos.getZ(i);
      let gy = -0.015;
      const distFromHwy = Math.max(0, Math.abs(gz + 17.37) - 45);
      if (distFromHwy > 0 && Math.abs(gx) > 35) {
        gy += smoothstep(0, 60, distFromHwy) * (fbm2D(gx * 0.012, gz * 0.012, 3, 77) - 0.45) * 2.2;
      }
      pos.setY(i, gy);
    }
    groundGeo.computeVertexNormals();

    const groundNode = new THREE.Group();
    const groundMesh = setShadows(new THREE.Mesh(groundGeo, groundMat), false, true);
    groundNode.position.set(-50, 0, 0);
    groundNode.add(groundMesh);

    registerObject(
      'road_ground_base',
      groundNode,
      'road',
      'Surrounding rural grass and sandy soil ground plane',
      'world_v2.js lines 15-16; evidence/map.png',
      false
    );
  }

  // Shared road asphalt materials
  const asphaltMainTex = getAsphaltTexture('main', 1, 90);
  const asphaltBumpTex = getAsphaltBumpTexture(2, 120);
  const matAsphaltMain = new THREE.MeshStandardMaterial({
    color: asphaltMainTex ? 0xd8dadf : 0x3a3c3f,
    map: asphaltMainTex || null,
    bumpMap: asphaltBumpTex || null,
    bumpScale: 0.008,
    roughness: 0.82,
    metalness: 0.0
  });

  const asphaltShoulderTex = getAsphaltTexture('shoulder', 1, 90);
  const matAsphaltShoulder = new THREE.MeshStandardMaterial({
    color: asphaltShoulderTex ? 0xdcdfe4 : 0x434548,
    map: asphaltShoulderTex || null,
    bumpMap: asphaltBumpTex || null,
    bumpScale: 0.01,
    roughness: 0.86,
    metalness: 0.0
  });

  const asphaltTurnTex = getAsphaltTexture('turn', 1, 30);
  const matAsphaltTurn = new THREE.MeshStandardMaterial({
    color: asphaltTurnTex ? 0xdadce0 : 0x3d3f42,
    map: asphaltTurnTex || null,
    bumpMap: asphaltBumpTex || null,
    bumpScale: 0.008,
    roughness: 0.84,
    metalness: 0.0
  });

  // Helper to build a slightly crowned road slab (dims: length along heading, width across)
  function buildRoadSlabNode(x, y, z, headingDeg, length, width, height, mat, crown = 0.012) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.y = -headingDeg * D2R;

    // Local -Z is forward (length along Z), local X is width
    const geo = new THREE.BoxGeometry(width, height, length, 6, 1, 16);
    const pos = geo.attributes.position;
    const halfW = width * 0.5 || 1;
    for (let i = 0; i < pos.count; i++) {
      const py = pos.getY(i);
      if (py > 0) {
        const px = pos.getX(i);
        const c = crown * (1 - (px / halfW) * (px / halfW));
        pos.setY(i, py + c);
      }
    }
    geo.computeVertexNormals();
    const mesh = setShadows(new THREE.Mesh(geo, mat), false, true);
    mesh.position.y = height * 0.5;
    g.add(mesh);
    return g;
  }

  // 8.2 US-27A Eastbound Travel Lanes (road_eb)
  // Two 12-ft / 3.66 m lanes: inside lane z = -5.49 to -1.83 m, outside lane z = -1.83 to +1.83 m (centered at z = -1.83 m)
  registerObject(
    'road_eb',
    buildRoadSlabNode(-50, 0, -1.83, 90, 780, 7.32, 0.02, matAsphaltMain, 0.008),
    'road',
    'US-27A Eastbound travel lanes (two 12-ft / 3.66 m lanes: inside lane z = -5.49 to -1.83 m, outside lane z = -1.83 to +1.83 m)',
    'facts.txt F6, F9; police_report.txt p.1, p.3; world_v2.js line 19',
    false
  );

  // 8.3 US-27A Eastbound Outside (South) Paved Shoulder (road_shoulder_eb_south)
  registerObject(
    'road_shoulder_eb_south',
    buildRoadSlabNode(-50, 0, 2.59, 90, 780, 1.52, 0.018, matAsphaltShoulder, 0.002),
    'road',
    'US-27A Eastbound outside (right/south) paved shoulder (5 ft / 1.52 m wide)',
    'facts.txt F6; police_report.txt p.3',
    false
  );

  // 8.4 US-27A Eastbound Inside (North) Paved Shoulder (road_shoulder_eb_north)
  registerObject(
    'road_shoulder_eb_north',
    buildRoadSlabNode(-50, 0, -5.795, 90, 780, 0.61, 0.018, matAsphaltShoulder, 0.002),
    'road',
    'US-27A Eastbound inside (left/north) paved shoulder (2 ft / 0.61 m wide)',
    'facts.txt F6; police_report.txt p.3',
    false
  );

  // 8.5 US-27A Westbound Travel Lanes (road_wb)
  // Two 12-ft / 3.66 m lanes: inside lane z = -32.92 to -29.26 m, outside lane z = -36.58 to -32.92 m
  registerObject(
    'road_wb',
    buildRoadSlabNode(-50, 0, -32.92, 90, 780, 7.32, 0.02, matAsphaltMain, 0.008),
    'road',
    'US-27A Westbound travel lanes (two 12-ft / 3.66 m lanes: inside lane z = -32.92 to -29.26 m, outside lane z = -36.58 to -32.92 m)',
    'facts.txt F6, F9; police_report.txt p.3; world_v2.js line 20',
    false
  );

  // 8.6 US-27A Westbound Outside (North) Paved Shoulder (road_shoulder_wb_north)
  registerObject(
    'road_shoulder_wb_north',
    buildRoadSlabNode(-50, 0, -37.34, 90, 780, 1.52, 0.018, matAsphaltShoulder, 0.002),
    'road',
    'US-27A Westbound outside (right/north) paved shoulder (5 ft / 1.52 m wide)',
    'facts.txt F6; police_report.txt p.3',
    false
  );

  // 8.7 US-27A Westbound Inside (South) Paved Shoulder West of Crossover (road_shoulder_wb_south)
  registerObject(
    'road_shoulder_wb_south',
    buildRoadSlabNode(-229.9, 0, -28.955, 90, 420.2, 0.61, 0.018, matAsphaltShoulder, 0.002),
    'road',
    'US-27A Westbound inside (left/south) paved shoulder (2 ft / 0.61 m wide, west of crossover)',
    'facts.txt F6; police_report.txt p.3',
    false
  );

  // 8.8 US-27A Westbound Left-Turn Lane (road_wb_turn)
  // 550 ft / 167.6 m storage + taper, 12 ft / 3.66 m wide (z = -29.26 to -25.60 m, centered at z = -27.43 m)
  registerObject(
    'road_wb_turn',
    buildRoadSlabNode(73.9, 0, -27.43, 90, 187.4, 3.66, 0.02, matAsphaltTurn, 0.004),
    'road',
    'US-27A Westbound left-turn lane (550 ft / 167.6 m storage + taper, 12 ft / 3.66 m wide)',
    'facts.txt F8; police_report.txt p.3; evidence/map.png; world_v2.js line 21',
    false
  );

  // 8.9 US-27A Eastbound Auxiliary Turn Lane (road_eb_turn)
  registerObject(
    'road_eb_turn',
    buildRoadSlabNode(-103.6, 0, 3.66, 90, 167.6, 3.66, 0.019, matAsphaltTurn, 0.004),
    'road',
    'US-27A Eastbound Auxiliary Turn Lanes (550 ft / 167.6 m left- and right-turn lanes mentioned in NTSB report)',
    'facts.txt F8',
    false
  );

  // 8.10 Grassy/Earthen Median West and East of the Crossover (road_median_w, road_median_e)
  const medianTex = getGrassGroundTexture('median', 28, 4);
  const matMedianGrass = new THREE.MeshStandardMaterial({
    color: medianTex ? 0xffffff : 0x748854,
    map: medianTex || null,
    roughness: 0.92,
    metalness: 0.0
  });

  // Build median mounds with gently rounded concrete-curb/sod noses at the crossover ends (x = -19.8 m and x = +19.8 m)
  registerObject(
    'road_median_w',
    buildRoadSlabNode(-229.9, 0, -15.24, 90, 420.2, 18.28, 0.05, matMedianGrass, 0.03),
    'road',
    'Grassy/earthen median west of the crossover (~60 ft / 18.28 m grass width; total median opening between main roadbeds 23.77 m)',
    'facts.txt F7, F8; police_report.txt p.1, p.3; evidence/map.png; world_v2.js line 22',
    false
  );

  registerObject(
    'road_median_e',
    buildRoadSlabNode(179.9, 0, -15.24, 90, 320.2, 18.28, 0.05, matMedianGrass, 0.03),
    'road',
    'Grassy/earthen median east of the crossover (~60 ft / 18.28 m grass width)',
    'facts.txt F7, F8; police_report.txt p.1, p.3; evidence/map.png; world_v2.js line 23',
    false
  );

  // 8.11 Uncontrolled Paved Median Crossover at NE 140th Court (road_crossover)
  // 130 ft / 39.6 m long along highway (x = -19.8 to +19.8 m), spanning median width (23.77 m)
  registerObject(
    'road_crossover',
    buildRoadSlabNode(0, 0, -17.37, 0, 23.77, 39.6, 0.022, matAsphaltTurn, 0.005),
    'road',
    'Uncontrolled paved median crossover at NE 140th Court (130 ft / 39.6 m long along highway, spanning median width)',
    'facts.txt F8; police_report.txt p.1, p.3; evidence/map.png; world_v2.js line 24',
    false
  );

  // 8.12 NE 140th Court Local Paved Road (road_ne140)
  // Runs south from US-27A (x = 0, z = 76.7 m, length 146.6 m, width 6.1 m) + flared intersection apron radii
  {
    const ne140Group = buildRoadSlabNode(0, 0, 76.7, 0, 146.6, 6.1, 0.02, matAsphaltTurn, 0.008);

    // Flared corner aprons connecting NE 140th Ct (width 6.1 m) smoothly to US-27A EB edge (z = 1.83 .. 6.5 m)
    const apronShape = new THREE.Shape();
    apronShape.moveTo(-9.5, 1.83);
    apronShape.lineTo(9.5, 1.83);
    apronShape.quadraticCurveTo(3.2, 2.2, 3.05, 8.5);
    apronShape.lineTo(-3.05, 8.5);
    apronShape.quadraticCurveTo(-3.2, 2.2, -9.5, 1.83);
    const apronGeo = new THREE.ShapeGeometry(apronShape, 12);
    apronGeo.rotateX(PI / 2);
    const apronMesh = setShadows(new THREE.Mesh(apronGeo, matAsphaltTurn), false, true);
    apronMesh.position.set(0, 0.021, -76.7);
    ne140Group.add(apronMesh);

    registerObject(
      'road_ne140',
      ne140Group,
      'road',
      'NE 140th Court local paved road (runs south from US-27A; 109-deg actual skew simplified to 90-deg in reference world)',
      'facts.txt F11, Modeling assumptions; evidence/map.png; world_v2.js line 25',
      false
    );
  }

  // 8.13 Store Parking & Pull-Off Apron (road_store_parking_apron)
  {
    const gravelTex = getGravelTexture(8, 3);
    const matGravel = new THREE.MeshStandardMaterial({
      color: gravelTex ? 0xffffff : 0xb8b3a8,
      map: gravelTex || null,
      roughness: 0.90,
      metalness: 0.0
    });
    const apronNode = buildRoadSlabNode(16, 0.01, 9, 90, 24, 9, 0.012, matGravel, 0.002);
    registerObject(
      'road_store_parking_apron',
      apronNode,
      'road',
      'Gravel/paved parking and pull-off area in front of retail store connecting to US-27A and NE 140th Ct',
      'inferred: deposition.txt 77-83, 95; evidence/map.png; typical rural store frontage',
      false
    );
  }

  // 8.14 Residential Driveway East near Vehicle A Final Rest (road_residential_driveway_east)
  {
    const gravelTex = getGravelTexture(2, 8);
    const matDriveway = new THREE.MeshStandardMaterial({
      color: gravelTex ? 0xf5f2ec : 0xc2bdb2,
      map: gravelTex || null,
      roughness: 0.85,
      metalness: 0.0
    });
    const drvNode = buildRoadSlabNode(280, 0.01, 14, 0, 22, 4, 0.02, matDriveway, 0.003);
    registerObject(
      'road_residential_driveway_east',
      drvNode,
      'road',
      'Residential driveway near Vehicle A final rest',
      'police_report.txt p.2 (in the front yard of a residence near a driveway); inferred placement near mark_rest_A',
      false
    );
  }

  // 8.15 Roadside Drainage Ditch and Concrete Pipe Culvert SE (road_drainage_culvert_se)
  // Crossed by Vehicle A post-impact at x = 85 m, z = 9.5 m
  {
    const culvGroup = new THREE.Group();
    culvGroup.position.set(85, -0.4, 9.5);
    culvGroup.rotation.y = -90 * D2R;

    // Precast concrete culvert pipe (axis along Z in local group -> along X in world)
    const pipeOuter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 8.0, 20, 1, true),
      MATS.concreteGrey()
    );
    pipeOuter.rotation.x = PI / 2;
    pipeOuter.position.y = 0.30;
    culvGroup.add(pipeOuter);

    const pipeCore = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.26, 8.02, 16),
      MATS.panelGapDark()
    );
    pipeCore.rotation.x = PI / 2;
    pipeCore.position.y = 0.30;
    culvGroup.add(pipeCore);

    // Mitered concrete end headwalls at both ends
    for (const ez of [-4.0, 4.0]) {
      const headwall = setShadows(
        new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.55, 0.35), MATS.concreteGrey())
      );
      headwall.position.set(0, 0.32, ez);
      headwall.rotation.x = ez > 0 ? 0.35 : -0.35;
      culvGroup.add(headwall);
    }

    // Earthen drive-over berm above culvert
    const berm = setShadows(
      new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.22, 7.6), matMedianGrass),
      false,
      true
    );
    berm.position.set(0, 0.36, 0);
    culvGroup.add(berm);

    registerObject(
      'road_drainage_culvert_se',
      culvGroup,
      'road',
      'Roadside drainage ditch and concrete pipe culvert under driveway/side-road east of intersection (crossed by Vehicle A post-impact)',
      'facts.txt F24; police_report.txt p.2 (crossed a drainage culvert); inferred placement along Vehicle A post-impact trajectory',
      false
    );
  }

  // --------------------------------------------------------------------------
  // 9. VERTICAL CREST OF US-27A (occ_crest)
  // --------------------------------------------------------------------------
  // Vertical crest at 1,132 ft (345 m) west of intersection.
  // As required by Section 3 & Section 6F: Placed at [-377, 0, -15] (beyond Vehicle A's start x = -350.02 m)
  // with occludes: true so the car keyframes at y = 0 are never buried while sightlines beyond the crest are blocked.
  {
    const crestGroup = new THREE.Group();
    crestGroup.position.set(-377, 0, -15);

    // Sculpted terrain/road horizon mound representing the 7.4 m vertical crest restriction
    const crestGeo = new THREE.BoxGeometry(80, 7.4, 60, 12, 4, 8);
    const cPos = crestGeo.attributes.position;
    for (let i = 0; i < cPos.count; i++) {
      const cx = cPos.getX(i); // -40 .. +40 (east face at +40 -> world x = -337)
      const cy = cPos.getY(i) + 3.7; // 0 .. 7.4
      const cz = cPos.getZ(i);
      if (cy > 0.05) {
        // Taper the eastern slope smoothly so it crests west of x = -350 m
        const eastTaper = smoothstep(26, -5, cx);
        const sideTaper = 1.0 - 0.15 * Math.pow(cz / 30, 2);
        cPos.setY(i, cy * eastTaper * sideTaper);
      } else {
        cPos.setY(i, 0);
      }
    }
    crestGeo.computeVertexNormals();

    const crestMesh = setShadows(new THREE.Mesh(crestGeo, matMedianGrass), true, true);
    crestMesh.name = 'occ_crest_terrain_mound';
    crestGroup.add(crestMesh);

    // Draped asphalt road ribbon over the crest slope for visual continuity looking west
    const crestRoadGeo = new THREE.BoxGeometry(78, 7.42, 7.32, 12, 2, 2);
    const rPos = crestRoadGeo.attributes.position;
    for (let i = 0; i < rPos.count; i++) {
      const rx = rPos.getX(i);
      const ry = rPos.getY(i) + 3.71;
      if (ry > 0.05) {
        const eastTaper = smoothstep(26, -5, rx);
        rPos.setY(i, ry * eastTaper + 0.025);
      } else {
        rPos.setY(i, 0.01);
      }
    }
    crestRoadGeo.computeVertexNormals();
    const crestRoadMesh = setShadows(new THREE.Mesh(crestRoadGeo, matAsphaltMain), false, true);
    crestRoadMesh.position.set(0, 0, 13.17); // Aligns with EB lanes at z = -1.83 m
    crestGroup.add(crestRoadMesh);

    registerObject(
      'occ_crest',
      crestGroup,
      'terrain',
      'Vertical crest of US-27A at 1,132 ft (345 m) west of intersection (2.15% descent toward intersection)',
      'facts.txt F10, F27, F28; deposition.txt 120-126; world_v2.js line 28',
      true
    );
  }

  // --------------------------------------------------------------------------
  // 10. MUTCD PAVEMENT MARKINGS & RAISED PAVEMENT MARKERS (RPMs)
  // --------------------------------------------------------------------------

  function buildSolidStripeNode(x0, z0, x1, z1, width, mat, y = 0.025) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const cx = 0.5 * (x0 + x1);
    const cz = 0.5 * (z0 + z1);
    const headingRad = Math.atan2(dx, -dz);

    const group = new THREE.Group();
    group.position.set(cx, y, cz);
    group.rotation.y = -headingRad;

    const geo = new THREE.PlaneGeometry(width, len);
    geo.rotateX(-PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
    return group;
  }

  function buildBrokenLaneLineNode(xStart, xEnd, z, stripeLen, gapLen, width, mat, y = 0.025, includeRPMs = true) {
    const cx = 0.5 * (xStart + xEnd);
    const group = new THREE.Group();
    group.position.set(cx, y, z);

    const cycle = stripeLen + gapLen;
    const totalLen = xEnd - xStart;
    const count = Math.floor(totalLen / cycle);

    const dashGeo = getGeo(`dash_${stripeLen}_${width}`, () => {
      const g = new THREE.PlaneGeometry(stripeLen, width);
      g.rotateX(-PI / 2);
      return g;
    });
    const dashInst = new THREE.InstancedMesh(dashGeo, mat, count);
    dashInst.receiveShadow = true;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const xWorld = xStart + i * cycle + stripeLen * 0.5;
      dummy.position.set(xWorld - cx, 0, 0);
      dummy.updateMatrix();
      dashInst.setMatrixAt(i, dummy.matrix);
    }
    dashInst.instanceMatrix.needsUpdate = true;
    group.add(dashInst);

    // Raised Pavement Markers (RPMs / reflectors) centered in every second skip gap
    if (includeRPMs) {
      const rpmCount = Math.floor(count / 2);
      const rpmGeo = getGeo('rpm_prism', () => new THREE.BoxGeometry(0.10, 0.018, 0.10));
      const rpmInst = new THREE.InstancedMesh(rpmGeo, MATS.conspicuityWhite(), rpmCount);
      for (let i = 0; i < rpmCount; i++) {
        const xWorld = xStart + i * 2 * cycle + stripeLen + gapLen * 0.5;
        dummy.position.set(xWorld - cx, 0.009, 0);
        dummy.updateMatrix();
        rpmInst.setMatrixAt(i, dummy.matrix);
      }
      rpmInst.instanceMatrix.needsUpdate = true;
      group.add(rpmInst);
    }

    return group;
  }

  // 10.1 US-27A Eastbound Broken White Lane Line (mark_eb_lane_line)
  // 3.05 m (10 ft) segment, 9.14 m (30 ft) gap along z = -1.83 m
  registerObject(
    'mark_eb_lane_line',
    buildBrokenLaneLineNode(-440, 340, -1.83, 3.05, 9.14, 0.15, MATS.paintWhiteStripe(), 0.025, true),
    'mark',
    'US-27A Eastbound broken white lane line separating EB inside and outside lanes',
    'evidence/map.png; world_v2.js line 19; standard: MUTCD 2009 Section 3A.06 & 3B.04; inferred placement',
    false
  );

  // 10.2 US-27A Westbound Broken White Lane Line (mark_wb_lane_line)
  registerObject(
    'mark_wb_lane_line',
    buildBrokenLaneLineNode(-440, 340, -32.92, 3.05, 9.14, 0.15, MATS.paintWhiteStripe(), 0.025, true),
    'mark',
    'US-27A Westbound broken white lane line separating WB inside and outside lanes',
    'evidence/map.png; world_v2.js line 20; standard: MUTCD 2009 Section 3A.06 & 3B.04; inferred placement',
    false
  );

  // 10.3 US-27A Eastbound Solid White Right Edge Line West of NE 140th Ct (mark_eb_right_edge_w)
  registerObject(
    'mark_eb_right_edge_w',
    buildSolidStripeNode(-440, 1.83, -3.05, 1.83, 0.15, MATS.paintWhiteStripe(), 0.025),
    'mark',
    'US-27A Eastbound solid white right edge line (west of NE 140th Ct)',
    'evidence/map.png; world_v2.js line 19; standard: MUTCD 2009 Section 3B.06; inferred placement',
    false
  );

  // 10.4 US-27A Eastbound Solid White Right Edge Line East of NE 140th Ct (mark_eb_right_edge_e)
  registerObject(
    'mark_eb_right_edge_e',
    buildSolidStripeNode(3.05, 1.83, 340, 1.83, 0.15, MATS.paintWhiteStripe(), 0.025),
    'mark',
    'US-27A Eastbound solid white right edge line (east of NE 140th Ct)',
    'evidence/map.png; world_v2.js line 19; standard: MUTCD 2009 Section 3B.06; inferred placement',
    false
  );

  // 10.5 US-27A Eastbound Solid Yellow Median-Side Left Edge Line West of Crossover (mark_eb_left_edge_w)
  registerObject(
    'mark_eb_left_edge_w',
    buildSolidStripeNode(-440, -5.49, -19.8, -5.49, 0.15, MATS.paintYellowStripe(), 0.025),
    'mark',
    'US-27A Eastbound solid yellow median-side left edge line (west of crossover)',
    'evidence/map.png; standard: MUTCD 2009 Section 3B.06; inferred placement',
    false
  );

  // 10.6 US-27A Eastbound Solid Yellow Median-Side Left Edge Line East of Crossover (mark_eb_left_edge_e)
  registerObject(
    'mark_eb_left_edge_e',
    buildSolidStripeNode(19.8, -5.49, 340, -5.49, 0.15, MATS.paintYellowStripe(), 0.025),
    'mark',
    'US-27A Eastbound solid yellow median-side left edge line (east of crossover)',
    'evidence/map.png; standard: MUTCD 2009 Section 3B.06; inferred placement',
    false
  );

  // 10.7 US-27A Westbound Solid White Right (North) Edge Line (mark_wb_right_edge)
  registerObject(
    'mark_wb_right_edge',
    buildSolidStripeNode(-440, -36.58, 340, -36.58, 0.15, MATS.paintWhiteStripe(), 0.025),
    'mark',
    'US-27A Westbound solid white right (north) edge line',
    'evidence/map.png; world_v2.js line 20; standard: MUTCD 2009 Section 3B.06; inferred placement',
    false
  );

  // 10.8 US-27A Westbound Solid White Turn-Lane Channel Line (mark_wb_turn_channel_line)
  registerObject(
    'mark_wb_turn_channel_line',
    buildSolidStripeNode(-19.8, -29.26, 167.6, -29.26, 0.15, MATS.paintWhiteStripe(), 0.025),
    'mark',
    'US-27A Westbound solid white lane line separating WB inside lane from WB left-turn lane',
    'evidence/map.png; world_v2.js line 21; standard: MUTCD 2009 Section 3B.04; inferred placement',
    false
  );

  // 10.9 US-27A Westbound Solid Yellow Median-Side Edge Line East of Crossover (mark_wb_left_edge_e)
  registerObject(
    'mark_wb_left_edge_e',
    buildSolidStripeNode(19.8, -25.6, 340, -25.6, 0.15, MATS.paintYellowStripe(), 0.025),
    'mark',
    'US-27A Westbound solid yellow median-side edge line along WB left-turn lane (east of crossover)',
    'evidence/map.png; standard: MUTCD 2009 Section 3B.06; inferred placement',
    false
  );

  // 10.10 US-27A Westbound Solid Yellow Median-Side Edge Line West of Crossover (mark_wb_left_edge_w)
  registerObject(
    'mark_wb_left_edge_w',
    buildSolidStripeNode(-440, -25.6, -19.8, -25.6, 0.15, MATS.paintYellowStripe(), 0.025),
    'mark',
    'US-27A Westbound solid yellow median-side edge line (west of crossover)',
    'evidence/map.png; standard: MUTCD 2009 Section 3B.06; inferred placement',
    false
  );

  // 10.11 Westbound Left-Turn Lane Pavement Arrows (mark_wb_turn_arrows)
  // 3 MUTCD left-turn arrows at x = 25 m, 65 m, 115 m along z = -27.43 m (heading 270 deg = westbound)
  {
    const arrowsGroup = new THREE.Group();
    arrowsGroup.position.set(40, 0.026, -27.43);

    // MUTCD Left-Turn Arrow Shape (pointing West / -X, curving South / +Z)
    const arrowShape = new THREE.Shape();
    // Tail shaft starting at east (+1.2 m) going west to curve
    arrowShape.moveTo(1.22, -0.14);
    arrowShape.lineTo(0.10, -0.14);
    arrowShape.quadraticCurveTo(-0.45, -0.14, -0.45, 0.35);
    arrowShape.lineTo(-0.82, 0.35);
    arrowShape.lineTo(-0.30, 0.92); // Arrowhead tip pointing south (+Z)
    arrowShape.lineTo(0.22, 0.35);
    arrowShape.lineTo(-0.15, 0.35);
    arrowShape.quadraticCurveTo(-0.15, 0.14, 0.15, 0.14);
    arrowShape.lineTo(1.22, 0.14);
    arrowShape.closePath();

    const arrowGeo = new THREE.ShapeGeometry(arrowShape);
    arrowGeo.rotateX(PI / 2);

    for (const ax of [25, 65, 115]) {
      const m = new THREE.Mesh(arrowGeo, MATS.paintWhiteStripe());
      m.position.set(ax - 40, 0, 0);
      m.receiveShadow = true;
      arrowsGroup.add(m);
    }

    registerObject(
      'mark_wb_turn_arrows',
      arrowsGroup,
      'mark',
      'Westbound left-turn lane pavement arrows (3 left-turn arrows spaced along the 167.6 m turn lane)',
      'standard: MUTCD 2009 Section 3B.20; inferred placement',
      false
    );
  }

  // 10.12 Stop Line on Northbound NE 140th Court Approach (mark_ne140_stop_line)
  // Plus double-yellow centerline along NE 140th Court
  {
    const stopBarNode = buildSolidStripeNode(0, 5.5, 3.05, 5.5, 0.40, MATS.paintWhiteStripe(), 0.026);

    // Double yellow centerline on NE 140th Court south of stop bar (z = 6.2 m to 148 m)
    for (const cx of [-0.12, 0.12]) {
      const cl = buildSolidStripeNode(cx, 6.2, cx, 148, 0.12, MATS.paintYellowStripe(), 0.025);
      sceneryGroup.add(cl);
    }

    registerObject(
      'mark_ne140_stop_line',
      stopBarNode,
      'mark',
      'Stop line on northbound NE 140th Court approach to US-27A',
      'police_report.txt p.1 (stop sign on NE 140th Ct approach); standard: MUTCD 2009 Section 3B.16; inferred placement',
      false
    );
  }

  // --------------------------------------------------------------------------
  // 11. TRAFFIC SIGNS (MUTCD R1-1 STOP, R2-1 SPEED LIMIT 65)
  // --------------------------------------------------------------------------
  // Contract rule: Prefix sig_ with kind: 'sign' (not 'signal'), occludes: false.

  // 11.1 STOP Sign on Northbound NE 140th Court Approach (sig_sign_stop_ne140)
  // Position [4.2, 0, 6.0], heading 180 deg (faces south toward northbound side-road traffic)
  {
    const signGroup = new THREE.Group();
    signGroup.position.set(4.2, 0, 6.0);
    signGroup.rotation.y = -180 * D2R;

    // Galvanized U-channel post (0.06 m wide, 2.85 m tall)
    const post = setShadows(
      new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.85, 0.04), MATS.steelGalvanized())
    );
    post.position.set(0, 1.425, 0);
    signGroup.add(post);

    // Octagonal 30x30 in (0.76 x 0.76 m) sign panel, bottom at 2.13 m (7 ft), center at 2.51 m
    const r = 0.38 / Math.cos(PI / 8);
    const octShape = new THREE.Shape();
    for (let i = 0; i < 8; i++) {
      const ang = (i * PI) / 4 + PI / 8;
      const px = Math.cos(ang) * r;
      const py = Math.sin(ang) * r;
      if (i === 0) octShape.moveTo(px, py);
      else octShape.lineTo(px, py);
    }
    octShape.closePath();

    const octGeo = new THREE.ShapeGeometry(octShape);
    // Remap UVs from [-0.38..+0.38] to [0..1]
    const uvAttr = octGeo.attributes.uv;
    const posAttr = octGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      uvAttr.setXY(i, (posAttr.getX(i) + 0.38) / 0.76, (posAttr.getY(i) + 0.38) / 0.76);
    }

    const stopTex = getStopSignTexture();
    const stopMat = new THREE.MeshStandardMaterial({
      color: stopTex ? 0xffffff : 0xc41e3a,
      map: stopTex || null,
      roughness: 0.35,
      metalness: 0.2
    });
    const signFace = setShadows(new THREE.Mesh(octGeo, stopMat));
    signFace.rotation.y = PI; // Local -Z is forward (facing south when group heading = 180)
    signFace.position.set(0, 2.51, -0.026);
    signGroup.add(signFace);

    const signBack = setShadows(new THREE.Mesh(octGeo, MATS.steelGalvanized()));
    signBack.position.set(0, 2.51, -0.022);
    signGroup.add(signBack);

    registerObject(
      'sig_sign_stop_ne140',
      signGroup,
      'sign',
      'STOP sign on northbound NE 140th Court approach to US-27A',
      'police_report.txt p.1 (Traffic control: stop sign on the NE 140th Ct approach only); standard: MUTCD 2009 R1-1, Section 2A.18 & 2B.05; inferred placement',
      false
    );
  }

  // 11.2 SPEED LIMIT 65 Sign on US-27A Eastbound Roadside (sig_sign_speed_eb)
  // Position [-180, 0, 5.2], heading 270 deg (faces west toward eastbound traffic)
  {
    const signGroup = new THREE.Group();
    signGroup.position.set(-180, 0, 5.2);
    signGroup.rotation.y = -270 * D2R;

    const post = setShadows(
      new THREE.Mesh(new THREE.BoxGeometry(0.07, 3.25, 0.045), MATS.steelGalvanized())
    );
    post.position.set(0, 1.625, 0);
    signGroup.add(post);

    const speedTex = getSpeedLimitSignTexture(65);
    const speedMat = new THREE.MeshStandardMaterial({
      color: speedTex ? 0xffffff : 0xf5f5f5,
      map: speedTex || null,
      roughness: 0.35,
      metalness: 0.2
    });
    const panelGeo = new THREE.PlaneGeometry(0.91, 1.22);
    const frontFace = setShadows(new THREE.Mesh(panelGeo, speedMat));
    frontFace.rotation.y = PI; // Faces local -Z
    frontFace.position.set(0, 2.74, -0.028);
    signGroup.add(frontFace);

    const backFace = setShadows(new THREE.Mesh(panelGeo, MATS.steelGalvanized()));
    backFace.position.set(0, 2.74, -0.022);
    signGroup.add(backFace);

    registerObject(
      'sig_sign_speed_eb',
      signGroup,
      'sign',
      'SPEED LIMIT 65 sign on US-27A Eastbound roadside',
      'facts.txt F13; police_report.txt p.1 (Posted speed: 65 mph, US-27A); standard: MUTCD 2009 R2-1, Section 2B.13; inferred placement',
      false
    );
  }

  // --------------------------------------------------------------------------
  // 12. BUILDINGS, STOREFRONT & OPEN-SIDED BENCH SHELTER
  // --------------------------------------------------------------------------

  // 12.1 Retail Store on SE Corner (bld_store)
  // Position [18, 0, 19], footprint 18 m (east-west, x = 9 to 27 m) by 12 m (north-south, z = 13 to 25 m), height = 4.5 m.
  // occludes: true.
  {
    const storeGroup = new THREE.Group();
    storeGroup.position.set(18, 0, 19);

    const W = 18.0; // X span
    const D = 12.0; // Z span
    const H = 4.5;

    const stuccoTex = getStuccoWallTexture('#b89772', 6, 2);
    const matStucco = new THREE.MeshStandardMaterial({
      color: stuccoTex ? 0xffffff : 0xb89772,
      map: stuccoTex || null,
      roughness: 0.78,
      metalness: 0.08
    });
    const matTrimBrown = new THREE.MeshStandardMaterial({
      color: 0x5c4028,
      roughness: 0.65,
      metalness: 0.12
    });
    const matRoofMetal = new THREE.MeshStandardMaterial({
      color: 0x7a7d80,
      roughness: 0.48,
      metalness: 0.65
    });

    // Concrete foundation slab + sidewalk apron around north and west fronts
    const foundation = setShadows(
      new THREE.Mesh(new THREE.BoxGeometry(W + 2.8, 0.14, D + 2.8), MATS.concreteGrey()),
      false,
      true
    );
    foundation.position.set(-0.6, 0.07, -0.6);
    storeGroup.add(foundation);

    // Main masonry building volume (x = -9 .. +9, z = -6 .. +6, y = 0.14 .. 4.25)
    const mainWallBox = setShadows(
      new THREE.Mesh(new THREE.BoxGeometry(W, 4.11, D), matStucco),
      true,
      true
    );
    mainWallBox.name = 'store_main_walls';
    mainWallBox.position.set(0, 2.195, 0);
    storeGroup.add(mainWallBox);

    // Lower wainscot brick/stone band
    const wainscot = setShadows(
      new THREE.Mesh(new THREE.BoxGeometry(W + 0.06, 0.92, D + 0.06), matTrimBrown)
    );
    wainscot.position.set(0, 0.60, 0);
    storeGroup.add(wainscot);

    // Upper parapet cornice & low-slope standing-seam metal roof (top at y = 4.50 m)
    const parapet = setShadows(
      new THREE.Mesh(new THREE.BoxGeometry(W + 0.32, 0.32, D + 0.32), matTrimBrown)
    );
    parapet.position.set(0, 4.34, 0);
    storeGroup.add(parapet);

    const roofDeck = setShadows(
      new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.12, D - 0.2), matRoofMetal)
    );
    roofDeck.position.set(0, 4.44, 0);
    storeGroup.add(roofDeck);

    // Storefront Fascia Sign facing North (toward US-27A)
    const signTex = getStoreSignTexture();
    const signMat = new THREE.MeshStandardMaterial({
      color: signTex ? 0xffffff : 0x2d4732,
      map: signTex || null,
      roughness: 0.45,
      metalness: 0.15
    });
    const fasciaSign = setShadows(new THREE.Mesh(new THREE.BoxGeometry(9.6, 1.05, 0.12), signMat));
    fasciaSign.position.set(0, 3.62, -D * 0.5 - 0.06);
    storeGroup.add(fasciaSign);

    // Storefront Glass Entrance Doors & Display Windows (North wall z = -6.0 m & West wall x = -9.0 m)
    // Aluminum-framed double glass entrance door on North wall
    const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(2.10, 2.35, 0.12), MATS.alloyWheel());
    doorFrame.position.set(-1.2, 1.32, -D * 0.5 - 0.02);
    storeGroup.add(doorFrame);

    for (const dx of [-1.68, -0.72]) {
      const doorGlass = new THREE.Mesh(new THREE.BoxGeometry(0.86, 2.18, 0.14), MATS.autoGlass());
      doorGlass.position.set(dx, 1.32, -D * 0.5 - 0.02);
      storeGroup.add(doorGlass);
    }

    // North storefront display windows
    for (const wx of [-5.4, 3.2, 6.4]) {
      const winFrame = new THREE.Mesh(new THREE.BoxGeometry(2.50, 1.65, 0.10), MATS.alloyWheel());
      winFrame.position.set(wx, 1.75, -D * 0.5 - 0.02);
      storeGroup.add(winFrame);
      const winGlass = new THREE.Mesh(new THREE.BoxGeometry(2.34, 1.48, 0.12), MATS.autoGlass());
      winGlass.position.set(wx, 1.75, -D * 0.5 - 0.02);
      storeGroup.add(winGlass);
    }

    // West wall display windows (facing NE 140th Ct)
    for (const wz of [-2.6, 2.2]) {
      const wFrame = new THREE.Mesh(new THREE.BoxGeometry(0.10, 1.65, 2.40), MATS.alloyWheel());
      wFrame.position.set(-W * 0.5 - 0.02, 1.75, wz);
      storeGroup.add(wFrame);
      const wGlass = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.48, 2.24), MATS.autoGlass());
      wGlass.position.set(-W * 0.5 - 0.02, 1.75, wz);
      storeGroup.add(wGlass);
    }

    // Front Metal Awning / Canopy along North and West storefronts
    const northAwning = setShadows(
      new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.14, 1.65), matRoofMetal)
    );
    northAwning.position.set(0, 2.86, -D * 0.5 - 0.78);
    northAwning.rotation.x = 0.16;
    storeGroup.add(northAwning);

    // Outdoor Ice Merchandiser Chest & Stacked Feed Bags on front sidewalk (referenced in Witness B depo 08:42!)
    const iceChest = setShadows(
      new THREE.Mesh(new THREE.BoxGeometry(1.85, 1.35, 0.92), MATS.trailerWhitePlain())
    );
    iceChest.position.set(-7.4, 0.81, -D * 0.5 - 0.52);
    storeGroup.add(iceChest);

    const iceChestDoors = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.92, 0.06), MATS.steelGalvanized());
    iceChestDoors.position.set(-7.4, 0.86, -D * 0.5 - 0.98);
    storeGroup.add(iceChestDoors);

    // Concrete parking wheel stops in front lot
    for (const px of [-5.5, -1.8, 1.9, 5.6]) {
      const wheelStop = setShadows(
        new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.13, 0.22), MATS.concreteGrey())
      );
      wheelStop.position.set(px, 0.065, -D * 0.5 - 2.35);
      storeGroup.add(wheelStop);
    }

    registerObject(
      'bld_store',
      storeGroup,
      'building',
      'Retail store (convenience store, feed and supplies) on SE corner of US-27A and NE 140th Court',
      'facts.txt F12, Modeling assumptions; deposition.txt 81-83, 265-267; evidence/map.png; world_v2.js line 29',
      true
    );
  }

  // 12.2 Open-Sided Covered Bench Shelter in Front of Store (occ_shelter)
  // Position [8, 0, 7.9], heading 90 deg, dimensions: length 3.0 m, width 1.8 m, height 2.4 m.
  // CRITICAL: Roof is supported on four thin 0.10 m square steel posts with open sides, bottom roof clearance 2.10 m,
  // and occludes: false so it never blocks Witness B's 1.60 m standing eye line at [7.5, 0, 6.5].
  {
    const shelterGroup = new THREE.Group();
    shelterGroup.position.set(8.0, 0, 7.9);
    shelterGroup.rotation.y = -90 * D2R; // Local -Z is +X (east), so length 3.0 m runs along X (x = 6.5 .. 9.5 m)

    const matPostDark = new THREE.MeshStandardMaterial({
      color: 0x3a3d40,
      roughness: 0.5,
      metalness: 0.7
    });
    const matRoofCorrugated = new THREE.MeshStandardMaterial({
      color: 0x8a8d91,
      roughness: 0.45,
      metalness: 0.65
    });
    const matWoodBench = new THREE.MeshStandardMaterial({
      color: 0x6e5239,
      roughness: 0.78,
      metalness: 0.05
    });

    // Concrete pad (1.8 m wide along local X -> world Z, 3.0 m long along local Z -> world X)
    const pad = setShadows(
      new THREE.Mesh(new THREE.BoxGeometry(1.80, 0.06, 3.00), MATS.concreteGrey()),
      false,
      true
    );
    pad.position.set(0, 0.03, 0);
    shelterGroup.add(pad);

    // Four thin 0.09 m square steel corner posts (height 2.12 m)
    for (const [px, pz] of [
      [-0.78, -1.36],
      [0.78, -1.36],
      [-0.78, 1.36],
      [0.78, 1.36]
    ]) {
      const post = setShadows(new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.12, 0.09), matPostDark));
      post.position.set(px, 1.09, pz);
      shelterGroup.add(post);
    }

    // Upper perimeter roof header frame (at y = 2.15 m, well above 1.60 m eye height)
    const headerFrame = setShadows(
      new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.08, 2.92), matPostDark)
    );
    headerFrame.position.set(0, 2.16, 0);
    shelterGroup.add(headerFrame);

    // Pitched gable roof panels (eave at 2.16 m, ridge at 2.40 m)
    for (const side of [-1, 1]) {
      const roofPanel = setShadows(
        new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.04, 3.12), matRoofCorrugated)
      );
      roofPanel.position.set(side * 0.48, 2.28, 0);
      roofPanel.rotation.z = -side * 0.24;
      shelterGroup.add(roofPanel);
    }

    // Wooden slat bench inside shelter (seat at y = 0.46 m, backrest at y = 0.78 m)
    const benchGroup = new THREE.Group();
    for (const bz of [-0.95, 0, 0.95]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.42, 0.06), matPostDark);
      leg.position.set(0.22, 0.24, bz);
      benchGroup.add(leg);
    }
    for (const sx of [0.05, 0.17, 0.29, 0.41]) {
      const slat = setShadows(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.035, 2.30), matWoodBench));
      slat.position.set(sx, 0.46, 0);
      benchGroup.add(slat);
    }
    for (const by of [0.64, 0.78, 0.90]) {
      const backSlat = setShadows(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.10, 2.30), matWoodBench));
      backSlat.position.set(0.45, by, 0);
      backSlat.rotation.z = -0.15;
      benchGroup.add(backSlat);
    }
    shelterGroup.add(benchGroup);

    registerObject(
      'occ_shelter',
      shelterGroup,
      'occluder',
      'Open-sided covered bench shelter in front of the retail store (fictional, does not block)',
      'facts.txt Modeling assumptions; deposition.txt 95-96, 107, 274; evidence/map.png; world_v2.js line 30',
      false
    );
  }

  // 12.3 Rural Single-Family Residences Set Back on South Side of US-27A (bld_residential_houses_south)
  // Position [275, 0, 38], footprint 20 m x 14 m, height 4.2 m (occludes: false per spec)
  {
    const housesGroup = new THREE.Group();
    housesGroup.position.set(275, 0, 38);

    const matHouseSiding = new THREE.MeshStandardMaterial({
      color: 0xd8d2c5,
      roughness: 0.80,
      metalness: 0.02
    });
    const matShingleRoof = new THREE.MeshStandardMaterial({
      color: 0x4a4845,
      roughness: 0.88,
      metalness: 0.0
    });

    const buildRanchHouse = (ox, oz, w, d, h) => {
      const hg = new THREE.Group();
      hg.position.set(ox, 0, oz);

      const walls = setShadows(new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.68, d), matHouseSiding));
      walls.position.set(0, h * 0.34, 0);
      hg.add(walls);

      // Gable roof prism
      const roofShape = new THREE.Shape();
      roofShape.moveTo(-d * 0.54, h * 0.68);
      roofShape.lineTo(0, h);
      roofShape.lineTo(d * 0.54, h * 0.68);
      roofShape.closePath();
      const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: w + 0.6, bevelEnabled: false });
      roofGeo.rotateY(PI / 2);
      roofGeo.translate(-(w + 0.6) * 0.5, 0, 0);
      const roof = setShadows(new THREE.Mesh(roofGeo, matShingleRoof));
      hg.add(roof);

      // Front porch & windows
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.1, 0.08), MATS.woodCreosote());
      door.position.set(-1.5, 1.05, -d * 0.5 - 0.02);
      hg.add(door);

      for (const wx of [-5.5, 2.2, 6.0]) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 0.08), MATS.autoGlass());
        win.position.set(wx, 1.55, -d * 0.5 - 0.02);
        hg.add(win);
      }
      return hg;
    };

    // Main residence at final rest yard [275, 0, 38] + neighboring rural house at x = 195 m
    housesGroup.add(buildRanchHouse(0, 0, 20, 14, 4.2));
    housesGroup.add(buildRanchHouse(-80, 2, 18, 13, 4.0));

    registerObject(
      'bld_residential_houses_south',
      housesGroup,
      'building',
      'Rural single-family residences set back on south side of US-27A east of the store',
      'facts.txt F25; police_report.txt p.2, p.3; deposition.txt 207, 210 (past a couple of houses... in somebody\'s yard); inferred footprint set far back from highway',
      false
    );
  }

  // --------------------------------------------------------------------------
  // 13. UTILITY POLES, CATENARY WIRES & WIRE FENCES
  // --------------------------------------------------------------------------

  function buildUtilityPoleAssembly(height = 10.0) {
    const g = new THREE.Group();
    // Tapered creosote-treated southern yellow pine pole
    const poleMesh = setShadows(
      new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.175, height, 14), MATS.woodCreosote())
    );
    poleMesh.position.y = height * 0.5;
    g.add(poleMesh);

    // Wooden crossarm at y = 9.2 m
    const crossarm = setShadows(
      new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 2.40), MATS.woodFencePost())
    );
    crossarm.position.set(0, height - 0.8, 0);
    g.add(crossarm);

    // Diagonal steel crossarm braces
    for (const side of [-1, 1]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.65, 0.04), MATS.steelGalvanized());
      brace.position.set(0.08, height - 1.05, side * 0.32);
      brace.rotation.x = side * 0.72;
      g.add(brace);
    }

    // 3 Ceramic insulators on crossarm
    const insGeo = getGeo('pole_insulator', () => new THREE.CylinderGeometry(0.055, 0.07, 0.18, 10));
    for (const iz of [-1.02, 0, 1.02]) {
      const ins = new THREE.Mesh(insGeo, MATS.conspicuityWhite());
      ins.position.set(0, height - 0.64, iz);
      g.add(ins);
    }

    return g;
  }

  // 13.1 Wooden Utility Pole Struck and Broken by Vehicle A (occ_pole)
  // Position [239.3, 0, 18.5], height 10.0 m, occludes: true
  {
    const poleNode = buildUtilityPoleAssembly(10.0);
    poleNode.position.set(239.3, 0, 18.5);
    registerObject(
      'occ_pole',
      poleNode,
      'occluder',
      'Wooden utility pole struck and broken by Vehicle A (~8.4 s after initial impact)',
      'facts.txt F24, F26, Modeling assumptions; police_report.txt p.2, p.3; deposition.txt 206-207; world_v2.js line 31',
      true
    );
  }

  // 13.2 Series of Wooden Utility Poles & Overhead Catenary Wires Along South Right-of-Way (occ_utility_poles_south_line)
  // Polyline stations along z = 18.5 m: [-135.7, -60.7, 14.3, 89.3, 164.3, 239.3 (occ_pole), 314.3], occludes: false
  {
    const lineGroup = new THREE.Group();
    lineGroup.position.set(164.3, 0, 18.5);

    const poleStationsX = [-135.7, -60.7, 14.3, 89.3, 164.3, 239.3, 314.3];
    for (const px of poleStationsX) {
      // Skip duplicating the pole body at 239.3 since occ_pole is already placed there
      if (Math.abs(px - 239.3) > 0.5) {
        const p = buildUtilityPoleAssembly(10.0);
        p.position.set(px - 164.3, 0, 0);
        lineGroup.add(p);
      }
    }

    // Overhead aluminum distribution wires with realistic catenary sag between crossarm insulators
    const wireMat = new THREE.MeshStandardMaterial({
      color: 0x505458,
      roughness: 0.5,
      metalness: 0.8
    });
    for (let s = 0; s < poleStationsX.length - 1; s++) {
      const x0 = poleStationsX[s] - 164.3;
      const x1 = poleStationsX[s + 1] - 164.3;
      for (const iz of [-1.02, 0, 1.02]) {
        const pts = [];
        const steps = 10;
        for (let k = 0; k <= steps; k++) {
          const u = k / steps;
          const x = lerp(x0, x1, u);
          const sag = 4 * u * (1 - u) * 1.15;
          pts.push(new THREE.Vector3(x, 9.38 - sag, iz));
        }
        const curve = new THREE.CatmullRomCurve3(pts);
        const tubeGeo = new THREE.TubeGeometry(curve, 12, 0.016, 5, false);
        const wireMesh = new THREE.Mesh(tubeGeo, wireMat);
        lineGroup.add(wireMesh);
      }
    }

    registerObject(
      'occ_utility_poles_south_line',
      lineGroup,
      'occluder',
      'Series of wooden utility poles along south right-of-way of US-27A (spaced ~75 m apart)',
      'inferred: facts.txt F24 (struck utility pole); typical rural utility line spacing aligned with occ_pole at z = 18.5 m',
      false
    );
  }

  // Helper to build a rural 4-strand wire fence with pressure-treated wooden posts
  function buildWireFenceSegment(x0, z0, x1, z1, height = 1.2, postSpacing = 3.66) {
    const cx = 0.5 * (x0 + x1);
    const cz = 0.5 * (z0 + z1);
    const dx = x1 - x0;
    const dz = z1 - z0;
    const totalLen = Math.hypot(dx, dz);
    const headingRad = Math.atan2(dx, -dz);

    const group = new THREE.Group();
    group.position.set(cx, 0, cz);
    group.rotation.y = -headingRad; // Local Z runs from -totalLen/2 to +totalLen/2

    const numPosts = Math.max(2, Math.floor(totalLen / postSpacing) + 1);
    const postGeo = getGeo(`fence_post_${height}`, () => new THREE.CylinderGeometry(0.055, 0.06, height, 8));
    const postInst = new THREE.InstancedMesh(postGeo, MATS.woodFencePost(), numPosts);
    postInst.castShadow = true;
    postInst.receiveShadow = true;

    const dummy = new THREE.Object3D();
    for (let i = 0; i < numPosts; i++) {
      const u = i / (numPosts - 1);
      const lz = (u - 0.5) * totalLen;
      dummy.position.set(0, height * 0.5, lz);
      dummy.updateMatrix();
      postInst.setMatrixAt(i, dummy.matrix);
    }
    postInst.instanceMatrix.needsUpdate = true;
    group.add(postInst);

    // 4 horizontal galvanized wire strands
    const wireGeo = new THREE.BoxGeometry(0.012, 0.012, totalLen);
    for (const wy of [0.28, 0.56, 0.84, 1.12]) {
      const strand = new THREE.Mesh(wireGeo, MATS.steelGalvanized());
      strand.position.set(0, wy, 0);
      group.add(strand);
    }

    return group;
  }

  // 13.3 Rural Wire Pasture/Property Fence #1 on South Side of US-27A (occ_fence_wire_south_1)
  // Polyline [85, 14.5] to [225, 14.5], struck by Vehicle A post-impact
  registerObject(
    'occ_fence_wire_south_1',
    buildWireFenceSegment(85, 14.5, 225, 14.5, 1.2, 3.66),
    'occluder',
    'Rural wire pasture/property fence #1 on south side of US-27A (struck by Vehicle A post-impact)',
    'facts.txt F24; police_report.txt p.2; deposition.txt 206 (went through two wire fences); inferred placement along Vehicle A post-impact path',
    false
  );

  // 13.4 Cross-Property Wire Fence #2 Near Residential Yard (occ_fence_wire_south_2)
  // Polyline [225, 13] to [225, 31], struck by Vehicle A post-impact
  registerObject(
    'occ_fence_wire_south_2',
    buildWireFenceSegment(225, 13, 225, 31, 1.2, 3.0),
    'occluder',
    'Cross-property wire fence #2 near residential yard on south side of US-27A (struck by Vehicle A post-impact)',
    'facts.txt F24; police_report.txt p.2 (went through two wire fences); inferred placement along Vehicle A post-impact path',
    false
  );

  // Additional background property fence along North right-of-way (z = -53.37 m)
  sceneryGroup.add(buildWireFenceSegment(-400, -53.37, 340, -53.37, 1.2, 5.0));

  // --------------------------------------------------------------------------
  // 14. VEGETATION SYSTEM (INSTANCED ALPHA-CLIPPED LEAF CARDS, LIVE OAKS, PINES)
  // --------------------------------------------------------------------------
  // Placed well outside the highway clear zone (z <= -62 m and z >= +46 m) per facts.txt F27
  // so zero vegetation obstructs any pre-impact sightline on the approach or median.
  {
    const treelineGroup = new THREE.Group();
    treelineGroup.position.set(-50, 0, -65);

    const barkTex = getBarkTexture();
    const matBark = new THREE.MeshStandardMaterial({
      color: barkTex ? 0xffffff : 0x4d3b2c,
      map: barkTex || null,
      roughness: 0.90,
      metalness: 0.0
    });

    const oakLeafTex = getLeafCardTexture('oak');
    const matOakFoliage = new THREE.MeshStandardMaterial({
      color: oakLeafTex ? 0xffffff : 0x3b5323,
      map: oakLeafTex || null,
      alphaTest: oakLeafTex ? 0.42 : 0,
      side: THREE.DoubleSide,
      roughness: 0.88,
      metalness: 0.0
    });

    const pineLeafTex = getLeafCardTexture('pine');
    const matPineFoliage = new THREE.MeshStandardMaterial({
      color: pineLeafTex ? 0xffffff : 0x324a20,
      map: pineLeafTex || null,
      alphaTest: pineLeafTex ? 0.42 : 0,
      side: THREE.DoubleSide,
      roughness: 0.88,
      metalness: 0.0
    });

    // Generate deterministic tree placements along North treeline (z = -62 .. -95 m) and South treeline (z = +52 .. +88 m)
    const rng = makePRNG(5050);
    const treePlacements = [];

    // North treeline (world x = -430 .. +330, world z = -62 .. -92)
    for (let x = -430; x <= 330; x += 11) {
      const wx = x + (rng() - 0.5) * 6;
      const wz = -63 - rng() * 26;
      const h = 10 + rng() * 7;
      const isPine = rng() < 0.48;
      treePlacements.push({ x: wx, z: wz, h, isPine });
    }
    // South treeline (world x = -430 .. +330, world z = +54 .. +88)
    for (let x = -430; x <= 330; x += 12) {
      const wx = x + (rng() - 0.5) * 6;
      const wz = 54 + rng() * 28;
      const h = 10 + rng() * 7;
      const isPine = rng() < 0.45;
      treePlacements.push({ x: wx, z: wz, h, isPine });
    }

    // Build InstancedMesh for trunks, main branches, and crossed foliage alpha-cards
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.28, 1.0, 8);
    trunkGeo.translate(0, 0.5, 0);
    const trunkInst = new THREE.InstancedMesh(trunkGeo, matBark, treePlacements.length * 3);
    trunkInst.castShadow = true;
    trunkInst.receiveShadow = true;

    // Crossed 3-plane star cluster for foliage cards
    const cardGeo = new THREE.PlaneGeometry(3.8, 3.4);
    const oakCardsCount = treePlacements.length * 10;
    const pineCardsCount = treePlacements.length * 8;
    const oakCardInst = new THREE.InstancedMesh(cardGeo, matOakFoliage, oakCardsCount);
    const pineCardInst = new THREE.InstancedMesh(cardGeo, matPineFoliage, pineCardsCount);
    oakCardInst.castShadow = true;
    oakCardInst.receiveShadow = true;
    pineCardInst.castShadow = true;
    pineCardInst.receiveShadow = true;

    const dummy = new THREE.Object3D();
    let tIdx = 0;
    let oIdx = 0;
    let pIdx = 0;

    for (const tr of treePlacements) {
      const lx = tr.x - -50;
      const lz = tr.z - -65;

      // Main trunk
      const trunkH = tr.isPine ? tr.h * 0.78 : tr.h * 0.48;
      dummy.position.set(lx, 0, lz);
      dummy.rotation.set((rng() - 0.5) * 0.06, rng() * TWO_PI, (rng() - 0.5) * 0.06);
      dummy.scale.set(1.0 + rng() * 0.35, trunkH, 1.0 + rng() * 0.35);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(tIdx++, dummy.matrix);

      // Two primary limbs
      for (let b = 0; b < 2; b++) {
        const bAng = b * PI + rng() * 1.2;
        dummy.position.set(lx, trunkH * 0.72, lz);
        dummy.rotation.set(0.45 + rng() * 0.3, bAng, 0);
        dummy.scale.set(0.55, tr.h * 0.28, 0.55);
        dummy.updateMatrix();
        trunkInst.setMatrixAt(tIdx++, dummy.matrix);
      }

      // Canopy leaf cards
      if (tr.isPine) {
        for (let c = 0; c < 8; c++) {
          const frac = c / 8;
          const cy = tr.h * (0.48 + frac * 0.48);
          const rad = (1 - frac * 0.65) * 2.2;
          const ang = c * 2.4 + rng();
          dummy.position.set(lx + Math.cos(ang) * rad * 0.5, cy, lz + Math.sin(ang) * rad * 0.5);
          dummy.rotation.set((rng() - 0.5) * 0.5, ang, (rng() - 0.5) * 0.5);
          const sc = 0.85 + rng() * 0.45;
          dummy.scale.set(sc, sc * 0.85, sc);
          dummy.updateMatrix();
          pineCardInst.setMatrixAt(pIdx++, dummy.matrix);
        }
      } else {
        for (let c = 0; c < 10; c++) {
          const ang = (c / 10) * TWO_PI + rng() * 0.5;
          const rad = (0.3 + rng() * 0.7) * (tr.h * 0.26);
          const cy = tr.h * 0.45 + rng() * (tr.h * 0.45);
          dummy.position.set(lx + Math.cos(ang) * rad, cy, lz + Math.sin(ang) * rad);
          dummy.rotation.set((rng() - 0.5) * 0.8, rng() * TWO_PI, (rng() - 0.5) * 0.8);
          const sc = 1.0 + rng() * 0.55;
          dummy.scale.set(sc, sc, sc);
          dummy.updateMatrix();
          oakCardInst.setMatrixAt(oIdx++, dummy.matrix);
        }
      }
    }

    trunkInst.count = tIdx;
    oakCardInst.count = oIdx;
    pineCardInst.count = pIdx;
    trunkInst.instanceMatrix.needsUpdate = true;
    oakCardInst.instanceMatrix.needsUpdate = true;
    pineCardInst.instanceMatrix.needsUpdate = true;

    treelineGroup.add(trunkInst);
    treelineGroup.add(oakCardInst);
    treelineGroup.add(pineCardInst);

    registerObject(
      'occ_veg_distant_treeline',
      treelineGroup,
      'occluder',
      'Distant rural Florida pine and live oak treeline well outside the highway clear zone',
      'facts.txt F27 (No vegetation or other obstructions were reported on the approach); inferred distant background treeline outside sight corridors',
      false
    );
  }

  // --------------------------------------------------------------------------
  // 15. FORENSIC SCENE MARKERS & POST-IMPACT TRAJECTORY (mark_impact, mark_rest_A, mark_path_A)
  // --------------------------------------------------------------------------

  function buildForensicMarkerNode(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0.03, z);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.32, 0.50, 24),
      MATS.forensicRedMarker()
    );
    ring.rotation.x = -PI / 2;
    g.add(ring);

    const centerDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.14, 16),
      MATS.forensicRedMarker()
    );
    centerDisc.rotation.x = -PI / 2;
    centerDisc.position.y = 0.002;
    g.add(centerDisc);

    // Crosshairs
    for (const ang of [0, PI / 2]) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.05), MATS.forensicRedMarker());
      bar.rotation.x = -PI / 2;
      bar.rotation.z = ang;
      bar.position.y = 0.001;
      g.add(bar);
    }

    return g;
  }

  // 15.1 Initial Point of Impact (POI) Marker (mark_impact)
  registerObject(
    'mark_impact',
    buildForensicMarkerNode(0, 0),
    'mark',
    'Initial point of impact (POI) marker in center of EB outside lane on NE 140th Ct centerline',
    'facts.txt F21; police_report.txt p.3; evidence/map.png; world_v2.js line 34',
    false
  );

  // 15.2 Final Rest Position Marker of Vehicle A (mark_rest_A)
  registerObject(
    'mark_rest_A',
    buildForensicMarkerNode(276.6, 23.9),
    'mark',
    'Final rest position marker of Vehicle A (~910 ft / 276.6 m east of POI in residential front yard)',
    'facts.txt F25; police_report.txt p.2, p.3; world_v2.js line 35',
    false
  );

  // --------------------------------------------------------------------------
  // 16. KEYFRAME ARRAYS (VERBATIM FROM WORLD_V2.JS) & POST-IMPACT PATH RIBBON
  // --------------------------------------------------------------------------
  const KA = [
    [0, -350.02, 0, 90],
    [0.25, -341.69, 0, 90],
    [0.5, -333.36, 0, 90],
    [0.75, -325.03, 0, 90],
    [1, -316.7, 0, 90],
    [1.25, -308.37, 0, 90],
    [1.5, -300.04, 0, 90],
    [1.75, -291.71, 0, 90],
    [2, -283.38, 0, 90],
    [2.25, -275.05, 0, 90],
    [2.5, -266.72, 0, 90],
    [2.75, -258.39, 0, 90],
    [3, -250.06, 0, 90],
    [3.25, -241.73, 0, 90],
    [3.5, -233.4, 0, 90],
    [3.75, -225.07, 0, 90],
    [4, -216.74, 0, 90],
    [4.25, -208.41, 0, 90],
    [4.5, -200.08, 0, 90],
    [4.75, -191.74, 0, 90],
    [5, -183.41, 0, 90],
    [5.25, -175.08, 0, 90],
    [5.5, -166.75, 0, 90],
    [5.75, -158.42, 0, 90],
    [6, -150.09, 0, 90],
    [6.25, -141.76, 0, 90],
    [6.5, -133.43, 0, 90],
    [6.75, -125.1, 0, 90],
    [7, -116.77, 0, 90],
    [7.25, -108.44, 0, 90],
    [7.5, -100.11, 0, 90],
    [7.75, -91.78, 0, 90],
    [8, -83.45, 0, 90],
    [8.25, -75.12, 0, 90],
    [8.5, -66.79, 0, 90],
    [8.75, -58.46, 0, 90],
    [9, -50.13, 0, 90],
    [9.25, -41.8, 0, 90],
    [9.5, -33.47, 0, 90],
    [9.75, -25.14, 0, 90],
    [10, -16.81, 0, 90],
    [10.25, -8.48, 0, 90],
    [10.43, -2.49, -0.01, 90.144],
    [10.5, -0.17, -0.01, 90.2],
    [10.75, 8.03, 0.47, 91],
    [11, 16.15, 1.08, 91.7],
    [11.25, 24.21, 1.68, 92.5],
    [11.5, 32.21, 2.28, 93.2],
    [11.75, 40.13, 2.87, 94],
    [12, 47.99, 3.46, 94.5],
    [12.25, 55.78, 4.08, 94.5],
    [12.5, 63.51, 4.68, 94.5],
    [12.75, 71.17, 5.29, 94.5],
    [13, 78.76, 5.88, 94.5],
    [13.25, 86.28, 6.48, 94.5],
    [13.5, 93.74, 7.06, 94.5],
    [13.75, 101.13, 7.64, 94.5],
    [14, 108.45, 8.22, 94.5],
    [14.25, 115.7, 8.79, 94.5],
    [14.5, 122.89, 9.36, 94.5],
    [14.75, 130.02, 9.92, 94.5],
    [15, 137.07, 10.47, 94.5],
    [15.25, 144.06, 11.02, 94.5],
    [15.5, 150.98, 11.57, 94.5],
    [15.75, 157.84, 12.11, 94.5],
    [16, 164.62, 12.64, 94.5],
    [16.25, 171.34, 13.17, 94.5],
    [16.5, 178, 13.69, 94.5],
    [16.75, 184.59, 14.21, 94.5],
    [17, 191.11, 14.73, 94.5],
    [17.25, 197.56, 15.23, 94.5],
    [17.5, 203.94, 15.74, 94.5],
    [17.75, 210.26, 16.23, 94.5],
    [18, 216.52, 16.73, 94.5],
    [18.25, 222.7, 17.21, 94.5],
    [18.5, 228.82, 17.69, 94.5],
    [18.75, 234.87, 18.17, 94.5],
    [19, 240.75, 18.86, 89.3],
    [19.25, 246.21, 19.61, 81.7],
    [19.5, 251.22, 20.32, 74.1],
    [19.75, 255.8, 20.99, 66.5],
    [20, 259.93, 21.59, 58.9],
    [20.25, 263.62, 22.14, 51.3],
    [20.5, 266.85, 22.62, 43.7],
    [20.75, 269.64, 23.03, 36.1],
    [21, 271.97, 23.37, 28.5],
    [21.25, 273.84, 23.63, 20.9],
    [21.5, 275.24, 23.81, 13.3],
    [21.75, 276.17, 23.91, 5.7],
    [22, 276.56, 23.94, 0],
    [22.25, 276.56, 23.94, 0]
  ];

  const KT = [
    [0, 14.79, -27.42, -90.1],
    [0.25, 14.03, -27.4, -90.6],
    [0.5, 13.26, -27.34, -91.5],
    [0.75, 12.47, -27.26, -92.9],
    [1, 11.67, -27.15, -94.8],
    [1.25, 10.86, -27.01, -97.3],
    [1.5, 10.04, -26.84, -100.3],
    [1.75, 9.22, -26.64, -104],
    [2, 8.39, -26.4, -108.2],
    [2.25, 7.57, -26.1, -112.5],
    [2.5, 6.76, -25.72, -117],
    [2.75, 5.97, -25.28, -121.5],
    [3, 5.19, -24.76, -126.1],
    [3.25, 4.45, -24.17, -130.8],
    [3.5, 3.75, -23.51, -135.6],
    [3.75, 3.09, -22.78, -140.5],
    [4, 2.49, -21.98, -145.4],
    [4.25, 1.95, -21.12, -150.5],
    [4.5, 1.48, -20.19, -155.6],
    [4.75, 1.09, -19.21, -160.9],
    [5, 0.78, -18.18, -166.2],
    [5.25, 0.52, -17.11, -170.8],
    [5.5, 0.31, -16, -174.5],
    [5.75, 0.15, -14.85, -177.3],
    [6, 0.05, -13.67, -179.1],
    [6.25, 0, -12.46, -180],
    [6.5, 0, -11.23, 180],
    [6.75, 0, -9.98, 180],
    [7, 0, -8.72, 180],
    [7.25, 0, -7.43, 180],
    [7.5, 0, -6.13, 180],
    [7.75, 0, -4.81, 180],
    [8, 0, -3.47, 180],
    [8.25, 0, -2.11, 180],
    [8.5, 0, -0.73, 180],
    [8.75, 0, 0.67, 180],
    [9, 0, 2.08, 180],
    [9.25, 0, 3.52, 180],
    [9.5, 0, 4.97, 180],
    [9.75, 0, 6.44, 180],
    [10, 0, 7.93, 180],
    [10.25, 0, 9.44, 180],
    [10.5, 0, 10.97, 180],
    [10.75, 0, 12.47, 180],
    [11, 0, 13.94, 180],
    [11.25, 0, 15.38, 180],
    [11.5, 0, 16.78, 180],
    [11.75, 0, 18.15, 180],
    [12, 0, 19.48, 180],
    [12.25, 0, 20.78, 180],
    [12.5, 0, 22.05, 180],
    [12.75, 0, 23.28, 180],
    [13, 0, 24.48, 180],
    [13.25, 0, 25.64, 180],
    [13.5, 0, 26.76, 180],
    [13.75, 0, 27.86, 180],
    [14, 0, 28.92, 180],
    [14.25, 0, 29.94, 180],
    [14.5, 0, 30.93, 180],
    [14.75, 0, 31.89, 180],
    [15, 0, 32.81, 180],
    [15.25, 0, 33.69, 180],
    [15.5, 0, 34.55, 180],
    [15.75, 0, 35.36, 180],
    [16, 0, 36.15, 180],
    [16.25, 0, 36.9, 180],
    [16.5, 0, 37.61, 180],
    [16.75, 0, 38.29, 180],
    [17, 0, 38.94, 180],
    [17.25, 0, 39.55, 180],
    [17.5, 0, 40.13, 180],
    [17.75, 0, 40.67, 180],
    [18, 0, 41.18, 180],
    [18.25, 0, 41.65, 180],
    [18.5, 0, 42.09, 180],
    [18.75, 0, 42.5, 180],
    [19, 0, 42.87, 180],
    [19.25, 0, 43.2, 180],
    [19.5, 0, 43.51, 180],
    [19.75, 0, 43.78, 180],
    [20, 0, 44.01, 180],
    [20.25, 0, 44.21, 180],
    [20.5, 0, 44.37, 180],
    [20.75, 0, 44.5, 180],
    [21, 0, 44.6, 180],
    [21.25, 0, 44.66, 180],
    [21.5, 0, 44.69, 180],
    [21.75, 0, 44.69, 180],
    [22, 0, 44.69, 180],
    [22.25, 0, 44.69, 180]
  ];

  const KR = [
    [0, 25.23, -27.43, -90],
    [0.25, 24.47, -27.43, -90],
    [0.5, 23.7, -27.43, -90],
    [0.75, 22.9, -27.43, -90],
    [1, 22.08, -27.43, -90],
    [1.25, 21.25, -27.43, -90],
    [1.5, 20.4, -27.43, -90],
    [1.75, 19.52, -27.42, -90],
    [2, 18.63, -27.39, -90.3],
    [2.25, 17.73, -27.32, -90.8],
    [2.5, 16.82, -27.21, -91.6],
    [2.75, 15.89, -27.06, -92.6],
    [3, 14.96, -26.88, -94],
    [3.25, 14.03, -26.65, -95.6],
    [3.5, 13.11, -26.39, -97.5],
    [3.75, 12.19, -26.08, -99.8],
    [4, 11.28, -25.74, -102.5],
    [4.25, 10.38, -25.35, -105.6],
    [4.5, 9.51, -24.93, -109],
    [4.75, 8.66, -24.47, -112.9],
    [5, 7.85, -23.98, -117.2],
    [5.25, 7.06, -23.45, -122],
    [5.5, 6.32, -22.9, -127.3],
    [5.75, 5.62, -22.31, -132.9],
    [6, 4.97, -21.64, -138.5],
    [6.25, 4.37, -20.9, -144.3],
    [6.5, 3.79, -20.09, -149.7],
    [6.75, 3.22, -19.21, -154.8],
    [7, 2.68, -18.26, -159.5],
    [7.25, 2.16, -17.23, -163.8],
    [7.5, 1.69, -16.13, -167.5],
    [7.75, 1.25, -14.97, -170.9],
    [8, 0.87, -13.75, -173.7],
    [8.25, 0.55, -12.47, -176],
    [8.5, 0.3, -11.14, -177.9],
    [8.75, 0.12, -9.77, -179.1],
    [9, 0.02, -8.36, -179.8],
    [9.25, 0, -6.93, 180],
    [9.5, 0, -5.48, 180],
    [9.75, 0, -4, 180],
    [10, 0, -2.51, 180],
    [10.25, 0, -1, 180],
    [10.5, 0, 0.52, 180],
    [10.75, 0, 2.03, 180],
    [11, 0, 3.5, 180],
    [11.25, 0, 4.94, 180],
    [11.5, 0, 6.34, 180],
    [11.75, 0, 7.71, 180],
    [12, 0, 9.04, 180],
    [12.25, 0, 10.34, 180],
    [12.5, 0, 11.6, 180],
    [12.75, 0, 12.83, 180],
    [13, 0, 14.03, 180],
    [13.25, 0, 15.19, 180],
    [13.5, 0, 16.32, 180],
    [13.75, 0, 17.41, 180],
    [14, 0, 18.47, 180],
    [14.25, 0, 19.49, 180],
    [14.5, 0, 20.48, 180],
    [14.75, 0, 21.44, 180],
    [15, 0, 22.36, 180],
    [15.25, 0, 23.25, 180],
    [15.5, 0, 24.1, 180],
    [15.75, 0, 24.92, 180],
    [16, 0, 25.7, 180],
    [16.25, 0, 26.45, 180],
    [16.5, 0, 27.17, 180],
    [16.75, 0, 27.85, 180],
    [17, 0, 28.49, 180],
    [17.25, 0, 29.1, 180],
    [17.5, 0, 29.68, 180],
    [17.75, 0, 30.22, 180],
    [18, 0, 30.73, 180],
    [18.25, 0, 31.21, 180],
    [18.5, 0, 31.65, 180],
    [18.75, 0, 32.05, 180],
    [19, 0, 32.42, 180],
    [19.25, 0, 32.76, 180],
    [19.5, 0, 33.06, 180],
    [19.75, 0, 33.33, 180],
    [20, 0, 33.56, 180],
    [20.25, 0, 33.76, 180],
    [20.5, 0, 33.93, 180],
    [20.75, 0, 34.06, 180],
    [21, 0, 34.15, 180],
    [21.25, 0, 34.22, 180],
    [21.5, 0, 34.24, 180],
    [21.75, 0, 34.24, 180],
    [22, 0, 34.24, 180],
    [22.25, 0, 34.24, 180]
  ];

  // 15.3 Post-Impact Trajectory / Furrow Path of Vehicle A (mark_path_A)
  // Strictly post-impact only (t > 10.43 s). Zero pre-impact tire marks exist (facts.txt F22).
  {
    const pathPts = KA.filter((k) => k[0] > 10.43).map((k) => [k[1], k[2]]);
    const pathGroup = new THREE.Group();
    pathGroup.position.set(138.3, 0.022, 12.0);

    // Build dual tire furrow/scuff ribbons along the post-impact pathPts
    const buildRibbonGeo = (pts, halfWidth, lateralOffset = 0) => {
      const positions = [];
      const uvs = [];
      const indices = [];
      let dist = 0;

      for (let i = 0; i < pts.length; i++) {
        const [px, pz] = pts[i];
        const prev = pts[Math.max(0, i - 1)];
        const next = pts[Math.min(pts.length - 1, i + 1)];
        let tx = next[0] - prev[0];
        let tz = next[1] - prev[1];
        const tLen = Math.hypot(tx, tz) || 1;
        tx /= tLen;
        tz /= tLen;
        const nx = -tz;
        const nz = tx;

        if (i > 0) {
          dist += Math.hypot(px - prev[0], pz - prev[1]);
        }

        const cx = px - 138.3 + nx * lateralOffset;
        const cz = pz - 12.0 + nz * lateralOffset;

        positions.push(cx - nx * halfWidth, 0, cz - nz * halfWidth);
        positions.push(cx + nx * halfWidth, 0, cz + nz * halfWidth);
        uvs.push(0, dist * 0.2, 1, dist * 0.2);

        if (i < pts.length - 1) {
          const b = i * 2;
          indices.push(b, b + 1, b + 3, b, b + 3, b + 2);
        }
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    };

    const centerRibbon = new THREE.Mesh(buildRibbonGeo(pathPts, 0.15, 0), MATS.furrowEarth());
    centerRibbon.receiveShadow = true;
    pathGroup.add(centerRibbon);

    for (const trackOff of [-0.78, 0.78]) {
      const wheelFurrow = new THREE.Mesh(buildRibbonGeo(pathPts, 0.11, trackOff), MATS.furrowEarth());
      wheelFurrow.receiveShadow = true;
      pathGroup.add(wheelFurrow);
    }

    registerObject(
      'mark_path_A',
      pathGroup,
      'mark',
      'Post-impact trajectory / furrow path of Vehicle A from POI to final rest (NO pre-impact tire marks exist)',
      'facts.txt F22, F23, F24, F25; police_report.txt p.2, p.3; world_v2.js lines 36-39',
      false
    );
  }

  // --------------------------------------------------------------------------
  // 17. INSTANTIATE & REGISTER VEHICLES (veh_A, veh_T_tractor, veh_T_trailer, veh_wit_A, veh_wit_C)
  // --------------------------------------------------------------------------
  const A = registerObject(
    'veh_A',
    buildSedanVehicleA(),
    'vehicle',
    'Passenger sedan (Vehicle A), eastbound',
    'inferred: NTSB/HAR-17/02 p.1 (910 ft post-impact), p.2 & p.15 (74 mph, no braking, headlights off), p.5 (no pre-impact marks); dims: typical full-size sedan, assumed',
    true
  ).node;

  const TT = registerObject(
    'veh_T_tractor',
    buildTractorVehicleT(),
    'vehicle',
    'Truck-tractor (Vehicle T)',
    'NTSB/HAR-17/02 p.1 (left turn from WB turn lane onto NE 140th Ct; stopped south of retail business), p.1-2 (witness could not tell if stopped or moving very slowly)',
    true
  ).node;

  const TR = registerObject(
    'veh_T_trailer',
    buildSemitrailerVehicleT(),
    'vehicle',
    'Refrigerated van semitrailer (Vehicle T)',
    'NTSB/HAR-17/02 p.6 (71 ft 7 in overall; impact 45 ft 5 in behind tractor front)',
    true
  ).node;

  // Non-involved observer vehicles (placed at their observation positions, occludes: false so they don't self-occlude witness eyes)
  const vehWitANode = buildWitnessASedan();
  vehWitANode.position.set(357.2, 0, -34.75);
  vehWitANode.rotation.y = -270 * D2R;
  registerObject(
    'veh_wit_A',
    vehWitANode,
    'vehicle',
    "Fictional Witness A's westbound passenger vehicle (non-involved observer vehicle)",
    'facts.txt F30; witness_A.txt; world_v2.js lines 72-84',
    false
  );

  const vehWitCNode = buildWitnessCPickup();
  vehWitCNode.position.set(-18.0, 0, -40.5);
  vehWitCNode.rotation.y = -270 * D2R;
  registerObject(
    'veh_wit_C',
    vehWitCNode,
    'vehicle',
    "Fictional Witness C's stopped pickup truck (non-involved observer vehicle)",
    'witness_C.txt; world_v2.js lines 99-111',
    false
  );

  // --------------------------------------------------------------------------
  // 18. KINEMATICS INTERPOLATION & setTime(t) (VERBATIM SEMANTICS FROM WORLD_V2.JS)
  // --------------------------------------------------------------------------
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
    node.position.set(s[1], 0, s[2]);
    node.rotation.set(0, -h, 0, 'YXZ');
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

  // --------------------------------------------------------------------------
  // 19. WITNESSES, FACTS & SKIDS (VERBATIM FROM WORLD_V2.JS)
  // --------------------------------------------------------------------------
  const witnesses = [
    {
      id: 'wit_A',
      name: 'Witness A (fictional)',
      position: [357.2, 0, -34.75],
      eyeHeight: 1.5,
      lookAt: 'veh_A',
      observationTime: 2,
      claim:
        'Saw the car come over the hill and approach before the truck began its turn; once the truck pulled across, the trailer blocked my view of the car.',
      citation: 'Witness A statement (fictional), modeled on NTSB/HAR-17/02 p.1-2, p.29-30 witness account'
    },
    {
      id: 'wit_B',
      name: 'Witness B (fictional)',
      position: [7.5, 0, 6.5],
      eyeHeight: 1.6,
      lookAt: 'veh_A',
      observationTime: 9.9,
      claim:
        'I had a clear view of the car the whole way in. I watched it right up until the moment it hit. Nothing was in the way.',
      citation:
        "Deposition of Witness B (fictional), claim at 27:46 (repeated shortly after); position marked on Exhibit 4 at 27:04 while saying only 'I was over by the corner, near the shelter'"
    },
    {
      id: 'wit_C',
      name: 'Witness C (fictional)',
      position: [-18, 0, -40.5],
      eyeHeight: 1.6,
      lookAt: 'veh_T_tractor',
      observationTime: 5,
      claim: 'The truck was barely creeping when it started across; I never heard brakes before the bang.',
      citation: 'Witness C statement (fictional); consistent with NTSB/HAR-17/02 p.1-2 and p.5'
    }
  ];

  const facts = [
    {
      id: 'f_impact_t',
      text: 'Impact at t=10.43 s on the event clock (car crests the hill at t=0)',
      value: 10.43,
      unit: 's',
      citation: 'inferred: NTSB/HAR-17/02 p.22, p.29 (derived from 74 mph over 345 m)',
      kind: 'time'
    },
    {
      id: 'f_speed',
      text: 'Car speed just before impact 74 mph (cruise set 4:34:21)',
      value: 74,
      unit: 'mph',
      citation: 'NTSB/HAR-17/02 p.2, p.15',
      kind: 'speed'
    },
    {
      id: 'f_limit',
      text: 'Posted limit 65 mph',
      value: 65,
      unit: 'mph',
      citation: 'NTSB/HAR-17/02 p.23',
      kind: 'speed'
    },
    {
      id: 'f_crest',
      text: 'Vertical crest 1,132 ft (345 m) west of intersection',
      value: 345,
      unit: 'm',
      citation: 'NTSB/HAR-17/02 p.22',
      kind: 'distance'
    },
    {
      id: 'f_sight',
      text: 'Up to 10.4 s mutual sight time at 74 mph',
      value: 10.4,
      unit: 's',
      citation: 'NTSB/HAR-17/02 p.29',
      kind: 'time'
    },
    {
      id: 'f_nomarks',
      text: 'No pre-collision tire marks from either vehicle; no braking',
      value: 0,
      unit: 'm',
      citation: 'NTSB/HAR-17/02 p.5, p.15',
      kind: 'skid'
    },
    {
      id: 'f_post',
      text: 'Car traveled ~910 ft after striking the trailer',
      value: 277.4,
      unit: 'm',
      citation: 'NTSB/HAR-17/02 p.1',
      kind: 'distance'
    },
    {
      id: 'f_imp_off',
      text: 'Impact centered 45 ft 5 in behind tractor front',
      value: 13.84,
      unit: 'm',
      citation: 'NTSB/HAR-17/02 p.6 fn.6',
      kind: 'position'
    },
    {
      id: 'f_time',
      text: 'Impact at 4:36:12.7 p.m. EDT, daylight, clear, dry',
      value: 16.6,
      unit: 'h',
      citation: 'NTSB/HAR-17/02 p.1, p.5, p.15',
      kind: 'time'
    }
  ];

  const skids = [];

  const world = {
    meta: {
      caseId: 'HWY16FH018',
      title:
        'Car into turning tractor-semitrailer at an uncontrolled median crossover, US-27A near Williston, Florida (2016)',
      timeOfDay: '16:36',
      lighting: 'day',
      source: 'NTSB/HAR-17/02 (HWY16FH018) physical facts + fictional witnesses',
      impactT: T_IMPACT,
      date: '2016-05-07',
      dateTime: '2016-05-07T16:36:12-04:00',
      weather: 'clear',
      timeZone: 'America/New_York',
      utcOffset: '-04:00',
      lat: 29.4106,
      lon: -82.5393,
      sun: { azimuthDeg: 265.0, elevationDeg: 45.1 }
    },
    root,
    duration,
    setTime,
    objects,
    witnesses,
    facts,
    skids
  };

  setTime(0);
  return world;
}
