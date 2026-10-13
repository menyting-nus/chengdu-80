/// <reference lib="dom" />
// Actual Node + TanStack AI + browser integration against a deterministic local
// Responses transport. Never loads a real model key or writes the dev workspace.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import type { Application, AppBundle } from "../apps/web/src/lib/contracts";

type InputItem = {
  role?: string;
  type?: string;
  content?: unknown;
  name?: string;
  output?: string;
};
type ModelRequest = {
  model: string;
  input: InputItem[];
  stream?: boolean;
  reasoning?: { effort?: string };
  text?: { format?: { schema?: { properties?: Record<string, unknown> } } };
};
const requests: ModelRequest[] = [];
const results: string[] = [];
const browserErrors: string[] = [];
let sequence = 0;
let registeredPluginId = "";
let pluginManifest: AppBundle["manifest"] | undefined;
const providerCities: string[] = [];
const fixture = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/weather") {
      const city = url.searchParams.get("city") ?? "";
      providerCities.push(city);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ city, temperature: 21 }));
      return;
    }
    assert.equal(req.url, "/v1/responses");
    assert.equal(req.headers.authorization, "Bearer agent-fixture-key");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw) as ModelRequest;
    requests.push(body);
    const title = !!body.text?.format?.schema?.properties?.title;
    const lastUser = body.input.map((item) => item.role).lastIndexOf("user");
    const current = body.input.slice(lastUser);
    const prompt = JSON.stringify(current[0]?.content ?? "");
    const calls = current.filter((item) => item.type === "function_call_output").length;
    let text = title
      ? JSON.stringify({ title: "Agent fixture site" })
      : "We can discuss the site before building. I remember the codename Copper Finch.";
    let tool: { name: string; arguments: Record<string, unknown> } | undefined;
    if (prompt.includes("Build the Copper Finch")) {
      if (!calls) await new Promise((resolve) => setTimeout(resolve, 200));
      const steps = [
        { name: "list_files", arguments: {} },
        {
          name: "write_file",
          arguments: {
            path: "src/App.tsx",
            content: `import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
export default function App() { return <Card><CardHeader><CardTitle>Copper Finch</CardTitle></CardHeader><CardContent>Built by real agent tools</CardContent></Card>; }`,
          },
        },
        {
          name: "bash",
          arguments: {
            command: `bun -e 'const source=await Bun.file("src/App.tsx").text(); await Bun.write("src/App.tsx", source.replace("Built by real agent tools", "Built by real shell tools")); console.log("fixture-shell");'`,
          },
        },
        {
          name: "deploy_preview",
          arguments: { summary: "Built Copper Finch through workspace tools" },
        },
      ];
      tool = steps[calls];
      text =
        "**Copper Finch** is built and running.\n\n- Workspace tools updated the site.\n- The verified release is active.\n\nInitialization uses `cd80.ready()`.\n\n| Check | Result |\n| --- | --- |\n| Verification | Passed |";
    } else if (prompt.includes("Connect the registered weather plugin")) {
      assert(registeredPluginId && pluginManifest);
      tool = [
        { name: "list_plugins", arguments: {} },
        { name: "enable_plugin", arguments: { pluginId: registeredPluginId } },
        {
          name: "call_plugin",
          arguments: {
            pluginId: registeredPluginId,
            operationId: "getWeather",
            parametersJson: JSON.stringify({ city: "London" }),
          },
        },
        {
          name: "set_permissions",
          arguments: { permissions: [...new Set([...pluginManifest.permissions, "plugin.call"])] },
        },
        {
          name: "write_file",
          arguments: {
            path: "src/App.tsx",
            content: `import { useEffect, useState } from 'react';
import { z } from 'zod';
import { cd80 } from '@/lib/cd80';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
const weatherSchema = z.object({temperature: z.number(), city: z.string()});
export default function App() {
 const [weather, setWeather] = useState<z.infer<typeof weatherSchema> | null>(null);
 useEffect(() => { void cd80.plugins.callParsed({pluginId: '${registeredPluginId}', operationId: 'getWeather', parameters: {city: 'London'}}, weatherSchema).then(setWeather); }, []);
 return <Card><CardHeader><CardTitle>London weather</CardTitle></CardHeader><CardContent>{weather ? weather.temperature + '°C in ' + weather.city : 'Loading weather'}</CardContent></Card>;
}`,
          },
        },
        {
          name: "deploy_preview",
          arguments: { summary: "Connected the system-registered weather plugin" },
        },
      ][calls];
      text = "The site now displays London weather from the registered plugin.";
    } else if (prompt.includes("Stage a broken change")) {
      tool = [
        {
          name: "write_file",
          arguments: {
            path: "src/App.tsx",
            content:
              'export default function App() { const broken: number = "invalid"; return <div>{broken}</div>; }',
          },
        },
        { name: "deploy_preview", arguments: { summary: "Check intentionally invalid source" } },
      ][calls];
      text = "The change failed verification. Your working site is unchanged.";
    } else if (prompt.includes("Start a slow turn")) {
      if (!calls) tool = { name: "list_files", arguments: {} };
      else await new Promise((resolve) => setTimeout(resolve, 1600));
      text = "This delayed turn should be cancelled.";
    } else if (prompt.includes("Complete 21 tool rounds")) {
      if (calls < 21) tool = { name: "list_files", arguments: {} };
      text = "All 21 tool rounds completed.";
    } else if (prompt.includes("Steer to discussing")) {
      assert(JSON.stringify(body.input).includes("Copper Finch"));
      text = "Steering received. We will discuss Copper Finch without changing its files.";
    }
    const id = `fixture_${++sequence}`;
    const item = tool
      ? {
          id,
          type: "function_call",
          call_id: id,
          name: tool.name,
          arguments: JSON.stringify(tool.arguments),
          status: "completed",
        }
      : {
          id,
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text, annotations: [] }],
        };
    const response = {
      id: `resp_${id}`,
      object: "response",
      status: "completed",
      model: body.model,
      output: [item],
      usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
    };
    if (!body.stream) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(response));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const events = [
      { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { ...item, status: "in_progress", ...(tool ? { arguments: "" } : { content: [] }) },
      },
      ...(tool
        ? [
            {
              type: "response.function_call_arguments.delta",
              item_id: id,
              output_index: 0,
              delta: JSON.stringify(tool.arguments),
            },
            {
              type: "response.function_call_arguments.done",
              item_id: id,
              output_index: 0,
              arguments: JSON.stringify(tool.arguments),
            },
          ]
        : [
            {
              type: "response.output_text.delta",
              item_id: id,
              output_index: 0,
              content_index: 0,
              delta: text,
            },
          ]),
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response },
    ];
    for (const event of events)
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    res.end();
  } catch (error) {
    res.writeHead(500);
    res.end(error instanceof Error ? error.message : "Fixture error");
  }
});
await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
const address = fixture.address();
assert(address && typeof address !== "string");
const fixturePort = address.port;
const dataDir = await mkdtemp(join(tmpdir(), "cd80-agent-"));
const base = "http://127.0.0.1:3007";
let node: ChildProcess | undefined;
let browser: Browser | undefined;
async function start() {
  node = spawn("node", ["apps/web/server/node-entry.mjs"], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: "3007",
      CD80_PLUGIN_TEST_ORIGIN: `http://127.0.0.1:${fixturePort}`,
      CD80_LOCAL_MODE: "1",
      CD80_DEMO_MODE: "1",
      CD80_DATA_DIR: dataDir,
      MODEL_PROVIDER: "openai",
      OPENAI_MODEL: "gpt-6-luna",
      OPENAI_API_KEY: "agent-fixture-key",
      OPENAI_BASE_URL: `http://127.0.0.1:${fixturePort}/v1`,
    },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${base}/api/platform`)).ok) return;
    } catch {
      /* Server starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Agent test Node server did not start");
}
async function stop() {
  if (!node || node.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => node!.once("exit", () => resolve()));
  node.kill("SIGTERM");
  await exited;
}
async function snapshot() {
  const response = await fetch(`${base}/api/platform`);
  return response.json() as Promise<{ apps: Application[] }>;
}
async function appById(id: string) {
  const app = (await snapshot()).apps.find((candidate) => candidate.id === id);
  assert(app);
  return app;
}
async function turn(appId: string, content: string, headers: Record<string, string> = {}) {
  return fetch(`${base}/api/ai/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      appId,
      messages: [{ id: crypto.randomUUID(), role: "user", parts: [{ type: "text", content }] }],
    }),
  });
}
await mkdir(".local/agent-tests", { recursive: true });
try {
  await start();
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes("/api/ai/chat") && !response.ok())
      void response.text().then((text) => console.error("Chat rejected:", response.status(), text));
  });
  await page.goto(base);
  await page
    .getByRole("textbox", { name: "Message the AI" })
    .fill("Let's discuss the site. Remember the codename Copper Finch.");
  await page.getByRole("textbox", { name: "Message the AI" }).press("Enter");
  await page
    .getByText("We can discuss the site before building. I remember the codename Copper Finch.", {
      exact: true,
    })
    .waitFor();
  const [first] = (await snapshot()).apps;
  assert(first);
  const id = first.id;
  assert.equal(first.current, null, "Discussion must not generate a site");
  for (let i = 0; i < 30 && (await appById(id)).chatTitle !== "Agent fixture site"; i++)
    await page.waitForTimeout(100);
  assert.equal((await appById(id)).chatTitle, "Agent fixture site");
  assert(
    requests.some(
      (request) =>
        request.text?.format?.schema?.properties?.title && request.reasoning?.effort === "medium",
    ),
  );
  results.push(
    "New prompt creates a conversation and a medium-reasoning LLM title; ordinary questions stay conversational",
  );
  await page.reload();
  await page
    .getByText("We can discuss the site before building. I remember the codename Copper Finch.", {
      exact: true,
    })
    .waitFor();
  await page.getByRole("heading", { name: "Agent fixture site", exact: true }).waitFor();
  const dataBefore = (await appById(id)).data;
  await page
    .getByRole("textbox", { name: "Message the AI" })
    .fill("Build the Copper Finch site now.");
  await page.getByRole("textbox", { name: "Message the AI" }).press("Enter");
  await page.getByRole("button", { name: /^Working for / }).waitFor();
  await page
    .getByText("Copper Finch is built and running.", { exact: true })
    .waitFor({ timeout: 180000 });
  await page.getByRole("button", { name: "Stop generation" }).waitFor({ state: "hidden" });
  const worked = page.getByRole("button", { name: /^Worked for / }).last();
  await worked.waitFor();
  assert.equal(
    await worked.getAttribute("aria-expanded"),
    "false",
    "Finished activity collapses while the actual AI summary stays visible",
  );
  const historicalDuration = await worked.getAttribute("aria-label");
  const conversation = page.getByLabel("Conversation", { exact: true });
  assert.equal(await conversation.locator("strong").filter({ hasText: "Copper Finch" }).count(), 1);
  assert.equal(await conversation.getByRole("listitem").count(), 2);
  await conversation
    .getByRole("table")
    .getByRole("cell", { name: "Passed", exact: true })
    .waitFor();
  assert.equal(await conversation.locator("code").filter({ hasText: "cd80.ready()" }).count(), 1);
  await worked.click();
  assert.equal(await worked.getAttribute("aria-expanded"), "true");
  const activity = page.getByRole("button", { name: /^Tool activity:/ }).first();
  await activity.waitFor();
  assert.equal(await activity.getAttribute("aria-expanded"), "false");
  assert.equal(await activity.locator("svg.lucide-hammer").count(), 1);
  assert.equal(await page.getByRole("button", { name: /list files.*Done/ }).isVisible(), false);
  await activity.click();
  await page.getByRole("button", { name: /list files.*Done/ }).waitFor();
  await worked.click();
  assert.equal(await worked.getAttribute("aria-expanded"), "false");
  await page.locator('iframe[aria-busy="false"]').waitFor();
  await page.frameLocator("iframe").getByText("Copper Finch", { exact: true }).waitFor();
  const built = await appById(id);
  assert(built.current?.verification.passed);
  assert.equal(built.current.bundle.manifest.schemaVersion, 3);
  assert(built.current.bundle.files["src/App.tsx"]?.includes("CardContent"));
  assert(
    built.current.bundle.files["src/App.tsx"]?.includes("Built by real shell tools"),
    "Real Bun shell edits must be read back into the persisted release",
  );
  await page
    .frameLocator("iframe")
    .getByText("Built by real shell tools", { exact: true })
    .waitFor();
  assert(
    built.current.verification.checks.some(
      (check) => check.name === "Application build and checks" && check.passed,
    ),
  );
  assert.equal(await page.frameLocator("iframe").locator('[data-slot="card"]').count(), 1);
  assert.deepEqual(built.data, dataBefore, "Deployment preserves saved app data");
  const actualAnswer = built.conversation
    ?.at(-1)
    ?.parts.filter((part) => part.type === "text")
    .map((part) => part.content)
    .join("\n\n");
  assert(actualAnswer?.includes("**Copper Finch**"));
  await conversation.getByRole("button", { name: "Copy answer", exact: true }).last().click();
  await conversation.getByRole("button", { name: "Copied answer", exact: true }).waitFor();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    actualAnswer,
    "Copy preserves the actual model's raw Markdown, not rendered labels or tool activity",
  );
  results.push("Chrome copies the complete actual assistant Markdown answer to the clipboard");
  const toolParts =
    built.conversation
      ?.flatMap((message) => message.parts)
      .filter((part) => part.type === "tool-call") ?? [];
  for (const name of ["list_files", "write_file", "bash", "deploy_preview"])
    assert(
      toolParts.some((part) => part.type === "tool-call" && part.name === name),
      `Persist actual ${name} tool activity`,
    );
  assert(
    requests.some((request) =>
      JSON.stringify(request.input).includes("Remember the codename Copper Finch"),
    ),
    "Earlier turns are supplied to the model",
  );
  await page.screenshot({ path: ".local/agent-tests/conversation-built.png", fullPage: true });
  results.push(
    "Chrome chat streams actual model text and workspace tools, verifies source and automatically activates the rendered app",
  );
  assert(built.turns?.some((run) => run.status === "complete" && !!run.completedAt));
  results.push(
    "Live Working activity collapses to Worked with stored timing; final AI Markdown renders bold, lists, code and tables",
  );
  const activeRelease = built.current.id;
  const broken = await turn(id, "Stage a broken change and check it.");
  assert(broken.ok);
  const brokenEvents = await broken.text();
  assert(brokenEvents.includes("TOOL_CALL"));
  assert(brokenEvents.includes("Your working site is unchanged"));
  assert.equal((await appById(id)).current?.id, activeRelease);
  results.push("Invalid staged source fails verification without replacing the active app");
  const crossOrigin = await turn(id, "Hello", { origin: "https://untrusted.invalid" });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await turn(crypto.randomUUID(), "Hello")).status, 400);
  results.push("Chat rejects foreign origins and unknown application IDs");
  await stop();
  await start();
  const persisted = await appById(id);
  assert.equal(persisted.current?.id, activeRelease);
  assert(JSON.stringify(persisted.conversation).includes("Copper Finch"));
  await page.reload();
  await page
    .getByText("The change failed verification. Your working site is unchanged.", { exact: true })
    .waitFor();
  await page.getByRole("heading", { name: "Agent fixture site", exact: true }).waitFor();
  assert(historicalDuration);
  await page.getByRole("button", { name: historicalDuration, exact: true }).first().waitFor();
  assert.deepEqual(
    persisted.turns?.filter((run) => built.turns?.some((earlier) => earlier.id === run.id)),
    built.turns,
    "Historical completed durations survive restart",
  );
  await page.screenshot({ path: ".local/agent-tests/conversation-restored.png", fullPage: true });
  results.push("Complete conversation and tool activity survive browser reload and Node restart");
  await page
    .getByRole("textbox", { name: "Message the AI" })
    .fill("Start a slow turn so I can stop it.");
  await page.getByRole("textbox", { name: "Message the AI" }).press("Enter");
  await page
    .getByRole("button", { name: /^Tool activity:/ })
    .last()
    .waitFor();
  await page.getByRole("button", { name: "Stop generation" }).click();
  await page.waitForTimeout(1600);
  assert.equal(
    (await appById(id)).current?.id,
    activeRelease,
    "A stopped turn cannot replace the active release",
  );
  assert.equal(await page.getByRole("button", { name: "Stop generation" }).count(), 0);
  await page.getByRole("button", { name: /^Stopped for / }).waitFor();
  results.push("Chrome Stop cancels the active stream without late activation");
  await page
    .getByRole("textbox", { name: "Message the AI" })
    .fill("Start a slow turn for steering.");
  await page.getByRole("textbox", { name: "Message the AI" }).press("Enter");
  await page
    .getByRole("button", { name: /^Tool activity:/ })
    .last()
    .waitFor();
  await page
    .getByRole("textbox", { name: "Message the AI" })
    .fill("Steer to discussing Copper Finch. Do not change files.");
  await page.getByRole("textbox", { name: "Message the AI" }).press("Enter");
  await page
    .getByText("Steering received. We will discuss Copper Finch without changing its files.", {
      exact: true,
    })
    .waitFor();
  assert.equal((await appById(id)).current?.id, activeRelease);
  assert.equal((await appById(id)).agentTurn?.status, "complete");
  results.push(
    "A new message interrupts the active run and continues with its conversation and workspace",
  );
  const registration = await fetch(`${base}/api/plugins`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({
      name: "Weather fixture",
      document: JSON.stringify({
        openapi: "3.0.3",
        info: { title: "Weather fixture", version: "1" },
        servers: [{ url: `http://127.0.0.1:${fixturePort}` }],
        paths: {
          "/weather": {
            get: {
              operationId: "getWeather",
              parameters: [
                { name: "city", in: "query", required: true, schema: { type: "string" } },
              ],
              responses: { "200": { description: "Current weather" } },
            },
          },
        },
      }),
    }),
  });
  assert(registration.ok, await registration.clone().text());
  const registered = (await registration.json()) as { plugin: { id: string } };
  registeredPluginId = registered.plugin.id;
  pluginManifest = (await appById(id)).current!.bundle.manifest;
  await page
    .getByRole("textbox", { name: "Message the AI" })
    .fill("Connect the registered weather plugin and display London weather.");
  await page.getByRole("textbox", { name: "Message the AI" }).press("Enter");
  await page
    .getByText("The site now displays London weather from the registered plugin.", { exact: true })
    .waitFor({ timeout: 180000 });
  await page.locator('iframe[aria-busy="false"]').waitFor();
  await page.frameLocator("iframe").getByText("21°C in London", { exact: true }).waitFor();
  const connected = await appById(id);
  assert(connected.enabledPlugins?.includes(registeredPluginId));
  assert(connected.current?.bundle.manifest.permissions.includes("plugin.call"));
  assert(connected.current?.verification.passed);
  assert(
    providerCities.filter((city) => city === "London").length >= 2,
    "The agent tool and generated app both call the registered provider",
  );
  assert(
    connected.conversation
      ?.flatMap((message) => message.parts)
      .some((part) => part.type === "tool-call" && part.name === "list_plugins"),
  );
  await page.screenshot({ path: ".local/agent-tests/plugin-connected.png", fullPage: true });
  results.push(
    "System registration feeds agent discovery and tools; the verified generated site reads live provider data through plugin.call",
  );
  await page.getByRole("textbox", { name: "Message the AI" }).fill("Complete 21 tool rounds.");
  await page.getByRole("textbox", { name: "Message the AI" }).press("Enter");
  await page
    .getByText("All 21 tool rounds completed.", { exact: true })
    .waitFor({ timeout: 60000 });
  const longTurn = (await appById(id)).conversation?.slice(-1)[0];
  assert.equal(longTurn?.role, "assistant");
  assert.equal((await appById(id)).agentTurn?.status, "complete");
  results.push("The agent completes 21 tool rounds without an overall iteration cap");
  assert.deepEqual(browserErrors, []);
  console.log(results.map((result) => `PASS ${result}`).join("\n"));
  console.log(
    `${results.length} agent integration flows passed. Fixture verifies transport, not live inference.`,
  );
} finally {
  await writeFile(
    ".local/agent-tests/results.json",
    JSON.stringify({ results, browserErrors, modelRequests: requests.length }, null, 2),
  );
  await browser?.close();
  await stop();
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
  await rm(dataDir, { recursive: true, force: true });
}
