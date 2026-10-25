# INGEST slice status — DONE (floor), tested against real server
Files: server/cases.js (new, all case logic), server/seed_demo.js, web/cases.html (new); small edits: server/server.js (mount + serve web/ at site root), web/index.html (case picker), web/ui.js (?case= mode), web/viewer.js (?case= boot), web/style.css (picker styles).
Deps added: multer, pdf-parse (v2 API), mammoth.

Storage: cases/<id>/{case.json,evidence/,text/,worlds/,renders/,cache/}; id = slug + 4 hex. manifest {caseId,title,createdAt,files:[{name,type,size,textPath?,pages?,durationSec?,note?}],status: created|ready|running|done|error}.
Text: PDF -> text/<stem>.txt with "[[page N]]" markers (scanned PDF flagged in `note`); txt/md copied as-is; docx via mammoth; csv/json/srt/vtt copied to .txt. Video gets ffprobe durationSec.

API (all on :5173):
- GET /api/cases -> [{caseId,title,createdAt,status,fileCount,hasWorld}]
- POST /api/cases  multipart: title + files[] -> 201 manifest (+ file urls; unsupported types listed in `skipped`)
- POST /api/cases/:id/files  (add more evidence), DELETE /api/cases/:id (not demo)
- GET /api/cases/:id -> manifest + files[].url/textUrl + state{world,findings,checks,loopLog} (checks computed if absent) + running
- POST /api/cases/:id/run {mode?} -> 202; 501 {blockedOn:"ARGON slice"} if argon/loop.js missing or its runLoop doesn't mention caseId (non-demo); 409 if running
  Calls runLoop({caseId, mode, onProgress}); events pass through as {type:"progress", step, round, message,...}; ends with {type:"done"|"error", state}. Persists cases/<id>/cache/state.json only if result.world file exists and last round has no error (else restores previous state; manifest status=error).
- GET /api/cases/:id/stream (SSE, replays history to late subscribers)
- POST /api/cases/:id/witness {statement} -> same shape as /api/witness; calls newWitness(statement, world, {caseId}); persisted to cases/<id>/cache/extra_witnesses.json; GET /api/cases/:id/witnesses
- Static: /cases/* (evidence, text, worlds, renders, cache), and web/ files are now served at site root (/cases.html, /style.css, ...).
- Legacy /api/state, /api/witness, /api/loop, /api/loop/stream untouched (global cache/); GET /api/cases/demo falls back to legacy buildState() until cases/demo/cache/state.json exists.

Demo seeding: `node server/seed_demo.js` (idempotent): case/*.md|txt + deposition_script.json -> text/, deposition.mp4/.srt + case/exhibits/map.png -> evidence/, cache/*.json (not state.json) -> cases/demo/cache if absent. Re-run once the CASE slice lands its files (case/ was empty when I seeded: demo currently has deposition.mp4 + deposition.srt).

UI: /cases.html (list left; "New case": title + drag/drop or browse multi-file (folders OK) with upload progress bar -> creates case -> case page with evidence list + "Run reconstruction" -> stepper (Extracting text, Uploading videos to Argon, Generating world, Rendering views, Independent checks, Argon critique, Applying fix, Round N) + live SSE log -> on done auto-opens /?case=<id>). Viewer: top-bar case picker (+ "New case" link); /?case=<id> loads that case's world/findings/checks/evidence (video, text docs, images; page citations like "p.3" open the doc scrolled to "[[page 3]]"); a case with no world redirects to /cases.html?case=<id>. "Re-run loop" in case mode goes to the cases page.

Tested: upload pdf+txt+mp4+png(+rejected /etc/passwd) -> case.json, text/sample.txt with [[page 1]]/[[page 2]], list endpoint; run on a fresh case in mock mode fails gracefully via SSE ("no cache file for generate_world" — expected, a new case needs a LIVE run on the laptop); headless Playwright screenshots of /cases.html (new form, filled form, run log) and /?case=demo OK; full UI upload->create->run flow driven headlessly OK.

Blocked / watch on ARGON: (1) a brand-new case can only complete in SIGHTLINE_MODE=live (no Gemini access from the cloud box). (2) argon now moved worlds into cases/<id>/worlds/, but the legacy cache/state.json still points at /worlds/world_v2.js, which no longer exists -> legacy /api/state and the no-?case viewer's demo world may break; cases/demo needs its own cache/state.json (or restore worlds/world_v*.js). (3) During my demo mock run the loop stalled at "render" for minutes and an earlier run hit "ENOENT cases/demo/worlds/world_v1.js" (race between generate and loadWorldFile) — ARGON/RENDER to check.
