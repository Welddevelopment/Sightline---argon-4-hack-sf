// Validate a generated world against the published investigation's measured findings.
// Usage: node argon/validate_world.mjs <caseId> [worldPath] [--out <file>] [--quiet]
//   default world: highest cases/<caseId>/worlds/world_vN.js
//   default out:   cases/<caseId>/cache/validation.json
// Facts: cases/<caseId>/validation_facts.json  ([{ id, label, value, unit, tolerance, citation, how }])
// Generic: no case-specific ids/coordinates here. Objects are resolved by role from ids/labels.
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'NTSB HAR-17/02';
const MPS_TO_MPH = 2.2369363;
const G = 9.80665;

// ---------- world loading ----------
export function latestWorld(caseId) {
  const dir = path.join(ROOT, 'cases', caseId, 'worlds');
  if (!fs.existsSync(dir)) return null;
  const vs = fs.readdirSync(dir).map((f) => /^world_v(\d+)\.js$/.exec(f)).filter(Boolean).sort((a, b) => b[1] - a[1]);
  return vs.length ? path.join(dir, vs[0][0]) : null;
}

async function loadAssets() {
  const f = path.join(ROOT, 'web', 'assets.js');
  if (!fs.existsSync(f)) return undefined;
  try {
    const m = await import(pathToFileURL(f).href);
    const fac = m.createAssets || m.makeAssets || (typeof m.default === 'function' ? m.default : null);
    if (fac) return fac(THREE);
    return m.assets || m.default || m;
  } catch { return undefined; }
}

async function loadWorld(file) {
  const abs = path.resolve(file);
  const mod = await import(pathToFileURL(abs).href + `?v=${fs.statSync(abs).mtimeMs}`);
  if (typeof mod.default !== 'function') throw new Error(`${file}: no default export createWorld`);
  return mod.default(THREE, await loadAssets());
}

// ---------- role resolution ----------
function resolveRoles(world) {
  const objs = Object.entries(world.objects || {}).map(([id, o]) => ({ id, o, label: `${id} ${o.label || ''}`.toLowerCase(), kind: (o.kind || '').toLowerCase() }));
  const isVeh = (e) => e.kind === 'vehicle' || e.id.startsWith('veh_');
  const notWit = (e) => !/witness|wit_/.test(e.label);
  const pick = (list, prefer) => (list.find(prefer) || list[0] || null)?.id || null;
  const vehs = objs.filter((e) => isVeh(e) && notWit(e));
  const car = world.objects.veh_A ? 'veh_A' : pick(vehs.filter((e) => /sedan|car\b|passenger|vehicle a/.test(e.label)), () => true);
  const trailer = pick(vehs.filter((e) => /trailer/.test(e.label) && e.id !== car), () => true);
  const tractor = pick(vehs.filter((e) => /tractor|truck|semi|lorry/.test(e.label) && !/trailer/.test(e.label.replace(/semitrailer|semi-trailer/g, 'trailer')) && e.id !== car), (e) => /tractor/.test(e.label));
  const truckFront = tractor || trailer;
  const pole = pick(objs.filter((e) => /utility pole|\bpole\b/.test(e.label) && !isVeh(e)), (e) => /utility/.test(e.label));
  const crest = pick(objs.filter((e) => /crest|hill|vertical curve/.test(e.label) && !isVeh(e)), (e) => /crest/.test(e.label));
  return { car, truck_front: truckFront, tractor, trailer, pole, crest };
}

// ---------- geometry helpers ----------
const V = () => new THREE.Vector3();
function nodeOf(world, id) { return id && world.objects[id] ? world.objects[id].node : null; }
function center(node) { node.updateWorldMatrix(true, false); return node.getWorldPosition(V()); }

// local-frame AABB of all meshes under node (geometry is static, so compute once)
const localBoxCache = new WeakMap();
function localBox(node) {
  if (localBoxCache.has(node)) return localBoxCache.get(node);
  node.updateWorldMatrix(true, true);
  const inv = node.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  node.traverse((m) => {
    if (!m.isMesh || !m.geometry) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    box.union(bb);
  });
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.1, 0, -0.1), new THREE.Vector3(0.1, 0.1, 0.1));
  localBoxCache.set(node, box);
  return box;
}
function toWorld(node, lp) { node.updateWorldMatrix(true, false); return lp.clone().applyMatrix4(node.matrixWorld); }
// world-space footprint polygon (4 corners in xz) of the node's oriented box
function footprint(node) {
  const b = localBox(node);
  return [[b.min.x, b.min.z], [b.max.x, b.min.z], [b.max.x, b.max.z], [b.min.x, b.max.z]].map(([x, z]) => { const p = toWorld(node, new THREE.Vector3(x, 0, z)); return [p.x, p.z]; });
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1]; const L = dx * dx + dz * dz;
  let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}
function overlaps(A, B) {
  for (const P of [A, B]) for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length]; const nx = -(b[1] - a[1]), nz = b[0] - a[0];
    const pa = A.map((p) => p[0] * nx + p[1] * nz), pb = B.map((p) => p[0] * nx + p[1] * nz);
    if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
  }
  return true;
}
function polyGap(A, B) {
  if (overlaps(A, B)) return 0;
  let d = Infinity;
  for (const P of [[A, B], [B, A]]) for (const p of P[0]) for (let i = 0; i < 4; i++) d = Math.min(d, segDist(p, P[1][i], P[1][(i + 1) % 4]));
  return d;
}

// ---------- kinematics ----------
function posAt(world, node, t) { world.setTime(t); return center(node); }
function velAt(world, node, t, dt = 0.05) {
  const t0 = Math.max(0, t - dt), t1 = Math.min(world.duration, t + dt);
  const a = posAt(world, node, t0), b = posAt(world, node, t1);
  return new THREE.Vector3(b.x - a.x, 0, b.z - a.z).divideScalar(Math.max(1e-6, t1 - t0));
}
// which local horizontal axis points forward (from a moving sample), e.g. {axis:'z', sign:-1}
function localForward(world, node, times) {
  let best = null;
  for (const t of times) {
    const v = velAt(world, node, t); if (v.length() < 0.5) continue;
    world.setTime(t); node.updateWorldMatrix(true, false);
    const q = node.getWorldQuaternion(new THREE.Quaternion()).invert();
    const lv = v.clone().normalize().applyQuaternion(q);
    best = Math.abs(lv.x) >= Math.abs(lv.z) ? { axis: 'x', sign: Math.sign(lv.x) } : { axis: 'z', sign: Math.sign(lv.z) };
    break;
  }
  return best || { axis: 'z', sign: -1 }; // contract default: rotation 0 faces -Z
}
function forwardDir(node, lf) {
  const q = node.getWorldQuaternion(new THREE.Quaternion());
  const v = new THREE.Vector3(lf.axis === 'x' ? lf.sign : 0, 0, lf.axis === 'z' ? lf.sign : 0).applyQuaternion(q);
  v.y = 0; return v.normalize();
}
function facePoint(node, lf, front = true) {
  const b = localBox(node); const c = b.getCenter(V()); c.y = 0;
  const s = front ? lf.sign : -lf.sign;
  c[lf.axis] = s > 0 ? b.max[lf.axis] : b.min[lf.axis];
  return toWorld(node, c);
}

function findImpact(world, carNode, truckNodes) {
  const step = 0.01; let minGap = Infinity, minT = null;
  for (let t = 0; t <= world.duration + 1e-9; t += step) {
    world.setTime(t);
    const fa = footprint(carNode);
    const g = Math.min(...truckNodes.map((n) => polyGap(fa, footprint(n))));
    if (g <= 0.05) return { t: +t.toFixed(2), gap: g, contact: true };
    if (g < minGap) { minGap = g; minT = t; }
  }
  return { t: minT == null ? null : +minT.toFixed(2), gap: minGap, contact: false };
}

// ---------- fact evaluators ----------
function r(x, d = 2) { return x == null || !Number.isFinite(x) ? x : +x.toFixed(d); }
function parseClock(s) {
  const m = /(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?/.exec(String(s || '')); if (!m) return null;
  return +m[1] * 3600 + +m[2] * 60 + (m[3] ? +m[3] : 0);
}

function makeCtx(world) {
  const roles = resolveRoles(world);
  const carNode = nodeOf(world, roles.car);
  const truckIds = [roles.tractor, roles.trailer].filter(Boolean);
  const truckNodes = [...new Set(truckIds)].map((id) => nodeOf(world, id));
  const ctx = { world, roles, carNode, notes: [] };
  if (!carNode) { ctx.error = 'no car object found'; return ctx; }
  if (!truckNodes.length) { ctx.error = 'no truck object found'; return ctx; }
  const imp = findImpact(world, carNode, truckNodes);
  ctx.impact = imp;
  if (!imp.contact) ctx.notes.push(`car never touches the truck; closest approach ${r(imp.gap)} m at t=${imp.t}s used as impact`);
  const ti = imp.t;
  const preTimes = [ti - 1, ti - 2, ti - 0.5, ti - 3].filter((t) => t >= 0);
  ctx.carLF = localForward(world, carNode, preTimes.length ? preTimes : [0.5]);
  world.setTime(Math.max(0, ti - 0.5));
  ctx.travelDir = velAt(world, carNode, Math.max(0, ti - 0.5)).normalize();
  world.setTime(ti);
  ctx.impactPoint = facePoint(carNode, ctx.carLF, true);
  const tf = nodeOf(world, roles.truck_front);
  if (tf) {
    const ts = [ti, ti - 0.5, ti + 0.5, ti - 1.5, 1, 0.1].filter((t) => t >= 0 && t <= world.duration);
    ctx.truckLF = localForward(world, tf, ts);
  }
  return ctx;
}

function timeOf(ctx, spec) {
  if (spec === 'impact') return ctx.impact.t;
  if (spec === 'end') return ctx.world.duration;
  return Number(spec);
}

function evaluate(fact, ctx) {
  const h = fact.how || {}; const w = ctx.world; const ti = ctx.impact?.t;
  const used = {}; const use = (role) => { const id = ctx.roles[role] || null; used[role] = id; return id ? nodeOf(w, id) : null; };
  const out = (actual, note) => ({ actual, used, note });
  switch (h.type) {
    case 'speed': {
      const n = use(h.role); const t0 = Math.max(0, ti + h.window[0]), t1 = Math.max(0, ti + h.window[1]);
      const a = posAt(w, n, t0), b = posAt(w, n, t1);
      return out(r(Math.hypot(b.x - a.x, b.z - a.z) / Math.max(1e-6, t1 - t0) * MPS_TO_MPH, 1), `mean over t=${r(t0)}..${r(t1)} s`);
    }
    case 'max_decel': {
      const n = use(h.role); const t0 = Math.max(0, ti + h.window[0]), t1 = Math.max(0, ti + h.window[1]); const s = h.smoothS || 0.5;
      const sp = (t) => velAt(w, n, t, s / 2).length();
      let worst = 0; for (let t = t0 + s / 2; t + s <= t1 - s / 2 + 1e-9; t += 0.1) worst = Math.max(worst, (sp(t) - sp(t + s)) / s / G);
      return out(r(worst, 3), `over t=${r(t0)}..${r(t1)} s, ${s} s smoothing`);
    }
    case 'time_to_cover': {
      const n = use(h.role); const P = ctx.impactPoint; let tPrev = ti, dPrev = 0;
      for (let t = ti - 0.02; t >= -1e-9; t -= 0.02) {
        w.setTime(Math.max(0, t)); const f = facePoint(n, ctx.carLF, true); const d = Math.hypot(f.x - P.x, f.z - P.z);
        if (d >= h.distanceM) { const tc = t + (tPrev - t) * (d - h.distanceM) / Math.max(1e-6, d - dPrev); return out(r(ti - tc, 2)); }
        tPrev = t; dPrev = d;
      }
      return out(null, `car path starts only ${r(dPrev, 1)} m (${r(ti, 2)} s) before impact; cannot cover ${h.distanceM} m`);
    }
    case 'occluder_distance': {
      const n = use(h.role); if (!n) return out(null, `no ${h.role} object in world`);
      const u = ctx.travelDir; const P = ctx.impactPoint; const b = localBox(n); let near = -Infinity;
      for (const x of [b.min.x, b.max.x]) for (const z of [b.min.z, b.max.z]) { const p = toWorld(n, new THREE.Vector3(x, 0, z)); near = Math.max(near, (p.x - P.x) * u.x + (p.z - P.z) * u.z); }
      return out(r(-near, 1), 'impact point to the occluder edge nearest the intersection, along the car\'s travel direction');
    }
    case 'position': {
      use(h.role); const P = ctx.impactPoint;
      return out([r(P.x), r(P.z)], `car front at t=${ti}s`);
    }
    case 'impact_offset': {
      use(h.car); const tf = use(h.truckFront); if (!tf) return out(null, 'no truck object');
      w.setTime(ti); const F = facePoint(tf, ctx.truckLF, true); const u = forwardDir(tf, ctx.truckLF); const P = ctx.impactPoint;
      return out(r((F.x - P.x) * u.x + (F.z - P.z) * u.z), `at t=${ti}s`);
    }
    case 'combination_length': {
      const tf = use(h.front); const tr = use(h.rear); if (!tf || !tr) return out(null, 'need separate tractor and trailer objects');
      if (tf === tr) return out(null, 'truck modeled as one object; cannot separate tractor and trailer');
      const trLF = localForward(w, tr, [ti, ti - 0.5, 1, 0.1].filter((t) => t >= 0));
      let bestT = 0, bestA = Infinity;
      for (let t = 0; t <= w.duration + 1e-9; t += 0.25) { w.setTime(t); const a = forwardDir(tf, ctx.truckLF).angleTo(forwardDir(tr, trLF)); if (a < bestA - 1e-4) { bestA = a; bestT = t; } }
      w.setTime(bestT); const u = forwardDir(tf, ctx.truckLF); const F = facePoint(tf, ctx.truckLF, true); const R = facePoint(tr, trLF, false);
      return out(r((F.x - R.x) * u.x + (F.z - R.z) * u.z), `at t=${bestT}s (tractor/trailer ${r(bestA * 180 / Math.PI, 1)} deg apart)`);
    }
    case 'meta_time': {
      const v = w.meta?.timeOfDay; const s = parseClock(v);
      return { actual: v ?? null, used: { field: h.field }, note: s == null ? 'no parsable meta.timeOfDay' : null, _num: s };
    }
    case 'contact_time': {
      const a = use(h.a); const b = use(h.b); if (!b) return out(null, `no ${h.b} object in world`);
      const fb = footprint(b); let minG = Infinity, minT = null, hit = null;
      for (let t = ti; t <= w.duration + 1e-9; t += 0.02) { w.setTime(t); const g = polyGap(footprint(a), fb); if (g < minG) { minG = g; minT = t; } if (g <= h.contactGapM) { hit = t; break; } }
      if (hit != null) return out(r(hit - ti));
      if (minG <= h.maxGapM) return out(r(minT - ti), `closest approach ${r(minG)} m`);
      return out(null, `car never reaches the ${h.b} (closest ${r(minG, 1)} m at t=${r(minT)}s)`);
    }
    case 'distance': {
      const n = use(h.role); const c = posAt(w, n, timeOf(ctx, h.t)); const P = ctx.impactPoint;
      return out(r(Math.hypot(c.x - P.x, c.z - P.z), 1), 'straight line, impact point to car centre at end');
    }
    case 'lateral_offset': {
      const n = use(h.role); const c = posAt(w, n, timeOf(ctx, h.t)); const P = ctx.impactPoint; const u = ctx.travelDir;
      const right = new THREE.Vector3(-u.z, 0, u.x); // facing +X, right is +Z
      const sign = h.side === 'left' ? -1 : 1;
      return out(r(sign * ((c.x - P.x) * right.x + (c.z - P.z) * right.z), 1));
    }
    case 'heading_vs_travel': {
      const n = use(h.role); w.setTime(timeOf(ctx, h.t)); n.updateWorldMatrix(true, false);
      let a = forwardDir(n, ctx.carLF).angleTo(ctx.travelDir) * 180 / Math.PI; if (h.fold === '0-90' && a > 90) a = 180 - a;
      return out(r(a, 1));
    }
    default: return out(null, `unknown how.type ${h.type}`);
  }
}

function judge(fact, res) {
  const tol = fact.tolerance; const exp = fact.value; const act = res.actual;
  if (act == null) return false;
  if (fact.how?.type === 'meta_time') { const e = parseClock(exp); return res._num != null && Math.abs(res._num - e) <= tol; }
  if (Array.isArray(exp)) { const axes = fact.how.axes || ['x', 'z']; return axes.every((ax, i) => Math.abs(act[i] - exp[i]) <= (typeof tol === 'object' ? tol[ax] : tol)); }
  if (fact.comparator === 'gte') return act >= exp - tol;
  if (fact.comparator === 'lte') return act <= exp + tol;
  return Math.abs(act - exp) <= tol;
}

// ---------- main API ----------
export async function validateWorld(caseId, worldPath, opts = {}) {
  const factsFile = path.join(ROOT, 'cases', caseId, 'validation_facts.json');
  if (!fs.existsSync(factsFile)) return null;
  let facts = JSON.parse(fs.readFileSync(factsFile, 'utf8'));
  if (!Array.isArray(facts)) facts = facts.facts || [];
  const wp = worldPath ? path.resolve(worldPath) : latestWorld(caseId);
  if (!wp || !fs.existsSync(wp)) throw new Error(`no world found for case ${caseId}`);
  const world = await loadWorld(wp);
  const ctx = makeCtx(world);
  const items = facts.map((f) => {
    let res;
    try { res = ctx.error ? { actual: null, used: {}, note: ctx.error } : evaluate(f, ctx); } catch (e) { res = { actual: null, used: {}, note: `error: ${e.message}` }; }
    const pass = !!judge(f, res);
    const item = { id: f.id, label: f.label, expected: f.comparator ? `${f.comparator === 'gte' ? '>=' : '<='} ${f.value}` : f.value, actual: res.actual, unit: f.unit, tolerance: f.tolerance, pass, citation: f.citation, objects: res.used };
    if (Array.isArray(f.value) || typeof f.value === 'number') {
      if (typeof res.actual === 'number' && typeof f.value === 'number') item.delta = r(res.actual - f.value, 3);
      if (Array.isArray(res.actual) && Array.isArray(f.value)) item.delta = res.actual.map((a, i) => r(a - f.value[i], 2));
    }
    if (f.how?.type === 'meta_time' && res._num != null) item.delta = r(res._num - parseClock(f.value), 1);
    if (res.note) item.note = res.note;
    return item;
  });
  const rel = path.relative(ROOT, wp).split(path.sep).join('/');
  const result = {
    source: SOURCE, caseId, world: '/' + rel, matched: items.filter((i) => i.pass).length, total: items.length,
    impact: ctx.impact ? { t: ctx.impact.t, contact: ctx.impact.contact, point: ctx.impactPoint ? [r(ctx.impactPoint.x), r(ctx.impactPoint.z)] : null } : null,
    roles: ctx.roles, notes: ctx.notes, generatedAt: new Date().toISOString(), items,
  };
  if (opts.write !== false) {
    const out = opts.out ? path.resolve(opts.out) : path.join(ROOT, 'cases', caseId, 'cache', 'validation.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
    result._out = out;
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2); const flags = {}; const pos = [];
  for (let i = 0; i < args.length; i++) { if (args[i] === '--out') flags.out = args[++i]; else if (args[i] === '--quiet') flags.quiet = true; else pos.push(args[i]); }
  const [caseId, worldPath] = pos;
  if (!caseId) { console.error('usage: node argon/validate_world.mjs <caseId> [worldPath] [--out file]'); process.exit(2); }
  if (!fs.existsSync(path.join(ROOT, 'cases', caseId, 'validation_facts.json'))) { console.log('no published findings for this case'); process.exit(0); }
  const res = await validateWorld(caseId, worldPath, { out: flags.out });
  if (!flags.quiet) {
    console.log(`${res.world}: ${res.matched}/${res.total} published findings matched (${res.source}); impact t=${res.impact?.t}s`);
    for (const it of res.items) console.log(`${it.pass ? 'PASS' : 'FAIL'} ${it.id}: expected ${JSON.stringify(it.expected)} ±${JSON.stringify(it.tolerance)} ${it.unit}, actual ${JSON.stringify(it.actual)}${it.note ? ' (' + it.note + ')' : ''}`);
    console.log('wrote', path.relative(ROOT, res._out));
  }
}
