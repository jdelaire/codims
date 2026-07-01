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
  counts: { active: 1, visible: 3, projects: 1 },
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

test("renders nonblank scene and action inbox", async ({ page }) => {
  await page.goto(`${baseUrl}/index.html`);
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator(".app-header")).toHaveCount(0);
  await expect(page.locator(".details-panel")).toHaveCount(0);
  await expect(page.locator("#scene canvas")).toBeVisible();
  await expect(page.locator("#statusText")).toBeVisible();
  await expect(page.locator("#activeCount")).toHaveText("1");
  await expect(page.locator("#visibleCount")).toHaveText("3");
  await expect(page.locator("#projectCount")).toHaveText("1");
  await expect(page.locator("#inboxToggle")).toBeVisible();
  await expect(page.locator("#settingsToggle")).toBeVisible();
  await expect(page.locator("#inboxBadge")).toHaveText("2");
  await expect(page.locator("#inboxToggle")).toHaveAttribute("aria-label", "2 items need review");
  await expect(page.locator("#inboxDrawer")).toBeHidden();
  await page.locator("#inboxToggle").click();
  await expect(page.locator("#inboxToggle")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#inboxDrawer")).toBeVisible();
  await expect(page.locator("#reviewList")).toContainText("Review sidebar");
  await expect(page.locator("#reviewPanelToggle")).toHaveCount(0);
  await expect(page.locator("#reviewStaleToggle")).toHaveCount(0);
  await expect(page.locator("#reviewUnreviewedToggle")).toHaveCount(0);
  await expect(
    page.locator(".review-item").filter({ hasText: "Review sidebar" }).locator(".review-toggle"),
  ).toHaveAttribute("aria-label", /Mark .* reviewed/);
  await page.locator("#inboxClose").click();
  await expect(page.locator("#inboxDrawer")).toBeHidden();
  await expect(page.locator("#inboxToggle")).toHaveAttribute("aria-expanded", "false");
  await page.locator("#inboxToggle").click();
  await page.locator(".review-item-main").filter({ hasText: "Review sidebar" }).click();
  await expect(page.locator("#inspectorOverlay")).toBeVisible();
  await expect(page.locator("#detailTitle")).toContainText("Review sidebar");
  await expect(page.locator("#threadMessageForm")).toHaveCount(0);
  await expect(page.locator("#threadMessageInput")).toHaveCount(0);
  await expect(page.locator("#threadMessagePreview")).toHaveCount(0);
  await expect(page.locator("#threadMessageSubmit")).toHaveCount(0);
  await page.locator("#inspectorClose").click();
  await expect(page.locator("#inspectorOverlay")).toBeHidden();

  const nonBlank = await hasNonBlankScreenshot(page, page.locator("#scene canvas"));
  expect(nonBlank).toBe(true);
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
  await expect(page.locator("#detailThreadContent")).toContainText("Loading thread content");
  await page.locator("#inspectorClose").click();
  await expect(page.locator("#inspectorOverlay")).toBeHidden();

  resolveThreadDetail();
  await expect(page.locator("#detailThreadContent")).toContainText("Sidebar reviewed");
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
  await expect(page.locator("#detailTitle")).toContainText("Review sidebar");
  const inspectorBox = await page.locator("#inspectorOverlay").boundingBox();
  expect(inspectorBox).toBeTruthy();
  expect(inspectorBox.width).toBeLessThanOrEqual(390);
  expect(inspectorBox.x).toBeGreaterThanOrEqual(0);
  expect(inspectorBox.x + inspectorBox.width).toBeLessThanOrEqual(390);
  await page.locator("#inspectorClose").click();
  await page.locator("#settingsToggle").click();
  await expect(page.locator("#settingsDialog")).toBeVisible();
});
