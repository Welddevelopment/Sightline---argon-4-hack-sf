// r2_west — US-27A west approach (x in [-900, -45]), vertical crest at x=-345, EB/WB lanes, auxiliary turn lanes, markings, signage, and clear sightline corridor
export default function region(THREE, assets, ctx) {
  const root = new THREE.Group();
  root.name = 'region_r2_west';
  root.userData.citation = 'NTSB/HAR-17/02 p.3, p.22-23, p.29-30 (US-27A west approach, crest 345 m W, 2.15% downgrade, auxiliary turn lanes, no sight obstructions)';

  const L = ctx.layout;
  const CITE = L.cite;
  const X_MIN = -900;
  const X_MAX = -45;

  // --- Shared X station array with <= 5m spacing near the crest (-450 to -240) and <= 6m elsewhere ---
  function buildStations(x0, x1) {
    const xs = [];
    let x = x0;
    while (x < x1 - 1e-6) {
      xs.push(x);
      const step = (x >= -460 && x <= -230) ? 4.0 : 5.5;
      x = Math.min(x1, x + step);
    }
    xs.push(x1);
    return xs;
  }

  // --- Helper: Build profiled strip mesh following ctx.roadY(x) ---
  function buildProfiledStrip({
    x0, x1, z0Fn, z1Fn, zSub = 1, yOffset = 0, material, uvScaleX = 1, uvScaleZ = 1, vertexColorFn = null, name = 'strip', citation = ''
  }) {
    const xs = buildStations(x0, x1);
    const nx = xs.length;
    const nz = zSub + 1;
    const positions = new Float32Array(nx * nz * 3);
    const normals = new Float32Array(nx * nz * 3);
    const uvs = new Float32Array(nx * nz * 2);
    const colors = vertexColorFn ? new Float32Array(nx * nz * 3) : null;
    const indices = [];

    let pIdx = 0;
    let uvIdx = 0;
    let cIdx = 0;

    for (let i = 0; i < nx; i++) {
      const x = xs[i];
      const y = ctx.roadY(x) + yOffset;
      const dy = (ctx.roadY(x + 0.5) - ctx.roadY(x - 0.5));
      const len = Math.hypot(1.0, dy);
      const nxVal = -dy / len;
      const nyVal = 1.0 / len;

      const zStart = typeof z0Fn === 'function' ? z0Fn(x) : z0Fn;
      const zEnd = typeof z1Fn === 'function' ? z1Fn(x) : z1Fn;

      for (let j = 0; j < nz; j++) {
        const frac = j / zSub;
        const z = zStart + (zEnd - zStart) * frac;

        positions[pIdx] = x;
        positions[pIdx + 1] = y;
        positions[pIdx + 2] = z;

        normals[pIdx] = nxVal;
        normals[pIdx + 1] = nyVal;
        normals[pIdx + 2] = 0;
        pIdx += 3;

        uvs[uvIdx] = x * uvScaleX;
        uvs[uvIdx + 1] = z * uvScaleZ;
        uvIdx += 2;

        if (colors) {
          const col = vertexColorFn(x, z, frac);
          colors[cIdx] = col[0];
          colors[cIdx + 1] = col[1];
          colors[cIdx + 2] = col[2];
          cIdx += 3;
        }
      }
    }

    for (let i = 0; i < nx - 1; i++) {
      for (let j = 0; j < zSub; j++) {
        const a = i * nz + j;
        const b = (i + 1) * nz + j;
        const c = (i + 1) * nz + (j + 1);
        const d = i * nz + (j + 1);
        indices.push(a, d, b);
        indices.push(b, d, c);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    if (colors) {
      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    geom.setIndex(indices);

    const mesh = new THREE.Mesh(geom, material);
    mesh.receiveShadow = true;
    mesh.name = name;
    mesh.userData.citation = citation;
    return mesh;
  }

  // --- Helper: Dashed line strip in a single BufferGeometry ---
  function buildDashedStrip({
    x0, x1, zCenter, width = 0.15, dash = 3.05, gap = 9.15, yOffset = 0.012, material, name, citation
  }) {
    const cycle = dash + gap;
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    const halfW = width * 0.5;
    let vCount = 0;

    let kStart = Math.floor(x0 / cycle);
    let kEnd = Math.ceil(x1 / cycle);

    for (let k = kStart; k <= kEnd; k++) {
      const d0 = Math.max(x0, k * cycle);
      const d1 = Math.min(x1, k * cycle + dash);
      if (d1 <= d0 + 0.05) continue;

      const xm = 0.5 * (d0 + d1);
      const xs = [d0, xm, d1];
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i];
        const y = ctx.roadY(x) + yOffset;
        positions.push(x, y, zCenter - halfW);
        positions.push(x, y, zCenter + halfW);
        normals.push(0, 1, 0, 0, 1, 0);
        uvs.push(x, 0, x, 1);
      }
      indices.push(vCount + 0, vCount + 1, vCount + 2);
      indices.push(vCount + 2, vCount + 1, vCount + 3);
      indices.push(vCount + 2, vCount + 3, vCount + 4);
      indices.push(vCount + 4, vCount + 3, vCount + 5);
      vCount += 6;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);

    const mesh = new THREE.Mesh(geom, material);
    mesh.receiveShadow = true;
    mesh.name = name;
    mesh.userData.citation = citation;
    return mesh;
  }

  // --- Helper: Piecewise linear interpolation for turn-lane tapers ---
  function ebLeftInnerZ(x) {
    if (x <= -220) return -5.49;
    if (x >= -187.45) return -9.15;
    const t = (x - (-220)) / (-187.45 - (-220));
    return -5.49 + t * (-9.15 - (-5.49));
  }

  function ebLeftShoulderOuterZ(x) {
    return ebLeftInnerZ(x) - 0.61;
  }

  function ebRightOuterZ(x) {
    if (x <= -200) return 1.83;
    if (x >= -170) return 5.49;
    const t = (x - (-200)) / (-170 - (-200));
    return 1.83 + t * (5.49 - 1.83);
  }

  function ebRightShoulderOuterZ(x) {
    return ebRightOuterZ(x) + 1.52;
  }

  // =========================================================================
  // 1. PAVEMENT & SHOULDERS GROUP
  // =========================================================================
  const pavementGroup = new THREE.Group();
  pavementGroup.name = 'pavement_and_shoulders';
  pavementGroup.userData.citation = `${CITE.lanes}; ${CITE.turnLanes}; ${CITE.profile}`;

  const matMainAsphalt = ctx.surface('asphalt', { color: 0x3a3c3f, roughness: 0.82 });
  const matTurnAsphalt = ctx.surface('asphalt', { color: 0x3d3f42, roughness: 0.84 });
  const matShoulderAsphalt = ctx.surface('asphalt', { color: 0x45474b, roughness: 0.87 });
  const matSubbaseGravel = ctx.surface('gravel', { color: 0x7c766b, roughness: 0.92 });

  // EB Mainline (2 x 3.66m lanes: z in [-5.49, 1.83])
  pavementGroup.add(buildProfiledStrip({
    x0: X_MIN, x1: X_MAX,
    z0Fn: -5.49, z1Fn: 1.83,
    zSub: 4, yOffset: 0.0,
    material: matMainAsphalt,
    name: 'road_eb_mainline',
    citation: CITE.lanes
  }));

  // WB Mainline (2 x 3.66m lanes: z in [-36.58, -29.26])
  pavementGroup.add(buildProfiledStrip({
    x0: X_MIN, x1: X_MAX,
    z0Fn: -36.58, z1Fn: -29.26,
    zSub: 4, yOffset: 0.0,
    material: matMainAsphalt,
    name: 'road_wb_mainline',
    citation: CITE.lanes
  }));

  // EB Left-Turn Lane (x in [-220, -45], tapering from -5.49 to -9.15 by x=-187.45)
  pavementGroup.add(buildProfiledStrip({
    x0: -220, x1: X_MAX,
    z0Fn: (x) => ebLeftInnerZ(x),
    z1Fn: -5.49,
    zSub: 2, yOffset: 0.0,
    material: matTurnAsphalt,
    name: 'road_eb_left_turn_lane',
    citation: CITE.turnLanes
  }));

  // EB Right-Turn Lane (x in [-200, -45], tapering from 1.83 to 5.49 by x=-170)
  pavementGroup.add(buildProfiledStrip({
    x0: -200, x1: X_MAX,
    z0Fn: 1.83,
    z1Fn: (x) => ebRightOuterZ(x),
    zSub: 2, yOffset: 0.0,
    material: matTurnAsphalt,
    name: 'road_eb_right_turn_lane',
    citation: CITE.turnLanes
  }));

  // EB Left (Inside) Paved Shoulder (0.61 m wide, tracks outside EB left-turn lane)
  pavementGroup.add(buildProfiledStrip({
    x0: X_MIN, x1: X_MAX,
    z0Fn: (x) => ebLeftShoulderOuterZ(x),
    z1Fn: (x) => ebLeftInnerZ(x),
    zSub: 1, yOffset: 0.0,
    material: matShoulderAsphalt,
    name: 'shoulder_eb_inside',
    citation: CITE.lanes
  }));

  // EB Right (Outside) Paved Shoulder (1.52 m wide, shifts outside EB right-turn lane)
  pavementGroup.add(buildProfiledStrip({
    x0: X_MIN, x1: X_MAX,
    z0Fn: (x) => ebRightOuterZ(x),
    z1Fn: (x) => ebRightShoulderOuterZ(x),
    zSub: 1, yOffset: 0.0,
    material: matShoulderAsphalt,
    name: 'shoulder_eb_outside',
    citation: CITE.lanes
  }));

  // WB Right (North/Outside) Paved Shoulder (z in [-38.10, -36.58])
  pavementGroup.add(buildProfiledStrip({
    x0: X_MIN, x1: X_MAX,
    z0Fn: -38.10, z1Fn: -36.58,
    zSub: 1, yOffset: 0.0,
    material: matShoulderAsphalt,
    name: 'shoulder_wb_outside',
    citation: CITE.lanes
  }));

  // WB Left (South/Inside) Paved Shoulder (z in [-29.26, -28.65])
  pavementGroup.add(buildProfiledStrip({
    x0: X_MIN, x1: X_MAX,
    z0Fn: -29.26, z1Fn: -28.65,
    zSub: 1, yOffset: 0.0,
    material: matShoulderAsphalt,
    name: 'shoulder_wb_inside',
    citation: CITE.lanes
  }));

  // Compacted limerock/gravel shoulder verge (0.45 m transition strip so asphalt edge never floats)
  const vergePairs = [
    { name: 'verge_eb_south', z0: (x) => ebRightShoulderOuterZ(x), z1: (x) => ebRightShoulderOuterZ(x) + 0.45 },
    { name: 'verge_eb_north', z0: (x) => ebLeftShoulderOuterZ(x) - 0.35, z1: (x) => ebLeftShoulderOuterZ(x) },
    { name: 'verge_wb_north', z0: -38.55, z1: -38.10 },
    { name: 'verge_wb_south', z0: -28.65, z1: -28.30 }
  ];
  for (const vp of vergePairs) {
    pavementGroup.add(buildProfiledStrip({
      x0: X_MIN, x1: X_MAX,
      z0Fn: vp.z0, z1Fn: vp.z1,
      zSub: 1, yOffset: -0.008,
      material: matSubbaseGravel,
      name: vp.name,
      citation: 'inferred: typical FDOT limerock shoulder edge grading'
    }));
  }

  root.add(pavementGroup);

  // =========================================================================
  // 2. SURFACE WEAR, MILLED RUMBLE STRIPS & CRACK SEALING
  // =========================================================================
  const surfaceDetailGroup = new THREE.Group();
  surfaceDetailGroup.name = 'surface_wear_and_rumble_strips';
  surfaceDetailGroup.userData.citation = 'inferred: typical FDOT rural divided highway wheel-path wear, rumble strips, and crack sealing';

  // Wheel-path darkening & oil strip canvas texture
  function makeWearMaterial() {
    const c = ctx.makeCanvas(128, 256);
    if (c) {
      const g = c.getContext('2d');
      g.clearRect(0, 0, 128, 256);
      for (let x = 0; x < 128; x++) {
        const u = x / 128;
        // Two wheel tracks at u=0.26 and u=0.74, plus subtle center oil drip at u=0.50
        const w1 = Math.exp(-Math.pow((u - 0.26) / 0.11, 2)) * 0.34;
        const w2 = Math.exp(-Math.pow((u - 0.74) / 0.11, 2)) * 0.34;
        const oil = Math.exp(-Math.pow((u - 0.50) / 0.05, 2)) * 0.22;
        const alpha = Math.min(0.45, w1 + w2 + oil);
        g.fillStyle = `rgba(18, 19, 22, ${alpha.toFixed(3)})`;
        g.fillRect(x, 0, 1, 256);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      return new THREE.MeshStandardMaterial({
        map: tex,
        transparent: true,
        roughness: 0.88,
        metalness: 0.0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
      });
    }
    return new THREE.MeshStandardMaterial({
      color: 0x242629,
      transparent: true,
      opacity: 0.18,
      roughness: 0.88,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
  }

  const matLaneWear = makeWearMaterial();
  const laneBands = [
    { name: 'wear_eb_outside', z0: -1.83, z1: 1.83 },
    { name: 'wear_eb_inside', z0: -5.49, z1: -1.83 },
    { name: 'wear_wb_inside', z0: -32.92, z1: -29.26 },
    { name: 'wear_wb_outside', z0: -36.58, z1: -32.92 }
  ];

  for (const lb of laneBands) {
    const strip = buildProfiledStrip({
      x0: X_MIN, x1: X_MAX,
      z0Fn: lb.z0, z1Fn: lb.z1,
      zSub: 1, yOffset: 0.004,
      material: matLaneWear,
      uvScaleX: 0.05, uvScaleZ: 1.0,
      name: lb.name,
      citation: 'inferred: wheel-path aggregate polishing and oil staining'
    });
    // Override V coordinate to span [0, 1] across lane width
    const uvAttr = strip.geometry.getAttribute('uv');
    for (let i = 0; i < uvAttr.count; i++) {
      const z = strip.geometry.getAttribute('position').getZ(i);
      const u = (z - lb.z0) / (lb.z1 - lb.z0);
      const x = strip.geometry.getAttribute('position').getX(i);
      uvAttr.setXY(i, u, x * 0.1);
    }
    surfaceDetailGroup.add(strip);
  }

  // Milled 0.6 m shoulder rumble strips (ribbed texture)
  function makeRumbleMaterial() {
    const c = ctx.makeCanvas(64, 128);
    if (c) {
      const g = c.getContext('2d');
      g.fillStyle = '#383a3d';
      g.fillRect(0, 0, 64, 128);
      for (let y = 0; y < 128; y += 16) {
        g.fillStyle = '#202225';
        g.fillRect(6, y + 2, 52, 7);
        g.fillStyle = '#4c4f53';
        g.fillRect(6, y + 9, 52, 3);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      return new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.92,
        metalness: 0.0,
        polygonOffset: true,
        polygonOffsetFactor: -1.5,
        polygonOffsetUnits: -1.5
      });
    }
    return new THREE.MeshStandardMaterial({
      color: 0x2c2e31,
      roughness: 0.94,
      polygonOffset: true,
      polygonOffsetFactor: -1.5,
      polygonOffsetUnits: -1.5
    });
  }

  const matRumble = makeRumbleMaterial();

  // EB South Outer Shoulder Rumble Strip (x in [-900, -205], before right-turn lane taper)
  const rumbleEBSouth = buildProfiledStrip({
    x0: X_MIN, x1: -205,
    z0Fn: 2.00, z1Fn: 2.60,
    zSub: 1, yOffset: 0.005,
    material: matRumble,
    name: 'rumble_strip_eb_south',
    citation: 'inferred: FDOT standard 0.6 m milled shoulder rumble strip'
  });
  // Map UVs so ribs repeat along X
  {
    const uvAttr = rumbleEBSouth.geometry.getAttribute('uv');
    const posAttr = rumbleEBSouth.geometry.getAttribute('position');
    for (let i = 0; i < uvAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      uvAttr.setXY(i, (z - 2.00) / 0.60, x * 0.8);
    }
  }
  surfaceDetailGroup.add(rumbleEBSouth);

  // WB North Outer Shoulder Rumble Strip (x in [-900, -45])
  const rumbleWBNorth = buildProfiledStrip({
    x0: X_MIN, x1: X_MAX,
    z0Fn: -37.35, z1Fn: -36.75,
    zSub: 1, yOffset: 0.005,
    material: matRumble,
    name: 'rumble_strip_wb_north',
    citation: 'inferred: FDOT standard 0.6 m milled shoulder rumble strip'
  });
  {
    const uvAttr = rumbleWBNorth.geometry.getAttribute('uv');
    const posAttr = rumbleWBNorth.geometry.getAttribute('position');
    for (let i = 0; i < uvAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      uvAttr.setXY(i, (z - (-37.35)) / 0.60, x * 0.8);
    }
  }
  surfaceDetailGroup.add(rumbleWBNorth);

  // Occasional sealed asphalt cracks & tar patches along the approach
  const matTarCrack = new THREE.MeshStandardMaterial({
    color: 0x1d1e20,
    roughness: 0.45,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });

  const crackRand = ctx.rand(20160507);
  const crackPositions = [];
  const crackNormals = [];
  const crackIndices = [];
  let crackV = 0;

  for (let i = 0; i < 38; i++) {
    const cx = X_MIN + 25 + crackRand() * (X_MAX - X_MIN - 50);
    const isWB = crackRand() > 0.55;
    const baseZ = isWB ? (-36.2 + crackRand() * 6.5) : (-5.1 + crackRand() * 6.5);
    const segs = 4;
    const w = 0.045;
    let curX = cx;
    let curZ = baseZ;
    const isTransverse = crackRand() > 0.35;

    for (let s = 0; s <= segs; s++) {
      const y = ctx.roadY(curX) + 0.008;
      if (isTransverse) {
        crackPositions.push(curX - w, y, curZ, curX + w, y, curZ);
        curX += (crackRand() - 0.5) * 0.45;
        curZ += 0.65 + crackRand() * 0.45;
      } else {
        crackPositions.push(curX, y, curZ - w, curX, y, curZ + w);
        curX += 1.4 + crackRand() * 0.9;
        curZ += (crackRand() - 0.5) * 0.25;
      }
      crackNormals.push(0, 1, 0, 0, 1, 0);
    }
    for (let s = 0; s < segs; s++) {
      const a = crackV + s * 2;
      crackIndices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    crackV += (segs + 1) * 2;
  }

  const crackGeom = new THREE.BufferGeometry();
  crackGeom.setAttribute('position', new THREE.Float32BufferAttribute(crackPositions, 3));
  crackGeom.setAttribute('normal', new THREE.Float32BufferAttribute(crackNormals, 3));
  crackGeom.setIndex(crackIndices);
  const crackMesh = new THREE.Mesh(crackGeom, matTarCrack);
  crackMesh.name = 'sealed_pavement_cracks';
  crackMesh.userData.citation = 'inferred: typical weathered hot-mix asphalt crack sealing';
  surfaceDetailGroup.add(crackMesh);

  root.add(surfaceDetailGroup);

  // =========================================================================
  // 3. PAVEMENT MARKINGS, TURN ARROWS, 'ONLY' LEGEND & RPMs
  // =========================================================================
  const markingsGroup = new THREE.Group();
  markingsGroup.name = 'pavement_markings_and_rpms';
  markingsGroup.userData.citation = 'MUTCD 2009 Sections 3A.06, 3B.04, 3B.06, 3B.11, 3B.20; NTSB/HAR-17/02 p.3';

  const matPaintWhite = new THREE.MeshStandardMaterial({
    color: 0xf2f2f0,
    roughness: 0.52,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3
  });

  const matPaintYellow = new THREE.MeshStandardMaterial({
    color: 0xeab81c,
    roughness: 0.52,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3
  });

  // 1) Broken white lane lines (3.05 m dash / 9.15 m gap, 0.15 m wide)
  markingsGroup.add(buildDashedStrip({
    x0: X_MIN, x1: X_MAX, zCenter: L.eb.laneLine,
    width: 0.15, dash: 3.05, gap: 9.15, yOffset: 0.012,
    material: matPaintWhite,
    name: 'mark_eb_dashed_lane_line',
    citation: 'MUTCD Section 3B.04 (Broken White Lane Line, 0.15 m wide, 3.05 m dash / 9.15 m gap)'
  }));

  markingsGroup.add(buildDashedStrip({
    x0: X_MIN, x1: X_MAX, zCenter: L.wb.laneLine,
    width: 0.15, dash: 3.05, gap: 9.15, yOffset: 0.012,
    material: matPaintWhite,
    name: 'mark_wb_dashed_lane_line',
    citation: 'MUTCD Section 3B.04 (Broken White Lane Line, 0.15 m wide, 3.05 m dash / 9.15 m gap)'
  }));

  // 2) EB solid yellow median-side edge line (tracks outside EB left-turn lane)
  markingsGroup.add(buildProfiledStrip({
    x0: X_MIN, x1: X_MAX,
    z0Fn: (x) => ebLeftInnerZ(x) - 0.075,
    z1Fn: (x) => ebLeftInnerZ(x) + 0.075,
    zSub: 1, yOffset: 0.012,
    material: matPaintYellow,
    name: 'mark_eb_yellow_left_edge',
    citation: 'MUTCD Section 3B.06 (Left Edge Line Pavement Markings on Divided Highways, 0.15 m solid yellow)'
  }));

  // 3) EB solid white right edge line (tracks outside EB right-turn lane)
  markingsGroup.add(buildProfiledStrip({
    x0: X_MIN, x1: X_MAX,
    z0Fn: (x) => ebRightOuterZ(x) - 0.075,
    z1Fn: (x) => ebRightOuterZ(x) + 0.075,
    zSub: 1, yOffset: 0.012,
    material: matPaintWhite,
    name: 'mark_eb_white_right_edge',
    citation: 'MUTCD Section 3B.06 (Right Edge Line Pavement Markings, 0.15 m solid white)'
  }));

  // 4) EB Left-Turn Lane solid white channelizing line (z = -5.49, x in [-187.45, -45], 0.20 m wide)
  markingsGroup.add(buildProfiledStrip({
    x0: -187.45, x1: X_MAX,
    z0Fn: -5.49 - 0.10,
    z1Fn: -5.49 + 0.10,
    zSub: 1, yOffset: 0.012,
    material: matPaintWhite,
    name: 'mark_eb_left_turn_channel_line',
    citation: 'MUTCD Section 3B.04 (Solid white turn-lane channelizing line, 0.20 m wide)'
  }));

  // 5) EB Right-Turn Lane solid white channelizing line (z = 1.83, x in [-170, -45], 0.20 m wide)
  markingsGroup.add(buildProfiledStrip({
    x0: -170, x1: X_MAX,
    z0Fn: 1.83 - 0.10,
    z1Fn: 1.83 + 0.10,
    zSub: 1, yOffset: 0.012,
    material: matPaintWhite,
    name: 'mark_eb_right_turn_channel_line',
    citation: 'MUTCD Section 3B.04 (Solid white turn-lane channelizing line, 0.20 m wide)'
  }));

  // 6) WB solid white right (north) edge line (z = -36.58)
  markingsGroup.add(buildProfiledStrip({
    x0: X_MIN, x1: X_MAX,
    z0Fn: -36.58 - 0.075,
    z1Fn: -36.58 + 0.075,
    zSub: 1, yOffset: 0.012,
    material: matPaintWhite,
    name: 'mark_wb_white_right_edge',
    citation: 'MUTCD Section 3B.06 (Right Edge Line Pavement Markings, 0.15 m solid white)'
  }));

  // 7) WB solid yellow left (median-side) edge line (z = -29.26)
  markingsGroup.add(buildProfiledStrip({
    x0: X_MIN, x1: X_MAX,
    z0Fn: -29.26 - 0.075,
    z1Fn: -29.26 + 0.075,
    zSub: 1, yOffset: 0.012,
    material: matPaintYellow,
    name: 'mark_wb_yellow_left_edge',
    citation: 'MUTCD Section 3B.06 (Left Edge Line Pavement Markings on Divided Highways, 0.15 m solid yellow)'
  }));

  // 8) Turn-lane arrows & 'ONLY' legends (draped on ctx.roadY)
  function makeTurnArrowDecal(dir) {
    // dir: 'left' (curves toward -Z for EB traffic) or 'right' (curves toward +Z for EB traffic)
    const c = ctx.makeCanvas(256, 256);
    if (c) {
      const g = c.getContext('2d');
      g.clearRect(0, 0, 256, 256);
      g.fillStyle = '#f2f2f0';
      g.strokeStyle = '#f2f2f0';

      g.save();
      if (dir === 'right') {
        g.translate(0, 256);
        g.scale(1, -1);
      }
      // Stem coming from west (left of canvas) and curving north (top of canvas)
      g.beginPath();
      g.moveTo(20, 175);
      g.lineTo(115, 175);
      g.quadraticCurveTo(175, 175, 175, 115);
      g.lineTo(175, 95);
      g.lineTo(222, 95);
      g.lineTo(155, 22);
      g.lineTo(88, 95);
      g.lineTo(135, 95);
      g.lineTo(135, 118);
      g.quadraticCurveTo(135, 138, 112, 138);
      g.lineTo(20, 138);
      g.closePath();
      g.fill();
      g.restore();

      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      return new THREE.MeshStandardMaterial({
        map: tex,
        transparent: true,
        roughness: 0.5,
        metalness: 0.0,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4
      });
    }
    return matPaintWhite;
  }

  function makeOnlyLegendDecal() {
    const c = ctx.makeCanvas(256, 256);
    if (c) {
      const g = c.getContext('2d');
      g.clearRect(0, 0, 256, 256);
      g.save();
      // Rotate so text reads to eastbound drivers (approaching from -X looking +X)
      g.translate(128, 128);
      g.rotate(-Math.PI / 2);
      g.scale(1.0, 2.2); // MUTCD elongated pavement legend aspect
      g.fillStyle = '#f2f2f0';
      g.font = 'bold 58px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('ONLY', 0, 0);
      g.restore();

      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      return new THREE.MeshStandardMaterial({
        map: tex,
        transparent: true,
        roughness: 0.5,
        metalness: 0.0,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4
      });
    }
    return matPaintWhite;
  }

  function buildRoadDecalPatch(xCenter, zCenter, lenX, widthZ, mat, name) {
    const x0 = xCenter - lenX * 0.5;
    const x1 = xCenter + lenX * 0.5;
    const xm = xCenter;
    const z0 = zCenter - widthZ * 0.5;
    const z1 = zCenter + widthZ * 0.5;
    const y0 = ctx.roadY(x0) + 0.015;
    const ym = ctx.roadY(xm) + 0.015;
    const y1 = ctx.roadY(x1) + 0.015;

    const pos = new Float32Array([
      x0, y0, z0,  x0, y0, z1,
      xm, ym, z0,  xm, ym, z1,
      x1, y1, z0,  x1, y1, z1
    ]);
    const norm = new Float32Array([
      0, 1, 0,  0, 1, 0,
      0, 1, 0,  0, 1, 0,
      0, 1, 0,  0, 1, 0
    ]);
    const uv = new Float32Array([
      0, 1,  0, 0,
      0.5, 1,  0.5, 0,
      1, 1,  1, 0
    ]);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geom.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5]);
    const m = new THREE.Mesh(geom, mat);
    m.name = name;
    m.userData.citation = 'MUTCD Section 3B.20 (Turn Lane-Use Arrow and ONLY Pavement Markings)';
    return m;
  }

  const matLeftArrow = makeTurnArrowDecal('left');
  const matRightArrow = makeTurnArrowDecal('right');
  const matOnlyDecal = makeOnlyLegendDecal();

  // 2 Left-turn arrows + ONLY legend in EB left-turn lane (z = -7.32)
  markingsGroup.add(buildRoadDecalPatch(-150, -7.32, 2.44, 1.83, matLeftArrow, 'mark_eb_left_turn_arrow_1'));
  markingsGroup.add(buildRoadDecalPatch(-112, -7.32, 2.44, 2.10, matOnlyDecal, 'mark_eb_left_turn_only_legend'));
  markingsGroup.add(buildRoadDecalPatch(-75, -7.32, 2.44, 1.83, matLeftArrow, 'mark_eb_left_turn_arrow_2'));

  // 1 Right-turn arrow + ONLY legend in EB right-turn lane (z = 3.66)
  markingsGroup.add(buildRoadDecalPatch(-130, 3.66, 2.44, 2.10, matOnlyDecal, 'mark_eb_right_turn_only_legend'));
  markingsGroup.add(buildRoadDecalPatch(-85, 3.66, 2.44, 1.83, matRightArrow, 'mark_eb_right_turn_arrow_1'));

  // 9) Raised Pavement Markers (RPMs) every 12.2 m via InstancedMesh
  const rpmGeom = new THREE.BoxGeometry(0.10, 0.018, 0.10);
  const matRpmClear = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xddeeff,
    emissiveIntensity: 0.25,
    roughness: 0.25,
    metalness: 0.1
  });
  const matRpmAmber = new THREE.MeshStandardMaterial({
    color: 0xffb81c,
    emissive: 0xff9900,
    emissiveIntensity: 0.25,
    roughness: 0.25,
    metalness: 0.1
  });

  const clearRpmCoords = [];
  const amberRpmCoords = [];

  for (let x = X_MIN + 6.1; x <= X_MAX; x += 12.2) {
    // Clear RPMs in gaps of EB and WB dashed lane lines
    clearRpmCoords.push([x, L.eb.laneLine]);
    clearRpmCoords.push([x, L.wb.laneLine]);
    // Clear RPMs on EB auxiliary turn-lane channelizing lines (spaced every 6.1 m)
    if (x >= -187.45) {
      clearRpmCoords.push([x, -5.49]);
      if (x + 6.1 <= X_MAX) clearRpmCoords.push([x + 6.1, -5.49]);
    }
    if (x >= -170) {
      clearRpmCoords.push([x, 1.83]);
      if (x + 6.1 <= X_MAX) clearRpmCoords.push([x + 6.1, 1.83]);
    }
    // Amber RPMs along median-side yellow edge lines
    amberRpmCoords.push([x, ebLeftInnerZ(x)]);
    amberRpmCoords.push([x, -29.26]);
  }

  const instRpmClear = new THREE.InstancedMesh(rpmGeom, matRpmClear, clearRpmCoords.length);
  instRpmClear.name = 'rpms_clear_white';
  instRpmClear.userData.citation = 'MUTCD Section 3B.11 (Raised Pavement Markers, clear/white on lane lines every 12.2 m)';

  const instRpmAmber = new THREE.InstancedMesh(rpmGeom, matRpmAmber, amberRpmCoords.length);
  instRpmAmber.name = 'rpms_amber_yellow';
  instRpmAmber.userData.citation = 'MUTCD Section 3B.11 (Raised Pavement Markers, amber on median yellow edge lines every 12.2 m)';

  const dummy = new THREE.Object3D();
  for (let i = 0; i < clearRpmCoords.length; i++) {
    const [rx, rz] = clearRpmCoords[i];
    const slope = (ctx.roadY(rx + 0.5) - ctx.roadY(rx - 0.5));
    dummy.position.set(rx, ctx.roadY(rx) + 0.009, rz);
    dummy.rotation.set(0, 0, Math.atan2(slope, 1.0));
    dummy.updateMatrix();
    instRpmClear.setMatrixAt(i, dummy.matrix);
  }
  instRpmClear.instanceMatrix.needsUpdate = true;

  for (let i = 0; i < amberRpmCoords.length; i++) {
    const [rx, rz] = amberRpmCoords[i];
    const slope = (ctx.roadY(rx + 0.5) - ctx.roadY(rx - 0.5));
    dummy.position.set(rx, ctx.roadY(rx) + 0.009, rz);
    dummy.rotation.set(0, 0, Math.atan2(slope, 1.0));
    dummy.updateMatrix();
    instRpmAmber.setMatrixAt(i, dummy.matrix);
  }
  instRpmAmber.instanceMatrix.needsUpdate = true;

  markingsGroup.add(instRpmClear);
  markingsGroup.add(instRpmAmber);

  root.add(markingsGroup);

  // =========================================================================
  // 4. ROADSIDE SIGNS (Breakaway low-profile rural signs <= 2.5 m tall)
  // =========================================================================
  const signsGroup = new THREE.Group();
  signsGroup.name = 'roadside_signs';
  signsGroup.userData.citation = `${CITE.speed}; ${CITE.noObstruction}; MUTCD 2009 Chapter 2A/2B/2C`;

  // Helper to clamp total sign height <= 2.45 m inside the keep-clear corridor
  function clampSignHeight(signObj, maxH = 2.42) {
    signObj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(signObj);
    const h = box.max.y - box.min.y;
    if (h > maxH && h > 0.1) {
      const s = maxH / h;
      signObj.scale.set(s, s, s);
    }
  }

  // 1) EB SPEED LIMIT 65 at x = -600, z = 6.0 (facing -X toward EB drivers: rotation.y = +PI/2)
  const signSpeedEB = assets.sign({
    id: 'sign_speed_eb_600',
    kind: 'speed_limit',
    speed: 65,
    w: 0.76,
    h: 0.91,
    mountHeight: 1.45,
    rural: true
  });
  clampSignHeight(signSpeedEB, 2.40);
  signSpeedEB.position.set(-600, ctx.groundY(-600, 6.0), 6.0);
  signSpeedEB.rotation.y = Math.PI / 2;
  signSpeedEB.name = 'sign_eb_speed_limit_65';
  signSpeedEB.userData.citation = CITE.speed;
  signsGroup.add(signSpeedEB);

  // 2) EB Intersection / Side-Road Warning Sign (W2-2) at x = -480, z = 6.0 (facing -X)
  const signWarnEB = assets.sign({
    id: 'sign_warn_side_road_480',
    kind: 'generic',
    text: 'SIDE ROAD\nAHEAD',
    w: 0.85,
    h: 0.85,
    mountHeight: 1.45,
    rural: true,
    bg: '#f2a900',
    fg: '#111111'
  });
  // Add an actual diamond warning plate on the front of the post for authentic W2-2 silhouette
  {
    const c = ctx.makeCanvas(256, 256);
    let warnMat;
    if (c) {
      const g = c.getContext('2d');
      g.fillStyle = '#f2a900';
      g.fillRect(0, 0, 256, 256);
      g.strokeStyle = '#111111';
      g.lineWidth = 10;
      g.strokeRect(10, 10, 236, 236);
      // Draw W2-2 graphic symbol (vertical mainline with right side-road stem) in rotated diamond space
      g.save();
      g.translate(128, 128);
      g.rotate(-Math.PI / 4);
      g.fillStyle = '#111111';
      g.fillRect(-16, -75, 32, 150);
      g.fillRect(16, -16, 62, 32);
      g.restore();
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      warnMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.15 });
    } else {
      warnMat = new THREE.MeshStandardMaterial({ color: 0xf2a900, roughness: 0.35, metalness: 0.15 });
    }
    const diamondPlate = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.72, 0.012), warnMat);
    diamondPlate.rotation.z = Math.PI / 4;
    diamondPlate.position.set(0, 1.85, -0.05);
    diamondPlate.name = 'w2_2_diamond_face';
    signWarnEB.add(diamondPlate);
  }
  clampSignHeight(signWarnEB, 2.40);
  signWarnEB.position.set(-480, ctx.groundY(-480, 6.0), 6.0);
  signWarnEB.rotation.y = Math.PI / 2;
  signWarnEB.name = 'sign_eb_w2_2_side_road_warning';
  signWarnEB.userData.citation = 'inferred: MUTCD W2-2 Side Road Warning Sign on rural highway approach';
  signsGroup.add(signWarnEB);

  // 3) EB Mile Marker 29 post (green, small) at x = -250, z = 5.4 (facing -X)
  const signMile29 = assets.sign({
    id: 'sign_mile_marker_29',
    kind: 'generic',
    text: 'MILE\n29',
    w: 0.30,
    h: 0.65,
    mountHeight: 1.15,
    rural: true,
    bg: '#00653a',
    fg: '#ffffff'
  });
  clampSignHeight(signMile29, 1.90);
  signMile29.position.set(-250, ctx.groundY(-250, 5.4), 5.4);
  signMile29.rotation.y = Math.PI / 2;
  signMile29.name = 'sign_eb_mile_marker_29';
  signMile29.userData.citation = 'inferred: MUTCD D10-1a Reference Location Sign (Mile 29)';
  signsGroup.add(signMile29);

  // 4) EB Advance Street Name Sign 'NE 140TH CT' at x = -250, z = 6.6 (facing -X)
  const signAdvanceStreet = assets.sign({
    id: 'sign_advance_ne_140th_ct',
    kind: 'generic',
    text: 'NE 140TH CT\nNEXT RIGHT',
    w: 1.10,
    h: 0.45,
    mountHeight: 1.65,
    rural: true,
    bg: '#00653a',
    fg: '#ffffff'
  });
  clampSignHeight(signAdvanceStreet, 2.35);
  signAdvanceStreet.position.set(-250, ctx.groundY(-250, 6.6), 6.6);
  signAdvanceStreet.rotation.y = Math.PI / 2;
  signAdvanceStreet.name = 'sign_eb_advance_ne_140th_ct';
  signAdvanceStreet.userData.citation = 'inferred: MUTCD D3-2 Advance Street Name Sign for NE 140th Ct';
  signsGroup.add(signAdvanceStreet);

  // 5) WB SPEED LIMIT 65 at x = -120, z = -40.5 (facing +X toward WB drivers: rotation.y = -PI/2)
  const signSpeedWB = assets.sign({
    id: 'sign_speed_wb_120',
    kind: 'speed_limit',
    speed: 65,
    w: 0.76,
    h: 0.91,
    mountHeight: 1.45,
    rural: true
  });
  clampSignHeight(signSpeedWB, 2.40);
  signSpeedWB.position.set(-120, ctx.groundY(-120, -40.5), -40.5);
  signSpeedWB.rotation.y = -Math.PI / 2;
  signSpeedWB.name = 'sign_wb_speed_limit_65';
  signSpeedWB.userData.citation = CITE.speed;
  signsGroup.add(signSpeedWB);

  root.add(signsGroup);

  // =========================================================================
  // 5. FLEXIBLE WHITE DELINEATOR POSTS (Every 60 m on both outer shoulders)
  // =========================================================================
  const delineatorsGroup = new THREE.Group();
  delineatorsGroup.name = 'flexible_delineator_posts';
  delineatorsGroup.userData.citation = 'MUTCD Section 3F.02-3F.04 (Flexible roadside delineators, 1.2 m height, 60 m spacing)';

  const delinXs = [];
  for (let x = -900; x <= -60; x += 60) {
    delinXs.push(x);
  }
  const delinCount = delinXs.length * 2; // EB south outer shoulder + WB north outer shoulder

  const postGeom = new THREE.BoxGeometry(0.025, 1.20, 0.085);
  postGeom.translate(0, 0.60, 0);
  const bandGeom = new THREE.BoxGeometry(0.032, 0.14, 0.090);
  bandGeom.translate(0, 1.06, 0);

  const matDelinPost = new THREE.MeshStandardMaterial({
    color: 0xf4f5f7,
    roughness: 0.42,
    metalness: 0.05
  });
  const matDelinRefl = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xe8f0ff,
    emissiveIntensity: 0.35,
    roughness: 0.2,
    metalness: 0.15
  });

  const instDelinPost = new THREE.InstancedMesh(postGeom, matDelinPost, delinCount);
  instDelinPost.name = 'delineator_posts_white';
  instDelinPost.userData.citation = 'MUTCD Section 3F.03 (1.2 m flexible white polymer delineator posts)';

  const instDelinBand = new THREE.InstancedMesh(bandGeom, matDelinRefl, delinCount);
  instDelinBand.name = 'delineator_reflective_bands';
  instDelinBand.userData.citation = 'MUTCD Section 3F.03 (Retroreflective white sheeting on top of delineator posts)';

  let dIdx = 0;
  for (let i = 0; i < delinXs.length; i++) {
    const x = delinXs[i];
    // EB outer shoulder edge + 0.55 m
    const zEB = ebRightShoulderOuterZ(x) + 0.55;
    const yEB = ctx.groundY(x, zEB);
    dummy.position.set(x, yEB, zEB);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    instDelinPost.setMatrixAt(dIdx, dummy.matrix);
    instDelinBand.setMatrixAt(dIdx, dummy.matrix);
    dIdx++;

    // WB outer shoulder edge - 0.55 m
    const zWB = -38.10 - 0.55;
    const yWB = ctx.groundY(x, zWB);
    dummy.position.set(x, yWB, zWB);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    instDelinPost.setMatrixAt(dIdx, dummy.matrix);
    instDelinBand.setMatrixAt(dIdx, dummy.matrix);
    dIdx++;
  }
  instDelinPost.instanceMatrix.needsUpdate = true;
  instDelinBand.instanceMatrix.needsUpdate = true;

  delineatorsGroup.add(instDelinPost);
  delineatorsGroup.add(instDelinBand);
  root.add(delineatorsGroup);

  // =========================================================================
  // 6. MEDIAN SWALE DRAINAGE CULVERT HEADWALL PAIR AT X = -520
  // =========================================================================
  const culvertGroup = new THREE.Group();
  culvertGroup.name = 'median_drainage_culvert_x520';
  culvertGroup.userData.citation = 'inferred: typical FDOT precast concrete median swale cross-drain culvert and mitered headwall pair at x=-520 (flush/low <= 0.45 m)';

  const cx = -520;
  const cz = L.median.center; // -15.24
  const swaleY = ctx.groundY(cx, cz);

  const matConcrete = ctx.surface('concrete', { color: 0x9b9992, roughness: 0.85 });
  const matCulvertInterior = new THREE.MeshStandardMaterial({ color: 0x202224, roughness: 0.95 });
  const matIronGrate = new THREE.MeshStandardMaterial({ color: 0x3b3530, roughness: 0.7, metalness: 0.6 });

  // Buried concrete pipe barrel (running along X in the median swale, low profile <= 0.40 m above swale invert)
  const pipeLen = 6.8;
  const pipeRadius = 0.36;
  const pipeBarrel = new THREE.Mesh(
    new THREE.CylinderGeometry(pipeRadius, pipeRadius, pipeLen, 16, 1, true),
    matConcrete
  );
  pipeBarrel.rotation.z = Math.PI / 2;
  pipeBarrel.position.set(cx, swaleY + 0.04, cz);
  pipeBarrel.name = 'culvert_concrete_pipe_barrel';
  culvertGroup.add(pipeBarrel);

  // Dark pipe openings at both ends
  const endCapGeom = new THREE.CircleGeometry(pipeRadius * 0.88, 16);
  const endWest = new THREE.Mesh(endCapGeom, matCulvertInterior);
  endWest.rotation.y = -Math.PI / 2;
  endWest.position.set(cx - pipeLen * 0.5 + 0.02, swaleY + 0.04, cz);
  culvertGroup.add(endWest);

  const endEast = new THREE.Mesh(endCapGeom, matCulvertInterior);
  endEast.rotation.y = Math.PI / 2;
  endEast.position.set(cx + pipeLen * 0.5 - 0.02, swaleY + 0.04, cz);
  culvertGroup.add(endEast);

  // Pair of low concrete headwalls + sloped mitered aprons & safety grates at x = -523.4 and x = -516.6
  function buildHeadwallEnd(endX, dirSign, label) {
    const hw = new THREE.Group();
    hw.name = label;

    // Concrete headwall collar (0.42 m above swale ground, well under 0.6 m sightline limit)
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.52, 2.20), matConcrete);
    wall.position.set(endX, swaleY + 0.16, cz);
    hw.add(wall);

    // Flared wingwalls
    const wingLeft = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.38, 0.18), matConcrete);
    wingLeft.position.set(endX + dirSign * 0.38, swaleY + 0.09, cz - 1.18);
    wingLeft.rotation.y = -dirSign * 0.32;
    hw.add(wingLeft);

    const wingRight = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.38, 0.18), matConcrete);
    wingRight.position.set(endX + dirSign * 0.38, swaleY + 0.09, cz + 1.18);
    wingRight.rotation.y = dirSign * 0.32;
    hw.add(wingRight);

    // Concrete scour apron slab
    const apron = new THREE.Mesh(new THREE.BoxGeometry(1.10, 0.10, 2.40), matConcrete);
    apron.position.set(endX + dirSign * 0.45, swaleY - 0.02, cz);
    hw.add(apron);

    // Traversable steel safety bars across the mitered opening (FDOT standard for median cross drains)
    for (let b = -2; b <= 2; b++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.95, 6), matIronGrate);
      bar.rotation.z = dirSign * 1.15;
      bar.position.set(endX + dirSign * 0.42, swaleY + 0.16, cz + b * 0.22);
      hw.add(bar);
    }

    return hw;
  }

  culvertGroup.add(buildHeadwallEnd(cx - pipeLen * 0.5, -1, 'culvert_headwall_west'));
  culvertGroup.add(buildHeadwallEnd(cx + pipeLen * 0.5, +1, 'culvert_headwall_east'));

  root.add(culvertGroup);

  return root;
}
