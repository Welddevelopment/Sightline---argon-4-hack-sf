// argon/client.js — thin wrapper around @google/genai with mock/live modes.
//
//   SIGHTLINE_MODE=mock (default): callArgon returns cache/<name>.json|.js, uploadVideo returns a fake URI.
//   SIGHTLINE_MODE=live          : calls the Gemini API, writes cache/<name>.<ext> + cache/<name>.meta.json.
//   SIGHTLINE_REUSE=1 (live)     : if cache/<name>.meta.json has the same input hash, reuse instead of calling.
//
// The API key is read from GEMINI_API_KEY (.env) and is never printed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

export const CACHE_DIR = path.join(ROOT, 'cache');
export const PROMPTS_DIR = path.join(ROOT, 'argon', 'prompts');
export const ARGON_MODEL = process.env.ARGON_MODEL || 'gemini-4-argon';
export const BASELINE_MODEL = process.env.BASELINE_MODEL || 'gemini-3.8-flash';
export const TIMEOUT_MS = Number(process.env.ARGON_TIMEOUT_MS || 20 * 60 * 1000); // 20 min

export function mode() {
  return (process.env.SIGHTLINE_MODE || 'mock').toLowerCase() === 'live' ? 'live' : 'mock';
}
export const isLive = () => mode() === 'live';

fs.mkdirSync(CACHE_DIR, { recursive: true });

let _ai = null;
/** Test hook: inject a fake GoogleGenAI-shaped client (used by argon/test_live_stub.js). */
export function _setAI(x) { _ai = x; }
export async function getAI() {
  if (_ai) return _ai;
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set (put it in .env). Live mode needs it.');
  const { GoogleGenAI } = await import('@google/genai');
  _ai = new GoogleGenAI({ apiKey: key, httpOptions: { timeout: TIMEOUT_MS } });
  return _ai;
}

// ---------- small helpers ----------
export function readPrompt(name) {
  return fs.readFileSync(path.join(PROMPTS_DIR, name.endsWith('.md') ? name : `${name}.md`), 'utf8');
}
export function readIfExists(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}
export function writeJSON(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}
export function readJSON(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

const MIME = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.m4v': 'video/mp4', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska', '.mpeg': 'video/mpeg', '.mpg': 'video/mpeg', '.3gp': 'video/3gpp', '.pdf': 'application/pdf', '.md': 'text/plain', '.txt': 'text/plain', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.rtf': 'application/rtf' };
export const mimeFor = (p) => MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';

export const textPart = (text) => ({ text });
export function imagePart(p) {
  // Inline small images (PNG renders, map exhibit).
  if (!isLive()) return { inlineData: { mimeType: mimeFor(p), data: '<mock>' }, _path: p };
  return { inlineData: { mimeType: mimeFor(p), data: fs.readFileSync(p).toString('base64') } };
}
export function filePart(f) {
  return { fileData: { fileUri: f.uri, mimeType: f.mimeType } };
}

/** Strip a fenced code block out of a model response. Prefers ```js / ```javascript; falls back to whole text. */
export function extractCode(text) {
  const re = /```(?:js|javascript|mjs)?\s*\n([\s\S]*?)```/gi;
  let best = null, m;
  while ((m = re.exec(text))) if (!best || m[1].length > best.length) best = m[1];
  if (best) return best.trim() + '\n';
  if (/export\s+default\s+function/.test(text)) return text.trim() + '\n';
  throw new Error('No ```js block found in model output');
}

/** Parse JSON from a model response (tolerates ```json fences and leading prose). */
export function extractJSON(text) {
  if (typeof text !== 'string') return text;
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*\n([\s\S]*?)```/i);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
  throw new Error('Could not parse JSON from model output');
}

function hashParts(model, parts, extra) {
  const h = crypto.createHash('sha256');
  h.update(model + '\n' + JSON.stringify(extra || {}));
  for (const p of parts) {
    if (p.text) h.update('T' + p.text);
    else if (p.inlineData) h.update('I' + crypto.createHash('sha256').update(p.inlineData.data).digest('hex'));
    else if (p.fileData) h.update('F' + p.fileData.fileUri);
  }
  return h.digest('hex').slice(0, 16);
}

/**
 * callArgon({ name, model, parts, json, maxOutputTokens, ext, temperature, cacheDir })
 *  - cacheDir: where mock reads / live writes (per case: cases/<caseId>/cache)
 *  - name: cache key, e.g. "generate_world", "critique_round1"
 *  - json: true → ask for application/json and return the parsed object
 *  - ext:  cache extension for non-JSON output ("js" for world modules, "md" default for text)
 * Returns { name, text, data, cachePath, model, mode }.
 *  For ext "js" the returned text is the extracted module source.
 */
export async function callArgon({ name, model = ARGON_MODEL, parts, json = false, maxOutputTokens = 32768,
  ext, temperature, system, cacheDir = CACHE_DIR } = {}) {
  fs.mkdirSync(cacheDir, { recursive: true });
  if (!name) throw new Error('callArgon needs a name');
  const outExt = json ? 'json' : (ext || 'md');

  if (!isLive()) {
    const candidates = json ? ['json'] : [outExt, 'json', 'js', 'md'];
    for (const e of candidates) {
      const p = path.join(cacheDir, `${name}.${e}`);
      if (fs.existsSync(p)) {
        const text = fs.readFileSync(p, 'utf8');
        return { name, text, data: e === 'json' ? JSON.parse(text) : null, cachePath: p, model, mode: 'mock' };
      }
    }
    throw new Error(`[mock] no cache file for "${name}" in ${path.relative(ROOT, cacheDir)} (expected ${name}.${outExt})`);
  }

  // ---------- live ----------
  const config = { maxOutputTokens };
  if (temperature !== undefined) config.temperature = temperature;
  if (json) config.responseMimeType = 'application/json';
  if (system) config.systemInstruction = system;
  if (process.env.ARGON_THINKING_LEVEL) config.thinkingConfig = { thinkingLevel: process.env.ARGON_THINKING_LEVEL };
  // Thinking tokens share the 32,768 output cap; live1 spent 24.7k thinking and truncated the module.
  // Default: reserve most of the budget for the answer.
  else if (maxOutputTokens >= 16384) config.thinkingConfig = { thinkingBudget: Number(process.env.ARGON_THINKING_BUDGET || 8192) };
  config.httpOptions = { timeout: TIMEOUT_MS };

  const cleanParts = parts.map(({ _path, ...p }) => p);
  const hash = hashParts(model, cleanParts, { maxOutputTokens, json, system: system ? 1 : 0 });
  const outPath = path.join(cacheDir, `${name}.${outExt}`);
  const metaPath = path.join(cacheDir, `${name}.meta.json`);
  if (process.env.SIGHTLINE_REUSE === '1') {
    const meta = readJSON(metaPath);
    if (meta?.hash === hash && fs.existsSync(outPath)) {
      const text = fs.readFileSync(outPath, 'utf8');
      console.log(`[argon] ${name}: reusing cache (hash ${hash})`);
      return { name, text, data: json ? JSON.parse(text) : null, cachePath: outPath, model, mode: 'live-cached' };
    }
  }

  const ai = await getAI();
  const t0 = Date.now();
  console.log(`[argon] ${name}: calling ${model} (${cleanParts.length} parts, maxOutputTokens=${maxOutputTokens})`);
  // Stream so long world generations don't sit on an idle socket.
  const stream = await ai.models.generateContentStream({
    model, contents: [{ role: 'user', parts: cleanParts }], config,
  });
  let raw = '', finishReason = null, usage = null, n = 0;
  for await (const chunk of stream) {
    raw += chunk.text || '';
    finishReason = chunk.candidates?.[0]?.finishReason || finishReason;
    usage = chunk.usageMetadata || usage;
    if (++n % 20 === 0) process.stdout.write('.');
  }
  if (n >= 20) process.stdout.write('\n');
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[argon] ${name}: done in ${secs}s, finish=${finishReason}, chars=${raw.length}`);
  if (finishReason === 'MAX_TOKENS') console.warn(`[argon] ${name}: WARNING hit maxOutputTokens; output may be truncated`);
  if (!raw.trim()) throw new Error(`[argon] ${name}: empty response (finish=${finishReason})`);

  fs.writeFileSync(path.join(cacheDir, `${name}.raw.txt`), raw);
  let text = raw, data = null;
  if (json) { data = extractJSON(raw); text = JSON.stringify(data, null, 2); }
  else if (outExt === 'js') text = extractCode(raw);
  fs.writeFileSync(outPath, text);
  writeJSON(metaPath, { name, model, hash, finishReason, usage, seconds: Number(secs), at: new Date().toISOString() });
  return { name, text, data, cachePath: outPath, model, mode: 'live' };
}

// ---------- Files API ----------
const FILES_JSON = path.join(CACHE_DIR, 'files.json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Upload a video (or any file) once; cache {uri,name,mimeType} keyed by path+size+mtime in cache/files.json. */
export async function uploadVideo(filePath, { mimeType } = {}) {
  const abs = path.resolve(ROOT, filePath);
  const rel = path.relative(ROOT, abs);
  mimeType = mimeType || mimeFor(abs);
  if (!isLive()) return { uri: `mock://files/${rel}`, name: `files/mock-${path.basename(abs)}`, mimeType, mock: true };

  if (!fs.existsSync(abs)) throw new Error(`uploadVideo: file not found: ${rel}`);
  const st = fs.statSync(abs);
  const key = `${rel}|${st.size}|${Math.round(st.mtimeMs)}`;
  const db = readJSON(FILES_JSON, {});
  const ai = await getAI();

  const hit = db[key];
  if (hit && (!hit.expiresAt || Date.parse(hit.expiresAt) - Date.now() > 30 * 60 * 1000)) {
    try {
      const f = await ai.files.get({ name: hit.name });
      if (f.state === 'ACTIVE') return { uri: f.uri, name: f.name, mimeType: f.mimeType || mimeType };
    } catch { /* expired or deleted — re-upload */ }
  }

  console.log(`[argon] uploading ${rel} (${(st.size / 1e6).toFixed(1)} MB, ${mimeType})`);
  let f = await ai.files.upload({ file: abs, config: { mimeType, displayName: path.basename(abs) } });
  const deadline = Date.now() + 15 * 60 * 1000;
  while (f.state === 'PROCESSING' || f.state === 'STATE_UNSPECIFIED' || !f.state) {
    if (Date.now() > deadline) throw new Error(`uploadVideo: ${rel} still ${f.state} after 15 min`);
    await sleep(3000);
    f = await ai.files.get({ name: f.name });
  }
  if (f.state !== 'ACTIVE') throw new Error(`uploadVideo: ${rel} ended in state ${f.state} ${JSON.stringify(f.error || '')}`);
  db[key] = { uri: f.uri, name: f.name, mimeType: f.mimeType || mimeType, expiresAt: f.expirationTime || null, uploadedAt: new Date().toISOString() };
  writeJSON(FILES_JSON, db);
  console.log(`[argon] ${rel} ACTIVE as ${f.name}`);
  return { uri: f.uri, name: f.name, mimeType: f.mimeType || mimeType };
}

/** The world contract text: SPEC.md section + worlds/CONTRACT_EXAMPLE.md (read at runtime). */
export function loadWorldContract() {
  const spec = readIfExists(path.join(ROOT, 'SPEC.md')) || '';
  const a = spec.indexOf('## THE WORLD CONTRACT');
  const b = spec.indexOf('## Viewer page contract');
  const contract = a >= 0 ? spec.slice(a, b > a ? b : undefined).trim() : spec;
  const example = readIfExists(path.join(ROOT, 'worlds', 'CONTRACT_EXAMPLE.md')) || '(worlds/CONTRACT_EXAMPLE.md not found)';
  return `${contract}\n\n### Contract example (worlds/CONTRACT_EXAMPLE.md)\n${example.trim()}`;
}

export function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? `{{${k}}}`));
}
