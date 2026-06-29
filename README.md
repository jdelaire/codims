# Codims

Codims is a local 3D monitor for Codex threads and subagents. It renders projects as rooms, main threads as larger characters, and child agents as smaller workers around them.

The app is intentionally small:

- Python stdlib server.
- Static browser frontend.
- Three.js from CDN.
- No React, bundler, database, or hosted backend.

## Features

- Groups Codex threads by project room.
- Shows active threads by default.
- Hides stale or idle agents unless toggled on.
- Colors agents by common parent thread.
- Shows active handoff arcs between main threads and active agents.
- Click a room or agent to center the camera on that room.
- Click a thread to inspect title, role, project, parent thread, agent prompt, and last response.
- Send messages only to selected main threads with `role: "thread"`.

## Requirements

- macOS or another local environment with Codex CLI installed.
- Python 3.11 or newer.
- A browser with WebGL.
- Network access to `unpkg.com` for Three.js modules, unless you vendor those files locally.

## Run

```bash
python3 server.py --host 127.0.0.1 --port 8765
```

Open:

```text
http://127.0.0.1:8765/
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
GET /api/threads?activeMinutes=5&maxAgeHours=12
GET /api/thread/<thread-id>
POST /api/thread/<thread-id>/message
```

Message sending is guarded server-side and only works when the request role is `thread`.

## Privacy

Codims is local-first. It does not run a hosted backend and does not require API keys.

It reads Codex thread metadata and content from your local Codex app-server process. The browser downloads Three.js from `unpkg.com` by default. If you need fully offline use, vendor the Three.js files and update the import map in `index.html`.

Do not commit local Codex state databases, `.env` files, logs, keys, screenshots with private content, or exported thread dumps.

## License

MIT
