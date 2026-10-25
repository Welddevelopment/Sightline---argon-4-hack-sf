// Sightline background reconstruction jobs.
// A job is the server-side lifetime of one POST /api/cases/:id/run. It runs in-process and is NOT tied to any
// HTTP request/SSE client, so closing the tab never stops it. Status persists per case at
// cases/<id>/cache/job.json: { caseId, status: queued|building|ready|failed, step, message, events (tail),
// startedAt, finishedAt, error, mode, resumable }.
// Global concurrency: JOBS_CONCURRENCY live jobs (default 1, the box has 2 CPUs); extra runs wait as "queued".
// On server start, jobs left queued/building by a previous process are marked failed "server restarted" + resumable.
//
// Wiring (server/cases.js): const jobs = mountJobs(app, store, h);
//   run route: jobs.create(id, { mode }) → run.clients.add(jobs.sink(id)) → await jobs.acquire(id, onQueued) → … → finally jobs.release(id)
//   list route: job: jobs.get(caseId)
import fs from 'node:fs';
import path from 'node:path';

const TAIL = 25;
const LIMIT = Math.max(1, Number(process.env.JOBS_CONCURRENCY) || 1);
const ACTIVE = new Set(['queued', 'building']);

// Keep persisted events small: drop bulky payloads (state, checks, evidence inventories…).
function slim(ev) {
  const out = {};
  for (const k of ['at', 'type', 'step', 'round', 'message', 'verdict', 'world', 'replay']) if (ev[k] != null) out[k] = ev[k];
  if (typeof out.message === 'string' && out.message.length > 400) out.message = out.message.slice(0, 400) + '…';
  return out;
}

export function mountJobs(app, store, h = {}) {
  const file = (id) => store.dir(id, 'cache', 'job.json');
  const jobs = new Map();   // caseId -> job (in-memory mirror of job.json)
  const live = new Set();   // caseIds holding a concurrency slot
  const waiters = [];       // [{ id, resolve }] FIFO
  const sinks = new Map();

  const save = (job) => {
    try {
      const f = file(job.caseId);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const tmp = f + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(job, null, 2));
      fs.renameSync(tmp, f);
    } catch (e) { console.warn(`[jobs] could not persist ${job.caseId}: ${e.message}`); }
  };
  // Only jobs this process runs are cached; anything else is re-read from disk (several dev servers may share cases/).
  const load = (id) => {
    if (jobs.has(id)) return jobs.get(id);
    const j = store.validId(id) ? store.readJson(file(id), null) : null;
    if (j && typeof j === 'object') j.caseId = id;
    return j || null;
  };
  const alive = (pid) => { if (!pid || pid === process.pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  const queuePos = (id) => { const i = waiters.findIndex((w) => w.id === id); return i < 0 ? null : i + 1; };
  const view = (id) => {
    const j = load(id);
    if (!j) return null;
    return j.status === 'queued' ? { ...j, queuePosition: queuePos(id) } : j;
  };

  // ---- restore after restart ----
  try {
    if (fs.existsSync(store.CASES)) {
      for (const id of fs.readdirSync(store.CASES)) {
        const j = load(id);
        if (!j || !ACTIVE.has(j.status)) continue;
        const at = new Date().toISOString();
        Object.assign(j, { status: 'failed', step: 'error', error: 'server restarted', message: 'Server restarted while this reconstruction was running. Resume to start it again.',
          finishedAt: at, resumable: true });
        j.events = [...(j.events || []), { at, type: 'error', message: 'server restarted' }].slice(-TAIL);
        save(j);
        // The manifest still says "running" from the dead process; mark it failed so the UI can retry.
        const m = store.manifest(id);
        if (m && m.status === 'running') { m.status = 'error'; m.error = 'server restarted'; try { store.saveManifest(m); } catch { /* */ } }
        console.log(`[jobs] ${id}: in-flight job from previous process marked failed (server restarted)`);
      }
    }
  } catch (e) { console.warn(`[jobs] restore scan failed: ${e.message}`); }

  const api = {
    get: view,
    isActive: (id) => { const j = load(id); return !!j && ACTIVE.has(j.status); },
    all() {
      if (!fs.existsSync(store.CASES)) return [];
      return fs.readdirSync(store.CASES).map((id) => {
        const j = view(id);
        if (!j) return null;
        const m = store.manifest(id);
        return m ? { ...j, title: m.title } : null;
      }).filter(Boolean).sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
    },
    /** Register a new job (status queued). Throws if one is already active for this case. */
    create(id, { mode } = {}) {
      if (api.isActive(id) && (live.has(id) || queuePos(id))) { const e = new Error('a job is already running for this case'); e.status = 409; throw e; }
      const job = { caseId: id, status: 'queued', step: 'queued', message: 'Queued', mode: mode || h.MODE || null,
        startedAt: new Date().toISOString(), finishedAt: null, error: null, resumable: false, events: [] };
      jobs.set(id, job); save(job);
      return job;
    },
    /** Wait for a global slot; marks the job building. onQueued(msg) is called once if it has to wait. */
    acquire(id, onQueued) {
      const go = () => {
        live.add(id);
        const j = load(id);
        if (j) { j.status = 'building'; j.step = j.step === 'queued' ? 'start' : j.step; j.buildingAt = new Date().toISOString(); save(j); }
      };
      if (live.size < LIMIT && !waiters.length) { go(); return Promise.resolve(); }
      const busy = [...live].join(', ');
      try { onQueued?.(`Queued: waiting for ${busy || 'another reconstruction'} to finish (${LIMIT} live job${LIMIT > 1 ? 's' : ''} at a time).`); } catch { /* */ }
      return new Promise((resolve) => waiters.push({ id, resolve: () => { go(); resolve(); } }));
    },
    /** Record one event (also derives status from done/error events). */
    event(id, ev) {
      const j = load(id);
      if (!j || !ev || typeof ev !== 'object') return;
      const e = slim(ev);
      if (ev.type === 'hello') return;
      j.events = [...(j.events || []), e].slice(-TAIL);
      if (e.step) j.step = e.step;
      if (e.message) j.message = e.message;
      if (e.round != null) j.round = e.round;
      if (ev.type === 'done') Object.assign(j, { status: 'ready', step: 'done', finishedAt: e.at || new Date().toISOString(), error: null, resumable: false });
      else if (ev.type === 'error') Object.assign(j, { status: 'failed', step: 'error', finishedAt: e.at || new Date().toISOString(), error: e.message || 'failed', resumable: true });
      save(j);
    },
    /** An SSE-client-shaped sink: add to run.clients and every emitted event lands in the job. Never throws. */
    sink(id) {
      if (!sinks.has(id)) sinks.set(id, { jobSink: true, write(data) {
        try { for (const line of String(data).split('\n')) if (line.startsWith('data: ')) api.event(id, JSON.parse(line.slice(6))); } catch { /* */ }
        return true;
      } });
      return sinks.get(id);
    },
    /** Free the slot; a job that ended without a done/error event is marked failed. */
    release(id, err) {
      live.delete(id);
      const wi = waiters.findIndex((w) => w.id === id); if (wi >= 0) waiters.splice(wi, 1);
      const j = load(id);
      if (j && ACTIVE.has(j.status)) {
        Object.assign(j, { status: 'failed', step: 'error', finishedAt: new Date().toISOString(), error: err ? String(err.message || err) : 'run ended without a result', resumable: true });
        save(j);
      }
      while (live.size < LIMIT && waiters.length) waiters.shift().resolve();
    },
  };

  app.get('/api/jobs', (req, res) => res.json(api.all()));
  app.get('/api/cases/:id/job', (req, res) => {
    const id = req.params.id;
    if (!store.manifest(id)) return res.status(404).json({ error: 'no such case' });
    res.json(view(id) || { caseId: id, status: 'none' });
  });

  return api;
}
