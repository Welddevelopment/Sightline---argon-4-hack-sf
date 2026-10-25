// DEFECTS (round 1):
// 1. Missing NORTH leg mouth (USGS aerial & brief: "a local road mouth leaving the WB north shoulder at x ~ -38..-14 (z -38.1 to -44, flared, heading NNW) — build its first 6 m of pavement") -> fix: build the flared asphalt pavement, gravel shoulders, white return edge lines, stop bar, and paving joint for the north leg mouth in z [-38.1, -44], x [-38, -14], narrowing and skewing NNW toward z = -44, plus break the WB north white edge line across the north leg mouth.
// 2. Missing SW corner landscaped island and commercial driveway mouth (USGS aerial & brief: "The SW corner landscaped island (layout.aerial.swCorner.island, low curb + grass, flush) is yours", seen clearly in aerial Image 2 at x [-24, -2], z [3, 12] separating the west commercial entrance at x ~ -36..-22 from NE 140th Ct) -> fix: build the oval/teardrop low concrete curbed grass island at x [-24, -3.5], z [3.5, 11.8] with flush Bahia grass interior and paved driveway throat west/south of the island up to z = 16 so the EB right-turn lane and SW commercial drive connect just as in the USGS aerial.
// 3. Crossover pavement geometry in the aerial has swept/flared curve fillets into the median noses and mainline edges (Image 2 shows the paved crossover opening is wider where it meets the EB/WB lanes and wraps smoothly around the rounded west nose at x ~ -19.8 and east nose at x ~ +19.8) -> fix: contour the crossover asphalt and median nose curbs so the west nose centers around z = -19.2 (between WB inside shoulder z = -28.65 and EB left-turn lane z = -9.15) and the east nose centers around z = -15.55 (between WB left-turn lane z = -25.60 and EB inside shoulder z = -6.10), with zero gaps between the crossover asphalt, turn lanes, and concrete curb noses.
// 4. NE 140th Ct brief states "local paved road, no centre line, 6.1 m" -> fix: remove the inferred double-yellow centerline at the NE 140th Ct throat so it strictly adheres to the brief ("no centre line") while keeping the crisp 0.40 m white stop bar at z = 5.5 across x in [0, 3.05].
// 5. Sign placement & elevation grounding: median nose signs and ONE WAY signs used `ctx.roadY(x) + 0.15` even where placed over the median grass swale -> fix: place every sign post base at `Math.max(ctx.groundY(x, z), ctx.roadY(x))` or directly on the concrete nose cap so no post floats or sinks.

// r1_crossover — US-27A & NE 140th Ct median crossover, mainline [-45,45], turn lanes, side-road & north-leg mouths, SW island, and MUTCD traffic control
export default function region(THREE, assets, ctx) {
  const root = new THREE.Group();
  root.name = 'region_r1_crossover';
  root.userData.citation = 'NTSB/HAR-17/02 p.1, p.3, p.22-23, p.29; USGS NAIP aerial (measured); MUTCD 2009 Part 2 & Part 3';

  const L = ctx.layout;
  const cite = L.cite || {};
  const X_MIN = -45.0;
  const X_MAX = 45.0;

  // ---------------------------------------------------------------------------
  // Materials
  // ---------------------------------------------------------------------------
  const matAsphaltTravel = ctx.surface('asphalt', { color: 0x383a3e, roughness: 0.82 });
  const matAsphaltTurn = ctx.surface('asphalt', { color: 0x3d3f43, roughness: 0.84 });
  const matAsphaltCrossover = ctx.surface('asphalt', { color: 0x414347, roughness: 0.85 });
  const matAsphaltSideRoad = ctx.surface('asphalt', { color: 0x46484c, roughness: 0.86 });
  const matAsphaltShoulder = ctx.surface('asphalt', { color: 0x4c4e52, roughness: 0.88 });
  const matGravelVerge = ctx.surface('gravel', { color: 0xb6b0a2, roughness: 0.92, polygonOffset: -1 });
  const matConcreteCurb = ctx.surface('concrete', { color: 0xc9c6bd, roughness: 0.78 });
  const matIslandGrass = ctx.surface('grass', { color: 0x687b4b, roughness: 0.92 });
  const matIslandMulch = ctx.surface('dirt', { color: 0x5c4938, roughness: 0.94 });

  const matPaintWhite = new THREE.MeshStandardMaterial({
    color: 0xf2f2ef,
    roughness: 0.50,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3
  });

  const matPaintYellow = new THREE.MeshStandardMaterial({
    color: 0xeab81c,
    roughness: 0.50,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3
  });

  const matCurbYellow = new THREE.MeshStandardMaterial({
    color: 0xe8b214,
    roughness: 0.55,
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
    color: 0x242629,
    roughness: 0.75,
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

  const matPostSteel = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.48, metalness: 0.78 });
  const matSignBack = new THREE.MeshStandardMaterial({ color: 0x9fa4a9, roughness: 0.52, metalness: 0.65 });

  // ---------------------------------------------------------------------------
  // Geometry Builders (Profile-draped along ctx.roadY(x))
  // ---------------------------------------------------------------------------

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

  function buildVariableXStripAlongZ(z0, z1, x0Fn, x1Fn, yOffset, mat, opts = {}) {
    const stepZ = opts.stepZ || 0.5;
    const stepsX = opts.stepsX || 16;
    const dropLeft = opts.dropLeft || false;
    const dropRight = opts.dropRight || false;
    const dropDepth = opts.dropDepth !== undefined ? opts.dropDepth : 0.05;
    const dropWidth = opts.dropWidth !== undefined ? opts.dropWidth : 0.08;

    const dirZ = z1 >= z0 ? 1 : -1;
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
        if (dirZ > 0) {
          indices.push(a, d, b);
          indices.push(b, d, e);
        } else {
          indices.push(a, b, d);
          indices.push(b, e, d);
        }
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

  // WB outside (north) shoulder west of north-leg mouth (x: -45 to -38)
  const wbNorthShoulderW = buildRectStrip(X_MIN, -38.0, L.wb.rightShoulder[0], L.wb.rightShoulder[1], 0.0, matAsphaltShoulder, {
    stepX: 1.5,
    dropStart: true
  });
  wbNorthShoulderW.name = 'wb_outside_shoulder_west';
  wbNorthShoulderW.userData.citation = cite.lanes;
  grpMainline.add(wbNorthShoulderW);

  // WB outside (north) shoulder bridging north-leg mouth (x: -38 to -14, no drop-off on north edge)
  const wbNorthShoulderMouth = buildRectStrip(-38.0, -14.0, L.wb.rightShoulder[0], L.wb.rightShoulder[1], 0.0, matAsphaltSideRoad, {
    stepX: 1.5
  });
  wbNorthShoulderMouth.name = 'wb_outside_shoulder_north_leg_bridge';
  wbNorthShoulderMouth.userData.citation = 'USGS NAIP aerial (measured)';
  grpMainline.add(wbNorthShoulderMouth);

  // WB outside (north) shoulder east of north-leg mouth (x: -14 to 45)
  const wbNorthShoulderE = buildRectStrip(-14.0, X_MAX, L.wb.rightShoulder[0], L.wb.rightShoulder[1], 0.0, matAsphaltShoulder, {
    stepX: 2.0,
    dropStart: true
  });
  wbNorthShoulderE.name = 'wb_outside_shoulder_east';
  wbNorthShoulderE.userData.citation = cite.lanes;
  grpMainline.add(wbNorthShoulderE);

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
  const ebRightTurnMesh = buildRectStrip(X_MIN, -9.0, L.ebRightTurn.z[0], L.ebRightTurn.z[1], 0.0, matAsphaltTurn, {
    stepX: 1.8
  });
  ebRightTurnMesh.name = 'eb_right_turn_lane';
  ebRightTurnMesh.userData.citation = cite.turnLanes;
  grpMainline.add(ebRightTurnMesh);

  // EB outside (south) shoulder outside right-turn lane (x: -45 to -34, z: 5.49 to 7.01)
  const ebSouthShoulderAux = buildRectStrip(X_MIN, -34.0, L.ebRightTurn.z[1], L.ebRightTurn.z[1] + 1.52, 0.0, matAsphaltShoulder, {
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

  // EB outside shoulder bridging strip behind the flare & SW island (x: -16 to 16, z: 1.83 to 3.35)
  const ebSouthShoulderMouth = buildRectStrip(-16.0, 16.0, L.eb.rightShoulder[0], L.eb.rightShoulder[1], 0.0, matAsphaltSideRoad, {
    stepX: 1.5
  });
  ebSouthShoulderMouth.name = 'eb_outside_shoulder_mouth_bridge';
  ebSouthShoulderMouth.userData.citation = cite.sideRoad;
  grpMainline.add(ebSouthShoulderMouth);

  // Wheel-path wear strips along EB and WB travel lanes
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
  grpCrossover.userData.citation = `${cite.turnLanes}; ${cite.median}; USGS NAIP aerial (measured)`;
  root.add(grpCrossover);

  const noseRadius = 1.2;
  const westNoseTipX = L.crossover.x[0]; // -19.81
  const eastNoseTipX = L.crossover.x[1]; // +19.81

  // Main crossover asphalt x in [-19.81, 19.81], z in [-29.26, -5.49]
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

  // Flared asphalt fillets wrapping around the west and east median bullet noses (matching aerial Image 2)
  // West nose sits between zNorth = -28.65 and zSouth = -9.76 (center z = -19.205)
  const westZNorth = L.wb.leftShoulder[1]; // -28.65
  const westZSouth = L.ebLeftTurn.leftShoulder[0]; // -9.76
  const westZCenter = (westZNorth + westZSouth) * 0.5; // -19.205
  const westBackX = westNoseTipX - 6.5;

  const westFilletNorth = buildVariableZStrip(
    westBackX,
    westNoseTipX,
    L.wb.lanes[1], // -29.26
    (x) => {
      const t = Math.max(0, Math.min(1, (x - westBackX) / (westNoseTipX - westBackX)));
      const s = t * t * (3 - 2 * t);
      return westZNorth + ((westZCenter - noseRadius + 0.1) - westZNorth) * s;
    },
    0.0,
    matAsphaltCrossover,
    { stepX: 0.6, stepsZ: 2 }
  );
  westFilletNorth.name = 'crossover_west_fillet_north';
  westFilletNorth.userData.citation = 'USGS NAIP aerial (measured crossover flare)';
  grpCrossover.add(westFilletNorth);

  const westFilletSouth = buildVariableZStrip(
    westBackX,
    westNoseTipX,
    (x) => {
      const t = Math.max(0, Math.min(1, (x - westBackX) / (westNoseTipX - westBackX)));
      const s = t * t * (3 - 2 * t);
      return westZSouth + ((westZCenter + noseRadius - 0.1) - westZSouth) * s;
    },
    L.eb.lanes[0], // -5.49
    0.0,
    matAsphaltCrossover,
    { stepX: 0.6, stepsZ: 2 }
  );
  westFilletSouth.name = 'crossover_west_fillet_south';
  westFilletSouth.userData.citation = 'USGS NAIP aerial (measured crossover flare)';
  grpCrossover.add(westFilletSouth);

  // East nose sits between zNorth = -24.99 and zSouth = -6.10 (center z = -15.545)
  const eastZNorth = L.wbLeftTurn.leftShoulder[1]; // -24.99
  const eastZSouth = L.eb.leftShoulder[0]; // -6.10
  const eastZCenter = (eastZNorth + eastZSouth) * 0.5; // -15.545
  const eastBackX = eastNoseTipX + 6.5;

  const eastFilletNorth = buildVariableZStrip(
    eastNoseTipX,
    eastBackX,
    L.wb.lanes[1], // -29.26
    (x) => {
      const t = Math.max(0, Math.min(1, (eastBackX - x) / (eastBackX - eastNoseTipX)));
      const s = t * t * (3 - 2 * t);
      return eastZNorth + ((eastZCenter - noseRadius + 0.1) - eastZNorth) * s;
    },
    0.0,
    matAsphaltCrossover,
    { stepX: 0.6, stepsZ: 2 }
  );
  eastFilletNorth.name = 'crossover_east_fillet_north';
  eastFilletNorth.userData.citation = 'USGS NAIP aerial (measured crossover flare)';
  grpCrossover.add(eastFilletNorth);

  const eastFilletSouth = buildVariableZStrip(
    eastNoseTipX,
    eastBackX,
    (x) => {
      const t = Math.max(0, Math.min(1, (eastBackX - x) / (eastBackX - eastNoseTipX)));
      const s = t * t * (3 - 2 * t);
      return eastZSouth + ((eastZCenter + noseRadius - 0.1) - eastZSouth) * s;
    },
    L.eb.lanes[0], // -5.49
    0.0,
    matAsphaltCrossover,
    { stepX: 0.6, stepsZ: 2 }
  );
  eastFilletSouth.name = 'crossover_east_fillet_south';
  eastFilletSouth.userData.citation = 'USGS NAIP aerial (measured crossover flare)';
  grpCrossover.add(eastFilletSouth);

  // Longitudinal paving seam lines at crossover edges (z = -29.26 and z = -5.49) and centerline (z = -17.38)
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

  // Raised concrete curbed median nose (Type F curb, 0.15 m tall, rounded 1.2 m tip, yellow reflective paint)
  function buildMedianNose(side) {
    const isWest = side === 'west';
    const noseGrp = new THREE.Group();
    noseGrp.name = `median_nose_${side}`;
    noseGrp.userData.citation = 'inferred: FDOT Type F concrete curbed median nose (0.15 m height, 1.2 m radius nose) with yellow reflective paint';

    const zNorth = isWest ? westZNorth : eastZNorth;
    const zSouth = isWest ? westZSouth : eastZSouth;
    const zCenter = (zNorth + zSouth) * 0.5;
    const tipX = isWest ? westNoseTipX : eastNoseTipX;
    const dir = isWest ? -1 : 1;

    const curbHeight = 0.15;
    const curbWidth = 0.45;
    const noseLength = 6.5;

    const nSegs = 32;
    const outerPts = [];
    const innerPts = [];

    const tipCenterX = tipX + dir * noseRadius;
    const backX = tipX + dir * noseLength;

    const flankSteps = 10;
    for (let i = 0; i <= flankSteps; i++) {
      const t = i / flankSteps;
      const s = t * t * (3 - 2 * t);
      const x = backX + (tipCenterX - backX) * t;
      const zOut = zNorth + ((zCenter - noseRadius) - zNorth) * s;
      const dz = ((zCenter - noseRadius) - zNorth) * (6 * t * (1 - t)) / (tipCenterX - backX);
      const len = Math.hypot(1, dz) || 1;
      const nx = (isWest ? -dz : dz) / len;
      const nz = 1.0 / len;
      outerPts.push([x, zOut]);
      innerPts.push([x + nx * curbWidth, zOut + nz * curbWidth]);
    }

    for (let i = 1; i < nSegs; i++) {
      const u = i / nSegs;
      const x = tipCenterX + (isWest
        ? Math.cos(Math.PI * u + Math.PI * 0.5) * noseRadius
        : -Math.cos(Math.PI * u - Math.PI * 0.5) * noseRadius);
      const z = zCenter + Math.sin(-Math.PI * 0.5 + u * Math.PI) * noseRadius;
      const rIn = Math.max(0.1, noseRadius - curbWidth);
      const xIn = tipCenterX + (isWest
        ? Math.cos(Math.PI * u + Math.PI * 0.5) * rIn
        : -Math.cos(Math.PI * u - Math.PI * 0.5) * rIn);
      const zIn = zCenter + Math.sin(-Math.PI * 0.5 + u * Math.PI) * rIn;
      outerPts.push([x, z]);
      innerPts.push([xIn, zIn]);
    }

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

    const totalPts = outerPts.length;
    const pos = [];
    const uvs = [];
    const idx = [];

    for (let i = 0; i < totalPts; i++) {
      const [xo, zo] = outerPts[i];
      const [xi, zi] = innerPts[i];
      const yo = ctx.roadY(xo);
      const yi = ctx.roadY(xi);
      const yBot = Math.min(yo, ctx.groundY(xi, zi)) - 0.08;

      const xb = xo + (xi - xo) * 0.12;
      const zb = zo + (zi - zo) * 0.12;
      pos.push(
        xo, yBot, zo,
        xb, yo + curbHeight, zb,
        xi, yi + curbHeight, zi,
        xi, yBot, zi
      );
      const d = i * 0.35;
      uvs.push(d, 0, d, curbHeight, d, curbHeight + curbWidth, d, curbHeight + curbWidth + 0.15);

      if (i < totalPts - 1) {
        const b0 = i * 4;
        const b1 = (i + 1) * 4;
        idx.push(b0 + 0, b1 + 0, b0 + 1, b1 + 0, b1 + 1, b0 + 1);
        idx.push(b0 + 1, b1 + 1, b0 + 2, b1 + 1, b1 + 2, b0 + 2);
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

    // Concrete monolithic island cap over the front 3.8 m of the nose
    const capPos = [];
    const capUvs = [];
    const capIdx = [];
    const capCenter = [tipCenterX + dir * 0.9, zCenter];
    capPos.push(capCenter[0], ctx.roadY(capCenter[0]) + curbHeight - 0.008, capCenter[1]);
    capUvs.push(capCenter[0], capCenter[1]);

    const iStart = Math.max(0, flankSteps - 6);
    const iEnd = Math.min(totalPts - 1, flankSteps + nSegs + 6);
    for (let i = iStart; i <= iEnd; i++) {
      const [xi, zi] = innerPts[i];
      capPos.push(xi, ctx.roadY(xi) + curbHeight - 0.008, zi);
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

    // Yellow reflective paint coat on the front ~3.4 m of the curbed nose
    const paintPos = [];
    const paintUvs = [];
    const paintIdx = [];
    const pStart = Math.max(0, flankSteps - 5);
    const pEnd = Math.min(totalPts - 1, flankSteps + nSegs + 5);
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
        xb, yo + curbHeight + 0.004, zb,
        xi, yi + curbHeight + 0.004, zi
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
  // 3. NE 140th Court Mouth (z in [3.35, 16.0]) & SW Landscaped Corner Island
  // ---------------------------------------------------------------------------
  const grpSideRoad = new THREE.Group();
  grpSideRoad.name = 'ne140th_ct_mouth_and_sw_island';
  grpSideRoad.userData.citation = `${cite.sideRoad}; USGS NAIP aerial (measured SW island and commercial driveway apron)`;
  root.add(grpSideRoad);

  function flareEastWidth(z) {
    const z0 = L.sideRoad.flare.atZ; // 3.35
    const z1 = L.sideRoad.flare.untilZ; // 16.0
    const t = Math.max(0, Math.min(1, (z - z0) / (z1 - z0)));
    const arc = 1.0 - Math.sqrt(Math.max(0, 1.0 - (1.0 - t) * (1.0 - t)));
    return 3.05 + (16.0 - 3.05) * arc;
  }

  function flareWestMainWidth(z) {
    const z0 = L.sideRoad.flare.atZ;
    const z1 = L.sideRoad.flare.untilZ;
    const t = Math.max(0, Math.min(1, (z - z0) / (z1 - z0)));
    const arc = 1.0 - Math.sqrt(Math.max(0, 1.0 - (1.0 - t) * (1.0 - t)));
    return -3.05 - (16.0 - 3.05) * arc;
  }

  // Main NE 140th Ct flared mouth pavement (z from 3.35 to 16.0)
  const sideRoadMouthMesh = buildVariableXStripAlongZ(
    L.sideRoad.flare.atZ,
    L.sideRoad.flare.untilZ,
    (z) => flareWestMainWidth(z),
    (z) => flareEastWidth(z),
    0.0,
    matAsphaltSideRoad,
    { stepZ: 0.4, stepsX: 20, dropLeft: false, dropRight: true }
  );
  sideRoadMouthMesh.name = 'ne140th_flared_pavement';
  sideRoadMouthMesh.userData.citation = cite.sideRoad;
  grpSideRoad.add(sideRoadMouthMesh);

  // SW Commercial Driveway Apron (seen in USGS aerial Image 2 around the SW island x in [-34, -3], z in [3.35, 16])
  // Connects the EB right-turn lane / south shoulder to the SW corner commercial lot around the west and south sides of the island
  function swDriveWestEdge(z) {
    // At z = 5.49 starts at x = -34, curves smoothly to x = -23.5 at z = 16.0
    const t = Math.max(0, Math.min(1, (z - 5.49) / (16.0 - 5.49)));
    const s = t * t * (3 - 2 * t);
    return -34.0 + (-23.5 - (-34.0)) * s;
  }

  const swCommercialApron = buildVariableXStripAlongZ(
    5.40,
    16.0,
    (z) => swDriveWestEdge(z),
    (z) => flareWestMainWidth(z) + 0.5,
    -0.002,
    matAsphaltSideRoad,
    { stepZ: 0.5, stepsX: 14, dropLeft: true, dropRight: false }
  );
  swCommercialApron.name = 'sw_commercial_driveway_apron';
  swCommercialApron.userData.citation = 'USGS NAIP aerial (measured SW corner driveway apron around landscaped island)';
  grpSideRoad.add(swCommercialApron);

  // Gravel / shell-rock shoulder along the east edge of NE 140th Ct mouth and west edge of SW driveway
  const mouthGravelEast = buildVariableXStripAlongZ(
    L.sideRoad.flare.atZ + 0.2,
    L.sideRoad.flare.untilZ,
    (z) => flareEastWidth(z) - 0.05,
    (z) => flareEastWidth(z) + 1.35,
    -0.015,
    matGravelVerge,
    { stepZ: 0.6, stepsX: 3, dropRight: true, dropDepth: 0.03 }
  );
  mouthGravelEast.name = 'ne140th_mouth_gravel_east';
  mouthGravelEast.userData.citation = 'inferred: typical Florida shell-rock/limerock unpaved shoulder along local road return';
  grpSideRoad.add(mouthGravelEast);

  const mouthGravelWest = buildVariableXStripAlongZ(
    5.5,
    16.0,
    (z) => swDriveWestEdge(z) - 1.25,
    (z) => swDriveWestEdge(z) + 0.05,
    -0.015,
    matGravelVerge,
    { stepZ: 0.6, stepsX: 3, dropLeft: true, dropDepth: 0.03 }
  );
  mouthGravelWest.name = 'sw_driveway_gravel_west';
  mouthGravelWest.userData.citation = 'USGS NAIP aerial (measured limerock shoulder at SW corner)';
  grpSideRoad.add(mouthGravelWest);

  // Transverse paving seam where NE 140th Ct meets US-27A EB shoulder at z = 3.35
  const mouthSeam = buildRectStrip(-15.5, 15.5, 3.31, 3.39, 0.006, matCrackSeal, { stepX: 1.5 });
  mouthSeam.name = 'ne140th_paving_joint';
  mouthSeam.userData.citation = 'inferred: asphalt paving joint at side-road apron';
  grpSideRoad.add(mouthSeam);

  // --- SW Corner Landscaped Island (layout.aerial.swCorner.island: x [-24, -2], z [3, 12], low curb + grass, flush) ---
  function buildSwCornerIsland() {
    const islGrp = new THREE.Group();
    islGrp.name = 'sw_corner_landscaped_island';
    islGrp.userData.citation = 'USGS NAIP aerial (measured SW corner landscaped island x [-24,-2], z [3,12]; low curb + flush grass)';

    // Teardrop / rounded-triangle D-island matching aerial Image 2:
    // North edge parallels US-27A shoulder at z ~ 3.85 from x = -21.5 to -6.0
    // East edge curves along NE 140th Ct west throat from (-5.0, 4.6) to (-5.2, 10.6)
    // South/West edge arcs smoothly from (-6.0, 11.4) through (-14.5, 11.6) to (-22.8, 7.5) and back to (-21.5, 3.85)
    const ctrlPts = [
      [-14.0, 3.75],
      [-7.5, 3.85],
      [-4.6, 4.55],
      [-4.2, 6.80],
      [-4.8, 9.60],
      [-6.8, 11.20],
      [-11.5, 11.65],
      [-16.8, 11.35],
      [-21.2, 9.85],
      [-23.2, 7.40],
      [-22.5, 4.95],
      [-19.2, 3.85]
    ];

    // Catmull-Rom closed spline sampling for smooth curb perimeter
    const nSub = 6;
    const outerPts = [];
    const innerPts = [];
    const m = ctrlPts.length;
    const curbW = 0.32;
    const curbH = 0.11; // low mountable concrete island curb
    const cx = -13.5;
    const cz = 7.6;

    for (let i = 0; i < m; i++) {
      const p0 = ctrlPts[(i - 1 + m) % m];
      const p1 = ctrlPts[i];
      const p2 = ctrlPts[(i + 1) % m];
      const p3 = ctrlPts[(i + 2) % m];
      for (let j = 0; j < nSub; j++) {
        const t = j / nSub;
        const t2 = t * t;
        const t3 = t2 * t;
        const x = 0.5 * (
          (2 * p1[0]) +
          (-p0[0] + p2[0]) * t +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
        );
        const z = 0.5 * (
          (2 * p1[1]) +
          (-p0[1] + p2[1]) * t +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
        );
        outerPts.push([x, z]);
      }
    }

    const nPts = outerPts.length;
    for (let i = 0; i < nPts; i++) {
      const prev = outerPts[(i - 1 + nPts) % nPts];
      const curr = outerPts[i];
      const next = outerPts[(i + 1) % nPts];
      const tx = next[0] - prev[0];
      const tz = next[1] - prev[1];
      const len = Math.hypot(tx, tz) || 1;
      // Inward normal pointing toward (cx, cz)
      let nx = -tz / len;
      let nz = tx / len;
      if (nx * (cx - curr[0]) + nz * (cz - curr[1]) < 0) {
        nx = -nx;
        nz = -nz;
      }
      innerPts.push([curr[0] + nx * curbW, curr[1] + nz * curbW]);
    }

    const pos = [];
    const uvs = [];
    const idx = [];
    for (let i = 0; i <= nPts; i++) {
      const k = i % nPts;
      const [xo, zo] = outerPts[k];
      const [xi, zi] = innerPts[k];
      const yo = ctx.roadY(xo);
      const yi = ctx.roadY(xi);
      const xb = xo + (xi - xo) * 0.18;
      const zb = zo + (zi - zo) * 0.18;

      pos.push(
        xo, yo - 0.03, zo,
        xb, yo + curbH, zb,
        xi, yi + curbH, zi,
        xi, yi - 0.03, zi
      );
      const d = i * 0.3;
      uvs.push(d, 0, d, curbH, d, curbH + curbW, d, curbH + curbW + 0.1);

      if (i < nPts) {
        const b0 = i * 4;
        const b1 = (i + 1) * 4;
        idx.push(b0 + 0, b0 + 1, b1 + 0, b1 + 0, b0 + 1, b1 + 1);
        idx.push(b0 + 1, b0 + 2, b1 + 1, b1 + 1, b0 + 2, b1 + 2);
        idx.push(b0 + 2, b0 + 3, b1 + 2, b1 + 2, b0 + 3, b1 + 3);
      }
    }

    const curbGeom = new THREE.BufferGeometry();
    curbGeom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    curbGeom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    curbGeom.setIndex(idx);
    curbGeom.computeVertexNormals();
    const curbMesh = new THREE.Mesh(curbGeom, matConcreteCurb);
    curbMesh.receiveShadow = true;
    curbMesh.name = 'sw_island_curb';
    islGrp.add(curbMesh);

    // Flush grass interior cap inside the curb ring
    const grassPos = [cx, ctx.roadY(cx) + curbH - 0.015, cz];
    const grassUvs = [cx, cz];
    const grassIdx = [];
    for (let i = 0; i < nPts; i++) {
      const [xi, zi] = innerPts[i];
      grassPos.push(xi, ctx.roadY(xi) + curbH - 0.015, zi);
      grassUvs.push(xi, zi);
      const a = i + 1;
      const b = ((i + 1) % nPts) + 1;
      grassIdx.push(0, b, a);
    }
    const grassGeom = new THREE.BufferGeometry();
    grassGeom.setAttribute('position', new THREE.Float32BufferAttribute(grassPos, 3));
    grassGeom.setAttribute('uv', new THREE.Float32BufferAttribute(grassUvs, 2));
    grassGeom.setIndex(grassIdx);
    grassGeom.computeVertexNormals();
    const grassMesh = new THREE.Mesh(grassGeom, matIslandGrass);
    grassMesh.receiveShadow = true;
    grassMesh.name = 'sw_island_grass_cap';
    islGrp.add(grassMesh);

    // Subtle dark mulch bed strip along the southern curve of the island (seen as a dark crescent in aerial Image 2)
    // Kept completely flush (<= 0.12 m) so it obeys the sight-corridor keepClear rule
    const mulchPts = [
      [-19.5, 8.2],
      [-16.0, 10.1],
      [-11.5, 10.4],
      [-7.2, 9.6]
    ];
    const mulchRibbon = buildPolylineRibbon(mulchPts, 1.35, curbH - 0.008, matIslandMulch);
    mulchRibbon.name = 'sw_island_mulch_bed';
    islGrp.add(mulchRibbon);

    return islGrp;
  }

  grpSideRoad.add(buildSwCornerIsland());

  // ---------------------------------------------------------------------------
  // 4. North Leg Mouth (USGS aerial: x ~ -38..-14, z from -38.1 to -44.0, heading NNW)
  // ---------------------------------------------------------------------------
  const grpNorthLeg = new THREE.Group();
  grpNorthLeg.name = 'north_leg_mouth';
  grpNorthLeg.userData.citation = 'USGS NAIP aerial (measured north leg leaving WB shoulder at x [-38,-14], z [-38.1,-44] heading NNW)';
  root.add(grpNorthLeg);

  // At z = -38.10 (WB north shoulder edge), mouth spans x in [-38.0, -14.0] (center -26.0)
  // By z = -44.0, the flared returns narrow to an ~8.2 m throat centered at x = -27.2 (heading NNW at ~ -0.33 m X per m north)
  function northLegWestEdge(z) {
    const t = Math.max(0, Math.min(1, (-38.10 - z) / (44.0 - 38.10)));
    const arc = 1.0 - Math.sqrt(Math.max(0, 1.0 - (1.0 - t) * (1.0 - t)));
    const xThroatW = -31.2 - 0.33 * (-38.10 - z);
    return xThroatW + (-38.0 - xThroatW) * arc;
  }

  function northLegEastEdge(z) {
    const t = Math.max(0, Math.min(1, (-38.10 - z) / (44.0 - 38.10)));
    const arc = 1.0 - Math.sqrt(Math.max(0, 1.0 - (1.0 - t) * (1.0 - t)));
    const xThroatE = -23.0 - 0.33 * (-38.10 - z);
    return xThroatE + (-14.0 - xThroatE) * arc;
  }

  const northLegPavement = buildVariableXStripAlongZ(
    -38.10,
    -44.0,
    (z) => northLegWestEdge(z),
    (z) => northLegEastEdge(z),
    0.0,
    matAsphaltSideRoad,
    { stepZ: 0.4, stepsX: 16, dropLeft: true, dropRight: true }
  );
  northLegPavement.name = 'north_leg_flared_pavement';
  northLegPavement.userData.citation = 'USGS NAIP aerial (measured)';
  grpNorthLeg.add(northLegPavement);

  // Gravel/shell-rock shoulders along the north leg returns
  const northLegGravelW = buildVariableXStripAlongZ(
    -38.25,
    -44.0,
    (z) => northLegWestEdge(z) - 1.25,
    (z) => northLegWestEdge(z) + 0.05,
    -0.015,
    matGravelVerge,
    { stepZ: 0.5, stepsX: 3, dropLeft: true, dropDepth: 0.03 }
  );
  northLegGravelW.name = 'north_leg_gravel_west';
  northLegGravelW.userData.citation = 'USGS NAIP aerial (measured)';
  grpNorthLeg.add(northLegGravelW);

  const northLegGravelE = buildVariableXStripAlongZ(
    -38.25,
    -44.0,
    (z) => northLegEastEdge(z) - 0.05,
    (z) => northLegEastEdge(z) + 1.25,
    -0.015,
    matGravelVerge,
    { stepZ: 0.5, stepsX: 3, dropRight: true, dropDepth: 0.03 }
  );
  northLegGravelE.name = 'north_leg_gravel_east';
  northLegGravelE.userData.citation = 'USGS NAIP aerial (measured)';
  grpNorthLeg.add(northLegGravelE);

  // Transverse paving joint where north leg meets WB outside shoulder at z = -38.10
  const northLegSeam = buildRectStrip(-37.8, -14.2, -38.14, -38.06, 0.006, matCrackSeal, { stepX: 1.5 });
  northLegSeam.name = 'north_leg_paving_joint';
  northLegSeam.userData.citation = 'inferred: asphalt paving joint at north leg mouth';
  grpNorthLeg.add(northLegSeam);

  // ---------------------------------------------------------------------------
  // 5. MUTCD Pavement Markings, Turn Arrows, Dotted Extensions & RPMs
  // ---------------------------------------------------------------------------
  const grpMarkings = new THREE.Group();
  grpMarkings.name = 'pavement_markings';
  grpMarkings.userData.citation = 'MUTCD 2009 Part 3 (Sections 3B.04, 3B.06, 3B.08, 3B.11, 3B.16, 3B.20)';
  root.add(grpMarkings);

  const PAINT_Y = 0.012;
  const LINE_W = 0.15;
  const TURN_LINE_W = 0.20;

  function buildDashedLineX(xStart, xEnd, zCenter, width, dashLen, gapLen, mat, namePrefix) {
    const g = new THREE.Group();
    g.name = namePrefix;
    g.userData.citation = 'MUTCD Section 3B.04 (10-ft dash, 30-ft gap)';
    const cycle = dashLen + gapLen;
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

  // WB solid white right (north) edge line (z = -36.58), broken at the north leg mouth [-35.5, -16.5]
  const wbRightEdgeW = buildRectStrip(X_MIN, -35.5, L.wb.lanes[0] - LINE_W * 0.5, L.wb.lanes[0] + LINE_W * 0.5, PAINT_Y, matPaintWhite, { stepX: 2.0 });
  wbRightEdgeW.name = 'mark_wb_right_edge_west';
  wbRightEdgeW.userData.citation = 'MUTCD Section 3B.06 (Right Edge Line west of north leg)';
  grpMarkings.add(wbRightEdgeW);

  const wbRightEdgeE = buildRectStrip(-16.5, X_MAX, L.wb.lanes[0] - LINE_W * 0.5, L.wb.lanes[0] + LINE_W * 0.5, PAINT_Y, matPaintWhite, { stepX: 2.0 });
  wbRightEdgeE.name = 'mark_wb_right_edge_east';
  wbRightEdgeE.userData.citation = 'MUTCD Section 3B.06 (Right Edge Line east of north leg)';
  grpMarkings.add(wbRightEdgeE);

  // North leg return edge lines curving from z = -36.58 into the north leg throat up to z = -44.0
  const northLegWestCurvePts = [[-35.5, -36.58], [-37.0, -37.5]];
  for (let z = -38.1; z >= -44.0; z -= 0.6) {
    northLegWestCurvePts.push([northLegWestEdge(z) + 0.14, z]);
  }
  const northLegWestEdgeRibbon = buildPolylineRibbon(northLegWestCurvePts, LINE_W, PAINT_Y, matPaintWhite);
  northLegWestEdgeRibbon.name = 'mark_north_leg_west_flare_edge';
  northLegWestEdgeRibbon.userData.citation = 'USGS NAIP aerial (measured north leg edge line)';
  grpMarkings.add(northLegWestEdgeRibbon);

  const northLegEastCurvePts = [[-16.5, -36.58], [-15.0, -37.5]];
  for (let z = -38.1; z >= -44.0; z -= 0.6) {
    northLegEastCurvePts.push([northLegEastEdge(z) - 0.14, z]);
  }
  const northLegEastEdgeRibbon = buildPolylineRibbon(northLegEastCurvePts, LINE_W, PAINT_Y, matPaintWhite);
  northLegEastEdgeRibbon.name = 'mark_north_leg_east_flare_edge';
  northLegEastEdgeRibbon.userData.citation = 'USGS NAIP aerial (measured north leg edge line)';
  grpMarkings.add(northLegEastEdgeRibbon);

  // Stop bar on southbound North Leg approach at z = -40.2 across the westbound/southbound half of the throat
  const northLegStopBar = buildPolylineRibbon([[-31.5, -40.3], [-27.2, -40.0]], 0.40, PAINT_Y, matPaintWhite);
  northLegStopBar.name = 'mark_north_leg_stop_bar';
  northLegStopBar.userData.citation = 'USGS NAIP aerial (measured stop bar on north leg approach)';
  grpMarkings.add(northLegStopBar);

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

  // EB solid white outer edge line along EB right-turn lane (x: -45 to -33.5, z = 5.49) before SW driveway opening
  const ebRightOuterEdge = buildRectStrip(X_MIN, -33.5, L.ebRightTurn.z[1] - LINE_W * 0.5, L.ebRightTurn.z[1] + LINE_W * 0.5, PAINT_Y, matPaintWhite, { stepX: 2.0 });
  ebRightOuterEdge.name = 'mark_eb_right_turn_outer_edge';
  ebRightOuterEdge.userData.citation = 'MUTCD Section 3B.06 (Right Edge Line along auxiliary turn lane)';
  grpMarkings.add(ebRightOuterEdge);

  // West flare edge line along NE 140th Ct throat from (-4.2, 5.2) down to (-3.05, 16.0)
  const westFlareEdgePts = [];
  for (let z = 11.0; z <= 16.0; z += 0.5) {
    westFlareEdgePts.push([flareWestMainWidth(z) + 0.12, z]);
  }
  const westFlareEdgeRibbon = buildPolylineRibbon(westFlareEdgePts, LINE_W, PAINT_Y, matPaintWhite);
  westFlareEdgeRibbon.name = 'mark_ne140th_west_flare_edge';
  westFlareEdgeRibbon.userData.citation = 'MUTCD Section 3B.06 (Right edge line return into side road)';
  grpMarkings.add(westFlareEdgeRibbon);

  // East flare edge line curve from (3.05, 16.0) up to (16.0, 1.83)
  const eastFlareEdgePts = [];
  for (let z = 16.0; z >= 5.0; z -= 0.5) {
    eastFlareEdgePts.push([flareEastWidth(z) - 0.12, z]);
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

  // Stop bar on northbound NE 140th Ct at z = 5.5 across x in [0, 3.05], width = 0.40 m (no centerline per brief)
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

  // Dotted white extension lines (0.61 m dash / 1.22 m gap, 0.15 m wide) through the crossover for both turn movements
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

  grpMarkings.add(addDottedCurve([19.81, -25.60], [8.5, -25.2], [2.4, -17.5], 'mark_crossover_dotted_wb_turn'));
  grpMarkings.add(addDottedCurve([-19.81, -9.15], [-8.5, -9.5], [-2.4, -17.2], 'mark_crossover_dotted_eb_turn'));

  // Continuity dotted edge lines across the crossover along EB left edge (z = -5.49) and WB left edge (z = -29.26)
  grpMarkings.add(buildDashedLineX(-19.0, -3.5, L.wb.lanes[1], LINE_W, 0.61, 1.83, matPaintWhite, 'mark_wb_crossover_continuity'));
  grpMarkings.add(buildDashedLineX(3.5, 19.0, L.eb.lanes[0], LINE_W, 0.61, 1.83, matPaintWhite, 'mark_eb_crossover_continuity'));

  // ---------------------------------------------------------------------------
  // Turn-Lane Arrows (MUTCD Figure 3B-24, 2.44 m long white thermoplastic)
  // ---------------------------------------------------------------------------
  function buildMutcdTurnArrow(centerX, centerZ, travelDirX, turnSide, id) {
    const arrowGrp = new THREE.Group();
    arrowGrp.name = id;
    arrowGrp.userData.citation = 'MUTCD Section 3B.20 & Figure 3B-24 (Lane-Use Arrow Pavement Marking, 8 ft / 2.44 m)';

    const vSign = turnSide === 'left' ? 1 : -1;
    const localTris = [];
    function addQuad(u0, v0, u1, v1, u2, v2, u3, v3) {
      localTris.push([u0, v0], [u1, v1], [u2, v2], [u0, v0], [u2, v2], [u3, v3]);
    }
    const vStem = -0.32 * vSign;
    addQuad(-1.22, vStem - 0.11, 0.05, vStem - 0.11, 0.05, vStem + 0.11, -1.22, vStem + 0.11);

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

  // 2 left-turn arrows in WB left-turn lane (z = -27.43) within x in [19.81, 45] (matching aerial Image 2 at x ~ 28 and x ~ 42)
  grpMarkings.add(buildMutcdTurnArrow(27.5, L.wbLeftTurn.center, -1, 'left', 'arrow_wb_left_1'));
  grpMarkings.add(buildMutcdTurnArrow(41.5, L.wbLeftTurn.center, -1, 'left', 'arrow_wb_left_2'));

  // 2 left-turn arrows in EB left-turn lane (z = -7.32) within x in [-45, -19.81]
  grpMarkings.add(buildMutcdTurnArrow(-27.5, L.ebLeftTurn.center, 1, 'left', 'arrow_eb_left_1'));
  grpMarkings.add(buildMutcdTurnArrow(-41.5, L.ebLeftTurn.center, 1, 'left', 'arrow_eb_left_2'));

  // 2 right-turn arrows in EB right-turn lane (z = +3.66) within x in [-45, -9] (seen clearly in aerial Image 2)
  grpMarkings.add(buildMutcdTurnArrow(-16.5, L.ebRightTurn.center, 1, 'right', 'arrow_eb_right_1'));
  grpMarkings.add(buildMutcdTurnArrow(-35.5, L.ebRightTurn.center, 1, 'right', 'arrow_eb_right_2'));

  // ---------------------------------------------------------------------------
  // Raised Pavement Markers (RPMs) every 12.2 m (InstancedMesh)
  // ---------------------------------------------------------------------------
  const grpRpms = new THREE.Group();
  grpRpms.name = 'raised_pavement_markers';
  grpRpms.userData.citation = 'MUTCD Section 3B.11 (Raised Pavement Markers, 40-ft / 12.2 m spacing; clear on white, amber on yellow)';
  root.add(grpRpms);

  const whiteRpmCoords = [];
  const amberRpmCoords = [];

  const rpmStep = 12.192;
  for (let k = -4; k <= 3; k++) {
    const xRpm = k * rpmStep + 4.57;
    if (xRpm >= X_MIN + 0.5 && xRpm <= X_MAX - 0.5) {
      whiteRpmCoords.push([xRpm, L.eb.laneLine]);
      whiteRpmCoords.push([xRpm, L.wb.laneLine]);
    }
  }

  for (let x = 22.0; x <= 44.0; x += 6.1) {
    whiteRpmCoords.push([x, L.wbLeftTurn.z[0]]);
  }
  for (let x = -44.0; x <= -22.0; x += 6.1) {
    whiteRpmCoords.push([x, L.ebLeftTurn.z[1]]);
  }
  for (let x = -43.0; x <= -12.0; x += 6.1) {
    whiteRpmCoords.push([x, L.ebRightTurn.z[0]]);
  }

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
  // 6. MUTCD Traffic Control Devices & Signage
  // ---------------------------------------------------------------------------
  const grpSigns = new THREE.Group();
  grpSigns.name = 'traffic_control_devices';
  grpSigns.userData.citation = `${cite.stopSign}; MUTCD 2009 Part 2 (R1-1, R4-7, R6-1, R6-3, D3-1, OM3)`;
  root.add(grpSigns);

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

  function createPlateMesh(w, h, faceMat, name) {
    const grp = new THREE.Group();
    grp.name = name;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), faceMat);
    front.position.z = -0.008;
    front.rotation.y = Math.PI;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), matSignBack);
    back.position.z = 0.008;
    grp.add(front, back);
    return grp;
  }

  // OM-3 Object Marker (0.30 x 0.91 m)
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

  // R4-7 KEEP RIGHT
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
    g.beginPath();
    g.arc(82, 210, 26, Math.PI, 0, false);
    g.lineTo(108, 265);
    g.lineTo(56, 265);
    g.closePath();
    g.fill();
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

  // R6-1 ONE WAY horizontal arrow plate (0.91 x 0.30 m)
  function makeOneWayMat(dirRight) {
    return makeSignFaceMaterial(384, 128, 0x181818, (g, w, h) => {
      g.fillStyle = '#141414';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#f5f5f5';
      g.lineWidth = 6;
      g.strokeRect(5, 5, w - 10, h - 10);
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

  // R6-3 DIVIDED HIGHWAY plaque (0.61 x 0.46 m)
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
    g.beginPath();
    if (g.roundRect) g.roundRect(104, 112, 48, 28, 12);
    else g.fillRect(104, 112, 48, 28);
    g.fill();
    g.lineWidth = 10;
    g.beginPath();
    g.moveTo(195, 100);
    g.lineTo(65, 100);
    g.stroke();
    g.beginPath();
    g.moveTo(48, 100); g.lineTo(72, 88); g.lineTo(72, 112); g.closePath(); g.fill();
    g.beginPath();
    g.moveTo(61, 154);
    g.lineTo(191, 154);
    g.stroke();
    g.beginPath();
    g.moveTo(208, 154); g.lineTo(184, 142); g.lineTo(184, 166); g.closePath(); g.fill();
  });

  // D3-1 Street Name Blades
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
  const stopX = L.sideRoad.stopSign[0]; // 4.2
  const stopZ = L.sideRoad.stopSign[1]; // 6.0
  const stopAssembly = new THREE.Group();
  stopAssembly.name = 'sign_stop_ne140_assembly';
  stopAssembly.userData.citation = `${cite.stopSign}; MUTCD R1-1 (30 in STOP at 2.13 m bottom), R6-3 (DIVIDED HIGHWAY), D3-1 street blades`;
  stopAssembly.position.set(stopX, ctx.roadY(stopX), stopZ);
  stopAssembly.rotation.y = Math.PI; // faces +Z (south, toward northbound drivers)

  const stopSign = assets.sign({
    id: 'sign_stop_r1_1',
    kind: 'stop',
    mountHeight: 2.13,
    rural: true,
    w: 0.76,
    h: 0.76
  });
  stopAssembly.add(stopSign);

  const divHwyPlaque = createPlateMesh(0.61, 0.46, matDividedHwy, 'plaque_r6_3_divided_highway');
  divHwyPlaque.position.set(0, 1.82, -0.02);
  stopAssembly.add(divHwyPlaque);

  const topExtPost = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.65, 0.03), matPostSteel);
  topExtPost.position.set(0, 3.05, 0);
  stopAssembly.add(topExtPost);

  const bladeUS27A_F = createPlateMesh(0.76, 0.20, matBladeUS27A, 'blade_us27a_south');
  bladeUS27A_F.position.set(0, 3.08, 0);
  const bladeUS27A_B = createPlateMesh(0.76, 0.20, matBladeUS27A, 'blade_us27a_north');
  bladeUS27A_B.position.set(0, 3.08, 0);
  bladeUS27A_B.rotation.y = Math.PI;
  stopAssembly.add(bladeUS27A_F, bladeUS27A_B);

  const bladeNE140_E = createPlateMesh(0.84, 0.20, matBladeNE140, 'blade_ne140_east');
  bladeNE140_E.position.set(0, 3.29, 0);
  bladeNE140_E.rotation.y = Math.PI * 0.5;
  const bladeNE140_W = createPlateMesh(0.84, 0.20, matBladeNE140, 'blade_ne140_west');
  bladeNE140_W.position.set(0, 3.29, 0);
  bladeNE140_W.rotation.y = -Math.PI * 0.5;
  stopAssembly.add(bladeNE140_E, bladeNE140_W);

  grpSigns.add(stopAssembly);

  // --- B. Median Nose Assemblies (KEEP RIGHT R4-7 + OM-3 Object Marker on each concrete island nose cap) ---
  function buildNoseSignAssembly(x, z, facingRotY, idPrefix) {
    const g = new THREE.Group();
    g.name = idPrefix;
    g.userData.citation = 'inferred: MUTCD Section 2B.32 (R4-7 Keep Right) & Section 2C.63 (OM-3 Object Marker) on median nose (breakaway post <= 2.2 m)';
    const baseY = ctx.roadY(x) + 0.145; // rooted directly in the 0.15 m concrete island cap
    g.position.set(x, baseY, z);
    g.rotation.y = facingRotY;

    const post = new THREE.Mesh(new THREE.BoxGeometry(0.055, 2.02, 0.03), matPostSteel);
    post.position.set(0, 1.01, 0);
    post.castShadow = true;
    g.add(post);

    const r47 = createPlateMesh(0.61, 0.76, matKeepRight, `${idPrefix}_r4_7_keep_right`);
    r47.position.set(0, 1.60, -0.02);
    g.add(r47);

    const om3 = createPlateMesh(0.25, 0.76, matOM3, `${idPrefix}_om3_marker`);
    om3.position.set(0, 0.76, -0.02);
    g.add(om3);

    return g;
  }

  // Placed directly on the concrete cap of the west nose (-21.4, -19.2) facing EB traffic (-X -> rotation.y = +PI/2)
  grpSigns.add(buildNoseSignAssembly(-21.4, westZCenter, Math.PI * 0.5, 'sign_west_nose_eb_keep_right'));

  // Placed directly on the concrete cap of the east nose (+21.4, -15.55) facing WB traffic (+X -> rotation.y = -PI/2)
  grpSigns.add(buildNoseSignAssembly(21.4, eastZCenter, -Math.PI * 0.5, 'sign_east_nose_wb_keep_right'));

  // --- C. ONE WAY (R6-1) Signs in the Median Facing Crossover / NE 140th Ct Traffic ---
  function buildOneWayAssembly(x, z, facingRotY, pointRight, id) {
    const g = new THREE.Group();
    g.name = id;
    g.userData.citation = 'inferred: MUTCD Section 2B.40 & Figure 2B-15 (R6-1 ONE WAY signs at divided highway median crossover, height <= 2.1 m)';
    const baseY = ctx.groundY(x, z);
    g.position.set(x, baseY, z);
    g.rotation.y = facingRotY;

    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.95, 0.03), matPostSteel);
    post.position.set(0, 0.925, 0);
    post.castShadow = true;
    g.add(post);

    const plate = createPlateMesh(0.91, 0.30, pointRight ? matOneWayRight : matOneWayLeft, `${id}_r6_1`);
    plate.position.set(0, 1.72, -0.02);
    g.add(plate);
    return g;
  }

  // East median south flank (x = 22.8, z = -7.8): faces +Z (rotation.y = PI, toward NB NE 140th Ct drivers), points RIGHT (+X / EB)
  grpSigns.add(buildOneWayAssembly(22.8, -7.8, Math.PI, true, 'sign_one_way_eb_south_facing'));

  // East median north flank (x = 22.8, z = -23.2): faces +Z (rotation.y = PI, toward NB crossover drivers), points LEFT (-X / WB)
  grpSigns.add(buildOneWayAssembly(22.8, -23.2, Math.PI, false, 'sign_one_way_wb_south_facing'));

  // West median south flank (x = -22.8, z = -11.4): faces -Z (rotation.y = 0, toward SB crossover drivers), points LEFT (+X / EB)
  grpSigns.add(buildOneWayAssembly(-22.8, -11.4, 0, false, 'sign_one_way_eb_north_facing'));

  // West median north flank (x = -22.8, z = -26.8): faces -Z (rotation.y = 0, toward SB crossover drivers), points RIGHT (-X / WB)
  grpSigns.add(buildOneWayAssembly(-22.8, -26.8, 0, true, 'sign_one_way_wb_north_facing'));

  return root;
}
