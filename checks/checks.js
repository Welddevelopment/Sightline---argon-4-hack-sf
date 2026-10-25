// Sightline independent geometry/physics checks. Node ES module; depends only on three.
import * as THREE from 'three';
import { sightlineRobustness, gazeAngle } from './robustness.js';
import * as physics from './physics.js';

export { KINEMATIC_LABEL } from './physics.js';

const G = 9.81;
const MPS_TO_MPH = 2.2369362920544;
const r1 = (x) => Math.round(x * 10) / 10;

export function prep(world, t) {
  if (t !== undefined && t !== null) world.setTime(t);
  world.root.updateMatrixWorld(true);
}

function isVisibleChain(o) {
  for (let n = o; n; n = n.parent) if (n.visible === false) return false;
  return true;
}

function isDescendant(node, ancestor) {
  for (let n = node; n; n = n.parent) if (n === ancestor) return true;
  return false;
}

// Aim point on the target: bbox center, or near the top for tall things (signals, > 3 m).
export function aimPoint(obj) {
  const box = new THREE.Box3().setFromObject(obj.node);
  if (box.isEmpty()) {
    const p = new THREE.Vector3();
    obj.node.getWorldPosition(p);
    return p;
  }
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  if (obj.kind === 'signal' || size.y > 3) c.y = Math.max(box.min.y, box.max.y - 0.15);
  return c;
}

export function findWitness(world, id) {
  const w = (world.witnesses || []).find((x) => x.id === id);
  if (!w) throw new Error(`Unknown witness ${id}`);
  return w;
}

// Witness eye position (absolute y: ground is y=0, eyeHeight is the eye's height above it).
export function witnessEye(w) {
  return [w.position[0], w.eyeHeight ?? w.position[1] ?? 1.6, w.position[2]];
}

// Resolve a target (object id or [x,y,z]) to an aim point in the CURRENT world state.
export function resolveTarget(world, targetId) {
  if (Array.isArray(targetId)) return { to: new THREE.Vector3(...targetId), targetNode: null };
  const tgt = world.objects[targetId];
  if (!tgt) throw new Error(`Unknown target ${targetId}`);
  return { to: aimPoint(tgt), targetNode: tgt.node };
}

// Ray-cast from eye [x,y,z] to targetId in the current (already setTime'd) world state.
// Pass { prepared: true } when world.setTime(t) + updateMatrixWorld already ran (batch use).
export function castRay(world, eyeArr, targetId, t, opts = {}) {
  if (!opts.prepared) prep(world, t);
  const eye = new THREE.Vector3(...eyeArr);
  const { to, targetNode } = opts.resolved || resolveTarget(world, targetId);

  const dir = to.clone().sub(eye);
  const distance = dir.length();
  const out = { visible: true, blockedBy: null, distance, from: eye.toArray(), to: to.toArray(), hitPoint: null };
  if (distance < 1e-6) return out;
  dir.normalize();

  // Collect occluder meshes (not in target subtree), remember which object id owns each node.
  const owners = [];
  const roots = [];
  for (const [id, o] of Object.entries(world.objects)) {
    if (o.occludes !== true || !o.node) continue;
    if (id === targetId) continue;
    if (targetNode && (isDescendant(o.node, targetNode) || isDescendant(targetNode, o.node))) continue;
    owners.push([id, o.node]);
    roots.push(o.node);
  }

  const rc = new THREE.Raycaster(eye, dir, 0, Math.max(distance - 0.01, 0));
  const hits = rc.intersectObjects(roots, true).filter((h) => isVisibleChain(h.object));
  for (const h of hits) {
    const owner = owners.find(([, n]) => isDescendant(h.object, n));
    if (!owner) continue;
    out.visible = false;
    out.blockedBy = owner[0];
    out.hitPoint = h.point.toArray();
    break;
  }
  return out;
}

export function sightline(world, witnessId, targetId, t) {
  const w = findWitness(world, witnessId);
  return castRay(world, witnessEye(w), targetId, t);
}

export function skidSpeed(lengthM, mu = 0.7) {
  const mps = Math.sqrt(2 * mu * G * lengthM);
  return { mps, mph: mps * MPS_TO_MPH };
}

export function speedAt(world, objectId, t, dt = 0.05) {
  const o = world.objects[objectId];
  if (!o) throw new Error(`Unknown object ${objectId}`);
  const pos = (time) => {
    prep(world, time);
    return o.node.getWorldPosition(new THREE.Vector3());
  };
  let t0 = t, t1 = t + dt;
  if (world.duration !== undefined && t1 > world.duration) { t1 = t; t0 = t - dt; }
  const p0 = pos(t0);
  const p1 = pos(t1);
  const dx = p1.x - p0.x, dz = p1.z - p0.z;
  const mps = Math.hypot(dx, dz) / (t1 - t0);
  return { mps, mph: mps * MPS_TO_MPH };
}

// Skid start: explicit skid.startTime if given, else the time of peak speed (just before braking).
function skidStartTime(world, skid) {
  for (const k of ['startTime', 'start', 't0', 't']) if (typeof skid[k] === 'number') return { t: skid[k], explicit: true };
  let best = 0, bestT = 0;
  const dur = world.duration || 10;
  for (let t = 0; t <= dur + 1e-9; t += 0.1) {
    const s = speedAt(world, skid.vehicle, Math.min(t, dur)).mps;
    if (s > best) { best = s; bestT = t; }
  }
  return { t: bestT, explicit: false };
}

export function timingCheck(world) {
  const results = [];
  for (const skid of world.skids || []) {
    const mu = skid.mu ?? 0.7;
    const min = skidSpeed(skid.length, mu);
    const { t, explicit } = skidStartTime(world, skid);
    const sp = speedAt(world, skid.vehicle, t);
    const threshold = min.mps * 0.9;
    const pass = sp.mps >= threshold;
    const label = world.objects[skid.vehicle]?.label || skid.vehicle;
    const detail =
      `A ${skid.length} m skid (mu ${mu}) means ${label} was going at least ${r1(min.mph)} mph (${r1(min.mps)} m/s) when it started braking. ` +
      `In the reconstructed world ${skid.vehicle} moves at ${r1(sp.mph)} mph at t=${r1(t)}s${explicit ? '' : ' (peak pre-braking speed)'}. ` +
      (pass
        ? `That is consistent with the skid (skid gives a minimum; 10% tolerance).`
        : `That is too slow for the skid evidence: the world needs at least ${r1(threshold * MPS_TO_MPH)} mph.`);
    results.push({ vehicle: skid.vehicle, t, required: min, actual: sp, pass, detail, citation: skid.citation || '' });
  }
  return results;
}

function shortName(name) {
  return String(name || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function robustnessSentence(rb, nm) {
  if (!rb) return '';
  const where = `within ${rb.radiusM} m of ${nm}'s mark`;
  if (rb.blocked === 0) return ` Clear from all ${rb.samples} positions ${where}.`;
  const base = ` Blocked from ${rb.blocked} of ${rb.samples} positions ${where}`;
  return rb.blocked < rb.samples ? `${base}; the result depends on ${nm}'s exact position.` : `${base}.`;
}

function gazeSentence(gz) {
  if (!gz) return '';
  const tags = [];
  if (gz.peripheral) tags.push('peripheral');
  if (gz.assumed) tags.push(`gaze assumed toward ${gz.source}`);
  return `; target ${Math.round(gz.offAxisDeg)}° from gaze${tags.length ? ` (${tags.join('; ')})` : ''}`;
}

function timingResults(world) {
  if (typeof physics.prtAll !== 'function') return [];
  let items = [];
  try { items = physics.prtAll(world) || []; } catch (e) { return [{ check: 'timing', subject: 'world', pass: false, detail: `Could not evaluate perception-reaction timing: ${e.message}`, citation: '' }]; }
  return items.map((r) => {
    const prt = r.prt || { availableS: r.availableS ?? null, rangeS: r.rangeS || [1.0, 2.5], typicalS: r.typicalS ?? 1.5, verdict: r.verdict || 'unverifiable' };
    // SPEC: a "timing" result carrying a nested prt object. pass=false only when time was insufficient.
    return {
      ...r,
      check: 'timing', subject: r.subject || r.observerId || 'world',
      pass: typeof r.pass === 'boolean' ? r.pass : prt.verdict !== 'insufficient',
      detail: r.detail || '', citation: r.citation || r.impactSource || '',
      target: r.targetId ?? r.target ?? null,
      prt,
    };
  });
}

export function runAll(world) {
  const out = [];
  for (const w of world.witnesses || []) {
    const target = w.lookAt;
    const tLabel = Array.isArray(target) ? 'the marked point' : target;
    const t = w.observationTime ?? 0;
    const nm = shortName(w.name) || w.id;
    let r;
    try {
      r = sightline(world, w.id, target, t);
    } catch (e) {
      out.push({ check: 'sightline', subject: w.id, pass: false, detail: `Could not evaluate sight line for ${nm}: ${e.message}`, citation: w.citation || '' });
      continue;
    }
    let robustness = null, gaze = null;
    try { robustness = sightlineRobustness(world, w.id, target, t); } catch { robustness = null; }
    try { gaze = gazeAngle(world, w.id, target, t); } catch { gaze = null; }
    const claim = w.claim ? ` Claim: "${w.claim}"` : '';
    const dist = `${r1(r.distance)} m`;
    const head = `From ${nm}'s marked position (${w.citation})`;
    const detail = r.visible
      ? `${head} ${nm} had line of sight to ${tLabel} at t=${r1(t)}s (distance ${dist})${gazeSentence(gaze)}.${robustnessSentence(robustness, nm)}${claim}`
      : `${head} the line of sight to ${tLabel} is blocked by ${r.blockedBy} at t=${r1(t)}s (distance ${dist}).${robustnessSentence(robustness, nm)}${claim}`;
    out.push({ check: 'sightline', subject: w.id, pass: r.visible, detail, citation: w.citation || '', blockedBy: r.blockedBy, target: tLabel, t, distance: r.distance, from: r.from, to: r.to, hitPoint: r.hitPoint, robustness, gaze });
  }
  for (const s of timingCheck(world)) {
    const res = { check: 'skid_vs_speed', subject: s.vehicle, pass: s.pass, detail: s.detail, citation: s.citation, t: s.t, requiredMph: s.required.mph, actualMph: s.actual.mph };
    if (typeof physics.skidRange === 'function') {
      try {
        const len = (world.skids || []).find((k) => k.vehicle === s.vehicle)?.length;
        res.range = physics.skidRange(len);
        res.detail += ` Across friction ${res.range.mu[0]}-${res.range.mu[1]} the minimum is ${r1(res.range.mph[0])}-${r1(res.range.mph[1])} mph.`;
      } catch { /* leave without range */ }
    }
    out.push(res);
  }
  out.push(...timingResults(world));
  if (typeof physics.plausibilityCheck === 'function') {
    try { out.push(...(physics.plausibilityCheck(world) || [])); }
    catch (e) { out.push({ check: 'plausibility', subject: 'world', pass: false, maxAccelG: null, maxSpeedMph: null, issues: [e.message], detail: `Could not evaluate plausibility: ${e.message}` }); }
  }
  return out;
}
