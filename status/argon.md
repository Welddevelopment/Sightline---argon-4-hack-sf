# ARGON slice status — DONE (mock runs end-to-end here; live path verified against a stubbed SDK)

Case-generic (PRODUCT RULE): every entry point takes caseId; inputs from cases/<caseId>/{evidence,text}; outputs to cases/<caseId>/{worlds,renders,cache}. Prompts contain no case facts.

## Exports (for APP / INGEST)
- argon/loop.js: `runLoop({caseId='demo', mode, onProgress, maxRounds=3, render=true, skipGenerate=false, fps=10})` -> `{caseId, world:'/cases/<id>/worlds/world_vN.js', findings, checks, loopLog, verdict}`.
  onProgress({caseId, round, step: evidence|generate|render|checks|critique|patch|done|error, message, ...extras}). Mock replay emits events too (400 ms apart; LOOP_MOCK_DELAY_MS).
  Writes cases/<id>/cache/{loop_log.json (array of rounds), state.json}. For caseId 'demo' it also mirrors them to repo cache/ for the legacy /api/state.
- argon/new_witness.js: `newWitness(statement, world, caseId | {caseId})` -> witness entry with no id (server assigns wit_live_N). Mock: cached example placement + the user's words as the claim.
- argon/generate_world.js `generateWorld({caseId, version})`; argon/critique.js `critique({caseId, round, worldFile, checks, renders})`; argon/baseline.js `runBaseline({caseId})`.
- argon/case.js: caseDirs, listEvidence, loadCaseText, evidenceMediaParts (EVERY video goes through the Files API, images inline, PDFs without extracted text sent natively), evidenceSummary.
- argon/client.js: callArgon({name, model, parts, json, maxOutputTokens, ext, cacheDir}), uploadVideo(path) (cached in cache/files.json, waits for ACTIVE), getAI().

## Mock data (demo case)
`node argon/seed_demo.js` (demo-only, not engine) syncs case/* + deposition/out/* into cases/demo/{evidence,text} and writes cases/demo/cache/:
generate_world.js (reference world with Witness B at her SPOKEN spot -> clear view), critique_round1.json (catches it from the Depo map mark 01:16-01:36; patch = B at her MARKED spot), critique_round2.json (contradiction_found, patch null), new_witness_example.json, baseline.json (Flash, text-only: "consistent").
Re-run seed_demo.js when the CASE slice lands case/* or the reference world changes.

## Tests
- `SIGHTLINE_SKIP_RENDER=1 node argon/loop.js --case demo` -> world_v1 (4/4 pass) -> patch -> world_v2 (wit_B blocked by occ_shelter) -> contradiction_found.
- With rendering: `LOOP_FPS=5 node argon/loop.js --case demo` (~3.5 min here) renders into cases/demo/renders/world_v{1,2}/.
- `node argon/test_live_stub.js`: LIVE code path (upload->ACTIVE polling, streaming, JSON parsing, cache/meta writes, patch apply) against a fake SDK. PASS.

## Live (laptop)
cp .env.example .env (set GEMINI_API_KEY); npm run smoke; SIGHTLINE_MODE=live node argon/loop.js --case demo
