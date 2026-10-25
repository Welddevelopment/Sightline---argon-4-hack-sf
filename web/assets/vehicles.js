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

// material slots shared by body + greenhouse meshes
const S = { PAINT: 0, TRIM: 1, UNDER: 2, GLASS: 3, PLASTIC: 4, INTERIOR: 5, GLOSS: 6, SATIN: 7 };
function slotMats(THREE, color) {
  const M = getMaterials(THREE);
  return [M.paint(color), M.trim, M.underbody, M.glassTint || M.glass, M.plastic, M.interior, M.trimGloss, M.alloy];
}

// ------------------------------------------------------------------ car configurations (u = metres from front bumper)
const CARS = {
  sedan: {
    L: 4.9, W: 1.9, H: 1.45, bodyW: 1.82,
    wheel: { r: 0.335, w: 0.235, rim: 'alloy' }, axles: [0.96, 3.81],
    // raked nose (bumper face -> hood leading edge at ~0.78 m), hood rising to the cowl at ~0.95 m, beltline ~0.98 m,
    // high short deck; plan view tapers hard at both ends so the corners read rounded, not boxed
    top: [[0, 0.5], [0.015, 0.58], [0.04, 0.645], [0.08, 0.7], [0.14, 0.74], [0.24, 0.77], [0.45, 0.795], [0.95, 0.84], [1.45, 0.905], [1.74, 0.945], [2.6, 0.975],
      [3.6, 1.0], [3.96, 1.01], [4.35, 1.01], [4.62, 1.0], [4.74, 0.99], [4.8, 0.975], [4.845, 0.95], [4.872, 0.895], [4.89, 0.805], [4.9, 0.66]],
    bot: [[0, 0.3], [0.05, 0.25], [0.2, 0.205], [0.5, 0.19], [4.4, 0.19], [4.7, 0.24], [4.86, 0.3], [4.9, 0.36]],
    hw: [[0, 0.6], [0.015, 0.68], [0.05, 0.75], [0.11, 0.81], [0.22, 0.855], [0.4, 0.885], [0.7, 0.903], [1.2, 0.91], [3.9, 0.91], [4.4, 0.905], [4.65, 0.892], [4.8, 0.872], [4.87, 0.848], [4.9, 0.8]],
    nTop: 6, nBot: 5, tumble: 0.07, flare: 0.07,
    crisp: { drop: 0.095, tuck: 0.045, shoulder: 0.075, crown: 0.012, r: [0.05, 0.14, 0.014, 0.04, 0.22] },
    gh: { u0: 1.70, u1: 3.98, top: [[1.70, 0.94], [1.85, 1.03], [2.1, 1.19], [2.35, 1.32], [2.58, 1.405], [2.8, 1.44], [3.1, 1.45], [3.35, 1.43], [3.55, 1.35], [3.78, 1.18], [3.98, 1.0]],
      aTop: 2.62, cTop: 3.38, b: [2.93, 3.03], nTop: 3.0, tumble: 0.2, cPillarPaint: true, quarter: [3.42, 3.62] },
    seams: [{ u: 1.86, y0: 0.3, y1: 0.99 }, { u: 2.98, y0: 0.27, y1: 0.99 }, { u: 3.9, y0: 0.4, y1: 0.99 }, { u: 0.11, top: true }, { u: 4.02, top: true }],
    eye: { u: 2.85, y: 1.16, x: -0.36 },
    head: { y: 0.66, x: 0.56, w: 0.5, h: 0.11, d: 0.12, yaw: 0.42, drl: true },
    tail: { y: 0.86, patch: { u: [4.66, 4.897], t0: [0.5, 0.35], t1: [0.92, 1.12] } },
    grille: { y: 0.55, w: 0.8, h: 0.17, intake: { y: 0.36, w: 1.1, h: 0.09 } },
    plateF: 0.44, plateR: 0.63,
    mirror: { u: 1.98, y: 1.03 },
  },
  suv: {
    L: 4.8, W: 1.95, H: 1.75, bodyW: 1.84,
    wheel: { r: 0.37, w: 0.245, rim: 'alloy' }, axles: [0.93, 3.78],
    top: [[0, 0.7], [0.015, 0.8], [0.04, 0.86], [0.1, 0.895], [0.25, 0.92], [0.5, 0.95], [1.0, 1.02], [1.45, 1.08], [1.62, 1.1], [3.0, 1.12], [4.5, 1.13],
      [4.68, 1.12], [4.75, 1.08], [4.785, 1.0], [4.8, 0.9]],
    bot: [[0, 0.44], [0.08, 0.35], [0.3, 0.28], [0.5, 0.27], [4.3, 0.27], [4.55, 0.33], [4.75, 0.42], [4.8, 0.48]],
    hw: [[0, 0.62], [0.025, 0.72], [0.08, 0.81], [0.18, 0.87], [0.35, 0.905], [0.6, 0.915], [4.3, 0.92], [4.5, 0.91], [4.66, 0.89], [4.75, 0.85], [4.8, 0.77]],
    nTop: 7, nBot: 5, tumble: 0.06, flare: 0.05,
    crisp: { drop: 0.1, tuck: 0.04, shoulder: 0.06, crown: 0.012, r: [0.05, 0.12, 0.016, 0.045, 0.22] },
    gh: { u0: 1.58, u1: 4.74, top: [[1.58, 1.09], [1.75, 1.2], [2.0, 1.4], [2.25, 1.57], [2.5, 1.675], [2.8, 1.71], [3.6, 1.715], [4.3, 1.705], [4.5, 1.68], [4.62, 1.58], [4.7, 1.36], [4.74, 1.12]],
      aTop: 2.55, cTop: 4.48, b: [2.86, 2.97], c: [3.86, 3.96], dPaint: 4.25, nTop: 3.4, tumble: 0.16 },
    seams: [{ u: 1.75, y0: 0.42, y1: 1.12 }, { u: 2.91, y0: 0.4, y1: 1.12 }, { u: 3.88, y0: 0.6, y1: 1.12 }, { u: 0.2, top: true }],
    cladding: true, roofRails: true,
    eye: { u: 2.75, y: 1.42, x: -0.37 },
    head: { y: 0.835, x: 0.6, w: 0.48, h: 0.11, d: 0.12, yaw: 0.3, drl: true },
    tail: { y: 1.0, patch: { u: [4.56, 4.797], t0: [0.35, 0.05], t1: [0.85, 1.1] } },
    grille: { y: 0.68, w: 0.95, h: 0.24, intake: { y: 0.47, w: 1.15, h: 0.11 } },
    plateF: 0.53, plateR: 0.78,
    mirror: { u: 1.86, y: 1.18 },
  },
  pickup: {
    L: 5.9, W: 2.0, H: 1.9, bodyW: 1.88, bodyEnd: 3.12,
    wheel: { r: 0.40, w: 0.275, rim: 'alloy' }, axles: [0.98, 4.66],
    top: [[0, 1.0], [0.03, 1.08], [0.1, 1.13], [0.3, 1.16], [0.9, 1.19], [1.45, 1.22], [1.62, 1.24], [3.12, 1.26]],
    bot: [[0, 0.5], [0.12, 0.44], [0.35, 0.42], [0.6, 0.43], [3.12, 0.43]],
    hw: [[0, 0.74], [0.03, 0.83], [0.1, 0.89], [0.25, 0.925], [0.45, 0.94], [3.12, 0.94]],
    nTop: 8, nBot: 6, tumble: 0.04, flare: 0.03,
    crisp: { drop: 0.13, tuck: 0.03, shoulder: 0.045, crown: 0.01, r: [0.04, 0.08, 0.016, 0.035, 0.2] },
    gh: { u0: 1.6, u1: 3.1, top: [[1.6, 1.24], [1.78, 1.38], [2.05, 1.6], [2.3, 1.77], [2.55, 1.865], [2.8, 1.9], [3.0, 1.895], [3.06, 1.85], [3.1, 1.6]],
      aTop: 2.5, cTop: 3.03, b: [2.42, 2.52], nTop: 4.0, tumble: 0.12, flatBack: true },
    seams: [{ u: 1.7, y0: 0.48, y1: 1.24 }, { u: 2.47, y0: 0.45, y1: 1.24 }, { u: 3.06, y0: 0.5, y1: 1.24 }],
    bed: { u0: 3.16, u1: 5.9, rail: 1.31, floor: 0.82 },
    eye: { u: 2.72, y: 1.56, x: -0.4 },
    head: { u: 0.02, y: 0.93, x: 0.7, w: 0.32, h: 0.17, d: 0.12, yaw: 0.25, drl: true },
    tail: { u: 5.87, y: 1.08, x: 0.89, w: 0.1, h: 0.36, d: 0.1, yaw: 0 },
    grille: { y: 0.86, w: 1.12, h: 0.36, intake: { y: 0.52, w: 0.9, h: 0.1 } },
    plateF: 0.58, plateR: 0.56,
    mirror: { u: 1.82, y: 1.32, big: true },
  },
  van: {
    L: 5.3, W: 2.0, H: 2.0, bodyW: 1.88,
    wheel: { r: 0.36, w: 0.235, rim: 'steel' }, axles: [0.92, 4.22],
    top: [[0, 0.72], [0.03, 0.82], [0.09, 0.9], [0.25, 0.97], [0.6, 1.06], [0.82, 1.11], [2.0, 1.13], [5.24, 1.14], [5.29, 1.1], [5.3, 1.04]],
    bot: [[0, 0.42], [0.1, 0.34], [0.3, 0.29], [5.0, 0.3], [5.22, 0.35], [5.3, 0.4]],
    hw: [[0, 0.64], [0.03, 0.75], [0.1, 0.84], [0.25, 0.9], [0.5, 0.932], [0.8, 0.94], [5.15, 0.94], [5.26, 0.925], [5.3, 0.88]],
    nTop: 7, nBot: 6, tumble: 0.04, flare: 0.03,
    crisp: { drop: 0.11, tuck: 0.035, shoulder: 0.05, crown: 0.01, r: [0.05, 0.1, 0.016, 0.04, 0.2] },
    gh: { u0: 0.8, u1: 5.3, top: [[0.8, 1.11], [0.95, 1.28], [1.15, 1.52], [1.35, 1.75], [1.55, 1.9], [1.8, 1.97], [2.1, 2.0], [5.18, 2.0], [5.27, 1.98], [5.3, 1.94]],
      aTop: 1.55, cTop: 5.3, b: [1.9, 2.0], nTop: 5.0, tumble: 0.07, flatBack: true, van: true },
    seams: [{ u: 0.96, y0: 0.62, y1: 1.12 }, { u: 1.95, y0: 0.36, y1: 1.12 }, { u: 3.18, y0: 0.36, y1: 1.12 }, { u: 5.28, y0: 0.4, y1: 1.12 }],
    eye: { u: 1.98, y: 1.58, x: -0.45 },
    head: { y: 0.87, x: 0.6, w: 0.44, h: 0.12, d: 0.12, yaw: 0.3, drl: true },
    tail: { y: 0.9, patch: { u: [5.22, 5.297], t0: [-0.55, -0.6], t1: [0.5, 0.5] } },
    grille: { y: 0.72, w: 0.95, h: 0.22, intake: { y: 0.47, w: 1.1, h: 0.1 } },
    plateF: 0.5, plateR: 0.55,
    mirror: { u: 1.08, y: 1.3, big: true },
  },
};

// ------------------------------------------------------------------ geometry builders
// crisp section parameters along the body: the shoulder crease sits a fixed distance below the local top
// (beltline in the cabin, fender top over the hood), so it reads as one continuous character line.
function crispAt(cfg, u, yb, yt) {
  const c = cfg.crisp, h = Math.max(0.05, yt - yb);
  const drop = typeof c.drop === 'function' ? c.drop(u) : c.drop;
  return { crease: Math.max(0.35, Math.min(0.93, 1 - drop / h)), tuck: c.tuck, shoulder: c.shoulder, crown: c.crown, r: c.r };
}
function prep(cfg) {
  if (cfg._f) return cfg._f;
  if (!cfg.type) cfg.type = Object.keys(CARS).find(k => CARS[k] === cfg) || 'car';
  const f = { top: curve(cfg.top), bot: curve(cfg.bot), hw: curve(cfg.hw), ghTop: curve(cfg.gh.top) };
  const r = cfg.wheel.r;
  f.Ra = r + 0.055; f.yc = r + 0.015;
  f.arch = (u) => {
    let y = -1;
    for (const a of cfg.axles) { const d = u - a; if (Math.abs(d) < f.Ra) y = Math.max(y, f.yc + Math.sqrt(f.Ra * f.Ra - d * d)); }
    return y;
  };
  f.section = (u) => {
    const yt = f.top(u);
    const yb = Math.min(f.bot(u), yt - 0.03);
    return { yb, yt, hw: f.hw(u), nTop: cfg.nTop, nBot: cfg.nBot, tumble: cfg.tumble, flare: cfg.flare, crisp: cfg.crisp ? crispAt(cfg, u, yb, yt) : undefined };
  };
  // x of the body surface at height y (same formula as loft)
  f.sideX = (u, y) => {
    const s = f.section(u), yc = (s.yb + s.yt) / 2, hh = (s.yt - s.yb) / 2;
    if (s.crisp) return crispX(s, Math.max(s.yb + 1e-3, Math.min(s.yt - 1e-3, y)));
    const v = Math.max(-1, Math.min(1, (y - yc) / hh));
    const n = v >= 0 ? s.nTop : s.nBot;
    const st = Math.sign(v) * Math.pow(Math.abs(v), n / 2), ct = Math.sqrt(Math.max(0, 1 - st * st));
    const fy = (y - s.yb) / (2 * hh);
    return s.hw * Math.pow(ct, 2 / n) * (1 - s.tumble * fy * fy - s.flare * (1 - fy) * (1 - fy));
  };
  // u where the front surface passes through (x, y)
  f.surfU = (x, y) => {
    for (let u = 0; u < cfg.L * 0.3; u += 0.002) { const sc = f.section(u); if (y >= sc.yb && y <= sc.yt && f.sideX(u, y) >= Math.abs(x)) return u; }
    return 0;
  };
  // u on the front (or rear) nose surface for a given height
  f.noseU = (y, rear = false) => {
    const L = cfg.bodyEnd || cfg.L;
    let a = rear ? L * 0.75 : 0, b = rear ? L : L * 0.25;
    if (!rear) { if (f.top(0) >= y) return 0; for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (f.top(m) < y) a = m; else b = m; } return (a + b) / 2; }
    if (f.top(L) >= y) return L; for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if (f.top(m) >= y) a = m; else b = m; } return (a + b) / 2;
  };
  cfg._f = f;
  return f;
}

function stationsFor(cfg, f, u0, u1, step, extra = []) {
  const st = [];
  for (let u = u0; u <= u1 + 1e-9; u += step) st.push(u);
  st.push(u1);
  for (const e of [0.003, 0.008, 0.015, 0.025, 0.04, 0.06]) { st.push(u0 + e, u1 - e); }
  for (const a of cfg.axles) for (const s of [-1, 1]) {
    const e = a + s * f.Ra; st.push(e - 0.004, e + 0.004, e - 0.015 * s, a + s * f.Ra * 0.97, a + s * f.Ra * 0.9, a + s * f.Ra * 0.8);
  }
  st.push(...extra);
  const out = [...new Set(st.filter(u => u >= u0 - 1e-9 && u <= u1 + 1e-9).map(u => Math.round(u * 1e4) / 1e4))].sort((a, b) => a - b);
  return out.filter((u, i) => i === 0 || u - out[i - 1] > 0.0015);
}

function buildBodyGeo(THREE, cfg) {
  const f = prep(cfg), L = cfg.L, uEnd = cfg.bodyEnd || L;
  const seamU = [];
  for (const s of cfg.seams) seamU.push(s.u - 0.0035, s.u + 0.0035);
  const st = stationsFor(cfg, f, 0, uEnd, 0.035, seamU);
  const seamAt = (u) => cfg.seams.find(s => Math.abs(u - s.u) < 0.0036);
  const archNear = (u, y) => cfg.axles.some(a => Math.hypot(u - a, y - f.yc) < f.Ra + 0.075);
  const geo = loft(THREE, {
    stations: st.map(u => u - L / 2), ring: 44,
    section: (z) => f.section(z + L / 2),
    clampY: (z, x, y) => { const a = f.arch(z + L / 2); return a > y ? a : y; },
    capMaterial: (end) => (end === 'rear' && cfg.bodyEnd ? S.PAINT : S.PAINT),
    material: (z, t, y) => {
      const u = z + L / 2, s = Math.sin(t), c = Math.cos(t);
      const sec = f.section(u);
      if (s < -0.86) return S.UNDER;
      const ar = f.arch(u); if (ar > 0 && y < ar + 0.012) return S.UNDER;
      const side = Math.abs(s) < 0.75;
      const seam = seamAt(u);
      if (s > 0.72 && u > cfg.gh.u0 + 0.06 && u < Math.min(cfg.gh.u1, cfg.gh.cTop + 0.1) - 0.06 && Math.abs(c) * sec.hw < sec.hw - 0.07) return S.INTERIOR; // cabin floor/dash top at the belt
      if (seam) {
        if (seam.top && s > 0.6) return S.TRIM;
        if (!seam.top && side && y > seam.y0 && y < seam.y1) return S.TRIM;
      }
      // lower cladding follows a horizontal line (per-face arch tests made a staircase around the wheel openings)
      if (cfg.cladding && side && y < 0.47) return S.PLASTIC;
      if (cfg.cladding && (u < 0.05 || u > L - 0.05) && y < 0.47) return S.PLASTIC;
      void archNear;
      if (!cfg.cladding && (u < 0.06 || u > L - 0.05) && y < sec.yb + 0.09 && s < 0.2) return S.PLASTIC;
      void c;
      return S.PAINT;
    },
  });
  return geo;
}

function buildGreenhouseGeo(THREE, cfg) {
  const f = prep(cfg), L = cfg.L, g = cfg.gh;
  const extra = [g.aTop, g.cTop, g.b[0], g.b[1], ...(g.c || []), ...(g.quarter || []), g.dPaint || 0].filter(Boolean);
  const st = stationsFor({ axles: [] }, f, g.u0, g.u1, 0.03, extra.flatMap(u => [u - 0.002, u + 0.002]));
  const sink = 0.12;
  const belt = (u) => f.top(u);
  const section = (u) => {
    const yb0 = belt(u);
    const yt = Math.max(f.ghTop(u), yb0 + 0.004);
    const hw = Math.max(0.05, f.sideX(u, yb0 - 0.03) - 0.018);
    return { yb: yb0 - sink, yt, hw, nTop: g.nTop, nBot: 10, tumble: g.tumble * Math.min(1, (yt - yb0) / 0.45), flare: 0, _belt: yb0 };
  };
  const inB = (u, r) => r && u > r[0] && u < r[1];
  const geo = loft(THREE, {
    stations: st.map(u => u - L / 2), ring: 48,
    section: (z) => section(z + L / 2),
    capMaterial: () => (g.flatBack ? S.PAINT : S.PAINT),
    material: (z, t, y) => {
      const u = z + L / 2, s = Math.sin(t);
      const sec = section(u);
      if (s < -0.2 || y < sec._belt - 0.01) return S.INTERIOR;
      const top = s > 0.86, corner = s > 0.6 && !top, side = !top && !corner;
      if (side && y < sec._belt + 0.03) return S.GLOSS;               // beltline molding
      if (g.van) {
        if (u < g.aTop) return corner ? S.PAINT : S.GLASS;
        if (top || corner) return S.PAINT;
        if (inB(u, g.b)) return S.TRIM;
        if (u > g.b[1] && y > 1.75) return S.PAINT;
        if (u > g.b[1] && (u < 2.06 || (u > 3.08 && u < 3.28) || u > 5.12)) return S.PAINT;
        return S.GLASS;
      }
      if (u < g.aTop) {                                                 // windshield zone
        if (top) return S.GLASS;
        if (corner) return s > 0.8 ? S.GLASS : S.PAINT;                 // A-pillar
        return S.GLASS;
      }
      if (u <= g.cTop) {                                                // roof zone
        if (top) return S.PAINT;
        if (corner) return s > 0.72 ? S.PAINT : S.TRIM;                 // drip rail / window surround
        if (inB(u, g.b) || inB(u, g.c)) return S.TRIM;
        if (g.dPaint && u > g.dPaint) return S.TRIM;
        if (g.quarter && u > g.quarter[0] - 0.02 && u < g.quarter[0] + 0.02) return S.TRIM;
        return S.GLASS;
      }
      // rear-glass zone
      if (top) return S.GLASS;
      if (corner) return s > 0.8 ? S.GLASS : S.PAINT;
      if (g.quarter && u < g.quarter[1] && y < sec._belt + (g.quarter[1] - u) * 1.5 + 0.08) return S.GLASS;
      return g.cPillarPaint ? S.PAINT : S.TRIM;
    },
  });
  return geo;
}

function placeLamp(THREE, cfg, f, spec, kind, sideSign, rear) {
  const L = cfg.L;
  const name = (kind === 'tail' ? 'taillight_' : 'headlight_') + (sideSign > 0 ? 'R' : 'L');
  if (spec.patch) {
    const P = spec.patch, M = getMaterials(THREE);
    const geo = cachedGeo(THREE, `lamp|${cfg.type}|${kind}|${sideSign}`, () => {
      const zs = []; for (let k = 0; k <= 14; k++) zs.push(P.u[0] + (P.u[1] - P.u[0]) * (k / 14) - L / 2);
      const lerp = (a, b, k) => a + (b - a) * k;
      return surfacePatch(THREE, {
        stations: zs, section: (z) => f.section(z + L / 2), nT: 10, off: 0.005,
        range: (z) => {
          const k = (z + L / 2 - P.u[0]) / (P.u[1] - P.u[0]);
          let t0 = lerp(P.t0[0], P.t0[1], k), t1 = lerp(P.t1[0], P.t1[1], k);
          if (sideSign < 0) { const a = Math.PI - t1, b = Math.PI - t0; t0 = a; t1 = b; }
          return [t0, t1];
        },
      });
    });
    const mesh = new THREE.Mesh(geo, kind === 'tail' ? M.lightTail : M.lightHead);
    mesh.name = name; mesh.userData.lampKind = kind;
    return mesh;
  }
  const lamp = makeLamp(THREE, { name, kind, w: spec.w, h: spec.h, d: spec.d, r: Math.min(spec.w, spec.h) * (spec.drl ? 0.22 : 0.35) });
  if (spec.drl) {
    // inner projector + LED strip so the lamp reads as an integrated unit, not a blob
    const M = getMaterials(THREE);
    const strip = new THREE.Mesh(roundedBox(THREE, spec.w * 0.78, 0.014, 0.02, 0.006), M.lightRev); strip.name = 'drl';
    strip.position.set(0, -spec.h * 0.28, -spec.d / 2 - 0.003); lamp.add(strip);
    const proj = new THREE.Mesh(roundedBox(THREE, 0.075, spec.h * 0.55, 0.02, 0.02), M.chrome); proj.name = 'projector';
    proj.position.set(-sideSign * spec.w * 0.22, spec.h * 0.08, -spec.d / 2 - 0.002); lamp.add(proj);
    const bez = new THREE.Mesh(roundedBox(THREE, spec.w + 0.025, spec.h + 0.02, spec.d * 0.8, Math.min(spec.w, spec.h) * 0.2), M.trimGloss); bez.name = 'lamp_bezel';
    bez.position.set(0, 0, 0.012); lamp.add(bez);
  }
  const y = spec.y, u = f.noseU(y, rear);
  // outward surface normal in the (z,y) plane from the profile slope
  const du = 0.006, t = (f.top(Math.min(u + du, L)) - f.top(Math.max(u - du, 0))) / (2 * du);
  const atEnd = rear ? u >= (cfg.bodyEnd || L) - 1e-4 : u <= 1e-4;
  let a = spec.pitch ?? (atEnd ? 0 : Math.atan2(1, Math.abs(t)));   // 0 = vertical face, PI/2 = horizontal
  lamp.rotation.order = 'YXZ';
  lamp.rotation.x = a;
  lamp.rotation.y = rear ? Math.PI + sideSign * spec.yaw : -sideSign * spec.yaw;
  if (spec.drl && !rear) {
    // sit the lamp on the actual nose surface: follow its plan curvature, face ~1.5 cm proud
    const half = spec.w * 0.45;
    const uc = f.surfU(spec.x, y), uo = f.surfU(spec.x + half, y), ui = f.surfU(spec.x - half, y);
    const yaw = Math.atan2(uo - ui, 2 * half);
    lamp.rotation.y = -sideSign * yaw;
    lamp.position.set(sideSign * spec.x, y, Math.max(uc, (uo + ui) / 2) - L / 2 + spec.d / 2 - 0.015);
    return lamp;
  }
  const ny = Math.sin(a), nz = (rear ? 1 : -1) * Math.cos(a);
  const inset = spec.d / 2 - 0.012;
  lamp.position.set(sideSign * spec.x, y - ny * inset, u - L / 2 - nz * inset);
  return lamp;
}

function buildCarTemplate(THREE, type) {
  const cfg = CARS[type], f = prep(cfg), L = cfg.L, M = getMaterials(THREE);
  const outer = new THREE.Group();
  const root = new THREE.Group(); root.name = 'shell'; outer.add(root);
  const mats = slotMats(THREE, 0xa9adb2);
  const addMesh = (geo, mat, name, pos, rot, paintSlot) => {
    const m = new THREE.Mesh(geo, mat); m.name = name;
    if (pos) m.position.set(...pos);
    if (rot) { m.rotation.order = 'YXZ'; m.rotation.set(...rot); }
    if (paintSlot != null) m.userData.paintSlot = paintSlot;
    root.add(m); return m;
  };
  addMesh(cachedGeo(THREE, 'carbody|' + type, () => buildBodyGeo(THREE, cfg)), mats, 'body', null, null, 'array');
  addMesh(cachedGeo(THREE, 'cargh|' + type, () => buildGreenhouseGeo(THREE, cfg)), mats, 'cabin', null, null, 'array');

  const z = (u) => u - L / 2;
  const tw = cfg.wheel.w, hwB = cfg.bodyW / 2;
  // wheel-well blockers (stop see-through under the arches) + chassis
  for (const a of cfg.axles) {
    const wInner = cfg.bodyW - 2 * (tw + 0.07), h = f.yc + f.Ra - 0.16;
    const y0 = Math.max(0.12, f.bot(L / 2) - 0.04), hh = f.yc + f.Ra - 0.02 - y0;
    addMesh(roundedBox(THREE, wInner, hh, f.Ra * 2, 0.02), M.underbody, 'wheelwell', [0, y0 + hh / 2, z(a)]);
    for (const s of [-1, 1]) addMesh(roundedBox(THREE, 0.04, h * 0.75, f.Ra * 1.9, 0.015), M.underbody, 'well_liner', [s * (hwB - tw - 0.05), f.yc + 0.12, z(a)]);
  }
  const uEnd = cfg.bodyEnd || L;
  addMesh(roundedBox(THREE, cfg.bodyW - 0.5, 0.08, uEnd - 1.3, 0.03), M.underbody, 'floorpan', [0, f.bot(L / 2) - 0.02, z(uEnd / 2)]);

  // interior: dash, steering wheel, seats (driver-seat views look past the wheel + A-pillar through tinted glass)
  const g = cfg.gh;
  {
    const beltMid = f.top((g.u0 + g.cTop) / 2);
    const rows = type === 'sedan' || type === 'suv' ? 2 : 1;
    // dash front must stay behind the windshield: first u where the glass clears the dash top
    let uClear = g.u0; const dashTop = cfg.eye.y - 0.32 + 0.07;
    while (uClear < cfg.eye.u - 0.5 && f.ghTop(uClear) < dashTop) uClear += 0.01;
    const dashU = Math.max(uClear + 0.31, cfg.eye.u - 0.95);
    const uD = dashU - 0.3, beltD = f.top(uD);
    const dashW = 2 * (f.sideX(uD, beltD - 0.03) - 0.018) * (1 - g.tumble * Math.max(0, Math.min(1, (dashTop - beltD) / 0.45))) - 0.12;
    const inter = makeInterior(THREE, { eye: [cfg.eye.x, cfg.eye.y, z(cfg.eye.u)], width: 2 * (f.sideX((g.aTop + g.cTop) / 2, beltMid) - 0.08),
      floorY: beltMid - 0.45, dashZ: z(dashU), rearZ: z(Math.min(g.cTop, g.u1 - 0.15)), rows, swDrop: 0.31, dashW,
      mirrorY: f.ghTop(g.aTop) - 0.08, mirrorZ: z(g.aTop + 0.08) });
    root.add(inter);
  }

  const ghY = (u, x) => {
    const yb0 = f.top(u), yt = Math.max(f.ghTop(u), yb0 + 0.004), sink = 0.12, ybb = yb0 - sink;
    const hw = (f.sideX(u, yb0 - 0.03) - 0.018) * (1 - g.tumble * Math.min(1, (yt - yb0) / 0.45));
    const n = g.nTop, ct = Math.min(1, Math.pow(Math.abs(x) / hw, n / 2)), st = Math.sqrt(1 - ct * ct);
    return (ybb + yt) / 2 + (yt - ybb) / 2 * Math.pow(st, 2 / n);
  };
  // ---- front end
  const fu = (y) => f.noseU(y);
  const G = cfg.grille;
  {
    const u = fu(G.y);
    const t = (f.top(u + 0.01) - f.top(Math.max(0, u - 0.01))) / 0.02;
    const pitch = u > 0.001 ? Math.atan2(1, t) * 0.0 + (Math.PI / 2 - Math.atan2(t, 1)) * 0 : 0;
    const gm = addMesh(roundedBox(THREE, G.w, G.h, 0.1, 0.03), M.trimGloss, 'grille', [0, G.y, z(u) + 0.035], [0, 0, 0]);
    gm.rotation.x = u > 0.001 ? (Math.atan2(1, t) - Math.PI / 2) * -1 * 0 : 0; void pitch;
    // grille bars (subtle horizontal slats)
    const nb = Math.max(2, Math.round(G.h / 0.05));
    for (let k = 1; k < nb; k++) addMesh(roundedBox(THREE, G.w - 0.06, 0.008, 0.02, 0.003), M.plastic, 'grille_bar', [0, G.y - G.h / 2 + (k * G.h) / nb, z(u) - 0.017]);
    if (type === 'pickup') addMesh(roundedBox(THREE, G.w + 0.06, G.h + 0.06, 0.06, 0.035), M.alloy, 'grille_surround', [0, G.y, z(u) + 0.03]);
    const I = G.intake;
    const iu = fu(I.y);
    addMesh(roundedBox(THREE, I.w, I.h, 0.08, 0.03), M.trimGloss, 'intake', [0, I.y, z(iu) + 0.03]);
  }
  // headlights
  for (const s of [-1, 1]) root.add(placeLamp(THREE, cfg, f, cfg.head, 'head', s, false));
  // amber side markers / fog lamps
  for (const s of [-1, 1]) {
    const yy = cfg.grille.intake.y;
    const m = makeLamp(THREE, { name: 'foglamp', kind: 'head', w: 0.12, h: 0.05, d: 0.06 });
    m.userData.lampKind = 'fog';
    m.position.set(s * (cfg.grille.intake.w / 2 + 0.12), yy, z(fu(yy)) + 0.02);
    root.add(m);
  }
  // front plate (blank)
  const plate = (y, front) => {
    const u = front ? fu(y) : f.noseU(y, true);
    const zz = z(u) + (front ? -0.004 : 0.004);
    addMesh(roundedBox(THREE, 0.32, 0.165, 0.012, 0.006), M.trim, 'plate_frame', [0, y, zz + (front ? 0.004 : -0.004)]);
    addMesh(roundedBox(THREE, 0.305, 0.152, 0.012, 0.006), M.plate, front ? 'plate_front' : 'plate_rear', [0, y, zz]);
  };
  plate(cfg.plateF, true);

  // ---- rear end
  if (!cfg.bed) {
    for (const s of [-1, 1]) root.add(placeLamp(THREE, cfg, f, cfg.tail, 'tail', s, true));
    plate(cfg.plateR, false);
    const ru = f.noseU(0.45, true);
    addMesh(roundedBox(THREE, cfg.bodyW * 0.55, 0.05, 0.04, 0.015), M.trim, 'rear_diffuser', [0, f.bot(L) + 0.05, z(L) - 0.025]);
    void ru;
    if (type === 'van') {
      // rear door windows + split line + handles
      for (const s of [-1, 1]) addMesh(roundedBox(THREE, 0.68, 0.5, 0.03, 0.04), M.glass, 'rear_window', [s * 0.42, 1.5, z(L) + 0.005]);
      addMesh(roundedBox(THREE, 0.008, 1.5, 0.02, 0.003), M.trim, 'door_split', [0, 1.12, z(L) + 0.004]);
      addMesh(roundedBox(THREE, 1.7, 0.18, 0.12, 0.04), M.plastic, 'rear_bumper', [0, 0.42, z(L) - 0.03]);
    }
  } else {
    buildBed(THREE, cfg, f, root, addMesh, z);
  }

  // ---- mirrors: housing on a short, deep sail at the A-pillar base (housing reaches exactly W/2)
  for (const s of [-1, 1]) {
    const mu = cfg.mirror.u, big = cfg.mirror.big, belt = f.top(mu);
    const hx = big ? 0.12 : 0.15, hy = big ? 0.26 : 0.12, hz = big ? 0.08 : 0.085;
    const my = belt + (big ? 0.18 : 0.085);
    const cx = s * (cfg.W / 2 - hx / 2);
    const rotY = [0, -s * 0.1, 0];
    addMesh(roundedBox(THREE, hx, hy, hz, big ? 0.03 : 0.028), big ? M.trimGloss : mats[0], 'mirror_housing', [cx, my, z(mu)], rotY, big ? null : 0);
    addMesh(roundedBox(THREE, hx * 0.88, hy * 0.8, 0.008, 0.015), M.mirror, 'mirror_glass', [cx - s * 0.004, my, z(mu) + hz / 2 + 0.002], rotY);
    const sx = f.sideX(mu, belt - 0.02) - 0.02;
    const armW = Math.max(0.03, Math.abs(cx) - hx * 0.35 - sx);
    // sail: deep, low wedge from the door top to the housing (no thin stalk)
    addMesh(roundedBox(THREE, armW, big ? 0.05 : 0.06, big ? 0.07 : 0.15, 0.015), big ? M.trimGloss : M.trimGloss, 'mirror_sail',
      [s * (sx + armW / 2), big ? my - 0.08 : belt + 0.035, z(mu) + (big ? 0 : 0.03)]);
    if (!big) addMesh(roundedBox(THREE, 0.03, 0.07, 0.1, 0.01), mats[0], 'mirror_neck', [s * (Math.abs(cx) - hx * 0.3), belt + 0.06, z(mu) + 0.005], null, 0);
  }
  // ---- door handles (gloss black, flush)
  const handles = type === 'van' ? [1.6, 2.75] : type === 'pickup' ? [2.25, 2.95] : type === 'suv' ? [2.55, 3.6] : [2.62, 3.62];
  for (const hu of handles) for (const s of [-1, 1]) {
    const hy = f.top(hu) - (type === 'sedan' ? 0.09 : 0.1);
    addMesh(roundedBox(THREE, 0.03, 0.035, 0.17, 0.012), M.trimGloss, 'door_handle', [s * (f.sideX(hu, hy) - 0.005), hy, z(hu)]);
  }
  // ---- roof rails (suv)
  if (cfg.roofRails) for (const s of [-1, 1]) {
    const ry = ghY(2.9, 0.58) - 0.005;
    addMesh(roundedBox(THREE, 0.045, 0.03, 1.6, 0.014), M.trim, 'roof_rail', [s * 0.58, ry + 0.045, z(3.5)]);
    for (const fu2 of [2.78, 4.22]) addMesh(roundedBox(THREE, 0.05, 0.05, 0.12, 0.012), M.trim, 'roof_rail_foot', [s * 0.58, ry + 0.02, z(fu2)]);
  }
  // ---- side indicator repeaters / reflectors
  for (const s of [-1, 1]) {
    const ru = L - 0.25 - (cfg.bed ? 0 : 0);
    if (!cfg.bed) {
      const ry = f.bot(ru) + 0.12;
      addMesh(roundedBox(THREE, 0.01, 0.03, 0.09, 0.01), M.lightTail, 'reflector', [s * (f.sideX(ru, Math.max(ry, f.section(ru).yb + 0.05)) + 0.0), Math.max(ry, f.section(ru).yb + 0.05), z(ru)]);
    }
  }
  // snap the assembled shell to the exact catalog envelope (add-ons may poke out by a few mm-cm)
  root.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(root), sz = bb.getSize(new THREE.Vector3());
  root.scale.set(cfg.W / sz.x, cfg.H / sz.y, cfg.L / sz.z);
  root.position.set(-(bb.min.x + bb.max.x) / 2 * root.scale.x, -bb.min.y * root.scale.y, -(bb.min.z + bb.max.z) / 2 * root.scale.z);
  return outer;
}

function buildBed(THREE, cfg, f, root, addMesh, z) {
  const M = getMaterials(THREE), L = cfg.L, B = cfg.bed;
  const mats = root.children[0].material;
  const r = cfg.wheel.r, Ra = f.Ra, yc = f.yc;
  const wall = 0.07, hwB = cfg.bodyW / 2;
  const top = (u) => B.rail;
  const bot = (u) => {
    let y = u > L - 0.25 ? 0.62 + (u - (L - 0.25)) * 0.2 : 0.5;
    const a = cfg.axles[1], d = u - a;
    if (Math.abs(d) < Ra) y = Math.max(y, yc + Math.sqrt(Ra * Ra - d * d));
    return y;
  };
  const hwP = curve([[B.u0, 0.94], [B.u0 + 0.05, 0.945], [L - 0.15, 0.94], [L - 0.04, 0.925], [L, 0.9]]);
  const st = stationsFor({ axles: [cfg.axles[1]] }, f, B.u0, L - 0.07, 0.04, []);
  for (const s of [-1, 1]) {
    const geo = cachedGeo(THREE, 'bedside|' + s, () => loft(THREE, {
      stations: st.map(u => u - L / 2), ring: 28,
      section: (zz) => { const u = zz + L / 2; const hw = hwP(u) * (hwB / 0.94); return { yb: bot(u), yt: top(u), hw: wall, cx: s * (hw - wall), nTop: 6, nBot: 6 }; },
      material: (zz, t, y) => {
        const sn = Math.sin(t), c = Math.cos(t);
        if (sn < -0.6) return S.UNDER;
        if (sn > 0.8) return S.TRIM;                       // rail cap
        if (c * s < -0.3) return S.TRIM;                   // inner face (bedliner)
        return S.PAINT;
      },
    }));
    const m = new THREE.Mesh(geo, mats); m.name = 'bed_side'; m.userData.paintSlot = 'array'; root.add(m);
    // tail light (vertical, at the rear of the bed side)
    const tl = makeLamp(THREE, { name: 'taillight_' + (s > 0 ? 'R' : 'L'), kind: 'tail', w: 0.11, h: cfg.tail.h, d: 0.06, r: 0.025 });
    tl.position.set(s * (hwB - 0.065), cfg.tail.y, z(L - 0.07) + 0.02);
    root.add(tl);
  }
  // bed floor, front wall, tailgate, bumper, chassis, spare
  const inner = cfg.bodyW - 2 * wall * 2;
  addMesh(roundedBox(THREE, inner, 0.05, L - 0.08 - B.u0, 0.01), M.plastic, 'bed_floor', [0, B.floor, z((B.u0 + L - 0.08) / 2)]);
  addMesh(roundedBox(THREE, cfg.bodyW - 0.02, B.rail - B.floor + 0.02, 0.06, 0.02), mats[0], 'bed_front', [0, (B.rail + B.floor) / 2, z(B.u0 + 0.01)], null, 0);
  addMesh(roundedBox(THREE, cfg.bodyW - 0.2, B.rail - 0.62, 0.07, 0.025), mats[0], 'tailgate', [0, (B.rail + 0.62) / 2, z(L - 0.07)], null, 0);
  addMesh(roundedBox(THREE, 0.24, 0.035, 0.03, 0.01), M.trimGloss, 'tailgate_handle', [0, B.rail - 0.1, z(L - 0.035)]);
  addMesh(roundedBox(THREE, cfg.bodyW, 0.2, 0.14, 0.04), M.alloy, 'rear_bumper', [0, 0.55, z(L - 0.07)]);
  addMesh(roundedBox(THREE, 0.32, 0.165, 0.012, 0.006), M.trim, 'plate_frame', [0, cfg.plateR, z(L) + 0.004]);
  addMesh(roundedBox(THREE, 0.305, 0.152, 0.012, 0.006), M.plate, 'plate_rear', [0, cfg.plateR, z(L) + 0.002]);
  addMesh(roundedBox(THREE, cfg.bodyW - 0.62, 0.3, L - B.u0 - 0.2, 0.03), M.underbody, 'chassis', [0, 0.6, z((B.u0 + L) / 2)]);
  addMesh(roundedBox(THREE, 0.06, 0.62, 0.06, 0.01), M.underbody, 'cab_gap', [0, 0.93, z(B.u0 - 0.01)]);
  void r;
  // front bumper (pickup: big satin bumper)
  addMesh(roundedBox(THREE, cfg.bodyW + 0.02, 0.24, 0.16, 0.05), M.alloy, 'front_bumper', [0, 0.58, z(0.02)]);
}

// ================================================================== loop-stack car bodies (v3)
// Each car = a SPEC of side-view / plan-view curves (u = metres from the front bumper, y up, x half-widths).
// Body: stack of plan loops (bottom centre -> rocker -> sides -> shoulder -> crowned top) with superellipse corners,
// so bumpers wrap in plan and the hood/deck crown is continuous. Greenhouse: its own stack (belt -> rail -> roof) with
// windshield / DLO / pillars addressed by loop index (straight, clean edges). Wheel arches are cut on a circle and
// trimmed with a lip + dark liner. Lamps, grille, seams, plates, handles, wipers are conforming patches raycast onto
// the finished shell (offset a few mm), so they sit on the real surface instead of floating boxes.
const NQF = 18, NQR = 16;
const G = { PAINT: 0, TRIM: 1, UNDER: 2, GLASS: 3, PLASTIC: 4, INTERIOR: 5, GLOSS: 6, CHROME: 7 };
function gMats(THREE, color) {
  const M = getMaterials(THREE);
  return [M.paint(color), M.trim, M.underbody, M.glassTint || M.glass, M.plastic, M.interior, M.trimGloss, M.chrome];
}
const C = (pts) => curve(pts);
const K = (v) => (typeof v === 'number' ? () => v : typeof v === 'function' ? v : curve(v));

export const SPECS = {
  sedan: {
    L: 4.9, W: 1.9, H: 1.45,
    wheel: { r: 0.335, w: 0.235, rim: 'alloy' }, axles: [0.96, 3.81], arch: { R: 0.392, yc: 0.352, lip: 0.011 },
    body: {
      yBot: [[0, 0.27], [0.18, 0.225], [0.45, 0.195], [0.8, 0.185], [4.2, 0.185], [4.55, 0.205], [4.75, 0.245], [4.9, 0.3]],
      yS: [[0, 0.7], [0.12, 0.715], [0.35, 0.745], [0.8, 0.81], [1.3, 0.865], [1.75, 0.905], [2.2, 0.935], [3.0, 0.96], [3.8, 0.982], [4.3, 0.995], [4.9, 0.99]],
      half: [[0, 0.83], [0.35, 0.875], [0.9, 0.9], [2.0, 0.905], [3.5, 0.905], [4.3, 0.898], [4.9, 0.875]],
      zF: [[0, 0.17], [0.1, 0.085], [0.25, 0.03], [0.42, 0.006], [0.55, 0], [0.68, 0.012], [0.8, 0.04], [0.9, 0.075], [0.96, 0.1], [1, 0.125]],
      // rear (distance in from the rear end): bumper proud, crisp bumper-top shelf at f~0.45, trunk face above it
      zR: [[0, 0.2], [0.12, 0.075], [0.25, 0.022], [0.38, 0.003], [0.43, 0], [0.445, 0.004], [0.46, 0.03], [0.6, 0.034], [0.8, 0.04], [0.92, 0.052], [0.97, 0.064], [1, 0.08]],
      dF: [[0, 0.46], [0.5, 0.52], [1, 0.5]], nF: 2.35, dR: [[0, 0.36], [0.5, 0.4], [1, 0.42]], nR: 2.9,
      s: [[0, 0.06], [0.04, 0.035], [0.1, 0.016], [0.18, 0.008], [0.21, 0.004], [0.35, 0.001], [0.55, 0], [0.7, 0.002], [0.8, 0.005], [0.84, 0.006], [0.87, 0.011], [0.93, 0.02], [0.97, 0.03], [1, 0.042]],
      fLevels: [0, 0.015, 0.04, 0.08, 0.13, 0.18, 0.21, 0.26, 0.33, 0.39, 0.43, 0.445, 0.46, 0.48, 0.52, 0.58, 0.64, 0.7, 0.75, 0.79, 0.82, 0.84, 0.855, 0.87, 0.89, 0.92, 0.95, 0.975, 0.99, 1],
      roll: { r: 0.03, crown: 0.035 },
      lowerFront: 0.11, lowerRear: 0.2,
    },
    gh: {
      dGH: 0.06,
      yRail: [[2.0, 1.36], [2.9, 1.382], [3.6, 1.36]],
      roofTop: [[2.3, 1.4], [2.6, 1.435], [2.95, 1.45], [3.25, 1.44], [3.6, 1.405]],
      zF: (f) => 1.72 + 0.66 * f - 0.025 * Math.sin(Math.PI * f),
      zR: (f) => 4.13 - 0.66 * f + 0.02 * Math.sin(Math.PI * f),
      dF: [[0, 0.3], [1, 0.15]], dR: [[0, 0.17], [1, 0.12]], nF: 2.3, nR: 2.5,
      tumble: (f) => 0.15 * f + 0.03 * f * f,
      side: [
        { to: (f, a) => a + 0.1, n: 3, mat: 'PAINT' },            // A pillar
        { to: () => 2.8, n: 12, mat: 'GLASS' },                    // front door glass
        { to: () => 2.885, n: 3, mat: 'GLOSS' },                   // B pillar (gloss black)
        { to: (f) => 3.72 - 0.43 * f, n: 12, mat: 'GLASS' },      // rear door glass
        { to: 'b', n: 6, mat: 'PAINT' },                           // C pillar / sail
      ],
      fLevels: [-0.25, 0, 0.035, 0.07, 0.14, 0.24, 0.36, 0.5, 0.64, 0.78, 0.88, 0.93, 0.965, 1],
      roofT: [0.012, 0.03, 0.055, 0.085, 0.11, 0.14, 0.19, 0.27, 0.37, 0.5, 0.64, 0.78, 0.9, 1],
      frame: 0.93, belt: 0.035, beltMat: 'CHROME', header: 0.1, headerR: 0.1, uc: 2.95,
    },
    eye: { u: 2.82, y: 1.16, x: -0.37 },
    mirror: { u: 2.1, dy: 0.065 },
    headY: 0.655,
    rows: 2,
    detail: 'sedan',
  },
};

function prepSpec(S) {
  if (S._f) return S._f;
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
  g.rho = (t) => 0.72 * (1 - Math.pow(1 - Math.min(1, t / 0.13), 2)) + 0.28 * (1 - (1 - t) * (1 - t));
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
        if (q.seg === 'R') { if (q.k >= NQR - 2) return G.GLOSS; return Gs.rearMat ? mat(Gs.rearMat(q)) : G.GLASS; }
        const sg = Gs.side[g.segOf(q.k)];
        let m = typeof sg.mat === 'function' ? sg.mat(q) : sg.mat;
        if (m === 'GLASS') { if (lv.f >= Gs.frame) return G.GLOSS; if (lv.f < Gs.belt) return mat(Gs.beltMat || 'GLOSS'); }
        return mat(m);
      }
      // roof
      if (q.seg === 'F' && lv.t < Gs.header) return q.k >= NQF - 2 ? G.GLOSS : (Gs.frontMat ? mat(Gs.frontMat(q)) : G.GLASS);
      if (q.seg === 'F' && lv.t < Gs.header + 0.04) return G.GLOSS;
      if (q.seg === 'R' && lv.t < Gs.headerR) return q.k >= NQR - 2 ? G.GLOSS : (Gs.rearMat ? mat(Gs.rearMat(q)) : G.GLASS);
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
  k.around = (end, s, y, cast = hitB) => {
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
    return cast([x + nx * 0.3, y, Z(u + nu * 0.3)], [-nx, 0, -nu], 1.2);
  };
  // lens-shaped patch over (s, y): lo(σ), hi(σ) with rounded ends; expand grows it uniformly (bezels)
  k.wrapGrid = (end, s0, s1, lo, hi, { cols = 28, rows = 6, round = 0.12, expand = 0, cast = hitB } = {}) => {
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
  add(ghGeo, mats.map((m, i) => (i === G.GLASS ? hide : M.cabinLining)), 'cabin_lining');

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

  if (S.detail === 'sedan') sedanDetails(THREE, S, kit, add, both, mats);

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
    const inter = makeInterior(THREE, { eye: [S.eye.x, S.eye.y, Z(S.eye.u)], width: 2 * (g.baseHalf(S.eye.u) - 0.07),
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

// ------------------------------------------------------------------ sedan trim, lamps, seams
function sedanDetails(THREE, S, kit, add, both, mats) {
  const M = getMaterials(THREE), f = kit.f, L = S.L;
  const seam = M.trim;
  const ribbon = (hits, w = 0.007, off = 0.0012) => hitRibbon(THREE, hits, w, off);
  const cache = (key, fn) => cachedGeo(THREE, `v3|${S.detail}|${key}`, fn);
  // ---- side panel gaps (right side, mirrored)
  const sideLine = (pts, n = 40) => {
    const c = []; for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < n; j++) { const t = j / n; c.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]); }
    c.push(pts[pts.length - 1]);
    return c.map(([u, y]) => kit.side(u, y));
  };
  const beltAt = (u) => f.yS(u) - 0.004;
  const R2 = f.R + 0.045, ax2 = S.axles[1];
  const rearDoor = [[3.74, beltAt(3.74)]];
  for (let i = 0; i <= 10; i++) { const a = Math.PI * (0.38 + 0.5 * (i / 10)); rearDoor.push([ax2 - R2 * Math.cos(a), f.yc + R2 * Math.sin(a)]); }
  rearDoor.push([ax2 - R2 - 0.005, 0.31]);
  const seams = [
    [[1.86, 0.31], [1.86, 0.72], [1.9, beltAt(1.9)]],        // front door leading edge
    [[2.85, 0.27], [2.85, beltAt(2.85)]],                     // B gap
    rearDoor,                                                 // rear door trailing edge round the arch
    [[1.86, 0.31], [ax2 - R2 - 0.005, 0.31]],                 // door bottoms
  ];
  seams.forEach((sl, i) => both(cache('seam' + i, () => ribbon(sideLine(sl, 30))), seam, 'seam_side'));
  // fuel door (right rear quarter)
  {
    const u0 = 4.12, u1 = 4.3, y0 = 0.8, y1 = 0.92, pts = [];
    for (let i = 0; i <= 32; i++) { const a = i / 32 * Math.PI * 2; pts.push([(u0 + u1) / 2 + Math.cos(a) * (u1 - u0) / 2 * 1.0, (y0 + y1) / 2 + Math.sin(a) * (y1 - y0) / 2]); }
    add(cache('fuel', () => ribbon(pts.map(([u, y]) => kit.side(u, y)), 0.005)), seam, 'fuel_door');
  }
  // ---- door handles (body colour on a dark pocket)
  for (const hu of [2.55, 3.5]) {
    const hy = f.yS(hu) - 0.1;
    const pocket = cache('pocket' + hu, () => hitPatch(THREE, kit.grid(3, 8, (i, j) => kit.side(hu - 0.09 + 0.18 * j, hy - 0.022 + 0.044 * i)), 0.0015));
    both(pocket, M.trimGloss, 'handle_pocket');
    const h = kit.side(hu, hy);
    for (const s of [-1, 1]) {
      const m = add(roundedBox(THREE, 0.03, 0.03, 0.16, 0.013), mats[0], 'door_handle', 0);
      m.position.set(s * (h.p[0] + 0.006), hy, h.p[2]);
    }
  }
  // ---- headlamps: slim wraparound units under the hood shut line
  const hl = { s0: 0.4, s1: 1.04, lo: (t) => 0.628 - 0.01 * t, hi: (t) => 0.666 + 0.026 * Math.pow(t, 1.4) };
  both(cache('hl_bezel', () => hitPatch(THREE, kit.wrapGrid('F', hl.s0, hl.s1, hl.lo, hl.hi, { expand: 0.012, round: 0.1 }), 0.0025)), M.trimGloss, 'headlamp_bezel');
  const hlLens = cache('hl_lens', () => hitPatch(THREE, kit.wrapGrid('F', hl.s0, hl.s1, hl.lo, hl.hi, { round: 0.14 }), 0.0045));
  add(hlLens, M.lightHead, 'headlight_R').userData.lampKind = 'head';
  add(mirrorX(THREE, hlLens), M.lightHead, 'headlight_L').userData.lampKind = 'head';
  both(cache('hl_drl', () => ribbon(kit.line(30, t => kit.around('F', hl.s0 + 0.03 + (hl.s1 - hl.s0 - 0.05) * t, hl.lo(t) + 0.009)), 0.007, 0.006)), M.lightRev, 'drl');
  for (const sp of [0.62, 0.76]) both(cache('hl_proj' + sp, () => hitPatch(THREE, kit.wrapGrid('F', sp - 0.022, sp + 0.022, () => 0.647, () => 0.672, { cols: 8, rows: 4, round: 0.5 }), 0.0055)), M.chrome, 'projector');
  // ---- hood shut line, hood side seams, bumper-to-fender seam
  add(cache('hood_front', () => ribbon(kit.line(40, t => kit.around('F', 0.0001 + 0.39 * t, 0.69)).concat([]))), seam, 'seam_hood');
  add(cache('hood_front_L', () => mirrorX(THREE, ribbon(kit.line(40, t => kit.around('F', 0.0001 + 0.39 * t, 0.69))))), seam, 'seam_hood');
  both(cache('hood_side', () => ribbon(kit.line(40, t => kit.top(0.72 - 0.06 * Math.pow(1 - t, 3), 0.33 + (1.68 - 0.33) * t)))), seam, 'seam_hood');
  // ---- grille + intake + front plate
  const gy0 = 0.36, gy1 = 0.585, gw = (y) => 0.34 + 0.12 * (y - gy0) / (gy1 - gy0);
  add(cache('grille', () => hitPatch(THREE, kit.grid(8, 24, (i, j) => { const y = gy0 + (gy1 - gy0) * i; return kit.front((2 * j - 1) * gw(y), y); }), 0.003)), M.trimGloss, 'grille');
  for (let b = 1; b < 6; b++) {
    const y = gy0 + (gy1 - gy0) * b / 6;
    add(cache('gbar' + b, () => ribbon(kit.line(24, t => kit.front((2 * t - 1) * (gw(y) - 0.015), y)), 0.008, 0.006)), M.plastic, 'grille_bar');
  }
  {
    const ring = [];
    const P = [[-gw(gy0), gy0], [gw(gy0), gy0], [gw(gy1), gy1], [-gw(gy1), gy1], [-gw(gy0), gy0]];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 12; j++) { const t = j / 12; ring.push(kit.front(P[i][0] + (P[i + 1][0] - P[i][0]) * t, P[i][1] + (P[i + 1][1] - P[i][1]) * t)); }
    ring.push(ring[0]);
    add(cache('gsurround', () => ribbon(ring, 0.014, 0.005)), M.chrome, 'grille_surround');
  }
  add(cache('intake', () => hitPatch(THREE, kit.grid(3, 24, (i, j) => { const y = 0.255 + 0.05 * i; return kit.front((2 * j - 1) * (0.52 - 0.04 * i), y); }), 0.003)), M.trimGloss, 'intake');
  both(cache('fvent', () => hitPatch(THREE, kit.wrapGrid('F', 0.72, 0.9, (t) => 0.3 + 0.02 * t, (t) => 0.4 + 0.04 * t, { cols: 10, rows: 5, round: 0.3 }), 0.003)), M.trimGloss, 'bumper_vent');
  add(cache('plateF', () => hitPatch(THREE, kit.grid(3, 8, (i, j) => kit.front(-0.152 + 0.304 * j, 0.405 + 0.15 * i)), 0.012)), M.plate, 'plate_front');
  // ---- windshield wipers + cowl
  {
    const g = ghPrep(S, f), Gs = S.gh;
    const yW = (x) => f.topY(x, Gs.zF(0)) + 0.03;
    for (const [x0, x1] of [[-0.66, 0.02], [-0.02, 0.6]]) {
      add(cache('wiper' + x0, () => ribbon(kit.line(20, t => { const x = x0 + (x1 - x0) * t; return kit.hitG([x, yW(x) + 0.02 * t, kit.Z(0)], [0, -0.48, 1]); }), 0.018, 0.012)), M.trim, 'wiper');
    }
    void g;
  }
  // ---- rear: trunk seams, separate wraparound tail lamps, plate recess, garnish, bumper crease, reflectors
  const ry = (t) => t;
  void ry;
  const tl = { s0: 0.33, s1: 1.02, lo: (t) => 0.832 - 0.035 * Math.pow(t, 1.3), hi: (t) => 0.905 - 0.004 * t };
  both(cache('tl_bezel', () => hitPatch(THREE, kit.wrapGrid('R', tl.s0, tl.s1, tl.lo, tl.hi, { expand: 0.01, round: 0.1 }), 0.0025)), M.trimGloss, 'taillamp_bezel');
  const tlLens = cache('tl_lens', () => hitPatch(THREE, kit.wrapGrid('R', tl.s0, tl.s1, tl.lo, tl.hi, { round: 0.12 }), 0.0045));
  add(tlLens, M.lightTail, 'taillight_R').userData.lampKind = 'tail';
  add(mirrorX(THREE, tlLens), M.lightTail, 'taillight_L').userData.lampKind = 'tail';
  both(cache('tl_bar', () => ribbon(kit.line(30, t => kit.around('R', tl.s0 + 0.04 + (tl.s1 - tl.s0 - 0.08) * t, (tl.lo(t) + tl.hi(t)) / 2 + 0.008)), 0.012, 0.006)), M.brake, 'taillamp_bar');
  both(cache('tl_rev', () => hitPatch(THREE, kit.wrapGrid('R', tl.s0 + 0.05, tl.s0 + 0.17, () => 0.84, () => 0.868, { cols: 8, rows: 3, round: 0.3 }), 0.0058)), M.lightRev, 'reverse_lamp');
  // trunk lid shut lines (rear face + deck sides)
  add(cache('trunk_rear', () => ribbon(kit.line(40, t => kit.around('R', 0.0001 + 0.31 * t, 0.818)))), seam, 'seam_trunk');
  add(cache('trunk_rear_L', () => mirrorX(THREE, ribbon(kit.line(40, t => kit.around('R', 0.0001 + 0.31 * t, 0.818))))), seam, 'seam_trunk');
  both(cache('trunk_side', () => ribbon(kit.line(30, t => kit.top(0.6 + 0.02 * t, 4.18 + (4.8 - 4.18) * t)))), seam, 'seam_trunk');
  add(cache('trunk_front', () => ribbon(kit.line(30, t => kit.top(-0.6 + 1.2 * t, 4.19)))), seam, 'seam_trunk');
  // plate recess: dark shadow surround + inner panel + plate + chrome garnish over it
  add(cache('plate_recess', () => hitPatch(THREE, kit.grid(4, 10, (i, j) => kit.rear(-0.2 + 0.4 * j, 0.6 + 0.205 * i)), 0.0015)), M.trim, 'plate_recess');
  add(cache('plate_recess_in', () => hitPatch(THREE, kit.grid(4, 10, (i, j) => kit.rear(-0.188 + 0.376 * j, 0.612 + 0.181 * i)), 0.0022)), M.plastic, 'plate_recess_inner');
  add(cache('plateR', () => hitPatch(THREE, kit.grid(3, 8, (i, j) => kit.rear(-0.152 + 0.304 * j, 0.626 + 0.152 * i)), 0.0035)), M.plate, 'plate_rear');
  add(cache('garnish', () => ribbon(kit.line(30, t => kit.rear(-0.34 + 0.68 * t, 0.83)), 0.016, 0.004)), M.chrome, 'trunk_garnish');
  // bumper crease highlight seam (bumper cover to body)
  add(cache('bumper_seam', () => ribbon(kit.line(60, t => kit.around('R', 0.0001 + 1.0 * t, 0.62)), 0.006)), seam, 'seam_bumper');
  add(cache('bumper_seam_L', () => mirrorX(THREE, ribbon(kit.line(60, t => kit.around('R', 0.0001 + 1.0 * t, 0.62)), 0.006))), seam, 'seam_bumper');
  both(cache('reflector', () => hitPatch(THREE, kit.wrapGrid('R', 0.72, 0.86, () => 0.47, () => 0.495, { cols: 8, rows: 2, round: 0.3 }), 0.003)), M.lightTail, 'reflector');
  both(cache('exhaust', () => hitPatch(THREE, kit.grid(3, 10, (i, j) => kit.rear(0.42 + 0.14 * j, 0.255 + 0.05 * i)), 0.004)), M.chrome, 'exhaust_trim');
}

// ------------------------------------------------------------------ public factories
const TEMPLATES = new WeakMap();
function template(THREE, type) {
  let t = TEMPLATES.get(THREE); if (!t) TEMPLATES.set(THREE, t = {});
  return t[type] || (t[type] = SPECS[type] ? buildCarV3(THREE, type) : buildCarTemplate(THREE, type));
}

export function createCar(THREE, type, opts = {}) {
  const cfg = CARS[type];
  const color = opts.color ?? defaultColor(type, opts.id);
  const M = getMaterials(THREE), paint = M.paint(color);
  const root = template(THREE, type).clone(true);
  root.traverse(o => {
    if (!o.isMesh) return;
    if (o.userData.paintSlot === 'array' && Array.isArray(o.material)) o.material[0] = paint;
    else if (o.userData.paintSlot === 0) o.material = paint;
  });
  const wheels = [];
  const V3 = SPECS[type];
  const L = cfg.L, hwB = V3 ? prepSpec(V3).hmax - 0.005 : cfg.bodyW / 2;
  const wcfg = V3 || cfg;
  for (const a of wcfg.axles) for (const s of [-1, 1]) {
    const w = makeWheel(THREE, { radius: wcfg.wheel.r, width: wcfg.wheel.w, rim: wcfg.wheel.rim, side: s > 0 ? 'right' : 'left' });
    w.position.set(s * (hwB - wcfg.wheel.w / 2 - 0.025), wcfg.wheel.r, a - L / 2);
    w.name = `wheel_${a < L / 2 ? 'F' : 'R'}${s > 0 ? 'R' : 'L'}`;
    root.add(w); wheels.push(w);
  }
  const dims = VEHICLE_DIMS[type];
  const lightOpts = { headY: V3 ? V3.headY : cfg.head.y, frontZ: -L / 2 - 0.05 };
  attachLightAPI(THREE, root, lightOpts);
  root.userData._relight = () => { delete root.userData.setLights; attachLightAPI(THREE, root, lightOpts); };
  finalizeVehicle(THREE, root, { type, id: opts.id || type, dims, wheels,
    driverEye: [wcfg.eye.x, wcfg.eye.y, wcfg.eye.u - L / 2] });
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
    if (CARS[t]) return createCar(THREE, t, opts);
    if (['truck_tractor', 'semitrailer', 'box_truck', 'bus'].includes(t) && heavy && heavy.createHeavyVehicle) return heavy.createHeavyVehicle(THREE, t, opts);
    if (['motorcycle', 'bicycle'].includes(t) && small && small.createSmallVehicle) return small.createSmallVehicle(THREE, t, opts);
    if (t === 'pedestrian' && small && small.createPedestrian) return small.createPedestrian(THREE, opts);
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[vehicles] factory failed for', type, e && e.message);
  }
  return createBoxVehicle(THREE, t, opts);
}

export const CAR_TYPES = Object.keys(CARS);
export default createVehicle;
