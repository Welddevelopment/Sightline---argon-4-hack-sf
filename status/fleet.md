# Fleet: verification + render fleet on Gemini Managed Agents

Owner files: `argon/fleet.mjs`, `argon/fleet_sandbox/run_task.mjs`, `argon/fleet_sandbox/render_view.mjs`,
`argon/prompts/fleet_{plan,merge,agent}.md`, `cases/<id>/cache/fleet/**`.

## What works (live, verified 2026-10-25)
- **API:** `ai.interactions.create({ agent: 'antigravity-preview-09-2026', agent_config: { type: 'antigravity', model: 'gemini-3.8-flash' }, background: true, environment: { type: 'remote', network: { allowlist: [...] }, sources: [...] }, input })`, then poll `ai.interactions.get(id)` until `status === 'completed'`. `output_text` holds the agent's reply, `steps` holds its tool calls (`code_execution_call`, `view_file`, …), and `environment_id` names the sandbox.
- Models listed on this key: `antigravity-preview-05-2026`, `antigravity-preview-09-2026` and `antigravity-preview-latest`, plus Flash models up to `gemini-3.8-flash`. The sandbox runs Linux with 10 vCPU, Node v22.23 and Python 3.12. `git` and `npm` work when the domain is on the allowlist.
- **Getting code in:** an environment `sources` entry of `{type:'repository', source:'https://github.com/Welddevelopment/Sightline---argon-4-hack-sf', target:'/workspace/repo'}` mounts the public repo in about 40 s with no clone step. Entries of `{type:'inline', target, content}` upload exact files: the world, the task JSON and the runner. A `git clone --depth 1` inside the sandbox also works (about 6 s) when `github.com` is allowlisted.
- **Getting results out:** `GET v1beta/environments/{environment_id}/files/workspace/job/<path>?alt=media` with the API key header, sent from our process only. Environments **persist** after the run: `node argon/fleet.mjs demo-full --rehydrate` re-downloads every result and still from `run.json` without starting any agents. The SDK's `ai.environments.files.list` is broken in 2.31 ("Parameter 'environment' must be a string"), so we use raw fetch.
- **Security:** the key is never in a prompt, a source, an env var or the allowlist. `fleet.mjs` refuses to upload anything that contains a key-like string. Egress is limited to npm and GitHub.

## Pipeline (`runFleet({caseId, tasks?})`)
1. **Argon plans** (gemini-4-argon, `prompts/fleet_plan.md`). It reads `cache/state.json`: world, the 4 witnesses' local sightline, robustness and gaze results, other checks, and findings F1–F6. It emits a job list with a reason for each job. `sanitizePlan` keeps the valid jobs and adds anything missing for coverage: full suite, PRT, sightline, robustness and gaze per witness, and renders.
2. **Dispatch.** Every job becomes its own Managed Agent and all of them run in parallel. Each sandbox gets the repo mounted plus `world.js`, `task.json` and the runner sent inline. It runs `npm i three` and then one command:
   - `run_task.mjs` handles `full_checks` (equivalent to `node checks/run_checks.mjs`), `sightline` (ray-cast plus a 0.25 s timeline), `robustness` (the standard 25-position 2 m disc plus discs of 0.5–8 m), `gaze` (plus alternate gaze marks), `prt`, `whatif_speed` (target ×k at the same impact time and place) and `whatif_time` (±2 s).
   - `render_view.mjs` is a software rasterizer with no GPU or browser. It draws 51 frames at 2 fps, 480×270, plus a still. It also computes an **independent pixel item-buffer visibility**: a zoom camera fitted to the target, with `fraction` honouring `occludes:false` the way the ray-cast does, and `rawFraction` counting every mesh.
   
   The Flash agent runs the command, reads only the result file and returns `{ran, summary_line, interpretation}`. We then pull the result JSON (not the model's transcription) from the sandbox.
3. **Compare.** A machine-made table checks fleet results against local checks on these metrics: visible@tObs, blocked/25, gaze°, raycast+pixels, and full-suite pass/fail. A `codeDrift` field compares sha256 of the sandbox `checks/*.js` (GitHub main) with the local copies.
4. **Argon merges** (`prompts/fleet_merge.md`) into `{headline, agreements, disagreements, sensitivities, finding_updates}`, written to `report.md`.

Run modes:
- `node argon/fleet.mjs demo-full --live` (or `FLEET_LIVE=1`). This needs `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=…` here.
- `node argon/fleet.mjs demo-full` replays `run.json` and makes no API calls. Live mode is opt-in on purpose because `.env` sets `SIGHTLINE_MODE=live`.
- A live run moves the previous run to `cache/fleet/history/<timestamp>/`.

## Live results: case demo-full, world `world_v2.js` (sha 526ea902d593; v4 had not landed)
| run | plan | agents | ok | fleet wall | sequential (sum of agent walls) | speedup | sandbox compute | tokens |
|---|---|---|---|---|---|---|---|---|
| run 2 (current `run.json`) | **Argon** (16 s) | 22 | 22 | **345 s** | 5,204 s | **15.1×** | 116 s | 489k |
| run 1 (`history/run1_v2_defaultplan`) | default | 18 | 18 | 649 s | 7,390 s | 11.4× | 106 s | — |

The run 2 agent prompt said "read only the result file". In run 1, agents spent 25 steps auditing the code, which roughly doubled wall time and tokens.

- **Agreement: 17/17 machine-compared metrics.** Visibility matches for all 4 witnesses. The robustness counts match: wit_A 0/25, wit_B 21/25, wit_C 0/25 and wit_D 25/25 blocked. Gaze angles match: 2.8°, 31.5°, 7.0° and 1.2°. The full suite matches 10/10 pass/fail. `codeDrift` is none: GitHub main has the same checks code as local.
- **Pixel renders agree with the ray-cast:** wit_A 100% px, wit_B 0%, wit_C 99%, wit_D 0%. Run 1 surfaced two real render-vs-ray gaps:
  - At 466 m, the target car was under one pixel in the POV view.
  - The renderer counted the witness's own cab (marked `occludes:false`) as an occluder.
  
  Both are fixed with the zoom camera and the occludes-aware pass. The raw fraction is still reported: 0% for wit_A and wit_C, where the cab mesh has no glass.
- **New sensitivities (what-if jobs), via Argon:**
  - **Witness B** is clear from t=7.8 to 9.3 s. She is blocked at 9.8 s by `veh_T_tractor` and from 10.3 to 10.8 s by `occ_shelter`.
  - Her view at 9.8 s only clears if Vehicle A was ≥20% faster (k≥1.2).
  - Within 1 m of her mark, she is 25/25 blocked. Moving out to 5–8 m from her mark, she is still 17/25 blocked.
  - This strengthens F1 and narrows it: she could have seen the car up to about 0.5 s before her stated moment.
- **Disagreement Argon flagged:** for wit_D, the sandbox ray reports blocker `bld_store`, while local state says `occ_store_front`. The robustness disc shows both co-located meshes block the view (22 vs 3). The verdict is the same, but the label differs.
- `prt_all`: both drivers had 10.43 s of continuous sightline, against a 1.0–2.5 s PRT range. This supports F5.

Cache: `cases/demo-full/cache/fleet/` contains:
- `run.json` (timings, agents, comparison, report, interaction/env ids)
- `report.md`
- `plan.json` (Argon's raw plan) and `plan_final.json`
- `merge.json`
- `jobs/<id>.json` (full sandbox result + agent reply + usage)
- `renders/{overhead,wit_A..D}.png`
- `history/`

## Caveats / honest limits
- Per-job compute is 1–20 s. Agent orchestration is 150–340 s per job, including about 40 s to mount the repo and npm. The fleet pays off because N jobs cost the same wall time as one.
- Sandboxes mount GitHub `main`, which is auto-pushed WIP. The world file is uploaded inline, so the world is exact, and `codeDrift` reports any checks-code mismatch.
- `whatif_speed` remaps time along the cited track for every moving object. It is an approximation and is labelled as one in the result.
- Renders are flat-shaded software rasters meant as verification evidence, not the hero renders. Frames stay in the sandbox; only stills are downloaded.
- Local CPU use stayed minimal: a few 2 s parity runs and 96×54 render smoke tests. `render_lock.sh` and headless Chromium were not used.

## Pitch paragraph: Best use of Managed Agents
Sightline's lead investigator, Gemini 4 Argon, doesn't trust its own reconstruction; it **plans an audit and farms it out**. For every witness it dispatches a fleet of Google-hosted Managed Agents (22 on our demo case), each in its own sandbox with its own compute. Each agent mounts the public repo, receives the exact world file, and runs one independent check: a ray-cast sightline, a 25-position robustness disc, the gaze angle, perception-reaction time, speed and timing what-if sweeps, or a CPU software render with pixel-level visibility. The fleet finishes in 345 s against an estimated 87 min sequential (15×) and puts no load on our build machine. Argon then merges the returned JSON against its local checks: 17/17 agree, two render-vs-ray modelling gaps were caught and fixed, and a new fact emerged. Witness B could see the car until 0.5 s before her stated moment, and only a ≥20% speed change would clear her view. The sandboxes are load-bearing: they are the independent second opinion that turns "the model says" into "22 isolated machines reproduced it".
