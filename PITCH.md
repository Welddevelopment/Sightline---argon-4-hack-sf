# Sightline — Pitch Pack

Track: **More Dimensions** (Argon writes a 3D world in one pass → we render it → Argon watches the renders against the evidence → independent checks → Argon fixes the world → repeat).

One-line pitch: **Sightline turns a crash case file and hours of videotaped depositions into a 3D reconstruction you can stand inside, and tests every witness's claim from where they actually were.**

---

## 0. Pre-stage sync check (do this before every judging slot)

The script below is written for the real demo case (NTSB HWY16FH018, Williston FL, 2016). As of the last status read, parts of the cached demo still carry the older generic-intersection story (bus shelter / signal, "Depo 01:16"). Before going on stage, confirm on the laptop:

- [ ] `case/deposition_script.json` → `npm run deposition` built the full ~31-minute deposition (`deposition/out/deposition.mp4`), not the 2:42 sample.
- [ ] `node argon/seed_demo.js` re-run, so `cases/demo/` holds the Williston evidence, world and cache.
- [ ] Witness B's finding chips read **Depo 27:04 or 27:05** (map mark; the X goes down at 1624.9 s, and Argon's live run placed it at 27:05) and **Depo 27:46** (claim), and the blocker is **the truck (veh_T_tractor / veh_T_trailer)**. Say whatever the chip says. If the cache still says "signal / 01:16", either re-seed or swap those words in the script lines below (the beats stay the same).
- [ ] Credibility numbers are filled in: the robustness chip on wit_B ("blocked from N of 25"), the gaze angle, and the NTSB match panel ("X of Y"). Copy the real numbers into the 1:45 beat and into section 3 wherever it says **TODO**. Sources: `cases/demo/cache/state.json` → `checks[].robustness` / `checks[].gaze`; `cases/demo/cache/validation.json` → `matched` / `total`.
- [ ] Never say "a million tokens out". Argon's output limit is 32,768 tokens; the 1M figure is input context.
- [ ] The Flash baseline result (`cases/demo/cache/baseline.json`) is visible somewhere in the UI. If it is not wired into the viewer, open the JSON in a tab ahead of time and switch to it at 1:50.
- [ ] Laptop is in `SIGHTLINE_MODE=live` with `GEMINI_API_KEY` set, so the judge's live witness is a real Argon call. Test one statement before the slot.
- [ ] Browser tabs open in order: (1) `/cases.html`, (2) `/?case=demo`, (3) baseline (if separate). Zoom 125% so the back row can read it.

---

## 1. 3-minute live demo script (no slides)

Rule of thumb: about 140 spoken words per minute. Lines in quotes are said out loud. Indented notes are what your hands do.

### 0:00 – 0:20 · Who it's for

> "When a car crash goes to court, the case often turns on one question: could that witness actually see what they say they saw? Personal injury and insurance-defense lawyers answer it today by paying a reconstruction expert thousands of dollars and waiting weeks, while someone rewatches hours of deposition video by hand. Sightline does that first pass in minutes."

    Laptop already on /cases.html. Do not touch it yet.

### 0:20 – 0:35 · It's a real tool

> "This is a general tool, not a canned demo. A lawyer opens a case, drags in everything they have: police and NTSB reports, statements, photos, diagrams, and any video, including videotaped depositions or dashcam. Argon reads and watches all of it at once."

    Show the case list on the left. Click "New case" to show the drop zone and the step list
    (Extracting text → Uploading videos to Argon → Generating world → Rendering → Independent checks → Critique → Fix).
    Do not upload. Click back to the demo case.

### 0:35 – 0:55 · The demo case and the world Argon wrote

> "Our demo case uses the real public facts of NTSB crash HWY16FH018: a car at 74 miles an hour into a left-turning tractor-trailer in Florida. The witnesses are fictional and labeled, and the 30-minute deposition is simulated and labeled. Argon took the whole case, including that full video, and wrote this 3D world as code in one pass. Every object carries a citation."

    Open /?case=demo. Overhead camera. Scrub time once so the truck turns and the car arrives.
    Click the trailer → panel shows its label and citation (e.g. "NTSB/HAR-17/02 p.1, p.6"). Click the citation chip so it opens the source.

### 0:55 – 1:45 · The loop: Witness B

> "Here's the verification loop. Witness B testified she clearly saw the driver's head, looking down at the dash, in the last second before impact. That matters: it's the whole distraction theory."

    Open the findings panel. Point at Witness B's finding.

> "In the deposition she only says 'over by the corner, near the shelter.' But on video, 27 minutes in, she marks an X on the map exhibit. That position is never spoken. Argon found that moment on its own."

    Click the "Depo 27:05" chip (or whatever the chip says) → the deposition player seeks to the moment she marks the X. Let it play 2–3 seconds so the red mark appears.

> "Then we rendered the world from her eyes, Argon watched those renders next to the deposition, caught the mismatch, and patched the world. Now look from where she actually stood."

    Switch camera to wit_B at t ≈ 9.9 s. The truck fills the view where the car should be.

> "The truck is between her and the car. And this isn't Argon grading itself: a separate geometry check, plain ray-casting with no AI in it, confirms the line from her eye to the driver is blocked by the tractor from 1.3 seconds before impact. Contradiction, with three citations: the video mark, her claim at 27:46, and the NTSB truck dimensions."

    Point at the Independent checks panel: wit_B → veh_A: BLOCKED by veh_T_tractor.

### 1:45 – 2:00 · Credibility (why an expert won't laugh at it)

> "Before you trust that: her mark could be off a meter or two, so we test 25 spots in a two-meter circle around it. The truck blocks her from [TODO N] of 25. The car was [TODO X] degrees off her line of gaze. And this world matches [TODO X of Y] facts NTSB measured. Model, prompt and input hashes are all logged."

    Point, in order: (1) robustness chip on wit_B ("blocked from N of 25"), (2) gaze angle + "60° camera FOV" note,
    (3) NTSB match panel ("X of Y measured facts"), (4) methodology panel (model, prompt version, input hashes, kinematic label).
    Fill N / X / Y from the screen before the slot (see section 0). If a panel isn't there, say only the lines whose panel you can point at.

### 2:00 – 2:12 · Flash baseline

> "Same case through a smaller model, Gemini Flash, using the usual chunk-and-summarize of the transcript. It says her testimony is consistent. It isn't wrong about the words. It just can't see where she put the pen."

    Show baseline result: status "consistent", and the line "exact location not stated in the transcript."

### 2:12 – 2:40 · Judge's live witness

> "Now you try. Give me a witness statement: where you were standing and what you saw."

    Type the judge's words into "New statement" (or use the backup below). Press Add.

> "Argon reads the statement against the whole case, places the witness in the world, and the same independent check runs from their eyes."

    Panel shows placement + "(placed by Argon)" + assumptions; camera jumps to the new witness; verdict CLEAR or BLOCKED by <id>.

    Backup statement if the judge freezes: "I was in the westbound left-turn lane behind the truck and I saw the car's headlights on before the crash."
    (Good because NTSB says the headlights were off: it shows a physical-fact conflict, not only a sightline.)

    Fallback if the API is slow (>10 s) or fails: "While that runs, I'll place them by hand." Click "Place on map", click a spot, pick a target. The same ray-cast check gives the verdict. Say: "Placement is the only step Argon does here; the check is the same code either way."

### 2:40 – 3:00 · Close

> "This only works with Argon. In one pass it read the whole case file, watched the full 30-minute deposition, found the moment she marked the map, and wrote a to-scale world in about two minutes. Then it watched its own renders and fixed them. The expert still signs. We give them a cited first draft in minutes, not weeks."

**Word budget:** ~460 words spoken. If you are running long at 2:12, skip the live witness explanation line and go straight to typing. If you are still long, cut the methodology sentence from the credibility beat, never the robustness line.

---

## 2. Judge Q&A — the 8 hardest questions

**1. "Would a court ever admit this? Isn't this a deepfake of a crash?"**
It's not meant to be shown to a jury. It's a case-analysis tool for the lawyer and their expert, used before depositions and before hiring a full reconstruction. Every object and witness position carries a citation to the page or video timestamp it came from, the world is plain inspectable code, uncertain values are labeled as assumptions, and a human expert reviews and signs anything that goes further. It finds where to look, it doesn't replace the expert.

**2. "Isn't the AI just grading its own homework?"**
No. Argon proposes and critiques, but the verdicts that matter come from independent code with no model in it: ray-cast sightlines from each witness's eye height at the moment they describe, and physics checks (skid-length vs speed, speed along the timeline). In the demo, the ray-cast says "blocked by the tractor" on its own. If Argon and the check disagree, the finding is shown as a disagreement, not resolved by the model.

**3. "Why does this need Argon specifically?"**
Because one call does what a pipeline can't. In a single pass Argon reads the whole case file and watches the full 30-minute deposition as video: about 164k input tokens, roughly 128k of them video, inside a 1M-token input context that leaves room for more depositions, dashcam and our own renders. Nobody told it where to look: it found the moment Witness B marks the map (Depo 27:05) on its own. That position is never spoken, so a transcript pipeline misses it, which is exactly what the Flash baseline shows. It then wrote a complete to-scale world module in 129 seconds, and in the critique round it watched its own renders next to the deposition and patched the world. (If asked about output size: the world is a compact code module, well inside Argon's 32,768-token output limit. The long part is the input, not the output.)

**4. "What's real and what's synthetic, and why?"**
Physical facts are real and public: NTSB report HAR-17/02 for crash HWY16FH018 (road geometry, speeds, truck dimensions, timing), cited by page. Witnesses A, B and C are fictional, and the deposition is a simulated video we generated today, both labeled on screen. We did that because real depositions are private and real witnesses deserve privacy. Modeling choices NTSB didn't specify (e.g. trailer bed height, truck turn speed) are marked "assumed" in the case file.

**5. "Who pays for this?"**
Personal injury firms and insurance-defense firms, and the reconstruction experts they hire. A paid forensic crash animation runs roughly $2k to $20k+ and takes weeks, and most cases never get one because the stakes don't justify it. Per-case pricing (a few hundred dollars) for the first pass, with a firm subscription for volume. Insurers' claims and litigation teams are the second buyer.

**6. "What did you build today?"**
All of it, between 10:30 and 5:00: the case ingest and upload flow, the text and video pipeline, the prompts and loop (generate → render → critique → patch), the headless renderer, the independent checks, the viewer and findings panel, the simulated deposition video, and the demo case file built from the NTSB report. We used open-source libraries (Three.js, Express, Playwright, ffmpeg) and the Gemini API. No prior code. The repo history shows it.

**7. "How accurate is it?"**
It's as accurate as the evidence and it tells you where it's guessing. Geometry is boxes at real dimensions, not a photoreal scan. Positions come from documents and marks, so a witness's location is only as good as their mark. The sightline check is exact for the model it's given; the model's uncertainty is in the inputs, which are cited and labeled. Treat its output as "this testimony deserves a closer look," with the reason attached, not as a final answer. On this case the world matches **TODO X of Y** facts NTSB measured (see section 3); the expert-level follow-ups are in section 3.

**8. "What happens with a brand-new case?"**
Nothing in the engine knows about this crash. Prompts, checks, loop, server and viewer contain no case-specific facts. You create a case, upload PDFs, text, images and videos, press Run, and Argon extracts the vehicles, occluders, timing and witness positions (including ones shown only on video) and writes that case's world. A new case needs a live run (minutes, mostly video upload and long generation); the demo case is cached so judging doesn't depend on Wi-Fi. If you want, we'll start one on a case you name and show the result at the end.

Spare answers if time allows:
- *"Why not a dashboard?"* — The product is the reconstruction and the loop; the side panel just lists what the loop found.
- *"What if a witness was moving?"* — Witness position is a position at the observation time; Witness A in the demo is a moving driver.
- *"Managed Agents?"* — Natural next step: render and check runs fanned out in parallel sandboxes while Argon plans and critiques.

---

## 3. What a skeptical expert would ask — and our answer

For the reconstruction expert, the trial lawyer or the judge who has seen a paid crash animation. One or two lines each; say the line, then point at the panel if there is one. Items marked **TODO** need the real number from the cache before you go on stage (section 0).

**"No qualified expert signs this."**
Right, and it isn't meant to be signed. Sightline is the analysis a lawyer runs before deciding to spend $5–20k; its output is a cited draft for their expert, not trial evidence.

**"Is it reproducible?"**
Yes. Every world version records the model, the prompt version (hash), and a hash of every input file (`worlds/world_vN.provenance.json`). The checks are deterministic code, so any run can be replayed and gives the same verdicts.

**"What about confidentiality and privilege?"**
Roadmap: enterprise deployment, no-training and no-retention terms with the model provider, per-matter access control, and an audit log of who ran what on which evidence.

**"Where's the event data recorder?"**
An EDR report is just another evidence type: Argon reads it and cites it like any report page (roadmap: a structured EDR parser so speeds and brake timing feed the checks directly).

**"Your accuracy is unvalidated."**
We validate against public NTSB investigations with known answers: **TODO X of Y** measured facts match on this case (from `cases/demo/cache/validation.json`, not yet generated). Next, a benchmark across dozens of NTSB cases.

**"The geometry comes from documents, not a survey."**
Every dimension is cited to a page; anything inferred rather than stated is labeled and drawn in amber. Roadmap: aerial imagery and scene scans as inputs.

**"That's kinematic, not physics."**
Correct, and it says so on screen. Motion is fitted to cited evidence and checked for physical plausibility (flags anything over 1 g, teleports, impossible speeds). Roadmap: export to crash-physics tools for the expert's own simulation.

**"Her map mark is only good to a meter or two."**
So we don't test one point. We ray-cast from 25 positions in a 2 m disc around her mark, with eye height ±0.1 m: the truck blocks her from **TODO N of 25** (from `checks[].robustness` in `cases/demo/cache/state.json`, not yet generated).

**"Line of sight doesn't mean she'd notice."**
Agreed. We report the angle between her gaze and the target, flag peripheral vision past 30°, and state the 60° camera field of view on every witness render. The finding says "had line of sight", never "could see". That's more honest than most paid animations.

**"It was dusk / there was glare."**
Lighting objects (headlights, signals, streetlights) are cited from the evidence like everything else. Sun-angle glare check is on the roadmap.

---

## 4. 1-minute submission video — shot list

Screen-record at 1920×1080, browser at 125% zoom, cursor highlighted. Voice-over can reuse lines from the script. Burn a small caption in the corner: "Real NTSB facts · fictional witnesses · simulated deposition."

| # | Time | Screen | Voice-over / caption |
|---|---|---|---|
| 1 | 0:00–0:06 | Title card text on black: "Sightline — test witness testimony in a 3D reconstruction. Built today at the Gemini 4 Argon SF Hackathon." | (caption only) |
| 2 | 0:06–0:12 | `/cases.html`: case list, click "New case", show the drop zone with a PDF + MP4 dragged in, show the step list. | "Upload any crash case: reports, photos, depositions, dashcam." |
| 3 | 0:12–0:20 | Run log of a live run streaming steps (Uploading videos to Argon → Generating world → Rendering → Checks → Critique). Speed up 4× if long. | "Argon reads and watches it all, and writes a 3D world in one pass." |
| 4 | 0:20–0:27 | `/?case=demo` overhead, scrub time so the truck turns and the car arrives; click the trailer, show the citation. | "Every object is cited to the NTSB report." |
| 5 | 0:27–0:37 | Findings panel → click the map-mark chip ("Depo 27:05" / "27:04") → video jumps to the red X being drawn on the map. | "Witness B marks where she stood. She never says it out loud." |
| 6 | 0:37–0:45 | Camera to wit_B at t≈9.9 s: truck blocks the car. Checks panel: BLOCKED by veh_T_tractor. | "From that spot, the truck blocks her view. An independent ray-cast check confirms." |
| 7 | 0:45–0:50 | Baseline result: Flash says "consistent". | "A transcript-only model calls it consistent." |
| 8 | 0:50–0:57 | Type a new statement → witness placed → verdict. | "Add any witness statement and test it." |
| 9 | 0:57–1:00 | End card: repo URL, team names, "Real public crash facts (NTSB HWY16FH018), fictional witnesses, simulated deposition." | (caption only) |

Upload unlisted to YouTube (or Loom), check it plays logged out, paste the link in the submission and the README.

---

## 5. Submission checklist

- [ ] Repo is **public** on GitHub; `.env` is not committed (`git log -p | grep -i "AIza"` returns nothing).
- [ ] First commit is from today; commit history shows the build across the day (commit at least every hour from here).
- [ ] `README.md` at repo root (draft written; fill in the placeholders).
- [ ] `.env.example` present, no key in it.
- [ ] 1-minute video link (unlisted, plays logged out) in the submission form and in the README.
- [ ] Team members (names + GitHub handles) in the form and the README.
- [ ] "What was built today" statement in the README and the form (copy the README section).
- [ ] Data notice in the README and on screen in the app and video (real NTSB facts, fictional witnesses, simulated deposition).
- [ ] Track named: More Dimensions.
- [ ] Optional: add a LICENSE (MIT) file.
- [ ] Large generated files: keep repo small. Commit `cases/demo/` cache, worlds and stills needed for mock mode; leave `deposition/out/frames/` and big MP4s out (or under ~50 MB total) and document how to rebuild them.
- [ ] Fresh-clone test: `git clone` into a new folder → `npm install` → `npm run dev` → `/?case=demo` loads in mock mode.

### Copy for the "what was built today" form field

> Everything in this repo was written today (Oct 25, 2026, 10:30 AM–5:00 PM) at the Gemini 4 Argon SF Hackathon: case ingest and upload, the Argon prompts and generate → render → critique → patch loop, the headless renderer, the independent geometry/physics checks, the 3D viewer, the simulated deposition video generator, and the demo case built from public NTSB report HAR-17/02. We used open-source libraries (Three.js, Express, Playwright, ffmpeg, pdf-parse, mammoth) and the Gemini API. No prior project code.

---

## 6. README draft

The full draft is in `README.md` at the repo root.
