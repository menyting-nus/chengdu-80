/// <reference lib="dom" />
// Failure modes: broken TSX/types or forbidden imports activate; nested modules do
// not resolve; supplied shadcn styles/SDK fail at runtime; readonly viewer mutates
// source; failed updates lose data; iframe bypasses its network boundary.
// Browser smoke checks are separate from published protocol verification.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { protocols, type Application, type AppBundle } from "../apps/web/src/lib/contracts";
import { tsxStarter } from "../apps/web/src/lib/tsx-starter";

const dataDir = await mkdtemp(join(tmpdir(), "cd80-tsx-test-"));
const base = "http://127.0.0.1:3008";
const artifacts = ".local/tsx-tests";
const server = spawn("node", ["apps/web/server/node-entry.mjs"], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: "3008",
    CD80_LOCAL_MODE: "1",
    CD80_DATA_DIR: dataDir,
    OPENAI_API_KEY: "",
    GLM_API_KEY: "",
    MODEL_PROVIDER: "openai",
  },
  stdio: "ignore",
});
const results: string[] = [];
const pageErrors: string[] = [],
  externalRequests: string[] = [];
let completed = false;
let browser: Browser | undefined;
async function request<T>(body?: unknown): Promise<T> {
  const response = await fetch(
    `${base}/api/platform`,
    body
      ? {
          method: "POST",
          headers: { "content-type": "application/json", origin: base },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const result: unknown = await response.json();
  assert(response.ok, JSON.stringify(result).slice(0, 1200));
  return result as T;
}
function pass(description: string) {
  results.push(description);
  console.log(`PASS ${description}`);
}
try {
  await mkdir(artifacts, { recursive: true });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${base}/api/platform`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(ready, "Isolated test server did not start");
  const spec = { ...protocols[0]!.defaultSpec, name: "React portfolio fixture" };
  const bundle: AppBundle = tsxStarter(spec);
  assert(
    Object.keys(bundle.files).every((name) => name === "src/App.tsx" || name === "src/styles.css"),
  );
  bundle.manifest.permissions = ["storage.read", "storage.write", "finance.portfolio"];
  bundle.files["src/components/summary.tsx"] =
    `export default function Summary({ value }: { value: number }) { return <output aria-label="Portfolio total">{value}</output>; }`;
  bundle.files["src/App.tsx"] = `import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { cd80, portfolioInputSchema } from '@cd80/sdk';
import Summary from './components/summary';
export default function App() {
 const [total, setTotal] = useState<number | null>(null);
 const [count, setCount] = useState(0);
 useEffect(() => { void cd80.storage.read('inputs', portfolioInputSchema).then(async input => { if (input) setTotal((await cd80.finance.portfolio(input)).totalValue); }); }, []);
 return <Card className="m-4"><CardHeader><CardTitle>React portfolio fixture</CardTitle></CardHeader><CardContent><Summary value={total ?? 0}/><Button onClick={() => setCount(count + 1)}>Count {count}</Button></CardContent></Card>;
}`;
  let app = await request<Application>({ action: "import", bundle, spec });
  assert(app.current?.verification.passed, JSON.stringify(app).slice(0, 6000));
  const releaseId = app.current.id;
  const expected = await request<{ totalValue: number }>({
    action: "rpc",
    appId: app.id,
    releaseId,
    capability: "finance.portfolio",
    input: app.data.inputs,
  });
  const assetResponse = await fetch(
    `${base}/api/app-assets?${new URLSearchParams({ appId: app.id, releaseId })}`,
  );
  assert(assetResponse.ok);
  const assets = (await assetResponse.json()) as { javascript: string; css: string };
  assert(assets.javascript.length > 1000 && assets.css.length > 1000);
  await writeFile(`${artifacts}/compiled-app.js`, assets.javascript);
  pass(
    "React-only starter passes source policy, type checking and compilation; compiled assets load",
  );

  const sourceResponse = await fetch(`${base}/api/app-source?appId=${app.id}`);
  assert(sourceResponse.ok, "Actual starter source must be available to the owning workspace");
  const starter = (await sourceResponse.json()) as { files: Record<string, string> };
  assert.equal(
    starter.files["starter/ui/components/button.tsx"],
    await readFile("packages/ui/src/components/button.tsx", "utf8"),
  );
  assert.equal(
    starter.files["starter/ui/styles/globals.css"],
    await readFile("packages/ui/src/styles/globals.css", "utf8"),
  );
  assert.equal(
    starter.files["starter/main.tsx"],
    await readFile("apps/web/starter/main.tsx.template", "utf8"),
  );
  assert(starter.files["starter/package.json"]?.includes('"catalog"'));
  assert(
    !Object.keys(starter.files).some((name) => name.includes(".env") || name.includes("dist/")),
  );
  pass(
    "Starter source exposes exact shadcn, Tailwind, entry and dependency files without env or compiled output",
  );

  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const pageErrors: string[] = [],
    externalRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
  page.on("request", (req) => {
    if (/^https?:/.test(req.url()) && !req.url().startsWith(base)) externalRequests.push(req.url());
  });
  await page.goto(`${base}/#app=${app.id}`);
  const frame = page.frameLocator("iframe");
  await frame
    .getByRole("button", { name: "Count 0", exact: true })
    .waitFor()
    .catch(async (error: unknown) => {
      await page.screenshot({ path: `${artifacts}/failed-preview.png`, fullPage: true });
      console.error({
        pageErrors,
        body: await page.locator("body").innerText(),
        frames: await Promise.all(
          page.frames().map(async (entry) => ({
            url: entry.url(),
            body: await entry
              .locator("body")
              .innerText()
              .catch(() => "unavailable"),
          })),
        ),
      });
      throw error;
    });
  await page.waitForFunction(() => {
    const iframe = document.querySelector("iframe");
    return iframe?.getAttribute("aria-busy") === "false";
  });
  await frame
    .getByRole("status", { name: "Portfolio total" })
    .filter({ hasText: String(expected.totalValue) })
    .waitFor();
  assert.equal(await frame.locator('[data-slot="card"]').count(), 1);
  const button = frame.getByRole("button", { name: "Count 0", exact: true });
  assert.equal(await button.getAttribute("data-slot"), "button");
  const appearance = await button.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    borderRadius: getComputedStyle(element).borderRadius,
  }));
  assert.notEqual(appearance.background, "rgba(0, 0, 0, 0)");
  assert.notEqual(appearance.borderRadius, "0px");
  await button.click();
  await frame.getByRole("button", { name: "Count 1", exact: true }).waitFor();
  await page.screenshot({ path: `${artifacts}/react-preview.png`, fullPage: true });
  pass(
    "Real React nested component, supplied shadcn styles and typed portfolio SDK render and interact",
  );

  assert.equal(externalRequests.length, 0, externalRequests.join("\n"));
  const iframe = page.frames().find((entry) => entry !== page.mainFrame());
  assert(iframe);
  assert.equal(
    await iframe.evaluate(async () => {
      try {
        await fetch("https://example.com/blocked");
        return false;
      } catch {
        return true;
      }
    }),
    true,
    "Opaque preview must block direct networking even outside source policy",
  );
  pass("Preview CSP blocks direct network access without unsafe-eval or connect exceptions");
  await page.getByRole("tab", { name: "Code", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "src/App.tsx source (read-only)", exact: true });
  await editor.waitFor();
  assert.equal(await editor.getAttribute("readonly"), "true");
  await page.waitForFunction(
    () =>
      new Set(
        Array.from(document.querySelectorAll(".view-line span")).map(
          (element) => getComputedStyle(element).color,
        ),
      ).size > 1,
  );
  await page.getByRole("button", { name: "summary.tsx", exact: true }).click();
  await page
    .getByRole("textbox", { name: "src/components/summary.tsx source (read-only)", exact: true })
    .waitFor();
  await page.locator(".view-lines").filter({ hasText: "Portfolio total" }).waitFor();
  await page.screenshot({ path: `${artifacts}/tsx-source-tree.png`, fullPage: true });
  assert(
    externalRequests.every((url) => url === "https://example.com/blocked"),
    externalRequests.join("\n"),
  );
  assert.deepEqual(pageErrors, []);
  pass(
    "Nested file tree and highlighted TSX readonly viewer load without browser errors or external dependencies",
  );

  await request({
    action: "rpc",
    appId: app.id,
    releaseId,
    capability: "storage.write",
    input: { key: "note", value: "retained" },
  });
  for (const [label, source] of [
    [
      "type error",
      "export default function App() { const value: number = 'wrong'; return <div>{value}</div>; }",
    ],
    [
      "host import",
      "import fs from 'node:fs'; export default function App(){return <div>{String(fs)}</div>}",
    ],
    [
      "path escape",
      "import secret from '../../../.env'; export default function App(){return <div>{secret}</div>}",
    ],
    ["import meta", "export default function App(){return <div>{String(import.meta.env)}</div>}"],
    [
      "macro import",
      "import text from './components/summary' with {type:'macro'}; export default function App(){return <div>{String(text)}</div>}",
    ],
    [
      "direct network",
      "export default function App(){void fetch('https://example.com'); return <div>bad</div>}",
    ],
  ] as const) {
    const bad = structuredClone(bundle);
    bad.files["src/App.tsx"] = source;
    app = await request<Application>({ action: "import", appId: app.id, bundle: bad, spec });
    assert.equal(app.current?.id, releaseId, label);
    assert.equal(app.preview?.verification.passed, false, label);
    assert.equal(app.data.note, "retained", label);
  }
  pass(
    "Invalid TSX, host/path imports, macros, import.meta and direct network source block activation and preserve data",
  );
  completed = true;
} finally {
  await writeFile(
    `${artifacts}/results.json`,
    JSON.stringify(
      { completed, passed: results.length, results, pageErrors, externalRequests },
      null,
      2,
    ),
  );
  await browser?.close();
  server.kill("SIGTERM");
  await rm(dataDir, { recursive: true, force: true });
}
