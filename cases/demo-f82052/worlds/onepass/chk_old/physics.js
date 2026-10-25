// Sightline physics helpers (CREDIBILITY v1, see SPEC.md). Node ES module; depends only on three.
// Independent math over a world module's setTime(): skid speed range, perception-reaction time (PRT)
// available before impact, and kinematic plausibility of every moving object.
// No case-specific facts, ids or numbers live here.
// Plausibility: >1.0 g fails outside +-0.5 s of impact. For an object that took part in the impact
// (plan-view contact with another moving unit near impact, or >1 g inside the impact window), the whole
// post-impact phase is excluded too: run-out with secondary impacts (fences, poles, kerbs) legitimately
// exceeds 1 g. Those post-impact peaks are reported separately as information. Pre-impact >1 g always fails.
import * as THREE from 'three';
// Circular import is safe: castRay is only used at call time (checks.js uses physics.* at call time too).
import { castRay } from './checks.js';

export const KINEMATIC_LABEL = "Kinematic reconstruction: motion fitted to cited evidence; not a crash-physics simulation.";

const G = 9.81;
const MPS_TO_MPH = 2.2369362920544;
const DT = 0.05;                 // sampling step (s)
const MU_RANGE = [0.6, 0.8];     // dry-asphalt friction range
const PRT_RANGE = [1.0, 2.5];    // perception-reaction time range (s)
const PRT_TYPICAL = 1.5;
const ACCEL_LIMIT_G = 1.0;
const IMPACT_WINDOW_S = 0.5;
const JUMP_LIMIT_M = 5;
const SPEED_LIMIT_MPS = 60;
const CONFLICT_M = 3;           // conflict corridor: half-lane + vehicle half-width around the observer's path centerline
const ACCEL_HALF_SPAN = 2;       // accel = velocity change over +-2 samples (0.2 s) to suppress keyframe-interpolation kinks

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const fmt = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x));

// ---------------------------------------------------------------- skid range
export function skidRange(lengthM) {
  const d = Number(lengthM);
  if (!Number.isFinite(d) || d < 0) return { mu: [...MU_RANGE], mph: [NaN, NaN], mps: [NaN, NaN] };
  const mps = MU_RANGE.map((mu) => Math.sqrt(2 * mu * G * d));
  return { mu: [...MU_RANGE], mph: mps.map((v) => v * MPS_TO_MPH), mps };
}

// ---------------------------------------------------------------- shared helpers
function setT(world, t) {
  world.setTime(t);
  world.root.updateMatrixWorld(true);
}

function worldPos(node) {
  return node.getWorldPosition(new THREE.Vector3());
}

function isVisibleChain(o) {
  for (let n = o; n; n = n.parent) if (n.visible === false) return false;
  return true;
}

function isDescendant(node, ancestor) {
  for (let n = node; n; n = n.parent) if (n === ancestor) return true;
  return false;
}

function shortName(s) {
  return String(s || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function label(world, id) {
  const o = world.objects?.[id];
  if (o?.label) {
    const m = String(o.label).match(/\(([^)]*vehicle[^)]*)\)/i);   // "Sedan (Vehicle A), eastbound" -> "Vehicle A"
    return m ? m[1] : shortName(o.label);
  }
  const w = (world.witnesses || []).find((x) => x.id === id);
  return w ? shortName(w.name) || id : id;
}

// Vehicle "unit": veh_T_tractor and veh_T_trailer belong to veh_T; veh_A is its own unit.
function unitOf(id) {
  const parts = String(id).split('_');
  return parts.length > 2 ? parts.slice(0, 2).join('_') : id;
}
function unitParts(world, id) {
  const u = unitOf(id);
  return Object.keys(world.objects || {}).filter((k) => k === id || (k.startsWith('veh_') && unitOf(k) === u));
}

function times(duration, step = DT) {
  const out = [];
  const n = Math.max(0, Math.round(duration / step));
  for (let i = 0; i <= n; i++) out.push(Math.min(i * step, duration));
  return out;
}

// Impact time: meta first, then a cited time fact about impact. Returns { t, source } or null.
export function impactTimeOf(world) {
  const meta = world.meta || {};
  for (const k of ['impactT', 'impactTime', 'tImpact', 'T_IMPACT', 'impact_t']) {
    const v = meta[k] ?? world[k];
    if (typeof v === 'number' && Number.isFinite(v)) return { t: v, source: `meta.${k}` };
  }
  const dur = world.duration ?? Infinity;
  for (const f of world.facts || []) {
    if (typeof f.value !== 'number') continue;
    const unit = String(f.unit || '').toLowerCase();
    if (unit && unit !== 's' && unit !== 'sec' && unit !== 'seconds') continue;
    const id = String(f.id || '');
    const text = String(f.text || '');
    const idHit = /impact(_?t(ime)?)?$|^t_?impact|impact_?time/i.test(id);
    const textHit = /\bimpact\s+(at|occurs|time)\b|\bimpact\b[^.]*\bt\s*=/i.test(text);
    if ((idHit || textHit) && f.value >= 0 && f.value <= dur) return { t: f.value, source: `fact ${f.id} (${f.citation || 'uncited'})` };
  }
  return null;
}

// ---------------------------------------------------------------- motion sampling
function sampleMotion(world, ids, ts) {
  const pos = Object.fromEntries(ids.map((id) => [id, []]));
  for (const t of ts) {
    setT(world, t);
    for (const id of ids) pos[id].push(worldPos(world.objects[id].node));
  }
  return pos;
}

function movingIds(world, ts) {
  const ids = Object.entries(world.objects || {}).filter(([, o]) => o && o.node).map(([id]) => id);
  const pos = sampleMotion(world, ids, ts);
  const moving = ids.filter((id) => pos[id].some((p) => p.distanceTo(pos[id][0]) > 0.05));
  return { moving, pos };
}

// Per-sample kinematics. vel[i] = segment velocity between samples i and i+1 (vector, m/s).
// acc[i] (at sample i) = (v(i+K) - v(i-K)) / (2K*dt) using central-difference velocities.
function kinematics(P, ts) {
  const n = P.length;
  const seg = [];
  for (let i = 0; i < n - 1; i++) {
    const dt = ts[i + 1] - ts[i] || DT;
    seg.push({ d: P[i + 1].distanceTo(P[i]), v: P[i + 1].clone().sub(P[i]).divideScalar(dt), dt });
  }
  const vc = [];   // central velocity at sample i
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const dt = ts[b] - ts[a] || DT;
    vc.push(P[b].clone().sub(P[a]).divideScalar(dt));
  }
  const K = ACCEL_HALF_SPAN;
  const acc = new Array(n).fill(null);
  for (let i = K; i < n - K; i++) {
    const dt = ts[i + K] - ts[i - K];
    if (dt <= 0) continue;
    const a = vc[i + K].clone().sub(vc[i - K]).divideScalar(dt);
    // signed tangential component (negative = braking)
    const vdir = vc[i].length() > 0.1 ? vc[i].clone().normalize() : null;
    acc[i] = { mag: a.length(), tang: vdir ? a.dot(vdir) : 0, lo: i - K - 1, hi: i + K + 1 };
  }
  return { seg, vc, acc };
}

// ---------------------------------------------------------------- plausibility
export function plausibilityCheck(world) {
  const dur = Number(world.duration) || 0;
  if (!world || typeof world.setTime !== 'function' || !world.objects || dur <= 0) return [];
  const ts = times(dur);
  let moving, pos;
  try {
    ({ moving, pos } = movingIds(world, ts));
  } catch (e) {
    return [{ check: 'plausibility', subject: 'world', pass: false, maxAccelG: null, maxSpeedMph: null,
      issues: [`setTime failed: ${e.message}`], detail: `Could not sample the world's motion: ${e.message}` }];
  }
  const kin = Object.fromEntries(moving.map((id) => [id, kinematics(pos[id], ts)]));

  // Impact time: meta/facts, else first contact of two moving vehicles, else the time of the strongest braking (tangential deceleration) of any moving object.
  let impact = impactTimeOf(world) || contactImpact(world);
  if (!impact) {
    let best = 0, bestT = null, bestId = null;
    for (const id of moving) {
      kin[id].acc.forEach((a, i) => { if (a && -a.tang > best) { best = -a.tang; bestT = ts[i]; bestId = id; } });
    }
    if (bestT !== null) impact = { t: bestT, source: `estimated: strongest deceleration (${bestId}, ${r1(best / G)} g)`, fromDecel: true };
  }
  const halfSpan = (ACCEL_HALF_SPAN + 1) * DT;   // accel sample footprint
  const nearImpact = (t) => impact && Math.abs(t - impact.t) <= IMPACT_WINDOW_S + halfSpan;
  const postImpact = (t) => impact && t > impact.t + IMPACT_WINDOW_S + halfSpan;

  // Units in plan-view contact with another moving unit within 1 s of impact took part in it.
  const contactUnits = new Set();
  if (impact) {
    try {
      for (const p of unitContacts(world, movingUnits(world))) {
        if (p.t !== null && Math.abs(p.t - impact.t) <= 1.0) { contactUnits.add(p.a); contactUnits.add(p.b); }
      }
    } catch { /* contact is a hint only */ }
  }

  const out = [];
  for (const id of moving) {
    const { seg, acc } = kin[id];
    const issues = [];
    const jumpSegs = new Set();
    let maxSpeed = 0, maxSpeedT = 0;
    const jumps = [], fast = [];
    seg.forEach((s, i) => {
      if (s.d > JUMP_LIMIT_M) { jumpSegs.add(i); jumps.push([ts[i], ts[i + 1], s.d]); return; }
      const sp = s.v.length();
      if (sp > maxSpeed) { maxSpeed = sp; maxSpeedT = ts[i]; }
      if (sp > SPEED_LIMIT_MPS) fast.push([ts[i], sp]);
    });
    const clean = (a) => {
      for (let k = Math.max(0, a.lo); k <= Math.min(seg.length - 1, a.hi); k++) if (jumpSegs.has(k)) return false;
      return true;
    };
    let impactA = 0;
    acc.forEach((a, i) => { if (a && clean(a) && nearImpact(ts[i])) impactA = Math.max(impactA, a.mag); });
    // Not when the impact time was itself estimated from the strongest deceleration (that would excuse the flagged motion).
    const involved = !!impact && !impact.fromDecel && (contactUnits.has(unitOf(id)) || impactA > ACCEL_LIMIT_G * G);
    let maxA = 0, maxAT = null, postA = 0, postAT = null;
    const hard = [];
    acc.forEach((a, i) => {
      if (!a || !clean(a) || nearImpact(ts[i])) return;
      if (involved && postImpact(ts[i])) { if (a.mag > postA) { postA = a.mag; postAT = ts[i]; } return; }
      if (a.mag > maxA) { maxA = a.mag; maxAT = ts[i]; }
      if (a.mag > ACCEL_LIMIT_G * G) hard.push([ts[i], a.mag]);
    });

    if (jumps.length) {
      const [t0, t1, d] = jumps.reduce((m, j) => (j[2] > m[2] ? j : m));
      issues.push(`position jumps ${r1(d)} m between t=${fmt(t0)} and t=${fmt(t1)} s (limit ${JUMP_LIMIT_M} m per ${DT} s)` + (jumps.length > 1 ? `; ${jumps.length} jumps in total` : ''));
    }
    if (fast.length) {
      const [t, sp] = fast.reduce((m, f) => (f[1] > m[1] ? f : m));
      issues.push(`speed ${r1(sp)} m/s (${r1(sp * MPS_TO_MPH)} mph) at t=${fmt(t)} s exceeds ${SPEED_LIMIT_MPS} m/s` + (fast.length > 1 ? `; over the limit for ${r2(fast.length * DT)} s` : ''));
    }
    if (hard.length) {
      const t0 = hard[0][0], t1 = hard[hard.length - 1][0];
      const when = impact && maxAT < impact.t ? 'before impact' : 'outside the impact window';
      issues.push(`acceleration ${r2(maxA / G)} g at t=${fmt(maxAT)} s exceeds ${ACCEL_LIMIT_G} g ${when}` +
        ` (over the limit at ${hard.length} samples between t=${fmt(t0)} and t=${fmt(t1)} s)`);
    }
    const pass = issues.length === 0;
    const nm = label(world, id);
    const impactNote = !impact ? ' No impact time found; no window excluded.'
      : involved ? ` Impact at t=${fmt(impact.t)} s (${impact.source}); ${nm} took part in it, so accelerations within ±${IMPACT_WINDOW_S} s of impact and during the post-impact run-out are excluded.`
      : ` Impact at t=${fmt(impact.t)} s (${impact.source}); accelerations within ±${IMPACT_WINDOW_S} s of it are excluded.`;
    const postNote = involved && postAT !== null
      ? ` Info: post-impact peak ${r2(postA / G)} g at t=${fmt(postAT)} s` + (postA > ACCEL_LIMIT_G * G ? ' (consistent with secondary impacts during run-out; not counted).' : '.')
      : '';
    const scope = involved ? 'before impact' : 'outside the impact window';
    const detail = pass
      ? `${nm} moves plausibly: peak speed ${r1(maxSpeed * MPS_TO_MPH)} mph, peak acceleration ${r2(maxA / G)} g ${scope}, no position jumps.${impactNote}${postNote}`
      : `${nm} has implausible motion: ${issues.join('; ')}.${impactNote}${postNote}`;
    out.push({
      check: 'plausibility', subject: id, pass,
      maxAccelG: r2(maxA / G), maxSpeedMph: r1(maxSpeed * MPS_TO_MPH), issues, detail,
      citation: world.objects[id]?.citation || '',
      maxAccelT: maxAT, maxSpeedT, impactAccelG: r2(impactA / G),
      involvedInImpact: involved, postImpactAccelG: involved ? r2(postA / G) : null, postImpactAccelT: involved ? postAT : null,
      impactT: impact ? impact.t : null, impactSource: impact ? impact.source : null,
      label: KINEMATIC_LABEL,
    });
  }
  return out;
}

// ---------------------------------------------------------------- PRT
function localBox(node) {
  node.updateMatrixWorld(true);
  const inv = node.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  node.traverse((m) => {
    if (!m.isMesh || !m.geometry) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    box.union(b);
  });
  return box;
}

// Eye point for an observer: a witness, or the driver of a vehicle (userData.driverEye, else estimated
// from the vehicle box: left side, ~40% back from the front (local -Z), ~0.3 m below the roof, max 2.4 m).
function eyeFn(world, observerId) {
  const w = (world.witnesses || []).find((x) => x.id === observerId);
  if (w) {
    const e = new THREE.Vector3(w.position[0], w.eyeHeight ?? w.position[1] ?? 1.6, w.position[2]);
    return { eye: () => e.clone(), exclude: [], kind: 'witness' };
  }
  const o = world.objects?.[observerId];
  if (!o?.node) return null;
  let local;
  const de = o.node.userData?.driverEye;
  if (Array.isArray(de) && de.length === 3) local = new THREE.Vector3(...de);
  else {
    const b = localBox(o.node);
    if (b.isEmpty()) local = new THREE.Vector3(0, 1.2, 0);
    else {
      const size = b.getSize(new THREE.Vector3());
      local = new THREE.Vector3(b.min.x + size.x * 0.3, Math.max(0.9, Math.min(b.max.y - 0.3, 2.4)), b.min.z + Math.min(size.z * 0.4, 2.0));
    }
  }
  return { eye: () => o.node.localToWorld(local.clone()), exclude: unitParts(world, observerId), kind: 'driver' };
}

// Line of sight via checks.js castRay (same ray rule as the sightline check). The observer's own unit and
// the target's unit are made non-occluding for the duration of the cast (restored afterwards), so the
// driver's own car body or the target's other parts (tractor vs trailer) do not count as blockers.
function rayClear(world, eye, targetId, t, skipIds) {
  const saved = [];
  try {
    for (const id of skipIds) {
      const o = world.objects[id];
      if (o && o.occludes === true) { saved.push(o); o.occludes = false; }
    }
    const r = castRay(world, eye.toArray(), targetId, t, { prepared: true });
    return { visible: r.visible, blockedBy: r.blockedBy };
  } finally {
    for (const o of saved) o.occludes = true;
  }
}

function xzBox(node) {
  const b = new THREE.Box3().setFromObject(node);
  return b.isEmpty() ? null : b;
}
function xzDist(p, b) {
  const dx = Math.max(b.min.x - p.x, 0, p.x - b.max.x);
  const dz = Math.max(b.min.z - p.z, 0, p.z - b.max.z);
  return Math.hypot(dx, dz);
}

// First time two units' axis-aligned boxes overlap in plan (rough contact estimate).
function firstContact(world, idsA, idsB, dur) {
  for (const t of times(dur)) {
    setT(world, t);
    for (const a of idsA) for (const b of idsB) {
      const A = xzBox(world.objects[a].node), B = xzBox(world.objects[b].node);
      if (A && B && A.min.x <= B.max.x && A.max.x >= B.min.x && A.min.z <= B.max.z && A.max.z >= B.min.z) return t;
    }
  }
  return null;
}

function verdictOf(s) {
  if (!Number.isFinite(s)) return 'unverifiable';
  if (s < PRT_RANGE[0]) return 'insufficient';
  if (s <= PRT_RANGE[1]) return 'marginal';
  return 'sufficient';
}

function prtBase(observerId, targetId, impactT) {
  return { check: 'prt', subject: observerId ?? null, observerId: observerId ?? null, targetId: targetId ?? null, impactT: impactT ?? null,
    availableS: null, rangeS: [...PRT_RANGE], typicalS: PRT_TYPICAL, verdict: 'unverifiable', method: null,
    firstVisibleT: null, conflictT: null, conflictS: null, cappedAtStart: false, blockedBy: null, detail: '' };
}

export function prtCheck(world, { observerId, targetId, impactT } = {}) {
  const out = prtBase(observerId, targetId, impactT);
  const typ = `Typical perception-reaction time is ${PRT_TYPICAL} s (range ${PRT_RANGE[0]}–${PRT_RANGE[1]} s).`;
  if (!world || typeof world.setTime !== 'function' || !observerId || !targetId) {
    out.detail = `Perception-reaction time unverifiable: missing ${!observerId ? 'observer' : !targetId ? 'target' : 'world'}.`;
    return out;
  }
  if (!Number.isFinite(impactT)) {
    out.detail = `Perception-reaction time unverifiable for ${label(world, observerId)}: no impact time in the world (meta or cited facts).`;
    return out;
  }
  const obs = eyeFn(world, observerId);
  const tgtIds = (world.objects?.[targetId] ? unitParts(world, targetId) : []).filter((id) => world.objects[id]?.node);
  if (!obs || !tgtIds.length) {
    out.detail = `Perception-reaction time unverifiable: ${!obs ? `observer ${observerId}` : `target ${targetId}`} not found in the world.`;
    return out;
  }
  const oName = obs.kind === 'driver' ? `The driver of ${label(world, observerId)}` : label(world, observerId);
  const tName = label(world, targetId);
  const dur = Number(world.duration) || impactT;
  const tI = Math.min(impactT, dur);
  const skip = new Set([...obs.exclude, ...tgtIds]);

  // 1) Sightline: walk back from impact; find the start of the continuous line-of-sight window ending at impact.
  let firstVis = null, blockedBy = null, sightOk = true;
  try {
    const back = [];
    for (let k = 1; tI - k * DT > 1e-9; k++) back.push(tI - k * DT);
    if (tI > 1e-9) back.push(0);
    for (let k = 0; ; k++) {
      if (k >= back.length) { out.cappedAtStart = true; break; }
      const t = back[k];
      setT(world, t);
      const eye = obs.eye();
      let vis = false, blk = null;
      for (const id of tgtIds) {
        const o = world.objects[id];
        if (!isVisibleChain(o.node)) continue;
        const r = rayClear(world, eye, id, t, skip);
        if (r.visible) { vis = true; break; }
        blk = blk || r.blockedBy;
      }
      if (!vis) { blockedBy = blk; break; }
      firstVis = t;
    }
  } catch (e) {
    sightOk = false;
  }

  // 2) Conflict entry: first time the target comes within CONFLICT_M (plan view) of the path the observer still has to drive before impact.
  try {
    const ts = times(tI);
    const path = [];
    const boxes = [];
    for (const t of ts) {
      setT(world, t);
      path.push(obs.kind === 'driver' ? worldPos(world.objects[observerId].node) : obs.eye());
      boxes.push(tgtIds.map((id) => xzBox(world.objects[id].node)).filter(Boolean));
    }
    for (let i = 0; i < ts.length && out.conflictT === null; i++) {
      for (let j = i; j < ts.length; j++) {
        if (boxes[i].some((b) => xzDist(path[j], b) <= CONFLICT_M)) { out.conflictT = ts[i]; break; }
      }
    }
    if (out.conflictT !== null) out.conflictS = r2(tI - out.conflictT);
  } catch { /* conflict is informational */ }

  const caveat = ' Kinematic estimate from the reconstructed geometry; it does not account for attention, conspicuity, glare or expectation.';
  if (sightOk && firstVis !== null) {
    out.method = 'sightline';
    out.firstVisibleT = r2(firstVis);
    out.availableS = r2(tI - firstVis);
  } else if (sightOk && firstVis === null) {
    out.method = 'sightline';
    out.firstVisibleT = null;
    out.availableS = 0;
    out.blockedBy = blockedBy;
  } else if (out.conflictS !== null) {
    out.method = 'conflict';
    out.availableS = out.conflictS;
  } else {
    out.detail = `Perception-reaction time unverifiable for ${oName}: neither line of sight nor conflict entry could be computed.`;
    return out;
  }
  if (out.method === 'sightline' && !out.blockedBy && blockedBy) out.blockedBy = blockedBy;
  out.verdict = verdictOf(out.availableS);
  const verdictText = {
    insufficient: `less than the ${PRT_RANGE[0]} s minimum, so there was not enough time to perceive and begin reacting`,
    marginal: `within the ${PRT_RANGE[0]}–${PRT_RANGE[1]} s range, so a reaction was possible but not assured`,
    sufficient: `more than the ${PRT_RANGE[1]} s upper bound, so there was time to perceive and begin reacting`,
  }[out.verdict];
  let what;
  if (out.method === 'sightline' && out.availableS === 0) {
    what = `${oName} had no line of sight to ${tName} immediately before impact at t=${fmt(tI)} s` + (blockedBy ? ` (blocked by ${blockedBy})` : '') + '.';
  } else if (out.method === 'sightline') {
    what = `${oName} had a continuous line of sight to ${tName} for ${fmt(out.availableS)} s before impact (t=${fmt(out.firstVisibleT)}–${fmt(tI)} s)` +
      (out.cappedAtStart ? ', from the start of the reconstructed timeline, so this is a lower bound' : blockedBy ? `; before that it was blocked by ${blockedBy}` : '') + '.';
  } else {
    what = `Line of sight could not be evaluated; ${tName} entered ${oName.toLowerCase().replace(/^the /, 'the ')}'s path ${fmt(out.availableS)} s before impact (t=${fmt(out.conflictT)} s).`;
  }
  const conflictNote = out.method === 'sightline' && out.conflictS !== null ? ` ${tName} came within ${CONFLICT_M} m of the centerline of ${obs.kind === 'driver' ? 'this driver' : 'the observer'}'s remaining path ${fmt(out.conflictS)} s before impact.` : '';
  out.detail = `${what} ${typ} Time available is ${verdictText}.${conflictNote}${caveat}`;
  return out;
}

// Moving vehicle units: Map unit -> [object ids]. Units that never move (parked cars) are left out.
function movingUnits(world) {
  const dur = Number(world.duration) || 0;
  const vehIds = Object.entries(world.objects || {}).filter(([id, o]) => o?.node && (o.kind === 'vehicle' || id.startsWith('veh_'))).map(([id]) => id);
  const pos = sampleMotion(world, vehIds, times(dur, 0.25));
  const units = new Map();
  for (const id of vehIds) {
    if (!pos[id].some((p) => p.distanceTo(pos[id][0]) > 0.05)) continue;
    const u = unitOf(id);
    if (!units.has(u)) units.set(u, []);
    units.get(u).push(id);
  }
  return units;
}

// Every pair of moving units with its first plan-view contact time (null if they never touch).
function unitContacts(world, units) {
  const dur = Number(world.duration) || 0;
  const keys = [...units.keys()];
  const pairs = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    pairs.push({ a: keys[i], b: keys[j], t: firstContact(world, units.get(keys[i]), units.get(keys[j]), dur) });
  }
  return pairs;
}

// Fallback impact estimate: earliest plan-view contact between two moving vehicle units.
function contactImpact(world) {
  try {
    const pairs = unitContacts(world, movingUnits(world)).filter((p) => p.t !== null).sort((x, y) => x.t - y.t);
    if (pairs.length) return { t: pairs[0].t, source: `estimated: first plan-view contact of ${pairs[0].a} and ${pairs[0].b}` };
  } catch { /* fall through */ }
  return null;
}

// Each driver of a colliding vehicle unit vs the other unit (trailers are not drivers). Pairs are the
// units that come into contact (around the stated impact time when there is one); if none touch, all pairs.
export function prtAll(world) {
  if (!world || !world.objects || typeof world.setTime !== 'function') return [];
  let units, contacts;
  try {
    units = movingUnits(world);
    contacts = unitContacts(world, units);
  } catch {
    return [];
  }
  const impact = impactTimeOf(world);
  const near = (t) => t !== null && (!impact || Math.abs(t - impact.t) <= 1.0);
  let pairs = contacts.filter((p) => near(p.t));
  if (!pairs.length) pairs = contacts;
  const driverOf = (ids) => ids.find((id) => !/trailer/i.test(id + ' ' + (world.objects[id].label || ''))) || null;
  const targetOf = (ids) => ids.find((id) => /trailer/i.test(id)) || driverOf(ids) || ids[0];
  const out = [];
  for (const p of pairs) {
    for (const [a, b] of [[p.a, p.b], [p.b, p.a]]) {
      const observerId = driverOf(units.get(a));
      if (!observerId) continue;
      const targetId = targetOf(units.get(b));
      let impactT = impact?.t ?? null, src = impact?.source ?? null;
      if (!Number.isFinite(impactT) && p.t !== null) { impactT = p.t; src = `estimated: first plan-view contact of ${a} and ${b}`; }
      const r = prtCheck(world, { observerId, targetId, impactT: impactT ?? undefined });
      r.impactSource = src;
      out.push(r);
    }
  }
  return out;
}
