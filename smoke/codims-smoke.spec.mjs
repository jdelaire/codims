import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

let baseUrl;
let server;
let unexpectedMessageRequests = [];

const threadsPayload = {
  source: "codex_app_server",
  generated_at_ms: Date.now(),
  capabilities: { read_threads: true, send_messages: false },
  counts: { active: 1, visible: 4, projects: 1 },
  threads: [
    {
      id: "parent",
      title: "Ship Codims",
      nickname: "Ship Codims",
      role: "thread",
      cwd: "/repo/codims",
      project: "codims",
      parent_id: "parent",
      parent_title: "Ship Codims",
      updated_at_ms: Date.now() - 120000,
      age_seconds: 120,
      state: "RECENT",
      intensity: "idle",
      last_response_snippet: "Ready for review.",
    },
    {
      id: "child-active",
      title: "Render rooms",
      nickname: "Ada",
      role: "agent",
      cwd: "/repo/codims",
      project: "codims",
      parent_id: "parent",
      parent_title: "Ship Codims",
      updated_at_ms: Date.now() - 30000,
      age_seconds: 30,
      state: "ACTIVE",
      intensity: "working",
      last_response_snippet: "Rendering room signs.",
    },
    {
      id: "child-done",
      title: "Review sidebar",
      nickname: "Grace",
      role: "agent",
      cwd: "/repo/codims",
      project: "codims",
      parent_id: "parent",
      parent_title: "Ship Codims",
      updated_at_ms: Date.now() - 300000,
      age_seconds: 300,
      state: "DONE",
      intensity: "idle",
      last_response_snippet: "Sidebar reviewed.",
    },
    {
      id: "parent-done",
      title: "Clarify inbox contents",
      nickname: "Clarify inbox contents",
      role: "thread",
      cwd: "/repo/codims",
      project: "codims",
      parent_id: "parent-done",
      parent_title: "Clarify inbox contents",
      updated_at_ms: Date.now() - 480000,
      age_seconds: 480,
      state: "DONE",
      intensity: "idle",
      last_response_snippet: "Inbox contents clarified.",
    },
  ],
};

const threadDetailPayload = {
  source: "codex_app_server",
  generated_at_ms: Date.now(),
  thread: {
    id: "child-done",
    title: "Review sidebar",
    nickname: "Grace",
    role: "agent",
    cwd: "/repo/codims",
    project: "codims",
    parent_id: "parent",
    updated_at_ms: Date.now() - 300000,
    age_seconds: 300,
    turn_count: 2,
    agent_prompt: "Review sidebar behavior.",
    last_response: "Sidebar reviewed.",
    content: "Agent prompt\nReview sidebar behavior.\n\nLast response\nSidebar reviewed.",
  },
};

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) {
    return "text/javascript; charset=utf-8";
  }
  return "application/octet-stream";
}

function createStaticServer(root) {
  return createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
      const relativePath = decodeURIComponent(pathname).replace(/^\/+/, "");
      const filePath = path.resolve(root, relativePath);

      if (!filePath.startsWith(`${root}${path.sep}`)) {
        response.writeHead(404).end();
        return;
      }

      const body = await readFile(filePath);
      response.writeHead(200, { "content-type": contentTypeFor(filePath) });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
}

async function hasNonBlankScreenshot(page, locator) {
  const png = await locator.screenshot();
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  return page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();

    const sampler = document.createElement("canvas");
    sampler.width = image.width;
    sampler.height = image.height;
    const context = sampler.getContext("2d");
    if (!context) {
      return false;
    }

    context.drawImage(image, 0, 0);
    const background = [4, 6, 13];
    let minLuminance = Infinity;
    let maxLuminance = -Infinity;
    let maxBackgroundDistance = 0;

    for (let y = 1; y <= 9; y += 1) {
      for (let x = 1; x <= 9; x += 1) {
        const pixel = context.getImageData(
          Math.floor((sampler.width * x) / 10),
          Math.floor((sampler.height * y) / 10),
          1,
          1,
        ).data;
        const luminance = 0.2126 * pixel[0] + 0.7152 * pixel[1] + 0.0722 * pixel[2];
        minLuminance = Math.min(minLuminance, luminance);
        maxLuminance = Math.max(maxLuminance, luminance);

        const backgroundDistance = Math.hypot(
          pixel[0] - background[0],
          pixel[1] - background[1],
          pixel[2] - background[2],
        );
        maxBackgroundDistance = Math.max(maxBackgroundDistance, backgroundDistance);

        if (backgroundDistance > 45) {
          return true;
        }
      }
    }
    return maxLuminance - minLuminance > 35 && maxBackgroundDistance > 25;
  }, dataUrl);
}

async function screenshotDifferenceRatio(page, beforePng, afterPng) {
  const beforeUrl = `data:image/png;base64,${beforePng.toString("base64")}`;
  const afterUrl = `data:image/png;base64,${afterPng.toString("base64")}`;
  return page.evaluate(
    async ({ beforeUrl, afterUrl }) => {
      const loadImage = async (url) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        return image;
      };
      const [beforeImage, afterImage] = await Promise.all([
        loadImage(beforeUrl),
        loadImage(afterUrl),
      ]);
      const width = Math.min(beforeImage.width, afterImage.width);
      const height = Math.min(beforeImage.height, afterImage.height);
      const sampler = document.createElement("canvas");
      sampler.width = width;
      sampler.height = height;
      const context = sampler.getContext("2d");
      if (!context) {
        return 1;
      }

      context.drawImage(beforeImage, 0, 0);
      const before = context.getImageData(0, 0, width, height).data;
      context.clearRect(0, 0, width, height);
      context.drawImage(afterImage, 0, 0);
      const after = context.getImageData(0, 0, width, height).data;
      let changed = 0;
      for (let index = 0; index < before.length; index += 4) {
        const delta =
          Math.abs(before[index] - after[index]) +
          Math.abs(before[index + 1] - after[index + 1]) +
          Math.abs(before[index + 2] - after[index + 2]);
        if (delta > 18) {
          changed += 1;
        }
      }
      return changed / (width * height);
    },
    { beforeUrl, afterUrl },
  );
}

test.beforeAll(async () => {
  const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  server = createStaticServer(root);
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test.beforeEach(async ({ page }) => {
  unexpectedMessageRequests = [];
  await page.route("**/api/threads?**", async (route) => {
    await route.fulfill({ json: threadsPayload });
  });
  await page.route("**/api/thread/*/message", async (route) => {
    unexpectedMessageRequests.push(route.request().url());
    await route.fulfill({ status: 500, body: "Unexpected smoke test message request" });
  });
  await page.route("**/api/thread/*", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 500, body: "Unexpected smoke test message request" });
      return;
    }
    await route.fulfill({ json: threadDetailPayload });
  });
});

test.afterEach(() => {
  expect(unexpectedMessageRequests).toEqual([]);
});

test("uses Codex Grid browser chrome labels", async ({ page }) => {
  await page.goto(`${baseUrl}/index.html`);
  await expect(page).toHaveTitle("Codex Grid");
  await expect(page.locator(".hud-layer")).toHaveAttribute("aria-label", "Codex Grid controls");
  await expect(page.locator(".hud-counters")).toHaveAttribute("aria-label", "Codex Grid counters");
});

test("renders nonblank scene and action inbox", async ({ page }) => {
  await page.goto(`${baseUrl}/index.html`);
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator(".app-header")).toHaveCount(0);
  await expect(page.locator(".details-panel")).toHaveCount(0);
  await expect(page.locator("#scene canvas")).toBeVisible();
  await expect(page.locator("#statusText")).toBeVisible();
  await expect(page.locator("#activeCount")).toHaveText("1");
  await expect(page.locator("#visibleCount")).toHaveText("4");
  await expect(page.locator("#projectCount")).toHaveText("1");
  await expect(page.locator("#inboxToggle")).toBeVisible();
  await expect(page.locator("#settingsToggle")).toBeVisible();
  const themeTokens = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      bg: styles.getPropertyValue("--bg").trim(),
      accent: styles.getPropertyValue("--accent").trim(),
      warn: styles.getPropertyValue("--warn").trim(),
    };
  });
  expect(themeTokens).toEqual({
    bg: "#02040a",
    accent: "#00e5ff",
    warn: "#ff8a00",
  });
  const sceneDebug = await page.evaluate(() => window.__codimsSceneDebug?.());
  expect(sceneDebug).toMatchObject({
    hasCapsuleAgents: true,
    hasPointLights: true,
  });
  expect(sceneDebug.programDetailParts).toBeGreaterThanOrEqual(6);
  expect(sceneDebug.glowShells).toBeGreaterThanOrEqual(3);
  expect(sceneDebug.activeDataLanes).toBeGreaterThanOrEqual(1);
  expect(sceneDebug.animatedDataLanes).toBeGreaterThanOrEqual(1);
  expect(sceneDebug.depthTestDisabledDataLanes).toBe(0);
  expect(sceneDebug.programAuraRings).toBeGreaterThanOrEqual(2);
  expect(sceneDebug.roomCircuitPulseSurfaces).toBeGreaterThanOrEqual(1);
  expect(sceneDebug.cityRoadSegments).toBeGreaterThanOrEqual(4);
  expect(sceneDebug.cityIntersections).toBeGreaterThanOrEqual(4);
  expect(sceneDebug.lightCycleBikes).toBeGreaterThanOrEqual(2);
  expect(sceneDebug.lightCycleBikes).toBeLessThanOrEqual(36);
  expect(sceneDebug.lightCycleTrails).toBeGreaterThanOrEqual(2);
  expect(sceneDebug.animatedLightCycles).toBeGreaterThanOrEqual(1);
  expect(sceneDebug.reviewBeams).toBeGreaterThanOrEqual(1);
  expect(sceneDebug.visibleReviewBeams).toBe(2);
  expect(sceneDebug.reviewBeamParticleFields).toBeGreaterThanOrEqual(2);
  await page.locator("#settingsToggle").click();
  await page.locator("#inactiveToggle").click();
  await expect(page.locator('.agent-label[data-thread-id="child-done"]')).toHaveCount(1);
  await page.locator("#settingsClose").click();
  const labelStyles = await page.evaluate(() => {
    const active = document.querySelector('.agent-label[data-thread-id="child-active"]');
    const inactive = document.querySelector('.agent-label[data-thread-id="child-done"]');
    const inactiveParent = document.querySelector('.parent-label[data-parent-key="codims:parent-done"]');
    const emptyDigest = document.createElement("div");
    emptyDigest.className = "digest-label is-empty";
    emptyDigest.textContent = "0 done";
    document.querySelector("#labels")?.appendChild(emptyDigest);
    const activeStyles = active ? getComputedStyle(active) : null;
    const inactiveStyles = inactive ? getComputedStyle(inactive) : null;
    const emptyDigestStyles = getComputedStyle(emptyDigest);
    return {
      activeOpacity: activeStyles?.opacity || null,
      inactiveClass: inactive?.className || null,
      inactiveBackground: inactiveStyles?.backgroundColor || null,
      inactiveBorderColor: inactiveStyles?.borderTopColor || null,
      inactiveBoxShadow: inactiveStyles?.boxShadow || null,
      inactiveColor: inactiveStyles?.color || null,
      inactiveFontSize: inactiveStyles?.fontSize || null,
      inactiveFontWeight: inactiveStyles?.fontWeight || null,
      inactiveOpacity: inactiveStyles?.opacity || null,
      inactiveTextTransform: inactiveStyles?.textTransform || null,
      inactiveParentClass: inactiveParent?.className || null,
      inactiveParentBackground: inactiveParent ? getComputedStyle(inactiveParent).backgroundColor : null,
      inactiveParentBorderColor: inactiveParent ? getComputedStyle(inactiveParent).borderTopColor : null,
      inactiveParentBorderWidth: inactiveParent ? getComputedStyle(inactiveParent).borderTopWidth : null,
      inactiveParentBoxShadow: inactiveParent ? getComputedStyle(inactiveParent).boxShadow : null,
      inactiveParentColor: inactiveParent ? getComputedStyle(inactiveParent).color : null,
      inactiveParentFontSize: inactiveParent ? getComputedStyle(inactiveParent).fontSize : null,
      inactiveParentFontWeight: inactiveParent ? getComputedStyle(inactiveParent).fontWeight : null,
      inactiveParentMaxWidth: inactiveParent ? getComputedStyle(inactiveParent).maxWidth : null,
      inactiveParentOpacity: inactiveParent ? getComputedStyle(inactiveParent).opacity : null,
      inactiveParentPaddingTop: inactiveParent ? getComputedStyle(inactiveParent).paddingTop : null,
      inactiveParentPaddingRight: inactiveParent ? getComputedStyle(inactiveParent).paddingRight : null,
      inactiveParentTextTransform: inactiveParent ? getComputedStyle(inactiveParent).textTransform : null,
      inactiveParentWhiteSpace: inactiveParent ? getComputedStyle(inactiveParent).whiteSpace : null,
      emptyDigestBackground: emptyDigestStyles.backgroundColor,
      emptyDigestBorderColor: emptyDigestStyles.borderTopColor,
      emptyDigestBorderWidth: emptyDigestStyles.borderTopWidth,
      emptyDigestBoxShadow: emptyDigestStyles.boxShadow,
      emptyDigestColor: emptyDigestStyles.color,
      emptyDigestFontSize: emptyDigestStyles.fontSize,
      emptyDigestFontWeight: emptyDigestStyles.fontWeight,
      emptyDigestMaxWidth: emptyDigestStyles.maxWidth,
      emptyDigestOpacity: emptyDigestStyles.opacity,
      emptyDigestPaddingTop: emptyDigestStyles.paddingTop,
      emptyDigestPaddingRight: emptyDigestStyles.paddingRight,
      emptyDigestTextTransform: emptyDigestStyles.textTransform,
      emptyDigestWhiteSpace: emptyDigestStyles.whiteSpace,
    };
  });
  expect(labelStyles.inactiveClass).toContain("is-inactive");
  expect(labelStyles.inactiveBackground).toBe(labelStyles.emptyDigestBackground);
  expect(labelStyles.inactiveBorderColor).toBe(labelStyles.emptyDigestBorderColor);
  expect(labelStyles.inactiveBoxShadow).toBe(labelStyles.emptyDigestBoxShadow);
  expect(labelStyles.inactiveColor).toBe(labelStyles.emptyDigestColor);
  expect(labelStyles.inactiveFontSize).toBe(labelStyles.emptyDigestFontSize);
  expect(labelStyles.inactiveFontWeight).toBe(labelStyles.emptyDigestFontWeight);
  expect(labelStyles.inactiveOpacity).toBe(labelStyles.emptyDigestOpacity);
  expect(labelStyles.inactiveTextTransform).toBe(labelStyles.emptyDigestTextTransform);
  expect(labelStyles.inactiveParentClass).toContain("is-inactive");
  expect(labelStyles.inactiveParentBackground).toBe(labelStyles.emptyDigestBackground);
  expect(labelStyles.inactiveParentBorderColor).toBe(labelStyles.emptyDigestBorderColor);
  expect(labelStyles.inactiveParentBorderWidth).toBe(labelStyles.emptyDigestBorderWidth);
  expect(labelStyles.inactiveParentBoxShadow).toBe(labelStyles.emptyDigestBoxShadow);
  expect(labelStyles.inactiveParentColor).toBe(labelStyles.emptyDigestColor);
  expect(labelStyles.inactiveParentFontSize).toBe(labelStyles.emptyDigestFontSize);
  expect(labelStyles.inactiveParentFontWeight).toBe(labelStyles.emptyDigestFontWeight);
  expect(labelStyles.inactiveParentMaxWidth).toBe(labelStyles.emptyDigestMaxWidth);
  expect(labelStyles.inactiveParentOpacity).toBe(labelStyles.emptyDigestOpacity);
  expect(labelStyles.inactiveParentPaddingTop).toBe(labelStyles.emptyDigestPaddingTop);
  expect(labelStyles.inactiveParentPaddingRight).toBe(labelStyles.emptyDigestPaddingRight);
  expect(labelStyles.inactiveParentTextTransform).toBe(labelStyles.emptyDigestTextTransform);
  expect(labelStyles.inactiveParentWhiteSpace).toBe(labelStyles.emptyDigestWhiteSpace);
  expect(Number(labelStyles.inactiveOpacity)).toBeLessThan(Number(labelStyles.activeOpacity));
  await expect(page.locator("#inboxBadge")).toHaveText("3");
  await expect(page.locator("#inboxToggle")).toHaveAttribute("aria-label", "3 items need review");
  await expect(page.locator("#inboxDrawer")).toBeHidden();
  await page.locator("#inboxToggle").click();
  await expect(page.locator("#inboxToggle")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#inboxDrawer")).toBeVisible();
  await expect(page.locator('[data-action-inbox-filter="needs_review"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.locator("#reviewList")).toContainText("Review sidebar");
  await expect(page.locator("#reviewList")).toContainText("Ship Codims");
  await expect(page.locator("#reviewList")).toContainText("Clarify inbox contents");
  await expect(page.locator("#reviewPanelToggle")).toHaveCount(0);
  await expect(page.locator("#reviewStaleToggle")).toHaveCount(0);
  await expect(page.locator("#reviewUnreviewedToggle")).toHaveCount(0);
  await expect(page.locator(".review-item.is-running")).toHaveCount(1);
  await page.locator('[data-action-inbox-filter="running"]').click();
  await expect(page.locator('[data-action-inbox-filter="running"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".review-item.is-running")).toHaveCount(1);
  await expect(page.locator("#reviewList")).toContainText("Ship Codims");
  await page.locator('[data-action-inbox-filter="needs_review"]').click();
  await expect(page.locator('[data-action-inbox-filter="needs_review"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#reviewList")).toContainText("Review sidebar");
  await expect(page.locator(".review-item.is-running")).toHaveCount(0);
  await expect(
    page.locator(".review-item").filter({ hasText: "Review sidebar" }).locator(".review-toggle"),
  ).toHaveAttribute("aria-label", /Mark .* reviewed/);
  await expect(
    page.locator(".review-item").filter({ hasText: "Review sidebar" }).locator(".review-toggle"),
  ).toHaveText("Review");
  await page.locator("#inboxClose").click();
  await expect(page.locator("#inboxDrawer")).toBeHidden();
  await expect(page.locator("#inboxToggle")).toHaveAttribute("aria-expanded", "false");
  await page.locator("#inboxToggle").click();
  await page.locator(".review-item-main").filter({ hasText: "Review sidebar" }).click();
  await expect(page.locator("#inspectorOverlay")).toBeVisible();
  await expect(page.locator("#detailsContent dt").filter({ hasText: "Title / content" })).toHaveCount(0);
  await expect(page.locator("#detailsContent dt").filter({ hasText: "CWD" })).toHaveCount(0);
  await expect(page.locator("#detailsContent dt").filter({ hasText: "Thread id" })).toHaveCount(0);
  await expect(page.locator("#detailAgentPrompt")).toContainText("Review sidebar behavior.");
  await expect(page.locator("#detailLastResponse")).toContainText("Sidebar reviewed.");
  await expect(page.locator("#detailAgentPrompt")).not.toContainText("Last response");
  await expect(page.locator("#detailLastResponse")).not.toContainText("Agent prompt");
  await expect(page.locator("#threadMessageForm")).toHaveCount(0);
  await expect(page.locator("#threadMessageInput")).toHaveCount(0);
  await expect(page.locator("#threadMessagePreview")).toHaveCount(0);
  await expect(page.locator("#threadMessageSubmit")).toHaveCount(0);
  await page.locator("#inspectorClose").click();
  await expect(page.locator("#inspectorOverlay")).toBeHidden();

  const nonBlank = await hasNonBlankScreenshot(page, page.locator("#scene canvas"));
  expect(nonBlank).toBe(true);
});

test("hides review beam when digest items are reviewed", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "codims.reviewedThreads.v1",
      JSON.stringify(["child-done", "parent", "parent-done"]),
    );
  });
  await page.goto(`${baseUrl}/index.html`);
  await expect(page.locator("#activeCount")).toHaveText("1");

  const sceneDebug = await page.evaluate(() => window.__codimsSceneDebug?.());
  expect(sceneDebug.reviewBeams).toBeGreaterThanOrEqual(1);
  expect(sceneDebug.visibleReviewBeams).toBe(0);
  await expect(page.locator("#inboxBadge")).toHaveText("0");
});

test("keeps inspector dismissed after delayed detail load", async ({ page }) => {
  let resolveThreadDetail;
  const threadDetailReady = new Promise((resolve) => {
    resolveThreadDetail = resolve;
  });

  await page.unroute("**/api/thread/*");
  await page.route("**/api/thread/*", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 500, body: "Unexpected smoke test message request" });
      return;
    }
    await threadDetailReady;
    await route.fulfill({ json: threadDetailPayload });
  });

  await page.goto(`${baseUrl}/index.html`);
  await page.locator("#inboxToggle").click();
  await page.locator(".review-item-main").filter({ hasText: "Review sidebar" }).click();
  await expect(page.locator("#inspectorOverlay")).toBeVisible();
  await expect(page.locator("#detailAgentPrompt")).toContainText("Loading thread content");
  await page.locator("#inspectorClose").click();
  await expect(page.locator("#inspectorOverlay")).toBeHidden();

  resolveThreadDetail();
  await expect(page.locator("#detailAgentPrompt")).toContainText("Review sidebar behavior.");
  await expect(page.locator("#detailLastResponse")).toContainText("Sidebar reviewed.");
  await expect(page.locator("#inspectorOverlay")).toBeHidden();
});

test("privacy mode hides sidebar content", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "codims.preferences.v1",
      JSON.stringify({ prefsVersion: 2, maxAgeHours: "8", privacy: true }),
    );
  });
  await page.goto(`${baseUrl}/index.html`);
  await page.locator("#inboxToggle").click();
  await expect(page.locator("#reviewList")).toContainText("Hidden");
  await expect(page.locator(".review-toggle").first()).toHaveAttribute("aria-label", "Mark item reviewed");
  await expect(page.locator(".review-toggle").first()).not.toHaveAttribute("aria-label", /Review sidebar/);
});

test("settings overlay controls privacy and idle filters", async ({ page }) => {
  await page.goto(`${baseUrl}/index.html`);
  await page.locator("#settingsToggle").click();
  await expect(page.locator("#settingsDialog")).toBeVisible();
  const settingsChrome = await page.locator("#settingsDialog").evaluate((dialog) => {
    const styles = getComputedStyle(dialog);
    return {
      backgroundImage: styles.backgroundImage,
      borderColor: styles.borderTopColor,
      boxShadow: styles.boxShadow,
    };
  });
  expect(settingsChrome.borderColor).toBe("rgba(0, 229, 255, 0.34)");
  expect(settingsChrome.backgroundImage).toContain("linear-gradient");
  expect(settingsChrome.boxShadow).toContain("rgba(0, 229, 255");
  await expect(page.locator("#maxAgeHours")).toHaveValue("8");
  await page.locator("#privacyToggle").click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem("codims.preferences.v1");
        return raw ? Object.hasOwn(JSON.parse(raw), "density") : null;
      }),
    )
    .toBe(false);
  await page.locator("#settingsClose").click();
  await page.locator("#inboxToggle").click();
  await expect(page.locator("#reviewList")).toContainText("Hidden");
});

test("settings close works with invalid max age", async ({ page }) => {
  await page.goto(`${baseUrl}/index.html`);
  await page.locator("#settingsToggle").click();
  await page.locator("#maxAgeHours").fill("-1");
  await page.locator("#settingsClose").click();
  await expect(page.locator("#settingsDialog")).toBeHidden();
});

test("mobile layout keeps scene and inspector details available", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseUrl}/index.html`);
  await expect(page.locator("#scene canvas")).toBeVisible();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator(".details-panel")).toHaveCount(0);
  const statusBox = await page.locator(".hud-status").boundingBox();
  const actionsBox = await page.locator(".hud-actions").boundingBox();
  expect(statusBox).toBeTruthy();
  expect(actionsBox).toBeTruthy();
  expect(statusBox.x + statusBox.width).toBeLessThanOrEqual(actionsBox.x);
  await page.locator("#inboxToggle").click();
  await expect(page.locator("#inboxDrawer")).toBeVisible();
  const drawerBox = await page.locator("#inboxDrawer").boundingBox();
  expect(drawerBox).toBeTruthy();
  expect(drawerBox.width).toBeLessThanOrEqual(390);
  await page.locator(".review-item-main").filter({ hasText: "Review sidebar" }).click();
  await expect(page.locator("#inspectorOverlay")).toBeVisible();
  await expect(page.locator("#detailAgentPrompt")).toBeVisible();
  await expect(page.locator("#detailLastResponse")).toBeVisible();
  const inspectorBox = await page.locator("#inspectorOverlay").boundingBox();
  const countersBox = await page.locator(".hud-counters").boundingBox();
  expect(inspectorBox).toBeTruthy();
  expect(countersBox).toBeTruthy();
  expect(inspectorBox.width).toBeLessThanOrEqual(390);
  expect(inspectorBox.x).toBeGreaterThanOrEqual(0);
  expect(inspectorBox.x + inspectorBox.width).toBeLessThanOrEqual(390);
  expect(inspectorBox.y + inspectorBox.height).toBeLessThanOrEqual(countersBox.y);
  await page.locator("#inspectorClose").click();
  await page.locator("#settingsToggle").click();
  await expect(page.locator("#settingsDialog")).toBeVisible();
});

test("reduced motion keeps scene animation static", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${baseUrl}/index.html`);
  await expect(page.locator("#scene canvas")).toBeVisible();
  await expect(page.locator("#activeCount")).toHaveText("1");
  const sceneDebug = await page.evaluate(() => window.__codimsSceneDebug?.());
  expect(sceneDebug.reducedMotionActive).toBe(true);
  expect(sceneDebug.activeDataLanes).toBeGreaterThanOrEqual(1);
  expect(sceneDebug.animatedDataLanes).toBe(0);
  expect(sceneDebug.lightCycleBikes).toBeGreaterThanOrEqual(2);
  expect(sceneDebug.animatedLightCycles).toBe(0);
  await page.waitForTimeout(1200);
  const canvas = page.locator("#scene canvas");
  const before = await canvas.screenshot();
  await page.waitForTimeout(800);
  const after = await canvas.screenshot();
  const differenceRatio = await screenshotDifferenceRatio(page, before, after);
  expect(differenceRatio).toBeLessThan(0.0005);
});
