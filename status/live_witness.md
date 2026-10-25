# Live witness beat (POST /api/cases/:id/witness), proven live

Owner files: `argon/new_witness.js`, `argon/prompts/new_witness.md`. Minimal route fixes in `server/cases.js` (witness route only).

## Measured live (gemini-4-argon, 2026-10-25, sandbox load avg 30-57 on 2 cores, memory-cgroup OOM kills going on)
| statement (live1 / demo) | Argon time | end-to-end route | placement | verdict |
|---|---|---|---|---|
| "pumping gas at the station on the north side of the highway, facing the intersection ... watched the car until it hit the truck" | 6.7 s / 8.5 s | 18 s / 28 s | [0,0,-40] / [0,0,-45], 1.6 m, t≈10 (impact). Says "gas station not modeled", confidence low | VISIBLE / VISIBLE |
| "driving west, about 100 yards from the crossover, when the truck started its turn" | 6.2 s / 9.6 s | 15 s / 23 s | [91.4,0,-28..-33] in the WB lanes, 1.2 m, **t=2.0 s, read from the moving-object timeline (start of the truck's turn)** | live1 VISIBLE (inside lane) / demo BLOCKED by semitrailer |
| "I was nearby and I saw everything" (vague) | 4.6 s / 10.1 s | 13 s / 23 s | SE corner by the store, confidence low, assumptions explain why | BLOCKED by tractor / trailer |
| "jogging on the shoulder of 140th, maybe 50 feet south of the highway" | 9.1 s | (server OOM-killed by the sandbox) | [-4.1,0,17.6] = west shoulder, 15 m south of the EB edge | - |

Argon alone: median about 5-6 s with thinkingLevel LOW (about 8.6 s at the model default), with outliers up to 26 s, which the hedged second call covers. CLI (no render): 4.5-10 s.
End-to-end time includes an 8 s render wait that always ran out here, because headless renders could not finish under the sandbox's memory pressure. On an idle machine the first run took 10 s end to end with the render included.

## What changed
- **Prompt**: small, about 4.5k tokens: world summary + **moving-object timeline** (ground centre of each moving object, about 1 s apart) + existing witnesses + facts. No evidence text, no video. New rules: unmodeled landmarks, a moving observer's position is tied to one moment, lane/eye-height defaults, and no double quotes inside strings.
- **Call**: direct `generateContent` with `responseJsonSchema`, thinkingLevel LOW (`ARGON_WITNESS_THINKING`, `default` leaves it unset). **Hedged retry**: a second call starts if the first fails or takes more than 8 s (`ARGON_WITNESS_HEDGE_MS`), and the first valid answer wins. Hard total of 22 s (`ARGON_WITNESS_TIMEOUT_MS`). The retry drops a thinking level or schema that the API rejects with a 400. Tolerant JSON salvage (this fixed a real live failure: unescaped quotes gave HTTP 500).
- **Replay cache**: every live answer goes to `cases/<id>/cache/new_witness_replay.json`, keyed by the sha256 of the normalized statement. Fallback order when the live call fails or times out: **replay → deterministic parser → error**. Mock mode replays too (replay → parser → `new_witness_example.json`), so the demo statements replay the real Argon answers offline. Pre-seeded statements: the 6 above, in both cases.
- **Deterministic parser** (`parseStatement`, exported): "N m/yards/ft <dir> of <landmark>", "N yards from <landmark>" with a travel direction, "<dir> side of the highway", "at/near/in front of <landmark>", and any landmark mentioned. Drivers snap to the lane for their direction. Time = 0.5 s before the impact fact. Tested with no network: about 0.5 s, `source: "parser"`.
- **Post-processing**: lookAt validation, a position inside a building is moved to its nearest face, time is clamped to the duration, `source` / `latencyMs` / `modelSeconds` are added to the witness.
- **server/cases.js witness route**: (1) renderUrl pointed at `/renders/live/...` and returned 404; it is now `/cases/<id>/renders/live/...`. (2) The headless render no longer holds back the verdict: the route waits at most `WITNESS_RENDER_BUDGET_MS` (8 s), then the render finishes in the background. The UI shows the witness camera live anyway.

## Caveats
- Each POST launches a headless Chromium (about 400 MB). Here, stacked renders plus other agents' jobs set off cgroup OOM kills. The 5190 server was OOM-killed once, after a successful placement. This should not happen on the demo laptop. Even so, avoid firing many witnesses back to back while a loop or report render is running.
- Port 5190 was briefly held by another agent's mock server. Testing ran on 5191, then 5190. All test servers are stopped. Test witnesses (`extra_witnesses.json`) and `renders/live` were removed from live1 and demo.
