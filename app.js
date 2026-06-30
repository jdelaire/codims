import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  buildProjectParentGroups,
  childVisualLayout,
  densityScale,
  filterVisibleProjectGroups,
  handoffShouldAnimate,
  matchesThreadSearch,
  normalizePreferences,
  parentGroupOffset,
  privacyLabel,
  privacyPath,
  projectDisplayText,
  projectRoomGridSpacing,
  projectRoomLayout,
  roomCameraFocus,
} from "./visual-model.mjs";

const dom = {
  scene: document.querySelector("#scene"),
  labels: document.querySelector("#labels"),
  emptyState: document.querySelector("#emptyState"),
  statusText: document.querySelector("#statusText"),
  activeCount: document.querySelector("#activeCount"),
  visibleCount: document.querySelector("#visibleCount"),
  projectCount: document.querySelector("#projectCount"),
  controls: document.querySelector("#controls"),
  activeMinutes: document.querySelector("#activeMinutes"),
  maxAgeHours: document.querySelector("#maxAgeHours"),
  threadSearch: document.querySelector("#threadSearch"),
  liveToggle: document.querySelector("#liveToggle"),
  labelsToggle: document.querySelector("#labelsToggle"),
  privacyToggle: document.querySelector("#privacyToggle"),
  inactiveToggle: document.querySelector("#inactiveToggle"),
  detailsEmpty: document.querySelector("#detailsEmpty"),
  detailsContent: document.querySelector("#detailsContent"),
  detailNickname: document.querySelector("#detailNickname"),
  detailState: document.querySelector("#detailState"),
  detailRole: document.querySelector("#detailRole"),
  detailProject: document.querySelector("#detailProject"),
  detailAge: document.querySelector("#detailAge"),
  detailTitle: document.querySelector("#detailTitle"),
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

const PREFS_KEY = "codims.preferences.v1";

function loadPreferences() {
  try {
    return normalizePreferences(JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"));
  } catch {
    return normalizePreferences({});
  }
}

const state = {
  live: true,
  labels: true,
  privacy: false,
  showInactive: false,
  density: "normal",
  search: "",
  selectedId: null,
  selectedThread: null,
  threads: [],
  rooms: new Map(),
  parentAgents: new Map(),
  agents: new Map(),
  parentLabels: new Map(),
  agentLabels: new Map(),
  handoffs: new Map(),
  detailCache: new Map(),
  detailSeq: 0,
  sendSeq: 0,
  sendPending: false,
  cameraFocus: null,
  selectable: [],
  refreshSeq: 0,
};

function savePreferences() {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        activeMinutes: dom.activeMinutes.value,
        maxAgeHours: dom.maxAgeHours.value,
        labels: state.labels,
        showInactive: state.showInactive,
        privacy: state.privacy,
        density: state.density,
      }),
    );
  } catch {
    // Non-persistent controls are acceptable when storage is unavailable.
  }
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050711);
scene.fog = new THREE.Fog(0x050711, 20, 58);

const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1000);
camera.position.set(10, 10, 14);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
dom.scene.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const clock = new THREE.Clock();

const ambient = new THREE.HemisphereLight(0xcfe7ff, 0x1d1228, 2.45);
scene.add(ambient);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
keyLight.position.set(9, 16, 7);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x8b5cf6, 1.15);
rimLight.position.set(-10, 8, -6);
scene.add(rimLight);

const grid = new THREE.GridHelper(80, 80, 0x233047, 0x101725);
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

const PROJECT_SIGN_Y = 3.45;
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
  ctx.fillStyle = "rgba(7, 12, 24, 0.96)";
  drawRoundedRect(ctx, 22, 24, canvas.width - 44, canvas.height - 48, 34);
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(34, 211, 238, 0.86)";
  ctx.stroke();
  ctx.shadowColor = "rgba(34, 211, 238, 0.78)";
  ctx.shadowBlur = 26;
  ctx.fillStyle = "#dbeafe";
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
      color: 0x141b2a,
      roughness: 0.58,
      metalness: 0.14,
    }),
  );
  floor.receiveShadow = true;
  group.add(floor);

  const floorGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: projectAccent,
      transparent: true,
      opacity: 0.075,
      depthWrite: false,
    }),
  );
  floorGlow.rotation.x = -Math.PI / 2;
  floorGlow.position.y = 0.035;
  group.add(floorGlow);

  const border = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.18, 1)),
    new THREE.LineBasicMaterial({ color: projectAccent, transparent: true, opacity: 0.48 }),
  );
  border.position.y = 0.02;
  group.add(border);

  const frontRail = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.045, 0.07),
    new THREE.MeshBasicMaterial({
      color: projectAccent,
      transparent: true,
      opacity: 0.62,
    }),
  );
  group.add(frontRail);

  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(1, 2.2, 0.14),
    new THREE.MeshStandardMaterial({
      color: 0x192235,
      roughness: 0.72,
      metalness: 0.08,
      emissive: projectAccent,
      emissiveIntensity: 0.015,
    }),
  );
  backWall.position.set(0, 1.05, -3.35);
  backWall.receiveShadow = true;
  group.add(backWall);

  const sideWall = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 2.2, 1),
    new THREE.MeshStandardMaterial({
      color: 0x101827,
      roughness: 0.76,
      metalness: 0.06,
      emissive: projectAccent,
      emissiveIntensity: 0.012,
    }),
  );
  sideWall.position.set(-4.55, 1.05, 0);
  sideWall.receiveShadow = true;
  group.add(sideWall);

  const signTexture = createProjectDisplayTexture(project, 0, state.privacy);
  const signBack = new THREE.Mesh(
    new THREE.BoxGeometry(5.25, 1.28, 0.16),
    new THREE.MeshStandardMaterial({
      color: 0x07101d,
      emissive: 0x0b4251,
      emissiveIntensity: 0.24,
      roughness: 0.42,
      metalness: 0.18,
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
    opacity: 0.72,
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
      opacity: 0.5,
    }),
  );
  linkRail.position.set(0, 0.18, -2.86);
  group.add(linkRail);
  group.userData.parts = {
    floor,
    floorGlow,
    border,
    frontRail,
    backWall,
    sideWall,
    signBack,
    signFace,
    struts,
    linkRail,
  };
  group.userData.pickables = [floor, floorGlow, frontRail, backWall, sideWall, signBack, signFace];
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
  parts.border.scale.set(width + 0.05, 1, depth + 0.05);
  parts.frontRail.scale.set(width - 0.34, 1, 1);
  parts.frontRail.position.set(0, 0.13, depth / 2 - 0.08);
  parts.backWall.scale.set(width, 1, 1);
  parts.backWall.position.set(0, 1.05, -depth / 2 + 0.07);
  parts.sideWall.scale.set(1, 1, depth);
  parts.sideWall.position.set(-width / 2 + 0.07, 1.05, 0);

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

function createParentAgent(parentGroup) {
  const group = new THREE.Group();
  group.userData.parentKey = parentGroup.key;

  const color = parentGroupColor(parentGroup);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.36,
    metalness: 0.22,
    emissive: 0x000000,
  });
  const headMaterial = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.38,
    metalness: 0.04,
    emissive: 0xbfdcff,
    emissiveIntensity: 0.04,
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: parentGroup.isActive ? 0x34d399 : color,
    transparent: true,
    opacity: parentGroup.isActive ? 0.72 : 0.24,
  });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 1.18, 32), bodyMaterial);
  body.position.y = 0.78;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 28, 20), headMaterial);
  head.position.y = 1.58;
  head.castShadow = true;
  group.add(head);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.03, 10, 64), glowMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.11;
  group.add(ring);

  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.022, 8, 52), glowMaterial);
  halo.position.y = 1.9;
  group.add(halo);

  group.userData.parts = { body, head, ring, halo, bodyMaterial, glowMaterial };
  scene.add(group);
  return group;
}

function createAgent(thread) {
  const group = new THREE.Group();
  group.userData.threadId = thread.id;

  const color = parentColor(thread);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.12 });
  const headMaterial = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    roughness: 0.42,
    metalness: 0.03,
    emissive: 0xcbd5e1,
    emissiveIntensity: 0.025,
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: thread.state === "ACTIVE" ? 0x34d399 : 0x475569,
    transparent: true,
    opacity: thread.state === "ACTIVE" ? 0.58 : 0.18,
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

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.02, 8, 48), glowMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.09;
  group.add(ring);

  group.userData.parts = { body, head, ring, glowMaterial };
  scene.add(group);
  state.selectable.push(body, head);
  return group;
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
    opacity: 0.34,
    depthTest: false,
  });
  const line = new THREE.Line(geometry, lineMaterial);
  line.renderOrder = 10;
  const packetMaterial = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  });
  const packet = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), packetMaterial);
  packet.renderOrder = 11;
  const beamMaterial = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.24,
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
  parts.lineMaterial.opacity = active ? 0.9 : 0.18;
  parts.beamMaterial.color.setHex(color);
  parts.beamMaterial.opacity = active ? 0.34 : 0.07;
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
}

function reconcileAgents(projectGroups) {
  const activeParentKeys = new Set(
    projectGroups.flatMap((projectGroup) => projectGroup.parentGroups.map((parentGroup) => parentGroup.key)),
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
      parentParts.bodyMaterial.emissiveIntensity = parentGroup.isActive ? 0.15 : 0;
      parentParts.glowMaterial.color.setHex(parentGroup.isActive ? 0x34d399 : parentColorHex);
      parentParts.glowMaterial.opacity = parentGroup.isActive ? 0.72 : 0.24;
      parentParts.body.userData.threadId = parentGroup.lead.id;
      parentParts.body.userData.thread = parentGroup.lead;
      parentParts.body.userData.room = room;
      parentParts.head.userData.threadId = parentGroup.lead.id;
      parentParts.head.userData.thread = parentGroup.lead;
      parentParts.head.userData.room = room;
      state.selectable.push(parentParts.body, parentParts.head);

      const parentLabel = state.parentLabels.get(parentGroup.key);
      const parentCssColor = cssHexColor(parentColorHex);
      parentLabel.textContent = privacyLabel(parentGroup.title, state.privacy);
      parentLabel.classList.toggle("is-active", parentGroup.isActive);
      parentLabel.dataset.parentKey = parentGroup.key;
      parentLabel.style.borderColor = parentCssColor;
      parentLabel.style.boxShadow = parentGroup.isActive ? `0 0 24px ${parentCssColor}88` : "";

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
        agent.position.copy(worldPosition);
        agent.scale.setScalar(child.layout.scale * density);
        const parts = agent.userData.parts;
        parts.body.material.color.setHex(parentColorHex);
        parts.glowMaterial.color.setHex(thread.state === "ACTIVE" ? 0x34d399 : 0x475569);
        parts.glowMaterial.opacity = thread.state === "ACTIVE" ? 0.58 : 0.18;
        parts.body.userData.threadId = thread.id;
        parts.body.userData.thread = thread;
        parts.body.userData.room = room;
        parts.head.userData.threadId = thread.id;
        parts.head.userData.thread = thread;
        parts.head.userData.room = room;
        state.selectable.push(parts.body, parts.head);

        const label = state.agentLabels.get(thread.id);
        label.textContent = privacyLabel(thread.nickname || "agent", state.privacy);
        label.classList.toggle("is-active", thread.state === "ACTIVE");
        label.dataset.threadId = thread.id;
        label.dataset.parentId = thread.parent_id || thread.id;
        label.dataset.roomIndex = String(index);
        label.style.borderColor = parentCssColor;
        label.style.boxShadow = thread.state === "ACTIVE" ? `0 0 16px ${parentCssColor}66` : "";

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

  updateAgentLabelVisibility();
}

function updateAgentLabelVisibility() {
  const dense = state.threads.length > 48;
  for (const [threadId, label] of state.agentLabels.entries()) {
    const agent = state.agents.get(threadId);
    const thread = agent?.userData.thread;
    const roomIndex = Number(label.dataset.roomIndex || "0");
    label.hidden = Boolean(
      dense &&
        thread?.state !== "ACTIVE" &&
        threadId !== state.selectedId &&
        roomIndex >= 8,
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
  dom.visibleCount.textContent = String(visibleThreads);
  dom.projectCount.textContent = String(projectGroups.length);
  dom.emptyState.textContent = state.showInactive
    ? "No recent open threads."
    : "No active threads. Show idle to see recent threads.";
  dom.emptyState.hidden = visibleThreads !== 0;
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

async function fetchThreads() {
  const params = new URLSearchParams({
    activeMinutes: dom.activeMinutes.value || "5",
    maxAgeHours: dom.maxAgeHours.value || "12",
  });
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

async function refreshThreads() {
  const seq = ++state.refreshSeq;
  try {
    const payload = await fetchThreads();
    if (seq !== state.refreshSeq) {
      return;
    }
    const visibleThreads = payload.threads.filter((thread) => matchesThreadSearch(thread, state.search));
    state.threads = visibleThreads;
    const allProjectGroups = buildProjectParentGroups(visibleThreads);
    const projectGroups = filterVisibleProjectGroups(allProjectGroups, state.showInactive);
    reconcileRooms(projectGroups);
    reconcileAgents(projectGroups);
    updateCounters(projectGroups);
    updateStatus(payload);
    if (state.selectedId) {
      const selected = projectGroups
        .flatMap((projectGroup) => projectGroup.threads)
        .find((thread) => thread.id === state.selectedId);
      if (selected) {
        renderDetails(selected);
      } else {
        const selectedParent = [...state.parentAgents.values()]
          .map((agent) => agent.userData.thread)
          .find((thread) => thread?.id === state.selectedId);
        if (selectedParent) {
          renderDetails(selectedParent);
        } else {
          clearDetails();
        }
      }
    }
  } catch (error) {
    if (seq !== state.refreshSeq) {
      return;
    }
    dom.statusText.textContent = `Refresh failed: ${error.message}`;
  }
}

function showDetails(thread) {
  const changedSelection = state.selectedId !== thread.id;
  state.selectedId = thread.id;
  state.selectedThread = thread;
  if (changedSelection) {
    dom.threadMessageInput.value = "";
    dom.threadMessageStatus.textContent = "";
  }
  renderDetails(thread);
  loadThreadDetail(thread);
}

function canSendToThread(thread) {
  return thread?.role === "thread";
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

function renderDetails(thread) {
  state.selectedThread = thread;
  updateAgentLabelVisibility();
  dom.detailsEmpty.hidden = true;
  dom.detailsContent.hidden = false;
  dom.detailNickname.textContent = privacyLabel(thread.nickname || "agent", state.privacy);
  dom.detailState.textContent = `${thread.state} / ${thread.intensity}`;
  dom.detailRole.textContent = thread.role || "thread";
  dom.detailProject.textContent = privacyLabel(thread.project || "unknown", state.privacy);
  dom.detailAge.textContent = formatAge(thread.age_seconds);
  dom.detailTitle.textContent = privacyLabel(thread.title || "(untitled)", state.privacy);
  const cached = state.detailCache.get(thread.id);
  const detailContent = cached ? cached.content || "(no loaded thread content)" : "Loading thread content...";
  dom.detailThreadContent.textContent = state.privacy ? "Hidden" : detailContent;
  dom.detailParent.textContent = privacyLabel(thread.parent_title || "(none)", state.privacy);
  dom.detailCwd.textContent = privacyPath(thread.cwd || "(unknown)", state.privacy);
  dom.detailId.textContent = privacyLabel(thread.id, state.privacy);
  updateMessageComposer(thread);
}

async function loadThreadDetail(thread) {
  if (state.detailCache.has(thread.id)) {
    renderDetails({ ...thread, ...state.detailCache.get(thread.id) });
    return;
  }

  const seq = ++state.detailSeq;
  try {
    const payload = await fetchThreadDetail(thread.id);
    if (seq !== state.detailSeq || state.selectedId !== thread.id) {
      return;
    }
    if (payload.error) {
      throw new Error(payload.error);
    }
    const detail = payload.thread || {};
    state.detailCache.set(thread.id, detail);
    renderDetails({ ...thread, ...detail });
  } catch (error) {
    if (seq !== state.detailSeq || state.selectedId !== thread.id) {
      return;
    }
    dom.detailThreadContent.textContent = state.privacy
      ? "Hidden"
      : `Unable to load thread content: ${error.message}`;
  }
}

function clearDetails() {
  state.selectedId = null;
  state.selectedThread = null;
  updateAgentLabelVisibility();
  dom.detailsEmpty.hidden = false;
  dom.detailsContent.hidden = true;
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

function onPointerDown(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObjects(state.selectable, false);
  if (!intersects.length) {
    return;
  }
  const picked = intersects[0].object;
  const room = picked.userData.room;
  if (room) {
    focusCameraOnRoom(room);
  }
  const threadId = picked.userData.threadId;
  const thread = picked.userData.thread || state.threads.find((item) => item.id === threadId);
  if (thread) {
    showDetails(thread);
  }
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
}

function animateAgents(elapsed) {
  for (const parentAgent of state.parentAgents.values()) {
    const parentGroup = parentAgent.userData.parentGroup;
    const parts = parentAgent.userData.parts;
    const speed = parentGroup?.isActive ? 2.6 : 0.8;
    parentAgent.position.y = Math.sin(elapsed * speed + hashString(parentGroup?.parentId || "")) * (parentGroup?.isActive ? 0.06 : 0.015);
    parts.head.rotation.z = Math.sin(elapsed * speed) * (parentGroup?.isActive ? 0.05 : 0.018);
    parts.ring.scale.setScalar(1 + Math.sin(elapsed * speed) * (parentGroup?.isActive ? 0.1 : 0.025));
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
    if (thread.state === "ACTIVE") {
      const speed = thread.intensity === "energetic" ? 5.8 : 3.4;
      agent.position.y = Math.sin(elapsed * speed + hashString(thread.id)) * 0.08;
      parts.head.rotation.z = Math.sin(elapsed * speed) * 0.08;
      parts.ring.scale.setScalar(1 + Math.sin(elapsed * speed) * 0.08);
    } else {
      agent.position.y = Math.sin(elapsed * 1.2 + hashString(thread.id)) * 0.018;
      parts.head.rotation.z = Math.sin(elapsed * 0.8) * 0.025;
      parts.ring.scale.setScalar(1);
    }
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
      label.textContent = privacyLabel(parentGroup.title, state.privacy);
    }
  }

  for (const [threadId, label] of state.agentLabels.entries()) {
    const thread = state.agents.get(threadId)?.userData.thread;
    if (thread) {
      label.textContent = privacyLabel(thread.nickname || "agent", state.privacy);
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
    refreshThreads();
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
  dom.controls.addEventListener("submit", (event) => {
    event.preventDefault();
    savePreferences();
    refreshThreads();
  });
  dom.activeMinutes.addEventListener("change", () => {
    savePreferences();
    refreshThreads();
  });
  dom.maxAgeHours.addEventListener("change", () => {
    savePreferences();
    refreshThreads();
  });
  dom.threadSearch.addEventListener("input", () => {
    state.search = dom.threadSearch.value;
    refreshThreads();
  });
  dom.liveToggle.addEventListener("click", () => setLive(!state.live));
  dom.labelsToggle.addEventListener("click", () => setLabels(!state.labels));
  dom.privacyToggle.addEventListener("click", () => setPrivacy(!state.privacy));
  dom.inactiveToggle.addEventListener("click", () => setShowInactive(!state.showInactive));
  dom.threadMessageForm.addEventListener("submit", onThreadMessageSubmit);
  dom.threadMessagePreview.addEventListener("click", showSendConfirmation);
  dom.sendConfirmDialog.addEventListener("close", onSendConfirmClose);
}

function startPolling() {
  window.setInterval(() => {
    if (state.live) {
      refreshThreads();
    }
  }, 2000);
}

resize();
bindEvents();
const prefs = loadPreferences();
dom.activeMinutes.value = prefs.activeMinutes;
dom.maxAgeHours.value = prefs.maxAgeHours;
state.density = prefs.density;
setLabels(prefs.labels);
setShowInactive(prefs.showInactive, { refresh: false });
setPrivacy(prefs.privacy, { refresh: false });
setLive(true);
startPolling();
animate();
