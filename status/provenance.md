# provenance — status

Owner: provenance slice. Contract: SPEC.md "CREDIBILITY v1" → `cases/<id>/worlds/world_vN.provenance.json`.

## Done
- `argon/provenance.js`: `writeProvenance({caseId, worldPath, mode, model, promptFile, inputs, meta, parentWorld, thinkingBudget, maxOutputTokens, createdAt?, outPath?})`,
  `callProvenance({caseId, call, parentWorld})`, `backfillCase(caseId, opts)`, CLI `node argon/provenance.js --backfill <id> [--mode] [--max-output-tokens] [--thinking-budget] [--force]`.
  - promptVersion = first 12 hex of sha256(argon/prompts/<name>.md); inputs = exactly the evidence files the call sends (text/*, raw text uploads without extraction, videos, images, native docs), case-relative, sha256 + bytes; outputSha256 = world file.
  - usage maps Gemini usageMetadata → {promptTokens, outputTokens, thoughtsTokens} (thoughts = total − prompt − output when the API omits it).
  - thinkingBudget mirrors client.js (ARGON_THINKING_LEVEL → null; maxOutputTokens ≥ 16384 → ARGON_THINKING_BUDGET||8192); null/null in mock (no call made).
- Hooks (only the world-write lines): `world_io.writeWorldVersion(n, src, dir, prov?)` writes provenance when `prov` given; `generate_world.js` (v1) and `loop.js` (patch vN+1, parentWorld = previous world) pass it; `critique.js` returns `call` descriptor.
- Backfilled: cases/demo/worlds/world_v{1,2} (mode seeded, no metas exist); cases/live1/worlds/world_v1 (live, meta usage/seconds/STOP, thinkingBudget 8192, maxOutputTokens 65536); cases/live1/attempt1/provenance.json (live, MAX_TOKENS, maxOutputTokens 32768, thinkingBudget null — pre-budget run; 24,671 thoughts tokens).
  - maxOutputTokens for live1 verified by recomputing client.js call hash from today's prompt+inputs: 32768 → 750510a150e1f2a5 (attempt1), 65536 → 13831b570f36f8da (v1). Both match the metas, so the recorded input sha256s are what was sent.
- Verified: `node argon/test_live_stub.js` PASS; mock loop on scratch demo copy writes v1/v2 provenance (outputSha256 matches file); live-stub variant writes usage/thinking/maxOutputTokens. Scratch cases deleted.

## Notes
- A mock replay of demo overwrites the seeded provenance with mode "mock" (truthful: it was replayed).
- Inputs list evidence only (not render videos/stills sent to critique).
