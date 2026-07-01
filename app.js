import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  actionInboxFetchMaxAgeHours,
  actionInboxItemParentKey,
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
  privacyPath,
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
  appLayout: document.querySelector(".app-layout"),
  scene: document.querySelector("#scene"),
  labels: document.querySelector("#labels"),
  emptyState: document.querySelector("#emptyState"),
  statusText: document.querySelector("#statusText"),
  activeCount: document.querySelector("#activeCount"),
  activeCounter: document.querySelector("#activeCount").closest(".counter"),
  visibleCount: document.querySelector("#visibleCount"),
  projectCount: document.querySelector("#projectCount"),
  controls: document.querySelector("#controls"),
  maxAgeHours: document.querySelector("#maxAgeHours"),
  densityMode: document.querySelector("#densityMode"),
  threadSearch: document.querySelector("#threadSearch"),
  liveToggle: document.querySelector("#liveToggle"),
  labelsToggle: document.querySelector("#labelsToggle"),
  privacyToggle: document.querySelector("#privacyToggle"),
  inactiveToggle: document.querySelector("#inactiveToggle"),
  detailsPanel: document.querySelector(".details-panel"),
  reviewLane: document.querySelector(".review-lane"),
  reviewPanelToggle: document.querySelector("#reviewPanelToggle"),
  reviewStaleToggle: document.querySelector("#reviewStaleToggle"),
  reviewCount: document.querySelector("#reviewCount"),
  reviewUnreviewedToggle: document.querySelector("#reviewUnreviewedToggle"),
  actionInboxButtons: [...document.querySelectorAll("[data-action-inbox-filter]")],
  actionInboxCounts: new Map(
    [...document.querySelectorAll("[data-action-inbox-count]")].map((element) => [
      element.dataset.actionInboxCount,
      element,
    ]),
  ),
  reviewList: document.querySelector("#reviewList"),
  detailsEmpty: document.querySelector("#detailsEmpty"),
  detailsContent: document.querySelector("#detailsContent"),
  detailNickname: document.querySelector("#detailNickname"),
  detailState: document.querySelector("#detailState"),
  detailRole: document.querySelector("#detailRole"),
  detailProject: document.querySelector("#detailProject"),
  detailAge: document.querySelector("#detailAge"),
  detailTitle: document.querySelector("#detailTitle"),
  detailThreadContentLabel: document.querySelector("#detailThreadContentLabel"),
  detailThreadContent: document.querySelector("#detailThreadContent"),
  detailParent: document.querySelector("#detailParent"),
  detailCwd: document.querySelector("#detailCwd"),
  detailId: document.querySelector("#detailId"),
  threadMessageForm: document.querySelector("#threadMessageForm"),
  threadMessageInput: document.querySelector("#threadMessageInput"),
  threadMessagePreview: document.querySelector("#threadMessagePreview"),
  threadMessageSubmit: document.querySelector("#threadMessageSubmit"),
  threadMessageStatus: document.querySelector("#threadMessageStatus"),
  sendConfirmDialog: document.querySelector("#sendConfirmDialog"),
  sendConfirmTarget: document.querySelector("#sendConfirmTarget"),
  sendConfirmMessage: document.querySelector("#sendConfirmMessage"),
  sendConfirmSubmit: document.querySelector("#sendConfirmSubmit"),
};

const parentPalette = [
  0x36cfc9,
  0xf59e0b,
  0xa78bfa,
  0x60a5fa,
  0xf472b6,
  0x84cc16,
  0xf87171,
  0x22d3ee,
  0xfbbf24,
  0x38bdf8,
];

const focusStudio = {
  sceneBackground: 0x04060d,
  ambientSky: 0xb8d7f2,
  ambientGround: 0x111827,
  gridCenter: 0x1d283a,
  gridLine: 0x0b1220,
  active: 0x34d399,
  done: 0xd97706,
  digest: 0xf59e0b,
  reviewed: 0x64748b,
  room: {
    floor: 0x101827,
    insetFloor: 0x182235,
    wallPanel: 0x172033,
    accentShadow: 0x06111f,
    backWall: 0x121a29,
    sideWall: 0x0b1220,
    signBack: 0x07101d,
    floorGlowOpacity: 0.035,
    borderOpacity: 0.26,
    railOpacity: 0.3,
    selectedGlowOpacity: 0.2,
    selectedBorderOpacity: 0.96,
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
  unreviewedOnly: false,
  reviewPanelExpanded: false,
  showStale: true,
  actionInboxFilter: null,
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
  localRenderTimer: null,
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
  sendSeq: 0,
  sendPending: false,
  refreshing: false,
  cameraFocus: null,
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
        density: state.density,
        reviewPanelExpanded: state.reviewPanelExpanded,
        showStale: state.showStale,
      }),
    );
  } catch {
    // Non-persistent controls are acceptable when storage is unavailable.
  }
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(focusStudio.sceneBackground);

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1000);
camera.position.set(10, 10, 14);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
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

const ambient = new THREE.HemisphereLight(focusStudio.ambientSky, focusStudio.ambientGround, 1.65);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.35);
keyLight.position.set(9, 16, 7);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x7dd3fc, 0.48);
rimLight.position.set(-10, 8, -6);
scene.add(rimLight);

const grid = new THREE.GridHelper(80, 80, focusStudio.gridCenter, focusStudio.gridLine);
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

function cssHexColor(hexColor) {
  return `#${hexColor.toString(16).padStart(6, "0")}`;
}

function formatAge(seconds) {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
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
  ctx.fillStyle = "rgba(5, 10, 20, 0.98)";
  drawRoundedRect(ctx, 22, 24, canvas.width - 44, canvas.height - 48, 34);
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(125, 211, 252, 0.48)";
  ctx.stroke();
  ctx.shadowColor = "rgba(125, 211, 252, 0.36)";
  ctx.shadowBlur = 14;
  ctx.fillStyle = "#e5eef8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontSize = fitProjectDisplayFont(ctx, text, canvas.width - 140);
  ctx.font = `800 ${fontSize}px Inter, Arial, sans-serif`;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  ctx.shadowBlur = 0;
  texture.needsUpdate = true;
}

function createRoom(project) {
  const group = new THREE.Group();
  group.userData.project = project;
  const projectAccent = colorFromKey(project);

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.16, 1),
    new THREE.MeshStandardMaterial({
      color: focusStudio.room.floor,
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
      opacity: focusStudio.room.floorGlowOpacity,
      depthWrite: false,
    }),
  );
  floorGlow.rotation.x = -Math.PI / 2;
  floorGlow.position.y = 0.035;
  group.add(floorGlow);

  const insetFloor = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.05, 1),
    new THREE.MeshStandardMaterial({
      color: focusStudio.room.insetFloor,
      roughness: 0.58,
      metalness: 0.14,
      emissive: projectAccent,
      emissiveIntensity: 0.01,
    }),
  );
  insetFloor.position.y = 0.11;
  insetFloor.receiveShadow = true;
  group.add(insetFloor);

  const border = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.18, 1)),
    new THREE.LineBasicMaterial({ color: projectAccent, transparent: true, opacity: focusStudio.room.borderOpacity }),
  );
  border.position.y = 0.02;
  group.add(border);

  const frontRail = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.045, 0.07),
    new THREE.MeshBasicMaterial({
      color: projectAccent,
      transparent: true,
      opacity: focusStudio.room.railOpacity,
    }),
  );
  group.add(frontRail);

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
      color: focusStudio.room.backWall,
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
      color: focusStudio.room.sideWall,
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
    color: focusStudio.room.wallPanel,
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
      color: focusStudio.room.signBack,
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
    frontRail,
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
  group.userData.pickables = [floor, insetFloor, floorGlow, frontRail, backWall, sideWall, signBack, signFace];
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

function disposeMaterial(material) {
  if (Array.isArray(material)) {
    for (const item of material) {
      disposeMaterial(item);
    }
    return;
  }
  if (material) {
    if (material.map) {
      material.map.dispose();
    }
    material.dispose();
  }
}

function disposeObject3D(object) {
  object.traverse((child) => {
    if (child.geometry) {
      child.geometry.dispose();
    }
    if (child.material) {
      disposeMaterial(child.material);
    }
  });
}

function createLabel(className) {
  const label = document.createElement("div");
  label.className = className;
  dom.labels.appendChild(label);
  return label;
}

function visibleActivityLabel(text, isRunning) {
  return isRunning ? `RUNNING - ${text}` : text;
}

function agentGlowForState(thread) {
  if (thread.state === "ACTIVE") {
    return { color: focusStudio.active, opacity: 0.5 };
  }
  if (thread.state === "DONE") {
    return { color: focusStudio.done, opacity: 0.18 };
  }
  return { color: 0x475569, opacity: 0.08 };
}

function agentBodyColor(thread, parentColorHex) {
  return thread.state === "DONE" ? 0x92400e : parentColorHex;
}

function agentLabelBorderColor(thread, parentCssColor) {
  return thread.state === "DONE" ? "rgba(245, 158, 11, 0.58)" : parentCssColor;
}

function createParentAgent(parentGroup) {
  const group = new THREE.Group();
  group.userData.parentKey = parentGroup.key;

  const color = parentGroupColor(parentGroup);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.48,
    metalness: 0.12,
    emissive: 0x000000,
  });
  const headMaterial = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.5,
    metalness: 0.02,
    emissive: 0x9cc8ee,
    emissiveIntensity: 0.025,
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: parentGroup.isActive ? focusStudio.active : color,
    transparent: true,
    opacity: parentGroup.isActive ? 0.56 : 0.16,
  });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.18, 32), bodyMaterial);
  body.position.y = 0.78;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 28, 20), headMaterial);
  head.position.y = 1.58;
  head.castShadow = true;
  group.add(head);

  const shoulder = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.18, 0.42), bodyMaterial);
  shoulder.position.y = 1.12;
  shoulder.castShadow = true;
  group.add(shoulder);

  const visorMaterial = new THREE.MeshBasicMaterial({
    color: 0x0f172a,
    transparent: true,
    opacity: 0.88,
  });
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.09, 0.08), visorMaterial);
  visor.position.set(0, 1.61, 0.32);
  group.add(visor);

  const core = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.1), glowMaterial);
  core.position.set(0, 0.94, 0.42);
  group.add(core);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.03, 10, 64), glowMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.11;
  group.add(ring);

  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.022, 8, 52), glowMaterial);
  halo.position.y = 1.9;
  group.add(halo);

  group.userData.parts = { body, head, shoulder, visor, core, ring, halo, bodyMaterial, glowMaterial };
  scene.add(group);
  return group;
}

function createAgent(thread) {
  const group = new THREE.Group();
  group.userData.threadId = thread.id;

  const color = parentColor(thread);
  const glow = agentGlowForState(thread);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.08 });
  const headMaterial = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    roughness: 0.52,
    metalness: 0.02,
    emissive: 0x9ca3af,
    emissiveIntensity: 0.015,
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: glow.color,
    transparent: true,
    opacity: glow.opacity,
  });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.82, 24), bodyMaterial);
  body.position.y = 0.55;
  body.castShadow = true;
  body.userData.threadId = thread.id;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 20, 16), headMaterial);
  head.position.y = 1.15;
  head.castShadow = true;
  head.userData.threadId = thread.id;
  group.add(head);

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.08, 20), bodyMaterial);
  collar.position.y = 0.92;
  collar.castShadow = true;
  group.add(collar);

  const statusLightMaterial = new THREE.MeshBasicMaterial({
    color: glow.color,
    transparent: true,
    opacity: thread.state === "ACTIVE" ? 0.9 : 0.36,
  });
  const statusLight = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), statusLightMaterial);
  statusLight.position.set(0, 1.42, 0.13);
  group.add(statusLight);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.02, 8, 48), glowMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.09;
  group.add(ring);

  group.userData.parts = { body, head, collar, statusLight, ring, glowMaterial, statusLightMaterial };
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
    color: 0x92400e,
    roughness: 0.58,
    metalness: 0.1,
    emissive: 0x451a03,
    emissiveIntensity: 0.1,
  });
  const tokenMaterial = new THREE.MeshStandardMaterial({
    color: focusStudio.digest,
    roughness: 0.42,
    metalness: 0.18,
    emissive: focusStudio.digest,
    emissiveIntensity: 0.14,
  });
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xfbbf24,
    transparent: true,
    opacity: 0.34,
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

  parts.baseMaterial.color.setHex(inactive ? 0x1f2937 : 0x78350f);
  parts.baseMaterial.emissive.setHex(inactive ? 0x000000 : 0x451a03);
  parts.baseMaterial.emissiveIntensity = inactive ? 0 : 0.1;
  parts.tokenMaterial.color.setHex(inactive ? focusStudio.reviewed : focusStudio.digest);
  parts.tokenMaterial.emissive.setHex(inactive ? 0x000000 : focusStudio.digest);
  parts.tokenMaterial.emissiveIntensity = inactive ? 0 : 0.14;
  parts.ringMaterial.color.setHex(inactive ? 0x94a3b8 : 0xfbbf24);
  parts.ringMaterial.opacity = inactive ? 0.1 : 0.34;
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
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.08,
    depthTest: false,
  });
  const line = new THREE.Line(geometry, lineMaterial);
  line.renderOrder = 10;
  const packetMaterial = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.82,
    depthTest: false,
  });
  const packet = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), packetMaterial);
  packet.renderOrder = 11;
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.16,
    depthTest: false,
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
  parts.beam.geometry = curveTubeGeometry(curve, active ? 0.034 : 0.018);
  parts.lineMaterial.color.setHex(color);
  parts.lineMaterial.opacity = active ? 0.68 : 0.05;
  parts.beamMaterial.color.setHex(color);
  parts.beamMaterial.opacity = active ? 0.2 : 0.03;
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
    ? focusStudio.room.selectedGlowOpacity
    : focusStudio.room.floorGlowOpacity;
  parts.border.material.opacity = selected
    ? focusStudio.room.selectedBorderOpacity
    : focusStudio.room.borderOpacity;
  parts.frontRail.material.opacity = selected ? 0.9 : focusStudio.room.railOpacity;
  parts.signBack.material.emissiveIntensity = selected ? 0.34 : 0.08;
  parts.selectionFrame.visible = selected;
  parts.selectionFrameMaterial.opacity = selected ? 0.82 : 0;
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
    parts.glowMaterial.opacity = selected ? 0.34 : 0.16;
  }
  parts.halo.scale.setScalar(selected ? 1.12 : 1);
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
    parts.ringMaterial.opacity = selected ? 0.24 : 0.1;
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
      parentParts.bodyMaterial.color.setHex(parentColorHex);
      parentParts.bodyMaterial.emissive.setHex(parentGroup.isActive ? parentColorHex : 0x000000);
      parentParts.bodyMaterial.emissiveIntensity = parentGroup.isActive ? 0.1 : 0;
      parentParts.glowMaterial.color.setHex(parentGroup.isActive ? focusStudio.active : parentColorHex);
      parentParts.glowMaterial.opacity = parentGroup.isActive ? 0.56 : 0.16;
      parentParts.body.userData.threadId = parentGroup.lead.id;
      parentParts.body.userData.thread = parentGroup.lead;
      parentParts.body.userData.parentGroup = parentGroup;
      parentParts.body.userData.room = room;
      parentParts.head.userData.threadId = parentGroup.lead.id;
      parentParts.head.userData.thread = parentGroup.lead;
      parentParts.head.userData.parentGroup = parentGroup;
      parentParts.head.userData.room = room;
      for (const pickable of [parentParts.shoulder, parentParts.visor, parentParts.core]) {
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
        parts.glowMaterial.color.setHex(glow.color);
        parts.glowMaterial.opacity = glow.opacity;
        parts.statusLightMaterial.color.setHex(glow.color);
        parts.statusLightMaterial.opacity = thread.state === "ACTIVE" ? 0.9 : Math.max(0.22, glow.opacity);
        parts.body.userData.threadId = thread.id;
        parts.body.userData.thread = thread;
        parts.body.userData.room = room;
        parts.head.userData.threadId = thread.id;
        parts.head.userData.thread = thread;
        parts.head.userData.room = room;
        for (const pickable of [parts.collar, parts.statusLight]) {
          pickable.userData.threadId = thread.id;
          pickable.userData.thread = thread;
          pickable.userData.room = room;
        }
        state.selectable.push(parts.body, parts.head, parts.collar, parts.statusLight);

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
  dom.emptyState.textContent = state.showInactive
    ? "No recent open threads."
    : "No active threads. Show idle to see recent threads.";
  dom.emptyState.hidden = visibleThreads !== 0;
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
  return filterActionInboxItems(inbox, {
    unreviewedOnly: state.unreviewedOnly,
    filter: state.actionInboxFilter,
    showStale: state.showStale,
  });
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
  if (state.unreviewedOnly) {
    return "No items need review.";
  }
  if (state.actionInboxFilter) {
    return `No ${actionInboxTypeLabel(state.actionInboxFilter).toLowerCase()} items.`;
  }
  return "No inbox items.";
}

function renderReviewLane() {
  const inbox = state.actionInbox || buildActionInbox([]);
  const counts = inbox.counts || {};
  const visibleItems = visibleActionInboxItems(inbox);

  dom.reviewCount.textContent = `${counts.needs_review || 0} needs review / ${
    counts.running || 0
  } running / ${counts.stale || 0} stale / ${counts.reviewed || 0} reviewed`;
  dom.reviewStaleToggle.textContent = state.showStale ? "Hide stale" : "Show stale";
  dom.reviewStaleToggle.setAttribute("aria-pressed", String(state.showStale));
  dom.reviewUnreviewedToggle.setAttribute("aria-pressed", String(state.unreviewedOnly));
  for (const button of dom.actionInboxButtons) {
    const type = button.dataset.actionInboxFilter;
    button.setAttribute(
      "aria-pressed",
      String(!state.unreviewedOnly && state.actionInboxFilter === type),
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
      toggle.type = "button";
      toggle.className = "review-toggle";
      toggle.textContent = item.reviewed ? "Reviewed" : "Review";
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

async function sendThreadMessage(threadId, message, role) {
  const response = await fetch(`/api/thread/${encodeURIComponent(threadId)}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, role }),
  });
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
  refreshActionInbox();
  reconcileRooms(projectGroups);
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

function scheduleLocalThreadRender() {
  window.clearTimeout(state.localRenderTimer);
  state.localRenderTimer = window.setTimeout(() => {
    state.localRenderTimer = null;
    refreshThreads();
  }, 80);
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
  const changedSelection = state.selectedId !== thread.id;
  state.selectedMode = "thread";
  state.selectedProject = null;
  state.selectedDigest = null;
  state.selectedParentKey = parentGroup?.key || null;
  state.selectedId = thread.id;
  state.selectedThread = thread;
  updateSceneVisualStates();
  if (changedSelection) {
    dom.threadMessageInput.value = "";
    dom.threadMessageStatus.textContent = "";
  }
  renderDetails(thread, parentGroup);
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
  state.sendSeq += 1;
  dom.threadMessageInput.value = "";
  dom.threadMessageStatus.textContent = "";
  renderDigestDetails(parentGroup);
}

function showRoomFocus(room) {
  state.selectedMode = "room";
  state.selectedProject = room.userData.project || null;
  state.selectedDigest = null;
  state.selectedParentKey = null;
  state.selectedId = null;
  state.selectedThread = null;
  state.detailSeq += 1;
  state.sendSeq += 1;
  dom.threadMessageInput.value = "";
  dom.threadMessageStatus.textContent = "";
  dom.detailsEmpty.hidden = false;
  dom.detailsContent.hidden = true;
  updateMessageComposer(null);
  updateAgentLabelVisibility();
  updateSceneVisualStates();
}

function canSendToThread(_thread) {
  return false;
}

function updateThreadSendControls(thread) {
  const disabled = state.sendPending || !canSendToThread(thread);
  dom.threadMessagePreview.disabled = disabled;
  dom.threadMessageSubmit.disabled = disabled;
  dom.sendConfirmSubmit.disabled = disabled;
}

function updateMessageComposer(thread) {
  const canSend = canSendToThread(thread);
  dom.threadMessageForm.hidden = !canSend;
  dom.threadMessageInput.disabled = !canSend;
  updateThreadSendControls(thread);
  if (!canSend) {
    dom.threadMessageInput.value = "";
    dom.threadMessageStatus.textContent = "";
  }
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
  dom.detailsEmpty.hidden = true;
  dom.detailsContent.hidden = false;
  dom.detailNickname.textContent = privacyLabel(thread.nickname || "agent", state.privacy);
  dom.detailState.textContent = `${threadActivityLabel(thread)} / ${thread.intensity || "idle"}`;
  dom.detailState.classList.toggle("is-running", thread.state === "ACTIVE");
  dom.detailState.classList.toggle("is-done", thread.state === "DONE");
  dom.detailState.classList.toggle("is-digest", false);
  dom.detailRole.textContent = thread.role || "thread";
  dom.detailProject.textContent = privacyLabel(thread.project || "unknown", state.privacy);
  dom.detailAge.textContent = formatAge(thread.age_seconds);
  dom.detailTitle.textContent = privacyLabel(thread.title || "(untitled)", state.privacy);
  if (shouldRenderTimeline) {
    dom.detailThreadContentLabel.textContent = "Parent timeline";
    renderParentTimeline(timelineParentGroup);
  } else {
    dom.detailThreadContentLabel.textContent = "Agent prompt + last response";
    const cached = state.detailCache.get(thread.id);
    const detailContent = cached ? cached.content || "(no loaded thread content)" : "Loading thread content...";
    dom.detailThreadContent.textContent = state.privacy ? "Hidden" : detailContent;
  }
  dom.detailParent.textContent = privacyLabel(thread.parent_title || "(none)", state.privacy);
  dom.detailCwd.textContent = privacyPath(thread.cwd || "(unknown)", state.privacy);
  dom.detailId.textContent = privacyLabel(thread.id, state.privacy);
  updateMessageComposer(thread);
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
  dom.detailsEmpty.hidden = true;
  dom.detailsContent.hidden = false;
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
  dom.detailTitle.textContent = `${parentGroup.finishedCount || 0} done item${
    parentGroup.finishedCount === 1 ? "" : "s"
  }`;
  dom.detailParent.textContent = privacyLabel(parentGroup.parentId || "(none)", state.privacy);
  dom.detailCwd.textContent = parentGroup.latestFinishedAt
    ? new Date(parentGroup.latestFinishedAt).toLocaleString()
    : "(none)";
  dom.detailId.textContent = privacyLabel(parentGroup.key, state.privacy);
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
  updateMessageComposer(null);
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
    dom.detailThreadContent.textContent = state.privacy
      ? "Hidden"
      : `Unable to load thread content: ${error.message}`;
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
  dom.detailsEmpty.hidden = false;
  dom.detailsContent.hidden = true;
  updateSceneVisualStates();
  updateMessageComposer(null);
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
    parentAgent.position.y = Math.sin(elapsed * speed + hashString(parentGroup?.parentId || "")) * (parentGroup?.isActive ? 0.05 : 0.008);
    parts.head.rotation.z = Math.sin(elapsed * speed) * (parentGroup?.isActive ? 0.04 : 0.01);
    parts.ring.scale.setScalar(1 + Math.sin(elapsed * speed) * (parentGroup?.isActive ? 0.08 : 0.012));
    parts.core.scale.setScalar(1 + Math.sin(elapsed * speed * 1.2) * (parentGroup?.isActive ? 0.12 : 0.02));
    parts.halo.rotation.z = elapsed * (parentGroup?.isActive ? 0.7 : 0.18);
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
      parts.ringMaterial.opacity = selected ? 0.24 : 0.1;
      continue;
    }
    const pulse = 1 + Math.sin(elapsed * 1.7 + hashString(digestObject.userData.digestKey || "")) * 0.035;
    const selected = selectedSceneObject({
      type: "digest",
      digestKey: digestObject.userData.digestKey,
    });
    parts.token.rotation.y = elapsed * 0.28;
    parts.ring.scale.setScalar(selected ? Math.max(1.12, pulse) : pulse);
    parts.ringMaterial.opacity = 0.34;
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

function setLive(nextLive) {
  state.live = nextLive;
  dom.liveToggle.textContent = nextLive ? "Live" : "Paused";
  dom.liveToggle.setAttribute("aria-pressed", String(nextLive));
}

function setLabels(nextLabels) {
  state.labels = nextLabels;
  dom.labelsToggle.setAttribute("aria-pressed", String(nextLabels));
  dom.labels.classList.toggle("is-hidden", !nextLabels);
  savePreferences();
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

  if (dom.sendConfirmDialog.open) {
    updateSendConfirmTarget(state.selectedThread);
  }
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

function setReviewPanelExpanded(nextExpanded, { persist = true } = {}) {
  state.reviewPanelExpanded = nextExpanded;
  dom.reviewPanelToggle.textContent = nextExpanded ? "Compact" : "Expand";
  dom.reviewPanelToggle.setAttribute("aria-pressed", String(nextExpanded));
  dom.reviewLane.classList.toggle("is-expanded", nextExpanded);
  dom.detailsPanel.classList.toggle("is-review-expanded", nextExpanded);
  dom.appLayout.classList.toggle("is-review-expanded", nextExpanded);
  if (persist) {
    savePreferences();
  }
  resize();
}

function setShowStale(nextShowStale, { persist = true, render = true } = {}) {
  state.showStale = nextShowStale;
  dom.reviewStaleToggle.textContent = nextShowStale ? "Hide stale" : "Show stale";
  dom.reviewStaleToggle.setAttribute("aria-pressed", String(nextShowStale));
  if (persist) {
    savePreferences();
  }
  if (render) {
    renderReviewLane();
  }
}

async function onThreadMessageSubmit(event) {
  event.preventDefault();
  showSendConfirmation();
}

function showSendConfirmation() {
  if (state.sendPending) {
    return;
  }
  const thread = state.selectedThread;
  const message = dom.threadMessageInput.value.trim();
  if (!canSendToThread(thread)) {
    return;
  }
  if (!message) {
    dom.threadMessageStatus.textContent = "Message is empty.";
    return;
  }
  updateSendConfirmTarget(thread);
  dom.sendConfirmMessage.textContent = message;
  dom.sendConfirmDialog.returnValue = "";
  dom.sendConfirmDialog.showModal();
}

function updateSendConfirmTarget(thread) {
  if (!thread) {
    dom.sendConfirmTarget.textContent = "";
    return;
  }
  dom.sendConfirmTarget.textContent = state.privacy
    ? "Hidden"
    : `${thread.title || thread.nickname} (${thread.id})`;
}

async function onSendConfirmClose() {
  const returnValue = dom.sendConfirmDialog.returnValue;
  dom.sendConfirmDialog.returnValue = "";
  if (returnValue !== "send") {
    return;
  }
  await sendConfirmedThreadMessage();
}

async function sendConfirmedThreadMessage() {
  if (state.sendPending) {
    return;
  }
  const thread = state.selectedThread;
  if (!canSendToThread(thread)) {
    return;
  }

  const message = dom.threadMessageInput.value.trim();
  if (!message) {
    dom.threadMessageStatus.textContent = "Message is empty.";
    return;
  }

  const seq = ++state.sendSeq;
  state.sendPending = true;
  updateThreadSendControls(thread);
  dom.threadMessageStatus.textContent = "Sending...";

  try {
    const payload = await sendThreadMessage(thread.id, message, thread.role);
    if (seq !== state.sendSeq || state.selectedId !== thread.id) {
      return;
    }
    if (!payload.sent) {
      throw new Error(payload.error || "send failed");
    }
    dom.threadMessageInput.value = "";
    dom.threadMessageStatus.textContent = "Sent.";
    state.detailCache.delete(thread.id);
    loadThreadDetail(thread);
    refreshThreads({ force: true });
  } catch (error) {
    if (seq !== state.sendSeq || state.selectedId !== thread.id) {
      return;
    }
    dom.threadMessageStatus.textContent = `Send failed: ${error.message}`;
  } finally {
    if (seq === state.sendSeq) {
      state.sendPending = false;
      updateMessageComposer(state.selectedThread);
    }
  }
}

function bindEvents() {
  window.addEventListener("resize", resize);
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerCancel);
  dom.controls.addEventListener("submit", (event) => {
    event.preventDefault();
    savePreferences();
    refreshThreads();
  });
  dom.maxAgeHours.addEventListener("change", () => {
    savePreferences();
    refreshThreads();
  });
  dom.densityMode.addEventListener("change", () => {
    state.density = dom.densityMode.value === "compact" ? "compact" : "normal";
    savePreferences();
    refreshThreads();
  });
  dom.threadSearch.addEventListener("input", () => {
    state.search = dom.threadSearch.value;
    scheduleLocalThreadRender();
  });
  dom.liveToggle.addEventListener("click", () => setLive(!state.live));
  dom.labelsToggle.addEventListener("click", () => setLabels(!state.labels));
  dom.privacyToggle.addEventListener("click", () => setPrivacy(!state.privacy));
  dom.inactiveToggle.addEventListener("click", () => setShowInactive(!state.showInactive));
  dom.reviewPanelToggle.addEventListener("click", () => setReviewPanelExpanded(!state.reviewPanelExpanded));
  dom.reviewStaleToggle.addEventListener("click", () => setShowStale(!state.showStale));
  dom.reviewUnreviewedToggle.addEventListener("click", () => {
    state.unreviewedOnly = !state.unreviewedOnly;
    if (state.unreviewedOnly) {
      state.actionInboxFilter = null;
    }
    renderReviewLane();
  });
  for (const button of dom.actionInboxButtons) {
    button.addEventListener("click", () => {
      const filter = button.dataset.actionInboxFilter;
      state.unreviewedOnly = false;
      state.actionInboxFilter = state.actionInboxFilter === filter ? null : filter;
      renderReviewLane();
    });
  }
  dom.threadMessageForm.addEventListener("submit", onThreadMessageSubmit);
  dom.threadMessagePreview.addEventListener("click", showSendConfirmation);
  dom.sendConfirmDialog.addEventListener("close", onSendConfirmClose);
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
state.density = prefs.density;
dom.densityMode.value = prefs.density;
setReviewPanelExpanded(prefs.reviewPanelExpanded, { persist: false });
setShowStale(prefs.showStale, { persist: false, render: false });
setLabels(prefs.labels);
setShowInactive(prefs.showInactive, { refresh: false });
setPrivacy(prefs.privacy, { refresh: false });
setLive(true);
startPolling();
animate();
