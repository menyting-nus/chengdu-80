import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { build as buildBrowser } from "vite-plus";
import react from "@vitejs/plugin-react";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { inspectSources, isGeneratedSource } from "../starter/source-policy.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uiRoot = path.resolve(webRoot, "../../packages/ui/src");
const sdkRoot = path.join(webRoot, "src/lib/generated-app");
const aliases = {
  "@cd80/sdk": path.join(sdkRoot, "sdk.ts"),
  "@cd80/components": path.join(sdkRoot, "components.tsx"),
  "@/components/ui/*": path.join(uiRoot, "components/*"),
  "@/lib/utils": path.join(uiRoot, "lib/utils.ts"),
  "@web-starter/ui/*": path.join(uiRoot, "*"),
};

async function sourcesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const name = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourcesIn(name);
      if (/\.tsx?$/.test(name))
        return [
          { content: await readFile(name, "utf8"), extension: name.endsWith("tsx") ? "tsx" : "ts" },
        ];
      return [];
    }),
  );
  return nested.flat();
}

async function build(files) {
  const issues = inspectSources(files);
  if (issues.length) throw new Error(issues.join("\n"));
  const generated = Object.entries(files).filter(([name]) => isGeneratedSource(name));
  if (
    !Object.hasOwn(files, "src/App.tsx") ||
    generated.length > 40 ||
    generated.reduce((total, [, content]) => total + content.length, 0) > 200_000
  )
    throw new Error("React workspace exceeds the supported source bounds");
  const temporary = process.argv[2] ?? (await mkdtemp(path.join(os.tmpdir(), "cd80-tsx-")));
  try {
    await symlink(path.join(webRoot, "node_modules"), path.join(temporary, "node_modules"), "dir");
    for (const [name, content] of generated) {
      const target = path.join(temporary, name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    const entry = path.join(temporary, "src/main.tsx");
    await writeFile(
      entry,
      `import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
const queryClient = new QueryClient();
function Starter() {
  useEffect(() => { (window as unknown as { cd80: { ready(): void } }).cd80.ready(); }, []);
  return <QueryClientProvider client={queryClient}><App /></QueryClientProvider>;
}
const root = document.getElementById("root");
if (!root) throw new Error("React starter requires #root");
createRoot(root).render(<Starter />);
`,
    );
    const program = ts.createProgram([entry], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
      types: ["react", "react-dom"],
      typeRoots: [path.join(webRoot, "node_modules/@types")],
      paths: Object.fromEntries(Object.entries(aliases).map(([key, value]) => [key, [value]])),
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      allowImportingTsExtensions: true,
      esModuleInterop: true,
    });
    const errors = ts
      .getPreEmitDiagnostics(program)
      .filter((item) => item.category === ts.DiagnosticCategory.Error);
    if (errors.length)
      throw new Error(
        errors
          .slice(0, 12)
          .map((item) => {
            const location =
              item.file && item.start !== undefined
                ? item.file.getLineAndCharacterOfPosition(item.start)
                : undefined;
            const name = item.file
              ? path.relative(temporary, item.file.fileName).replaceAll("\\", "/")
              : "TypeScript";
            return `${name}${location ? `:${location.line + 1}:${location.character + 1}` : ""}: ${ts.flattenDiagnosticMessageText(item.messageText, " ")}`;
          })
          .join("\n"),
      );

    // Reuse the application's stable Vite+ browser pipeline. Native Bun builds
    // currently drop namespace bindings used by React Query and Zod at runtime.
    const result = await buildBrowser({
      root: temporary,
      configFile: false,
      envFile: false,
      logLevel: "silent",
      publicDir: false,
      plugins: [react()],
      resolve: {
        alias: [
          {
            find: /^@\/components\/ui\/([a-z0-9-]+)$/,
            replacement: path.join(uiRoot, "components/$1.tsx"),
          },
          {
            find: /^@web-starter\/ui\/components\/(.+)$/,
            replacement: path.join(uiRoot, "components/$1.tsx"),
          },
          {
            find: /^@web-starter\/ui\/(lib|hooks)\/(.+)$/,
            replacement: path.join(uiRoot, "$1/$2.ts"),
          },
          ...Object.entries(aliases)
            .filter(([name]) => !name.includes("*"))
            .map(([find, replacement]) => ({ find, replacement })),
        ],
      },
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      build: {
        write: false,
        sourcemap: false,
        minify: true,
        target: "es2022",
        lib: { entry, name: "Cd80App", formats: ["iife"], fileName: "app" },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => item.output);
    if (
      outputs.length !== 1 ||
      outputs[0].type !== "chunk" ||
      outputs[0].imports.length ||
      outputs[0].dynamicImports.length
    )
      throw new Error("React starter must compile to one self-contained browser script");
    const javascript = outputs[0].code;
    if (javascript.length > 6_000_000)
      throw new Error("Compiled app exceeds the supported asset size");

    // Compile only the trusted preset. Generated CSS never enters a build plugin.
    const preset = (await readFile(path.join(uiRoot, "styles/globals.css"), "utf8"))
      .replace(/^@source[^\n]*\n/gm, "")
      .replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
    const tailwind = await compile(preset, {
      base: path.join(uiRoot, "styles"),
      onDependency() {},
    });
    const scanner = new Scanner({ sources: [] });
    const candidates = scanner.scanFiles([
      ...generated.map(([, content]) => ({ content, extension: "tsx" })),
      ...(await sourcesIn(uiRoot)),
      ...(await sourcesIn(sdkRoot)),
    ]);
    const css = `${tailwind.build(candidates)}\nhtml,body,#root{min-height:100%;margin:0}html{scrollbar-gutter:stable}\n${files["style.css"] ?? ""}`;
    if (css.length > 2_000_000) throw new Error("Compiled styles exceed the supported asset size");
    return { javascript, css };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

try {
  const input = await new Response(Bun.stdin.stream()).text();
  if (input.length > 300_000)
    throw new Error("React workspace exceeds the supported source bounds");
  const files = JSON.parse(input);
  if (
    !files ||
    typeof files !== "object" ||
    Array.isArray(files) ||
    Object.values(files).some((value) => typeof value !== "string")
  )
    throw new Error("Invalid React workspace");
  const artifacts = await build(files);
  process.stdout.write(JSON.stringify(artifacts));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : "React starter build failed");
  process.exitCode = 1;
}
