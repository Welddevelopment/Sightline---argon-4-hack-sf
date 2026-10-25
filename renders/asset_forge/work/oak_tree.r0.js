let _sharedCache = null;

function hashSeed(input) {
  const str = String(input ?? 'oak_tree_default');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 123456789;
}

function makePRNG(seedValue) {
  let s = hashSeed(seedValue);
  return function rand() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noise2D(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const h = (a, b) => {
    let n = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) ^ 0x5bf03635;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  const n00 = h(xi, yi), n10 = h(xi + 1, yi), n01 = h(xi, yi + 1), n11 = h(xi + 1, yi + 1);
  return (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v;
}

function fbm2(x, y) {
  return (
    0.52 * noise2D(x, y) +
    0.26 * noise2D(x * 2.03 + 13.7, y * 2.03 + 7.1) +
    0.14 * noise2D(x * 4.07 + 31.2, y * 4.07 + 19.8) +
    0.08 * noise2D(x * 8.11 + 5.4, y * 8.11 + 43.9)
  );
}

function createBarkTextures(THREE) {
  const W = 256, H = 256;
  const colorData = new Uint8Array(W * H * 4);
  const normData = new Uint8Array(W * H * 4);
  const roughData = new Uint8Array(W * H * 4);
  const heights = new Float32Array(W * H);

  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      // Tileable periodic coordinates via sin/cos blend
      const ux = u * 24.0;
      const vy = v * 6.0;
      const warp = (fbm2(u * 8.0, v * 8.0) - 0.5) * 1.4;
      const ridgeWave = Math.sin((ux + warp) * Math.PI * 2.0);
      const ridge = Math.pow(0.5 + 0.5 * ridgeWave, 0.65);
      const crossCrack = Math.pow(fbm2(u * 12.0, v * 32.0), 2.5);
      const micro = fbm2(u * 48.0, v * 48.0);
      const hVal = Math.max(0, Math.min(1, ridge * 0.68 - crossCrack * 0.22 + micro * 0.22));
      heights[y * W + x] = hVal;

      const lichen = fbm2(u * 10.0 + 91.0, v * 10.0 + 37.0);
      const idx = (y * W + x) * 4;

      // Dark grey-brown furrowed oak bark
      let r = 46 + hVal * 44 + (micro - 0.5) * 14;
      let g = 42 + hVal * 40 + (micro - 0.5) * 12;
      let b = 38 + hVal * 35 + (micro - 0.5) * 10;

      // Subtle greenish-grey lichen in ridges
      if (lichen > 0.67 && hVal > 0.45) {
        const lf = (lichen - 0.67) * 2.2;
        r = r * (1 - lf) + 84 * lf;
        g = g * (1 - lf) + 96 * lf;
        b = b * (1 - lf) + 74 * lf;
      }

      colorData[idx] = Math.max(0, Math.min(255, r | 0));
      colorData[idx + 1] = Math.max(0, Math.min(255, g | 0));
      colorData[idx + 2] = Math.max(0, Math.min(255, b | 0));
      colorData[idx + 3] = 255;

      const rough = Math.max(190, Math.min(252, (245 - hVal * 35) | 0));
      roughData[idx] = rough;
      roughData[idx + 1] = rough;
      roughData[idx + 2] = rough;
      roughData[idx + 3] = 255;
    }
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const xL = (x - 1 + W) % W, xR = (x + 1) % W;
      const yD = (y - 1 + H) % H, yU = (y + 1) % H;
      const dx = (heights[y * W + xR] - heights[y * W + xL]) * 3.6;
      const dy = (heights[yU * W + x] - heights[yD * W + x]) * 2.2;
      let nx = -dx, ny = -dy, nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const idx = (y * W + x) * 4;
      normData[idx] = ((nx * 0.5 + 0.5) * 255) | 0;
      normData[idx + 1] = ((ny * 0.5 + 0.5) * 255) | 0;
      normData[idx + 2] = ((nz * 0.5 + 0.5) * 255) | 0;
      normData[idx + 3] = 255;
    }
  }

  const makeTex = (arr, isSRGB) => {
    const tex = new THREE.DataTexture(arr, W, H, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (isSRGB && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  };

  return {
    map: makeTex(colorData, true),
    normalMap: makeTex(normData, false),
    roughnessMap: makeTex(roughData, false),
  };
}

function createLeafClusterTexture(THREE) {
  const W = 256, H = 256;
  const data = new Uint8Array(W * H * 4);
  const bump = new Float32Array(W * H);

  // Define a botanical spray of 15 lobed oak leaves radiating around twigs
  const leaves = [
    { cx: 0.50, cy: 0.84, ang: 0.00, len: 0.26, wid: 0.14, shade: 1.06 },
    { cx: 0.30, cy: 0.75, ang: -0.62, len: 0.24, wid: 0.13, shade: 0.98 },
    { cx: 0.70, cy: 0.75, ang: 0.62, len: 0.24, wid: 0.13, shade: 1.02 },
    { cx: 0.20, cy: 0.56, ang: -1.10, len: 0.23, wid: 0.125, shade: 0.92 },
    { cx: 0.80, cy: 0.56, ang: 1.10, len: 0.23, wid: 0.125, shade: 0.95 },
    { cx: 0.37, cy: 0.57, ang: -0.35, len: 0.24, wid: 0.13, shade: 1.08 },
    { cx: 0.63, cy: 0.57, ang: 0.35, len: 0.24, wid: 0.13, shade: 1.04 },
    { cx: 0.24, cy: 0.36, ang: -1.35, len: 0.21, wid: 0.115, shade: 0.86 },
    { cx: 0.76, cy: 0.36, ang: 1.35, len: 0.21, wid: 0.115, shade: 0.88 },
    { cx: 0.42, cy: 0.36, ang: -0.45, len: 0.22, wid: 0.12, shade: 0.96 },
    { cx: 0.58, cy: 0.36, ang: 0.45, len: 0.22, wid: 0.12, shade: 0.94 },
    { cx: 0.50, cy: 0.68, ang: 0.08, len: 0.22, wid: 0.12, shade: 1.10 },
    { cx: 0.33, cy: 0.21, ang: -0.85, len: 0.18, wid: 0.10, shade: 0.82 },
    { cx: 0.67, cy: 0.21, ang: 0.85, len: 0.18, wid: 0.10, shade: 0.84 },
    { cx: 0.50, cy: 0.24, ang: -0.05, len: 0.20, wid: 0.11, shade: 0.90 },
  ];

  for (let py = 0; py < H; py++) {
    const y = 1.0 - py / H;
    for (let px = 0; px < W; px++) {
      const x = px / W;
      const idx = (py * W + px) * 4;

      let alpha = 0;
      let r = 0, g = 0, b = 0, hVal = 0;

      // Central woody twig stem
      const stemX = 0.5 + Math.sin(y * 5.0) * 0.018;
      const distStem = Math.abs(x - stemX);
      if (y > 0.06 && y < 0.76 && distStem < 0.013 * (1.15 - y * 0.8)) {
        alpha = 255;
        r = 78; g = 62; b = 44;
        hVal = 0.35;
      }

      // Check each oak leaf
      for (let i = 0; i < leaves.length; i++) {
        const lf = leaves[i];
        const dx = x - lf.cx;
        const dy = y - lf.cy;
        const ca = Math.cos(lf.ang), sa = Math.sin(lf.ang);
        const lx = dx * ca - dy * sa;
        const ly = dx * sa + dy * ca;

        const u = lx / lf.wid;
        const v = ly / lf.len + 0.5; // 0 at petiole base, 1 at tip

        if (v >= -0.06 && v <= 1.04) {
          if (v < 0.0 && Math.abs(u) < 0.09) {
            // Petiole stem
            alpha = 255;
            r = 95; g = 112; b = 56;
            hVal = 0.4;
          } else if (v >= 0.0 && v <= 1.0) {
            // Oak leaf envelope with characteristic rounded lobes
            const env = Math.sin(Math.pow(v, 0.72) * Math.PI) * (0.62 + 0.42 * Math.sin(v * Math.PI * 0.85));
            const lobeWave = Math.sin(v * 4.5 * Math.PI);
            const lobeMod = 0.74 + 0.30 * (lobeWave >= 0 ? Math.pow(lobeWave, 0.6) : -Math.pow(-lobeWave, 0.6));
            const maxW = env * lobeMod;
            const au = Math.abs(u);

            if (au <= maxW) {
              const edgeDist = (maxW - au) / (maxW + 1e-4);
              const midrib = Math.exp(-au * au * 110.0);
              const latVeinPhase = Math.abs(((v * 4.5 - au * 1.35) % 1.0 + 1.0) % 1.0 - 0.5);
              const latVein = Math.exp(-latVeinPhase * latVeinPhase * 95.0) * (1.0 - au * 0.6);
              const vein = Math.max(midrib, latVein * 0.65);

              // Base neutral-white-ish green tint so instanceColor drives hue cleanly
              const cellNoise = noise2D(x * 64 + i * 7, y * 64 + i * 13);
              const shade = lf.shade * (0.82 + 0.24 * edgeDist + 0.14 * vein + (cellNoise - 0.5) * 0.12);

              r = Math.min(255, (182 * shade + vein * 26) | 0);
              g = Math.min(255, (215 * shade + vein * 28) | 0);
              b = Math.min(255, (162 * shade + vein * 14) | 0);
              alpha = 255;
              hVal = 0.5 + 0.35 * edgeDist - 0.2 * vein;
            }
          }
        }
      }

      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = alpha;
      bump[py * W + px] = hVal;
    }
  }

  const normData = new Uint8Array(W * H * 4);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const xL = Math.max(0, px - 1), xR = Math.min(W - 1, px + 1);
      const yD = Math.max(0, py - 1), yU = Math.min(H - 1, py + 1);
      const dx = (bump[py * W + xR] - bump[py * W + xL]) * 2.5;
      const dy = (bump[yU * W + px] - bump[yD * W + px]) * 2.5;
      let nx = -dx, ny = -dy, nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1;
      const idx = (py * W + px) * 4;
      normData[idx] = (((nx / len) * 0.5 + 0.5) * 255) | 0;
      normData[idx + 1] = (((ny / len) * 0.5 + 0.5) * 255) | 0;
      normData[idx + 2] = (((nz / len) * 0.5 + 0.5) * 255) | 0;
      normData[idx + 3] = 255;
    }
  }

  const map = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  if (THREE.SRGBColorSpace) map.colorSpace = THREE.SRGBColorSpace;
  map.needsUpdate = true;

  const normalMap = new THREE.DataTexture(normData, W, H, THREE.RGBAFormat);
  normalMap.needsUpdate = true;

  return { map, normalMap };
}

function createLeafClusterGeometry(THREE) {
  // 3 crossed, slightly cupped double-sided cards forming a volumetric 3D botanical sprig
  const cardConfigs = [
    { rx: 0.22, ry: 0.0, rz: 0.08, dy: 0.0, scale: 1.0 },
    { rx: -0.18, ry: 2.094, rz: -0.12, dy: 0.02, scale: 0.96 },
    { rx: 0.15, ry: 4.188, rz: 0.16, dy: -0.02, scale: 0.94 },
  ];

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();

  // Each card is a 2x2 grid (4 quads = 8 triangles) with subtle camber so it catches directional light in 3D
  const gx = 2, gy = 2;
  let vertOffset = 0;

  for (let c = 0; c < cardConfigs.length; c++) {
    const cfg = cardConfigs[c];
    euler.set(cfg.rx, cfg.ry, cfg.rz);
    q.setFromEuler(euler);
    const s = 0.56 * cfg.scale;

    for (let iy = 0; iy <= gy; iy++) {
      const vCoord = iy / gy;
      const py = (vCoord - 0.5) * 2.0 * s;
      for (let ix = 0; ix <= gx; ix++) {
        const uCoord = ix / gx;
        const px = (uCoord - 0.5) * 2.0 * s;
        // Gentle arch/cupping
        const camber = (1.0 - (uCoord - 0.5) * (uCoord - 0.5) * 2.2 - (vCoord - 0.5) * (vCoord - 0.5) * 1.8) * 0.09 * s;
        v.set(px, py, camber).applyQuaternion(q);
        v.y += cfg.dy;

        n.set((uCoord - 0.5) * 0.45, 0.35 + (vCoord - 0.5) * 0.35, 1.0).normalize().applyQuaternion(q);

        positions.push(v.x, v.y, v.z);
        normals.push(n.x, n.y, n.z);
        uvs.push(uCoord, vCoord);
      }
    }

    const row = gx + 1;
    for (let iy = 0; iy < gy; iy++) {
      for (let ix = 0; ix < gx; ix++) {
        const a = vertOffset + iy * row + ix;
        const b = a + 1;
        const d = a + row;
        const e = d + 1;
        indices.push(a, b, d, b, e, d);
      }
    }
    vertOffset += (gx + 1) * (gy + 1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

function getSharedAssets(THREE) {
  if (_sharedCache) return _sharedCache;

  const barkTex = createBarkTextures(THREE);
  const barkMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: barkTex.map,
    normalMap: barkTex.normalMap,
    normalScale: new THREE.Vector2(1.35, 1.35),
    roughnessMap: barkTex.roughnessMap,
    roughness: 0.93,
    metalness: 0.0,
  });

  const leafTex = createLeafClusterTexture(THREE);
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: leafTex.map,
    normalMap: leafTex.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.72,
    metalness: 0.02,
  });

  const leafClusterGeo = createLeafClusterGeometry(THREE);

  _sharedCache = { barkMat, leafMat, leafClusterGeo };
  return _sharedCache;
}

function buildTaperedBranchSegment(THREE, curve, rStart, rEnd, tubularSegments, radialSegments, uRepeat, vScale, rootFlutes) {
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const pts = curve.getPoints(tubularSegments);
  const length = curve.getLength();

  const numVerts = (tubularSegments + 1) * (radialSegments + 1);
  const pos = new Float32Array(numVerts * 3);
  const norm = new Float32Array(numVerts * 3);
  const uv = new Float32Array(numVerts * 2);
  const indices = [];

  const vDir = new THREE.Vector3();
  const vPos = new THREE.Vector3();
  let pIdx = 0, uvIdx = 0;

  for (let i = 0; i <= tubularSegments; i++) {
    const t = i / tubularSegments;
    const P = pts[i];
    const N = frames.normals[i];
    const B = frames.binormals[i];

    // Smooth non-linear taper with slight branch collar swelling at t=0
    const collar = i === 0 ? 1.08 : (i === 1 ? 1.03 : 1.0);
    let baseR = (rStart * (1 - t) + rEnd * t) * collar;

    // Trunk root flare if rootFlutes configuration is provided
    let flareFactor = 0;
    if (rootFlutes && P.y < 1.35) {
      const fNorm = Math.max(0, (1.35 - P.y) / 1.35);
      // At y=1.35 (breast height), radius is exactly rStart (0.30m => 0.60m diameter)
      baseR = 0.30 + Math.pow(fNorm, 2.15) * 0.22;
      flareFactor = Math.pow(fNorm, 1.85);
    }

    for (let j = 0; j <= radialSegments; j++) {
      const u = j / radialSegments;
      const theta = u * Math.PI * 2.0;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      let r = baseR;
      if (flareFactor > 0 && rootFlutes) {
        let fluteSum = 0;
        for (let k = 0; k < rootFlutes.length; k++) {
          const fl = rootFlutes[k];
          const dAng = Math.atan2(Math.sin(theta - fl.ang), Math.cos(theta - fl.ang));
          fluteSum += fl.amp * Math.exp(-dAng * dAng * fl.sharpness);
        }
        r += flareFactor * fluteSum;
      } else {
        // Subtle organic cross-sectional ovality/gnarl
        r *= 1.0 + 0.045 * Math.sin(theta * 3.0 + t * 8.0);
      }

      vDir.set(0, 0, 0).addScaledVector(N, cosT).addScaledVector(B, sinT);
      vPos.copy(P).addScaledVector(vDir, r);

      pos[pIdx] = vPos.x;
      pos[pIdx + 1] = vPos.y;
      pos[pIdx + 2] = vPos.z;

      norm[pIdx] = vDir.x;
      norm[pIdx + 1] = vDir.y;
      norm[pIdx + 2] = vDir.z;
      pIdx += 3;

      uv[uvIdx] = u * uRepeat;
      uv[uvIdx + 1] = t * length * vScale;
      uvIdx += 2;
    }
  }

  const ring = radialSegments + 1;
  for (let i = 0; i < tubularSegments; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * ring + j;
      const b = (i + 1) * ring + j;
      const c = (i + 1) * ring + (j + 1);
      const d = i * ring + (j + 1);
      indices.push(a, b, d, b, c, d);
    }
  }

  return { pos, norm, uv, indices };
}

function mergeGeometryParts(THREE, parts) {
  let totalVerts = 0;
  let totalIdx = 0;
  for (let i = 0; i < parts.length; i++) {
    totalVerts += parts[i].pos.length / 3;
    totalIdx += parts[i].indices.length;
  }

  const pos = new Float32Array(totalVerts * 3);
  const norm = new Float32Array(totalVerts * 3);
  const uv = new Float32Array(totalVerts * 2);
  const indices = new Uint32Array(totalIdx);

  let vOffset = 0;
  let iOffset = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    pos.set(p.pos, vOffset * 3);
    norm.set(p.norm, vOffset * 3);
    uv.set(p.uv, vOffset * 2);
    for (let k = 0; k < p.indices.length; k++) {
      indices[iOffset + k] = p.indices[k] + vOffset;
    }
    vOffset += p.pos.length / 3;
    iOffset += p.indices.length;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  return geo;
}

export default function create(THREE, opts = {}) {
  const targetHeight = typeof opts.height === 'number' && opts.height > 0 ? opts.height : 9.0;
  const scaleFactor = targetHeight / 9.0;
  const targetWidth = 10.0 * scaleFactor;
  const targetLength = 10.0 * scaleFactor;

  const seed = opts.seed ?? opts.id ?? 'oak_tree_default';
  const rand = makePRNG(seed);

  const shared = getSharedAssets(THREE);

  const group = new THREE.Group();
  group.name = opts.id ?? 'oak_tree';
  group.userData.assetType = 'tree';
  group.userData.kind = 'oak';
  group.userData.dims = {
    length: targetLength,
    width: targetWidth,
    height: targetHeight,
  };

  const branchParts = [];
  const foliageAnchors = [];

  // 1. Main Trunk (y = 0 to fork at y = 2.25..2.55 m, DBH = 0.60 m at y = 1.35 m)
  const forkY = 2.28 + rand() * 0.26;
  const leanX = (rand() - 0.5) * 0.16;
  const leanZ = (rand() - 0.5) * 0.16;

  const numRootFlutes = 6;
  const rootFlutes = [];
  for (let k = 0; k < numRootFlutes; k++) {
    rootFlutes.push({
      ang: (k / numRootFlutes) * Math.PI * 2.0 + (rand() - 0.5) * 0.32,
      amp: 0.14 + rand() * 0.11,
      sharpness: 6.5 + rand() * 3.5,
    });
  }

  const trunkPts = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(leanX * 0.25, 0.65, leanZ * 0.25),
    new THREE.Vector3(leanX * 0.55, 1.35, leanZ * 0.55),
    new THREE.Vector3(leanX * 0.85, 1.90, leanZ * 0.85),
    new THREE.Vector3(leanX, forkY, leanZ),
  ];
  const trunkCurve = new THREE.CatmullRomCurve3(trunkPts);
  branchParts.push(
    buildTaperedBranchSegment(THREE, trunkCurve, 0.30, 0.27, 18, 20, 3.0, 0.9, rootFlutes)
  );

  // Surface buttress root spurs radiating at grade (y = 0)
  for (let k = 0; k < numRootFlutes; k++) {
    const fl = rootFlutes[k];
    const ca = Math.cos(fl.ang), sa = Math.sin(fl.ang);
    const rootLen = 0.72 + rand() * 0.35;
    const rCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(ca * 0.18, 0.52, sa * 0.18),
      new THREE.Vector3(ca * (0.45 + fl.amp), 0.20, sa * (0.45 + fl.amp)),
      new THREE.Vector3(ca * rootLen, 0.02, sa * rootLen),
    ]);
    branchParts.push(
      buildTaperedBranchSegment(THREE, rCurve, 0.13, 0.035, 8, 8, 1.0, 1.0, null)
    );
  }

  // 2. Recursive Sinuous Scaffold Limbs & Secondary/Tertiary/Twig Branches
  const forkOrigin = trunkPts[trunkPts.length - 1];
  const numPrimaryLimbs = 4 + (rand() > 0.45 ? 1 : 0); // 4 or 5 major limbs

  function spawnBranch(startPos, dir, length, rStart, rEnd, level, azimuthHint) {
    const steps = level === 1 ? 6 : level === 2 ? 5 : 4;
    const pts = [startPos.clone()];
    const curPos = startPos.clone();
    const curDir = dir.clone().normalize();

    for (let s = 1; s <= steps; s++) {
      const frac = s / steps;
      const segLen = length / steps;

      // Sinuous gnarled oak bend: dips slightly then arches upward toward light
      const gnarlX = (rand() - 0.5) * (level === 1 ? 0.26 : 0.34);
      const gnarlZ = (rand() - 0.5) * (level === 1 ? 0.26 : 0.34);
      let gnarlY = (rand() - 0.46) * 0.22;

      if (level === 1) {
        // Classic southern live oak / mature red oak sweeping arch
        gnarlY += frac < 0.5 ? -0.04 : 0.11;
      } else if (level >= 2) {
        gnarlY += 0.07;
      }

      curDir.x += gnarlX;
      curDir.y += gnarlY;
      curDir.z += gnarlZ;
      curDir.normalize();

      curPos.addScaledVector(curDir, segLen);
      // Keep structural branches above crown base (2.5 m)
      if (curPos.y < 2.65 && s >= 2) {
        curPos.y = 2.65 + (s - 1) * 0.18;
        curDir.y = Math.max(0.15, curDir.y);
        curDir.normalize();
      }
      pts.push(curPos.clone());
    }

    const curve = new THREE.CatmullRomCurve3(pts);
    const tubSegs = level === 1 ? 14 : level === 2 ? 10 : level === 3 ? 7 : 5;
    const radSegs = level === 1 ? 12 : level === 2 ? 9 : level === 3 ? 6 : 5;
    const uRep = level === 1 ? 2.0 : 1.0;

    branchParts.push(
      buildTaperedBranchSegment(THREE, curve, rStart, rEnd, tubSegs, radSegs, uRep, 0.85, null)
    );

    if (level < 4) {
      const numChildren = level === 1 ? 3 : level === 2 ? 3 : 2;
      for (let c = 0; c < numChildren; c++) {
        const tAttach = level === 1 ? (0.36 + c * 0.28 + (rand() - 0.5) * 0.06) : (0.42 + c * 0.26);
        const clampedT = Math.min(0.95, Math.max(0.28, tAttach));
        const attachPos = curve.getPoint(clampedT);
        const tangent = curve.getTangent(clampedT);

        // Spread child branches laterally and upward
        const sideSign = (c % 2 === 0 ? 1 : -1) * (0.55 + rand() * 0.45);
        const sideVec = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
        const childDir = tangent.clone()
          .multiplyScalar(0.68)
          .addScaledVector(sideVec, sideSign)
          .add(new THREE.Vector3(0, 0.22 + rand() * 0.25, 0))
          .normalize();

        const childLen = length * (0.64 + rand() * 0.14);
        const childRStart = (rStart * (1 - clampedT) + rEnd * clampedT) * 0.76;
        const childREnd = Math.max(0.016, childRStart * 0.46);

        spawnBranch(attachPos, childDir, childLen, childRStart, childREnd, level + 1, azimuthHint);
      }

      // Continue leader tip at each fork
      const tipPos = pts[pts.length - 1];
      const tipTangent = curve.getTangent(1.0);
      const leaderDir = tipTangent.clone().add(new THREE.Vector3((rand() - 0.5) * 0.3, 0.22, (rand() - 0.5) * 0.3)).normalize();
      spawnBranch(tipPos, leaderDir, length * 0.66, rEnd * 0.94, Math.max(0.015, rEnd * 0.45), level + 1, azimuthHint);
    }

    if (level >= 2) {
      const tipPos = pts[pts.length - 1];
      const midPos = curve.getPoint(0.65);
      foliageAnchors.push({ pos: tipPos, weight: level === 4 ? 1.0 : 0.7, level });
      if (level >= 3) {
        foliageAnchors.push({ pos: midPos, weight: 0.65, level });
      }
    }
  }

  for (let i = 0; i < numPrimaryLimbs; i++) {
    const az = (i / numPrimaryLimbs) * Math.PI * 2.0 + (rand() - 0.5) * 0.24;
    const pitch = 0.42 + rand() * 0.22; // Wide spreading oak angle (24°–36° above horizontal)
    const dir = new THREE.Vector3(
      Math.cos(az) * Math.cos(pitch),
      Math.sin(pitch),
      Math.sin(az) * Math.cos(pitch)
    ).normalize();

    const startOffset = forkOrigin.clone().add(new THREE.Vector3(Math.cos(az) * 0.10, -0.05, Math.sin(az) * 0.10));
    const limbLen = 2.65 + rand() * 0.38;
    spawnBranch(startOffset, dir, limbLen, 0.19, 0.105, 1, az);
  }

  // Add an upper-central crown leader limb so the dome crest is well-supported with visible inner boughs
  const centralAz = rand() * Math.PI * 2.0;
  const centralDir = new THREE.Vector3(Math.cos(centralAz) * 0.35, 0.92, Math.sin(centralAz) * 0.35).normalize();
  spawnBranch(forkOrigin.clone(), centralDir, 2.55, 0.17, 0.095, 1, centralAz);

  const branchesGeo = mergeGeometryParts(THREE, branchParts);
  const branchesMesh = new THREE.Mesh(branchesGeo, shared.barkMat);
  branchesMesh.name = 'trunk_and_branches';
  branchesMesh.castShadow = true;
  branchesMesh.receiveShadow = true;

  // 3. Foliage Canopy — 1,350 instanced 3D compound leaf sprigs around branch tips
  const INSTANCE_COUNT = 1350;
  const clusterPlacements = [];

  for (let i = 0; i < INSTANCE_COUNT; i++) {
    const anchor = foliageAnchors[(i * 7 + Math.floor(rand() * foliageAnchors.length)) % foliageAnchors.length];
    const base = anchor.pos;

    // Distribute sprigs in billowing sub-clouds around branch tips, leaving natural sky holes between boughs
    const rCloud = Math.pow(rand(), 0.62) * (anchor.level === 4 ? 0.92 : 0.72);
    const theta = rand() * Math.PI * 2.0;
    const phi = Math.acos(2.0 * rand() - 1.0);

    let px = base.x + rCloud * Math.sin(phi) * Math.cos(theta);
    let py = base.y + rCloud * Math.cos(phi) * 0.68 + 0.12;
    let pz = base.z + rCloud * Math.sin(phi) * Math.sin(theta);

    // Sculpt within a natural broad oak dome envelope: crown base ~2.55 m, height 9.0 m, spread 10.0 m (radius 5.0 m)
    const radialDist = Math.hypot(px, pz);
    const maxAllowedR = 4.65;
    if (radialDist > maxAllowedR) {
      const clampScale = maxAllowedR / radialDist;
      px *= clampScale;
      pz *= clampScale;
    }

    const rNorm = Math.hypot(px, pz) / 4.65;
    const minCanopyY = 2.58 + (1.0 - Math.min(1.0, rNorm)) * 0.25 + (rand() - 0.5) * 0.18;
    const maxCanopyY = 8.65 - rNorm * rNorm * 2.35;

    if (py < minCanopyY) py = minCanopyY + rand() * 0.35;
    if (py > maxCanopyY) py = maxCanopyY - rand() * 0.35;

    const s = 0.68 + rand() * 0.44;
    clusterPlacements.push({
      x: px,
      y: py,
      z: pz,
      rx: (rand() - 0.5) * 1.15,
      ry: rand() * Math.PI * 2.0,
      rz: (rand() - 0.5) * 1.15,
      scale: s,
    });
  }

  // Exact Calibration Pass: measure combined trunk/branch + instanced leaf vertices and scale X, Z, Y to exact target envelope (10.0 x 9.0 x 10.0 m at base scale)
  const leafPosAttr = shared.leafClusterGeo.getAttribute('position');
  const leafVertCount = leafPosAttr.count;
  const dummyMat = new THREE.Matrix4();
  const dummyPos = new THREE.Vector3();
  const dummyQuat = new THREE.Quaternion();
  const dummyEuler = new THREE.Euler();
  const dummyScale = new THREE.Vector3();
  const vTemp = new THREE.Vector3();

  let minX = Infinity, maxX = -Infinity;
  let minY = 0, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  const brPosAttr = branchesGeo.getAttribute('position');
  for (let i = 0; i < brPosAttr.count; i++) {
    const vx = brPosAttr.getX(i);
    const vy = brPosAttr.getY(i);
    const vz = brPosAttr.getZ(i);
    if (vx < minX) minX = vx;
    if (vx > maxX) maxX = vx;
    if (vy > maxY) maxY = vy;
    if (vz < minZ) minZ = vz;
    if (vz > maxZ) maxZ = vz;
  }

  for (let i = 0; i < clusterPlacements.length; i++) {
    const p = clusterPlacements[i];
    dummyPos.set(p.x, p.y, p.z);
    dummyEuler.set(p.rx, p.ry, p.rz);
    dummyQuat.setFromEuler(dummyEuler);
    dummyScale.set(p.scale, p.scale, p.scale);
    dummyMat.compose(dummyPos, dummyQuat, dummyScale);

    for (let vIdx = 0; vIdx < leafVertCount; vIdx++) {
      vTemp.fromBufferAttribute(leafPosAttr, vIdx).applyMatrix4(dummyMat);
      if (vTemp.x < minX) minX = vTemp.x;
      if (vTemp.x > maxX) maxX = vTemp.x;
      if (vTemp.y > maxY) maxY = vTemp.y;
      if (vTemp.z < minZ) minZ = vTemp.z;
      if (vTemp.z > maxZ) maxZ = vTemp.z;
    }
  }

  const curWidth = maxX - minX;
  const curLength = maxZ - minZ;
  const curHeight = maxY - minY;
  const centerX = (minX + maxX) * 0.5;
  const centerZ = (minZ + maxZ) * 0.5;

  const fitX = targetWidth / curWidth;
  const fitY = targetHeight / curHeight;
  const fitZ = targetLength / curLength;

  // Apply exact fit transform to branch vertices (preserving trunk base centered at origin above y = 0)
  for (let i = 0; i < brPosAttr.count; i++) {
    const vy = brPosAttr.getY(i);
    // Smoothly transition X/Z centering above y = 1.5 m so trunk base stays locked at (0, 0, 0)
    const centerWeight = Math.min(1.0, Math.max(0.0, (vy - 0.5) / 1.5));
    const vx = (brPosAttr.getX(i) - centerX * centerWeight) * fitX;
    const vz = (brPosAttr.getZ(i) - centerZ * centerWeight) * fitZ;
    brPosAttr.setXYZ(i, vx, vy * fitY, vz);
  }
  brPosAttr.needsUpdate = true;
  branchesGeo.computeVertexNormals();
  branchesGeo.computeBoundingBox();
  branchesGeo.computeBoundingSphere();

  // Build InstancedMesh with calibrated transforms and natural oak foliage color variation
  const foliageMesh = new THREE.InstancedMesh(shared.leafClusterGeo, shared.leafMat, INSTANCE_COUNT);
  foliageMesh.name = 'foliage_clusters';
  foliageMesh.castShadow = true;
  foliageMesh.receiveShadow = true;

  const baseColor = new THREE.Color(opts.color ?? '#3b5d28');
  const hsl = { h: 0, s: 0, l: 0 };
  baseColor.getHSL(hsl);
  const instColor = new THREE.Color();

  for (let i = 0; i < INSTANCE_COUNT; i++) {
    const p = clusterPlacements[i];
    const cx = (p.x - centerX) * fitX;
    const cy = p.y * fitY;
    const cz = (p.z - centerZ) * fitZ;

    dummyPos.set(cx, cy, cz);
    dummyEuler.set(p.rx, p.ry, p.rz);
    dummyQuat.setFromEuler(dummyEuler);
    dummyScale.set(p.scale * fitX, p.scale * fitY, p.scale * fitZ);
    dummyMat.compose(dummyPos, dummyQuat, dummyScale);
    foliageMesh.setMatrixAt(i, dummyMat);

    // Height & radial sun exposure shading + per-cluster hue/saturation shift (dark olive to fresh sun-lit green)
    const sunExposure = Math.min(1.0, Math.max(0.0, (cy / targetHeight - 0.25) * 0.85 + Math.hypot(cx, cz) / (targetWidth * 0.5) * 0.35));
    const hShift = (rand() - 0.5) * 0.055;
    const sShift = (rand() - 0.5) * 0.14;
    const lShift = (sunExposure - 0.45) * 0.14 + (rand() - 0.5) * 0.07;

    instColor.setHSL(
      (hsl.h + hShift + 1.0) % 1.0,
      Math.max(0.18, Math.min(0.85, hsl.s + sShift)),
      Math.max(0.14, Math.min(0.52, hsl.l + lShift))
    );
    foliageMesh.setColorAt(i, instColor);
  }

  foliageMesh.instanceMatrix.needsUpdate = true;
  if (foliageMesh.instanceColor) foliageMesh.instanceColor.needsUpdate = true;
  foliageMesh.computeBoundingBox();
  foliageMesh.computeBoundingSphere();

  group.add(branchesMesh);
  group.add(foliageMesh);

  return group;
}
