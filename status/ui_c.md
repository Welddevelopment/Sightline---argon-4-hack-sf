# UI-C: cases page (steering review)

Files: web/cases.html (shell + includes, keeps UI-A's /methodology.js include), web/cases.js, web/cases.css.

- Mode: read from GET /api/health (`mode` = SIGHTLINE_MODE) for the header badge and the note under the run buttons; SSE `hello.mode` also updates it. Stale "live runs happen on the laptop" text removed; mock note now says live runs execute in the build workspace (SIGHTLINE_MODE=live). Each card / detail also shows the last run's own mode (`state.mode`).
- Evidence table: size and duration come only from GET /api/cases/:id `files[]` (server recomputes from disk). Durations: <60 s "41 s", <10 min "2 min 41 s", otherwise "30 min". Sizes: decimal KB/MB (demo deposition.mp4 -> 30 min, 4.2 MB). No hardcoded values.
- Case cards: title, incident date + location, source ("NTSB HWY16FH018 (real) · witnesses fictional"), last run time + mode, exhibit counts, verdict tag. Date/location/source are parsed from the case facts document heading (`# Case Facts: <ref> (<location>, <date>)`) plus its "fictional witnesses" note; manifest fields `incidentDate`/`location`/`source` override if the server ever adds them.
- Detail: facts strip, verdict + finding tallies + validation (x of y vs source), findings list, evidence table, progress/log during runs. Methodology button still mounts into `.actions`.
- Tested on PORT=5190 mock with headless Chromium (desktop 1440 and 390 px), no console errors.
