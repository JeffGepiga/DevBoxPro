#!/usr/bin/env bash
set -euo pipefail

app_image="$(find "$HOME/devboxpro-wsl/dist" -maxdepth 1 -type f -name 'DevBox Pro-*-linux-x86_64.AppImage' | sort | tail -n 1)"

if [[ -n "$app_image" ]]; then
  chmod +x "$app_image"
  nohup "$app_image" >/tmp/devbox-pro.log 2>&1 </dev/null &
  disown || true
  echo "Started: $app_image"
  exit 0
fi

if command -v devbox-pro >/dev/null 2>&1; then
  nohup devbox-pro >/tmp/devbox-pro.log 2>&1 </dev/null &
  disown || true
  echo "Started installed devbox-pro"
  exit 0
fi

echo "No DevBox Pro AppImage found in ~/devboxpro-wsl/dist and devbox-pro is not installed." >&2
exit 1