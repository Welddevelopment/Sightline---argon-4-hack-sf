// Export a Sightline world module at time t to GLB for offline (Blender/Cycles) hero stills.
// The world module is loaded UNCHANGED in Node (same as worlds/test_world.mjs); layout/geometry come only from it.
// CLI: node render/export_gltf.mjs --world cases/demo/worlds/world_v2.js --t 9.9 --out renders/blender/world_v2_t9.9.glb
// Writes <out>.glb plus <out>.json sidecar (meta, cameras, sun direction) read by blender/render_still.py.
// Cameras: one per witness eye (position at eyeHeight, aimed at lookAt bbox center, 60 deg vertical FOV, 16:9, same as web/viewer.js),
// plus 'oblique' (elevated 3/4 view over the impact) and 'overhead'. Sun = the world's DirectionalLight (light_sun) direction.
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// GLTFExporter uses FileReader for binary output; Node has Blob but no FileReader.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class {
    readAsArrayBuffer(b) { b.arrayBuffer().then((buf) => { this.result = buf; this.onloadend && this.onloadend(); this.onload && this.onload({ target: this }); }); }
    readAsDataURL(b) { b.arrayBuffer().then((buf) => { this.result = `data:${b.type || 'application/octet-stream'};base64,` + Buffer.from(buf).toString('base64'); this.onloadend && this.onloadend(); this.onload && this.onload({ target: this }); }); }
  };
}

function args() {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
  return o;
}

const hex = (c) => '#' + c.getHexString();

export async function exportWorld(worldFile, t, outGlb) {
  const mod = await import(pathToFileURL(path.resolve(worldFile)).href);
  // WORLD CONTRACT v2: createWorld(THREE, assets). v1 worlds ignore the second argument.
  let assets;
  try { const A = await import(pathToFileURL(path.join(ROOT, 'web/assets.js')).href); assets = await A.loadAssets(THREE, { headless: true }); }
  catch (e) { console.warn('assets library unavailable (' + (e && e.message) + '); v1 worlds still work'); }
  const world = mod.default(THREE, assets);
  world.setTime(t);
  world.root.updateMatrixWorld(true);

  // Tag materials with "<top-level id>|<mesh name>|<kind>|<hex>|<library material name>" so Blender can upgrade them without touching geometry.
  const topId = (o) => { let n = o, id = null; while (n && n !== world.root) { if (world.objects[n.name]) id = n.name; n = n.parent; } return id || o.name || 'scene'; };
  world.root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const m = Array.isArray(o.material) ? o.material : [o.material];
    o.material = m.map((mm) => {
      const c = mm.clone();
      const kind = (world.objects[topId(o)] || {}).kind || 'scene';
      c.name = `${topId(o)}|${o.name || o.parent?.name || ''}|${kind}|${hex(mm.color || new THREE.Color(1, 1, 1))}|${mm.name || ''}`;
      return c;
    });
    if (o.material.length === 1) o.material = o.material[0];
    if (!o.visible) o.userData.hidden = true;
  });
  // GLTFExporter skips invisible nodes only with onlyVisible:true (default) -> keeps the world's own visibility at t.

  const scene = new THREE.Scene();
  scene.add(world.root);
  const cams = new THREE.Group(); cams.name = 'cameras'; scene.add(cams);
  const box = new THREE.Box3(), v = new THREE.Vector3();
  const center = (id) => { const o = world.objects[id]; if (!o) return new THREE.Vector3(0, 1, 0); box.setFromObject(o.node); return box.getCenter(new THREE.Vector3()); };
  const camList = [];
  const addCam = (id, pos, look, label) => {
    const c = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 3000);
    c.name = 'cam_' + id; c.position.copy(pos); c.up.set(0, 1, 0); c.lookAt(look); c.updateMatrixWorld(true);
    cams.add(c);
    camList.push({ id, node: c.name, label, position: pos.toArray(), lookAt: look.toArray(), fovDeg: 60, aspect: 16 / 9 });
  };
  for (const w of world.witnesses || []) {
    const p = w.position || [0, 0, 0];
    const eye = new THREE.Vector3(p[0], w.eyeHeight != null ? w.eyeHeight : (p[1] || 1.6), p[2]);
    const look = Array.isArray(w.lookAt) ? new THREE.Vector3(...w.lookAt) : center(w.lookAt);
    addCam(w.id, eye, look, w.name);
  }
  // Oblique: 3/4 view from the south-west, elevated, over the impact point (world origin / mark_impact).
  const imp = world.objects.mark_impact ? world.objects.mark_impact.node.getWorldPosition(v).clone() : new THREE.Vector3();
  addCam('oblique', imp.clone().add(new THREE.Vector3(-38, 22, 40)), imp.clone().add(new THREE.Vector3(4, 0, -10)), 'Oblique (SW, elevated)');
  addCam('overhead', imp.clone().add(new THREE.Vector3(0, 120, 0.01)), imp.clone(), 'Overhead');

  // Sun: direction from the world's DirectionalLight (position -> target), as a direction TOWARD the sun.
  let sun = null;
  world.root.traverse((o) => { if (o.isDirectionalLight && (!sun || o.name === 'light_sun')) sun = o; });
  let sunDir = new THREE.Vector3(-0.6, 0.7, 0.3);
  if (sun) sunDir = sun.getWorldPosition(new THREE.Vector3()).sub(sun.target.getWorldPosition(new THREE.Vector3())).normalize();

  // Lights are not exported: Blender supplies a physical sky + sun lamp along sunDir (recorded in the sidecar).
  world.root.traverse((o) => { if (o.isLight) o.visible = false; });
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true });
  fs.mkdirSync(path.dirname(path.resolve(outGlb)), { recursive: true });
  fs.writeFileSync(outGlb, Buffer.from(glb));
  const side = {
    world: path.relative(process.cwd(), path.resolve(worldFile)), t, meta: world.meta, cameras: camList,
    sun: { dirThree: sunDir.toArray(), elevationDeg: Math.asin(sunDir.y) * 180 / Math.PI,
      azimuthDeg: ((Math.atan2(sunDir.x, -sunDir.z) * 180 / Math.PI) + 360) % 360, intensity: sun ? sun.intensity : null },
    frame: 'three.js: +X east, -Z north, Y up (glTF importer maps to Blender X east, +Y north, Z up)',
  };
  fs.writeFileSync(outGlb.replace(/\.glb$/, '') + '.json', JSON.stringify(side, null, 2));
  return side;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = args();
  if (!a.world) { console.error('usage: node render/export_gltf.mjs --world <world.js> --t <sec> --out <file.glb>'); process.exit(2); }
  const t = parseFloat(a.t ?? 0);
  const out = a.out || `renders/blender/${path.basename(a.world, '.js')}_t${t}.glb`;
  const s = await exportWorld(a.world, t, out);
  console.log(`wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB); cameras: ${s.cameras.map((c) => c.id).join(', ')}; sun az ${s.sun.azimuthDeg.toFixed(1)} el ${s.sun.elevationDeg.toFixed(1)}`);
}
