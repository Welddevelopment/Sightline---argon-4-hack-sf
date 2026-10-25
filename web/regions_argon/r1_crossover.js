// r1_crossover — US-27A & NE 140th Ct median crossover, mainline pavement [-45,45], turn lanes, side-road mouth, and MUTCD traffic control
export default function region(THREE, assets, ctx) {
  const root = new THREE.Group();
  root.name = 'region_r1_crossover';
  root.userData.citation = 'NTSB/HAR-17/02 p.1, p.3, p.22-23, p.29; MUTCD 2009 Part 2 & Part 3';

  const L = ctx.layout;
  const cite = L.cite || {};
  const X_MIN = -45.0;
  const X_MAX = 45.0;

  // ---------------------------------------------------------------------------
  // Materials
  // ---------------------------------------------------------------------------
  const matAsphaltTravel = ctx.surface('asphalt', { color: 0x383a3e, roughness: 0.82 });
  const matAsphaltTurn = ctx.surface('asphalt', { color: 0x3d3f43, roughness: 0.84 });
  const matAsphaltCrossover = ctx.surface('asphalt', { color: 0x3f4145, roughness: 0.85 });
  const matAsphaltSideRoad = ctx.surface('asphalt', { color: 0x45474b, roughness: 0.86 });
  const matAsphaltShoulder = ctx.surface('asphalt', { color: 0x4b4d51, roughness: 0.88 });
  const matGravelVerge = ctx.surface('gravel', { color: 0xb6b0a2, roughness: 0.92, polygonOffset: -1 });
  const matConcreteCurb = ctx.surface('concrete', { color: 0xc8c5bc, roughness: 0.80 });

  const matPaintWhite = new THREE.MeshStandardMaterial({
    color: 0xf2f2ef,
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

  const matCurbYellow = new THREE.MeshStandardMaterial({
    color: 0xe6b012,
    roughness: 0.58,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });

  const matCrackSeal = new THREE.MeshStandardMaterial({
    color: 0x1e1f22,
    roughness: 0.42,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });

  const matWheelWear = new THREE.MeshStandardMaterial({
    color: 0x26282b,
    roughness: 0.76,
    metalness: 0.0,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
  });

  const matRpmBodyWhite = new THREE.MeshStandardMaterial({ color: 0xeaeaea, roughness: 0.4, metalness: 0.1 });
  const matRpmBodyAmber = new THREE.MeshStandardMaterial({ color: 0xd99b16, roughness: 0.4, metalness: 0.1 });
  const matRpmLensClear = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x555555,
    emissiveIntensity: 0.25,
    roughness: 0.2,
    metalness: 0.1
  });
  const matRpmLensAmber = new THREE.MeshStandardMaterial({
    color: 0xffbf2f,
    emissive: 0x664400,
    emissiveIntensity: 0.3,
    roughness: 0.2,
    metalness: 0.1
  });
  const matRpmLensRed = new THREE.MeshStandardMaterial({
    color: 0xd92525,
    emissive: 0x550808,
    emissiveIntensity: 0.25,
    roughness: 0.2,
    metalness: 0.1
  });

  const matPostSteel = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.48, metalness: 0.78 });
  const matSignBack = new THREE.MeshStandardMaterial({ color: 0x9fa4a9, roughness: 0.52, metalness: 0.65 });

  // ---------------------------------------------------------------------------
  // Geometry Builders (Profile-draped along ctx.roadY(x))
  // ---------------------------------------------------------------------------

  // Builds a strip x in [x0, x1] where z bounds can vary with x: z0Fn(x), z1Fn(x)
  function buildVariableZStrip(x0, x1, z0Fn, z1Fn, yOffset, mat, opts = {}) {
    const stepX = opts.stepX || 2.0;
    const stepsZ = opts.stepsZ || 1;
    const dropStart = opts.dropStart || false;
    const dropEnd = opts.dropEnd || false;
    const dropDepth = opts.dropDepth !== undefined ? opts.dropDepth : 0.05;
    const dropWidth = opts.dropWidth !== undefined ? opts.dropWidth : 0.08;

    const nx = Math.max(2, Math.ceil(Math.abs(x1 - x0) / stepX));
    const zSlices = [];
    if (dropStart) zSlices.push({ t: 0, dz: -dropWidth, dy: -dropDepth });
    for (let j = 0; j <= stepsZ; j++) {
      zSlices.push({ t: j / stepsZ, dz: 0, dy: 0 });
    }
    if (dropEnd) zSlices.push({ t: 1, dz: dropWidth, dy: -dropDepth });

    const rows = zSlices.length;
    const positions = new Float32Array((nx + 1) * rows * 3);
    const uvs = new Float32Array((nx + 1) * rows * 2);
    const indices = [];

    let vIdx = 0;
    let uvIdx = 0;
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      const x = x0 + (x1 - x0) * u;
      const zA = typeof z0Fn === 'function' ? z0Fn(x) : z0Fn;
      const zB = typeof z1Fn === 'function' ? z1Fn(x) : z1Fn;
      const baseY = ctx.roadY(x) + yOffset;

      for (let r = 0; r < rows; r++) {
        const s = zSlices[r];
        const z = zA + (zB - zA) * s.t + s.dz;
        const y = baseY + s.dy;
        positions[vIdx++] = x;
        positions[vIdx++] = y;
        positions[vIdx++] = z;

        uvs[uvIdx++] = x;
        uvs[uvIdx++] = z;
      }
    }

    for (let i = 0; i < nx; i++) {
      for (let r = 0; r < rows - 1; r++) {
        const a = i * rows + r;
        const b = (i + 1) * rows + r;
        const c = (i + 1) * rows + (r + 1);
        const d = i * rows + (r + 1);
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    const mesh = new THREE.Mesh(geom, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  function buildRectStrip(x0, x1, z0, z1, yOffset, mat, opts = {}) {
    return buildVariableZStrip(x0, x1, z0, z1, yOffset, mat, opts);
  }

  // Builds a strip along Z where X bounds vary with z: x0Fn(z), x1Fn(z)
  function buildVariableXStripAlongZ(z0, z1, x0Fn, x1Fn, yOffset, mat, opts = {}) {
    const stepZ = opts.stepZ || 0.5;
    const stepsX = opts.stepsX || 16;
    const dropLeft = opts.dropLeft || false;
    const dropRight = opts.dropRight || false;
    const dropDepth = opts.dropDepth !== undefined ? opts.dropDepth : 0.05;
    const dropWidth = opts.dropWidth !== undefined ? opts.dropWidth : 0.08;

    const nz = Math.max(2, Math.ceil(Math.abs(z1 - z0) / stepZ));
    const xSlices = [];
    if (dropLeft) xSlices.push({ t: 0, dx: -dropWidth, dy: -dropDepth });
    for (let i = 0; i <= stepsX; i++) {
      xSlices.push({ t: i / stepsX, dx: 0, dy: 0 });
    }
    if (dropRight) xSlices.push({ t: 1, dx: dropWidth, dy: -dropDepth });

    const cols = xSlices.length;
    const positions = new Float32Array((nz + 1) * cols * 3);
    const uvs = new Float32Array((nz + 1) * cols * 2);
    const indices = [];

    let vIdx = 0;
    let uvIdx = 0;
    for (let j = 0; j <= nz; j++) {
      const v = j / nz;
      const z = z0 + (z1 - z0) * v;
      const xA = typeof x0Fn === 'function' ? x0Fn(z) : x0Fn;
      const xB = typeof x1Fn === 'function' ? x1Fn(z) : x1Fn;

      for (let c = 0; c < cols; c++) {
        const s = xSlices[c];
        const x = xA + (xB - xA) * s.t + s.dx;
        const y = ctx.roadY(x) + yOffset + s.dy;
        positions[vIdx++] = x;
        positions[vIdx++] = y;
        positions[vIdx++] = z;

        uvs[uvIdx++] = x;
        uvs[uvIdx++] = z;
      }
    }

    for (let j = 0; j < nz; j++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = j * cols + c;
        const b = j * cols + (c + 1);
        const d = (j + 1) * cols + c;
        const e = (j + 1) * cols + (c + 1);
        indices.push(a, d, b);
        indices.push(b, d, e);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    const mesh = new THREE.Mesh(geom, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  // Builds a draped ribbon along an arbitrary 2D polyline [[x,z], ...]
  function buildPolylineRibbon(pts, width, yOffset, mat) {
    const halfW = width * 0.5;
    const n = pts.length;
    const positions = new Float32Array(n * 2 * 3);
    const uvs = new Float32Array(n * 2 * 2);
    const indices = [];

    let dist = 0;
    for (let i = 0; i < n; i++) {
      const [x, z] = pts[i];
      if (i > 0) {
        const dx = x - pts[i - 1][0];
        const dz = z - pts[i - 1][1];
        dist += Math.hypot(dx, dz);
      }
      let tx = 0;
      let tz = 0;
      if (i < n - 1) {
        tx += pts[i + 1][0] - x;
        tz += pts[i + 1][1] - z;
      }
      if (i > 0) {
        tx += x - pts[i - 1][0];
        tz += z - pts[i - 1][1];
      }
      const len = Math.hypot(tx, tz) || 1;
      const nx = -tz / len;
      const nz = tx / len;

      const xL = x + nx * halfW;
      const zL = z + nz * halfW;
      const xR = x - nx * halfW;
      const zR = z - nz * halfW;

      const idx = i * 6;
      positions[idx] = xL;
      positions[idx + 1] = ctx.roadY(xL) + yOffset;
      positions[idx + 2] = zL;

      positions[idx + 3] = xR;
      positions[idx + 4] = ctx.roadY(xR) + yOffset;
      positions[idx + 5] = zR;

      const uvIdx = i * 4;
      uvs[uvIdx] = dist;
      uvs[uvIdx + 1] = 0;
      uvs[uvIdx + 2] = dist;
      uvs[uvIdx + 3] = width;

      if (i < n - 1) {
        const a = i * 2;
        const b = i * 2 + 1;
        const c = (i + 1) * 2;
        const d = (i + 1) * 2 + 1;
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.setIndex(indices);
    geom.computeVertexNormals();

    const mesh = new THREE.Mesh(geom, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  // ---------------------------------------------------------------------------
  // 1. Mainline & Auxiliary Pavement (x in [-45, 45])
  // ---------------------------------------------------------------------------
  const grpMainline = new THREE.Group();
  grpMainline.name = 'mainline_pavement';
  grpMainline.userData.citation = `${cite.lanes}; ${cite.turnLanes}; ${cite.profile}`;
  root.add(grpMainline);

  // Eastbound travel lanes (z: -5.49 to 1.83)
  const ebLanesMesh = buildRectStrip(X_MIN, X_MAX, L.eb.lanes[0], L.eb.lanes[1], 0.0, matAsphaltTravel, {
    stepX: 1.8,
    stepsZ: 2
  });
  ebLanesMesh.name = 'eb_travel_lanes';
  ebLanesMesh.userData.citation = cite.lanes;
  grpMainline.add(ebLanesMesh);

  // Westbound travel lanes (z: -36.58 to -29.26)
  const wbLanesMesh = buildRectStrip(X_MIN, X_MAX, L.wb.lanes[0], L.wb.lanes[1], 0.0, matAsphaltTravel, {
    stepX: 1.8,
    stepsZ: 2
  });
  wbLanesMesh.name = 'wb_travel_lanes';
  wbLanesMesh.userData.citation = cite.lanes;
  grpMainline.add(wbLanesMesh);

  // WB outside (north) shoulder (z: -38.10 to -36.58)
  const wbNorthShoulder = buildRectStrip(X_MIN, X_MAX, L.wb.rightShoulder[0], L.wb.rightShoulder[1], 0.0, matAsphaltShoulder, {
    stepX: 2.0,
    dropStart: true
  });
  wbNorthShoulder.name = 'wb_outside_shoulder';
  wbNorthShoulder.userData.citation = cite.lanes;
  grpMainline.add(wbNorthShoulder);

  // WB inside (south) shoulder west of crossover (x: -45 to -19.81, z: -29.26 to -28.65)
  const wbSouthShoulderW = buildRectStrip(X_MIN, L.crossover.x[0], L.wb.leftShoulder[0], L.wb.leftShoulder[1], 0.0, matAsphaltShoulder, {
    stepX: 2.0,
    dropEnd: true
  });
  wbSouthShoulderW.name = 'wb_inside_shoulder_west';
  wbSouthShoulderW.userData.citation = cite.lanes;
  grpMainline.add(wbSouthShoulderW);

  // WB left-turn lane east of crossover (x: 19.81 to 45, z: -29.26 to -25.60)
  const wbLeftTurnMesh = buildRectStrip(L.crossover.x[1], X_MAX, L.wbLeftTurn.z[0], L.wbLeftTurn.z[1], 0.0, matAsphaltTurn, {
    stepX: 1.8
  });
  wbLeftTurnMesh.name = 'wb_left_turn_lane';
  wbLeftTurnMesh.userData.citation = cite.turnLanes;
  grpMainline.add(wbLeftTurnMesh);

  // WB left-turn inside shoulder east of crossover (x: 19.81 to 45, z: -25.60 to -24.99)
  const wbLeftTurnShoulder = buildRectStrip(L.crossover.x[1], X_MAX, L.wbLeftTurn.leftShoulder[0], L.wbLeftTurn.leftShoulder[1], 0.0, matAsphaltShoulder, {
    stepX: 2.0,
    dropEnd: true
  });
  wbLeftTurnShoulder.name = 'wb_left_turn_inside_shoulder';
  wbLeftTurnShoulder.userData.citation = cite.turnLanes;
  grpMainline.add(wbLeftTurnShoulder);

  // EB left-turn lane west of crossover (x: -45 to -19.81, z: -9.15 to -5.49)
  const ebLeftTurnMesh = buildRectStrip(X_MIN, L.crossover.x[0], L.ebLeftTurn.z[0], L.ebLeftTurn.z[1], 0.0, matAsphaltTurn, {
    stepX: 1.8
  });
  ebLeftTurnMesh.name = 'eb_left_turn_lane';
  ebLeftTurnMesh.userData.citation = cite.turnLanes;
  grpMainline.add(ebLeftTurnMesh);

  // EB left-turn inside shoulder west of crossover (x: -45 to -19.81, z: -9.76 to -9.15)
  const ebLeftTurnShoulder = buildRectStrip(X_MIN, L.crossover.x[0], L.ebLeftTurn.leftShoulder[0], L.ebLeftTurn.leftShoulder[1], 0.0, matAsphaltShoulder, {
    stepX: 2.0,
    dropStart: true
  });
  ebLeftTurnShoulder.name = 'eb_left_turn_inside_shoulder';
  ebLeftTurnShoulder.userData.citation = cite.turnLanes;
  grpMainline.add(ebLeftTurnShoulder);

  // EB inside (north) shoulder east of crossover (x: 19.81 to 45, z: -6.10 to -5.49)
  const ebNorthShoulderE = buildRectStrip(L.crossover.x[1], X_MAX, L.eb.leftShoulder[0], L.eb.leftShoulder[1], 0.0, matAsphaltShoulder, {
    stepX: 2.0,
    dropStart: true
  });
  ebNorthShoulderE.name = 'eb_inside_shoulder_east';
  ebNorthShoulderE.userData.citation = cite.lanes;
  grpMainline.add(ebNorthShoulderE);

  // EB right-turn lane west of side road (x: -45 to -9, z: 1.83 to 5.49)
  // Smoothly merges into the NE 140th Ct west flare return between x = -16 and x = -9
  const ebRightTurnMesh = buildRectStrip(X_MIN, -9.0, L.ebRightTurn.z[0], L.ebRightTurn.z[1], 0.0, matAsphaltTurn, {
    stepX: 1.8
  });
  ebRightTurnMesh.name = 'eb_right_turn_lane';
  ebRightTurnMesh.userData.citation = cite.turnLanes;
  grpMainline.add(ebRightTurnMesh);

  // EB outside (south) shoulder outside right-turn lane (x: -45 to -13.5, z: 5.49 to 7.01)
  const ebSouthShoulderAux = buildRectStrip(X_MIN, -13.5, L.ebRightTurn.z[1], L.ebRightTurn.z[1] + 1.52, 0.0, matAsphaltShoulder, {
    stepX: 2.0,
    dropEnd: true
  });
  ebSouthShoulderAux.name = 'eb_outside_shoulder_west_aux';
  ebSouthShoulderAux.userData.citation = `${cite.lanes}; ${cite.turnLanes}`;
  grpMainline.add(ebSouthShoulderAux);

  // EB outside (south) shoulder east of NE 140th Ct flare (x: 16 to 45, z: 1.83 to 3.35)
  const ebSouthShoulderE = buildRectStrip(16.0, X_MAX, L.eb.rightShoulder[0], L.eb.rightShoulder[1], 0.0, matAsphaltShoulder, {
    stepX: 2.0,
    dropEnd: true
  });
  ebSouthShoulderE.name = 'eb_outside_shoulder_east';
  ebSouthShoulderE.userData.citation = cite.lanes;
  grpMainline.add(ebSouthShoulderE);

  // EB outside shoulder bridging strip behind the flare (x: -16 to 16, z: 1.83 to 3.35)
  const ebSouthShoulderMouth = buildRectStrip(-16.0, 16.0, L.eb.rightShoulder[0], L.eb.rightShoulder[1], 0.0, matAsphaltSideRoad, {
    stepX: 1.5
  });
  ebSouthShoulderMouth.name = 'eb_outside_shoulder_mouth_bridge';
  ebSouthShoulderMouth.userData.citation = cite.sideRoad;
  grpMainline.add(ebSouthShoulderMouth);

  // Wheel-path wear strips along EB and WB travel lanes for realism
  const wheelTracksZ = [
    L.eb.insideCenter - 0.9, L.eb.insideCenter + 0.9,
    L.eb.outsideCenter - 0.9, L.eb.outsideCenter + 0.9,
    L.wb.insideCenter - 0.9, L.wb.insideCenter + 0.9,
    L.wb.outsideCenter - 0.9, L.wb.outsideCenter + 0.9
  ];
  for (let i = 0; i < wheelTracksZ.length; i++) {
    const wz = wheelTracksZ[i];
    const wearStrip = buildRectStrip(X_MIN, X_MAX, wz - 0.32, wz + 0.32, 0.004, matWheelWear, { stepX: 3.0 });
    wearStrip.name = `wheel_wear_track_${i}`;
    wearStrip.userData.citation = 'inferred: typical highway wheel-track aggregate polishing and oil staining';
    grpMainline.add(wearStrip);
  }

  // ---------------------------------------------------------------------------
  // 2. Median Crossover Pavement & Curbed Median Noses
  // ---------------------------------------------------------------------------
  const grpCrossover = new THREE.Group();
  grpCrossover.name = 'crossover_and_median_noses';
  grpCrossover.userData.citation = `${cite.turnLanes}; ${cite.median}; inferred: FDOT/MUTCD curbed median nose treatment`;
  root.add(grpCrossover);

  // Main crossover asphalt x in [-19.81, 19.81], z in [-29.26, -5.49]
  // Curved outer boundary near the bullet noses so pavement meets the 1.2 m radius noses cleanly
  const noseRadius = 1.2;
  const westNoseTipX = L.crossover.x[0]; // -19.81
  const eastNoseTipX = L.crossover.x[1]; // +19.81

  const crossoverMesh = buildRectStrip(
    westNoseTipX,
    eastNoseTipX,
    L.crossover.z[0],
    L.crossover.z[1],
    0.0,
    matAsphaltCrossover,
    { stepX: 1.5, stepsZ: 4 }
  );
  crossoverMesh.name = 'crossover_pavement';
  crossoverMesh.userData.citation = cite.turnLanes;
  grpCrossover.add(crossoverMesh);

  // Longitudinal paving seam lines at crossover edges (z = -29.26 and z = -5.49) and centerline (z = -17.375)
  const seamNorth = buildRectStrip(westNoseTipX, eastNoseTipX, L.crossover.z[0] - 0.04, L.crossover.z[0] + 0.04, 0.006, matCrackSeal, { stepX: 2.0 });
  seamNorth.name = 'crossover_paving_seam_north';
  seamNorth.userData.citation = 'inferred: asphalt paving joint between mainline and median crossover';
  grpCrossover.add(seamNorth);

  const seamSouth = buildRectStrip(westNoseTipX, eastNoseTipX, L.crossover.z[1] - 0.04, L.crossover.z[1] + 0.04, 0.006, matCrackSeal, { stepX: 2.0 });
  seamSouth.name = 'crossover_paving_seam_south';
  seamSouth.userData.citation = 'inferred: asphalt paving joint between mainline and median crossover';
  grpCrossover.add(seamSouth);

  const seamMid = buildRectStrip(westNoseTipX, eastNoseTipX, -17.41, -17.35, 0.005, matCrackSeal, { stepX: 2.0 });
  seamMid.name = 'crossover_paving_seam_center';
  seamMid.userData.citation = 'inferred: longitudinal asphalt paving joint in crossover';
  grpCrossover.add(seamMid);

  // Helper to build a raised concrete curbed median nose (Type F curb, 0.15 m tall, rounded 1.2 m tip, yellow painted nose)
  function buildMedianNose(side) {
    const isWest = side === 'west';
    const noseGrp = new THREE.Group();
    noseGrp.name = `median_nose_${side}`;
    noseGrp.userData.citation = 'inferred: FDOT Type F concrete curbed median nose (0.15 m height, 1.2 m radius nose) with yellow reflective paint';

    // West median lies between z = -28.65 (WB left shoulder edge) and z = -9.76 (EB left-turn shoulder edge)
    // East median lies between z = -24.99 (WB left-turn shoulder edge) and z = -6.10 (EB left shoulder edge)
    const zNorth = isWest ? L.wb.leftShoulder[1] : L.wbLeftTurn.leftShoulder[1]; // -28.65 or -24.99
    const zSouth = isWest ? L.ebLeftTurn.leftShoulder[0] : L.eb.leftShoulder[0]; // -9.76 or -6.10
    const zCenter = isWest ? (zNorth + zSouth) * 0.5 : (zNorth + zSouth) * 0.5;
    const tipX = isWest ? westNoseTipX - 0.25 : eastNoseTipX + 0.25;
    const dir = isWest ? -1 : 1; // direction into the median away from crossover

    const curbHeight = 0.15;
    const curbWidth = 0.45;
    const noseLength = 6.5; // curbed bullet nose extending 6.5 m back from crossover tip

    // Build perimeter points from north flank -> around 1.2 m radius tip -> south flank
    // Near the tip, the median narrows symmetrically toward zCenter to form a 1.2 m radius bullet nose
    const nSegs = 36;
    const outerPts = [];
    const innerPts = [];

    // North flank transition (from back of nose to tangent of 1.2m tip circle)
    const tipCenterX = tipX + dir * noseRadius;
    const backX = tipX + dir * noseLength;

    const flankSteps = 10;
    for (let i = 0; i <= flankSteps; i++) {
      const t = i / flankSteps;
      const s = t * t * (3 - 2 * t);
      const x = backX + (tipCenterX - backX) * t;
      const zOut = zNorth + ((zCenter - noseRadius) - zNorth) * s;
      // Tangent normal approx
      const dz = ((zCenter - noseRadius) - zNorth) * (6 * t * (1 - t)) / (tipCenterX - backX);
      const len = Math.hypot(1, dz) || 1;
      const nx = (isWest ? -dz : dz) / len;
      const nz = 1.0 / len;
      outerPts.push([x, zOut]);
      innerPts.push([x + nx * curbWidth, zOut + nz * curbWidth]);
    }

    // Semicircular 1.2 m radius nose tip
    for (let i = 1; i < nSegs; i++) {
      const u = i / nSegs;
      // Angle sweeps from -PI/2 (north) through tip (0 for east, PI for west) to +PI/2 (south)
      const ang = isWest
        ? (-Math.PI * 0.5 - u * Math.PI) // -PI/2 -> -PI -> -3PI/2
        : (-Math.PI * 0.5 + u * Math.PI); // -PI/2 -> 0 -> +PI/2
      const cx = tipCenterX - Math.cos(ang) * noseRadius * (isWest ? -1 : 1);
      const x = tipCenterX + (isWest ? Math.cos(Math.PI * u + Math.PI * 0.5) * noseRadius : -Math.cos(Math.PI * u - Math.PI * 0.5) * noseRadius);
      const z = zCenter + Math.sin(-Math.PI * 0.5 + u * Math.PI) * noseRadius;
      const rIn = Math.max(0.1, noseRadius - curbWidth);
      const xIn = tipCenterX + (isWest ? Math.cos(Math.PI * u + Math.PI * 0.5) * rIn : -Math.cos(Math.PI * u - Math.PI * 0.5) * rIn);
      const zIn = zCenter + Math.sin(-Math.PI * 0.5 + u * Math.PI) * rIn;
      outerPts.push([x, z]);
      innerPts.push([xIn, zIn]);
    }

    // South flank transition (from tangent of 1.2m tip circle back to backX)
    for (let i = 0; i <= flankSteps; i++) {
      const t = i / flankSteps;
      const s = 1 - (1 - t) * (1 - t) * (3 - 2 * (1 - t));
      const x = tipCenterX + (backX - tipCenterX) * t;
      const zOut = (zCenter + noseRadius) + (zSouth - (zCenter + noseRadius)) * s;
      const dz = (zSouth - (zCenter + noseRadius)) * (6 * t * (1 - t)) / (backX - tipCenterX);
      const len = Math.hypot(1, dz) || 1;
      const nx = (isWest ? dz : -dz) / len;
      const nz = -1.0 / len;
      outerPts.push([x, zOut]);
      innerPts.push([x + nx * curbWidth, zOut + nz * curbWidth]);
    }

    // Build extruded Type F curb ring mesh + concrete cap inside the tip
    const totalPts = outerPts.length;
    const pos = [];
    const uvs = [];
    const idx = [];

    for (let i = 0; i < totalPts; i++) {
      const [xo, zo] = outerPts[i];
      const [xi, zi] = innerPts[i];
      const yo = ctx.roadY(xo);
      const yi = ctx.roadY(xi);

      // 4 vertices per cross-section: 0=outer bottom, 1=outer top (battered 0.04m), 2=inner top, 3=inner bottom
      const xb = xo + (xi - xo) * 0.12;
      const zb = zo + (zi - zo) * 0.12;
      pos.push(
        xo, yo - 0.02, zo,
        xb, yo + curbHeight, zb,
        xi, yi + curbHeight, zi,
        xi, yi - 0.02, zi
      );
      const d = i * 0.35;
      uvs.push(d, 0, d, curbHeight, d, curbHeight + curbWidth, d, curbHeight + curbWidth + 0.15);

      if (i < totalPts - 1) {
        const b0 = i * 4;
        const b1 = (i + 1) * 4;
        // Outer face (0-1)
        idx.push(b0 + 0, b1 + 0, b0 + 1, b1 + 0, b1 + 1, b0 + 1);
        // Top face (1-2)
        idx.push(b0 + 1, b1 + 1, b0 + 2, b1 + 1, b1 + 2, b0 + 2);
        // Inner face (2-3)
        idx.push(b0 + 2, b1 + 2, b0 + 3, b1 + 2, b1 + 3, b0 + 3);
      }
    }

    const curbGeom = new THREE.BufferGeometry();
    curbGeom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    curbGeom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    curbGeom.setIndex(idx);
    curbGeom.computeVertexNormals();
    const curbMesh = new THREE.Mesh(curbGeom, matConcreteCurb);
    curbMesh.castShadow = true;
    curbMesh.receiveShadow = true;
    curbMesh.name = `curb_ring_${side}`;
    noseGrp.add(curbMesh);

    // Concrete monolithic island cap over the front 2.8 m of the nose
    const capPos = [];
    const capUvs = [];
    const capIdx = [];
    const capCenter = [tipCenterX + dir * 0.6, zCenter];
    capPos.push(capCenter[0], ctx.roadY(capCenter[0]) + curbHeight - 0.01, capCenter[1]);
    capUvs.push(capCenter[0], capCenter[1]);

    const iStart = Math.max(0, flankSteps - 5);
    const iEnd = Math.min(totalPts - 1, flankSteps + nSegs + 5);
    for (let i = iStart; i <= iEnd; i++) {
      const [xi, zi] = innerPts[i];
      capPos.push(xi, ctx.roadY(xi) + curbHeight - 0.01, zi);
      capUvs.push(xi, zi);
    }
    const capCount = iEnd - iStart + 1;
    for (let i = 1; i < capCount; i++) {
      if (isWest) {
        capIdx.push(0, i + 1, i);
      } else {
        capIdx.push(0, i, i + 1);
      }
    }
    const capGeom = new THREE.BufferGeometry();
    capGeom.setAttribute('position', new THREE.Float32BufferAttribute(capPos, 3));
    capGeom.setAttribute('uv', new THREE.Float32BufferAttribute(capUvs, 2));
    capGeom.setIndex(capIdx);
    capGeom.computeVertexNormals();
    const capMesh = new THREE.Mesh(capGeom, matConcreteCurb);
    capMesh.receiveShadow = true;
    capMesh.name = `island_cap_${side}`;
    noseGrp.add(capMesh);

    // Yellow reflective paint coat on the front ~3.2 m of the curbed nose
    const paintPos = [];
    const paintUvs = [];
    const paintIdx = [];
    const pStart = Math.max(0, flankSteps - 4);
    const pEnd = Math.min(totalPts - 1, flankSteps + nSegs + 4);
    for (let i = pStart; i <= pEnd; i++) {
      const [xo, zo] = outerPts[i];
      const [xi, zi] = innerPts[i];
      const yo = ctx.roadY(xo);
      const yi = ctx.roadY(xi);
      const xb = xo + (xi - xo) * 0.11;
      const zb = zo + (zi - zo) * 0.11;

      const k = i - pStart;
      paintPos.push(
        xo, yo + 0.005, zo,
        xb, yo + curbHeight + 0.003, zb,
        xi, yi + curbHeight + 0.003, zi
      );
      paintUvs.push(k * 0.2, 0, k * 0.2, 0.15, k * 0.2, 0.6);

      if (i < pEnd) {
        const b0 = k * 3;
        const b1 = (k + 1) * 3;
        paintIdx.push(b0 + 0, b1 + 0, b0 + 1, b1 + 0, b1 + 1, b0 + 1);
        paintIdx.push(b0 + 1, b1 + 1, b0 + 2, b1 + 1, b1 + 2, b0 + 2);
      }
    }
    const paintGeom = new THREE.BufferGeometry();
    paintGeom.setAttribute('position', new THREE.Float32BufferAttribute(paintPos, 3));
    paintGeom.setAttribute('uv', new THREE.Float32BufferAttribute(paintUvs, 2));
    paintGeom.setIndex(paintIdx);
    paintGeom.computeVertexNormals();
    const paintMesh = new THREE.Mesh(paintGeom, matCurbYellow);
    paintMesh.name = `curb_yellow_paint_${side}`;
    noseGrp.add(paintMesh);

    return { group: noseGrp, tipCenterX, zCenter };
  }

  const westNose = buildMedianNose('west');
  grpCrossover.add(westNose.group);

  const eastNose = buildMedianNose('east');
  grpCrossover.add(eastNose.group);

  // ---------------------------------------------------------------------------
  // 3. NE 140th Court Mouth & Flared Returns (z in [3.35, 16.0])
  // ---------------------------------------------------------------------------
  const grpSideRoad = new THREE.Group();
  grpSideRoad.name = 'ne140th_ct_mouth';
  grpSideRoad.userData.citation = cite.sideRoad;
  root.add(grpSideRoad);

  // Smooth radius-12m style flare from x in [-16, 16] at z = 3.35 narrowing to [-3.05, 3.05] at z = 16.0
  function flareHalfWidth(z) {
    const z0 = L.sideRoad.flare.atZ; // 3.35
    const z1 = L.sideRoad.flare.untilZ; // 16.0
    const t = Math.max(0, Math.min(1, (z - z0) / (z1 - z0)));
    // Circular return profile (radius ~12.65 m tangent at z = 16.0)
    const arc = 1.0 - Math.sqrt(Math.max(0, 1.0 - (1.0 - t) * (1.0 - t)));
    return 3.05 + (16.0 - 3.05) * arc;
  }

  const sideRoadMouthMesh = buildVariableXStripAlongZ(
    L.sideRoad.flare.atZ,
    L.sideRoad.flare.untilZ,
    (z) => -flareHalfWidth(z),
    (z) => flareHalfWidth(z),
    0.0,
    matAsphaltSideRoad,
    { stepZ: 0.4, stepsX: 20, dropLeft: true, dropRight: true }
  );
  sideRoadMouthMesh.name = 'ne140th_flared_pavement';
  sideRoadMouthMesh.userData.citation = cite.sideRoad;
  grpSideRoad.add(sideRoadMouthMesh);

  // Gravel / shell-rock shoulder strips along the west and east edges of the NE 140th Ct mouth
  const mouthGravelWest = buildVariableXStripAlongZ(
    L.sideRoad.flare.atZ + 0.2,
    L.sideRoad.flare.untilZ,
    (z) => -flareHalfWidth(z) - 1.35,
    (z) => -flareHalfWidth(z) + 0.05,
    -0.015,
    matGravelVerge,
    { stepZ: 0.6, stepsX: 3, dropLeft: true, dropDepth: 0.03 }
  );
  mouthGravelWest.name = 'ne140th_mouth_gravel_west';
  mouthGravelWest.userData.citation = 'inferred: typical Florida shell-rock/limerock unpaved shoulder along local road return';
  grpSideRoad.add(mouthGravelWest);

  const mouthGravelEast = buildVariableXStripAlongZ(
    L.sideRoad.flare.atZ + 0.2,
    L.sideRoad.flare.untilZ,
    (z) => flareHalfWidth(z) - 0.05,
    (z) => flareHalfWidth(z) + 1.35,
    -0.015,
    matGravelVerge,
    { stepZ: 0.6, stepsX: 3, dropRight: true, dropDepth: 0.03 }
  );
  mouthGravelEast.name = 'ne140th_mouth_gravel_east';
  mouthGravelEast.userData.citation = 'inferred: typical Florida shell-rock/limerock unpaved shoulder along local road return';
  grpSideRoad.add(mouthGravelEast);

  // Transverse paving seam where NE 140th Ct meets US-27A EB shoulder at z = 3.35
  const mouthSeam = buildRectStrip(-15.5, 15.5, 3.31, 3.39, 0.006, matCrackSeal, { stepX: 1.5 });
  mouthSeam.name = 'ne140th_paving_joint';
  mouthSeam.userData.citation = 'inferred: asphalt paving joint at side-road apron';
  grpSideRoad.add(mouthSeam);

  // ---------------------------------------------------------------------------
  // 4. MUTCD Pavement Markings, Turn Arrows, Dotted Extensions & RPMs
  // ---------------------------------------------------------------------------
  const grpMarkings = new THREE.Group();
  grpMarkings.name = 'pavement_markings';
  grpMarkings.userData.citation = 'MUTCD 2009 Part 3 (Sections 3B.04, 3B.06, 3B.08, 3B.11, 3B.16, 3B.20)';
  root.add(grpMarkings);

  const PAINT_Y = 0.012;
  const LINE_W = 0.15;
  const TURN_LINE_W = 0.20;

  // Helper for dashed lines along X
  function buildDashedLineX(xStart, xEnd, zCenter, width, dashLen, gapLen, mat, namePrefix) {
    const g = new THREE.Group();
    g.name = namePrefix;
    g.userData.citation = 'MUTCD Section 3B.04 (10-ft dash, 30-ft gap)';
    const cycle = dashLen + gapLen;
    // Align phase to global X grid so adjacent regions match seamlessly
    const kMin = Math.floor(xStart / cycle);
    const kMax = Math.ceil(xEnd / cycle);
    for (let k = kMin; k <= kMax; k++) {
      const d0 = Math.max(xStart, k * cycle);
      const d1 = Math.min(xEnd, k * cycle + dashLen);
      if (d1 - d0 > 0.2) {
        const dash = buildRectStrip(d0, d1, zCenter - width * 0.5, zCenter + width * 0.5, PAINT_Y, mat, { stepX: 1.5 });
        dash.name = `${namePrefix}_dash_${k}`;
        g.add(dash);
      }
    }
    return g;
  }

  // EB dashed white lane line (z = -1.83) across [-45, 45]
  grpMarkings.add(buildDashedLineX(X_MIN, X_MAX, L.eb.laneLine, LINE_W, 3.05, 9.15, matPaintWhite, 'mark_eb_lane_line'));

  // WB dashed white lane line (z = -32.92) across [-45, 45]
  grpMarkings.add(buildDashedLineX(X_MIN, X_MAX, L.wb.laneLine, LINE_W, 3.05, 9.15, matPaintWhite, 'mark_wb_lane_line'));

  // WB solid white right (north) edge line (z = -36.58) across [-45, 45]
  const wbRightEdge = buildRectStrip(X_MIN, X_MAX, L.wb.lanes[0] - LINE_W * 0.5, L.wb.lanes[0] + LINE_W * 0.5, PAINT_Y, matPaintWhite, { stepX: 2.0 });
  wbRightEdge.name = 'mark_wb_right_edge';
  wbRightEdge.userData.citation = 'MUTCD Section 3B.06 (Right Edge Line, solid white 6 in)';
  grpMarkings.add(wbRightEdge);

  // WB solid yellow left edge line west of crossover (x: -45 to -19.81, z = -29.26)
  const wbLeftEdgeW = buildRectStrip(X_MIN, L.crossover.x[0], L.wb.lanes[1] - LINE_W * 0.5, L.wb.lanes[1] + LINE_W * 0.5, PAINT_Y, matPaintYellow, { stepX: 2.0 });
  wbLeftEdgeW.name = 'mark_wb_left_edge_west';
  wbLeftEdgeW.userData.citation = 'MUTCD Section 3B.06 (Left Edge Line on Divided Highway, solid yellow 6 in)';
  grpMarkings.add(wbLeftEdgeW);

  // WB solid yellow left edge line east of crossover along left-turn lane (x: 19.81 to 45, z = -25.60)
  const wbLeftEdgeE = buildRectStrip(L.crossover.x[1], X_MAX, L.wbLeftTurn.z[1] - LINE_W * 0.5, L.wbLeftTurn.z[1] + LINE_W * 0.5, PAINT_Y, matPaintYellow, { stepX: 2.0 });
  wbLeftEdgeE.name = 'mark_wb_left_edge_east';
  wbLeftEdgeE.userData.citation = 'MUTCD Section 3B.06 (Left Edge Line along WB left-turn lane, solid yellow 6 in)';
  grpMarkings.add(wbLeftEdgeE);

  // WB solid white turn-lane channelizing line (x: 19.81 to 45, z = -29.26, 0.20 m wide)
  const wbTurnChannel = buildRectStrip(L.crossover.x[1], X_MAX, L.wbLeftTurn.z[0] - TURN_LINE_W * 0.5, L.wbLeftTurn.z[0] + TURN_LINE_W * 0.5, PAINT_Y, matPaintWhite, { stepX: 2.0 });
  wbTurnChannel.name = 'mark_wb_left_turn_line';
  wbTurnChannel.userData.citation = 'MUTCD Section 3B.04 (White Turn-Lane Channelizing Line, 8 in)';
  grpMarkings.add(wbTurnChannel);

  // EB solid yellow left edge line west of crossover along EB left-turn lane (x: -45 to -19.81, z = -9.15)
  const ebLeftEdgeW = buildRectStrip(X_MIN, L.crossover.x[0], L.ebLeftTurn.z[0] - LINE_W * 0.5, L.ebLeftTurn.z[0] + LINE_W * 0.5, PAINT_Y, matPaintYellow, { stepX: 2.0 });
  ebLeftEdgeW.name = 'mark_eb_left_edge_west';
  ebLeftEdgeW.userData.citation = 'MUTCD Section 3B.06 (Left Edge Line along EB left-turn lane, solid yellow 6 in)';
  grpMarkings.add(ebLeftEdgeW);

  // EB solid white left-turn channelizing line west of crossover (x: -45 to -19.81, z = -5.49, 0.20 m wide)
  const ebLeftTurnLine = buildRectStrip(X_MIN, L.crossover.x[0], L.ebLeftTurn.z[1] - TURN_LINE_W * 0.5, L.ebLeftTurn.z[1] + TURN_LINE_W * 0.5, PAINT_Y, matPaintWhite, { stepX: 2.0 });
  ebLeftTurnLine.name = 'mark_eb_left_turn_line';
  ebLeftTurnLine.userData.citation = 'MUTCD Section 3B.04 (White Turn-Lane Channelizing Line, 8 in)';
  grpMarkings.add(ebLeftTurnLine);

  // EB solid yellow left edge line east of crossover (x: 19.81 to 45, z = -5.49)
  const ebLeftEdgeE = buildRectStrip(L.crossover.x[1], X_MAX, L.eb.lanes[0] - LINE_W * 0.5, L.eb.lanes[0] + LINE_W * 0.5, PAINT_Y, matPaintYellow, { stepX: 2.0 });
  ebLeftEdgeE.name = 'mark_eb_left_edge_east';
  ebLeftEdgeE.userData.citation = 'MUTCD Section 3B.06 (Left Edge Line on Divided Highway, solid yellow 6 in)';
  grpMarkings.add(ebLeftEdgeE);

  // EB solid white right-turn channelizing line (x: -45 to -9, z = 1.83, 0.20 m wide)
  const ebRightTurnLine = buildRectStrip(X_MIN, -9.0, L.ebRightTurn.z[0] - TURN_LINE_W * 0.5, L.ebRightTurn.z[0] + TURN_LINE_W * 0.5, PAINT_Y, matPaintWhite, { stepX: 2.0 });
  ebRightTurnLine.name = 'mark_eb_right_turn_line';
  ebRightTurnLine.userData.citation = 'MUTCD Section 3B.04 (White Right-Turn Channelizing Line, 8 in)';
  grpMarkings.add(ebRightTurnLine);

  // EB solid white outer edge line along EB right-turn lane (x: -45 to -14.2, z = 5.49) curving into NE 140th Ct west flare
  const ebRightOuterEdge = buildRectStrip(X_MIN, -14.2, L.ebRightTurn.z[1] - LINE_W * 0.5, L.ebRightTurn.z[1] + LINE_W * 0.5, PAINT_Y, matPaintWhite, { stepX: 2.0 });
  ebRightOuterEdge.name = 'mark_eb_right_turn_outer_edge';
  ebRightOuterEdge.userData.citation = 'MUTCD Section 3B.06 (Right Edge Line along auxiliary turn lane)';
  grpMarkings.add(ebRightOuterEdge);

  // West flare edge line curve from (-14.2, 5.49) down to (-3.05, 16.0)
  const westFlareEdgePts = [];
  for (let z = 5.49; z <= 16.0; z += 0.5) {
    westFlareEdgePts.push([-flareHalfWidth(z) + 0.12, z]);
  }
  const westFlareEdgeRibbon = buildPolylineRibbon(westFlareEdgePts, LINE_W, PAINT_Y, matPaintWhite);
  westFlareEdgeRibbon.name = 'mark_ne140th_west_flare_edge';
  westFlareEdgeRibbon.userData.citation = 'MUTCD Section 3B.06 (Right edge line return into side road)';
  grpMarkings.add(westFlareEdgeRibbon);

  // East flare edge line curve from (3.05, 16.0) up to (16.0, 3.35) and transitioning to EB right edge line (z = 1.83)
  const eastFlareEdgePts = [];
  for (let z = 16.0; z >= 5.0; z -= 0.5) {
    eastFlareEdgePts.push([flareHalfWidth(z) - 0.12, z]);
  }
  eastFlareEdgePts.push([12.5, 3.5], [15.0, 2.2], [16.0, 1.83]);
  const eastFlareEdgeRibbon = buildPolylineRibbon(eastFlareEdgePts, LINE_W, PAINT_Y, matPaintWhite);
  eastFlareEdgeRibbon.name = 'mark_ne140th_east_flare_edge';
  eastFlareEdgeRibbon.userData.citation = 'MUTCD Section 3B.06 (East side-road return edge line)';
  grpMarkings.add(eastFlareEdgeRibbon);

  // EB solid white right edge line east of NE 140th Ct mouth (x: 16.0 to 45.0, z = 1.83)
  const ebRightEdgeE = buildRectStrip(16.0, X_MAX, L.eb.lanes[1] - LINE_W * 0.5, L.eb.lanes[1] + LINE_W * 0.5, PAINT_Y, matPaintWhite, { stepX: 2.0 });
  ebRightEdgeE.name = 'mark_eb_right_edge_east';
  ebRightEdgeE.userData.citation = 'MUTCD Section 3B.06 (Right Edge Line east of intersection, solid white 6 in)';
  grpMarkings.add(ebRightEdgeE);

  // Stop bar on northbound NE 140th Ct at z = 5.5 across x in [0, 3.05], width = 0.40 m
  const stopBarMesh = buildRectStrip(
    0.0,
    L.sideRoad.x[1],
    L.sideRoad.stopBarZ - L.sideRoad.stopBarWidth * 0.5,
    L.sideRoad.stopBarZ + L.sideRoad.stopBarWidth * 0.5,
    PAINT_Y,
    matPaintWhite,
    { stepX: 0.5 }
  );
  stopBarMesh.name = 'mark_ne140th_stop_bar';
  stopBarMesh.userData.citation = `${cite.stopSign}; MUTCD Section 3B.16 (Stop Line, 0.40 m white)`;
  grpMarkings.add(stopBarMesh);

  // Short double-yellow separator at the throat of NE 140th Ct (z = 5.5 to 16.0) separating NB/SB throat at the stop bar
  const throatYellowW = buildRectStrip(-0.18, -0.06, 5.5, 13.5, PAINT_Y, matPaintYellow, { stepX: 0.12 });
  throatYellowW.name = 'mark_ne140th_throat_centerline_w';
  throatYellowW.userData.citation = 'inferred: short MUTCD throat centerline separating stop approach at highway mouth';
  grpMarkings.add(throatYellowW);

  const throatYellowE = buildRectStrip(0.06, 0.18, 5.5, 13.5, PAINT_Y, matPaintYellow, { stepX: 0.12 });
  throatYellowE.name = 'mark_ne140th_throat_centerline_e';
  throatYellowE.userData.citation = 'inferred: short MUTCD throat centerline separating stop approach at highway mouth';
  grpMarkings.add(throatYellowE);

  // Dotted white extension lines (0.61 m dash / 1.22 m gap, 0.15 m wide) through the crossover
  function addDottedCurve(p0, p1, p2, name) {
    const grpDot = new THREE.Group();
    grpDot.name = name;
    grpDot.userData.citation = 'MUTCD Section 3B.08 (Dotted White Extension Line through median crossover, 2-ft dash / 4-ft gap)';
    const samples = 48;
    const pts = [];
    const dists = [0];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const u = 1 - t;
      const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
      const z = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
      pts.push([x, z]);
      if (i > 0) {
        dists.push(dists[i - 1] + Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]));
      }
    }
    const totalLen = dists[dists.length - 1];
    const dash = 0.61;
    const gap = 1.22;
    let s = 0.8;
    let dIdx = 0;
    while (s + dash < totalLen - 0.5) {
      const segPts = [];
      for (let k = 0; k <= 3; k++) {
        const dTarget = s + (k / 3) * dash;
        let idx = 0;
        while (idx < dists.length - 2 && dists[idx + 1] < dTarget) idx++;
        const f = (dTarget - dists[idx]) / Math.max(1e-4, dists[idx + 1] - dists[idx]);
        const px = pts[idx][0] + (pts[idx + 1][0] - pts[idx][0]) * f;
        const pz = pts[idx][1] + (pts[idx + 1][1] - pts[idx][1]) * f;
        segPts.push([px, pz]);
      }
      const m = buildPolylineRibbon(segPts, LINE_W, PAINT_Y, matPaintWhite);
      m.name = `${name}_dot_${dIdx++}`;
      grpDot.add(m);
      s += dash + gap;
    }
    return grpDot;
  }

  // Dotted extension lines guiding WB left turn and EB left turn into the median crossover
  grpMarkings.add(addDottedCurve([19.81, -25.60], [8.5, -25.2], [2.4, -17.5], 'mark_crossover_dotted_wb_turn'));
  grpMarkings.add(addDottedCurve([-19.81, -9.15], [-8.5, -9.5], [-2.4, -17.2], 'mark_crossover_dotted_eb_turn'));

  // Continuity dotted edge lines across the crossover along EB left edge (z = -5.49) and WB left edge (z = -29.26)
  grpMarkings.add(buildDashedLineX(-19.0, -3.5, L.wb.lanes[1], LINE_W, 0.61, 1.83, matPaintWhite, 'mark_wb_crossover_continuity'));
  grpMarkings.add(buildDashedLineX(3.5, 19.0, L.eb.lanes[0], LINE_W, 0.61, 1.83, matPaintWhite, 'mark_eb_crossover_continuity'));

  // ---------------------------------------------------------------------------
  // Turn-Lane Arrows (MUTCD Figure 3B-24, 2.44 m long white thermoplastic)
  // Built both as crisp vector geometry (always works in headless & 3D) and optional canvas decal
  // ---------------------------------------------------------------------------
  function buildMutcdTurnArrow(centerX, centerZ, travelDirX, turnSide, id) {
    // travelDirX: +1 for EB (moving +X), -1 for WB (moving -X)
    // turnSide: 'left' or 'right' relative to travel direction
    const arrowGrp = new THREE.Group();
    arrowGrp.name = id;
    arrowGrp.userData.citation = 'MUTCD Section 3B.20 & Figure 3B-24 (Lane-Use Arrow Pavement Marking, 8 ft / 2.44 m)';

    // Local coordinates: u along travel direction [-1.22, +1.22], v to the left of travel direction
    // For a left-turn arrow, v_sign = +1; for a right-turn arrow, v_sign = -1
    const vSign = turnSide === 'left' ? 1 : -1;

    // Stem polygon + curved elbow + arrowhead triangle
    const localTris = [];
    function addQuad(u0, v0, u1, v1, u2, v2, u3, v3) {
      localTris.push([u0, v0], [u1, v1], [u2, v2], [u0, v0], [u2, v2], [u3, v3]);
    }
    // Base stem (u from -1.22 to +0.10, width 0.22 around v = -0.35 * vSign)
    const vStem = -0.32 * vSign;
    addQuad(-1.22, vStem - 0.11, 0.05, vStem - 0.11, 0.05, vStem + 0.11, -1.22, vStem + 0.11);

    // Sweeping curve from stem (u=0.05, v=vStem) to head base (u=0.55, v=+0.28 * vSign)
    const curveSegs = 6;
    for (let i = 0; i < curveSegs; i++) {
      const t0 = i / curveSegs;
      const t1 = (i + 1) / curveSegs;
      const ang0 = t0 * Math.PI * 0.48;
      const ang1 = t1 * Math.PI * 0.48;
      const rMid = 0.58;
      const hw = 0.11;
      const uc = 0.05;
      const vc = vStem + vSign * rMid;

      const u0i = uc + Math.sin(ang0) * (rMid - hw);
      const v0i = vc - vSign * Math.cos(ang0) * (rMid - hw);
      const u0o = uc + Math.sin(ang0) * (rMid + hw);
      const v0o = vc - vSign * Math.cos(ang0) * (rMid + hw);

      const u1i = uc + Math.sin(ang1) * (rMid - hw);
      const v1i = vc - vSign * Math.cos(ang1) * (rMid - hw);
      const u1o = uc + Math.sin(ang1) * (rMid + hw);
      const v1o = vc - vSign * Math.cos(ang1) * (rMid + hw);

      addQuad(u0i, v0i, u1i, v1i, u1o, v1o, u0o, v0o);
    }

    // Arrowhead pointing Toward vSign (u centered around 0.63, v from +0.24*vSign to +0.86*vSign)
    const uHeadCenter = 0.63;
    const vBase = 0.24 * vSign;
    const vTip = 0.88 * vSign;
    localTris.push(
      [uHeadCenter - 0.42, vBase],
      [uHeadCenter + 0.42, vBase],
      [uHeadCenter, vTip]
    );

    const pos = new Float32Array(localTris.length * 3);
    const uvs = new Float32Array(localTris.length * 2);

    for (let i = 0; i < localTris.length; i++) {
      const [u, v] = localTris[i];
      // Transform (u, v) to world (x, z)
      // If travelDirX == +1 (EB): forward (+u) is +X, left (+v) is -Z
      // If travelDirX == -1 (WB): forward (+u) is -X, left (+v) is +Z
      const wx = centerX + u * travelDirX;
      const wz = centerZ - v * travelDirX;
      const wy = ctx.roadY(wx) + PAINT_Y + 0.002;
      pos[i * 3] = wx;
      pos[i * 3 + 1] = wy;
      pos[i * 3 + 2] = wz;
      uvs[i * 2] = wx;
      uvs[i * 2 + 1] = wz;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.computeVertexNormals();
    if (travelDirX * vSign < 0) {
      // Ensure upward normal regardless of mirror
      const p = geom.attributes.position.array;
      for (let i = 0; i < p.length; i += 9) {
        const tx = p[i + 3], ty = p[i + 4], tz = p[i + 5];
        p[i + 3] = p[i + 6]; p[i + 4] = p[i + 7]; p[i + 5] = p[i + 8];
        p[i + 6] = tx; p[i + 7] = ty; p[i + 8] = tz;
      }
      geom.computeVertexNormals();
    }

    const mesh = new THREE.Mesh(geom, matPaintWhite);
    mesh.name = `${id}_thermoplastic`;
    arrowGrp.add(mesh);
    return arrowGrp;
  }

  // 2 left-turn arrows in WB left-turn lane (z = -27.43) within x in [19.81, 45]
  grpMarkings.add(buildMutcdTurnArrow(26.0, L.wbLeftTurn.center, -1, 'left', 'arrow_wb_left_1'));
  grpMarkings.add(buildMutcdTurnArrow(40.5, L.wbLeftTurn.center, -1, 'left', 'arrow_wb_left_2'));

  // 2 left-turn arrows in EB left-turn lane (z = -7.32) within x in [-45, -19.81]
  grpMarkings.add(buildMutcdTurnArrow(-26.0, L.ebLeftTurn.center, 1, 'left', 'arrow_eb_left_1'));
  grpMarkings.add(buildMutcdTurnArrow(-40.5, L.ebLeftTurn.center, 1, 'left', 'arrow_eb_left_2'));

  // 2 right-turn arrows in EB right-turn lane (z = +3.66) within x in [-45, -9]
  grpMarkings.add(buildMutcdTurnArrow(-18.0, L.ebRightTurn.center, 1, 'right', 'arrow_eb_right_1'));
  grpMarkings.add(buildMutcdTurnArrow(-35.0, L.ebRightTurn.center, 1, 'right', 'arrow_eb_right_2'));

  // ---------------------------------------------------------------------------
  // Raised Pavement Markers (RPMs) every 12.2 m (InstancedMesh)
  // ---------------------------------------------------------------------------
  const grpRpms = new THREE.Group();
  grpRpms.name = 'raised_pavement_markers';
  grpRpms.userData.citation = 'MUTCD Section 3B.11 (Raised Pavement Markers, 40-ft / 12.2 m spacing; clear on white, amber on yellow)';
  root.add(grpRpms);

  const whiteRpmCoords = [];
  const amberRpmCoords = [];

  // Lane lines: place clear RPM in the midpoint of the gap every 12.2 m
  const rpmStep = 12.192;
  for (let k = -4; k <= 3; k++) {
    const xRpm = k * rpmStep + 4.57; // just behind each 3.05 m dash
    if (xRpm >= X_MIN + 0.5 && xRpm <= X_MAX - 0.5) {
      whiteRpmCoords.push([xRpm, L.eb.laneLine, 1]);
      whiteRpmCoords.push([xRpm, L.wb.laneLine, -1]);
    }
  }

  // Turn lane solid white lines (spaced every 6.1 m for turn channelizing lines)
  for (let x = 22.0; x <= 44.0; x += 6.1) {
    whiteRpmCoords.push([x, L.wbLeftTurn.z[0], -1]);
  }
  for (let x = -44.0; x <= -22.0; x += 6.1) {
    whiteRpmCoords.push([x, L.ebLeftTurn.z[1], 1]);
  }
  for (let x = -43.0; x <= -12.0; x += 6.1) {
    whiteRpmCoords.push([x, L.ebRightTurn.z[0], 1]);
  }

  // Yellow left edge lines: amber RPMs every 12.2 m
  for (let x = -43.0; x <= -21.0; x += 12.2) {
    amberRpmCoords.push([x, L.wb.lanes[1] + 0.12]);
    amberRpmCoords.push([x, L.ebLeftTurn.z[0] - 0.12]);
  }
  for (let x = 21.0; x <= 43.0; x += 12.2) {
    amberRpmCoords.push([x, L.wbLeftTurn.z[1] + 0.12]);
    amberRpmCoords.push([x, L.eb.lanes[0] - 0.12]);
  }

  const rpmBodyGeom = new THREE.BoxGeometry(0.10, 0.018, 0.10);
  const rpmLensGeom = new THREE.BoxGeometry(0.104, 0.012, 0.08);

  if (whiteRpmCoords.length > 0) {
    const instWhiteBody = new THREE.InstancedMesh(rpmBodyGeom, matRpmBodyWhite, whiteRpmCoords.length);
    const instClearLens = new THREE.InstancedMesh(rpmLensGeom, matRpmLensClear, whiteRpmCoords.length);
    instWhiteBody.name = 'rpm_white_bodies';
    instClearLens.name = 'rpm_clear_lenses';
    const dummy = new THREE.Object3D();
    for (let i = 0; i < whiteRpmCoords.length; i++) {
      const [rx, rz] = whiteRpmCoords[i];
      const ry = ctx.roadY(rx) + 0.018;
      dummy.position.set(rx, ry, rz);
      dummy.rotation.set(0, 0, L.grade || -0.0215);
      dummy.updateMatrix();
      instWhiteBody.setMatrixAt(i, dummy.matrix);
      instClearLens.setMatrixAt(i, dummy.matrix);
    }
    instWhiteBody.instanceMatrix.needsUpdate = true;
    instClearLens.instanceMatrix.needsUpdate = true;
    grpRpms.add(instWhiteBody, instClearLens);
  }

  if (amberRpmCoords.length > 0) {
    const instAmberBody = new THREE.InstancedMesh(rpmBodyGeom, matRpmBodyAmber, amberRpmCoords.length);
    const instAmberLens = new THREE.InstancedMesh(rpmLensGeom, matRpmLensAmber, amberRpmCoords.length);
    instAmberBody.name = 'rpm_amber_bodies';
    instAmberLens.name = 'rpm_amber_lenses';
    const dummy = new THREE.Object3D();
    for (let i = 0; i < amberRpmCoords.length; i++) {
      const [rx, rz] = amberRpmCoords[i];
      const ry = ctx.roadY(rx) + 0.018;
      dummy.position.set(rx, ry, rz);
      dummy.rotation.set(0, 0, L.grade || -0.0215);
      dummy.updateMatrix();
      instAmberBody.setMatrixAt(i, dummy.matrix);
      instAmberLens.setMatrixAt(i, dummy.matrix);
    }
    instAmberBody.instanceMatrix.needsUpdate = true;
    instAmberLens.instanceMatrix.needsUpdate = true;
    grpRpms.add(instAmberBody, instAmberLens);
  }

  // ---------------------------------------------------------------------------
  // 5. MUTCD Traffic Control Devices & Signage
  // ---------------------------------------------------------------------------
  const grpSigns = new THREE.Group();
  grpSigns.name = 'traffic_control_devices';
  grpSigns.userData.citation = `${cite.stopSign}; MUTCD 2009 Part 2 (R1-1, R4-7, R6-1, R6-3, D3-1, OM3)`;
  root.add(grpSigns);

  // Helper to create custom crisp canvas texture with fallback material
  function makeSignFaceMaterial(wPx, hPx, fallbackColor, drawFn) {
    const c = ctx.makeCanvas(wPx, hPx);
    if (!c) {
      return new THREE.MeshStandardMaterial({ color: fallbackColor, roughness: 0.38, metalness: 0.15 });
    }
    const g = c.getContext('2d');
    drawFn(g, wPx, hPx);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.36, metalness: 0.15 });
  }

  // Helper to attach custom plate(s) onto an existing sign post or standalone breakaway U-channel post
  function createPlateMesh(w, h, faceMat, name) {
    const grp = new THREE.Group();
    grp.name = name;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), faceMat);
    front.position.z = -0.008;
    front.rotation.y = Math.PI; // face local -Z to match assets.sign convention
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), matSignBack);
    back.position.z = 0.008;
    grp.add(front, back);
    return grp;
  }

  // Custom graphic faces for MUTCD signs
  // 1) OM-3 Object Marker (0.30 x 0.91 m, alternating yellow and black diagonal stripes sloping down toward travel lane)
  const matOM3 = makeSignFaceMaterial(128, 384, 0xf2b705, (g, w, h) => {
    g.fillStyle = '#f5be0b';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#141414';
    const stripeW = 44;
    for (let y = -w; y < h + w; y += stripeW * 2) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y + w);
      g.lineTo(w, y + w + stripeW);
      g.lineTo(0, y + stripeW);
      g.closePath();
      g.fill();
    }
    g.strokeStyle = '#141414';
    g.lineWidth = 4;
    g.strokeRect(2, 2, w - 4, h - 4);
  });

  // 2) R4-7 KEEP RIGHT (with island symbol + arrow or text)
  const matKeepRight = makeSignFaceMaterial(256, 320, 0xf5f5f5, (g, w, h) => {
    g.fillStyle = '#f5f5f5';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#111111';
    g.lineWidth = 10;
    g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = '#111111';
    g.font = 'bold 42px sans-serif';
    g.textAlign = 'center';
    g.fillText('KEEP', w * 0.5, 68);
    g.fillText('RIGHT', w * 0.5, 116);
    // Island obstacle symbol on left + sweeping arrow to the right
    g.beginPath();
    g.arc(82, 210, 26, Math.PI, 0, false);
    g.lineTo(108, 265);
    g.lineTo(56, 265);
    g.closePath();
    g.fill();
    // Right bypass arrow
    g.lineWidth = 18;
    g.beginPath();
    g.moveTo(140, 280);
    g.quadraticCurveTo(145, 220, 185, 175);
    g.stroke();
    g.beginPath();
    g.moveTo(195, 155);
    g.lineTo(155, 168);
    g.lineTo(192, 198);
    g.closePath();
    g.fill();
  });

  // 3) R6-1 ONE WAY horizontal arrow plate (0.91 x 0.30 m)
  function makeOneWayMat(dirRight) {
    return makeSignFaceMaterial(384, 128, 0x181818, (g, w, h) => {
      g.fillStyle = '#141414';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#f5f5f5';
      g.lineWidth = 6;
      g.strokeRect(5, 5, w - 10, h - 10);
      // White arrow
      g.fillStyle = '#f5f5f5';
      g.beginPath();
      if (dirRight) {
        g.moveTo(28, 36);
        g.lineTo(285, 36);
        g.lineTo(285, 16);
        g.lineTo(360, 64);
        g.lineTo(285, 112);
        g.lineTo(285, 92);
        g.lineTo(28, 92);
      } else {
        g.moveTo(356, 36);
        g.lineTo(99, 36);
        g.lineTo(99, 16);
        g.lineTo(24, 64);
        g.lineTo(99, 112);
        g.lineTo(99, 92);
        g.lineTo(356, 92);
      }
      g.closePath();
      g.fill();
      g.fillStyle = '#141414';
      g.font = 'bold 40px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('ONE WAY', dirRight ? 168 : 216, 65);
    });
  }
  const matOneWayRight = makeOneWayMat(true);
  const matOneWayLeft = makeOneWayMat(false);

  // 4) R6-3 DIVIDED HIGHWAY plaque (0.61 x 0.46 m) mounted under STOP sign
  const matDividedHwy = makeSignFaceMaterial(256, 192, 0xf5f5f5, (g, w, h) => {
    g.fillStyle = '#f5f5f5';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#111111';
    g.lineWidth = 8;
    g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#111111';
    g.font = 'bold 30px sans-serif';
    g.textAlign = 'center';
    g.fillText('DIVIDED', w * 0.5, 44);
    g.fillText('HIGHWAY', w * 0.5, 78);
    // Median island symbol between opposing arrows
    g.beginPath();
    g.roundRect ? g.roundRect(104, 112, 48, 28, 12) : g.fillRect(104, 112, 48, 28);
    g.fill();
    // Left-pointing top arrow
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(195, 100);
    g.lineTo(65, 100);
    g.stroke();
    g.beginPath();
    g.moveTo(48, 100); g.lineTo(72, 88); g.lineTo(72, 112); g.closePath(); g.fill();
    // Right-pointing bottom arrow
    g.beginPath();
    g.moveTo(61, 154);
    g.lineTo(191, 154);
    g.stroke();
    g.beginPath();
    g.moveTo(208, 154); g.lineTo(184, 142); g.lineTo(184, 166); g.closePath(); g.fill();
  });

  // 5) D3-1 Street Name Blades ('NE 140TH CT' & 'US 27A', green retroreflective #00653a with white text)
  function makeStreetBladeMat(label) {
    return makeSignFaceMaterial(384, 96, 0x00653a, (g, w, h) => {
      g.fillStyle = '#00653a';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 5;
      g.strokeRect(5, 5, w - 10, h - 10);
      g.fillStyle = '#ffffff';
      g.font = 'bold 44px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, w * 0.5, h * 0.52);
    });
  }
  const matBladeNE140 = makeStreetBladeMat('NE 140TH CT');
  const matBladeUS27A = makeStreetBladeMat('US 27A');

  // --- A. STOP Sign Assembly on NE 140th Ct at (4.2, 6.0) ---
  // Faces +Z (south, toward northbound drivers): rotation.y = PI
  const stopX = L.sideRoad.stopSign[0]; // 4.2
  const stopZ = L.sideRoad.stopSign[1]; // 6.0
  const stopAssembly = new THREE.Group();
  stopAssembly.name = 'sign_stop_ne140_assembly';
  stopAssembly.userData.citation = `${cite.stopSign}; MUTCD R1-1 (30 in STOP at 2.13 m bottom), R6-3 (DIVIDED HIGHWAY), D3-1 street blades`;
  stopAssembly.position.set(stopX, ctx.groundY(stopX, stopZ), stopZ);
  stopAssembly.rotation.y = Math.PI; // faces +Z (south)

  const stopSign = assets.sign({
    id: 'sign_stop_r1_1',
    kind: 'stop',
    mountHeight: 2.13,
    rural: true,
    w: 0.76,
    h: 0.76
  });
  stopAssembly.add(stopSign);

  // R6-3 DIVIDED HIGHWAY plaque mounted directly beneath the STOP octagon (center y = 1.82 m)
  const divHwyPlaque = createPlateMesh(0.61, 0.46, matDividedHwy, 'plaque_r6_3_divided_highway');
  divHwyPlaque.position.set(0, 1.82, -0.02);
  stopAssembly.add(divHwyPlaque);

  // Post extension & D3-1 double street-name blades on top of the STOP sign post (y = 3.05 m and 3.28 m)
  const topExtPost = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.65, 0.03), matPostSteel);
  topExtPost.position.set(0, 3.05, 0);
  stopAssembly.add(topExtPost);

  // 'US 27A' blade parallel to highway (local X)
  const bladeUS27A_F = createPlateMesh(0.76, 0.20, matBladeUS27A, 'blade_us27a_south');
  bladeUS27A_F.position.set(0, 3.08, 0);
  const bladeUS27A_B = createPlateMesh(0.76, 0.20, matBladeUS27A, 'blade_us27a_north');
  bladeUS27A_B.position.set(0, 3.08, 0);
  bladeUS27A_B.rotation.y = Math.PI;
  stopAssembly.add(bladeUS27A_F, bladeUS27A_B);

  // 'NE 140TH CT' blade perpendicular (along Z)
  const bladeNE140_E = createPlateMesh(0.84, 0.20, matBladeNE140, 'blade_ne140_east');
  bladeNE140_E.position.set(0, 3.29, 0);
  bladeNE140_E.rotation.y = Math.PI * 0.5;
  const bladeNE140_W = createPlateMesh(0.84, 0.20, matBladeNE140, 'blade_ne140_west');
  bladeNE140_W.position.set(0, 3.29, 0);
  bladeNE140_W.rotation.y = -Math.PI * 0.5;
  stopAssembly.add(bladeNE140_E, bladeNE140_W);

  grpSigns.add(stopAssembly);

  // --- B. Median Nose Assemblies (KEEP RIGHT R4-7 + OM-3 Object Marker on each nose) ---
  // Kept <= 2.2 m total height on breakaway U-channel posts per keepClear sight-corridor rule
  function buildNoseSignAssembly(x, z, facingRotY, idPrefix) {
    const g = new THREE.Group();
    g.name = idPrefix;
    g.userData.citation = 'inferred: MUTCD Section 2B.32 (R4-7 Keep Right) & Section 2C.63 (OM-3 Object Marker) on median nose (breakaway post <= 2.2 m)';
    const baseY = ctx.roadY(x) + 0.15; // mounted on top of the 0.15 m concrete island cap
    g.position.set(x, baseY, z);
    g.rotation.y = facingRotY;

    // Breakaway U-channel post (2.05 m above island cap)
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.055, 2.05, 0.03), matPostSteel);
    post.position.set(0, 1.025, 0);
    post.castShadow = true;
    g.add(post);

    // R4-7 KEEP RIGHT plate (0.61 x 0.76 m) centered at y = 1.62 m
    const r47 = createPlateMesh(0.61, 0.76, matKeepRight, `${idPrefix}_r4_7_keep_right`);
    r47.position.set(0, 1.62, -0.02);
    g.add(r47);

    // OM-3 striped object marker (0.25 x 0.76 m) centered at y = 0.78 m
    const om3 = createPlateMesh(0.25, 0.76, matOM3, `${idPrefix}_om3_marker`);
    om3.position.set(0, 0.78, -0.02);
    g.add(om3);

    return g;
  }

  // West nose sign at (-21.8, -9.0) facing EB traffic (-X -> rotation.y = +PI/2)
  grpSigns.add(buildNoseSignAssembly(-21.8, -8.8, Math.PI * 0.5, 'sign_west_nose_eb_keep_right'));

  // East nose sign at (+21.8, -26.2) facing WB traffic (+X -> rotation.y = -PI/2)
  grpSigns.add(buildNoseSignAssembly(21.8, -26.2, -Math.PI * 0.5, 'sign_east_nose_wb_keep_right'));

  // --- C. ONE WAY (R6-1) Signs in the Median Facing Crossover / NE 140th Ct Traffic ---
  function buildOneWayAssembly(x, z, facingRotY, pointRight, id) {
    const g = new THREE.Group();
    g.name = id;
    g.userData.citation = 'inferred: MUTCD Section 2B.40 & Figure 2B-15 (R6-1 ONE WAY signs at divided highway median crossover, height <= 2.1 m)';
    const baseY = ctx.roadY(x) + 0.15;
    g.position.set(x, baseY, z);
    g.rotation.y = facingRotY;

    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.85, 0.03), matPostSteel);
    post.position.set(0, 0.925, 0);
    post.castShadow = true;
    g.add(post);

    const plate = createPlateMesh(0.91, 0.30, pointRight ? matOneWayRight : matOneWayLeft, `${id}_r6_1`);
    plate.position.set(0, 1.68, -0.02);
    g.add(plate);
    return g;
  }

  // East median tip (x = 21.2, z = -7.2): faces +Z (rotation.y = PI, toward NB NE 140th Ct drivers), points RIGHT (+X / EB)
  grpSigns.add(buildOneWayAssembly(21.2, -7.2, Math.PI, true, 'sign_one_way_eb_south_facing'));

  // East median tip north side (x = 21.2, z = -23.8): faces +Z (rotation.y = PI, toward NB crossover drivers), points LEFT (-X / WB)
  grpSigns.add(buildOneWayAssembly(21.2, -23.8, Math.PI, false, 'sign_one_way_wb_south_facing'));

  // West median tip south side (x = -21.2, z = -10.8): faces -Z (rotation.y = 0, toward SB crossover drivers), points LEFT (+X / EB)
  grpSigns.add(buildOneWayAssembly(-21.2, -10.8, 0, false, 'sign_one_way_eb_north_facing'));

  // West median tip north side (x = -21.2, z = -27.2): faces -Z (rotation.y = 0, toward SB crossover drivers), points RIGHT (-X / WB)
  grpSigns.add(buildOneWayAssembly(-21.2, -27.2, 0, true, 'sign_one_way_wb_north_facing'));

  return root;
}
