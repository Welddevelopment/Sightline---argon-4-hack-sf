// web/assets/aerial.js — georeferenced aerial photo of the real site, in the world frame, plus a viewer-agnostic
// "aerial dissolve" intro (flat photo -> registered 3D overhead), as in professional crash animations.
//
//   import { loadCaseAerial, aerialGround, hideWorldGround, aerialDissolve } from './assets/aerial.js';
//   const meta = await loadCaseAerial('demo');                       // GET /api/cases/demo/aerial (null if none)
//   const ground = aerialGround(THREE, { url: meta.url, boundsMeters: meta.boundsMeters, calibration: meta.calibration });
//   scene.add(ground); const restore = hideWorldGround(world.root); // the photo replaces the grass ground plane
//
//   const intro = aerialDissolve(THREE, { scene, camera, ground, focus: [0, -15], endPose: {...} });
//   // in YOUR render loop:  intro.update(tSeconds); renderer.render(scene, camera);   ...  intro.dispose() when done
//
// World frame: metres, Y up, +X east, -Z north. Image top = north. boundsMeters {minX,maxX,minZ,maxZ} are the image edges
// relative to the world origin; calibration {rotationDeg, offsetX, offsetZ} then applies world = rotY(rot) * p + offset
// (THREE rotation.y sense: positive turns east toward north, i.e. counter-clockwise seen from above).
// Pure ES module; needs only the THREE namespace you pass in (no DOM except TextureLoader when `url` is given).

const DEG = Math.PI / 180;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };

/** Fetch a case's aerial metadata from the server. Resolves null when the case has none (or the server is absent). */
export async function loadCaseAerial(caseId = 'demo', { base = '', fetchImpl = globalThis.fetch } = {}) {
  try {
    const r = await fetchImpl(`${base}/api/cases/${encodeURIComponent(caseId)}/aerial`);
    if (!r.ok) return null;
    const m = await r.json();
    return m && m.available && m.url ? m : null;
  } catch { return null; }
}

/**
 * aerialGround(THREE, {url | texture, boundsMeters, opacity=1, y=-0.02, calibration, heightFn, segments, lit=false, attribution})
 * -> THREE.Mesh lying in the XZ plane with the photo mapped north-up. userData: {assetType:'aerialGround', boundsMeters,
 *    calibration, attribution, ready: Promise<texture>, setOpacity(o)}.
 * y: height of the plane (default 2 cm below the road surface at y=0). heightFn(x, z) -> ground height drapes the photo on
 *    terrain (e.g. assets' roadHeight); the mesh is then subdivided (segments, default 96 along the long side).
 * The world's own ground plane sits at y≈0 and will hide this photo: call hideWorldGround(world.root) for overhead views.
 */
export function aerialGround(THREE, opts = {}) {
  const b = opts.boundsMeters;
  if (!b || !Number.isFinite(b.minX + b.maxX + b.minZ + b.maxZ)) throw new Error('aerialGround: boundsMeters {minX,maxX,minZ,maxZ} required');
  const cal = { rotationDeg: 0, offsetX: 0, offsetZ: 0, ...(opts.calibration || {}) };
  const y = opts.y ?? -0.02;
  const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
  const nLong = opts.heightFn ? (opts.segments ?? 96) : 1;
  const sx = w >= d ? nLong : Math.max(1, Math.round(nLong * w / d)), sz = d > w ? nLong : Math.max(1, Math.round(nLong * d / w));
  const geo = new THREE.PlaneGeometry(w, d, sx, sz);   // XY plane, uv v=1 at +Y
  geo.rotateX(-Math.PI / 2);                            // +Y (image top) -> -Z (north)
  geo.translate((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  if (cal.rotationDeg) geo.rotateY(cal.rotationDeg * DEG);
  geo.translate(cal.offsetX || 0, y, cal.offsetZ || 0);
  if (opts.heightFn) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, opts.heightFn(pos.getX(i), pos.getZ(i)) + y);
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }
  geo.computeBoundingBox(); geo.computeBoundingSphere();

  let resolveReady, rejectReady;
  const ready = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
  const prep = (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = opts.anisotropy ?? 8;
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  };
  let tex = opts.texture ? prep(opts.texture) : null;
  if (tex) resolveReady(tex);
  else if (opts.url) {
    tex = new THREE.TextureLoader().load(opts.url, (t) => { prep(t); resolveReady(t); }, undefined, (e) => rejectReady(e || new Error('aerial load failed: ' + opts.url)));
    prep(tex);
  } else throw new Error('aerialGround: url or texture required');
  ready.catch(() => {});

  const opacity = opts.opacity ?? 1;
  const common = { map: tex, transparent: opacity < 1, opacity, fog: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
  const mat = opts.lit
    ? new THREE.MeshStandardMaterial({ ...common, roughness: 1, metalness: 0 })   // receives 3D shadows, tone-mapped
    : new THREE.MeshBasicMaterial({ ...common, toneMapped: false });             // photo-faithful (baked shadows)
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = opts.id || 'aerial_ground';
  mesh.receiveShadow = !!opts.lit; mesh.castShadow = false;
  mesh.renderOrder = opts.renderOrder ?? -1;
  mesh.userData = {
    assetType: 'aerialGround', boundsMeters: { ...b }, calibration: cal, attribution: opts.attribution || 'USGS The National Map',
    dims: { length: w, width: d, height: 0 }, ready, pickable: false,
    setOpacity(o) { mat.opacity = o; mat.transparent = o < 1; mat.depthWrite = o >= 1; mat.needsUpdate = true; mesh.visible = o > 0.001; },
  };
  mesh.raycast = () => {};   // never block sightline rays / picking
  return mesh;
}

/** aerialFromMeta(THREE, meta, extra) — aerialGround from GET /api/cases/:id/aerial output. */
export function aerialFromMeta(THREE, meta, extra = {}) {
  return aerialGround(THREE, { url: meta.url, boundsMeters: meta.boundsMeters, calibration: meta.calibration, attribution: meta.attribution, ...extra });
}

/** Hide every world ground plane (userData.assetType 'groundPlane' or name 'ground') under root. Returns restore(). */
export function hideWorldGround(root, test = (o) => o.userData?.assetType === 'groundPlane' || o.name === 'ground') {
  const hidden = [];
  root?.traverse?.((o) => { if (o.visible && test(o)) { hidden.push(o); o.visible = false; } });
  return () => { for (const o of hidden) o.visible = true; };
}

/**
 * Flat photo overlay for the dissolve: same geometry/texture as `ground`, drawn last with no depth test, so at opacity 1
 * the frame is purely the photograph; fading it reveals the 3D scene in exact register underneath.
 */
export function aerialPhotoOverlay(THREE, ground) {
  const src = ground.material;
  const mat = new THREE.MeshBasicMaterial({ map: src.map, transparent: true, opacity: 1, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
  const m = new THREE.Mesh(ground.geometry, mat);
  m.name = (ground.name || 'aerial') + '_photo_overlay';
  m.renderOrder = 1e6; m.frustumCulled = false; m.raycast = () => {};
  m.userData = { assetType: 'aerialPhotoOverlay', pickable: false };
  return m;
}

/**
 * aerialDissolve(THREE, opts) -> { duration, phases, update(t), pose(t), dispose() }
 * Viewer-agnostic intro. It only mutates `camera` (position/quaternion/fov/far), the overlay's opacity and fog distances;
 * the caller owns the render loop and calls update(t) (seconds since intro start, any order — frames are deterministic,
 * so a recorder can seek). Phases (defaults ≈ 7 s, like the reference 00:00–00:07):
 *   hold     (1.2 s) flat aerial photo, near-orthographic camera (narrow fov) straight down, north up
 *   zoom     (2.2 s) push in on the photo from startSpan to photoSpan metres across the frame
 *   dissolve (1.8 s) photo cross-fades into the registered 3D scene (same camera -> lines stay put)
 *   settle   (1.8 s) dolly-zoom to overheadFov keeping the ground footprint (3D "pops"), or ease to endPose if given
 * opts: scene, camera (PerspectiveCamera), ground (aerialGround mesh; required), parent (default scene),
 *   focus [x,z] (default image centre), headingDeg (screen-up compass bearing, default 0 = north up),
 *   startSpan (m, default min(image width, 2.2*photoSpan)), photoSpan (m, default 160), photoFov (deg, 8),
 *   overheadFov (deg, default camera.fov), endPose {position:[x,y,z], target:[x,y,z], up?:[x,y,z], fov?},
 *   timing {hold, zoom, dissolve, settle}, worldRoot + underlay:true -> hide the world ground and keep the photo under the
 *   road after the dissolve (the aerial ground mesh must already be in the scene).
 */
export function aerialDissolve(THREE, opts = {}) {
  const { scene, camera, ground } = opts;
  if (!camera || !ground) throw new Error('aerialDissolve: camera and ground (aerialGround mesh) are required');
  const parent = opts.parent || scene;
  const T = { hold: 1.2, zoom: 2.2, dissolve: 1.8, settle: 1.8, ...(opts.timing || {}) };
  const t1 = T.hold, t2 = t1 + T.zoom, t3 = t2 + T.dissolve, t4 = t3 + T.settle;
  const bb = ground.geometry.boundingBox || (ground.geometry.computeBoundingBox(), ground.geometry.boundingBox);
  const focus = opts.focus || [(bb.min.x + bb.max.x) / 2, (bb.min.z + bb.max.z) / 2];
  const groundY = opts.groundY ?? 0;
  const photoSpan = opts.photoSpan ?? 160;
  const startSpan = opts.startSpan ?? Math.min(bb.max.x - bb.min.x, photoSpan * 2.2);
  const photoFov = opts.photoFov ?? 8;
  const overheadFov = opts.overheadFov ?? camera.fov ?? 50;
  const hd = (opts.headingDeg ?? 0) * DEG;
  const upTop = new THREE.Vector3(Math.sin(hd), 0, -Math.cos(hd));   // screen-up direction on the ground
  const base = { fov: camera.fov, far: camera.far, up: camera.up.clone(), fog: scene?.fog ? { near: scene.fog.near, far: scene.fog.far, density: scene.fog.density } : null };

  const overlay = aerialPhotoOverlay(THREE, ground);
  parent.add(overlay);
  let restoreGround = null;
  if (opts.underlay && opts.worldRoot) restoreGround = hideWorldGround(opts.worldRoot);
  const groundWasVisible = ground.visible;

  // camera height so that `span` metres fill the frame width (or height, whichever is tighter for the aspect)
  const heightFor = (span, fovDeg) => {
    const aspect = camera.aspect || 16 / 9;
    const halfV = (span / Math.max(aspect, 1e-3)) / 2;
    return halfV / Math.tan(fovDeg * DEG / 2);
  };
  const tmpM = new THREE.Matrix4(), qA = new THREE.Quaternion(), qB = new THREE.Quaternion();
  const look = (pos, target, up) => { tmpM.lookAt(pos, target, up); return new THREE.Quaternion().setFromRotationMatrix(tmpM); };
  const downPose = (span, fov) => {
    const p = new THREE.Vector3(focus[0], groundY + heightFor(span, fov), focus[1]);
    return { position: p, quaternion: look(p, new THREE.Vector3(focus[0], groundY, focus[1]), upTop), fov };
  };
  const end = opts.endPose ? (() => {
    const p = new THREE.Vector3(...opts.endPose.position), t = new THREE.Vector3(...opts.endPose.target);
    return { position: p, quaternion: look(p, t, new THREE.Vector3(...(opts.endPose.up || [0, 1, 0]))), fov: opts.endPose.fov ?? overheadFov };
  })() : null;

  function pose(t) {
    if (t <= t1) return { ...downPose(startSpan, photoFov), photo: 1, phase: 'hold' };
    if (t <= t2) {
      const u = smooth((t - t1) / T.zoom);
      const span = Math.exp(Math.log(startSpan) + (Math.log(photoSpan) - Math.log(startSpan)) * u);  // constant-rate zoom
      return { ...downPose(span, photoFov), photo: 1, phase: 'zoom' };
    }
    if (t <= t3) return { ...downPose(photoSpan, photoFov), photo: 1 - smooth((t - t2) / T.dissolve), phase: 'dissolve' };
    const u = smooth((t - t3) / Math.max(T.settle, 1e-6));
    if (!end) {   // dolly-zoom: footprint fixed, perspective grows -> verticals stand up out of the photo
      const fov = photoFov + (overheadFov - photoFov) * u;
      return { ...downPose(photoSpan, fov), photo: 0, phase: t >= t4 ? 'done' : 'settle' };
    }
    const a = downPose(photoSpan, photoFov);
    const p = a.position.clone().lerp(end.position, u);
    qA.copy(a.quaternion); qB.copy(end.quaternion);
    return { position: p, quaternion: qA.clone().slerp(qB, u), fov: photoFov + (end.fov - photoFov) * u, photo: 0, phase: t >= t4 ? 'done' : 'settle' };
  }

  function update(t) {
    const s = pose(Math.max(0, t));
    camera.position.copy(s.position); camera.quaternion.copy(s.quaternion);
    camera.up.copy(s.phase === 'done' && end ? new THREE.Vector3(...(opts.endPose.up || [0, 1, 0])) : upTop);
    camera.fov = s.fov;
    const h = Math.max(0, s.position.y - groundY);
    camera.far = Math.max(base.far, h * 3 + 500);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    overlay.material.opacity = s.photo; overlay.visible = s.photo > 0.001;
    if (opts.underlay) ground.visible = true;
    // keep the scene from fogging out while the camera is kilometres up
    if (scene?.fog && base.fog) {
      if (scene.fog.isFog) { scene.fog.near = base.fog.near + h; scene.fog.far = base.fog.far + h; }
      else if (scene.fog.isFogExp2 && base.fog.density) scene.fog.density = base.fog.density * Math.min(1, 150 / Math.max(h, 1));
    }
    return { phase: s.phase, photoOpacity: s.photo, done: t >= t4, cameraHeight: h };
  }

  function dispose({ keepCamera = true } = {}) {
    overlay.removeFromParent();
    overlay.material.dispose();
    if (scene?.fog && base.fog) { scene.fog.near = base.fog.near; scene.fog.far = base.fog.far; if (base.fog.density != null) scene.fog.density = base.fog.density; }
    camera.far = base.far;
    if (!keepCamera) { camera.fov = base.fov; camera.up.copy(base.up); }
    camera.updateProjectionMatrix();
    if (!opts.underlay) ground.visible = groundWasVisible;
    if (restoreGround && opts.restoreGround) restoreGround();
  }

  return { duration: t4, phases: { hold: [0, t1], zoom: [t1, t2], dissolve: [t2, t3], settle: [t3, t4] }, update, pose, dispose, overlay, restoreGround };
}
