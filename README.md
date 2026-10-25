# Sightline

**Test witness testimony inside a 3D reconstruction of the crash.**

Sightline is for personal-injury and insurance-defense lawyers and the reconstruction experts they work with. You upload a crash case: reports, statements, photos, diagrams, and video such as videotaped depositions or dashcam. Gemini 4 Argon reads and watches all of it in one call and extracts vehicles, occluders, timing and witness positions. A human confirms them. Argon then writes a 3D world of the crash as code, and the loop checks its own work:

1. We render the world from each witness's eyes.
2. Independent geometry and physics checks run, with no AI in them.
3. Argon watches the renders next to the evidence and patches the world.

The output is a reconstruction you can stand inside, plus findings that cite report pages and video timestamps, exportable as a PDF report.

Built at the Gemini 4 Argon SF Hackathon, Oct 25, 2026. **Track 2: More Dimensions.**

- Demo video (1 min): `TODO`
- Team: `TODO name (@github)`, `TODO name (@github)`

> **Data notice.** The demo case uses **real public crash facts**: the NTSB docket and Highway Accident Report NTSB/HAR-17/02 for accident **HWY16FH018** (US-27A near Williston, Florida, May 7, 2016), cited by page. **Witnesses A–D are fictional, and both deposition videos are simulated** (generated from scripts; no real names). The aerial photo is **USGS The National Map / NAIP** (public domain). Values NTSB did not report are labeled as inferred. Sightline is an analysis aid for experts, not evidence.

## Run it on a laptop

Requirements: Node 22 and ffmpeg. Chromium for headless rendering comes with the npm packages.

```bash
git clone https://github.com/Welddevelopment/Sightline---argon-4-hack-sf.git sightline
cd sightline
npm install
cp .env.example .env
```

Edit `.env` (never commit it):

```
GEMINI_API_KEY=your-key
SIGHTLINE_MODE=live
```

```bash
npm run dev
```

1. Open **http://localhost:5173/cases.html**.
2. Click **Demo case**, then **Start demo**.
3. Walk the step bar: Upload → Extract → Review & confirm → Reconstruct → Findings → Test a witness → Export.

The demo case is a copy of the pre-run `demo-full` case. **Extract and Reconstruct replay the recorded live run**: a badge says so, and the log prints the real timings. Everything after that runs for real on your machine: confirming (and moving) witnesses re-runs the independent checks, a new witness statement is a live Argon call, and export builds the report.

Without a key, `SIGHTLINE_MODE=mock` replays cached Argon outputs. Rendering and checks still run. A brand-new case needs live mode: create it at `/cases.html`, upload files, and press Run.

Other commands:

```bash
npm run smoke                              # check the key and models
node argon/loop.js --case <caseId>         # generate → render → check → critique → patch from the CLI
node argon/fleet.mjs demo-full             # replay the Managed Agents verification run (add --live to run it)
```

## What happens in the demo case

- **Input:** 212 pages from 17 documents of the real NTSB HWY16FH018 docket, plus two simulated depositions of fictional witnesses (Witness B 2 h 00 min, Witness D 45 min), plus the Exhibit 4 map. In total, one Argon call reads **849,454 input tokens: 704,100 video, 131,190 text, 14,164 image** (`cases/demo-full/cache/generate_world.meta.json`).
- **The visual-only fact:** at **Depo Witness B 1:54:30** Witness B marks where she stood on Exhibit 4 with a pen and says only "Right about here." Argon found and cited that moment.
- **The verdict:** from her marked position, the independent ray-cast finds her view of the car **blocked by the tractor at t = 9.8 s**, from **21 of 25** positions in a 2 m disc around her mark. Her claim is "I had a clear view of the car the whole way in… Nothing was in the way." The gaze angle to the car is 31.5° (peripheral, gaze assumed toward the impact point).
- **The loop:** the world was generated in 146.8 s and critiqued in 159.2 s. The critique confirmed the contradiction and patched two modeling artifacts (a witness's own vehicle blocking his view; a missing storefront occluder).
- **Second opinion:** 22 Managed Agents re-ran every check in separate sandboxes, and 17/17 compared metrics agreed (see below).

## Why it needs Argon

- **Long context, video-native.** One call over 849k tokens: nearly three hours of video and a 212-page docket. The decisive position is only drawn on screen, never spoken, so a transcript pipeline has nothing to read.
- **Long decode.** One Argon response wrote the whole full-case world from 839,188 input tokens: 16,798 output tokens, 952 lines, 251 s. For the small 30-minute case, one response wrote a fully hand-built world of 63,079 output tokens (4,266 lines) that loads and passes the timing and plausibility checks. In a test, one response produced 200,000 output tokens (493k characters) in about 31 minutes (`cases/demo/cache/longdecode_test/meta.json`, not used in the product).
- **Honest limit.** On our small 30-minute case, Gemini Flash given the same video and documents also found the contradiction (`status/baseline_fair.md`). The viewer's comparison card is labeled exactly: "Gemini Flash · chunk-and-summarize pipeline over the transcript · no video". The case for Argon is the scale of the full case. A one-pass world's self-correction round is still TODO (`status/onepass_full.md`); as of now, that world misplaces Witness B, and it is not used in the demo.

## Architecture

```
evidence (PDF, text, images, video)
   │  server/cases.js: upload, text extraction with page markers, ffprobe
   ▼
argon/extract.js ── Argon, whole case + videos in one context ──► extraction (vehicles, occluders, witnesses, citations)
   │
web/review.html ── human confirms / drags witnesses ──► confirmed_facts.json
   │
argon/generate_world.js ── Argon writes a world module (JS) ──► argon/validate_world.js (+ one repair call)
   │
   ├─► render/record.js (Playwright + Three.js): overhead + witness-eye stills
   ├─► checks/ (no model): ray-cast sightlines, 25-point robustness disc, gaze angle, timing, plausibility
   ▼
argon/critique.js ── Argon watches renders + depositions + check results ──► findings with citations + patched world
   │       (argon/loop.js runs generate → render → check → critique → patch)
   ├─► argon/fleet.mjs ── Argon plans → N Managed Agents re-run checks in sandboxes → Argon merges
   ▼
web/ viewer: 3D world over the USGS aerial, witness cameras, findings with citation chips that open the page or seek the video
server/report.js, scene_export.js, clips.js: PDF report, .glb/.json scene, witness-view clips
```

| Path | What it is |
|---|---|
| `server/` | Express API and static server (port 5173): cases, ingest, review, demo replay, aerial, exports |
| `argon/` | Gemini client (mock/live), prompts, extract, generate, validate, critique, new witness, loop, fleet, one-pass and long-decode runners |
| `checks/` | Independent geometry and physics checks (no model) |
| `render/` | Headless renderer |
| `web/` | Case list, review screen, 3D viewer, asset library (`web/assets/`) |
| `deposition/`, `case_full/` | Simulated-deposition generator and scripts (fictional witnesses) |
| `cases/demo-full/` | Pre-run full case: docket text, depositions, worlds, cached Argon outputs, fleet results |
| `cases/demo/` | Smaller 30-minute version of the same crash |

World modules follow a fixed contract (`SPEC.md`). Each is a plain ES module that receives Three.js and the asset library, uses meters with Y up, exposes a deterministic `setTime(t)`, and gives every object and witness a citation. The engine is case-generic: prompts, checks and viewer contain no facts about this crash.

## Managed Agents verification

`argon/fleet.mjs`: Argon (gemini-4-argon) reads the current checks and findings and plans verification jobs. Each job runs as its own Google-hosted Managed Agent: the Antigravity agent on gemini-3.8-flash, in a 10-vCPU Linux sandbox that mounts the public repo and receives the exact world file inline. The jobs cover sightline, robustness discs, gaze, perception-reaction time, speed and time what-ifs, and a CPU software render with pixel visibility. Argon then merges the returned result files against the local checks.

Live run on demo-full: **22 agents, 22 ok, 345 s wall against a 5,204 s sequential estimate (15.1×), 17/17 metrics agree, no code drift**. New finding: Witness B is clear from t = 7.8 to 9.3 s and blocked at 9.8 s; only a Vehicle A at least 20% faster clears it. The API key is never placed in a prompt, source, environment variable or sandbox. Results: `cases/demo-full/cache/fleet/`.

## Accuracy and limits

- **NTSB validation:** the reference world rebuilt from the case file matches **12 of 12** NTSB-measured facts (`status/wq_contract.md`). Argon-written worlds on the small case scored 11/12 and 10/12, and every miss is printed (`status/validation.md`).
- **Aerial:** registered to the USGS NAIP photo (0.30 m/px); the road edges line up within about 0.3 m. The side road's real skew is straightened in the model, and the overhead view shows this.
- Geometry comes from documents, not a survey. Motion is kinematic, not a physics simulation.
- A witness's position is only as good as their mark. The checks report robustness and gaze, and findings say "had line of sight", never "could see".

## What was built today

Everything in this repo was written on Oct 25, 2026 at the Gemini 4 Argon SF Hackathon:

- case ingest and the review/confirm screen
- the Argon extract → generate → render → check → critique → patch loop
- the world validator and asset library
- the independent checks
- the Managed Agents verification fleet
- the 3D viewer with the USGS aerial
- PDF, scene and clip exports
- the simulated-deposition generator and the demo cases built from the public NTSB docket

We used open-source libraries (Three.js, Express, Playwright, @sparticuz/chromium, ffmpeg, pdf-parse, mammoth, multer) and the Gemini API (`@google/genai`).
