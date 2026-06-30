# Codims

[![CI](https://github.com/jdelaire/codims/actions/workflows/ci.yml/badge.svg)](https://github.com/jdelaire/codims/actions/workflows/ci.yml)

Codims is a local 3D monitor for Codex threads and subagents. It renders projects as rooms, main threads as larger characters, and child agents as smaller workers around them.

The app is intentionally small:

- Python stdlib server.
- Static browser frontend.
- Vendored Three.js runtime.
- No React, bundler, database, or hosted backend.

## Features

- Groups Codex threads by project room.
- Shows active threads by default.
- Hides stale or idle agents unless toggled on.
- Colors agents by common parent thread.
- Shows active handoff arcs between main threads and active agents.
- Click a room or agent to center the camera on that room.
- Click a thread to inspect title, role, project, parent thread, agent prompt, and last response.
- Message sending is temporarily disabled.

## Requirements

- macOS or another local environment with Codex CLI installed.
- Python 3.11 or newer.
- A browser with WebGL.

## Run

```bash
python3 server.py --port 8765
```

By default, Codims listens on `0.0.0.0` so it can be reached from other devices on your network. Open locally:

```text
http://127.0.0.1:8765/
```

From another device, use your machine's LAN IP:

```text
http://<machine-ip>:8765/
```

Quick launch on macOS:

```bash
./launch.sh
```

Override defaults:

```bash
HOST=127.0.0.1 PORT=9000 CODEX_BIN=codex ./launch.sh
```

The server talks to Codex through:

```bash
codex app-server --listen stdio://
```

## Tests

```bash
python3 -m unittest -v
node --check app.js
node test_visual_model.mjs
```

## API

```text
GET /api/threads?maxAgeHours=8
GET /api/thread/<thread-id>
POST /api/thread/<thread-id>/message
```

Message sending is temporarily disabled server-side.

## Privacy

Codims is local-first. It does not run a hosted backend and does not require API keys.

It reads Codex thread metadata and content from your local Codex app-server process. Three.js is vendored under `vendor/three/` so Codims can run without a build step or CDN dependency.

Do not commit local Codex state databases, `.env` files, logs, keys, screenshots with private content, or exported thread dumps.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
