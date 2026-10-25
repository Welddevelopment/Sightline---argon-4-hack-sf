// Sightline WHAT-IF API (COMPARE & WHAT-IF slice). Mounted from server.js via mountWhatIf(app, ctx).
// GET /api/cases/:id/whatif?object=<vehicle id>&targetMph=<mph>
//   Re-times that object's path to the target speed (impact LOCATION fixed, timing shifted; see web/compare.js
//   retimeWorld — the browser preview uses the same code) and re-runs the independent checks (checks.runAll) on the
//   re-timed world, server-side.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function mountWhatIf(app, ctx = {}) {
  const { ROOT, MODE } = ctx;
  const errMsg = ctx.errMsg || ((e) => (e && e.message) || String(e));
  const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const validId = (id) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(id || ''));
  const memo = new Map(); // key -> result (bounded)

  const imp = async (rel) => {
    const f = path.join(ROOT, rel);
    return import(pathToFileURL(f).href + `?t=${fs.statSync(f).mtimeMs}`);
  };

  function caseWorldUrl(id) {
    const st = readJson(path.join(ROOT, 'cases', id, 'cache', 'state.json'));
    if (st && typeof st.world === 'string') return st.world;
    const wd = path.join(ROOT, 'cases', id, 'worlds');
    if (fs.existsSync(wd)) {
      const vs = fs.readdirSync(wd).map((n) => n.match(/^world_v(\d+)\.js$/)).filter(Boolean).sort((a, b) => +a[1] - +b[1]);
      if (vs.length) return `/cases/${id}/worlds/${vs[vs.length - 1][0]}`;
    }
    if (id === 'demo') {
      const legacy = readJson(path.join(ROOT, 'cache', 'state.json'));
      if (legacy && typeof legacy.world === 'string') return legacy.world;
    }
    return null;
  }
  function caseWitnesses(id) {
    const st = readJson(path.join(ROOT, 'cases', id, 'cache', 'state.json'));
    const extra = readJson(path.join(ROOT, 'cases', id, 'cache', 'witnesses.json'));
    return [...(Array.isArray(extra) ? extra : []), ...(st && Array.isArray(st.witnesses) ? st.witnesses : [])];
  }

  async function loadWorld(id, url) {
    const file = path.resolve(ROOT, String(url).replace(/^\/+/, ''));
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) throw Object.assign(new Error(`world file not found: ${url}`), { status: 409 });
    const lw = await import(pathToFileURL(path.join(ROOT, 'checks', 'load_world.js')).href);
    const world = await lw.loadWorldModule(file);
    world.witnesses = world.witnesses || [];
    world.meta = world.meta || {};
    world.duration = world.duration || 10;
    for (const w of caseWitnesses(id)) if (w && w.id && !world.witnesses.some((x) => x.id === w.id)) world.witnesses.push(w);
    return { world, file };
  }

  app.get('/api/cases/:id/whatif', async (req, res) => {
    const id = req.params.id;
    if (!validId(id) || !fs.existsSync(path.join(ROOT, 'cases', id))) return res.status(404).json({ error: 'no such case' });
    const targetMph = Number(req.query.targetMph ?? req.query.mph);
    if (!(targetMph > 0 && targetMph <= 250)) return res.status(400).json({ error: 'targetMph must be a number in (0, 250]' });
    const url = caseWorldUrl(id);
    if (!url) return res.status(409).json({ error: 'case has no world yet' });
    const t0 = Date.now();
    try {
      const core = await imp('web/compare.js');
      const checks = await imp('checks/checks.js');
      const { world, file } = await loadWorld(id, url);
      const object = String(req.query.object || core.defaultWhatIfObject(world) || '');
      if (!object || !world.objects[object]) return res.status(400).json({ error: `unknown object: ${object || '(none)'}` });
      const key = `${id}|${file}|${fs.statSync(file).mtimeMs}|${object}|${targetMph}`;
      if (memo.has(key)) return res.set('X-WhatIf-Cache', 'hit').json(memo.get(key));

      const analysis = core.retimeWorld(world, { object, targetMph });
      const results = await checks.runAll(world);
      // the as-reconstructed sight-line results (cached case checks when they are for this world; else recomputed)
      const st = readJson(path.join(ROOT, 'cases', id, 'cache', 'state.json'));
      let baseline = st && st.world === url && Array.isArray(st.checks) ? st.checks.filter((c) => c.check === 'sightline') : null;
      if (!baseline || !baseline.length) {
        const { world: orig } = await loadWorld(id, url);
        baseline = (await checks.runAll(orig)).filter((c) => c.check === 'sightline');
      }
      const changed = results.filter((c) => c.check === 'sightline').map((c) => {
        const b = baseline.find((x) => x.subject === c.subject);
        return b && b.pass !== c.pass ? { subject: c.subject, before: b.pass ? 'clear' : `blocked by ${b.blockedBy}`, after: c.pass ? 'clear' : `blocked by ${c.blockedBy}` } : null;
      }).filter(Boolean);
      const out = {
        caseId: id, mode: MODE, world: url, object, targetMph, origMph: analysis.origMph,
        sentence: analysis.sentence, analysis, assumptions: analysis.assumptions,
        checks: results, baselineSightlines: baseline, changedSightlines: changed,
        kinematicLabel: checks.KINEMATIC_LABEL || null,
        label: 'WHAT-IF (counterfactual re-timing of the reconstruction) - analysis draft, not evidence',
        seconds: Math.round((Date.now() - t0) / 100) / 10,
      };
      if (memo.size > 200) memo.delete(memo.keys().next().value);
      memo.set(key, out);
      res.set('X-WhatIf-Cache', 'miss').json(out);
    } catch (e) {
      res.status(e.status || 500).json({ error: errMsg(e) });
    }
  });
}
