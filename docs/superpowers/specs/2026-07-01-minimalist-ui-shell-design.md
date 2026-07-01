# Minimalist UI Shell Design

Date: 2026-07-01

## Context

Codims is a local, static Three.js monitor for Codex threads and subagents. It currently uses a full-width header, a 3D scene, and a permanent right details panel that combines the action inbox with selected thread details.

The approved direction is to make the 3D scene the primary app surface. Default controls should become small HUD elements and detailed workflows should move into overlays on top of the canvas.

## Assumptions

- This is a surgical UI shell revamp, not a full scene redesign.
- The current rooms, workers, digest objects, handoff arcs, review state model, and server API remain intact.
- The app stays static and no-build: Python stdlib server, vendored Three.js, no React, no bundler, no new hosted dependency.
- Minimalism means fewer persistent controls, not less information when an overlay is intentionally opened.
- Dense review and thread inspection still need readable list/detail surfaces.

## Goal

Make the first viewport a full 3D canvas with only minimal operational HUD controls.

Success means:

- No permanent header, toolbar, right sidebar, or empty helper panel is visible by default.
- The first screen is dominated by the 3D scene.
- Counters, status, inbox access, and settings access remain reachable without visual bulk.
- Action inbox and selected thread details remain readable when opened.
- Existing monitoring behavior remains familiar.

## Non-Goals

- No framework migration.
- No server API changes.
- No new thread workflow or review semantics.
- No search replacement in this pass.
- No full 3D room redesign in this pass.
- No mobile-specific bottom sheet model in this pass.

## Approved Direction

Use Approach A: surgical UI shell revamp.

Keep most scene and data logic intact. Replace the surrounding app chrome with:

- full-viewport scene
- corner HUD controls
- action inbox drawer overlay
- floating inspector overlay
- settings/filter overlay

## Default Visible UI

Visible by default:

- Tiny status indicator without the `Codims` brand title.
- Three global counters: running now, visible threads, projects.
- Inbox icon with badge count.
- Gear icon for settings and filters.

Placement:

- Status and action icons use corner HUD placement.
- Counters sit in the bottom-left corner.
- Inbox and gear sit in the top-right corner.

Removed from the default view:

- `Codims` title and brand mark.
- Full header.
- Max age input.
- Density selector.
- Search input.
- Live/Pause toggle.
- Labels toggle.
- Privacy toggle.
- Show idle toggle.
- Permanent right details panel.
- `Click a worker to inspect its thread.` helper text.
- Empty scene message.

## Behavior Changes

### Live Refresh

The app is always live. Remove the visible pause/resume control. Polling continues while the app is open using the existing refresh behavior.

### Labels

Labels are always on. Remove the global labels toggle.

Future label direction is more in-world nameplates where reasonable, but the first pass may keep the existing HTML labels if moving them would expand scope. The first pass should avoid weakening readability.

### Search

Search is removed from the UI for this pass. No hidden shortcut or replacement command palette is required.

### Density

Density becomes automatic by default. Manual density can live in advanced settings if preserving the existing control is cheaper than removing the state path. It should not appear in the default HUD.

### Privacy And Filters

Privacy, max age, and show idle move into settings. They remain available but are not persistent HUD controls.

## Action Inbox Overlay

The action inbox becomes an overlay drawer opened from the inbox icon.

Requirements:

- Drawer is expanded/readable by default.
- Remove compact/expanded toggle.
- Keep all four filter chips inside the drawer: `Needs review`, `Running`, `Stale`, `Reviewed`.
- Merge `Hide stale` and `Unreviewed only` into the filter chip model.
- Use a compact check icon or checkbox-style control for reviewed state instead of a wide `Review` or `Reviewed` button.
- Keep current action inbox item content: metadata, title, snippet/status.
- Opening an inbox item still focuses/selects the corresponding scene object and opens the inspector when applicable.

The drawer can be dismissed. It should not reserve permanent layout space.

## Inspector Overlay

Selected thread, digest, and parent timeline details move from the permanent right panel into a floating inspector overlay.

Requirements:

- Click scene object focuses the camera and opens the inspector.
- Keep all current fields visible for now:
  - nickname/title heading
  - state
  - role
  - project
  - age
  - title/content
  - parent thread
  - CWD
  - thread id
- Keep digest lists and parent timeline lists inside the inspector.
- Keep loaded thread content behavior.
- Remove message composer and send confirmation dialog UI for now because sending is disabled server-side.
- Remove the empty details helper text.

The inspector can be dismissed. Closing it should not clear scene data, only the visible overlay and selected-detail UI.

## Settings Overlay

The gear icon opens settings and filters.

Settings include:

- max age
- privacy
- show idle
- advanced density control or automatic density status

Settings should be compact and secondary. They are not the main workflow.

## Scene

Preserve existing first-pass scene behavior:

- Rooms, walls, signs, workers, digest objects, and handoff arcs stay.
- Strong running/done/reviewed status styling stays.
- Handoff arcs stay visible.
- Click selection keeps the existing focus animation and opens inspector.
- Empty scene message is removed.

Grid:

- Keep the grid.
- Make it feel infinite rather than like a bounded helper grid.
- This can be a visual improvement in the shell pass if low-risk. If it becomes nontrivial, keep the current grid and defer the infinite-grid treatment.

## Mobile And Narrow Screens

Use the same overlay model on narrow screens, adapted to smaller width.

Requirements:

- Do not restore the old stacked scene plus panel layout.
- HUD elements must fit without overlapping labels or the scene controls.
- Drawer and inspector should constrain to viewport width and height.
- Overlays should remain scrollable when content is long.

## Architecture

Keep file responsibilities close to the current code:

- `index.html`: shell structure for scene, HUD, overlays, and retained controls.
- `style.css`: full-screen layout, HUD placement, drawer, inspector, settings overlay, responsive rules.
- `app.js`: existing state, event binding, rendering, overlay open/close behavior, and DOM updates.
- `visual-model.mjs`: unchanged unless automatic density needs pure testable logic.

Implementation should avoid broad refactors. Prefer moving existing DOM sections into overlay containers and deleting controls that are explicitly removed.

Expected structural changes:

- Replace `.app-header` and `.app-layout` grid with a full-screen app shell.
- Keep `#scene` and `#labels` layered together.
- Add a HUD layer above the scene.
- Convert `.review-lane` into an inbox drawer body.
- Convert `.details-content` into a floating inspector body.
- Add a settings overlay that reuses retained control elements.

## Data Flow

No backend data flow changes are required.

Existing flow remains:

1. Poll `/api/threads`.
2. Filter and group thread data.
3. Reconcile rooms, agents, digest objects, labels, and handoffs.
4. Build action inbox from project groups and reviewed thread IDs.
5. Render HUD counters and inbox badge.
6. Render overlays only when opened or when selected content changes.

The selected object model should continue using the existing `selectedMode`, `selectedId`, `selectedDigest`, `selectedProject`, and related state. No parallel selection model is needed.

## Error Handling

No new network failure modes are introduced.

Expected handling:

- Existing app-server status text becomes the tiny status indicator.
- Fetch errors should remain visible through status.
- Long inspector content and inbox lists should scroll inside overlays.
- Local storage failures remain non-fatal, matching current behavior.
- If settings controls fail to persist, the app should continue with in-memory state.

## Testing And Verification

Automated checks:

- `node --check app.js`
- `node test_visual_model.mjs`
- `node test_ui_format.mjs`
- `python3 -m unittest -v`
- `npm run test:smoke` if local browser dependencies are available

Targeted test updates:

- Update smoke expectations that currently assert read-only controls in the old header/panel.
- Add smoke coverage that the scene renders full-screen.
- Add smoke coverage for opening and closing inbox drawer.
- Add smoke coverage for opening inspector by clicking or selecting a scene object if the existing smoke fixtures allow it.
- Add smoke coverage for settings overlay controls.

Visual verification:

- Desktop full viewport has no permanent header or right panel.
- Counters, status, inbox icon, and gear do not overlap labels.
- Inbox drawer is readable and dismissible.
- Inspector is readable and dismissible.
- Settings overlay exposes max age, privacy, show idle, and density behavior.
- Running/done/reviewed visual states remain clear.
- Mobile/narrow viewport keeps canvas-first layout with adapted overlays.

## Implementation Scope

Suggested first implementation pass:

1. Change shell layout to full-screen scene with HUD layer.
2. Move counters/status/actions into corner HUD.
3. Convert action inbox to drawer overlay.
4. Convert details panel to floating inspector overlay.
5. Add settings overlay for retained controls.
6. Remove search, live toggle, labels toggle, visible privacy toggle, visible idle toggle, empty helper text, empty scene message, and message composer UI.
7. Update tests and smoke assertions.
8. Run automated and browser visual verification.

Anything beyond this, including full 3D label/nameplate redesign or extensive scene geometry changes, should be deferred to a follow-up pass.
