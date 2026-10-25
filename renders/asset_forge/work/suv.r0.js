const _cache = {
  textures: {},
  materials: {},
  geometries: {},
};

function makePRNG(seedStr = 'suv') {
  let h = 2166136261 >>> 0;
  const s = String(seedStr);
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return function () {
    h += h << 13;
    h ^= h >>> 7;
    h += h << 3;
    h ^= h >>> 17;
    h += h << 5;
    return (h >>> 0) / 4294967296;
  };
}

function getTireTextures(THREE) {
  if (_cache.textures.tireTread) return _cache.textures;

  if (typeof document !== 'undefined') {
    // Tread Bump/Roughness Map
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#222222';
    ctx.fillRect(0, 0, 512, 128);

    // Circumferential grooves
    ctx.fillStyle = '#080808';
    [26, 52, 76, 102].forEach((y) => {
      ctx.fillRect(0, y - 4, 512, 8);
    });

    // Tread blocks / sipes
    ctx.fillStyle = '#383838';
    for (let x = 0; x < 512; x += 16) {
      ctx.fillRect(x + 2, 4, 12, 18);
      ctx.fillRect(x + 6, 30, 12, 18);
      ctx.fillRect(x + 2, 56, 12, 16);
      ctx.fillRect(x + 6, 80, 12, 18);
      ctx.fillRect(x + 2, 106, 12, 18);
    }

    const treadTex = new THREE.CanvasTexture(c);
    treadTex.wrapS = THREE.RepeatWrapping;
    treadTex.wrapT = THREE.ClampToEdgeWrapping;
    treadTex.repeat.set(8, 1);
    _cache.textures.tireTread = treadTex;

    // Grille Texture
    const gc = document.createElement('canvas');
    gc.width = 256;
    gc.height = 128;
    const gctx = gc.getContext('2d');
    gctx.fillStyle = '#050507';
    gctx.fillRect(0, 0, 256, 128);
    gctx.strokeStyle = '#30343a';
    gctx.lineWidth = 3;
    const dx = 24;
    const dy = 14;
    for (let y = 0; y < 128 + dy; y += dy) {
      const off = (Math.round(y / dy) % 2) * (dx / 2);
      for (let x = -dx; x < 256 + dx; x += dx) {
        gctx.beginPath();
        gctx.moveTo(x + off, y - dy * 0.45);
        gctx.lineTo(x + off + dx * 0.45, y);
        gctx.lineTo(x + off, y + dy * 0.45);
        gctx.lineTo(x + off - dx * 0.45, y);
        gctx.closePath();
        gctx.stroke();
      }
    }
    const grilleTex = new THREE.CanvasTexture(gc);
    grilleTex.colorSpace = THREE.SRGBColorSpace;
    grilleTex.wrapS = THREE.RepeatWrapping;
    grilleTex.wrapT = THREE.RepeatWrapping;
    _cache.textures.grille = grilleTex;
  } else {
    // Fallback DataTexture for Node environment
    const width = 64, height = 64;
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const v = (i % 8 < 4) ? 25 : 45;
      data[i * 4] = v;
      data[i * 4 + 1] = v;
      data[i * 4 + 2] = v;
      data[i * 4 + 3] = 255;
    }
    const dt = new THREE.DataTexture(data, width, height);
    dt.wrapS = THREE.RepeatWrapping;
    dt.wrapT = THREE.RepeatWrapping;
    dt.needsUpdate = true;
    _cache.textures.tireTread = dt;
    _cache.textures.grille = dt;
  }
  return _cache.textures;
}

function getSharedMaterials(THREE) {
  if (_cache.materials.cladding) return _cache.materials;
  const tex = getTireTextures(THREE);

  _cache.materials.cladding = new THREE.MeshStandardMaterial({
    color: 0x1a1c1e,
    roughness: 0.78,
    metalness: 0.08,
  });

  _cache.materials.darkTrim = new THREE.MeshStandardMaterial({
    color: 0x101214,
    roughness: 0.35,
    metalness: 0.2,
  });

  _cache.materials.chrome = new THREE.MeshStandardMaterial({
    color: 0xe8eef2,
    roughness: 0.12,
    metalness: 0.95,
  });

  _cache.materials.satinSilver = new THREE.MeshStandardMaterial({
    color: 0xb0b6bc,
    roughness: 0.32,
    metalness: 0.75,
  });

  _cache.materials.glass = new THREE.MeshPhysicalMaterial({
    color: 0x0b1319,
    roughness: 0.05,
    metalness: 0.05,
    transparent: true,
    opacity: 0.48,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
  });

  _cache.materials.windshield = new THREE.MeshPhysicalMaterial({
    color: 0x101c24,
    roughness: 0.04,
    metalness: 0.05,
    transparent: true,
    opacity: 0.38,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
  });

  _cache.materials.mirrorGlass = new THREE.MeshStandardMaterial({
    color: 0xd8e4ec,
    roughness: 0.03,
    metalness: 0.98,
  });

  _cache.materials.tire = new THREE.MeshStandardMaterial({
    color: 0x1c1d1f,
    roughness: 0.88,
    metalness: 0.05,
    bumpMap: tex.tireTread,
    bumpScale: 0.008,
  });

  _cache.materials.grille = new THREE.MeshStandardMaterial({
    color: 0x22252a,
    map: tex.grille,
    roughness: 0.45,
    metalness: 0.4,
  });

  _cache.materials.interior = new THREE.MeshStandardMaterial({
    color: 0x17191c,
    roughness: 0.85,
    metalness: 0.05,
  });

  _cache.materials.interiorAccent = new THREE.MeshStandardMaterial({
    color: 0x2c3036,
    roughness: 0.55,
    metalness: 0.2,
  });

  _cache.materials.underbody = new THREE.MeshStandardMaterial({
    color: 0x0c0d0e,
    roughness: 0.92,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });

  _cache.materials.brakeDisc = new THREE.MeshStandardMaterial({
    color: 0x8a9098,
    roughness: 0.35,
    metalness: 0.85,
  });

  _cache.materials.caliper = new THREE.MeshStandardMaterial({
    color: 0x454a50,
    roughness: 0.4,
    metalness: 0.6,
  });

  _cache.materials.plate = new THREE.MeshStandardMaterial({
    color: 0xe6e9ec,
    roughness: 0.4,
    metalness: 0.1,
  });

  _cache.materials.amberReflector = new THREE.MeshStandardMaterial({
    color: 0xff8800,
    roughness: 0.2,
    metalness: 0.3,
    emissive: 0x331500,
    emissiveIntensity: 0.4,
  });

  _cache.materials.redReflector = new THREE.MeshStandardMaterial({
    color: 0xaa0808,
    roughness: 0.25,
    metalness: 0.2,
  });

  return _cache.materials;
}

// Helper to build a symmetric lofted surface from station curves
function buildSymmetricLoft(THREE, stations, segsPerRing) {
  // Each station: { z, pts: [[x0, y0], [x1, y1], ...] } where pts has length (segsPerRing + 1)
  // Full ring goes from bottom-center (x=0, y_bot) -> right side (+x) -> top-center (x=0, y_top) -> left side (-x) -> bottom-center
  const ringCount = stations.length;
  const halfPts = segsPerRing; // pts.length - 1
  const fullRingVerts = halfPts * 2 + 1;

  const positions = [];
  const uvs = [];
  const indices = [];

  for (let r = 0; r < ringCount; r++) {
    const st = stations[r];
    const z = st.z;
    const pts = st.pts; // length = halfPts + 1
    const v = (z + 2.4) / 4.8;

    // Right side: i from 0 to halfPts (bottom center -> right -> top center)
    for (let i = 0; i <= halfPts; i++) {
      const [x, y] = pts[i];
      positions.push(x, y, z);
      uvs.push(i / (halfPts * 2), v);
    }
    // Left side: i from halfPts - 1 down to 0 (top center -> left -> bottom center)
    for (let i = halfPts - 1; i >= 0; i--) {
      const [x, y] = pts[i];
      positions.push(-x, y, z);
      const uIdx = halfPts + (halfPts - i);
      uvs.push(uIdx / (halfPts * 2), v);
    }
  }

  for (let r = 0; r < ringCount - 1; r++) {
    const row0 = r * fullRingVerts;
    const row1 = (r + 1) * fullRingVerts;
    for (let j = 0; j < fullRingVerts - 1; j++) {
      const a = row0 + j;
      const b = row0 + j + 1;
      const c = row1 + j + 1;
      const d = row1 + j;
      indices.push(a, b, c);
      indices.push(a, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Evaluate wheel-arch clearance height & flare at longitudinal coordinate z
function getArchProfile(z) {
  const fz = -1.47;
  const rz = 1.38;
  const rArch = 0.435;
  const rOuter = 0.485;

  let flare = 0;
  let archY = 0;

  for (const az of [fz, rz]) {
    const dz = z - az;
    const dist = Math.abs(dz);
    if (dist < rOuter) {
      const t = Math.max(0, 1 - (dist / rOuter) ** 2);
      flare = Math.max(flare, 0.032 * Math.sqrt(t));
    }
    if (dist < rArch) {
      const h = 0.37 + Math.sqrt(Math.max(0, rArch * rArch - dz * dz));
      archY = Math.max(archY, h);
    }
  }
  return { flare, archY };
}

// Create main SUV painted body shell + lower cladding shell
function getBodyGeometries(THREE) {
  if (_cache.geometries.bodyPaint) return _cache.geometries;

  // Longitudinal profile keyframes:
  // [z, yBottom, yCladTop, yBelt, yHoodOrRoof, wBot, wMid, wBelt, wTop, hoodCamber]
  const zFrames = [
    [-2.40, 0.36, 0.44, 0.72, 0.78, 0.56, 0.68, 0.66, 0.50, 0.01],
    [-2.36, 0.28, 0.42, 0.85, 0.91, 0.72, 0.81, 0.79, 0.66, 0.02],
    [-2.26, 0.24, 0.40, 0.92, 0.96, 0.82, 0.89, 0.87, 0.74, 0.025],
    [-2.05, 0.23, 0.39, 0.96, 1.00, 0.86, 0.93, 0.91, 0.79, 0.03],
    [-1.78, 0.22, 0.38, 1.00, 1.035, 0.88, 0.945, 0.925, 0.81, 0.03],
    [-1.47, 0.22, 0.38, 1.03, 1.065, 0.88, 0.945, 0.93, 0.82, 0.03], // Front Axle
    [-1.15, 0.22, 0.38, 1.06, 1.09, 0.88, 0.945, 0.935, 0.83, 0.025],
    [-0.95, 0.21, 0.36, 1.08, 1.11, 0.88, 0.95, 0.94, 0.84, 0.02],   // Cowl / Base of windshield
    [-0.65, 0.21, 0.35, 1.09, 1.38, 0.88, 0.955, 0.94, 0.77, 0.02],  // Mid-windshield
    [-0.32, 0.21, 0.35, 1.10, 1.64, 0.88, 0.96, 0.945, 0.70, 0.035], // Top of windshield / Roof header
    [0.05,  0.21, 0.35, 1.11, 1.675, 0.88, 0.96, 0.945, 0.70, 0.04], // B-pillar
    [0.55,  0.21, 0.35, 1.12, 1.68, 0.88, 0.96, 0.945, 0.695, 0.04], // Rear door
    [1.00,  0.21, 0.36, 1.135, 1.665, 0.88, 0.955, 0.94, 0.685, 0.035], // C-pillar start
    [1.38,  0.22, 0.38, 1.15, 1.645, 0.88, 0.945, 0.93, 0.67, 0.03], // Rear Axle
    [1.72,  0.23, 0.39, 1.165, 1.62, 0.87, 0.935, 0.915, 0.65, 0.025], // D-pillar top / spoiler base
    [1.98,  0.25, 0.42, 1.175, 1.48, 0.85, 0.92, 0.895, 0.66, 0.02],  // Rear glass slope
    [2.22,  0.27, 0.45, 1.17, 1.19, 0.82, 0.89, 0.865, 0.74, 0.02],   // Tailgate shoulder
    [2.34,  0.30, 0.48, 1.05, 1.14, 0.76, 0.84, 0.81, 0.70, 0.015],   // Rear bumper step
    [2.40,  0.35, 0.52, 0.82, 0.92, 0.62, 0.72, 0.68, 0.56, 0.01],    // Rear bumper tip
  ];

  // Interpolate smoothly along dense Z steps so wheel arches are round
  function sampleFrame(z) {
    if (z <= zFrames[0][0]) return zFrames[0].slice(1);
    if (z >= zFrames[zFrames.length - 1][0]) return zFrames[zFrames.length - 1].slice(1);
    for (let i = 0; i < zFrames.length - 1; i++) {
      const z0 = zFrames[i][0];
      const z1 = zFrames[i + 1][0];
      if (z >= z0 && z <= z1) {
        const t = (z - z0) / (z1 - z0);
        // Smoothstep blend only near endpoints, linear otherwise
        const out = [];
        for (let k = 1; k < zFrames[i].length; k++) {
          out.push(zFrames[i][k] * (1 - t) + zFrames[i + 1][k] * t);
        }
        return out;
      }
    }
    return zFrames[0].slice(1);
  }

  // Generate dense Z list (84 stations)
  const zList = [];
  const N = 84;
  for (let i = 0; i <= N; i++) {
    const z = -2.40 + (4.80 * i) / N;
    zList.push(z);
  }

  // Build lower body / beltline-down painted sheetmetal + hood + tailgate
  // Plus greenhouse belt-to-roof structure (painted pillars / roof / recessed dark window tub)
  const paintStations = [];

  for (const z of zList) {
    const [yBot, yClad, yBelt, yTop, wBot, wMid, wBelt, wTop, camber] = sampleFrame(z);
    const { flare, archY } = getArchProfile(z);

    const effBotY = Math.max(yBot, archY);
    const effCladY = Math.max(yClad, archY + 0.055);
    const effWMid = Math.min(0.975, wMid + flare);
    const effWBelt = Math.min(0.965, wBelt + flare * 0.45);
    const effWBot = Math.min(0.972, wBot + flare * 0.95);

    // 12 points from bottom-center (0) around right side to top-center (11)
    const pts = [
      [0.0, Math.min(effBotY, 0.36)],
      [effWBot * 0.55, Math.min(effBotY, 0.36)],
      [effWBot * 0.94, effBotY + 0.01],
      [effWMid * 0.99, effCladY],
      [effWMid, effCladY + (yBelt - effCladY) * 0.38],
      [effWMid * 0.995, effCladY + (yBelt - effCladY) * 0.75],
      [effWBelt, yBelt - 0.02],
      [effWBelt * 0.97, yBelt + 0.015],
      [wTop + (effWBelt - wTop) * 0.55, yBelt + (yTop - yBelt) * 0.45],
      [wTop * 0.98, yTop - 0.015],
      [wTop * 0.55, yTop + camber * 0.75],
      [0.0, yTop + camber],
    ];
    paintStations.push({ z, pts });
  }

  _cache.geometries.bodyPaint = buildSymmetricLoft(THREE, paintStations, 11);

  // Build Black Plastic Lower Cladding & Wheel Arch Flares (slightly proud of lower body)
  const cladStations = [];
  for (const z of zList) {
    const [yBot, yClad, , , wBot, wMid] = sampleFrame(z);
    const { flare, archY } = getArchProfile(z);

    const effBotY = Math.max(yBot - 0.005, archY - 0.005);
    const effCladY = Math.max(yClad + 0.01, archY + 0.065);
    const effWBot = Math.min(0.975, wBot + flare + 0.008);
    const effWMid = Math.min(0.975, wMid + flare + 0.009);

    const pts = [
      [effWBot * 0.82, Math.max(0.21, effBotY - 0.01)],
      [effWBot * 0.97, effBotY],
      [effWMid, (effBotY + effCladY) * 0.5],
      [effWMid * 0.998, effCladY],
      [effWMid * 0.96, effCladY + 0.005],
    ];
    cladStations.push({ z, pts });
  }
  _cache.geometries.cladding = buildSymmetricLoft(THREE, cladStations, 4);

  return _cache.geometries;
}

function buildWheel(THREE, isLeft) {
  const mats = getSharedMaterials(THREE);
  const wheelGroup = new THREE.Group();

  // Tire Dimensions: 235/60R18 -> Outer Radius = 0.37m, Rim Radius = 0.232m, Width = 0.235m
  const rOuter = 0.37;
  const rRim = 0.232;
  const halfW = 0.235 / 2;

  if (!_cache.geometries.tireLathe) {
    // Profile in XY plane for LatheGeometry (revolved around Y axis, then rotated so Y -> X)
    const pts = [
      new THREE.Vector2(rRim, -halfW * 0.86),
      new THREE.Vector2(rRim + 0.03, -halfW * 0.96),
      new THREE.Vector2(rRim + 0.08, -halfW),
      new THREE.Vector2(rOuter - 0.025, -halfW * 0.95),
      new THREE.Vector2(rOuter - 0.005, -halfW * 0.82),
      new THREE.Vector2(rOuter, -halfW * 0.55),
      new THREE.Vector2(rOuter, halfW * 0.55),
      new THREE.Vector2(rOuter - 0.005, halfW * 0.82),
      new THREE.Vector2(rOuter - 0.025, halfW * 0.95),
      new THREE.Vector2(rRim + 0.08, halfW),
      new THREE.Vector2(rRim + 0.03, halfW * 0.96),
      new THREE.Vector2(rRim, halfW * 0.86),
    ];
    const geo = new THREE.LatheGeometry(pts, 40);
    geo.rotateZ(Math.PI / 2);
    _cache.geometries.tireLathe = geo;

    // Outer Rim Barrel & Lip
    const rimPts = [
      new THREE.Vector2(rRim - 0.018, -halfW * 0.82),
      new THREE.Vector2(rRim + 0.004, -halfW * 0.86),
      new THREE.Vector2(rRim + 0.004, -halfW * 0.74),
      new THREE.Vector2(rRim - 0.015, -halfW * 0.65),
      new THREE.Vector2(rRim - 0.02, halfW * 0.65),
      new THREE.Vector2(rRim + 0.004, halfW * 0.74),
      new THREE.Vector2(rRim + 0.004, halfW * 0.86),
      new THREE.Vector2(rRim - 0.018, halfW * 0.82),
    ];
    const rimGeo = new THREE.LatheGeometry(rimPts, 36);
    rimGeo.rotateZ(Math.PI / 2);
    _cache.geometries.rimBarrel = rimGeo;

    // Inner dark wheel well drum
    const drumGeo = new THREE.CylinderGeometry(rRim - 0.02, rRim - 0.02, halfW * 1.5, 32);
    drumGeo.rotateZ(Math.PI / 2);
    _cache.geometries.rimDrum = drumGeo;

    // Center hub & lug recess
    const hubGeo = new THREE.CylinderGeometry(0.068, 0.075, 0.04, 24);
    hubGeo.rotateZ(Math.PI / 2);
    _cache.geometries.wheelHub = hubGeo;

    const capGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.044, 20);
    capGeo.rotateZ(Math.PI / 2);
    _cache.geometries.centerCap = capGeo;

    // Twin-spoke geometry
    const spokeShape = new THREE.Shape();
    spokeShape.moveTo(-0.012, 0.055);
    spokeShape.lineTo(0.012, 0.055);
    spokeShape.lineTo(0.008, rRim - 0.008);
    spokeShape.lineTo(-0.008, rRim - 0.008);
    spokeShape.closePath();

    const spokeGeo = new THREE.ExtrudeGeometry(spokeShape, {
      depth: 0.016,
      bevelEnabled: true,
      bevelThickness: 0.003,
      bevelSize: 0.003,
      bevelSegments: 2,
    });
    spokeGeo.rotateY(Math.PI / 2);
    _cache.geometries.spoke = spokeGeo;

    // Brake Rotor
    const rotorGeo = new THREE.CylinderGeometry(0.165, 0.165, 0.024, 32);
    rotorGeo.rotateZ(Math.PI / 2);
    _cache.geometries.brakeRotor = rotorGeo;

    // Brake Caliper
    const calGeo = new THREE.BoxGeometry(0.055, 0.11, 0.075);
    _cache.geometries.caliper = calGeo;

    const lugGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.02, 8);
    lugGeo.rotateZ(Math.PI / 2);
    _cache.geometries.lug = lugGeo;
  }

  const sign = isLeft ? -1 : 1;

  const tireMesh = new THREE.Mesh(_cache.geometries.tireLathe, mats.tire);
  tireMesh.castShadow = true;
  tireMesh.receiveShadow = true;
  wheelGroup.add(tireMesh);

  const rimMesh = new THREE.Mesh(_cache.geometries.rimBarrel, mats.satinSilver);
  rimMesh.castShadow = true;
  rimMesh.receiveShadow = true;
  wheelGroup.add(rimMesh);

  const drumMesh = new THREE.Mesh(_cache.geometries.rimDrum, mats.darkTrim);
  wheelGroup.add(drumMesh);

  const hubMesh = new THREE.Mesh(_cache.geometries.wheelHub, mats.satinSilver);
  hubMesh.position.x = sign * (halfW * 0.62);
  wheelGroup.add(hubMesh);

  const capMesh = new THREE.Mesh(_cache.geometries.centerCap, mats.darkTrim);
  capMesh.position.x = sign * (halfW * 0.63);
  wheelGroup.add(capMesh);

  // 5 Twin-Spokes + 5 Lug Nuts
  const numSpokes = 5;
  for (let i = 0; i < numSpokes; i++) {
    const baseAngle = (i * Math.PI * 2) / numSpokes;
    for (const offsetAngle of [-0.14, 0.14]) {
      const sp = new THREE.Mesh(_cache.geometries.spoke, mats.satinSilver);
      sp.position.x = sign * (halfW * 0.68 - 0.008);
      sp.rotation.x = baseAngle + offsetAngle;
      sp.castShadow = true;
      sp.receiveShadow = true;
      wheelGroup.add(sp);
    }

    const lug = new THREE.Mesh(_cache.geometries.lug, mats.chrome);
    const rLug = 0.048;
    lug.position.set(
      sign * (halfW * 0.72),
      Math.cos(baseAngle) * rLug,
      Math.sin(baseAngle) * rLug
    );
    wheelGroup.add(lug);
  }

  // Brake Disc & Caliper
  const rotor = new THREE.Mesh(_cache.geometries.brakeRotor, mats.brakeDisc);
  rotor.position.x = sign * (halfW * 0.25);
  wheelGroup.add(rotor);

  const caliper = new THREE.Mesh(_cache.geometries.caliper, mats.caliper);
  caliper.position.set(sign * (halfW * 0.32), 0.03, -0.115);
  wheelGroup.add(caliper);

  return wheelGroup;
}

function buildSideMirror(THREE, paintMat, mats, isLeft) {
  const sign = isLeft ? -1 : 1;
  const g = new THREE.Group();
  g.name = isLeft ? 'mirror_L' : 'mirror_R';

  // Door-mounted pedestal stalk
  const stalkGeo = new THREE.BoxGeometry(0.08, 0.045, 0.07);
  const stalk = new THREE.Mesh(stalkGeo, mats.darkTrim);
  stalk.position.set(sign * 0.03, -0.02, 0.01);
  stalk.rotation.z = sign * 0.28;
  stalk.castShadow = true;
  stalk.receiveShadow = true;
  g.add(stalk);

  // Sculpted mirror housing cap
  const capShape = new THREE.Shape();
  capShape.moveTo(0, -0.055);
  capShape.quadraticCurveTo(0.125, -0.055, 0.135, 0.0);
  capShape.quadraticCurveTo(0.13, 0.058, 0.015, 0.058);
  capShape.quadraticCurveTo(-0.01, 0.058, -0.01, 0.0);
  capShape.quadraticCurveTo(-0.01, -0.055, 0, -0.055);

  const capGeo = new THREE.ExtrudeGeometry(capShape, {
    depth: 0.075,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.014,
    bevelSegments: 3,
  });
  if (isLeft) {
    capGeo.scale(-1, 1, 1);
    capGeo.computeVertexNormals();
  }

  const cap = new THREE.Mesh(capGeo, paintMat);
  cap.position.set(sign * 0.02, 0.015, -0.045);
  cap.rotation.y = sign * -0.18;
  cap.castShadow = true;
  cap.receiveShadow = true;
  g.add(cap);

  // Reflective mirror glass face (facing +Z rearwards)
  const glassShape = new THREE.Shape();
  glassShape.moveTo(0.005, -0.046);
  glassShape.quadraticCurveTo(0.115, -0.046, 0.122, 0.0);
  glassShape.quadraticCurveTo(0.118, 0.048, 0.015, 0.048);
  glassShape.lineTo(0.005, -0.046);

  const glassGeo = new THREE.ShapeGeometry(glassShape);
  if (isLeft) {
    glassGeo.scale(-1, 1, 1);
    glassGeo.computeVertexNormals();
  }
  const mirrorPlane = new THREE.Mesh(glassGeo, mats.mirrorGlass);
  mirrorPlane.position.set(sign * 0.022, 0.015, 0.046);
  mirrorPlane.rotation.y = sign * -0.18;
  g.add(mirrorPlane);

  // LED turn signal strip on mirror housing
  const blinkerGeo = new THREE.BoxGeometry(0.09, 0.008, 0.012);
  const blinker = new THREE.Mesh(blinkerGeo, mats.amberReflector);
  blinker.position.set(sign * 0.085, 0.015, -0.048);
  blinker.rotation.y = sign * -0.18;
  g.add(blinker);

  return g;
}

function buildInterior(THREE, mats) {
  const intGroup = new THREE.Group();
  intGroup.name = 'interior';

  // Cabin floor & dark inner tub
  const tubGeo = new THREE.BoxGeometry(1.56, 0.65, 2.75);
  const tub = new THREE.Mesh(tubGeo, mats.interior);
  tub.position.set(0, 0.68, 0.35);
  intGroup.add(tub);

  // Dashboard
  const dashGeo = new THREE.BoxGeometry(1.54, 0.36, 0.52);
  const dash = new THREE.Mesh(dashGeo, mats.interior);
  dash.position.set(0, 0.95, -0.68);
  dash.castShadow = true;
  intGroup.add(dash);

  // Instrument Binnacle (Left-hand drive: x = -0.42)
  const clusterGeo = new THREE.CylinderGeometry(0.13, 0.15, 0.26, 16, 1, false, 0, Math.PI);
  clusterGeo.rotateX(Math.PI / 2);
  const cluster = new THREE.Mesh(clusterGeo, mats.interiorAccent);
  cluster.position.set(-0.42, 1.11, -0.58);
  intGroup.add(cluster);

  // Infotainment Center Screen
  const screenGeo = new THREE.BoxGeometry(0.28, 0.16, 0.03);
  const screen = new THREE.Mesh(screenGeo, mats.darkTrim);
  screen.position.set(0.0, 1.15, -0.52);
  screen.rotation.x = -0.15;
  intGroup.add(screen);

  // Steering Column & Wheel (Left side: x = -0.42)
  const colGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.28, 12);
  colGeo.rotateX(Math.PI / 2 - 0.38);
  const col = new THREE.Mesh(colGeo, mats.interior);
  col.position.set(-0.42, 1.04, -0.42);
  intGroup.add(col);

  const swGroup = new THREE.Group();
  swGroup.position.set(-0.42, 1.09, -0.30);
  swGroup.rotation.x = -0.38;

  const rimGeo = new THREE.TorusGeometry(0.175, 0.02, 12, 28);
  const swRim = new THREE.Mesh(rimGeo, mats.darkTrim);
  swGroup.add(swRim);

  const hubGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.035, 16);
  hubGeo.rotateX(Math.PI / 2);
  const swHub = new THREE.Mesh(hubGeo, mats.interiorAccent);
  swGroup.add(swHub);

  for (const ang of [-0.3, Math.PI + 0.3, -Math.PI / 2]) {
    const spGeo = new THREE.BoxGeometry(0.15, 0.025, 0.02);
    const sp = new THREE.Mesh(spGeo, mats.satinSilver);
    sp.position.set(Math.cos(ang) * 0.08, Math.sin(ang) * 0.08, 0);
    sp.rotation.z = ang;
    swGroup.add(sp);
  }
  intGroup.add(swGroup);

  // Center Console
  const consoleGeo = new THREE.BoxGeometry(0.26, 0.34, 0.95);
  const centerConsole = new THREE.Mesh(consoleGeo, mats.interiorAccent);
  centerConsole.position.set(0, 0.78, -0.15);
  intGroup.add(centerConsole);

  // Seats (2 Front Bucket Seats + 2 Rear Seats)
  const seatPositions = [
    [-0.42, -0.06, 1.0],
    [0.42, -0.06, 1.0],
    [-0.44, 0.82, 0.94],
    [0.44, 0.82, 0.94],
  ];

  const cushionGeo = new THREE.BoxGeometry(0.48, 0.14, 0.48);
  const backrestGeo = new THREE.BoxGeometry(0.46, 0.56, 0.12);
  const headrestGeo = new THREE.BoxGeometry(0.22, 0.18, 0.09);

  for (const [sx, sz, scale] of seatPositions) {
    const sGroup = new THREE.Group();
    sGroup.position.set(sx, 0.72, sz);
    sGroup.scale.setScalar(scale);

    const cushion = new THREE.Mesh(cushionGeo, mats.interior);
    cushion.position.set(0, 0, -0.12);
    sGroup.add(cushion);

    const backrest = new THREE.Mesh(backrestGeo, mats.interior);
    backrest.position.set(0, 0.32, 0.08);
    backrest.rotation.x = 0.22;
    backrest.castShadow = true;
    sGroup.add(backrest);

    const headrest = new THREE.Mesh(headrestGeo, mats.interiorAccent);
    headrest.position.set(0, 0.68, 0.14);
    headrest.rotation.x = 0.15;
    headrest.castShadow = true;
    sGroup.add(headrest);

    intGroup.add(sGroup);
  }

  // Interior Rearview Mirror
  const rvmStalk = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.02), mats.darkTrim);
  rvmStalk.position.set(0, 1.54, -0.45);
  intGroup.add(rvmStalk);

  const rvmBody = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.055, 0.03), mats.darkTrim);
  rvmBody.position.set(0, 1.50, -0.44);
  intGroup.add(rvmBody);

  return intGroup;
}

function buildGreenhouseAndTrim(THREE, paintMat, mats) {
  const ghGroup = new THREE.Group();

  // Front Windshield (curved quad mesh from z=-0.94, y=1.10 to z=-0.32, y=1.62)
  const wsGeo = new THREE.BufferGeometry();
  const wsCols = 16;
  const wsRows = 8;
  const wsVerts = [];
  const wsIndices = [];

  for (let r = 0; r <= wsRows; r++) {
    const v = r / wsRows;
    const zBase = -0.94 + v * (-0.32 - -0.94);
    const yBase = 1.105 + v * (1.625 - 1.105) + Math.sin(v * Math.PI) * 0.025;
    const halfW = 0.77 - v * (0.77 - 0.65);

    for (let c = 0; c <= wsCols; c++) {
      const u = (c / wsCols) * 2 - 1; // -1 to +1
      const x = u * halfW;
      const archZ = (1 - u * u) * -0.075;
      const archY = (1 - u * u) * 0.018;
      wsVerts.push(x, yBase + archY, zBase + archZ);
    }
  }

  for (let r = 0; r < wsRows; r++) {
    for (let c = 0; c < wsCols; c++) {
      const a = r * (wsCols + 1) + c;
      const b = a + 1;
      const d = (r + 1) * (wsCols + 1) + c;
      const e = d + 1;
      wsIndices.push(a, b, e, a, e, d);
    }
  }
  wsGeo.setAttribute('position', new THREE.Float32BufferAttribute(wsVerts, 3));
  wsGeo.setIndex(wsIndices);
  wsGeo.computeVertexNormals();

  const windshield = new THREE.Mesh(wsGeo, mats.windshield);
  windshield.castShadow = true;
  windshield.receiveShadow = true;
  ghGroup.add(windshield);

  // Rear Liftgate Window (from z=1.74, y=1.60 to z=2.18, y=1.19)
  const rwGeo = new THREE.BufferGeometry();
  const rwVerts = [];
  const rwIndices = [];
  for (let r = 0; r <= wsRows; r++) {
    const v = r / wsRows;
    const zBase = 1.74 + v * (2.19 - 1.74);
    const yBase = 1.60 - v * (1.60 - 1.195) + Math.sin(v * Math.PI) * 0.018;
    const halfW = 0.61 + v * (0.69 - 0.61);

    for (let c = 0; c <= wsCols; c++) {
      const u = (c / wsCols) * 2 - 1;
      const x = u * halfW;
      const archZ = (1 - u * u) * 0.055;
      const archY = (1 - u * u) * 0.012;
      rwVerts.push(x, yBase + archY, zBase + archZ);
    }
  }
  for (let r = 0; r < wsRows; r++) {
    for (let c = 0; c < wsCols; c++) {
      const a = r * (wsCols + 1) + c;
      const b = a + 1;
      const d = (r + 1) * (wsCols + 1) + c;
      const e = d + 1;
      rwIndices.push(a, e, b, a, d, e);
    }
  }
  rwGeo.setAttribute('position', new THREE.Float32BufferAttribute(rwVerts, 3));
  rwGeo.setIndex(rwIndices);
  rwGeo.computeVertexNormals();

  const rearGlass = new THREE.Mesh(rwGeo, mats.glass);
  rearGlass.castShadow = true;
  rearGlass.receiveShadow = true;
  ghGroup.add(rearGlass);

  // Side Windows (Front Door, Rear Door, Rear Quarter Window) + Pillars on both sides
  // Evaluating exact side greenhouse surface:
  // Beltline runs from (z=-0.88, y=1.10, x=0.90) to (z=1.75, y=1.18, x=0.87)
  // Roof rail runs from (z=-0.32, y=1.61, x=0.69) to (z=1.68, y=1.59, x=0.65)
  function buildSideWindowPanel(zBot0, zBot1, zTop0, zTop1, yBot0, yBot1, yTop0, yTop1, xInset, isLeft, mat) {
    const sign = isLeft ? -1 : 1;
    const g = new THREE.BufferGeometry();
    const rows = 6;
    const cols = 10;
    const pos = [];
    const idx = [];

    for (let r = 0; r <= rows; r++) {
      const v = r / rows;
      const z0 = zBot0 + v * (zTop0 - zBot0);
      const z1 = zBot1 + v * (zTop1 - zBot1);
      const y0 = yBot0 + v * (yTop0 - yBot0);
      const y1 = yBot1 + v * (yTop1 - yBot1);

      for (let c = 0; c <= cols; c++) {
        const u = c / cols;
        const z = z0 + u * (z1 - z0);
        const y = y0 + u * (y1 - y0);

        // Width tapers along z and tumbles home along v
        const wBeltAtZ = 0.915 - Math.max(0, (z - 0.8) * 0.035);
        const wTopAtZ = 0.695 - Math.max(0, (z - 0.6) * 0.045);
        const bulge = Math.sin(v * Math.PI) * 0.018;
        const xMag = wBeltAtZ * (1 - v) + wTopAtZ * v + bulge + xInset;
        pos.push(sign * xMag, y, z);
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = r * (cols + 1) + c;
        const b = a + 1;
        const d = (r + 1) * (cols + 1) + c;
        const e = d + 1;
        if (isLeft) {
          idx.push(a, b, e, a, e, d);
        } else {
          idx.push(a, e, b, a, d, e);
        }
      }
    }

    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  for (const isLeft of [true, false]) {
    // Front door window
    ghGroup.add(
      buildSideWindowPanel(-0.84, 0.06, -0.32, 0.08, 1.11, 1.12, 1.59, 1.61, 0.004, isLeft, mats.glass)
    );
    // B-pillar gloss black trim
    ghGroup.add(
      buildSideWindowPanel(0.06, 0.18, 0.08, 0.20, 1.12, 1.125, 1.61, 1.61, 0.008, isLeft, mats.darkTrim)
    );
    // Rear door window
    ghGroup.add(
      buildSideWindowPanel(0.18, 1.02, 0.20, 0.98, 1.125, 1.145, 1.61, 1.60, 0.004, isLeft, mats.glass)
    );
    // C-pillar divider
    ghGroup.add(
      buildSideWindowPanel(1.02, 1.10, 0.98, 1.06, 1.145, 1.15, 1.60, 1.595, 0.008, isLeft, mats.darkTrim)
    );
    // Rear quarter window
    ghGroup.add(
      buildSideWindowPanel(1.10, 1.58, 1.06, 1.48, 1.15, 1.175, 1.595, 1.58, 0.004, isLeft, mats.glass)
    );
    // D-pillar body-painted panel
    ghGroup.add(
      buildSideWindowPanel(1.58, 1.92, 1.48, 1.76, 1.17, 1.19, 1.58, 1.59, 0.010, isLeft, paintMat)
    );
    // A-pillar body-painted outer frame
    ghGroup.add(
      buildSideWindowPanel(-0.94, -0.84, -0.36, -0.30, 1.10, 1.11, 1.61, 1.60, 0.010, isLeft, paintMat)
    );
    // Chrome beltline molding strip
    ghGroup.add(
      buildSideWindowPanel(-0.88, 1.62, -0.86, 1.60, 1.095, 1.165, 1.112, 1.182, 0.013, isLeft, mats.chrome)
    );
  }

  // Rear Roof Spoiler (overhanging top of rear liftgate glass at z = 1.68..1.92, y = 1.63..1.66)
  const spoilerShape = new THREE.Shape();
  spoilerShape.moveTo(1.64, 1.64);
  spoilerShape.lineTo(1.93, 1.63);
  spoilerShape.lineTo(1.91, 1.595);
  spoilerShape.lineTo(1.66, 1.60);
  spoilerShape.closePath();

  const spoilerGeo = new THREE.ExtrudeGeometry(spoilerShape, {
    depth: 1.26,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.012,
    bevelSegments: 2,
  });
  spoilerGeo.rotateY(-Math.PI / 2);
  spoilerGeo.translate(0.63, 0, 0);

  const spoiler = new THREE.Mesh(spoilerGeo, paintMat);
  spoiler.castShadow = true;
  spoiler.receiveShadow = true;
  ghGroup.add(spoiler);

  // High-Mount Third Brake Light (CHMSL) under spoiler
  const chmslGeo = new THREE.BoxGeometry(0.46, 0.018, 0.025);
  const chmsl = new THREE.Mesh(chmslGeo, mats.redReflector);
  chmsl.position.set(0, 1.612, 1.93);
  ghGroup.add(chmsl);

  // Shark-fin Roof Antenna
  const finShape = new THREE.Shape();
  finShape.moveTo(0, 0);
  finShape.quadraticCurveTo(0.09, 0.01, 0.15, 0.065);
  finShape.lineTo(0.16, 0);
  finShape.closePath();

  const finGeo = new THREE.ExtrudeGeometry(finShape, {
    depth: 0.028,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.006,
    bevelSegments: 2,
  });
  finGeo.rotateY(-Math.PI / 2);
  finGeo.translate(0.014, 1.65, 1.32);
  const fin = new THREE.Mesh(finGeo, paintMat);
  fin.castShadow = true;
  ghGroup.add(fin);

  // Raised Roof Rails (Bringing total height to 1.75m)
  for (const sign of [-1, 1]) {
    const xRail = sign * 0.56;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(xRail, 1.655, -0.25),
      new THREE.Vector3(xRail, 1.732, -0.05),
      new THREE.Vector3(xRail, 1.736, 0.65),
      new THREE.Vector3(xRail, 1.720, 1.30),
      new THREE.Vector3(xRail, 1.635, 1.56),
    ]);
    const railGeo = new THREE.TubeGeometry(curve, 28, 0.016, 10, false);
    const rail = new THREE.Mesh(railGeo, mats.satinSilver);
    rail.castShadow = true;
    rail.receiveShadow = true;
    ghGroup.add(rail);

    // Center roof-rail stanchion foot
    const footGeo = new THREE.BoxGeometry(0.026, 0.055, 0.11);
    const foot = new THREE.Mesh(footGeo, mats.darkTrim);
    foot.position.set(xRail, 1.70, 0.62);
    ghGroup.add(foot);
  }

  return ghGroup;
}

function buildPanelGapsAndHandles(THREE, paintMat, mats) {
  const detailsGroup = new THREE.Group();

  // Door Handles (4 doors)
  const handleGeo = new THREE.BoxGeometry(0.032, 0.028, 0.17);
  const cupGeo = new THREE.BoxGeometry(0.012, 0.042, 0.14);

  const doorZPositions = [-0.12, 0.78]; // Front door, Rear door
  for (const sign of [-1, 1]) {
    for (let i = 0; i < doorZPositions.length; i++) {
      const dz = doorZPositions[i];
      const dy = 1.03 + i * 0.02;
      const dx = sign * 0.955;

      const cup = new THREE.Mesh(cupGeo, mats.darkTrim);
      cup.position.set(dx, dy, dz);
      detailsGroup.add(cup);

      const handle = new THREE.Mesh(handleGeo, paintMat);
      handle.position.set(dx + sign * 0.014, dy, dz);
      handle.castShadow = true;
      detailsGroup.add(handle);
    }

    // Side Door Panel Cut Lines (thin dark strips flush with body)
    const cutSeamGeo = new THREE.BoxGeometry(0.006, 0.68, 0.006);
    for (const seamZ of [-0.90, 0.12, 1.05]) {
      const seam = new THREE.Mesh(cutSeamGeo, mats.darkTrim);
      seam.position.set(sign * 0.957, 0.74, seamZ);
      detailsGroup.add(seam);
    }

    // Character crease accent molding along lower doors
    const rockerTrimGeo = new THREE.BoxGeometry(0.016, 0.038, 1.62);
    const rockerTrim = new THREE.Mesh(rockerTrimGeo, mats.satinSilver);
    rockerTrim.position.set(sign * 0.962, 0.41, -0.04);
    detailsGroup.add(rockerTrim);
  }

  // Hood shutlines (left & right seams + front header seam)
  for (const sign of [-1, 1]) {
    const hoodSeamCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sign * 0.72, 1.10, -0.95),
      new THREE.Vector3(sign * 0.68, 1.045, -1.60),
      new THREE.Vector3(sign * 0.58, 0.96, -2.22),
    ]);
    const hoodSeamGeo = new THREE.TubeGeometry(hoodSeamCurve, 16, 0.0035, 6, false);
    const hoodSeam = new THREE.Mesh(hoodSeamGeo, mats.darkTrim);
    detailsGroup.add(hoodSeam);

    // Subtle hood power bulge crease
    const creaseCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(sign * 0.42, 1.115, -0.96),
      new THREE.Vector3(sign * 0.38, 1.06, -1.62),
      new THREE.Vector3(sign * 0.30, 0.975, -2.20),
    ]);
    const creaseGeo = new THREE.TubeGeometry(creaseCurve, 16, 0.006, 6, false);
    const crease = new THREE.Mesh(creaseGeo, paintMat);
    detailsGroup.add(crease);
  }

  // Windshield Wipers
  for (const [wx, wLen] of [[-0.28, 0.54], [0.22, 0.48]]) {
    const wiperGroup = new THREE.Group();
    wiperGroup.position.set(wx, 1.115, -0.93);
    wiperGroup.rotation.y = -0.12;
    wiperGroup.rotation.z = -0.06;

    const arm = new THREE.Mesh(new THREE.BoxGeometry(wLen, 0.012, 0.016), mats.darkTrim);
    arm.position.set(wLen * 0.45, 0, 0);
    wiperGroup.add(arm);

    const blade = new THREE.Mesh(new THREE.BoxGeometry(wLen * 0.85, 0.016, 0.01), mats.darkTrim);
    blade.position.set(wLen * 0.55, -0.004, 0.01);
    wiperGroup.add(blade);

    detailsGroup.add(wiperGroup);
  }

  // Rear Window Wiper
  const rwArm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.014, 0.014), mats.darkTrim);
  rwArm.position.set(0.15, 1.21, 2.20);
  rwArm.rotation.z = 0.08;
  detailsGroup.add(rwArm);

  return detailsGroup;
}

function buildFrontAndRearFascias(THREE, mats) {
  const fasciaGroup = new THREE.Group();

  // --- FRONT GRILLE & BUMPER DETAILS ---
  // Upper Hexagonal Grille Insert
  const grilleShape = new THREE.Shape();
  grilleShape.moveTo(-0.46, 0.88);
  grilleShape.lineTo(0.46, 0.88);
  grilleShape.lineTo(0.54, 0.78);
  grilleShape.lineTo(0.44, 0.64);
  grilleShape.lineTo(-0.44, 0.64);
  grilleShape.lineTo(-0.54, 0.78);
  grilleShape.closePath();

  const grilleGeo = new THREE.ExtrudeGeometry(grilleShape, {
    depth: 0.06,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 2,
  });
  // Map UVs nicely for canvas grille texture
  const posAttr = grilleGeo.attributes.position;
  const uvAttr = grilleGeo.attributes.uv;
  for (let i = 0; i < posAttr.count; i++) {
    uvAttr.setXY(i, (posAttr.getX(i) + 0.55) * 2.5, (posAttr.getY(i) - 0.64) * 4.0);
  }
  const grilleMesh = new THREE.Mesh(grilleGeo, mats.grille);
  grilleMesh.position.set(0, 0, -2.405);
  grilleMesh.castShadow = true;
  fasciaGroup.add(grilleMesh);

  // Satin Silver Grille Surround Mustache Bar
  const barGeo = new THREE.BoxGeometry(1.06, 0.032, 0.05);
  const topBar = new THREE.Mesh(barGeo, mats.satinSilver);
  topBar.position.set(0, 0.89, -2.385);
  fasciaGroup.add(topBar);

  // Center emblem backing (blank geometric shield, NO logos)
  const badgeGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.025, 6);
  badgeGeo.rotateX(Math.PI / 2);
  const badge = new THREE.Mesh(badgeGeo, mats.chrome);
  badge.position.set(0, 0.78, -2.408);
  fasciaGroup.add(badge);

  // Lower Bumper Intake & Radar Sensor Panel
  const intakeGeo = new THREE.BoxGeometry(0.96, 0.14, 0.06);
  const intake = new THREE.Mesh(intakeGeo, mats.grille);
  intake.position.set(0, 0.43, -2.385);
  fasciaGroup.add(intake);

  // Front Skid Plate / Chin Spoiler
  const frontSkidGeo = new THREE.BoxGeometry(0.92, 0.075, 0.14);
  const frontSkid = new THREE.Mesh(frontSkidGeo, mats.satinSilver);
  frontSkid.position.set(0, 0.31, -2.35);
  frontSkid.rotation.x = 0.25;
  frontSkid.castShadow = true;
  fasciaGroup.add(frontSkid);

  // Front Blank License Plate Frame & Plate
  const fPlateFrame = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.17, 0.025), mats.darkTrim);
  fPlateFrame.position.set(0, 0.54, -2.402);
  fasciaGroup.add(fPlateFrame);

  const fPlate = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.145, 0.028), mats.plate);
  fPlate.position.set(0, 0.54, -2.404);
  fasciaGroup.add(fPlate);

  // Fog Light Pockets (Left & Right)
  for (const sign of [-1, 1]) {
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.15, 0.06), mats.darkTrim);
    pocket.position.set(sign * 0.68, 0.46, -2.33);
    pocket.rotation.y = sign * 0.32;
    fasciaGroup.add(pocket);

    const fogLamp = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 16), mats.chrome);
    fogLamp.rotation.x = Math.PI / 2;
    fogLamp.position.set(sign * 0.69, 0.46, -2.35);
    fasciaGroup.add(fogLamp);

    // Front Side Amber Marker Reflectors on wheel arch
    const marker = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.025, 0.09), mats.amberReflector);
    marker.position.set(sign * 0.955, 0.58, -1.88);
    fasciaGroup.add(marker);
  }

  // --- REAR LIFTGATE & BUMPER DETAILS ---
  // Rear Blank License Plate Recess & Plate
  const rRecess = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.22, 0.025), mats.darkTrim);
  rRecess.position.set(0, 0.92, 2.345);
  fasciaGroup.add(rRecess);

  const rPlate = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.15, 0.03), mats.plate);
  rPlate.position.set(0, 0.91, 2.352);
  fasciaGroup.add(rPlate);

  // Liftgate Overhang Lip above license plate
  const gateBrow = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.035, 0.045), mats.chrome);
  gateBrow.position.set(0, 1.04, 2.35);
  fasciaGroup.add(gateBrow);

  // Rear Skid Plate / Diffuser Valance
  const rearSkid = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.11, 0.12), mats.satinSilver);
  rearSkid.position.set(0, 0.35, 2.355);
  rearSkid.rotation.x = -0.22;
  rearSkid.castShadow = true;
  fasciaGroup.add(rearSkid);

  // Rear Bumper Reflectors & Dual Exhaust Tips
  for (const sign of [-1, 1]) {
    const refl = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.032, 0.02), mats.redReflector);
    refl.position.set(sign * 0.64, 0.46, 2.365);
    refl.rotation.y = sign * -0.22;
    fasciaGroup.add(refl);

    // Chrome Exhaust Pipe Tip
    const exOuter = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.14, 20), mats.chrome);
    exOuter.rotation.x = Math.PI / 2;
    exOuter.position.set(sign * 0.56, 0.31, 2.34);
    fasciaGroup.add(exOuter);

    const exInner = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.145, 16), mats.underbody);
    exInner.rotation.x = Math.PI / 2;
    exInner.position.set(sign * 0.56, 0.31, 2.342);
    fasciaGroup.add(exInner);
  }

  return fasciaGroup;
}

function buildLights(THREE, mats) {
  const lightsGroup = new THREE.Group();

  // Unique per-instance emissive materials so setLights(on) doesn't affect other vehicles
  const headMatL = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xddeeff,
    emissiveIntensity: 0.15,
    roughness: 0.1,
    metalness: 0.1,
  });
  const headMatR = headMatL.clone();

  const tailMatL = new THREE.MeshStandardMaterial({
    color: 0xcc1111,
    emissive: 0xff1111,
    emissiveIntensity: 0.2,
    roughness: 0.15,
    metalness: 0.1,
  });
  const tailMatR = tailMatL.clone();

  // --- HEADLIGHTS (headlight_L, headlight_R) ---
  const hlShape = new THREE.Shape();
  hlShape.moveTo(0.46, 0.88);
  hlShape.lineTo(0.84, 0.92);
  hlShape.lineTo(0.88, 0.82);
  hlShape.lineTo(0.76, 0.77);
  hlShape.lineTo(0.52, 0.77);
  hlShape.closePath();

  const hlGeoR = new THREE.ExtrudeGeometry(hlShape, {
    depth: 0.16,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.012,
    bevelSegments: 2,
  });
  // Shear/angle along front corner wrap
  const hlPosR = hlGeoR.attributes.position;
  for (let i = 0; i < hlPosR.count; i++) {
    const x = hlPosR.getX(i);
    const z = hlPosR.getZ(i);
    const wrapZ = Math.max(0, x - 0.48) * 0.42;
    hlPosR.setZ(i, z + wrapZ);
  }
  hlGeoR.computeVertexNormals();

  const hlGeoL = hlGeoR.clone();
  hlGeoL.scale(-1, 1, 1);
  hlGeoL.computeVertexNormals();

  const headlightL = new THREE.Mesh(hlGeoL, headMatL);
  headlightL.name = 'headlight_L';
  headlightL.position.set(0, 0, -2.39);
  headlightL.castShadow = false;
  headlightL.receiveShadow = true;
  lightsGroup.add(headlightL);

  const headlightR = new THREE.Mesh(hlGeoR, headMatR);
  headlightR.name = 'headlight_R';
  headlightR.position.set(0, 0, -2.39);
  headlightR.castShadow = false;
  headlightR.receiveShadow = true;
  lightsGroup.add(headlightR);

  // Internal projector lenses inside headlight housing
  for (const sign of [-1, 1]) {
    for (const [px, py, pz] of [[0.62, 0.835, -2.32], [0.74, 0.85, -2.27]]) {
      const proj = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 12), mats.chrome);
      proj.position.set(sign * px, py, pz);
      lightsGroup.add(proj);
    }
  }

  // --- TAILLIGHTS (taillight_L, taillight_R) ---
  const tlShape = new THREE.Shape();
  tlShape.moveTo(0.38, 1.13);
  tlShape.lineTo(0.85, 1.15);
  tlShape.lineTo(0.88, 0.98);
  tlShape.lineTo(0.76, 0.96);
  tlShape.lineTo(0.72, 1.05);
  tlShape.lineTo(0.38, 1.05);
  tlShape.closePath();

  const tlGeoR = new THREE.ExtrudeGeometry(tlShape, {
    depth: 0.14,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.012,
    bevelSegments: 2,
  });
  const tlPosR = tlGeoR.attributes.position;
  for (let i = 0; i < tlPosR.count; i++) {
    const x = tlPosR.getX(i);
    const z = tlPosR.getZ(i);
    const wrapZ = -Math.max(0, x - 0.42) * 0.36;
    tlPosR.setZ(i, z + wrapZ);
  }
  tlGeoR.computeVertexNormals();

  const tlGeoL = tlGeoR.clone();
  tlGeoL.scale(-1, 1, 1);
  tlGeoL.computeVertexNormals();

  const taillightL = new THREE.Mesh(tlGeoL, tailMatL);
  taillightL.name = 'taillight_L';
  taillightL.position.set(0, 0, 2.22);
  taillightL.castShadow = false;
  taillightL.receiveShadow = true;
  lightsGroup.add(taillightL);

  const taillightR = new THREE.Mesh(tlGeoR, tailMatR);
  taillightR.name = 'taillight_R';
  taillightR.position.set(0, 0, 2.22);
  taillightR.castShadow = false;
  taillightR.receiveShadow = true;
  lightsGroup.add(taillightR);

  // Headlamp SpotLight Beams (toggled by setLights)
  const spots = [];
  for (const sign of [-1, 1]) {
    const spot = new THREE.SpotLight(0xfff6e5, 0, 35, Math.PI / 5, 0.45, 1.5);
    spot.position.set(sign * 0.68, 0.84, -2.35);
    spot.target.position.set(sign * 0.68, 0.15, -15.0);
    spot.visible = false;
    spot.castShadow = false;
    lightsGroup.add(spot);
    lightsGroup.add(spot.target);
    spots.push(spot);
  }

  return {
    lightsGroup,
    headlightL,
    headlightR,
    taillightL,
    taillightR,
    spots,
  };
}

export default function create(THREE, opts = {}) {
  const id = opts.id ?? 'suv';
  const seed = opts.seed ?? id;
  makePRNG(seed);

  const group = new THREE.Group();
  group.name = id;

  const paintColor = new THREE.Color(opts.color ?? '#1d3f7a');
  const paintMat = new THREE.MeshPhysicalMaterial({
    color: paintColor,
    metalness: 0.42,
    roughness: 0.22,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
  });

  const mats = getSharedMaterials(THREE);
  const geos = getBodyGeometries(THREE);

  // 1. Main Painted Body Shell
  const bodyMesh = new THREE.Mesh(geos.bodyPaint, paintMat);
  bodyMesh.name = 'body';
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  // 2. Black Plastic Wheel-Arch & Rocker Cladding
  const cladMesh = new THREE.Mesh(geos.cladding, mats.cladding);
  cladMesh.name = 'cladding';
  cladMesh.castShadow = true;
  cladMesh.receiveShadow = true;
  group.add(cladMesh);

  // 3. Underbody Chassis Pan & Wheel-Well Liners (for clean ground contact shadow)
  const underPanGeo = new THREE.BoxGeometry(1.56, 0.08, 4.35);
  const underPan = new THREE.Mesh(underPanGeo, mats.underbody);
  underPan.position.set(0, 0.25, -0.02);
  underPan.castShadow = true;
  underPan.receiveShadow = true;
  group.add(underPan);

  const wellArchGeo = new THREE.CylinderGeometry(0.415, 0.415, 0.34, 24, 1, true, -Math.PI * 0.5, Math.PI);
  wellArchGeo.rotateZ(Math.PI / 2);
  for (const az of [-1.47, 1.38]) {
    for (const sign of [-1, 1]) {
      const liner = new THREE.Mesh(wellArchGeo, mats.underbody);
      liner.position.set(sign * 0.78, 0.37, az);
      group.add(liner);
    }
  }

  // 4. Greenhouse, Windows, Pillars, Spoiler & Roof Rails
  const greenhouse = buildGreenhouseAndTrim(THREE, paintMat, mats);
  group.add(greenhouse);

  // 5. Cabin Interior
  const interior = buildInterior(THREE, mats);
  group.add(interior);

  // 6. Panel Gaps, Door Handles, Wipers & Trim
  const details = buildPanelGapsAndHandles(THREE, paintMat, mats);
  group.add(details);

  // 7. Front & Rear Fascias (Grille, Skid Plates, Bumpers, Plates, Exhaust)
  const fascias = buildFrontAndRearFascias(THREE, mats);
  group.add(fascias);

  // 8. Side Mirrors ('mirror_L', 'mirror_R')
  const mirrorL = buildSideMirror(THREE, paintMat, mats, true);
  mirrorL.position.set(-0.92, 1.12, -0.68);
  group.add(mirrorL);

  const mirrorR = buildSideMirror(THREE, paintMat, mats, false);
  mirrorR.position.set(0.92, 1.12, -0.68);
  group.add(mirrorR);

  // 9. Headlights & Taillights ('headlight_L', 'headlight_R', 'taillight_L', 'taillight_R')
  const { lightsGroup, headlightL, headlightR, taillightL, taillightR, spots } = buildLights(THREE, mats);
  group.add(lightsGroup);

  // 10. Wheels (4 wheels spinning around local X axle)
  // Track = 1.65m (x = ±0.825), Wheelbase = 2.85m (z = -1.47 front, +1.38 rear), Radius = 0.37m
  const wheelCoords = [
    ['wheel_FL', -0.825, 0.37, -1.47, true],
    ['wheel_FR', 0.825, 0.37, -1.47, false],
    ['wheel_RL', -0.825, 0.37, 1.38, true],
    ['wheel_RR', 0.825, 0.37, 1.38, false],
  ];

  const wheels = [];
  for (const [wName, wx, wy, wz, isLeft] of wheelCoords) {
    const w = buildWheel(THREE, isLeft);
    w.name = wName;
    w.position.set(wx, wy, wz);
    group.add(w);
    wheels.push(w);
  }

  // Ensure shadow flags on all meshes except emissive lamp lenses
  const lampNames = new Set(['headlight_L', 'headlight_R', 'taillight_L', 'taillight_R']);
  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.receiveShadow = true;
      obj.castShadow = !lampNames.has(obj.name);
    }
  });

  // Forensic userData contract
  const setLights = (on) => {
    const active = Boolean(on);
    headlightL.material.emissiveIntensity = active ? 3.5 : 0.15;
    headlightR.material.emissiveIntensity = active ? 3.5 : 0.15;
    taillightL.material.emissiveIntensity = active ? 2.5 : 0.2;
    taillightR.material.emissiveIntensity = active ? 2.5 : 0.2;
    for (const sp of spots) {
      sp.visible = active;
      sp.intensity = active ? 18 : 0;
    }
  };

  group.userData = {
    assetType: 'vehicle',
    vehicleType: 'suv',
    dims: { length: 4.80, width: 1.95, height: 1.75 },
    driverEye: [-0.42, 1.38, -0.32],
    wheels,
    setLights,
  };

  if (opts.lightsOn) {
    setLights(true);
  }

  return group;
}
