import assert from "node:assert/strict";

import {
  buildProjectParentGroups,
  childHandoffOffset,
  childVisualLayout,
  filterVisibleProjectGroups,
  handoffShouldAnimate,
  MAX_DIGEST_ITEMS,
  parentGroupOffset,
  projectRoomLayout,
  projectRoomGridSpacing,
  projectDisplayText,
  roomCameraFocus,
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
assert.equal(parentGroup.finishedCount, 2);
assert.equal(parentGroup.latestFinishedAt, 7000);
assert.deepEqual(
  parentGroup.digestItems.map((thread) => thread.id),
  ["child-c", "child-d"],
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
assert.equal(soloGroup.finishedCount, 0);
assert.equal(soloGroup.latestFinishedAt, 0);
assert.deepEqual(soloGroup.digestItems, []);

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
    last_response_snippet: "Parent should not appear.",
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
assert.equal(digestGroup.finishedCount, 6);
assert.equal(digestGroup.digestItems.length, MAX_DIGEST_ITEMS);
assert.deepEqual(
  digestGroup.digestItems.map((thread) => thread.id),
  ["alpha", "zeta", "echo", "bravo", "charlie"],
);
assert.equal(
  digestGroup.digestItems.map((thread) => thread.id).includes("digest-parent"),
  false,
);

const activeOnlyGroups = filterVisibleProjectGroups(projectGroups, false);
assert.equal(activeOnlyGroups.length, 1);
assert.equal(activeOnlyGroups[0].project, "codims");
assert.deepEqual(
  activeOnlyGroups[0].parentGroups.map((group) => group.parentId),
  ["parent"],
);
assert.deepEqual(
  activeOnlyGroups[0].parentGroups[0].children.map((thread) => thread.id),
  ["child-a"],
);
assert.deepEqual(
  activeOnlyGroups[0].parentGroups[0].finishedChildren.map((thread) => thread.id),
  ["child-c", "child-d"],
);
assert.deepEqual(
  activeOnlyGroups[0].parentGroups[0].digestItems.map((thread) => thread.id),
  ["child-c", "child-d"],
);
assert.equal(activeOnlyGroups[0].parentGroups[0].finishedCount, 2);
assert.equal(activeOnlyGroups[0].parentGroups[0].latestFinishedAt, 7000);
assert.deepEqual(
  activeOnlyGroups[0].threads.map((thread) => thread.id),
  ["parent", "child-a"],
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

const innerAgent = childVisualLayout(0, 96);
const outerAgent = childVisualLayout(80, 96);
assert.ok(outerAgent.scale < innerAgent.scale);

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
assert.equal(roomSpacing.gapX, 14.35);
assert.equal(roomSpacing.gapZ, 8.35);
assert.ok(roomSpacing.gapX > 14);

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
