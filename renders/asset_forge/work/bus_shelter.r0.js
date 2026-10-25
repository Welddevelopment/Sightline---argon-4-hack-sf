const _cache = {
  textures: {},
  geometries: {},
  materials: {}
};

function makeConcreteTexture(THREE) {
  if (_cache.textures.concrete) return _cache.textures.concrete;
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const n1 = (rand() - 0.5) * 22;
      const n2 = Math.sin(x * 0.08) * Math.cos(y * 0.08) * 6;
      // expansion joint lines
      const jointX = (x % 85 === 0 || x % 85 === 1) ? -28 : 0;
      const base = 172 + n1 + n2 + jointX;
      const v = Math.max(100, Math.min(220, Math.floor(base)));
      data[idx] = v;
      data[idx + 1] = v - 2;
      data[idx + 2] = v - 6;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 1.5);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  _cache.textures.concrete = tex;
  return tex;
}

function makePerforatedTexture(THREE) {
  if (_cache.textures.perf) return _cache.textures.perf;
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  const step = 8;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const row = Math.floor(y / step);
      const ox = (row % 2) * (step / 2);
      const lx = ((x + ox) % step) - step / 2;
      const ly = (y % step) - step / 2;
      const d = Math.sqrt(lx * lx + ly * ly);
      const hole = d < 2.2;
      const v = hole ? 28 : 135;
      data[idx] = v;
      data[idx + 1] = v + 2;
      data[idx + 2] = v + 5;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 2);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  _cache.textures.perf = tex;
  return tex;
}

function makeFritTexture(THREE) {
  if (_cache.textures.frit) return _cache.textures.frit;
  const w = 128, h = 64;
  const data = new Uint8Array(w * h * 4);
  const step = 8;
  for (let y = 0; y < h; y++) {
    const ny = y / (h - 1); // 0 to 1 vertically across frit band
    const edgeFactor = Math.sin(ny * Math.PI); // larger dots in middle, smaller at edges
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const lx = (x % step) - step / 2 + 0.5;
      const ly = (y % step) - step / 2 + 0.5;
      const d = Math.sqrt(lx * lx + ly * ly);
      const maxR = 2.6 * (0.4 + 0.6 * edgeFactor);
      // Also two crisp horizontal warning stripes
      const stripe = (y >= 8 && y <= 12) || (y >= h - 13 && y <= h - 9);
      const isFrit = d < maxR || stripe;
      data[idx] = 235;
      data[idx + 1] = 240;
      data[idx + 2] = 238;
      data[idx + 3] = isFrit ? 215 : 0;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(14, 1);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  _cache.textures.frit = tex;
  return tex;
}

function makeAdBoxTexture(THREE) {
  if (_cache.textures.adbox) return _cache.textures.adbox;
  const w = 128, h = 256;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const idx = (y * w + x) * 4;
      // Subtle diffuser illumination gradient (falloff near edges + fluorescent tube banding)
      const edgeX = Math.sin(u * Math.PI);
      const edgeY = Math.sin(v * Math.PI);
      const vignette = Math.pow(edgeX * edgeY, 0.22);
      const tubes = 0.97 + 0.03 * Math.cos(u * Math.PI * 8);
      // Subtle neutral architectural graphic blocks (no text/logos)
      let tone = 244 * vignette * tubes;
      if (v > 0.12 && v < 0.58 && u > 0.1 && u < 0.9) {
        // soft cool graphic band
        const grad = 0.85 + 0.15 * v;
        data[idx] = Math.floor(tone * 0.86 * grad);
        data[idx + 1] = Math.floor(tone * 0.92 * grad);
        data[idx + 2] = Math.floor(tone * 0.98 * grad);
      } else if (v >= 0.62 && v < 0.65 && u > 0.15 && u < 0.75) {
        // abstract graphic bar
        data[idx] = Math.floor(tone * 0.65);
        data[idx + 1] = Math.floor(tone * 0.70);
        data[idx + 2] = Math.floor(tone * 0.76);
      } else if (v >= 0.68 && v < 0.70 && u > 0.15 && u < 0.55) {
        data[idx] = Math.floor(tone * 0.75);
        data[idx + 1] = Math.floor(tone * 0.78);
        data[idx + 2] = Math.floor(tone * 0.82);
      } else {
        data[idx] = Math.floor(tone);
        data[idx + 1] = Math.floor(tone * 0.99);
        data[idx + 2] = Math.floor(tone * 0.96);
      }
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  _cache.textures.adbox = tex;
  return tex;
}

function makeScheduleTexture(THREE) {
  if (_cache.textures.schedule) return _cache.textures.schedule;
  const w = 128, h = 160;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      let r = 238, g = 240, b = 242;
      // Top header bar (transit blue)
      if (y > h - 24 && y < h - 8 && x > 8 && x < w - 8) {
        r = 28; g = 88; b = 155;
      }
      // Left side schematic transit map area
      else if (x > 10 && x < 62 && y > 14 && y < h - 30) {
        r = 225; g = 232; b = 226;
        // schematic route lines
        if (Math.abs((x - 16) - (y - 20) * 0.5) < 1.8) { r = 210; g = 45; b = 45; }
        if (Math.abs(x - 36) < 1.5 && y > 24 && y < 110) { r = 30; g = 110; b = 200; }
        if (Math.abs(y - 70) < 1.5 && x > 15 && x < 58) { r = 40; g = 150; b = 75; }
      }
      // Right side timetable grid cells
      else if (x >= 68 && x < w - 10 && y > 14 && y < h - 30) {
        const row = y % 12;
        const col = x % 14;
        if (row === 0 || col === 0) {
          r = 190; g = 195; b = 200;
        } else if (row > 4 && row < 8 && col > 3 && col < 11) {
          r = 120; g = 128; b = 135;
        }
      }
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  _cache.textures.schedule = tex;
  return tex;
}

function createRoundedBoxGeometry(THREE, w, h, d, r = 0.008) {
  const key = `rbox_${w.toFixed(4)}_${h.toFixed(4)}_${d.toFixed(4)}_${r.toFixed(4)}`;
  if (_cache.geometries[key]) return _cache.geometries[key];

  const wi = Math.max(0.001, w - 2 * r);
  const hi = Math.max(0.001, h - 2 * r);
  const di = Math.max(0.001, d - 2 * r);

  const shape = new THREE.Shape();
  const hw = wi / 2, hh = hi / 2;
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw, hh);
  shape.closePath();

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: di,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: r,
    bevelThickness: r,
    curveSegments: 4
  });
  geom.center();
  _cache.geometries[key] = geom;
  return geom;
}

function buildGlassPanel(THREE, width, height, thickness, mats, fritRatioY = 0.56) {
  const group = new THREE.Group();
  // BoxGeometry materials order: +X, -X, +Y, -Y, +Z (front), -Z (back)
  const geom = new THREE.BoxGeometry(width, height, thickness);
  const faceMat = mats.glassFace;
  const edgeMat = mats.glassEdge;
  const panelMesh = new THREE.Mesh(geom, [
    edgeMat, edgeMat, edgeMat, edgeMat, faceMat, faceMat
  ]);
  panelMesh.castShadow = true;
  panelMesh.receiveShadow = true;
  group.add(panelMesh);

  // Manifestation / ceramic frit safety dot band around 1.35m - 1.50m above ground
  const bandH = 0.14;
  const bandY = -height / 2 + height * fritRatioY;
  const fritGeom = new THREE.PlaneGeometry(width - 0.006, bandH);

  const fritFront = new THREE.Mesh(fritGeom, mats.frit);
  fritFront.position.set(0, bandY, thickness / 2 + 0.0006);
  fritFront.castShadow = false;
  fritFront.receiveShadow = true;
  group.add(fritFront);

  const fritBack = new THREE.Mesh(fritGeom, mats.frit);
  fritBack.rotation.y = Math.PI;
  fritBack.position.set(0, bandY, -thickness / 2 - 0.0006);
  fritBack.castShadow = false;
  fritBack.receiveShadow = true;
  group.add(fritBack);

  return group;
}

export default function create(THREE, opts = {}) {
  const root = new THREE.Group();
  root.name = opts.id ?? 'bus_shelter';

  const frameColorHex = opts.color ?? 0x26292e; // Dark bronze / charcoal architectural anodized aluminum
  const frameColor = new THREE.Color(frameColorHex);

  const mats = {
    frame: new THREE.MeshStandardMaterial({
      color: frameColor,
      metalness: 0.65,
      roughness: 0.32
    }),
    frameDark: new THREE.MeshStandardMaterial({
      color: frameColor.clone().multiplyScalar(0.65),
      metalness: 0.5,
      roughness: 0.45
    }),
    chrome: new THREE.MeshStandardMaterial({
      color: 0xd8dde2,
      metalness: 0.92,
      roughness: 0.16
    }),
    benchPerf: new THREE.MeshStandardMaterial({
      color: 0x8d949c,
      map: makePerforatedTexture(THREE),
      metalness: 0.75,
      roughness: 0.35
    }),
    concrete: new THREE.MeshStandardMaterial({
      color: 0xb8b6b0,
      map: makeConcreteTexture(THREE),
      metalness: 0.05,
      roughness: 0.88
    }),
    rubberGasket: new THREE.MeshStandardMaterial({
      color: 0x151618,
      metalness: 0.05,
      roughness: 0.88
    }),
    glassFace: new THREE.MeshPhysicalMaterial({
      color: 0xd8ece4,
      transparent: true,
      opacity: 0.34,
      roughness: 0.05,
      metalness: 0.05,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      depthWrite: false
    }),
    glassEdge: new THREE.MeshPhysicalMaterial({
      color: 0x164e3a,
      transparent: true,
      opacity: 0.82,
      roughness: 0.12,
      metalness: 0.05,
      clearcoat: 0.9
    }),
    frit: new THREE.MeshStandardMaterial({
      color: 0xebf0ee,
      map: makeFritTexture(THREE),
      transparent: true,
      opacity: 0.85,
      roughness: 0.4,
      metalness: 0.05,
      depthWrite: false
    }),
    roofPoly: new THREE.MeshPhysicalMaterial({
      color: 0x243038,
      transparent: true,
      opacity: 0.62,
      roughness: 0.12,
      metalness: 0.1,
      clearcoat: 0.9
    }),
    adBacklit: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: makeAdBoxTexture(THREE),
      emissive: new THREE.Color(0xfff8ea),
      emissiveMap: makeAdBoxTexture(THREE),
      emissiveIntensity: 0.65,
      roughness: 0.2,
      metalness: 0.0
    }),
    adGlass: new THREE.MeshPhysicalMaterial({
      color: 0xeef6f4,
      transparent: true,
      opacity: 0.22,
      roughness: 0.04,
      metalness: 0.05,
      clearcoat: 1.0,
      depthWrite: false
    }),
    scheduleFace: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: makeScheduleTexture(THREE),
      roughness: 0.35,
      metalness: 0.05
    }),
    ledLamp: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0xf4f8ff),
      emissiveIntensity: 0.9,
      roughness: 0.15
    })
  };

  const addPart = (geom, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = root, castShadow = true) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    if (rx || ry || rz) m.rotation.set(rx, ry, rz);
    m.castShadow = castShadow;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // =========================================================================
  // 1. CONCRETE PAD FOUNDATION (3.50 m W x 1.50 m D x 0.08 m H above grade)
  // =========================================================================
  const padH = 0.08;
  const padGeom = createRoundedBoxGeometry(THREE, 3.50, padH, 1.50, 0.012);
  addPart(padGeom, mats.concrete, 0, padH / 2, 0);

  // Subtle tactile / curb edge strip along front (-Z) edge of concrete pad
  const curbStripGeom = createRoundedBoxGeometry(THREE, 3.46, 0.006, 0.08, 0.002);
  addPart(curbStripGeom, mats.concrete, 0, padH + 0.002, -0.68);

  // =========================================================================
  // 2. STRUCTURAL ANODIZED ALUMINIUM FRAME (80 mm x 80 mm posts)
  // =========================================================================
  const postSize = 0.08;
  const rearZ = 0.62;
  const frontEndZ = -0.45;
  const colXs = [-1.62, -0.54, 0.54, 1.62]; // 3 equal rear bays of 1.08 m center-to-center

  const postBottomY = padH;
  const rearPostTopY = 2.34;
  const frontPostTopY = 2.40;
  const rearPostH = rearPostTopY - postBottomY;
  const frontPostH = frontPostTopY - postBottomY;

  const rearPostGeom = createRoundedBoxGeometry(THREE, postSize, rearPostH, postSize, 0.006);
  const frontPostGeom = createRoundedBoxGeometry(THREE, postSize, frontPostH, postSize, 0.006);
  const basePlateGeom = createRoundedBoxGeometry(THREE, 0.15, 0.014, 0.15, 0.003);
  const boltGeom = new THREE.CylinderGeometry(0.007, 0.007, 0.016, 8);

  const addBasePlate = (x, z) => {
    addPart(basePlateGeom, mats.frameDark, x, padH + 0.007, z);
    const bo = 0.054;
    for (const dx of [-bo, bo]) {
      for (const dz of [-bo, bo]) {
        addPart(boltGeom, mats.chrome, x + dx, padH + 0.014, z + dz);
      }
    }
  };

  // 4 Rear columns
  for (const x of colXs) {
    addPart(rearPostGeom, mats.frame, x, postBottomY + rearPostH / 2, rearZ);
    addBasePlate(x, rearZ);
  }

  // 2 Front-side columns (at left -X and right +X end walls; center front is completely open)
  for (const x of [colXs[0], colXs[3]]) {
    addPart(frontPostGeom, mats.frame, x, postBottomY + frontPostH / 2, frontEndZ);
    addBasePlate(x, frontEndZ);
  }

  // Rear horizontal top header beam & lower sill rail
  const rearSpanW = colXs[3] - colXs[0] + postSize; // 3.32m
  const rearHeaderGeom = createRoundedBoxGeometry(THREE, rearSpanW, 0.075, 0.08, 0.005);
  addPart(rearHeaderGeom, mats.frame, 0, rearPostTopY - 0.0375, rearZ);

  const rearSillY = padH + 0.12;
  const rearSillGeom = createRoundedBoxGeometry(THREE, rearSpanW - 0.02, 0.036, 0.05, 0.004);
  addPart(rearSillGeom, mats.frame, 0, rearSillY, rearZ);

  // Left end-wall (-X) upper & lower horizontal tie rails
  const endWallSpanZ = rearZ - frontEndZ; // 1.07m
  const endWallCenterZ = (rearZ + frontEndZ) / 2; // +0.085m
  const endTieTopGeom = createRoundedBoxGeometry(THREE, 0.075, 0.065, endWallSpanZ, 0.005);
  addPart(endTieTopGeom, mats.frame, colXs[0], rearPostTopY - 0.02, endWallCenterZ);
  addPart(endTieTopGeom, mats.frame, colXs[3], rearPostTopY - 0.02, endWallCenterZ);

  const endSillGeom = createRoundedBoxGeometry(THREE, 0.05, 0.036, endWallSpanZ - 0.04, 0.004);
  addPart(endSillGeom, mats.frame, colXs[0], rearSillY, endWallCenterZ);

  // =========================================================================
  // 3. ROOF CANOPY, CANTILEVER RIBS, FASCIA & REAR GUTTER (Height up to 2.50 m)
  // =========================================================================
  // Canopy covers X = [-1.75, +1.75] (3.50m) and Z = [-0.75, +0.75] (1.50m)
  // Front overhang past frontEndZ (-0.45) is 0.30m; past rearZ (0.62) is 0.13m
  const roofW = 3.50;
  const roofFrontZ = -0.75;
  const roofRearZ = 0.68;
  const roofGutterZ = 0.715; // gutter extends to +0.75m

  // Cantilevered curved/sloped roof ribs at each of the 4 column X positions
  const ribShape = new THREE.Shape();
  // Draw profile in (Z, Y) plane, then extrude along X
  ribShape.moveTo(roofFrontZ + 0.03, 2.41);
  ribShape.quadraticCurveTo(-0.10, 2.495, roofRearZ, 2.34);
  ribShape.lineTo(roofRearZ, 2.29);
  ribShape.quadraticCurveTo(-0.10, 2.435, roofFrontZ + 0.03, 2.35);
  ribShape.closePath();

  const ribGeom = new THREE.ExtrudeGeometry(ribShape, {
    depth: 0.056,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.003,
    bevelThickness: 0.003,
    curveSegments: 16
  });
  // Rotate so shape X (which is Z coordinate) maps to world Z, shape Y maps to world Y, extrude Z maps to world X
  ribGeom.rotateY(-Math.PI / 2);
  ribGeom.translate(0.028, 0, 0);

  for (const x of colXs) {
    addPart(ribGeom, mats.frame, x, 0, 0);
  }

  // Deep perimeter fascia frame:
  // Front deep fascia bar (at Z = -0.73, width 3.50m, height 0.11m, Y centered at 2.405 -> top 2.46)
  const frontFasciaGeom = createRoundedBoxGeometry(THREE, roofW, 0.105, 0.045, 0.006);
  addPart(frontFasciaGeom, mats.frame, 0, 2.405, roofFrontZ + 0.0225);

  // Subtle silver accent trim strip along front fascia
  const fasciaTrimGeom = new THREE.BoxGeometry(roofW - 0.02, 0.014, 0.006);
  addPart(fasciaTrimGeom, mats.chrome, 0, 2.375, roofFrontZ - 0.001);

  // Mid-span longitudinal purlins (front, center-crown, rear)
  const purlinGeom = createRoundedBoxGeometry(THREE, roofW - 0.04, 0.04, 0.045, 0.004);
  addPart(purlinGeom, mats.frame, 0, 2.425, -0.45);
  addPart(purlinGeom, mats.frame, 0, 2.455, -0.05);
  addPart(purlinGeom, mats.frame, 0, 2.395, 0.35);

  // Side fascia profiles (left X = -1.73, right X = +1.73) following the roof arch
  const sideFasciaShape = new THREE.Shape();
  sideFasciaShape.moveTo(roofFrontZ, 2.455);
  sideFasciaShape.quadraticCurveTo(-0.08, 2.50, roofRearZ, 2.37);
  sideFasciaShape.lineTo(roofRearZ, 2.285);
  sideFasciaShape.quadraticCurveTo(-0.08, 2.415, roofFrontZ, 2.355);
  sideFasciaShape.closePath();

  const sideFasciaGeom = new THREE.ExtrudeGeometry(sideFasciaShape, {
    depth: 0.036,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.003,
    bevelThickness: 0.003,
    curveSegments: 16
  });
  sideFasciaGeom.rotateY(-Math.PI / 2);
  sideFasciaGeom.translate(0.018, 0, 0);

  addPart(sideFasciaGeom, mats.frame, -1.75 + 0.018, 0, 0);
  addPart(sideFasciaGeom, mats.frame, 1.75 - 0.018, 0, 0);

  // Translucent smoked polycarbonate curved roof glazing (3 bays across width)
  const roofGlassShape = new THREE.Shape();
  roofGlassShape.moveTo(roofFrontZ + 0.03, 2.435);
  roofGlassShape.quadraticCurveTo(-0.08, 2.488, roofRearZ, 2.355);
  roofGlassShape.lineTo(roofRearZ, 2.343);
  roofGlassShape.quadraticCurveTo(-0.08, 2.476, roofFrontZ + 0.03, 2.423);
  roofGlassShape.closePath();

  const roofSheetGeom = new THREE.ExtrudeGeometry(roofGlassShape, {
    depth: roofW - 0.06,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 20
  });
  roofSheetGeom.rotateY(-Math.PI / 2);
  roofSheetGeom.translate((roofW - 0.06) / 2, 0, 0);
  addPart(roofSheetGeom, mats.roofPoly, 0, 0, 0);

  // Rear full-width rainwater gutter channel (Z = 0.68 to 0.75)
  const gutterOuterGeom = createRoundedBoxGeometry(THREE, roofW, 0.085, 0.07, 0.005);
  addPart(gutterOuterGeom, mats.frame, 0, 2.325, roofGutterZ);
  // Gutter trough recess (dark interior)
  const gutterInnerGeom = new THREE.BoxGeometry(roofW - 0.04, 0.02, 0.046);
  addPart(gutterInnerGeom, mats.rubberGasket, 0, 2.36, roofGutterZ);

  // Rear drainage downspout pipe along right-rear post (+X/+Z)
  const pipeH = 2.22;
  const pipeGeom = new THREE.CylinderGeometry(0.022, 0.022, pipeH, 14);
  addPart(pipeGeom, mats.frameDark, colXs[3] + 0.065, padH + pipeH / 2, rearZ + 0.035);
  // Pipe mounting brackets
  const pipeClipGeom = new THREE.BoxGeometry(0.05, 0.025, 0.055);
  for (const cy of [0.55, 1.35, 2.10]) {
    addPart(pipeClipGeom, mats.frame, colXs[3] + 0.045, cy, rearZ + 0.035);
  }

  // Under-canopy linear LED luminaire fixture
  const lightHousingGeom = createRoundedBoxGeometry(THREE, 1.80, 0.028, 0.09, 0.004);
  addPart(lightHousingGeom, mats.frame, -0.25, 2.42, -0.05);
  const lightLensGeom = new THREE.PlaneGeometry(1.72, 0.055);
  addPart(lightLensGeom, mats.ledLamp, -0.25, 2.405, -0.05, Math.PI / 2, 0, 0, root, false);

  // =========================================================================
  // 4. TEMPERED GLASS WALLS (12 mm thickness + green edges + frit + clamps)
  // =========================================================================
  const glassThickness = 0.012;
  const glassBottomY = rearSillY + 0.03; // 0.23m above grade
  const glassTopY = 2.26;
  const glassH = glassTopY - glassBottomY; // 2.03m
  const glassCenterY = (glassBottomY + glassTopY) / 2; // 1.245m

  // Frit band at ~1.40m above ground -> relative to panel bottom: (1.40 - 0.23) / 2.03 = 0.576
  const fritRatio = (1.40 - glassBottomY) / glassH;

  // Rear 3 glass bays (between colXs[-1.62, -0.54, 0.54, 1.62])
  // Clear opening between 80mm posts is 1.08 - 0.08 = 1.00m; leave 16mm gap for spider clamps -> 0.968m
  const rearPanelW = 0.968;
  const clampPlateGeom = createRoundedBoxGeometry(THREE, 0.052, 0.038, 0.028, 0.004);
  const clampBoltGeom = new THREE.CylinderGeometry(0.009, 0.009, 0.032, 12);
  clampBoltGeom.rotateX(Math.PI / 2);

  const addGlassClamp = (postX, sideSign, y, z) => {
    const cx = postX + sideSign * (postSize / 2 + 0.016);
    addPart(clampPlateGeom, mats.chrome, cx, y, z);
    addPart(clampBoltGeom, mats.chrome, cx + sideSign * 0.01, y, z);
  };

  for (let i = 0; i < 3; i++) {
    const bayCenterX = (colXs[i] + colXs[i + 1]) / 2;
    const panel = buildGlassPanel(THREE, rearPanelW, glassH, glassThickness, mats, fritRatio);
    panel.position.set(bayCenterX, glassCenterY, rearZ);
    root.add(panel);

    // 4 stainless spider clamps per panel (upper & lower, left & right)
    for (const cy of [glassBottomY + 0.22, glassTopY - 0.22]) {
      addGlassClamp(colXs[i], +1, cy, rearZ);
      addGlassClamp(colXs[i + 1], -1, cy, rearZ);
    }
  }

  // Left end-wall (-X) tempered glass panel (between rearZ=+0.62 and frontEndZ=-0.45)
  // Clear span = 1.07 - 0.08 = 0.99m -> panel width = 0.96m
  const endPanelW = 0.96;
  const leftEndPanel = buildGlassPanel(THREE, endPanelW, glassH, glassThickness, mats, fritRatio);
  leftEndPanel.rotation.y = Math.PI / 2;
  leftEndPanel.position.set(colXs[0], glassCenterY, endWallCenterZ);
  root.add(leftEndPanel);

  // Clamps for left end-wall panel
  const endClampPlateGeom = createRoundedBoxGeometry(THREE, 0.028, 0.038, 0.052, 0.004);
  const endClampBoltGeom = new THREE.CylinderGeometry(0.009, 0.009, 0.032, 12);
  endClampBoltGeom.rotateZ(Math.PI / 2);
  for (const cy of [glassBottomY + 0.22, glassTopY - 0.22]) {
    addPart(endClampPlateGeom, mats.chrome, colXs[0], cy, rearZ - postSize / 2 - 0.016);
    addPart(endClampBoltGeom, mats.chrome, colXs[0], cy, rearZ - postSize / 2 - 0.026);
    addPart(endClampPlateGeom, mats.chrome, colXs[0], cy, frontEndZ + postSize / 2 + 0.016);
    addPart(endClampBoltGeom, mats.chrome, colXs[0], cy, frontEndZ + postSize / 2 + 0.026);
  }

  // =========================================================================
  // 5. ILLUMINATED ADVERTISING LIGHT-BOX (Right end wall at X = +1.62 m)
  // =========================================================================
  // Double-sided municipal poster vitrine filling the right end bay
  const adBoxX = colXs[3];
  const adBoxZ = endWallCenterZ; // +0.085m
  const adBoxW = 0.145; // thickness along X
  const adBoxH = 1.82;  // height along Y
  const adBoxD = 1.02;  // width along Z (between front & rear right posts)
  const adBoxY = padH + 0.20 + adBoxH / 2; // centered at Y = 1.19m (0.28m to 2.10m)

  // Outer anodized aluminium casing
  const adCasingGeom = createRoundedBoxGeometry(THREE, adBoxW, adBoxH, adBoxD, 0.012);
  addPart(adCasingGeom, mats.frame, adBoxX, adBoxY, adBoxZ);

  // Lower pedestal / plinth under ad box
  const adPlinthGeom = createRoundedBoxGeometry(THREE, 0.12, 0.20, adBoxD - 0.04, 0.006);
  addPart(adPlinthGeom, mats.frameDark, adBoxX, padH + 0.10, adBoxZ);

  // Inner black border trim on both -X (inside shelter) and +X (outside street) faces
  const posterH = adBoxH - 0.14;
  const posterD = adBoxD - 0.14;
  const trimBezelGeom = new THREE.BoxGeometry(adBoxW + 0.004, posterH + 0.04, posterD + 0.04);
  addPart(trimBezelGeom, mats.rubberGasket, adBoxX, adBoxY, adBoxZ);

  // Illuminated backlit diffuser sheets (both sides of vitrine)
  const posterPlaneGeom = new THREE.PlaneGeometry(posterD, posterH);
  // Outside face (+X)
  addPart(
    posterPlaneGeom,
    mats.adBacklit,
    adBoxX + adBoxW / 2 + 0.003,
    adBoxY,
    adBoxZ,
    0,
    Math.PI / 2,
    0,
    root,
    false
  );
  // Inside shelter face (-X)
  addPart(
    posterPlaneGeom,
    mats.adBacklit,
    adBoxX - adBoxW / 2 - 0.003,
    adBoxY,
    adBoxZ,
    0,
    -Math.PI / 2,
    0,
    root,
    false
  );

  // Protective glazed vitrine cover plates over both faces
  const coverGlassGeom = new THREE.PlaneGeometry(posterD + 0.02, posterH + 0.02);
  addPart(coverGlassGeom, mats.adGlass, adBoxX + adBoxW / 2 + 0.006, adBoxY, adBoxZ, 0, Math.PI / 2, 0);
  addPart(coverGlassGeom, mats.adGlass, adBoxX - adBoxW / 2 - 0.006, adBoxY, adBoxZ, 0, -Math.PI / 2, 0);

  // =========================================================================
  // 6. PERFORATED METAL BENCH WITH ARMRESTS (0.45 m seat height above pad)
  // =========================================================================
  // Positioned across left & center bays (X = -1.25 to +0.65, centered at X = -0.30)
  const benchCenterX = -0.30;
  const benchLen = 1.90;
  const seatHeightY = padH + 0.45; // 0.53m world Y (0.45m above concrete pad)
  const benchZ = 0.34; // cantilevered forward from rear columns (rearZ = 0.62)

  // Curved perforated steel seat pan (front bullnose roll + slight ergonomic dip)
  const seatShape = new THREE.Shape();
  seatShape.moveTo(0.18, seatHeightY - 0.008);
  seatShape.quadraticCurveTo(0.02, seatHeightY - 0.018, -0.16, seatHeightY);
  seatShape.quadraticCurveTo(-0.20, seatHeightY + 0.002, -0.21, seatHeightY - 0.035);
  seatShape.lineTo(-0.195, seatHeightY - 0.042);
  seatShape.quadraticCurveTo(-0.185, seatHeightY - 0.012, -0.15, seatHeightY - 0.014);
  seatShape.quadraticCurveTo(0.02, seatHeightY - 0.032, 0.18, seatHeightY - 0.022);
  seatShape.closePath();

  const seatGeom = new THREE.ExtrudeGeometry(seatShape, {
    depth: benchLen,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.003,
    bevelThickness: 0.003,
    curveSegments: 12
  });
  seatGeom.rotateY(-Math.PI / 2);
  seatGeom.translate(benchLen / 2, 0, 0);
  addPart(seatGeom, mats.benchPerf, benchCenterX, 0, benchZ);

  // Lumbar backrest bar (mounted between rear posts behind bench)
  const backrestGeom = createRoundedBoxGeometry(THREE, benchLen, 0.11, 0.022, 0.006);
  addPart(backrestGeom, mats.benchPerf, benchCenterX, seatHeightY + 0.26, rearZ - 0.055, -0.08, 0, 0);

  // Heavy-duty cantilevered support brackets & floor legs
  const supportXs = [-1.05, -0.30, 0.45];
  const legGeom = new THREE.CylinderGeometry(0.024, 0.024, seatHeightY - padH - 0.03, 12);
  const cantileverBeamGeom = createRoundedBoxGeometry(THREE, 0.045, 0.05, 0.34, 0.005);

  for (const sx of supportXs) {
    // Horizontal cantilever arm to rear wall
    addPart(cantileverBeamGeom, mats.frameDark, sx, seatHeightY - 0.04, benchZ + 0.10);
    // Vertical tubular support leg to pad
    addPart(legGeom, mats.frameDark, sx, padH + (seatHeightY - padH - 0.03) / 2, benchZ - 0.02);
    // Small foot flange
    const footGeom = new THREE.CylinderGeometry(0.045, 0.045, 0.01, 12);
    addPart(footGeom, mats.chrome, sx, padH + 0.005, benchZ - 0.02);
  }

  // 4 Cast aluminium armrests (2 ends + 2 intermediate dividers)
  const armXs = [-1.22, -0.60, 0.00, 0.62];
  const armCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, seatHeightY - 0.02, benchZ - 0.17),
    new THREE.Vector3(0, seatHeightY + 0.16, benchZ - 0.15),
    new THREE.Vector3(0, seatHeightY + 0.18, benchZ + 0.02),
    new THREE.Vector3(0, seatHeightY + 0.15, benchZ + 0.16),
    new THREE.Vector3(0, seatHeightY - 0.02, benchZ + 0.17)
  ]);
  const armTubeGeom = new THREE.TubeGeometry(armCurve, 16, 0.014, 10, false);

  for (const ax of armXs) {
    addPart(armTubeGeom, mats.chrome, ax, 0, 0);
  }

  // =========================================================================
  // 7. ROUTE-INFO / TIMETABLE DISPLAY CASE (Mounted on rear wall, right bay)
  // =========================================================================
  // Placed in right-hand rear bay (between colXs[2]=0.54 and colXs[3]=1.62, centered at X = +1.08)
  const infoX = 1.08;
  const infoY = padH + 1.32;
  const infoZ = rearZ - 0.028;
  const infoW = 0.56;
  const infoH = 0.72;
  const infoD = 0.036;

  const infoFrameGeom = createRoundedBoxGeometry(THREE, infoW, infoH, infoD, 0.005);
  addPart(infoFrameGeom, mats.frame, infoX, infoY, infoZ);

  // Schedule graphic insert facing -Z (toward passengers)
  const infoFaceGeom = new THREE.PlaneGeometry(infoW - 0.05, infoH - 0.05);
  addPart(infoFaceGeom, mats.scheduleFace, infoX, infoY, infoZ - infoD / 2 - 0.001, 0, Math.PI, 0);

  // Protective glass cover on schedule frame
  const infoCoverGeom = new THREE.PlaneGeometry(infoW - 0.03, infoH - 0.03);
  addPart(infoCoverGeom, mats.adGlass, infoX, infoY, infoZ - infoD / 2 - 0.003, 0, Math.PI, 0);

  // Mounting bars connecting schedule case to rear columns
  const infoMountBarGeom = new THREE.BoxGeometry(1.04, 0.026, 0.022);
  addPart(infoMountBarGeom, mats.frameDark, infoX, infoY + infoH / 2 - 0.06, rearZ - 0.015);
  addPart(infoMountBarGeom, mats.frameDark, infoX, infoY - infoH / 2 + 0.06, rearZ - 0.015);

  // =========================================================================
  // 8. MUNICIPAL TRASH RECEPTACLE (Inside left front corner, within footprint)
  // =========================================================================
  const binX = -1.32;
  const binZ = -0.35;
  const binR = 0.185;
  const binBodyH = 0.64;

  // Concrete / cast-iron weighted base plinth
  const binBaseGeom = new THREE.CylinderGeometry(binR * 0.88, binR * 0.94, 0.07, 24);
  addPart(binBaseGeom, mats.frameDark, binX, padH + 0.035, binZ);

  // Perforated cylindrical steel drum
  const binDrumGeom = new THREE.CylinderGeometry(binR, binR * 0.94, binBodyH, 28);
  addPart(binDrumGeom, mats.benchPerf, binX, padH + 0.07 + binBodyH / 2, binZ);

  // Dark inner liner bag/bucket silhouette
  const binLinerGeom = new THREE.CylinderGeometry(binR * 0.86, binR * 0.82, binBodyH + 0.02, 20);
  addPart(binLinerGeom, mats.rubberGasket, binX, padH + 0.07 + binBodyH / 2, binZ);

  // Top & bottom reinforcing bands
  const binBandGeom = new THREE.CylinderGeometry(binR + 0.005, binR + 0.005, 0.035, 28);
  addPart(binBandGeom, mats.frame, binX, padH + 0.09, binZ);
  addPart(binBandGeom, mats.frame, binX, padH + 0.07 + binBodyH - 0.015, binZ);

  // Domed rain hood with front/back disposal aperture
  const hoodBottomY = padH + 0.07 + binBodyH;
  // Two side pillars supporting hood
  const hoodPostGeom = createRoundedBoxGeometry(THREE, 0.035, 0.14, 0.07, 0.004);
  addPart(hoodPostGeom, mats.frame, binX - binR + 0.02, hoodBottomY + 0.07, binZ);
  addPart(hoodPostGeom, mats.frame, binX + binR - 0.02, hoodBottomY + 0.07, binZ);

  // Domed cap
  const hoodCapGeom = new THREE.SphereGeometry(binR + 0.01, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.48);
  hoodCapGeom.scale(1, 0.52, 1);
  addPart(hoodCapGeom, mats.frame, binX, hoodBottomY + 0.12, binZ);

  // Ash / cigarette stubber plate on top of hood
  const stubberGeom = new THREE.CylinderGeometry(0.045, 0.05, 0.008, 16);
  addPart(stubberGeom, mats.chrome, binX, hoodBottomY + 0.215, binZ);

  // =========================================================================
  // METADATA & USERDATA CONTRACT
  // =========================================================================
  root.userData.assetType = 'shelter';
  root.userData.open = true;
  root.userData.dims = {
    length: 1.5,
    width: 3.5,
    height: 2.5
  };

  return root;
}
