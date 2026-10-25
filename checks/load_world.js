// checks/load_world.js — Node helper: instantiate a world module with the shared asset library (WORLD CONTRACT v2).
//   import { nodeAssets, instantiateWorld, loadWorldModule } from '../checks/load_world.js';
//   const world = await loadWorldModule('cases/demo/worlds/world_v2.js');
// v1 worlds (createWorld(THREE)) simply ignore the second argument.
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let _assets = null;

/** Headless (geometry-only) asset facade from web/assets.js; cached. Returns undefined if the facade is missing. */
export async function nodeAssets({ fresh = false, onCall } = {}) {
  if (_assets && !fresh && !onCall) return _assets;
  const f = path.join(ROOT, 'web', 'assets.js');
  if (!fs.existsSync(f)) return undefined;
  const m = await import(pathToFileURL(f).href);
  const a = await m.loadAssets(THREE, { headless: true, onCall });
  if (!onCall) _assets = a;
  return a;
}

/** Call a module's createWorld(THREE, assets). */
export async function instantiateWorld(mod, opts = {}) {
  const fn = typeof mod === 'function' ? mod : mod?.default;
  if (typeof fn !== 'function') throw new Error('world module has no default export createWorld(THREE, assets)');
  return fn(THREE, opts.assets ?? await nodeAssets());
}

/** Import a world file fresh (cache-busted) and instantiate it. */
export async function loadWorldModule(file, opts = {}) {
  const abs = path.resolve(ROOT, file);
  const mod = await import(pathToFileURL(abs).href + `?t=${fs.statSync(abs).mtimeMs}-${Math.random()}`);
  return instantiateWorld(mod, opts);
}

export { THREE };
