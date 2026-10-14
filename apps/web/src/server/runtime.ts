import { prepareProject, buildProject, releaseWorkspace } from "./app-workspaces";
import { bundleSchema } from "../lib/contracts";
import { calculate } from "../lib/finance";
import type { AppBundle, Check, ProductSpec, Verification } from "../lib/contracts";

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
  return [
    {
      name: "Protocol contract",
      passed: bundle.manifest.protocol === spec.protocol,
      detail: `Required protocol: ${spec.protocol}. Financial capabilities use fixed platform calculations.`,
    },
    {
      name: "No embedded credentials",
      passed:
        !/sk-(?:proj-)?[a-zA-Z0-9_-]{20,}|Bearer\s+[a-zA-Z0-9_-]{20,}|(?:api[_-]?key|token|password)\s*[:=]\s*["'][^"']{12,}/i.test(
          JSON.stringify(bundle.files),
        ),
      detail: "Potential credentials prevent release.",
    },
    {
      name: "Application project source",
      passed: bundleSchema.safeParse(bundle).success,
      detail:
        "A complete application checkout with safe relative source paths; dependency caches and environment files stay outside persisted source.",
    },
  ];
}

// Financial RPCs run trusted platform math; generated source is never executed here.
export async function execute(bundle: AppBundle, input: unknown) {
  return calculate(bundle.manifest.protocol, input);
}

export async function verify(
  bundle: AppBundle,
  spec: ProductSpec,
  signal?: AbortSignal,
): Promise<Verification> {
  const checks = inspectSource(bundle, spec);
  if (checks.every((check) => check.passed)) {
    try {
      const workspace = await prepareProject(bundle, {
        scope: `verify:${await sourceHash(bundle)}`,
        pin: true,
      });
      try {
        await buildProject(workspace, { signal });
      } finally {
        await releaseWorkspace(workspace);
      }
      checks.push({
        name: "Application build and checks",
        passed: true,
        detail:
          "The project passed its standard bun run build and bun run check commands inside the isolated workspace. Browser behavior is verified separately.",
      });
    } catch (error) {
      checks.push({
        name: "Application build and checks",
        passed: false,
        detail:
          error instanceof Error
            ? error.message.slice(0, 12_000)
            : "Application project build failed",
      });
    }
  }
  return {
    passed: checks.length > 0 && checks.every((check) => check.passed),
    checks,
    checkedAt: new Date().toISOString(),
    sourceHash: await sourceHash(bundle),
  };
}
