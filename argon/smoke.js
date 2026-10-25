// argon/smoke.js — live API smoke test. Never prints the key.
// Run on the laptop:  npm run smoke   (reads .env; forces live mode)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ARGON_MODEL, BASELINE_MODEL, ROOT } from './client.js';

process.env.SIGHTLINE_MODE = 'live';
const results = [];
const key = process.env.GEMINI_API_KEY || '';
const redact = (s) => (key ? String(s).split(key).join('<redacted>') : String(s));
async function step(name, fn) {
  const t0 = Date.now();
  try {
    const info = await fn();
    results.push([name, true]);
    console.log(`PASS  ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)${info ? ' — ' + redact(info) : ''}`);
    return true;
  } catch (e) {
    results.push([name, false]);
    console.log(`FAIL  ${name} — ${redact(e.message || e).slice(0, 400)}`);
    return false;
  }
}

let ai;
await step('key present in .env', async () => {
  if (!key) throw new Error('GEMINI_API_KEY empty — copy .env.example to .env and fill it');
  return `length ${key.length}`;
});
await step('SDK client', async () => {
  const { GoogleGenAI } = await import('@google/genai');
  ai = new GoogleGenAI({ apiKey: key, httpOptions: { timeout: 10 * 60 * 1000 } });
});

for (const model of [ARGON_MODEL, BASELINE_MODEL]) {
  await step(`model exists: ${model}`, async () => {
    try {
      const m = await ai.models.get({ model });
      return `${m.name} (${m.displayName || ''}) in=${m.inputTokenLimit ?? '?'} out=${m.outputTokenLimit ?? '?'}`;
    } catch (e) {
      // Fallback: list and search.
      const names = [];
      const pager = await ai.models.list();
      for await (const m of pager) names.push(m.name);
      const hit = names.find((n) => n.endsWith('/' + model) || n === model);
      if (hit) return `${hit} (found via list)`;
      throw new Error(`${e.message}. Models containing "argon"/"gemini-4": ${names.filter((n) => /argon|gemini-4/.test(n)).join(', ') || 'none'}`);
    }
  });
}

await step(`tiny generateContent (${ARGON_MODEL})`, async () => {
  const r = await ai.models.generateContent({ model: ARGON_MODEL, contents: 'Reply with exactly: SIGHTLINE OK', config: { maxOutputTokens: 256 } });
  const t = (r.text || '').trim();
  if (!/SIGHTLINE OK/i.test(t)) throw new Error(`unexpected reply: ${t.slice(0, 80)}`);
  return t;
});

await step(`tiny JSON generateContent (${BASELINE_MODEL})`, async () => {
  const r = await ai.models.generateContent({ model: BASELINE_MODEL, contents: 'Return {"ok": true} as JSON.',
    config: { maxOutputTokens: 256, responseMimeType: 'application/json' } });
  const j = JSON.parse(r.text);
  if (j.ok !== true) throw new Error(r.text);
  return r.text.trim();
});

let videoPath = null;
await step('make 5-second test video (ffmpeg)', async () => {
  videoPath = path.join(os.tmpdir(), `sightline_smoke_${Date.now()}.mp4`);
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=5',
    '-vf', "drawbox=x=100:y=60:w=120:h=120:color=blue@1:t=fill", '-r', '10', '-pix_fmt', 'yuv420p', videoPath]);
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + String(r.stderr).slice(0, 200));
  return `${(fs.statSync(videoPath).size / 1024).toFixed(0)} KB (red background, blue square)`;
});

let uploaded = null;
await step('upload video + wait ACTIVE', async () => {
  if (!videoPath) throw new Error('no test video');
  let f = await ai.files.upload({ file: videoPath, config: { mimeType: 'video/mp4' } });
  const t0 = Date.now();
  while (f.state === 'PROCESSING') {
    if (Date.now() - t0 > 5 * 60 * 1000) throw new Error('still PROCESSING after 5 min');
    await new Promise((r) => setTimeout(r, 2000));
    f = await ai.files.get({ name: f.name });
  }
  if (f.state !== 'ACTIVE') throw new Error(`state ${f.state}`);
  uploaded = f;
  return `${f.name} ${f.state}`;
});

await step(`video understanding (${ARGON_MODEL})`, async () => {
  if (!uploaded) throw new Error('no uploaded file');
  const r = await ai.models.generateContent({ model: ARGON_MODEL, contents: [{ role: 'user', parts: [
    { fileData: { fileUri: uploaded.uri, mimeType: uploaded.mimeType || 'video/mp4' } },
    { text: 'In one short sentence: what colors and shapes does this video show?' }] }], config: { maxOutputTokens: 512 } });
  const t = (r.text || '').trim();
  if (!/red/i.test(t) || !/blue/i.test(t)) throw new Error(`answer did not mention red and blue: ${t.slice(0, 160)}`);
  return t.slice(0, 160);
});

if (uploaded) { try { await ai.files.delete({ name: uploaded.name }); } catch {} }
if (videoPath) { try { fs.unlinkSync(videoPath); } catch {} }

const depo = path.join(ROOT, 'deposition', 'out', 'deposition.mp4');
console.log(`\ninfo: deposition video ${fs.existsSync(depo) ? 'present' : 'MISSING (run npm run deposition)'}`);
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed ? `\nSMOKE: ${failed} step(s) FAILED` : '\nSMOKE: ALL PASS');
process.exit(failed ? 1 : 0);
