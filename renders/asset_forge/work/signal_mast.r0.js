let _cache = null;

function createConcreteTexture(THREE) {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed & 0xffff) / 0xffff;
  };
  for (let i = 0; i < size * size; i++) {
    const n = Math.floor(165 + (rand() - 0.5) * 36);
    data[i * 4] = n;
    data[i * 4 + 1] = n - 2;
    data[i * 4 + 2] = n - 6;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createGalvanizedTexture(THREE) {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  let seed = 9001;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed & 0xffff) / 0xffff;
  };
  for (let i = 0; i < size * size; i++) {
    const v = Math.floor(185 + (rand() - 0.5) * 32);
    data[i * 4] = v - 2;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = Math.min(255, v + 5);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 12);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createLedLensTexture(THREE, r, g, b) {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size * 0.47;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const idx = (y * size + x) * 4;

      if (dist > maxR) {
        data[idx] = Math.floor(r * 0.15);
        data[idx + 1] = Math.floor(g * 0.15);
        data[idx + 2] = Math.floor(b * 0.15);
        data[idx + 3] = 255;
        continue;
      }

      // Concentric Fresnel ridges + LED matrix dots
      const ring = Math.sin((dist / maxR) * Math.PI * 16) * 0.12 + 0.88;
      const gx = ((x + 4) % 8) - 4;
      const gy = ((y + 4) % 8) - 4;
      const dotDist = Math.sqrt(gx * gx + gy * gy);
      const ledBoost = dotDist < 2.6 ? 1.18 : 0.72;
      const vig = 1.0 - Math.pow(dist / maxR, 2.2) * 0.35;
      const factor = Math.min(1.3, ring * ledBoost * vig);

      data[idx] = Math.min(255, Math.floor(r * factor));
      data[idx + 1] = Math.min(255, Math.floor(g * factor));
      data[idx + 2] = Math.min(255, Math.floor(b * factor));
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createBackplateShapes(THREE) {
  const outerW = 0.56;
  const outerH = 1.28;
  const outerR = 0.055;
  const border = 0.05;
  const innerW = outerW - border * 2;
  const innerH = outerH - border * 2;
  const innerR = 0.025;

  function makeRoundedRectPath(w, h, r, isHole = false) {
    const s = isHole ? new THREE.Path() : new THREE.Shape();
    const hw = w / 2;
    const hh = h / 2;
    s.moveTo(-hw + r, -hh);
    s.lineTo(hw - r, -hh);
    s.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0, false);
    s.lineTo(hw, hh - r);
    s.absarc(hw - r, hh - r, r, 0, Math.PI / 2, false);
    s.lineTo(-hw + r, hh);
    s.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(-hw, -hh + r);
    s.absarc(-hw + r, -hh + r, r, Math.PI, Math.PI * 1.5, false);
    return s;
  }

  const plateShape = makeRoundedRectPath(outerW, outerH, outerR, false);
  const borderShape = makeRoundedRectPath(outerW, outerH, outerR, false);
  const holePath = makeRoundedRectPath(innerW, innerH, innerR, true);
  borderShape.holes.push(holePath);

  const plateGeo = new THREE.ShapeGeometry(plateShape, 12);
  const borderGeo = new THREE.ShapeGeometry(borderShape, 12);
  return { plateGeo, borderGeo };
}

function createCutawayVisorGeometry(THREE, radius = 0.156, length = 0.24, radialSegments = 36) {
  const geo = new THREE.BufferGeometry();
  const positions = [];
  const normals = [];
  const indices = [];

  const thickness = 0.004;
  const rOuter = radius;
  const rInner = radius - thickness;

  // Generate inner and outer shells with an angled cutaway opening at the bottom
  for (let shell = 0; shell < 2; shell++) {
    const r = shell === 0 ? rOuter : rInner;
    for (let i = 0; i <= radialSegments; i++) {
      // Angle around circle: 0 is right (+X), PI/2 is top (+Y), PI is left (-X), -PI/2 is bottom (-Y)
      const theta = (i / radialSegments) * Math.PI * 2;
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);

      // Cutaway tunnel profile: full length at top/sides, cut back at bottom (-Y)
      let tipFactor = 1.0;
      if (sinT < -0.15) {
        const t = Math.min(1, (-sinT - 0.15) / 0.85);
        tipFactor = 1.0 - 0.78 * (t * t);
      }
      const zFront = -length * tipFactor;

      // Back ring (z = 0)
      positions.push(cosT * r, sinT * r, 0);
      const nSign = shell === 0 ? 1 : -1;
      normals.push(cosT * nSign, sinT * nSign, 0);

      // Front ring (z = zFront)
      // Slight downward taper at the tip for authentic visor hood profile
      const yDrop = sinT > 0 ? -0.008 * tipFactor : 0;
      positions.push(cosT * r, sinT * r + yDrop, zFront);
      normals.push(cosT * nSign, sinT * nSign, 0);
    }
  }

  const stride = (radialSegments + 1) * 2;
  // Outer surface
  for (let i = 0; i < radialSegments; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, b, c, b, d, c);
  }
  // Inner surface
  for (let i = 0; i < radialSegments; i++) {
    const a = stride + i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, b, b, c, d);
  }
  // Front lip stitching
  for (let i = 0; i < radialSegments; i++) {
    const o1 = i * 2 + 1;
    const o2 = (i + 1) * 2 + 1;
    const i1 = stride + i * 2 + 1;
    const i2 = stride + (i + 1) * 2 + 1;
    indices.push(o1, i1, o2, i1, i2, o2);
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function getSharedCache(THREE) {
  if (_cache && _cache.THREE === THREE) return _cache;

  const concreteTex = createConcreteTexture(THREE);
  const galvTex = createGalvanizedTexture(THREE);

  const texRed = createLedLensTexture(THREE, 255, 38, 28);
  const texYellow = createLedLensTexture(THREE, 255, 195, 15);
  const texGreen = createLedLensTexture(THREE, 20, 235, 95);

  const materials = {
    concrete: new THREE.MeshStandardMaterial({
      color: 0xb8b5ae,
      map: concreteTex,
      roughness: 0.92,
      metalness: 0.02,
    }),
    galvanized: new THREE.MeshStandardMaterial({
      color: 0xc8ced4,
      map: galvTex,
      roughness: 0.36,
      metalness: 0.84,
    }),
    darkSteel: new THREE.MeshStandardMaterial({
      color: 0x3b4046,
      roughness: 0.45,
      metalness: 0.78,
    }),
    stainless: new THREE.MeshStandardMaterial({
      color: 0xdce2e8,
      roughness: 0.22,
      metalness: 0.92,
    }),
    blackAnodized: new THREE.MeshStandardMaterial({
      color: 0x16181b,
      roughness: 0.55,
      metalness: 0.25,
    }),
    visorBlack: new THREE.MeshStandardMaterial({
      color: 0x121316,
      roughness: 0.42,
      metalness: 0.15,
    }),
    retroYellow: new THREE.MeshStandardMaterial({
      color: 0xffc800,
      roughness: 0.28,
      metalness: 0.12,
      emissive: 0x332400,
      emissiveIntensity: 0.25,
    }),
    streetSignGreen: new THREE.MeshStandardMaterial({
      color: 0x005c38,
      roughness: 0.32,
      metalness: 0.15,
    }),
    streetSignWhite: new THREE.MeshStandardMaterial({
      color: 0xf2f5f7,
      roughness: 0.28,
      metalness: 0.1,
    }),
    pedHousingYellow: new THREE.MeshStandardMaterial({
      color: 0xf5b400,
      roughness: 0.32,
      metalness: 0.15,
    }),
    pedScreenBlack: new THREE.MeshStandardMaterial({
      color: 0x0d0f12,
      roughness: 0.2,
      metalness: 0.1,
    }),
    pedHandOrange: new THREE.MeshStandardMaterial({
      color: 0xff4500,
      emissive: 0xff3b00,
      emissiveIntensity: 1.8,
      roughness: 0.2,
    }),
    rubberGasket: new THREE.MeshStandardMaterial({
      color: 0x18191c,
      roughness: 0.88,
      metalness: 0.05,
    }),
  };

  const { plateGeo, borderGeo } = createBackplateShapes(THREE);
  const visorGeo = createCutawayVisorGeometry(THREE, 0.155, 0.235, 36);

  // Curved tapered mast arm geometry along +X (from x=0.14 to x=9.15)
  const armSegments = 36;
  const armRadial = 28;
  const armPositions = [];
  const armNormals = [];
  const armUVs = [];
  const armIndices = [];

  const xStart = 0.14;
  const xEnd = 9.15;
  const yStart = 6.10;
  const rStart = 0.125;
  const rEnd = 0.058;

  for (let i = 0; i <= armSegments; i++) {
    const t = i / armSegments;
    const x = xStart + (xEnd - xStart) * t;
    // Slight ~2.1 deg rise with subtle parabolic dead-load camber
    const rise = (x - xStart) * Math.tan((2.15 * Math.PI) / 180) - 0.035 * (t * t);
    const y = yStart + rise;
    const r = rStart + (rEnd - rStart) * t;

    const slope = Math.tan((2.15 * Math.PI) / 180) - (0.07 * t) / (xEnd - xStart);
    const len = Math.sqrt(1 + slope * slope);
    const tx = 1 / len;
    const ty = slope / len;
    const nx = -ty;
    const ny = tx;

    for (let j = 0; j <= armRadial; j++) {
      const phi = (j / armRadial) * Math.PI * 2;
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);

      const vx = x + nx * cosP * r;
      const vy = y + ny * cosP * r;
      const vz = sinP * r;

      armPositions.push(vx, vy, vz);
      armNormals.push(nx * cosP, ny * cosP, sinP);
      armUVs.push(t * 6, j / armRadial);
    }
  }

  for (let i = 0; i < armSegments; i++) {
    for (let j = 0; j < armRadial; j++) {
      const a = i * (armRadial + 1) + j;
      const b = (i + 1) * (armRadial + 1) + j;
      const c = a + 1;
      const d = b + 1;
      armIndices.push(a, b, c, b, d, c);
    }
  }

  const mastArmGeo = new THREE.BufferGeometry();
  mastArmGeo.setAttribute('position', new THREE.Float32BufferAttribute(armPositions, 3));
  mastArmGeo.setAttribute('normal', new THREE.Float32BufferAttribute(armNormals, 3));
  mastArmGeo.setAttribute('uv', new THREE.Float32BufferAttribute(armUVs, 2));
  mastArmGeo.setIndex(armIndices);

  const geometries = {
    foundationMain: new THREE.CylinderGeometry(0.45, 0.45, 0.17, 36),
    foundationBevel: new THREE.CylinderGeometry(0.425, 0.45, 0.03, 36),
    basePlate: new THREE.BoxGeometry(0.48, 0.035, 0.48),
    anchorBolt: new THREE.CylinderGeometry(0.016, 0.016, 0.095, 12),
    hexNut: new THREE.CylinderGeometry(0.028, 0.028, 0.024, 6),
    washer: new THREE.CylinderGeometry(0.036, 0.036, 0.006, 16),
    gusset: new THREE.BoxGeometry(0.08, 0.16, 0.014),
    poleShaft: new THREE.CylinderGeometry(0.115, 0.165, 7.215, 36, 1, false),
    poleCapRim: new THREE.CylinderGeometry(0.124, 0.122, 0.03, 32),
    poleCapDome: new THREE.SphereGeometry(0.122, 28, 12, 0, Math.PI * 2, 0, Math.PI * 0.5),
    handholeRim: new THREE.BoxGeometry(0.16, 0.28, 0.03),
    handholeCover: new THREE.BoxGeometry(0.14, 0.25, 0.015),
    mastCollar: new THREE.CylinderGeometry(0.15, 0.154, 0.46, 32),
    mastFlangePlate: new THREE.BoxGeometry(0.045, 0.48, 0.34),
    mastGusset: new THREE.BoxGeometry(0.22, 0.12, 0.016),
    mastArm: mastArmGeo,
    armEndCap: new THREE.SphereGeometry(0.06, 20, 12),
    upperCollar: new THREE.CylinderGeometry(0.124, 0.126, 0.14, 28),
    trussEar: new THREE.BoxGeometry(0.09, 0.08, 0.024),
    turnbuckleBody: new THREE.CylinderGeometry(0.018, 0.018, 0.22, 12),
    armClampBand: new THREE.CylinderGeometry(0.105, 0.105, 0.075, 24),
    dropPipe: new THREE.CylinderGeometry(0.024, 0.024, 0.52, 16),
    clevisBox: new THREE.BoxGeometry(0.09, 0.09, 0.09),
    lowerArmBar: new THREE.CylinderGeometry(0.018, 0.018, 0.14, 12),
    signalSectionBox: new THREE.BoxGeometry(0.355, 0.355, 0.22),
    signalDoorBezel: new THREE.BoxGeometry(0.362, 0.362, 0.028),
    lensRingGasket: new THREE.TorusGeometry(0.152, 0.009, 12, 36),
    lensDisc: new THREE.SphereGeometry(0.148, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.24),
    visor: visorGeo,
    backplate: plateGeo,
    backplateBorder: borderGeo,
    louverSlot: new THREE.BoxGeometry(0.036, 0.12, 0.008),
    signBoard: new THREE.BoxGeometry(1.62, 0.32, 0.016),
    signBorderH: new THREE.BoxGeometry(1.58, 0.018, 0.018),
    signBorderV: new THREE.BoxGeometry(0.018, 0.28, 0.018),
    signChannel: new THREE.BoxGeometry(1.40, 0.04, 0.035),
    signUClamp: new THREE.CylinderGeometry(0.112, 0.112, 0.05, 24),
    pedBox: new THREE.BoxGeometry(0.38, 0.44, 0.22),
    pedVisor: new THREE.BoxGeometry(0.39, 0.45, 0.14),
    pedScreen: new THREE.PlaneGeometry(0.32, 0.38),
    pedArmPipe: new THREE.CylinderGeometry(0.02, 0.02, 0.22, 12),
    pushButtonBox: new THREE.BoxGeometry(0.13, 0.23, 0.10),
    pushButtonSign: new THREE.BoxGeometry(0.14, 0.20, 0.006),
    pushButtonPlunger: new THREE.CylinderGeometry(0.024, 0.024, 0.02, 16),
  };

  _cache = {
    THREE,
    materials,
    geometries,
    textures: { texRed, texYellow, texGreen },
  };
  return _cache;
}

function setShadow(obj, cast = true, receive = true) {
  obj.castShadow = cast;
  obj.receiveShadow = receive;
  return obj;
}

function getArmCenterY(x) {
  const xStart = 0.14;
  const xEnd = 9.15;
  const yStart = 6.10;
  const t = Math.max(0, Math.min(1, (x - xStart) / (xEnd - xStart)));
  return yStart + (x - xStart) * Math.tan((2.15 * Math.PI) / 180) - 0.035 * (t * t);
}

function getArmRadius(x) {
  const xStart = 0.14;
  const xEnd = 9.15;
  const rStart = 0.125;
  const rEnd = 0.058;
  const t = Math.max(0, Math.min(1, (x - xStart) / (xEnd - xStart)));
  return rStart + (rEnd - rStart) * t;
}

function buildSignalHead(THREE, cache, housingMat, xPos) {
  const { geometries, materials, textures } = cache;
  const headGroup = new THREE.Group();
  headGroup.name = `signal_head_${xPos.toFixed(1)}`;

  const armY = getArmCenterY(xPos);
  const armR = getArmRadius(xPos);

  // Position head center so bottom of backplate is >= 5.05 m above grade
  const headCenterY = armY - 0.56;
  headGroup.position.set(xPos, headCenterY, 0);

  // Astro-Brac / Pelco rigid mount clamp on mast arm
  const clampY = armY - headCenterY;
  const clampBand = setShadow(new THREE.Mesh(geometries.armClampBand, materials.galvanized));
  clampBand.scale.set(armR / 0.105, 1, armR / 0.105);
  clampBand.rotation.z = Math.PI / 2;
  clampBand.position.set(0, clampY, 0);
  headGroup.add(clampBand);

  const clevis = setShadow(new THREE.Mesh(geometries.clevisBox, materials.darkSteel));
  clevis.position.set(0, clampY, -armR - 0.035);
  headGroup.add(clevis);

  // Vertical rigid drop tube behind backplate
  const dropPipe = setShadow(new THREE.Mesh(geometries.dropPipe, materials.galvanized));
  dropPipe.position.set(0, clampY - 0.22, -0.02);
  headGroup.add(dropPipe);

  // Top & bottom horizontal support arms into signal housing
  for (const sy of [0.54, -0.54]) {
    const bar = setShadow(new THREE.Mesh(geometries.lowerArmBar, materials.darkSteel));
    bar.rotation.x = Math.PI / 2;
    bar.position.set(0, sy, -0.08);
    headGroup.add(bar);
  }

  // Louvered flat black backplate with 50mm retroreflective yellow border
  const backplateZ = -0.11;
  const plateMesh = setShadow(new THREE.Mesh(geometries.backplate, materials.blackAnodized));
  plateMesh.rotation.y = Math.PI; // face -Z
  plateMesh.position.set(0, 0, backplateZ);
  headGroup.add(plateMesh);

  const plateBackMesh = setShadow(new THREE.Mesh(geometries.backplate, materials.blackAnodized));
  plateBackMesh.position.set(0, 0, backplateZ + 0.004);
  headGroup.add(plateBackMesh);

  const borderFront = setShadow(new THREE.Mesh(geometries.backplateBorder, materials.retroYellow));
  borderFront.rotation.y = Math.PI;
  borderFront.position.set(0, 0, backplateZ - 0.002);
  headGroup.add(borderFront);

  // Subtle ventilation louver bars along left/right backplate margins
  for (const lx of [-0.21, 0.21]) {
    for (const ly of [-0.36, 0, 0.36]) {
      const louver = setShadow(new THREE.Mesh(geometries.louverSlot, materials.visorBlack));
      louver.position.set(lx, ly, backplateZ);
      headGroup.add(louver);
    }
  }

  // Three signal sections: Top = Red (+0.36m), Middle = Yellow (0m), Bottom = Green (-0.36m)
  const sectionSpecs = [
    { key: 'red', y: 0.36, tex: textures.texRed, onColor: 0xff2211, offColor: 0x3b0806, onEmissive: 0xff1e08 },
    { key: 'yellow', y: 0.0, tex: textures.texYellow, onColor: 0xffbe00, offColor: 0x3d2a02, onEmissive: 0xffaa00 },
    { key: 'green', y: -0.36, tex: textures.texGreen, onColor: 0x10ee68, offColor: 0x05331a, onEmissive: 0x08dd58 },
  ];

  const lenses = {};

  for (const spec of sectionSpecs) {
    const secGroup = new THREE.Group();
    secGroup.position.set(0, spec.y, -0.14);

    // Main polycarbonate section box
    const box = setShadow(new THREE.Mesh(geometries.signalSectionBox, housingMat));
    secGroup.add(box);

    // Front door bezel
    const door = setShadow(new THREE.Mesh(geometries.signalDoorBezel, housingMat));
    door.position.set(0, 0, -0.115);
    secGroup.add(door);

    // Hinge & wing-nut latches on the door
    const gasket = setShadow(new THREE.Mesh(geometries.lensRingGasket, materials.rubberGasket));
    gasket.position.set(0, 0, -0.128);
    secGroup.add(gasket);

    // 300mm (12-inch) convex LED lens facing -Z
    const lensMat = new THREE.MeshStandardMaterial({
      color: spec.offColor,
      map: spec.tex,
      roughness: 0.14,
      metalness: 0.08,
      emissive: spec.onEmissive,
      emissiveMap: spec.tex,
      emissiveIntensity: 0,
    });

    const lensMesh = setShadow(new THREE.Mesh(geometries.lensDisc, lensMat), false, true);
    lensMesh.rotation.x = -Math.PI / 2; // dome bulges toward -Z
    lensMesh.position.set(0, 0, -0.02);
    secGroup.add(lensMesh);

    // Deep cutaway tunnel visor over the lens
    const visorMesh = setShadow(new THREE.Mesh(geometries.visor, materials.visorBlack));
    visorMesh.position.set(0, 0, -0.128);
    secGroup.add(visorMesh);

    headGroup.add(secGroup);
    lenses[spec.key] = { mesh: lensMesh, mat: lensMat, spec };
  }

  headGroup.userData.lenses = lenses;
  return headGroup;
}

export default function create(THREE, opts = {}) {
  const cache = getSharedCache(THREE);
  const { geometries, materials } = cache;

  const group = new THREE.Group();
  group.name = opts.id ?? 'signal_mast';

  // Housing color (defaults to classic federal highway yellow polycarbonate)
  const housingColor = new THREE.Color(opts.color ?? '#f2b200');
  const housingMat = new THREE.MeshPhysicalMaterial({
    color: housingColor,
    roughness: 0.28,
    metalness: 0.12,
    clearcoat: 0.45,
    clearcoatRoughness: 0.2,
  });

  // 1. Concrete Foundation Pier (0.90m diameter, 0.20m above grade, centered at x=0, z=0)
  const foundationGroup = new THREE.Group();
  foundationGroup.name = 'foundation';

  const fndMain = setShadow(new THREE.Mesh(geometries.foundationMain, materials.concrete));
  fndMain.position.set(0, 0.085, 0);
  foundationGroup.add(fndMain);

  const fndBevel = setShadow(new THREE.Mesh(geometries.foundationBevel, materials.concrete));
  fndBevel.position.set(0, 0.185, 0);
  foundationGroup.add(fndBevel);

  // Galvanized Square Anchor Base Plate (y = 0.20 to 0.235)
  const basePlate = setShadow(new THREE.Mesh(geometries.basePlate, materials.galvanized));
  basePlate.position.set(0, 0.2175, 0);
  foundationGroup.add(basePlate);

  // 6 Anchor Bolts with Heavy Hex Nuts, Washers, and Stiffener Gussets
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const rBolt = 0.205;
    const bx = Math.cos(angle) * rBolt;
    const bz = Math.sin(angle) * rBolt;

    const bolt = setShadow(new THREE.Mesh(geometries.anchorBolt, materials.galvanized));
    bolt.position.set(bx, 0.24, bz);
    foundationGroup.add(bolt);

    const washer = setShadow(new THREE.Mesh(geometries.washer, materials.stainless));
    washer.position.set(bx, 0.238, bz);
    foundationGroup.add(washer);

    const nut = setShadow(new THREE.Mesh(geometries.hexNut, materials.stainless));
    nut.position.set(bx, 0.253, bz);
    foundationGroup.add(nut);

    const gusset = setShadow(new THREE.Mesh(geometries.gusset, materials.galvanized));
    const rGusset = 0.165;
    gusset.position.set(Math.cos(angle) * rGusset, 0.315, Math.sin(angle) * rGusset);
    gusset.rotation.y = -angle;
    foundationGroup.add(gusset);
  }
  group.add(foundationGroup);

  // 2. Tapered Galvanized Steel Pole (0.33m base dia -> 0.23m top dia, top at y = 7.50m)
  const poleGroup = new THREE.Group();
  poleGroup.name = 'vertical_pole';

  const poleShaft = setShadow(new THREE.Mesh(geometries.poleShaft, materials.galvanized));
  poleShaft.position.set(0, 0.235 + 7.215 / 2, 0);
  poleGroup.add(poleShaft);

  const poleCapRim = setShadow(new THREE.Mesh(geometries.poleCapRim, materials.galvanized));
  poleCapRim.position.set(0, 7.45, 0);
  poleGroup.add(poleCapRim);

  const poleCapDome = setShadow(new THREE.Mesh(geometries.poleCapDome, materials.galvanized));
  poleCapDome.scale.set(1, 0.42, 1);
  poleCapDome.position.set(0, 7.448, 0);
  poleGroup.add(poleCapDome);

  // Reinforced Electrical Handhole near Pole Base (at y = 0.68m, facing +Z away from traffic)
  const handholeRim = setShadow(new THREE.Mesh(geometries.handholeRim, materials.galvanized));
  handholeRim.position.set(0, 0.68, 0.155);
  poleGroup.add(handholeRim);

  const handholeCover = setShadow(new THREE.Mesh(geometries.handholeCover, materials.darkSteel));
  handholeCover.position.set(0, 0.68, 0.166);
  poleGroup.add(handholeCover);

  group.add(poleGroup);

  // 3. Mast Arm Assembly (Attached at y = 6.10m, reaching +X to 9.15m with upper truss rod)
  const armGroup = new THREE.Group();
  armGroup.name = 'mast_arm_assembly';

  // Clamp/Flange Box at y = 6.10m
  const mastCollar = setShadow(new THREE.Mesh(geometries.mastCollar, materials.galvanized));
  mastCollar.position.set(0, 6.10, 0);
  armGroup.add(mastCollar);

  const flangeA = setShadow(new THREE.Mesh(geometries.mastFlangePlate, materials.galvanized));
  flangeA.position.set(0.165, 6.10, 0);
  armGroup.add(flangeA);

  const flangeB = setShadow(new THREE.Mesh(geometries.mastFlangePlate, materials.galvanized));
  flangeB.position.set(0.215, 6.10, 0);
  armGroup.add(flangeB);

  for (const gy of [6.28, 5.92]) {
    for (const gz of [-0.11, 0.11]) {
      const gusset = setShadow(new THREE.Mesh(geometries.mastGusset, materials.galvanized));
      gusset.position.set(0.28, gy, gz);
      armGroup.add(gusset);
    }
  }

  // Main 9.0m Tapered Mast Arm Tube
  const mastArmMesh = setShadow(new THREE.Mesh(geometries.mastArm, materials.galvanized));
  armGroup.add(mastArmMesh);

  // Mast Arm Tip Cap at x = 9.15m
  const tipY = getArmCenterY(9.15);
  const armEndCap = setShadow(new THREE.Mesh(geometries.armEndCap, materials.galvanized));
  armEndCap.position.set(9.15, tipY, 0);
  armGroup.add(armEndCap);

  // Upper Truss/Tie Rod Assembly (from pole collar at y=7.22m to mast arm clamp at x=5.95m)
  const upperCollar = setShadow(new THREE.Mesh(geometries.upperCollar, materials.galvanized));
  upperCollar.position.set(0, 7.22, 0);
  armGroup.add(upperCollar);

  const trussEarPole = setShadow(new THREE.Mesh(geometries.trussEar, materials.darkSteel));
  trussEarPole.position.set(0.14, 7.22, 0);
  armGroup.add(trussEarPole);

  const anchorX = 5.95;
  const anchorY = getArmCenterY(anchorX) + getArmRadius(anchorX) + 0.02;
  const anchorClamp = setShadow(new THREE.Mesh(geometries.armClampBand, materials.galvanized));
  const anchorR = getArmRadius(anchorX);
  anchorClamp.scale.set(anchorR / 0.105, 1, anchorR / 0.105);
  anchorClamp.rotation.z = Math.PI / 2;
  anchorClamp.position.set(anchorX, getArmCenterY(anchorX), 0);
  armGroup.add(anchorClamp);

  const pStart = new THREE.Vector3(0.17, 7.22, 0);
  const pEnd = new THREE.Vector3(anchorX, anchorY, 0);
  const rodVec = new THREE.Vector3().subVectors(pEnd, pStart);
  const rodLen = rodVec.length();
  const rodMid = new THREE.Vector3().addVectors(pStart, pEnd).multiplyScalar(0.5);

  const tieRodGeo = new THREE.CylinderGeometry(0.0085, 0.0085, rodLen, 10);
  const tieRod = setShadow(new THREE.Mesh(tieRodGeo, materials.stainless));
  tieRod.position.copy(rodMid);
  tieRod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), rodVec.clone().normalize());
  armGroup.add(tieRod);

  // Turnbuckle near pole end of tie rod
  const tbPos = new THREE.Vector3().lerpVectors(pStart, pEnd, 0.15);
  const turnbuckle = setShadow(new THREE.Mesh(geometries.turnbuckleBody, materials.darkSteel));
  turnbuckle.position.copy(tbPos);
  turnbuckle.quaternion.copy(tieRod.quaternion);
  armGroup.add(turnbuckle);

  group.add(armGroup);

  // 4. Blank MUTCD Street-Name Blade Sign (near x = 3.5m, facing -Z and +Z)
  const signX = 3.50;
  const signY = getArmCenterY(signX);
  const signR = getArmRadius(signX);
  const signGroup = new THREE.Group();
  signGroup.name = 'street_name_sign';
  signGroup.position.set(signX, signY, 0);

  for (const cx of [-0.52, 0.52]) {
    const uClamp = setShadow(new THREE.Mesh(geometries.signUClamp, materials.galvanized));
    uClamp.scale.set(signR / 0.112, 1, signR / 0.112);
    uClamp.rotation.z = Math.PI / 2;
    uClamp.position.set(cx, 0, 0);
    signGroup.add(uClamp);
  }

  const signChannel = setShadow(new THREE.Mesh(geometries.signChannel, materials.galvanized));
  signChannel.position.set(0, -0.02, -signR - 0.022);
  signGroup.add(signChannel);

  const signBoard = setShadow(new THREE.Mesh(geometries.signBoard, materials.streetSignGreen));
  signBoard.position.set(0, -0.04, -signR - 0.045);
  signGroup.add(signBoard);

  // Retroreflective white border strips (top, bottom, left, right)
  for (const by of [0.14, -0.14]) {
    const borderH = setShadow(new THREE.Mesh(geometries.signBorderH, materials.streetSignWhite));
    borderH.position.set(0, -0.04 + by, -signR - 0.045);
    signGroup.add(borderH);
  }
  for (const bx of [-0.78, 0.78]) {
    const borderV = setShadow(new THREE.Mesh(geometries.signBorderV, materials.streetSignWhite));
    borderV.position.set(bx, -0.04, -signR - 0.045);
    signGroup.add(borderV);
  }
  group.add(signGroup);

  // 5. Pedestrian Signal Head (y = 2.45m) & Push-Button Station (y = 1.10m) on Pole
  const pedGroup = new THREE.Group();
  pedGroup.name = 'pedestrian_equipment';

  // Clamshell mounting arms on -X side of pole for pedestrian signal head
  for (const py of [2.60, 2.30]) {
    const pedPipe = setShadow(new THREE.Mesh(geometries.pedArmPipe, materials.galvanized));
    pedPipe.rotation.z = Math.PI / 2;
    pedPipe.position.set(-0.20, py, 0);
    pedGroup.add(pedPipe);
  }

  const pedBox = setShadow(new THREE.Mesh(geometries.pedBox, materials.pedHousingYellow));
  pedBox.position.set(-0.25, 2.45, -0.04);
  pedGroup.add(pedBox);

  const pedVisor = setShadow(new THREE.Mesh(geometries.pedVisor, materials.visorBlack));
  pedVisor.position.set(-0.25, 2.45, -0.16);
  pedGroup.add(pedVisor);

  const pedScreen = setShadow(new THREE.Mesh(geometries.pedScreen, materials.pedScreenBlack));
  pedScreen.rotation.y = Math.PI;
  pedScreen.position.set(-0.25, 2.45, -0.152);
  pedGroup.add(pedScreen);

  // Glowing "DON'T WALK" orange hand silhouette bar inside pedestrian signal
  const handIconGeo = new THREE.BoxGeometry(0.085, 0.14, 0.006);
  const handIcon = setShadow(new THREE.Mesh(handIconGeo, materials.pedHandOrange), false, false);
  handIcon.position.set(-0.31, 2.45, -0.154);
  pedGroup.add(handIcon);

  // ADA Pedestrian Push-Button Station at y = 1.10m facing -Z
  const pbBox = setShadow(new THREE.Mesh(geometries.pushButtonBox, materials.pedHousingYellow));
  pbBox.position.set(0, 1.10, -0.19);
  pedGroup.add(pbBox);

  const pbSign = setShadow(new THREE.Mesh(geometries.pushButtonSign, materials.streetSignWhite));
  pbSign.position.set(0, 1.25, -0.238);
  pedGroup.add(pbSign);

  const pbPlunger = setShadow(new THREE.Mesh(geometries.pushButtonPlunger, materials.stainless));
  pbPlunger.rotation.x = Math.PI / 2;
  pbPlunger.position.set(0, 1.07, -0.245);
  pedGroup.add(pbPlunger);

  group.add(pedGroup);

  // 6. Two 3-Section Vehicle Signal Heads at x = 5.40m and x = 8.50m
  const headPositions = [5.40, 8.50];
  const heads = [];
  for (const xPos of headPositions) {
    const head = buildSignalHead(THREE, cache, housingMat, xPos);
    group.add(head);
    heads.push(head);
  }

  // State controller: 'red' | 'yellow' | 'green' | 'off'
  function setState(state = 'red') {
    const normalized = String(state).toLowerCase();
    group.userData.state = normalized;

    for (const head of heads) {
      const lenses = head.userData.lenses;
      if (!lenses) continue;

      for (const key of ['red', 'yellow', 'green']) {
        const entry = lenses[key];
        if (!entry) continue;
        const isActive = key === normalized;

        if (isActive) {
          entry.mat.color.setHex(entry.spec.onColor);
          entry.mat.emissive.setHex(entry.spec.onEmissive);
          entry.mat.emissiveIntensity = 4.2;
        } else {
          entry.mat.color.setHex(entry.spec.offColor);
          entry.mat.emissive.setHex(entry.spec.onEmissive);
          entry.mat.emissiveIntensity = 0.04;
        }
        entry.mat.needsUpdate = true;
      }
    }
  }

  // Initialize default state ('red' unless specified in opts.state)
  setState(opts.state ?? 'red');

  group.userData.assetType = 'signal';
  group.userData.dims = { length: 0.9, width: 9.6, height: 7.5 };
  group.userData.heads = heads;
  group.userData.setState = setState;

  return group;
}
