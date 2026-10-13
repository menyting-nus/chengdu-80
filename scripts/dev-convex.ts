import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../packages/backend/convex/_generated/api";
import type { Application } from "../apps/web/src/lib/contracts";
import type { StoredPlugin } from "../apps/web/src/lib/plugins";
import { demoOwnerId } from "../apps/web/src/server/settings";
import { configuredEnvironment, platformRoot } from "./environment";

const env = configuredEnvironment();
const backendRoot = resolve(platformRoot, "packages/backend");
const deploymentFile = resolve(backendRoot, ".env.local");
const children: ChildProcess[] = [];
function stop() {
  for (const child of children) {
    // Bunx launches subprocesses; stop the whole owned process group.
    try {
      if (child.pid) process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}
process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});

// This launcher only targets the CLI-managed backend on this computer.
function localConfiguration() {
  const contents = readFileSync(deploymentFile, "utf8");
  if (!/^CONVEX_DEPLOYMENT=(anonymous|local):/m.test(contents))
    throw new Error("dev:convex requires a local Convex deployment in packages/backend/.env.local");
  const url = contents.match(/^CONVEX_URL=(.+)$/m)?.[1]?.trim();
  if (!url || new URL(url).hostname !== "127.0.0.1")
    throw new Error("dev:convex only connects to loopback Convex");
  return url;
}
async function command(args: string[]) {
  const child = spawn("bunx", ["--no-install", "convex", ...args], {
    cwd: backendRoot,
    env: {
      ...env,
      CONVEX_AGENT_MODE: "anonymous",
      CONVEX_DEPLOY_KEY: "",
      CONVEX_SELF_HOSTED_URL: "",
      CONVEX_SELF_HOSTED_ADMIN_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const code = await new Promise<number | null>((done, reject) => {
    child.on("error", reject);
    child.on("exit", done);
  });
  for (const [key, value] of Object.entries(env))
    if (value && /KEY|TOKEN|SECRET|PASSWORD/.test(key))
      output = output.replaceAll(value, "[redacted]");
  if (code !== 0) throw new Error(output);
}

try {
  if (existsSync(deploymentFile)) localConfiguration();
  else await command(["init"]);
  const url = localConfiguration();
  if (!env.PLATFORM_INTERNAL_KEY || env.PLATFORM_INTERNAL_KEY.length < 32) {
    env.PLATFORM_INTERNAL_KEY = randomBytes(32).toString("hex");
    const file = resolve(platformRoot, ".env");
    const contents = existsSync(file) ? readFileSync(file, "utf8") : "";
    writeFileSync(
      file,
      contents.replace(/^PLATFORM_INTERNAL_KEY=.*\n?/gm, "") +
        `\nPLATFORM_INTERNAL_KEY=${env.PLATFORM_INTERNAL_KEY}\n`,
      { mode: 0o600 },
    );
    chmodSync(file, 0o600);
  }
  const localDir = resolve(platformRoot, ".local");
  mkdirSync(localDir, { recursive: true, mode: 0o700 });
  const defaults = resolve(localDir, ".env.convex-defaults");
  writeFileSync(
    defaults,
    `CD80_DEMO_MODE=1\nPLATFORM_INTERNAL_KEY=${env.PLATFORM_INTERNAL_KEY}\n`,
    { mode: 0o600 },
  );
  await command(["env", "set", "--from-file", defaults, "--force"]);
  Object.assign(env, {
    CD80_LOCAL_MODE: "0",
    VITE_LOCAL_MODE: "0",
    CD80_DEMO_MODE: "1",
    VITE_DEMO_MODE: "1",
    VITE_CONVEX_URL: url,
  });
  delete env.CONVEX_DEPLOY_KEY;
  delete env.CONVEX_SELF_HOSTED_URL;
  delete env.CONVEX_SELF_HOSTED_ADMIN_KEY;
  const backend = spawn("bunx", ["--no-install", "convex", "dev", "--typecheck", "enable"], {
    cwd: backendRoot,
    env,
    detached: true,
    stdio: "inherit",
  });
  children.push(backend);
  backend.on("exit", (code) => {
    stop();
    process.exit(code ?? 1);
  });
  const client = new ConvexHttpClient(url);
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      await client.action(api.platform.listDemo, { serverKey: env.PLATFORM_INTERNAL_KEY });
      ready = true;
      break;
    } catch {
      await new Promise((done) => setTimeout(done, 500));
    }
  }
  if (!ready) throw new Error("Local Convex did not deploy within 60 seconds");

  const importIndex = process.argv.indexOf("--import-files");
  if (importIndex >= 0) {
    const source = process.argv[importIndex + 1];
    if (!source) throw new Error("Provide a source directory after --import-files");
    const apps: Application[] = JSON.parse(readFileSync(resolve(source, "apps.json"), "utf8"));
    const existing = await client.action(api.platform.listDemo, {
      serverKey: env.PLATFORM_INTERNAL_KEY,
    });
    let imported = 0;
    for (const app of apps) {
      if (
        app.ownerId !== "local-prototype-owner" ||
        existing.some((row: Application) => row.id === app.id)
      )
        continue;
      await client.action(api.platform.saveDemo, {
        app: { ...app, ownerId: demoOwnerId },
        expectedRevision: null,
        serverKey: env.PLATFORM_INTERNAL_KEY,
      });
      imported++;
    }
    const pluginFile = resolve(source, "plugins.json");
    if (existsSync(pluginFile)) {
      const plugins: StoredPlugin[] = JSON.parse(readFileSync(pluginFile, "utf8"));
      const registered = await client.action(api.platform.plugins, {
        serverKey: env.PLATFORM_INTERNAL_KEY,
        demo: true,
      });
      const ids = new Set(registered.map((entry) => (JSON.parse(entry) as StoredPlugin).id));
      for (const plugin of plugins) {
        if (plugin.ownerId !== "local-prototype-owner" || ids.has(plugin.id)) continue;
        await client.action(api.platform.plugins, {
          serverKey: env.PLATFORM_INTERNAL_KEY,
          demo: true,
          payload: JSON.stringify({ ...plugin, ownerId: demoOwnerId }),
        });
      }
    }
    console.log(`Imported ${imported} apps into local Convex; source files retained.`);
  }
  const port = env.CD80_PORT || "3001";
  console.log(`Convex-backed shared demo · http://127.0.0.1:${port} · Backend ${url}`);
  const web = spawn(
    "bunx",
    ["--no-install", "vp", "dev", "--host", "127.0.0.1", "--port", port, "--strictPort"],
    { cwd: resolve(platformRoot, "apps/web"), env, detached: true, stdio: "inherit" },
  );
  children.push(web);
  web.on("exit", (code) => {
    stop();
    process.exit(code ?? 1);
  });
} catch (error) {
  stop();
  console.error(error instanceof Error ? error.message : "Local Convex startup failed");
  process.exit(1);
}
