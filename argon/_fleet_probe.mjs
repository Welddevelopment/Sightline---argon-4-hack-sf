import './client.js';
const { GoogleGenAI } = await import('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const t0 = Date.now();
const it = await ai.interactions.create({
  agent: 'antigravity-preview-09-2026',
  input: 'In /workspace/job run exactly: `cd /workspace/job && cat hello.txt && (which ffmpeg chromium chromium-browser google-chrome; true) && npm i --no-audit --no-fund three@0.186.1 2>&1 | tail -2 && node -e "import(\'three\').then(t=>console.log(\'three\',t.REVISION))" && mkdir -p out && echo ok > out/a.txt && ls -la out`. Reply with the raw output only.',
  environment: { type: 'remote', sources: [{ type: 'inline', target: '/workspace/job/hello.txt', content: 'hi from sightline' }] },
}, { timeout: 300000 });
console.log('secs', (Date.now()-t0)/1000, it.status, it.environment_id);
console.log(it.output_text);
const key = process.env.GEMINI_API_KEY;
for (const u of [`https://generativelanguage.googleapis.com/v1beta/environments/${it.environment_id}/files?recursive=true`,
                 `https://generativelanguage.googleapis.com/v1beta/environments/${it.environment_id}/files/workspace/job/out?alt=media`,
                 `https://generativelanguage.googleapis.com/v1beta/environments/${it.environment_id}/files/workspace/job/out/a.txt?alt=media`]) {
  const r = await fetch(u, { headers: { 'x-goog-api-key': key } });
  const b = Buffer.from(await r.arrayBuffer());
  console.log(u.replace(key,''), r.status, r.headers.get('content-type'), b.length, b.slice(0, 600).toString('latin1').replace(/[^\x20-\x7e\n]/g,'.'));
}
