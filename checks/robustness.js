// Sightline credibility checks: position robustness + gaze angle (SPEC "CREDIBILITY v1").
// Independent geometry only; reuses the ray-cast from checks.js. No case-specific data.
import * as THREE from 'three';
import { castRay, findWitness, prep, resolveTarget, witnessEye, observerVehicles } from './checks.js';

export const ROBUST_RADIUS_M = 2;
export const ROBUST_SAMPLES = 25;
export const EYE_JITTER_M = 0.1;
export const CAMERA_FOV_DEG = 60;
export const PERIPHERAL_DEG = 30;

// 25 deterministic offsets in a disc of radius R: centre + 8 at R/2 + 16 at R (outer ring staggered).
// Eye height alternates +jitter / -jitter by sample index.
export function robustnessOffsets(radiusM = ROBUST_RADIUS_M, jitterM = EYE_JITTER_M) {
  const pts = [[0, 0]];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 2 * Math.PI;
    pts.push([(radiusM / 2) * Math.cos(a), (radiusM / 2) * Math.sin(a)]);
  }
  for (let i = 0; i < 16; i++) {
    const a = ((i + 0.5) / 16) * 2 * Math.PI;
    pts.push([radiusM * Math.cos(a), radiusM * Math.sin(a)]);
  }
  return pts.map(([dx, dz], i) => ({ dx, dz, dy: i % 2 === 0 ? jitterM : -jitterM }));
}

export function sightlineRobustness(world, witnessId, targetId, t) {
  const w = findWitness(world, witnessId);
  prep(world, t);
  const resolved = resolveTarget(world, targetId);
  const [ex, ey, ez] = witnessEye(w);
  const offsets = robustnessOffsets();
  const exclude = observerVehicles(world, w);   // own vehicle never blocks, also for jittered eye samples
  let blocked = 0;
  const blockers = {};
  for (const o of offsets) {
    const r = castRay(world, [ex + o.dx, ey + o.dy, ez + o.dz], targetId, t, { prepared: true, resolved, exclude });
    if (!r.visible) {
      blocked++;
      blockers[r.blockedBy] = (blockers[r.blockedBy] || 0) + 1;
    }
  }
  const n = offsets.length;
  const verdict = blocked === n ? 'robust' : blocked === 0 ? 'not_blocked' : 'partial';
  return {
    radiusM: ROBUST_RADIUS_M, samples: n, blocked, clear: n - blocked, eyeJitterM: EYE_JITTER_M, verdict,
    blockers,
  };
}

function findImpactPoint(world) {
  for (const [id, o] of Object.entries(world.objects || {})) {
    if (!o || !o.node) continue;
    const isMark = id.startsWith('mark_') || o.kind === 'mark';
    if (isMark && /impact|poi\b/i.test(`${id} ${o.label || ''}`)) return id;
  }
  return null;
}

// Gaze angle at time t between where the witness was looking and the direction to the target.
// Gaze source, in order: witness.gaze ([x,y,z] or object id), witness.heading (radians, rotation.y
// convention: CCW from north toward west), witness.lookAt when it is a point or a different object
// than the target. Otherwise the gaze is ASSUMED: toward the impact mark if the world has one,
// else toward the target's position at t=0.
export function gazeAngle(world, witnessId, targetId, t) {
  const w = findWitness(world, witnessId);
  const eye = new THREE.Vector3(...witnessEye(w));
  let gazeDir = null, assumed = false, source = '';

  // assumed fallback toward target at t=0 must be sampled before setting time t
  const sameAsTarget = (g) => g === undefined || g === null || (!Array.isArray(g) && g === targetId);
  const explicitGaze = !sameAsTarget(w.gaze) ? w.gaze : null;
  const hasHeading = typeof w.heading === 'number';
  const lookAtUsable = !sameAsTarget(w.lookAt) ? w.lookAt : null;
  const impactId = findImpactPoint(world);
  let t0Point = null;
  if (explicitGaze === null && !hasHeading && lookAtUsable === null && !(impactId && impactId !== targetId)) {
    prep(world, 0);
    t0Point = resolveTarget(world, targetId).to.clone();
  }

  prep(world, t);
  const toward = (g) => resolveTarget(world, g).to.clone().sub(eye);
  if (explicitGaze !== null) { gazeDir = toward(explicitGaze); source = Array.isArray(explicitGaze) ? 'gaze point' : String(explicitGaze); }
  else if (hasHeading) { gazeDir = new THREE.Vector3(-Math.sin(w.heading), 0, -Math.cos(w.heading)); source = 'heading'; }
  else if (lookAtUsable !== null) { gazeDir = toward(lookAtUsable); source = Array.isArray(lookAtUsable) ? 'marked point' : String(lookAtUsable); }
  else if (impactId && impactId !== targetId) { gazeDir = toward(impactId); assumed = true; source = impactId; }
  else { gazeDir = t0Point.sub(eye); assumed = true; source = 'target at t=0'; }

  const toTarget = resolveTarget(world, targetId).to.clone().sub(eye);
  let offAxisDeg = 0;
  if (gazeDir.lengthSq() > 1e-12 && toTarget.lengthSq() > 1e-12) offAxisDeg = THREE.MathUtils.radToDeg(gazeDir.angleTo(toTarget));
  offAxisDeg = Math.round(offAxisDeg * 10) / 10;
  return { offAxisDeg, assumed, cameraFovDeg: CAMERA_FOV_DEG, peripheral: offAxisDeg > PERIPHERAL_DEG, source };
}
