# Fair baseline: identical inputs, one call per model (case demo, live run 2026-10-25)

**Headline: YES. gemini-3.8-flash catches the full Witness B chain when it gets the same inputs as Argon.** It also catches it when chunked, and even with text only (no video, one call). On case demo, the claim "only Argon can do this" does not hold up.

## Setup (argon/baseline_fair.js, prompt argon/prompts/baseline_fair.md)
- Task, no hints: "For each witness, determine where they were and whether their claimed observations are physically possible given the evidence; cite timestamps and pages." JSON answer: per witness, position + claims + yes/no/uncertain.
- Single call: byte-identical parts for both models (parts digest 5e2fbff1dab5c8af). That is the prompt, the full case text, the 30-min deposition via the Files API (the same `evidenceMediaParts` the Argon pipeline uses, including its standard "watch the visuals… people may mark positions on exhibits" line), map.png, and the same config (maxOutputTokens 16384, thinkingBudget 8192, JSON). Both ran in parallel.
- Chunked (Flash): 4 × 10-min video segments + 2 document chunks summarized in parallel, then 1 merge call over the summaries + map.png.
- Text-only control (Flash): same prompt + full case text (transcript included) + map.png, no video, one call.

## Results (Witness B)
| run | mark located | claim found | concluded truck/trailer blocks view | latency | tokens (prompt / out / thinking) |
|---|---|---|---|---|---|
| gemini-4-argon, single call | cites Depo 27:04; "SE corner, just west of bench shelter" | yes (27:46, 28:17) | **yes**: "tractor and semitrailer box directly between her and the car" | 45.4 s | 159,450 / 3,145 / 436 |
| gemini-3.8-flash, single call | cites Depo 27:05; "SE corner, eastbound shoulder near the shelter" | yes (27:46, 28:17) | **yes**: "solid trailer body directly between Witness B and Vehicle A" | 63.9 s (+1 network retry) | 147,039 / 2,622 / 3,880 |
| Flash chunked (6 chunks + merge) | yes, explicitly: segment summary says "Depo 27:05–27:13 marks a red circled X on the eastbound shoulder/corner east of NE 140th Ct in front of the store/bench shelter" | yes (27:47) | **yes** | 358.5 s wall (includes ffmpeg + uploads) | 156,440 / 10,978 / 17,853 summed |
| Flash text only, no video | cites Depo 27:04/27:14 (transcript lines) | yes | **yes** | 50.9 s | 28,060 / 2,439 / 2,862 |

Video tokens: Argon 127,942, Flash 118,932 for the same file. The tokenizers differ, but the input is the same.

## How to read this
- The rule check (`score()` in baseline_fair.js) gives claim = yes and blocked = yes in all 4 runs. The strict `mark` rule (her position text itself mentions the X/mark) is false in all 4 final answers. Every run cites ~27:04 for her position, but the deposition transcript already has `[27:04] "over by the corner, near the shelter"` and `[26:14]` identifies the store at the lower right (SE) of the exhibit. Those two lines plus `[24:09]` "trailer stretched across the eastbound lanes" are enough to place her east of the trailer. **The on-screen mark is not needed to reach the contradiction on this case.**
- Flash does see the mark: its chunked video summary reports the red X at 27:05 on its own.
- The old `argon/baseline.js` result ("consistent", "position cannot be determined") came from its weak setup: 40-line transcript chunks summarized, and the merge never saw the transcript. Flash's ability was not the limit.
- Rules applied by me plus my own reading of each answer. No model graded another. Raw answers: `cases/demo/cache/baseline_fair.json` (single + chunked, with chunk summaries) and `cases/demo/cache/baseline_fair_textonly.json`.

## Implications for the pitch
- Drop "only Argon can do this" for case demo. Flash single call, Flash chunked and Flash text-only all reach the same verdict. Argon was faster (45 s vs 64 s) with fewer thinking tokens. That is a difference of degree, not a capability gap.
- If there is a capability gap, it has to come from a case where (1) the decisive fact is visual-only, meaning the spoken words are vague or contradict the mark, and (2) the input is near the 1M limit (demo-full). That run has moved to a separate session. Rerun with `SIGHTLINE_MODE=live node argon/baseline_fair.js --case demo-full` and add a `RUBRICS['demo-full']` entry (witness regex + mark/claim windows).

## Rerun
`set -a; . ./.env; set +a; SIGHTLINE_MODE=live NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt node argon/baseline_fair.js --case demo [--models a,b] [--no-chunked|--only-chunked]`. Video segments go to $BASELINE_FAIR_TMP or the OS temp dir. Side effect: `uploadVideo` records uploads in cache/files.json, as all live runs do.
