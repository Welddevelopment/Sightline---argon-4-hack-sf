// render_view.mjs — self-contained software renderer + independent verdicts for ONE viewpoint.
// Runs inside a Gemini managed-agent sandbox (no GPU, no browser): pure Node + `three` (math/scene graph only).
//   node render_view.mjs [--repo /workspace/repo] --world world.js --view overhead|<witnessId> --out out/<view> [--fps 5] [--w 480] [--h 270] [--t 6.5]
// Writes: out/<view>/frames/f0000.png..., out/<view>/still.png, out/<view>/verdict.json
// Camera conventions match web/viewer.js (witness: eye at eyeHeight looking at lookAt, 60° (75° if close); overhead: ortho, north up).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const WORLD = path.resolve(arg('world', 'world.js'));
const VIEW = arg('view', 'overhead');
const OUT = path.resolve(arg('out', 'out/' + VIEW));
const FPS = Number(arg('fps', 5));
const W = Number(arg('w', 480)), H = Number(arg('h', 270));
const STILL_T = arg('t');

// Minimal DOM stub so worlds that build CanvasTextures for labels still load.
if (typeof globalThis.document === 'undefined') {
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => ({ width: 0 })), set: (o, k, v) => ((o[k] = v), true) });
  globalThis.document = { createElement: () => ({ width: 64, height: 64, getContext: () => ctx, style: {} }) };
}

// --repo <dir>: use that checkout's checks/ + asset loader (WORLD CONTRACT v2 worlds need createWorld(THREE, assets)).
const REPO = path.resolve(arg('repo', path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')));
const { THREE, instantiateWorld } = await import(pathToFileURL(path.join(REPO, 'checks', 'load_world.js')).href);
const world = await instantiateWorld(await import(pathToFileURL(WORLD).href));
const checks = await import(pathToFileURL(path.join(REPO, 'checks', 'checks.js')).href);
fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });

// ---------- lighting (same table as the viewer) ----------
const LIGHT = {
  dawn: { bg: 0xe3a981, hemi: [0xffd1a0, 0x3a3f4a, 0.75], sun: [0xffb070, 1.4, [-90, 40, -70]], fog: [0xe3a981, 120, 600] },
  day: { bg: 0x9ec9ec, hemi: [0xffffff, 0x8a9a7a, 0.95], sun: [0xffffff, 1.7, [70, 130, 50]], fog: [0x9ec9ec, 200, 900] },
  night: { bg: 0x02040a, hemi: [0x1a2440, 0x05060a, 0.16], sun: [0x6678a8, 0.12, [-50, 100, 30]], fog: [0x02040a, 35, 220] },
};
const L = LIGHT[(world.meta?.lighting || 'day').toLowerCase()] || LIGHT.day;
const col = (hex) => new THREE.Color(hex);
const BG = col(L.bg), SKY = col(L.hemi[0]), GND = col(L.hemi[1]), SUNC = col(L.sun[0]);
const SUNDIR = new THREE.Vector3(...L.sun[2]).normalize();

const witness = (world.witnesses || []).find((w) => w.id === VIEW) || null;
if (VIEW !== 'overhead' && !witness) throw new Error(`unknown view ${VIEW}`);
const box3 = () => new THREE.Box3();
const nodeBox = (n) => { n.updateWorldMatrix(true, true); return box3().setFromObject(n); };
function targetPoint(look) {
  if (Array.isArray(look)) return new THREE.Vector3(...look);
  const o = world.objects?.[look];
  return o ? nodeBox(o.node).getCenter(new THREE.Vector3()) : new THREE.Vector3(0, 1, 0);
}

// ---------- cameras ----------
let overheadFit = null;
function fitOverhead() {
  // Same region-of-interest rule as web/viewer.js fitOverhead (at the median observation time).
  const wits = world.witnesses || [];
  const ts = wits.map((w) => w.observationTime).filter((x) => typeof x === 'number').sort((a, b) => a - b);
  world.setTime(ts.length ? ts[Math.floor(ts.length / 2)] : (world.duration || 10) / 2); world.root.updateMatrixWorld(true);
  const pts = wits.map((w) => new THREE.Vector3(w.position[0], 0, w.position[2]));
  const entries = Object.entries(world.objects || {});
  const impact = entries.find(([id]) => /^mark_impact/.test(id)) || entries.find(([id]) => /impact|poi|aoi/i.test(id) && id.startsWith('mark_'));
  let ref = impact ? nodeBox(impact[1].node).getCenter(new THREE.Vector3()) : pts.length ? pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length) : new THREE.Vector3();
  const roi = box3(); pts.forEach((p) => roi.expandByPoint(p));
  const near = (bx, r) => { const c = bx.getCenter(new THREE.Vector3()); return Math.hypot(c.x - ref.x, c.z - ref.z) <= r; };
  for (const [id, o] of entries) {
    if (!o.node) continue; const bx = nodeBox(o.node); if (bx.isEmpty()) continue; const sz = bx.getSize(new THREE.Vector3());
    if (o.kind === 'vehicle') { roi.union(bx); continue; }
    if (o.kind === 'road' || id.startsWith('road_')) continue;
    if (sz.x > 150 || sz.z > 150) continue;
    if (o.kind === 'mark' || id.startsWith('mark_')) { if (near(bx, 120)) roi.union(bx); continue; }
    if (['occluder', 'building', 'signal'].includes(o.kind)) { if (near(bx, 60)) roi.union(bx); }
  }
  if (roi.isEmpty()) roi.set(new THREE.Vector3(-30, 0, -30), new THREE.Vector3(30, 5, 30));
  const c = roi.getCenter(new THREE.Vector3()), s = roi.getSize(new THREE.Vector3());
  overheadFit = { cx: c.x, cz: c.z, half: Math.max(s.z / 2, s.x / 2 / (W / H), 12) * 1.2 };
}
function makeCamera() {
  world.root.updateMatrixWorld(true);
  if (VIEW === 'overhead') {
    if (!overheadFit) fitOverhead();
    const { cx, cz, half } = overheadFit, a = W / H;
    const cam = new THREE.OrthographicCamera(-half * a, half * a, half, -half, 0.1, 3000);
    cam.up.set(0, 0, -1); cam.position.set(cx, 400, cz); cam.lookAt(cx, 0, cz);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    return cam;
  }
  const eye = new THREE.Vector3(witness.position[0], witness.eyeHeight ?? witness.position[1] ?? 1.6, witness.position[2]);
  const tp = targetPoint(witness.lookAt);
  let fov = 60; const d = eye.distanceTo(tp);
  let rad = 0;
  if (typeof witness.lookAt === 'string' && world.objects[witness.lookAt]) rad = nodeBox(world.objects[witness.lookAt].node).getSize(new THREE.Vector3()).length() / 2;
  if (d < 15 || (d > 0 && Math.atan(rad / d) > 0.35)) fov = 75;
  const cam = new THREE.PerspectiveCamera(fov, W / H, 0.1, 2000);
  cam.position.copy(eye); cam.lookAt(tp); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  return cam;
}

// ---------- object id lookup (for the item buffer) ----------
const idOf = new Map(); // Object3D -> object id index (1-based)
const ids = Object.keys(world.objects || {});
ids.forEach((id, i) => world.objects[id].node?.traverse?.((n) => { if (!idOf.has(n)) idOf.set(n, i + 1); }));
// deeper registrations win (a child object registered as its own id)
ids.forEach((id, i) => { const n = world.objects[id].node; if (n) idOf.set(n, i + 1); });
const ownerIndex = (m) => { for (let n = m; n; n = n.parent) if (idOf.has(n)) return idOf.get(n); return 0; };
const visibleChain = (o) => { for (let n = o; n; n = n.parent) if (n.visible === false) return false; return true; };

// ---------- rasterizer ----------
const color = new Float32Array(W * H * 3), depth = new Float32Array(W * H), item = new Int32Array(W * H);
const v4 = new THREE.Vector4(), nrm = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
const pa = new THREE.Vector3(), pb = new THREE.Vector3(), pc = new THREE.Vector3();

function shade(mat, n, viewDir, overhead) {
  const base = mat.color ? mat.color : col(0xcccccc);
  if (mat.isMeshBasicMaterial) return [base.r, base.g, base.b];
  if (n.dot(viewDir) > 0) n = n.clone().negate(); // face the camera (double-sided)
  n = n.clone().negate(); // outward toward camera
  const hemiK = 0.5 + 0.5 * n.y;
  const k = L.hemi[2];
  let r = (SKY.r * hemiK + GND.r * (1 - hemiK)) * k, g = (SKY.g * hemiK + GND.g * (1 - hemiK)) * k, b = (SKY.b * hemiK + GND.b * (1 - hemiK)) * k;
  const lam = Math.max(0, n.dot(SUNDIR)) * L.sun[1];
  r += SUNC.r * lam; g += SUNC.g * lam; b += SUNC.b * lam;
  if (overhead) { const amb = (world.meta?.lighting === 'night' ? 1.6 : world.meta?.lighting === 'dawn' ? 0.5 : 0) * 0.6; r += amb; g += amb; b += amb; }
  const e = mat.emissive ? mat.emissive.clone().multiplyScalar(mat.emissiveIntensity ?? 1) : { r: 0, g: 0, b: 0 };
  return [base.r * r * 0.8 + e.r, base.g * g * 0.8 + e.g, base.b * b * 0.8 + e.b];
}

function clipNear(poly) { // poly: [{x,y,z,w}] in clip space; keep z >= -w
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = a.z + a.w, db = b.z + b.w;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, w: a.w + (b.w - a.w) * t }); }
  }
  return out;
}

function rasterTri(s0, s1, s2, rgb, idx, alpha, onlyId) {
  const minX = Math.max(0, Math.floor(Math.min(s0[0], s1[0], s2[0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(s0[0], s1[0], s2[0])));
  const minY = Math.max(0, Math.floor(Math.min(s0[1], s1[1], s2[1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(s0[1], s1[1], s2[1])));
  const area = (s1[0] - s0[0]) * (s2[1] - s0[1]) - (s2[0] - s0[0]) * (s1[1] - s0[1]);
  if (Math.abs(area) < 1e-9) return;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const px = x + 0.5, py = y + 0.5;
    let w0 = (s1[0] - px) * (s2[1] - py) - (s2[0] - px) * (s1[1] - py);
    let w1 = (s2[0] - px) * (s0[1] - py) - (s0[0] - px) * (s2[1] - py);
    let w2 = (s0[0] - px) * (s1[1] - py) - (s1[0] - px) * (s0[1] - py);
    if (area < 0) { w0 = -w0; w1 = -w1; w2 = -w2; }
    if (w0 < 0 || w1 < 0 || w2 < 0) continue;
    const aa = Math.abs(area), z = (w0 * s0[2] + w1 * s1[2] + w2 * s2[2]) / aa, vd = (w0 * s0[3] + w1 * s1[3] + w2 * s2[3]) / aa;
    const p = y * W + x;
    if (z >= depth[p] || z < -1) continue;
    if (onlyId) { depth[p] = z; item[p] = idx; continue; }
    let [r, g, b] = rgb;
    if (VIEW !== 'overhead') { const f = Math.min(1, Math.max(0, (vd - L.fog[1]) / (L.fog[2] - L.fog[1]))); r = r * (1 - f) + BG.r * f; g = g * (1 - f) + BG.g * f; b = b * (1 - f) + BG.b * f; }
    if (alpha < 1) { r = color[p * 3] * (1 - alpha) + r * alpha; g = color[p * 3 + 1] * (1 - alpha) + g * alpha; b = color[p * 3 + 2] * (1 - alpha) + b * alpha; }
    else { depth[p] = z; item[p] = idx; }
    color[p * 3] = r; color[p * 3 + 1] = g; color[p * 3 + 2] = b;
  }
}

// filter(mesh) -> bool chooses which meshes to draw; onlyId=true skips shading (item buffer only)
function render(cam, { filter = () => true, onlyId = false } = {}) {
  depth.fill(Infinity); item.fill(0);
  if (!onlyId) for (let p = 0; p < W * H; p++) { color[p * 3] = BG.r; color[p * 3 + 1] = BG.g; color[p * 3 + 2] = BG.b; }
  const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const camPos = cam.getWorldPosition(new THREE.Vector3()), camDir = cam.getWorldDirection(new THREE.Vector3());
  const meshes = [];
  world.root.traverse((m) => { if (m.isMesh && m.geometry?.attributes?.position && visibleChain(m) && filter(m)) meshes.push(m); });
  // opaque first, transparent after
  meshes.sort((a, b) => (a.material?.transparent ? 1 : 0) - (b.material?.transparent ? 1 : 0));
  for (const m of meshes) {
    const mat = Array.isArray(m.material) ? m.material[0] : m.material || {};
    if (mat.visible === false) continue;
    const alpha = mat.transparent ? (mat.opacity ?? 1) : 1;
    if (alpha <= 0.02) continue;
    const pos = m.geometry.attributes.position, index = m.geometry.index;
    const n = index ? index.count : pos.count;
    const idx = ownerIndex(m);
    for (let i = 0; i < n; i += 3) {
      const ia = index ? index.getX(i) : i, ib = index ? index.getX(i + 1) : i + 1, ic = index ? index.getX(i + 2) : i + 2;
      pa.fromBufferAttribute(pos, ia).applyMatrix4(m.matrixWorld);
      pb.fromBufferAttribute(pos, ib).applyMatrix4(m.matrixWorld);
      pc.fromBufferAttribute(pos, ic).applyMatrix4(m.matrixWorld);
      nrm.crossVectors(e1.subVectors(pb, pa), e2.subVectors(pc, pa)).normalize();
      const viewDir = VIEW === 'overhead' ? camDir : pa.clone().sub(camPos).normalize();
      const rgb = onlyId ? null : shade(mat, nrm, viewDir, VIEW === 'overhead');
      let poly = [pa, pb, pc].map((p) => { v4.set(p.x, p.y, p.z, 1).applyMatrix4(vp); return { x: v4.x, y: v4.y, z: v4.z, w: v4.w }; });
      poly = clipNear(poly);
      if (poly.length < 3) continue;
      const scr = poly.map((q) => [(q.x / q.w * 0.5 + 0.5) * W, (1 - (q.y / q.w * 0.5 + 0.5)) * H, q.z / q.w, q.w]);
      for (let k = 1; k + 1 < scr.length; k++) rasterTri(scr[0], scr[k], scr[k + 1], rgb, idx, alpha, onlyId);
    }
  }
}

// ---------- PNG writer ----------
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcT[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); }
function png(file, hud) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  const g = (v) => Math.round(255 * Math.min(1, Math.max(0, v)) ** (1 / 2.2));
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 0; x < W; x++) { const p = y * W + x, o = y * (W * 3 + 1) + 1 + x * 3; raw[o] = g(color[p * 3]); raw[o + 1] = g(color[p * 3 + 1]); raw[o + 2] = g(color[p * 3 + 2]); } }
  if (hud) for (let y = 0; y < 4; y++) for (let x = 0; x < Math.round(W * hud); x++) { const o = (H - 1 - y) * (W * 3 + 1) + 1 + x * 3; raw[o] = 255; raw[o + 1] = 255; raw[o + 2] = 255; } // time bar
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));
}

// ---------- independent pixel visibility (item buffer) ----------
function pixelVisibility(t) {
  if (!witness || typeof witness.lookAt !== 'string' || !world.objects[witness.lookAt]) return null;
  world.setTime(t); world.root.updateMatrixWorld(true);
  const cam = makeCamera();
  const tIdx = ids.indexOf(witness.lookAt) + 1;
  const tNode = world.objects[witness.lookAt].node;
  const inTarget = (m) => { for (let n = m; n; n = n.parent) if (n === tNode) return true; return false; };
  // pass 1: target alone -> its screen footprint; pass 2: full scene -> who owns those pixels
  const mask = new Uint8Array(W * H);
  render(cam, { filter: inTarget, onlyId: true });
  let alone = 0; for (let p = 0; p < W * H; p++) if (item[p]) { mask[p] = 1; alone++; }
  render(cam, { onlyId: true });
  let seen = 0; const blockers = {};
  for (let p = 0; p < W * H; p++) if (mask[p]) { if (item[p] === tIdx || inTargetIdx(item[p], tNode)) seen++; else if (item[p]) blockers[ids[item[p] - 1]] = (blockers[ids[item[p] - 1]] || 0) + 1; }
  const frac = alone ? seen / alone : 0;
  const top = Object.entries(blockers).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, px]) => ({ id, fraction: +(px / alone).toFixed(3) }));
  return { target: witness.lookAt, t, targetPixels: alone, visiblePixels: seen, visibleFraction: +frac.toFixed(3), blockers: top };
}
function inTargetIdx(i, tNode) { const id = ids[i - 1]; if (!id) return false; for (let n = world.objects[id].node; n; n = n.parent) if (n === tNode) return true; return false; }

// ---------- run ----------
const t0 = Date.now();
const T = world.duration || 10;
const nFrames = Math.max(1, Math.round(T * FPS) + 1);
for (let f = 0; f < nFrames; f++) {
  const t = Math.min(T, f / FPS);
  world.setTime(t); world.root.updateMatrixWorld(true);
  render(makeCamera());
  png(path.join(OUT, 'frames', `f${String(f).padStart(4, '0')}.png`), t / T);
}
const stillT = STILL_T != null ? Number(STILL_T) : witness ? (witness.observationTime ?? T / 2) : T / 2;
world.setTime(stillT); world.root.updateMatrixWorld(true);
render(makeCamera());
png(path.join(OUT, 'still.png'));
const renderMs = Date.now() - t0;

// Independent verdicts computed HERE, in this sandbox: raycast (checks.js) + pixel item-buffer visibility.
const verdict = { view: VIEW, world: path.basename(WORLD), frames: nFrames, fps: FPS, size: [W, H], stillT, renderMs, node: process.version, host: (await import('node:os')).hostname() };
if (witness) {
  const t = witness.observationTime ?? stillT;
  const r = checks.sightline(world, witness.id, witness.lookAt, t);
  verdict.witness = { id: witness.id, claim: witness.claim, citation: witness.citation, observationTime: t, lookAt: witness.lookAt };
  verdict.raycast = { visible: r.visible, blockedBy: r.blockedBy, distance: +r.distance.toFixed(2), hitPoint: r.hitPoint };
  verdict.pixels = pixelVisibility(t);
  // timeline: when is the target visible across the event?
  const tl = [];
  for (let tt = 0; tt <= T + 1e-9; tt += 0.5) { const s = checks.sightline(world, witness.id, witness.lookAt, tt); tl.push([+tt.toFixed(2), s.visible ? 1 : 0, s.blockedBy]); }
  verdict.timeline = tl;
  verdict.verdict = r.visible && (verdict.pixels ? verdict.pixels.visibleFraction > 0.25 : true) ? 'clear' : (!r.visible && (!verdict.pixels || verdict.pixels.visibleFraction < 0.25) ? 'blocked' : 'partial');
} else {
  verdict.runAll = checks.runAll(world).map(({ check, subject, pass, detail, blockedBy, t }) => ({ check, subject, pass, blockedBy, t, detail }));
}
fs.writeFileSync(path.join(OUT, 'verdict.json'), JSON.stringify(verdict, null, 2));
console.log(JSON.stringify({ view: VIEW, frames: nFrames, renderMs, verdict: verdict.verdict ?? `${verdict.runAll.filter((c) => c.pass).length}/${verdict.runAll.length} pass` }));
