// Render the 5 comparison views of a world through the real viewer (web/viewer.js) at 1280x720, t=9.9.
// Usage: scripts/render_lock.sh node renders/long_world/render_compare.mjs <worldPath> <outDir>
// Views: overhead, oblique (injected elevated pseudo-witness), chase_veh_A, wit_B, wit_A.
import fs from 'node:fs';
import path from 'node:path';
import { renderViews } from '../../render/record.js';

const [world, outDir] = process.argv.slice(2);
const oblique = { id: 'oblique', name: 'Oblique (render only)', position: [55, 0, 58], eyeHeight: 32, lookAt: [-6, 0, -12] };
fs.mkdirSync(outDir, { recursive: true });
const r = await renderViews({ world, views: 'overhead,oblique,chase_veh_A,wit_B,wit_A', outDir, width: 1280, height: 720,
  t: 9.9, stillOnly: true, extraWitnesses: [oblique] });
for (const f of r.stills) {
  const view = path.basename(f).replace(/_t9p9.*$/, '');
  fs.renameSync(f, path.join(outDir, `${view}.png`));
}
console.log(JSON.stringify({ secPerFrame: r.secPerFrame, browser: r.browser }));
