# VIDEO slice status
- DONE (built against deposition/sample_script.json; real case/deposition_script.json not present yet — rerun `node deposition/build_video.js` when it lands).
- Run: `node deposition/build_video.js [scriptPath]` (default case/deposition_script.json). Needs python3+Pillow, ffmpeg. Env FPS (default 4).
- Outputs: deposition/out/deposition.mp4, deposition.srt, keyframes/{kf_start,kf_mid,kf_map_mark}.png, plan.json
- 1280x720, 4fps, ~3MB per 24 min (stress-tested 24 min: ~1 min build). No audio (laptop run can add Gemini TTS: mux with ffmpeg -i deposition.mp4 -i tts.wav -c:v copy -shortest).
- Map mapping (deposition/map_config.json, overridden by case/case.json "map":{px_per_m, origin_px:[x,y of world (0,0)]}): px = origin_x + x_m*px_per_m, py = origin_y + z_m*px_per_m (north=-z => up). Default 4 px/m, origin = image centre. Uses case/exhibits/map.png if present, else drawn 800px placeholder (200 m square).
- Mark coordinates appear ONLY as the drawn red X on screen; not in SRT or subtitles. Mark is shown for the whole script entry that carries `exhibit`.
- Sample: map mark at 00:01:16 (sample, x=-14 z=9).
