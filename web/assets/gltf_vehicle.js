// Sightline asset library — glTF/GLB vehicle loader + fitter. Owner: VEH-CARS. Browser + Node (Node: no-op, procedural stays).
//
//   preloadGLB(url)                          -> Promise<gltf.scene|null>   (cached per URL; never rejects)
//   glbSupported()                           -> bool (browser with fetch; false in Node/headless)
//   fitGLBTemplate(THREE, scene, spec)       -> THREE.Group template, footprint-centred, faces -Z, scaled to spec.dims
//   swapInGLB(THREE, vehicle, spec, opts)    -> vehicle  (returns immediately; when the GLB is ready the procedural
//                                               shell + wheels are replaced in place, userData API kept)
//   ready()                                  -> Promise that resolves when every pending swap has settled
//
// spec = { url, dims:{length,width,height}, front:'auto'|'+z'|'-z'|'+x'|'-x', mats:{paint, glass, head, tail, tyre, rim,
//          chrome, trim, plastic, lens, plate, indicator}: RegExp, wheels:'split'|'keep', interior:fn(THREE, root) }
// Geometry is baked to world space, rotated so the front faces -Z, scaled per axis to the catalog envelope (wheels keep
// a round section: their Y/Z scale is the body's Y scale), split into headlight_L/R, taillight_L/R and four rolling
// wheel groups (wheel_FL/FR/RL/RR). Paint is replaced with the per-colour clearcoat paint; glass with tinted transmission.
import { getMaterials } from './vehicle_parts.js';

const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined' && typeof fetch === 'function';
export function glbSupported() { return IS_BROWSER && !(typeof window !== 'undefined' && window.__SIGHTLINE_NO_GLB); }

let loaderP = null;
async function getLoader() {
  if (!loaderP) loaderP = (async () => {
    let mod = null;
    for (const spec of ['three/addons/loaders/GLTFLoader.js', '/node_modules/three/examples/jsm/loaders/GLTFLoader.js']) {
      try { mod = await import(/* @vite-ignore */ spec); if (mod && mod.GLTFLoader) break; } catch { mod = null; }
    }
    return mod && mod.GLTFLoader ? new mod.GLTFLoader() : null;
  })();
  return loaderP;
}

const SCENES = new Map();          // url -> Promise<scene|null>
export function preloadGLB(url) {
  if (!glbSupported() || !url) return Promise.resolve(null);
  if (!SCENES.has(url)) {
    SCENES.set(url, (async () => {
      try {
        const loader = await getLoader();
        if (!loader) return null;
        const gltf = await loader.loadAsync(url);
        return gltf.scene || (gltf.scenes && gltf.scenes[0]) || null;
      } catch (e) {
        if (typeof console !== 'undefined') console.warn('[gltf_vehicle] load failed', url, e && e.message);
        return null;
      }
    })());
  }
  return SCENES.get(url);
}

// ------------------------------------------------------------------ geometry helpers
function bakeMeshes(THREE, scene) {
  scene.updateMatrixWorld(true);
  const out = [];
  scene.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    let g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (Array.isArray(o.material) && g.groups.length) {
      // split multi-material meshes into one geometry per group
      for (const grp of g.groups) out.push({ geo: subGeometry(THREE, g, grp.start, grp.count), mat: mats[grp.materialIndex] });
    } else out.push({ geo: g, mat: mats[0] });
  });
  return out;
}

function subGeometry(THREE, g, start, count) {
  const idx = g.index;
  const pick = [];
  for (let i = start; i < start + count; i++) pick.push(idx ? idx.getX(i) : i);
  return gatherTris(THREE, g, pick);
}

// build a non-indexed geometry from a list of vertex indices (multiple of 3)
function gatherTris(THREE, g, vIdx) {
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const n = attr.itemSize, arr = new Float32Array(vIdx.length * n);
    for (let i = 0; i < vIdx.length; i++) for (let k = 0; k < n; k++) arr[i * n + k] = attr.getComponent(vIdx[i], k);
    out.setAttribute(name, new THREE.BufferAttribute(arr, n, attr.normalized));
  }
  return out;
}

// partition triangles by a key function of the triangle centroid -> Map(key -> geometry)
function partition(THREE, g, keyFn) {
  const idx = g.index, pos = g.attributes.position;
  const nTri = (idx ? idx.count : pos.count) / 3;
  const buckets = new Map();
  for (let t = 0; t < nTri; t++) {
    const a = idx ? idx.getX(3 * t) : 3 * t, b = idx ? idx.getX(3 * t + 1) : 3 * t + 1, c = idx ? idx.getX(3 * t + 2) : 3 * t + 2;
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3, cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    const k = keyFn(cx, cy, cz);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(a, b, c);
  }
  const out = new Map();
  for (const [k, list] of buckets) out.set(k, gatherTris(THREE, g, list));
  return out;
}

const DEFAULT_MATS = {
  paint: /paint|body|carpaint|car_paint|exterior/i, glass: /glass|window|windshield/i, head: /^headl|head.?light|headlamp/i,
  tail: /tail|brake.?light|rear.?light/i, tyre: /tyre|tire|rubber/i, rim: /^rim|wheel|alloy/i, chrome: /chrome|metal/i,
  lens: /lens/i, plate: /plate|licen/i, indicator: /indicator|amber|signal/i, trim: /trim|black/i, plastic: /plastic|bumper/i,
  interior: /interior|seat|dash/i,
};

function classify(spec, mat) {
  const name = (mat && mat.name) || '';
  const M = { ...DEFAULT_MATS, ...(spec.mats || {}) };
  for (const k of ['head', 'tail', 'indicator', 'lens', 'glass', 'tyre', 'rim', 'plate', 'chrome', 'interior', 'paint', 'trim', 'plastic']) if (M[k] && M[k].test(name)) return k;
  return 'other';
}

/** Build a fitted template from a loaded glTF scene. Result children: 'shell' group + wheel groups (userData.glbWheels). */
export function fitGLBTemplate(THREE, scene, spec) {
  const M = getMaterials(THREE);
  const parts = bakeMeshes(THREE, scene);
  // ---- orientation: long horizontal axis -> Z, front -> -Z
  const bb = new THREE.Box3();
  for (const p of parts) { p.geo.computeBoundingBox(); bb.union(p.geo.boundingBox); }
  const size = bb.getSize(new THREE.Vector3());
  const rot = new THREE.Matrix4();
  if (size.x > size.z * 1.05) rot.makeRotationY(Math.PI / 2);
  for (const p of parts) p.geo.applyMatrix4(rot);
  let front = spec.front || 'auto';
  const bb2 = new THREE.Box3();
  for (const p of parts) { p.geo.computeBoundingBox(); bb2.union(p.geo.boundingBox); }
  const ctr = bb2.getCenter(new THREE.Vector3());
  if (front === 'auto') {
    const heads = parts.filter(p => classify(spec, p.mat) === 'head');
    if (heads.length) {
      const hb = new THREE.Box3(); for (const p of heads) hb.union(p.geo.boundingBox);
      front = hb.getCenter(new THREE.Vector3()).z > ctr.z ? '+z' : '-z';
    } else front = '-z';
  }
  if (front === '+z') { const r = new THREE.Matrix4().makeRotationY(Math.PI); for (const p of parts) p.geo.applyMatrix4(r); }
  // ---- envelope -> catalog dims (per-axis), footprint centre at origin, ground at y=0
  const bb3 = new THREE.Box3();
  for (const p of parts) { p.geo.computeBoundingBox(); bb3.union(p.geo.boundingBox); }
  const s3 = bb3.getSize(new THREE.Vector3()), c3 = bb3.getCenter(new THREE.Vector3());
  const D = spec.dims;
  const sx = D.width / s3.x, sy = D.height / s3.y, sz = D.length / s3.z;
  const tm = new THREE.Matrix4().makeTranslation(-c3.x, -bb3.min.y, -c3.z);
  const sm = new THREE.Matrix4().makeScale(sx, sy, sz);

  const shell = new THREE.Group(); shell.name = 'shell';
  const root = new THREE.Group();
  root.add(shell);
  const wheelParts = [];
  for (const p of parts) {
    const kind = classify(spec, p.mat);
    p.geo.applyMatrix4(tm);
    if ((kind === 'tyre' || kind === 'rim') && spec.wheels !== 'keep') { wheelParts.push({ ...p, kind }); continue; }
    p.geo.applyMatrix4(sm);
    p.geo.computeVertexNormals();
    let mat;
    switch (kind) {
      case 'paint': mat = null; break;
      case 'glass': mat = M.glassTint || M.glass; break;
      case 'head': case 'tail': mat = kind === 'head' ? M.lightHead : M.lightTail; break;
      case 'indicator': mat = M.lightAmber; break;
      case 'lens': mat = M.lightHead; break;
      case 'chrome': mat = M.chrome; break;
      case 'plate': mat = M.plate; break;
      case 'trim': mat = M.trimGloss; break;
      case 'plastic': mat = M.plastic; break;
      case 'interior': mat = M.interior; break;
      default: mat = p.mat;
    }
    if (kind === 'head' || kind === 'tail') {
      for (const [side, g] of partition(THREE, p.geo, (x) => (x < 0 ? 'L' : 'R'))) {
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, mat); m.name = (kind === 'head' ? 'headlight_' : 'taillight_') + side; m.userData.lampKind = kind;
        m.castShadow = false; shell.add(m);
      }
      continue;
    }
    const m = new THREE.Mesh(p.geo, mat || M.paint('silver'));
    m.name = 'glb_' + kind;
    if (kind === 'paint') m.userData.paintSlot = 0;
    if (kind === 'glass') { m.castShadow = false; m.userData.noShadow = true; }
    shell.add(m);
  }
  // ---- wheels: split tyre/rim triangles by quadrant, pivot each at its own centre
  const wheels = [];
  if (wheelParts.length) {
    const quads = new Map();
    for (const wp of wheelParts) {
      for (const [k, g] of partition(THREE, wp.geo, (x, y, z) => (z < 0 ? 'F' : 'R') + (x < 0 ? 'L' : 'R'))) {
        if (!quads.has(k)) quads.set(k, []);
        quads.get(k).push({ geo: g, kind: wp.kind });
      }
    }
    for (const [k, list] of quads) {
      const wb = new THREE.Box3(); for (const q of list) { q.geo.computeBoundingBox(); wb.union(q.geo.boundingBox); }
      const wc = wb.getCenter(new THREE.Vector3());
      const R0 = Math.max(wb.max.y - wc.y, (wb.max.z - wb.min.z) / 2);
      const outer = new THREE.Group(); outer.name = 'wheel_' + k;
      const spin = new THREE.Group(); spin.name = 'wheel_spin'; outer.add(spin);
      // centre scaled with the body; section scaled round (Y scale) so the tyre still touches the ground
      outer.position.set(wc.x * sx, wc.y * sy, wc.z * sz);
      const wm = new THREE.Matrix4().makeTranslation(-wc.x, -wc.y, -wc.z).premultiply(new THREE.Matrix4().makeScale(sx, sy, sy));
      for (const q of list) {
        q.geo.applyMatrix4(wm); q.geo.computeVertexNormals();
        const m = new THREE.Mesh(q.geo, q.kind === 'tyre' ? M.rubber : M.alloy); m.name = q.kind === 'tyre' ? 'tire' : 'rim';
        spin.add(m);
      }
      const R = R0 * sy;
      outer.userData = { assetPart: 'wheel', radius: R, side: wc.x < 0 ? 'left' : 'right', spin, roll(dist) { spin.rotation.x = -dist / R; } };
      root.add(outer); wheels.push(outer);
    }
  }
  root.userData.glbWheels = wheels.map(w => w.name);
  root.userData.fit = { sx, sy, sz, src: { length: s3.z, width: s3.x, height: s3.y } };
  if (typeof spec.interior === 'function') spec.interior(THREE, root);
  return root;
}

const TEMPLATES = new Map();       // url|dims -> Promise<template|null>
function templateFor(THREE, spec) {
  const key = spec.url + '|' + spec.dims.length + 'x' + spec.dims.width + 'x' + spec.dims.height;
  if (!TEMPLATES.has(key)) TEMPLATES.set(key, preloadGLB(spec.url).then(sc => {
    if (!sc) return null;
    try { return fitGLBTemplate(THREE, sc, spec); } catch (e) { console.warn('[gltf_vehicle] fit failed', spec.url, e && e.message); return null; }
  }));
  return TEMPLATES.get(key);
}
/** Synchronous access to an already-fitted template (null if not loaded yet). */
const SYNC = new Map();
export function templateIfReady(THREE, spec) {
  const key = spec.url + '|' + spec.dims.length + 'x' + spec.dims.width + 'x' + spec.dims.height;
  return SYNC.get(key) || null;
}
export function warmTemplate(THREE, spec) {
  const key = spec.url + '|' + spec.dims.length + 'x' + spec.dims.width + 'x' + spec.dims.height;
  const p = templateFor(THREE, spec).then(t => { if (t) SYNC.set(key, t); return t; });
  track(p);
  return p;
}

const PENDING = new Set();
function track(p) { PENDING.add(p); p.finally(() => PENDING.delete(p)); return p; }
/** Resolves once all GLB loads / swaps started so far (and any they trigger) have settled. */
export async function ready() {
  while (PENDING.size) await Promise.allSettled([...PENDING]);
  return true;
}

/**
 * Put GLB content into an existing procedural vehicle (the placeholder). Replaces its 'shell' child and wheels; keeps
 * name, transform, userData (dims, driverEye, setLights, roll). `apply(clone)` customises the clone (paint etc).
 * If the template is already fitted, the swap happens synchronously.
 */
export function swapInGLB(THREE, vehicle, spec, apply) {
  if (!glbSupported() || !spec || !spec.url) return vehicle;
  const doSwap = (tpl) => {
    if (!tpl || vehicle.userData.disposed) return;
    const clone = tpl.clone(true);
    if (apply) apply(clone);
    // remove placeholder shell + wheels (+ any old headlamp beam so it is rebuilt with the new lamps)
    const drop = vehicle.children.filter(c => c.name === 'shell' || /^wheel_/.test(c.name) || c.name === 'headlamp_beam' || c.isSpotLight || (c.parent === vehicle && c.type === 'Object3D' && c.userData.isBeamTarget));
    for (const c of drop) vehicle.remove(c);
    for (const c of [...vehicle.children]) if (c.isObject3D && !c.isMesh && !c.isGroup && !c.isLight && c.name === '') vehicle.remove(c); // spot targets
    const ws = vehicle.userData.wheels || (vehicle.userData.wheels = []);
    ws.length = 0;
    for (const c of [...clone.children]) {
      vehicle.add(c);
      if (/^wheel_/.test(c.name)) ws.push(c);
    }
    vehicle.traverse(o => { if (o.isMesh) { o.castShadow = !o.userData.lampKind && !o.userData.noShadow; o.receiveShadow = true; } });
    const wasOn = !!vehicle.userData.lightsOn;
    if (vehicle.userData._relight) vehicle.userData._relight();
    if (wasOn && vehicle.userData.setLights) vehicle.userData.setLights(true);
    vehicle.userData.procedural = false;
    vehicle.userData.model = spec.modelId || spec.url;
    vehicle.userData.glbFit = tpl.userData.fit;
    if (typeof vehicle.userData.onModelSwap === 'function') { try { vehicle.userData.onModelSwap(vehicle); } catch {} }
  };
  const sync = templateIfReady(THREE, spec);
  if (sync) { doSwap(sync); return vehicle; }
  vehicle.userData.modelPending = true;
  track(warmTemplate(THREE, spec).then(t => { doSwap(t); vehicle.userData.modelPending = false; }));
  return vehicle;
}
