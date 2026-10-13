import { modelConfiguration } from "./model-config";
import { z } from "zod";
import {
  bundleSchema,
  protocols,
  specSchema,
  type Application,
  type AppBundle,
  type ProductSpec,
  type Release,
} from "../lib/contracts";
import { calculate, defaultData, fixtureMeta } from "../lib/finance";
import { tsxStarter } from "../lib/tsx-starter";
import { sampleBundle } from "../lib/samples";
import { auth } from "../integrations/auth";
import { clarify, explain, feasibility, generate } from "./models";
import { assetUniverse, prices } from "./providers";
import { event, findApp, listApps, saveApp, mutateApp, type Access } from "./repository";
import { execute, sourceHash, verify } from "./runtime";
import { demoMode, demoOwnerId, localMode, settings } from "./settings";

const text = z.string().trim().min(1).max(4000);
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("clarify"), prompt: text }),
  z.object({ action: z.literal("create-workspace"), prompt: z.string().trim().min(1).max(12000) }),
  z.object({
    action: z.literal("browser-log"),
    appId: z.string(),
    releaseId: z.string(),
    level: z.literal("error"),
    message: z.string().max(2000),
  }),
  z.object({ action: z.literal("create"), spec: specSchema, mode: z.enum(["sample", "model"]) }),
  z.object({ action: z.literal("seed") }),
  z.object({
    action: z.literal("import"),
    bundle: bundleSchema,
    spec: specSchema.optional(),
    appId: z.string().optional(),
  }),
  z.object({
    action: z.literal("update"),
    appId: z.string(),
    request: text,
    mode: z.enum(["sample", "model"]),
  }),
  z.object({ action: z.literal("accept"), appId: z.string(), releaseId: z.string() }),
  z.object({ action: z.literal("discard"), appId: z.string(), releaseId: z.string() }),
  z.object({ action: z.literal("reverify"), appId: z.string(), releaseId: z.string() }),
  z.object({
    action: z.literal("rpc"),
    appId: z.string(),
    releaseId: z.string(),
    capability: z.string(),
    input: z.unknown(),
  }),
  z.object({
    action: z.literal("test-provider"),
    provider: z.enum(["fixtures", "alpha-demo", "tushare"]),
  }),
  z.object({
    action: z.literal("load-prices"),
    appId: z.string(),
    provider: z.enum(["fixtures", "alpha-demo", "tushare"]),
  }),
]);
export async function accessFor(request: Request): Promise<Access> {
  if (await localMode()) {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname))
      throw new Error("Local prototype is restricted to loopback");
    return { ownerId: "local-prototype-owner", accessToken: null };
  }
  if (await demoMode()) return { ownerId: demoOwnerId, accessToken: null };
  const session = await auth.getSession();
  if (!session.viewer || !session.accessToken) throw new Error("Authentication required");
  return { ownerId: session.viewer.id, accessToken: session.accessToken };
}
export async function snapshot(access: Access, includeMessages = true, statusOnly = false) {
  const config = await settings();
  return {
    apps: statusOnly ? [] : await listApps(access, includeMessages),
    protocols,
    status: {
      local: await localMode(),
      demo: await demoMode(),
      model: modelConfiguration(config).model,
      modelProvider: modelConfiguration(config).provider,
      modelConfigured: !!modelConfiguration(config).apiKey,
      tushareConfigured: !!config.TUSHARE_TOKEN,
      hostedDatabaseConfigured: !!config.VITE_CONVEX_URL,
      runtime: "Miniflare workerd sandbox",
    },
  };
}
export async function makeRelease(
  spec: ProductSpec,
  bundle: AppBundle,
  origin: Release["origin"],
  notes: string,
): Promise<Release> {
  return {
    id: crypto.randomUUID(),
    bundle,
    spec,
    verification: await verify(bundle, spec),
    createdAt: new Date().toISOString(),
    origin,
    notes,
  };
}
function newApp(access: Access, spec: ProductSpec): Application {
  return {
    id: crypto.randomUUID(),
    ownerId: access.ownerId,
    name: spec.name,
    spec,
    revision: 0,
    current: null,
    preview: null,
    data: { inputs: defaultData(spec.protocol), _provenance: fixtureMeta },
    history: [],
    events: [],
    createdAt: new Date().toISOString(),
  };
}
// Verified source becomes active atomically; failed builds preserve the working release.
export async function applyRelease(app: Application, release: Release) {
  if (!release.verification.passed) {
    app.preview = release;
    return false;
  }
  if (release.verification.sourceHash !== (await sourceHash(release.bundle)))
    throw new Error("Source changed after verification.");
  if (app.current) app.history = [app.current, ...app.history].slice(0, 2);
  app.current = release;
  app.preview = null;
  app.spec = release.spec;
  app.name = release.spec.name;
  return true;
}
async function build(
  spec: ProductSpec,
  mode: "model" | "sample",
  request: string,
  previous?: Release,
) {
  if (mode === "sample")
    return makeRelease(
      spec,
      sampleBundle(spec),
      "sample",
      "Deterministic example builder. No model generation was used.",
    );
  let release = await makeRelease(spec, await generate(spec, request, previous), "model", request);
  if (!release.verification.passed)
    release = await makeRelease(
      spec,
      await generate(
        spec,
        request,
        release,
        JSON.stringify(release.verification.checks.filter((c) => !c.passed)),
      ),
      "model",
      request + " · one automatic repair attempt",
    );
  return release;
}
export async function dispatch(access: Access, raw: unknown) {
  const req = requestSchema.parse(raw);
  if (req.action === "create-workspace") {
    if (!(await localMode())) throw new Error("Create conversations through the Convex mutation.");
    const app = newApp(access, {
      ...protocols[0]!.defaultSpec,
      name: "New chat",
      purpose: req.prompt.length >= 10 ? req.prompt.slice(0, 4000) : `Conversation: ${req.prompt}`,
    });
    app.chatTitle = "New chat";
    app.conversation = [];
    const scaffold = tsxStarter(app.spec);
    app.workspace = scaffold;
    const saved = await saveApp(access, app, null);
    const { generateChatTitle } = await import("./chat-title");
    void generateChatTitle(req.prompt)
      .then(async (title) => {
        await mutateApp(access, saved.id, (current) => {
          current.chatTitle = title;
        });
      })
      .catch(() => {});
    return saved;
  }
  if (req.action === "clarify") {
    const gate = feasibility(req.prompt);
    if (!gate.allowed) throw new Error(gate.reason);
    const config = await settings();
    return {
      spec: modelConfiguration(config).apiKey
        ? await clarify(req.prompt)
        : (await import("../lib/contracts")).getSuggestedSpec(req.prompt),
      generatedBy: modelConfiguration(config).apiKey ? "model" : "sample",
      feasibility: gate,
    };
  }
  if (req.action === "test-provider") {
    const result = await prices({ symbol: "600104.SHH", provider: req.provider });
    return { meta: result.meta, count: result.prices.length, latest: result.prices.at(-1) };
  }
  if (req.action === "seed") {
    const existing = await listApps(access);
    const created: Application[] = [];
    for (const p of protocols) {
      if (existing.some((a) => a.current?.origin === "sample" && a.spec.protocol === p.id))
        continue;
      const app = newApp(access, p.defaultSpec);
      const release = await build(app.spec, "sample", "Install example");
      if (release.verification.passed) app.current = release;
      else app.preview = release;
      event(app, "Installed a labelled example application.");
      created.push(await saveApp(access, app, null));
    }
    return created;
  }
  if (req.action === "create") {
    const gate = feasibility(req.spec.purpose);
    if (!gate.allowed) throw new Error(gate.reason);
    const app = newApp(access, req.spec);
    const active = await applyRelease(
      app,
      await build(app.spec, req.mode, "Build the product specification"),
    );
    event(
      app,
      active
        ? "Generated and activated the verified application."
        : "Generation failed verification.",
    );
    return saveApp(access, app, null);
  }
  if (req.action === "import") {
    const spec = req.spec ?? {
      ...protocols.find((p) => p.id === req.bundle.manifest.protocol)!.defaultSpec,
      name: req.bundle.manifest.name,
    };
    const app = req.appId ? await findApp(access, req.appId) : newApp(access, spec);
    if (req.appId && spec.protocol !== app.spec.protocol)
      throw new Error(
        "Changing an existing app's protocol requires a new app to protect its data.",
      );
    const active = await applyRelease(
      app,
      await makeRelease(spec, req.bundle, "import", "Imported application source"),
    );
    event(
      app,
      active
        ? "Imported and activated verified source."
        : "Imported source failed verification; working app retained.",
    );
    return saveApp(access, app, req.appId ? app.revision : null);
  }
  const app = await findApp(access, req.appId);
  if (req.action === "browser-log") {
    if (![app.current?.id, app.preview?.id].includes(req.releaseId))
      throw new Error("Unknown release");
    await mutateApp(access, app.id, (current) => {
      current.browserEvents = [
        { releaseId: req.releaseId, at: new Date().toISOString(), message: req.message },
        ...(current.browserEvents ?? []),
      ].slice(0, 20);
    });
    return { recorded: true };
  }
  if (req.action === "reverify") {
    if (app.preview?.id !== req.releaseId) throw new Error("Preview changed. Refresh first.");
    app.preview.verification = await verify(app.preview.bundle, app.preview.spec);
    const active = await applyRelease(app, app.preview);
    event(
      app,
      active
        ? "Verified source activated."
        : "Source still fails verification; working app retained.",
    );
    return saveApp(access, app, app.revision);
  }
  if (req.action === "load-prices") {
    if (app.spec.protocol !== "strategy" || !app.current)
      throw new Error("Build a strategy app before loading a price series.");
    if (req.provider === "alpha-demo" && !(await localMode()))
      throw new Error(
        "The public demo provider is restricted to local technical tests. Configure a licensed hosted provider instead.",
      );
    const result = await prices({ symbol: "600104.SHH", provider: req.provider });
    const rows = result.prices.slice(-252);
    const inputs = {
      ...(app.data.inputs as any),
      prices: rows.map((r: any) => r.close),
      feeBps: (app.data.inputs as any)?.feeBps ?? 10,
    };
    await execute(app.current.bundle, inputs);
    app.data.inputs = inputs;
    app.data._provenance = {
      ...result.meta,
      coverage: `${rows[0]!.date} to ${rows.at(-1)!.date}`,
      symbol: result.symbol,
      observations: rows.length,
    };
    event(app, `Loaded ${rows.length} daily closes from ${result.meta.provider}.`);
    return saveApp(access, app, app.revision);
  }
  if (req.action === "update") {
    const gate = feasibility(req.request);
    if (!gate.allowed) throw new Error(gate.reason);
    const spec = {
      ...app.spec,
      constraints: [...app.spec.constraints, `Change: ${req.request}`].slice(-20),
    };
    const active = await applyRelease(
      app,
      await build(spec, req.mode, req.request, app.current ?? app.preview ?? undefined),
    );
    event(
      app,
      active
        ? "Applied verified changes. Shared data retained."
        : "Update failed verification; working app and data retained.",
    );
    return saveApp(access, app, app.revision);
  }
  if (req.action === "accept") {
    const release = app.preview;
    if (
      !release ||
      release.id !== req.releaseId ||
      !release.verification.passed ||
      release.verification.sourceHash !== (await sourceHash(release.bundle))
    )
      throw new Error("A verified, unchanged preview is required before accepting a release.");
    await applyRelease(app, release);
    event(app, "Activated verified source. Shared data retained.");
    return saveApp(access, app, app.revision);
  }
  if (req.action === "discard") {
    if (app.preview?.id !== req.releaseId) throw new Error("Preview changed. Refresh first.");
    app.preview = null;
    event(app, "Discarded the preview. The accepted release is unchanged.");
    return saveApp(access, app, app.revision);
  }
  const release = [app.current, app.preview].find((r) => r?.id === req.releaseId);
  if (
    !release?.verification.passed ||
    !release.bundle.manifest.permissions.includes(req.capability as any)
  )
    throw new Error("Verified release and declared capability permission required");
  if (JSON.stringify(req.input ?? null).length > 150000)
    throw new Error("Capability input exceeds size limit");
  if (req.capability === "plugin.call") {
    const input = z
      .object({
        pluginId: z.string(),
        operationId: z.string(),
        parameters: z.record(z.string(), z.unknown()).default({}),
        readOnly: z.boolean().optional(),
      })
      .parse(req.input);
    if (!app.enabledPlugins?.includes(input.pluginId))
      throw new Error("Plugin is not enabled for this app");
    return (await import("./plugins")).callPlugin(
      access,
      input.pluginId,
      input.operationId,
      input.parameters,
      input.readOnly,
    );
  }
  if (req.capability === "finance.calculate") return execute(release.bundle, req.input);
  if (req.capability === "finance.portfolio") return calculate("portfolio", req.input);
  if (req.capability === "finance.screen") return calculate("screening", req.input);
  if (req.capability === "finance.backtest") return calculate("strategy", req.input);
  if (req.capability === "market.assets") return assetUniverse();
  if (req.capability === "market.prices") {
    const input = z
      .object({ provider: z.enum(["fixtures", "tushare"]).default("fixtures"), symbol: z.string() })
      .parse(req.input);
    return prices(input);
  }
  if (req.capability === "storage.read") {
    const { key } = z.object({ key: z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/) }).parse(req.input);
    return app.data[key] ?? null;
  }
  if (req.capability === "storage.write") {
    if (app.current?.id !== release.id)
      throw new Error("Only the active verified release can change shared data.");
    const { key, value } = z
      .object({ key: z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/), value: z.unknown() })
      .parse(req.input);
    if (key.startsWith("_")) throw new Error("Reserved platform metadata key");
    if (key === "inputs") await execute(release.bundle, value);
    if (JSON.stringify({ ...app.data, [key]: value }).length > 150000)
      throw new Error("Shared data exceeds prototype size limit");
    app.data[key] = value;
    if (key === "inputs")
      app.data._provenance = {
        provider: "User-entered inputs",
        synthetic: false,
        currency: "CNY",
        warning: "Inputs were edited by the account owner and have not been independently sourced.",
      };
    event(app, `Updated shared data: ${key}`);
    await saveApp(access, app, app.revision);
    return { saved: true };
  }
  if (req.capability === "ai.explain") {
    const input = z.object({ question: text, result: z.unknown() }).parse(req.input);
    return explain(input.question, {
      result: await execute(release.bundle, app.data.inputs),
      protocol: app.spec.protocol,
      provenance: app.data._provenance ?? fixtureMeta,
    });
  }
  throw new Error("Unsupported capability");
}
