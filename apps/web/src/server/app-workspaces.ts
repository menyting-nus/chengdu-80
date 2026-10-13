import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { AppBundle } from "../lib/contracts";
import { isProjectFile } from "../lib/project-files";

export type AppWorkspace = {
  key: string;
  directory: string;
  basePath: string;
  root: string;
  control: string;
  home: string;
  dependencies: string;
  moduleRoots: string[];
  webRoot: string;
  bunPath: string;
  nodePath: string;
};
export type AppPreview = { workspaceKey: string; socketPath: string; basePath: string };
export type WorkspaceCommandResult = { stdout: string; stderr: string; exitCode: number };
const workspaces = new Map<string, Promise<AppWorkspace>>();
const previews = new Map<
  string,
  {
    ready: Promise<AppPreview>;
    process?: ChildProcess;
    cancelled?: boolean;
    idleTimer?: ReturnType<typeof setTimeout>;
  }
>();
const pins = new Map<string, number>();
const inUse = new Map<string, number>();
const pendingRemoval = new Set<string>();
const commands = new Map<string, Set<ChildProcess>>();
const excluded = new Set([
  "node_modules",
  "dist",
  ".git",
  ".vite",
  ".cache",
  ".output",
  ".tanstack",
  ".runtime",
]);
const sourceLimit = 200_000;
const dependencyCaches = [".vite-temp", ".vite", ".cache", ".tanstack"];
let nodeBinary: Promise<string> | undefined;
let bunBinary: Promise<string> | undefined;

async function webRoot() {
  for (const root of [process.cwd(), path.resolve(process.cwd(), "apps/web")]) {
    try {
      await access(path.join(root, "server/app-preview-relay.mjs"));
      return root;
    } catch {}
  }
  throw new Error("The application workspace runner is missing");
}

async function executable(name: string) {
  for (const directory of (process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin").split(
    path.delimiter,
  )) {
    const filename = path.join(directory, name);
    try {
      await access(filename);
      return filename;
    } catch {}
  }
  throw new Error(`${name} is required for isolated application workspaces`);
}

function nativeNode() {
  // Vite+ installs a Node shim in PATH. Resolve its already installed runtime
  // before entering the sandbox, where the shim's host cache is inaccessible.
  return (nodeBinary ??= (async () => {
    const result = await promisify(execFile)(await executable("node"), ["-p", "process.execPath"], {
      timeout: 10_000,
      maxBuffer: 2000,
    });
    const filename = result.stdout.trim();
    if (!path.isAbsolute(filename)) throw new Error("The installed Node runtime is unavailable");
    await access(filename);
    return filename;
  })());
}

function nativeBun() {
  // Vite+ dev launchers can prepend a shell shim that depends on adjacent files.
  // Mount the native executable, not that wrapper, inside the private runtime.
  return (bunBinary ??= (async () => {
    const result = await promisify(execFile)(
      await executable("bun"),
      ["--no-env-file", "-e", "process.stdout.write(process.execPath)"],
      {
        timeout: 10_000,
        maxBuffer: 2000,
      },
    );
    const filename = result.stdout.trim();
    if (!path.isAbsolute(filename)) throw new Error("The installed Bun runtime is unavailable");
    await access(filename);
    return filename;
  })());
}

function safeSourcePath(name: string) {
  return isProjectFile(name);
}

async function dependencyLinks(destination: string, roots: string[]) {
  await mkdir(destination, { recursive: true });
  const linked = new Set<string>();
  for (const root of roots) {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".bin") continue;
      if (entry.name.startsWith("@") || entry.name === ".bin") {
        await mkdir(path.join(destination, entry.name), { recursive: true });
        for (const child of await readdir(path.join(root, entry.name))) {
          const name = `${entry.name}/${child}`;
          if (linked.has(name)) continue;
          await symlink(path.join(root, name), path.join(destination, name));
          linked.add(name);
        }
      } else if (!linked.has(entry.name)) {
        await symlink(path.join(root, entry.name), path.join(destination, entry.name));
        linked.add(entry.name);
      }
    }
  }
}

async function terminate(process: ChildProcess) {
  if (!process.pid || process.exitCode !== null) return;
  try {
    globalThis.process.kill(-process.pid, "SIGKILL");
  } catch {}
}

async function discard(key: string) {
  pins.delete(key);
  pendingRemoval.delete(key);
  const preview = previews.get(key);
  if (preview) {
    clearTimeout(preview.idleTimer);
    preview.cancelled = true;
    if (preview.process) await terminate(preview.process);
    previews.delete(key);
  }
  await Promise.all([...(commands.get(key) ?? [])].map(terminate));
  const workspace = workspaces.get(key);
  workspaces.delete(key);
  if (workspace)
    await workspace
      .then((value) => rm(value.root, { recursive: true, force: true }))
      .catch(() => {});
}

function useWorkspace(key: string) {
  inUse.set(key, (inUse.get(key) ?? 0) + 1);
}
function finishWorkspaceUse(key: string) {
  const remaining = (inUse.get(key) ?? 1) - 1;
  if (remaining) inUse.set(key, remaining);
  else {
    inUse.delete(key);
    if (pendingRemoval.delete(key)) void discard(key);
  }
}

export async function releaseWorkspace(
  workspace: AppWorkspace,
  options: { keepCached?: boolean } = {},
) {
  const remaining = (pins.get(workspace.key) ?? 1) - 1;
  if (remaining > 0) {
    pins.set(workspace.key, remaining);
    return;
  }
  pins.delete(workspace.key);
  if (options.keepCached) return;
  if (inUse.has(workspace.key)) pendingRemoval.add(workspace.key);
  else await discard(workspace.key);
}

// Every generated framework config, build script and SSR function executes only
// inside a private PID/user/network/mount namespace with scrubbed environment.
function sandboxArguments(workspace: AppWorkspace, command: string[]) {
  const args = [
    "--unshare-all",
    "--die-with-parent",
    "--new-session",
    "--cap-drop",
    "ALL",
    "--clearenv",
    "--ro-bind",
    "/usr",
    "/usr",
    "--symlink",
    "usr/lib",
    "/lib",
    "--symlink",
    "usr/lib64",
    "/lib64",
    "--symlink",
    "usr/bin",
    "/bin",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--tmpfs",
    "/run",
    "--dir",
    "/runtime",
    "--dir",
    "/home",
    "--dir",
    "/home/app",
    "--ro-bind",
    workspace.bunPath,
    "/runtime/bun",
    "--ro-bind",
    workspace.nodePath,
    "/runtime/node",
    "--ro-bind",
    path.join(workspace.webRoot, "server/app-preview-relay.mjs"),
    "/runtime/app-preview-relay.mjs",
    "--bind",
    workspace.directory,
    "/project",
    "--bind",
    workspace.control,
    "/control",
    "--bind",
    workspace.home,
    "/home/app",
    "--ro-bind",
    workspace.dependencies,
    "/deps",
  ];
  for (const root of workspace.moduleRoots) args.push("--ro-bind", root, root);
  for (const name of dependencyCaches)
    args.push("--bind", path.join(workspace.control, name), `/deps/${name}`);
  args.push(
    "--setenv",
    "PATH",
    "/runtime:/project/node_modules/.bin:/usr/bin:/bin",
    "--setenv",
    "HOME",
    "/home/app",
    "--setenv",
    "APP_BASE_PATH",
    workspace.basePath,
    "--setenv",
    "TZ",
    "UTC",
    "--setenv",
    "RAYON_NUM_THREADS",
    "2",
    "--chdir",
    "/project",
    "--",
    ...command,
  );
  return args;
}

async function spawnSandbox(workspace: AppWorkspace, command: string[]) {
  const bwrap = await executable("bwrap");
  await executable("prlimit");
  return spawn(
    bwrap,
    sandboxArguments(workspace, [
      "/usr/bin/prlimit",
      "--as=8589934592",
      "--nproc=256",
      "--fsize=67108864",
      "--core=0",
      "--cpu=120",
      "--",
      ...command,
    ]),
    {
      env: {},
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
}

export async function prepareProject(
  bundle: AppBundle,
  options: { scope?: string; basePath?: string; pin?: boolean } = {},
): Promise<AppWorkspace> {
  if (shutdownRegistry.pending) throw new Error("Application workspace runner is shutting down");
  const basePath = options.basePath ?? "/";
  if (
    (!/^\/[A-Za-z0-9_./~-]*\/$/.test(basePath) && basePath !== "/") ||
    basePath.length > 300 ||
    basePath.includes("..")
  )
    throw new Error("Invalid application base path");
  const entries = Object.entries(bundle.files).sort(([a], [b]) => a.localeCompare(b));
  if (
    entries.length > 200 ||
    entries.reduce((size, [, content]) => size + content.length, 0) > sourceLimit ||
    entries.some(([name]) => !safeSourcePath(name))
  )
    throw new Error("Application project exceeds supported source bounds");
  const key = createHash("sha256")
    .update(JSON.stringify([options.scope ?? "", basePath, entries]))
    .digest("hex");
  const existing = workspaces.get(key);
  if (existing) {
    workspaces.delete(key);
    workspaces.set(key, existing);
    useWorkspace(key);
    try {
      const workspace = await existing;
      if (options.pin) pins.set(key, (pins.get(key) ?? 0) + 1);
      return workspace;
    } finally {
      finishWorkspaceUse(key);
    }
  }
  useWorkspace(key);
  const preparing = (async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cd80-project-"));
    try {
      const web = await webRoot();
      const workspace: AppWorkspace = {
        key,
        root,
        directory: path.join(root, "project"),
        control: path.join(root, "control"),
        home: path.join(root, "home"),
        dependencies: path.join(root, "dependencies"),
        basePath,
        webRoot: web,
        moduleRoots: [
          path.join(web, "node_modules"),
          path.resolve(web, "../../packages/ui/node_modules"),
          path.resolve(web, "../../node_modules"),
        ],
        bunPath: await nativeBun(),
        nodePath: await nativeNode(),
      };
      await Promise.all(
        [workspace.directory, workspace.control, workspace.home].map((name) =>
          mkdir(name, { recursive: true }),
        ),
      );
      await dependencyLinks(workspace.dependencies, workspace.moduleRoots);
      for (const name of dependencyCaches)
        await Promise.all([
          mkdir(path.join(workspace.dependencies, name), { recursive: true }),
          mkdir(path.join(workspace.control, name), { recursive: true }),
        ]);
      await symlink("/deps", path.join(workspace.directory, "node_modules"));
      for (const [name, content] of entries) {
        const filename = path.join(workspace.directory, name);
        await mkdir(path.dirname(filename), { recursive: true });
        await writeFile(filename, content);
      }
      return workspace;
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  })();
  workspaces.set(key, preparing);
  try {
    while (workspaces.size > 6) {
      const oldest = [...workspaces.keys()].find(
        (candidate) => candidate !== key && !pins.has(candidate) && !inUse.has(candidate),
      );
      if (!oldest) {
        await discard(key);
        throw new Error("Application workspace capacity is busy; try again shortly");
      }
      await discard(oldest);
    }
    const workspace = await preparing;
    if (options.pin) pins.set(key, (pins.get(key) ?? 0) + 1);
    return workspace;
  } catch (error) {
    workspaces.delete(key);
    throw error;
  } finally {
    finishWorkspaceUse(key);
  }
}

export async function runWorkspaceCommand(
  workspace: AppWorkspace,
  command: string,
  options: { signal?: AbortSignal; timeout?: number } = {},
): Promise<WorkspaceCommandResult> {
  useWorkspace(workspace.key);
  try {
    return await executeWorkspaceCommand(workspace, command, options);
  } finally {
    finishWorkspaceUse(workspace.key);
  }
}

async function executeWorkspaceCommand(
  workspace: AppWorkspace,
  command: string,
  options: { signal?: AbortSignal; timeout?: number } = {},
): Promise<WorkspaceCommandResult> {
  const child = await spawnSandbox(workspace, [
    "/usr/bin/bash",
    "--noprofile",
    "--norc",
    "-c",
    command,
  ]);
  const running = commands.get(workspace.key) ?? new Set<ChildProcess>();
  running.add(child);
  commands.set(workspace.key, running);
  let stdout = "",
    stderr = "",
    reason = "";
  const kill = () => {
    void terminate(child);
  };
  const timer = setTimeout(
    () => {
      reason = "Application command timed out";
      kill();
    },
    Math.min(options.timeout ?? 60_000, 120_000),
  );
  const abort = () => {
    reason = "Application command was stopped";
    kill();
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const collect = (chunk: Buffer, output: "stdout" | "stderr") => {
    if (output === "stdout") stdout += chunk.toString();
    else stderr += chunk.toString();
    if (stdout.length + stderr.length > 160_000) {
      reason = "Application command output limit exceeded";
      kill();
      stdout = stdout.slice(0, 80_000);
      stderr = stderr.slice(0, 80_000);
    }
  };
  child.stdout?.on("data", (chunk: Buffer) => collect(chunk, "stdout"));
  child.stderr?.on("data", (chunk: Buffer) => collect(chunk, "stderr"));
  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });
    return {
      stdout,
      stderr: reason ? `${stderr}\n${reason}` : stderr,
      exitCode: reason ? 1 : exitCode,
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    running.delete(child);
    if (!running.size) commands.delete(workspace.key);
  }
}

export async function buildProject(
  workspace: AppWorkspace,
  options: { signal?: AbortSignal } = {},
) {
  const built = await runWorkspaceCommand(workspace, "bun run build && bun run check", {
    timeout: 120_000,
    signal: options.signal,
  });
  if (built.exitCode !== 0)
    throw new Error(
      ([built.stdout, built.stderr].filter(Boolean).join("\n") || "Application build failed").slice(
        -12_000,
      ),
    );
  const [server, client] = await Promise.all([
    stat(path.join(workspace.directory, "dist/server/server.js")),
    stat(path.join(workspace.directory, "dist/client")),
  ]);
  if (!server.isFile() || !client.isDirectory())
    throw new Error(
      "The application build did not produce TanStack Start server and client output",
    );
  return { output: `${built.stdout}\n${built.stderr}`.slice(-12_000) };
}

export async function readProjectFiles(workspace: AppWorkspace): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  let total = 0;
  async function collect(directory: string, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue;
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || !/^[A-Za-z0-9_$@()[\].+-]+$/.test(entry.name))
          throw new Error("Unsupported application source directory");
        await collect(path.join(directory, entry.name), name);
      } else if (entry.isFile()) {
        if (!safeSourcePath(name)) throw new Error("Unsupported application source path");
        const info = await stat(path.join(directory, entry.name));
        if (info.size > sourceLimit)
          throw new Error("Application source file exceeds supported size");
        const content = await readFile(path.join(directory, entry.name), "utf8");
        if (content.includes("\0")) throw new Error("Application source must be text");
        total += content.length;
        files[name] = content;
        if (total > sourceLimit || Object.keys(files).length > 200)
          throw new Error("Application source exceeds supported bounds");
      } else throw new Error("Application source cannot contain symlinks or special files");
    }
  }
  await collect(workspace.directory);
  return files;
}

export async function readPreviewResponse(
  preview: AppPreview,
  requestPath: string,
  init: { method?: string; headers?: HeadersInit; body?: Uint8Array } = {},
): Promise<Response> {
  useWorkspace(preview.workspaceKey);
  try {
    return await fetchPreviewResponse(preview, requestPath, init);
  } finally {
    finishWorkspaceUse(preview.workspaceKey);
  }
}

async function fetchPreviewResponse(
  preview: AppPreview,
  requestPath: string,
  init: { method?: string; headers?: HeadersInit; body?: Uint8Array } = {},
): Promise<Response> {
  if (
    (!requestPath.startsWith(preview.basePath) &&
      requestPath.split("?")[0] !== preview.basePath.slice(0, -1)) ||
    requestPath.includes("\r") ||
    requestPath.includes("\n")
  )
    throw new Error("Preview request is outside the application base path");
  const headers = new Headers(init.headers);
  headers.delete("cookie");
  headers.delete("authorization");
  headers.delete("host");
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        socketPath: preview.socketPath,
        path: requestPath,
        method: init.method ?? "GET",
        headers: Object.fromEntries(headers),
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        let size = 0;
        incoming.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 10_000_000) {
            request.destroy(new Error("Preview response exceeds supported size"));
          } else chunks.push(chunk);
        });
        incoming.on("error", reject);
        incoming.on("end", () => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(incoming.headers))
            if (value && !["set-cookie", "connection", "transfer-encoding"].includes(key))
              responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
          const status = incoming.statusCode ?? 502;
          resolve(
            new Response(
              [101, 204, 205, 304].includes(status) || init.method === "HEAD"
                ? null
                : Buffer.concat(chunks),
              { status, headers: responseHeaders },
            ),
          );
        });
      },
    );
    request.setTimeout(30_000, () => request.destroy(new Error("Preview request timed out")));
    request.on("error", reject);
    if (init.body) request.write(init.body);
    request.end();
  });
}

export async function startPreview(workspace: AppWorkspace): Promise<AppPreview> {
  const current = previews.get(workspace.key);
  if (current) {
    previews.delete(workspace.key);
    previews.set(workspace.key, current);
    return current.ready;
  }
  while (previews.size >= 4) {
    const oldest = [...previews.keys()].find((key) => !inUse.has(key) && !pins.has(key));
    if (!oldest) throw new Error("Application previews are busy; try again shortly");
    await discard(oldest);
  }
  useWorkspace(workspace.key);
  const entry: {
    ready: Promise<AppPreview>;
    process?: ChildProcess;
    cancelled?: boolean;
    idleTimer?: ReturnType<typeof setTimeout>;
  } = {
    ready: Promise.resolve({
      workspaceKey: workspace.key,
      socketPath: path.join(workspace.control, "preview.sock"),
      basePath: workspace.basePath,
    }),
  };
  entry.ready = (async () => {
    const child = await spawnSandbox(workspace, [
      "/runtime/node",
      "/runtime/app-preview-relay.mjs",
    ]);
    entry.process = child;
    if (entry.cancelled) {
      await terminate(child);
      throw new Error("Application preview was closed");
    }
    let output = "",
      failure: Error | undefined;
    child.stdout?.on("data", (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-12_000);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-12_000);
    });
    child.once("error", (error) => {
      failure = error;
    });
    child.once("exit", () => {
      if (previews.get(workspace.key) === entry) previews.delete(workspace.key);
    });
    const preview = {
      workspaceKey: workspace.key,
      socketPath: path.join(workspace.control, "preview.sock"),
      basePath: workspace.basePath,
    };
    try {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (failure || child.exitCode !== null || child.signalCode !== null)
          throw new Error(output || failure?.message || "Application preview exited");
        try {
          const response = await readPreviewResponse(preview, workspace.basePath);
          if (response.status < 500) return preview;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error(`Application preview did not start: ${output}`);
    } catch (error) {
      await terminate(child);
      if (previews.get(workspace.key) === entry) previews.delete(workspace.key);
      throw error;
    }
  })().finally(() => finishWorkspaceUse(workspace.key));
  previews.set(workspace.key, entry);
  return entry.ready;
}

export async function requestWorkspace(
  bundle: AppBundle,
  basePath: string,
  request: Request,
): Promise<Response> {
  const workspace = await prepareProject(bundle, { scope: basePath, basePath, pin: true });
  try {
    const preview = await startPreview(workspace);
    const active = previews.get(workspace.key);
    if (active) {
      clearTimeout(active.idleTimer);
      active.idleTimer = setTimeout(() => {
        void discard(workspace.key);
      }, 10 * 60_000);
      active.idleTimer.unref();
    }
    const url = new URL(request.url);
    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : new Uint8Array(await request.arrayBuffer());
    if (body && body.length > 1_000_000) throw new Error("Preview request body is too large");
    return await readPreviewResponse(preview, `${url.pathname}${url.search}`, {
      method: request.method,
      headers: request.headers,
      body,
    });
  } finally {
    await releaseWorkspace(workspace, { keepCached: true });
  }
}

export async function disposeAppWorkspaces() {
  await Promise.all([...workspaces.keys()].map(discard));
}

type WorkspaceShutdownRegistry = {
  callbacks: Set<() => Promise<void>>;
  pending?: Promise<void>;
};
const shutdownGlobal = globalThis as typeof globalThis & {
  __cd80WorkspaceShutdown?: WorkspaceShutdownRegistry;
};
const shutdownRegistry = (shutdownGlobal.__cd80WorkspaceShutdown ??= (() => {
  const registry: WorkspaceShutdownRegistry = { callbacks: new Set() };
  const shutdown = () => {
    registry.pending ??= Promise.allSettled(
      [...registry.callbacks].map((dispose) => dispose()),
    ).then(() => {});
  };
  // Coexist with the HTTP server's own signal handlers. Closing child processes
  // and their pipes lets Node finish naturally after the listener shuts down.
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return registry;
})());
shutdownRegistry.callbacks.add(disposeAppWorkspaces);
import.meta.hot?.dispose(() => {
  shutdownRegistry.callbacks.delete(disposeAppWorkspaces);
  void disposeAppWorkspaces();
});
