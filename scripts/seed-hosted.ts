import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/backend/convex/_generated/api";
import type { Application } from "../apps/web/src/lib/contracts";
import { sourceHash, verify } from "../apps/web/src/server/runtime";
import { configuredEnvironment, platformRoot } from "./environment";

const env = configuredEnvironment();
if (!env.CONVEX_DEPLOY_KEY?.startsWith("dev:"))
  throw new Error("Demo seeding requires a development deployment key");
if (!env.VITE_CONVEX_URL || !env.PLATFORM_INTERNAL_KEY)
  throw new Error("Convex URL and internal server key are required");
const client = new ConvexHttpClient(env.VITE_CONVEX_URL, { logger: false });
const serverKey = env.PLATFORM_INTERNAL_KEY;
const ownerId = "shared-prototype-owner";
const rows: Application[] = await client.action(api.platform.listDemo, { serverKey });
console.log("PASS live Convex shared-workspace read");
await assert.rejects(
  () => client.action(api.platform.listDemo, { serverKey: "invalid-key" }),
  /Trusted platform server required/,
);
await assert.rejects(() => client.query(api.platform.list, {}), /Authentication required/);
console.log("PASS live Convex rejects untrusted and unauthenticated reads");

// Only copy the four public-data examples prepared for this prototype. Never
// copy other local applications or replace an existing hosted user's changes.
const exampleIds = new Set([
  "66e30f1b-98cc-4660-b5e4-59945bd3cc54",
  "5425e545-4ba2-4527-a88e-06726f88c8fe",
  "adbad0ae-75da-402d-8c2b-c4a9ab9c5c97",
  "908df993-ab89-4118-94ca-109934060044",
]);
const examples: Application[] = JSON.parse(
  readFileSync(resolve(platformRoot, ".local/apps.json"), "utf8"),
);
for (const example of examples.filter((app) => exampleIds.has(app.id))) {
  const id = "demo-" + example.id;
  if (rows.some((app) => app.id === id)) {
    console.log("KEEP hosted example: " + example.name);
    continue;
  }
  assert.ok(example.current?.verification.passed, "Example must have a verified release");
  const canonicalHash = await sourceHash(example.current.bundle);
  const legacyHash = createHash("sha256")
    .update(JSON.stringify(example.current.bundle))
    .digest("hex");
  assert.ok(
    [canonicalHash, legacyHash].includes(example.current.verification.sourceHash),
    "Example source must match its verified release",
  );
  // Recheck older examples before moving their source to the canonical hash.
  // Hosted execution is tested separately after deployment.
  const previousLocalMode = process.env.CD80_LOCAL_MODE;
  process.env.CD80_LOCAL_MODE = "1";
  let verification;
  try {
    verification = await verify(example.current.bundle, example.current.spec);
  } finally {
    if (previousLocalMode === undefined) delete process.env.CD80_LOCAL_MODE;
    else process.env.CD80_LOCAL_MODE = previousLocalMode;
  }
  assert.ok(verification.passed, "Example must pass current release checks");
  const app: Application = {
    ...structuredClone(example),
    id,
    ownerId,
    revision: 0,
    preview: null,
    events: [
      {
        at: new Date().toISOString(),
        message: "Copied verified local example into the hosted shared demo workspace.",
      },
      ...example.events,
    ].slice(0, 50),
  };
  app.current!.verification = verification;
  await assert.rejects(
    () =>
      client.action(api.platform.saveDemo, {
        app: { ...app, ownerId: "another-owner" },
        expectedRevision: null,
        serverKey,
      }),
    /Invalid demo ownership/,
  );
  const saved: Application = await client.action(api.platform.saveDemo, {
    app,
    expectedRevision: null,
    serverKey,
  });
  assert.equal(saved.revision, 1);
  await assert.rejects(
    () => client.action(api.platform.saveDemo, { app, expectedRevision: null, serverKey }),
    /Application changed/,
  );
  const refreshed: Application[] = await client.action(api.platform.listDemo, { serverKey });
  const persisted = refreshed.find((row) => row.id === id);
  assert.deepEqual(persisted?.data, app.data);
  assert.equal(persisted?.current?.verification.sourceHash, app.current?.verification.sourceHash);
  console.log("PASS live Convex create, read-back, ownership and duplicate guard: " + app.name);
}
console.log(
  "Convex persistence verified. Hosted application execution is a separate Cloudflare check.",
);
