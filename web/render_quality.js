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

const PRESETS = {
  interactive: { maxPixelRatio: 2, supersample: 1, shadowMapSize: 2048, shadowRadius: 2.5 },
  render: { maxPixelRatio: 2, supersample: 2, shadowMapSize: 4096, shadowRadius: 3.5 },
};
// exposure / environment / light balance per lighting kind (ACES filmic). Tuned on SwiftShader stills of the demo world.
const LOOK = {
  day: { exposure: 1.0, envIntensity: 0.75, sunScale: 1.55, hemiScale: 0.18 },
  dawn: { exposure: 1.05, envIntensity: 0.45, sunScale: 1.4, hemiScale: 0.3 },
  night: { exposure: 1.15, envIntensity: 0.06, sunScale: 1.0, hemiScale: 0.6 },
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
  const quality = opts.quality === 'render' ? 'render' : 'interactive';
  const P = PRESETS[quality];
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
  let pr = quality === 'render' ? Math.max(dpr, 1) * P.supersample : Math.min(dpr, P.maxPixelRatio);
  const maxTex = renderer.capabilities.maxTextureSize || 4096;
  const cssW = (renderer.domElement.clientWidth || renderer.domElement.width || 1280);
  if (cssW * pr > maxTex) pr = Math.max(1, Math.floor(maxTex / cssW));
  if (renderer.getPixelRatio() !== pr) renderer.setPixelRatio(pr);

  // shadows: PCF with a Vogel-disk radius (three r186 removed PCFSoftShadowMap; PCFShadowMap + radius is its successor)
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.needsUpdate = true;

  const handle = { quality, pixelRatio: pr, lighting, exposure: renderer.toneMappingExposure, envKind: null, keyLight: null,
    msaaSamples: (gl.getContextAttributes && gl.getContextAttributes().antialias) ? (gl.getParameter(gl.SAMPLES) || 0) : 0,
    ready: Promise.resolve(), fitShadow: () => {} };
  if (!scene) return handle;

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
  for (const h of hemis) {
    if (h.userData.rqBaseIntensity == null) h.userData.rqBaseIntensity = h.intensity;
    h.intensity = h.userData.rqBaseIntensity * L.hemiScale;
  }

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
    const s = fitBox.getSize(_v), cap = 560;
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

export default applyRenderQuality;
