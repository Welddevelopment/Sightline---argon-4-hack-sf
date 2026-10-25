// argon/new_witness.js — typed statement → witness entry in the world frame.
// Lib: import { newWitness } from './argon/new_witness.js'; await newWitness(statement, world, caseId)
// CLI: node argon/new_witness.js [--case demo] "I was standing at the northeast corner and saw ..."
//
// Live path (the demo's live beat), fastest first and never hanging:
//   1. gemini-4-argon with a small prompt (world summary + moving-object timeline, no evidence/video),
//      JSON schema output, per-attempt timeout, one retry.            [source: "argon-live"]
//   2. On failure: replay of the last good live answer for the same statement (hash-keyed,
//      cases/<id>/cache/new_witness_replay.json).                     [source: "argon-replay"]
//   3. Deterministic parser for "N m/yards/ft <direction> of <landmark>", "<side> side of the highway",
//      "driving west ... from the crossover".                        [source: "parser"]
//   Mock mode: replay → parser → cached example.
// Env: ARGON_WITNESS_MODEL (default ARGON_MODEL), ARGON_WITNESS_TIMEOUT_MS (18000), ARGON_WITNESS_RETRY_TIMEOUT_MS (12000),
//      ARGON_WITNESS_THINKING (thinkingLevel, e.g. LOW|MINIMAL; unset = model default).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getAI, ARGON_MODEL, readPrompt, fill, isLive, readJSON, writeJSON, extractJSON, mode, ROOT } from './client.js';
import { caseDirs, defaultCaseId } from './case.js';
import { summarizeWorld } from './world_io.js';

const MODEL = process.env.ARGON_WITNESS_MODEL || ARGON_MODEL;
const T1 = Number(process.env.ARGON_WITNESS_TIMEOUT_MS || 18000);
const T2 = Number(process.env.ARGON_WITNESS_RETRY_TIMEOUT_MS || 12000);

const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    position: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
    eyeHeight: { type: 'number' },
    lookAt: { type: 'string', description: 'object id' },
    observationTime: { type: 'number' },
    claim: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    assumptions: { type: 'string' },
  },
  required: ['name', 'position', 'eyeHeight', 'lookAt', 'observationTime', 'claim', 'confidence', 'assumptions'],
};

let THREE = null;
const three = async () => (THREE ||= await import('three'));
const r1 = (v) => Math.round(v * 10) / 10;

function currentWorldSource(d) {
  const st = readJSON(path.join(d.cache, 'state.json'), {});
  const f = st.world ? path.resolve(ROOT, st.world.replace(/^\/+/, '')) : null;
  try { return f ? fs.readFileSync(f, 'utf8') : null; } catch { return null; }
}

// ---------- replay cache (keyed by normalized statement hash) ----------
export const normalizeStatement = (s) => String(s).toLowerCase().replace(/[“”"']/g, '').replace(/\s+/g, ' ').replace(/[\s.!?]+$/, '').trim();
export const statementKey = (s) => crypto.createHash('sha256').update(normalizeStatement(s)).digest('hex').slice(0, 16);
const replayFile = (d) => path.join(d.cache, 'new_witness_replay.json');
function replayGet(d, statement) {
  return readJSON(replayFile(d), {})[statementKey(statement)] || null;
}
function replayPut(d, statement, entry) {
  try {
    const db = readJSON(replayFile(d), {});
    db[statementKey(statement)] = { statement, ...entry, at: new Date().toISOString() };
    writeJSON(replayFile(d), db);
  } catch (e) { console.warn('[new_witness] replay cache write failed:', e.message); }
}

// ---------- world helpers ----------
async function boxes(world) {
  const T = await three();
  world.root?.updateMatrixWorld?.(true);
  const out = {};
  for (const [id, o] of Object.entries(world.objects || {})) {
    try { const b = new T.Box3().setFromObject(o.node); if (!b.isEmpty()) out[id] = b; } catch {}
  }
  return out;
}

/** Ground-center track of every object that moves, sampled ~1 s apart (lets Argon map "when the truck started its turn" to t). */
async function movingTimeline(world) {
  if (typeof world.setTime !== 'function' || !(world.duration > 0)) return '(no timeline)';
  const dur = world.duration, step = dur <= 24 ? 1 : dur / 24;
  const times = []; for (let t = 0; t < dur - 1e-6; t += step) times.push(r1(t)); times.push(dur);
  const tracks = {};
  for (const t of times) {
    world.setTime(t);
    const bx = await boxes(world);
    for (const [id, b] of Object.entries(bx)) {
      const c = b.getCenter(new (await three()).Vector3());
      (tracks[id] ||= []).push([t, r1(c.x), r1(c.z)]);
    }
  }
  try { world.setTime(0); } catch {}
  const lines = [];
  for (const [id, tr] of Object.entries(tracks)) {
    const moved = tr.some(([, x, z]) => Math.hypot(x - tr[0][1], z - tr[0][2]) > 0.5);
    if (!moved) continue;
    // Drop consecutive duplicates (parked phases) to keep the prompt small.
    const kept = tr.filter((p, i) => i === 0 || i === tr.length - 1 || p[1] !== tr[i - 1][1] || p[2] !== tr[i - 1][2]);
    lines.push(`- ${id}: ` + kept.map(([t, x, z]) => `t${t} [${x},${z}]`).join(' '));
  }
  return lines.join('\n') || '(nothing moves)';
}

/** Move a position that landed inside a building / small static occluder to just outside its nearest face. */
async function snapOutOfOccluders(world, w) {
  const bx = await boxes(world);
  const [x, , z] = w.position;
  for (const [id, b] of Object.entries(bx)) {
    const o = world.objects[id];
    if (!o || /^veh|vehicle/.test(id + ' ' + (o.kind || ''))) continue;
    const area = (b.max.x - b.min.x) * (b.max.z - b.min.z);
    if (!(o.kind === 'building' || (o.occludes && area < 2000))) continue;
    if (x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z) {
      const opts = [[b.min.x - 1, z, b.min.x - x], [b.max.x + 1, z, b.max.x - x], [x, b.min.z - 1, b.min.z - z], [x, b.max.z + 1, b.max.z - z]];
      opts.sort((a, c) => Math.abs(a[2]) - Math.abs(c[2]));
      w.position = [r1(opts[0][0]), 0, r1(opts[0][1])];
      w.assumptions = (w.assumptions || '') + ` [position was inside ${id}; moved to its nearest face]`;
      return;
    }
  }
}

function finalize(w, world) {
  if (typeof w.lookAt === 'string' && world?.objects && !world.objects[w.lookAt]) {
    const m = w.lookAt.match(/-?\d+(\.\d+)?/g);
    if (m && m.length === 3) w.lookAt = m.map(Number);
    else {
      const fallback = mostCommonLookAt(world) || Object.keys(world.objects).find((k) => k.startsWith('veh_')) || Object.keys(world.objects)[0];
      w.assumptions = (w.assumptions || '') + ` [lookAt "${w.lookAt}" not in world; using ${fallback}]`;
      w.lookAt = fallback;
    }
  }
  w.position = [Number(w.position[0]), 0, Number(w.position[2])];
  w.eyeHeight = Number(w.eyeHeight) > 0 ? Number(w.eyeHeight) : 1.6;
  const dur = Number(world?.duration) || Infinity;
  w.observationTime = Math.min(Math.max(Number(w.observationTime) || 0, 0), dur);
  w.name = w.name || 'Live witness';
  w.citation = 'Live statement';
  delete w.id; // server assigns wit_live_N
  return w;
}

function validPosition(p) {
  return Array.isArray(p) && p.length >= 3 && [p[0], p[2]].every((v) => Number.isFinite(Number(v)) && Math.abs(Number(v)) < 5000);
}

/** Tolerant parse: JSON, fenced JSON, then line-wise salvage (unescaped quotes inside strings). */
function parseWitnessJSON(text) {
  try { const d = extractJSON(text); return d?.witness || d; } catch {}
  const o = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*"(\w+)"\s*:\s*(.*?)\s*,?\s*$/);
    if (!m) continue;
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"')) o[m[1]] = v.slice(1, -1).replace(/\\?"/g, "'");
    else try { o[m[1]] = JSON.parse(v); } catch {}
  }
  if (!o.position) throw new Error('unparseable model output');
  return o;
}

async function callOnce(prompt, timeoutMs, name, d, { useSchema = true, useThinking = true } = {}) {
  const ai = await getAI();
  const ctrl = new AbortController();
  const config = { responseMimeType: 'application/json', maxOutputTokens: 4096, abortSignal: ctrl.signal, httpOptions: { timeout: timeoutMs } };
  if (useSchema) config.responseJsonSchema = SCHEMA;
  if (useThinking && process.env.ARGON_WITNESS_THINKING) config.thinkingConfig = { thinkingLevel: process.env.ARGON_WITNESS_THINKING };
  let timer;
  const t0 = Date.now();
  try {
    const res = await Promise.race([
      ai.models.generateContent({ model: MODEL, contents: [{ role: 'user', parts: [{ text: prompt }] }], config }),
      new Promise((_, rej) => { timer = setTimeout(() => { ctrl.abort(); rej(new Error(`timeout after ${timeoutMs} ms`)); }, timeoutMs); }),
    ]);
    const raw = res.text || '';
    const secs = (Date.now() - t0) / 1000;
    fs.writeFileSync(path.join(d.cache, `${name}.raw.txt`), raw);
    writeJSON(path.join(d.cache, `${name}.meta.json`), { name, model: MODEL, seconds: secs, finishReason: res.candidates?.[0]?.finishReason, usage: res.usageMetadata, at: new Date().toISOString() });
    if (!raw.trim()) throw new Error(`empty response (finish=${res.candidates?.[0]?.finishReason})`);
    const w = parseWitnessJSON(raw);
    if (!validPosition(w.position)) throw new Error('model returned no valid position');
    return { w, secs };
  } finally { clearTimeout(timer); }
}

// ---------- deterministic fallback parser ----------
const UNIT = { m: 1, meter: 1, meters: 1, metre: 1, metres: 1, yard: 0.9144, yards: 0.9144, yd: 0.9144, yds: 0.9144, ft: 0.3048, feet: 0.3048, foot: 0.3048 };
const DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0], northeast: [0.7071, -0.7071], northwest: [-0.7071, -0.7071], southeast: [0.7071, 0.7071], southwest: [-0.7071, 0.7071] };
const DIR_RE = '(north(?:[- ]?(?:east|west))?|south(?:[- ]?(?:east|west))?|east|west)';
const normDir = (s) => s.replace(/[- ]/g, '');
const STOP = new Set(['the', 'a', 'an', 'of', 'at', 'on', 'in', 'to', 'from', 'by', 'near', 'side', 'i', 'was', 'when', 'and', 'my', 'our', 'that', 'this', 'it', 'its']);
const SYN = { intersection: ['impact', 'poi', 'intersection', 'crossover'], light: ['signal', 'light', 'stop'], signal: ['signal', 'stop', 'light'], station: ['station', 'store', 'retail'], shop: ['store', 'retail'], store: ['store', 'retail', 'shop'], crossover: ['crossover', 'median'], highway: ['road', 'us', 'highway'], pole: ['pole', 'utility'], bench: ['shelter', 'bench'], hill: ['crest', 'hill'] };

function mostCommonLookAt(world) {
  const n = {};
  for (const w of world.witnesses || []) if (typeof w.lookAt === 'string' && world.objects?.[w.lookAt]) n[w.lookAt] = (n[w.lookAt] || 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}
/** Parser's observation time: just before an impact-time fact, else the latest time an existing witness is tested at. */
function defaultTime(world) {
  const f = (world.facts || []).find((x) => /impact|collision|crash/i.test(`${x.id} ${x.text}`) && /^s(ec)?$/i.test(x.unit || '') && x.value > 0 && x.value <= world.duration);
  if (f) return { t: r1(Math.max(0, f.value - 0.5)), why: `0.5 s before impact (${f.id})` };
  const ts = (world.witnesses || []).map((w) => Number(w.observationTime)).filter(Number.isFinite);
  if (ts.length) return { t: Math.max(...ts), why: 'latest time existing witnesses are tested at' };
  return { t: r1((world.duration || 0) / 2), why: 'mid-timeline' };
}

function matchLandmark(phrase, world, bx) {
  const toks = phrase.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !STOP.has(t));
  if (!toks.length) return null;
  const want = new Set(toks.flatMap((t) => [t, t.replace(/s$/, ''), ...(SYN[t] || [])]));
  let best = null, bestScore = 0;
  for (const [id, o] of Object.entries(world.objects || {})) {
    if (/^veh_/.test(id)) continue;
    const b = bx?.[id];
    if (b && Math.max(b.max.x - b.min.x, b.max.z - b.min.z) > 200) continue; // long roads: their center is no reference point
    const hay = new Set(`${id} ${o.label || ''} ${o.kind || ''}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    let sc = 0; for (const t of want) if (hay.has(t)) sc += toks.includes(t) ? 2 : 1;
    if (o.kind === 'mark' && want.has('impact')) sc += 0.5;
    if (sc > bestScore) { bestScore = sc; best = id; }
  }
  // The intersection / crossover is the scene origin in every world we generate.
  if (!best && toks.some((t) => /^(intersection|crossover|crossing|junction|median)$/.test(t))) return 'origin';
  return best;
}

export async function parseStatement(statement, world) {
  const s = statement.toLowerCase();
  const bx = await boxes(world);
  const center = (id) => { const b = id !== 'origin' && bx[id]; return b ? [(b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2] : [0, 0]; };
  const roads = Object.keys(bx).filter((id) => world.objects[id].kind === 'road');
  const notes = [];
  let pos = null;

  const travel = (s.match(new RegExp(`\\b(?:driving|heading|going|traveling|travelling|headed)\\s+${DIR_RE}`)) || s.match(new RegExp(`\\b${DIR_RE}bound\\b`)) || [])[1];
  const unitRe = '(\\d+(?:\\.\\d+)?)\\s*(m|meters?|metres?|yards?|yds?|ft|feet|foot)\\b';
  const landmarkRe = "(?:the\\s+)?([a-z0-9' -]+?)(?=[,.;!?]|\\s+(?:when|and|as|while|facing|looking|i\\b)|$)";
  // 1. "N units <dir> of <landmark>"
  let m = s.match(new RegExp(`${unitRe}\\s+(?:to\\s+the\\s+)?${DIR_RE}\\s+(?:of|from)\\s+${landmarkRe}`));
  if (m) {
    const d = Number(m[1]) * UNIT[m[2]], dir = DIRS[normDir(m[3])], lm = matchLandmark(m[4], world, bx);
    const [cx, cz] = lm ? center(lm) : [0, 0];
    pos = [cx + dir[0] * d, cz + dir[1] * d];
    notes.push(`"${m[0]}" → ${r1(d)} m ${normDir(m[3])} of ${lm || 'origin'} [${r1(cx)}, ${r1(cz)}]`);
  }
  // 2. "N units from/before <landmark>" + travel direction → approaching, so on the side they came from
  if (!pos && (m = s.match(new RegExp(`${unitRe}\\s+(?:from|before|short\\s+of|away\\s+from|back\\s+from)\\s+${landmarkRe}`)))) {
    const d = Number(m[1]) * UNIT[m[2]], lm = matchLandmark(m[3], world, bx);
    const [cx, cz] = lm ? center(lm) : [0, 0];
    const tv = travel ? DIRS[normDir(travel)] : [1, 0];
    pos = [cx - tv[0] * d, cz - tv[1] * d];
    notes.push(`"${m[0]}" → ${r1(d)} m ${travel ? `before ${lm || 'origin'} while heading ${travel}` : `from ${lm || 'origin'} (direction unstated; assumed east)`}`);
  }
  // 3. "<dir> side of the highway/road"
  if (!pos && (m = s.match(new RegExp(`${DIR_RE}\\s+side\\s+of\\s+(?:the\\s+)?([a-z0-9 -]+?)(?=[,.;!?]|\\s+(?:when|and|facing|looking)|$)`)))) {
    const dir = DIRS[normDir(m[1])];
    const span = roads.map((id) => bx[id]);
    if (span.length) {
      const minZ = Math.min(...span.filter((b) => b.max.x - b.min.x > b.max.z - b.min.z).map((b) => b.min.z));
      const maxZ = Math.max(...span.filter((b) => b.max.x - b.min.x > b.max.z - b.min.z).map((b) => b.max.z));
      const x = 0;
      pos = dir[1] < 0 ? [x, minZ - 6] : dir[1] > 0 ? [x, maxZ + 6] : [dir[0] * 15, (minZ + maxZ) / 2];
      notes.push(`"${m[0]}" → just beyond the ${normDir(m[1])} edge of the main road, opposite the intersection`);
    }
  }
  // 4. "at/near/in front of/across from <landmark>"
  if (!pos && (m = s.match(new RegExp(`\\b(?:at|near|by|in\\s+front\\s+of|outside|beside|next\\s+to|across\\s+from)\\s+${landmarkRe}`)))) {
    const lm = matchLandmark(m[1], world, bx);
    if (lm) {
      const b = bx[lm];
      const [cx, cz] = center(lm);
      // nearest face toward the origin (the crash scene), 1.5 m out
      const ux = -cx, uz = -cz, L = Math.hypot(ux, uz) || 1;
      const hx = (b.max.x - b.min.x) / 2, hz = (b.max.z - b.min.z) / 2;
      const k = Math.min(hx / Math.abs(ux / L || 1e-9), hz / Math.abs(uz / L || 1e-9));
      pos = [cx + (ux / L) * (Math.min(k, L) + 1.5), cz + (uz / L) * (Math.min(k, L) + 1.5)];
      notes.push(`"${m[0]}" → beside ${lm}, on its side facing the crash scene`);
    }
  }
  if (!pos) return null;

  // Drivers: snap to a lane of the road that runs in their travel direction.
  const driving = /\b(driving|drove|behind the wheel|in my (car|truck|pickup|van))\b/.test(s) || !!travel;
  if (driving && travel) {
    const word = { west: 'westbound', east: 'eastbound', north: 'northbound', south: 'southbound' }[normDir(travel).replace(/^(north|south)(east|west)$/, '$1')];
    const rd = roads.find((id) => new RegExp(`${word}|\\b${word[0]}b\\b|_${word[0]}b\\b`).test(`${id} ${world.objects[id].label || ''}`.toLowerCase()));
    if (rd) {
      const b = bx[rd], alongX = b.max.x - b.min.x > b.max.z - b.min.z;
      // Right-hand traffic: the through lanes sit on the driver's right edge (right of heading (dx,dz) is (-dz,dx)).
      const [dx, dz] = DIRS[normDir(travel)];
      if (alongX) { const half = (b.max.z - b.min.z) / 2, off = Math.min(5.5, half); pos[1] = r1(dx < 0 ? b.min.z + off : b.max.z - off); void dz; }
      else { const half = (b.max.x - b.min.x) / 2, off = Math.min(5.5, half); pos[0] = r1(dz < 0 ? b.max.x - off : b.min.x + off); }
      notes.push(`driver placed in ${rd}`);
    }
  }
  const eyeHeight = /\b(semi|tractor|18-wheeler|big rig|bus|my truck)\b/.test(s) && driving ? 2.2 : /\bpickup|suv|van\b/.test(s) && driving ? 1.6 : driving ? 1.2 : 1.6;

  let lookAt = null;
  const vehs = Object.keys(world.objects).filter((id) => world.objects[id].kind === 'vehicle' || id.startsWith('veh_'));
  const byLabel = (re) => vehs.find((id) => re.test(`${id} ${world.objects[id].label || ''}`.toLowerCase()));
  if (/\b(car|sedan|coupe)\b/.test(s)) lookAt = byLabel(/sedan|\bcar\b|coupe/);
  if (!lookAt && /\b(truck|trailer|semi|rig)\b/.test(s)) lookAt = byLabel(/trailer/) || byLabel(/truck|tractor/);
  lookAt = lookAt || mostCommonLookAt(world) || vehs[0];
  const { t: observationTime, why: timeWhy } = defaultTime(world);

  return {
    name: 'Live witness',
    position: [r1(pos[0]), 0, r1(pos[1])],
    eyeHeight, lookAt, observationTime,
    claim: statement.length > 160 ? statement.slice(0, 157) + '...' : statement,
    confidence: 'low',
    assumptions: `Deterministic parser (Argon unavailable): ${notes.join('; ')}. lookAt ${lookAt}; observationTime ${observationTime}s = ${timeWhy}.`,
  };
}

// ---------- main entry ----------
export async function newWitness(statement, world, caseOpt) {
  // Accepts newWitness(statement, world, "demo") or newWitness(statement, world, { caseId: "demo" }).
  const caseId = (typeof caseOpt === 'string' ? caseOpt : caseOpt?.caseId) || defaultCaseId();
  if (!statement || typeof statement !== 'string') throw new Error('newWitness: statement (string) required');
  const d = caseDirs(caseId);
  const t0 = Date.now();
  const done = async (w, source, extra = {}) => {
    finalize(w, world);
    await snapOutOfOccluders(world, w);
    return Object.assign(w, { source, latencyMs: Date.now() - t0 }, extra);
  };
  const fallbacks = async (why) => {
    const rp = replayGet(d, statement);
    if (rp?.witness) {
      const w = { ...rp.witness };
      w.assumptions = (w.assumptions || '') + ` [replayed cached Argon answer from ${rp.at}${why ? `; live call failed: ${why}` : ''}]`;
      return done(w, 'argon-replay');
    }
    const p = await parseStatement(statement, world).catch(() => null);
    if (p) { if (why) p.assumptions += ` [live call failed: ${why}]`; return done(p, 'parser'); }
    return null;
  };

  if (!isLive()) {
    const fb = await fallbacks(null);
    if (fb) return fb;
    const ex = readJSON(path.join(d.cache, 'new_witness_example.json'));
    if (!ex) throw new Error(`[mock] no replay/parse for this statement and cases/${caseId}/cache/new_witness_example.json missing`);
    const w = { ...(ex.witness || ex) };
    w.claim = statement.length > 160 ? statement.slice(0, 157) + '...' : statement;
    w.assumptions = (w.assumptions || '') + ' [mock mode: cached example placement, not parsed from this statement]';
    return done(w, 'mock-example');
  }

  const s = await summarizeWorld(world, currentWorldSource(d));
  const prompt = fill(readPrompt('new_witness'), {
    DURATION: String(s.duration), HEADER: s.header, OBJECTS: s.objects, TIMELINE: await movingTimeline(world),
    WITNESSES: s.witnesses, FACTS: s.facts, STATEMENT: statement.replace(/"""/g, "'''"),
  });
  const name = `new_witness_${statementKey(statement)}`;
  const errors = [];
  for (const [i, ms] of [T1, T2].entries()) {
    try {
      // Retry drops whichever optional config the API rejected (schema / thinking level).
      const opts = { useSchema: !errors.some((e) => /schema/i.test(e)), useThinking: !errors.some((e) => /thinking/i.test(e)) };
      const { w, secs } = await callOnce(prompt, ms, i ? `${name}_retry` : name, d, opts);
      console.log(`[new_witness] ${caseId}: ${MODEL} placed witness in ${secs.toFixed(1)}s (attempt ${i + 1})`);
      const out = await done(w, 'argon-live', { model: MODEL, modelSeconds: secs, attempt: i + 1 });
      const { source, latencyMs, attempt, modelSeconds, ...keep } = out;
      replayPut(d, statement, { witness: keep, model: MODEL, seconds: secs });
      return out;
    } catch (e) {
      errors.push(e.message);
      console.warn(`[new_witness] ${caseId}: attempt ${i + 1} failed: ${e.message}`);
    }
  }
  const fb = await fallbacks(errors.join(' | '));
  if (fb) return fb;
  throw new Error(`newWitness: Argon failed (${errors.join(' | ')}) and no replay/parser match for this statement`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  const ci = args.indexOf('--case');
  const caseId = ci >= 0 ? args.splice(ci, 2)[1] : defaultCaseId();
  const statement = args.join(' ') || 'I was standing on the opposite corner and saw the light change just before the crash.';
  try {
    const d = caseDirs(caseId);
    const { loadWorldFile } = await import('./world_io.js');
    const st = readJSON(path.join(d.cache, 'state.json'), {});
    const wf = st.world ? st.world.replace(/^\//, '') : path.relative(ROOT, path.join(d.worlds, 'world_v1.js'));
    const world = await loadWorldFile(wf);
    const w = await newWitness(statement, world, caseId);
    w.id = 'wit_live_1';
    world.witnesses.push(w);
    world.setTime?.(w.observationTime);
    const { sightline } = await import('../checks/checks.js');
    const sl = sightline(world, w.id, w.lookAt, w.observationTime);
    console.log(JSON.stringify({ caseId, mode: mode(), world: wf, witness: w, sightline: { visible: sl.visible, blockedBy: sl.blockedBy, distance: sl.distance } }, null, 2));
  } catch (e) { console.error('[new_witness] FAILED:', e.message); process.exit(1); }
}
