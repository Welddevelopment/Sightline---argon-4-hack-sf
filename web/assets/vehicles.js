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

// ------------------------------------------------------------------ public factories
const TEMPLATES = new WeakMap();
function template(THREE, type) {
  let t = TEMPLATES.get(THREE); if (!t) TEMPLATES.set(THREE, t = {});
  return t[type] || (t[type] = buildCarTemplate(THREE, type));
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
  const L = cfg.L, hwB = cfg.bodyW / 2;
  for (const a of cfg.axles) for (const s of [-1, 1]) {
    const w = makeWheel(THREE, { radius: cfg.wheel.r, width: cfg.wheel.w, rim: cfg.wheel.rim, side: s > 0 ? 'right' : 'left' });
    w.position.set(s * (hwB - cfg.wheel.w / 2 - 0.025), cfg.wheel.r, a - L / 2);
    w.name = `wheel_${a < L / 2 ? 'F' : 'R'}${s > 0 ? 'R' : 'L'}`;
    root.add(w); wheels.push(w);
  }
  const dims = VEHICLE_DIMS[type];
  const lightOpts = { headY: cfg.head.y, frontZ: -L / 2 - 0.05 };
  attachLightAPI(THREE, root, lightOpts);
  root.userData._relight = () => { delete root.userData.setLights; attachLightAPI(THREE, root, lightOpts); };
  finalizeVehicle(THREE, root, { type, id: opts.id || type, dims, wheels,
    driverEye: [cfg.eye.x, cfg.eye.y, cfg.eye.u - L / 2] });
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
