// argon/new_witness.js — typed statement → witness entry in the world frame.
// Lib: import { newWitness } from './argon/new_witness.js'; await newWitness(statement, world, caseId)
// CLI: node argon/new_witness.js [--case demo] "I was standing at the northeast corner and saw ..."
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { callArgon, ARGON_MODEL, readPrompt, fill, textPart, isLive, readJSON, mode, ROOT } from './client.js';
import { caseDirs, defaultCaseId } from './case.js';
import { summarizeWorld } from './world_io.js';

function currentWorldSource(d) {
  const st = readJSON(path.join(d.cache, 'state.json'), {});
  const f = st.world ? path.resolve(ROOT, st.world.replace(/^\/+/, '')) : null;
  try { return f ? fs.readFileSync(f, 'utf8') : null; } catch { return null; }
}

export async function newWitness(statement, world, caseOpt) {
  // Accepts newWitness(statement, world, "demo") or newWitness(statement, world, { caseId: "demo" }).
  const caseId = (typeof caseOpt === 'string' ? caseOpt : caseOpt?.caseId) || defaultCaseId();
  if (!statement || typeof statement !== 'string') throw new Error('newWitness: statement (string) required');
  const d = caseDirs(caseId);
  if (!isLive()) {
    const ex = readJSON(path.join(d.cache, 'new_witness_example.json'));
    if (!ex) throw new Error(`[mock] cases/${caseId}/cache/new_witness_example.json missing`);
    const w = { ...(ex.witness || ex) };
    delete w.id;
    return { ...w, claim: statement.length > 160 ? statement.slice(0, 157) + '...' : statement,
      assumptions: (w.assumptions || '') + ' [mock mode: cached example placement, not parsed from this statement]' };
  }
  const s = await summarizeWorld(world, currentWorldSource(d));
  const prompt = fill(readPrompt('new_witness'), {
    DURATION: String(s.duration), HEADER: s.header, OBJECTS: s.objects, WITNESSES: s.witnesses, FACTS: s.facts, STATEMENT: statement,
  });
  const res = await callArgon({ name: `new_witness_${Date.now()}`, model: ARGON_MODEL, parts: [textPart(prompt)], json: true,
    maxOutputTokens: 4096, cacheDir: d.cache });
  const w = res.data?.witness || res.data;
  if (!Array.isArray(w?.position)) throw new Error('newWitness: model returned no position');
  if (typeof w.lookAt === 'string' && world?.objects && !world.objects[w.lookAt]) {
    const fallback = Object.keys(world.objects).find((k) => k.startsWith('sig_')) || Object.keys(world.objects).find((k) => k.startsWith('veh_'));
    w.assumptions = (w.assumptions || '') + ` [lookAt "${w.lookAt}" not in world; using ${fallback}]`;
    w.lookAt = fallback;
  }
  w.position = [Number(w.position[0]), Number(w.position[1] || 0), Number(w.position[2])];
  w.eyeHeight = Number(w.eyeHeight || 1.6);
  w.observationTime = Number(w.observationTime ?? 0);
  w.citation = w.citation || 'Live statement';
  delete w.id; // server assigns wit_live_N
  return w;
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
    const { sightline } = await import('../checks/checks.js');
    const sl = sightline(world, w.id, w.lookAt, w.observationTime);
    console.log(JSON.stringify({ caseId, mode: mode(), world: wf, witness: w, sightline: { visible: sl.visible, blockedBy: sl.blockedBy, distance: sl.distance } }, null, 2));
  } catch (e) { console.error('[new_witness] FAILED:', e.message); process.exit(1); }
}
