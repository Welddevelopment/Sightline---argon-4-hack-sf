// Sightline independent geometry/physics checks. Node ES module; depends only on three.
import * as THREE from 'three';

const G = 9.81;
const MPS_TO_MPH = 2.2369362920544;
const r1 = (x) => Math.round(x * 10) / 10;

function prep(world, t) {
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
function aimPoint(obj) {
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

function findWitness(world, id) {
  const w = (world.witnesses || []).find((x) => x.id === id);
  if (!w) throw new Error(`Unknown witness ${id}`);
  return w;
}

export function sightline(world, witnessId, targetId, t) {
  prep(world, t);
  const w = findWitness(world, witnessId);
  const eye = new THREE.Vector3(w.position[0], w.eyeHeight ?? w.position[1] ?? 1.6, w.position[2]);

  let to, targetNode = null;
  if (Array.isArray(targetId)) {
    to = new THREE.Vector3(...targetId);
  } else {
    const tgt = world.objects[targetId];
    if (!tgt) throw new Error(`Unknown target ${targetId}`);
    targetNode = tgt.node;
    to = aimPoint(tgt);
  }

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
    const claim = w.claim ? ` Claim: "${w.claim}"` : '';
    const dist = `${r1(r.distance)} m`;
    const detail = r.visible
      ? `From ${nm}'s marked position (${w.citation}) the line of sight to ${tLabel} is clear at t=${r1(t)}s (distance ${dist}).${claim}`
      : `From ${nm}'s marked position (${w.citation}) the line of sight to ${tLabel} is blocked by ${r.blockedBy} at t=${r1(t)}s (distance ${dist}).${claim}`;
    out.push({ check: 'sightline', subject: w.id, pass: r.visible, detail, citation: w.citation || '', blockedBy: r.blockedBy, target: tLabel, t, distance: r.distance, from: r.from, to: r.to, hitPoint: r.hitPoint });
  }
  for (const s of timingCheck(world)) {
    out.push({ check: 'skid_vs_speed', subject: s.vehicle, pass: s.pass, detail: s.detail, citation: s.citation, t: s.t, requiredMph: s.required.mph, actualMph: s.actual.mph });
  }
  return out;
}
