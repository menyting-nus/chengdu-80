import { parse } from "acorn";
import { compileTsx, inspectTsxSource } from "./tsx-compiler";
import {
  protocolFor,
  type AppBundle,
  type Check,
  type ProductSpec,
  type Verification,
} from "../lib/contracts";

const workerEntry = `import { analyze } from './calculations.js'; function check(v,depth=0){if(depth>30)throw new Error('Result nesting too deep');if(typeof v==='number'&&!Number.isFinite(v))throw new Error('Calculation returned non-finite numbers');if(v&&typeof v==='object')for(const x of Object.values(v))check(x,depth+1);} export default { async fetch(request) { try { const input=await request.json(); const result=await analyze(input); if(result && typeof result.error==='string') throw new Error(result.error); check(result); const text=JSON.stringify(result); if(!text || text.length>200000) throw new Error('Calculation result too large'); return new Response(text,{headers:{'content-type':'application/json'}}); } catch(e) { return Response.json({error:String(e.message||e).slice(0,2000)},{status:422}); } } };`;
const pool = new Map<string, any>();
export async function sourceHash(bundle: AppBundle) {
  // Convex normalizes object-key order when persisting values. Hash the same
  // canonical representation before and after storage, while retaining arrays
  // and exact source strings so actual source changes still invalidate checks.
  const serialized = JSON.stringify(bundle, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        )
      : value,
  );
  const bytes = new TextEncoder().encode(serialized);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function inspectSource(bundle: AppBundle, spec: ProductSpec): Check[] {
  const checks: Check[] = [];
  const add = (name: string, passed: boolean, detail: string) =>
    checks.push({ name, passed, detail });
  add(
    "Protocol contract",
    bundle.manifest.protocol === spec.protocol,
    `Required protocol: ${spec.protocol}`,
  );
  add(
    "Required capabilities",
    ["finance.calculate", "storage.read"].every((p) =>
      bundle.manifest.permissions.includes(p as any),
    ),
    "Calculation and shared input access must be declared.",
  );
  const html = bundle.files["index.html"];
  add(
    "HTML isolation",
    !/<\s*(script|iframe|object|embed|base|link|meta|form)\b|\bon[a-z]+\s*=|javascript\s*:/i.test(
      html,
    ),
    "HTML must be a body fragment without executable handlers, embedded documents, or external resources.",
  );
  add(
    "No embedded credentials",
    !/sk-(?:proj-)?[a-zA-Z0-9_-]{20,}|Bearer\s+[a-zA-Z0-9_-]{20,}|(?:api[_-]?key|token|password)\s*[:=]\s*["'][^"']{12,}/i.test(
      JSON.stringify(bundle.files),
    ),
    "Potential credentials prevent release.",
  );
  for (const file of ["app.js", "calculations.js"] as const) {
    try {
      const ast = parse(bundle.files[file], { ecmaVersion: "latest", sourceType: "module" });
      let forbidden = false;
      let analyze = false;
      function visit(node: any) {
        if (!node || typeof node !== "object") return;
        if (["ImportDeclaration", "ImportExpression", "ExportAllDeclaration"].includes(node.type))
          forbidden = true;
        if (node.type === "ExportNamedDeclaration" && node.source) forbidden = true;
        if (
          node.type === "Identifier" &&
          ["eval", "Function", "require", "process", "Bun", "Deno"].includes(node.name)
        )
          forbidden = true;
        if (
          node.type === "ExportNamedDeclaration" &&
          (node.declaration?.id?.name === "analyze" ||
            node.specifiers?.some((s: any) => s.exported.name === "analyze") ||
            node.declaration?.declarations?.some((d: any) => d.id.name === "analyze"))
        )
          analyze = true;
        for (const value of Object.values(node))
          if (Array.isArray(value)) value.forEach(visit);
          else if (value && typeof value === "object") visit(value);
      }
      visit(ast);
      add(
        `${file} syntax and dependencies`,
        !forbidden,
        "Self-contained JavaScript; no dynamic code evaluation, imports, or host runtime APIs.",
      );
      if (file === "calculations.js")
        add(
          "Calculation export",
          analyze,
          "Export analyze(input) for verification and runtime calls.",
        );
    } catch (e) {
      add(`${file} syntax`, false, e instanceof Error ? e.message : "Invalid source");
    }
  }
  if (bundle.manifest.schemaVersion === 2) checks.push(...inspectTsxSource(bundle));
  return checks;
}
export async function execute(bundle: AppBundle, input: unknown) {
  // A trusted entry-point change must not reuse an isolate from an older runtime.
  const key = "runtime-v2:" + (await sourceHash(bundle));
  let stub: { fetch: (request: Request) => Promise<Response> };
  let dispose: (() => Promise<void>) | undefined;
  // Miniflare runs this untrusted module in workerd, without Node APIs or secrets.
  // Used unconditionally (local dev, self-hosted deploys, and hosted mode alike) so
  // the sandbox never depends on a Cloudflare account or Worker Loader binding.
  if (!pool.has(key)) {
    const { Miniflare, Log, LogLevel } = await import("miniflare");
    const instance = new Miniflare({
      cf: false,
      compatibilityDate: "2026-07-01",
      log: new Log(LogLevel.ERROR),
      modules: [
        { type: "ESModule", path: "/entry.js", contents: workerEntry },
        { type: "ESModule", path: "/calculations.js", contents: bundle.files["calculations.js"] },
      ],
      modulesRoot: "/",
      outboundService: () => new Response("Network access denied", { status: 403 }),
    });
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        instance.ready,
        new Promise<never>((_, reject) => {
          startupTimer = setTimeout(() => {
            void instance.dispose();
            reject(new Error("Calculation module startup exceeded 3 seconds"));
          }, 3000);
        }),
      ]);
    } finally {
      if (startupTimer) clearTimeout(startupTimer);
    }
    if (pool.size >= 6) {
      const [oldKey, old] = pool.entries().next().value!;
      pool.delete(oldKey);
      await old.dispose();
    }
    pool.set(key, instance);
  }
  const instance = pool.get(key);
  stub = {
    fetch: async (req) =>
      instance.dispatchFetch(req.url, {
        method: req.method,
        headers: Object.fromEntries(req.headers.entries()),
        body: await req.text(),
      }),
  };
  dispose = async () => {
    pool.delete(key);
    await instance.dispose();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      stub.fetch(
        new Request("https://calculation.invalid/", {
          method: "POST",
          body: JSON.stringify(input),
          headers: { "content-type": "application/json" },
        }),
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          void dispose?.();
          reject(new Error("Calculation exceeded the 3 second runtime limit"));
        }, 3000);
      }),
    ]);
    const result = (await response.json()) as any;
    if (!response.ok) throw new Error(result.error || "Calculation failed");
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function matches(result: any, expected: Record<string, unknown>) {
  return (
    result &&
    Object.entries(expected).every(([key, value]) =>
      typeof value === "number"
        ? typeof result[key] === "number" &&
          Number.isFinite(result[key]) &&
          Math.abs(value - result[key]) < 0.000001
        : JSON.stringify(result[key]) === JSON.stringify(value),
    )
  );
}
export async function verify(bundle: AppBundle, spec: ProductSpec): Promise<Verification> {
  const checks = inspectSource(bundle, spec);
  if (bundle.manifest.schemaVersion === 2 && checks.every((check) => check.passed)) {
    try {
      await compileTsx(bundle);
      checks.push({
        name: "React typecheck and browser build",
        passed: true,
        detail:
          "Strict TypeScript checking and the fixed React/shadcn browser build succeeded. This checks compilation; browser rendering is verified separately.",
      });
    } catch (error) {
      checks.push({
        name: "React typecheck and browser build",
        passed: false,
        detail:
          error instanceof Error ? error.message.slice(0, 12_000) : "React starter build failed",
      });
    }
  }
  if (checks.every((c) => c.passed)) {
    const p = protocolFor(spec.protocol);
    try {
      const result = await execute(bundle, p.fixture.input);
      checks.push({
        name: "Protocol numerical fixture",
        passed: !!matches(result, p.fixture.expected),
        detail: `Independent expected values: ${JSON.stringify(p.fixture.expected)}. Actual: ${JSON.stringify(result).slice(0, 700)}`,
      });
      const edge =
        spec.protocol === "portfolio"
          ? { holdings: [], cash: 100 }
          : spec.protocol === "screening"
            ? {
                assets: [{ symbol: "MISSING", pe: null, dividendYield: 3 }],
                maxPE: 20,
                minYield: 2,
              }
            : { prices: [100, 100], feeBps: 0 };
      const expected =
        spec.protocol === "portfolio"
          ? { totalValue: 100, profit: 0, returnPct: 0, concentrationPct: 0 }
          : spec.protocol === "screening"
            ? { selected: [] }
            : { grossReturnPct: 0, netReturnPct: 0, maxDrawdownPct: 0 };
      checks.push({
        name: "Missing data and boundary fixture",
        passed: !!matches(await execute(bundle, edge), expected),
        detail:
          "Zero-cost, missing-value, or flat-price boundary according to the selected protocol.",
      });
      if (spec.protocol !== "screening") {
        let rejected = false;
        try {
          await execute(
            bundle,
            spec.protocol === "portfolio"
              ? { holdings: [{ symbol: "BAD", units: -1, cost: 100, price: 120 }], cash: 0 }
              : { prices: [100, 0], feeBps: 0 },
          );
        } catch {
          rejected = true;
        }
        checks.push({
          name: "Invalid financial input rejected",
          passed: rejected,
          detail:
            "Negative holdings or zero prices must reject with a thrown error or an error result.",
        });
      }
      checks.push({
        name: "Isolated runtime execution",
        passed: true,
        detail:
          "Calculation executed in an isolated Miniflare Worker with no outbound network or provider secrets. Browser rendering still requires preview review.",
      });
    } catch (e) {
      checks.push({
        name: "Isolated runtime execution",
        passed: false,
        detail: e instanceof Error ? e.message : "Runtime failed",
      });
    }
  }
  return {
    passed: checks.length > 0 && checks.every((c) => c.passed),
    checks,
    checkedAt: new Date().toISOString(),
    sourceHash: await sourceHash(bundle),
  };
}
export async function disposeRuntimes() {
  const instances = [...pool.values()];
  pool.clear();
  await Promise.all(instances.map((instance) => instance.dispose()));
}
