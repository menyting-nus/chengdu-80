/// <reference lib="dom" />
// Failure modes: the preview is a synthetic SPA instead of real Start SSR; server
// function POST transport or typed capability RPC fails; project/shadcn sources
// are virtual; app execution reads host secrets/files/network; failed builds
// activate; signed preview grants cross app boundaries or survive expiry/deletion.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { protocols, type Application, type AppBundle } from "../apps/web/src/lib/contracts";
import { tsxStarter } from "../apps/web/src/lib/tsx-starter";

const dataDir = await mkdtemp(join(tmpdir(), "cd80-start-test-"));
const base = "http://127.0.0.1:3008";
const artifacts = ".local/tsx-tests";
const hostFile = join(dataDir, "host-secret.txt");
const clockFile = join(dataDir, "clock-offset.txt");
const clockModule = join(dataDir, "clock.mjs");
await writeFile(hostFile, "host-only-test-canary");
await writeFile(clockFile, "0");
await writeFile(
  clockModule,
  `import {readFileSync} from 'node:fs';const realNow=Date.now.bind(Date);Date.now=()=>realNow()+Number(readFileSync(${JSON.stringify(clockFile)},'utf8'));`,
);
let server: ChildProcess | undefined;
let browser: Browser | undefined;
let completed = false;
let log = "";
const results: string[] = [];
const pageErrors: string[] = [];
const externalRequests: string[] = [];
function start() {
  server = spawn("node", ["--import", clockModule, "apps/web/server/node-entry.mjs"], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: "3008",
      CD80_LOCAL_MODE: "1",
      CD80_DATA_DIR: dataDir,
      OPENAI_API_KEY: "",
      GLM_API_KEY: "",
      MODEL_PROVIDER: "openai",
      CD80_HOST_TEST_CANARY: "host-only-env-canary",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout?.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  server.stderr?.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
}
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
async function session(app: Application) {
  assert(app.current);
  const response = await fetch(
    `${base}/api/app-preview-session?${new URLSearchParams({ appId: app.id, releaseId: app.current.id, nonce: "a".repeat(32) })}`,
  );
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()) as { url: string; expiresAt: number };
}
function pass(description: string) {
  results.push(description);
  console.log(`PASS ${description}`);
}
try {
  await mkdir(artifacts, { recursive: true });
  start();
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert(server?.exitCode === null, log.slice(-2000));
    try {
      if ((await fetch(`${base}/api/platform`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(ready, "Isolated built server did not start");
  const spec = { ...protocols[0]!.defaultSpec, name: "Start project fixture" };
  const bundle: AppBundle = tsxStarter(spec);
  bundle.manifest.permissions = ["storage.read", "storage.write", "finance.portfolio"];
  for (const filename of [
    "package.json",
    "vite.config.ts",
    "tsconfig.json",
    "src/router.tsx",
    "src/routes/__root.tsx",
    "src/routes/index.tsx",
    "src/styles.css",
    "src/components/ui/button.tsx",
    "src/lib/cd80.ts",
  ])
    assert(bundle.files[filename], filename);
  assert(!Object.keys(bundle.files).some((name) => /^(starter|dist|node_modules)\//.test(name)));
  bundle.files["src/components/summary.tsx"] =
    `export default function Summary({value}:{value:number}){return <output aria-label="Portfolio total">{value}</output>;}`;
  bundle.files["src/routes/about.tsx"] =
    `import {createFileRoute} from '@tanstack/react-router';export const Route=createFileRoute('/about')({component:()=> <h1>Actual second Start route</h1>});`;
  bundle.files["src/App.tsx"] = `import {useEffect,useState} from 'react';
import {createServerFn} from '@tanstack/react-start';
import {Button} from '@/components/ui/button';
import {Card,CardHeader,CardTitle,CardContent} from '@/components/ui/card';
import {cd80,portfolioInputSchema} from '@/lib/cd80';
import Summary from './components/summary';
const probe=createServerFn({method:'POST'}).handler(async()=>{
 const fs=await import('node:fs/promises');
 let hostFileAccessible=false;let hostEnvFileAccessible=false;let networkAccessible=false;
 try{await fs.access(${JSON.stringify(hostFile)});hostFileAccessible=true;}catch{}
 try{await fs.access(${JSON.stringify(resolve("apps/web/.env"))});hostEnvFileAccessible=true;}catch{}
 try{await fetch(${JSON.stringify(base + "/api/platform")},{signal:AbortSignal.timeout(500)});networkAccessible=true;}catch{}
 return {serverFunction:true,hostEnvironmentAccessible:Boolean(process.env.CD80_HOST_TEST_CANARY),hostFileAccessible,hostEnvFileAccessible,networkAccessible};
});
export default function App(){
 const[total,setTotal]=useState<number|null>(null);const[count,setCount]=useState(0);
 const[isolation,setIsolation]=useState<Awaited<ReturnType<typeof probe>>|null>(null);
 const[error,setError]=useState('');
 useEffect(()=>{void cd80.storage.read('inputs',portfolioInputSchema).then(async input=>{if(input)setTotal((await cd80.finance.portfolio(input)).totalValue);}).catch(error=>setError(String(error)));},[]);
 return <Card className="m-4"><CardHeader><CardTitle>Actual TanStack Start SSR</CardTitle></CardHeader><CardContent>
 <Summary value={total??0}/><Button onClick={()=>setCount(count+1)}>Count {count}</Button>
 <Button onClick={()=>{void probe().then(setIsolation).catch(error=>setError(String(error)));}}>Run server function</Button>
 <Button onClick={()=>{void cd80.storage.write('note','saved by real SDK').then(()=>setError('Saved')).catch(error=>setError(String(error)));}}>Save note</Button>
 {isolation?<pre aria-label="Isolation result">{JSON.stringify(isolation)}</pre>:null}<p role="status">{error}</p>
 </CardContent></Card>;
}`;
  let app = await request<Application>({ action: "import", bundle, spec });
  assert(app.current?.verification.passed, JSON.stringify(app.preview?.verification.checks));
  const releaseId = app.current.id;
  const expected = await request<{ totalValue: number }>({
    action: "rpc",
    appId: app.id,
    releaseId,
    capability: "finance.portfolio",
    input: app.data.inputs,
  });
  const preview = await session(app);
  const html = await fetch(base + preview.url);
  assert.equal(html.status, 200, await html.clone().text());
  const ssr = await html.text();
  assert(
    ssr.includes("Actual TanStack Start SSR"),
    "SSR response must contain the rendered app, not just an empty entry",
  );
  assert(ssr.includes('data-slot="card"'));
  assert(ssr.includes(preview.url), "Start asset URLs must use the signed preview base");
  const about = await fetch(base + preview.url + "about");
  assert.equal(about.status, 200);
  assert((await about.text()).includes("Actual second Start route"));
  await writeFile(`${artifacts}/ssr.html`, ssr);
  pass(
    "Actual TanStack Start server renders app HTML and a second file route through the signed preview proxy",
  );

  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
  page.on("request", (req) => {
    if (/^https?:/.test(req.url()) && !req.url().startsWith(base)) externalRequests.push(req.url());
  });
  await page.goto(`${base}/#app=${app.id}`);
  const frame = page.frameLocator("iframe");
  await frame.getByRole("button", { name: "Count 0", exact: true }).waitFor({ timeout: 120000 });
  await page.locator('iframe[aria-busy="false"]').waitFor();
  await frame
    .locator('output[aria-label="Portfolio total"]')
    .filter({ hasText: String(expected.totalValue) })
    .waitFor();
  const button = frame.getByRole("button", { name: "Count 0", exact: true });
  assert.equal(await button.getAttribute("data-slot"), "button");
  const appearance = await button.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    radius: getComputedStyle(element).borderRadius,
  }));
  assert.notEqual(appearance.background, "rgba(0, 0, 0, 0)");
  assert.notEqual(appearance.radius, "0px");
  await button.click();
  await frame.getByRole("button", { name: "Count 1", exact: true }).waitFor();
  await frame.getByRole("button", { name: "Run server function", exact: true }).click();
  const isolation = frame.locator('pre[aria-label="Isolation result"]');
  await isolation.waitFor().catch(async (error: unknown) => {
    await page.screenshot({ path: `${artifacts}/server-function-failure.png`, fullPage: true });
    console.error({ frameBody: await frame.locator("body").innerText(), pageErrors });
    throw error;
  });
  assert.deepEqual(JSON.parse(await isolation.innerText()), {
    serverFunction: true,
    hostEnvironmentAccessible: false,
    hostFileAccessible: false,
    hostEnvFileAccessible: false,
    networkAccessible: false,
  });
  await frame.getByRole("button", { name: "Save note", exact: true }).click();
  await frame.getByRole("status").filter({ hasText: "Saved" }).waitFor();
  const snapshot = await request<{ apps: Application[] }>();
  assert.equal(snapshot.apps.find((item) => item.id === app.id)?.data.note, "saved by real SDK");
  await page.screenshot({ path: `${artifacts}/start-preview.png`, fullPage: true });
  pass(
    "Chrome hydrates stock shadcn UI, runs real Start POST server functions, and calls financial/storage capabilities",
  );
  pass(
    "Generated server functions cannot access host environment, host files, or host loopback network",
  );

  const child = page.frames().find((entry) => entry !== page.mainFrame());
  assert(child);
  assert(
    await child.evaluate(async () => {
      try {
        await fetch("https://example.com/blocked");
        return false;
      } catch {
        return true;
      }
    }),
  );
  await page.getByRole("tab", { name: "Code", exact: true }).click();
  await page.getByRole("button", { name: "App.tsx", exact: true }).click();
  await page
    .getByRole("textbox", { name: "src/App.tsx source (read-only)", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "package.json", exact: true }).click();
  const packageViewer = page.getByRole("textbox", {
    name: "package.json source (read-only)",
    exact: true,
  });
  await packageViewer.waitFor();
  assert.equal(await packageViewer.getAttribute("readonly"), "true");
  await page.screenshot({ path: `${artifacts}/project-source-tree.png`, fullPage: true });
  assert(!(await page.locator("aside").allTextContents()).join("\n").includes("starter/"));
  pass(
    "Code browser shows actual project files and read-only highlighted source without synthetic compiler folders",
  );

  const invalid = structuredClone(bundle);
  invalid.files["src/App.tsx"] =
    "export default function App(){const value:number='wrong';return <div>{value}</div>}";
  app = await request<Application>({ action: "import", appId: app.id, bundle: invalid, spec });
  assert.equal(app.current?.id, releaseId);
  assert.equal(app.preview?.verification.passed, false);
  assert.equal(app.data.note, "saved by real SDK");
  pass("Failed strict TypeScript build preserves the verified release and saved data");

  const otherSpec = { ...spec, name: "Other project fixture" };
  const otherBundle = structuredClone(bundle);
  otherBundle.manifest.name = otherSpec.name;
  otherBundle.files["src/App.tsx"] =
    "export default function App(){return <h1>Other app only</h1>}";
  const other = await request<Application>({
    action: "import",
    bundle: otherBundle,
    spec: otherSpec,
  });
  const otherPreview = await session(other);
  const otherHtml = await fetch(base + otherPreview.url);
  assert.equal(otherHtml.status, 200);
  assert((await otherHtml.text()).includes("Other app only"));
  const token = preview.url.split("/")[3]!;
  const altered = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
  assert.equal((await fetch(base + preview.url.replace(token, altered))).status, 404);
  const crossAppAttempt = await fetch(
    base + preview.url + `?appId=${other.id}&releaseId=${other.current!.id}`,
  );
  assert.equal(crossAppAttempt.status, 200);
  assert(!(await crossAppAttempt.text()).includes("Other app only"));
  pass(
    "Signed preview URLs resist tampering and cannot select another app through query parameters",
  );

  await writeFile(clockFile, String(21 * 60_000));
  assert.equal((await fetch(base + preview.url)).status, 404);
  const renewed = await session(app);
  assert.equal((await fetch(base + renewed.url)).status, 200);
  const persisted = JSON.parse(await readFile(join(dataDir, "apps.json"), "utf8")) as Application[];
  await writeFile(
    join(dataDir, "apps.json"),
    JSON.stringify(persisted.filter((item) => item.id !== app.id)),
  );
  assert.equal((await fetch(base + renewed.url)).status, 404);
  pass("Expired grants require renewal and deleting an app revokes an existing signed preview");
  assert(
    externalRequests.every((url) => url === "https://example.com/blocked"),
    externalRequests.join("\n"),
  );
  assert.deepEqual(pageErrors, []);
  completed = true;
} catch (error) {
  console.error(log.slice(-5000));
  throw error;
} finally {
  await mkdir(artifacts, { recursive: true });
  await writeFile(
    `${artifacts}/results.json`,
    JSON.stringify(
      { completed, passed: results.length, results, pageErrors, externalRequests },
      null,
      2,
    ),
  );
  await browser?.close();
  if (server && server.exitCode === null)
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => server!.kill("SIGKILL"), 5000);
      server!.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      server!.kill("SIGTERM");
    });
  await rm(dataDir, { recursive: true, force: true });
}
