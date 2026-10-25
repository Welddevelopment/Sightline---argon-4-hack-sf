# Sightline: Pitch Pack

**Track 2: More Dimensions.** Argon reads the whole case and writes a 3D world as code. We render it from each witness's eyes and run independent checks, then Argon watches the renders against the evidence and patches the world.

**One-line pitch:** Sightline turns a crash case file and hours of videotaped depositions into a 3D reconstruction you can stand inside, and tests every witness's claim from where they actually stood.

Every number in this file comes from a file on disk. The source is given next to each one; section 6 lists them all. Labels that must stay on screen and in speech: **real NTSB facts · fictional witnesses · simulated depositions**.

---

## 0. Pre-stage check (before every judging slot)

- [ ] Laptop: `.env` has `GEMINI_API_KEY` and `SIGHTLINE_MODE=live`. Run `npm run dev`, then open `http://localhost:5173/cases.html` at 125% zoom.
- [ ] Click **Start demo** once to rehearse. It clones `demo-full` into a new `demo-<hex>` case: "Demo case — Williston FL crash (pre-loaded)". The Extract and Reconstruct steps **replay the recorded live run** in a few seconds each. The step bar shows the badge "Replay of live run". Say so on stage (the script does).
- [ ] The banner should read **CASE 849k tokens · 2 h 45 min video · 212 pages · read in one pass by gemini-4-argon [MEASURED]** (from `cases/demo-full/argon_only.json`).
- [ ] Witness B's finding should read: **BLOCKED by veh_T_tractor at t = 9.8 s**, robustness **21 of 25** (tractor 11, shelter 10), gaze **31.5° (assumed, peripheral)**. Source: `cases/demo-full/cache/state.json`.
- [ ] **Rehearse the Witness B drag on the review screen, and use the same drag on stage.** Confirm re-runs the independent checks locally on her confirmed position. The result depends on where you drop her. Robustness at t = 9.8 s is 25/25 blocked within 1 m of the world's position, 21/25 at 2 m. A 6.7 m drag flips her to VISIBLE (`status/demo_flow.md`). Say whatever the panel says. Both lines are in the script.
- [ ] The live new-witness call works. Test one statement first. The demo-full clone has **no** replay cache for new statements: if the API fails, the deterministic parser places the witness instead, and the panel says so.
- [ ] Optional tab: `cases/demo-full/cache/fleet/report.md` (Managed Agents verification). It is **not** in the viewer UI.
- [ ] **One-pass world (world_v3).** As of the last status read, that world puts Witness B at (7.5, 12). That is 5.5 m from her pen mark, so the check there reads CLEAR 0/25. Its self-correction round has not run yet (TODO, section 3). **Do not show world_v3 on stage.** The demo flow uses the loop world `world_v2.js`.

---

## 1. 3-minute stage demo (live, no slides)

About 140 spoken words per minute, roughly 430 words in total. Lines in quotes are spoken. Notes in italics are what's on screen and what your hands do.

### 0:00–0:15 · Who it's for
> "When a crash goes to court, the case often turns on one question: could that witness actually see what they say they saw? Today a lawyer pays a reconstruction expert thousands of dollars, waits weeks, and someone rewatches hours of deposition video. Sightline does the first pass in minutes."

*On screen: `/cases.html`, case list. Hands off.*

### 0:15–0:35 · Cases → Demo case → Upload
> "This is our demo case. The crash is real: NTSB case HWY16FH018, a car at 74 miles an hour into a left-turning tractor-trailer in Florida. We loaded 212 pages of the real NTSB docket plus two depositions, two hours forty-five minutes of video. The witnesses and depositions are fictional and labeled."

*Click **Start demo**. Step bar: 1 Upload is active. Point at the banner: "849k tokens · 2 h 45 min video · 212 pages · MEASURED". Point at the evidence list: two deposition MP4s, the docket documents, Exhibit 4.*

### 0:35–0:50 · Extract
> "Argon read and watched all of it in one call: 849 thousand input tokens, 704 thousand of them video. This replays our recorded live run, which took under four minutes."

*Click **Extract**. The log streams and ends with "live run: 224 s · 857k tokens · replayed".*

### 0:50–1:20 · Review & confirm: drag Witness B
> "Witness B swears: 'I had a clear view of the car the whole way in. Nothing was in the way.' Where was she standing? In two hours of testimony she never says. At one hour fifty-four she takes the pen, marks the exhibit, and says only: 'Right about here.' Argon found that pen mark on its own and cites it."

*Step 3: the review screen. Click Witness B's citation **Depo Witness B 1:54:30**. The deposition frame with her pen mark appears.*

> "A human stays in charge. I can accept her position or move it, and the independent checks re-run on whatever I confirm."

*Drag Witness B by the amount you rehearsed. Type a reviewer name. Click **Confirm and build**.*

### 1:20–1:35 · Reconstruct
> "Now Argon writes the whole world as code, with every object cited. We render it from each witness's eyes, plain geometry checks run, and Argon watches its own renders against the depositions and patches the world."

*Step 4 streams: generate → render → checks → critique → patch. It prints "live run: 147 s · 856k tokens · replayed". Then the 3D world with the aerial photo under it.*

### 1:35–2:15 · Findings
> "From her mark, at 9.8 seconds, the tractor is between her and the car. That verdict is not Argon grading itself. It's a ray-cast with no AI in it."

*Step 5. Open the first contradiction: deposition key frame (her pen mark) next to the witness-eye render (truck fills the view). Checks chip: wit_B → veh_A BLOCKED by veh_T_tractor, t = 9.8 s.*

If you kept the rehearsed small drag and the panel still says BLOCKED:
> "Her mark could be off a meter or two, so we test 25 spots around it. The car is blocked from 21 of 25. Then 22 Managed Agents re-ran every check in their own sandboxes, and all 17 compared numbers agreed. They also found she could see the car until about half a second before her stated moment."

If the panel says VISIBLE from the confirmed position:
> "And that's the point. Move her and the answer changes. The finding is only as good as her mark, and the tool shows it instead of hiding it."

*Point at the robustness chip ("21 of 25") and the gaze note (31.5°, peripheral, assumed). Optional: switch to the fleet report tab for two seconds.*

### 2:15–2:40 · Live new witness
> "Your turn. Give me a witness: where you were and what you saw."

*Step 6 "Test a witness". Type the judge's words and press Add. The panel shows the placement, "(placed by Argon)", the assumptions and the verdict. The camera jumps to the new witness.*

*Backup statement: "I was in the westbound left-turn lane behind the truck and I saw the car's headlights on." NTSB says the headlights were off, so this tests a physical fact as well as the sightline.*

*If the call is slow (more than 10 s): "While that runs, the check is the same code either way." The parser fallback places the witness, and the panel labels the source.*

### 2:40–3:00 · Export and close
> "Export gives the expert a cited report. Why only Argon? One call read 212 pages and watched nearly three hours of video, and found a position that is only drawn, never spoken. The expert still signs. We hand them a cited first draft in minutes, not weeks."

*Step 7: click **Export report**. The PDF opens; every page carries "Analysis draft for expert review, not evidence" and "SIMULATED DEPOSITION / FICTIONAL WITNESSES".*

**If you run long:** at 2:15, skip straight to typing the judge's statement. Never cut the "replays our recorded live run" sentence or the fictional/simulated labels.

---

## 2. Why only Argon: the numbers

All numbers are measured. The file is given after each one.

**Input: the whole case in one call (demo-full).**
- **849,454 input tokens** in one `generate_world` call: **704,100 video + 131,190 text + 14,164 image** (`cases/demo-full/cache/generate_world.meta.json`).
- What that holds: **2 h 45 min** of simulated depositions of fictional witnesses (Witness B 2:00:00, Witness D 45:00), **212 pages** from 17 documents of the **real NTSB HWY16FH018 docket**, and Exhibit 4 (`argon_only.json`, `docket_manifest.json`).
- Extraction: 847,083 prompt tokens, 224.2 s (`extraction.meta.json`). Critique: 869,939 input tokens (704,100 video), 159.2 s, verdict `world_patched` (`critique_round1.meta.json`).

**The visual-only fact.** At **Depo Witness B 1:54:30** she marks Exhibit 4 with a pen and says only "Right about here." (`case_full/transcripts/deposition_witness_B_transcript.txt`). The position exists only on screen. Argon cited that moment and placed her at (8, 9) m in world v1. The scripted mark is at (7.5, 6.5) m, about 2.5 m away, which is inside the robustness test radius. The independent ray-cast then found her view blocked by the tractor at t = 9.8 s (`state.json`, `loop_log.json`).

**The loop (v1 → v2).** The world was generated in **146.8 s**, plus one 62.8 s text-only repair after the validator flagged an error. The critique ran **159.2 s**. It confirmed the Witness B contradiction and patched two modeling artifacts: Witness A's own pickup was blocking his view, and the store front was missing the cooler and posters that block Witness D (`critique_round1.json`).

**Long decode: one response writes a whole world (World B, one pass).** One Interactions-API call read **839,188 input tokens** (133,504 text + 705,684 video). The exhibit and the USGS aerial were sent as still-frame video parts. It wrote a complete world placing our saved asset library: **16,798 output tokens, 952 lines, 251 s, natural stop**. One repair call (7/7 edits) made it validator-VALID (`cases/demo-full/worlds/onepass/onepass.meta.json`, `status/onepass_full.md`). Honest caveat: this world placed Witness B 5.5 m from her mark, and the check there reads CLEAR 0/25. Its self-correction round is TODO (section 3).

**Long decode at scale.**
- One Argon response produced **200,000 output tokens** (493,259 chars, 11,180 lines) in **about 31 min** (1,878 s). It stopped at the 200k cap we set. That was a test prompt (a Three.js procedural library), not used in the product (`cases/demo/cache/longdecode_test/meta.json`).
- For the small 30-minute case, one response wrote a full hand-built world (no asset library): **63,079 output tokens, 4,266 lines**, natural stop, 593 s, from 183,703 input tokens (127,942 video). It loads, and all 8 independent checks run: timing and plausibility pass; Witness A clear, Witness B blocked by the trailer (17/25), Witness C clear (`cases/demo/worlds/long/world_long.meta.json`, `attempt2/checks.json`). It reused world_v2's witnesses and timing, so this is a visual-detail rewrite, not a new reconstruction.

**What we do NOT claim.** On the small 30-minute case, Gemini Flash given the same full video and documents also reached the Witness B contradiction (`status/baseline_fair.md`). So we don't say Flash can't do it. The case for Argon is scale. One call over 849k tokens (nearly three hours of video plus a 212-page docket) finds a fact that is only drawn and never spoken. And one response can write a 63k-token world, with 200k tokens shown.

---

## 3. Self-correction round on the one-pass world (TODO)

`status/onepass_full.md` as last read (14:25 local): world_v3 is valid. Checks after the observer-vehicle fix: A blocked by veh_truck_tractor (t = 7), **B clear 0/25** (Argon read her mark as (7.5, 12); scripted (7.5, 6.5)), C clear 0/25, D blocked by the store. The critique round was **waiting for the render lock** to make its input stills.

> **TODO, fill in when `status/onepass_full.md` reports the critique result:** did Argon's critique (watching the renders plus the 1:54:30 frame) move Witness B back to her mark? New B verdict and robustness, seconds, tokens. Until then, do not mention a one-pass self-correction on stage.

---

## 4. 1-minute submission video (click-through)

Screen-record at 1920×1080, 125% zoom, cursor highlighted. Burn a corner caption for the whole video: **"Real NTSB facts · fictional witnesses · simulated depositions · steps 2 & 4 replay a recorded live run."**

| # | Time | Screen | Voice-over |
|---|---|---|---|
| 1 | 0:00–0:05 | Title: "Sightline: test witness testimony inside a 3D reconstruction." | (caption only) |
| 2 | 0:05–0:12 | `/cases.html` → **Start demo**. Banner: 849k tokens · 2 h 45 min video · 212 pages. | "A real NTSB crash docket, 212 pages, plus nearly three hours of deposition video." |
| 3 | 0:12–0:18 | **Extract**: the log ends "live run: 224 s · 857k tokens · replayed". | "Argon reads and watches all of it in one call." |
| 4 | 0:18–0:28 | **Review**: Witness B citation "Depo Witness B 1:54:30" → frame of her pen mark. Drag her, then Confirm. | "She marks where she stood and says only 'Right about here.' Argon found it." |
| 5 | 0:28–0:34 | **Reconstruct** stream → 3D world over the USGS aerial. | "Argon writes the 3D world as code, renders it, checks it and fixes it." |
| 6 | 0:34–0:44 | **Findings**: depo frame + witness-eye render; BLOCKED by veh_T_tractor; "21 of 25". | "From her mark, the truck blocks her view. A plain ray-cast confirms it, and 22 Managed Agents reproduced it." |
| 7 | 0:44–0:52 | **Test a witness**: type a statement → placed → verdict. | "Add any witness and test it." |
| 8 | 0:52–0:57 | **Export report** → PDF. | "A cited draft for the expert." |
| 9 | 0:57–1:00 | End card: repo URL, team names (TODO), data labels, "Aerial: USGS The National Map (NAIP)". | (caption only) |

---

## 5. Judge Q&A

**1. "Would a court admit this? Isn't it a deepfake of a crash?"**
It isn't meant for a jury. It's a case-analysis tool for the lawyer and their expert. Every object and witness position cites the page or video timestamp it came from. The world is inspectable code, inferred values are labeled, and the exported report says "analysis draft for expert review, not evidence" on every page.

**2. "Isn't the AI grading its own homework?"**
No. Argon proposes and critiques. The verdicts come from code with no model in it: ray-cast sightlines from eye height at the moment described, a 25-position robustness disc, gaze angle, and speed and plausibility checks. Then a separate fleet of 22 Managed Agents re-ran them in isolated sandboxes from the public repo. 17/17 compared metrics agreed with our local checks, with no code drift (`cases/demo-full/cache/fleet/report.md`).

**3. "Why does this need Argon specifically?"**
Section 2 has the numbers. In short: one call over 849k input tokens (704k of it video) found a position that is only drawn, never spoken (Depo Witness B 1:54:30, "Right about here."). Long decode writes whole worlds in one response: 16.8k tokens from the 839k-token full case, 63k for the small case, and 200k tokens in one response in a test.

**4. "Would Flash catch it?"**
Our on-screen comparison on the small case is exactly this: "Gemini Flash · chunk-and-summarize pipeline over the transcript · no video". It returned "consistent". Honest answer to the follow-up: on that 30-minute case, Flash given the same full video and documents in one call also found it (`status/baseline_fair.md`). The small case doesn't separate the models. The 849k-token case is where reading everything in one pass matters. We haven't run a Flash comparison on it.

**5. "What's real and what's simulated?"**
Real: the NTSB docket and report for HWY16FH018 (geometry, speeds, truck dimensions, timing), cited by page, and the USGS NAIP aerial photo. Simulated: Witnesses A–D are fictional, and both depositions are generated videos, labeled on screen and in the report. Real depositions are private, and witnesses deserve privacy. The demo's Extract and Reconstruct steps replay a recorded live run. Confirm, the re-run checks, a new witness and export run live.

**6. "Who pays?"**
Personal-injury and insurance-defense firms, and the reconstruction experts they hire. A forensic crash animation runs roughly $2k–$20k+ and takes weeks, so most cases never get one. Pricing: a few hundred dollars per case for the first pass, or a firm subscription. Insurers' claims and litigation teams are the second buyer.

**7. "How accurate is it?"**
As accurate as the evidence, and it tells you where it's guessing. Our reference world, rebuilt from the case file, matches **12 of 12** facts NTSB measured (speed 74 mph, no braking, crest at about 345 m, combination length 21.8 m, and so on) (`status/wq_contract.md`). Argon's own worlds on the small case scored 11/12 and 10/12, and the misses are shown (`status/validation.md`).

**8. "What happens with a brand-new case?"**
Nothing in the engine knows this crash. You create a case, upload PDFs, text, images and video, and press Run. Argon extracts vehicles, occluders, timing and witness positions, a human confirms them, and Argon writes the world. A new case needs a live run: minutes, mostly video upload and generation.

**9. "What did the Managed Agents actually do?"**
Argon planned 22 verification jobs in 16 s. 22 Google-hosted Managed Agents (the Antigravity agent on gemini-3.8-flash, each in its own 10-vCPU Linux sandbox) ran them in parallel. Each mounted the public repo, got the exact world file inline, and ran one check: sightline, robustness, gaze, perception-reaction time, speed and time what-ifs, or a CPU render with pixel visibility. The fleet took **345 s wall against a 5,204 s sequential estimate (15.1×)**. Argon merged the results: **17/17 agree**. New: Witness B is clear from t = 7.8 to 9.3 s and blocked at 9.8 s, and only a Vehicle A at least 20% faster would clear that view. That strengthens the finding and narrows it. The API key never enters a sandbox (`status/fleet.md`).

---

## 6. What a skeptical expert would ask, and our answer

**"No qualified expert signs this."** Right. It's the analysis a lawyer runs before deciding to spend $5–20k: a cited draft for their expert, not trial evidence.

**"Is it reproducible?"** Every world version records model, prompt hash and input-file hashes (`cases/<id>/worlds/world_vN.provenance.json`). The checks are deterministic. The Managed Agents fleet reproduced them on 22 separate machines, and `codeDrift` reported no difference between the sandbox and local checks code.

**"Confidentiality and privilege?"** Roadmap: enterprise deployment, no-training and no-retention terms, per-matter access control, audit log. The fleet already keeps the API key out of every sandbox.

**"Where's the EDR?"** An EDR report is another evidence type that Argon reads and cites. A structured EDR parser that feeds the checks is on the roadmap.

**"Your accuracy is unvalidated."** We validate against the public NTSB findings: the rebuilt reference world matches 12 of 12 measured facts. The scorer prints every miss in other worlds (e.g. 11/12 when the car path starts 1.6 m short of the crest). Next step: a benchmark across many NTSB cases.

**"The geometry comes from documents, not a survey."** Every dimension is cited, and inferred values are labeled. The world is registered to a real USGS NAIP aerial photo (0.30 m/px), and the carriageways, lane dashes and median line up within about 0.3 m along the approach. The side road's real 19° skew is straightened in the model, and the overhead view shows that openly (`status/aerial.md`).

**"That's kinematic, not physics."** Correct, and it says so on screen. Motion is fitted to cited evidence and checked for plausibility (flags anything over 1 g, teleports, impossible speeds). The reference world peaks at 0.2 g.

**"Her map mark is only good to a meter or two."** So we don't test one point. 25 positions in a 2 m disc, eye height ±0.1 m: **blocked from 21 of 25** (tractor 11, shelter 10). The fleet's wider sweep: 25/25 within 1 m, 21/25 at 2 m, 17/25 even 5–8 m out. We say it the way the tool says it: the result depends on her exact position.

**"Line of sight doesn't mean she'd notice."** Agreed. We report the angle between her gaze and the target: 31.5°, flagged peripheral, with the gaze assumed toward the point of impact. We also state the 60° camera field of view. Findings say "had line of sight", never "could see".

**"Timing: maybe she saw it earlier."** She could have. The what-if jobs show her view clear from 7.8 to 9.3 s and blocked from 9.8 s to impact (10.43 s). Her claim is "right up until the moment it hit". That last half-second is the part the geometry contradicts.

**"It was dusk / there was glare."** Lighting is cited (daylight, clear, HAR-17/02). The world's environment uses a solar model for 2016-05-07 16:36:12 EDT at the site. An automatic glare flag per sightline is roadmap.

---

## 7. Sources for every number

| Claim | File |
|---|---|
| 849,454 input tokens (704,100 video / 131,190 text / 14,164 image), 146.8 s | `cases/demo-full/cache/generate_world.meta.json` |
| 2 h 45 min video, 212 pages, mark cited as Depo Witness B 1:54:30 | `cases/demo-full/argon_only.json`, `docket_manifest.json` |
| "Right about here." at 01:54:30 | `case_full/transcripts/deposition_witness_B_transcript.txt` |
| Extraction 224.2 s / 847,083 tokens; critique 159.2 s / 869,939 tokens | `cases/demo-full/cache/extraction.meta.json`, `critique_round1.meta.json` |
| B blocked by veh_T_tractor t = 9.8 s, 21/25, gaze 31.5° | `cases/demo-full/cache/state.json` |
| One-pass world: 839,188 in / 16,798 out / 251 s / 952 lines | `cases/demo-full/worlds/onepass/onepass.meta.json`, `status/onepass_full.md` |
| 200,000 output tokens, 493,259 chars, ~31 min | `cases/demo/cache/longdecode_test/meta.json` |
| 63,079 output tokens, 4,266 lines, checks | `cases/demo/worlds/long/world_long.meta.json`, `attempt2/checks.json` |
| Fleet: 22 agents, 345 s vs 5,204 s, 17/17 | `status/fleet.md`, `cases/demo-full/cache/fleet/run.json`, `report.md` |
| NTSB validation 12/12 (reference world) | `status/wq_contract.md` |
| Aerial: USGS NAIP 0.30 m/px, public domain | `status/aerial.md` |
| Flash baseline wording | `status/argon_only_ui.md`, `cases/demo/cache/baseline.json` |

---

## 8. Submission checklist

- [ ] Repo public; `.env` never committed; `.env.example` has no key.
- [ ] README: team names (TODO), video link (TODO), data notice.
- [ ] `SUBMISSION.md` text pasted into the form; track = **Track 2 "More Dimensions"**; Managed Agents paragraph included.
- [ ] 1-minute video uploaded unlisted and plays logged out.
- [ ] Fill section 3 (one-pass self-correction) or leave it out of every claim.
