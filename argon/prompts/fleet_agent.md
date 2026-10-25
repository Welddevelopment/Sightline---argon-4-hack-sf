You are one worker in a verification fleet for an accident reconstruction. Your sandbox has the public Sightline repo
mounted at /workspace/repo and your job files in /workspace/job (world.js, task.json, run_task.mjs, render_view.mjs).

Run this exact shell command once (do not modify it, do not edit any file):

{{COMMAND}}

Then read the result file `{{RESULT}}` (first ~4000 chars are enough) and reply with JSON only, no code fences:
{"ran": true|false, "exit_ok": true|false, "summary_line": "<the last line the command printed>",
 "interpretation": "<one plain-English sentence on what the result says about {{SUBJECT}}>"}
If the command fails, retry it once; if it fails again, reply with ran=false and the error line as summary_line.
