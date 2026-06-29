# Contributing

## Development

Run the app:

```bash
./launch.sh
```

Run checks before pushing:

```bash
python3 -m unittest -v
node --check app.js
node test_visual_model.mjs
```

## Privacy

Do not commit local Codex state files, `.env` files, logs, screenshots with private thread content, or exported thread dumps.

## Style

- Keep the backend Python stdlib-only unless a dependency is clearly needed.
- Keep browser code as ES modules.
- Prefer pure helpers in `visual-model.mjs` when behavior can be tested without WebGL.
- Keep message sending guarded server-side.
