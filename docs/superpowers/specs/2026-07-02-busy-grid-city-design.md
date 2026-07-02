# Busy Grid City Design

Date: 2026-07-02

## Goal

Evolve the Codims 3D scene from separated project rooms into a virtual Tron-inspired town.

Rooms become city blocks laid out on an ordered street grid. Roads and lanes connect the blocks, and small animated light-cycle bikes move through the town with short energy trails. The scene should feel busier and more alive than the current room layout while staying readable as a monitoring tool.

## Approved Direction

User choices from visual brainstorming:

- Layout: ordered Grid city.
- Traffic behavior: ambient atmosphere.
- Traffic intensity: busy arcade.

Interpretation:

- Use a structured city-block arrangement rather than radial or ring-first layouts.
- Bikes are allowed to move even when they are not directly representing a thread handoff.
- Active work still gets priority through brighter, faster, more directional bike traffic.
- Dense bike traffic is desired, but must be capped so labels, rooms, and agents remain usable.

## Assumptions

- "Virtual town" means a readable grid of districts, blocks, roads, intersections, and moving traffic, not a realistic city simulation.
- "Bikes" means stylized light-cycle-like procedural geometry, not licensed film assets.
- Ambient traffic is decorative system life, not a new source of truth for workflow state.
- Existing project/thread data remains the only data source.
- The current static/no-build architecture remains required.

## In Scope

### City Block Layout

Replace the current floating room-only placement with a city-block presentation:

- Project rooms are positioned as blocks on a deterministic street grid.
- Roads run horizontally and vertically between room blocks.
- Intersections and road nodes create town structure and orientation.
- Existing packed-room layout behavior should remain the base so many projects still fit.
- The camera overview should frame the full town, not only the rooms.

### Road And Lane System

Add road geometry that makes relationships and movement legible:

- Main avenues run through the scene as cyan emissive strips.
- Active corridors can brighten or gain amber/cyan express treatment.
- Roads sit below labels and agents visually; they should not compete with DOM overlays.
- Roads should adapt to room placement instead of requiring hand-authored maps.

### Light-Cycle Bike Traffic

Add small moving bike objects that travel along road lanes:

- Ambient bikes loop continuously through available road paths.
- Active projects or active parent-child work create faster/brighter express bikes.
- Done/review-oriented traffic can use amber accents at lower visual priority.
- Bikes leave short additive trails behind them.
- Trails fade quickly to avoid full-screen light haze.

### Busy Arcade Intensity With Caps

The scene should feel busy, but not chaotic:

- More than one bike can be visible at once.
- Traffic count scales with viewport size and project count.
- There is a maximum visible-bike cap for dense scenes.
- Trail length and opacity are capped independently from bike count.
- Label-safe zones or render ordering prevent trails from making labels unreadable.

### Reduced Motion

Reduced motion must remain respected:

- Bikes stop moving or become static route markers.
- Trails reduce to static road glow.
- Active/selected room and agent signals remain visible without pulsing traffic.
- Existing reduced-motion smoke behavior must remain stable.

## Out Of Scope

- Physics, collision, pathfinding AI, or real traffic simulation.
- GLTF/GLB assets, image sprite pipelines, new renderers, shaders, or post-processing dependencies.
- Licensed Tron vehicles, logos, or exact film designs.
- New server APIs, thread payload fields, or persisted traffic state.
- Changes to review workflow, inbox filtering semantics, settings behavior, privacy mode, or inspector content.
- Major non-Tron theme support.

## Architecture

Keep current ownership boundaries:

- `app.js` owns Three.js materials, road/bike geometry, animation, scene reconciliation, picking, labels, and debug counters.
- `visual-model.mjs` owns deterministic layout math if road topology or city placement needs pure helpers.
- `style.css` should stay mostly untouched; DOM labels should not carry the new visual energy.
- `smoke/codims-smoke.spec.mjs` owns rendered invariant checks.
- Existing Python server code should not change.

Preferred implementation shape:

1. Build deterministic road topology from current project room placements.
2. Render road strips and intersections as lightweight Three.js primitives.
3. Create a small pool of bike objects and reuse them instead of rebuilding every frame.
4. Assign bikes to looping route segments based on ambient traffic budget and active project hints.
5. Animate bike positions along route segments in `animateAgents()` or a nearby scene-animation helper.
6. Expose semantic debug counters for roads, bikes, and reduced-motion behavior.

## Visual Design

### Roads

Roads should read as Tron Grid infrastructure:

- Thin cyan lane strips on the ground plane.
- Brighter centerlines for active corridors.
- Subtle intersection nodes at crossings.
- Minimal vertical height so rooms and agents remain dominant.

### Bikes

Bikes should be small and readable at scene scale:

- Low-poly procedural body, two light wheels, and a short glowing nose.
- Cyan for ambient and active traffic.
- Amber for done/review-oriented traffic.
- Active bikes can be slightly larger or brighter, not a completely different model.
- Trails are separate transparent geometry or line segments so they can be disabled cheaply.

### Labels

Labels remain disciplined:

- No broad label glow increase.
- Trails should not pass visually over labels if avoidable.
- DOM labels stay the top-readable layer.
- If label contrast regresses, reduce trail opacity before changing label styling.

## Traffic Semantics

Ambient traffic:

- Exists even when no thread handoff is active.
- Uses deterministic route selection so the scene does not flicker after refresh.
- Represents town life, not exact task count.

Active traffic:

- Projects with active threads get more frequent bikes on nearby roads.
- Existing handoff lanes can coexist with road bikes.
- Active bikes move faster and glow brighter than ambient bikes.

Done/review traffic:

- Done or review-heavy areas can get occasional amber bikes.
- Amber traffic should be visibly quieter than active cyan traffic.

## Density Rules

Use practical caps rather than unlimited traffic:

- Minimum ambient bikes: enough to make the town feel alive when projects exist.
- Maximum bikes: based on viewport and project count.
- Dense scenes should favor short trails over more vehicles.
- Small/mobile viewports should reduce bike count and trail length.
- Privacy mode should not affect traffic count unless labels or project identifiers are hidden; traffic has no text.

## Data Flow

No data contract changes are required.

Inputs:

- Existing project room placements.
- Existing project/thread active, done, reviewed, and selected states.
- Existing reduced-motion state.
- Existing viewport size and density settings.

Derived scene data:

- Road segments from city block placement.
- Bike routes from road segments.
- Traffic budget from project count, active thread count, viewport size, and reduced-motion state.

## Testing

Required automated checks:

- `npm run test:js`
- `npm run test:smoke`
- `python3 -m unittest -v`
- `git diff --check`

Expected new or updated checks:

- Pure tests in `test_visual_model.mjs` if road topology or route generation moves into `visual-model.mjs`.
- Smoke counters for road segments, bike objects, and trail objects.
- Reduced-motion smoke assertion that animated bikes report `0` moving bikes or equivalent static state.
- Existing Tron palette guard must continue to pass.

Required rendered QA:

- Desktop default town.
- Desktop dense project town.
- Mobile viewport.
- Reduced-motion viewport.
- Inbox/settings/inspector interaction after town rendering.
- No relevant console errors.

## Success Criteria

- The scene reads as a virtual Grid town at first glance.
- Rooms still look like project rooms, now embedded as city blocks.
- Bikes and trails make the scene feel busy and alive.
- Active work is easier to spot than ambient traffic.
- Dense scenes remain readable and navigable.
- Reduced-motion mode remains calm and stable.
- No new runtime dependency, build step, asset pipeline, or server API is introduced.

## Risks And Mitigations

- Risk: busy bikes obscure labels.
  - Mitigation: keep trails short, low opacity, below labels, and capped by viewport.
- Risk: roads make dense scenes feel more crowded.
  - Mitigation: derive roads from packed layout and omit secondary roads when blocks are too close.
- Risk: too many animated objects hurt performance.
  - Mitigation: pool bike meshes, cap bike count, and use simple primitives.
- Risk: ambient traffic is mistaken for real task state.
  - Mitigation: active traffic is brighter/faster; ambient traffic stays visually secondary.
- Risk: reduced motion regresses.
  - Mitigation: route all bike/trail animation through existing reduced-motion state and smoke assertions.
