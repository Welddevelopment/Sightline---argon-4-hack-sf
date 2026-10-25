// r3_east — US-27A East mainline (x=45..800), WB left-turn lane, markings, signs, delineators, drainage culvert & driveway apron
export default function region(THREE, assets, ctx) {
  const root = new THREE.Group();
  root.name = 'region_r3_east';
  root.userData.citation = 'NTSB/HAR-17/02 p.1, p.3, p.22-23, p.29 (US-27A east of NE 140th Ct, 2.15% grade leveling at x=+100m, WB turn lane, culvert, signage)';

  const L = ctx.layout;
  const CITE = L.cite || {};
  const X_MIN = 45;
  const X_MAX = 800;
  const STEP_X = 5;

  // ---------------------------------------------------------------------------
  // Materials
  // ---------------------------------------------------------------------------
  const matAsphaltMain = ctx.surface('asphalt', { color: 0x3a3c3f, roughness: 0.82 });
  const matAsphaltTurn = ctx.surface('asphalt', { color: 0x3d3f42, roughness: 0.84 });
  const matShoulder = ctx.surface('asphalt', { color: 0x45474b, roughness: 0.87 });
  const matGravel = ctx.surface('gravel', { color: 0xb8b3a8, roughness: 0.90 });
  const matConcrete = ctx.surface('concrete', { color: 0x9c9a94, roughness: 0.84 });

  const matWheelWear = new THREE.MeshStandardMaterial({
    color: 0x26282a,
    roughness: 0.72,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const matPatch = new THREE.MeshStandardMaterial({
    color: 0x303235,
    roughness: 0.88,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });

  const matCrackTar = new THREE.MeshStandardMaterial({
    color: 0x1a1b1d,
    roughness: 0.45,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const matRumble = new THREE.MeshStandardMaterial({
    color: 0x2f3134,
    roughness: 0.92,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });

  const matPaintWhite = new THREE.MeshStandardMaterial({
    color: 0xf2f2f2,
    roughness: 0.52,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });

  const matPaintYellow = new THREE.MeshStandardMaterial({
    color: 0xeab81c,
    roughness: 0.52,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });

  const matSteelPipe = new THREE.MeshStandardMaterial({
    color: 0x6a6e73,
    roughness: 0.6,
    metalness: 0.65,
    side: THREE.DoubleSide,
  });

  const matCulvertDark = new THREE.MeshStandardMaterial({
    color: 0x111214,
    roughness: 0.95,
    metalness: 0.0,
  });

  // ---------------------------------------------------------------------------
  // Geometry Builders (Road Profile Strips)
  // ---------------------------------------------------------------------------
  function buildStripGeometry(x0, x1, z0Fn, z1Fn, yOffset = 0, step = STEP_X, useGroundY = false) {
    const len = x1 - x0;
    const n = Math.max(1, Math.ceil(len / step));
    const numVerts = (n + 1) * 2;
    const positions = new Float32Array(numVerts * 3);
    const normals = new Float32Array(numVerts * 3);
    const uvs = new Float32Array(numVerts * 2);
    const indices = [];

    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + t * len;
      const z0 = typeof z0Fn === 'function' ? z0Fn(x) : z0Fn;
      const z1 = typeof z1Fn === 'function' ? z1Fn(x) : z1Fn;
      const y0 = (useGroundY ? ctx.groundY(x, z0) : ctx.roadY(x)) + yOffset;
      const y1 = (useGroundY ? ctx.groundY(x, z1) : ctx.roadY(x)) + yOffset;

      const vIdx = i * 2;
      positions[vIdx * 3 + 0] = x;
      positions[vIdx * 3 + 1] = y0;
      positions[vIdx * 3 + 2] = z0;

      positions[(vIdx + 1) * 3 + 0] = x;
      positions[(vIdx + 1) * 3 + 1] = y1;
      positions[(vIdx + 1) * 3 + 2] = z1;

      normals[vIdx * 3 + 0] = 0;
      normals[vIdx * 3 + 1] = 1;
      normals[vIdx * 3 + 2] = 0;

      normals[(vIdx + 1) * 3 + 0] = 0;
      normals[(vIdx + 1) * 3 + 1] = 1;
      normals[(vIdx + 1) * 3 + 2] = 0;

      uvs[vIdx * 2 + 0] = x;
      uvs[vIdx * 2 + 1] = z0;
      uvs[(vIdx + 1) * 2 + 0] = x;
      uvs[(vIdx + 1) * 2 + 1] = z1;

      if (i < n) {
        const a = vIdx;
        const b = vIdx + 1;
        const c = vIdx + 2;
        const d = vIdx + 3;
        indices.push(a, b, c, b, d, c);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    return geom;
  }

  function addStripMesh(parent, name, citation, x0, x1, z0Fn, z1Fn, mat, yOffset = 0, step = STEP_X, useGroundY = false) {
    const geom = buildStripGeometry(x0, x1, z0Fn, z1Fn, yOffset, step, useGroundY);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = name;
    mesh.userData.citation = citation;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function buildDashedStripGeometry(x0, x1, zCenter, width, dashLen, gapLen, yOffset = 0.012) {
    const cycle = dashLen + gapLen;
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    let vCount = 0;
    const halfW = width * 0.5;

    const firstK = Math.floor(x0 / cycle);
    const lastK = Math.ceil(x1 / cycle);

    for (let k = firstK; k <= lastK; k++) {
      const dStart = Math.max(x0, k * cycle);
      const dEnd = Math.min(x1, k * cycle + dashLen);
      if (dEnd <= dStart + 0.05) continue;

      const xm = 0.5 * (dStart + dEnd);
      const xs = [dStart, xm, dEnd];
      for (let i = 0; i < xs.length; i++) {
        const x = xs[i];
        const y = ctx.roadY(x) + yOffset;
        positions.push(x, y, zCenter - halfW);
        positions.push(x, y, zCenter + halfW);
        normals.push(0, 1, 0, 0, 1, 0);
        uvs.push(x, 0, x, 1);
      }
      indices.push(
        vCount + 0, vCount + 1, vCount + 2,
        vCount + 1, vCount + 3, vCount + 2,
        vCount + 2, vCount + 3, vCount + 4,
        vCount + 3, vCount + 5, vCount + 4
      );
      vCount += 6;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    return geom;
  }

  // Helper for WB inner edge & shoulder taper
  const wbTurnEnd = L.wbLeftTurn.x[1];   // 187.45
  const wbTaperEnd = L.wbLeftTurn.taperTo; // 220

  function wbInnerLaneZ(x) {
    if (x <= wbTurnEnd) return L.wbLeftTurn.z[1]; // -25.60
    if (x >= wbTaperEnd) return L.wb.lanes[1];    // -29.26
    const t = (x - wbTurnEnd) / (wbTaperEnd - wbTurnEnd);
    return L.wbLeftTurn.z[1] + t * (L.wb.lanes[1] - L.wbLeftTurn.z[1]);
  }

  function wbInnerShoulderOuterZ(x) {
    return wbInnerLaneZ(x) + 0.61; // 2-ft inside shoulder
  }

  // ---------------------------------------------------------------------------
  // 1. Pavement, Shoulders, Rumble Strips, Wear & Patches
  // ---------------------------------------------------------------------------
  const grpPavement = new THREE.Group();
  grpPavement.name = 'pavement_east';
  grpPavement.userData.citation = CITE.lanes || 'NTSB/HAR-17/02 p.3, p.22';
  root.add(grpPavement);

  // EB Mainline Lanes (z = -5.49 to +1.83)
  addStripMesh(
    grpPavement,
    'road_eb_mainline',
    CITE.lanes,
    X_MIN, X_MAX,
    L.eb.lanes[0], L.eb.lanes[1],
    matAsphaltMain, 0.0, STEP_X
  );

  // EB Right (South) Shoulder (z = +1.83 to +3.35)
  addStripMesh(
    grpPavement,
    'shoulder_eb_right',
    CITE.lanes,
    X_MIN, X_MAX,
    L.eb.rightShoulder[0], L.eb.rightShoulder[1],
    matShoulder, 0.0, STEP_X
  );

  // EB Left (North/Median) Shoulder (z = -6.10 to -5.49)
  addStripMesh(
    grpPavement,
    'shoulder_eb_left',
    CITE.lanes,
    X_MIN, X_MAX,
    L.eb.leftShoulder[0], L.eb.leftShoulder[1],
    matShoulder, 0.0, STEP_X
  );

  // WB Mainline Lanes (z = -36.58 to -29.26)
  addStripMesh(
    grpPavement,
    'road_wb_mainline',
    CITE.lanes,
    X_MIN, X_MAX,
    L.wb.lanes[0], L.wb.lanes[1],
    matAsphaltMain, 0.0, STEP_X
  );

  // WB Right (North) Shoulder (z = -38.10 to -36.58)
  addStripMesh(
    grpPavement,
    'shoulder_wb_right',
    CITE.lanes,
    X_MIN, X_MAX,
    L.wb.rightShoulder[0], L.wb.rightShoulder[1],
    matShoulder, 0.0, STEP_X
  );

  // WB Left-Turn Lane (x = 45 to 187.45 full width, plus taper to 220)
  addStripMesh(
    grpPavement,
    'road_wb_left_turn_lane',
    CITE.turnLanes,
    X_MIN, wbTaperEnd,
    L.wb.lanes[1],
    (x) => wbInnerLaneZ(x),
    matAsphaltTurn, 0.0, 4
  );

  // WB Left (Median) Shoulder along turn lane, taper, and mainline east of 220
  addStripMesh(
    grpPavement,
    'shoulder_wb_left',
    CITE.turnLanes,
    X_MIN, X_MAX,
    (x) => wbInnerLaneZ(x),
    (x) => wbInnerShoulderOuterZ(x),
    matShoulder, 0.0, 4
  );

  // Subtle shoulder edge bevels to blend with terrain (20 cm skirt)
  const shoulderSkirts = [
    { name: 'skirt_eb_south', z0: L.eb.rightShoulder[1], z1: L.eb.rightShoulder[1] + 0.25 },
    { name: 'skirt_eb_north', z0: L.eb.leftShoulder[0] - 0.20, z1: L.eb.leftShoulder[0] },
    { name: 'skirt_wb_north', z0: L.wb.rightShoulder[0] - 0.25, z1: L.wb.rightShoulder[0] },
  ];
  for (const s of shoulderSkirts) {
    addStripMesh(
      grpPavement,
      s.name,
      'inferred: asphalt shoulder edge bevel',
      X_MIN, X_MAX,
      s.z0, s.z1,
      matShoulder, -0.015, 8
    );
  }

  // Wheel-path wear strips (2 tracks per travel lane)
  const grpWear = new THREE.Group();
  grpWear.name = 'pavement_wear_and_cracks';
  grpWear.userData.citation = 'inferred: typical weathered rural highway wheel-path aggregate polishing and crack sealing';
  grpPavement.add(grpWear);

  const laneCenters = [
    { name: 'eb_outside', z: L.eb.outsideCenter, x0: X_MIN, x1: X_MAX },
    { name: 'eb_inside', z: L.eb.insideCenter, x0: X_MIN, x1: X_MAX },
    { name: 'wb_inside', z: L.wb.insideCenter, x0: X_MIN, x1: X_MAX },
    { name: 'wb_outside', z: L.wb.outsideCenter, x0: X_MIN, x1: X_MAX },
    { name: 'wb_turn', z: L.wbLeftTurn.center, x0: X_MIN, x1: wbTurnEnd },
  ];

  for (const lc of laneCenters) {
    for (const offset of [-0.88, 0.88]) {
      const zTrack = lc.z + offset;
      addStripMesh(
        grpWear,
        `wear_${lc.name}_${offset > 0 ? 'r' : 'l'}`,
        'inferred: wheel track wear',
        lc.x0, lc.x1,
        zTrack - 0.32, zTrack + 0.32,
        matWheelWear, 0.004, 10
      );
    }
    // Center oil/drip streak
    addStripMesh(
      grpWear,
      `oil_${lc.name}`,
      'inferred: center lane oil patina',
      lc.x0, lc.x1,
      lc.z - 0.18, lc.z + 0.18,
      matWheelWear, 0.003, 10
    );
  }

  // Longitudinal construction joint tar lines & transverse crack seals
  addStripMesh(grpWear, 'joint_eb_center', 'inferred: longitudinal asphalt joint seal', X_MIN, X_MAX, L.eb.laneLine - 0.03, L.eb.laneLine + 0.03, matCrackTar, 0.006, 8);
  addStripMesh(grpWear, 'joint_wb_center', 'inferred: longitudinal asphalt joint seal', X_MIN, X_MAX, L.wb.laneLine - 0.03, L.wb.laneLine + 0.03, matCrackTar, 0.006, 8);

  const randCrack = ctx.rand(301);
  const crackPositions = [];
  const crackNormals = [];
  const crackUvs = [];
  const crackIndices = [];
  let crackVert = 0;

  for (let xBase = 55; xBase < 790; xBase += 18 + randCrack() * 22) {
    const isEB = randCrack() > 0.45;
    const zStart = isEB ? (L.eb.lanes[0] + randCrack() * 2.5) : (L.wb.lanes[0] + randCrack() * 2.5);
    const zSpan = 2.8 + randCrack() * 4.2;
    const zEnd = Math.min(isEB ? L.eb.lanes[1] : L.wb.lanes[1], zStart + zSpan);
    const segs = 5;
    const halfW = 0.025;

    for (let s = 0; s <= segs; s++) {
      const f = s / segs;
      const z = zStart + f * (zEnd - zStart);
      const x = xBase + (randCrack() - 0.5) * 0.45;
      const y = ctx.roadY(x) + 0.007;
      crackPositions.push(x - halfW, y, z, x + halfW, y, z);
      crackNormals.push(0, 1, 0, 0, 1, 0);
      crackUvs.push(0, f, 1, f);
    }
    for (let s = 0; s < segs; s++) {
      const a = crackVert + s * 2;
      crackIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    crackVert += (segs + 1) * 2;
  }

  if (crackPositions.length > 0) {
    const crackGeom = new THREE.BufferGeometry();
    crackGeom.setAttribute('position', new THREE.Float32BufferAttribute(crackPositions, 3));
    crackGeom.setAttribute('normal', new THREE.Float32BufferAttribute(crackNormals, 3));
    crackGeom.setAttribute('uv', new THREE.Float32BufferAttribute(crackUvs, 2));
    crackGeom.setIndex(crackIndices);
    const crackMesh = new THREE.Mesh(crackGeom, matCrackTar);
    crackMesh.name = 'transverse_crack_seals';
    crackMesh.userData.citation = 'inferred: asphalt maintenance crack sealing';
    grpWear.add(crackMesh);
  }

  // Occasional asphalt repair patches
  const patchSpecs = [
    { x0: 142, x1: 156, z0: -1.6, z1: 1.65 },
    { x0: 318, x1: 329, z0: -5.3, z1: -2.1 },
    { x0: 465, x1: 482, z0: -36.3, z1: -33.1 },
    { x0: 640, x1: 654, z0: -32.7, z1: -29.5 },
    { x0: 95, x1: 106, z0: -28.9, z1: -26.0 },
  ];
  patchSpecs.forEach((p, idx) => {
    addStripMesh(
      grpWear,
      `asphalt_patch_${idx}`,
      'inferred: localized pavement repair patch',
      p.x0, p.x1, p.z0, p.z1,
      matPatch, 0.005, 3
    );
  });

  // Shoulder rumble strips (continuous scored strips along outside shoulders)
  addStripMesh(
    grpWear,
    'rumble_strip_eb_right',
    'inferred: FDOT rural highway shoulder rumble strip',
    X_MIN, X_MAX,
    L.eb.rightShoulder[0] + 0.18, L.eb.rightShoulder[0] + 0.58,
    matRumble, 0.005, 6
  );
  addStripMesh(
    grpWear,
    'rumble_strip_wb_right',
    'inferred: FDOT rural highway shoulder rumble strip',
    X_MIN, X_MAX,
    L.wb.rightShoulder[1] - 0.58, L.wb.rightShoulder[1] - 0.18,
    matRumble, 0.005, 6
  );

  // ---------------------------------------------------------------------------
  // 2. Pavement Markings & Raised Pavement Markers (RPMs)
  // ---------------------------------------------------------------------------
  const grpMarkings = new THREE.Group();
  grpMarkings.name = 'markings_east';
  grpMarkings.userData.citation = 'MUTCD 2009 Sections 3A.06, 3B.04, 3B.06, 3B.20; NTSB/HAR-17/02 p.3, p.22';
  root.add(grpMarkings);

  const lineW = 0.15;
  const turnLineW = 0.20;

  // EB Solid White Right Edge Line (z = +1.83)
  addStripMesh(
    grpMarkings,
    'mark_eb_right_edge',
    'MUTCD Section 3B.06 (solid white right edge line, 0.15 m)',
    X_MIN, X_MAX,
    L.eb.lanes[1] - lineW * 0.5, L.eb.lanes[1] + lineW * 0.5,
    matPaintWhite, 0.012, STEP_X
  );

  // EB Solid Yellow Left Edge Line (z = -5.49)
  addStripMesh(
    grpMarkings,
    'mark_eb_left_edge',
    'MUTCD Section 3B.06 (solid yellow median-side edge line, 0.15 m)',
    X_MIN, X_MAX,
    L.eb.lanes[0] - lineW * 0.5, L.eb.lanes[0] + lineW * 0.5,
    matPaintYellow, 0.012, STEP_X
  );

  // WB Solid White Right Edge Line (z = -36.58)
  addStripMesh(
    grpMarkings,
    'mark_wb_right_edge',
    'MUTCD Section 3B.06 (solid white right edge line, 0.15 m)',
    X_MIN, X_MAX,
    L.wb.lanes[0] - lineW * 0.5, L.wb.lanes[0] + lineW * 0.5,
    matPaintWhite, 0.012, STEP_X
  );

  // WB Solid Yellow Left Edge Line (follows turn lane inner edge, taper, then WB inner lane edge)
  addStripMesh(
    grpMarkings,
    'mark_wb_left_edge',
    'MUTCD Section 3B.06 (solid yellow median-side edge line along WB turn lane and mainline, 0.15 m)',
    X_MIN, X_MAX,
    (x) => wbInnerLaneZ(x) - lineW * 0.5,
    (x) => wbInnerLaneZ(x) + lineW * 0.5,
    matPaintYellow, 0.012, 4
  );

  // WB Solid White Turn-Lane Channelizing Line (z = -29.26, x = 45 to 187.45)
  addStripMesh(
    grpMarkings,
    'mark_wb_turn_channel_line',
    'MUTCD Section 3B.04 (solid white turn-lane channelizing line, 0.20 m)',
    X_MIN, wbTurnEnd,
    L.wb.lanes[1] - turnLineW * 0.5, L.wb.lanes[1] + turnLineW * 0.5,
    matPaintWhite, 0.012, 4
  );

  // Dotted white turn-lane extension across taper entry (x = 187.45 to 205)
  const geomTurnExtension = buildDashedStripGeometry(wbTurnEnd, 205, L.wb.lanes[1], 0.15, 0.9, 1.8, 0.012);
  const meshTurnExtension = new THREE.Mesh(geomTurnExtension, matPaintWhite);
  meshTurnExtension.name = 'mark_wb_turn_taper_dots';
  meshTurnExtension.userData.citation = 'inferred: MUTCD Section 3B.04 dotted white turn-lane entrance guide line';
  grpMarkings.add(meshTurnExtension);

  // EB Dashed White Lane Line (z = -1.83, 3.05m dash / 9.15m gap)
  const geomEbDashed = buildDashedStripGeometry(X_MIN, X_MAX, L.eb.laneLine, lineW, 3.05, 9.15, 0.012);
  const meshEbDashed = new THREE.Mesh(geomEbDashed, matPaintWhite);
  meshEbDashed.name = 'mark_eb_lane_line';
  meshEbDashed.userData.citation = 'MUTCD Section 3B.04 (broken white lane line, 3.05 m dash / 9.15 m gap)';
  grpMarkings.add(meshEbDashed);

  // WB Dashed White Lane Line (z = -32.92, 3.05m dash / 9.15m gap)
  const geomWbDashed = buildDashedStripGeometry(X_MIN, X_MAX, L.wb.laneLine, lineW, 3.05, 9.15, 0.012);
  const meshWbDashed = new THREE.Mesh(geomWbDashed, matPaintWhite);
  meshWbDashed.name = 'mark_wb_lane_line';
  meshWbDashed.userData.citation = 'MUTCD Section 3B.04 (broken white lane line, 3.05 m dash / 9.15 m gap)';
  grpMarkings.add(meshWbDashed);

  // ---------------------------------------------------------------------------
  // WB Left-Turn Arrows & "ONLY" Legends
  // ---------------------------------------------------------------------------
  function makeTurnArrowMaterial() {
    const c = ctx.makeCanvas(256, 256);
    if (!c) return null;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#f2f2f2';
    g.strokeStyle = '#f2f2f2';

    // Draw standard MUTCD left-turn arrow facing UP (-Y in canvas) with left curve
    // Tail at bottom right-of-center, curving left to arrowhead on left side
    g.beginPath();
    // Stem
    g.moveTo(145, 236);
    g.lineTo(175, 236);
    g.lineTo(175, 120);
    g.quadraticCurveTo(175, 72, 125, 72);
    g.lineTo(95, 72);
    g.lineTo(95, 40);
    g.lineTo(28, 87);
    g.lineTo(95, 134);
    g.lineTo(95, 102);
    g.lineTo(122, 102);
    g.quadraticCurveTo(145, 102, 145, 125);
    g.closePath();
    g.fill();

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.1,
      roughness: 0.5,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
  }

  function makeOnlyLegendMaterial() {
    const c = ctx.makeCanvas(256, 256);
    if (!c) return null;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 256);
    g.save();
    g.fillStyle = '#f2f2f2';
    // Elongated highway font for pavement legend
    g.translate(128, 128);
    g.scale(0.65, 1.85);
    g.font = 'bold 76px sans-serif';
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
      alphaTest: 0.1,
      roughness: 0.5,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
  }

  // Fallback procedural vector geometry for Left-Turn Arrow & ONLY (also layered so headless Node and 3D views both have crisp geometry)
  function buildVectorLeftArrow(xCenter, zCenter) {
    const grp = new THREE.Group();
    // WB driver travels in -X direction. Forward is -X; Left turn is toward +Z (south across median).
    const y0 = ctx.roadY(xCenter) + 0.015;
    const slope = (ctx.roadY(xCenter + 1) - ctx.roadY(xCenter - 1)) / 2;

    // Stem along X (from xCenter+1.1 to xCenter-0.2 at z = zCenter - 0.25)
    const stemGeo = new THREE.PlaneGeometry(1.35, 0.22);
    stemGeo.rotateX(-Math.PI / 2);
    const stem = new THREE.Mesh(stemGeo, matPaintWhite);
    stem.position.set(0.42, 0, -0.25);
    grp.add(stem);

    // Turn elbow / cross arm toward +Z
    const armGeo = new THREE.PlaneGeometry(0.24, 0.72);
    armGeo.rotateX(-Math.PI / 2);
    const arm = new THREE.Mesh(armGeo, matPaintWhite);
    arm.position.set(-0.22, 0, 0.02);
    grp.add(arm);

    // Arrowhead pointing +Z (south) at x = -0.22, z = +0.55
    const headShape = new THREE.Shape();
    headShape.moveTo(0, 0.42);
    headShape.lineTo(-0.42, -0.15);
    headShape.lineTo(0.42, -0.15);
    headShape.closePath();
    const headGeo = new THREE.ShapeGeometry(headShape);
    headGeo.rotateX(Math.PI / 2); // +Y in shape becomes +Z in world
    const head = new THREE.Mesh(headGeo, matPaintWhite);
    head.position.set(-0.22, 0, 0.48);
    grp.add(head);

    grp.position.set(xCenter, y0, zCenter);
    grp.rotation.z = Math.atan(slope);
    return grp;
  }

  function buildVectorOnlyLegend(xCenter, zCenter) {
    const grp = new THREE.Group();
    const y0 = ctx.roadY(xCenter) + 0.015;
    const slope = (ctx.roadY(xCenter + 1) - ctx.roadY(xCenter - 1)) / 2;
    // Simple block strokes for O N L Y readable from -X (WB driver approaching from +X looking -X)
    // Letters arranged from north (-Z, left of driver? No: WB driver faces -X, so driver's left is +Z (south) and driver's right is -Z (north).
    // Reading left-to-right for a WB driver means +Z is left, -Z is right: O at +0.75, N at +0.25, L at -0.25, Y at -0.75.
    const bar = (lx, lz, sx, sz, rotY = 0) => {
      const g = new THREE.PlaneGeometry(sx, sz);
      g.rotateX(-Math.PI / 2);
      if (rotY) g.rotateY(rotY);
      const m = new THREE.Mesh(g, matPaintWhite);
      m.position.set(lx, 0, lz);
      grp.add(m);
    };
    const Llen = 1.9;
    const t = 0.11;
    // 'O' around z = +0.78
    bar(0, 0.94, Llen, t);
    bar(0, 0.62, Llen, t);
    bar(Llen * 0.46, 0.78, t, 0.34);
    bar(-Llen * 0.46, 0.78, t, 0.34);
    // 'N' around z = +0.26
    bar(0, 0.42, Llen, t);
    bar(0, 0.10, Llen, t);
    bar(0, 0.26, Llen, t * 0.9, -0.18);
    // 'L' around z = -0.26
    bar(0, -0.10, Llen, t);
    bar(-Llen * 0.46, -0.26, t, 0.34);
    // 'Y' around z = -0.78
    bar(-Llen * 0.25, -0.78, Llen * 0.5, t);
    bar(Llen * 0.25, -0.66, Llen * 0.55, t, 0.22);
    bar(Llen * 0.25, -0.90, Llen * 0.55, t, -0.22);

    grp.position.set(xCenter, y0, zCenter);
    grp.rotation.z = Math.atan(slope);
    return grp;
  }

  const matArrowDecal = makeTurnArrowMaterial();
  const matOnlyDecal = makeOnlyLegendMaterial();

  const arrowStations = [52, 98, 152];
  arrowStations.forEach((ax, i) => {
    const arrowGrp = buildVectorLeftArrow(ax, L.wbLeftTurn.center);
    arrowGrp.name = `mark_wb_turn_arrow_${i + 1}`;
    arrowGrp.userData.citation = 'MUTCD Section 3B.20 (WB left-turn lane pavement arrow)';
    if (matArrowDecal) {
      const decalGeo = buildStripGeometry(ax - 1.3, ax + 1.3, L.wbLeftTurn.center - 1.0, L.wbLeftTurn.center + 1.0, 0.014, 1.3);
      // Remap UVs to [0,1] oriented for WB driver facing -X
      const uvAttr = decalGeo.getAttribute('uv');
      for (let k = 0; k < uvAttr.count; k++) {
        const vx = decalGeo.getAttribute('position').getX(k);
        const vz = decalGeo.getAttribute('position').getZ(k);
        const u = (vz - (L.wbLeftTurn.center - 1.0)) / 2.0;
        const v = (vx - (ax - 1.3)) / 2.6;
        uvAttr.setXY(k, 1 - u, 1 - v);
      }
      const decalMesh = new THREE.Mesh(decalGeo, matArrowDecal);
      decalMesh.name = `mark_wb_turn_arrow_decal_${i + 1}`;
      grpMarkings.add(decalMesh);
    }
    grpMarkings.add(arrowGrp);
  });

  const onlyStations = [74, 126];
  onlyStations.forEach((ox, i) => {
    const onlyGrp = buildVectorOnlyLegend(ox, L.wbLeftTurn.center);
    onlyGrp.name = `mark_wb_turn_only_${i + 1}`;
    onlyGrp.userData.citation = 'MUTCD Section 3B.20 (WB left-turn ONLY pavement legend)';
    if (matOnlyDecal) {
      const decalGeo = buildStripGeometry(ox - 1.3, ox + 1.3, L.wbLeftTurn.center - 1.1, L.wbLeftTurn.center + 1.1, 0.014, 1.3);
      const uvAttr = decalGeo.getAttribute('uv');
      for (let k = 0; k < uvAttr.count; k++) {
        const vx = decalGeo.getAttribute('position').getX(k);
        const vz = decalGeo.getAttribute('position').getZ(k);
        const u = (vz - (L.wbLeftTurn.center - 1.1)) / 2.2;
        const v = (vx - (ox - 1.3)) / 2.6;
        uvAttr.setXY(k, 1 - u, 1 - v);
      }
      const decalMesh = new THREE.Mesh(decalGeo, matOnlyDecal);
      decalMesh.name = `mark_wb_turn_only_decal_${i + 1}`;
      grpMarkings.add(decalMesh);
    }
    grpMarkings.add(onlyGrp);
  });

  // ---------------------------------------------------------------------------
  // Raised Pavement Markers (RPMs) every 12.2 m (InstancedMesh)
  // ---------------------------------------------------------------------------
  const rpmGeo = new THREE.BoxGeometry(0.10, 0.018, 0.10);
  const matRpmClear = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xddeeff,
    emissiveIntensity: 0.25,
    roughness: 0.25,
    metalness: 0.1,
  });
  const matRpmAmber = new THREE.MeshStandardMaterial({
    color: 0xffb81c,
    emissive: 0xff9900,
    emissiveIntensity: 0.28,
    roughness: 0.25,
    metalness: 0.1,
  });

  const clearRpmCoords = [];
  const amberRpmCoords = [];

  for (let x = 48.8; x <= X_MAX - 2; x += 12.2) {
    // EB and WB lane lines (in the gap just past each 3.05m dash)
    clearRpmCoords.push([x + 4.5, L.eb.laneLine]);
    clearRpmCoords.push([x + 4.5, L.wb.laneLine]);
    // WB turn channelizing line (every 6.1m for turn channel)
    if (x <= wbTurnEnd) {
      clearRpmCoords.push([x, L.wb.lanes[1]]);
      if (x + 6.1 <= wbTurnEnd) clearRpmCoords.push([x + 6.1, L.wb.lanes[1]]);
    }
    // Yellow left-edge lines (amber RPMs)
    amberRpmCoords.push([x, L.eb.lanes[0] - 0.05]);
    amberRpmCoords.push([x, wbInnerLaneZ(x) + 0.05]);
  }

  const dummy = new THREE.Object3D();

  const instRpmClear = new THREE.InstancedMesh(rpmGeo, matRpmClear, clearRpmCoords.length);
  instRpmClear.name = 'rpms_clear_white';
  instRpmClear.userData.citation = 'MUTCD Section 3B.11 (clear retroreflective raised pavement markers on white lane lines, 12.2 m spacing)';
  clearRpmCoords.forEach(([rx, rz], idx) => {
    const ry = ctx.roadY(rx) + 0.012;
    const slope = (ctx.roadY(rx + 0.5) - ctx.roadY(rx - 0.5));
    dummy.position.set(rx, ry, rz);
    dummy.rotation.set(0, 0, Math.atan(slope));
    dummy.updateMatrix();
    instRpmClear.setMatrixAt(idx, dummy.matrix);
  });
  instRpmClear.instanceMatrix.needsUpdate = true;
  grpMarkings.add(instRpmClear);

  const instRpmAmber = new THREE.InstancedMesh(rpmGeo, matRpmAmber, amberRpmCoords.length);
  instRpmAmber.name = 'rpms_amber_yellow';
  instRpmAmber.userData.citation = 'MUTCD Section 3B.11 (amber retroreflective raised pavement markers on median yellow edge lines, 12.2 m spacing)';
  amberRpmCoords.forEach(([rx, rz], idx) => {
    const ry = ctx.roadY(rx) + 0.012;
    const slope = (ctx.roadY(rx + 0.5) - ctx.roadY(rx - 0.5));
    dummy.position.set(rx, ry, rz);
    dummy.rotation.set(0, 0, Math.atan(slope));
    dummy.updateMatrix();
    instRpmAmber.setMatrixAt(idx, dummy.matrix);
  });
  instRpmAmber.instanceMatrix.needsUpdate = true;
  grpMarkings.add(instRpmAmber);

  // ---------------------------------------------------------------------------
  // 3. Highway Signage (EB & WB approaches) + Flexible Delineators
  // ---------------------------------------------------------------------------
  const grpSigns = new THREE.Group();
  grpSigns.name = 'signs_and_delineators_east';
  grpSigns.userData.citation = 'NTSB/HAR-17/02 p.1, p.23 (posted 65 mph); MUTCD 2009 Sections 2B.13, 2B.19, 2C.47, 2D.43, 3F.03';
  root.add(grpSigns);

  function placeSign(spec) {
    if (ctx.blocked(spec.x, spec.z)) return null;
    const s = assets.sign(spec.opts);
    s.name = spec.name;
    s.userData.citation = spec.citation;
    s.position.set(spec.x, ctx.groundY(spec.x, spec.z), spec.z);
    s.rotation.y = spec.rotY;
    grpSigns.add(s);
    return s;
  }

  // WB Signs (facing +X toward approaching WB traffic: rotation.y = -Math.PI / 2)
  placeSign({
    name: 'sign_wb_speed_65',
    x: 600,
    z: -40.5,
    rotY: -Math.PI / 2,
    citation: CITE.speed || 'NTSB/HAR-17/02 p.1, p.23 (posted 65 mph)',
    opts: {
      id: 'r3_wb_speed_65',
      kind: 'speed_limit',
      speed: 65,
      w: 0.91,
      h: 1.22,
      mountHeight: 2.13,
      rural: true,
    },
  });

  // Side-road warning sign at x=480 (z=-40.5) with yellow diamond + supplemental plaque
  const signWbWarning = placeSign({
    name: 'sign_wb_side_road_warning',
    x: 480,
    z: -40.5,
    rotY: -Math.PI / 2,
    citation: 'inferred: MUTCD W2-2 side road intersection warning sign ahead of NE 140th Ct',
    opts: {
      id: 'r3_wb_side_road_warn',
      kind: 'generic',
      text: 'SIDE ROAD\nAHEAD',
      w: 0.91,
      h: 0.91,
      bg: '#f5b800',
      fg: '#111111',
      mountHeight: 2.13,
      rural: true,
    },
  });
  // Add diamond warning backing plate with graphical T-stem symbol to make it unmistakably a MUTCD W2-2 diamond
  if (signWbWarning) {
    const diamondGeo = new THREE.BoxGeometry(0.92, 0.92, 0.015);
    diamondGeo.rotateZ(Math.PI / 4);
    const matWarnYellow = new THREE.MeshStandardMaterial({ color: 0xf5b800, roughness: 0.35, metalness: 0.15 });
    const diamondMesh = new THREE.Mesh(diamondGeo, matWarnYellow);
    diamondMesh.position.set(0, 2.58, -0.02);
    diamondMesh.name = 'w2_2_diamond_plate';
    signWbWarning.add(diamondMesh);

    const matBlackSymbol = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 });
    const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.65, 0.018), matBlackSymbol);
    vBar.position.set(0, 2.58, -0.022);
    signWbWarning.add(vBar);
    const sideStub = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.11, 0.018), matBlackSymbol);
    sideStub.position.set(0.16, 2.58, -0.022);
    signWbWarning.add(sideStub);
  }

  // Advance street name sign 'NE 140TH CT' at x=250 (z=-40.5)
  placeSign({
    name: 'sign_wb_advance_ne140',
    x: 250,
    z: -40.5,
    rotY: -Math.PI / 2,
    citation: 'inferred: MUTCD D3-2 advance street name sign for NE 140th Ct',
    opts: {
      id: 'r3_wb_adv_ne140',
      kind: 'generic',
      text: 'NE 140TH CT\n800 FT',
      w: 1.52,
      h: 0.61,
      bg: '#00653a',
      fg: '#ffffff',
      mountHeight: 2.13,
      rural: true,
    },
  });

  // LEFT LANE MUST TURN LEFT in median at x=200 (z=-24.5)
  placeSign({
    name: 'sign_wb_left_lane_must_turn',
    x: 200,
    z: -24.5,
    rotY: -Math.PI / 2,
    citation: 'inferred: MUTCD R3-7 LEFT LANE MUST TURN LEFT sign at WB turn-lane entrance',
    opts: {
      id: 'r3_wb_left_turn_sign',
      kind: 'generic',
      text: 'LEFT LANE\nMUST\nTURN LEFT',
      w: 0.91,
      h: 0.91,
      bg: '#ffffff',
      fg: '#111111',
      mountHeight: 2.13,
      rural: true,
    },
  });

  // EB Signs (facing -X toward approaching EB traffic: rotation.y = +Math.PI / 2)
  placeSign({
    name: 'sign_eb_speed_65',
    x: 150,
    z: 6.5,
    rotY: Math.PI / 2,
    citation: CITE.speed || 'NTSB/HAR-17/02 p.1, p.23 (posted 65 mph)',
    opts: {
      id: 'r3_eb_speed_65',
      kind: 'speed_limit',
      speed: 65,
      w: 0.91,
      h: 1.22,
      mountHeight: 2.13,
      rural: true,
    },
  });

  placeSign({
    name: 'sign_eb_mile_marker',
    x: 360,
    z: 5.5,
    rotY: Math.PI / 2,
    citation: 'inferred: MUTCD D10-1 rural green highway mile marker post',
    opts: {
      id: 'r3_eb_mile_360',
      kind: 'generic',
      text: 'MILE\n14',
      w: 0.30,
      h: 0.91,
      bg: '#00653a',
      fg: '#ffffff',
      mountHeight: 1.25,
      rural: true,
    },
  });

  // Flexible roadside delineator posts every 60 m (InstancedMesh)
  const delinPostGeo = new THREE.BoxGeometry(0.08, 1.15, 0.025);
  delinPostGeo.translate(0, 0.575, 0);
  const delinTabGeo = new THREE.BoxGeometry(0.085, 0.16, 0.032);
  delinTabGeo.translate(0, 1.02, 0);

  const matDelinPost = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.45, metalness: 0.05 });
  const matDelinWhiteTab = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xdddddd,
    emissiveIntensity: 0.3,
    roughness: 0.25,
  });
  const matDelinYellowTab = new THREE.MeshStandardMaterial({
    color: 0xffc400,
    emissive: 0xffaa00,
    emissiveIntensity: 0.3,
    roughness: 0.25,
  });

  const rightDelinCoords = [];
  const leftDelinCoords = [];

  for (let x = 60; x <= 780; x += 60) {
    // EB right shoulder edge (skip near culvert x=116..125 and driveway x=276..284 and car path)
    const zEbRight = 4.0;
    if (!ctx.blocked(x, zEbRight) && Math.abs(x - 120) > 6 && Math.abs(x - 280) > 5) {
      rightDelinCoords.push([x, zEbRight]);
    }
    // WB right shoulder edge
    const zWbRight = -38.75;
    if (!ctx.blocked(x, zWbRight)) {
      rightDelinCoords.push([x, zWbRight]);
    }
    // Median left shoulder edges every 120 m
    if (x % 120 === 0) {
      const zEbLeft = -6.5;
      if (!ctx.blocked(x, zEbLeft)) leftDelinCoords.push([x, zEbLeft]);
      const zWbLeft = wbInnerShoulderOuterZ(x) + 0.4;
      if (!ctx.blocked(x, zWbLeft)) leftDelinCoords.push([x, zWbLeft]);
    }
  }

  const allDelinCoords = [...rightDelinCoords, ...leftDelinCoords];
  const instDelinPosts = new THREE.InstancedMesh(delinPostGeo, matDelinPost, allDelinCoords.length);
  instDelinPosts.name = 'delineator_posts';
  instDelinPosts.userData.citation = 'inferred: MUTCD Section 3F.03 flexible roadside delineator posts at 60 m spacing';

  allDelinCoords.forEach(([dx, dz], idx) => {
    dummy.position.set(dx, ctx.groundY(dx, dz), dz);
    dummy.rotation.set(0, Math.PI / 2, 0);
    dummy.updateMatrix();
    instDelinPosts.setMatrixAt(idx, dummy.matrix);
  });
  instDelinPosts.instanceMatrix.needsUpdate = true;
  grpSigns.add(instDelinPosts);

  const instDelinWhiteTabs = new THREE.InstancedMesh(delinTabGeo, matDelinWhiteTab, rightDelinCoords.length);
  instDelinWhiteTabs.name = 'delineator_reflectors_white';
  instDelinWhiteTabs.userData.citation = 'inferred: MUTCD Section 3F.02 white right-shoulder delineator reflectors';
  rightDelinCoords.forEach(([dx, dz], idx) => {
    dummy.position.set(dx, ctx.groundY(dx, dz), dz);
    dummy.rotation.set(0, Math.PI / 2, 0);
    dummy.updateMatrix();
    instDelinWhiteTabs.setMatrixAt(idx, dummy.matrix);
  });
  instDelinWhiteTabs.instanceMatrix.needsUpdate = true;
  grpSigns.add(instDelinWhiteTabs);

  const instDelinYellowTabs = new THREE.InstancedMesh(delinTabGeo, matDelinYellowTab, leftDelinCoords.length);
  instDelinYellowTabs.name = 'delineator_reflectors_yellow';
  instDelinYellowTabs.userData.citation = 'inferred: MUTCD Section 3F.02 yellow median-side delineator reflectors';
  leftDelinCoords.forEach(([dx, dz], idx) => {
    dummy.position.set(dx, ctx.groundY(dx, dz), dz);
    dummy.rotation.set(0, Math.PI / 2, 0);
    dummy.updateMatrix();
    instDelinYellowTabs.setMatrixAt(idx, dummy.matrix);
  });
  instDelinYellowTabs.instanceMatrix.needsUpdate = true;
  grpSigns.add(instDelinYellowTabs);

  // ---------------------------------------------------------------------------
  // 4. Drainage Culvert at (120, 9) & Residence Driveway Apron at x=[278, 282]
  // ---------------------------------------------------------------------------
  const grpDrainage = new THREE.Group();
  grpDrainage.name = 'culvert_and_driveway_apron';
  grpDrainage.userData.citation = CITE.postImpact || 'NTSB/HAR-17/02 p.1 (Vehicle A crossed a drainage culvert post-impact; residential driveway)';
  root.add(grpDrainage);

  // Helper to build a corrugated culvert pipe + concrete mitered headwalls + shell-rock embankment
  function buildCulvertAssembly(opts) {
    const grp = new THREE.Group();
    grp.name = opts.name;
    grp.userData.citation = opts.citation;

    const cx = opts.cx;
    const zApronStart = opts.zApronStart;
    const zApronEnd = opts.zApronEnd;
    const widthX = opts.widthX;
    const pipeR = opts.pipeDiameter * 0.5;
    const hwWestX = cx - widthX * 0.5 - 0.35;
    const hwEastX = cx + widthX * 0.5 + 0.35;
    const pipeLen = hwEastX - hwWestX;
    const ditchZ = opts.ditchZ;

    // Determine ditch invert elevation so pipe rests in the ditch bottom
    const yRoad = ctx.roadY(cx);
    const yDitch = Math.min(ctx.groundY(cx - widthX, ditchZ), yRoad - 0.58);
    const pipeCenterY = yDitch + pipeR * 0.85;

    // 1. Shell-rock top surface bridging from EB right shoulder (z=3.35) to zApronEnd
    const topDeckGeo = buildStripGeometry(
      cx - widthX * 0.5,
      cx + widthX * 0.5,
      zApronStart,
      zApronEnd,
      0.015,
      1.2,
      false // Follow roadY across the ditch so the crossing forms a level farm/driveway bridge over the pipe
    );
    // Slightly slope the surface down away from the shoulder (2% cross-slope)
    const posAttr = topDeckGeo.getAttribute('position');
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vz = posAttr.getZ(i);
      const drop = (vz - zApronStart) * 0.022;
      posAttr.setY(i, ctx.roadY(vx) + 0.012 - drop);
    }
    topDeckGeo.computeVertexNormals();
    const topDeckMesh = new THREE.Mesh(topDeckGeo, matGravel);
    topDeckMesh.name = `${opts.name}_shell_rock_surface`;
    topDeckMesh.receiveShadow = true;
    grp.add(topDeckMesh);

    // 2. Side embankment slopes (west and east side batters from deck edge down to ditch groundY)
    for (const side of [-1, 1]) {
      const xInner = cx + side * (widthX * 0.5);
      const xOuter = cx + side * (widthX * 0.5 + 0.85);
      const segsZ = 8;
      const ePos = [];
      const eUvs = [];
      const eIdx = [];
      for (let i = 0; i <= segsZ; i++) {
        const f = i / segsZ;
        const z = zApronStart + f * (zApronEnd - zApronStart);
        const yIn = ctx.roadY(xInner) + 0.012 - (z - zApronStart) * 0.022;
        const yOut = ctx.groundY(xOuter, z) - 0.04;
        ePos.push(xInner, yIn, z, xOuter, yOut, z);
        eUvs.push(0, z, 1, z);
        if (i < segsZ) {
          const a = i * 2;
          if (side > 0) {
            eIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
          } else {
            eIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
          }
        }
      }
      const embGeo = new THREE.BufferGeometry();
      embGeo.setAttribute('position', new THREE.Float32BufferAttribute(ePos, 3));
      embGeo.setAttribute('uv', new THREE.Float32BufferAttribute(eUvs, 2));
      embGeo.setIndex(eIdx);
      embGeo.computeVertexNormals();
      const embMesh = new THREE.Mesh(embGeo, matGravel);
      embMesh.name = `${opts.name}_embankment_${side < 0 ? 'west' : 'east'}`;
      grp.add(embMesh);
    }

    // 3. Corrugated steel / concrete culvert pipe running along X (ditch flow direction)
    const pipeGeo = new THREE.CylinderGeometry(pipeR, pipeR, pipeLen, 24, 1, true);
    pipeGeo.rotateZ(Math.PI / 2);
    const pipeMesh = new THREE.Mesh(pipeGeo, matSteelPipe);
    pipeMesh.position.set(cx, pipeCenterY, ditchZ);
    pipeMesh.name = `${opts.name}_pipe_barrel`;
    grp.add(pipeMesh);

    // Corrugation rings near visible ends
    const ringGeo = new THREE.TorusGeometry(pipeR + 0.012, 0.018, 8, 24);
    ringGeo.rotateY(Math.PI / 2);
    for (const endSign of [-1, 1]) {
      for (let r = 0; r < 4; r++) {
        const ring = new THREE.Mesh(ringGeo, matSteelPipe);
        ring.position.set(cx + endSign * (pipeLen * 0.5 - 0.12 - r * 0.18), pipeCenterY, ditchZ);
        grp.add(ring);
      }
      // Dark interior cap disk
      const capGeo = new THREE.CircleGeometry(pipeR * 0.96, 20);
      capGeo.rotateY(endSign * Math.PI / 2);
      const cap = new THREE.Mesh(capGeo, matCulvertDark);
      cap.position.set(cx + endSign * (pipeLen * 0.5 - 0.04), pipeCenterY, ditchZ);
      grp.add(cap);
    }

    // 4. Concrete headwalls / mitered end aprons at West & East pipe mouths, plus North & South retaining curbs
    const hwH = pipeR * 2.15;
    const hwW = pipeR * 2.8;
    const hwThick = 0.22;
    const headwallGeo = new THREE.BoxGeometry(hwThick, hwH, hwW);

    for (const endSign of [-1, 1]) {
      const hx = cx + endSign * (pipeLen * 0.5 - hwThick * 0.5);
      const hw = new THREE.Mesh(headwallGeo, matConcrete);
      hw.position.set(hx, pipeCenterY + 0.04, ditchZ);
      hw.name = `${opts.name}_headwall_${endSign < 0 ? 'west' : 'east'}`;
      grp.add(hw);

      // Sloped concrete wingwalls flaring out into ditch banks
      for (const zSign of [-1, 1]) {
        const wingGeo = new THREE.BoxGeometry(0.55, hwH * 0.78, 0.16);
        const wing = new THREE.Mesh(wingGeo, matConcrete);
        wing.position.set(hx + endSign * 0.22, pipeCenterY - 0.05, ditchZ + zSign * (hwW * 0.5 + 0.15));
        wing.rotation.y = -endSign * zSign * 0.42;
        grp.add(wing);
      }
    }

    // North and South concrete headwall caps at z = headwallsZ (e.g. z=7.0 and z=11.0 per layout)
    if (opts.headwallsZ) {
      for (const hz of opts.headwallsZ) {
        if (hz <= 8.2 || opts.includeSouthHeadwall) {
          const capWallGeo = new THREE.BoxGeometry(widthX + 0.3, 0.38, 0.24);
          const yCap = ctx.roadY(cx) - (hz - zApronStart) * 0.022 - 0.14;
          const capWall = new THREE.Mesh(capWallGeo, matConcrete);
          capWall.position.set(cx, yCap, hz);
          capWall.name = `${opts.name}_curb_z${Math.round(hz)}`;
          grp.add(capWall);
        }
      }
    }

    return grp;
  }

  // Main Drainage Culvert at layout.culvert (center [120, 9], pipeDiameter 0.9, headwallsZ [7, 11])
  // Keep height flush/low along the car's post-impact trajectory (at x=120, car passes around z=9.1)
  const culvertSpecs = L.culvert || { center: [120, 9], pipeDiameter: 0.9, headwallsZ: [7, 11] };
  const mainCulvert = buildCulvertAssembly({
    name: 'culvert_crossing_x120',
    citation: CITE.postImpact || 'NTSB/HAR-17/02 p.1 (drainage culvert crossed by Vehicle A post-impact)',
    cx: culvertSpecs.center[0],
    ditchZ: culvertSpecs.center[1],
    pipeDiameter: culvertSpecs.pipeDiameter || 0.9,
    widthX: 5.2,
    zApronStart: L.eb.rightShoulder[1], // 3.35
    zApronEnd: 11.2,
    headwallsZ: culvertSpecs.headwallsZ || [7.0, 11.0],
    includeSouthHeadwall: true,
  });
  grpDrainage.add(mainCulvert);

  // Residence Driveway Apron x in [278, 282], z from 3.35 to 8.0 (within r3_east scope z <= 8)
  const resDrive = (L.residence && L.residence.driveway) ? L.residence.driveway : { x: [278, 282], z: [3.35, 44] };
  const driveCx = 0.5 * (resDrive.x[0] + resDrive.x[1]); // 280
  const driveW = resDrive.x[1] - resDrive.x[0];          // 4.0

  // Flared driveway apron connecting EB shoulder (z=3.35) to z=8.0
  const driveApronGeo = buildStripGeometry(
    resDrive.x[0] - 1.5,
    resDrive.x[1] + 1.5,
    (x) => L.eb.rightShoulder[1],
    (x) => 8.0,
    0.014,
    1.0,
    false
  );
  // Flare the X coordinates near the highway shoulder for turning radius
  const dPos = driveApronGeo.getAttribute('position');
  for (let i = 0; i < dPos.count; i++) {
    const vx = dPos.getX(i);
    const vz = dPos.getZ(i);
    const tZ = Math.max(0, Math.min(1, (vz - 3.35) / (8.0 - 3.35)));
    // At z=3.35 width is driveW + 3.0m flare; at z=8.0 width narrows to driveW (4.0m)
    const relX = (vx - driveCx) / (driveW * 0.5 + 1.5);
    const halfSpan = (driveW * 0.5) + (1 - tZ) * 1.6;
    const newX = driveCx + relX * halfSpan;
    const newY = ctx.roadY(newX) + 0.012 - (vz - 3.35) * 0.018;
    dPos.setXYZ(i, newX, newY, vz);
  }
  driveApronGeo.computeVertexNormals();
  const driveApronMesh = new THREE.Mesh(driveApronGeo, matGravel);
  driveApronMesh.name = 'residence_driveway_apron_north';
  driveApronMesh.userData.citation = CITE.postImpact || 'NTSB/HAR-17/02 p.1 (residential driveway near Vehicle A final rest)';
  driveApronMesh.receiveShadow = true;
  grpDrainage.add(driveApronMesh);

  // Driveway culvert pipe ends & concrete mitered headwalls at x=277.3 and x=282.7, z=7.6
  const drivePipeR = 0.38;
  const drivePipeLen = driveW + 1.4;
  const drivePipeY = ctx.roadY(driveCx) - 0.42;
  const drivePipeZ = 7.65;

  const drivePipeGeo = new THREE.CylinderGeometry(drivePipeR, drivePipeR, drivePipeLen, 20, 1, true);
  drivePipeGeo.rotateZ(Math.PI / 2);
  const drivePipeMesh = new THREE.Mesh(drivePipeGeo, matSteelPipe);
  drivePipeMesh.position.set(driveCx, drivePipeY, drivePipeZ);
  drivePipeMesh.name = 'residence_driveway_culvert_pipe';
  drivePipeMesh.userData.citation = 'inferred: residential driveway ditch culvert pipe';
  grpDrainage.add(drivePipeMesh);

  for (const endSign of [-1, 1]) {
    const endX = driveCx + endSign * (drivePipeLen * 0.5);
    // Mitered concrete collar
    const collarGeo = new THREE.BoxGeometry(0.28, drivePipeR * 2.2, drivePipeR * 2.6);
    const collar = new THREE.Mesh(collarGeo, matConcrete);
    collar.position.set(endX, drivePipeY + 0.02, drivePipeZ);
    collar.rotation.z = endSign * 0.35;
    collar.name = `residence_driveway_headwall_${endSign < 0 ? 'west' : 'east'}`;
    collar.userData.citation = 'inferred: FDOT mitered concrete driveway culvert end section';
    grpDrainage.add(collar);

    const holeGeo = new THREE.CircleGeometry(drivePipeR * 0.94, 16);
    holeGeo.rotateY(endSign * Math.PI / 2);
    const hole = new THREE.Mesh(holeGeo, matCulvertDark);
    hole.position.set(endX - endSign * 0.05, drivePipeY, drivePipeZ);
    grpDrainage.add(hole);
  }

  // Rural roadside mailbox on wooden post at east edge of residence driveway apron (x=283.2, z=5.2)
  if (!ctx.blocked(283.2, 5.2)) {
    const mbGrp = new THREE.Group();
    mbGrp.name = 'residence_mailbox';
    mbGrp.userData.citation = 'inferred: rural residential roadside mailbox at driveway entrance';
    const matWoodPost = new THREE.MeshStandardMaterial({ color: 0x5c4632, roughness: 0.85 });
    const matBoxMetal = new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.45, metalness: 0.6 });
    const matFlagRed = new THREE.MeshStandardMaterial({ color: 0xc41e3a, roughness: 0.4 });

    const post = new THREE.Mesh(new THREE.BoxGeometry(0.10, 1.08, 0.10), matWoodPost);
    post.position.set(0, 0.54, 0);
    mbGrp.add(post);

    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.08, 0.48), matWoodPost);
    arm.position.set(0, 1.02, -0.14);
    mbGrp.add(arm);

    const boxBody = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.48), matBoxMetal);
    boxBody.position.set(0, 1.14, -0.16);
    mbGrp.add(boxBody);

    const boxTop = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.48, 12, 1, false, 0, Math.PI), matBoxMetal);
    boxTop.rotation.z = Math.PI / 2;
    boxTop.rotation.y = Math.PI / 2;
    boxTop.position.set(0, 1.22, -0.16);
    mbGrp.add(boxTop);

    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.18, 0.05), matFlagRed);
    flag.position.set(-0.12, 1.24, -0.32);
    mbGrp.add(flag);

    mbGrp.position.set(283.2, ctx.groundY(283.2, 5.2), 5.2);
    grpDrainage.add(mbGrp);
  }

  return root;
}
