# PITCH slice status — final pitch/submission pass (edits only PITCH.md, README.md, SUBMISSION.md, this file)

## Done (all numbers read from files on disk)
- PITCH.md rewritten for the stage flow (cases → Start demo → Upload → Extract → Review & confirm (drag B) → Reconstruct → Findings → new witness → Export) on the demo-full clone; 3-min script with on-screen notes; "Why only Argon" numbers; 1-min click-through shot list; Q&A (incl. Managed Agents) + skeptical-expert answers; sources table.
- README.md: what it is, laptop run (git clone / npm install / .env GEMINI_API_KEY + SIGHTLINE_MODE=live / npm run dev → /cases.html → Demo case → Start demo), architecture, Managed Agents, data labels (real NTSB, fictional witnesses, simulated depositions, USGS NAIP credit), team TODO.
- SUBMISSION.md (new): ~250-word description, Track 2 "More Dimensions", Managed Agents paragraph, real vs simulated list.

## Key numbers used
- demo-full generate_world: 849,454 in (704,100 video / 131,190 text / 14,164 image), 146.8 s; extraction 224.2 s / 847,083; critique 159.2 s / 869,939, world_patched. 2 h 45 min video (B 7200 s + D 2700 s), 212 pages / 17 docs.
- Mark: Depo Witness B 1:54:30, "Right about here." (transcript line 1191). Argon placed B at (8,9) in v1 vs scripted (7.5,6.5).
- state.json (world_v2): B blocked by veh_T_tractor t=9.8 s, robustness 21/25 (tractor 11, shelter 10), gaze 31.5° peripheral (assumed). Old 25/25 / 28° numbers were the small demo case and are removed.
- One-pass world_v3: 839,188 in, 16,798 out, 251 s, 952 lines; 1 repair → VALID; checks B CLEAR 0/25 (mark read as (7.5,12)).
- Long decode test: 200,000 out, 493,259 chars, ~1,878 s (capped, test prompt, not product). world_long: 63,079 out, 4,266 lines, 8/8 checks run (B blocked 17/25; timing+plausibility pass); reused v2 witnesses/timing.
- Fleet: 22 agents, 345 s vs 5,204 s (15.1×), 17/17 agree, no code drift; B clear 7.8–9.3 s, blocked 9.8 s, ≥20% faster A to clear.
- NTSB 12/12 = reference world (wq_contract.md); Argon worlds 11/12, 10/12 (validation.md).

## Open / TODO
- One-pass self-correction round: status/onepass_full.md last said "waiting for render lock". PITCH §3 has a marked TODO; nothing claims it.
- Witness B drag on the review screen: the confirmed-position re-check depends on drop spot (6.7 m drag → VISIBLE). Script has both lines; rehearse.
- Flash card exists only for case `demo` (cache/baseline.json); demo-full clone has none, so Flash is Q&A only.
- demo-full clone has no new_witness replay cache → live call or parser fallback.
- Team names, video link: TODO.
