// Sightline forensic callouts (owner: OVERLAYS). Measured, cited on-screen annotations in the style of
// courtroom crash animations: per-vehicle speed labels, event clock + time-to-impact, signal state,
// street labels (overhead), traced sight line for the selected witness, stopping-distance / brake-point
// marks, vehicle gap. Hooks into the viewer only through window.sl:
//   - scene = sl.world.root.parent; we chain scene.onBeforeRender (re-installed after every 'loaded'
//     event, because render_quality.js re-assigns it on load) so every renderer.render() — including
//     render/record.js and server/clips.js captures — updates the callouts for the exact frame drawn.
//   - Ground marks / sight line are WebGL meshes in the scene; text is a DOM layer inside #stage.
//     Both captures use page.screenshot(), so DOM callouts land in the exported frames too.
// Toggle: button (top-right, hidden in ?clean=1), URL ?callouts=0|1, sl.overlays.set(bool) / sl.setCallouts(bool).
// Nothing case-specific: impact time, clock anchor, vehicles, roads, signals, skids all come from the world + checks.
import * as THREE from 'three';

const params = new URLSearchParams(location.search);
const G = 9.81;
const MPH = 2.236936;
const FT = 3.28084;
const C_CLEAR = 0x3ddc84, C_BLOCK = 0xff4d4d, C_MARK = 0xf2f4f7, C_AMBER = 0xe2b052, C_ZONE = 0xe2b052;
const INFERRED_RE = /inferred/i;

function waitForSl() {
  return new Promise((res) => {
    const tick = () => (window.sl && window.sl.events ? res(window.sl) : setTimeout(tick, 30));
    tick();
  });
}

const sl = await waitForSl();

// ---------- state ----------
let enabled = (() => {
  if (params.get('callouts') === '0') return false;
  if (params.get('callouts') === '1') return true;
  try { return localStorage.getItem('sl.callouts') !== '0'; } catch (_) { return true; }
})();
let world = null, scene = null, info = null;
let checks = [];
let checksFor = null;
let selWitness = null;          // explicit selection (pick / API); camera witness wins
const speedCache = new Map();   // key t*1000 -> Map(id -> mps)
const group = new THREE.Group();
group.name = '__sl_overlays';
group.renderOrder = 14;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _box = new THREE.Box3(), _box2 = new THREE.Box3();
const raycaster = new THREE.Raycaster();

// ---------- DOM ----------
const stage = document.getElementById('stage') || document.body;
const layer = document.createElement('div');
layer.className = 'slo-layer';
stage.appendChild(layer);
const btn = document.createElement('button');
btn.type = 'button';
btn.className = 'slo-toggle';
btn.title = 'Show or hide measured callouts (speeds, clock, sight line, stopping distances). URL: ?callouts=0';
btn.addEventListener('click', () => setEnabled(!enabled));
stage.appendChild(btn);
const measureCtx = document.createElement('canvas').getContext('2d');
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
function textW(s, font) { measureCtx.font = font; return Math.ceil(measureCtx.measureText(s).width); }
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function syncToggle() {
  btn.textContent = 'Callouts ' + (enabled ? 'on' : 'off');
  btn.classList.toggle('off', !enabled);
  btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  layer.hidden = !enabled;
  group.visible = enabled;
}
function setEnabled(v) {
  enabled = !!v;
  try { localStorage.setItem('sl.callouts', enabled ? '1' : '0'); } catch (_) {}
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
function shortCite(c, n = 40) {
  c = String(c || '').split(/[;(]/)[0].trim();
  return c.length > n ? c.slice(0, n - 1) + '…' : c;
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
  } catch (_) { checks = []; }
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
// 3D tube between two points (sight line in perspective views)
function tube(a, b, r, mat) {
  const d = b.clone().sub(a);
  const len = d.length();
  if (len < 1e-4) return null;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8, 1, true), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.renderOrder = 14;
  group.add(m);
  return m;
}

// ---------- sight line ----------
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

// ---------- per-frame update ----------
function update(cam) {
  clearGroup();
  if (!enabled || !world || !info) { layer.innerHTML = ''; return; }
  const W = stage.clientWidth || window.innerWidth, H = stage.clientHeight || window.innerHeight;
  const t = sl.time || 0;
  const camId = sl.camera || 'overhead';
  const overhead = camId === 'overhead';
  const isChase = camId.startsWith('chase_');
  const isWit = !overhead && !isChase;
  const proj = projector(cam, W, H);
  const mpp = cam.isOrthographicCamera ? (cam.top - cam.bottom) / cam.zoom / H : 0; // metres per pixel (overhead)
  const html = [];
  const svg = [];
  const placed = [];

  // obstacles: the viewer's own overhead label sprites
  if (overhead) {
    scene.traverse((o) => {
      if (!o.isSprite || !o.visible || !visibleChain(o) || o.parent === group) return;
      const c = proj(o.getWorldPosition(new THREE.Vector3()));
      const w = o.scale.x / mpp, h = o.scale.y / mpp;
      placed.push({ x: c.x - w / 2, y: c.y - h / 2, w, h });
    });
  }

  // ---- (2) clock panel ----
  const imp = info.impact;
  const rows = [`<div class="slo-t">t = ${t.toFixed(2)} s</div>`];
  if (info.clock && imp) {
    rows.push(`<div class="slo-clock" title="Clock anchored to the cited time of impact: ${esc(info.clock.cite)}">${fmtClock(info.clock.sec + (t - imp.t), info.clock.tz)}</div>`);
  } else if (world.meta && world.meta.timeOfDay) {
    rows.push(`<div class="slo-clock approx" title="Time of day from the world metadata; no cited clock time of impact">time of day ≈ ${esc(world.meta.timeOfDay)}</div>`);
  }
  if (imp) {
    const d = t - imp.t;
    if (Math.abs(d) < 0.025) rows.push('<div class="slo-imp now">IMPACT</div>');
    else if (d < 0) rows.push(`<div class="slo-imp pre">Impact in ${(-d).toFixed(2)} s</div>`);
    else rows.push(`<div class="slo-imp post">Impact +${d.toFixed(2)} s</div>`);
  }
  // ---- (3) signal chips ----
  for (const [id, o] of info.signals.slice(0, 4)) {
    let st = 'off';
    try { st = String(o.state(t) || 'off').toLowerCase(); } catch (_) {}
    if (!/^(red|yellow|amber|green|off|flashing.*)$/.test(st)) st = 'off';
    rows.push(`<div class="slo-sig ${st.split(/\W/)[0]}" title="${esc((o.label || id) + (o.citation ? ' — ' + o.citation : ''))}"><i></i><span>${esc(shortLabel(o.label || id, 26))}</span><b>${esc(st.toUpperCase())}</b></div>`);
  }
  html.push(`<div class="slo-panel">${rows.join('')}</div>`);
  placed.push({ x: 0, y: 0, w: 230, h: 30 + rows.length * 20 });

  const speeds = speedsAt(t);

  // ---- (6) stopping distance / brake point (overhead + chase) ----
  const stop = info.stop;
  if (stop && (overhead || isChase)) {
    const lw = overhead ? Math.max(0.25, 2.2 * mpp) : 0.22;
    const bar = (d, color, op = 0.95) => {
      const { p, dir } = stop.at(d);
      const n = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(stop.halfW);
      strip(p.clone().add(n), p.clone().sub(n), lw * 1.6, basic(color, op));
      return { p, dir, n };
    };
    const side = (pp, nn, k = 1.25) => pp.clone().add(nn.clone().multiplyScalar(k));
    const tag = (pp, cls, title, l1, l2) => {
      const s = proj(pp);
      if (!s.on) return;
      const w = Math.max(textW(l1, `600 11px ${MONO}`), l2 ? textW(l2, `500 10px ${MONO}`) : 0) + 14, h = l2 ? 32 : 19;
      let r = { x: s.x - w / 2, y: s.y + 6, w, h };
      for (let k = 0; k < 6 && placed.some((q) => rectsHit(q, r)); k++) r.y += h + 3;
      placed.push(r);
      html.push(`<div class="slo-mark ${cls}" style="transform:translate(${r.x.toFixed(1)}px,${r.y.toFixed(1)}px)" title="${esc(title)}"><b>${esc(l1)}</b>${l2 ? `<span>${esc(l2)}</span>` : ''}</div>`);
    };
    if (stop.kind === 'skid') {
      const segs = 24;
      for (let i = 0; i < segs; i++) {
        const a = stop.at(stop.L * i / segs).p, b = stop.at(stop.L * (i + 1) / segs).p;
        strip(a, b, lw, basic(C_MARK, 0.9));
      }
      const bp = bar(stop.L, C_BLOCK);
      bar(0, C_MARK, 0.6);
      tag(side(bp.p, bp.n), 'brake', stop.cite, `Brake point — skid start (${stop.name})`, `skid ${fmtM(stop.L)} → ${Math.round(stop.lo)}–${Math.round(stop.hi)} mph (μ ${stop.mu[0]}–${stop.mu[1]})`);
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
      const beyond = stop.db + stop.dp > stop.pathLen + 0.5 ? ' (beyond start of timeline)' : '';
      tag(side(b1.p, b1.n), 'brake', 'Braking distance v²/(2μg); band = μ 0.6–0.8', `Must brake by: ${fmtM(stop.db)} before impact`, `${fmtMph(stop.v)}, μ 0.7 (band 0.6–0.8)`);
      tag(side(b2.p, b2.n), 'perceive', 'Perception-reaction 1.5 s typical (range 1.0–2.5 s)', `Perceive by: ${fmtM(stop.db + stop.dp)}${beyond}`, `+ PRT 1.5 s = ${fmtM(stop.dp)}`);
      if (info.noMarksFact) {
        const ip = stop.at(0);
        const n = new THREE.Vector3(-ip.dir.z, 0, ip.dir.x);
        tag(side(ip.p, n, -stop.halfW * 1.6), 'none', info.noMarksFact.citation || '', `Actual brake point: none recorded`, shortLabel(info.noMarksFact.text, 44) + (info.noMarksFact.citation ? ' — ' + shortCite(info.noMarksFact.citation, 22) : ''));
      }
    }
  }

  // ---- (5) sight line for the selected witness ----
  const w = (world.witnesses || []).length ? selectedWitness(camId) : null;
  if (w) {
    const r = liveSight(w);
    const chk = checks.find((c) => c && c.check === 'sightline' && c.subject === w.id);
    if (r) {
      const from = new THREE.Vector3(...r.from), to = new THREE.Vector3(...r.to);
      const hit = r.hit ? new THREE.Vector3(...r.hit) : null;
      const col = r.visible ? C_CLEAR : C_BLOCK;
      const tgtName = typeof w.lookAt === 'string' && world.objects[w.lookAt] ? vehNameOrLabel(w.lookAt) : 'target';
      const blkName = r.blockedBy ? vehNameOrLabel(r.blockedBy) : '';
      const wName = String(w.name || w.id).replace(/\s*\(fictional\)/i, '');
      const chkTxt = chk ? `check @ ${Number(chk.t ?? w.observationTime).toFixed(1)} s: ${chk.pass ? 'clear' : 'blocked'}${chk.robustness && chk.robustness.samples ? ` (${chk.pass ? chk.robustness.clear : chk.robustness.blocked}/${chk.robustness.samples} positions)` : ''}` : '';
      if (overhead || isChase) {
        const end = hit || to;
        if (overhead) {
          strip(from, end, Math.max(0.2, 2.5 * mpp), basic(col, 0.95, false), 6.2);
          if (hit) for (let i = 0; i < 24; i += 2) {
            const a = hit.clone().lerp(to, i / 24), b = hit.clone().lerp(to, (i + 1) / 24);
            strip(a, b, Math.max(0.15, 1.6 * mpp), basic(0x9aa3b2, 0.8, false), 6.1);
          }
        } else {
          tube(from, end, 0.05, basic(col, 0.95));
          if (hit) tube(hit, to, 0.025, basic(0x9aa3b2, 0.6));
          const dot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), basic(col, 1));
          dot.position.copy(end); group.add(dot);
          const eyeM = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), basic(C_AMBER, 1));
          eyeM.position.copy(from); group.add(eyeM);
        }
        const mid = proj(from.clone().lerp(end, 0.5));
        if (mid.on) {
          const l1 = `${wName} → ${tgtName}: ${r.visible ? 'line of sight clear' : 'blocked by ' + blkName}`;
          const l2 = `${fmtM(r.visible ? r.distance : (r.distanceToBlocker || from.distanceTo(end)))}${r.visible ? '' : ' to obstruction, ' + fmtM(r.distance) + ' to target'}`;
          const wd = Math.max(textW(l1, `600 11px ${MONO}`), textW(l2, `500 10px ${MONO}`), chkTxt ? textW(chkTxt, `500 10px ${MONO}`) : 0) + 16;
          const hh = chkTxt ? 46 : 33;
          let rr = { x: Math.min(W - wd - 8, Math.max(8, mid.x - wd / 2)), y: mid.y + 10, w: wd, h: hh };
          for (let k = 0; k < 8 && placed.some((q) => rectsHit(q, rr)); k++) rr.y += 18;
          placed.push(rr);
          html.push(`<div class="slo-sight ${r.visible ? 'ok' : 'bad'}" style="transform:translate(${rr.x.toFixed(1)}px,${rr.y.toFixed(1)}px)" title="${esc(w.citation || '')}"><b>${esc(l1)}</b><span>${esc(l2)}</span>${chkTxt ? `<span class="c">${esc(chkTxt)}</span>` : ''}</div>`);
        }
      } else if (isWit && w.id === camId) {
        // witness's own view: reticle on the target, cross where the sight line meets the obstruction
        const tp = proj(to);
        if (tp.on) svg.push(`<g class="slo-ret ${r.visible ? 'ok' : 'bad'}"><circle cx="${tp.x.toFixed(1)}" cy="${tp.y.toFixed(1)}" r="11"/><line x1="${(tp.x - 18).toFixed(1)}" y1="${tp.y.toFixed(1)}" x2="${(tp.x - 7).toFixed(1)}" y2="${tp.y.toFixed(1)}"/><line x1="${(tp.x + 7).toFixed(1)}" y1="${tp.y.toFixed(1)}" x2="${(tp.x + 18).toFixed(1)}" y2="${tp.y.toFixed(1)}"/><line x1="${tp.x.toFixed(1)}" y1="${(tp.y - 18).toFixed(1)}" x2="${tp.x.toFixed(1)}" y2="${(tp.y - 7).toFixed(1)}"/><line x1="${tp.x.toFixed(1)}" y1="${(tp.y + 7).toFixed(1)}" x2="${tp.x.toFixed(1)}" y2="${(tp.y + 18).toFixed(1)}"/></g>`);
        if (tp.on) {
          const l1 = `sight line → ${tgtName} · ${fmtM(r.distance)}`;
          const l2 = r.visible ? 'clear at this instant' : `meets ${blkName} at ${fmtM(r.distanceToBlocker || 0)}`;
          const wd = Math.max(textW(l1, `600 11px ${MONO}`), textW(l2, `500 10px ${MONO}`), chkTxt ? textW(chkTxt, `500 10px ${MONO}`) : 0) + 16;
          const hh = chkTxt ? 46 : 33;
          let rr = { x: Math.min(W - wd - 8, Math.max(8, tp.x - wd / 2)), y: tp.y + 24, w: wd, h: hh };
          if (rr.y + hh > H - 90) rr.y = tp.y - 24 - hh;
          placed.push(rr);
          html.push(`<div class="slo-sight ${r.visible ? 'ok' : 'bad'}" style="transform:translate(${rr.x.toFixed(1)}px,${rr.y.toFixed(1)}px)"><b>${esc(l1)}</b><span>${esc(l2)}</span>${chkTxt ? `<span class="c">${esc(chkTxt)}</span>` : ''}</div>`);
        }
      }
    }
  }

  // ---- (1) vehicle labels: name + speed; leader to the vehicle ----
  const vlabels = [];
  for (const v of info.vehicles) {
    if (!v.primary) continue;
    if (!visibleChain(v.o.node)) continue;
    objBox(v.o, _box);
    if (_box.isEmpty()) continue;
    const c = _box.getCenter(new THREE.Vector3());
    const anchor = overhead ? new THREE.Vector3(c.x, _box.max.y, _box.max.z) : new THREE.Vector3(c.x, _box.max.y + 0.3, c.z);
    const s = proj(anchor);
    if (!s.on) continue;
    const mps = speeds.get(v.id) || 0;
    const moving = mps * MPH >= 0.5;
    const hidden = isWit && hiddenFromCam(cam, v.id, c);
    const l1 = v.name;
    const l2 = moving ? fmtMph(mps) : 'stopped';
    const fw = textW(l1, `600 11px ${MONO}`) + textW(l2, `700 12px ${MONO}`) + 26 + (hidden ? textW(' (not in view)', `500 10px ${MONO}`) : 0);
    vlabels.push({ v, s, l1, l2, hidden, w: fw, h: 22, inf: isInf(v.o), mps, dist: cam.isOrthographicCamera ? 0 : cam.position.distanceTo(c) });
  }
  // nearer vehicles first get the best spot; overhead labels go below the vehicle, perspective above
  vlabels.sort((a, b) => a.dist - b.dist);
  for (const L of vlabels) {
    const gap = overhead ? 8 : 26;
    let r = { x: L.s.x - L.w / 2, y: overhead ? L.s.y + gap : L.s.y - gap - L.h, w: L.w, h: L.h };
    r.x = Math.max(6, Math.min(W - L.w - 6, r.x));
    for (let k = 0; k < 10 && placed.some((q) => rectsHit(q, r)); k++) r.y += overhead ? L.h + 4 : -(L.h + 4);
    r.y = Math.max(4, Math.min(H - L.h - 30, r.y));
    placed.push(r);
    const ly = overhead ? r.y : r.y + L.h;
    svg.push(`<line class="slo-lead${L.hidden ? ' hid' : ''}" x1="${L.s.x.toFixed(1)}" y1="${L.s.y.toFixed(1)}" x2="${(r.x + r.w / 2).toFixed(1)}" y2="${ly.toFixed(1)}"/><circle class="slo-anc" cx="${L.s.x.toFixed(1)}" cy="${L.s.y.toFixed(1)}" r="2.2"/>`);
    html.push(`<div class="slo-veh${L.hidden ? ' hid' : ''}${L.inf ? ' inf' : ''}" style="transform:translate(${r.x.toFixed(1)}px,${r.y.toFixed(1)}px)" title="${esc((L.v.o.label || L.v.id) + (L.v.o.citation ? '\nSource: ' + L.v.o.citation : '') + '\nSpeed: model position change over t±0.05 s')}"><span class="n">${esc(L.l1)}</span><b>${esc(L.l2)}</b>${L.hidden ? '<em>(not in view)</em>' : ''}</div>`);
  }

  // ---- gap between the fastest vehicle and the nearest other unit (overhead + chase, before impact) ----
  if ((overhead || isChase) && info.vehicles.length > 1 && (!imp || t < imp.t - 0.02)) {
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
        p1.y = p2.y = overhead ? 6.3 : 0.8;
        const a = proj(p1), b = proj(p2);
        if (a.on && b.on && Math.hypot(a.x - b.x, a.y - b.y) > 24) {
          const ang = Math.atan2(b.y - a.y, b.x - a.x), nx = -Math.sin(ang) * 6, ny = Math.cos(ang) * 6;
          svg.push(`<g class="slo-gap"><line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/><line x1="${(a.x - nx).toFixed(1)}" y1="${(a.y - ny).toFixed(1)}" x2="${(a.x + nx).toFixed(1)}" y2="${(a.y + ny).toFixed(1)}"/><line x1="${(b.x - nx).toFixed(1)}" y1="${(b.y - ny).toFixed(1)}" x2="${(b.x + nx).toFixed(1)}" y2="${(b.y + ny).toFixed(1)}"/></g>`);
          const l = `gap ${fmtM(gd)}` + (fv > 0.5 ? ` · ${(gd / fv).toFixed(2)} s at ${fmtMph(fv)}` : '');
          const wd = textW(l, `600 11px ${MONO}`) + 14;
          let rr = { x: (a.x + b.x) / 2 - wd / 2, y: (a.y + b.y) / 2 - 22, w: wd, h: 19 };
          for (let k = 0; k < 6 && placed.some((q) => rectsHit(q, rr)); k++) rr.y -= 22;
          placed.push(rr);
          html.push(`<div class="slo-gaplbl" style="transform:translate(${rr.x.toFixed(1)}px,${rr.y.toFixed(1)}px)" title="Closest distance between the two vehicles' bounding boxes at this instant; time = gap / current speed">${esc(l)}</div>`);
        }
      }
    }
  }

  // ---- (4) road / street labels (overhead only), along the road axis, placed last in free space ----
  if (overhead) {
    for (const rd of info.roads) {
      const a = proj(rd.axis.a), b = proj(rd.axis.b);
      // clip segment to the viewport (inset)
      const seg = clipSeg(a, b, 40, 60, W - 40, H - 40);
      if (!seg) continue;
      let ang = Math.atan2(seg[1].y - seg[0].y, seg[1].x - seg[0].x) * 180 / Math.PI;
      let [p0, p1] = seg;
      if (ang > 90 || ang <= -90) { ang += ang > 0 ? -180 : 180; [p0, p1] = [p1, p0]; }
      const l1 = shortLabel(rd.o.label, 40);
      const l2 = shortCite(rd.o.citation, 34);
      const wd = Math.max(textW(l1.toUpperCase(), `600 10px ${MONO}`) * 1.12, textW(l2, `500 9px ${MONO}`)) + 10, hh = 26;
      const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      if (segLen < wd * 0.8) continue;
      const rad = ang * Math.PI / 180, cs = Math.abs(Math.cos(rad)), sn = Math.abs(Math.sin(rad));
      const bw = wd * cs + hh * sn, bh = wd * sn + hh * cs;
      let spot = null;
      for (const f of [0.18, 0.82, 0.32, 0.68, 0.08, 0.92, 0.5]) {
        const cx = p0.x + (p1.x - p0.x) * f, cy = p0.y + (p1.y - p0.y) * f;
        const r = { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
        if (r.x < 4 || r.y < 4 || r.x + r.w > W - 4 || r.y + r.h > H - 30) continue;
        if (!placed.some((q) => rectsHit(q, r, 2))) { spot = { cx, cy, r }; break; }
      }
      if (!spot) continue;
      placed.push(spot.r);
      html.push(`<div class="slo-road${isInf(rd.o) ? ' inf' : ''}" style="left:${spot.cx.toFixed(1)}px;top:${spot.cy.toFixed(1)}px;transform:translate(-50%,-50%) rotate(${ang.toFixed(1)}deg)" title="${esc(rd.o.label + (rd.o.citation ? '\nSource: ' + rd.o.citation : ''))}"><b>${esc(l1)}</b><span>${esc(l2)}</span></div>`);
    }
  }

  layer.innerHTML = `<svg class="slo-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg.join('')}</svg>${html.join('')}`;
  group.updateMatrixWorld(true);
}

function vehNameOrLabel(id) {
  const o = world.objects[id];
  if (!o) return id;
  return o.kind === 'vehicle' ? vehName(id, o) + ' (' + shortLabel(o.label, 18).toLowerCase().replace(/^(passenger|refrigerated)\s+/, '') + ')' : shortLabel(o.label || id, 26);
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
  if (scene !== s) { if (scene && group.parent === scene) scene.remove(group); scene = s; }
  if (group.parent !== scene) scene.add(group);
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
  try { analyze(); } catch (e) { console.warn('overlays: analyze failed', e); info = null; }
  install();
  loadChecks().then(() => { try { if (info) info.stop = buildStopping(); } catch (_) {} if (sl.renderFrame) sl.renderFrame(); });
  if (sl.renderFrame) sl.renderFrame();
}

sl.events.addEventListener('loaded', onLoaded);
sl.events.addEventListener('pick', (e) => { const d = e.detail; if (d && d.type === 'witness') { selWitness = d.id; if (sl.renderFrame) sl.renderFrame(); } });
sl.events.addEventListener('witnesses', () => { if (sl.renderFrame) sl.renderFrame(); });
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
