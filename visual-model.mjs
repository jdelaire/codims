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
        .filter((parentGroup) => parentGroup.isActive)
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
  const scale = Math.max(0.58, 1 - ring * 0.1);
  return {
    x: Math.sin(angle) * radius,
    z: Math.cos(angle) * radius,
    scale,
    ring,
    radius,
  };
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

export function projectRoomGridSpacing(layouts) {
  const maxWidth = Math.max(9.2, ...layouts.map((layout) => layout.width));
  const maxDepth = Math.max(6.8, ...layouts.map((layout) => layout.depth));
  return {
    gapX: Number((maxWidth + 0.35).toFixed(3)),
    gapZ: Number((maxDepth + 0.35).toFixed(3)),
  };
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

export function normalizePreferences(raw = {}) {
  return {
    activeMinutes: normalizeNumericPreference(raw.activeMinutes, "5", (value) => value > 0),
    maxAgeHours: normalizeNumericPreference(raw.maxAgeHours, "12", (value) => value >= 0),
    labels: raw.labels === undefined ? true : Boolean(raw.labels),
    showInactive: Boolean(raw.showInactive),
    privacy: Boolean(raw.privacy),
    density: raw.density === "compact" ? "compact" : "normal",
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

export function roomCameraFocus(roomPosition, roomSize, currentCameraPosition, currentTarget) {
  const target = {
    x: Number(roomPosition?.x || 0),
    y: 0.65,
    z: Number(roomPosition?.z || 0),
  };
  const width = Math.max(9.2, Number(roomSize?.width || 9.2));
  const depth = Math.max(6.8, Number(roomSize?.depth || 6.8));
  const minDistance = Math.max(11, width * 0.78, depth * 1.05);
  const fallbackOffset = { x: minDistance * 0.62, y: minDistance * 0.6, z: minDistance * 0.82 };
  const offset = {
    x: Number(currentCameraPosition?.x || 0) - Number(currentTarget?.x || 0),
    y: Number(currentCameraPosition?.y || 0) - Number(currentTarget?.y || 0),
    z: Number(currentCameraPosition?.z || 0) - Number(currentTarget?.z || 0),
  };
  const length = Math.hypot(offset.x, offset.y, offset.z);
  const cameraOffset =
    length > 0.001
      ? {
          x: (offset.x / length) * Math.max(length, minDistance),
          y: (offset.y / length) * Math.max(length, minDistance),
          z: (offset.z / length) * Math.max(length, minDistance),
        }
      : fallbackOffset;

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

function buildParentGroup(project, parentId, threads) {
  const ordered = threads
    .slice()
    .sort((left, right) => (right.updated_at_ms || 0) - (left.updated_at_ms || 0));
  const parentThread = ordered.find((thread) => thread.id === parentId);
  const latestThread = ordered[0];
  const children = ordered.filter((thread) => thread.id !== parentId);
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

  return {
    key: `${project}:${parentId}`,
    project,
    parentId,
    title,
    lead,
    children,
    threads: ordered,
    latestUpdated,
    isActive,
    isHandoffActive: isActive && children.length > 0,
    colorKey: parentId,
  };
}
