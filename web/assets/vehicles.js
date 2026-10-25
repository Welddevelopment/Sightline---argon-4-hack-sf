// Sightline asset library — vehicle dispatcher + passenger cars (sedan / suv / pickup / van).
// Owner: VEH-CARS. Browser + Node; no DOM at import. THREE is always passed in.
//
//   createVehicle(THREE, type, {id, color, lights=false}) -> THREE.Group
//     sedan/suv/pickup/van: procedural lofted bodies here
//     truck_tractor/semitrailer/box_truck/bus -> createHeavyVehicle (vehicles_heavy.js)
//     motorcycle/bicycle -> createSmallVehicle, pedestrian -> createPedestrian (vehicles_small.js)
//     anything missing / throwing -> labeled box of catalog dims.
// Contract (SPEC WORLD CONTRACT v2): origin = ground-level footprint centre, rotation.y=0 faces -Z,
// userData {assetType:'vehicle', vehicleType, dims, driverEye, setLights(on), wheels, roll(dist)},
// child meshes headlight_L/R, taillight_L/R. No brand marks; plates are blank.
import {
  surfacePatch, getMaterials, makeWheel, loft, curve, roundedBox, cachedGeo, makeLamp, attachLightAPI, finalizeVehicle, smoothstep, makeInterior, crispX,
  stackGeometry, stackHalf, surfaceCaster, hitPatch, hitRibbon, mirrorX,
} from './vehicle_parts.js';
import * as GV from './gltf_vehicle.js';

let heavy = null, small = null;
try { heavy = await import('./vehicles_heavy.js'); } catch { heavy = null; }
try { small = await import('./vehicles_small.js'); } catch { small = null; }

export const VEHICLE_DIMS = {
  sedan: { length: 4.9, width: 1.9, height: 1.45 },
  suv: { length: 4.8, width: 1.95, height: 1.75 },
  pickup: { length: 5.9, width: 2.0, height: 1.9 },
  van: { length: 5.3, width: 2.0, height: 2.0 },
  box_truck: { length: 7.5, width: 2.5, height: 3.4 },
  bus: { length: 12.2, width: 2.55, height: 3.2 },
  truck_tractor: { length: 6.5, width: 2.5, height: 3.6 },
  semitrailer: { length: 16.2, width: 2.6, height: 4.1 },
  motorcycle: { length: 2.2, width: 0.8, height: 1.2 },
  bicycle: { length: 1.8, width: 0.6, height: 1.1 },
};
const ALIASES = { car: 'sedan', automobile: 'sedan', passenger_car: 'sedan', coupe: 'sedan', hatchback: 'sedan', wagon: 'sedan',
  crossover: 'suv', jeep: 'suv', truck: 'pickup', pickup_truck: 'pickup', minivan: 'van', cargo_van: 'van',
  semi: 'truck_tractor', tractor: 'truck_tractor', tractor_trailer: 'truck_tractor', trailer: 'semitrailer', semi_trailer: 'semitrailer',
  boxtruck: 'box_truck', straight_truck: 'box_truck', school_bus: 'bus', transit_bus: 'bus', motorbike: 'motorcycle', bike: 'bicycle' };

export function normalizeType(type) {
  const t = String(type || 'sedan').toLowerCase().trim().replace(/[\s-]+/g, '_');
  return VEHICLE_DIMS[t] || t === 'pedestrian' ? t : (ALIASES[t] || t);
}

// ================================================================== loop-stack car bodies (v3)
// Each car = a SPEC of side-view / plan-view curves (u = metres from the front bumper, y up, x half-widths).
// Body: stack of plan loops (bottom centre -> rocker -> sides -> shoulder -> crowned top) with superellipse corners,
// so bumpers wrap in plan and the hood/deck crown is continuous. Greenhouse: its own stack (belt -> rail -> roof) with
// windshield / DLO / pillars addressed by loop index (straight, clean edges). Wheel arches are cut on a circle and
// trimmed with a lip + dark liner. Lamps, grille, seams, plates, handles, wipers are conforming patches raycast onto
// the finished shell (offset a few mm), so they sit on the real surface instead of floating boxes.
const NQF = 18, NQR = 16;
const G = { PAINT: 0, TRIM: 1, UNDER: 2, GLASS: 3, PLASTIC: 4, INTERIOR: 5, GLOSS: 6, CHROME: 7, ALLOY: 8, PRIV: 9 };
function gMats(THREE, color) {
  const M = getMaterials(THREE);
  return [M.paint(color), M.trim, M.underbody, M.glassClear, M.plastic, M.interior, M.trimGloss, M.chrome, M.alloy, M.glassPrivacy];
}
const C = (pts) => curve(pts);
const K = (v) => (typeof v === 'number' ? () => v : typeof v === 'function' ? v : curve(v));

export const SPECS = {
  sedan: {
    L: 4.9, W: 1.9, H: 1.45,
    wheel: { r: 0.345, w: 0.235, rim: 'alloy' }, axles: [0.96, 3.81], arch: { R: 0.388, yc: 0.352, lip: 0.011 },
    body: {
      yBot: [[0, 0.27], [0.18, 0.225], [0.45, 0.195], [0.8, 0.185], [4.2, 0.185], [4.55, 0.205], [4.75, 0.245], [4.9, 0.3]],
      yS: [[0, 0.75], [0.12, 0.765], [0.35, 0.795], [0.8, 0.845], [1.3, 0.885], [1.75, 0.915], [2.2, 0.94], [3.0, 0.962], [3.8, 0.982], [4.3, 0.995], [4.9, 0.99]],
      half: [[0, 0.83], [0.35, 0.875], [0.9, 0.9], [2.0, 0.905], [3.5, 0.905], [4.3, 0.898], [4.9, 0.875]],
      zF: [[0, 0.17], [0.1, 0.085], [0.25, 0.03], [0.42, 0.006], [0.55, 0], [0.68, 0.01], [0.8, 0.03], [0.9, 0.06], [0.96, 0.085], [1, 0.11]],
      // rear (distance in from the rear end): bumper proud, crisp bumper-top shelf at f~0.45, trunk face above it
      zR: [[0, 0.2], [0.12, 0.075], [0.25, 0.022], [0.38, 0.003], [0.43, 0], [0.445, 0.004], [0.46, 0.03], [0.6, 0.034], [0.8, 0.04], [0.92, 0.052], [0.97, 0.064], [1, 0.08]],
      dF: [[0, 0.4], [0.5, 0.44], [1, 0.44]], nF: 2.9, dR: [[0, 0.28], [0.5, 0.31], [1, 0.34]], nR: 3.3,
      s: [[0, 0.06], [0.04, 0.035], [0.1, 0.017], [0.2, 0.01], [0.3, 0.007], [0.34, 0.0035], [0.365, 0.0065], [0.5, 0.004], [0.7, 0.0012], [0.84, 0], [0.86, 0.006], [0.93, 0.02], [0.97, 0.03], [1, 0.042]],
      fLevels: [0, 0.015, 0.04, 0.08, 0.13, 0.18, 0.23, 0.28, 0.32, 0.34, 0.355, 0.37, 0.4, 0.43, 0.445, 0.46, 0.48, 0.52, 0.58, 0.64, 0.7, 0.75, 0.79, 0.82, 0.84, 0.855, 0.87, 0.89, 0.92, 0.95, 0.975, 0.99, 1],
      roll: { r: 0.03, crown: 0.035 },
      lowerFront: 0.11, lowerRear: 0.2,
    },
    gh: {
      dGH: 0.06,
      yRail: [[2.2, 1.335], [2.6, 1.37], [3.0, 1.385], [3.35, 1.372], [3.7, 1.335]],
      roofTop: [[2.25, 1.37], [2.5, 1.418], [2.9, 1.45], [3.3, 1.436], [3.6, 1.39]],
      zF: (f) => 1.78 + 0.68 * f - 0.05 * Math.sin(Math.PI * f),
      zR: (f) => 4.22 - 0.8 * f + 0.05 * Math.sin(Math.PI * f),
      dF: [[0, 0.22], [1, 0.13]], dR: [[0, 0.17], [1, 0.12]], nF: 2.3, nR: 2.5,
      tumble: (f) => 0.15 * f + 0.03 * f * f,
      side: [
        { to: (f, a) => a + 0.1, n: 3, mat: 'PAINT' },            // A pillar
        { to: () => 2.8, n: 12, mat: 'GLASS' },                    // front door glass
        { to: () => 2.885, n: 3, mat: 'GLOSS' },                   // B pillar (gloss black)
        { to: (f) => 3.88 - 0.6 * f, n: 12, mat: 'GLASS' },      // rear door glass
        { to: 'b', n: 6, mat: 'PAINT' },                           // C pillar / sail
      ],
      fLevels: [-0.25, 0, 0.035, 0.07, 0.14, 0.24, 0.36, 0.5, 0.64, 0.78, 0.88, 0.93, 0.965, 1],
      roofT: [0.012, 0.03, 0.055, 0.085, 0.11, 0.14, 0.19, 0.27, 0.37, 0.5, 0.64, 0.78, 0.9, 1],
      frame: 0.9, belt: 0.035, beltMat: 'CHROME', header: 0.1, headerR: 0.1, uc: 2.94, drip: true,
    },
    eye: { u: 2.82, y: 1.16, x: -0.37 },
    mirror: { u: 2.16, dy: 0.065 },
    headY: 0.655,
    rows: 2,
    D: {
      seams: [
        [[1.9, 0.31], [1.9, 0.72], [1.95, 0.9]],                         // front door leading edge
        [[2.85, 0.27], [2.85, 0.93]],                                     // B gap
        (f) => { const R2 = f.R + 0.045, ax = 3.81, p = [[3.74, f.yS(3.74) - 0.004]];
          for (let i = 0; i <= 10; i++) { const a = Math.PI * (0.38 + 0.5 * (i / 10)); p.push([ax - R2 * Math.cos(a), f.yc + R2 * Math.sin(a)]); }
          p.push([ax - R2 - 0.005, 0.31]); return p; },
        [[1.9, 0.31], [3.37, 0.31]],                                     // door bottoms
      ],
      fuel: [4.21, 0.86, 0.085, 0.06],
      handles: [2.55, 3.5], handleDrop: 0.1,
      head: { s0: 0.38, s1: 1.02, lo: (t) => 0.652 - 0.012 * t, hi: (t) => 0.712 + 0.035 * Math.pow(t, 1.4), drl: (t) => 0.651, proj: [0.6, 0.75], projY: 0.69 },
      hoodFront: { s: 0.39, y: 0.735 }, hoodSide: { x: 0.72, u0: 0.33, u1: 1.68 },
      grille: { y0: 0.33, y1: 0.61, w0: 0.5, w1: 0.42, bars: 7, surround: 0.012 },
      intake: { y: 0.25, h: 0.04, w: 0.56, taper: 0.03 },
      vent: { s0: 0.68, s1: 0.88, lo: (t) => 0.29 + 0.02 * t, hi: (t) => 0.43 + 0.05 * t },
      plateF: 0.37,
      tail: { s0: 0.33, s1: 1.04, lo: (t) => 0.818 - 0.045 * Math.pow(t, 1.2), hi: (t) => 0.928 - 0.006 * t, rev: [0.38, 0.5, 0.828, 0.858] },
      trunk: { s: 0.31, y: 0.795, x: 0.6, u0: 4.28, u1: 4.8 },
      plateR: 0.6, garnish: { w: 0.3, y: 0.815 }, bumperSeam: { s: 1.0, y: 0.6 },
      reflector: [0.72, 0.86, 0.47], exhaust: [0.42, 0.255, 0.14],
    },
  },
};

SPECS.suv = {
  L: 4.8, W: 1.95, H: 1.75,
  wheel: { r: 0.37, w: 0.245, rim: 'alloy' }, axles: [0.93, 3.78], arch: { R: 0.425, yc: 0.385, lip: 0.026 }, archFlare: true,
  body: {
    yBot: [[0, 0.44], [0.2, 0.34], [0.5, 0.295], [0.8, 0.28], [4.1, 0.28], [4.45, 0.31], [4.65, 0.37], [4.8, 0.45]],
    yS: [[0, 0.93], [0.15, 0.95], [0.4, 0.975], [0.9, 1.02], [1.4, 1.05], [1.6, 1.062], [2.2, 1.078], [3.5, 1.095], [4.3, 1.105], [4.8, 1.1]],
    half: [[0, 0.85], [0.35, 0.9], [0.9, 0.922], [2.0, 0.925], [3.6, 0.925], [4.4, 0.915], [4.8, 0.89]],
    zF: [[0, 0.16], [0.1, 0.065], [0.25, 0.02], [0.42, 0.003], [0.58, 0], [0.74, 0.008], [0.86, 0.022], [0.93, 0.042], [0.97, 0.06], [1, 0.085]],
    zR: [[0, 0.17], [0.12, 0.065], [0.25, 0.02], [0.36, 0.002], [0.4, 0], [0.415, 0.004], [0.43, 0.026], [0.6, 0.03], [0.8, 0.036], [0.93, 0.046], [1, 0.065]],
    dF: [[0, 0.38], [0.5, 0.4], [1, 0.42]], nF: 3.0, dR: [[0, 0.3], [1, 0.32]], nR: 3.2,
    s: [[0, 0.06], [0.04, 0.035], [0.1, 0.016], [0.18, 0.008], [0.21, 0.004], [0.35, 0.001], [0.55, 0], [0.7, 0.002], [0.8, 0.005], [0.84, 0.006], [0.87, 0.011], [0.93, 0.02], [0.97, 0.03], [1, 0.04]],
    fLevels: [0, 0.015, 0.04, 0.08, 0.13, 0.18, 0.21, 0.24, 0.26, 0.3, 0.36, 0.4, 0.415, 0.43, 0.45, 0.5, 0.56, 0.62, 0.68, 0.74, 0.79, 0.82, 0.84, 0.855, 0.87, 0.89, 0.92, 0.95, 0.975, 0.99, 1],
    roll: { r: 0.03, crown: 0.03 },
    lowerFront: 0.0, lowerRear: 0.0,
  },
  clad: (u, q) => 0.5,
  gh: {
    dGH: 0.055,
    yRail: [[2.0, 1.6], [3.4, 1.625], [4.6, 1.6]],
    roofTop: [[2.3, 1.64], [2.6, 1.672], [3.1, 1.69], [3.9, 1.69], [4.4, 1.672], [4.7, 1.64]],
    zF: (f) => 1.55 + 0.8 * f - 0.03 * Math.sin(Math.PI * f),
    zR: (f) => 4.73 - 0.22 * f + 0.015 * Math.sin(Math.PI * f),
    dF: [[0, 0.3], [1, 0.16]], dR: [[0, 0.16], [1, 0.12]], nF: 2.4, nR: 2.8,
    tumble: (f) => 0.12 * f + 0.025 * f * f,
    side: [
      { to: (f, a) => a + 0.09, n: 3, mat: 'PAINT' },
      { to: () => 2.78, n: 12, mat: 'GLASS' },
      { to: () => 2.875, n: 3, mat: 'GLOSS' },
      { to: (f) => 3.72 - 0.04 * f, n: 12, mat: 'PRIV' },
      { to: (f) => 3.8 - 0.04 * f, n: 2, mat: 'GLOSS' },
      { to: (f) => 4.42 - 0.2 * f, n: 7, mat: 'PRIV' },
      { to: 'b', n: 4, mat: 'GLOSS' },
    ],
    fLevels: [-0.25, 0, 0.035, 0.07, 0.14, 0.24, 0.36, 0.5, 0.64, 0.78, 0.88, 0.93, 0.965, 1],
    roofT: [0.012, 0.03, 0.055, 0.085, 0.11, 0.14, 0.19, 0.27, 0.37, 0.5, 0.64, 0.78, 0.9, 1],
    rearMat: (q) => (q.lv.kind === 'gh' && q.lv.f < 0.22 ? 'PAINT' : 'PRIV'),
    frame: 0.93, belt: 0.035, beltMat: 'GLOSS', header: 0.1, headerR: 0.09, uc: 3.3,
  },
  eye: { u: 2.72, y: 1.42, x: -0.38 },
  mirror: { u: 1.92, dy: 0.075 },
  headY: 0.82,
  rows: 2,
  D: {
    seams: [
      [[1.72, 0.52], [1.72, 0.85], [1.76, 1.04]],
      [[2.83, 0.48], [2.83, 1.07]],
      (f) => { const R2 = f.R + 0.06, ax = 3.78, p = [[3.76, f.yS(3.76) - 0.004]];
        for (let i = 0; i <= 10; i++) { const a = Math.PI * (0.36 + 0.42 * (i / 10)); p.push([ax - R2 * Math.cos(a), f.yc + R2 * Math.sin(a)]); }
        return p; },
      [[1.72, 0.52], [3.3, 0.52]],
    ],
    fuel: [4.12, 0.95, 0.085, 0.065],
    handles: [2.45, 3.45], handleDrop: 0.11,
    head: { s0: 0.47, s1: 1.04, lo: (t) => 0.845 - 0.015 * t, hi: (t) => 0.905 + 0.03 * Math.pow(t, 1.3), drl: (t) => 0.845, proj: [0.7, 0.83], projY: 0.875 },
    hoodFront: { s: 0.46, y: 0.92 }, hoodSide: { x: 0.74, u0: 0.32, u1: 1.52 },
    grille: { y0: 0.55, y1: 0.86, w0: 0.42, w1: 0.45, bars: 6, surround: 0.016 },
    intake: { y: 0.41, h: 0.08, w: 0.58, taper: 0.03 },
    skid: { y: 0.33, h: 0.06, w: 0.5 },
    vent: { s0: 0.74, s1: 0.94, lo: (t) => 0.44 + 0.02 * t, hi: (t) => 0.53 + 0.03 * t },
    plateF: 0.6, plateFOff: 0.014,
    tail: { s0: 0.42, s1: 1.04, lo: (t) => 0.985 - 0.06 * Math.pow(t, 1.5), hi: (t) => 1.045 + 0.02 * t, rev: [0.47, 0.6, 0.995, 1.022] },
    trunk: { s: 0.84, y: 0.62 },
    plateR: 0.74, garnish: { w: 0.4, y: 0.93 }, bumperSeam: { s: 1.0, y: 0.6 },
    reflector: [0.78, 0.92, 0.5], skidR: { y: 0.36, h: 0.05, w: 0.48 },
    roofRails: { x: 0.56, u0: 2.7, u1: 4.4, h: 0.05, r: 0.016 },
    spoiler: { w: 0.62, u0: 4.48, u1: 4.6 },
  },
};

SPECS.pickup = {
  L: 5.9, W: 2.0, H: 1.9,
  wheel: { r: 0.4, w: 0.275, rim: 'alloy' }, axles: [0.98, 4.66], arch: { R: 0.465, yc: 0.415, lip: 0.024 }, archFlare: true,
  extraDense: [[3.85, 4.12], [5.7, 5.9]],
  body: {
    yBot: [[0, 0.5], [0.2, 0.44], [0.6, 0.44], [1.4, 0.47], [3.95, 0.48], [4.15, 0.6], [5.75, 0.6], [5.9, 0.62]],
    yS: [[0, 1.11], [0.1, 1.13], [0.5, 1.17], [1.4, 1.225], [1.65, 1.25], [3.9, 1.275], [5.9, 1.29]],
    half: [[0, 0.875], [0.3, 0.905], [0.8, 0.915], [5.5, 0.915], [5.9, 0.905]],
    zF: [[0, 0.11], [0.12, 0.05], [0.28, 0.015], [0.45, 0], [0.7, 0.004], [0.88, 0.02], [0.96, 0.04], [1, 0.065]],
    zR: [[0, 0.045], [0.08, 0.012], [0.18, 0], [0.92, 0], [1, 0.012]],
    dF: [[0, 0.24], [1, 0.26]], nF: 3.6, dR: 0.07, nR: 5,
    s: [[0, 0.04], [0.05, 0.02], [0.12, 0.008], [0.3, 0], [0.82, 0], [0.86, 0.002], [0.9, 0.006], [0.96, 0.012], [1, 0.022]],
    fLevels: [0, 0.015, 0.04, 0.08, 0.13, 0.19, 0.25, 0.28, 0.3, 0.36, 0.44, 0.52, 0.6, 0.68, 0.75, 0.8, 0.84, 0.86, 0.88, 0.9, 0.93, 0.96, 0.98, 0.995, 1],
    roll: { r: 0.022, crown: 0.02 },
    lowerFront: 0, lowerRear: 0,
  },
  bodyMat: (q) => {
    const lv = q.lv;
    if (lv.kind === 'side' && q.seg === 'F' && lv.f < 0.28) return G.ALLOY;                  // front bumper
    if (lv.kind === 'side' && (q.seg === 'R' || q.u > 5.82) && lv.f < 0.2) return G.ALLOY;     // rear step bumper
    if (lv.kind === 'top' && q.u > 3.98) return G.TRIM;                                      // bed rail caps
    return null;
  },
  cutExtra: (q) => q.lv.kind === 'top' && q.lv.d > 0.05 && q.u > 4.02 && q.u < 5.84,
  gh: {
    dGH: 0.05,
    yRail: [[2.0, 1.82], [3.9, 1.825]],
    roofTop: [[2.3, 1.86], [2.6, 1.893], [3.2, 1.9], [3.75, 1.898], [3.92, 1.88]],
    zF: (f) => 1.6 + 0.84 * f - 0.03 * Math.sin(Math.PI * f),
    zR: (f) => 3.93 - 0.03 * f,
    dF: [[0, 0.28], [1, 0.16]], dR: 0.05, nF: 2.6, nR: 4.5,
    tumble: (f) => 0.1 * f + 0.02 * f * f,
    side: [
      { to: (f, a) => a + 0.09, n: 3, mat: 'PAINT' },
      { to: () => 2.64, n: 10, mat: 'GLASS' },
      { to: () => 2.74, n: 3, mat: 'GLOSS' },
      { to: () => 3.62, n: 12, mat: 'GLASS' },
      { to: 'b', n: 4, mat: 'PAINT' },
    ],
    fLevels: [-0.25, 0, 0.035, 0.07, 0.14, 0.24, 0.36, 0.5, 0.64, 0.78, 0.88, 0.93, 0.965, 1],
    roofT: [0.012, 0.03, 0.055, 0.085, 0.11, 0.14, 0.19, 0.27, 0.37, 0.5, 0.64, 0.78, 0.9, 1],
    frame: 0.93, belt: 0.035, beltMat: 'GLOSS', header: 0.1, headerR: 0.06, uc: 3.18,
  },
  eye: { u: 2.62, y: 1.56, x: -0.4 },
  mirror: { u: 1.86, dy: 0.13, big: true },
  headY: 0.98,
  rows: 2,
  D: {
    seams: [
      [[1.72, 0.52], [1.72, 1.0], [1.76, 1.24]],
      [[2.7, 0.5], [2.7, 1.26]],
      [[3.86, 0.52], [3.86, 1.27]],
      [[1.72, 0.53], [3.86, 0.53]],
      [[3.97, 0.62], [3.97, 1.285]],
    ],
    fuel: [4.5, 1.1, 0.09, 0.07],
    handles: [2.45, 3.55], handleDrop: 0.1, handleMat: 'chrome',
    head: { s0: 0.64, s1: 1.02, lo: (t) => 0.9 - 0.02 * t, hi: (t) => 1.07 + 0.005 * t, drl: (t) => 0.905, proj: [0.73, 0.85], projY: 1.0, round: 0.08 },
    hoodFront: { s: 0.66, y: 1.085 }, hoodSide: { x: 0.76, u0: 0.24, u1: 1.55 },
    grille: { y0: 0.72, y1: 1.07, w0: 0.6, w1: 0.63, bars: 6, surround: 0.035, barMat: 'chrome', barW: 0.016 },
    intake: { y: 0.5, h: 0.08, w: 0.5, taper: 0.0 },
    plateF: 0.52, plateFOff: 0.006,
    tail: { s0: 0.81, s1: 0.99, lo: () => 0.92, hi: () => 1.24, round: 0.06, barDy: 0.0, rev: [0.835, 0.93, 1.02, 1.1] },
    trunk: null,
    plateR: 0.46, bumperSeam: null,
    reflector: null, exhaust: [0.5, 0.48, 0.12],
  },
  extra: (THREE, { S, f, kit, add, both, mats, M, Z }) => {
    const L = S.L, u0 = 4.02, u1 = 5.84, rail = f.yS(5) + 0.01, floor = 0.92, hw = f.half(4.5) - f.s(1) - 0.05;
    const liner = M.plastic;
    add(roundedBox(THREE, 2 * hw, 0.04, u1 - u0, 0.01), liner, 'bed_floor').position.set(0, floor, Z((u0 + u1) / 2));
    for (const sx of [-1, 1]) {
      add(roundedBox(THREE, 0.03, rail - floor, u1 - u0, 0.01), liner, 'bed_wall').position.set(sx * (hw + 0.005), (rail + floor) / 2 - 0.01, Z((u0 + u1) / 2));
      add(roundedBox(THREE, 0.26, 0.24, 0.95, 0.06), liner, 'bed_wheelhouse').position.set(sx * (hw - 0.12), floor + 0.11, Z(S.axles[1]));
    }
    add(roundedBox(THREE, 2 * hw, rail - floor, 0.03, 0.01), liner, 'bed_front').position.set(0, (rail + floor) / 2 - 0.01, Z(u0 + 0.005));
    add(roundedBox(THREE, 2 * hw, rail - floor, 0.03, 0.01), liner, 'tailgate_inner').position.set(0, (rail + floor) / 2 - 0.01, Z(u1 - 0.005));
    // tailgate panel lines + handle
    const rib = (hits, w = 0.007) => hitRibbon(THREE, hits, w, 0.0012);
    const tg = cachedGeo(THREE, 'v3|pickup|tailgate', () => rib(kit.line(30, t => kit.rear(-0.82 + 1.64 * t, 0.74))));
    add(tg, M.trim, 'seam_tailgate');
    both(cachedGeo(THREE, 'v3|pickup|tgside', () => rib(kit.line(20, t => kit.rear(0.8, 0.74 + (rail - 0.76) * t)))), M.trim, 'seam_tailgate');
    add(cachedGeo(THREE, 'v3|pickup|tghandle', () => hitPatch(THREE, kit.grid(3, 8, (i, j) => kit.rear(-0.14 + 0.28 * j, 1.16 + 0.05 * i)), 0.003)), M.trimGloss, 'tailgate_handle');
    // tow hitch receiver
    add(roundedBox(THREE, 0.08, 0.08, 0.25, 0.01), M.underbody, 'hitch').position.set(0, 0.5, Z(L - 0.08));
  },
};

SPECS.van = {
  L: 5.3, W: 2.0, H: 2.0,
  wheel: { r: 0.36, w: 0.235, rim: 'steel' }, axles: [0.92, 4.22], arch: { R: 0.42, yc: 0.375, lip: 0.016 },
  body: {
    yBot: [[0, 0.44], [0.2, 0.37], [0.5, 0.34], [1.2, 0.33], [4.8, 0.34], [5.1, 0.38], [5.3, 0.46]],
    yS: [[0, 0.88], [0.15, 0.9], [0.45, 0.97], [0.8, 1.06], [1.2, 1.1], [5.3, 1.12]],
    half: [[0, 0.86], [0.3, 0.9], [0.9, 0.925], [4.8, 0.925], [5.3, 0.91]],
    zF: [[0, 0.15], [0.12, 0.06], [0.3, 0.015], [0.5, 0], [0.7, 0.012], [0.85, 0.04], [0.95, 0.08], [1, 0.115]],
    zR: [[0, 0.13], [0.12, 0.045], [0.25, 0.008], [0.33, 0], [0.35, 0.004], [0.37, 0.022], [0.6, 0.026], [1, 0.032]],
    dF: [[0, 0.42], [1, 0.46]], nF: 2.5, dR: [[0, 0.14], [1, 0.14]], nR: 4,
    s: [[0, 0.05], [0.04, 0.03], [0.1, 0.014], [0.2, 0.006], [0.35, 0.001], [0.6, 0], [0.8, 0.003], [0.9, 0.008], [0.96, 0.016], [1, 0.03]],
    fLevels: [0, 0.015, 0.04, 0.08, 0.13, 0.19, 0.25, 0.3, 0.33, 0.35, 0.37, 0.4, 0.46, 0.53, 0.6, 0.67, 0.74, 0.8, 0.85, 0.89, 0.92, 0.95, 0.975, 0.99, 1],
    roll: { r: 0.025, crown: 0.025 },
    lowerFront: 0.3, lowerRear: 0.3,
  },
  gh: {
    dGH: 0.05,
    yRail: [[1.5, 1.9], [5.3, 1.9]],
    roofTop: [[1.8, 1.955], [2.2, 1.995], [4.9, 2.0], [5.25, 1.975]],
    zF: (f) => 0.84 + 0.92 * f - 0.04 * Math.sin(Math.PI * f),
    zR: (f) => 5.285 - 0.025 * f,
    dF: [[0, 0.36], [1, 0.2]], dR: 0.1, nF: 2.4, nR: 4,
    tumble: (f) => 0.07 * f + 0.02 * f * f,
    side: [
      { to: (f, a) => a + 0.1, n: 3, mat: 'PAINT' },
      { to: () => 2.0, n: 8, mat: 'GLASS' },
      { to: () => 2.1, n: 3, mat: 'GLOSS' },
      { to: () => 3.25, n: 12, mat: 'PRIV' },
      { to: () => 3.35, n: 3, mat: 'GLOSS' },
      { to: () => 4.95, n: 16, mat: 'PRIV' },
      { to: 'b', n: 4, mat: 'PAINT' },
    ],
    rearMat: (q) => (q.lv.kind === 'gh' && q.lv.f > 0.3 && q.lv.f < 0.9 && q.k > 0 ? 'PRIV' : q.k === 0 ? 'GLOSS' : 'PAINT'),
    fLevels: [-0.25, 0, 0.035, 0.07, 0.14, 0.24, 0.3, 0.36, 0.5, 0.64, 0.78, 0.88, 0.9, 0.93, 0.965, 1],
    roofT: [0.012, 0.03, 0.055, 0.085, 0.11, 0.14, 0.19, 0.27, 0.37, 0.5, 0.64, 0.78, 0.9, 1],
    frame: 0.93, belt: 0.035, beltMat: 'GLOSS', header: 0.09, headerR: 0.0, uc: 3.4,
  },
  eye: { u: 1.98, y: 1.62, x: -0.42 },
  mirror: { u: 1.08, dy: 0.15, big: true },
  headY: 0.92,
  rows: 2,
  D: {
    seams: [
      [[1.42, 0.38], [1.42, 1.0], [1.36, 1.1]],
      [[2.05, 0.36], [2.05, 1.115]],
      [[3.3, 0.36], [3.3, 1.115]],
      [[1.42, 0.39], [3.3, 0.39]],
      [[3.3, 1.07], [4.98, 1.07]],
    ],
    fuel: [1.75, 0.95, 0.08, 0.06],
    handles: [1.85, 3.1], handleDrop: 0.07, handleMat: 'chrome',
    head: { s0: 0.44, s1: 1.06, lo: (t) => 0.86 - 0.015 * t, hi: (t) => 0.92 + 0.045 * Math.pow(t, 1.3), drl: (t) => 0.862, proj: [0.66, 0.8], projY: 0.895 },
    hoodFront: { s: 0.43, y: 0.86 }, hoodSide: { x: 0.74, u0: 0.3, u1: 0.8 },
    grille: { y0: 0.62, y1: 0.82, w0: 0.42, w1: 0.48, bars: 4, surround: 0.016 },
    intake: { y: 0.45, h: 0.08, w: 0.55, taper: 0.03 },
    plateF: 0.48, plateFOff: 0.012,
    tail: { s0: 0.8, s1: 1.0, lo: () => 0.98, hi: () => 1.42, round: 0.06, barDy: 0, rev: [0.82, 0.92, 1.0, 1.08] },
    trunk: null,
    plateR: 0.7, bumperSeam: { s: 1.0, y: 0.6 },
    reflector: [0.6, 0.78, 0.5],
  },
  extra: (THREE, { S, kit, add, M }) => {
    const rib = (hits, w = 0.007) => hitRibbon(THREE, hits, w, 0.0012);
    add(cachedGeo(THREE, 'v3|van|split', () => rib(kit.line(40, t => kit.rear(0.0, 0.62 + 1.25 * t, kit.hitA)), 0.008)), M.trim, 'seam_reardoor');
    add(cachedGeo(THREE, 'v3|van|rhandle', () => hitPatch(THREE, kit.grid(3, 6, (i, j) => kit.rear(0.04 + 0.12 * j, 1.05 + 0.04 * i)), 0.003)), M.chrome, 'reardoor_handle');
  },
};

function prepSpec(S) {
  if (S._f) return S._f;
  if (!S.type) S.type = Object.keys(SPECS).find(k => SPECS[k] === S);
  const B = S.body, f = {};
  f.yBot = C(B.yBot); f.yS = C(B.yS); f.half = C(B.half);
  f.zF = C(B.zF); const zRo = C(B.zR); f.zR = (ff) => S.L - zRo(ff);
  f.s = C(B.s); f.dF = K(B.dF); f.dR = K(B.dR);
  const hmax = Math.max(...B.half.map(p => p[1]));
  f.hmax = hmax;
  f.hwRef = hmax - f.s(1); f.hwRefB = hmax - f.s(0);
  f.roll = (d) => { const r = B.roll.r, q = Math.max(0, 1 - d / f.hwRef), a = Math.min(1, d / r); return r * Math.sqrt(1 - (1 - a) * (1 - a)) + B.roll.crown * (1 - q * q); };
  f.hTop = (u) => f.half(u) - f.s(1);
  f.topY = (x, u) => { const h = Math.max(1e-3, f.hTop(u)); return f.yS(u) + f.roll(Math.max(0, f.hwRef * (1 - Math.abs(x) / h))); };
  f.yc = S.arch.yc; f.R = S.arch.R;
  // side sample template: dense round the wheel arches
  const a0 = f.zF(0.7) + f.dF(0.7), b0 = f.zR(0.7) - f.dR(0.7), us = [];
  for (let u = a0; u < b0; ) {
    us.push(u);
    const near = S.axles.some(ax => Math.abs(u - ax) < f.R + 0.08) || (S.extraDense || []).some(([p, q]) => u > p && u < q);
    u += near ? 0.011 : 0.03;
  }
  us.push(b0);
  f.sideFr = us.map(u => (u - a0) / (b0 - a0));
  S._f = f;
  return f;
}

function bodyLevels(S, f) {
  const B = S.body, lv = [];
  const botD = [f.hwRefB, 0.72, 0.52, 0.34, 0.21, 0.12, 0.06, 0.025, 0.008];
  for (const d of botD) {
    const q = Math.max(0, 1 - d / f.hwRefB);
    lv.push({ kind: 'bot', d, zF: f.zF(0) + d, zR: f.zR(0) - d, dF: f.dF(0) * q, dR: f.dR(0) * q, nF: B.nF, nR: B.nR,
      half: (u) => (f.half(u) - f.s(0)) * q, y: (x, u) => f.yBot(u) - Math.min(d, 0.012) });
  }
  for (const ff of B.fLevels) {
    const ins = f.s(ff);
    lv.push({ kind: 'side', f: ff, zF: f.zF(ff), zR: f.zR(ff), dF: f.dF(ff), dR: f.dR(ff), nF: B.nF, nR: B.nR,
      half: (u) => f.half(u) - ins, y: (x, u) => f.yBot(u) + (f.yS(u) - f.yBot(u)) * ff });
  }
  const topD = [0.002, 0.006, 0.012, 0.02, 0.03, 0.045, 0.065, 0.09, 0.13, 0.18, 0.25, 0.33, 0.42, 0.52, 0.62, 0.71, 0.78, 0.84, f.hwRef];
  for (const d of topD) {
    const q = Math.max(0, 1 - d / f.hwRef);
    lv.push({ kind: 'top', d, zF: f.zF(1) + d, zR: f.zR(1) - d, dF: f.dF(1) * q, dR: f.dR(1) * q, nF: B.nF, nR: B.nR,
      half: (u) => (f.half(u) - f.s(1)) * q, y: (x, u) => f.yS(u) + f.roll(d) });
  }
  return lv;
}

function ghPrep(S, f) {
  if (S._g) return S._g;
  const Gs = S.gh, g = {};
  g.yRail = C(Gs.yRail); g.roofTop = C(Gs.roofTop);
  g.dF = K(Gs.dF); g.dR = K(Gs.dR);
  g.baseHalf = (u) => f.hTop(u) * (1 - Gs.dGH / f.hwRef);
  g.nSide = 1 + Gs.side.reduce((s, x) => s + x.n, 0);
  g.segStart = []; { let k = 0; for (const sg of Gs.side) { g.segStart.push(k); k += sg.n; } }
  g.segOf = (k) => { let j = 0; while (j + 1 < g.segStart.length && k >= g.segStart[j + 1]) j++; return j; };
  g.sideU = (ff, a, b) => {
    const out = [a]; let prev = a;
    Gs.side.forEach((sg, j) => {
      const end = sg.to === 'b' ? b : Math.min(b - 0.005 * (Gs.side.length - j), Math.max(prev + 0.01, sg.to(ff, a, b)));
      for (let k = 1; k <= sg.n; k++) out.push(prev + (end - prev) * (k / sg.n));
      prev = end;
    });
    return out;
  };
  g.rho = (t) => 0.6 * (1 - Math.pow(1 - Math.min(1, t / 0.16), 2)) + 0.4 * (1 - (1 - t) * (1 - t));
  S._g = g;
  return g;
}

function ghLevels(S, f) {
  const Gs = S.gh, g = ghPrep(S, f), lv = [];
  const level = (ff) => {
    const fc = Math.max(0, ff);
    const zF = Gs.zF(fc), zR = Gs.zR(fc), dF = g.dF(fc), dR = g.dR(fc), tum = Gs.tumble(fc);
    const a = zF + dF, b = zR - dR;
    return { kind: 'gh', f: ff, zF, zR, dF, dR, nF: Gs.nF, nR: Gs.nR, half: (u) => g.baseHalf(u) - tum, sideU: g.sideU(fc, a, b),
      y: (x, u) => { const yb = f.topY(x, u); return ff < 0 ? yb - 0.06 : yb + (g.yRail(u) - yb) * ff; } };
  };
  for (const ff of Gs.fLevels) lv.push(level(ff));
  const top = level(1), uc = Gs.uc;
  for (const t of Gs.roofT) {
    const q = Math.max(0, 1 - t);
    lv.push({ kind: 'roof', t, zF: uc + (top.zF - uc) * q, zR: uc + (top.zR - uc) * q, dF: top.dF * q, dR: top.dR * q, nF: Gs.nF, nR: Gs.nR,
      half: (u) => top.half(uc + (u - uc) / Math.max(q, 1e-3)) * q, sideU: top.sideU.map(u => uc + (u - uc) * q),
      y: (x, u) => g.yRail(u) + (g.roofTop(u) - g.yRail(u)) * g.rho(t) });
  }
  return lv;
}

// x of a level's right-half outline at u (plan), for footprint tests
function outlineX(half, u) {
  let best = -1;
  for (let k = 0; k < half.length - 1; k++) {
    const p = half[k], q = half[k + 1];
    if ((p.u - u) * (q.u - u) <= 0 && p.u !== q.u) { const t = (u - p.u) / (q.u - p.u); best = Math.max(best, p.x + (q.x - p.x) * t); }
  }
  return best;
}

function buildBodyV3(THREE, S) {
  const f = prepSpec(S), B = S.body, L = S.L, zOff = -L / 2;
  const R = f.R, yc = f.yc;
  const g = ghPrep(S, f);
  const ghBase = stackHalf(ghLevels(S, f)[1], NQF, NQR, null);
  const ghU0 = S.gh.zF(0), ghU1 = S.gh.zR(0);
  const levels = bodyLevels(S, f);
  const cutCabin = (q) => q.lv.kind === 'top' && q.lv.d > S.gh.dGH + 0.012 && q.u > ghU0 + 0.05 && q.u < ghU1 - 0.05 && q.x < outlineX(ghBase, q.u) - 0.025;
  const res = stackGeometry(THREE, levels, {
    NQF, NQR, sideFr: f.sideFr, zOff,
    snap: (p, i, lv) => {
      if (lv.kind === 'top') return;
      if (p.x < f.half(p.u) - 0.45) return;
      for (const ax of S.axles) {
        const du = p.u - ax, dy = p.y - yc, rho = Math.hypot(du, dy);
        if (Math.abs(rho - R) < 0.02 && rho > 1e-3) { p.u = ax + du * R / rho; p.y = yc + dy * R / rho; }
      }
    },
    cut: (q) => {
      if (q.lv.kind !== 'top' && q.x > f.half(q.u) - 0.42) for (const ax of S.axles) if (Math.hypot(q.u - ax, q.y - yc) < R - 0.002) return true;
      if (S.cutExtra && S.cutExtra(q)) return true;
      return cutCabin(q);
    },
    material: (q) => {
      const lv = q.lv;
      if (lv.kind === 'bot') return lv.d < 0.05 ? G.PLASTIC : G.UNDER;
      if (S.clad && lv.kind === 'side' && q.y < S.clad(q.u, q)) return G.PLASTIC;
      if (lv.kind === 'side' && q.seg === 'F' && lv.f < B.lowerFront) return G.PLASTIC;
      if (lv.kind === 'side' && q.seg === 'R' && lv.f < B.lowerRear) return G.PLASTIC;
      if (S.bodyMat) { const m = S.bodyMat(q); if (m != null) return m; }
      return G.PAINT;
    },
  });
  return res.geo;
}

function buildGhV3(THREE, S) {
  const f = prepSpec(S), g = ghPrep(S, f), Gs = S.gh, L = S.L;
  const levels = ghLevels(S, f);
  const mat = (name) => G[name];
  const res = stackGeometry(THREE, levels, {
    NQF, NQR, sideFr: null, zOff: -L / 2,
    material: (q) => {
      const lv = q.lv;
      if (lv.kind === 'gh') {
        if (lv.f < 0) return G.GLOSS;
        if (q.seg === 'F') { if (q.k >= NQF - 2 || lv.f < 0.05) return G.GLOSS; return Gs.frontMat ? mat(Gs.frontMat(q)) : G.GLASS; }
        if (q.seg === 'R') { if (q.k >= NQR - 2) return G.GLOSS; return Gs.rearMat ? mat(Gs.rearMat(q)) : G.PRIV; }
        const sg = Gs.side[g.segOf(q.k)];
        let m = typeof sg.mat === 'function' ? sg.mat(q) : sg.mat;
        if (m === 'GLASS' || m === 'PRIV') { if (lv.f >= Gs.frame) return G.GLOSS; if (lv.f < Gs.belt) return mat(Gs.beltMat || 'GLOSS'); }
        return mat(m);
      }
      // roof
      if (Gs.drip && q.seg === 'S' && lv.t < 0.03) return G.GLOSS;
      if (q.seg === 'F' && lv.t < Gs.header) return q.k >= NQF - 2 ? G.GLOSS : (Gs.frontMat ? mat(Gs.frontMat(q)) : G.GLASS);
      if (q.seg === 'F' && lv.t < Gs.header + 0.04) return G.GLOSS;
      if (q.seg === 'R' && lv.t < Gs.headerR) return q.k >= NQR - 2 ? G.GLOSS : (Gs.rearMat ? mat(Gs.rearMat(q)) : G.PRIV);
      if (q.seg === 'R' && lv.t < Gs.headerR + 0.03) return G.GLOSS;
      return Gs.roofMat ? mat(Gs.roofMat(q)) : G.PAINT;
    },
  });
  return res.geo;
}

// ------------------------------------------------------------------ conforming detail toolkit
function detailKit(THREE, S, bodyMesh, ghMesh) {
  const f = prepSpec(S), L = S.L, Z = (u) => u - L / 2;
  const hitB = surfaceCaster(THREE, [bodyMesh]);
  const hitG = surfaceCaster(THREE, [ghMesh]);
  const hitA = surfaceCaster(THREE, [bodyMesh, ghMesh]);
  const levels = bodyLevels(S, f).filter(l => l.kind === 'side');
  const k = {
    Z, f,
    side: (u, y, cast = hitB) => cast([2.5, y, Z(u)], [-1, 0, 0]),
    front: (x, y, cast = hitB) => cast([x, y, Z(-1.5)], [0, 0, 1]),
    rear: (x, y, cast = hitB) => cast([x, y, Z(L + 1.5)], [0, 0, -1]),
    top: (x, u, cast = hitB) => cast([x, 4, Z(u)], [0, -1, 0]),
    hitB, hitG, hitA,
  };
  // plan-outline wrap: s = arclength from the front (or rear) centre along the body outline at height y
  const outlines = new Map();
  k.around = (end, s, y, cast = hitA) => {
    let best = null, bd = 1e9;
    for (const lv of levels) {
      const yy = lv.y(0.5, end === 'F' ? lv.zF + 0.1 : lv.zR - 0.1);
      if (Math.abs(yy - y) < bd) { bd = Math.abs(yy - y); best = lv; }
    }
    let ol = outlines.get(best);
    if (!ol) {
      const h = stackHalf(best, NQF, NQR, f.sideFr).map(p => [p.x, p.u]);
      const F = h.slice(), Rr = h.slice().reverse();
      const mk = (pts) => { const acc = [0]; for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return { pts, acc }; };
      ol = { F: mk(F), R: mk(Rr) }; outlines.set(best, ol);
    }
    const o = ol[end];
    let i = 1; while (i < o.acc.length - 1 && o.acc[i] < s) i++;
    const t = Math.max(0, Math.min(1, (s - o.acc[i - 1]) / Math.max(1e-6, o.acc[i] - o.acc[i - 1])));
    const p0 = o.pts[i - 1], p1 = o.pts[i];
    const x = p0[0] + (p1[0] - p0[0]) * t, u = p0[1] + (p1[1] - p0[1]) * t;
    let tx = p1[0] - p0[0], tu = p1[1] - p0[1]; const l = Math.hypot(tx, tu) || 1; tx /= l; tu /= l;
    let nx = tu, nu = -tx; if (end === 'R') { nx = -tu; nu = tx; }
    const h = cast([x + nx * 0.3, y, Z(u + nu * 0.3)], [-nx, 0, -nu], 1.2);
    if (!h && typeof process !== 'undefined' && process.env && process.env.V3_DEBUG) console.log('miss around', S.type, end, s.toFixed(3), y.toFixed(3));
    return h;
  };
  // lens-shaped patch over (s, y): lo(σ), hi(σ) with rounded ends; expand grows it uniformly (bezels)
  k.wrapGrid = (end, s0, s1, lo, hi, { cols = 28, rows = 6, round = 0.12, expand = 0, cast = hitA } = {}) => {
    const out = [];
    for (let r = 0; r <= rows; r++) {
      const row = [];
      for (let c = 0; c <= cols; c++) {
        const sg = c / cols;
        const s = s0 - expand + (s1 - s0 + 2 * expand) * sg;
        const yl = lo(sg) - expand, yh = hi(sg) + expand, ym = (yl + yh) / 2, hh = (yh - yl) / 2;
        const e = Math.max(0, Math.abs(2 * sg - 1) - (1 - round)) / round;
        const ry = hh * Math.sqrt(Math.max(0, 1 - e * e));
        row.push(k.around(end, s, ym - ry + 2 * ry * (r / rows), cast));
      }
      out.push(row);
    }
    return out;
  };
  // planar-projected grid: fn(i, j) -> hit
  k.grid = (nr, nc, fn) => { const out = []; for (let i = 0; i <= nr; i++) { const row = []; for (let j = 0; j <= nc; j++) row.push(fn(i / nr, j / nc)); out.push(row); } return out; };
  k.line = (n, fn) => { const out = []; for (let i = 0; i <= n; i++) out.push(fn(i / n)); return out; };
  return k;
}

function buildCarV3(THREE, type) {
  const S = SPECS[type], f = prepSpec(S), L = S.L, M = getMaterials(THREE);
  const outer = new THREE.Group();
  const root = new THREE.Group(); root.name = 'shell'; outer.add(root);
  const mats = gMats(THREE, 0xa9adb2), paint = mats[0];
  const Z = (u) => u - L / 2;
  const add = (geo, mat, name, paintSlot) => {
    const m = new THREE.Mesh(geo, mat); m.name = name;
    if (paintSlot != null) m.userData.paintSlot = paintSlot;
    root.add(m); return m;
  };
  const bodyGeo = cachedGeo(THREE, 'v3body|' + type, () => buildBodyV3(THREE, S));
  const ghGeo = cachedGeo(THREE, 'v3gh|' + type, () => buildGhV3(THREE, S));
  const body = add(bodyGeo, mats, 'body', 'array');
  const cabin = add(ghGeo, mats, 'cabin', 'array');
  // inner linings: from inside the cabin the shell's back faces read as dark door cards / headliner, not see-through
  add(bodyGeo, M.cabinLining, 'body_lining');
  const hide = new THREE.MeshBasicMaterial({ visible: false }); hide.name = 'hidden';
  add(ghGeo, mats.map((m, i) => (i === G.GLASS || i === G.PRIV ? hide : M.cabinLining)), 'cabin_lining');

  const kit = detailKit(THREE, S, body, cabin);
  const both = (geo, mat, name, paintSlot) => { add(geo, mat, name + '_R', paintSlot); add(mirrorX(THREE, geo), mat, name + '_L', paintSlot); };

  // ---- wheel arches: lip + liner + inner wall
  const R = f.R, yc = f.yc;
  for (const ax of S.axles) {
    const yb = f.yBot(ax) + 0.005;
    const a0 = Math.asin(Math.max(-1, Math.min(1, (yb - yc) / R)));
    const pts = [], hits = [];
    for (let i = 0; i <= 40; i++) {
      const a = a0 + (Math.PI - 2 * a0) * (i / 40);
      const u = ax - R * Math.cos(a), y = yc + R * Math.sin(a);
      const h = kit.side(ax - (R + 0.02) * Math.cos(a), yc + (R + 0.02) * Math.sin(a));
      const x = h ? h.p[0] : f.half(u) - 0.01;
      hits.push(x);
      pts.push(new THREE.Vector3(x - S.arch.lip * 0.4, y, Z(u)));
    }
    const lip = cachedGeo(THREE, `v3lip|${type}|${ax}`, () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, S.arch.lip, 8, false));
    if (S.archFlare) both(lip, M.plastic, 'arch_lip'); else both(lip, paint, 'arch_lip', 0);
    const xOut = Math.min(...hits) - 0.015, xIn = f.half(ax) - S.wheel.w - 0.14;
    const liner = cachedGeo(THREE, `v3liner|${type}|${ax}`, () => {
      const pos = [], idx = [], n = 32, Rl = R - 0.006;
      for (let i = 0; i <= n; i++) {
        const a = a0 + (Math.PI - 2 * a0) * (i / n), u = ax - Rl * Math.cos(a), y = yc + Rl * Math.sin(a);
        pos.push(xIn, y, Z(u), xOut, y, Z(u));
        if (i) { const b = (i - 1) * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
      }
      // inner wall (fan from the chord midpoint)
      const c0 = pos.length / 3; pos.push(xIn, yb, Z(ax));
      for (let i = 0; i < n; i++) idx.push(c0, i * 2, (i + 1) * 2);
      const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gg.setIndex(idx); gg.computeVertexNormals();
      return gg;
    });
    const lm = M.underbody.clone(); lm.side = THREE.DoubleSide; lm.name = 'arch_liner';
    both(liner, lm, 'arch_liner');
  }

  if (S.D) carDetails(THREE, S, kit, add, both, mats);
  if (S.extra) S.extra(THREE, { S, f, kit, add, both, mats, M, Z });

  // ---- mirrors (housing tip defines the catalog width)
  {
    const mu = S.mirror.u, belt = f.yS(mu) + 0.01;
    const big = !!S.mirror.big;
    const hx = big ? 0.13 : 0.165, hy = big ? 0.24 : 0.115, hz = big ? 0.09 : 0.1;
    const cx = S.W / 2 - hx / 2, cy = belt + S.mirror.dy;
    const housing = cachedGeo(THREE, 'v3mirror|' + type, () => {
      const g2 = new THREE.SphereGeometry(1, 24, 16);
      const p = g2.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        if (z > 0) z *= 0.28;                                // flat back (glass side)
        x *= 1 + 0.12 * Math.max(0, -z);                   // slight sweep
        p.setXYZ(i, x * hx / 2, y * hy / 2 * (1 - 0.12 * x), z * hz / 2);
      }
      g2.computeVertexNormals();
      return g2;
    });
    const glassG = cachedGeo(THREE, 'v3mirrorglass|' + type, () => new THREE.CircleGeometry(1, 24).scale(hx / 2 * 0.86, hy / 2 * 0.8, 1));
    const sideX = f.half(mu) - f.s(0.95);
    for (const s of [-1, 1]) {
      const grp = new THREE.Group(); grp.name = 'mirror'; grp.position.set(s * cx, cy, Z(mu)); grp.rotation.y = -s * 0.08;
      const h = new THREE.Mesh(housing, big ? M.trimGloss : paint); h.name = 'mirror_housing'; if (!big) h.userData.paintSlot = 0;
      if (s < 0) h.scale.x = -1;
      const gl = new THREE.Mesh(glassG, M.mirror); gl.name = 'mirror_glass'; gl.position.z = hz / 2 * 0.28 + 0.002;
      grp.add(h, gl);
      root.add(grp);
      // short arm from the door top to the housing
      const armL = Math.max(0.03, cx - hx * 0.35 - sideX + 0.02);
      const arm = new THREE.Mesh(roundedBox(THREE, armL, big ? 0.04 : 0.035, big ? 0.05 : 0.07, 0.012), M.trimGloss); arm.name = 'mirror_arm';
      arm.position.set(s * (sideX - 0.02 + armL / 2), cy - hy * 0.32, Z(mu) + 0.005);
      root.add(arm);
    }
  }

  // ---- underbody + interior
  add(roundedBox(THREE, 2 * f.hmax - 0.5, 0.05, S.axles[1] - S.axles[0] - 2 * R, 0.02), M.underbody, 'floorpan').position.set(0, f.yBot(L / 2) + 0.02, Z((S.axles[0] + S.axles[1]) / 2));
  {
    const Gs = S.gh, g = ghPrep(S, f);
    const beltMid = f.yS(S.eye.u);
    const dashTop = beltMid + 0.03;
    const dashU = Math.max(Gs.zF(0) + 0.42, S.eye.u - 0.68);
    // rear bench: headrest must stay inside the greenhouse (sedan backlight / pickup cab back)
    const yHead = S.eye.y - 0.62 + 0.77, belt = f.yS(Gs.zR(0)), rail = g.yRail(Gs.zR(1));
    const fh = Math.max(0, Math.min(1, (yHead - belt) / Math.max(0.05, rail - belt)));
    const rearSeatZ = Z(Math.min(S.eye.u + 0.98, Gs.zR(fh) - 0.1 - 0.4));
    const inter = makeInterior(THREE, { eye: [S.eye.x, S.eye.y, Z(S.eye.u)], width: 2 * (g.baseHalf(S.eye.u) - 0.07), rearSeatZ,
      floorY: f.yBot(S.eye.u) + 0.12, dashZ: Z(dashU), rearZ: Z(Math.min(Gs.zR(0.5) - 0.1, S.eye.u + 1.6)), rows: S.rows, swDrop: 0.3,
      dashW: 2 * (g.baseHalf(dashU) - 0.12), dashTop, mirrorY: g.yRail(Gs.zF(1)) + 0.0, mirrorZ: Z(Gs.zF(1) + 0.12) });
    root.add(inter);
  }

  // snap the assembled shell to the exact catalog envelope
  // (x/z from the shell, y from the roof: the ground contact is the tyres, added per instance)
  root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(root), sz = bb.getSize(new THREE.Vector3());
  root.scale.set(S.W / sz.x, S.H / bb.max.y, S.L / sz.z);
  root.position.set(-(bb.min.x + bb.max.x) / 2 * root.scale.x, 0, -(bb.min.z + bb.max.z) / 2 * root.scale.z);
  return outer;
}

// ------------------------------------------------------------------ trim, lamps, seams (driven by SPEC.D)
function carDetails(THREE, S, kit, add, both, mats) {
  const M = getMaterials(THREE), f = kit.f, D = S.D, type = S.type;
  const seam = M.trim;
  const ribbon = (hits, w = 0.007, off = 0.0012) => hitRibbon(THREE, hits, w, off);
  const cache = (key, fn) => cachedGeo(THREE, `v3|${type}|${key}`, fn);
  const center = (key, fn, mat, name) => { add(cache(key, fn), mat, name); add(cache(key + '_L', () => mirrorX(THREE, cache(key, fn))), mat, name); };
  const sideLine = (pts, n = 30) => {
    const c = []; for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < n; j++) { const t = j / n; c.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]); }
    c.push(pts[pts.length - 1]);
    return c.map(([u, y]) => kit.side(u, y));
  };
  const lens = (end, L, layers, names) => {
    const [bezMat, lensMat, kind] = layers;
    both(cache(names + '_bezel', () => hitPatch(THREE, kit.wrapGrid(end, L.s0, L.s1, L.lo, L.hi, { expand: L.bezel ?? 0.011, round: 0.1 }), 0.0025)), bezMat, names + '_bezel');
    const g = cache(names + '_lens', () => hitPatch(THREE, kit.wrapGrid(end, L.s0, L.s1, L.lo, L.hi, { round: L.round ?? 0.13 }), 0.0045));
    const nm = kind === 'tail' ? 'taillight_' : 'headlight_';
    add(g, lensMat, nm + 'R').userData.lampKind = kind;
    add(mirrorX(THREE, g), lensMat, nm + 'L').userData.lampKind = kind;
  };
  // ---- side panel gaps
  (D.seams || []).forEach((sl, i) => both(cache('seam' + i, () => ribbon(sideLine(typeof sl === 'function' ? sl(f) : sl))), seam, 'seam_side'));
  if (D.fuel) {
    const [uc, yc2, rw, rh] = D.fuel, pts = [];
    for (let i = 0; i <= 32; i++) { const a = i / 32 * Math.PI * 2; pts.push([uc + Math.cos(a) * rw, yc2 + Math.sin(a) * rh]); }
    add(cache('fuel', () => ribbon(pts.map(([u, y]) => kit.side(u, y)), 0.005)), seam, 'fuel_door');
  }
  // ---- door handles (body colour on a gloss-black pocket)
  for (const hu of D.handles || []) {
    const hy = f.yS(hu) - D.handleDrop;
    both(cache('pocket' + hu, () => hitPatch(THREE, kit.grid(3, 8, (i, j) => kit.side(hu - 0.09 + 0.18 * j, hy - 0.022 + 0.044 * i)), 0.0015)), M.trimGloss, 'handle_pocket');
    const h = kit.side(hu, hy);
    for (const sx of [-1, 1]) { const m = add(roundedBox(THREE, 0.03, 0.03, 0.16, 0.013), D.handleMat === 'chrome' ? M.chrome : mats[0], 'door_handle', D.handleMat === 'chrome' ? null : 0); m.position.set(sx * (h.p[0] + 0.006), hy, h.p[2]); }
  }
  // ---- head lamps
  const HL = D.head;
  lens('F', HL, [M.trimGloss, M.lightHead, 'head'], 'hl');
  if (HL.drl) both(cache('hl_drl', () => ribbon(kit.line(30, t => kit.around('F', HL.s0 + 0.03 + (HL.s1 - HL.s0 - 0.05) * t, HL.drl(t))), 0.007, 0.006)), M.lightRev, 'drl');
  for (const sp of HL.proj || []) both(cache('hl_proj' + sp, () => hitPatch(THREE, kit.wrapGrid('F', sp - 0.022, sp + 0.022, () => HL.projY - 0.013, () => HL.projY + 0.013, { cols: 8, rows: 4, round: 0.5 }), 0.0055)), M.chrome, 'projector');
  // ---- hood seams
  if (D.hoodFront) center('hood_front', () => ribbon(kit.line(40, t => kit.around('F', 0.0001 + D.hoodFront.s * t, D.hoodFront.y))), seam, 'seam_hood');
  if (D.hoodSide) { const H = D.hoodSide; both(cache('hood_side', () => ribbon(kit.line(40, t => kit.top(H.x - 0.06 * Math.pow(1 - t, 3), H.u0 + (H.u1 - H.u0) * t)))), seam, 'seam_hood'); }
  // ---- grille, intake, vents, plate
  if (D.grille) {
    const Gr = D.grille, gw = (y) => Gr.w0 + (Gr.w1 - Gr.w0) * (y - Gr.y0) / (Gr.y1 - Gr.y0);
    add(cache('grille', () => hitPatch(THREE, kit.grid(8, 24, (i, j) => { const y = Gr.y0 + (Gr.y1 - Gr.y0) * i; return kit.front((2 * j - 1) * gw(y), y); }), 0.003)), M.trimGloss, 'grille');
    for (let b = 1; b < Gr.bars; b++) {
      const y = Gr.y0 + (Gr.y1 - Gr.y0) * b / Gr.bars;
      add(cache('gbar' + b, () => ribbon(kit.line(24, t => kit.front((2 * t - 1) * (gw(y) - 0.015), y)), Gr.barW || 0.008, 0.006)), Gr.barMat === 'chrome' ? M.chrome : M.plastic, 'grille_bar');
    }
    if (Gr.surround) {
      const ring = [], P = [[-gw(Gr.y0), Gr.y0], [gw(Gr.y0), Gr.y0], [gw(Gr.y1), Gr.y1], [-gw(Gr.y1), Gr.y1], [-gw(Gr.y0), Gr.y0]];
      for (let i = 0; i < 4; i++) for (let j = 0; j < 12; j++) { const t = j / 12; ring.push(kit.front(P[i][0] + (P[i + 1][0] - P[i][0]) * t, P[i][1] + (P[i + 1][1] - P[i][1]) * t)); }
      ring.push(ring[0]);
      add(cache('gsurround', () => ribbon(ring, Gr.surround, 0.005)), M.chrome, 'grille_surround');
    }
  }
  if (D.intake) { const I = D.intake; add(cache('intake', () => hitPatch(THREE, kit.grid(3, 24, (i, j) => { const y = I.y + I.h * (i / 3); return kit.front((2 * j - 1) * (I.w - I.taper * (i / 3)), y); }), 0.003)), I.mat === 'chrome' ? M.alloy : M.trimGloss, 'intake'); }
  if (D.vent) { const Vt = D.vent; both(cache('fvent', () => hitPatch(THREE, kit.wrapGrid('F', Vt.s0, Vt.s1, Vt.lo, Vt.hi, { cols: 10, rows: 5, round: 0.3 }), 0.003)), M.trimGloss, 'bumper_vent'); }
  if (D.skid) { const Sk = D.skid; add(cache('skidF', () => hitPatch(THREE, kit.grid(3, 20, (i, j) => kit.front((2 * j - 1) * (Sk.w - 0.05 * i / 3), Sk.y + Sk.h * i / 3)), 0.0035)), M.alloy, 'skid_plate'); }
  add(cache('plateF', () => hitPatch(THREE, kit.grid(3, 8, (i, j) => kit.front(-0.152 + 0.304 * j, D.plateF + 0.15 * i)), D.plateFOff ?? 0.012)), M.plate, 'plate_front');
  // ---- wipers
  {
    const Gs = S.gh, yW = (x) => f.topY(x, Gs.zF(0)) + (D.wiperDy ?? 0.03);
    const wx = ghPrep(S, f).baseHalf(Gs.zF(0) + 0.3) * (D.wiperX ?? 0.8);
    for (const [x0, x1] of [[-wx, 0.02], [-0.02, wx * 0.92]]) {
      add(cache('wiper' + x0, () => ribbon(kit.line(20, t => { const x = x0 + (x1 - x0) * t; return kit.hitG([x, yW(x) + 0.025 * t, kit.Z(-1)], [0, 0, 1]); }), 0.018, 0.012)), M.trim, 'wiper');
    }
  }
  // ---- rear: separate tail-lamp units, plate recess, garnish, bumper seam, reflectors, exhaust
  if (D.tail) {
    const TL = D.tail;
    lens('R', TL, [M.trimGloss, M.lightTail, 'tail'], 'tl');
    both(cache('tl_bar', () => ribbon(kit.line(30, t => kit.around('R', TL.s0 + 0.04 + (TL.s1 - TL.s0 - 0.08) * t, (TL.lo(t) + TL.hi(t)) / 2 + (TL.barDy ?? 0.008))), 0.012, 0.006)), M.brake, 'taillamp_bar');
    if (TL.rev) both(cache('tl_rev', () => hitPatch(THREE, kit.wrapGrid('R', TL.rev[0], TL.rev[1], () => TL.rev[2], () => TL.rev[3], { cols: 8, rows: 3, round: 0.3 }), 0.0058)), M.lightRev, 'reverse_lamp');
  }
  if (D.trunk) {
    const T = D.trunk;
    center('trunk_rear', () => ribbon(kit.line(40, t => kit.around('R', 0.0001 + T.s * t, T.y))), seam, 'seam_trunk');
    if (T.x) both(cache('trunk_side', () => ribbon(kit.line(30, t => kit.top(T.x + 0.02 * t, T.u0 + (T.u1 - T.u0) * t)))), seam, 'seam_trunk');
    if (T.u0) add(cache('trunk_front', () => ribbon(kit.line(30, t => kit.top(-T.x + 2 * T.x * t, T.u0)))), seam, 'seam_trunk');
    if (T.sideLine) both(cache('hatch_side', () => ribbon(sideLine(T.sideLine))), seam, 'seam_trunk');
  }
  if (D.plateR) {
    const y = D.plateR;
    add(cache('plate_recess', () => hitPatch(THREE, kit.grid(4, 10, (i, j) => kit.rear(-0.2 + 0.4 * j, y - 0.026 + 0.205 * i)), 0.0015)), M.trim, 'plate_recess');
    add(cache('plate_recess_in', () => hitPatch(THREE, kit.grid(4, 10, (i, j) => kit.rear(-0.188 + 0.376 * j, y - 0.014 + 0.181 * i)), 0.0022)), M.plastic, 'plate_recess_inner');
    add(cache('plateR', () => hitPatch(THREE, kit.grid(3, 8, (i, j) => kit.rear(-0.152 + 0.304 * j, y + 0.152 * i)), 0.0035)), M.plate, 'plate_rear');
  }
  if (D.garnish) add(cache('garnish', () => ribbon(kit.line(30, t => kit.rear(-D.garnish.w + 2 * D.garnish.w * t, D.garnish.y)), 0.016, 0.004)), M.chrome, 'trunk_garnish');
  if (D.bumperSeam) center('bumper_seam', () => ribbon(kit.line(60, t => kit.around('R', 0.0001 + D.bumperSeam.s * t, D.bumperSeam.y)), 0.006), seam, 'seam_bumper');
  if (D.reflector) { const Rf = D.reflector; both(cache('reflector', () => hitPatch(THREE, kit.wrapGrid('R', Rf[0], Rf[1], () => Rf[2], () => Rf[2] + 0.025, { cols: 8, rows: 2, round: 0.3 }), 0.003)), M.lightTail, 'reflector'); }
  if (D.exhaust) { const E = D.exhaust; add(cache('exhaust', () => hitPatch(THREE, kit.grid(3, 10, (i, j) => kit.rear(E[0] + E[2] * j, E[1] + 0.05 * i)), 0.004)), M.chrome, 'exhaust_trim'); }
  if (D.skidR) { const Sk = D.skidR; add(cache('skidR', () => hitPatch(THREE, kit.grid(3, 20, (i, j) => kit.rear((2 * j - 1) * Sk.w, Sk.y + Sk.h * i / 3)), 0.0035)), M.alloy, 'skid_plate_rear'); }
  // ---- roof rails (suv)
  if (D.roofRails) {
    const RR = D.roofRails;
    both(cache('rail', () => {
      const pts = [];
      for (let i = 0; i <= 24; i++) { const u = RR.u0 + (RR.u1 - RR.u0) * (i / 24), h = kit.top(RR.x, u, kit.hitG); const lift = RR.h * Math.min(1, Math.min(i, 24 - i) / 3); pts.push(new THREE.Vector3(RR.x, (h ? h.p[1] : 1.6) + lift, kit.Z(u))); }
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, RR.r, 8, false);
    }), M.trim, 'roof_rail');
  }
  if (D.spoiler) {
    const Sp = D.spoiler;
    add(cache('spoiler', () => hitPatch(THREE, kit.grid(3, 20, (i, j) => kit.top((2 * j - 1) * Sp.w, Sp.u0 + (Sp.u1 - Sp.u0) * i / 3, kit.hitG)), 0.012)), mats[0], 'spoiler', 0);
  }
}

// ------------------------------------------------------------------ public factories
const TEMPLATES = new WeakMap();
function template(THREE, type) {
  let t = TEMPLATES.get(THREE); if (!t) TEMPLATES.set(THREE, t = {});
  return t[type] || (t[type] = buildCarV3(THREE, type));
}

export function createCar(THREE, type, opts = {}) {
  const S = SPECS[type], f = prepSpec(S);
  const color = opts.color ?? defaultColor(type, opts.id);
  const M = getMaterials(THREE), paint = M.paint(color);
  const root = template(THREE, type).clone(true);
  root.traverse(o => {
    if (!o.isMesh) return;
    if (o.userData.paintSlot === 'array' && Array.isArray(o.material)) { o.material = o.material.slice(); o.material[0] = paint; }
    else if (o.userData.paintSlot === 0) o.material = paint;
  });
  const wheels = [];
  const L = S.L, hwB = f.hmax - 0.005;
  for (const a of S.axles) for (const s of [-1, 1]) {
    const w = makeWheel(THREE, { radius: S.wheel.r, width: S.wheel.w, rim: S.wheel.rim, side: s > 0 ? 'right' : 'left' });
    w.position.set(s * (hwB - S.wheel.w / 2 - 0.025), S.wheel.r, a - L / 2);
    w.name = `wheel_${a < L / 2 ? 'F' : 'R'}${s > 0 ? 'R' : 'L'}`;
    root.add(w); wheels.push(w);
  }
  const dims = VEHICLE_DIMS[type];
  const lightOpts = { headY: S.headY, frontZ: -L / 2 - 0.05 };
  attachLightAPI(THREE, root, lightOpts);
  root.userData._relight = () => { delete root.userData.setLights; attachLightAPI(THREE, root, lightOpts); };
  finalizeVehicle(THREE, root, { type, id: opts.id || type, dims, wheels,
    driverEye: [S.eye.x, S.eye.y, S.eye.u - L / 2] });
  root.userData.color = '#' + paint.color.getHexString();
  root.userData.procedural = true;
  if (opts.lights) root.userData.setLights(true, { spot: opts.spot });
  const spec = modelSpec(type, opts);
  if (spec) GV.swapInGLB(THREE, root, spec, (clone) => {
    clone.traverse(o => { if (o.isMesh && o.userData.paintSlot === 0) o.material = paint; });
  });
  return root;
}

// ------------------------------------------------------------------ GLB model choice (mirrors web/models/manifest.json)
// source:'glb' swaps a fitted GLB into the procedural placeholder when it loads (browser only; Node keeps procedural).
// Side-by-side review (status/veh_cars.md): the procedural crisp-section bodies won for all four types (real glazed
// greenhouse + interior for driver-seat views; the munim GLBs are closed shells with glass decals and no cabin).
// The munim GLBs stay available as an opt-in: createVehicle(THREE, 'sedan', { source: 'glb' }) or { model: 'munim/x.glb' }.
export const MODEL_CHOICE = {
  sedan: { source: 'procedural', url: 'munim/car-sedan.glb' },
  suv: { source: 'procedural', url: 'munim/car-suv.glb' },
  pickup: { source: 'procedural', url: 'munim/car-pickup.glb' },
  van: { source: 'procedural', url: 'munim/car-minivan.glb' },
};
const MODEL_BASE = new URL('../models/', import.meta.url).href;
function modelSpec(type, opts) {
  const ch = MODEL_CHOICE[type] || {};
  const url = opts.model || (opts.source === 'procedural' ? null : (opts.source === 'glb' || ch.source === 'glb') ? ch.url : null);
  if (!url) return null;
  return { url: new URL(url, MODEL_BASE).href, modelId: url, dims: VEHICLE_DIMS[type], front: ch.front || 'auto', mats: ch.mats,
    interior: (T, r) => addInterior(T, type, r) };
}
function addInterior(THREE, type, root) {
  void THREE; void type; void root;
}
/** Start fetching the chosen GLB models now (call early). Resolves when they are fitted. */
export function preloadVehicleModels(THREE, types = Object.keys(MODEL_CHOICE)) {
  return Promise.all(types.map(t => { const s = modelSpec(t, {}); return s ? GV.warmTemplate(THREE, s) : null; }));
}
/** Resolves when every pending GLB load/swap has settled (await before the first still/frame). */
export const ready = GV.ready;

const PALETTE = ['silver', 'white', 'black', 'gray', 'blue', 'red', 'darkgray', 'navy', 'maroon', 'champagne'];
function defaultColor(type, id) {
  let h = 0; const s = String(id || type); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function createBoxVehicle(THREE, type, opts = {}) {
  const dims = VEHICLE_DIMS[type] || { length: 4.5, width: 1.8, height: 1.5 };
  const M = getMaterials(THREE);
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(dims.width, dims.height, dims.length), M.paint(opts.color ?? 'silver'));
  body.position.y = dims.height / 2; body.name = 'body_box'; root.add(body);
  for (const s of [-1, 1]) {
    const h = makeLamp(THREE, { name: 'headlight_' + (s > 0 ? 'R' : 'L'), kind: 'head', w: 0.25, h: 0.12, d: 0.04 });
    h.position.set(s * dims.width * 0.32, Math.min(0.75, dims.height * 0.4), -dims.length / 2 - 0.01); root.add(h);
    const t = makeLamp(THREE, { name: 'taillight_' + (s > 0 ? 'R' : 'L'), kind: 'tail', w: 0.25, h: 0.12, d: 0.04 });
    t.position.set(s * dims.width * 0.36, Math.min(0.9, dims.height * 0.45), dims.length / 2 + 0.01); root.add(t);
  }
  finalizeVehicle(THREE, root, { type, id: opts.id || type, dims, driverEye: [-dims.width * 0.2, Math.min(dims.height - 0.25, 1.2 + (dims.height - 1.45) * 0.6), -dims.length * 0.05] });
  root.userData.fallback = true;
  return root;
}

export function createVehicle(THREE, type, opts = {}) {
  const t = normalizeType(type);
  try {
    if (SPECS[t]) return createCar(THREE, t, opts);
    if (['truck_tractor', 'semitrailer', 'box_truck', 'bus'].includes(t) && heavy && heavy.createHeavyVehicle) return heavy.createHeavyVehicle(THREE, t, opts);
    if (['motorcycle', 'bicycle'].includes(t) && small && small.createSmallVehicle) return small.createSmallVehicle(THREE, t, opts);
    if (t === 'pedestrian' && small && small.createPedestrian) return small.createPedestrian(THREE, opts);
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[vehicles] factory failed for', type, e && e.message);
  }
  return createBoxVehicle(THREE, t, opts);
}

export const CAR_TYPES = Object.keys(SPECS);
export default createVehicle;
