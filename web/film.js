// Sightline shot rig (owner: SHOT RIG). Renders a case world as a short film in a forensic studio's shot grammar:
// title cards, constant-speed orbits, top-down tracking, chase (with freeze), witness POV (with pan), aerial dissolve.
// Loads the world through the viewer itself (import './viewer.js', ?world=...) and draws the world's own scene with a
// film camera on the viewer's renderer, so lighting/assets/overlays are exactly what the app shows. viewer.js is not edited.
// Deterministic: render/film.mjs calls film.frame(i) for every frame index; no wall clock is involved.
//   URL: film.html?world=/cases/demo/worlds/world_v2.js&quality=interactive[&plan=/cases/demo/plan/shot_plan.json][&play=1]
//   API: await film.ready; film.setup(plan|null, {aerial}) -> timeline; film.frame(i) -> { key, same, shot, ... }
// Plan schema (all fields optional unless noted) is documented in status/shot_rig.md.
import * as THREE from 'three';
import './viewer.js';

const params = new URLSearchParams(location.search);
const sl = window.sl;
try { await import('./overlays.js'); } catch (e) { console.warn('film: overlays.js unavailable, minimal HUD only', e && e.message); }
await sl.ready;

const world = sl.world;
const scene = world.root.parent;
const stage = document.getElementById('stage');

// ---- grab the viewer's renderer from the first render (scene.onBeforeRender receives it) ----
const renderer = await new Promise((res) => {
  const prev = scene.onBeforeRender;
  scene.onBeforeRender = function (r, s, c, rt) { scene.onBeforeRender = prev; if (prev) prev.call(this, r, s, c, rt); res(r); };
  sl.renderFrame();
});
// viewer-initiated renders (inside sl.setTime / sl.setCamera) are suppressed while we drive it: we render once per frame ourselves
const viewerRender = renderer.render;
let suppress = false;
renderer.render = function (s, c) { if (suppress && s === scene) return; return viewerRender.call(this, s, c); };

const persp = new THREE.PerspectiveCamera(50, 16 / 9, 0.2, 4000);
const ortho = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 3000);
const _b = new THREE.Box3(), _v = new THREE.Vector3();
const hasOverlays = () => !!(sl.overlays && typeof sl.overlays.set === 'function');

// ---------- DOM chrome ----------
const el = (tag, id, html = '') => { const e = document.createElement(tag); e.id = id; e.innerHTML = html; stage.appendChild(e); return e; };
const aerialImg = el('img', 'film-aerial');
const blackEl = el('div', 'film-black');
const titleEl = el('div', 'film-title');
const ltEl = el('div', 'film-lt', '<div class="row"><div class="no"></div><div class="tx"><div class="tt"></div><div class="cp"></div></div></div>');
const trEl = el('div', 'film-tr', '<div class="b">SIMULATED RECONSTRUCTION</div><br><div class="m"></div>');
const stampEl = el('div', 'film-stamp');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- world helpers ----------
const clampT = (t) => Math.max(0, Math.min(world.duration, Number(t) || 0));
function withTime(t, fn) {
  const cur = sl.time;
  world.setTime(clampT(t)); world.root.updateMatrixWorld(true);
  try { return fn(); } finally { world.setTime(cur); world.root.updateMatrixWorld(true); }
}
function objCenter(id, out = new THREE.Vector3()) {
  const o = world.objects[id];
  if (!o || !o.node) return null;
  o.node.updateWorldMatrix(true, true);
  _b.setFromObject(o.node);
  return _b.isEmpty() ? o.node.getWorldPosition(out) : _b.getCenter(out);
}
const vehicles = () => Object.entries(world.objects).filter(([, o]) => o.kind === 'vehicle' && o.node).map(([id]) => id);
const witness = (id) => (world.witnesses || []).find((w) => w.id === id) || null;
const eyeOf = (w) => new THREE.Vector3(w.position[0], w.eyeHeight != null ? w.eyeHeight : (w.position[1] || 1.6), w.position[2]);

let impactT = null, impactP = null, primary = null, roi = null;
function analyze() {
  const oi = hasOverlays() && sl.overlays.info ? sl.overlays.info() : null;
  impactT = oi && oi.impact ? oi.impact.t : Number.isFinite(+(world.meta || {}).impactT) ? +world.meta.impactT : world.duration * 0.5;
  // primary = fastest vehicle over the run-up to impact
  let best = -1;
  for (const id of vehicles()) {
    const a = withTime(Math.max(0, impactT - 3), () => objCenter(id)), b = withTime(impactT, () => objCenter(id));
    const d = a && b ? a.distanceTo(b) : 0;
    if (d > best) { best = d; primary = id; }
  }
  const mark = Object.keys(world.objects).find((k) => /impact/i.test(k) && world.objects[k].kind === 'mark');
  impactP = mark ? objCenter(mark) : primary ? withTime(impactT, () => objCenter(primary)) : new THREE.Vector3();
  impactP.y = 0;
  roi = new THREE.Box3().setFromCenterAndSize(impactP, new THREE.Vector3(30, 2, 30));
  for (const id of vehicles()) for (let k = -4; k <= 1; k++) { const p = withTime(impactT + k, () => objCenter(id)); if (p && p.distanceTo(impactP) < 150) roi.expandByPoint(p); }
  for (const w of world.witnesses || []) { const p = eyeOf(w); if (p.distanceTo(impactP) < 120) roi.expandByPoint(p); }
}
// a point spec: [x,y,z] | [x,z] | {x,y,z} | object id | witness id | 'impact' | 'roi'
function point(spec, out = new THREE.Vector3()) {
  if (spec == null) return out.copy(impactP);
  if (Array.isArray(spec)) return spec.length === 2 ? out.set(+spec[0], 0, +spec[1]) : out.set(+spec[0], +spec[1], +spec[2]);
  if (typeof spec === 'object') return out.set(+spec.x || 0, +spec.y || 0, +spec.z || 0);
  if (spec === 'impact') return out.copy(impactP);
  if (spec === 'roi') return roi.getCenter(out);
  if (spec === 'primary' && primary) return objCenter(primary, out);
  if (world.objects[spec]) return objCenter(spec, out);
  const w = witness(spec);
  if (w) return out.copy(eyeOf(w));
  return out.copy(impactP);
}
function headingOf(id, t) { // unit XZ travel direction of an object around t (velocity, fallback to overall)
  const p = (tt) => withTime(tt, () => objCenter(id));
  let d = p(Math.min(world.duration, t + 0.25)).sub(p(Math.max(0, t - 0.25))); d.y = 0;
  if (d.lengthSq() < 1e-4) { d = p(Math.min(world.duration, t)).sub(p(Math.max(0, t - 2))); d.y = 0; }
  if (d.lengthSq() < 1e-4) d.set(1, 0, 0);
  return d.normalize();
}

// ---------- easing ----------
const ease = { linear: (u) => u, inout: (u) => 0.5 - 0.5 * Math.cos(Math.PI * u), in: (u) => 1 - Math.cos(Math.PI * u / 2), out: (u) => Math.sin(Math.PI * u / 2) };
const num = (...xs) => { for (const x of xs) if (x != null && x !== '' && Number.isFinite(+x)) return +x; return undefined; };
const lerp = (a, b, u) => a + (b - a) * u;

// ---------- default plan (case-agnostic: derived from the world) ----------
function defaultPlan() {
  const m = world.meta || {};
  const ws = world.witnesses || [];
  const failing = ws.find((w) => { try { const r = sl.sightline(w.id, w.observationTime != null ? w.observationTime : impactT); return r && !r.visible; } catch (_) { return false; } }) || ws[0];
  const others = vehicles().filter((v) => v !== primary);
  const T = impactT;
  const shots = [
    { id: 'title', type: 'title', duration: 2.5, text: m.title || 'Reconstruction', sub: 'Kinematic reconstruction · simulated', note: m.source || '' },
    { id: 'aerial', type: 'aerial', t: Math.max(0, T - 6), holdStart: 2, duration: 3, holdEnd: 1.5,
      overlay: { title: 'Scene overview', caption: 'Top-down, north up. Positions at t = ' + Math.max(0, T - 6).toFixed(1) + ' s.' } },
    { id: 'orbit', type: 'orbit', target: 'impact', radius: 46, height: 22, startDeg: 200, sweepDeg: 100, duration: 8, t: Math.max(0, T - 6), fov: 50,
      sightline: failing && failing.id, overlay: { title: 'Area of impact', caption: 'Orbit at constant angular speed; scene frozen at t = ' + Math.max(0, T - 6).toFixed(1) + ' s.' } },
    { id: 'topdown', type: 'topdown', frame: [primary, 'impact', ...others.slice(0, 1)], margin: 14, minHalf: 22, sceneTime: [Math.max(0, T - 7), Math.min(world.duration, T + 1)],
      sightline: failing && failing.id, overlay: { title: 'Top-down tracking', caption: 'Vehicle paths to impact (real time). Witness sight lines: green clear, red blocked.' } },
    { id: 'chase', type: 'chase', vehicle: primary, offset: [11, 3.6, 0], lookAhead: 18, fov: 55, sceneTime: [Math.max(0, T - 6), T], freezeAt: T,
      overlay: { title: 'Chase view', caption: 'Camera follows ' + ((world.objects[primary] || {}).label || primary || '').replace(/\s*\(.*$/, '') + '; frozen at impact.' } },
  ];
  if (failing) {
    const ot = failing.observationTime != null ? failing.observationTime : T - 1;
    shots.push({ id: 'pov_' + failing.id, type: 'pov', witness: failing.id, lookAt: failing.lookAt, fov: 60,
      sceneTime: [Math.max(0, Math.min(ot, T) - 4), Math.min(world.duration, Math.max(ot, T))],
      overlay: { title: 'Eye view: ' + String(failing.name || failing.id).replace(/\s*\(fictional\)/i, ''), caption: failing.claim ? '“' + failing.claim + '”' : 'Eye height ' + (failing.eyeHeight || 1.6) + ' m.' } });
    shots.push({ id: 'sight_' + failing.id, type: 'topdown', frame: [failing.id, failing.lookAt || primary], margin: 10, minHalf: 18, t: ot, duration: 0, holdStart: 4, holdEnd: 0,
      sightline: failing.id, overlay: { title: 'Sight line at t = ' + ot.toFixed(1) + ' s', caption: 'Ray from the witness’s eye to the target, checked against every modeled object.' } });
  }
  shots.push({ id: 'end', type: 'title', duration: 2.5, text: 'Simulated reconstruction', sub: 'Fictional witnesses · motion fitted to cited evidence', note: 'Not a crash-physics simulation. Generated by Sightline.' });
  return { title: m.title, fps: 12, shots };
}

// ---------- plan normalisation ----------
const TYPE_ALIAS = { card: 'title', title_card: 'title', text: 'title', orbit: 'orbit', topdown: 'topdown', top_down: 'topdown', overhead: 'topdown', tracking: 'topdown',
  chase: 'chase', follow: 'chase', pov: 'pov', eye: 'pov', witness: 'pov', aerial: 'aerial', aerial_dissolve: 'aerial', dissolve: 'aerial', keyframes: 'keyframes', path: 'keyframes', static: 'keyframes' };
let plan = null, shots = [], fps = 12, nFrames = 0, aerial = null;

function normShot(s, i) {
  const type = TYPE_ALIAS[String(s.type || s.kind || 'keyframes').toLowerCase()] || 'keyframes';
  const sh = { ...s, type, index: i, id: s.id || type + '_' + (i + 1) };
  const st = s.sceneTime || s.scene_time || s.timeRange || s.t_range || s.sceneT;
  let t0 = Array.isArray(st) ? +st[0] : num(s.t, s.time, s.sceneT0, s.sceneStart);
  let t1 = Array.isArray(st) ? +st[1] : num(s.sceneT1, s.sceneEnd);
  if (t0 == null) t0 = type === 'title' ? 0 : impactT;
  if (t1 == null) t1 = t0;
  if (s.freezeAt != null) t1 = Math.min(t1, +s.freezeAt);
  sh.t0 = clampT(t0); sh.t1 = clampT(Math.max(t0, t1));
  sh.speed = num(s.speed, s.playbackRate) || 1;
  const holds = s.holds || s.hold || {};
  const hs = typeof holds === 'number' ? holds : num(holds.start, holds[0]);
  const he = typeof holds === 'number' ? holds : num(holds.end, holds[1]);
  if (type === 'title') { sh.holdStart = 0; sh.holdEnd = 0; sh.motion = num(s.duration, s.seconds) ?? 2; }
  else {
    sh.holdStart = num(s.holdStart, s.hold_start, hs) ?? 3;
    sh.holdEnd = num(s.holdEnd, s.hold_end, s.freezeHold, he) ?? 3;
    // motion length: explicit duration, else the scene-time span at playback speed
    const span = (sh.t1 - sh.t0) / sh.speed;
    sh.motion = num(s.duration, s.motionDuration, s.seconds) ?? (span > 0 ? span : (type === 'aerial' ? 2.5 : 6));
    if (type === 'aerial' && s.dissolve != null) sh.motion = +s.dissolve;
  }
  sh.total = sh.holdStart + sh.motion + sh.holdEnd;
  // overlay text
  const ov = s.overlay != null ? s.overlay : s.overlayText != null ? s.overlayText : s.caption != null ? s.caption : null;
  sh.ov = typeof ov === 'string' ? { title: s.label || '', caption: ov } : Array.isArray(ov) ? { title: s.label || '', items: ov } : { ...(ov || {}) };
  if (sh.ov.text && !sh.ov.caption) sh.ov.caption = sh.ov.text;
  if (sh.ov.title == null) sh.ov.title = s.label || s.name || '';
  sh.hud = s.hud != null ? !!s.hud : sh.ov.hud != null ? !!sh.ov.hud : true;
  sh.ease = ease[s.easing] || (type === 'orbit' ? ease.linear : ease.inout);
  return sh;
}

function setup(p, opts = {}) {
  analyze();
  aerial = opts.aerial || null;
  plan = p && Array.isArray(p.shots) && p.shots.length ? p : defaultPlan();
  fps = num(opts.fps, plan.fps) || 12;
  shots = plan.shots.map(normShot);
  let f = 0, no = 0;
  for (const s of shots) {
    s.no = s.type === 'title' ? null : ++no;
    s.start = f; s.n = Math.max(1, Math.round(s.total * fps)); f += s.n;
    // key frame (local frame index): chase/pov -> end of motion (freeze / critical instant); aerial -> end of dissolve; else mid motion
    const kf = s.keyAt != null ? (+s.keyAt <= 1 ? s.holdStart + s.motion * +s.keyAt : +s.keyAt)
      : s.type === 'chase' || s.type === 'pov' ? s.holdStart + s.motion + Math.min(0.5, s.holdEnd / 2)
      : s.type === 'aerial' ? s.holdStart + s.motion * 0.55 : s.type === 'title' ? s.motion / 2 : s.holdStart + s.motion / 2;
    s.key = s.start + Math.min(s.n - 1, Math.max(0, Math.round(kf * fps)));
  }
  nFrames = f;
  if (aerial && aerial.url) { aerialImg.src = aerial.url; }
  return info();
}
const info = () => ({ fps, frames: nFrames, seconds: +(nFrames / fps).toFixed(2), impactT, primary, aerial: !!(aerial && aerial.url), planTitle: plan && plan.title,
  shots: shots.map((s) => ({ id: s.id, type: s.type, start: s.start, n: s.n, key: s.key, t0: s.t0, t1: s.t1, holdStart: s.holdStart, motion: s.motion, holdEnd: s.holdEnd })) });

// ---------- camera solving ----------
// returns { cam: 'persp'|'ortho', pos, target, up, fov, half, mode, aerialOpacity }
function poseFor(s, u, t, tau) {
  const fov = num(s.fov, s.camera && s.camera.fov) || 50;
  // explicit camera keyframes override the type's built-in move
  const keys = s.keyframes || s.keys || (s.camera && (s.camera.keyframes || s.camera.keys));
  if (Array.isArray(keys) && keys.length) return keyPose(s, keys, u, t, fov);
  switch (s.type) {
    case 'orbit': {
      const c = point(s.target || s.center || 'impact');
      const r = num(s.radius) ?? 45;
      const elevDeg = num(s.elevationDeg, s.elevation);
      const h = num(s.height) ?? (elevDeg != null ? r * Math.tan(elevDeg * Math.PI / 180) : r * 0.45);
      const a0 = num(s.startDeg, s.azimuthDeg, s.bearingDeg) ?? 200, sw = num(s.sweepDeg, s.sweep) ?? 90;
      const az = (a0 + sw * u) * Math.PI / 180; // compass bearing from target to camera: 0 = north (-Z), 90 = east (+X)
      const pos = new THREE.Vector3(c.x + Math.sin(az) * r, c.y + h, c.z - Math.cos(az) * r);
      const tgt = c.clone(); tgt.y += num(s.targetHeight) ?? 1;
      return { cam: 'persp', pos, target: tgt, fov, mode: s.mode || modeVeh(s) };
    }
    case 'topdown': {
      let c, half;
      const ids = s.frame || s.fit;
      if (Array.isArray(ids) && ids.length) {
        const b = new THREE.Box3();
        for (const id of ids.filter(Boolean)) b.expandByPoint(point(id));
        b.expandByScalar(num(s.margin) ?? 12);
        c = b.getCenter(new THREE.Vector3());
        const sz = b.getSize(new THREE.Vector3()), a = aspect();
        half = Math.max(sz.z / 2, sz.x / 2 / a, num(s.minHalf) ?? 20);
      } else {
        c = s.follow ? point(s.follow) : s.center ? point(Array.isArray(s.center) && s.centerEnd ? lerpArr(s.center, s.centerEnd, u) : s.center) : roi.getCenter(new THREE.Vector3());
        if (s.offset) { c.x += +s.offset[0] || 0; c.z += +(s.offset.length === 2 ? s.offset[1] : s.offset[2]) || 0; }
        half = num(s.halfHeight, s.half) ?? (s.height ? +s.height * Math.tan(fov * Math.PI / 360) : 40);
        if (s.halfHeightEnd != null) half = lerp(half, +s.halfHeightEnd, u);
      }
      if (s.ortho === false || s.perspective) {
        const hgt = half / Math.tan(fov * Math.PI / 360);
        return { cam: 'persp', pos: new THREE.Vector3(c.x, hgt, c.z + 0.001), target: new THREE.Vector3(c.x, 0, c.z), up: [0, 0, -1], fov, mode: s.mode || 'overhead' };
      }
      return { cam: 'ortho', pos: new THREE.Vector3(c.x, 400, c.z), target: new THREE.Vector3(c.x, 0, c.z), up: [0, 0, -1], half, mode: s.mode || 'overhead' };
    }
    case 'chase': {
      const vid = s.vehicle || s.target || primary;
      const p = point(vid);
      const d = headingOf(vid, t);
      const off = s.offset || [11, 3.6, 0]; // [behind, up, right]
      const right = new THREE.Vector3(-d.z, 0, d.x);
      const pos = p.clone().addScaledVector(d, -(+off[0])).add(new THREE.Vector3(0, +off[1], 0)).addScaledVector(right, +off[2] || 0);
      const tgt = p.clone().addScaledVector(d, num(s.lookAhead) ?? 16); tgt.y = num(s.targetHeight) ?? 1.0;
      return { cam: 'persp', pos, target: tgt, fov: num(s.fov) || 55, mode: s.mode || 'chase_' + vid };
    }
    case 'pov': {
      const w = s.witness ? witness(s.witness) : null;
      const pos = s.position ? point(s.position) : w ? eyeOf(w) : point('roi').setY(1.6);
      const look = s.lookAt != null ? s.lookAt : w ? w.lookAt : 'impact';
      // tracking an object follows it in time unless track:false (then aimed where it was at the shot's first instant)
      let tgt = s.track === false && typeof look === 'string' ? withTime(s.t0, () => point(look)) : point(look);
      if (s.panTo != null) {
        const a = tgt.clone().sub(pos), b = point(s.panTo).sub(pos);
        const ya = Math.atan2(a.x, -a.z), yb = Math.atan2(b.x, -b.z);
        let dy = yb - ya; if (dy > Math.PI) dy -= 2 * Math.PI; if (dy < -Math.PI) dy += 2 * Math.PI;
        const yaw = ya + dy * u, pa = Math.atan2(a.y, Math.hypot(a.x, a.z)), pb = Math.atan2(b.y, Math.hypot(b.x, b.z)), pitch = lerp(pa, pb, u);
        tgt = pos.clone().add(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(30));
      }
      return { cam: 'persp', pos, target: tgt, fov: num(s.fov) || (w ? 60 : 50), mode: s.mode || (w ? w.id : modeVeh(s)) };
    }
    case 'aerial': {
      const bx = aerialBounds();
      const c = new THREE.Vector3((bx.x0 + bx.x1) / 2, 0, (bx.z0 + bx.z1) / 2);
      const a = aspect();
      let half = Math.max((bx.z1 - bx.z0) / 2, (bx.x1 - bx.x0) / 2 / a);
      if (!(aerial && aerial.url)) half *= lerp(num(s.zoomFrom) ?? 2.6, 1, u); // no photo: establishing push-in
      return { cam: 'ortho', pos: new THREE.Vector3(c.x, 400, c.z), target: c, up: [0, 0, -1], half, mode: s.mode || 'overhead', aerialOpacity: aerial && aerial.url ? 1 - u : 0 };
    }
    default: {
      const pos = point(s.position || (s.camera && s.camera.position) || [impactP.x - 30, 15, impactP.z + 30]);
      return { cam: 'persp', pos, target: point(s.lookAt || s.target || (s.camera && (s.camera.target || s.camera.lookAt)) || 'impact'), fov, mode: s.mode || modeVeh(s) };
    }
  }
}
const lerpArr = (a, b, u) => a.map((x, i) => lerp(+x, +b[i], u));
const aspect = () => (stage.clientWidth || innerWidth) / (stage.clientHeight || innerHeight);
const modeVeh = (s) => 'chase_' + (s.vehicle || primary);
function aerialBounds() {
  const b = aerial && aerial.bounds;
  if (b) {
    const g = (...ks) => { for (const k of ks) if (b[k] != null) return +b[k]; return undefined; };
    let x0 = g('xmin', 'minX', 'x0', 'west'), x1 = g('xmax', 'maxX', 'x1', 'east'), z0 = g('zmin', 'minZ', 'z0', 'north'), z1 = g('zmax', 'maxZ', 'z1', 'south');
    if (Array.isArray(b.x) && Array.isArray(b.z)) { [x0, x1] = b.x; [z0, z1] = b.z; }
    if (Array.isArray(b.bounds)) { x0 = b.bounds[0][0]; z0 = b.bounds[0][1]; x1 = b.bounds[1][0]; z1 = b.bounds[1][1]; }
    if (Array.isArray(b.min) && Array.isArray(b.max)) { x0 = b.min[0]; x1 = b.max[0]; z0 = b.min[b.min.length - 1]; z1 = b.max[b.max.length - 1]; }
    if ([x0, x1, z0, z1].every(Number.isFinite)) return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) };
  }
  const r = roi.clone().expandByScalar(10);
  return { x0: r.min.x, x1: r.max.x, z0: r.min.z, z1: r.max.z };
}
// keyframes: [{u|at (0..1 of motion) | time (s from motion start) | sceneT, position, target|lookAt, fov}], smooth (Catmull-Rom) through positions
function keyPose(s, keys, u, t, fov) {
  const ks = keys.map((k, i) => {
    let ku = num(k.u, k.at);
    if (ku == null && num(k.time, k.s) != null) ku = num(k.time, k.s) / Math.max(1e-6, s.motion);
    if (ku == null && num(k.sceneT, k.t) != null && s.t1 > s.t0) ku = (num(k.sceneT, k.t) - s.t0) / (s.t1 - s.t0);
    if (ku == null) ku = keys.length > 1 ? i / (keys.length - 1) : 0;
    return { u: Math.max(0, Math.min(1, ku)), pos: point(k.position || k.pos || k.eye), tgt: point(k.target || k.lookAt || 'impact'), fov: num(k.fov) ?? fov };
  }).sort((a, b) => a.u - b.u);
  if (ks.length === 1 || u <= ks[0].u) return { cam: 'persp', pos: ks[0].pos, target: ks[0].tgt, fov: ks[0].fov, mode: s.mode || modeVeh(s) };
  const L = ks[ks.length - 1];
  if (u >= L.u) return { cam: 'persp', pos: L.pos, target: L.tgt, fov: L.fov, mode: s.mode || modeVeh(s) };
  let i = 0; while (ks[i + 1].u < u) i++;
  const a = ks[i], b = ks[i + 1], v = (u - a.u) / Math.max(1e-6, b.u - a.u);
  const p0 = (ks[i - 1] || a).pos, p3 = (ks[i + 2] || b).pos;
  const pos = new THREE.CatmullRomCurve3([p0, a.pos, b.pos, p3]).getPoint((1 + v) / 3);
  return { cam: 'persp', pos, target: a.tgt.clone().lerp(b.tgt, v), fov: lerp(a.fov, b.fov, v), mode: s.mode || modeVeh(s) };
}

// ---------- frame ----------
let lastKey = null, lastMode = null, lastHud = null, lastSel = undefined, lastLR = null;
const r3 = (x) => Math.round(x * 1000) / 1000;
function shotAt(i) { for (const s of shots) if (i < s.start + s.n) return s; return shots[shots.length - 1]; }

function frame(i) {
  const s = shotAt(i);
  const tau = (i - s.start) / fps; // seconds into the shot
  const um = s.motion > 0 ? Math.max(0, Math.min(1, (tau - s.holdStart) / s.motion)) : (tau >= s.holdStart ? 1 : 0); // motion progress
  const phase = tau < s.holdStart ? 'hold-start' : tau < s.holdStart + s.motion ? 'motion' : 'hold-end';
  const t = s.type === 'title' ? 0 : clampT(s.t0 + (s.t1 - s.t0) * um);
  const u = s.ease(um);

  // --- title card: pure DOM ---
  if (s.type === 'title') {
    const fi = Math.min(1, tau / 0.35), fo = Math.min(1, (s.total - tau) / 0.35), op = Math.max(0, Math.min(fi, fo));
    const key = 'title|' + s.index + '|' + op.toFixed(3);
    const same = key === lastKey; lastKey = key;
    if (!same) {
      const lines = Array.isArray(s.lines) ? s.lines : [s.text || s.title || ''];
      titleEl.innerHTML = `<div style="opacity:${op.toFixed(3)}"><div class="l1">${lines.map(esc).join('<br>')}</div>${s.sub ? `<div class="rule"></div><div class="l2">${esc(s.sub)}</div>` : ''}${s.note ? `<div class="l3">${esc(s.note)}</div>` : ''}</div>`;
      titleEl.style.display = 'flex';
    }
    return { key, same, shot: s.id, type: s.type, phase, t: null };
  }
  titleEl.style.display = 'none';

  // --- drive the viewer (time, camera mode for its HUD/x-ray/rays); its own renders are suppressed ---
  suppress = true;
  try {
    const sel = s.sightline || (s.type === 'pov' && s.witness) || null;
    const hud = s.hud;
    if (lastHud !== hud) { if (hasOverlays()) sl.overlays.set(hud); document.body.classList.toggle('nohud', !hud); lastHud = hud; }
    if (sel !== lastSel && hasOverlays() && sl.overlays.selectWitness) { sl.overlays.selectWitness(sel); lastSel = sel; }
    const lr = (s.labels ? 'L' : 'l') + (s.rays === false ? 'r' : 'R');
    if (lr !== lastLR) { sl.setLabels(!!s.labels); sl.setRays(s.rays !== false); lastLR = lr; }
    sl.setTime(t);
    const pose0 = poseFor(s, u, t, tau);
    if (pose0.mode !== lastMode) { sl.setCamera(pose0.mode); lastMode = pose0.mode; }
    var pose = pose0;
  } finally { suppress = false; }
  world.setTime(t); world.root.updateMatrixWorld(true);

  // --- chrome ---
  const ov = s.ov || {};
  let cap = ov.caption || '';
  if (Array.isArray(ov.items)) { const it = ov.items.find((x) => { const a = x.at || x.range || [x.from, x.to]; return tau >= (+a[0] || 0) && tau < (a[1] == null ? 1e9 : +a[1]); }); if (it) cap = it.text || ''; }
  const freeze = s.freezeAt != null && phase === 'hold-end';
  const stamp = freeze ? `FREEZE · t = ${t.toFixed(2)} s` : (ov.stamp && phase !== 'hold-start' ? ov.stamp : '');
  const fadeIn = num(s.fadeIn) ?? 0, fadeOut = num(s.fadeOut) ?? 0;
  const black = Math.max(fadeIn > 0 ? 1 - Math.min(1, tau / fadeIn) : 0, fadeOut > 0 ? 1 - Math.min(1, (s.total - tau) / fadeOut) : 0);
  const aop = pose.aerialOpacity || 0;
  const key = [s.index, r3(t), pose.cam, ...pose.pos.toArray().map(r3), ...pose.target.toArray().map(r3), r3(pose.fov || 0), r3(pose.half || 0), cap, stamp, black.toFixed(3), aop.toFixed(3)].join('|');
  const same = key === lastKey; lastKey = key;
  const out = { key, same, shot: s.id, type: s.type, phase, t: r3(t), mode: pose.mode };
  if (same) return out;

  ltEl.style.display = ov.title || cap ? 'block' : 'none';
  ltEl.querySelector('.no').textContent = String(s.no).padStart(2, '0');
  ltEl.querySelector('.tt').textContent = ov.title || '';
  ltEl.querySelector('.cp').textContent = cap;
  ltEl.querySelector('.cp').style.display = cap ? 'block' : 'none';
  trEl.style.display = 'block';
  trEl.querySelector('.m').textContent = (s.t1 > s.t0 ? `scene ${s.t0.toFixed(1)}–${s.t1.toFixed(1)} s` : `scene t = ${s.t0.toFixed(2)} s`) + (s.speed !== 1 ? ` · ${s.speed}×` : s.t1 > s.t0 ? ' · real time' : ' · frozen');
  stampEl.style.display = stamp ? 'block' : 'none';
  stampEl.className = freeze ? 'freeze' : '';
  stampEl.textContent = stamp;
  blackEl.style.opacity = black.toFixed(3);

  // --- camera ---
  let cam;
  const a = aspect();
  if (pose.cam === 'ortho') {
    const h = pose.half;
    ortho.left = -h * a; ortho.right = h * a; ortho.top = h; ortho.bottom = -h; ortho.zoom = 1;
    ortho.up.set(...(pose.up || [0, 0, -1])); ortho.position.copy(pose.pos); ortho.lookAt(pose.target); ortho.updateProjectionMatrix();
    cam = ortho;
  } else {
    persp.aspect = a; persp.fov = pose.fov || 50; persp.up.set(...(pose.up || [0, 1, 0]));
    persp.near = 0.15; persp.far = 4000;
    persp.position.copy(pose.pos); persp.lookAt(pose.target); persp.updateProjectionMatrix();
    cam = persp;
  }
  cam.updateMatrixWorld(true);
  if (s.fog === false || (s.fog == null && pose.cam === 'ortho')) scene.fog = null;

  // aerial photo registered to the world: project its bounds through the film camera
  if (aop > 0) {
    const bx = aerialBounds();
    const p0 = new THREE.Vector3(bx.x0, 0, bx.z0).project(cam), p1 = new THREE.Vector3(bx.x1, 0, bx.z1).project(cam);
    const W = stage.clientWidth, H = stage.clientHeight;
    const L = (Math.min(p0.x, p1.x) + 1) / 2 * W, R = (Math.max(p0.x, p1.x) + 1) / 2 * W, T = (1 - Math.max(p0.y, p1.y)) / 2 * H, B = (1 - Math.min(p0.y, p1.y)) / 2 * H;
    Object.assign(aerialImg.style, { left: L + 'px', top: T + 'px', width: (R - L) + 'px', height: (B - T) + 'px', opacity: aop.toFixed(3) });
  } else aerialImg.style.opacity = '0';

  renderer.render(scene, cam);
  return out;
}

// ---------- interactive preview: film.html?world=...&play=1 ----------
async function loadPlanParam() {
  const p = params.get('plan');
  if (!p) return null;
  try { return await (await fetch(p, { cache: 'no-store' })).json(); } catch (_) { return null; }
}
window.film = { setup, frame, info, get shots() { return shots; }, poseFor, defaultPlan };
window.film.ready = Promise.resolve(window.film);
if (params.get('play') === '1') {
  const pl = await loadPlanParam();
  setup(pl, { aerial: params.get('aerial') ? { url: params.get('aerial'), bounds: null } : null });
  let i = 0, t0 = performance.now();
  const tick = () => { const want = Math.floor((performance.now() - t0) / 1000 * fps); if (want !== i) { i = want % nFrames; frame(i); } requestAnimationFrame(tick); };
  tick();
}
