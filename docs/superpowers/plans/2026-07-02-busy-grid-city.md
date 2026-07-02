# Busy Grid City Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current project-room scene into an ordered Tron Grid city with road lanes, intersections, and busy ambient light-cycle traffic.

**Architecture:** Add deterministic city topology and traffic planning helpers to `visual-model.mjs`, then render those helpers in `app.js` with lightweight Three.js primitives and pooled bike meshes. Keep labels, server APIs, inbox behavior, and CSS unchanged unless rendered QA proves a regression.

**Tech Stack:** Vanilla JavaScript modules, Three.js primitives, Playwright smoke tests, Node unit tests, Python unittest.

---

## Source Spec

Approved spec: `docs/superpowers/specs/2026-07-02-busy-grid-city-design.md`

Approved direction:

- Ordered Grid city layout.
- Ambient atmosphere.
- Busy arcade traffic intensity.
- Dense bike traffic with viewport and project-count caps.
- Reduced motion remains calm and stable.

## File Structure

Planned edits:

```text
visual-model.mjs
  Add pure road topology and traffic route helpers.

test_visual_model.mjs
  Add deterministic unit tests for road topology, traffic budgets, and bike routes.

app.js
  Import new helpers.
  Add city road state, road rendering, bike mesh pool, trail rendering, animation, disposal, and debug counters.

smoke/codims-smoke.spec.mjs
  Add rendered invariant checks for roads, intersections, bikes, trails, and reduced-motion bike animation.
```

No planned edits:

```text
style.css
server.py
test_server.py
package.json
```

## Pre-Flight

- [ ] Run:
  ```bash
  git status --short --branch
  ```
  Expected:
  ```text
  ## main is ahead of origin/main by at least 1 commit
  ```
- [ ] Confirm the worktree is clean before implementation. If files are dirty, inspect:
  ```bash
  git diff -- app.js visual-model.mjs test_visual_model.mjs smoke/codims-smoke.spec.mjs
  ```
- [ ] Do not add dependencies. `package.json` and lockfiles stay unchanged.

---

## Task 1: Pure City Topology And Traffic Planning

**Files:**
- Modify: `visual-model.mjs`
- Modify: `test_visual_model.mjs`

### Intent

Create deterministic, testable city-road and bike-route data before touching Three.js rendering.

### Steps

- [ ] **Step 1: Add failing imports to `test_visual_model.mjs`**

  Add these imports to the existing import list:

  ```js
  cityBikeRoutes,
  cityRoadTopology,
  cityTrafficBudget,
  ```

- [ ] **Step 2: Add pure topology and traffic tests**

  Add this block after the existing `projectRoomPlacements` assertions:

  ```js
  const cityPlacements = projectRoomPlacements([
    { width: 9.2, depth: 6.8 },
    { width: 9.2, depth: 6.8 },
    { width: 9.2, depth: 6.8 },
    { width: 9.2, depth: 6.8 },
  ]);
  const topology = cityRoadTopology(cityPlacements);
  assert.equal(topology.horizontalRoads.length, 3);
  assert.equal(topology.verticalRoads.length, 3);
  assert.equal(topology.intersections.length, 9);
  assert.equal(topology.bounds.width > 20, true);
  assert.equal(topology.bounds.depth > 15, true);
  assert.equal(topology.key.includes("h3-v3"), true);

  const oneRoomTopology = cityRoadTopology([{ x: 0, z: 0, width: 9.2, depth: 6.8, row: 0, col: 0 }]);
  assert.equal(oneRoomTopology.horizontalRoads.length, 2);
  assert.equal(oneRoomTopology.verticalRoads.length, 2);
  assert.equal(oneRoomTopology.intersections.length, 4);

  assert.equal(cityTrafficBudget({ projectCount: 0, activeProjectCount: 0, viewportWidth: 1200 }), 0);
  assert.equal(cityTrafficBudget({ projectCount: 1, activeProjectCount: 0, viewportWidth: 1200 }), 3);
  assert.equal(cityTrafficBudget({ projectCount: 8, activeProjectCount: 4, viewportWidth: 1600 }), 16);
  assert.equal(cityTrafficBudget({ projectCount: 8, activeProjectCount: 4, viewportWidth: 390 }), 9);

  const routes = cityBikeRoutes(topology, [
    { project: "codims", x: cityPlacements[0].x, z: cityPlacements[0].z, hasActiveThreads: true, doneCount: 0 },
    { project: "hopper", x: cityPlacements[1].x, z: cityPlacements[1].z, hasActiveThreads: false, doneCount: 2 },
    { project: "api", x: cityPlacements[2].x, z: cityPlacements[2].z, hasActiveThreads: false, doneCount: 0 },
  ], { viewportWidth: 1200 });
  assert.equal(routes.length >= 4, true);
  assert.equal(routes.some((route) => route.kind === "active"), true);
  assert.equal(routes.some((route) => route.kind === "done"), true);
  assert.equal(routes.every((route) => route.id && route.segmentId), true);
  assert.equal(routes.every((route) => route.trailLength >= 0.7 && route.trailLength <= 1.8), true);

  const reducedRoutes = cityBikeRoutes(topology, [
    { project: "codims", x: 0, z: 0, hasActiveThreads: true, doneCount: 0 },
  ], { viewportWidth: 1200, reducedMotion: true });
  assert.equal(reducedRoutes.length, 2);
  assert.equal(reducedRoutes.every((route) => route.speed === 0), true);
  ```

- [ ] **Step 3: Run red test**

  Run:
  ```bash
  npm run test:js
  ```
  Expected failure:
  ```text
  SyntaxError: The requested module './visual-model.mjs' does not provide an export named 'cityBikeRoutes'
  ```

- [ ] **Step 4: Add city helpers to `visual-model.mjs`**

  Add this code after `projectRoomPlacements()`:

  ```js
  const CITY_ROAD_MARGIN = 1.2;
  const CITY_BIKE_MAX_DESKTOP = 18;
  const CITY_BIKE_MAX_MOBILE = 9;

  function groupRoomsByIndex(rooms, key) {
    const groups = new Map();
    for (const room of rooms) {
      const value = Number.isFinite(Number(room[key])) ? Number(room[key]) : 0;
      const current = groups.get(value) || [];
      current.push(room);
      groups.set(value, current);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a - b);
  }

  function roomBounds(room) {
    const width = Math.max(1, Number(room.width || 9.2));
    const depth = Math.max(1, Number(room.depth || 6.8));
    const x = Number(room.x || 0);
    const z = Number(room.z || 0);
    return {
      minX: x - width / 2,
      maxX: x + width / 2,
      minZ: z - depth / 2,
      maxZ: z + depth / 2,
    };
  }

  function roadId(prefix, value) {
    return `${prefix}-${Number(value).toFixed(3)}`;
  }

  export function cityRoadTopology(placements) {
    const rooms = (placements || [])
      .filter((placement) => placement && Number.isFinite(Number(placement.x)) && Number.isFinite(Number(placement.z)))
      .map((placement, index) => ({
        index,
        x: Number(placement.x),
        z: Number(placement.z),
        width: Math.max(1, Number(placement.width || 9.2)),
        depth: Math.max(1, Number(placement.depth || 6.8)),
        row: Number.isFinite(Number(placement.row)) ? Number(placement.row) : 0,
        col: Number.isFinite(Number(placement.col)) ? Number(placement.col) : index,
      }));

    if (!rooms.length) {
      return {
        horizontalRoads: [],
        verticalRoads: [],
        intersections: [],
        bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0, width: 0, depth: 0 },
        key: "empty",
      };
    }

    const boundsList = rooms.map(roomBounds);
    const minX = Math.min.apply(null, boundsList.map((bounds) => bounds.minX)) - CITY_ROAD_MARGIN;
    const maxX = Math.max.apply(null, boundsList.map((bounds) => bounds.maxX)) + CITY_ROAD_MARGIN;
    const minZ = Math.min.apply(null, boundsList.map((bounds) => bounds.minZ)) - CITY_ROAD_MARGIN;
    const maxZ = Math.max.apply(null, boundsList.map((bounds) => bounds.maxZ)) + CITY_ROAD_MARGIN;

    const rowGroups = groupRoomsByIndex(rooms, "row");
    const colGroups = groupRoomsByIndex(rooms, "col");

    const horizontalZ = [minZ];
    for (let index = 0; index < rowGroups.length - 1; index += 1) {
      const currentMax = Math.max.apply(null, rowGroups[index][1].map((room) => roomBounds(room).maxZ));
      const nextMin = Math.min.apply(null, rowGroups[index + 1][1].map((room) => roomBounds(room).minZ));
      horizontalZ.push(Number(((currentMax + nextMin) / 2).toFixed(3)));
    }
    horizontalZ.push(maxZ);

    const verticalX = [minX];
    for (let index = 0; index < colGroups.length - 1; index += 1) {
      const currentMax = Math.max.apply(null, colGroups[index][1].map((room) => roomBounds(room).maxX));
      const nextMin = Math.min.apply(null, colGroups[index + 1][1].map((room) => roomBounds(room).minX));
      verticalX.push(Number(((currentMax + nextMin) / 2).toFixed(3)));
    }
    verticalX.push(maxX);

    const horizontalRoads = horizontalZ.map((z) => ({
      id: roadId("h", z),
      axis: "x",
      z,
      startX: Number(minX.toFixed(3)),
      endX: Number(maxX.toFixed(3)),
      length: Number((maxX - minX).toFixed(3)),
    }));
    const verticalRoads = verticalX.map((x) => ({
      id: roadId("v", x),
      axis: "z",
      x,
      startZ: Number(minZ.toFixed(3)),
      endZ: Number(maxZ.toFixed(3)),
      length: Number((maxZ - minZ).toFixed(3)),
    }));
    const intersections = horizontalRoads.flatMap((horizontal) =>
      verticalRoads.map((vertical) => ({
        id: `${horizontal.id}-${vertical.id}`,
        x: vertical.x,
        z: horizontal.z,
      })),
    );

    return {
      horizontalRoads,
      verticalRoads,
      intersections,
      bounds: {
        minX: Number(minX.toFixed(3)),
        maxX: Number(maxX.toFixed(3)),
        minZ: Number(minZ.toFixed(3)),
        maxZ: Number(maxZ.toFixed(3)),
        width: Number((maxX - minX).toFixed(3)),
        depth: Number((maxZ - minZ).toFixed(3)),
      },
      key: `h${horizontalRoads.length}-v${verticalRoads.length}-${rooms.map((room) => `${room.index}:${room.x},${room.z}`).join("|")}`,
    };
  }

  export function cityTrafficBudget({ projectCount = 0, activeProjectCount = 0, viewportWidth = 1200 } = {}) {
    const projects = Math.max(0, Number(projectCount) || 0);
    if (!projects) {
      return 0;
    }
    const active = Math.max(0, Number(activeProjectCount) || 0);
    const mobile = Number(viewportWidth || 1200) < 640;
    const cap = mobile ? CITY_BIKE_MAX_MOBILE : CITY_BIKE_MAX_DESKTOP;
    const raw = Math.ceil(projects * 1.2 + active * 1.2 + 1);
    return Math.max(2, Math.min(cap, raw));
  }

  function nearestRoadSegment(topology, room, index) {
    const roads = (topology.horizontalRoads || []).concat(topology.verticalRoads || []);
    if (!roads.length) {
      return null;
    }
    return roads
      .map((road) => ({
        road,
        distance:
          road.axis === "x"
            ? Math.abs(Number(room.z || 0) - road.z)
            : Math.abs(Number(room.x || 0) - road.x),
      }))
      .sort((a, b) => a.distance - b.distance || String(a.road.id).localeCompare(String(b.road.id)))[index % roads.length]
      .road;
  }

  export function cityBikeRoutes(topology, roomStates = [], options = {}) {
    const roads = (topology?.horizontalRoads || []).concat(topology?.verticalRoads || []);
    if (!roads.length) {
      return [];
    }
    const activeProjectCount = roomStates.filter((room) => room.hasActiveThreads).length;
    const budget = cityTrafficBudget({
      projectCount: roomStates.length || 1,
      activeProjectCount,
      viewportWidth: options.viewportWidth,
    });
    const fullRouteCount = Math.min(budget, Math.max(2, roads.length * 2));
    const routeCount = options.reducedMotion ? Math.min(2, fullRouteCount) : fullRouteCount;
    const routes = [];
    for (let index = 0; index < routeCount; index += 1) {
      const room = roomStates[index % Math.max(1, roomStates.length)] || {};
      const road = nearestRoadSegment(topology, room, index) || roads[index % roads.length];
      const active = Boolean(room.hasActiveThreads);
      const done = !active && Number(room.doneCount || 0) > 0;
      const kind = active ? "active" : done ? "done" : "ambient";
      const speed = options.reducedMotion ? 0 : active ? 0.22 : done ? 0.1 : 0.14;
      routes.push({
        id: `bike-${index}-${kind}-${road.id}`,
        segmentId: road.id,
        axis: road.axis,
        kind,
        speed,
        phase: Number(((index * 0.173) % 1).toFixed(3)),
        trailLength: active ? 1.8 : done ? 1.1 : 1.35,
        roomProject: room.project || null,
      });
    }
    return routes;
  }
  ```

- [ ] **Step 5: Run unit tests**

  Run:
  ```bash
  npm run test:js
  ```
  Expected:
  ```text
  > test:js
  > node --check app.js && node test_visual_model.mjs && node test_ui_format.mjs && node test_three_disposal.mjs && node test_tron_palette.mjs
  ```
  Exit code `0`.

- [ ] **Step 6: Commit**

  Run:
  ```bash
  git add visual-model.mjs test_visual_model.mjs
  git commit -m "Add Grid city topology model"
  ```

---

## Task 2: Add Rendered Invariant Smoke Tests

**Files:**
- Modify: `smoke/codims-smoke.spec.mjs`

### Intent

Lock rendered city primitives before app rendering is implemented.

### Steps

- [ ] **Step 1: Add failing city assertions to main smoke test**

  In `renders nonblank scene and action inbox`, after `roomCircuitPulseSurfaces`, add:

  ```js
  expect(sceneDebug.cityRoadSegments).toBeGreaterThanOrEqual(4);
  expect(sceneDebug.cityIntersections).toBeGreaterThanOrEqual(4);
  expect(sceneDebug.lightCycleBikes).toBeGreaterThanOrEqual(2);
  expect(sceneDebug.lightCycleTrails).toBeGreaterThanOrEqual(2);
  expect(sceneDebug.animatedLightCycles).toBeGreaterThanOrEqual(1);
  ```

- [ ] **Step 2: Add failing reduced-motion bike assertion**

  In `reduced motion keeps scene animation static`, after `expect(sceneDebug.animatedDataLanes).toBe(0);`, add:

  ```js
  expect(sceneDebug.lightCycleBikes).toBeGreaterThanOrEqual(2);
  expect(sceneDebug.animatedLightCycles).toBe(0);
  ```

- [ ] **Step 3: Run red smoke subset**

  Run:
  ```bash
  npm run test:smoke -- --grep "renders nonblank scene|reduced motion keeps scene animation static"
  ```
  Expected failure:
  ```text
  Expected: >= 4
  Received: undefined
  ```

- [ ] **Step 4: Commit**

  Run:
  ```bash
  git add smoke/codims-smoke.spec.mjs
  git commit -m "Test Grid city rendered invariants"
  ```

---

## Task 3: Render City Roads And Intersections

**Files:**
- Modify: `app.js`

### Intent

Render deterministic road strips and intersection nodes below rooms, agents, and labels.

### Steps

- [ ] **Step 1: Import city topology helper**

  Extend the import from `./visual-model.mjs`:

  ```js
  cityRoadTopology,
  ```

- [ ] **Step 2: Add city state**

  In the `state` object, after `handoffs: new Map(),`, add:

  ```js
  cityRoadLayer: null,
  cityRoadTopologyKey: null,
  cityRoadSegments: new Map(),
  cityIntersections: new Map(),
  lightCycles: new Map(),
  lightCycleRoutes: [],
  ```

- [ ] **Step 3: Add road marker helpers**

  Near `markRoomCircuitPulseSurface()`, add:

  ```js
  function markCityRoadSegment(object) {
    object.userData.cityRoadSegment = true;
    return object;
  }

  function markCityIntersection(object) {
    object.userData.cityIntersection = true;
    return object;
  }
  ```

- [ ] **Step 4: Add road rendering helpers**

  Add this block before `reconcileRooms(projectGroups)`:

  ```js
  function createRoadMaterial(opacity = 0.34) {
    return new THREE.MeshBasicMaterial({
      color: gridStudio.cyan,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  function createCityRoadLayer(topology) {
    const layer = new THREE.Group();
    layer.name = "GridCityRoads";
    layer.userData.cityRoadLayer = true;

    for (const road of topology.horizontalRoads) {
      const mesh = markCityRoadSegment(new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(0.1, road.length), 0.018, 0.18),
        createRoadMaterial(0.28),
      ));
      mesh.position.set((road.startX + road.endX) / 2, 0.055, road.z);
      mesh.userData.roadId = road.id;
      mesh.userData.axis = road.axis;
      layer.add(mesh);
      state.cityRoadSegments.set(road.id, mesh);
    }

    for (const road of topology.verticalRoads) {
      const mesh = markCityRoadSegment(new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.018, Math.max(0.1, road.length)),
        createRoadMaterial(0.28),
      ));
      mesh.position.set(road.x, 0.055, (road.startZ + road.endZ) / 2);
      mesh.userData.roadId = road.id;
      mesh.userData.axis = road.axis;
      layer.add(mesh);
      state.cityRoadSegments.set(road.id, mesh);
    }

    const nodeMaterial = new THREE.MeshBasicMaterial({
      color: gridStudio.cyan,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (const intersection of topology.intersections) {
      const node = markCityIntersection(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.025, 16), nodeMaterial));
      node.position.set(intersection.x, 0.07, intersection.z);
      node.userData.intersectionId = intersection.id;
      layer.add(node);
      state.cityIntersections.set(intersection.id, node);
    }

    return layer;
  }

  function reconcileCityRoads(topology) {
    if (state.cityRoadTopologyKey === topology.key && state.cityRoadLayer) {
      return;
    }
    if (state.cityRoadLayer) {
      disposeObject3D(state.cityRoadLayer);
      scene.remove(state.cityRoadLayer);
    }
    state.cityRoadSegments.clear();
    state.cityIntersections.clear();
    state.cityRoadTopologyKey = topology.key;
    state.cityRoadLayer = createCityRoadLayer(topology);
    scene.add(state.cityRoadLayer);
  }
  ```

- [ ] **Step 5: Wire road reconciliation**

  In `reconcileRooms(projectGroups)`, after the `roomPlacements` constant is assigned, add:

  ```js
  const cityTopology = cityRoadTopology(roomPlacements);
  reconcileCityRoads(cityTopology);
  state.cityRoadTopology = cityTopology;
  ```

- [ ] **Step 6: Add road debug counters**

  In `sceneDebugSnapshot()`, add to `snapshot`:

  ```js
  cityRoadSegments: 0,
  cityIntersections: 0,
  ```

  In the traversal, add:

  ```js
  if (object.userData.cityRoadSegment) {
    snapshot.cityRoadSegments += 1;
  }
  if (object.userData.cityIntersection) {
    snapshot.cityIntersections += 1;
  }
  ```

- [ ] **Step 7: Run tests**

  Run:
  ```bash
  npm run test:js
  npm run test:smoke -- --grep "renders nonblank scene|reduced motion keeps scene animation static"
  ```
  Expected: smoke still fails on `lightCycleBikes` because bikes are not implemented.

- [ ] **Step 8: Commit**

  Run:
  ```bash
  git add app.js
  git commit -m "Render Grid city roads"
  ```

---

## Task 4: Add Pooled Light-Cycle Bikes And Trails

**Files:**
- Modify: `app.js`

### Intent

Add busy ambient bike traffic with reusable meshes, short trails, and reduced-motion-safe animation.

### Steps

- [ ] **Step 1: Import route helpers**

  Extend the import from `./visual-model.mjs`:

  ```js
  cityBikeRoutes,
  ```

- [ ] **Step 2: Add bike marker helpers**

  Near city road marker helpers, add:

  ```js
  function markLightCycleBike(object) {
    object.userData.lightCycleBike = true;
    return object;
  }

  function markLightCycleTrail(object) {
    object.userData.lightCycleTrail = true;
    return object;
  }
  ```

- [ ] **Step 3: Add bike material and mesh helpers**

  Add this block after `reconcileCityRoads(topology)`:

  ```js
  function lightCycleColorForKind(kind) {
    return kind === "done" ? gridStudio.done : gridStudio.cyan;
  }

  function createLightCycle(route) {
    const color = lightCycleColorForKind(route.kind);
    const group = new THREE.Group();
    group.userData.lightCycleRoute = route;

    const bikeMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: route.kind === "active" ? 0.96 : 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const trailMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: route.kind === "active" ? 0.22 : 0.13,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const body = markLightCycleBike(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.16), bikeMaterial));
    body.position.y = 0.18;
    const nose = markLightCycleBike(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.08), bikeMaterial));
    nose.position.set(0.24, 0.18, 0);
    const trail = markLightCycleTrail(new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.45, route.trailLength), 0.025, 0.08), trailMaterial));
    trail.position.set(-route.trailLength / 2, 0.16, 0);

    group.add(trail, body, nose);
    group.userData.parts = { body, nose, trail, bikeMaterial, trailMaterial };
    scene.add(group);
    return group;
  }

  function roadForRoute(route) {
    return state.cityRoadTopology?.horizontalRoads.find((road) => road.id === route.segmentId)
      || state.cityRoadTopology?.verticalRoads.find((road) => road.id === route.segmentId)
      || null;
  }

  function positionLightCycle(lightCycle, route, elapsed) {
    const road = roadForRoute(route);
    if (!road) {
      lightCycle.visible = false;
      return;
    }
    lightCycle.visible = true;
    const phase = route.speed > 0 && !state.reducedMotion
      ? (route.phase + elapsed * route.speed) % 1
      : route.phase;
    if (road.axis === "x") {
      const x = road.startX + (road.endX - road.startX) * phase;
      lightCycle.position.set(x, 0, road.z);
      lightCycle.rotation.y = 0;
    } else {
      const z = road.startZ + (road.endZ - road.startZ) * phase;
      lightCycle.position.set(road.x, 0, z);
      lightCycle.rotation.y = -Math.PI / 2;
    }
    const parts = lightCycle.userData.parts;
    parts.trail.visible = !state.reducedMotion;
    parts.trailMaterial.opacity = state.reducedMotion ? 0 : route.kind === "active" ? 0.22 : 0.13;
    lightCycle.userData.animatedLightCycle = route.speed > 0 && !state.reducedMotion;
  }
  ```

- [ ] **Step 4: Add light-cycle reconciliation**

  Add this block after the helper above:

  ```js
  function roomTrafficStates(projectGroups, placements) {
    return projectGroups.map((projectGroup, index) => ({
      project: projectGroup.project,
      x: placements[index]?.x || 0,
      z: placements[index]?.z || 0,
      hasActiveThreads: projectGroup.threads.some((thread) => thread.state === "ACTIVE"),
      doneCount: projectGroup.threads.filter((thread) => thread.state === "DONE").length,
    }));
  }

  function reconcileLightCycles(projectGroups, placements) {
    const topology = state.cityRoadTopology;
    const routes = cityBikeRoutes(topology, roomTrafficStates(projectGroups, placements), {
      viewportWidth: window.innerWidth,
      reducedMotion: state.reducedMotion,
    });
    state.lightCycleRoutes = routes;
    const activeRouteIds = new Set(routes.map((route) => route.id));

    for (const [routeId, lightCycle] of state.lightCycles.entries()) {
      if (!activeRouteIds.has(routeId)) {
        disposeObject3D(lightCycle);
        scene.remove(lightCycle);
        state.lightCycles.delete(routeId);
      }
    }

    for (const route of routes) {
      let lightCycle = state.lightCycles.get(route.id);
      if (!lightCycle) {
        lightCycle = createLightCycle(route);
        state.lightCycles.set(route.id, lightCycle);
      }
      lightCycle.userData.lightCycleRoute = route;
      positionLightCycle(lightCycle, route, 0);
    }
  }
  ```

- [ ] **Step 5: Wire bike reconciliation**

  In `reconcileRooms(projectGroups)`, after `state.cityRoadTopology = cityTopology;`, add:

  ```js
  reconcileLightCycles(projectGroups, roomPlacements);
  ```

- [ ] **Step 6: Animate bikes**

  At the end of `animateAgents(elapsed)`, add:

  ```js
  for (const lightCycle of state.lightCycles.values()) {
    positionLightCycle(lightCycle, lightCycle.userData.lightCycleRoute, elapsed);
  }
  ```

- [ ] **Step 7: Add bike debug counters**

  In `sceneDebugSnapshot()`, add to `snapshot`:

  ```js
  lightCycleBikes: 0,
  lightCycleTrails: 0,
  animatedLightCycles: 0,
  ```

  In the traversal, add:

  ```js
  if (object.userData.lightCycleBike) {
    snapshot.lightCycleBikes += 1;
  }
  if (object.userData.lightCycleTrail) {
    snapshot.lightCycleTrails += 1;
  }
  if (object.userData.animatedLightCycle) {
    snapshot.animatedLightCycles += 1;
  }
  ```

  After traversal and before `return`, add this count correction so each bike group counts once for animation:

  ```js
  snapshot.animatedLightCycles = Array.from(state.lightCycles.values()).filter(
    (lightCycle) => lightCycle.userData.animatedLightCycle,
  ).length;
  ```

- [ ] **Step 8: Run tests**

  Run:
  ```bash
  npm run test:js
  npm run test:smoke -- --grep "renders nonblank scene|reduced motion keeps scene animation static"
  ```
  Expected: both targeted smoke tests pass.

- [ ] **Step 9: Commit**

  Run:
  ```bash
  git add app.js
  git commit -m "Add Grid city light-cycle traffic"
  ```

---

## Task 5: Polish Density, Disposal, And Full Verification

**Files:**
- Modify: `app.js`
- Modify: `test_visual_model.mjs`
- Modify: `smoke/codims-smoke.spec.mjs`

### Intent

Make the busy arcade traffic stable in dense scenes, verify reduced motion, and finish with full rendered QA.

### Steps

- [ ] **Step 1: Add explicit dense-budget unit test**

  Add after the existing `cityTrafficBudget` assertions in `test_visual_model.mjs`:

  ```js
  assert.equal(cityTrafficBudget({ projectCount: 20, activeProjectCount: 12, viewportWidth: 1600 }), 18);
  assert.equal(cityTrafficBudget({ projectCount: 20, activeProjectCount: 12, viewportWidth: 390 }), 9);
  ```

- [ ] **Step 2: Add smoke upper-bound assertions**

  In `renders nonblank scene and action inbox`, after `expect(sceneDebug.lightCycleBikes).toBeGreaterThanOrEqual(2);`, add:

  ```js
  expect(sceneDebug.lightCycleBikes).toBeLessThanOrEqual(36);
  ```

  This upper bound counts bike body and nose meshes, so it allows up to 18 route groups.

- [ ] **Step 3: Run tests**

  Run:
  ```bash
  npm run test:js
  npm run test:smoke -- --grep "renders nonblank scene|reduced motion keeps scene animation static"
  ```
  Expected: exit code `0`.

- [ ] **Step 4: Check disposal review target**

  Run:
  ```bash
  rg -n "disposeObject3D\\(state.cityRoadLayer\\)|disposeObject3D\\(lightCycle\\)|state.lightCycles.delete" app.js
  ```
  Expected output includes:
  ```text
  app.js:<line>:      disposeObject3D(state.cityRoadLayer);
  app.js:<line>:        disposeObject3D(lightCycle);
  app.js:<line>:        state.lightCycles.delete(routeId);
  ```

- [ ] **Step 5: Commit test/polish changes**

  Run:
  ```bash
  git add app.js test_visual_model.mjs smoke/codims-smoke.spec.mjs
  git commit -m "Cap Grid city traffic density"
  ```

- [ ] **Step 6: Run full automated verification**

  Run:
  ```bash
  npm run test:js
  npm run test:smoke
  python3 -m unittest -v
  git diff --check
  ```
  Expected:
  ```text
  npm run test:js exits 0
  npm run test:smoke reports 7 passed
  python3 -m unittest -v reports OK
  git diff --check exits 0
  ```

- [ ] **Step 7: Rendered QA**

  Start app only if no server is running:
  ```bash
  HOST=127.0.0.1 PORT=8765 ./launch.sh
  ```

  Check:
  - Desktop default town is nonblank and framed.
  - Mobile viewport is nonblank and framed.
  - Ambient bikes are visible with trails.
  - Reduced-motion mode stops animated bikes.
  - Inbox, settings, and inspector still open and close.
  - Browser console has no relevant errors.

- [ ] **Step 8: Stop local server if this task started it**

  Press `Ctrl-C` in the server session. Verify:
  ```bash
  lsof -nP -iTCP:8765 -sTCP:LISTEN || true
  ```
  Expected: no listening process printed.

## Final Success Criteria

- [ ] Roads and intersections render as an ordered Grid city.
- [ ] Ambient light-cycle bikes move even without direct handoffs.
- [ ] Active work has brighter/faster bike routes.
- [ ] Done/review areas can emit amber lower-priority traffic.
- [ ] Bike count and trail count are capped.
- [ ] Reduced motion reports `animatedLightCycles === 0`.
- [ ] `npm run test:js` passes.
- [ ] `npm run test:smoke` passes.
- [ ] `python3 -m unittest -v` passes.
- [ ] `git diff --check` passes.
- [ ] No new dependencies, server APIs, CSS label glow, or asset pipeline are added.
