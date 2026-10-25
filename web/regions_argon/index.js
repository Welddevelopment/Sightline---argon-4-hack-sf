// web/regions_argon/index.js — assemble the Argon-authored site regions (step D, argon/region_forge.mjs).
//
//   import { buildSite } from './regions_argon/index.js';
//   const site = buildSite(THREE, assets);            // THREE.Group 'site_argon' with one child group per region
//   const site = buildSite(THREE, assets, { flat: true, only: ['r1_crossover'] });
//
// Each region module was written by gemini-4-argon (one call per region, run in parallel) as
// `export default function region(THREE, assets, ctx)` and is static geometry only. If a region throws at build
// time it is skipped and recorded in site.userData.errors (the rest of the site still builds).
// site.userData.groundY(x, z) / roadY(x) expose the terrain the regions were draped on, so a dynamic world can sit
// its vehicles on the crest profile (or pass {flat:true} to keep everything at y=0).
import { makeCtx, LAYOUT, profileY } from './site_ctx.js';
import r1 from './r1_crossover.js';
import r2 from './r2_west.js';
import r3 from './r3_east.js';
import r4 from './r4_north.js';
import r5 from './r5_south.js';
import r6 from './r6_terrain.js';

export const REGIONS = { r1_crossover: r1, r2_west: r2, r3_east: r3, r4_north: r4, r5_south: r5, r6_terrain: r6 };
export { LAYOUT, profileY, makeCtx };

export function buildSite(THREE, assets, opts = {}) {
  const ctx = makeCtx({ flat: !!opts.flat, headless: opts.headless });
  const site = new THREE.Group();
  site.name = 'site_argon';
  site.userData = { assetType: 'site', citation: 'Argon-authored site regions (argon/region_forge.mjs); facts NTSB/HAR-17/02', errors: [],
    groundY: ctx.groundY, roadY: ctx.roadY, layout: LAYOUT, regions: [] };
  for (const [id, fn] of Object.entries(REGIONS)) {
    if (opts.only && !opts.only.includes(id)) continue;
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    try {
      const g = fn(THREE, assets, ctx);
      if (!g || !g.isObject3D) throw new Error('region did not return an Object3D');
      g.name = g.name || id;
      g.userData.regionId = id;
      site.add(g);
      site.userData.regions.push({ id, ms: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) });
    } catch (e) {
      site.userData.errors.push({ id, error: String(e && e.stack || e).slice(0, 600) });
    }
  }
  return site;
}

export default buildSite;
