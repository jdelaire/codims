import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { cssHexColor, formatAge, visibleActivityLabel } from "./ui-format.mjs";
import { disposeObject3D } from "./three-disposal.mjs";
import {
  actionInboxFetchMaxAgeHours,
  actionInboxItemParentKey,
  autoDensityMode,
  buildActionInbox,
  buildParentTimeline,
  buildProjectParentGroups,
  childVisualLayout,
  densityScale,
  filterActionInboxItems,
  fetchMaxAgeCovers,
  filterThreadsByMaxAge,
  filterVisibleProjectGroups,
  handoffShouldAnimate,
  matchesThreadSearch,
  normalizePreferences,
  parentGroupOffset,
  parseReviewedThreadIds,
  privacyLabel,
  projectDisplayText,
  projectRoomGridSpacing,
  projectRoomLayout,
  reviewStateForParentGroup,
  roomCameraFocus,
  sceneObjectIsSelected,
  serializeReviewedThreadIds,
  shouldPollThreads,
  shouldUseDenseLabels,
  staleInboxCutoffMs,
  threadActivityLabel,
} from "./visual-model.mjs";

const dom = {
  scene: document.querySelector("#scene"),
  labels: document.querySelector("#labels"),
  statusText: document.querySelector("#statusText"),
  activeCount: document.querySelector("#activeCount"),
  activeCounter: document.querySelector("#activeCount").closest(".counter"),
  visibleCount: document.querySelector("#visibleCount"),
  projectCount: document.querySelector("#projectCount"),
  inboxToggle: document.querySelector("#inboxToggle"),
  inboxBadge: document.querySelector("#inboxBadge"),
  settingsToggle: document.querySelector("#settingsToggle"),
  inboxDrawer: document.querySelector("#inboxDrawer"),
  inboxClose: document.querySelector("#inboxClose"),
  inspectorOverlay: document.querySelector("#inspectorOverlay"),
  inspectorClose: document.querySelector("#inspectorClose"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsForm: document.querySelector("#settingsForm"),
  densityStatus: document.querySelector("#densityStatus"),
  maxAgeHours: document.querySelector("#maxAgeHours"),
  privacyToggle: document.querySelector("#privacyToggle"),
  inactiveToggle: document.querySelector("#inactiveToggle"),
  reviewCount: document.querySelector("#reviewCount"),
  actionInboxButtons: [...document.querySelectorAll("[data-action-inbox-filter]")],
  actionInboxCounts: new Map(
    [...document.querySelectorAll("[data-action-inbox-count]")].map((element) => [
      element.dataset.actionInboxCount,
      element,
    ]),
  ),
  reviewList: document.querySelector("#reviewList"),
  detailsContent: document.querySelector("#detailsContent"),
  detailNickname: document.querySelector("#detailNickname"),
  detailState: document.querySelector("#detailState"),
  detailRole: document.querySelector("#detailRole"),
  detailProject: document.querySelector("#detailProject"),
  detailAge: document.querySelector("#detailAge"),
  detailAgentPromptLabel: document.querySelector("#detailAgentPromptLabel"),
  detailAgentPrompt: document.querySelector("#detailAgentPrompt"),
  detailLastResponseLabel: document.querySelector("#detailLastResponseLabel"),
  detailLastResponse: document.querySelector("#detailLastResponse"),
  detailThreadContentLabel: document.querySelector("#detailThreadContentLabel"),
  detailThreadContent: document.querySelector("#detailThreadContent"),
  detailParent: document.querySelector("#detailParent"),
};

const parentPalette = [
  0x00e5ff,
  0x2fffd0,
  0xff8a00,
  0xff3df2,
  0x8b5cf6,
  0x7df9ff,
  0xffc857,
  0x39ff88,
  0x5cc8ff,
  0xff5a3d,
];

const gridStudio = {
  sceneBackground: 0x02040a,
  ambientSky: 0x5cc8ff,
  ambientGround: 0x02040a,
  gridCenter: 0x00364a,
  gridLine: 0x00151f,
  active: 0x2fffd0,
  done: 0xff8a00,
  digest: 0xff8a00,
  reviewed: 0x4b6470,
  cyan: 0x00e5ff,
  cyanSoft: 0x1ea7c6,
  panelBlack: 0x020813,
  panelDeep: 0x010409,
  room: {
    floor: 0x020813,
    insetFloor: 0x031522,
    wallPanel: 0x04111b,
    accentShadow: 0x00131d,
    backWall: 0x030c14,
    sideWall: 0x020812,
    signBack: 0x01070d,
    floorGlowOpacity: 0.08,
    borderOpacity: 0.56,
    railOpacity: 0.68,
    selectedGlowOpacity: 0.28,
    selectedBorderOpacity: 1,
  },
};

const PREFS_KEY = "codims.preferences.v1";
const REVIEWED_THREADS_KEY = "codims.reviewedThreads.v1";
const SELECTED_LABEL_BORDER = "rgba(224, 242, 254, 0.82)";

function loadPreferences() {
  try {
    return normalizePreferences(JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"));
  } catch {
    return normalizePreferences({});
  }
}

function loadReviewedThreadIds() {
  try {
    return parseReviewedThreadIds(localStorage.getItem(REVIEWED_THREADS_KEY));
  } catch {
    return new Set();
  }
}

function saveReviewedThreadIds() {
  try {
    localStorage.setItem(REVIEWED_THREADS_KEY, serializeReviewedThreadIds(state.reviewedThreadIds));
  } catch {
    // Review state is browser-local convenience; UI should keep working without storage.
  }
}

const state = {
  live: true,
  labels: true,
  privacy: false,
  showInactive: false,
  density: "normal",
  search: "",
  inboxOpen: false,
  actionInboxFilter: null,
  inspectorOpen: false,
  actionInbox: buildActionInbox([]),
  reviewedThreadIds: loadReviewedThreadIds(),
  reviewItems: [],
  projectGroups: [],
  actionInboxProjectGroups: [],
  selectedMode: null,
  selectedProject: null,
  selectedDigest: null,
  selectedParentKey: null,
  selectedId: null,
  selectedThread: null,
  threads: [],
  lastPayload: null,
  lastFetchMaxAgeHours: null,
  rooms: new Map(),
  parentAgents: new Map(),
  agents: new Map(),
  parentLabels: new Map(),
  agentLabels: new Map(),
  digestObjects: new Map(),
  digestLabels: new Map(),
  handoffs: new Map(),
  detailCache: new Map(),
  detailSeq: 0,
  refreshing: false,
  cameraFocus: null,
  hasInitialCameraFocus: false,
  selectable: [],
  refreshSeq: 0,
};

function savePreferences() {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        prefsVersion: 2,
        maxAgeHours: dom.maxAgeHours.value,
        labels: state.labels,
        showInactive: state.showInactive,
        privacy: state.privacy,
      }),
    );
  } catch {
    // Non-persistent controls are acceptable when storage is unavailable.
  }
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(gridStudio.sceneBackground);

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1000);
camera.position.set(10, 10, 14);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
dom.scene.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const clock = new THREE.Clock();
const CLICK_MOVE_LIMIT_PX = 6;
let pendingPointerPick = null;

const ambient = new THREE.HemisphereLight(gridStudio.ambientSky, gridStudio.ambientGround, 1.25);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0x9ff7ff, 2.1);
keyLight.position.set(9, 16, 7);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x00e5ff, 0.72);
rimLight.position.set(-10, 8, -6);
scene.add(rimLight);

const grid = new THREE.GridHelper(240, 240, gridStudio.gridCenter, gridStudio.gridLine);
grid.position.y = -0.03;
scene.add(grid);

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function colorFromKey(key) {
  return parentPalette[hashString(String(key || "thread")) % parentPalette.length];
}

function parentColor(thread) {
  return colorFromKey(thread.parent_id || thread.id || thread.project || "thread");
}

function parentGroupColor(parentGroup) {
  return colorFromKey(parentGroup.colorKey || parentGroup.parentId || parentGroup.project || "thread");
}

function roomPosition(index, total, gapX = 11, gapZ = 8.5) {
  const columns = Math.ceil(Math.sqrt(Math.max(total, 1)));
  const rows = Math.ceil(total / columns);
  const col = index % columns;
  const row = Math.floor(index / columns);
  return new THREE.Vector3(
    (col - (columns - 1) / 2) * gapX,
    0,
    (row - (rows - 1) / 2) * gapZ,
  );
}

const PROJECT_SIGN_Y = 5.6;
const PROJECT_SIGN_STRUT_BASE_Y = 0.18;
const PROJECT_SIGN_STRUT_TOP_Y = PROJECT_SIGN_Y - 0.18;
const PROJECT_SIGN_STRUT_HEIGHT = PROJECT_SIGN_STRUT_TOP_Y - PROJECT_SIGN_STRUT_BASE_Y;
const PROJECT_SIGN_STRUT_Y = PROJECT_SIGN_STRUT_BASE_Y + PROJECT_SIGN_STRUT_HEIGHT / 2;

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const right = x + width;
  const bottom = y + height;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(right - radius, y);
  ctx.quadraticCurveTo(right, y, right, y + radius);
  ctx.lineTo(right, bottom - radius);
  ctx.quadraticCurveTo(right, bottom, right - radius, bottom);
  ctx.lineTo(x + radius, bottom);
  ctx.quadraticCurveTo(x, bottom, x, bottom - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function fitProjectDisplayFont(ctx, text, maxWidth) {
  let size = 82;
  while (size > 40) {
    ctx.font = `800 ${size}px Inter, Arial, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) {
      break;
    }
    size -= 4;
  }
  return size;
}

function createProjectDisplayTexture(project, count, privacyMode = false) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 320;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  updateProjectDisplayTexture(texture, project, count, privacyMode);
  return texture;
}

function updateProjectDisplayTexture(texture, project, count, privacyMode = false) {
  const canvas = texture.image;
  const ctx = canvas.getContext("2d");
  const text = projectDisplayText(privacyLabel(project, privacyMode), count);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(1, 6, 12, 0.98)";
  drawRoundedRect(ctx, 22, 24, canvas.width - 44, canvas.height - 48, 22);
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(0, 229, 255, 0.72)";
  ctx.stroke();
  ctx.shadowColor = "rgba(0, 229, 255, 0.78)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "#eaffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontSize = fitProjectDisplayFont(ctx, text, canvas.width - 140);
  ctx.font = `800 ${fontSize}px Inter, Arial, sans-serif`;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  ctx.shadowBlur = 0;
  texture.needsUpdate = true;
}

function createGlowBox(width, height, depth, color, opacity) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
}

function createFloorCircuitLines(color) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lineSpecs = [
    { x: 0, z: 0, width: 1, depth: 0.025 },
    { x: 0, z: 0, width: 0.025, depth: 1 },
    { x: -0.24, z: -0.24, width: 0.38, depth: 0.025 },
    { x: 0.24, z: 0.24, width: 0.38, depth: 0.025 },
    { x: -0.34, z: 0.22, width: 0.025, depth: 0.36 },
    { x: 0.34, z: -0.22, width: 0.025, depth: 0.36 },
  ];
  for (const spec of lineSpecs) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(spec.width, 0.012, spec.depth), material);
    line.position.set(spec.x, 0.152, spec.z);
    group.add(line);
  }
  return group;
}

function createRoom(project) {
  const group = new THREE.Group();
  group.userData.project = project;
  const projectAccent = colorFromKey(project);

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.16, 1),
    new THREE.MeshStandardMaterial({
      color: gridStudio.room.floor,
      roughness: 0.68,
      metalness: 0.08,
    }),
  );
  floor.receiveShadow = true;
  group.add(floor);

  const floorGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: projectAccent,
      transparent: true,
      opacity: gridStudio.room.floorGlowOpacity,
      depthWrite: false,
    }),
  );
  floorGlow.rotation.x = -Math.PI / 2;
  floorGlow.position.y = 0.035;
  group.add(floorGlow);

  const insetFloor = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.05, 1),
    new THREE.MeshStandardMaterial({
      color: gridStudio.room.insetFloor,
      roughness: 0.58,
      metalness: 0.14,
      emissive: projectAccent,
      emissiveIntensity: 0.01,
    }),
  );
  insetFloor.position.y = 0.11;
  insetFloor.receiveShadow = true;
  group.add(insetFloor);

  const floorCircuits = createFloorCircuitLines(projectAccent);
  group.add(floorCircuits);

  const border = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.18, 1)),
    new THREE.LineBasicMaterial({ color: projectAccent, transparent: true, opacity: gridStudio.room.borderOpacity }),
  );
  border.position.y = 0.02;
  group.add(border);

  const frontRail = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.045, 0.07),
    new THREE.MeshBasicMaterial({
      color: projectAccent,
      transparent: true,
      opacity: gridStudio.room.railOpacity,
    }),
  );
  group.add(frontRail);

  const backRail = createGlowBox(1, 0.045, 0.07, projectAccent, gridStudio.room.railOpacity);
  group.add(backRail);

  const leftRail = createGlowBox(0.07, 0.045, 1, projectAccent, gridStudio.room.railOpacity * 0.82);
  group.add(leftRail);

  const rightRail = createGlowBox(0.07, 0.045, 1, projectAccent, gridStudio.room.railOpacity * 0.82);
  group.add(rightRail);

  const selectionFrameMaterial = new THREE.MeshBasicMaterial({
    color: 0x67e8f9,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const selectionFrame = new THREE.Group();
  selectionFrame.visible = false;
  const selectionFrameBars = [
    new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 0.12), selectionFrameMaterial),
    new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 0.12), selectionFrameMaterial),
    new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 1), selectionFrameMaterial),
    new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 1), selectionFrameMaterial),
  ];
  for (const bar of selectionFrameBars) {
    selectionFrame.add(bar);
  }
  group.add(selectionFrame);

  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(1, 2.2, 0.14),
    new THREE.MeshStandardMaterial({
      color: gridStudio.room.backWall,
      roughness: 0.78,
      metalness: 0.04,
      emissive: projectAccent,
      emissiveIntensity: 0.006,
    }),
  );
  backWall.position.set(0, 1.05, -3.35);
  backWall.receiveShadow = true;
  group.add(backWall);

  const sideWall = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 2.2, 1),
    new THREE.MeshStandardMaterial({
      color: gridStudio.room.sideWall,
      roughness: 0.8,
      metalness: 0.04,
      emissive: projectAccent,
      emissiveIntensity: 0.005,
    }),
  );
  sideWall.position.set(-4.55, 1.05, 0);
  sideWall.receiveShadow = true;
  group.add(sideWall);

  const wallPanels = [];
  const wallPanelMaterial = new THREE.MeshStandardMaterial({
    color: gridStudio.room.wallPanel,
    roughness: 0.74,
    metalness: 0.08,
    emissive: projectAccent,
    emissiveIntensity: 0.012,
  });
  for (let index = 0; index < 4; index += 1) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1, 1.58, 0.035), wallPanelMaterial);
    panel.receiveShadow = true;
    group.add(panel);
    wallPanels.push(panel);
  }

  const backLightRail = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.045, 0.04),
    new THREE.MeshBasicMaterial({
      color: projectAccent,
      transparent: true,
      opacity: 0.28,
    }),
  );
  group.add(backLightRail);

  const sideLightRail = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.045, 1),
    new THREE.MeshBasicMaterial({
      color: projectAccent,
      transparent: true,
      opacity: 0.18,
    }),
  );
  group.add(sideLightRail);

  const signTexture = createProjectDisplayTexture(project, 0, state.privacy);
  const signBack = new THREE.Mesh(
    new THREE.BoxGeometry(5.25, 1.28, 0.16),
    new THREE.MeshStandardMaterial({
      color: gridStudio.room.signBack,
      emissive: 0x0b2a35,
      emissiveIntensity: 0.08,
      roughness: 0.52,
      metalness: 0.12,
    }),
  );
  signBack.position.set(0, PROJECT_SIGN_Y, -2.86);
  group.add(signBack);

  const signFace = new THREE.Mesh(
    new THREE.PlaneGeometry(5.08, 1.1),
    new THREE.MeshBasicMaterial({
      map: signTexture,
      transparent: true,
      depthTest: false,
    }),
  );
  signFace.position.set(0, PROJECT_SIGN_Y, -2.77);
  signFace.renderOrder = 8;
  group.add(signFace);

  const strutMaterial = new THREE.MeshBasicMaterial({
    color: projectAccent,
    transparent: true,
    opacity: 0.42,
  });
  const struts = [];
  for (const x of [-2.22, 2.22]) {
    const strut = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, PROJECT_SIGN_STRUT_HEIGHT, 10),
      strutMaterial,
    );
    strut.position.set(x, PROJECT_SIGN_STRUT_Y, -2.86);
    group.add(strut);
    struts.push(strut);
  }
  const linkRail = new THREE.Mesh(
    new THREE.BoxGeometry(4.8, 0.045, 0.045),
    new THREE.MeshBasicMaterial({
      color: projectAccent,
      transparent: true,
      opacity: 0.26,
    }),
  );
  linkRail.position.set(0, 0.18, -2.86);
  group.add(linkRail);
  group.userData.parts = {
    floor,
    floorGlow,
    insetFloor,
    border,
    floorCircuits,
    frontRail,
    backRail,
    leftRail,
    rightRail,
    selectionFrame,
    selectionFrameBars,
    selectionFrameMaterial,
    backWall,
    sideWall,
    wallPanels,
    backLightRail,
    sideLightRail,
    signBack,
    signFace,
    struts,
    linkRail,
  };
  group.userData.pickables = [
    floor,
    insetFloor,
    floorGlow,
    frontRail,
    backRail,
    leftRail,
    rightRail,
    backWall,
    sideWall,
    signBack,
    signFace,
  ];
  for (const pickable of group.userData.pickables) {
    pickable.userData.room = group;
    pickable.userData.project = project;
  }
  group.userData.projectDisplay = { texture: signTexture, project, count: 0, privacy: state.privacy };
  updateRoomSize(group, { width: 9.2, depth: 6.8 });

  scene.add(group);
  return group;
}

function updateRoomSize(room, layout) {
  const width = layout.width;
  const depth = layout.depth;
  const current = room.userData.size;
  if (current?.width === width && current?.depth === depth) {
    return;
  }

  const parts = room.userData.parts;
  parts.floor.scale.set(width, 1, depth);
  parts.floorGlow.scale.set(width * 0.92, depth * 0.9, 1);
  parts.insetFloor.scale.set(width * 0.82, 1, depth * 0.68);
  parts.border.scale.set(width + 0.05, 1, depth + 0.05);
  parts.frontRail.scale.set(width - 0.34, 1, 1);
  parts.frontRail.position.set(0, 0.13, depth / 2 - 0.08);
  parts.backRail.scale.set(width - 0.34, 1, 1);
  parts.backRail.position.set(0, 0.13, -depth / 2 + 0.08);
  parts.leftRail.scale.set(1, 1, depth - 0.34);
  parts.leftRail.position.set(-width / 2 + 0.08, 0.13, 0);
  parts.rightRail.scale.set(1, 1, depth - 0.34);
  parts.rightRail.position.set(width / 2 - 0.08, 0.13, 0);
  parts.floorCircuits.scale.set(width * 0.78, 1, depth * 0.62);
  const [frontSelectionRail, backSelectionRail, leftSelectionRail, rightSelectionRail] = parts.selectionFrameBars;
  frontSelectionRail.scale.set(width + 0.56, 1, 1);
  frontSelectionRail.position.set(0, 0.2, depth / 2 + 0.02);
  backSelectionRail.scale.set(width + 0.56, 1, 1);
  backSelectionRail.position.set(0, 0.2, -depth / 2 - 0.02);
  leftSelectionRail.scale.set(1, 1, depth + 0.56);
  leftSelectionRail.position.set(-width / 2 - 0.02, 0.2, 0);
  rightSelectionRail.scale.set(1, 1, depth + 0.56);
  rightSelectionRail.position.set(width / 2 + 0.02, 0.2, 0);
  parts.backWall.scale.set(width, 1, 1);
  parts.backWall.position.set(0, 1.05, -depth / 2 + 0.07);
  parts.sideWall.scale.set(1, 1, depth);
  parts.sideWall.position.set(-width / 2 + 0.07, 1.05, 0);
  for (const [index, panel] of parts.wallPanels.entries()) {
    const x = (((index + 1) / (parts.wallPanels.length + 1)) - 0.5) * width * 0.72;
    panel.position.set(x, 1.1, -depth / 2 + 0.16);
    panel.scale.set(Math.max(0.9, width / 9.2), 1, 1);
  }
  parts.backLightRail.scale.set(width - 1.1, 1, 1);
  parts.backLightRail.position.set(0, 2.03, -depth / 2 + 0.18);
  parts.sideLightRail.scale.set(1, 1, depth - 0.9);
  parts.sideLightRail.position.set(-width / 2 + 0.16, 2.02, 0.12);

  const signZ = -depth / 2 + 0.54;
  parts.signBack.position.set(0, PROJECT_SIGN_Y, signZ);
  parts.signFace.position.set(0, PROJECT_SIGN_Y, signZ + 0.09);
  for (const [index, strut] of parts.struts.entries()) {
    strut.position.set(index === 0 ? -2.22 : 2.22, PROJECT_SIGN_STRUT_Y, signZ);
  }
  parts.linkRail.position.set(0, 0.18, signZ);
  room.userData.size = { width, depth };
}

function createLabel(className) {
  const label = document.createElement("div");
  label.className = className;
  dom.labels.appendChild(label);
  return label;
}

function agentGlowForState(thread) {
  if (thread.state === "ACTIVE") {
    return { color: gridStudio.active, opacity: 0.62 };
  }
  if (thread.state === "DONE") {
    return { color: gridStudio.done, opacity: 0.28 };
  }
  return { color: 0x35525e, opacity: 0.12 };
}

function agentBodyColor(thread, parentColorHex) {
  return thread.state === "DONE" ? 0x3b2108 : parentColorHex;
}

function agentLabelBorderColor(thread, parentCssColor) {
  return thread.state === "DONE" ? "rgba(255, 138, 0, 0.68)" : parentCssColor;
}

function createParentAgent(parentGroup) {
  const group = new THREE.Group();
  group.userData.parentKey = parentGroup.key;

  const color = parentGroupColor(parentGroup);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x07111b,
    roughness: 0.36,
    metalness: 0.34,
    emissive: color,
    emissiveIntensity: parentGroup.isActive ? 0.12 : 0.035,
  });
  const headMaterial = new THREE.MeshStandardMaterial({
    color: 0x08131d,
    roughness: 0.34,
    metalness: 0.28,
    emissive: gridStudio.cyan,
    emissiveIntensity: 0.045,
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: parentGroup.isActive ? gridStudio.active : color,
    transparent: true,
    opacity: parentGroup.isActive ? 0.62 : 0.2,
    blending: THREE.AdditiveBlending,
  });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.46, 1.32, 6), bodyMaterial);
  body.position.y = 0.78;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 14), headMaterial);
  head.scale.set(0.86, 1, 0.78);
  head.position.y = 1.62;
  head.castShadow = true;
  group.add(head);

  const shoulder = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.14, 0.36), bodyMaterial);
  shoulder.position.y = 1.16;
  shoulder.castShadow = true;
  group.add(shoulder);

  const visorMaterial = new THREE.MeshBasicMaterial({
    color: gridStudio.cyan,
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
  });
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.055, 0.065), visorMaterial);
  visor.position.set(0, 1.64, 0.27);
  group.add(visor);

  const core = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, 0.08), glowMaterial);
  core.position.set(0, 0.86, 0.38);
  group.add(core);

  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.055, 0.08), glowMaterial);
  belt.position.set(0, 0.64, 0.39);
  group.add(belt);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.022, 8, 64), glowMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.09;
  group.add(ring);

  const disc = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.026, 8, 56), glowMaterial);
  disc.position.set(0, 1.12, -0.29);
  group.add(disc);

  group.userData.parts = { body, head, shoulder, visor, core, belt, ring, disc, bodyMaterial, glowMaterial };
  scene.add(group);
  return group;
}

function createAgent(thread) {
  const group = new THREE.Group();
  group.userData.threadId = thread.id;

  const color = parentColor(thread);
  const glow = agentGlowForState(thread);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: agentBodyColor(thread, color),
    roughness: 0.38,
    metalness: 0.28,
    emissive: color,
    emissiveIntensity: thread.state === "ACTIVE" ? 0.08 : 0.025,
  });
  const headMaterial = new THREE.MeshStandardMaterial({
    color: 0x08131d,
    roughness: 0.36,
    metalness: 0.2,
    emissive: gridStudio.cyan,
    emissiveIntensity: 0.03,
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: glow.color,
    transparent: true,
    opacity: glow.opacity,
    blending: THREE.AdditiveBlending,
  });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.29, 0.9, 6), bodyMaterial);
  body.position.y = 0.56;
  body.castShadow = true;
  body.userData.threadId = thread.id;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 16, 12), headMaterial);
  head.scale.set(0.86, 1, 0.78);
  head.position.y = 1.18;
  head.castShadow = true;
  head.userData.threadId = thread.id;
  group.add(head);

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.31, 0.07, 6), bodyMaterial);
  collar.position.y = 0.94;
  collar.castShadow = true;
  group.add(collar);

  const statusLightMaterial = new THREE.MeshBasicMaterial({
    color: glow.color,
    transparent: true,
    opacity: thread.state === "ACTIVE" ? 0.95 : 0.42,
    blending: THREE.AdditiveBlending,
  });
  const statusLight = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.045, 0.055), statusLightMaterial);
  statusLight.position.set(0, 1.2, 0.19);
  group.add(statusLight);

  const suitLine = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.42, 0.055), glowMaterial);
  suitLine.position.set(0, 0.58, 0.28);
  group.add(suitLine);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.018, 8, 48), glowMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.08;
  group.add(ring);

  group.userData.parts = { body, head, collar, statusLight, suitLine, ring, glowMaterial, statusLightMaterial };
  scene.add(group);
  state.selectable.push(body, head);
  return group;
}

function digestPosition(parentPosition, parentGroup) {
  const childCount = parentGroup.children?.length || 0;
  const radius = childCount > 0 ? childVisualLayout(childCount - 1, childCount).radius : 1.2;
  return parentPosition.clone().add(new THREE.Vector3(radius + 0.55, 0, -0.85));
}

function createDigestObject(parentGroup) {
  const group = new THREE.Group();
  group.userData.digestKey = parentGroup.key;

  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0x2c1602,
    roughness: 0.5,
    metalness: 0.22,
    emissive: 0x4a2100,
    emissiveIntensity: 0.16,
  });
  const tokenMaterial = new THREE.MeshStandardMaterial({
    color: gridStudio.digest,
    roughness: 0.36,
    metalness: 0.28,
    emissive: gridStudio.digest,
    emissiveIntensity: 0.2,
  });
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffb000,
    transparent: true,
    opacity: 0.46,
    blending: THREE.AdditiveBlending,
  });

  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.18, 28), baseMaterial);
  pedestal.position.y = 0.12;
  pedestal.castShadow = true;
  group.add(pedestal);

  const token = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), tokenMaterial);
  token.position.y = 0.48;
  token.castShadow = true;
  group.add(token);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.018, 8, 48), ringMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.22;
  group.add(ring);

  group.userData.parts = { pedestal, token, ring, baseMaterial, tokenMaterial, ringMaterial };
  group.userData.pickables = [pedestal, token, ring];
  scene.add(group);
  return group;
}

function updateDigestObjectReviewState(digestObject, reviewState) {
  const inactive = Boolean(reviewState.doneObjectInactive);
  const parts = digestObject.userData.parts;
  digestObject.userData.doneObjectInactive = inactive;
  digestObject.userData.remainingReviewCount = reviewState.unreviewed;

  parts.baseMaterial.color.setHex(inactive ? 0x101820 : 0x2c1602);
  parts.baseMaterial.emissive.setHex(inactive ? 0x000000 : 0x4a2100);
  parts.baseMaterial.emissiveIntensity = inactive ? 0 : 0.16;
  parts.tokenMaterial.color.setHex(inactive ? gridStudio.reviewed : gridStudio.digest);
  parts.tokenMaterial.emissive.setHex(inactive ? 0x000000 : gridStudio.digest);
  parts.tokenMaterial.emissiveIntensity = inactive ? 0 : 0.2;
  parts.ringMaterial.color.setHex(inactive ? 0x4b6470 : 0xffb000);
  parts.ringMaterial.opacity = inactive ? 0.12 : 0.46;
}

function updateDigestPickables(digestObject, parentGroup, room) {
  digestObject.userData.parentGroup = parentGroup;
  digestObject.userData.room = room;
  for (const pickable of digestObject.userData.pickables || []) {
    pickable.userData.parentGroupDigest = parentGroup;
    pickable.userData.room = room;
    pickable.userData.digestKey = parentGroup.key;
    state.selectable.push(pickable);
  }
}

function createHandoffCurve(start, end) {
  const middle = start.clone().lerp(end, 0.5);
  const distance = start.distanceTo(end);
  middle.y = Math.max(start.y, end.y) + Math.min(2.4, 0.75 + distance * 0.18);
  return new THREE.QuadraticBezierCurve3(start.clone(), middle, end.clone());
}

function curveLineGeometry(curve) {
  return new THREE.BufferGeometry().setFromPoints(curve.getPoints(28));
}

function curveTubeGeometry(curve, radius) {
  return new THREE.TubeGeometry(curve, 28, radius, 8, false);
}

function createHandoff() {
  const curve = createHandoffCurve(new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  const geometry = curveLineGeometry(curve);
  const lineMaterial = new THREE.LineBasicMaterial({
    color: gridStudio.cyan,
    transparent: true,
    opacity: 0.1,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const line = new THREE.Line(geometry, lineMaterial);
  line.renderOrder = 10;
  const packetMaterial = new THREE.MeshBasicMaterial({
    color: gridStudio.cyan,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const packet = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), packetMaterial);
  packet.renderOrder = 11;
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: gridStudio.cyan,
    transparent: true,
    opacity: 0.24,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const beam = new THREE.Mesh(curveTubeGeometry(curve, 0.024), beamMaterial);
  beam.renderOrder = 10;
  const group = new THREE.Group();
  group.add(line, beam, packet);
  group.userData.parts = { line, beam, packet, lineMaterial, beamMaterial, packetMaterial };
  scene.add(group);
  return group;
}

function updateHandoffGeometry(handoff, start, end, color, active) {
  const parts = handoff.userData.parts;
  const curve = createHandoffCurve(start, end);
  parts.line.geometry.dispose();
  parts.line.geometry = curveLineGeometry(curve);
  parts.beam.geometry.dispose();
  parts.beam.geometry = curveTubeGeometry(curve, active ? 0.04 : 0.014);
  parts.lineMaterial.color.setHex(color);
  parts.lineMaterial.opacity = active ? 0.82 : 0.08;
  parts.beamMaterial.color.setHex(color);
  parts.beamMaterial.opacity = active ? 0.28 : 0.04;
  parts.packetMaterial.color.setHex(color);
  parts.packet.visible = active;
  parts.beam.visible = active;
  handoff.userData.start = start.clone();
  handoff.userData.end = end.clone();
  handoff.userData.curve = curve;
  handoff.userData.active = active;
}

function assignParentGroupCenters(parentGroups, layout) {
  const positions = new Map();

  parentGroups.forEach((parentGroup, index) => {
    const { x, z } = parentGroupOffset(index, parentGroups.length, layout);
    positions.set(parentGroup.key, new THREE.Vector3(x, 0, z));
  });

  return positions;
}

function childPosition(parentPosition, index, total) {
  const layout = childVisualLayout(index, total);
  return {
    layout,
    position: parentPosition.clone().add(new THREE.Vector3(layout.x, 0, layout.z)),
  };
}

function addRoomSelectables() {
  for (const room of state.rooms.values()) {
    state.selectable.push(...(room.userData.pickables || []));
  }
}

function currentSceneSelection() {
  return {
    mode: state.selectedMode,
    project: state.selectedProject,
    threadId: state.selectedId,
    parentKey: state.selectedParentKey,
    digestKey: state.selectedDigest?.key || null,
  };
}

function selectedSceneObject(object) {
  return sceneObjectIsSelected(currentSceneSelection(), object);
}

function updateRoomVisualState(room, project) {
  const selected = selectedSceneObject({ type: "room", project });
  const parts = room.userData.parts;
  parts.floorGlow.material.opacity = selected
    ? gridStudio.room.selectedGlowOpacity
    : gridStudio.room.floorGlowOpacity;
  parts.border.material.opacity = selected
    ? gridStudio.room.selectedBorderOpacity
    : gridStudio.room.borderOpacity;
  parts.frontRail.material.opacity = selected ? 1 : gridStudio.room.railOpacity;
  parts.backRail.material.opacity = selected ? 1 : gridStudio.room.railOpacity;
  parts.leftRail.material.opacity = selected ? 0.9 : gridStudio.room.railOpacity * 0.82;
  parts.rightRail.material.opacity = selected ? 0.9 : gridStudio.room.railOpacity * 0.82;
  parts.signBack.material.emissiveIntensity = selected ? 0.46 : 0.14;
  parts.selectionFrame.visible = selected;
  parts.selectionFrameMaterial.opacity = selected ? 0.9 : 0;
}

function updateParentVisualState(parentAgent, parentKey) {
  const parentGroup = parentAgent.userData.parentGroup;
  const selected = selectedSceneObject({
    type: "parent",
    parentKey,
    threadId: parentGroup?.lead?.id,
  });
  const parts = parentAgent.userData.parts;
  if (!parentGroup?.isActive) {
    parts.glowMaterial.opacity = selected ? 0.34 : 0.2;
  }
  parts.disc.scale.setScalar(selected ? 1.16 : 1);
  const label = state.parentLabels.get(parentKey);
  if (label) {
    label.classList.toggle("is-selected", selected);
    label.style.borderColor = selected ? SELECTED_LABEL_BORDER : label.dataset.borderColor || "";
  }
}

function updateAgentVisualState(agent, threadId) {
  const selected = selectedSceneObject({ type: "agent", threadId });
  const parts = agent.userData.parts;
  if (agent.userData.thread?.state !== "ACTIVE") {
    parts.glowMaterial.opacity = selected ? 0.34 : agentGlowForState(agent.userData.thread).opacity;
  }
  parts.ring.scale.setScalar(selected ? 1.12 : 1);
  parts.suitLine.scale.setScalar(selected ? 1.12 : 1);
  const label = state.agentLabels.get(threadId);
  if (label) {
    label.classList.toggle("is-selected", selected);
    label.style.borderColor = selected ? SELECTED_LABEL_BORDER : label.dataset.borderColor || "";
  }
}

function updateDigestVisualState(digestObject, digestKey) {
  const selected = selectedSceneObject({ type: "digest", digestKey });
  const parts = digestObject.userData.parts;
  if (digestObject.userData.doneObjectInactive) {
    parts.ringMaterial.opacity = selected ? 0.24 : 0.12;
  }
  parts.ring.scale.setScalar(selected ? 1.12 : 1);
  const label = state.digestLabels.get(digestKey);
  if (label) {
    label.classList.toggle("is-selected", selected);
  }
}

function updateSceneVisualStates() {
  for (const [project, room] of state.rooms.entries()) {
    updateRoomVisualState(room, project);
  }
  for (const [parentKey, parentAgent] of state.parentAgents.entries()) {
    updateParentVisualState(parentAgent, parentKey);
  }
  for (const [threadId, agent] of state.agents.entries()) {
    updateAgentVisualState(agent, threadId);
  }
  for (const [digestKey, digestObject] of state.digestObjects.entries()) {
    updateDigestVisualState(digestObject, digestKey);
  }
}

function reconcileRooms(projectGroups) {
  const activeProjects = new Set(projectGroups.map((group) => group.project));
  const roomLayouts = new Map(
    projectGroups.map((projectGroup) => [
      projectGroup.project,
      projectRoomLayout(projectGroup.parentGroups),
    ]),
  );
  const layouts = [...roomLayouts.values()];
  const roomSpacing = projectRoomGridSpacing(layouts);
  for (const [project, room] of state.rooms.entries()) {
    if (!activeProjects.has(project)) {
      disposeObject3D(room);
      scene.remove(room);
      state.rooms.delete(project);
    }
  }

  projectGroups.forEach((projectGroup, index) => {
    const { project, threads } = projectGroup;
    const layout = roomLayouts.get(project);
    let room = state.rooms.get(project);
    if (!room) {
      room = createRoom(project);
      state.rooms.set(project, room);
    }
    room.position.copy(roomPosition(index, projectGroups.length, roomSpacing.gapX, roomSpacing.gapZ));
    room.userData.layout = layout;
    updateRoomSize(room, layout);
    const display = room.userData.projectDisplay;
    if (
      display &&
      (display.project !== project || display.count !== threads.length || display.privacy !== state.privacy)
    ) {
      updateProjectDisplayTexture(display.texture, project, threads.length, state.privacy);
      display.project = project;
      display.count = threads.length;
      display.privacy = state.privacy;
    }
  });

  for (const [project, room] of state.rooms.entries()) {
    updateRoomVisualState(room, project);
  }
}

function reconcileAgents(projectGroups) {
  const activeParentKeys = new Set(
    projectGroups.flatMap((projectGroup) => projectGroup.parentGroups.map((parentGroup) => parentGroup.key)),
  );
  const activeDigestKeys = new Set(
    projectGroups.flatMap((projectGroup) =>
      projectGroup.parentGroups.map((parentGroup) => parentGroup.key),
    ),
  );
  const childThreads = projectGroups.flatMap((projectGroup) =>
    projectGroup.parentGroups.flatMap((parentGroup) => parentGroup.children),
  );
  const activeIds = new Set(childThreads.map((thread) => thread.id));
  const activeHandoffKeys = new Set();
  const density = densityScale(state.density);
  state.selectable = [];
  addRoomSelectables();

  for (const [parentKey, parentAgent] of state.parentAgents.entries()) {
    if (!activeParentKeys.has(parentKey)) {
      disposeObject3D(parentAgent);
      scene.remove(parentAgent);
      state.parentAgents.delete(parentKey);
      const label = state.parentLabels.get(parentKey);
      if (label) {
        label.remove();
        state.parentLabels.delete(parentKey);
      }
    }
  }

  for (const [threadId, agent] of state.agents.entries()) {
    if (!activeIds.has(threadId)) {
      disposeObject3D(agent);
      scene.remove(agent);
      state.agents.delete(threadId);
      const label = state.agentLabels.get(threadId);
      if (label) {
        label.remove();
        state.agentLabels.delete(threadId);
      }
    }
  }

  for (const [digestKey, digestObject] of state.digestObjects.entries()) {
    if (!activeDigestKeys.has(digestKey)) {
      disposeObject3D(digestObject);
      scene.remove(digestObject);
      state.digestObjects.delete(digestKey);
      const label = state.digestLabels.get(digestKey);
      if (label) {
        label.remove();
        state.digestLabels.delete(digestKey);
      }
    }
  }

  for (const projectGroup of projectGroups) {
    const { project, parentGroups } = projectGroup;
    const room = state.rooms.get(project);
    const parentPositions = assignParentGroupCenters(parentGroups, room.userData.layout);
    for (const parentGroup of parentGroups) {
      const parentPosition = room.position.clone().add(parentPositions.get(parentGroup.key));
      let parentAgent = state.parentAgents.get(parentGroup.key);
      if (!parentAgent) {
        parentAgent = createParentAgent(parentGroup);
        state.parentAgents.set(parentGroup.key, parentAgent);
        state.parentLabels.set(parentGroup.key, createLabel("parent-label"));
      }
      parentAgent.userData.parentGroup = parentGroup;
      parentAgent.userData.thread = parentGroup.lead;
      parentAgent.position.copy(parentPosition);
      parentAgent.scale.setScalar(density);

      const parentParts = parentAgent.userData.parts;
      const parentColorHex = parentGroupColor(parentGroup);
      parentParts.bodyMaterial.color.setHex(0x07111b);
      parentParts.bodyMaterial.emissive.setHex(parentColorHex);
      parentParts.bodyMaterial.emissiveIntensity = parentGroup.isActive ? 0.12 : 0.035;
      parentParts.glowMaterial.color.setHex(parentGroup.isActive ? gridStudio.active : parentColorHex);
      parentParts.glowMaterial.opacity = parentGroup.isActive ? 0.62 : 0.2;
      parentParts.body.userData.threadId = parentGroup.lead.id;
      parentParts.body.userData.thread = parentGroup.lead;
      parentParts.body.userData.parentGroup = parentGroup;
      parentParts.body.userData.room = room;
      parentParts.head.userData.threadId = parentGroup.lead.id;
      parentParts.head.userData.thread = parentGroup.lead;
      parentParts.head.userData.parentGroup = parentGroup;
      parentParts.head.userData.room = room;
      for (const pickable of [parentParts.shoulder, parentParts.visor, parentParts.core, parentParts.belt, parentParts.disc]) {
        pickable.userData.threadId = parentGroup.lead.id;
        pickable.userData.thread = parentGroup.lead;
        pickable.userData.parentGroup = parentGroup;
        pickable.userData.room = room;
      }
      state.selectable.push(
        parentParts.body,
        parentParts.head,
        parentParts.shoulder,
        parentParts.visor,
        parentParts.core,
        parentParts.belt,
        parentParts.disc,
      );

      const parentLabel = state.parentLabels.get(parentGroup.key);
      const parentCssColor = cssHexColor(parentColorHex);
      parentLabel.textContent = visibleActivityLabel(
        privacyLabel(parentGroup.title, state.privacy),
        parentGroup.isActive,
      );
      parentLabel.classList.toggle("is-active", parentGroup.isActive);
      parentLabel.dataset.parentKey = parentGroup.key;
      parentLabel.dataset.borderColor = parentCssColor;
      parentLabel.style.borderColor = parentCssColor;
      parentLabel.style.boxShadow = "";

      let digestObject = state.digestObjects.get(parentGroup.key);
      if (!digestObject) {
        digestObject = createDigestObject(parentGroup);
        state.digestObjects.set(parentGroup.key, digestObject);
        state.digestLabels.set(parentGroup.key, createLabel("digest-label"));
      }
      digestObject.position.copy(digestPosition(parentPosition, parentGroup));
      const digestReviewState = reviewStateForParentGroup(parentGroup, state.reviewedThreadIds);
      updateDigestObjectReviewState(digestObject, digestReviewState);
      updateDigestPickables(digestObject, parentGroup, room);

      const digestLabel = state.digestLabels.get(parentGroup.key);
      digestLabel.textContent = `${parentGroup.finishedCount || 0} done`;
      digestLabel.dataset.digestKey = parentGroup.key;
      digestLabel.classList.toggle("is-empty", !parentGroup.finishedCount);
      digestLabel.classList.toggle("is-reviewed", digestReviewState.doneObjectInactive);

      for (const [index, thread] of parentGroup.children.entries()) {
        const child = childPosition(parentPositions.get(parentGroup.key), index, parentGroup.children.length);
        const localPosition = child.position;
        const worldPosition = room.position.clone().add(localPosition);
        let agent = state.agents.get(thread.id);
        if (!agent) {
          agent = createAgent(thread);
          state.agents.set(thread.id, agent);
          state.agentLabels.set(thread.id, createLabel("agent-label"));
        }
        agent.userData.thread = thread;
        agent.userData.room = room;
        agent.userData.labelHeight = 1.72 * child.layout.scale;
        agent.userData.layoutRing = child.layout.ring;
        agent.position.copy(worldPosition);
        agent.scale.setScalar(child.layout.scale * density);
        const parts = agent.userData.parts;
        const glow = agentGlowForState(thread);
        parts.body.material.color.setHex(agentBodyColor(thread, parentColorHex));
        parts.body.material.emissive.setHex(parentColorHex);
        parts.body.material.emissiveIntensity = thread.state === "ACTIVE" ? 0.08 : 0.025;
        parts.glowMaterial.color.setHex(glow.color);
        parts.glowMaterial.opacity = glow.opacity;
        parts.statusLightMaterial.color.setHex(glow.color);
        parts.statusLightMaterial.opacity = thread.state === "ACTIVE" ? 0.95 : 0.42;
        parts.body.userData.threadId = thread.id;
        parts.body.userData.thread = thread;
        parts.body.userData.room = room;
        parts.head.userData.threadId = thread.id;
        parts.head.userData.thread = thread;
        parts.head.userData.room = room;
        for (const pickable of [parts.collar, parts.statusLight, parts.suitLine]) {
          pickable.userData.threadId = thread.id;
          pickable.userData.thread = thread;
          pickable.userData.room = room;
        }
        state.selectable.push(parts.body, parts.head, parts.collar, parts.statusLight, parts.suitLine);

        const label = state.agentLabels.get(thread.id);
        label.textContent = visibleActivityLabel(
          privacyLabel(thread.nickname || "agent", state.privacy),
          thread.state === "ACTIVE",
        );
        label.classList.toggle("is-active", thread.state === "ACTIVE");
        label.classList.toggle("is-done", thread.state === "DONE");
        label.dataset.threadId = thread.id;
        label.dataset.parentId = thread.parent_id || thread.id;
        label.dataset.roomIndex = String(index);
        label.dataset.layoutRing = String(child.layout.ring);
        const agentBorderColor = agentLabelBorderColor(thread, parentCssColor);
        label.dataset.borderColor = agentBorderColor;
        label.style.borderColor = agentBorderColor;
        label.style.boxShadow = "";

        const handoffKey = `${parentGroup.key}:${thread.id}`;
        activeHandoffKeys.add(handoffKey);
        let handoff = state.handoffs.get(handoffKey);
        if (!handoff) {
          handoff = createHandoff();
          state.handoffs.set(handoffKey, handoff);
        }
        const start = parentPosition.clone().add(new THREE.Vector3(0, 1.18, 0));
        const end = worldPosition.clone().add(new THREE.Vector3(0, 0.92 * child.layout.scale, 0));
        const handoffActive = handoffShouldAnimate(parentGroup, thread);
        updateHandoffGeometry(handoff, start, end, parentColorHex, handoffActive);
      }
    }
  }

  for (const [handoffKey, handoff] of state.handoffs.entries()) {
    if (!activeHandoffKeys.has(handoffKey)) {
      disposeObject3D(handoff);
      scene.remove(handoff);
      state.handoffs.delete(handoffKey);
    }
  }

  updateSceneVisualStates();
  updateAgentLabelVisibility();
}

function updateAgentLabelVisibility() {
  const dense = shouldUseDenseLabels(state.projectGroups);
  for (const [threadId, label] of state.agentLabels.entries()) {
    const agent = state.agents.get(threadId);
    const thread = agent?.userData.thread;
    const roomIndex = Number(label.dataset.roomIndex || "0");
    const layoutRing = Number(label.dataset.layoutRing || "0");
    const selected = threadId === state.selectedId;
    const running = thread?.state === "ACTIVE";
    const keepRunningLabel = running && (layoutRing <= 1 || roomIndex < 12);
    label.hidden = Boolean(
      dense &&
        !keepRunningLabel &&
        !selected &&
        (layoutRing >= 2 || roomIndex >= 8),
    );
  }
}

function updateCounters(projectGroups) {
  const visibleThreads = projectGroups.reduce(
    (total, projectGroup) => total + projectGroup.threads.length,
    0,
  );
  const activeThreads = projectGroups.reduce(
    (total, projectGroup) =>
      total + projectGroup.threads.filter((thread) => thread.state === "ACTIVE").length,
    0,
  );
  dom.activeCount.textContent = String(activeThreads);
  dom.activeCounter.classList.toggle("is-running", activeThreads > 0);
  dom.activeCounter.setAttribute("aria-label", `${activeThreads} running now`);
  dom.visibleCount.textContent = String(visibleThreads);
  dom.projectCount.textContent = String(projectGroups.length);
}

function currentStaleBeforeMs() {
  return staleInboxCutoffMs(Date.now());
}

function refreshActionInbox() {
  state.actionInbox = buildActionInbox(state.actionInboxProjectGroups, state.reviewedThreadIds, {
    staleBeforeMs: currentStaleBeforeMs(),
  });
  state.reviewItems = state.actionInbox.reviewItems;
}

function visibleActionInboxItems(inbox) {
  const items = filterActionInboxItems(inbox, {
    unreviewedOnly: false,
    filter: state.actionInboxFilter,
    showStale: true,
  });
  if (!state.actionInboxFilter) {
    return items;
  }
  return items.filter((item) => item.type === state.actionInboxFilter);
}

function actionInboxTypeLabel(type) {
  if (type === "needs_review") {
    return "Needs review";
  }
  if (type === "running") {
    return "Running";
  }
  if (type === "stale") {
    return "Stale";
  }
  return "Reviewed";
}

function actionInboxItemAgeSeconds(item) {
  const ageSeconds = Number(item.age_seconds);
  if (Number.isFinite(ageSeconds)) {
    return ageSeconds;
  }
  if (item.latestUpdated) {
    return Math.max(0, Math.floor((Date.now() - item.latestUpdated) / 1000));
  }
  return 0;
}

function actionInboxItemActorLabel(item) {
  return item.nickname || item.parentTitle || item.title || "thread";
}

function actionInboxItemMetaText(label, item) {
  if (state.privacy) {
    return "Hidden";
  }
  return `${label} / ${item.project || "unknown"} / ${actionInboxItemActorLabel(item)} / ${formatAge(
    actionInboxItemAgeSeconds(item),
  )}`;
}

function actionInboxEmptyText() {
  if (state.actionInboxFilter) {
    return `No ${actionInboxTypeLabel(state.actionInboxFilter).toLowerCase()} items.`;
  }
  return "No inbox items.";
}

function renderReviewLane() {
  const inbox = state.actionInbox || buildActionInbox([]);
  const counts = inbox.counts || {};
  const visibleItems = visibleActionInboxItems(inbox);

  dom.inboxBadge.textContent = String(counts.needs_review || 0);
  dom.inboxToggle.setAttribute(
    "aria-label",
    `${counts.needs_review || 0} items need review`,
  );
  dom.reviewCount.textContent = `${counts.needs_review || 0} needs review / ${
    counts.running || 0
  } running / ${counts.stale || 0} stale / ${counts.reviewed || 0} reviewed`;
  for (const button of dom.actionInboxButtons) {
    const type = button.dataset.actionInboxFilter;
    button.setAttribute(
      "aria-pressed",
      String(state.actionInboxFilter === type),
    );
    const count = dom.actionInboxCounts.get(type);
    if (count) {
      count.textContent = String(counts[type] || 0);
    }
  }
  dom.reviewList.replaceChildren();

  if (!visibleItems.length) {
    const empty = document.createElement("p");
    empty.className = "review-empty";
    empty.textContent = actionInboxEmptyText();
    dom.reviewList.appendChild(empty);
    return;
  }

  for (const item of visibleItems) {
    const isReviewItem = item.type === "needs_review" || item.type === "reviewed";
    const row = document.createElement("div");
    row.className = `review-item is-${item.type}`;

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "review-item-main";
    openButton.addEventListener("click", () => openActionInboxItem(item));

    const meta = document.createElement("span");
    meta.className = "review-item-meta";
    meta.textContent = actionInboxItemMetaText(actionInboxTypeLabel(item.type), item);

    const title = document.createElement("span");
    title.className = "review-item-title";
    title.textContent = privacyLabel(item.title || item.parentTitle || "(untitled)", state.privacy);

    const snippet = document.createElement("span");
    snippet.className = "review-item-snippet";
    snippet.textContent = state.privacy
      ? "Hidden"
      : item.last_response_snippet || (item.latestUpdated ? new Date(item.latestUpdated).toLocaleString() : "");

    openButton.replaceChildren(meta, title, snippet);

    if (isReviewItem) {
      const toggle = document.createElement("button");
      const reviewToggleTarget = state.privacy ? "item" : item.title || "item";
      toggle.type = "button";
      toggle.className = "review-toggle";
      toggle.textContent = item.reviewed ? "✓" : "";
      toggle.setAttribute(
        "aria-label",
        item.reviewed ? `Mark ${reviewToggleTarget} unreviewed` : `Mark ${reviewToggleTarget} reviewed`,
      );
      toggle.setAttribute("aria-pressed", String(item.reviewed));
      toggle.addEventListener("click", () => toggleReviewedThread(item.id));
      row.replaceChildren(openButton, toggle);
    } else {
      const status = document.createElement("span");
      status.className = "review-status-pill";
      status.textContent = actionInboxTypeLabel(item.type);
      row.replaceChildren(openButton, status);
    }
    dom.reviewList.appendChild(row);
  }
}

function toggleReviewedThread(threadId) {
  if (state.reviewedThreadIds.has(threadId)) {
    state.reviewedThreadIds.delete(threadId);
  } else {
    state.reviewedThreadIds.add(threadId);
  }
  saveReviewedThreadIds();
  refreshActionInbox();
  reconcileAgents(state.projectGroups);
  renderReviewLane();
  renderSelectedParentTimeline();
}

function updateStatus(payload) {
  if (payload.error) {
    dom.statusText.textContent = `Codex app-server unavailable: ${payload.error}`;
    return;
  }
  const generated = new Date(payload.generated_at_ms);
  const sendStatus = payload.capabilities?.send_messages === false ? " · read-only" : "";
  dom.statusText.textContent = `Updated ${generated.toLocaleTimeString()} from Codex app-server${sendStatus}`;
}

function currentSceneMaxAgeHours() {
  return dom.maxAgeHours.value || "8";
}

function currentFetchMaxAgeHours() {
  return actionInboxFetchMaxAgeHours(currentSceneMaxAgeHours());
}

async function fetchThreads(maxAgeHours = currentFetchMaxAgeHours()) {
  const params = new URLSearchParams({ maxAgeHours });
  const response = await fetch(`/api/threads?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchThreadDetail(threadId) {
  const response = await fetch(`/api/thread/${encodeURIComponent(threadId)}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function visibleParentGroups() {
  return state.actionInboxProjectGroups.flatMap((projectGroup) => projectGroup.parentGroups || []);
}

function findParentGroupByKey(parentKey) {
  return visibleParentGroups().find((parentGroup) => parentGroup.key === parentKey) || null;
}

function showParentDetails(parentGroup) {
  showDetails(parentGroup.lead, parentGroup);
}

function focusParentGroupRoom(parentGroup) {
  const room = state.rooms.get(parentGroup?.project);
  if (room) {
    focusCameraOnRoom(room);
  }
}

function focusInitialRoom(projectGroups) {
  if (state.hasInitialCameraFocus || state.cameraFocus || state.selectedMode) {
    return;
  }
  const room = state.rooms.get(projectGroups[0]?.project);
  if (!room) {
    return;
  }
  state.hasInitialCameraFocus = true;
  focusCameraOnRoom(room);
}

function openActionInboxItem(item) {
  const parentGroup = findParentGroupByKey(actionInboxItemParentKey(item));
  if (parentGroup) {
    focusParentGroupRoom(parentGroup);
  }
  if (item.type === "running" || item.type === "stale") {
    if (parentGroup) {
      showParentDetails(parentGroup);
    }
    return;
  }
  showDetails(digestDetailThread(item));
}

function renderSelectedParentTimeline() {
  if (!state.selectedParentKey || !state.selectedThread) {
    return;
  }
  const parentGroup = findParentGroupByKey(state.selectedParentKey);
  if (parentGroup) {
    renderDetails(parentGroup.lead, parentGroup);
  }
}

function applyThreadsPayload(payload) {
  const fetchedThreads = filterThreadsByMaxAge(
    payload.threads || [],
    payload.generated_at_ms,
    currentFetchMaxAgeHours(),
  );
  const searchedThreads = fetchedThreads.filter((thread) =>
    matchesThreadSearch(thread, state.search),
  );
  const visibleThreads = filterThreadsByMaxAge(
    searchedThreads,
    payload.generated_at_ms,
    currentSceneMaxAgeHours(),
  );
  state.threads = searchedThreads;
  state.actionInboxProjectGroups = buildProjectParentGroups(searchedThreads);
  const allProjectGroups = buildProjectParentGroups(visibleThreads);
  const projectGroups = filterVisibleProjectGroups(allProjectGroups, state.showInactive);
  state.projectGroups = projectGroups;
  state.density = autoDensityMode(state.projectGroups);
  dom.densityStatus.textContent = `Density: Auto (${state.density})`;
  refreshActionInbox();
  reconcileRooms(projectGroups);
  focusInitialRoom(projectGroups);
  reconcileAgents(projectGroups);
  updateCounters(projectGroups);
  renderReviewLane();
  updateStatus(payload);
  refreshSelectedDetails(projectGroups);
}

function refreshSelectedDetails(projectGroups) {
  if (state.selectedMode === "room") {
    const selectedProjectVisible = projectGroups.some(
      (projectGroup) => projectGroup.project === state.selectedProject,
    );
    if (!state.selectedProject || !selectedProjectVisible || !state.rooms.has(state.selectedProject)) {
      clearDetails();
    }
    return;
  }

  if (state.selectedMode === "digest" && state.selectedDigest?.key) {
    const selectedDigest = projectGroups
      .flatMap((projectGroup) => projectGroup.parentGroups)
      .find((parentGroup) => parentGroup.key === state.selectedDigest.key);
    if (selectedDigest) {
      renderDigestDetails(selectedDigest);
    } else {
      clearDetails();
    }
    return;
  }

  if (state.selectedParentKey) {
    const selectedParent = findParentGroupByKey(state.selectedParentKey);
    if (selectedParent) {
      renderDetails(selectedParent.lead, selectedParent);
    } else {
      clearDetails();
    }
    return;
  }

  if (!state.selectedId) {
    return;
  }

  const selected = projectGroups
    .flatMap((projectGroup) => projectGroup.threads)
    .find((thread) => thread.id === state.selectedId);
  const selectedFromPayload = selected || state.threads.find((thread) => thread.id === state.selectedId);
  if (selectedFromPayload) {
    renderDetails(selectedFromPayload);
    return;
  }

  const selectedParent = [...state.parentAgents.values()]
    .map((agent) => agent.userData.thread)
    .find((thread) => thread?.id === state.selectedId);
  if (selectedParent) {
    renderDetails(selectedParent);
  } else {
    clearDetails();
  }
}

async function refreshThreads({ force = false } = {}) {
  const requestedFetchMaxAgeHours = currentFetchMaxAgeHours();
  if (
    !force &&
    state.lastPayload &&
    !state.lastPayload.error &&
    fetchMaxAgeCovers(state.lastFetchMaxAgeHours, requestedFetchMaxAgeHours)
  ) {
    applyThreadsPayload(state.lastPayload);
    return;
  }

  const seq = ++state.refreshSeq;
  state.refreshing = true;
  try {
    const payload = await fetchThreads(requestedFetchMaxAgeHours);
    if (seq !== state.refreshSeq) {
      return;
    }
    if (!fetchMaxAgeCovers(requestedFetchMaxAgeHours, currentFetchMaxAgeHours())) {
      return;
    }
    if (payload.error) {
      state.lastPayload = null;
      state.lastFetchMaxAgeHours = null;
    } else {
      state.lastPayload = payload;
      state.lastFetchMaxAgeHours = requestedFetchMaxAgeHours;
    }
    applyThreadsPayload(payload);
  } catch (error) {
    if (seq !== state.refreshSeq) {
      return;
    }
    dom.statusText.textContent = `Refresh failed: ${error.message}`;
  } finally {
    if (seq === state.refreshSeq) {
      state.refreshing = false;
    }
  }
}

function showDetails(thread, parentGroup = null) {
  state.selectedMode = "thread";
  state.selectedProject = null;
  state.selectedDigest = null;
  state.selectedParentKey = parentGroup?.key || null;
  state.selectedId = thread.id;
  state.selectedThread = thread;
  updateSceneVisualStates();
  renderDetails(thread, parentGroup);
  setInspectorOpen(true);
  if (parentGroup) {
    state.detailSeq += 1;
    return;
  }
  loadThreadDetail(thread);
}

function showDigest(parentGroup) {
  state.selectedMode = "digest";
  state.selectedProject = null;
  state.selectedDigest = parentGroup;
  state.selectedParentKey = null;
  state.selectedId = null;
  state.selectedThread = null;
  updateSceneVisualStates();
  state.detailSeq += 1;
  renderDigestDetails(parentGroup);
  setInspectorOpen(true);
}

function showRoomFocus(room) {
  state.selectedMode = "room";
  state.selectedProject = room.userData.project || null;
  state.selectedDigest = null;
  state.selectedParentKey = null;
  state.selectedId = null;
  state.selectedThread = null;
  state.detailSeq += 1;
  setInspectorOpen(false);
  updateAgentLabelVisibility();
  updateSceneVisualStates();
}

function setDetailThreadBoxesVisible(visible) {
  dom.detailAgentPromptLabel.hidden = !visible;
  dom.detailAgentPrompt.hidden = !visible;
  dom.detailLastResponseLabel.hidden = !visible;
  dom.detailLastResponse.hidden = !visible;
  dom.detailThreadContentLabel.hidden = visible;
  dom.detailThreadContent.hidden = visible;
}

function renderDetails(thread, parentGroup = null) {
  const timelineParentGroup = parentGroup || findParentGroupByKey(state.selectedParentKey);
  const shouldRenderTimeline = Boolean(
    timelineParentGroup && timelineParentGroup.lead?.id === thread.id,
  );
  state.selectedMode = "thread";
  state.selectedDigest = null;
  state.selectedThread = thread;
  updateAgentLabelVisibility();
  dom.detailNickname.textContent = privacyLabel(thread.nickname || "agent", state.privacy);
  dom.detailState.textContent = `${threadActivityLabel(thread)} / ${thread.intensity || "idle"}`;
  dom.detailState.classList.toggle("is-running", thread.state === "ACTIVE");
  dom.detailState.classList.toggle("is-done", thread.state === "DONE");
  dom.detailState.classList.toggle("is-digest", false);
  dom.detailRole.textContent = thread.role || "thread";
  dom.detailProject.textContent = privacyLabel(thread.project || "unknown", state.privacy);
  dom.detailAge.textContent = formatAge(thread.age_seconds);
  if (shouldRenderTimeline) {
    setDetailThreadBoxesVisible(false);
    dom.detailThreadContentLabel.textContent = "Parent timeline";
    renderParentTimeline(timelineParentGroup);
  } else {
    setDetailThreadBoxesVisible(true);
    const cached = state.detailCache.get(thread.id);
    const loadingText = "Loading thread content...";
    dom.detailAgentPrompt.textContent = state.privacy
      ? "Hidden"
      : cached
        ? cached.agent_prompt || "(no agent prompt captured)"
        : loadingText;
    dom.detailLastResponse.textContent = state.privacy
      ? "Hidden"
      : cached
        ? cached.last_response || "(no last response captured)"
        : loadingText;
  }
  dom.detailParent.textContent = privacyLabel(thread.parent_title || "(none)", state.privacy);
}

function digestDetailThread(item) {
  const thread = state.threads.find((candidate) => candidate.id === item.id);
  return thread || {
    ...item,
    state: "DONE",
    intensity: "digest",
    cwd: "",
  };
}

function timelineItemStateLabel(item) {
  if (item.type === "active") {
    return "Running";
  }
  if (item.type === "idle") {
    return "Idle";
  }
  return "Finished";
}

function timelineItemStatusLabel(item) {
  if (item.type === "active") {
    return "Running";
  }
  if (item.type === "idle") {
    return "Idle";
  }
  return item.reviewed ? "Reviewed" : "Needs review";
}

function renderParentTimeline(parentGroup) {
  const items = buildParentTimeline(parentGroup, state.reviewedThreadIds);
  const list = document.createElement("div");
  list.className = "timeline-list";

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "timeline-empty";
    empty.textContent = "No active or finished items.";
    list.appendChild(empty);
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = `timeline-item is-${item.type}`;

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "timeline-item-main";
    openButton.addEventListener("click", () => {
      if (item.type === "finished") {
        showDetails(digestDetailThread(item));
      } else {
        showDetails(item);
      }
    });

    const meta = document.createElement("span");
    meta.className = "timeline-item-meta";
    meta.textContent = actionInboxItemMetaText(timelineItemStateLabel(item), item);

    const title = document.createElement("span");
    title.className = "timeline-item-title";
    title.textContent = privacyLabel(item.title || "(untitled)", state.privacy);

    const snippet = document.createElement("span");
    snippet.className = "timeline-item-snippet";
    snippet.textContent = state.privacy ? "Hidden" : item.last_response_snippet || "";

    openButton.replaceChildren(meta, title, snippet);

    const status = document.createElement("span");
    status.className = "timeline-status";
    status.textContent = timelineItemStatusLabel(item);

    row.replaceChildren(openButton, status);
    list.appendChild(row);
  }

  dom.detailThreadContent.replaceChildren(list);
}

function renderDigestDetails(parentGroup) {
  state.selectedDigest = parentGroup;
  updateAgentLabelVisibility();
  dom.detailNickname.textContent = privacyLabel(parentGroup.title || "Finished agents", state.privacy);
  dom.detailState.textContent = "DONE DIGEST";
  dom.detailState.classList.toggle("is-running", false);
  dom.detailState.classList.toggle("is-done", false);
  dom.detailState.classList.toggle("is-digest", true);
  dom.detailRole.textContent = "digest";
  dom.detailProject.textContent = privacyLabel(parentGroup.project || "unknown", state.privacy);
  dom.detailAge.textContent = parentGroup.latestFinishedAt
    ? formatAge(Math.max(0, Math.floor((Date.now() - parentGroup.latestFinishedAt) / 1000)))
    : "(none)";
  dom.detailParent.textContent = privacyLabel(parentGroup.parentId || "(none)", state.privacy);
  setDetailThreadBoxesVisible(false);
  dom.detailThreadContentLabel.textContent = "Finished digest";

  const items = (parentGroup.digestItems || []).slice().sort((left, right) => {
    return (right.updated_at_ms || 0) - (left.updated_at_ms || 0);
  });
  const list = document.createElement("div");
  list.className = "digest-list";

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "digest-empty";
    empty.textContent = "No done items captured.";
    list.appendChild(empty);
  }

  for (const item of items) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "digest-card";
    card.addEventListener("click", () => showDetails(digestDetailThread(item)));

    const meta = document.createElement("span");
    meta.className = "digest-card-meta";
    meta.textContent = `${privacyLabel(item.nickname || "agent", state.privacy)} / ${formatAge(
      item.age_seconds || 0,
    )}`;

    const title = document.createElement("span");
    title.className = "digest-card-title";
    title.textContent = privacyLabel(item.title || "(untitled)", state.privacy);

    const response = document.createElement("span");
    response.className = "digest-card-response";
    response.textContent = state.privacy ? "Hidden" : item.last_response_snippet || "No response captured";

    card.replaceChildren(meta, title, response);
    list.appendChild(card);
  }

  dom.detailThreadContent.replaceChildren(list);
}

async function loadThreadDetail(thread) {
  if (state.detailCache.has(thread.id)) {
    if (state.selectedMode !== "thread" || state.selectedId !== thread.id) {
      return;
    }
    renderDetails({ ...thread, ...state.detailCache.get(thread.id) });
    return;
  }

  const seq = ++state.detailSeq;
  try {
    const payload = await fetchThreadDetail(thread.id);
    if (seq !== state.detailSeq || state.selectedMode !== "thread" || state.selectedId !== thread.id) {
      return;
    }
    if (payload.error) {
      throw new Error(payload.error);
    }
    const detail = payload.thread || {};
    state.detailCache.set(thread.id, detail);
    renderDetails({ ...thread, ...detail });
  } catch (error) {
    if (seq !== state.detailSeq || state.selectedMode !== "thread" || state.selectedId !== thread.id) {
      return;
    }
    const errorText = `Unable to load thread content: ${error.message}`;
    dom.detailAgentPrompt.textContent = state.privacy ? "Hidden" : errorText;
    dom.detailLastResponse.textContent = state.privacy ? "Hidden" : errorText;
  }
}

function clearDetails() {
  state.selectedMode = null;
  state.selectedProject = null;
  state.selectedDigest = null;
  state.selectedParentKey = null;
  state.selectedId = null;
  state.selectedThread = null;
  updateAgentLabelVisibility();
  setInspectorOpen(false);
  updateSceneVisualStates();
}

function vectorFromPlain(value) {
  return new THREE.Vector3(value.x, value.y, value.z);
}

function smoothstep(progress) {
  return progress * progress * (3 - 2 * progress);
}

function focusCameraOnRoom(room) {
  const focus = roomCameraFocus(room.position, room.userData.size, camera.position, controls.target);
  state.cameraFocus = {
    startedAt: performance.now(),
    durationMs: focus.durationMs,
    startPosition: camera.position.clone(),
    startTarget: controls.target.clone(),
    endPosition: vectorFromPlain(focus.position),
    endTarget: vectorFromPlain(focus.target),
  };
}

function updateCameraFocus(nowMs) {
  if (!state.cameraFocus) {
    return;
  }
  const focus = state.cameraFocus;
  const progress = Math.min(1, (nowMs - focus.startedAt) / focus.durationMs);
  const eased = smoothstep(progress);
  camera.position.lerpVectors(focus.startPosition, focus.endPosition, eased);
  controls.target.lerpVectors(focus.startTarget, focus.endTarget, eased);
  if (progress >= 1) {
    state.cameraFocus = null;
  }
}

function pickSceneAt(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObjects(state.selectable, false);
  if (!intersects.length) {
    clearDetails();
    return;
  }
  const picked = intersects[0].object;
  const room = picked.userData.room;
  if (room) {
    focusCameraOnRoom(room);
  }
  const parentGroupDigest = picked.userData.parentGroupDigest;
  if (parentGroupDigest) {
    showDigest(parentGroupDigest);
    return;
  }
  const parentGroup = picked.userData.parentGroup;
  if (parentGroup) {
    showParentDetails(parentGroup);
    return;
  }
  const threadId = picked.userData.threadId;
  const thread = picked.userData.thread || state.threads.find((item) => item.id === threadId);
  if (thread) {
    showDetails(thread);
    return;
  }
  if (room) {
    showRoomFocus(room);
    return;
  }
  clearDetails();
}

function onPointerDown(event) {
  if (event.button !== 0) {
    pendingPointerPick = null;
    return;
  }
  pendingPointerPick = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
  };
}

function onPointerUp(event) {
  if (!pendingPointerPick || pendingPointerPick.pointerId !== event.pointerId) {
    pendingPointerPick = null;
    return;
  }
  const distance = Math.hypot(event.clientX - pendingPointerPick.x, event.clientY - pendingPointerPick.y);
  pendingPointerPick = null;
  if (distance > CLICK_MOVE_LIMIT_PX) {
    return;
  }
  pickSceneAt(event);
}

function onPointerCancel() {
  pendingPointerPick = null;
}

function updateLabels() {
  const width = dom.scene.clientWidth;
  const height = dom.scene.clientHeight;
  const vector = new THREE.Vector3();

  for (const [parentKey, label] of state.parentLabels.entries()) {
    const parentAgent = state.parentAgents.get(parentKey);
    if (!parentAgent) {
      continue;
    }
    vector.set(parentAgent.position.x, parentAgent.position.y + 2.38, parentAgent.position.z);
    vector.project(camera);
    label.style.left = `${(vector.x * 0.5 + 0.5) * width}px`;
    label.style.top = `${(-vector.y * 0.5 + 0.5) * height}px`;
  }

  for (const [threadId, label] of state.agentLabels.entries()) {
    const agent = state.agents.get(threadId);
    if (!agent) {
      continue;
    }
    vector.set(agent.position.x, agent.position.y + (agent.userData.labelHeight || 1.72), agent.position.z);
    vector.project(camera);
    label.style.left = `${(vector.x * 0.5 + 0.5) * width}px`;
    label.style.top = `${(-vector.y * 0.5 + 0.5) * height}px`;
  }

  for (const [digestKey, label] of state.digestLabels.entries()) {
    const digestObject = state.digestObjects.get(digestKey);
    if (!digestObject) {
      continue;
    }
    vector.set(digestObject.position.x, digestObject.position.y + 1.12, digestObject.position.z);
    vector.project(camera);
    label.style.left = `${(vector.x * 0.5 + 0.5) * width}px`;
    label.style.top = `${(-vector.y * 0.5 + 0.5) * height}px`;
  }

}

function animateAgents(elapsed) {
  for (const parentAgent of state.parentAgents.values()) {
    const parentGroup = parentAgent.userData.parentGroup;
    const parts = parentAgent.userData.parts;
    const speed = parentGroup?.isActive ? 2.6 : 0.8;
    const selected = selectedSceneObject({
      type: "parent",
      parentKey: parentGroup?.key || parentAgent.userData.parentKey,
      threadId: parentGroup?.lead?.id,
    });
    parentAgent.position.y = Math.sin(elapsed * speed + hashString(parentGroup?.parentId || "")) * (parentGroup?.isActive ? 0.05 : 0.008);
    parts.head.rotation.z = Math.sin(elapsed * speed) * (parentGroup?.isActive ? 0.04 : 0.01);
    parts.ring.scale.setScalar(1 + Math.sin(elapsed * speed) * (parentGroup?.isActive ? 0.08 : 0.012));
    parts.core.scale.setScalar(1 + Math.sin(elapsed * speed * 1.2) * (parentGroup?.isActive ? 0.12 : 0.02));
    parts.disc.rotation.z = elapsed * (parentGroup?.isActive ? 0.8 : 0.2);
    const discScale = 1 + Math.sin(elapsed * speed * 0.8) * (parentGroup?.isActive ? 0.08 : 0.018);
    parts.disc.scale.setScalar(selected ? Math.max(1.16, discScale) : discScale);
  }

  for (const handoff of state.handoffs.values()) {
    const parts = handoff.userData.parts;
    if (!handoff.userData.active) {
      parts.packet.visible = false;
      continue;
    }
    const curve = handoff.userData.curve;
    const phase = (elapsed * 0.85 + (hashString(handoff.uuid) % 100) / 100) % 1;
    parts.packet.visible = true;
    parts.packet.position.copy(curve.getPoint(phase));
    parts.packet.scale.setScalar(0.8 + Math.sin(phase * Math.PI) * 0.9);
  }

  for (const agent of state.agents.values()) {
    const thread = agent.userData.thread;
    const parts = agent.userData.parts;
    const selected = selectedSceneObject({ type: "agent", threadId: thread.id });
    if (thread.state === "ACTIVE") {
      const speed = thread.intensity === "energetic" ? 5.8 : 3.4;
      const pulse = Math.sin(elapsed * speed) * 0.08;
      const ringScale = 1 + pulse;
      agent.position.y = Math.sin(elapsed * speed + hashString(thread.id)) * 0.08;
      parts.head.rotation.z = pulse;
      parts.ring.scale.setScalar(selected ? Math.max(1.12, ringScale) : ringScale);
      parts.statusLight.scale.setScalar(1.1 + Math.abs(pulse) * 2.2);
    } else if (thread.state === "DONE") {
      agent.position.y = 0;
      parts.head.rotation.z = 0;
      parts.ring.scale.setScalar(selected ? 1.12 : 1);
      parts.statusLight.scale.setScalar(selected ? 1.08 : 0.92);
    } else {
      agent.position.y = Math.sin(elapsed * 1.2 + hashString(thread.id)) * 0.008;
      parts.head.rotation.z = Math.sin(elapsed * 0.8) * 0.012;
      parts.ring.scale.setScalar(selected ? 1.12 : 1);
      parts.statusLight.scale.setScalar(selected ? 1.08 : 1);
    }
  }

  for (const digestObject of state.digestObjects.values()) {
    const parts = digestObject.userData.parts;
    if (digestObject.userData.doneObjectInactive) {
      const selected = selectedSceneObject({
        type: "digest",
        digestKey: digestObject.userData.digestKey,
      });
      parts.token.rotation.y = 0;
      parts.ring.scale.setScalar(selected ? 1.12 : 1);
      parts.ringMaterial.opacity = selected ? 0.24 : 0.12;
      continue;
    }
    const pulse = 1 + Math.sin(elapsed * 1.7 + hashString(digestObject.userData.digestKey || "")) * 0.035;
    const selected = selectedSceneObject({
      type: "digest",
      digestKey: digestObject.userData.digestKey,
    });
    parts.token.rotation.y = elapsed * 0.28;
    parts.ring.scale.setScalar(selected ? Math.max(1.12, pulse) : pulse);
    parts.ringMaterial.opacity = 0.46;
  }
}

function resize() {
  const width = Math.max(1, dom.scene.clientWidth);
  const height = Math.max(1, dom.scene.clientHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function animate() {
  requestAnimationFrame(animate);
  const elapsed = clock.getElapsedTime();
  updateCameraFocus(performance.now());
  controls.update();
  animateAgents(elapsed);
  updateLabels();
  renderer.render(scene, camera);
}

function updatePrivacySensitiveUi() {
  for (const [parentKey, label] of state.parentLabels.entries()) {
    const parentGroup = state.parentAgents.get(parentKey)?.userData.parentGroup;
    if (parentGroup) {
      label.textContent = visibleActivityLabel(
        privacyLabel(parentGroup.title, state.privacy),
        parentGroup.isActive,
      );
    }
  }

  for (const [threadId, label] of state.agentLabels.entries()) {
    const thread = state.agents.get(threadId)?.userData.thread;
    if (thread) {
      label.textContent = visibleActivityLabel(
        privacyLabel(thread.nickname || "agent", state.privacy),
        thread.state === "ACTIVE",
      );
    }
  }

  for (const room of state.rooms.values()) {
    const display = room.userData.projectDisplay;
    if (display) {
      updateProjectDisplayTexture(display.texture, display.project, display.count, state.privacy);
      display.privacy = state.privacy;
    }
  }

  if (state.selectedThread) {
    renderDetails(state.selectedThread);
  }

  if (state.selectedDigest) {
    renderDigestDetails(state.selectedDigest);
  }

  renderReviewLane();
}

function setPrivacy(nextPrivacy, { refresh = true } = {}) {
  state.privacy = nextPrivacy;
  dom.privacyToggle.setAttribute("aria-pressed", String(nextPrivacy));
  dom.privacyToggle.textContent = nextPrivacy ? "Privacy on" : "Privacy";
  savePreferences();
  updatePrivacySensitiveUi();
  if (refresh) {
    refreshThreads();
  }
}

function setShowInactive(nextShowInactive, { refresh = true } = {}) {
  state.showInactive = nextShowInactive;
  dom.inactiveToggle.textContent = nextShowInactive ? "Hide idle" : "Show idle";
  dom.inactiveToggle.setAttribute("aria-pressed", String(nextShowInactive));
  savePreferences();
  if (refresh) {
    refreshThreads();
  }
}

function setInboxOpen(nextOpen) {
  state.inboxOpen = nextOpen;
  dom.inboxDrawer.hidden = !nextOpen;
  dom.inboxToggle.setAttribute("aria-expanded", String(nextOpen));
}

function setInspectorOpen(nextOpen) {
  state.inspectorOpen = nextOpen;
  dom.inspectorOverlay.hidden = !nextOpen;
}

function bindEvents() {
  window.addEventListener("resize", resize);
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerCancel);
  dom.settingsToggle.addEventListener("click", () => dom.settingsDialog.showModal());
  dom.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    dom.settingsDialog.close();
  });
  dom.maxAgeHours.addEventListener("change", () => {
    savePreferences();
    refreshThreads();
  });
  dom.privacyToggle.addEventListener("click", () => setPrivacy(!state.privacy));
  dom.inactiveToggle.addEventListener("click", () => setShowInactive(!state.showInactive));
  dom.inboxToggle.addEventListener("click", () => setInboxOpen(!state.inboxOpen));
  dom.inboxClose.addEventListener("click", () => setInboxOpen(false));
  dom.inspectorClose.addEventListener("click", () => setInspectorOpen(false));
  for (const button of dom.actionInboxButtons) {
    button.addEventListener("click", () => {
      const filter = button.dataset.actionInboxFilter;
      state.actionInboxFilter = state.actionInboxFilter === filter ? null : filter;
      renderReviewLane();
    });
  }
}

function startPolling() {
  refreshThreads({ force: true });
  window.setInterval(() => {
    if (shouldPollThreads(state.live, state.refreshing)) {
      refreshThreads({ force: true });
    }
  }, 2000);
}

resize();
bindEvents();
const prefs = loadPreferences();
dom.maxAgeHours.value = prefs.maxAgeHours;
state.labels = true;
state.live = true;
dom.labels.classList.toggle("is-hidden", false);
setShowInactive(prefs.showInactive, { refresh: false });
setPrivacy(prefs.privacy, { refresh: false });
startPolling();
animate();
