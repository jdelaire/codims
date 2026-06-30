import assert from "node:assert/strict";

import {
  buildProjectParentGroups,
  childHandoffOffset,
  childVisualLayout,
  filterVisibleProjectGroups,
  handoffShouldAnimate,
  matchesThreadSearch,
  normalizePreferences,
  parentGroupOffset,
  privacyLabel,
  privacyPath,
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
assert.equal(privacyLabel("Build Codims", false), "Build Codims");
assert.equal(privacyLabel("Build Codims", true), "Hidden");
assert.equal(privacyPath("/repo/app", false), "/repo/app");
assert.equal(privacyPath("/repo/app", true), "Hidden");
assert.deepEqual(normalizePreferences({ activeMinutes: "8", maxAgeHours: "24", labels: false }), {
  activeMinutes: "8",
  maxAgeHours: "24",
  labels: false,
  showInactive: false,
  privacy: false,
  density: "normal",
});
assert.deepEqual(normalizePreferences({ activeMinutes: "", maxAgeHours: "-1", density: "bad" }), {
  activeMinutes: "5",
  maxAgeHours: "12",
  labels: true,
  showInactive: false,
  privacy: false,
  density: "normal",
});

const projectGroups = buildProjectParentGroups(threads);
assert.equal(projectGroups.length, 1);
assert.equal(projectGroups[0].project, "codims");

const parentGroup = projectGroups[0].parentGroups.find((group) => group.parentId === "parent");
assert.equal(parentGroup.title, "Ship Codims");
assert.equal(parentGroup.lead.id, "parent");
assert.equal(parentGroup.children.map((thread) => thread.id).join(","), "child-a,child-b");
assert.equal(parentGroup.isActive, true);
assert.equal(parentGroup.isHandoffActive, true);
assert.equal(parentGroup.colorKey, "parent");
assert.equal(handoffShouldAnimate(parentGroup, parentGroup.children[0]), true);
assert.equal(handoffShouldAnimate(parentGroup, parentGroup.children[1]), false);

const soloGroup = projectGroups[0].parentGroups.find((group) => group.parentId === "solo");
assert.equal(soloGroup.title, "Separate task");
assert.equal(soloGroup.children.length, 0);
assert.equal(soloGroup.isHandoffActive, false);

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
  activeOnlyGroups[0].threads.map((thread) => thread.id),
  ["parent", "child-a"],
);

const allGroups = filterVisibleProjectGroups(projectGroups, true);
assert.equal(allGroups[0].parentGroups.length, 2);
assert.deepEqual(allGroups[0].threads.map((thread) => thread.id), [
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
