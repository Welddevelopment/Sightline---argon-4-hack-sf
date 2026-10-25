let _sharedCache = null;

function createTireTreadTexture(THREE) {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const u = x / size;
      const v = y / size;
      // 5 circumferential ribs with lug notches
      let val = 42;
      const groove =
        Math.abs(u - 0.2) < 0.025 ||
        Math.abs(u - 0.38) < 0.028 ||
        Math.abs(u - 0.62) < 0.028 ||
        Math.abs(u - 0.8) < 0.025;
      if (groove) {
        val = 14;
      } else {
        const lugPhase = (v * 36 + (u > 0.5 ? 0.5 : 0)) % 1;
        if (lugPhase < 0.16 && (u < 0.18 || u > 0.82 || (u > 0.4 && u < 0.6))) {
          val = 18;
        }
      }
      data[idx] = val;
      data[idx + 1] = val;
      data[idx + 2] = val + 2;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 6);
  tex.needsUpdate = true;
  return tex;
}

function createGrilleTexture(THREE) {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const gx = x % 8;
      const gy = y % 8;
      const hole = gx >= 2 && gx <= 6 && gy >= 2 && gy <= 6;
      const v = hole ? 15 : 130;
      data[idx] = v;
      data[idx + 1] = v;
      data[idx + 2] = v + 5;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  tex.needsUpdate = true;
  return tex;
}

function createDeckPlateTexture(THREE) {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const cellX = x % 16;
      const cellY = y % 16;
      const phase = ((x >> 4) + (y >> 4)) & 1;
      let ridge = false;
      if (phase === 0) {
        ridge = Math.abs(cellX - cellY) <= 2 && cellX > 3 && cellX < 13;
      } else {
        ridge = Math.abs(cellX + cellY - 16) <= 2 && cellX > 3 && cellX < 13;
      }
      const v = ridge ? 225 : 165;
      data[idx] = v;
      data[idx + 1] = v;
      data[idx + 2] = v + 8;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.needsUpdate = true;
  return tex;
}

function getShared(THREE) {
  if (_sharedCache) return _sharedCache;

  const treadTex = createTireTreadTexture(THREE);
  const grilleTex = createGrilleTexture(THREE);
  const deckTex = createDeckPlateTexture(THREE);

  const mats = {
    chrome: new THREE.MeshStandardMaterial({
      color: 0xf2f5f8,
      metalness: 0.95,
      roughness: 0.1,
    }),
    brushedAlum: new THREE.MeshStandardMaterial({
      color: 0xd8dde2,
      metalness: 0.85,
      roughness: 0.25,
    }),
    deckAlum: new THREE.MeshStandardMaterial({
      color: 0xd0d5dd,
      map: deckTex,
      bumpMap: deckTex,
      bumpScale: 0.008,
      metalness: 0.8,
      roughness: 0.35,
    }),
    grilleMesh: new THREE.MeshStandardMaterial({
      color: 0x33383e,
      map: grilleTex,
      bumpMap: grilleTex,
      bumpScale: 0.01,
      metalness: 0.6,
      roughness: 0.45,
    }),
    frameBlack: new THREE.MeshStandardMaterial({
      color: 0x181a1d,
      metalness: 0.35,
      roughness: 0.6,
    }),
    castIron: new THREE.MeshStandardMaterial({
      color: 0x22252a,
      metalness: 0.5,
      roughness: 0.72,
    }),
    darkPlastic: new THREE.MeshStandardMaterial({
      color: 0x1c1e22,
      metalness: 0.08,
      roughness: 0.78,
    }),
    rubber: new THREE.MeshStandardMaterial({
      color: 0x161719,
      metalness: 0.04,
      roughness: 0.88,
    }),
    tireTread: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: treadTex,
      bumpMap: treadTex,
      bumpScale: 0.015,
      metalness: 0.05,
      roughness: 0.9,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x0d151c,
      metalness: 0.1,
      roughness: 0.05,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      transparent: true,
      opacity: 0.58,
    }),
    headlightGlass: new THREE.MeshPhysicalMaterial({
      color: 0xeef6ff,
      metalness: 0.05,
      roughness: 0.06,
      clearcoat: 1.0,
      transparent: true,
      opacity: 0.42,
    }),
    mirrorSurface: new THREE.MeshStandardMaterial({
      color: 0xf5faff,
      metalness: 0.98,
      roughness: 0.03,
    }),
    interiorDark: new THREE.MeshStandardMaterial({
      color: 0x121417,
      metalness: 0.05,
      roughness: 0.9,
    }),
    seatFabric: new THREE.MeshStandardMaterial({
      color: 0x24282e,
      metalness: 0.05,
      roughness: 0.85,
    }),
    conspicuityRed: new THREE.MeshStandardMaterial({
      color: 0xd92323,
      metalness: 0.3,
      roughness: 0.25,
      emissive: 0x330505,
      emissiveIntensity: 0.3,
    }),
    conspicuityWhite: new THREE.MeshStandardMaterial({
      color: 0xf4f6f8,
      metalness: 0.3,
      roughness: 0.25,
      emissive: 0x222222,
      emissiveIntensity: 0.3,
    }),
    amberMarker: new THREE.MeshStandardMaterial({
      color: 0xff8c00,
      emissive: 0xff6a00,
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.1,
    }),
    licensePlate: new THREE.MeshStandardMaterial({
      color: 0xe8ecf0,
      metalness: 0.2,
      roughness: 0.4,
    }),
    airlineRed: new THREE.MeshStandardMaterial({
      color: 0xb81d1d,
      roughness: 0.5,
      metalness: 0.1,
    }),
    airlineBlue: new THREE.MeshStandardMaterial({
      color: 0x1d4eb8,
      roughness: 0.5,
      metalness: 0.1,
    }),
  };

  _sharedCache = { mats };
  return _sharedCache;
}

function buildLoftedGeometry(THREE, sections, closeFront = true, closeBack = true) {
  const numSecs = sections.length;
  const ringLen = sections[0].pts.length;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let s = 0; s < numSecs; s++) {
    const z = sections[s].z;
    const pts = sections[s].pts;
    const v = s / (numSecs - 1);
    for (let i = 0; i < ringLen; i++) {
      positions.push(pts[i][0], pts[i][1], z);
      uvs.push(i / ringLen, v);
    }
  }

  for (let s = 0; s < numSecs - 1; s++) {
    const r0 = s * ringLen;
    const r1 = (s + 1) * ringLen;
    for (let i = 0; i < ringLen; i++) {
      const next = (i + 1) % ringLen;
      const a = r0 + i;
      const b = r0 + next;
      const c = r1 + next;
      const d = r1 + i;
      indices.push(a, d, c);
      indices.push(a, c, b);
    }
  }

  if (closeFront) {
    const pts = sections[0].pts;
    const z = sections[0].z;
    let cx = 0,
      cy = 0;
    for (let i = 0; i < ringLen; i++) {
      cx += pts[i][0];
      cy += pts[i][1];
    }
    cx /= ringLen;
    cy /= ringLen;
    const cIdx = positions.length / 3;
    positions.push(cx, cy, z);
    uvs.push(0.5, 0.5);
    for (let i = 0; i < ringLen; i++) {
      const next = (i + 1) % ringLen;
      indices.push(cIdx, i, next);
    }
  }

  if (closeBack) {
    const pts = sections[numSecs - 1].pts;
    const z = sections[numSecs - 1].z;
    let cx = 0,
      cy = 0;
    for (let i = 0; i < ringLen; i++) {
      cx += pts[i][0];
      cy += pts[i][1];
    }
    cx /= ringLen;
    cy /= ringLen;
    const cIdx = positions.length / 3;
    positions.push(cx, cy, z);
    uvs.push(0.5, 0.5);
    const base = (numSecs - 1) * ringLen;
    for (let i = 0; i < ringLen; i++) {
      const next = (i + 1) % ringLen;
      indices.push(cIdx, base + next, base + i);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

function makeCrossSection(halfWTop, halfWMid, halfWBot, yTop, yCrown, yMid, yBot) {
  // 16 points around perimeter (counter-clockwise looking from +Z)
  return [
    [0.0, yCrown],
    [halfWTop * 0.45, yCrown - (yCrown - yTop) * 0.25],
    [halfWTop * 0.85, yTop + (yCrown - yTop) * 0.15],
    [halfWTop, yTop],
    [halfWMid, yMid],
    [halfWMid, (yMid + yBot) * 0.5],
    [halfWBot, yBot],
    [halfWBot * 0.5, yBot],
    [0.0, yBot],
    [-halfWBot * 0.5, yBot],
    [-halfWBot, yBot],
    [-halfWMid, (yMid + yBot) * 0.5],
    [-halfWMid, yMid],
    [-halfWTop, yTop],
    [-halfWTop * 0.85, yTop + (yCrown - yTop) * 0.15],
    [-halfWTop * 0.45, yCrown - (yCrown - yTop) * 0.25],
  ];
}

function createSingleTireMesh(THREE, mats, isSteer = true) {
  const group = new THREE.Group();
  const R = 0.515; // 1.03m diameter
  const W = 0.30;
  const rRim = 0.295; // 22.5" rim

  // Tire tread cylinder (aligned with X axis)
  const treadGeo = new THREE.CylinderGeometry(R, R, W * 0.84, 36, 1, false);
  treadGeo.rotateZ(Math.PI / 2);
  const tread = new THREE.Mesh(treadGeo, mats.tireTread);
  group.add(tread);

  // Sidewall shoulders (torus on both sides)
  const swGeo = new THREE.TorusGeometry((R + rRim) * 0.5, (R - rRim) * 0.52, 16, 36);
  swGeo.scale(1, 1, 0.38);
  swGeo.rotateY(Math.PI / 2);

  const swOut = new THREE.Mesh(swGeo, mats.rubber);
  swOut.position.x = W * 0.34;
  group.add(swOut);

  const swIn = new THREE.Mesh(swGeo, mats.rubber);
  swIn.position.x = -W * 0.34;
  group.add(swIn);

  // Aluminum Rim Barrel
  const rimBarrelGeo = new THREE.CylinderGeometry(rRim, rRim, W * 0.82, 32);
  rimBarrelGeo.rotateZ(Math.PI / 2);
  const rimBarrel = new THREE.Mesh(rimBarrelGeo, mats.brushedAlum);
  group.add(rimBarrel);

  // Rim Flange lip
  const flangeGeo = new THREE.TorusGeometry(rRim, 0.016, 10, 32);
  flangeGeo.rotateY(Math.PI / 2);
  const flangeOut = new THREE.Mesh(flangeGeo, mats.chrome);
  flangeOut.position.x = W * 0.41;
  group.add(flangeOut);

  // Disc face (convex for steer, concave deep-dish for dual drive)
  const dishX = isSteer ? W * 0.32 : -W * 0.15;
  const discGeo = new THREE.CylinderGeometry(rRim * 0.96, rRim * 0.52, 0.06, 32);
  discGeo.rotateZ(Math.PI / 2);
  const disc = new THREE.Mesh(discGeo, mats.chrome);
  disc.position.x = dishX;
  group.add(disc);

  // 10 Lug Nuts + 10 Alcoa Ventilation Holes
  const lugGeo = new THREE.CylinderGeometry(0.013, 0.013, 0.035, 8);
  lugGeo.rotateZ(Math.PI / 2);
  const holeGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.065, 10);
  holeGeo.rotateZ(Math.PI / 2);

  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2;
    const rLug = 0.142;
    const lug = new THREE.Mesh(lugGeo, mats.chrome);
    lug.position.set(dishX + (isSteer ? 0.025 : 0.04), Math.cos(ang) * rLug, Math.sin(ang) * rLug);
    group.add(lug);

    const rHole = 0.215;
    const hole = new THREE.Mesh(holeGeo, mats.frameBlack);
    hole.position.set(dishX + 0.003, Math.cos(ang + 0.31) * rHole, Math.sin(ang + 0.31) * rHole);
    group.add(hole);
  }

  // Center Hub Cap & Brake Drum
  const hubRadius = isSteer ? 0.095 : 0.115;
  const hubLen = isSteer ? 0.14 : 0.28;
  const hubGeo = new THREE.CylinderGeometry(hubRadius, hubRadius * 1.05, hubLen, 20);
  hubGeo.rotateZ(Math.PI / 2);
  const hub = new THREE.Mesh(hubGeo, isSteer ? mats.chrome : mats.castIron);
  hub.position.x = isSteer ? dishX + 0.04 : 0.08;
  group.add(hub);

  const drumGeo = new THREE.CylinderGeometry(0.22, 0.22, W * 0.65, 24);
  drumGeo.rotateZ(Math.PI / 2);
  const drum = new THREE.Mesh(drumGeo, mats.castIron);
  drum.position.x = -0.03;
  group.add(drum);

  return group;
}

function createWheelAssembly(THREE, mats, sideSign, isDual) {
  const wheelRoot = new THREE.Group();
  if (!isDual) {
    // Single steer wheel: outer face points toward sideSign * X
    const tire = createSingleTireMesh(THREE, mats, true);
    if (sideSign < 0) {
      tire.rotation.y = Math.PI;
    }
    wheelRoot.add(tire);
  } else {
    // Dual drive wheels: inner and outer tire separated by 0.34m
    const offset = 0.17;
    const outerTire = createSingleTireMesh(THREE, mats, false);
    const innerTire = createSingleTireMesh(THREE, mats, false);
    if (sideSign > 0) {
      outerTire.position.x = offset;
      innerTire.position.x = -offset;
      innerTire.rotation.y = Math.PI;
    } else {
      outerTire.position.x = -offset;
      outerTire.rotation.y = Math.PI;
      innerTire.position.x = offset;
    }
    wheelRoot.add(outerTire, innerTire);
  }
  return wheelRoot;
}

export default function create(THREE, opts = {}) {
  const { mats } = getShared(THREE);
  const group = new THREE.Group();
  group.name = opts.id ?? 'truck_tractor';

  const bodyColorHex = opts.color ?? '#9b1b1e';
  const bodyPaint = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(bodyColorHex),
    metalness: 0.42,
    roughness: 0.22,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
  });

  // Per-instance controllable light materials
  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfff6e0,
    emissiveIntensity: 0.0,
    roughness: 0.1,
    metalness: 0.1,
  });
  const taillightMat = new THREE.MeshStandardMaterial({
    color: 0x990000,
    emissive: 0xff1a1a,
    emissiveIntensity: 0.0,
    roughness: 0.2,
    metalness: 0.1,
  });

  // =========================================================================
  // 1. CHASSIS FRAME RAILS, CROSSMEMBERS, SUSPENSION & FIFTH WHEEL
  // =========================================================================
  const chassisGroup = new THREE.Group();
  group.add(chassisGroup);

  // Twin C-channel frame rails: outer width 0.86m (x = ±0.395), depth 0.27m, top at y = 1.06m
  const railLength = 6.32; // z = -3.12 to +3.20
  const railZCenter = 0.04;
  const webGeo = new THREE.BoxGeometry(0.016, 0.27, railLength);
  const flangeGeo = new THREE.BoxGeometry(0.085, 0.018, railLength);

  for (const s of [-1, 1]) {
    const web = new THREE.Mesh(webGeo, mats.frameBlack);
    web.position.set(s * 0.422, 0.925, railZCenter);
    chassisGroup.add(web);

    const topFlange = new THREE.Mesh(flangeGeo, mats.frameBlack);
    topFlange.position.set(s * 0.388, 1.051, railZCenter);
    chassisGroup.add(topFlange);

    const botFlange = new THREE.Mesh(flangeGeo, mats.frameBlack);
    botFlange.position.set(s * 0.388, 0.799, railZCenter);
    chassisGroup.add(botFlange);
  }

  // Crossmembers along frame
  const crossZPositions = [-2.95, -2.0, -0.9, 0.2, 1.14, 1.80, 2.46, 3.16];
  const crossGeo = new THREE.BoxGeometry(0.84, 0.22, 0.08);
  for (const cz of crossZPositions) {
    const cm = new THREE.Mesh(crossGeo, mats.frameBlack);
    cm.position.set(0, 0.925, cz);
    chassisGroup.add(cm);
  }

  // Rear beveled frame ramp (z = 3.12 to 3.25) & pintle / taillight bar
  const rearBarGeo = new THREE.BoxGeometry(1.18, 0.16, 0.09);
  const rearBar = new THREE.Mesh(rearBarGeo, mats.frameBlack);
  rearBar.position.set(0, 0.86, 3.205);
  chassisGroup.add(rearBar);

  // Aluminum Catwalk / Deck Plate behind cab (z = 0.72 to 1.48)
  const catwalkGeo = new THREE.BoxGeometry(0.92, 0.025, 0.78);
  const catwalk = new THREE.Mesh(catwalkGeo, mats.deckAlum);
  catwalk.position.set(0, 1.075, 1.12);
  chassisGroup.add(catwalk);

  // Fifth-Wheel Assembly centred at [0, 1.22, 1.90]
  const fifthWheelGroup = new THREE.Group();
  fifthWheelGroup.position.set(0, 0, 1.90);
  chassisGroup.add(fifthWheelGroup);

  // Corrugated slider subplate (y = 1.06 to 1.11)
  const subplateGeo = new THREE.BoxGeometry(0.96, 0.05, 0.92);
  const subplate = new THREE.Mesh(subplateGeo, mats.castIron);
  subplate.position.set(0, 1.085, 0);
  fifthWheelGroup.add(subplate);

  // Pivot pedestals
  const pedGeo = new THREE.BoxGeometry(0.14, 0.08, 0.24);
  for (const s of [-1, 1]) {
    const ped = new THREE.Mesh(pedGeo, mats.castIron);
    ped.position.set(s * 0.32, 1.14, 0);
    fifthWheelGroup.add(ped);
  }

  // Horseshoe Fifth-Wheel Skid Plate (top at y = 1.22m)
  const fwShape = new THREE.Shape();
  fwShape.moveTo(-0.44, -0.38);
  fwShape.quadraticCurveTo(-0.46, 0.0, -0.34, 0.34);
  fwShape.quadraticCurveTo(0.0, 0.44, 0.34, 0.34);
  fwShape.quadraticCurveTo(0.46, 0.0, 0.44, -0.38);
  fwShape.lineTo(0.24, -0.44);
  fwShape.lineTo(0.11, -0.05);
  fwShape.arc(-0.11, 0.0, 0.11, 0, Math.PI, false);
  fwShape.lineTo(-0.24, -0.44);
  fwShape.closePath();

  const fwGeo = new THREE.ExtrudeGeometry(fwShape, {
    depth: 0.055,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.01,
    bevelSegments: 2,
  });
  fwGeo.rotateX(Math.PI / 2);
  const fwPlate = new THREE.Mesh(fwGeo, mats.castIron);
  fwPlate.position.set(0, 1.22, 0);
  fwPlate.rotation.x = 0.07; // slight rear tilt for trailer coupling
  fifthWheelGroup.add(fwPlate);

  // Fifth-wheel release handle on left side
  const releaseRodGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.48, 8);
  releaseRodGeo.rotateZ(Math.PI / 2);
  const releaseRod = new THREE.Mesh(releaseRodGeo, mats.chrome);
  releaseRod.position.set(-0.48, 1.17, -0.05);
  fifthWheelGroup.add(releaseRod);

  // Axles, Differentials, Driveshaft & Air Springs
  const steerAxleGeo = new THREE.CylinderGeometry(0.048, 0.048, 2.04, 16);
  steerAxleGeo.rotateZ(Math.PI / 2);
  const steerAxle = new THREE.Mesh(steerAxleGeo, mats.castIron);
  steerAxle.position.set(0, 0.515, -2.00);
  chassisGroup.add(steerAxle);

  // Leaf springs on steer axle
  const leafGeo = new THREE.BoxGeometry(0.08, 0.045, 1.15);
  for (const s of [-1, 1]) {
    const leaf = new THREE.Mesh(leafGeo, mats.castIron);
    leaf.position.set(s * 0.42, 0.64, -2.00);
    chassisGroup.add(leaf);
  }

  // Tandem drive axles (z = 1.14 and z = 2.46)
  const driveAxleGeo = new THREE.CylinderGeometry(0.068, 0.068, 1.85, 16);
  driveAxleGeo.rotateZ(Math.PI / 2);
  const diffGeo = new THREE.SphereGeometry(0.21, 18, 14);
  diffGeo.scale(1.1, 1.0, 1.15);
  const airBagGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.26, 16);

  for (const az of [1.14, 2.46]) {
    const axle = new THREE.Mesh(driveAxleGeo, mats.castIron);
    axle.position.set(0, 0.515, az);
    chassisGroup.add(axle);

    const diff = new THREE.Mesh(diffGeo, mats.castIron);
    diff.position.set(0, 0.515, az);
    chassisGroup.add(diff);

    for (const s of [-1, 1]) {
      const airBag = new THREE.Mesh(airBagGeo, mats.rubber);
      airBag.position.set(s * 0.42, 0.68, az + 0.22);
      chassisGroup.add(airBag);

      const trailingArm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.65), mats.castIron);
      trailingArm.position.set(s * 0.42, 0.54, az);
      chassisGroup.add(trailingArm);
    }
  }

  // Driveshaft from transmission to rear axles
  const shaftGeo = new THREE.CylinderGeometry(0.045, 0.045, 2.8, 12);
  shaftGeo.rotateX(Math.PI / 2);
  const shaft = new THREE.Mesh(shaftGeo, mats.castIron);
  shaft.position.set(0, 0.58, 1.05);
  shaft.rotation.x = 0.03;
  chassisGroup.add(shaft);

  // =========================================================================
  // 2. WHEELS (6 Wheel Hubs: 2 Single Steer + 4 Dual Drive)
  // =========================================================================
  const wheels = [];
  const wheelY = 0.515;

  // Front Steer Wheels (z = -2.00, outer edge at ±1.18m)
  const wheelFL = createWheelAssembly(THREE, mats, -1, false);
  wheelFL.name = 'wheel_FL';
  wheelFL.position.set(-1.02, wheelY, -2.00);
  group.add(wheelFL);
  wheels.push(wheelFL);

  const wheelFR = createWheelAssembly(THREE, mats, 1, false);
  wheelFR.name = 'wheel_FR';
  wheelFR.position.set(1.02, wheelY, -2.00);
  group.add(wheelFR);
  wheels.push(wheelFR);

  // Forward Drive Axle Duals (z = +1.14, outer tire outer edge at ±1.24m)
  const wheelML = createWheelAssembly(THREE, mats, -1, true);
  wheelML.name = 'wheel_ML';
  wheelML.position.set(-0.92, wheelY, 1.14);
  group.add(wheelML);
  wheels.push(wheelML);

  const wheelMR = createWheelAssembly(THREE, mats, 1, true);
  wheelMR.name = 'wheel_MR';
  wheelMR.position.set(0.92, wheelY, 1.14);
  group.add(wheelMR);
  wheels.push(wheelMR);

  // Rear Drive Axle Duals (z = +2.46)
  const wheelRL = createWheelAssembly(THREE, mats, -1, true);
  wheelRL.name = 'wheel_RL';
  wheelRL.position.set(-0.92, wheelY, 2.46);
  group.add(wheelRL);
  wheels.push(wheelRL);

  const wheelRR = createWheelAssembly(THREE, mats, 1, true);
  wheelRR.name = 'wheel_RR';
  wheelRR.position.set(0.92, wheelY, 2.46);
  group.add(wheelRR);
  wheels.push(wheelRR);

  // Quarter Fenders in front of forward drive wheels & Rear Mudflaps
  for (const s of [-1, 1]) {
    const qFenderShape = new THREE.Shape();
    qFenderShape.absarc(0, 0, 0.59, Math.PI * 0.52, Math.PI * 0.98, false);
    qFenderShape.lineTo(-0.54 * Math.cos(Math.PI * 0.02), 0.54 * Math.sin(Math.PI * 0.02));
    qFenderShape.absarc(0, 0, 0.55, Math.PI * 0.98, Math.PI * 0.52, true);
    qFenderShape.closePath();

    const qFenderGeo = new THREE.ExtrudeGeometry(qFenderShape, { depth: 0.66, bevelEnabled: false });
    qFenderGeo.rotateY(Math.PI / 2);
    const qFender = new THREE.Mesh(qFenderGeo, mats.darkPlastic);
    qFender.position.set(s * 0.92 - 0.33, wheelY, 1.14);
    chassisGroup.add(qFender);

    // Chrome quarter fender support tube
    const qPipeGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.85, 10);
    qPipeGeo.rotateZ(Math.PI / 2);
    const qPipe = new THREE.Mesh(qPipeGeo, mats.chrome);
    qPipe.position.set(s * 0.82, 0.88, 0.54);
    chassisGroup.add(qPipe);

    // Rear mudflap hanger bar (at z = 3.12) with DOT conspicuity tape
    const hangerGeo = new THREE.BoxGeometry(0.68, 0.045, 0.045);
    const hanger = new THREE.Mesh(hangerGeo, mats.chrome);
    hanger.position.set(s * 0.90, 1.02, 3.12);
    chassisGroup.add(hanger);

    // DOT Red/White Alternating Conspicuity Strips on Hanger
    for (let k = 0; k < 4; k++) {
      const stripGeo = new THREE.BoxGeometry(0.15, 0.032, 0.008);
      const strip = new THREE.Mesh(
        stripGeo,
        k % 2 === 0 ? mats.conspicuityRed : mats.conspicuityWhite
      );
      strip.position.set(s * (0.66 + k * 0.16), 1.02, 3.145);
      chassisGroup.add(strip);
    }

    // Black Rubber Rear Mudflap with Chrome Bottom Weight Plate
    const flapGeo = new THREE.BoxGeometry(0.62, 0.78, 0.016);
    const flap = new THREE.Mesh(flapGeo, mats.rubber);
    flap.position.set(s * 0.92, 0.60, 3.13);
    chassisGroup.add(flap);

    const weightPlateGeo = new THREE.BoxGeometry(0.58, 0.09, 0.022);
    const weightPlate = new THREE.Mesh(weightPlateGeo, mats.chrome);
    weightPlate.position.set(s * 0.92, 0.25, 3.135);
    chassisGroup.add(weightPlate);
  }

  // =========================================================================
  // 3. FRONT BUMPER, AERODYNAMIC HOOD, FLARED FENDERS & GRILLE
  // =========================================================================
  const bodyGroup = new THREE.Group();
  group.add(bodyGroup);

  // Swept Aerodynamic Front Bumper (z = -3.25 at center, swept to -2.98 at ±1.24m)
  const bumperSections = [
    {
      z: -3.25,
      pts: makeCrossSection(0.68, 0.72, 0.66, 0.76, 0.77, 0.52, 0.27),
    },
    {
      z: -3.21,
      pts: makeCrossSection(0.98, 1.02, 0.96, 0.76, 0.77, 0.52, 0.27),
    },
    {
      z: -3.10,
      pts: makeCrossSection(1.22, 1.24, 1.19, 0.76, 0.77, 0.52, 0.27),
    },
    {
      z: -2.92,
      pts: makeCrossSection(1.23, 1.24, 1.20, 0.76, 0.77, 0.52, 0.28),
    },
  ];
  const bumperGeo = buildLoftedGeometry(THREE, bumperSections, true, true);
  const bumperMesh = new THREE.Mesh(bumperGeo, bodyPaint);
  bodyGroup.add(bumperMesh);

  // Chrome center bumper overlay & lower air dam intake
  const chromeBumperCenter = new THREE.Mesh(
    new THREE.BoxGeometry(1.32, 0.34, 0.08),
    mats.chrome
  );
  chromeBumperCenter.position.set(0, 0.55, -3.225);
  bodyGroup.add(chromeBumperCenter);

  const lowerIntake = new THREE.Mesh(
    new THREE.BoxGeometry(1.06, 0.14, 0.09),
    mats.grilleMesh
  );
  lowerIntake.position.set(0, 0.44, -3.23);
  bodyGroup.add(lowerIntake);

  // Front Blank License Plate
  const plateMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.31, 0.16, 0.015),
    mats.licensePlate
  );
  plateMesh.position.set(0, 0.39, -3.268);
  bodyGroup.add(plateMesh);

  // Fog lights in bumper corners
  const fogGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.04, 14);
  fogGeo.rotateX(Math.PI / 2);
  for (const s of [-1, 1]) {
    const fog = new THREE.Mesh(fogGeo, mats.chrome);
    fog.position.set(s * 0.92, 0.43, -3.16);
    bodyGroup.add(fog);
  }

  // Aerodynamic Sloped Hood (z = -3.14 to -1.12, top height ~1.98m at cowl)
  const hoodSections = [
    {
      z: -3.14,
      pts: makeCrossSection(0.58, 0.68, 0.66, 1.66, 1.72, 1.18, 0.76),
    },
    {
      z: -2.98,
      pts: makeCrossSection(0.64, 0.80, 0.78, 1.74, 1.80, 1.22, 0.76),
    },
    {
      z: -2.50,
      pts: makeCrossSection(0.72, 0.88, 0.84, 1.84, 1.90, 1.28, 0.78),
    },
    {
      z: -1.80,
      pts: makeCrossSection(0.80, 0.96, 0.92, 1.91, 1.96, 1.32, 0.78),
    },
    {
      z: -1.12,
      pts: makeCrossSection(0.88, 1.04, 1.00, 1.95, 2.00, 1.36, 0.78),
    },
  ];
  const hoodGeo = buildLoftedGeometry(THREE, hoodSections, true, true);
  const hoodMesh = new THREE.Mesh(hoodGeo, bodyPaint);
  bodyGroup.add(hoodMesh);

  // Sculpted Front Fender Arches over Steer Wheels (x reaches ±1.25m, z = -2.95 to -1.15)
  for (const s of [-1, 1]) {
    const fenderSections = [
      {
        z: -2.96,
        pts: makeCrossSection(0.20, 0.22, 0.18, 1.12, 1.16, 0.92, 0.72),
      },
      {
        z: -2.55,
        pts: makeCrossSection(0.24, 0.26, 0.24, 1.28, 1.33, 1.08, 0.84),
      },
      {
        z: -2.00,
        pts: makeCrossSection(0.25, 0.27, 0.25, 1.34, 1.38, 1.16, 1.08),
      },
      {
        z: -1.45,
        pts: makeCrossSection(0.24, 0.26, 0.24, 1.28, 1.32, 1.05, 0.76),
      },
      {
        z: -1.14,
        pts: makeCrossSection(0.22, 0.24, 0.22, 1.22, 1.25, 0.92, 0.56),
      },
    ];
    // Offset section points laterally to sit on side of hood (outer edge at ±1.25m)
    for (const sec of fenderSections) {
      for (const p of sec.pts) {
        p[0] += s * 0.98;
      }
    }
    const fenderGeo = buildLoftedGeometry(THREE, fenderSections, true, true);
    const fenderMesh = new THREE.Mesh(fenderGeo, bodyPaint);
    bodyGroup.add(fenderMesh);

    // Side air intake vent behind hood flank
    const airVent = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.34, 0.26),
      mats.grilleMesh
    );
    airVent.position.set(s * 1.01, 1.62, -1.36);
    airVent.rotation.y = s * 0.08;
    bodyGroup.add(airVent);
  }

  // Large Chrome Grille Surround & Louvers (z = -3.15, tilted slightly back)
  const grilleGroup = new THREE.Group();
  grilleGroup.position.set(0, 1.25, -3.145);
  grilleGroup.rotation.x = -0.09;
  bodyGroup.add(grilleGroup);

  const surroundGeo = new THREE.BoxGeometry(1.16, 0.94, 0.06);
  const surround = new THREE.Mesh(surroundGeo, mats.chrome);
  grilleGroup.add(surround);

  const meshInsetGeo = new THREE.BoxGeometry(1.04, 0.82, 0.065);
  const meshInset = new THREE.Mesh(meshInsetGeo, mats.grilleMesh);
  meshInset.position.z = -0.005;
  grilleGroup.add(meshInset);

  // Horizontal & Vertical Chrome Grille Bars
  for (let i = -3; i <= 3; i++) {
    const hBar = new THREE.Mesh(
      new THREE.BoxGeometry(1.04, 0.026, 0.072),
      mats.chrome
    );
    hBar.position.set(0, i * 0.11, -0.006);
    grilleGroup.add(hBar);
  }
  const centerSpine = new THREE.Mesh(
    new THREE.BoxGeometry(0.045, 0.84, 0.078),
    mats.chrome
  );
  centerSpine.position.set(0, 0, -0.008);
  grilleGroup.add(centerSpine);

  // =========================================================================
  // 4. DAY-CAB BODY, ROOF FAIRING, WINDSHIELD, INTERIOR, DOORS & VISOR
  // =========================================================================
  // Main Cab Loft (z = -1.15 to +0.70, width up to 2.44m, roof at 2.86m)
  const cabSections = [
    {
      z: -1.15,
      pts: makeCrossSection(0.88, 1.04, 1.02, 1.98, 2.02, 1.45, 0.88),
    },
    {
      z: -0.92,
      pts: makeCrossSection(0.95, 1.12, 1.10, 2.28, 2.34, 1.62, 0.88),
    },
    {
      z: -0.52,
      pts: makeCrossSection(1.04, 1.20, 1.18, 2.74, 2.82, 1.85, 0.88),
    },
    {
      z: 0.10,
      pts: makeCrossSection(1.06, 1.21, 1.19, 2.78, 2.86, 1.88, 0.88),
    },
    {
      z: 0.66,
      pts: makeCrossSection(1.06, 1.21, 1.19, 2.78, 2.86, 1.88, 0.88),
    },
    {
      z: 0.70,
      pts: makeCrossSection(1.02, 1.17, 1.15, 2.74, 2.82, 1.85, 0.90),
    },
  ];
  const cabGeo = buildLoftedGeometry(THREE, cabSections, true, true);
  const cabMesh = new THREE.Mesh(cabGeo, bodyPaint);
  bodyGroup.add(cabMesh);

  // Aerodynamic Roof Fairing above Cab (z = -0.50 to +0.70, peaking at y = 3.60m)
  const fairingSections = [
    {
      z: -0.50,
      pts: makeCrossSection(0.88, 0.98, 1.02, 2.83, 2.86, 2.81, 2.76),
    },
    {
      z: -0.15,
      pts: makeCrossSection(0.95, 1.06, 1.08, 3.16, 3.24, 2.98, 2.80),
    },
    {
      z: 0.28,
      pts: makeCrossSection(1.00, 1.10, 1.12, 3.44, 3.52, 3.12, 2.82),
    },
    {
      z: 0.68,
      pts: makeCrossSection(1.04, 1.14, 1.15, 3.53, 3.60, 3.18, 2.82),
    },
    {
      z: 0.70,
      pts: makeCrossSection(1.02, 1.12, 1.13, 3.51, 3.58, 3.16, 2.82),
    },
  ];
  const fairingGeo = buildLoftedGeometry(THREE, fairingSections, true, true);
  const fairingMesh = new THREE.Mesh(fairingGeo, bodyPaint);
  bodyGroup.add(fairingMesh);

  // Cab Side Extenders behind cab corners (z = 0.68 to 0.90)
  for (const s of [-1, 1]) {
    const extGeo = new THREE.BoxGeometry(0.04, 2.55, 0.24);
    const ext = new THREE.Mesh(extGeo, bodyPaint);
    ext.position.set(s * 1.14, 2.22, 0.78);
    ext.rotation.y = -s * 0.08;
    bodyGroup.add(ext);
  }

  // Raked Windshield Glass & Center Divider / Wipers
  const wsGroup = new THREE.Group();
  wsGroup.position.set(0, 2.38, -0.82);
  wsGroup.rotation.x = -0.58; // raked back ~33 deg
  bodyGroup.add(wsGroup);

  const wsFrame = new THREE.Mesh(
    new THREE.BoxGeometry(1.94, 0.82, 0.06),
    mats.rubber
  );
  wsGroup.add(wsFrame);

  const wsGlass = new THREE.Mesh(
    new THREE.BoxGeometry(1.86, 0.74, 0.07),
    mats.glass
  );
  wsGroup.add(wsGlass);

  // Center pillar strip
  const wsDivider = new THREE.Mesh(
    new THREE.BoxGeometry(0.035, 0.78, 0.075),
    mats.rubber
  );
  wsGroup.add(wsDivider);

  // Dual Windshield Wipers
  for (const wx of [-0.45, 0.45]) {
    const wiperArm = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.022, 0.025),
      mats.frameBlack
    );
    wiperArm.position.set(wx + 0.12, -0.26, -0.045);
    wiperArm.rotation.z = 0.14;
    wsGroup.add(wiperArm);
  }

  // Exterior Chrome/Painted Sun Visor above Windshield
  const visorGroup = new THREE.Group();
  visorGroup.position.set(0, 2.77, -0.64);
  visorGroup.rotation.x = 0.25;
  bodyGroup.add(visorGroup);

  const visorBlade = new THREE.Mesh(
    new THREE.BoxGeometry(2.04, 0.15, 0.22),
    mats.chrome
  );
  visorGroup.add(visorBlade);

  // 5 Amber Roof Marker Lights along Cab Header
  const markerGeo = new THREE.BoxGeometry(0.08, 0.035, 0.06);
  for (const mx of [-0.76, -0.38, 0, 0.38, 0.76]) {
    const marker = new THREE.Mesh(markerGeo, mats.amberMarker);
    marker.position.set(mx, 2.86, -0.52);
    marker.castShadow = false;
    bodyGroup.add(marker);
  }

  // Rear Cab Day-Cab Window
  const rearWinFrame = new THREE.Mesh(
    new THREE.BoxGeometry(1.24, 0.52, 0.05),
    mats.rubber
  );
  rearWinFrame.position.set(0, 2.34, 0.69);
  bodyGroup.add(rearWinFrame);

  const rearWinGlass = new THREE.Mesh(
    new THREE.BoxGeometry(1.16, 0.44, 0.06),
    mats.glass
  );
  rearWinGlass.position.set(0, 2.34, 0.69);
  bodyGroup.add(rearWinGlass);

  // Interior Cab Tub: Dashboard, Steering Wheel (left side x = -0.55), Driver & Passenger High-Back Seats
  const dash = new THREE.Mesh(
    new THREE.BoxGeometry(1.85, 0.42, 0.45),
    mats.interiorDark
  );
  dash.position.set(0, 1.85, -0.78);
  bodyGroup.add(dash);

  const steeringWheel = new THREE.Mesh(
    new THREE.TorusGeometry(0.21, 0.022, 10, 24),
    mats.interiorDark
  );
  steeringWheel.position.set(-0.55, 2.02, -0.52);
  steeringWheel.rotation.x = -0.65;
  bodyGroup.add(steeringWheel);

  const steeringCol = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.04, 0.42, 10),
    mats.interiorDark
  );
  steeringCol.position.set(-0.55, 1.88, -0.64);
  steeringCol.rotation.x = 0.9;
  bodyGroup.add(steeringCol);

  for (const sx of [-0.55, 0.55]) {
    const seatBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.48, 0.52),
      mats.seatFabric
    );
    seatBase.position.set(sx, 1.58, -0.12);
    bodyGroup.add(seatBase);

    const seatBack = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.86, 0.14),
      mats.seatFabric
    );
    seatBack.position.set(sx, 2.18, 0.10);
    seatBack.rotation.x = -0.08;
    bodyGroup.add(seatBack);
  }

  // Cab Side Doors, Windows, Handles & Chrome Grab Bars
  for (const s of [-1, 1]) {
    // Side window frame & glass
    const sideWinFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.64, 0.86),
      mats.rubber
    );
    sideWinFrame.position.set(s * 1.12, 2.26, -0.22);
    sideWinFrame.rotation.z = -s * 0.14;
    bodyGroup.add(sideWinFrame);

    const sideWinGlass = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.56, 0.78),
      mats.glass
    );
    sideWinGlass.position.set(s * 1.12, 2.26, -0.22);
    sideWinGlass.rotation.z = -s * 0.14;
    bodyGroup.add(sideWinGlass);

    // Door seam outline inset
    const doorSeam = new THREE.Mesh(
      new THREE.BoxGeometry(0.015, 1.52, 0.96),
      mats.frameBlack
    );
    doorSeam.position.set(s * 1.195, 1.72, -0.18);
    bodyGroup.add(doorSeam);

    const doorPanel = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 1.48, 0.92),
      bodyPaint
    );
    doorPanel.position.set(s * 1.198, 1.72, -0.18);
    bodyGroup.add(doorPanel);

    // Chrome Door Handle & Lock Cylinder
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.045, 0.18),
      mats.chrome
    );
    handle.position.set(s * 1.215, 1.54, 0.12);
    bodyGroup.add(handle);

    // Vertical Chrome Grab Bar behind Door
    const grabBarGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.98, 10);
    const grabBar = new THREE.Mesh(grabBarGeo, mats.chrome);
    grabBar.position.set(s * 1.22, 1.82, 0.44);
    bodyGroup.add(grabBar);

    for (const gy of [1.35, 2.29]) {
      const bracket = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.03, 0.03),
        mats.chrome
      );
      bracket.position.set(s * 1.20, gy, 0.44);
      bodyGroup.add(bracket);
    }
  }

  // =========================================================================
  // 5. FUEL TANKS, CAB ENTRY STEPS, DPF BOX, DUAL EXHAUST STACKS & AIR LINES
  // =========================================================================
  const equipGroup = new THREE.Group();
  group.add(equipGroup);

  // Polished Aluminum Cylindrical Fuel Tanks (z = -0.35 to +0.62) & Steps
  const tankRadius = 0.32;
  const tankLen = 1.05;
  const tankCylGeo = new THREE.CylinderGeometry(tankRadius, tankRadius, tankLen, 28);
  tankCylGeo.rotateX(Math.PI / 2);
  const tankCapGeo = new THREE.SphereGeometry(tankRadius, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);

  for (const s of [-1, 1]) {
    const tx = s * 0.86;
    const ty = 0.68;
    const tz = 0.10;

    const tankBody = new THREE.Mesh(tankCylGeo, mats.chrome);
    tankBody.position.set(tx, ty, tz);
    equipGroup.add(tankBody);

    const capFront = new THREE.Mesh(tankCapGeo, mats.chrome);
    capFront.scale.set(1, 0.35, 1);
    capFront.rotation.x = -Math.PI / 2;
    capFront.position.set(tx, ty, tz - tankLen / 2);
    equipGroup.add(capFront);

    const capBack = new THREE.Mesh(tankCapGeo, mats.chrome);
    capBack.scale.set(1, 0.35, 1);
    capBack.rotation.x = Math.PI / 2;
    capBack.position.set(tx, ty, tz + tankLen / 2);
    equipGroup.add(capBack);

    // Chrome mounting straps
    const strapGeo = new THREE.TorusGeometry(tankRadius + 0.008, 0.015, 8, 28);
    for (const sz of [tz - 0.32, tz + 0.32]) {
      const strap = new THREE.Mesh(strapGeo, mats.frameBlack);
      strap.position.set(tx, ty, sz);
      equipGroup.add(strap);
    }

    // Step / Battery / DPF box forward of fuel tank under cab door (z = -1.08 to -0.45)
    const stepBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.44, 0.62),
      mats.brushedAlum
    );
    stepBox.position.set(s * 0.92, 0.66, -0.78);
    equipGroup.add(stepBox);

    // 2 Perforated Aluminum Entry Steps
    for (const [stepY, stepX] of [
      [0.44, 1.18],
      [0.74, 1.15],
    ]) {
      const stepTread = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.035, 0.72),
        mats.deckAlum
      );
      stepTread.position.set(s * stepX, stepY, -0.72);
      equipGroup.add(stepTread);
    }
  }

  // DEF Tank (Blue Cap) on Left Side behind cab
  const defBox = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.42, 0.26),
    mats.darkPlastic
  );
  defBox.position.set(-0.78, 0.72, 0.80);
  equipGroup.add(defBox);

  const defCap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.04, 12),
    mats.airlineBlue
  );
  defCap.position.set(-0.88, 0.95, 0.80);
  equipGroup.add(defCap);

  // Dual Vertical Chrome Exhaust Stacks behind Cab Corners (z = 0.77, x = ±1.06, top at y = 3.55m)
  for (const s of [-1, 1]) {
    const stackX = s * 1.06;
    const stackZ = 0.77;

    // Lower exhaust pipe
    const lowPipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.065, 2.25, 18),
      mats.chrome
    );
    lowPipe.position.set(stackX, 2.08, stackZ);
    equipGroup.add(lowPipe);

    // Perforated Heat Shield Shroud
    const shroud = new THREE.Mesh(
      new THREE.CylinderGeometry(0.088, 0.088, 1.55, 20),
      mats.brushedAlum
    );
    shroud.position.set(stackX, 1.92, stackZ);
    equipGroup.add(shroud);

    // Curved Chrome Turn-Out Tip at Top (peaking at y = 3.55m)
    const tipPipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.068, 0.065, 0.36, 18),
      mats.chrome
    );
    tipPipe.position.set(stackX + s * 0.03, 3.36, stackZ + 0.05);
    tipPipe.rotation.x = 0.28;
    tipPipe.rotation.z = -s * 0.18;
    equipGroup.add(tipPipe);
  }

  //Pogo Stick & Coiled Red/Blue Trailer Air/Electrical Lines on Catwalk
  const pogoRod = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.02, 1.05, 10),
    mats.chrome
  );
  pogoRod.position.set(-0.12, 1.58, 0.85);
  pogoRod.rotation.x = 0.12;
  equipGroup.add(pogoRod);

  const coilGeo = new THREE.TorusGeometry(0.09, 0.016, 8, 20);
  for (let c = 0; c < 5; c++) {
    const redCoil = new THREE.Mesh(coilGeo, mats.airlineRed);
    redCoil.position.set(-0.22, 1.55 - c * 0.06, 0.92 + c * 0.04);
    equipGroup.add(redCoil);

    const blueCoil = new THREE.Mesh(coilGeo, mats.airlineBlue);
    blueCoil.position.set(-0.04, 1.55 - c * 0.06, 0.92 + c * 0.04);
    equipGroup.add(blueCoil);
  }

  // =========================================================================
  // 6. SIDE MIRRORS (mirror_L, mirror_R) & HOOD SPOTTER MIRRORS
  // =========================================================================
  for (const [s, name] of [
    [-1, 'mirror_L'],
    [1, 'mirror_R'],
  ]) {
    const mirrorGroup = new THREE.Group();
    mirrorGroup.name = name;
    group.add(mirrorGroup);

    // Upper & Lower C-Loop Chrome Support Arms attached to door
    const topArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.32, 10),
      mats.chrome
    );
    topArm.rotation.z = Math.PI / 2;
    topArm.position.set(s * 1.24, 2.46, -0.54);
    mirrorGroup.add(topArm);

    const botArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.34, 10),
      mats.chrome
    );
    botArm.rotation.z = Math.PI / 2;
    botArm.position.set(s * 1.24, 1.94, -0.54);
    mirrorGroup.add(botArm);

    const vertPost = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.56, 10),
      mats.chrome
    );
    vertPost.position.set(s * 1.36, 2.20, -0.54);
    mirrorGroup.add(vertPost);

    // Main West-Coast Mirror Housing (outer edge at ±1.39m — within 0.15m mirror allowance)
    const mainHousing = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.38, 0.18),
      mats.chrome
    );
    mainHousing.position.set(s * 1.35, 2.26, -0.54);
    mainHousing.rotation.y = -s * 0.18;
    mirrorGroup.add(mainHousing);

    const mainGlass = new THREE.Mesh(
      new THREE.BoxGeometry(0.072, 0.34, 0.15),
      mats.mirrorSurface
    );
    mainGlass.position.set(s * 1.35, 2.26, -0.53);
    mainGlass.rotation.y = -s * 0.18;
    mirrorGroup.add(mainGlass);

    // Lower Convex Spotter Mirror below Main Housing
    const convexHousing = new THREE.Mesh(
      new THREE.BoxGeometry(0.065, 0.14, 0.16),
      mats.chrome
    );
    convexHousing.position.set(s * 1.35, 1.98, -0.54);
    convexHousing.rotation.y = -s * 0.18;
    mirrorGroup.add(convexHousing);

    const convexGlass = new THREE.Mesh(
      new THREE.BoxGeometry(0.068, 0.11, 0.13),
      mats.mirrorSurface
    );
    convexGlass.position.set(s * 1.35, 1.98, -0.53);
    convexGlass.rotation.y = -s * 0.18;
    mirrorGroup.add(convexGlass);

    // Front Hood-Mounted Spotter Mirrors (on front fenders at z = -2.72, within ±1.24m)
    const hoodMirrorStalk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.014, 0.28, 10),
      mats.chrome
    );
    hoodMirrorStalk.position.set(s * 1.08, 1.38, -2.72);
    hoodMirrorStalk.rotation.z = -s * 0.38;
    mirrorGroup.add(hoodMirrorStalk);

    const hoodMirrorPod = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 14, 12),
      mats.chrome
    );
    hoodMirrorPod.scale.set(1.1, 0.85, 0.65);
    hoodMirrorPod.position.set(s * 1.15, 1.49, -2.72);
    mirrorGroup.add(hoodMirrorPod);
  }

  // =========================================================================
  // 7. HEADLIGHTS, TAILLIGHTS & SPOTLIGHT BEAMS (setLights API)
  // =========================================================================
  const spotLights = [];

  for (const [s, hlName, tlName] of [
    [-1, 'headlight_L', 'taillight_L'],
    [1, 'headlight_R', 'taillight_R'],
  ]) {
    // Compound Aerodynamic Headlight Housing in Hood/Fender Corner
    const hlHousing = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.22, 0.24),
      mats.chrome
    );
    hlHousing.position.set(s * 0.94, 0.98, -2.99);
    hlHousing.rotation.y = s * 0.24;
    bodyGroup.add(hlHousing);

    // Emissive Headlight Reflector/Projector (named exactly 'headlight_L' / 'headlight_R')
    const hlMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.18, 0.25),
      headlightMat
    );
    hlMesh.name = hlName;
    hlMesh.position.set(s * 0.94, 0.98, -3.00);
    hlMesh.rotation.y = s * 0.24;
    hlMesh.castShadow = false;
    group.add(hlMesh);

    // Clear Headlight Outer Lens Cover
    const hlCover = new THREE.Mesh(
      new THREE.BoxGeometry(0.30, 0.20, 0.02),
      mats.headlightGlass
    );
    hlCover.position.set(s * 0.96, 0.98, -3.12);
    hlCover.rotation.y = s * 0.24;
    hlCover.castShadow = false;
    bodyGroup.add(hlCover);

    // Amber Turn Signal Corner Strip
    const turnStrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.18, 0.16),
      mats.amberMarker
    );
    turnStrip.position.set(s * 1.09, 0.98, -2.96);
    turnStrip.rotation.y = s * 0.24;
    turnStrip.castShadow = false;
    bodyGroup.add(turnStrip);

    // SpotLight Headlamp Beam
    const spot = new THREE.SpotLight(0xfff8e7, 0, 45, Math.PI / 5, 0.45, 1.5);
    spot.position.set(s * 0.94, 0.98, -3.12);
    spot.target.position.set(s * 0.94, 0.25, -20.0);
    spot.visible = false;
    group.add(spot);
    group.add(spot.target);
    spotLights.push(spot);

    // Rear Frame Taillight Cluster (named exactly 'taillight_L' / 'taillight_R')
    const tlHousing = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.13, 0.06),
      mats.frameBlack
    );
    tlHousing.position.set(s * 0.42, 0.86, 3.21);
    chassisGroup.add(tlHousing);

    const tlMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.09, 0.065),
      taillightMat
    );
    tlMesh.name = tlName;
    tlMesh.position.set(s * 0.42, 0.86, 3.215);
    tlMesh.castShadow = false;
    group.add(tlMesh);
  }

  // Enable castShadow / receiveShadow on all structural meshes
  group.traverse((obj) => {
    if (obj.isMesh) {
      const isLamp =
        obj.name === 'headlight_L' ||
        obj.name === 'headlight_R' ||
        obj.name === 'taillight_L' ||
        obj.name === 'taillight_R' ||
        obj.material === mats.amberMarker ||
        obj.material === mats.headlightGlass;
      obj.castShadow = !isLamp;
      obj.receiveShadow = true;
    }
  });

  // =========================================================================
  // 8. METADATA & FORENSIC CONTROL API
  // =========================================================================
  const setLights = (on) => {
    const active = Boolean(on);
    headlightMat.emissiveIntensity = active ? 3.5 : 0.0;
    taillightMat.emissiveIntensity = active ? 2.5 : 0.0;
    mats.amberMarker.emissiveIntensity = active ? 1.6 : 0.4;
    for (const s of spotLights) {
      s.visible = active;
      s.intensity = active ? 25.0 : 0.0;
    }
  };

  group.userData = {
    assetType: 'vehicle',
    vehicleType: 'truck_tractor',
    dims: { length: 6.5, width: 2.5, height: 3.6 },
    fifthWheel: [0, 1.22, 1.9],
    driverEye: [-0.55, 2.38, -0.18],
    wheels,
    setLights,
  };

  if (opts.lightsOn) {
    setLights(true);
  }

  return group;
}
