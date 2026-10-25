// r6_terrain — Graded terrain mesh, horizon skirt, roadside grass tufts, and distant Florida pine/oak/palm ring
export default function region(THREE, assets, ctx) {
  const root = new THREE.Group();
  root.name = 'region_r6_terrain';
  root.userData.citation = 'NTSB/HAR-17/02 p.3, p.22-23, p.29-30 (roadway profile, median/roadside section, unobstructed sightlines)';

  const L = ctx.layout || {};
  const citeProfile = (L.cite && L.cite.profile) || 'NTSB/HAR-17/02 p.22-23 (crest 1,132 ft W of intersection; EB descends 2.15% for 1,459 ft; levels 327 ft E)';
  const citeMedian = (L.cite && L.cite.median) || 'NTSB/HAR-17/02 p.3, p.22 (grass median ~60 ft)';
  const citeNoObs = (L.cite && L.cite.noObstruction) || 'NTSB/HAR-17/02 p.29-30 (crest was the only sight restriction; no vegetation or other obstructions)';

  // ---------------------------------------------------------------------------
  // Helper: Check if (x, z) lies beneath any carriageway, shoulder, turn lane,
  // crossover, or NE 140th Ct pavement so terrain drops 0.03 m below roadY(x).
  // ---------------------------------------------------------------------------
  function isUnderPavement(x, z) {
    // EB main lanes + shoulders: z in [-6.10, 3.35] (with 0.25m margin for vertex safety)
    if (z >= -6.35 && z <= 3.60) return true;
    // WB main lanes + shoulders: z in [-38.10, -28.65]
    if (z >= -38.35 && z <= -28.40) return true;
    // EB right-turn lane + shifted shoulder: x in [-202, -8], z in [1.83, 6.2]
    if (x >= -202 && x <= -8 && z >= 1.5 && z <= 6.2) return true;
    // EB left-turn lane + shoulder: x in [-222, -18], z in [-10.0, -5.49]
    if (x >= -222 && x <= -18 && z >= -10.0 && z <= -5.2) return true;
    // WB left-turn lane + shoulder: x in [18, 222], z in [-29.26, -24.75]
    if (x >= 18 && x <= 222 && z >= -29.5 && z <= -24.75) return true;
    // Median crossover: x in [-20.5, 20.5], z in [-29.5, -5.2]
    if (x >= -20.5 && x <= 20.5 && z >= -29.5 && z <= -5.2) return true;
    // NE 140th Ct + flare mouth
    if (z >= 3.0 && z <= 16.5) {
      const t = Math.max(0, Math.min(1, (z - 3.35) / (16.0 - 3.35)));
      const halfW = 16.5 * (1 - t) + 3.6 * t;
      if (Math.abs(x) <= halfW) return true;
    }
    if (z > 16.0 && z <= 232.0 && Math.abs(x) <= 3.65) return true;
    return false;
  }

  // ---------------------------------------------------------------------------
  // Helper: Terrain elevation at (x, z) with pavement depression
  // ---------------------------------------------------------------------------
  function terrainY(x, z) {
    if (isUnderPavement(x, z)) {
      return ctx.roadY(x) - 0.03;
    }
    return ctx.groundY(x, z);
  }

  // ---------------------------------------------------------------------------
  // Helper: Deterministic 2D value noise for subtle soil/grass vertex tinting
  // ---------------------------------------------------------------------------
  function hash2(ix, iz) {
    const n = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  }

  function fbm2(x, z) {
    function smoothNoise(px, pz) {
      const ix = Math.floor(px);
      const iz = Math.floor(pz);
      const fx = px - ix;
      const fz = pz - iz;
      const u = fx * fx * (3.0 - 2.0 * fx);
      const v = fz * fz * (3.0 - 2.0 * fz);
      const a = hash2(ix, iz);
      const b = hash2(ix + 1, iz);
      const c = hash2(ix, iz + 1);
      const d = hash2(ix + 1, iz + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    return (
      0.55 * smoothNoise(x * 0.025, z * 0.025) +
      0.30 * smoothNoise(x * 0.08, z * 0.08) +
      0.15 * smoothNoise(x * 0.22, z * 0.22)
    );
  }

  // ---------------------------------------------------------------------------
  // 1. Non-uniform Grid Coordinates for X [-1000, 800] and Z [-500, 500]
  // ---------------------------------------------------------------------------
  function buildXCoords() {
    const xs = [];
    function pushRange(start, end, step) {
      const count = Math.round((end - start) / step);
      for (let i = 0; i < count; i++) {
        xs.push(start + i * step);
      }
    }
    pushRange(-1000, -450, 14.0);
    pushRange(-450, 300, 4.0);
    pushRange(300, 800, 12.5);
    xs.push(800);
    return xs;
  }

  function buildZCoordsRow() {
    // ROW band: z in [-50, 20], dense spacing (0.5 m to 1.0 m) across ditches, shoulders, median swale
    const zs = [];
    function pushRange(start, end, step) {
      const count = Math.round((end - start) / step);
      for (let i = 0; i < count; i++) {
        zs.push(+(start + i * step).toFixed(3));
      }
    }
    pushRange(-50, -40, 1.0);   // north ditch (center -44, halfWidth 3)
    pushRange(-40, -35, 0.714); // WB right shoulder edge
    pushRange(-35, -24, 1.0);   // WB lanes + turn lane
    pushRange(-24, -6, 1.0);    // grass median swale
    pushRange(-6, 6, 0.75);     // EB lanes + shoulder + turn lanes
    pushRange(6, 13, 0.7);      // south ditch (center 9, halfWidth 3)
    pushRange(13, 20, 1.0);     // south ROW to utility pole line
    zs.push(20.0);
    return zs;
  }

  function buildZCoordsNorthPasture() {
    const zs = [];
    function pushRange(start, end, step) {
      const count = Math.round((end - start) / step);
      for (let i = 0; i < count; i++) {
        zs.push(+(start + i * step).toFixed(3));
      }
    }
    pushRange(-500, -180, 12.0);
    pushRange(-180, -80, 8.0);
    pushRange(-80, -50, 4.0);
    zs.push(-50.0);
    return zs;
  }

  function buildZCoordsSouthPasture() {
    const zs = [];
    function pushRange(start, end, step) {
      const count = Math.round((end - start) / step);
      for (let i = 0; i < count; i++) {
        zs.push(+(start + i * step).toFixed(3));
      }
    }
    pushRange(20, 60, 4.0);
    pushRange(60, 180, 8.0);
    pushRange(180, 500, 12.0);
    zs.push(500.0);
    return zs;
  }

  // Vertex color calculator for realistic Bahia grass, sandy ditch bottoms, worn aprons
  function computeVertexColor(x, z, isRow) {
    const n1 = fbm2(x, z);
    const n2 = fbm2(x + 317.0, z - 189.0);

    // Base color: mowed ROW grass vs outer pasture
    let r, g, b;
    if (isRow) {
      // Brighter mowed Bahia grass in ROW (neutral-warm multiplier for ctx.surface('grass'))
      r = 0.88 + 0.14 * n1;
      g = 0.92 + 0.12 * n1;
      b = 0.78 + 0.10 * n2;
    } else {
      // Slightly darker, patchier rural pasture beyond fence lines
      r = 0.76 + 0.22 * n1;
      g = 0.80 + 0.18 * n1;
      b = 0.66 + 0.16 * n2;
      // Occasional dry/tall Bahia patches in pasture
      if (n2 > 0.66) {
        const dry = Math.min(1, (n2 - 0.66) * 3.0);
        r += 0.18 * dry;
        g += 0.08 * dry;
        b -= 0.04 * dry;
      }
    }

    // Median grass swale moisture darkening near z = -15.24
    if (z > -25.0 && z < -6.5 && Math.abs(x) > 20.0) {
      const swaleDist = Math.abs(z - (-15.24)) / 9.0;
      if (swaleDist < 1.0) {
        const w = (1.0 - swaleDist) * 0.12;
        r -= w * 0.4;
        g += w * 0.2;
        b -= w * 0.3;
      }
    }

    // South ditch sandy bottom (z around 9.0, depth 0.6, except gaps [-8, 34] and [276, 284])
    const inSouthGap = (x >= -8 && x <= 34) || (x >= 276 && x <= 284);
    if (!inSouthGap && Math.abs(z - 9.0) < 2.6) {
      const dt = 1.0 - Math.abs(z - 9.0) / 2.6;
      const sandBlend = dt * dt * 0.75;
      r = r * (1 - sandBlend) + 1.12 * sandBlend;
      g = g * (1 - sandBlend) + 1.02 * sandBlend;
      b = b * (1 - sandBlend) + 0.82 * sandBlend;
    }

    // North ditch sandy bottom (z around -44.0, depth 0.5)
    if (Math.abs(z - (-44.0)) < 2.5) {
      const dt = 1.0 - Math.abs(z - (-44.0)) / 2.5;
      const sandBlend = dt * dt * 0.65;
      r = r * (1 - sandBlend) + 1.08 * sandBlend;
      g = g * (1 - sandBlend) + 0.98 * sandBlend;
      b = b * (1 - sandBlend) + 0.80 * sandBlend;
    }

    // Side-road mouth & store apron edges (sandy/limerock shoulder wear)
    if (x >= -20 && x <= 38 && z >= 2.5 && z <= 22) {
      const dx = x < 0 ? Math.abs(x + 3) / 17 : Math.max(0, x - 33) / 6;
      const dz = Math.max(0, z - 14) / 8;
      const edgeWear = Math.max(0, 1.0 - Math.sqrt(dx * dx + dz * dz)) * 0.55;
      r = r * (1 - edgeWear) + 1.15 * edgeWear;
      g = g * (1 - edgeWear) + 1.06 * edgeWear;
      b = b * (1 - edgeWear) + 0.88 * edgeWear;
    }

    // Residential driveway edges (x in [275, 285], z in [3.35, 45])
    if (x >= 274 && x <= 286 && z >= 3.0 && z <= 46.0) {
      const distDrv = Math.min(Math.abs(x - 278), Math.abs(x - 282));
      if (distDrv < 2.5) {
        const wear = (1.0 - distDrv / 2.5) * 0.65;
        r = r * (1 - wear) + 1.14 * wear;
        g = g * (1 - wear) + 1.04 * wear;
        b = b * (1 - wear) + 0.86 * wear;
      }
    }

    // Roadside shoulder sand dusting along EB & WB outer edges
    const distEbSh = Math.abs(z - 3.55);
    const distWbSh = Math.abs(z - (-38.30));
    const shDist = Math.min(distEbSh, distWbSh);
    if (shDist < 1.4) {
      const dust = (1.0 - shDist / 1.4) * 0.45;
      r = r * (1 - dust) + 1.10 * dust;
      g = g * (1 - dust) + 1.02 * dust;
      b = b * (1 - dust) + 0.85 * dust;
    }

    return [
      Math.max(0.2, Math.min(1.3, r)),
      Math.max(0.2, Math.min(1.3, g)),
      Math.max(0.2, Math.min(1.3, b))
    ];
  }

  // Builder for a terrain strip grid given X array and Z array
  function buildTerrainStripGeometry(xs, zs, isRow) {
    const nx = xs.length;
    const nz = zs.length;
    const vertCount = nx * nz;
    const positions = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const colors = new Float32Array(vertCount * 3);

    let pIdx = 0;
    let uIdx = 0;
    let cIdx = 0;

    for (let iz = 0; iz < nz; iz++) {
      const z = zs[iz];
      for (let ix = 0; ix < nx; ix++) {
        const x = xs[ix];
        const y = terrainY(x, z);

        positions[pIdx++] = x;
        positions[pIdx++] = y;
        positions[pIdx++] = z;

        // UVs in meters
        uvs[uIdx++] = x;
        uvs[uIdx++] = z;

        const [cr, cg, cb] = computeVertexColor(x, z, isRow);
        colors[cIdx++] = cr;
        colors[cIdx++] = cg;
        colors[cIdx++] = cb;
      }
    }

    const quadCount = (nx - 1) * (nz - 1);
    const indices = new Uint32Array(quadCount * 6);
    let iIdx = 0;
    for (let iz = 0; iz < nz - 1; iz++) {
      const row0 = iz * nx;
      const row1 = (iz + 1) * nx;
      for (let ix = 0; ix < nx - 1; ix++) {
        const a = row0 + ix;
        const b = row0 + ix + 1;
        const c = row1 + ix;
        const d = row1 + ix + 1;

        indices[iIdx++] = a;
        indices[iIdx++] = c;
        indices[iIdx++] = b;

        indices[iIdx++] = b;
        indices[iIdx++] = c;
        indices[iIdx++] = d;
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.setIndex(new THREE.BufferAttribute(indices, 1));
    geom.computeVertexNormals();
    return geom;
  }

  const xs = buildXCoords();
  const zsRow = buildZCoordsRow();
  const zsNorth = buildZCoordsNorthPasture();
  const zsSouth = buildZCoordsSouthPasture();

  // Materials using ctx.surface with vertexColors enabled
  const rowGrassBase = ctx.surface('grass', { color: 0x768a54, roughness: 0.92 });
  const rowGrassMat = rowGrassBase.clone();
  rowGrassMat.vertexColors = true;

  const pastureBase = ctx.surface('pasture', { color: 0x6b7c4e, roughness: 0.94 });
  const pastureMat = pastureBase.clone();
  pastureMat.vertexColors = true;

  const terrainGroup = new THREE.Group();
  terrainGroup.name = 'terrain_graded_ground';
  terrainGroup.userData.citation = `${citeProfile}; ${citeMedian}`;

  // ROW mesh (z in [-50, 20])
  const rowGeom = buildTerrainStripGeometry(xs, zsRow, true);
  const rowMesh = new THREE.Mesh(rowGeom, rowGrassMat);
  rowMesh.name = 'terrain_row_corridor';
  rowMesh.userData.citation = citeProfile;
  rowMesh.receiveShadow = true;
  terrainGroup.add(rowMesh);

  // North and South pasture meshes (merged into one BufferGeometry to minimize draw calls)
  const northGeom = buildTerrainStripGeometry(xs, zsNorth, false);
  const southGeom = buildTerrainStripGeometry(xs, zsSouth, false);

  function mergeTwoGeometries(g1, g2) {
    const pos1 = g1.attributes.position.array;
    const pos2 = g2.attributes.position.array;
    const norm1 = g1.attributes.normal.array;
    const norm2 = g2.attributes.normal.array;
    const uv1 = g1.attributes.uv.array;
    const uv2 = g2.attributes.uv.array;
    const col1 = g1.attributes.color.array;
    const col2 = g2.attributes.color.array;
    const idx1 = g1.index.array;
    const idx2 = g2.index.array;

    const pos = new Float32Array(pos1.length + pos2.length);
    pos.set(pos1, 0);
    pos.set(pos2, pos1.length);

    const norm = new Float32Array(norm1.length + norm2.length);
    norm.set(norm1, 0);
    norm.set(norm2, norm1.length);

    const uv = new Float32Array(uv1.length + uv2.length);
    uv.set(uv1, 0);
    uv.set(uv2, uv1.length);

    const col = new Float32Array(col1.length + col2.length);
    col.set(col1, 0);
    col.set(col2, col1.length);

    const idx = new Uint32Array(idx1.length + idx2.length);
    idx.set(idx1, 0);
    const offset = pos1.length / 3;
    for (let i = 0; i < idx2.length; i++) {
      idx[idx1.length + i] = idx2[i] + offset;
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
    merged.setIndex(new THREE.BufferAttribute(idx, 1));
    return merged;
  }

  const pastureGeom = mergeTwoGeometries(northGeom, southGeom);
  const pastureMesh = new THREE.Mesh(pastureGeom, pastureMat);
  pastureMesh.name = 'terrain_pasture_outer';
  pastureMesh.userData.citation = 'inferred: rural Levy County Bahia grass pasture and sandy soil surrounding US-27A';
  pastureMesh.receiveShadow = true;
  terrainGroup.add(pastureMesh);

  root.add(terrainGroup);

  // ---------------------------------------------------------------------------
  // 2. Sandy Swale / Ditch / Tire-worn Dirt Overlay Patches (subtle blended strips)
  // ---------------------------------------------------------------------------
  const soilOverlaysGroup = new THREE.Group();
  soilOverlaysGroup.name = 'terrain_sandy_patches';
  soilOverlaysGroup.userData.citation = 'inferred: sandy soil in drainage swales, culvert crossing, and unpaved apron edges';

  const dirtMat = ctx.surface('dirt', {
    color: 0x9b8e74,
    roughness: 0.95,
    polygonOffset: true
  });

  function buildDirtStrip(xStart, xEnd, xStep, zCenterFn, halfWidthFn, alphaDrop) {
    const steps = Math.max(2, Math.round((xEnd - xStart) / xStep));
    const nCols = steps + 1;
    const nRows = 5;
    const positions = new Float32Array(nCols * nRows * 3);
    const uvs = new Float32Array(nCols * nRows * 2);
    let p = 0;
    let u = 0;
    for (let ir = 0; ir < nRows; ir++) {
      const vFrac = (ir / (nRows - 1)) * 2 - 1; // -1 to +1
      for (let ic = 0; ic < nCols; ic++) {
        const x = xStart + (ic / steps) * (xEnd - xStart);
        const zc = zCenterFn(x);
        const hw = halfWidthFn(x);
        const z = zc + vFrac * hw;
        const edgeSink = Math.abs(vFrac) > 0.7 ? -alphaDrop : 0.008;
        const y = ctx.groundY(x, z) + edgeSink;
        positions[p++] = x;
        positions[p++] = y;
        positions[p++] = z;
        uvs[u++] = x;
        uvs[u++] = z;
      }
    }
    const indices = [];
    for (let ir = 0; ir < nRows - 1; ir++) {
      for (let ic = 0; ic < nCols - 1; ic++) {
        const a = ir * nCols + ic;
        const b = a + 1;
        const c = (ir + 1) * nCols + ic;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }

  // South ditch sandy bottom segments (west of store apron, between store apron and residential driveway, east of driveway)
  const ditchSegs = [
    [-420, -10],
    [36, 274],
    [286, 450]
  ];
  for (let i = 0; i < ditchSegs.length; i++) {
    const [x0, x1] = ditchSegs[i];
    const g = buildDirtStrip(
      x0,
      x1,
      6.0,
      () => 9.0,
      (x) => 1.15 + 0.25 * Math.sin(x * 0.07),
      0.04
    );
    const m = new THREE.Mesh(g, dirtMat);
    m.name = `south_ditch_sand_${i}`;
    m.userData.citation = 'inferred: sandy bottom of south roadside drainage swale';
    m.receiveShadow = true;
    soilOverlaysGroup.add(m);
  }

  // Tire-worn sandy ruts along residential driveway edges (x=277.6 and x=282.4, z in [4, 43])
  function buildZStrip(zStart, zEnd, zStep, xCenter, halfWidth) {
    const steps = Math.max(2, Math.round((zEnd - zStart) / zStep));
    const nRows = steps + 1;
    const nCols = 4;
    const positions = new Float32Array(nRows * nCols * 3);
    const uvs = new Float32Array(nRows * nCols * 2);
    let p = 0;
    let u = 0;
    for (let ir = 0; ir < nRows; ir++) {
      const z = zStart + (ir / steps) * (zEnd - zStart);
      for (let ic = 0; ic < nCols; ic++) {
        const uFrac = (ic / (nCols - 1)) * 2 - 1;
        const x = xCenter + uFrac * halfWidth;
        const drop = Math.abs(uFrac) > 0.6 ? -0.025 : 0.006;
        const y = ctx.groundY(x, z) + drop;
        positions[p++] = x;
        positions[p++] = y;
        positions[p++] = z;
        uvs[u++] = x;
        uvs[u++] = z;
      }
    }
    const indices = [];
    for (let ir = 0; ir < nRows - 1; ir++) {
      for (let ic = 0; ic < nCols - 1; ic++) {
        const a = ir * nCols + ic;
        const b = a + 1;
        const c = (ir + 1) * nCols + ic;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }

  const drvEdgeW = new THREE.Mesh(buildZStrip(4.0, 43.0, 3.0, 277.7, 0.75), dirtMat);
  drvEdgeW.name = 'driveway_worn_edge_west';
  drvEdgeW.userData.citation = 'inferred: tire-worn sandy edge along residential driveway';
  soilOverlaysGroup.add(drvEdgeW);

  const drvEdgeE = new THREE.Mesh(buildZStrip(4.0, 43.0, 3.0, 282.3, 0.75), dirtMat);
  drvEdgeE.name = 'driveway_worn_edge_east';
  drvEdgeE.userData.citation = 'inferred: tire-worn sandy edge along residential driveway';
  soilOverlaysGroup.add(drvEdgeE);

  root.add(soilOverlaysGroup);

  // ---------------------------------------------------------------------------
  // 3. Horizon Skirt Ring out to +/- 3200 m (prevents any horizon void)
  // ---------------------------------------------------------------------------
  const skirtGroup = new THREE.Group();
  skirtGroup.name = 'horizon_skirt_ring';
  skirtGroup.userData.citation = 'inferred: outer horizon terrain skirt matching Levy County elevation profile';

  function buildHorizonSkirtGeometry() {
    // Build 4 surrounding trapezoidal patches connecting the inner boundary
    // x in [-1000, 800], z in [-500, 500] out to x in [-3200, 3000], z in [-3000, 3000]
    // Subdivided along X so the east-west elevation profile (crest -> downgrade -> level) matches seamlessly.
    const xRingInner = [-1000, -700, -450, -345, -200, -50, 100, 300, 550, 800];
    const xRingOuter = [-3200, -2000, -1100, -650, -300, 0, 300, 900, 1800, 3000];
    const zRingInner = [-500, -250, -50, 0, 50, 250, 500];
    const zRingOuter = [-3000, -1500, -300, 0, 300, 1500, 3000];

    const positions = [];
    const uvs = [];
    const colors = [];
    const indices = [];

    function addPatch(gridPts) {
      // gridPts is 2D array [row][col] of [x, y, z]
      const baseVert = positions.length / 3;
      const nR = gridPts.length;
      const nC = gridPts[0].length;
      for (let r = 0; r < nR; r++) {
        for (let c = 0; c < nC; c++) {
          const [px, py, pz] = gridPts[r][c];
          positions.push(px, py, pz);
          uvs.push(px, pz);
          colors.push(0.82, 0.85, 0.72);
        }
      }
      for (let r = 0; r < nR - 1; r++) {
        for (let c = 0; c < nC - 1; c++) {
          const a = baseVert + r * nC + c;
          const b = a + 1;
          const d = baseVert + (r + 1) * nC + c;
          const e = d + 1;
          indices.push(a, d, b, b, d, e);
        }
      }
    }

    // North band: row 0 = outer (-3000), row 1 = mid (-1200), row 2 = inner (-500)
    const northGrid = [[], [], []];
    for (let i = 0; i < xRingInner.length; i++) {
      const xi = xRingInner[i];
      const xo = xRingOuter[i];
      const xm = 0.5 * (xi + xo);
      const yi = ctx.groundY(xi, -500) - 0.05;
      northGrid[0].push([xo, yi, -3000]);
      northGrid[1].push([xm, yi, -1200]);
      northGrid[2].push([xi, yi, -500]);
    }
    addPatch(northGrid);

    // South band: row 0 = inner (500), row 1 = mid (1200), row 2 = outer (3000)
    const southGrid = [[], [], []];
    for (let i = 0; i < xRingInner.length; i++) {
      const xi = xRingInner[i];
      const xo = xRingOuter[i];
      const xm = 0.5 * (xi + xo);
      const yi = ctx.groundY(xi, 500) - 0.05;
      southGrid[0].push([xi, yi, 500]);
      southGrid[1].push([xm, yi, 1200]);
      southGrid[2].push([xo, yi, 3000]);
    }
    addPatch(southGrid);

    // West band: col 0 = outer (-3200), col 1 = mid (-1800), col 2 = inner (-1000)
    const westGrid = [];
    for (let j = 0; j < zRingInner.length; j++) {
      const zi = zRingInner[j];
      const zo = zRingOuter[j];
      const zm = 0.5 * (zi + zo);
      const yi = ctx.groundY(-1000, zi) - 0.05;
      westGrid.push([
        [-3200, yi, zo],
        [-1800, yi, zm],
        [-1000, yi, zi]
      ]);
    }
    addPatch(westGrid);

    // East band: col 0 = inner (800), col 1 = mid (1600), col 2 = outer (3000)
    const eastGrid = [];
    for (let j = 0; j < zRingInner.length; j++) {
      const zi = zRingInner[j];
      const zo = zRingOuter[j];
      const zm = 0.5 * (zi + zo);
      const yi = ctx.groundY(800, zi) - 0.05;
      eastGrid.push([
        [800, yi, zi],
        [1600, yi, zm],
        [3000, yi, zo]
      ]);
    }
    addPatch(eastGrid);

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geom.setIndex(indices);
    geom.computeVertexNormals();
    return geom;
  }

  const skirtMesh = new THREE.Mesh(buildHorizonSkirtGeometry(), pastureMat);
  skirtMesh.name = 'horizon_skirt_mesh';
  skirtMesh.userData.citation = 'inferred: distant pasture horizon extension out to 3 km';
  skirtMesh.receiveShadow = true;
  skirtGroup.add(skirtMesh);
  root.add(skirtGroup);

  // ---------------------------------------------------------------------------
  // 4. Instanced Low Grass Tufts / Weeds along Fence Lines and Ditch Edges
  //    (<= 15k instances, <= 6 tris each, height <= 0.40 m, none on pavement)
  // ---------------------------------------------------------------------------
  const grassTuftsGroup = new THREE.Group();
  grassTuftsGroup.name = 'roadside_grass_tufts';
  grassTuftsGroup.userData.citation = 'inferred: unmowed Bahia grass tufts along wire fence lines and drainage swale banks';

  function createTuftGeometry() {
    // 3 crossed V-blades = 3 triangles (single-sided DoubleSide material = 3 tris total)
    const positions = new Float32Array(9 * 3);
    const normals = new Float32Array(9 * 3);
    const colors = new Float32Array(9 * 3);

    const angles = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
    const baseHalfW = 0.14;
    const tipLean = 0.09;

    for (let b = 0; b < 3; b++) {
      const ang = angles[b];
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const nx = -sa;
      const nz = ca;

      const idx = b * 9;
      // bottom-left
      positions[idx + 0] = -ca * baseHalfW;
      positions[idx + 1] = -0.02;
      positions[idx + 2] = -sa * baseHalfW;
      // bottom-right
      positions[idx + 3] = ca * baseHalfW;
      positions[idx + 4] = -0.02;
      positions[idx + 5] = sa * baseHalfW;
      // top-tip (slightly leaning outward)
      positions[idx + 6] = nx * tipLean;
      positions[idx + 7] = 1.0;
      positions[idx + 8] = nz * tipLean;

      for (let v = 0; v < 3; v++) {
        normals[idx + v * 3 + 0] = nx * 0.4;
        normals[idx + v * 3 + 1] = 0.916;
        normals[idx + v * 3 + 2] = nz * 0.4;
      }

      // Base darker green, tip warmer seed-head green/tan
      colors[idx + 0] = 0.34; colors[idx + 1] = 0.44; colors[idx + 2] = 0.22;
      colors[idx + 3] = 0.34; colors[idx + 4] = 0.44; colors[idx + 5] = 0.22;
      colors[idx + 6] = 0.64; colors[idx + 7] = 0.70; colors[idx + 8] = 0.40;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geom;
  }

  const tuftMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide
  });

  const randTuft = ctx.rand(6001);
  const tuftPlacements = []; // [x, y, z, rotY, scaleXZ, scaleY, r, g, b]

  function tryPushTuft(x, z, minH, maxH) {
    if (isUnderPavement(x, z)) return;
    // Skip store building footprint and apron (x in [3, 34], z in [3, 26])
    if (x >= 3.0 && x <= 34.0 && z >= 3.0 && z <= 26.0) return;
    // Skip residential driveway (x in [277, 283], z in [3, 45])
    if (x >= 277.0 && x <= 283.0 && z >= 3.0 && z <= 45.0) return;
    // Skip Witness B immediate circle
    const dwb = Math.hypot(x - 7.5, z - 6.5);
    if (dwb < 2.2) return;

    const y = ctx.groundY(x, z);
    const h = minH + randTuft() * (maxH - minH); // strictly <= 0.40 m
    const sxz = 0.65 + randTuft() * 0.65;
    const rotY = randTuft() * Math.PI * 2;
    const shade = 0.82 + randTuft() * 0.36;
    const dryTint = randTuft() * 0.14;
    tuftPlacements.push([
      x, y, z, rotY, sxz, Math.min(0.40, h),
      shade + dryTint, shade + dryTint * 0.4, shade - dryTint * 0.3
    ]);
  }

  // 1) Along South Fence #1 (z = 14.5, x in [85, 225])
  for (let x = 85; x <= 225; x += 0.28) {
    const jx = x + (randTuft() - 0.5) * 0.35;
    const jz = 14.5 + (randTuft() - 0.5) * 0.75;
    tryPushTuft(jx, jz, 0.18, 0.38);
  }

  // 2) Along South Cross Fence #2 (x = 225, z in [13, 31])
  for (let z = 13; z <= 31; z += 0.25) {
    const jx = 225.0 + (randTuft() - 0.5) * 0.70;
    const jz = z + (randTuft() - 0.5) * 0.30;
    tryPushTuft(jx, jz, 0.18, 0.38);
  }

  // 3) Along South ROW fence lines: x in [-600, -8] and [310, 600] at z = 14.5
  for (let x = -550; x <= -8; x += 0.55) {
    const jx = x + (randTuft() - 0.5) * 0.45;
    const jz = 14.5 + (randTuft() - 0.5) * 0.90;
    tryPushTuft(jx, jz, 0.16, 0.36);
  }
  for (let x = 310; x <= 600; x += 0.65) {
    const jx = x + (randTuft() - 0.5) * 0.45;
    const jz = 14.5 + (randTuft() - 0.5) * 0.90;
    tryPushTuft(jx, jz, 0.16, 0.36);
  }

  // 4) Along North ROW fence line: x in [-550, 550] at z = -50.0
  for (let x = -550; x <= 550; x += 0.75) {
    const jx = x + (randTuft() - 0.5) * 0.55;
    const jz = -50.0 + (randTuft() - 0.5) * 0.95;
    tryPushTuft(jx, jz, 0.18, 0.39);
  }

  // 5) Along South Ditch banks (z ~ 6.4 and z ~ 11.6, skipping gaps [-8, 34] and [276, 284])
  for (let x = -420; x <= 420; x += 0.55) {
    if ((x >= -9 && x <= 35) || (x >= 275 && x <= 285)) continue;
    const bankZ = randTuft() < 0.5 ? 6.4 : 11.6;
    const jx = x + (randTuft() - 0.5) * 0.5;
    const jz = bankZ + (randTuft() - 0.5) * 1.3;
    tryPushTuft(jx, jz, 0.14, 0.34);
  }

  // 6) Along North Ditch banks (z ~ -41.4 and z ~ -46.6)
  for (let x = -420; x <= 420; x += 0.75) {
    const bankZ = randTuft() < 0.5 ? -41.4 : -46.6;
    const jx = x + (randTuft() - 0.5) * 0.6;
    const jz = bankZ + (randTuft() - 0.5) * 1.4;
    tryPushTuft(jx, jz, 0.15, 0.35);
  }

  // 7) Around culvert headwalls at (120, 7) and (120, 11) and utility pole bases (z = 18.5)
  for (let i = 0; i < 65; i++) {
    const side = i % 2 === 0 ? 7.0 : 11.0;
    const jx = 120.0 + (randTuft() - 0.5) * 3.8;
    const jz = side + (randTuft() - 0.5) * 1.6;
    tryPushTuft(jx, jz, 0.18, 0.38);
  }

  const tuftCount = Math.min(12000, tuftPlacements.length);
  const tuftGeom = createTuftGeometry();
  const tuftInst = new THREE.InstancedMesh(tuftGeom, tuftMat, tuftCount);
  tuftInst.name = 'instanced_grass_tufts';
  tuftInst.userData.citation = 'inferred: low roadside Bahia grass and weed tufts (<= 0.40 m) along fences and swales';

  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();
  for (let i = 0; i < tuftCount; i++) {
    const [x, y, z, rotY, sxz, sy, cr, cg, cb] = tuftPlacements[i];
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.set(sxz, sy, sxz);
    dummy.updateMatrix();
    tuftInst.setMatrixAt(i, dummy.matrix);
    tmpColor.setRGB(cr, cg, cb);
    tuftInst.setColorAt(i, tmpColor);
  }
  tuftInst.instanceMatrix.needsUpdate = true;
  if (tuftInst.instanceColor) tuftInst.instanceColor.needsUpdate = true;
  grassTuftsGroup.add(tuftInst);
  root.add(grassTuftsGroup);

  // ---------------------------------------------------------------------------
  // 5. Far Vegetation Ring & Scattered Pasture Hammocks (150 m to 500 m out,
  //    plus continuous horizon tree lines along x = -1000 / 800 and z = +-500)
  // ---------------------------------------------------------------------------
  const farVegGroup = new THREE.Group();
  farVegGroup.name = 'far_vegetation_ring';
  farVegGroup.userData.citation = citeNoObs;

  // Strict sightline & keep-clear check for any solid vegetation in r6_terrain
  function isFarVegAllowed(x, z) {
    if (ctx.blocked(x, z)) return false;
    // West sight corridor: NOTHING solid in x [-700, 0], z [-45, 40]
    if (x >= -705 && x <= 10 && z >= -48 && z <= 43) return false;
    // Beyond the crest (x < -345) keep trees > 45 m from the road centreline (road spans z in [-38, 4])
    if (x < -340 && z >= -85 && z <= 55) return false;
    // Stay strictly outside the near-road corridor handled by r4/r5:
    // Keep all r6 trees at least 115 m away from road centerline within x in [-550, 450]
    if (x >= -600 && x <= 500 && z >= -135 && z <= 125) return false;
    // Also keep clear of NE 140th Ct corridor (x in [-65, 65], z in [0, 260])
    if (Math.abs(x) < 65 && z >= -10 && z <= 260) return false;
    return true;
  }

  // Helper to merge an array of BufferGeometries with vertex colors
  function mergeColoredGeometries(geoms) {
    let totalVerts = 0;
    let totalIdx = 0;
    for (let i = 0; i < geoms.length; i++) {
      const g = geoms[i];
      totalVerts += g.attributes.position.count;
      totalIdx += g.index ? g.index.count : g.attributes.position.count;
    }

    const pos = new Float32Array(totalVerts * 3);
    const norm = new Float32Array(totalVerts * 3);
    const col = new Float32Array(totalVerts * 3);
    const idx = new Uint32Array(totalIdx);

    let vOff = 0;
    let iOff = 0;

    for (let i = 0; i < geoms.length; i++) {
      const g = geoms[i];
      const pArr = g.attributes.position.array;
      const nArr = g.attributes.normal.array;
      const cArr = g.attributes.color.array;
      const vCount = g.attributes.position.count;

      pos.set(pArr, vOff * 3);
      norm.set(nArr, vOff * 3);
      col.set(cArr, vOff * 3);

      if (g.index) {
        const iArr = g.index.array;
        for (let k = 0; k < iArr.length; k++) {
          idx[iOff++] = iArr[k] + vOff;
        }
      } else {
        for (let k = 0; k < vCount; k++) {
          idx[iOff++] = vOff + k;
        }
      }
      vOff += vCount;
    }

    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    return out;
  }

  function paintGeometry(geom, rBot, gBot, bBot, rTop, gTop, bTop) {
    geom.computeBoundingBox();
    const minY = geom.boundingBox.min.y;
    const maxY = Math.max(minY + 0.01, geom.boundingBox.max.y);
    const pArr = geom.attributes.position.array;
    const count = geom.attributes.position.count;
    const cArr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const y = pArr[i * 3 + 1];
      const t = Math.max(0, Math.min(1, (y - minY) / (maxY - minY)));
      cArr[i * 3 + 0] = rBot + (rTop - rBot) * t;
      cArr[i * 3 + 1] = gBot + (gTop - gBot) * t;
      cArr[i * 3 + 2] = bBot + (bTop - bBot) * t;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(cArr, 3));
    return geom;
  }

  // 5A. Low-poly Slash Pine Geometry (~68 tris: 6-sided trunk + 4 ragged canopy tiers)
  function createSlashPineGeometry() {
    const parts = [];
    // Trunk (0 to 0.78 height)
    const trunk = new THREE.CylinderGeometry(0.05, 0.14, 0.78, 6, 1, true);
    trunk.translate(0, 0.39, 0);
    paintGeometry(trunk, 0.26, 0.19, 0.14, 0.36, 0.25, 0.18);
    parts.push(trunk);

    // 4 irregular high-crown slash pine tiers
    const tiers = [
      { y: 0.56, rBot: 0.28, rTop: 0.04, h: 0.20, ox: 0.02, oz: -0.01 },
      { y: 0.68, rBot: 0.32, rTop: 0.05, h: 0.22, ox: -0.02, oz: 0.02 },
      { y: 0.80, rBot: 0.26, rTop: 0.04, h: 0.20, ox: 0.01, oz: 0.01 },
      { y: 0.91, rBot: 0.18, rTop: 0.01, h: 0.16, ox: 0.0, oz: 0.0 }
    ];
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      const cone = new THREE.CylinderGeometry(t.rTop, t.rBot, t.h, 7, 1, false);
      // Perturb vertices slightly so silhouette isn't toy-like
      const p = cone.attributes.position;
      for (let v = 0; v < p.count; v++) {
        const vx = p.getX(v);
        const vy = p.getY(v);
        const vz = p.getZ(v);
        const ang = Math.atan2(vz, vx);
        const radScale = 1.0 + 0.14 * Math.sin(ang * 3.0 + i * 1.7);
        p.setX(v, vx * radScale + t.ox);
        p.setY(v, vy + t.y + 0.02 * Math.cos(ang * 2.0));
        p.setZ(v, vz * radScale + t.oz);
      }
      cone.computeVertexNormals();
      paintGeometry(cone, 0.16, 0.26, 0.11, 0.28, 0.42, 0.18);
      parts.push(cone);
    }
    return mergeColoredGeometries(parts);
  }

  // 5B. Low-poly Southern Live Oak Geometry (~88 tris: trunk + broad sprawling multi-dome crown)
  function createLiveOakGeometry() {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.10, 0.22, 0.42, 6, 1, true);
    trunk.translate(0, 0.21, 0);
    paintGeometry(trunk, 0.24, 0.20, 0.16, 0.30, 0.25, 0.20);
    parts.push(trunk);

    // 4 overlapping flattened foliage domes for live oak silhouette
    const lobes = [
      { x: 0.0, y: 0.58, z: 0.0, sx: 0.58, sy: 0.36, sz: 0.54 },
      { x: -0.26, y: 0.48, z: 0.14, sx: 0.44, sy: 0.28, sz: 0.42 },
      { x: 0.28, y: 0.50, z: -0.12, sx: 0.46, sy: 0.30, sz: 0.40 },
      { x: 0.05, y: 0.52, z: 0.26, sx: 0.40, sy: 0.26, sz: 0.38 }
    ];
    for (let i = 0; i < lobes.length; i++) {
      const lb = lobes[i];
      const ico = new THREE.IcosahedronGeometry(1.0, 1); // 80 tris total if 1, so use octa/low sphere:
      // Use SphereGeometry(1, 7, 4) = 42 tris each -> 4 lobes = 168 tris
      const dome = new THREE.SphereGeometry(1.0, 6, 4);
      const p = dome.attributes.position;
      for (let v = 0; v < p.count; v++) {
        let vx = p.getX(v);
        let vy = p.getY(v);
        let vz = p.getZ(v);
        if (vy < -0.2) vy *= 0.45; // flatten bottom of oak canopy
        const ripple = 1.0 + 0.12 * Math.sin(vx * 3.0 + vz * 2.5 + i);
        p.setX(v, vx * lb.sx * ripple + lb.x);
        p.setY(v, vy * lb.sy + lb.y);
        p.setZ(v, vz * lb.sz * ripple + lb.z);
      }
      dome.computeVertexNormals();
      paintGeometry(dome, 0.14, 0.22, 0.10, 0.26, 0.38, 0.16);
      parts.push(dome);
    }
    return mergeColoredGeometries(parts);
  }

  // 5C. Low-poly Cabbage Palm (Sabal palmetto) Geometry (~64 tris)
  function createCabbagePalmGeometry() {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.05, 0.08, 0.86, 5, 2, true);
    const tp = trunk.attributes.position;
    for (let v = 0; v < tp.count; v++) {
      const y = tp.getY(v) + 0.43;
      tp.setY(v, y);
      tp.setX(v, tp.getX(v) + 0.04 * Math.sin(y * 3.14));
    }
    trunk.computeVertexNormals();
    paintGeometry(trunk, 0.34, 0.30, 0.25, 0.42, 0.36, 0.30);
    parts.push(trunk);

    // Frond crown head
    const crown = new THREE.SphereGeometry(0.24, 7, 4);
    const cp = crown.attributes.position;
    for (let v = 0; v < cp.count; v++) {
      const vx = cp.getX(v);
      const vy = cp.getY(v);
      const vz = cp.getZ(v);
      const ang = Math.atan2(vz, vx);
      const spike = 1.0 + 0.35 * Math.abs(Math.sin(ang * 4.5));
      cp.setX(v, vx * spike + 0.03);
      cp.setY(v, vy * 0.85 + 0.88 - 0.06 * (spike - 1.0));
      cp.setZ(v, vz * spike);
    }
    crown.computeVertexNormals();
    paintGeometry(crown, 0.18, 0.28, 0.12, 0.32, 0.46, 0.20);
    parts.push(crown);

    return mergeColoredGeometries(parts);
  }

  const treeInstMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.90,
    metalness: 0.0
  });

  const randVeg = ctx.rand(6002);
  const pineList = []; // [x, y, z, rotY, sxz, sy, cr, cg, cb]
  const oakList = [];
  const palmList = [];

  function pushTreeInstance(list, x, z, minH, maxH, aspectXZ) {
    if (!isFarVegAllowed(x, z)) return;
    const y = ctx.groundY(x, z) - 0.15;
    const h = minH + randVeg() * (maxH - minH);
    const sxz = h * aspectXZ * (0.85 + randVeg() * 0.32);
    const rotY = randVeg() * Math.PI * 2;
    const tint = 0.82 + randVeg() * 0.34;
    const warm = (randVeg() - 0.5) * 0.10;
    list.push([x, y, z, rotY, sxz, h, tint + warm, tint, tint - warm * 0.5]);
  }

  // 1) Continuous North Treeline Band (z in [-500, -180], x in [-1000, 800])
  for (let x = -990; x <= 790; x += 9.5) {
    const depth = -210 - randVeg() * 280;
    const jx = x + (randVeg() - 0.5) * 8.0;
    const r = randVeg();
    if (r < 0.62) {
      pushTreeInstance(pineList, jx, depth, 13.0, 22.0, 0.55);
    } else if (r < 0.88) {
      pushTreeInstance(oakList, jx, depth, 10.0, 16.5, 0.85);
    } else {
      pushTreeInstance(palmList, jx, depth, 9.0, 14.5, 0.70);
    }
    // Second dense row near z = -460..-500
    const zBack = -455 - randVeg() * 42;
    const jx2 = x + (randVeg() - 0.5) * 9.0;
    if (randVeg() < 0.70) {
      pushTreeInstance(pineList, jx2, zBack, 15.0, 24.0, 0.58);
    } else {
      pushTreeInstance(oakList, jx2, zBack, 11.0, 18.0, 0.90);
    }
  }

  // 2) Continuous South Treeline Band (z in [190, 500], x in [-1000, 800])
  for (let x = -990; x <= 790; x += 9.5) {
    const depth = 210 + randVeg() * 280;
    const jx = x + (randVeg() - 0.5) * 8.0;
    const r = randVeg();
    if (r < 0.60) {
      pushTreeInstance(pineList, jx, depth, 13.0, 22.0, 0.55);
    } else if (r < 0.88) {
      pushTreeInstance(oakList, jx, depth, 10.0, 16.5, 0.85);
    } else {
      pushTreeInstance(palmList, jx, depth, 9.0, 14.5, 0.70);
    }
    // Back boundary row near z = +455..+498
    const zBack = 455 + randVeg() * 42;
    const jx2 = x + (randVeg() - 0.5) * 9.0;
    if (randVeg() < 0.68) {
      pushTreeInstance(pineList, jx2, zBack, 15.0, 24.0, 0.58);
    } else {
      pushTreeInstance(oakList, jx2, zBack, 11.0, 18.0, 0.90);
    }
  }

  // 3) West Horizon Treeline (x in [-1000, -780], z in [-500, 500])
  //    Strictly respects isFarVegAllowed: leaves > 45 m clear on each side of road centerline
  for (let z = -490; z <= 490; z += 8.5) {
    for (let layer = 0; layer < 2; layer++) {
      const x = -990 + layer * 65 + (randVeg() - 0.5) * 45;
      const jz = z + (randVeg() - 0.5) * 7.0;
      if (randVeg() < 0.68) {
        pushTreeInstance(pineList, x, jz, 14.0, 23.0, 0.56);
      } else {
        pushTreeInstance(oakList, x, jz, 11.0, 17.5, 0.88);
      }
    }
  }

  // 4) East Horizon Treeline (x in [580, 800], z in [-500, 500])
  //    Leaves a natural highway gap right on the pavement, closes surrounding horizon
  for (let z = -490; z <= 490; z += 8.5) {
    if (z > -46 && z < 16) continue; // keep highway pavement & immediate clear zone open at east edge
    for (let layer = 0; layer < 2; layer++) {
      const x = 680 + layer * 60 + (randVeg() - 0.5) * 45;
      const jz = z + (randVeg() - 0.5) * 7.0;
      if (randVeg() < 0.65) {
        pushTreeInstance(pineList, x, jz, 14.0, 23.0, 0.56);
      } else {
        pushTreeInstance(oakList, x, jz, 11.0, 17.5, 0.88);
      }
    }
  }

  // 5) Scattered Florida Pasture Hammocks (clusters of oaks, pines, cabbage palms between 150 m and 440 m from road)
  const hammocks = [
    { cx: -780, cz: -190, r: 55, count: 28 },
    { cx: -520, cz: -185, r: 48, count: 26 },
    { cx: -260, cz: -175, r: 52, count: 30 },
    { cx: -40,  cz: -195, r: 60, count: 34 },
    { cx: 190,  cz: -170, r: 50, count: 28 },
    { cx: 430,  cz: -185, r: 58, count: 32 },
    { cx: 620,  cz: -165, r: 50, count: 26 },

    { cx: -760, cz: 175,  r: 55, count: 28 },
    { cx: -480, cz: 180,  r: 50, count: 28 },
    { cx: -210, cz: 170,  r: 48, count: 26 },
    { cx: 135,  cz: 175,  r: 52, count: 30 },
    { cx: 360,  cz: 185,  r: 58, count: 32 },
    { cx: 580,  cz: 170,  r: 50, count: 26 }
  ];

  for (let hIdx = 0; hIdx < hammocks.length; hIdx++) {
    const hm = hammocks[hIdx];
    for (let i = 0; i < hm.count; i++) {
      const ang = randVeg() * Math.PI * 2;
      const dist = Math.sqrt(randVeg()) * hm.r;
      const tx = hm.cx + Math.cos(ang) * dist;
      const tz = hm.cz + Math.sin(ang) * dist;
      const pick = randVeg();
      if (pick < 0.45) {
        pushTreeInstance(oakList, tx, tz, 9.5, 15.5, 0.88);
      } else if (pick < 0.82) {
        pushTreeInstance(pineList, tx, tz, 12.5, 20.5, 0.54);
      } else {
        pushTreeInstance(palmList, tx, tz, 8.5, 13.5, 0.68);
      }
    }
  }

  function buildInstancedTrees(name, geom, list) {
    if (list.length === 0) return;
    const mesh = new THREE.InstancedMesh(geom, treeInstMat, list.length);
    mesh.name = name;
    mesh.userData.citation = citeNoObs;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    for (let i = 0; i < list.length; i++) {
      const [x, y, z, rotY, sxz, sy, cr, cg, cb] = list[i];
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, rotY, 0);
      dummy.scale.set(sxz, sy, sxz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      tmpColor.setRGB(cr, cg, cb);
      mesh.setColorAt(i, tmpColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    farVegGroup.add(mesh);
  }

  buildInstancedTrees('far_slash_pines', createSlashPineGeometry(), pineList);
  buildInstancedTrees('far_live_oaks', createLiveOakGeometry(), oakList);
  buildInstancedTrees('far_cabbage_palms', createCabbagePalmGeometry(), palmList);

  // ---------------------------------------------------------------------------
  // 6. Horizon Treeline Silhouette Cards along x = -1000 / 800 and z = +-500
  //    (Closes any low sky gap behind the 3D tree ring)
  // ---------------------------------------------------------------------------
  function makeTreelineMaterial() {
    const canvas = ctx.makeCanvas ? ctx.makeCanvas(512, 128) : null;
    if (!canvas) {
      return new THREE.MeshStandardMaterial({
        color: 0x2a3d1e,
        roughness: 0.95,
        metalness: 0.0,
        side: THREE.DoubleSide
      });
    }
    const c = canvas.getContext('2d');
    c.clearRect(0, 0, 512, 128);

    // Draw layered slash-pine and live-oak horizon silhouette
    const rCard = ctx.rand(6003);
    // Back hazy treeline
    c.fillStyle = '#2d4224';
    c.beginPath();
    c.moveTo(0, 128);
    for (let x = 0; x <= 512; x += 6) {
      const h = 48 + 26 * Math.sin(x * 0.045) + 18 * Math.cos(x * 0.13) + rCard() * 14;
      c.lineTo(x, 128 - Math.min(118, Math.max(24, h)));
    }
    c.lineTo(512, 128);
    c.closePath();
    c.fill();

    // Foreground darker pine/oak crowns
    c.fillStyle = '#233619';
    c.beginPath();
    c.moveTo(0, 128);
    for (let x = 0; x <= 512; x += 4) {
      const pineSpike = Math.pow(Math.abs(Math.sin(x * 0.19)), 1.6) * 28;
      const oakDome = 36 + 18 * Math.sin(x * 0.035 + 1.2);
      const h = oakDome + pineSpike + rCard() * 8;
      c.lineTo(x, 128 - Math.min(115, Math.max(18, h)));
    }
    c.lineTo(512, 128);
    c.closePath();
    c.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 8;

    return new THREE.MeshStandardMaterial({
      map: tex,
      alphaTest: 0.4,
      transparent: true,
      roughness: 0.92,
      metalness: 0.0,
      side: THREE.DoubleSide
    });
  }

  const cardMat = makeTreelineMaterial();

  function buildTreelineRibbon(pts, height, uvScale) {
    // pts: array of [x, z] along horizon perimeter
    const n = pts.length;
    const positions = new Float32Array(n * 2 * 3);
    const uvs = new Float32Array(n * 2 * 2);
    const indices = [];
    let dist = 0;

    for (let i = 0; i < n; i++) {
      const [x, z] = pts[i];
      if (i > 0) {
        dist += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
      }
      const y0 = ctx.groundY(x, z) - 0.8;
      const y1 = y0 + height;

      positions[i * 6 + 0] = x;
      positions[i * 6 + 1] = y0;
      positions[i * 6 + 2] = z;

      positions[i * 6 + 3] = x;
      positions[i * 6 + 4] = y1;
      positions[i * 6 + 5] = z;

      const u = dist / uvScale;
      uvs[i * 4 + 0] = u;
      uvs[i * 4 + 1] = 0.02;
      uvs[i * 4 + 2] = u;
      uvs[i * 4 + 3] = 0.98;

      if (i < n - 1) {
        const a = i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, c, b, b, c, d);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }

  // North horizon card (z = -495, x from -1000 to +800)
  const northCardPts = [];
  for (let x = -1000; x <= 800; x += 25) northCardPts.push([x, -495]);
  const northCard = new THREE.Mesh(buildTreelineRibbon(northCardPts, 21.0, 140.0), cardMat);
  northCard.name = 'horizon_treeline_card_north';
  northCard.userData.citation = citeNoObs;
  farVegGroup.add(northCard);

  // South horizon card (z = +495, x from -1000 to +800)
  const southCardPts = [];
  for (let x = -1000; x <= 800; x += 25) southCardPts.push([x, 495]);
  const southCard = new THREE.Mesh(buildTreelineRibbon(southCardPts, 21.0, 140.0), cardMat);
  southCard.name = 'horizon_treeline_card_south';
  southCard.userData.citation = citeNoObs;
  farVegGroup.add(southCard);

  // West horizon cards (x = -995, split across the highway corridor so z in [-85, 55] stays completely open)
  const westNorthPts = [];
  for (let z = -495; z <= -90; z += 25) westNorthPts.push([-995, z]);
  const westNorthCard = new THREE.Mesh(buildTreelineRibbon(westNorthPts, 20.0, 120.0), cardMat);
  westNorthCard.name = 'horizon_treeline_card_west_north';
  westNorthCard.userData.citation = citeNoObs;
  farVegGroup.add(westNorthCard);

  const westSouthPts = [];
  for (let z = 60; z <= 495; z += 25) westSouthPts.push([-995, z]);
  const westSouthCard = new THREE.Mesh(buildTreelineRibbon(westSouthPts, 20.0, 120.0), cardMat);
  westSouthCard.name = 'horizon_treeline_card_west_south';
  westSouthCard.userData.citation = citeNoObs;
  farVegGroup.add(westSouthCard);

  // East horizon cards (x = +795, split across the highway corridor z in [-55, 25])
  const eastNorthPts = [];
  for (let z = -495; z <= -60; z += 25) eastNorthPts.push([795, z]);
  const eastNorthCard = new THREE.Mesh(buildTreelineRibbon(eastNorthPts, 20.0, 120.0), cardMat);
  eastNorthCard.name = 'horizon_treeline_card_east_north';
  eastNorthCard.userData.citation = citeNoObs;
  farVegGroup.add(eastNorthCard);

  const eastSouthPts = [];
  for (let z = 30; z <= 495; z += 25) eastSouthPts.push([795, z]);
  const eastSouthCard = new THREE.Mesh(buildTreelineRibbon(eastSouthPts, 20.0, 120.0), cardMat);
  eastSouthCard.name = 'horizon_treeline_card_east_south';
  eastSouthCard.userData.citation = citeNoObs;
  farVegGroup.add(eastSouthCard);

  root.add(farVegGroup);

  return root;
}
