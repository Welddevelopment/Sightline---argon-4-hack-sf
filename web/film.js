// Sightline shot rig (owner: SHOT RIG). Renders a case world as a short film in a forensic studio's shot grammar:
// title cards, constant-speed orbits, top-down tracking, chase (with freeze), witness eye view (with pan), aerial dissolve.
// Loads the world through the viewer itself (import './viewer.js', ?world=...) and draws the viewer's own scene with a
// film camera on the viewer's renderer, so lighting/assets/overlays match the app. viewer.js is not edited.
// Deterministic: render/film.mjs calls film.frame(i) for every frame index; no wall clock is involved.
//   URL: film.html?world=/cases/demo/worlds/world_v2.js&quality=interactive[&plan=/cases/demo/plan/shot_plan.json&play=1]
//   API: film.setup(plan|null, {aerial, fallbackImage, fps}) -> timeline; film.frame(i) -> { key, same, shot, ... }
// Plan schemas (ARGON-SHOTS keyframed plan, and a simple typed form used by the built-in default) are in status/shot_rig.md.
// Transitions (fade / dissolve) are applied by render/film.mjs at assembly (ffmpeg), not here.
import * as THREE from 'three';
import './viewer.js';

const params = new URLSearchParams(location.search);
const sl = window.sl;
try { await import('./overlays.js'); } catch (e) { console.warn('film: overlays.js unavailable, minimal HUD only', e && e.message); }
await sl.ready;

const world = sl.world;
const scene = world.root.parent;
const stage = document.getElementById('stage');

// ---- grab the viewer's renderer from one render (scene.onBeforeRender receives it) ----
const renderer = await new Promise((res) => {
  const prev = scene.onBeforeRender;
  scene.onBeforeRender = function (r, s, c, rt) { scene.onBeforeRender = prev; if (prev) prev.call(this, r, s, c, rt); res(r); };
  sl.renderFrame();
});
// viewer-initiated renders (inside sl.setTime / sl.setCamera) are suppressed while we drive it; we render once per frame
const viewerRender = renderer.render;
let suppress = false;
renderer.render = function (s, c) { if (suppress && s === scene) return; return viewerRender.call(this, s, c); };

const persp = new THREE.PerspectiveCamera(50, 16 / 9, 0.2, 4000);
const ortho = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 3000);
const _b = new THREE.Box3();
const hasOverlays = () => !!(sl.overlays && typeof sl.overlays.set === 'function');

// ---------- DOM chrome ----------
const el = (tag, id, html = '') => { const e = document.createElement(tag); e.id = id; e.innerHTML = html; stage.appendChild(e); return e; };
const imgEl = el('img', 'film-img');
const titleEl = el('div', 'film-title');
const hudEl = el('div', 'film-hud');
const ltEl = el('div', 'film-lt');
const trEl = el('div', 'film-tr');
const wmEl = el('div', 'film-wm');
const lblEl = el('div', 'film-labels');
const sbEl = el('div', 'film-scale');
const bannerEl = el('div', 'film-banner');
const creditEl = el('div', 'film-credit');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const styleProp = (style, k) => { const m = String(style || '').match(new RegExp('(?:^|;)\\s*' + k + '\\s*:\\s*([^;]+)')); return m ? m[1].trim() : null; };
const W = () => stage.clientWidth || innerWidth, H = () => stage.clientHeight || innerHeight;

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
const ALL_WITNESSES = (world.witnesses || []).slice();

let impactT = null, impactP = null, primary = null, roi = null;
function analyze() {
  const oi = hasOverlays() && sl.overlays.info ? sl.overlays.info() : null;
  impactT = oi && oi.impact ? oi.impact.t : Number.isFinite(+(world.meta || {}).impactT) ? +world.meta.impactT : world.duration * 0.5;
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
  for (const w of ALL_WITNESSES) { const p = eyeOf(w); if (p.distanceTo(impactP) < 120) roi.expandByPoint(p); }
}
// point spec: [x,y,z] | [x,z] | {x,y,z} | object id | witness id | 'impact' | 'roi' | 'primary'
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
function headingOf(id, t) {
  const p = (tt) => withTime(tt, () => objCenter(id));
  let d = p(Math.min(world.duration, t + 0.25)).sub(p(Math.max(0, t - 0.25))); d.y = 0;
  if (d.lengthSq() < 1e-4) { d = p(Math.min(world.duration, t)).sub(p(Math.max(0, t - 2))); d.y = 0; }
  if (d.lengthSq() < 1e-4) d.set(1, 0, 0);
  return d.normalize();
}

// ---------- easing / interpolation ----------
const EASE = { linear: (u) => u, inout: (u) => 0.5 - 0.5 * Math.cos(Math.PI * u), in: (u) => 1 - Math.cos(Math.PI * u / 2), out: (u) => Math.sin(Math.PI * u / 2) };
const easeFn = (n) => EASE[String(n || 'linear').toLowerCase().replace(/[-_ ]/g, '').replace('easeinout', 'inout').replace('easein', 'in').replace('easeout', 'out')] || EASE.linear;
const num = (...xs) => { for (const x of xs) if (x != null && x !== '' && Number.isFinite(+x)) return +x; return undefined; };
const lerp = (a, b, u) => a + (b - a) * u;
const clamp01 = (u) => Math.max(0, Math.min(1, u));
function piecewise(map, s) { // [[s, v], ...] piecewise linear, clamped
  if (!map.length) return 0;
  if (s <= map[0][0]) return +map[0][1];
  for (let i = 0; i < map.length - 1; i++) { const [s0, v0] = map[i], [s1, v1] = map[i + 1]; if (s <= s1) return s1 > s0 ? lerp(+v0, +v1, (s - s0) / (s1 - s0)) : +v1; }
  return +map[map.length - 1][1];
}
const cr = (p0, p1, p2, p3, v) => 0.5 * (2 * p1 + (-p0 + p2) * v + (2 * p0 - 5 * p1 + 4 * p2 - p3) * v * v + (-p0 + 3 * p1 - 3 * p2 + p3) * v * v * v);
function aspect() { return W() / H(); }

// ---------- default plan (case-agnostic: derived from the world), simple typed form ----------
function defaultPlan() {
  const m = world.meta || {};
  const ws = ALL_WITNESSES;
  const failing = ws.find((w) => { try { const r = sl.sightline(w.id, w.observationTime != null ? w.observationTime : impactT); return r && !r.visible; } catch (_) { return false; } }) || ws[0];
  const others = vehicles().filter((v) => v !== primary);
  const T = impactT, t0 = Math.max(0, T - 6);
  const shots = [
    { id: 'title', type: 'title', duration: 3, text: m.title || 'Reconstruction', sub: 'Kinematic reconstruction · simulated', note: m.source || '', transitionIn: 'fade 0.5', transitionOut: 'fade 0.5' },
    { id: 'aerial', type: 'aerial', t: t0, holdStart: 2, duration: 3, holdEnd: 1.5, transitionIn: 'fade 0.5', transitionOut: 'dissolve 1',
      overlay: { title: 'Scene overview', caption: 'Top-down, north up. Positions at t = ' + t0.toFixed(1) + ' s.' } },
    { id: 'orbit', type: 'orbit', target: 'impact', radius: 46, height: 22, startDeg: 200, sweepDeg: 100, duration: 8, t: t0, fov: 50, transitionOut: 'dissolve 1',
      overlay: { title: 'Area of impact', caption: 'Orbit at constant angular speed; scene frozen at t = ' + t0.toFixed(1) + ' s.' } },
    { id: 'topdown', type: 'topdown', frame: [primary, 'impact', ...others.slice(0, 1)], margin: 14, minHalf: 22, sceneTime: [Math.max(0, T - 7), Math.min(world.duration, T + 1)],
      overlay: { title: 'Top-down tracking', caption: 'Vehicle paths to impact, real time.' }, transitionOut: 'fade 0.5' },
    { id: 'chase', type: 'chase', vehicle: primary, offset: [11, 3.6, 0], lookAhead: 18, fov: 55, sceneTime: [t0, T], freezeAt: T, transitionIn: 'fade 0.5', transitionOut: 'fade 0.5',
      overlay: { title: 'Chase view', caption: 'Camera follows ' + ((world.objects[primary] || {}).label || primary || '').replace(/\s*\(.*$/, '') + '; frozen at impact.' } },
  ];
  if (failing) {
    const ot = failing.observationTime != null ? failing.observationTime : T - 1;
    shots.push({ id: 'pov_' + failing.id, type: 'pov', witness: failing.id, lookAt: failing.lookAt, fov: 60, transitionIn: 'fade 0.5',
      sceneTime: [Math.max(0, Math.min(ot, T) - 4), Math.min(world.duration, Math.max(ot, T))], sightline: failing.id,
      overlay: { title: 'Eye view: ' + String(failing.name || failing.id).replace(/\s*\(fictional\)/i, ''), caption: failing.claim ? '“' + failing.claim + '”' : '' } });
    shots.push({ id: 'sight_' + failing.id, type: 'topdown', frame: [failing.id, failing.lookAt || primary], margin: 10, minHalf: 18, t: ot, duration: 0, holdStart: 4, holdEnd: 0,
      sightline: failing.id, transitionOut: 'fade 0.5', overlay: { title: 'Sight line at t = ' + ot.toFixed(1) + ' s', caption: 'Ray from the witness’s eye to the target, checked against every modeled object.' } });
  }
  shots.push({ id: 'end', type: 'title', duration: 3, text: 'Simulated reconstruction', sub: 'Fictional witnesses · motion fitted to cited evidence', note: 'Not a crash-physics simulation. Generated by Sightline.', transitionIn: 'fade 0.5', transitionOut: 'fade 0.5' });
  return { title: m.title, fps: 12, shots };
}

// ---------- normalisation: every shot becomes { total, tAt(s), poseAt(s,t), ovs[], mode, sel, ... } ----------
const TYPE = { title: 'title', title_card: 'title', card: 'title', text: 'title', orbit: 'orbit', topdown: 'topdown', top_down: 'topdown', top_down_tracking: 'topdown',
  overhead: 'topdown', tracking: 'topdown', chase: 'chase', follow: 'chase', pov: 'pov', eye: 'pov', witness: 'pov', witness_eye: 'pov', eye_view: 'pov',
  aerial: 'aerial', aerial_dissolve: 'aerial', dissolve: 'aerial', keyframes: 'keyframes', path: 'keyframes', static: 'keyframes' };
let plan = null, shots = [], fps = 12, nFrames = 0, aerial = null, fallbackImage = null;

function parseTransition(x) {
  if (!x) return { kind: 'cut', d: 0 };
  if (typeof x === 'object') return { kind: String(x.kind || x.type || 'cut').toLowerCase(), d: num(x.d, x.duration, x.sec) ?? 0.5 };
  const m = String(x).toLowerCase().match(/(fade|dissolve|cut|crossfade|xfade)\s*([\d.]+)?/);
  if (!m) return { kind: 'cut', d: 0 };
  const kind = m[1] === 'crossfade' || m[1] === 'xfade' ? 'dissolve' : m[1];
  return { kind, d: kind === 'cut' ? 0 : (m[2] ? +m[2] : 0.5) };
}

function camKeys(s) {
  const c = s.camera || {};
  const ks = s.keyframes || s.keys || c.keyframes || c.keys;
  return Array.isArray(ks) && ks.length ? ks : null;
}
const isV2 = (s) => s.durationSec != null || s.sceneTimeMap !== undefined || (camKeys(s) || []).some((k) => k.s != null);

function normShot(s, i) {
  const type = TYPE[String(s.type || s.kind || 'keyframes').toLowerCase()] || 'keyframes';
  const sh = { src: s, type, index: i, id: s.id || type + '_' + (i + 1), tin: parseTransition(s.transitionIn), tout: parseTransition(s.transitionOut) };
  if (isV2(s)) normV2(s, sh); else normSimple(s, sh);
  sh.sel = sh.sel || null;
  // mode for the viewer's HUD/x-ray/rays + overlays.js; witness views detected by camera position at a witness eye
  if (!sh.mode && type !== 'title') {
    const p0 = sh.poseAt(0, sh.tAt(0));
    const atEye = ALL_WITNESSES.find((w) => eyeOf(w).distanceTo(p0.pos) < 1.5);
    if (type === 'pov' && (sh.sel || atEye) && s.xray !== false) sh.mode = sh.sel && witness(sh.sel) && eyeOf(witness(sh.sel)).distanceTo(p0.pos) < 1.5 ? sh.sel : atEye ? atEye.id : 'chase_' + primary;
    else if (p0.cam === 'ortho') sh.mode = 'overhead';
    else sh.mode = 'chase_' + ((s.camera && s.camera.follow && s.camera.follow.target) || s.vehicle || primary);
  }
  if (sh.mode && !sh.mode.startsWith('chase_') && sh.mode !== 'overhead' && !sh.sel) sh.sel = sh.mode;
  // key frame second in the shot
  if (sh.keyS == null) sh.keyS = defaultKeyS(sh);
  return sh;
}

function normV2(s, sh) {
  const keys = camKeys(s) || [];
  const c = s.camera || {};
  const lastS = keys.reduce((m, k) => Math.max(m, num(k.s, k.time) ?? 0), 0);
  sh.total = num(s.durationSec, s.duration) ?? (lastS || (num(s.holdStartSec) ?? 0) + (num(s.holdEndSec) ?? 0)) ?? 3;
  const stm = Array.isArray(s.sceneTimeMap) ? s.sceneTimeMap.filter((p) => Array.isArray(p) && p.length >= 2) : null;
  const tFixed = num(s.freezeAtT) ?? 0;
  sh.tAt = (sec) => clampT(stm && stm.length ? piecewise(stm, sec) : sh.type === 'title' ? 0 : tFixed);
  sh.freezeAt = num(s.freezeAtT);
  sh.ovs = (Array.isArray(s.overlays) ? s.overlays : s.overlay ? [].concat(s.overlay) : []).map((o) => (typeof o === 'string' ? { kind: 'lower_third', text: o } : o));
  // the plan may have been written before an aerial photo existed: retitle a diagram-registration caption when the photo is used
  if (sh.type === 'aerial' && aerial) sh.ovs = sh.ovs.map((o) => (/lower|caption/i.test(o.kind || '') && /diagram|exhibit\s*4|map\.png/i.test(o.text || '')
    ? { ...o, text: 'AERIAL PHOTO REGISTRATION \u2014 USGS NAIP orthophoto aligned to the 3D scene' + ((String(o.text).match(/\(t = [^)]*\)/) || [''])[0] ? ' ' + String(o.text).match(/\(t = [^)]*\)/)[0] : '') } : o));
  const sight = sh.ovs.find((o) => /sight/i.test(o.kind || ''));
  if (sight) sh.sel = sight.fromWitness || sight.witness || null;
  sh.rays = !!sight;
  const proj = String(c.projection || '').toLowerCase();
  const K = keys.map((k, j) => ({ s: num(k.s, k.time) ?? (keys.length > 1 ? sh.total * j / (keys.length - 1) : 0), pos: k.position || k.pos || k.eye, look: k.lookAt || k.target,
    fov: num(k.fovDeg, k.fov), half: num(k.orthoHeightM, k.orthoHalf) , ease: easeFn(k.ease) })).sort((a, b) => a.s - b.s);
  const fov0 = num(c.fovDeg, c.fov) || 45;
  const follow = c.follow && !keys.length ? c.follow : null;
  sh.poseAt = (sec, t) => {
    if (follow) return chasePose({ vehicle: follow.target, offset: [num(follow.offsetLocal && follow.offsetLocal[2]) ?? 12, num(follow.offsetLocal && follow.offsetLocal[1]) ?? 3, num(follow.offsetLocal && follow.offsetLocal[0]) ?? 0], lookAhead: follow.lookAheadM, fov: fov0 }, t);
    if (!K.length) return { cam: 'persp', pos: point([impactP.x - 30, 15, impactP.z + 30]), target: point('impact'), fov: fov0 };
    let i = 0; while (i < K.length - 1 && K[i + 1].s <= sec) i++;
    const a = K[i], b = K[Math.min(i + 1, K.length - 1)];
    const v = b.s > a.s ? a.ease(clamp01((sec - a.s) / (b.s - a.s))) : 0;
    const P = (k) => point(k.pos);
    const k0 = K[Math.max(0, i - 1)], k3 = K[Math.min(K.length - 1, i + 2)];
    const pa = P(a), pb = P(b), p0 = P(k0), p3 = P(k3);
    const pos = new THREE.Vector3(cr(p0.x, pa.x, pb.x, p3.x, v), cr(p0.y, pa.y, pb.y, p3.y, v), cr(p0.z, pa.z, pb.z, p3.z, v));
    const target = point(a.look).lerp(point(b.look), v);
    const fov = lerp(a.fov || fov0, b.fov || fov0, v) || fov0;
    // top-down plan views (camera within 10 deg of vertical) render orthographic so plan overlays measure correctly
    const dir = target.clone().sub(pos);
    const steep = dir.y < 0 && Math.abs(dir.y) / dir.length() > Math.cos(10 * Math.PI / 180);
    if ((proj === 'orthographic' && sh.type !== 'title') || (steep && (sh.type === 'topdown' || s.forceOrtho))) {
      const half = proj === 'orthographic' && (a.half || num(c.orthoHeightM)) ? lerp(a.half || +c.orthoHeightM, b.half || +c.orthoHeightM, v) / 2 : dir.length() * Math.tan(fov * Math.PI / 360);
      return { cam: 'ortho', pos: new THREE.Vector3(target.x, 400, target.z), target: new THREE.Vector3(target.x, 0, target.z), up: [0, 0, -1], half };
    }
    return { cam: 'persp', pos, target, fov, up: steep ? [0, 0, -1] : [0, 1, 0] };
  };
  // image dissolve (aerial_dissolve): photo for holdStartSec, then cross-dissolves into the 3D
  if (sh.type === 'aerial') {
    const hs = num(s.holdStartSec) ?? 2.5;
    const dd = num(s.dissolveSec) ?? Math.min(2, Math.max(0.5, sh.total - hs - (num(s.holdEndSec) ?? 0)));
    sh.imgOpacity = (sec) => 1 - clamp01((sec - hs) / dd);
  }
  if (sh.type === 'title') {
    const tc = sh.ovs.find((o) => /title/i.test(o.kind || ''));
    sh.card = tc ? { text: tc.text, style: tc.style } : { text: s.text || s.title || '' };
  }
}

function normSimple(s, sh) {
  const type = sh.type;
  const st = s.sceneTime || s.scene_time || s.timeRange;
  let t0 = Array.isArray(st) ? +st[0] : num(s.t, s.time);
  let t1 = Array.isArray(st) ? +st[1] : undefined;
  if (t0 == null) t0 = type === 'title' ? 0 : impactT;
  if (t1 == null) t1 = t0;
  if (s.freezeAt != null) t1 = Math.min(t1, +s.freezeAt);
  t0 = clampT(t0); t1 = clampT(Math.max(t0, t1));
  const speed = num(s.speed) || 1;
  let hs, he, motion;
  if (type === 'title') { hs = 0; he = 0; motion = num(s.duration) ?? 2; }
  else {
    hs = num(s.holdStart) ?? 3; he = num(s.holdEnd, s.freezeHold) ?? 3;
    const span = (t1 - t0) / speed;
    motion = num(s.duration) ?? (span > 0 ? span : 6);
  }
  sh.total = hs + motion + he;
  sh.freezeAt = num(s.freezeAt);
  const um = (sec) => (motion > 0 ? clamp01((sec - hs) / motion) : sec >= hs ? 1 : 0);
  const ez = EASE[s.easing] || (type === 'orbit' ? EASE.linear : EASE.inout);
  sh.tAt = (sec) => (type === 'title' ? 0 : clampT(t0 + (t1 - t0) * um(sec)));
  sh.poseAt = (sec, t) => simplePose(s, type, ez(um(sec)), t, sh);
  sh.sel = s.sightline || (type === 'pov' && s.witness) || null;
  sh.rays = !!s.sightline;
  if (s.mode) sh.mode = s.mode;
  else if (type === 'pov' && s.witness) sh.mode = s.witness;
  const ov = s.overlay || {};
  sh.ovs = [];
  if (type === 'title') sh.card = { text: [s.text || s.title || '', s.sub ? '—' + s.sub : null, s.note ? '~' + s.note : null].filter(Boolean).join('\n') };
  else if (ov.title || ov.caption) sh.ovs.push({ kind: 'lower_third', title: ov.title, text: ov.caption || '' });
  if (type === 'aerial') sh.imgOpacity = (sec) => 1 - um(sec);
  sh.keyS = s.keyAt != null ? +s.keyAt : type === 'chase' || type === 'pov' ? hs + motion + Math.min(0.5, he / 2) : type === 'aerial' ? hs + motion * 0.55 : type === 'title' ? motion / 2 : hs + motion / 2;
}

function defaultKeyS(sh) {
  if (sh.type === 'title') return sh.total / 2;
  if (sh.type === 'aerial') { for (let s = 0; s < sh.total; s += 0.1) if (sh.imgOpacity && sh.imgOpacity(s) <= 0.45) return s; return sh.total / 2; }
  if (sh.type === 'chase' || sh.type === 'pov') {
    // the decisive instant: longest frozen-time stretch after the first (e.g. observation-time hold or impact freeze)
    const segs = []; let st = null;
    for (let s = 0; s <= sh.total + 1e-6; s += 0.1) {
      const flat = Math.abs(sh.tAt(Math.min(sh.total, s + 0.05)) - sh.tAt(Math.max(0, s - 0.05))) < 1e-4;
      if (flat && st == null) st = s; if ((!flat || s + 0.1 > sh.total) && st != null) { segs.push([st, s]); st = null; }
    }
    const later = segs.filter((g) => g[0] > 0.2).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
    if (later.length) return (later[0][0] + later[0][1]) / 2;
  }
  return sh.total / 2;
}

function chasePose(s, t) {
  const vid = s.vehicle || primary;
  const p = point(vid);
  const d = headingOf(vid, t);
  const off = s.offset || [11, 3.6, 0];
  const right = new THREE.Vector3(-d.z, 0, d.x);
  const pos = p.clone().addScaledVector(d, -(+off[0])).add(new THREE.Vector3(0, +off[1], 0)).addScaledVector(right, +off[2] || 0);
  const tgt = p.clone().addScaledVector(d, num(s.lookAhead) ?? 16); tgt.y = num(s.targetHeight) ?? 1.0;
  return { cam: 'persp', pos, target: tgt, fov: num(s.fov) || 55 };
}

function simplePose(s, type, u, t, sh) {
  const fov = num(s.fov) || 50;
  switch (type) {
    case 'orbit': {
      const c = point(s.target || 'impact');
      const r = num(s.radius) ?? 45;
      const h = num(s.height) ?? r * 0.45;
      const az = ((num(s.startDeg) ?? 200) + (num(s.sweepDeg) ?? 90) * u) * Math.PI / 180; // compass bearing target->camera: 0 = north (-Z), 90 = east
      const tgt = c.clone(); tgt.y += num(s.targetHeight) ?? 1;
      return { cam: 'persp', pos: new THREE.Vector3(c.x + Math.sin(az) * r, c.y + h, c.z - Math.cos(az) * r), target: tgt, fov };
    }
    case 'topdown': {
      let c, half;
      if (Array.isArray(s.frame) && s.frame.length) {
        const b = new THREE.Box3();
        for (const id of s.frame.filter(Boolean)) b.expandByPoint(point(id));
        b.expandByScalar(num(s.margin) ?? 12);
        c = b.getCenter(new THREE.Vector3());
        const sz = b.getSize(new THREE.Vector3());
        half = Math.max(sz.z / 2, sz.x / 2 / aspect(), num(s.minHalf) ?? 20);
      } else {
        c = s.follow ? point(s.follow) : s.center ? point(s.center) : roi.getCenter(new THREE.Vector3());
        half = num(s.halfHeight) ?? 40;
        if (s.halfHeightEnd != null) half = lerp(half, +s.halfHeightEnd, u);
      }
      return { cam: 'ortho', pos: new THREE.Vector3(c.x, 400, c.z), target: new THREE.Vector3(c.x, 0, c.z), up: [0, 0, -1], half };
    }
    case 'chase': return chasePose(s, t);
    case 'pov': {
      const w = s.witness ? witness(s.witness) : null;
      const pos = s.position ? point(s.position) : w ? eyeOf(w) : point('roi').setY(1.6);
      const look = s.lookAt != null ? s.lookAt : w ? w.lookAt : 'impact';
      let tgt = s.track === false && typeof look === 'string' ? withTime(sh.tAt(0), () => point(look)) : point(look);
      if (s.panTo != null) {
        const a = tgt.clone().sub(pos), b = point(s.panTo).sub(pos);
        const ya = Math.atan2(a.x, -a.z), yb = Math.atan2(b.x, -b.z);
        let dy = yb - ya; if (dy > Math.PI) dy -= 2 * Math.PI; if (dy < -Math.PI) dy += 2 * Math.PI;
        const yaw = ya + dy * u, pitch = lerp(Math.atan2(a.y, Math.hypot(a.x, a.z)), Math.atan2(b.y, Math.hypot(b.x, b.z)), u);
        tgt = pos.clone().add(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(30));
      }
      return { cam: 'persp', pos, target: tgt, fov: num(s.fov) || 60 };
    }
    case 'aerial': {
      const bx = imageBoundsBox();
      const c = new THREE.Vector3((bx.x0 + bx.x1) / 2, 0, (bx.z0 + bx.z1) / 2);
      let half = Math.max((bx.z1 - bx.z0) / 2, (bx.x1 - bx.x0) / 2 / aspect());
      if (!(aerial && aerial.url)) half *= lerp(num(s.zoomFrom) ?? 2.6, 1, u);
      return { cam: 'ortho', pos: new THREE.Vector3(c.x, 400, c.z), target: c, up: [0, 0, -1], half };
    }
    default:
      return { cam: 'persp', pos: point(s.position || [impactP.x - 30, 15, impactP.z + 30]), target: point(s.lookAt || s.target || 'impact'), fov };
  }
}

// ---------- aerial photo registration ----------
// bounds.json: { boundsMeters:{minX,maxX,minZ,maxZ} (image-local, top = north = -Z), calibration:{rotationDeg, offsetX, offsetZ} } (world = rotY(rot)*local + offset)
function aerialCorners() {
  const b = aerial && aerial.bounds;
  if (!b) return null;
  const bm = b.boundsMeters || b.bounds || b;
  const g = (...ks) => { for (const k of ks) if (bm[k] != null) return +bm[k]; return undefined; };
  const x0 = g('minX', 'xmin', 'west'), x1 = g('maxX', 'xmax', 'east'), z0 = g('minZ', 'zmin', 'north'), z1 = g('maxZ', 'zmax', 'south');
  if (![x0, x1, z0, z1].every(Number.isFinite)) return null;
  const cal = b.calibration || {};
  const r = (num(cal.rotationDeg) ?? 0) * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r), ox = num(cal.offsetX) ?? 0, oz = num(cal.offsetZ) ?? 0;
  const w = (x, z) => new THREE.Vector3(cs * x + sn * z + ox, 0, -sn * x + cs * z + oz);
  return [w(x0, z0), w(x1, z0), w(x1, z1), w(x0, z1)]; // TL, TR, BR, BL of the image
}
function imageBoundsBox() {
  const cs = aerialCorners();
  if (cs) { const b = new THREE.Box3().setFromPoints(cs); const c = b.getCenter(new THREE.Vector3()); const hz = Math.min(b.max.z - c.z, 160), hx = Math.min(b.max.x - c.x, 160 * aspect()); return { x0: c.x - hx, x1: c.x + hx, z0: c.z - hz, z1: c.z + hz }; }
  const r = roi.clone().expandByScalar(10);
  return { x0: r.min.x, x1: r.max.x, z0: r.min.z, z1: r.max.z };
}
// CSS matrix3d mapping the w x h element rect onto 4 screen points (projective; exact for a ground-plane photo)
function quadMatrix(w, h, d) {
  const s = [[0, 0], [w, 0], [w, h], [0, h]];
  const A = [], B = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = s[i], [X, Y] = d[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); B.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); B.push(Y);
  }
  for (let c = 0; c < 8; c++) { // gaussian elimination
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [B[c], B[p]] = [B[p], B[c]];
    for (let r = 0; r < 8; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; B[r] -= f * B[c]; }
  }
  const m = B.map((b, i) => b / A[i][i]);
  return `matrix3d(${m[0]},${m[3]},0,${m[6]},${m[1]},${m[4]},0,${m[7]},0,0,1,0,${m[2]},${m[5]},0,1)`;
}
function placeImage(cam, op) {
  creditEl.style.display = op > 0 && aerial ? 'block' : 'none';
  if (aerial) creditEl.textContent = aerial.credit || 'Aerial: USGS The National Map (NAIP)';
  if (!(op > 0)) { imgEl.style.opacity = '0'; return; }
  const cs = aerial && aerial.url ? aerialCorners() : null;
  if (cs && imgEl.naturalWidth) {
    const pts = [];
    for (const c of cs) {
      const v = c.clone().applyMatrix4(cam.matrixWorldInverse);
      if (!cam.isOrthographicCamera && v.z > -0.5) { imgEl.style.opacity = '0'; return; }
      const p = c.clone().project(cam);
      pts.push([(p.x + 1) / 2 * W(), (1 - p.y) / 2 * H()]);
    }
    Object.assign(imgEl.style, { left: '0', top: '0', width: imgEl.naturalWidth + 'px', height: imgEl.naturalHeight + 'px', transformOrigin: '0 0',
      transform: quadMatrix(imgEl.naturalWidth, imgEl.naturalHeight, pts), objectFit: 'fill', background: 'transparent', opacity: op.toFixed(3) });
  } else { // unregistered exhibit (diagram): letterboxed full frame
    Object.assign(imgEl.style, { left: '0', top: '0', width: W() + 'px', height: H() + 'px', transform: 'none', objectFit: 'contain', background: '#0b0e13', opacity: op.toFixed(3) });
  }
}

// ---------- setup ----------
function setup(p, opts = {}) {
  analyze();
  aerial = opts.aerial && opts.aerial.url ? opts.aerial : null;
  fallbackImage = opts.fallbackImage || null;
  plan = p && Array.isArray(p.shots) && p.shots.length ? p : defaultPlan();
  fps = num(opts.fps) || Math.min(15, num(plan.fps) || 12);
  shots = plan.shots.map(normShot);
  let f = 0;
  for (const s of shots) {
    s.start = f; s.n = Math.max(1, Math.round(s.total * fps)); f += s.n;
    s.key = s.start + Math.min(s.n - 1, Math.max(0, Math.round(s.keyS * fps)));
  }
  nFrames = f;
  const src = aerial ? aerial.url : fallbackImage;
  if (src && imgEl.getAttribute('src') !== src) imgEl.src = src;
  return info();
}
const info = () => ({ fps, frames: nFrames, seconds: +(nFrames / fps).toFixed(2), impactT, primary, image: aerial ? 'aerial' : fallbackImage ? 'fallback' : null, planTitle: plan && plan.title,
  shots: shots.map((s) => ({ id: s.id, type: s.type, start: s.start, n: s.n, key: s.key, keyS: +s.keyS.toFixed(2), total: s.total, mode: s.mode || null, sel: s.sel, tin: s.tin, tout: s.tout,
    t0: +s.tAt(0).toFixed(3), t1: +s.tAt(s.total).toFixed(3) })) });

// ---------- overlay rendering ----------
const r3 = (x) => Math.round(x * 1000) / 1000;
const active = (sh, sec) => sh.ovs.map((o, k) => ({ ...o, k })).filter((o) => (o.from == null || sec >= +o.from - 1e-6) && (o.to == null || sec < +o.to - 1e-6 || (+o.to >= sh.total - 1e-6)));
function splitTitle(o) {
  if (o.title != null) return { tt: o.title, cp: o.text || '' };
  const t = String(o.text || '');
  const i = t.indexOf(' — ');
  return i > 0 ? { tt: t.slice(0, i), cp: t.slice(i + 3) } : { tt: '', cp: t };
}
function titleCardHtml(card) {
  const lines = String(card.text || '').split('\n');
  const out = [];
  let first = true, list = [];
  const flush = () => { if (list.length) { out.push(`<ul>${list.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`); list = []; } };
  for (const raw of lines) {
    const l = raw.trim();
    if (/^[•*-]\s+/.test(l)) { list.push(l.replace(/^[•*-]\s+/, '')); continue; }
    flush();
    if (!l) { out.push('<div class="sp"></div>'); continue; }
    if (l.startsWith('—')) { out.push(`<div class="rule"></div><div class="l2">${esc(l.slice(1))}</div>`); continue; }
    if (l.startsWith('~')) { out.push(`<div class="l3">${esc(l.slice(1))}</div>`); continue; }
    if (first) { out.push(`<div class="l1">${esc(l)}</div><div class="rule"></div>`); first = false; continue; }
    if (/simulated|fictional/i.test(l)) { out.push(`<div class="kick">${esc(l)}</div>`); continue; }
    if (/^claim:|^“|^"/i.test(l)) { out.push(`<div class="q">${esc(l)}</div>`); continue; }
    out.push(`<div class="l2">${esc(l)}</div>`);
  }
  flush();
  return `<div class="card">${out.join('')}</div>`;
}
function proj(cam, p) {
  const v = p.clone().applyMatrix4(cam.matrixWorldInverse);
  const front = cam.isOrthographicCamera || v.z < -0.1;
  const q = p.clone().project(cam);
  return { x: (q.x + 1) / 2 * W(), y: (1 - q.y) / 2 * H(), on: front && Math.abs(q.x) < 1.02 && Math.abs(q.y) < 1.02 };
}
function playback(sh, sec) {
  const d = 0.05, a = sh.tAt(Math.max(0, sec - d)), b = sh.tAt(Math.min(sh.total, sec + d));
  const span = Math.min(sh.total, sec + d) - Math.max(0, sec - d);
  const slope = span > 0 ? (b - a) / span : 0;
  if (Math.abs(slope) < 1e-3) return sh.freezeAt != null && Math.abs(sh.tAt(sec) - sh.freezeAt) < 1e-3 ? 'FREEZE' : 'TIME HELD';
  if (Math.abs(slope - 1) < 0.02) return 'REAL TIME 1.0×';
  return (Math.round(slope * 100) / 100) + '× ' + (slope < 1 ? 'SLOW MOTION' : 'FAST');
}
function drawChrome(sh, sec, t, cam, pose) {
  const ovs = active(sh, sec);
  // HUD (top-left) — the plan's static telemetry; overlays.js's live clock panel sits under it
  const hud = ovs.filter((o) => /hud/i.test(o.kind || ''));
  hudEl.innerHTML = hud.map((o) => `<div class="box">${String(o.text || '').split(/\s+\|\s+/).map((x, j) => `<div class="${j ? '' : 'h'}">${esc(x)}</div>`).join('')}</div>`).join('');
  hudEl.style.display = hud.length ? 'block' : 'none';
  stage.style.setProperty('--film-hud-h', (hud.length ? hudEl.offsetHeight + 8 : 0) + 'px');
  // lower third: latest active one
  const lts = ovs.filter((o) => /lower|caption|subtitle/i.test(o.kind || ''));
  const lt = lts[lts.length - 1];
  if (lt) {
    const { tt, cp } = splitTitle(lt);
    const bg = styleProp(lt.style, 'background');
    const red = bg && /rgba?\(\s*1[5-9]\d|rgba?\(\s*2\d\d\s*,\s*[0-6]?\d\s*,/.test(bg);
    ltEl.className = red ? 'alert' : '';
    ltEl.innerHTML = `<div class="row"><div class="tx">${tt ? `<div class="tt">${esc(tt)}</div>` : ''}${cp ? `<div class="cp">${esc(cp)}</div>` : ''}</div></div>`;
    ltEl.style.display = 'block';
  } else ltEl.style.display = 'none';
  // watermark
  const wm = ovs.find((o) => /watermark/i.test(o.kind || ''));
  wmEl.textContent = wm ? wm.text : 'SIMULATED RECONSTRUCTION';
  wmEl.style.display = 'block';
  // top-right: playback state + north arrow (when asked for, or in any plan view)
  const pb = playback(sh, sec);
  const wantN = ovs.some((o) => /north/i.test(o.kind || '')) || pose.cam === 'ortho';
  let arrow = '';
  if (wantN) {
    const c = pose.target.clone(); c.y = 0;
    const a = proj(cam, c), b = proj(cam, c.clone().add(new THREE.Vector3(0, 0, -10)));
    const ang = Math.atan2(b.x - a.x, -(b.y - a.y)) * 180 / Math.PI;
    if (Math.hypot(b.x - a.x, b.y - a.y) > 0.5) arrow = `<div class="na"><svg viewBox="-20 -24 40 48" width="34" height="40"><g transform="rotate(${ang.toFixed(1)})"><path d="M0,-18 L8,8 L0,3 L-8,8 Z" fill="#fff" stroke="#000" stroke-width="1"/></g><text x="0" y="23" text-anchor="middle">N</text></svg></div>`;
  }
  trEl.innerHTML = `<div class="pb ${pb === 'FREEZE' ? 'frz' : pb === 'TIME HELD' ? 'held' : ''}">${esc(pb)}${pb === 'FREEZE' || pb === 'TIME HELD' ? ` · t = ${t.toFixed(2)} s` : ''}</div>${arrow}`;
  trEl.style.display = 'block';
  // scale bar (bottom-left, above the lower third): metres from the overlay text, measured at the view target
  const sb = ovs.find((o) => /scale/i.test(o.kind || '')) || (pose.cam === 'ortho' ? { text: 'auto' } : null);
  if (sb) {
    let m = parseFloat(String(sb.text).replace(/[^\d.]/g, ''));
    const c = pose.target.clone(); c.y = 0;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion); right.y = 0; right.normalize();
    const pxPerM = (() => { const a = proj(cam, c), b = proj(cam, c.clone().addScaledVector(right, 10)); return Math.hypot(b.x - a.x, b.y - a.y) / 10; })();
    if (!Number.isFinite(m) || m <= 0) { const nice = [5, 10, 20, 25, 50, 100, 200, 250, 500]; m = nice.find((x) => x * pxPerM > W() * 0.09) || 500; }
    const px = m * pxPerM;
    if (px > 12 && px < W() * 0.5) { sbEl.innerHTML = `<div class="bar" style="width:${px.toFixed(1)}px"><i></i><i></i><i></i></div><div class="lab">${m} m (${Math.round(m * 3.28084)} ft)</div>`; sbEl.style.display = 'block'; }
    else sbEl.style.display = 'none';
  } else sbEl.style.display = 'none';
  // world-anchored labels / markers
  const lbls = ovs.filter((o) => /label|marker|callout/i.test(o.kind || '') && (o.worldPos || o.object));
  const html = [];
  for (const o of lbls) {
    const wp = o.worldPos ? point(o.worldPos) : point(o.object);
    const sp = proj(cam, wp);
    if (!sp.on) continue;
    const gp = proj(cam, wp.clone().setY(0));
    const col = styleProp(o.style, 'color') || '#fff';
    const lines = String(o.text || '').split('\n');
    html.push(`<div class="lb ${/marker/i.test(o.kind) ? 'mk' : ''}" style="left:${sp.x.toFixed(1)}px;top:${sp.y.toFixed(1)}px;--c:${esc(col)}"><div class="tx"><b>${esc(lines[0])}</b>${lines.slice(1).map((l) => `<span>${esc(l)}</span>`).join('')}</div></div>`);
    if (gp.on && Math.hypot(gp.x - sp.x, gp.y - sp.y) > 4) html.push(`<svg class="ld" style="left:0;top:0" width="${W()}" height="${H()}"><line x1="${sp.x.toFixed(1)}" y1="${sp.y.toFixed(1)}" x2="${gp.x.toFixed(1)}" y2="${gp.y.toFixed(1)}" stroke="${esc(col)}"/><circle cx="${gp.x.toFixed(1)}" cy="${gp.y.toFixed(1)}" r="3" fill="${esc(col)}"/></svg>`);
  }
  lblEl.innerHTML = html.join('');
  // own sight-line banner when the viewer's witness mode is not in use (xray:false), so the verdict is still on screen
  const own = sh.sel && sh.mode && sh.mode !== sh.sel && sh.type === 'pov' ? sl.sightline(sh.sel) : null;
  if (own) { bannerEl.className = own.visible ? 'ok' : 'bad'; bannerEl.textContent = own.visible ? 'LINE OF SIGHT: CLEAR' : 'LINE OF SIGHT BLOCKED — ' + String((world.objects[own.blockedBy] || {}).label || own.blockedBy || '').replace(/\s*\(.*$/, ''); bannerEl.style.display = 'block'; }
  else bannerEl.style.display = 'none';
  return ovs.map((o) => o.k).join(',') + '|' + pb;
}

// the viewer's witness mode x-rays the blocker (ghost + red edges) and the target (yellow fill). A film shows the occluder
// solid, so undo that per frame unless the shot asks for xray:true (the reticle, sight line and banner still show the verdict).
function unXray() {
  const fx = [];
  scene.traverse((o) => { if (o.userData && o.userData.xray) fx.push(o); });
  for (const o of fx) {
    o.visible = false;
    const m = o.parent;
    if (o.isLineSegments && o.material && o.material.color && o.material.color.getHex() === 0xff5a5a && m && m.isMesh) {
      for (const mm of [].concat(m.material)) if (mm && mm.transparent && Math.abs(mm.opacity - 0.35) < 1e-3) { mm.opacity = 1; mm.transparent = false; mm.depthWrite = true; }
    }
  }
}
let _mg = null;
function markerGroups() { // the viewer's witness marker groups (scaled for its own overhead zoom; we rescale for ours)
  if (_mg) return _mg;
  const ids = new Set(ALL_WITNESSES.map((w) => w.id));
  for (const g of scene.children) {
    if (!g.isGroup || g === world.root) continue;
    let hit = false; g.traverse((o) => { if (o.userData && ids.has(o.userData.witnessId)) hit = true; });
    if (hit) { _mg = g.children; break; }
  }
  return _mg || [];
}

// ---------- frame ----------
let lastKey = null, lastMode = null, lastHud = null, lastSel, lastLR = null;
function shotAt(i) { for (const s of shots) if (i < s.start + s.n) return s; return shots[shots.length - 1]; }
const hideAll = (v) => { for (const e of [hudEl, ltEl, trEl, lblEl, sbEl, bannerEl]) e.style.display = v ? 'none' : e.style.display; };

function frame(i) {
  const sh = shotAt(i);
  const sec = Math.min(sh.total, (i - sh.start) / fps);
  if (sh.type === 'title') {
    const key = 'title|' + sh.index + '|' + active(sh, sec).map((o) => o.k).join(',');
    const same = key === lastKey; lastKey = key;
    if (!same) {
      titleEl.innerHTML = titleCardHtml(sh.card || { text: '' });
      const fs = parseFloat(String(styleProp(sh.card && sh.card.style, 'font') || '').match(/([\d.]+)%/) ? RegExp.$1 : '');
      titleEl.style.setProperty('--fs', ((Number.isFinite(fs) ? fs : 5.6) * H() / 100).toFixed(1) + 'px');
      titleEl.style.display = 'flex';
      hideAll(true); imgEl.style.opacity = '0'; creditEl.style.display = 'none';
      const wm = (sh.ovs || []).find((o) => /watermark/i.test(o.kind || ''));
      wmEl.textContent = wm ? wm.text : ''; wmEl.style.display = wm ? 'block' : 'none';
    }
    return { key, same, shot: sh.id, type: sh.type, t: null, sec: r3(sec) };
  }
  titleEl.style.display = 'none';
  const t = sh.tAt(sec);

  suppress = true;
  let pose;
  try {
    const hud = sh.src.hud !== false;
    if (lastHud !== hud) { if (hasOverlays()) sl.overlays.set(hud); document.body.classList.toggle('nohud', !hud); lastHud = hud; }
    if (sh.sel !== lastSel && hasOverlays() && sl.overlays.selectWitness) { sl.overlays.selectWitness(sh.sel); lastSel = sh.sel; }
    const lr = (sh.src.labels ? 'L' : 'l') + (sh.rays ? 'R' : 'r');
    if (lr !== lastLR) { sl.setLabels(!!sh.src.labels); sl.setRays(!!sh.rays); lastLR = lr; }
    world.witnesses = ALL_WITNESSES;
    if (sh.mode !== lastMode) { sl.setCamera(sh.mode); lastMode = sh.mode; }
    sl.setTime(t);
    pose = sh.poseAt(sec, t);
  } finally { suppress = false; }
  world.setTime(t); world.root.updateMatrixWorld(true);
  if (sh.src.xray !== true) unXray();

  // camera
  const a = aspect();
  let cam;
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
  const op = sh.imgOpacity ? clamp01(sh.imgOpacity(sec)) : 0;
  const ovKey = [sh.index, r3(t), pose.cam, ...pose.pos.toArray().map(r3), ...pose.target.toArray().map(r3), r3(pose.fov || 0), r3(pose.half || 0), op.toFixed(3),
    active(sh, sec).map((o) => o.k).join(','), playback(sh, sec)].join('|');
  const same = ovKey === lastKey; lastKey = ovKey;
  const out = { key: ovKey, same, shot: sh.id, type: sh.type, t: r3(t), sec: r3(sec), mode: sh.mode };
  if (same) return out;

  drawChrome(sh, sec, t, cam, pose);
  placeImage(cam, op);
  if (sh.src.fog === false || (sh.src.fog == null && (pose.cam === 'ortho' || pose.pos.y > 60))) scene.fog = null;
  // witnesses not featured in this shot are hidden from overlays.js (it would otherwise draw the default/failing witness's ray everywhere)
  if (!sh.sel) world.witnesses = [];
  if (pose.cam === 'ortho') for (const g of markerGroups()) g.scale.setScalar(Math.max(1, pose.half / 55));
  try { if (op < 0.999) renderer.render(scene, cam); } finally { world.witnesses = ALL_WITNESSES; }
  // overlays.js clock panel: park it under the plan's HUD box (inline !important beats its stylesheet)
  const panel = stage.querySelector('.slo-layer > .slo-panel');
  if (panel) panel.style.setProperty('top', (hudEl.style.display === 'none' ? 12 : hudEl.offsetTop + hudEl.offsetHeight + 8) + 'px', 'important');
  return out;
}

// ---------- interactive preview: film.html?world=...&play=1[&plan=...] ----------
window.film = { setup, frame, info, get shots() { return shots; }, defaultPlan };
window.film.ready = Promise.resolve(window.film);
if (params.get('play') === '1') {
  let pl = null;
  try { if (params.get('plan')) pl = await (await fetch(params.get('plan'), { cache: 'no-store' })).json(); } catch (_) {}
  setup(pl, {});
  let i = -1; const t0 = performance.now();
  const tick = () => { const want = Math.floor((performance.now() - t0) / 1000 * fps) % nFrames; if (want !== i) { i = want; frame(i); } requestAnimationFrame(tick); };
  tick();
}
