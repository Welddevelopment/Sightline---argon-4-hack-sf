let _cachedTextures = null;

function getTextures(THREE) {
  if (_cachedTextures) return _cachedTextures;
  _cachedTextures = {};

  if (typeof document !== 'undefined') {
    // 1. Concrete Forecourt Pad Texture (with saw-cut expansion joints and subtle tire/oil wear)
    const padCanvas = document.createElement('canvas');
    padCanvas.width = 1024;
    padCanvas.height = 512;
    const pctx = padCanvas.getContext('2d');
    pctx.fillStyle = '#b6b9be';
    pctx.fillRect(0, 0, 1024, 512);

    // Deterministic aggregate grain
    let seed = 1337;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < 24000; i++) {
      const x = rand() * 1024;
      const y = rand() * 512;
      const v = Math.floor(165 + rand() * 35);
      pctx.fillStyle = `rgb(${v},${v},${v + 2})`;
      pctx.fillRect(x, y, 2, 2);
    }

    // Subtle oil stains / tire drive lane darkening
    const laneYs = [95, 256, 417];
    for (const ly of laneYs) {
      const grad = pctx.createLinearGradient(0, ly - 55, 0, ly + 55);
      grad.addColorStop(0, 'rgba(50,52,55,0)');
      grad.addColorStop(0.5, 'rgba(50,52,55,0.12)');
      grad.addColorStop(1, 'rgba(50,52,55,0)');
      pctx.fillStyle = grad;
      pctx.fillRect(0, ly - 55, 1024, 110);
    }

    // Saw-cut joints grid (12x6 panels over 24x12m -> 2m x 2m squares)
    pctx.strokeStyle = '#7c8085';
    pctx.lineWidth = 2;
    for (let ix = 1; ix < 12; ix++) {
      const x = (ix / 12) * 1024;
      pctx.beginPath();
      pctx.moveTo(x, 0);
      pctx.lineTo(x, 512);
      pctx.stroke();
    }
    for (let iz = 1; iz < 6; iz++) {
      const y = (iz / 6) * 512;
      pctx.beginPath();
      pctx.moveTo(0, y);
      pctx.lineTo(1024, y);
      pctx.stroke();
    }

    const padTex = new THREE.CanvasTexture(padCanvas);
    padTex.colorSpace = THREE.SRGBColorSpace;
    _cachedTextures.pad = padTex;

    // 2. Soffit Planks Texture
    const sofCanvas = document.createElement('canvas');
    sofCanvas.width = 512;
    sofCanvas.height = 512;
    const sctx = sofCanvas.getContext('2d');
    sctx.fillStyle = '#eceef0';
    sctx.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 16) {
      sctx.fillStyle = '#cfd4d8';
      sctx.fillRect(0, y, 512, 2);
      sctx.fillStyle = '#f7f9fa';
      sctx.fillRect(0, y + 2, 512, 2);
    }
    for (let x = 0; x < 512; x += 128) {
      sctx.fillStyle = '#b8bec4';
      sctx.fillRect(x, 0, 2, 512);
    }
    const sofTex = new THREE.CanvasTexture(sofCanvas);
    sofTex.colorSpace = THREE.SRGBColorSpace;
    sofTex.wrapS = THREE.RepeatWrapping;
    sofTex.wrapT = THREE.RepeatWrapping;
    sofTex.repeat.set(8, 4);
    _cachedTextures.soffit = sofTex;

    // 3. Dispenser UI Panel Texture (price readout, octane buttons, card reader, instructions)
    const uiCanvas = document.createElement('canvas');
    uiCanvas.width = 512;
    uiCanvas.height = 256;
    const uctx = uiCanvas.getContext('2d');
    uctx.fillStyle = '#1e2229';
    uctx.fillRect(0, 0, 512, 256);

    // Metallic bezel frame
    uctx.strokeStyle = '#68707a';
    uctx.lineWidth = 6;
    uctx.strokeRect(6, 6, 500, 244);

    // Top main digital LCD screen (Sale $ and Gallons)
    uctx.fillStyle = '#0d1a14';
    uctx.fillRect(140, 22, 232, 86);
    uctx.strokeStyle = '#404852';
    uctx.lineWidth = 3;
    uctx.strokeRect(140, 22, 232, 86);

    // Segmented LCD bars (strictly geometric bars, no text/fonts)
    uctx.fillStyle = '#66ffaa';
    const drawDigitBars = (bx, by, w, h) => {
      uctx.fillRect(bx, by, w, 3);
      uctx.fillRect(bx, by + h / 2 - 1.5, w, 3);
      uctx.fillRect(bx, by + h - 3, w, 3);
      uctx.fillRect(bx, by, 3, h);
      uctx.fillRect(bx + w - 3, by, 3, h);
    };
    for (let d = 0; d < 4; d++) {
      drawDigitBars(175 + d * 36, 32, 22, 28);
      drawDigitBars(195 + d * 32, 70, 18, 24);
    }
    // Decimal dots
    uctx.fillRect(241, 56, 4, 4);
    uctx.fillRect(254, 90, 4, 4);

    // Card Reader / Keypad on right
    uctx.fillStyle = '#2c323b';
    uctx.fillRect(390, 22, 98, 128);
    // Small payment screen
    uctx.fillStyle = '#1a3850';
    uctx.fillRect(400, 30, 78, 38);
    uctx.fillStyle = '#70b8ff';
    uctx.fillRect(410, 42, 58, 6);
    uctx.fillRect(418, 54, 42, 4);
    // Card slot
    uctx.fillStyle = '#090b0e';
    uctx.fillRect(402, 76, 48, 8);
    uctx.fillStyle = '#28c76f';
    uctx.fillRect(458, 76, 16, 8);
    // Keypad 3x4 grid
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        uctx.fillStyle = r === 3 && c === 0 ? '#d9383a' : (r === 3 && c === 2 ? '#28c76f' : '#adb5bd');
        uctx.fillRect(404 + c * 25, 92 + r * 13, 20, 9);
      }
    }

    // Left Instruction / Warning graphic blocks
    uctx.fillStyle = '#2c323b';
    uctx.fillRect(24, 22, 98, 128);
    uctx.fillStyle = '#d9534f';
    uctx.fillRect(32, 30, 82, 16);
    uctx.fillStyle = '#d0d5dd';
    for (let l = 0; l < 6; l++) {
      uctx.fillRect(32, 56 + l * 14, 78 - (l % 2) * 18, 6);
    }

    // 4 Octane Grade Selector Buttons at bottom (87, 89, 93, Diesel)
    const gradeColors = ['#e5b822', '#e58822', '#d9383a', '#2b9e44'];
    for (let g = 0; g < 4; g++) {
      const gx = 42 + g * 112;
      const gy = 166;
      // Price mini-LCD
      uctx.fillStyle = '#0e1712';
      uctx.fillRect(gx, gy, 92, 22);
      uctx.fillStyle = '#f59f00';
      for (let k = 0; k < 3; k++) {
        uctx.fillRect(gx + 16 + k * 22, gy + 5, 14, 12);
      }
      // Grade push button
      uctx.fillStyle = gradeColors[g];
      uctx.fillRect(gx, gy + 26, 92, 48);
      uctx.fillStyle = 'rgba(255,255,255,0.85)';
      uctx.fillRect(gx + 14, gy + 34, 64, 16);
      uctx.fillStyle = 'rgba(0,0,0,0.25)';
      uctx.fillRect(gx + 22, gy + 56, 48, 10);
    }

    const uiTex = new THREE.CanvasTexture(uiCanvas);
    uiTex.colorSpace = THREE.SRGBColorSpace;
    _cachedTextures.pumpUI = uiTex;
  }

  return _cachedTextures;
}

function createRoundedRectShape(THREE, width, depth, radius) {
  const shape = new THREE.Shape();
  const hw = width / 2;
  const hd = depth / 2;
  const r = Math.min(radius, hw, hd);

  shape.moveTo(-hw + r, -hd);
  shape.lineTo(hw - r, -hd);
  shape.absarc(hw - r, -hd + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(hw, hd - r);
  shape.absarc(hw - r, hd - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-hw + r, hd);
  shape.absarc(-hw + r, hd - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-hw, -hd + r);
  shape.absarc(-hw + r, -hd + r, r, Math.PI, Math.PI * 1.5, false);
  return shape;
}

function createRingExtrudeGeometry(THREE, outerW, outerD, outerR, thickness, height, bevel = 0.01) {
  const outerShape = createRoundedRectShape(THREE, outerW, outerD, outerR);
  const innerHole = createRoundedRectShape(
    THREE,
    outerW - thickness * 2,
    outerD - thickness * 2,
    Math.max(0.02, outerR - thickness)
  );
  outerShape.holes.push(innerHole);

  const geo = new THREE.ExtrudeGeometry(outerShape, {
    depth: height,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 16
  });
  geo.rotateX(-Math.PI / 2); // Extrude along +Y
  return geo;
}

function createSolidRoundedSlabGeometry(THREE, width, depth, radius, height, bevel = 0.01) {
  const shape = createRoundedRectShape(THREE, width, depth, radius);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 16
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export default function create(THREE, opts = {}) {
  const group = new THREE.Group();
  group.name = opts.id ?? 'gas_station_canopy';

  const accentColorHex = opts.color ?? '#0056b3'; // Classic forecourt royal blue accent
  const accentColor = new THREE.Color(accentColorHex);
  const textures = getTextures(THREE);

  // Materials
  const matConcretePad = new THREE.MeshStandardMaterial({
    color: textures.pad ? 0xffffff : 0xb6b9be,
    map: textures.pad || null,
    roughness: 0.88,
    metalness: 0.05
  });

  const matIslandConcrete = new THREE.MeshStandardMaterial({
    color: 0xc8ccd0,
    roughness: 0.82,
    metalness: 0.05
  });

  const matSafetyYellow = new THREE.MeshStandardMaterial({
    color: 0xf2b705,
    roughness: 0.42,
    metalness: 0.15
  });

  const matFasciaWhite = new THREE.MeshPhysicalMaterial({
    color: 0xf4f6f8,
    roughness: 0.22,
    metalness: 0.12,
    clearcoat: 0.6,
    clearcoatRoughness: 0.15
  });

  const matFasciaAccent = new THREE.MeshPhysicalMaterial({
    color: accentColor,
    roughness: 0.2,
    metalness: 0.25,
    clearcoat: 0.85,
    clearcoatRoughness: 0.1
  });

  const matSoffit = new THREE.MeshStandardMaterial({
    color: textures.soffit ? 0xffffff : 0xeceef0,
    map: textures.soffit || null,
    roughness: 0.45,
    metalness: 0.2
  });

  const matDarkTrim = new THREE.MeshStandardMaterial({
    color: 0x262a30,
    roughness: 0.5,
    metalness: 0.6
  });

  const matBrushedAlum = new THREE.MeshStandardMaterial({
    color: 0xd0d5dd,
    roughness: 0.32,
    metalness: 0.82
  });

  const matChrome = new THREE.MeshStandardMaterial({
    color: 0xf0f4f8,
    roughness: 0.12,
    metalness: 0.95
  });

  const matGalvSteel = new THREE.MeshStandardMaterial({
    color: 0x9aa1a9,
    roughness: 0.48,
    metalness: 0.7
  });

  const matRubberHose = new THREE.MeshStandardMaterial({
    color: 0x15171a,
    roughness: 0.88,
    metalness: 0.05
  });

  const matPumpUI = new THREE.MeshStandardMaterial({
    color: textures.pumpUI ? 0xffffff : 0x22262c,
    map: textures.pumpUI || null,
    roughness: 0.25,
    metalness: 0.1,
    emissive: new THREE.Color(0x223028),
    emissiveMap: textures.pumpUI || null,
    emissiveIntensity: 0.35
  });

  const matLedLens = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(0xf4f8ff),
    emissiveIntensity: 2.2,
    roughness: 0.15,
    metalness: 0.05
  });

  const matAccentLed = new THREE.MeshStandardMaterial({
    color: accentColor.clone().lerp(new THREE.Color(0xffffff), 0.5),
    emissive: accentColor,
    emissiveIntensity: 1.4,
    roughness: 0.2,
    metalness: 0.1
  });

  const matDieselGreen = new THREE.MeshStandardMaterial({
    color: 0x1f8b3a,
    roughness: 0.35,
    metalness: 0.1
  });

  const matNozzleRed = new THREE.MeshStandardMaterial({
    color: 0xc92a2a,
    roughness: 0.35,
    metalness: 0.1
  });

  // ============================================================================
  // 1. FORECOURT CONCRETE PAD (24.0 m x 12.0 m x 0.02 m)
  // ============================================================================
  const padGeo = new THREE.BoxGeometry(24.0, 0.02, 12.0);
  const padMesh = new THREE.Mesh(padGeo, matConcretePad);
  padMesh.position.set(0, 0.01, 0);
  padMesh.castShadow = false;
  padMesh.receiveShadow = true;
  group.add(padMesh);

  // Subterranean tank monitoring / fill manhole covers on pad corner
  const manholeGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.008, 24);
  const manholeRingGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.005, 24);
  const fillColors = [0xd9383a, 0x1e60b5, 0xf2b705, 0x2b9e44];
  for (let i = 0; i < 4; i++) {
    const mx = 9.2 + (i % 2) * 1.1;
    const mz = -4.5 + Math.floor(i / 2) * 1.1;
    const ring = new THREE.Mesh(manholeRingGeo, matDarkTrim);
    ring.position.set(mx, 0.022, mz);
    group.add(ring);

    const lidMat = new THREE.MeshStandardMaterial({
      color: fillColors[i],
      roughness: 0.6,
      metalness: 0.4
    });
    const lid = new THREE.Mesh(manholeGeo, lidMat);
    lid.position.set(mx, 0.024, mz);
    group.add(lid);
  }

  // ============================================================================
  // 2. CANOPY OVERHEAD STRUCTURE (24.0 m W x 12.0 m D, clearance 4.6 m, top 5.6 m)
  // ============================================================================
  const canopyGroup = new THREE.Group();
  canopyGroup.name = 'canopy_structure';
  group.add(canopyGroup);

  const canopyW = 23.96; // With 0.02m bevels -> exact 24.00m
  const canopyD = 11.96; // With 0.02m bevels -> exact 12.00m
  const cornerR = 0.60;

  // Main continuous ACM fascia band (Y = 4.62 to 5.56)
  const fasciaRingGeo = createRingExtrudeGeometry(THREE, canopyW, canopyD, cornerR, 0.18, 0.94, 0.015);
  const fasciaMesh = new THREE.Mesh(fasciaRingGeo, matFasciaWhite);
  fasciaMesh.position.y = 4.62;
  canopyGroup.add(fasciaMesh);

  // Bottom dark drip edge trim (Y = 4.60 to 4.625)
  const dripRingGeo = createRingExtrudeGeometry(THREE, canopyW - 0.02, canopyD - 0.02, cornerR, 0.20, 0.025, 0.005);
  const dripMesh = new THREE.Mesh(dripRingGeo, matDarkTrim);
  dripMesh.position.y = 4.60;
  canopyGroup.add(dripMesh);

  // Top parapet coping cap (Y = 5.565 to 5.595 -> top at 5.60m with bevel)
  const capRingGeo = createRingExtrudeGeometry(THREE, canopyW + 0.01, canopyD + 0.01, cornerR, 0.22, 0.03, 0.005);
  const capMesh = new THREE.Mesh(capRingGeo, matBrushedAlum);
  capMesh.position.y = 5.565;
  canopyGroup.add(capMesh);

  // Colored horizontal accent band around fascia (Y = 4.94 to 5.26)
  const accentRingGeo = createRingExtrudeGeometry(THREE, canopyW + 0.02, canopyD + 0.02, cornerR + 0.01, 0.04, 0.30, 0.01);
  const accentMesh = new THREE.Mesh(accentRingGeo, matFasciaAccent);
  accentMesh.position.y = 4.95;
  canopyGroup.add(accentMesh);

  // Crisp illuminated LED accent pinstripe along bottom of colored stripe (Y = 4.89 to 4.93)
  const ledStripGeo = createRingExtrudeGeometry(THREE, canopyW + 0.025, canopyD + 0.025, cornerR + 0.012, 0.03, 0.04, 0.005);
  const ledStripMesh = new THREE.Mesh(ledStripGeo, matAccentLed);
  ledStripMesh.position.y = 4.89;
  ledStripMesh.castShadow = false;
  canopyGroup.add(ledStripMesh);

  // Vertical ACM panel joint battens along X and Z faces
  const seamGeoZ = new THREE.BoxGeometry(0.015, 0.93, 0.02);
  for (let x = -10.5; x <= 10.5; x += 1.5) {
    for (const s of [-1, 1]) {
      const seam = new THREE.Mesh(seamGeoZ, matDarkTrim);
      seam.position.set(x, 5.09, s * (canopyD / 2 + 0.008));
      canopyGroup.add(seam);
    }
  }
  const seamGeoX = new THREE.BoxGeometry(0.02, 0.93, 0.015);
  for (let z = -4.5; z <= 4.5; z += 1.5) {
    for (const s of [-1, 1]) {
      const seam = new THREE.Mesh(seamGeoX, matDarkTrim);
      seam.position.set(s * (canopyW / 2 + 0.008), 5.09, z);
      canopyGroup.add(seam);
    }
  }

  // Flat recessed soffit ceiling (underside at Y = 4.60 m)
  const soffitGeo = createSolidRoundedSlabGeometry(THREE, canopyW - 0.28, canopyD - 0.28, cornerR - 0.14, 0.04, 0);
  const soffitMesh = new THREE.Mesh(soffitGeo, matSoffit);
  soffitMesh.position.y = 4.60;
  canopyGroup.add(soffitMesh);

  // Recessed Metal Roof Deck (Y = 5.38 m)
  const roofGeo = createSolidRoundedSlabGeometry(THREE, canopyW - 0.30, canopyD - 0.30, cornerR - 0.15, 0.04, 0);
  const roofMesh = new THREE.Mesh(roofGeo, matGalvSteel);
  roofMesh.position.y = 5.36;
  canopyGroup.add(roofMesh);

  // Standing seam ribs and structural roof purlins on top of roof deck
  const roofRibGeo = new THREE.BoxGeometry(0.03, 0.035, canopyD - 0.45);
  for (let x = -11.0; x <= 11.0; x += 1.0) {
    const rib = new THREE.Mesh(roofRibGeo, matGalvSteel);
    rib.position.set(x, 5.415, 0);
    canopyGroup.add(rib);
  }
  // Roof drain sumps over two columns
  const drainBoxGeo = new THREE.CylinderGeometry(0.18, 0.12, 0.06, 16);
  for (const cx of [-6.2, 6.2]) {
    const drain = new THREE.Mesh(drainBoxGeo, matDarkTrim);
    drain.position.set(cx, 5.41, -2.8);
    canopyGroup.add(drain);
  }

  // ============================================================================
  // 3. SOFFIT LED LIGHT GRID (3 x 6 = 18 recessed square fixtures + SpotLights)
  // ============================================================================
  const lightBezelGeo = new THREE.BoxGeometry(0.64, 0.025, 0.64);
  const lightLensGeo = new THREE.BoxGeometry(0.54, 0.012, 0.54);

  const xs = [-8.5, -5.1, -1.7, 1.7, 5.1, 8.5];
  const zs = [-3.3, 0.0, 3.3];

  for (const lx of xs) {
    for (const lz of zs) {
      const bezel = new THREE.Mesh(lightBezelGeo, matBrushedAlum);
      bezel.position.set(lx, 4.595, lz);
      canopyGroup.add(bezel);

      const lens = new THREE.Mesh(lightLensGeo, matLedLens);
      lens.position.set(lx, 4.585, lz);
      lens.castShadow = false;
      canopyGroup.add(lens);
    }
  }

  // 4 Downward SpotLights positioned over the pump islands for dynamic scene illumination
  const canopyLights = [];
  const lightCoords = [
    [-4.5, -2.8],
    [4.5, -2.8],
    [-4.5, 2.8],
    [4.5, 2.8]
  ];
  for (const [lx, lz] of lightCoords) {
    const spot = new THREE.SpotLight(0xf6f9ff, 18, 14, Math.PI * 0.42, 0.6, 1.5);
    spot.position.set(lx, 4.55, lz);
    spot.target.position.set(lx, 0, lz);
    spot.castShadow = false;
    canopyGroup.add(spot);
    canopyGroup.add(spot.target);
    canopyLights.push(spot);
  }

  // ============================================================================
  // 4. TWO RAISED CONCRETE FUEL ISLANDS & 4 COLUMNS
  // ============================================================================
  const islandLength = 8.4; // along X
  const islandWidth = 1.24; // along Z
  const islandHeight = 0.15; // above pad (pad top is at 0.02)
  const islandPositionsZ = [-2.8, 2.8];

  const islandSlabGeo = createSolidRoundedSlabGeometry(
    THREE,
    islandLength - 0.04,
    islandWidth - 0.04,
    0.58,
    islandHeight - 0.01,
    0.01
  );
  const islandCurbBandGeo = createRingExtrudeGeometry(
    THREE,
    islandLength,
    islandWidth,
    0.60,
    0.04,
    islandHeight - 0.01,
    0.005
  );

  for (const iz of islandPositionsZ) {
    const islandSlab = new THREE.Mesh(islandSlabGeo, matIslandConcrete);
    islandSlab.position.set(0, 0.02, iz);
    group.add(islandSlab);

    const islandCurb = new THREE.Mesh(islandCurbBandGeo, matSafetyYellow);
    islandCurb.position.set(0, 0.02, iz);
    group.add(islandCurb);
  }

  // 4 Square Canopy Columns (0.45 m x 0.45 m, clad in brushed metal/ACM, on islands at X = ±6.2, Z = ±2.8)
  const colPositionsX = [-6.2, 6.2];
  const colShaftGeo = createSolidRoundedSlabGeometry(THREE, 0.45, 0.45, 0.04, 3.80, 0);
  const colBasePedestalGeo = createSolidRoundedSlabGeometry(THREE, 0.56, 0.56, 0.06, 0.65, 0.01);
  const colYellowBootGeo = createSolidRoundedSlabGeometry(THREE, 0.58, 0.58, 0.06, 0.25, 0.005);
  const colTopCollarGeo = createSolidRoundedSlabGeometry(THREE, 0.54, 0.54, 0.05, 0.08, 0.005);
  const drainPipeGeo = new THREE.CylinderGeometry(0.045, 0.045, 4.45, 16);
  const pipeBracketGeo = new THREE.BoxGeometry(0.12, 0.03, 0.06);

  for (const cx of colPositionsX) {
    for (let zi = 0; zi < islandPositionsZ.length; zi++) {
      const cz = islandPositionsZ[zi];

      // Concrete base guard sitting on island (Y = 0.17 to 0.82)
      const pedestal = new THREE.Mesh(colBasePedestalGeo, matIslandConcrete);
      pedestal.position.set(cx, 0.17, cz);
      group.add(pedestal);

      // Yellow safety stripe at bottom of column base
      const boot = new THREE.Mesh(colYellowBootGeo, matSafetyYellow);
      boot.position.set(cx, 0.17, cz);
      group.add(boot);

      // Main 0.45m square column shaft (Y = 0.82 to 4.62)
      const shaft = new THREE.Mesh(colShaftGeo, matBrushedAlum);
      shaft.position.set(cx, 0.82, cz);
      group.add(shaft);

      // Recessed architectural reveal rings on column
      for (const ry of [1.8, 2.8, 3.8]) {
        const ring = new THREE.Mesh(
          new THREE.BoxGeometry(0.46, 0.015, 0.46),
          matDarkTrim
        );
        ring.position.set(cx, ry, cz);
        group.add(ring);
      }

      // Top soffit collar
      const collar = new THREE.Mesh(colTopCollarGeo, matDarkTrim);
      collar.position.set(cx, 4.54, cz);
      group.add(collar);

      // Roof drain downpipe integrated along inner face of the two north columns (zi === 0)
      if (zi === 0) {
        const pipeX = cx + (cx < 0 ? 0.255 : -0.255);
        const downpipe = new THREE.Mesh(drainPipeGeo, matGalvSteel);
        downpipe.position.set(pipeX, 2.39, cz);
        group.add(downpipe);

        // Cleanout port near bottom
        const cleanout = new THREE.Mesh(
          new THREE.CylinderGeometry(0.055, 0.055, 0.12, 12),
          matDarkTrim
        );
        cleanout.rotation.z = Math.PI / 2;
        cleanout.position.set(pipeX + (cx < 0 ? 0.03 : -0.03), 0.95, cz);
        group.add(cleanout);

        for (const by of [1.2, 2.3, 3.4, 4.3]) {
          const bracket = new THREE.Mesh(pipeBracketGeo, matDarkTrim);
          bracket.position.set(pipeX, by, cz);
          group.add(bracket);
        }
      }
    }
  }

  // ============================================================================
  // 5. FOUR MULTI-PRODUCT FUEL DISPENSERS (MPDs)
  // ============================================================================
  function buildDispenser() {
    const pump = new THREE.Group();
    const baseY = 0.17; // Island top elevation

    // 1. Stainless lower base plinth (1.02 W x 0.58 D x 0.10 H)
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(1.02, 0.10, 0.58),
      matDarkTrim
    );
    plinth.position.set(0, baseY + 0.05, 0);
    pump.add(plinth);

    // 2. Lower hydraulic cabinet (0.94 W x 0.52 D x 0.82 H)
    const lowerCab = new THREE.Mesh(
      new THREE.BoxGeometry(0.94, 0.82, 0.52),
      matFasciaWhite
    );
    lowerCab.position.set(0, baseY + 0.51, 0);
    pump.add(lowerCab);

    // Lower cabinet access door panels & colored accent strip on both Z faces
    for (const s of [-1, 1]) {
      const doorPanel = new THREE.Mesh(
        new THREE.BoxGeometry(0.84, 0.68, 0.015),
        matBrushedAlum
      );
      doorPanel.position.set(0, baseY + 0.50, s * 0.262);
      pump.add(doorPanel);

      const lowerStripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.86, 0.12, 0.02),
        matFasciaAccent
      );
      lowerStripe.position.set(0, baseY + 0.76, s * 0.262);
      pump.add(lowerStripe);
    }

    // 3. Side vertical structural pillars / hose columns (left & right X = ±0.48)
    const sideColGeo = new THREE.BoxGeometry(0.11, 2.02, 0.56);
    for (const sx of [-0.48, 0.48]) {
      const col = new THREE.Mesh(sideColGeo, matDarkTrim);
      col.position.set(sx, baseY + 1.08, 0);
      pump.add(col);
    }

    // 4. Center electronics head (display/grade buttons/card reader, Y = baseY + 0.92 to 1.62)
    const headCore = new THREE.Mesh(
      new THREE.BoxGeometry(0.86, 0.68, 0.46),
      matDarkTrim
    );
    headCore.position.set(0, baseY + 1.26, 0);
    pump.add(headCore);

    // Dual-sided interactive display & octane selector faceplates
    const uiFaceGeo = new THREE.PlaneGeometry(0.82, 0.54);
    for (const s of [-1, 1]) {
      const uiMesh = new THREE.Mesh(uiFaceGeo, matPumpUI);
      uiMesh.position.set(0, baseY + 1.26, s * 0.232);
      if (s === -1) uiMesh.rotation.y = Math.PI;
      pump.add(uiMesh);

      // Stainless trim lip above screen
      const visor = new THREE.Mesh(
        new THREE.BoxGeometry(0.85, 0.04, 0.50),
        matBrushedAlum
      );
      visor.position.set(0, baseY + 1.56, 0);
      pump.add(visor);
    }

    // 5. Upper curved canopy valence / topper (Y = baseY + 1.82 to 2.22 -> top at Y = 2.39m)
    const topperShape = createRoundedRectShape(THREE, 1.12, 0.64, 0.08);
    const topperGeo = new THREE.ExtrudeGeometry(topperShape, {
      depth: 0.36,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.02,
      bevelSegments: 2
    });
    topperGeo.rotateX(-Math.PI / 2);
    const topper = new THREE.Mesh(topperGeo, matFasciaAccent);
    topper.position.set(0, baseY + 1.84, 0);
    pump.add(topper);

    // Pump number badge box in center below topper
    const numBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.18, 0.24),
      matFasciaWhite
    );
    numBox.position.set(0, baseY + 1.72, 0);
    pump.add(numBox);

    // 6. Nozzle Boot Holsters, Handles & Curved Rubber Hoses on BOTH faces (2 per face = 4 total)
    for (const fz of [-1, 1]) {
      for (const hx of [-1, 1]) {
        const bootX = hx * 0.36;
        const bootZ = fz * 0.25;

        // Holster cavity housing
        const holster = new THREE.Mesh(
          new THREE.BoxGeometry(0.11, 0.26, 0.08),
          matDarkTrim
        );
        holster.position.set(bootX, baseY + 0.96, bootZ);
        pump.add(holster);

        // Fuel nozzle grip & spout
        const nozzleMat = hx === 1 ? matDieselGreen : matNozzleRed;
        const nozzleGrip = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.16, 0.06),
          nozzleMat
        );
        nozzleGrip.position.set(bootX, baseY + 0.94, bootZ + fz * 0.04);
        nozzleGrip.rotation.x = fz * 0.25;
        pump.add(nozzleGrip);

        const spout = new THREE.Mesh(
          new THREE.CylinderGeometry(0.012, 0.012, 0.14, 10),
          matChrome
        );
        spout.position.set(bootX, baseY + 1.03, bootZ + fz * 0.02);
        spout.rotation.x = -fz * 0.4;
        pump.add(spout);

        // High-hang hose outlet mast + curved rubber hose
        const mastX = hx * 0.52;
        const mastZ = fz * 0.18;
        const hoseCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(mastX, baseY + 1.78, mastZ),
          new THREE.Vector3(hx * 0.58, baseY + 1.25, fz * 0.28),
          new THREE.Vector3(hx * 0.55, baseY + 0.42, fz * 0.30),
          new THREE.Vector3(hx * 0.44, baseY + 0.36, fz * 0.29),
          new THREE.Vector3(bootX, baseY + 0.85, bootZ + fz * 0.05)
        ]);
        const hoseGeo = new THREE.TubeGeometry(hoseCurve, 20, 0.016, 8, false);
        const hoseMesh = new THREE.Mesh(hoseGeo, matRubberHose);
        pump.add(hoseMesh);

        // Swivel breakaway coupling near top of hose
        const breakaway = new THREE.Mesh(
          new THREE.CylinderGeometry(0.024, 0.024, 0.07, 10),
          matChrome
        );
        breakaway.position.set(mastX, baseY + 1.72, mastZ);
        pump.add(breakaway);
      }
    }

    return pump;
  }

  const pumpPositionsX = [-2.4, 2.4];
  for (const px of pumpPositionsX) {
    for (const pz of islandPositionsZ) {
      const dispenser = buildDispenser();
      dispenser.position.set(px, 0, pz);
      group.add(dispenser);
    }
  }

  // ============================================================================
  // 6. YELLOW STEEL BOLLARDS & TRASH / SQUEEGEE SERVICE STANDS
  // ============================================================================
  function buildBollardLoop() {
    const bGroup = new THREE.Group();
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.02, -0.34),
      new THREE.Vector3(0, 0.82, -0.34),
      new THREE.Vector3(0, 1.02, -0.18),
      new THREE.Vector3(0, 1.02, 0.18),
      new THREE.Vector3(0, 0.82, 0.34),
      new THREE.Vector3(0, 0.02, 0.34)
    ]);
    const tubeGeo = new THREE.TubeGeometry(curve, 24, 0.065, 14, false);
    const tube = new THREE.Mesh(tubeGeo, matSafetyYellow);
    bGroup.add(tube);

    // Base floor mounting flanges
    const flangeGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.02, 16);
    for (const fz of [-0.34, 0.34]) {
      const flange = new THREE.Mesh(flangeGeo, matSafetyYellow);
      flange.position.set(0, 0.03, fz);
      bGroup.add(flange);
    }
    return bGroup;
  }

  // Place U-shaped pipe bollards at all 4 island ends (X = ±4.05, Z = ±2.8)
  for (const bx of [-4.05, 4.05]) {
    for (const bz of islandPositionsZ) {
      const uBollard = buildBollardLoop();
      uBollard.position.set(bx, 0, bz);
      group.add(uBollard);
    }
  }

  // Additional vertical cylindrical steel bollards flanking the outer sides of columns
  const vertBollardGeo = new THREE.CylinderGeometry(0.075, 0.075, 1.05, 16);
  const vertCapGeo = new THREE.SphereGeometry(0.075, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const redBandGeo = new THREE.CylinderGeometry(0.077, 0.077, 0.10, 16);
  for (const cx of [-6.95, 6.95]) {
    for (const cz of islandPositionsZ) {
      const post = new THREE.Mesh(vertBollardGeo, matSafetyYellow);
      post.position.set(cx, 0.54, cz);
      group.add(post);

      const cap = new THREE.Mesh(vertCapGeo, matSafetyYellow);
      cap.position.set(cx, 1.065, cz);
      group.add(cap);

      const stripe = new THREE.Mesh(redBandGeo, matNozzleRed);
      stripe.position.set(cx, 0.92, cz);
      group.add(stripe);
    }
  }

  // Trash / Windshield Squeegee Service Stands at center of each island (X = 0, Z = ±2.8)
  function buildServiceCaddy() {
    const caddy = new THREE.Group();
    const baseY = 0.17;

    // Main waste receptacle body
    const binBody = new THREE.Mesh(
      createSolidRoundedSlabGeometry(THREE, 0.52, 0.48, 0.08, 0.78, 0.01),
      matDarkTrim
    );
    binBody.position.set(0, baseY, 0);
    caddy.add(binBody);

    // Domed waste hood with disposal opening
    const hood = new THREE.Mesh(
      createSolidRoundedSlabGeometry(THREE, 0.54, 0.50, 0.09, 0.24, 0.02),
      matFasciaAccent
    );
    hood.position.set(0, baseY + 0.78, 0);
    caddy.add(hood);

    // Paper towel dispenser box above hood
    const towelBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.22, 0.24),
      matDarkTrim
    );
    towelBox.position.set(0, baseY + 1.12, 0);
    caddy.add(towelBox);

    // Side windshield washer fluid bucket + squeegee handle on both X sides
    for (const sx of [-1, 1]) {
      const bucket = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.34, 0.24),
        matFasciaAccent
      );
      bucket.position.set(sx * 0.34, baseY + 0.52, 0);
      caddy.add(bucket);

      // Squeegee pole sticking out of bucket
      const handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.01, 0.01, 0.55, 8),
        matBrushedAlum
      );
      handle.position.set(sx * 0.34, baseY + 0.78, 0.02);
      handle.rotation.z = -sx * 0.12;
      caddy.add(handle);

      const head = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.04, 0.20),
        matDarkTrim
      );
      head.position.set(sx * 0.37, baseY + 1.04, 0.02);
      caddy.add(head);
    }

    return caddy;
  }

  for (const cz of islandPositionsZ) {
    const caddy = buildServiceCaddy();
    caddy.position.set(0, 0, cz);
    group.add(caddy);
  }

  // Shadow settings for all meshes
  group.traverse((obj) => {
    if (obj.isMesh) {
      const isEmissiveLens = obj.material === matLedLens || obj.material === matAccentLed;
      obj.castShadow = !isEmissiveLens && obj !== padMesh;
      obj.receiveShadow = true;
    }
  });

  // Toggleable lighting API
  function setLights(on) {
    const active = Boolean(on);
    matLedLens.emissiveIntensity = active ? 2.2 : 0.0;
    matAccentLed.emissiveIntensity = active ? 1.4 : 0.0;
    matPumpUI.emissiveIntensity = active ? 0.45 : 0.1;
    for (const light of canopyLights) {
      light.visible = active;
    }
  }

  setLights(opts.lightsOn ?? true);

  group.userData.assetType = 'canopy';
  group.userData.dims = { length: 12.0, width: 24.0, height: 5.6 };
  group.userData.clearance = 4.6;
  group.userData.setLights = setLights;

  return group;
}
