// Sightline SUN GLARE check. Pure math: no rendering. Sun position from the NOAA algorithm in web/assets/environment.js.
//
// glareCheck(world, witnessOrDriverId, targetId, t, {date, lat, lon, timeOfDay?, utcOffset?, thresholdDeg=15, maxElevationDeg=30})
//   witnessOrDriverId: a witness id (eye = position + eyeHeight) OR a vehicle object id (driver eye from
//                      node.userData.driverEye if present, else an assumed left-hand-drive eye point; see detail).
//   targetId: object id, [x,y,z], or null (vehicle: look straight ahead along its heading; witness: use witness.lookAt).
//   t: event-clock seconds (world.setTime(t) is called).
//   date: the case's wall-clock moment of t, e.g. '2016-05-07T16:36:12-04:00' (or date '2016-05-07' + timeOfDay '16:36').
//         Optional opts.tZero: seconds on the event clock that `date` corresponds to (default: date is the moment of t).
// returns { sunAngleFromSightlineDeg, glareRisk, sunAzimuthDeg, sunElevationDeg, sightlineAzimuthDeg, sightlineElevationDeg,
//           eye, aim, when, assumptions[], detail }
//   glareRisk = sun above the horizon && angle < thresholdDeg (15) && sun elevation < maxElevationDeg (30).
//   15 deg / 30 deg are the screening thresholds requested by the case team (low sun close to the line of sight);
//   a windshield sun visor typically blocks a sun higher than ~25-30 deg for a seated driver.
import * as THREE from 'three';
import { solarPosition, resolveDate, sunDirection } from '../web/assets/environment.js';

const R2D = 180 / Math.PI;
const r2 = (x) => Math.round(x * 100) / 100;

function aimPointOf(obj) {
  const box = new THREE.Box3().setFromObject(obj.node);
  if (box.isEmpty()) return obj.node.getWorldPosition(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  if (obj.kind === 'signal' || size.y > 3) c.y = Math.max(box.min.y, box.max.y - 0.15);
  return c;
}

function resolveEye(world, id, assumptions) {
  const w = (world.witnesses || []).find((x) => x.id === id);
  if (w) {
    const eye = new THREE.Vector3(w.position[0], w.eyeHeight ?? 1.6, w.position[2]);
    return { eye, kind: 'witness', witness: w, label: w.name || w.id };
  }
  const o = world.objects?.[id];
  if (!o) throw new Error(`glareCheck: unknown witness or vehicle "${id}"`);
  const node = o.node;
  let local;
  if (Array.isArray(node.userData?.driverEye)) {
    local = new THREE.Vector3(...node.userData.driverEye);
  } else {
    // front = local -Z (SPEC). Left-hand drive: driver sits left of centre (local -X), ~0.3 m behind the vehicle centre,
    // eye ~1.15 m for a car (scaled to the vehicle height for taller vehicles, capped at 2.4 m for a truck cab).
    const box = new THREE.Box3().setFromObject(node);
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    const lb = box.clone().applyMatrix4(inv);
    const h = lb.max.y - lb.min.y;
    const halfW = (lb.max.x - lb.min.x) / 2;
    const eyeY = h < 1.7 ? Math.min(1.15, 0.8 * h) : Math.min(2.4, 0.62 * h);
    const len = lb.max.z - lb.min.z;
    const zEye = h < 1.7 ? 0.3 : lb.min.z + Math.min(1.6, 0.3 * len) - (lb.min.z + lb.max.z) / 2;
    local = new THREE.Vector3(-0.45 * halfW, eyeY, zEye);
    assumptions.push(`driver eye assumed at local [${local.toArray().map((v) => v.toFixed(2)).join(', ')}] (no userData.driverEye)`);
  }
  const eye = local.clone().applyMatrix4(node.matrixWorld);
  return { eye, kind: 'driver', node, label: o.label || id };
}

export function glareCheck(world, witnessOrDriverId, targetId, t, opts = {}) {
  const { lat, lon } = opts;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('glareCheck: lat/lon required');
  if (opts.date === undefined) throw new Error('glareCheck: date required (case wall-clock time, with UTC offset)');
  const thr = opts.thresholdDeg ?? 15;
  const maxEl = opts.maxElevationDeg ?? 30;
  const assumptions = [];
  if (t !== undefined && t !== null && world.setTime) world.setTime(t);
  world.root?.updateMatrixWorld?.(true);

  const r = resolveDate(opts.date, opts.timeOfDay, opts.utcOffset, lon);
  if (r.assumedOffset) assumptions.push(`UTC offset not given; assumed ${r.utcOffsetMin / 60} h from longitude (no DST)`);
  const when = new Date(r.date.getTime() + ((t ?? 0) - (opts.tZero ?? (t ?? 0))) * 1000);
  const sp = solarPosition(when, lat, lon);

  const E = resolveEye(world, witnessOrDriverId, assumptions);
  let aim;
  let tgt = targetId;
  if ((tgt === undefined || tgt === null) && E.kind === 'witness') tgt = E.witness.lookAt;
  if (Array.isArray(tgt)) aim = new THREE.Vector3(...tgt);
  else if (typeof tgt === 'string') {
    const o = world.objects?.[tgt];
    if (!o) throw new Error(`glareCheck: unknown target "${tgt}"`);
    aim = aimPointOf(o);
  } else if (E.kind === 'driver') {
    const fwd = new THREE.Vector3(0, 0, -1).transformDirection(E.node.matrixWorld);
    fwd.y = 0; fwd.normalize();
    aim = E.eye.clone().addScaledVector(fwd, 50);
    assumptions.push('no target: driver looking straight ahead along the vehicle heading');
  } else throw new Error('glareCheck: target required');

  const v = aim.clone().sub(E.eye);
  const dist = v.length();
  v.normalize();
  const sightAz = ((Math.atan2(v.x, -v.z) * R2D) % 360 + 360) % 360;
  const sightEl = Math.asin(Math.max(-1, Math.min(1, v.y))) * R2D;
  const s = new THREE.Vector3(...sunDirection(sp.azimuthDeg, sp.elevationDeg));
  const angle = Math.acos(Math.max(-1, Math.min(1, v.dot(s)))) * R2D;
  const sunUp = sp.elevationDeg > -0.833;
  const glareRisk = sunUp && angle < thr && sp.elevationDeg < maxEl;

  const fmtLocal = (d) => {
    const x = new Date(d.getTime() + r.utcOffsetMin * 60000);
    const sign = r.utcOffsetMin < 0 ? '-' : '+';
    const a = Math.abs(r.utcOffsetMin);
    return x.toISOString().slice(0, 19) + sign + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0');
  };
  let why;
  if (!sunUp) why = 'sun below the horizon (no direct sun glare possible)';
  else if (glareRisk) why = `low sun (${r2(sp.elevationDeg)} deg) within ${thr} deg of the line of sight`;
  else if (angle >= thr && sp.elevationDeg >= maxEl) why = `sun ${r2(angle)} deg off the line of sight and ${r2(sp.elevationDeg)} deg high`;
  else if (angle >= thr) why = `sun ${r2(angle)} deg off the line of sight (>= ${thr})`;
  else why = `sun near the line of sight but ${r2(sp.elevationDeg)} deg high (>= ${maxEl}; above a typical visor/brow cut-off)`;
  const detail = `${E.label} at t=${t}s (${fmtLocal(when)}), looking toward ${typeof tgt === 'string' ? tgt : 'point'} ` +
    `(bearing ${r2(sightAz)} deg, ${r2(sightEl)} deg up, ${r2(dist)} m). Sun az ${r2(sp.azimuthDeg)} deg, el ${r2(sp.elevationDeg)} deg ` +
    `(NOAA, ${lat}, ${lon}). Angle sun-to-sightline ${r2(angle)} deg -> ${glareRisk ? 'GLARE RISK' : 'no glare risk'}: ${why}.`;

  return {
    sunAngleFromSightlineDeg: r2(angle), glareRisk,
    sunAzimuthDeg: r2(sp.azimuthDeg), sunElevationDeg: r2(sp.elevationDeg),
    sightlineAzimuthDeg: r2(sightAz), sightlineElevationDeg: r2(sightEl), distanceM: r2(dist),
    eye: E.eye.toArray().map(r2), aim: aim.toArray().map(r2), when: fmtLocal(when),
    thresholds: { angleDeg: thr, maxSunElevationDeg: maxEl }, assumptions, detail,
  };
}
