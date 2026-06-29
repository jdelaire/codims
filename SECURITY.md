# Security

Codims is a local developer tool. It reads local Codex thread data through the Codex app-server and serves a browser UI on `127.0.0.1` by default.

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
