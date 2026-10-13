/// <reference lib="dom" />
// Run after bun run build. Exercises the built Node registration API and server-side
// plugin execution against an isolated HTTP provider, without external API calls.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callPlugin } from "../apps/web/src/server/plugins";
import type { RegisteredPlugin } from "../apps/web/src/lib/plugins";
import { protocols, type Application } from "../apps/web/src/lib/contracts";
import { sampleBundle } from "../apps/web/src/lib/samples";
import { saveApp } from "../apps/web/src/server/repository";

const base = "http://127.0.0.1:3006";
const dataDir = await mkdtemp(join(tmpdir(), "cd80-plugins-"));
const credential = "plugin-test-secret";
const results: string[] = [];
let observedCredential = "";
let weatherWrites = 0;
let server: ChildProcess | undefined;
let log = "";
const fixture = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  response.setHeader("content-type", "application/json");
  if (url.pathname === "/schema") response.end(JSON.stringify(document));
  else if (url.pathname === "/redirect") {
    response.statusCode = 302;
    response.setHeader("location", "http://127.0.0.1:9/private");
    response.end();
  } else if (url.pathname === "/weather") {
    if (request.method === "POST") weatherWrites++;
    const key = request.headers["x-api-key"];
    observedCredential = typeof key === "string" ? key : "";
    response.end(
      JSON.stringify({
        city: url.searchParams.get("city"),
        temperature: 21,
        echo: observedCredential,
      }),
    );
  } else {
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "Unknown fixture operation" }));
  }
});
await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
const fixtureOrigin = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}`;
const document = {
  openapi: "3.0.3",
  info: { title: "Weather fixture", version: "1" },
  servers: [{ url: fixtureOrigin }],
  components: { securitySchemes: { key: { type: "apiKey", in: "header", name: "x-api-key" } } },
  security: [{ key: [] }],
  paths: {
    "/weather": {
      get: {
        operationId: "getWeather",
        parameters: [{ name: "city", in: "query", required: true, schema: { type: "string" } }],
      },
      post: {
        operationId: "updateWeather",
        parameters: [{ name: "city", in: "query", required: true, schema: { type: "string" } }],
      },
    },
  },
};
const config = {
  HOST: "127.0.0.1",
  PORT: "3006",
  CD80_LOCAL_MODE: "1",
  CD80_DATA_DIR: dataDir,
  CD80_PLUGIN_TEST_ORIGIN: fixtureOrigin,
  CD80_PLUGIN_TEST_KEY: credential,
  MODEL_PROVIDER: "openai",
  OPENAI_API_KEY: "",
  GLM_API_KEY: "",
};
const previous = new Map(Object.keys(config).map((key) => [key, process.env[key]]));
Object.assign(process.env, config);
const access = { ownerId: "local-prototype-owner", accessToken: null };
async function start() {
  server = spawn("node", ["apps/web/server/node-entry.mjs"], {
    env: config,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  server.stderr?.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error("Isolated Node server exited before readiness");
    try {
      if ((await fetch(base + "/api/plugins")).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Isolated Node server did not become ready");
}
async function stop() {
  const child = server;
  server = undefined;
  if (!child || child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
  });
}
async function register(body: unknown, origin = base) {
  return fetch(base + "/api/plugins", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function registry() {
  const response = await fetch(base + "/api/plugins");
  assert.equal(response.status, 200);
  return (await response.json()) as { plugins: RegisteredPlugin[] };
}
try {
  await start();
  const response = await register({
    name: "Weather",
    document: JSON.stringify(document),
    credentialEnv: "CD80_PLUGIN_TEST_KEY",
  });
  assert.equal(response.status, 200, await response.clone().text());
  const registered = (await response.json()) as { plugin: RegisteredPlugin };
  const plugin = registered.plugin;
  assert.equal(plugin.operations[0]?.operationId, "getWeather");
  const metadata = await registry();
  assert.equal(metadata.plugins.length, 1);
  assert(!JSON.stringify(metadata).includes(credential));
  assert(!JSON.stringify(metadata).includes("CD80_PLUGIN_TEST_KEY"));
  results.push("HTTP registration and sanitized owned registry metadata");

  const weather = await callPlugin(access, plugin.id, "getWeather", { city: "London" });
  assert.equal(observedCredential, credential);
  assert.deepEqual(weather, { city: "London", temperature: 21, echo: "[redacted]" });
  results.push(
    "Registered operation fetches provider data with server credentials and redacts echoed secrets",
  );

  const spec = protocols[0]!.defaultSpec;
  const bundle = sampleBundle(spec);
  bundle.manifest.permissions.push("plugin.call");
  const imported = await fetch(base + "/api/platform", {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ action: "import", bundle, spec }),
  });
  assert.equal(imported.status, 200, await imported.clone().text());
  const app = (await imported.json()) as Application;
  assert(app.current?.verification.passed);
  app.enabledPlugins = [plugin.id];
  await saveApp(access, app, app.revision);
  async function pluginRpc(operationId: string, readOnly?: boolean) {
    return fetch(base + "/api/platform", {
      method: "POST",
      headers: { origin: base, "content-type": "application/json" },
      body: JSON.stringify({
        action: "rpc",
        appId: app.id,
        releaseId: app.current!.id,
        capability: "plugin.call",
        input: { pluginId: plugin.id, operationId, parameters: { city: "London" }, readOnly },
      }),
    });
  }
  const deniedWrite = await pluginRpc("updateWeather", true);
  assert.equal(deniedWrite.status, 400);
  assert.match(await deniedWrite.text(), /queries require a GET or HEAD/);
  assert.equal(weatherWrites, 0, "Read-only queries must not reach a write operation");
  const explicitWrite = await pluginRpc("updateWeather");
  assert.equal(explicitWrite.status, 200, await explicitWrite.clone().text());
  assert.equal(weatherWrites, 1);
  const readOnlyGet = await pluginRpc("getWeather", true);
  assert.equal(readOnlyGet.status, 200, await readOnlyGet.clone().text());
  assert.deepEqual(await readOnlyGet.json(), {
    city: "London",
    temperature: 21,
    echo: "[redacted]",
  });
  assert.equal(weatherWrites, 1);
  results.push(
    "HTTP read-only plugin queries reject POST before provider dispatch; explicit POST and read-only GET work",
  );

  await assert.rejects(callPlugin(access, plugin.id, "getWeather", {}), /Missing plugin parameter/);
  await assert.rejects(
    callPlugin(access, plugin.id, "getWeather", { city: "London", arbitrary: true }),
    /Unknown plugin parameter/,
  );
  await assert.rejects(callPlugin(access, plugin.id, "unknown", { city: "London" }), /not found/);
  await assert.rejects(
    callPlugin({ ownerId: "another-owner", accessToken: null }, plugin.id, "getWeather", {
      city: "London",
    }),
    /not found/,
  );
  results.push("Required parameters, registered operation boundaries, and owner access enforced");

  assert.equal(
    (
      await register(
        {
          name: "Cross origin",
          document: JSON.stringify(document),
          credentialEnv: "CD80_PLUGIN_TEST_KEY",
        },
        "https://example.invalid",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await register({
        name: "Private URL",
        document: JSON.stringify({ ...document, servers: [{ url: "https://127.0.0.1/private" }] }),
        credentialEnv: "CD80_PLUGIN_TEST_KEY",
      })
    ).status,
    400,
  );
  assert.equal(
    (await register({ name: "Private schema", schemaUrl: "https://127.0.0.1/schema" })).status,
    400,
  );
  assert.equal(
    (
      await register({
        name: "External ref",
        document: JSON.stringify({
          ...document,
          paths: { "/weather": { $ref: "https://example.invalid/path" } },
        }),
        credentialEnv: "CD80_PLUGIN_TEST_KEY",
      })
    ).status,
    400,
  );
  assert.equal(
    (await register({ name: "Redirect", schemaUrl: fixtureOrigin + "/redirect" })).status,
    400,
  );
  assert.equal(
    (
      await register({
        name: "Unrelated credential",
        document: JSON.stringify(document),
        credentialEnv: "OPENAI_API_KEY",
      })
    ).status,
    400,
  );
  assert.equal((await registry()).plugins.length, 1);
  results.push(
    "Cross-origin registration, private networks, external refs, redirects, and unrelated system keys rejected",
  );

  const fromUrl = await register({
    name: "Weather URL",
    schemaUrl: fixtureOrigin + "/schema",
    credentialEnv: "CD80_PLUGIN_TEST_KEY",
  });
  assert.equal(fromUrl.status, 200);
  await stop();
  await start();
  assert.equal((await registry()).plugins.length, 2);
  assert.deepEqual(await callPlugin(access, plugin.id, "getWeather", { city: "Paris" }), {
    city: "Paris",
    temperature: 21,
    echo: "[redacted]",
  });
  results.push("Schema URL registration and registry persistence across Node server restart");

  await mkdir(".local/plugin-tests", { recursive: true });
  await writeFile(".local/plugin-tests/results.json", JSON.stringify({ results }, null, 2));
  console.log(`Plugin integration: ${results.length} flows passed`);
} catch (error) {
  // Isolated server has no real credentials; still redact the fixture credential in diagnostics.
  console.error(log.replaceAll(credential, "[redacted]").slice(-4000));
  throw error;
} finally {
  await stop();
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
  await rm(dataDir, { recursive: true, force: true });
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
