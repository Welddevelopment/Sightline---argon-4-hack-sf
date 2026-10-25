#!/usr/bin/env bash
# Serialize heavy local work (headless Chromium renders, Blender, ffmpeg) across parallel agents.
# Usage: scripts/render_lock.sh <command...>   — waits up to 10 min for the lock.
exec flock -w 600 /tmp/sightline-render.lock nice -n 5 "$@"
