#!/usr/bin/env bash
# Serialize heavy local work (headless Chromium renders, Blender, ffmpeg) across parallel agents.
# Usage: scripts/render_lock.sh <command...>   — waits up to 10 min for the lock.
# Priority gate: while /tmp/sightline-render.priority exists, callers without SIGHTLINE_RENDER_PRIORITY=1 wait (max 15 min).
if [ -z "$SIGHTLINE_RENDER_PRIORITY" ]; then
  for i in $(seq 1 180); do [ -f /tmp/sightline-render.priority ] || break; sleep 5; done
fi
exec flock -w 600 /tmp/sightline-render.lock nice -n 5 "$@"
