// argon/world_io.js — load/validate/summarize world modules in Node.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './client.js';
import { writeProvenance } from './provenance.js';

let THREE = null;
async function three() { return (THREE ||= await import('three')); }

export const worldFileFromUrl = (u) => path.resolve(ROOT, String(u).replace(/^\/+/, ''));
export const worldUrlFromFile = (f) => '/' + path.relative(ROOT, path.resolve(f)).split(path.sep).join('/');

/** Import a world module file fresh and instantiate it. */
export async function loadWorldFile(file) {
  const abs = path.resolve(ROOT, file);
  const mod = await import(pathToFileURL(abs).href + `?t=${fs.statSync(abs).mtimeMs}-${Math.random()}`);
  if (typeof mod.default !== 'function') throw new Error(`${file}: no default export createWorld(THREE)`);
  return mod.default(await three());
}

/** Contract sanity check. Returns list of problems (empty = OK). */
export function validateWorld(world) {
  const p = [];
  if (!world || typeof world !== 'object') return ['createWorld returned nothing'];
  if (!world.root || !world.root.isObject3D) p.push('root is not a THREE.Object3D');
  if (typeof world.setTime !== 'function') p.push('setTime missing');
  if (!(world.duration > 0)) p.push('duration missing');
  if (!world.objects || typeof world.objects !== 'object') p.push('objects missing');
  for (const [id, o] of Object.entries(world.objects || {})) {
    if (!o.node) p.push(`${id}: no node`);
    if (!o.citation) p.push(`${id}: no citation`);
  }
  for (const w of world.witnesses || []) {
    if (!w.id || !Array.isArray(w.position)) p.push(`witness ${w.id}: bad position`);
    if (!w.citation) p.push(`witness ${w.id}: no citation`);
    if (typeof w.lookAt === 'string' && !world.objects?.[w.lookAt]) p.push(`witness ${w.id}: lookAt ${w.lookAt} not in objects`);
  }
  try { world.setTime(0); world.setTime(world.duration / 2); world.setTime(world.duration); } catch (e) { p.push('setTime threw: ' + e.message); }
  return p;
}

/** Write a module to <worldsDir>/world_v{n}.js (per case: cases/<caseId>/worlds), verify it loads + validates. Returns { file, url, problems }. */
export async function writeWorldVersion(n, source, worldsDir = path.join(ROOT, 'worlds'), prov = null) {
  const file = path.join(worldsDir, `world_v${n}.js`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  // CREDIBILITY v1: world_vN.provenance.json beside the module (prov = argon/provenance.js callProvenance(...)).
  if (prov) try { writeProvenance({ ...prov, worldPath: file }); } catch (e) { console.warn(`[provenance] world_v${n}: ${e.message}`); }
  let problems = [];
  try { problems = validateWorld(await loadWorldFile(file)); } catch (e) { problems = ['module failed to load: ' + e.message]; }
  return { file, url: worldUrlFromFile(file), problems };
}

/** Compact text summary of a world (for new_witness prompts). */
export async function summarizeWorld(world, source) {
  const T = await three();
  world.root?.updateMatrixWorld?.(true);
  const r = (v) => Math.round(v * 10) / 10;
  const objs = Object.entries(world.objects || {}).map(([id, o]) => {
    let c = [0, 0, 0], s = [0, 0, 0];
    try {
      const b = new T.Box3().setFromObject(o.node);
      if (!b.isEmpty()) { const cc = b.getCenter(new T.Vector3()), ss = b.getSize(new T.Vector3()); c = cc.toArray().map(r); s = ss.toArray().map(r); }
    } catch {}
    return `- ${id} | ${o.kind || ''} | ${o.label || ''} | center [${c}] | size [${s}]${o.occludes ? ' | occludes' : ''}`;
  }).join('\n');
  const wits = (world.witnesses || []).map((w) => `- ${w.id}: ${w.name || ''} at [${w.position}] eye ${w.eyeHeight ?? 1.6} m, looks at ${JSON.stringify(w.lookAt)} at t=${w.observationTime}s; claim "${w.claim || ''}" (${w.citation || ''})`).join('\n') || '(none)';
  const facts = (world.facts || []).map((f) => `- ${f.id}: ${f.text}${f.value != null ? ` [${f.value} ${f.unit || ''}]` : ''} (${f.citation || ''})`).join('\n') || '(none)';
  return { objects: objs, witnesses: wits, facts, duration: world.duration,
    header: JSON.stringify(world.meta || {}) + (source ? '\n' + (source.match(/^(\s*\/\/.*\n)+/) || [''])[0].slice(0, 3000) : '') };
}
