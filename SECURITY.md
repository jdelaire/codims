# Security

Codex Grid is a local developer tool. It reads local Codex thread data through the Codex app-server and serves a browser UI on `127.0.0.1` by default.

LAN access is available only when explicitly requested with `--host 0.0.0.0` or `HOST=0.0.0.0 ./launch.sh`. Do not use LAN mode on an untrusted network; Codex Grid has no authentication layer and displays local Codex thread metadata.

## Sensitive Data

Before publishing changes, check that commits do not include:

- API keys or access tokens.
- `.env` files.
- Local SQLite databases.
- Private keys or certificates.
- Logs or screenshots containing private thread content.
- Full local filesystem paths from private machines.

## Reporting Issues

Open a GitHub issue with reproduction steps and impact. Do not include secrets or private thread content in the report.
