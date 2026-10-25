// Sightline physics helpers (CREDIBILITY v1). STUB — shapes final, logic being filled in.
export const KINEMATIC_LABEL = "Kinematic reconstruction: motion fitted to cited evidence; not a crash-physics simulation.";
const G = 9.81, MPS_TO_MPH = 2.2369362920544;
export function skidRange(lengthM) {
  const v = (mu) => Math.sqrt(2 * mu * G * lengthM);
  const mps = [v(0.6), v(0.8)];
  return { mu: [0.6, 0.8], mph: mps.map((x) => x * MPS_TO_MPH), mps };
}
export function prtCheck(world, { observerId, targetId, impactT } = {}) {
  return { availableS: null, rangeS: [1.0, 2.5], typicalS: 1.5, verdict: 'unverifiable', observerId, targetId, impactT: impactT ?? null, detail: 'PRT check not yet implemented.' };
}
export function prtAll(world) { return []; }
export function plausibilityCheck(world) { return []; }
