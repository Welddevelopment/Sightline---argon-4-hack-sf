# PRODUCT-A: PDF report export — status

DONE. "Export report" button (viewer header + case page header) -> GET /api/cases/:id/report.pdf.

Files (mine): server/report.js, web/report.html, web/report.css, web/exports.js, cases/demo/exports/report.pdf (+ exports/figs/*.png, figs/manifest.json).
Edits elsewhere: one mount line in server/server.js; one `<script src="/exports.js" defer>` line in web/index.html and web/cases.html.

Endpoints
- GET /api/cases/:id/report.json — aggregate the page renders: GET /api/cases/:id (files w/ live sizes/durations, state.findings/checks, provenance, validation, kinematicLabel) + case source (parsed from the facts doc), notices, world witnesses/object labels, figure list. `?added=1` also returns statements added live (not used in the PDF).
- GET /api/cases/:id/report.pdf — mock mode: serves cached cases/<id>/exports/report.pdf if present. Live mode: serves the cache unless state.json / validation.json / case.json / world file is newer. `?fresh=1` forces a rebuild (`&refigs=1` also re-renders figures). `?inline=1` for inline display.
- GET /report.html?case=<id> — screen preview of the same document (static web/).

Build: route spawns `scripts/render_lock.sh node server/report.js --build <id> --base http://127.0.0.1:<port>` (serialized with other Chromium jobs; one build per case at a time).
 1. Figures (only when the world file/state changed): headless Chromium (render/record.js launchBrowser) loads `/?case=<id>&clean=1&cam=..&t=..` and screenshots 1280x720: overview overhead at the key time (first contradiction witness's t, else impact), then for each witness an overhead with only that witness's sight line + eye-level view at its sightline-check t (else observationTime). Saved to cases/<id>/exports/figs/. If none were rendered, report.json falls back to cases/<id>/renders/<world>/*.png.
 2. page.pdf() of /report.html?case=<id>&print=1 (Letter, header/footer on every page: "Analysis draft for expert review — not evidence" + "SIMULATED DEPOSITION / FICTIONAL WITNESSES" when the case's documents/witnesses say fictional or simulated, or manifest flags fictionalWitnesses/simulatedDeposition; footer: case ref + Page X of Y).

Contents: cover (title, source + NTSB URLs, verdict, world version, validation x/y, mode, notices, kinematic label), 1 summary table, 2 evidence list (size, running time, SHA-256 prefix), 3 numbered findings (status, summary, detail, evidence cites with Depo MM:SS / page pins, checks: robustness N of 25 within 2 m, gaze off-axis, PRT, skid range, plausibility), 4 exhibit figures with captions, 5 all independent checks, 6 NTSB validation table, 7 methodology + limitations, 8 provenance (versions, model, prompt version, input hashes, output hash), reviewer signature lines.

CLI rebuild of the cached demo PDF (server must be running): `scripts/render_lock.sh node server/report.js --build demo --base http://127.0.0.1:5173 [--refigs]`.
