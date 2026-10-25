# PRODUCT-D: background reconstruction jobs — DONE

Runs (`POST /api/cases/:id/run`) are server-side background jobs. Status persists per case in `cases/<id>/cache/job.json`; closing the tab or dropping the SSE stream never stops a run.

## Files
- `server/jobs.js` (new): `mountJobs(app, store, h)` job registry + routes.
- `server/cases.js`: small hooks. One import, `const jobs = mountJobs(...)`, `job:` field on list items, and in the run route: `jobs.create` + `run.clients.add(jobs.sink(id))`, `await jobs.acquire(...)` before runLoop, `jobs.release(id)` in finally.
- `web/jobs.js` (new): included once in `web/index.html` and once in `web/cases.html` (`<script src=… defer>`).

## API
- `GET /api/jobs`: array of `{caseId, title, status: queued|building|ready|failed, step, round, message, mode, startedAt, finishedAt, error, resumable, pid, events[≤25 slim], queuePosition?}`, newest first. Only cases that have ever run are included.
- `GET /api/cases/:id/job`: that job, or `{caseId, status:'none'}`. Returns 404 for an unknown case.
- `GET /api/cases` items: `job` (same object, or null).
- Resume or retry: POST `/api/cases/:id/run` again with body `{mode: job.mode}`.

## Behaviour
- One job per case: the existing `run.running` 409 still applies. Global limit is `JOBS_CONCURRENCY` live jobs (default 1). Extra runs wait as `queued`, emit a `step:'queued'` SSE progress event, and start FIFO.
- The job is fed by an SSE-client-shaped sink in `run.clients`, so it gets every emitted event. A `done` event sets `ready`; an `error` event sets `failed`. A run that ends without either is marked failed on release.
- Restart: on boot, jobs left queued/building whose `pid` is no longer alive are marked `failed`, `error:"server restarted"`, `resumable:true`, and a stale `case.json` status of `running` becomes `error`. The pid check means one dev server starting up does not clobber a job that another live server is running on the same `cases/` directory.
- `web/jobs.js` polls `/api/jobs` every 2.5s while a job is active and every 15s otherwise. It shows:
  - a floating badge (click it for a job panel) and a title count `(n)`
  - `navigator.setAppBadge`
  - toasts on Ready/Failed, with Open in viewer or Resume
  - a browser Notification on finish (permission is asked on the first click while a job is active, or on #runBtn)
  - Building/Queued/Ready/Failed pills with a Resume button on `#caselist li[data-id]`, kept in place by a MutationObserver
  - finishes that happened while no tab was open, detected via localStorage

## Tested (PORT=5197, mock, LOOP_MOCK_DELAY_MS=300, scratch copies of demo)
- Started a run, dropped the SSE stream after 1s, polled `/api/jobs` until it was ready.
- Started 2 runs: the second was `queued#1`, then ran after the first.
- `kill -9` mid-run, then restart: both jobs became failed "server restarted", resumable, and case status became error. Resume reached ready.
- A second server booted mid-run did not mark the live job failed.
- Scratch cases deleted.
