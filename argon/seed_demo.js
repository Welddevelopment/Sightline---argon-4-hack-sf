// argon/seed_demo.js — DEMO-ONLY seeding (not part of the engine). Builds cases/demo/ for mock replay:
//   1. syncs the CASE slice's case/* (+ deposition video/srt) into cases/demo/evidence and cases/demo/text
//   2. writes cases/demo/cache/* (the cached Argon outputs) from worlds/reference_world.js + the deposition plan.
// Re-run any time the reference world or case files change:  node argon/seed_demo.js
//
// Story seeded:
//   generate_world.js     = reference world with ONE deliberate error: Witness B placed where she SAID
//                           ("on the corner near the crossing") instead of where she MARKED on Exhibit 4 → ray clear.
//   critique_round1.json  = Argon catches it (Depo timecode of the map mark + police report), patch = reference world
//                           (B at her marked position → blocked → contradiction).
//   critique_round2.json  = world faithful; contradiction stands in the TESTIMONY; patch null.
//   new_witness_example.json, baseline.json (Flash, text-only, says consistent).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, writeJSON, readJSON, readIfExists } from './client.js';
import { caseDirs } from './case.js';

const D = caseDirs(process.env.SEED_CASE || 'demo');
const CACHE_DIR = D.cache;
import { loadWorldFile } from './world_io.js';

const REF = path.join(ROOT, 'worlds', 'reference_world.js');
const WIT = process.env.SEED_WITNESS || 'wit_B';
const r1 = (x) => Math.round(x * 10) / 10;
const tc = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;


// ---------- 1. sync case/* → cases/demo/{evidence,text} ----------
function copyIfNewer(src, dst) {
  if (!fs.existsSync(src)) return false;
  if (fs.existsSync(dst) && fs.statSync(dst).mtimeMs >= fs.statSync(src).mtimeMs && fs.statSync(dst).size === fs.statSync(src).size) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return true;
}
function syncDemoCase() {
  const copied = [];
  const caseDir = path.join(ROOT, 'case');
  const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.startsWith('.')) : []);
  for (const f of list(caseDir)) {
    const src = path.join(caseDir, f);
    if (fs.statSync(src).isDirectory()) continue;
    if (/\.(md|txt)$/i.test(f)) {
      if (copyIfNewer(src, path.join(D.evidence, f))) copied.push('evidence/' + f);
      if (copyIfNewer(src, path.join(D.text, f.replace(/\.md$/i, '.txt')))) copied.push('text/' + f.replace(/\.md$/i, '.txt'));
    } else if (/\.pdf$/i.test(f)) {
      if (copyIfNewer(src, path.join(D.evidence, f))) copied.push('evidence/' + f);
    }
  }
  for (const f of list(path.join(caseDir, 'exhibits'))) {
    if (copyIfNewer(path.join(caseDir, 'exhibits', f), path.join(D.evidence, f))) copied.push('evidence/' + f);
  }
  for (const f of ['deposition.mp4', 'deposition.srt']) {
    if (copyIfNewer(path.join(ROOT, 'deposition', 'out', f), path.join(D.evidence, f))) copied.push('evidence/' + f);
  }
  const srt = path.join(D.evidence, 'deposition.srt');
  if (fs.existsSync(srt) && copyIfNewer(srt, path.join(D.text, 'deposition.txt'))) copied.push('text/deposition.txt');
  // keep case.json's file list in step (INGEST owns the format; we only append missing entries)
  const cj = path.join(D.dir, 'case.json');
  const meta = readJSON(cj, { caseId: D.caseId, title: 'Demo case (pre-run)', files: [], status: 'ready' });
  meta.files = meta.files || [];
  for (const f of list(D.evidence)) {
    if (meta.files.some((x) => x.name === f)) continue;
    const type = /\.(mp4|mov|webm)$/i.test(f) ? 'video' : /\.(png|jpe?g)$/i.test(f) ? 'image' : /\.pdf$/i.test(f) ? 'pdf' : 'text';
    const textName = f.replace(/\.(md|srt)$/i, '.txt');
    meta.files.push({ name: f, type, size: fs.statSync(path.join(D.evidence, f)).size,
      ...(fs.existsSync(path.join(D.text, textName)) ? { textPath: 'text/' + textName } : {}) });
  }
  writeJSON(cj, meta);
  return copied;
}

// ---------- deposition timecodes (map mark, claim, "nothing between") ----------
function depoMoments() {
  const out = { mark: null, claim: null, nothing: null, said: null, markXZ: null };
  // Prefer the CASE slice's script, then the VIDEO slice's plan.
  const script = readJSON(path.join(ROOT, 'case', 'deposition_script.json'));
  const plan = readJSON(path.join(ROOT, 'deposition', 'out', 'plan.json'));
  const rows = [];
  if (plan?.states) for (const s of plan.states) rows.push({ start: s.start, end: s.end, speaker: s.speaker, text: s.text, exhibit: s.exhibit });
  else if (script) {
    const lines = Array.isArray(script) ? script : (script.lines || script.segments || script.script || script.turns || []);
    for (const l of lines) rows.push({ start: typeof l.start === 'number' ? l.start : null, tc: l.timecode || l.tc, speaker: l.speaker, text: l.text || '', exhibit: l.exhibit || l.action });
  }
  const at = (r) => (r.tc ? r.tc : r.start != null ? tc(r.start) : null);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const isB = /witness b/i.test(r.speaker || '');
    if (!out.mark && r.exhibit && /map_mark|mark/i.test(JSON.stringify(r.exhibit))) {
      let j = i; while (j + 1 < rows.length && rows[j + 1].exhibit && /map_mark/.test(JSON.stringify(rows[j + 1].exhibit)) && rows[j + 1].speaker === r.speaker) j++;
      out.mark = r.start != null && rows[i].end != null ? `${tc(r.start)}-${tc(rows[i].end)}` : at(r);
      if (r.exhibit.x_m != null) out.markXZ = [r.exhibit.x_m, r.exhibit.z_m];
    }
    if (isB && !out.said && /corner|crossing|bus/i.test(r.text)) out.said = { tc: at(r), text: r.text + (rows[i + 1] && rows[i + 1].speaker === r.speaker ? ' ' + rows[i + 1].text : '') };
    if (isB && !out.claim && /light|signal|red|green/i.test(r.text)) out.claim = { tc: at(r), text: r.text + (rows[i + 1] && rows[i + 1].speaker === r.speaker ? ' ' + rows[i + 1].text : '') };
    if (isB && !out.nothing && /nothing|no\b.*recall/i.test(r.text)) out.nothing = { tc: at(r), text: r.text };
  }
  return out;
}

// ---------- page citation for the occluder from the case files (fallback: world citation) ----------
function caseCitation(regex, fallback) {
  const dir = path.join(ROOT, 'case');
  if (!fs.existsSync(dir)) return fallback;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const txt = fs.readFileSync(path.join(dir, f), 'utf8');
    const idx = txt.search(regex);
    if (idx < 0) continue;
    const before = txt.slice(0, idx);
    const pages = [...before.matchAll(/(?:^|\n)\s*(?:#+\s*)?(?:\[?\s*)?(?:Page|p\.)\s*(\d+)/gi)];
    const doc = f.replace(/\.md$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return pages.length ? `${doc} p.${pages[pages.length - 1][1]}` : doc;
  }
  return fallback;
}

// ---------- source surgery: replace the witness position literal ----------
function witnessBlockRange(src, id) {
  const re = new RegExp(`id:\\s*['"]${id}['"]`);
  const m = src.match(re);
  if (!m) throw new Error(`could not find ${id} in reference world source`);
  const start = src.lastIndexOf('{', m.index);
  let depth = 0, i = start;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return [start, i + 1];
}
function setWitnessField(src, id, field, valueLiteral) {
  const [a, b] = witnessBlockRange(src, id);
  let block = src.slice(a, b);
  const re = field === 'position' ? /position:\s*\[[^\]]*\]/ : new RegExp(`${field}:\\s*(['"])(?:\\\\.|(?!\\1).)*\\1`);
  if (!re.test(block)) throw new Error(`no ${field} literal in ${id} block`);
  block = block.replace(re, `${field}: ${valueLiteral}`);
  return src.slice(0, a) + block + src.slice(b);
}

async function main() {
  const synced = syncDemoCase();
  if (!fs.existsSync(REF)) throw new Error('worlds/reference_world.js missing');
  const refSrc = fs.readFileSync(REF, 'utf8');
  const world = await loadWorldFile(REF);
  const { sightline, runAll } = await import('../checks/checks.js');
  const wb = world.witnesses.find((w) => w.id === WIT);
  if (!wb) throw new Error(`${WIT} not in reference world`);
  const target = wb.lookAt, t = wb.observationTime;
  const marked = sightline(world, WIT, target, t);
  if (marked.visible) console.warn(`[seed] WARNING: in reference_world ${WIT} is NOT blocked; story needs it blocked`);
  const occId = marked.blockedBy || Object.keys(world.objects).find((k) => k.startsWith('occ_'));
  const occ = world.objects[occId];
  const tgt = world.objects[target];

  // Find the "near the corner" spot: nearest clear position to the corner on the same side, on the sidewalk.
  const [mx, , mz] = wb.position;
  const sx = Math.sign(mx) || 1, sz = Math.sign(mz) || 1;
  const cands = [];
  for (let dx = 4; dx <= 9; dx += 0.5) for (let dz = 4; dz <= 9; dz += 0.5) cands.push([sx * dx, 0, sz * dz]);
  cands.sort((p, q) => Math.hypot(p[0] - sx * 5.6, p[2] - sz * 5.6) - Math.hypot(q[0] - sx * 5.6, q[2] - sz * 5.6));
  let said = null;
  for (const c of cands) {
    const orig = wb.position; wb.position = c;
    const s = sightline(world, WIT, target, t);
    wb.position = orig;
    if (s.visible) { said = c; break; }
  }
  if (!said) throw new Error('no clear "near the corner" position found');
  said = said.map(r1);
  const dist = r1(Math.hypot(mx - said[0], mz - said[2]));

  const depo = depoMoments();
  const markTc = depo.mark || '01:16-01:36';
  const saidTc = depo.said?.tc || '00:44';
  const claimTc = depo.claim?.tc || wb.citation.replace(/^Dep\w*\s*/i, '');
  const nothingTc = depo.nothing?.tc || '02:20';
  const occCite = caseCitation(/bus shelter|shelter/i, occ?.citation || 'Police report p.3');
  const sigCite = caseCitation(/signal timing|phase|cycle/i, tgt?.citation || 'Signal timing sheet p.1');
  const n = (id) => world.objects[id]?.label || id;

  // ---------- world_v1 (the deliberate error) ----------
  let v1 = setWitnessField(refSrc, WIT, 'position', `[${said.join(', ')}]`);
  v1 = setWitnessField(v1, WIT, 'citation', `'Depo ${saidTc} (spoken: "on the corner near the crossing")'`);
  v1 = `// Generated by Argon (mock replay of cache/generate_world.js) from case/*.md + deposition/out/deposition.mp4.\n` +
       `// Round 1. ${WIT} placed from spoken testimony "on the corner near the crossing" (Depo ${saidTc}).\n` + v1;
  fs.writeFileSync(path.join(CACHE_DIR, 'generate_world.js'), v1);

  // checks on v1 to quote in critique round 1
  const tmp = path.join(D.worlds, '.seed_tmp_v1.js');
  fs.writeFileSync(tmp, v1);
  const w1 = await loadWorldFile(tmp);
  fs.unlinkSync(tmp);
  const c1 = runAll(w1).find((c) => c.subject === WIT);
  const stateAt = tgt?.state ? tgt.state(t) : null;

  // ---------- critique round 1: catches the misplacement, patches ----------
  const patch = `// Round 2 patch (Argon): ${WIT} moved from [${said.join(', ')}] (spoken "near the corner", Depo ${saidTc}) to her MARKED position ` +
    `[${wb.position.join(', ')}] on Exhibit 4 (Depo ${markTc}). From there ${occId} blocks the view of ${target} at t=${t}s (${occCite}).\n` + refSrc;
  const markXZ = wb.position;
  const crit1 = {
    round: 1,
    verdict: 'world_patched',
    summary: `The generated world put Witness B where she said she was ("on the corner near the crossing"), not where she marked on Exhibit 4. ` +
      `In the deposition video she marks a spot about ${dist} m away, behind the ${n(occId)}. Moving her there blocks her view of the signal, so the world is patched and her claim must be re-tested.`,
    findings: [
      {
        id: 'F1', severity: 'high',
        summary: `Witness B is placed from her vague spoken description, not from the position she physically marked on Exhibit 4.`,
        detail: `At Depo ${saidTc} she says only "${depo.said?.text || 'on the corner near the crossing'}". At Depo ${markTc} the video shows her marking a red X on Exhibit 4 ` +
          `at approx (x ${r1(markXZ[0])}, z ${r1(markXZ[2])}) m in the world frame, ${dist} m from where world_v1 places her [${said.join(', ')}]. The mark is the controlling evidence of position; the transcript never states it.`,
        evidence: [
          { source: 'deposition.mp4', citation: `Depo ${markTc} (witness marks red X on Exhibit 4)` },
          { source: 'deposition.mp4', citation: `Depo ${saidTc} (spoken: "on the corner near the crossing")` },
          { source: 'Exhibit 4 (map)', citation: `red X at approx (${r1(markXZ[0])}, ${r1(markXZ[2])}) m` },
          { source: 'Render', citation: `${WIT}.png @ t=${t}s shows an unobstructed view only because of the wrong position` },
        ],
        involves: [WIT], status: 'contradiction',
      },
      {
        id: 'F2', severity: 'high',
        summary: `From her marked position, the ${n(occId)} stands between Witness B and ${n(target)} at the moment she describes.`,
        detail: `The ${n(occId)} is documented at ${occCite}. A sight line from her marked spot (eye ${wb.eyeHeight ?? 1.6} m) to the signal head at t=${t}s passes through it ` +
          `(independent check: blocked by ${marked.blockedBy || occId} at ${r1(marked.distance)} m). In world_v1 the check reads "${c1?.pass ? 'clear' : 'blocked'}" only because she was misplaced.`,
        evidence: [
          { source: occCite.split(' p.')[0], citation: occCite.includes(' p.') ? 'p.' + occCite.split(' p.')[1] : occCite },
          { source: 'Independent check', citation: `sightline ${WIT}→${target} from marked position: blocked by ${marked.blockedBy || occId}` },
          { source: 'Independent check', citation: `sightline ${WIT}→${target} in world_v1: ${c1?.pass ? 'clear' : 'blocked'} (wrong position)` },
        ],
        involves: [WIT, occId, target], status: 'contradiction',
      },
      {
        id: 'F3', severity: 'medium',
        summary: `Signal phasing and Vehicle A's skid physics in the world match the record.`,
        detail: `Signal ${target} is ${stateAt || 'as documented'} at t=${t}s per ${sigCite}; the skid-vs-speed check passes.`,
        evidence: [
          { source: sigCite.split(' p.')[0], citation: sigCite.includes(' p.') ? 'p.' + sigCite.split(' p.')[1] : sigCite },
          { source: 'Independent check', citation: 'skid_vs_speed veh_A: pass' },
        ],
        involves: [target, 'veh_A'], status: 'consistent',
      },
    ],
    patch,
  };
  writeJSON(path.join(CACHE_DIR, 'critique_round1.json'), crit1);

  // ---------- critique round 2: world faithful; contradiction is in the testimony ----------
  const crit2 = {
    round: 2,
    verdict: 'contradiction_found',
    summary: `With Witness B at her marked position the world matches the evidence. Her claim that she "saw the light clearly" and that nothing was between her and the signal ` +
      `is contradicted: the ${n(occId)} blocks her line of sight to the signal head at t=${t}s. No further patch is needed; the contradiction is in the testimony.`,
    findings: [
      {
        id: 'F1', severity: 'high',
        summary: `Witness B could not have seen ${n(target)} from where she marked she was standing.`,
        detail: `Her eye-level render at t=${t}s shows the ${n(occId)} filling the direction of the signal head. The ray-cast check agrees (blocked by ${marked.blockedBy || occId}, ${r1(marked.distance)} m to the signal). ` +
          `She testified "${depo.claim?.text || wb.claim}" (Depo ${claimTc}) and that nothing was between her and the signal (Depo ${nothingTc}).`,
        evidence: [
          { source: 'deposition.mp4', citation: `Depo ${markTc} (marked position on Exhibit 4)` },
          { source: 'deposition.mp4', citation: `Depo ${claimTc} (claim about the signal)` },
          { source: 'deposition.mp4', citation: `Depo ${nothingTc} ("nothing that I recall" between her and the signal)` },
          { source: occCite.split(' p.')[0], citation: occCite.includes(' p.') ? 'p.' + occCite.split(' p.')[1] : occCite },
          { source: 'Render', citation: `${WIT}.png @ t=${t}s` },
          { source: 'Independent check', citation: `sightline ${WIT}→${target}: blocked by ${marked.blockedBy || occId}` },
        ],
        involves: [WIT, occId, target], status: 'contradiction',
      },
      ...world.witnesses.filter((w) => w.id !== WIT).map((w, i) => {
        const s = sightline(world, w.id, w.lookAt, w.observationTime);
        return {
          id: `F${i + 2}`, severity: 'low',
          summary: `${(w.name || w.id).replace(/\s*\(fictional\)/i, '')} had a ${s.visible ? 'clear' : 'blocked'} line of sight to ${n(w.lookAt)} at t=${w.observationTime}s.`,
          detail: s.visible ? 'The eye-level render and the ray-cast agree; the testimony is physically possible.' : `Blocked by ${s.blockedBy}.`,
          evidence: [{ source: 'deposition.mp4', citation: String(w.citation).replace(/^Deposition\s*/i, 'Depo ') },
            { source: 'Independent check', citation: `sightline ${w.id}→${w.lookAt}: ${s.visible ? 'clear' : 'blocked by ' + s.blockedBy}` }],
          involves: [w.id, w.lookAt], status: s.visible ? 'consistent' : 'contradiction',
        };
      }),
      { id: `F${world.witnesses.length + 1}`, severity: 'low', summary: `Vehicle A's speed in the world is consistent with the ${(world.skids || [])[0]?.length ?? ''} m skid marks.`,
        evidence: [{ source: (world.skids || [])[0]?.citation || 'Police report', citation: 'skid measurement' }, { source: 'Independent check', citation: 'skid_vs_speed veh_A: pass' }],
        involves: ['veh_A'], status: 'consistent' },
    ],
    patch: null,
  };
  writeJSON(path.join(CACHE_DIR, 'critique_round2.json'), crit2);

  // ---------- new witness example: clear view of the target from the opposite corner ----------
  let nwPos = [-sx * 6.5, 0, -sz * 6.5];
  for (const c of [[-sx * 6.5, 0, -sz * 6.5], [-sx * 7.5, 0, sz * 6.5], [sx * 6.5, 0, -sz * 7.5], [-sx * 9, 0, -sz * 9]]) {
    world.witnesses.push({ id: '__probe', position: c, eyeHeight: 1.6, lookAt: target, observationTime: t, citation: 'x' });
    const s = sightline(world, '__probe', target, t);
    world.witnesses.pop();
    if (s.visible) { nwPos = c; break; }
  }
  writeJSON(path.join(CACHE_DIR, 'new_witness_example.json'), {
    name: 'Live witness (fictional)', position: nwPos.map(r1), eyeHeight: 1.6, lookAt: target, observationTime: t,
    claim: 'I was on the opposite corner waiting to cross and saw the light change just before the crash.',
    citation: 'Live statement', confidence: 'medium',
    assumptions: `"Opposite corner" resolved to the corner diagonally across from the bus stop, on the sidewalk; looking at ${target} at the time the light changed (t=${t}s).`,
  });

  // ---------- baseline: Flash text-only, misses the map mark ----------
  writeJSON(path.join(CACHE_DIR, 'baseline.json'), {
    model: process.env.BASELINE_MODEL || 'gemini-3.8-flash',
    method: 'chunk-and-summarize transcript (text only, no video)',
    chunks: 4,
    summary: `Witness B's account is internally consistent: she says she was waiting at the bus stop on the corner near the crossing with "a good view of everything" ` +
      `and that nothing was between her and the signal. Nothing in the transcript contradicts the police report.`,
    findings: [
      { id: 'B1', severity: 'low', summary: 'Witness B had an unobstructed view of the signal from the corner.',
        evidence: [{ source: 'deposition.srt', citation: `[${saidTc}] "on the corner near the crossing... I had a good view of everything"` },
          { source: 'deposition.srt', citation: `[${nothingTc}] "No, nothing that I recall"` }],
        involves: [WIT], status: 'consistent' },
      { id: 'B2', severity: 'low', summary: 'Witness B marked her position on Exhibit 4; exact location not stated in the transcript.',
        evidence: [{ source: 'deposition.srt', citation: `[${(markTc.split('-')[0])}] "I was about here, a little way back from the corner, roughly in this area."` }],
        involves: [WIT], status: 'unverifiable' },
      { id: 'B3', severity: 'low', summary: 'Vehicle A skid marks indicate braking before impact; consistent with Witness A.',
        evidence: [{ source: (world.skids || [])[0]?.citation || 'Police report', citation: 'skid marks' }], involves: ['veh_A'], status: 'consistent' },
    ],
    missed: 'Text-only pipeline never sees WHERE she marked on Exhibit 4, so it cannot place her behind the occluder.',
  });

  // Fresh mock state: remove stale world versions / state so the loop replays cleanly.
  console.log(JSON.stringify({ case: D.caseId, synced, witness: WIT, markedPosition: wb.position, saidPosition: said, distance: dist, blockedBy: marked.blockedBy,
    depo: { markTc, saidTc, claimTc, nothingTc }, occCite, sigCite, newWitness: nwPos }, null, 2));
}

main().catch((e) => { console.error('[seed_demo] FAILED:', e.message); process.exit(1); });
