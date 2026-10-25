// Sightline forensic callouts (owner: OVERLAYS). Measured, cited on-screen annotations in the style of
// courtroom crash animations:
//   - telemetry HUD (top-left): event clock, time-to-impact, per-vehicle speed, signal state, and
//     sight-line state triggers for the selected witness ("VEHICLE A NOW HIDDEN FROM WITNESS B");
//   - per-vehicle speed labels with leaders; street / lane labels on the overhead plan;
//   - live sight line from the selected witness's eye to the target (Line2, anti-aliased, recomputed
//     every frame by the viewer's raycaster: red #ff3b30 blocked / green #30d158 clear);
//   - lower-third narrative card for the selected witness (claim + citation + robustness + gaze + FOV);
//   - stopping-distance / brake-point marks, vehicle gap.
// Hooks into the viewer only through window.sl:
//   - scene = sl.world.root.parent; we chain scene.onBeforeRender (re-installed after every 'loaded'
//     event, because render_quality.js re-assigns it on load) so every renderer.render() — including
//     render/record.js and server/clips.js captures — updates the callouts for the exact frame drawn.
//   - Ground marks / sight line are WebGL objects in the scene; text is a DOM layer inside #stage.
//     Both captures use page.screenshot(), so DOM callouts land in the exported frames too.
// Toggle: button (top-right, hidden in ?clean=1), URL ?callouts=0|1, sl.overlays.set(bool) / sl.setCallouts(bool).
// While callouts are on, #stage gets class "slo-on" (the viewer's own eye panel / verdict banner / vehicle
// sprites step aside; the HUD and card carry the same facts).
// Nothing case-specific: impact time, clock anchor, vehicles, roads, signals, skids all come from the world + checks.
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

const params = new URLSearchParams(location.search);
const G = 9.81;
const MPH = 2.236936;
const FT = 3.28084;
const C_CLEAR = 0x30d158, C_BLOCK = 0xff3b30, C_REST = 0xaab3c2, C_MARK = 0xf2f4f7, C_AMBER = 0xe2b052, C_ZONE = 0xe2b052;
const INFERRED_RE = /inferred/i;
const TRIGGER_S = 1.0;          // a state change reads "NOW …" for this long (timeline seconds)

function waitForSl() {
  return new Promise((res) => {
    const tick = () => (window.sl && window.sl.events ? res(window.sl) : setTimeout(tick, 30));
    tick();
  });
}

const sl = await waitForSl();

// ---------- state ----------
// Callout density: 'off' | 'min' | 'full'. userMode null = auto = minimal in every view (keeps the picture clean). URL ?callouts=0|1|min|full; sl.overlays.set(bool|mode).
const normMode = (m) => {
  m = String(m == null ? '' : m).toLowerCase();
  if (m === '0' || m === 'off' || m === 'false') return 'off';
  if (m === 'min' || m === 'minimal') return 'min';
  if (m === 'full') return 'full';
  return null; // '1', 'on', 'auto', true
};
let userMode = (() => {
  if (params.has('callouts')) return normMode(params.get('callouts'));
  try { const v = localStorage.getItem('sl.callouts'); return v === '0' ? 'off' : normMode(v); } catch (_) { return null; }
})();
let enabled = userMode !== 'off';
const modeFor = (camId) => userMode || 'min'; // auto = minimal everywhere (studio style); Full via the toggle
let world = null, scene = null, info = null;
let checks = [];
let findings = [];
let checksFor = null;
let selWitness = null;          // explicit selection (pick / API); camera witness wins
const speedCache = new Map();   // key t*1000 -> Map(id -> mps)
const visCache = new Map();     // witness id -> [{ t, vis, by }] sampled every 0.1 s
const group = new THREE.Group();
group.name = '__sl_overlays';
group.renderOrder = 14;
const sightGroup = new THREE.Group();   // persistent Line2 objects (geometry swapped per frame)
sightGroup.name = '__sl_sightline';
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _box = new THREE.Box3(), _box2 = new THREE.Box3();
const raycaster = new THREE.Raycaster();

// ---------- DOM ----------
const stage = document.getElementById('stage') || document.body;
const layer = document.createElement('div');
layer.className = 'slo-layer';
stage.appendChild(layer);
const hudEl = document.createElement('div');           // telemetry HUD (top-left)
hudEl.className = 'slo-hud hud';
stage.appendChild(hudEl);
const cardEl = document.createElement('div');          // lower-third narrative card
cardEl.className = 'slo-card panel narrative';
cardEl.hidden = true;
stage.appendChild(cardEl);
const btn = document.createElement('div');
btn.className = 'slo-toggle';
btn.title = 'Callouts. Minimal (default): clock, speeds, vehicle tags, witness names, main road, the active sight line, witness card. Full: adds object labels, inferred boxes, stopping-distance bars, vehicle gap, all street labels. URL: ?callouts=0|min|full';
btn.innerHTML = '<span>Callouts</span><button type="button" data-m="off">Off</button><button type="button" data-m="min">Minimal</button><button type="button" data-m="full">Full</button>';
btn.addEventListener('click', (e) => { const b = e.target.closest('button[data-m]'); if (b) setEnabled(b.dataset.m); });
stage.appendChild(btn);
const measureCtx = document.createElement('canvas').getContext('2d');
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
function textW(s, font) { measureCtx.font = font; return Math.ceil(measureCtx.measureText(s).width); }
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let lastHud = '', lastCard = '';
function setHtml(el, html, key) {
  if (key === 'hud' ? lastHud === html : lastCard === html) return;
  el.innerHTML = html;
  if (key === 'hud') lastHud = html; else lastCard = html;
}

let shownMode = null;
function syncToggle() {
  const m = modeFor(sl.camera);
  enabled = m !== 'off';
  if (m !== shownMode) {
    shownMode = m;
    for (const b of btn.querySelectorAll('button')) { const on = b.dataset.m === m; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    btn.dataset.mode = m;
    btn.dataset.auto = userMode ? '0' : '1';
  }
  layer.hidden = !enabled;
  hudEl.hidden = !enabled;
  if (!enabled) cardEl.hidden = true;
  group.visible = enabled;
  sightGroup.visible = enabled;
  stage.classList.toggle('slo-on', enabled);
}
function setEnabled(v) {
  userMode = v === true ? null : v === false ? 'off' : normMode(v);
  try { localStorage.setItem('sl.callouts', userMode || 'auto'); } catch (_) {}
  syncToggle();
  if (sl.renderFrame) sl.renderFrame();
}
syncToggle();

// ---------- helpers ----------
const fmtM = (m) => `${m >= 100 ? Math.round(m) : m.toFixed(1)} m (${Math.round(m * FT)} ft)`;
const fmtMph = (mps) => `${Math.round(mps * MPH)} mph`;
const isInf = (o) => !!(o && o.citation && INFERRED_RE.test(String(o.citation)));
function shortLabel(t, n = 34) {
  t = String(t || '').replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}
// "Passenger sedan (Vehicle A), eastbound" -> "Vehicle A"; otherwise a short label
function vehName(id, o) {
  const l = String((o && o.label) || '');
  const m = l.match(/\b(Vehicle|Veh\.?|Unit|V)\s*#?\s*([A-Z0-9]{1,3})\b/);
  if (m) return 'Vehicle ' + m[2];
  return shortLabel(l || id.replace(/^veh_/, ''), 22);
}
// "Refrigerated van semitrailer (Vehicle T)" -> "Vehicle T semitrailer"; non-vehicles -> short label
function partName(id) {
  const o = world.objects[id];
  if (!o) return String(id || 'unknown');
  if (o.kind !== 'vehicle') return shortLabel(o.label || id, 28);
  const base = String(o.label || '').replace(/\s*\([^)]*\)/g, '').split(',')[0].trim();
  const word = (base.split(/\s+/).pop() || '').toLowerCase();
  const n = vehName(id, o);
  return word && !n.toLowerCase().includes(word) ? `${n} ${word}` : n;
}
function witName(w) { return String(w.name || w.id).replace(/\s*\(fictional\)/i, '').trim(); }
function shortCite(c, n = 40) {
  c = String(c || '').split(/[;(]/)[0].trim();
  return c.length > n ? c.slice(0, n - 1) + '…' : c;
}
// "Deposition of Witness B (fictional), claim at 27:46 …" -> "Depo 27:46"
function claimCite(c) {
  c = String(c || '');
  if (!c) return '';
  const ts = (c.match(/claim\s+at\s+(\d{1,2}:\d{2}(?::\d{2})?)/i) || c.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/) || [])[1];
  if (ts && /depo/i.test(c)) return 'Depo ' + ts;
  if (ts) return shortCite(c, 22) + ' ' + ts;
  return shortCite(c, 34);
}
function clip(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), n * 0.6)).replace(/[,.;:]$/, '') + '…';
}
function objBox(o, out = _box) { o.node.updateWorldMatrix(true, true); return out.setFromObject(o.node); }
function pos(o, out) { o.node.updateWorldMatrix(true, false); return o.node.getWorldPosition(out); }
function caseIdFrom() {
  const p = params.get('case');
  if (p) return p;
  const m = String(sl.worldUrl || '').match(/\/cases\/([^/]+)\/worlds\//);
  return m ? decodeURIComponent(m[1]) : null;
}
async function loadChecks() {
  const cid = caseIdFrom();
  const key = (cid || '') + '|' + (sl.worldUrl || '');
  if (checksFor === key) return;
  checksFor = key;
  try {
    const j = await (await fetch(cid ? '/api/cases/' + encodeURIComponent(cid) : '/api/state')).json();
    const st = (j && j.state) || j || {};
    checks = Array.isArray(j.checks) ? j.checks : Array.isArray(st.checks) ? st.checks : [];
    findings = Array.isArray(st.findings) ? st.findings : [];
  } catch (_) { checks = []; findings = []; }
  if (info) info.impact = findImpact();
  if (sl.renderFrame && world) sl.renderFrame();
}

// ---------- world analysis (once per load) ----------
function withTime(t, fn) {
  const prev = sl.time;
  world.setTime(t);
  world.root.updateMatrixWorld(true);
  try { return fn(); } finally { world.setTime(prev); world.root.updateMatrixWorld(true); }
}

function findImpact() {
  const tm = checks.find((c) => c && c.check === 'timing' && Number.isFinite(Number(c.impactT)));
  if (tm) return { t: Number(tm.impactT), cite: 'timing check' };
  const f = (world.facts || []).find((x) => x && /impact|collision|crash|struck|strike/i.test(x.text || '') && /^s(ec)?$/i.test(String(x.unit || '')) && Number.isFinite(Number(x.value)));
  if (f) return { t: Number(f.value), cite: f.citation || f.id };
  const m = world.meta || {};
  for (const k of ['impactTime', 'impactT', 'tImpact']) if (Number.isFinite(Number(m[k] ?? world[k]))) return { t: Number(m[k] ?? world[k]), cite: 'world meta' };
  // geometric fallback: first time two vehicles' boxes intersect (pairs already touching at t=0, e.g. tractor+trailer, ignored)
  const vs = Object.entries(world.objects).filter(([, o]) => o.kind === 'vehicle' && o.node);
  if (vs.length < 2) return null;
  const boxesAt = (t) => withTime(t, () => vs.map(([, o]) => objBox(o, new THREE.Box3())));
  const b0 = boxesAt(0);
  const skip = new Set();
  for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) if (b0[i].intersectsBox(b0[j])) skip.add(i + ',' + j);
  const T = world.duration || 10;
  for (let t = 0.05; t <= T; t += 0.05) {
    const b = boxesAt(t);
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
      if (!skip.has(i + ',' + j) && b[i].intersectsBox(b[j])) return { t: +t.toFixed(2), cite: 'first vehicle contact in model' };
    }
  }
  return null;
}

// clock anchor: a cited clock time of the impact ("Impact at 4:36:12.7 p.m. EDT") or meta.impactClock
function parseClock(s) {
  const m = String(s || '').match(/\b(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?(?:\s*([ECMP][SD]T|UTC|GMT|Z))?/i);
  if (!m) return null;
  let h = +m[1];
  const ap = m[4] ? m[4][0].toLowerCase() : null;
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  return { sec: h * 3600 + +m[2] * 60 + (m[3] ? +m[3] : 0), hasSec: !!m[3], tz: m[5] ? m[5].toUpperCase() : '' };
}
function findClock() {
  const m = world.meta || {};
  if (m.impactClock) { const c = parseClock(m.impactClock); if (c) return { ...c, cite: 'world meta' }; }
  for (const f of world.facts || []) {
    const txt = String(f.text || '');
    if (!/impact|collision|crash|struck/i.test(txt)) continue;
    const c = parseClock(txt);
    if (c && c.hasSec) return { ...c, cite: f.citation || f.id };
  }
  return null;
}
function fmtClock(sec, tz) {
  sec = ((sec % 86400) + 86400) % 86400;
  const h = Math.floor(sec / 3600), mi = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(mi)}:${s.toFixed(1).padStart(4, '0')}${tz ? ' ' + tz : ''}`;
}

function analyze() {
  speedCache.clear();
  visCache.clear();
  const vehicles = Object.entries(world.objects).filter(([, o]) => o && o.node && o.kind === 'vehicle').map(([id, o]) => ({ id, o, name: vehName(id, o) }));
  // one label per named unit (tractor + semitrailer both "Vehicle T"): keep the first
  const seen = new Set();
  for (const v of vehicles) { v.primary = !seen.has(v.name); seen.add(v.name); }
  const roads = Object.entries(world.objects).filter(([id, o]) => o && o.node && (o.kind === 'road' || id.startsWith('road_')) && o.label)
    .map(([id, o]) => ({ id, o, axis: roadAxis(o) })).filter((r) => r.axis);
  const signals = Object.entries(world.objects).filter(([, o]) => o && typeof o.state === 'function');
  const noMarksFact = (world.facts || []).find((f) => f && (f.kind === 'skid' || /tire|skid|brak/i.test(f.text || '')) && /\bno\b|none|absent|without/i.test(f.text || ''));
  info = { vehicles, roads, signals, noMarksFact, impact: null, clock: findClock() };
  info.impact = findImpact();
  info.stop = buildStopping();
}

// road centre line from the node-local bounding box (works for rotated asset roads and hand-built groups)
function roadAxis(o) {
  const node = o.node;
  node.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
  const bb = new THREE.Box3();
  node.traverse((m) => {
    if (!m.isMesh || !m.geometry) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    bb.union(m.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)));
  });
  if (bb.isEmpty()) return null;
  const s = bb.getSize(new THREE.Vector3());
  const alongX = s.x >= s.z;
  const len = alongX ? s.x : s.z, wid = alongX ? s.z : s.x;
  if (len < 12 || len < wid * 1.6) return null;
  const c = bb.getCenter(new THREE.Vector3());
  const a = c.clone(), b = c.clone();
  if (alongX) { a.x = bb.min.x; b.x = bb.max.x; } else { a.z = bb.min.z; b.z = bb.max.z; }
  a.y = b.y = 0;
  return { a: a.applyMatrix4(node.matrixWorld), b: b.applyMatrix4(node.matrixWorld), width: wid };
}

// ---------- speeds (checks.speedAt re-implemented: central difference, dt = 0.05) ----------
function speedsAt(t) {
  const key = Math.round(t * 1000);
  if (speedCache.has(key)) return speedCache.get(key);
  const T = world.duration || 10, dt = 0.05;
  const t0 = Math.max(0, t - dt), t1 = Math.min(T, t + dt);
  const out = new Map();
  if (t1 - t0 > 1e-6) {
    const p0 = withTime(t0, () => info.vehicles.map((v) => pos(v.o, new THREE.Vector3())));
    const p1 = withTime(t1, () => info.vehicles.map((v) => pos(v.o, new THREE.Vector3())));
    info.vehicles.forEach((v, i) => out.set(v.id, p0[i].distanceTo(p1[i]) / (t1 - t0)));
  }
  if (speedCache.size > 4000) speedCache.clear();
  speedCache.set(key, out);
  return out;
}

// ---------- stopping distance / brake point (from skids, or the stopping envelope when there are none) ----------
function buildStopping() {
  const imp = info.impact;
  const skid = (world.skids || []).find((s) => s && world.objects[s.vehicle]);
  let vid = skid ? skid.vehicle : null;
  if (!vid && imp) {
    let best = 0;
    const sp = speedsAt(Math.max(0, imp.t - 0.5));
    for (const v of info.vehicles) { const s = sp.get(v.id) || 0; if (s > best) { best = s; vid = v.id; } }
    if (best < 15 / MPH) vid = null;
  }
  if (!vid || !imp) return null;
  const o = world.objects[vid];
  // path from t=0 to impact (node origin), with cumulative distance measured back from impact
  const pts = withTime(0, () => {
    const a = [];
    for (let t = 0; t <= imp.t + 1e-6; t += 0.05) { world.setTime(Math.min(t, imp.t)); world.root.updateMatrixWorld(true); a.push(pos(o, new THREE.Vector3()).setY(0)); }
    world.setTime(imp.t); world.root.updateMatrixWorld(true); a.push(pos(o, new THREE.Vector3()).setY(0));
    return a;
  });
  const back = [0];
  for (let i = pts.length - 2; i >= 0; i--) back.unshift(back[0] + pts[i].distanceTo(pts[i + 1]));
  const pathLen = back[0];
  const at = (d) => { // point + travel direction at distance d before impact
    d = Math.max(0, Math.min(pathLen, d));
    for (let i = 0; i < pts.length - 1; i++) {
      if (back[i] >= d && back[i + 1] <= d) {
        const seg = back[i] - back[i + 1] || 1e-6;
        const f = (back[i] - d) / seg;
        const p = pts[i].clone().lerp(pts[i + 1], f);
        const dir = pts[i + 1].clone().sub(pts[i]).setY(0);
        if (dir.lengthSq() < 1e-9) dir.set(1, 0, 0);
        return { p, dir: dir.normalize() };
      }
    }
    const dir = pts[pts.length - 1].clone().sub(pts[Math.max(0, pts.length - 2)]).setY(0).normalize();
    return { p: pts[pts.length - 1].clone(), dir: dir.lengthSq() ? dir : new THREE.Vector3(1, 0, 0) };
  };
  objBox(o, _box2);
  const sz = _box2.getSize(new THREE.Vector3());
  const halfW = Math.max(1.8, Math.min(sz.x, sz.z) * 0.9);
  const name = vehName(vid, o);
  if (skid) {
    const L = Number(skid.length) || 0;
    const chk = checks.find((c) => c && /skid/i.test(c.check || '') && (c.subject === vid || c.vehicle === vid));
    let lo, hi, mu = [0.6, 0.8];
    if (chk && chk.range && Array.isArray(chk.range.mph)) { [lo, hi] = chk.range.mph; if (chk.range.mu) mu = chk.range.mu; }
    else { lo = Math.sqrt(2 * mu[0] * G * L) * MPH; hi = Math.sqrt(2 * mu[1] * G * L) * MPH; }
    return { kind: 'skid', vid, name, at, pathLen, halfW, L, lo, hi, mu, cite: skid.citation || '' };
  }
  const v = (() => { const s = speedsAt(Math.max(0, imp.t - 0.5)).get(vid) || 0; return s; })();
  const brake = (mu) => (v * v) / (2 * mu * G);
  return { kind: 'envelope', vid, name, at, pathLen, halfW, v, db: brake(0.7), dbLo: brake(0.8), dbHi: brake(0.6), prt: 1.5, dp: v * 1.5 };
}

// ---------- WebGL helpers (rebuilt per frame; a handful of meshes) ----------
function clearGroup() {
  for (const c of [...group.children]) {
    group.remove(c);
    c.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
}
function basic(color, opacity = 1, depthTest = true) {
  const m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1 || !depthTest, opacity, depthTest, depthWrite: false, side: THREE.DoubleSide });
  m.toneMapped = false;
  return m;
}
// flat strip on the ground from a to b (y = lift), width w
function strip(a, b, w, mat, lift = 0.07) {
  const d = b.clone().sub(a).setY(0);
  const len = d.length();
  if (len < 1e-4) return null;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, w), mat);
  m.rotation.set(-Math.PI / 2, 0, 0);
  m.rotateZ(-Math.atan2(d.z, d.x));
  m.position.set((a.x + b.x) / 2, lift, (a.z + b.z) / 2);
  m.renderOrder = 14;
  group.add(m);
  return m;
}

// ---------- sight line: Line2 (screen-space width, anti-aliased) ----------
function mkLine(width, opacity, depthTest, dashed) {
  const m = new LineMaterial({ color: 0xffffff, linewidth: width, worldUnits: false, transparent: true, opacity, depthTest, depthWrite: false, dashed: !!dashed, dashSize: 0.6, gapSize: 0.4, alphaToCoverage: false });
  m.toneMapped = false;
  const l = new Line2(new LineGeometry(), m);
  l.frustumCulled = false;
  l.renderOrder = depthTest ? 15 : 16;
  l.visible = false;
  sightGroup.add(l);
  return l;
}
const SIGHT = {
  main: mkLine(3.5, 1, true),          // eye -> obstruction (or target), depth-tested
  ghost: mkLine(3.5, 0.36, false),     // same segment drawn faintly through geometry, so it is never lost
  rest: mkLine(1.6, 0.8, false, true), // obstruction -> target, dashed grey (the part she could not see)
};
function hideSight() { for (const l of Object.values(SIGHT)) l.visible = false; }
function setLine(l, a, b, color, W, H, dash) {
  l.geometry.dispose();
  l.geometry = new LineGeometry();
  l.geometry.setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
  l.material.color.setHex(color);
  l.material.resolution.set(W, H);
  if (l.material.dashed && dash) { l.material.dashSize = dash; l.material.gapSize = dash * 0.7; l.computeLineDistances(); }
  l.visible = true;
}

function selectedWitness(camId) {
  const ws = world.witnesses || [];
  const camW = ws.find((w) => w.id === camId);
  if (camW) return camW;
  if (selWitness) { const w = ws.find((x) => x.id === selWitness); if (w) return w; }
  const failing = checks.find((c) => c && c.check === 'sightline' && c.pass === false && ws.some((w) => w.id === c.subject));
  return failing ? ws.find((w) => w.id === failing.subject) : ws[0] || null;
}
function liveSight(w) {
  if (typeof sl.sightline === 'function') { try { return sl.sightline(w.id); } catch (_) {} }
  return null;
}
// visibility timeline for a witness (0.1 s samples), used for "NOW VISIBLE / NOW HIDDEN" triggers
function visSeries(w) {
  if (visCache.has(w.id)) return visCache.get(w.id);
  const out = [];
  if (typeof sl.sightline === 'function') {
    const T = world.duration || 10;
    try {
      for (let i = 0; i * 0.1 <= T + 1e-6; i++) {
        const t = +(i * 0.1).toFixed(2);
        const r = sl.sightline(w.id, t);
        out.push({ t, vis: !!(r && r.visible), by: r && r.blockedBy });
      }
    } catch (_) {}
    world.setTime(sl.time || 0);
    world.root.updateMatrixWorld(true);
  }
  visCache.set(w.id, out);
  return out;
}
// when did the current state (visible / hidden) begin? null = for the whole timeline so far
function stateSince(w, t, vis) {
  const s = visSeries(w);
  if (!s.length) return null;
  let j = Math.min(s.length - 1, Math.floor(t / 0.1 + 1e-6));
  if (s[j].vis !== vis) return t;
  while (j >= 0 && s[j].vis === vis) j--;
  return j < 0 ? null : s[j + 1].t;
}
function pronounFor(w) {
  const txt = findings.filter((f) => f && ((f.involves || []).includes(w.id) || JSON.stringify(f).includes(witName(w)))).map((f) => (f.summary || '') + ' ' + (f.detail || '')).join(' ');
  const she = (txt.match(/\b(she|her)\b/gi) || []).length, he = (txt.match(/\b(he|his|him)\b/gi) || []).length;
  return she > he ? 'her' : he > she ? 'his' : 'the';
}

// ---------- projection ----------
function projector(cam, W, H) {
  return (p) => {
    _v2.copy(p).applyMatrix4(cam.matrixWorldInverse);
    const front = cam.isOrthographicCamera || _v2.z < -0.05;
    _v.copy(p).project(cam);
    return { x: (_v.x + 1) / 2 * W, y: (1 - _v.y) / 2 * H, front, on: front && _v.x > -1.05 && _v.x < 1.05 && _v.y > -1.05 && _v.y < 1.05 };
  };
}
const rectsHit = (a, b, m = 3) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
const clampRect = (r, W, H) => { r.x = Math.max(6, Math.min(W - r.w - 6, r.x)); r.y = Math.max(6, Math.min(H - r.h - 30, r.y)); return r; };
function elRect(el) {
  if (!el || el.hidden) return null;
  const a = el.getBoundingClientRect(), s = stage.getBoundingClientRect();
  return a.width ? { x: a.left - s.left, y: a.top - s.top, w: a.width, h: a.height } : null;
}

// occluded from the current camera? (labels for hidden vehicles are drawn dashed + "(not in view)")
function hiddenFromCam(cam, id, p) {
  if (cam.isOrthographicCamera) return false;
  const eye = cam.getWorldPosition(new THREE.Vector3());
  const dir = p.clone().sub(eye);
  const dist = dir.length();
  if (dist < 0.5) return false;
  raycaster.set(eye, dir.normalize());
  raycaster.near = 0.2; raycaster.far = dist - 0.3;
  const self = world.objects[id] && world.objects[id].node;
  const occ = Object.entries(world.objects).filter(([k, o]) => o.occludes && o.node && k !== id && o.node !== self).map(([, o]) => o.node);
  const hits = raycaster.intersectObjects(occ, true);
  raycaster.far = Infinity;
  return hits.some((h) => h.object.isMesh && visibleChain(h.object));
}
function visibleChain(o) { while (o) { if (o.visible === false) return false; o = o.parent; } return true; }

// ---------- telemetry HUD ----------
function hudHtml(t, speeds, sight) {
  const boxes = [];
  const imp = info.impact;
  const rows = [`<div class="slo-t">t = ${t.toFixed(2)} s</div>`];
  if (info.clock && imp) {
    rows.push(`<div class="slo-clock" title="Clock anchored to the cited time of impact: ${esc(info.clock.cite)}">${fmtClock(info.clock.sec + (t - imp.t), info.clock.tz)}</div>`);
  } else if (world.meta && world.meta.timeOfDay) {
    rows.push(`<div class="slo-clock approx" title="Time of day from the world metadata; no cited clock time of impact">time of day ≈ ${esc(world.meta.timeOfDay)}</div>`);
  }
  if (imp) {
    const d = t - imp.t;
    const ttl = `Impact at t = ${imp.t.toFixed(2)} s (${imp.cite})`;
    if (Math.abs(d) < 0.025) rows.push(`<div class="slo-imp now" title="${esc(ttl)}">IMPACT</div>`);
    else if (d < 0) rows.push(`<div class="slo-imp pre" title="${esc(ttl)}">IMPACT IN ${(-d).toFixed(2)} s</div>`);
    else rows.push(`<div class="slo-imp post" title="${esc(ttl)}">IMPACT +${d.toFixed(2)} s</div>`);
  }
  boxes.push(`<div class="slo-sec">${rows.join('')}</div>`);

  // per-vehicle speed (one row per named unit)
  const vr = info.vehicles.filter((v) => v.primary).slice(0, 5).map((v) => {
    const mps = speeds.get(v.id) || 0;
    const mph = Math.round(mps * MPH);
    return `<div class="slo-vrow${isInf(v.o) ? ' inferred' : ''}" title="${esc((v.o.label || v.id) + '\nSpeed: model position change over t±0.05 s' + (v.o.citation ? '\nSource: ' + v.o.citation : ''))}"><span>${esc(v.name.toUpperCase())}</span><b>${mph >= 1 ? mph : 0}</b><em>${mph >= 1 ? 'mph' : 'stopped'}</em></div>`;
  });
  // signals
  for (const [id, o] of info.signals.slice(0, 4)) {
    let st = 'off';
    try { st = String(o.state(t) || 'off').toLowerCase(); } catch (_) {}
    if (!/^(red|yellow|amber|green|off|flashing.*)$/.test(st)) st = 'off';
    vr.push(`<div class="slo-sig ${st.split(/\W/)[0]}" title="${esc((o.label || id) + (o.citation ? ' — ' + o.citation : ''))}"><i></i><span>${esc(shortLabel(o.label || id, 26).toUpperCase())}</span><b>${esc(st.toUpperCase())}</b></div>`);
  }
  if (vr.length) boxes.push(`<div class="slo-sec slo-units">${vr.join('')}</div>`);

  // sight-line state trigger for the selected witness
  if (sight) {
    const { w, r } = sight;
    const tgt = typeof w.lookAt === 'string' && world.objects[w.lookAt] ? vehName(w.lookAt, world.objects[w.lookAt]).toUpperCase() : 'TARGET';
    const who = witName(w).toUpperCase();
    const since = stateSince(w, t, !!r.visible);
    const now = since != null && t - since < TRIGGER_S && since > 0.05;
    const head = r.visible ? `${tgt} ${now ? 'NOW ' : ''}VISIBLE TO ${who}` : `${tgt} ${now ? 'NOW ' : ''}HIDDEN FROM ${who}`;
    const sub = (r.visible ? 'line of sight clear' : 'behind ' + partName(r.blockedBy)) + (since == null || since <= 0.05 ? ' · whole timeline so far' : ` · since t = ${since.toFixed(1)} s`);
    boxes.push(`<div class="slo-sec slo-state ${r.visible ? 'ok status-consistent' : 'bad status-contradiction'}${now ? ' now' : ''}" data-verdict="${r.visible ? 'VISIBLE' : 'BLOCKED'}"><b>${esc(head)}</b><span>${esc(sub)}</span></div>`);
  }
  return `<div class="slo-box slo-panel">${boxes.join('')}</div>`;
}

// ---------- lower-third narrative card ----------
// One card at the bottom carries every sentence: the selected witness's claim + measured result, and
// (overhead / chase) the stopping-distance note. Nothing paragraph-like is drawn in 3D space.
function stopLine() {
  const st = info.stop;
  if (!st) return null;
  if (st.kind === 'skid') return { cls: '', text: `${st.name}: skid ${fmtM(st.L)} → ${Math.round(st.lo)}–${Math.round(st.hi)} mph (μ ${st.mu[0]}–${st.mu[1]})`, cite: shortCite(st.cite, 30) };
  const nm = info.noMarksFact;
  return {
    cls: nm ? 'warn' : '',
    text: `${st.name} at ${fmtMph(st.v)}: must brake by ${Math.round(st.db)} m before impact (μ 0.7), perceive by ${Math.round(st.db + st.dp)} m (PRT 1.5 s)${nm ? ' · actual brake point: none recorded' : ''}`,
    cite: nm && nm.citation ? shortCite(nm.citation, 26) : '',
  };
}
function cardHtml(w, r, t, camId, cam) {
  const chk = checks.find((c) => c && c.check === 'sightline' && c.subject === w.id);
  const who = witName(w).toUpperCase();
  const cite = w.citation || (chk && chk.citation) || '';
  const lines = [];
  const verdict = r ? (r.visible ? 'CLEAR' : 'BLOCKED') : '';
  lines.push(`<div class="slo-card-k"><span>FROM ${esc(who)}${/S$/.test(who) ? "'" : "'S"} POSITION</span>${verdict ? `<i class="slo-pill ${r.visible ? 'ok status-consistent' : 'bad status-contradiction'}">${verdict}</i>` : ''}</div>`);
  if (w.claim) {
    const cc = claimCite(cite);
    const inf = INFERRED_RE.test(cite);
    lines.push(`<div class="slo-card-claim">Claim: “${esc(clip(w.claim, 118))}”${cc ? ` <span class="citation${inf ? ' inferred' : ''}" title="${esc(cite)}">(${esc(cc)})</span>` : ''}${inf ? '<span class="tag-inferred">inferred</span>' : ''}</div>`);
  }
  const meas = [];
  const rb = chk && chk.robustness;
  if (rb && rb.samples) {
    const n = Number(rb.samples), blocked = Number(rb.blocked ?? n - Number(rb.clear || 0)), clear = n - blocked;
    const rad = rb.radiusM != null ? rb.radiusM : 2;
    const mark = `within ${rad} m of ${pronounFor(w)} mark`;
    meas.push(blocked > 0 ? `Blocked from ${blocked} of ${n} positions ${mark}` : `Clear from ${clear} of ${n} positions ${mark}`);
  }
  const g = chk && chk.gaze;
  if (g && Number.isFinite(Number(g.offAxisDeg))) meas.push(`target ${Math.round(Number(g.offAxisDeg))}° off gaze${g.assumed ? ' (assumed)' : ''}`);
  const cls = rb && Number(rb.blocked) > 0 ? 'bad' : rb ? 'ok' : r && !r.visible ? 'bad' : 'ok';
  if (meas.length) lines.push(`<div class="slo-card-m finding ${cls}">${esc(meas.join(' · '))}</div>`);
  // live ray at this instant
  const notes = [];
  if (r) {
    const tgt = typeof w.lookAt === 'string' && world.objects[w.lookAt] ? vehName(w.lookAt, world.objects[w.lookAt]) : 'target';
    notes.push(r.visible ? `Now: ${tgt} in view, ${fmtM(r.distance)}` : `Now: ${tgt} hidden behind ${partName(r.blockedBy)} (${fmtM(r.distanceToBlocker || 0)} away; ${tgt} ${fmtM(r.distance)})`);
  }
  const camFov = (cam && cam.isPerspectiveCamera && cam.fov) || (g && g.cameraFovDeg) || 60;
  if (camId === w.id) notes.push(`camera FOV ${Math.round(camFov)}°${Math.round(camFov) !== 60 ? ' (widened: target close)' : ''}, eye ${w.eyeHeight || 1.6} m`);
  if (chk && chk.t != null && Math.abs(Number(chk.t) - t) > 0.05) notes.push(`check measured at t = ${Number(chk.t).toFixed(1)} s`);
  if (notes.length) lines.push(`<div class="slo-card-n">${esc(notes.join(' · '))}</div>`);
  if (camId !== w.id) {
    const sline = stopLine();
    if (sline) lines.push(`<div class="slo-card-s ${sline.cls}"><b>STOPPING</b> ${esc(sline.text)}${sline.cite ? ` <span class="citation">(${esc(sline.cite)})</span>` : ''}</div>`);
  }
  return lines.join('');
}

// ---------- per-frame update ----------
function update(cam) {
  clearGroup();
  hideSight();
  syncToggle();
  { const rg = scene && scene.getObjectByName('__sl_rays'); if (rg) rg.visible = true; } // re-hidden below in minimal overhead
  if (!enabled || !world || !info) { layer.innerHTML = ''; cardEl.hidden = true; return; }
  const W = stage.clientWidth || window.innerWidth, H = stage.clientHeight || window.innerHeight;
  const t = sl.time || 0;
  const camId = sl.camera || 'overhead';
  const full = modeFor(camId) === 'full';
  const overhead = camId === 'overhead';
  const isChase = camId.startsWith('chase_');
  const isWit = !overhead && !isChase;
  const proj = projector(cam, W, H);
  const mpp = cam.isOrthographicCamera ? (cam.top - cam.bottom) / cam.zoom / H : 0; // metres per pixel (overhead)
  const html = [];
  const svg = [];
  const placed = [];
  const speeds = speedsAt(t);

  // selected witness + live sight line (viewer's raycaster at this exact instant)
  const w = (world.witnesses || []).length ? selectedWitness(camId) : null;
  const r = w ? liveSight(w) : null;

  // ---- telemetry HUD + lower-third card (persistent elements; obstacles for the rest) ----
  setHtml(hudEl, hudHtml(t, speeds, w && r ? { w, r } : null), 'hud');
  const showCard = !!(w && r);
  if (showCard) setHtml(cardEl, cardHtml(w, r, t, camId, cam), 'card');
  cardEl.hidden = !showCard;
  for (const el of [hudEl, cardEl, btn, document.querySelector('.sl-hud'), document.querySelector('.ao-stage')]) { const q = elRect(el); if (q) placed.push(q); }

  // the viewer's own overhead label sprites: minimal keeps witness names only (object / "inferred" labels are
  // full-mode or hover); a label that would overlap one already placed is dropped, never stacked
  if (overhead) {
    const sprites = [];
    scene.traverse((o) => { if (o.isSprite && o.visible && o.parent !== group && visibleChain(o)) sprites.push(o); });
    sprites.sort((a, b) => (a.userData.kind === 'witness' ? 0 : 1) - (b.userData.kind === 'witness' ? 0 : 1));
    for (const o of sprites) {
      if (!full && o.userData.kind === 'object') { o.visible = false; continue; }
      const c = proj(o.getWorldPosition(new THREE.Vector3()));
      const sw = o.scale.x / mpp, sh = o.scale.y / mpp;
      const q = { x: c.x - sw / 2, y: c.y - sh / 2, w: sw, h: sh };
      if (placed.some((z) => rectsHit(z, q, 2))) { o.visible = false; continue; }
      placed.push(q);
    }
    // amber dashed "inferred" boxes and the all-witness overhead rays: full mode only (minimal = the active sight line)
    if (!full) scene.traverse((o) => { if ((o.isLineSegments && /^inferred_/.test(o.name || '')) || (o.name === '__sl_rays' && w && r)) o.visible = false; });
  }

  // ---- (full) stopping distance / brake point bars on the road, one-word tags; the sentence is in the card ----
  const stop = info.stop;
  if (full && stop && (overhead || isChase)) {
    const lw = overhead ? Math.max(0.25, 2.2 * mpp) : 0.22;
    const bar = (d, color, op = 0.95) => {
      const { p, dir } = stop.at(d);
      const n = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(stop.halfW);
      strip(p.clone().add(n), p.clone().sub(n), lw * 1.6, basic(color, op));
      return { p, dir, n };
    };
    const side = (pp, nn, k = 1.25) => pp.clone().add(nn.clone().multiplyScalar(k));
    const tag = (pp, cls, title, l1) => {
      const s = proj(pp);
      if (!s.on) return;
      const tw = textW(l1, `600 10px ${MONO}`) + 12, th = 17;
      const q = clampRect({ x: s.x - tw / 2, y: s.y + 4, w: tw, h: th }, W, H);
      for (let k = 0; k < 6 && placed.some((z) => rectsHit(z, q)); k++) q.y += th + 3;
      placed.push(q);
      html.push(`<div class="slo-mark ${cls}" style="transform:translate(${q.x.toFixed(1)}px,${q.y.toFixed(1)}px)" title="${esc(title)}"><b>${esc(l1)}</b></div>`);
    };
    if (stop.kind === 'skid') {
      const segs = 24;
      for (let i = 0; i < segs; i++) {
        const a = stop.at(stop.L * i / segs).p, b = stop.at(stop.L * (i + 1) / segs).p;
        strip(a, b, lw, basic(C_MARK, 0.9));
      }
      const bp = bar(stop.L, C_BLOCK);
      bar(0, C_MARK, 0.6);
      tag(side(bp.p, bp.n), 'brake', stop.cite, `skid start · ${Math.round(stop.lo)}–${Math.round(stop.hi)} mph`);
    } else {
      // envelope: where braking (mu 0.6-0.8) and perception (PRT 1.5 s) would have had to start to stop short of impact
      const steps = 16;
      for (let i = 0; i < steps; i++) {
        const a = stop.at(stop.dbLo + (stop.dbHi - stop.dbLo) * i / steps).p, b = stop.at(stop.dbLo + (stop.dbHi - stop.dbLo) * (i + 1) / steps).p;
        strip(a, b, stop.halfW * 2, basic(C_ZONE, 0.18), 0.065);
      }
      for (let i = 0; i < 40; i++) { // centre guide along the stopping distance
        if (i % 2) continue;
        const D = stop.db + stop.dp;
        strip(stop.at(D * i / 40).p, stop.at(D * (i + 1) / 40).p, lw * 0.8, basic(C_MARK, 0.85));
      }
      const b1 = bar(stop.db, C_AMBER);
      const b2 = bar(Math.min(stop.pathLen, stop.db + stop.dp), C_MARK);
      tag(side(b1.p, b1.n), 'brake', 'Braking distance v²/(2μg), μ 0.7 (band 0.6–0.8)', `brake by · ${Math.round(stop.db)} m`);
      tag(side(b2.p, b2.n), 'perceive', 'Perception-reaction 1.5 s typical (range 1.0–2.5 s)', `perceive by · ${Math.round(stop.db + stop.dp)} m`);
    }
  }

  // ---- sight line for the selected witness (Line2; its explanation lives in the card) ----
  if (w && r) {
    const from = new THREE.Vector3(...r.from), to = new THREE.Vector3(...r.to);
    const hit = r.hit ? new THREE.Vector3(...r.hit) : null;
    const col = r.visible ? C_CLEAR : C_BLOCK;
    if (overhead || isChase) {
      const end = hit || to;
      if (overhead) {
        const lift = (p) => p.clone().setY(6.4);
        setLine(SIGHT.ghost, lift(from), lift(end), col, W, H);
        SIGHT.ghost.material.opacity = 1;
        if (hit) setLine(SIGHT.rest, lift(hit), lift(to), C_REST, W, H, Math.max(0.3, 7 * mpp));
        const e = proj(from), q = proj(end);
        svg.push(`<circle class="slo-eye" cx="${e.x.toFixed(1)}" cy="${e.y.toFixed(1)}" r="3.5"/><circle class="slo-end ${r.visible ? 'ok' : 'bad'}" cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="4"/>`);
      } else {
        setLine(SIGHT.main, from, end, col, W, H);
        setLine(SIGHT.ghost, from, end, col, W, H);
        SIGHT.ghost.material.opacity = 0.36;
        if (hit) setLine(SIGHT.rest, hit, to, C_REST, W, H, 0.5);
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), basic(col, 1));
        dot.position.copy(end); group.add(dot);
        const eyeM = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), basic(C_AMBER, 1));
        eyeM.position.copy(from); group.add(eyeM);
      }
    } else if (isWit && w.id === camId) {
      // witness's own view: reticle on the target; the sight line runs straight into the lens, so no 3D line
      const tp = proj(to);
      if (tp.on) {
        const x = tp.x.toFixed(1), y = tp.y.toFixed(1);
        svg.push(`<g class="slo-ret ${r.visible ? 'ok' : 'bad'}"><circle cx="${x}" cy="${y}" r="11"/><line x1="${(tp.x - 18).toFixed(1)}" y1="${y}" x2="${(tp.x - 7).toFixed(1)}" y2="${y}"/><line x1="${(tp.x + 7).toFixed(1)}" y1="${y}" x2="${(tp.x + 18).toFixed(1)}" y2="${y}"/><line x1="${x}" y1="${(tp.y - 18).toFixed(1)}" x2="${x}" y2="${(tp.y - 7).toFixed(1)}"/><line x1="${x}" y1="${(tp.y + 7).toFixed(1)}" x2="${x}" y2="${(tp.y + 18).toFixed(1)}"/></g>`);
        placed.push({ x: tp.x - 20, y: tp.y - 20, w: 40, h: 40 });
      }
    }
  }

  // ---- vehicle tags: "A · 74 mph", small, with a leader to the vehicle ----
  const vlabels = [];
  for (const v of info.vehicles) {
    if (!v.primary) continue;
    if (!visibleChain(v.o.node)) continue;
    if (camId === 'chase_' + v.id) continue;            // the chase vehicle's own speed is in the HUD
    objBox(v.o, _box);
    if (_box.isEmpty()) continue;
    const c = _box.getCenter(new THREE.Vector3());
    const anchor = overhead ? new THREE.Vector3(c.x, _box.max.y, _box.max.z) : new THREE.Vector3(c.x, _box.max.y + 0.3, c.z);
    const s = proj(anchor);
    if (!s.on) continue;
    const mps = speeds.get(v.id) || 0;
    const moving = mps * MPH >= 0.5;
    const hidden = isWit && hiddenFromCam(cam, v.id, c);
    const inf = isInf(v.o);
    const l1 = v.name.replace(/^Vehicle\s+/, '');
    const l2 = moving ? fmtMph(mps) : 'stopped';
    const fw = textW(l1, `700 11px ${MONO}`) + textW(' · ' + l2, `600 11px ${MONO}`) + 14;
    vlabels.push({ v, s, l1, l2, hidden, w: fw, h: 19, inf, mps, dist: cam.isOrthographicCamera ? 0 : cam.position.distanceTo(c) });
  }
  // nearer vehicles first get the best spot; overhead labels go below the vehicle, perspective above
  vlabels.sort((a, b) => a.dist - b.dist);
  for (const L of vlabels) {
    const gap = overhead ? 8 : 18;
    const q = { x: L.s.x - L.w / 2, y: overhead ? L.s.y + gap : L.s.y - gap - L.h, w: L.w, h: L.h };
    q.x = Math.max(6, Math.min(W - L.w - 6, q.x));
    for (let k = 0; k < 10 && placed.some((z) => rectsHit(z, q)); k++) q.y += overhead ? L.h + 4 : -(L.h + 4);
    q.y = Math.max(4, Math.min(H - L.h - 30, q.y));
    if (placed.some((z) => rectsHit(z, q, 1))) continue; // no free spot: drop the tag rather than overlap (speed is in the HUD)
    placed.push(q);
    const ly = overhead ? q.y : q.y + L.h;
    svg.push(`<line class="slo-lead${L.hidden ? ' hid' : ''}" x1="${L.s.x.toFixed(1)}" y1="${L.s.y.toFixed(1)}" x2="${(q.x + q.w / 2).toFixed(1)}" y2="${ly.toFixed(1)}"/><circle class="slo-anc" cx="${L.s.x.toFixed(1)}" cy="${L.s.y.toFixed(1)}" r="2"/>`);
    html.push(`<div class="slo-veh${L.hidden ? ' hid' : ''}${L.inf ? ' inf' : ''}" style="transform:translate(${q.x.toFixed(1)}px,${q.y.toFixed(1)}px)" title="${esc((L.v.o.label || L.v.id) + (L.hidden ? '\n(not in view from this camera)' : '') + (L.inf ? '\nPosition inferred' : '') + (L.v.o.citation ? '\nSource: ' + L.v.o.citation : '') + '\nSpeed: model position change over t±0.05 s')}"><b>${esc(L.l1)}</b><span>· ${esc(L.l2)}</span></div>`);
  }

  // ---- (full) gap: thin dimension line between the fastest vehicle and the nearest other unit, before impact ----
  const imp = info.impact;
  if (full && (overhead || isChase) && info.vehicles.length > 1 && (!imp || t < imp.t - 0.02)) {
    let fast = null, fv = 0;
    for (const v of info.vehicles) { const s = speeds.get(v.id) || 0; if (s > fv) { fv = s; fast = v; } }
    if (fast && fv * MPH > 3) {
      const fb = objBox(fast.o, new THREE.Box3());
      let best = null;
      for (const v of info.vehicles) {
        if (v === fast || v.name === fast.name) continue;
        const ob = objBox(v.o, new THREE.Box3());
        const d = fb.distanceToPoint(ob.clampPoint(fb.getCenter(new THREE.Vector3()), new THREE.Vector3()));
        if (!best || d < best.d) best = { v, ob, d };
      }
      if (best && best.d > 0.3 && best.d < 250) {
        const p2 = best.ob.clampPoint(fb.getCenter(new THREE.Vector3()), new THREE.Vector3());
        const p1 = fb.clampPoint(p2, new THREE.Vector3());
        p2.copy(best.ob.clampPoint(p1, new THREE.Vector3()));
        const gd = p1.distanceTo(p2);
        p1.y = p2.y = overhead ? 6.3 : 0.15;
        const a = proj(p1), b = proj(p2);
        if (a.on && b.on && Math.hypot(a.x - b.x, a.y - b.y) > 24) {
          const ang = Math.atan2(b.y - a.y, b.x - a.x), nx = -Math.sin(ang) * 5, ny = Math.cos(ang) * 5;
          let deg = ang * 180 / Math.PI;
          if (deg > 90) deg -= 180; else if (deg < -90) deg += 180;
          const l = `${Math.round(gd)} m · ${(gd / fv).toFixed(2)} s`;
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          svg.push(`<g class="slo-gap"><line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/><line x1="${(a.x - nx).toFixed(1)}" y1="${(a.y - ny).toFixed(1)}" x2="${(a.x + nx).toFixed(1)}" y2="${(a.y + ny).toFixed(1)}"/><line x1="${(b.x - nx).toFixed(1)}" y1="${(b.y - ny).toFixed(1)}" x2="${(b.x + nx).toFixed(1)}" y2="${(b.y + ny).toFixed(1)}"/><text x="${mx.toFixed(1)}" y="${(my - 5).toFixed(1)}" transform="rotate(${deg.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)})"><title>Closest distance between the two vehicles' bounding boxes at this instant; time = gap / current speed (${fmtMph(fv)})</title>${esc(l)}</text></g>`);
        }
      }
    }
  }

  // ---- road / street labels (overhead only), along the road axis, placed last in free space; minimal: main road only ----
  if (overhead) {
    const axLen = (rd) => rd.axis.a.distanceTo(rd.axis.b);
    for (const rd of (full ? info.roads : info.roads.slice().sort((x, y) => axLen(y) - axLen(x)).slice(0, 1))) {
      const a = proj(rd.axis.a), b = proj(rd.axis.b);
      // clip segment to the viewport (inset)
      const seg = clipSeg(a, b, 40, 60, W - 40, H - 40);
      if (!seg) continue;
      let ang = Math.atan2(seg[1].y - seg[0].y, seg[1].x - seg[0].x) * 180 / Math.PI;
      let [p0, p1] = seg;
      if (ang > 90 || ang <= -90) { ang += ang > 0 ? -180 : 180; [p0, p1] = [p1, p0]; }
      const l1 = shortLabel(rd.o.label, 40);
      const inf = isInf(rd.o);
      const l2 = inf ? 'inferred' : '';
      const wd = Math.max(textW(l1.toUpperCase(), `600 10px ${MONO}`) * 1.12, l2 ? textW(l2, `500 9px ${MONO}`) : 0) + 10, hh = l2 ? 26 : 16;
      const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      if (segLen < wd * 0.8) continue;
      const rad = ang * Math.PI / 180, cs = Math.abs(Math.cos(rad)), sn = Math.abs(Math.sin(rad));
      const bw = wd * cs + hh * sn, bh = wd * sn + hh * cs;
      let spot = null;
      for (const f of [0.18, 0.82, 0.32, 0.68, 0.08, 0.92, 0.5]) {
        const cx = p0.x + (p1.x - p0.x) * f, cy = p0.y + (p1.y - p0.y) * f;
        const q = { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
        if (q.x < 4 || q.y < 4 || q.x + q.w > W - 4 || q.y + q.h > H - 30) continue;
        if (!placed.some((z) => rectsHit(z, q, 2))) { spot = { cx, cy, r: q }; break; }
      }
      if (!spot) continue;
      placed.push(spot.r);
      html.push(`<div class="slo-road${inf ? ' inf' : ''}" style="left:${spot.cx.toFixed(1)}px;top:${spot.cy.toFixed(1)}px;transform:translate(-50%,-50%) rotate(${ang.toFixed(1)}deg)" title="${esc(rd.o.label + (rd.o.citation ? '\nSource: ' + rd.o.citation : ''))}"><b>${esc(l1)}</b>${l2 ? `<span>${esc(l2)}</span>` : ''}</div>`);
    }
  }

  layer.innerHTML = `<svg class="slo-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg.join('')}</svg>${html.join('')}`;
  group.updateMatrixWorld(true);
  sightGroup.updateMatrixWorld(true);
}

// Liang-Barsky clip of screen segment a-b to a rectangle
function clipSeg(a, b, x0, y0, x1, y1) {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const P = [-dx, dx, -dy, dy], Q = [a.x - x0, x1 - a.x, a.y - y0, y1 - a.y];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(P[i]) < 1e-9) { if (Q[i] < 0) return null; continue; }
    const r = Q[i] / P[i];
    if (P[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [{ x: a.x + dx * t0, y: a.y + dy * t0 }, { x: a.x + dx * t1, y: a.y + dy * t1 }];
}

// ---------- hook into the render ----------
let busy = false;
function install() {
  if (!world || !world.root) return;
  const s = world.root.parent;
  if (!s) return;
  if (scene !== s) { if (scene) { scene.remove(group); scene.remove(sightGroup); } scene = s; }
  if (group.parent !== scene) scene.add(group);
  if (sightGroup.parent !== scene) scene.add(sightGroup);
  if (scene.onBeforeRender && scene.onBeforeRender.__slo) return;
  const prev = scene.onBeforeRender;
  const hook = function (r, sc, cam, rt) {
    if (prev && prev !== THREE.Object3D.prototype.onBeforeRender) prev.call(this, r, sc, cam, rt);
    if (busy) return;
    busy = true;
    try { update(cam); } catch (e) { console.warn('overlays:', e); } finally { busy = false; }
  };
  hook.__slo = true;
  scene.onBeforeRender = hook;
}

function onLoaded() {
  world = sl.world;
  if (!world) return;
  checksFor = null;
  lastHud = lastCard = '';
  try { analyze(); } catch (e) { console.warn('overlays: analyze failed', e); info = null; }
  install();
  loadChecks().then(() => { try { if (info) info.stop = buildStopping(); } catch (_) {} if (sl.renderFrame) sl.renderFrame(); });
  if (sl.renderFrame) sl.renderFrame();
}

sl.events.addEventListener('loaded', onLoaded);
sl.events.addEventListener('pick', (e) => { const d = e.detail; if (d && d.type === 'witness') { selWitness = d.id; if (sl.renderFrame) sl.renderFrame(); } });
sl.events.addEventListener('witnesses', () => { visCache.clear(); if (sl.renderFrame) sl.renderFrame(); });
if (sl.world) onLoaded();
// render_quality may re-assign scene.onBeforeRender after we install; re-check cheaply
setInterval(() => { if (world && scene && !(scene.onBeforeRender && scene.onBeforeRender.__slo)) { install(); if (sl.renderFrame) sl.renderFrame(); } }, 500);

sl.overlays = {
  set: setEnabled,
  get enabled() { return enabled; },
  selectWitness(id) { selWitness = id || null; if (sl.renderFrame) sl.renderFrame(); },
  refresh() { if (sl.world) onLoaded(); },
  info: () => info && { impact: info.impact, clock: info.clock, stop: info.stop && { ...info.stop, at: undefined }, roads: info.roads.map((r) => r.id), signals: info.signals.map(([id]) => id), vehicles: info.vehicles.map((v) => ({ id: v.id, name: v.name, primary: v.primary })) },
};
sl.setCallouts = setEnabled;
