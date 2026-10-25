// web/regions_argon/site_ctx.js — shared site frame for the Argon-authored region modules (step D, region_forge).
// One source of truth for the layout numbers every region builds against, plus the `ctx` object passed to
// `region(THREE, assets, ctx)`. Browser + Node. No DOM required (canvas helpers return null headless).
//
// Frame (SPEC WORLD CONTRACT v2): meters, Y up, +X east, -Z north, origin = initial point of impact
// (centre of the EB outside lane on the NE 140th Ct centreline). US-27A runs along X.
import { surfaceMaterial } from '../assets/textures.js';

const FT = 0.3048;

/** Layout constants (citations in LAYOUT.cite). Every region reads these; do not duplicate numbers elsewhere. */
export const LAYOUT = {
  extent: { xMin: -1000, xMax: 800, zMin: -500, zMax: 500 },
  laneWidth: 12 * FT,                                       // 3.66 m
  eb: { lanes: [-5.49, 1.83], laneLine: -1.83, outsideCenter: 0, insideCenter: -3.66,
        rightShoulder: [1.83, 3.35], leftShoulder: [-6.10, -5.49] },
  wb: { lanes: [-36.58, -29.26], laneLine: -32.92, insideCenter: -31.09, outsideCenter: -34.75,
        rightShoulder: [-38.10, -36.58], leftShoulder: [-29.26, -28.65] },
  median: { grass: [-28.65, -6.10], center: -15.24, swaleDepth: 0.55 },
  crossover: { x: [-19.81, 19.81], z: [-29.26, -5.49] },
  wbLeftTurn: { z: [-29.26, -25.60], center: -27.43, x: [19.81, 187.45], taperTo: 220, leftShoulder: [-25.60, -24.99] },
  ebLeftTurn: { z: [-9.15, -5.49], center: -7.32, x: [-187.45, -19.81], taperTo: -220, leftShoulder: [-9.76, -9.15] },
  ebRightTurn: { z: [1.83, 5.49], center: 3.66, x: [-170.0, -9.0], taperTo: -200 },
  sideRoad: { name: 'NE 140th Ct', x: [-3.05, 3.05], z: [3.35, 230], flare: { atZ: 3.35, x: [-16, 16], untilZ: 16 },
              stopBarZ: 5.5, stopBarWidth: 0.40, stopSign: [4.2, 6.0], stopSignFaces: 'south (+Z, toward northbound drivers)' },
  store: { center: [18, 19], w: 18, d: 12, h: 4.5, faces: 'north', apron: { x: [4, 33], z: [3.35, 13] } },
  shelter: { center: [8, 7.9], w: 3.5, d: 1.5, open: true },
  witnesses: { A: [357.2, -34.75], B: [7.5, 6.5], C: [-18, -40.5] },
  southDitch: { z: 9.0, depth: 0.6, halfWidth: 3.0, gaps: [[-8, 34], [276, 284]] },
  northDitch: { z: -44.0, depth: 0.5, halfWidth: 3.0, gaps: [] },
  // South side: exactly TWO wire fences lie across Vehicle A's post-impact path (NTSB p.1); positions from scene_spec.json.
  fenceSouth1: { z: 14.5, x: [85, 225], note: 'property wire fence #1, runs E-W' },
  fenceSouth2: { x: 225, z: [13, 31], note: 'cross-property wire fence #2, runs N-S' },
  rowFence: { south: { z: 14.5, x: [[-1000, -8], [310, 800]] }, north: { z: -50.0, x: [[-1000, 800]] } },
  culvert: { center: [120, 9.0], pipeDiameter: 0.9, headwallsZ: [7.0, 11.0], note: 'where the car path crosses the south ditch' },
  poleLine: { z: 18.5, spacing: 75, anchorX: 239.3, height: 10.5, skip: 'any pole inside the side road (|x|<6) or the store footprint/apron' },
  brokenPole: [239.3, 18.5],
  residence: { center: [262, 40], w: 20, d: 14, faces: 'north', driveway: { x: [278, 282], z: [3.35, 44] } },
  carRest: [276.6, 23.9],
  carPostImpactPath: [[0, 0], [40, 2.9], [63, 4.7], [123, 9.4], [191, 14.7], [235, 18.2], [255.8, 21.0], [276.6, 23.9]],
  truckPath: [[25.2, -27.43], [14.8, -27.4], [5.2, -24.8], [0.8, -18.2], [0, -12.5], [0, 0], [0, 44.7]],
  crestX: -345, gradeLevelX: 100, grade: 0.0215,
  keepClear: [
    { what: 'EB approach sight corridor (no fixed obstructions; NTSB p.29-30)', x: [-700, 0], z: [-45, 40], allow: 'pavement, markings, flush grass, low signs on breakaway posts <= 2.5 m, delineators' },
    { what: 'Witness B standing point', center: [7.5, 6.5], radius: 1.5 },
    { what: 'Witness C standing point', center: [-18, -40.5], radius: 2.0 },
    { what: 'Witness A (in WB outside lane)', center: [357.2, -34.75], radius: 3.0 },
    { what: 'Vehicle A post-impact path (only fences/culvert/the broken pole may cross it)', polyline: 'carPostImpactPath', halfWidth: 2.0 },
    { what: 'Vehicle T turn path', polyline: 'truckPath', halfWidth: 4.0 },
  ],
  cite: {
    lanes: 'NTSB/HAR-17/02 p.3, p.22 (2 x 12-ft lanes each way; L shoulder ~2 ft, R shoulder ~5 ft)',
    median: 'NTSB/HAR-17/02 p.3, p.22 (grass median ~60 ft)',
    turnLanes: 'NTSB/HAR-17/02 p.3, p.29 (turn lanes ~550 ft; crossover ~130 ft; turn lane+median+shoulders 78 ft)',
    profile: 'NTSB/HAR-17/02 p.22-23 (crest 1,132 ft W of intersection; EB descends 2.15% for 1,459 ft; levels 327 ft E)',
    sideRoad: 'NTSB/HAR-17/02 p.1, p.3, p.23 (NE 140th Ct local paved road, runs south, 109 deg skew straightened); width inferred',
    stopSign: 'Police report p.1 (stop sign on the NE 140th Ct approach only); placement inferred (MUTCD)',
    store: "NTSB/HAR-17/02 p.1 ('retail business on an intersection corner'); SE corner, footprint inferred",
    shelter: 'case/facts.md modeling assumption (fictional bench shelter; open-sided, does not block a 1.6 m eye line)',
    postImpact: 'NTSB/HAR-17/02 p.1 (culvert, two wire fences, utility pole broken, rest in residential front yard ~910 ft E)',
    speed: 'NTSB/HAR-17/02 p.1, p.23 (posted 65 mph)',
    noObstruction: 'NTSB/HAR-17/02 p.29-30 (crest was the only sight restriction; no vegetation or other obstructions)',
  },
};

// ---------- vertical profile along US-27A (x), parabolic vertical curves at grade breaks ----------
// Linear points [x, y]: crest at x=-345 (+7.4175 m), 2.15% descent to x=+100 (-2.15 m), level beyond; west of the
// crest the road falls 2% for 300 m then levels. y(0) = 0 exactly (crash site datum).
const PROFILE = [[-1100, 1.4175], [-645, 1.4175], [-345, 7.4175], [100, -2.15], [900, -2.15]];
const CURVES = [0, 120, 200, 120, 0];
function profileLinear(x) {
  const p = PROFILE;
  if (x <= p[0][0]) return p[0][1];
  for (let i = 0; i < p.length - 1; i++) if (x <= p[i + 1][0]) { const t = (x - p[i][0]) / (p[i + 1][0] - p[i][0]); return p[i][1] + (p[i + 1][1] - p[i][1]) * t; }
  return p[p.length - 1][1];
}
export function profileY(x) {
  let y = profileLinear(x);
  for (let i = 1; i < PROFILE.length - 1; i++) {
    const L = CURVES[i]; if (!L) continue;
    const g1 = (PROFILE[i][1] - PROFILE[i - 1][1]) / (PROFILE[i][0] - PROFILE[i - 1][0]);
    const g2 = (PROFILE[i + 1][1] - PROFILE[i][1]) / (PROFILE[i + 1][0] - PROFILE[i][0]);
    const d = x - PROFILE[i][0];
    if (Math.abs(d) < L / 2) y += (g2 - g1) / (2 * L) * (d + L / 2) ** 2 - (d > 0 ? (g2 - g1) * d : 0);
  }
  return y;
}

const smooth = (e0, e1, v) => { const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
function hash2(i, j) { let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ 0x5bd1e995; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
/** Offset of the natural ground from the road profile at (x,z): ditches, median swale, undulation far from pavement. */
function relief(x, z, L) {
  // paved / shoulder bands are exactly 0
  const onEB = z >= L.eb.leftShoulder[0] && z <= L.eb.rightShoulder[1];
  const onWB = z >= L.wb.rightShoulder[0] && z <= L.wb.leftShoulder[1];
  if (onEB || onWB) return 0;
  const inSide = x >= L.sideRoad.x[0] - 1.5 && x <= L.sideRoad.x[1] + 1.5 && z > 0 && z < L.sideRoad.z[1];
  let r = 0;
  // median swale (filled at the crossover and its noses)
  if (z > L.median.grass[0] && z < L.median.grass[1]) {
    const w = (L.median.grass[1] - L.median.grass[0]) / 2, c = (L.median.grass[0] + L.median.grass[1]) / 2;
    const fill = 1 - smooth(L.crossover.x[1] + 2, L.crossover.x[1] + 18, Math.abs(x));
    r -= L.median.swaleDepth * (1 - ((z - c) / w) ** 2) * (1 - fill);
  }
  for (const D of [L.southDitch, L.northDitch]) {
    const d = Math.abs(z - D.z);
    if (d < D.halfWidth * 2) {
      let open = 1;
      for (const [a, b] of D.gaps) open = Math.min(open, 1 - (smooth(a - 6, a, x) * (1 - smooth(b, b + 6, x))));
      r -= D.depth * Math.max(0, 1 - (d / (D.halfWidth * 2)) ** 2) * open;
    }
  }
  // gentle pasture undulation away from the roadway corridor (0 within 25 m of pavement)
  const far = Math.min(smooth(3.35 + 22, 3.35 + 60, z), 1) + Math.min(smooth(38.1 + 22, 38.1 + 60, -z), 1);
  if (far > 0 && !inSide) r += far * ((vnoise(x / 90 + 300, z / 90 + 300) - 0.5) * 0.9 + (vnoise(x / 23 + 50, z / 23 + 50) - 0.5) * 0.25);
  if (inSide) r *= smooth(L.sideRoad.x[1] + 1.5, L.sideRoad.x[1] + 6, Math.abs(x)) ;
  return r;
}

/** makeCtx({flat}) → the ctx object passed to every region module. */
export function makeCtx({ flat = false, headless } = {}) {
  const isHeadless = headless ?? !(typeof document !== 'undefined' && typeof document.createElement === 'function');
  const L = LAYOUT;
  const prof = flat ? () => 0 : profileY;
  const groundY = (x, z) => prof(x) + (flat ? 0 : relief(x, z, L));
  const roadY = (x /* , z */) => prof(x);
  const ctx = {
    layout: L,
    flat: !!flat,
    headless: isHeadless,
    /** ground / grass elevation at (x,z) incl. ditches & median swale. */
    groundY,
    /** pavement surface elevation (profile only) at x; pavement tops sit at roadY(x) + 0.0 (lay decals +0.01..0.03). */
    roadY,
    profileY: prof,
    /** HTMLCanvasElement (browser) or null (Node). Always handle null. */
    makeCanvas(w, h) {
      if (isHeadless) return null;
      const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
    },
    /** Library PBR surface material (UVs in METERS): 'asphalt'|'concrete'|'grass'|'pasture'|'dirt'|'gravel'. Never null. */
    surface(kind, opts = {}) {
      try { return surfaceMaterial(kind, opts); } catch (e) { return null; }
    },
    /** Deterministic PRNG in [0,1). Use instead of Math.random. */
    rand(seed = 1) {
      let s = (seed >>> 0) || 1;
      return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    },
    /** True if (x,z) violates a keepClear zone for a solid object taller than 0.6 m. */
    blocked(x, z) {
      if (x >= -700 && x <= 0 && z >= -45 && z <= 40) return true;
      for (const k of L.keepClear) if (k.center && Math.hypot(x - k.center[0], z - k.center[1]) < k.radius) return true;
      for (const [key, hw] of [['carPostImpactPath', 2.0], ['truckPath', 4.0]]) {
        const P = L[key];
        for (let i = 0; i < P.length - 1; i++) {
          const [ax, az] = P[i], [bx, bz] = P[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
          if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < hw) return true;
        }
      }
      return false;
    },
  };
  return ctx;
}

export default makeCtx;
