# Sightline: Hackathon Submission

**Track:** Track 2: "More Dimensions"
**Repo:** https://github.com/Welddevelopment/Sightline---argon-4-hack-sf
**Video (1 min):** TODO
**Team:** TODO

## Project description (~250 words)

When a crash goes to court, the case often turns on one question: could that witness actually see what they say they saw? Today, answering it means hiring a reconstruction expert, waiting weeks, and paying someone to rewatch hours of deposition video.

Sightline does the first pass in minutes. A lawyer uploads the case file: reports, exhibits and videotaped depositions. Gemini 4 Argon reads and watches all of it in one call. Our demo is 212 pages of the real NTSB docket for crash HWY16FH018 plus 2 h 45 min of simulated depositions, **849,454 input tokens, 704,100 of them video**. Argon extracts every vehicle, occluder and witness position with citations, and a human confirms them. Argon then writes the 3D world as code. We render it from each witness's eyes, and independent ray-cast and physics checks run with no AI in them. Argon watches the renders next to the depositions and patches the world.

The decisive fact is visual-only. Witness B swears nothing blocked her view. At 1:54:30 into her deposition she marks her position on a map with a pen and says only "Right about here." Argon found that moment. Argon measured that mark. From there, the bench shelter and the turning tractor block her view of the car at 9.9 s, from all 25 test positions around her mark. Then 23 Google-hosted Managed Agents reproduced all 9 checks in separate sandboxes.

The rendered views hold up next to commercial forensic animations (side-by-side stills in the README). Long decode lets one Argon response write an entire world: 16,798 tokens from the full 839k-token case, and 63,079 tokens for a hand-built world of the small case. The output is a cited PDF report for the expert. It's an analysis draft, not evidence.

## Managed Agents

Argon doesn't grade its own homework. After the loop, Argon (gemini-4-argon) reads the checks and findings and plans an audit: **23 verification jobs**. Each job runs as its own Google-hosted Managed Agent: the Antigravity agent on gemini-3.8-flash, in a 10-vCPU Linux sandbox that mounts our public repo and receives the exact world file inline. The jobs cover ray-cast sightlines, 25-position robustness discs, gaze angles, perception-reaction time, speed and time what-if sweeps, and a CPU software render with pixel-level visibility. All 23 ran in parallel: **492 s wall against an estimated 8,135 s sequential (16.5×)**, with no load on our machine. Argon merged the returned result files against our local checks: **all 9 check verdicts reproduced, with no code drift**. Witness B stays blocked within 0.5–3 m of her mark, across t = 7.9–11.9 s, and with Vehicle A's speed scaled ×0.7–1.3. The agents also flagged a real modelling sensitivity: their pixel renders count the driving witnesses' own cabs as blocking. The API key never enters a sandbox.

## What's real and what's simulated

**Real**
- NTSB docket and report HAR-17/02 for HWY16FH018 (Williston FL, May 7, 2016): 212 pages from 17 documents used, cited by page.
- USGS The National Map / NAIP aerial photo (public domain), registered to the world within about 0.3 m.
- All Argon calls and token counts. They are recorded in `cases/demo-full/cache/*.meta.json`, and the measurements come from those runs.
- The independent checks, the 23-agent Managed Agents run, and the NTSB validation (the demo world, World B v4, matches 8 of 12 NTSB measurements, with every miss listed; a reference world rebuilt from the smaller case matches 12/12).
- Long-decode results: 200,000 output tokens in one response (a test, not used in the product), and the 63,079-token and 16,798-token worlds.

**Simulated / labeled**
- Witnesses A–D are **fictional**, and both deposition videos (2 h 00 min and 45 min) are **simulated**, generated from scripts.
- In the stage demo, the Extract and Reconstruct steps **replay the recorded live run** (labeled "Replay of live run", with real timings: 224 s extraction, 251 s one-pass world, 326 s correction). Review/confirm, the re-run checks, new-witness testing and export run live.
- Values NTSB didn't report are labeled as inferred. Motion is kinematic, not a physics simulation.
- Comparison card on the small case: "Gemini Flash · chunk-and-summarize pipeline over the transcript · no video". On that small case, Flash with the full video also found the contradiction. We don't claim otherwise.
- The one-pass world first misplaced Witness B by 5.5 m; Argon's correction round, given the pen-mark frame, fixed it (world_v4). One mechanical edit after Argon (driverEye array access) is recorded in the world's provenance. Later rounds that fixed NTSB misses but introduced impossible accelerations were rejected by the checks.
