// run_task.mjs — ONE verification task, executed inside a Gemini Managed Agent sandbox (or locally for parity tests).
//   node run_task.mjs --repo /workspace/repo --world /workspace/job/world.js --task '<json>' --out /workspace/job/out/result.json
// Task JSON: { id, type, witness?, target?, params? }  type ∈ full_checks | sightline | robustness | gaze | prt | whatif_speed | whatif_time
// Uses the repo's own checks/ code (cloned from GitHub main) against the world file uploaded with the task.
// Pure Node + three; no GPU, no browser, no network after `npm i three`. Writes one JSON file and prints it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const REPO = path.resolve(arg('repo', '/workspace/repo'));
const WORLD = path.resolve(arg('world', 'world.js'));
const OUT = path.resolve(arg('out', 'out/result.json'));
const task = JSON.parse(arg('task-file') ? fs.readFileSync(arg('task-file'), 'utf8') : arg('task', '{"type":"full_checks"}'));
const imp = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);
const sha = (f) => { try { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 12); } catch { return null; } };
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x);

const t0 = Date.now();
const { instantiateWorld, THREE } = await imp('checks/load_world.js');
const checks = await imp('checks/checks.js');
const rob = await imp('checks/robustness.js');
const physics = await imp('checks/physics.js');
const world = await instantiateWorld(await import(pathToFileURL(WORLD).href));
const W = (id) => (world.witnesses || []).find((w) => w.id === id);
const impact = (() => { try { return physics.impactTimeOf(world); } catch { return null; } })();
const T = world.duration || 20;

function sightAt(w, target, t) {
  const s = checks.sightline(world, w.id, target, t);
  return { t: r2(t), visible: s.visible, blockedBy: s.blockedBy || null, distance: r2(s.distance) };
}

function run() {
  const w = task.witness ? W(task.witness) : null;
  if (task.witness && !w) throw new Error(`unknown witness ${task.witness}`);
  const target = task.target ?? w?.lookAt;
  const tObs = task.params?.t ?? w?.observationTime ?? 0;
  switch (task.type) {
    case 'full_checks': // same as `node checks/run_checks.mjs <world>`
      return { checks: checks.runAll(world).map(({ check, subject, pass, blockedBy, t, robustness, gaze, verdict, availableS, requiredMph, actualMph }) =>
        ({ check, subject, pass, blockedBy, t, robustness: robustness?.verdict, blocked: robustness?.blocked, gazeDeg: gaze?.offAxisDeg, verdict, availableS, requiredMph, actualMph })) };
    case 'sightline': { // ray-cast at the observation time + a visibility timeline over the event
      const at = sightAt(w, target, tObs);
      const timeline = [];
      for (let t = 0; t <= T + 1e-9; t += 0.25) timeline.push(sightAt(w, target, t));
      const vis = timeline.filter((s) => s.visible).map((s) => s.t);
      return { target, tObs, at, firstVisibleT: vis[0] ?? null, lastVisibleT: vis.at(-1) ?? null, visibleSteps: vis.length, steps: timeline.length,
        timeline: timeline.map((s) => [s.t, s.visible ? 1 : 0, s.blockedBy]) };
    }
    case 'robustness': { // the standard 25-position 2 m disc, plus wider discs to find where the verdict flips
      const std = rob.sightlineRobustness(world, w.id, target, tObs);
      const [ex, ey, ez] = checks.witnessEye(w);
      checks.prep(world, tObs);
      const resolved = checks.resolveTarget(world, target);
      const rings = [];
      for (const R of [0.5, 1, 2, 3, 5, 8]) {
        let blocked = 0; const by = {};
        const offs = rob.robustnessOffsets(R);
        for (const o of offs) {
          const r = checks.castRay(world, [ex + o.dx, ey + o.dy, ez + o.dz], target, tObs, { prepared: true, resolved });
          if (!r.visible) { blocked++; by[r.blockedBy] = (by[r.blockedBy] || 0) + 1; }
        }
        rings.push({ radiusM: R, samples: offs.length, blocked, blockers: by });
      }
      return { target, tObs, standard: std, rings };
    }
    case 'gaze': { // angle between assumed/explicit gaze and the target, plus alternates
      const g = rob.gazeAngle(world, w.id, target, tObs);
      checks.prep(world, tObs);
      const eye = new THREE.Vector3(...checks.witnessEye(w));
      const toT = checks.resolveTarget(world, target).to.clone().sub(eye);
      const alts = {};
      for (const [id, o] of Object.entries(world.objects || {})) {
        if (!(id.startsWith('mark_') || o.kind === 'mark')) continue;
        const d = checks.resolveTarget(world, id).to.clone().sub(eye);
        if (d.lengthSq() > 1e-9) alts[id] = r2(d.angleTo(toT) * 180 / Math.PI);
      }
      return { target, tObs, gaze: g, altGazeDegByMark: alts };
    }
    case 'prt': { // perception-reaction time available to each driver (physics.prtAll), optionally filtered
      const all = physics.prtAll(world).map(({ observerId, targetId, availableS, verdict, firstVisibleT, impactT, blockedBy, detail }) =>
        ({ observerId, targetId, availableS: r2(availableS), verdict, firstVisibleT: r2(firstVisibleT), impactT: r2(impactT), blockedBy, detail }));
      return { impact, prt: task.witness ? all.filter((p) => p.observerId === task.witness) : all };
    }
    case 'whatif_speed': { // target vehicle k× faster/slower, same impact time & place: position at tObs = track(tImp - k·(tImp - tObs))
      const tImp = impact?.t ?? task.params?.impactT;
      if (!Number.isFinite(tImp)) throw new Error('no impact time');
      const ks = task.params?.ks || [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3];
      const sweep = ks.map((k) => {
        const tp = Math.max(0, tImp - k * (tImp - tObs));
        const s = sightAt(w, target, tp);
        let robBlocked = null; try { robBlocked = rob.sightlineRobustness(world, w.id, target, tp).blocked; } catch {}
        return { k, trackT: r2(tp), visible: s.visible, blockedBy: s.blockedBy, distance: s.distance, robustBlockedOf25: robBlocked };
      });
      return { target, tObs, impactT: tImp, impactSource: impact?.source ?? null, sweep,
        note: 'Speed what-if by time remapping along the cited track; other moving objects follow the same remap (approximation).' };
    }
    case 'whatif_time': { // observation-time uncertainty ±2 s
      const ds = task.params?.ds || [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2];
      return { target, tObs, sweep: ds.map((d) => ({ dt: d, ...sightAt(w, target, Math.min(T, Math.max(0, tObs + d))) })) };
    }
    default: throw new Error(`unknown task type ${task.type}`);
  }
}

let result, error = null;
try { result = run(); } catch (e) { error = String(e?.stack || e).slice(0, 800); }
const out = {
  task, ok: !error, error, result,
  env: { host: os.hostname(), node: process.version, cpus: os.cpus().length, ms: Date.now() - t0,
    worldSha: sha(WORLD), checksSha: { 'checks.js': sha(path.join(REPO, 'checks/checks.js')), 'robustness.js': sha(path.join(REPO, 'checks/robustness.js')), 'physics.js': sha(path.join(REPO, 'checks/physics.js')) } },
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ id: task.id, ok: out.ok, ms: out.env.ms, error: error?.split('\n')[0] }));
