// pedestrian.js — SIGHTLINE Forensic Asset Module
// Procedural 3D Adult Pedestrian (standing / walking) at 1:1 metric scale.

const GEO_CACHE = new Map();
const TEX_CACHE = new Map();
const MAT_CACHE = new Map();

function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str ?? 'pedestrian');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makePRNG(seed) {
  let s = hashSeed(seed) || 123456789;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds a smooth organic lofted BufferGeometry from an array of cross-section slices.
 * Each slice: { y, rx, rz, cx = 0, cz = 0, flatFront = 0, flatBack = 0, indentSide = 0, foldAmp = 0, foldFreq = 0, rotX = 0, sharpFront = 0 }
 */
function createLoftGeometry(THREE, slices, radialSegs = 32, capBottom = true, capTop = true) {
  const numSlices = slices.length;
  const ringVerts = radialSegs + 1;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i < numSlices; i++) {
    const s = slices[i];
    const v = i / Math.max(1, numSlices - 1);
    const cx = s.cx || 0;
    const cz = s.cz || 0;
    const y0 = s.y;
    const rx = s.rx;
    const rz = s.rz;
    const rotX = s.rotX || 0;
    const cosR = Math.cos(rotX);
    const sinR = Math.sin(rotX);

    for (let j = 0; j <= radialSegs; j++) {
      const u = j / radialSegs;
      const theta = u * Math.PI * 2;
      // theta = 0 -> +X (right), PI/2 -> +Z (back), PI -> -X (left), 3PI/2 -> -Z (front)
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      let lx = cosT * rx;
      let lz = sinT * rz;

      // Subtle flattening on back or front if requested (e.g., chest/back/sole)
      if (s.flatBack && sinT > 0) {
        lz *= 1 - s.flatBack * Math.pow(sinT, 2);
      }
      if (s.flatFront && sinT < 0) {
        lz *= 1 - s.flatFront * Math.pow(-sinT, 2);
      }
      // Subtle center chest/back vertical sternum/spine depression
      if (s.sternumGroove && Math.abs(cosT) < 0.45) {
        const factor = 1 - Math.abs(cosT) / 0.45;
        lz *= 1 - s.sternumGroove * factor * factor;
      }
      // Jaw / nose / shin forward protrusion around -Z (sinT < 0)
      if (s.frontProtrude && sinT < 0) {
        const f = Math.pow(-sinT, s.frontPower || 3);
        lz -= s.frontProtrude * f;
      }
      // Chin / heel / calf back protrusion around +Z (sinT > 0)
      if (s.backProtrude && sinT > 0) {
        const f = Math.pow(sinT, s.backPower || 3);
        lz += s.backProtrude * f;
      }
      // Side indentation (e.g., waist / temple / ankle)
      if (s.indentSide) {
        const f = Math.pow(Math.abs(cosT), 3);
        lx *= 1 - s.indentSide * f;
      }
      // Cloth micro-folds
      if (s.foldAmp && s.foldFreq) {
        const fold = Math.sin(theta * s.foldFreq + (s.foldPhase || 0)) * s.foldAmp;
        lx += cosT * fold;
        lz += sinT * fold;
      }

      // Apply slice pitch rotation (rotX) around slice center
      const ry = y0 - lz * sinR;
      const rzFinal = cz + lz * cosR;
      const rxFinal = cx + lx;

      positions.push(rxFinal, ry, rzFinal);
      uvs.push(u, v);
    }
  }

  for (let i = 0; i < numSlices - 1; i++) {
    const rowA = i * ringVerts;
    const rowB = (i + 1) * ringVerts;
    for (let j = 0; j < radialSegs; j++) {
      const a = rowA + j;
      const b = rowA + j + 1;
      const c = rowB + j + 1;
      const d = rowB + j;
      indices.push(a, b, c);
      indices.push(a, c, d);
    }
  }

  if (capBottom) {
    const s0 = slices[0];
    const botCenterIdx = positions.length / 3;
    positions.push(s0.cx || 0, s0.y, s0.cz || 0);
    uvs.push(0.5, 0);
    for (let j = 0; j < radialSegs; j++) {
      indices.push(botCenterIdx, j + 1, j);
    }
  }

  if (capTop) {
    const sN = slices[numSlices - 1];
    const topCenterIdx = positions.length / 3;
    const lastRow = (numSlices - 1) * ringVerts;
    positions.push(sN.cx || 0, sN.y, sN.cz || 0);
    uvs.push(0.5, 1);
    for (let j = 0; j < radialSegs; j++) {
      indices.push(topCenterIdx, lastRow + j, lastRow + j + 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Procedural DataTexture generators (works identically in browser & Node.js)
 */
function getFabricTexture(THREE, type) {
  const key = `tex_${type}`;
  if (TEX_CACHE.has(key)) return TEX_CACHE.get(key);

  const width = 128;
  const height = 128;
  const data = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      let v = 225;

      if (type === 'denim') {
        // Diagonal twill weave + subtle warp/weft slub variation
        const diag = (x + y * 2) % 4;
        const warp = Math.sin(x * 0.7) * 6 + Math.cos(y * 0.4) * 5;
        v = 195 + (diag === 0 ? 28 : diag === 1 ? 10 : -14) + warp;
      } else if (type === 'cloth') {
        // Fine poplin / soft shell weave
        const check = ((x & 1) ^ (y & 1)) ? 8 : -8;
        const wave = Math.sin(x * 0.25) * 4 + Math.cos(y * 0.25) * 4;
        v = 232 + check + wave;
      } else if (type === 'hair') {
        // Fine longitudinal strands along V
        const strand = Math.sin(x * 1.9 + Math.sin(y * 0.2) * 1.5) * 26 + Math.cos(x * 3.7) * 14;
        v = 205 + strand;
      } else if (type === 'sole') {
        // Ribbed sneaker midsole / tread
        const rib = (x % 4 < 2) ? 14 : -14;
        v = 238 + rib;
      }

      const clamped = Math.max(0, Math.min(255, Math.round(v)));
      data[idx] = clamped;
      data[idx + 1] = clamped;
      data[idx + 2] = clamped;
      data[idx + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  if (type === 'denim') tex.repeat.set(6, 10);
  else if (type === 'cloth') tex.repeat.set(8, 8);
  else if (type === 'hair') tex.repeat.set(4, 2);
  else tex.repeat.set(4, 4);
  tex.needsUpdate = true;

  TEX_CACHE.set(key, tex);
  return tex;
}

/**
 * Shared Base Geometries (cached in module scope so creating 20 pedestrians is fast)
 */
function getBaseGeometries(THREE) {
  if (GEO_CACHE.has('all')) return GEO_CACHE.get('all');

  const geos = {};

  // 1. Pelvis / Hips block (y = 0 at hip joint center y=0.84m, up to waist y=0.98m, down to crotch y=0.77m)
  geos.pelvis = createLoftGeometry(THREE, [
    { y: -0.065, rx: 0.145, rz: 0.095, cz: 0.008, indentSide: 0.08, flatFront: 0.15 },
    { y: -0.040, rx: 0.168, rz: 0.112, cz: 0.012, backProtrude: 0.015, flatFront: 0.12 },
    { y:  0.000, rx: 0.178, rz: 0.118, cz: 0.014, backProtrude: 0.022, flatFront: 0.10 },
    { y:  0.045, rx: 0.176, rz: 0.114, cz: 0.010, backProtrude: 0.016, flatFront: 0.10 },
    { y:  0.090, rx: 0.168, rz: 0.108, cz: 0.004, flatFront: 0.12 },
    { y:  0.125, rx: 0.162, rz: 0.104, cz: 0.002, flatFront: 0.12 }
  ], 32, true, true);

  // 2. Belt ring around top of pelvis (y = 0.095 to 0.128 relative to pelvis)
  geos.belt = createLoftGeometry(THREE, [
    { y: 0.090, rx: 0.171, rz: 0.111, cz: 0.004, flatFront: 0.12 },
    { y: 0.108, rx: 0.173, rz: 0.112, cz: 0.003, flatFront: 0.12 },
    { y: 0.124, rx: 0.169, rz: 0.109, cz: 0.002, flatFront: 0.12 }
  ], 32, true, true);

  // Belt buckle at front (-Z)
  geos.buckle = new THREE.BoxGeometry(0.042, 0.036, 0.012);

  // 3. Upper Leg / Thigh (origin at hip joint y=0, extends down to knee y=-0.39m)
  geos.thigh = createLoftGeometry(THREE, [
    { y:  0.025, rx: 0.082, rz: 0.088, cz: 0.006 },
    { y:  0.000, rx: 0.088, rz: 0.096, cz: 0.008, backProtrude: 0.010 },
    { y: -0.060, rx: 0.086, rz: 0.094, cz: 0.005, foldAmp: 0.002, foldFreq: 5 },
    { y: -0.140, rx: 0.080, rz: 0.087, cz: 0.002, frontProtrude: 0.006, foldAmp: 0.002, foldFreq: 4 },
    { y: -0.230, rx: 0.073, rz: 0.079, cz: 0.000, frontProtrude: 0.005, foldAmp: 0.002, foldFreq: 6 },
    { y: -0.320, rx: 0.066, rz: 0.071, cz: -0.002, foldAmp: 0.0025, foldFreq: 5 },
    { y: -0.375, rx: 0.063, rz: 0.067, cz: -0.001, frontProtrude: 0.004 },
    { y: -0.400, rx: 0.059, rz: 0.063, cz:  0.000 }
  ], 28, true, true);

  // 4. Lower Leg / Calf / Jeans hem (origin at knee y=0, extends down to ankle/cuff y=-0.375m)
  geos.calf = createLoftGeometry(THREE, [
    { y:  0.018, rx: 0.059, rz: 0.063, cz: 0.000 },
    { y: -0.020, rx: 0.061, rz: 0.066, cz: 0.002, frontProtrude: 0.004 },
    { y: -0.085, rx: 0.064, rz: 0.072, cz: 0.009, backProtrude: 0.012 }, // gastrocnemius calf muscle
    { y: -0.160, rx: 0.061, rz: 0.068, cz: 0.007, backProtrude: 0.008, foldAmp: 0.002, foldFreq: 5 },
    { y: -0.240, rx: 0.056, rz: 0.062, cz: 0.003, foldAmp: 0.0025, foldFreq: 6 },
    { y: -0.315, rx: 0.055, rz: 0.061, cz: 0.002, foldAmp: 0.003, foldFreq: 5 },
    { y: -0.352, rx: 0.058, rz: 0.065, cz: 0.000, foldAmp: 0.003, foldFreq: 6 }, // jean break over shoe
    { y: -0.365, rx: 0.059, rz: 0.066, cz: -0.002 },
    { y: -0.374, rx: 0.056, rz: 0.063, cz: -0.002 }
  ], 28, true, true);

  // Jeans turned-up cuff ring at bottom of calf
  geos.jeanCuff = createLoftGeometry(THREE, [
    { y: -0.375, rx: 0.058, rz: 0.065, cz: -0.002 },
    { y: -0.360, rx: 0.061, rz: 0.068, cz: -0.002 },
    { y: -0.348, rx: 0.059, rz: 0.066, cz: -0.002 }
  ], 24, true, true);

  // Ankle sock visible between cuff and shoe collar
  geos.sock = new THREE.CylinderGeometry(0.041, 0.044, 0.055, 20);

  // 5. Sneaker (origin at ankle joint y=0.075m above ground -> ground is at y=-0.075m)
  // Heel back at z = +0.065, Toe tip at z = -0.175 (total shoe length = 0.24m)
  geos.shoeSole = createLoftGeometry(THREE, [
    { y: -0.075, rx: 0.048, rz: 0.116, cz: -0.052, flatBack: 0.08, frontPower: 2.2, frontProtrude: 0.005, indentSide: 0.06 },
    { y: -0.068, rx: 0.052, rz: 0.120, cz: -0.053, flatBack: 0.06, frontPower: 2.2, frontProtrude: 0.006, indentSide: 0.05 },
    { y: -0.052, rx: 0.051, rz: 0.119, cz: -0.053, flatBack: 0.06, indentSide: 0.06 },
    { y: -0.047, rx: 0.049, rz: 0.116, cz: -0.052, flatBack: 0.06, indentSide: 0.06 }
  ], 32, true, true);

  geos.shoeUpper = createLoftGeometry(THREE, [
    { y: -0.048, rx: 0.048, rz: 0.114, cz: -0.051, indentSide: 0.05 },
    { y: -0.030, rx: 0.047, rz: 0.108, cz: -0.046, frontProtrude: 0.006, frontPower: 2.5 },
    { y: -0.012, rx: 0.044, rz: 0.082, cz: -0.022, rotX: 0.14 },
    { y:  0.004, rx: 0.042, rz: 0.056, cz:  0.004, rotX: 0.05 },
    { y:  0.014, rx: 0.040, rz: 0.048, cz:  0.010 }
  ], 28, false, true);

  // Sneaker lace / eyelet strip &laces
  geos.shoeTongue = new THREE.BoxGeometry(0.036, 0.012, 0.065);
  geos.shoeLace = new THREE.CylinderGeometry(0.0022, 0.0022, 0.038, 8);
  geos.shoeLace.rotateZ(Math.PI / 2);

  // 6. Torso / Jacket Body (origin at pelvis/hip center y=0.84m; runs from hem y=0.05m (0.89m world) to base of neck y=0.59m (1.43m world))
  geos.torso = createLoftGeometry(THREE, [
    { y: 0.045, rx: 0.174, rz: 0.113, cz: 0.005, flatFront: 0.10, foldAmp: 0.002, foldFreq: 8 }, // jacket bottom ribbed hem
    { y: 0.075, rx: 0.178, rz: 0.116, cz: 0.005, flatFront: 0.08, foldAmp: 0.003, foldFreq: 6 },
    { y: 0.140, rx: 0.170, rz: 0.112, cz: 0.002, indentSide: 0.05, foldAmp: 0.003, foldFreq: 5 }, // natural waist
    { y: 0.230, rx: 0.178, rz: 0.118, cz: 0.000, sternumGroove: 0.04, foldAmp: 0.0025, foldFreq: 6 }, // lower ribs
    { y: 0.330, rx: 0.192, rz: 0.125, cz: -0.002, sternumGroove: 0.06, backProtrude: 0.010, frontProtrude: 0.008 }, // pectoral / mid-chest
    { y: 0.430, rx: 0.208, rz: 0.124, cz:  0.000, sternumGroove: 0.05, backProtrude: 0.012 }, // upper chest / armpit level
    { y: 0.505, rx: 0.218, rz: 0.114, cz:  0.004, flatBack: 0.08, flatFront: 0.08 }, // full shoulder breadth (rx=0.218 -> 0.436m)
    { y: 0.545, rx: 0.175, rz: 0.096, cz:  0.005, flatBack: 0.10, flatFront: 0.10 }, // trapezius slope
    { y: 0.575, rx: 0.095, rz: 0.076, cz:  0.004 }, // collar base
    { y: 0.590, rx: 0.068, rz: 0.065, cz:  0.002 }  // neck opening
  ], 36, true, true);

  // Undershirt crew neck visible at throat (-Z front of neck base)
  geos.undershirt = createLoftGeometry(THREE, [
    { y: 0.555, rx: 0.072, rz: 0.069, cz: -0.004 },
    { y: 0.588, rx: 0.063, rz: 0.061, cz: -0.002 },
    { y: 0.600, rx: 0.058, rz: 0.056, cz:  0.000 }
  ], 24, false, true);

  // Jacket folded collar around neck (open at front -Z)
  const collarPoints = [];
  const collarSegs = 24;
  const collarSlices = [
    { y: 0.572, r: 0.072, rz: 0.068 },
    { y: 0.605, r: 0.080, rz: 0.075 },
    { y: 0.622, r: 0.086, rz: 0.079 },
    { y: 0.592, r: 0.092, rz: 0.084 }
  ];
  // Build open collar geometry (wraps from front-right around back to front-left)
  {
    const pos = [];
    const ind = [];
    const startAngle = -Math.PI * 0.36; // front right lapel
    const endAngle = Math.PI * 1.36;    // front left lapel
    for (let i = 0; i < collarSlices.length; i++) {
      const cs = collarSlices[i];
      for (let j = 0; j <= collarSegs; j++) {
        const u = j / collarSegs;
        const th = startAngle + u * (endAngle - startAngle);
        const x = Math.cos(th) * cs.r;
        const z = Math.sin(th) * cs.rz + 0.003;
        // Dip lapels down in front
        const frontDip = Math.max(0, -Math.sin(th)) * 0.028;
        pos.push(x, cs.y - frontDip, z);
      }
    }
    const rv = collarSegs + 1;
    for (let i = 0; i < collarSlices.length - 1; i++) {
      for (let j = 0; j < collarSegs; j++) {
        const a = i * rv + j;
        const b = a + 1;
        const c = (i + 1) * rv + j + 1;
        const d = (i + 1) * rv + j;
        ind.push(a, b, c, a, c, d);
        ind.push(a, c, b, a, d, c); // double-sided thickness feel
      }
    }
    const cGeo = new THREE.BufferGeometry();
    cGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    cGeo.setIndex(ind);
    cGeo.computeVertexNormals();
    geos.collar = cGeo;
  }

  // Front central zipper / placket strip along torso front (-Z)
  geos.placket = createLoftGeometry(THREE, [
    { y: 0.048, rx: 0.012, rz: 0.005, cz: -0.112 },
    { y: 0.140, rx: 0.012, rz: 0.005, cz: -0.112 },
    { y: 0.230, rx: 0.012, rz: 0.005, cz: -0.116 },
    { y: 0.330, rx: 0.012, rz: 0.005, cz: -0.125 },
    { y: 0.430, rx: 0.012, rz: 0.005, cz: -0.122 },
    { y: 0.505, rx: 0.012, rz: 0.005, cz: -0.110 },
    { y: 0.565, rx: 0.011, rz: 0.005, cz: -0.075 }
  ], 12, true, true);

  // Chest welt pocket
  geos.chestPocket = new THREE.BoxGeometry(0.068, 0.014, 0.008);

  // 7. Upper Arm Sleeve (origin at shoulder joint y=0, extends down to elbow y=-0.275m)
  geos.upperArm = createLoftGeometry(THREE, [
    { y:  0.032, rx: 0.052, rz: 0.056, cz: 0.002 }, // deltoid cap top
    { y:  0.000, rx: 0.058, rz: 0.062, cz: 0.002 }, // shoulder fullness
    { y: -0.065, rx: 0.055, rz: 0.059, cz: 0.001, foldAmp: 0.0018, foldFreq: 5 },
    { y: -0.145, rx: 0.050, rz: 0.054, cz: 0.000, foldAmp: 0.0020, foldFreq: 6 }, // bicep/tricep
    { y: -0.225, rx: 0.046, rz: 0.050, cz: 0.001, foldAmp: 0.0025, foldFreq: 6 }, // above elbow creases
    { y: -0.275, rx: 0.043, rz: 0.046, cz: 0.002 }  // elbow joint
  ], 24, true, true);

  // 8. Forearm Sleeve & Cuff (origin at elbow joint y=0, extends down to wrist y=-0.245m)
  geos.forearm = createLoftGeometry(THREE, [
    { y:  0.015, rx: 0.043, rz: 0.046, cz: 0.001 },
    { y: -0.040, rx: 0.045, rz: 0.048, cz: 0.000, foldAmp: 0.0018, foldFreq: 5 }, // brachioradialis fullness
    { y: -0.115, rx: 0.041, rz: 0.044, cz: 0.000, foldAmp: 0.0020, foldFreq: 6 },
    { y: -0.185, rx: 0.037, rz: 0.040, cz: 0.000, foldAmp: 0.0022, foldFreq: 5 },
    { y: -0.215, rx: 0.036, rz: 0.039, cz: 0.000 }, // top of cuff
    { y: -0.242, rx: 0.033, rz: 0.036, cz: 0.000 }  // wrist cuff opening
  ], 24, true, true);

  // Exposed wrist skin cylinder inside sleeve cuff
  geos.wrist = createLoftGeometry(THREE, [
    { y: -0.232, rx: 0.025, rz: 0.029, cz: 0.000 },
    { y: -0.258, rx: 0.024, rz: 0.028, cz: 0.000 }
  ], 20, false, true);

  // 9. Hand Geometry (palm + fingers + thumb)
  // Palm oriented with thickness in X (rx ~ 0.015) and breadth in Z (rz ~ 0.041) when arm hangs at side
  geos.palm = createLoftGeometry(THREE, [
    { y:  0.000, rx: 0.016, rz: 0.031, cz:  0.000 }, // wrist base
    { y: -0.025, rx: 0.018, rz: 0.039, cz: -0.003 }, // thenar/hypothenar prominence
    { y: -0.058, rx: 0.016, rz: 0.041, cz: -0.002 }, // knuckles (MCP joints)
    { y: -0.078, rx: 0.014, rz: 0.038, cz: -0.001 }  // finger web base
  ], 20, true, true);

  // Individual curved finger (curls slightly inward toward body -X/+X depending on hand side; built symmetric along -Y with slight -X curl)
  geos.finger = createLoftGeometry(THREE, [
    { y:  0.000, rx: 0.0075, rz: 0.0080, cx:  0.000 },
    { y: -0.026, rx: 0.0070, rz: 0.0074, cx: -0.003 },
    { y: -0.050, rx: 0.0063, rz: 0.0067, cx: -0.009 },
    { y: -0.068, rx: 0.0052, rz: 0.0056, cx: -0.016 }
  ], 12, true, true);

  geos.thumb = createLoftGeometry(THREE, [
    { y:  0.000, rx: 0.011, rz: 0.012, cx: 0.000, cz:  0.000 },
    { y: -0.022, rx: 0.009, rz: 0.010, cx: 0.002, cz: -0.010 },
    { y: -0.044, rx: 0.008, rz: 0.009, cx: 0.000, cz: -0.018 },
    { y: -0.058, rx: 0.0065, rz: 0.007, cx: -0.002, cz: -0.022 }
  ], 12, true, true);

  // 10. Neck & Craniofacial Head (origin at neck base y=1.42m; crown at y=1.70m -> local y = 0.00 to 0.28m)
  // Eye height is 1.581m -> local y = 0.161m
  geos.neckAndHead = createLoftGeometry(THREE, [
    { y: 0.000, rx: 0.056, rz: 0.058, cz:  0.006 }, // base of neck inside collar
    { y: 0.030, rx: 0.051, rz: 0.053, cz:  0.004 }, // mid neck
    { y: 0.058, rx: 0.052, rz: 0.056, cz:  0.000 }, // upper neck / submental transition
    { y: 0.068, rx: 0.056, rz: 0.078, cz: -0.015, frontProtrude: 0.012, frontPower: 3 }, // chin & jawline
    { y: 0.088, rx: 0.066, rz: 0.088, cz: -0.012, frontProtrude: 0.010, frontPower: 4 }, // lower lip / mouth
    { y: 0.108, rx: 0.071, rz: 0.091, cz: -0.010, frontProtrude: 0.008, frontPower: 4 }, // upper lip / maxilla
    { y: 0.132, rx: 0.076, rz: 0.094, cz: -0.006, indentSide: 0.04 }, // cheekbones / zygomatic arch
    { y: 0.161, rx: 0.075, rz: 0.095, cz: -0.003, flatFront: 0.08 }, // eye socket level (1.581m)
    { y: 0.180, rx: 0.077, rz: 0.098, cz: -0.004, frontProtrude: 0.005, frontPower: 3 }, // supraorbital brow ridge
    { y: 0.212, rx: 0.078, rz: 0.099, cz:  0.000, backProtrude: 0.006 }, // forehead / parietal
    { y: 0.244, rx: 0.072, rz: 0.091, cz:  0.003 }, // upper cranium
    { y: 0.266, rx: 0.052, rz: 0.068, cz:  0.005 }, // near crown
    { y: 0.276, rx: 0.022, rz: 0.030, cz:  0.006 }  // cranial apex (hair adds +4mm to reach 0.280m = 1.700m)
  ], 36, true, true);

  // Sculpted Nose (bridge, dorsum, tip, nostrils)
  geos.nose = createLoftGeometry(THREE, [
    { y: 0.118, rx: 0.015, rz: 0.014, cz: -0.096, frontProtrude: 0.006, frontPower: 2 }, // nostrils / subnasale
    { y: 0.126, rx: 0.012, rz: 0.018, cz: -0.099, frontProtrude: 0.009, frontPower: 2 }, // pronasale (nose tip)
    { y: 0.144, rx: 0.009, rz: 0.014, cz: -0.095, frontProtrude: 0.005, frontPower: 2 }, // nasal dorsum
    { y: 0.162, rx: 0.008, rz: 0.009, cz: -0.091 }, // nasion (bridge between eyes)
    { y: 0.172, rx: 0.011, rz: 0.006, cz: -0.090 }  // glabella blend
  ], 16, true, true);

  // Lips (subtle upper & lower lip contour)
  geos.upperLip = new THREE.SphereGeometry(0.018, 14, 10);
  geos.upperLip.scale(1.15, 0.28, 0.55);
  geos.lowerLip = new THREE.SphereGeometry(0.016, 14, 10);
  geos.lowerLip.scale(1.05, 0.30, 0.55);

  // Ears (anatomical helix + lobe)
  geos.ear = createLoftGeometry(THREE, [
    { y: -0.026, rx: 0.006, rz: 0.010, cz:  0.002 }, // lobule (earlobe)
    { y: -0.010, rx: 0.009, rz: 0.015, cz:  0.004 }, // antitragus / concha
    { y:  0.010, rx: 0.011, rz: 0.017, cz:  0.005 }, // middle pinna
    { y:  0.024, rx: 0.009, rz: 0.014, cz:  0.003 }, // superior helix
    { y:  0.030, rx: 0.005, rz: 0.009, cz:  0.001 }
  ], 16, true, true);

  // Eyeball, Iris & Upper Eyelid
  geos.eyeball = new THREE.SphereGeometry(0.0115, 16, 14);
  geos.iris = new THREE.CylinderGeometry(0.0055, 0.0055, 0.002, 16);
  geos.iris.rotateX(Math.PI / 2);
  geos.pupil = new THREE.CylinderGeometry(0.0026, 0.0026, 0.0025, 12);
  geos.pupil.rotateX(Math.PI / 2);
  geos.eyelid = new THREE.SphereGeometry(0.0124, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.52);
  geos.eyebrow = new THREE.BoxGeometry(0.026, 0.0045, 0.006);

  // 11. Short Hair Cap (covers back of neck/occipital, temples, sideburns, and textured crown up to local y=0.280m = 1.700m)
  {
    const hSlices = [
      { y: 0.072, r: 0.062, rz: 0.078, cz: 0.016, startA: Math.PI * 0.18, endA: Math.PI * 0.82 }, // nape hairline
      { y: 0.115, r: 0.073, rz: 0.091, cz: 0.010, startA: Math.PI * 0.08, endA: Math.PI * 0.92 }, // occipital
      { y: 0.155, r: 0.079, rz: 0.097, cz: 0.003, startA: -Math.PI * 0.06, endA: Math.PI * 1.06 }, // above ears + sideburns
      { y: 0.192, r: 0.081, rz: 0.101, cz: 0.000, startA: -Math.PI * 0.16, endA: Math.PI * 1.16 }, // temples
      { y: 0.222, r: 0.081, rz: 0.103, cz: -0.002, startA: -Math.PI * 0.38, endA: Math.PI * 1.38 } // frontal hairline
    ];
    // Full crown cap built as complete loft with frontal hairline cut
    geos.hairCap = createLoftGeometry(THREE, [
      { y: 0.080, rx: 0.064, rz: 0.076, cz: 0.025, flatFront: 0.85, foldAmp: 0.0015, foldFreq: 14 },
      { y: 0.125, rx: 0.075, rz: 0.086, cz: 0.020, flatFront: 0.65, foldAmp: 0.0015, foldFreq: 16 },
      { y: 0.168, rx: 0.080, rz: 0.092, cz: 0.014, flatFront: 0.42, foldAmp: 0.0018, foldFreq: 18 },
      { y: 0.208, rx: 0.082, rz: 0.099, cz: 0.005, flatFront: 0.12, foldAmp: 0.0020, foldFreq: 16 },
      { y: 0.236, rx: 0.079, rz: 0.098, cz: -0.001, frontProtrude: 0.006, foldAmp: 0.0022, foldFreq: 14 }, // front hair quiff / fringe
      { y: 0.258, rx: 0.065, rz: 0.084, cz:  0.002, foldAmp: 0.0020, foldFreq: 12 },
      { y: 0.274, rx: 0.040, rz: 0.054, cz:  0.004, foldAmp: 0.0015, foldFreq: 10 },
      { y: 0.280, rx: 0.014, rz: 0.020, cz:  0.005 } // exact top of hair at 1.700m
    ], 36, true, true);

    geos.sideburn = new THREE.BoxGeometry(0.006, 0.032, 0.014);
  }

  // 12. Wristwatch (on left wrist)
  geos.watchStrap = new THREE.CylinderGeometry(0.0265, 0.0260, 0.016, 20);
  geos.watchCase = new THREE.CylinderGeometry(0.016, 0.016, 0.007, 20);
  geos.watchCase.rotateZ(Math.PI / 2);
  geos.watchFace = new THREE.CylinderGeometry(0.013, 0.013, 0.0075, 20);
  geos.watchFace.rotateZ(Math.PI / 2);

  // Jeans Back Pocket
  geos.backPocket = new THREE.BoxGeometry(0.072, 0.082, 0.008);

  GEO_CACHE.set('all', geos);
  return geos;
}

/**
 * Helper to create a Mesh with shadows enabled
 */
function makeMesh(THREE, geo, mat, name) {
  const m = new THREE.Mesh(geo, mat);
  if (name) m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Builds an articulated hand (left or right)
 * side = -1 for left hand (-X), +1 for right hand (+X)
 */
function buildHand(THREE, geos, skinMat, side) {
  const handGroup = new THREE.Group();
  handGroup.name = side < 0 ? 'hand_L' : 'hand_R';

  const palm = makeMesh(THREE, geos.palm, skinMat, 'palm');
  handGroup.add(palm);

  // 4 fingers arrayed across Z (from index at -Z to pinky at +Z)
  const fingerZ = [-0.026, -0.009, 0.008, 0.024];
  const fingerLenScale = [0.95, 1.04, 0.97, 0.78];
  const fingerThickScale = [1.0, 1.02, 0.95, 0.84];

  for (let i = 0; i < 4; i++) {
    const fMesh = makeMesh(THREE, geos.finger, skinMat, `finger_${i}`);
    fMesh.position.set(0, -0.074, fingerZ[i]);
    // Mirror finger curl so fingers curl toward the body midline (-X for right hand, +X for left hand)
    fMesh.scale.set(-side * fingerThickScale[i], fingerLenScale[i], fingerThickScale[i]);
    fMesh.rotation.z = side * 0.06;
    handGroup.add(fMesh);
  }

  // Thumb on anterior (-Z) side of palm
  const thumb = makeMesh(THREE, geos.thumb, skinMat, 'thumb');
  thumb.position.set(-side * 0.006, -0.030, -0.026);
  thumb.scale.set(-side, 1, 1);
  thumb.rotation.x = 0.25;
  thumb.rotation.z = side * 0.22;
  handGroup.add(thumb);

  return handGroup;
}

/**
 * Builds a complete sneaker with sole, upper, collar, tongue, and crossed laces
 */
function buildShoe(THREE, geos, mats, side) {
  const shoeGroup = new THREE.Group();
  shoeGroup.name = side < 0 ? 'shoe_L' : 'shoe_R';

  const sole = makeMesh(THREE, geos.shoeSole, mats.sole, 'sole');
  shoeGroup.add(sole);

  const upper = makeMesh(THREE, geos.shoeUpper, mats.shoeUpper, 'upper');
  shoeGroup.add(upper);

  // Tongue along instep
  const tongue = makeMesh(THREE, geos.shoeTongue, mats.shoeAccent, 'tongue');
  tongue.position.set(0, -0.008, -0.048);
  tongue.rotation.x = 0.46;
  shoeGroup.add(tongue);

  // 4 crossed laces along the vamp/throat
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const ly = -0.001 - t * 0.018;
    const lz = -0.026 - t * 0.042;
    const laceA = makeMesh(THREE, geos.shoeLace, mats.sole, `laceA_${i}`);
    laceA.position.set(0, ly, lz);
    laceA.rotation.y = 0.28;
    shoeGroup.add(laceA);

    const laceB = makeMesh(THREE, geos.shoeLace, mats.sole, `laceB_${i}`);
    laceB.position.set(0, ly + 0.001, lz);
    laceB.rotation.y = -0.28;
    shoeGroup.add(laceB);
  }

  return shoeGroup;
}

/**
 * Main exported asset factory
 */
export default function create(THREE, opts = {}) {
  const id = opts.id ?? 'pedestrian';
  const targetHeight = typeof opts.height === 'number' && opts.height > 0 ? opts.height : 1.70;
  const pose = opts.pose === 'walking' ? 'walking' : 'standing';
  const shirtHex = opts.color ?? '#3b5b8a';
  const skinHex = opts.skin ?? '#c58c64';
  const prng = makePRNG(opts.seed ?? id);

  const geos = getBaseGeometries(THREE);

  // Materials (cached where color-independent, or keyed by color)
  const shirtColor = new THREE.Color(shirtHex);
  const skinColor = new THREE.Color(skinHex);

  const clothTex = getFabricTexture(THREE, 'cloth');
  const denimTex = getFabricTexture(THREE, 'denim');
  const hairTex = getFabricTexture(THREE, 'hair');
  const soleTex = getFabricTexture(THREE, 'sole');

  const mats = {
    jacket: new THREE.MeshStandardMaterial({
      color: shirtColor,
      map: clothTex,
      roughness: 0.78,
      metalness: 0.02
    }),
    jacketTrim: new THREE.MeshStandardMaterial({
      color: shirtColor.clone().multiplyScalar(0.76),
      map: clothTex,
      roughness: 0.82,
      metalness: 0.04
    }),
    undershirt: new THREE.MeshStandardMaterial({
      color: 0xe8ecf0,
      map: clothTex,
      roughness: 0.85,
      metalness: 0.0
    }),
    jeans: new THREE.MeshStandardMaterial({
      color: 0x1f2d42,
      map: denimTex,
      roughness: 0.86,
      metalness: 0.02
    }),
    jeanCuff: new THREE.MeshStandardMaterial({
      color: 0x35465e,
      map: denimTex,
      roughness: 0.88,
      metalness: 0.02
    }),
    belt: new THREE.MeshStandardMaterial({
      color: 0x241a14,
      roughness: 0.45,
      metalness: 0.08
    }),
    metal: new THREE.MeshStandardMaterial({
      color: 0xc8cdd2,
      roughness: 0.22,
      metalness: 0.88
    }),
    skin: new THREE.MeshPhysicalMaterial({
      color: skinColor,
      roughness: 0.58,
      metalness: 0.0,
      clearcoat: 0.06,
      clearcoatRoughness: 0.65
    }),
    lip: new THREE.MeshPhysicalMaterial({
      color: skinColor.clone().lerp(new THREE.Color(0x9e4b48), 0.32),
      roughness: 0.48,
      metalness: 0.0,
      clearcoat: 0.12,
      clearcoatRoughness: 0.5
    }),
    hair: new THREE.MeshStandardMaterial({
      color: 0x221a15,
      map: hairTex,
      roughness: 0.72,
      metalness: 0.04
    }),
    sclera: new THREE.MeshPhysicalMaterial({
      color: 0xf6f6f4,
      roughness: 0.15,
      clearcoat: 0.85,
      clearcoatRoughness: 0.1
    }),
    iris: new THREE.MeshPhysicalMaterial({
      color: 0x4b3828,
      roughness: 0.2,
      clearcoat: 0.9
    }),
    pupil: new THREE.MeshBasicMaterial({
      color: 0x080808
    }),
    sole: new THREE.MeshStandardMaterial({
      color: 0xf0f2f5,
      map: soleTex,
      roughness: 0.75,
      metalness: 0.0
    }),
    shoeUpper: new THREE.MeshStandardMaterial({
      color: 0x272b33,
      map: clothTex,
      roughness: 0.76,
      metalness: 0.04
    }),
    shoeAccent: new THREE.MeshStandardMaterial({
      color: 0x3d434f,
      roughness: 0.8,
      metalness: 0.04
    }),
    sock: new THREE.MeshStandardMaterial({
      color: 0xd8dce0,
      roughness: 0.9
    }),
    watchDial: new THREE.MeshStandardMaterial({
      color: 0x151a22,
      roughness: 0.2,
      metalness: 0.4
    })
  };

  // Root Group
  const root = new THREE.Group();
  root.name = id;

  // Internal figure group built at canonical 1.70 m height, then scaled uniformly to targetHeight
  const figure = new THREE.Group();
  figure.name = 'pedestrian_figure';
  root.add(figure);

  const isWalking = pose === 'walking';
  // Slight bobbing drop during mid-stride walking so overall height stays ~1.70 m
  const pelvisY = isWalking ? 0.825 : 0.840;

  // --- 1. PELVIS & BELT ---
  const pelvisGroup = new THREE.Group();
  pelvisGroup.name = 'pelvis';
  pelvisGroup.position.set(0, pelvisY, 0);
  if (isWalking) {
    pelvisGroup.rotation.y = 0.06; // subtle pelvic counter-rotation in stride
  }
  figure.add(pelvisGroup);

  pelvisGroup.add(makeMesh(THREE, geos.pelvis, mats.jeans, 'hips_mesh'));
  pelvisGroup.add(makeMesh(THREE, geos.belt, mats.belt, 'belt_mesh'));

  const buckle = makeMesh(THREE, geos.buckle, mats.metal, 'belt_buckle');
  buckle.position.set(0, 0.108, -0.109);
  pelvisGroup.add(buckle);

  // Two rear jeans pockets on +Z
  for (const side of [-1, 1]) {
    const bp = makeMesh(THREE, geos.backPocket, mats.jeans, `back_pocket_${side < 0 ? 'L' : 'R'}`);
    bp.position.set(side * 0.072, 0.018, 0.118);
    bp.rotation.y = side * 0.24;
    bp.rotation.x = -0.06;
    pelvisGroup.add(bp);
  }

  // --- 2. TORSO, COLLAR, ZIPPER & POCKET ---
  const torsoGroup = new THREE.Group();
  torsoGroup.name = 'torso';
  torsoGroup.position.set(0, pelvisY, 0);
  if (isWalking) {
    torsoGroup.rotation.x = -0.035; // very slight forward lean when walking (-Z is forward)
    torsoGroup.rotation.y = -0.05;  // thorax counter-rotation
  }
  figure.add(torsoGroup);

  torsoGroup.add(makeMesh(THREE, geos.torso, mats.jacket, 'jacket_body'));
  torsoGroup.add(makeMesh(THREE, geos.undershirt, mats.undershirt, 'undershirt'));
  torsoGroup.add(makeMesh(THREE, geos.collar, mats.jacketTrim, 'jacket_collar'));
  torsoGroup.add(makeMesh(THREE, geos.placket, mats.jacketTrim, 'jacket_placket'));

  const chestPocket = makeMesh(THREE, geos.chestPocket, mats.jacketTrim, 'chest_pocket');
  chestPocket.position.set(-0.078, 0.365, -0.118);
  chestPocket.rotation.y = 0.22;
  chestPocket.rotation.z = -0.05;
  torsoGroup.add(chestPocket);

  // --- 3. HEAD, NECK, FACE & HAIR ---
  const headGroup = new THREE.Group();
  headGroup.name = 'head_group';
  headGroup.position.set(0, 0.580, 0); // relative to torso (0.840 + 0.580 = 1.420m world)
  if (isWalking) {
    headGroup.rotation.x = 0.035; // keep gaze level while torso leans
    headGroup.rotation.y = 0.05;
  }
  torsoGroup.add(headGroup);

  headGroup.add(makeMesh(THREE, geos.neckAndHead, mats.skin, 'head_skin'));
  headGroup.add(makeMesh(THREE, geos.nose, mats.skin, 'nose'));
  headGroup.add(makeMesh(THREE, geos.hairCap, mats.hair, 'hair_cap'));

  // Lips
  const upperLip = makeMesh(THREE, geos.upperLip, mats.lip, 'upper_lip');
  upperLip.position.set(0, 0.104, -0.092);
  headGroup.add(upperLip);

  const lowerLip = makeMesh(THREE, geos.lowerLip, mats.lip, 'lower_lip');
  lowerLip.position.set(0, 0.095, -0.090);
  headGroup.add(lowerLip);

  // Ears & Sideburns
  for (const side of [-1, 1]) {
    const ear = makeMesh(THREE, geos.ear, mats.skin, `ear_${side < 0 ? 'L' : 'R'}`);
    ear.position.set(side * 0.076, 0.148, 0.002);
    ear.rotation.y = -side * 0.18;
    ear.rotation.z = -side * 0.06;
    headGroup.add(ear);

    const sb = makeMesh(THREE, geos.sideburn, mats.hair, `sideburn_${side < 0 ? 'L' : 'R'}`);
    sb.position.set(side * 0.075, 0.164, -0.018);
    sb.rotation.y = side * 0.15;
    headGroup.add(sb);
  }

  // Eyes, Irises, Pupils, Eyelids & Eyebrows (at local y = 0.161 -> world y = 1.581m = 1.70 * 0.93)
  for (const side of [-1, 1]) {
    const eyeX = side * 0.031;
    const eyeY = 0.161;
    const eyeZ = -0.083;

    const eyeball = makeMesh(THREE, geos.eyeball, mats.sclera, `eyeball_${side < 0 ? 'L' : 'R'}`);
    eyeball.position.set(eyeX, eyeY, eyeZ);
    headGroup.add(eyeball);

    const iris = makeMesh(THREE, geos.iris, mats.iris, `iris_${side < 0 ? 'L' : 'R'}`);
    iris.position.set(eyeX, eyeY, eyeZ - 0.0108);
    headGroup.add(iris);

    const pupil = makeMesh(THREE, geos.pupil, mats.pupil, `pupil_${side < 0 ? 'L' : 'R'}`);
    pupil.position.set(eyeX, eyeY, eyeZ - 0.0112);
    headGroup.add(pupil);

    const eyelid = makeMesh(THREE, geos.eyelid, mats.skin, `eyelid_${side < 0 ? 'L' : 'R'}`);
    eyelid.position.set(eyeX, eyeY, eyeZ);
    eyelid.rotation.x = -0.25;
    headGroup.add(eyelid);

    const brow = makeMesh(THREE, geos.eyebrow, mats.hair, `eyebrow_${side < 0 ? 'L' : 'R'}`);
    brow.position.set(eyeX, eyeY + 0.019, eyeZ - 0.010);
    brow.rotation.y = side * 0.22;
    brow.rotation.z = -side * 0.06;
    headGroup.add(brow);
  }

  // --- 4. ARMS, SLEEVES, WRISTWATCH & HANDS ---
  // Left (-1) and Right (+1) arms attached to shoulder pivots at local torso (side * 0.186, 0.515, 0.004)
  for (const side of [-1, 1]) {
    const shoulderPivot = new THREE.Group();
    shoulderPivot.name = `shoulder_${side < 0 ? 'L' : 'R'}`;
    shoulderPivot.position.set(side * 0.185, 0.515, 0.004);

    // Standing: arms hang naturally with a slight outward drape (~3 deg) so total width across outer forearms/sleeves is 0.500 m
    // Walking: contra-lateral arm swing (Left arm swings forward when Right leg steps forward)
    if (isWalking) {
      shoulderPivot.rotation.x = side < 0 ? 0.34 : -0.28; // +rotX swings arm -Y tip toward -Z (forward)
      shoulderPivot.rotation.z = side * 0.045;
    } else {
      shoulderPivot.rotation.x = -0.04; // upper arm angled slightly back so elbow bend brings hand to neutral Z
      shoulderPivot.rotation.z = side * 0.048; // brings outer upper arm/forearm exactly to +/- 0.250m (width = 0.500m)
    }
    torsoGroup.add(shoulderPivot);

    const upperArmMesh = makeMesh(THREE, geos.upperArm, mats.jacket, `upper_arm_${side < 0 ? 'L' : 'R'}`);
    shoulderPivot.add(upperArmMesh);

    const elbowPivot = new THREE.Group();
    elbowPivot.name = `elbow_${side < 0 ? 'L' : 'R'}`;
    elbowPivot.position.set(0, -0.275, 0);
    // Natural forward elbow flexion (+rotX moves forearm tip toward -Z)
    elbowPivot.rotation.x = isWalking ? (side < 0 ? 0.38 : 0.22) : 0.18;
    elbowPivot.rotation.z = -side * 0.035; // slight inward forearm carry
    shoulderPivot.add(elbowPivot);

    const forearmMesh = makeMesh(THREE, geos.forearm, mats.jacket, `forearm_${side < 0 ? 'L' : 'R'}`);
    elbowPivot.add(forearmMesh);

    const wristMesh = makeMesh(THREE, geos.wrist, mats.skin, `wrist_${side < 0 ? 'L' : 'R'}`);
    elbowPivot.add(wristMesh);

    // Add wristwatch to Left wrist (side < 0)
    if (side < 0) {
      const watchGroup = new THREE.Group();
      watchGroup.name = 'wristwatch';
      watchGroup.position.set(0, -0.244, 0);
      watchGroup.add(makeMesh(THREE, geos.watchStrap, mats.belt, 'watch_strap'));

      const wCase = makeMesh(THREE, geos.watchCase, mats.metal, 'watch_case');
      wCase.position.set(-0.025, 0, 0);
      watchGroup.add(wCase);

      const wFace = makeMesh(THREE, geos.watchFace, mats.watchDial, 'watch_face');
      wFace.position.set(-0.0255, 0, 0);
      watchGroup.add(wFace);

      elbowPivot.add(watchGroup);
    }

    const hand = buildHand(THREE, geos, mats.skin, side);
    hand.position.set(0, -0.255, 0);
    elbowPivot.add(hand);
  }

  // --- 5. LEGS, JEANS & SNEAKERS ---
  // Hip joints at (side * 0.092, pelvisY, 0.004)
  for (const side of [-1, 1]) {
    const hipPivot = new THREE.Group();
    hipPivot.name = `hip_${side < 0 ? 'L' : 'R'}`;
    hipPivot.position.set(side * 0.092, pelvisY, 0.004);

    if (isWalking) {
      // Left leg stepping back (-0.28), Right leg stepping forward (+0.32 moves -Y leg toward -Z)
      hipPivot.rotation.x = side < 0 ? -0.28 : 0.32;
      hipPivot.rotation.z = side * 0.012;
    } else {
      // Relaxed standing stance: feet slightly apart, very subtle knee lock
      hipPivot.rotation.x = 0.015;
      hipPivot.rotation.z = side * 0.015;
    }
    figure.add(hipPivot);

    const thighMesh = makeMesh(THREE, geos.thigh, mats.jeans, `thigh_${side < 0 ? 'L' : 'R'}`);
    hipPivot.add(thighMesh);

    const kneePivot = new THREE.Group();
    kneePivot.name = `knee_${side < 0 ? 'L' : 'R'}`;
    kneePivot.position.set(0, -0.390, 0);

    if (isWalking) {
      // Negative rotX bends lower leg backward (+Z) at the knee
      kneePivot.rotation.x = side < 0 ? -0.32 : -0.14;
    } else {
      kneePivot.rotation.x = -0.015;
      kneePivot.rotation.z = -side * 0.015;
    }
    hipPivot.add(kneePivot);

    const calfMesh = makeMesh(THREE, geos.calf, mats.jeans, `calf_${side < 0 ? 'L' : 'R'}`);
    kneePivot.add(calfMesh);

    const cuffMesh = makeMesh(THREE, geos.jeanCuff, mats.jeanCuff, `jean_cuff_${side < 0 ? 'L' : 'R'}`);
    kneePivot.add(cuffMesh);

    const sockMesh = makeMesh(THREE, geos.sock, mats.sock, `sock_${side < 0 ? 'L' : 'R'}`);
    sockMesh.position.set(0, -0.365, 0);
    kneePivot.add(sockMesh);

    const anklePivot = new THREE.Group();
    anklePivot.name = `ankle_${side < 0 ? 'L' : 'R'}`;
    anklePivot.position.set(0, -0.375, 0);

    if (isWalking) {
      anklePivot.rotation.x = side < 0 ? 0.22 : -0.12;
      anklePivot.rotation.y = -side * 0.05;
    } else {
      // Natural outward toe splay (~4.5 deg)
      anklePivot.rotation.y = -side * 0.08;
    }
    kneePivot.add(anklePivot);

    const shoe = buildShoe(THREE, geos, mats, side);
    anklePivot.add(shoe);
  }

  // Uniformly scale to targetHeight (canonical height is 1.70 m)
  const scaleFactor = targetHeight / 1.70;
  figure.scale.setScalar(scaleFactor);

  // Compute exact world alignment so feet sit flush on y = 0 and standing Z is centered on 0
  root.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(figure);
  const minY = bbox.min.y;
  const centerZ = (bbox.min.z + bbox.max.z) * 0.5;
  figure.position.y -= minY;
  if (!isWalking) {
    figure.position.z -= centerZ;
  }

  const eyeHeight = Number((targetHeight * 0.93).toFixed(4));
  const width = Number((0.50 * scaleFactor).toFixed(4));
  const length = Number((0.30 * scaleFactor).toFixed(4));

  root.userData = {
    assetType: 'pedestrian',
    height: targetHeight,
    eyeHeight,
    eyePoint: [0, eyeHeight, Number((-0.08 * scaleFactor).toFixed(4))],
    pose,
    dims: {
      length,
      width,
      height: targetHeight
    }
  };

  return root;
}
