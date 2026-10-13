import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { inspectSources } from "../../starter/source-policy.mjs";
import type { AppBundle, Check } from "@/lib/contracts";

const execute = promisify(execFile);
const artifactSchema = z.object({
  javascript: z.string().max(6_000_000),
  css: z.string().max(2_000_000),
});
export type CompiledTsx = z.infer<typeof artifactSchema>;
const cache = new Map<string, Promise<CompiledTsx>>();
let activeBuilds = 0;
let buildQueue: Promise<void> = Promise.resolve();

async function compilerRoot() {
  for (const root of [process.cwd(), path.resolve(process.cwd(), "apps/web")]) {
    try {
      await access(path.join(root, "server/tsx-build-worker.mjs"));
      return root;
    } catch {
      // Dev starts from the workspace root; deployed Node starts in apps/web.
    }
  }
  throw new Error("The trusted React starter compiler is missing from this installation");
}

async function hashDirectory(
  hash: ReturnType<typeof createHash>,
  directory: string,
): Promise<void> {
  const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await hashDirectory(hash, filename);
    else {
      hash.update(entry.name);
      hash.update(await readFile(filename));
    }
  }
}

export function inspectTsxSource(bundle: AppBundle): Check[] {
  const issues = inspectSources(bundle.files);
  const css = (bundle.files["src/styles.css"] ?? "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_match, hex: string) =>
      String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)),
    )
    .replace(/\\([^\r\n])/g, "$1");
  return [
    {
      name: "Self-contained React styles",
      passed:
        !/@(?:import|plugin|config|source|reference)\b|url\s*\(|(?:-webkit-)?image-set\s*\(/i.test(
          css,
        ),
      detail:
        "Use starter Tailwind classes or plain CSS without external resources or compiler directives.",
    },
    {
      name: "React source policy",
      passed: issues.length === 0,
      detail: issues.length
        ? issues.join("; ")
        : "Uses fixed starter dependencies and local TSX components; no dynamic imports, macros or direct network APIs.",
    },
  ];
}

async function runBuild(root: string, bundle: AppBundle): Promise<CompiledTsx> {
  if (activeBuilds >= 12) throw new Error("The React compiler is busy; try again shortly");
  activeBuilds += 1;
  const previous = buildQueue;
  let release = () => {};
  buildQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  let temporary: string | undefined;
  try {
    // This worker parses/typechecks/bundles browser source only. Generated code
    // is never imported or executed by the application server or build worker.
    temporary = await mkdtemp(path.join(os.tmpdir(), "cd80-tsx-"));
    const child = execute(
      "bun",
      ["--no-env-file", path.join(root, "server/tsx-build-worker.mjs"), temporary],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          NODE_ENV: "production",
          TZ: "UTC",
        },
        timeout: 60_000,
        maxBuffer: 9_000_000,
        killSignal: "SIGKILL",
      },
    );
    child.child.stdin?.end(JSON.stringify(bundle.files));
    try {
      const { stdout } = await child;
      return artifactSchema.parse(JSON.parse(stdout));
    } catch (error) {
      const result = z
        .object({ stderr: z.string().optional(), killed: z.boolean().optional() })
        .safeParse(error);
      if (result.success && result.data.killed)
        throw new Error("React starter compilation exceeded its 60 second limit");
      throw new Error(
        result.success && result.data.stderr
          ? result.data.stderr.slice(0, 12_000)
          : "React starter compilation failed",
      );
    }
  } finally {
    try {
      if (temporary) await rm(temporary, { recursive: true, force: true });
    } finally {
      activeBuilds -= 1;
      release();
    }
  }
}

// Source and trusted starter/dependency changes invalidate artifacts. Compiled
// assets stay in a small process cache, outside Convex document size limits.
export async function compileTsx(bundle: AppBundle): Promise<CompiledTsx> {
  const policy = inspectTsxSource(bundle);
  if (policy.some((check) => !check.passed))
    throw new Error(policy.map((check) => check.detail).join("\n"));
  const root = await compilerRoot();
  const orderedFiles = Object.fromEntries(
    Object.entries(bundle.files).sort(([left], [right]) => left.localeCompare(right)),
  );
  const hash = createHash("sha256").update(JSON.stringify(orderedFiles));
  for (const filename of [
    "server/tsx-build-worker.mjs",
    "starter/source-policy.mjs",
    "starter/main.tsx.template",
    "src/lib/contracts.ts",
    "package.json",
  ])
    hash.update(await readFile(path.join(root, filename)));
  hash.update(await readFile(path.resolve(root, "../../bun.lock")));
  await hashDirectory(hash, path.join(root, "src/lib/generated-app"));
  await hashDirectory(hash, path.resolve(root, "../../packages/ui/src"));
  const key = hash.digest("hex");
  const existing = cache.get(key);
  if (existing) {
    cache.delete(key);
    cache.set(key, existing);
    return existing;
  }
  const artifacts = runBuild(root, bundle);
  cache.set(key, artifacts);
  while (cache.size > 10) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  try {
    return await artifacts;
  } catch (error) {
    if (cache.get(key) === artifacts) cache.delete(key);
    throw error;
  }
}

// Only these trusted starter files are exposed, never arbitrary host paths or env.
// Their source is the same source consumed by the compiler, not generated output.
export async function starterSourceFiles(): Promise<Record<string, string>> {
  const root = await compilerRoot();
  const files: Record<string, string> = {};
  async function collect(directory: string, display: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      const name = `${display}/${entry.name}`;
      if (entry.isDirectory()) await collect(filename, name);
      else if (entry.isFile() && /\.(?:tsx?|css)$/.test(entry.name))
        files[name] = await readFile(filename, "utf8");
    }
  }
  await collect(path.resolve(root, "../../packages/ui/src"), "starter/ui");
  await collect(path.join(root, "src/lib/generated-app"), "starter/sdk");
  const references = {
    "starter/main.tsx": path.join(root, "starter/main.tsx.template"),
    "starter/compiler/tsx-build-worker.mjs": path.join(root, "server/tsx-build-worker.mjs"),
    "starter/compiler/source-policy.mjs": path.join(root, "starter/source-policy.mjs"),
    "starter/compiler/source-policy.d.mts": path.join(root, "starter/source-policy.d.mts"),
    "starter/package.json": path.resolve(root, "../../package.json"),
    "starter/web/package.json": path.join(root, "package.json"),
    "starter/ui/package.json": path.resolve(root, "../../packages/ui/package.json"),
    "starter/ui/components.json": path.resolve(root, "../../packages/ui/components.json"),
    "starter/bun.lock": path.resolve(root, "../../bun.lock"),
  };
  for (const [name, filename] of Object.entries(references))
    files[name] = await readFile(filename, "utf8");
  return files;
}
