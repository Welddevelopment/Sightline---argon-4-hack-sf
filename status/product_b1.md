# B1 — Step 3 "Review and confirm" (Argon extraction) — DONE

Files: argon/extract.js, argon/prompts/extract.md, server/review.js (+1 mount line in server/server.js),
one Edit in argon/generate_world.js (adds confirmed_facts.json as "AUTHORITATIVE CONFIRMED FACTS (human-reviewed)" when present).
Shapes: SPEC.md "## REVIEW & CONFIRM (12:10)".

- `runExtraction(caseId, {mode})`: mock → serves cases/<id>/cache/extraction.json; live → Argon (all text + deposition video + map, JSON out,
  thinking capped by client.js budget 8192, maxOutputTokens 24576) → raw in cache/extraction_raw.*, normalized cache/extraction.json + extraction.meta.json.
- CLI: `node argon/extract.js --case live1 [--print-prompt]`.
- Endpoints: GET /api/cases/:id/extraction · POST /api/cases/:id/extraction/run (mock sync; live background, poll GET) · POST /api/cases/:id/confirm (`{clear:true}` removes it). Smoke-tested on a temp server.
- Skip path: no confirmed_facts.json → generate_world unchanged (none exist now).

## Live run (case live1, gemini-4-argon)
- 83.2 s; promptTokens 160,665 (video 127,942 · text 31,631 · image 1,092); output 7,259; thoughts not reported; finish STOP.
- 33 facts (30 cited, 3 inferred), 5 vehicles, 7 objects, 3 witnesses; notes flag Witness B spoken-vs-marked discrepancy.
- Witness B map mark FOUND at "Depo 27:05" (ground truth: mark appears 27:04.9) → markedPosition [2, 6] m vs truth [7.5, 6.5] (≈5.5 m off in x; z right).
  Truck rest mark: [0, 35] @ Depo 26:38 vs truth [0, 40].
- Copied to cases/demo/cache/extraction.json (+meta, caseId "demo", sourceCase "live1") for mock mode.
