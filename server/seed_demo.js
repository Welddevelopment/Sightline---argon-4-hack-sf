// Seeds cases/demo from the CASE + VIDEO slices' outputs. Idempotent; safe to re-run as more files land.
//   node server/seed_demo.js
// case/*.md (+ deposition_script.json) -> cases/demo/text ; deposition/out/deposition.mp4, case/exhibits/map.png -> evidence.
// Also copies pre-run Argon outputs (cache/*.json, state) into cases/demo/cache when the demo has none (non-destructive).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCaseStore, ingestFile, fileType } from './cases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const store = createCaseStore(ROOT);
const id = 'demo';

export async function seedDemo({ quiet = false } = {}) {
  const log = (...a) => { if (!quiet) console.log('[seed_demo]', ...a); };
  store.ensure(id);
  const caseJson = store.readJson(path.join(ROOT, 'case', 'case.json'), {}) || {};
  const m = store.manifest(id) || { caseId: id, title: caseJson.title || 'Demo case (pre-run)', createdAt: new Date().toISOString(), files: [], status: 'ready' };
  if (caseJson.title) m.title = caseJson.title;
  const have = new Set(m.files.map((f) => f.name));

  const sources = [];
  const caseDir = path.join(ROOT, 'case');
  if (fs.existsSync(caseDir)) {
    for (const f of fs.readdirSync(caseDir).sort()) {
      const full = path.join(caseDir, f);
      if (fs.statSync(full).isFile() && /\.(md|txt)$/i.test(f)) sources.push([full, f]);
    }
  }
  const depoScript = path.join(caseDir, 'deposition_script.json');
  if (fs.existsSync(depoScript)) sources.push([depoScript, 'deposition_script.json']);
  const depo = path.join(ROOT, 'deposition', 'out', 'deposition.mp4');
  if (fs.existsSync(depo)) sources.push([depo, 'deposition.mp4']);
  const srt = path.join(ROOT, 'deposition', 'out', 'deposition.srt');
  if (fs.existsSync(srt)) sources.push([srt, 'deposition.srt']);
  const map = path.join(caseDir, 'exhibits', 'map.png');
  if (fs.existsSync(map)) sources.push([map, 'map.png']);

  let added = 0, refreshed = 0;
  for (const [src, name] of sources) {
    if (!fileType(name)) continue;
    const dest = store.dir(id, 'evidence', name);
    const changed = !fs.existsSync(dest) || fs.statSync(dest).size !== fs.statSync(src).size || fs.statSync(src).mtimeMs > fs.statSync(dest).mtimeMs + 1;
    if (changed) fs.copyFileSync(src, dest);
    if (!have.has(name) || changed) {
      const entry = await ingestFile(store, id, name);
      const i = m.files.findIndex((f) => f.name === name);
      if (i >= 0) { m.files[i] = entry; refreshed++; } else { m.files.push(entry); added++; }
    }
  }

  // Pre-run Argon outputs so mock mode can replay the demo (never overwrite per-case outputs; state.json is left to the legacy fallback in the API).
  let cached = 0;
  const cacheSrc = path.join(ROOT, 'cache');
  if (fs.existsSync(cacheSrc)) {
    for (const f of fs.readdirSync(cacheSrc)) {
      const dest = store.dir(id, 'cache', f);
      if (f !== 'state.json' && !fs.existsSync(dest) && fs.statSync(path.join(cacheSrc, f)).isFile()) { fs.copyFileSync(path.join(cacheSrc, f), dest); cached++; }
    }
  }

  m.status = m.status === 'running' ? 'ready' : (m.status || 'ready');
  store.saveManifest(m);
  log(`cases/demo: ${m.files.length} file(s) (+${added} new, ${refreshed} refreshed), ${cached} cache file(s) copied`);
  if (!sources.length) log('no sources found yet (case/*.md, deposition/out/deposition.mp4, case/exhibits/map.png) — re-run when they exist');
  return m;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seedDemo().catch((e) => { console.error(e); process.exit(1); });
}
