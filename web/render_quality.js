// Render quality for the Sightline viewer: physically based lighting, soft sun shadows, correct exposure, clean AA.
// No game-style post effects (no bloom, motion blur, lens flare, vignette, DOF): a forensic exhibit must not invent light.
//
//   import { applyRenderQuality } from './render_quality.js';
//   const rq = applyRenderQuality(renderer, scene, { quality: 'interactive' | 'render', lighting: 'day', sun, roi, world });
//   await rq.ready;          // resolves once the environment map is built (an async sky module may upgrade it)
//
// opts:
//   quality   'interactive' (default; MSAA, dpr<=2, 2048 shadow map) | 'render' (2x supersampled, 4096 shadow map)
//   env       optional environment source: THREE.Texture | THREE.Object3D/Scene (PMREM'd) | 'room' | 'sky' | function(THREE) -> one of those.
//             Default: the sky dome already in the scene (web/assets/environment.js names it 'env_sky'; any mesh named
//             sky* or with userData.envSource also counts) baked to PMREM, else a sky gradient built from scene.background.
//             'room' forces three's RoomEnvironment.
//   lighting  'day' | 'dawn' | 'night' (scales environment + exposure)
//   sun       the viewer's shadow-casting DirectionalLight. If the world module authored its own directional light
//             (e.g. 'light_sun' with the case's real sun azimuth/elevation), that direction/colour is adopted for the
//             shadow caster and the world's unshadowed copy is switched off, so there is ONE sun with real shadows.
//   roi       THREE.Box3 region of interest (the viewer's overhead fit). The shadow camera is refit every frame to
//             roi + current vehicle boxes, texel-snapped so shadows do not shimmer in clips.
//   world     the loaded world ({root, objects}) - used to find vehicles for the shadow fit.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ao: ground-truth AO (three's GTAOPass; the n8ao package needs the pmndrs 'postprocessing' import map entry) at
// aoScale of the drawing buffer, blended subtly for contact shadows. msaa: samples of the composer's HDR target.
const PRESETS = {
  interactive: { maxPixelRatio: 2, supersample: 1, shadowMapSize: 2048, shadowRadius: 2.5, msaa: 4, aoScale: 0.5, aoSamples: 12 },
  render: { maxPixelRatio: 2, supersample: 2, shadowMapSize: 4096, shadowRadius: 3.5, msaa: 0, aoScale: 0.5, aoSamples: 16 },
  // LITE: software rasterisers (headless SwiftShader / llvmpipe on 2 CPUs). Same lighting model and colours, but pixel
  // ratio 1, no AO composer, 1024 shadow map (vehicles/buildings/poles only), no grass blades, foliage instances culled
  // to the camera's neighbourhood each time it moves. Keeps a 1280x720 still well under 30 s.
  lite: { maxPixelRatio: 1, supersample: 1, shadowMapSize: 1024, shadowRadius: 1.5, msaa: 0, aoScale: 0.5, aoSamples: 8, shadowCap: 300 },
};
// Foliage instance culling radii (m) in LITE: outer leaf masses / trunks keep a 170 m neighbourhood, inner (self-shadow)
// clusters 70 m. Distant tree belts beyond that are covered by the landscape treeline ring impostors (cheap cards, kept).
const LITE_R = { outer: 170, inner: 70 };

let _liteCache = null;
/** True when rendering should run in LITE mode: ?lite=1 (or ?lite=0 to force full quality), navigator.webdriver
 *  (headless/automated capture), or a software WebGL renderer (SwiftShader / llvmpipe / softpipe). Call before creating
 *  the WebGLRenderer so the context can skip MSAA (`antialias: !isLiteRendering()`). */
export function isLiteRendering(renderer) {
  if (typeof location !== 'undefined') { const m = /[?&]lite=([01])\b/.exec(location.search); if (m) return m[1] === '1'; }
  if (_liteCache != null) return _liteCache;
  let lite = false;
  try { if (typeof navigator !== 'undefined' && navigator.webdriver) lite = true; } catch (_) {}
  if (!lite) {
    try {
      let gl = renderer && renderer.getContext ? renderer.getContext() : null, tmp = null;
      if (!gl && typeof document !== 'undefined') { tmp = document.createElement('canvas'); gl = tmp.getContext('webgl2') || tmp.getContext('webgl'); }
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
        if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name)) lite = true;
        if (tmp) { const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); }
      }
    } catch (_) {}
  }
  _liteCache = lite;
  return lite;
}
// exposure / environment / light balance per lighting kind (ACES filmic). Tuned on SwiftShader stills of the demo world.
// hemi: [sky, ground, intensity] fill so shadow sides are never pitch black (null = keep the viewer's colours, scaled).
const LOOK = {
  day: { exposure: 1.0, envIntensity: 0.6, sunScale: 1.55, hemi: [0xddeeff, 0x333322, 0.6], ao: 0.8 },
  dawn: { exposure: 1.05, envIntensity: 0.45, sunScale: 1.4, hemi: [0xffe2c4, 0x332e26, 0.55], ao: 0.75 },
  night: { exposure: 1.15, envIntensity: 0.06, sunScale: 1.0, hemiScale: 0.6, ao: 0.5 },
};
const UNLIT = (m) => m && (m.isMeshBasicMaterial || m.isLineBasicMaterial || m.isSpriteMaterial || m.isPointsMaterial || m.isLineDashedMaterial);

const _box = new THREE.Box3();
const _v = new THREE.Vector3();
const _c = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

let pmrem = null;
let pmremOwner = null;
const envCache = new Map();   // key -> texture (PMREM results are reused across world reloads)

function getPmrem(renderer) {
  if (!pmrem || pmremOwner !== renderer) { pmrem = new THREE.PMREMGenerator(renderer); pmremOwner = renderer; }
  return pmrem;
}

// Outdoor sky-gradient environment: zenith -> horizon -> ground bounce. Used when no sky module is available.
function gradientEnvScene(bg, lighting) {
  const horizon = (bg && bg.isColor) ? bg.clone() : new THREE.Color(0x9ec9ec);
  const zenith = horizon.clone().lerp(new THREE.Color(lighting === 'night' ? 0x01030a : 0x3f78c0), 0.55);
  const ground = new THREE.Color(lighting === 'night' ? 0x050605 : lighting === 'dawn' ? 0x4a4436 : 0x5b5f4a);
  const geo = new THREE.SphereGeometry(50, 48, 24);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const h = pos.getY(i) / 50;   // -1..1
    if (h >= 0) c.copy(horizon).lerp(zenith, Math.pow(h, 0.6));
    else c.copy(horizon).lerp(ground, Math.min(1, -h * 4));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  return s;
}

function findSkyInScene(scene) {
  let sky = null;
  scene.traverse((o) => { if (!sky && (o.userData && (o.userData.envSource || o.userData.isSky) || (o.isMesh && /^(sky|__sky|env_sky)/i.test(o.name || '')))) sky = o; });
  return sky;
}

// Bake an Object3D sky (shader sky dome, gradient sphere, ...) into a PMREM. Shares geometry/material, does not move it.
function pmremFromObject(renderer, obj) {
  const s = new THREE.Scene();
  if (obj.isScene) return getPmrem(renderer).fromScene(obj, 0.02, 0.1, 1e6).texture;
  obj.updateWorldMatrix(true, true);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const m = new THREE.Mesh(o.geometry, o.material);
    m.matrixAutoUpdate = false;
    m.matrix.copy(o.matrixWorld);
    m.matrix.setPosition(0, 0, 0);   // centre the dome on the PMREM camera
    m.frustumCulled = false;
    s.add(m);
  });
  return getPmrem(renderer).fromScene(s, 0.02, 0.1, 1e6).texture;
}

function envFromSource(renderer, src) {
  if (!src) return null;
  if (typeof src === 'function') src = src(THREE);
  if (!src) return null;
  if (src.isTexture) {
    if (src.mapping === THREE.CubeUVReflectionMapping) return src;
    if (src.isCubeTexture) return getPmrem(renderer).fromCubemap(src).texture;
    src.mapping = THREE.EquirectangularReflectionMapping;
    return getPmrem(renderer).fromEquirectangular(src).texture;
  }
  if (src.isObject3D) return pmremFromObject(renderer, src);
  return null;
}

function isWithin(o, root) { for (let p = o; p; p = p.parent) if (p === root) return true; return false; }

/** Fit a directional light's shadow camera around `box` (texel-snapped, radius quantised to 8 m steps). */
export function fitShadowCamera(light, box, mapSize = light.shadow.mapSize.x) {
  if (!box || box.isEmpty()) return;
  box.getCenter(_c);
  const r = Math.max(10, Math.ceil(box.getSize(_v).length() / 2 / 8) * 8);
  _z.copy(light.userData.rqDir || _v.subVectors(light.position, light.target.position)).normalize();
  _x.crossVectors(Math.abs(_z.y) > 0.999 ? new THREE.Vector3(0, 0, 1) : UP, _z).normalize();
  _y.crossVectors(_z, _x);
  const texel = (2 * r) / mapSize;
  const px = Math.round(_c.dot(_x) / texel) * texel, py = Math.round(_c.dot(_y) / texel) * texel, pz = _c.dot(_z);
  _c.set(0, 0, 0).addScaledVector(_x, px).addScaledVector(_y, py).addScaledVector(_z, pz);
  light.userData.rqDir = _z.clone();
  light.target.position.copy(_c);
  light.position.copy(_c).addScaledVector(_z, r + 150);
  const sc = light.shadow.camera;
  if (sc.left !== -r || sc.far !== 2 * r + 300) {
    sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 1; sc.far = 2 * r + 300;
    sc.updateProjectionMatrix();
  }
  light.target.updateMatrixWorld();
  light.updateMatrixWorld();
}

export function applyRenderQuality(renderer, scene, opts = {}) {
  // ?rq=off: legacy look (A/B benchmarking and before/after comparisons)
  if (typeof location !== 'undefined' && /[?&]rq=off\b/.test(location.search)) return { quality: 'off', ready: Promise.resolve(), fitShadow() {}, pixelRatio: renderer.getPixelRatio() };
  const quality = opts.quality === 'render' ? 'render' : 'interactive';
  const lite = opts.lite != null ? !!opts.lite : isLiteRendering(renderer);
  const P = lite ? PRESETS.lite : PRESETS[quality];
  const lighting = (opts.lighting || 'day').toLowerCase();
  const L = LOOK[lighting] || LOOK.day;
  const gl = renderer.getContext();

  // colour pipeline
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.exposure != null ? +opts.exposure : L.exposure;

  // anti-aliasing: MSAA comes from the context ({antialias:true}); 'render' additionally supersamples 2x and lets the
  // compositor box-filter it down to the CSS size (exact 2:1 -> 2x2 average). Capped by the GPU's max texture size.
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  let pr = lite ? 1 : quality === 'render' ? Math.max(dpr, 1) * P.supersample : Math.min(dpr, P.maxPixelRatio);
  const maxTex = renderer.capabilities.maxTextureSize || 4096;
  const cssW = (renderer.domElement.clientWidth || renderer.domElement.width || 1280);
  if (cssW * pr > maxTex) pr = Math.max(1, Math.floor(maxTex / cssW));
  if (renderer.getPixelRatio() !== pr) renderer.setPixelRatio(pr);

  // shadows: PCF with a Vogel-disk radius (three r186 removed PCFSoftShadowMap; PCFShadowMap + radius is its successor)
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.needsUpdate = true;

  const handle = { quality, lite, pixelRatio: pr, lighting, exposure: renderer.toneMappingExposure, envKind: null, keyLight: null,
    msaaSamples: (gl.getContextAttributes && gl.getContextAttributes().antialias) ? (gl.getParameter(gl.SAMPLES) || 0) : 0,
    ready: Promise.resolve(), fitShadow: () => {} };
  if (!scene) return handle;
  if (typeof location !== 'undefined' && /[?&]rqdebug=1/.test(location.search) && !renderer.__rqdbg) {
    renderer.__rqdbg = true; const orig = renderer.render.bind(renderer);
    renderer.render = (s, c) => { const t = performance.now(); orig(s, c); renderer.getContext().finish(); console.log('rq render ms', (performance.now() - t).toFixed(0), 'calls', renderer.info.render.calls, 'tris', renderer.info.render.triangles, 'progs', renderer.info.programs && renderer.info.programs.length); };
    console.log('rq apply at', performance.now().toFixed(0));
  }

  // ---- light rig: one shadow-casting sun, environment fill instead of stacked hemispheres ----
  const managedSun = opts.sun || null;
  const worldRoot = opts.world && opts.world.root;
  const dirs = [], hemis = [];
  scene.traverse((o) => { if (o.isDirectionalLight) dirs.push(o); else if (o.isHemisphereLight) hemis.push(o); });
  const authored = dirs.filter((d) => d !== managedSun && d.visible && (!worldRoot || isWithin(d, worldRoot)))
    .sort((a, b) => b.intensity - a.intensity)[0];
  let key = managedSun || authored || null;
  if (key) {
    if (authored && managedSun) {
      // adopt the case's sun direction + colour + intensity; switch off the unshadowed duplicate
      authored.updateWorldMatrix(true, false);
      authored.target.updateWorldMatrix(true, false);
      const dir = new THREE.Vector3().setFromMatrixPosition(authored.matrixWorld)
        .sub(new THREE.Vector3().setFromMatrixPosition(authored.target.matrixWorld)).normalize();
      managedSun.userData.rqDir = dir;
      managedSun.color.copy(authored.color);
      managedSun.intensity = authored.intensity * L.sunScale;
      if (!authored.userData.rqOrigVisible) authored.userData.rqOrigVisible = true;
      authored.visible = false;
    } else {
      key.userData.rqDir = new THREE.Vector3().subVectors(key.position, key.target.position).normalize();
      if (key.userData.rqBaseIntensity == null) key.userData.rqBaseIntensity = key.intensity;
      key.intensity = key.userData.rqBaseIntensity * L.sunScale;
    }
    if (!key.target.parent) (key.parent || scene).add(key.target);
    key.castShadow = true;
    key.shadow.mapSize.set(P.shadowMapSize, P.shadowMapSize);
    if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    key.shadow.radius = P.shadowRadius;
    key.shadow.bias = -0.00025;
    key.shadow.normalBias = 0.035;
    handle.keyLight = key;
  }
  for (const d of dirs) if (d !== key && d.castShadow && d !== authored) d.castShadow = false;   // a single sun shadow
  // hemisphere fill alongside the sun: recolour the viewer's hemisphere light (or add one) to the sky/ground-bounce fill
  let hemi = hemis.find((h) => !worldRoot || !isWithin(h, worldRoot)) || null;
  if (!hemi && L.hemi) { hemi = new THREE.HemisphereLight(); hemi.name = 'rq_hemi_fill'; (managedSun && managedSun.parent || scene).add(hemi); hemis.push(hemi); }
  for (const h of hemis) {
    if (h.userData.rqBaseIntensity == null) h.userData.rqBaseIntensity = h.intensity;
    if (h === hemi && L.hemi) { h.color.setHex(L.hemi[0]); h.groundColor.setHex(L.hemi[1]); h.intensity = L.hemi[2]; }
    else h.intensity = h.userData.rqBaseIntensity * (L.hemiScale != null ? L.hemiScale : (h === hemi ? 1 : 0.15));
  }
  handle.hemiLight = hemi;

  // ---- shadow fit: roi + current vehicles, refit right before each render (before the shadow pass) ----
  const roi = opts.roi ? opts.roi.clone() : null;
  const vehicles = opts.world ? Object.values(opts.world.objects || {}).filter((o) => o && o.kind === 'vehicle' && o.node).map((o) => o.node) : [];
  const fitBox = new THREE.Box3();
  handle.fitShadow = (box) => {
    if (!key) return;
    fitBox.makeEmpty();
    if (box) fitBox.copy(box); else if (roi) fitBox.copy(roi);
    for (const n of vehicles) { _box.setFromObject(n); if (!_box.isEmpty() && _box.getSize(_v).length() < 120) fitBox.union(_box); }
    if (fitBox.isEmpty()) fitBox.set(new THREE.Vector3(-60, 0, -60), new THREE.Vector3(60, 10, 60));
    fitBox.expandByScalar(6);
    // cap the covered area so texel density stays forensic-grade (<= ~15 cm at 4096)
    const s = fitBox.getSize(_v), cap = P.shadowCap || 560;
    if (s.x > cap || s.z > cap) { fitBox.getCenter(_c); fitBox.min.x = Math.max(fitBox.min.x, _c.x - cap / 2); fitBox.max.x = Math.min(fitBox.max.x, _c.x + cap / 2); fitBox.min.z = Math.max(fitBox.min.z, _c.z - cap / 2); fitBox.max.z = Math.min(fitBox.max.z, _c.z + cap / 2); }
    fitShadowCamera(key, fitBox, P.shadowMapSize);
  };
  handle.setRoi = (b) => { if (b) { if (roi) roi.copy(b); else handle.roi = b.clone(); } };

  // overlays (markers, labels, sight lines, highlight boxes) are drawn in exact UI colours, outside tone mapping
  const overlayRoots = (opts.overlays || []).filter(Boolean);
  const fixOverlay = (o) => {
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) if (UNLIT(m) && m.toneMapped !== false) { m.toneMapped = false; m.needsUpdate = true; }
  };
  const prevBefore = scene.userData.rqPrevBefore !== undefined ? scene.userData.rqPrevBefore : scene.onBeforeRender;
  scene.userData.rqPrevBefore = prevBefore;
  scene.onBeforeRender = function (r, s, cam, rt) {
    if (prevBefore && prevBefore !== THREE.Object3D.prototype.onBeforeRender) prevBefore.call(this, r, s, cam, rt);
    handle.fitShadow();
    for (const g of overlayRoots) g.traverse((o) => { if (o.material) fixOverlay(o); });
  };

  // ---- ambient occlusion + MSAA: HDR composer (RenderPass -> GTAO -> OutputPass: tone map + sRGB), overlays on top ----
  const aoOff = lite || opts.ao === false || (typeof location !== 'undefined' && /[?&]ao=0\b/.test(location.search));
  handle.ao = !aoOff;
  if (!aoOff) {
    try { handle.render = makeComposerRender(renderer, scene, P, L, overlayRoots, worldRoot); }
    catch (e) { console.warn('render_quality: AO composer unavailable, plain render', e); handle.ao = false; }
  }
  if (!handle.render) handle.render = (cam) => renderer.render(scene, cam);
  if (lite) {
    const cull = makeLiteCuller(scene);
    const base = handle.render;
    handle.render = (cam) => { cull(cam); return base(cam); };
    handle.liteStats = cull.stats;
  }

  // ---- environment (image-based fill + reflections) ----
  scene.environmentIntensity = L.envIntensity;
  const setEnv = (tex, kind) => { if (tex) { scene.environment = tex; handle.envKind = kind; } };
  const bgKey = (scene.background && scene.background.isColor) ? scene.background.getHexString() : 'none';
  const gradient = () => {
    const k = 'grad:' + bgKey + ':' + lighting;
    if (!envCache.has(k)) envCache.set(k, getPmrem(renderer).fromScene(gradientEnvScene(scene.background, lighting), 0.03).texture);
    return envCache.get(k);
  };
  const room = () => {
    if (!envCache.has('room')) { const rs = new RoomEnvironment(); envCache.set('room', getPmrem(renderer).fromScene(rs, 0.04).texture); rs.dispose && rs.dispose(); }
    return envCache.get('room');
  };
  try {
    if (opts.env === 'room') setEnv(room(), 'room');
    else if (opts.env && opts.env !== 'sky') setEnv(envFromSource(renderer, opts.env), 'custom');
    else {
      const sky = findSkyInScene(scene);
      if (sky) tuneSky(sky, L, opts);
      if (sky) setEnv(pmremFromObject(renderer, sky), 'scene-sky');
      else {
        setEnv(gradient(), 'gradient');
      }
    }
  } catch (e) {
    console.warn('render_quality: environment fallback to RoomEnvironment', e);
    try { setEnv(room(), 'room'); } catch (_) {}
  }
  return handle;
}

// ---- LITE scene budget ----
const FOLIAGE_NAME = /leaves|inner|foliage|core|fronds|moss|treeline|shrub|wood|trunk|branch/i;
const IMPOSTOR_NAME = /impostor|ring_trees/i;
function isFoliageMesh(o) {
  if (!o.isInstancedMesh) return false;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  if (mats.some((m) => m && /^foliage_|bark|treeline|treeCore|moss|frond/i.test(m.name || ''))) return true;
  return FOLIAGE_NAME.test(o.name || '');
}
function makeLiteCuller(scene) {
  const entries = [];
  const stats = { foliageMeshes: 0, instancesTotal: 0, instancesDrawn: 0, grassHidden: 0 };
  const seen = new WeakSet();
  const scan = () => {
    scene.traverse((o) => {
      if (seen.has(o)) return;
      seen.add(o);
      if (o.userData && o.userData.assetType === 'grassBlades') { o.visible = false; stats.grassHidden++; return; }
      if (!o.isInstancedMesh) return;
      if (IMPOSTOR_NAME.test(o.name || '')) { o.castShadow = false; return; }
      if (!isFoliageMesh(o) || o.count < 24) return;
      o.castShadow = false;   // sun shadows from vehicles / buildings / poles only
      const n = o.count, src = new Float32Array(o.instanceMatrix.array.subarray(0, n * 16));
      const col = o.instanceColor ? new Float32Array(o.instanceColor.array.subarray(0, n * 3)) : null;
      const inner = /inner|core/i.test(o.name || '');
      entries.push({ o, n, src, col, r: inner ? LITE_R.inner : LITE_R.outer, last: null });
      stats.foliageMeshes++; stats.instancesTotal += n;
    });
  };
  let lastScan = -1;
  const cam = new THREE.Vector3(), wp = new THREE.Vector3(), m4 = new THREE.Matrix4();
  function cull(camera) {
    // rescan occasionally (worlds add scenery lazily, e.g. landscape rings on first attach)
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (lastScan < 0 || now - lastScan > 2000) { scan(); lastScan = now; }
    camera.getWorldPosition(cam);
    let drawn = 0;
    for (const e of entries) {
      const o = e.o;
      if (e.last && e.last.distanceToSquared(cam) < 25) { drawn += o.count; continue; }   // moved < 5 m: keep
      o.updateWorldMatrix(true, false);
      const r2 = e.r * e.r, dst = o.instanceMatrix.array, dcol = o.instanceColor ? o.instanceColor.array : null;
      let k = 0;
      for (let i = 0; i < e.n; i++) {
        m4.fromArray(e.src, i * 16);
        wp.setFromMatrixPosition(m4).applyMatrix4(o.matrixWorld);
        const dx = wp.x - cam.x, dz = wp.z - cam.z;
        if (dx * dx + dz * dz > r2) continue;
        if (k !== i) { dst.set(e.src.subarray(i * 16, i * 16 + 16), k * 16); if (dcol) dcol.set(e.col.subarray(i * 3, i * 3 + 3), k * 3); }
        else if (e.last) { dst.set(e.src.subarray(i * 16, i * 16 + 16), k * 16); if (dcol) dcol.set(e.col.subarray(i * 3, i * 3 + 3), k * 3); }
        k++;
      }
      o.count = k; o.instanceMatrix.needsUpdate = true; if (o.instanceColor) o.instanceColor.needsUpdate = true;
      o.frustumCulled = false;   // bounding sphere no longer matches the compacted set
      e.last = (e.last || new THREE.Vector3()).copy(cam);
      drawn += k;
    }
    stats.instancesDrawn = drawn;
  }
  cull.stats = stats;
  return cull;
}

// Display match for the Preetham dome under ACES: its radiance (skyGain-scaled to the scene's lux model) sits high on the
// filmic shoulder, which desaturates a clear sky toward white. Scale the dome's output (and the luminance floor) so the
// zenith lands at a saturated mid blue, and trim the Mie aureole that washes the sun-side horizon. Idempotent per mesh.
// ?skyk=<n> overrides the scale for A/B checks.
function tuneSky(sky, L, opts) {
  const k = opts.skyScale ?? ((typeof location !== 'undefined' && /[?&]skyk=([\d.]+)/.exec(location.search)) || [])[1] ?? L.skyScale;
  if (k == null) return;
  sky.traverse((o) => {
    const u = o.material && o.material.uniforms;
    if (!u || !u.skyGain) return;
    const ud = o.userData;
    if (ud.rqSkyBase == null) ud.rqSkyBase = { gain: u.skyGain.value, floor: u.skyFloor ? u.skyFloor.value : 0, mie: u.mieCoefficient ? u.mieCoefficient.value : 0 };
    u.skyGain.value = ud.rqSkyBase.gain * +k;
    if (u.skyFloor) u.skyFloor.value = ud.rqSkyBase.floor * +k;
    if (u.mieCoefficient && L.mieScale != null) u.mieCoefficient.value = ud.rqSkyBase.mie * L.mieScale;
  });
}

const _sz = new THREE.Vector2();
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
const DEPTH_ONLY = new THREE.MeshBasicMaterial({ colorWrite: false });

// Returns render(camera): world through the AO composer, then the overlays (markers, labels, sight rays, highlight /
// x-ray boxes) straight to the canvas in exact UI colours, depth-tested against the world's depth.
function makeComposerRender(renderer, scene, P, L, overlayRoots, worldRoot) {
  const pr0 = renderer.getPixelRatio();
  renderer.getSize(_sz);
  const rt = new THREE.WebGLRenderTarget(Math.max(1, _sz.x * pr0), Math.max(1, _sz.y * pr0), { type: THREE.HalfFloatType, samples: P.msaa || 0 });
  const composer = new EffectComposer(renderer, rt);
  let cam0 = new THREE.PerspectiveCamera();
  const rp = new RenderPass(scene, cam0);
  const gtao = new GTAOPass(scene, cam0, 16, 16);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = L.ao;
  gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.6, thickness: 1.2, scale: 1.0, samples: P.aoSamples, distanceFallOff: 1.0, screenSpaceRadius: false });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 12 });
  const gtaoSetSize = gtao.setSize.bind(gtao);
  gtao.setSize = (w, h) => gtaoSetSize(Math.max(1, Math.round(w * P.aoScale)), Math.max(1, Math.round(h * P.aoScale)));
  composer.addPass(rp); composer.addPass(gtao); composer.addPass(new OutputPass());
  let lastW = -1, lastH = -1, lastPr = -1, lastCam = null;
  const isOverlay = (o) => o.userData && o.userData.xray;
  const hiddenNow = [];
  return function render(camera) {
    renderer.getSize(_sz);
    const pr = renderer.getPixelRatio();
    if (_sz.x !== lastW || _sz.y !== lastH || pr !== lastPr) {
      lastW = _sz.x; lastH = _sz.y; lastPr = pr;
      composer.setPixelRatio(pr); composer.setSize(_sz.x, _sz.y);
    }
    if (camera !== lastCam) {
      rp.camera = camera; gtao.camera = camera; lastCam = camera;
      const persp = camera.isPerspectiveCamera ? 1 : 0;
      for (const m of [gtao.gtaoMaterial, gtao.pdMaterial, gtao.depthRenderMaterial]) {
        if (m && m.defines && m.defines.PERSPECTIVE_CAMERA !== persp) { m.defines.PERSPECTIVE_CAMERA = persp; m.needsUpdate = true; }
      }
    }
    // one shadow-map update per frame (the composer renders the scene twice: beauty + GTAO normals)
    const sm = renderer.shadowMap, autoUp = sm.autoUpdate;
    sm.autoUpdate = false; sm.needsUpdate = true;
    // 1) world only
    hiddenNow.length = 0;
    for (const g of overlayRoots) if (g.visible) { g.visible = false; hiddenNow.push(g); }
    const xr = [];
    if (worldRoot) worldRoot.traverse((o) => { if (isOverlay(o) && o.visible) xr.push(o); });
    for (const o of xr) { o.visible = false; hiddenNow.push(o); }
    try { composer.render(); } finally { for (const o of hiddenNow) o.visible = true; }
    // 2) overlays to the canvas: world written to depth only, overlays drawn in UI colours (toneMapped=false)
    if (hiddenNow.length) {
      const swapped = [];
      scene.traverse((o) => {
        if (!(o.isMesh || o.isLine || o.isPoints || o.isSprite) || !o.material) return;
        let ov = false; for (let p = o; p; p = p.parent) { if (overlayRoots.includes(p) || isOverlay(p)) { ov = true; break; } }
        if (ov) return;
        swapped.push(o, o.material);
        o.material = (o.isMesh && !o.isSprite) ? DEPTH_ONLY : HIDDEN;
      });
      const bg = scene.background, ac = renderer.autoClear, cb = scene.onBeforeRender;
      scene.background = null; renderer.autoClear = false; scene.onBeforeRender = () => {};
      renderer.setRenderTarget(null);
      try { renderer.clearDepth(); renderer.render(scene, camera); }
      finally {
        for (let i = 0; i < swapped.length; i += 2) swapped[i].material = swapped[i + 1];
        scene.background = bg; renderer.autoClear = ac; scene.onBeforeRender = cb;
      }
    }
    sm.autoUpdate = autoUp;
  };
}

export default applyRenderQuality;
