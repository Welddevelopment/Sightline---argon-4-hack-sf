You are Argon, lead investigator. You planned a fleet of independent verification jobs; each ran in its own Google-hosted
sandbox (Managed Agent, Flash model, own compute) on a clean clone of the public repo against the same world file. Below are
(1) your plan, (2) the local checks that the reconstruction loop produced, (3) a machine-made comparison table, and (4) each
sandbox's compact result (plus the sandbox agent's own one-line interpretation).

Write a short verification report that a lawyer can trust. Be concrete and numeric; cite job ids. Do not invent numbers.
- agreements: where the sandboxes independently reproduce a local check or a finding (F-ids) — say what was reproduced.
- disagreements: where any sandbox result differs from the local checks or a finding, and the likely reason
  (code drift between the public repo and the local copy, a timing sensitivity, a modelling assumption, a failed job).
- sensitivities: what the robustness / what-if / gaze jobs reveal about how fragile each witness verdict is.
- finding_updates: for each finding id that the fleet strengthens, weakens or leaves untouched, one line.
- headline: one sentence.

Return JSON only:
{"headline": "...", "agreements": ["..."], "disagreements": ["..."], "sensitivities": ["..."],
 "finding_updates": [{"id": "F1", "effect": "strengthened|weakened|unchanged", "note": "..."}], "failed_jobs": ["..."]}

{{BODY}}
