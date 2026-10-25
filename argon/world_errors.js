// argon/world_errors.js — "is the WORLD wrong?" (as opposed to findings about what a witness could see).
// The correction loop keeps going while this returns errors; each error is handed to Argon's next critique round.
//
//   const { errors, validation } = await worldErrors({ caseId, worldFile, world, checks });
//
// Error sources (all automatic, no human in the loop):
//   contract     — the world breaks the module contract (argon/world_io.js validateWorld)
//   plausibility — a vehicle moves impossibly (checks.js plausibility: >1 g pre-impact, jumps)
//   known_fact   — the world disagrees with a measurable known fact:
//                  cases/<id>/validation_facts.json (published report, e.g. NTSB) and
//                  confirmed_facts.json from the review step (lawyer-confirmed witness marks).
// A witness being BLOCKED/CLEAR is a finding, never an error, so sight-line results are not included.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './client.js';
import { validateWorld as contractProblems } from './world_io.js';

const MARK_TOLERANCE_M = 1.5;
const norm = (id) => String(id || '').toLowerCase().replace(/^wit_/, '').replace(/^witness_/, '').replace(/[^a-z0-9]/g, '');

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

function confirmedFile(caseId) {
  for (const p of [path.join(ROOT, 'cases', caseId, 'confirmed_facts.json'), path.join(ROOT, 'cases', caseId, 'cache', 'confirmed_facts.json')]) if (fs.existsSync(p)) return p;
  return null;
}

// Lawyer-confirmed witness marks: a STATIONARY witness must stand within MARK_TOLERANCE_M of the confirmed mark.
function confirmedMarkErrors(caseId, world) {
  const f = confirmedFile(caseId); if (!f) return [];
  const c = readJson(f); const out = [];
  for (const cw of c?.witnesses || []) {
    const m = cw.markedPosition; if (!Array.isArray(m) || m.length < 2) continue;
    const w = (world.witnesses || []).find((x) => norm(x.id) === norm(cw.id)); if (!w || w.vehicleId) continue; // drivers ride their vehicle
    if (/driver|driving|pickup|in (his|her|a) (car|truck|vehicle)/i.test(`${cw.name || ''} ${w.name || ''} ${w.label || ''}`)) continue; // a driver's mark is a moving point, not a standing spot
    const [mx, mz] = m.length === 3 ? [m[0], m[2]] : m;
    const d = Math.hypot(w.position[0] - mx, w.position[2] - mz);
    if (d > MARK_TOLERANCE_M) out.push({ kind: 'known_fact', id: `mark_${w.id}`, message: `${w.id} stands ${d.toFixed(1)} m from the confirmed mark [${mx}, ${mz}] (tolerance ${MARK_TOLERANCE_M} m)`, expected: [mx, mz], actual: [w.position[0], w.position[2]], citation: cw.positionCitation || 'confirmed_facts.json' });
  }
  return out;
}

export async function worldErrors({ caseId, worldFile, world, checks = [] }) {
  const errors = [];
  for (const p of contractProblems(world)) errors.push({ kind: 'contract', id: 'contract', message: p });
  for (const c of checks) if (c.check === 'plausibility' && !c.pass) errors.push({ kind: 'plausibility', id: `plausibility_${c.subject}`, message: String(c.summary || c.detail || c.message || 'implausible motion'), citation: c.citation || null });
  let validation = null;
  try {
    const { validateWorld } = await import('./validate_world.mjs');
    validation = await validateWorld(caseId, worldFile, { write: false });
    for (const it of validation?.items || []) if (!it.pass) errors.push({ kind: 'known_fact', id: it.id, message: `${it.label}: expected ${JSON.stringify(it.expected)} ±${JSON.stringify(it.tolerance)} ${it.unit}, world gives ${JSON.stringify(it.actual)}${it.note ? ` (${it.note})` : ''}`, expected: it.expected, actual: it.actual, citation: it.citation });
  } catch (e) { errors.push({ kind: 'contract', id: 'validation_error', message: `known-fact validation could not run: ${e.message}` }); }
  errors.push(...confirmedMarkErrors(caseId, world));
  return { errors, validation };
}

export function formatErrorsForArgon(errors) {
  if (!errors.length) return '';
  return 'WORLD ERRORS FOUND BY THE INDEPENDENT CHECKS (these are errors in the world, not findings; fix every one, citing evidence, and return the corrected COMPLETE module as `patch`. Do not change anything that is not needed to fix them, and do not move any witness unless an error names it):\n' +
    errors.map((e, i) => `${i + 1}. [${e.kind}] ${e.id}: ${e.message}${e.citation ? ` — source: ${e.citation}` : ''}`).join('\n');
}
