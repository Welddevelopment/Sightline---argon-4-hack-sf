// server/review.js — step 3 "Review and confirm" API (shapes: SPEC.md "## REVIEW & CONFIRM (12:10)").
//   GET  /api/cases/:id/extraction        → { caseId, status, extraction, meta, confirmed, error }
//   POST /api/cases/:id/extraction/run    → body { mode? } ; mock serves cache, live runs in background (poll GET)
//   POST /api/cases/:id/confirm           → body { facts, witnesses, scene, vehicles?, objects?, confirmedBy } | { clear:true }
// ctx: { ROOT, MODE, tryImport, errMsg } (same helpers server.js passes to mountCases).
import fs from 'node:fs';
import path from 'node:path';

export function mountReview(app, ctx = {}) {
  const errMsg = ctx.errMsg || ((e) => (e && e.message) ? e.message : String(e));
  const ROOT = ctx.ROOT || path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const CASES = process.env.SIGHTLINE_CASES_DIR || path.join(ROOT, 'cases');
  const jobs = new Map(); // caseId -> { status: 'running'|'error', error, startedAt }

  const loadExtract = async () => {
    if (ctx.tryImport) {
      const { mod, error } = await ctx.tryImport('argon/extract.js');
      if (!mod) throw new Error(error);
      return mod;
    }
    return import('../argon/extract.js');
  };
  const validId = (id) => /^[\w.-]+$/.test(id) && fs.existsSync(path.join(CASES, id));

  async function snapshot(id) {
    const ex = await loadExtract();
    const { extraction, meta } = ex.readExtraction(id);
    let confirmed = null;
    try { confirmed = JSON.parse(fs.readFileSync(ex.confirmedPath(id), 'utf8')); } catch { /* skip path */ }
    const job = jobs.get(id);
    const status = job?.status === 'running' ? 'running' : job?.status === 'error' ? 'error' : extraction ? 'ready' : 'none';
    return { caseId: id, status, extraction: extraction || null, meta: meta || null, confirmed, error: job?.error || null };
  }

  app.get('/api/cases/:id/extraction', async (req, res) => {
    const id = req.params.id;
    if (!validId(id)) return res.status(404).json({ error: `no such case: ${id}` });
    try { res.json(await snapshot(id)); } catch (e) { res.status(500).json({ error: errMsg(e) }); }
  });

  app.post('/api/cases/:id/extraction/run', async (req, res) => {
    const id = req.params.id;
    if (!validId(id)) return res.status(404).json({ error: `no such case: ${id}` });
    const serverMode = (ctx.MODE || process.env.SIGHTLINE_MODE || 'mock') === 'live' ? 'live' : 'mock';
    const mode = (req.body?.mode === 'live' || req.body?.mode === 'mock') ? req.body.mode : serverMode;
    if (mode === 'live' && serverMode !== 'live') return res.status(400).json({ error: 'server is in mock mode; live extraction needs SIGHTLINE_MODE=live' });
    try {
      const ex = await loadExtract();
      if (mode !== 'live') {
        jobs.delete(id);
        await ex.runExtraction(id, { mode: 'mock' });
        return res.json(await snapshot(id));
      }
      if (jobs.get(id)?.status !== 'running') {
        jobs.set(id, { status: 'running', error: null, startedAt: new Date().toISOString() });
        ex.runExtraction(id, { mode: 'live' })
          .then(() => jobs.delete(id))
          .catch((e) => { console.error(`[review] extraction ${id} failed:`, errMsg(e)); jobs.set(id, { status: 'error', error: errMsg(e) }); });
      }
      res.json(await snapshot(id));
    } catch (e) {
      res.status(mode === 'mock' ? 404 : 500).json({ ...(await snapshot(id).catch(() => ({ caseId: id }))), status: 'error', error: errMsg(e) });
    }
  });

  app.post('/api/cases/:id/confirm', async (req, res) => {
    const id = req.params.id;
    if (!validId(id)) return res.status(404).json({ error: `no such case: ${id}` });
    try {
      const ex = await loadExtract();
      const body = req.body || {};
      if (body.clear) { ex.clearConfirmed(id); return res.json({ ok: true, confirmed: null }); }
      for (const k of ['facts', 'witnesses', 'vehicles', 'objects']) {
        if (body[k] !== undefined && !Array.isArray(body[k])) return res.status(400).json({ error: `${k} must be an array` });
      }
      if (body.scene !== undefined && (typeof body.scene !== 'object' || Array.isArray(body.scene))) return res.status(400).json({ error: 'scene must be an object' });
      res.json({ ok: true, confirmed: ex.writeConfirmed(id, body) });
    } catch (e) { res.status(500).json({ error: errMsg(e) }); }
  });
}
