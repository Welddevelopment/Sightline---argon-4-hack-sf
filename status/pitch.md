# PITCH slice status — credibility pass (edits only PITCH.md, README.md, this file)

## Done
- Removed every "1M output / long output" claim. PITCH Q&A #3, the 2:40 close, and a new README "Why it needs Argon" section now say: 1M is INPUT context; gemini-4-argon outputTokenLimit = 32,768. Argon reads the whole case file + watches the full 30-min deposition in one pass (~164k input tokens, ~128k video), found the map mark at Depo 27:05 on its own, wrote the to-scale world module in 129 s, then watched its renders and fixed them.
- New section "What a skeptical expert would ask — and our answer" (PITCH §3, README section before Limits): expert sign-off, reproducibility, privilege, EDR, accuracy/validation, survey vs documents, kinematic vs physics, map-mark ±1–2 m robustness, line of sight vs noticing (gaze angle, 60° FOV), night/glare.
- 3-min script re-timed: Witness B 0:55–1:45, NEW credibility beat 1:45–2:00 (robustness chip → gaze angle → NTSB match panel → methodology panel), Flash 2:00–2:12, live witness 2:12–2:40, close 2:40–3:00.
- Fixed timestamps to the current cache: map mark 27:04.9 (chip may read 27:04 or 27:05), claim 27:46 (was 27:45). Pricing: paid forensic animation ~$2k–$20k+, weeks.
- Pre-stage checklist (PITCH §0) now includes filling the credibility numbers and "never say a million tokens out".
- Later sections renumbered: video §4, checklist §5, README draft §6.

## Watch
- Gaze line in the 1:45 beat says "28 degrees off her assumed line of gaze" (wit_B offAxisDeg 28.4, assumed toward mark_impact). Re-check if checks change.
- If validation.json or robustness numbers change, update PITCH §0/§1/§2 Q7/§3 and README.

## Filled from cache (state.json 12:00, validation.json 12:02)
- NTSB validation: 11 of 12 matched. The miss is crest_to_impact_time (expected 10.4 s): the car path starts 343.4 m before impact, short of the 345 m needed. Stated openly in PITCH §3 and README. A WORLD/CASE fix (start veh_A path a few m earlier) would make it 12/12; then update the numbers.
- wit_B robustness: blocked 25/25 (tractor 14, trailer 11), verdict robust; gaze 28.4° (assumed). Filled in PITCH §0, §1, §3 and README.
- Witness B claim wording in script + README updated to the cached claim ("clear view of the car the whole way in ... nothing was in the way"); the old "driver's head / looking at the dash" line was stale.

## Resume pass (after 12:02)
- 1:45 credibility beat trimmed to ~35 spoken words (15 s): robustness 25/25, NTSB 11 of 12 with the miss shown, hashes logged; gaze 28° is pointed at, not read.
- Live-run facts added: critique 77.5 s found the contradiction, ray-cast agreed (semitrailer, t=9.8 s) in PITCH Q2 and README "Why it needs Argon"; Q3 notes Argon said 27:05 vs scripted 27:04; robustness 25/25 also holds on the live world.
- Gaze angles (B 28.4°, A 2.4°, C 17.3°, assumed toward impact) in PITCH §3 / README.
- Lighting/glare item rewritten: cited lighting (HAR-17/02 p.5) + sun position computed by hand for 4:36 p.m. EDT 2016-05-07 at Williston (~45° elevation, az 265°) -> no glare. NOTE: no automatic sun/glare check exists in code; it is stated as roadmap. If one gets built, update the wording.
- Re-verified: no "1M output" claims; 1M is described only as input context, 32,768 as the output limit.
