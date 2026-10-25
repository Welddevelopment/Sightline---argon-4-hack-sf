# ARGON-ONLY UI slice

Goal: make "only Argon can do this" visible on screen.

Files: `web/argon_only.js`, `web/argon_only.css` (the JS injects the CSS), `server/case_size.js`
(`mountCaseSize(app, ctx)`), one mount line in `server/server.js`, one `<script src="/argon_only.js" defer>`
in `web/index.html` and `web/cases.html`. No other file is touched; ui.js / cases.js re-renders are handled by a MutationObserver.
Hidden in `?clean=1` (headless renders).

## Endpoints
- `GET /api/cases/:id/size` →
  `{caseId, totalTokens, measured, source: "argon_only.json"|"meta"|"estimate", estimatedTokens, estimate:{video,text,pdf,image},
    videoSec, videoCount, pages, pdfPages, textPages, documents, model, measuredFrom:{call,file,at,modalities}|null, method, argonOnly?}`
  - `argon_only.json` (below) wins when present.
  - measured = the most recent Argon call in `cases/<id>/cache/*.meta.json` whose `usage.promptTokenCount` (or `usage.promptTokens`)
    is ≥ 50 % of the estimate, i.e. a read of the whole case (small follow-up calls such as one new-witness statement are ignored).
  - estimate: video 71 tok/s (ffprobe / manifest `durationSec`), text chars/4, PDF pages × 560 (`pdfinfo`), images 258–1092 by 768-px tiles.
  - pages = PDF pages + text page-equivalents (3,000 chars/page); both parts are in the response and in the banner tooltip.
- `GET /api/cases/:id/frame?video=<evidence file>&t=<sec|MM:SS|HH:MM:SS>[&cue=mid][&format=json]` → PNG (or JSON
  `{url, video, t, tc, requested, requestedTc, cue:{start,end,text}}`). Cached as `cases/<id>/cache/frames/<video>_<t>.png`.
  `cue=mid` moves t to the middle of the `<video>.srt` cue spoken at t (citations are truncated to the second; "Depo 27:04" lands
  on 27:10 where the exhibit with her pen mark is on screen). `video` defaults to the case's first video.

## UI
1. Case-size banner: viewer = strip at the top of the 3D stage; case page = ruled line under the facts block.
   "CASE 161k tokens · 30 min video · 23 pages · 7 documents · read in one pass by gemini-4-argon [MEASURED|ESTIMATED]".
   Tooltip on the tag gives exact count, source file, pre-flight estimate, page breakdown.
2. Key frames inside the first `contradiction` finding (viewer card; case-page findings row): deposition frame at the mark
   citation (prefers a Depo citation mentioning mark/exhibit/position) + witness-eye still (see 4; time from the
   "wit_X.png @ t=9.9s" citation). Click = lightbox; the depo frame also seeks the deposition player.
3. Baseline: per lead/user decision (12:32) there is NO "same inputs" card and the UI does not read baseline_fair.json.
   The existing viewer Flash card (`#compare`, rendered by ui.js from `cases/<id>/cache/baseline.json`) is kept and its
   Flash column is relabelled exactly: "Gemini Flash · chunk-and-summarize pipeline over the transcript · no video".
   `argon_only.json.baseline` is documented below but not rendered.
4. Witness-eye still: `argon_only.json.key_frames.render_png` > cached viewer snapshot `cache/frames/eye_<wit>_<t>.jpg`
   (the viewer snapshots `window.sl` from the witness camera at the cited time and POSTs it to
   `POST /api/cases/:id/eyeframe {wit,t,dataUrl(jpeg),world}`) > recorded `renders/<world>/<wit>.png` (these are full-UI
   captures, so CSS crops them to the 3D stage).

## Expected schemas
`cases/<id>/argon_only.json` (written by the demo-full build session; not created by this slice):
```json
{ "tokens_total": 880000, "video_seconds": 10020, "pages": 412,
  "measured": true,                       // optional, default true
  "documents": 37, "video_count": 4, "model": "gemini-4-argon",   // optional
  "baseline": { "model": "gemini-3.8-flash", "inputs": "All documents + all video" | {"label": "...", "tokens": 880000},
                "verdict": "free text" },          // not rendered (see UI 3)
  "key_frames": { "render_png": "renders/world_v2/wit_B.png", "render_t": 9.9,
                  "depo_png": "cache/frames/deposition.mp4_1629.5.png", "depo_timecode": "27:10" } }
```
Paths are relative to `cases/<id>/` unless they start with `/` (site URL).


## Tested
Server on PORT=5201 SIGHTLINE_MODE=mock, case `demo` (no argon_only.json → measured 160,665 tokens from
`cache/extraction.meta.json`); viewer + case page screenshotted in headless Chromium.
