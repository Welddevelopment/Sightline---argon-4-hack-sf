#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { runAll } from './checks.js';

const p = process.argv[2];
if (!p) { console.error('usage: node checks/run_checks.mjs <worldPath>'); process.exit(2); }
const mod = await import(pathToFileURL(path.resolve(p)).href);
const world = mod.default(THREE, await (await import('./load_world.js')).nodeAssets());   // v2 worlds need assets
console.log(JSON.stringify(runAll(world), null, 2));
