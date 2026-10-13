/// <reference lib="dom" />
// Exercises the running local Convex-backed dev app, including one live AI reply.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/backend/convex/_generated/api";
import type { Application } from "../apps/web/src/lib/contracts";
import { configuredEnvironment, platformRoot } from "./environment";

const base = process.env.CD80_E2E_URL || "http://127.0.0.1:3002";
assert.equal(new URL(base).hostname, "127.0.0.1", "This test only targets local development");
const env = configuredEnvironment();
assert(env.PLATFORM_INTERNAL_KEY);
const client = new ConvexHttpClient("http://127.0.0.1:3210");
const serverKey = env.PLATFORM_INTERNAL_KEY;
const snapshot: {
  apps: Application[];
  status: { local: boolean; demo: boolean; modelConfigured: boolean };
} = await (await fetch(base + "/api/platform")).json();
assert.equal(snapshot.status.local, false);
assert.equal(snapshot.status.demo, true);
assert.equal(snapshot.status.modelConfigured, true);
const app = snapshot.apps.find((candidate) => candidate.current && candidate.conversation?.length);
assert(app?.current);
const originalRelease = app.current.id;
const results: string[] = [];
const before = await client.action(api.platform.listDemo, { serverKey });
await client.action(api.platform.migrateChatStorage, { serverKey });
assert.deepEqual(await client.action(api.platform.listDemo, { serverKey }), before);
assert.deepEqual(await client.action(api.platform.migrateChatStorage, { serverKey }), {
  apps: 0,
  messages: 0,
  threads: 0,
});
results.push("Legacy chat migration preserves data and is idempotent");
async function rows(table: string): Promise<Record<string, unknown>[]> {
  const { stdout } = await promisify(execFile)(
    "bunx",
    ["--no-install", "convex", "data", table, "--format", "json", "--limit", "1000"],
    { cwd: platformRoot + "/packages/backend", maxBuffer: 10000000 },
  );
  return JSON.parse(stdout);
}
const appRows = await rows("apps");
const stored = appRows.find((row) => row.appId === app.id);
assert(stored?.payload && typeof stored.payload === "object");
assert.equal("conversation" in stored.payload, false);
assert.equal("chatTitle" in stored.payload, false);
assert((await rows("threads")).some((row) => row.threadId === app.id));
assert((await rows("messages")).some((row) => row.threadId === app.id));
results.push("Apps, threads and messages are separate Convex records");
assert.deepEqual(
  await client.query(api.platform.studioMessages, { appId: crypto.randomUUID() }),
  [],
);
await assert.rejects(
  client.action(api.platform.getDemo, { appId: app.id, serverKey: "invalid" }),
  /Trusted platform/i,
);
results.push("Missing thread and invalid server credentials cannot read messages");
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  headless: process.env.CD80_E2E_HEADED !== "1",
});
const errors: string[] = [];
let fixtureId: string | undefined;
let releaseHeldRequest: (() => void) | undefined;
try {
  const sender = await browser.newPage({ viewport: { width: 1728, height: 1080 } });
  const observer = await browser.newPage({ viewport: { width: 1728, height: 1080 } });
  for (const page of [sender, observer]) {
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/#app=${app.id}`);
    await page.getByRole("heading", { name: app.chatTitle ?? app.name, exact: true }).waitFor();
    await page.getByRole("textbox").waitFor();
    await page.waitForFunction(
      () => !document.querySelector<HTMLTextAreaElement>("textarea")?.disabled,
    );
  }
  // Corrupt only client-bound text deltas. The rendered answer must still come
  // from the unchanged Convex records written by the real Node generation.
  await sender.route("**/api/ai/chat", async (route) => {
    const response = await route.fetch();
    const body = (await response.text())
      .split("\n")
      .map((line) => {
        if (!line.startsWith("data: ")) return line;
        try {
          const chunk = JSON.parse(line.slice(6));
          if (chunk.type === "TEXT_MESSAGE_CONTENT") chunk.delta = "SSE_SHOULD_NOT_RENDER";
          return "data: " + JSON.stringify(chunk);
        } catch {
          return line;
        }
      })
      .join("\n");
    await route.fulfill({ response, body });
  });
  let refreshes = 0;
  for (const page of [sender, observer]) {
    // After bootstrap, the app must update from WebSocket subscriptions.
    await page.route("**/api/platform", (route) => {
      if (route.request().method() === "GET") {
        refreshes++;
        return route.abort();
      }
      return route.continue();
    });
  }
  const prompt = `Reply with exactly: Convex conversation sync ${Date.now()}. Do not edit or build anything.`;
  await sender.getByRole("textbox").fill(prompt);
  await sender.getByRole("textbox").press("Enter");
  await observer.getByText(prompt, { exact: true }).waitFor({ timeout: 20000 });
  await observer.getByRole("button", { name: /^Working/ }).waitFor({ timeout: 20000 });
  results.push("A second tab receives the user message and running turn without refresh");
  let completed: Application | null = null;
  for (let i = 0; i < 120; i++) {
    completed = await client.action(api.platform.getDemo, { appId: app.id, serverKey });
    if (
      completed?.agentTurn?.status === "complete" &&
      completed.conversation?.some((message) =>
        message.parts.some((part) => part.type === "text" && part.content === prompt),
      )
    )
      break;
    await new Promise((done) => setTimeout(done, 500));
  }
  assert.equal(completed?.agentTurn?.status, "complete");
  assert.equal(completed?.current?.id, originalRelease);
  const reply = completed.conversation
    ?.at(-1)
    ?.parts.filter((part) => part.type === "text")
    .map((part) => part.content)
    .join("");
  assert(reply);
  await observer.getByText(reply, { exact: true }).waitFor({ timeout: 20000 });
  await sender.getByText(reply, { exact: true }).waitFor({ timeout: 20000 });
  assert.equal(await sender.getByText(/SSE_SHOULD_NOT_RENDER/).count(), 0);
  assert.equal(refreshes, 0);
  assert.equal(await sender.getByText("Could not finish this turn", { exact: true }).count(), 0);
  assert.equal(await observer.getByText("Could not finish this turn", { exact: true }).count(), 0);
  results.push(
    "The live assistant reply settles in both tabs through Convex, preserving the release",
  );
  await mkdir(".local/convex-tests", { recursive: true });
  await observer.screenshot({ path: ".local/convex-tests/reactive-observer.png", fullPage: true });
  await observer.unroute("**/api/platform");
  await observer.reload();
  await observer.getByText(reply, { exact: true }).waitFor({ timeout: 20000 });
  assert.deepEqual(
    await client.query(api.platform.studioMessages, { appId: app.id }),
    completed.conversation,
  );
  results.push("Reload restores ordered full message parts from the messages table");
  // Transport failures keep the saved prompt and release its queued turn.
  await sender.route("**/api/ai/chat", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary chat failure test" }),
    }),
  );
  const rejected = `Saved prompt survives transport failure ${Date.now()}`;
  await sender.getByRole("textbox").fill(rejected);
  await sender.getByRole("textbox").press("Enter");
  await sender.getByText(/Temporary chat failure test/).waitFor();
  await sender
    .getByRole("button", { name: "Stop generation", exact: true })
    .waitFor({ state: "hidden" });
  await sender.getByText(rejected, { exact: true }).waitFor();
  await sender.getByText(reply, { exact: true }).waitFor();
  const failed = await client.action(api.platform.getDemo, { appId: app.id, serverKey });
  assert.equal(failed?.agentTurn?.status, "stopped");
  assert.equal(failed?.conversation?.at(-1)?.parts[0]?.type, "text");
  results.push("Transport errors preserve the saved prompt and release the queued turn");
  await sender.getByRole("button", { name: "New chat", exact: true }).click();
  const fixturePrompt = `Disposable thread ${Date.now()}`;
  await sender.getByRole("textbox").fill(fixturePrompt);
  await sender.getByRole("textbox").press("Enter");
  await sender.getByText(/Temporary chat failure test/).waitFor();
  await sender
    .getByRole("button", { name: "Stop generation", exact: true })
    .waitFor({ state: "hidden" });
  await sender.getByText(fixturePrompt, { exact: true }).waitFor();
  fixtureId = new URL(sender.url()).hash.slice(1).split("=")[1]!;
  assert(fixtureId && fixtureId !== app.id);
  const title = `Delete fixture ${Date.now()}`;
  await client.mutation(api.platform.renameThread, { appId: fixtureId, title });
  await sender.getByRole("heading", { name: title, exact: true }).waitFor();
  await observer.getByRole("button", { name: title, exact: true }).click();
  await observer.getByText(fixturePrompt, { exact: true }).waitFor();
  results.push("New chat and title changes use direct Convex mutations and react in both tabs");
  await sender.unroute("**/api/ai/chat");
  const held = new Promise<void>((done) => {
    releaseHeldRequest = done;
  });
  await sender.route("**/api/ai/chat", async (route) => {
    await held;
    await route
      .fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "Stopped held request" }),
      })
      .catch(() => {});
  });
  const remoteStop = `Remote stop ${Date.now()}`;
  await sender.getByRole("textbox").fill(remoteStop);
  await sender.getByRole("textbox").press("Enter");
  await observer.getByText(remoteStop, { exact: true }).waitFor();
  await observer.getByRole("button", { name: "Stop generation", exact: true }).click();
  await sender
    .getByRole("button", { name: "Stop generation", exact: true })
    .waitFor({ state: "hidden", timeout: 5000 });
  releaseHeldRequest!();
  results.push("Stopping from another tab immediately cancels the sender's pending transport");
  const queuedId = crypto.randomUUID();
  await client.mutation(api.platform.sendMessage, {
    appId: fixtureId,
    messageId: queuedId,
    content: "Queued delete race",
  });
  await assert.rejects(
    client.mutation(api.platform.sendMessage, {
      appId: fixtureId,
      messageId: crypto.randomUUID(),
      content: "Duplicate active turn",
    }),
    /already in progress/,
  );
  await sender.getByRole("button", { name: `Delete ${title}`, exact: true }).click();
  await sender.getByRole("button", { name: "Cancel", exact: true }).click();
  assert(await client.query(api.platform.studioApp, { appId: fixtureId }));
  await sender.getByRole("button", { name: `Delete ${title}`, exact: true }).click();
  await sender.getByRole("button", { name: "Delete conversation", exact: true }).click();
  await sender.getByRole("heading", { name: "New chat", exact: true }).waitFor();
  await observer.getByRole("heading", { name: "New chat", exact: true }).waitFor();
  assert.equal(await client.query(api.platform.studioApp, { appId: fixtureId }), null);
  assert.deepEqual(await client.query(api.platform.studioMessages, { appId: fixtureId }), []);
  assert.equal(
    (await rows("threads")).some((row) => row.threadId === fixtureId),
    false,
  );
  assert.equal(
    (await rows("messages")).some((row) => row.threadId === fixtureId),
    false,
  );
  const late = await fetch(base + "/api/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      appId: fixtureId,
      messages: [
        { id: queuedId, role: "user", parts: [{ type: "text", content: "Queued delete race" }] },
      ],
    }),
  });
  assert.equal(late.status, 400);
  assert.equal(await client.query(api.platform.studioApp, { appId: fixtureId }), null);
  results.push(
    "Confirmed deletion removes the active thread, app and messages in both tabs; late execution cannot resurrect it",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    ".local/convex-tests/results.json",
    JSON.stringify({ passed: results.length, results, errors }, null, 2),
  );
  for (const result of results) console.log("PASS " + result);
} finally {
  releaseHeldRequest?.();
  if (fixtureId)
    await client.mutation(api.platform.deleteThread, { appId: fixtureId }).catch(() => {});
  await browser.close();
}
