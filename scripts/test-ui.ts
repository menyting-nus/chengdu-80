/// <reference lib="dom" />
// Run bun run test:ui after installing Chromium with bunx playwright install chromium.
// Uses a built Node server and temporary app data; saves screenshots and results in .local/ui-browser.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium, type Browser } from "playwright";
import type { Application } from "../apps/web/src/lib/contracts";
const dataDir = await mkdtemp(join(tmpdir(), "cd80-ui-"));
const server = spawn("node", ["apps/web/server/node-entry.mjs"], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: "3004",
    CD80_LOCAL_MODE: "1",
    MODEL_PROVIDER: "openai",
    OPENAI_API_KEY: "",
    GLM_API_KEY: "",
    CD80_DATA_DIR: dataDir,
  },
  stdio: "ignore",
});
const base = "http://127.0.0.1:3004";
const results: string[] = [];
const errors: string[] = [];
let browser: Browser | undefined;
await mkdir(".local/ui-browser", { recursive: true });
async function snapshot(): Promise<{ apps: Application[] }> {
  return (await fetch(base + "/api/platform")).json() as Promise<{ apps: Application[] }>;
}
try {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(base + "/api/platform");
      if (r.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Install all examples", exact: true }).click();
  await page
    .getByRole("heading", { name: "Portfolio lens", exact: true })
    .waitFor({ timeout: 180000 });
  await page.locator('iframe[aria-busy="false"]').waitFor();
  const layout = await page.evaluate(() => {
    const selectors = [
      '[data-slot="sidebar-container"]',
      'aside[aria-label="Application chat"]',
      'main[aria-label="Application workspace"]',
    ];
    return {
      positions: selectors.map((s) => document.querySelector(s)!.getBoundingClientRect().x),
      bg: getComputedStyle(document.body).backgroundColor,
      right: document
        .querySelector('main[aria-label="Application workspace"]')!
        .getBoundingClientRect().right,
      headerRight: document.querySelector("header")!.getBoundingClientRect().right,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  assert.equal(
    await page.evaluate(() => document.documentElement.classList.contains("dark")),
    false,
  );
  const [navigation, chat, workspace] = layout.positions;
  assert(navigation !== undefined && chat !== undefined && workspace !== undefined);
  assert(navigation < chat && chat < workspace);
  assert.equal(layout.overflow, false);
  assert(
    Math.abs(layout.right - layout.headerRight) < 1,
    "Workspace must align with the project header instead of accumulating gutters",
  );
  results.push("Desktop columns, aligned workspace edge, and sandboxed app rendering");
  assert.equal(layout.right, 1440, "Studio must reach the viewport edge");
  assert.equal(
    await page.locator("html").evaluate((element) => getComputedStyle(element).scrollbarGutter),
    "auto",
  );
  assert.equal(
    await page
      .frameLocator("iframe")
      .locator("html")
      .evaluate((element) => getComputedStyle(element).scrollbarGutter),
    "stable",
  );
  results.push(
    "No document gutter in the studio; stable gutters in scrolling panes and embedded app",
  );
  await page.screenshot({ path: ".local/ui-browser/desktop.png", fullPage: true });
  const initialSourceApp = (await snapshot()).apps.find((a) => a.name === "Portfolio lens");
  assert(initialSourceApp?.current);
  const frameBounds = await page.locator("iframe").boundingBox();
  const panelBounds = await page.getByRole("tabpanel").boundingBox();
  assert.deepEqual(frameBounds, panelBounds, "Preview must fill its container");
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Release checks", exact: true }).click();
  await page.getByText("Mandatory checks passed", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Code", exact: true }).click();
  await page
    .getByRole("textbox", { name: "src/routes/index.tsx source (read-only)", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "App.tsx", exact: true }).click();
  await page
    .getByRole("textbox", { name: "src/App.tsx source (read-only)", exact: true })
    .waitFor();
  assert(
    (await page.locator(".line-numbers").count()) > 13,
    "TSX source must display formatted lines",
  );
  const unchanged = (await snapshot()).apps.find((a) => a.id === initialSourceApp.id);
  assert.deepEqual(
    unchanged?.current?.bundle,
    initialSourceApp.current?.bundle,
    "Viewer formatting must not change stored source",
  );
  await page.locator("summary").filter({ hasText: /^lib$/ }).click();
  await page.getByRole("button", { name: "cd80.ts", exact: true }).click();
  const editor = page.getByRole("textbox", {
    name: "src/lib/cd80.ts source (read-only)",
    exact: true,
  });
  await editor.waitFor();
  assert.equal(await editor.getAttribute("readonly"), "true");
  await page.waitForFunction(
    () =>
      new Set(
        Array.from(document.querySelectorAll(".view-line span")).map(
          (e) => getComputedStyle(e).color,
        ),
      ).size > 1,
  );
  await page.locator(".view-lines").filter({ hasText: "portfolio" }).waitFor();
  const before = await page.locator(".view-lines").innerText();
  await editor.focus();
  await page.keyboard.type("THIS_MUST_NOT_WRITE");
  assert.equal(await page.locator(".view-lines").innerText(), before);
  assert((await page.locator(".line-numbers").count()) > 0);
  await page.screenshot({ path: ".local/ui-browser/code.png", fullPage: true });
  await page.getByRole("button", { name: "Enter fullscreen", exact: true }).click();
  await page.waitForFunction(
    () => document.fullscreenElement?.getAttribute("aria-label") === "Application workspace",
  );
  const fullscreenBounds = await page
    .getByRole("main", { name: "Application workspace" })
    .boundingBox();
  assert(fullscreenBounds && fullscreenBounds.x === 0 && fullscreenBounds.y === 0);
  await page.screenshot({ path: ".local/ui-browser/code-fullscreen.png", fullPage: true });
  await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  results.push("Workspace fullscreen opens and restores the studio layout");
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Specification", exact: true }).click();
  await page.getByRole("button", { name: "Export specification", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Database (read-only)", exact: true }).click();
  assert((await page.locator("pre").innerText()).includes("holdings"));
  results.push("Edge-to-edge preview, file selection, syntax highlighting, and read-only source");
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Connections", exact: true }).click();
  await page.getByRole("dialog", { name: "Connections" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  results.push("Project action menu and connections dialog open and dismiss");
  await page.getByRole("tab", { name: "Preview", exact: true }).click();
  const appState = await snapshot();
  const initial = appState.apps.find((a) => a.name === "Portfolio lens");
  assert(initial?.current);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.getByRole("button", { name: "Portfolio analysis", exact: true }).click();
  await page.locator('iframe[aria-busy="false"]').waitFor();
  results.push("Explicit examples work without pretending to be AI conversations");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "portfolio.cd80.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(initial.current.bundle)),
  });
  await page.getByRole("button", { name: "Verify imported app", exact: true }).click();
  await page.locator('iframe[aria-busy="false"]').waitFor();
  results.push("Source upload and automatic activation after verification");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Value finder", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("heading", { name: "Value finder", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: ".local/ui-browser/mobile.png", fullPage: true });
  results.push("Mobile navigation drawer, selection, and no horizontal overflow");
  await page.goto(base + "/docs");
  await page
    .getByRole("heading", { name: "Build an app. Bring its source.", exact: true })
    .waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: ".local/ui-browser/docs-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base + "/docs/source");
  await page.getByRole("heading", { name: "Source format", exact: true }).waitFor();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy Text", exact: true }).click();
  assert((await page.evaluate(() => navigator.clipboard.readText())).includes("schemaVersion"));
  await page.screenshot({ path: ".local/ui-browser/fumadocs-source.png", fullPage: true });
  await page.keyboard.press("Control+k");
  const searchDialog = page.getByRole("dialog");
  await searchDialog.waitFor();
  await searchDialog.locator("input").fill("storage.write");
  await searchDialog.getByText("Capability catalog", { exact: true }).waitFor();
  await searchDialog.getByText("Capability catalog", { exact: true }).click();
  await page.getByRole("heading", { name: "Capability catalog", exact: true }).waitFor();
  assert.equal(
    await page.locator("html").evaluate((element) => getComputedStyle(element).scrollbarGutter),
    "stable",
  );
  await page.goto(base + "/docs#sdk");
  await page.getByRole("heading", { name: "Browser SDK", exact: true }).waitFor();
  await page.goto(base + "/docs/protocols");
  await page.getByRole("heading", { name: "Application protocols", exact: true }).waitFor();
  await page
    .locator("#nd-toc")
    .getByRole("link", { name: "Strategy comparison", exact: true })
    .click();
  assert(page.url().includes("#strategy"));
  const contract = await fetch(base + "/api/docs");
  assert(contract.ok);
  results.push(
    "Fumadocs navigation, code copy, search, table of contents, and documentation links",
  );
  await page.goto(base + "/app/" + initial.id);
  await page.locator('iframe[aria-busy="false"]').waitFor();
  assert.equal(await page.getByRole("link", { name: "Chengdu80", exact: true }).count(), 0);
  assert.equal(await page.title(), initial.current!.spec.name);
  assert.equal(
    await page.locator('meta[name="description"]').getAttribute("content"),
    initial.current!.spec.purpose.slice(0, 300),
  );
  assert.equal(
    await page.locator('meta[property="og:title"]').getAttribute("content"),
    initial.current!.spec.name,
  );
  assert.equal(
    await page.locator('link[rel="canonical"]').getAttribute("href"),
    `${base}/app/${initial.id}`,
  );
  assert.equal(await page.locator('link[rel="icon"][href="/favicon.svg"]').count(), 0);
  const appBounds = await page.locator("iframe").boundingBox();
  assert(
    appBounds &&
      appBounds.x === 0 &&
      appBounds.y === 0 &&
      appBounds.width === 1440 &&
      appBounds.height === 1000,
  );
  results.push("Developer docs and standalone app routes");
  assert.deepEqual(errors, []);
  await writeFile(
    ".local/ui-browser/results.json",
    JSON.stringify({ passed: results, consoleErrors: errors, layout }, null, 2),
  );
  console.log(results.map((r) => "PASS " + r).join("\n"));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  if (server.exitCode === null) await new Promise((r) => server.once("exit", r));
  await rm(dataDir, { recursive: true, force: true });
}
