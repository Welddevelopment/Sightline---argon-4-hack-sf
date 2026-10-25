# B2 — Review & confirm UI (step 3)

Files: web/review.html, web/review.js, web/review.css (new); one "Review inputs" nav button in web/cases.html (links to /review.html?case=<selected case>).

Page: `/review.html?case=<id>` — codes against SPEC.md "## REVIEW & CONFIRM (12:10)".
- Meta line: "Extracted by <meta.model> in <meta.seconds> s", mode, tokens, time; "Re-run extraction" (POST /extraction/run, polls GET every 2 s while `running`).
- Scene panel (date, time, location, weather, lighting editable; citation chip).
- Facts table: id, label, value+unit, citation chip, cited/inferred badge (inferred = amber dashed), confidence bar (<60% amber), inline Edit (Enter saves / Esc cancels) and Reject/Restore.
- Witnesses table: name, marked position (+ position citation chip), eye height, observation time, claim + claim citation chip; Edit/Reject; "Place on plan" when position is null.
- Vehicles and scene objects as cards with citation chips and Reject.
- Citation chips open a Source card: "Depo MM:SS" / source.timestamp -> case video seeked to that time, with the SRT transcript lines around it highlighted; "<file> p.N" / source.file -> extracted document text, scrolled to [[page N]] with the fact value highlighted. File names are matched by stem (facts.txt -> facts.md).
- Scene plan canvas: uses `case.json.map {file, px_per_m, origin_px}` (image + scale) when the case manifest has it, else a metre grid auto-fitted to positions within 150 m of the origin; far items (e.g. Witness A 402 m E) are edge pointers. Witness markers are draggable (0.1 m), marking the witness edited.
- Sign-off: tally (accepted/edited/rejected/inferred), "Reviewed by" name (remembered locally), "Confirm and build" -> POST /confirm (kept items only, `edited:true` on changed ones) -> POST /run -> SSE progress -> "Open in viewer". "Skip review" -> /cases.html?case=<id> (old path). Existing confirmed_facts are overlaid (missing items shown rejected) with "Clear confirmation".

Map scale: uses `case.json.map` when present; otherwise, if the case's exhibit image has the same file name as `case/case.json.map.file` (demo: map.png, identical Exhibit 4), it borrows that block (10 px/m, origin [600,450]) and the note says "scale: exhibit manifest". So the demo shows Exhibit 4 under the markers. Adding a `map` block to cases/<id>/case.json still takes precedence.
Moving a witness draws a dashed ghost at the extracted position with "extracted · N m" and the witness row shows "moved N m from extracted x, z" (the Witness B ~5.5 m correction is visible at a glance).
Labels on the plan avoid each other (witness tags reserved first, object/edge labels slide to a free slot). "Enlarge" widens the side column for the plan (remembered locally).
Tested PORT=5195 mock on demo with Playwright; confirm/run/stream stubbed in the test so the shared demo state (confirmed_facts.json, jobs) was not touched.
