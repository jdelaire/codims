#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8765}"
CODEX_BIN="${CODEX_BIN:-codex}"
URL_HOST="${HOST}"
if [[ "${HOST}" == "0.0.0.0" ]]; then
  URL_HOST="127.0.0.1"
fi
URL="http://${URL_HOST}:${PORT}/"
THREADS_URL="http://${URL_HOST}:${PORT}/api/threads?maxAgeHours=8"

port_is_listening() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - "${URL_HOST}" "${PORT}" >/dev/null 2>&1 <<'PY'
import socket
import sys

with socket.create_connection((sys.argv[1], int(sys.argv[2])), timeout=1):
    pass
PY
    return
  fi

  return 1
}

is_codims_server() {
  local body

  if command -v curl >/dev/null 2>&1; then
    body="$(curl -fsS --max-time 2 "${THREADS_URL}" 2>/dev/null || true)"
  elif command -v python3 >/dev/null 2>&1; then
    body="$(python3 - "${THREADS_URL}" 2>/dev/null <<'PY' || true
import sys
import urllib.request

with urllib.request.urlopen(sys.argv[1], timeout=2) as response:
    sys.stdout.buffer.write(response.read(1048576))
PY
)"
  else
    return 1
  fi

  case "${body}" in
    *'"source": "codex_app_server"'*|*'"source":"codex_app_server"'*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

if port_is_listening; then
  if is_codims_server; then
    echo "Codims already running at ${URL}"
    if command -v open >/dev/null 2>&1; then
      open "${URL}"
    fi
    exit 0
  fi

  echo "Port ${PORT} is already in use by another service." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found" >&2
  exit 1
fi

echo "Starting Codims at ${URL}"
if command -v open >/dev/null 2>&1; then
  (sleep 1 && open "${URL}") &
fi

exec python3 server.py --host "${HOST}" --port "${PORT}" --codex-bin "${CODEX_BIN}"
