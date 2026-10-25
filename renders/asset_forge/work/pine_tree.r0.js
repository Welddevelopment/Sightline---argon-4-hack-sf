let _barkMaps = null;
let _needleMaps = null;
let _tuftBaseGeo = null;
let _coneBaseGeo = null;
let _stubBaseGeo = null;

function hashSeed(input) {
  const str = String(input ?? 'pine_tree_default');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makePRNG(seedVal) {
  let a = (hashSeed(seedVal) || 1337) >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise2D(x, y, px = 16, py = 16, seed = 101) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const cell = (cx, cy) => {
    const wx = ((cx % px) + px) % px;
    const wy = ((cy % py) + py) % py;
    let n = (wx * 374761393 + wy * 668265263 + seed * 1442695041) | 0;
    n = (n ^ (n >>> 13)) | 0;
    n = Math.imul(n, 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };

  const v00 = cell(xi, yi);
  const v10 = cell(xi + 1, yi);
  const v01 = cell(xi, yi + 1);
  const v11 = cell(xi + 1, yi + 1);
  const x0 = v00 + u * (v10 - v00);
  const x1 = v01 + u * (v11 - v01);
  return x0 + v * (x1 - x0);
}

function getBarkMaps(THREE) {
  if (_barkMaps) return _barkMaps;

  const W = 256;
  const H = 512;
  const colorData = new Uint8Array(W * H * 4);
  const bumpData = new Uint8Array(W * H * 4);

  // Pre-generate staggered vertical plate centers for Southern Pine bark
  const cols = 10;
  const rows = 14;
  const seeds = [];
  const rng = makePRNG('southern_pine_bark_plates_v2');
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      seeds.push({
        x: (c + 0.18 + 0.64 * rng()) / cols,
        y: (r + 0.15 + 0.70 * rng()) / rows,
        tone: rng(),
        flake: rng()
      });
    }
  }

  const heightBuf = new Float32Array(W * H);

  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;

      const warpX = (valueNoise2D(u * 12, v * 24, 12, 24, 17) - 0.5) * 0.032 +
                    (valueNoise2D(u * 36, v * 72, 36, 72, 53) - 0.5) * 0.011;
      const warpY = (valueNoise2D(u * 12, v * 16, 12, 16, 29) - 0.5) * 0.025;

      const pu = u + warpX;
      const pv = v + warpY;

      let d1 = 1e9;
      let d2 = 1e9;
      let closestSeed = seeds[0];

      const baseCol = Math.floor(((pu % 1 + 1) % 1) * cols);
      const baseRow = Math.floor(((pv % 1 + 1) % 1) * rows);

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = ((baseRow + dr) % rows + rows) % rows;
          const cc = ((baseCol + dc) % cols + cols) % cols;
          const s = seeds[rr * cols + cc];

          let dx = pu - s.x;
          if (dx > 0.5) dx -= 1.0;
          if (dx < -0.5) dx += 1.0;
          let dy = pv - s.y;
          if (dy > 0.5) dy -= 1.0;
          if (dy < -0.5) dy += 1.0;

          // Elongated vertical plates (anisotropic distance)
          const dist = Math.hypot(dx * 2.55, dy * 0.85);
          if (dist < d1) {
            d2 = d1;
            d1 = dist;
            closestSeed = s;
          } else if (dist < d2) {
            d2 = dist;
          }
        }
      }

      const edge = d2 - d1;
      // Sharp fissure trough vs flat scaly plate top
      const plateMask = Math.min(1, Math.max(0, (edge - 0.014) / 0.036));
      const fineGrain = valueNoise2D(u * 64, v * 128, 64, 128, 91);
      const microScale = valueNoise2D(u * 32, v * 48, 32, 48, 77);

      // Step-like exfoliating scale ridges inside each plate
      const scaleStep = Math.floor((microScale * 0.65 + closestSeed.flake * 0.35) * 4) / 4;
      const hVal = plateMask * (0.72 + 0.18 * scaleStep + 0.10 * fineGrain) + (1 - plateMask) * (0.08 * fineGrain);
      heightBuf[y * W + x] = hVal;

      // Deep dark charcoal-brown fissure vs warm reddish-cinnamon bark plates
      const fR = 26 + fineGrain * 10;
      const fG = 18 + fineGrain * 8;
      const fB = 14 + fineGrain * 6;

      const pTone = closestSeed.tone;
      // Occasional silver-grey weathered outer scale
      const weathered = pTone > 0.82 ? (pTone - 0.82) * 3.2 : 0;

      const pR = 112 + pTone * 32 + scaleStep * 18 + fineGrain * 14 - weathered * 16;
      const pG = 68 + pTone * 20 + scaleStep * 12 + fineGrain * 10 + weathered * 8;
      const pB = 46 + pTone * 14 + scaleStep * 8 + fineGrain * 8 + weathered * 14;

      const idx = (y * W + x) * 4;
      colorData[idx] = Math.min(255, Math.max(0, Math.round(fR + (pR - fR) * plateMask)));
      colorData[idx + 1] = Math.min(255, Math.max(0, Math.round(fG + (pG - fG) * plateMask)));
      colorData[idx + 2] = Math.min(255, Math.max(0, Math.round(fB + (pB - fB) * plateMask)));
      colorData[idx + 3] = 255;
    }
  }

  // Compute normal map from heightBuf
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const hL = heightBuf[y * W + ((x - 1 + W) % W)];
      const hR = heightBuf[y * W + ((x + 1) % W)];
      const hD = heightBuf[((y - 1 + H) % H) * W + x];
      const hU = heightBuf[((y + 1) % H) * W + x];

      const dx = (hL - hR) * 4.5;
      const dy = (hD - hU) * 4.5;
      const dz = 1.0;
      const len = Math.hypot(dx, dy, dz) || 1;

      const idx = (y * W + x) * 4;
      bumpData[idx] = Math.round(((dx / len) * 0.5 + 0.5) * 255);
      bumpData[idx + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255);
      bumpData[idx + 2] = Math.round(((dz / len) * 0.5 + 0.5) * 255);
      bumpData[idx + 3] = 255;
    }
  }

  const colorTex = new THREE.DataTexture(colorData, W, H, THREE.RGBAFormat);
  colorTex.colorSpace = THREE.SRGBColorSpace;
  colorTex.wrapS = THREE.RepeatWrapping;
  colorTex.wrapT = THREE.RepeatWrapping;
  colorTex.repeat.set(2, 7);
  colorTex.needsUpdate = true;

  const normalTex = new THREE.DataTexture(bumpData, W, H, THREE.RGBAFormat);
  normalTex.wrapS = THREE.RepeatWrapping;
  normalTex.wrapT = THREE.RepeatWrapping;
  normalTex.repeat.set(2, 7);
  normalTex.needsUpdate = true;

  _barkMaps = { colorTex, normalTex };
  return _barkMaps;
}

function getNeedleMaps(THREE) {
  if (_needleMaps) return _needleMaps;

  const S = 256;
  const rgba = new Uint8Array(S * S * 4);
  const norm = new Uint8Array(S * S * 4);
  const heightMap = new Float32Array(S * S);

  const rng = makePRNG('loblolly_needle_fascicles_v3');

  // Helper to rasterize an anti-aliased tapered curved pine needle
  const drawNeedle = (x0, y0, angle, length, widthBase, rCol, gCol, bCol, bend, zHeight) => {
    const steps = Math.ceil(length * 1.4);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const along = t * length;
      const droop = bend * t * t * length * 0.22;

      const px = x0 + cosA * along - sinA * droop;
      const py = y0 + sinA * along + cosA * droop;

      // Taper from sheath to fine needle point
      const halfW = widthBase * (1.0 - 0.72 * Math.pow(t, 1.3));
      const rSpan = Math.ceil(halfW + 1.2);

      const ixMin = Math.max(1, Math.floor(px - rSpan));
      const ixMax = Math.min(S - 2, Math.ceil(px + rSpan));
      const iyMin = Math.max(1, Math.floor(py - rSpan));
      const iyMax = Math.min(S - 2, Math.ceil(py + rSpan));

      for (let iy = iyMin; iy <= iyMax; iy++) {
        for (let ix = ixMin; ix <= ixMax; ix++) {
          const d = Math.hypot(ix - px, iy - py);
          if (d <= halfW + 0.75) {
            const cov = d <= halfW - 0.35 ? 1.0 : Math.max(0, 1.0 - (d - (halfW - 0.35)) / 1.1);
            const ridge = Math.max(0, 1.0 - d / (halfW + 0.4));
            const hCandidate = zHeight + ridge * 0.25;

            const pIdx = iy * S + ix;
            if (hCandidate >= heightMap[pIdx] || rgba[pIdx * 4 + 3] < 120) {
              heightMap[pIdx] = Math.max(heightMap[pIdx], hCandidate);
              const cIdx = pIdx * 4;
              // Sunlit tip gradient and cylindrical needle highlight
              const tipBright = 0.82 + 0.34 * t + 0.16 * ridge;
              const nr = Math.min(255, Math.max(0, Math.round(rCol * tipBright)));
              const ng = Math.min(255, Math.max(0, Math.round(gCol * tipBright)));
              const nb = Math.min(255, Math.max(0, Math.round(bCol * tipBright)));

              const prevA = rgba[cIdx + 3] / 255;
              const outA = Math.min(1, prevA + cov * (1 - prevA * 0.5));
              rgba[cIdx] = Math.round(rgba[cIdx] * (1 - cov) + nr * cov);
              rgba[cIdx + 1] = Math.round(rgba[cIdx + 1] * (1 - cov) + ng * cov);
              rgba[cIdx + 2] = Math.round(rgba[cIdx + 2] * (1 - cov) + nb * cov);
              rgba[cIdx + 3] = Math.round(outA * 255);
            }
          }
        }
      }
    }
  };

  // Pre-fill RGB with dark pine green so bilinear mipmap filtering never bleeds black halos
  for (let i = 0; i < S * S; i++) {
    rgba[i * 4] = 48;
    rgba[i * 4 + 1] = 74;
    rgba[i * 4 + 2] = 30;
    rgba[i * 4 + 3] = 0;
  }

  // Draw woody central shoot twig at the base of the tuft card
  const cx = S * 0.5;
  const cy = S * 0.80;
  for (let i = 0; i < 65; i++) {
    const t = i / 64;
    const tx = cx + Math.sin(t * 4.0) * 2.5;
    const ty = S * 0.95 - t * (S * 0.42);
    const rad = 5.2 * (1 - t * 0.55);
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const d = Math.hypot(dx, dy);
        if (d <= rad) {
          const ix = Math.round(tx + dx);
          const iy = Math.round(ty + dy);
          if (ix >= 0 && ix < S && iy >= 0 && iy < S) {
            const idx = (iy * S + ix) * 4;
            rgba[idx] = 96;
            rgba[idx + 1] = 68;
            rgba[idx + 2] = 44;
            rgba[idx + 3] = 255;
            heightMap[iy * S + ix] = 0.35;
          }
        }
      }
    }
  }

  // Radiating fascicles of 3 long needles (characteristic of Loblolly/Slash pine)
  const fascicleCount = 86;
  for (let f = 0; f < fascicleCount; f++) {
    const layer = f / fascicleCount;
    const hubY = cy - (rng() * 0.28 - 0.06) * S;
    const hubX = cx + (rng() - 0.5) * 22;

    // Fan angles upward and outward (-165 deg to -15 deg in canvas coords where -90 is up)
    const baseAngle = -Math.PI * 0.5 + (rng() - 0.5) * Math.PI * 0.92;
    const shade = 0.78 + 0.40 * layer + (rng() - 0.5) * 0.15;

    // Warm dark yellow-green / olive-pine palette
    const baseR = Math.round(54 * shade);
    const baseG = Math.round(86 * shade);
    const baseB = Math.round(32 * shade);

    // Draw papery grey-brown fascicle sheath at base
    drawNeedle(hubX, hubY, baseAngle, 13, 1.8, 110, 92, 72, 0, layer * 0.6);

    // 3 needles per fascicle
    for (let n = 0; n < 3; n++) {
      const splay = (n - 1) * (0.055 + rng() * 0.045);
      const nAngle = baseAngle + splay;
      const nLen = (78 + rng() * 44) * (1.0 - 0.18 * Math.abs( nAngle + Math.PI * 0.5 ));
      const bendDir = (nAngle + Math.PI * 0.5) >= 0 ? 1 : -1;
      const bend = bendDir * (0.35 + rng() * 0.55);
      const wBase = 1.35 + rng() * 0.35;

      drawNeedle(
        hubX + Math.cos(baseAngle) * 7,
        hubY + Math.sin(baseAngle) * 7,
        nAngle,
        nLen,
        wBase,
        baseR + Math.round((rng() - 0.5) * 10),
        baseG + Math.round((rng() - 0.5) * 14),
        baseB + Math.round((rng() - 0.5) * 8),
        bend,
        0.2 + layer * 0.65 + n * 0.03
      );
    }
  }

  // Normal map from needle heightMap
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const hL = heightMap[y * S + Math.max(0, x - 1)];
      const hR = heightMap[y * S + Math.min(S - 1, x + 1)];
      const hD = heightMap[Math.max(0, y - 1) * S + x];
      const hU = heightMap[Math.min(S - 1, y + 1) * S + x];

      const dx = (hL - hR) * 3.2;
      const dy = (hD - hU) * 3.2;
      const dz = 1.0;
      const len = Math.hypot(dx, dy, dz) || 1;

      const idx = (y * S + x) * 4;
      norm[idx] = Math.round(((dx / len) * 0.5 + 0.5) * 255);
      norm[idx + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255);
      norm[idx + 2] = Math.round(((dz / len) * 0.5 + 0.5) * 255);
      norm[idx + 3] = 255;
    }
  }

  const colorTex = new THREE.DataTexture(rgba, S, S, THREE.RGBAFormat);
  colorTex.colorSpace = THREE.SRGBColorSpace;
  colorTex.flipY = true;
  colorTex.needsUpdate = true;

  const normalTex = new THREE.DataTexture(norm, S, S, THREE.RGBAFormat);
  normalTex.flipY = true;
  normalTex.needsUpdate = true;

  _needleMaps = { colorTex, normalTex };
  return _needleMaps;
}

function getTuftBaseGeometry(THREE) {
  if (_tuftBaseGeo) return _tuftBaseGeo;

  // Build a 3D multi-plane cupped needle burst (7 intersecting curved cards per tuft)
  // Card base is at (0,0,0) and needles fan toward +Y and outward in X/Z
  const cardSpecs = [
    { rotY: 0.0, tiltX: 0.42, scale: 1.0, yOff: 0.0 },
    { rotY: 1.047, tiltX: 0.44, scale: 0.98, yOff: 0.02 },
    { rotY: 2.094, tiltX: 0.42, scale: 1.0, yOff: 0.01 },
    { rotY: 3.141, tiltX: 0.45, scale: 0.96, yOff: 0.02 },
    { rotY: 4.188, tiltX: 0.43, scale: 0.99, yOff: 0.0 },
    { rotY: 5.235, tiltX: 0.44, scale: 0.97, yOff: 0.01 },
    // Inner upright crown core planes
    { rotY: 0.52, tiltX: 0.14, scale: 0.86, yOff: 0.06 },
    { rotY: 2.09, tiltX: -0.14, scale: 0.86, yOff: 0.06 },
    { rotY: 3.66, tiltX: 0.16, scale: 0.84, yOff: 0.05 }
  ];

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let vertOffset = 0;

  const segX = 2;
  const segY = 3;
  const cardW = 0.88;
  const cardH = 0.82;

  const vPos = new THREE.Vector3();
  const vNorm = new THREE.Vector3();
  const qRotY = new THREE.Quaternion();
  const qTilt = new THREE.Quaternion();
  const axisY = new THREE.Vector3(0, 1, 0);
  const axisX = new THREE.Vector3(1, 0, 0);

  for (let c = 0; c < cardSpecs.length; c++) {
    const spec = cardSpecs[c];
    qRotY.setFromAxisAngle(axisY, spec.rotY);
    qTilt.setFromAxisAngle(axisX, spec.tiltX);
    qRotY.multiply(qTilt);

    for (let iy = 0; iy <= segY; iy++) {
      const ty = iy / segY; // 0 at base, 1 at needle tips
      for (let ix = 0; ix <= segX; ix++) {
        const tx = ix / segX; // 0..1 across width
        const sx = (tx - 0.5) * cardW * spec.scale;
        const sy = ty * cardH * spec.scale;
        // Slight outward arch along needle length and gentle cupping across width
        const sz = (Math.sin(ty * Math.PI * 0.85) * 0.11 - (tx - 0.5) * (tx - 0.5) * 0.16) * spec.scale;

        vPos.set(sx, sy, sz).applyQuaternion(qRotY);
        vPos.y += spec.yOff;

        // Spherized upward-biased normal for realistic soft canopy lighting
        vNorm.set(vPos.x, vPos.y * 0.65 + 0.35, vPos.z).normalize();

        positions.push(vPos.x, vPos.y, vPos.z);
        normals.push(vNorm.x, vNorm.y, vNorm.z);
        uvs.push(tx, ty);
      }
    }

    const rowStride = segX + 1;
    for (let iy = 0; iy < segY; iy++) {
      for (let ix = 0; ix < segX; ix++) {
        const a = vertOffset + iy * rowStride + ix;
        const b = a + 1;
        const d = a + rowStride;
        const e = d + 1;
        indices.push(a, b, d, b, e, d);
      }
    }
    vertOffset += (segX + 1) * (segY + 1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  _tuftBaseGeo = geo;
  return _tuftBaseGeo;
}

function getPineconeGeometry(THREE) {
  if (_coneBaseGeo) return _coneBaseGeo;
  // Ovoid-conical Loblolly seed cone (hangs ~11 cm long) with jagged scale rings
  const radial = 7;
  const heightSegs = 6;
  const geo = new THREE.CylinderGeometry(0.012, 0.022, 0.11, radial, heightSegs, false);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = (y + 0.055) / 0.11; // 0 bottom, 1 top attachment
    const profile = Math.sin(Math.pow(t, 0.75) * Math.PI) * 1.35 + 0.15;
    const sawtooth = 1.0 + ((Math.round(t * 6) % 2) * 0.18);
    pos.setXYZ(i, x * profile * sawtooth, y - 0.045, z * profile * sawtooth);
  }
  geo.computeVertexNormals();
  _coneBaseGeo = geo;
  return _coneBaseGeo;
}

function getDeadStubGeometry(THREE) {
  if (_stubBaseGeo) return _stubBaseGeo;
  // Crooked, snapped dead branch stub with swollen collar at z=0 extending to y=1
  const geo = new THREE.CylinderGeometry(0.014, 0.038, 1.0, 7, 5, false);
  geo.translate(0, 0.5, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    // Swollen bark collar near trunk (y < 0.18)
    if (y < 0.18) {
      const swell = 1.0 + (0.18 - y) * 2.8;
      x *= swell;
      z *= swell;
    }
    // Crooked bend along length and jagged snapped tip
    const bendZ = Math.sin(y * Math.PI * 1.3) * 0.035;
    const bendX = (y * y) * 0.025;
    if (y > 0.92) {
      const jag = ((i % 3) - 1) * 0.045;
      y += jag;
    }
    pos.setXYZ(i, x + bendX, y, z + bendZ);
  }
  geo.computeVertexNormals();
  _stubBaseGeo = geo;
  return _stubBaseGeo;
}

function appendGeometry(dstPos, dstNorm, dstUV, dstIdx, srcGeo) {
  const pos = srcGeo.attributes.position;
  const norm = srcGeo.attributes.normal;
  const uv = srcGeo.attributes.uv;
  const idx = srcGeo.index;
  const baseVertex = dstPos.length / 3;

  for (let i = 0; i < pos.count; i++) {
    dstPos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    dstNorm.push(norm ? norm.getX(i) : 0, norm ? norm.getY(i) : 1, norm ? norm.getZ(i) : 0);
    dstUV.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
  }

  if (idx) {
    for (let i = 0; i < idx.count; i++) {
      dstIdx.push(baseVertex + idx.getX(i));
    }
  } else {
    for (let i = 0; i < pos.count; i++) {
      dstIdx.push(baseVertex + i);
    }
  }
}

function buildTaperedBranchGeometry(THREE, curve, rStart, rEnd, tubularSegs, radialSegs, uvScaleLen = 2.0) {
  const frames = curve.computeFrenetFrames(tubularSegs, false);
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const P = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();
  const v = new THREE.Vector3();

  for (let i = 0; i <= tubularSegs; i++) {
    const u = i / tubularSegs;
    curve.getPointAt(u, P);
    N.copy(frames.normals[i]);
    B.copy(frames.binormals[i]);

    // Slight collar swelling right at branch junction (u < 0.08)
    const collar = u < 0.08 ? 1.0 + (0.08 - u) * 3.0 : 1.0;
    const radius = (rStart + (rEnd - rStart) * Math.pow(u, 0.82)) * collar;

    for (let j = 0; j <= radialSegs; j++) {
      const vFrac = j / radialSegs;
      const theta = vFrac * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      v.x = N.x * cosT + B.x * sinT;
      v.y = N.y * cosT + B.y * sinT;
      v.z = N.z * cosT + B.z * sinT;
      v.normalize();

      positions.push(P.x + radius * v.x, P.y + radius * v.y, P.z + radius * v.z);
      normals.push(v.x, v.y, v.z);
      uvs.push(vFrac, u * uvScaleLen);
    }
  }

  const stride = radialSegs + 1;
  for (let i = 0; i < tubularSegs; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const a = i * stride + j;
      const b = (i + 1) * stride + j;
      const c = (i + 1) * stride + (j + 1);
      const d = i * stride + (j + 1);
      indices.push(a, b, d, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

export default function create(THREE, opts = {}) {
  const targetHeight = Number.isFinite(opts.height) && opts.height > 0 ? opts.height : 18.0;
  const scaleFactor = targetHeight / 18.0;
  const targetWidth = 6.0 * scaleFactor;
  const targetLength = 6.0 * scaleFactor;

  const seed = opts.seed ?? opts.id ?? 'pine_tree_1';
  const rand = makePRNG(seed);

  const group = new THREE.Group();
  group.name = opts.id ?? 'pine_tree';
  group.userData.assetType = 'tree';
  group.userData.kind = 'pine';
  group.userData.dims = {
    length: targetLength,
    width: targetWidth,
    height: targetHeight
  };

  // Materials
  const barkMaps = getBarkMaps(THREE);
  const needleMaps = getNeedleMaps(THREE);

  const barkMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: barkMaps.colorTex,
    normalMap: barkMaps.normalTex,
    normalScale: new THREE.Vector2(1.35, 1.35),
    roughness: 0.91,
    metalness: 0.0
  });

  const deadWoodMat = new THREE.MeshStandardMaterial({
    color: 0x6e655f,
    map: barkMaps.colorTex,
    roughness: 0.95,
    metalness: 0.0
  });

  const baseFoliageColor = new THREE.Color(opts.color ?? '#4a6b2c');

  const needleMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: needleMaps.colorTex,
    normalMap: needleMaps.normalTex,
    normalScale: new THREE.Vector2(0.75, 0.75),
    alphaTest: 0.42,
    side: THREE.DoubleSide,
    roughness: 0.76,
    metalness: 0.02
  });

  const coneMat = new THREE.MeshStandardMaterial({
    color: 0x5c3e26,
    roughness: 0.88,
    metalness: 0.0
  });

  // =========================================================================
  // 1. TRUNK GEOMETRY (0.45 m DBH at 1.37 m, root flare at y=0, slight S-sweep)
  // =========================================================================
  const trunkHeight = 16.95;
  const trunkSegsY = 44;
  const trunkSegsRad = 20;

  const phaseX = rand() * Math.PI * 2;
  const phaseZ = rand() * Math.PI * 2;
  const sweepAmpX = 0.09 + rand() * 0.06;
  const sweepAmpZ = 0.09 + rand() * 0.06;

  const rootCount = 5 + Math.floor(rand() * 3);
  const rootPhase = rand() * Math.PI * 2;

  const getTrunkCenter = (y) => {
    const t = Math.min(1, Math.max(0, y / trunkHeight));
    // Pinned at base (y=0), subtle organic forest bend in mid-stem, centered again near crown
    const env = Math.sin(t * Math.PI) * Math.pow(t, 0.65);
    const cx = Math.sin(t * Math.PI * 1.65 + phaseX) * sweepAmpX * env;
    const cz = Math.cos(t * Math.PI * 1.45 + phaseZ) * sweepAmpZ * env;
    return { x: cx, z: cz };
  };

  const getTrunkRadius = (y, theta) => {
    const t = Math.min(1, Math.max(0, y / trunkHeight));
    // 0.225 m radius (0.45 m DBH) at y=1.37 m
    // Flare at base (y < 1.2 m), steady taper to ~0.042 m at y=16.95 m
    let r = 0.228 * Math.pow(1.0 - 0.82 * t, 0.68);
    if (y < 1.35) {
      const f = (1.35 - y) / 1.35;
      const buttress = 0.5 + 0.5 * Math.cos(theta * rootCount + rootPhase + Math.sin(theta * 2) * 0.35);
      r += Math.pow(f, 2.2) * (0.065 + 0.065 * buttress);
    }
    // Subtle vertical bark plate relief
    const ridge = (valueNoise2D((theta / (Math.PI * 2)) * 10, t * 18, 10, 18, 307) - 0.5) * 0.012 * (1 - 0.5 * t);
    return r + ridge;
  };

  const woodPos = [];
  const woodNorm = [];
  const woodUV = [];
  const woodIdx = [];

  for (let iy = 0; iy <= trunkSegsY; iy++) {
    const v = iy / trunkSegsY;
    const y = v * trunkHeight;
    const c = getTrunkCenter(y);

    for (let ir = 0; ir <= trunkSegsRad; ir++) {
      const u = ir / trunkSegsRad;
      const theta = u * Math.PI * 2;
      const rad = getTrunkRadius(y, theta);

      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const px = c.x + rad * cosT;
      const pz = c.z + rad * sinT;

      woodPos.push(px, y, pz);
      woodNorm.push(cosT, 0.06, sinT);
      woodUV.push(u, v * 5.0);
    }
  }

  const tStride = trunkSegsRad + 1;
  for (let iy = 0; iy < trunkSegsY; iy++) {
    for (let ir = 0; ir < trunkSegsRad; ir++) {
      const a = iy * tStride + ir;
      const b = (iy + 1) * tStride + ir;
      const c = (iy + 1) * tStride + (ir + 1);
      const d = iy * tStride + (ir + 1);
      woodIdx.push(a, d, b, b, d, c);
    }
  }

  // =========================================================================
  // 2. LOWER DEAD BRANCH STUBS (Clear bole to ~10.4 m except sparse dead stubs)
  // =========================================================================
  const stubBaseGeo = getDeadStubGeometry(THREE);
  const stubMatrices = [];
  const stubCount = 11;
  const dummyObj = new THREE.Object3D();

  for (let s = 0; s < stubCount; s++) {
    const frac = s / (stubCount - 1);
    const sy = 5.4 + frac * 4.7 + (rand() - 0.5) * 0.32;
    const sAngle = s * 2.39996 + rand() * 0.65; // Golden angle spiral
    const tc = getTrunkCenter(sy);
    const tr = getTrunkRadius(sy, sAngle);

    const stubLen = 0.18 + frac * 0.34 + rand() * 0.14;
    const stubThick = 0.65 + frac * 0.45;
    // Lower stubs droop slightly (80-100 deg from vertical), higher stubs angle slightly up
    const tiltFromUp = (Math.PI * 0.48) + (0.5 - frac) * 0.24 + (rand() - 0.5) * 0.12;

    dummyObj.position.set(
      tc.x + Math.cos(sAngle) * (tr * 0.82),
      sy,
      tc.z + Math.sin(sAngle) * (tr * 0.82)
    );
    dummyObj.rotation.set(0, -sAngle + Math.PI * 0.5, 0, 'YXZ');
    dummyObj.rotateX(tiltFromUp);
    dummyObj.scale.set(stubThick, stubLen, stubThick);
    dummyObj.updateMatrix();
    stubMatrices.push(dummyObj.matrix.clone());
  }

  // =========================================================================
  // 3. CROWN ARCHITECTURE: WHORLS OF UPWARD-CURVING BRANCHES & NEEDLE TUFTS
  // =========================================================================
  // Target total horizontal radius <= 3.0 m (so X and Z width/length = 6.0 m).
  // Since foliage tufts extend ~0.48 m radially beyond branch tips, branch tips
  // reach up to ~2.52 m in the widest mid-crown whorls.
  const whorls = [
    { y: 10.65, count: 4, minReach: 1.78, maxReach: 2.15, droop: -0.22, lift: 0.42, rBase: 0.072, subCount: 2, tuftScale: 0.88 },
    { y: 12.15, count: 5, minReach: 2.28, maxReach: 2.52, droop: -0.14, lift: 0.58, rBase: 0.078, subCount: 3, tuftScale: 0.96 },
    { y: 13.70, count: 5, minReach: 2.22, maxReach: 2.50, droop: -0.05, lift: 0.72, rBase: 0.072, subCount: 3, tuftScale: 1.00 },
    { y: 15.15, count: 5, minReach: 1.80, maxReach: 2.16, droop:  0.08, lift: 0.82, rBase: 0.062, subCount: 2, tuftScale: 0.95 },
    { y: 16.25, count: 4, minReach: 1.15, maxReach: 1.52, droop:  0.18, lift: 0.78, rBase: 0.048, subCount: 2, tuftScale: 0.90 }
  ];

  // Guarantee exact 6.0 m X and Z span by anchoring the 4 cardinal directions on the two widest whorls
  const cardinalAngles = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];

  const tuftEntries = []; // { pos: Vector3, dir: Vector3, scale: Vector3, shade: number }
  const coneMatrices = [];
  const upVec = new THREE.Vector3(0, 1, 0);

  const registerTuftCluster = (tipPos, branchDir, baseScale, isCrownTop = false) => {
    // Each branch/twig tip gets a tight compound cluster of 3-4 overlapping needle bursts
    const burstCount = isCrownTop ? 4 : 3;
    for (let b = 0; b < burstCount; b++) {
      const splayAngle = (b / burstCount) * Math.PI * 2 + rand() * 0.8;
      const radialOff = b === 0 ? 0.0 : (0.11 + rand() * 0.07) * baseScale;

      // Orthogonal basis around upward-Sweeping shoot direction
      const shootDir = branchDir.clone().lerp(upVec, isCrownTop ? 0.72 : 0.58).normalize();
      const side1 = new THREE.Vector3(-shootDir.z, 0, shootDir.x);
      if (side1.lengthSq() < 0.001) side1.set(1, 0, 0);
      side1.normalize();
      const side2 = new THREE.Vector3().crossVectors(shootDir, side1).normalize();

      const offsetPos = tipPos.clone()
        .addScaledVector(side1, Math.cos(splayAngle) * radialOff)
        .addScaledVector(side2, Math.sin(splayAngle) * radialOff)
        .addScaledVector(shootDir, b === 0 ? 0.02 : -0.04);

      const burstDir = shootDir.clone()
        .addScaledVector(side1, Math.cos(splayAngle) * (b === 0 ? 0.06 : 0.34))
        .addScaledVector(side2, Math.sin(splayAngle) * (b === 0 ? 0.06 : 0.34))
        .normalize();

      const sc = baseScale * (0.90 + rand() * 0.22);
      const heightRatio = Math.min(1, Math.max(0, (offsetPos.y - 10.2) / 7.8));
      const shade = 0.82 + 0.26 * heightRatio + (rand() - 0.5) * 0.14;

      tuftEntries.push({
        pos: offsetPos,
        dir: burstDir,
        scale: new THREE.Vector3(sc * 1.06, sc * 0.96, sc * 1.06),
        shade
      });
    }

    // Add 1-2 pendant pinecones under mature twigs
    if (rand() < 0.68) {
      const coneCount = rand() < 0.35 ? 2 : 1;
      for (let c = 0; c < coneCount; c++) {
        dummyObj.position.copy(tipPos).add(new THREE.Vector3(
          (rand() - 0.5) * 0.08,
          -0.03 - rand() * 0.03,
          (rand() - 0.5) * 0.08
        ));
        dummyObj.rotation.set(
          (rand() - 0.5) * 0.45,
          rand() * Math.PI * 2,
          (rand() - 0.5) * 0.45
        );
        const cs = 0.85 + rand() * 0.35;
        dummyObj.scale.set(cs, cs, cs);
        dummyObj.updateMatrix();
        coneMatrices.push(dummyObj.matrix.clone());
      }
    }
  };

  for (let wIdx = 0; wIdx < whorls.length; wIdx++) {
    const w = whorls[wIdx];
    const whorlAzimuthOffset = wIdx * 1.15 + (rand() - 0.5) * 0.35;

    for (let b = 0; b < w.count; b++) {
      let az;
      let reach;
      // Pin cardinal extremities on mid whorls (wIdx 1 & 2) so X and Z crown spans hit ~6.0 m cleanly
      if ((wIdx === 1 || wIdx === 2) && b < 2) {
        const cardIdx = (wIdx - 1) * 2 + b; // 0, 1, 2, 3 -> +X, +Z, -X, -Z
        az = cardinalAngles[cardIdx] + (rand() - 0.5) * 0.08;
        reach = 2.48 + rand() * 0.04;
      } else {
        az = whorlAzimuthOffset + (b / w.count) * Math.PI * 2 + (rand() - 0.5) * 0.36;
        reach = w.minReach + rand() * (w.maxReach - w.minReach);
      }

      const bY = w.y + (rand() - 0.5) * 0.32;
      const tc = getTrunkCenter(bY);
      const tr = getTrunkRadius(bY, az);

      const cosA = Math.cos(az);
      const sinA = Math.sin(az);
      const orthoX = -sinA;
      const orthoZ = cosA;

      const p0 = new THREE.Vector3(tc.x + cosA * (tr * 0.72), bY, tc.z + sinA * (tr * 0.72));
      const crook1 = (rand() - 0.5) * 0.24;
      const crook2 = (rand() - 0.5) * 0.28;

      const p1 = new THREE.Vector3(
        tc.x + cosA * (reach * 0.36) + orthoX * crook1,
        bY + w.droop * 0.65 + (rand() - 0.5) * 0.12,
        tc.z + sinA * (reach * 0.36) + orthoZ * crook1
      );
      const p2 = new THREE.Vector3(
        tc.x + cosA * (reach * 0.74) + orthoX * crook2,
        bY + w.droop + w.lift * 0.42,
        tc.z + sinA * (reach * 0.74) + orthoZ * crook2
      );
      // Upward-hooking terminal tip characteristic of Southern Pine limbs
      const p3 = new THREE.Vector3(
        tc.x + cosA * reach,
        bY + w.lift,
        tc.z + sinA * reach
      );

      const branchCurve = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);
      const branchGeo = buildTaperedBranchGeometry(THREE, branchCurve, w.rBase, 0.015, 10, 6, 2.5);
      appendGeometry(woodPos, woodNorm, woodUV, woodIdx, branchGeo);
      branchGeo.dispose();

      const tipTangent = branchCurve.getTangent(1.0);
      registerTuftCluster(p3, tipTangent, w.tuftScale, false);

      // Secondary lateral sub-branches forking off the primary limb
      for (let s = 0; s < w.subCount; s++) {
        const splitT = 0.38 + (s / w.subCount) * 0.36 + (rand() - 0.5) * 0.06;
        const sp0 = branchCurve.getPointAt(splitT);
        const sideSign = (s % 2 === 0 ? 1 : -1);
        const subAngle = az + sideSign * (0.48 + rand() * 0.32);
        const subLen = (0.55 + rand() * 0.35) * (1.0 - splitT * 0.35);

        const sCos = Math.cos(subAngle);
        const sSin = Math.sin(subAngle);

        const sp1 = new THREE.Vector3(
          sp0.x + sCos * (subLen * 0.52),
          sp0.y + 0.05 + rand() * 0.10,
          sp0.z + sSin * (subLen * 0.52)
        );
        const sp2 = new THREE.Vector3(
          sp0.x + sCos * subLen,
          sp0.y + 0.28 + rand() * 0.18,
          sp0.z + sSin * subLen
        );

        // Clamp horizontal distance of secondary branch tips inside 2.50 m so crown never overflows 6.0 m
        const hDist = Math.hypot(sp2.x, sp2.z);
        if (hDist > 2.48) {
          const clampRatio = 2.48 / hDist;
          sp2.x *= clampRatio;
          sp2.z *= clampRatio;
        }

        const subCurve = new THREE.CatmullRomCurve3([sp0, sp1, sp2]);
        const rSubStart = w.rBase * (1.0 - splitT * 0.55) * 0.72;
        const subGeo = buildTaperedBranchGeometry(THREE, subCurve, rSubStart, 0.012, 6, 5, 1.4);
        appendGeometry(woodPos, woodNorm, woodUV, woodIdx, subGeo);
        subGeo.dispose();

        registerTuftCluster(sp2, subCurve.getTangent(1.0), w.tuftScale * 0.88, false);
      }
    }
  }

  // =========================================================================
  // 4. APICAL FLAT-ROUNDED UMBRELLA CROWN TOP (reaches y = 18.0 m)
  // =========================================================================
  const topCenter = getTrunkCenter(trunkHeight);
  const topSpurs = 5;
  for (let t = 0; t < topSpurs; t++) {
    const az = (t / topSpurs) * Math.PI * 2 + rand() * 0.4;
    const reach = (t === 0) ? 0.22 : (0.68 + rand() * 0.32);
    const tipY = (t === 0) ? 17.22 : (17.05 + rand() * 0.16);

    const p0 = new THREE.Vector3(topCenter.x, trunkHeight - 0.15, topCenter.z);
    const p1 = new THREE.Vector3(
      topCenter.x + Math.cos(az) * (reach * 0.55),
      trunkHeight + 0.05,
      topCenter.z + Math.sin(az) * (reach * 0.55)
    );
    const p2 = new THREE.Vector3(
      topCenter.x + Math.cos(az) * reach,
      tipY,
      topCenter.z + Math.sin(az) * reach
    );

    const topCurve = new THREE.CatmullRomCurve3([p0, p1, p2]);
    const topGeo = buildTaperedBranchGeometry(THREE, topCurve, 0.040, 0.014, 6, 5, 1.2);
    appendGeometry(woodPos, woodNorm, woodUV, woodIdx, topGeo);
    topGeo.dispose();

    registerTuftCluster(p2, topCurve.getTangent(1.0), 0.96, true);
  }

  // Build unified Trunk + Living Branches Mesh
  const woodGeo = new THREE.BufferGeometry();
  woodGeo.setAttribute('position', new THREE.Float32BufferAttribute(woodPos, 3));
  woodGeo.setAttribute('normal', new THREE.Float32BufferAttribute(woodNorm, 3));
  woodGeo.setAttribute('uv', new THREE.Float32BufferAttribute(woodUV, 2));
  woodGeo.setIndex(woodIdx);

  const trunkAndBranchesMesh = new THREE.Mesh(woodGeo, barkMat);
  trunkAndBranchesMesh.name = 'trunk_and_limbs';
  trunkAndBranchesMesh.castShadow = true;
  trunkAndBranchesMesh.receiveShadow = true;
  group.add(trunkAndBranchesMesh);

  // Build InstancedMesh for Dead Lower Stubs
  const stubInstanced = new THREE.InstancedMesh(stubBaseGeo, deadWoodMat, stubMatrices.length);
  stubInstanced.name = 'dead_branch_stubs';
  stubInstanced.castShadow = true;
  stubInstanced.receiveShadow = true;
  for (let i = 0; i < stubMatrices.length; i++) {
    stubInstanced.setMatrixAt(i, stubMatrices[i]);
  }
  stubInstanced.instanceMatrix.needsUpdate = true;
  group.add(stubInstanced);

  // Build InstancedMesh for Pinecones
  if (coneMatrices.length > 0) {
    const coneGeo = getPineconeGeometry(THREE);
    const coneInstanced = new THREE.InstancedMesh(coneGeo, coneMat, coneMatrices.length);
    coneInstanced.name = 'pine_cones';
    coneInstanced.castShadow = true;
    coneInstanced.receiveShadow = true;
    for (let i = 0; i < coneMatrices.length; i++) {
      coneInstanced.setMatrixAt(i, coneMatrices[i]);
    }
    coneInstanced.instanceMatrix.needsUpdate = true;
    group.add(coneInstanced);
  }

  // Build InstancedMesh for Needle Tuft Clusters
  const tuftGeo = getTuftBaseGeometry(THREE);
  const tuftInstanced = new THREE.InstancedMesh(tuftGeo, needleMat, tuftEntries.length);
  tuftInstanced.name = 'needle_tufts';
  tuftInstanced.castShadow = true;
  tuftInstanced.receiveShadow = true;

  const qOrient = new THREE.Quaternion();
  const qSpin = new THREE.Quaternion();
  const instColor = new THREE.Color();
  const hsl = { h: 0, s: 0, l: 0 };
  baseFoliageColor.getHSL(hsl);

  for (let i = 0; i < tuftEntries.length; i++) {
    const entry = tuftEntries[i];
    qOrient.setFromUnitVectors(upVec, entry.dir);
    qSpin.setFromAxisAngle(upVec, (i * 1.6180339) * Math.PI * 2);
    qOrient.multiply(qSpin);

    dummyObj.position.copy(entry.pos);
    dummyObj.quaternion.copy(qOrient);
    dummyObj.scale.copy(entry.scale);
    dummyObj.updateMatrix();
    tuftInstanced.setMatrixAt(i, dummyObj.matrix);

    // Subtle per-cluster hue/lightness variation (sunlit yellow-green tips vs shaded inner olive)
    const hShift = ((i % 7) - 3) * 0.008;
    const sShift = ((i % 5) - 2) * 0.02;
    const lMult = entry.shade;
    instColor.setHSL(
      Math.max(0, Math.min(1, hsl.h + hShift)),
      Math.max(0.15, Math.min(0.95, hsl.s + sShift)),
      Math.max(0.18, Math.min(0.78, hsl.l * 1.45 * lMult))
    );
    tuftInstanced.setColorAt(i, instColor);
  }
  tuftInstanced.instanceMatrix.needsUpdate = true;
  if (tuftInstanced.instanceColor) tuftInstanced.instanceColor.needsUpdate = true;
  group.add(tuftInstanced);

  // =========================================================================
  // 5. EXACT BOUNDING-BOX CALIBRATION TO TARGET (6m × 6m × 18m scaled)
  // =========================================================================
  // Compute exact unscaled bounding box across all vertex and instanced geometry
  group.updateMatrixWorld(true);
  const fullBox = new THREE.Box3();
  const tempBox = new THREE.Box3();
  const tempMat = new THREE.Matrix4();

  group.traverse((child) => {
    if (child.isInstancedMesh) {
      if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
      const gBox = child.geometry.boundingBox;
      for (let i = 0; i < child.count; i++) {
        child.getMatrixAt(i, tempMat);
        tempBox.copy(gBox).applyMatrix4(tempMat);
        fullBox.union(tempBox);
      }
    } else if (child.isMesh && child.geometry) {
      if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
      tempBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrix);
      fullBox.union(tempBox);
    }
  });

  const rawWidth = (fullBox.max.x - fullBox.min.x) || 6.0;
  const rawHeight = (fullBox.max.y - fullBox.min.y) || 18.0;
  const rawLength = (fullBox.max.z - fullBox.min.z) || 6.0;

  // Normalize subtle seed variations so rendered bbox hits target (6m x 6m x 18m * scaleFactor) to within <1%
  const sx = targetWidth / rawWidth;
  const sy = targetHeight / rawHeight;
  const sz = targetLength / rawLength;

  for (let i = 0; i < group.children.length; i++) {
    const child = group.children[i];
    child.scale.set(sx, sy, sz);
    child.position.y = -fullBox.min.y * sy;
  }

  return group;
}
