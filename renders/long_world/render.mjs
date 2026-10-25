// Render a self-contained (v1) world from overhead / oblique / witness eye at time t.
// Usage: scripts/render_lock.sh node renders/long_world/render.mjs <worldPath> [t=9.9] [views=overhead,oblique,wit_B] [outDir]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../../render/record.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const world = path.resolve(process.argv[2]);
const t = Number(process.argv[3] ?? 9.9);
const views = (process.argv[4] || 'overhead,oblique,wit_B').split(',');
const outDir = path.resolve(process.argv[5] || path.join(ROOT, 'renders/long_world'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 300)));
await page.goto(`${base}/renders/long_world/render.html?world=/${path.relative(ROOT, world)}`);
const t0 = Date.now();
await page.evaluate(() => window.sl.ready);
console.log('loaded in', Date.now() - t0, 'ms', JSON.stringify(await page.evaluate(() => window.sl.info)));
fs.mkdirSync(outDir, { recursive: true });
for (const v of views) {
  const t1 = Date.now();
  const info = await page.evaluate(([v, t]) => window.sl.shot(v, t), [v, t]);
  const file = path.join(outDir, `${v}_t${t}.png`);
  await page.locator('canvas').screenshot({ path: file });
  console.log(v, file, JSON.stringify(info), Date.now() - t1, 'ms');
}
await browser.close();
srv.close();
