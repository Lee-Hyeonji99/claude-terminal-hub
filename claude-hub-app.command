#!/usr/bin/env bash
# Claude Terminal Hub — macOS/Linux Electron 앱 런처.
# Finder 에서 더블클릭하거나 터미널에서 `./claude-hub-app.command` 로 실행.
# Windows 는 claude-hub-app.cmd / .vbs 사용.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

ELECTRON_BIN="$ROOT/node_modules/.bin/electron"

if [ ! -x "$ELECTRON_BIN" ]; then
  echo "[claude-hub-app] Electron 이 없어 설치합니다 (npm install)…"
  npm install
fi

if [ ! -x "$ELECTRON_BIN" ]; then
  echo "[claude-hub-app] Electron 설치 실패. 수동으로 'npm install' 후 다시 실행하세요." >&2
  exit 1
fi

# 앱 창을 백그라운드로 띄우고 런처는 즉시 종료 (터미널 점유 안 함)
"$ELECTRON_BIN" "$ROOT/electron/main.js" >/dev/null 2>&1 &
disown 2>/dev/null || true
