export const STALE_AFTER_MS = 30 * 60 * 1000;
export const STALE_INBOX_FETCH_HOURS = 24;

export function buildProjectParentGroups(threads) {
  const projects = new Map();
  for (const thread of threads) {
    const project = thread.project || "unknown";
    if (!projects.has(project)) {
      projects.set(project, []);
    }
    projects.get(project).push(thread);
  }

  return [...projects.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([project, projectThreads]) => ({
      project,
      threads: projectThreads
        .slice()
        .sort((left, right) => (right.updated_at_ms || 0) - (left.updated_at_ms || 0)),
      parentGroups: buildParentGroups(project, projectThreads),
    }));
}

export function filterVisibleProjectGroups(projectGroups, showInactive) {
  if (showInactive) {
    return projectGroups;
  }

  return projectGroups
    .map((projectGroup) => {
      const parentGroups = projectGroup.parentGroups
        .filter((parentGroup) => parentGroup.isActive || parentGroup.finishedCount > 0)
        .map((parentGroup) => ({
          ...parentGroup,
          children: parentGroup.children.filter((thread) => thread.state === "ACTIVE"),
        }));
      const threadMap = new Map();
      for (const parentGroup of parentGroups) {
        threadMap.set(parentGroup.lead.id, parentGroup.lead);
        for (const child of parentGroup.children) {
          threadMap.set(child.id, child);
        }
        for (const child of parentGroup.finishedChildren) {
          threadMap.set(child.id, child);
        }
      }
      const threads = [...threadMap.values()];
      return {
        ...projectGroup,
        parentGroups,
        threads,
      };
    })
    .filter((projectGroup) => projectGroup.parentGroups.length > 0);
}

export function shouldUseDenseLabels(projectGroups) {
  const renderedThreadCount = (projectGroups || []).reduce(
    (total, projectGroup) => total + (projectGroup.threads?.length || 0),
    0,
  );
  return renderedThreadCount > 48;
}

export function autoDensityMode(projectGroups) {
  const groups = Array.isArray(projectGroups) ? projectGroups : [];
  const visibleThreads = groups.reduce((total, group) => {
    return total + (Array.isArray(group.threads) ? group.threads.length : 0);
  }, 0);
  return visibleThreads > 24 || groups.length > 6 ? "compact" : "normal";
}

export function buildReviewItems(projectGroups, reviewedThreadIds = new Set()) {
  return allParentGroups(projectGroups).flatMap((parentGroup) =>
    (parentGroup.digestItems || []).map((item) => ({
      ...item,
      project: item.project || parentGroup.project,
      parentId: parentGroup.parentId,
      parentKey: parentGroup.key,
      parentTitle: parentGroup.title,
      reviewed: reviewedThreadIds.has(item.id),
    })),
  );
}

export function filterReviewItems(reviewItems, unreviewedOnly) {
  if (!unreviewedOnly) {
    return reviewItems;
  }
  return reviewItems.filter((item) => !item.reviewed);
}

export function parseReviewedThreadIds(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((id) => typeof id === "string" && id));
  } catch {
    return new Set();
  }
}

export function serializeReviewedThreadIds(reviewedThreadIds) {
  return JSON.stringify([...reviewedThreadIds].sort());
}

export function reviewStateForParentGroup(parentGroup, reviewedThreadIds = new Set()) {
  const digestItems = parentGroup.digestItems || [];
  const reviewed = digestItems.filter((item) => reviewedThreadIds.has(item.id)).length;
  const total = digestItems.length;
  const unreviewed = total - reviewed;
  return {
    parentId: parentGroup.parentId,
    parentKey: parentGroup.key,
    project: parentGroup.project,
    title: parentGroup.title,
    total,
    reviewed,
    unreviewed,
    needsReview: unreviewed > 0,
    doneObjectInactive: total > 0 && unreviewed === 0,
  };
}

export function buildActionInbox(projectGroups, reviewedThreadIds = new Set(), options = {}) {
  const parentGroups = allParentGroups(projectGroups);
  const reviewItems = buildReviewItems(projectGroups, reviewedThreadIds);
  const parentStates = parentGroups.map((parentGroup) =>
    reviewStateForParentGroup(parentGroup, reviewedThreadIds),
  );
  const staleBeforeMs = Number(options.staleBeforeMs);
  const canMarkStale = Number.isFinite(staleBeforeMs);
  const runningItems = parentGroups
    .filter((parentGroup) => parentGroup.isActive)
    .map((parentGroup) => parentGroupInboxItem(parentGroup, "running"));
  const staleItems = parentGroups
    .filter(
      (parentGroup) =>
        canMarkStale && !parentGroup.isActive && (parentGroup.latestUpdated || 0) < staleBeforeMs,
    )
    .map((parentGroup) => parentGroupInboxItem(parentGroup, "stale"));
  const reviewActionItems = reviewItems.map((item) => ({
    ...item,
    type: item.reviewed ? "reviewed" : "needs_review",
  }));
  const items = orderActionInboxItems([...reviewActionItems, ...runningItems, ...staleItems]);
  const groups = ACTION_INBOX_TYPES.map((type) => {
    const groupItems = items.filter((item) => item.type === type);
    return {
      type,
      count: groupItems.length,
      items: groupItems,
    };
  });

  return {
    reviewItems,
    parentStates,
    items,
    groups,
    counts: {
      needs_review: reviewActionItems.filter((item) => item.type === "needs_review").length,
      running: runningItems.length,
      stale: staleItems.length,
      reviewed: reviewActionItems.filter((item) => item.type === "reviewed").length,
    },
  };
}

export function filterActionInboxItems(inbox, options = {}) {
  const items = inbox?.items || [];
  const allowsStale = (item) => options.showStale !== false || item.type !== "stale";
  if (options.unreviewedOnly) {
    return items.filter(
      (item) => allowsStale(item) && (item.type === "needs_review" || item.type === "running"),
    );
  }
  if (options.filter) {
    return items.filter(
      (item) => allowsStale(item) && (item.type === options.filter || item.type === "running"),
    );
  }
  return items.filter(allowsStale);
}

export function actionInboxItemParentKey(item) {
  return item?.parentKey || null;
}

export function staleInboxCutoffMs(nowMs = Date.now()) {
  return nowMs - STALE_AFTER_MS;
}

export function actionInboxFetchMaxAgeHours(maxAgeHours) {
  const parsed = Number(maxAgeHours);
  if (parsed === 0) {
    return "0";
  }
  if (!Number.isFinite(parsed) || parsed < 0) {
    return String(STALE_INBOX_FETCH_HOURS);
  }
  return String(Math.max(parsed, STALE_INBOX_FETCH_HOURS));
}

function parseMaxAgeForCoverage(value) {
  if (typeof value === "string") {
    if (value.trim() === "") {
      return NaN;
    }
    return Number(value);
  }
  if (typeof value === "number") {
    return value;
  }
  return NaN;
}

export function fetchMaxAgeCovers(cachedMaxAgeHours, requestedMaxAgeHours) {
  const cached = parseMaxAgeForCoverage(cachedMaxAgeHours);
  const requested = parseMaxAgeForCoverage(requestedMaxAgeHours);
  if (!Number.isFinite(cached) || cached < 0 || !Number.isFinite(requested) || requested < 0) {
    return false;
  }
  if (cached === 0) {
    return true;
  }
  if (requested === 0) {
    return false;
  }
  return cached >= requested;
}

export function filterThreadsByMaxAge(threads, generatedAtMs, maxAgeHours) {
  const parsed = Number(maxAgeHours);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return threads;
  }
  const cutoffMs = Number(generatedAtMs) - parsed * 60 * 60 * 1000;
  if (!Number.isFinite(cutoffMs)) {
    return threads;
  }
  return threads.filter((thread) => (thread.updated_at_ms || 0) >= cutoffMs);
}

export function buildParentTimeline(parentGroup, reviewedThreadIds = new Set()) {
  const digestIds = new Set((parentGroup?.digestItems || []).map((item) => item.id));
  const childIds = new Set((parentGroup?.children || []).map((thread) => thread.id));
  const activeLeadItems =
    parentGroup?.lead?.state === "ACTIVE" &&
    !childIds.has(parentGroup.lead.id) &&
    !digestIds.has(parentGroup.lead.id)
      ? [
          {
            ...parentGroup.lead,
            type: "active",
            parentId: parentGroup.parentId,
            parentKey: parentGroup.key,
            parentTitle: parentGroup.title,
            reviewed: false,
          },
        ]
      : [];
  const activeItems = (parentGroup?.children || [])
    .filter((thread) => thread.state === "ACTIVE")
    .map((thread) => ({
      ...thread,
      type: "active",
      parentId: parentGroup.parentId,
      parentKey: parentGroup.key,
      parentTitle: parentGroup.title,
      reviewed: false,
    }));
  const finishedItems = (parentGroup?.digestItems || []).map((item) => ({
    ...item,
    type: "finished",
    state: "DONE",
    intensity: "digest",
    parentId: parentGroup.parentId,
    parentKey: parentGroup.key,
    parentTitle: parentGroup.title,
    reviewed: reviewedThreadIds.has(item.id),
  }));
  const fallbackLeadItems =
    parentGroup?.lead && !activeLeadItems.length && !activeItems.length && !finishedItems.length
      ? [
          {
            ...parentGroup.lead,
            type: "idle",
            parentId: parentGroup.parentId,
            parentKey: parentGroup.key,
            parentTitle: parentGroup.title,
            reviewed: false,
          },
        ]
      : [];

  return [...activeLeadItems, ...activeItems, ...finishedItems, ...fallbackLeadItems]
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const updatedDelta = (right.item.updated_at_ms || 0) - (left.item.updated_at_ms || 0);
      return updatedDelta || left.index - right.index;
    })
    .map(({ item }) => item);
}

export function childHandoffOffset(index, total) {
  const { x, z } = childVisualLayout(index, total);
  return { x, z };
}

export function childVisualLayout(index, total) {
  if (total === 1) {
    return { x: 0, z: 2.05, scale: 1, ring: 0, radius: 2.05 };
  }

  let ring = 0;
  let ringStart = 0;
  let remaining = index;
  while (remaining >= ringCapacity(ring)) {
    const capacity = ringCapacity(ring);
    remaining -= capacity;
    ringStart += capacity;
    ring += 1;
  }

  const capacity = ringCapacity(ring);
  const ringCount = Math.min(capacity, total - ringStart);
  const radius = 1.85 + ring * 0.66;
  const angle = (remaining / ringCount) * Math.PI * 2;
  const scale = Number(Math.max(0.46, 1 - ring * 0.12).toFixed(3));
  return {
    x: Math.sin(angle) * radius,
    z: Math.cos(angle) * radius,
    scale,
    ring,
    radius,
  };
}

export function childVisualLayoutEntries(children = []) {
  const entries = (Array.isArray(children) ? children : []).map((thread, index) => ({
    thread,
    index,
  }));
  return entries
    .slice()
    .sort((left, right) => {
      const activeDelta = Number(right.thread?.state === "ACTIVE") - Number(left.thread?.state === "ACTIVE");
      return activeDelta || left.index - right.index;
    })
    .map((entry, layoutIndex) => ({
      ...entry,
      layoutIndex,
      layout: childVisualLayout(layoutIndex, entries.length),
    }));
}

export function projectRoomLayout(parentGroups) {
  const count = Math.max(parentGroups.length, 1);
  const cols = Math.min(3, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / cols);
  const maxRadius = Math.max(
    2.2,
    ...parentGroups.map((parentGroup) => parentGroupRadius(parentGroup.children?.length || 0)),
  );
  const cellWidth = Math.max(6.4, maxRadius * 2 + 1.4);
  const cellDepth = Math.max(4.35, maxRadius * 2 + 1.4);
  return {
    width: Math.max(9.2, cols * cellWidth + 2.4),
    depth: Math.max(6.8, rows * cellDepth + 2.6),
    cols,
    rows,
    cellWidth,
    cellDepth,
  };
}

const ROOM_GRID_GUTTER_X = 2.25;
const ROOM_GRID_GUTTER_Z = 1.75;

export function projectRoomGridSpacing(layouts) {
  const maxWidth = Math.max(9.2, ...layouts.map((layout) => layout.width));
  const maxDepth = Math.max(6.8, ...layouts.map((layout) => layout.depth));
  return {
    gapX: Number((maxWidth + ROOM_GRID_GUTTER_X).toFixed(3)),
    gapZ: Number((maxDepth + ROOM_GRID_GUTTER_Z).toFixed(3)),
  };
}

export function projectRoomPlacements(layouts) {
  const rooms = layouts.map((layout, index) => ({
    index,
    width: Number(layout?.width) || 9.2,
    depth: Number(layout?.depth) || 6.8,
  }));
  if (!rooms.length) {
    return [];
  }

  const maxColumns = rooms.length > 6 ? 4 : Math.ceil(Math.sqrt(rooms.length));
  const columns = Math.max(1, Math.min(rooms.length, maxColumns));
  const rows = [];
  for (let index = 0; index < rooms.length; index += columns) {
    rows.push(rooms.slice(index, index + columns));
  }

  const rowDepths = rows.map((row) => Math.max(...row.map((room) => room.depth)));
  const totalDepth =
    rowDepths.reduce((total, depth) => total + depth, 0) +
    ROOM_GRID_GUTTER_Z * Math.max(0, rows.length - 1);
  const placements = new Array(rooms.length);
  let rowZ = -totalDepth / 2;

  rows.forEach((row, rowIndex) => {
    const rowWidth =
      row.reduce((total, room) => total + room.width, 0) +
      ROOM_GRID_GUTTER_X * Math.max(0, row.length - 1);
    let roomX = -rowWidth / 2;
    const z = rowZ + rowDepths[rowIndex] / 2;

    row.forEach((room, col) => {
      roomX += room.width / 2;
      placements[room.index] = {
        x: Number(roomX.toFixed(3)),
        z: Number(z.toFixed(3)),
        row: rowIndex,
        col,
        width: room.width,
        depth: room.depth,
      };
      roomX += room.width / 2 + ROOM_GRID_GUTTER_X;
    });

    rowZ += rowDepths[rowIndex] + ROOM_GRID_GUTTER_Z;
  });

  return placements;
}

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
    .map((placement, index) => {
      const rawWidth = Number(placement.width || 9.2);
      const rawDepth = Number(placement.depth || 6.8);
      const width = Number.isFinite(rawWidth) ? Math.max(1, rawWidth) : 9.2;
      const depth = Number.isFinite(rawDepth) ? Math.max(1, rawDepth) : 6.8;
      return {
        index,
        x: Number(placement.x),
        z: Number(placement.z),
        width,
        depth,
        row: Number.isFinite(Number(placement.row)) ? Number(placement.row) : 0,
        col: Number.isFinite(Number(placement.col)) ? Number(placement.col) : index,
      };
    });

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

  const horizontalZ = [minZ];
  for (let index = 0; index < rowGroups.length - 1; index += 1) {
    const currentMax = Math.max.apply(null, rowGroups[index][1].map((room) => roomBounds(room).maxZ));
    const nextMin = Math.min.apply(null, rowGroups[index + 1][1].map((room) => roomBounds(room).minZ));
    horizontalZ.push(Number(((currentMax + nextMin) / 2).toFixed(3)));
  }
  horizontalZ.push(maxZ);

  const horizontalRoads = horizontalZ.map((z) => ({
    id: roadId("h", z),
    axis: "x",
    z,
    startX: Number(minX.toFixed(3)),
    endX: Number(maxX.toFixed(3)),
    length: Number((maxX - minX).toFixed(3)),
  }));
  const verticalSegments = [];
  for (let rowIndex = 0; rowIndex < rowGroups.length; rowIndex += 1) {
    const rowRooms = rowGroups[rowIndex][1]
      .slice()
      .sort((left, right) => left.x - right.x || left.col - right.col);
    const rowBounds = rowRooms.map(roomBounds);
    const rowVerticalX = [
      Math.min.apply(null, rowBounds.map((bounds) => bounds.minX)) - CITY_ROAD_MARGIN,
    ];
    for (let index = 0; index < rowBounds.length - 1; index += 1) {
      rowVerticalX.push(Number(((rowBounds[index].maxX + rowBounds[index + 1].minX) / 2).toFixed(3)));
    }
    rowVerticalX.push(Math.max.apply(null, rowBounds.map((bounds) => bounds.maxX)) + CITY_ROAD_MARGIN);
    for (const x of rowVerticalX) {
      verticalSegments.push({
        x: Number(x.toFixed(3)),
        startZ: Number(horizontalZ[rowIndex].toFixed(3)),
        endZ: Number(horizontalZ[rowIndex + 1].toFixed(3)),
      });
    }
  }
  const verticalRoads = verticalSegments
    .sort((left, right) => left.x - right.x || left.startZ - right.startZ)
    .reduce((roads, segment) => {
      const previous = roads[roads.length - 1];
      if (previous && previous.x === segment.x && segment.startZ <= previous.endZ + 0.001) {
        previous.endZ = Math.max(previous.endZ, segment.endZ);
        previous.length = Number((previous.endZ - previous.startZ).toFixed(3));
        previous.id = `${roadId("v", previous.x)}-${previous.startZ.toFixed(3)}-${previous.endZ.toFixed(3)}`;
        return roads;
      }
      roads.push({
        id: `${roadId("v", segment.x)}-${segment.startZ.toFixed(3)}-${segment.endZ.toFixed(3)}`,
        axis: "z",
        x: segment.x,
        startZ: segment.startZ,
        endZ: segment.endZ,
        length: Number((segment.endZ - segment.startZ).toFixed(3)),
      });
      return roads;
    }, []);
  const intersections = horizontalRoads.flatMap((horizontal) =>
    verticalRoads
      .filter((vertical) => horizontal.z >= vertical.startZ - 0.001 && horizontal.z <= vertical.endZ + 0.001)
      .map((vertical) => ({
        id: `${horizontal.id}-${vertical.id}`,
        x: vertical.x,
        z: horizontal.z,
      })),
  );
  const boundsKey = [minX, maxX, minZ, maxZ].map((value) => Number(value).toFixed(3)).join(",");
  const roomsKey = rooms
    .map((room) => [room.index, room.x, room.z, room.width, room.depth, room.row, room.col].join(":"))
    .join("|");

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
    key: `h${horizontalRoads.length}-v${verticalRoads.length}-b${boundsKey}-${roomsKey}`,
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

function activeThreadCount(room) {
  const count = Number(room?.activeCount);
  if (Number.isFinite(count)) {
    return Math.max(0, count);
  }
  return room?.hasActiveThreads ? 1 : 0;
}

function busiestRoomState(roomStates) {
  return roomStates
    .map((room, index) => ({ room, index }))
    .sort((left, right) => activeThreadCount(right.room) - activeThreadCount(left.room) || left.index - right.index)[0]
    ?.room || null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roadTravelTarget(road, targetRoom) {
  const roadStart = road.axis === "x" ? road.startX : road.startZ;
  const roadEnd = road.axis === "x" ? road.endX : road.endZ;
  const targetValue = Number(targetRoom?.[road.axis === "x" ? "x" : "z"] || 0);
  const target = Number(clamp(targetValue, Math.min(roadStart, roadEnd), Math.max(roadStart, roadEnd)).toFixed(3));
  const startDistance = Math.abs(roadStart - target);
  const endDistance = Math.abs(roadEnd - target);
  const travelStart = startDistance >= endDistance ? roadStart : roadEnd;
  const direction = Math.sign(target - travelStart) || 1;
  return {
    travelStart: Number(travelStart.toFixed(3)),
    travelEnd: target,
    direction,
  };
}

export function cityBikeRoutes(topology, roomStates = [], options = {}) {
  const roads = (topology?.horizontalRoads || []).concat(topology?.verticalRoads || []);
  if (!roads.length) {
    return [];
  }
  const activeProjectCount = roomStates.filter((room) => room.hasActiveThreads).length;
  const budget = cityTrafficBudget({
    projectCount: roomStates.length,
    activeProjectCount,
    viewportWidth: options.viewportWidth,
  });
  if (!budget) {
    return [];
  }
  const fullRouteCount = Math.min(budget, Math.max(2, roads.length * 2));
  const routeCount = options.reducedMotion ? Math.min(2, fullRouteCount) : fullRouteCount;
  const prioritizedRoomStates = roomStates
    .map((room, index) => ({ room, index }))
    .sort((left, right) => {
      const activeDelta = Number(right.room.hasActiveThreads) - Number(left.room.hasActiveThreads);
      const doneDelta = Number(right.room.doneCount > 0) - Number(left.room.doneCount > 0);
      return activeThreadCount(right.room) - activeThreadCount(left.room) || activeDelta || doneDelta || left.index - right.index;
    })
    .map((entry) => entry.room);
  const targetRoom = busiestRoomState(roomStates) || prioritizedRoomStates[0] || {};
  const routes = [];
  for (let index = 0; index < routeCount; index += 1) {
    const room = prioritizedRoomStates[index % Math.max(1, prioritizedRoomStates.length)] || {};
    const road = nearestRoadSegment(topology, targetRoom, index) || nearestRoadSegment(topology, room, index) || roads[index % roads.length];
    const active = Boolean(room.hasActiveThreads);
    const done = !active && Number(room.doneCount || 0) > 0;
    const kind = active ? "active" : done ? "done" : "ambient";
    const speed = options.reducedMotion ? 0 : active ? 0.22 : done ? 0.1 : 0.14;
    const travel = roadTravelTarget(road, targetRoom);
    routes.push({
      id: `bike-${index}-${kind}-${road.id}`,
      segmentId: road.id,
      axis: road.axis,
      kind,
      speed,
      phase: Number(((index * 0.173) % 1).toFixed(3)),
      trailLength: active ? 1.8 : done ? 1.1 : 1.35,
      roomProject: room.project || null,
      targetProject: targetRoom.project || null,
      targetX: Number(targetRoom.x || 0),
      targetZ: Number(targetRoom.z || 0),
      ...travel,
    });
  }
  return routes;
}

export function parentGroupOffset(index, total, layout = projectRoomLayout(Array.from({ length: total }))) {
  const cols = layout.cols;
  const rows = layout.rows;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: (col - (cols - 1) / 2) * layout.cellWidth,
    z: (row - (rows - 1) / 2) * layout.cellDepth - 0.25,
  };
}

export function parentVisualLayoutEntries(parentGroups = [], layout = projectRoomLayout(parentGroups)) {
  const entries = (Array.isArray(parentGroups) ? parentGroups : []).map((parentGroup, index) => ({
    parentGroup,
    index,
  }));
  return entries
    .slice()
    .sort((left, right) => {
      const activeDelta =
        Number(left.parentGroup?.isActive === true) - Number(right.parentGroup?.isActive === true);
      return activeDelta || left.index - right.index;
    })
    .map((entry, layoutIndex) => ({
      ...entry,
      layoutIndex,
      offset: parentGroupOffset(layoutIndex, entries.length, layout),
    }));
}

export function projectDisplayText(project, count) {
  const name = String(project || "unknown").trim() || "unknown";
  return `${name.toUpperCase()} (${count})`;
}

export function densityScale(density) {
  return density === "compact" ? 0.78 : 1;
}

export function privacyLabel(value, privacyMode) {
  if (privacyMode) {
    return "Hidden";
  }
  return String(value || "");
}

export function privacyPath(value, privacyMode) {
  if (privacyMode) {
    return "Hidden";
  }
  return String(value || "");
}

export function threadActivityLabel(thread) {
  if (thread?.state === "ACTIVE") {
    return "RUNNING";
  }
  if (thread?.state === "DONE") {
    return "DONE";
  }
  return "IDLE";
}

export function sceneObjectIsSelected(selection = {}, object = {}) {
  if (!selection || !object || !selection.mode || !object.type) {
    return false;
  }
  if (object.type === "room") {
    return Boolean(
      selection.mode === "room" && selection.project && selection.project === object.project,
    );
  }
  if (object.type === "digest") {
    return Boolean(
      selection.mode === "digest" && selection.digestKey && selection.digestKey === object.digestKey,
    );
  }
  if (object.type === "parent") {
    if (selection.mode !== "thread") {
      return false;
    }
    return Boolean(
      (selection.parentKey && selection.parentKey === object.parentKey) ||
        (selection.threadId && selection.threadId === object.threadId),
    );
  }
  if (object.type === "agent") {
    if (selection.mode !== "thread") {
      return false;
    }
    return Boolean(selection.threadId && selection.threadId === object.threadId);
  }
  return false;
}

export function shouldPollThreads(live, refreshing) {
  return Boolean(live && !refreshing);
}

export function normalizePreferences(raw = {}) {
  let maxAgeHours = normalizeNumericPreference(raw.maxAgeHours, "8", (value) => value >= 0);
  if (raw.prefsVersion !== 2 && maxAgeHours === "12") {
    maxAgeHours = "8";
  }
  return {
    maxAgeHours,
    labels: raw.labels === undefined ? true : Boolean(raw.labels),
    showInactive: Boolean(raw.showInactive),
    privacy: Boolean(raw.privacy),
    reviewPanelExpanded: Boolean(raw.reviewPanelExpanded),
    showStale: raw.showStale === undefined ? true : Boolean(raw.showStale),
  };
}

function normalizeNumericPreference(raw, fallback, isValid) {
  if (typeof raw !== "string" && typeof raw !== "number") {
    return fallback;
  }
  if (typeof raw === "string" && raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || !isValid(value)) {
    return fallback;
  }
  return String(value);
}

export function handoffShouldAnimate(parentGroup, thread) {
  return Boolean(parentGroup?.isHandoffActive && thread?.state === "ACTIVE");
}

export function matchesThreadSearch(thread, query) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const haystack = [
    thread?.title,
    thread?.nickname,
    thread?.role,
    thread?.project,
    thread?.parent_title,
    thread?.cwd,
    thread?.id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(normalized);
}

function cameraOffsetForFocus(minDistance, currentCameraPosition, currentTarget) {
  const fallbackOffset = { x: minDistance * 0.62, y: minDistance * 0.6, z: minDistance * 0.82 };
  const offset = {
    x: Number(currentCameraPosition?.x || 0) - Number(currentTarget?.x || 0),
    y: Number(currentCameraPosition?.y || 0) - Number(currentTarget?.y || 0),
    z: Number(currentCameraPosition?.z || 0) - Number(currentTarget?.z || 0),
  };
  const length = Math.hypot(offset.x, offset.y, offset.z);
  if (length <= 0.001) {
    return fallbackOffset;
  }
  return {
    x: (offset.x / length) * Math.max(length, minDistance),
    y: (offset.y / length) * Math.max(length, minDistance),
    z: (offset.z / length) * Math.max(length, minDistance),
  };
}

export function roomCameraFocus(roomPosition, roomSize, currentCameraPosition, currentTarget) {
  const target = {
    x: Number(roomPosition?.x || 0),
    y: 0.65,
    z: Number(roomPosition?.z || 0),
  };
  const width = Math.max(9.2, Number(roomSize?.width || 9.2));
  const depth = Math.max(6.8, Number(roomSize?.depth || 6.8));
  const minDistance = Math.max(11, width * 0.78, depth * 1.05);
  const cameraOffset = cameraOffsetForFocus(minDistance, currentCameraPosition, currentTarget);

  return {
    target,
    position: {
      x: target.x + cameraOffset.x,
      y: target.y + cameraOffset.y,
      z: target.z + cameraOffset.z,
    },
    durationMs: 680,
  };
}

export function sceneOverviewCameraFocus(placements, currentCameraPosition, currentTarget) {
  const rooms = (placements || []).filter((placement) => placement && Number.isFinite(Number(placement.x)));
  if (!rooms.length) {
    return roomCameraFocus({ x: 0, z: 0 }, { width: 9.2, depth: 6.8 }, currentCameraPosition, currentTarget);
  }

  const minX = Math.min(...rooms.map((room) => Number(room.x) - Math.max(9.2, Number(room.width || 9.2)) / 2));
  const maxX = Math.max(...rooms.map((room) => Number(room.x) + Math.max(9.2, Number(room.width || 9.2)) / 2));
  const minZ = Math.min(...rooms.map((room) => Number(room.z) - Math.max(6.8, Number(room.depth || 6.8)) / 2));
  const maxZ = Math.max(...rooms.map((room) => Number(room.z) + Math.max(6.8, Number(room.depth || 6.8)) / 2));
  const width = Math.max(9.2, maxX - minX);
  const depth = Math.max(6.8, maxZ - minZ);
  const target = {
    x: Number(((minX + maxX) / 2).toFixed(3)),
    y: 0.65,
    z: Number(((minZ + maxZ) / 2).toFixed(3)),
  };
  const minDistance = Math.max(22, width * 0.92, depth * 1.16);
  const cameraOffset = cameraOffsetForFocus(minDistance, currentCameraPosition, currentTarget);

  return {
    target,
    position: {
      x: target.x + cameraOffset.x,
      y: target.y + cameraOffset.y,
      z: target.z + cameraOffset.z,
    },
    durationMs: 760,
  };
}

function buildParentGroups(project, threads) {
  const buckets = new Map();
  for (const thread of threads) {
    const parentId = thread.parent_id || thread.id;
    if (!buckets.has(parentId)) {
      buckets.set(parentId, []);
    }
    buckets.get(parentId).push(thread);
  }

  return [...buckets.entries()]
    .map(([parentId, items]) => buildParentGroup(project, parentId, items))
    .sort((left, right) => {
      if (left.isActive !== right.isActive) {
        return left.isActive ? -1 : 1;
      }
      if (left.latestUpdated !== right.latestUpdated) {
        return right.latestUpdated - left.latestUpdated;
      }
      return left.title.localeCompare(right.title);
    });
}

function allParentGroups(projectGroups) {
  return (projectGroups || []).flatMap((projectGroup) => projectGroup.parentGroups || []);
}

function parentGroupInboxItem(parentGroup, type) {
  return {
    type,
    parentId: parentGroup.parentId,
    parentKey: parentGroup.key,
    project: parentGroup.project,
    title: parentGroup.title,
    latestUpdated: parentGroup.latestUpdated,
    isActive: parentGroup.isActive,
  };
}

const ACTION_INBOX_TYPES = ["needs_review", "running", "stale", "reviewed"];
const ACTION_INBOX_PRIORITY = new Map(ACTION_INBOX_TYPES.map((type, index) => [type, index]));

function orderActionInboxItems(items) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const typeDelta =
        (ACTION_INBOX_PRIORITY.get(left.item.type) ?? ACTION_INBOX_TYPES.length) -
        (ACTION_INBOX_PRIORITY.get(right.item.type) ?? ACTION_INBOX_TYPES.length);
      return typeDelta || left.index - right.index;
    })
    .map(({ item }) => item);
}

function ringCapacity(ring) {
  return 8 * (ring + 1);
}

function parentGroupRadius(childCount) {
  if (childCount <= 0) {
    return 1.2;
  }
  const outer = childVisualLayout(childCount - 1, childCount);
  return outer.radius + 0.48 * outer.scale;
}

function compareDigestThreads(left, right) {
  const updatedDelta = (right.updated_at_ms || 0) - (left.updated_at_ms || 0);
  if (updatedDelta !== 0) {
    return updatedDelta;
  }
  const idDelta = String(left.id || "").localeCompare(String(right.id || ""));
  if (idDelta !== 0) {
    return idDelta;
  }
  return String(left.title || "").localeCompare(String(right.title || ""));
}

function toDigestItem(thread) {
  return {
    id: thread.id,
    nickname: thread.nickname,
    title: thread.title,
    role: thread.role,
    project: thread.project,
    parent_id: thread.parent_id,
    parent_title: thread.parent_title,
    updated_at_ms: thread.updated_at_ms,
    age_seconds: thread.age_seconds,
    last_response_snippet: thread.last_response_snippet,
  };
}

function buildParentGroup(project, parentId, threads) {
  const ordered = threads
    .slice()
    .sort((left, right) => (right.updated_at_ms || 0) - (left.updated_at_ms || 0));
  const parentThread = ordered.find((thread) => thread.id === parentId);
  const latestThread = ordered[0];
  const children = ordered.filter((thread) => thread.id !== parentId);
  const finishedChildren = children.filter((thread) => thread.state === "DONE");
  const title =
    parentThread?.title ||
    latestThread?.parent_title ||
    latestThread?.title ||
    latestThread?.nickname ||
    "Parent thread";
  const latestUpdated = Math.max(...ordered.map((thread) => thread.updated_at_ms || 0));
  const isActive = ordered.some((thread) => thread.state === "ACTIVE");
  const lead = parentThread || {
    ...latestThread,
    id: parentId,
    title,
    nickname: title,
    role: "parent",
    project,
    parent_id: parentId,
    parent_title: title,
    state: isActive ? "ACTIVE" : "RECENT",
    intensity: isActive ? "handoff" : "idle",
    updated_at_ms: latestUpdated,
  };
  const digestThreads = finishedChildren.slice();
  if (parentThread && parentThread.state !== "ACTIVE") {
    digestThreads.push(parentThread);
  }
  const latestFinishedAt = Math.max(0, ...digestThreads.map((thread) => thread.updated_at_ms || 0));
  const digestItems = digestThreads
    .slice()
    .sort(compareDigestThreads)
    .map(toDigestItem);

  return {
    key: `${project}:${parentId}`,
    project,
    parentId,
    title,
    lead,
    children,
    finishedChildren,
    finishedCount: digestThreads.length,
    latestFinishedAt,
    digestItems,
    threads: ordered,
    latestUpdated,
    isActive,
    isHandoffActive: isActive && children.length > 0,
    colorKey: parentId,
  };
}
