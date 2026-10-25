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

// v2 asset textures are THREE.DataTextures in Node; GLTFExporter encodes images through a 2D canvas. Minimal
// OffscreenCanvas/ImageData shim (putImageData/getImageData/drawImage/fillRect + flipY, PNG via zlib) so the
// procedural textures (decal alpha, lane wear, skid marks ...) travel into the GLB unchanged.
import zlib from 'node:zlib';
if (typeof globalThis.OffscreenCanvas === 'undefined') {
  const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const png = (w, h, px) => {
    const raw = Buffer.alloc((w * 4 + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(px.buffer, px.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
  };
  globalThis.ImageData = class { constructor(d, w, h) { if (typeof d === 'number') { h = w; w = d; d = new Uint8ClampedArray(w * h * 4); } this.data = d; this.width = w; this.height = h; } };
  class Ctx {
    constructor(cv) { this.cv = cv; this.flip = false; this.fillStyle = '#000000'; }
    buf() { const c = this.cv; if (!c._px || c._px.length !== c.width * c.height * 4) c._px = new Uint8ClampedArray(c.width * c.height * 4); return c._px; }
    translate() {} scale(sx, sy) { if (sy < 0) this.flip = !this.flip; }
    fillRect(x0, y0, w, h) {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(this.fillStyle)); const v = m ? parseInt(m[1], 16) : 0; const px = this.buf(), W = this.cv.width;
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * W + x) * 4; px[i] = v >> 16; px[i + 1] = (v >> 8) & 255; px[i + 2] = v & 255; px[i + 3] = 255; }
    }
    getImageData(x, y, w, h) { return new ImageData(new Uint8ClampedArray(this.buf()), w, h); }
    putImageData(img) { this.blit(img.data, img.width, img.height); }
    drawImage(src) { const d = src.data || (src._px) || (src.getContext && src.getContext('2d').buf()); this.blit(d, src.width, src.height); }
    blit(d, sw, sh) {
      const px = this.buf(), W = this.cv.width, H = this.cv.height;
      for (let y = 0; y < H; y++) { const sy = Math.min(sh - 1, Math.floor((this.flip ? H - 1 - y : y) * sh / H));
        for (let x = 0; x < W; x++) { const sx = Math.min(sw - 1, Math.floor(x * sw / W)), i = (y * W + x) * 4, j = (sy * sw + sx) * 4; px[i] = d[j]; px[i + 1] = d[j + 1]; px[i + 2] = d[j + 2]; px[i + 3] = d[j + 3]; } }
    }
  }
  globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return (this._ctx ||= new Ctx(this)); }
    async convertToBlob() { const c = this.getContext(); return new Blob([png(this.width, this.height, c.buf())], { type: 'image/png' }); } };
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
  // Hero cameras (Blender stills): derived from the posed world only.
  const vehs = Object.entries(world.objects).filter(([, o]) => o.kind === 'vehicle' && o.node.visible !== false);
  const truck = vehs.filter(([id]) => /_T_|tractor|trailer|truck/i.test(id));
  if (truck.length) {
    const tb = new THREE.Box3(); truck.forEach(([, o]) => tb.expandByObject(o.node));
    const tc = tb.getCenter(new THREE.Vector3()); tc.y = 1.2;
    addCam('hero_oblique', tc.clone().add(new THREE.Vector3(-30, 13, 30)), tc, 'Hero oblique (SW, over the turning truck)');
  }
  const car = vehs.find(([id]) => !/_T_|tractor|trailer|truck/i.test(id));
  if (car) {
    const n = car[1].node, p = n.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(n.getWorldQuaternion(new THREE.Quaternion())); fwd.y = 0; fwd.normalize();
    const side = new THREE.Vector3(-fwd.z, 0, fwd.x); // right of travel
    addCam('chase', p.clone().addScaledVector(fwd, -8.5).addScaledVector(side, -1.2).setY(1.05), p.clone().addScaledVector(fwd, 30).setY(1.4), `Chase (behind ${car[0]}, low)`);
  }

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
