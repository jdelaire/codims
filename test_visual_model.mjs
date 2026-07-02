import assert from "node:assert/strict";

import {
  buildActionInbox,
  actionInboxItemParentKey,
  autoDensityMode,
  buildParentTimeline,
  buildProjectParentGroups,
  buildReviewItems,
  filterActionInboxItems,
  childHandoffOffset,
  childVisualLayout,
  densityScale,
  actionInboxFetchMaxAgeHours,
  fetchMaxAgeCovers,
  filterThreadsByMaxAge,
  filterReviewItems,
  filterVisibleProjectGroups,
  handoffShouldAnimate,
  matchesThreadSearch,
  normalizePreferences,
  parentGroupOffset,
  parentVisualLayoutEntries,
  parseReviewedThreadIds,
  privacyLabel,
  privacyPath,
  projectRoomLayout,
  projectRoomGridSpacing,
  projectRoomPlacements,
  cityBikeRoutes,
  cityRoadTopology,
  cityTrafficBudget,
  projectDisplayText,
  serializeReviewedThreadIds,
  reviewStateForParentGroup,
  roomCameraFocus,
  sceneOverviewCameraFocus,
  shouldPollThreads,
  shouldUseDenseLabels,
  STALE_AFTER_MS,
  STALE_INBOX_FETCH_HOURS,
  staleInboxCutoffMs,
  threadActivityLabel,
  sceneObjectIsSelected,
  childVisualLayoutEntries,
} from "./visual-model.mjs";

const threads = [
  {
    id: "parent",
    title: "Ship Codims",
    nickname: "Ship Codims",
    project: "codims",
    parent_id: "parent",
    parent_title: "Ship Codims",
    state: "RECENT",
    intensity: "idle",
    updated_at_ms: 3000,
  },
  {
    id: "child-a",
    title: "Render rooms",
    nickname: "Ada",
    project: "codims",
    parent_id: "parent",
    parent_title: "Ship Codims",
    state: "ACTIVE",
    intensity: "working",
    updated_at_ms: 5000,
  },
  {
    id: "child-b",
    title: "Wire details",
    nickname: "Grace",
    project: "codims",
    parent_id: "parent",
    parent_title: "Ship Codims",
    state: "RECENT",
    intensity: "idle",
    updated_at_ms: 4000,
  },
  {
    id: "child-c",
    title: "Summarize logs",
    nickname: "Katherine",
    role: "agent",
    project: "codims",
    parent_id: "parent",
    parent_title: "Ship Codims",
    state: "DONE",
    intensity: "idle",
    updated_at_ms: 7000,
    age_seconds: 12,
    last_response_snippet: "Logs summarized.",
    ignored_by_digest: true,
  },
  {
    id: "child-d",
    title: "Test digest",
    nickname: "Dorothy",
    role: "agent",
    project: "codims",
    parent_id: "parent",
    parent_title: "Ship Codims",
    state: "DONE",
    intensity: "idle",
    updated_at_ms: 6000,
    age_seconds: 18,
    last_response_snippet: "Digest tested.",
  },
  {
    id: "solo",
    title: "Separate task",
    nickname: "Separate task",
    project: "codims",
    parent_id: "solo",
    parent_title: "Separate task",
    state: "RECENT",
    intensity: "idle",
    updated_at_ms: 1000,
  },
];

assert.equal(matchesThreadSearch(threads[0], "ship"), true);
assert.equal(matchesThreadSearch(threads[1], "ada"), true);
assert.equal(matchesThreadSearch(threads[1], "codims"), true);
assert.equal(matchesThreadSearch(threads[1], "missing"), false);
assert.equal(matchesThreadSearch(threads[1], ""), true);
assert.equal(threadActivityLabel({ state: "ACTIVE" }), "RUNNING");
assert.equal(threadActivityLabel({ state: "DONE" }), "DONE");
assert.equal(threadActivityLabel({ state: "RECENT" }), "IDLE");
assert.equal(
  sceneObjectIsSelected(
    { mode: "room", project: "codims" },
    { type: "room", project: "codims" },
  ),
  true,
);
assert.equal(
  sceneObjectIsSelected(
    { mode: "room", project: "codims" },
    { type: "room", project: "other" },
  ),
  false,
);
assert.equal(sceneObjectIsSelected({ mode: "room" }, { type: "room" }), false);
assert.equal(
  sceneObjectIsSelected(
    { mode: "thread", threadId: "parent", parentKey: "codims:parent" },
    { type: "parent", threadId: "parent", parentKey: "codims:parent" },
  ),
  true,
);
assert.equal(
  sceneObjectIsSelected(
    { mode: "digest", threadId: "parent", parentKey: "codims:parent" },
    { type: "parent", threadId: "parent", parentKey: "codims:parent" },
  ),
  false,
);
assert.equal(
  sceneObjectIsSelected(
    { mode: "thread", threadId: "child-a", parentKey: null },
    { type: "agent", threadId: "child-a" },
  ),
  true,
);
assert.equal(
  sceneObjectIsSelected(
    { mode: "thread", threadId: "child-a", parentKey: null },
    { type: "agent", threadId: "child-b" },
  ),
  false,
);
assert.equal(
  sceneObjectIsSelected(
    { mode: "room", threadId: "child-a" },
    { type: "agent", threadId: "child-a" },
  ),
  false,
);
assert.equal(
  sceneObjectIsSelected(
    { mode: "digest", digestKey: "codims:parent" },
    { type: "digest", digestKey: "codims:parent" },
  ),
  true,
);
assert.equal(sceneObjectIsSelected({ mode: "digest" }, { type: "digest" }), false);
assert.equal(sceneObjectIsSelected(null, { type: "agent", threadId: "child-a" }), false);
assert.equal(shouldPollThreads(true, false), true);
assert.equal(shouldPollThreads(true, true), false);
assert.equal(shouldPollThreads(false, false), false);
assert.equal(privacyLabel("Build Codims", false), "Build Codims");
assert.equal(privacyLabel("Build Codims", true), "Hidden");
assert.equal(privacyPath("/repo/app", false), "/repo/app");
assert.equal(privacyPath("/repo/app", true), "Hidden");
assert.equal(densityScale("normal"), 1);
assert.equal(densityScale("compact"), 0.78);
assert.equal(densityScale("bad"), 1);
assert.equal(autoDensityMode([]), "normal");
assert.equal(autoDensityMode([{ threads: new Array(24).fill({}) }]), "normal");
assert.equal(autoDensityMode([{ threads: new Array(25).fill({}) }]), "compact");
assert.equal(
  autoDensityMode(new Array(7).fill(null).map(() => ({ threads: [{}] }))),
  "compact",
);
assert.deepEqual(normalizePreferences({ activeMinutes: "8", maxAgeHours: "24", labels: false }), {
  maxAgeHours: "24",
  labels: false,
  showInactive: false,
  privacy: false,
  reviewPanelExpanded: false,
  showStale: true,
});
assert.deepEqual(normalizePreferences({ activeMinutes: "", maxAgeHours: "-1" }), {
  maxAgeHours: "8",
  labels: true,
  showInactive: false,
  privacy: false,
  reviewPanelExpanded: false,
  showStale: true,
});
assert.equal(normalizePreferences({ reviewPanelExpanded: false }).reviewPanelExpanded, false);
assert.equal(normalizePreferences({ reviewPanelExpanded: true }).reviewPanelExpanded, true);
assert.equal(normalizePreferences({ showStale: false }).showStale, false);
assert.equal(normalizePreferences({ showStale: true }).showStale, true);
assert.equal(normalizePreferences({ activeMinutes: "5", maxAgeHours: "" }).maxAgeHours, "8");
assert.equal(normalizePreferences({ activeMinutes: "5", maxAgeHours: "   " }).maxAgeHours, "8");
assert.equal(normalizePreferences({ activeMinutes: "5", maxAgeHours: null }).maxAgeHours, "8");
assert.equal(normalizePreferences({ activeMinutes: "5", maxAgeHours: "0" }).maxAgeHours, "0");
assert.equal(normalizePreferences({ maxAgeHours: "12" }).maxAgeHours, "8");
assert.equal(normalizePreferences({ prefsVersion: 2, maxAgeHours: "12" }).maxAgeHours, "12");

const projectGroups = buildProjectParentGroups(threads);
assert.equal(projectGroups.length, 1);
assert.equal(projectGroups[0].project, "codims");

const parentGroup = projectGroups[0].parentGroups.find((group) => group.parentId === "parent");
assert.equal(parentGroup.title, "Ship Codims");
assert.equal(parentGroup.lead.id, "parent");
assert.equal(parentGroup.children.map((thread) => thread.id).join(","), "child-c,child-d,child-a,child-b");
assert.equal(parentGroup.isActive, true);
assert.equal(parentGroup.isHandoffActive, true);
assert.equal(parentGroup.colorKey, "parent");
assert.deepEqual(
  parentGroup.finishedChildren.map((thread) => thread.id),
  ["child-c", "child-d"],
);
assert.equal(parentGroup.finishedCount, 3);
assert.equal(parentGroup.latestFinishedAt, 7000);
assert.deepEqual(
  parentGroup.digestItems.map((thread) => thread.id),
  ["child-c", "child-d", "parent"],
);
assert.deepEqual(Object.keys(parentGroup.digestItems[0]), [
  "id",
  "nickname",
  "title",
  "role",
  "project",
  "parent_id",
  "parent_title",
  "updated_at_ms",
  "age_seconds",
  "last_response_snippet",
]);
assert.deepEqual(parentGroup.digestItems[0], {
  id: "child-c",
  nickname: "Katherine",
  title: "Summarize logs",
  role: "agent",
  project: "codims",
  parent_id: "parent",
  parent_title: "Ship Codims",
  updated_at_ms: 7000,
  age_seconds: 12,
  last_response_snippet: "Logs summarized.",
});
assert.equal(handoffShouldAnimate(parentGroup, parentGroup.children.find((thread) => thread.id === "child-a")), true);
assert.equal(handoffShouldAnimate(parentGroup, parentGroup.children.find((thread) => thread.id === "child-b")), false);
assert.equal(handoffShouldAnimate(parentGroup, parentGroup.children.find((thread) => thread.id === "child-c")), false);

const soloGroup = projectGroups[0].parentGroups.find((group) => group.parentId === "solo");
assert.equal(soloGroup.title, "Separate task");
assert.equal(soloGroup.children.length, 0);
assert.equal(soloGroup.isHandoffActive, false);
assert.deepEqual(soloGroup.finishedChildren, []);
assert.equal(soloGroup.finishedCount, 1);
assert.equal(soloGroup.latestFinishedAt, 1000);
assert.deepEqual(
  soloGroup.digestItems.map((thread) => thread.id),
  ["solo"],
);

const reviewedThreadIds = new Set(["child-c", "solo"]);
const reviewItems = buildReviewItems(projectGroups, reviewedThreadIds);
assert.deepEqual(
  reviewItems.map((item) => ({
    id: item.id,
    parentId: item.parentId,
    parentTitle: item.parentTitle,
    project: item.project,
    reviewed: item.reviewed,
  })),
  [
    {
      id: "child-c",
      parentId: "parent",
      parentTitle: "Ship Codims",
      project: "codims",
      reviewed: true,
    },
    {
      id: "child-d",
      parentId: "parent",
      parentTitle: "Ship Codims",
      project: "codims",
      reviewed: false,
    },
    {
      id: "parent",
      parentId: "parent",
      parentTitle: "Ship Codims",
      project: "codims",
      reviewed: false,
    },
    {
      id: "solo",
      parentId: "solo",
      parentTitle: "Separate task",
      project: "codims",
      reviewed: true,
    },
  ],
);
assert.equal("reviewed" in parentGroup.digestItems[0], false);
assert.deepEqual(
  filterReviewItems(reviewItems, true).map((item) => item.id),
  ["child-d", "parent"],
);
assert.deepEqual(
  filterReviewItems(reviewItems, false).map((item) => item.id),
  ["child-c", "child-d", "parent", "solo"],
);
assert.deepEqual([...parseReviewedThreadIds('["child-c","solo"]')], ["child-c", "solo"]);
assert.deepEqual([...parseReviewedThreadIds("[")], []);
assert.deepEqual([...parseReviewedThreadIds('{"id":"child-c"}')], []);
assert.equal(serializeReviewedThreadIds(new Set(["solo", "child-c"])), '["child-c","solo"]');

assert.deepEqual(reviewStateForParentGroup(parentGroup, reviewedThreadIds), {
  parentId: "parent",
  parentKey: "codims:parent",
  project: "codims",
  title: "Ship Codims",
  total: 3,
  reviewed: 1,
  unreviewed: 2,
  needsReview: true,
  doneObjectInactive: false,
});
assert.deepEqual(reviewStateForParentGroup(soloGroup, reviewedThreadIds), {
  parentId: "solo",
  parentKey: "codims:solo",
  project: "codims",
  title: "Separate task",
  total: 1,
  reviewed: 1,
  unreviewed: 0,
  needsReview: false,
  doneObjectInactive: true,
});
assert.deepEqual(
  buildParentTimeline(parentGroup, reviewedThreadIds).map((item) => ({
    id: item.id,
    type: item.type,
    reviewed: item.reviewed,
  })),
  [
    { id: "child-c", type: "finished", reviewed: true },
    { id: "child-d", type: "finished", reviewed: false },
    { id: "child-a", type: "active", reviewed: false },
    { id: "parent", type: "finished", reviewed: false },
  ],
);
const soloActiveGroup = buildProjectParentGroups([
  {
    id: "solo-active",
    title: "Solo active",
    nickname: "Solo active",
    project: "codims",
    parent_id: "solo-active",
    parent_title: "Solo active",
    state: "ACTIVE",
    intensity: "working",
    updated_at_ms: 9000,
  },
])[0].parentGroups[0];
assert.deepEqual(
  buildParentTimeline(soloActiveGroup, new Set()).map((item) => ({
    id: item.id,
    type: item.type,
    reviewed: item.reviewed,
  })),
  [{ id: "solo-active", type: "active", reviewed: false }],
);
const staleIdleGroup = buildProjectParentGroups([
  {
    id: "idle-child",
    title: "Idle child",
    nickname: "Idle child",
    project: "codims",
    parent_id: "stale-parent",
    parent_title: "Stale parent",
    state: "RECENT",
    intensity: "idle",
    updated_at_ms: 8500,
  },
])[0].parentGroups[0];
assert.equal(staleIdleGroup.digestItems.length, 0);
assert.deepEqual(
  buildParentTimeline(staleIdleGroup, new Set()).map((item) => ({
    id: item.id,
    type: item.type,
    reviewed: item.reviewed,
  })),
  [{ id: "stale-parent", type: "idle", reviewed: false }],
);

const actionInbox = buildActionInbox(projectGroups, reviewedThreadIds, { staleBeforeMs: 8000 });
assert.deepEqual(actionInbox.counts, {
  needs_review: 2,
  running: 1,
  stale: 1,
  reviewed: 2,
});
assert.deepEqual(
  actionInbox.items.filter((item) => item.type === "needs_review").map((item) => item.id),
  ["child-d", "parent"],
);
assert.deepEqual(
  actionInbox.items.filter((item) => item.type === "reviewed").map((item) => item.id),
  ["child-c", "solo"],
);
assert.deepEqual(
  actionInbox.items.filter((item) => item.type === "running").map((item) => item.parentId),
  ["parent"],
);
assert.deepEqual(
  actionInbox.items.filter((item) => item.type === "stale").map((item) => item.parentId),
  ["solo"],
);
assert.deepEqual(
  actionInbox.items.map((item) => `${item.type}:${item.id || item.parentId}`),
  [
    "needs_review:child-d",
    "needs_review:parent",
    "running:parent",
    "stale:solo",
    "reviewed:child-c",
    "reviewed:solo",
  ],
);
assert.deepEqual(
  actionInbox.groups.map((group) => ({
    type: group.type,
    count: group.count,
    items: group.items.map((item) => item.id || item.parentId),
  })),
  [
    { type: "needs_review", count: 2, items: ["child-d", "parent"] },
    { type: "running", count: 1, items: ["parent"] },
    { type: "stale", count: 1, items: ["solo"] },
    { type: "reviewed", count: 2, items: ["child-c", "solo"] },
  ],
);
assert.deepEqual(
  filterActionInboxItems(actionInbox, { unreviewedOnly: true }).map(
    (item) => `${item.type}:${item.id || item.parentId}`,
  ),
  ["needs_review:child-d", "needs_review:parent", "running:parent"],
);
assert.deepEqual(
  filterActionInboxItems(actionInbox, { filter: "stale" }).map(
    (item) => `${item.type}:${item.id || item.parentId}`,
  ),
  ["running:parent", "stale:solo"],
);
assert.deepEqual(
  filterActionInboxItems(actionInbox, { showStale: false }).map(
    (item) => `${item.type}:${item.id || item.parentId}`,
  ),
  [
    "needs_review:child-d",
    "needs_review:parent",
    "running:parent",
    "reviewed:child-c",
    "reviewed:solo",
  ],
);
assert.deepEqual(
  filterActionInboxItems(actionInbox, { filter: "stale", showStale: false }).map(
    (item) => `${item.type}:${item.id || item.parentId}`,
  ),
  ["running:parent"],
);
assert.deepEqual(
  actionInbox.items.map((item) => actionInboxItemParentKey(item)),
  [
    "codims:parent",
    "codims:parent",
    "codims:parent",
    "codims:solo",
    "codims:parent",
    "codims:solo",
  ],
);
assert.deepEqual(
  buildActionInbox(projectGroups, reviewedThreadIds, { staleBeforeMs: 500 }).items.filter(
    (item) => item.type === "stale",
  ),
  [],
);
assert.equal(STALE_AFTER_MS, 30 * 60 * 1000);
const staleNowMs = 100 * 60 * 1000;
const recentlyFetchedStaleGroups = buildProjectParentGroups([
  {
    id: "recent-stale",
    title: "Recently fetched stale",
    nickname: "Recently fetched stale",
    project: "codims",
    parent_id: "recent-stale",
    parent_title: "Recently fetched stale",
    state: "RECENT",
    updated_at_ms: staleNowMs - 45 * 60 * 1000,
  },
  {
    id: "recent-fresh",
    title: "Recently fetched fresh",
    nickname: "Recently fetched fresh",
    project: "codims",
    parent_id: "recent-fresh",
    parent_title: "Recently fetched fresh",
    state: "RECENT",
    updated_at_ms: staleNowMs - 10 * 60 * 1000,
  },
]);
assert.deepEqual(
  buildActionInbox(recentlyFetchedStaleGroups, new Set(), {
    staleBeforeMs: staleInboxCutoffMs(staleNowMs),
  })
    .items.filter((item) => item.type === "stale")
    .map((item) => item.parentId),
  ["recent-stale"],
);
assert.equal(STALE_INBOX_FETCH_HOURS, 24);
assert.equal(actionInboxFetchMaxAgeHours("1"), "24");
assert.equal(actionInboxFetchMaxAgeHours("24"), "24");
assert.equal(actionInboxFetchMaxAgeHours("48"), "48");
assert.equal(actionInboxFetchMaxAgeHours("0"), "0");
assert.equal(fetchMaxAgeCovers("24", "8"), true);
assert.equal(fetchMaxAgeCovers("24", "24"), true);
assert.equal(fetchMaxAgeCovers("24", "48"), false);
assert.equal(fetchMaxAgeCovers("0", "8"), true);
assert.equal(fetchMaxAgeCovers("0", "48"), true);
assert.equal(fetchMaxAgeCovers("0", "0"), true);
assert.equal(fetchMaxAgeCovers("0", "bad"), false);
assert.equal(fetchMaxAgeCovers("0", "-1"), false);
assert.equal(fetchMaxAgeCovers("-1", "8"), false);
assert.equal(fetchMaxAgeCovers("", "8"), false);
assert.equal(fetchMaxAgeCovers("0", ""), false);
assert.equal(fetchMaxAgeCovers(null, "8"), false);
assert.equal(fetchMaxAgeCovers("0", null), false);
assert.equal(fetchMaxAgeCovers("24", "0"), false);
assert.equal(fetchMaxAgeCovers("bad", "8"), false);
assert.equal(fetchMaxAgeCovers("24", "bad"), false);
const sceneMaxAgeNowMs = 4 * 60 * 60 * 1000;
const fetchedForSceneAndInbox = [
  {
    id: "scene-fresh",
    title: "Scene Fresh",
    nickname: "Scene Fresh",
    project: "codims",
    parent_id: "scene-fresh",
    parent_title: "Scene Fresh",
    state: "RECENT",
    updated_at_ms: sceneMaxAgeNowMs - 20 * 60 * 1000,
  },
  {
    id: "inbox-stale",
    title: "Inbox Stale",
    nickname: "Inbox Stale",
    project: "codims",
    parent_id: "inbox-stale",
    parent_title: "Inbox Stale",
    state: "RECENT",
    updated_at_ms: sceneMaxAgeNowMs - 2 * 60 * 60 * 1000,
  },
];
assert.deepEqual(
  filterThreadsByMaxAge(fetchedForSceneAndInbox, sceneMaxAgeNowMs, "1").map((thread) => thread.id),
  ["scene-fresh"],
);
assert.deepEqual(
  filterThreadsByMaxAge(fetchedForSceneAndInbox, sceneMaxAgeNowMs, "0").map((thread) => thread.id),
  ["scene-fresh", "inbox-stale"],
);
assert.deepEqual(
  buildActionInbox(buildProjectParentGroups(fetchedForSceneAndInbox), new Set(), {
    staleBeforeMs: staleInboxCutoffMs(sceneMaxAgeNowMs),
  })
    .items.filter((item) => item.type === "stale")
    .map((item) => item.parentId),
  ["inbox-stale"],
);
const denseLookupThreads = [
  ...Array.from({ length: 52 }, (_, index) => ({
    id: `inbox-only-${index}`,
    title: `Inbox Only ${index}`,
    nickname: `Inbox Only ${index}`,
    project: "codims",
    parent_id: `inbox-only-${index}`,
    parent_title: `Inbox Only ${index}`,
    state: "RECENT",
    updated_at_ms: sceneMaxAgeNowMs - 2 * 60 * 60 * 1000,
  })),
  {
    id: "rendered-fresh",
    title: "Rendered Fresh",
    nickname: "Rendered Fresh",
    project: "codims",
    parent_id: "rendered-fresh",
    parent_title: "Rendered Fresh",
    state: "ACTIVE",
    updated_at_ms: sceneMaxAgeNowMs - 5 * 60 * 1000,
  },
];
assert.equal(shouldUseDenseLabels(buildProjectParentGroups(denseLookupThreads)), true);
assert.equal(
  shouldUseDenseLabels(
    buildProjectParentGroups(filterThreadsByMaxAge(denseLookupThreads, sceneMaxAgeNowMs, "1")),
  ),
  false,
);

const digestThreads = [
  {
    id: "digest-parent",
    title: "Digest Parent",
    nickname: "Digest Parent",
    project: "codims",
    parent_id: "digest-parent",
    parent_title: "Digest Parent",
    state: "DONE",
    updated_at_ms: 9000,
    last_response_snippet: "Parent done.",
  },
  ...["zeta", "alpha", "echo", "bravo", "charlie", "delta"].map((id, index) => ({
    id,
    title: id.toUpperCase(),
    nickname: id,
    role: "agent",
    project: "codims",
    parent_id: "digest-parent",
    parent_title: "Digest Parent",
    state: "DONE",
    updated_at_ms: index < 2 ? 8000 : 7000 - index,
    age_seconds: index,
    last_response_snippet: `${id} done`,
  })),
];
const digestGroup = buildProjectParentGroups(digestThreads)[0].parentGroups.find(
  (group) => group.parentId === "digest-parent",
);
assert.equal(digestGroup.finishedCount, 7);
assert.equal(digestGroup.digestItems.length, 7);
assert.deepEqual(
  digestGroup.digestItems.map((thread) => thread.id),
  ["digest-parent", "alpha", "zeta", "echo", "bravo", "charlie", "delta"],
);
const activeOnlyDigestGroups = filterVisibleProjectGroups(buildProjectParentGroups(digestThreads), false);
assert.equal(activeOnlyDigestGroups.length, 1);
assert.deepEqual(
  activeOnlyDigestGroups[0].parentGroups.map((group) => group.parentId),
  ["digest-parent"],
);
assert.deepEqual(activeOnlyDigestGroups[0].parentGroups[0].children, []);
assert.equal(activeOnlyDigestGroups[0].parentGroups[0].finishedCount, 7);
assert.equal(activeOnlyDigestGroups[0].parentGroups[0].digestItems.length, 7);
assert.deepEqual(
  activeOnlyDigestGroups[0].threads.map((thread) => thread.id),
  ["digest-parent", "zeta", "alpha", "echo", "bravo", "charlie", "delta"],
);

const inactiveParentDigestThreads = [
  {
    id: "inactive-parent",
    title: "Inactive Parent",
    nickname: "Inactive Parent",
    project: "codims",
    parent_id: "inactive-parent",
    parent_title: "Inactive Parent",
    state: "RECENT",
    updated_at_ms: 2000,
  },
  {
    id: "inactive-done",
    title: "Inactive Done",
    nickname: "Inactive Done",
    role: "agent",
    project: "codims",
    parent_id: "inactive-parent",
    parent_title: "Inactive Parent",
    state: "DONE",
    updated_at_ms: 3000,
    last_response_snippet: "Finished while parent was inactive.",
  },
];
const inactiveDigestGroups = filterVisibleProjectGroups(
  buildProjectParentGroups(inactiveParentDigestThreads),
  false,
);
assert.equal(inactiveDigestGroups.length, 1);
assert.deepEqual(
  inactiveDigestGroups[0].parentGroups.map((group) => group.parentId),
  ["inactive-parent"],
);
assert.deepEqual(inactiveDigestGroups[0].parentGroups[0].children, []);
assert.equal(inactiveDigestGroups[0].parentGroups[0].finishedCount, 2);
assert.deepEqual(
  inactiveDigestGroups[0].parentGroups[0].digestItems.map((thread) => thread.id),
  ["inactive-done", "inactive-parent"],
);
assert.deepEqual(
  inactiveDigestGroups[0].threads.map((thread) => thread.id),
  ["inactive-parent", "inactive-done"],
);

const waitingMainThreadGroups = filterVisibleProjectGroups(
  buildProjectParentGroups([
    {
      id: "waiting-main",
      title: "Waiting Main",
      nickname: "Waiting Main",
      role: "thread",
      project: "codims",
      parent_id: "waiting-main",
      parent_title: "Waiting Main",
      state: "RECENT",
      updated_at_ms: 5000,
      last_response_snippet: "Ready for review.",
    },
  ]),
  false,
);
assert.equal(waitingMainThreadGroups.length, 1);
assert.deepEqual(
  waitingMainThreadGroups[0].parentGroups.map((group) => group.parentId),
  ["waiting-main"],
);
assert.equal(waitingMainThreadGroups[0].parentGroups[0].finishedCount, 1);
assert.deepEqual(
  waitingMainThreadGroups[0].parentGroups[0].digestItems.map((thread) => thread.id),
  ["waiting-main"],
);
assert.deepEqual(
  waitingMainThreadGroups[0].threads.map((thread) => thread.id),
  ["waiting-main"],
);

const activeOnlyGroups = filterVisibleProjectGroups(projectGroups, false);
assert.equal(activeOnlyGroups.length, 1);
assert.equal(activeOnlyGroups[0].project, "codims");
assert.deepEqual(
  activeOnlyGroups[0].parentGroups.map((group) => group.parentId),
  ["parent", "solo"],
);
assert.deepEqual(
  activeOnlyGroups[0].parentGroups[0].children.map((thread) => thread.id),
  ["child-a"],
);
assert.equal(
  handoffShouldAnimate(
    activeOnlyGroups[0].parentGroups[0],
    activeOnlyGroups[0].parentGroups[0].children[0],
  ),
  true,
);
assert.deepEqual(
  activeOnlyGroups[0].parentGroups[0].finishedChildren.map((thread) => thread.id),
  ["child-c", "child-d"],
);
assert.deepEqual(
  activeOnlyGroups[0].parentGroups[0].digestItems.map((thread) => thread.id),
  ["child-c", "child-d", "parent"],
);
assert.equal(activeOnlyGroups[0].parentGroups[0].finishedCount, 3);
assert.equal(activeOnlyGroups[0].parentGroups[0].latestFinishedAt, 7000);
assert.deepEqual(
  activeOnlyGroups[0].threads.map((thread) => thread.id),
  ["parent", "child-a", "child-c", "child-d", "solo"],
);

const allGroups = filterVisibleProjectGroups(projectGroups, true);
assert.equal(allGroups[0].parentGroups.length, 2);
assert.deepEqual(allGroups[0].threads.map((thread) => thread.id), [
  "child-c",
  "child-d",
  "child-a",
  "child-b",
  "parent",
  "solo",
]);

const twoChildOffset = childHandoffOffset(0, 2);
assert.ok(twoChildOffset.z >= 1.7);
assert.ok(Math.hypot(twoChildOffset.x, twoChildOffset.z) >= 1.75);

const oneChildOffset = childHandoffOffset(0, 1);
assert.ok(oneChildOffset.z >= 1.9);

const visualChildEntries = childVisualLayoutEntries(parentGroup.children);
const activeChildEntry = visualChildEntries.find((entry) => entry.thread.id === "child-a");
assert.deepEqual(
  visualChildEntries.map((entry) => entry.thread.id),
  ["child-a", "child-c", "child-d", "child-b"],
);
assert.equal(activeChildEntry.layoutIndex, 0);
assert.equal(
  activeChildEntry.layout.z,
  Math.max(...visualChildEntries.map((entry) => entry.layout.z)),
);

const parentLayoutEntries = parentVisualLayoutEntries(
  [
    { key: "active-parent", isActive: true, children: [{}] },
    { key: "idle-a", isActive: false, children: [{}] },
    { key: "idle-b", isActive: false, children: [{}] },
    { key: "idle-c", isActive: false, children: [{}] },
  ],
);
const activeParentEntry = parentLayoutEntries.find(
  (entry) => entry.parentGroup.key === "active-parent",
);
assert.equal(activeParentEntry.layoutIndex, 3);
assert.equal(
  activeParentEntry.offset.z,
  Math.max(...parentLayoutEntries.map((entry) => entry.offset.z)),
);

const innerRingFront = childHandoffOffset(0, 24);
const innerRingBack = childHandoffOffset(4, 24);
assert.ok(Math.abs(innerRingFront.x) < 0.001);
assert.ok(innerRingFront.z > 1.7);
assert.ok(Math.abs(innerRingBack.x) < 0.001);
assert.ok(innerRingBack.z < -1.7);

const secondRing = childHandoffOffset(8, 24);
assert.ok(
  Math.hypot(secondRing.x, secondRing.z) >
    Math.hypot(innerRingFront.x, innerRingFront.z) + 0.45,
);

const crowdedAgents = Array.from({ length: 96 }, (_, index) => childVisualLayout(index, 96));
const scaleByRing = new Map();
for (const agent of crowdedAgents) {
  if (!scaleByRing.has(agent.ring)) {
    scaleByRing.set(agent.ring, agent.scale);
  }
}
const highestCrowdedRing = Math.max(...scaleByRing.keys());
assert.equal(scaleByRing.get(0), 1);
for (let ring = 1; ring <= highestCrowdedRing; ring += 1) {
  assert.ok(scaleByRing.get(ring) < scaleByRing.get(ring - 1));
}
assert.ok(scaleByRing.get(highestCrowdedRing) <= 0.52);

const crowdedLayout = projectRoomLayout([
  { key: "crowded", children: Array.from({ length: 96 }) },
]);
const crowdedParent = parentGroupOffset(0, 1, crowdedLayout);
assert.ok(crowdedLayout.width > 9.2);
assert.ok(crowdedLayout.depth > 6.8);
for (let index = 0; index < 96; index += 1) {
  const agent = childVisualLayout(index, 96);
  const footprint = 0.36 * agent.scale;
  assert.ok(Math.abs(crowdedParent.x + agent.x) + footprint <= crowdedLayout.width / 2);
  assert.ok(Math.abs(crowdedParent.z + agent.z) + footprint <= crowdedLayout.depth / 2);
}

const multiTeamLayout = projectRoomLayout([
  { key: "left", children: Array.from({ length: 64 }) },
  { key: "right", children: Array.from({ length: 64 }) },
  { key: "bottom", children: Array.from({ length: 64 }) },
  { key: "top", children: Array.from({ length: 64 }) },
]);
const teamRadius = (() => {
  const outer = childVisualLayout(63, 64);
  return outer.radius + 0.48 * outer.scale;
})();
for (let left = 0; left < 4; left += 1) {
  for (let right = left + 1; right < 4; right += 1) {
    const leftOffset = parentGroupOffset(left, 4, multiTeamLayout);
    const rightOffset = parentGroupOffset(right, 4, multiTeamLayout);
    const centerDistance = Math.hypot(leftOffset.x - rightOffset.x, leftOffset.z - rightOffset.z);
    assert.ok(centerDistance > teamRadius * 2 + 0.8);
  }
}

const roomSpacing = projectRoomGridSpacing([
  { width: 9.2, depth: 6.8 },
  { width: 14, depth: 8 },
]);
assert.equal(roomSpacing.gapX, 16.25);
assert.equal(roomSpacing.gapZ, 9.75);
assert.ok(roomSpacing.gapX > 16);

const packedRoomPlacements = projectRoomPlacements([
  { width: 18, depth: 9 },
  { width: 10, depth: 7 },
  { width: 9.2, depth: 6.8 },
  { width: 9.2, depth: 6.8 },
  { width: 10, depth: 7 },
  { width: 9.2, depth: 6.8 },
  { width: 9.2, depth: 6.8 },
  { width: 9.2, depth: 6.8 },
]);
assert.equal(packedRoomPlacements.length, 8);
const packedRows = new Map();
for (const placement of packedRoomPlacements) {
  const row = packedRows.get(placement.row) || [];
  row.push(placement);
  packedRows.set(placement.row, row);
}
assert.equal(packedRows.size, 2);
assert.deepEqual([...packedRows.values()].map((row) => row.length), [4, 4]);
for (const row of packedRows.values()) {
  const minX = Math.min(...row.map((placement) => placement.x - placement.width / 2));
  const maxX = Math.max(...row.map((placement) => placement.x + placement.width / 2));
  assert.ok(maxX - minX < 55);
  assert.ok(Math.abs(minX + maxX) < 0.001);
}
assert.ok(Math.abs(packedRoomPlacements[0].z - packedRoomPlacements[4].z) < 18);

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

const resizedOneRoomTopology = cityRoadTopology([{ x: 0, z: 0, width: 30, depth: 20, row: 0, col: 0 }]);
assert.notEqual(resizedOneRoomTopology.key, oneRoomTopology.key);

const malformedTopology = cityRoadTopology([{ x: 0, z: 0, width: Infinity, depth: NaN, row: 0, col: 0 }]);
assert.equal(Number.isFinite(malformedTopology.bounds.width), true);
assert.equal(Number.isFinite(malformedTopology.bounds.depth), true);
assert.equal(malformedTopology.verticalRoads.every((road) => Number.isFinite(road.x)), true);
assert.equal(malformedTopology.horizontalRoads.every((road) => Number.isFinite(road.z)), true);

const raggedPlacements = projectRoomPlacements(Array.from({ length: 5 }, () => ({ width: 9.2, depth: 6.8 })));
const raggedTopology = cityRoadTopology(raggedPlacements);
for (const road of raggedTopology.verticalRoads) {
  for (const placement of raggedPlacements) {
    const minX = placement.x - placement.width / 2;
    const maxX = placement.x + placement.width / 2;
    const minZ = placement.z - placement.depth / 2;
    const maxZ = placement.z + placement.depth / 2;
    const overlapsRoomZ = road.startZ < maxZ && road.endZ > minZ;
    const crossesRoomX = road.x > minX && road.x < maxX;
    assert.equal(overlapsRoomZ && crossesRoomX, false);
  }
}

assert.equal(cityTrafficBudget({ projectCount: 0, activeProjectCount: 0, viewportWidth: 1200 }), 0);
assert.equal(cityTrafficBudget({ projectCount: 1, activeProjectCount: 0, viewportWidth: 1200 }), 3);
assert.equal(cityTrafficBudget({ projectCount: 8, activeProjectCount: 4, viewportWidth: 1600 }), 16);
assert.equal(cityTrafficBudget({ projectCount: 8, activeProjectCount: 4, viewportWidth: 390 }), 9);
assert.equal(cityTrafficBudget({ projectCount: 20, activeProjectCount: 12, viewportWidth: 1600 }), 18);
assert.equal(cityTrafficBudget({ projectCount: 20, activeProjectCount: 12, viewportWidth: 390 }), 9);

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
assert.deepEqual(cityBikeRoutes(topology, [], { viewportWidth: 1200 }), []);

const cappedActiveRoutes = cityBikeRoutes(
  topology,
  Array.from({ length: 20 }, (_, index) => ({
    project: `project-${index}`,
    x: 0,
    z: 0,
    hasActiveThreads: index === 19,
    doneCount: 0,
  })),
  { viewportWidth: 1600 },
);
assert.equal(cappedActiveRoutes.some((route) => route.kind === "active" && route.roomProject === "project-19"), true);

const directionalRoutes = cityBikeRoutes(topology, [
  { project: "quiet-left", x: cityPlacements[0].x, z: cityPlacements[0].z, hasActiveThreads: false, activeCount: 0, doneCount: 0 },
  { project: "busy-target", x: cityPlacements[3].x, z: cityPlacements[3].z, hasActiveThreads: true, activeCount: 5, doneCount: 0 },
  { project: "less-active", x: cityPlacements[1].x, z: cityPlacements[1].z, hasActiveThreads: true, activeCount: 1, doneCount: 0 },
], { viewportWidth: 1200 });
assert.equal(directionalRoutes.every((route) => route.targetProject === "busy-target"), true);
assert.equal(directionalRoutes.every((route) => Number.isFinite(route.travelStart)), true);
assert.equal(directionalRoutes.every((route) => Number.isFinite(route.travelEnd)), true);
for (const route of directionalRoutes) {
  const road = topology.horizontalRoads.concat(topology.verticalRoads).find((candidate) => candidate.id === route.segmentId);
  const targetCoordinate = road.axis === "x" ? route.targetX : route.targetZ;
  assert.ok(Math.abs(route.travelEnd - targetCoordinate) <= Math.abs(route.travelStart - targetCoordinate));
  assert.equal(Math.sign(route.travelEnd - route.travelStart), route.direction);
}

const reducedRoutes = cityBikeRoutes(topology, [
  { project: "codims", x: 0, z: 0, hasActiveThreads: true, doneCount: 0 },
], { viewportWidth: 1200, reducedMotion: true });
assert.equal(reducedRoutes.length, 2);
assert.equal(reducedRoutes.every((route) => route.speed === 0), true);

const overviewFocus = sceneOverviewCameraFocus(
  packedRoomPlacements,
  { x: 10, y: 10, z: 14 },
  { x: 0, y: 0, z: 0 },
);
assert.deepEqual(overviewFocus.target, { x: 0, y: 0.65, z: 0 });
assert.ok(Math.hypot(
  overviewFocus.position.x - overviewFocus.target.x,
  overviewFocus.position.y - overviewFocus.target.y,
  overviewFocus.position.z - overviewFocus.target.z,
) > 45);
assert.ok(overviewFocus.durationMs >= 700);

assert.equal(projectDisplayText("thaiquest", 27), "THAIQUEST (27)");
assert.equal(projectDisplayText("", 3), "UNKNOWN (3)");

const focus = roomCameraFocus(
  { x: 20, y: 0, z: -12 },
  { width: 14, depth: 8 },
  { x: 10, y: 10, z: 14 },
  { x: 0, y: 0, z: 0 },
);
assert.deepEqual(focus.target, { x: 20, y: 0.65, z: -12 });
assert.ok(Math.hypot(focus.position.x - focus.target.x, focus.position.y - focus.target.y, focus.position.z - focus.target.z) >= 11);
assert.ok(focus.durationMs >= 500);

const fallbackFocus = roomCameraFocus(
  { x: -8, z: 5 },
  { width: 9.2, depth: 6.8 },
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 0, z: 0 },
);
assert.deepEqual(fallbackFocus.target, { x: -8, y: 0.65, z: 5 });
assert.ok(fallbackFocus.position.y > fallbackFocus.target.y);
