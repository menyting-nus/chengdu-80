import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { protocols } from "../apps/web/src/lib/contracts";
import { sampleBundle } from "../apps/web/src/lib/samples";

const dir = await mkdtemp(join(tmpdir(), "chengdu80-flow-"));
const port = "3011",
  endpoint = `http://127.0.0.1:${port}/api/platform`;
const server = spawn("bun", ["run", "dev:local"], {
  env: { ...process.env, CD80_PORT: port, CD80_DATA_DIR: dir },
  stdio: "ignore",
  detached: true,
});
let passed = 0;
async function request(body?: unknown, ok = true): Promise<any> {
  const r = await fetch(
    endpoint,
    body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const data = await r.json();
  assert.equal(r.ok, ok, JSON.stringify(data).slice(0, 1000));
  return data;
}
function pass(name: string) {
  passed++;
  console.log("PASS " + name);
}
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      await request();
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  assert.ok(ready, "Test server failed to start");
  const spec = { ...protocols[0]!.defaultSpec, name: "Lifecycle test" };
  let app = await request({ action: "create", spec, mode: "sample" });
  assert.ok(app.current?.verification.passed);
  assert.equal(app.preview, null);
  const first = app.current.id;
  await request({
    action: "rpc",
    appId: app.id,
    releaseId: first,
    capability: "storage.write",
    input: { key: "note", value: "active" },
  });
  pass("Verified generation activates immediately and can save data");
  const inputs = { ...app.data.inputs, cash: 12345 };
  await request({
    action: "rpc",
    appId: app.id,
    releaseId: first,
    capability: "storage.write",
    input: { key: "inputs", value: inputs },
  });
  app = await request({
    action: "update",
    appId: app.id,
    request: "Improve the explanation layout",
    mode: "sample",
  });
  assert.notEqual(app.current.id, first);
  assert.equal(app.preview, null);
  assert.deepEqual(app.data.inputs, inputs);
  assert.equal(app.history[0].id, first);
  pass("Verified update activates atomically and retains data and previous source");
  const result = await request({
    action: "rpc",
    appId: app.id,
    releaseId: app.current.id,
    capability: "finance.calculate",
    input: inputs,
  });
  assert.ok(result.totalValue > 0);
  pass("Updated app remains executable");
  const provenance = await request({
    action: "rpc",
    appId: app.id,
    releaseId: app.current.id,
    capability: "storage.read",
    input: { key: "_provenance" },
  });
  assert.equal(provenance.provider, "User-entered inputs");
  await request(
    {
      action: "rpc",
      appId: app.id,
      releaseId: app.current.id,
      capability: "storage.write",
      input: { key: "_provenance", value: { synthetic: false, provider: "Fabricated provider" } },
    },
    false,
  );
  pass("Input edits reset provenance and app code cannot falsify platform metadata");
  const goodId = app.current.id;
  const broken = sampleBundle(spec);
  broken.files["calculations.js"] =
    "export function analyze(){return {totalValue:0,profit:0,returnPct:0,concentrationPct:0};}";
  app = await request({ action: "import", appId: app.id, bundle: broken });
  assert.equal(app.preview.verification.passed, false);
  const failedPreviewId = app.preview.id;
  await request(
    {
      action: "rpc",
      appId: app.id,
      releaseId: failedPreviewId,
      capability: "storage.write",
      input: { key: "note", value: "bad" },
    },
    false,
  );
  pass("Failed source cannot write to shared storage");
  app = await request({ action: "reverify", appId: app.id, releaseId: failedPreviewId });
  assert.equal(app.preview.id, failedPreviewId);
  assert.equal(app.preview.verification.passed, false);
  assert.equal(app.current.id, goodId);
  assert.deepEqual(app.data.inputs, inputs);
  await request({ action: "reverify", appId: app.id, releaseId: "stale-preview" }, false);
  pass(
    "Reverification cannot approve wrong source or a stale preview and preserves the release and data",
  );
  await request({ action: "accept", appId: app.id, releaseId: app.preview.id }, false);
  assert.equal(app.current.id, goodId);
  pass("Incorrect imported calculations block acceptance and preserve working release");
  const custom = sampleBundle(spec);
  custom.files["app.js"] +=
    "\ndocument.getElementById('chart-title').textContent='Imported custom portfolio view';";
  app = await request({ action: "import", appId: app.id, bundle: custom });
  assert.equal(app.current.origin, "import");
  assert.equal(app.current.verification.passed, true);
  assert.equal(app.preview, null);
  assert.ok(app.current.bundle.files["app.js"].includes("Imported custom portfolio view"));
  assert.deepEqual(app.data.inputs, inputs);
  pass("External source import verifies, releases, and retains app data");
  await request(
    {
      action: "rpc",
      appId: app.id,
      releaseId: app.current.id,
      capability: "secrets.read",
      input: {},
    },
    false,
  );
  await request(
    {
      action: "rpc",
      appId: "unknown-app",
      releaseId: app.current.id,
      capability: "storage.read",
      input: { key: "inputs" },
    },
    false,
  );
  pass("Undeclared capability and unknown app access fail closed");
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://outside.invalid" },
    body: JSON.stringify({ action: "seed" }),
  });
  assert.equal(r.status, 403);
  await request({ action: "clarify", prompt: "Automatically buy stocks and place orders" }, false);
  pass("Cross-origin writes and unsupported execution requests are rejected");
  const docs = await fetch(`http://127.0.0.1:${port}/api/docs`);
  assert.ok(docs.ok);
  assert.equal(((await docs.json()) as { version: number }).version, 2);
  pass("Public source contract and protocol documentation are available");
  console.log(`${passed} release-lifecycle integration checks passed.`);
} finally {
  if (server.pid) process.kill(-server.pid, "SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  await rm(dir, { recursive: true, force: true });
}
