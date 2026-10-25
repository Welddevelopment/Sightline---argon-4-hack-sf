const CACHE = {
  geos: null,
  mats: null,
  tex: null
};

function createTextures(THREE) {
  if (CACHE.tex) return CACHE.tex;
  CACHE.tex = {};

  // 1. All-terrain tire tread normal/bump/color data texture (works in Node & Browser)
  const tw = 128, th = 128;
  const treadData = new Uint8Array(tw * th * 4);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const idx = (y * tw + x) * 4;
      const u = x / tw;
      const v = y / th;
      // 4 circumferential ribs + shoulder lugs
      let lug = 40;
      const rib1 = Math.abs(u - 0.12) < 0.07;
      const rib2 = Math.abs(u - 0.36) < 0.09;
      const rib3 = Math.abs(u - 0.64) < 0.09;
      const rib4 = Math.abs(u - 0.88) < 0.07;
      const blockPhase = ((y + (x > 64 ? 6 : 0)) % 16) < 11;
      const shoulderPhase = ((y + (u < 0.5 ? 0 : 8)) % 16) < 10;
      if ((rib2 || rib3) && blockPhase) lug = 58;
      if ((rib1 || rib4) && shoulderPhase) lug = 62;
      treadData[idx] = lug;
      treadData[idx + 1] = lug;
      treadData[idx + 2] = lug + 2;
      treadData[idx + 3] = 255;
    }
  }
  const treadTex = new THREE.DataTexture(treadData, tw, th);
  treadTex.wrapS = THREE.RepeatWrapping;
  treadTex.wrapT = THREE.RepeatWrapping;
  treadTex.repeat.set(1, 14);
  treadTex.colorSpace = THREE.SRGBColorSpace;
  treadTex.needsUpdate = true;
  CACHE.tex.tread = treadTex;

  // 2. Grille mesh & bedliner ribs texture
  const gw = 128, gh = 128;
  const grilleData = new Uint8Array(gw * gh * 4);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const idx = (y * gw + x) * 4;
      const cellX = (x % 16) - 8;
      const cellY = (y % 8) - 4;
      const dist = Math.abs(cellX) * 0.6 + Math.abs(cellY);
      const v = dist > 4.2 ? 65 : 15;
      grilleData[idx] = v;
      grilleData[idx + 1] = v;
      grilleData[idx + 2] = v + 3;
      grilleData[idx + 3] = 255;
    }
  }
  const grilleTex = new THREE.DataTexture(grilleData, gw, gh);
  grilleTex.wrapS = THREE.RepeatWrapping;
  grilleTex.wrapT = THREE.RepeatWrapping;
  grilleTex.repeat.set(6, 3);
  grilleTex.colorSpace = THREE.SRGBColorSpace;
  grilleTex.needsUpdate = true;
  CACHE.tex.grille = grilleTex;

  return CACHE.tex;
}

function getBaseMaterials(THREE) {
  if (CACHE.mats) return CACHE.mats;
  const tex = createTextures(THREE);

  CACHE.mats = {
    chrome: new THREE.MeshStandardMaterial({
      color: 0xf2f4f7,
      metalness: 0.96,
      roughness: 0.12
    }),
    brushedAlloy: new THREE.MeshStandardMaterial({
      color: 0xc8cdd2,
      metalness: 0.85,
      roughness: 0.25
    }),
    darkAlloy: new THREE.MeshStandardMaterial({
      color: 0x3a3e44,
      metalness: 0.78,
      roughness: 0.32
    }),
    blackPlastic: new THREE.MeshStandardMaterial({
      color: 0x1c1e21,
      metalness: 0.05,
      roughness: 0.78
    }),
    glossBlack: new THREE.MeshPhysicalMaterial({
      color: 0x0c0e10,
      metalness: 0.2,
      roughness: 0.12,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06
    }),
    bedliner: new THREE.MeshStandardMaterial({
      color: 0x1e2024,
      metalness: 0.08,
      roughness: 0.92
    }),
    grilleMesh: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: tex.grille,
      metalness: 0.35,
      roughness: 0.55
    }),
    rubber: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: tex.tread,
      metalness: 0.04,
      roughness: 0.88
    }),
    sidewall: new THREE.MeshStandardMaterial({
      color: 0x1f2124,
      metalness: 0.05,
      roughness: 0.82
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x0d151c,
      metalness: 0.1,
      roughness: 0.05,
      transparent: true,
      opacity: 0.52,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04
    }),
    clearLens: new THREE.MeshPhysicalMaterial({
      color: 0xeaf4ff,
      metalness: 0.1,
      roughness: 0.06,
      transparent: true,
      opacity: 0.42,
      clearcoat: 1.0
    }),
    amberMarker: new THREE.MeshStandardMaterial({
      color: 0xff8c00,
      emissive: 0xff6a00,
      emissiveIntensity: 0.25,
      roughness: 0.2,
      metalness: 0.1
    }),
    mirrorGlass: new THREE.MeshStandardMaterial({
      color: 0xd8e2ec,
      metalness: 0.98,
      roughness: 0.04
    }),
    interiorDark: new THREE.MeshStandardMaterial({
      color: 0x181a1e,
      metalness: 0.05,
      roughness: 0.85
    }),
    seatLeather: new THREE.MeshStandardMaterial({
      color: 0x24272c,
      metalness: 0.08,
      roughness: 0.65
    }),
    chassis: new THREE.MeshStandardMaterial({
      color: 0x141618,
      metalness: 0.25,
      roughness: 0.8
    }),
    brakeDisc: new THREE.MeshStandardMaterial({
      color: 0x9aa0a6,
      metalness: 0.82,
      roughness: 0.35
    }),
    caliper: new THREE.MeshStandardMaterial({
      color: 0x454a50,
      metalness: 0.6,
      roughness: 0.45
    }),
    plateWhite: new THREE.MeshStandardMaterial({
      color: 0xe8ecf0,
      metalness: 0.1,
      roughness: 0.4
    }),
    reflectorRed: new THREE.MeshStandardMaterial({
      color: 0x990a10,
      metalness: 0.35,
      roughness: 0.2
    })
  };
  return CACHE.mats;
}

// Helper: build a smooth lofted skin from a list of Z-stations.
// Each station: { z, pts: [[x0,y0], [x1,y1], ...] } where all stations have equal pts.length.
function buildLoftGeometry(THREE, stations, closeStart = false, closeEnd = false) {
  const numStations = stations.length;
  const numPts = stations[0].pts.length;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i < numStations; i++) {
    const st = stations[i];
    const v = i / Math.max(1, numStations - 1);
    for (let j = 0; j < numPts; j++) {
      const [x, y] = st.pts[j];
      positions.push(x, y, st.z);
      uvs.push(j / Math.max(1, numPts - 1), v);
    }
  }

  for (let i = 0; i < numStations - 1; i++) {
    for (let j = 0; j < numPts - 1; j++) {
      const a = i * numPts + j;
      const b = (i + 1) * numPts + j;
      const c = (i + 1) * numPts + (j + 1);
      const d = i * numPts + (j + 1);
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  if (closeStart) {
    const centerIdx = positions.length / 3;
    let cx = 0, cy = 0;
    for (let j = 0; j < numPts; j++) {
      cx += stations[0].pts[j][0];
      cy += stations[0].pts[j][1];
    }
    cx /= numPts;
    cy /= numPts;
    positions.push(cx, cy, stations[0].z);
    uvs.push(0.5, 0);
    for (let j = 0; j < numPts - 1; j++) {
      indices.push(centerIdx, j + 1, j);
    }
  }

  if (closeEnd) {
    const centerIdx = positions.length / 3;
    const last = numStations - 1;
    const base = last * numPts;
    let cx = 0, cy = 0;
    for (let j = 0; j < numPts; j++) {
      cx += stations[last].pts[j][0];
      cy += stations[last].pts[j][1];
    }
    cx /= numPts;
    cy /= numPts;
    positions.push(cx, cy, stations[last].z);
    uvs.push(0.5, 1);
    for (let j = 0; j < numPts - 1; j++) {
      indices.push(centerIdx, base + j, base + j + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Helper: create symmetrical cross-section points from right-side profile (bottom-center -> right side -> top-center)
// rightProfile = [[x0, y0], [x1, y1], ..., [xn, yn]] where x0 >= 0 and xn >= 0
function makeSymSection(rightProfile) {
  const pts = [];
  // Left side (reversed, negated X)
  for (let i = rightProfile.length - 1; i >= 0; i--) {
    const [x, y] = rightProfile[i];
    if (i === 0 && Math.abs(x) < 1e-5) continue; // avoid duplicate center point
    pts.push([-x, y]);
  }
  // Right side
  for (let i = 0; i < rightProfile.length; i++) {
    const [x, y] = rightProfile[i];
    if (i === rightProfile.length - 1 && Math.abs(x) < 1e-5) {
      pts.push([0, y]);
    } else {
      pts.push([x, y]);
    }
  }
  return pts;
}

// Helper: rounded box via ExtrudeGeometry along Z
function makeRoundedBox(THREE, w, h, d, r, bevel = 0.015) {
  const hw = Math.max(0.001, w / 2 - bevel);
  const hh = Math.max(0.001, h / 2 - bevel);
  const rad = Math.min(r, hw * 0.9, hh * 0.9);
  const s = new THREE.Shape();
  s.moveTo(-hw + rad, -hh);
  s.lineTo(hw - rad, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + rad);
  s.lineTo(hw, hh - rad);
  s.quadraticCurveTo(hw, hh, hw - rad, hh);
  s.lineTo(-hw + rad, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - rad);
  s.lineTo(-hw, -hh + rad);
  s.quadraticCurveTo(-hw, -hh, -hw + rad, -hh);

  const depth = Math.max(0.002, d - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 6
  });
  geo.translate(0, 0, -depth / 2);
  geo.computeVertexNormals();
  return geo;
}

// Helper: Wheel arch cutout curve Y(z) around axleCenterZ
function archHeight(z, axleZ, radius = 0.46, flatTop = 0.14, baseSill = 0.36, peakY = 0.89) {
  const dz = Math.abs(z - axleZ);
  if (dz <= flatTop) return peakY;
  const span = radius - flatTop;
  if (dz >= radius) return baseSill;
  const t = (dz - flatTop) / span;
  const c = Math.cos(t * Math.PI * 0.5);
  return baseSill + (peakY - baseSill) * (c * c);
}

function buildCabGeometry(THREE) {
  // Cab spans from front grille surround Z = -2.80 to cab rear wall Z = +0.92
  // Wheel arch centered at front axle Z = -1.97
  // Cross section has 15 points on right half (bottom sill -> lower door -> feature crease -> shoulder -> beltline -> pillar/glass -> roof rail -> roof center)
  const zList = [
    -2.80, -2.72, -2.55, -2.35, -2.12, -1.97, -1.82, -1.60,
    -1.35, -1.25, -1.05, -0.78, -0.65, -0.10, 0.45, 0.84, 0.92
  ];

  const stations = [];
  for (const z of zList) {
    // Sill bottom height (raised over front wheel arch)
    const sillY = archHeight(z, -1.97, 0.49, 0.14, 0.36, 0.90);
    const flare = (z > -2.44 && z < -1.50) ? 0.025 : 0.0;

    // Width taper at very front nose
    let noseTaper = 1.0;
    if (z < -2.40) {
      const t = (-2.40 - z) / 0.40;
      noseTaper = 1.0 - 0.065 * t * t;
    }

    // Hood / Roof height & greenhouse profile
    let beltY = 1.31;
    let hoodCenterY = 1.32;
    let roofEdgeY = 1.315;
    let roofCenterY = 1.33;
    let upperW = 0.86 * noseTaper;

    if (z <= -1.25) {
      // Hood region (Z = -2.80 to -1.25)
      const t = (z - (-2.80)) / (-1.25 - (-2.80)); // 0 at front, 1 at cowl
      const smooth = t * t * (3 - 2 * t);
      beltY = 1.21 + 0.10 * smooth;
      roofEdgeY = 1.23 + 0.10 * smooth;
      roofCenterY = 1.255 + 0.095 * smooth; // power dome center
      upperW = (0.83 + 0.06 * smooth) * noseTaper;
    } else if (z <= -0.65) {
      // Windshield ramp (Z = -1.25 to -0.65)
      const t = (z - (-1.25)) / (-0.65 - (-1.25)); // 0 at cowl, 1 at roof header
      const smooth = t * t * (3 - 2 * t);
      beltY = 1.31 + 0.01 * t;
      roofEdgeY = 1.33 + (1.865 - 1.33) * smooth;
      roofCenterY = 1.35 + (1.898 - 1.35) * smooth;
      upperW = 0.89 - (0.89 - 0.76) * smooth;
    } else if (z <= 0.84) {
      // Crew cab roof (Z = -0.65 to +0.84)
      beltY = 1.32;
      roofEdgeY = 1.87;
      roofCenterY = 1.90;
      upperW = 0.76;
    } else {
      // Rear cab corner radius (Z = +0.84 to +0.92)
      const t = (z - 0.84) / 0.08;
      beltY = 1.32;
      roofEdgeY = 1.87 - 0.035 * t;
      roofCenterY = 1.90 - 0.035 * t;
      upperW = 0.76 - 0.02 * t;
    }

    const bodyHalfW = Math.min(0.995, (0.975 + flare) * noseTaper);
    const midY1 = sillY + (beltY - sillY) * 0.25;
    const midY2 = sillY + (beltY - sillY) * 0.62;
    const shoulderY = beltY - 0.06;

    const glassMidY = beltY + (roofEdgeY - beltY) * 0.52;
    const glassMidW = (bodyHalfW * 0.94 + upperW) * 0.50;

    const rightProfile = [
      [0.0, 0.36],                                // underbody center
      [0.72 * noseTaper, 0.36],                   // inner rocker
      [0.91 * noseTaper, sillY],                  // lower rocker pinch
      [bodyHalfW * 0.97, midY1],                  // lower door flare
      [bodyHalfW, midY2],                         // main door skin max width
      [bodyHalfW * 0.985, shoulderY],             // upper feature crease
      [0.92 * noseTaper, beltY],                  // window beltline / fender top outer
      [Math.min(0.90 * noseTaper, glassMidW), glassMidY], // A/B/C pillar / hood bevel
      [upperW, roofEdgeY],                        // roof rail / hood power-dome edge
      [upperW * 0.62, roofCenterY - 0.005],       // roof rib outer
      [upperW * 0.28, roofCenterY],               // roof rib inner
      [0.0, roofCenterY]                          // top centerline
    ];

    stations.push({ z, pts: makeSymSection(rightProfile) });
  }

  return buildLoftGeometry(THREE, stations, true, true);
}

function buildBedSideGeometry(THREE, sideSign = 1) {
  // Cargo bed outer side skin + top rail + inner wall for one side (+1 right, -1 left)
  // Bed spans Z = +0.95 to Z = +2.86
  // Rear axle centered at Z = +1.71
  const zList = [
    0.95, 1.00, 1.18, 1.32, 1.50, 1.71, 1.92, 2.10, 2.28, 2.55, 2.78, 2.86
  ];

  const stations = [];
  for (const z of zList) {
    const sillY = archHeight(z, 1.71, 0.49, 0.14, 0.38, 0.90);
    const flare = (z > 1.24 && z < 2.18) ? 0.024 : 0.0;
    let rearTaper = 1.0;
    if (z > 2.68) {
      const t = (z - 2.68) / 0.18;
      rearTaper = 1.0 - 0.03 * t * t;
    }

    const outerW = Math.min(0.995, (0.975 + flare) * rearTaper);
    const railTopY = 1.315;
    const innerWallX = 0.825;
    const bedFloorY = 0.72;

    const midY1 = sillY + (railTopY - sillY) * 0.28;
    const midY2 = sillY + (railTopY - sillY) * 0.65;
    const shoulderY = railTopY - 0.06;

    // Closed loop around the bed side wall cross-section
    const loopPts = [
      [innerWallX, bedFloorY],
      [0.88 * rearTaper, sillY],
      [outerW * 0.97, midY1],
      [outerW, midY2],
      [outerW * 0.985, shoulderY],
      [0.925 * rearTaper, railTopY],
      [innerWallX + 0.015, railTopY],
      [innerWallX, railTopY - 0.03],
      [innerWallX, bedFloorY]
    ];

    const pts = sideSign > 0
      ? loopPts
      : loopPts.slice().reverse().map(([x, y]) => [-x, y]);

    stations.push({ z, pts });
  }

  return buildLoftGeometry(THREE, stations, true, true);
}

function buildFenderFlareGeometry(THREE, axleZ, sideSign = 1) {
  // 3D sculpted wheel arch flare lip wrapping around the wheel opening
  const steps = 20;
  const rInner = 0.445;
  const rOuter = 0.505;
  const baseY = 0.37;
  const stations = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang = Math.PI * (1 - t); // PI (front) to 0 (rear)
    // Flatten the top slightly like modern trucks
    const cosA = Math.cos(ang);
    const sinA = Math.min(1.0, Math.sin(ang) * 1.12);

    const zIn = axleZ - cosA * rInner;
    const yIn = baseY + sinA * 0.51;
    const zOut = axleZ - cosA * rOuter;
    const yOut = baseY + sinA * 0.555;

    const xBase = 0.955;
    const xLip = 0.996;

    // 4-point cross section at angle ang
    const profile = [
      [xBase - 0.05, yIn - 0.01, zIn],
      [xLip, yIn + 0.005, zIn],
      [xLip + 0.003, yOut - 0.015, zOut],
      [xBase - 0.01, yOut, zOut]
    ];

    stations.push(profile.map(([x, y, z]) => [sideSign * x, y, z]));
  }

  const positions = [];
  const indices = [];
  const nPts = 4;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j < nPts; j++) {
      const [x, y, z] = stations[i][j];
      positions.push(x, y, z);
    }
  }
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < nPts - 1; j++) {
      const a = i * nPts + j;
      const b = (i + 1) * nPts + j;
      const c = (i + 1) * nPts + (j + 1);
      const d = i * nPts + (j + 1);
      if (sideSign > 0) {
        indices.push(a, b, d, b, c, d);
      } else {
        indices.push(a, d, b, b, d, c);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function buildWheelGeometries(THREE) {
  // Tire: 275/65R18 -> outer radius 0.41m, rim radius 0.235m, width 0.275m
  // 1. Tire profile (Lathe around X axis -> we lathe around Y then rotateZ(-PI/2))
  const hw = 0.275 / 2;
  const rRim = 0.235;
  const rOuter = 0.410;

  const tirePts = [
    new THREE.Vector2(rRim, -hw * 0.78),
    new THREE.Vector2(rRim + 0.025, -hw * 0.92),
    new THREE.Vector2(rRim + 0.085, -hw),
    new THREE.Vector2(rOuter - 0.035, -hw * 0.98),
    new THREE.Vector2(rOuter - 0.010, -hw * 0.88),
    new THREE.Vector2(rOuter, -hw * 0.72),
    new THREE.Vector2(rOuter, hw * 0.72),
    new THREE.Vector2(rOuter - 0.010, hw * 0.88),
    new THREE.Vector2(rOuter - 0.035, hw * 0.98),
    new THREE.Vector2(rRim + 0.085, hw),
    new THREE.Vector2(rRim + 0.025, hw * 0.92),
    new THREE.Vector2(rRim, hw * 0.78)
  ];
  const tireGeo = new THREE.LatheGeometry(tirePts, 40);
  tireGeo.rotateZ(Math.PI / 2);
  tireGeo.computeVertexNormals();

  // 2. Alloy rim barrel + outer lip + inner hub
  const rimPts = [
    new THREE.Vector2(0.001, 0.055),
    new THREE.Vector2(0.065, 0.055),
    new THREE.Vector2(0.072, 0.035),
    new THREE.Vector2(0.195, 0.045),
    new THREE.Vector2(0.215, 0.095),
    new THREE.Vector2(rRim + 0.005, 0.108),
    new THREE.Vector2(rRim + 0.005, 0.095),
    new THREE.Vector2(0.205, 0.025),
    new THREE.Vector2(0.205, -0.095),
    new THREE.Vector2(rRim, -0.105)
  ];
  const rimBarrelGeo = new THREE.LatheGeometry(rimPts, 36);
  rimBarrelGeo.rotateZ(Math.PI / 2);
  rimBarrelGeo.computeVertexNormals();

  // 3. Single spoke + lug nut geometry
  const spokeGeo = makeRoundedBox(THREE, 0.024, 0.145, 0.036, 0.006, 0.004);
  const lugGeo = new THREE.CylinderGeometry(0.010, 0.010, 0.022, 6);
  lugGeo.rotateZ(Math.PI / 2);

  // 4. Brake disc & caliper
  const discGeo = new THREE.CylinderGeometry(0.175, 0.175, 0.026, 32);
  discGeo.rotateZ(Math.PI / 2);
  const caliperGeo = makeRoundedBox(THREE, 0.065, 0.13, 0.085, 0.015, 0.006);

  return { tireGeo, rimBarrelGeo, spokeGeo, lugGeo, discGeo, caliperGeo };
}

function getCachedGeometries(THREE) {
  if (CACHE.geos) return CACHE.geos;

  const cabGeo = buildCabGeometry(THREE);
  const bedRightGeo = buildBedSideGeometry(THREE, 1);
  const bedLeftGeo = buildBedSideGeometry(THREE, -1);

  const flareFL = buildFenderFlareGeometry(THREE, -1.97, -1);
  const flareFR = buildFenderFlareGeometry(THREE, -1.97, 1);
  const flareRL = buildFenderFlareGeometry(THREE, 1.71, -1);
  const flareRR = buildFenderFlareGeometry(THREE, 1.71, 1);

  const wheelGeos = buildWheelGeometries(THREE);

  CACHE.geos = {
    cabGeo,
    bedRightGeo,
    bedLeftGeo,
    flareFL,
    flareFR,
    flareRL,
    flareRR,
    ...wheelGeos
  };
  return CACHE.geos;
}

function addMesh(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, name = '') {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (rx || ry || rz) m.rotation.set(rx, ry, rz);
  if (name) m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function createWheelAssembly(THREE, geos, mats, isLeft) {
  const wheelGroup = new THREE.Group();
  const s = isLeft ? -1 : 1;

  // Tire
  const tire = new THREE.Mesh(geos.tireGeo, mats.rubber);
  tire.castShadow = true;
  tire.receiveShadow = true;
  wheelGroup.add(tire);

  // Rim barrel (flip X so outer face points outward)
  const rim = new THREE.Mesh(geos.rimBarrelGeo, mats.brushedAlloy);
  rim.scale.x = s;
  rim.castShadow = true;
  rim.receiveShadow = true;
  wheelGroup.add(rim);

  // 6 Twin-spokes & 6 lug nuts
  for (let i = 0; i < 6; i++) {
    const baseAngle = (i / 6) * Math.PI * 2;
    for (const offset of [-0.14, 0.14]) {
      const a = baseAngle + offset;
      const rMid = 0.142;
      const spoke = new THREE.Mesh(geos.spokeGeo, mats.brushedAlloy);
      spoke.position.set(s * 0.082, Math.cos(a) * rMid, Math.sin(a) * rMid);
      spoke.rotation.x = -a;
      spoke.castShadow = true;
      spoke.receiveShadow = true;
      wheelGroup.add(spoke);
    }

    const rLug = 0.048;
    const lug = new THREE.Mesh(geos.lugGeo, mats.chrome);
    lug.position.set(s * 0.062, Math.cos(baseAngle) * rLug, Math.sin(baseAngle) * rLug);
    lug.castShadow = true;
    lug.receiveShadow = true;
    wheelGroup.add(lug);
  }

  // Center cap
  const capGeo = new THREE.CylinderGeometry(0.032, 0.035, 0.02, 20);
  capGeo.rotateZ(Math.PI / 2);
  addMesh(wheelGroup, capGeo, mats.darkAlloy, s * 0.062, 0, 0);

  // Brake disc (rotates with wheel)
  addMesh(wheelGroup, geos.discGeo, mats.brakeDisc, s * 0.015, 0, 0);

  return wheelGroup;
}

export default function create(THREE, opts = {}) {
  const geos = getCachedGeometries(THREE);
  const mats = getBaseMaterials(THREE);

  const root = new THREE.Group();
  root.name = opts.id ?? 'pickup';

  const paintColor = new THREE.Color(opts.color ?? '#e9eaea');
  const bodyPaint = new THREE.MeshPhysicalMaterial({
    color: paintColor,
    metalness: 0.42,
    roughness: 0.22,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06
  });

  // Per-instance emissive lamp materials so setLights(on) only affects this instance
  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xeef6ff,
    emissiveIntensity: 0.0,
    roughness: 0.1,
    metalness: 0.1
  });
  const taillightMat = new THREE.MeshStandardMaterial({
    color: 0xb80c14,
    emissive: 0xff1a1a,
    emissiveIntensity: 0.0,
    roughness: 0.15,
    metalness: 0.15
  });

  // =========================================================================
  // 1. MAIN CAB & CARGO BED BODY SHELL
  // =========================================================================
  addMesh(root, geos.cabGeo, bodyPaint, 0, 0, 0, 0, 0, 0, 'cab_body');
  addMesh(root, geos.bedRightGeo, bodyPaint, 0, 0, 0, 0, 0, 0, 'bed_side_R');
  addMesh(root, geos.bedLeftGeo, bodyPaint, 0, 0, 0, 0, 0, 0, 'bed_side_L');

  // Wheel arch fender flares (matte dark trim)
  addMesh(root, geos.flareFL, mats.blackPlastic);
  addMesh(root, geos.flareFR, mats.blackPlastic);
  addMesh(root, geos.flareRL, mats.blackPlastic);
  addMesh(root, geos.flareRR, mats.blackPlastic);

  // Hood sculpted power-dome creases & cowl vents
  const hoodCreaseGeo = makeRoundedBox(THREE, 0.025, 0.016, 1.38, 0.005, 0.004);
  for (const s of [-1, 1]) {
    addMesh(root, hoodCreaseGeo, bodyPaint, s * 0.46, 1.298, -2.02, 0.062, s * 0.035, 0);
  }
  const cowlGeo = makeRoundedBox(THREE, 1.66, 0.035, 0.16, 0.01, 0.005);
  addMesh(root, cowlGeo, mats.blackPlastic, 0, 1.325, -1.26, 0.08, 0, 0);

  // Windshield wipers (Left-Hand Drive alignment)
  const wiperArmGeo = makeRoundedBox(THREE, 0.56, 0.018, 0.022, 0.004, 0.003);
  addMesh(root, wiperArmGeo, mats.blackPlastic, -0.36, 1.345, -1.23, 0.2, 0.08, -0.04);
  addMesh(root, wiperArmGeo, mats.blackPlastic, 0.24, 1.345, -1.23, 0.2, 0.06, -0.04);

  // =========================================================================
  // 2. CARGO BED INTERIOR (FLOOR, RIBS, WHEEL TUBS, RAIL CAPS, TAILGATE)
  // =========================================================================
  // Bed front bulkhead wall (Z = +0.96, creating crisp 4cm gap behind cab at Z = +0.92)
  const bulkheadGeo = makeRoundedBox(THREE, 1.68, 0.60, 0.04, 0.01, 0.005);
  addMesh(root, bulkheadGeo, mats.bedliner, 0, 1.01, 0.97);

  // Bed floor (Y = 0.72, Z = +0.96 to +2.82, width = 1.66m)
  const bedFloorGeo = new THREE.BoxGeometry(1.66, 0.04, 1.88);
  addMesh(root, bedFloorGeo, mats.bedliner, 0, 0.70, 1.89);

  // Longitudinal floor ribs
  const ribGeo = new THREE.BoxGeometry(0.045, 0.014, 1.82);
  for (let i = -7; i <= 7; i++) {
    addMesh(root, ribGeo, mats.bedliner, i * 0.095, 0.726, 1.89);
  }

  // Inner bed wheel-well humps (centered at Z = +1.71)
  const tubGeo = makeRoundedBox(THREE, 0.24, 0.28, 0.86, 0.09, 0.02);
  addMesh(root, tubGeo, mats.bedliner, -0.72, 0.82, 1.71);
  addMesh(root, tubGeo, mats.bedliner, 0.72, 0.82, 1.71);

  // Bed rail plastic caps (with stake pocket indentations)
  const railCapGeo = makeRoundedBox(THREE, 0.135, 0.032, 1.90, 0.01, 0.006);
  addMesh(root, railCapGeo, mats.blackPlastic, -0.88, 1.32, 1.90);
  addMesh(root, railCapGeo, mats.blackPlastic, 0.88, 1.32, 1.90);

  // Tailgate assembly (Z = +2.84, Y = 0.72 to 1.315)
  const tailgateGeo = makeRoundedBox(THREE, 1.65, 0.58, 0.065, 0.018, 0.01);
  addMesh(root, tailgateGeo, bodyPaint, 0, 1.01, 2.84);
  // Tailgate stamped horizontal recess
  const tgStampGeo = makeRoundedBox(THREE, 1.38, 0.16, 0.02, 0.01, 0.005);
  addMesh(root, tgStampGeo, bodyPaint, 0, 0.96, 2.868);
  // Tailgate top spoiler cap
  const tgCapGeo = makeRoundedBox(THREE, 1.66, 0.038, 0.085, 0.012, 0.006);
  addMesh(root, tgCapGeo, mats.blackPlastic, 0, 1.315, 2.845);
  // Tailgate latch handle & bezel
  const tgBezelGeo = makeRoundedBox(THREE, 0.24, 0.075, 0.025, 0.01, 0.004);
  addMesh(root, tgBezelGeo, mats.blackPlastic, 0, 1.21, 2.872);
  const tgHandleGeo = makeRoundedBox(THREE, 0.16, 0.032, 0.03, 0.006, 0.004);
  addMesh(root, tgHandleGeo, mats.chrome, 0, 1.21, 2.882);

  // =========================================================================
  // 3. GREENHOUSE GLASS, PILLARS, SLIDING REAR WINDOW & CAB INTERIOR
  // =========================================================================
  // Windshield (sloped from Z = -1.23, Y = 1.33 to Z = -0.66, Y = 1.85)
  const wsLen = Math.hypot(1.85 - 1.33, -0.66 - (-1.23));
  const wsPitch = Math.atan2(1.85 - 1.33, -0.66 - (-1.23)); // angle from Z axis
  const wsGeo = makeRoundedBox(THREE, 1.56, 0.018, wsLen, 0.03, 0.004);
  addMesh(root, wsGeo, mats.glass, 0, 1.59, -0.945, -wsPitch, 0, 0);

  // Side windows (4 doors: front doors Z = -1.02 to -0.12, rear doors Z = -0.06 to +0.76)
  // Upper window frame black surround + glass panes
  for (const s of [-1, 1]) {
    const tiltZ = s * 0.27; // match greenhouse tumblehome

    // Front door window (with front mirror triangle drop)
    const fwShape = new THREE.Shape();
    fwShape.moveTo(-0.46, -0.24);
    fwShape.lineTo(0.42, -0.24);
    fwShape.lineTo(0.42, 0.23);
    fwShape.lineTo(-0.08, 0.23);
    fwShape.lineTo(-0.46, -0.10);
    fwShape.closePath();
    const fwGeo = new THREE.ExtrudeGeometry(fwShape, { depth: 0.012, bevelEnabled: false });
    fwGeo.rotateY(Math.PI / 2);
    addMesh(root, fwGeo, mats.glass, s * 0.842, 1.57, -0.54, 0, 0, tiltZ);

    // Rear crew-cab door window
    const rwGeo = makeRoundedBox(THREE, 0.014, 0.47, 0.78, 0.025, 0.003);
    addMesh(root, rwGeo, mats.glass, s * 0.842, 1.57, 0.34, 0, 0, tiltZ);

    // Gloss black B-pillar applique (between front & rear windows)
    const bPillarGeo = makeRoundedBox(THREE, 0.022, 0.49, 0.11, 0.005, 0.003);
    addMesh(root, bPillarGeo, mats.glossBlack, s * 0.845, 1.57, -0.09, 0, 0, tiltZ);

    // Window beltline weatherstrip trim
    const beltTrimGeo = makeRoundedBox(THREE, 0.026, 0.022, 1.82, 0.004, 0.003);
    addMesh(root, beltTrimGeo, mats.blackPlastic, s * 0.916, 1.32, -0.11);

    // Door panel gaps (recessed vertical/bottom black seams for 4 crew-cab doors)
    const seamVertGeo = new THREE.BoxGeometry(0.012, 0.88, 0.010);
    addMesh(root, seamVertGeo, mats.glossBlack, s * 0.974, 0.84, -1.12); // Front hinge seam
    addMesh(root, seamVertGeo, mats.glossBlack, s * 0.976, 0.84, -0.09); // B-pillar door seam
    addMesh(root, seamVertGeo, mats.glossBlack, s * 0.974, 0.84, 0.78);  // Rear door seam
    const seamBotGeo = new THREE.BoxGeometry(0.012, 0.010, 1.90);
    addMesh(root, seamBotGeo, mats.glossBlack, s * 0.945, 0.41, -0.17);

    // 4 Pull-style door handles (with keyhole recess on front left)
    for (const hz of [-0.26, 0.62]) {
      const bezelGeo = makeRoundedBox(THREE, 0.02, 0.055, 0.21, 0.012, 0.004);
      addMesh(root, bezelGeo, mats.blackPlastic, s * 0.975, 1.18, hz);
      const barGeo = makeRoundedBox(THREE, 0.038, 0.032, 0.18, 0.008, 0.005);
      addMesh(root, barGeo, mats.chrome, s * 0.992, 1.18, hz);
    }
  }

  // Rear cab window with center sliding pane & high-mount 3rd brake light (CHMSL)
  const rearGlassGeo = makeRoundedBox(THREE, 1.48, 0.42, 0.018, 0.025, 0.004);
  addMesh(root, rearGlassGeo, mats.glass, 0, 1.59, 0.915);
  // Sliding center pane frame tracks
  const slideFrameV = new THREE.BoxGeometry(0.022, 0.42, 0.026);
  addMesh(root, slideFrameV, mats.blackPlastic, -0.22, 1.59, 0.918);
  addMesh(root, slideFrameV, mats.blackPlastic, 0.22, 1.59, 0.918);
  const chmslGeo = makeRoundedBox(THREE, 0.36, 0.038, 0.04, 0.008, 0.004);
  addMesh(root, chmslGeo, mats.reflectorRed, 0, 1.855, 0.895);

  // Interior Cabin (Dashboard, Steering Wheel, Center Console, 4 Seats + Headrests)
  const dashGeo = makeRoundedBox(THREE, 1.62, 0.42, 0.48, 0.05, 0.02);
  addMesh(root, dashGeo, mats.interiorDark, 0, 1.15, -1.02);
  const clusterHoodGeo = makeRoundedBox(THREE, 0.42, 0.14, 0.24, 0.03, 0.01);
  addMesh(root, clusterHoodGeo, mats.interiorDark, -0.45, 1.34, -0.96);

  // Steering wheel (Left-Hand Drive at X = -0.45)
  const swColGeo = new THREE.CylinderGeometry(0.045, 0.055, 0.26, 12);
  swColGeo.rotateX(Math.PI / 2 - 0.38);
  addMesh(root, swColGeo, mats.interiorDark, -0.45, 1.24, -0.82);
  const swRimGeo = new THREE.TorusGeometry(0.185, 0.022, 10, 24);
  addMesh(root, swRimGeo, mats.seatLeather, -0.45, 1.28, -0.71, -0.38, 0, 0);

  // Center console
  const consoleGeo = makeRoundedBox(THREE, 0.36, 0.42, 0.88, 0.04, 0.015);
  addMesh(root, consoleGeo, mats.interiorDark, 0, 0.88, -0.45);

  // Front bucket seats & rear crew bench
  const seatCushionGeo = makeRoundedBox(THREE, 0.52, 0.16, 0.52, 0.04, 0.015);
  const seatBackGeo = makeRoundedBox(THREE, 0.50, 0.62, 0.14, 0.05, 0.015);
  const headrestGeo = makeRoundedBox(THREE, 0.24, 0.18, 0.10, 0.03, 0.01);

  for (const sx of [-0.45, 0.45]) {
    // Front row (driver eye at [-0.45, 1.56, -0.55])
    addMesh(root, seatCushionGeo, mats.seatLeather, sx, 0.84, -0.48);
    addMesh(root, seatBackGeo, mats.seatLeather, sx, 1.18, -0.26, -0.14, 0, 0);
    addMesh(root, headrestGeo, mats.seatLeather, sx, 1.56, -0.21, -0.10, 0, 0);
    // Rear crew row
    addMesh(root, seatCushionGeo, mats.seatLeather, sx, 0.86, 0.38);
    addMesh(root, seatBackGeo, mats.seatLeather, sx, 1.20, 0.62, -0.10, 0, 0);
    addMesh(root, headrestGeo, mats.seatLeather, sx, 1.57, 0.66, -0.08, 0, 0);
  }

  // Interior ceiling headliner & floor pan (blocks light leaks through glass)
  const headlinerGeo = new THREE.BoxGeometry(1.48, 0.025, 1.52);
  addMesh(root, headlinerGeo, mats.interiorDark, 0, 1.84, 0.10);
  const cabFloorPanGeo = new THREE.BoxGeometry(1.78, 0.05, 2.15);
  addMesh(root, cabFloorPanGeo, mats.interiorDark, 0, 0.42, -0.15);

  // =========================================================================
  // 4. TOWING MIRRORS ('mirror_L' and 'mirror_R')
  // =========================================================================
  for (const s of [-1, 1]) {
    const mGroup = new THREE.Group();
    mGroup.name = s < 0 ? 'mirror_L' : 'mirror_R';

    // Door sail mount base
    const sailGeo = makeRoundedBox(THREE, 0.06, 0.18, 0.22, 0.015, 0.006);
    addMesh(mGroup, sailGeo, mats.blackPlastic, s * 0.90, 1.38, -0.92, 0, 0, s * 0.2);

    // Dual horizontal support arms (characteristic heavy-duty / tow mirror look)
    const armGeo = makeRoundedBox(THREE, 0.18, 0.026, 0.032, 0.006, 0.004);
    addMesh(mGroup, armGeo, mats.blackPlastic, s * 0.98, 1.41, -0.92);
    addMesh(mGroup, armGeo, mats.blackPlastic, s * 0.98, 1.33, -0.92);

    // Tall vertical mirror housing (sticks out to X = ±1.13m, within +0.15m mirror allowance)
    const housingGeo = makeRoundedBox(THREE, 0.12, 0.27, 0.11, 0.022, 0.008);
    addMesh(mGroup, housingGeo, mats.blackPlastic, s * 1.07, 1.39, -0.91, 0, s * 0.12, 0);

    // Chrome top skull cap
    const skullGeo = makeRoundedBox(THREE, 0.115, 0.11, 0.055, 0.018, 0.006);
    addMesh(mGroup, skullGeo, mats.chrome, s * 1.07, 1.46, -0.94, 0, s * 0.12, 0);

    // Amber side marker strip on outer edge
    const sideLedGeo = makeRoundedBox(THREE, 0.018, 0.14, 0.02, 0.004, 0.002);
    addMesh(mGroup, sideLedGeo, mats.amberMarker, s * 1.128, 1.39, -0.93, 0, s * 0.12, 0);

    // Reflective mirror glass (upper flat + lower convex blind-spot)
    const glassUpper = makeRoundedBox(THREE, 0.102, 0.165, 0.01, 0.008, 0.002);
    addMesh(mGroup, glassUpper, mats.mirrorGlass, s * 1.07, 1.425, -0.855, 0, s * 0.12, 0);
    const glassLower = makeRoundedBox(THREE, 0.102, 0.068, 0.01, 0.008, 0.002);
    addMesh(mGroup, glassLower, mats.mirrorGlass, s * 1.07, 1.295, -0.855, 0, s * 0.12, 0);

    root.add(mGroup);
  }

  // =========================================================================
  // 5. FRONT FASCIA: UPRIGHT GRILLE, HEADLIGHTS ('headlight_L'/'R'), BUMPER
  // =========================================================================
  // Recessed dark honeycomb grille insert
  const grilleInsertGeo = makeRoundedBox(THREE, 1.18, 0.44, 0.04, 0.02, 0.005);
  addMesh(root, grilleInsertGeo, mats.grilleMesh, 0, 0.95, -2.815);

  // Heavy chrome grille outer frame
  const gFrameTop = makeRoundedBox(THREE, 1.26, 0.055, 0.07, 0.012, 0.008);
  addMesh(root, gFrameTop, mats.chrome, 0, 1.18, -2.83);
  const gFrameBot = makeRoundedBox(THREE, 1.26, 0.045, 0.07, 0.012, 0.008);
  addMesh(root, gFrameBot, mats.chrome, 0, 0.72, -2.84);
  for (const s of [-1, 1]) {
    const gSide = makeRoundedBox(THREE, 0.055, 0.48, 0.07, 0.012, 0.008);
    addMesh(root, gSide, mats.chrome, s * 0.605, 0.95, -2.835);
  }

  // Twin bold horizontal chrome grille bars with central generic shield recess
  const gBarMain = makeRoundedBox(THREE, 1.22, 0.068, 0.085, 0.012, 0.008);
  addMesh(root, gBarMain, mats.chrome, 0, 0.99, -2.845);
  addMesh(root, gBarMain, mats.chrome, 0, 0.89, -2.845);
  const badgeShield = makeRoundedBox(THREE, 0.22, 0.11, 0.095, 0.025, 0.008);
  addMesh(root, badgeShield, mats.darkAlloy, 0, 0.94, -2.852);

  // Headlight assemblies (C-clamp LED DRL + twin projectors)
  for (const s of [-1, 1]) {
    const hx = s * 0.775;
    // Black reflector housing
    const hlHousing = makeRoundedBox(THREE, 0.27, 0.44, 0.14, 0.025, 0.008);
    addMesh(root, hlHousing, mats.glossBlack, hx, 0.95, -2.78, 0, s * 0.16, 0);

    // Emissive LED projector + C-clamp (named 'headlight_L' / 'headlight_R')
    const hlEmitterGeo = makeRoundedBox(THREE, 0.22, 0.38, 0.04, 0.02, 0.006);
    const hlMesh = addMesh(
      root,
      hlEmitterGeo,
      headlightMat,
      hx,
      0.95,
      -2.825,
      0,
      s * 0.16,
      0,
      s < 0 ? 'headlight_L' : 'headlight_R'
    );
    hlMesh.castShadow = false;

    // Amber corner turn/marker reflector inside cluster
    const amberCorner = makeRoundedBox(THREE, 0.045, 0.36, 0.045, 0.008, 0.004);
    addMesh(root, amberCorner, mats.amberMarker, s * 0.89, 0.95, -2.79, 0, s * 0.22, 0);

    // Clear polycarbonate outer lens cover
    const hlLens = makeRoundedBox(THREE, 0.265, 0.435, 0.035, 0.025, 0.006);
    const lensMesh = addMesh(root, hlLens, mats.clearLens, hx, 0.95, -2.842, 0, s * 0.16, 0);
    lensMesh.castShadow = false;
  }

  // Front heavy chrome bumper (Z = -2.95 leading edge, Y = 0.38 to 0.68)
  const fBumperCenter = makeRoundedBox(THREE, 1.42, 0.28, 0.20, 0.035, 0.015);
  addMesh(root, fBumperCenter, mats.chrome, 0, 0.54, -2.85);
  for (const s of [-1, 1]) {
    const fBumperWing = makeRoundedBox(THREE, 0.34, 0.27, 0.22, 0.03, 0.015);
    addMesh(root, fBumperWing, mats.chrome, s * 0.81, 0.54, -2.80, 0, s * 0.24, 0);

    // Fog light pocket & lens
    const fogPocket = makeRoundedBox(THREE, 0.14, 0.09, 0.06, 0.015, 0.005);
    addMesh(root, fogPocket, mats.blackPlastic, s * 0.76, 0.53, -2.88, 0, s * 0.18, 0);
    const fogLens = makeRoundedBox(THREE, 0.10, 0.065, 0.03, 0.01, 0.004);
    addMesh(root, fogLens, mats.clearLens, s * 0.76, 0.53, -2.90, 0, s * 0.18, 0);

    // Heavy-duty front tow hooks
    const hookGeo = new THREE.TorusGeometry(0.042, 0.016, 10, 20);
    hookGeo.rotateY(Math.PI / 2);
    addMesh(root, hookGeo, mats.darkAlloy, s * 0.44, 0.42, -2.91);
  }

  // Lower intake opening & front blank license plate bracket
  const lowerIntake = makeRoundedBox(THREE, 0.74, 0.12, 0.05, 0.015, 0.005);
  addMesh(root, lowerIntake, mats.grilleMesh, 0, 0.48, -2.93);
  const fPlateBracket = makeRoundedBox(THREE, 0.33, 0.17, 0.04, 0.01, 0.005);
  addMesh(root, fPlateBracket, mats.blackPlastic, 0, 0.53, -2.932);
  const fPlate = makeRoundedBox(THREE, 0.30, 0.15, 0.012, 0.008, 0.002);
  addMesh(root, fPlate, mats.plateWhite, 0, 0.53, -2.948);

  // Lower front air dam / valance (ground clearance >= 0.24m)
  const airDamGeo = makeRoundedBox(THREE, 1.76, 0.13, 0.14, 0.02, 0.008);
  addMesh(root, airDamGeo, mats.blackPlastic, 0, 0.34, -2.82);

  // =========================================================================
  // 6. REAR FASCIA: VERTICAL TAILLIGHTS ('taillight_L'/'R'), STEP BUMPER, HITCH
  // =========================================================================
  for (const s of [-1, 1]) {
    const tx = s * 0.915;
    // Taillight housing recessed into rear bed corner
    const tlHousing = makeRoundedBox(THREE, 0.11, 0.42, 0.12, 0.02, 0.006);
    addMesh(root, tlHousing, mats.glossBlack, tx, 1.03, 2.82, 0, -s * 0.12, 0);

    // Emissive red LED taillight mesh (named 'taillight_L' / 'taillight_R')
    const tlEmitterGeo = makeRoundedBox(THREE, 0.095, 0.38, 0.05, 0.018, 0.006);
    const tlMesh = addMesh(
      root,
      tlEmitterGeo,
      taillightMat,
      tx,
      1.03,
      2.855,
      0,
      -s * 0.12,
      0,
      s < 0 ? 'taillight_L' : 'taillight_R'
    );
    tlMesh.castShadow = false;

    // Clear reverse lamp insert in center of taillight
    const revLens = makeRoundedBox(THREE, 0.065, 0.09, 0.056, 0.01, 0.004);
    const revMesh = addMesh(root, revLens, mats.clearLens, tx, 1.03, 2.858, 0, -s * 0.12, 0);
    revMesh.castShadow = false;
  }

  // Rear chrome step bumper (Z = +2.95 trailing edge, Y = 0.44 to 0.68)
  for (const s of [-1, 1]) {
    const rPod = makeRoundedBox(THREE, 0.68, 0.22, 0.18, 0.03, 0.012);
    addMesh(root, rPod, mats.chrome, s * 0.62, 0.56, 2.86);
    // Textured black plastic step pad on top of bumper pod
    const rPad = makeRoundedBox(THREE, 0.64, 0.03, 0.15, 0.01, 0.005);
    addMesh(root, rPad, mats.blackPlastic, s * 0.62, 0.675, 2.86);
    // Corner bed step cutout
    const cornerStep = makeRoundedBox(THREE, 0.14, 0.07, 0.12, 0.01, 0.004);
    addMesh(root, cornerStep, mats.blackPlastic, s * 0.89, 0.50, 2.88);
  }

  // Center step recess & rear license plate
  const rCenterStep = makeRoundedBox(THREE, 0.62, 0.14, 0.16, 0.02, 0.008);
  addMesh(root, rCenterStep, mats.blackPlastic, 0, 0.51, 2.85);
  const rPlate = makeRoundedBox(THREE, 0.30, 0.15, 0.012, 0.008, 0.002);
  addMesh(root, rPlate, mats.plateWhite, 0, 0.56, 2.86);

  // Class IV 2-inch trailer hitch receiver under rear bumper
  const hitchCrossbar = makeRoundedBox(THREE, 0.92, 0.065, 0.065, 0.01, 0.005);
  addMesh(root, hitchCrossbar, mats.chassis, 0, 0.39, 2.78);
  const hitchBox = makeRoundedBox(THREE, 0.075, 0.075, 0.14, 0.008, 0.004);
  addMesh(root, hitchBox, mats.chassis, 0, 0.36, 2.86);
  const hitchHole = new THREE.BoxGeometry(0.052, 0.052, 0.04);
  addMesh(root, hitchHole, mats.glossBlack, 0, 0.36, 2.915);

  // =========================================================================
  // 7. RUNNING BOARDS, CHASSIS FRAME, DRIVETRAIN, EXHAUST & WHEELS
  // =========================================================================
  // Running boards / side steps (Z = -1.25 to +0.82, Y = 0.30)
  const boardBarGeo = makeRoundedBox(THREE, 0.15, 0.048, 2.04, 0.018, 0.006);
  const stepPadGeo = makeRoundedBox(THREE, 0.135, 0.016, 0.65, 0.008, 0.004);
  const bracketGeo = new THREE.BoxGeometry(0.18, 0.07, 0.05);
  for (const s of [-1, 1]) {
    addMesh(root, boardBarGeo, mats.chrome, s * 0.915, 0.30, -0.20);
    addMesh(root, stepPadGeo, mats.blackPlastic, s * 0.915, 0.328, -0.62);
    addMesh(root, stepPadGeo, mats.blackPlastic, s * 0.915, 0.328, 0.25);
    for (const bz of [-1.02, -0.20, 0.60]) {
      addMesh(root, bracketGeo, mats.chassis, s * 0.80, 0.33, bz);
    }
  }

  // Ladder frame rails, solid rear axle + differential pumpkin, exhaust tailpipe
  const frameRailGeo = new THREE.BoxGeometry(0.08, 0.14, 5.20);
  addMesh(root, frameRailGeo, mats.chassis, -0.42, 0.38, 0.0);
  addMesh(root, frameRailGeo, mats.chassis, 0.42, 0.38, 0.0);

  const rearAxleTube = new THREE.CylinderGeometry(0.048, 0.048, 1.56, 16);
  rearAxleTube.rotateZ(Math.PI / 2);
  addMesh(root, rearAxleTube, mats.chassis, 0, 0.41, 1.71);
  const diffSphere = new THREE.SphereGeometry(0.135, 16, 12);
  addMesh(root, diffSphere, mats.chassis, 0.04, 0.41, 1.71);

  const frontSkidGeo = makeRoundedBox(THREE, 0.72, 0.04, 0.58, 0.01, 0.005);
  addMesh(root, frontSkidGeo, mats.darkAlloy, 0, 0.29, -2.35, 0.18, 0, 0);

  // Wheel well dark liners (prevent see-through behind tires)
  const wellLinerGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.34, 24, 1, false, 0, Math.PI);
  wellLinerGeo.rotateZ(Math.PI / 2);
  for (const az of [-1.97, 1.71]) {
    for (const s of [-1, 1]) {
      addMesh(root, wellLinerGeo, mats.chassis, s * 0.78, 0.42, az);
    }
  }

  // Side-exit chrome exhaust pipe behind right-rear wheel
  const exhaustGeo = new THREE.CylinderGeometry(0.042, 0.042, 0.36, 16);
  exhaustGeo.rotateZ(Math.PI / 2);
  addMesh(root, exhaustGeo, mats.chrome, 0.82, 0.34, 2.38, 0, -0.45, 0.12);

  // Wheels (4 assemblies at X = ±0.86, Z = -1.97 and +1.71, Y = 0.41)
  const wheels = [];
  const wheelCoords = [
    { name: 'wheel_FL', x: -0.86, z: -1.97, isLeft: true },
    { name: 'wheel_FR', x: 0.86, z: -1.97, isLeft: false },
    { name: 'wheel_RL', x: -0.86, z: 1.71, isLeft: true },
    { name: 'wheel_RR', x: 0.86, z: 1.71, isLeft: false }
  ];

  for (const wc of wheelCoords) {
    const wGroup = createWheelAssembly(THREE, geos, mats, wc.isLeft);
    wGroup.name = wc.name;
    wGroup.position.set(wc.x, 0.41, wc.z);
    root.add(wGroup);
    wheels.push(wGroup);

    // Non-rotating brake caliper mounted to knuckle inside the wheel
    const s = wc.isLeft ? -1 : 1;
    const calZOffset = wc.z < 0 ? 0.11 : -0.11;
    addMesh(root, geos.caliperGeo, mats.caliper, wc.x + s * 0.02, 0.45, wc.z + calZOffset);
  }

  // =========================================================================
  // 8. HEADLAMP SPOTLIGHTS & USERDATA CONTRACT
  // =========================================================================
  let spotL = null;
  let spotR = null;

  function setLights(on) {
    const active = Boolean(on);
    headlightMat.emissiveIntensity = active ? 3.5 : 0.0;
    taillightMat.emissiveIntensity = active ? 2.2 : 0.0;

    if (active && !spotL) {
      spotL = new THREE.SpotLight(0xf2f7ff, 4.0, 35, Math.PI / 5, 0.45, 1.5);
      spotL.position.set(-0.775, 0.95, -2.86);
      spotL.target.position.set(-0.775, 0.40, -18.0);
      root.add(spotL);
      root.add(spotL.target);

      spotR = new THREE.SpotLight(0xf2f7ff, 4.0, 35, Math.PI / 5, 0.45, 1.5);
      spotR.position.set(0.775, 0.95, -2.86);
      spotR.target.position.set(0.775, 0.40, -18.0);
      root.add(spotR);
      root.add(spotR.target);
    }
    if (spotL) spotL.visible = active;
    if (spotR) spotR.visible = active;
  }

  if (opts.lightsOn) {
    setLights(true);
  }

  root.userData = {
    assetType: 'vehicle',
    vehicleType: 'pickup',
    dims: { length: 5.90, width: 2.00, height: 1.90 },
    driverEye: [-0.45, 1.56, -0.55],
    wheels,
    setLights
  };

  return root;
}
