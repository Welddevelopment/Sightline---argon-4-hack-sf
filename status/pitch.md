# PITCH slice status — credibility pass (edits only PITCH.md, README.md, this file)

## Done
- Removed every "1M output / long output" claim. PITCH Q&A #3, the 2:40 close, and a new README "Why it needs Argon" section now say: 1M is INPUT context; gemini-4-argon outputTokenLimit = 32,768. Argon reads the whole case file + watches the full 30-min deposition in one pass (~164k input tokens, ~128k video), found the map mark at Depo 27:05 on its own, wrote the to-scale world module in 129 s, then watched its renders and fixed them.
- New section "What a skeptical expert would ask — and our answer" (PITCH §3, README section before Limits): expert sign-off, reproducibility, privilege, EDR, accuracy/validation, survey vs documents, kinematic vs physics, map-mark ±1–2 m robustness, line of sight vs noticing (gaze angle, 60° FOV), night/glare.
- 3-min script re-timed: Witness B 0:55–1:45, NEW credibility beat 1:45–2:00 (robustness chip → gaze angle → NTSB match panel → methodology panel), Flash 2:00–2:12, live witness 2:12–2:40, close 2:40–3:00.
- Fixed timestamps to the current cache: map mark 27:04.9 (chip may read 27:04 or 27:05), claim 27:46 (was 27:45). Pricing: paid forensic animation ~$2k–$20k+, weeks.
- Pre-stage checklist (PITCH §0) now includes filling the credibility numbers and "never say a million tokens out".
- Later sections renumbered: video §4, checklist §5, README draft §6.

## TODO (blocked on other slices)
- "X of Y" NTSB facts matched: fill from `cases/demo/cache/validation.json` (`matched`/`total`) — not present yet. Marked **TODO X of Y** in PITCH §1 (1:45 beat), §2 Q7, §3, README.
- "blocked from N of 25": fill from `cases/demo/cache/state.json` `checks[].robustness.blocked` — not present yet. Marked **TODO N of 25** in PITCH §1 and §3, README.
- Gaze angle "X degrees" in the 1:45 beat: fill from `checks[].gaze.offAxisDeg` (wit_B → veh_A).
