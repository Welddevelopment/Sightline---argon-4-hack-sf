# Sightline

**Test witness testimony inside a 3D reconstruction of the crash.**

Sightline is for personal injury and insurance-defense lawyers and the reconstruction experts they work with. You upload a crash case (police and NTSB reports, statements, photos, diagrams, and video such as videotaped depositions, dashcam or bodycam). Gemini 4 Argon reads and watches all of it, writes a 3D world of the crash as code in one pass, and then checks its own work in a loop: we render the world from each witness's eye position, Argon watches those renders next to the evidence, independent geometry and physics checks run, and Argon patches the world. The output is a reconstruction you can stand inside and a list of findings, each with citations to report pages and video timestamps.

Built at the Gemini 4 Argon SF Hackathon, Oct 25, 2026. Track: **More Dimensions**.

- Demo video (1 min): `<VIDEO LINK>`
- Team: `<NAME (@github)>`, `<NAME (@github)>`

> **Data notice.** The demo case uses **real public crash facts** from NTSB Highway Accident Report NTSB/HAR-17/02 (accident HWY16FH018, US-27A near Williston, Florida, May 7, 2016), cited by page. **Witnesses A, B and C are fictional.** The **deposition video is simulated**, generated today from a script. No real names are used. Values NTSB did not report are marked "assumed" in the case file. Sightline is a case-analysis aid, not evidence; a qualified expert should review any conclusion.

## What it does

1. **Ingest any case.** Create a case and drop in PDFs, text, Word docs, images and videos. Text is extracted with page markers so citations like "p.3" open the right page.
2. **Generate.** Argon gets the full case text, the images, and every video (via the Files API) in one context and writes a world module: road, vehicles with timed motion, occluders, witnesses with position, eye height, observation time and claim. Every object carries a citation.
3. **Render.** A headless browser renders the world from overhead and from each witness's eyes at the moment they describe.
4. **Check (no AI).** Ray-cast sightlines from each witness to what they claim to have seen, plus speed and skid-length physics checks.
5. **Critique and patch.** Argon watches the renders against the evidence and the check results, writes findings (contradiction / consistent / unverifiable) with citations, and returns a patched world if the world itself was wrong. The loop repeats up to 3 rounds.
6. **Ask "what if".** Type a new witness statement; Argon places that witness in the world and the same checks give a verdict. Or place a witness on the map by hand.

In the demo case, Witness B says she had a clear view of the car the whole way in, right up until it hit. She marks where she stood on a map exhibit 27 minutes into the deposition, and never says the position out loud. Argon's first draft places her from her words; after watching the renders against the video, it moves her to the marked spot, and the ray-cast check shows the turning truck blocking her view from 1.3 s before impact, from all 25 test positions within 2 m of her mark. A transcript-only baseline (Gemini Flash, chunk-and-summarize) calls her testimony consistent.

## Why it needs Argon

The hard part is the input, not the output. In one pass Argon reads the whole case file and watches the full 30-minute deposition as video: about 164k input tokens, roughly 128k of them video, inside its 1M-token input context (which leaves room for more depositions, dashcam and our renders). Nobody points it at the right moment: in the live run it located Witness B's map mark at Depo 27:05 on its own, a position that is never spoken and so is invisible to a transcript pipeline. It then writes a complete to-scale world module in one call (129 s in the live run; the module fits well inside Argon's 32,768-token output limit), and in the critique round it watches its own renders next to the evidence and patches the world.

For comparison, a paid forensic crash animation costs roughly $2k to $20k+ and takes weeks.

## Run it

Requirements: Node 22, ffmpeg, Python 3 with Pillow (only for rebuilding the deposition video). Chromium for rendering is installed with the npm packages.

```bash
npm install
cp .env.example .env        # leave SIGHTLINE_MODE=mock to start
npm run dev                 # http://localhost:5173
```

- `http://localhost:5173/cases.html` — case list, new case upload, run a reconstruction.
- `http://localhost:5173/?case=demo` — the demo case viewer.

### Mock mode (default, no API key)

`SIGHTLINE_MODE=mock` replays the cached Argon outputs in `cases/<caseId>/cache/`. Rendering and the independent checks still run for real. The demo case is pre-run, so it works offline. A brand-new case has no cache and needs live mode.

```bash
node argon/loop.js --case demo          # replay the full loop from cache (add --no-render to skip rendering)
```

### Live mode (calls Gemini)

```bash
# .env
GEMINI_API_KEY=...                       # never commit this
ARGON_MODEL=gemini-4-argon
BASELINE_MODEL=gemini-3.8-flash
SIGHTLINE_MODE=live
```

```bash
npm run smoke                            # checks the key and both models
npm run dev                              # then create a case at /cases.html and press "Run reconstruction"
node argon/loop.js --case <caseId>       # or run the loop from the command line
node argon/baseline.js --case <caseId>   # Flash transcript-only baseline for comparison
```

Live outputs are written back to `cases/<caseId>/cache/`, so any case run live can be replayed in mock mode afterwards.

### Rebuild the demo case

```bash
npm run deposition                       # case/deposition_script.json -> deposition/out/deposition.mp4 (+ .srt)
node argon/seed_demo.js                  # sync case/ + deposition into cases/demo/ and seed its cache
```

## Architecture

```
evidence (PDF, text, images, video)
        │  server/cases.js: upload, text extraction, ffprobe
        ▼
cases/<caseId>/{evidence, text}
        │  argon/generate_world.js  (Argon: whole case + videos in one context → world module JS)
        ▼
cases/<caseId>/worlds/world_vN.js ──► render/record.js (Playwright + Three.js) ──► renders/*.png|mp4
        │                                              │
        │  checks/checks.js (ray-cast sightlines,      │
        │  skid/speed physics, no model)               │
        ▼                                              ▼
argon/critique.js  (Argon: evidence + renders + check results → findings with citations + patched world)
        │
        └── argon/loop.js: generate → render → check → critique → patch, up to 3 rounds
                         ▼
        web/ viewer: 3D world, witness cameras, findings with citation chips that open the page or seek the deposition video
```

| Path | What it is |
|---|---|
| `server/` | Express API and static server (port 5173), case storage and ingest |
| `argon/` | Gemini client (mock/live), prompts, generate, critique, new witness, loop, Flash baseline |
| `checks/` | Independent geometry and physics checks |
| `render/` | Headless renderer for witness and overhead views |
| `web/` | Case list/upload page and the 3D viewer |
| `worlds/` | World contract example, hand-written reference world, world tests |
| `deposition/` | Simulated deposition video generator (script → MP4 + SRT, map marks drawn on screen only) |
| `case/` | Demo case source files built from NTSB/HAR-17/02 |
| `cases/demo/` | Pre-run demo case (evidence, extracted text, worlds, renders, cached Argon outputs) |

The engine is case-generic: prompts, checks, loop, server and viewer contain no facts about any particular crash. Vehicles, occluders, timing and witness positions (including positions shown only in video) are extracted by Argon from the uploaded evidence. World modules follow a fixed contract (`SPEC.md`): plain ES modules that receive Three.js, use meters with Y up, expose `setTime(t)`, and give every object and witness a citation.

## What was built today

Everything in this repo was written on Oct 25, 2026, between 10:30 AM and 5:00 PM, at the Gemini 4 Argon SF Hackathon:

- case ingest and upload (PDF, DOCX, text, images, video)
- Argon prompts and the generate → render → critique → patch loop, with mock replay and live modes
- headless renderer for witness-eye and overhead views
- independent ray-cast sightline and physics checks
- the 3D viewer with witness cameras, findings and citation chips
- the simulated deposition video generator
- the demo case, built from public NTSB report HAR-17/02, with fictional witnesses

We used open-source libraries (Three.js, Express, Playwright, @sparticuz/chromium, ffmpeg, pdf-parse, mammoth, multer) and the Gemini API (`@google/genai`). No code from earlier projects.

## What a skeptical expert would ask — and our answer

- **No qualified expert signs it.** Sightline is the analysis a lawyer runs before deciding to spend $5–20k; its output is a cited draft for their expert, not trial evidence.
- **Is it reproducible?** Every world version records the model, prompt version (hash) and a hash of every input (`cases/<id>/worlds/world_vN.provenance.json`). The checks are deterministic, so any run can be replayed.
- **Confidentiality and privilege?** Roadmap: enterprise deployment, no-training and no-retention terms, per-matter access control, audit log.
- **Event data recorder?** An EDR report is just another evidence type that Argon reads and cites (roadmap).
- **Accuracy is unvalidated.** We validate against public NTSB investigations with known answers: **11 of 12** measured facts match on this case (`cases/demo/cache/validation.json`; the miss is NTSB's 10.4 s crest-to-impact time, which can't be checked because the modeled car path starts about 1.6 m short of the crest). Next, a benchmark across dozens of cases.
- **Geometry from documents, not a survey.** Every dimension is cited; inferred values are labeled and drawn in amber. Roadmap: aerial imagery and scans.
- **Kinematic, not physics.** Motion is fitted to cited evidence and checked for physical plausibility (over 1 g, teleports, impossible speeds). Roadmap: export to crash-physics tools.
- **Her map mark is only good to ±1–2 m.** We ray-cast from 25 positions in a 2 m disc around it (eye height ±0.1 m): in the demo, blocked from **25 of 25** (tractor 14, trailer 11).
- **Line of sight is not the same as noticing.** We report the angle between her gaze and the target, flag anything past 30° as peripheral, and state the 60° camera field of view. Findings say "had line of sight", never "could see".
- **Night and glare.** Lighting objects are cited from the evidence; a sun-angle glare check is on the roadmap.

## Limits

- Geometry is simple boxes at real dimensions, not a photoreal scan.
- A witness's position is only as good as their own mark or description; the source of every position is cited.
- Checks are exact for the world they are given; the uncertainty is in the inputs, which are cited and labeled.
- Use it to find which testimony needs a closer look and why, not as a final opinion.
