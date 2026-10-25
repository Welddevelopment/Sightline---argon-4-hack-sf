# PRODUCT-E: multiple depositions / long evidence per case

DONE.
- Ingest (server/cases.js): multer `files` array already accepted several videos; each gets real `durationSec` via ffprobe (ingestFile + lead's freshMeta). Added `evidenceListing()` so POST /api/cases, POST /api/cases/:id/files and GET /api/cases/:id also return `videoCount` and `totalVideoSec`.
- argon/case.js: new `caseVideos(caseId)` (label from case.json files[].label|deponent|witness, else filename e.g. depo_brandt.mp4 → "Brandt", else letter by order; ffprobe duration; cite form), `fmtClock`, `labelFromFilename`, `videoDurationSec`. `evidenceMediaParts` with >1 video sends a header part (count, total, citation rule) then per video `VIDEO n: deposition of <label> (MM:SS) — file …. Cite moments as "Depo <label> MM:SS"` + file part. Used by generate_world, critique, extraction. `evidenceSummary` gains `videoIndex` only when >1 video.
- Single-video cases (demo): parts and inventory are byte-identical to before, so mock cache / SIGHTLINE_REUSE hashes stay valid.
- Prompts generate_world/critique/extract: appended a "Citing videos" paragraph.
- Tested: scratch case with demo deposition.mp4 (30:01) + 60 s simulated "Witness C" video, mock mode: GET returned 2 videos, totalVideoSec 1861.8; parts dump showed both labelled videos. Scratch case deleted.
