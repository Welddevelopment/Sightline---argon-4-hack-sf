// argon/test_live_stub.js — exercises the LIVE code path (uploads, streaming, cache writes, patch apply)
// against a fake SDK client that replays cases/demo/cache. No network. Run: node argon/test_live_stub.js
import fs from 'node:fs';
import path from 'node:path';
process.env.SIGHTLINE_MODE = 'live';
process.env.GEMINI_API_KEY = 'stub-key';
process.env.SIGHTLINE_SKIP_RENDER = process.env.SIGHTLINE_SKIP_RENDER ?? '1';
process.env.SIGHTLINE_NO_LEGACY_MIRROR = '1';
const { _setAI, ROOT } = await import('./client.js');
const src = path.join(ROOT, 'cases', 'demo', 'cache');
const caseId = 'stubtest';
const cdir = path.join(ROOT, 'cases', caseId);
fs.rmSync(cdir, { recursive: true, force: true });
fs.mkdirSync(path.join(cdir, 'evidence'), { recursive: true });
fs.mkdirSync(path.join(cdir, 'text'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'cases', 'demo', 'evidence', 'deposition.mp4'), path.join(cdir, 'evidence', 'deposition.mp4'));
fs.copyFileSync(path.join(ROOT, 'cases', 'demo', 'text', 'deposition.txt'), path.join(cdir, 'text', 'deposition.txt'));
const FJ = path.join(ROOT, 'cache', 'files.json');
const fjBefore = fs.existsSync(FJ) ? fs.readFileSync(FJ, 'utf8') : null;
const calls = [];
let polls = 0;
_setAI({
  files: {
    upload: async ({ file, config }) => { calls.push(['upload', path.basename(file), config.mimeType]); return { name: 'files/x1', state: 'PROCESSING', uri: 'https://stub/files/x1', mimeType: config.mimeType }; },
    get: async ({ name }) => ({ name, state: ++polls > 1 ? 'ACTIVE' : 'PROCESSING', uri: 'https://stub/' + name, mimeType: 'video/mp4' }),
  },
  models: {
    generateContentStream: async ({ model, contents, config }) => {
      const prompt = contents[0].parts.map((p) => p.text || '').join('\n');
      const nVid = contents[0].parts.filter((p) => p.fileData).length;
      let out;
      if (/forensic collision-reconstruction engineer/.test(prompt)) out = 'Here is the module:\n```js\n' + fs.readFileSync(path.join(src, 'generate_world.js'), 'utf8') + '```\n';
      else if (/independent reviewer/.test(prompt)) { const r = /"round": (\d+)/.exec(prompt)[1]; out = fs.readFileSync(path.join(src, `critique_round${r}.json`), 'utf8'); }
      else out = '{}';
      calls.push(['generate', model, `videos=${nVid}`, `json=${config.responseMimeType || '-'}`, `max=${config.maxOutputTokens}`, `timeout=${config.httpOptions?.timeout}`]);
      return (async function* () { for (let i = 0; i < out.length; i += 4000) yield { text: out.slice(i, i + 4000), candidates: [{ finishReason: i + 4000 >= out.length ? 'STOP' : null }] }; })();
    },
  },
});
const { runLoop } = await import('./loop.js');
const s = await runLoop({ caseId });
console.log(calls.map((c) => c.join(' ')).join('\n'));
const files = fs.readdirSync(path.join(cdir, 'cache'));
const ok = s.world.endsWith('world_v2.js') && s.checks.some((c) => c.subject === 'wit_B' && !c.pass) && files.includes('generate_world.meta.json') && fs.existsSync(path.join(ROOT, 'cache', 'files.json'));
console.log('cache files:', files.join(', '));
console.log(ok ? 'LIVE-STUB: PASS' : 'LIVE-STUB: FAIL');
fs.rmSync(cdir, { recursive: true, force: true });
if (fjBefore === null) fs.rmSync(FJ, { force: true }); else fs.writeFileSync(FJ, fjBefore);
process.exit(ok ? 0 : 1);
