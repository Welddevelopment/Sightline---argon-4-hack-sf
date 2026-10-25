// argon/loop.js — generate → render → checks → critique → patch → repeat (max 3 rounds).
// Lib: import { runLoop } from './argon/loop.js'; await runLoop({ caseId, mode, onProgress })
// CLI: node argon/loop.js [--case demo] [--rounds 3] [--no-render] [--skip-generate]
// Outputs: cases/<caseId>/worlds/world_v*.js, cases/<caseId>/renders/world_v*/, cases/<caseId>/cache/{loop_log,state}.json
// Env: SIGHTLINE_MODE=mock|live, SIGHTLINE_SKIP_RENDER=1, LOOP_FPS (default 10), LOOP_MAX_ROUNDS (default 3)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, writeJSON, mode as envMode } from './client.js';
import { caseDirs, defaultCaseId, evidenceSummary } from './case.js';
import { loadWorldFile, writeWorldVersion, validateWorld, worldUrlFromFile } from './world_io.js';

const rel = (f) => '/' + path.relative(ROOT, f).split(path.sep).join('/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function renderWorld(worldFile, { fps, onProgress, round, rendersDir }) {
  const outDir = path.join(rendersDir, path.basename(worldFile, '.js'));
  // Reuse renders that are newer than the world file (keeps mock replay fast).
  if (fs.existsSync(outDir)) {
    const files = fs.readdirSync(outDir).filter((f) => /\.(mp4|png)$/.test(f)).map((f) => path.join(outDir, f));
    const wm = fs.statSync(worldFile).mtimeMs;
    if (files.length && files.every((f) => fs.statSync(f).mtimeMs >= wm) && process.env.LOOP_FORCE_RENDER !== '1') {
      onProgress?.({ round, step: 'render', message: `Reusing ${files.length} existing renders in ${rel(outDir)}` });
      return { files, videos: files.filter((f) => f.endsWith('.mp4')), stills: files.filter((f) => f.endsWith('.png')), reused: true };
    }
  }
  const { renderViews } = await import('../render/record.js');
  return renderViews({ world: worldUrlFromFile(worldFile), views: 'all', fps, outDir });
}

/**
 * runLoop({ caseId, mode, onProgress, maxRounds, render, skipGenerate }) → { world, findings, checks, loopLog }
 * onProgress({ round, step, message, ... }) with step ∈ generate|render|checks|critique|patch|done|error
 */
export async function runLoop({ caseId = defaultCaseId(), mode, onProgress, maxRounds, render, skipGenerate = false, fps } = {}) {
  if (mode) process.env.SIGHTLINE_MODE = mode;
  mode = envMode();
  const d = caseDirs(caseId);
  maxRounds = Number(maxRounds || process.env.LOOP_MAX_ROUNDS || 3);
  render = render ?? process.env.SIGHTLINE_SKIP_RENDER !== '1';
  fps = Number(fps || process.env.LOOP_FPS || 10);
  const replayDelay = mode === 'mock' ? Number(process.env.LOOP_MOCK_DELAY_MS ?? 400) : 0;
  const emit = async (ev) => {
    const e = { caseId, mode, at: new Date().toISOString(), ...ev };
    console.log(`[loop] r${e.round ?? '-'} ${e.step}: ${e.message}`);
    try { onProgress?.(e); } catch {}
    if (replayDelay) await sleep(replayDelay);
  };

  const { runAll } = await import('../checks/checks.js');
  const { critique } = await import('./critique.js');
  const loopLog = [];

  // ---- Round 1 world ----
  let worldFile = path.join(d.worlds, 'world_v1.js');
  const inv = evidenceSummary(caseId);
  await emit({ round: 1, step: 'evidence', message: `Case ${caseId}: ${inv.text.length} text file(s), ${inv.videos.length} video(s), ${inv.images.length} image(s)`, evidence: inv });
  if (!skipGenerate || !fs.existsSync(worldFile)) {
    await emit({ round: 1, step: 'generate', message: mode === 'live'
      ? 'Argon is reading every document and watching every video to write the world module…'
      : `Replaying cached Argon world generation (cases/${caseId}/cache/generate_world.js)…` });
    const { generateWorld } = await import('./generate_world.js');
    const g = await generateWorld({ caseId, version: 1 });
    worldFile = g.file;
    await emit({ round: 1, step: 'generate', message: `World module written: ${g.url} (${g.source.split('\n').length} lines)` +
      (g.problems.length ? ` — contract problems: ${g.problems.slice(0, 3).join('; ')}` : ''), world: g.url, problems: g.problems });
  }

  let checks = [], findings = [], lastVerdict = null;
  for (let round = 1; round <= maxRounds; round++) {
    const worldUrl = rel(worldFile);
    const entry = { round, world: worldUrl, startedAt: new Date().toISOString() };

    // load + validate
    let world;
    try { world = await loadWorldFile(worldFile); } catch (e) {
      await emit({ round, step: 'error', message: `World ${worldUrl} failed to load: ${e.message}` });
      entry.error = e.message; loopLog.push(entry); break;
    }
    entry.contractProblems = validateWorld(world);

    // render
    entry.renders = { videos: [], stills: [] };
    if (render) {
      await emit({ round, step: 'render', message: `Rendering ${worldUrl} from overhead + ${(world.witnesses || []).length} witness viewpoints…` });
      try {
        const r = await renderWorld(worldFile, { fps, onProgress: (e) => emit(e), round, rendersDir: d.renders });
        entry.renders = { videos: (r.videos || []).map(rel), stills: (r.stills || []).map(rel) };
        await emit({ round, step: 'render', message: `Rendered ${entry.renders.videos.length} videos, ${entry.renders.stills.length} stills`, renders: entry.renders });
      } catch (e) {
        entry.renderError = e.message.split('\n')[0];
        await emit({ round, step: 'render', message: `Render skipped: ${entry.renderError}` });
      }
    }

    // checks
    checks = runAll(world);
    entry.checks = checks;
    const fails = checks.filter((c) => !c.pass);
    await emit({ round, step: 'checks', message: `Independent checks: ${checks.length - fails.length}/${checks.length} pass` +
      (fails.length ? ` — ${fails.map((c) => `${c.subject}: ${c.blockedBy ? 'blocked by ' + c.blockedBy : 'fail'}`).join('; ')}` : ''), checks });

    // critique
    await emit({ round, step: 'critique', message: mode === 'live'
      ? 'Argon is watching the witness-view renders against the evidence videos and documents…'
      : `Replaying cached Argon critique (cases/${caseId}/cache/critique_round${round}.json)…` });
    let c;
    try {
      c = await critique({ caseId, round, worldFile, checks, renders: entry.renders.videos.length || entry.renders.stills.length
        ? { files: [...entry.renders.videos, ...entry.renders.stills].map((u) => path.join(ROOT, u)) } : null });
    } catch (e) {
      await emit({ round, step: 'error', message: `Critique failed: ${e.message}` });
      entry.error = e.message; loopLog.push(entry); break;
    }
    findings = c.findings;
    lastVerdict = c.verdict;
    entry.critique = { verdict: c.verdict, summary: c.summary, findings: c.findings, patched: !!c.patch };
    entry.findings = c.findings;
    await emit({ round, step: 'critique', message: `${c.verdict}: ${c.summary}`, findings: c.findings, verdict: c.verdict });

    if (!c.patch) { entry.finishedAt = new Date().toISOString(); loopLog.push(entry); break; }

    // patch
    const w = await writeWorldVersion(round + 1, c.patch, d.worlds);
    entry.patch = { world: w.url, problems: w.problems };
    entry.finishedAt = new Date().toISOString();
    loopLog.push(entry);
    await emit({ round, step: 'patch', message: `Argon patched the world → ${w.url}` + (w.problems.length ? ` (contract problems: ${w.problems.slice(0, 3).join('; ')})` : ''), world: w.url });
    if (w.problems.some((p) => p.startsWith('module failed'))) { await emit({ round, step: 'error', message: 'Patched module does not load; keeping previous world' }); break; }
    worldFile = w.file;
    if (round === maxRounds) {
      // Re-check the final patched world so state reflects it.
      checks = runAll(await loadWorldFile(worldFile));
    }
  }

  const finalWorld = rel(worldFile);
  const state = { caseId, world: finalWorld, findings, checks, loopLog, verdict: lastVerdict, mode, updatedAt: new Date().toISOString() };
  writeJSON(path.join(d.cache, 'loop_log.json'), loopLog);
  writeJSON(path.join(d.cache, 'state.json'), state);
  if (caseId === 'demo' && process.env.SIGHTLINE_NO_LEGACY_MIRROR !== '1') {
    // Legacy single-case endpoints (/api/state, /api/loop) read the repo-level cache/.
    writeJSON(path.join(ROOT, 'cache', 'loop_log.json'), loopLog);
    writeJSON(path.join(ROOT, 'cache', 'state.json'), state);
  }
  await emit({ step: 'done', round: loopLog.length, message: `Loop finished after ${loopLog.length} round(s). Final world ${finalWorld}. ${findings.filter((f) => f.status === 'contradiction').length} contradiction(s).` });
  return state;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : undefined; };
  try {
    process.env.LOOP_MOCK_DELAY_MS ??= '0';
    const s = await runLoop({ caseId: arg('case'), maxRounds: arg('rounds'), render: process.argv.includes('--no-render') ? false : undefined,
      skipGenerate: process.argv.includes('--skip-generate') });
    console.log(JSON.stringify({ world: s.world, verdict: s.verdict,
      findings: s.findings.map((f) => `${f.id} [${f.status}] ${f.summary}`),
      checks: s.checks.map((c) => `${c.check} ${c.subject}: ${c.pass ? 'PASS' : 'FAIL'}${c.blockedBy ? ' (blocked by ' + c.blockedBy + ')' : ''}`) }, null, 2));
  } catch (e) { console.error('[loop] FAILED:', e.stack || e.message); process.exit(1); }
}
