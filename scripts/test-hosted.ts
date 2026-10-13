import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { protocols } from "../apps/web/src/lib/contracts";
import { sampleBundle } from "../apps/web/src/lib/samples";
import { platformRoot } from "./environment";

const base = process.argv[2];
if (!base || !base.startsWith("https://")) throw new Error("Pass the deployed HTTPS URL");
const endpoint = new URL("/api/platform", base).href;
const checks: { name: string; detail?: unknown }[] = [];
async function request(body?: unknown, ok = true): Promise<any> {
  const response = await fetch(endpoint, {
    ...(body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  assert.equal(response.ok, ok, JSON.stringify(data).slice(0, 1000));
  return data;
}
function pass(name: string, detail?: unknown) {
  checks.push({ name, ...(detail ? { detail } : {}) });
  console.log("PASS " + name + (detail ? ": " + JSON.stringify(detail) : ""));
}
const snapshot = await request();
assert.equal(snapshot.status.local, false);
assert.equal(snapshot.status.demo, true);
assert.equal(snapshot.status.runtime, "Cloudflare Worker Loader");
assert.ok(snapshot.apps.length >= 4);
pass("Anonymous shared studio reads the live Convex workspace");
for (const protocol of protocols) {
  const app = snapshot.apps.find((app: any) => app.current && app.spec.protocol === protocol.id);
  assert.ok(app);
  const actual = await request({
    action: "rpc",
    appId: app.id,
    releaseId: app.current.id,
    capability: "finance.calculate",
    input: protocol.fixture.input,
  });
  for (const [key, value] of Object.entries(protocol.fixture.expected))
    if (typeof value === "number") assert.ok(Math.abs(actual[key] - value) < 1e-6);
    else assert.deepEqual(actual[key], value);
  pass("Hosted numerical fixture: " + protocol.id);
}
const spec = { ...protocols[0]!.defaultSpec, name: "Hosted verification desk" };
const draft = snapshot.apps.find((row: any) => row.name === spec.name);
let app = draft
  ? await request({ action: "import", appId: draft.id, spec, bundle: sampleBundle(spec) })
  : await request({ action: "create", spec, mode: "sample" });
assert.equal(app.current?.id ?? null, draft?.current?.id ?? null);
assert.equal(app.preview.verification.passed, true);
pass("Hosted creation or import verifies a preview before replacing a release");
const rpc = (releaseId: string, capability: string, input: unknown, ok = true) =>
  request({ action: "rpc", appId: app.id, releaseId, capability, input }, ok);
await rpc(app.preview.id, "storage.write", { key: "testNote", value: "preview" }, false);
pass("Preview storage is read-only");
app = await request({ action: "accept", appId: app.id, releaseId: app.preview.id });
const first = app.current.id;
const inputs = { ...app.data.inputs, cash: 12345 };
await rpc(first, "storage.write", { key: "inputs", value: inputs });
app = await request({
  action: "update",
  appId: app.id,
  mode: "sample",
  request: "Test update review",
});
assert.equal(app.current.id, first);
assert.deepEqual(app.data.inputs, inputs);
assert.ok((await rpc(first, "finance.calculate", inputs)).totalValue > 0);
app = await request({ action: "accept", appId: app.id, releaseId: app.preview.id });
assert.notEqual(app.current.id, first);
assert.deepEqual(app.data.inputs, inputs);
pass("Verified update keeps the working release and retains Convex inputs after acceptance");

const a = sampleBundle(spec);
a.files["calculations.js"] = a.files["calculations.js"].replace(
  "return {totalValue,",
  "return {runtimeVersion:'A',totalValue,",
);
app = await request({ action: "import", appId: app.id, bundle: a });
assert.equal(app.preview.verification.passed, true);
app = await request({ action: "accept", appId: app.id, releaseId: app.preview.id });
const versionA = app.current.id;
const b = sampleBundle(spec);
b.files["calculations.js"] = b.files["calculations.js"]
  .replace(
    "export function analyze(d) {",
    "export function analyze(d) { if(d.__probe==='egress') return fetch('https://example.com').then(r=>({status:r.status})); if(d.__probe==='cpu') while(true){}",
  )
  .replace("return {totalValue,", "return {runtimeVersion:'B',totalValue,");
app = await request({ action: "import", appId: app.id, bundle: b });
assert.equal(app.preview.verification.passed, true);
const versionB = app.preview.id;
assert.equal((await rpc(versionA, "finance.calculate", inputs)).runtimeVersion, "A");
assert.equal((await rpc(versionB, "finance.calculate", inputs)).runtimeVersion, "B");
pass("Distinct source hashes execute separate current and preview code");
const denied = await rpc(versionB, "finance.calculate", { __probe: "egress" }, false);
assert.match(denied.error, /network|outbound|not allowed|fetch|internet|disabled/i);
pass("Generated calculation cannot make an outbound request", { error: denied.error });
const started = Date.now();
const limited = await rpc(versionB, "finance.calculate", { __probe: "cpu" }, false);
assert.match(limited.error, /CPU|resource/i);
pass("Infinite calculation is rejected by hosted CPU enforcement", {
  error: limited.error,
  roundTripMs: Date.now() - started,
});
assert.equal((await rpc(versionB, "finance.calculate", inputs)).runtimeVersion, "B");
pass("Normal calculation succeeds after the resource-limit failure");
app = await request({ action: "discard", appId: app.id, releaseId: versionB });
const broken = sampleBundle(spec);
broken.files["calculations.js"] =
  "export function analyze(){return {totalValue:0,profit:0,returnPct:0,concentrationPct:0};}";
app = await request({ action: "import", appId: app.id, bundle: broken });
assert.equal(app.preview.verification.passed, false);
await request({ action: "accept", appId: app.id, releaseId: app.preview.id }, false);
assert.equal(app.current.id, versionA);
pass("Incorrect imported financial logic cannot replace a working release");
const clean = sampleBundle(spec);
clean.files["app.js"] +=
  "\ndocument.getElementById('chart-title').textContent='Hosted source import verified';";
app = await request({ action: "import", appId: app.id, bundle: clean });
assert.equal(app.preview.verification.passed, true);
app = await request({ action: "accept", appId: app.id, releaseId: app.preview.id });
assert.equal(app.current.origin, "import");
assert.deepEqual(app.data.inputs, inputs);
pass("External app source is verified, accepted and persisted with its data");
await rpc(app.current.id, "secrets.read", {}, false);
const crossOrigin = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json", origin: "https://outside.invalid" },
  body: JSON.stringify({ action: "seed" }),
});
assert.equal(crossOrigin.status, 403);
pass("Undeclared capabilities and cross-origin writes are rejected");
const refreshed = await request();
const persisted = refreshed.apps.find((row: any) => row.id === app.id);
assert.equal(persisted.current.id, app.current.id);
assert.deepEqual(persisted.data.inputs, inputs);
const docs = await fetch(new URL("/api/docs", base));
assert.equal(((await docs.json()) as { version: number }).version, 2);
pass("Release and inputs survive a new hosted request; public contract docs are available");
mkdirSync(resolve(platformRoot, ".local"), { recursive: true });
writeFileSync(
  resolve(platformRoot, ".local/hosted-evidence.json"),
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      base,
      appId: app.id,
      checks,
    },
    null,
    2,
  ),
);
console.log(`${checks.length} live hosted checks passed. Verification app: ${app.id}`);
