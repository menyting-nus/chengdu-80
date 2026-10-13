import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  protocols,
  bundleSchema,
  type AppBundle,
  type Application,
} from "../apps/web/src/lib/contracts";
import { calculate } from "../apps/web/src/lib/finance";
import { sampleBundle } from "../apps/web/src/lib/samples";
import { inspectSource, sourceHash, verify } from "../apps/web/src/server/runtime";
import { event, findApp, listApps, saveApp } from "../apps/web/src/server/repository";

process.env.CD80_LOCAL_MODE = "1";
const dir = await mkdtemp(join(tmpdir(), "chengdu80-tests-"));
process.env.CD80_DATA_DIR = dir;
let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}
try {
  await test("Release hashes survive storage key ordering and detect changed source", async () => {
    const original = sampleBundle(protocols[0]!.defaultSpec);
    const stored = {
      files: Object.fromEntries(Object.entries(original.files).reverse()),
      manifest: {
        permissions: original.manifest.permissions,
        protocol: original.manifest.protocol,
        name: original.manifest.name,
        schemaVersion: original.manifest.schemaVersion,
      },
    };
    assert.deepEqual(stored, original);
    assert.equal(await sourceHash(stored), await sourceHash(original));
    const changed = structuredClone(original);
    changed.files["src/App.tsx"] += "\n// changed source";
    assert.notEqual(await sourceHash(changed), await sourceHash(original));
  });
  for (const p of protocols)
    await test(`${p.id}: React sample compiles and fixed platform math matches numerical fixtures`, async () => {
      const report = await verify(sampleBundle(p.defaultSpec), p.defaultSpec);
      assert.equal(report.passed, true, JSON.stringify(report.checks.filter((c) => !c.passed)));
      const actual = calculate(p.id, p.fixture.input);
      for (const [key, value] of Object.entries(p.fixture.expected))
        if (typeof value === "number") assert.ok(Math.abs((actual[key] as number) - value) < 1e-6);
        else assert.deepEqual(actual[key], value);
    });
  await test("Source imports reject path traversal and unrecognized files", () => {
    const b = sampleBundle(protocols[0]!.defaultSpec);
    assert.equal(
      bundleSchema.safeParse({ ...b, files: { ...b.files, "../secret.env": "oops" } }).success,
      false,
    );
  });
  await test("Embedded secret strings fail closed", () => {
    for (const mutate of [
      (b: AppBundle) =>
        (b.files["src/App.tsx"] += '\nconst api_key="sk-123456789012345678901234567890";'),
    ]) {
      const b = sampleBundle(protocols[0]!.defaultSpec);
      mutate(b);
      assert.ok(inspectSource(b, protocols[0]!.defaultSpec).some((c) => !c.passed));
    }
  });
  await test("Non-finite financial results are rejected by fixed platform calculations", () => {
    assert.throws(
      () =>
        calculate("portfolio", {
          holdings: [{ symbol: "AAA", units: 1e308, price: 1e308, cost: 1 }],
          cash: 0,
        }),
      /numerical range/,
    );
    assert.throws(
      () => calculate("strategy", { prices: [Number.MIN_VALUE, 1e308], feeBps: 0 }),
      /numerical range/,
    );
  });
  await test("Account ownership, durable storage, and optimistic updates", async () => {
    const owner = { ownerId: "test-owner", accessToken: null };
    const app: Application = {
      id: "test-app",
      ownerId: owner.ownerId,
      revision: 0,
      name: protocols[0]!.defaultSpec.name,
      spec: protocols[0]!.defaultSpec,
      current: null,
      preview: null,
      data: { inputs: { cash: 10 } },
      history: [],
      events: [],
      createdAt: new Date().toISOString(),
    };
    await saveApp(owner, app, null);
    assert.equal((await listApps(owner)).length, 1);
    assert.equal((await listApps({ ownerId: "another-owner", accessToken: null })).length, 0);
    await assert.rejects(findApp({ ownerId: "another-owner", accessToken: null }, app.id));
    const next = await findApp(owner, app.id);
    event(next, "Test update");
    await saveApp(owner, next, next.revision);
    await assert.rejects(saveApp(owner, app, 1), /changed/);
    assert.deepEqual((await findApp(owner, app.id)).data, { inputs: { cash: 10 } });
  });
  console.log(`${passed} meaningful prototype checks passed.`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
