// argon/baseline.js — the "conventional" pipeline: chunk-and-summarize the testimony transcripts (text only, no video)
// with Flash, then ask the same consistency question. Shows what is missed without watching the video.
// CLI: node argon/baseline.js [--case demo]
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { callArgon, BASELINE_MODEL, readPrompt, fill, textPart, writeJSON, mode } from './client.js';
import { caseDirs, loadCaseText, loadTranscripts, defaultCaseId } from './case.js';

function chunk(lines, size) {
  const out = [];
  for (let i = 0; i < lines.length; i += size) out.push(lines.slice(i, i + size).join('\n'));
  return out;
}

export async function runBaseline({ caseId = defaultCaseId(), model = BASELINE_MODEL, chunkLines = Number(process.env.BASELINE_CHUNK_LINES || 40) } = {}) {
  const d = caseDirs(caseId);
  const transcripts = loadTranscripts(caseId);
  let summary = '(no transcripts found)', nChunks = 0;
  if (mode() === 'live' && transcripts.length) {
    const sums = [];
    for (const t of transcripts) {
      const chunks = chunk(t.text.split('\n').filter(Boolean), chunkLines);
      for (let i = 0; i < chunks.length; i++) {
        nChunks++;
        const p = fill(readPrompt('baseline_chunk'), { FILE: t.file, I: String(i + 1), N: String(chunks.length), CHUNK: chunks[i] });
        const r = await callArgon({ name: `baseline_chunk${nChunks}`, model, parts: [textPart(p)], maxOutputTokens: 2048, cacheDir: d.cache });
        sums.push(`## ${t.file} chunk ${i + 1}\n${r.text.trim()}`);
      }
    }
    summary = sums.join('\n\n');
  }
  // Case text minus the transcripts themselves (the baseline only sees transcript summaries).
  const tset = new Set(transcripts.map((t) => t.file));
  const caseText = loadCaseText(caseId).split(/(?==== FILE: )/).filter((blk) => {
    const m = blk.match(/^=== FILE: (.+?) ===/);
    return !m || !tset.has(m[1]);
  }).join('');
  const prompt = fill(readPrompt('baseline'), { CASE_TEXT: caseText, SUMMARY: summary, MODEL: model });
  const res = await callArgon({ name: 'baseline', model, parts: [textPart(prompt)], json: true, maxOutputTokens: 8192, cacheDir: d.cache });
  const data = { ...res.data, model: res.data?.model || model, chunks: res.data?.chunks ?? nChunks, mode: res.mode };
  if (res.mode === 'live') writeJSON(path.join(d.cache, 'baseline.json'), data);
  return data;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const i = process.argv.indexOf('--case');
  try { console.log(JSON.stringify(await runBaseline({ caseId: i > 0 ? process.argv[i + 1] : undefined }), null, 2)); }
  catch (e) { console.error('[baseline] FAILED:', e.message); process.exit(1); }
}
