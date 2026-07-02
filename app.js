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
  cityBikeRoutes,
  cityRoadTopology,
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
  projectRoomLayout,
  projectRoomPlacements,
  reviewStateForParentGroup,
  roomCameraFocus,
  sceneOverviewCameraFocus,
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
  0x5cc8ff,
  0xff8a00,
  0x7df9ff,
  0x1ea7c6,
  0xffb25c,
  0x9ff7ff,
];

const gridStudio = {
  sceneBackground: 0x02040a,
  ambientSky: 0x5cc8ff,
  ambientGround: 0x02040a,
  gridCenter: 0x00364a,
  gridLine: 0x00151f,
  active: 0x00e5ff,
  done: 0xff8a00,
  digest: 0xff8a00,
  reviewed: 0x8fb7c2,
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
const MAIN_GRID_SIZE = 1600;
const MAIN_GRID_DIVISIONS = 1600;
const MAIN_GRID_FADE_NEAR = 180;
const MAIN_GRID_FADE_FAR = 520;
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

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
  cityRoadLayer: null,
  cityRoadTopologyKey: null,
  cityRoadSegments: new Map(),
  cityIntersections: new Map(),
  lightCycles: new Map(),
  lightCycleRoutes: [],
  detailCache: new Map(),
  detailSeq: 0,
  refreshing: false,
  cameraFocus: null,
  hasInitialCameraFocus: false,
  reducedMotion: reducedMotionQuery.matches,
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
scene.fog = new THREE.Fog(gridStudio.sceneBackground, MAIN_GRID_FADE_NEAR, MAIN_GRID_FADE_FAR);

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1000);
camera.position.set(10, 10, 14);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.16;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
dom.scene.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);

const raycaster = new THREE.Raycaster();
const labelRaycaster = new THREE.Raycaster();
const labelRayDirection = new THREE.Vector3();
const labelScreenPoint = new THREE.Vector3();
const pointer = new THREE.Vector2();
const clock = new THREE.Clock();
const CLICK_MOVE_LIMIT_PX = 6;
const LABEL_OCCLUSION_MARGIN = 0.08;
let pendingPointerPick = null;

const ambient = new THREE.HemisphereLight(gridStudio.ambientSky, gridStudio.ambientGround, 0.74);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0x9ff7ff, 2.35);
keyLight.position.set(9, 16, 7);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x00e5ff, 1.28);
rimLight.position.set(-10, 8, -6);
scene.add(rimLight);

const amberFillLight = new THREE.DirectionalLight(0xff8a00, 0.34);
amberFillLight.position.set(7, 5, -9);
scene.add(amberFillLight);

const grid = new THREE.GridHelper(MAIN_GRID_SIZE, MAIN_GRID_DIVISIONS, gridStudio.gridCenter, gridStudio.gridLine);
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
  markRoomCircuitPulseSurface(floorCircuits);
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
  markRoomCircuitPulseSurface(backLightRail);
  group.add(backLightRail);

  const sideLightRail = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.045, 1),
    new THREE.MeshBasicMaterial({
      color: projectAccent,
      transparent: true,
      opacity: 0.18,
    }),
  );
  markRoomCircuitPulseSurface(sideLightRail);
  group.add(sideLightRail);

  const roomLight = new THREE.PointLight(projectAccent, 0.18, 10, 2);
  roomLight.position.set(0, 2.1, 0);
  group.add(roomLight);

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
      depthWrite: false,
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
  markRoomCircuitPulseSurface(linkRail);
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
    roomLight,
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
  group.userData.roomPulsePhase = (hashString(project) % 100) / 100;
  group.userData.roomPulseStrength = 0;
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
  parts.roomLight.distance = Math.max(8, Math.max(width, depth) * 0.82);
  parts.roomLight.position.set(0, 2.08, -depth * 0.08);

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

function objectDescendsFrom(object, root) {
  for (let current = object; current; current = current.parent) {
    if (current === root) {
      return true;
    }
  }
  return false;
}

function objectIsVisible(object) {
  for (let current = object; current; current = current.parent) {
    if (current.visible === false) {
      return false;
    }
  }
  return true;
}

function materialBlocksLabel(material) {
  if (!material) {
    return true;
  }
  if (Array.isArray(material)) {
    return material.some(materialBlocksLabel);
  }
  return !material.transparent || material.opacity === undefined || material.opacity > 0.18;
}

function objectBlocksLabel(object, ignoredRoot) {
  if (ignoredRoot && objectDescendsFrom(object, ignoredRoot)) {
    return false;
  }
  if (!objectIsVisible(object)) {
    return false;
  }
  if (object.userData.glowShell || object.userData.dataLanePart || object.userData.roomCircuitPulseSurface) {
    return false;
  }
  return materialBlocksLabel(object.material);
}

function createProgramGlowShell(geometry, color, opacity = 0.16) {
  const shell = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  shell.userData.glowShell = true;
  return shell;
}

function createProgramAuraRing(radius, color, opacity) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.018, 8, 72),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.userData.programAuraRing = true;
  ring.userData.programDetailPart = true;
  return ring;
}

function markProgramDetails(...objects) {
  for (const object of objects) {
    object.userData.programDetailPart = true;
  }
}

function markDataLanePart(object) {
  object.userData.dataLanePart = true;
  return object;
}

function markRoomCircuitPulseSurface(object) {
  object.userData.roomCircuitPulseSurface = true;
  return object;
}

function markCityRoadSegment(object) {
  object.userData.cityRoadSegment = true;
  return object;
}

function markCityIntersection(object) {
  object.userData.cityIntersection = true;
  return object;
}

function markLightCycleBike(object) {
  object.userData.lightCycleBike = true;
  return object;
}

function markLightCycleTrail(object) {
  object.userData.lightCycleTrail = true;
  return object;
}

function agentGlowForState(thread) {
  if (thread.state === "ACTIVE") {
    return { color: gridStudio.active, opacity: 0.62 };
  }
  if (thread.state === "DONE") {
    return { color: gridStudio.done, opacity: 0.28 };
  }
  return { color: 0x1e6b80, opacity: 0.12 };
}

function agentBodyColor(thread, parentColorHex) {
  return thread.state === "DONE" ? 0x07111b : parentColorHex;
}

function agentLabelBorderColor(thread, parentCssColor) {
  return thread.state === "DONE" ? "rgba(255, 138, 0, 0.68)" : parentCssColor;
}

function createParentAgent(parentGroup) {
  const group = new THREE.Group();
  group.userData.parentKey = parentGroup.key;

  const color = parentGroupColor(parentGroup);
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x07111b,
    roughness: 0.36,
    metalness: 0.34,
    clearcoat: 0.34,
    clearcoatRoughness: 0.32,
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

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.74, 8, 18), bodyMaterial);
  body.position.y = 0.78;
  body.castShadow = true;
  group.add(body);

  const bodyGlow = createProgramGlowShell(
    new THREE.CapsuleGeometry(0.42, 0.78, 8, 18),
    color,
    parentGroup.isActive ? 0.12 : 0.06,
  );
  bodyGlow.position.copy(body.position);
  bodyGlow.scale.set(1.05, 1.02, 1.05);
  group.add(bodyGlow);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 14), headMaterial);
  head.scale.set(0.86, 1, 0.78);
  head.position.y = 1.62;
  head.castShadow = true;
  group.add(head);

  const shoulder = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.14, 0.36), bodyMaterial);
  shoulder.position.y = 1.16;
  shoulder.castShadow = true;
  group.add(shoulder);

  const helmetBrow = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.08, 0.11), bodyMaterial);
  helmetBrow.position.set(0, 1.76, 0.18);
  helmetBrow.castShadow = true;
  group.add(helmetBrow);

  const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.5, 5, 12), bodyMaterial);
  leftArm.position.set(-0.52, 0.82, 0.04);
  leftArm.rotation.z = 0.18;
  leftArm.castShadow = true;
  group.add(leftArm);

  const rightArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.5, 5, 12), bodyMaterial);
  rightArm.position.set(0.52, 0.82, 0.04);
  rightArm.rotation.z = -0.18;
  rightArm.castShadow = true;
  group.add(rightArm);

  const visorMaterial = new THREE.MeshBasicMaterial({
    color: gridStudio.cyan,
    transparent: true,
    opacity: 0.92,
    blending: THREE.AdditiveBlending,
  });
  const visorGlow = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.035, 0.04), visorMaterial);
  visorGlow.position.set(0, 1.62, 0.315);
  group.add(visorGlow);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.055, 0.065), visorMaterial);
  visor.position.set(0, 1.64, 0.27);
  group.add(visor);

  const chestYoke = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.07), glowMaterial);
  chestYoke.position.set(0, 1.03, 0.39);
  group.add(chestYoke);

  const core = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, 0.08), glowMaterial);
  core.position.set(0, 0.86, 0.38);
  group.add(core);

  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.055, 0.08), glowMaterial);
  belt.position.set(0, 0.64, 0.39);
  group.add(belt);

  const leftArmCircuit = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 0.055), glowMaterial);
  leftArmCircuit.position.set(-0.51, 0.83, 0.14);
  leftArmCircuit.rotation.z = 0.18;
  group.add(leftArmCircuit);

  const rightArmCircuit = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 0.055), glowMaterial);
  rightArmCircuit.position.set(0.51, 0.83, 0.14);
  rightArmCircuit.rotation.z = -0.18;
  group.add(rightArmCircuit);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.022, 8, 64), glowMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.09;
  group.add(ring);

  const auraRing = createProgramAuraRing(0.76, parentGroup.isActive ? gridStudio.active : color, parentGroup.isActive ? 0.18 : 0.06);
  auraRing.position.y = 0.07;
  group.add(auraRing);

  const disc = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.026, 8, 56), glowMaterial);
  disc.position.set(0, 1.12, -0.29);
  group.add(disc);

  markProgramDetails(shoulder, leftArm, rightArm, visor, core, belt, leftArmCircuit, rightArmCircuit, ring, disc);
  markProgramDetails(helmetBrow, visorGlow, chestYoke, auraRing);
  group.userData.parts = {
    body,
    bodyGlow,
    head,
    shoulder,
    helmetBrow,
    leftArm,
    rightArm,
    visorGlow,
    visor,
    chestYoke,
    core,
    belt,
    leftArmCircuit,
    rightArmCircuit,
    ring,
    auraRing,
    disc,
    bodyMaterial,
    glowMaterial,
  };
  scene.add(group);
  return group;
}

function createAgent(thread) {
  const group = new THREE.Group();
  group.userData.threadId = thread.id;

  const color = parentColor(thread);
  const glow = agentGlowForState(thread);
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: agentBodyColor(thread, color),
    roughness: 0.38,
    metalness: 0.28,
    clearcoat: 0.28,
    clearcoatRoughness: 0.34,
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

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.5, 7, 16), bodyMaterial);
  body.position.y = 0.56;
  body.castShadow = true;
  body.userData.threadId = thread.id;
  group.add(body);

  const bodyGlow = createProgramGlowShell(
    new THREE.CapsuleGeometry(0.27, 0.54, 7, 16),
    glow.color,
    thread.state === "ACTIVE" ? 0.14 : 0.07,
  );
  bodyGlow.position.copy(body.position);
  bodyGlow.scale.set(1.05, 1.02, 1.05);
  group.add(bodyGlow);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 16, 12), headMaterial);
  head.scale.set(0.86, 1, 0.78);
  head.position.y = 1.18;
  head.castShadow = true;
  head.userData.threadId = thread.id;
  group.add(head);

  const headGlow = createProgramGlowShell(new THREE.SphereGeometry(0.255, 16, 12), gridStudio.cyan, 0.08);
  headGlow.scale.copy(head.scale);
  headGlow.position.copy(head.position);
  group.add(headGlow);

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.31, 0.07, 6), bodyMaterial);
  collar.position.y = 0.94;
  collar.castShadow = true;
  group.add(collar);

  const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.075, 0.24), bodyMaterial);
  shoulder.position.y = 0.84;
  shoulder.castShadow = true;
  group.add(shoulder);

  const helmetBrow = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.055, 0.08), bodyMaterial);
  helmetBrow.position.set(0, 1.29, 0.14);
  helmetBrow.castShadow = true;
  group.add(helmetBrow);

  const statusLightMaterial = new THREE.MeshBasicMaterial({
    color: glow.color,
    transparent: true,
    opacity: thread.state === "ACTIVE" ? 0.95 : 0.42,
    blending: THREE.AdditiveBlending,
  });
  const visorEdge = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.028, 0.035), statusLightMaterial);
  visorEdge.position.set(0, 1.18, 0.225);
  group.add(visorEdge);

  const statusLight = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.045, 0.055), statusLightMaterial);
  statusLight.position.set(0, 1.2, 0.19);
  group.add(statusLight);

  const chestStripe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.05), glowMaterial);
  chestStripe.position.set(0, 0.78, 0.285);
  group.add(chestStripe);

  const suitLine = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.42, 0.055), glowMaterial);
  suitLine.position.set(0, 0.58, 0.28);
  group.add(suitLine);

  const leftHipLine = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.26, 0.05), glowMaterial);
  leftHipLine.position.set(-0.12, 0.4, 0.25);
  group.add(leftHipLine);

  const rightHipLine = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.26, 0.05), glowMaterial);
  rightHipLine.position.set(0.12, 0.4, 0.25);
  group.add(rightHipLine);

  const backDisc = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.017, 8, 32), glowMaterial);
  backDisc.position.set(0, 0.74, -0.19);
  group.add(backDisc);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.018, 8, 48), glowMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.08;
  group.add(ring);

  const auraRing = createProgramAuraRing(0.5, glow.color, thread.state === "ACTIVE" ? 0.16 : 0.05);
  auraRing.position.y = 0.065;
  group.add(auraRing);

  markProgramDetails(collar, shoulder, statusLight, suitLine, leftHipLine, rightHipLine, backDisc, ring);
  markProgramDetails(helmetBrow, visorEdge, chestStripe, auraRing);
  group.userData.parts = {
    body,
    bodyGlow,
    head,
    headGlow,
    collar,
    shoulder,
    helmetBrow,
    visorEdge,
    statusLight,
    chestStripe,
    suitLine,
    leftHipLine,
    rightHipLine,
    backDisc,
    ring,
    auraRing,
    glowMaterial,
    statusLightMaterial,
  };
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
    color: 0x07111b,
    roughness: 0.5,
    metalness: 0.22,
    emissive: gridStudio.digest,
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
    color: gridStudio.digest,
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

  parts.baseMaterial.color.setHex(inactive ? 0x101820 : 0x07111b);
  parts.baseMaterial.emissive.setHex(inactive ? 0x000000 : gridStudio.digest);
  parts.baseMaterial.emissiveIntensity = inactive ? 0 : 0.16;
  parts.tokenMaterial.color.setHex(inactive ? gridStudio.reviewed : gridStudio.digest);
  parts.tokenMaterial.emissive.setHex(inactive ? 0x000000 : gridStudio.digest);
  parts.tokenMaterial.emissiveIntensity = inactive ? 0 : 0.2;
  parts.ringMaterial.color.setHex(inactive ? gridStudio.reviewed : gridStudio.digest);
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
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const line = new THREE.Line(geometry, lineMaterial);
  line.renderOrder = 10;
  markDataLanePart(line);
  const packetMaterial = new THREE.MeshBasicMaterial({
    color: gridStudio.cyan,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const packet = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), packetMaterial);
  packet.renderOrder = 11;
  markDataLanePart(packet);
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: gridStudio.cyan,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const beam = new THREE.Mesh(curveTubeGeometry(curve, 0.024), beamMaterial);
  beam.renderOrder = 10;
  markDataLanePart(beam);
  const wideBeamMaterial = new THREE.MeshBasicMaterial({
    color: gridStudio.cyan,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const wideBeam = markDataLanePart(new THREE.Mesh(curveTubeGeometry(curve, 0.06), wideBeamMaterial));
  wideBeam.renderOrder = 9;
  const packetHaloMaterial = new THREE.MeshBasicMaterial({
    color: gridStudio.cyan,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const packetHalo = markDataLanePart(new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), packetHaloMaterial));
  packetHalo.renderOrder = 10;
  const group = new THREE.Group();
  group.add(line, wideBeam, beam, packetHalo, packet);
  group.userData.parts = {
    line,
    beam,
    wideBeam,
    packet,
    packetHalo,
    lineMaterial,
    beamMaterial,
    wideBeamMaterial,
    packetMaterial,
    packetHaloMaterial,
  };
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
  parts.wideBeam.geometry.dispose();
  parts.wideBeam.geometry = curveTubeGeometry(curve, active ? 0.075 : 0.02);
  const laneParts = [parts.line, parts.beam, parts.wideBeam, parts.packet, parts.packetHalo];
  for (const part of laneParts) {
    part.userData.activeDataLane = active;
    part.userData.animatedDataLane = active;
  }
  parts.lineMaterial.color.setHex(color);
  parts.lineMaterial.opacity = active ? 0.82 : 0.08;
  parts.beamMaterial.color.setHex(color);
  parts.beamMaterial.opacity = active ? 0.28 : 0.04;
  parts.wideBeamMaterial.color.setHex(color);
  parts.wideBeamMaterial.opacity = active ? 0.12 : 0.015;
  parts.packetMaterial.color.setHex(color);
  parts.packetHaloMaterial.color.setHex(color);
  parts.packetHaloMaterial.opacity = active ? 0.28 : 0;
  parts.packet.visible = active;
  parts.packetHalo.visible = active;
  parts.beam.visible = active;
  parts.wideBeam.visible = active;
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

function materialDisablesDepthTest(material) {
  if (!material) {
    return false;
  }
  if (Array.isArray(material)) {
    return material.some(materialDisablesDepthTest);
  }
  return material.depthTest === false;
}

function updateRoomVisualState(room, project) {
  const selected = selectedSceneObject({ type: "room", project });
  const parts = room.userData.parts;
  const activeStrength = room.userData.hasActiveThreads ? 1 : 0;
  room.userData.roomPulseStrength = selected ? 1 : activeStrength;
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
  const circuitOpacity = selected ? 0.62 : room.userData.hasActiveThreads ? 0.5 : 0.32;
  for (const circuit of parts.floorCircuits.children) {
    circuit.material.opacity = circuitOpacity;
  }
  parts.backLightRail.material.opacity = selected ? 0.48 : room.userData.hasActiveThreads ? 0.36 : 0.22;
  parts.sideLightRail.material.opacity = selected ? 0.38 : room.userData.hasActiveThreads ? 0.28 : 0.16;
  parts.linkRail.material.opacity = selected ? 0.42 : room.userData.hasActiveThreads ? 0.32 : 0.2;
  parts.signBack.material.emissiveIntensity = selected ? 0.46 : 0.14;
  parts.roomLight.intensity = selected ? 1.15 : room.userData.hasActiveThreads ? 0.62 : 0.18;
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
  if (parentGroup) {
    parts.auraRing.material.color.setHex(parentGroup.isActive ? gridStudio.active : parentGroupColor(parentGroup));
  }
  parts.auraRing.material.opacity = selected ? 0.24 : parentGroup?.isActive ? 0.18 : 0.06;
  parts.auraRing.scale.setScalar(selected ? 1.12 : 1);
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
  const glow = agentGlowForState(agent.userData.thread);
  parts.auraRing.material.color.setHex(glow.color);
  parts.auraRing.material.opacity = selected ? 0.24 : agent.userData.thread?.state === "ACTIVE" ? 0.16 : 0.05;
  parts.auraRing.scale.setScalar(selected ? 1.12 : 1);
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

function sceneDebugSnapshot() {
  const snapshot = {
    capsuleAgents: 0,
    glowShells: 0,
    pointLights: 0,
    programDetailParts: 0,
    programAuraRings: 0,
    activeDataLanes: 0,
    animatedDataLanes: 0,
    depthTestDisabledDataLanes: 0,
    roomCircuitPulseSurfaces: 0,
    cityRoadSegments: 0,
    cityIntersections: 0,
    lightCycleBikes: 0,
    lightCycleTrails: 0,
    animatedLightCycles: 0,
  };
  scene.traverse((object) => {
    if (object.isPointLight) {
      snapshot.pointLights += 1;
    }
    if (object.userData.glowShell) {
      snapshot.glowShells += 1;
    }
    if (object.userData.programDetailPart) {
      snapshot.programDetailParts += 1;
    }
    if (object.userData.programAuraRing) {
      snapshot.programAuraRings += 1;
    }
    if (object.userData.roomCircuitPulseSurface) {
      snapshot.roomCircuitPulseSurfaces += 1;
    }
    if (object.userData.cityRoadSegment) {
      snapshot.cityRoadSegments += 1;
    }
    if (object.userData.cityIntersection) {
      snapshot.cityIntersections += 1;
    }
    if (object.userData.lightCycleBike) {
      snapshot.lightCycleBikes += 1;
    }
    if (object.userData.lightCycleTrail) {
      snapshot.lightCycleTrails += 1;
    }
    if (object.userData.animatedLightCycle) {
      snapshot.animatedLightCycles += 1;
    }
    if (object.userData.dataLanePart && materialDisablesDepthTest(object.material)) {
      snapshot.depthTestDisabledDataLanes += 1;
    }
    if (object.userData.activeDataLane && object.visible !== false) {
      snapshot.activeDataLanes += 1;
    }
    if (object.userData.animatedDataLane && object.visible !== false && !state.reducedMotion) {
      snapshot.animatedDataLanes += 1;
    }
    if (object.geometry?.type === "CapsuleGeometry" && object.userData.threadId) {
      snapshot.capsuleAgents += 1;
    }
  });
  snapshot.animatedLightCycles = Array.from(state.lightCycles.values()).filter(
    (lightCycle) => lightCycle.userData.animatedLightCycle,
  ).length;
  return {
    ...snapshot,
    hasCapsuleAgents: snapshot.capsuleAgents > 0,
    hasPointLights: snapshot.pointLights > 0,
    reducedMotionActive: state.reducedMotion,
  };
}

window.__codimsSceneDebug = sceneDebugSnapshot;

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
    lightCycle.userData.animatedLightCycle = false;
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

function reconcileCurrentLightCycles() {
  if (!state.cityRoadTopology || !state.projectGroups.length) {
    return;
  }
  const roomLayouts = new Map(
    state.projectGroups.map((projectGroup) => [
      projectGroup.project,
      projectRoomLayout(projectGroup.parentGroups),
    ]),
  );
  const roomPlacements = projectRoomPlacements(
    state.projectGroups.map((projectGroup) => roomLayouts.get(projectGroup.project)),
  );
  reconcileLightCycles(state.projectGroups, roomPlacements);
}

function reconcileRooms(projectGroups) {
  const activeProjects = new Set(projectGroups.map((group) => group.project));
  const roomLayouts = new Map(
    projectGroups.map((projectGroup) => [
      projectGroup.project,
      projectRoomLayout(projectGroup.parentGroups),
    ]),
  );
  const roomPlacements = projectRoomPlacements(projectGroups.map((projectGroup) => roomLayouts.get(projectGroup.project)));
  const cityTopology = cityRoadTopology(roomPlacements);
  reconcileCityRoads(cityTopology);
  state.cityRoadTopology = cityTopology;
  reconcileLightCycles(projectGroups, roomPlacements);
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
    const placement = roomPlacements[index];
    let room = state.rooms.get(project);
    if (!room) {
      room = createRoom(project);
      state.rooms.set(project, room);
    }
    room.position.set(placement.x, 0, placement.z);
    room.userData.layout = layout;
    room.userData.hasActiveThreads = threads.some((thread) => thread.state === "ACTIVE");
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
  const hasFilter = Boolean(state.actionInboxFilter);
  const items = filterActionInboxItems(inbox, {
    unreviewedOnly: !hasFilter,
    filter: state.actionInboxFilter,
    showStale: true,
  });
  if (!hasFilter) {
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
      toggle.textContent = item.reviewed ? "✓" : "Review";
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
  if (projectGroups.length > 6) {
    const placements = projectGroups
      .map((projectGroup) => state.rooms.get(projectGroup.project))
      .filter(Boolean)
      .map((room) => ({
        x: room.position.x,
        z: room.position.z,
        width: room.userData.size?.width,
        depth: room.userData.size?.depth,
      }));
    if (placements.length) {
      state.hasInitialCameraFocus = true;
      startCameraFocus(sceneOverviewCameraFocus(placements, camera.position, controls.target));
      return;
    }
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
  startCameraFocus(focus);
}

function startCameraFocus(focus) {
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

function isLabelOccluded(worldPosition, ignoredRoot) {
  const targetDistance = camera.position.distanceTo(worldPosition);
  if (targetDistance <= LABEL_OCCLUSION_MARGIN) {
    return false;
  }

  labelRayDirection.subVectors(worldPosition, camera.position).normalize();
  labelRaycaster.set(camera.position, labelRayDirection);
  labelRaycaster.near = camera.near;
  labelRaycaster.far = Math.max(camera.near, targetDistance - LABEL_OCCLUSION_MARGIN);

  return labelRaycaster
    .intersectObjects(state.selectable, false)
    .some((hit) => objectBlocksLabel(hit.object, ignoredRoot));
}

function updateLabelPosition(label, worldPosition, width, height, ignoredRoot) {
  labelScreenPoint.copy(worldPosition).project(camera);
  label.style.left = `${(labelScreenPoint.x * 0.5 + 0.5) * width}px`;
  label.style.top = `${(-labelScreenPoint.y * 0.5 + 0.5) * height}px`;
  const outsideCameraDepth = labelScreenPoint.z < -1 || labelScreenPoint.z > 1;
  label.classList.toggle("is-occluded", outsideCameraDepth || isLabelOccluded(worldPosition, ignoredRoot));
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
    updateLabelPosition(label, vector, width, height, parentAgent);
  }

  for (const [threadId, label] of state.agentLabels.entries()) {
    const agent = state.agents.get(threadId);
    if (!agent) {
      continue;
    }
    vector.set(agent.position.x, agent.position.y + (agent.userData.labelHeight || 1.72), agent.position.z);
    updateLabelPosition(label, vector, width, height, agent);
  }

  for (const [digestKey, label] of state.digestLabels.entries()) {
    const digestObject = state.digestObjects.get(digestKey);
    if (!digestObject) {
      continue;
    }
    vector.set(digestObject.position.x, digestObject.position.y + 1.12, digestObject.position.z);
    updateLabelPosition(label, vector, width, height, digestObject);
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
    if (state.reducedMotion) {
      parentAgent.position.y = 0;
      parts.head.rotation.z = 0;
      parts.ring.scale.setScalar(1);
      parts.core.scale.setScalar(1);
      parts.disc.rotation.z = 0;
      parts.disc.scale.setScalar(selected ? 1.16 : 1);
      parts.auraRing.scale.setScalar(selected ? 1.12 : 1);
      continue;
    }
    parentAgent.position.y = Math.sin(elapsed * speed + hashString(parentGroup?.parentId || "")) * (parentGroup?.isActive ? 0.05 : 0.008);
    parts.head.rotation.z = Math.sin(elapsed * speed) * (parentGroup?.isActive ? 0.04 : 0.01);
    parts.ring.scale.setScalar(1 + Math.sin(elapsed * speed) * (parentGroup?.isActive ? 0.08 : 0.012));
    parts.core.scale.setScalar(1 + Math.sin(elapsed * speed * 1.2) * (parentGroup?.isActive ? 0.12 : 0.02));
    parts.disc.rotation.z = elapsed * (parentGroup?.isActive ? 0.8 : 0.2);
    const discScale = 1 + Math.sin(elapsed * speed * 0.8) * (parentGroup?.isActive ? 0.08 : 0.018);
    parts.disc.scale.setScalar(selected ? Math.max(1.16, discScale) : discScale);
    parts.auraRing.scale.setScalar(selected ? Math.max(1.12, discScale) : discScale);
  }

  for (const handoff of state.handoffs.values()) {
    const parts = handoff.userData.parts;
    if (!handoff.userData.active) {
      parts.packet.visible = false;
      parts.packetHalo.visible = false;
      continue;
    }
    if (state.reducedMotion) {
      parts.packet.visible = false;
      parts.packetHalo.visible = false;
      parts.wideBeamMaterial.opacity = 0.1;
      continue;
    }
    const curve = handoff.userData.curve;
    const phase = (elapsed * 0.85 + (hashString(handoff.uuid) % 100) / 100) % 1;
    parts.packet.visible = true;
    parts.packet.position.copy(curve.getPoint(phase));
    parts.packet.scale.setScalar(0.8 + Math.sin(phase * Math.PI) * 0.9);
    parts.packetHalo.visible = true;
    parts.packetHalo.position.copy(parts.packet.position);
    const haloPulse = Math.sin(phase * Math.PI);
    parts.packetHalo.scale.setScalar(0.75 + haloPulse * 0.7);
    parts.packetHaloMaterial.opacity = 0.18 + haloPulse * 0.1;
    parts.wideBeamMaterial.opacity = 0.1 + Math.sin(elapsed * 2.2 + phase * Math.PI) * 0.025;
  }

  for (const agent of state.agents.values()) {
    const thread = agent.userData.thread;
    const parts = agent.userData.parts;
    const selected = selectedSceneObject({ type: "agent", threadId: thread.id });
    if (state.reducedMotion) {
      const statusLightScale = selected ? 1.08 : thread.state === "DONE" ? 0.92 : 1;
      agent.position.y = 0;
      parts.head.rotation.z = 0;
      parts.ring.scale.setScalar(selected ? 1.12 : 1);
      parts.auraRing.scale.setScalar(selected ? 1.12 : 1);
      parts.statusLight.scale.setScalar(statusLightScale);
      continue;
    }
    if (thread.state === "ACTIVE") {
      const speed = thread.intensity === "energetic" ? 5.8 : 3.4;
      const pulse = Math.sin(elapsed * speed) * 0.08;
      const ringScale = 1 + pulse;
      agent.position.y = Math.sin(elapsed * speed + hashString(thread.id)) * 0.08;
      parts.head.rotation.z = pulse;
      parts.ring.scale.setScalar(selected ? Math.max(1.12, ringScale) : ringScale);
      parts.auraRing.scale.setScalar(selected ? Math.max(1.12, ringScale) : ringScale);
      parts.statusLight.scale.setScalar(1.1 + Math.abs(pulse) * 2.2);
    } else if (thread.state === "DONE") {
      agent.position.y = 0;
      parts.head.rotation.z = 0;
      parts.ring.scale.setScalar(selected ? 1.12 : 1);
      parts.auraRing.scale.setScalar(selected ? 1.12 : 1);
      parts.statusLight.scale.setScalar(selected ? 1.08 : 0.92);
    } else {
      agent.position.y = Math.sin(elapsed * 1.2 + hashString(thread.id)) * 0.008;
      parts.head.rotation.z = Math.sin(elapsed * 0.8) * 0.012;
      parts.ring.scale.setScalar(selected ? 1.12 : 1);
      parts.auraRing.scale.setScalar(selected ? 1.12 : 1);
      parts.statusLight.scale.setScalar(selected ? 1.08 : 1);
    }
  }

  for (const digestObject of state.digestObjects.values()) {
    const parts = digestObject.userData.parts;
    const selected = selectedSceneObject({
      type: "digest",
      digestKey: digestObject.userData.digestKey,
    });
    if (state.reducedMotion) {
      const inactiveOpacity = selected ? 0.24 : 0.12;
      parts.token.rotation.y = 0;
      parts.ring.scale.setScalar(selected ? 1.12 : 1);
      parts.ringMaterial.opacity = digestObject.userData.doneObjectInactive ? inactiveOpacity : 0.46;
      continue;
    }
    if (digestObject.userData.doneObjectInactive) {
      parts.token.rotation.y = 0;
      parts.ring.scale.setScalar(selected ? 1.12 : 1);
      parts.ringMaterial.opacity = selected ? 0.24 : 0.12;
      continue;
    }
    const pulse = 1 + Math.sin(elapsed * 1.7 + hashString(digestObject.userData.digestKey || "")) * 0.035;
    parts.token.rotation.y = elapsed * 0.28;
    parts.ring.scale.setScalar(selected ? Math.max(1.12, pulse) : pulse);
    parts.ringMaterial.opacity = 0.46;
  }

  for (const room of state.rooms.values()) {
    const parts = room.userData.parts;
    const strength = room.userData.roomPulseStrength || 0;
    if (!strength || state.reducedMotion) {
      continue;
    }
    const pulse = 0.5 + Math.sin(elapsed * 1.6 + room.userData.roomPulsePhase * Math.PI * 2) * 0.5;
    const circuitOpacity = 0.42 + pulse * 0.16 * strength;
    for (const circuit of parts.floorCircuits.children) {
      circuit.material.opacity = circuitOpacity;
    }
    parts.backLightRail.material.opacity = 0.3 + pulse * 0.12 * strength;
    parts.sideLightRail.material.opacity = 0.22 + pulse * 0.08 * strength;
    parts.linkRail.material.opacity = 0.26 + pulse * 0.1 * strength;
  }

  for (const lightCycle of state.lightCycles.values()) {
    positionLightCycle(lightCycle, lightCycle.userData.lightCycleRoute, elapsed);
  }
}

function resize() {
  const width = Math.max(1, dom.scene.clientWidth);
  const height = Math.max(1, dom.scene.clientHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  reconcileCurrentLightCycles();
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
  reducedMotionQuery.addEventListener("change", (event) => {
    state.reducedMotion = event.matches;
    reconcileCurrentLightCycles();
    updateSceneVisualStates();
  });
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
      state.actionInboxFilter = filter;
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
