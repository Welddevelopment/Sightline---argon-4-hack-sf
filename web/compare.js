// Sightline COMPARE & WHAT-IF (web/compare.html?case=<id>)
// Part 1 (top of file): the what-if re-timing core. Pure; imports only three, so server/whatif.js imports this same
//   file in Node and the browser preview and the independent server-side checks use one implementation.
// Part 2 (boot(), browser only): three synchronized panes (Witness A view | Witness B view | overhead) drawn by ONE
//   WebGL renderer with scissor viewports, a shared timeline, and a "vehicle speed" what-if slider.
// Nothing here is case-specific: witnesses, the re-timed object, the conflict partner and the impact are all read
// from the world module + the case's checks.
import * as THREE from 'three';

export const MPS_TO_MPH = 2.2369362920544;
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const STEP = 0.05;

// ------------------------------------------------------------------ labels
// "Passenger sedan (Vehicle A), eastbound" -> "Vehicle A"; "Refrigerated van semitrailer (Vehicle T)" -> "semitrailer"
export function shortObjLabel(o, id) {
  const label = String((o && o.label) || id || '');
  const base = label.split(/[(,]/)[0].trim();
  const paren = (label.match(/\(([^)]{1,16})\)/) || [])[1];
  return { base: base || id, paren: paren || null, full: label || id };
}
function nounFor(world, id) {
  const s = shortObjLabel(world.objects[id], id);
  return 'the ' + s.base.charAt(0).toLowerCase() + s.base.slice(1);
}
export function speedName(world, id) {
  const s = shortObjLabel(world.objects[id], id);
  return s.paren || s.base || id;
}

// ------------------------------------------------------------------ footprints (oriented rectangles in XZ)
const isVehicle = (id, o) => !!o && !!o.node && (o.kind === 'vehicle' || /^veh_/.test(id));

// Footprint of a node in its own (parent-local) frame: zero its transform, measure, restore.
function localFootprint(world, node) {
  const p = node.position.clone(), q = node.quaternion.clone(), s = node.scale.clone();
  node.position.set(0, 0, 0); node.quaternion.identity();
  node.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(node);
  node.position.copy(p); node.quaternion.copy(q); node.scale.copy(s);
  node.updateMatrixWorld(true);
  if (box.isEmpty()) return { minX: -1, maxX: 1, minZ: -2, maxZ: 2, length: 4, width: 2 };
  // the parent may itself carry a transform; we measured with the parent's matrix, so remove its translation
  const pw = new THREE.Vector3();
  if (node.parent) node.parent.getWorldPosition(pw);
  return { minX: box.min.x - pw.x, maxX: box.max.x - pw.x, minZ: box.min.z - pw.z, maxZ: box.max.z - pw.z,
    length: box.max.z - box.min.z, width: box.max.x - box.min.x };
}
const _c = new THREE.Vector3();
function cornersAt(node, fp) {
  node.updateMatrixWorld(true);
  const m = node.matrixWorld;
  return [[fp.minX, fp.minZ], [fp.maxX, fp.minZ], [fp.maxX, fp.maxZ], [fp.minX, fp.maxZ]]
    .map(([x, z]) => { _c.set(x, 0, z).applyMatrix4(m); return [_c.x, _c.z]; });
}
function axesOf(poly) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
    out.push([-ez / L, ex / L]);
  }
  return out;
}
export function polysOverlap(A, B) {
  for (const ax of [...axesOf(A), ...axesOf(B)]) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of A) { const d = p[0] * ax[0] + p[1] * ax[1]; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const p of B) { const d = p[0] * ax[0] + p[1] * ax[1]; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}
function segPt(p, a, b) {
  const vx = b[0] - a[0], vz = b[1] - a[1], L2 = vx * vx + vz * vz || 1;
  const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / L2));
  return Math.hypot(p[0] - a[0] - u * vx, p[1] - a[1] - u * vz);
}
export function polyGap(A, B) {
  if (polysOverlap(A, B)) return 0;
  let g = Infinity;
  for (const [P, Q] of [[A, B], [B, A]]) for (const p of P) for (let i = 0; i < Q.length; i++) g = Math.min(g, segPt(p, Q[i], Q[(i + 1) % Q.length]));
  return g;
}

// ------------------------------------------------------------------ baseline analysis (original, un-retimed world)
function posAt(world, node, t) { world.setTime(t); return node.position.clone(); }

export function defaultWhatIfObject(world) {
  // the moving vehicle with the highest speed just before the impact (meta.impactT) or anywhere on the timeline
  const dur = world.duration || 10;
  const tImp = typeof world.meta?.impactT === 'number' ? world.meta.impactT : null;
  let best = null, bestV = 0;
  for (const [id, o] of Object.entries(world.objects || {})) {
    if (!isVehicle(id, o)) continue;
    const ts = tImp != null ? [Math.max(0, tImp - 0.35)] : Array.from({ length: 20 }, (_, i) => (i / 20) * dur);
    for (const t of ts) {
      const a = posAt(world, o.node, t), b = posAt(world, o.node, Math.min(dur, t + 0.3));
      const v = Math.hypot(b.x - a.x, b.z - a.z) / 0.3;
      if (v > bestV) { bestV = v; best = id; }
    }
  }
  world.setTime(0);
  return best;
}

export function baselineInfo(world, objectId) {
  const o = world.objects[objectId];
  if (!isVehicle(objectId, o)) throw new Error(`what-if object must be a vehicle in the world: ${objectId}`);
  const node = o.node;
  const dur = world.duration || 10;
  const others = Object.entries(world.objects).filter(([id, x]) => id !== objectId && isVehicle(id, x));
  const fps = { [objectId]: localFootprint(world, node) };
  for (const [id, x] of others) fps[id] = localFootprint(world, x.node);

  // impact time: meta.impactT, else first footprint contact, else closest approach
  let impactT = typeof world.meta?.impactT === 'number' ? world.meta.impactT : null;
  let impactSource = impactT != null ? 'meta.impactT' : null;
  if (impactT == null) {
    let best = { g: Infinity, t: 0 };
    for (let t = 0; t <= dur + 1e-9; t += STEP) {
      world.setTime(t);
      const A = cornersAt(node, fps[objectId]);
      for (const [id, x] of others) {
        const g = polyGap(A, cornersAt(x.node, fps[id]));
        if (g === 0 && impactT == null) { impactT = r2(t); impactSource = `first contact with ${id}`; }
        if (g < best.g) best = { g, t };
      }
      if (impactT != null) break;
    }
    if (impactT == null) { impactT = r2(best.t); impactSource = 'closest approach (no contact found)'; }
  }

  // conflict partner = nearest other vehicle at the impact time
  world.setTime(impactT);
  const Aimp = cornersAt(node, fps[objectId]);
  let conflictId = null, cg = Infinity;
  for (const [id, x] of others) { const g = polyGap(Aimp, cornersAt(x.node, fps[id])); if (g < cg) { cg = g; conflictId = id; } }

  // approach speed + direction just before impact (parent-local frame)
  const tA = Math.max(0, impactT - 0.35), tB = Math.max(0, impactT - 0.05);
  const pA = posAt(world, node, tA), pB = posAt(world, node, tB);
  const origMps = tB > tA ? Math.hypot(pB.x - pA.x, pB.z - pA.z) / (tB - tA) : 0;
  const dir = new THREE.Vector3(pB.x - pA.x, 0, pB.z - pA.z);
  if (dir.lengthSq() < 1e-9) dir.set(1, 0, 0);
  dir.normalize();
  world.setTime(Math.max(0, impactT - 0.05));
  const quatImp = node.quaternion.clone();
  const posImp = posAt(world, node, impactT);

  // corridor = the re-timed vehicle's travel band through the impact location (its width, +/-10 m along its path)
  const fp = fps[objectId];
  const halfW = Math.min(fp.width, fp.length) / 2, halfL = 10;
  const n = new THREE.Vector3(-dir.z, 0, dir.x);
  const cx = posImp.x, cz = posImp.z;
  const corridor = [[-halfL, -halfW], [halfL, -halfW], [halfL, halfW], [-halfL, halfW]]
    .map(([l, w]) => [cx + dir.x * l + n.x * w, cz + dir.z * l + n.z * w]);

  // occupancy interval of the conflict partner in that band, around the impact time
  let enterT = null, clearT = null;
  if (conflictId) {
    const cnode = world.objects[conflictId].node;
    const occ = (t) => { world.setTime(t); return polysOverlap(corridor, cornersAt(cnode, fps[conflictId])); };
    if (occ(impactT)) {
      let t = impactT; while (t - STEP >= 0 && occ(t - STEP)) t -= STEP; enterT = r2(t);
      t = impactT; while (t + STEP <= dur && occ(t + STEP)) t += STEP; clearT = t + STEP <= dur ? r2(t + STEP) : null;
    }
  }
  world.setTime(0);
  return { objectId, impactT, impactSource, conflictId, origMps, origMph: origMps * MPS_TO_MPH,
    dir: [dir.x, dir.z], posImp: [posImp.x, posImp.y, posImp.z], quatImp: quatImp.toArray(),
    corridor, enterT, clearT, duration: dur, fps };
}

// ------------------------------------------------------------------ the what-if itself
// Re-time `object` to `targetMph`: its path is unchanged and it keeps its t=0 position, so it reaches the SAME impact
// location at T' = impactT * v0 / v1 (time-scaled by v1/v0). Every other object keeps its original timing. After the
// impact location the object continues straight at the what-if speed (post-impact motion is not modeled); if the
// re-timed footprints touch another vehicle it is held at that first contact.
// Mutates `world` (wraps setTime, extends duration, sets meta.impactT / meta.whatIf) and returns the analysis.
export function retimeWorld(world, { object, targetMph, base } = {}) {
  if (world.__whatIf) throw new Error('world already re-timed; reload it first');
  const objectId = object || defaultWhatIfObject(world);
  const b = base || baselineInfo(world, objectId);
  const v1 = Number(targetMph);
  if (!(v1 > 0)) throw new Error('targetMph must be a positive number');
  if (!(b.origMps > 0.5)) throw new Error(`${objectId} is not moving before the impact; nothing to re-time`);
  const k = (v1 / MPS_TO_MPH) / b.origMps;
  const T1 = b.impactT / k;
  const origSet = world.setTime;
  const origDur = b.duration;
  const newDur = Math.min(Math.max(origDur, T1 + 3), T1 + 3 + origDur);
  const node = world.objects[objectId].node;
  const v1mps = v1 / MPS_TO_MPH;
  const pImp = new THREE.Vector3(...b.posImp), qImp = new THREE.Quaternion().fromArray(b.quatImp);
  const d = new THREE.Vector3(b.dir[0], 0, b.dir[1]);
  const ghost = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
  const st = { freezeT: Infinity };
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion();
  const wrapped = function setTime(t) {
    t = Math.min(Math.max(+t || 0, 0), newDur);
    const tc = Math.min(t, st.freezeT);
    if (tc <= T1) { origSet.call(world, Math.min(tc * k, origDur)); pos.copy(node.position); quat.copy(node.quaternion); }
    else { pos.copy(pImp).addScaledVector(d, v1mps * (tc - T1)); quat.copy(qImp); }
    origSet.call(world, Math.min(t, origDur));
    ghost.position.copy(node.position); ghost.quaternion.copy(node.quaternion);
    node.position.copy(pos); node.quaternion.copy(quat);
    world.root.updateMatrixWorld(true);
  };
  world.setTime = wrapped;
  world.duration = newDur;

  // footprint contact scan on the re-timed timeline
  const fps = b.fps;
  const others = Object.entries(world.objects).filter(([id, x]) => id !== objectId && isVehicle(id, x) && fps[id]);
  let contact = null, minGap = { m: Infinity, t: null, with: null };
  for (let t = 0; t <= newDur + 1e-9; t += STEP) {
    wrapped(t);
    const A = cornersAt(node, fps[objectId]);
    for (const [id, x] of others) {
      const g = polyGap(A, cornersAt(x.node, fps[id]));
      if (Math.abs(t - T1) <= 4 && g < minGap.m) minGap = { m: g, t: r2(t), with: id };
      if (g === 0 && !contact) contact = { t: r2(t), with: id };
    }
    if (contact) break;
  }
  if (contact) st.freezeT = contact.t;

  const delay = T1 - b.impactT;
  const res = {
    object: objectId, targetMph: v1, origMph: r1(b.origMph), k, impactT: b.impactT, impactSource: b.impactSource,
    newImpactT: r2(T1), delayS: r2(delay), conflictId: b.conflictId, enterT: b.enterT, clearT: b.clearT,
    contact, minGap: minGap.with ? { m: r2(minGap.m), t: minGap.t, with: minGap.with } : null,
    duration: newDur, originalDuration: origDur,
    breakEvenMph: b.clearT && b.clearT > 0 ? r1(b.origMph * b.impactT / b.clearT) : null,
    passFirstMph: b.enterT && b.enterT > 0 ? r1(b.origMph * b.impactT / b.enterT) : null,
  };
  res.sentence = whatIfSentence(world, res);
  res.assumptions = [
    `Impact location fixed: ${speedName(world, objectId)} keeps its reconstructed path and its t=0 position; only its speed changes (all of its times scaled by ${r2(1 / k)}), so it reaches the same impact location ${Math.abs(res.delayS)} s ${delay >= 0 ? 'later' : 'earlier'}.`,
    'Every other object keeps its original timing; witness positions and observation times are unchanged.',
    `Past the impact location ${speedName(world, objectId)} continues straight at ${v1} mph; post-impact motion is not modeled${contact ? ', and it is held at the first contact' : ''}.`,
    'Contact = overlap of vehicle footprints (oriented rectangles) sampled every 0.05 s. Kinematic what-if, not a crash-physics simulation.',
  ];
  world.meta = { ...(world.meta || {}), impactT: contact ? contact.t : r2(T1), whatIf: res };
  world.__whatIf = { res, ghost, origSet, objectId };
  wrapped(0);
  return res;
}

export function whatIfSentence(world, r) {
  const car = nounFor(world, r.object);
  const v0 = Math.round(r.origMph);
  const head = `At ${r.targetMph} mph instead of ${v0}, ${car} reaches the impact location ${Math.abs(r.delayS).toFixed(1)} s ${r.delayS >= 0 ? 'later' : 'earlier'} (t=${r.newImpactT.toFixed(1)} s instead of ${r.impactT.toFixed(1)} s).`;
  if (!r.conflictId) return head;
  const other = nounFor(world, r.conflictId);
  let mid = '';
  if (r.clearT != null && r.newImpactT >= r.clearT) mid = ` ${cap(other)} clears its path at t=${r.clearT.toFixed(1)} s, so it would have cleared ${(r.newImpactT - r.clearT).toFixed(1)} s before ${car} arrived.`;
  else if (r.enterT != null && r.newImpactT < r.enterT) mid = ` ${cap(other)} enters its path only at t=${r.enterT.toFixed(1)} s, so ${car} would have passed before it got there.`;
  else if (r.clearT != null) mid = ` ${cap(other)} is still across its path then (it clears at t=${r.clearT.toFixed(1)} s), so it would not have cleared.`;
  else mid = ` ${cap(other)} is still across its path for the rest of the timeline, so it would not have cleared.`;
  let tail;
  if (r.contact) tail = ` The footprints still meet: contact with ${nounFor(world, r.contact.with)} at t=${r.contact.t.toFixed(1)} s.`;
  else tail = ` No footprint contact in the re-timed paths${r.minGap ? ` (closest ${r.minGap.m.toFixed(1)} m to ${nounFor(world, r.minGap.with)} at t=${r.minGap.t.toFixed(1)} s)` : ''}.`;
  return head + mid + tail;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ====================================================================== browser UI
if (typeof document !== 'undefined' && document.getElementById('cmpRoot')) boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('cmpError');
  if (el) { el.hidden = false; el.textContent = 'Compare view failed: ' + (e && e.message ? e.message : e); }
  window.__cmpReject && window.__cmpReject(e);
});

async function boot() {
  const { loadAssets } = await import('./assets.js');
  const rq = await import('./render_quality.js').catch(() => null);
  const params = new URLSearchParams(location.search);
  const caseId = params.get('case') || 'demo';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cmp = window.cmp || {};
  window.cmp = cmp;

  // ---------- case + world ----------
  const caseRes = await fetch(`/api/cases/${encodeURIComponent(caseId)}`);
  if (!caseRes.ok) throw new Error(`case ${caseId}: HTTP ${caseRes.status}`);
  const cs = await caseRes.json();
  const state = cs.state || {};
  if (!state.world) throw new Error('this case has no world yet');
  $('caseTitle').textContent = cs.title || caseId;
  $('caseTitle').title = cs.title || caseId;
  $('backLink').href = `/?case=${encodeURIComponent(caseId)}`;
  $('kinLabel').textContent = cs.kinematicLabel || 'Kinematic reconstruction: motion fitted to cited evidence; not a crash-physics simulation.';
  const baseChecks = Array.isArray(state.checks) ? state.checks : [];

  const assets = await loadAssets(THREE).catch(() => undefined);
  const mod = await import(new URL(state.world, location.href).href + '?_=' + Date.now());
  async function freshWorld() {
    const w = mod.default(THREE, assets);
    w.objects = w.objects || {}; w.witnesses = w.witnesses || []; w.duration = w.duration || 10; w.meta = w.meta || {};
    for (const x of state.witnesses || []) if (!w.witnesses.some((y) => y.id === x.id)) w.witnesses.push(x);
    w.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return w;
  }
  let world = await freshWorld();
  const origDuration = world.duration;

  // ---------- which two witnesses: opposing results on the same target first ----------
  const sl = (wid, list = baseChecks) => list.find((c) => c.check === 'sightline' && c.subject === wid) || null;
  function pickPair() {
    const ws = world.witnesses;
    const qa = params.get('a'), qb = params.get('b');
    if (qa && qb) return [qa, qb];
    let best = null;
    for (const a of ws) for (const b of ws) {
      if (a === b) continue;
      const ca = sl(a.id), cb = sl(b.id);
      let s = 0;
      if (ca && cb && ca.pass && !cb.pass) s += 4;
      if (String(a.lookAt) === String(b.lookAt)) s += 2;
      if (ws.indexOf(a) < ws.indexOf(b)) s += 0.5;
      if (!best || s > best.s) best = { s, ids: [a.id, b.id] };
    }
    return best ? best.ids : ws.slice(0, 2).map((w) => w.id);
  }
  const pair = pickPair().filter((id) => world.witnesses.some((w) => w.id === id));
  const wit = (id) => world.witnesses.find((w) => w.id === id);
  const shortName = (w) => String(w.name || w.id).replace(/\s*\([^)]*\)\s*$/, '').trim() || w.id;

  // ---------- what-if object ----------
  const whatIfId = params.get('object') || defaultWhatIfObject(world);
  let base = null;
  try { base = whatIfId ? baselineInfo(world, whatIfId) : null; } catch (e) { console.warn('what-if unavailable:', e); }
  world.setTime(0);

  // ---------- renderer: one canvas, scissor viewports ----------
  const canvas = $('cmpCanvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  if (rq && rq.applyRenderQuality) rq.applyRenderQuality(renderer, null, { quality: 'interactive' });
  else renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;

  const scene = new THREE.Scene();
  const env = new THREE.Group();
  const overlay = new THREE.Group(); // overhead-only overlays (layer 1)
  scene.add(env, overlay);
  const lighting = String(world.meta.lighting || 'day').toLowerCase();
  const LOOK = {
    dawn: { bg: 0xe3a981, ground: 0x6c6f5c, hemi: [0xffd1a0, 0x3a3f4a, 0.75], sun: [0xffb070, 1.4, [-90, 40, -70]] },
    day: { bg: 0x9ec9ec, ground: 0x7d9a64, hemi: [0xffffff, 0x8a9a7a, 0.95], sun: [0xffffff, 1.7, [70, 130, 50]] },
    night: { bg: 0x02040a, ground: 0x0b0f0d, hemi: [0x1a2440, 0x05060a, 0.16], sun: [0x6678a8, 0.12, [-50, 100, 30]] },
  }[lighting] || null;
  const L = LOOK || { bg: 0x9ec9ec, ground: 0x7d9a64, hemi: [0xffffff, 0x8a9a7a, 0.95], sun: [0xffffff, 1.7, [70, 130, 50]] };
  scene.background = new THREE.Color(L.bg);
  env.add(new THREE.HemisphereLight(L.hemi[0], L.hemi[1], L.hemi[2]));
  const sun = new THREE.DirectionalLight(L.sun[0], L.sun[1]);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
  env.add(sun, sun.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: L.ground, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; ground.receiveShadow = true; env.add(ground);
  if (lighting !== 'day') env.add(new THREE.AmbientLight(0xffffff, lighting === 'night' ? 0.35 : 0.15));

  // focus = impact location (or the mark_impact object, or origin)
  const focus = new THREE.Vector3();
  const markImp = Object.entries(world.objects).find(([id]) => /^mark_impact/.test(id));
  if (base) focus.set(base.posImp[0], 0, base.posImp[2]);
  else if (markImp) new THREE.Box3().setFromObject(markImp[1].node).getCenter(focus).setY(0);
  sun.position.set(focus.x + L.sun[2][0], L.sun[2][1], focus.z + L.sun[2][2]);
  sun.target.position.copy(focus);
  const roi = new THREE.Box3(focus.clone().add(new THREE.Vector3(-60, 0, -60)), focus.clone().add(new THREE.Vector3(60, 8, 60)));
  if (rq && rq.fitShadowCamera) rq.fitShadowCamera(sun, roi); else {
    const sc = sun.shadow.camera; sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 1; sc.far = 600;
  }
  let rqHandle = null;
  function attachWorld(w) {
    if (world && world.root.parent) scene.remove(world.root);
    world = w;
    scene.add(world.root);
    // the world's own sky dome (if any) would cap the overhead camera; keep the flat background instead
    world.root.traverse((o) => { if (/^(env_)?sky/i.test(o.name || '') && o.isMesh) o.visible = false; });
  }
  attachWorld(world);
  if (rq && rq.applyRenderQuality) {
    try { rqHandle = rq.applyRenderQuality(renderer, scene, { quality: 'interactive', lighting, sun, roi, world, overlays: [overlay] }); await rqHandle.ready; }
    catch (e) { console.warn('render quality skipped', e); }
  }
  renderer.shadowMap.autoUpdate = false;
  scene.fog = null; // geometry is the claim; no haze over long sight lines

  // ---------- overhead overlays (layer 1 only) ----------
  const OVER = 1;
  const setLayer = (o) => o.traverse((x) => x.layers.set(OVER));
  const COL = { clear: 0x3ddc84, blocked: 0xff5a5a, wit: 0xe2b052, ghost: 0xffffff };
  const witMarks = new Map();
  for (const id of world.witnesses.map((w) => w.id)) {
    const w = wit(id);
    const g = new THREE.Group();
    const compared = pair.includes(id);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(compared ? 1.1 : 0.7, 24), new THREE.MeshBasicMaterial({ color: compared ? COL.wit : 0xbfc7d3, depthTest: false, transparent: true, opacity: 0.95 }));
    disc.rotation.x = -Math.PI / 2;
    g.add(disc);
    g.position.set(w.position[0], 0.6, w.position[2]);
    g.renderOrder = 10;
    setLayer(g); overlay.add(g); witMarks.set(id, g);
  }
  const rays = new Map();
  for (const id of pair) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: COL.clear, depthTest: false, transparent: true, opacity: 0.95, linewidth: 2 }));
    line.renderOrder = 11; setLayer(line); overlay.add(line); rays.set(id, line);
  }
  // corridor + ghost (what-if)
  let ghostMesh = null, corridorLine = null;
  if (base) {
    const fp = base.fps[whatIfId];
    ghostMesh = new THREE.Mesh(new THREE.BoxGeometry(fp.width, 0.2, fp.length),
      new THREE.MeshBasicMaterial({ color: COL.ghost, transparent: true, opacity: 0.35, depthTest: false }));
    ghostMesh.renderOrder = 9; ghostMesh.visible = false; setLayer(ghostMesh); overlay.add(ghostMesh);
    const pts = base.corridor.concat([base.corridor[0]]).map(([x, z]) => new THREE.Vector3(x, 0.15, z));
    corridorLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0xffd36b, dashSize: 0.8, gapSize: 0.6, depthTest: false, transparent: true }));
    corridorLine.computeLineDistances(); corridorLine.renderOrder = 8; corridorLine.visible = false; setLayer(corridorLine); overlay.add(corridorLine);
  }

  // ---------- cameras ----------
  const camA = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 3000);
  const camB = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 3000);
  const camO = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 3000);
  camO.layers.enable(OVER);
  const panes = [
    { el: $('paneA'), cam: camA, wid: pair[0] },
    { el: $('paneB'), cam: camB, wid: pair[1] },
    { el: $('paneO'), cam: camO, wid: null },
  ];

  // overhead extent: impact area + compared witnesses that are within 120 m, + vehicles near the impact
  let overHalf = 40;
  {
    const box = new THREE.Box3(focus.clone().add(new THREE.Vector3(-28, 0, -28)), focus.clone().add(new THREE.Vector3(28, 0, 28)));
    for (const id of pair) { const w = wit(id); if (w && Math.hypot(w.position[0] - focus.x, w.position[2] - focus.z) < 120) box.expandByPoint(new THREE.Vector3(w.position[0], 0, w.position[2])); }
    const c = box.getCenter(new THREE.Vector3()); const s = box.getSize(new THREE.Vector3());
    focus.set(c.x, 0, c.z);
    overHalf = Math.max(s.x, s.z) / 2 * 1.08;
  }

  // ---------- live ray-cast (same rules as checks.castRay) ----------
  const rc = new THREE.Raycaster();
  function aimPoint(o) {
    const box = new THREE.Box3().setFromObject(o.node);
    const c = box.getCenter(new THREE.Vector3()); const sz = box.getSize(new THREE.Vector3());
    if (o.kind === 'signal' || sz.y > 3) c.y = Math.max(box.min.y, box.max.y - 0.15);
    return c;
  }
  const isDesc = (n, anc) => { for (let x = n; x; x = x.parent) if (x === anc) return true; return false; };
  const visChain = (o) => { for (let n = o; n; n = n.parent) if (n.visible === false) return false; return true; };
  function eyeOf(w) { return new THREE.Vector3(w.position[0], w.eyeHeight ?? w.position[1] ?? 1.6, w.position[2]); }
  function targetOf(w) {
    if (Array.isArray(w.lookAt)) return { to: new THREE.Vector3(...w.lookAt), node: null, id: null };
    const o = world.objects[w.lookAt];
    return o ? { to: aimPoint(o), node: o.node, id: w.lookAt } : { to: new THREE.Vector3(), node: null, id: null };
  }
  function liveRay(w) {
    const eye = eyeOf(w); const tg = targetOf(w);
    const dir = tg.to.clone().sub(eye); const dist = dir.length(); dir.normalize();
    const owners = [];
    for (const [id, o] of Object.entries(world.objects)) {
      if (o.occludes !== true || !o.node || id === tg.id) continue;
      if (tg.node && (isDesc(o.node, tg.node) || isDesc(tg.node, o.node))) continue;
      owners.push([id, o.node]);
    }
    rc.set(eye, dir); rc.near = 0; rc.far = Math.max(dist - 0.01, 0);
    const hits = rc.intersectObjects(owners.map((x) => x[1]), true).filter((h) => visChain(h.object));
    for (const h of hits) { const ow = owners.find(([, n]) => isDesc(h.object, n)); if (ow) return { visible: false, blockedBy: ow[0], eye, to: tg.to, dist }; }
    return { visible: true, blockedBy: null, eye, to: tg.to, dist };
  }

  // ---------- state ----------
  let curT = clampT(parseFloat(params.get('t')));
  let playing = false;
  let mph = base ? Math.round(base.origMph) : null;
  let whatIf = null;        // analysis (client) when mph != original
  let serverRes = null;     // independent server result for the current mph
  let serverPending = false;
  function clampT(t) { return Number.isFinite(t) ? Math.min(Math.max(t, 0), world.duration) : 0; }
  const objLabel = (id) => (id && world.objects[id] ? shortObjLabel(world.objects[id], id).full : id);

  // ---------- captions ----------
  function robustText(rb) {
    if (!rb) return '';
    return rb.blocked > 0 ? `robustness ${rb.blocked}/${rb.samples} positions blocked (within ${rb.radiusM} m)` : `robustness ${rb.clear}/${rb.samples} positions clear (within ${rb.radiusM} m)`;
  }
  function resultHtml(c, tag) {
    if (!c) return '<div class="cmp-res unk">No independent sight-line result for this witness.</div>';
    const tt = typeof c.t === 'number' ? `t=${c.t.toFixed(1)} s` : '';
    const verdict = c.pass ? `<b>Clear</b> line of sight to ${esc(c.target)}` : `<b>Blocked</b> by ${esc(objLabel(c.blockedBy) || c.blockedBy)}`;
    return `<div class="cmp-res ${c.pass ? 'ok' : 'bad'}"><span class="cmp-tag">${esc(tag)}</span> ${verdict} at ${tt}${c.robustness ? ` · ${esc(robustText(c.robustness))}` : ''}</div>`;
  }
  function renderCaptions() {
    for (const [i, pane] of panes.slice(0, 2).entries()) {
      const w = wit(pane.wid);
      const cap = $(i === 0 ? 'capA' : 'capB');
      $(i === 0 ? 'titleA' : 'titleB').textContent = w ? `${shortName(w)}'s view` : '—';
      if (!w) { cap.innerHTML = '<div class="muted">No witness.</div>'; continue; }
      const orig = sl(w.id);
      let html = `<blockquote>&ldquo;${esc(w.claim || '(no claim recorded)')}&rdquo;</blockquote><div class="cmp-cite">${esc(w.citation || '')}</div>`;
      if (whatIf) {
        const sres = serverRes && serverRes.targetMph === mph ? sl(w.id, serverRes.checks) : null;
        html += sres ? resultHtml(sres, `What-if ${mph} mph · independent check`) : `<div class="cmp-res pend">What-if ${mph} mph · independent check running…</div>`;
        html += `<div class="cmp-orig">${resultHtml(orig, 'As reconstructed')}</div>`;
      } else html += resultHtml(orig, 'Independent check');
      cap.innerHTML = html;
    }
  }

  // ---------- timeline ticks ----------
  function renderTicks() {
    const ticks = $('ticks'); const D = world.duration;
    const items = [];
    for (const id of pair) { const w = wit(id); if (w && typeof w.observationTime === 'number') items.push({ t: w.observationTime, cls: 'wit', label: `${shortName(w)} claim` }); }
    if (base) items.push({ t: base.impactT, cls: 'imp', label: whatIf ? 'Impact (as reconstructed)' : 'Impact' });
    if (whatIf) items.push({ t: whatIf.newImpactT, cls: 'whatif', label: `Reaches impact location @ ${mph} mph` });
    if (whatIf && whatIf.clearT != null) items.push({ t: whatIf.clearT, cls: 'clr', label: 'Path clear' });
    ticks.innerHTML = items.filter((x) => x.t <= D).map((x) => `<div class="tick ${x.cls}" style="left:${(x.t / D) * 100}%" title="${esc(x.label)} t=${x.t.toFixed(2)} s"><span>${esc(x.label)}</span></div>`).join('');
    $('tl').max = String(D);
    $('dur').textContent = D.toFixed(1) + ' s';
  }

  // ---------- frame ----------
  const labelsO = $('labelsO');
  function projectTo(cam, rect, v) {
    const p = v.clone().project(cam);
    return { x: (p.x + 1) / 2 * rect.width, y: (1 - p.y) / 2 * rect.height, behind: p.z > 1 };
  }
  function draw() {
    world.setTime(curT);
    world.root.updateMatrixWorld(true);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const pr = renderer.getPixelRatio();
    if (canvas.width !== Math.floor(W * pr) || canvas.height !== Math.floor(H * pr)) renderer.setSize(W, H, false);
    const crect = canvas.getBoundingClientRect();
    renderer.setScissorTest(false); renderer.clear(true, true, true);
    renderer.setScissorTest(true);
    renderer.shadowMap.needsUpdate = true;
    const live = {};
    for (const id of pair) { const w = wit(id); if (w) live[id] = liveRay(w); }
    // ghost (original timing) + corridor
    if (ghostMesh) {
      const g = world.__whatIf && world.__whatIf.ghost;
      ghostMesh.visible = !!(whatIf && g);
      corridorLine.visible = !!whatIf;
      if (g) { ghostMesh.position.copy(g.position).setY(0.1); ghostMesh.quaternion.copy(g.quaternion); }
    }
    for (const [id, line] of rays) {
      const r = live[id]; if (!r) { line.visible = false; continue; }
      line.visible = true;
      const a = line.geometry.attributes.position;
      a.setXYZ(0, r.eye.x, 0.5, r.eye.z); a.setXYZ(1, (r.visible ? r.to.x : r.to.x), 0.5, r.to.z); a.needsUpdate = true;
      line.geometry.computeBoundingSphere();
      line.material.color.setHex(r.visible ? COL.clear : COL.blocked);
    }
    for (const pane of panes) {
      const rect = pane.el.getBoundingClientRect();
      const x = rect.left - crect.left, y = crect.bottom - rect.bottom;
      if (rect.width < 2 || rect.height < 2) continue;
      renderer.setViewport(x, y, rect.width, rect.height);
      renderer.setScissor(x, y, rect.width, rect.height);
      const aspect = rect.width / rect.height;
      if (pane.wid) {
        const w = wit(pane.wid);
        if (!w) continue;
        const r = live[pane.wid];
        pane.cam.aspect = aspect; pane.cam.fov = 60; pane.cam.updateProjectionMatrix();
        pane.cam.position.copy(r.eye); pane.cam.up.set(0, 1, 0); pane.cam.lookAt(r.to); pane.cam.updateMatrixWorld(true);
        renderer.render(scene, pane.cam);
        // reticle on the target + live badge
        const rt = pane.el.querySelector('.reticle');
        const pp = projectTo(pane.cam, rect, r.to);
        rt.style.transform = `translate(${pp.x}px, ${pp.y}px)`;
        rt.className = 'reticle ' + (r.visible ? 'ok' : 'bad');
        const tl = Array.isArray(w.lookAt) ? 'marked point' : (shortObjLabel(world.objects[w.lookAt], w.lookAt).paren || w.lookAt);
        rt.querySelector('span').textContent = tl;
        pane.el.querySelector('.live').innerHTML = `<span class="dot ${r.visible ? 'ok' : 'bad'}"></span>t=${curT.toFixed(2)} s · ${r.visible ? 'line of sight clear' : 'blocked by ' + esc(shortObjLabel(world.objects[r.blockedBy], r.blockedBy).base)} · ${r1(r.dist)} m · 60° FOV · eye ${w.eyeHeight ?? 1.6} m`;
      } else {
        const h = overHalf;
        camO.left = -h * aspect; camO.right = h * aspect; camO.top = h; camO.bottom = -h;
        camO.up.set(0, 0, -1); camO.position.set(focus.x, 500, focus.z); camO.lookAt(focus.x, 0, focus.z);
        camO.updateProjectionMatrix(); camO.updateMatrixWorld(true);
        renderer.render(scene, camO);
        // labels: compared witnesses (clamped to the pane edge when off-screen)
        let html = '';
        for (const id of pair) {
          const w = wit(id); if (!w) continue;
          let p = projectTo(camO, rect, new THREE.Vector3(w.position[0], 0, w.position[2]));
          let off = '';
          if (p.x < 0 || p.y < 0 || p.x > rect.width || p.y > rect.height) {
            const dx = w.position[0] - focus.x, dz = w.position[2] - focus.z;
            const dist = Math.round(Math.hypot(dx, dz));
            const card = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'E' : 'W') : (dz > 0 ? 'S' : 'N');
            off = ` · ${dist} m ${card} →`;
            p = { x: Math.min(Math.max(p.x, 60), rect.width - 60), y: Math.min(Math.max(p.y, 14), rect.height - 14) };
          }
          html += `<div class="olabel ${live[id] && live[id].visible ? 'ok' : 'bad'}" style="transform:translate(${p.x}px,${p.y}px)">${esc(shortName(w))}${off}</div>`;
        }
        if (whatIf && world.__whatIf) {
          const gp = projectTo(camO, rect, world.__whatIf.ghost.position);
          if (gp.x > 0 && gp.y > 0 && gp.x < rect.width && gp.y < rect.height) html += `<div class="olabel ghost" style="transform:translate(${gp.x}px,${gp.y}px)">${esc(speedName(world, whatIfId))} as reconstructed</div>`;
        }
        labelsO.innerHTML = html;
      }
    }
    renderer.setScissorTest(false);
    $('tval').textContent = curT.toFixed(2);
    $('tl').value = String(curT);
  }
  let rafPending = false;
  function requestDraw() { if (!rafPending) { rafPending = true; requestAnimationFrame(() => { rafPending = false; draw(); }); } }

  // ---------- timeline controls ----------
  $('tl').addEventListener('input', (e) => { curT = clampT(parseFloat(e.target.value)); requestDraw(); });
  let last = 0;
  function tick(ts) {
    if (!playing) return;
    const dt = last ? (ts - last) / 1000 : 0; last = ts;
    curT += dt;
    if (curT >= world.duration) { curT = world.duration; playing = false; $('play').textContent = 'Play'; }
    draw();
    if (playing) requestAnimationFrame(tick);
  }
  $('play').addEventListener('click', () => {
    playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play';
    if (playing) { if (curT >= world.duration - 0.01) curT = 0; last = 0; requestAnimationFrame(tick); }
  });
  for (const b of document.querySelectorAll('[data-jump]')) b.addEventListener('click', () => { const v = jumpT(b.dataset.jump); if (v != null) { curT = clampT(v); requestDraw(); } });
  function jumpT(k) {
    if (k === 'a' || k === 'b') { const w = wit(pair[k === 'a' ? 0 : 1]); return w ? w.observationTime : null; }
    if (k === 'impact') return whatIf ? whatIf.newImpactT : base ? base.impactT : null;
    return null;
  }

  // ---------- what-if controls ----------
  const sp = $('speed');
  if (!base) {
    $('whatif').classList.add('disabled');
    $('wiText').textContent = 'No moving vehicle with an impact to re-time in this world.';
  } else {
    const nm = speedName(world, whatIfId);
    $('speedLabel').textContent = `${nm} speed`;
    const v0 = Math.round(base.origMph);
    sp.min = String(Math.max(5, Math.floor(v0 * 0.4))); sp.max = String(Math.ceil(v0 * 1.4)); sp.value = String(v0);
    $('speedOrig').textContent = `${v0} mph as reconstructed`;
    $('wiReset').addEventListener('click', () => setWhatIf(v0));
    sp.addEventListener('input', () => { $('speedVal').textContent = sp.value + ' mph'; });
    sp.addEventListener('change', () => setWhatIf(+sp.value));
  }
  let fetchSeq = 0;
  async function setWhatIf(v) {
    if (!base) return;
    const v0 = Math.round(base.origMph);
    v = Math.round(+v);
    mph = v; sp.value = String(v); $('speedVal').textContent = v + ' mph';
    const keepT = curT;
    const w = await freshWorld();
    attachWorld(w);
    serverRes = null;
    if (v === v0) {
      whatIf = null;
      $('wiText').innerHTML = `Drag to re-run the reconstruction with ${esc(speedName(world, whatIfId))} at another speed. The impact location stays fixed; timing shifts.`;
      $('wiAssume').textContent = '';
      document.body.classList.remove('is-whatif');
    } else {
      whatIf = retimeWorld(world, { object: whatIfId, targetMph: v });
      document.body.classList.add('is-whatif');
      $('wiText').innerHTML = `<b>What-if ${v} mph.</b> ${esc(whatIf.sentence)}`;
      $('wiAssume').textContent = whatIf.assumptions.join(' ');
      serverPending = true;
      const seq = ++fetchSeq;
      fetch(`/api/cases/${encodeURIComponent(caseId)}/whatif?object=${encodeURIComponent(whatIfId)}&targetMph=${v}`)
        .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
        .then(({ ok, j }) => {
          if (seq !== fetchSeq) return;
          serverPending = false;
          if (!ok) throw new Error(j.error || 'what-if failed');
          serverRes = j;
          $('wiText').innerHTML = `<b>What-if ${v} mph.</b> ${esc(j.sentence)} <span class="srv">Independent checks re-run on the server (${j.checks.length} results).</span>`;
          renderCaptions(); updateSummary();
          cmp.lastServer = j;
        })
        .catch((e) => { if (seq === fetchSeq) { serverPending = false; $('wiText').innerHTML += ` <span class="err">Server check failed: ${esc(e.message)}</span>`; } });
    }
    curT = clampT(keepT);
    renderTicks(); renderCaptions(); updateSummary();
    draw();
  }
  function updateSummary() {
    const D = (a) => (a ? (a.pass ? 'clear' : 'blocked') : '?');
    const parts = pair.map((id) => {
      const w = wit(id); const c = whatIf ? (serverRes ? sl(id, serverRes.checks) : null) : sl(id);
      return `${shortName(w)}: ${whatIf && !serverRes ? '…' : D(c)}`;
    });
    $('summary').textContent = parts.join(' · ');
  }

  // ---------- resize ----------
  new ResizeObserver(() => requestDraw()).observe(document.getElementById('cmpRoot'));

  // ---------- go ----------
  renderTicks(); renderCaptions(); updateSummary();
  const qm = parseFloat(params.get('mph'));
  if (base && Number.isFinite(qm)) await setWhatIf(qm);
  else { $('wiText').innerHTML = base ? `Drag to re-run the reconstruction with ${esc(speedName(world, whatIfId))} at another speed. The impact location stays fixed; timing shifts.` : $('wiText').innerHTML; draw(); }

  Object.assign(cmp, {
    get world() { return world; }, pair, whatIfId, base,
    setTime(t) { curT = clampT(+t); draw(); },
    setWhatIf,
    get whatIf() { return whatIf; },
    get serverResult() { return serverRes; },
    serverSettled: () => new Promise((res) => { const iv = setInterval(() => { if (!serverPending) { clearInterval(iv); res(serverRes); } }, 100); }),
    renderFrame: draw,
  });
  window.__cmpResolve && window.__cmpResolve(cmp);
}
