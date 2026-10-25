// argon/seed_demo.js — DEMO-ONLY seeding (not part of the engine). Builds cases/demo/ for mock replay:
//   1. syncs the CASE slice's case/* (+ deposition video/srt) into cases/demo/evidence and cases/demo/text
//   2. writes cases/demo/cache/* (the cached Argon outputs) from worlds/reference_world.js + the deposition plan.
// Re-run any time the reference world or case files change:  node argon/seed_demo.js
//
// Story seeded (derived from the reference world + case files at seed time):
//   generate_world.js     = reference world with ONE deliberate error: the contradicted witness's claim ("clear view
//                           the whole way in") is tested at an EARLIER moment, before the obstruction crossed, so the ray is clear.
//   critique_round1.json  = Argon catches it: the claim runs "right up until the moment it hit" (Depo claim timecode), she
//                           marked her position on the exhibit in the video (Depo mark timecode); patch = reference world
//                           (marked position + the claimed moment → blocked).
//   critique_round2.json  = world faithful; contradiction stands in the TESTIMONY; patch null.
//   new_witness_example.json (clear-view spot), baseline.json (Flash, transcript only: "consistent").
// Also sanitizes the demo's text copy of the deposition script: exhibit marks exist only in the video.
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
      if (/^(status|readme)/i.test(f)) continue;
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
  // The deposition script carries the map-mark coordinates for the VIDEO builder. A real case only has the video +
  // a transcript, so the demo's evidence/text copies must not contain them.
  const script = readJSON(path.join(caseDir, 'deposition_script.json'));
  if (Array.isArray(script)) {
    const clean = script.map(({ exhibit, ...l }) => l);
    const lines = clean.map((l) => `[${tc(l.t_start_sec ?? l.start ?? 0)}] ${(l.speaker || '').toUpperCase()}: ${l.text}`).join('\n') + '\n';
    for (const f of ['deposition_script.json']) { const p = path.join(D.evidence, f); if (fs.existsSync(p)) fs.rmSync(p); }
    for (const f of ['deposition_script.txt']) { const p = path.join(D.text, f); if (fs.existsSync(p)) fs.rmSync(p); }
    fs.writeFileSync(path.join(D.evidence, 'deposition_transcript.txt'), lines);
    fs.writeFileSync(path.join(D.text, 'deposition_transcript.txt'), lines);
    copied.push('evidence+text/deposition_transcript.txt (exhibit marks stripped)');
  }
  const srt = path.join(D.evidence, 'deposition.srt');
  if (fs.existsSync(srt) && copyIfNewer(srt, path.join(D.text, 'deposition.txt'))) copied.push('text/deposition.txt');
  // keep case.json's file list in step (INGEST owns the format; we only append missing entries)
  const cj = path.join(D.dir, 'case.json');
  const meta = readJSON(cj, { caseId: D.caseId, title: 'Demo case (pre-run)', files: [], status: 'ready' });
  meta.files = (meta.files || []).filter((x) => x.name !== 'deposition_script.json');
  for (const f of list(D.evidence)) {
    if (meta.files.some((x) => x.name === f)) continue;
    const type = /\.(mp4|mov|webm)$/i.test(f) ? 'video' : /\.(png|jpe?g)$/i.test(f) ? 'image' : /\.pdf$/i.test(f) ? 'pdf' : 'text';
    const textName = f.replace(/\.(md|srt|txt)$/i, '.txt').replace(/^deposition\.txt$/, 'deposition.txt');
    meta.files.push({ name: f, type, size: fs.statSync(path.join(D.evidence, f)).size,
      ...(fs.existsSync(path.join(D.text, textName)) ? { textPath: 'text/' + textName } : {}) });
  }
  writeJSON(cj, meta);
  return copied;
}

// ---------- case-file helpers ----------
const SCRIPT = () => readJSON(path.join(ROOT, 'case', 'deposition_script.json'), []);
function depoLines() {
  return SCRIPT().map((l) => ({ t: l.t_start_sec ?? l.start ?? 0, speaker: l.speaker || '', text: l.text || '', exhibit: l.exhibit || null }));
}
const findLine = (lines, speaker, re, after = -1) => lines.find((l) => l.t > after && (!speaker || l.speaker === speaker) && re.test(l.text));
/** facts.md table rows: | F28 | text | HAR-17/02 p.29 | */
function facts() {
  const txt = readIfExists(path.join(ROOT, 'case', 'facts.md')) || '';
  return [...txt.matchAll(/^\|\s*(F\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/gm)].map((m) => ({ id: m[1], text: m[2].replace(/\*\*/g, ''), cite: m[3] }));
}
function fact(re, fallbackCite) {
  const f = facts().find((x) => re.test(x.text));
  return f ? { source: 'facts.md (' + f.id + ')', citation: f.cite, text: f.text } : { source: 'facts.md', citation: fallbackCite, text: '' };
}
// "| F28 | ... | HAR-17/02 p.29 |" → evidence item naming the NTSB report page
const ntsb = (f) => ({ source: 'NTSB/HAR-17/02 via ' + f.source, citation: f.citation.replace(/^HAR-17\/02\s*/, '') });

// ---------- source surgery: replace one field of one witness literal ----------
function witnessBlockRange(src, id) {
  const m = src.match(new RegExp(`(["']?)id\\1\\s*:\\s*["']${id}["']`));
  if (!m) throw new Error(`could not find ${id} in reference world source`);
  const start = src.lastIndexOf('{', m.index);
  let depth = 0, i = start;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) break; }
  return [start, i + 1];
}
function setWitnessField(src, id, field, literal) {
  const [a, b] = witnessBlockRange(src, id);
  const re = new RegExp(`(["']?)${field}\\1\\s*:\\s*(?:\\[[^\\]]*\\]|"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[-\\d.eE]+)`);
  const block = src.slice(a, b);
  if (!re.test(block)) throw new Error(`no ${field} in ${id} block`);
  return src.slice(0, a) + block.replace(re, `"${field}": ${literal}`) + src.slice(b);
}

async function main() {
  const synced = syncDemoCase();
  if (!fs.existsSync(REF)) throw new Error('worlds/reference_world.js missing');
  const refSrc = fs.readFileSync(REF, 'utf8');
  const world = await loadWorldFile(REF);
  const { sightline, runAll } = await import('../checks/checks.js');
  const refChecks = runAll(world);

  // The contradicted witness = the one whose sight line fails in the faithful (reference) world.
  const failing = refChecks.find((c) => c.check === 'sightline' && !c.pass);
  const WIT = process.env.SEED_WITNESS || failing?.subject;
  const wb = world.witnesses.find((w) => w.id === WIT);
  if (!wb) throw new Error('no witness with a blocked sight line in reference_world.js');
  const target = wb.lookAt, tObs = wb.observationTime;
  const nm = (wb.name || WIT).replace(/\s*\(fictional\)\s*/i, '');
  const label = (id) => world.objects[id]?.label || id;
  const at = (t, pos = wb.position) => {
    const orig = wb.position; wb.position = pos;
    const s = sightline(world, WIT, target, t); wb.position = orig; return s;
  };
  const blockedAtObs = at(tObs);
  if (blockedAtObs.visible) throw new Error(`${WIT} is not blocked at t=${tObs}`);

  // Last clear moment before tObs, onset of the obstruction, and what blocks it from onset to impact.
  let tLastClear = null;
  for (let t = tObs; t >= 0; t = r1(t - 0.1)) if (at(t).visible) { tLastClear = t; break; }
  if (tLastClear == null) throw new Error('witness never had a clear view; round-1 time error does not apply');
  const tOnset = r1(tLastClear + 0.1);
  const impactFact = (world.facts || []).find((f) => f.kind === 'time' && /impact/i.test(f.text));
  const caseJson = readJSON(path.join(ROOT, 'case', 'case.json'), {});
  const tImpact = impactFact?.value ?? caseJson.timeline?.t_impact ?? tObs + 0.5;
  const blockers = [];
  for (let t = tOnset; t <= tImpact - 0.05; t = r1(t + 0.1)) { const s = at(t); if (!s.visible && !blockers.includes(s.blockedBy)) blockers.push(s.blockedBy); }
  const tWrong = Math.max(0, r1(Math.floor((tLastClear - 0.5) * 2) / 2)); // v1's (wrong) observation time
  const secsBlind = r1(tImpact - tOnset);

  // Deposition moments (from the script; exhibit coordinates are used ONLY to pick the right line).
  const L = depoLines();
  const markLine = L.filter((l) => l.speaker === wb.name?.replace(/\s*\(fictional\)/i, '') || /witness/i.test(l.speaker))
    .filter((l) => l.exhibit && /mark/.test(l.exhibit.type || ''))
    .sort((a, b) => Math.hypot(a.exhibit.x_m - wb.position[0], a.exhibit.z_m - wb.position[2]) - Math.hypot(b.exhibit.x_m - wb.position[0], b.exhibit.z_m - wb.position[2]))[0];
  const spk = markLine?.speaker || 'Witness B';
  const claimLine = findLine(L, spk, /clear view|whole way|nothing was in the way/i, markLine?.t ?? -1);
  const untilLine = findLine(L, spk, /right up until|the whole time/i, claimLine?.t ?? -1) || findLine(L, spk, /the whole time/i);
  const standLine = findLine(L, spk, /^standing|stood up/i, markLine?.t ?? -1);
  const benchLine = findLine(L, spk, /bench|roof over/i);
  const crestLine = findLine(L, spk, /came over the top|over the hill/i);
  const T = (l, d) => (l ? tc(l.t) : d);
  const markTc = T(markLine, '27:04'), claimTc = T(claimLine, '27:46'), untilTc = T(untilLine, '28:17');
  const q = (l, d) => `"${(l?.text || d).replace(/"/g, "'")}"`;

  const fSight = fact(/10\.4 s|mutual sight|could have seen the other/i, 'HAR-17/02 p.29');
  const fOnly = fact(/only sight restriction/i, 'HAR-17/02 p.29–30');
  const fTurn = fact(/turning left from the westbound/i, 'HAR-17/02 p.1, p.21');
  const fBlockedReal = fact(/semitrailer blocked his view/i, 'HAR-17/02 p.1–2, p.29–30');
  const fSpeed = fact(/74 mph/i, 'HAR-17/02 p.2, p.15');
  const fNoBrake = fact(/no brake application/i, 'HAR-17/02 p.15');
  const fImpact = fact(/impact happened within the intersection/i, 'HAR-17/02 p.3, p.5');
  const sightCheck = (s, t, where) => ({ source: 'Independent check', citation: `sightline ${WIT}→${target} ${where} @ t=${t}s: ${s.visible ? 'clear' : 'blocked by ' + s.blockedBy}` });
  const pos = `(${wb.position[0]}, ${wb.position[2]}) m`;

  // ---------- world_v1: same scene, claim tested at the wrong (earlier) moment ----------
  let v1 = setWitnessField(refSrc, WIT, 'observationTime', String(tWrong));
  v1 = setWitnessField(v1, WIT, 'citation', JSON.stringify(`Deposition of ${nm} (fictional): position marked on Exhibit 4 at ${markTc}; claim 'clear view of the car the whole way in' (${claimTc}) evaluated mid-approach at t=${tWrong}s`));
  v1 = `// Generated by Argon (mock replay of cases/demo/cache/generate_world.js) from cases/demo/evidence/*.\n` +
       `// Round 1. ${WIT} at her Exhibit 4 mark (Depo ${markTc}); her "whole way in" claim (Depo ${claimTc}) is evaluated at t=${tWrong}s on the approach.\n` + v1;
  fs.writeFileSync(path.join(CACHE_DIR, 'generate_world.js'), v1);
  const tmp = path.join(D.worlds, '.seed_tmp_v1.js');
  fs.writeFileSync(tmp, v1);
  const w1 = await loadWorldFile(tmp);
  fs.unlinkSync(tmp);
  const v1Check = runAll(w1).find((c) => c.subject === WIT);
  if (!v1Check?.pass) throw new Error(`world_v1 should give ${WIT} a clear view at t=${tWrong}`);

  // ---------- critique round 1 ----------
  const short = (id) => label(id).replace(/\s*\(.*$/, '').toLowerCase();
  const blockerText = blockers.map(short).join(' and then the ');
  const crit1 = {
    round: 1,
    verdict: 'world_patched',
    summary: `World v1 tests ${nm}'s claim at t=${tWrong}s, while the car is still well up the approach. She testified she watched the car "right up until the moment it hit" (Depo ${claimTc}). ` +
      `Re-timed to the moment she describes, the turning truck stands between her marked position and the car from about t=${tOnset}s to impact. The world is patched and her claim must be re-tested.`,
    findings: [
      {
        id: 'F1', severity: 'high',
        summary: `The world checks ${nm}'s claim at the wrong moment: t=${tWrong}s, ${r1(tImpact - tWrong)} s before impact, instead of the final seconds she describes.`,
        detail: `Her claim is not limited to the approach. At Depo ${claimTc} she says ${q(claimLine, 'I had a clear view of the car the whole way in.')} and at Depo ${untilTc} ${q(untilLine, 'right up until it went under the trailer')}. ` +
          `The ${WIT} render at t=${tWrong}s shows the car clearly, but at that moment the truck has not yet crossed in front of her. The observation time must cover the last seconds before impact (t≈${tObs}s; impact t=${tImpact}s per the timeline built from ${fSight.citation}).`,
        evidence: [
          { source: 'deposition.mp4', citation: `Depo ${claimTc}` },
          { source: 'deposition.mp4', citation: `Depo ${untilTc}` },
          ntsb(fSight),
          { source: 'Render', citation: `${WIT}.png @ t=${tWrong}s (clear: truck not yet in the eastbound lanes)` },
          { source: 'Independent check', citation: `sightline ${WIT}→${target} @ t=${tWrong}s: clear (world v1)` },
        ],
        involves: [WIT, target], status: 'contradiction',
      },
      {
        id: 'F2', severity: 'high',
        summary: `From the position she marked on Exhibit 4, the ${blockerText} block her view of the car from about t=${tOnset}s until impact.`,
        detail: `In the video at Depo ${markTc} she says only ${q(markLine, 'I was over by the corner, near the shelter.')} while marking an X at about ${pos} in the world frame, in front of the store near the bench shelter; at Depo ${T(standLine, '27:24')} she says she was standing (eye 1.6 m). ` +
          `The truck turns left across both eastbound lanes (${fTurn.citation}), so its tractor and then its trailer pass between her and the westbound-facing view of the approaching car. ` +
          `The independent ray-cast agrees: clear at t=${tLastClear}s, blocked by ${blockers.join(' then ')} from t=${tOnset}s. NTSB records the same effect for the real westbound witness: the semitrailer blocked his view of the car (${fBlockedReal.citation}).`,
        evidence: [
          { source: 'deposition.mp4', citation: `Depo ${markTc} (X marked on Exhibit 4 at approx ${pos})` },
          { source: 'map.png (Exhibit 4)', citation: `X south of the eastbound shoulder, east of NE 140th Ct, at approx ${pos}` },
          ntsb(fTurn), ntsb(fBlockedReal),
          sightCheck(at(tLastClear), tLastClear, 'from marked position'),
          sightCheck(blockedAtObs, tObs, 'from marked position'),
        ],
        involves: [WIT, ...blockers, target], status: 'contradiction',
      },
      {
        id: 'F3', severity: 'low',
        summary: 'The bench shelter near her position is open-sided and does not block her view; the crest is the only fixed sight restriction on the approach.',
        detail: `She describes ${q(benchLine, 'a little bench out there with a roof over it')} (Depo ${T(benchLine, '09:04')}). The world models it as a roof on thin posts (occludes: false). NTSB: ${fOnly.text || 'the crest was the only sight restriction'}.`,
        evidence: [{ source: 'deposition.mp4', citation: `Depo ${T(benchLine, '09:04')}` }, ntsb(fOnly), { source: 'police_report.md', citation: 'p.3 (Sight distance)' }],
        involves: ['occ_shelter', 'occ_crest'], status: 'consistent',
      },
      {
        id: 'F4', severity: 'low',
        summary: "Vehicle A's motion in the world matches the record: about 74 mph, no braking, impact about 10.4 s after cresting.",
        evidence: [ntsb(fSpeed), ntsb(fNoBrake), ntsb(fSight), ntsb(fImpact)],
        involves: [target], status: 'consistent',
      },
    ],
    patch: `// Round 2 patch (Argon): ${WIT}.observationTime ${tWrong} -> ${tObs} s. Her claim covers the car "right up until the moment it hit" ` +
      `(Depo ${claimTc}, ${untilTc}); position kept at her Exhibit 4 mark (Depo ${markTc}). Truck crossing per NTSB/HAR-17/02 ${fTurn.citation.replace(/^HAR-17\/02\s*/, '')}.\n` + refSrc,
  };
  writeJSON(path.join(CACHE_DIR, 'critique_round1.json'), crit1);

  // ---------- critique round 2 ----------
  const others = world.witnesses.filter((w) => w.id !== WIT).map((w, i) => {
    const s = sightline(world, w.id, w.lookAt, w.observationTime);
    const file = fs.existsSync(path.join(D.evidence, `witness_${w.id.replace(/^wit_/, '')}.md`)) ? `witness_${w.id.replace(/^wit_/, '')}.md` : 'statement';
    return {
      id: `F${i + 3}`, severity: 'low',
      summary: `${(w.name || w.id).replace(/\s*\(fictional\)/i, '')} had a ${s.visible ? 'clear' : 'blocked'} line of sight to the ${label(w.lookAt).replace(/\s*\(.*$/, '').toLowerCase()} at t=${w.observationTime}s, consistent with the statement.`,
      evidence: [{ source: file, citation: 'written statement' }, { source: 'Independent check', citation: `sightline ${w.id}→${w.lookAt} @ t=${w.observationTime}s: ${s.visible ? 'clear' : 'blocked by ' + s.blockedBy}` }],
      involves: [w.id, w.lookAt], status: s.visible ? 'consistent' : 'contradiction',
    };
  });
  const crit2 = {
    round: 2,
    verdict: 'contradiction_found',
    summary: `With ${nm} at her Exhibit 4 mark and her claim tested at the moment she describes, the world matches the evidence. Her testimony that she watched the car "the whole way in" with "nothing in the way" is contradicted: ` +
      `the ${blockerText} of Vehicle T block her line of sight for about the last ${secsBlind} s before impact. No further patch is needed; the contradiction is in the testimony.`,
    findings: [
      {
        id: 'F1', severity: 'high',
        summary: `${nm} could not have watched the car up to impact from where she marked she was standing: Vehicle T's tractor, then its semitrailer, block her view from about t=${tOnset}s.`,
        detail: `Her eye-level render at t=${tObs}s shows the tractor filling the direction of the approaching car; the overhead render shows the truck crossing between her X and the eastbound lanes. The ray-cast agrees (blocked by ${blockedAtObs.blockedBy}, ${r1(blockedAtObs.distance)} m to the car). ` +
          `She testified ${q(claimLine, 'I had a clear view of the car the whole way in. I watched it right up until the moment it hit. Nothing was in the way.')} (Depo ${claimTc}).`,
        evidence: [
          { source: 'deposition.mp4', citation: `Depo ${markTc} (position marked on Exhibit 4)` },
          { source: 'deposition.mp4', citation: `Depo ${claimTc} (claim)` },
          { source: 'deposition.mp4', citation: `Depo ${untilTc} (repeats: until it went under the trailer)` },
          ntsb(fTurn), ntsb(fBlockedReal),
          { source: 'Render', citation: `${WIT}.png @ t=${tObs}s` },
          sightCheck(blockedAtObs, tObs, 'from marked position'),
        ],
        involves: [WIT, ...blockers, target], status: 'contradiction',
      },
      {
        id: 'F2', severity: 'medium',
        summary: `Her account of seeing the car come over the crest and down the grade is physically possible: the view from her mark is clear until about t=${tLastClear}s.`,
        evidence: [{ source: 'deposition.mp4', citation: `Depo ${T(crestLine, '14:57')}` }, ntsb(fSight), sightCheck(at(tWrong), tWrong, 'from marked position')],
        involves: [WIT, target, 'occ_crest'], status: 'consistent',
      },
      ...others,
      { id: `F${others.length + 3}`, severity: 'low', summary: 'No skid evidence to test: NTSB found no pre-impact tire marks and no braking.',
        evidence: [ntsb(fact(/no pre-collision roadway marks/i, 'HAR-17/02 p.5')), ntsb(fNoBrake)], involves: [target], status: 'unverifiable' },
    ],
    patch: null,
  };
  writeJSON(path.join(CACHE_DIR, 'critique_round2.json'), crit2);

  // ---------- new witness example: a clear-view spot west of the side road ----------
  let nwPos = null;
  for (const c of [[-15, 0, 6], [-12, 0, 5], [-20, 0, 6], [1, 0, 6.5]]) if (at(tObs, c).visible) { nwPos = c; break; }
  writeJSON(path.join(CACHE_DIR, 'new_witness_example.json'), {
    name: 'Live witness (fictional)', position: nwPos || [-15, 0, 6], eyeHeight: 1.6, lookAt: target, observationTime: tObs,
    claim: 'I was standing on the grass west of the side road and watched the car come down the hill into the truck.',
    citation: 'Live statement', confidence: 'medium',
    assumptions: `"West of the side road" resolved to the roadside south of the eastbound shoulder, about 15 m west of NE 140th Ct; observation time = the final seconds before impact (t=${tObs}s).`,
  });

  // ---------- baseline: Flash, transcript only ----------
  writeJSON(path.join(CACHE_DIR, 'baseline.json'), {
    model: process.env.BASELINE_MODEL || 'gemini-3.8-flash',
    method: 'chunk-and-summarize transcript (text only, no video)',
    chunks: Math.ceil(L.length / 40),
    summary: `${nm}'s account is consistent with the record. She says she was waiting at the store on the corner and watched the car come over the crest and into the side of the turning truck, ` +
      `and NTSB reports the crest as the only sight restriction with up to 10.4 s of visibility. Her exact position cannot be determined from the transcript.`,
    findings: [
      { id: 'B1', severity: 'low', summary: `${nm} had a clear view of the car as it approached; nothing in the record contradicts her.`,
        evidence: [{ source: 'deposition transcript', citation: `[${claimTc}] ${q(claimLine, 'I had a clear view of the car the whole way in.')}` }, ntsb(fOnly), ntsb(fSight)],
        involves: [WIT], status: 'consistent' },
      { id: 'B2', severity: 'low', summary: `${nm} marked her position on Exhibit 4, but the transcript records only "over by the corner, near the shelter"; position cannot be verified.`,
        evidence: [{ source: 'deposition transcript', citation: `[${markTc}] ${q(markLine, 'I was over by the corner, near the shelter.')}` }],
        involves: [WIT], status: 'unverifiable' },
      { id: 'B3', severity: 'low', summary: 'Witness A says the trailer blocked his view once the truck crossed; consistent with NTSB.',
        evidence: [{ source: 'witness_A.md', citation: 'statement' }, ntsb(fBlockedReal)], involves: ['wit_A'], status: 'consistent' },
    ],
    missed: 'Text-only: never sees WHERE she marked on Exhibit 4, and never builds the scene, so it cannot notice that the turning truck itself sits between her and the car in the final seconds.',
  });

  console.log(JSON.stringify({ case: D.caseId, synced, witness: WIT, markedPosition: wb.position, observationTime: tObs, v1ObservationTime: tWrong,
    lastClear: tLastClear, onset: tOnset, impact: tImpact, blockers, depo: { markTc, claimTc, untilTc }, newWitness: nwPos,
    ntsb: { sight: fSight.citation, turn: fTurn.citation, blockedReal: fBlockedReal.citation } }, null, 2));
}

main().catch((e) => { console.error('[seed_demo] FAILED:', e.message); process.exit(1); });
