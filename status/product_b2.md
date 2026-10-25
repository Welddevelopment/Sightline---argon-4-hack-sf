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

Note: cases/demo/case.json has no `map` block, so the demo shows the grid. Adding
`"map": {"file": "map.png", "px_per_m": 10, "origin_px": [600, 450]}` (same frame as case/case.json; origin = impact point) puts Exhibit 4 under the markers.
